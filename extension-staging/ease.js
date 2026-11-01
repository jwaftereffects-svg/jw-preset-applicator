/* JW Preset Applicator Pro - Ease tab: a curve editor for keyframe easing, laid out like Flow.
 *
 * The curve is a cubic-bezier (x1, y1, x2, y2) over one segment between two keyframes.
 * "Apply" turns it into After Effects' influence/speed easing on the selected keyframes
 * (Ease out / Ease / Ease in pick which side). The read button does the reverse.
 * Presets live in libraries, saved and opened as Flow's own .flow files.
 */
(function () {
  "use strict";
  var J = window.JWPA;
  if (!J) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // graph: 300x300 box, the 0..1 square in the middle, room above and below for overshoot
  var W = 300, H = 300, SQ = 176, X0 = (W - SQ) / 2, Y0 = (H - SQ) / 2;
  var YMIN = -Y0 / SQ, YMAX = 1 + Y0 / SQ;
  var curve = (J.store.get("ease.curve", null) || [0.65, 0, 0.35, 1]).slice(0, 4);
  var dir = J.store.get("ease.dir", "both");

  var BUILT = "Built-in", MINE = "My curves";
  var BUILT_IN = [
    ["Smooth", [0.45, 0, 0.55, 1]], ["Ease In Out", [0.65, 0, 0.35, 1]], ["Ease Out", [0.33, 1, 0.68, 1]],
    ["Ease In", [0.32, 0, 0.67, 0]], ["Expo Out", [0.16, 1, 0.3, 1]], ["Expo In", [0.7, 0, 0.84, 0]],
    ["Expo In Out", [0.87, 0, 0.13, 1]], ["Snappy", [0.9, 0, 0.1, 1]], ["Back Out", [0.34, 1.56, 0.64, 1]],
    ["Back In", [0.36, 0, 0.66, -0.56]], ["Back In Out", [0.68, -0.6, 0.32, 1.6]], ["Linear", [0.33, 0.33, 0.67, 0.67]]
  ];

  function X(x) { return X0 + x * SQ; }
  function Y(y) { return Y0 + (1 - y) * SQ; }
  function unX(px) { return (px - X0) / SQ; }
  function unY(py) { return 1 - (py - Y0) / SQ; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function r2(v) { return String(Math.round(v * 100) / 100); }
  function pathOf(c, x, y) { return "M" + x(0) + "," + y(0) + " C" + x(c[0]) + "," + y(c[1]) + " " + x(c[2]) + "," + y(c[3]) + " " + x(1) + "," + y(1); }

  // cubic-bezier timing: progress y for time x
  function bez(t, a, b) { var u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t; }
  function solve(x, c) {
    var lo = 0, hi = 1, t = x;
    for (var i = 0; i < 30; i++) { var v = bez(t, c[0], c[2]); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return bez(t, c[1], c[3]);
  }

  // ---------------------------------------------------------------- drawing
  function drawGrid() {
    var h = "", step = SQ / 5, v;
    // 20% grid that runs past the square, like Flow's
    for (v = X0 % step; v <= W; v += step) h += '<line class="ez-gl" x1="' + v + '" y1="0" x2="' + v + '" y2="' + H + '"/>';
    for (v = Y0 % step; v <= H; v += step) h += '<line class="ez-gl" x1="0" y1="' + v + '" x2="' + W + '" y2="' + v + '"/>';
    for (var i = 1; i < 5; i++) {
      h += '<line class="ez-gl ez-gl-in" x1="' + X(i / 5) + '" y1="' + Y(0) + '" x2="' + X(i / 5) + '" y2="' + Y(1) + '"/>';
      h += '<line class="ez-gl ez-gl-in" x1="' + X(0) + '" y1="' + Y(i / 5) + '" x2="' + X(1) + '" y2="' + Y(i / 5) + '"/>';
    }
    h += '<line class="ez-top" x1="' + X(0) + '" y1="' + Y(1) + '" x2="' + X(1) + '" y2="' + Y(1) + '"/>';
    h += '<line class="ez-top" x1="' + X(1) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '"/>';
    h += '<line class="ez-axis" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(0) + '"/>';
    h += '<line class="ez-axis" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(0) + '" y2="' + Y(1) + '"/>';
    $("#ezGrid").innerHTML = h;
  }

  function draw() {
    var c = curve;
    $("#ezCurve").setAttribute("d", pathOf(c, X, Y));
    setLine("#ezArm1", X(0), Y(0), X(c[0]), Y(c[1]));
    setLine("#ezArm2", X(1), Y(1), X(c[2]), Y(c[3]));
    setPos("#ezH1", X(c[0]), Y(c[1]));
    setPos("#ezH2", X(c[2]), Y(c[3]));
    if (document.activeElement !== $("#ezText")) $("#ezText").value = c.map(r2).join(", ");
    clearTimeout(draw.saveT);
    draw.saveT = setTimeout(function () { J.store.set("ease.curve", curve.slice(0, 4)); }, 400);
  }
  function drawGhost() {
    var g = J.store.get("ease.last", null);
    $("#ezGhost").setAttribute("d", g ? pathOf(g, X, Y) : "");
  }
  function setLine(id, x1, y1, x2, y2) { var l = $(id); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); }
  function setPos(id, x, y) { var e = $(id); e.setAttribute("cx", x); e.setAttribute("cy", y); }

  // ---------------------------------------------------------------- dragging the handles
  var svg = $("#ezSvg"), dragging = 0;
  function toLocal(e) {
    var r = svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
  }
  function startDrag(which) {
    return function (e) { e.preventDefault(); e.stopPropagation(); dragging = which; svg.classList.add("dragging"); $(which === 1 ? "#ezH1" : "#ezH2").classList.add("active"); };
  }
  $("#ezH1").addEventListener("mousedown", startDrag(1));
  $("#ezH2").addEventListener("mousedown", startDrag(2));
  // clicking empty graph space grabs the nearest handle, so it's easy to hit
  svg.addEventListener("mousedown", function (e) {
    if (dragging) return;
    var p = toLocal(e), d1 = Math.hypot(p[0] - X(curve[0]), p[1] - Y(curve[1])), d2 = Math.hypot(p[0] - X(curve[2]), p[1] - Y(curve[3]));
    startDrag(d1 <= d2 ? 1 : 2)(e);
    move(e);
  });
  function move(e) {
    if (!dragging) return;
    var p = toLocal(e);
    var x = Math.max(0, Math.min(1, unX(p[0]))), y = Math.max(YMIN, Math.min(YMAX, unY(p[1])));
    if (e.shiftKey) y = dragging === 1 ? 0 : 1; // shift = flat handle (classic ease)
    if (dragging === 1) { curve[0] = x; curve[1] = y; } else { curve[2] = x; curve[3] = y; }
    draw();
  }
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", function () {
    if (!dragging) return;
    $("#ezH1").classList.remove("active"); $("#ezH2").classList.remove("active");
    svg.classList.remove("dragging");
    dragging = 0;
    markPreset();
  });

  // typed values: "0.65, 0, 0.35, 1" or "cubic-bezier(...)"
  $("#ezText").addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = curve.map(r3).join(", "); e.target.blur(); } });
  $("#ezText").addEventListener("focus", function (e) { e.target.value = curve.map(r3).join(", "); e.target.select(); });
  $("#ezText").addEventListener("blur", function (e) {
    var n = (e.target.value.match(/-?\d*\.?\d+/g) || []).map(Number);
    if (n.length >= 4) animateTo([Math.max(0, Math.min(1, n[0])), n[1], Math.max(0, Math.min(1, n[2])), n[3]]);
    else draw();
  });

  // smooth morph from the current curve to a new one
  var morph = null;
  function animateTo(to) {
    var from = curve.slice(), t0 = performance.now(), dur = document.body.classList.contains("reduce") ? 0 : 300;
    if (morph) cancelAnimationFrame(morph);
    (function step(now) {
      var k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
      for (var i = 0; i < 4; i++) curve[i] = from[i] + (to[i] - from[i]) * e;
      draw();
      if (k < 1) morph = requestAnimationFrame(step); else { morph = null; markPreset(); }
    })(t0);
  }

  // a dot that rides the curve with its timing
  var cycleStart = performance.now();
  // only runs while the Ease tab is open and you're on the panel (no drawing in the background)
  var easePage = document.querySelector('[data-page="ease"]'), looping = false;
  function loop(now) {
    if (!easePage.classList.contains("active") || document.body.classList.contains("idle")) { looping = false; return; }
    var period = 1500, hold = 500, p = ((now - cycleStart) % (period + hold)) / period;
    var x = Math.min(1, p);
    setPos("#ezDot", X(x), Y(solve(x, curve)));
    requestAnimationFrame(loop);
  }
  function kick() { if (!looping) { looping = true; requestAnimationFrame(loop); } }
  new MutationObserver(kick).observe(easePage, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  kick();

  // ---------------------------------------------------------------- ease direction (out / both / in)
  function renderDir() {
    Array.prototype.forEach.call(document.querySelectorAll("#ezDir .ez-btn"), function (b) { b.classList.toggle("on", b.dataset.dir === dir); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#ezDir .ez-btn"), function (b) {
    b.addEventListener("click", function () { dir = b.dataset.dir; J.store.set("ease.dir", dir); renderDir(); });
  });

  // ---------------------------------------------------------------- libraries + presets
  function userPresets() { return J.store.get("ease.presets", []) || []; }
  function storedLibs() { return J.store.get("ease.libs", []) || []; }

  function libraries() {
    var seen = {}, out = [];
    function add(g) { if (g && g !== BUILT && !seen[g]) { seen[g] = 1; out.push(g); } }
    storedLibs().forEach(add);
    userPresets().forEach(function (p) { add(p.group || MINE); });
    return out;
  }

  var lib = J.store.get("ease.group", "");
  function currentLib() {
    var libs = libraries();
    if (lib !== BUILT && libs.indexOf(lib) < 0) lib = libs.length ? libs[0] : BUILT;
    return lib;
  }

  function thumb(c) {
    var s = 60, p = 12, q = s - 2 * p, lo = -0.35, hi = 1.35;
    function tx(x) { return p + x * q; }
    function ty(y) { return p + (hi - y) / (hi - lo) * q; }
    return '<svg viewBox="0 0 ' + s + " " + s + '"><path d="' + pathOf(c, tx, ty) + '"/>' +
      '<circle cx="' + tx(0) + '" cy="' + ty(0) + '" r="2.2"/><circle cx="' + tx(1) + '" cy="' + ty(1) + '" r="2.2"/></svg>';
  }

  function markPreset() {
    Array.prototype.forEach.call(document.querySelectorAll(".ez-preset"), function (b) {
      var c = JSON.parse(b.dataset.c);
      b.classList.toggle("on", c.every(function (v, i) { return Math.abs(v - curve[i]) < 0.005; }));
    });
  }

  function renderLibs() {
    var sel = $("#ezLib"), cur = currentLib();
    sel.innerHTML = "";
    [BUILT].concat(libraries()).forEach(function (g) {
      var n = g === BUILT ? BUILT_IN.length : userPresets().filter(function (p) { return (p.group || MINE) === g; }).length;
      var o = document.createElement("option");
      o.value = g; o.textContent = g + "  (" + n + ")";
      sel.appendChild(o);
    });
    sel.value = cur;
    var builtIn = cur === BUILT;
    $("#ezDelLib").disabled = builtIn;
    $("#ezExport").disabled = builtIn || !userPresets().some(function (p) { return (p.group || MINE) === cur; });
  }
  $("#ezLib").addEventListener("change", function (e) { lib = e.target.value; J.store.set("ease.group", lib); renderPresets(); });

  function renderPresets() {
    renderLibs();
    var box = $("#ezPresets"), cur = currentLib();
    box.innerHTML = "";
    var shown = cur === BUILT
      ? BUILT_IN.map(function (p) { return { name: p[0], c: p[1], user: false }; })
      : userPresets().map(function (p, idx) { return { name: p.name, c: p.c, user: true, group: p.group || MINE, idx: idx }; })
        .filter(function (p) { return p.group === cur; });
    if (!shown.length) { box.innerHTML = '<p class="muted small ez-empty">Empty library · shape a curve and press the star to save it here.</p>'; return; }
    shown.forEach(function (p, i) {
      var b = document.createElement("button");
      b.className = "ez-preset";
      b.dataset.c = JSON.stringify(p.c);
      b.style.animationDelay = Math.min(i, 20) * 0.015 + "s";
      b.innerHTML = '<i class="ez-tile">' + thumb(p.c) + "</i><span></span>" + (p.user ? '<i class="ez-del" title="Delete">✕</i>' : "");
      b.querySelector("span").textContent = p.name;
      b.title = p.name + " · click to load, double-click to apply";
      b.addEventListener("click", function (e) {
        if (e.target.classList.contains("ez-del")) {
          var list = userPresets(); list.splice(p.idx, 1);
          J.store.set("ease.presets", list);
          renderPresets();
          return;
        }
        animateTo(p.c.slice());
      });
      b.addEventListener("dblclick", function (e) {
        if (e.target.classList.contains("ez-del")) return;
        if (morph) { cancelAnimationFrame(morph); morph = null; }
        curve = p.c.slice(); draw(); markPreset(); apply();
      });
      box.appendChild(b);
    });
    markPreset();
  }

  // inline name box that temporarily replaces the library dropdown
  function askName(placeholder, done) {
    var wrap = $("#ezLibWrap");
    if (wrap.parentNode.querySelector("input.recipe-name")) return;
    var input = document.createElement("input");
    input.type = "text"; input.className = "recipe-name"; input.placeholder = placeholder;
    wrap.style.display = "none";
    wrap.parentNode.insertBefore(input, wrap);
    input.focus();
    var finished = false;
    function end(ok) {
      if (finished) return; finished = true;
      var v = input.value.trim().slice(0, 30);
      input.remove(); wrap.style.display = "";
      if (ok && v) done(v);
    }
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") end(true); if (e.key === "Escape") end(false); });
    input.addEventListener("blur", function () { end(true); });
  }

  $("#ezSave").addEventListener("click", function () {
    var target = currentLib() === BUILT ? MINE : currentLib();
    askName("Preset name (saves to " + target + ")", function (name) {
      var list = userPresets().filter(function (u) { return !(u.name === name && (u.group || MINE) === target); });
      list.push({ name: name, c: curve.map(r3), group: target });
      J.store.set("ease.presets", list);
      lib = target; J.store.set("ease.group", lib);
      renderPresets();
      var b = $("#ezSave"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      J.toast("Saved “" + name + "” to " + target, "ok", 1600);
    });
  });

  $("#ezNewLib").addEventListener("click", function () {
    askName("New library name", function (name) {
      if (name === BUILT) return J.toast("That name is taken", "warn", 2000);
      var libs = storedLibs();
      if (libs.indexOf(name) < 0) { libs.push(name); J.store.set("ease.libs", libs); }
      lib = name; J.store.set("ease.group", lib);
      renderPresets();
    });
  });

  var delArmed = 0;
  $("#ezDelLib").addEventListener("click", function () {
    var cur = currentLib();
    if (cur === BUILT) return;
    if (Date.now() - delArmed > 2500) { delArmed = Date.now(); J.toast("Click delete again to remove “" + cur + "” and its curves", "warn", 2500); return; }
    delArmed = 0;
    J.store.set("ease.presets", userPresets().filter(function (p) { return (p.group || MINE) !== cur; }));
    J.store.set("ease.libs", storedLibs().filter(function (g) { return g !== cur; }));
    lib = ""; J.store.set("ease.group", lib);
    renderPresets();
    J.toast("Deleted library “" + cur + "”", "", 1800);
  });

  // ---- Flow libraries (.flow = JSON list of { _id, name, value: [x1, y1, x2, y2] })
  var nodeOk = typeof require === "function";
  var fs = nodeOk ? require("fs") : null, path = nodeOk ? require("path") : null;
  var FLOW_DIR = nodeOk ? path.join(process.env.APPDATA || "", "aescripts", "flow", "libraries") : "";

  function sameCurve(a, b) { return a.every(function (v, i) { return Math.abs(v - b[i]) < 1e-4; }); }

  // adds the curves from one .flow file as a library named after the file; returns how many were new
  function importFlowFile(file) {
    var data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data)) throw new Error("not a Flow library");
    var g = path.basename(file).replace(/\.flow$/i, "").trim() || "Flow";
    if (g === BUILT) g = "Built-in (imported)";
    var list = userPresets(), added = 0;
    data.forEach(function (p) {
      var v = p && p.value;
      if (!Array.isArray(v) || v.length !== 4 || v.some(function (x) { return typeof x !== "number" || !isFinite(x); })) return;
      var c = [Math.max(0, Math.min(1, v[0])), v[1], Math.max(0, Math.min(1, v[2])), v[3]];
      var name = String(p.name || "Curve").slice(0, 30);
      if (list.some(function (u) { return (u.group || MINE) === g && u.name === name && sameCurve(u.c, c); })) return;
      list.push({ name: name, c: c, group: g });
      added++;
    });
    J.store.set("ease.presets", list);
    var libs = storedLibs();
    if (libs.indexOf(g) < 0) { libs.push(g); J.store.set("ease.libs", libs); }
    return { group: g, added: added };
  }

  function flowLibraries() {
    try { return fs.readdirSync(FLOW_DIR).filter(function (f) { return /\.flow$/i.test(f); }).map(function (f) { return path.join(FLOW_DIR, f); }); }
    catch (e) { return []; }
  }

  function importAllFlow(quiet) {
    var files = flowLibraries(), total = 0, groups = [];
    files.forEach(function (f) {
      try { var r = importFlowFile(f); if (r.added) { total += r.added; groups.push(r.group + " (" + r.added + ")"); } } catch (e) {}
    });
    renderPresets();
    if (!quiet || total) J.toast(total ? "Imported " + total + " Flow curve" + (total === 1 ? "" : "s") + ": " + groups.join(", ") : files.length ? "Flow curves are already imported" : "No Flow libraries found on this PC", total ? "ok" : "", 3600);
    if (total) J.emit("action", { name: "ease", ok: true, msg: "Imported " + total + " curves from Flow" });
    return total;
  }

  $("#ezImportFlow").addEventListener("click", function () { importAllFlow(false); });

  $("#ezImportFile").addEventListener("click", function () {
    J.host("pickFile", { title: "Choose a Flow library", filter: "*.flow" }).then(function (r) {
      if (!r.ok || !r.path) return;
      try {
        var res = importFlowFile(r.path);
        lib = res.group; J.store.set("ease.group", lib);
        renderPresets();
        J.toast(res.added ? "Imported " + res.added + " curve" + (res.added === 1 ? "" : "s") + " into " + res.group : "Those curves are already here", res.added ? "ok" : "", 2600);
      } catch (e) { J.toast("Couldn't read that file: " + e.message, "bad", 4000); }
    });
  });

  // export the current library in Flow's own format, so Flow can open it too
  $("#ezExport").addEventListener("click", function () {
    var g = currentLib();
    var list = userPresets().filter(function (p) { return (p.group || MINE) === g; });
    if (!list.length) return J.toast("No curves to export in " + g, "warn", 2400);
    var crypto = require("crypto");
    J.host("saveFile", { title: "Export library", name: g + ".flow", filter: "*.flow" }).then(function (r) {
      if (!r.ok || !r.path) return;
      var file = /\.flow$/i.test(r.path) ? r.path : r.path + ".flow";
      var out = list.map(function (p) { return { _id: crypto.randomUUID(), name: p.name, value: p.c }; });
      try {
        fs.writeFileSync(file, JSON.stringify(out, null, 4));
        J.toast("Exported " + out.length + " curve" + (out.length === 1 ? "" : "s") + " to " + path.basename(file), "ok", 2600);
      } catch (e) { J.toast("Export failed: " + e.message, "bad", 4000); }
    });
  });

  if (!nodeOk) { ["#ezImportFile", "#ezExport"].forEach(function (s) { $(s).disabled = true; }); $("#ezImportFlow").style.display = "none"; }
  else {
    if (!flowLibraries().length) $("#ezImportFlow").style.display = "none";
    // your own copy brings Flow's curves in by itself the first time
    if ((window.JWPA_CONFIG || {}).flowAutoImport && !J.store.get("ease.flowImported", false)) {
      J.store.set("ease.flowImported", true);
      setTimeout(function () { importAllFlow(true); }, 400);
    }
  }

  // ---------------------------------------------------------------- apply / read
  var DIR_NAME = { out: "Ease out", in: "Ease in", both: "Ease" };
  function apply() {
    var btn = $("#ezApply");
    if (btn.classList.contains("busy")) return Promise.resolve({ ok: false, error: "busy" });
    btn.classList.add("busy");
    var c = curve.map(r3);
    return J.host("easeApply", { curve: c, dir: dir }).then(function (r) {
      btn.classList.remove("busy");
      if (!r.ok) { J.toast(r.error, "bad", 4200); return r; }
      btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done");
      J.store.set("ease.last", c); drawGhost();
      var msg = DIR_NAME[dir] + " on " + r.segments + " segment" + (r.segments === 1 ? "" : "s") + " · " + r.props + " propert" + (r.props === 1 ? "y" : "ies");
      J.toast(msg, "ok", 2200);
      J.emit("action", { name: "ease", ok: true, msg: msg + " · " + c.join(", ") });
      return r;
    });
  }
  $("#ezApply").addEventListener("click", apply);

  $("#ezRead").addEventListener("click", function () {
    J.host("easeRead").then(function (r) {
      if (!r.ok) return J.toast(r.error, "bad", 3200);
      animateTo([Math.max(0, Math.min(1, r.curve[0])), Math.max(YMIN, Math.min(YMAX, r.curve[1])), Math.max(0, Math.min(1, r.curve[2])), Math.max(YMIN, Math.min(YMAX, r.curve[3]))]);
      J.toast("Read the curve from " + r.prop, "", 1800);
    });
  });

  J.easeApply = apply;
  // for Quick Search
  J.easeLib = {
    curves: function () {
      return BUILT_IN.map(function (p) { return { name: p[0], group: BUILT, c: p[1] }; })
        .concat(userPresets().map(function (p) { return { name: p.name, group: p.group || MINE, c: p.c }; }));
    },
    apply: function (c) { if (morph) { cancelAnimationFrame(morph); morph = null; } curve = c.slice(0, 4); draw(); markPreset(); return apply(); }
  };
  drawGrid();
  drawGhost();
  draw();
  renderDir();
  renderPresets();
})();
