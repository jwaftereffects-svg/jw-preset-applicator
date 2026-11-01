/* JW Preset Applicator Pro - Quick Search connector (lives in the main panel).
 *
 * Starts the tiny helper (helper/JWQuick.exe) that catches Ctrl+Space while After Effects
 * is the active window and shows the "JW Quick Search" popup at the mouse. The popup only
 * draws; everything it asks for is done here, with the panel's own functions and options.
 */
(function () {
  "use strict";
  var J = window.JWPA, cep = window.__adobe_cep__;
  if (!J || !cep || typeof require !== "function") return;
  var cp = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");
  var $ = function (s) { return document.querySelector(s); };

  var EXT_ID = "", appId = "AEFT";
  try { EXT_ID = cep.getExtensionId().replace(/\.panel$/, ".quick"); } catch (e) {}
  try { appId = JSON.parse(cep.getHostEnvironment()).appName || appId; } catch (e) {}
  var HELPER = path.join(J.extPath(), "helper", "JWQuick.exe");
  var FLAG = path.join(os.tmpdir(), "jwpa-quick-open.flag");
  var helper = null, effects = null;
  // the effect list is slow to ask After Effects for, so it is kept on disk and refreshed quietly
  var FX_CACHE = path.join(process.env.APPDATA || os.homedir(), "JWPA", "quick-effects.json");
  try { effects = JSON.parse(fs.readFileSync(FX_CACHE, "utf8")); if (!Array.isArray(effects) || !effects.length) effects = null; } catch (e) { effects = null; }
  var fxFresh = false;

  // file messages with the popup (see quick.js): data.json + show.stamp out, cmd*.json in
  var IPC = path.join(process.env.APPDATA || os.homedir(), "JWPA", "quick"), CMD = path.join(IPC, "cmd");
  try { fs.mkdirSync(CMD, { recursive: true }); } catch (e) {}
  function writeAtomic(file, text) {
    var tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  function send(type, data) {
    try {
      if (type === "com.jwpa.quick.data") writeAtomic(path.join(IPC, "data.json"), JSON.stringify(data || {}));
      else if (type === "com.jwpa.quick.show") writeAtomic(path.join(IPC, "show.stamp"), String(Date.now()));
    } catch (e) {}
  }

  // ---------------------------------------------------------------- what the popup lists
  function loadEffects(force) {
    if (effects && !force) return Promise.resolve(effects);
    return J.host("listEffects").then(function (r) {
      if (r.ok && r.effects && r.effects.length) {
        fxFresh = true;
        var changed = !effects || JSON.stringify(effects) !== JSON.stringify(r.effects);
        effects = r.effects;
        if (changed) { try { fs.mkdirSync(path.dirname(FX_CACHE), { recursive: true }); fs.writeFileSync(FX_CACHE, JSON.stringify(effects)); } catch (e) {} }
      }
      return effects || [];
    });
  }

  function folderOf(p) {
    var sets = J.sets ? J.sets() : {}, names = Object.keys(sets);
    for (var i = 0; i < names.length; i++) if ((sets[names[i]] || []).indexOf(p) >= 0) return names[i];
    return path.basename(path.dirname(p));
  }

  var THEME_VARS = ["--bg", "--panel", "--panel2", "--border", "--text", "--muted", "--sub", "--a1", "--a2", "--ok", "--bad", "--warn", "--ink", "--a1-rgb", "--a2-rgb", "--text-rgb"];
  function theme() {
    var cs = getComputedStyle(document.documentElement), t = {};
    THEME_VARS.forEach(function (v) { var x = cs.getPropertyValue(v).trim(); if (x) t[v] = x; });
    return t;
  }

  // every .ffx in After Effects' User Presets folder(s), scanned in the background
  var userPresets = [], userScanned = 0;
  function presetRoots() {
    var base = path.join(os.homedir(), "Documents", "Adobe"), out = [];
    try {
      fs.readdirSync(base).forEach(function (n) {
        if (!/^After Effects/i.test(n)) return;
        var p = path.join(base, n, "User Presets");
        try { if (fs.statSync(p).isDirectory()) out.push(p); } catch (e) {}
      });
    } catch (e) {}
    return out;
  }
  function scanUserPresets() {
    if (Date.now() - userScanned < 60000) return;
    userScanned = Date.now();
    var found = [], seen = {};
    presetRoots().forEach(function (root) {
      (function walk(dir, depth) {
        if (depth > 6 || found.length > 20000) return;
        var ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        ents.forEach(function (e) {
          var p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, depth + 1);
          else if (/\.ffx$/i.test(e.name) && !seen[p.toLowerCase()]) {
            seen[p.toLowerCase()] = 1;
            var rel = path.relative(root, dir).split(path.sep).join(" / ");
            found.push({ p: p, n: e.name.replace(/\.ffx$/i, ""), s: rel || "User Presets" });
          }
        });
      })(root, 0);
    });
    userPresets = found;
  }

  function buildItems(fx) {
    var items = [];
    (fx || []).forEach(function (e) { items.push({ k: "fx:" + e.m, t: "fx", n: e.n, s: e.c, m: e.m }); });
    var have = {};
    (J.favorites() || []).forEach(function (p) {
      have[p.toLowerCase()] = 1;
      items.push({ k: "ffx:" + p.toLowerCase(), t: "ffx", n: J.baseName(p).replace(/\.ffx$/i, ""), s: folderOf(p), p: p });
    });
    scanUserPresets();
    userPresets.forEach(function (u) {
      if (have[u.p.toLowerCase()]) return;
      items.push({ k: "ffx:" + u.p.toLowerCase(), t: "ffx", n: u.n, s: u.s, p: u.p });
    });
    if (J.layerLib) J.layerLib.list().forEach(function (L) {
      var kinds = Object.keys(L.kinds || {}).join(", ");
      items.push({ k: "ly:" + L.rel, t: "ly", n: L.name, s: (L.folder ? L.folder + " · " : "") + kinds, f: L.file });
    });
    if (J.easeLib) J.easeLib.curves().forEach(function (c) {
      items.push({ k: "ez:" + c.group + "/" + c.name, t: "ez", n: c.name, s: c.group, c: c.c });
    });
    return items;
  }

  function sendData() {
    var quick = function (fx) {
      send("com.jwpa.quick.data", { items: buildItems(fx), favs: J.store.get("quick.favs", []), recent: J.store.get("quick.recent", []), theme: theme() });
    };
    // send what we have right away; effects follow once After Effects has listed them
    quick(effects);
    if (!effects) loadEffects().then(quick);
  }

  // ---------------------------------------------------------------- doing things
  function remember(key) {
    J.store.set("quick.recent", [key].concat(J.store.get("quick.recent", []).filter(function (k) { return k !== key; })).slice(0, 30));
  }

  // a line in %TEMP%\jwquick.log for every popup request, so a hiccup can be traced
  function log(t) {
    try { fs.appendFileSync(path.join(os.tmpdir(), "jwquick.log"), new Date().toTimeString().slice(0, 8) + "  panel: " + t + String.fromCharCode(10)); } catch (e) {}
  }

  // After Effects can be busy for a moment (RAM preview, typing in a text layer, saving):
  // those "EvalScript error" hiccups are retried a few times over ~2.5 s before giving up
  var HICCUP = /EvalScript error|No response from After Effects|host not loaded/i;
  function hostRetry(fn, arg, label) {
    var waits = [0, 300, 700, 1500];
    function go(n) {
      return new Promise(function (res) { setTimeout(res, waits[n]); }).then(function () {
        // After Effects sometimes never answers (busy with a render or a dialog): give up after 10 s
        return Promise.race([J.host(fn, arg), new Promise(function (res) { setTimeout(function () { res({ ok: false, error: "After Effects didn't respond (busy?) · try again" }); }, 10000); })]);
      }).then(function (r) {
        if (!r.ok && HICCUP.test(String(r.error || "")) && n < waits.length - 1) { log(label + ": AE busy, retry " + (n + 1)); return go(n + 1); }
        return r;
      });
    }
    return go(0);
  }
  function report(label, r, msg) {
    if (!r.ok) { log(label + ": FAILED " + r.error); J.toast(label + ": " + r.error, "bad", 4000); return; }
    log(label + ": ok");
    J.toast(msg, "ok", 1800);
    J.emit("action", { name: "quick", ok: true, msg: msg });
  }

  function run(it) {
    remember(it.k);
    log("run " + it.t + " \"" + it.n + "\"");
    if (it.t === "fx") {
      hostRetry("addEffect", { matchName: it.m, name: it.n }, it.n).then(function (r) {
        report(it.n, r, r.ok ? "Added " + it.n + " to " + r.count + " layer" + (r.count === 1 ? "" : "s") : "");
      });
    } else if (it.t === "ffx") {
      // straight to After Effects: the panel's current preset and favorites stay as they are.
      // 1 layer: keyframes start at the playhead; more: stretched to each layer
      var opts = { preset: it.p, quick: true, preserve: true, onlyNew: true, keepSel: true, noFavorite: true };
      hostRetry("applyEffect", opts, it.n).then(function (r) {
        report(it.n, r, r.ok ? "Applied " + it.n + " to " + r.count + " layer" + (r.count === 1 ? "" : "s") : "");
      });
    } else if (it.t === "ly" && J.layerLib) {
      Promise.resolve(J.layerLib.insert(it.f)).then(function (r) { log(it.n + ": " + (r && r.ok ? "ok" : "FAILED " + (r && r.error))); });
    } else if (it.t === "ez" && J.easeLib) {
      Promise.resolve(J.easeLib.apply(it.c)).then(function (r) { log(it.n + ": " + (r && r.ok ? "ok" : "FAILED " + (r && r.error))); });
    }
  }

  function handle(d) {
    d = d || {};
    if (d.cmd === "data") sendData();
    else if (d.cmd === "hide") tell("hide");
    else if (d.cmd === "size" && d.h > 0) tell("size " + Math.round(d.h));
    else if (d.cmd === "fav") {
      var favs = J.store.get("quick.favs", []).filter(function (k) { return k !== d.key; });
      if (d.on) favs.unshift(d.key);
      J.store.set("quick.favs", favs);
    } else if (d.cmd === "run" && d.item) {
      if (d.keep) run(d.item);
      else { tell("hide"); setTimeout(function () { run(d.item); }, 150); } // focus goes back to AE first
    }
  }

  // requests from the popup arrive as files; old leftovers are dropped
  var seenCmd = {}, seenList = [];
  function drainCommands() {
    var names = [];
    try { names = fs.readdirSync(CMD).filter(function (n) { return /\.json$/.test(n); }).sort(); } catch (e) { return; }
    names.forEach(function (n) {
      if (seenCmd[n]) { try { fs.unlinkSync(path.join(CMD, n)); } catch (e) {} return; }
      seenCmd[n] = 1; seenList.push(n);
      if (seenList.length > 300) delete seenCmd[seenList.shift()];
      var f = path.join(CMD, n), d = null;
      for (var tries = 0; tries < 3 && !d; tries++) { try { d = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {} }
      try { fs.unlinkSync(f); } catch (e) {}
      var age = Date.now() - (parseInt(n, 10) || 0);
      if (!d) { log("unreadable request " + n); return; }
      if (age > 15000) { log("dropped old request " + n); return; }
      if (d.cmd === "run") log("request: run (keep=" + !!d.keep + ")");
      handle(d);
    });
  }
  try { fs.readdirSync(CMD).forEach(function (n) { try { fs.unlinkSync(path.join(CMD, n)); } catch (e) {} }); } catch (e) {}
  try { fs.watch(CMD, function () { drainCommands(); }); } catch (e) {}
  setInterval(function () { if (helper) drainCommands(); }, 400); // in case a change notification is missed (only while Quick Search is on)

  // ---------------------------------------------------------------- the helper
  function tell(cmd) { try { if (helper) helper.stdin.write(cmd + "\n"); } catch (e) {} }

  function openPopup() {
    try { fs.writeFileSync(FLAG, String(Date.now())); } catch (e) {}
    try { cep.requestOpenExtension(EXT_ID, ""); } catch (e) {}
  }

  // After Effects only learns about the popup window when it starts. Until then (e.g. you
  // reloaded the panel after an update) leave Ctrl+Space alone, so FX Console keeps working.
  function popupRegistered() {
    try { return (JSON.parse(cep.getExtensions(JSON.stringify([EXT_ID])) || "[]") || []).length > 0; } catch (e) { return false; }
  }

  function start() {
    if (helper || !EXT_ID) return;
    // an update built while the old helper was running waits next to it: swap it in now
    var staged = HELPER.replace(/.exe$/, ".new.exe");
    if (fs.existsSync(staged)) { try { fs.renameSync(staged, HELPER); } catch (e) {} }
    if (!fs.existsSync(HELPER)) return;
    if (!popupRegistered()) {
      var info = $("#quickInfo");
      if (info) info.textContent = "Restart After Effects once to turn on Ctrl+Space.";
      return;
    }
    try { helper = cp.spawn(HELPER, ["0"], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] }); } catch (e) { helper = null; return; }
    var buf = "";
    helper.stdout.on("data", function (b) {
      buf += b.toString();
      var lines = buf.split(/\r?\n/); buf = lines.pop();
      lines.forEach(function (l) {
        l = l.trim();
        if (l === "ready") { log("helper started"); openPopup(); tell("prepare"); tell("hide"); sendData(); }      // load the popup now, hidden, so Ctrl+Space is instant
        else if (l === "prepared") sendData();
        else if (l === "open") openPopup();
        else if (l === "shown") {
          // let After Effects activate its own window: then it keeps the keyboard there
          openPopup();
          send("com.jwpa.quick.show", {});
          sendData();
        }
        else if (l === "error hook") J.toast("Ctrl+Space quick search couldn't start on this PC", "warn", 5000);
      });
    });
    helper.on("exit", function () { helper = null; });
    helper.on("error", function () { helper = null; });
    // refresh the effect list once per session (new plugins), a little after start-up
    setTimeout(function () { if (!fxFresh) loadEffects(true).then(function () { sendData(); }); }, 20000);
  }

  function stop() {
    if (!helper) return;
    tell("quit");
    try { helper.kill(); } catch (e) {}
    helper = null;
  }

  var toggle = $("#quickToggle");
  if (toggle) {
    toggle.checked = J.store.get("quick.enabled", false) === true;
    toggle.addEventListener("change", function () {
      J.store.set("quick.enabled", toggle.checked);
      if (toggle.checked) { start(); J.toast("Ctrl+Space quick search is on · press it over the timeline", "ok", 3000); }
      else stop();
    });
  }
  if (J.store.get("quick.enabled", false) === true) start();
  window.addEventListener("beforeunload", stop);
})();
