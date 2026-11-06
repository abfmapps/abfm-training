/* Al Bonian FM — Training admin.
   Content, staff and records are kept in Supabase. Sign in with your admin email and password.
   Videos themselves always stay on YouTube — only text is saved here. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const thumb = yt => `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/mqdefault.jpg`;
  const LEVELS = ["Beginner", "Intermediate", "Advanced"];
  const TR_LANGS = [["hi", "Hindi"], ["ur", "Urdu"], ["ml", "Malayalam"], ["bn", "Bengali"], ["ta", "Tamil"], ["ne", "Nepali"], ["tl", "Filipino"], ["ar", "Arabic"]];
  const CFG_KEY = "ab_admin_github";
  const FILES = { videos: "data/videos.json", settings: "data/settings.json", channels: "data/channels.json", pending: "data/pending.json", health: "data/health.json", paths: "data/paths.json", toolbox: "data/toolbox.json" };
  const DEFAULTS = {
    videos: () => ({ updated: today(), videos: [] }),
    settings: () => ({ categories: [], newDays: 7 }),
    channels: () => ({ lookbackDays: 21, skipShorts: true, maxQueue: 150, channels: [] }),
    pending: () => ({ lastRun: null, channelStatus: {}, queue: [], rejected: [] }),
    health: () => ({ checked: null, problems: [] }),
    paths: () => ({ paths: [] }),
    toolbox: () => ({ talks: [] })
  };

  const SB = window.AB_CONFIG || {};
  const sb = window.supabase.createClient(SB.url, SB.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // Email links (confirm, reset password) return to admin.html.
  const AUTH_RETURN = new URL("admin.html", location.href).href;
  let me = null;                        // signed-in admin's email
  let superAdmin = false;               // only the super admin (the owner) sees the restricted Settings sections
  const SUPER_ONLY = ["inbox", "gemini", "admins", "status"];
  let cfg = loadCfg();                  // optional GitHub link, only to start the daily jobs from here
  const data = {};
  let view = "dashboard";
  const ui = { q: "", cat: "ALL", show: "all" };

  /* ---------- small UI helpers ---------- */
  let tt;
  function toast(m) { const el = $("#toast"); el.textContent = m; el.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("show"), 2600); }
  const busy = on => { $("#saving").hidden = !on; };

  /* ---------- GitHub (optional): start the daily jobs now instead of waiting for the schedule ---------- */
  function loadCfg() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch {}
    return Object.assign({ owner: "abfmapps", repo: "abfm-training", branch: "main", token: "" }, c || {});
  }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} }
  /* Shared keys: the owner saves the Gemini, Groq, OpenRouter and GitHub keys once on the server (private.app_secrets).
     Every admin can then use them through the admin-proxy edge function; no browser ever sees them. */
  let keys = { owner: false, gemini: false, groq: false, openrouter: false, github: false };
  async function proxyFetch(payload, signal) {
    const { data: d } = await sb.auth.getSession();
    return fetch(SB.url + "/functions/v1/admin-proxy", {
      method: "POST", signal, cache: "no-store",
      headers: { "Content-Type": "application/json", apikey: SB.anonKey, Authorization: "Bearer " + (d && d.session ? d.session.access_token : SB.anonKey) },
      body: JSON.stringify(payload)
    });
  }
  window.ABProxy = {
    get groq() { return keys.groq; },
    get openrouter() { return keys.openrouter; },
    fetchGemini: (model, body, signal) => proxyFetch({ kind: "gemini", model, body }, signal),
    call: async payload => { const r = await proxyFetch(payload); return { status: r.status, json: await r.json().catch(() => ({})) }; }
  };
  async function loadKeys() {
    const { data: k } = await sb.rpc("admin_secret_status");
    if (k && k.ok) keys = k;
    keys.owner = keys.owner && superAdmin;
    if (!keys.owner) return loadEnvKeys();
    // First time: move the owner's keys from this browser to the server so every admin can use them.
    const moved = [];
    const local = (() => { try { return localStorage.getItem("ab_gemini_key") || ""; } catch { return ""; } })();
    if (!keys.gemini && local && !(await sb.rpc("admin_set_secret", { p_name: "gemini", p_value: local })).error) { keys.gemini = true; moved.push("Gemini key"); }
    if (!keys.github && cfg.token && !(await sb.rpc("admin_set_secret", { p_name: "github", p_value: cfg.token })).error) { keys.github = true; moved.push("GitHub token"); }
    if (keys.gemini) { try { localStorage.removeItem("ab_gemini_key"); } catch {} }
    if (keys.github && cfg.token) { cfg.token = ""; saveCfg(cfg); }
    await loadEnvKeys();
    if (moved.length) toast(`Your ${moved.join(" and ")} now work for all admins (kept on the server, never shown).`);
  }
  /* Keys saved as Supabase Edge Function secrets (e.g. GROQ_API_KEY) count too. */
  async function loadEnvKeys() {
    try {
      const st = await window.ABProxy.call({ kind: "status" });
      if (st.status === 200) ["gemini", "groq", "openrouter", "github"].forEach(n => { if (st.json[n]) keys[n] = true; });
    } catch {}
  }
  const hasGh = () => !!cfg.token || keys.github;
  async function gh(path, opts = {}) {
    if (!cfg.token) {
      if (!keys.github) return { status: 401, ok: false, json: async () => ({}) };
      return proxyFetch({ kind: "github", path, method: opts.method || "GET", body: opts.body });
    }
    return fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store"
    });
  }
  const noToken = () => keys.owner ? `${ABIcon("alert")} To start jobs from here, add a GitHub token in <b>Settings → Admins & GitHub</b>. Without one, the jobs still run on their schedule.` : `${ABIcon("alert")} Starting jobs from here isn't set up yet — ask the owner to add the GitHub token. The jobs still run on their schedule.`;

  /* ---------- content documents in Supabase ---------- */
  async function readFile(key) {
    const { data: row, error } = await sb.from("docs").select("content, version").eq("name", key).maybeSingle();
    if (error) throw new Error(`Could not read ${key}: ${error.message}`);
    if (!row) return { json: DEFAULTS[key](), sha: 0 };
    return { json: row.content, sha: row.version };
  }
  async function writeFile(key, json, version) {
    const { data: r, error } = await sb.rpc("admin_save_doc", { p_name: key, p_content: json, p_version: version || 0 });
    if (error) throw new Error("Couldn't save: " + error.message);
    if (!r.ok) { const e = new Error("conflict"); e.conflict = true; throw e; }
    return r.version;
  }
  /* Read the latest copy, apply the change, save. Retries if it changed meanwhile (e.g. the daily job ran). */
  async function update(key, fn, message) {
    busy(true);
    try {
      for (let i = 0; i < 3; i++) {
        // First try with the copy already on screen (saves downloading the whole file again); if someone else saved
        // meanwhile the version check fails and it reads the latest copy and tries again.
        const { json, sha } = i === 0 && data[key] && data[key].sha ? { json: JSON.parse(JSON.stringify(data[key].json)), sha: data[key].sha } : await readFile(key);
        const next = fn(json) || json;
        try {
          const newVer = await writeFile(key, next, sha, message);
          data[key] = { json: next, sha: newVer };
          return next;
        } catch (e) { if (!e.conflict || i === 2) throw e; }
      }
    } catch (e) {
      alert(e.message === "conflict" ? "Someone else saved this at the same moment. Please try again." : (e.message || String(e)));
      throw e;
    } finally { busy(false); }
  }

  /* Instant save: the change shows on screen straight away and is saved in the background, one save at a time per file.
     If someone else saved meanwhile, it reads their copy, applies the pending changes again and retries. */
  const fastQ = {}; let rev = 0;
  function updateFast(key, fn, message) {
    const q = fastQ[key] || (fastQ[key] = { fns: [], running: false });
    fn(data[key].json); q.fns.push(fn); rev++;
    if (!q.running) flushFast(key, q);
    return Promise.resolve();
  }
  async function flushFast(key, q) {
    q.running = true; busy(true);
    try {
      while (q.fns.length) {
        let applied = q.fns.length, done = false;
        for (let i = 0; i < 3 && !done; i++) {
          let json = data[key].json, sha = data[key].sha;
          if (i > 0) { const f = await readFile(key); json = f.json; sha = f.sha; q.fns.forEach(fn => fn(json)); applied = q.fns.length; }
          try { const v = await writeFile(key, json, sha); data[key] = { json, sha: v }; done = true; }
          catch (e) { if (!e.conflict || i === 2) throw e; }
        }
        q.fns.splice(0, applied);
      }
    } catch (e) {
      q.fns.length = 0;
      alert("Couldn't save that: " + (e.message === "conflict" ? "someone else saved at the same moment" : e.message) + ". The page will show the saved version.");
      try { data[key] = await readFile(key); } catch {}
      rev++; render();
    } finally { q.running = false; busy(false); }
  }

  /* ---------- YouTube helpers ---------- */
  function parseYT(s) {
    s = (s || "").trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/|\/v\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  async function fetchMeta(yt) {
    const watch = "https://www.youtube.com/watch?v=" + yt;
    const tries = [
      "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch),
      "https://noembed.com/embed?url=" + encodeURIComponent(watch)
    ];
    for (const u of tries) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.title) return { title: j.title, channel: j.author_name || "" };
      } catch {}
    }
    return null;
  }

  /* ---------- sign-in screen (Supabase email + password) ---------- */
  function renderConnect(error, mode = "in") {
    $("#tabs").hidden = true; $("#bnav").hidden = true; closeMore(); $("#page-h").hidden = true; $("#disconnect").hidden = !me; $("#repo-label").textContent = me ? me : "Not signed in";
    const title = { in: "Sign in", up: "Create your admin account", reset: "Reset your password", newpw: "Choose a new password" }[mode];
    $("#app").innerHTML = `
      <div class="connect">
        <div class="card-plain">
          <h2>${title}</h2>
          ${mode === "in" ? `<p>Sign in with your admin email and password.</p>` : mode === "up" ? `<p>Use the email address the training team added as an admin. You'll get an email to confirm it.</p>` : mode === "reset" ? `<p>We'll email you a link to choose a new password.</p>` : ""}
          ${error ? `<div class="err">${error}</div>` : ""}
          <form id="connect-form">
            ${mode !== "newpw" ? `<div class="field"><label for="c-email">Email</label><input class="input" id="c-email" type="email" required autocomplete="username" spellcheck="false"></div>` : ""}
            ${mode !== "reset" ? `<div class="field"><label for="c-pw">${mode === "newpw" ? "New password" : "Password"}</label><input class="input" id="c-pw" type="password" required minlength="8" autocomplete="${mode === "in" ? "current-password" : "new-password"}"><div class="help">${mode === "in" ? "" : "At least 8 characters."}</div></div>` : ""}
            <button class="btn btn-primary" style="width:100%;margin-top:8px">${{ in: "Sign in", up: "Create account", reset: "Send reset link", newpw: "Save new password" }[mode]}</button>
          </form>
          <p class="help" style="margin-top:12px;text-align:center">
            ${mode === "in" ? `<a href="#" data-mode="up">Create an admin account</a> · <a href="#" data-mode="reset">Forgot password?</a>` : mode === "newpw" ? "" : `<a href="#" data-mode="in">Back to sign in</a>`}
          </p>
        </div>
      </div>`;
    $$("[data-mode]").forEach(a => a.onclick = e => { e.preventDefault(); renderConnect("", a.dataset.mode); });
    $("#connect-form").onsubmit = async e => {
      e.preventDefault();
      const email = $("#c-email") ? $("#c-email").value.trim() : "", pw = $("#c-pw") ? $("#c-pw").value : "";
      busy(true);
      try {
        if (mode === "in") {
          const { error } = await sb.auth.signInWithPassword({ email, password: pw });
          if (error) throw new Error(/confirm/i.test(error.message) ? "Please confirm your email first — check your inbox." : /invalid/i.test(error.message) ? "Wrong email or password." : error.message);
          await afterSignIn();
        } else if (mode === "up") {
          const { error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: AUTH_RETURN } });
          if (error) throw new Error(error.message);
          renderConnect("" + ABIcon("checkCircle") + " Account created. Check your email and click the link to confirm it, then sign in.", "in");
        } else if (mode === "reset") {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: AUTH_RETURN });
          if (error) throw new Error(error.message);
          renderConnect("" + ABIcon("checkCircle") + " If that email has an account, a reset link is on its way.", "in");
        } else {
          const { error } = await sb.auth.updateUser({ password: pw });
          if (error) throw new Error(error.message);
          toast("Password changed."); await afterSignIn();
        }
      } catch (err) { renderConnect(esc(err.message), mode); }
      finally { busy(false); }
    };
  }
  async function afterSignIn() {
    const { data: u } = await sb.auth.getUser();
    me = u && u.user ? u.user.email : null;
    if (!me) return renderConnect();
    const [{ data: ok }, { data: sup }] = await Promise.all([sb.rpc("is_admin"), sb.rpc("is_super_admin")]);
    superAdmin = !!sup;
    if (!ok) {
      $("#disconnect").hidden = false;
      return renderConnect(`You're signed in as <b>${esc(me)}</b>, but this email isn't on the admin list. Ask the super admin to add it in <b>Settings → Admins &amp; GitHub</b>.`);
    }
    await start();
  }

  /* ---------- start ---------- */
  async function start() {
    $("#app").innerHTML = `<p class="count" style="padding:24px 0">Loading…</p>`;
    try {
      const keys = Object.keys(FILES);
      // Content and keys load at the same time (they used to load one after the other).
      const keysP = loadKeys().catch(() => {});
      const res = await Promise.all(keys.map(k => readFile(k)));
      keys.forEach((k, i) => data[k] = res[i]);
      await keysP;
    } catch (e) { return renderConnect(esc(e.message)); }
    $("#tabs").hidden = false; $("#bnav").hidden = false; $("#disconnect").hidden = false;
    buildMore();
    $("#repo-label").textContent = me;
    render();
    loadRequests().then(() => { if (view === "requests" || view === "dashboard") render(); badgeRequests(); });
  }

  const V = () => data.videos.json.videos;
  const cats = () => {
    const known = (data.settings.json.categories || []).map(c => c.name);
    const used = [...new Set(V().map(v => v.category))].filter(c => c && !known.includes(c));
    return [...known, ...used];
  };
  const problems = () => {
    const m = new Map();
    (data.health.json.problems || []).forEach(p => m.set(p.yt, p));
    return m;
  };

  const TITLES = {
    dashboard: ["", ""],
    videos: ["Videos", "Everything in the staff library. Videos play from YouTube; only the text is stored here."],
    queue: ["Review queue", "New videos the finder found. Nothing goes live until you approve it."],
    paths: ["Learning paths", "Short courses shown on the staff home screen."],
    toolbox: ["Toolbox talks", "One talk shows on the home screen each day, in rotation."],
    channels: ["Channels", "The trusted YouTube channels the finder searches when you press Search for new videos."],
    people: ["Staff & records", "Progress is recorded by HR number."],
    assign: ["Assigned training", "Learning paths that a trade (or everyone) must finish, with a due date."],
    sups: ["Supervisors", "Supervisors sign off certificates on the technician's phone with their PIN."],
    requests: ["Requests", "Videos staff asked for."],
    insights: ["Insights", "What staff watch, and what they searched for and didn't find."],
    settings: ["Settings", ""]
  };
  /* ---------- phone: bottom tab bar + "More" sheet ---------- */
  const BNAV = ["dashboard", "videos", "queue", "people"];
  function buildMore() {
    const grid = $("#msheet-grid"); if (!grid || grid.childElementCount) return;
    $$("#tabs [data-view]").forEach(b => {
      if (BNAV.includes(b.dataset.view)) return;
      const c = b.cloneNode(true);
      c.querySelectorAll("[id]").forEach(x => { x.dataset.mirror = x.id; x.removeAttribute("id"); });
      grid.appendChild(c);
    });
  }
  function syncPhoneNav(q) {
    const bq = $("#b-queue"); if (bq) { bq.hidden = !q; bq.textContent = q; }
    $$("#msheet [data-mirror]").forEach(x => { const src = $("#" + x.dataset.mirror); if (src) { x.hidden = src.hidden; x.textContent = src.textContent; } });
    const nReq = +(($("#n-req") || {}).textContent || 0) * !(($("#n-req") || {}).hidden);
    const bm = $("#b-more-n"); if (bm) { bm.hidden = !nReq; bm.textContent = nReq; }
    const more = $("#b-more"); if (more) { if (BNAV.includes(view)) more.removeAttribute("aria-current"); else more.setAttribute("aria-current", "page"); }
    const who = $("#msheet-me"); if (who) who.textContent = me || "";
  }
  function openMore() { buildMore(); syncPhoneNav((data.pending && data.pending.json.queue || []).length); $("#msheet").hidden = false; $("#b-more").setAttribute("aria-expanded", "true"); }
  function closeMore() { const m = $("#msheet"); if (m) m.hidden = true; const b = $("#b-more"); if (b) b.setAttribute("aria-expanded", "false"); }

  function render() {
    $("#n-videos").textContent = V().length;
    const q = (data.pending.json.queue || []).length;
    const nq = $("#n-queue"); nq.hidden = !q; nq.textContent = q;
    $$("#tabs [data-view], #bnav [data-view], #msheet [data-view]").forEach(b => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    syncPhoneNav(q);
    const [title, sub] = TITLES[view] || ["", ""];
    $("#page-h").hidden = !title; $("#page-title").textContent = title; $("#page-sub").textContent = sub; $("#page-act").innerHTML = "";
    if (view === "assign") pplSub = "assign"; else if (view === "sups") pplSub = "sups"; else if (view === "people" && !["people", "staff"].includes(pplSub)) pplSub = "people";
    ({ dashboard: renderDashboard, videos: renderVideos, queue: renderQueue, requests: renderRequests, people: renderPeople, assign: renderPeople, sups: renderPeople, insights: renderInsights, paths: renderPaths, toolbox: renderToolbox, channels: renderChannels, settings: renderSettings })[view]();
  }
  const peopleView = () => ["people", "assign", "sups"].includes(view);

  /* ---------- Dashboard ---------- */
  let dashStats = null;
  function renderDashboard() {
    if (!ppl && !pplErr) { $("#app").innerHTML = `<p class="count" style="padding:24px 0">Loading…</p>`; loadPeople().then(() => view === "dashboard" && renderDashboard()); return; }
    if (dashStats === null && data.settings.json.statsEnabled) { dashStats = []; sGet({ what: "stats", days: 30 }).then(j => { dashStats = j.counts || []; if (view === "dashboard") renderDashboard(); }).catch(() => {}); }
    const people = ppl ? summarise() : [], staffN = ((ppl && ppl.staff) || []).filter(x => x.active).length;
    const wk = Date.now() - 7 * 864e5;
    const active7 = people.filter(p => !p.unknown && p.last && Date.parse(p.last) > wk).length;
    const watched7 = ((ppl && ppl.records) || []).filter(r => r[5] === "video" && Date.parse(r[0]) > wk).length;
    const watchedPrev = ((ppl && ppl.records) || []).filter(r => r[5] === "video" && Date.parse(r[0]) <= wk && Date.parse(r[0]) > wk - 7 * 864e5).length;
    const byPath = new Map((data.paths.json.paths || []).map(p => [p.id, p]));
    const as = (data.paths.json.assignments || []).map(a => {
      const p = byPath.get(a.path); if (!p) return null;
      const target = people.filter(x => !x.unknown && x.active !== false && (!(a.trades || []).length || (a.trades || []).includes(x.trade)));
      const done = target.filter(x => x.paths.has(a.path)).length, over = a.due && a.due < today();
      return { a, p, n: target.length, done, over, overdue: over ? target.length - done : 0 };
    }).filter(Boolean);
    const overdue = as.reduce((n, x) => n + x.overdue, 0), overPaths = as.filter(x => x.overdue).length;
    const q = data.pending.json.queue || [], nreq = (reqs || []).filter(r => r.status === "new").length;
    const hour = new Date().getHours(), hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const noLen = V().filter(v => !v.duration).length, full = V().filter(v => v.tr && Object.keys(v.tr).length >= 8).length;
    const probs = (data.health.json.problems || []).length, lastRun = data.pending.json.lastRun;
    const nores = (dashStats || []).filter(c => c.kind === "nores").sort((a, b) => b.n - a.n).slice(0, 5);
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    const asTag = x => x.done >= x.n && x.n ? `<span class="tag ok">Done</span>` : x.over ? `<span class="tag over">Overdue</span>` : x.a.due ? `<span class="tag due">Due ${esc(new Date(x.a.due + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }))}</span>` : `<span class="tag grey">No due date</span>`;
    $("#app").innerHTML = `
      <div class="page-h"><div><h1>${hello}</h1>
        <p>${esc(new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }))} · Sign-in is ${data.settings.json.staffLogin ? "on for all staff" : "<b>off</b>"}</p></div>
        <button class="btn" data-find>Search for new videos</button><button class="btn btn-primary" id="d-add">＋ Add video</button></div>
      <div class="find-msg" ${finder.msg ? "" : "hidden"}>${finder.msg}</div>
      ${pplErr ? `<div class="err">${esc(pplErr)}</div>` : ""}
      <div class="kpis">
        <a class="kpi" href="#" data-go="people"><small>Active this week</small><b>${active7} <span>of ${staffN}</span></b><div class="pc-bar"><i style="width:${pct(active7, staffN)}%"></i></div></a>
        <a class="kpi" href="#" data-go="insights"><small>Videos watched this week</small><b>${watched7.toLocaleString()}</b><span class="sub">${watchedPrev ? (watched7 >= watchedPrev ? "↑ " : "↓ ") + Math.abs(pct(watched7 - watchedPrev, watchedPrev)) + "% on last week" : "by signed-in staff"}</span></a>
        <a class="kpi${overdue ? " danger" : ""}" href="#" data-go="assign"><small>Overdue assigned training</small><b>${overdue}</b><span class="sub">${overdue ? `people across ${overPaths} path${overPaths === 1 ? "" : "s"}` : "nobody is overdue"}</span></a>
        <a class="kpi" href="#" data-go="${q.length ? "queue" : "requests"}"><small>Waiting for you</small><b>${q.length + nreq}</b><span class="sub">${q.length} video${q.length === 1 ? "" : "s"} to review · ${nreq} request${nreq === 1 ? "" : "s"}</span></a>
      </div>
      <div class="dash">
        <section class="card-plain" style="flex:2 1 480px">
          <div class="dash-h"><h2>Assigned training</h2><a href="#" data-go="assign">Manage</a></div>
          ${as.length ? `<div class="as-grid"><span class="th">Path</span><span class="th">For</span><span class="th">Finished</span><span></span>
            ${as.map(x => `<b>${esc(x.p.title)}</b><span class="for">${(x.a.trades || []).length ? x.a.trades.map(esc).join(", ") : "Everyone"}</span>
              <span class="prog"><span class="pc-bar${x.over ? " over" : x.done >= x.n && x.n ? " ok" : ""}"><i style="width:${pct(x.done, x.n)}%"></i></span>${x.done}/${x.n}</span>${asTag(x)}`).join("")}</div>`
            : `<p class="help">Nothing assigned yet. <a href="#" data-go="assign">Assign a learning path</a> to a trade or to everyone.</p>`}
        </section>
        <section class="card-plain" style="flex:1 1 300px">
          <div class="dash-h"><h2>Review queue</h2><a href="#" data-go="queue">Open</a></div>
          ${q.slice(0, 3).map(i => { const rv = i.draft && i.draft.review; const col = !rv ? "var(--muted)" : rv.recommend === "approve" ? "var(--ok)" : rv.recommend === "reject" ? "var(--danger)" : "#8A5300";
            return `<a class="mini-q" href="#" data-go="queue"><span class="thumb"><img loading="lazy" src="${thumb(i.yt)}" alt=""></span><span><b>${esc((i.draft && i.draft.title) || i.title)}</b><small style="color:${col}">${rv ? "Gemini: " + esc(rv.recommend) + " · " + rv.relevance + "/10" : "Not checked yet"}</small></span></a>`; }).join("") || `<p class="help">Nothing waiting.</p>`}
        </section>
      </div>
      <div class="dash">
        <section class="card-plain" style="flex:1 1 360px">
          <div class="dash-h"><h2>Searched, nothing found</h2><a href="#" data-go="insights">Insights</a></div>
          <p class="help" style="margin-top:-6px">Ideas for new videos, last 30 days.</p>
          ${data.settings.json.statsEnabled ? (nores.map(c => `<div class="list-line"><span>“${esc(c.key)}”</span><b>${c.n}</b></div>`).join("") || `<p class="help">Nothing yet.</p>`) : `<p class="help">Counting is off. Turn it on in <a href="#" data-go="settings">Settings → Staff &amp; training</a>.</p>`}
        </section>
        <section class="card-plain" style="flex:1 1 360px">
          <div class="dash-h"><h2>System health</h2>${superAdmin ? `<a href="#" data-go="settings" data-sec="status">Details</a>` : ""}</div>
          <div class="health">
            <div><i style="background:${lastRun ? "var(--ok)" : "#C98A00"}"></i>${lastRun ? "Last video search " + esc(new Date(lastRun).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })) : "Video search hasn't been run yet"}</div>
            <div><i style="background:${full === V().length ? "var(--ok)" : "#C98A00"}"></i>${full} of ${V().length} videos translated into 8 languages</div>
            <div><i style="background:${probs ? "var(--danger)" : "var(--ok)"}"></i>${probs ? `${probs} video${probs === 1 ? "" : "s"} no longer play <button data-go="videos" data-show="problems">Show</button>` : "All videos still play on YouTube"}</div>
            <div><i style="background:${noLen ? "#C98A00" : "var(--ok)"}"></i>${noLen ? `${noLen} videos missing a length <button data-go="videos" data-show="no-len">Fill in</button>` : "Every video has a length"}</div>
            <div><i style="background:${textAI() ? "var(--ok)" : "#C98A00"}"></i>${textAI() ? `AI: ${aiLabel()}` : keys.owner ? `AI is off or has no key <button data-go="settings" data-sec="gemini">Set up</button>` : "AI isn't set up yet — ask the owner"}</div>
          </div>
        </section>
      </div>`;
    const da = $("#d-add"); if (da) da.onclick = () => openEditor(null);
  }

  /* ---------- Videos ---------- */
  function renderVideos() {
    const probs = problems();
    const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = V().filter(v => ui.cat === "ALL" || v.category === ui.cat);
    if (ui.show === "hidden") list = list.filter(v => v.hidden);
    if (ui.show === "problems") list = list.filter(v => probs.has(v.yt));
    if (ui.show === "featured") list = list.filter(v => v.featured);
    if (ui.show === "essential") list = list.filter(v => v.essential);
    if (ui.show === "gem-no") list = list.filter(v => !v.gemini);
    if (ui.show === "no-len") list = list.filter(v => !v.duration);
    if (ui.show === "no-quiz") list = list.filter(v => !(v.quiz && v.quiz.length));
    if (ui.show === "gem-unsafe") list = list.filter(v => v.gemini && (v.gemini.unsafe || []).length);
    const dupOf = dupMap();
    if (ui.show === "dups") list = list.filter(v => dupOf.get(v.id).length);
    if (words.length) list = list.filter(v => { const h = [v.title, v.ytTitle, v.channel, v.subject, v.category, v.id].join(" ").toLowerCase(); return words.every(w => h.includes(w)); });
    list = [...list].sort((a, b) => (b.added || "").localeCompare(a.added || ""));
    const nProb = V().filter(v => probs.has(v.yt)).length;
    $("#app").innerHTML = `
      ${nProb ? `<div class="err">${ABIcon("alert")} ${nProb} video${nProb > 1 ? "s" : ""} may no longer play (removed from YouTube or embedding turned off). <button class="btn btn-sm" id="see-probs">Show them</button></div>` : ""}
      <div class="bar">
        <input class="input grow" id="v-q" type="search" placeholder="Search title, channel, subject…" value="${esc(ui.q)}">
        <select id="v-cat"><option value="ALL">All categories</option>${cats().map(c => `<option ${c === ui.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="v-show">
          ${[["all", "All videos"], ["no-len", "Missing length"], ["no-quiz", "No quiz yet"], ["gem-no", "Not checked by Gemini"], ["gem-unsafe", "Gemini: unsafe practice"], ["dups", "Possible duplicates"], ["essential", "Safety essentials"], ["featured", "Pinned to top"], ["hidden", "Hidden"], ["problems", "Problems"]].map(([k, l]) => `<option value="${k}" ${k === ui.show ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="btn btn-primary" id="add-video">＋ Add video</button>
      </div>
      <p class="count">${list.length} of ${V().length} videos · <b>${V().filter(v => v.gemini).length} of ${V().length}</b> checked by Gemini · <b>${V().filter(v => v.quiz && v.quiz.length).length}</b> with a quiz</p>
      ${dupGroups().length ? `<div class="bar"><button class="btn btn-sm" id="dedupe">${ABIcon("copy")} Remove duplicates (${dupGroups().length})</button><span class="help grow">Checks similar videos, keeps the best one of each and deletes the rest. You review it first.</span></div>` : ""}
      ${(() => { const noLen = V().filter(v => !v.duration).length, noQuiz = V().filter(v => !(v.quiz && v.quiz.length) && !v.hidden).length;
        return noLen || (noQuiz && textAI()) || fillReport ? `<div class="bar">${noLen ? `<button class="btn btn-sm" id="fill-len">${ABIcon("clock")} Fill in ${noLen} missing length${noLen > 1 ? "s" : ""}</button>` : ""}${noQuiz && textAI() ? `<button class="btn btn-sm" id="fill-quiz">${ABIcon("quiz")} Write quizzes for ${noQuiz} video${noQuiz > 1 ? "s" : ""}</button>` : ""}<span class="help grow" id="fill-msg">${fillReport}</span></div>` : ""; })()}
      <div class="rows">${list.map(v => {
        const p = probs.get(v.yt);
        return `<div class="row ${v.hidden ? "is-hidden" : ""}">
          <div class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt="" width="320" height="180">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}</div>
          <div>
            <h3>${esc(v.title)}</h3>
            <div class="meta">
              <span>${esc(v.category)}</span><span class="lvl lvl-${esc(v.level)}">${esc(v.level)}</span><span>${esc(v.added || "")}</span>
              ${dupOf.get(v.id).length ? `<span class="badge-s b-dup" title="${esc(dupOf.get(v.id).map(d => d.item.title).join("\n"))}">${ABIcon("alert")} ${dupOf.get(v.id)[0].same ? "Same video twice" : "Similar to: " + esc(dupOf.get(v.id)[0].item.title)}</span>` : ""}
              ${v.gemini ? `<span class="badge-s b-gem" title="${esc((REC[v.gemini.recommend] || REC.maybe)[1] + " · " + v.gemini.relevance + "/10" + (v.gemini.reason ? " — " + v.gemini.reason : ""))}">${ABIcon("check")} Checked by Gemini · ${v.gemini.relevance}/10</span>` : `<span class="badge-s b-wait">${ABIcon("hourglass")} Not checked by Gemini</span>`}
              ${v.gemini && (v.gemini.unsafe || []).length ? `<span class="badge-s b-prob" title="${esc(v.gemini.unsafe.join("; "))}">${ABIcon("alert")} Unsafe practice shown</span>` : ""}
              ${v.essential ? `<span class="badge-s b-ess">${ABIcon("hardhat")} Essential</span>` : ""}
              ${v.quiz && v.quiz.length ? `<span class="badge-s b-ok">${ABIcon("quiz")} Quiz</span>` : ""}
              ${v.featured ? `<span class="badge-s b-feat">Pinned</span>` : ""}
              ${v.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
              ${p ? `<span class="badge-s b-prob">${p.status === "notfound" ? "Not on YouTube" : "Can't play in app"}</span>` : ""}
              ${v.tr && Object.keys(v.tr).length ? `<span class="badge-s b-ok">${ABIcon("globe")} ${Object.keys(v.tr).length}/8</span>` : `<span class="badge-s b-hidden">Translating…</span>`}
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-sm" data-edit="${esc(v.id)}">Edit</button>
            <button class="btn btn-sm" data-hide="${esc(v.id)}">${v.hidden ? "Show" : "Hide"}</button>
            <button class="btn btn-sm btn-danger" data-del="${esc(v.id)}" aria-label="Delete">Delete</button>
          </div>
        </div>`;
      }).join("") || `<div class="empty"><h3>No videos match</h3></div>`}</div>`;
    $("#v-q").oninput = e => { ui.q = e.target.value; const pos = e.target.selectionStart; renderVideos(); const i = $("#v-q"); i.focus(); i.setSelectionRange(pos, pos); };
    $("#v-cat").onchange = e => { ui.cat = e.target.value; renderVideos(); };
    $("#v-show").onchange = e => { ui.show = e.target.value; renderVideos(); };
    $("#add-video").onclick = () => openEditor(null);
    const sp = $("#see-probs"); if (sp) sp.onclick = () => { ui.show = "problems"; renderVideos(); };
    const dd = $("#dedupe"); if (dd) dd.onclick = openDedupe;
    const fl = $("#fill-len"); if (fl) fl.onclick = fillLengths;
    const fq = $("#fill-quiz"); if (fq) fq.onclick = fillQuizzes;
  }

  /* ---------- Video lengths (read from the YouTube player in this browser) ---------- */
  let ytLoad = null;
  function ytApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytLoad) return ytLoad;
    ytLoad = new Promise((res, rej) => {
      window.onYouTubeIframeAPIReady = () => res(window.YT);
      const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; sc.onerror = () => rej(new Error("Couldn't load the YouTube player"));
      document.head.appendChild(sc);
      setTimeout(() => rej(new Error("The YouTube player didn't load")), 12000);
    }).catch(e => { ytLoad = null; throw e; });
    return ytLoad;
  }
  const fmtDur = s => { s = Math.round(+s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
  async function ytDuration(yt) {
    const YTx = await ytApi();
    return new Promise(res => {
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none";
      const slot = document.createElement("div"); box.appendChild(slot); document.body.appendChild(box);
      let p, over = false;
      const finish = d => { if (over) return; over = true; try { p && p.destroy(); } catch {} box.remove(); res(d > 0 ? d : 0); };
      try {
        p = new YTx.Player(slot, { host: "https://www.youtube-nocookie.com", videoId: yt, playerVars: { autoplay: 0, mute: 1, controls: 0 },
          events: {
            onReady: e => { let n = 0; const tick = () => { if (over) return; let d = 0; try { d = e.target.getDuration(); } catch {} if (d > 0) return finish(d); if (++n === 3) { try { e.target.mute(); e.target.playVideo(); } catch {} } if (n > 25) return finish(0); setTimeout(tick, 400); }; tick(); },
            onError: () => finish(0)
          } });
      } catch { finish(0); }
      setTimeout(() => finish(0), 16000);
    });
  }
  async function fillLengths() {
    const todo = V().filter(v => !v.duration), msg = $("#fill-msg"), btn = $("#fill-len");
    btn.disabled = true;
    const found = {};
    for (let i = 0; i < todo.length; i++) {
      msg.textContent = `Reading length ${i + 1} of ${todo.length}…`;
      try { const d = await ytDuration(todo[i].yt); if (d) found[todo[i].id] = fmtDur(d); } catch (e) { msg.textContent = e.message; break; }
    }
    const n = Object.keys(found).length;
    if (!n) { msg.textContent = "Couldn't read any lengths. Check your internet and try again."; btn.disabled = false; return; }
    updateFast("videos", d => { d.videos.forEach(v => { if (!v.duration && found[v.id]) v.duration = found[v.id]; }); return d; }, `Fill in ${n} video lengths`);
    toast(`${n} lengths filled in.`); render();
  }
  let fillReport = "";   // result of the last "Write quizzes" run, kept on screen after the page redraws
  const quizCount = v => { const st = data.settings.json; return v && v.essential ? (+st.quizSizeEss || 5) : (+st.quizSize || 3); };
  async function fillQuizzes() {
    const todo = V().filter(v => !(v.quiz && v.quiz.length) && !v.hidden), msg = $("#fill-msg"), btn = $("#fill-quiz");
    if (!confirm(`${textName()} will write a quiz for ${todo.length} videos: ${+data.settings.json.quizSizeEss || 5} questions for safety essentials, ${+data.settings.json.quizSize || 3} for the others, from each video's summary, safety note and steps. It saves every 5 videos — you can check and edit any quiz afterwards. Start?`)) return;
    btn.disabled = true; fillReport = "";
    let made = {}, total = 0, fails = 0, inRow = 0, lastErr = "", stopped = "";
    const save = async () => {
      const ids = Object.keys(made); if (!ids.length) return;
      const batch = made; made = {};
      updateFast("videos", d => { d.videos.forEach(v => { if (batch[v.id] && !(v.quiz && v.quiz.length)) v.quiz = batch[v.id]; }); d.updated = today(); return d; }, `Add quizzes to ${ids.length} videos`);
    };
    for (let i = 0; i < todo.length; i++) {
      const v = todo[i];
      msg.textContent = `Writing quiz ${i + 1} of ${todo.length}: ${v.title}`;
      const ask = () => ABDraft.aiQuiz({ title: v.title, summary: v.summary, safety: v.safety, steps: v.steps, ppe: v.ppe, count: quizCount(v), key: geminiKey(), model: geminiModel() || undefined });
      try {
        try { made[v.id] = await ask(); }
        catch (e) {   // busy or at the per-minute limit: wait a little and try this video once more
          if (!/busy|limit|rate|overload|429|503|too long|high demand|unavailable/i.test(e.message)) throw e;
          msg.textContent = `The AI is busy — waiting 20 seconds, then trying “${v.title}” again…`;
          await new Promise(r => setTimeout(r, 20000));
          made[v.id] = await ask();
        }
        total++; inRow = 0;
      } catch (e) {
        fails++; inRow++; lastErr = e.message || String(e);
        console.warn("Quiz failed for", v.id, lastErr);
        if (inRow >= 4) { stopped = lastErr; break; }   // something is wrong: stop instead of failing every video
      }
      if (Object.keys(made).length >= 5) await save();
      await new Promise(r => setTimeout(r, 2500));
    }
    await save();
    fillReport = stopped
      ? `<span style="color:var(--danger)">${ABIcon("alert")} Stopped after ${inRow} failures in a row. ${total ? `${total} quizzes were saved. ` : "Nothing was saved. "}The AI said: <b>${esc(stopped)}</b></span>`
      : `${ABIcon(fails ? "alert" : "checkCircle", fails ? "" : "ok")} ${total} quiz${total === 1 ? "" : "zes"} saved${fails ? `, ${fails} failed (last problem: ${esc(lastErr)}) — run it again to retry those` : ""}.`;
    toast(stopped ? "Quiz writing stopped — see the message" : `${total} quizzes saved`); render();
  }

  async function hideToggle(id) {
    const v = V().find(x => x.id === id); if (!v) return;
    const to = !v.hidden;
    updateFast("videos", d => { const x = d.videos.find(y => y.id === id); if (x) { if (to) x.hidden = true; else delete x.hidden; } d.updated = today(); return d; }, `${to ? "Hide" : "Show"} video: ${v.title}`);
    toast(to ? "Hidden from staff" : "Visible to staff again"); render();
  }
  /* ---------- Remove duplicates: group similar videos, keep the best of each, delete the rest (after you review) ---------- */
  let dupKey = "", dupCache = null;   // the duplicate check compares every pair of videos: do it once per save, not on every keystroke
  function dupMap() {
    const key = (data.videos.sha || 0) + ":" + V().length + ":" + rev;
    if (dupKey !== key || !dupCache) { dupKey = key; dupCache = new Map(V().map(v => [v.id, ABDraft.findDuplicates(v, V())])); }
    return dupCache;
  }
  function dupGroups() {
    const vs = V(), parent = new Map(vs.map(v => [v.id, v.id]));
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const dm = dupMap();
    for (const v of vs) for (const d of dm.get(v.id) || []) parent.set(find(v.id), find(d.item.id));
    const by = new Map();
    for (const v of vs) { const k = find(v.id); if (!by.has(k)) by.set(k, []); by.get(k).push(v); }
    return [...by.values()].filter(g => g.length > 1);
  }
  const keepScore = v => {
    const g = v.gemini || {};
    return (g.relevance || 0) + (g.quality || 0) + (v.quiz && v.quiz.length ? 3 : 0) + Object.keys(v.tr || {}).length * 0.25
      + (v.featured ? 2 : 0) + (v.essential ? 2 : 0) + Math.min((v.steps || []).length, 6) * 0.3 + (v.hidden ? -3 : 0) + (v.duration ? 0.5 : 0);
  };
  function openDedupe() {
    const groups = dupGroups().map(g => g.slice().sort((a, b) => keepScore(b) - keepScore(a) || String(a.added).localeCompare(String(b.added))));
    $("#drawer-title").textContent = "Remove duplicates";
    $("#drawer-body").innerHTML = `
      <p class="help">For each group, the best video is kept (rated highest by Gemini, with a quiz and all translations). Change the one to keep if you disagree, and untick <b>Delete the others</b> if the videos are actually different. Learning paths switch to the video you keep.</p>
      ${groups.map((g, gi) => {
        const sure = g.slice(1).every(o => { const d = ABDraft.findDuplicates(o, [g[0]])[0]; return d && (d.same || d.score >= 0.8); });
        return `<div class="card-plain" data-dg="${gi}" style="margin-bottom:12px">
          ${g.map((v, i) => `<label class="check" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="radio" name="keep${gi}" value="${esc(v.id)}" ${i === 0 ? "checked" : ""}> <span><b>${esc(v.title)}</b><br><small>${esc(v.category || "")} · ${v.gemini ? "Gemini " + esc(String(v.gemini.relevance)) + "/10 · " : ""}${v.quiz && v.quiz.length ? "quiz · " : ""}${Object.keys(v.tr || {}).length}/8 languages · ${esc(v.duration || "no length")} · added ${esc(v.added || "")}</small></span></label>`).join("")}
          <label class="check" style="margin-top:8px"><input type="checkbox" class="dg-del" ${sure ? "checked" : ""}> Delete the others${sure ? "" : " (looks different, check before ticking)"}</label>
        </div>`;
      }).join("")}`;
    const foot = () => { const n = [...document.querySelectorAll("#drawer-body [data-dg]")].reduce((a, el, gi) => a + (el.querySelector(".dg-del").checked ? groups[gi].length - 1 : 0), 0); const b = $("#dd-go"); b.textContent = n ? `Delete ${n} video${n > 1 ? "s" : ""}` : "Nothing to delete"; b.disabled = !n; };
    $("#drawer-foot").innerHTML = `<button class="btn" data-close-drawer>Cancel</button><button class="btn btn-primary" id="dd-go">Delete</button>`;
    $("#drawer-body").onchange = foot; foot();
    $("#dd-go").onclick = async () => {
      const kill = new Map();   // deleted id -> kept id
      document.querySelectorAll("#drawer-body [data-dg]").forEach((el, gi) => {
        if (!el.querySelector(".dg-del").checked) return;
        const keep = el.querySelector("input[type=radio]:checked").value;
        groups[gi].forEach(v => { if (v.id !== keep) kill.set(v.id, keep); });
      });
      if (!kill.size || !confirm(`Delete ${kill.size} duplicate video${kill.size > 1 ? "s" : ""}? The best of each group is kept.`)) return;
      const b = $("#dd-go"); b.disabled = true; b.textContent = "Deleting…";
      updateFast("videos", d => { d.videos = d.videos.filter(y => !kill.has(y.id)); d.updated = today(); return d; }, `Remove ${kill.size} duplicate videos`);
      if ((data.paths.json.paths || []).some(p => (p.videos || []).some(x => kill.has(x))))
        updateFast("paths", d => { (d.paths || []).forEach(p => p.videos = [...new Set((p.videos || []).map(x => kill.get(x) || x))]); return d; }, "Learning paths: use the kept video");
      if ((data.toolbox.json.talks || []).some(k => kill.has(k.video)))
        updateFast("toolbox", d => { (d.talks || []).forEach(k => { if (kill.has(k.video)) k.video = kill.get(k.video); }); return d; }, "Toolbox talks: use the kept video");
      closeDrawer(); toast(`Deleted ${kill.size} duplicate${kill.size > 1 ? "s" : ""}`); render();
    };
    $("#drawer").hidden = false;
  }
  async function del(id) {
    const v = V().find(x => x.id === id); if (!v) return;
    if (!confirm(`Delete “${v.title}”?\n\nTip: use Hide instead if you might want it back.`)) return;
    updateFast("videos", d => { d.videos = d.videos.filter(y => y.id !== id); d.updated = today(); return d; }, `Delete video: ${v.title}`);
    if ((data.paths.json.paths || []).some(p => (p.videos || []).includes(id)))
      updateFast("paths", d => { (d.paths || []).forEach(p => p.videos = (p.videos || []).filter(x => x !== id)); return d; }, `Remove deleted video from learning paths`);
    toast("Deleted"); render();
  }

  /* ---------- Editor ---------- */
  let ed = null;
  function openEditor(video, prefill = {}, onSaved) {
    const v = Object.assign({ level: "Intermediate", added: today(), ppe: [], steps: [], tr: {} }, video ? JSON.parse(JSON.stringify(video)) : {}, prefill);
    ed = { original: video, v, tr: v.tr || {}, trLang: "hi", onSaved, ytTitle: prefill.ytTitle || (video && video.ytTitle) || "",
      gemini: prefill.review ? { date: today(), ...prefill.review } : (video && video.gemini) || null };
    const subjects = [...new Set(V().map(x => x.subject).filter(Boolean))].sort();
    $("#drawer-title").textContent = video ? "Edit video" : (prefill.yt ? "Approve video" : "Add video");
    $("#drawer-body").innerHTML = `
      <div class="field"><label for="f-url">YouTube link</label>
        <input class="input" id="f-url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="Paste a YouTube link" value="${v.yt ? "https://www.youtube.com/watch?v=" + esc(v.yt) : ""}">
        <div class="help" id="f-url-help">Paste the link from the YouTube app (Share → Copy link). Title and channel fill in automatically.</div>
      </div>
      <div class="preview" id="f-preview" ${v.yt ? "" : "hidden"}>${v.yt ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(v.yt)}?rel=0" allowfullscreen allow="encrypted-media; picture-in-picture; fullscreen"></iframe>` : ""}</div>
      ${prefill.description ? `<details class="box"><summary>YouTube description</summary><p style="white-space:pre-wrap;font-size:14px;margin:8px 0 0">${esc(prefill.description)}</p></details>` : ""}
      <div class="field"><label for="f-title">Training title</label><input class="input" id="f-title" required value="${esc(v.title || "")}">
        <div class="help" id="f-yt-title">${ed.ytTitle && ed.ytTitle !== v.title ? `YouTube title: ${esc(ed.ytTitle)}` : "A short, clear name for what the video teaches (not the YouTube title)."}</div><div id="f-dup"></div></div>
      <div class="two">
        <div class="field"><label for="f-cat">Category</label>
          <select class="input" id="f-cat">${cats().map(c => `<option ${c === v.category ? "selected" : ""}>${esc(c)}</option>`).join("")}<option value="__new">＋ New category…</option></select></div>
        <div class="field"><label for="f-level">Level</label>
          <select class="input" id="f-level">${LEVELS.map(l => `<option ${l === v.level ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="f-subject">Subject</label><input class="input" id="f-subject" list="subjects" placeholder="e.g. Preventive Maintenance" value="${esc(v.subject || "")}">
        <datalist id="subjects">${subjects.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
      <div class="three">
        <div class="field"><label for="f-dur">Length</label><input class="input" id="f-dur" placeholder="6:12" value="${esc(v.duration || "")}"></div>
        <div class="field"><label for="f-added">Date added</label><input class="input" id="f-added" type="date" value="${esc(v.added || today())}"></div>
        <div class="field"><label for="f-chan">Channel</label><input class="input" id="f-chan" value="${esc(v.channel || "")}"></div>
      </div>
      ${v.draftSource ? `<div class="draft-note">${ABIcon("sparkles")} ${v.draftSource === "ai" ? "Gemini watched this video and wrote a first draft of the summary, safety note and steps." : "First draft filled in from the YouTube description and safety rules."} ${v.draftSource === "ai" ? "" : STEPS_NOTE[v.stepsFrom] || ""} Check it before publishing.${reviewHtml(v.review)}</div>` : ""}
      <div class="draft-row"><button type="button" class="btn btn-sm" id="f-draft">${ABIcon("sparkles")} Auto-draft</button>${videoAI() ? `<button type="button" class="btn btn-sm" id="f-check">${ABIcon("search")} Check with Gemini</button>` : ""}<span class="help" id="f-draft-help">${videoAI() ? "Gemini will watch the video and fill in the summary, safety, PPE and steps." : "Fills in safety, PPE and steps for this kind of job. Add a Gemini key in Settings to draft from the video itself."}</span></div>
      <div class="field"><label for="f-summary">What the video shows</label><textarea class="textarea" id="f-summary" placeholder="One or two plain sentences.">${esc(v.summary || "")}</textarea></div>
      <div class="field"><label for="f-safety">Safety warning</label><textarea class="textarea" id="f-safety" placeholder="e.g. Isolate power and prove dead before starting.">${esc(v.safety || "")}</textarea></div>
      <div class="field"><label for="f-ppe">Required PPE</label><input class="input" id="f-ppe" placeholder="Safety Glasses, Work Gloves" value="${esc((v.ppe || []).join(", "))}"><div class="help">Separate with commas.</div></div>
      <div class="field"><label for="f-steps">Key steps</label><textarea class="textarea" id="f-steps" rows="6" placeholder="One step per line">${esc((v.steps || []).join("\n"))}</textarea><div class="help">One step per line. 3–6 short steps work best.</div></div>
      <div class="field"><label for="f-quiz">${ABIcon("quiz")} Quick check (quiz)</label>
        <textarea class="textarea" id="f-quiz" rows="7" placeholder="Question on one line&#10;* the right answer&#10;- a wrong answer&#10;- another wrong answer&#10;&#10;Next question…">${esc(ABDraft.quizToText(v.quiz || []))}</textarea>
        <div class="help">Staff answer this after the video. Put <b>*</b> before the right answer and <b>-</b> before wrong ones; leave a blank line between questions. 3 questions for ordinary videos, 5 for safety essentials (change in Settings). Leave empty for no quiz.</div>
        ${textAI() ? `<div class="draft-row" style="margin-top:6px"><button type="button" class="btn btn-sm" id="f-quiz-ai">${ABIcon("sparkles")} Write quiz with AI</button><span class="help" id="f-quiz-help">Uses the summary, safety note and steps above.</span></div>` : ""}</div>
      <label class="check"><input type="checkbox" id="f-ess" ${v.essential ? "checked" : ""}> ${ABIcon("hardhat")} Safety essential (shown in the pinned Safety section)</label>
      <label class="check"><input type="checkbox" id="f-feat" ${v.featured ? "checked" : ""}> Pin to top of the library</label>
      <label class="check"><input type="checkbox" id="f-hidden" ${v.hidden ? "checked" : ""}> Hide from staff</label>
      <details class="box" style="margin-top:10px">
        <summary>Translations (optional)</summary>
        <p class="help" style="margin:8px 0 12px">Every video is translated automatically about 2 minutes after you save. Correct any wording here and your version is kept. Clear all fields for a language to go back to automatic.</p>
        <div class="field"><label for="f-tr-lang">Language</label>
          <select class="input" id="f-tr-lang">${TR_LANGS.map(([c, n]) => `<option value="${c}">${n}${ed.tr[c] ? (ed.tr[c].auto ? " (automatic)" : " (checked by you)") : " (pending)"}</option>`).join("")}</select></div>
        <div id="tr-fields"></div>
      </details>`;
    renderTrFields();
    $("#drawer-foot").innerHTML = `<button class="btn" data-close-drawer>Cancel</button><button class="btn btn-primary" id="f-save">${prefill.yt && !video ? "Approve & publish" : "Save"}</button>`;
    $("#drawer").hidden = false;
    document.body.style.overflow = "hidden";

    const url = $("#f-url");
    const onUrl = async () => {
      const yt = parseYT(url.value);
      const help = $("#f-url-help");
      if (!yt) { help.textContent = url.value ? "That doesn't look like a YouTube link." : "Paste the link from the YouTube app (Share → Copy link)."; return; }
      if (yt === ed.v.yt && $("#f-title").value) return;
      ed.v.yt = yt;
      $("#f-preview").hidden = false;
      $("#f-preview").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(yt)}?rel=0" allowfullscreen allow="encrypted-media; picture-in-picture; fullscreen"></iframe>`;
      const dup = V().find(x => x.yt === yt && (!ed.original || x.id !== ed.original.id));
      help.innerHTML = dup ? `<span style="color:var(--danger);font-weight:700">Already in the library: “${esc(dup.title)}”.</span>` : "Fetching title…";
      const meta = await fetchMeta(yt);
      if (meta) {
        ed.ytTitle = meta.title;
        $("#f-yt-title").textContent = "YouTube title: " + meta.title;
        if (!$("#f-title").value) { $("#f-title").value = ABDraft.trainingTitle(meta.title, meta.channel); $("#f-title").dispatchEvent(new Event("input")); }
        if (!$("#f-chan").value) $("#f-chan").value = meta.channel;
        if (!dup) help.textContent = "Details filled in. Check the title and add the steps.";
        const cat = guessCategory(meta.title);
        if (cat && !ed.original && !prefill.category) $("#f-cat").value = cat;
      } else if (!dup) help.textContent = "Couldn't fetch the title automatically. Type it in.";
    };
    $("#f-draft").onclick = () => runDraft();
    const qa = $("#f-quiz-ai");
    if (qa) qa.onclick = async () => {
      if ($("#f-quiz").value.trim() && !confirm("Replace the current quiz?")) return;
      const help = $("#f-quiz-help"); qa.disabled = true; help.textContent = textName() + " is writing the quiz…";
      try {
        const quiz = await ABDraft.aiQuiz({ count: quizCount({ essential: $("#f-ess").checked }), title: $("#f-title").value.trim(), summary: $("#f-summary").value.trim(), safety: $("#f-safety").value.trim(),
          steps: $("#f-steps").value.split("\n").map(x => x.trim()).filter(Boolean), ppe: $("#f-ppe").value.split(",").map(x => x.trim()).filter(Boolean), key: geminiKey(), model: geminiModel() || undefined });
        $("#f-quiz").value = ABDraft.quizToText(quiz); help.textContent = "Done — check the right answers (*) before saving.";
      } catch (e) { help.textContent = textName() + " couldn't write it: " + e.message; }
      qa.disabled = false;
    };
    // Fill in the length automatically when a link is pasted.
    url.addEventListener("change", () => setTimeout(async () => { const yt = parseYT(url.value); if (yt && !$("#f-dur").value) { try { const d = await ytDuration(yt); if (d && !$("#f-dur").value) $("#f-dur").value = fmtDur(d); } catch {} } }, 300));
    const fc = $("#f-check");
    if (fc) fc.onclick = async () => {
      const yt = parseYT($("#f-url").value) || ed.v.yt, help = $("#f-draft-help");
      if (!yt) return alert("Paste the YouTube link first.");
      fc.disabled = true; help.textContent = "Gemini is watching the video… (up to a minute)";
      try {
        const d = await ABDraft.aiDraft({ yt, title: $("#f-title").value.trim(), category: $("#f-cat").value, categories: cats(), key: geminiKey(), model: geminiModel() || undefined });
        ed.gemini = { date: today(), model: d.model, ...d.review };
        help.innerHTML = "Checked — your text was not changed. Click Save to keep the result." + reviewHtml(d.review);
      } catch (e) { help.textContent = "Gemini couldn't check it: " + e.message; }
      fc.disabled = false;
    };
    const checkDup = () => {
      const others = V().filter(x => !ed.original || x.id !== ed.original.id);
      const d = ABDraft.findDuplicates({ title: $("#f-title").value, yt: parseYT($("#f-url").value) || ed.v.yt }, others).filter(x => !x.same).slice(0, 3);
      $("#f-dup").innerHTML = d.length ? `<div class="dup-note">${ABIcon("alert")} Similar video${d.length > 1 ? "s" : ""} already in the library: ${d.map(x => `<b>${esc(x.item.title)}</b>`).join(", ")}. Check it isn't the same lesson.</div>` : "";
    };
    $("#f-title").addEventListener("input", checkDup);
    setTimeout(checkDup, 0);
    url.addEventListener("change", onUrl);
    url.addEventListener("paste", () => setTimeout(onUrl, 0));
    $("#f-cat").onchange = e => {
      if (e.target.value !== "__new") return;
      const name = (prompt("New category name:") || "").trim();
      if (!name) { e.target.value = cats()[0] || ""; return; }
      const o = document.createElement("option"); o.textContent = name; e.target.insertBefore(o, e.target.lastElementChild); e.target.value = name;
      ed.newCategory = name;
    };
    $("#f-tr-lang").onchange = e => { stashTr(); ed.trLang = e.target.value; renderTrFields(); };
    $("#f-save").onclick = saveEditor;
  }
  function renderTrFields() {
    const x = ed.tr[ed.trLang] || {};
    const rtl = ["ur", "ar"].includes(ed.trLang) ? 'dir="rtl"' : "";
    $("#tr-fields").innerHTML = `
      <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" ${rtl} value="${esc(x.title || "")}"></div>
      <div class="field"><label for="t-summary">What the video shows</label><textarea class="textarea" id="t-summary" ${rtl}>${esc(x.summary || "")}</textarea></div>
      <div class="field"><label for="t-safety">Safety warning</label><textarea class="textarea" id="t-safety" ${rtl}>${esc(x.safety || "")}</textarea></div>
      <div class="field"><label for="t-steps">Key steps (one per line, same order as English)</label><textarea class="textarea" id="t-steps" ${rtl}>${esc((x.steps || []).join("\n"))}</textarea></div>`;
  }
  function stashTr() {
    const prev = ed.tr[ed.trLang] || {};
    const x = { title: $("#t-title").value.trim(), summary: $("#t-summary").value.trim(), safety: $("#t-safety").value.trim(), steps: $("#t-steps").value.split("\n").map(s => s.trim()).filter(Boolean) };
    if (!(x.title || x.summary || x.safety || x.steps.length)) { delete ed.tr[ed.trLang]; return; }   // empty = let auto-translate refill it
    const same = (prev.title || "") === x.title && (prev.summary || "") === x.summary && (prev.safety || "") === x.safety && JSON.stringify(prev.steps || []) === JSON.stringify(x.steps);
    const next = Object.assign({}, prev, x);
    if (!x.steps.length) delete next.steps;
    if (!same) { delete next.auto; delete next.src; }   // you edited it: keep your version, never overwrite
    ed.tr[ed.trLang] = next;
  }
  const STEPS_NOTE = {
    ai: "Steps were written by Gemini from the video.",
    chapters: "Steps come from the video's own chapters.",
    description: "Steps come from the list in the YouTube description.",
    topic: "Steps are the standard procedure for this kind of job — watch the video and adjust them to match.",
    general: "Steps are general safe-work steps — replace them with the steps shown in the video."
  };
  const geminiModel = () => { try { return localStorage.getItem("ab_gemini_model") || ""; } catch { return ""; } };
  /* Icon picker for paths and talks: a row of line icons; the chosen name goes in a hidden input. */
  const iconPick = (id, cur) => `<input type="hidden" id="${id}" value="${esc(cur)}"><div class="icon-pick" role="radiogroup" data-pick="${id}">${ABIcon.ITEM_ICONS.map(n => `<button type="button" role="radio" aria-checked="${n === cur}" aria-label="${n}" title="${n}" data-icon="${n}">${ABIcon(n)}</button>`).join("")}</div>`;
  function setIconPick(id, name) { const i = $("#" + id); if (!i) return; i.value = name; $$(`[data-pick="${id}"] [data-icon]`).forEach(b => b.setAttribute("aria-checked", b.dataset.icon === name)); }
  document.addEventListener("click", e => { const b = e.target.closest(".icon-pick [data-icon]"); if (b) setIconPick(b.parentNode.dataset.pick, b.dataset.icon); });
  const REC = { approve: ["b-ok", "Gemini: approve", "thumbUp"], maybe: ["b-ess", "Gemini: maybe", "help"], reject: ["b-prob", "Gemini: reject", "thumbDown"] };
  function reviewHtml(rv, compact) {
    if (!rv) return "";
    const [cls, label, ic] = REC[rv.recommend] || REC.maybe;
    return `<div class="ai-rv">
      <span class="badge-s ${cls}">${ABIcon(ic)} ${label} · ${rv.relevance}/10</span>
      ${rv.reason ? `<span class="ai-reason">${esc(rv.reason)}</span>` : ""}
      ${(rv.unsafe || []).length ? `<div class="ai-unsafe">${ABIcon("alert")} Unsafe practice shown: ${rv.unsafe.map(esc).join("; ")}</div>` : ""}
      ${!compact && rv.language && !/^english$/i.test(rv.language) ? `<div class="ai-reason">Spoken language: ${esc(rv.language)}</div>` : ""}
      ${!compact && rv.talking === false ? `<div class="ai-reason">No narration — mostly visual.</div>` : ""}
    </div>`;
  }
  const localGemini = () => { try { return localStorage.getItem("ab_gemini_key") || ""; } catch { return ""; } };
  /* Settings → AI: which AI is on and which goes first. Shared by every admin and the daily jobs. */
  const aiSet = () => Object.assign({ gemini: true, groq: true, openrouter: true, first: "groq" }, data.settings.json.ai || {});
  const geminiOn = () => aiSet().gemini !== false && (keys.gemini || !!localGemini());
  const groqOn = () => aiSet().groq !== false && keys.groq;
  const orOn = () => aiSet().openrouter !== false && keys.openrouter;
  window.ABAI = { get gemini() { return geminiOn(); }, get groq() { return groqOn(); }, get openrouter() { return orOn(); }, get first() { return aiSet().first; }, get orModel() { return aiSet().orModel || ""; } };
  const videoAI = () => geminiOn();                 // watching videos and searching the web: Gemini only
  const textAI = () => geminiOn() || groqOn() || orOn();   // quizzes, talks, checks: any of them
  const aiLabel = () => { const t = textName(); return geminiOn() ? (t === "Gemini" ? "Gemini for everything" + (groqOn() || orOn() ? " · " + [groqOn() && "Groq", orOn() && "OpenRouter"].filter(Boolean).join(" and ") + " as backup" : "") : "Gemini for videos & web search · " + t + " for everything else") : textAI() ? t + " only (no video drafts)" : "off"; };
  // Name of the AI that does text jobs (quizzes, talks, checks) right now.
  const textName = () => {
    const f = aiSet().first, order = (f === "openrouter" ? ["openrouter", "groq"] : ["groq", "openrouter"]).filter(k => k === "groq" ? groqOn() : orOn());
    if (!order.length || (f === "gemini" && geminiOn())) return geminiOn() ? "Gemini" : "AI";
    return order[0] === "groq" ? "Groq" : "OpenRouter";
  };
  const geminiKey = () => keys.gemini ? "server" : localGemini() || (keys.groq || keys.openrouter ? "server" : "");
  async function runDraft() {
    const yt = parseYT($("#f-url").value) || ed.v.yt;
    const title = $("#f-title").value.trim();
    const category = $("#f-cat").value;
    if (!yt || !title) return alert("Paste the YouTube link and check the title first.");
    const filled = ["#f-summary", "#f-safety", "#f-ppe", "#f-steps"].some(id => $(id).value.trim());
    if (filled && !confirm(videoAI() ? "Replace the title, summary, safety, PPE and steps with Gemini's draft?" : "Replace what is already in the summary, safety, PPE and steps?")) return;
    const btn = $("#f-draft"), help = $("#f-draft-help");
    let d;
    if (videoAI()) {
      btn.disabled = true; help.textContent = "Gemini is watching the video… (up to a minute)";
      try {
        const subjects = [...new Set(V().filter(v => v.category === category && v.subject).map(v => v.subject))];
        d = await ABDraft.aiDraft({ yt, title, category, subjects, key: geminiKey(), categories: cats(), model: geminiModel() || undefined });
        help.innerHTML = "Done. Gemini watched the video and drafted this — check it before publishing." + reviewHtml(d.review);
        if (d.review) ed.gemini = { date: today(), ...d.review };
      } catch (e) {
        help.textContent = "Gemini couldn't draft this one (" + e.message + "). Used the built-in rules instead.";
      } finally { btn.disabled = false; }
    }
    if (!d) {
      d = ABDraft.ruleDraft({ title, description: ed.v.description || "", category, videos: V() });
      if (!videoAI()) help.textContent = "Filled in safety, PPE, level and steps." + (d.summary ? "" : " Write the summary from the video.");
    }
    if (d.title && d.source === "ai") { if (!ed.ytTitle) ed.ytTitle = title; $("#f-title").value = d.title; $("#f-title").dispatchEvent(new Event("input")); }
    if (d.summary) $("#f-summary").value = d.summary;
    if (d.safety) $("#f-safety").value = d.safety;
    if (d.ppe && d.ppe.length) $("#f-ppe").value = d.ppe.join(", ");
    if (d.steps && d.steps.length) $("#f-steps").value = d.steps.join("\n");
    if (d.source !== "ai" && STEPS_NOTE[d.stepsFrom]) help.textContent = (videoAI() ? help.textContent + " " : "") + STEPS_NOTE[d.stepsFrom];
    if (d.level) $("#f-level").value = d.level;
    if (d.quiz && d.quiz.length && !$("#f-quiz").value.trim()) $("#f-quiz").value = ABDraft.quizToText(d.quiz);
    if (d.subject && !$("#f-subject").value) $("#f-subject").value = d.subject;
  }
  function guessCategory(text) {
    const t = " " + (text || "").toLowerCase() + " ";
    let best = null, score = 0;
    (data.settings.json.categories || []).forEach(c => {
      const s = (c.keywords || []).reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
      if (s > score) { score = s; best = c.name; }
    });
    return best;
  }
  function closeDrawer() { $("#drawer").hidden = true; document.body.style.overflow = ""; ed = null; }

  async function saveEditor() {
    stashTr();
    const yt = parseYT($("#f-url").value) || ed.v.yt;
    const title = $("#f-title").value.trim();
    const category = $("#f-cat").value;
    if (!yt) return alert("Paste a YouTube link first.");
    if (!title) return alert("Add a title.");
    if (!category || category === "__new") return alert("Choose a category.");
    const qz = ABDraft.parseQuizText($("#f-quiz").value);
    if (qz.errors.length) return alert("Please fix the quiz:\n\n" + qz.errors.join("\n"));
    const dup = V().find(x => x.yt === yt && (!ed.original || x.id !== ed.original.id));
    if (dup && !confirm(`This video is already in the library as “${dup.title}”. Save anyway?`)) return;
    const slug = category.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 5) || "vid";
    const v = {
      id: ed.original ? ed.original.id : `${slug}-${yt}`,
      yt, title, category,
      subject: $("#f-subject").value.trim(),
      level: $("#f-level").value,
      channel: $("#f-chan").value.trim(),
      duration: $("#f-dur").value.trim(),
      added: $("#f-added").value || today(),
      summary: $("#f-summary").value.trim(),
      safety: $("#f-safety").value.trim(),
      ppe: $("#f-ppe").value.split(",").map(s => s.trim()).filter(Boolean),
      steps: $("#f-steps").value.split("\n").map(s => s.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean)
    };
    if ($("#f-ess").checked) v.essential = true;
    if ($("#f-feat").checked) v.featured = true;
    if ($("#f-hidden").checked) v.hidden = true;
    if (Object.keys(ed.tr).length) v.tr = ed.tr;
    if (qz.quiz.length) v.quiz = qz.quiz;
    if (qz.quiz.length && ed.original && ed.original.trq) v.trq = ed.original.trq;   // the translator refreshes these if the quiz changed
    if (ed.gemini) v.gemini = ed.gemini;
    if (ed.ytTitle && ed.ytTitle !== v.title) v.ytTitle = ed.ytTitle;
    const isEdit = !!ed.original, onSaved = ed.onSaved, newCat = ed.newCategory;
    updateFast("videos", d => {
      const i = d.videos.findIndex(x => x.id === v.id);
      if (i >= 0) d.videos[i] = v; else d.videos.unshift(v);
      d.updated = today();
      return d;
    }, `${isEdit ? "Edit" : "Add"} video: ${title}`);
    if (newCat && !(data.settings.json.categories || []).some(c => c.name === newCat)) {
      updateFast("settings", s => { s.categories = s.categories || []; s.categories.push({ name: newCat, icon: "", keywords: [] }); return s; }, `Add category: ${newCat}`);
    }
    closeDrawer();
    if (onSaved) await onSaved(v);
    toast(isEdit ? "Saved." : "Published.");
    render();
  }

  /* ---------- Review queue ---------- */
  let qSort = "new";
  function renderQueue() {
    const p = data.pending.json;
    const q = p.queue || [];
    const errs = Object.entries(p.channelStatus || {}).filter(([, s]) => s && s.error);
    const rvOf = i => (i.draft && i.draft.review) || null;
    const nAi = q.filter(rvOf).length, nRej = q.filter(i => rvOf(i) && rvOf(i).recommend === "reject").length;
    const score = i => { const r = rvOf(i); return r ? ({ approve: 30, maybe: 15, reject: 0 }[r.recommend] || 0) + r.relevance + r.quality / 2 : 12; };
    const sorted = qSort === "ai" ? [...q].sort((a, b) => score(b) - score(a)) : q;
    const dupNote = item => {
      const lib = ABDraft.findDuplicates(item, V())[0];
      if (lib) return `<div class="dup-note">${ABIcon("alert")} ${lib.same ? "Already in the library" : "Looks like a video already in the library"}: <b>${esc(lib.item.title)}</b></div>`;
      const qd = ABDraft.findDuplicates(item, q)[0];
      if (qd) return `<div class="dup-note soft">${ABIcon("alert")} Similar video also waiting in the queue: <b>${esc(qd.item.title)}</b> — you may only need one.</div>`;
      return "";
    };
    $("#app").innerHTML = `
      <div class="card-plain">
        <div class="q-head">
          <div>
            <h2>Review queue</h2>
            <p>When you press <b>Search for new videos</b>, the finder checks your trusted channels and puts new uploads here${videoAI() ? ", reviewed by Gemini" : ""}. Nothing goes live until you approve it.</p>
            <p class="count" style="margin:0">${p.lastRun ? "Last check: " + esc(new Date(p.lastRun).toLocaleString()) : "The finder hasn't run yet."}</p>
          </div>
        </div>
      </div>
      ${errs.length ? `<div class="err err-row"><span>${ABIcon("alert")} ${errs.length} channel${errs.length > 1 ? "s" : ""} couldn't be checked. <a href="#" data-go="channels">See which</a></span><button type="button" class="btn btn-sm" data-find>${ABIcon("refresh")} Retry</button></div><div class="find-msg help" ${finder.msg ? "" : "hidden"}>${finder.msg}</div>` : ""}
      ${q.length ? `<div class="bar"><p class="count grow" style="margin:0">${q.length} waiting · <b>${nAi} of ${q.length}</b> checked by Gemini</p>
        <select id="q-sort"><option value="new" ${qSort === "new" ? "selected" : ""}>Newest first</option><option value="ai" ${qSort === "ai" ? "selected" : ""}>Gemini's best first</option></select>
        ${nRej ? `<button class="btn btn-sm" id="q-rej-ai">Reject ${nRej} Gemini says no</button>` : ""}
        <button class="btn btn-sm" id="q-clear">Reject all</button></div>` : ""}
      ${!videoAI() && !nAi ? `<div class="hint-box">${ABIcon("sparkles")} Turn on Gemini in <b>Settings</b> and it will watch every new video, draft the steps, score how useful it is, and warn you about unsafe practice.</div>` : ""}
      <div class="grid">${sorted.map(item => `
        <article class="qcard" data-yt="${esc(item.yt)}">
          <div class="thumb" data-preview="${esc(item.yt)}" style="cursor:pointer"><img loading="lazy" src="${thumb(item.yt)}" alt="" width="320" height="180">${item.duration ? `<span class="dur">${esc(item.duration)}</span>` : ""}</div>
          <div class="body">
            <div class="meta"><span>${esc(item.suggestedCategory || "Unsorted")}</span>${item.published ? `<span class="dot">${esc(item.published.slice(0, 10))}</span>` : ""}${item.draft && item.draft.source === "ai" ? `<span class="badge-s b-gem">${ABIcon("check")} Checked by Gemini</span>` : `<span class="badge-s b-wait">${ABIcon("hourglass")} Not checked by Gemini yet</span>`}</div>
            <div class="q-title"><h3>${esc((item.draft && item.draft.title) || item.title)}</h3><button class="btn btn-sm btn-icon q-edit" data-review="${esc(item.yt)}" aria-label="Review and edit before approving" title="Review & edit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg></button></div>
            ${item.draft && item.draft.title && item.draft.title !== item.title ? `<div class="yt-t">YouTube: ${esc(item.title)}</div>` : ""}
            <div class="count" style="margin:0">${esc(item.channel || "")}</div>
            ${item.aiError && !(item.draft && item.draft.review) ? `<div class="ai-unsafe" style="background:var(--surface-2);color:var(--muted)">Gemini couldn't check it yet (${item.aiTries || 0}/3 tries): ${esc(item.aiError)}</div>` : ""}
            ${item.draft && item.draft.review ? reviewHtml(item.draft.review, true) : item.draft ? `<div class="ai-reason">${ABIcon("sparkles")} Basic draft ready · ${{ chapters: "steps from the YouTube chapters", description: "steps from the YouTube description", topic: "standard steps for this job", general: "general safe-work steps" }[item.draft.stepsFrom] || "no steps yet"}</div>` : ""}
            ${dupNote(item)}
            ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ""}
            <div class="acts">
              <button class="btn btn-sm" data-reject="${esc(item.yt)}">${ABIcon("x")} Reject</button>
              <button class="btn btn-sm btn-primary" data-approve="${esc(item.yt)}">${ABIcon("check")} Approve</button>
            </div>
          </div>
        </article>`).join("")}</div>
      ${q.length ? "" : `<div class="empty"><div class="big">${ABIcon("checkCircle")}</div><h3>Nothing waiting</h3><p>New videos from your channels will appear here.</p></div>`}`;
    const qs = $("#q-sort"); if (qs) qs.onchange = e => { qSort = e.target.value; renderQueue(); };
    const qr = $("#q-rej-ai");
    if (qr) qr.onclick = async () => {
      const yts = q.filter(i => rvOf(i) && rvOf(i).recommend === "reject").map(i => i.yt);
      if (!confirm(`Reject the ${yts.length} videos Gemini marked as not suitable? They won't be suggested again.`)) return;
      updateFast("pending", d => { d.rejected = [...new Set([...(d.rejected || []), ...yts])].slice(-3000); d.queue = (d.queue || []).filter(i => !yts.includes(i.yt)); return d; }, "Reject videos Gemini marked unsuitable");
      render();
    };
    const qc = $("#q-clear");
    if (qc) qc.onclick = async () => {
      if (!confirm(`Reject all ${q.length} videos in the queue?`)) return;
      const yts = q.map(i => i.yt);
      updateFast("pending", d => { d.rejected = [...new Set([...(d.rejected || []), ...yts])].slice(-3000); d.queue = (d.queue || []).filter(i => !yts.includes(i.yt)); return d; }, "Reject all queued videos");
      render();
    };
  }
  async function removeFromQueue(yt, reject) {
    updateFast("pending", d => {
      d.queue = (d.queue || []).filter(i => i.yt !== yt);
      if (reject) d.rejected = [...new Set([...(d.rejected || []), yt])].slice(-3000);
      return d;
    }, reject ? `Reject queued video ${yt}` : `Approve queued video ${yt}`);
  }
  /* ✓ Approve: publish straight from the draft, no editor. Falls back to the editor if something is missing. */
  async function quickApprove(yt, btn) {
    const item = (data.pending.json.queue || []).find(i => i.yt === yt); if (!item) return;
    const d = item.draft || {};
    const category = cats().includes(item.suggestedCategory) ? item.suggestedCategory : (cats().includes(d.category) ? d.category : "");
    if (!category) { toast("Choose a category first."); return approve(yt); }
    const dup = V().find(x => x.yt === yt);
    if (dup && !confirm(`This video is already in the library as “${dup.title}”. Add it again?`)) return;
    const slug = category.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 5) || "vid";
    const v = { id: `${slug}-${yt}`, yt, title: d.title || ABDraft.trainingTitle(item.title, item.channel), category,
      subject: d.subject || "", level: d.level || "Intermediate", channel: item.channel || "", duration: item.duration || "", added: today(),
      summary: d.summary || "", safety: d.safety || "", ppe: d.ppe || [], steps: d.steps || [] };
    if (d.quiz && d.quiz.length) v.quiz = d.quiz;
    if (d.review) v.gemini = { date: today(), ...d.review };
    if (item.title && item.title !== v.title) v.ytTitle = item.title;
    if (category === "Health & Safety") v.essential = true;
    updateFast("videos", x => { const i = x.videos.findIndex(y => y.id === v.id); if (i >= 0) x.videos[i] = v; else x.videos.unshift(v); x.updated = today(); return x; }, `Approve video: ${v.title}`);
    removeFromQueue(yt, false);
    toast(`Published “${v.title}”.`);
    render();
  }
  function approve(yt) {
    const item = (data.pending.json.queue || []).find(i => i.yt === yt); if (!item) return;
    const d = item.draft || {};
    const fromDraft = {};
    ["summary", "safety", "subject", "level"].forEach(k => { if (d[k]) fromDraft[k] = d[k]; });
    ["ppe", "steps", "quiz"].forEach(k => { if (d[k] && d[k].length) fromDraft[k] = d[k]; });
    if (item.draft) { fromDraft.draftSource = d.source; fromDraft.stepsFrom = d.stepsFrom; fromDraft.review = d.review; }
    openEditor(null, {
      ...fromDraft,
      yt: item.yt, title: d.title || ABDraft.trainingTitle(item.title, item.channel), ytTitle: item.title, channel: item.channel, duration: item.duration || "",
      category: item.suggestedCategory || cats()[0], description: item.description || "",
      ...(item.suggestedCategory === "Health & Safety" ? { essential: true } : {})
    }, async () => { await removeFromQueue(yt, false); });
  }

  /* ---------- Learning paths ---------- */
  let pe = null;   // path being edited
  const P = () => data.paths.json.paths || (data.paths.json.paths = []);
  function renderPaths() {
    if (pe) return renderPathEditor();
    const byId = new Map(V().map(v => [v.id, v]));
    $("#app").innerHTML = `
      <div class="bar"><p class="help grow" style="margin:0">Learning paths are short courses shown on the home screen (e.g. “New HVAC Technician”). Staff tick off videos as they go; their progress stays on their own phone.</p>
        <button class="btn btn-primary" id="p-add">＋ New path</button></div>
      <div class="rows">${P().map((p, i) => {
        const vids = (p.videos || []).map(id => byId.get(id)).filter(Boolean);
        return `<div class="row">
          <div class="thumb path-ico">${ABIcon.item(p.icon, p.title, "grad")}</div>
          <div><h3>${esc(p.title)}</h3>
            <div class="meta"><span>${vids.length} video${vids.length === 1 ? "" : "s"}</span>${p.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
            ${p.tr && Object.keys(p.tr).length ? `<span class="badge-s b-ok">${ABIcon("globe")} ${Object.keys(p.tr).length}/8</span>` : `<span class="badge-s b-hidden">Translating…</span>`}</div></div>
          <div class="row-actions">
            <button class="btn btn-sm" data-p-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">${ABIcon("arrowUp")}</button>
            <button class="btn btn-sm" data-p-edit="${i}">Edit</button>
            <button class="btn btn-sm btn-danger" data-p-del="${i}">Delete</button>
          </div></div>`;
      }).join("") || `<div class="empty"><h3>No learning paths yet</h3></div>`}</div>`;
    $("#p-add").onclick = () => { pe = { index: -1, p: { id: "", icon: "grad", title: "", description: "", videos: [] } }; renderPaths(); };
    $$("[data-p-edit]").forEach(b => b.onclick = () => { const i = +b.dataset.pEdit; pe = { index: i, p: JSON.parse(JSON.stringify(P()[i])) }; renderPaths(); });
    $$("[data-p-del]").forEach(b => b.onclick = async () => {
      const p = P()[+b.dataset.pDel]; if (!confirm(`Delete the path “${p.title}”? The videos stay in the library.`)) return;
      updateFast("paths", d => { d.paths = (d.paths || []).filter(x => x.id !== p.id); return d; }, `Delete learning path: ${p.title}`);
      toast("Deleted."); render();
    });
    $$("[data-p-up]").forEach(b => b.onclick = async () => {
      const id = P()[+b.dataset.pUp].id;
      updateFast("paths", d => { const i = d.paths.findIndex(x => x.id === id); if (i > 0) d.paths.splice(i - 1, 0, d.paths.splice(i, 1)[0]); return d; }, "Reorder learning paths");
      render();
    });
  }
  /* Assigned training: a learning path that a trade (or everyone) must finish, with an optional due date. */
  const AS = () => data.paths.json.assignments || (data.paths.json.assignments = []);
  function assignHtml() {
    const byId = new Map(P().map(p => [p.id, p]));
    return `<form class="card-plain" id="as-form" style="margin-top:18px">
      <h2>Assign a learning path</h2>
      <p class="help">Staff see it at the top of their home screen until they finish, with the due date. Tick no trade to assign it to everyone. Trades come from the staff list.</p>
      <div class="rows">${AS().map((a, i) => { const p = byId.get(a.path); return `<div class="ch-row"><div><b>${p ? ABIcon.item(p.icon, p.title, "grad") + " " + esc(p.title) : esc(a.path + " (deleted path)")}</b>
        <div class="small">For: ${(a.trades || []).length ? a.trades.map(esc).join(", ") : "everyone"}${a.due ? " · due " + esc(a.due) : " · no due date"}${a.note ? " · " + esc(a.note) : ""}</div></div>
        <div class="row-actions"><button type="button" class="btn btn-sm btn-danger" data-as-del="${i}">Remove</button></div></div>`; }).join("") || `<p class="help">Nothing assigned yet.</p>`}</div>
      <div class="two" style="margin-top:12px">
        <div class="field"><label for="as-path">Learning path</label><select class="input" id="as-path">${P().filter(p => !p.hidden).map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("")}</select></div>
        <div class="field"><label for="as-due">Due date (optional)</label><input class="input" id="as-due" type="date"></div>
      </div>
      <div class="field"><label>For which trades? (none ticked = everyone)</label><div class="as-trades">${cats().map(c => `<label class="check"><input type="checkbox" class="as-tr" value="${esc(c)}"> ${esc(c)}</label>`).join("")}</div></div>
      <div class="field"><label for="as-note">Note for staff (optional)</label><input class="input" id="as-note" maxlength="140" placeholder="e.g. Required before working on site"></div>
      <button class="btn btn-primary">Assign</button>
    </form>`;
  }
  function wireAssign() {
    const f = $("#as-form"); if (!f) return;
    f.onsubmit = async e => {
      e.preventDefault();
      const a = { id: "as-" + Date.now().toString(36), path: $("#as-path").value, trades: $$(".as-tr").filter(x => x.checked).map(x => x.value), due: $("#as-due").value, note: $("#as-note").value.trim() };
      if (!a.path) return alert("Choose a learning path.");
      if (!a.due) delete a.due;
      if (!a.note) delete a.note;
      updateFast("paths", d => { d.assignments = d.assignments || []; d.assignments.push(a); return d; }, "Assign learning path");
      toast("Assigned."); render();
    };
    $$("[data-as-del]").forEach(b => b.onclick = async () => {
      const a = AS()[+b.dataset.asDel]; if (!confirm("Remove this assignment? Staff progress is kept.")) return;
      updateFast("paths", d => { d.assignments = (d.assignments || []).filter(x => x.id !== a.id); return d; }, "Remove assigned training");
      render();
    });
  }
  function renderPathEditor() {
    const p = pe.p, byId = new Map(V().map(v => [v.id, v]));
    const avail = V().filter(v => !p.videos.includes(v.id));
    const groups = cats().map(c => [c, avail.filter(v => v.category === c)]).filter(([, l]) => l.length);
    $("#app").innerHTML = `
      <button class="btn btn-sm btn-ghost" id="pe-back">‹ All paths</button>
      <h2 style="margin:10px 0 14px">${pe.index < 0 ? "New learning path" : "Edit learning path"}</h2>
      <div class="field"><label for="pe-title">Title</label><input class="input" id="pe-title" placeholder="e.g. New HVAC Technician" value="${esc(p.title)}"></div>
      <div class="field"><label>Icon</label>${iconPick("pe-icon", ABIcon.nameFor(p.icon, p.title, "grad"))}</div>
      <div class="field"><label for="pe-desc">Description</label><textarea class="textarea" id="pe-desc" placeholder="Who is this for and what will they learn?">${esc(p.description || "")}</textarea></div>
      <label class="check"><input type="checkbox" id="pe-hidden" ${p.hidden ? "checked" : ""}> Hide from staff</label>
      <h3 style="margin:18px 0 8px">Videos in order (${p.videos.length})</h3>
      <div class="rows">${p.videos.map((id, i) => {
        const v = byId.get(id);
        return `<div class="row">
          <div class="thumb">${v ? `<img src="${thumb(v.yt)}" alt="" width="320" height="180">` : ""}</div>
          <div><h3>${i + 1}. ${esc(v ? v.title : id + " (deleted)")}</h3><div class="meta">${v ? `<span>${esc(v.category)}</span><span class="lvl lvl-${esc(v.level)}">${esc(v.level)}</span>` : ""}</div></div>
          <div class="row-actions">
            <button class="btn btn-sm" data-pv-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">${ABIcon("arrowUp")}</button>
            <button class="btn btn-sm" data-pv-down="${i}" ${i === p.videos.length - 1 ? "disabled" : ""} aria-label="Move down">${ABIcon("arrowDown")}</button>
            <button class="btn btn-sm btn-danger" data-pv-rm="${i}" aria-label="Remove">${ABIcon("x")}</button>
          </div></div>`;
      }).join("") || `<p class="help">No videos yet. Add some below.</p>`}</div>
      <div class="bar" style="margin-top:12px">
        <select class="input grow" id="pe-add"><option value="">＋ Add a video…</option>${groups.map(([c, l]) => `<optgroup label="${esc(c)}">${l.map(v => `<option value="${esc(v.id)}">${esc(v.title)}</option>`).join("")}</optgroup>`).join("")}</select>
      </div>
      <div class="bar" style="margin-top:20px;justify-content:flex-end">
        <button class="btn" id="pe-cancel">Cancel</button>
        <button class="btn btn-primary" id="pe-save">${pe.index < 0 ? "Publish path" : "Save path"}</button>
      </div>`;
    const keep = () => { p.icon = $("#pe-icon").value.trim(); p.title = $("#pe-title").value.trim(); p.description = $("#pe-desc").value.trim(); p.hidden = $("#pe-hidden").checked; };
    const move = (i, d) => { keep(); const [x] = p.videos.splice(i, 1); p.videos.splice(i + d, 0, x); renderPathEditor(); };
    $$("[data-pv-up]").forEach(b => b.onclick = () => move(+b.dataset.pvUp, -1));
    $$("[data-pv-down]").forEach(b => b.onclick = () => move(+b.dataset.pvDown, 1));
    $$("[data-pv-rm]").forEach(b => b.onclick = () => { keep(); p.videos.splice(+b.dataset.pvRm, 1); renderPathEditor(); });
    $("#pe-add").onchange = e => { if (!e.target.value) return; keep(); p.videos.push(e.target.value); renderPathEditor(); };
    $("#pe-back").onclick = $("#pe-cancel").onclick = () => { pe = null; renderPaths(); };
    $("#pe-save").onclick = async () => {
      keep();
      if (!p.title) return alert("Add a title.");
      if (!p.videos.length) return alert("Add at least one video.");
      if (!p.hidden) delete p.hidden;
      if (!p.id) {
        const base = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "path";
        let id = base, n = 2; while (P().some(x => x.id === id)) id = base + "-" + n++;
        p.id = id;
      }
      // Changed wording → let the translator redo automatic translations.
      if (p.tr) for (const k in p.tr) if (p.tr[k].auto) p.tr[k].src = "";
      const isNew = pe.index < 0;
      updateFast("paths", d => {
        d.paths = d.paths || [];
        const i = d.paths.findIndex(x => x.id === p.id);
        if (i >= 0) d.paths[i] = p; else d.paths.push(p);
        return d;
      }, `${isNew ? "Add" : "Edit"} learning path: ${p.title}`);
      pe = null; toast(isNew ? "Published." : "Saved."); render();
    };
  }

  /* ---------- Video requests ---------- */
  const reqKey = () => "supabase";
  let reqs = null, reqErr = "", reqFilter = "new";
  const found = {};
  function foundHtml(r) {
    const f = found[r.id];
    if (!f) return "";
    if (f.error) return `<p class="help" style="color:var(--danger)">Gemini couldn't find videos: ${esc(f.error)}</p>`;
    return `<div class="fv-list">${f.map(v => {
      const dup = V().find(x => x.yt === v.yt);
      return `<div class="fv">
        <a href="https://www.youtube.com/watch?v=${esc(v.yt)}" target="_blank" rel="noopener" class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt=""></a>
        <div><b>${esc(v.title || v.yt)}</b><div class="small">${esc(v.channel)}${v.why ? " — " + esc(v.why) : ""}</div>
          ${dup ? `<span class="badge-s b-ok">Already in library</span>` : `<button class="btn btn-sm btn-primary" data-fv-add="${esc(r.id)}|${esc(v.yt)}">Review & add</button> <button class="btn btn-sm" data-fv-q="${esc(r.id)}|${esc(v.yt)}">Send to review queue</button>`}</div>
      </div>`;
    }).join("")}<p class="help">Found with Google Search — open each link to check it before adding.</p></div>`;
  }
  async function loadRequests() {
    const { data: rows, error } = await sb.from("requests").select("*").order("time", { ascending: false }).limit(2000);
    if (error) { reqErr = error.message; return; }
    reqs = rows || []; reqErr = "";
  }
  function badgeRequests() {
    const n = (reqs || []).filter(r => r.status === "new").length;
    const b = $("#n-req"); if (b) { b.hidden = !n; b.textContent = n; }
    if (data.pending) syncPhoneNav((data.pending.json.queue || []).length);
  }
  async function reqAction(body) {
    busy(true);
    try {
      const q = body.action === "delete" ? sb.from("requests").delete().eq("id", body.id) : sb.from("requests").update({ status: body.status }).eq("id", body.id);
      const { error } = await q; if (error) throw new Error(error.message);
    } catch (e) { alert("Couldn't update the request: " + e.message); }
    finally { busy(false); }
    await loadRequests(); render();
  }
  function renderRequests() {
    badgeRequests();
    if (data.settings.json.requestsEnabled === false) {
      $("#app").innerHTML = `<div class="card-plain"><h2>Video requests</h2><p>The <b>Request a video</b> button is turned off. Turn it on in <b>Settings → Requests &amp; Ask AI</b>.</p></div>`;
      return;
    }
    const list = (reqs || []).filter(r => reqFilter === "all" || (reqFilter === "new" ? r.status === "new" : r.status !== "new"));
    const ago = iso => { const d = (Date.now() - Date.parse(iso)) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : Math.floor(d) + " days ago"; };
    $("#app").innerHTML = `
      ${reqErr ? `<div class="err">${ABIcon("alert")} ${esc(reqErr)}</div>` : ""}
      <div class="bar">
        <select id="rq-filter">${[["new", "New"], ["done", "Done"], ["all", "All"]].map(([k, l]) => `<option value="${k}" ${k === reqFilter ? "selected" : ""}>${l}</option>`).join("")}</select>
        <p class="count grow" style="margin:0">${reqs ? `${(reqs || []).filter(r => r.status === "new").length} new · ${(reqs || []).length} total` : "Loading…"}</p>
        <button class="btn btn-sm" id="rq-refresh">${ABIcon("refresh")} Refresh</button>
      </div>
      <div class="rows">${list.map(r => `
        <div class="row req ${r.status !== "new" ? "is-hidden" : ""}">
          <div class="req-ico">${ABIcon("hand")}</div>
          <div>
            <h3>${esc(r.topic)}</h3>
            ${r.details ? `<p class="req-d">${esc(r.details)}</p>` : ""}
            <div class="meta">
              ${r.category ? `<span>${esc(r.category)}</span>` : ""}
              ${r.name ? `<span>${ABIcon("user")} ${esc(r.name)}</span>` : ""}${r.site ? `<span>${ABIcon("pin")} ${esc(r.site)}</span>` : ""}
              <span>${esc(ago(r.time))}</span>${r.lang && r.lang !== "en" ? `<span>${esc(String(r.lang).toUpperCase())}</span>` : ""}
              ${r.status !== "new" ? `<span class="badge-s b-ok">${ABIcon("check")} Done</span>` : ""}
            </div>
          </div>
          <div class="row-actions">
            ${videoAI() && r.status === "new" ? `<button class="btn btn-sm" data-rq-find="${esc(r.id)}">${ABIcon("sparkles")} Find videos</button>` : ""}
            <a class="btn btn-sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(r.topic)}" target="_blank" rel="noopener">Search YouTube</a>
            ${r.status === "new" ? `<button class="btn btn-sm btn-primary" data-rq-add="${esc(r.id)}">Add video</button><button class="btn btn-sm" data-rq-done="${esc(r.id)}">Mark done</button>` : `<button class="btn btn-sm" data-rq-open="${esc(r.id)}">Reopen</button>`}
            <button class="btn btn-sm btn-danger" data-rq-del="${esc(r.id)}">Delete</button>
          </div>
          <div class="rq-found" id="found-${esc(r.id)}">${foundHtml(r)}</div>
        </div>`).join("") || (reqs ? `<div class="empty"><div class="big">${ABIcon("inbox")}</div><h3>No ${reqFilter === "all" ? "" : reqFilter + " "}requests</h3></div>` : "")}</div>`;
    $("#rq-filter").onchange = e => { reqFilter = e.target.value; renderRequests(); };
    $("#rq-refresh").onclick = async () => { reqs = null; renderRequests(); await loadRequests(); render(); };
    $$("[data-rq-find]").forEach(b => b.onclick = async () => {
      const r = reqs.find(x => String(x.id) === b.dataset.rqFind);
      const box = $("#found-" + r.id);
      b.disabled = true; box.innerHTML = `<p class="help">Gemini is searching YouTube for “${esc(r.topic)}”…</p>`;
      try {
        found[r.id] = await ABDraft.aiFindVideos({ topic: r.topic, details: r.details, category: r.category, key: geminiKey(), model: geminiModel() || undefined });
        if (!found[r.id].length) throw new Error("No videos found");
      } catch (e) { found[r.id] = { error: e.message }; }
      b.disabled = false; box.innerHTML = foundHtml(r); wireFound();
    });
    const wireFound = () => {
      $$("[data-fv-add]").forEach(b => b.onclick = () => {
        const [rid, yt] = b.dataset.fvAdd.split("|");
        const r = reqs.find(x => String(x.id) === rid), v = (found[rid] || []).find(x => x.yt === yt);
        openEditor(null, { yt, title: v.title, channel: v.channel, ...(cats().includes(r.category) ? { category: r.category } : {}) },
          async () => { await reqAction({ action: "status", id: r.id, status: "done" }); });
      });
      $$("[data-fv-q]").forEach(b => b.onclick = async () => {
        const [rid, yt] = b.dataset.fvQ.split("|");
        const r = reqs.find(x => String(x.id) === rid), v = (found[rid] || []).find(x => x.yt === yt);
        updateFast("pending", d => { d.queue = d.queue || []; if (!d.queue.some(i => i.yt === yt)) d.queue.unshift({ yt, title: v.title, channel: v.channel, suggestedCategory: r.category || "", description: "Found by Gemini for a staff request: " + r.topic, found: new Date().toISOString(), published: "", duration: "" }); return d; }, `Queue video for request: ${r.topic}`);
        b.innerHTML = ABIcon("check") + " In queue"; b.disabled = true; render();
      });
    };
    wireFound();
    $$("[data-rq-done]").forEach(b => b.onclick = () => reqAction({ action: "status", id: b.dataset.rqDone, status: "done" }));
    $$("[data-rq-open]").forEach(b => b.onclick = () => reqAction({ action: "status", id: b.dataset.rqOpen, status: "new" }));
    $$("[data-rq-del]").forEach(b => b.onclick = () => { if (confirm("Delete this request?")) reqAction({ action: "delete", id: b.dataset.rqDel }); });
    $$("[data-rq-add]").forEach(b => b.onclick = () => {
      const r = reqs.find(x => String(x.id) === b.dataset.rqAdd);
      openEditor(null, cats().includes(r.category) ? { category: r.category } : {}, async () => { await reqAction({ action: "status", id: r.id, status: "done" }); });
    });
    if (reqs === null && !reqErr) loadRequests().then(render);
  }

  /* ---------- Staff, records, supervisors and usage counts (Supabase) ---------- */
  const scriptUrl = () => "supabase";
  const dbErr = error => { if (error) throw new Error(error.message); };
  async function sGet(params) {
    if (params.what === "records") { const { data: j, error } = await sb.rpc("admin_records", { p_days: 0 }); dbErr(error); return j; }
    if (params.what === "staff") { const { data: rows, error } = await sb.from("staff").select("hr, name, site, trade, active").order("name"); dbErr(error); return { ok: true, staff: rows }; }
    if (params.what === "supervisors") { const { data: rows, error } = await sb.from("supervisors").select("name, active").order("name"); dbErr(error); return { ok: true, supervisors: rows.map(r => ({ ...r, pin: "••••" })) }; }
    if (params.what === "stats") { const { data: j, error } = await sb.rpc("admin_stats", { p_days: +params.days || 30 }); dbErr(error); return j; }
    throw new Error("unknown");
  }
  async function sPost(body) {
    if (body.action === "staff-save") {
      const rows = body.staff.map(x => ({ hr: String(x.hr).toUpperCase().replace(/\s+/g, ""), name: x.name, site: x.site || "", trade: x.trade || "", active: x.active !== false }));
      const have = new Set(((ppl && ppl.staff) || []).map(x => x.hr));
      const { error } = await sb.from("staff").upsert(rows, { onConflict: "hr" }); dbErr(error);
      const added = rows.filter(r => !have.has(r.hr)).length;
      return { ok: true, added, updated: rows.length - added };
    }
    if (body.action === "staff-remove") { const { error } = await sb.from("staff").delete().eq("hr", body.hr); dbErr(error); return { ok: true }; }
    if (body.action === "sup-save") {
      const { data: j, error } = await sb.rpc("admin_set_supervisor", { p_name: body.name, p_pin: body.pin }); dbErr(error);
      if (!j.ok) throw new Error(scriptErr(j.error)); return j;
    }
    if (body.action === "sup-remove") { const { error } = await sb.from("supervisors").delete().eq("name", body.name); dbErr(error); return { ok: true }; }
    throw new Error("unknown");
  }
  const scriptErr = e => ({ pin: "The PIN must be 4–12 digits.", pinused: "Another supervisor already has that PIN.", notfound: "Not found." }[e] || e || "error");
  let scriptVer = 2;
  async function checkScript() { return 2; }
  const oldScriptHtml = () => "";
  const csvCell = x => { const t = String(x ?? ""); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function download(name, rows) {
    const blob = new Blob(["\ufeff" + rows.map(r => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- Staff & training records ---------- */
  let ppl = null, pplErr = "", pplQ = "", pplSel = null, pplSub = "people", sups = null;
  async function loadPeople() {
    try { const j = await sGet({ what: "records" }); ppl = j; pplErr = ""; }
    catch (e) { pplErr = e.message; }
  }
  function summarise() {
    const staff = new Map();
    (ppl.staff || []).forEach(st => staff.set(st.hr, { ...st, videos: new Set(), quiz: {}, paths: new Set(), certs: [], last: "", n: 0 }));
    const anon = new Map();
    (ppl.records || []).forEach(([time, hr, name, site, trade, type, item, title, score, n, pass]) => {
      let p = hr ? staff.get(hr) : null;
      if (!p) { const k = hr || ("~" + String(name).toLowerCase()); p = anon.get(k); if (!p) { p = { hr, name, site, trade, active: !hr ? null : false, unknown: true, videos: new Set(), quiz: {}, paths: new Set(), certs: [], last: "", n: 0 }; anon.set(k, p); } }
      p.n++; if (time > p.last) p.last = time;
      if (type === "video") p.videos.add(item);
      if (type === "quiz") { const ok = pass === true || String(pass) === "true"; if (!p.quiz[item] || ok) p.quiz[item] = ok; }
      if (type === "path") p.paths.add(item);
    });
    (ppl.certs || []).forEach(c => { const p = staff.get(c.hr) || [...anon.values()].find(a => a.hr === c.hr || (!c.hr && a.name === c.name)); if (p) p.certs.push(c); });
    return [...staff.values(), ...anon.values()];
  }
  function renderPeople() {
    if (!ppl && !pplErr) { $("#app").innerHTML = `<p class="count" style="padding:24px 0">Loading staff and records…</p>`; loadPeople().then(() => peopleView() && renderPeople()); return; }
    const sub = view === "people" ? `<div class="seg" style="margin-bottom:16px">${[["people", "Staff progress"], ["staff", "Staff list"]].map(([k, l]) => `<button data-psub="${k}" aria-pressed="${pplSub === k}">${l}</button>`).join("")}</div>` : "";
    const head = `${pplErr ? `<div class="err">${ABIcon("alert")} ${esc(pplErr)}</div>` : ""}
      ${!data.settings.json.staffLogin ? `<div class="hint-box">Staff sign-in is <b>off</b>. Add your staff below, then turn it on in <b>Settings → Staff & training</b>. From then on, staff must enter their HR number to use the app, and all progress is recorded here.</div>` : ""}
      ${sub}`;
    if (!ppl) { $("#app").innerHTML = head; wirePeopleSub(); return; }
    const people = summarise();
    const byPath = new Map((data.paths.json.paths || []).map(p => [p.id, p]));
    const vById = new Map(V().map(v => [v.id, v]));
    let body = "";
    if (pplSub === "people") {
      if (pplSel) {
        const p = people.find(x => (x.hr || "~" + String(x.name).toLowerCase()) === pplSel);
        const recs = (ppl.records || []).filter(r => p && (p.hr ? r[1] === p.hr : !r[1] && r[2] === p.name)).slice().reverse();
        const label = { video: ["play", "Watched"], quiz: ["quiz", "Quiz"], path: ["grad", "Finished path"], cert: ["award", "Certificate"], signoff: ["pen", "Signed off"] };
        body = p ? `<button class="btn btn-sm btn-ghost" id="pp-back">‹ All staff</button>
          <div class="card-plain"><h2>${esc(p.name || "(no name)")} ${p.hr ? `<span class="badge-s b-hidden">HR ${esc(p.hr)}</span>` : `<span class="badge-s b-prob">Not signed in</span>`}</h2>
          <p class="count">${[p.trade, p.site].filter(Boolean).map(esc).join(" · ")}</p>
          <p><b>${p.videos.size}</b> videos watched · <b>${Object.values(p.quiz).filter(Boolean).length}</b> quizzes passed · <b>${p.paths.size}</b> paths finished · <b>${p.certs.length}</b> certificates</p>
          ${p.certs.length ? `<p>${p.certs.map(c => `${ABIcon("award")} <b>${esc(c.title)}</b> (${esc(String(c.time).slice(0, 10))}, code ${esc(c.code)}${c.signedBy ? ", signed off by " + esc(c.signedBy) : ""})`).join("<br>")}</p>` : ""}</div>
          <div class="rows">${recs.map(r => `<div class="row rec"><div class="req-ico">${label[r[5]] ? ABIcon(label[r[5]][0]) : "•"}</div><div><h3>${esc(r[7] || r[6])}</h3><div class="meta"><span>${esc(label[r[5]] ? label[r[5]][1] : r[5])}</span>${r[5] === "quiz" ? `<span class="badge-s ${String(r[10]) === "true" ? "b-ok" : "b-prob"}">${esc(r[8])}/${esc(r[9])} ${String(r[10]) === "true" ? "passed" : "not passed"}</span>` : ""}<span>${esc(new Date(r[0]).toLocaleString())}</span></div></div></div>`).join("") || `<p class="help">No activity yet.</p>`}</div>` : `<p>Not found.</p>`;
      } else {
        const words = pplQ.toLowerCase().split(/\s+/).filter(Boolean);
        const list = people.filter(p => !words.length || words.every(w => [p.hr, p.name, p.site, p.trade].join(" ").toLowerCase().includes(w)))
          .sort((a, b) => (b.last || "").localeCompare(a.last || "") || String(a.name).localeCompare(String(b.name)));
        const active30 = people.filter(p => p.last && Date.now() - Date.parse(p.last) < 30 * 864e5).length;
        body = `<div class="bar"><input class="input grow" id="pp-q" type="search" placeholder="Search name, HR number, site, trade…" value="${esc(pplQ)}">
            <button class="btn btn-sm" id="pp-csv">${ABIcon("download")} Export summary</button><button class="btn btn-sm" id="pp-csv2">${ABIcon("download")} Export all records</button><button class="btn btn-sm" id="pp-refresh">${ABIcon("refresh")} Refresh</button></div>
          <p class="count">${(ppl.staff || []).length} staff on the list · ${active30} active in the last 30 days · ${(ppl.certs || []).length} certificates</p>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>HR</th><th>Trade</th><th>Site</th><th>Videos</th><th>Quizzes</th><th>Paths</th><th>Certs</th><th>Last active</th></tr></thead><tbody>
          ${list.map(p => `<tr data-pp="${esc(p.hr || "~" + String(p.name).toLowerCase())}" class="${p.active === false && !p.unknown ? "is-hidden" : ""}"><td><b>${esc(p.name || "—")}</b>${p.unknown ? ` <span class="badge-s b-prob" title="${p.hr ? "Not on the staff list" : "Recorded before sign-in was turned on"}">${p.hr ? "Not on list" : "No HR no."}</span>` : p.active === false ? ` <span class="badge-s b-hidden">Inactive</span>` : ""}</td>
            <td>${esc(p.hr || "")}</td><td>${esc(p.trade || "")}</td><td>${esc(p.site || "")}</td><td>${p.videos.size}</td><td>${Object.values(p.quiz).filter(Boolean).length}</td><td>${p.paths.size}</td><td>${p.certs.length}</td>
            <td>${p.last ? esc(new Date(p.last).toLocaleDateString()) : `<span class="help">never</span>`}</td></tr>`).join("") || `<tr><td colspan="9" class="help">No staff yet. Add them in the Staff list tab.</td></tr>`}
          </tbody></table></div>`;
      }
    } else if (pplSub === "assign") {
      const as = (data.paths.json.assignments || []);
      body = as.length ? as.map(a => {
        const p = byPath.get(a.path); if (!p) return "";
        const target = people.filter(x => !x.unknown && x.active !== false && (!(a.trades || []).length || (a.trades || []).includes(x.trade)));
        const done = target.filter(x => x.paths.has(a.path)), notDone = target.filter(x => !x.paths.has(a.path));
        const pct = target.length ? Math.round(done.length / target.length * 100) : 0;
        const over = a.due && a.due < today();
        return `<div class="card-plain"><h2>${esc(p.title)} ${over && notDone.length ? `<span class="tag over">Overdue</span>` : ""}</h2>
          <p class="count">For: ${(a.trades || []).length ? a.trades.map(esc).join(", ") : "everyone"}${a.due ? ` · due <b style="${over ? "color:var(--danger)" : ""}">${esc(a.due)}</b>` : ""}</p>
          <div class="pc-bar big${pct === 100 ? " ok" : over ? " over" : ""}"><i style="width:${pct}%"></i></div>
          <p><b>${done.length} of ${target.length}</b> finished (${pct}%)</p>
          ${notDone.length ? `<details class="box"><summary>${notDone.length} not finished yet${over ? " — overdue" : ""}</summary><p style="margin:8px 0 0">${notDone.map(x => `${esc(x.name)} <span class="help">(${esc(x.hr)}${x.videos.size ? ", " + pathProgress(x, p) : ""})</span>`).join("<br>")}</p>
            <button class="btn btn-sm" data-as-csv="${esc(a.id)}" style="margin-top:8px">${ABIcon("download")} Export list</button></details>` : ""}
        </div>`;
      }).join("") : `<div class="empty"><h3>No assigned training yet</h3><p>Use the form below to assign a learning path.</p></div>`;
      body += P().length ? assignHtml() : "";
    } else if (pplSub === "staff") {
      const st = (ppl.staff || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
      body = `<form class="card-plain" id="st-add">
          <h2>Add or update staff</h2>
          <p class="help">One person per line: <b>HR number, Full name, Site, Trade</b>. Site and trade are optional. You can copy the columns straight from Excel. Existing HR numbers are updated.</p>
          <textarea class="textarea" id="st-rows" rows="6" placeholder="10234, Mohammed Rafiq, Dubai Mall, HVAC&#10;10235, Arjun Nair, Marina Tower, Electrical"></textarea>
          <div class="help">Trades must match your category names to get the right assigned training: ${cats().map(esc).join(", ")}.</div>
          <button class="btn btn-primary" style="margin-top:8px">Save staff</button> <span class="help" id="st-msg"></span>
        </form>
        <div class="bar"><input class="input grow" id="st-q" type="search" placeholder="Search…" value="${esc(pplQ)}"><span class="count">${st.length} staff</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>HR</th><th>Name</th><th>Site</th><th>Trade</th><th>Status</th><th></th></tr></thead><tbody>
        ${st.filter(x => !pplQ || [x.hr, x.name, x.site, x.trade].join(" ").toLowerCase().includes(pplQ.toLowerCase())).map(x => `<tr class="${x.active ? "" : "is-hidden"}"><td>${esc(x.hr)}</td><td>${esc(x.name)}</td><td>${esc(x.site)}</td><td>${esc(x.trade)}${x.trade && !cats().includes(x.trade) ? ` <span class="badge-s b-prob" title="Not one of your categories">?</span>` : ""}</td>
          <td>${x.active ? `<span class="badge-s b-ok">Active</span>` : `<span class="badge-s b-hidden">Inactive</span>`}</td>
          <td class="row-actions"><button class="btn btn-sm" data-st-toggle="${esc(x.hr)}">${x.active ? "Deactivate" : "Activate"}</button><button class="btn btn-sm btn-danger" data-st-del="${esc(x.hr)}">Remove</button></td></tr>`).join("")}
        </tbody></table></div>
        <p class="help">Deactivate people who have left: they can no longer sign in, and their phone is signed out the next time it goes online. Their records are kept.</p>`;
    } else if (pplSub === "sups") {
      if (sups === null) { sGet({ what: "supervisors" }).then(j => { sups = j.supervisors || []; if (view === "sups") renderPeople(); }).catch(e => { sups = []; pplErr = e.message; if (view === "sups") renderPeople(); }); }
      body = `<div class="card-plain"><h2>Supervisors</h2>
          <p class="help">Supervisors sign off certificates on the technician's phone by typing their PIN. Turn on sign-off in <b>Settings → Staff & training</b>. Only a scrambled (hashed) copy of each PIN is kept.</p>
          <div class="rows">${(sups || []).map(x => `<div class="ch-row"><div><b>${esc(x.name)}</b> <span class="small">PIN ${esc(x.pin)}</span></div><div class="row-actions"><button class="btn btn-sm btn-danger" data-sup-del="${esc(x.name)}">Remove</button></div></div>`).join("") || `<p class="help">${sups === null ? "Loading…" : "No supervisors yet."}</p>`}</div>
          <form id="sup-add" class="two" style="margin-top:12px;align-items:end">
            <div class="field"><label for="sup-name">Name</label><input class="input" id="sup-name" required></div>
            <div class="field"><label for="sup-pin">PIN (4–12 digits)</label><input class="input" id="sup-pin" inputmode="numeric" required pattern="\\d{4,12}"></div>
            <button class="btn btn-primary">Add / change PIN</button>
          </form></div>
        <form class="card-plain" id="cert-look"><h2>Check a certificate</h2><div class="bar"><input class="input grow" id="cl-code" placeholder="Certificate code, e.g. ABCD-2345" autocapitalize="characters"><button class="btn">Check</button></div><div id="cl-out"></div></form>`;
    }
    $("#app").innerHTML = head + body;
    wirePeopleSub();
    if (pplSub === "assign") wireAssign();
    const q = $("#pp-q"); if (q) q.oninput = e => { pplQ = e.target.value; const pos = e.target.selectionStart; renderPeople(); const i = $("#pp-q"); i.focus(); i.setSelectionRange(pos, pos); };
    const sq = $("#st-q"); if (sq) sq.oninput = e => { pplQ = e.target.value; const pos = e.target.selectionStart; renderPeople(); const i = $("#st-q"); i.focus(); i.setSelectionRange(pos, pos); };
    $$("[data-pp]").forEach(r => r.onclick = () => { pplSel = r.dataset.pp; renderPeople(); scrollTo(0, 0); });
    const bk = $("#pp-back"); if (bk) bk.onclick = () => { pplSel = null; renderPeople(); };
    const rf = $("#pp-refresh"); if (rf) rf.onclick = async () => { ppl = null; renderPeople(); };
    const c1 = $("#pp-csv"); if (c1) c1.onclick = () => download(`training-summary-${today()}.csv`, [["HR number", "Name", "Trade", "Site", "Status", "Videos watched", "Quizzes passed", "Paths finished", "Certificates", "Last active"],
      ...people.map(p => [p.hr, p.name, p.trade, p.site, p.unknown ? "not on list" : p.active ? "active" : "inactive", p.videos.size, Object.values(p.quiz).filter(Boolean).length, [...p.paths].map(id => (byPath.get(id) || {}).title || id).join("; "), p.certs.length, p.last ? p.last.slice(0, 10) : ""])]);
    const c2 = $("#pp-csv2"); if (c2) c2.onclick = () => download(`training-records-${today()}.csv`, [["Time", "HR number", "Name", "Site", "Trade", "Type", "Item", "Title", "Score", "Out of", "Passed", "Certificate", "Signed in"], ...(ppl.records || [])]);
    $$("[data-as-csv]").forEach(b => b.onclick = () => {
      const a = (data.paths.json.assignments || []).find(x => x.id === b.dataset.asCsv), p = byPath.get(a.path);
      const target = people.filter(x => !x.unknown && x.active !== false && (!(a.trades || []).length || (a.trades || []).includes(x.trade)));
      download(`not-finished-${a.path}-${today()}.csv`, [["HR number", "Name", "Trade", "Site", "Progress"], ...target.filter(x => !x.paths.has(a.path)).map(x => [x.hr, x.name, x.trade, x.site, pathProgress(x, p)])]);
    });
    const sa = $("#st-add");
    if (sa) sa.onsubmit = async e => {
      e.preventDefault();
      const lines = $("#st-rows").value.split(/\n/).map(l => l.trim()).filter(Boolean);
      const rows = lines.map(l => l.split(/\t|,|;/).map(x => x.trim())).filter(r => r[0] && !/^hr/i.test(r[0])).map(([hr, name, site, trade]) => {
        const tr = cats().find(c => c.toLowerCase() === String(trade || "").toLowerCase()) || trade || "";
        return { hr, name: name || "", site: site || "", trade: tr, active: true };
      });
      if (!rows.length) return alert("Add at least one line: HR number, Full name");
      if (rows.some(r => !r.name)) return alert("Every line needs a name after the HR number.");
      busy(true);
      try { const j = await sPost({ action: "staff-save", staff: rows }); toast(`${j.added} added, ${j.updated} updated.`); ppl = null; }
      catch (err) { alert(err.message); }
      finally { busy(false); }
      renderPeople();
    };
    $$("[data-st-toggle]").forEach(b => b.onclick = async () => {
      const x = (ppl.staff || []).find(y => y.hr === b.dataset.stToggle);
      const was = x.active; x.active = !was; renderPeople();   // instant; undone if the save fails
      busy(true);
      try { await sPost({ action: "staff-save", staff: [{ ...x, active: !was }] }); } catch (err) { x.active = was; alert(err.message); renderPeople(); }
      finally { busy(false); }
    });
    $$("[data-st-del]").forEach(b => b.onclick = async () => {
      if (!confirm(`Remove ${b.dataset.stDel} from the staff list? Their training records are kept. (Tip: Deactivate keeps them on the list.)`)) return;
      const before = ppl.staff; ppl.staff = before.filter(y => y.hr !== b.dataset.stDel); renderPeople();   // instant; restored if it fails
      busy(true);
      try { await sPost({ action: "staff-remove", hr: b.dataset.stDel }); } catch (err) { ppl.staff = before; alert(err.message); renderPeople(); }
      finally { busy(false); }
    });
    const su = $("#sup-add");
    if (su) su.onsubmit = async e => {
      e.preventDefault(); busy(true);
      try { await sPost({ action: "sup-save", name: $("#sup-name").value.trim(), pin: $("#sup-pin").value.trim() }); toast("Supervisor saved."); sups = null; }
      catch (err) { alert(err.message); }
      finally { busy(false); }
      renderPeople();
    };
    $$("[data-sup-del]").forEach(b => b.onclick = async () => {
      if (!confirm(`Remove supervisor ${b.dataset.supDel}?`)) return;
      busy(true);
      try { await sPost({ action: "sup-remove", name: b.dataset.supDel }); sups = null; } catch (err) { alert(err.message); }
      finally { busy(false); }
      renderPeople();
    });
    const cl = $("#cert-look");
    if (cl) cl.onsubmit = async e => {
      e.preventDefault();
      const code = $("#cl-code").value.trim().toUpperCase(), out = $("#cl-out");
      const c = (ppl.certs || []).find(x => String(x.code).toUpperCase() === code);
      out.innerHTML = c ? `<p class="st-ok">${ABIcon("checkCircle")} <b>${esc(c.name)}</b> (HR ${esc(c.hr || "—")}) finished <b>${esc(c.title)}</b> on ${esc(String(c.time).slice(0, 10))}${c.score !== "" ? ` with ${esc(c.score)}% in the quizzes` : ""}${c.signedBy ? `. Signed off by ${esc(c.signedBy)}.` : ". Not signed off yet."}</p>` : `<p class="st-warn">${ABIcon("xCircle")} No certificate with that code.</p>`;
    };
  }
  function pathProgress(person, p) {
    const ids = (p && p.videos) || [];
    return `${ids.filter(id => person.videos.has(id)).length}/${ids.length} videos`;
  }
  function wirePeopleSub() {
    $$("[data-psub]").forEach(b => b.onclick = () => { pplSub = b.dataset.psub; pplSel = null; pplQ = ""; renderPeople(); });
  }

  /* ---------- Insights (usage counts) ---------- */
  let ins = null, insErr = "", insDays = 30;
  function renderInsights() {
    if (!ins && !insErr) { $("#app").innerHTML = `<p class="count" style="padding:24px 0">Loading…</p>`; sGet({ what: "stats", days: insDays }).then(j => { ins = j.counts || []; }).catch(e => { insErr = e.message; }).then(() => view === "insights" && renderInsights()); return; }
    const vById = new Map(V().map(v => [v.id, v]));
    const views = (ins || []).filter(c => c.kind === "view").sort((a, b) => b.n - a.n);
    const nores = (ins || []).filter(c => c.kind === "nores").sort((a, b) => b.n - a.n);
    const totalViews = views.reduce((a, c) => a + c.n, 0);
    const max = views.length ? views[0].n : 1;
    const watched = new Set(views.map(c => c.key));
    const unwatched = V().filter(v => !v.hidden && !watched.has(String(v.id).toLowerCase()));
    $("#app").innerHTML = `
      ${insErr ? `<div class="err">${ABIcon("alert")} ${esc(insErr)}</div>` : ""}
      ${!data.settings.json.statsEnabled ? `<div class="hint-box">${ABIcon("chart")} Counting is <b>off</b>. Turn on <b>Count video views and searches</b> in Settings → Staff & training. Only counts are kept — no names or phone details.</div>` : ""}
      <div class="bar"><select id="in-days">${[7, 30, 90, 365].map(d => `<option value="${d}" ${d === insDays ? "selected" : ""}>Last ${d} days</option>`).join("")}</select>
        <p class="count grow" style="margin:0"><b>${totalViews}</b> video plays · <b>${nores.reduce((a, c) => a + c.n, 0)}</b> searches with no results</p>
        <button class="btn btn-sm" id="in-refresh">${ABIcon("refresh")} Refresh</button></div>
      <div class="two" style="align-items:start">
        <div class="card-plain"><h2>${ABIcon("play")} Most watched</h2>
          ${views.slice(0, 25).map(c => { const v = vById.get(c.key) || V().find(x => String(x.id).toLowerCase() === c.key); return `<div class="in-row"><span class="in-t">${esc(v ? v.title : c.key)}</span><span class="in-bar"><i style="width:${Math.round(c.n / max * 100)}%"></i></span><b>${c.n}</b></div>`; }).join("") || `<p class="help">No plays counted yet.</p>`}
        </div>
        <div class="card-plain"><h2>${ABIcon("search")} Searched, nothing found</h2>
          <p class="help">What staff looked for and didn't find — ideas for new videos.</p>
          ${nores.slice(0, 40).map(c => `<div class="in-row"><span class="in-t">“${esc(c.key)}”</span><b>${c.n}</b><a class="btn btn-sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(c.key)}" target="_blank" rel="noopener">Find on YouTube</a></div>`).join("") || `<p class="help">Nothing yet.</p>`}
        </div>
      </div>
      ${views.length ? `<details class="box"><summary>${unwatched.length} videos nobody played in this period</summary><p style="margin:8px 0 0">${unwatched.map(v => esc(v.title)).join("<br>")}</p></details>` : ""}`;
    $("#in-days").onchange = e => { insDays = +e.target.value; ins = null; insErr = ""; renderInsights(); };
    $("#in-refresh").onclick = () => { ins = null; insErr = ""; renderInsights(); };
  }

  /* ---------- Toolbox talks ---------- */
  let te = null;
  const TK = () => data.toolbox.json.talks || (data.toolbox.json.talks = []);
  const dayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function todayTalkId() {
    const list = TK().filter(k => !k.hidden), today = dayStr();
    const pinned = list.find(k => k.date === today); if (pinned) return pinned.id;
    const pool = list.filter(k => !k.date); if (!pool.length) return null;
    return pool[Math.floor(Date.parse(today + "T00:00:00Z") / 864e5) % pool.length].id;
  }
  function renderToolbox() {
    if (te) return renderTalkEditor();
    const tid = todayTalkId();
    $("#app").innerHTML = `
      <div class="bar"><p class="help grow" style="margin:0">A different talk shows on the app's home screen each day, in rotation. Supervisors can read it out (or press ${ABIcon("volume")}) at the morning briefing. To choose the talk for a specific day, set its date.</p>
        <button class="btn btn-primary" id="tk-add">＋ New talk</button></div>
      <div class="rows">${TK().map((k, i) => `
        <div class="row ${k.hidden ? "is-hidden" : ""}">
          <div class="thumb path-ico">${ABIcon.item(k.icon, k.title, "hardhat")}</div>
          <div><h3>${esc(k.title)}</h3>
            <div class="meta"><span>${(k.points || []).length} points</span>
              ${k.id === tid ? `<span class="badge-s b-feat">Today</span>` : ""}
              ${k.date ? `<span class="badge-s b-ess">${ABIcon("calendar")} ${esc(k.date)}</span>` : ""}
              ${k.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
              ${k.tr && Object.keys(k.tr).length ? `<span class="badge-s b-ok">${ABIcon("globe")} ${Object.keys(k.tr).length}/8</span>` : `<span class="badge-s b-hidden">Translating…</span>`}</div></div>
          <div class="row-actions">
            <button class="btn btn-sm" data-tk-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">${ABIcon("arrowUp")}</button>
            <button class="btn btn-sm" data-tk-edit="${i}">Edit</button>
            <button class="btn btn-sm btn-danger" data-tk-del="${i}">Delete</button>
          </div></div>`).join("") || `<div class="empty"><h3>No toolbox talks yet</h3></div>`}</div>`;
    $("#tk-add").onclick = () => { te = { index: -1, k: { id: "", icon: "hardhat", title: "", points: [], ask: "" } }; renderToolbox(); };
    $$("[data-tk-edit]").forEach(b => b.onclick = () => { const i = +b.dataset.tkEdit; te = { index: i, k: JSON.parse(JSON.stringify(TK()[i])) }; renderToolbox(); });
    $$("[data-tk-del]").forEach(b => b.onclick = async () => {
      const k = TK()[+b.dataset.tkDel]; if (!confirm(`Delete the talk “${k.title}”?`)) return;
      updateFast("toolbox", d => { d.talks = (d.talks || []).filter(x => x.id !== k.id); return d; }, `Delete toolbox talk: ${k.title}`);
      toast("Deleted."); render();
    });
    $$("[data-tk-up]").forEach(b => b.onclick = async () => {
      const id = TK()[+b.dataset.tkUp].id;
      updateFast("toolbox", d => { const i = d.talks.findIndex(x => x.id === id); if (i > 0) d.talks.splice(i - 1, 0, d.talks.splice(i, 1)[0]); return d; }, "Reorder toolbox talks");
      render();
    });
  }
  function renderTalkEditor() {
    const k = te.k;
    $("#app").innerHTML = `
      <button class="btn btn-sm btn-ghost" id="te-back">‹ All talks</button>
      <h2 style="margin:10px 0 14px">${te.index < 0 ? "New toolbox talk" : "Edit toolbox talk"}</h2>
      <div class="field"><label for="te-title">Title</label><input class="input" id="te-title" placeholder="e.g. Heat stress" value="${esc(k.title)}"></div>
      <div class="field"><label>Icon</label>${iconPick("te-icon", ABIcon.nameFor(k.icon, k.title, "hardhat"))}</div>
      ${textAI() ? `<div class="draft-row"><button type="button" class="btn btn-sm" id="te-ai">${ABIcon("sparkles")} Write with AI</button><span class="help" id="te-ai-help">Type a title, then let ${textName()} write the points and question.</span></div>` : ""}
      <div class="field"><label for="te-points">Key points</label><textarea class="textarea" id="te-points" rows="6" placeholder="One point per line">${esc((k.points || []).join("\n"))}</textarea><div class="help">One point per line. 3–5 short points work best.</div></div>
      <div class="field"><label for="te-ask">Question to ask the team</label><input class="input" id="te-ask" placeholder="e.g. Where is the nearest drinking water on today's site?" value="${esc(k.ask || "")}"></div>
      <div class="two">
        <div class="field"><label for="te-video">Linked video (optional)</label>
          <select class="input" id="te-video"><option value="">None</option>${cats().map(c => `<optgroup label="${esc(c)}">${V().filter(v => v.category === c).map(v => `<option value="${esc(v.id)}" ${v.id === k.video ? "selected" : ""}>${esc(v.title)}</option>`).join("")}</optgroup>`).join("")}</select></div>
        <div class="field"><label for="te-date">Show on a specific date (optional)</label><input class="input" id="te-date" type="date" value="${esc(k.date || "")}"><div class="help">Leave empty to include it in the daily rotation.</div></div>
      </div>
      <label class="check"><input type="checkbox" id="te-hidden" ${k.hidden ? "checked" : ""}> Hide from staff</label>
      <div class="bar" style="margin-top:20px;justify-content:flex-end">
        <button class="btn" id="te-cancel">Cancel</button>
        <button class="btn btn-primary" id="te-save">${te.index < 0 ? "Publish talk" : "Save talk"}</button>
      </div>`;
    $("#te-back").onclick = $("#te-cancel").onclick = () => { te = null; renderToolbox(); };
    const ta = $("#te-ai");
    if (ta) ta.onclick = async () => {
      const title = $("#te-title").value.trim(); if (!title) return alert("Type a title first.");
      if ($("#te-points").value.trim() && !confirm("Replace the current points and question?")) return;
      ta.disabled = true; $("#te-ai-help").textContent = textName() + " is writing…";
      try {
        const d = await ABDraft.aiTalk({ title, key: geminiKey(), model: geminiModel() || undefined });
        $("#te-points").value = d.points.join("\n"); if (d.ask) $("#te-ask").value = d.ask; if (d.icon && te.index < 0) setIconPick("te-icon", ABIcon.nameFor(d.icon, $("#te-title").value, "hardhat"));
        $("#te-ai-help").textContent = "Done — read it through and adjust before publishing.";
      } catch (e) { $("#te-ai-help").textContent = textName() + " couldn't write it: " + e.message; }
      ta.disabled = false;
    };
    $("#te-save").onclick = async () => {
      k.icon = $("#te-icon").value.trim() || "hardhat";
      k.title = $("#te-title").value.trim();
      k.points = $("#te-points").value.split("\n").map(x => x.trim().replace(/^[-•*\d.)\s]+/, "")).filter(Boolean);
      k.ask = $("#te-ask").value.trim();
      const vid = $("#te-video").value, date = $("#te-date").value;
      if (vid) k.video = vid; else delete k.video;
      if (date) k.date = date; else delete k.date;
      if ($("#te-hidden").checked) k.hidden = true; else delete k.hidden;
      if (!k.title) return alert("Add a title.");
      if (!k.points.length) return alert("Add at least one point.");
      if (!k.id) {
        const base = k.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "talk";
        let id = base, n = 2; while (TK().some(x => x.id === id)) id = base + "-" + n++;
        k.id = id;
      }
      const isNew = te.index < 0;
      updateFast("toolbox", d => {
        d.talks = d.talks || [];
        const i = d.talks.findIndex(x => x.id === k.id);
        if (i >= 0) d.talks[i] = k; else d.talks.push(k);
        return d;
      }, `${isNew ? "Add" : "Edit"} toolbox talk: ${k.title}`);
      te = null; toast(isNew ? "Published." : "Saved."); render();
    };
  }

  /* ---------- Channels ---------- */
  let chEdit = null;
  function renderChannels() {
    const c = data.channels.json, st = data.pending.json.channelStatus || {};
    $("#app").innerHTML = `
      <div class="card-plain">
        <h2>Trusted channels</h2>
        <p>The finder only looks at these YouTube channels, and only when you press Search for new videos. Add channels whose videos you'd be happy for staff to watch.</p>
        <button class="btn" data-find ${finder.running ? "disabled" : ""}>${finder.running ? "" + ABIcon("hourglass") + " Searching…" : "" + ABIcon("search") + " Search for new videos now"}</button>
        <div class="find-msg" ${finder.msg ? "" : "hidden"}>${finder.msg}</div>
      </div>
      ${thinHtml()}
      ${(() => { const act = (c.channels || []).filter(x => x.active !== false), bad = act.filter(x => (st[x.url] || {}).error); return act.length > 2 && bad.length >= act.length * 0.8 ? `<div class="err">${ABIcon("alert")} Almost every channel failed at the last check — that usually means YouTube itself had a problem, not your channels. It happens a few times a year and clears within a day or two. The search now also tries each channel's page as a backup; press “Search for new videos now” to try again.</div>` : ""; })()}
      <div class="rows" style="margin-bottom:16px">${(c.channels || []).map((ch, i) => {
        const s = st[ch.url] || {};
        if (chEdit === ch.url) return `<form class="ch-row ch-edit" id="ch-edit-form">
          <div class="ch-edit-fields">
            <div class="field"><label for="ce-name">Name</label><input class="input" id="ce-name" required value="${esc(ch.name || "")}"></div>
            <div class="field"><label for="ce-url">Channel link</label><input class="input" id="ce-url" required autocapitalize="off" spellcheck="false" value="${esc(ch.url)}"></div>
            <div class="field"><label for="ce-cat">Send videos to</label><select class="input" id="ce-cat"><option value="">Pick from title</option>${cats().map(x => `<option ${x === ch.category ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
            <label class="check"><input type="checkbox" id="ce-active" ${ch.active === false ? "" : "checked"}> Active (checked when you search)</label>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" id="ce-cancel">Cancel</button>
            <button class="btn btn-sm btn-primary">Save</button>
          </div>
        </form>`;
        return `<div class="ch-row">
          <div>
            <b>${esc(ch.name || ch.url)}</b> ${ch.active === false ? `<span class="badge-s b-hidden">Paused</span>` : ""}
            ${s.error ? `<span class="badge-s b-prob">Problem</span>` : s.id ? `<span class="badge-s b-ok">OK</span>` : `<span class="badge-s b-hidden">Not checked yet</span>`}
            <div class="small">${esc(ch.url)}${ch.category ? " · goes to " + esc(ch.category) : " · category picked from title"}</div>
            ${s.error ? `<div class="small" style="color:var(--danger)">${esc(s.error)}</div>` : ""}
            ${!s.error && s.via === "page" ? `<div class="small">Last check used the channel page (YouTube's feed was down).</div>` : ""}
          </div>
          <div class="row-actions">
            <button class="btn btn-sm" data-ch-edit="${esc(ch.url)}">Edit</button>
            <button class="btn btn-sm" data-ch-toggle="${i}">${ch.active === false ? "Resume" : "Pause"}</button>
            <button class="btn btn-sm btn-danger" data-ch-del="${i}">Remove</button>
          </div>
        </div>`;
      }).join("")}</div>
      <form class="card-plain" id="ch-add">
        <h2>Add a channel</h2>
        <div class="field"><label for="ch-url">Channel link</label><input class="input" id="ch-url" required placeholder="https://www.youtube.com/@ChannelName" autocapitalize="off" spellcheck="false">
          <div class="help">Open the channel on YouTube, tap Share → Copy link, paste here.</div></div>
        <div class="two">
          <div class="field"><label for="ch-name">Name</label><input class="input" id="ch-name" required></div>
          <div class="field"><label for="ch-cat">Send videos to</label><select class="input" id="ch-cat"><option value="">Pick from title</option>${cats().map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        </div>
        <button class="btn btn-primary">Add channel</button>
      </form>
      <form class="card-plain" id="ch-opts">
        <h2>Finder options</h2>
        <div class="two">
          <div class="field"><label for="o-look">Look back (days)</label><input class="input" id="o-look" type="number" min="1" max="365" value="${esc(c.lookbackDays || 21)}"></div>
          <div class="field"><label for="o-max">Max videos in queue</label><input class="input" id="o-max" type="number" min="10" max="500" value="${esc(c.maxQueue || 150)}"></div>
        </div>
        <label class="check"><input type="checkbox" id="o-shorts" ${c.skipShorts !== false ? "checked" : ""}> Skip YouTube Shorts (under 1 minute)</label>
        <button class="btn">Save options</button>
      </form>`;
    wireThin();
    $("#ch-add").onsubmit = async e => {
      e.preventDefault();
      const url = $("#ch-url").value.trim().replace(/\/(videos|featured|shorts|streams)\/?$/, "");
      if (!/youtube\.com\/(@|channel\/|c\/|user\/)/.test(url)) return alert("Use a channel link like https://www.youtube.com/@ChannelName");
      const ch = { name: $("#ch-name").value.trim(), url, category: $("#ch-cat").value, active: true };
      updateFast("channels", d => { d.channels = d.channels || []; if (!d.channels.some(x => x.url === url)) d.channels.push(ch); return d; }, `Add channel: ${ch.name}`);
      toast("Channel added. It will be checked on the next run."); render();
    };
    $("#ch-opts").onsubmit = async e => {
      e.preventDefault();
      const look = +$("#o-look").value || 21, max = +$("#o-max").value || 150, shorts = $("#o-shorts").checked;
      updateFast("channels", d => { d.lookbackDays = look; d.maxQueue = max; d.skipShorts = shorts; return d; }, "Update finder options");
      toast("Saved");
    };

    $$("[data-ch-edit]").forEach(b => b.onclick = () => { chEdit = b.dataset.chEdit; renderChannels(); const f = $("#ce-name"); if (f) f.focus(); });
    const ef = $("#ch-edit-form");
    if (ef) {
      $("#ce-cancel").onclick = () => { chEdit = null; renderChannels(); };
      ef.onsubmit = async e => {
        e.preventDefault();
        const oldUrl = chEdit;
        const url = $("#ce-url").value.trim().replace(/\/(videos|featured|shorts|streams)\/?$/, "").replace(/\?.*$/, "");
        if (!/youtube\.com\/(@|channel\/|c\/|user\/)/.test(url)) return alert("Use a channel link like https://www.youtube.com/@ChannelName");
        if (url !== oldUrl && (c.channels || []).some(x => x.url === url)) return alert("That channel is already in the list.");
        const name = $("#ce-name").value.trim(), category = $("#ce-cat").value, active = $("#ce-active").checked;
        if (!name) return alert("Add a name.");
        updateFast("channels", d => {
          const ch = (d.channels || []).find(x => x.url === oldUrl);
          if (ch) Object.assign(ch, { name, url, category, active });
          return d;
        }, `Edit channel: ${name}`);
        chEdit = null;
        toast(url !== oldUrl ? "Saved. The new link will be checked on the next run." : "Channel saved.");
        render();
      };
    }
  }
  /* Categories with few videos: suggest more trusted channels with Gemini. */
  const sugg = {};
  function thinCats() {
    const counts = {}; V().filter(v => !v.hidden).forEach(v => counts[v.category] = (counts[v.category] || 0) + 1);
    return (data.settings.json.categories || []).map(c => ({ name: c.name, n: counts[c.name] || 0, chans: (data.channels.json.channels || []).filter(x => x.category === c.name && x.active !== false).length })).filter(c => c.n < 8).sort((a, b) => a.n - b.n);
  }
  function thinHtml() {
    const thin = thinCats(); if (!thin.length) return "";
    const known = new Set((data.channels.json.channels || []).map(x => x.url.toLowerCase()));
    return `<div class="card-plain thin">
      <h2>${ABIcon("trendDown")} Categories that need more videos</h2>
      <p class="help">These have fewer than 8 videos. Adding a trusted channel for them lets the daily finder fill them up.${textAI() ? " AI can suggest channels — open each one and check it before adding." : " Add a Gemini key in Settings to get channel suggestions."}</p>
      ${thin.map(c => `<div class="thin-row"><div><b>${esc(c.name)}</b> <span class="small">${c.n} video${c.n === 1 ? "" : "s"} · ${c.chans} channel${c.chans === 1 ? "" : "s"}</span></div>
        <div class="row-actions">${textAI() ? `<button class="btn btn-sm" data-sugg="${esc(c.name)}">${ABIcon("sparkles")} Suggest channels</button>` : ""}<a class="btn btn-sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(c.name + " training technician")}&sp=EgIQAg%253D%253D" target="_blank" rel="noopener">Search YouTube</a></div>
        ${sugg[c.name] ? `<div class="fv-list" style="grid-column:1/-1">${sugg[c.name].error ? `<p class="help" style="color:var(--danger)">${esc(sugg[c.name].error)}</p>` : sugg[c.name].loading ? `<p class="help">Searching…</p>` : (sugg[c.name].searched === false && sugg[c.name].length ? `<p class="help">The web-search limit is reached for today, so these come from the AI's own knowledge. Some may be out of date — open each one before adding.</p>` : "") + sugg[c.name].map(x => `<div class="fv"><div><b><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || x.url)}</a></b><div class="small">${esc(x.why)}</div><div class="small">${esc(x.url)}</div>
          ${known.has(x.url.toLowerCase()) ? `<span class="badge-s b-ok">Already added</span>` : `<button class="btn btn-sm btn-primary" data-sugg-add="${esc(c.name)}|${esc(x.url)}">＋ Add for ${esc(c.name)}</button>`}</div></div>`).join("") || `<p class="help">No channels found.</p>`}</div>` : ""}</div>`).join("")}
    </div>`;
  }
  function wireThin() {
    $$("[data-sugg]").forEach(b => b.onclick = async () => {
      const name = b.dataset.sugg, cat = (data.settings.json.categories || []).find(c => c.name === name) || {};
      sugg[name] = { loading: true }; renderChannels();
      try {
        const list = await ABDraft.aiFindChannels({ category: name, keywords: cat.keywords || [], existing: (data.channels.json.channels || []).map(x => x.name), key: geminiKey(), model: geminiModel() || undefined });
        sugg[name] = list;
      } catch (e) { sugg[name] = { error: "Couldn't suggest channels: " + e.message }; }
      if (view === "channels") renderChannels();
    });
    $$("[data-sugg-add]").forEach(b => b.onclick = async () => {
      const [cat, url] = b.dataset.suggAdd.split("|"), x = (sugg[cat] || []).find(y => y.url === url);
      updateFast("channels", d => { d.channels = d.channels || []; if (!d.channels.some(y => y.url === url)) d.channels.push({ name: (x && x.name) || url, url, category: cat, active: true }); return d; }, `Add channel: ${(x && x.name) || url}`);
      toast("Channel added. It will be checked on the next run."); renderChannels();
    });
  }
  /* Search for new videos now: starts the GitHub job, follows it, and reloads the queue when it's done. */
  const finder = { running: false, msg: "" };
  function finderMsg(html, running) {
    finder.msg = html; if (running !== undefined) finder.running = running;
    $$(".find-msg").forEach(m => { m.hidden = !html; m.innerHTML = html; });
    $$("[data-find]").forEach(b => { b.disabled = finder.running; b.innerHTML = finder.running ? ABIcon("hourglass") + " Searching…" : ABIcon("search") + " Search for new videos now"; });
  }
  /* Start a GitHub job and follow it. Used by Retry on the Status page. */
  async function runJob(file, show) {
    const wf = `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${file}`;
    const before = new Date(Date.now() - 5000).toISOString();
    if (!hasGh()) { show(noToken(), false); return false; }
    show("Starting…", true);
    let r; try { r = await gh(wf + "/dispatches", { method: "POST", body: { ref: cfg.branch } }); } catch { r = { status: 0 }; }
    if (r.status !== 204) { show(r.status === 403 || r.status === 404 ? "" + ABIcon("alert") + " Couldn't start it — your GitHub token needs <b>Actions: Read and write</b>." : `${ABIcon("alert")} Couldn't start it (${r.status || "no connection"}).`, false); return false; }
    const t0 = Date.now(); let runId = null;
    while (Date.now() - t0 < 40 * 60000) {
      await new Promise(res => setTimeout(res, runId ? 10000 : 4000));
      try {
        if (!runId) { const j = await (await gh(wf + "/runs?event=workflow_dispatch&per_page=5")).json(); const run = (j.workflow_runs || []).find(x => x.created_at >= before); if (run) runId = run.id; else continue; }
        const run = await (await gh(`/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}`)).json();
        const mins = Math.max(1, Math.round((Date.now() - t0) / 60000));
        if (run.status !== "completed") { show(`${ABIcon("hourglass")} Running… (${mins} min) <a href="${esc(run.html_url)}" target="_blank" rel="noopener">details</a>`); continue; }
        if (run.conclusion !== "success") { show(`${ABIcon("xCircle")} It stopped with a problem. <a href="${esc(run.html_url)}" target="_blank" rel="noopener">See why</a>`, false); return false; }
        await new Promise(res => setTimeout(res, 3000));
        const keys = ["videos", "pending", "settings", "paths", "toolbox"];
        const res = await Promise.all(keys.map(k => readFile(k)));
        keys.forEach((k, i) => data[k] = res[i]);
        show("" + ABIcon("checkCircle") + " Done.", false);
        return true;
      } catch { /* keep waiting */ }
    }
    show("Still running on GitHub — check again in a few minutes.", false); return false;
  }
  async function runFinder() {
    if (finder.running) return;
    const wf = `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/find-videos.yml`;
    const before = new Date(Date.now() - 5000).toISOString();
    const qBefore = (data.pending.json.queue || []).length;
    if (!hasGh()) { finderMsg(noToken(), false); return; }
    finderMsg("Starting the search…", true);
    let r;
    try { r = await gh(wf + "/dispatches", { method: "POST", body: { ref: cfg.branch } }); } catch (e) { r = { status: 0 }; }
    if (r.status !== 204) {
      finderMsg(r.status === 403 || r.status === 404
        ? "" + ABIcon("alert") + " Couldn't start it. Your GitHub token needs <b>Actions: Read and write</b> permission (GitHub → Settings → Developer settings → your token → Repository permissions), and Actions must be enabled on the repo."
        : `${ABIcon("alert")} Couldn't start it (${r.status || "no connection"}). Try again in a minute.`, false);
      return;
    }
    finderMsg(`Searching your ${(data.channels.json.channels || []).filter(c => c.active !== false).length} channels${videoAI() ? " — Gemini will then watch and review the new videos" : ""}… This usually takes 1–5 minutes. You can keep working.`);
    const t0 = Date.now();
    let runId = null;
    while (Date.now() - t0 < 45 * 60000) {
      await new Promise(res => setTimeout(res, runId ? 10000 : 4000));
      try {
        if (!runId) {
          const j = await (await gh(wf + "/runs?event=workflow_dispatch&per_page=5")).json();
          const run = (j.workflow_runs || []).find(x => x.created_at >= before);
          if (run) runId = run.id; else continue;
        }
        const run = await (await gh(`/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}`)).json();
        const mins = Math.max(1, Math.round((Date.now() - t0) / 60000));
        if (run.status !== "completed") { finderMsg(`${run.status === "queued" ? "Waiting for GitHub to start" : "Searching"}… (${mins} min) <a href="${esc(run.html_url)}" target="_blank" rel="noopener">details</a>`); continue; }
        if (run.conclusion !== "success") { finderMsg(`${ABIcon("alert")} The search stopped with a problem (${esc(run.conclusion)}). <a href="${esc(run.html_url)}" target="_blank" rel="noopener">See what happened</a>`, false); return; }
        await new Promise(res => setTimeout(res, 3000));          // give GitHub a moment to save the results
        const [pq, ch] = await Promise.all([readFile("pending"), readFile("channels")]);
        data.pending = pq; data.channels = ch;
        const n = (pq.json.queue || []).length - qBefore;
        finderMsg(n > 0 ? `${ABIcon("checkCircle")} Done — <b>${n} new video${n > 1 ? "s" : ""}</b> added to the Review queue.` : "" + ABIcon("checkCircle") + " Done — no new videos since the last check.", false);
        render();
        return;
      } catch (e) { /* network blip: keep waiting */ }
    }
    finderMsg("Still running on GitHub. Reload this page in a few minutes to see the results.", false);
  }


  /* ---------- Settings ---------- */
  let setSec = "site";
  function renderSettings() {
    const s = data.settings.json;
    const counts = {}; V().forEach(v => counts[v.category] = (counts[v.category] || 0) + 1);
    const IC = {
      site: '<path d="M3 11 12 4l9 7v9H3z"/><path d="M10 20v-6h4v6"/>',
      cats: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
      staff: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      inbox: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      gemini: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
      finder: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
      admins: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M18 8v6M15 11h6"/>',
      status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>'
    };
    const NAV = [["site", "General"], ["cats", "Categories"], ["staff", "Staff & training"], ["inbox", "Requests & Ask AI"], ["gemini", "AI"], ["finder", "Video finder"], ["admins", keys.owner ? "Admins & GitHub" : "Admins"], ["status", "System status"]].filter(([k]) => superAdmin ? (k !== "gemini" || keys.owner) : !SUPER_ONLY.includes(k));
    if (!superAdmin && SUPER_ONLY.includes(setSec)) setSec = "site";
    if (setSec === "gemini" && !keys.owner) setSec = "site";
    const when = d => d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    const secretField = (id, name, label, setAt, ph, help) => `<div class="field"><label for="${id}">${label}</label>
      <div class="bar" style="margin:0"><input class="input grow" id="${id}" type="password" autocomplete="new-password" placeholder="${keys[name] ? (setAt ? "Saved " + esc(when(setAt)) : "Saved in Supabase secrets") + " — paste a new one to replace it" : ph}">${keys[name] && setAt ? `<button type="button" class="btn btn-sm btn-danger" data-secret-del="${name}">Remove</button>` : ""}</div>
      <div class="help">${keys[name] ? "" + ABIcon("checkCircle") + " Saved on the server. Every admin can use it; nobody can see it, not even you." : ""} ${help}</div></div>`;
    const ico = k => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
    const head = (k, title, sub) => `<div class="sec-h"><span class="sec-ico">${ico(k)}</span><div><h2>${title}</h2><p>${sub}</p></div></div>`;
    const sw = (id, on, title, sub, extra = "") => `<label class="switch-row"><span><b>${title}</b><small>${sub}</small></span><input type="checkbox" class="switch" id="${id}" ${on ? "checked" : ""} ${extra}></label>`;
    $("#app").innerHTML = `
      <form id="set-form" class="set-layout">
        <nav class="set-nav" aria-label="Settings sections">${NAV.map(([k, l]) => `<button type="button" data-set-sec="${k}" aria-current="${setSec === k ? "page" : "false"}">${ico(k)}${l}</button>`).join("")}</nav>
        <div class="set-body">
        <div class="card-plain set-sec" data-sec="site" ${setSec === "site" ? "" : "hidden"}>
          ${head("site", "General", "Name, banner and contact details shown in the staff app.")}
          <div class="two">
            <div class="field"><label for="s-name">App name</label><input class="input" id="s-name" value="${esc(s.siteName || "")}"></div>
            <div class="field"><label for="s-tag">Tagline</label><input class="input" id="s-tag" value="${esc(s.tagline || "")}"></div>
          </div>
          <div class="field"><label for="s-ann">Announcement banner</label><input class="input" id="s-ann" placeholder="e.g. New fire safety videos added this week" value="${esc(s.announcement || "")}"><div class="help">Shown at the top of the staff app until you clear it. Translated automatically.</div></div>
          <div class="two">
            <div class="field"><label for="s-help">Helpdesk contact</label><input class="input" id="s-help" placeholder="e.g. 04 123 4567" value="${esc(s.helpdesk || "")}"><div class="help">Shown at the bottom of the app.</div></div>
            <div class="field"><label for="s-new">Mark videos as “New” for</label><div class="unit"><input class="input" id="s-new" type="number" min="1" max="60" value="${esc(s.newDays || 7)}"><span>days</span></div></div>
          </div>
        </div>
        <div class="card-plain set-sec" data-sec="cats" ${setSec === "cats" ? "" : "hidden"}>
          ${head("cats", "Categories", "The trades staff browse by. The icon follows the name. Keywords help the video finder sort new videos.")}
          <div id="cat-rows" class="cat-list">${(s.categories || []).map((c, i) => catRow(c, i, counts[c.name] || 0)).join("")}</div>
          <button type="button" class="btn btn-sm" id="cat-add" style="margin-top:10px">＋ Add category</button>
          <p class="help" style="margin-top:10px">Renaming a category here doesn't move its videos; edit the videos, or ask for a bulk move. Empty categories are hidden from staff.</p>
        </div>
        <div class="card-plain set-sec" data-sec="staff" ${setSec === "staff" ? "" : "hidden"}>
          ${head("staff", "Staff & training", "Sign-in, quizzes, refreshers and certificates.")}
          ${sw("s-login", s.staffLogin, "Staff sign in with their HR number", "Only HR numbers on your staff list can use the app. All progress is recorded per person and follows them to a new phone.")}
          ${sw("s-sign", s.signoffEnabled, "Supervisor sign-off on certificates", "Supervisors confirm a certificate on the technician's phone with their PIN. Manage PINs under Supervisors.")}
          ${sw("s-stats", s.statsEnabled, "Count video plays and failed searches", "Shown in Insights and on the dashboard. Counts only, no names.")}
          <div class="two" style="margin-top:14px">
            <div class="field"><label for="s-pass">Quick check pass mark</label><div class="unit"><input class="input" id="s-pass" type="number" min="1" max="100" value="${esc(s.quizPass || 67)}"><span>%</span></div><div class="help">67% = 2 of 3 right. 100% = all right.</div></div>
            <div class="field"><label for="s-qn">Questions per quick check</label><div class="unit"><input class="input" id="s-qn" type="number" min="2" max="8" value="${esc(s.quizSize || 3)}"><span>questions</span></div><div class="help">For ordinary videos.</div></div>
            <div class="field"><label for="s-qne">…for safety essentials</label><div class="unit"><input class="input" id="s-qne" type="number" min="2" max="8" value="${esc(s.quizSizeEss || 5)}"><span>questions</span></div><div class="help">Used when the AI writes a quiz. Existing quizzes keep their questions.</div></div>
            <div class="field"><label for="s-ref">Safety refresher every</label><div class="unit"><input class="input" id="s-ref" type="number" min="0" max="60" value="${esc(s.refresherMonths === undefined ? 12 : s.refresherMonths)}"><span>months</span></div><div class="help">Safety essentials must be watched again after this. 0 = never.</div></div>
          </div>
        </div>
        ${superAdmin ? `<div class="card-plain set-sec" data-sec="inbox" ${setSec === "inbox" ? "" : "hidden"}>
          ${head("inbox", "Requests & Ask AI", "What staff can ask for from the app.")}
          ${sw("s-reqon", s.requestsEnabled !== false, "“Request a video” button", "Staff tell you which videos are missing. Requests appear under Requests.")}
          ${sw("s-ai", s.aiEnabled, "Ask AI", "Staff ask work questions in their language and add photos; the AI answers and suggests videos. Questions and photos are not saved.")}
          <div class="note">Ask AI uses the AI chosen in ${keys.owner ? "<b>Settings → AI</b>" : "the owner's AI settings"}: ${textAI() ? aiLabel() + "." : "none is on yet."}</div>
        </div>` : ""}
        ${keys.owner ? `<div class="card-plain set-sec" data-sec="gemini" ${setSec === "gemini" ? "" : "hidden"}>
          ${head("gemini", "AI", "Only you see this section. Keys saved here work for every admin, Ask AI and the daily jobs, but are never shown to anyone.")}
          ${(() => { const ai = aiSet(); return `
          <div class="ai-grid">
            <div class="ai-card ${ai.gemini !== false ? "on" : ""}">
              <div class="ai-top"><b>Gemini</b><span class="badge-s ${keys.gemini ? "b-ok" : "b-wait"}">${keys.gemini ? "Key ready" : "No key"}</span><input type="checkbox" class="switch" id="s-ai-gem" aria-label="Use Gemini" ${ai.gemini !== false ? "checked" : ""}></div>
              <p class="help">Google. The only one that can <b>watch videos</b> (drafts, reviews, the video finder) and <b>search the web</b> (finding videos and channels).</p>
              ${secretField("s-gem", "gemini", "API key", keys.geminiSetAt, "AIza…", `Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.`)}
              <div class="field"><label for="s-gmodel">Model</label><select class="input" id="s-gmodel"><option value="">Automatic (newest available)</option>${ABDraft.MODELS.map(m => `<option ${m === geminiModel() ? "selected" : ""}>${m}</option>`).join("")}</select></div>
              <div class="bar" style="margin:0"><button type="button" class="btn btn-sm" data-ai-test="gemini">Test Gemini</button><span class="help" id="t-gemini"></span></div>
            </div>
            <div class="ai-card ${ai.groq !== false ? "on" : ""}">
              <div class="ai-top"><b>Groq</b><span class="badge-s ${keys.groq ? "b-ok" : "b-wait"}">${keys.groq ? "Key ready" : "No key"}</span><input type="checkbox" class="switch" id="s-ai-groq" aria-label="Use Groq" ${ai.groq !== false ? "checked" : ""}></div>
              <p class="help">Very fast, generous free limits. Does <b>text and photos</b>: quizzes, toolbox talks, translations, Ask AI. It can't watch videos or search the web.</p>
              ${secretField("s-groq", "groq", "API key", keys.groqSetAt, "gsk_…", `Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.`)}
              <div class="bar" style="margin:0"><button type="button" class="btn btn-sm" data-ai-test="groq">Test Groq</button><span class="help" id="t-groq"></span></div>
            </div>
            <div class="ai-card ${ai.openrouter !== false ? "on" : ""}">
              <div class="ai-top"><b>OpenRouter</b><span class="badge-s ${keys.openrouter ? "b-ok" : "b-wait"}">${keys.openrouter ? "Key ready" : "No key"}</span><input type="checkbox" class="switch" id="s-ai-or" aria-label="Use OpenRouter" ${ai.openrouter !== false ? "checked" : ""}></div>
              <p class="help">One key for many AI models (OpenAI, Claude, Llama, Mistral…). Does <b>text and photos</b>, like Groq. It can't watch videos or search the web.</p>
              ${secretField("s-or", "openrouter", "API key", keys.openrouterSetAt, "sk-or-…", `Get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>.`)}
              <div class="field"><label for="s-ormodel">Model</label><input class="input" id="s-ormodel" value="${esc(ai.orModel || "")}" placeholder="Automatic (openrouter/auto)"><div class="help">Optional. Leave empty and OpenRouter picks; if your account has no credit or allows only free models, the app uses a free model automatically. Or type a name from <a href="https://openrouter.ai/models" target="_blank" rel="noopener">openrouter.ai/models</a> (names ending in <code>:free</code> cost nothing).</div></div>
              <div class="bar" style="margin:0"><button type="button" class="btn btn-sm" data-ai-test="openrouter">Test OpenRouter</button><span class="help" id="t-openrouter"></span></div>
            </div>
          </div>
          <div class="ai-split">
            <h3>Who does what</h3>
            <div class="ai-split-row"><span><b>Watching videos &amp; searching the web</b><small>Video drafts, video reviews, the video finder, finding videos and channels</small></span><span class="badge-s b-gem">Gemini</span></div>
            <div class="ai-split-row"><span><b>Everything else</b><small>Quizzes, toolbox talks, translations, Ask AI, checks</small></span>
              <div class="seg-pick" role="radiogroup" aria-label="AI for everything else">
                <label><input type="radio" name="s-ai-first" value="groq" ${ai.first !== "gemini" && ai.first !== "openrouter" ? "checked" : ""}><span>Groq</span></label>
                <label><input type="radio" name="s-ai-first" value="openrouter" ${ai.first === "openrouter" ? "checked" : ""}><span>OpenRouter</span></label>
                <label><input type="radio" name="s-ai-first" value="gemini" ${ai.first === "gemini" ? "checked" : ""}><span>Gemini</span></label>
              </div></div>
            <div class="help">If that one is slow, busy or at its limit, the others take over automatically (those switched on).</div>
          </div>
          <div class="note">The daily jobs on GitHub read their own copies: repo <b>Settings → Secrets and variables → Actions</b>, secrets <code>GEMINI_API_KEY</code>, <code>GROQ_API_KEY</code> and <code>OPENROUTER_API_KEY</code>. The on/off switches above apply there too.</div>`; })()}
        </div>` : ""}
        <div class="card-plain set-sec" data-sec="finder" ${setSec === "finder" ? "" : "hidden"}>
          ${head("finder", "Video finder", "Searches your trusted channels when you press the button. It never runs by itself. Manage the channels under Channels.")}
          <div class="field"><label for="s-excl">Never queue videos whose title contains</label>
            <textarea class="textarea" id="s-excl" placeholder="unboxing, review, vlog">${esc((s.excludeKeywords || []).join(", "))}</textarea>
            <div class="help">Comma separated, not case-sensitive.</div></div>
        </div>
        ${superAdmin ? `<div class="card-plain set-sec" data-sec="admins" ${setSec === "admins" ? "" : "hidden"}>
          ${head("admins", "Admins & GitHub", "Who can use this admin, and the optional link to start the daily jobs from here.")}
          <div id="adm-list" class="rows"><p class="help">Loading…</p></div>
          <div class="bar" style="margin-top:10px"><input class="input grow" id="adm-email" type="email" placeholder="name@albonian.fm"><button type="button" class="btn" id="adm-add">＋ Add admin</button></div>
          <p class="help">New admins then use <b>Create an admin account</b> on the sign-in screen with that email.</p>
          ${keys.owner ? `<div style="margin-top:18px">${secretField("s-ghtoken", "github", "GitHub token (optional)", keys.githubSetAt, "github_pat_…", `Lets every admin start “Search for new videos”, “Translate now” and Retry immediately. Fine-grained token for <b>${esc(cfg.owner)}/${esc(cfg.repo)}</b> with <b>Actions: Read and write</b>.`)}</div>` : ""}
        </div>
        <div class="card-plain set-sec" data-sec="status" ${setSec === "status" ? "" : "hidden"}>
          ${head("status", "System status", "Translations, daily jobs and connections.")}
          <div id="status-box"><p class="help">Loading…</p></div>
        </div>` : ""}
        <div class="set-save" id="set-save"><span class="dirty" id="set-dirty">All changes saved</span><button class="btn btn-primary">Save settings</button></div>
        </div>
      </form>`;
    const markDirty = () => { const d = $("#set-dirty"); d.textContent = "Unsaved changes"; d.classList.add("on"); };
    $("#set-form").addEventListener("input", e => { if (!e.target.closest("#adm-email")) markDirty(); });
    $("#set-form").addEventListener("change", e => { if (!e.target.closest("#adm-email")) markDirty(); });
    if (setSec === "status") loadStatus();
    if (superAdmin) loadAdmins();
    $$("[data-set-sec]").forEach(b => b.onclick = () => {
      setSec = b.dataset.setSec;
      if (setSec === "status") loadStatus();
      $$("[data-set-sec]").forEach(x => x.setAttribute("aria-current", x === b ? "page" : "false"));
      $$(".set-sec").forEach(c => c.hidden = c.dataset.sec !== setSec);
      if (innerWidth < 760) b.scrollIntoView({ inline: "center", block: "nearest" });
    });
    $$("[data-secret-del]").forEach(b => b.onclick = async () => {
      const n = b.dataset.secretDel, label = { gemini: "Gemini key", groq: "Groq key", openrouter: "OpenRouter key", github: "GitHub token" }[n];
      if (!confirm(`Take away the shared ${label}? Admins won't be able to use it until you add it again.`)) return;
      const { error: de } = await sb.rpc("admin_set_secret", { p_name: n, p_value: "" });
      if (de) return alert(de.message);
      await loadKeys(); toast(label + " taken away."); render();
    });
    $$("[data-ai-test]").forEach(btn => btn.onclick = async () => {
      const which = btn.dataset.aiTest, m = $("#t-" + which);
      const pasted = $({ gemini: "#s-gem", groq: "#s-groq", openrouter: "#s-or" }[which]).value.trim();
      if (!pasted && !keys[which]) { m.textContent = "Paste a key first."; return; }
      m.textContent = "Testing…";
      const saved = window.ABAI, savedProxy = window.ABProxy;
      try {
        let model;
        if (which === "gemini") { window.ABAI = { gemini: true, groq: false, openrouter: false, first: "gemini" }; model = await ABDraft.aiTest({ key: pasted || "server", model: $("#s-gmodel").value || undefined }); }
        else {
          if (pasted) window.ABProxy = ABDraft.aiDirect({ [which]: pasted });
          window.ABAI = { gemini: false, groq: which === "groq", openrouter: which === "openrouter", first: which, orModel: $("#s-ormodel").value.trim() };
          model = await ABDraft.aiTest({ key: "", model: undefined });
        }
        m.innerHTML = `<span style="color:var(--ok,#1f9d55);font-weight:700">${ABIcon("check")} Works (${esc(model)}).</span>${pasted ? " Click Save settings." : ""}`;
      } catch (e) { m.innerHTML = `<span style="color:var(--danger)">${ABIcon("x")} ${esc(e.message)}</span>`; }
      finally { window.ABAI = saved; window.ABProxy = savedProxy; }
    });
    $("#cat-add").onclick = () => { $("#cat-rows").insertAdjacentHTML("beforeend", catRow({ name: "", icon: "", keywords: [] }, Date.now(), 0)); };
    $("#cat-rows").addEventListener("input", e => {
      const n = e.target.closest(".c-name"); if (!n) return;
      const ic = n.closest(".cat-row").querySelector(".cat-ico"); ic.setAttribute("style", ABTrades.tone(n.value)); ic.innerHTML = ABTrades.svg(n.value, 22);
    });
    $("#cat-rows").onclick = e => {
      const up = e.target.closest("[data-cat-up]");
      if (up) { const row = up.closest(".cat-row"), prev = row.previousElementSibling; if (prev) { row.parentNode.insertBefore(row, prev); $("#set-dirty").textContent = "Unsaved changes"; $("#set-dirty").classList.add("on"); } return; }
      const b = e.target.closest("[data-cat-del]"); if (!b) return;
      const row = b.closest(".cat-row");
      const n = +row.dataset.count;
      if (n && !confirm(`${n} videos use this category. Remove it anyway? (The videos stay; edit them to move them.)`)) return;
      row.remove();
    };
    $("#set-form").onsubmit = async e => {
      e.preventDefault();
      const categories = $$(".cat-row").map(r => ({
        name: $(".c-name", r).value.trim(), icon: $(".c-icon", r).value.trim(),
        keywords: $(".c-kw", r).value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean)
      })).filter(c => c.name);
      const vals = {
        siteName: $("#s-name").value.trim(), tagline: $("#s-tag").value.trim(), announcement: $("#s-ann").value.trim(),
        helpdesk: $("#s-help").value.trim(), newDays: Math.max(1, +$("#s-new").value || 7), categories,
        excludeKeywords: $("#s-excl").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean),
        staffLogin: $("#s-login").checked, signoffEnabled: $("#s-sign").checked, statsEnabled: $("#s-stats").checked,
        quizPass: Math.min(100, Math.max(1, +$("#s-pass").value || 67)), quizSize: Math.min(8, Math.max(2, +$("#s-qn").value || 3)), quizSizeEss: Math.min(8, Math.max(2, +$("#s-qne").value || 5)), refresherMonths: Math.max(0, Math.min(60, +$("#s-ref").value || 0))
      };
      if (superAdmin) { vals.requestsEnabled = $("#s-reqon").checked; vals.aiEnabled = $("#s-ai").checked; }
      if ($("#s-ai-gem")) vals.ai = { gemini: $("#s-ai-gem").checked, groq: $("#s-ai-groq").checked, openrouter: $("#s-ai-or").checked, first: (document.querySelector('[name="s-ai-first"]:checked') || {}).value || "groq", orModel: $("#s-ormodel").value.trim().replace(/[^\w.\-:\/]/g, "") };
      if (vals.staffLogin && !data.settings.json.staffLogin) {
        try {
          const j = await sGet({ what: "staff" });
          const n = (j.staff || []).filter(x => x.active).length;
          if (!n) { alert("Your staff list is empty, so nobody could sign in. Add staff in Staff & records → Staff list first."); return; }
          if (!confirm(`Turn on staff sign-in? About a minute after saving, staff must enter their HR number. ${n} active staff are on the list.`)) return;
        } catch (err) { alert("Couldn't read the staff list: " + err.message); return; }
      }
      if (keys.owner) {
        for (const [id, name] of [["#s-gem", "gemini"], ["#s-groq", "groq"], ["#s-or", "openrouter"], ["#s-ghtoken", "github"]]) {
          const val = $(id) ? $(id).value.trim() : "";
          if (!val) continue;
          const { error: se } = await sb.rpc("admin_set_secret", { p_name: name, p_value: val });
          if (se) { alert("Couldn't save the key: " + se.message); return; }
        }
        await loadKeys();
        try { const m = $("#s-gmodel"); if (m) localStorage.setItem("ab_gemini_model", m.value); } catch {}
      }
      updateFast("settings", d => { Object.assign(d, vals); delete d.requestUrl; delete d.recordsEnabled; return d; }, "Update site settings");
      reqs = null; loadRequests().then(badgeRequests);
      toast("Settings saved. Staff see it the next time they open the app."); render();
    };
  }
  async function loadAdmins() {
    const box = $("#adm-list"); if (!box) return;
    const { data: rows, error } = await sb.from("admins").select("email, added_at, role").order("email");
    if (error) { box.innerHTML = `<p class="help">${esc(error.message)}</p>`; return; }
    box.innerHTML = rows.map(r => `<div class="ch-row"><div><b>${esc(r.email)}</b>${r.role === "owner" ? ` <span class="badge-s b-ess">Owner</span>` : ""}${r.email.toLowerCase() === (me || "").toLowerCase() ? ` <span class="badge-s b-ok">You</span>` : ""}</div>
      <div class="row-actions">${r.email.toLowerCase() === (me || "").toLowerCase() || r.role === "owner" ? "" : `<button type="button" class="btn btn-sm btn-danger" data-adm-del="${esc(r.email)}">Remove</button>`}</div></div>`).join("");
    $$("[data-adm-del]").forEach(b => b.onclick = async () => {
      if (!confirm(`Remove ${b.dataset.admDel} as an admin?`)) return;
      const { error: e2 } = await sb.from("admins").delete().eq("email", b.dataset.admDel);
      if (e2) alert(e2.message); loadAdmins();
    });
    $("#adm-add").onclick = async () => {
      const email = $("#adm-email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("Type a valid email address.");
      const { error: e3 } = await sb.from("admins").insert({ email });
      if (e3) return alert(e3.message);
      $("#adm-email").value = ""; toast("Admin added. They can now create their account on the sign-in screen."); loadAdmins();
    };
  }
  async function loadStatus() {
    const box = $("#status-box"); if (!box) return;
    const vids = V(), q = data.pending.json.queue || [];
    const full = vids.filter(v => v.tr && Object.keys(v.tr).length >= 8).length;
    const gem = q.filter(i => i.draft && i.draft.source === "ai").length;
    const gemErr = q.find(i => i.aiError && !(i.draft && i.draft.source === "ai"));
    const ok = (good, text) => `<li class="${good ? "st-ok" : "st-warn"}">${ABIcon(good ? "checkCircle" : "alert")} ${text}</li>`;
    let html = `<ul class="st-list">
      ${ok(full === vids.length, `<span>Translations: <b>${full} of ${vids.length}</b> videos in all 8 languages${full === vids.length ? "" : " — new or edited videos are translated within a few minutes after saving"}</span>${full === vids.length ? "" : `<button type="button" class="btn btn-sm st-retry" data-retry="translate.yml">${ABIcon("refresh")} Retry</button>`}<span class="st-job" id="job-translate.yml"></span>`)}
      ${ok(true, `<span>Library: <b>${vids.filter(v => v.gemini).length} of ${vids.length}</b> videos checked by Gemini${vids.every(v => v.gemini) ? "" : ""}</span>`)}
      ${ok(!q.length || gem === q.length, `<span>AI drafts: <b>${gem} of ${q.length}</b> queued videos drafted${gemErr ? ` — last problem: <i>${esc(gemErr.aiError)}</i>` : ""}</span>${q.length && gem < q.length ? `<button type="button" class="btn btn-sm st-retry" data-retry="find-videos.yml">${ABIcon("refresh")} Retry</button>` : ""}<span class="st-job" id="job-find-videos.yml"></span>`)}
      ${(() => { const bad = Object.values(data.pending.json.channelStatus || {}).filter(c => c && c.error).length;
        return ok(!bad, `<span>Channels: ${bad ? `<b>${bad}</b> couldn't be checked last time — <a href="#" data-go="channels">see which</a>` : "all checked OK"}</span>${bad ? `<button type="button" class="btn btn-sm st-retry" data-retry="find-videos.yml" data-out="job-ch">${ABIcon("refresh")} Retry</button>` : ""}<span class="st-job" id="job-ch"></span>`); })()}
      ${ok(geminiOn(), `AI: ${textAI() ? aiLabel() : "off"}${geminiOn() ? "" : " — video drafts and reviews need Gemini"}${keys.owner ? ` · <a href="#" data-go="settings" data-sec="gemini">change</a>` : ""}`)}
      ${ok(true, `Database: connected (Supabase project “ABFM Training”) · you're signed in to this admin as <b>${esc(me || "")}</b>`)}
      ${ok(!V().some(v => !v.duration), `Video lengths: <b>${V().filter(v => v.duration).length} of ${V().length}</b> known${V().some(v => !v.duration) ? " — use “Fill in missing lengths” on the Videos tab" : ""}`)}
    </ul>
    <h3 style="margin:16px 0 8px">Recent automatic jobs on GitHub</h3>`;
    box.innerHTML = html + `<p class="help">Loading…</p>`;
    try {
      if (!hasGh()) throw new Error(keys.owner ? "Add a GitHub token in Settings → Admins & GitHub to see the job history here." : "The job history shows once the owner adds the GitHub token.");
      const r = await gh(`/repos/${cfg.owner}/${cfg.repo}/actions/runs?per_page=12`);
      if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? "Your GitHub token needs “Actions: Read” permission to show this." : "GitHub said " + r.status);
      const runs = (await r.json()).workflow_runs || [];
      const icon = x => x.status !== "completed" ? ABIcon("hourglass") : x.conclusion === "success" ? ABIcon("checkCircle", "ok") : x.conclusion === "cancelled" || x.conclusion === "skipped" ? ABIcon("skip", "muted") : ABIcon("xCircle", "bad");
      const when = d => { const m = Math.round((Date.now() - Date.parse(d)) / 60000); return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
      html += `<div class="st-runs">${runs.map(x => `<a class="st-run" href="${esc(x.html_url)}" target="_blank" rel="noopener">
        <span>${icon(x)}</span><span><b>${esc(x.name)}</b><br><small>${esc(x.display_title || "")}</small></span>
        <span class="st-when">${x.status !== "completed" ? esc(x.status.replace("_", " ")) : esc(x.conclusion)}<br><small>${when(x.created_at)}</small></span></a>`).join("") || `<p class="help">No jobs yet.</p>`}</div>
        <p class="help">${ABIcon("xCircle")} means a job failed — tap it to see why (or send me a screenshot). ${ABIcon("skip")} Cancelled jobs are normal when several saves happen close together.</p>
        <button type="button" class="btn btn-sm" id="st-translate">${ABIcon("globe")} Translate now</button> <span class="help" id="st-msg"></span>`;
    } catch (e) { html += `<p class="help">${esc(e.message)}</p>`; }
    box.innerHTML = html;
    $$("[data-retry]", box).forEach(b => b.onclick = async () => {
      const file = b.dataset.retry, out = $("#" + CSS.escape(b.dataset.out || "job-" + file));
      b.disabled = true;
      const done = await runJob(file, (msg) => { if (out) out.innerHTML = msg; });
      b.disabled = false;
      if (done) { render(); }
    });
    const tb = $("#st-translate");
    if (tb) tb.onclick = async () => {
      if (!hasGh()) { $("#st-msg").innerHTML = noToken(); return; }
      const r = await gh(`/repos/${cfg.owner}/${cfg.repo}/actions/workflows/translate.yml/dispatches`, { method: "POST", body: { ref: cfg.branch } });
      $("#st-msg").textContent = r.status === 204 ? "Started — refresh this page in a few minutes." : "Couldn't start it (" + r.status + "). The token needs “Actions: Read and write”.";
    };
  }
  function catRow(c, i, count) {
    return `<div class="cat-row" data-count="${count}">
      <span class="cat-ico" style="${ABTrades.tone(c.name)}">${ABTrades.svg(c.name, 22)}</span>
      <div class="cat-main"><div class="cat-top"><input class="input c-name" aria-label="Category name" placeholder="Category name" value="${esc(c.name)}"><span class="cat-n">${count} video${count === 1 ? "" : "s"}</span></div>
        <input type="hidden" class="c-icon" value="${esc(c.icon || "")}">
        <textarea class="textarea c-kw" aria-label="Keywords" placeholder="keywords, comma, separated">${esc((c.keywords || []).join(", "))}</textarea></div>
      <div class="cat-act"><button type="button" class="btn btn-sm btn-icon" data-cat-up aria-label="Move up">${ABIcon("arrowUp")}</button><button type="button" class="btn btn-sm btn-icon btn-danger" data-cat-del aria-label="Remove category">${ABIcon("x")}</button></div>
    </div>`;
  }

  /* ---------- global events ---------- */
  document.addEventListener("click", e => {
    const go = e.target.closest("[data-go]");
    if (go) {
      e.preventDefault();
      view = go.dataset.go;
      if (go.dataset.show) ui.show = go.dataset.show;
      if (go.dataset.sec && (superAdmin || !SUPER_ONLY.includes(go.dataset.sec))) setSec = go.dataset.sec;
      render(); scrollTo(0, 0); return;
    }
    if (e.target.closest("#b-more")) { if ($("#msheet").hidden) openMore(); else closeMore(); return; }
    if (e.target.id === "msheet") { closeMore(); return; }
    if (e.target.closest("#msheet-out")) { closeMore(); $("#disconnect").click(); return; }
    const tab = e.target.closest("#tabs [data-view], #bnav [data-view], #msheet [data-view]");
    if (tab) { closeMore(); view = tab.dataset.view; render(); scrollTo(0, 0); return; }
    if (e.target.closest("[data-find]")) { runFinder(); return; }
    if (e.target.closest("[data-close-drawer]") || e.target.id === "drawer") { closeDrawer(); return; }
    const t = e.target.closest("[data-edit],[data-hide],[data-del],[data-approve],[data-review],[data-reject],[data-preview],[data-ch-toggle],[data-ch-del]");
    if (!t) return;
    const d = t.dataset;
    if (d.edit) openEditor(V().find(v => v.id === d.edit));
    else if (d.hide) hideToggle(d.hide);
    else if (d.del) del(d.del);
    else if (d.approve) quickApprove(d.approve, t);
    else if (d.review) approve(d.review);
    else if (d.reject) removeFromQueue(d.reject, true).then(() => { toast("Rejected. It won't be suggested again."); render(); });
    else if (d.preview) t.outerHTML = `<div class="preview" style="margin:0;border-radius:0"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.preview)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
    else if (d.chToggle) { const i = +d.chToggle; updateFast("channels", x => { x.channels[i].active = x.channels[i].active === false; return x; }, "Pause/resume channel").then(render); }
    else if (d.chDel) { const i = +d.chDel; const ch = data.channels.json.channels[i]; if (confirm(`Remove ${ch.name}?`)) updateFast("channels", x => { x.channels = x.channels.filter(c => c.url !== ch.url); return x; }, `Remove channel: ${ch.name}`).then(render); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMore(); if (!$("#drawer").hidden) closeDrawer(); } });
  $("#disconnect").onclick = async () => { if (!confirm("Sign out of the admin on this device?")) return; await sb.auth.signOut(); me = null; renderConnect(); };

  // Coming back from "reset password" email → choose a new password.
  sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") renderConnect("", "newpw"); });
  // Installable as its own app ("Training Admin"): needs the service worker like the staff app.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  sb.auth.getSession().then(({ data: d }) => { if (/type=recovery/.test(location.hash)) return; if (d && d.session) afterSignIn(); else renderConnect(); });
})();
