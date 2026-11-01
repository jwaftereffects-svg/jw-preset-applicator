/* JW Preset Applicator Pro - extras:
 * preset preview, intensity slider, alternate preset picker, hotkeys, recent actions log
 */
(function () {
  "use strict";

  var J = window.JWPA;
  if (!J) return;
  var $ = function (s) { return document.querySelector(s); };
  var nodeOk = typeof require === "function";
  var fs = nodeOk ? require("fs") : null, path = nodeOk ? require("path") : null, crypto = nodeOk ? require("crypto") : null;

  function presetLabel(p) { return p ? J.baseName(p).replace(/\.ffx$/i, "") : ""; }

  // ------------------------------------------------------------------
  // Recent actions log (kept in this panel's storage)
  // ------------------------------------------------------------------
  var LOG_KEY = "jwpa.log.v1", LOG_MAX = 40;
  var logItems = [];
  try { logItems = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") || []; } catch (e) { logItems = []; }

  var LABELS = {
    effect: "Apply Preset", precomp: "Precompose", adjustment: "Adjustments", copyEffects: "Copy effects",
    stripLast: "Remove last preset", stripAll: "Remove all effects", sequence: "Sequence", workArea: "Work area",
    splitMarkers: "Split at markers", flashCuts: "Cut flashes", cutJoins: "Cut joins", saveComp: "Save comp",
    add: "Add layer", fit: "Fit to comp", frameBlend: "Frame blending", clipboard: "Paste image", screenshot: "Screenshot", unprecomp: "Un-precompose",
    explode: "Explode text", cutMarker: "Cut to marker", seqMarkers: "Sequence by markers", beats: "Beat markers", silence: "Cut silence",
    stretch: "Stretch keys", motion: "Bounce/Elastic", del: "Delete", pathNulls: "Path to nulls", optimize: "Optimize project", cache: "Clean cache",
    sfxFolder: "SFX folder", outFolder: "Export folder", outReset: "Export folder", fixGaps: "Scene gaps", topaz: "Topaz",
    export: "Export", intensity: "Intensity", preview: "Preview", sceneDetect: "Scene detect", layers: "Layers", labels: "Labels", ease: "Ease", vocals: "Vocal remover"
  };

  function log(name, text, ok) {
    logItems.unshift({ t: Date.now(), name: name, text: text, ok: ok !== false });
    if (logItems.length > LOG_MAX) logItems.length = LOG_MAX;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logItems)); } catch (e) {}
    renderLog();
  }

  function renderLog() {
    var box = $("#actionLog");
    if (!box) return;
    box.innerHTML = "";
    if (!logItems.length) { box.innerHTML = '<p class="muted small">Nothing yet.</p>'; return; }
    logItems.forEach(function (it) {
      var d = new Date(it.t), hh = d.getHours(), mm = d.getMinutes();
      var row = document.createElement("div");
      row.className = "log-row" + (it.ok ? "" : " bad");
      row.innerHTML = '<span class="log-time"></span><span class="log-name"></span><span class="log-text"></span>';
      row.querySelector(".log-time").textContent = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
      row.querySelector(".log-name").textContent = LABELS[it.name] || it.name;
      row.querySelector(".log-text").textContent = it.text;
      row.title = it.text;
      box.appendChild(row);
    });
  }

  $("#logClear").addEventListener("click", function () {
    logItems = [];
    try { localStorage.removeItem(LOG_KEY); } catch (e) {}
    renderLog();
  });

  J.on(function (type, d) {
    if (type !== "action") return;
    var text = d.msg || "";
    if (d.ok && d.preset && (d.name === "effect" || d.name === "adjustment")) text += " \u00B7 " + presetLabel(d.preset);
    log(d.name, text, d.ok);
  });

  // ------------------------------------------------------------------
  // Alternate every other clip with a second preset
  // ------------------------------------------------------------------
  var altToggle = $("#altToggle"), altSel = $("#altSelect"), altWrap = $("#altWrap");

  function renderAlt() {
    var favs = J.favorites(), want = J.store.get("eff.altPreset", "");
    altSel.innerHTML = "";
    if (!favs.length) {
      var o = document.createElement("option");
      o.value = "";
      o.textContent = "Add favorites first";
      altSel.appendChild(o);
      return;
    }
    favs.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p;
      opt.textContent = presetLabel(p);
      altSel.appendChild(opt);
    });
    if (want && favs.indexOf(want) >= 0) altSel.value = want;
    else {
      // default to a favorite that isn't the main preset
      var other = favs.filter(function (p) { return p !== J.ui().preset; })[0];
      if (other) altSel.value = other;
    }
  }
  function syncAlt() { altWrap.classList.toggle("open", altToggle.checked); }
  altToggle.addEventListener("change", syncAlt);
  altSel.addEventListener("change", function () { J.store.set("eff.altPreset", altSel.value); });
  J.on(function (type) { if (type === "favorites") renderAlt(); });
  renderAlt();
  syncAlt();

  // ------------------------------------------------------------------
  // Intensity slider (scales the last Apply Preset)
  // ------------------------------------------------------------------
  var slider = $("#intensitySlider"), sval = $("#intensityVal"), ibox = $("#intensity");

  function paintSlider() {
    var v = +slider.value;
    sval.textContent = v + "%";
    slider.style.setProperty("--fill", (v / 2) + "%");
  }
  slider.addEventListener("input", paintSlider);
  slider.addEventListener("change", function () {
    var v = +slider.value;
    ibox.classList.add("working");
    J.host("setIntensity", { percent: v }).then(function (r) {
      ibox.classList.remove("working");
      if (!r.ok) { J.toast(r.error, "bad", 3200); return; }
      J.emit("action", { name: "intensity", ok: true, msg: v + "% (" + r.keys + " keys)" });
    });
  });
  slider.addEventListener("dblclick", function () { slider.value = 100; paintSlider(); slider.dispatchEvent(new Event("change")); });

  J.on(function (type, d) {
    if (type !== "action" || d.name !== "effect" || !d.ok) return;
    var n = (d.result && d.result.intensityProps) || 0; // -1 = worked out on first use
    slider.value = 100;
    slider.disabled = !n;
    ibox.classList.toggle("on", !!n);
    ibox.title = n ? "Drag to scale the preset's animation \u00B7 double-click to reset" : "This preset has no animated values to scale";
    paintSlider();
  });
  paintSlider();

  // ------------------------------------------------------------------
  // Preset preview (frames cached on disk, made once per preset version)
  // ------------------------------------------------------------------
  var box = $("#previewBox"), img = $("#previewImg"), empty = $("#previewEmpty"), msg = $("#previewMsg"), makeBtn = $("#previewMake");
  var CACHE = nodeOk ? path.join(process.env.APPDATA || require("os").homedir(), "JWPA", "previews") : "";
  var FRAMES = 10, flip = null, making = false, shownFor = "";

  // the clip previews play on: one you picked in Settings, else this install's default, else a checkerboard
  function previewClip() {
    var mine = J.store.get("pv.clip", "");
    var def = (window.JWPA_CONFIG || {}).previewClip;
    var list = [mine, def ? path.join.apply(path, [require("os").homedir()].concat(def)) : ""];
    for (var i = 0; i < list.length; i++) { try { if (list[i] && fs.statSync(list[i]).isFile()) return list[i]; } catch (e) {} }
    return "";
  }
  J.previewClip = previewClip;

  // the preset box shows the cached preview: still frame, and it plays while you hover the box
  var thumbFlip = null, thumbFrames = null;
  function presetThumb() {
    var icon = $(".preset-icon"), field = $("#presetField");
    if (!icon || !nodeOk) return;
    var p = J.ui().preset, frames = p ? cachedFrames(cacheDir(p)) : null;
    thumbFrames = frames;
    // at rest: the preset's colour cover (preview frames are mostly checkerboard); hovering plays the preview
    icon.classList.remove("art", "thumb"); icon.removeAttribute("data-ini");
    icon.style.backgroundImage = "";
    if (p && J.coverArt) { J.coverArt(icon, J.baseName(p).replace(/\.ffx$/i, "")); icon.classList.add("thumb"); }
  }
  (function () {
    var field = $("#presetField"), icon = $(".preset-icon");
    if (!field || !icon) return;
    field.addEventListener("mouseenter", function () {
      if (!thumbFrames || thumbFlip) return;
      var i = 0;
      icon.classList.remove("art");
      icon.style.backgroundImage = "url(" + fileUrl(thumbFrames[0]) + ")";
      thumbFlip = setInterval(function () { i = (i + 1) % thumbFrames.length; icon.style.backgroundImage = "url(" + fileUrl(thumbFrames[i]) + ")"; }, 110);
    });
    field.addEventListener("mouseleave", function () { if (thumbFlip) { clearInterval(thumbFlip); thumbFlip = null; } presetThumb(); });
  })();
  J.on(function (type, d) { if (type === "preset" || (type === "action" && d && d.name === "preview")) setTimeout(presetThumb, 50); });
  setTimeout(presetThumb, 300);

  function renderClip() {
    var c = previewClip();
    $("#pvClipName").textContent = c ? "Previews play on " + path.basename(c) + "." : "Previews play on a checkerboard.";
    $("#pvClipReset").disabled = !J.store.get("pv.clip", "");
  }
  $("#pvClipPick").addEventListener("click", function () {
    J.host("pickFile", { title: "Choose a clip for effect previews", filter: "*.mp4;*.mov;*.avi;*.png;*.jpg" }).then(function (r) {
      if (!r.ok || !r.path) return;
      J.store.set("pv.clip", r.path);
      renderClip();
      if (box.classList.contains("open")) showPreview();
      J.toast("Previews will use " + path.basename(r.path), "ok", 2200);
    });
  });
  $("#pvClipReset").addEventListener("click", function () { J.store.set("pv.clip", ""); renderClip(); if (box.classList.contains("open")) showPreview(); });
  if (nodeOk) renderClip(); else { $("#pvClipPick").disabled = true; $("#pvClipReset").disabled = true; }

  function cacheDir(preset) {
    try {
      var st = fs.statSync(preset), clip = previewClip(), cs = clip ? fs.statSync(clip) : null;
      var key = preset + "|" + st.size + "|" + st.mtimeMs + (clip ? "|" + clip + "|" + cs.size + "|" + cs.mtimeMs : "");
      var h = crypto.createHash("md5").update(key).digest("hex").slice(0, 16);
      return path.join(CACHE, h);
    } catch (e) { return ""; }
  }

  function cachedFrames(dir) {
    if (!dir) return null;
    var out = [];
    for (var i = 0; i < FRAMES; i++) {
      var f = path.join(dir, "f" + i + ".png");
      try { if (fs.statSync(f).size > 0) out.push(f); else return null; } catch (e) { return null; }
    }
    return out;
  }

  function fileUrl(p) { return "file:///" + p.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:"); }

  function stopFlip() { if (flip) { clearInterval(flip); flip = null; } }

  function play(frames) {
    stopFlip();
    var urls = frames.map(function (f) { return fileUrl(f) + "?v=" + Date.now(); });
    urls.forEach(function (u) { var im = new Image(); im.src = u; }); // preload
    var i = 0;
    img.src = urls[0];
    box.classList.add("has");
    flip = setInterval(function () { i = (i + 1) % urls.length; img.src = urls[i]; }, 110);
  }

  function showPreview() {
    var preset = J.ui().preset;
    shownFor = preset;
    stopFlip();
    box.classList.remove("has");
    if (!nodeOk) { msg.textContent = "Previews only work inside After Effects."; makeBtn.style.display = "none"; return; }
    if (!preset) { msg.textContent = "Pick a preset first."; makeBtn.style.display = "none"; return; }
    var frames = cachedFrames(cacheDir(preset));
    if (frames) { play(frames); return; }
    msg.textContent = making ? "Making preview\u2026" : "No preview yet for " + presetLabel(preset) + ".";
    makeBtn.style.display = making ? "none" : "";
  }

  function waitForFiles(files, timeoutMs) {
    var start = Date.now(), lastSizes = "";
    return new Promise(function (resolve) {
      (function check() {
        var sizes = files.map(function (f) { try { return fs.statSync(f).size; } catch (e) { return 0; } });
        var allThere = sizes.every(function (s) { return s > 0; }), sig = sizes.join(",");
        if (allThere && sig === lastSizes) return resolve(true);
        lastSizes = sig;
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 250);
      })();
    });
  }

  // makes the preview frames for a preset (the selected one by default); resolves true when done
  function makePreview(forPreset) {
    var preset = typeof forPreset === "string" ? forPreset : J.ui().preset;
    if (!preset || making) return Promise.resolve(false);
    if (J.busy()) { J.toast("Wait for the current action to finish", "warn", 2000); return Promise.resolve(false); }
    var dir = cacheDir(preset);
    if (!dir) { J.toast("Couldn't read the preset file", "bad"); return Promise.resolve(false); }
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    making = true;
    showPreview();
    box.classList.add("making");
    return J.host("previewStart", { preset: preset, dir: dir.replace(/\\/g, "/"), frames: FRAMES, clip: previewClip().replace(/\\/g, "/") }).then(function (made) {
      if (!made.ok) throw new Error(made.error);
      return waitForFiles(made.files, 30000).then(function (done) {
        return J.host("previewCleanup", made).then(function () {
          if (!done) throw new Error("After Effects didn't finish the preview frames.");
        });
      });
    }).then(function () {
      making = false;
      box.classList.remove("making");
      J.emit("action", { name: "preview", ok: true, msg: presetLabel(preset) });
      if (shownFor === preset) showPreview();
      return true;
    }).catch(function (e) {
      making = false;
      box.classList.remove("making");
      msg.textContent = "Preview failed: " + (e.message || e);
      makeBtn.style.display = "";
      J.toast("Preview failed: " + (e.message || e), "bad", 5000);
      return false;
    });
  }
  // for the Home and Browse tabs
  J.previewFrames = function (p) { if (!nodeOk || !p) return null; try { return cachedFrames(cacheDir(p)); } catch (e) { return null; } };
  J.makePreviewFor = function (p) { return makePreview(p); };
  J.fileUrl = fileUrl;

  function togglePreview(force) {
    var open = typeof force === "boolean" ? force : !box.classList.contains("open");
    box.classList.toggle("open", open);
    $("#previewBtn").classList.toggle("active", open);
    J.store.set("pv.open", open);
    if (open) showPreview(); else stopFlip();
  }

  $("#previewBtn").addEventListener("click", function () { togglePreview(); });
  makeBtn.addEventListener("click", function () { makePreview(); });
  J.on(function (type) { if (type === "preset" && box.classList.contains("open")) showPreview(); });
  if (J.store.get("pv.open", false)) togglePreview(true);

  // ------------------------------------------------------------------
  // Hotkeys (only while this panel has keyboard focus)
  // ------------------------------------------------------------------
  var KEYS = { Enter: 13, "[": 219, "]": 221, "1": 49, "2": 50, "3": 51, "4": 52, "5": 53, "6": 54, "7": 55, "8": 56, p: 80, g: 71, b: 66 };
  try {
    var interest = Object.keys(KEYS).map(function (k) { return { keyCode: KEYS[k] }; });
    if (window.__adobe_cep__ && window.__adobe_cep__.registerKeyEventsInterest) {
      window.__adobe_cep__.registerKeyEventsInterest(JSON.stringify(interest));
    }
  } catch (e) {}

  var TABS = ["home", "tools", "effect", "precomp", "adjustment", "topaz", "layers", "ease", "audio"];
  var PRIMARY = { effect: '[data-action="effect"]', precomp: '[data-action="precomp"]', adjustment: '[data-action="adjustment"]', topaz: "#tzSend", ease: "#ezApply" };

  document.addEventListener("keydown", function (e) {
    if (!J.opt("hk.on")) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" && t.type !== "checkbox" && t.type !== "range" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var handled = true;
    if (k === "Enter") {
      var sel = PRIMARY[J.ui().tab];
      var btn = sel && document.querySelector(sel);
      if (btn) btn.click(); else handled = false;
    } else if (k === "[") J.stepFav(-1);
    else if (k === "]") J.stepFav(1);
    else if (k >= "1" && k <= "9") J.setTab(TABS[+k - 1]);
    else if (k === "p") togglePreview();
    else if (k === "g") $("#sdRun").click();
    else if (k === "b") $("#browseBtn").click();
    else handled = false;
    if (handled) e.preventDefault();
  });

  // ------------------------------------------------------------------
  // Label colors
  // ------------------------------------------------------------------
  // After Effects' default label colors (used unless the user customised them in Preferences)
  var LABEL_DEFAULTS = [
    ["Red", "B53838"], ["Yellow", "E4D84C"], ["Aqua", "A9CBC7"], ["Pink", "E5BCC9"], ["Lavender", "A9A9CA"],
    ["Peach", "E7C19E"], ["Sea Foam", "B3C7B3"], ["Blue", "677DE0"], ["Green", "4AA44C"], ["Purple", "8E2C9A"],
    ["Orange", "E8920D"], ["Brown", "7F452A"], ["Fuchsia", "F46DD6"], ["Cyan", "3DA2A5"], ["Sandstone", "A89677"], ["Dark Green", "1E401E"]
  ];
  var labels = LABEL_DEFAULTS.map(function (d, i) { return { id: i + 1, name: d[0], hex: d[1] }; });
  var rainbow = [];

  function hsvOf(hex) {
    var r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
  }

  // rainbow = the vivid labels, in color-wheel order (red, orange, yellow, green, cyan, blue, purple, pink)
  function buildRainbow() {
    rainbow = labels.filter(function (l) { var c = hsvOf(l.hex); return c.s >= 0.4 && c.v >= 0.55; })
      .sort(function (a, b) { return hsvOf(a.hex).h - hsvOf(b.hex).h; });
  }

  function renderLabels() {
    // the same card shows on the Precomp and Adjust tabs, so fill every copy
    document.querySelectorAll(".lb-swatches").forEach(function (box) {
      box.innerHTML = "";
      [{ id: 0, name: "None", hex: "" }].concat(labels).forEach(function (l, i) {
        var b = document.createElement("button");
        b.className = "lb-sw" + (l.id === 0 ? " none" : "");
        b.title = l.name;
        b.style.animationDelay = (i * 0.018) + "s";
        if (l.hex) { b.style.background = "#" + l.hex; b.style.setProperty("--c", "#" + l.hex); }
        b.addEventListener("click", function () { setLabels([l.id], l.name, b); });
        box.appendChild(b);
      });
    });
    document.querySelectorAll(".lb-rainbow").forEach(function (btn) {
      btn.style.background = "linear-gradient(90deg, " + rainbow.map(function (l) { return "#" + l.hex; }).join(", ") + ")";
    });
    document.querySelectorAll("select.lb-select").forEach(function (el) {
      var key = el.dataset.lb === "pre" ? "lb.pre" : "lb.adj", want = J.store.get(key, "");
      el.innerHTML = "";
      [["", "Leave as is"], ["rainbow", "Rainbow (next color each time)"]].concat(labels.map(function (l) { return [String(l.id), l.name]; }))
        .forEach(function (o) { var opt = document.createElement("option"); opt.value = o[0]; opt.textContent = o[1]; el.appendChild(opt); });
      el.value = want;
      el.onchange = function () {
        J.store.set(key, el.value);
        // keep any other copy of this setting in sync
        document.querySelectorAll('select.lb-select[data-lb="' + el.dataset.lb + '"]').forEach(function (o) { if (o !== el) o.value = el.value; });
      };
    });
  }

  function setLabels(ids, what, btn) {
    J.host("setLabels", { labels: ids }).then(function (r) {
      if (!r.ok) return J.toast(r.error, "bad", 3200);
      if (btn) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
      var msg = (ids.length > 1 ? "Rainbow on " : what + " on ") + r.count + " layer" + (r.count === 1 ? "" : "s");
      J.toast(msg, "ok", 1800);
      J.emit("action", { name: "labels", ok: true, msg: msg });
    });
  }

  document.querySelectorAll(".lb-rainbow").forEach(function (btn) {
    btn.addEventListener("click", function () { setLabels(rainbow.map(function (l) { return l.id; }), "Rainbow", btn); });
  });

  // used by panel.js when precomposing / creating adjustment layers
  J.labelPlan = function (kind) {
    var v = J.store.get(kind === "pre" ? "lb.pre" : "lb.adj", "");
    if (!v) return null;
    if (v === "rainbow") return { labels: rainbow.map(function (l) { return l.id; }), start: J.store.get("lb.next." + kind, 0) };
    return { labels: [parseInt(v, 10)], start: 0 };
  };
  J.labelUsed = function (kind, n) {
    if (J.store.get(kind === "pre" ? "lb.pre" : "lb.adj", "") !== "rainbow" || !rainbow.length) return;
    J.store.set("lb.next." + kind, (J.store.get("lb.next." + kind, 0) + (n || 0)) % rainbow.length);
  };

  buildRainbow();
  renderLabels();
  // pick up custom label colors if the user changed them in After Effects
  J.host("labelColors").then(function (r) {
    if (!r.ok) return;
    var changed = false;
    r.labels.forEach(function (l) {
      var cur = labels[l.id - 1], hex = String(l.hex || "").replace(/[^0-9a-f]/gi, "").slice(-6);
      if (hex.length === 6 && hex.toUpperCase() !== cur.hex) { cur.hex = hex.toUpperCase(); changed = true; }
      if (l.name && l.name !== cur.name) { cur.name = l.name; changed = true; }
    });
    if (changed) { buildRainbow(); renderLabels(); }
  });

  // ------------------------------------------------------------------
  // Smart Scene Detect
  // ------------------------------------------------------------------
  var sdBtn = $("#sdRun"), sdStatus = $("#sdStatus"), sdBar = $("#sdBar"), sdFill = sdBar.querySelector(".fill");
  var sdSens = $("#sdSens"), sdSensVal = $("#sdSensVal");
  var sdRunning = false, sdCancel = false;

  function paintSens() {
    sdSensVal.textContent = sdSens.value;
    sdSens.style.setProperty("--fill", ((sdSens.value - 1) / 9 * 100) + "%");
  }
  sdSens.addEventListener("input", paintSens);
  paintSens();

  function sdState(text, kind, pct) {
    sdStatus.textContent = text;
    sdStatus.className = "run-status " + (kind || "");
    sdBar.classList.toggle("indeterminate", pct === -1);
    sdBar.classList.toggle("done", pct === 100 && kind === "ok");
    if (pct >= 0) sdFill.style.width = pct + "%";
  }

  function sdDone(text, kind) {
    sdRunning = false;
    sdBtn.classList.remove("running");
    sdBtn.querySelector(".label").textContent = "Detect Scenes";
    sdState(text, kind, kind === "ok" ? 100 : 0);
    if (kind === "ok") { sdBtn.classList.remove("done"); void sdBtn.offsetWidth; sdBtn.classList.add("done"); }
  }

  sdBtn.addEventListener("click", function () {
    if (sdRunning) { sdCancel = true; sdState("Cancelling\u2026", "", -1); return; }
    var SD = window.JWPA_SceneDetect, SC = window.JWPA_SceneCut;
    if (!SD) return J.toast("Scene detection only works inside After Effects", "bad", 3000);
    var ff = SC ? SC.findFfmpeg() : "";
    if (!ff) return J.toast("ffmpeg not found \u00B7 install it to C:\\ffmpeg\\bin", "bad", 5000);

    var opts = {
      sensitivity: +sdSens.value,
      minShot: Math.max(1, Math.round(J.opt("sd.minShot") || 6)),
      flashFrames: J.opt("sd.flash") ? 4 : 0
    };
    var mode = J.opt("sd.mode") || "layers";

    sdRunning = true; sdCancel = false;
    sdBtn.classList.add("running");
    sdBtn.querySelector(".label").textContent = "Cancel";
    sdState("Getting ready\u2026", "", -1);

    J.host("sceneDetectPrep").then(function (prep) {
      if (!prep.ok) return sdDone(prep.error, "bad");
      (prep.skipped || []).forEach(function (s) { J.toast("Skipped " + s, "warn", 5000); });
      if (!prep.clips.length) return sdDone("No video layers to analyse", "bad");

      var totalCuts = 0, totalLayers = 0, chain = Promise.resolve(), t0 = Date.now();
      prep.clips.forEach(function (clip, idx) {
        chain = chain.then(function () {
          if (sdCancel) return;
          var expected = Math.max(1, clip.srcDur * clip.fps);
          var label = (prep.clips.length > 1 ? (idx + 1) + "/" + prep.clips.length + " \u00B7 " : "");
          sdState(label + "Reading frames\u2026", "", 0);
          return SD.detect(ff, clip.file, clip.srcStart, clip.srcDur, clip.fps, opts, function (n) {
            sdState(label + "Reading frames " + Math.min(100, Math.round(n / expected * 100)) + "%", "", Math.min(99, n / expected * 100));
          }, function () { return sdCancel; }).then(function (res) {
            if (sdCancel) return;
            sdState(label + "Found " + res.cuts.length + " cut" + (res.cuts.length === 1 ? "" : "s") + " \u00B7 splitting\u2026", "", 100);
            if (!res.cuts.length) return;
            return J.host("sceneSplit", {
              ref: clip.ref, file: clip.file, name: clip.name, inPoint: clip.inPoint, outPoint: clip.outPoint,
              mode: mode, times: res.cuts.map(function (c) { return c.t; })
            }).then(function (r) {
              if (!r.ok) throw new Error(r.error);
              totalCuts += r.cuts;
              totalLayers += r.layers;
            });
          });
        });
      });

      return chain.then(function () {
        var secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (sdCancel) return sdDone("Cancelled" + (totalCuts ? " \u00B7 " + totalCuts + " cuts already applied" : ""), "");
        var text = totalCuts
          ? "Found " + totalCuts + " cut" + (totalCuts === 1 ? "" : "s") + (mode === "markers" ? " \u00B7 markers added" : " \u00B7 " + totalLayers + " layers") + " (" + secs + "s)"
          : "No cuts found \u00B7 try a higher sensitivity";
        sdDone(text, totalCuts ? "ok" : "");
        J.toast(text, totalCuts ? "ok" : "", 3600);
        J.emit("action", { name: "sceneDetect", ok: true, msg: text });
      });
    }).catch(function (e) {
      var msg = e && e.message === "cancelled" ? "Cancelled" : "Failed: " + (e.message || e);
      sdDone(msg, msg === "Cancelled" ? "" : "bad");
      if (msg !== "Cancelled") J.emit("action", { name: "sceneDetect", ok: false, msg: msg });
    });
  });

  renderLog();
})();
