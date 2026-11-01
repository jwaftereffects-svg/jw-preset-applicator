/* JW Preset Applicator Pro - Vocal Remover.
 *
 * Splits a song into vocals and instrumental with AI (Meta's Demucs model), on this PC:
 * nothing is uploaded. The heavy lifting runs in engine/vocals.py with its own Python,
 * installed in %LOCALAPPDATA%\JW Preset Applicator\vocal-engine. After Effects stays usable
 * while it works.
 *
 * Only the part of the song the layer uses is processed, and results are kept in
 * vocal-stems\ so running the same clip again is instant.
 */
(function () {
  "use strict";

  var J = window.JWPA;
  var $ = function (s) { return document.querySelector(s); };
  var card = $("#vrCard");
  if (!J || !card) return;

  var btn = $("#vrRun"), pickBtn = $("#vrFile"), statusEl = $("#vrStatus"), bar = $("#vrBar"), fill = bar.querySelector(".fill"), note = $("#vrNote");
  var RUN_LABEL = "Remove Vocals";

  function state(text, kind, pct) {
    statusEl.textContent = text;
    statusEl.className = "run-status " + (kind || "");
    bar.classList.toggle("indeterminate", pct === -1);
    bar.classList.toggle("done", pct === 100 && kind === "ok");
    if (pct >= 0) fill.style.width = pct + "%";
  }

  if (typeof require !== "function") {
    note.textContent = "The vocal remover only works inside After Effects.";
    btn.disabled = pickBtn.disabled = true;
    return;
  }

  var fs = require("fs"), path = require("path"), cp = require("child_process"), crypto = require("crypto"), os = require("os");
  var BASE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "JW Preset Applicator");
  var ENGINE = path.join(BASE, "vocal-engine"), STEMS = path.join(BASE, "vocal-stems");
  var HERE = path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1"));
  var SCRIPT = path.join(HERE, "engine", "vocals.py");

  function exists(p) { try { fs.statSync(p); return true; } catch (e) { return false; } }

  // what's needed to run: the engine's Python + packages + model, and an ffmpeg
  function findEngine() {
    var e = {
      python: path.join(ENGINE, "python", "python.exe"),
      site: path.join(ENGINE, "site-packages"),
      models: path.join(ENGINE, "models"),
      ffmpeg: path.join(ENGINE, "ffmpeg.exe"),
      // optional CUDA build of PyTorch: much faster on an NVIDIA card, CPU is the fallback
      gpuSite: exists(path.join(ENGINE, "site-packages-gpu", "torch")) ? path.join(ENGINE, "site-packages-gpu") : ""
    };
    if (!exists(e.ffmpeg)) {
      var SC = window.JWPA_SceneCut, ff = SC && SC.findFfmpeg ? SC.findFfmpeg() : "";
      e.ffmpeg = ff || "";
    }
    e.missing = !exists(e.python) ? "Python" : !exists(path.join(e.site, "demucs")) || !exists(path.join(e.site, "torch")) ? "the AI packages"
      : !exists(SCRIPT) ? "engine/vocals.py" : !e.ffmpeg ? "ffmpeg" : "";
    return e;
  }

  var eng = findEngine();
  if (eng.missing) {
    note.innerHTML = "";
    note.appendChild(document.createTextNode("The vocal engine isn't installed on this PC (missing " + eng.missing + "). It goes in " + ENGINE + "."));
    note.classList.add("warn-text");
  }

  // ------------------------------------------------------------------ run one clip
  var running = false, cancelled = false, child = null;

  function clipKey(clip, quality) {
    var h = crypto.createHash("sha1");
    if (clip.rendered) {
      // a fresh precomp render: same audio = same result, so key on the sound itself
      h.update(fs.readFileSync(clip.file));
    } else {
      var st = fs.statSync(clip.file);
      h.update([clip.file, st.size, st.mtime.getTime(), (clip.srcStart || 0).toFixed(3), (clip.srcDur || 0).toFixed(3)].join("|"));
    }
    return h.update("|" + quality).digest("hex").slice(0, 12);
  }

  // precomps: AE renders the layer's audio (solo, as it plays in the comp) to a WAV first
  function renderPrecomp(clip) {
    var out = path.join(STEMS, "_renders", safeName(clip.name) + "-" + Date.now() + ".wav");
    return J.host("vocalRender", {
      ref: clip.ref, precomp: true, compId: clip.compId, name: clip.name, inPoint: clip.inPoint, outPoint: clip.outPoint,
      renderStart: clip.renderStart, renderDur: clip.renderDur, out: out
    }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      return r.file;
    });
  }

  function safeName(s) { return String(s || "song").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[^\w \-]+/g, "").trim().slice(0, 40) || "song"; }

  function cached(dir) {
    var v = path.join(dir, "vocals.wav"), i = path.join(dir, "instrumental.wav");
    return exists(path.join(dir, "done.json")) && exists(v) && exists(i) ? { vocals: v, instrumental: i } : null;
  }

  function separate(clip, quality, onProgress) {
    var dir;
    try { dir = path.join(STEMS, safeName(clip.name) + "-" + clipKey(clip, quality)); }
    catch (e) { return Promise.reject(new Error("Can't read " + clip.file)); }
    var hit = cached(dir);
    if (hit) return Promise.resolve({ files: hit, cached: true });

    fs.mkdirSync(dir, { recursive: true });
    var req = path.join(dir, "request.json");
    fs.writeFileSync(req, JSON.stringify({
      input: clip.file, start: clip.srcStart || 0, duration: clip.srcDur || 0, outDir: dir, quality: quality,
      ffmpeg: eng.ffmpeg, models: eng.models, site: eng.site, gpuSite: eng.gpuSite
    }));

    return new Promise(function (resolve, reject) {
      var env = {};
      Object.keys(process.env).forEach(function (k) { env[k] = process.env[k]; });
      env.PYTHONIOENCODING = "utf-8";
      try { child = cp.spawn(eng.python, ["-I", "-S", SCRIPT, req], { windowsHide: true, env: env }); }
      catch (e) { return reject(e); }
      var buf = "", errTail = "", result = null, error = "";
      child.stdout.on("data", function (d) {
        buf += d.toString();
        var lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(function (line) {
          var m;
          try { m = JSON.parse(line); } catch (e) { return; }
          if (m.error) error = m.error;
          if (m.done) result = m;
          if (typeof m.progress === "number") onProgress(m.progress, m.message || "");
        });
      });
      child.stderr.on("data", function (d) { errTail = (errTail + d.toString()).slice(-2000); });
      child.on("error", function (e) { error = error || e.message; });
      child.on("close", function (code) {
        child = null;
        if (cancelled) return reject(new Error("cancelled"));
        if (code === 0 && result) return resolve({ files: result.files, cached: false });
        var last = errTail.trim().split(/\r?\n/).pop() || "";
        reject(new Error(error || last || "The vocal engine stopped (code " + code + ")"));
      });
    });
  }

  function stop() {
    cancelled = true;
    if (child) {
      // the engine runs ffmpeg too: end the whole process tree
      try { cp.execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }); }
      catch (e) { try { child.kill(); } catch (e2) {} }
    }
  }

  // ------------------------------------------------------------------ UI
  function finish(text, kind) {
    running = false;
    btn.classList.remove("running");
    btn.querySelector(".label").textContent = RUN_LABEL;
    pickBtn.disabled = false;
    state(text, kind, kind === "ok" ? 100 : 0);
    if (kind === "ok") { btn.classList.remove("done"); void btn.offsetWidth; btn.classList.add("done"); }
    if (J.jobFinished) J.jobFinished(); // a live update may be waiting for this job
  }

  function run(clips, skipped) {
    (skipped || []).forEach(function (s) { J.toast("Skipped " + s, "warn", 5000); });
    if (!clips.length) return;
    eng = findEngine();
    if (eng.missing) return J.toast("Vocal engine missing (" + eng.missing + ")", "bad", 5000);

    var quality = J.opt("vr.quality") || "best", keep = J.opt("vr.keep") || "both", mute = !!J.opt("vr.mute");
    running = true; cancelled = false;
    btn.classList.add("running");
    btn.querySelector(".label").textContent = "Cancel";
    pickBtn.disabled = true;
    state("Getting ready…", "", -1);

    var t0 = Date.now(), done = 0, added = 0, imported = 0, chain = Promise.resolve();
    clips.forEach(function (clip, idx) {
      chain = chain.then(function () {
        if (cancelled) return;
        var label = clips.length > 1 ? (idx + 1) + "/" + clips.length + " · " : "";
        var job = clip, rendered = "";
        var ready = Promise.resolve();
        if (clip.precomp) {
          state(label + "Rendering the precomp's audio…", "", -1);
          ready = renderPrecomp(clip).then(function (file) {
            rendered = file;
            job = { name: clip.name, file: file, rendered: true, srcStart: 0, srcDur: 0 };
          });
        }
        return ready.then(function () {
          if (cancelled) return null;
          return separate(job, quality, function (pct, msg) {
            state(label + msg + " " + Math.round(pct) + "%", "", Math.min(99, pct));
          });
        }).then(function (r) {
          if (rendered) { try { fs.unlinkSync(rendered); } catch (e) {} } // the stems are kept, the render isn't needed
          if (cancelled || !r) return;
          state(label + (r.cached ? "Already separated · adding…" : "Adding to the comp…"), "", 99);
          return J.host("vocalPlace", {
            ref: clip.ref || null, precomp: !!clip.precomp, compId: clip.compId, file: clip.file,
            name: clip.name, inPoint: clip.inPoint, outPoint: clip.outPoint,
            placeAt: clip.precomp ? clip.renderStart : undefined,
            stems: r.files, keep: keep, mute: mute
          }).then(function (p) {
            if (!p.ok) throw new Error(p.error);
            done++; added += p.added; imported += p.imported;
          });
        });
      });
    });

    chain.then(function () {
      var secs = Math.round((Date.now() - t0) / 1000);
      if (cancelled) return finish("Cancelled" + (done ? " · " + done + " done before that" : ""), "");
      var what = keep === "vocals" ? "Vocals" : keep === "instrumental" ? "Instrumental" : "Vocals + instrumental";
      var text = what + (added ? " added" : " imported to the project") + (clips.length > 1 ? " for " + done + " clips" : "") + " (" + secs + "s)";
      finish(text, "ok");
      J.toast(text, "ok", 3600);
      J.emit("action", { name: "vocals", ok: true, msg: text });
    }).catch(function (e) {
      var msg = e && e.message === "cancelled" ? "Cancelled" : "Failed: " + (e && e.message || e);
      finish(msg, msg === "Cancelled" ? "" : "bad");
      if (msg !== "Cancelled") J.emit("action", { name: "vocals", ok: false, msg: msg });
    });
  }

  function pickAndRun() {
    J.host("pickFile", { title: "Choose a song or video", filter: "Audio and video:*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.aif;*.aiff;*.mp4;*.mov;*.mkv;*.webm;*.avi,All files:*.*" }).then(function (r) {
      if (!r.ok || !r.path) return;
      run([{ file: r.path, name: path.basename(r.path), srcStart: 0, srcDur: 0 }], []);
    });
  }

  btn.addEventListener("click", function () {
    if (running) { stop(); state("Cancelling…", "", -1); return; }
    J.host("vocalPrep").then(function (prep) {
      if (!prep.ok) return J.toast(prep.error, "bad", 4000);
      if (prep.clips.length) return run(prep.clips, prep.skipped);
      if (prep.skipped.length) return run([], prep.skipped);
      pickAndRun(); // nothing selected: pick a file instead
    });
  });
  pickBtn.addEventListener("click", function () { if (!running) pickAndRun(); });

  // don't let a live update reload the panel in the middle of a separation
  var prevBusy = J.topazBusy;
  J.topazBusy = function () { return running || !!(prevBusy && prevBusy()); };
  window.addEventListener("beforeunload", function () { if (running) stop(); });
})();
