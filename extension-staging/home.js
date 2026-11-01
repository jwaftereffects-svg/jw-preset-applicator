/* JW Preset Applicator Pro - Home tab, Browse tab and Ctrl+K search inside the panel.
 *   Home:   big one-click tiles for the main actions, recent presets, favorites.
 *   Browse: every preset (favorites + After Effects' User Presets) as a tile with its
 *           animated preview when one exists. Click selects, double-click applies.
 *   Ctrl+K: type to jump to any tab, button, setting or preset.
 */
(function () {
  "use strict";
  var J = window.JWPA;
  if (!J) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var nodeOk = typeof require === "function";
  var fs = nodeOk ? require("fs") : null, path = nodeOk ? require("path") : null, os = nodeOk ? require("os") : null;
  var icon = function (n, c) { return J.icon ? J.icon(n, c) : ""; };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function base(p) { return String(p).split(/[\\/]/).pop().replace(/\.ffx$/i, ""); }

  // ---------------------------------------------------------------- presets (favorites + User Presets)
  var userCache = null, userAt = 0;
  function userPresets() {
    if (!nodeOk) return [];
    if (userCache && Date.now() - userAt < 60000) return userCache;
    var out = [], seen = {}, root = path.join(os.homedir(), "Documents", "Adobe");
    var roots = [];
    try { fs.readdirSync(root).forEach(function (n) { if (/^After Effects/i.test(n)) { var p = path.join(root, n, "User Presets"); try { if (fs.statSync(p).isDirectory()) roots.push(p); } catch (e) {} } }); } catch (e) {}
    roots.forEach(function (r) {
      (function walk(dir, depth, top) {
        if (depth > 6 || out.length > 20000) return;
        var ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        ents.forEach(function (e) {
          var p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, depth + 1, top || e.name);
          else if (/\.ffx$/i.test(e.name) && !seen[p.toLowerCase()]) {
            seen[p.toLowerCase()] = 1;
            out.push({ p: p, n: e.name.replace(/\.ffx$/i, ""), folder: top || "User Presets", sub: path.relative(r, dir).split(path.sep).join(" / ") });
          }
        });
      })(r, 0, "");
    });
    out.sort(function (a, b) { return a.n.localeCompare(b.n); });
    userCache = out; userAt = Date.now();
    return out;
  }
  function allPresets() {
    var favs = J.favorites() || [], have = {}, list = [];
    favs.forEach(function (p) { have[p.toLowerCase()] = 1; list.push({ p: p, n: base(p), folder: "★ Favorites", fav: true, sub: "Favorites" }); });
    userPresets().forEach(function (u) { list.push({ p: u.p, n: u.n, folder: u.folder, fav: !!have[u.p.toLowerCase()], sub: u.sub }); });
    return list;
  }

  // ---------------------------------------------------------------- cover art (no preview yet)
  function hashOf(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = (x * 16777619) >>> 0; } return x; }
  function initials(n) {
    var w = n.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
    return ((w[0] || "?").charAt(0) + (w[1] ? w[1].charAt(0) : (w[0] || "").charAt(1) || "")).toUpperCase();
  }
  function coverArt(el, name) {
    if (J.coverArt) return J.coverArt(el, name); // theme-coloured version from skin.js
    var x = hashOf(name), h1 = x % 360, h2 = (h1 + 40 + (x >> 9) % 80) % 360, ang = (x >> 4) % 180;
    el.style.backgroundImage =
      "radial-gradient(circle at " + (20 + (x >> 3) % 60) + "% " + (20 + (x >> 6) % 60) + "%, hsla(" + h2 + ",90%,70%,.55), transparent 55%)," +
      "linear-gradient(" + ang + "deg, hsl(" + h1 + ",65%,38%), hsl(" + h2 + ",70%,22%))";
    el.setAttribute("data-ini", initials(name));
    el.classList.add("art");
  }

  // ---------------------------------------------------------------- shared preset tile
  var flip = null;
  function tile(it, opts) {
    var b = document.createElement("button");
    b.className = "pb-tile" + (J.ui().preset === it.p ? " on" : "");
    b.innerHTML = '<i class="pb-thumb"></i><span class="pb-name"></span>' + (it.fav ? '<i class="pb-star">★</i>' : "");
    b.querySelector(".pb-name").textContent = it.n;
    b.setAttribute("data-tip", it.n + (it.sub ? " · " + it.sub : "") + (opts && opts.clickApplies ? " · click to apply" : " · click to select, double-click to apply"));
    var frames = J.previewFrames ? J.previewFrames(it.p) : null, th = b.querySelector(".pb-thumb");
    if (frames) { th.style.backgroundImage = "url(" + J.fileUrl(frames[Math.floor(frames.length / 2)]) + ")"; th.classList.add("has"); }
    else coverArt(th, it.n);
    b.addEventListener("mouseenter", function () {
      if (!frames) return;
      var i = 0; clearInterval(flip);
      flip = setInterval(function () { i = (i + 1) % frames.length; th.style.backgroundImage = "url(" + J.fileUrl(frames[i]) + ")"; }, 110);
    });
    b.addEventListener("mouseleave", function () { clearInterval(flip); flip = null; if (frames) th.style.backgroundImage = "url(" + J.fileUrl(frames[Math.floor(frames.length / 2)]) + ")"; });
    if (opts && opts.clickApplies) b.addEventListener("click", function () { applyPreset(it.p); });
    else {
      b.addEventListener("click", function () { J.setPreset(it.p); $$(".pb-tile.on").forEach(function (t) { t.classList.remove("on"); }); b.classList.add("on"); showDetail(it); });
      b.addEventListener("dblclick", function () { applyPreset(it.p); });
    }
    return b;
  }
  function applyPreset(p) { J.setPreset(p); J.runAction("effect"); }

  // ---------------------------------------------------------------- Home
  var TILES = [
    { ic: "wand", t: "Apply Preset", s: function () { var p = J.ui().preset; return p ? base(p) : "pick a preset first"; }, go: function () { J.runAction("effect"); } },
    { ic: "stack", t: "Precompose", s: function () { return "selected layers"; }, go: function () { J.runAction("precomp"); } },
    { ic: "sliders", t: "Adjustment Layers", s: function () { return "with the preset"; }, go: function () { J.runAction("adjustment"); } },
    { ic: "film", t: "Quick Export", s: function () { return "in the background"; }, go: function () { var b = $("#qxSend"); if (b) b.click(); } },
    { ic: "play", t: "Pre-render", s: function () { return "instant preview"; }, go: function () { var b = $("#pvSend"); if (b) b.click(); } },
    { ic: "ai", t: "Send to Topaz", s: function () { return "enhance"; }, go: function () { var b = $("#tzSend"); if (b) b.click(); } }
  ];
  function renderTiles() {
    var box = $("#homeTiles");
    if (!box) return;
    box.innerHTML = "";
    TILES.forEach(function (t, i) {
      var b = document.createElement("button");
      b.className = "home-tile";
      b.style.animationDelay = (i * 0.04) + "s";
      b.style.setProperty("--hue", (i * 38) + "deg");
      b.innerHTML = '<span class="ht-ic">' + icon(t.ic) + '</span><span class="ht-t"></span><span class="ht-s"></span>';
      b.querySelector(".ht-t").textContent = t.t;
      b.querySelector(".ht-s").textContent = t.s();
      b.addEventListener("click", function () {
        b.classList.remove("hit"); void b.offsetWidth; b.classList.add("hit");
        t.go();
      });
      box.appendChild(b);
    });
  }
  function recentList() { return J.store.get("home.recent", []) || []; }
  function renderRecent() {
    var box = $("#homeRecent");
    if (!box) return;
    box.innerHTML = "";
    var list = recentList().filter(function (p) { return !nodeOk || fs.existsSync(p); }).slice(0, 10);
    box.classList.toggle("empty", !list.length);
    if (!list.length) { box.innerHTML = '<p class="muted small ly-empty">Presets you apply show up here.</p>'; return; }
    list.forEach(function (p) { box.appendChild(tile({ p: p, n: base(p) }, { clickApplies: true })); });
  }
  function renderFavs() {
    var box = $("#homeFavs");
    if (!box) return;
    box.innerHTML = "";
    var favs = (J.favorites() || []).slice(0, 24);
    if (!favs.length) { box.innerHTML = '<p class="muted small ly-empty">Star presets in the Effect tab to pin them here.</p>'; return; }
    favs.forEach(function (p) { box.appendChild(tile({ p: p, n: base(p), fav: true }, { clickApplies: true })); });
  }
  function greeting() { var h = new Date().getHours(); return h < 5 ? "Late night edit" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
  function todayKey() { var d = new Date(); return "home.stats." + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function renderHero() {
    if (!$("#homeHero")) return;
    $("#hhGreet").textContent = greeting();
    var p = J.ui().preset, th = $("#hhThumb");
    $("#hhPname").textContent = p ? base(p) : "None yet \u00B7 press Browse to pick one";
    th.className = "hh-thumb"; th.style.backgroundImage = ""; th.removeAttribute("data-ini");
    if (p) coverArt(th, base(p));
    $("#hhApply").disabled = !p;
    var st = J.store.get(todayKey(), {}) || {};
    var bits = [["wand", st.effect || 0, "presets applied"], ["stack", st.precomp || 0, "precomps"], ["film", st.export || 0, "exports"]];
    $("#hhStats").innerHTML = bits.map(function (b) { return '<span class="hh-stat">' + icon(b[0], "ic") + "<b>" + b[1] + "</b> " + b[2] + "</span>"; }).join("") + '<span class="hh-today">today</span>';
    J.host("selection").then(function (r) {
      if (!r || !r.ok) { $("#hhComp").textContent = nodeOk ? "After Effects is busy" : "Open in After Effects"; return; }
      $("#hhComp").textContent = r.comp ? "in \u201C" + r.comp + "\u201D" : "No comp open";
      var sel = $("#hhSel");
      sel.querySelector("b").textContent = r.count;
      sel.classList.toggle("on", r.count > 0);
    });
  }
  if ($("#hhApply")) $("#hhApply").addEventListener("click", function () { J.runAction("effect"); });
  function renderHome() { renderHero(); renderTiles(); renderRecent(); renderFavs(); }

  J.on(function (type, d) {
    if (type === "action" && d && d.ok && /^(effect|precomp|export|adjustment)$/.test(d.name)) {
      var st = J.store.get(todayKey(), {}) || {}, k = d.name === "adjustment" ? "effect" : d.name;
      st[k] = (st[k] || 0) + 1; J.store.set(todayKey(), st);
      if (isOn("home")) renderHero();
    }
    if (type === "action" && d && d.ok && (d.name === "effect" || d.name === "adjustment") && d.preset) {
      J.store.set("home.recent", [d.preset].concat(recentList().filter(function (p) { return p !== d.preset; })).slice(0, 20));
      if (isOn("home")) renderHome();
    }
    if (type === "preset" && isOn("home")) { renderTiles(); renderHero(); }
    if (type === "favorites" && isOn("home")) renderFavs();
  });

  // ---------------------------------------------------------------- Browse
  var folder = J.store.get("pb.folder", ""), shownCount = 60, query = "";
  function folderList(all) {
    var seen = {}, out = [];
    all.forEach(function (it) { if (!seen[it.folder]) { seen[it.folder] = 1; out.push(it.folder); } });
    return out.sort(function (a, b) { return (a.charAt(0) === "★" ? -1 : b.charAt(0) === "★" ? 1 : a.localeCompare(b)); });
  }
  var sortBy = J.store.get("pb.sort", "az");
  function filtered() {
    var all = allPresets(), q = query.trim().toLowerCase();
    if (sortBy === "recent") {
      var rank = {}; recentList().forEach(function (p, i) { rank[p] = 1000 - i; });
      all = all.slice().sort(function (a, b) { return (rank[b.p] || 0) - (rank[a.p] || 0) || a.n.localeCompare(b.n); });
    }
    return all.filter(function (it) {
      if (folder && it.folder !== folder && !(folder === "★ Favorites" && it.fav)) return false;
      return !q || it.n.toLowerCase().indexOf(q) >= 0 || (it.sub || "").toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderBrowse() {
    var grid = $("#pbGrid"), chips = $("#pbFolders");
    if (!grid) return;
    var all = allPresets();
    chips.innerHTML = "";
    [""].concat(folderList(all)).forEach(function (f) {
      var c = document.createElement("button");
      c.className = "ly-chip" + (f === folder ? " on" : "");
      c.textContent = (f || "All") + " " + (f ? all.filter(function (it) { return it.folder === f; }).length : all.length);
      c.addEventListener("click", function () { folder = f; J.store.set("pb.folder", f); shownCount = 60; renderBrowse(); });
      chips.appendChild(c);
    });
    var list = filtered();
    grid.innerHTML = "";
    if (!list.length) grid.innerHTML = '<p class="muted small ly-empty">' + (all.length ? "Nothing matches." : nodeOk ? "No presets found in your User Presets folder yet." : "The preset browser works inside After Effects.") + "</p>";
    list.slice(0, shownCount).forEach(function (it) { grid.appendChild(tile(it)); });
    $("#pbMore").style.display = list.length > shownCount ? "" : "none";
    var withPv = list.slice(0, shownCount).filter(function (it) { return J.previewFrames && J.previewFrames(it.p); }).length;
    $("#pbInfo").textContent = list.length + " preset" + (list.length === 1 ? "" : "s") + (list.length > shownCount ? " · showing " + shownCount : "") + " · " + withPv + " with previews";
  }
  var detailItem = null;
  function showDetail(it) {
    var bar = $("#pbDetail");
    if (!bar) return;
    detailItem = it;
    $("#pbDname").textContent = it.n;
    $("#pbDfolder").textContent = it.sub || it.folder || "";
    var th = $("#pbDthumb"), frames = J.previewFrames ? J.previewFrames(it.p) : null;
    th.className = "pb-dthumb"; th.style.backgroundImage = ""; th.removeAttribute("data-ini");
    if (frames) th.style.backgroundImage = "url(" + J.fileUrl(frames[Math.floor(frames.length / 2)]) + ")"; else coverArt(th, it.n);
    $("#pbDprev").style.display = frames ? "none" : "";
    bar.classList.remove("show"); void bar.offsetWidth; bar.classList.add("show");
  }
  if ($("#pbDapply")) {
    $("#pbDapply").addEventListener("click", function () { if (detailItem) applyPreset(detailItem.p); });
    $("#pbDprev").addEventListener("click", function () {
      if (!detailItem) return;
      var it = detailItem, b = $("#pbDprev"); b.disabled = true; b.textContent = "Making\u2026";
      J.makePreviewFor(it.p).then(function () { b.disabled = false; b.textContent = "Preview"; renderBrowse(); showDetail(it); });
    });
    $$("#pbSort button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.sort === sortBy);
      b.addEventListener("click", function () { sortBy = b.dataset.sort; J.store.set("pb.sort", sortBy); $$("#pbSort button").forEach(function (x) { x.classList.toggle("on", x === b); }); shownCount = 60; renderBrowse(); });
    });
  }
  if ($("#pbSearch")) {
    var st = null;
    $("#pbSearch").addEventListener("input", function (e) { clearTimeout(st); st = setTimeout(function () { query = e.target.value; shownCount = 60; renderBrowse(); }, 120); });
    $("#pbSearch").addEventListener("keydown", function (e) { e.stopPropagation(); });
    $("#pbMore").addEventListener("click", function () { shownCount += 60; renderBrowse(); });
    // previews for the shown presets that don't have one: one at a time, stoppable
    var making = false;
    $("#pbMake").addEventListener("click", function () {
      var btn = $("#pbMake");
      if (making) { making = false; return; }
      var todo = filtered().slice(0, shownCount).filter(function (it) { return !(J.previewFrames && J.previewFrames(it.p)); });
      if (!todo.length) return J.toast("Every preset shown already has a preview", "ok", 2200);
      making = true;
      var done = 0, label = function () { btn.textContent = "Stop (" + done + "/" + todo.length + ")"; };
      label();
      (function next() {
        if (!making || !todo.length) {
          making = false; btn.textContent = "Make previews"; renderBrowse();
          return J.toast("Made " + done + " preview" + (done === 1 ? "" : "s"), "ok", 2400);
        }
        var it = todo.shift();
        J.makePreviewFor(it.p).then(function (ok) { if (ok) done++; label(); setTimeout(next, 250); });
      })();
    });
  }

  // ---------------------------------------------------------------- render when a tab is opened
  function isOn(page) { var p = $('.page[data-page="' + page + '"]'); return p && p.classList.contains("active"); }
  $$(".page").forEach(function (p) {
    new MutationObserver(function () {
      if (!p.classList.contains("active")) return;
      if (p.dataset.page === "home") renderHome();
      if (p.dataset.page === "browse") renderBrowse();
    }).observe(p, { attributes: true, attributeFilter: ["class"] });
  });
  setTimeout(function () { if (isOn("home")) renderHome(); if (isOn("browse")) renderBrowse(); }, 200);

  // ---------------------------------------------------------------- Ctrl+K: search the whole panel
  var pal = document.createElement("div");
  pal.className = "kpal";
  pal.innerHTML = '<div class="kpal-box"><div class="kpal-in">' + icon("sparkle", "ic") + '<input type="text" spellcheck="false" placeholder="Jump to a tab, tool, setting or preset"><kbd>Esc</kbd></div><div class="kpal-list"></div></div>';
  document.body.appendChild(pal);
  var kin = $("input", pal), klist = $(".kpal-list", pal), kitems = [], kcur = 0, kshown = [];

  function labelOf(el) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t || el.getAttribute("data-tip") || el.getAttribute("title") || "";
  }
  function pageOf(el) { var p = el.closest(".page"); return p ? p.dataset.page : ""; }
  var PAGE_NAME = { home: "Home", tools: "Tools", browse: "Browse", effect: "Effect", precomp: "Precomp", adjustment: "Adjust", topaz: "Quality", layers: "Layers", ease: "Ease", audio: "Audio", settings: "Settings" };
  function collect() {
    var out = [];
    $$(".tab").forEach(function (t) { out.push({ kind: "Tab", n: labelOf(t), go: function () { J.setTab(t.dataset.tab); } }); });
    out.push({ kind: "Tab", n: "Settings", go: function () { J.setTab("settings"); } });
    $$(".page button.btn, .page button.home-tile").forEach(function (b) {
      var n = labelOf(b), pg = pageOf(b);
      if (!n || n.length > 60 || pg === "browse" || b.closest(".kpal") || b.classList.contains("pb-tile")) return;
      out.push({ kind: "Tool · " + (PAGE_NAME[pg] || ""), n: n, go: function () { J.setTab(pg); setTimeout(function () { b.click(); }, 60); } });
    });
    $$(".page label.switch").forEach(function (l) {
      var inp = $("input", l), pg = pageOf(l), n = labelOf(l);
      if (!inp || !n || pg === "browse") return;
      out.push({ kind: "Setting · " + (PAGE_NAME[pg] || ""), n: n, sw: inp, go: function () { J.setTab(pg); inp.click(); J.toast(n + ": " + (inp.checked ? "on" : "off"), "", 1600); } });
    });
    allPresets().slice(0, 8000).forEach(function (it) { out.push({ kind: "Preset · " + it.folder, n: it.n, go: function () { J.setPreset(it.p); J.toast("Selected " + it.n, "", 1400); } }); });
    return out;
  }
  function score(n, q) {
    n = n.toLowerCase();
    var i = n.indexOf(q);
    if (i === 0) return 1000 - n.length;
    if (i > 0) return (/[\s\-_]/.test(n[i - 1]) ? 800 : 500) - n.length * 0.1;
    var pos = -1;
    for (var k = 0; k < q.length; k++) { pos = n.indexOf(q[k], pos + 1); if (pos < 0) return 0; }
    return 100 - n.length * 0.1;
  }
  function renderPal() {
    var q = kin.value.trim().toLowerCase();
    kshown = (q ? kitems.map(function (it) { return { it: it, s: score(it.n, q) - (/^Preset/.test(it.kind) ? 50 : 0) }; }).filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.it; }) : kitems.filter(function (it) { return it.kind === "Tab" || /^Tool/.test(it.kind); })).slice(0, 40);
    kcur = Math.min(kcur, Math.max(0, kshown.length - 1));
    klist.innerHTML = kshown.length ? kshown.map(function (it, i) {
      var state = it.sw ? '<i class="kp-sw' + (it.sw.checked ? " on" : "") + '"></i>' : "";
      return '<div class="kp-row' + (i === kcur ? " cur" : "") + '" data-i="' + i + '"><span class="kp-n">' + esc(it.n) + '</span><span class="kp-k">' + esc(it.kind) + "</span>" + state + "</div>";
    }).join("") : '<p class="muted small kp-empty">Nothing matches.</p>';
    var c = $(".kp-row.cur", klist); if (c) c.scrollIntoView({ block: "nearest" });
  }
  function openPal() { kitems = collect(); kin.value = ""; kcur = 0; pal.classList.add("open"); renderPal(); setTimeout(function () { kin.focus(); }, 0); }
  function closePal() { pal.classList.remove("open"); kin.blur(); }
  function runPal(i) { var it = kshown[i]; if (!it) return; closePal(); it.go(); }
  kin.addEventListener("input", function () { kcur = 0; renderPal(); });
  kin.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); closePal(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (kshown.length) { kcur = (kcur + (e.key === "ArrowDown" ? 1 : -1) + kshown.length) % kshown.length; renderPal(); } }
    else if (e.key === "Enter") { e.preventDefault(); runPal(kcur); }
  });
  klist.addEventListener("mousedown", function (e) { e.preventDefault(); });
  klist.addEventListener("click", function (e) { var r = e.target.closest(".kp-row"); if (r) runPal(+r.dataset.i); });
  pal.addEventListener("mousedown", function (e) { if (e.target === pal) closePal(); });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (pal.classList.contains("open")) closePal(); else openPal(); }
  }, true);
  J.openSearch = openPal;
})();
