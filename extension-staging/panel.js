/* JW Preset Applicator Pro - panel logic */
(function () {
  "use strict";

  var cep = window.__adobe_cep__;
  var nodeOk = typeof require === "function";
  var fs = nodeOk ? require("fs") : null;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ------------------------------------------------------------------
  // Themes (same names/colors as the ScriptUI version, so settings are shared)
  // ------------------------------------------------------------------
  var THEMES = {
    "Blue Neon":    { bg: [.067, .071, .086], panel: [.106, .114, .137], panel2: [.082, .088, .106], a1: [.25, .8, 1], a2: [.36, .42, 1], text: [.92, .94, 1], muted: [.56, .6, .7] },
    "Purple Glow":  { bg: [.071, .059, .094], panel: [.118, .094, .157], panel2: [.09, .071, .122], a1: [.78, .45, 1], a2: [.45, .3, 1], text: [.95, .91, 1], muted: [.62, .56, .72] },
    "Red Lava":     { bg: [.086, .051, .051], panel: [.149, .082, .078], panel2: [.114, .063, .059], a1: [1, .55, .25], a2: [1, .25, .3], text: [1, .93, .91], muted: [.72, .58, .55] },
    "Green Matrix": { bg: [.043, .067, .051], panel: [.067, .11, .078], panel2: [.051, .086, .06], a1: [.35, 1, .55], a2: [.1, .75, .6], text: [.9, 1, .93], muted: [.53, .7, .58] },
    "Gold":         { bg: [.082, .071, .043], panel: [.137, .114, .067], panel2: [.106, .09, .051], a1: [1, .82, .3], a2: [1, .52, .2], text: [1, .96, .87], muted: [.72, .66, .52] }
  };
  function hexc(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; }
  // a dark theme from two accent colours; the backgrounds get a hint of the tint colour
  function makeTheme(a1, a2, tint, k) {
    var t = hexc(tint); k = k || 0.1;
    return {
      bg: mix([.058, .062, .076], t, k * 0.55), panel: mix([.1, .106, .128], t, k), panel2: mix([.077, .082, .1], t, k * 0.8),
      a1: hexc(a1), a2: hexc(a2), text: mix([.93, .94, .98], hexc(a1), .05), muted: mix([.55, .58, .67], t, .14)
    };
  }
  [
    ["Sunset", "#ffa24d", "#ff4d8d", "#ff6a3d", .12], ["Cotton Candy", "#ff8ad8", "#7ab8ff", "#c98aff", .1],
    ["Ocean", "#2fd6c6", "#2f7bff", "#1f8fbf", .12], ["Ice", "#c2f3ff", "#6aa8ff", "#7fc4ff", .08],
    ["Toxic", "#c6ff3d", "#3dff9a", "#6bd13d", .1], ["Vaporwave", "#ff6ad5", "#8c5cff", "#7a3dff", .16],
    ["Cyberpunk", "#fcee0a", "#ff2a6d", "#ff2a6d", .1], ["Blood Moon", "#ff4d4d", "#b3123a", "#a1102b", .15],
    ["Mint", "#7dffcb", "#3dc7ff", "#3dd6a0", .09], ["Peach", "#ffbb94", "#ff7a7a", "#ff9a7a", .1],
    ["Royal", "#8f7bff", "#d27bff", "#6a4dff", .14], ["Aurora", "#57ffb0", "#8a6bff", "#4db3a0", .1],
    ["Midnight", "#7c95ff", "#4253d9", "#2a3a99", .14], ["Rose Gold", "#f7c6a3", "#e88a9a", "#d9958a", .1],
    ["Mono", "#f0f0f0", "#9a9a9a", "#808080", .0]
  ].forEach(function (d) { THEMES[d[0]] = makeTheme(d[1], d[2], d[3], d[4]); });

  var OK = [.3, .88, .55], BAD = [1, .36, .4], WARN = [1, .75, .3];

  function rgb(c) { return Math.round(c[0] * 255) + ", " + Math.round(c[1] * 255) + ", " + Math.round(c[2] * 255); }
  function css(c) { return "rgb(" + rgb(c) + ")"; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  }

  var themeName = "Blue Neon";
  var rainbow = false;
  var rainbowHue = 0;

  // Every theme shares the default theme's background, panels and text; a theme only changes
  // the two accent colours (a1, a2), passed in separately.
  function setVars(t, a1, a2) {
    t = THEMES["Blue Neon"];
    var r = document.documentElement.style;
    var set = function (k, v) { r.setProperty(k, v); };
    set("--bg", css(t.bg)); set("--panel", css(t.panel)); set("--panel2", css(t.panel2));
    set("--text", css(t.text)); set("--muted", css(t.muted));
    set("--a1", css(a1)); set("--a2", css(a2));
    set("--a1-rgb", rgb(a1)); set("--a2-rgb", rgb(a2));
    set("--text-rgb", rgb(t.text)); set("--panel-rgb", rgb(t.panel));
    set("--ok", css(OK)); set("--ok-rgb", rgb(OK)); set("--bad", css(BAD)); set("--warn", css(WARN));
    set("--border", "rgba(" + rgb(t.text) + ", .075)");
    set("--amid", css(mix(a1, a2, .5)));
    set("--sub", css(mix(t.muted, t.text, .2)));
    set("--hovertext", css(mix(t.text, a1, .35)));
    set("--ink", css(mix(t.bg, [0, 0, 0], .4)));
  }

  function motionOk() { return !document.body.classList.contains("reduce"); }

  function themeWave(from, t) {
    if (!motionOk()) return;
    var r = from.getBoundingClientRect(), w = document.createElement("div");
    w.className = "theme-wave";
    w.style.setProperty("--x", (r.left + r.width / 2) + "px");
    w.style.setProperty("--y", (r.top + r.height / 2) + "px");
    w.style.background = "radial-gradient(circle at var(--x) var(--y), rgba(" + rgb(t.a1) + ", .5), rgba(" + rgb(t.a2) + ", .25) 40%, transparent 70%)";
    document.body.appendChild(w);
    setTimeout(function () { w.remove(); }, 900);
  }

  // little spark burst from a button when something finishes
  function sparkBurst(el) {
    if (!el || !motionOk() || document.body.classList.contains("idle")) return;
    var r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (var i = 0; i < 14; i++) {
      var s = document.createElement("i"), a = (i / 14) * Math.PI * 2 + Math.random() * 0.4, d = 34 + Math.random() * 30;
      s.className = "spark";
      s.style.left = cx + "px"; s.style.top = cy + "px";
      s.style.setProperty("--dx", Math.cos(a) * d + "px");
      s.style.setProperty("--dy", Math.sin(a) * d * 0.7 + "px");
      s.style.background = i % 2 ? "var(--a1)" : "var(--a2)";
      s.style.animationDelay = (Math.random() * 0.06) + "s";
      document.body.appendChild(s);
      (function (n) { setTimeout(function () { n.remove(); }, 900); })(s);
    }
  }

  function applyTheme(name, save) {
    if (!THEMES[name]) name = "Blue Neon";
    themeName = name;
    var t = THEMES[name];
    if (!rainbow) setVars(t, t.a1, t.a2);
    $$(".swatch").forEach(function (s) { s.classList.toggle("on", s.dataset.name === name); });
    if (save) host("saveSetting", { key: "themeName", value: name });
  }

  var lastRainbowFrame = 0;
  var rainbowRaf = 0;
  function rainbowLoop(ts) {
    rainbowRaf = 0;
    if (!rainbow) return;
    if (ts - lastRainbowFrame > 33 && !document.body.classList.contains("idle")) {
      lastRainbowFrame = ts;
      rainbowHue = (rainbowHue + 0.0025) % 1;
      setVars(THEMES[themeName], hsv(rainbowHue, .6, 1), hsv(rainbowHue + .14, .68, 1));
    }
    rainbowRaf = requestAnimationFrame(rainbowLoop);
  }

  function setRainbow(on, save) {
    rainbow = on;
    $("#rainbowToggle").checked = on;
    if (rainbowRaf) { cancelAnimationFrame(rainbowRaf); rainbowRaf = 0; }
    if (on) rainbowRaf = requestAnimationFrame(rainbowLoop); else applyTheme(themeName);
    if (save) host("saveSetting", { key: "rainbowMode", value: on ? "true" : "false" });
  }

  function setReduceMotion(on, save) {
    document.body.classList.toggle("reduce", on);
    $("#motionToggle").checked = on;
    if (save) host("saveSetting", { key: "fastMode", value: on ? "true" : "false" });
  }

  // ------------------------------------------------------------------
  // Talking to After Effects
  // ------------------------------------------------------------------
  function extPath() {
    if (!cep) return "";
    var p = decodeURI(cep.getSystemPath("extension"));
    p = p.replace(/^file:\/{2,3}/, "");
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  }
  var EXT = extPath();
  var HOST_FILE = EXT + "/jsx/host.jsx";

  function evalScript(code) {
    return new Promise(function (resolve) {
      if (!cep) return resolve("EvalScript error. (not running inside After Effects)");
      cep.evalScript(code, resolve);
    });
  }

  var LIB_FILE = EXT + "/jsx/library.jsx", CRAFT_FILE = EXT + "/jsx/craft.jsx";
  function loadHost() {
    return evalScript("try{$.evalFile(new File(" + JSON.stringify(HOST_FILE) + "));$.evalFile(new File(" + JSON.stringify(LIB_FILE) +
      "));$.evalFile(new File(" + JSON.stringify(CRAFT_FILE) + "));'ok'}catch(e){'ERR '+e+' line '+e.line}");
  }

  var hostReady = null;
  function ensureHost() {
    if (!hostReady) hostReady = loadHost();
    return hostReady;
  }

  function host(fn, arg) {
    return ensureHost().then(function () {
      var code = "typeof JWPAX==='undefined'?'{\"ok\":false,\"error\":\"host not loaded\"}':JWPAX." + fn + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")";
      return evalScript(code);
    }).then(function (res) {
      var r;
      try { r = JSON.parse(res); } catch (e) { return { ok: false, error: String(res || "No response from After Effects") }; }
      // After a preset is applied, AE twirls the layers open once our script has returned.
      // Give it a moment to do that, then close them in a separate call.
      if (r && r.ok && r.closeLater) setTimeout(function () { host("closeLayers"); }, 150);
      return r;
    });
  }

  // ------------------------------------------------------------------
  // Saved UI state (survives reloads)
  // ------------------------------------------------------------------
  var STORE = "jwpa.ui.v1";
  var ui = { tab: "effect", preset: "", opts: {} };
  try { var saved = JSON.parse(localStorage.getItem(STORE) || "null"); if (saved) ui = Object.assign(ui, saved); } catch (e) {}
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(ui)); } catch (e) {} }

  // ------------------------------------------------------------------
  // Toasts + ripples
  // ------------------------------------------------------------------
  function toast(msg, kind, ms) {
    ms = ms || 2800;
    var el = document.createElement("div");
    el.className = "toast " + (kind || "");
    var TOAST_IC = { ok: "M5 12l5 5L20 7", bad: "M6 6l12 12M18 6L6 18", warn: "M12 4l9 16H3zM12 10v4M12 17h.01" };
    var d = TOAST_IC[kind] || "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z";
    el.innerHTML = '<i class="t-ic"><svg viewBox="0 0 24 24"><path d="' + d + '"/></svg></i><span></span><i class="bar"></i>';
    el.querySelector("span").textContent = msg;
    el.querySelector(".bar").style.animationDuration = ms + "ms";
    var box = $("#toasts");
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, ms);
  }

  document.addEventListener("mousedown", function (e) {
    var b = e.target.closest(".btn");
    if (!b || document.body.classList.contains("reduce")) return;
    var r = b.getBoundingClientRect(), size = Math.max(r.width, r.height);
    var s = document.createElement("span");
    s.className = "ripple";
    s.style.width = s.style.height = size + "px";
    s.style.left = (e.clientX - r.left - size / 2) + "px";
    s.style.top = (e.clientY - r.top - size / 2) + "px";
    b.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
  });

  // ------------------------------------------------------------------
  // Tabs
  // ------------------------------------------------------------------
  var TAB_ORDER = ["home", "tools", "effect", "precomp", "adjustment", "topaz", "layers", "ease", "audio", "settings"];
  var lastTab = "effect";

  // Settings isn't a tab: it opens from the gear, and the tab highlight shrinks away meanwhile.
  function placeIndicator() {
    var active = $(".tab.active"), ind = $("#tabIndicator");
    var gear = $("#gearBtn");
    if (gear) gear.classList.toggle("on", ui.tab === "settings");
    if (!active) { ind.style.opacity = "0"; ind.style.transform += " scaleX(.6)"; return; }
    ind.style.opacity = "1";
    ind.style.width = active.offsetWidth + "px";
    ind.style.transform = "translateX(" + (active.offsetLeft) + "px)";
  }

  function setTab(name, instant) {
    if (TAB_ORDER.indexOf(name) < 0) name = "effect";
    var prev = ui.tab;
    var dir = TAB_ORDER.indexOf(name) >= TAB_ORDER.indexOf(prev) ? "from-right" : "from-left";
    ui.tab = name;
    persist();
    $$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
    $$(".page").forEach(function (p) {
      var on = p.dataset.page === name;
      p.classList.remove("from-left", "from-right");
      if (on && !instant && prev !== name) {
        void p.offsetWidth; // restart the entrance animation
        p.classList.add(dir);
      }
      p.classList.toggle("active", on);
    });
    if (instant) {
      var ind = $("#tabIndicator");
      ind.style.transition = "none";
      placeIndicator();
      void ind.offsetWidth;
      ind.style.transition = "";
    } else {
      placeIndicator();
    }
  }

  $$(".tab").forEach(function (t) { t.addEventListener("click", function () { setTab(t.dataset.tab); }); });
  // gear: open settings, click again to go back to the tab you were on
  $("#gearBtn").addEventListener("click", function () {
    if (ui.tab === "settings") setTab(lastTab || "effect");
    else { lastTab = ui.tab; setTab("settings"); }
  });
  window.addEventListener("resize", placeIndicator);

  // ------------------------------------------------------------------
  // Options (switches, numbers, text, segmented controls)
  // ------------------------------------------------------------------
  function syncNeeds() {
    $$("[data-needs]").forEach(function (el) {
      var src = $('[data-opt="' + el.dataset.needs + '"]');
      el.disabled = !(src && src.checked);
    });
  }

  $$("input[data-opt]").forEach(function (el) {
    var key = el.dataset.opt;
    if (ui.opts[key] !== undefined) {
      if (el.type === "checkbox") el.checked = !!ui.opts[key]; else el.value = ui.opts[key];
    }
    el.addEventListener("change", function () {
      ui.opts[key] = el.type === "checkbox" ? el.checked : el.value;
      persist();
      syncNeeds();
    });
  });

  $$(".seg[data-opt]").forEach(function (seg) {
    var key = seg.dataset.opt;
    var btns = $$("button", seg);
    function select(val) {
      btns.forEach(function (b) { b.classList.toggle("on", b.dataset.val === val); });
      ui.opts[key] = val;
    }
    if (ui.opts[key]) select(ui.opts[key]);
    btns.forEach(function (b) { b.addEventListener("click", function () { select(b.dataset.val); persist(); }); });
  });
  syncNeeds();

  function opt(key) {
    var el = $('[data-opt="' + key + '"]');
    if (!el) return undefined;
    if (el.classList.contains("seg")) { var on = $("button.on", el); return on ? on.dataset.val : ""; }
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number") return parseFloat(el.value);
    return el.value;
  }

  // ------------------------------------------------------------------
  // Preset + favorites
  // ------------------------------------------------------------------
  var favorites = [];
  var sets = {};                 // favorites folders: name -> [preset paths]
  var currentSet = ui.set || ""; // "" = all favorites

  // Tiny event hub so extras.js can react (log, intensity slider, previews).
  var listeners = [];
  function emit(type, data) { listeners.forEach(function (fn) { try { fn(type, data); } catch (e) {} }); }

  function baseName(p) { return String(p).split(/[\\/]/).pop(); }

  function visibleFavs() {
    if (currentSet && sets[currentSet]) return sets[currentSet].slice();
    return favorites;
  }

  function renderSets() {
    var sel = $("#setSelect"), dl = $("#setNames");
    sel.innerHTML = "";
    dl.innerHTML = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "All favorites (" + favorites.length + ")";
    sel.appendChild(all);
    Object.keys(sets).sort().forEach(function (name) {
      var o = document.createElement("option");
      o.value = name;
      o.textContent = name + " (" + sets[name].length + ")";
      sel.appendChild(o);
      var d = document.createElement("option");
      d.value = name;
      dl.appendChild(d);
    });
    if (currentSet && !sets[currentSet]) currentSet = "";
    sel.value = currentSet;
    $("#setRemoveBtn").style.display = currentSet ? "" : "none";
  }

  function saveSets() { host("saveSetting", { key: "favoriteSets", value: JSON.stringify(sets) }); }

  function renderFavorites() {
    renderSets();
    var sel = $("#favSelect"), list = visibleFavs();
    sel.innerHTML = "";
    if (!list.length) {
      var o = document.createElement("option");
      o.textContent = currentSet ? "This folder is empty" : "No favorites yet";
      sel.appendChild(o);
      sel.disabled = true;
    } else {
      sel.disabled = false;
      list.forEach(function (p, i) {
        var o = document.createElement("option");
        o.value = p;
        o.textContent = baseName(p).replace(/\.ffx$/i, "");
        sel.appendChild(o);
        if (p === ui.preset) sel.selectedIndex = i;
      });
    }
    emit("favorites", { all: favorites });
  }

  $("#setSelect").addEventListener("change", function (e) {
    currentSet = e.target.value;
    ui.set = currentSet;
    persist();
    renderFavorites();
    var list = visibleFavs();
    if (list.length && list.indexOf(ui.preset) < 0) setPreset(list[0], true);
  });

  function showSetAdd(on) {
    $("#setAdd").classList.toggle("open", on);
    $(".set-row").classList.toggle("adding", on);
    $("#setAddBtn").style.display = on ? "none" : "";
    if (on) { $("#setName").value = currentSet || ""; $("#setName").focus(); $("#setName").select(); }
  }
  $("#setAddBtn").addEventListener("click", function () {
    if (!ui.preset) return toast("Pick a preset first", "warn", 2000);
    showSetAdd(true);
  });
  $("#setCancel").addEventListener("click", function () { showSetAdd(false); });
  function saveToSet() {
    var name = $("#setName").value.trim().slice(0, 30);
    if (!name) return;
    sets[name] = sets[name] || [];
    if (sets[name].indexOf(ui.preset) < 0) sets[name].push(ui.preset);
    saveSets();
    showSetAdd(false);
    renderFavorites();
    toast(baseName(ui.preset).replace(/\.ffx$/i, "") + " \u2192 " + name, "ok", 1800);
  }
  $("#setSave").addEventListener("click", saveToSet);
  $("#setName").addEventListener("keydown", function (e) {
    if (e.key === "Enter") saveToSet();
    if (e.key === "Escape") showSetAdd(false);
    e.stopPropagation(); // don't trigger panel hotkeys while typing
  });
  $("#setRemoveBtn").addEventListener("click", function () {
    if (!currentSet || !sets[currentSet]) return;
    var list = sets[currentSet], i = list.indexOf(ui.preset);
    if (i < 0) return toast("The current preset isn't in this folder", "warn", 2000);
    list.splice(i, 1);
    var gone = currentSet;
    if (!list.length) { delete sets[currentSet]; currentSet = ""; ui.set = ""; persist(); }
    saveSets();
    renderFavorites();
    toast("Removed from " + gone, "", 1600);
  });

  function setPreset(path, flash) {
    ui.preset = path || "";
    persist();
    var field = $("#presetField");
    if (!path) {
      $("#presetName").textContent = "No preset selected";
      $("#presetPath").textContent = "Browse or drop an .ffx file";
      field.classList.remove("loaded");
      return;
    }
    $("#presetName").textContent = baseName(path).replace(/\.ffx$/i, "");
    $("#presetPath").textContent = path;
    field.title = path;
    field.classList.add("loaded");
    if (flash) { field.classList.remove("flash"); void field.offsetWidth; field.classList.add("flash"); }
    var sel = $("#favSelect");
    var idx = visibleFavs().indexOf(path);
    if (idx >= 0) sel.selectedIndex = idx;
    emit("preset", { path: path });
  }

  function addFavorite(path) {
    return host("addFavorite", { path: path }).then(function (r) {
      if (r.ok) { favorites = r.favorites; renderFavorites(); }
      setPreset(path, true);
    });
  }

  $("#browseBtn").addEventListener("click", function () {
    host("browse").then(function (r) {
      if (!r.ok) return toast(r.error, "bad");
      if (!r.path) return;
      favorites = r.favorites || favorites;
      renderFavorites();
      setPreset(r.path, true);
      toast("Loaded " + baseName(r.path), "ok", 1800);
    });
  });

  $("#favSelect").addEventListener("change", function (e) { setPreset(e.target.value, true); });

  function stepFav(dir) {
    var list = visibleFavs();
    if (!list.length) return;
    var i = list.indexOf(ui.preset);
    if (i < 0) i = dir > 0 ? 0 : list.length - 1;
    else i = (i + dir + list.length) % list.length;
    setPreset(list[i], true);
  }
  $("#favPrev").addEventListener("click", function () { stepFav(-1); });
  $("#favNext").addEventListener("click", function () { stepFav(1); });

  $("#favClear").addEventListener("click", function () {
    host("setFavorites", { list: [] }).then(function () {
      favorites = [];
      renderFavorites();
      toast("Favorites cleared", "warn", 1800);
    });
  });

  // Drag an .ffx from Explorer onto the preset field
  var field = $("#presetField");
  ["dragenter", "dragover"].forEach(function (ev) {
    field.addEventListener(ev, function (e) { e.preventDefault(); field.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    field.addEventListener(ev, function (e) { e.preventDefault(); field.classList.remove("drag"); });
  });
  field.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    var p = f && (f.path || "");
    if (!p) return toast("Couldn't read the dropped file", "bad");
    if (!/\.ffx$/i.test(p)) return toast("That's not an .ffx preset", "warn");
    addFavorite(p).then(function () { toast("Loaded " + baseName(p), "ok", 1800); });
  });
  document.addEventListener("dragover", function (e) { e.preventDefault(); });
  document.addEventListener("drop", function (e) { e.preventDefault(); });

  // ------------------------------------------------------------------
  // Running actions
  // ------------------------------------------------------------------
  var busy = false;

  function runCard(name) { return $('[data-run="' + name + '"]'); }

  function setRunState(name, state, text) {
    var card = runCard(name);
    var btn = $(".primary", card), bar = $(".progress", card), status = $(".run-status", card);
    btn.classList.toggle("busy", state === "busy");
    bar.classList.remove("indeterminate", "done");
    status.classList.remove("ok", "bad");
    if (state === "busy") bar.classList.add("indeterminate");
    if (state === "ok") {
      void bar.offsetWidth;
      bar.classList.add("done");
      status.classList.add("ok");
      btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done");
    }
    if (state === "bad") status.classList.add("bad");
    status.textContent = text;
  }

  // Label colors for newly created precomps / adjustment layers (the plan comes from extras.js)
  function withLabels(kind, o) {
    var plan = window.JWPA && window.JWPA.labelPlan ? window.JWPA.labelPlan(kind) : null;
    if (plan) { o.labels = plan.labels; o.labelStart = plan.start; }
    return o;
  }
  function labelsUsed(kind, n) { if (window.JWPA && window.JWPA.labelUsed) window.JWPA.labelUsed(kind, n); }

  // " · 0.4s (preset 0.3s)": total time, and the slowest step when it's most of it
  function timingText(t) {
    if (!t || !(t.total >= 0)) return "";
    var s = function (ms) { return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s"; };
    var names = { preset: "AE applying the preset", keys: "stretching keys", tidy: "closing layers", prep: "reading layers" };
    var worst = "", max = 0;
    for (var k in names) if (t[k] > max) { max = t[k]; worst = k; }
    return " · " + s(t.total) + (t.total >= 500 && max > t.total * 0.5 ? " (mostly " + names[worst] + ")" : "");
  }

  var ACTIONS = {
    effect: function (extra) {
      extra = extra || {};
      var presetB = "";
      if (opt("eff.alternate")) {
        presetB = $("#altSelect").value || "";
        if (!presetB) return Promise.resolve({ ok: false, error: "Pick the second preset to alternate with." });
      }
      return host("applyEffect", {
        preset: ui.preset, presetB: presetB, stretch: opt("eff.stretch"), preserve: opt("eff.preserve"), onlyNew: opt("eff.onlyNew"),
        keepSel: opt("eff.keepSel"), twixtor: opt("eff.twixtor"), fps: opt("eff.fps"), quick: !!extra.quick,
        closeLayers: opt("eff.closeLayers") !== false
      }).then(function (r) {
        if (!r.ok) return r;
        r.msg = "Applied to " + r.count + " layer" + (r.count === 1 ? "" : "s") + (r.alternated ? " (alternating)" : "") +
          (opt("eff.twixtor") ? " \u00B7 Twixtor FPS on " + r.twixtor : "") + timingText(r.timing);
        if (r.timing && window.console) console.log("applyEffect timing (ms)", JSON.stringify(r.timing));
        return r;
      });
    },
    precomp: function () {
      return host("precompose", withLabels("pre", {
        name: opt("pre.name"), together: opt("pre.mode") === "together", moveAll: opt("pre.attrs") === "move",
        trim: opt("pre.trim"), keepSel: opt("pre.keepSel"), smartNames: opt("pre.smartNames")
      })).then(function (r) {
        if (!r.ok) return r;
        labelsUsed("pre", r.count);
        r.msg = "Created " + r.count + " precomp" + (r.count === 1 ? "" : "s");
        if (r.forcedMoveAll) toast("Grouping needs \u201CMove all attributes\u201D, so that was used", "warn", 3600);
        return r;
      });
    },
    adjustment: function () {
      return host("adjust", withLabels("adj", {
        preset: ui.preset, name: opt("adj.name"), stretch: opt("adj.stretch"), preserve: opt("adj.preserve"),
        keepSel: opt("adj.keepSel"), selectNew: opt("adj.selectNew"), blackSolid: opt("adj.blackSolid"),
        twixtor: opt("adj.twixtor"), fps: opt("adj.fps"), single: opt("adj.single"),
        closeLayers: opt("eff.closeLayers") !== false
      })).then(function (r) {
        if (!r.ok) return r;
        labelsUsed("adj", r.count);
        r.msg = "Created " + r.count + (r.blackSolid ? " black solid" : " adjustment layer") + (r.count === 1 ? "" : "s");
        return r;
      });
    }
  };

  // After Effects sometimes answers "EvalScript error" when it is busy for a split second
  // (e.g. right after the Ctrl+Space popup hands focus back): such a hiccup is retried once.
  var HICCUP = /EvalScript error|No response from After Effects|host not loaded/i;

  function runActionNow(name, btn, extra) {
    busy = true;
    setRunState(name, "busy", "Working\u2026");
    var started = Date.now();
    var attempt = function (n) {
      return ACTIONS[name](extra).then(function (r) {
        if (!r.ok && n === 1 && HICCUP.test(String(r.error || ""))) {
          return new Promise(function (res) { setTimeout(res, 450); }).then(function () { return attempt(2); });
        }
        return r;
      });
    };
    attempt(1).then(function (r) {
        // keep the loading state visible for a moment so quick jobs still feel responsive
        var wait = 0; // show the result as soon as After Effects is done
        setTimeout(function () {
          busy = false;
          if (r.ok) {
            sparkBurst(btn);
            setRunState(name, "ok", "Done \u00B7 " + r.msg);
            toast(r.msg, "ok");
            if (r.favorites) { favorites = r.favorites; renderFavorites(); setPreset(ui.preset); }
          } else {
            setRunState(name, "bad", r.error);
            toast(r.error, "bad", 3600);
          }
          emit("action", { name: name, ok: r.ok, msg: r.ok ? r.msg : r.error, result: r, preset: ui.preset });
          pollSelection();
        }, wait);
      });
  }

  $$("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (busy) return;
      runActionNow(btn.dataset.action, btn);
    });
  });

  // for Ctrl+Space: waits (up to 6 s) for anything still running instead of being ignored
  function runActionWhenFree(name, extra) {
    var btn = $('[data-action="' + name + '"]'), until = Date.now() + 6000;
    if (!btn) return;
    (function go() {
      if (!busy) return runActionNow(name, btn, extra);
      if (Date.now() < until) setTimeout(go, 120);
      else toast("Still busy with the last action \u00B7 try again in a moment", "warn", 2600);
    })();
  }

  // ------------------------------------------------------------------
  // Small tools (buttons with data-tool)
  // ------------------------------------------------------------------
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  var TOOLS = {
    // Two steps: click with the source layer selected (it's remembered), then select the layers
    // to paste onto and click again. With several layers selected at once, the first one you
    // selected is the source and it copies straight away.
    copyEffects: function () {
      var paste = function (source) {
        return host("copyEffects", { stretch: opt("fx.copyStretch"), replace: opt("fx.copyReplace"), source: source }).then(function (r) {
          if (!r.ok) return r;
          setCopySource(null);
          r.msg = "Copied " + r.source + "'s effects to " + plural(r.targets, "layer");
          if (r.failed && r.failed.length) toast("Couldn't copy: " + r.failed.join(", "), "warn", 5000);
          return r;
        });
      };
      if (copySource) return paste(copySource);
      return host("copySource").then(function (s) {
        if (!s.ok) return s;
        if (s.more) return paste(null);
        setCopySource(s);
        return { ok: true, msg: "Source: " + s.name + " (" + plural(s.effects, "effect") + ") · now select the layers to paste onto and click again" };
      });
    },
    fixRipple: function () {
      return host("fixRipple").then(function (r) {
        if (!r.ok) return r;
        r.msg = "Rebuilt " + plural(r.rebuilt, "Ripple Dissolve") + " on " + plural(r.layers, "layer") + (r.reveals ? " · fixed " + plural(r.reveals, "Layer to Reveal") : "");
        return r;
      });
    },
    stripLast: function () {
      return host("stripEffects", { mode: "last" }).then(function (r) {
        if (!r.ok) return r;
        r.msg = r.removed ? "Removed " + plural(r.removed, "effect") + " from " + plural(r.layers, "layer") : "Nothing from the last preset on these layers";
        return r;
      });
    },
    stripAll: function () {
      return host("stripEffects", { mode: "all" }).then(function (r) {
        if (!r.ok) return r;
        r.msg = r.removed ? "Removed " + plural(r.removed, "effect") + " \u00B7 Ctrl+Z to undo" : "No effects to remove";
        return r;
      });
    },
    sequence: function () {
      return host("sequence", { overlap: opt("tl.overlap") }).then(function (r) {
        if (!r.ok) return r;
        r.msg = "Sequenced " + plural(r.count, "clip") + (opt("tl.overlap") > 0 ? " with " + opt("tl.overlap") + "f overlap" : "");
        return r;
      });
    },
    splitMarkers: function () {
      return host("splitAtMarkers", { useComp: opt("tl.compMarkers") }).then(function (r) {
        if (!r.ok) return r;
        if (!r.layers) return { ok: false, error: "No markers inside the selected clips" + (opt("tl.compMarkers") ? "" : " (comp markers are off)") };
        r.msg = "Split " + plural(r.layers, "clip") + " into " + plural(r.pieces, "piece");
        return r;
      });
    },
    workArea: function () {
      return host("workArea").then(function (r) {
        if (!r.ok) return r;
        r.msg = "Work area set (" + r.seconds + "s)";
        return r;
      });
    },
    flashCuts: function () {
      return host("flashCuts", { frames: opt("fl.frames"), color: opt("fl.color"), includeFirst: opt("fl.first") }).then(function (r) {
        if (!r.ok) return r;
        r.msg = "Added " + plural(r.count, "flash") + " (" + r.frames + "f)";
        return r;
      });
    },
    saveComp: function () {
      return host("saveCompAlone").then(function (r) {
        if (!r.ok) return r;
        if (r.cancelled) return { ok: false, error: "Save comp cancelled" };
        r.msg = "Saved " + r.name + " on its own (" + plural(r.items, "item") + ") to " + r.file;
        return r;
      });
    },
    cutJoins: function () {
      return host("cutJoins", { frames: opt("cj.frames"), side: opt("cj.side") }).then(function (r) {
        if (!r.ok) return r;
        r.msg = "Split " + r.frames + "f at " + plural(r.joins, "join") + " · no frame blending on the cut pieces";
        return r;
      });
    }
  };

  // remembered source for Copy effects (cleared after pasting, or with the x)
  var copySource = null;
  function setCopySource(s) {
    copySource = s;
    var btn = $('[data-tool="copyEffects"]');
    if (!btn) return;
    btn.classList.toggle("armed", !!s);
    btn.innerHTML = s ? 'Paste effects from <b></b> onto selected<i class="tool-x" title="Cancel">✕</i>' : "Copy effects";
    if (s) btn.querySelector("b").textContent = s.name;
    btn.title = s ? "Select the layers to paste onto, then click" : "Select the layer with the effects and click, then select the layers to paste onto and click again";
  }
  document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("tool-x")) { e.stopPropagation(); setCopySource(null); }
  }, true);
  setCopySource(null);

  $$("[data-tool]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var fn = TOOLS[btn.dataset.tool];
      if (!fn || btn.classList.contains("busy")) return;
      btn.classList.add("busy");
      fn().then(function (r) {
        btn.classList.remove("busy");
        emit("action", { name: btn.dataset.tool, ok: r.ok, msg: r.ok ? r.msg : r.error, result: r });
        if (!r.ok) return toast(r.error, "bad", 3600);
        btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done");
        sparkBurst(btn);
        toast(r.msg, "ok", 2600);
        pollSelection();
      });
    });
  });

  // ------------------------------------------------------------------
  // Scene Cut Fixer (Quality tab)
  // ------------------------------------------------------------------
  if ($("#scFix")) $("#scFix").addEventListener("click", function () {
    var btn = $("#scFix"), status = $("#scStatus");
    if (btn.classList.contains("busy")) return;
    btn.classList.add("busy");
    status.className = "run-status";
    var tol = Math.max(1, Math.min(12, Math.round(opt("sc.tol") || 2)));
    var mode = opt("sc.mode") || "auto";
    if (mode === "auto") return autoFixGaps(tol, btn, status);
    host("fixSceneGaps", { tolerance: tol, fill: mode, overlaps: opt("sc.overlaps") }).then(function (r) {
      btn.classList.remove("busy");
      if (!r.ok) { status.textContent = r.error; status.className = "run-status bad"; return toast(r.error, "bad", 3600); }
      var parts = [];
      if (r.gaps) parts.push(r.gaps + " gap" + (r.gaps === 1 ? "" : "s") + " (" + r.gapFrames + "f)");
      if (r.overlaps) parts.push(r.overlaps + " overlap" + (r.overlaps === 1 ? "" : "s") + " (" + r.overlapFrames + "f)");
      var msg = parts.length ? "Fixed " + parts.join(" + ") : "No small gaps found";
      status.textContent = msg;
      status.className = "run-status " + (parts.length ? "ok" : "");
      if (parts.length) { btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done"); }
      toast(msg + (r.bigGaps ? " \u00B7 left " + r.bigGaps + " bigger gap" + (r.bigGaps === 1 ? "" : "s") + " alone" : ""), parts.length ? "ok" : "", 3200);
      if (r.blocked && r.blocked.length) toast("Couldn't close " + r.blocked.length + " gap(s): clips are at the end of their footage", "warn", 5000);
      emit("action", { name: "fixGaps", ok: true, msg: msg, result: r });
    });
  });

  // Auto mode: read the frames around every gap and put the cut where the shot changes.
  // If a gap can't be read (precomps, different files, no clear change) the
  // "extend previous" rule is used for that one gap instead.
  function fallbackCut(pair) {
    var lo = pair.b.limits.minIn, hi = pair.a.limits.maxOut;
    if (hi < lo - 1e-6) return null;
    var want = pair.frames > 0 ? pair.bIn : pair.aOut; // gap: extend previous; overlap: trim the next clip
    return Math.max(lo, Math.min(hi, want));
  }

  function autoFixGaps(tol, btn, status) {
    var SC = window.JWPA_SceneCut, ff = SC ? SC.findFfmpeg() : "";
    function finish(text, kind, toastKind) {
      btn.classList.remove("busy");
      status.textContent = text;
      status.className = "run-status " + (kind || "");
      toast(text, toastKind || kind || "", 3600);
    }
    status.textContent = "Looking at the cuts\u2026";
    host("sceneGapPlan", { tolerance: tol, overlaps: opt("sc.overlaps") }).then(function (plan) {
      if (!plan.ok) return finish(plan.error, "bad");
      if (!plan.pairs.length) return finish("No small gaps found" + (plan.bigGaps ? " \u00B7 left " + plan.bigGaps + " bigger gap(s) alone" : ""), "");
      if (!ff) toast("ffmpeg not found \u00B7 using \u201Cextend previous\u201D for every gap", "warn", 4000);

      var results = [], chain = Promise.resolve();
      plan.pairs.forEach(function (pair, i) {
        chain = chain.then(function () {
          status.textContent = "Reading frames " + (i + 1) + " / " + plan.pairs.length + "\u2026";
          return (SC ? SC.analyze(ff, pair, plan.fd, tol) : Promise.resolve({ cut: null, how: "fallback" }))
            .then(function (r) { results.push(r); }, function () { results.push({ cut: null, how: "fallback" }); });
        });
      });

      return chain.then(function () {
        var cuts = [], moved = 0, closed = 0, byRule = 0, unsure = 0, blockedGaps = 0, eps = plan.fd * 0.01;
        plan.pairs.forEach(function (pair, i) {
          var r = results[i], cut = r.cut;
          var touching = pair.frames === 0;
          if (cut === null) {
            if (touching) { unsure++; return; }   // a normal cut we can't read: leave it alone
            cut = fallbackCut(pair);
            if (cut === null) { blockedGaps++; return; }
            byRule++;
          }
          if (Math.abs(cut - pair.aOut) < eps && Math.abs(cut - pair.bIn) < eps) return; // already right
          if (touching) moved++; else closed++;
          cuts.push({ a: pair.a.ref, b: pair.b.ref, aName: pair.a.name, bName: pair.b.name, cut: cut });
        });
        if (!cuts.length) {
          return finish("All " + plan.pairs.length + " cut" + (plan.pairs.length === 1 ? "" : "s") + " look right" +
            (unsure ? " \u00B7 " + unsure + " couldn't be checked" : ""), "ok");
        }
        return host("applySceneCuts", { cuts: cuts }).then(function (ap) {
          if (!ap.ok) return finish(ap.error, "bad");
          var bits = [];
          if (moved) bits.push("moved " + moved + " cut" + (moved === 1 ? "" : "s") + " to the real shot change");
          if (closed) bits.push("closed " + closed + " gap" + (closed === 1 ? "" : "s") + (byRule ? " (" + byRule + " by rule)" : ""));
          var text = ap.done ? "Fixed: " + bits.join(", ") : "Nothing could be fixed";
          finish(text, ap.done ? "ok" : "", ap.done ? "ok" : "warn");
          if (ap.done) { btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done"); }
          var blocked = (ap.blocked || []).length + blockedGaps;
          if (blocked) toast(blocked + " cut(s) couldn't move: a clip is at the end of its footage", "warn", 5000);
          if (unsure) toast(unsure + " cut(s) couldn't be checked (precomps, different files, or no clear change)", "", 4000);
          emit("action", { name: "fixGaps", ok: true, msg: text });
        });
      });
    }).catch(function (e) { finish("Failed: " + (e.message || e), "bad"); });
  }

  // ------------------------------------------------------------------
  // Live selected-layer count
  // ------------------------------------------------------------------
  var lastCount = -1;
  function pollSelection() {
    if (busy || document.hidden) return;
    host("selection").then(function (r) {
      if (!r.ok || r.count === lastCount) return;
      lastCount = r.count;
      $$(".sel-badge").forEach(function (badge) {
        var b = $(".sel-count", badge);
        b.textContent = r.count;
        badge.classList.toggle("zero", r.count === 0);
        b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
      });
    });
  }
  // ------------------------------------------------------------------
  // Collapsible sections: click a card title to fold it; remembered per section
  // ------------------------------------------------------------------
  (function () {
    var FOLDED_BY_DEFAULT = ["Label Colors", "Smart Scene Detect", "Recent Actions", "Doomscroll", "Hotkeys", "Panel", "Effect Preview"];
    var CHEV = '<svg class="fold-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    $$(".page > .card").forEach(function (card) {
      var title = null;
      for (var i = 0; i < card.children.length; i++) if (card.children[i].classList.contains("card-title")) title = card.children[i];
      if (!title || card.id === "presetCard") return;
      var page = card.parentNode.dataset.page || "", name = title.textContent.trim();
      var key = "fold." + page + "." + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      card.classList.add("foldable");
      title.insertAdjacentHTML("beforeend", CHEV);
      title.title = "Click to fold / unfold";
      var stored = ui.opts[key];
      if (stored === undefined ? FOLDED_BY_DEFAULT.indexOf(name) >= 0 : stored) card.classList.add("collapsed");
      title.addEventListener("click", function () {
        var folded = !card.classList.contains("collapsed");
        var from = card.offsetHeight;
        card.classList.toggle("collapsed", folded);
        card.classList.remove("unfold");
        if (!folded) { void card.offsetWidth; card.classList.add("unfold"); }
        ui.opts[key] = folded; persist();
        if (document.body.classList.contains("reduce")) return;
        var to = card.offsetHeight;
        card.style.height = from + "px"; card.style.overflow = "hidden";
        void card.offsetWidth;
        card.style.transition = "height .32s cubic-bezier(.2, .8, .2, 1)";
        card.style.height = to + "px";
        setTimeout(function () { card.style.height = ""; card.style.overflow = ""; card.style.transition = ""; }, 340);
      });
    });
  })();

  // ------------------------------------------------------------------
  // Turbo AE: speed settings that never change quality (see host.jsx api.turbo)
  // ------------------------------------------------------------------
  (function () {
    var t = $("#turboToggle"), info = $("#turboInfo");
    if (!t) return;
    // Turbo is off at every start: running on all CPU cores made AE unstable
    if (ui.opts["turbo.on"]) { ui.opts["turbo.on"] = false; persist(); }
    t.checked = false;
    function say(r, on) {
      if (!r.ok) return toast(r.error, "bad", 4000);
      var bits = [on ? "Turbo on" : "Turbo off · your old settings are back"];
      if (on) bits.push("renderer: " + (r.gpu === "CUDA" ? "graphics card" : r.gpu));
      (r.notes || []).forEach(function (n) { bits.push(n); });
      toast(bits.join(" · "), "ok", 4200);
      if (on && r.changed) info.textContent = "On. Some settings (all CPU cores, idle caching) fully kick in after the next After Effects restart.";
    }
    t.addEventListener("change", function () {
      ui.opts["turbo.on"] = t.checked; persist();
      host("turbo", { on: t.checked }).then(function (r) { say(r, t.checked); });
    });
  })();

  // ------------------------------------------------------------------
  // Idle mode: when you're working in After Effects (mouse not on this panel), ask AE less
  // often and pause the decorative animations, so the panel costs next to nothing.
  // ------------------------------------------------------------------
  var lastActive = Date.now(), pointerIn = false, idle = false;
  function setIdle(v) {
    if (v === idle) return;
    idle = v;
    document.body.classList.toggle("idle", v);
    emit("idle", v);
  }
  function wake() {
    lastActive = Date.now();
    if (idle) { setIdle(false); pollSelection(); }
  }
  document.documentElement.addEventListener("mouseenter", function () { pointerIn = true; wake(); });
  document.documentElement.addEventListener("mouseleave", function () { pointerIn = false; lastActive = Date.now(); });
  ["mousemove", "mousedown", "keydown", "wheel", "focusin"].forEach(function (t) { document.addEventListener(t, wake, true); });
  window.addEventListener("focus", wake);
  var pollTick = 0;
  setInterval(function () {
    var active = pointerIn || document.hasFocus() || Date.now() - lastActive < 4000;
    setIdle(!active && Date.now() - lastActive > 2500);
    pollTick++;
    // 650 ms while you use the panel, ~5 s while you edit elsewhere
    if (active || pollTick % 8 === 0) pollSelection();
  }, 650);

  // ------------------------------------------------------------------
  // Settings page
  // ------------------------------------------------------------------
  Object.keys(THEMES).forEach(function (name) {
    var t = THEMES[name];
    var b = document.createElement("button");
    b.className = "swatch";
    b.dataset.name = name;
    b.title = name;
    b.style.background = "linear-gradient(135deg, " + css(t.a1) + ", " + css(t.a2) + ")";
    b.style.setProperty("--sw", css(t.a1));
    b.addEventListener("click", function () {
      if (rainbow) setRainbow(false, true);
      themeWave(b, t);
      applyTheme(name, true);
    });
    $("#swatches").appendChild(b);
  });

  $("#rainbowToggle").addEventListener("change", function (e) { setRainbow(e.target.checked, true); });
  $("#motionToggle").addEventListener("change", function (e) { setReduceMotion(e.target.checked, true); });
  $("#reloadBtn").addEventListener("click", function () { safeReload(); });
  $("#resetBtn").addEventListener("click", function () {
    setRainbow(false, true);
    setReduceMotion(false, true);
    applyTheme("Blue Neon", true);
    if (ui.opts["turbo.on"]) host("turbo", { on: false });
    ui.opts = {};
    persist();
    toast("Settings reset", "ok", 1600);
    setTimeout(function () { safeReload(); }, 700);
  });

  // ------------------------------------------------------------------
  // Live reload: watch this extension's folder
  // ------------------------------------------------------------------
  // Reloading the page would orphan running Topaz jobs, so wait until they finish.
  var reloadPending = false;
  function safeReload() {
    var t = window.JWPA && window.JWPA.topazBusy && window.JWPA.topazBusy();
    if (!t) { location.reload(); return; }
    if (!reloadPending) toast("Update ready \u00B7 reloading after the Topaz job finishes", "", 3000);
    reloadPending = true;
  }

  function startWatcher() {
    if (!fs || !EXT) {
      $("#reloadInfo").textContent = "Live reload needs Node.js, which isn't available here. Use Reload Now.";
      return;
    }
    var timer = null, pending = {};
    try {
      fs.watch(EXT, { recursive: true }, function (ev, file) {
        if (!file) return;
        file = String(file).replace(/\\/g, "/");
        if (/(^|\/)\./.test(file) || /~$/.test(file)) return;
        pending[file] = true;
        clearTimeout(timer);
        timer = setTimeout(function () {
          var files = Object.keys(pending);
          pending = {};
          var page = files.some(function (f) { return /\.(html|js)$/i.test(f); });
          var styles = files.some(function (f) { return /\.css$/i.test(f); });
          var jsx = files.some(function (f) { return /\.jsx$/i.test(f); });
          var manifest = files.some(function (f) { return /manifest\.xml$/i.test(f); });
          if (page) { safeReload(); return; }
          if (styles) {
            $$('link[rel="stylesheet"]').forEach(function (l) { l.href = l.href.replace(/\?.*$/, "") + "?t=" + Date.now(); });
            toast("Styles reloaded", "", 1400);
          }
          if (jsx) {
            hostReady = loadHost();
            hostReady.then(function (r) {
              if (/^ERR/.test(r)) toast("Host script error: " + r.slice(4), "bad", 6000);
              else toast("After Effects script reloaded", "", 1600);
            });
          }
          if (manifest) toast("Manifest changed \u00B7 close and reopen the panel to apply", "warn", 5000);
        }, 250);
      });
      $("#reloadInfo").textContent = "Watching this extension's folder \u00B7 saved changes apply instantly.";
    } catch (e) {
      $("#reloadInfo").textContent = "Live reload unavailable: " + e.message;
    }
  }

  // ------------------------------------------------------------------
  // Startup
  // ------------------------------------------------------------------
  applyTheme(themeName);
  setTab(ui.tab, true);
  requestAnimationFrame(function () { setTab(ui.tab, true); });

  ensureHost().then(function (r) {
    if (/^ERR/.test(r)) toast("Host script error: " + r.slice(4), "bad", 8000);
    return host("getState");
  }).then(function (s) {
    if (!s.ok) { toast(s.error, "bad", 6000); return; }
    favorites = s.favorites || [];
    try { sets = JSON.parse(s.sets || "{}") || {}; } catch (e) { sets = {}; }
    renderFavorites();
    if (ui.preset && favorites.indexOf(ui.preset) >= 0) setPreset(ui.preset);
    else if (ui.preset) setPreset(ui.preset);
    applyTheme(s.theme);
    if (s.rainbow) setRainbow(true);
    if (s.fast) setReduceMotion(true);
    return host("ping");
  }).then(function (p) {
    if (p && p.ok) $("#versionInfo").textContent = "Version 1.0 \u00B7 After Effects " + p.version;
  });

  renderFavorites();
  startWatcher();
  pollSelection();

  // Shared with topaz.js
  window.JWPA = {
    host: host,
    toast: toast,
    store: { get: function (k, d) { return ui.opts[k] === undefined ? d : ui.opts[k]; }, set: function (k, v) { ui.opts[k] = v; persist(); } },
    jobFinished: function () { if (reloadPending && !(window.JWPA.topazBusy && window.JWPA.topazBusy())) location.reload(); },
    topazBusy: null,
    // used by extras.js
    on: function (fn) { listeners.push(fn); },
    emit: emit,
    opt: opt,
    ui: function () { return ui; },
    favorites: function () { return favorites; },
    sets: function () { return sets; },
    extPath: function () { return EXT; },
    setPreset: function (p) { setPreset(p, true); },
    // runs a tab's main action exactly like clicking its button
    runAction: function (name, extra) { runActionWhenFree(name, extra); },
    baseName: baseName,
    setTab: setTab,
    stepFav: stepFav,
    busy: function () { return busy; },
    themes: THEMES,
    css: css,
    applyTheme: function (name, save) { if (rainbow) setRainbow(false, true); applyTheme(name, save); },
    themeName: function () { return themeName; }
  };

  // ------------------------------------------------------------------
  // Doomscroll: TikTok in its own dockable panel (part of this extension bundle)
  // ------------------------------------------------------------------
  function scrollPanelId() {
    try { return cep.getExtensionId().replace(/\.panel$/, "") + ".scroll"; } catch (e) { return ""; }
  }
  var so = $("#scrollOpen"), sb = $("#scrollBrowser");
  // After Effects only learns about new panels when it starts, so check it's actually loaded.
  function scrollPanelLoaded(id) {
    try {
      var list = JSON.parse(cep.getExtensions(JSON.stringify([id])) || "[]");
      return list.some(function (x) { return x.id === id; });
    } catch (e) { return true; } // can't tell: just try to open it
  }
  if (so) so.addEventListener("click", function () {
    var id = scrollPanelId();
    if (!id || !scrollPanelLoaded(id)) {
      toast("Restart After Effects once to finish adding the TikTok panel (or use Open in browser)", "warn", 6000);
      return;
    }
    try { cep.requestOpenExtension(id, ""); toast("Opening TikTok panel · dock it wherever you like", "", 2600); }
    catch (e) { toast("Couldn't open the TikTok panel · try Window › Extensions › JW Scroll", "bad", 4000); }
  });
  if (sb) sb.addEventListener("click", function () {
    try { window.cep.util.openURLInDefaultBrowser("https://www.tiktok.com/foryou"); } catch (e) { window.open("https://www.tiktok.com/foryou"); }
  });
  emit("ready", {});
})();
