/* Compatibility for older After Effects (CC 2018 - 2021).
 * Loaded before every other script. On AE 2022+ every check below passes and nothing changes.
 *
 *  1. Node.js: older AE ships Node 7-12, which lacks a few fs features the panel uses
 *     (mkdirSync recursive, rmSync, readdirSync withFileTypes, copyFileSync, stat.mtimeMs).
 *  2. CSS: older AE's browser (Chromium 57-74) has no flex "gap" and no "aspect-ratio".
 *     build.js writes fallback rules under html.jw-nogap; this file turns them on and sizes
 *     square tiles by hand.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- 1. Node.js
  (function nodeShims() {
    var req = typeof require === "function" ? require : (window.cep_node && window.cep_node.require);
    if (!req) return;
    var fs, path, proc;
    try { fs = req("fs"); path = req("path"); } catch (e) { return; }
    proc = typeof process !== "undefined" ? process : (window.cep_node && window.cep_node.process);
    var v = ((proc && proc.versions && proc.versions.node) || "99.0.0").split(".");
    var major = +v[0] || 0, minor = +v[1] || 0;
    function older(M, m) { return major < M || (major === M && minor < m); }

    // stat.mtimeMs (Node 8.1)
    if (older(8, 1)) {
      ["statSync", "lstatSync"].forEach(function (name) {
        var orig = fs[name];
        fs[name] = function () {
          var st = orig.apply(fs, arguments);
          if (st && st.mtimeMs === undefined && st.mtime) st.mtimeMs = st.mtime.getTime();
          return st;
        };
      });
    }

    // copyFileSync (Node 8.5)
    if (typeof fs.copyFileSync !== "function") {
      fs.copyFileSync = function (src, dest) { fs.writeFileSync(dest, fs.readFileSync(src)); };
    }

    // mkdirSync(dir, { recursive: true }) (Node 10.12)
    if (older(10, 12)) {
      var mkdir = fs.mkdirSync;
      fs.mkdirSync = function (dir, opts) {
        var recursive = opts && typeof opts === "object" && opts.recursive;
        var mode = opts && typeof opts === "object" ? opts.mode : opts;
        if (!recursive) return mode === undefined ? mkdir.call(fs, dir) : mkdir.call(fs, dir, mode);
        dir = path.resolve(String(dir));
        try { if (fs.statSync(dir).isDirectory()) return; } catch (e) {}
        var parent = path.dirname(dir);
        if (parent !== dir) fs.mkdirSync(parent, { recursive: true, mode: mode });
        try { mode === undefined ? mkdir.call(fs, dir) : mkdir.call(fs, dir, mode); }
        catch (e) { if (e.code !== "EEXIST") throw e; }
      };
    }

    // readdirSync(dir, { withFileTypes: true }) (Node 10.10)
    if (older(10, 10)) {
      var readdir = fs.readdirSync;
      fs.readdirSync = function (dir, opts) {
        if (!(opts && typeof opts === "object" && opts.withFileTypes)) return readdir.apply(fs, arguments);
        return readdir.call(fs, dir).map(function (name) {
          var st = null;
          try { st = fs.lstatSync(path.join(String(dir), name)); } catch (e) {}
          return {
            name: name,
            isDirectory: function () { return !!st && st.isDirectory(); },
            isFile: function () { return !!st && st.isFile(); },
            isSymbolicLink: function () { return !!st && st.isSymbolicLink(); }
          };
        });
      };
    }

    // readdir(dir, { withFileTypes: true }, cb) (Node 10.10), used by the cache monitor and SFX browser
    if (older(10, 10)) {
      var readdirAsync = fs.readdir;
      fs.readdir = function (dir, opts, cb) {
        if (typeof opts === "function") return readdirAsync.call(fs, dir, opts);
        if (!(opts && typeof opts === "object" && opts.withFileTypes)) return readdirAsync.call(fs, dir, opts, cb);
        readdirAsync.call(fs, dir, function (err, names) {
          if (err) return cb(err);
          var out;
          try { out = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return cb(e); }
          cb(null, out);
        });
      };
    }

    // rmSync(p, { recursive, force }) (Node 14.14)
    if (typeof fs.rmSync !== "function") {
      fs.rmSync = function rm(p, opts) {
        opts = opts || {};
        var st;
        try { st = fs.lstatSync(p); }
        catch (e) { if (opts.force && e.code === "ENOENT") return; throw e; }
        if (st.isDirectory()) {
          if (!opts.recursive) { var err = new Error("Path is a directory: " + p); err.code = "ERR_FS_EISDIR"; throw err; }
          fs.readdirSync(p).forEach(function (n) { rm(path.join(String(p), n), opts); });
          fs.rmdirSync(p);
        } else {
          fs.unlinkSync(p);
        }
      };
    }
  })();

  // ---------------------------------------------------------------- 2. CSS
  var root = document.documentElement;

  // flex "gap" (Chromium 84): measure it
  function flexGapWorks() {
    var box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;gap:1px;position:absolute;visibility:hidden";
    box.appendChild(document.createElement("div"));
    box.appendChild(document.createElement("div"));
    (document.body || root).appendChild(box);
    var ok = box.scrollHeight === 1;
    box.parentNode.removeChild(box);
    return ok;
  }
  if (!flexGapWorks()) root.className += " jw-nogap";

  // aspect-ratio (Chromium 88): build.js lists the rules that use it
  var hasAR = window.CSS && CSS.supports && CSS.supports("aspect-ratio", "1 / 1");
  var AR = window.JW_COMPAT_AR || [];
  if (!hasAR && AR.length) {
    var queued = false;
    var fit = function () {
      queued = false;
      AR.forEach(function (r) {
        var els;
        try { els = document.querySelectorAll(r[0]); } catch (e) { return; }
        for (var i = 0; i < els.length; i++) {
          var w = els[i].offsetWidth, h = Math.round(w / r[1]) + "px";
          if (w && els[i].style.height !== h) els[i].style.height = h;
        }
      });
    };
    var soon = function () { if (!queued) { queued = true; requestAnimationFrame(fit); } };
    window.addEventListener("resize", soon);
    document.addEventListener("DOMContentLoaded", function () {
      soon();
      new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    });
  }
})();
