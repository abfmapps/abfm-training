// Admin proxy: lets every admin use the shared Gemini, Groq and OpenRouter keys and the GitHub token
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
// OpenRouter: the model chosen in Settings → AI (if any), then OpenRouter's automatic pick.
const OR_DEFAULT = ["openrouter/auto"];
// OpenRouter free models, from its public model list (cached for an hour). Used when the chosen model
// or the automatic pick is not allowed (e.g. the account only allows free models, or has no credit).
let orFreeCache: { at: number; text: string[]; vision: string[] } | null = null;
async function orFreeModels(vision: boolean): Promise<string[]> {
  if (!orFreeCache || Date.now() - orFreeCache.at > 3600_000) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(8000) });
      const list: any[] = ((await r.json()) || {}).data || [];
      const free = list.filter((m) => m && typeof m.id === "string" && !m.id.startsWith("openrouter/") &&
        (m.id.endsWith(":free") || (String(m.pricing?.prompt) === "0" && String(m.pricing?.completion) === "0")) &&
        (m.architecture?.output_modalities || ["text"]).includes("text"));
      const rank = (m: any) => (/gpt-oss|llama-3\.3-70b|deepseek|qwen|gemma|mistral|llama-4/i.test(m.id) ? 1e9 : 0) + (m.context_length || 0);
      free.sort((a, b) => rank(b) - rank(a));
      orFreeCache = { at: Date.now(), text: free.map((m) => m.id), vision: free.filter((m) => (m.architecture?.input_modalities || []).includes("image")).map((m) => m.id) };
    } catch { orFreeCache = { at: Date.now() - 3000_000, text: [], vision: [] }; }
  }
  return (vision ? orFreeCache.vision : orFreeCache.text).slice(0, 4);
}

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
  const ENV: Record<string, string[]> = { gemini: ["GEMINI_API_KEY"], groq: ["GROQ_API_KEY", "Groq_API_KEY", "groq_api_key"], openrouter: ["OPENROUTER_API_KEY", "OpenRouter_API_KEY", "openrouter_api_key"], github: ["GITHUB_TOKEN"] };
  const secret = async (name: string) => {
    const r = await fetch(url + "/rest/v1/rpc/service_get_secret", { method: "POST", headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name }) });
    const v = r.ok ? ((await r.json()) || "") : "";
    return v || (ENV[name] || []).map((n) => Deno.env.get(n) || "").find(Boolean) || "";
  };

  // Which keys can be used (never the keys themselves).
  if (b.kind === "status") {
    const [gemini, groq, openrouter, github] = await Promise.all(["gemini", "groq", "openrouter", "github"].map(async (n) => !!(await secret(n))));
    return reply({ gemini, groq, openrouter, github });
  }

  if (b.kind === "gemini") {
    const model = String(b.model || "");
    if (!/^[a-z0-9.\-]+$/i.test(model)) return reply({ error: { message: "bad model" } }, 400);
    const key = await secret("gemini");
    if (!key) return reply({ error: { message: "No shared Gemini key. The owner adds it in Settings → AI." } }, 412);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(b.body || {}),
    });
    const t = await r.text();
    if (!r.ok) console.log(JSON.stringify({ kind: "gemini", model, status: r.status, error: t.slice(0, 300) }));
    return new Response(t, { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
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
      console.log(JSON.stringify({ kind: "groq", model, status: r.status, error: String(last).slice(0, 300) }));
      if (r.status === 404 || /decommission|not found|does not exist|not supported/i.test(last) || r.status === 429 || r.status >= 500) continue;
      return reply({ error: { message: "Groq: " + last } }, r.status);
    }
    return reply({ error: { message: "Groq: " + last } }, 503);
  }

  if (b.kind === "openrouter") {
    const key = await secret("openrouter");
    if (!key) return reply({ error: { message: "No shared OpenRouter key." } }, 412);
    const content = (Array.isArray(b.content) ? b.content : []).slice(0, 8);
    const chosen = typeof b.model === "string" && /^[\w.\-:\/]+$/.test(b.model) ? [b.model] : [];
    const vision = content.some((c: any) => c && c.type === "image_url");
    let last = "", addedFree = false;
    const models = [...new Set([...chosen, ...OR_DEFAULT])];
    for (let mi = 0; mi < models.length && mi < 6; mi++) {
      const model = models[mi];
      // When the last listed model fails, add the free models (once), so an account limited to free models still works.
      const addFree = async () => { if (mi === models.length - 1 && !addedFree) { addedFree = true; for (const f of await orFreeModels(vision)) if (!models.includes(f)) models.push(f); } };
      for (const strict of b.json ? [true, false] : [false]) {   // some models refuse response_format: retry without it
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": "https://abfmapps.github.io/abfm-training/", "X-Title": "ABFM Training" },
          body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content }], ...(strict ? { response_format: { type: "json_object" } } : {}) }),
        });
        const j = await r.json().catch(() => ({}));
        const text = j.choices?.[0]?.message?.content || "";
        if (r.ok && text) return reply({ text, model: "openrouter:" + (j.model || model) });
        last = j.error?.message || (r.ok ? "empty answer" : "HTTP " + r.status);
        console.log(JSON.stringify({ kind: "openrouter", model, status: r.status, error: String(last).slice(0, 300), raw: r.ok ? JSON.stringify(j).slice(0, 300) : undefined }));
        if (r.status === 401) return reply({ error: { message: "OpenRouter: " + last } }, r.status);
        if (!(strict && r.status === 400)) break;
      }
      await addFree();
    }
    return reply({ error: { message: "OpenRouter: " + last } }, /credit|payment|402/i.test(last) ? 402 : 503);
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
