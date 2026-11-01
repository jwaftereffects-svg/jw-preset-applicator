/* JW Preset Applicator Pro - background Topaz Video AI jobs
 *
 * For each selected layer:
 *   1. Precomp  -> rendered by aerender from a COPY of the saved project (the open project is never touched)
 *      Footage  -> its source file is used directly, trimmed to the layer
 *   2. Topaz Video AI's own ffmpeg enhances it with the chosen preset (same command the Topaz app runs)
 *   3. The result is imported into a "Topaz Renders" folder and, optionally, placed above the original layer
 * Jobs run one at a time, in separate processes, so After Effects stays usable.
 */
(function () {
  "use strict";

  var J = window.JWPA;
  var $ = function (s) { return document.querySelector(s); };
  if (!J || typeof require !== "function") {
    var st = $("#tzStatus");
    if (st) st.textContent = "Needs Node.js (only works inside After Effects)";
    var b = $("#tzSend"); if (b) b.disabled = true;
    return;
  }

  var cp = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");

  // Per-install defaults (config.js is written by the build: personal copy vs. installer copy)
  var CONFIG = window.JWPA_CONFIG || {};
  var PREFER_PRESET = CONFIG.topazDefault ? new RegExp(CONFIG.topazDefault, "i") : null;

  var PROGRAM_FILES = process.env.ProgramFiles || "C:\\Program Files";
  var PROGRAM_DATA = process.env.ProgramData || "C:\\ProgramData";
  var TOPAZ_APP = path.join(PROGRAM_FILES, "Topaz Labs LLC", "Topaz Video AI");
  var FFMPEG = path.join(TOPAZ_APP, "ffmpeg.exe");
  var TOPAZ_DATA = path.join(PROGRAM_DATA, "Topaz Labs LLC", "Topaz Video AI");
  var MODELS = path.join(TOPAZ_DATA, "models");
  var PRESETS = path.join(TOPAZ_DATA, "presets");
  var TEMP_ROOT = path.join(os.tmpdir(), "jwpa-topaz");

  // ------------------------------------------------------------------
  // Presets -> the exact ffmpeg filter the Topaz app would use
  // ------------------------------------------------------------------
  var presets = [];

  function loadPresets() {
    presets = [];
    try {
      fs.readdirSync(PRESETS).forEach(function (f) {
        if (!/\.json$/i.test(f)) return;
        try {
          var data = JSON.parse(fs.readFileSync(path.join(PRESETS, f), "utf8"));
          if (data && data.settings) presets.push({ file: f, name: String(data.name || f.replace(/\.json$/i, "")).trim(), data: data });
        } catch (e) {}
      });
    } catch (e) {}
    presets.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function even(n) { n = Math.max(2, Math.round(n)); return n % 2 ? n + 1 : n; }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function r2(v) { return Math.round(v * 100) / 100; }

  var MODEL_KEYS = { proteus: "prob-3" }; // what this Topaz version runs for Proteus (seen in its logs)

  // Returns { filter, outW, outH, warnings }
  function buildFilter(preset, inW, inH) {
    var s = preset.data.settings || {};
    var e = s.enhance || {}, out = s.output || {};
    var warnings = [];

    var pct = 100;
    var outW = inW, outH = inH;
    if (out.active) {
      var method = String(out.outSizeMethod || "");
      if (/^\d+(\.\d+)?$/.test(method) || num(out.scale, 0) > 0) {
        pct = num(out.scale, num(method, 100));
        outW = even(inW * pct / 100);
        outH = even(inH * pct / 100);
      } else if (num(out.width, 0) > 0 && num(out.height, 0) > 0) {
        outW = even(num(out.width, inW));
        outH = even(num(out.height, inH));
      }
      if (num(out.outFPS, 0) > 0) warnings.push("frame rate change is ignored");
    }

    ["stabilize", "motionblur", "slowmo", "grain"].forEach(function (k) {
      if (s[k] && s[k].active) warnings.push(k + " is not supported here and is skipped");
    });

    var parts = [];
    if (e.active) {
      var model = MODEL_KEYS[e.model] || e[e.model] || e.model;
      var up = ["tvai_up=model=" + model, "scale=0", "w=" + outW, "h=" + outH];
      if (e.model === "proteus") {
        up.push("preblur=" + r2(num(e.deblur, 0) / 100));
        up.push("noise=" + r2(num(e.denoise, 0) / 100));
        up.push("details=" + r2(num(e.detail, 0) / 100));
        up.push("halo=" + r2(num(e.dehalo, 0) / 100));
        up.push("blur=" + r2(num(e.sharpen, 0) / 100));
        up.push("compression=" + r2(num(e.compress, 0) / 100));
      }
      up.push("device=0", "vram=1", "instances=1");
      parts.push(up.join(":"));
    }
    parts.push("scale=w=" + outW + ":h=" + outH + ":flags=lanczos:threads=0");
    return { filter: parts.join(","), outW: outW, outH: outH, warnings: warnings, model: e.active ? (MODEL_KEYS[e.model] || e[e.model] || e.model) : "none" };
  }

  // ------------------------------------------------------------------
  // Settings UI
  // ------------------------------------------------------------------
  var sel = $("#tzPreset"), info = $("#tzPresetInfo");
  var outDir = J.store.get("tz.outDir", "");

  function renderPresets() {
    loadPresets();
    sel.innerHTML = "";
    if (!presets.length) {
      var o = document.createElement("option");
      o.textContent = "No Topaz presets found";
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    var want = J.store.get("tz.preset", "");
    var pick = 0;
    presets.forEach(function (p, i) {
      var o = document.createElement("option");
      o.value = p.file;
      o.textContent = p.name;
      sel.appendChild(o);
      if (want ? p.file === want : (PREFER_PRESET && PREFER_PRESET.test(p.name))) pick = i;
    });
    sel.selectedIndex = pick;
    showPresetInfo();
  }

  function currentPreset() { return presets[sel.selectedIndex] || null; }

  function showPresetInfo() {
    var p = currentPreset();
    if (!p) { info.textContent = ""; return; }
    var e = p.data.settings.enhance || {}, o = p.data.settings.output || {};
    var bits = [];
    if (e.active) bits.push((e.model || "model") + (e.model === "proteus" ? " \u00B7 detail " + e.detail + " \u00B7 sharpen " + e.sharpen + " \u00B7 denoise " + e.denoise : ""));
    if (o.active && num(o.scale, 100) !== 100) bits.push(num(o.scale, 100) + "% size");
    info.textContent = bits.join(" \u00B7 ");
  }

  sel.addEventListener("change", function () {
    var p = currentPreset();
    if (p) J.store.set("tz.preset", p.file);
    showPresetInfo();
  });

  function showOutDir() {
    $("#tzOut").textContent = outDir || "Next to the project, in \u201CTopaz Renders\u201D";
    $("#tzOut").classList.toggle("path", !!outDir);
    $("#tzOut").title = outDir || "";
  }

  $("#tzOutBtn").addEventListener("click", function () {
    J.host("pickFolder").then(function (r) {
      if (r.ok && r.path) { outDir = r.path; J.store.set("tz.outDir", outDir); showOutDir(); }
    });
  });
  $("#tzOut").addEventListener("dblclick", function () { outDir = ""; J.store.set("tz.outDir", ""); showOutDir(); });

  [["#tzPlace", "tz.place", true], ["#tzHideOrig", "tz.hideOrig", false], ["#tzLowPri", "tz.lowPri", true], ["#tzKeep", "tz.keep", false], ["#tzTurbo", "tz.turbo", false]].forEach(function (d) {
    var el = $(d[0]);
    el.checked = !!J.store.get(d[1], d[2]);
    el.addEventListener("change", function () { J.store.set(d[1], el.checked); });
  });

  // ------------------------------------------------------------------
  // Process helpers
  // ------------------------------------------------------------------
  function q(a) { return '"' + String(a) + '"'; }

  // Starts a process. With lowPriority it goes through `start /belownormal`, so the
  // process (and anything it launches, like aerender's AfterFX) gets lower CPU priority.
  function launch(exe, args, opts, lowPriority) {
    opts = opts || {};
    if (!lowPriority) return cp.spawn(exe, args, { env: opts.env, windowsHide: true });
    var line = 'start "" /b /wait /belownormal ' + [exe].concat(args).map(q).join(" ");
    return cp.spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", '"' + line + '"'], {
      env: opts.env, windowsHide: true, windowsVerbatimArguments: true
    });
  }

  function killTree(child) {
    if (!child || child.exitCode !== null) return;
    try { cp.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch (e) {}
  }

  function lines(stream, fn) {
    var buf = "";
    stream.setEncoding("utf8");
    stream.on("data", function (d) {
      buf += d;
      var parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      parts.forEach(fn);
    });
  }

  function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

  function safeFile(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "layer"; }

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // ------------------------------------------------------------------
  // Jobs
  // ------------------------------------------------------------------
  var jobs = [], running = null, nextId = 1;
  J.topazBusy = function () { return (!!running && !running.detached) || jobs.some(function (j) { return j.state === "queued"; }); };

  function addJob(spec, meta) {
    var job = {
      id: nextId++, spec: spec, meta: meta, state: "queued", stage: "Waiting", pct: 0,
      child: null, cancelled: false, log: []
    };
    jobs.push(job);
    renderJobs();
    pump();
  }

  function pump() {
    if (running) return;
    var next = jobs.filter(function (j) { return j.state === "queued"; })[0];
    if (!next) { J.jobFinished(); return; }
    running = next;
    runJob(next).then(function () {
      running = null;
      renderJobs();
      pump();
    });
  }

  function setStage(job, stage, pct) {
    job.stage = stage;
    if (pct !== undefined) job.pct = Math.max(0, Math.min(100, pct));
    updateJobRow(job);
  }

  function fail(job, msg) {
    if (job.cancelled) { job.state = "cancelled"; job.stage = "Cancelled"; }
    else {
      job.state = "error"; job.stage = msg; J.toast(job.spec.name + ": " + msg, "bad", 6000);
      if (J.emit) J.emit("action", { name: job.spec.kind === "export" ? "export" : "topaz", ok: false, msg: job.spec.name + ": " + msg });
    }
    updateJobRow(job);
  }

  function runStep(job, exe, args, opts, onLine) {
    return new Promise(function (resolve) {
      var child;
      try { child = launch(exe, args, opts, job.meta.lowPri); } catch (e) { return resolve({ code: -1, err: e.message }); }
      job.child = child;
      var tail = [];
      function take(l) {
        if (!l) return;
        tail.push(l); if (tail.length > 12) tail.shift();
        onLine(l);
      }
      lines(child.stdout, take);
      lines(child.stderr, take);
      child.on("error", function (e) { resolve({ code: -1, err: e.message, tail: tail }); });
      child.on("close", function (code) { job.child = null; resolve({ code: code, tail: tail }); });
    });
  }

  // Turn aerender's errors into something actionable.
  function renderError(r, spec) {
    var tail = (r.tail || []).join(" ");
    if (/No comp was found/i.test(tail)) {
      return "\u201C" + spec.renderComp + "\u201D isn't in the saved project file \u00B7 save (Ctrl+S) and send it again";
    }
    return r.err || lastUseful(r.tail || []);
  }

  function lastUseful(tail) {
    for (var i = tail.length - 1; i >= 0; i--) {
      var l = tail[i];
      if (/error|fail|unable|not found|invalid|denied/i.test(l)) return l.slice(0, 180);
    }
    return (tail[tail.length - 1] || "unknown error").slice(0, 180);
  }

  // Quick export: aerender straight to the chosen output template, no Topaz, no import.
  function exportExt(template) {
    if (/H\.264/i.test(template)) return ".mp4";
    if (/AIFF/i.test(template)) return ".aif";
    if (/Audio Only/i.test(template)) return ".wav";
    if (/Photoshop/i.test(template)) return "_[#####].psd";
    if (/TIFF/i.test(template)) return "_[#####].tif";
    if (/Sequence|Multi-Machine/i.test(template)) return "_[#####].png";
    return ".mov";
  }

  function runExport(job) {
    var spec = job.spec, meta = job.meta;
    job.state = "running";
    var base = safeFile(spec.name) + "_" + stamp();
    var ext = exportExt(meta.template), isSeq = ext.indexOf("[#####]") >= 0;
    var dir = isSeq ? path.join(meta.outDir, base) : meta.outDir;
    var tmp = path.join(TEMP_ROOT, "export" + job.id + "-" + Date.now());
    try { fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(tmp, { recursive: true }); }
    catch (e) { fail(job, "Couldn't create folders: " + e.message); return Promise.resolve(); }

    setStage(job, "Exporting \u00B7 " + meta.template, 0);
    var projCopy = path.join(tmp, "project_copy.aep");
    try { fs.copyFileSync(meta.project, projCopy); } catch (e) { fail(job, "Couldn't copy the project: " + e.message); rmrf(tmp); return Promise.resolve(); }
    var out = path.join(dir, base + ext);
    var baseArgs = ["-project", projCopy, "-comp", spec.renderComp, "-s", String(spec.startFrame), "-e", String(spec.endFrame),
      "-RStemplate", "Best Settings", "-OMtemplate", meta.template, "-output", out];
    var ctx = { dir: dir, base: base, isSeq: isSeq, tmp: tmp };

    // Attempt 1 keeps memory in check while your main After Effects is open too;
    // attempt 2 (only after running out of memory) turns multi-frame rendering off.
    function attempt(n) {
      var args = baseArgs.concat(memoryArgs(n, meta.detach, meta.turbo));
      var run;
      if (meta.detach) {
        ctx.log = path.join(tmp, "aerender" + n + ".log");
        run = startOutside(meta.aerender, args, ctx.log, meta.lowPri).then(function (pid) {
          ctx.pid = pid;
          job.detached = true;
          job.ctx = ctx;
          rememberBg(job);
          if (n === 1) setStage(job, "Exporting in the background \u00B7 " + meta.template, 0);
          return watchOutside(job, ctx);
        }, function (e) {
          rmrf(tmp);
          fail(job, "Couldn't start the background render: " + (e.message || e));
        });
      } else {
        job.maxFrame = 0; job.memErr = false; job.renderErr = false;
        run = runStep(job, meta.aerender, args, {}, function (l) { trackRenderLine(job, l); }).then(function (r) {
          r.maxFrame = job.maxFrame; r.memErr = job.memErr; r.renderErr = job.renderErr;
          return r;
        });
      }
      return run.then(function (r) {
        if (!r) return;
        // retry only when memory ran out or the render stopped early (not for other errors)
        if (n === 1 && !job.cancelled && (r.memErr || (r.maxFrame > 0 && r.maxFrame < spec.frames))) {
          forgetBg(job);
          removeOutputs(ctx);
          setStage(job, "Ran out of memory \u00B7 retrying with lower memory use", 0);
          J.toast(spec.name + ": ran out of memory, retrying with multi-frame rendering off (slower, steadier)", "warn", 5000);
          return attempt(2);
        }
        return finishExport(job, ctx, r);
      });
    }
    return attempt(1);
  }

  // ---- render health -------------------------------------------------
  // aerender flags: attempt 1 caps RAM and limits multi-frame rendering, attempt 2 turns it off.
  // Full speed: every CPU core and more RAM for the render (editing in AE gets slower meanwhile).
  function memoryArgs(n, background, turbo) {
    // capped so a background render never starves the After Effects you're editing in
    if (n === 1 && turbo) return ["-mfr", "ON", "60", "-mem_usage", "15", "35"];
    if (n === 1) return background ? ["-mfr", "ON", "40", "-mem_usage", "10", "25"] : ["-mem_usage", "15", "40"];
    return ["-mfr", "OFF", "100", "-mem_usage", "10", "20"];
  }

  var MEM_RE = /run out of memory|unable to allocate|out of memory/i;
  var ERR_RE = /aerender ERROR|^ERROR|unable to allocate|run out of memory|cannot complete this export/i;

  // reads one aerender output line: progress + whether it hit an error
  function trackRenderLine(job, l) {
    var m = /PROGRESS:.*\((\d+)\)/.exec(l);
    if (m) {
      var fnum = parseInt(m[1], 10);
      if (fnum > (job.maxFrame || 0)) job.maxFrame = fnum;
      setStage(job, job.stage, (fnum / job.spec.frames) * 100);
    }
    if (ERR_RE.test(l)) job.renderErr = true;
    if (MEM_RE.test(l)) job.memErr = true;
  }

  // a render that hit an error or stopped before its last frame isn't a finished export
  // a render that ran out of memory, stopped before its last frame, or errored before any frame
  function renderIncomplete(r, spec) {
    if (r.memErr) return true;
    if (r.maxFrame > 0 && r.maxFrame < spec.frames) return true;
    return !!r.renderErr && !r.maxFrame;
  }

  function outputsOf(ctx) {
    var made = [];
    try { fs.readdirSync(ctx.dir).forEach(function (f) { if (f.indexOf(ctx.base) === 0) made.push(path.join(ctx.dir, f)); }); } catch (e) {}
    return made;
  }
  function removeOutputs(ctx) { outputsOf(ctx).forEach(function (p) { rmrf(p); }); }

  // After a render: re-render samples safely, compare, and splice in fixes (see renderfix.js).
  // Never fails the job: if the check can't run, the render is kept as it is.
  function checkRender(job, file, projCopy) {
    var spec = job.spec, meta = job.meta;
    if (!meta.check || !window.JWRenderFix || !fs.existsSync(projCopy)) return Promise.resolve(null);
    var before = job.stage;
    return window.JWRenderFix.checkAndRepair({
      file: file, project: projCopy, comp: spec.renderComp, startFrame: spec.startFrame, endFrame: spec.endFrame,
      tmp: path.dirname(projCopy),
      runAerender: function (args) { return runStep(job, meta.aerender, args, {}, function () {}); },
      stage: function (text, pct) { setStage(job, text, pct); },
      cancelled: function () { return !!job.cancelled; }
    }).then(function (r) {
      setStage(job, before, 100);
      if (r && r.fixedFrames) J.toast(spec.name + ": " + r.note + " (they glitched while rendering)", "ok", 6000);
      else if (r && /stopped|inconclusive|only quick/.test(r.note)) J.toast(spec.name + ": frame check · " + r.note, "warn", 5000);
      job.checkNote = r && r.note;
      return r;
    }, function () { return null; });
  }

  // Shared ending for both modes: find the file, then import it if wanted.
  function finishExport(job, ctx, r) {
    var spec = job.spec, meta = job.meta;
    forgetBg(job);
    if (job.cancelled) { rmrf(ctx.tmp); fail(job); return; }
    // the template picks the real container, so find whatever came out with our name
    var made = [];
    try { fs.readdirSync(ctx.dir).forEach(function (f) { if (f.indexOf(ctx.base) === 0) made.push(path.join(ctx.dir, f)); }); } catch (e) {}
    if (renderIncomplete(r, spec)) {
      made.forEach(function (p) {
        var ext = path.extname(p);
        try { fs.renameSync(p, p.slice(0, -ext.length) + "_INCOMPLETE" + ext); } catch (e) {}
      });
      var where = r.maxFrame ? " at frame " + r.maxFrame + " of " + spec.frames : "";
      if (!r.memErr && !r.maxFrame) fail(job, "Export failed: " + renderError(r, spec)); // the real reason, not "out of memory"
      else fail(job, (r.memErr ? "Ran out of memory" : "Render stopped") + where + " \u00B7 close other heavy apps or lower the comp resolution, then export again");
      rmrf(ctx.tmp);
      return;
    }
    if (r.code !== 0 || !made.length) { rmrf(ctx.tmp); fail(job, "Export failed: " + renderError(r, spec)); return; }
    job.file = ctx.isSeq ? ctx.dir : made[0];
    // check the frames (and fix glitched stretches) before anything uses the file
    var checked = ctx.isSeq ? Promise.resolve(null) : checkRender(job, made[0], path.join(ctx.tmp, "project_copy.aep"));
    return checked.then(function () {
      rmrf(ctx.tmp);
      if (job.cancelled) { fail(job); return; }
      return deliver();
    });

    function done(note, toastMsg) {
      job.state = "done";
      setStage(job, "Done \u00B7 " + path.basename(job.file) + (note ? " \u00B7 " + note : "") + (job.checkNote ? " \u00B7 " + job.checkNote : ""), 100);
      J.toast(toastMsg, "ok", 3500);
    }
    function deliver() {
    if (spec.proxy) {
      return J.host("projectPath").then(function (pp) {
        var same = pp.ok && pp.path && path.resolve(pp.path).toLowerCase() === path.resolve(meta.project).toLowerCase();
        if (!same) return done("rendered \u00B7 open its project and pre-render again to use it", "Pre-render of " + spec.name + " finished, but a different project is open");
        setStage(job, "Turning on instant preview", 100);
        return J.host("setProxy", { compId: spec.compId, file: job.file }).then(function (r) {
          if (!r.ok) { fail(job, "Couldn't use the pre-render: " + r.error); return; }
          done("instant preview on", spec.name + " plays instantly now");
          if (J.emit) J.emit("action", { name: "prerender", ok: true, msg: spec.name + " pre-rendered" });
        });
      });
    }
    if (J.emit) J.emit("action", { name: "export", ok: true, msg: spec.name + " \u2192 " + path.basename(job.file) });
    if (!meta.importWhenDone) return done("", "Exported " + spec.name);
    // only import into the project it came from (you may have opened another .aep meanwhile)
    return J.host("projectPath").then(function (pp) {
      var same = pp.ok && pp.path && path.resolve(pp.path).toLowerCase() === path.resolve(meta.project).toLowerCase();
      if (!same) return done("saved (another project is open)", "Exported " + spec.name + " \u00B7 not imported, a different project is open");
      setStage(job, "Importing", 100);
      var first = made.slice().sort()[0];
      return J.host("importFile", { file: first, sequence: ctx.isSeq, folder: "Exports" }).then(function (imp) {
        if (imp.ok) done("imported", "Exported and imported " + spec.name);
        else { done("", "Exported " + spec.name); J.toast("Import failed: " + imp.error, "warn", 5000); }
      });
    });
    }
  }

  // ------------------------------------------------------------------
  // Background renders that outlive the panel
  //
  // Started through Windows' own process service (WMI), so the render doesn't belong to
  // After Effects or this panel: switching projects, reloading or closing the panel won't
  // stop it. Output goes to a log file, which is how progress is read (and re-read after
  // a reload). Running ones are remembered so the job list picks them up again.
  // ------------------------------------------------------------------
  var BG_KEY = "jwpa.bgjobs.v1";

  function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

  function startOutside(exe, args, log, lowPri) {
    var inner = [exe].concat(args).map(q).join(" ") + " > " + q(log) + " 2>&1";
    var cmdline = '"' + (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") + '" /d /s /c "' + inner + '"';
    var ps = "$s=([wmiclass]'Win32_ProcessStartup').CreateInstance();$s.ShowWindow=0;" +
      (lowPri ? "$s.PriorityClass=16384;" : "") +
      "$r=([wmiclass]'Win32_Process').Create(" + psQuote(cmdline) + "," + psQuote(path.dirname(log)) + ",$s);" +
      "Write-Output ($r.ReturnValue.ToString()+' '+$r.ProcessId)";
    return new Promise(function (resolve, reject) {
      cp.execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")],
        { windowsHide: true }, function (err, stdout) {
          var m = /(\d+)\s+(\d+)/.exec(String(stdout || ""));
          if (err || !m || m[1] !== "0") return reject(new Error(err ? err.message : "Windows refused to start it (" + String(stdout).trim() + ")"));
          resolve(parseInt(m[2], 10));
        });
    });
  }

  // is this PID still one of our render processes? (Windows reuses PIDs after a reboot or crash)
  function pidIsOurs(pid) {
    if (!pid || pid <= 0) return false;
    try {
      var out = cp.execFileSync("tasklist", ["/FI", "PID eq " + pid, "/FO", "CSV", "/NH"], { windowsHide: true, encoding: "utf8", timeout: 5000 });
      return /"(cmd|aerender|AfterFX\.com|AfterFX)\.?(exe)?"/i.test(out) || /\b(cmd\.exe|aerender\.exe|AfterFX\.com)\b/i.test(out);
    } catch (e) { return false; }
  }

  function alive(pid) {
    if (!pid || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
  }

  // Follows the log file until the process is gone. Resolves like runStep: { code, tail }.
  function watchOutside(job, ctx) {
    return new Promise(function (resolve) {
      var pos = 0, buf = "", tail = [];
      job.maxFrame = 0; job.memErr = false; job.renderErr = false;
      function read() {
        try {
          var st = fs.statSync(ctx.log);
          if (st.size > pos) {
            var fd = fs.openSync(ctx.log, "r"), b = Buffer.alloc(st.size - pos);
            fs.readSync(fd, b, 0, b.length, pos); fs.closeSync(fd);
            pos = st.size;
            var parts = (buf + b.toString("utf8")).split(/\r?\n|\r/);
            buf = parts.pop();
            parts.forEach(function (l) {
              if (!l) return;
              tail.push(l); if (tail.length > 12) tail.shift();
              trackRenderLine(job, l);
            });
          }
        } catch (e) {}
      }
      var timer = setInterval(function () {
        read();
        if (!alive(ctx.pid)) {
          clearInterval(timer);
          read();
          resolve({ code: job.renderErr || job.cancelled ? 1 : 0, tail: tail, maxFrame: job.maxFrame, memErr: job.memErr, renderErr: job.renderErr });
        }
      }, 800);
      job.stopWatch = function () { clearInterval(timer); };
    });
  }

  function bgList() { try { return JSON.parse(localStorage.getItem(BG_KEY) || "[]") || []; } catch (e) { return []; } }
  function bgSave(list) { try { localStorage.setItem(BG_KEY, JSON.stringify(list)); } catch (e) {} }
  function rememberBg(job) {
    var list = bgList().filter(function (b) { return b.ctx.pid !== job.ctx.pid; });
    list.push({ spec: job.spec, meta: job.meta, ctx: job.ctx, started: Date.now() });
    bgSave(list);
  }
  function forgetBg(job) {
    if (!job.ctx || !job.ctx.pid) return;
    bgSave(bgList().filter(function (b) { return b.ctx.pid !== job.ctx.pid; }));
  }

  // After a reload: put remembered background renders back in the list and keep following them.
  function resumeBackground() {
    var DAY = 24 * 3600 * 1000, keep = [];
    bgList().forEach(function (b) {
      if (b.started && Date.now() - b.started > DAY) return;                        // too old: forget it
      if (b.ctx && b.ctx.pid && alive(b.ctx.pid) && !pidIsOurs(b.ctx.pid)) b.ctx.pid = -1; // PID reused by something else
      keep.push(b);
    });
    bgSave(keep.filter(function (b) { return b.ctx.pid > 0; }));
    keep.forEach(function (b) {
      var job = { id: nextId++, spec: b.spec, meta: b.meta, ctx: b.ctx, detached: true, state: "running", stage: "Exporting in the background \u00B7 " + b.meta.template, pct: 0, log: [] };
      jobs.push(job);
      watchOutside(job, b.ctx).then(function (r) {
        return finishExport(job, b.ctx, r);
      }).then(function () { renderJobs(); });
    });
  }

  function runJob(job) {
    var spec = job.spec, meta = job.meta;
    if (spec.kind === "export") return runExport(job);
    job.state = "running";
    var tmp = path.join(TEMP_ROOT, "job" + job.id + "-" + Date.now());
    var base = safeFile(spec.name) + "_" + safeFile(meta.preset.name).replace(/\s+/g, "") + "_" + stamp();
    var finalPath = path.join(meta.outDir, base + ".mov");
    var input = null;

    try { fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(meta.outDir, { recursive: true }); }
    catch (e) { fail(job, "Couldn't create folders: " + e.message); return Promise.resolve(); }

    var p = Promise.resolve(true);

    // 1. Render precomps with aerender from a copy of the saved project
    if (spec.kind === "comp") {
      p = p.then(function () {
        setStage(job, "Rendering in After Effects", 0);
        var projCopy = path.join(tmp, "project_copy.aep");
        try { fs.copyFileSync(meta.project, projCopy); } catch (e) { fail(job, "Couldn't copy the project: " + e.message); return false; }
        var renderOut = path.join(tmp, "render.mov");
        var args = ["-project", projCopy, "-comp", spec.renderComp, "-s", String(spec.startFrame), "-e", String(spec.endFrame),
          "-RStemplate", "Best Settings", "-OMtemplate", "High Quality", "-output", renderOut].concat(memoryArgs(1, true, meta.turbo));
        job.maxFrame = 0; job.memErr = false; job.renderErr = false;
        return runStep(job, meta.aerender, args, {}, function (l) { trackRenderLine(job, l); }).then(function (r) {
          if (job.cancelled) { fail(job); return false; }
          r.maxFrame = job.maxFrame; r.memErr = job.memErr; r.renderErr = job.renderErr;
          // a render that stopped early would send black frames to Topaz
          if (renderIncomplete(r, spec)) {
            fail(job, (r.memErr ? "Ran out of memory" : "Render stopped") + (r.maxFrame ? " at frame " + r.maxFrame + " of " + spec.frames : "") +
              " · close other heavy apps, then send it again");
            return false;
          }
          // the template decides the container, so look for whatever render.* came out
          var made = null;
          try { fs.readdirSync(tmp).forEach(function (f) { if (/^render\./i.test(f)) made = path.join(tmp, f); }); } catch (e) {}
          if (r.code !== 0 || !made) { fail(job, "Render failed: " + renderError(r, spec)); return false; }
          input = made;
          // fix glitched frames before they get enhanced
          return checkRender(job, made, projCopy).then(function () {
            if (job.cancelled) { fail(job); return false; }
            return true;
          });
        });
      });
    } else {
      input = spec.file;
    }

    // 2. Enhance with Topaz
    p = p.then(function (okSoFar) {
      if (!okSoFar) return false;
      var f = buildFilter(meta.preset, spec.width, spec.height);
      job.outSize = f.outW + "\u00D7" + f.outH;
      if (f.warnings.length) J.toast(spec.name + ": " + f.warnings.join(", "), "warn", 5000);
      setStage(job, "Enhancing with Topaz (" + f.model + ")", 0);

      var args = ["-hide_banner", "-nostdin", "-y", "-nostats", "-progress", "pipe:1"];
      if (spec.kind === "footage") args.push("-ss", String(spec.ss), "-t", String(spec.duration));
      args.push("-i", input,
        "-sws_flags", "spline+accurate_rnd+full_chroma_int",
        "-color_trc", "2", "-colorspace", "2", "-color_primaries", "2",
        "-filter_complex", f.filter,
        "-c:v", "prores_ks", "-profile:v", "1", "-vendor", "apl0", "-quant_mat", "lt", "-bits_per_mb", "525",
        "-pix_fmt", "yuv422p10le", "-map_metadata", "0",
        "-movflags", "+use_metadata_tags+write_colr", // plain (not fragmented) .mov so AE imports it cleanly
        "-c:a", "copy", finalPath);

      var env = Object.assign({}, process.env, { TVAI_MODEL_DIR: MODELS, TVAI_MODEL_DATA_DIR: MODELS + "\\" });
      return runStep(job, FFMPEG, args, { env: env }, function (l) {
        var m = /^frame=(\d+)/.exec(l);
        if (m) setStage(job, job.stage, (parseInt(m[1], 10) / spec.frames) * 100);
      }).then(function (r) {
        if (job.cancelled) { rmrf(finalPath); fail(job); return false; }
        var exists = false;
        try { exists = fs.statSync(finalPath).size > 0; } catch (e) {}
        if (r.code !== 0 || !exists) { rmrf(finalPath); fail(job, "Topaz failed: " + (r.err || lastUseful(r.tail || []))); return false; }
        return true;
      });
    });

    // 3. Bring it back into After Effects
    p = p.then(function (okSoFar) {
      if (!okSoFar) return;
      setStage(job, "Importing", 100);
      if (meta.keep && input && spec.kind === "comp") {
        try { fs.copyFileSync(input, path.join(meta.outDir, base + "_render" + path.extname(input))); } catch (e) {}
      }
      return J.host("projectPath").then(function (pp) {
        var same = !meta.project || (pp.ok && pp.path && path.resolve(pp.path).toLowerCase() === path.resolve(meta.project).toLowerCase());
        if (!same) {
          job.state = "done"; job.file = finalPath;
          setStage(job, "Done \u00B7 saved (another project is open, so it wasn't placed)", 100);
          J.toast(spec.name + " is back from Topaz \u00B7 saved to " + path.basename(finalPath) + ", not placed (a different project is open)", "warn", 6000);
          return;
        }
        return importTopaz();
      });
      function importTopaz() { return J.host("topazImport", {
        file: finalPath, place: meta.place, hideOriginal: meta.hideOriginal, compId: spec.compId, layerIndex: spec.layerIndex,
        layerName: spec.layerName, layerId: spec.layerId, srcWidth: spec.width
      }).then(function (r) {
        if (!r.ok) { fail(job, "Import failed: " + r.error); return; }
        job.state = "done";
        job.file = finalPath;
        setStage(job, r.placed ? "Done \u00B7 placed above layer" : "Done \u00B7 imported", 100);
        J.toast(spec.name + " is back from Topaz" + (r.note ? " \u00B7 " + r.note : ""), "ok", 4000);
        if (J.emit) J.emit("action", { name: "topaz", ok: true, msg: spec.name + " \u00B7 " + meta.preset.name + (job.outSize ? " \u00B7 " + job.outSize : "") });
      });
      }
    });

    return p.then(function () { rmrf(tmp); }, function (e) { fail(job, e.message || String(e)); rmrf(tmp); });
  }

  function cancelJob(job) {
    if (job.state === "queued") { job.state = "cancelled"; job.stage = "Cancelled"; updateJobRow(job); return; }
    if (job.state === "running") {
      job.cancelled = true; setStage(job, "Cancelling\u2026");
      if (job.detached && job.ctx && job.ctx.pid) {
        if (pidIsOurs(job.ctx.pid)) { try { cp.spawn("taskkill", ["/pid", String(job.ctx.pid), "/T", "/F"], { windowsHide: true }); } catch (e) {} }
        else { job.ctx.pid = -1; }
      }
      else killTree(job.child);
    }
  }

  // ------------------------------------------------------------------
  // Jobs list UI
  // ------------------------------------------------------------------
  var list = $("#tzJobs");

  function renderJobs() {
    list.innerHTML = "";
    var jobsCard = $("#tzJobsCard");
    if (jobsCard) jobsCard.style.display = jobs.length ? "" : "none";
    if (!jobs.length) { list.innerHTML = '<p class="muted small tz-empty">No jobs yet.</p>'; return; }
    jobs.slice().reverse().forEach(function (job) {
      var row = document.createElement("div");
      row.className = "tz-job";
      row.innerHTML =
        '<div class="tz-top"><span class="tz-name"></span><span class="tz-pct"></span><button class="tz-x" title="Cancel or remove">\u2715</button></div>' +
        '<div class="tz-stage"></div><div class="progress"><div class="fill"></div></div>';
      row.querySelector(".tz-name").textContent = (job.spec.kind === "export" ? "Export \u00B7 " : "") + job.spec.name;
      row.addEventListener("dblclick", function () {
        if (!job.file) return;
        try { cp.spawn("explorer.exe", ["/select,", job.file], { windowsHide: false, detached: true }); } catch (e) {}
      });
      row.querySelector(".tz-x").addEventListener("click", function () {
        if (job.state === "running" || job.state === "queued") cancelJob(job);
        else { jobs.splice(jobs.indexOf(job), 1); saveHistory(); renderJobs(); }
      });
      job.row = row;
      list.appendChild(row);
      updateJobRow(job);
    });
  }

  // Finished jobs are remembered so the list survives a panel reload.
  var HIST_KEY = "jwpa.jobs.v1";
  function saveHistory() {
    var done = jobs.filter(function (j) { return j.state === "done" || j.state === "error" || j.state === "cancelled"; }).slice(-12);
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(done.map(function (j) {
        return { name: j.spec.name, kind: j.spec.kind, state: j.state, stage: j.stage, file: j.file || "", outSize: j.outSize || "" };
      })));
    } catch (e) {}
  }
  function restoreHistory() {
    var hist = [];
    try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]") || []; } catch (e) {}
    hist.forEach(function (h) {
      jobs.push({ id: nextId++, spec: { name: h.name, kind: h.kind }, meta: {}, state: h.state, stage: h.stage, file: h.file, outSize: h.outSize, pct: 100, restored: true });
    });
  }

  function updateJobRow(job) {
    if (job.state !== "running" && job.state !== "queued") saveHistory();
    var row = job.row;
    if (!row) return;
    row.className = "tz-job " + job.state;
    row.querySelector(".tz-stage").textContent = job.stage + (job.state === "done" && job.outSize ? " \u00B7 " + job.outSize : "");
    row.querySelector(".tz-pct").textContent = job.state === "running" ? Math.round(job.pct) + "%" : "";
    row.querySelector(".tz-stage").title = job.file || job.stage;
    var bar = row.querySelector(".progress");
    bar.classList.toggle("indeterminate", job.state === "running" && job.pct <= 0);
    bar.classList.toggle("done", job.state === "done");
    row.querySelector(".fill").style.width = (job.state === "done" ? 100 : job.pct) + "%";
  }

  // ------------------------------------------------------------------
  // Send
  // ------------------------------------------------------------------
  var sendBtn = $("#tzSend"), status = $("#tzStatus");

  sendBtn.addEventListener("click", function () {
    var preset = currentPreset();
    if (!preset) return J.toast("No Topaz preset found in " + PRESETS, "bad", 5000);
    if (!fs.existsSync(FFMPEG)) return J.toast("Topaz Video AI not found at " + TOPAZ_APP, "bad", 6000);

    sendBtn.classList.add("busy");
    J.host("topazPrep").then(function (r) {
      sendBtn.classList.remove("busy");
      if (!r.ok) { status.textContent = r.error; status.className = "run-status bad"; return J.toast(r.error, "bad", 4000); }
      (r.skipped || []).forEach(function (s) { J.toast("Skipped " + s, "warn", 6000); });
      if (!r.jobs.length) { status.textContent = "Nothing to send"; return; }

      var needsRender = r.jobs.some(function (j) { return j.kind === "comp"; });
      if (needsRender && !r.project) return J.toast("Save the project first \u00B7 precomps are rendered from the saved file", "bad", 5000);
      if (needsRender && !fs.existsSync(r.aerender)) return J.toast("aerender not found at " + r.aerender, "bad", 6000);
      if (needsRender) J.toast("Project saved \u00B7 rendering in the background", "", 2200);

      var dir = outDir;
      if (!dir) {
        var anchor = r.projectFolder || (r.jobs[0].file ? path.dirname(r.jobs[0].file) : path.join(os.homedir(), "Documents"));
        dir = path.join(anchor, "Topaz Renders");
      }
      var meta = {
        preset: preset, outDir: dir, project: r.project, aerender: r.aerender,
        place: $("#tzPlace").checked, hideOriginal: $("#tzHideOrig").checked, keep: $("#tzKeep").checked,
        turbo: $("#tzTurbo").checked, lowPri: $("#tzLowPri").checked && !$("#tzTurbo").checked, check: $("#qxCheck").checked
      };
      if (needsRender) warnCpuOnly();
      r.jobs.forEach(function (spec) { addJob(spec, meta); });
      status.textContent = r.jobs.length + " job" + (r.jobs.length === 1 ? "" : "s") + " queued";
      status.className = "run-status ok";
      J.toast("Sent " + r.jobs.length + " layer" + (r.jobs.length === 1 ? "" : "s") + " to Topaz \u00B7 keep editing", "ok", 3000);
    });
  });

  // ------------------------------------------------------------------
  // Recipes: saved Topaz setups (preset + options + folder)
  // ------------------------------------------------------------------
  var recipeSel = $("#tzRecipe");
  var recipes = J.store.get("tz.recipes", {}) || {};

  function renderRecipes(selectName) {
    recipeSel.innerHTML = "";
    var c = document.createElement("option");
    c.value = "";
    c.textContent = "Custom (current settings)";
    recipeSel.appendChild(c);
    Object.keys(recipes).sort().forEach(function (n) {
      var o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      recipeSel.appendChild(o);
    });
    recipeSel.value = selectName && recipes[selectName] ? selectName : "";
    $("#tzRecipeDel").style.display = recipeSel.value ? "" : "none";
  }

  function currentRecipe() {
    var p = currentPreset();
    return {
      preset: p ? p.file : "", outDir: outDir,
      place: $("#tzPlace").checked, hideOrig: $("#tzHideOrig").checked, lowPri: $("#tzLowPri").checked, keep: $("#tzKeep").checked
    };
  }

  function applyRecipe(r) {
    for (var i = 0; i < presets.length; i++) if (presets[i].file === r.preset) { sel.selectedIndex = i; J.store.set("tz.preset", r.preset); }
    showPresetInfo();
    outDir = r.outDir || ""; J.store.set("tz.outDir", outDir); showOutDir();
    [["#tzPlace", "place", "tz.place"], ["#tzHideOrig", "hideOrig", "tz.hideOrig"], ["#tzLowPri", "lowPri", "tz.lowPri"], ["#tzKeep", "keep", "tz.keep"]].forEach(function (d) {
      $(d[0]).checked = !!r[d[1]];
      J.store.set(d[2], !!r[d[1]]);
    });
  }

  recipeSel.addEventListener("change", function () {
    var r = recipes[recipeSel.value];
    if (r) { applyRecipe(r); J.toast("Recipe: " + recipeSel.value, "", 1500); }
    $("#tzRecipeDel").style.display = recipeSel.value ? "" : "none";
  });

  // Saving swaps the dropdown for a name box (Enter saves, Esc cancels).
  $("#tzRecipeSave").addEventListener("click", function () {
    var wrap = recipeSel.parentNode;
    if (wrap.querySelector("input")) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "recipe-name";
    var p = currentPreset();
    input.value = recipeSel.value || ((p ? p.name : "Topaz") + ($("#tzHideOrig").checked ? " + hide original" : ""));
    wrap.appendChild(input);
    wrap.classList.add("naming");
    input.focus(); input.select();
    var finished = false;
    function done(save) {
      if (finished) return; finished = true;
      var name = input.value.trim().slice(0, 40);
      wrap.classList.remove("naming");
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!save || !name) return;
      recipes[name] = currentRecipe();
      J.store.set("tz.recipes", recipes);
      renderRecipes(name);
      J.toast("Saved recipe \u201C" + name + "\u201D", "ok", 1800);
    }
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    });
    input.addEventListener("blur", function () { done(true); });
  });

  $("#tzRecipeDel").addEventListener("click", function () {
    var n = recipeSel.value;
    if (!n) return;
    delete recipes[n];
    J.store.set("tz.recipes", recipes);
    renderRecipes("");
    J.toast("Deleted recipe \u201C" + n + "\u201D", "", 1600);
  });

  // ------------------------------------------------------------------
  // Quick Export
  // ------------------------------------------------------------------
  var qxSel = $("#qxTemplate"), qxOut = J.store.get("qx.outDir", "");

  // Output module templates are listed in AE's output prefs file.
  function loadTemplates() {
    var names = [];
    try {
      var root = path.join(process.env.APPDATA || "", "Adobe", "After Effects");
      var vers = fs.readdirSync(root).filter(function (d) { return /^\d+(\.\d+)?$/.test(d); })
        .sort(function (a, b) { return parseFloat(b) - parseFloat(a); });
      for (var v = 0; v < vers.length && !names.length; v++) {
        var dir = path.join(root, vers[v]);
        var file = fs.readdirSync(dir).filter(function (f) { return /Prefs-indep-output\.txt$/i.test(f); })[0];
        if (!file) continue;
        var txt = fs.readFileSync(path.join(dir, file), "utf8");
        var re = /"Output Module Spec Strings Name \d+"\s*=\s*"([^"]+)"/g, m;
        while ((m = re.exec(txt))) if (!/^_HIDDEN/.test(m[1])) names.push(m[1]);
      }
    } catch (e) {}
    if (!names.length) names = ["H.264 - Match Render Settings - 15 Mbps", "High Quality", "High Quality with Alpha", "Lossless"];
    return names;
  }

  function renderTemplates() {
    var names = loadTemplates(), want = J.store.get("qx.template", "");
    qxSel.innerHTML = "";
    names.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      qxSel.appendChild(o);
    });
    var pick = names.indexOf(want) >= 0 ? want : (names.filter(function (n) { return /H\.264.*15/i.test(n); })[0] || names[0]);
    qxSel.value = pick;
  }
  qxSel.addEventListener("change", function () { J.store.set("qx.template", qxSel.value); });

  // Default export folder comes from config.js (empty = an "Exports" folder next to the project).
  // Change it with the Change button; double-click the path to go back to the default.
  var QX_DEFAULT = CONFIG.exportFolder && CONFIG.exportFolder.length ? path.join.apply(path, [os.homedir()].concat(CONFIG.exportFolder)) : "";
  if (!qxOut) qxOut = QX_DEFAULT;

  function showQxOut() {
    $("#qxOut").textContent = qxOut || "Next to the project, in \u201CExports\u201D";
    $("#qxOut").title = qxOut ? qxOut + "  (double-click to reset)" : "";
    $("#qxOut").classList.toggle("path", !!qxOut);
  }
  $("#qxOutBtn").addEventListener("click", function () {
    J.host("pickFolder").then(function (r) {
      if (r.ok && r.path) { qxOut = r.path; J.store.set("qx.outDir", qxOut); showQxOut(); }
    });
  });
  $("#qxOut").addEventListener("dblclick", function () { qxOut = QX_DEFAULT; J.store.set("qx.outDir", ""); showQxOut(); });

  [["#qxRange", "qx.range", true], ["#qxWhole", "qx.whole", false], ["#qxImport", "qx.import", true], ["#qxDetach", "qx.detach", true], ["#qxCheck", "qx.check", true]].forEach(function (d) {
    var el = $(d[0]);
    el.checked = !!J.store.get(d[1], d[2]);
    el.addEventListener("change", function () { J.store.set(d[1], el.checked); });
  });

  // Renders run on the project's renderer setting; CPU-only is often several times slower.
  function warnCpuOnly() {
    J.host("renderInfo").then(function (r) {
      if (r.ok && r.cpuOnly) J.toast("This project renders on the CPU only · File > Project Settings > Video Rendering: pick Mercury GPU Acceleration (CUDA) for much faster renders", "warn", 9000);
    });
  }

  // ------------------------------------------------------------------
  // Instant preview: pre-render selected precomps in the background and use them as proxies
  // ------------------------------------------------------------------
  var PRE_DIR = path.join(process.env.APPDATA || os.homedir(), "JWPA", "prerender");
  var pvBtn = $("#pvSend");
  if (pvBtn) pvBtn.addEventListener("click", function () {
    pvBtn.classList.add("busy");
    J.host("proxyPrep").then(function (r) {
      pvBtn.classList.remove("busy");
      if (!r.ok) return J.toast(r.error, "bad", 4500);
      (r.skipped || []).forEach(function (s) { J.toast("Skipped " + s, "warn", 6000); });
      if (!r.jobs.length) return;
      if (!fs.existsSync(r.aerender)) return J.toast("aerender not found at " + r.aerender, "bad", 6000);
      var meta = {
        template: "High Quality with Alpha", outDir: path.join(PRE_DIR, safeFile(r.projectName)),
        project: r.project, aerender: r.aerender, turbo: $("#tzTurbo").checked, lowPri: $("#tzLowPri").checked && !$("#tzTurbo").checked,
        importWhenDone: false, detach: $("#qxDetach").checked, check: false
      };
      r.jobs.forEach(function (spec) { spec.kind = "export"; addJob(spec, meta); });
      J.toast("Pre-rendering " + r.jobs.length + " precomp" + (r.jobs.length === 1 ? "" : "s") + " in the background \u00B7 keep editing", "ok", 3200);
    });
  });
  var pvClear = $("#pvClear");
  if (pvClear) pvClear.addEventListener("click", function () {
    J.host("clearProxies", { dir: PRE_DIR }).then(function (r) {
      if (!r.ok) return J.toast(r.error, "bad", 4000);
      // delete our own pre-render files (never anything outside the pre-render folder)
      (r.files || []).forEach(function (f) { if (path.resolve(f).toLowerCase().indexOf(path.resolve(PRE_DIR).toLowerCase()) === 0) rmrf(f); });
      J.toast(r.cleared ? "Back to live precomps (" + r.cleared + ")" : "No pre-renders to clear", r.cleared ? "ok" : "", 2400);
    });
  });

  var qxBtn = $("#qxSend");
  qxBtn.addEventListener("click", function () {
    qxBtn.classList.add("busy");
    J.host("exportPrep", { layerRange: $("#qxRange").checked, wholeComp: $("#qxWhole").checked }).then(function (r) {
      qxBtn.classList.remove("busy");
      if (!r.ok) return J.toast(r.error, "bad", 4000);
      (r.skipped || []).forEach(function (s) { J.toast("Skipped " + s, "warn", 6000); });
      if (!r.jobs.length) return J.toast("Nothing to export", "warn", 2500);
      if (!r.project) return J.toast("Save the project first \u00B7 exports render the saved file", "bad", 5000);
      if (!fs.existsSync(r.aerender)) return J.toast("aerender not found at " + r.aerender, "bad", 6000);
      if (r.saved) J.toast("Project saved \u00B7 exporting in the background", "", 2200);
      var meta = {
        template: qxSel.value, outDir: qxOut || path.join(r.projectFolder, "Exports"),
        project: r.project, aerender: r.aerender, turbo: $("#tzTurbo").checked, lowPri: $("#tzLowPri").checked && !$("#tzTurbo").checked, importWhenDone: $("#qxImport").checked, detach: $("#qxDetach").checked, check: $("#qxCheck").checked
      };
      r.jobs.forEach(function (spec) { spec.kind = "export"; addJob(spec, meta); });
      warnCpuOnly();
      J.toast("Exporting " + r.jobs.length + " item" + (r.jobs.length === 1 ? "" : "s") + " in the background", "ok", 2800);
    });
  });

  // Don't leave background processes running if the panel closes.
  window.addEventListener("beforeunload", function () { jobs.forEach(function (j) { if (j.child) killTree(j.child); }); });

  restoreHistory();
  resumeBackground();
  renderJobs();
  renderPresets();
  showOutDir();
  renderRecipes("");
  renderTemplates();
  showQxOut();
})();
