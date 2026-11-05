// Ask AI for staff: answers work questions (with up to 3 photos) using Gemini.
// The Gemini key stays here as a Supabase secret (GEMINI_API_KEY) — it is never in the app.
// Who may ask, and how often, is checked by the database function public.ai_allowed.
// Questions and photos are not saved anywhere.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
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

  const key = Deno.env.get("GEMINI_API_KEY") || "";
  if (!key) return reply({ ok: false, error: "off" });

  // Signed in (when sign-in is on), Ask AI turned on, and within the limits?
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
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

  let last = "", sawBusy = false;
  for (const m of MODELS) {
    let r: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body,
      });
      if (r.status !== 503 && r.status !== 500) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (!r) continue;
    if (r.status === 404) { last = "model"; continue; }
    if (r.status === 429 || r.status === 503 || r.status === 500) { sawBusy = true; last = m + " busy"; continue; }
    if (r.status !== 200) return reply({ ok: false, error: "error", detail: (await r.text()).slice(0, 200) });
    const j = await r.json();
    const raw = (((j.candidates || [])[0] || {}).content?.parts || []).map((p: any) => p.text || "").join("");
    let ans: any;
    try { ans = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch { ans = { answer: raw }; }
    const ids = new Set(catalog.map((x) => x.split(" | ")[0].trim()));
    return reply({
      ok: true, model: m, answer: String(ans.answer || raw || "").slice(0, 4000),
      videos: (Array.isArray(ans.videos) ? ans.videos : []).map(String).filter((id: string) => ids.has(id)).slice(0, 3),
    });
  }
  return reply(sawBusy ? { ok: false, error: "busy" } : { ok: false, error: "error", detail: last });
});
