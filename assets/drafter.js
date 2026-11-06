/* ABFM Training — automatic first drafts for new videos.
   Used by the daily GitHub job (scripts/draft.mjs) and by the admin "Auto-draft" button.
   Two ways of drafting:
   1. Gemini (if a free Gemini API key is set): it watches the YouTube video and writes the summary, safety note and steps.
   2. Built-in rules: summary from the YouTube description, steps from the video's chapters,
      safety note and PPE from the trade and keywords in the title.
   Drafts are never published on their own — they only pre-fill the form you approve. */
(function (root) {
  "use strict";

  /* Safety note + PPE by keyword (first match wins, checked before the trade defaults). */
  const RULES = [
    { re: /\b(lock ?out|tag ?out|loto|isolat)/i, safety: "Isolate the energy source, lock and tag it, and prove it is dead before you touch anything.", ppe: ["Safety Glasses", "Insulated Gloves", "Safety Shoes"] },
    { re: /\b(harness|fall arrest|working at height|scaffold|roof)/i, safety: "Wear a full-body harness clipped to a rated anchor point, and inspect it before every use.", ppe: ["Full-Body Harness", "Hard Hat", "Safety Shoes"] },
    { re: /\b(ladder|step ?ladder)/i, safety: "Inspect the ladder first, keep three points of contact and never stand on the top rungs.", ppe: ["Hard Hat", "Safety Shoes", "Work Gloves"] },
    { re: /\b(confined space|manhole|sump|tank entry|inside the tank)/i, safety: "Never enter without a permit, gas test, standby person and rescue plan.", ppe: ["Gas Detector", "Full-Body Harness", "Respirator", "Hard Hat"] },
    { re: /\b(braz|solder|weld|torch|hot work|cutting disc|grind)/i, safety: "Hot work: get the permit, clear flammables, keep an extinguisher close and purge with nitrogen when brazing.", ppe: ["Welding Gloves", "Shaded Goggles", "Fire-Resistant Clothing"] },
    { re: /\b(refrigerant|recover|r-?410|r-?32|r-?22|charging|charge the)/i, safety: "Refrigerant can freeze skin and eyes in seconds. Wear gloves and goggles and never vent it to air.", ppe: ["Safety Goggles", "Cold-Resistant Gloves"] },
    { re: /\b(acid|chemical|coil clean|descal|chlorin|disinfect|bleach)/i, safety: "Read the chemical's safety data sheet, ventilate the area and never mix chemicals.", ppe: ["Chemical Gloves", "Safety Goggles", "Respirator"] },
    { re: /\b(paint|spray|epoxy|waterproof|primer|sealant)/i, safety: "Ventilate the area, keep ignition sources away and protect your eyes and lungs from fumes and spray.", ppe: ["Respirator", "Safety Goggles", "Chemical Gloves"] },
    { re: /\b(sprinkler|fire alarm|extinguisher|fire pump|fire panel|fm-?200|suppression)/i, safety: "Inform the building and the alarm monitoring company before testing, and never leave a system disabled.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] },
    { re: /\b(duct|grease|kitchen exhaust|hood)/i, safety: "Isolate the fans before opening ducts, and watch for sharp edges and grease fire risk.", ppe: ["Cut-Resistant Gloves", "Dust Mask", "Safety Goggles"] },
    { re: /\b(mower|trimmer|chainsaw|hedge|blower|strimmer)/i, safety: "Check guards before starting, keep people clear and stop the engine before clearing blockages.", ppe: ["Ear Defenders", "Safety Goggles", "Safety Shoes"] },
    { re: /\b(drill|saw|cutter|power tool|grinder|core drill)/i, safety: "Check the tool and lead before use, keep guards on and unplug before changing bits or blades.", ppe: ["Safety Glasses", "Ear Defenders", "Work Gloves"] },
    { re: /\b(heat stress|heat stroke|summer|dehydrat)/i, safety: "Drink water often, take breaks in the shade and report dizziness or headache at once.", ppe: ["Cooling Vest", "Hard Hat", "Sun Protection"] },
    { re: /\b(lift|manual handling|carry|hoist|rigging|sling)/i, safety: "Plan the lift, get help for heavy loads and keep the load close to your body.", ppe: ["Work Gloves", "Safety Shoes", "Hard Hat"] }
  ];
  const TRADE = {
    "Health & Safety": { safety: "Follow the site's permit and safety rules, and stop work if anything feels unsafe.", ppe: ["Hard Hat", "Safety Shoes", "Hi-Vis Vest"] },
    "HVAC": { safety: "Isolate power at the unit before opening panels, and watch for hot, cold and moving parts.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] },
    "Electrical": { safety: "Isolate and prove dead before any work. Only qualified staff may work near live parts.", ppe: ["Insulated Gloves", "Safety Glasses", "Safety Shoes"] },
    "Plumbing": { safety: "Shut off and drain the water supply first, and watch for hot water and wet floors.", ppe: ["Work Gloves", "Safety Glasses", "Safety Shoes"] },
    "Water Tank Cleaning": { safety: "Tank entry is confined-space work: permit, gas test, ventilation and a standby person are required.", ppe: ["Gas Detector", "Respirator", "Chemical Gloves", "Rubber Boots"] },
    "Duct Cleaning": { safety: "Isolate the fans before opening ducts, and watch for sharp edges and dust.", ppe: ["Dust Mask", "Cut-Resistant Gloves", "Safety Goggles"] },
    "Civil Jobs": { safety: "Keep the area barricaded, use tools with guards and lift heavy materials with help.", ppe: ["Hard Hat", "Safety Shoes", "Work Gloves", "Safety Glasses"] },
    "Painting & Waterproofing": { safety: "Ventilate the area, keep ignition sources away and protect your eyes and lungs.", ppe: ["Respirator", "Safety Goggles", "Chemical Gloves"] },
    "Landscaping": { safety: "Check guards before starting machines, keep people clear and drink water often in the heat.", ppe: ["Ear Defenders", "Safety Goggles", "Safety Shoes", "Work Gloves"] },
    "Fire Systems": { safety: "Inform the building and monitoring company before testing, and never leave a system disabled.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] }
  };
  const DEFAULT_TRADE = { safety: "Check the area is safe, use the right tools and stop work if anything feels unsafe.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] };

  const JUNK = /(subscribe|patreon|sponsor|affiliate|amazon|discount|promo|merch|instagram|facebook|tiktok|twitter|follow (me|us)|join (this|the) channel|membership|business inquir|email me|disclaimer|music by|#\w+|https?:\/\/|www\.|\bcode\b.*\boff\b|link(s)? below)/i;
  const SKIP_CHAPTER = /^(intro(duction)?|outro|end( ?screen)?|start|welcome|thanks?( for watching)?|conclusion|final thoughts|summary|subscribe|sponsor|ad|q ?& ?a|bloopers?|wrap ?up|recap)\b/i;

  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function chapters(desc) {
    const out = [];
    for (const raw of String(desc || "").split(/\n/)) {
      const m = raw.match(/^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|.]?\s*(.{3,})$/) ||
                raw.match(/^\s*(.{3,}?)\s*[-–—:|]\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*$/);
      if (!m) continue;
      let text = /\d:\d\d/.test(m[1]) ? m[2] : m[1];
      text = clean(text.replace(/^[-–—:|.\s]+/, "").replace(/[🕐-🕧⏱️▶️👉✅]/gu, ""));
      if (!text || SKIP_CHAPTER.test(text) || JUNK.test(text)) continue;
      out.push(cap(text.length > 90 ? text.slice(0, 87) + "…" : text));
    }
    return out.length >= 3 ? out.slice(0, 8) : [];
  }

  function summary(desc, title) {
    const lines = String(desc || "").split(/\n/).map(clean).filter(l => l && !JUNK.test(l) && !/\d:\d\d/.test(l) && !/^[=*_\-#]+/.test(l) && l.length > 25);
    const text = lines.join(" ");
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || (text ? [text] : [])).map(clean).filter(s => s.length > 20);
    let s = "";
    for (const x of sentences) { if ((s + " " + x).length > 260) break; s = clean(s + " " + x); if (s.length > 120) break; }
    if (!s && sentences[0]) s = sentences[0].slice(0, 257) + "…";
    s = s.replace(/^(in (this|today'?s) video,?\s+)?(we|i)('ll| will| are going to| am going to)?\s+(take a look at|look at|show( you)?( how to)?|go over|explain|cover|demonstrate|walk you through)\s+/i, (m, a, b, c, d, verb) => /how to/i.test(verb) ? "Shows how to " : "Shows ");
    s = s.replace(/^in (this|today'?s) video,?\s+/i, "");
    return s ? cap(s) : "";
  }

  function level(text) {
    if (/\b(basic|basics|beginner|introduction|intro to|explained|what is|how .* works|for new|101|getting started|how to use)\b/i.test(text)) return "Beginner";
    if (/\b(troubleshoot|diagnos|fault[- ]?find|advanced|commission|calibrat|in[- ]depth|deep dive|design|programming)\b/i.test(text)) return "Advanced";
    return "Intermediate";
  }

  function subject(title, category, videos) {
    const words = new Set(String(title).toLowerCase().match(/[a-z]{4,}/g) || []);
    let best = null, score = 0;
    for (const v of videos || []) {
      if (v.category !== category || !v.subject) continue;
      const w = (String(v.title).toLowerCase().match(/[a-z]{4,}/g) || []).filter(x => words.has(x)).length;
      if (w > score) { score = w; best = v.subject; }
    }
    return best || "";
  }

  function safetyFor(text, category) {
    const r = RULES.find(x => x.re.test(text));
    const t = TRADE[category] || DEFAULT_TRADE;
    return r ? { safety: r.safety, ppe: r.ppe } : { safety: t.safety, ppe: t.ppe };
  }


  /* Standard procedures by topic — used for steps when the video has no chapters and Gemini isn't set up.
     They describe the normal safe way to do the job; the admin checks them against the video before publishing. */
  const TOPICS = [
    { re: /lock ?out|tag ?out|\bloto\b/i, steps: ["Tell everyone affected that the equipment will be shut down", "Switch the equipment off using its normal controls", "Isolate every energy source: electrical, pressure, gravity, springs", "Fit your own lock and tag to each isolation point", "Release or block any stored energy", "Try to start it and prove dead before starting work"] },
    { re: /harness|fall arrest|lanyard/i, steps: ["Inspect webbing, stitching, buckles, D-ring and label before use", "Hold the harness by the back D-ring and shake it so straps fall into place", "Put on the shoulder straps; the D-ring sits between your shoulder blades", "Connect and tighten the leg straps — a flat hand should just fit under", "Fasten the chest strap across the middle of your chest", "Clip the lanyard to a rated anchor point above your work"] },
    { re: /step ?ladder/i, steps: ["Inspect feet, steps, spreaders and labels; tag out a damaged ladder", "Open the ladder fully and lock the spreaders", "Set it on firm, level ground close to the work", "Face the ladder and keep three points of contact", "Don't stand on the top two steps or over-reach — move the ladder", "Carry tools in a belt, not in your hands"] },
    { re: /extension ladder|single ladder|\bladder/i, steps: ["Inspect rails, rungs, feet and locks before use", "Set it on firm ground at a 1-in-4 angle (1 m out for every 4 m up)", "Extend it at least 1 metre above the landing point", "Tie it off or have someone foot the ladder", "Face the ladder and keep three points of contact", "Keep your belt buckle between the rails — move the ladder rather than lean"] },
    { re: /heat[\s-]?(stress|illness|stroke|related)|hot weather/i, steps: ["Drink water every 15–20 minutes, even if you are not thirsty", "Take regular breaks in shade or a cool area", "Plan heavy work for cooler hours and follow the midday break", "Know the signs: headache, dizziness, nausea, heavy or no sweating", "If someone is unwell, move them to shade, cool them and call 998", "Watch your colleagues — heat stroke can make people confused"] },
    { re: /confined space/i, steps: ["Get a confined space entry permit before anyone enters", "Isolate pipes, power and moving parts connected to the space", "Ventilate, then test the air for oxygen, flammable and toxic gas", "Put a trained standby person at the entrance at all times", "Keep testing the air while people are inside", "Have the rescue plan and equipment ready — never enter to rescue without it"] },
    { re: /extinguisher|pass method/i, steps: ["Raise the alarm and make sure you have a clear way out", "Choose the right extinguisher for the fire type", "Pull the pin", "Aim the nozzle at the base of the fire", "Squeeze the handle", "Sweep from side to side until the fire is out — then back away"] },
    { cat: "Fire Systems", re: /alarm check valve|wet alarm valve/i, steps: ["Tell the building and the monitoring company before testing", "Check the water pressure gauges above and below the valve", "Open the inspector's test or alarm test valve", "Confirm the water motor gong rings and the panel shows the flow alarm", "Close the test valve and let the system settle back to normal pressure", "Reset the panel and record the results"] },
    { cat: "Fire Systems", re: /sprinkler system|wet pipe|dry pipe|deluge|pre-?action/i, steps: ["Wet pipe systems hold water in the pipes and discharge as soon as a head opens", "Dry pipe systems hold air and are used where pipes could freeze", "Pre-action systems need a detector signal before water enters the pipes", "Deluge systems have open heads and discharge everywhere at once", "Know the control valve for your area and keep it open and secured", "Never paint, cover or hang things from sprinkler heads"] },
    { re: /addressable|conventional/i, steps: ["Conventional systems group detectors into zones — the panel shows the zone", "Addressable systems give every device its own address — the panel shows the exact device", "Find the device location from the panel display before going to site", "Inform the monitoring company before testing or isolating any device", "Never leave devices or zones disabled after work", "Record faults and tests in the fire alarm log book"] },
    { re: /fire alarm (control )?panel|fire panel|\bfacp\b/i, steps: ["Check the panel shows 'normal' with no faults or disablements", "Learn the indicators: fire, fault, disabled, power and silence", "Use the access key or code only if you are authorised", "Inform the monitoring company before any test", "Acknowledge, silence and reset only as the procedure says", "Record every event and fault in the log book"] },
    { re: /smoke detector/i, steps: ["Optical detectors see smoke scattering a light beam", "Ionisation detectors react to tiny particles that change a small current", "Heat detectors are used where smoke detectors would false-alarm, like kitchens", "Inform the monitoring company before testing detectors", "Test with approved test smoke, not a flame", "Keep detectors clean and never cover them during work without a permit"] },
    { re: /duct clean|nadca|air duct/i, steps: ["Isolate the air handling unit and fans before opening ducts", "Protect the area and set up negative air (HEPA vacuum) on the duct", "Open access panels and inspect; take 'before' photos", "Loosen dirt with brushes or air whips while the vacuum runs", "Clean grilles, diffusers and coils; close and seal access panels", "Take 'after' photos, restart the system and record the work"] },
    { re: /tank (clean|disinfect)|water (storage )?tank|potable water/i, steps: ["Get the permit and inform the building; isolate and drain the tank", "Ventilate and test the air before entry — it is a confined space", "Remove sludge and scrub walls, floor and roof", "Rinse and drain the dirty water away", "Disinfect with chlorine at the specified strength and contact time", "Flush, refill, and take a water sample for testing"] },
    { re: /drywall|plasterboard|gypsum/i, steps: ["Cut out the damaged area into a neat square or rectangle", "Fit backing or a patch piece and fix it in place", "Tape the joints with paper or mesh tape", "Apply 2–3 thin coats of joint compound, feathering the edges", "Sand smooth when dry and wipe off the dust", "Prime and paint to match"] },
    { re: /waterproof/i, steps: ["Clean the surface and let it dry completely", "Fill cracks and gaps; seal around pipes and drains", "Apply primer if the product requires it", "Reinforce corners and joints with waterproofing tape or fabric", "Apply two full coats, running up the walls, and let each coat cure", "Flood test for 24–48 hours before tiling"] },
    { re: /\bpaint/i, steps: ["Protect floors and furniture, and ventilate the room", "Clean, scrape, fill and sand the surface", "Apply primer to bare or patched areas", "Cut in edges and corners with a brush", "Roll the main areas in sections, keeping a wet edge", "Apply a second coat once the first is dry"] },
    { re: /drip (irrigation|line|emitter)/i, steps: ["Turn off the water to the zone", "Find the leak, break or blocked emitter", "Cut out the damaged section of drip line", "Join it with a coupling, or replace or clean the emitter", "Flush the line, then turn the water back on", "Check every emitter is dripping evenly"] },
    { re: /irrigation timer|controller/i, steps: ["Check the controller has power and the transformer is working", "Check the date, time, program and rain sensor settings", "Run each zone manually to find which ones fail", "Measure the solenoid resistance on faulty zones with a multimeter", "Check the wire connections and the common wire", "Fix or replace the faulty part and test again"] },
    { cat: "Landscaping", re: /sprinkler|irrigation valve|low pressure/i, steps: ["Check the main valve and backflow are fully open", "Run one zone at a time to find where the pressure drops", "Look for leaks, broken heads and partly closed valves", "Clean or replace blocked filters and nozzles", "Check the valve diaphragm and solenoid", "Test the zone again and adjust the heads"] },
    { re: /conduit/i, steps: ["Choose the right conduit type and size for the job", "Measure and mark the bend positions", "Set the conduit correctly in the bender", "Bend steadily to the required angle", "Check the angle and measurement, then deburr the cut ends", "Fix the conduit with saddles at the correct spacing"] },
    { re: /multimeter|clamp meter|voltage test/i, steps: ["Check the meter, leads and fuse before use", "Select the correct function and range", "Test the meter on a known live source first", "Take the reading with your hands behind the probe guards", "Read and record the value", "Switch the meter off when finished"] },
    { re: /condensate|drain line/i, steps: ["Switch off the AC unit", "Find the drain line and its access or trap", "Clear the blockage with a wet/dry vacuum or by flushing", "Flush the line with clean water", "Check the water drains freely from the pan", "Restart the unit and check for leaks"] },
    { re: /coil clean|condenser coil|evaporator coil/i, steps: ["Switch off and isolate the unit", "Remove the panels and protect electrical parts", "Brush or vacuum loose dirt off the coil", "Apply coil cleaner and leave it for the stated time", "Rinse gently from the inside out", "Refit panels, restart and check operation"] }
  ];
  const TRADE_STEPS = {
    "Electrical": ["Get permission and the right permit for the job", "Isolate the circuit and lock it off", "Prove dead with a tested voltage tester", "Carry out the work as shown in the video", "Check all connections are tight and covers fitted", "Restore power and test the installation"],
    "HVAC": ["Isolate power to the unit", "Inspect the equipment and note any faults", "Carry out the work as shown in the video", "Check connections, fixings and drains", "Restore power and check the unit runs correctly", "Record readings and the work done"],
    "Plumbing": ["Shut off the water supply and drain the line", "Protect the area from water", "Carry out the work as shown in the video", "Check joints and fittings are tight", "Turn the water back on and check for leaks", "Clean up and report the job complete"]
  };
  const GENERAL_STEPS = ["Read the job card and get the right tools and PPE", "Make the area safe and put up barriers or signs", "Carry out the work as shown in the video", "Check your work", "Clean up the area", "Report the job complete"];

  function listSteps(desc) {
    const out = [];
    for (const raw of String(desc || "").split(/\n/)) {
      const m = raw.match(/^\s*(?:\d{1,2}[.)]|step\s*\d{1,2}\s*[:.\-–]|[-•*▪✔✅])\s+(.{8,120})$/i);
      if (m && !JUNK.test(m[1]) && !/\d:\d\d/.test(m[1])) out.push(cap(clean(m[1])));
    }
    return out.length >= 3 ? out.slice(0, 8) : [];
  }
  function stepsFor(title, desc, category) {
    const ch = chapters(desc); if (ch.length) return { steps: ch, from: "chapters" };
    const ls = listSteps(desc); if (ls.length) return { steps: ls, from: "description" };
    const ok = x => !x.cat || !category || x.cat === category;
    const tp = TOPICS.find(x => ok(x) && x.re.test(title)) || TOPICS.find(x => ok(x) && x.re.test(String(desc || "").slice(0, 300)));
    if (tp) return { steps: tp.steps.slice(), from: "topic" };
    return { steps: (TRADE_STEPS[category] || GENERAL_STEPS).slice(), from: "general" };
  }

  /* Turn a YouTube title into a plain training title (used when Gemini isn't available). */
  const ACRO = new Set("AC HVAC RCD RCBO MCB MCCB ELCB PPE VFD LOTO FCU AHU FAHU VRF VRV EEV TXV ATS PCB DB UPS LED PVC PPR GI MEP R410A R32 R22 R134A OSHA NFPA UAE PTFE IGBT PLC CO2 GFCI BS KW BMS CCTV DIY HDPE UV".split(" "));
  const SMALL = new Set("a an and as at but by for in of on or the to vs via with".split(" "));
  function trainingTitle(yt, channel) {
    let t = String(yt || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ");
    t = t.replace(/\b(short|shorts|ep|episode|part)\s*#?\d+\b/gi, " ").replace(/#\w+/g, " ").replace(/\(\s*\d{4}\s*\)|\[\s*\d{4}\s*\]/g, " ");
    let parts = t.split(/\s+[|•–—]\s+|\s+-\s+/).map(clean).filter(Boolean);
    const ch = String(channel || "").toLowerCase();
    parts = parts.filter((p, i) => i === 0 || !(ch && (p.toLowerCase() === ch || ch.includes(p.toLowerCase()))) && !/^(official|full video|new|tutorial|diy|guide)$/i.test(p));
    t = parts.slice(0, 2).join(": ");
    t = t.replace(/\s+(w\/|with|ft\.?|feat\.?)\s+([A-Z][\w.'’-]*[\s,&]*(and\s+)?)+$/, "");
    const letters = t.replace(/[^A-Za-z]/g, ""), upper = t.replace(/[^A-Z]/g, "");
    if (letters.length > 8 && upper.length / letters.length > 0.6) t = t.split(" ").map(w => ACRO.has(w.toUpperCase().replace(/[^A-Z0-9]/g, "")) ? w.toUpperCase() : w.toLowerCase()).join(" ");
    t = t.replace(/\blike an? (pro|professional( \w+)?|boss|expert)\b/gi, "").replace(/\s+(easy|quick|simple|fast)\s*$/i, "").replace(/\b(you must|must see|must watch|you won'?t believe|insane|amazing|easy trick|the right way)\b/gi, "");
    t = t.replace(/[!?]{2,}/g, "").replace(/\s*!+\s*$/, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([:,.])/g, "$1").replace(/[:\-–—,]\s*$/, "").replace(/\s+(easy|quick|simple|fast)\s*$/i, "").trim();
    t = t.split(" ").map((w, i) => {
      if (/^[A-Z0-9\/&-]{2,5}$/.test(w)) return w;                       // keep acronyms: AC, RCD, PPE, R410A
      if (/^[A-Z]{6,}$/.test(w) || /^[a-z]/.test(w)) { const lw = w.toLowerCase(); return i && SMALL.has(lw) ? lw : lw.charAt(0).toUpperCase() + lw.slice(1); }
      return w;
    }).join(" ");
    if (t.length > 70) t = t.slice(0, 67).replace(/\s+\S*$/, "") + "…";
    return cap(t) || clean(yt);
  }

  /* Built-in draft (no internet needed). */
  function ruleDraft({ title, description, category, videos, channel }) {
    const desc = /^Suggested starter video/i.test(description || "") ? "" : description;
    const text = title + " " + (desc || "").slice(0, 400);
    const s = safetyFor(text, category);
    const st = stepsFor(title, desc, category);
    return {
      source: "rules",
      title: trainingTitle(title, channel),
      summary: summary(desc, title),
      safety: s.safety,
      ppe: s.ppe.slice(),
      steps: st.steps,
      stepsFrom: st.from,
      level: level(title + " " + (desc || "").slice(0, 200)),
      subject: subject(title, category, videos)
    };
  }

  /* Gemini draft: the model watches the public YouTube video. */
  /* ---------- Gemini ---------- */
  const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.8-flash-lite", "gemini-3.6-flash-lite", "gemini-3.5-flash-lite"];
  /* Models Google has retired. A browser that saved one of these in Settings skips it. */
  const RETIRED = /^gemini-(1\.|2\.)/;
  const GONE = /not found|not supported|is not available|no longer available|deprecated|retired|update your code/i;
  const API = "https://generativelanguage.googleapis.com/v1beta/models/";

  /* One call to Gemini. Tries the chosen model first, then older ones if the model name is no longer available. */
  /* AI choice, from Settings → AI (settings.ai): { gemini, groq, openrouter: on/off, first: "groq" | "openrouter" | "gemini", orModel }.
     Set root.ABAI = settings.ai before calling. With both on, the second one takes over when the first is
     slow, busy or out of quota. Groq can't watch videos or search Google, so those jobs always use Gemini.
     key === "server": use the owner's shared key through the admin proxy (root.ABProxy); the browser never sees it. */
  // Default split: Gemini watches videos and searches the web; Groq does everything else (Gemini as its backup).
  const aiPrefs = () => Object.assign({ gemini: true, groq: true, openrouter: true, first: "groq" }, root.ABAI || {});
  const TEXT_AIS = { groq: "Groq", openrouter: "OpenRouter" };
  const textDown = {};   // a text AI that answered "no credit" or "bad key" is skipped until the page is reloaded
  async function gemini({ key, model, parts, json = true, tools, timeoutMs = 150000 }) {
    const pref = aiPrefs();
    const needsGemini = !!tools || parts.some(p => p.file_data);
    // Text AIs that can do this job, in the chosen order (the one picked in Settings first).
    const texts = needsGemini || !root.ABProxy ? [] : (pref.first === "openrouter" ? ["openrouter", "groq"] : ["groq", "openrouter"])
      .filter(k => pref[k] !== false && root.ABProxy[k] && !textDown[k]);
    const groqReady = texts.length > 0;
    const geminiReady = pref.gemini !== false && !!key;
    if (needsGemini && pref.gemini === false) throw new Error("This needs Gemini (it watches the video or searches the web). Turn Gemini on in Settings → AI.");
    if (!geminiReady && !groqReady) throw new Error(pref.gemini === false && pref.groq === false && pref.openrouter === false ? "AI is turned off in Settings → AI." : "No AI key is set up yet (Settings → AI).");
    const viaGroq = async () => {   // tries each text AI in order (Groq / OpenRouter)
      const content = parts.map(p => p.inline_data ? { type: "image_url", image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } } : { type: "text", text: p.text || "" });
      const errs = [];
      for (const kind of texts) {
        const r = await root.ABProxy.call({ kind, json, content, ...(kind === "openrouter" && pref.orModel ? { model: pref.orModel } : {}) });
        if (r.status === 200 && r.json.text) return { text: r.json.text, model: r.json.model, grounding: null };
        let m = (r.json.error && r.json.error.message) || TEXT_AIS[kind] + " HTTP " + r.status;
        if (r.status === 402) m = TEXT_AIS[kind] + ": no credit left on the account (add credit, or pick a free model ending in :free in Settings → AI)";
        if ([401, 402, 403].includes(r.status)) textDown[kind] = m;
        errs.push(m);
        var lastStatus = r.status;
      }
      const e = new Error(errs.join(" · ")); e.status = lastStatus; throw e;
    };
    const groqFirst = groqReady && (!geminiReady || pref.first !== "gemini");
    let groqErr = null;
    if (groqFirst) {
      try { return await viaGroq(); } catch (e) { groqErr = e; if (!geminiReady) throw e; }
    }
    const list = [...new Set([model, ...MODELS].filter(m => m && !RETIRED.test(m)))];
    const proxy = key === "server" && root.ABProxy ? root.ABProxy : null;
    const backup = groqReady && !groqFirst;   // Groq is still to try if Gemini struggles
    let lastErr = groqErr, triedBackup = false, anyBusy = false;
    // Never stop: if every model is busy or out of quota, wait a few seconds and go round the list once more.
    for (let pass = 0; pass < 2; pass++) {
    if (pass) { if (!anyBusy) break; await new Promise(res => setTimeout(res, 8000)); }
    anyBusy = false;
    for (const m of list) {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), backup && !triedBackup ? Math.min(timeoutMs, 30000) : timeoutMs) : null;
      try {
        const body = { contents: [{ parts }], generationConfig: { temperature: 0.2 } };
        if (json && !tools) body.generationConfig.responseMimeType = "application/json";
        if (tools) body.tools = tools;
        const r = proxy ? await proxy.fetchGemini(m, body, ctl ? ctl.signal : undefined) : await fetch(API + encodeURIComponent(m) + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: ctl ? ctl.signal : undefined,
          body: JSON.stringify(body)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = (j.error && j.error.message) || ("HTTP " + r.status);
          const err = new Error(msg); err.status = r.status;
          if (r.status === 404 || GONE.test(msg)) { lastErr = err; err.gone = true; continue; }  // try an older model
          if (r.status === 503 || r.status === 500 || r.status === 429) { err.busy = true; anyBusy = true; }   // overloaded or out of quota: next model
          throw err;
        }
        const c = (j.candidates || [])[0] || {};
        const text = ((c.content || {}).parts || []).map(p => p.text || "").join("");
        if (!text) throw new Error(c.finishReason ? "No answer (" + c.finishReason + ")" : "Empty answer");
        return { text, model: m, grounding: c.groundingMetadata || null };
      } catch (e) {
        if (e.name === "AbortError") { e = new Error("Gemini took too long"); e.busy = backup; anyBusy = true; }
        lastErr = e;
        if (backup && !triedBackup && (e.busy || (e.status && e.status !== 404))) {
          triedBackup = true;
          try { return await viaGroq(); } catch (g) { lastErr = new Error("Gemini: " + e.message + " · " + g.message); lastErr.busy = !!e.busy; }
        }
        if (e.busy || e.gone) continue;
        if (e.status && e.status !== 404) throw lastErr;
        if (!e.status && !/not found/i.test(e.message)) throw lastErr;
      } finally { if (timer) clearTimeout(timer); }
    }
    }
    throw lastErr || new Error("No Gemini model available");
  }
  const jsonOf = text => {
    const m = String(text || "").match(/[\[{][\s\S]*[\]}]/);
    if (!m) throw new Error("Gemini didn't return the expected format");
    return JSON.parse(m[0]);
  };

  function aiPrompt({ title, category, subjects, categories }) {
    return `You review training videos for facility-maintenance technicians in Dubai (HVAC, electrical, plumbing, fire systems, cleaning, civil, painting, landscaping). Many speak basic English.
Watch this YouTube video ("${title}"${category ? `, suggested trade: ${category}` : ""}) and reply with JSON only, in exactly this shape:
{"title": string, "summary": string, "safety": string, "ppe": string[], "steps": string[], "level": "Beginner"|"Intermediate"|"Advanced", "subject": string, "category": string,
 "quiz": [{"q": string, "options": string[], "answer": number}],
 "review": {"relevance": number, "quality": number, "recommend": "approve"|"maybe"|"reject", "reason": string, "unsafe": string[], "language": string, "talking": boolean}}
Rules:
- title: a clear training-library title for what the video teaches, 3–9 words, Title Case, under 60 characters (e.g. "Clearing a Blocked AC Condensate Drain", "Testing RCDs", "How VRF Systems Work"). No clickbait, no channel or presenter names, no episode numbers, no emojis or hashtags. Keep useful equipment names (e.g. "Sloan Flushometer").
- summary: 1–2 plain sentences saying what the video shows. No hype, no channel name.
- safety: one sentence with the most important safety precaution for this task.
- ppe: 2–4 items of protective equipment, Title Case (e.g. "Safety Glasses").
- steps: 3–6 key steps actually shown in the video, each a short instruction under 14 words, starting with a verb. If it is not a procedure, give the 3–6 key points instead.
- level: who the video suits.
- subject: a short topic label${subjects && subjects.length ? `; prefer one of: ${subjects.slice(0, 25).join("; ")}` : ""}.
- category: the best trade for it${categories && categories.length ? `, one of: ${categories.join("; ")}` : ""}.
${quizRules(3)}
- review.relevance: 0–10, how useful this is for training our technicians (0 = unrelated, e.g. computers, vlogs, sales pitches).
- review.quality: 0–10, how clear and well filmed the teaching is.
- review.recommend: approve / maybe / reject for our training library.
- review.reason: one short sentence explaining the recommendation.
- review.unsafe: unsafe practices shown in the video (e.g. working live, no PPE, no fall protection). Empty list if none.
- review.language: main spoken language. review.talking: false if the video has no narration.
Use simple words. Do not invent steps that are not in the video.`;
  }
  /* ---------- Quizzes ----------
     A quiz is a list of {q, options: [3–4 strings], answer: index of the right option}. */
  function normQuiz(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      if (!x) continue;
      const q = clean(x.q || x.question).slice(0, 200);
      const options = (Array.isArray(x.options) ? x.options : []).map(o => clean(o).slice(0, 120)).filter(Boolean).slice(0, 4);
      const answer = Math.round(Number(x.answer));
      if (q && options.length >= 2 && answer >= 0 && answer < options.length && new Set(options).size === options.length) out.push({ q, options, answer });
    }
    return out.slice(0, 8);
  }
  /* Admin text format: question on one line, then options; the right one starts with "*", the others with "-". Blank line between questions. */
  function quizToText(quiz) {
    return (quiz || []).map(x => [x.q, ...x.options.map((o, i) => (i === x.answer ? "* " : "- ") + o)].join("\n")).join("\n\n");
  }
  function parseQuizText(text) {
    const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map(b => b.split("\n").map(s => s.trim()).filter(Boolean)).filter(b => b.length);
    const out = [], errors = [];
    blocks.forEach((b, i) => {
      const q = b[0].replace(/^(q\s*\d*[:.)]|\d+[.)])\s*/i, "");
      const opts = b.slice(1).filter(l => /^[-*•✓✔]/.test(l));
      const options = opts.map(l => l.replace(/^[-*•✓✔]\s*/, ""));
      const answer = opts.findIndex(l => /^[*✓✔]/.test(l));
      if (options.length < 2) errors.push(`Question ${i + 1}: add at least 2 options, each on its own line starting with - or *.`);
      else if (answer < 0) errors.push(`Question ${i + 1}: mark the right answer with * at the start of the line.`);
      else if (opts.filter(l => /^[*✓✔]/.test(l)).length > 1) errors.push(`Question ${i + 1}: only one answer can be marked with *.`);
      else out.push({ q, options, answer });
    });
    return { quiz: normQuiz(out), errors };
  }
  const quizRules = (n = 3) => `- quiz: ${n} multiple-choice questions that check the technician understood the key safety point and steps. Each: {"q": short question, "options": 3 short answers, "answer": index (0–2) of the one correct answer}. Wrong answers must be clearly wrong but believable. Simple English, under 15 words each. Vary the position of the right answer.`;
  /* Write a quiz from the video's training card (text only, quick and cheap). */
  async function aiQuiz({ title, summary, safety, steps, ppe, key, model, count = 3 }) {
    count = Math.max(2, Math.min(8, +count || 3));
    const r = await gemini({ key, model, timeoutMs: 60000, parts: [{ text:
      `Write a short quiz for facility-maintenance technicians in Dubai who watched a training video. Many speak basic English.
Video: "${title}"
What it shows: ${summary || "(not given)"}
Safety: ${safety || "(not given)"}
PPE: ${(ppe || []).join(", ") || "(not given)"}
Steps: ${(steps || []).map((s, i) => `${i + 1}. ${s}`).join(" ") || "(not given)"}
Reply with JSON only: {"quiz": [...]}
${quizRules(count)}
Only ask about what is in the text above.` }] });
    const quiz = normQuiz(jsonOf(r.text).quiz);
    if (quiz.length < Math.min(2, count)) throw new Error("Gemini's quiz was incomplete");
    return quiz.slice(0, count);
  }
  /* Google Search inside Gemini has its own, much smaller free quota. When it runs out,
     ask again without search (answered from what the AI already knows — Groq can help here) and say so. */
  const isQuota = e => e && (e.status === 429 || /quota|rate.?limit|exhausted/i.test(e.message || ""));
  async function searchOrRecall(opts) {
    try { return { ...(await gemini({ ...opts, json: false, tools: [{ google_search: {} }] })), searched: true }; }
    catch (e) {
      if (!isQuota(e) && !/needs Gemini/.test(e.message || "")) throw e;
      try { return { ...(await gemini({ ...opts, json: false })), searched: false }; }
      catch (e2) {
        if (isQuota(e2)) throw new Error("The free daily AI limit is used up. Try again tomorrow, or turn on billing for the Gemini key in Google AI Studio.");
        throw e2;
      }
    }
  }
  /* Find trusted YouTube channels for a trade using Google Search. */
  async function aiFindChannels({ category, keywords, existing, key, model }) {
    const r = await searchOrRecall({ key, model, parts: [{ text:
      `Find 5 YouTube channels that publish good, practical training videos for facility-maintenance technicians in the trade: "${category}"${keywords && keywords.length ? ` (topics: ${keywords.slice(0, 12).join(", ")})` : ""}.
Prefer professional trainers, manufacturers, trade associations and experienced technicians who show safe work, in English. Avoid channels that are mostly vlogs, sales, Shorts or unsafe practice.
${existing && existing.length ? `We already follow: ${existing.join("; ")}. Suggest different ones.` : ""}
Reply with JSON only: [{"url": "https://www.youtube.com/@handle", "name": string, "why": string}] — only real channels you found.` }] });
    const list = jsonOf(r.text);
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      const url = String(c.url || "").trim().replace(/\/(videos|featured|shorts|streams|about)\/?$/, "").replace(/\?.*$/, "");
      if (/^https:\/\/(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)$/.test(url) && !out.some(o => o.url === url))
        out.push({ url: url.replace("://m.", "://www."), name: clean(c.name).slice(0, 80), why: clean(c.why).slice(0, 200) });
    }
    const res = out.slice(0, 6);
    res.searched = r.searched;
    return res;
  }

  function parseAI(text) {
    const j = jsonOf(text);
    const arr = a => (Array.isArray(a) ? a : []).map(clean).filter(Boolean);
    const num = n => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
    const rv = j.review || {};
    const d = {
      source: "ai",
      title: clean(j.title).replace(/^["']|["']$/g, "").slice(0, 80),
      summary: clean(j.summary).slice(0, 400),
      safety: clean(j.safety).slice(0, 300),
      ppe: arr(j.ppe).slice(0, 5),
      steps: arr(j.steps).map(s => s.replace(/^\d+[.)]\s*/, "")).slice(0, 8),
      stepsFrom: "ai",
      level: ["Beginner", "Intermediate", "Advanced"].includes(j.level) ? j.level : "Intermediate",
      subject: clean(j.subject).slice(0, 60),
      category: clean(j.category).slice(0, 60),
      review: {
        relevance: num(rv.relevance), quality: num(rv.quality),
        recommend: ["approve", "maybe", "reject"].includes(rv.recommend) ? rv.recommend : "maybe",
        reason: clean(rv.reason).slice(0, 240),
        unsafe: arr(rv.unsafe).slice(0, 5),
        language: clean(rv.language).slice(0, 30),
        talking: rv.talking !== false
      }
    };
    if (!d.summary || d.steps.length < 2) throw new Error("Gemini's answer was incomplete");
    const quiz = normQuiz(j.quiz);
    if (quiz.length >= 2) d.quiz = quiz;
    return d;
  }
  /* Watch a video: draft the training card and review it. */
  async function aiDraft({ yt, title, category, subjects, categories, key, model, timeoutMs }) {
    const r = await gemini({ key, model, timeoutMs, parts: [
      { file_data: { file_uri: "https://www.youtube.com/watch?v=" + yt } },
      { text: aiPrompt({ title, category, subjects, categories }) }
    ] });
    const d = parseAI(r.text);
    d.model = r.model;
    return d;
  }
  /* Find YouTube videos for a topic using Google Search. */
  async function aiFindVideos({ topic, details, category, key, model }) {
    const r = await gemini({ key, model, json: false, tools: [{ google_search: {} }], parts: [{ text:
      `Find 5 good, public YouTube training videos for facility-maintenance technicians on: "${topic}"${details ? ` (${details})` : ""}${category ? `, trade: ${category}` : ""}.
Prefer clear, practical, safe demonstrations from professional trainers, manufacturers or trade channels, in English. Avoid Shorts, sales pitches and unsafe practice.
Reply with JSON only: [{"url": "https://www.youtube.com/watch?v=...", "title": string, "channel": string, "why": string}] — only real videos you found.` }] });
    const list = jsonOf(r.text);
    const out = [];
    for (const v of Array.isArray(list) ? list : []) {
      const m = String(v.url || "").match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
      if (m && !out.some(o => o.yt === m[1])) out.push({ yt: m[1], title: clean(v.title).slice(0, 150), channel: clean(v.channel).slice(0, 80), why: clean(v.why).slice(0, 200) });
    }
    return out.slice(0, 6);
  }
  /* Write a toolbox talk from a title. */
  async function aiTalk({ title, key, model }) {
    const r = await gemini({ key, model, parts: [{ text:
      `Write a 5-minute toolbox talk for facility-maintenance technicians in Dubai on: "${title}".
Reply with JSON only: {"icon": the best matching name from this list: ${(root.ABIcon ? root.ABIcon.ITEM_ICONS : ["hardhat"]).join(", ")}, "points": [4–5 short points, each one plain sentence under 20 words], "ask": one question for the supervisor to ask the team}.
Use simple English, practical advice, and local context where useful (UAE emergency numbers 999 police, 998 ambulance, 997 fire; summer heat).` }] });
    const j = jsonOf(r.text);
    return { icon: clean(j.icon).slice(0, 20), points: (j.points || []).map(clean).filter(Boolean).slice(0, 6), ask: clean(j.ask).slice(0, 200) };
  }
  /* Translate a list of short lines into one language; returns the same number of lines. */
  async function aiTranslate({ lines, langName, key, model }) {
    const r = await gemini({ key, model, timeoutMs: 90000, parts: [{ text:
      `Translate each item of this JSON array from English into ${langName}, for facility-maintenance technicians with basic schooling.
Keep it short and plain. Keep technical terms, brand names, model numbers and units that workers normally say in English (e.g. AC, RCD, PPE, R410A, VFD) in English or in the common local form.
Reply with JSON only: an array of exactly ${lines.length} strings, in the same order. Empty strings stay empty.
${JSON.stringify(lines)}` }] });
    const out = jsonOf(r.text);
    if (!Array.isArray(out) || out.length !== lines.length) throw new Error("Gemini returned " + (Array.isArray(out) ? out.length : "no") + " lines instead of " + lines.length);
    return out.map(x => clean(x));
  }
  /* Quick check that a key works. */
  async function aiTest({ key, model }) {
    const r = await gemini({ key, model, json: false, timeoutMs: 30000, parts: [{ text: "Reply with the single word: ready" }] });
    return r.model;
  }

  /* Duplicate check: compares the meaningful words of two titles (0 = nothing in common, 1 = same). */
  const STOP = new Set("a an the and or of for to in on with your you how what why is are it its this that from by at as be do does using use used easy simple quick guide tutorial video explained explanation step steps full complete beginner beginners basic basics part new best way ways diy pro like professional training tips tip learn lesson course 2023 2024 2025 2026 vs".split(" "));
  const stem = w => w.replace(/(ings|ing|ers|er|es|ed|s)$/, "").replace(/(.)\1$/, "$1");
  const tokens = t => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 1 && !STOP.has(w)).map(stem).filter(w => w.length > 1));
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach(x => { if (B.has(x)) n++; });
    return 2 * n / (A.size + B.size);
  }
  const DUP = 0.66;
  /* items: [{yt, title, ...}] → those that look like the same video or the same topic, best match first. */
  function findDuplicates(target, items) {
    const out = [];
    for (const it of items || []) {
      if (!it || it === target) continue;
      if (target.yt && it.yt === target.yt) { out.push({ item: it, score: 1, same: true }); continue; }
      const sc = Math.max(similarity(target.title, it.title), it.ytTitle ? similarity(target.title, it.ytTitle) : 0, target.ytTitle ? similarity(target.ytTitle, it.title) : 0);
      if (sc >= DUP) out.push({ item: it, score: sc, same: false });
    }
    return out.sort((x, y) => y.score - x.score);
  }

  /* Groq backup for the daily jobs, which hold the key themselves (GitHub secret GROQ_API_KEY).
     In the admin the key stays on the server and the proxy plays this role. */
  const GROQ_TEXT = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  const GROQ_VISION = ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"];
  /* OpenRouter (OpenAI format): the model chosen in Settings, then OpenRouter's automatic pick. */
  let orFree = null;
  async function orFreeModels(vision) {
    if (!orFree) {
      try {
        const list = ((await (await fetch("https://openrouter.ai/api/v1/models")).json()) || {}).data || [];
        const free = list.filter(m => m && typeof m.id === "string" && !m.id.startsWith("openrouter/") && (m.id.endsWith(":free") || (String((m.pricing || {}).prompt) === "0" && String((m.pricing || {}).completion) === "0")));
        const rank = m => (/gpt-oss|llama-3\.3-70b|deepseek|qwen|gemma|mistral|llama-4/i.test(m.id) ? 1e9 : 0) + (m.context_length || 0);
        free.sort((a, b) => rank(b) - rank(a));
        orFree = { text: free.map(m => m.id), vision: free.filter(m => ((m.architecture || {}).input_modalities || []).includes("image")).map(m => m.id) };
      } catch { orFree = { text: [], vision: [] }; }
    }
    return (vision ? orFree.vision : orFree.text).slice(0, 4);
  }
  async function openrouterCall(key, { json, content, model }) {
    let last = "", status = 503;
    const vision = content.some(c => c.type === "image_url");
    const models = [...new Set([model, "openrouter/auto"].filter(Boolean))];
    let addedFree = false;
    for (let mi = 0; mi < models.length && mi < 6; mi++) {
      const m = models[mi];
      for (const strict of json ? [true, false] : [false]) {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": "https://abfmapps.github.io/abfm-training/", "X-Title": "ABFM Training" },
          body: JSON.stringify({ model: m, temperature: 0.2, messages: [{ role: "user", content }], ...(strict ? { response_format: { type: "json_object" } } : {}) })
        });
        const j = await r.json().catch(() => ({}));
        const text = (((j.choices || [])[0] || {}).message || {}).content || "";
        if (r.ok && text) return { status: 200, json: { text, model: "openrouter:" + (j.model || m) } };
        last = (j.error && j.error.message) || (r.ok ? "empty answer" : "HTTP " + r.status); status = r.ok ? 503 : r.status;
        if (r.status === 401) return { status, json: { error: { message: "OpenRouter: " + last } } };
        if (!(strict && r.status === 400)) break;
      }
      if (mi === models.length - 1 && !addedFree) { addedFree = true; for (const f of await orFreeModels(vision)) if (!models.includes(f)) models.push(f); }
    }
    return { status, json: { error: { message: "OpenRouter: " + last } } };
  }
  /* For the daily jobs: { groq: key, openrouter: key } → the same interface as the admin proxy. */
  function aiDirect(k) {
    const g = k.groq ? groqDirect(k.groq) : null;
    return { groq: !!k.groq, openrouter: !!k.openrouter, call: p => p.kind === "openrouter" ? openrouterCall(k.openrouter, p) : g.call(p) };
  }
  function groqDirect(key) {
    return { groq: true, call: async ({ json, content }) => {
      const vision = content.some(c => c.type === "image_url");
      let last = "", status = 503;
      for (const model of vision ? GROQ_VISION : GROQ_TEXT) {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content }], ...(json ? { response_format: { type: "json_object" } } : {}) })
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return { status: 200, json: { text: ((j.choices || [])[0] || {}).message?.content || "", model: "groq:" + model } };
        last = (j.error && j.error.message) || "HTTP " + r.status; status = r.status;
        if (r.status === 404 || r.status === 429 || r.status >= 500 || /decommission|not found|does not exist|not supported/i.test(last)) continue;
        break;
      }
      return { status, json: { error: { message: "Groq: " + last } } };
    } };
  }
  root.ABDraft = { groqDirect, aiDirect, trainingTitle, stepsFor, ruleDraft, aiTranslate, aiDraft, aiFindVideos, aiFindChannels, aiQuiz, normQuiz, quizToText, parseQuizText, aiTalk, aiTest, MODELS, chapters, summary, level, safetyFor, similarity, findDuplicates };
})(typeof globalThis !== "undefined" ? globalThis : this);
