/* JW Quick Search: the Ctrl+Space popup.
 *
 * This window only shows things and sends requests; the main JW panel does the work
 * (so presets use your Effect-tab options, toasts and the action log keep working).
 *   popup -> panel: com.jwpa.quick.req  { cmd: "data" | "run" | "fav" | "hide", ... }
 *   panel -> popup: com.jwpa.quick.data { items, favs, recent, theme }
 *                   com.jwpa.quick.show (the helper just showed this window)
 */
(function () {
  "use strict";
  var cep = window.__adobe_cep__;
  var $ = function (s) { return document.querySelector(s); };
  var input = $("#qInput"), rowsBox = $("#qRows"), list = $("#qList"), selBox = $("#qSel");

  var items = [], favs = {}, recent = [], tab = "all", cur = 0, shown = [];
  var TYPE_NAME = { fx: "Effect", ffx: "Preset", ly: "Saved layer", ez: "Curve" };

  // ---------------------------------------------------------------- talking to the main panel
  // Through small files in %APPDATA%JWPAquick (After Effects doesn't pass events between
  // this window and the panel reliably):
  //   data.json   written by the panel: { items, favs, recent, theme }
  //   show.stamp  touched by the panel each time Ctrl+Space shows this window
  //   cmd*.json  written here, one file per request; the panel reads and deletes them
  var nodeOk = !!cep && typeof require === "function";
  var fs = nodeOk ? require("fs") : null, path = nodeOk ? require("path") : null, os = nodeOk ? require("os") : null;
  var IPC = nodeOk ? path.join(process.env.APPDATA || os.homedir(), "JWPA", "quick") : "";
  var seq = 0;

  function send(cmd, extra) {
    var data = Object.assign({ cmd: cmd }, extra || {});
    if (!nodeOk) return demo(data);
    try {
      var dir = path.join(IPC, "cmd");
      fs.mkdirSync(dir, { recursive: true });
      var name = Date.now() + "-" + (seq++) + "-" + Math.random().toString(36).slice(2, 7);
      fs.writeFileSync(path.join(dir, name + ".tmp"), JSON.stringify(data));
      fs.renameSync(path.join(dir, name + ".tmp"), path.join(dir, name + ".json")); // appears complete
    } catch (e) {}
  }

  // AE can reopen this window by itself when it starts (it remembers open windows).
  // Only stay open if the panel asked for it in the last few seconds.
  (function guard() {
    if (!nodeOk) return;
    try {
      var flag = path.join(os.tmpdir(), "jwpa-quick-open.flag");
      if (Date.now() - fs.statSync(flag).mtimeMs > 8000) throw new Error("not requested");
    } catch (e) { try { cep.closeExtension(); } catch (x) {} }
  })();

  var lastData = 0;
  function readData(force) {
    if (!nodeOk) return false;
    try {
      var f = path.join(IPC, "data.json"), m = fs.statSync(f).mtimeMs;
      if (!force && m === lastData) return false;
      var d = JSON.parse(fs.readFileSync(f, "utf8"));
      lastData = m;
      items = d.items || [];
      favs = {}; (d.favs || []).forEach(function (k) { favs[k] = 1; });
      recent = d.recent || [];
      if (d.theme) applyTheme(d.theme);
      return true;
    } catch (e) { return false; }
  }
  readData(true);

  // new data or a fresh Ctrl+Space: check the files (cheap) a few times a second while visible
  var lastShow = 0, tick = 0;
  try { lastShow = fs.statSync(path.join(IPC, "show.stamp")).mtimeMs; } catch (e) {}
  if (nodeOk) setInterval(function () {
    if (document.hidden && !document.hasFocus()) { tick = (tick + 1) % 8; if (tick) return; } // hidden: check ~twice a second
    var showM = 0;
    try { showM = fs.statSync(path.join(IPC, "show.stamp")).mtimeMs; } catch (e) {}
    if (showM && showM !== lastShow) { lastShow = showM; readData(false); open(); return; }
    if (!document.hidden && readData(false)) render(false);
  }, 60);

  function applyTheme(t) { Object.keys(t).forEach(function (k) { document.documentElement.style.setProperty(k, t[k]); }); }

  // fresh start every time it pops up
  function open() {
    input.value = "";
    tab = tab === "fav" ? "fav" : "all";
    setTab(tab, true);
    var q = $("#q");
    q.classList.remove("open"); void q.offsetWidth; q.classList.add("open");
    input.focus();
    send("data");
    requestAnimationFrame(function () { placeInd(true); fitWindow(); });
    var until = Date.now() + 1200;
    (function hold() {
      if (document.activeElement !== input) { log("search box lost focus to " + (document.activeElement && document.activeElement.tagName)); input.focus(); }
      if (Date.now() < until) setTimeout(hold, 40);
    })();
  }
  function log(t) {
    if (!nodeOk) return;
    try { fs.appendFileSync(path.join(os.tmpdir(), "jwquick.log"), new Date().toTimeString().slice(0, 8) + "  popup: " + t + String.fromCharCode(10)); } catch (e) {}
  }
  window.addEventListener("blur", function () { log("window lost focus"); });
  window.addEventListener("focus", function () { input.focus(); placeInd(true); });
  // typing goes into the search box even if focus landed somewhere else in the window
  document.addEventListener("keydown", function (e) {
    if (document.activeElement !== input && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) input.focus();
  }, true);

  // ---------------------------------------------------------------- search
  // score: whole word starts > name starts > word starts inside > substring > letters in order
  function score(name, q) {
    var n = name.toLowerCase();
    if (!q) return 1;
    var i = n.indexOf(q);
    if (i === 0) return 1000 - n.length;
    // initials: "gb" -> Gaussian Blur, "ccl" -> CC Light...
    if (q.length >= 2 && q.indexOf(" ") < 0) {
      var initials = n.split(/[\s\-_.()/:]+/).filter(Boolean).map(function (w) { return w[0]; }).join("");
      if (initials.indexOf(q) === 0) return 900 - n.length * 0.1;
    }
    if (i > 0) {
      var wordStart = /[\s\-_.()]/.test(n[i - 1]);
      return (wordStart ? 800 : 500) - i - n.length * 0.1;
    }
    // initials / letters in order ("gb" -> Gaussian Blur)
    var pos = -1, gaps = 0;
    for (var k = 0; k < q.length; k++) {
      if (q[k] === " ") continue;
      var nx = n.indexOf(q[k], pos + 1);
      if (nx < 0) return 0;
      gaps += nx - pos - 1;
      pos = nx;
    }
    return 200 - gaps - n.length * 0.1;
  }

  function matchRanges(name, q) {
    if (!q) return [];
    var n = name.toLowerCase(), i = n.indexOf(q);
    if (i >= 0) return [[i, i + q.length]];
    var out = [], pos = -1;
    for (var k = 0; k < q.length; k++) {
      if (q[k] === " ") continue;
      var nx = n.indexOf(q[k], pos + 1);
      if (nx < 0) return [];
      out.push([nx, nx + 1]);
      pos = nx;
    }
    return out;
  }

  function inTab(it) { return tab === "all" || (tab === "fav" ? favs[it.k] : it.t === tab); }

  function results() {
    var q = input.value.trim().toLowerCase();
    var recentRank = {};
    recent.forEach(function (k, i) { recentRank[k] = recent.length - i; });
    if (!q) {
      var favOnly = items.filter(function (it) { return favs[it.k]; }).sort(byName);
      return favOnly.length ? [{ head: "Favorites", list: favOnly }] : [];
    }
    if (!q) {
      // nothing typed: favorites, then recent, then (for type tabs) everything A-Z
      var groups = [];
      var favList = items.filter(function (it) { return favs[it.k] && inTab(it); });
      if (favList.length) groups.push({ head: "Favorites", list: favList.sort(byName) });
      if (tab !== "fav") {
        var rec = recent.map(function (k) { return byKey[k]; }).filter(function (it) { return it && !favs[it.k] && inTab(it); }).slice(0, 8);
        if (rec.length) groups.push({ head: "Recent", list: rec });
        if (tab !== "all") groups.push({ head: TYPE_NAME[tab] + "s", list: items.filter(function (it) { return inTab(it) && !favs[it.k]; }).sort(byName).slice(0, 150) });
      }
      return groups;
    }
    var hits = [];
    items.forEach(function (it) {
      if (!inTab(it)) return;
      var s = score(it.n, q);
      if (!s && it.s) s = score(it.s, q) * 0.3; // category / folder also counts a little
      if (s > 0) hits.push({ it: it, s: s + (favs[it.k] ? 120 : 0) + (recentRank[it.k] || 0) * 6 });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    return [{ head: "", list: hits.slice(0, 80).map(function (h) { return h.it; }) }];
  }
  function byName(a, b) { return a.n.localeCompare(b.n); }
  var byKey = {};

  // ---------------------------------------------------------------- drawing
  var STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
  function icon(it) {
    if (it.t === "ez" && it.c) {
      var c = it.c, X = function (x) { return 1 + x * 18; }, Y = function (y) { return 12 - y * 10; };
      return '<svg viewBox="0 0 20 14"><path d="M' + X(0) + "," + Y(0) + " C" + X(c[0]) + "," + Y(c[1]) + " " + X(c[2]) + "," + Y(c[3]) + " " + X(1) + "," + Y(1) + '"/></svg>';
    }
    return { fx: "fx", ffx: "ffx", ly: "▣" }[it.t] || "";
  }

  function nameHtml(name, q) {
    var r = matchRanges(name, q), out = "", at = 0;
    r.forEach(function (m) { out += esc(name.slice(at, m[0])) + "<mark>" + esc(name.slice(m[0], m[1])) + "</mark>"; at = m[1]; });
    return out + esc(name.slice(at));
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function render(animate) {
    byKey = {}; items.forEach(function (it) { byKey[it.k] = it; });
    var q = input.value.trim().toLowerCase(), groups = results(), html = "", i = 0;
    shown = [];
    groups.forEach(function (g) {
      if (g.head) html += '<div class="q-head">' + esc(g.head) + "</div>";
      g.list.forEach(function (it) {
        html += '<div class="q-row' + (favs[it.k] ? " fav" : "") + '" data-i="' + i + '"' + (animate ? ' style="animation-delay:' + Math.min(i, 10) * 0.018 + 's"' : ' style="animation:none"') + ">" +
          '<i class="q-ic ' + it.t + '">' + icon(it) + "</i>" +
          '<div class="q-txt"><b>' + nameHtml(it.n, q) + "</b><span>" + esc(TYPE_NAME[it.t] + (it.s ? " · " + it.s : "")) + "</span></div>" +
          '<button class="q-star" title="Favorite (Ctrl+D)">' + STAR + "</button>" +
          '<kbd class="q-enter">Enter</kbd></div>';
        shown.push(it); i++;
      });
    });
    if (!shown.length) {
      if (!q) html = "";
      else html = '<div class="q-empty">' + (q ? "Nothing matches <b>" + esc(input.value.trim()) + "</b>" :
        tab === "fav" ? "No favorites yet.<br>Hover anything and click the <b>★</b>, or press <b>Ctrl+D</b>." :
        items.length ? "Type to search " + items.length + " things" : "Loading…") + "</div>";
    }
    rowsBox.innerHTML = html;
    list.classList.toggle("none", !shown.length);
    if (pendingRun && shown.length && Date.now() - pendingRun.at < 3000) { var pr = pendingRun; pendingRun = null; setTimeout(function () { run(0, pr.keep); }, 0); }
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    if (q) cur = 0;
    moveSel(false);
    fitWindow();
  }

  var lastH = 0;
  function fitWindow() {
    requestAnimationFrame(function () {
      var h = Math.ceil($("#q").getBoundingClientRect().height * (window.devicePixelRatio || 1));
      if (Math.abs(h - lastH) > 1) { lastH = h; send("size", { h: h }); }
    });
  }

  function rowEl(i) { return rowsBox.querySelector('.q-row[data-i="' + i + '"]'); }
  function moveSel(scroll) {
    Array.prototype.forEach.call(rowsBox.querySelectorAll(".q-row.cur"), function (r) { r.classList.remove("cur"); });
    var r = rowEl(cur);
    if (!r) { selBox.classList.remove("on"); return; }
    r.classList.add("cur");
    selBox.classList.add("on");
    selBox.style.transform = "translateY(" + (r.offsetTop) + "px)";
    selBox.style.height = r.offsetHeight + "px";
    if (scroll !== false) {
      var top = r.offsetTop, bottom = top + r.offsetHeight;
      if (top < list.scrollTop + 4) list.scrollTop = top - 30;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6;
    }
  }

  // ---------------------------------------------------------------- tabs
  var TABS = ["all", "fav", "fx", "ffx", "ly", "ez"];
  function placeInd(instant) {
    var b = document.querySelector("#qTabs button.on"), ind = $("#qTabInd");
    if (!b || !b.offsetWidth) return;
    if (instant) ind.style.transition = "none";
    ind.style.width = b.offsetWidth + "px";
    ind.style.transform = "translateX(" + b.offsetLeft + "px)";
    if (instant) { void ind.offsetWidth; ind.style.transition = ""; }
  }
  window.addEventListener("resize", function () { placeInd(true); });

  function setTab(t, instant) {
    tab = t;
    var ind = $("#qTabInd");
    Array.prototype.forEach.call(document.querySelectorAll("#qTabs button"), function (b) {
      var onTab = b.dataset.tab === t;
      b.classList.toggle("on", onTab);
      if (onTab) {
        if (instant) ind.style.transition = "none";
        ind.style.width = b.offsetWidth + "px";
        ind.style.transform = "translateX(" + b.offsetLeft + "px)";
        if (instant) { void ind.offsetWidth; ind.style.transition = ""; }
      }
    });
    cur = 0;
    render(true);
    list.scrollTop = 0;
    requestAnimationFrame(function () { placeInd(instant); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#qTabs button"), function (b) {
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function () { setTab(b.dataset.tab); input.focus(); });
  });

  // ---------------------------------------------------------------- actions
  var pendingRun = null;
  function run(i, keep) {
    var it = shown[i];
    if (!it) {
      // Enter pressed before the list was ready: do it as soon as results appear
      if (input.value.trim()) { pendingRun = { keep: !!keep, at: Date.now() }; log("enter before results, waiting"); }
      return;
    }
    var r = rowEl(i);
    if (r) { r.classList.remove("fired"); void r.offsetWidth; r.classList.add("fired"); }
    recent = [it.k].concat(recent.filter(function (k) { return k !== it.k; })).slice(0, 30);
    send("run", { item: it, keep: !!keep });
  }

  function toggleFav(i) {
    var it = shown[i];
    if (!it) return;
    var onNow = !favs[it.k];
    if (onNow) favs[it.k] = 1; else delete favs[it.k];
    var r = rowEl(i);
    if (r) {
      r.classList.toggle("fav", onNow);
      var s = r.querySelector(".q-star"); s.classList.remove("pop"); void s.offsetWidth; s.classList.add("pop");
    }
    send("fav", { key: it.k, on: onNow });
    if (tab === "fav" && !onNow) setTimeout(function () { render(false); }, 250);
  }

  rowsBox.addEventListener("mousedown", function (e) { e.preventDefault(); });
  rowsBox.addEventListener("click", function (e) {
    var r = e.target.closest(".q-row");
    if (!r) return;
    var i = +r.dataset.i;
    if (e.target.closest(".q-star")) return toggleFav(i);
    cur = i; moveSel(false);
    run(i, e.shiftKey);
  });
  rowsBox.addEventListener("mousemove", function (e) {
    var r = e.target.closest(".q-row");
    if (r && +r.dataset.i !== cur) { cur = +r.dataset.i; moveSel(false); }
  });

  input.addEventListener("input", function () { render(true); list.scrollTop = 0; });
  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (shown.length) { cur = (cur + (k === "ArrowDown" ? 1 : -1) + shown.length) % shown.length; moveSel(); }
    } else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      cur = Math.max(0, Math.min(shown.length - 1, cur + (k === "PageDown" ? 8 : -8))); moveSel();
    } else if (k === "Enter") {
      e.preventDefault(); run(cur, e.shiftKey);
    } else if (k === "Tab") {
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && (k === "d" || k === "D")) {
      e.preventDefault(); toggleFav(cur);
    } else if (k === "Escape") {
      e.preventDefault(); send("hide");
    }
  });

  // ---------------------------------------------------------------- preview outside After Effects
  function demo(d) {
    if (d.cmd !== "data" || items.length) return;
    var fx = [["Gaussian Blur", "Blur & Sharpen"], ["Directional Blur", "Blur & Sharpen"], ["Camera Lens Blur", "Blur & Sharpen"], ["S_BlurMoCurves", "Sapphire Blur+Sharpen"],
      ["Deep Glow", "Stylize"], ["Glow", "Stylize"], ["Curves", "Color Correction"], ["Hue/Saturation", "Color Correction"], ["Lumetri Color", "Color Correction"],
      ["Transform", "Distort"], ["Optics Compensation", "Distort"], ["Turbulent Displace", "Distort"], ["Wave Warp", "Distort"], ["Motion Tile", "Stylize"],
      ["RSMB Pro", "RE:Vision Plug-ins"], ["Twixtor Pro", "RE:Vision Plug-ins"], ["Fill", "Generate"], ["Gradient Ramp", "Generate"], ["Exposure", "Color Correction"], ["Echo", "Time"]];
    var it = fx.map(function (f) { return { k: "fx:" + f[0], t: "fx", n: f[0], s: f[1] }; })
      .concat(["shake hard", "flash white", "zoom in smooth", "rgb split", "velocity blur"].map(function (n) { return { k: "ffx:" + n, t: "ffx", n: n, s: "Favorites" }; }))
      .concat(["Glow pack", "Shake", "Light leak"].map(function (n) { return { k: "ly:" + n, t: "ly", n: n, s: "precomp" }; }))
      .concat([["Smooth", [0.45, 0, 0.55, 1]], ["Expo Out", [0.16, 1, 0.3, 1]], ["Back Out", [0.34, 1.56, 0.64, 1]]].map(function (c) { return { k: "ez:" + c[0], t: "ez", n: c[0], s: "Built-in", c: c[1] }; }));
    setTimeout(function () {
      items = it; favs = { "fx:Deep Glow": 1, "ffx:shake hard": 1 }; recent = ["fx:Gaussian Blur", "ez:Expo Out"];
      render(true);
    }, 60);
  }

  open();
})();
