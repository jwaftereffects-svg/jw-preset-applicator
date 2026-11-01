/* JW Preset Applicator Pro - visual skin: icons for tabs, section titles and buttons.
 * Purely visual: nothing here changes what a button does. */
(function () {
  "use strict";
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // 24x24 line icons (stroke = currentColor)
  var I = {
    wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2L10.8 4.8M3 21l9-9",
    stack: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
    sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    gem: "M6 3h12l4 6-10 12L2 9zM2 9h20M12 21L8 9l4-6 4 6z",
    library: "M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8-1 4 15.5-3.8 1z",
    curve: "M3 20C10 20 14 4 21 4M3 20h.01M21 4h.01",
    copy: "M8 8h12v12H8zM16 8V4H4v12h4",
    undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    wave: "M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0",
    seq: "M4 7h13l-3-3M20 17H7l3 3",
    workarea: "M4 4v16M20 4v16M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3",
    scissors: "M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12",
    bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
    ai: "M9 3l1.5 4.5L15 9l-4.5 1.5L9 15l-1.5-4.5L3 9l4.5-1.5zM18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z",
    film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4",
    play: "M7 4l13 8-13 8z",
    scan: "M3 8V5a2 2 0 012-2h3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3M7 12h10",
    clock: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
    keys: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
    phone: "M7 2h10v20H7zM11 18h2",
    rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 13l-2-2c1-4 5-8 13-8 0 8-4 12-8 13zM15 9h.01",
    save: "M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7",
    tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    refresh: "M20 12a8 8 0 11-2.3-5.6M20 4v5h-5",
    download: "M12 3v12M7 10l5 5 5-5M4 21h16",
    wrench: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z",
    palette: "M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5S13.5 15 15 15h2a4 4 0 004-4c0-4.4-4-8-9-8zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01",
    folder: "M3 7h6l2 2h10v10H3z",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    home: "M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
    bolt2: "M13 2L4 14h7l-1 8 9-12h-7z",
    mic: "M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3M8 21h8",
    plus: "M12 5v14M5 12h14",
    square: "M5 5h14v14H5z",
    target: "M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z",
    camera: "M3 8h4l2-3h6l2 3h4v11H3zM12 17a4 4 0 100-8 4 4 0 000 8z",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z",
    maximize: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    blend: "M9 6a6 6 0 100 12 6 6 0 000-12zM15 6a6 6 0 100 12 6 6 0 000-12z",
    clipboard: "M9 3h6v4H9zM7 5H5v16h14V5h-2",
    image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01",
    music: "M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z",
    unstack: "M12 3l9 5-9 5-9-5zM12 21v-6M9 18l3 3 3-3",
    explode: "M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3",
    stretch: "M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4",
    bounce: "M3 20c2-10 4-10 6 0c1.5-6 3-6 4.5 0c1-3 2-3 3 0c.6-1.4 1.2-1.4 1.8 0",
    nodes: "M5 19a2 2 0 100-4 2 2 0 000 4zM19 9a2 2 0 100-4 2 2 0 000 4zM6.5 15.5C9 10 13 9 17 7.5",
    drive: "M3 13h18v6H3zM5 13l2-8h10l2 8M7 16h.01",
    mute: "M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6",
    key: "M12 3l9 9-9 9-9-9z",
    code: "M8 7l-5 5 5 5M16 7l5 5-5 5",
    type: "M5 5h14M12 5v14M9 19h6",
    heart: "M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z"
  };
  function svg(name, cls) {
    var d = I[name];
    if (!d) return "";
    return '<svg class="' + (cls || "ic") + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  var TABS = { home: "home", tools: "wrench", browse: "grid", effect: "wand", precomp: "stack", adjustment: "sliders", topaz: "gem", layers: "library", ease: "curve", audio: "mic" };
  var TITLES = {
    "Preset": "sparkle", "Effect Options": "sliders", "Effect Tools": "wrench", "Precomp": "stack", "Timeline Tools": "seq",
    "Label Colors": "tag", "Adjustment Layers": "sliders", "Cut Flashes": "bolt", "Cut Joins": "scissors", "Topaz Video AI": "ai", "Quick Export": "film",
    "Instant Preview": "play", "Background Jobs": "list", "Smart Scene Detect": "scan", "Save Layers": "save", "Library": "library",
    "Verse Flow": "download", "Turbo AE": "rocket", "Theme": "palette", "Effect Preview": "eye", "Hotkeys": "keys",
    "Recent Actions": "clock", "Doomscroll": "phone", "Panel": "refresh",
    "Quick Actions": "bolt", "Recent Presets": "clock", "Favorites": "star", "Preset Browser": "grid", "Vocal Remover": "mic",
    "Create": "plus", "Layer Tools": "maximize", "Precomps & Text": "type", "Markers & Beats": "music", "Auto Cut Silence": "mute",
    "Keyframes": "key", "Session": "play", "Project Health": "heart", "Cache": "drive", "SFX Browser": "music", "Exports & Sounds": "folder"
  };
  // the Tools tab buttons (data-craft), some by their data-kind / data-what
  var CRAFT = {
    "add:solid": "square", "add:null": "target", "add:adjustment": "sliders", "add:camera": "camera", "add:light": "bulb",
    fit: "maximize", frameBlend: "blend", clipboard: "clipboard", screenshot: "image", unprecomp: "unstack", explode: "explode",
    cutMarker: "scissors", seqMarkers: "seq", beats: "music", silence: "mute", stretch: "stretch",
    "motion:bounce": "bounce", "motion:elastic": "wave", pathNulls: "nodes",
    "del:keyframes": "key", "del:expressions": "code", "del:effects": "trash",
    optimize: "sparkle", cache: "drive", sfxFolder: "folder", outFolder: "folder", outReset: "refresh"
  };
  var TOOLS = { copyEffects: "copy", stripLast: "undo", stripAll: "trash", fixRipple: "wave", sequence: "seq", workArea: "workarea", splitMarkers: "scissors", flashCuts: "bolt", cutJoins: "scissors", saveComp: "save" };
  var ACTIONS = { effect: "wand", precomp: "stack", adjustment: "sliders" };
  var IDS = { pbMake: "sparkle", pbMore: "grid", tzSend: "ai", qxSend: "film", pvSend: "play", pvClear: "trash", sdRun: "scan", lySave: "save", ezApply: "curve", browseBtn: "folder", vrRun: "mic", vrFile: "folder",
    crHealthRefresh: "refresh", crCacheRefresh: "refresh", sfxRescan: "refresh", crSoundTest: "play", reloadBtn: "refresh", pvClipPick: "film", scrollOpen: "phone" };

  // tabs: icon, and the name in its own span (the dock shows it on the active tab)
  $$(".tab").forEach(function (t) {
    var ic = TABS[t.dataset.tab];
    if (ic && !t.querySelector(".tab-ic")) t.insertAdjacentHTML("afterbegin", svg(ic, "tab-ic"));
    Array.prototype.slice.call(t.childNodes).forEach(function (n) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) return;
      var s = document.createElement("span");
      s.className = "tab-label";
      s.textContent = n.nodeValue.trim();
      t.replaceChild(s, n);
      t.setAttribute("data-tip", s.textContent);
    });
  });

  // section titles: icon badge instead of the plain bar
  $$(".card-title").forEach(function (t) {
    var name = (t.childNodes[0] && t.childNodes[0].nodeType === 3 ? t.childNodes[0].nodeValue : t.textContent).trim();
    var ic = TITLES[name] || "sparkle";
    if (t.querySelector(".title-ic")) return;
    t.insertAdjacentHTML("afterbegin", '<span class="title-ic">' + svg(ic) + "</span>");
    t.classList.add("has-icon");
  });

  // buttons: a leading icon (kept if a button rewrites its own text later)
  function iconize(btn, ic) {
    if (!ic || btn.querySelector(".btn-ic")) return;
    var host = btn.querySelector(".label") || btn;
    host.insertAdjacentHTML("afterbegin", svg(ic, "btn-ic"));
    btn.classList.add("has-ic");
  }
  function decorate() {
    $$("[data-tool]").forEach(function (b) { iconize(b, TOOLS[b.dataset.tool]); });
    $$("[data-action]").forEach(function (b) { iconize(b, ACTIONS[b.dataset.action]); });
    Object.keys(IDS).forEach(function (id) { var b = document.getElementById(id); if (b) iconize(b, IDS[id]); });
    $$("[data-craft]").forEach(function (b) {
      var k = b.dataset.craft, sub = b.dataset.kind || b.dataset.what;
      iconize(b, CRAFT[k + ":" + sub] || CRAFT[k]);
    });
  }
  decorate();
  // a few buttons change their own text (e.g. Copy effects -> Paste ...): put the icon back
  $$("[data-tool]").forEach(function (b) {
    new MutationObserver(function () { if (!b.classList.contains("armed")) iconize(b, TOOLS[b.dataset.tool]); }).observe(b, { childList: true });
  });

  // ---- themed tooltips instead of the plain Windows ones
  var tip = document.createElement("div"), tipTimer = null, tipFor = null;
  tip.className = "jw-tip";
  document.body.appendChild(tip);
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.classList.remove("on"); }
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest ? e.target.closest("[title], [data-tip]") : null;
    if (!el || el === tipFor) return;
    if (el.getAttribute("title")) { el.setAttribute("data-tip", el.getAttribute("title")); el.removeAttribute("title"); }
    var text = el.getAttribute("data-tip");
    hideTip();
    if (!text) return;
    tipFor = el;
    tipTimer = setTimeout(function () {
      if (tipFor !== el) return;
      tip.textContent = text;
      var r = el.getBoundingClientRect(), w = Math.min(260, Math.max(80, text.length * 6.2));
      tip.style.maxWidth = "260px";
      tip.classList.add("on");
      var tr = tip.getBoundingClientRect();
      var x = Math.max(6, Math.min(window.innerWidth - tr.width - 6, r.left + r.width / 2 - tr.width / 2));
      var below = r.top < tr.height + 14;
      var y = below ? r.bottom + 8 : r.top - tr.height - 8;
      tip.style.left = x + "px"; tip.style.top = y + "px";
      tip.classList.toggle("below", below);
    }, 450);
  });
  document.addEventListener("mouseout", function (e) { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
  document.addEventListener("mousedown", hideTip, true);
  document.addEventListener("wheel", hideTip, true);

  // ---- number boxes get - / + buttons
  $$("input.num").forEach(function (inp) {
    if (inp.parentNode.classList.contains("stepper")) return;
    var wrap = document.createElement("span");
    wrap.className = "stepper";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    [["-", -1], ["+", 1]].forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "st-btn " + (b[1] < 0 ? "minus" : "plus");
      btn.textContent = b[0] === "-" ? "\u2212" : "+";
      btn.addEventListener("click", function () {
        if (inp.disabled) return;
        var step = parseFloat(inp.step) || 1, v = (parseFloat(inp.value) || 0) + b[1] * step;
        if (inp.min !== "") v = Math.max(parseFloat(inp.min), v);
        if (inp.max !== "") v = Math.min(parseFloat(inp.max), v);
        inp.value = v;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      wrap.appendChild(btn);
    });
    // a switched-off number box hides completely (not just its contents)
    function sync() { wrap.classList.toggle("off", !!inp.disabled); }
    sync();
    new MutationObserver(sync).observe(inp, { attributes: true, attributeFilter: ["disabled"] });
  });

  // cover for anything without a preview, in the theme's colours (follows theme changes live).
  // The name picks the angle, which colour leads and where the glow sits, so covers still differ.
  function coverArt(el, name) {
    name = String(name || "?");
    var x = 2166136261;
    for (var i = 0; i < name.length; i++) { x ^= name.charCodeAt(i); x = (x * 16777619) >>> 0; }
    var ang = (x >> 4) % 360, flip = (x >> 11) & 1, c1 = flip ? "--a2-rgb" : "--a1-rgb", c2 = flip ? "--a1-rgb" : "--a2-rgb";
    var deep = (0.42 + ((x >> 13) % 20) / 100).toFixed(2);
    var w = name.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
    el.style.backgroundImage =
      "radial-gradient(circle at " + (20 + (x >> 3) % 60) + "% " + (20 + (x >> 6) % 60) + "%, rgba(255,255,255,.28), transparent 55%)," +
      "linear-gradient(" + ang + "deg, rgba(var(" + c1 + "),.95), rgba(var(" + c2 + ")," + deep + ")), linear-gradient(var(--panel), var(--panel))";
    el.setAttribute("data-ini", ((w[0] || "?").charAt(0) + (w[1] ? w[1].charAt(0) : (w[0] || "").charAt(1) || "")).toUpperCase());
    el.classList.add("art");
  }

  if (window.JWPA) { window.JWPA.icon = svg; window.JWPA.coverArt = coverArt; }
})();
