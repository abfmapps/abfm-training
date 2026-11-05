// Auto-translates every video (title, summary, safety, steps, PPE) and the announcement banner
// into all app languages, and saves them inside data/videos.json and data/settings.json.
// Runs on GitHub Actions whenever the video list changes, and every morning.
// Translations you type yourself in the admin are never overwritten.
// If English text changes, auto-translations for that video are refreshed.
import { load, save, mergeFields } from "./store.mjs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../assets/drafter.js");
const { aiTranslate } = globalThis.ABDraft;
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "";
const LANG_NAMES = { hi: "Hindi", ur: "Urdu", ml: "Malayalam", bn: "Bengali", ta: "Tamil", ne: "Nepali", tl: "Filipino (Tagalog)", ar: "Arabic" };
let googleDown = 0, usedGemini = 0, lastError = "";

const LANGS = ["hi", "ur", "ml", "bn", "ta", "ne", "tl", "ar"];
const MAX_REQUESTS = Number(process.env.MAX_TRANSLATIONS || 900);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = Date.now(), TIME_BUDGET = 20 * 60 * 1000;   // stop after 20 min and save what's done; the next run continues
let requests = 0, failures = 0, hitLimit = false;

async function gtx(text, tl) {
  if (requests >= MAX_REQUESTS || Date.now() - START > TIME_BUDGET) { hitLimit = true; throw new Error("limit"); }
  requests++;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Mozilla/5.0" },
        body: "q=" + encodeURIComponent(text),
        signal: AbortSignal.timeout(15000)
      });
      if (r.status === 429) { await sleep(4000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return (j[0] || []).map(seg => seg[0] || "").join("");
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1500);
    }
  }
  throw new Error("rate limited");
}

// Translate a list of single-line strings in one request; fall back to one request per line if lines get merged.
async function googleLines(lines, tl) {
  const clean = lines.map(s => String(s || "").replace(/\s*\n\s*/g, " ").trim());
  const out = (await gtx(clean.join("\n"), tl)).split("\n").map(s => s.trim());
  if (out.length === clean.length) return out;
  const res = [];
  for (const line of clean) { res.push(line ? (await gtx(line, tl)).trim() : ""); await sleep(250); }
  return res;
}

// Google Translate first (free, fast). If it keeps failing — it sometimes blocks GitHub's servers — use Gemini instead.
async function translateLines(lines, tl) {
  if (googleDown < 3) {
    try { const t = await googleLines(lines, tl); googleDown = 0; return t; }
    catch (e) {
      if (e.message === "limit") throw e;
      googleDown++; lastError = "Google Translate: " + e.message;
      if (googleDown === 3) console.log("Google Translate isn't responding (" + e.message + ")" + (GEMINI_KEY ? " — switching to Gemini." : " and no GEMINI_API_KEY is set."));
      if (!GEMINI_KEY) throw e;
    }
  }
  if (!GEMINI_KEY) throw new Error(lastError || "No translation service available");
  if (Date.now() - START > TIME_BUDGET) throw new Error("limit");
  const clean = lines.map(s => String(s || "").replace(/\s*\n\s*/g, " ").trim());
  try {
    const t = await aiTranslate({ lines: clean, langName: LANG_NAMES[tl] || tl, key: GEMINI_KEY, model: GEMINI_MODEL });
    usedGemini++;
    await sleep(4000);                // stay inside Gemini's free-tier rate limit
    return t;
  } catch (e) { lastError = "Gemini: " + e.message; throw e; }
}

const hashOf = v => createHash("sha1").update(JSON.stringify([v.title, v.summary, v.safety, v.steps || [], v.ppe || []])).digest("hex").slice(0, 12);

async function translateVideos(doc) {
  let changed = 0;
  // Batch pass: videos whose only change is a new English title get just the title translated, many per request.
  for (const tl of LANGS) {
    const todo = doc.videos.filter(v => {
      const cur = v.tr && v.tr[tl];
      return cur && cur.auto && v.ytTitle && cur.src !== hashOf(v) && cur.src === hashOf({ ...v, title: v.ytTitle });
    });
    for (let i = 0; i < todo.length; i += 40) {
      const chunk = todo.slice(i, i + 40);
      try {
        const t = await translateLines(chunk.map(v => v.title), tl);
        chunk.forEach((v, k) => { if (t[k]) { v.tr[tl].title = t[k]; v.tr[tl].src = hashOf(v); changed++; } });
      } catch (e) { failures++; if (e.message === "limit") return changed; console.log(`  ! titles [${tl}]: ${e.message}`); }
      await sleep(300);
    }
  }
  for (const v of doc.videos) {
    const src = hashOf(v);
    v.tr = v.tr || {};
    for (const tl of LANGS) {
      const cur = v.tr[tl];
      const manual = cur && !cur.auto;
      if (manual) continue;                       // typed by the admin: keep
      if (cur && cur.src === src) continue;       // already up to date
      // Only the English title changed (renamed to a training title) — handled in one batch per language before this loop.
      if (cur && v.ytTitle && cur.src === hashOf({ ...v, title: v.ytTitle })) continue;
      const steps = v.steps || [], ppe = v.ppe || [];
      const lines = [v.title, v.summary || "", v.safety || "", ...steps, ...ppe];
      try {
        const t = await translateLines(lines, tl);
        let i = 0;
        const out = { auto: true, src, title: t[i++], summary: t[i++], safety: t[i++] };
        out.steps = steps.map(() => t[i++]);
        out.ppe = ppe.map(() => t[i++]);
        if (!out.summary) delete out.summary;
        if (!out.safety) delete out.safety;
        v.tr[tl] = out;
        changed++;
      } catch (e) {
        failures++;
        if (e.message === "limit") return changed;
        console.log(`  ! ${v.id} [${tl}]: ${e.message}`);
        if (failures >= 12 && !changed) { console.log("Translation service not reachable, stopping."); return changed; }
      }
      await sleep(300);
    }
    if (!Object.keys(v.tr).length) delete v.tr;
  }
  return changed;
}

// Quizzes are translated separately (kept in v.trq) so changing a quiz never re-translates the rest of the video.
const quizHash = q => createHash("sha1").update(JSON.stringify((q || []).map(x => [x.q, x.options]))).digest("hex").slice(0, 12);
async function translateQuizzes(doc) {
  let changed = 0;
  for (const v of doc.videos) {
    if (!v.quiz || !v.quiz.length) { if (v.trq) { delete v.trq; changed++; } continue; }
    const src = quizHash(v.quiz);
    v.trq = v.trq || {};
    for (const tl of LANGS) {
      if (v.trq[tl] && v.trq[tl].src === src) continue;
      const lines = v.quiz.flatMap(x => [x.q, ...x.options]);
      try {
        const t = await translateLines(lines, tl);
        let i = 0;
        v.trq[tl] = { src, items: v.quiz.map(x => ({ q: t[i++], options: x.options.map(() => t[i++]) })) };
        changed++;
      } catch (e) { failures++; if (e.message === "limit") return changed; console.log(`  ! quiz ${v.id} [${tl}]: ${e.message}`); }
      await sleep(300);
    }
  }
  return changed;
}

async function translateSettings(s) {
  const fields = ["announcement", "tagline"];
  const src = createHash("sha1").update(JSON.stringify(fields.map(f => s[f] || ""))).digest("hex").slice(0, 12);
  s.tr = s.tr || {};
  let changed = 0;
  for (const tl of LANGS) {
    if (s.tr[tl] && s.tr[tl].src === src) continue;
    try {
      const t = await translateLines(fields.map(f => s[f] || ""), tl);
      s.tr[tl] = { src, announcement: s.announcement ? t[0] : "", tagline: s.tagline ? t[1] : "" };
      changed++;
    } catch (e) { failures++; if (e.message === "limit") break; }
    await sleep(300);
  }
  return changed;
}

async function translatePaths(doc) {
  let changed = 0;
  for (const p of doc.paths || []) {
    const src = createHash("sha1").update(JSON.stringify([p.title, p.description || ""])).digest("hex").slice(0, 12);
    p.tr = p.tr || {};
    for (const tl of LANGS) {
      const cur = p.tr[tl];
      if (cur && (!cur.auto || cur.src === src)) continue;
      try {
        const t = await translateLines([p.title, p.description || ""], tl);
        p.tr[tl] = { auto: true, src, title: t[0], description: p.description ? t[1] : "" };
        changed++;
      } catch (e) { failures++; if (e.message === "limit") return changed; }
      await sleep(300);
    }
  }
  return changed;
}

async function translateTalks(doc) {
  let changed = 0;
  for (const k of doc.talks || []) {
    const pts = k.points || [];
    const src = createHash("sha1").update(JSON.stringify([k.title, pts, k.ask || ""])).digest("hex").slice(0, 12);
    k.tr = k.tr || {};
    for (const tl of LANGS) {
      const cur = k.tr[tl];
      if (cur && (!cur.auto || cur.src === src)) continue;
      try {
        const t = await translateLines([k.title, k.ask || "", ...pts], tl);
        k.tr[tl] = { auto: true, src, title: t[0], ask: k.ask ? t[1] : "", points: pts.map((_, i) => t[i + 2]) };
        changed++;
      } catch (e) { failures++; if (e.message === "limit") return changed; }
      await sleep(300);
    }
  }
  return changed;
}

const videos = await load("videos", { videos: [] }), settings = await load("settings", {});

let paths = null;
paths = await load("paths", null);

const nv = (await translateVideos(videos)) + (await translateQuizzes(videos));
const ns = await translateSettings(settings);
const np = paths ? await translatePaths(paths) : 0;
let talks = null;
talks = await load("toolbox", null);
const nt = talks ? await translateTalks(talks) : 0;
// If an admin saved meanwhile, only copy over the translations.
if (nt) await save("toolbox", talks, latest => { mergeFields(latest.talks, talks.talks, "id", ["tr"]); return latest; });
if (np) await save("paths", paths, latest => { mergeFields(latest.paths, paths.paths, "id", ["tr"]); return latest; });
if (nv) await save("videos", videos, latest => { mergeFields(latest.videos, videos.videos, "id", ["tr", "trq"]); return latest; });
if (ns) await save("settings", settings, latest => { latest.tr = settings.tr; return latest; });
if (lastError) console.log("Last error: " + lastError);
console.log(`Gemini handled ${usedGemini} translations.`);
console.log(`Translated ${nv} video/language pairs ${ns} settings languages and ${np} path and ${nt} toolbox-talk translations using ${requests} requests (${failures} failed).`);
if (failures && !nv && !ns && !np && !nt) process.exitCode = 1;
// Tell the workflow there is more to do, so it can start another run straight away.
if (hitLimit && process.env.GITHUB_OUTPUT) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_OUTPUT, "more=true\n");
  console.log("Time limit reached; the rest will be translated in the next run.");
}
