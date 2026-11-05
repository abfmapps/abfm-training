/**
 * ABFM Training — private helper for the staff app. Keep this in a Google Sheet that only you can open.
 *  1. Staff sign-in: staff sign in with their HR number (list kept in the "Staff" tab of this sheet).
 *  2. Training records: every finished video, quiz, learning path and certificate, per HR number ("Records" tab).
 *  3. Certificates and supervisor sign-off ("Certificates" and "Supervisors" tabs).
 *  4. Usage counts: which videos are watched and which searches find nothing ("Stats" tab). Counts only, no names.
 *  5. Video requests: technicians send "Request a video"; requests land in the "Requests" tab.
 *  6. Ask AI: staff questions (and photos) are answered by Gemini. Your Gemini key stays here, private.
 *
 * Setup (about 5 minutes) — also shown in the admin portal, Requests tab:
 *  1. Create a new Google Sheet, then Extensions → Apps Script.
 *  2. Replace everything with this file and change ADMIN_KEY below to your own long password.
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *  4. Copy the Web app URL into the admin portal: Settings → Request inbox, with the same ADMIN_KEY.
 *  5. For "Ask AI": paste your Gemini key in GEMINI_KEY below, then tick "Show Ask AI to staff" in admin Settings.
 *  When you change this script later: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy
 *  (this keeps the same Web app URL).
 */
const ADMIN_KEY = "CHANGE-THIS-TO-A-LONG-PASSWORD";
const GEMINI_KEY = "";            // paste your Gemini API key between the quotes to turn on "Ask AI"
const AI_PER_HOUR = 300;          // safety limits so nobody can use up your free quota
const AI_PER_DAY = 2000;
const AI_PER_DEVICE_HOUR = 30;
const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const VERSION = 2;               // the admin portal checks this to know the script is up to date
const SHEET = "Requests";
const HEAD = ["id", "time", "topic", "category", "details", "name", "site", "lang", "status"];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function clip_(v, n) {
  let s = String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  if (/^[=+\-@]/.test(s)) s = "'" + s;          // stop spreadsheet formulas
  return s;
}
function keyOk_(k) { return ADMIN_KEY !== "CHANGE-THIS-TO-A-LONG-PASSWORD" && String(k || "") === ADMIN_KEY; }

/* Admin: list requests.  GET ?key=...   Also: ?ping=1 (version), ?verify=CODE (public certificate check),
   ?key=...&what=staff|records|stats|supervisors (admin) */
function doGet(e) {
  const p = e.parameter || {};
  if (p.ping) return json_({ ok: true, version: VERSION });
  if (p.verify) return json_(verify_(p.verify));
  if (!keyOk_(p.key)) return json_({ ok: false, error: "key" });
  if (p.what === "staff") return json_({ ok: true, staff: staffList_() });
  if (p.what === "records") return json_(recordsFor_(p));
  if (p.what === "stats") return json_(statsFor_(Number(p.days) || 30));
  if (p.what === "supervisors") return json_({ ok: true, supervisors: rows_(SUP_SHEET, SUP_HEAD).map(r => ({ name: r.name, active: r.active !== false && String(r.active).toLowerCase() !== "no", pin: r.pin ? "••••" : "" })) });
  const rows = sheet_().getDataRange().getValues();
  rows.shift();
  const list = rows.filter(r => r[0]).map(r => {
    const o = {}; HEAD.forEach((h, i) => o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]); return o;
  });
  return json_({ ok: true, requests: list.reverse() });
}

/* Technicians: send a request.  Admin: {key, action:"status"|"delete", id, status} */
function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad" }); }
  if (b.action === "ask") {
    try { return json_(ask_(b)); } catch (err) { return json_({ ok: false, error: "error", detail: String(err).slice(0, 200) }); }
  }
  const staffActions = { login: login_, me: me_, record: record_, signoff: signoff_, stats: stats_ };
  if (staffActions[b.action]) {
    try { return json_(staffActions[b.action](b)); } catch (err) { return json_({ ok: false, error: "error", detail: String(err).slice(0, 200) }); }
  }
  const adminActions = { "staff-save": staffSave_, "staff-remove": staffRemove_, "sup-save": supSave_, "sup-remove": supRemove_ };
  if (adminActions[b.action]) {
    if (!keyOk_(b.key)) return json_({ ok: false, error: "key" });
    const lk = LockService.getScriptLock(); lk.waitLock(20000);
    try { return json_(adminActions[b.action](b)); } catch (err) { return json_({ ok: false, error: "error", detail: String(err).slice(0, 200) }); }
    finally { lk.releaseLock(); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    if (b.action) {
      if (!keyOk_(b.key)) return json_({ ok: false, error: "key" });
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
      const row = ids.indexOf(String(b.id)) + 1;
      if (row < 2) return json_({ ok: false, error: "notfound" });
      if (b.action === "delete") sh.deleteRow(row);
      else sh.getRange(row, HEAD.indexOf("status") + 1).setValue(clip_(b.status, 20) || "new");
      return json_({ ok: true });
    }
    if (b.website) return json_({ ok: true });                    // spam trap
    const topic = clip_(b.topic, 200);
    if (!topic) return json_({ ok: false, error: "topic" });
    const cache = CacheService.getScriptCache();                  // simple flood protection
    const n = Number(cache.get("n") || 0);
    if (n > 40) return json_({ ok: false, error: "busy" });
    cache.put("n", String(n + 1), 60);
    if (sh.getLastRow() > 5000) return json_({ ok: false, error: "full" });
    sh.appendRow([Utilities.getUuid().slice(0, 8), new Date(), topic, clip_(b.category, 60), clip_(b.details, 1000),
      clip_(b.name, 80), clip_(b.site, 80), clip_(b.lang, 5), "new"]);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

/* ---------- Staff sign-in, training records, certificates, usage counts ---------- */
const STAFF_SHEET = "Staff", STAFF_HEAD = ["hr", "name", "site", "trade", "active"];
const REC_SHEET = "Records", REC_HEAD = ["time", "hr", "name", "site", "trade", "type", "item", "title", "score", "n", "pass", "code", "lang", "verified", "device"];
const CERT_SHEET = "Certificates", CERT_HEAD = ["code", "time", "hr", "name", "site", "trade", "path", "title", "score", "signedBy", "signedAt"];
const SUP_SHEET = "Supervisors", SUP_HEAD = ["name", "pin", "active"];
const STAT_SHEET = "Stats", STAT_HEAD = ["key", "day", "kind", "item", "count"];

function tab_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight("bold"); }
  return sh;
}
function rows_(name, head) {
  const sh = tab_(name, head), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, head.length).getValues().map((r, i) => {
    const o = { _row: i + 2 }; head.forEach((h, k) => o[h] = r[k] instanceof Date ? r[k].toISOString() : r[k]); return o;
  });
}
const normHr_ = h => String(h == null ? "" : h).toUpperCase().replace(/\s+/g, "").replace(/^'/, "").slice(0, 30);
const isActive_ = v => !(v === false || /^(no|n|false|0|inactive|left)$/i.test(String(v).trim()));
function staffMap_() {
  const c = CacheService.getScriptCache(), hit = c.get("staffmap");
  if (hit) return JSON.parse(hit);
  const m = {};
  rows_(STAFF_SHEET, STAFF_HEAD).forEach(r => { const hr = normHr_(r.hr); if (hr) m[hr] = { hr: hr, name: String(r.name || "").trim(), site: String(r.site || "").trim(), trade: String(r.trade || "").trim(), active: isActive_(r.active) }; });
  try { c.put("staffmap", JSON.stringify(m), 300); } catch (e) {}
  return m;
}
function staffList_() { const m = staffMap_(); return Object.keys(m).map(k => m[k]); }
function secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty("TOKEN_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("TOKEN_SECRET", s); }
  return s;
}
function sign_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_())).replace(/=+$/, "").slice(0, 22);
}
const tokenFor_ = hr => { const body = hr + "." + Date.now().toString(36); return body + "." + sign_(body); };
function staffFromToken_(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const body = parts[0] + "." + parts[1];
  if (sign_(body) !== parts[2]) return null;
  return staffMap_()[parts[0]] || { hr: parts[0], missing: true };
}
function progress_(hr) {
  const done = {}, quiz = {}, certs = [];
  rows_(REC_SHEET, REC_HEAD).forEach(r => {
    if (normHr_(r.hr) !== hr) return;
    const day = String(r.time).slice(0, 10);
    if (r.type === "video" && r.item) { if (!done[r.item] || day > done[r.item]) done[r.item] = day; }
    if (r.type === "quiz" && r.item) {
      const q = { score: Number(r.score) || 0, n: Number(r.n) || 0, pass: r.pass === true || String(r.pass).toLowerCase() === "true", at: day };
      const cur = quiz[r.item];
      if (!cur || (q.pass && !cur.pass) || (q.pass === cur.pass && q.at >= cur.at)) quiz[r.item] = q;
    }
  });
  rows_(CERT_SHEET, CERT_HEAD).forEach(c => {
    if (normHr_(c.hr) !== hr) return;
    certs.push({ code: c.code, path: c.path, title: c.title, at: String(c.time).slice(0, 10), name: c.name, hr: hr, site: c.site, trade: c.trade, score: c.score === "" ? null : Number(c.score), signedBy: c.signedBy || "", signedAt: c.signedAt ? String(c.signedAt).slice(0, 10) : "" });
  });
  return { done: Object.keys(done).map(k => [k, done[k]]), quiz: quiz, certs: certs };
}
function login_(b) {
  const dev = String(b.device || "x").replace(/[^\w-]/g, "").slice(0, 20);
  if (!count_("lg" + dev, 10, 600) || !count_("lgall", 400, 3600)) return { ok: false, error: "busy" };
  const hr = normHr_(b.hr);
  if (!hr) return { ok: false, error: "notfound" };
  const st = staffMap_()[hr];
  if (!st) return { ok: false, error: "notfound" };
  if (!st.active) return { ok: false, error: "inactive" };
  return { ok: true, token: tokenFor_(hr), staff: st, progress: progress_(hr) };
}
function me_(b) {
  const st = staffFromToken_(b.token);
  if (!st) return { ok: false, error: "token" };
  if (st.missing || !st.active) return { ok: false, error: "inactive" };
  return { ok: true, staff: st, progress: progress_(st.hr) };
}
function record_(b) {
  const dev = String(b.device || "x").replace(/[^\w-]/g, "").slice(0, 20);
  if (!count_("rc" + dev, 120, 3600)) return { ok: false, error: "busy" };
  const pr = b.profile || {};
  let who;
  if (pr.token) {
    const st = staffFromToken_(pr.token);
    if (!st) return { ok: false, error: "token" };
    if (st.missing || !st.active) return { ok: true, skipped: "inactive" };
    who = { hr: st.hr, name: st.name, site: st.site, trade: st.trade, verified: "yes" };
  } else {
    who = { hr: "", name: clip_(pr.name, 80), site: clip_(pr.site, 80), trade: clip_(pr.trade, 60), verified: "no" };
    if (!who.name) return { ok: false, error: "name" };
  }
  const types = { video: 1, quiz: 1, path: 1, cert: 1 };
  const evs = (Array.isArray(b.events) ? b.events : []).slice(0, 25).filter(e => e && types[e.type]);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = tab_(REC_SHEET, REC_HEAD);
    const rows = evs.map(e => {
      const t = Date.parse(e.time); const when = isNaN(t) || t > Date.now() + 864e5 ? new Date() : new Date(t);
      return [when, who.hr ? "'" + who.hr : "", who.name, who.site, who.trade, e.type, clip_(e.item, 80), clip_(e.title, 160),
        e.score === undefined || e.score === null ? "" : Number(e.score), e.n === undefined ? "" : Number(e.n), e.pass === undefined ? "" : !!e.pass,
        clip_(e.code, 12), clip_(e.lang, 5), who.verified, dev];
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, REC_HEAD.length).setValues(rows);
    const certs = evs.filter(e => e.type === "cert" && e.code);
    if (certs.length) {
      const cs = tab_(CERT_SHEET, CERT_HEAD), have = new Set(rows_(CERT_SHEET, CERT_HEAD).map(c => String(c.code)));
      certs.forEach(e => { if (!have.has(String(e.code))) cs.appendRow([clip_(e.code, 12), new Date(), who.hr ? "'" + who.hr : "", who.name, who.site, who.trade, clip_(e.item, 80), clip_(e.title, 160), e.score === null || e.score === undefined ? "" : Number(e.score), "", ""]); });
    }
  } finally { lock.releaseLock(); }
  return { ok: true, saved: evs.length };
}
function signoff_(b) {
  const dev = String(b.device || "x").replace(/[^\w-]/g, "").slice(0, 20);
  if (!count_("sg" + dev, 6, 900)) return { ok: false, error: "busy" };
  const pin = String(b.pin || "").trim();
  const sup = rows_(SUP_SHEET, SUP_HEAD).find(s => pin && String(s.pin).trim() === pin && isActive_(s.active));
  if (!sup) return { ok: false, error: "pin" };
  const code = clip_(b.code, 12);
  if (!code) return { ok: false, error: "code" };
  const pr = b.profile || {};
  const st = pr.token ? staffFromToken_(pr.token) : null;
  const who = st && !st.missing ? st : { hr: "", name: clip_(b.name || pr.name, 80), site: clip_(pr.site, 80), trade: clip_(pr.trade, 60) };
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const cs = tab_(CERT_SHEET, CERT_HEAD), row = rows_(CERT_SHEET, CERT_HEAD).find(c => String(c.code) === code);
    if (row) cs.getRange(row._row, CERT_HEAD.indexOf("signedBy") + 1, 1, 2).setValues([[String(sup.name), new Date()]]);
    else cs.appendRow([code, new Date(), who.hr ? "'" + who.hr : "", who.name, who.site, who.trade, clip_(b.path, 80), clip_(b.title, 160), b.score === null || b.score === undefined ? "" : Number(b.score), String(sup.name), new Date()]);
    tab_(REC_SHEET, REC_HEAD).appendRow([new Date(), who.hr ? "'" + who.hr : "", who.name, who.site, who.trade, "signoff", clip_(b.path, 80), clip_(b.title, 160), "", "", "", code, "", st ? "yes" : "no", dev]);
  } finally { lock.releaseLock(); }
  return { ok: true, supervisor: String(sup.name) };
}
function verify_(code) {
  if (!count_("vf", 300, 3600)) return { ok: false, error: "busy" };
  code = String(code || "").toUpperCase().trim().slice(0, 12);
  const c = rows_(CERT_SHEET, CERT_HEAD).find(x => String(x.code).toUpperCase() === code);
  if (!c) return { ok: false, error: "notfound" };
  const hr = normHr_(c.hr);
  return { ok: true, cert: { name: c.name, hr: hr ? "•••" + hr.slice(-3) : "", title: c.title, at: String(c.time).slice(0, 10), score: c.score, signedBy: c.signedBy || "" } };
}
function stats_(b) {
  if (!count_("stall", 1500, 3600)) return { ok: false, error: "busy" };
  const kinds = { view: 1, nores: 1 };
  const evs = (Array.isArray(b.events) ? b.events : []).slice(0, 100).filter(e => e && kinds[e.kind] && e.key);
  if (!evs.length) return { ok: true };
  const day = Utilities.formatDate(new Date(), "Asia/Dubai", "yyyy-MM-dd");
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = tab_(STAT_SHEET, STAT_HEAD), last = sh.getLastRow(), from = Math.max(2, last - 3000);
    const keys = last >= 2 ? sh.getRange(from, 1, last - from + 1, 1).getValues().map(r => String(r[0])) : [];
    const add = [];
    evs.forEach(e => {
      const item = clip_(String(e.key).toLowerCase(), 80), k = day + "|" + e.kind + "|" + item, n = Math.max(1, Math.min(50, Number(e.n) || 1));
      const i = keys.lastIndexOf(k);
      if (i >= 0) { const cell = sh.getRange(from + i, 5); cell.setValue((Number(cell.getValue()) || 0) + n); }
      else { const j = add.findIndex(r => r[0] === k); if (j >= 0) add[j][4] += n; else add.push([k, day, e.kind, item, n]); }
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, STAT_HEAD.length).setValues(add);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
/* Admin reads */
function recordsFor_(p) {
  const days = Number(p.days) || 0, since = days ? new Date(Date.now() - days * 864e5).toISOString() : "";
  const recs = rows_(REC_SHEET, REC_HEAD).filter(r => !since || String(r.time) >= since).slice(-20000)
    .map(r => [String(r.time), normHr_(r.hr), r.name, r.site, r.trade, r.type, r.item, r.title, r.score, r.n, r.pass, r.code, r.verified]);
  const certs = rows_(CERT_SHEET, CERT_HEAD).map(c => ({ code: c.code, time: c.time, hr: normHr_(c.hr), name: c.name, site: c.site, trade: c.trade, path: c.path, title: c.title, score: c.score, signedBy: c.signedBy, signedAt: c.signedAt }));
  return { ok: true, records: recs, certs: certs, staff: staffList_() };
}
function statsFor_(days) {
  const since = Utilities.formatDate(new Date(Date.now() - days * 864e5), "Asia/Dubai", "yyyy-MM-dd");
  const out = {};
  rows_(STAT_SHEET, STAT_HEAD).forEach(r => {
    const d = String(r.day).slice(0, 10); if (d < since) return;
    const k = r.kind + "|" + r.item; out[k] = (out[k] || 0) + (Number(r.count) || 0);
  });
  return { ok: true, days: days, counts: Object.keys(out).map(k => { const i = k.indexOf("|"); return { kind: k.slice(0, i), key: k.slice(i + 1), n: out[k] }; }) };
}
/* Admin writes */
function staffSave_(b) {
  const list = (Array.isArray(b.staff) ? b.staff : []).slice(0, 5000);
  const sh = tab_(STAFF_SHEET, STAFF_HEAD), cur = rows_(STAFF_SHEET, STAFF_HEAD), at = {};
  cur.forEach(r => at[normHr_(r.hr)] = r._row);
  let added = 0, updated = 0;
  const newRows = [];
  list.forEach(x => {
    const hr = normHr_(x.hr); if (!hr) return;
    const row = ["'" + hr, clip_(x.name, 80), clip_(x.site, 80), clip_(x.trade, 60), x.active === false ? "no" : "yes"];
    if (at[hr]) { sh.getRange(at[hr], 1, 1, row.length).setValues([row]); updated++; }
    else { newRows.push(row); at[hr] = -1; added++; }
  });
  if (newRows.length) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, STAFF_HEAD.length).setValues(newRows);
  CacheService.getScriptCache().remove("staffmap");
  return { ok: true, added: added, updated: updated };
}
function staffRemove_(b) {
  const hr = normHr_(b.hr), row = rows_(STAFF_SHEET, STAFF_HEAD).find(r => normHr_(r.hr) === hr);
  if (!row) return { ok: false, error: "notfound" };
  tab_(STAFF_SHEET, STAFF_HEAD).deleteRow(row._row);
  CacheService.getScriptCache().remove("staffmap");
  return { ok: true };
}
function supSave_(b) {
  const name = clip_(b.name, 80), pin = String(b.pin || "").replace(/\D/g, "").slice(0, 12);
  if (!name || pin.length < 4) return { ok: false, error: "pin" };
  const all = rows_(SUP_SHEET, SUP_HEAD);
  if (all.some(s => String(s.pin) === pin && String(s.name) !== name)) return { ok: false, error: "pinused" };
  const sh = tab_(SUP_SHEET, SUP_HEAD), row = all.find(s => String(s.name) === name);
  if (row) sh.getRange(row._row, 1, 1, 3).setValues([[name, "'" + pin, "yes"]]); else sh.appendRow([name, "'" + pin, "yes"]);
  return { ok: true };
}
function supRemove_(b) {
  const row = rows_(SUP_SHEET, SUP_HEAD).find(s => String(s.name) === String(b.name));
  if (!row) return { ok: false, error: "notfound" };
  tab_(SUP_SHEET, SUP_HEAD).deleteRow(row._row);
  return { ok: true };
}

/* ---------- Ask AI ---------- */
function count_(key, limit, seconds) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(key) || 0);
  if (n >= limit) return false;
  c.put(key, String(n + 1), seconds);
  return true;
}
function dayCount_(limit) {
  const p = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), "Asia/Dubai", "yyyy-MM-dd");
  const lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    const cur = JSON.parse(p.getProperty("aiDay") || "{}");
    const n = cur.day === day ? cur.n : 0;
    if (n >= limit) return false;
    p.setProperty("aiDay", JSON.stringify({ day: day, n: n + 1 }));
    return true;
  } finally { lock.releaseLock(); }
}
function ask_(b) {
  const key = GEMINI_KEY || PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
  if (!key) return { ok: false, error: "off" };
  const hour = Utilities.formatDate(new Date(), "UTC", "yyyyMMddHH");
  const dev = String(b.device || "x").replace(/[^\w-]/g, "").slice(0, 20);
  if (!count_("aih" + hour, AI_PER_HOUR, 3700) || !count_("aid" + dev + hour, AI_PER_DEVICE_HOUR, 3700) || !dayCount_(AI_PER_DAY)) return { ok: false, error: "busy" };

  const text = String(b.text || "").slice(0, 1500);
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 3)
    .filter(i => i && /^image\/(jpeg|png|webp)$/.test(i.mime) && typeof i.data === "string" && i.data.length < 2000000);
  if (!text && !images.length) return { ok: false, error: "empty" };
  const catalog = (Array.isArray(b.catalog) ? b.catalog : []).slice(0, 300).map(x => String(x).slice(0, 200));
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

  const contents = [];
  (Array.isArray(b.history) ? b.history : []).slice(-8).forEach(h => {
    const t = String(h && h.text || "").slice(0, 1500);
    if (t) contents.push({ role: h.role === "model" ? "model" : "user", parts: [{ text: t }] });
  });
  const parts = images.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } }));
  parts.push({ text: text || "What do you see in this photo, and what should I check or do?" });
  contents.push({ role: "user", parts: parts });
  const body = { system_instruction: { parts: [{ text: system }] }, contents: contents,
    generationConfig: { temperature: 0.3, responseMimeType: "application/json" } };

  let last = "", sawBusy = false;
  for (const m of MODELS) {
    let r, code;
    for (let attempt = 0; attempt < 2; attempt++) {          // one quick retry if Google is overloaded
      r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "post", contentType: "application/json", headers: { "x-goog-api-key": key },
        payload: JSON.stringify(body), muteHttpExceptions: true
      });
      code = r.getResponseCode();
      if (code !== 503 && code !== 500) break;
      Utilities.sleep(1500);
    }
    if (code === 404) { last = "model"; continue; }
    if (code === 429 || code === 503 || code === 500) { sawBusy = true; last = m + " busy"; continue; }   // try the next model
    if (code !== 200) return { ok: false, error: "error", detail: r.getContentText().slice(0, 200) };
    const j = JSON.parse(r.getContentText());
    const out = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const raw = out.map(p => p.text || "").join("");
    let ans;
    try { ans = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch (err) { ans = { answer: raw }; }
    const ids = new Set(catalog.map(x => x.split(" | ")[0].trim()));
    return { ok: true, model: m, answer: String(ans.answer || raw || "").slice(0, 4000),
      videos: (Array.isArray(ans.videos) ? ans.videos : []).map(String).filter(id => ids.has(id)).slice(0, 3) };
  }
  return sawBusy ? { ok: false, error: "busy" } : { ok: false, error: "error", detail: last };
}

/* Run this once from the editor (choose "authorize" at the top, then ▶ Run) to give the script
   permission to contact Gemini. Google shows an "Authorization required" window — allow it. */
function authorize() {
  UrlFetchApp.fetch("https://generativelanguage.googleapis.com/", { muteHttpExceptions: true });
  SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Done — the script can now reach Gemini.");
}
