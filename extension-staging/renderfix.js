/* JW Preset Applicator Pro - render check & repair.
 *
 * Background renders share the PC with the After Effects you're editing in. When memory or
 * graphics memory runs short, plugins can hand back garbage without any error: blocky or
 * black frames, wrong effects, frames out of place. This checks a finished render and fixes it:
 *
 *   1. Look through every frame of the render for one-frame spikes and sudden black frames.
 *   2. Re-render a sample of frames (every Nth) in safe mode (multi-frame rendering off)
 *      and compare them with the render.
 *   3. Re-render, in safe mode, each stretch that didn't match and each suspicious frame.
 *      Stretches that come out the same are left alone.
 *   4. Splice the fixed stretches in and re-encode once. The original is only replaced
 *      after the fixed file is complete; if anything fails, the original stays as it was.
 *
 * Works in the panel (window.JWRenderFix) and in plain Node (module.exports) for tests.
 */
(function (root) {
  "use strict";
  if (typeof require !== "function") return; // needs Node (After Effects panel or tests)
  var fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");

  var SMALL = 64, FRAME_BYTES = SMALL * SMALL * 3;
  var BAD_DIFF = 10;          // mean colour difference (0-255) that counts as a different frame
  var MAX_SAMPLES = 100, MIN_STEP = 10, MAX_RANGES = 6;

  // ---------------------------------------------------------------- tools
  function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

  // ffmpeg that can re-encode: one with libx264 is best (your own ffmpeg), Topaz's works for ProRes / NVENC
  var ffmpegCache;   // looked up once per session (each lookup runs every ffmpeg found)
  function findFfmpeg() {
    if (ffmpegCache !== undefined) return ffmpegCache;
    ffmpegCache = findFfmpegNow();
    return ffmpegCache;
  }
  function findFfmpegNow() {
    var list = [], seen = {};
    function add(p) { if (p && !seen[p.toLowerCase()] && exists(p)) { seen[p.toLowerCase()] = 1; list.push(p); } }
    (process.env.PATH || "").split(path.delimiter).forEach(function (d) { add(path.join(d, "ffmpeg.exe")); });
    add("C:\\ffmpeg\\bin\\ffmpeg.exe");
    add(path.join(process.env.ProgramFiles || "C:\\Program Files", "Topaz Labs LLC", "Topaz Video AI", "ffmpeg.exe"));
    var best = null;
    list.forEach(function (f) {
      var enc = "";
      try { enc = cp.execFileSync(f, ["-hide_banner", "-encoders"], { windowsHide: true, encoding: "utf8", timeout: 15000 }); } catch (e) { return; }
      var info = { ffmpeg: f, ffprobe: path.join(path.dirname(f), "ffprobe.exe"), x264: /libx264 /.test(enc), nvenc: /h264_nvenc/.test(enc), prores: /prores_ks /.test(enc) };
      if (!exists(info.ffprobe)) return;
      if (!best || (info.x264 && !best.x264)) best = info;
    });
    return best;
  }

  function run(exe, args, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var child, out = [], err = "", outLen = 0;
      try { child = cp.spawn(exe, args, { windowsHide: true }); } catch (e) { return resolve({ code: -1, err: e.message, stdout: Buffer.alloc(0), stderr: "" }); }
      if (opts.track) opts.track(child);
      child.stdout.on("data", function (d) { if (opts.binary) { out.push(d); outLen += d.length; } });
      child.stderr.on("data", function (d) { err += d.toString(); if (err.length > 200000) err = err.slice(-100000); if (opts.onErr) opts.onErr(d.toString()); });
      child.on("error", function (e) { resolve({ code: -1, err: e.message, stdout: Buffer.concat(out, outLen), stderr: err }); });
      child.on("close", function (code) {
        var data;
        try { data = Buffer.concat(out, outLen); } catch (e) { data = Buffer.alloc(0); err += " (output too large: " + e.message + ")"; }
        resolve({ code: code, stdout: data, stderr: err });
      });
    });
  }

  function probe(tools, file) {
    return run(tools.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries",
      "stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_frames,bit_rate,color_range,color_space,color_transfer,color_primaries:format=bit_rate",
      "-of", "json", file], { binary: true }).then(function (r) {
      var j = {};
      try { j = JSON.parse(r.stdout.toString()); } catch (e) {}
      var s = (j.streams || [])[0];
      if (!s) return null;
      var fr = String(s.r_frame_rate || "0/1").split("/");
      s.fps = parseFloat(fr[0]) / (parseFloat(fr[1]) || 1);
      s.bits = parseInt(s.bit_rate || (j.format || {}).bit_rate || "0", 10) || 0;
      return s;
    });
  }

  // every frame of a video (or numbered image sequence), shrunk to 64x64 RGB, as one Buffer
  function smallFrames(tools, input, isSeq, yuv) {
    var args = ["-hide_banner", "-v", "error"];
    if (isSeq) args.push("-framerate", "30", "-start_number", "0");
    args.push("-i", input, "-map", "0:v:0", "-vf",
      "scale=" + SMALL + ":" + SMALL + ":flags=area" + (yuv ? ":in_color_matrix=bt709:in_range=tv" : "") + ",format=rgb24",
      "-f", "rawvideo", "-");
    return run(tools.ffmpeg, args, { binary: true }).then(function (r) {
      return { data: r.stdout, count: Math.floor(r.stdout.length / FRAME_BYTES), errors: r.stderr.trim() };
    });
  }

  function frameAt(buf, i) { return buf.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES); }
  // compares two 64x64 frames as 16x16 block averages, so compression noise on sharp edges
  // and chroma subsampling don't count, while real glitches (wrong colours, blocks, black) do
  function blocks(a) {
    var o = new Float32Array(16 * 16 * 3);
    for (var y = 0; y < SMALL; y++) for (var x = 0; x < SMALL; x++) for (var c = 0; c < 3; c++)
      o[((y >> 2) * 16 + (x >> 2)) * 3 + c] += a[(y * SMALL + x) * 3 + c] / 16;
    return o;
  }
  function diff(a, b) {
    var A = blocks(a), B = blocks(b), s = 0;
    for (var i = 0; i < A.length; i++) { var d = A[i] - B[i]; s += d < 0 ? -d : d; }
    return s / A.length;
  }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

  // ---------------------------------------------------------------- step 1: suspicious frames
  // A one-frame spike: very different from both neighbours, while the neighbours match each other.
  // A sudden black frame: (near) black, while frames three either side are not.
  function suspects(small) {
    var out = [], n = small.count, d = small.data;
    for (var i = 1; i < n - 1; i++) {
      var a = frameAt(d, i - 1), b = frameAt(d, i), c = frameAt(d, i + 1);
      var d1 = diff(a, b), d2 = diff(b, c), d3 = diff(a, c), lo = Math.min(d1, d2);
      if (lo > 18 && d3 < lo * 0.35) { out.push(i); continue; }
      if (i >= 3 && i < n - 3 && mean(b) < 3 && mean(frameAt(d, i - 3)) > 25 && mean(frameAt(d, i + 3)) > 25) out.push(i);
    }
    return out;
  }

  // ---------------------------------------------------------------- safe re-renders (TIFF frames)
  function aerenderArgs(o, s, e, dir, rate, withChannels) {
    var args = (o.aerenderPrefix || []).concat(["-project", o.project, "-comp", o.comp, "-s", String(s), "-e", String(e),
      "-RStemplate", "Best Settings", "-OMtemplate", "TIFF Sequence with Alpha"]);
    if (withChannels) args.push("-outputSettings", "Channels: RGB");
    if (rate) args.push("-renderSettings", "Frame Rate: Use this frame rate; Use this frame rate: " + rate);
    return args.concat(["-output", path.join(dir, "f_[#####].tif"), "-mfr", "OFF", "100", "-mem_usage", "15", "40"]);
  }

  // renames whatever came out to f000000.tif, f000001.tif ... and returns how many
  function tidySequence(dir) {
    var files = [];
    try { files = fs.readdirSync(dir).filter(function (f) { return /\.tif$/i.test(f) && f.indexOf("f_") === 0; }).sort(); } catch (e) {}
    files.forEach(function (f, i) { fs.renameSync(path.join(dir, f), path.join(dir, "s" + ("00000" + i).slice(-6) + ".tif")); });
    return files.length;
  }

  // renders comp frames s..e (comp frame numbers) into dir; tries plain RGB first, then with alpha
  function renderFrames(o, s, e, dir, rate) {
    function attempt(withChannels) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {}
      fs.mkdirSync(dir, { recursive: true });
      return o.runAerender(aerenderArgs(o, s, e, dir, rate, withChannels)).then(function (r) {
        if (o.cancelled()) return { count: 0, cancelled: true };
        var count = tidySequence(dir);
        if ((r.code !== 0 || !count) && withChannels) return attempt(false);
        return { count: count, alpha: !withChannels, code: r.code };
      });
    }
    return attempt(true);
  }

  function seqInput(dir) { return path.join(dir, "s%06d.tif"); }
  // straight alpha from AE gets flattened onto black, like the export did
  function smallFramesSeq(tools, dir, alpha) {
    var vf = (alpha ? "premultiply=inplace=1," : "") + "scale=" + SMALL + ":" + SMALL + ":flags=area,format=rgb24";
    return run(tools.ffmpeg, ["-hide_banner", "-v", "error", "-framerate", "30", "-start_number", "0", "-i", seqInput(dir),
      "-vf", vf, "-f", "rawvideo", "-"], { binary: true }).then(function (r) {
      return { data: r.stdout, count: Math.floor(r.stdout.length / FRAME_BYTES) };
    });
  }

  // Safe re-render of sample frames. One render of every Nth frame (by lowering the render
  // frame rate); if aerender won't take that setting, a dozen single-frame renders instead.
  var FALLBACK_SAMPLES = 12;
  function sampleFrames(tools, o, work, info, n) {
    var step = Math.max(MIN_STEP, Math.ceil(n / MAX_SAMPLES)), dir = path.join(work, "samples");
    o.stage("Checking frames · safe re-render of " + Math.ceil(n / step) + " sample frames", 5);
    return renderFrames(o, o.startFrame, o.endFrame, dir, info.fps / step).then(function (rf) {
      if (rf.cancelled) throw new Error("cancelled");
      var expect = Math.ceil(n / step);
      if (rf.count && Math.abs(rf.count - expect) <= 1) {
        return smallFramesSeq(tools, dir, rf.alpha).then(function (ref) {
          var out = [];
          for (var k = 0; k < ref.count && k * step < n; k++) out.push({ f: k * step, px: frameAt(ref.data, k) });
          return out;
        });
      }
      // fallback: separate single frames spread over the render
      var picks = [], out = [];
      for (var i = 0; i < FALLBACK_SAMPLES; i++) picks.push(Math.round((n - 1) * (i + 0.5) / FALLBACK_SAMPLES));
      return picks.reduce(function (p, f, i) {
        return p.then(function () {
          if (o.cancelled()) throw new Error("cancelled");
          o.stage("Checking frames · safe re-render of sample " + (i + 1) + "/" + picks.length, 5 + 15 * i / picks.length);
          var d = path.join(work, "one" + i);
          return renderFrames(o, o.startFrame + f, o.startFrame + f, d, 0).then(function (r1) {
            if (r1.count !== 1) return;
            return smallFramesSeq(tools, d, r1.alpha).then(function (ref) { if (ref.count) out.push({ f: f, px: frameAt(ref.data, 0) }); });
          });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }

  // ---------------------------------------------------------------- ranges
  function mergeRanges(list, gap, n) {
    list = list.map(function (r) { return [Math.max(0, r[0]), Math.min(n - 1, r[1])]; }).filter(function (r) { return r[1] >= r[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    list.forEach(function (r) {
      var last = out[out.length - 1];
      if (last && r[0] <= last[1] + gap) last[1] = Math.max(last[1], r[1]); else out.push(r.slice());
    });
    // too many separate renders: join the closest neighbours
    while (out.length > MAX_RANGES) {
      var best = 1, bestGap = Infinity;
      for (var i = 1; i < out.length; i++) { var g = out[i][0] - out[i - 1][1]; if (g < bestGap) { bestGap = g; best = i; } }
      out[best - 1][1] = out[best][1];
      out.splice(best, 1);
    }
    return out;
  }

  // ---------------------------------------------------------------- final encode
  function encodeArgs(tools, info) {
    var c = info.codec_name;
    if (c === "h264" || c === "hevc") {
      var br = info.bits || 15000000;
      if (tools.x264) return ["-c:v", "libx264", "-preset", "medium", "-b:v", String(br), "-maxrate", String(Math.round(br * 1.5)), "-bufsize", String(br * 2), "-pix_fmt", "yuv420p"];
      if (tools.nvenc) return ["-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-b:v", String(br), "-maxrate", String(Math.round(br * 1.5)), "-pix_fmt", "yuv420p"];
      return null;
    }
    if (c === "prores" && tools.prores) {
      var prof = /4444/.test(info.profile || "") ? "4" : /HQ/i.test(info.profile || "") ? "3" : /LT/i.test(info.profile || "") ? "1" : /Proxy/i.test(info.profile || "") ? "0" : "2";
      if (prof === "4") return null; // alpha: leave it alone
      return ["-c:v", "prores_ks", "-profile:v", prof, "-vendor", "apl0", "-pix_fmt", "yuv422p10le"];
    }
    return null;
  }

  function splice(tools, o, info, n, fixes, outFile) {
    var yuvFmt = /422/.test(info.pix_fmt || "") ? (/10/.test(info.pix_fmt) ? "yuv422p10le" : "yuv422p") : "yuv420p";
    var args = ["-hide_banner", "-v", "error", "-y", "-i", o.file];
    fixes.forEach(function (f) { args.push("-framerate", String(info.fps), "-start_number", "0", "-i", seqInput(f.dir)); });
    var parts = [], labels = [], at = 0;
    fixes.forEach(function (f, k) {
      if (f.range[0] > at) { parts.push("[0:v]trim=start_frame=" + at + ":end_frame=" + f.range[0] + ",setpts=PTS-STARTPTS,format=" + yuvFmt + "[o" + k + "]"); labels.push("[o" + k + "]"); }
      parts.push("[" + (k + 1) + ":v]" + (f.alpha ? "premultiply=inplace=1," : "") + "trim=end_frame=" + (f.range[1] - f.range[0] + 1) +
        ",setpts=PTS-STARTPTS,scale=" + info.width + ":" + info.height + ":out_color_matrix=bt709:out_range=tv,format=" + yuvFmt + "[r" + k + "]");
      labels.push("[r" + k + "]");
      at = f.range[1] + 1;
    });
    if (at < n) { parts.push("[0:v]trim=start_frame=" + at + ",setpts=PTS-STARTPTS,format=" + yuvFmt + "[tail]"); labels.push("[tail]"); }
    parts.push(labels.join("") + "concat=n=" + labels.length + ":v=1:a=0,setpts=N/(" + info.fps + "*TB)[v]");
    args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-map", "0:a?", "-c:a", "copy", "-r", String(info.fps));
    args = args.concat(encodeArgs(tools, info));
    args.push("-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-movflags", "+faststart", outFile);
    return run(tools.ffmpeg, args, { track: o.track });
  }

  // ---------------------------------------------------------------- main
  // o: { file, project, comp, startFrame, endFrame, aerender, runAerender(args) -> Promise<{code}>,
  //      tmp, stage(text, pct), cancelled(), track(child) }
  // resolves { checked, fixedFrames, note }
  function checkAndRepair(o) {
    o.cancelled = o.cancelled || function () { return false; };
    o.stage = o.stage || function () {};
    var tools = findFfmpeg();
    if (!tools) return Promise.resolve({ checked: false, fixedFrames: 0, note: "not checked (no ffmpeg found)" });
    var info, n, small, work = path.join(o.tmp, "check"), result = { checked: false, fixedFrames: 0, note: "" };
    try { fs.mkdirSync(work, { recursive: true }); } catch (e) {}

    return probe(tools, o.file).then(function (p) {
      info = p;
      if (!info) throw new Error("couldn't read the render");
      if (/yuva|gbrap|argb|rgba|bgra|abgr|^ya/.test(info.pix_fmt || "")) {
        result.note = "not checked (has transparency)"; return null;
      }
      if (!encodeArgs(tools, info)) { result.note = "not checked (" + info.codec_name + " isn't supported for repair)"; return null; }
      o.stage("Checking frames", 0);
      return smallFrames(tools, o.file, false, true);
    }).then(function (s) {
      if (!s) return null;
      small = s; n = s.count;
      var expected = o.endFrame - o.startFrame + 1;
      if (expected > 60000) { result.note = "not checked (too long to check)"; return null; } // ~1.3 GB of thumbnails otherwise
      if (n < 2) throw new Error("couldn't decode the render");
      if (Math.abs(n - expected) > 1) result.note = "frame count " + n + " vs " + expected + " expected";
      n = Math.min(n, expected);

      var sus = suspects(small).filter(function (i) { return i < n; });
      return sampleFrames(tools, o, work, info, n).then(function (samples) {
        // samples: [{ f: frame index in the render, px: safe re-render of it }] in order
        var bad = [], ranges = [];
        samples.forEach(function (s, j) { if (diff(s.px, frameAt(small.data, s.f)) > BAD_DIFF) bad.push(j); });
        if (samples.length >= 3 && bad.length === samples.length) {
          // every sample differs: more likely the comparison itself is off than the whole render
          result.note = "sample check inconclusive";
          bad = [];
        }
        // a bad sample means everything up to the neighbouring good samples gets re-rendered
        bad.forEach(function (j) {
          ranges.push([j > 0 ? samples[j - 1].f + 1 : 0, j < samples.length - 1 ? samples[j + 1].f - 1 : n - 1]);
        });
        sus.forEach(function (i) { ranges.push([i - 2, i + 2]); });
        if (!samples.length) result.partial = "only quick glitches were checked";
        result.checked = samples.length > 0;
        result.samples = samples.length; result.badSamples = bad.length; result.suspects = sus.length;
        var gap = samples.length > 1 ? samples[1].f - samples[0].f : MIN_STEP;
        return mergeRanges(ranges, gap, n);
      });
    }).then(function (ranges) {
      if (!ranges || !ranges.length) return [];
      var fixes = [], total = ranges.reduce(function (s, r) { return s + r[1] - r[0] + 1; }, 0), done = 0;
      return ranges.reduce(function (p, r, idx) {
        return p.then(function () {
          if (o.cancelled()) throw new Error("cancelled");
          o.stage("Re-rendering frames " + (r[0] + 1) + "\u2013" + (r[1] + 1) + " safely (" + (idx + 1) + "/" + ranges.length + ")", 20 + 60 * done / total);
          var dir = path.join(work, "fix" + idx);
          return renderFrames(o, o.startFrame + r[0], o.startFrame + r[1], dir, 0).then(function (rf) {
            done += r[1] - r[0] + 1;
            if (rf.cancelled) throw new Error("cancelled");
            if (rf.count !== r[1] - r[0] + 1) return; // couldn't re-render this stretch exactly: keep the original frames
            return smallFramesSeq(tools, dir, rf.alpha).then(function (ref) {
              var differ = 0;
              for (var i = 0; i < ref.count; i++) if (diff(frameAt(ref.data, i), frameAt(small.data, r[0] + i)) > BAD_DIFF) differ++;
              if (differ) fixes.push({ range: r, dir: dir, alpha: rf.alpha, differ: differ });
            });
          });
        });
      }, Promise.resolve()).then(function () { return fixes; });
    }).then(function (fixes) {
      if (!fixes || !fixes.length) {
        if (!result.note) result.note = result.checked ? "all frames OK" : (result.partial || "");
        return result;
      }
      o.stage("Splicing in " + fixes.length + " fixed stretch" + (fixes.length === 1 ? "" : "es"), 85);
      var ext = path.extname(o.file), fixed = o.file.slice(0, -ext.length) + ".fixing" + ext;
      return splice(tools, o, info, n, fixes, fixed).then(function (r) {
        if (r.code !== 0 || !exists(fixed)) { try { fs.unlinkSync(fixed); } catch (e) {} throw new Error("re-encode failed: " + String(r.stderr || r.err || "").trim().split(/\r?\n/).pop()); }
        return probe(tools, fixed).then(function (pi) {
          var cnt = pi && parseInt(pi.nb_frames || "0", 10);
          if (!pi || (cnt && Math.abs(cnt - n) > 1)) { try { fs.unlinkSync(fixed); } catch (e) {} throw new Error("fixed file came out wrong"); }
          var bak = o.file + ".before-fix";
          fs.renameSync(o.file, bak);
          try { fs.renameSync(fixed, o.file); } catch (e) { fs.renameSync(bak, o.file); throw e; }
          try { fs.unlinkSync(bak); } catch (e) {}
          result.fixedFrames = fixes.reduce(function (s, f) { return s + f.range[1] - f.range[0] + 1; }, 0);
          result.note = "fixed " + result.fixedFrames + " frame" + (result.fixedFrames === 1 ? "" : "s") + (result.partial ? " · " + result.partial : "");
          result.fixes = fixes.map(function (f) { return f.range; });
          return result;
        });
      });
    }).then(function (res) {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
      return res;
    }, function (e) {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch (x) {}
      return { checked: false, fixedFrames: 0, note: "check stopped: " + (e.message || e) + " (original kept)" };
    });
  }

  var api = { checkAndRepair: checkAndRepair, findFfmpeg: findFfmpeg,
    _t: { suspects: suspects, mergeRanges: mergeRanges, smallFrames: smallFrames, smallFramesSeq: smallFramesSeq, diff: diff, frameAt: frameAt } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.JWRenderFix = api;
})(typeof window !== "undefined" ? window : null);
