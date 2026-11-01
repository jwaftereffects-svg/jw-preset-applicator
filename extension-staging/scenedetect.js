/* JW Preset Applicator Pro - Smart Scene Detect
 *
 * Reads every frame of a clip (tiny grayscale thumbnails + exact timestamps from ffmpeg)
 * and finds the frame where each shot starts:
 *   - frame-exact: uses the real timestamp of every decoded frame (works with phone/VFR video)
 *   - adaptive: a change only counts as a cut if it stands out from the motion around it
 *   - flash-proof: if the picture comes back within a few frames, it was a flash, not a cut
 *   - minimum shot length, so there are no 1-frame slivers
 *
 * Works in the panel (window.JWPA_SceneDetect) and in Node for testing (module.exports).
 */
(function (root) {
  "use strict";
  if (typeof require !== "function") return;

  var cp = require("child_process");
  var W = 64, H = 36, PX = W * H, BINS = 32;

  // ---------------- reading frames ----------------
  // passthrough = exactly one output frame per decoded frame. Without it ffmpeg duplicates or
  // drops frames to keep a constant rate, and frame numbers drift off the real cuts.
  // New ffmpeg spells it -fps_mode, old ffmpeg only knows -vsync.
  var passFlag = {};
  function passthroughArgs(ff) {
    if (!passFlag[ff]) {
      var help = "";
      try { help = cp.spawnSync(ff, ["-hide_banner", "-h", "long"], { encoding: "utf8", windowsHide: true, maxBuffer: 8 << 20 }).stdout || ""; } catch (e) {}
      passFlag[ff] = help.indexOf("-fps_mode") >= 0 ? ["-fps_mode", "passthrough"] : ["-vsync", "0"];
    }
    return passFlag[ff];
  }

  // Resolves { frames: [Buffer], pts: [seconds from start] }.
  function readFrames(ff, file, start, dur, onProgress, isCancelled) {
    return new Promise(function (resolve, reject) {
      var args = ["-hide_banner", "-nostats", "-loglevel", "info", "-hwaccel", "auto",
        "-ss", Math.max(0, start).toFixed(4), "-t", Math.max(0.05, dur).toFixed(4), "-i", file,
        "-an", "-sn", "-dn", "-vf", "scale=" + W + ":" + H + ":flags=area,format=gray,showinfo"]
        .concat(passthroughArgs(ff), ["-f", "rawvideo", "pipe:1"]);
      var p;
      try { p = cp.spawn(ff, args, { windowsHide: true }); } catch (e) { return reject(e); }
      var frames = [], pts = [], pending = Buffer.alloc(0), errBuf = "", tail = [];
      p.stdout.on("data", function (d) {
        pending = pending.length ? Buffer.concat([pending, d]) : d;
        while (pending.length >= PX) {
          frames.push(Buffer.from(pending.subarray(0, PX)));
          pending = pending.subarray(PX);
        }
        if (onProgress) onProgress(frames.length);
        if (isCancelled && isCancelled()) { try { p.kill(); } catch (e) {} }
      });
      p.stderr.setEncoding("utf8");
      p.stderr.on("data", function (d) {
        errBuf += d;
        var lines = errBuf.split(/\r?\n/);
        errBuf = lines.pop();
        lines.forEach(function (l) {
          var m = /pts_time:\s*(-?[\d.]+)/.exec(l);
          if (m && l.indexOf("showinfo") >= 0) pts.push(parseFloat(m[1]));
          else if (l.trim()) { tail.push(l); if (tail.length > 6) tail.shift(); }
        });
      });
      p.on("error", reject);
      p.on("close", function () {
        if (isCancelled && isCancelled()) return reject(new Error("cancelled"));
        if (!frames.length) return reject(new Error("ffmpeg couldn't read the video: " + (tail.join(" ") || "no frames")));
        var n = Math.min(frames.length, pts.length || frames.length);
        frames.length = n;
        if (pts.length >= n) {
          pts.length = n;
          // With -ss before -i, ffmpeg already measures from the seek point (= the layer's in-point),
          // which keeps sub-frame accuracy when the in-point falls between video frames.
          // Only re-base if the timestamps look odd (some containers).
          var p0 = pts[0];
          if (p0 < -0.5 || p0 > 1) for (var i = 0; i < n; i++) pts[i] -= p0;
        } else {
          pts = null;
        }
        resolve({ frames: frames, pts: pts });
      });
    });
  }

  // ---------------- measuring change ----------------
  function hist(buf) {
    var h = new Float64Array(BINS);
    for (var i = 0; i < buf.length; i++) h[buf[i] >> 3]++;
    for (var b = 0; b < BINS; b++) h[b] /= buf.length;
    return h;
  }

  function mad(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  function histDiff(h1, h2) {
    var s = 0;
    for (var i = 0; i < BINS; i++) s += Math.abs(h1[i] - h2[i]);
    return s / 2; // 0..1
  }

  // Each frame with its brightness and contrast taken out, so fades, flashes and flicker
  // look the same as the original picture: only a real change of image shows up.
  function normalize(buf) {
    var n = buf.length, m = 0, v = 0, i;
    for (i = 0; i < n; i++) m += buf[i];
    m /= n;
    for (i = 0; i < n; i++) v += (buf[i] - m) * (buf[i] - m);
    var s = Math.max(4, Math.sqrt(v / n));
    var z = new Float32Array(n);
    for (i = 0; i < n; i++) z[i] = (buf[i] - m) / s;
    return z;
  }

  function structDiff(z1, z2) {
    var s = 0;
    for (var i = 0; i < z1.length; i++) s += Math.abs(z1[i] - z2[i]);
    return (s / z1.length) * 30; // roughly 0..60
  }

  // How different frame i is from frame i-1 (0 = identical). Mainly the change in picture
  // structure; the tone histogram only adds weight when the structure changed too.
  function scores(frames, zs) {
    var hs = frames.map(hist), d = [0];
    zs = zs || frames.map(normalize);
    for (var i = 1; i < frames.length; i++) {
      var st = structDiff(zs[i - 1], zs[i]);
      d.push(st + 15 * histDiff(hs[i - 1], hs[i]) * Math.min(1, st / 8));
    }
    return d;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[s.length >> 1];
  }

  // ---------------- finding cuts ----------------
  // opts: sensitivity 1..10 (5 = default), minShot (frames), flashFrames
  // Returns array of { frame, score } where frame = first frame of the new shot.
  function findCuts(frames, opts) {
    opts = opts || {};
    var sens = Math.max(1, Math.min(10, opts.sensitivity || 5));
    var ratio = 5.2 - sens * 0.38;          // how far above the local motion a jump must be (sens 5 -> 3.3)
    var floor = 18 - sens * 1.2;            // smallest jump that can ever be a cut (sens 5 -> 12)
    var minShot = Math.max(1, opts.minShot || 6);
    var flashFrames = opts.flashFrames === undefined ? 4 : opts.flashFrames;
    var zs = frames.map(normalize);
    var d = scores(frames, zs), cand = [];

    for (var i = 1; i < d.length; i++) {
      var local = [];
      for (var j = Math.max(1, i - 12); j <= Math.min(d.length - 1, i + 12); j++) if (Math.abs(j - i) > 1) local.push(d[j]);
      var base = Math.max(median(local), 1.5);
      // Rule 1: far above the usual motion around it.
      // Rule 2: a one-frame spike, clearly above the frames right next to it
      //         (catches cuts out of shots that already move a lot).
      var near = 0;
      for (var q = Math.max(1, i - 3); q <= Math.min(d.length - 1, i + 3); q++) if (q !== i) near = Math.max(near, d[q]);
      var spike = d[i] >= floor * 1.4 && d[i] >= Math.max(near, 1.5) * (2.6 - sens * 0.12);
      if (d[i] < floor || (d[i] < base * ratio && !spike)) continue;
      if ((i > 1 && d[i - 1] > d[i]) || (i + 1 < d.length && d[i + 1] > d[i])) continue; // local peak only

      // flash / strobe: the picture returns to what it was before within a few frames
      var flash = false;
      for (var k = 1; k <= flashFrames && i + k < frames.length; k++) {
        if (structDiff(zs[i - 1], zs[i + k]) < Math.max(5, d[i] * 0.25)) { flash = true; break; }
      }
      // ...or this is the end of a flash: the picture now matches what it was just before it
      for (var b = 2; !flash && b <= flashFrames + 1 && i - b >= 0; b++) {
        if (structDiff(zs[i], zs[i - b]) < Math.max(5, d[i] * 0.25)) flash = true;
      }
      if (flash) continue;
      cand.push({ frame: i, score: d[i] });
    }

    // minimum shot length: of two cuts too close together keep the stronger one
    var out = [];
    cand.forEach(function (c) {
      var last = out[out.length - 1];
      if (c.frame < minShot) return;                       // too close to the start of the clip
      if (frames.length - c.frame < minShot) return;       // too close to the end
      if (last && c.frame - last.frame < minShot) {
        if (c.score > last.score) out[out.length - 1] = c;
        return;
      }
      out.push(c);
    });
    return out;
  }

  // Full run for one clip. Resolves { cuts: [{ frame, t, score }], frames, duration }.
  // t = seconds from the start of the analysed range to the first frame of the new shot.
  function detect(ff, file, start, dur, fps, opts, onProgress, isCancelled) {
    return readFrames(ff, file, start, dur, onProgress, isCancelled).then(function (r) {
      var cuts = findCuts(r.frames, opts).map(function (c) {
        return { frame: c.frame, score: Math.round(c.score * 10) / 10, t: r.pts ? r.pts[c.frame] : c.frame / fps };
      });
      return { cuts: cuts, frames: r.frames.length, exactTimes: !!r.pts };
    });
  }

  var api = { readFrames: readFrames, scores: scores, findCuts: findCuts, detect: detect };
  if (typeof window !== "undefined") window.JWPA_SceneDetect = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(this);
