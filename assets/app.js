/* Al Bonian FM — public training library */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LANGS = window.AB_LANGS, TEXT = window.AB_TEXT;
  const LEVELS = ["Beginner", "Intermediate", "Advanced"];
  const PAGE = 24;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  const state = {
    videos: [], settings: { categories: [], newDays: 7 }, updated: "",
    lang: store.get("ab_lang", null),
    saved: new Set(store.get("ab_saved", [])),
    tab: "library", cat: "ALL", level: "ALL", sort: "new", q: "", limit: PAGE,
    listScroll: 0, showEn: false,
    paths: [], done: new Set(store.get("ab_done", [])), talks: [],
    doneAt: store.get("ab_done_at", {}),        // video id → date it was last finished (for safety refreshers)
    watch: store.get("ab_watch", {}),           // video id → {t: seconds watched up to, d: length, at: when}
    quiz: store.get("ab_quiz", {}),             // video id → {score, n, pass, at}
    profile: store.get("ab_profile", {}),       // {name, staffId, site, trade} — only on this phone
    certs: store.get("ab_certs", []),           // certificates earned on this phone
    speed: store.get("ab_speed", 1),
    assignments: []
  };
  // Videos finished before dates were kept: count them as finished today.
  (() => { let ch = false; state.done.forEach(id => { if (!state.doneAt[id]) { state.doneAt[id] = new Date().toISOString().slice(0, 10); ch = true; } }); if (ch) store.set("ab_done_at", state.doneAt); })();

  /* ---------- helpers ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function t(key, vars) {
    let s = (TEXT[state.lang] && TEXT[state.lang][key]) || TEXT.en[key] || key;
    if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    return s;
  }
  const catLabel = c => (TEXT[state.lang] && TEXT[state.lang].cats && TEXT[state.lang].cats[c]) || c;
  /* Line icon and tint per trade (assets/trades.js picks them from the category name). */
  const tradeOf = c => [null, window.ABTrades.paths(c), window.ABTrades.color(c)];
  const svg = (paths, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const catIcon = c => svg(tradeOf(c)[1], 16);
  const catTone = c => { const col = tradeOf(c)[2]; return `color:${col};background:color-mix(in srgb, ${col} 13%, var(--surface))`; };
  const tradeIco = (c, size = 21) => `<span class="ti" style="${catTone(c)}">${svg(tradeOf(c)[1], size)}</span>`;
  const durSec = d => (d || "").split(":").reduce((a, n) => a * 60 + (+n || 0), 0);
  const daysSince = d => (Date.now() - new Date(d + "T00:00:00").getTime()) / 864e5;
  const isNew = v => v.added && daysSince(v.added) <= (state.settings.newDays || 7);
  const tr = v => (!state.showEn && v.tr && v.tr[state.lang]) || {};
  const titleOf = v => tr(v).title || v.title;
  const pTr = p => (!state.showEn && p.tr && p.tr[state.lang]) || {};
  const byId = id => state.videos.find(x => x.id === id);
  const pathVideos = p => p.videos.map(byId).filter(Boolean);
  function setDone(id, on) {
    const was = state.done.has(id);
    on ? state.done.add(id) : state.done.delete(id);
    if (on) state.doneAt[id] = new Date().toISOString().slice(0, 10); else delete state.doneAt[id];
    if (on) delete state.watch[id];
    store.set("ab_done", [...state.done]); store.set("ab_done_at", state.doneAt); store.set("ab_watch", state.watch);
    if (on && !was) { const v = byId(id); if (v) record("video", { item: id, title: v.title }); checkPaths(); }
  }
  /* ---------- safety refreshers ---------- */
  const refMonths = () => { const m = state.settings.refresherMonths; return m === undefined || m === null || m === "" ? 12 : +m || 0; };
  const monthsSince = d => d ? (Date.now() - Date.parse(d + "T00:00:00")) / (864e5 * 30.44) : 0;
  const refresherDue = v => !!(v && v.essential && refMonths() && state.done.has(v.id) && monthsSince(state.doneAt[v.id]) >= refMonths());
  const dueRefreshers = () => state.videos.filter(refresherDue);
  /* ---------- watching progress ---------- */
  const watchPct = v => { const w = state.watch[v.id]; return w && w.d ? Math.min(1, w.t / w.d) : 0; };
  const inProgress = () => state.videos.filter(v => !state.done.has(v.id) && state.watch[v.id] && state.watch[v.id].t >= 15 && watchPct(v) < 0.9)
    .sort((a, b) => (state.watch[b.id].at || "").localeCompare(state.watch[a.id].at || ""));
  function saveWatch(id, t, d) {
    state.watch[id] = { t: Math.round(t), d: Math.round(d || 0), at: new Date().toISOString() };
    const ids = Object.keys(state.watch).sort((a, b) => (state.watch[b].at || "").localeCompare(state.watch[a].at || ""));
    ids.slice(30).forEach(k => delete state.watch[k]);
    store.set("ab_watch", state.watch);
  }
  /* ---------- quizzes ---------- */
  const hasQuiz = v => !!(v && v.quiz && v.quiz.length);
  const quizPassed = v => !hasQuiz(v) || !!(state.quiz[v.id] && state.quiz[v.id].pass);
  const passMark = () => Math.min(100, Math.max(1, +state.settings.quizPass || 67));
  function quizOf(v) {
    const x = !state.showEn && v.trq && v.trq[state.lang];
    const items = x && x.items && x.items.length === v.quiz.length && x.items.every((it, i) => it.options && it.options.length === v.quiz[i].options.length) ? x.items : null;
    return v.quiz.map((it, i) => ({ q: items ? items[i].q : it.q, options: items ? items[i].options : it.options, answer: it.answer, tr: !!items }));
  }
  const fmtDate = d => { try { return new Date(d + "T00:00:00").toLocaleDateString(state.lang === "en" ? "en-GB" : state.lang, { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };
  const link = v => location.href.split("#")[0] + "#/v/" + encodeURIComponent(v.id);
  const thumb = (yt, size = "mqdefault") => `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/${size}.jpg`;

  let toastTimer;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200); }

  const ICON = {
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    bookmarkOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    yt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
    back: '<svg class="flip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h8M8 3v2c0 4-2 7-5 8M6 9c1 2 3 4 6 5M13 21l4-9 4 9M14.5 18h5"/></svg>',
    next: '<svg class="flip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    search: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 10h16"/></svg>',
    award: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    redo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    brain: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01"/></svg>',
    printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h6l11-11-6-6L3 15z"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.7M12 20h.01"/></svg>',
    megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8"/></svg>',
    request: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/></svg>'
  };

  /* ---------- language ---------- */
  function applyLang() {
    const meta = LANGS.find(l => l.code === state.lang) || LANGS[0];
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.dir;
    $("#lang-label").textContent = meta.code === "en" ? "EN" : meta.name;
    $$("[data-t]").forEach(el => { el.textContent = t(el.dataset.t); });
    $("#q").placeholder = t("search");
    $("#q").setAttribute("aria-label", t("search"));
    renderLangList();
    if (state.videos.length) applySettings();
  }
  function renderLangList() {
    $("#lang-list").innerHTML = LANGS.map(l =>
      `<button lang="${l.code}" dir="${l.dir}" data-lang="${l.code}" aria-pressed="${l.code === state.lang}">${esc(l.name)}</button>`).join("");
  }
  function openSheet(id) { const s = $(id); s.hidden = false; const f = s.querySelector("button"); f && f.focus(); }
  function closeSheets() { $$(".sheet").forEach(s => s.hidden = true); }

  /* ---------- Supabase (content, sign-in, training records, usage counts) ---------- */
  const SB = window.AB_CONFIG || {};
  const backend = () => !!SB.url;
  const deviceId = (() => { let d = store.get("ab_dev", ""); if (!d) { d = Math.random().toString(36).slice(2, 12); store.set("ab_dev", d); } return d; })();
  async function rpc(fn, args, opts = {}) {
    const r = await fetch(SB.url + "/rest/v1/rpc/" + fn, {
      method: "POST", headers: { apikey: SB.anonKey, Authorization: "Bearer " + SB.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}), cache: "no-store", ...opts
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  /* Staff sign-in with an HR number (turned on in admin → Settings → Staff & training). */
  const loginOn = () => !!state.settings.staffLogin;
  const loggedIn = () => !!state.profile.token;
  const loginNeeded = () => loginOn() && !loggedIn();
  // With sign-in on, every staff member's progress is recorded. Without it, only if the admin turned records on and the person typed a name.
  const recordsOn = () => !!backend() && loggedIn();
  const profileOut = () => ({ token: state.profile.token || "", hr: state.profile.hr || "", name: state.profile.name || "", site: state.profile.site || "", trade: state.profile.trade || "" });
  function setProfile(p) { state.profile = p || {}; store.set("ab_profile", state.profile); }
  /* Bring progress saved on the server back to this phone (new phone, cleared browser). */
  function mergeProgress(pg) {
    if (!pg) return;
    (pg.done || []).forEach(([id, date]) => {
      if (!byId(id) && state.videos.length) return;
      state.done.add(id);
      if (!state.doneAt[id] || (date && date > state.doneAt[id])) state.doneAt[id] = date || state.doneAt[id] || new Date().toISOString().slice(0, 10);
    });
    Object.entries(pg.quiz || {}).forEach(([id, q]) => { const cur = state.quiz[id]; if (!cur || (q.pass && !cur.pass) || (q.at > (cur.at || "") && q.pass === cur.pass)) state.quiz[id] = q; });
    (pg.certs || []).forEach(c => { const i = state.certs.findIndex(x => x.code === c.code); if (i < 0) state.certs.push(c); else state.certs[i] = Object.assign({}, state.certs[i], c); });
    store.set("ab_done", [...state.done]); store.set("ab_done_at", state.doneAt); store.set("ab_quiz", state.quiz); store.set("ab_certs", state.certs);
  }
  async function signIn(hr) {
    const j = await rpc("staff_login", { p_hr: hr, p_device: deviceId });
    if (!j.ok) { const e = new Error(j.error || "error"); throw e; }
    setProfile({ token: j.token, hr: j.staff.hr, name: j.staff.name, site: j.staff.site || "", trade: j.staff.trade || "" });
    mergeProgress(j.progress);
  }
  /* Check the sign-in is still valid (e.g. the person left the company), refresh name/trade, sync progress. */
  async function refreshMe() {
    if (!loginOn() || !loggedIn() || !navigator.onLine) return;
    try {
      const j = await rpc("staff_me", { p_token: state.profile.token });
      if (j.ok) { setProfile(Object.assign({}, state.profile, { name: j.staff.name, site: j.staff.site || "", trade: j.staff.trade || "" })); mergeProgress(j.progress); if (!/^#\/v\//.test(location.hash)) route(); }
      else if (j.error === "token" || j.error === "inactive") { signOut(true); }
    } catch {}
  }
  function signOut(silent, noReload) {
    if (!silent && !confirm(t("signOutQ"))) return;
    if (state.profile.token) rpc("staff_logout", { p_token: state.profile.token }).catch(() => {});
    setProfile({});
    try {
      ["ab_done", "ab_done_at", "ab_watch", "ab_quiz", "ab_certs", "ab_outbox", "ab_paths_done"].forEach(k => localStorage.removeItem(k));
      Object.keys(localStorage).filter(k => k.startsWith("ab_steps_") || k.startsWith("ab_content_")).forEach(k => localStorage.removeItem(k));
    } catch {}
    state.done = new Set(); state.doneAt = {}; state.watch = {}; state.quiz = {}; state.certs = []; outbox = [];
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    if (!noReload) load();
  }
  function renderLogin() {
    $("#login-view").hidden = false;
    document.body.classList.add("locked");
    const f = $("#login-form");
    f.onsubmit = async e => {
      e.preventDefault();
      const hr = $("#l-hr").value.trim(), msg = $("#l-msg"), btn = $("#l-go");
      if (!hr) { $("#l-hr").focus(); return; }
      if (!navigator.onLine) { msg.textContent = t("loginOffline"); msg.className = "req-msg bad"; return; }
      btn.disabled = true; btn.textContent = t("sending"); msg.textContent = "";
      try {
        await signIn(hr);
        $("#login-view").hidden = true; document.body.classList.remove("locked");
        toast(t("welcome", { name: state.profile.name.split(" ")[0] }));
        await load(); flush();
      } catch (err) {
        msg.textContent = err.message === "notfound" ? t("loginBad") : err.message === "busy" ? t("loginBusy") : err.message === "inactive" ? t("loginInactive") : t("reqFail");
        msg.className = "req-msg bad";
      }
      btn.disabled = false; btn.textContent = t("signIn");
    };
    const main = ["en", "hi", "ur", "ml"], shown = main.includes(state.lang) ? main : [state.lang, ...main.slice(0, 3)];
    $("#l-langs").innerHTML = shown.map(c => { const l = LANGS.find(x => x.code === c); return `<button type="button" lang="${l.code}" dir="${l.dir}" data-lang="${l.code}" aria-pressed="${l.code === state.lang}">${esc(l.name)}</button>`; }).join("")
      + `<button type="button" id="l-more">${esc(t("nMore", { n: LANGS.length - shown.length }))}</button>`;
    $("#l-more").onclick = () => openSheet("#lang-sheet");
    if (matchMedia("(pointer:fine)").matches) setTimeout(() => $("#l-hr").focus(), 50);
  }
  let outbox = store.get("ab_outbox", []), flushT, flushing = false;
  function record(type, d) {
    if (!recordsOn()) return;
    outbox.push({ type, ...d, lang: state.lang, time: new Date().toISOString() });
    outbox = outbox.slice(-200);
    store.set("ab_outbox", outbox);
    clearTimeout(flushT); flushT = setTimeout(flush, 1500);
  }
  async function flush() {
    if (flushing || !outbox.length || !recordsOn() || !navigator.onLine) return;
    flushing = true;
    const batch = outbox.slice(0, 25);
    try {
      const j = await rpc("staff_record", { p_token: state.profile.token || null, p_profile: profileOut(), p_events: batch, p_device: deviceId });
      if (j.ok) { outbox = outbox.slice(batch.length); store.set("ab_outbox", outbox); if (outbox.length) setTimeout(flush, 800); }
    } catch {}
    flushing = false;
  }
  const statsOn = () => !!(state.settings.statsEnabled && backend());
  let statBox = {}, statT;
  function stat(kind, key) {
    if (!statsOn() || !key) return;
    const k = kind + "|" + String(key).toLowerCase().trim().slice(0, 80);
    statBox[k] = (statBox[k] || 0) + 1;
    clearTimeout(statT); statT = setTimeout(sendStats, 30000);
  }
  function sendStats() {
    const ks = Object.keys(statBox);
    if (!ks.length || !statsOn() || !navigator.onLine) return;
    const events = ks.map(k => { const i = k.indexOf("|"); return { kind: k.slice(0, i), key: k.slice(i + 1), n: statBox[k] }; });
    statBox = {};
    try { rpc("track_stats", { p_events: events }, { keepalive: true }).catch(() => {}); } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sendStats(); });
  const noResSeen = new Set(); let noResT;
  function noteNoResults(q) {
    clearTimeout(noResT);
    q = q.trim().toLowerCase();
    if (q.length < 3 || noResSeen.has(q)) return;
    noResT = setTimeout(() => { noResSeen.add(q); stat("nores", q); }, 2500);
  }

  /* ---------- data ---------- */
  // Text only (titles, steps, quizzes, translations). Videos themselves always play from YouTube.
  async function load() {
    renderSkeleton();
    const cacheKey = "ab_content_" + state.lang;
    let c = null, offlineCopy = false;
    try {
      c = await rpc("app_content", { p_token: state.profile.token || null, p_lang: state.lang });
      if (c && c.ok) store.set(cacheKey, c);
    } catch (e) {
      c = store.get(cacheKey, null); offlineCopy = !!c;
    }
    if (c && !c.ok && (c.error === "login" || c.error === "inactive")) {
      if (state.profile.token) signOut(true, true);
      try { const st = await rpc("app_start", { p_lang: state.lang }); Object.assign(state.settings, st.settings || {}); } catch {}
      state.settings.staffLogin = true;
      state.ready = true;
      applySettings(); route();
      return;
    }
    if (!c || !c.ok) {
      $("#grid").innerHTML = "";
      $("#count").textContent = "";
      const em = $("#empty");
      em.hidden = false;
      em.innerHTML = `<div class="big">📶</div><h3>${esc(t("loadError"))}</h3><p><button class="btn btn-primary" id="retry">${esc(t("retry"))}</button></p>`;
      $("#retry").onclick = load;
      return;
    }
    const vd = c.videos || {}, health = c.health || { problems: [] }, pd = c.paths || {}, tb = c.toolbox || {};
    state.settings = Object.assign({ categories: [], newDays: 7 }, c.settings || {});
    const dead = new Set((health.problems || []).filter(p => p.status === "notfound").map(p => p.yt));
    state.videos = (vd.videos || []).filter(v => v && v.yt && !v.hidden && !dead.has(v.yt))
      .map(v => Object.assign({ level: "Intermediate", ppe: [], steps: [], summary: "", safety: "" }, v));
    state.updated = vd.updated || "";
    state.talks = (tb.talks || []).filter(k => k && k.id && k.title && !k.hidden);
    state.paths = (pd.paths || []).filter(p => p && p.id && !p.hidden && (p.videos || []).some(id => byId(id)));
    state.assignments = (pd.assignments || []).filter(a => a && a.path && state.paths.some(p => p.id === a.path));
    state.ready = true;
    applySettings();
    route();
    if (offlineCopy) toast(t("offline"));
    checkPaths(); flush(); refreshMe();
  }
  const greeting = () => { const h = new Date().getHours(); return t(h < 12 ? "goodMorning" : h < 17 ? "goodAfternoon" : "goodEvening"); };
  function applySettings() {
    const s = state.settings;
    const st = (s.tr && s.tr[state.lang]) || {};
    const first = (state.profile.name || "").trim().split(/\s+/)[0];
    if (first && loggedIn()) {
      $("#site-tag").textContent = greeting() + ",";
      $("#site-name").textContent = first;
    } else {
      const parts = (s.siteName || "ABFM Training").split(" "), last = parts.pop();
      $("#site-name").innerHTML = esc(parts.join(" ")) + (parts.length ? " " : "") + "<b>" + esc(last) + "</b>";
      $("#site-tag").textContent = st.tagline || s.tagline || "";
    }
    const a = $("#announce");
    a.hidden = !s.announcement;
    a.innerHTML = s.announcement ? ICON.megaphone + "<span>" + esc(st.announcement || s.announcement) + "</span>" : "";
    $$(".ai-tab").forEach(b => b.hidden = !aiOn());
  }

  /* ---------- filtering ---------- */
  function haystack(v) {
    const x = tr(v);
    return [v.title, v.ytTitle, v.summary, v.subject, v.channel, v.category, catLabel(v.category), (v.steps || []).join(" "), (v.ppe || []).join(" "), x.title, x.summary, (x.steps || []).join(" "), (x.ppe || []).join(" ")].join(" ").toLowerCase();
  }
  function baseSet() {
    let list = state.videos;
    if (state.tab === "new") list = list.filter(isNew);
    if (state.tab === "saved") list = list.filter(v => state.saved.has(v.id));
    const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) list = list.filter(v => { const h = haystack(v); return words.every(w => h.includes(w)); });
    return list;
  }
  function filtered() {
    let list = baseSet();
    if (state.cat !== "ALL") list = list.filter(v => v.category === state.cat);
    if (state.level !== "ALL") list = list.filter(v => v.level === state.level);
    const by = {
      new: (a, b) => (b.featured === true) - (a.featured === true) || (b.added || "").localeCompare(a.added || "") || a.title.localeCompare(b.title),
      short: (a, b) => durSec(a.duration) - durSec(b.duration),
      az: (a, b) => titleOf(a).localeCompare(titleOf(b), state.lang)
    }[state.sort];
    return [...list].sort(by);
  }

  /* ---------- rendering: list ---------- */
  function renderSkeleton() {
    $("#grid").innerHTML = Array.from({ length: 6 }, () =>
      `<div class="card" aria-hidden="true"><div class="thumb sk"></div><div class="card-body"><div class="sk" style="height:12px;width:40%"></div><div class="sk" style="height:16px"></div><div class="sk" style="height:16px;width:70%"></div></div></div>`).join("");
  }
  function card(v) {
    const on = state.saved.has(v.id);
    return `<article class="card${v.essential ? " is-ess" : ""}">
      <a class="card-link" href="#/v/${encodeURIComponent(v.id)}">
        <div class="thumb">
          <img loading="lazy" decoding="async" src="${thumb(v.yt)}" alt="" width="320" height="180">
          ${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}
          ${refresherDue(v) ? `<span class="tag-new tag-ref">${esc(t("refresherDue"))}</span>` : v.essential ? `<span class="tag-new tag-ess">${esc(t("essentialTag"))}</span>` : isNew(v) ? `<span class="tag-new">${esc(t("new"))}</span>` : ""}
          ${state.done.has(v.id) && !refresherDue(v) ? `<span class="tag-done" title="${esc(t("doneLabel"))}">✓</span>` : ""}
          ${!state.done.has(v.id) && watchPct(v) > 0.02 ? `<span class="tag-prog"><i style="width:${Math.round(watchPct(v) * 100)}%"></i></span>` : ""}
        </div>
        <div class="card-body">
          <div class="meta"><span class="cat-tag" style="${catTone(v.category)}">${esc(catLabel(v.category))}</span><span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span>${hasQuiz(v) ? `<span class="q-tag${quizPassed(v) && state.quiz[v.id] ? " ok" : ""}">${esc(t("quizTitle"))}${quizPassed(v) && state.quiz[v.id] ? " ✓" : ""}</span>` : ""}</div>
          <h3>${esc(titleOf(v))}</h3>
          ${v.channel ? `<div class="chan">${esc(v.channel)}</div>` : ""}
        </div>
      </a>
      <button class="save-btn" data-save="${esc(v.id)}" aria-pressed="${on}" aria-label="${esc(on ? t("savedLabel") : t("save"))}">${on ? ICON.bookmarkOn : ICON.bookmark}</button>
    </article>`;
  }
  function mini(v, href) {
    return `<a class="mini" href="${href || "#/v/" + encodeURIComponent(v.id)}">
      <div class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt="" width="320" height="180">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${state.done.has(v.id) ? `<span class="tag-done">✓</span>` : ""}</div>
      <div><h3>${esc(titleOf(v))}</h3><div class="meta"><span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span>${v.channel ? `<span>${esc(v.channel)}</span>` : ""}</div></div>
    </a>`;
  }
  function renderChips() {
    const base = baseSet().filter(v => state.level === "ALL" || v.level === state.level);
    const counts = {};
    base.forEach(v => counts[v.category] = (counts[v.category] || 0) + 1);
    const known = state.settings.categories.map(c => c.name);
    const extra = [...new Set(state.videos.map(v => v.category))].filter(c => !known.includes(c));
    const cats = [...known, ...extra].filter(c => counts[c] || c === state.cat);
    $("#cats").innerHTML =
      `<button class="chip" data-cat="ALL" aria-pressed="${state.cat === "ALL"}">${esc(t("all"))} <span class="n">${base.length}</span></button>` +
      cats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${catIcon(c)}${esc(catLabel(c))} <span class="n">${counts[c] || 0}</span></button>`).join("");
    $("#levels").innerHTML = ["ALL", ...LEVELS].map(l =>
      `<button data-level="${l}" aria-pressed="${state.level === l}">${esc(l === "ALL" ? t("all") : t(l))}</button>`).join("");
  }
  function renderList() {
    renderChips();
    $("#sort").value = state.sort;
    const list = filtered();
    $("#lib-title").textContent = state.tab === "new" ? t("newThisWeek") : state.tab === "saved" ? t("savedVideos") : t("library");
    $("#req-btn").hidden = state.settings.requestsEnabled === false;
    $("#req-btn").innerHTML = ICON.request + "<span>" + esc(t("reqShort")) + "</span>";
    $("#count").textContent = list.length ? t("videos", { n: list.length }) : "";
    $("#grid").innerHTML = list.slice(0, state.limit).map(card).join("");
    $("#more").hidden = list.length <= state.limit;
    const em = $("#empty");
    em.hidden = !!list.length;
    if (!list.length) {
      if (state.tab === "saved" && !state.q) {
        em.innerHTML = `<div class="big">${ICON.bookmark}</div><h3>${esc(t("savedEmpty"))}</h3><p>${esc(t("savedEmptyHint"))}</p>`;
      } else {
        if (state.q && state.cat === "ALL" && state.level === "ALL" && state.tab === "library") noteNoResults(state.q);
        em.innerHTML = `<div class="big">${ICON.search}</div><h3>${esc(t("noResults"))}</h3><p>${esc(t("noResultsHint"))}</p><p><button class="btn" id="clear-all">${esc(t("clearFilters"))}</button></p>
          ${state.settings.requestsEnabled !== false ? `<p class="hint">${esc(t("requestHint"))}</p><p><button class="btn btn-primary" data-request>${ICON.request}<span>${esc(t("requestVideo"))}</span></button></p>` : ""}`;
      }
    }
    $("#foot").innerHTML = footHtml();
    setTab("library");
  }
  const footHtml = () => { const s = state.settings; return [state.updated ? esc(t("updated", { date: fmtDate(state.updated) })) : "", s.helpdesk ? esc(t("helpdesk")) + ": " + esc(s.helpdesk) : ""].filter(Boolean).join(" · "); };
  const setTab = tab => { $$("[data-tab]").forEach(b => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }); };

  /* ---------- home ---------- */
  function renderHome() {
    const el = $("#home-view");
    const talk = todayTalk(), openAs = myAssignments().filter(x => !pathStats(x.p).complete);
    const due = dueRefreshers(), cont = inProgress().slice(0, 4);
    const ess = state.videos.filter(v => v.essential);
    const essRank = v => refresherDue(v) ? 0 : state.done.has(v.id) ? 2 : 1;
    const allNew = state.videos.filter(isNew).sort((a, b) => b.added.localeCompare(a.added));
    const counts = {}; state.videos.forEach(v => counts[v.category] = (counts[v.category] || 0) + 1);
    const known = state.settings.categories.map(c => c.name).filter(c => counts[c]);
    const shown = known.slice(0, 5), more = known.length - shown.length;
    const kx = talk ? kTr(talk) : {};
    el.innerHTML = `
      <form class="home-search" id="home-search" role="search">${ICON.search}<input id="hq" type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(t("searchN", { n: state.videos.length }))}" aria-label="${esc(t("search"))}"></form>
      ${openAs.length ? `<div class="sec">${openAs.map(asCard).join("")}</div>` : ""}
      ${due.length ? `<a class="notice refresh-note" href="#/me">${ICON.shield}<span style="flex:1">${esc(t("refreshersDue", { n: due.length }))}</span><span class="flip-r">${ICON.back}</span></a>` : ""}
      ${talk ? `<a class="talk-card" href="#/talk"><span class="tk-ico">${talk.icon ? esc(talk.icon) : ICON.bolt}</span>
        <span class="tk-body"><span class="tk-label">${esc(t("toolboxToday"))}</span><strong>${esc(kx.title || talk.title)}</strong><span class="tk-hint">${esc(t("toolboxHint"))}</span></span>
        <span class="tk-go flip-r">${ICON.back}</span></a>` : ""}
      ${cont.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("continueWatching"))}</h2><a href="#/me">${esc(t("seeAll"))}</a></div>
        <div class="cw-grid">${cont.map(v => `<a class="cw" href="#/v/${encodeURIComponent(v.id)}"><div class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}<span class="tag-prog"><i style="width:${Math.round(watchPct(v) * 100)}%"></i></span></div><b>${esc(titleOf(v))}</b></a>`).join("")}</div></div>` : ""}
      ${known.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("browseTrades"))}</h2></div>
        <div class="trade-grid">${shown.map(c => `<a class="trade" href="#/library" data-go-cat="${esc(c)}">${tradeIco(c)}<span><b>${esc(catLabel(c))}</b><small>${esc(t("videos", { n: counts[c] }))}</small></span></a>`).join("")}
        <a class="trade" href="#/library" data-go-cat="ALL"><span class="ti" style="color:var(--muted);background:var(--surface-2)">${svg('<path d="M4 6h16M4 12h16M4 18h10"/>', 21)}</span><span><b>${esc(t("tradesAll"))}</b><small>${more > 0 ? esc(t("nMore", { n: more })) : esc(t("videos", { n: state.videos.length }))}</small></span></a></div></div>` : ""}
      ${ess.length ? `<div class="ess-wrap"><div class="section-h"><h2>${ICON.shield}${esc(t("safetyEssentials"))}</h2></div><p class="section-sub">${esc(t("essentialsHint"))}</p>
        <div class="rail">${ess.sort((a, b) => essRank(a) - essRank(b)).map(card).join("")}</div></div>` : ""}
      ${state.paths.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("paths"))}</h2></div><div class="rail path-rail">${state.paths.map(pathCard).join("")}</div></div>` : ""}
      ${allNew.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("newThisWeek"))}</h2><a href="#/new">${esc(t("seeAll"))}</a></div><div class="mini-list">${allNew.slice(0, 4).map(v => mini(v)).join("")}</div></div>` : ""}
      <div class="home-foot">
        ${state.settings.requestsEnabled !== false ? `<p class="hint" style="margin:0">${esc(t("requestHint"))}</p><button class="btn" data-request>${ICON.request}<span>${esc(t("requestVideo"))}</span></button>` : ""}
        <p class="foot" style="padding-top:8px">${footHtml()}</p>
      </div>`;
    $("#home-search").onsubmit = e => { e.preventDefault(); goSearch($("#hq").value); };
    $("#hq").addEventListener("input", e => { if (e.target.value.trim().length >= 2) goSearch(e.target.value, true); });
    $$("[data-go-cat]", el).forEach(a => a.onclick = () => { state.cat = a.dataset.goCat; state.level = "ALL"; state.q = ""; $("#q").value = ""; state.limit = PAGE; });
    setTab("home");
  }
  function goSearch(q, keepTyping) {
    state.q = q; state.cat = "ALL"; state.level = "ALL"; state.limit = PAGE;
    $("#q").value = q; $("#q-clear").hidden = !q;
    location.hash = "#/library";
    if (keepTyping) setTimeout(() => { const i = $("#q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 30);
  }

  /* ---------- toolbox talk of the day ---------- */
  const kTr = k => (!state.showEn && k.tr && k.tr[state.lang]) || {};
  const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function todayTalk() {
    const list = state.talks; if (!list.length) return null;
    const today = localDay();
    const pinned = list.find(k => k.date === today);
    if (pinned) return pinned;
    const pool = list.filter(k => !k.date);
    if (!pool.length) return null;
    const n = Math.floor(Date.parse(today + "T00:00:00Z") / 864e5);
    return pool[n % pool.length];
  }
  function renderTalk(k) {
    const x = kTr(k), today = todayTalk();
    const pts = (x.points && x.points.length === (k.points || []).length) ? x.points : (k.points || []);
    const has = !!(x.title);
    const vid = k.video ? state.videos.find(v => v.id === k.video) : null;
    const others = state.talks.filter(o => o.id !== k.id);
    const el = $("#video-view");
    const canSpeak = "speechSynthesis" in window;
    const BCP = { en: "en-GB", hi: "hi-IN", ur: "ur-PK", ml: "ml-IN", bn: "bn-IN", ta: "ta-IN", ne: "ne-NP", tl: "fil-PH", ar: "ar-SA" };
    const sl = has ? state.lang : "en";
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <article class="talk">
        <div class="talk-top"><span class="tk-label">${esc(k === today ? t("toolboxToday") : "🦺")}</span><span class="count">${esc(fmtDate(localDay()))}</span></div>
        <div class="path-head"><div class="ph-ico">${esc(k.icon || "🦺")}</div><div><h1>${esc(x.title || k.title)}</h1>${has ? `<p class="en-title" lang="en" dir="ltr">${esc(k.title)}</p>` : ""}</div></div>
        <ol class="talk-points" ${has || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>${pts.map(p => `<li>${esc(p)}</li>`).join("")}</ol>
        ${k.ask ? `<div class="talk-ask"><strong>💬 ${esc(t("askTeam"))}</strong><p ${x.ask || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>${esc(x.ask || k.ask)}</p></div>` : ""}
        <div class="actions">
          ${canSpeak ? `<button class="btn btn-primary" id="tk-listen">🔊 <span>${esc(t("listen"))}</span></button>` : ""}
          ${state.lang !== "en" && has ? `<button class="btn" id="tr-toggle">${state.showEn ? esc((LANGS.find(l => l.code === state.lang) || {}).name || "") : "English"}</button>` : ""}
        </div>
        ${vid ? `<div class="mini-list">${mini(vid)}</div>` : ""}
      </article>
      <div class="section-h" style="margin-top:22px"><h2>${esc(t("otherTalks"))}</h2></div>
      <div class="talk-list">${others.map(o => `<a href="#/talk/${encodeURIComponent(o.id)}"><span>${esc(o.icon || "🦺")}</span>${esc(kTr(o).title || o.title)}</a>`).join("")}</div>`;
    $("#back").onclick = () => { if (history.length > 1 && sessionStorage.getItem("ab_in_app")) history.back(); else location.hash = "#/"; };
    const tt = $("#tr-toggle"); if (tt) tt.onclick = () => { state.showEn = !state.showEn; renderTalk(k); };
    const lb = $("#tk-listen");
    if (lb) {
      let on = false;
      const draw = () => { lb.innerHTML = `${on ? "⏹" : "🔊"} <span>${esc(on ? t("stop") : t("listen"))}</span>`; };
      lb.onclick = () => {
        speechSynthesis.cancel();
        on = !on; draw();
        if (!on) return;
        const parts = [x.title && !state.showEn ? x.title : k.title, ...(state.showEn ? k.points : pts), (state.showEn ? k.ask : (x.ask || k.ask)) || ""].filter(Boolean);
        const lang = state.showEn ? "en" : sl;
        parts.forEach((txt, i) => {
          const u = new SpeechSynthesisUtterance(txt);
          u.lang = BCP[lang] || "en-GB"; u.rate = 0.95;
          const voice = speechSynthesis.getVoices().find(vo => vo.lang && vo.lang.toLowerCase().startsWith(lang === "tl" ? "fil" : lang));
          if (voice) u.voice = voice;
          if (i === parts.length - 1) u.onend = () => { on = false; draw(); };
          speechSynthesis.speak(u);
        });
      };
    }
  }

  /* ---------- Ask AI ---------- */
  const aiOn = () => !!(state.settings.aiEnabled && backend());
  const ai = { msgs: (() => { try { return JSON.parse(sessionStorage.getItem("ab_ai") || "[]"); } catch { return []; } })(), photos: [], busy: false };
  const saveAi = () => { try { sessionStorage.setItem("ab_ai", JSON.stringify(ai.msgs.slice(-20).map(m => ({ ...m, photos: undefined, nPhotos: (m.photos || []).length || m.nPhotos || 0 })))); } catch {} };
  function mdLite(text) {
    const lines = esc(text).split(/\n/);
    let html = "", list = null;
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (let ln of lines) {
      ln = ln.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      const ol = ln.match(/^\s*\d+[.)]\s+(.*)/), ul = ln.match(/^\s*[-•*]\s+(.*)/);
      if (ol) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${ol[1]}</li>`; }
      else if (ul) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${ul[1]}</li>`; }
      else { close(); if (ln.trim()) html += `<p>${ln}</p>`; }
    }
    close();
    return html;
  }
  function catalogFor(q) {
    const words = String(q).toLowerCase().match(/[a-z]{3,}/g) || [];
    const scored = state.videos.map(v => {
      const h = (v.title + " " + v.subject + " " + v.category + " " + (v.summary || "")).toLowerCase();
      return [words.reduce((n, w) => n + (h.includes(w) ? 1 : 0), 0), v];
    }).sort((a, b) => b[0] - a[0]);
    return scored.slice(0, 300).map(([, v]) => `${v.id} | ${v.title} | ${v.category}${v.subject ? " / " + v.subject : ""}`);
  }
  function aiMsgHtml(m, i) {
    if (m.role === "user") return `<div class="ai-msg me">${(m.photos || []).map(p => `<img src="${p}" alt="">`).join("")}${m.nPhotos && !(m.photos || []).length ? `<span class="ai-ph">📷 × ${m.nPhotos}</span>` : ""}${m.text ? `<p>${esc(m.text)}</p>` : ""}</div>`;
    if (m.error) return `<div class="ai-msg bot err">${esc(m.text)}${m.why ? `<div class="ai-why">For the admin: ${esc(m.why)}</div>` : ""}</div>`;
    const vids = (m.videos || []).map(id => state.videos.find(v => v.id === id)).filter(Boolean);
    return `<div class="ai-msg bot">
      <div class="ai-text">${mdLite(m.text)}</div>
      ${"speechSynthesis" in window ? `<button class="ai-say" data-say="${i}" aria-label="${esc(t("listen"))}">🔊</button>` : ""}
      ${vids.length ? `<div class="ai-vids"><div class="ai-vh">🎬 ${esc(t("aiSuggested"))}</div><div class="mini-list">${vids.map(v => mini(v)).join("")}</div></div>` : ""}
    </div>`;
  }
  function renderAI() {
    const el = $("#video-view");
    document.body.classList.add("ai-mode");
    const hdr = $("header.top");
    document.documentElement.style.setProperty("--ai-top", (hdr ? Math.round(hdr.getBoundingClientRect().bottom) : 64) + "px");
    const empty = !ai.msgs.length;
    el.innerHTML = `
      <div class="ai-wrap">
        <div class="ai-head">
          <div><h1>✨ ${esc(t("aiTitle"))}</h1>${empty ? `<p class="sub">${esc(t("aiIntro"))}</p>` : ""}</div>
          ${empty ? "" : `<button class="btn btn-sm" id="ai-new">${esc(t("aiNew"))}</button>`}
        </div>
        <div class="ai-log" id="ai-log">
          ${empty ? `<div class="ai-ex">${["aiEx1", "aiEx2", "aiEx3"].map(k => `<button class="chip" data-ex="${esc(t(k))}">${esc(t(k))}</button>`).join("")}</div>` : ai.msgs.map(aiMsgHtml).join("")}
          ${ai.busy ? `<div class="ai-msg bot"><span class="ai-dots"><i></i><i></i><i></i></span> ${esc(t("aiThinking"))}</div>` : ""}
        </div>
        <p class="ai-note">⚠ ${esc(t("aiDisclaimer"))}</p>
        <form class="ai-bar" id="ai-form">
          <div class="ai-photos" id="ai-photos">${ai.photos.map((p, i) => `<span><img src="${p.url}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">✕</button></span>`).join("")}</div>
          <div class="ai-menu" id="ai-menu" hidden>
            <label class="ai-mi">📸 <span>${esc(t("aiTake"))}</span><input type="file" accept="image/*" capture="environment" class="ai-file" hidden></label>
            <label class="ai-mi">🖼️ <span>${esc(t("aiGallery"))}</span><input type="file" accept="image/*" multiple class="ai-file" hidden></label>
          </div>
          <div class="ai-row">
            <button type="button" class="btn btn-icon ai-cam" id="ai-cam" aria-label="${esc(t("aiPhoto"))}" title="${esc(t("aiPhoto"))}" aria-expanded="false" ${ai.photos.length >= 3 ? "disabled" : ""}>📷</button>
            <textarea id="ai-q" rows="1" maxlength="1000" placeholder="${esc(t("aiPlaceholder"))}"></textarea>
            <button class="btn btn-primary btn-icon" id="ai-send" aria-label="${esc(t("send"))}" ${ai.busy ? "disabled" : ""}><span class="flip-r">${ICON.back}</span></button>
          </div>
        </form>
      </div>`;
    const log = $("#ai-log");
    requestAnimationFrame(() => { if (!empty) log.scrollTop = log.scrollHeight; });
    const q = $("#ai-q");
    q.addEventListener("input", () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 140) + "px"; });
    q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); $("#ai-form").requestSubmit(); } });
    $("#ai-form").onsubmit = e => { e.preventDefault(); askAI(q.value); };
    const menu = $("#ai-menu"), cam = $("#ai-cam");
    cam.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; cam.setAttribute("aria-expanded", !menu.hidden); };
    menu.addEventListener("click", e => e.stopPropagation());
    $$(".ai-file", el).forEach(inp => inp.onchange = async e => {
      menu.hidden = true;
      for (const f of [...e.target.files].slice(0, 3 - ai.photos.length)) { try { ai.photos.push(await shrink(f)); } catch {} }
      e.target.value = ""; const keep = q.value; renderAI(); $("#ai-q").value = keep;
    });
    q.addEventListener("focus", () => document.body.classList.add("ai-typing"));
    q.addEventListener("blur", () => setTimeout(() => document.body.classList.remove("ai-typing"), 150));
    $$("[data-rm]", el).forEach(b => b.onclick = () => { ai.photos.splice(+b.dataset.rm, 1); const keep = q.value; renderAI(); $("#ai-q").value = keep; });
    $$("[data-ex]", el).forEach(b => b.onclick = () => askAI(b.dataset.ex));
    $$("[data-say]", el).forEach(b => b.onclick = () => {
      speechSynthesis.cancel();
      const m = ai.msgs[+b.dataset.say];
      const u = new SpeechSynthesisUtterance(m.text.replace(/\*\*/g, ""));
      const BCP = { en: "en-GB", hi: "hi-IN", ur: "ur-PK", ml: "ml-IN", bn: "bn-IN", ta: "ta-IN", ne: "ne-NP", tl: "fil-PH", ar: "ar-SA" };
      u.lang = BCP[m.lang || state.lang] || "en-GB"; u.rate = 0.95; speechSynthesis.speak(u);
    });
    const nb = $("#ai-new"); if (nb) nb.onclick = () => { ai.msgs = []; ai.photos = []; saveAi(); renderAI(); };
  }
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const data = c.toDataURL("image/jpeg", 0.8);
        res({ url: data, mime: "image/jpeg", data: data.split(",")[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
      img.src = url;
    });
  }
  async function askAI(text) {
    text = String(text || "").trim();
    if ((!text && !ai.photos.length) || ai.busy) return;
    const photos = ai.photos.splice(0);
    ai.msgs.push({ role: "user", text, photos: photos.map(p => p.url) });
    ai.busy = true; renderAI();
    const lang = { en: "English", hi: "Hindi", ur: "Urdu", ml: "Malayalam", bn: "Bengali", ta: "Tamil", ne: "Nepali", tl: "Filipino (Tagalog)", ar: "Arabic" }[state.lang] || "English";
    const history = ai.msgs.slice(-9, -1).filter(m => !m.error).map(m => ({ role: m.role === "user" ? "user" : "model", text: (m.text || "").slice(0, 1500) }));
    try {
      const r = await fetch(SB.url + "/functions/v1/ask", { method: "POST", headers: { apikey: SB.anonKey, Authorization: "Bearer " + SB.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({
        token: state.profile.token || "", device: deviceId, lang: state.lang, langName: lang, history, text,
        images: photos.map(p => ({ mime: p.mime, data: p.data })), catalog: catalogFor(text + " " + history.map(h => h.text).join(" "))
      }) });
      const raw = await r.text();
      let j;
      try { j = JSON.parse(raw); } catch { const er = new Error("notjson"); er.detail = /accounts\.google|signin|ServiceLogin/i.test(raw) ? "login" : raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120); throw er; }
      if (!j.ok) { const er = new Error(j.error || "error"); er.detail = j.detail || ""; throw er; }
      ai.msgs.push({ role: "bot", text: j.answer || "", videos: (j.videos || []).slice(0, 4), lang: state.lang });
    } catch (e) {
      const why = {
        off: "Ask AI is off, or the GEMINI_API_KEY secret isn't set in Supabase (Edge Functions → Secrets).",
        login: "Sign in again.",
        empty: "Empty question."
      }[e.message === "notjson" ? e.detail : e.message] || (e.message === "Failed to fetch" ? "Couldn't reach the server (no internet?)." : (e.detail || e.message || ""));
      ai.msgs.push({ role: "bot", error: true, text: e.message === "busy" ? t("aiBusy") : t("aiError"), why: e.message === "busy" ? "" : String(why).slice(0, 220) });
    }
    ai.busy = false; saveAi();
    if (location.hash.startsWith("#/ai")) renderAI();
  }

  /* ---------- request a video ---------- */
  function openRequest(topic) {
    const f = $("#req-form");
    f.reset();
    $("#r-topic").value = topic || "";
    $("#r-cat").innerHTML = state.settings.categories.map(c => `<option value="${esc(c.name)}">${esc(catLabel(c.name))}</option>`).join("") + `<option value="">${esc(t("other"))}</option>`;
    const low = String(topic || "").toLowerCase();
    const guess = state.cat !== "ALL" ? state.cat : (state.settings.categories.find(c => (c.keywords || []).some(w => w && low.includes(String(w).toLowerCase()))) || {}).name;
    $("#r-cat").value = guess || "";
    $("#r-topic").oninput = e => {
      if ($("#r-cat").dataset.touched) return;
      const l = e.target.value.toLowerCase();
      const g = (state.settings.categories.find(c => (c.keywords || []).some(w => w && l.includes(String(w).toLowerCase()))) || {}).name;
      if (g) $("#r-cat").value = g;
    };
    $("#r-cat").onchange = () => { $("#r-cat").dataset.touched = "1"; };
    delete $("#r-cat").dataset.touched;
    $("#r-msg").textContent = ""; $("#r-msg").className = "req-msg";
    $("#r-send").disabled = false; $("#r-send").textContent = t("send");
    $("#req-sheet").hidden = false;
    setTimeout(() => $("#r-topic").focus(), 50);
  }
  async function sendRequest(e) {
    e.preventDefault();
    const topic = $("#r-topic").value.trim(), msg = $("#r-msg"), btn = $("#r-send");
    if (!topic) { $("#r-topic").focus(); return; }
    btn.disabled = true; btn.textContent = t("sending"); msg.textContent = "";
    const body = {
      topic, category: $("#r-cat").value, details: $("#r-details").value.trim(),
      name: state.profile.name || "", site: state.profile.site || "", lang: state.lang, website: $("#r-web").value
    };
    try {
      const j = await rpc("submit_request", { p_token: state.profile.token || null, p_body: body, p_device: deviceId });
      if (!j.ok) throw new Error(j.error || "failed");
      msg.textContent = "✓ " + t("reqThanks"); msg.className = "req-msg ok";
      btn.textContent = "✓";
      setTimeout(() => { closeSheets(); toast(t("reqThanks")); }, 1600);
    } catch (err) {
      msg.textContent = t("reqFail"); msg.className = "req-msg bad";
      btn.disabled = false; btn.textContent = t("send");
    }
  }

  /* ---------- learning paths ---------- */
  function pathStats(p) {
    const vids = pathVideos(p), n = vids.length, done = vids.filter(v => state.done.has(v.id)).length;
    const next = vids.find(v => !state.done.has(v.id) || !quizPassed(v)) || vids[0];
    const quizOk = vids.every(quizPassed);
    return { vids, n, done, next, quizOk, complete: !!n && done === n && quizOk };
  }
  /* Let the person know when a path is finished, and record it once. */
  function checkPaths() {
    const seen = store.get("ab_paths_done", {});
    let ch = false;
    state.paths.forEach(p => {
      if (seen[p.id] || !pathStats(p).complete) return;
      seen[p.id] = new Date().toISOString().slice(0, 10); ch = true;
      record("path", { item: p.id, title: p.title });
      setTimeout(() => toast("🎓 " + t("pathComplete")), 400);
    });
    if (ch) store.set("ab_paths_done", seen);
  }

  /* ---------- assigned training ---------- */
  const myTrade = () => state.profile.trade || "";
  function myAssignments() {
    return state.assignments.map(a => ({ a, p: state.paths.find(p => p.id === a.path) }))
      .filter(x => x.p && (!(x.a.trades || []).length || (myTrade() && x.a.trades.includes(myTrade()))))
      .sort((x, y) => (x.a.due || "9999").localeCompare(y.a.due || "9999"));
  }
  const isOverdue = a => a.due && a.due < localDay();
  function asCard({ a, p }) {
    const s = pathStats(p), x = pTr(p), over = !s.complete && isOverdue(a);
    const quizLeft = s.vids.filter(v => hasQuiz(v) && !quizPassed(v)).length;
    const days = a.due ? Math.round((Date.parse(a.due + "T00:00:00") - Date.parse(localDay() + "T00:00:00")) / 864e5) : null;
    const pill = s.complete ? `<span class="pillx ok">${esc(t("doneLabel"))}</span>` : over ? `<span class="pillx over">${esc(t("overdue"))}</span>`
      : a.due ? `<span class="pillx due">${esc(days <= 7 ? t("dueInDays", { n: Math.max(0, days) }) : t("dueBy", { date: fmtDate(a.due) }))}</span>` : "";
    const next = s.next, href = next && !s.complete ? `#/v/${encodeURIComponent(next.id)}/p/${encodeURIComponent(p.id)}` : `#/p/${encodeURIComponent(p.id)}`;
    return `<div class="as-card${over ? " over" : ""}${s.complete ? " ok" : ""}">
      <div class="as-top"><span class="as-label">${esc(t("assigned"))}</span>${pill}</div>
      <a class="as-main" href="#/p/${encodeURIComponent(p.id)}" style="text-decoration:none;color:inherit">
        <span class="as-ico" style="background:var(--brand-soft);color:var(--brand-ink);font-size:24px">${p.icon ? esc(p.icon) : ICON.pin}</span>
        <span style="min-width:0"><span class="as-title" style="display:block">${esc(x.title || p.title)}</span>
          <span class="as-meta">${esc(t("progress", { done: s.done, n: s.n }))}${quizLeft ? " · " + esc(t("quizLeft", { n: quizLeft })) : ""}</span></span></a>
      <div class="bar${over ? " over" : s.complete ? " ok" : ""}"><i style="width:${s.n ? Math.round(s.done / s.n * 100) : 0}%"></i></div>
      ${a.note ? `<span class="as-note">${esc(a.note)}</span>` : ""}
      ${!s.complete && next ? `<a class="btn btn-primary" href="${href}">${ICON.play}<span style="overflow:hidden;text-overflow:ellipsis">${esc(s.done ? t("continueTo", { title: titleOf(next) }) : t("startPath"))}</span></a>` : ""}
    </div>`;
  }

  /* ---------- certificates ---------- */
  function makeCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(r) : r.forEach((_, i) => r[i] = Math.random() * 256);
    const s = [...r].map(x => A[x % A.length]).join("");
    return s.slice(0, 4) + "-" + s.slice(4);
  }
  function getCert(p) {
    const existing = state.certs.find(c => c.path === p.id);
    if (existing) { location.hash = "#/cert/" + existing.code; return; }
    if (!state.profile.name) { toast(t("certNeedsSignIn")); return; }
    const { vids } = pathStats(p);
    const qs = vids.filter(hasQuiz).map(v => state.quiz[v.id]).filter(Boolean);
    const score = qs.length ? Math.round(qs.reduce((a, q) => a + q.score / q.n, 0) / qs.length * 100) : null;
    const c = { code: makeCode(), path: p.id, title: p.title, at: localDay(), name: state.profile.name, hr: state.profile.hr || "", site: state.profile.site || "", trade: state.profile.trade || "", videos: vids.length, score };
    state.certs.push(c); store.set("ab_certs", state.certs);
    record("cert", { item: p.id, title: p.title, code: c.code, score });
    location.hash = "#/cert/" + c.code;
  }
  const verifyLink = c => location.href.split("#")[0] + "#/verify/" + encodeURIComponent(c.code);
  function renderCert(c) {
    const p = state.paths.find(x => x.id === c.path), x = p ? pTr(p) : {};
    const el = $("#video-view");
    const canSign = !!(state.settings.signoffEnabled && backend());
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back no-print" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <article class="cert" lang="en" dir="ltr">
        <div class="cert-in">
          <img class="cert-logo" src="assets/logo.png" alt="" width="64" height="64">
          <p class="cert-org">${esc(state.settings.tagline || "Al Bonian Facilities Management")}</p>
          <h1>${esc(t("certTitle"))}</h1>
          <p class="cert-small">${esc(t("certThis"))}</p>
          <p class="cert-name">${esc(c.name || state.profile.name || "")}</p>
          ${c.hr ? `<p class="cert-small">${esc(t("hrNumber"))}: <b>${esc(c.hr)}</b></p>` : ""}
          <p class="cert-small">${esc(t("certBody"))}</p>
          <p class="cert-path">${esc(c.title)}</p>
          ${x.title && x.title !== c.title ? `<p class="cert-small" lang="${esc(state.lang)}" dir="auto">${esc(x.title)}</p>` : ""}
          <div class="cert-facts">
            <span><small>${esc(t("certDate"))}</small><b>${esc(fmtDate(c.at))}</b></span>
            <span><small>${esc(t("certVideos"))}</small><b>${esc(c.videos || "")}</b></span>
            ${c.score !== null && c.score !== undefined ? `<span><small>${esc(t("quizTitle"))}</small><b>${esc(c.score)}%</b></span>` : ""}
          </div>
          <div class="cert-sign">${c.signedBy ? `${esc(t("signedBy", { name: c.signedBy }))}${c.signedAt ? " · " + esc(fmtDate(c.signedAt)) : ""}` : canSign ? `<span class="cert-line"></span><small>${esc(t("signoff"))}</small>` : ""}</div>
          <p class="cert-code">${esc(t("certCode"))}: <b>${esc(c.code)}</b></p>
        </div>
      </article>
      <div class="actions no-print" style="margin-top:14px">
        <button class="btn btn-primary" id="c-print">${ICON.printer}<span>${esc(t("printCert"))}</span></button>
        <button class="btn" id="c-share">${ICON.share}<span>${esc(t("share"))}</span></button>
        ${canSign && !c.signedBy ? `<button class="btn" id="c-sign">${ICON.pen}<span>${esc(t("signoff"))}</span></button>` : ""}
      </div>`;
    $("#back").onclick = goBack;
    $("#c-print").onclick = () => window.print();
    $("#c-share").onclick = async () => {
      const text = `${c.name || state.profile.name} — ${c.title} (${fmtDate(c.at)}) · ${t("certCode")}: ${c.code}`;
      const url = backend() ? verifyLink(c) : undefined;
      if (navigator.share) { try { await navigator.share({ title: t("certTitle"), text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
      window.open("https://wa.me/?text=" + encodeURIComponent(text + (url ? "\n" + url : "")), "_blank", "noopener");
    };
    const sb = $("#c-sign"); if (sb) sb.onclick = () => openSignoff(c);
  }
  function openSignoff(c) {
    $("#sg-form").reset(); $("#sg-msg").textContent = ""; $("#sg-msg").className = "req-msg";
    $("#sign-sheet").hidden = false; setTimeout(() => $("#sg-pin").focus(), 50);
    $("#sg-form").onsubmit = async e => {
      e.preventDefault();
      const pin = $("#sg-pin").value.trim(), msg = $("#sg-msg"), btn = $("#sg-go");
      if (!pin) return;
      btn.disabled = true; msg.textContent = t("sending"); msg.className = "req-msg";
      try {
        const j = await rpc("staff_signoff", { p_token: state.profile.token || null, p_profile: profileOut(), p_pin: pin,
          p_cert: { code: c.code, path: c.path, title: c.title, name: c.name, score: c.score }, p_device: deviceId });
        if (!j.ok) throw new Error(j.error || "error");
        c.signedBy = j.supervisor; c.signedAt = localDay();
        store.set("ab_certs", state.certs);
        closeSheets(); toast("✓ " + t("signedBy", { name: j.supervisor })); renderCert(c);
      } catch (err) { msg.textContent = err.message === "pin" ? t("wrongPin") : err.message === "busy" ? t("loginBusy") : t("reqFail"); msg.className = "req-msg bad"; }
      btn.disabled = false;
    };
  }
  async function renderVerify(code) {
    const el = $("#video-view");
    el.innerHTML = `<button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <div class="panel verify"><h2>${ICON.award}${esc(t("verify"))}</h2><p class="count">${esc(t("certCode"))}: <b>${esc(code)}</b></p><div id="vf-out"><p class="hint">${esc(t("loading"))}</p></div></div>`;
    $("#back").onclick = goBack;
    const out = $("#vf-out");
    if (!backend()) { out.innerHTML = `<p>${esc(t("verifyBad"))}</p>`; return; }
    try {
      const j = await rpc("verify_cert", { p_code: code });
      if (!j.ok || !j.cert) throw new Error("bad");
      const c = j.cert;
      out.innerHTML = `<p class="vf-ok">${esc(t("verifyOk"))}</p>
        <p><b>${esc(c.name)}</b>${c.hr ? ` · ${esc(t("hrNumber"))} ${esc(c.hr)}` : ""}</p>
        <p>${esc(c.title)} · ${esc(fmtDate(String(c.at).slice(0, 10)))}${c.score !== "" && c.score !== null && c.score !== undefined ? ` · ${esc(t("quizTitle"))} ${esc(c.score)}%` : ""}</p>
        ${c.signedBy ? `<p>${esc(t("signedBy", { name: c.signedBy }))}</p>` : ""}`;
    } catch { out.innerHTML = `<p class="vf-bad">${esc(t("verifyBad"))}</p>`; }
  }

  /* ---------- my training page ---------- */
  function renderMe() {
    const el = $("#video-view"), p = state.profile;
    const done = state.videos.filter(v => state.done.has(v.id)).length;
    const passed = state.videos.filter(v => hasQuiz(v) && state.quiz[v.id] && state.quiz[v.id].pass).length;
    const as = myAssignments(), due = dueRefreshers(), cont = inProgress(), saved = state.videos.filter(v => state.saved.has(v.id));
    const sub = [p.hr ? t("hrNumber") + " " + p.hr : "", p.trade ? catLabel(p.trade) : "", p.site].filter(Boolean).map(esc).join(" · ");
    el.innerHTML = `
      <div class="me-top"><div class="me-head">
        <div class="me-avatar">${esc((p.name || "?").trim().charAt(0).toUpperCase())}</div>
        <div class="me-id"><h1>${esc(p.name || t("me"))}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
        ${loggedIn() ? `<button class="btn btn-sm" id="me-out">${esc(t("signOut"))}</button>` : ""}
      </div></div>
      <div class="me-stats">
        <span><b>${done}</b>${esc(t("statVideos"))}</span>
        <span><b>${passed}</b>${esc(t("statQuizzes"))}</span>
        <span><b>${state.certs.length}</b>${esc(t("statCerts"))}</span>
      </div>
      ${as.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("assigned"))}</h2></div>${as.map(asCard).join("")}</div>` : ""}
      ${due.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("refresherDue"))}</h2></div><p class="section-sub">${esc(t("refresherHint", { n: refMonths() }))}</p><div class="mini-list">${due.map(v => mini(v)).join("")}</div></div>` : ""}
      ${cont.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("continueWatching"))}</h2></div><div class="mini-list">${cont.slice(0, 6).map(v => mini(v)).join("")}</div></div>` : ""}
      <div class="sec"><div class="section-h"><h2>${esc(t("certs"))}</h2></div>
      ${state.certs.length ? `<div class="cert-list">${state.certs.slice().reverse().map(c => `<a class="row-link" href="#/cert/${encodeURIComponent(c.code)}"><span class="ri" style="background:var(--brand-soft);color:var(--brand-ink)">${ICON.award}</span><span><b>${esc(c.title)}</b><small>${esc(fmtDate(c.at))}${c.signedBy ? " · " + esc(t("signedBy", { name: c.signedBy })) : ""} · ${esc(c.code)}</small></span><span class="flip-r" style="color:var(--muted)">${ICON.back}</span></a>`).join("")}</div>` : `<p class="hint">${esc(t("noCerts"))}</p>`}</div>
      <div class="sec"><div class="section-h"><h2>${esc(t("savedVideos"))}</h2>${saved.length > 4 ? `<a href="#/saved">${esc(t("seeAll"))}</a>` : ""}</div>
      ${saved.length ? `<div class="mini-list">${saved.slice(0, 4).map(v => mini(v)).join("")}</div>` : `<p class="hint">${esc(t("savedEmptyHint"))}</p>`}</div>
      ${state.paths.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("paths"))}</h2></div><div class="mini-list">${state.paths.map(pathCard).join("")}</div></div>` : ""}`;
    const mo = $("#me-out"); if (mo) mo.onclick = () => signOut();
  }
  const goBack = () => { if (history.length > 1 && sessionStorage.getItem("ab_in_app")) history.back(); else location.hash = "#/"; };
  function pathCard(p) {
    const { vids, n, done, complete } = pathStats(p), x = pTr(p);
    const pct = n ? Math.round(done / n * 100) : 0;
    if (complete) return pathCardHtml(p, vids, n, done, x, 100, true);
    return pathCardHtml(p, vids, n, done, x, pct, false);
  }
  function pathCardHtml(p, vids, n, done, x, pct, complete) {
    return `<a class="path-card" href="#/p/${encodeURIComponent(p.id)}">
      <div class="pc-top"><span class="pc-ico">${esc(p.icon || "🎓")}</span><div class="pc-thumbs">${vids.slice(0, 3).map(v => `<img loading="lazy" src="${thumb(v.yt)}" alt="">`).join("")}</div></div>
      <h3>${esc(x.title || p.title)}</h3>
      ${p.description ? `<p>${esc(x.description || p.description)}</p>` : ""}
      <div class="pc-bar"><i style="width:${pct}%"></i></div>
      <div class="pc-foot"><span>${esc(t("progress", { done, n }))}</span><span class="pc-go">${esc(complete ? t("doneLabel") + " ✓" : done ? t("continuePath") : t("startPath"))}</span></div>
    </a>`;
  }
  function renderPath(p) {
    const { vids, n, done, next, complete, quizOk } = pathStats(p), x = pTr(p);
    const el = $("#video-view");
    const href = v => `#/v/${encodeURIComponent(v.id)}/p/${encodeURIComponent(p.id)}`;
    const as = myAssignments().find(y => y.p.id === p.id);
    const cert = state.certs.find(c => c.path === p.id);
    const finish = complete
      ? `<button class="btn btn-primary cert-btn" id="p-cert">${ICON.award}<span>${esc(cert ? t("certificate") : t("getCert"))}</span></button>`
      : done === n && !quizOk ? `<p class="notice">${ICON.brain}<span>${esc(t("pathNeedsQuiz"))}</span></p>` : "";
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <div class="path-head">
        <div class="ph-ico">${esc(p.icon || "🎓")}</div>
        <div><h1>${esc(x.title || p.title)}</h1>${x.title ? `<p class="en-title" lang="en" dir="ltr">${esc(p.title)}</p>` : ""}</div>
      </div>
      ${p.description ? `<p class="ph-desc">${esc(x.description || p.description)}</p>` : ""}
      <div class="pc-bar big"><i style="width:${n ? done / n * 100 : 0}%"></i></div>
      <p class="count">${esc(t("progress", { done, n }))}${as && as.a.due ? ` · <b style="${!complete && isOverdue(as.a) ? "color:var(--danger)" : ""}">${esc(!complete && isOverdue(as.a) ? t("overdue") : t("dueBy", { date: fmtDate(as.a.due) }))}</b>` : ""}</p>
      ${finish}
      ${next && !complete ? `<a class="btn btn-primary" style="width:100%;margin:6px 0 18px" href="${href(next)}">${ICON.play}<span>${esc(done ? t("continuePath") : t("startPath"))}</span></a>` : ""}
      <ol class="path-list">${vids.map((v, i) => { const ok = state.done.has(v.id) && quizPassed(v); return `<li class="${ok ? "is-done" : ""}">
        <span class="pl-n">${ok ? "✓" : i + 1}</span>${mini(v, href(v))}${hasQuiz(v) ? `<span class="pl-q${quizPassed(v) ? " ok" : ""}">${esc(t("quizTitle"))}${quizPassed(v) ? " ✓" : ""}</span>` : ""}</li>`; }).join("")}</ol>`;
    $("#back").onclick = goBack;
    const pc = $("#p-cert"); if (pc) pc.onclick = () => getCert(p);
  }

  /* ---------- YouTube player (speed, resume, automatic "done") ---------- */
  let ytLoading = null, yt = null, ytTimer = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytLoading) return ytLoading;
    ytLoading = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch {} res(window.YT); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => rej(new Error("yt"));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error("timeout")), 9000);
    }).catch(e => { ytLoading = null; throw e; });
    return ytLoading;
  }
  function stopPlayer() {
    clearInterval(ytTimer); ytTimer = null;
    if (yt) { try { yt.destroy(); } catch {} yt = null; }
  }
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const fmtT = s => { s = Math.round(s); const m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };

  /* ---------- quick check (quiz) ---------- */
  function quizHtml(v) {
    const prev = state.quiz[v.id];
    const items = quizOf(v);
    const order = items.map(it => it.options.map((_, i) => i).sort(() => Math.random() - 0.5));
    return { order, html: `<section class="panel quiz" id="quiz" ${items.some(i => i.tr) || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>
      <h2>${ICON.brain}${esc(t("quizTitle"))}${prev && prev.pass ? ` <span class="q-pass">✓ ${esc(t("quizPassed"))}</span>` : ""}</h2>
      <p class="hint">${esc(prev && prev.pass ? t("quizScore", { score: prev.score, n: prev.n }) + " · " + fmtDate(prev.at) : t("quizHint"))}</p>
      <form id="quiz-form">${items.map((it, qi) => `<fieldset class="q-item" data-q="${qi}"><legend><span class="num">${qi + 1}</span>${esc(it.q)}</legend>
        ${order[qi].map(oi => `<label class="q-opt"><input type="radio" name="q${qi}" value="${oi}"><span>${esc(it.options[oi])}</span></label>`).join("")}</fieldset>`).join("")}
        <p class="q-result" id="q-result" role="status" aria-live="polite"></p>
        <button class="btn btn-primary" id="q-check" style="width:100%">${esc(prev && prev.pass ? t("quizAgain") : t("quizCheck"))}</button>
      </form></section>` };
  }
  function wireQuiz(v, path, rerender) {
    const f = $("#quiz-form"); if (!f) return;
    let checked = false;
    f.onsubmit = e => {
      e.preventDefault();
      if (checked) { rerender(); setTimeout(() => { const q = $("#quiz"); if (q) q.scrollIntoView({ block: "start" }); }, 30); return; }
      const items = v.quiz, picks = items.map((_, qi) => { const x = f.querySelector(`input[name="q${qi}"]:checked`); return x ? +x.value : null; });
      const res = $("#q-result");
      if (picks.some(p => p === null)) { res.textContent = t("quizPick"); res.className = "q-result bad"; return; }
      const score = picks.filter((p, i) => p === items[i].answer).length, n = items.length;
      const pass = score * 100 / n >= passMark() - 0.01;
      $$(".q-item", f).forEach((fs, qi) => {
        fs.classList.add(picks[qi] === items[qi].answer ? "right" : "wrong");
        $$("label", fs).forEach(l => { const iv = +l.querySelector("input").value; if (iv === items[qi].answer) l.classList.add("is-answer"); l.querySelector("input").disabled = true; });
      });
      const prev = state.quiz[v.id];
      if (pass || !prev || !prev.pass) { state.quiz[v.id] = { score, n, pass, at: localDay() }; store.set("ab_quiz", state.quiz); }
      record("quiz", { item: v.id, title: v.title, score, n, pass });
      res.innerHTML = `<b>${esc(t("quizScore", { score, n }))}</b> — ${esc(pass ? "✓ " + t("quizPassed") : t("quizFailed"))}`;
      res.className = "q-result " + (pass ? "ok" : "bad");
      if (pass && !state.done.has(v.id)) setDone(v.id, true);
      else if (pass) checkPaths();
      checked = true;
      $("#q-check").textContent = t("quizRetry");
      const pn = $("#path-next"); if (pn && pass) pn.classList.add("pulse");
    };
  }

  /* ---------- rendering: video page ---------- */
  function renderVideo(v, path) {
    const x = tr(v);
    const steps = (x.steps && x.steps.length === v.steps.length) ? x.steps : v.steps;
    const ppe = (x.ppe && x.ppe.length === v.ppe.length) ? x.ppe : v.ppe;
    const hasAnyTr = state.lang !== "en" && v.tr && v.tr[state.lang];
    const langName = (LANGS.find(l => l.code === state.lang) || {}).name || "";
    const done = store.get("ab_steps_" + v.id, []);
    const on = state.saved.has(v.id);
    const related = state.videos.filter(o => o.id !== v.id && o.category === v.category)
      .sort((a, b) => (a.subject === v.subject ? -1 : 0) - (b.subject === v.subject ? -1 : 0)).slice(0, 4);
    let ctx = catLabel(v.category), nextHref = "";
    if (path) {
      const pv = pathVideos(path), i = pv.findIndex(o => o.id === v.id), nx = pv[i + 1];
      ctx = `${pTr(path).title || path.title} · ${i + 1} / ${pv.length}`;
      if (nx) nextHref = `#/v/${encodeURIComponent(nx.id)}/p/${encodeURIComponent(path.id)}`;
    } else if (related[0]) nextHref = `#/v/${encodeURIComponent(related[0].id)}`;
    const el = $("#video-view");
    const quizBlock = hasQuiz(v) ? quizHtml(v) : null;
    if (navigator.onLine) loadYT().catch(() => {});
    el.innerHTML = `
      <div class="vbar">
        <button class="icon-btn" id="back" aria-label="${esc(t("back"))}">${ICON.back}</button>
        <span class="ctx">${esc(ctx)}</span>
        <button class="icon-btn" id="v-save" aria-pressed="${on}" aria-label="${esc(on ? t("savedLabel") : t("save"))}">${on ? ICON.bookmarkOn : ICON.bookmark}</button>
        <button class="icon-btn" id="v-share" aria-label="${esc(t("share"))}">${ICON.share}</button>
      </div>
      <div class="player" id="player"></div>
      <div class="speed" id="speed" role="group" aria-label="${esc(t("speed"))}"><span>${esc(t("speed"))}</span>${SPEEDS.map(s => `<button data-speed="${s}" aria-pressed="${s === state.speed}">${s}×</button>`).join("")}</div>
      <h1>${esc(x.title || v.title)}</h1>
      ${x.title ? `<p class="en-title" lang="en" dir="ltr">${esc(v.title)}</p>` : ""}
      <div class="meta">
        <span class="cat-tag" style="${catTone(v.category)}">${esc(catLabel(v.category))}</span>
        <span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span>
        ${v.duration ? `<span>${esc(v.duration)}</span>` : ""}
        ${v.channel ? `<span class="dot">${esc(v.channel)}</span>` : ""}
      </div>
      ${steps.length ? `<div class="mode-tabs" role="tablist">
        <button role="tab" data-mode="video" aria-selected="true">${ICON.play}<span>${esc(t("watch"))}</span></button>
        <button role="tab" data-mode="guide" aria-selected="false">${ICON.list}<span>${esc(t("tabGuide"))}</span></button>
      </div>` : ""}
      ${hasAnyTr ? `<div class="tr-note"><span>${state.showEn ? "English" : esc(t("autoNote"))}</span><button class="btn btn-sm" id="tr-toggle">${state.showEn ? esc(langName) : "English"}</button></div>` : ""}
      ${v.safety || v.ppe.length ? `<section class="panel safety">
        <h2>${ICON.shield}${esc(t("safety"))}</h2>
        ${v.safety ? `<p>${esc(x.safety || v.safety)}</p>` : ""}
        ${ppe.length ? `<div class="ppe" aria-label="${esc(t("ppe"))}">${ppe.map(p => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
      </section>` : ""}
      ${steps.length ? `<section class="panel">
        <h2>${ICON.list}${esc(t("steps"))}</h2>
        <p class="hint">${esc(t("stepsHint"))}</p>
        <div class="progress"><i id="prog"></i></div>
        <ol class="steps">${steps.map((s, i) => `<li><label><input type="checkbox" data-step="${i}" ${done.includes(i) ? "checked" : ""}><span class="num">${i + 1}</span><span>${esc(s)}</span></label></li>`).join("")}</ol>
      </section>` : ""}
      ${refresherDue(v) ? `<p class="notice refresh-note">${ICON.shield}<span>${esc(t("refresherHint", { n: refMonths() }))}</span></p>` : ""}
      ${hasQuiz(v) ? quizBlock.html : ""}
      ${v.summary ? `<section class="panel"><h2>${ICON.info}${esc(t("about"))}</h2><p>${esc(x.summary || v.summary)}</p>
        ${state.lang !== "en" ? `<p class="subnote">${esc(t("subtitles"))}</p>` : ""}</section>` : ""}
      <div class="vbottom">
        <button class="btn${state.done.has(v.id) && !refresherDue(v) ? " is-done" : ""}" id="v-done" aria-pressed="${state.done.has(v.id)}"></button>
        ${nextHref ? `<a class="btn btn-dark" href="${nextHref}" id="path-next"><span>${esc(path ? t("nextVideo") : t("related"))}</span>${ICON.next}</a>` : `<a class="btn" href="#/">${esc(t("home"))}</a>`}
      </div>
      <div class="vlinks"><a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.yt)}" target="_blank" rel="noopener">${ICON.yt}<span>${esc(t("watchOnYouTube"))}</span></a></div>
      ${related.length ? `<div class="sec"><div class="section-h"><h2>${esc(t("related"))}</h2></div><div class="mini-list">${related.map(v2 => mini(v2)).join("")}</div></div>` : ""}
    `;
    const updateProg = () => {
      const boxes = $$("[data-step]", el), n = boxes.filter(b => b.checked).length;
      const p = $("#prog"); if (p) p.style.width = (boxes.length ? (n / boxes.length) * 100 : 0) + "%";
    };
    updateProg();
    const player = $("#player");
    /* --- Video (default) --- */
    function showPoster() {
      stopSpeech(); stopPlayer();
      player.classList.remove("is-guide");
      const w = state.watch[v.id], resume = w && w.t >= 15 && (!w.d || w.t < w.d * 0.9) ? w.t : 0;
      player.innerHTML = `<button class="poster" id="poster" aria-label="${esc(t("play"))}"><img src="${thumb(v.yt, "hqdefault")}" alt=""><span class="play">${ICON.play}</span>${resume ? `<span class="resume">▶ ${esc(t("resumeAt", { time: fmtT(resume) }))}</span>` : ""}</button>`;
      $("#poster").onclick = () => play(resume);
    }
    let viewed = false;
    function markWatched() {
      if (!state.done.has(v.id)) { setDone(v.id, true); drawDone(); toast(t("doneLabel") + " ✓"); }
      else if (refresherDue(v)) { state.doneAt[v.id] = localDay(); store.set("ab_done_at", state.doneAt); record("video", { item: v.id, title: v.title, refresher: true }); drawDone(); toast("🦺 " + t("doneLabel") + " ✓"); }
      delete state.watch[v.id]; store.set("ab_watch", state.watch);
    }
    async function play(start) {
      const hl = state.lang === "tl" ? "fil" : state.lang;
      const fallback = () => {
        const cc = state.lang !== "en" ? `&cc_load_policy=1&cc_lang_pref=${state.lang}` : "";
        const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.yt)}?autoplay=1&rel=0&playsinline=1&modestbranding=1&hl=${hl}${cc}${start ? "&start=" + Math.floor(start) : ""}`;
        player.innerHTML = `<iframe src="${src}" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
        $("#speed").hidden = true;
      };
      if (!viewed) { viewed = true; stat("view", v.id); }
      let YTx;
      try { YTx = await loadYT(); } catch { return fallback(); }
      if (!document.body.contains(player)) return;
      player.innerHTML = `<div id="yt-slot"></div>`;
      const vars = { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, hl };
      if (state.lang !== "en") { vars.cc_load_policy = 1; vars.cc_lang_pref = state.lang; }
      if (start) vars.start = Math.floor(start);
      try {
        yt = new YTx.Player("yt-slot", {
          host: "https://www.youtube-nocookie.com", videoId: v.yt, playerVars: vars,
          events: {
            onReady: e => { try { e.target.setPlaybackRate(state.speed); e.target.playVideo(); } catch {} },
            onStateChange: e => {
              const p = e.target;
              if (e.data === 1) {                                   // playing
                clearInterval(ytTimer);
                ytTimer = setInterval(() => {
                  try {
                    const tNow = p.getCurrentTime(), d = p.getDuration();
                    if (d > 0 && tNow / d >= 0.9) { markWatched(); clearInterval(ytTimer); }
                    else if (tNow > 5) saveWatch(v.id, tNow, d);
                  } catch {}
                }, 5000);
              } else if (e.data === 0) { clearInterval(ytTimer); markWatched(); }   // ended
              else if (e.data === 2) {                              // paused: remember the place
                clearInterval(ytTimer);
                try { const tNow = p.getCurrentTime(), d = p.getDuration(); if (tNow > 5 && !(d && tNow / d >= 0.9)) saveWatch(v.id, tNow, d); } catch {}
              }
            }
          }
        });
      } catch { fallback(); }
    }
    $("#speed").addEventListener("click", e => {
      const b = e.target.closest("[data-speed]"); if (!b) return;
      state.speed = +b.dataset.speed; store.set("ab_speed", state.speed);
      $$("[data-speed]", $("#speed")).forEach(x => x.setAttribute("aria-pressed", +x.dataset.speed === state.speed));
      if (yt && yt.setPlaybackRate) try { yt.setPlaybackRate(state.speed); } catch {}
    });
    /* --- Step guide (secondary): one step per screen, optional voice read-out --- */
    const hasTr = !!(x.steps && x.steps.length === v.steps.length);
    const slides = [];
    if (v.safety || v.ppe.length) slides.push({ safety: true, text: x.safety || v.safety, say: (hasTr ? x.safety : v.safety) || "" });
    steps.forEach((s, i) => slides.push({ n: i + 1, text: s, say: s }));
    let idx = 0, speaking = false;
    const canSpeak = "speechSynthesis" in window;
    const speechLang = hasTr ? state.lang : "en";
    const BCP = { en: "en-GB", hi: "hi-IN", ur: "ur-PK", ml: "ml-IN", bn: "bn-IN", ta: "ta-IN", ne: "ne-NP", tl: "fil-PH", ar: "ar-SA" };
    function speak() {
      if (!canSpeak) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance((slides[idx].n ? `${t("steps")} ${slides[idx].n}. ` : `${t("safety")}. `) + slides[idx].say);
      u.lang = BCP[speechLang] || "en-GB";
      const voice = speechSynthesis.getVoices().find(vo => vo.lang && vo.lang.toLowerCase().startsWith(speechLang === "tl" ? "fil" : speechLang));
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.onend = () => { if (!speaking) return; if (idx < slides.length - 1) { idx++; drawSlide(); speak(); } else { speaking = false; drawSlide(); } };
      speechSynthesis.speak(u);
    }
    function drawSlide() {
      const sl = slides[idx], last = slides.length - 1;
      player.classList.add("is-guide");
      player.innerHTML = `<div class="guide" ${hasTr || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>
        <div class="g-top"><span class="g-badge">${esc(t("tabGuide"))}</span><span class="g-count">${sl.n ? `${sl.n} / ${steps.length}` : esc(t("safety"))}</span></div>
        <div class="g-body ${sl.safety ? "g-safety" : ""}">
          ${sl.safety ? `<div class="g-ico">${ICON.shield}</div>` : `<div class="g-num">${sl.n}</div>`}
          <p>${esc(sl.text)}</p>
          ${sl.safety && ppe.length ? `<div class="ppe">${ppe.map(p => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="g-bar"><i style="width:${((idx + 1) / slides.length) * 100}%"></i></div>
        <div class="g-ctl">
          <button class="g-btn" data-g="prev" aria-label="Previous" ${idx === 0 ? "disabled" : ""}>${ICON.back}</button>
          ${canSpeak ? `<button class="g-btn g-listen" data-g="listen" aria-pressed="${speaking}">${speaking ? "⏹" : "🔊"} <span>${esc(speaking ? t("stop") : t("listen"))}</span></button>` : "<span></span>"}
          <button class="g-btn" data-g="next" aria-label="Next" ${idx === last ? "disabled" : ""}><span class="flip-r">${ICON.back}</span></button>
        </div>
      </div>`;
    }
    function stopSpeech() { speaking = false; if (canSpeak) speechSynthesis.cancel(); }
    player.addEventListener("click", e => {
      const g = e.target.closest("[data-g]"); if (!g) return;
      if (g.dataset.g === "listen") { speaking = !speaking; if (speaking) speak(); else stopSpeech(); drawSlide(); return; }
      idx = Math.max(0, Math.min(slides.length - 1, idx + (g.dataset.g === "next" ? 1 : -1)));
      drawSlide();
      if (speaking) speak();
    });
    let sx = null;
    player.addEventListener("touchstart", e => { if (player.classList.contains("is-guide")) sx = e.touches[0].clientX; }, { passive: true });
    player.addEventListener("touchend", e => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) < 50) return;
      const fwd = (document.documentElement.dir === "rtl") ? dx > 0 : dx < 0;
      idx = Math.max(0, Math.min(slides.length - 1, idx + (fwd ? 1 : -1)));
      drawSlide(); if (speaking) speak();
    });
    $$(".mode-tabs [data-mode]", el).forEach(b => b.onclick = () => {
      $$(".mode-tabs [data-mode]", el).forEach(o => o.setAttribute("aria-selected", o === b));
      if (b.dataset.mode === "guide") { stopPlayer(); idx = 0; drawSlide(); } else showPoster();
      $("#speed").hidden = b.dataset.mode === "guide";
    });
    function drawDone() {
      const d = state.done.has(v.id), due = refresherDue(v), b = $("#v-done");
      if (!b) return;
      b.setAttribute("aria-pressed", d && !due); b.classList.toggle("is-done", d && !due);
      b.innerHTML = due ? `${ICON.redo}<span>${esc(t("markRefreshed"))}</span>` : `${d ? ICON.check : ""}<span>${esc(d ? t("doneLabel") : t("markDone"))}</span>`;
    }
    drawDone();
    showPoster();
    const tt = $("#tr-toggle");
    if (tt) tt.onclick = () => { stopPlayer(); state.showEn = !state.showEn; renderVideo(v, path); };
    $("#v-done").onclick = () => {
      if (refresherDue(v)) { markWatched(); return; }
      setDone(v.id, !state.done.has(v.id)); drawDone(); if (state.done.has(v.id)) toast(t("doneLabel") + " ✓");
    };
    if (quizBlock) wireQuiz(v, path, () => { stopPlayer(); const y = scrollY; renderVideo(v, path); scrollTo(0, y); });
    const pn = $("#path-next");
    if (pn && path) pn.addEventListener("click", () => { if (!state.done.has(v.id)) setDone(v.id, true); });
    $("#back").onclick = goBack;
    $("#v-save").onclick = () => {
      toggleSave(v.id);
      const now = state.saved.has(v.id), b = $("#v-save");
      b.setAttribute("aria-pressed", now); b.setAttribute("aria-label", now ? t("savedLabel") : t("save"));
      b.innerHTML = now ? ICON.bookmarkOn : ICON.bookmark;
    };
    $("#v-share").onclick = () => share(v);
    el.addEventListener("change", e => {
      const b = e.target.closest("[data-step]"); if (!b) return;
      const ids = $$("[data-step]", el).filter(x => x.checked).map(x => +x.dataset.step);
      store.set("ab_steps_" + v.id, ids);
      updateProg();
      if (ids.length === steps.length && !state.done.has(v.id)) { setDone(v.id, true); drawDone(); toast(t("doneLabel") + " ✓"); }
    });
  }

  async function share(v) {
    const url = link(v);
    const text = `▶ ${titleOf(v)}\n${catLabel(v.category)} · ${t(v.level)}${v.duration ? " · " + v.duration : ""}`;
    if (navigator.share) { try { await navigator.share({ title: titleOf(v), text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener");
  }
  function toggleSave(id) {
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    store.set("ab_saved", [...state.saved]);
    if (state.saved.has(id)) toast(t("savedLabel") + " ✓");
  }

  /* ---------- routing ---------- */
  function route() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    stopPlayer();
    document.body.classList.remove("ai-mode", "ai-typing");
    const h = location.hash.replace(/^#\/?/, "");
    const [kind, arg, k2, a2] = h.split("/");
    const lv = $("#list-view"), vv = $("#video-view"), hv = $("#home-view");
    hv.hidden = true;
    const showPage = title => {
      if (!lv.hidden) state.listScroll = scrollY;
      lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
      scrollTo(0, 0);
      document.title = title + " · ABFM Training";
    };
    // Anyone can check a certificate link; everything else needs sign-in when it is turned on.
    if (kind === "verify" && arg) { $("#login-view").hidden = true; document.body.classList.remove("locked"); showPage(t("verify")); renderVerify(decodeURIComponent(arg)); return; }
    if (state.ready && loginNeeded()) { lv.hidden = true; vv.hidden = true; $("#search-wrap").hidden = true; renderLogin(); return; }
    applySettings();
    $("#login-view").hidden = true; document.body.classList.remove("locked");
    const meB = $("#me-badge"), nDue = dueRefreshers().length + myAssignments().filter(x => !pathStats(x.p).complete && isOverdue(x.a)).length;
    meB.hidden = !nDue; meB.textContent = nDue;
    if (kind === "me") { showPage(t("me")); renderMe(); setTab("me"); return; }
    if (kind === "cert" && arg) {
      const c = state.certs.find(x => x.code === decodeURIComponent(arg));
      if (c) { showPage(t("certificate")); renderCert(c); setTab("me"); return; }
    }
    if (kind === "ai" && aiOn()) {
      if (!lv.hidden) state.listScroll = scrollY;
      lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
      renderAI();
      document.title = t("askAi") + " · ABFM Training";
      setTab("ai");
      return;
    }
    if (kind === "talk") {
      const k = arg ? state.talks.find(x => x.id === decodeURIComponent(arg)) : todayTalk();
      if (k) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        renderTalk(k);
        scrollTo(0, 0);
        document.title = (kTr(k).title || k.title) + " · ABFM Training";
        return;
      }
    }
    if (kind === "p" && arg) {
      const p = state.paths.find(x => x.id === decodeURIComponent(arg));
      if (p) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        renderPath(p);
        scrollTo(0, 0);
        document.title = (pTr(p).title || p.title) + " · ABFM Training";
        return;
      }
    }
    if (kind === "v" && arg) {
      const v = state.videos.find(x => x.id === decodeURIComponent(arg));
      if (v) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        const path = k2 === "p" && a2 ? state.paths.find(x => x.id === decodeURIComponent(a2)) : null;
        renderVideo(v, path);
        scrollTo(0, 0);
        document.title = titleOf(v) + " · ABFM Training";
        return;
      }
    }
    const wasVideo = !vv.hidden;
    vv.hidden = true; vv.innerHTML = "";
    document.title = "ABFM Training";
    if (!["library", "new", "saved"].includes(kind)) {
      lv.hidden = true; $("#search-wrap").hidden = true; hv.hidden = false;
      renderHome();
      if (wasVideo && state.homeScroll) requestAnimationFrame(() => scrollTo(0, state.homeScroll));
      return;
    }
    lv.hidden = false; $("#search-wrap").hidden = false;
    if (kind !== state.tab) { state.tab = kind; state.limit = PAGE; }
    renderList();
    if (wasVideo) requestAnimationFrame(() => scrollTo(0, state.listScroll));
  }

  /* ---------- events ---------- */
  function bind() {
    window.addEventListener("hashchange", () => { sessionStorage.setItem("ab_in_app", "1"); if (!$("#home-view").hidden) state.homeScroll = scrollY; route(); });
    let qTimer;
    $("#q").addEventListener("input", e => {
      $("#q-clear").hidden = !e.target.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value; state.limit = PAGE; renderList(); }, 150);
    });
    $("#q").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
    $("#q-clear").onclick = () => { $("#q").value = ""; $("#q-clear").hidden = true; state.q = ""; renderList(); $("#q").focus(); };
    $("#sort").onchange = e => { state.sort = e.target.value; renderList(); };
    $("#more").onclick = () => { state.limit += PAGE; renderList(); };

    document.addEventListener("click", e => {
      const save = e.target.closest("[data-save]");
      if (save) { e.preventDefault(); toggleSave(save.dataset.save); const on = state.saved.has(save.dataset.save); save.setAttribute("aria-pressed", on); save.innerHTML = on ? ICON.bookmarkOn : ICON.bookmark; if ($("#video-view").hidden && state.tab === "saved") renderList(); return; }
      const c = e.target.closest("[data-cat]");
      if (c) { state.cat = c.dataset.cat; state.limit = PAGE; renderList(); return; }
      const l = e.target.closest("[data-level]");
      if (l) { state.level = l.dataset.level; state.limit = PAGE; renderList(); return; }
      const tb = e.target.closest("[data-tab]");
      if (tb) {
        if (tb.dataset.tab === "library" && state.tab === "library" && !$("#list-view").hidden) { state.cat = "ALL"; state.level = "ALL"; renderList(); }
        location.hash = tb.dataset.tab === "home" ? "#/" : "#/" + tb.dataset.tab; scrollTo(0, 0); return;
      }
      if (e.target.closest("#clear-all")) { state.cat = "ALL"; state.level = "ALL"; state.q = ""; $("#q").value = ""; $("#q-clear").hidden = true; renderList(); return; }
      const lg = e.target.closest("[data-lang]");
      if (lg) { state.showEn = false; state.lang = lg.dataset.lang; store.set("ab_lang", state.lang); closeSheets(); applyLang(); if (state.ready && !loginNeeded()) load(); else route(); return; }
      if (e.target.closest("[data-request]")) { openRequest(state.q); return; }
      if (e.target.closest("[data-close]") || e.target.classList.contains("sheet")) closeSheets();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
    $("#lang-btn").onclick = () => openSheet("#lang-sheet");
    $("#req-form").addEventListener("submit", sendRequest);
    document.addEventListener("click", () => { const m = $("#ai-menu"); if (m && !m.hidden) { m.hidden = true; const c = $("#ai-cam"); if (c) c.setAttribute("aria-expanded", "false"); } });

    const off = () => { const o = $("#offline"); o.hidden = navigator.onLine; o.innerHTML = ICON.wifi + "<span>" + esc(t("offline")) + "</span>"; if (navigator.onLine) { flush(); sendStats(); } };
    addEventListener("online", off); addEventListener("offline", off); off();
  }

  /* ---------- install as app ---------- */
  function setupInstall() {
    let deferred = null;
    const btn = $("#install-btn");
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; btn.hidden = false; });
    addEventListener("appinstalled", () => { btn.hidden = true; deferred = null; });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios) btn.hidden = false;
    btn.onclick = async () => {
      if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; }
      else if (ios) openSheet("#ios-sheet");
    };
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  /* ---------- start ---------- */
  const firstVisit = !state.lang;
  if (!state.lang) {
    const nav = (navigator.language || "en").slice(0, 2);
    state.lang = LANGS.some(l => l.code === nav) ? nav : "en";
  }
  applyLang();
  bind();
  setupInstall();
  load();
  if (firstVisit) { store.set("ab_lang", state.lang); openSheet("#lang-sheet"); }
})();
