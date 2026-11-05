// Daily video finder. Runs on GitHub Actions (see .github/workflows/find-videos.yml).
// 1. Checks each trusted channel's YouTube feed for new uploads and adds them to data/pending.json (the review queue).
// 2. Once a week, checks every published video still exists and can be played inside the app (data/health.json).
// Nothing is published automatically: the admin approves each video.
// No API key needed. Node 20+.
import { readFile, writeFile } from "node:fs/promises";

const DATA = new URL("../data/", import.meta.url);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function load(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), "utf8")); } catch { return fallback; }
}
async function save(name, obj, before) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  if (text === before) return false;
  await writeFile(new URL(name, DATA), text);
  return true;
}
async function get(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
      return { status: r.status, text: r.ok ? await r.text() : "" };
    } catch (e) {
      if (i === tries - 1) return { status: 0, text: "", error: e.message };
      await sleep(1500);
    }
  }
}
const decode = s => (s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&").trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };
const fmtDur = s => { s = +s || 0; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

async function resolveChannelId(url) {
  const direct = url.match(/\/channel\/(UC[\w-]{22})/);
  if (direct) return direct[1];
  const { status, text } = await get(url.replace(/\/$/, "") + "/about");
  if (!text) throw new Error(status === 404 ? "Channel page not found (404). Check the link." : `Could not open channel page (${status || "network error"}).`);
  const m = text.match(/"externalId":"(UC[\w-]{22})"/) || text.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) ||
            text.match(/"browseId":"(UC[\w-]{22})"/) || text.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
  if (!m) throw new Error("Opened the channel page but couldn't find its ID.");
  return m[1];
}

async function readFeed(channelId) {
  const { status, text } = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!text) throw new Error(`Feed not available (${status || "network error"}).`);
  return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    yt: tag(e, "yt:videoId"),
    title: tag(e, "title"),
    published: tag(e, "published"),
    link: (e.match(/<link[^>]+href="([^"]+)"/) || [])[1] || "",
    description: tag(e, "media:description").slice(0, 3000),
    author: tag(tag(e, "author"), "name") || (e.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || ""
  })).filter(x => x.yt);
}

/* Backup when YouTube's feeds are down (it happens a few times a year): read the channel's Videos page instead. */
function relDate(t) {
  const m = String(t || "").match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return "";
  const ms = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[m[2].toLowerCase()];
  return new Date(Date.now() - (+m[1]) * ms).toISOString();
}
function initialData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) || html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
const textOf = x => !x ? "" : typeof x === "string" ? x : x.simpleText || x.content || (x.runs || []).map(r => r.text).join("") || "";
function collectVideos(node, out, seen) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => collectVideos(n, out, seen)); return; }
  const vr = node.videoRenderer || node.gridVideoRenderer;
  if (vr && vr.videoId && !seen.has(vr.videoId)) {
    seen.add(vr.videoId);
    out.push({ yt: vr.videoId, title: textOf(vr.title), published: relDate(textOf(vr.publishedTimeText)), length: textOf(vr.lengthText),
      live: !!(vr.badges || []).some(b => /LIVE/.test(JSON.stringify(b))) || /watching/i.test(textOf(vr.viewCountText)),
      description: textOf(vr.descriptionSnippet) });
  }
  const lv = node.lockupViewModel;
  if (lv && lv.contentId && /VIDEO/.test(lv.contentType || "VIDEO") && !seen.has(lv.contentId)) {
    const md = (((lv.metadata || {}).lockupMetadataViewModel) || {});
    const rows = JSON.stringify(md.metadata || {});
    seen.add(lv.contentId);
    out.push({ yt: lv.contentId, title: textOf(md.title), published: relDate((rows.match(/\d+\s+\w+\s+ago/) || [])[0]), length: "", live: false, description: "" });
  }
  for (const k in node) if (k !== "videoRenderer" && k !== "lockupViewModel") collectVideos(node[k], out, seen);
}
async function readChannelPage(channelId) {
  const { status, text } = await get(`https://www.youtube.com/channel/${channelId}/videos`);
  if (!text) throw new Error(`Channel page not available (${status || "network error"}).`);
  const data = initialData(text);
  if (!data) throw new Error("Couldn't read the channel page.");
  const out = []; collectVideos(data, out, new Set());
  return out.filter(v => v.yt && v.title).slice(0, 20).map(v => ({
    yt: v.yt, title: v.title, published: v.published || new Date().toISOString(), link: "https://www.youtube.com/watch?v=" + v.yt,
    description: v.description, author: "", live: v.live, fromPage: true
  }));
}

/* Ask YouTube's own player API for a video's length (works when the watch page is blocked for servers). */
async function playerLength(yt) {
  for (const client of [{ clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20241009.01.00" }, { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30 }]) {
    try {
      const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: yt, context: { client: { hl: "en", gl: "US", ...client } } })
      });
      if (!r.ok) continue;
      const j = await r.json();
      const s = +((j.videoDetails || {}).lengthSeconds || 0);
      if (s > 0) return s;
    } catch {}
  }
  return null;
}
async function videoInfo(yt) {
  const { text } = await get(`https://www.youtube.com/watch?v=${yt}`);
  let len = (text.match(/"lengthSeconds":"(\d+)"/) || [])[1];
  if (!len) { const s = await playerLength(yt); if (s) len = String(s); }
  const live = /"isLiveContent":true/.test(text) && /"isLive":true/.test(text);
  let description = "";
  const d = text.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (d) { try { description = JSON.parse('"' + d[1] + '"'); } catch {} }
  return { seconds: len ? +len : null, live, description };
}

function guessCategory(text, categories) {
  const t = " " + text.toLowerCase() + " ";
  let best = "", score = 0;
  for (const c of categories || []) {
    const s = (c.keywords || []).reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
    if (s > score) { score = s; best = c.name; }
  }
  return best;
}

async function findNew({ videosDoc, settings, channelsDoc, pending }) {
  const known = new Set([
    ...videosDoc.videos.map(v => v.yt),
    ...(pending.queue || []).map(q => q.yt),
    ...(pending.rejected || [])
  ]);
  const exclude = (settings.excludeKeywords || []).map(k => k.toLowerCase());
  const lookback = (channelsDoc.lookbackDays || 21) * 864e5;
  const skipShorts = channelsDoc.skipShorts !== false;
  pending.channelStatus = pending.channelStatus || {};
  const found = [];

  for (const ch of channelsDoc.channels || []) {
    if (ch.active === false) continue;
    const st = pending.channelStatus[ch.url] || {};
    try {
      const id = st.id || await resolveChannelId(ch.url);
      let items, via = "feed";
      try { items = await readFeed(id); }
      catch (feedErr) {
        try { items = await readChannelPage(id); via = "page"; log(`  (feed down for ${ch.name} — read the channel page instead)`); }
        catch (pageErr) { throw new Error(feedErr.message + " Backup also failed: " + pageErr.message); }
      }
      let added = 0;
      for (const it of items) {
        if (known.has(it.yt)) continue;
        if (Date.now() - new Date(it.published).getTime() > lookback) continue;
        const lower = it.title.toLowerCase();
        if (exclude.some(k => lower.includes(k))) continue;
        if (skipShorts && it.link.includes("/shorts/")) continue;
        const info = await videoInfo(it.yt);
        await sleep(400);
        if (info.live || it.live) continue;
        if (!it.description && info.description) it.description = info.description.slice(0, 3000);
        if (skipShorts && info.seconds !== null && info.seconds <= 60) continue;
        known.add(it.yt);
        found.push({
          yt: it.yt, title: it.title, channel: ch.name || it.author, channelUrl: ch.url,
          published: it.published, duration: info.seconds ? fmtDur(info.seconds) : "",
          channelCategory: ch.category || "",
          suggestedCategory: ch.category || guessCategory(it.title + " " + it.description.slice(0, 300), settings.categories),
          description: it.description, found: new Date().toISOString()
        });
        added++;
      }
      pending.channelStatus[ch.url] = { id, checked: new Date().toISOString(), lastFound: added, ...(via === "page" ? { via } : {}) };
      log(`✓ ${ch.name}: ${items.length} in feed, ${added} new`);
    } catch (e) {
      pending.channelStatus[ch.url] = { ...st, error: e.message, checked: new Date().toISOString() };
      log(`✗ ${ch.name}: ${e.message}`);
    }
    await sleep(700);
  }
  // keep status only for channels that still exist
  const urls = new Set((channelsDoc.channels || []).map(c => c.url));
  for (const k of Object.keys(pending.channelStatus)) if (!urls.has(k)) delete pending.channelStatus[k];

  pending.queue = [...found, ...(pending.queue || [])]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, channelsDoc.maxQueue || 150);
  pending.lastRun = new Date().toISOString();
  log(`Queue now has ${pending.queue.length} videos (${found.length} new today).`);
}

async function checkHealth({ videosDoc, health }) {
  const due = process.env.FORCE_HEALTH === "1" || !health.checked || Date.now() - new Date(health.checked).getTime() > 6.5 * 864e5;
  if (!due) { log("Health check not due yet."); return 0; }
  const problems = [];
  let filled = 0;
  for (const v of videosDoc.videos) {
    const { status } = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + v.yt)}`, 1);
    if (status === 404 || status === 400) problems.push({ yt: v.yt, id: v.id, title: v.title, status: "notfound" });
    else if (status === 401 || status === 403) problems.push({ yt: v.yt, id: v.id, title: v.title, status: "noembed" });
    if (!v.duration && status === 200) {
      const info = await videoInfo(v.yt);
      if (info.seconds) { v.duration = fmtDur(info.seconds); filled++; }
    }
    await sleep(300);
  }
  health.checked = new Date().toISOString();
  health.problems = problems;
  log(`Health check: ${videosDoc.videos.length} videos, ${problems.length} problems, ${filled} lengths filled in.`);
  return filled;
}

const raw = {};
for (const f of ["videos.json", "settings.json", "channels.json", "pending.json", "health.json"]) {
  try { raw[f] = await readFile(new URL(f, DATA), "utf8"); } catch { raw[f] = ""; }
}
const ctx = {
  videosDoc: await load("videos.json", { videos: [] }),
  settings: await load("settings.json", { categories: [] }),
  channelsDoc: await load("channels.json", { channels: [] }),
  pending: await load("pending.json", { queue: [], rejected: [], channelStatus: {} }),
  health: await load("health.json", { problems: [] })
};
await findNew(ctx);
let filled = await checkHealth(ctx);
// Every day: fill in a few missing lengths (the weekly health check does all of them).
{
  let n = 0;
  for (const v of ctx.videosDoc.videos) {
    if (v.duration || n >= 40) continue;
    n++;
    const info = await videoInfo(v.yt);
    if (info.seconds) { v.duration = fmtDur(info.seconds); filled++; }
    await sleep(300);
  }
  if (n) log(`Lengths: tried ${n} videos without a length, filled ${filled}.`);
}
const changed = [
  await save("pending.json", ctx.pending, raw["pending.json"]),
  await save("health.json", ctx.health, raw["health.json"]),
  filled ? await save("videos.json", ctx.videosDoc, raw["videos.json"]) : false
];
log(changed.some(Boolean) ? "Files updated." : "No changes.");
