/* JW Preset Applicator Pro - finds the real cut inside a small gap/overlap between two clips.
 *
 * Scene Edit Detection sometimes cuts a frame or two early or late. For each gap we read
 * the frames around it (tiny grayscale thumbnails via ffmpeg) and look for the biggest
 * jump between neighbouring frames: that's where the shot actually changes. Frames before
 * the jump belong to the previous clip, frames after it to the next clip.
 *
 * Works in the panel (window.JWPA_SceneCut) and in Node for testing (module.exports).
 */
(function (root) {
  "use strict";
  if (typeof require !== "function") return; // browser preview: no Node, no frame reading

  var cp = require("child_process"), fs = require("fs"), path = require("path");
  var W = 48, H = 27;           // thumbnail size used for comparing frames
  var MIN_JUMP = 6;             // average grey-level change (0-255) that counts as a cut
  var RATIO = 1.8;              // the cut must stand out this much from the other changes

  function findFfmpeg() {
    var c = ["C:\\ffmpeg\\bin\\ffmpeg.exe"];
    try {
      var w = cp.spawnSync("where", ["ffmpeg"], { encoding: "utf8", windowsHide: true });
      if (w.stdout) w.stdout.split(/\r?\n/).forEach(function (l) { if (l.trim()) c.push(l.trim()); });
    } catch (e) {}
    var pf = process.env.ProgramFiles || "C:\\Program Files";
    c.push(path.join(pf, "Topaz Labs LLC", "Topaz Video AI", "ffmpeg.exe"));
    c.push(path.join(pf, "Topaz Labs LLC", "Topaz Video", "ffmpeg.exe"));
    for (var i = 0; i < c.length; i++) { try { if (fs.existsSync(c[i])) return c[i]; } catch (e) {} }
    return "";
  }

  // One small grayscale frame of `file` at `t` seconds, as raw bytes (or null).
  function grab(ff, file, t) {
    return new Promise(function (resolve) {
      var chunks = [];
      var p;
      try {
        p = cp.spawn(ff, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, t).toFixed(4), "-i", file,
          "-frames:v", "1", "-vf", "scale=" + W + ":" + H + ",format=gray", "-f", "rawvideo", "pipe:1"], { windowsHide: true });
      } catch (e) { return resolve(null); }
      p.stdout.on("data", function (d) { chunks.push(d); });
      p.on("error", function () { resolve(null); });
      p.on("close", function () {
        var buf = Buffer.concat(chunks);
        resolve(buf.length >= W * H ? buf.subarray(0, W * H) : null);
      });
    });
  }

  function mad(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  function sameSource(pair) {
    var a = pair.a, b = pair.b;
    return !!a.file && a.file === b.file && Math.abs(a.startTime - b.startTime) < 1e-4 &&
      Math.abs(a.stretch - 100) < 1e-3 && Math.abs(b.stretch - 100) < 1e-3 && !a.remap && !b.remap;
  }

  // Pure decision step (testable): frames[i] is the image at frame lo+i.
  // Returns { cutFrame, confident, jumps }.
  function pickCut(frames, lo, allowed) {
    var jumps = [];
    for (var i = 1; i < frames.length; i++) jumps.push({ f: lo + i, d: mad(frames[i - 1], frames[i]) });
    var cand = jumps.filter(function (j) { return allowed(j.f); });
    if (!cand.length) return { cutFrame: null, confident: false, jumps: jumps };
    cand.sort(function (x, y) { return y.d - x.d; });
    var best = cand[0];
    var others = jumps.filter(function (j) { return j !== best; });
    var second = others.length ? Math.max.apply(null, others.map(function (j) { return j.d; })) : 0;
    var confident = best.d >= MIN_JUMP && best.d >= second * RATIO;
    return { cutFrame: best.f, confident: confident, jumps: jumps };
  }

  // Decide the cut time for one gap/overlap. Resolves { cut, how } where how is
  // "auto" (found in the frames) or "fallback" (couldn't tell; caller applies its rule).
  // win = how many frames either side of the current cut to search.
  function analyze(ff, pair, fd, win) {
    if (!ff) return Promise.resolve({ cut: null, how: "fallback", why: "no ffmpeg" });
    if (!sameSource(pair)) return Promise.resolve({ cut: null, how: "fallback", why: "different sources" });
    win = Math.max(0, win || 0);
    var aOutF = Math.round(pair.aOut / fd), bInF = Math.round(pair.bIn / fd);
    var aInF = pair.aIn !== undefined ? Math.round(pair.aIn / fd) : -1e9;
    var bOutF = pair.bOut !== undefined ? Math.round(pair.bOut / fd) : 1e9;
    var lo = Math.max(Math.min(aOutF, bInF) - win, aInF + 1) - 1;  // never search before the previous clip starts
    var hi = Math.min(Math.max(aOutF, bInF) + win, bOutF - 1);      // ...or after the next clip ends
    var times = [];
    // ffmpeg returns the first frame at/after the seek time, so aim half a frame early
    for (var f = lo; f <= hi; f++) times.push(f * fd - pair.a.startTime - fd * 0.5);
    return Promise.all(times.map(function (t) { return grab(ff, pair.a.file, t); })).then(function (frames) {
      if (frames.some(function (x) { return !x; })) return { cut: null, how: "fallback", why: "couldn't read frames" };
      var eps = fd * 0.01;
      var r = pickCut(frames, lo, function (c) {
        var t = c * fd;
        return t <= pair.a.limits.maxOut + eps && t >= pair.b.limits.minIn - eps && c > aInF && c < bOutF;
      });
      if (!r.confident) return { cut: null, how: "fallback", why: "no clear cut" };
      return { cut: r.cutFrame * fd, how: "auto", moved: r.cutFrame - bInF, changed: r.cutFrame !== aOutF || r.cutFrame !== bInF };
    });
  }

  var api = { findFfmpeg: findFfmpeg, grab: grab, mad: mad, pickCut: pickCut, analyze: analyze, sameSource: sameSource };
  if (typeof window !== "undefined") window.JWPA_SceneCut = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(this);
