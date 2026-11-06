// Ask AI for staff: answers work questions (with up to 3 photos) using Gemini, Groq and/or OpenRouter,
// as chosen in admin Settings → AI. The keys stay on the server — they are never in the app.
// Who may ask, and how often, is checked by the database function public.ai_allowed.
// Questions and photos are not saved anywhere.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
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
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, error: "method" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return reply({ ok: false, error: "bad" }); }

  // Keys: the owner's shared key from admin Settings, else the Supabase secret. Groq is the backup.
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const shared = async (name: string) => {
    try {
      const r = await fetch(url + "/rest/v1/rpc/service_get_secret", { method: "POST", headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" }, body: JSON.stringify({ p_name: name }) });
      return r.ok ? ((await r.json()) || "") : "";
    } catch { return ""; }
  };
  // Settings → AI (which AI is on and which goes first), the keys, and the access check — all at once.
  const started = Date.now();
  const settingsP = fetch(url + "/rest/v1/docs?name=eq.settings&select=content", { headers: { apikey: service, Authorization: "Bearer " + service } })
    .then((r) => r.json()).then((j) => (j[0]?.content?.ai) || {}).catch(() => ({}));
  const allowedP = fetch(url + "/rest/v1/rpc/ai_allowed", {
    method: "POST", headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: String(b.token || ""), p_device: String(b.device || "") }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: "error", detail: String(e).slice(0, 200) }));
  const [ai, gem, grq, orr, ok]: any[] = await Promise.all([settingsP, shared("gemini"), shared("groq"), shared("openrouter"), allowedP]);
  const key = ai.gemini === false ? "" : gem || Deno.env.get("GEMINI_API_KEY") || "";
  const groqKey = ai.groq === false ? "" : grq || Deno.env.get("GROQ_API_KEY") || Deno.env.get("Groq_API_KEY") || "";
  const orKey = ai.openrouter === false ? "" : orr || Deno.env.get("OPENROUTER_API_KEY") || "";
  if (!key && !groqKey && !orKey) return reply({ ok: false, error: "off" });
  // Signed in (when sign-in is on), Ask AI turned on, and within the limits?
  if (!ok || !ok.ok) return reply({ ok: false, error: (ok && ok.error) || "error", ...(ok && ok.detail ? { detail: ok.detail } : {}) });

  const text = String(b.text || "").slice(0, 1500);
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 3)
    .filter((i: any) => i && /^image\/(jpeg|png|webp)$/.test(i.mime) && typeof i.data === "string" && i.data.length < 2_000_000);
  if (!text && !images.length) return reply({ ok: false, error: "empty" });
  const catalog: string[] = (Array.isArray(b.catalog) ? b.catalog : []).slice(0, 300).map((x: unknown) => String(x).slice(0, 200));
  const lang = String(b.langName || "English").slice(0, 30);

  const system =
`You are the ABFM Training AI helper for facility-maintenance technicians at Al Bonian Facilities Management in Dubai (HVAC, electrical, plumbing, fire systems, water tank and duct cleaning, civil, painting, landscaping, health & safety).
Answer in ${lang}, in simple words, for someone with basic schooling. Be practical and short: under 180 words. Use numbered steps for procedures.
Safety first: if the task is dangerous (live electrical work, refrigerant, height, confined space, hot work, chemicals, gas), say so clearly, mention the permit/isolation/PPE needed, and say to ask the supervisor when the job needs a qualified person. Never explain how to bypass safety devices, interlocks, alarms or fire systems.
If a photo is attached, describe what you see that matters, then answer. If you can't tell from the photo, say what extra photo or detail would help.
If the question is not about maintenance, safety or this training, politely say you can only help with work topics.
Training library (id | title | trade / subject):
${catalog.join("\n")}
Reply with JSON only: {"answer": string, "videos": [up to 3 ids from the library that really match the question, best first, or empty]}.`;

  const contents: any[] = [];
  (Array.isArray(b.history) ? b.history : []).slice(-8).forEach((h: any) => {
    const t = String((h && h.text) || "").slice(0, 1500);
    if (t) contents.push({ role: h.role === "model" ? "model" : "user", parts: [{ text: t }] });
  });
  const parts: any[] = images.map((i: any) => ({ inline_data: { mime_type: i.mime, data: i.data } }));
  parts.push({ text: text || "What do you see in this photo, and what should I check or do?" });
  contents.push({ role: "user", parts });
  const body = JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3, responseMimeType: "application/json" } });
  const ids = new Set(catalog.map((x) => x.split(" | ")[0].trim()));
  const answer = (raw: string, model: string) => {
    let ans: any;
    try { ans = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch { ans = { answer: raw }; }
    return reply({
      ok: true, model, answer: String(ans.answer || raw || "").slice(0, 4000),
      videos: (Array.isArray(ans.videos) ? ans.videos : []).map(String).filter((id: string) => ids.has(id)).slice(0, 3),
    });
  };
  let last = "", sawBusy = false;

  // Gemini: tries the newest model first, then older ones.
  const viaGemini = async (): Promise<Response | null> => {
    for (const m of MODELS) {
      let r: Response | null = null;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(25000),
          });
          if (r.status !== 503 && r.status !== 500) break;
          await new Promise((res) => setTimeout(res, 1500));
        }
      } catch { sawBusy = true; last = m + " slow"; return null; }   // too slow: let the other AI answer
      if (!r) continue;
      if (r.status === 404) { last = "model"; continue; }
      if (r.status === 429 || r.status === 503 || r.status === 500) { sawBusy = true; last = m + " busy"; continue; }
      if (r.status !== 200) { last = (await r.text()).slice(0, 200); return null; }
      const j = await r.json();
      return answer((((j.candidates || [])[0] || {}).content?.parts || []).map((p: any) => p.text || "").join(""), m);
    }
    return null;
  };

  // Groq: same question in OpenAI format; photos go to a vision model.
  const viaGroq = async (): Promise<Response | null> => {
    const msgs: any[] = [{ role: "system", content: system }];
    (Array.isArray(b.history) ? b.history : []).slice(-8).forEach((h: any) => {
      const t = String((h && h.text) || "").slice(0, 1500);
      if (t) msgs.push({ role: h.role === "model" ? "assistant" : "user", content: t });
    });
    const content: any[] = images.map((i: any) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }));
    content.push({ type: "text", text: text || "What do you see in this photo, and what should I check or do?" });
    msgs.push({ role: "user", content });
    const models = images.length ? ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"] : ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    for (const m of models) {
      let r: Response;
      try {
        r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { Authorization: "Bearer " + groqKey, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ model: m, temperature: 0.3, messages: msgs, response_format: { type: "json_object" } }),
        });
      } catch { sawBusy = true; last = "groq slow"; continue; }
      const j = await r.json().catch(() => ({}));
      if (r.ok) return answer(j.choices?.[0]?.message?.content || "", "groq:" + m);
      last = "groq: " + (j.error?.message || r.status);
      if (r.status === 429 || r.status >= 500) sawBusy = true;
    }
    return null;
  };

  // OpenRouter: same OpenAI format; the model chosen in Settings, then OpenRouter's automatic pick.
  const viaOpenRouter = async (): Promise<Response | null> => {
    const msgs: any[] = [{ role: "system", content: system }];
    (Array.isArray(b.history) ? b.history : []).slice(-8).forEach((h: any) => {
      const t = String((h && h.text) || "").slice(0, 1500);
      if (t) msgs.push({ role: h.role === "model" ? "assistant" : "user", content: t });
    });
    const content: any[] = images.map((i: any) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }));
    content.push({ type: "text", text: text || "What do you see in this photo, and what should I check or do?" });
    msgs.push({ role: "user", content });
    const models = [...new Set([typeof ai.orModel === "string" && ai.orModel.trim(), "openrouter/auto"].filter(Boolean) as string[])];
    for (const m of (await orFreeModels(images.length > 0))) if (!models.includes(m)) models.push(m);   // free models as the last resort
    for (const m of models.slice(0, 6)) {
      let r: Response;
      try {
        r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers: { Authorization: "Bearer " + orKey, "Content-Type": "application/json", "HTTP-Referer": "https://abfmapps.github.io/abfm-training/", "X-Title": "ABFM Training" }, signal: AbortSignal.timeout(20000),
          body: JSON.stringify({ model: m, temperature: 0.3, messages: msgs }),
        });
      } catch { sawBusy = true; last = "openrouter slow"; continue; }
      const j = await r.json().catch(() => ({}));
      const t = j.choices?.[0]?.message?.content || "";
      if (r.ok && t) return answer(t, "openrouter:" + (j.model || m));
      last = "openrouter: " + (j.error?.message || r.status);
      if (r.status === 429 || r.status >= 500) sawBusy = true;
    }
    return null;
  };

  // Settings → AI "first": groq (default), openrouter or gemini. The others are backups, in that order.
  const all: Record<string, (() => Promise<Response | null>) | ""> = { groq: groqKey && viaGroq, openrouter: orKey && viaOpenRouter, gemini: key && viaGemini };
  const first = ["groq", "openrouter", "gemini"].includes(ai.first) ? ai.first : "groq";
  const names = [first, "groq", "openrouter", "gemini"].filter((n, i, a) => a.indexOf(n) === i && all[n]);
  const res = await new Promise<Response | null>((resolve) => {
    let next = 0, running = 0, done = false;
    const start = () => {
      if (done || next >= names.length) return;
      const name = names[next++], run = all[name] as () => Promise<Response | null>, t0 = Date.now(); running++;
      const timer = setTimeout(start, 7000);   // still thinking after 7 s: ask the next one too
      run().catch(() => null).then((r) => {
        running--; clearTimeout(timer);
        console.log(JSON.stringify({ ask: name, ok: !!r, ms: Date.now() - t0 }));
        if (done) return;
        if (r) { done = true; resolve(r); return; }
        start();
        if (!running && next >= names.length) { done = true; resolve(null); }
      });
    };
    start();
  });
  console.log(JSON.stringify({ askTotalMs: Date.now() - started, answered: !!res }));
  if (res) return res;
  return reply(sawBusy ? { ok: false, error: "busy" } : { ok: false, error: "error", detail: last });
});
