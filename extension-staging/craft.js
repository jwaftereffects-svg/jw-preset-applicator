/* JW Preset Applicator Pro - Tools tab, Home dashboard (session, usage, cache, project health),
 * SFX browser (Audio tab), output folder + feedback sounds (Settings).
 * After Effects side: jsx/craft.jsx. Audio analysis: audiotools.js.
 */
(function () {
  "use strict";

  var J = window.JWPA;
  if (!J) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var nodeOk = typeof require === "function";
  var fs, path, cp, os;
  if (nodeOk) { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); }
  var BASE = nodeOk ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "JW Preset Applicator") : "";

  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function exists(p) { try { fs.statSync(p); return true; } catch (e) { return false; } }
  function mb(bytes) { return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + " GB" : Math.round(bytes / 1048576) + " MB"; }
  function ffmpeg() {
    var eng = path.join(BASE, "vocal-engine", "ffmpeg.exe");
    if (exists(eng)) return eng;
    var SC = window.JWPA_SceneCut;
    return SC && SC.findFfmpeg ? SC.findFfmpeg() : "";
  }
  function hexToRgb(h) { h = String(h || "#000000").replace("#", ""); return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + "." + p(d.getMinutes()) + "." + p(d.getSeconds()); }
  function safeName(s) { return String(s || "comp").replace(/[\\\/:*?"<>|]+/g, "_").slice(0, 80); }

  // ------------------------------------------------------------------ output folder
  function outDir() {
    var d = J.store.get("cr.outDir", "");
    if (d && nodeOk && exists(d)) return Promise.resolve(d);
    return J.host("craftInfo").then(function (r) {
      if (r.ok && r.projectFolder) return r.projectFolder;
      return nodeOk ? path.join(os.homedir(), "Desktop") : "";
    });
  }

  // ------------------------------------------------------------------ audio of the selected layers
  // Each clip: footage -> decode the part the layer uses; precomp -> AE renders it first (like the vocal remover).
  function clipAudio(clip, rate) {
    var ff = ffmpeg();
    if (!ff) return Promise.reject(new Error("ffmpeg not found · install it to C:\\ffmpeg\\bin"));
    if (!clip.precomp) {
      return JWAudio.decode(cp, { ffmpeg: ff, file: clip.file, start: clip.srcStart, dur: clip.srcDur, rate: rate })
        .then(function (s) { return { samples: s, offset: clip.inPoint }; });
    }
    var out = path.join(BASE, "tool-audio", "render-" + Date.now() + ".wav");
    try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch (e) {}
    var o = {}; for (var k in clip) o[k] = clip[k];
    o.out = out;
    return J.host("vocalRender", o).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      return JWAudio.decode(cp, { ffmpeg: ff, file: r.file, start: 0, dur: 0, rate: rate }).then(function (s) {
        try { fs.unlinkSync(r.file); } catch (e) {}
        return { samples: s, offset: clip.renderStart };
      });
    });
  }
  function audioClips() {
    if (!nodeOk) return Promise.reject(new Error("This works inside After Effects."));
    return J.host("vocalPrep").then(function (r) {
      if (!r.ok) throw new Error(r.error);
      if (r.noComp) throw new Error("Open a comp first.");
      if (!r.clips.length) throw new Error(r.skipped && r.skipped.length ? r.skipped[0] : "Select a layer with audio.");
      return r.clips;
    });
  }

  // ------------------------------------------------------------------ tools
  var TOOLS = {
    add: function (btn) {
      var kind = btn.dataset.kind;
      return J.host("craftAdd", { kind: kind, color: hexToRgb(J.opt("cr.solidColor")), light: J.opt("cr.light") }).then(function (r) {
        if (r.ok) r.msg = "Added " + r.name; return r;
      });
    },
    fit: function () {
      return J.host("craftFit", { mode: J.opt("cr.fit") }).then(function (r) { if (r.ok) r.msg = (J.opt("cr.fit") === "fit" ? "Fit " : J.opt("cr.fit") === "stretch" ? "Stretched " : "Filled the comp with ") + plural(r.count, "layer"); return r; });
    },
    frameBlend: function () {
      var mode = J.opt("cr.fb");
      return J.host("craftFrameBlend", { mode: mode, scope: J.opt("cr.fbSel") ? "selected" : "all" }).then(function (r) {
        if (r.ok) r.msg = (mode === "off" ? "Frame blending off on " : mode === "pixel" ? "Pixel motion on " : "Frame mix on ") + plural(r.count, "video layer");
        return r;
      });
    },
    clipboard: function () {
      if (!nodeOk) return Promise.resolve({ ok: false, error: "This works inside After Effects." });
      var dir = path.join(BASE, "clipboard"), file = path.join(dir, "Clipboard " + stamp() + ".png");
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      var ps = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
        "$i = [Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save('" + file.replace(/'/g, "''") + "', [Drawing.Imaging.ImageFormat]::Png); 'IMG' } " +
        "else { $f = [Windows.Forms.Clipboard]::GetFileDropList(); if ($f.Count) { 'FILE:' + $f[0] } else { 'NONE' } }";
      return new Promise(function (resolve) {
        cp.execFile("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], { windowsHide: true, timeout: 15000 }, function (err, out) {
          out = String(out || "").trim();
          if (err && !out) return resolve({ ok: false, error: "Couldn't read the clipboard." });
          var src = out === "IMG" ? file : out.indexOf("FILE:") === 0 ? out.slice(5).trim() : "";
          if (!src) return resolve({ ok: false, error: "No image on the clipboard. Copy an image (or an image file) first." });
          J.host("craftAddFile", { file: src, folder: "Clipboard", fitDown: true }).then(function (r) {
            if (r.ok) r.msg = "Pasted " + r.name + " at the playhead";
            resolve(r);
          });
        });
      });
    },
    screenshot: function () {
      var fmt = J.opt("cr.shot") || "png";
      return Promise.all([outDir(), J.host("craftInfo")]).then(function (a) {
        var dir = a[0], info = a[1];
        if (!info.ok || !info.comp) return { ok: false, error: "Open a comp first." };
        var png = path.join(dir, safeName(info.comp) + " " + stamp() + ".png");
        return J.host("craftScreenshot", { file: png }).then(function (r) {
          if (!r.ok) return r;
          // AE writes the file in the background: wait until it stops growing
          return waitFile(png).then(function () {
            if (fmt !== "jpg") return { ok: true, msg: "Saved " + path.basename(png), file: png };
            var ff = ffmpeg(), jpg = png.replace(/\.png$/i, ".jpg");
            if (!ff) return { ok: true, msg: "Saved as PNG (no ffmpeg for JPEG): " + path.basename(png), file: png };
            return new Promise(function (resolve) {
              cp.execFile(ff, ["-y", "-hide_banner", "-loglevel", "error", "-i", png, "-q:v", "2", jpg], { windowsHide: true }, function (err) {
                if (err) return resolve({ ok: true, msg: "Saved as PNG: " + path.basename(png), file: png });
                try { fs.unlinkSync(png); } catch (e) {}
                resolve({ ok: true, msg: "Saved " + path.basename(jpg), file: jpg });
              });
            });
          });
        });
      }).then(function (r) {
        if (r.ok && r.file && J.opt("cr.shotOpen")) { try { cp.spawn("explorer.exe", ["/select,", r.file], { detached: true, windowsHide: false }); } catch (e) {} }
        return r;
      });
    },
    unprecomp: function () {
      return J.host("craftUnprecompose", { keep: J.opt("cr.unKeep") }).then(function (r) { if (r.ok) r.msg = "Took out " + plural(r.count, "layer") + (r.note ? " · " + r.note : ""); return r; });
    },
    explode: function () {
      var by = J.opt("cr.explode") || "words";
      return J.host("craftExplodeText", { by: by }).then(function (r) { if (r.ok) r.msg = "Split into " + plural(r.count, by === "chars" ? "letter" : by === "lines" ? "line" : "word") + " · original hidden" + (r.note ? " · skipped " + r.note : ""); return r; });
    },
    cutMarker: function () {
      return J.host("craftCutToMarker").then(function (r) { if (r.ok) r.msg = "Trimmed " + plural(r.count, "layer") + " to the next marker"; return r; });
    },
    seqMarkers: function () {
      return J.host("craftSeqMarkers", { trim: J.opt("cr.seqTrim") }).then(function (r) {
        if (r.ok) r.msg = "Placed " + plural(r.count, "layer") + " on markers" + (r.left ? " · " + r.left + " left over (not enough markers)" : "");
        return r;
      });
    },
    beats: function () {
      var mode = J.opt("cr.beatMode") || "grid", sens = { low: 0.6, med: 1, high: 1.6 }[J.opt("cr.beatSens") || "med"];
      var where = J.opt("cr.beatLayer") ? "layer" : "comp";
      return audioClips().then(function (clips) {
        var clip = clips[0];
        return clipAudio(clip, 22050).then(function (a) {
          var E = JWAudio.onsetEnvelope(a.samples, 22050, J.opt("cr.beatKick"));
          var times, bpm = 0;
          if (mode === "grid") { var g = JWAudio.beatGrid(E, 70, 180); times = g.beats; bpm = g.bpm; }
          else times = JWAudio.pickHits(E, sens, 0.1);
          if (!times.length) return { ok: false, error: "No beats found in " + clip.name + "." };
          return J.host("craftMarkers", { times: times.map(function (t) { return t + a.offset; }), where: where, ref: clip.ref, tag: "Beat" }).then(function (r) {
            if (r.ok) r.msg = "Added " + plural(r.count, "beat marker") + (bpm ? " · " + bpm + " BPM" : "") + (where === "layer" ? " on " + clip.name : "");
            return r;
          });
        });
      }).catch(function (e) { return { ok: false, error: e.message }; });
    },
    silence: function () {
      var thr = Number(J.opt("cr.silDb")) || 30, minSil = (Number(J.opt("cr.silMin")) || 400) / 1000, pad = (Number(J.opt("cr.silPad")) || 80) / 1000;
      return audioClips().then(function (clips) {
        var done = 0, removed = 0, pieces = 0;
        // one layer at a time, bottom-most first so indexes above stay valid
        clips.sort(function (a, b) { return (b.ref && b.ref.index || 0) - (a.ref && a.ref.index || 0); });
        return clips.reduce(function (p, clip) {
          return p.then(function () {
            return clipAudio(clip, 16000).then(function (a) {
              var keep = JWAudio.speechRanges(a.samples, { rate: 16000, threshold: thr, relative: true, minSilence: minSil, pad: pad });
              if (keep.length === 1 && keep[0][0] <= 0.01 && keep[0][1] >= a.samples.length / 16000 - 0.01) return; // nothing to cut
              return J.host("craftKeepRanges", { ref: clip.ref, ranges: keep.map(function (r) { return [r[0] + a.offset, r[1] + a.offset]; }), ripple: J.opt("cr.silRipple") }).then(function (r) {
                if (!r.ok) throw new Error(r.error);
                done++; pieces += r.pieces; removed += r.removed;
              });
            });
          });
        }, Promise.resolve()).then(function () {
          if (!done) return { ok: false, error: "No silence long enough to cut." };
          return { ok: true, msg: "Cut silence from " + plural(done, "layer") + " → " + plural(pieces, "piece") + (removed > 0 ? " · " + removed.toFixed(1) + "s shorter" : "") };
        });
      }).catch(function (e) { return { ok: false, error: e.message }; });
    },
    stretch: function () {
      var pct = Number(J.opt("cr.stretch")) || 100;
      return J.host("craftStretchKeys", { factor: pct / 100 }).then(function (r) { if (r.ok) r.msg = "Stretched " + plural(r.count, "keyframe") + " to " + pct + "%"; return r; });
    },
    motion: function (btn) {
      var kind = btn.dataset.kind;
      return J.host("craftMotion", { kind: kind, strength: J.opt("cr.motion") || "medium" }).then(function (r) { if (r.ok) r.msg = (kind === "bounce" ? "Bounce" : "Elastic") + " on " + plural(r.count, "property", "properties").replace("propertys", "properties"); return r; });
    },
    del: function (btn) {
      var what = btn.dataset.what;
      return J.host("craftDeleteProps", { what: what }).then(function (r) {
        if (r.ok) r.msg = r.count ? "Removed " + (what === "keyframes" ? "keyframes from " + plural(r.count, "property").replace("propertys", "properties") : what === "expressions" ? plural(r.count, "expression") : plural(r.count, "effect")) + " · Ctrl+Z to undo" : "Nothing to remove";
        return r;
      });
    },
    pathNulls: function () {
      return J.host("craftPathToNulls").then(function (r) { if (r.ok) r.msg = "Made " + plural(r.count, "null") + " that drive " + r.layer + "'s path"; return r; });
    },
    optimize: function () {
      return J.host("craftOptimize", { organize: J.opt("cr.optOrganize"), removeUnused: J.opt("cr.optUnused"), consolidate: J.opt("cr.optDupes") }).then(function (r) {
        if (r.ok) { r.msg = "Project tidied · " + plural(r.moved, "item") + " sorted, " + plural(r.removed, "unused item") + " removed" + (r.consolidated ? ", " + r.consolidated + " duplicates merged" : ""); setTimeout(refreshHealth, 300); }
        return r;
      });
    },
    cache: function () {
      return J.host("craftCache").then(function (r) {
        if (!r.ok) return r;
        var media = J.opt("cr.cacheMedia") ? cleanMediaCache() : 0;
        setTimeout(refreshCache, 4000);
        r.msg = (r.disk ? "Memory cleared · confirm in After Effects to empty the disk cache" : "Memory cleared") + (media ? " · " + mb(media) + " of media cache deleted" : "");
        return r;
      });
    },
    sfxFolder: function () {
      return J.host("craftPickFolder", { title: "Choose a sound effects folder" }).then(function (r) {
        if (!r.ok || !r.path) return { ok: false, error: "No folder chosen" };
        var list = J.store.get("sfx.folders", []);
        if (list.indexOf(r.path) < 0) list.push(r.path);
        J.store.set("sfx.folders", list);
        scanSfx();
        return { ok: true, msg: "Added " + path.basename(r.path) };
      });
    },
    outFolder: function () {
      return J.host("craftPickFolder", { title: "Where should panel exports go?" }).then(function (r) {
        if (!r.ok || !r.path) return { ok: false, error: "No folder chosen" };
        J.store.set("cr.outDir", r.path); showOut();
        return { ok: true, msg: "Exports go to " + r.path };
      });
    },
    outReset: function () { J.store.set("cr.outDir", ""); showOut(); return Promise.resolve({ ok: true, msg: "Exports go next to the project" }); }
  };

  function waitFile(f) {
    return new Promise(function (resolve) {
      var last = -1, tries = 0;
      (function check() {
        var size = -1;
        try { size = fs.statSync(f).size; } catch (e) {}
        if (size > 0 && size === last) return resolve();
        last = size;
        if (++tries > 60) return resolve();
        setTimeout(check, 150);
      })();
    });
  }

  $$("[data-craft]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var fn = TOOLS[btn.dataset.craft];
      if (!fn || btn.classList.contains("busy")) return;
      btn.classList.add("busy");
      Promise.resolve().then(function () { return fn(btn); }).catch(function (e) { return { ok: false, error: e.message || String(e) }; }).then(function (r) {
        btn.classList.remove("busy");
        r = r || { ok: false, error: "No response" };
        J.emit("action", { name: btn.dataset.craft, ok: r.ok, msg: r.ok ? r.msg : r.error, result: r });
        if (!r.ok) return J.toast(r.error, "bad", 4200);
        btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done");
        J.toast(r.msg, "ok", 3200);
      });
    });
  });

  // ------------------------------------------------------------------ Home: session timer + usage graph
  var USAGE = "jw.usage", SESSION = "jw.session";
  function today(d) { d = d || new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function readJson(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var sess = readJson(SESSION, null), now = Date.now();
  // a panel reload keeps the session; a gap over 10 minutes (AE closed) starts a new one
  if (!sess || now - sess.beat > 10 * 60 * 1000) sess = { start: now, beat: now };
  writeJson(SESSION, sess);
  var lastTick = now;
  function clock(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60); return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  function tick() {
    var t = Date.now(), add = Math.min(60, (t - lastTick) / 1000);
    lastTick = t;
    var u = readJson(USAGE, {}), k = today();
    u[k] = (u[k] || 0) + add;
    // keep two weeks
    var keys = Object.keys(u); if (keys.length > 14) keys.slice(0, keys.length - 14).forEach(function (x) { delete u[x]; });
    writeJson(USAGE, u);
    sess.beat = t; writeJson(SESSION, sess);
    var el = $("#crTimer");
    if (el) el.textContent = clock((t - sess.start) / 1000);
    var td = $("#crToday");
    if (td) td.textContent = clock(u[k] || 0) + " today";
  }
  function drawUsage() {
    var box = $("#crUsage");
    if (!box) return;
    var u = readJson(USAGE, {}), days = [], max = 1, i;
    for (i = 6; i >= 0; i--) { var d = new Date(Date.now() - i * 86400000); var v = u[today(d)] || 0; days.push({ d: d, v: v }); max = Math.max(max, v); }
    box.innerHTML = "";
    days.forEach(function (x, idx) {
      var col = document.createElement("div"); col.className = "cr-bar" + (idx === 6 ? " now" : "");
      var hrs = x.v / 3600;
      col.title = x.d.toDateString() + " · " + (hrs >= 1 ? hrs.toFixed(1) + " h" : Math.round(x.v / 60) + " min");
      var fill = document.createElement("i"); fill.style.height = Math.max(3, Math.round(x.v / max * 100)) + "%";
      var lab = document.createElement("span"); lab.textContent = "SMTWTFS".charAt(x.d.getDay());
      col.appendChild(fill); col.appendChild(lab); box.appendChild(col);
    });
  }
  setInterval(tick, 1000); tick(); drawUsage(); setInterval(drawUsage, 60000);

  // ------------------------------------------------------------------ Home: cache monitor
  function dirSize(dir, cb) {
    var total = 0, pending = 1, files = 0;
    function done() { if (--pending === 0) cb(total, files); }
    (function walk(d) {
      fs.readdir(d, { withFileTypes: true }, function (err, list) {
        if (!err) list.forEach(function (e) {
          var p = path.join(d, e.name);
          if (e.isDirectory()) { pending++; walk(p); }
          else { pending++; fs.stat(p, function (er, st) { if (!er) { total += st.size; files++; } done(); }); }
        });
        done();
      });
    })(dir);
  }
  function aeVersion() {
    try { var env = JSON.parse(window.__adobe_cep__.getHostEnvironment()); var m = /^(\d+)\.(\d+)/.exec(env.appVersion); if (m) return m[1] + "." + m[2]; } catch (e) {}
    return "";
  }
  function diskCacheDirs() {
    var ver = aeVersion(), roots = [], out = [];
    var appdata = process.env.APPDATA || "", temp = process.env.TEMP || os.tmpdir();
    // the folder set in Preferences > Media & Disk Cache ("Folder 7"), then the default
    try {
      var vers = fs.readdirSync(path.join(appdata, "Adobe", "After Effects")).filter(function (v) { return /^\d+\.\d+$/.test(v); });
      if (ver && vers.indexOf(ver) < 0) ver = "";
      vers.sort(function (a, b) { return parseFloat(b) - parseFloat(a); });
      var v = ver || vers[0];
      var pref = path.join(appdata, "Adobe", "After Effects", v, "Adobe After Effects " + v + " Prefs.txt");
      var m = /"Folder 7"\s*=\s*"([^"]+)"/.exec(fs.readFileSync(pref, "utf8"));
      if (m) roots.push(m[1], path.join(m[1], "Adobe", "After Effects", v));
      roots.push(path.join(temp, "Adobe", "After Effects", v));
    } catch (e) { roots.push(temp); }
    roots.forEach(function (r) {
      try { fs.readdirSync(r).forEach(function (n) { if (/^Disk Cache/i.test(n)) { var p = path.join(r, n); if (out.indexOf(p) < 0) out.push(p); } }); } catch (e) {}
    });
    return out;
  }
  function mediaCacheDirs() {
    var c = path.join(process.env.APPDATA || "", "Adobe", "Common");
    return ["Media Cache Files", "Media Cache"].map(function (n) { return path.join(c, n); }).filter(exists);
  }
  function sizeOf(dirs, cb) {
    var total = 0, left = dirs.length;
    if (!left) return cb(0);
    dirs.forEach(function (d) { dirSize(d, function (s) { total += s; if (--left === 0) cb(total); }); });
  }
  function refreshCache() {
    var el = $("#crCache");
    if (!el || !nodeOk) return;
    el.textContent = "Measuring…";
    var disk = diskCacheDirs(), media = mediaCacheDirs();
    sizeOf(disk, function (d) {
      sizeOf(media, function (m) {
        el.innerHTML = "";
        [["Disk cache", d, disk[0]], ["Media cache", m, media[0]]].forEach(function (row) {
          var r = document.createElement("div"); r.className = "cr-stat";
          var a = document.createElement("span"); a.textContent = row[0];
          var b = document.createElement("b"); b.textContent = row[2] ? mb(row[1]) : "not found";
          if (row[1] > 20 * 1073741824) b.className = "warn-text";
          r.title = row[2] || ""; r.appendChild(a); r.appendChild(b); el.appendChild(r);
        });
      });
    });
  }
  function cleanMediaCache() {
    var freed = 0;
    mediaCacheDirs().forEach(function (d) {
      (function walk(x) {
        var list = []; try { list = fs.readdirSync(x, { withFileTypes: true }); } catch (e) { return; }
        list.forEach(function (e) {
          var p = path.join(x, e.name);
          if (e.isDirectory()) return walk(p);
          try { var s = fs.statSync(p).size; fs.unlinkSync(p); freed += s; } catch (er) {} // files in use stay
        });
      })(d);
    });
    return freed;
  }
  var cacheBtn = $("#crCacheRefresh");
  if (cacheBtn) cacheBtn.addEventListener("click", refreshCache);

  // ------------------------------------------------------------------ Home: project health
  function ago(ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; }
  function refreshHealth() {
    var el = $("#crHealth");
    if (!el) return;
    J.host("craftHealth").then(function (r) {
      if (!r.ok) { el.textContent = r.error; return; }
      var rows = [
        ["Items", r.items + " (" + r.comps + " comps, " + r.footage + " footage)", ""],
        ["Unused footage", r.unused ? String(r.unused) : "none", r.unused > 10 ? "warn" : ""],
        ["Missing files", r.missingCount ? String(r.missingCount) : "none", r.missingCount ? "bad" : ""],
        ["Last save", !r.file ? "never saved" : r.saved ? ago(r.saved) + (r.dirty ? " · unsaved changes" : "") : "?", !r.file || (r.dirty && r.saved && Date.now() - r.saved > 30 * 60000) ? "warn" : ""]
      ];
      el.innerHTML = "";
      rows.forEach(function (row) {
        var d = document.createElement("div"); d.className = "cr-stat";
        var a = document.createElement("span"); a.textContent = row[0];
        var b = document.createElement("b"); b.textContent = row[1];
        if (row[2] === "warn") b.className = "warn-text"; else if (row[2] === "bad") b.className = "bad-text";
        if (row[0] === "Missing files" && r.missing.length) d.title = r.missing.join("\n");
        d.appendChild(a); d.appendChild(b); el.appendChild(d);
      });
    });
  }
  var homeTab = $('.tab[data-tab="home"]');
  if (homeTab) homeTab.addEventListener("click", function () { setTimeout(function () { refreshHealth(); drawUsage(); }, 80); });
  var healthBtn = $("#crHealthRefresh");
  if (healthBtn) healthBtn.addEventListener("click", refreshHealth);
  setTimeout(function () { refreshHealth(); refreshCache(); }, 1500);
  setInterval(function () { var p = $('.page[data-page="home"]'); if (p && p.classList.contains("active")) refreshHealth(); }, 30000);

  // ------------------------------------------------------------------ Audio: SFX browser
  var SFX_EXT = /\.(wav|mp3|aif|aiff|ogg|m4a|flac|aac)$/i, sfx = [], player = new Audio(), playing = null;
  function scanSfx() {
    var list = $("#sfxList");
    if (!list || !nodeOk) return;
    var folders = J.store.get("sfx.folders", []);
    renderFolders(folders);
    sfx = [];
    if (!folders.length) { list.innerHTML = '<p class="muted small">Add a folder with your sound effects to browse them here.</p>'; return; }
    list.innerHTML = '<p class="muted small">Scanning…</p>';
    var pending = 0;
    function walk(dir, root, depth) {
      pending++;
      fs.readdir(dir, { withFileTypes: true }, function (err, ents) {
        if (!err) ents.forEach(function (e) {
          var p = path.join(dir, e.name);
          if (e.isDirectory()) { if (depth < 6 && sfx.length < 8000) walk(p, root, depth + 1); }
          else if (SFX_EXT.test(e.name) && sfx.length < 8000) sfx.push({ file: p, name: e.name.replace(SFX_EXT, ""), folder: path.relative(root, dir) || path.basename(root) });
        });
        if (--pending === 0) { sfx.sort(function (a, b) { return a.name.localeCompare(b.name); }); renderSfx(); }
      });
    }
    folders.forEach(function (f) { walk(f, f, 0); });
  }
  function renderFolders(folders) {
    var box = $("#sfxFolders");
    if (!box) return;
    box.innerHTML = "";
    folders.forEach(function (f) {
      var chip = document.createElement("span"); chip.className = "cr-chip"; chip.title = f;
      chip.textContent = path.basename(f) || f;
      var x = document.createElement("i"); x.textContent = "✕"; x.title = "Remove this folder";
      x.addEventListener("click", function () { J.store.set("sfx.folders", J.store.get("sfx.folders", []).filter(function (y) { return y !== f; })); scanSfx(); });
      chip.appendChild(x); box.appendChild(chip);
    });
  }
  function fileUrl(p) { return "file:///" + encodeURI(p.replace(/\\/g, "/")).replace(/#/g, "%23").replace(/\?/g, "%3F"); }
  function renderSfx() {
    var list = $("#sfxList"), q = ($("#sfxSearch") && $("#sfxSearch").value || "").toLowerCase().trim();
    if (!list) return;
    var words = q ? q.split(/\s+/) : [];
    var hits = sfx.filter(function (s) { var hay = (s.name + " " + s.folder).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); });
    list.innerHTML = "";
    if (!hits.length) { list.innerHTML = '<p class="muted small">' + (sfx.length ? "Nothing matches." : "No sounds found in these folders.") + "</p>"; return; }
    hits.slice(0, 200).forEach(function (s) {
      var row = document.createElement("div"); row.className = "sfx-row" + (playing === s.file ? " playing" : "");
      var play = document.createElement("button"); play.className = "sfx-play"; play.title = "Listen"; play.textContent = playing === s.file ? "■" : "▶";
      var txt = document.createElement("div"); txt.className = "sfx-txt";
      var n = document.createElement("b"); n.textContent = s.name;
      var f = document.createElement("small"); f.textContent = s.folder;
      txt.appendChild(n); txt.appendChild(f);
      var add = document.createElement("button"); add.className = "btn tool sfx-add"; add.textContent = "Add"; add.title = "Add at the playhead";
      play.addEventListener("click", function (e) { e.stopPropagation(); toggle(s); });
      txt.addEventListener("click", function () { toggle(s); });
      row.addEventListener("dblclick", function () { addSfx(s, add); });
      add.addEventListener("click", function (e) { e.stopPropagation(); addSfx(s, add); });
      row.appendChild(play); row.appendChild(txt); row.appendChild(add); list.appendChild(row);
    });
    var count = $("#sfxCount");
    if (count) count.textContent = hits.length > 200 ? "200 of " + hits.length + " shown · search to narrow" : plural(hits.length, "sound");
  }
  function toggle(s) {
    if (playing === s.file) { player.pause(); playing = null; renderSfx(); return; }
    player.src = fileUrl(s.file);
    player.volume = Math.max(0, Math.min(1, (Number(J.opt("sfx.vol")) || 80) / 100));
    player.play().catch(function () { J.toast("Can't play " + s.name, "bad", 2400); });
    playing = s.file; renderSfx();
  }
  player.addEventListener("ended", function () { playing = null; renderSfx(); });
  function addSfx(s, btn) {
    btn.classList.add("busy");
    J.host("craftAddFile", { file: s.file, folder: "SFX" }).then(function (r) {
      btn.classList.remove("busy");
      if (!r.ok) return J.toast(r.error, "bad", 3600);
      J.toast("Added " + s.name + " at the playhead", "ok", 2000);
    });
  }
  var sfxSearch = $("#sfxSearch"), st = 0;
  if (sfxSearch) sfxSearch.addEventListener("input", function () { clearTimeout(st); st = setTimeout(renderSfx, 120); });
  var sfxRescan = $("#sfxRescan");
  if (sfxRescan) sfxRescan.addEventListener("click", scanSfx);
  scanSfx();

  // ------------------------------------------------------------------ Settings: output folder, feedback sounds
  function showOut() {
    var el = $("#crOutPath");
    if (el) el.textContent = J.store.get("cr.outDir", "") || "Next to the project (Desktop if it isn't saved)";
  }
  showOut();

  var actx = null;
  function blip(kind) {
    if (!J.opt("cr.sounds")) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var notes = kind === "bad" ? [330, 247] : [660, 990], t0 = actx.currentTime;
      notes.forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.07 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.07 + 0.12);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + i * 0.07); o.stop(t0 + i * 0.07 + 0.14);
      });
    } catch (e) {}
  }
  var toasts = $("#toasts");
  if (toasts && window.MutationObserver) {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (!n.classList) return;
        if (n.classList.contains("bad")) blip("bad"); else if (n.classList.contains("ok")) blip("ok");
      }); });
    }).observe(toasts, { childList: true });
  }
  var testSound = $("#crSoundTest");
  if (testSound) testSound.addEventListener("click", function () { var was = J.opt("cr.sounds"); if (!was) { J.toast("Turn feedback sounds on first", "warn", 1800); return; } blip("ok"); });

  J.craft = { refreshHealth: refreshHealth, refreshCache: refreshCache, scanSfx: scanSfx };
})();
