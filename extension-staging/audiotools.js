/* JW Preset Applicator Pro - audio analysis for the Tools tab (beat markers, silence cutting).
 * Plain math on mono float samples, so it runs in the panel and in Node tests alike.
 */
(function (root) {
  "use strict";

  // ffmpeg -> mono float32 samples. opts: { ffmpeg, file, start, dur, rate }
  function decode(cp, opts) {
    return new Promise(function (resolve, reject) {
      var args = ["-hide_banner", "-loglevel", "error"];
      if (opts.start > 0) args.push("-ss", String(opts.start));
      args.push("-i", opts.file);
      if (opts.dur > 0) args.push("-t", String(opts.dur));
      args.push("-vn", "-ac", "1", "-ar", String(opts.rate), "-f", "f32le", "pipe:1");
      var p = cp.spawn(opts.ffmpeg, args, { windowsHide: true }), chunks = [], size = 0, err = "";
      p.stdout.on("data", function (c) { chunks.push(c); size += c.length; });
      p.stderr.on("data", function (c) { err = (err + c).slice(-600); });
      p.on("error", reject);
      p.on("close", function (code) {
        if (code !== 0 && !size) return reject(new Error("ffmpeg couldn't read the audio" + (err ? ": " + err.trim() : "")));
        var buf = Buffer.concat(chunks, size), n = Math.floor(size / 4), out = new Float32Array(n);
        for (var i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
        resolve(out);
      });
    });
  }

  // ---------------------------------------------------------------- silence
  // Returns the parts to KEEP, in seconds: [[start, end], ...]
  // o: { rate, threshold (dB), relative (threshold is "this many dB below the loud parts"), minSilence (s), pad (s) }
  function speechRanges(samples, o) {
    var rate = o.rate, hop = Math.max(1, Math.round(rate * 0.01)), n = Math.floor(samples.length / hop), loud = new Uint8Array(n), rms = new Float32Array(n), i, j;
    for (i = 0; i < n; i++) {
      var s = 0;
      for (j = i * hop; j < (i + 1) * hop; j++) s += samples[j] * samples[j];
      rms[i] = Math.sqrt(s / hop);
    }
    var thr = Math.pow(10, (o.threshold || -40) / 20);
    if (o.relative && n) {
      // reference = the loud parts (95th percentile), so quiet and loud recordings behave the same
      var sorted = Array.prototype.slice.call(rms).sort(function (a, b) { return a - b; });
      thr = sorted[Math.floor(n * 0.95)] * Math.pow(10, -Math.abs(o.threshold || 30) / 20);
    }
    for (i = 0; i < n; i++) loud[i] = rms[i] >= thr && rms[i] > 1e-5 ? 1 : 0;
    var total = samples.length / rate, minSil = o.minSilence || 0.5, pad = o.pad || 0;
    // silent runs long enough to cut
    var cuts = [], start = -1;
    for (i = 0; i <= n; i++) {
      var quiet = i < n && !loud[i];
      if (quiet && start < 0) start = i;
      if (!quiet && start >= 0) {
        var a = start * hop / rate, b = i * hop / rate;
        if (b - a >= minSil) cuts.push([a, b]);
        start = -1;
      }
    }
    // keep = everything between cuts, padded a little so words aren't clipped
    var keep = [], cursor = 0;
    for (i = 0; i < cuts.length; i++) {
      var ks = cursor, ke = cuts[i][0];
      if (ke > ks) keep.push([Math.max(0, ks - (ks > 0 ? pad : 0)), Math.min(total, ke + pad)]);
      cursor = cuts[i][1];
    }
    if (cursor < total) keep.push([Math.max(0, cursor - (cursor > 0 ? pad : 0)), total]);
    // merge overlaps from padding, drop crumbs
    var merged = [];
    for (i = 0; i < keep.length; i++) {
      var k = keep[i];
      if (merged.length && k[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], k[1]);
      else merged.push([k[0], k[1]]);
    }
    return merged.filter(function (r) { return r[1] - r[0] >= 0.05; });
  }

  // ---------------------------------------------------------------- beats
  // Onset strength: rise in log energy per ~23 ms frame. "kick" first low-passes so bass hits lead.
  function onsetEnvelope(samples, rate, kick) {
    var x = samples, i;
    if (kick) {
      x = new Float32Array(samples.length);
      var a = Math.exp(-2 * Math.PI * 160 / rate), y = 0, y2 = 0;
      for (i = 0; i < samples.length; i++) { y = (1 - a) * samples[i] + a * y; y2 = (1 - a) * y + a * y2; x[i] = y2; }
    }
    var hop = Math.round(rate * 0.0116), win = hop * 2, n = Math.max(0, Math.floor((x.length - win) / hop)), env = new Float32Array(n), prev = 0;
    for (i = 0; i < n; i++) {
      var s = 0, base = i * hop;
      for (var j = 0; j < win; j++) s += x[base + j] * x[base + j];
      var e = Math.log(1e-10 + s / win);
      env[i] = i ? Math.max(0, e - prev) : 0;
      prev = e;
    }
    return { env: env, fps: rate / hop };
  }

  // Peaks that stand out from their surroundings. sens: 0.5 (few) .. 2 (many)
  function pickHits(E, sens, minGap) {
    var env = E.env, fps = E.fps, n = env.length, w = Math.max(1, Math.round(fps * 0.4)), gap = Math.max(1, Math.round(fps * minGap)), out = [], last = -1e9;
    var k = 1.6 / (sens || 1);
    for (var i = 1; i < n - 1; i++) {
      if (env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
      var a = Math.max(0, i - w), b = Math.min(n, i + w + 1), m = 0, v = 0, j;
      for (j = a; j < b; j++) m += env[j];
      m /= (b - a);
      for (j = a; j < b; j++) v += (env[j] - m) * (env[j] - m);
      var sd = Math.sqrt(v / (b - a));
      if (env[i] < m + k * sd || env[i] <= 0) continue;
      if (i - last < gap) { if (out.length && env[i] > env[Math.round(out[out.length - 1] * fps)]) { out[out.length - 1] = i / fps; last = i; } continue; }
      out.push(i / fps); last = i;
    }
    return out;
  }

  // Tempo from the onset envelope's self-similarity, then a steady grid locked to the strongest hits.
  function beatGrid(E, minBpm, maxBpm) {
    var env = E.env, fps = E.fps, n = env.length;
    if (n < fps * 4) return { bpm: 0, beats: [] };
    var lo = Math.floor(fps * 60 / (maxBpm || 180)), hi = Math.ceil(fps * 60 / (minBpm || 70)), best = 0, bestLag = lo, lag, i;
    for (lag = lo; lag <= hi; lag++) {
      var s = 0;
      for (i = lag; i < n; i++) s += env[i] * env[i - lag];
      s /= (n - lag);
      // gentle preference for ~120 BPM so halves/doubles don't win by a hair
      var bpm = 60 * fps / lag, wgt = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
      if (s * wgt > best) { best = s * wgt; bestLag = lag; }
    }
    // refine the period between whole frames
    var period = bestLag, phaseBest = -1, phase = 0, p;
    for (p = 0; p < period; p++) {
      var sum = 0;
      for (i = p; i < n; i += period) sum += env[Math.round(i)];
      if (sum > phaseBest) { phaseBest = sum; phase = p; }
    }
    var beats = [], tol = Math.max(1, Math.round(period * 0.12));
    for (var t = phase; t < n; t += period) {
      var c = Math.round(t), bi = c, bv = -1;
      for (i = Math.max(0, c - tol); i <= Math.min(n - 1, c + tol); i++) if (env[i] > bv) { bv = env[i]; bi = i; }
      beats.push(bi / fps);
    }
    return { bpm: Math.round(600 * fps / period) / 10, beats: beats };
  }

  var api = { decode: decode, speechRanges: speechRanges, onsetEnvelope: onsetEnvelope, pickHits: pickHits, beatGrid: beatGrid };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.JWAudio = api;
})(typeof window !== "undefined" ? window : null);
