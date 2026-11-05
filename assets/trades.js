/* Line icon and colour for each trade, picked from the category name.
   Shared by the staff app and the admin. Order matters: the first match wins. */
(function (root) {
  "use strict";
  const T = [
    [/duct|exhaust/i, '<path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h8"/>', "#3F5F7A"],
    [/hvac|air ?con|a\/c|\bac\b|refrig|chiller/i, '<path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9"/>', "#1F5FAE"],
    [/\bbms\b|control|automation/i, '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 12l3-3 3 2 4-4"/>', "#0E7490"],
    [/electric/i, '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', "#8A5300"],
    [/plumb|drain/i, '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>', "#0F6B5C"],
    [/fire/i, '<path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3 0 2 1 3 2 3 0-3-1-5 1-9z"/>', "#B91C1C"],
    [/safety|health/i, '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>', "#B91C1C"],
    [/paint|waterproof/i, '<path d="M4 4h12v5H4zM16 6h3v5h-8v3M10 14h2v7h-2z"/>', "#5B3BB0"],
    [/civil|mason|carpent|tiling/i, '<path d="M3 6h18v12H3zM3 12h18M9 6v6M15 12v6"/>', "#7A4A21"],
    [/water|tank|pump/i, '<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>', "#1F6FA0"],
    [/landscap|irrigat|garden/i, '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7"/>', "#2F7A2B"],
    [/kitchen|laundry|appliance/i, '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M8 5.5h.01M11 5.5h.01"/><circle cx="12" cy="14" r="3.5"/>', "#9A3412"],
    [/clean|housekeep/i, '<path d="M9 3h5v3H9zM10 6v3M7 9h9l1 12H6zM17 4l3-1M17 6h3"/>', "#0F766E"],
    [/uae|rule|regulat|compliance|law/i, '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>', "#3F434C"]
  ];
  const DEFAULT = [null, '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="m10 8.5 4 2-4 2z"/>', "#3F434C"];
  const find = name => T.find(([re]) => re.test(name || "")) || DEFAULT;
  root.ABTrades = {
    paths: name => find(name)[1],
    color: name => find(name)[2],
    svg: (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${find(name)[1]}</svg>`,
    tone: name => { const c = find(name)[2]; return `color:${c};background:color-mix(in srgb, ${c} 13%, #fff)`; }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
