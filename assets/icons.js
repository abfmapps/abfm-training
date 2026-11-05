/* Line icons shared by the staff app and the admin (no emojis anywhere in the UI).
   ABIcon("check")            → inline SVG that sizes with the text and takes its colour.
   ABIcon.item(icon, title)   → icon for a learning path or toolbox talk: an icon name, an old emoji
                                 (mapped to the matching icon) or, failing that, one picked from the title.
   ABIcon.ITEM_ICONS          → the icons offered in the admin's icon picker. */
(function (root) {
  "use strict";
  const P = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
    sparkles: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
    quiz: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    hardhat: '<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5M4 15v-3a6 6 0 0 1 6-6M14 6a6 6 0 0 1 6 6v3"/>',
    grad: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5M22 10v6"/>',
    thumbUp: '<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
    thumbDown: '<path d="M17 14V2M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    chart: '<path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/>',
    trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7M16 17h6v-6"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
    skip: '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
    wifiOff: '<path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-11.3-3.7M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.1-1.5M2 2l20 20"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    ladder: '<path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8"/>',
    height: '<path d="M12 17V3M7 8l5-5 5 5M4 21h16"/>',
    confined: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M12 10v6M9.5 13.5 12 16l2.5-2.5"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    snowflake: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19M9 3.5l3 3 3-3M9 20.5l3-3 3 3M3.5 9l3 3-3 3M20.5 9l-3 3 3 3"/>',
    thermometer: '<path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    goggles: '<path d="M2 10a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-3l-2-2.5h-4L8 16H5a3 3 0 0 1-3-3z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    broom: '<path d="m13 11 8-8M9.5 10.5l4 4M4 21c1.5 0 5-1 6.5-2.5l3-4-4-4-4 3C4 15 3 18.5 3 20z"/>',
    extinguisher: '<rect x="8" y="8" width="8" height="14" rx="3"/><path d="M12 8V4h4l2 2M12 4H8a3 3 0 0 0-3 3v3"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    firstAid: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M12 10v7M8.5 13.5h7"/>',
    van: '<path d="M3 17V6a1 1 0 0 1 1-1h10v12M14 9h4l3 4v4h-2M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>',
    battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2"/>',
    cylinder: '<path d="M9 2h6M12 2v3"/><rect x="7" y="5" width="10" height="17" rx="4"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/><circle cx="12" cy="12" r="7"/>',
    brush: '<path d="m9 11.9 8.1-8.1a2.9 2.9 0 1 1 4 4L13 15.9M7 15c-1.7 0-3 1.3-3 3 0 1.3-2.5 1.5-2 2 1.1 1.1 2.5 2 4 2 2.2 0 4-1.8 4-4a3 3 0 0 0-3-3z"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12"/>',
    fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7s3 4 0 6M14 12c4 0 7 1 7 4s-4 3-6 0M12 14c0 4-1 7-4 7s-3-4 0-6M10 12c-4 0-7-1-7-4s4-3 6 0"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>'
  };
  // Old emoji icons (saved on paths and talks) → the matching line icon.
  const EMOJI = {
    "🦺": "hardhat", "⛑": "firstAid", "❄": "snowflake", "🧊": "thermometer", "🔧": "wrench", "⚡": "zap", "⚙": "gear",
    "🔌": "plug", "🚰": "droplet", "🧯": "extinguisher", "💧": "droplet", "🎨": "brush", "🌴": "leaf", "🌀": "fan",
    "☀": "sun", "🔒": "lock", "🪜": "ladder", "🧗": "height", "🕳": "confined", "🔥": "flame", "🧪": "flask", "📦": "box",
    "🥽": "goggles", "🛠": "wrench", "🧹": "broom", "📞": "phone", "🚐": "van", "🌙": "moon", "🌪": "wind", "📝": "note",
    "🏢": "building", "🔋": "battery", "🛢": "cylinder", "🎧": "headphones", "👓": "eye", "📄": "note", "😴": "moon",
    "🏙": "building", "✋": "hand", "🎓": "grad", "📚": "grad", "🔥️": "flame", "⚠": "alert", "🛡": "shield", "🚿": "droplet"
  };
  // Picked from the title when there is no icon.
  const WORDS = [
    [/heat|sun|summer/i, "sun"], [/ladder/i, "ladder"], [/height|roof|scaffold/i, "height"], [/confined|tank|pit|manhole/i, "confined"],
    [/hot work|weld|braz|fire ?ext/i, "extinguisher"], [/fire|flame/i, "flame"], [/refrigerant|gas leak/i, "thermometer"], [/chemical|acid/i, "flask"],
    [/lift|carry|manual handling/i, "box"], [/ppe|goggle/i, "goggles"], [/tool/i, "wrench"], [/slip|trip|housekeep/i, "broom"],
    [/emergenc|call/i, "phone"], [/first aid|injur/i, "firstAid"], [/driv|vehicle|van/i, "van"], [/fast|ramadan|night|fatigue|sleep/i, "moon"],
    [/wind|dust|storm/i, "wind"], [/report|near miss|permit/i, "note"], [/building|occupied/i, "building"], [/water|legionella|plumb|drain/i, "droplet"],
    [/lockout|tagout|isolat/i, "lock"], [/electric|dead|live|cable|lead/i, "plug"], [/cylinder/i, "cylinder"], [/hearing|noise/i, "headphones"],
    [/eye/i, "eye"], [/stop/i, "hand"], [/hvac|ac\b|air ?con|split|fcu/i, "snowflake"], [/motor|vfd|contactor/i, "gear"],
    [/paint|tiling|repair/i, "brush"], [/irrigat|landscap|garden/i, "leaf"], [/duct|indoor air/i, "fan"], [/safety|induction/i, "hardhat"]
  ];
  function ABIcon(name, cls) {
    const p = P[name] || P.hardhat;
    return `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }
  ABIcon.has = n => Object.prototype.hasOwnProperty.call(P, n);
  ABIcon.nameFor = (icon, title, fallback) => {
    const s = String(icon || "").trim();
    if (ABIcon.has(s)) return s;
    const e = s.replace(/️/g, "");
    if (EMOJI[e]) return EMOJI[e];
    const w = WORDS.find(([re]) => re.test(title || ""));
    return w ? w[1] : (fallback || "hardhat");
  };
  ABIcon.item = (icon, title, fallback, cls) => ABIcon(ABIcon.nameFor(icon, title, fallback), cls);
  ABIcon.ITEM_ICONS = ["hardhat", "grad", "shield", "alert", "sun", "plug", "zap", "lock", "ladder", "height", "confined", "flame",
    "extinguisher", "thermometer", "snowflake", "fan", "flask", "box", "goggles", "eye", "headphones", "wrench", "gear", "broom",
    "droplet", "leaf", "brush", "phone", "firstAid", "van", "moon", "wind", "note", "building", "battery", "cylinder", "hand"];
  root.ABIcon = ABIcon;
})(typeof globalThis !== "undefined" ? globalThis : this);
