// Admin proxy: lets every admin use the shared Gemini and Groq keys and the GitHub token
// without the keys ever reaching a browser. The keys live in private.app_secrets
// (set by the owner in Settings) and are read here with the service role.
// Only signed-in admins (public.is_admin) may call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const REPO = "/repos/abfmapps/abfm-training/actions/";
// Groq models, best first. Older names are skipped automatically if Groq retires them.
const GROQ_TEXT = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const GROQ_VISION = ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";

  // Is the caller a signed-in admin?
  const adm = await fetch(url + "/rest/v1/rpc/is_admin", { method: "POST", headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  if (!adm.ok || (await adm.json()) !== true) return reply({ error: { message: "Only admins can use the shared keys." } }, 403);

  let b: any;
  try { b = await req.json(); } catch { return reply({ error: { message: "bad request" } }, 400); }
  // The owner's key from Settings first, then the Supabase Edge Function secret of the same name.
  const ENV: Record<string, string[]> = { gemini: ["GEMINI_API_KEY"], groq: ["GROQ_API_KEY", "Groq_API_KEY", "groq_api_key"], github: ["GITHUB_TOKEN"] };
  const secret = async (name: string) => {
    const r = await fetch(url + "/rest/v1/rpc/service_get_secret", { method: "POST", headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name }) });
    const v = r.ok ? ((await r.json()) || "") : "";
    return v || (ENV[name] || []).map((n) => Deno.env.get(n) || "").find(Boolean) || "";
  };

  // Which keys can be used (never the keys themselves).
  if (b.kind === "status") {
    const [gemini, groq, github] = await Promise.all(["gemini", "groq", "github"].map(async (n) => !!(await secret(n))));
    return reply({ gemini, groq, github });
  }

  if (b.kind === "gemini") {
    const model = String(b.model || "");
    if (!/^[a-z0-9.\-]+$/i.test(model)) return reply({ error: { message: "bad model" } }, 400);
    const key = await secret("gemini");
    if (!key) return reply({ error: { message: "No shared Gemini key. The owner adds it in Settings → AI." } }, 412);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(b.body || {}),
    });
    return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  if (b.kind === "groq") {
    const key = await secret("groq");
    if (!key) return reply({ error: { message: "No shared Groq key." } }, 412);
    const content = (Array.isArray(b.content) ? b.content : []).slice(0, 8);
    const vision = content.some((c: any) => c && c.type === "image_url");
    let last = "";
    for (const model of vision ? GROQ_VISION : GROQ_TEXT) {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content }], ...(b.json ? { response_format: { type: "json_object" } } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return reply({ text: j.choices?.[0]?.message?.content || "", model: "groq:" + model });
      last = j.error?.message || "HTTP " + r.status;
      if (r.status === 404 || /decommission|not found|does not exist|not supported/i.test(last) || r.status === 429 || r.status >= 500) continue;
      return reply({ error: { message: "Groq: " + last } }, r.status);
    }
    return reply({ error: { message: "Groq: " + last } }, 503);
  }

  if (b.kind === "github") {
    const path = String(b.path || ""), method = String(b.method || "GET").toUpperCase();
    if (!path.startsWith(REPO) || path.includes("..") || !["GET", "POST"].includes(method)) return reply({ message: "not allowed" }, 403);
    const token = await secret("github");
    if (!token) return reply({ message: "No shared GitHub token." }, 401);
    const r = await fetch("https://api.github.com" + path, {
      method, headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "abfm-training-admin", ...(b.body ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" && b.body ? JSON.stringify(b.body) : undefined,
    });
    const text = await r.text();
    return new Response(r.status === 204 ? null : text, { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  return reply({ error: { message: "unknown kind" } }, 400);
});
