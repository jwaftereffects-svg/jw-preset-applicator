/* JW Preset Applicator Pro - Layer Library tab
 *
 * Saved layers live as files in Documents\JW Layer Library (sub-folders = folders in the tab).
 *   .jwl  = saved by this panel
 *   .vrs  = Verse Flow layer presets (same data layout, inserted as-is)
 * Deleting moves a file to the library's _Trash folder instead of erasing it.
 */
(function () {
  "use strict";
  var J = window.JWPA;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  if (!J) return;
  if (typeof require !== "function") {
    var l = $("#lyList"); if (l) l.innerHTML = '<p class="muted small">The layer library only works inside After Effects.</p>';
    return;
  }
  var fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");

  var LIB = path.join(os.homedir(), "Documents", "JW Layer Library");
  var TRASH = path.join(LIB, "_Trash");
  var VF_DIR = path.join(os.homedir(), "Documents", "VerseFlow", "Presets", "Layer Presets");
  var EXT_RE = /\.(jwl|vrs)$/i;

  var items = [], folderFilter = J.store.get("ly.folder", ""), query = "";

  function ensureLib() { try { fs.mkdirSync(LIB, { recursive: true }); } catch (e) {} }

  function safeName(s) { return String(s || "").replace(/[\\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "Layers"; }

  function readPreset(file) {
    var j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j || !j.layers || !/LayerPreset$/.test(j.format || "")) throw new Error("not a layer preset");
    return j;
  }

  // Summary shown in the list (without keeping whole presets in memory)
  function summarize(file, folder) {
    var st = fs.statSync(file), j;
    try { j = readPreset(file); } catch (e) { return null; }
    var kinds = {}, tMin = 1e9, tMax = -1e9, comps = 0;
    j.layers.forEach(function (L) {
      var k = L.source && L.source.kind === "comp" ? "precomp" : (L.kind || "layer");
      if (k === "precomp") comps++;
      kinds[k] = (kinds[k] || 0) + 1;
      tMin = Math.min(tMin, +L.inPoint || 0); tMax = Math.max(tMax, +L.outPoint || 0);
    });
    return {
      file: file, folder: folder, name: j.name || path.basename(file).replace(EXT_RE, ""),
      layers: j.layers.length, kinds: kinds, duration: Math.max(0, tMax - tMin),
      size: st.size, mtime: st.mtimeMs
    };
  }

  function scan() {
    ensureLib();
    var out = [];
    function walk(dir, folder) {
      var ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      ents.forEach(function (e) {
        var p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "_Trash" && !folder) walk(p, e.name); }
        else if (EXT_RE.test(e.name)) { var s = summarize(p, folder); if (s) out.push(s); }
      });
    }
    walk(LIB, "");
    out.sort(function (a, b) { return b.mtime - a.mtime; });
    items = out;
  }

  function folders() {
    var set = {};
    try { fs.readdirSync(LIB, { withFileTypes: true }).forEach(function (e) { if (e.isDirectory() && e.name !== "_Trash") set[e.name] = 1; }); } catch (e) {}
    items.forEach(function (it) { if (it.folder) set[it.folder] = 1; });
    return Object.keys(set).sort();
  }

  // ---------------------------------------------------------------- rendering
  function fmtDur(s) { return s >= 10 ? Math.round(s) + "s" : (Math.round(s * 10) / 10) + "s"; }

  // ---------------------------------------------------------------- pins (kept by file, relative to the library)
  var PINNED = "__pinned";
  function pinKey(file) { return path.relative(LIB, file).split(path.sep).join("/").toLowerCase(); }
  function pins() { return J.store.get("ly.pins", []) || []; }
  function isPinned(it) { return pins().indexOf(pinKey(it.file)) >= 0; }
  function setPinned(file, on) {
    var k = pinKey(file), list = pins().filter(function (p) { return p !== k; });
    if (on) list.unshift(k);
    J.store.set("ly.pins", list);
  }
  function togglePin(it) {
    var on = !isPinned(it);
    setPinned(it.file, on);
    if (!on && folderFilter === PINNED && !items.some(isPinned)) { folderFilter = ""; J.store.set("ly.folder", ""); }
    renderFolders(); renderList();
    J.toast((on ? "Pinned " : "Unpinned ") + it.name, on ? "ok" : "", 1400);
  }

  function renderFolders() {
    var fl = folders(), chips = $("#lyChips"), sel = $("#lyFolder");
    // a remembered folder that no longer exists falls back to All
    var pinCount = items.filter(isPinned).length;
    if (folderFilter && folderFilter !== PINNED && fl.indexOf(folderFilter) < 0) { folderFilter = ""; J.store.set("ly.folder", ""); }
    if (folderFilter === PINNED && !pinCount) { folderFilter = ""; J.store.set("ly.folder", ""); }
    chips.innerHTML = "";
    [""].concat(pinCount ? [PINNED] : []).concat(fl).forEach(function (f) {
      var b = document.createElement("button");
      b.className = "ly-chip" + (f === folderFilter ? " on" : "") + (f === PINNED ? " pin" : "");
      var n = f === PINNED ? pinCount : items.filter(function (it) { return !f || it.folder === f; }).length;
      b.textContent = (f === PINNED ? "★ Pinned" : f || "All") + " " + n;
      b.addEventListener("click", function () { folderFilter = f; J.store.set("ly.folder", f); renderFolders(); renderList(); });
      chips.appendChild(b);
    });
    var keep = sel.value;
    sel.innerHTML = "";
    [["", "Library (no folder)"]].concat(fl.map(function (f) { return [f, f]; })).concat([["__new", "+ New folder…"]]).forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o[0]; opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = keep && keep !== "__new" && fl.indexOf(keep) >= 0 ? keep : (folderFilter && folderFilter !== PINNED ? folderFilter : "");
  }

  function kindText(k) {
    var parts = [];
    Object.keys(k).forEach(function (n) { parts.push(k[n] + " " + n + (k[n] === 1 ? "" : "s")); });
    return parts.join(", ");
  }

  function renderList() {
    var list = $("#lyList");
    var q = query.toLowerCase();
    var pinList = pins();
    var shown = items.filter(function (it) {
      var inView = !folderFilter || (folderFilter === PINNED ? pinList.indexOf(pinKey(it.file)) >= 0 : it.folder === folderFilter);
      return inView && (!q || it.name.toLowerCase().indexOf(q) >= 0);
    });
    // pinned ones first, in the order you pinned them (newest pin on top); the rest stay newest-saved first
    shown.sort(function (a, b) {
      var pa = pinList.indexOf(pinKey(a.file)), pb = pinList.indexOf(pinKey(b.file));
      if (pa < 0 && pb < 0) return b.mtime - a.mtime;
      if (pa < 0) return 1;
      if (pb < 0) return -1;
      return pa - pb;
    });
    list.innerHTML = "";
    if (!shown.length) {
      var vfOn = (window.JWPA_CONFIG || {}).verseFlowImport !== false && vfFiles();
      list.innerHTML = '<p class="muted small ly-empty">' + (items.length ? "Nothing matches." :
        "No saved layers yet. Select layers and press Save" + (vfOn ? ", or import from Verse Flow below." : ".")) + "</p>";
      return;
    }
    shown.slice(0, 300).forEach(function (it, i) {
      var row = document.createElement("div");
      var pinned = pinList.indexOf(pinKey(it.file)) >= 0;
      row.className = "ly-item" + (pinned ? " pinned" : "");
      row.style.animationDelay = Math.min(i, 12) * 0.02 + "s";
      row.innerHTML =
        '<div class="ly-icon"></div>' +
        '<div class="ly-info"><b></b><span></span></div>' +
        '<button class="ly-pin" title="' + (pinned ? "Unpin" : "Pin to top") + '"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg></button>' +
        '<button class="btn ly-insert">Insert</button>' +
        '<button class="ly-more" title="More">⋯</button>';
      var lic = row.querySelector(".ly-icon");
      lic.textContent = "";
      if (J.coverArt) J.coverArt(lic, it.name); else lic.textContent = it.kinds.precomp ? "▣" : it.kinds.text ? "T" : it.kinds.adjustment ? "◐" : "■";
      row.querySelector("b").textContent = it.name;
      row.querySelector(".ly-info span").textContent = kindText(it.kinds) + " · " + fmtDur(it.duration) + (it.folder ? " · " + it.folder : "");
      row.title = it.file;
      row.setAttribute("data-file", it.file);
      row.querySelector(".ly-insert").addEventListener("click", function (e) { e.stopPropagation(); insert(it, row); });
      row.querySelector(".ly-pin").addEventListener("click", function (e) { e.stopPropagation(); togglePin(it); });
      row.querySelector(".ly-pin").addEventListener("dblclick", function (e) { e.stopPropagation(); });
      row.addEventListener("dblclick", function () { insert(it, row); });
      row.querySelector(".ly-more").addEventListener("click", function (e) { e.stopPropagation(); menu(it, row); });
      list.appendChild(row);
    });
    if (shown.length > 300) list.insertAdjacentHTML("beforeend", '<p class="muted small">Showing 300 of ' + shown.length + " · search to narrow it down.</p>");
  }

  function refresh() { scan(); renderFolders(); renderList(); vfInfo(); }

  // for Quick Search
  J.layerLib = {
    list: function () {
      if (!items.length) { try { scan(); } catch (e) {} }
      return items.map(function (it) { return { file: it.file, rel: pinKey(it.file), name: it.name, folder: it.folder, kinds: it.kinds }; });
    },
    insert: function (file) {
      var find = function () { return items.filter(function (x) { return x.file === file; })[0]; };
      var it = find();
      if (!it) { try { scan(); } catch (e) {} it = find(); }       // list not loaded yet (e.g. right after a refresh)
      if (!it && fs.existsSync(file)) it = { file: file, name: path.basename(file).replace(EXT_RE, "") };
      if (!it) { J.toast("That saved layer is gone", "bad", 2500); return Promise.resolve({ ok: false, error: "saved layer file is gone" }); }
      return insert(it, document.createElement("div")) || Promise.resolve({ ok: false, error: "busy" });
    }
  };

  // ---------------------------------------------------------------- actions
  function insert(it, row) {
    if (row.classList.contains("busy")) return;
    var preset;
    try { preset = readPreset(it.file); } catch (e) { J.toast("Couldn't read " + it.name + ": " + e.message, "bad", 4000); return Promise.resolve({ ok: false, error: e.message }); }
    row.classList.add("busy");
    return J.host("layersInsert", { preset: preset, at: J.opt("ly.at") || "playhead", fit: J.opt("ly.fit") !== false }).then(function (r) {
      row.classList.remove("busy");
      if (!r.ok) { J.toast(r.error, "bad", 4500); J.emit("action", { name: "layers", ok: false, msg: it.name + ": " + r.error }); return r; }
      row.classList.remove("done"); void row.offsetWidth; row.classList.add("done");
      var msg = "Inserted " + it.name + " (" + r.layers + " layer" + (r.layers === 1 ? "" : "s") + ")" + (r.fitCount ? " · fit to comp" : r.fitted ? " · fitted " + r.fitted : "");
      J.toast(msg, "ok", 2600);
      if (r.placeholders && r.placeholders.length) J.toast(r.placeholders.length + " missing video file(s) were replaced with placeholders: " + r.placeholders.slice(0, 3).join(", "), "warn", 7000);
      if (r.missing && r.missing.length) J.toast("Effects not installed on this PC: " + uniq(r.missing).slice(0, 4).join(", "), "warn", 7000);
      J.emit("action", { name: "layers", ok: true, msg: msg });
      return r;
    });
  }

  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  function menu(it, row) {
    var open = $(".ly-menu");
    if (open) { var same = open.parentNode === row; open.remove(); if (same) return; }
    var m = document.createElement("div");
    m.className = "ly-menu";
    [[isPinned(it) ? "Unpin" : "Pin to top", function () { togglePin(it); }], ["Rename", function () { rename(it); }], ["Show in folder", function () { reveal(it.file); }], ["Delete", function () { remove(it); }]].forEach(function (a) {
      var b = document.createElement("button");
      b.textContent = a[0];
      if (a[0] === "Delete") b.className = "danger";
      b.addEventListener("click", function (e) { e.stopPropagation(); m.remove(); a[1](); });
      m.appendChild(b);
    });
    row.appendChild(m);
    setTimeout(function () { document.addEventListener("click", function close() { m.remove(); document.removeEventListener("click", close); }); }, 0);
  }

  function inlineName(it, done) {
    var row = null;
    Array.prototype.forEach.call(document.querySelectorAll(".ly-item"), function (r) { if (r.getAttribute("data-file") === it.file) row = r; });
    var b = row && row.querySelector("b");
    if (!b) return;
    var input = document.createElement("input");
    input.type = "text"; input.value = it.name; input.className = "ly-rename";
    b.replaceWith(input); input.focus(); input.select();
    var finished = false;
    function finish(save) {
      if (finished) return; finished = true;
      var v = input.value.trim();
      input.replaceWith(b);
      if (save && v && v !== it.name) done(v);
    }
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", function () { finish(true); });
  }

  function rename(it) {
    inlineName(it, function (name) {
      try {
        var j = JSON.parse(fs.readFileSync(it.file, "utf8"));
        j.name = name;
        var dest = uniquePath(path.dirname(it.file), safeName(name), path.extname(it.file));
        fs.writeFileSync(dest, JSON.stringify(j));
        if (dest !== it.file) {
          if (isPinned(it)) { setPinned(it.file, false); setPinned(dest, true); }
          fs.unlinkSync(it.file);
        }
        J.toast("Renamed to " + name, "ok", 1800);
      } catch (e) { J.toast("Rename failed: " + e.message, "bad", 4000); }
      refresh();
    });
  }

  function remove(it) {
    try {
      fs.mkdirSync(TRASH, { recursive: true });
      fs.renameSync(it.file, uniquePath(TRASH, path.basename(it.file).replace(EXT_RE, ""), path.extname(it.file)));
      setPinned(it.file, false);
      J.toast("Moved " + it.name + " to the library's _Trash folder", "", 2600);
    } catch (e) { J.toast("Delete failed: " + e.message, "bad", 4000); }
    refresh();
  }

  function reveal(file) { try { cp.spawn("explorer.exe", ["/select,", file], { detached: true }); } catch (e) {} }

  function uniquePath(dir, base, ext) {
    var p = path.join(dir, base + ext), n = 2;
    while (fs.existsSync(p)) p = path.join(dir, base + " " + (n++) + ext);
    return p;
  }

  // Save
  var folderSel = $("#lyFolder");
  folderSel.addEventListener("change", function () {
    if (folderSel.value !== "__new") return;
    var wrap = folderSel.parentNode, input = document.createElement("input");
    input.type = "text"; input.placeholder = "Folder name"; input.className = "recipe-name";
    wrap.classList.add("naming"); wrap.appendChild(input); input.focus();
    var finished = false;
    function done(save) {
      if (finished) return; finished = true;
      var v = safeName(input.value);
      wrap.classList.remove("naming"); input.remove();
      if (save && input.value.trim()) {
        try { fs.mkdirSync(path.join(LIB, v), { recursive: true }); } catch (e) {}
        refresh(); folderSel.value = v;
      } else folderSel.value = "";
    }
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    input.addEventListener("blur", function () { done(true); });
  });

  $("#lyName").addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") $("#lySave").click(); });

  $("#lySave").addEventListener("click", function () {
    var btn = $("#lySave"), status = $("#lyStatus");
    if (btn.classList.contains("busy")) return;
    btn.classList.add("busy");
    status.className = "run-status"; status.textContent = "Reading layers…";
    var name = $("#lyName").value.trim();
    J.host("layersSave", { name: name }).then(function (r) {
      btn.classList.remove("busy");
      if (!r.ok) { status.textContent = r.error; status.className = "run-status bad"; return J.toast(r.error, "bad", 4000); }
      ensureLib();
      var dir = folderSel.value && folderSel.value !== "__new" ? path.join(LIB, folderSel.value) : LIB;
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      var file = uniquePath(dir, safeName(r.preset.name), ".jwl");
      try { fs.writeFileSync(file, JSON.stringify(r.preset)); }
      catch (e) { status.textContent = "Couldn't write the file: " + e.message; status.className = "run-status bad"; return; }
      var n = r.preset.layers.length;
      var msg = "Saved " + r.preset.name + " (" + n + " layer" + (n === 1 ? "" : "s") + ")";
      status.textContent = msg; status.className = "run-status ok";
      btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done");
      $("#lyName").value = "";
      J.toast(msg, "ok", 2400);
      (r.preset.warnings || []).forEach(function (w) { J.toast(w, "warn", 5000); });
      J.emit("action", { name: "layers", ok: true, msg: msg });
      refresh();
    });
  });

  $("#lySearch").addEventListener("input", function (e) { query = e.target.value; renderList(); });
  $("#lySearch").addEventListener("keydown", function (e) { e.stopPropagation(); });
  $("#lyRefresh").addEventListener("click", refresh);
  $("#lyOpenFolder").addEventListener("click", function () { ensureLib(); try { cp.spawn("explorer.exe", [LIB], { detached: true }); } catch (e) {} });

  // ---------------------------------------------------------------- Verse Flow import
  function vfFiles() {
    try { return fs.readdirSync(VF_DIR).filter(function (f) { return /\.vrs$/i.test(f); }); } catch (e) { return null; }
  }

  function vfInfo() {
    var files = vfFiles(), info = $("#lyVfInfo"), btn = $("#lyVfImport");
    var cfg = window.JWPA_CONFIG || {};
    if (!files || cfg.verseFlowImport === false) { $("#lyVfCard").style.display = "none"; return; }
    $("#lyVfCard").style.display = "";
    var dest = path.join(LIB, "Verse Flow"), have = 0;
    files.forEach(function (f) { if (fs.existsSync(path.join(dest, f))) have++; });
    info.textContent = files.length + " Verse Flow layer preset" + (files.length === 1 ? "" : "s") + " found" +
      (have ? " · " + have + " already imported" : "") + ". They go into a “Verse Flow” folder; the originals aren’t touched.";
    btn.disabled = have === files.length;
    btn.textContent = have === files.length ? "All imported" : have ? "Import the " + (files.length - have) + " new ones" : "Import from Verse Flow";
  }

  $("#lyVfImport").addEventListener("click", function () {
    var files = vfFiles() || [], dest = path.join(LIB, "Verse Flow"), done = 0, bad = [];
    try { fs.mkdirSync(dest, { recursive: true }); } catch (e) {}
    files.forEach(function (f) {
      var target = path.join(dest, f);
      if (fs.existsSync(target)) return;
      try { readPreset(path.join(VF_DIR, f)); fs.copyFileSync(path.join(VF_DIR, f), target); done++; }
      catch (e) { bad.push(f); }
    });
    folderFilter = "Verse Flow"; J.store.set("ly.folder", folderFilter);
    refresh();
    var msg = "Imported " + done + " Verse Flow preset" + (done === 1 ? "" : "s");
    J.toast(msg + (bad.length ? " · " + bad.length + " couldn't be read" : ""), done ? "ok" : "warn", 3600);
    J.emit("action", { name: "layers", ok: true, msg: msg });
  });

  // refresh when the tab is opened (files may have changed outside the panel)
  document.querySelector('.tab[data-tab="layers"]').addEventListener("click", function () { setTimeout(refresh, 60); });
  refresh();
})();
