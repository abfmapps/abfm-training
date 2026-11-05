// Ask AI for staff: answers work questions (with up to 3 photos) using Gemini and/or Groq,
// as chosen in admin Settings → AI. The keys stay on the server — they are never in the app.
// Who may ask, and how often, is checked by the database function public.ai_allowed.
// Questions and photos are not saved anywhere.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
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
  // Settings → AI in the admin: which AI is on and which goes first.
  let ai: any = {};
  try {
    const r = await fetch(url + "/rest/v1/docs?name=eq.settings&select=content", { headers: { apikey: service, Authorization: "Bearer " + service } });
    ai = ((await r.json())[0]?.content?.ai) || {};
  } catch { /* defaults */ }
  const key = ai.gemini === false ? "" : (await shared("gemini")) || Deno.env.get("GEMINI_API_KEY") || "";
  const groqKey = ai.groq === false ? "" : (await shared("groq")) || Deno.env.get("GROQ_API_KEY") || Deno.env.get("Groq_API_KEY") || "";
  if (!key && !groqKey) return reply({ ok: false, error: "off" });

  // Signed in (when sign-in is on), Ask AI turned on, and within the limits?
  try {
    const r = await fetch(url + "/rest/v1/rpc/ai_allowed", {
      method: "POST", headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: String(b.token || ""), p_device: String(b.device || "") }),
    });
    const ok = await r.json();
    if (!ok || !ok.ok) return reply({ ok: false, error: (ok && ok.error) || "error" });
  } catch (e) { return reply({ ok: false, error: "error", detail: String(e).slice(0, 200) }); }

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

  const order = [key && viaGemini, groqKey && viaGroq].filter(Boolean) as (() => Promise<Response | null>)[];
  if (ai.first !== "gemini") order.reverse();   // default: Groq answers, Gemini is the backup
  for (const run of order) { const res = await run(); if (res) return res; }
  return reply(sawBusy ? { ok: false, error: "busy" } : { ok: false, error: "error", detail: last });
});
