/* JW Preset Applicator Pro - first-run welcome screen
 * Shows once (or from Settings > Show welcome again): what the panel does, a quick theme pick,
 * and a check for the optional helpers (ffmpeg for scene detect/previews, Topaz Video AI).
 */
(function () {
  "use strict";
  var J = window.JWPA;
  if (!J) return;
  var KEY = "jwpa.welcomed.v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var STEPS = [
    {
      title: "Welcome to JW Preset Applicator",
      body: '<p class="wl-lead">Apply presets that actually fit your clips, cut scenes frame-perfect, and send shots to Topaz, all without leaving After Effects.</p>' +
        '<div class="wl-hero"><svg viewBox="0 0 32 32"><defs><linearGradient id="wlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></defs>' +
        '<path d="M16 2 L30 16 L16 30 L2 16 Z" fill="url(#wlg)"/><path d="M16 10 L22 16 L16 22 L10 16 Z" fill="var(--bg)" opacity=".55"/></svg></div>'
    },
    {
      title: "What it does",
      body: '<div class="wl-tiles">' +
        tile("Presets that fit", "Keyframes stretch to each clip, easing stays exactly as made, and an intensity slider scales the whole preset.") +
        tile("Smart Scene Detect", "Splits a video into shots on the exact frame, and ignores flashes, fades and fast camera moves.") +
        tile("Topaz + Export", "Send layers to Topaz Video AI or export them in the background, then they come back in by themselves.") +
        tile("Editing tools", "Copy effects, sequence clips, cut flashes, split at markers, smart precomp names and more.") +
        "</div>"
    },
    {
      title: "Make it yours",
      body: '<p class="wl-sub">Pick a look. You can change it any time in Settings.</p><div class="swatches wl-swatches" id="wlSwatches"></div>' +
        '<p class="wl-sub" style="margin-top:14px">Optional helpers</p><div class="wl-checks" id="wlChecks"><div class="wl-check">Checking\u2026</div></div>'
    },
    {
      title: "You're all set",
      body: '<ul class="wl-tips">' +
        "<li><b>Drop an .ffx</b> on the preset box, or press <kbd>B</kbd> to browse.</li>" +
        "<li><b>Select layers</b>, then press <kbd>Enter</kbd> to run the tab you're on.</li>" +
        "<li><kbd>[</kbd> <kbd>]</kbd> flip through favorites, <kbd>P</kbd> previews a preset.</li>" +
        "<li>Everything you run is one <kbd>Ctrl</kbd>+<kbd>Z</kbd> away.</li></ul>"
    }
  ];

  function tile(t, d) { return '<div class="wl-tile"><b>' + t + "</b><span>" + d + "</span></div>"; }

  var overlay, step = 0;

  function build() {
    overlay = document.createElement("div");
    overlay.className = "welcome";
    overlay.innerHTML =
      '<div class="wl-card">' +
      '<button class="wl-skip" type="button">Skip</button>' +
      '<div class="wl-stage"></div>' +
      '<div class="wl-foot"><div class="wl-dots"></div>' +
      '<div class="wl-btns"><button class="btn ghost wl-back" type="button">Back</button>' +
      '<button class="btn primary wl-next" type="button"><span class="label">Next</span></button></div></div></div>';
    document.body.appendChild(overlay);
    var dots = $(".wl-dots", overlay);
    STEPS.forEach(function (_, i) { var d = document.createElement("i"); d.addEventListener("click", function () { go(i); }); dots.appendChild(d); });
    $(".wl-skip", overlay).addEventListener("click", close);
    $(".wl-back", overlay).addEventListener("click", function () { go(step - 1); });
    $(".wl-next", overlay).addEventListener("click", function () { if (step === STEPS.length - 1) close(); else go(step + 1); });
    overlay.addEventListener("keydown", function (e) { e.stopPropagation(); });
  }

  function go(i) {
    var back = i < step;
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    var s = STEPS[step], stage = $(".wl-stage", overlay);
    stage.innerHTML = '<div class="wl-page ' + (back ? "from-left" : "from-right") + '"><h2>' + s.title + "</h2>" + s.body + "</div>";
    Array.prototype.forEach.call(overlay.querySelectorAll(".wl-dots i"), function (d, k) { d.classList.toggle("on", k === step); });
    $(".wl-back", overlay).style.visibility = step === 0 ? "hidden" : "visible";
    $(".wl-next .label", overlay).textContent = step === 0 ? "Get started" : step === STEPS.length - 1 ? "Start editing" : "Next";
    if (step === 2) fillSetup();
  }

  function fillSetup() {
    var box = $("#wlSwatches");
    if (box && J.themes) {
      Object.keys(J.themes).forEach(function (name) {
        var t = J.themes[name], b = document.createElement("button");
        b.className = "swatch";
        b.dataset.name = name;
        b.title = name;
        b.style.background = "linear-gradient(135deg, " + J.css(t.a1) + ", " + J.css(t.a2) + ")";
        b.style.setProperty("--sw", J.css(t.a1));
        b.addEventListener("click", function () {
          J.applyTheme(name, true);
          Array.prototype.forEach.call(box.children, function (c) { c.classList.toggle("on", c === b); });
        });
        if (name === J.themeName()) b.classList.add("on");
        box.appendChild(b);
      });
    }
    var checks = $("#wlChecks");
    if (!checks) return;
    var rows = [];
    if (typeof require === "function") {
      var fs = require("fs"), path = require("path");
      var ff = window.JWPA_SceneCut ? window.JWPA_SceneCut.findFfmpeg() : "";
      rows.push(check(!!ff, "ffmpeg", ff ? "Found \u00B7 scene detect and previews are ready" : "Not found \u00B7 needed for scene detect and previews",
        ff ? "" : "https://www.gyan.dev/ffmpeg/builds/"));
      var pf = process.env.ProgramFiles || "C:\\Program Files";
      var topaz = fs.existsSync(path.join(pf, "Topaz Labs LLC", "Topaz Video AI", "ffmpeg.exe"));
      rows.push(check(topaz, "Topaz Video AI", topaz ? "Found \u00B7 Send to Topaz is ready" : "Not installed \u00B7 only needed for Topaz jobs", ""));
    } else {
      rows.push(check(false, "Helpers", "Open this inside After Effects to check", ""));
    }
    checks.innerHTML = rows.join("");
    Array.prototype.forEach.call(checks.querySelectorAll("a[data-url]"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        try { window.cep.util.openURLInDefaultBrowser(a.dataset.url); } catch (err) { window.open(a.dataset.url); }
      });
    });
  }

  function check(ok, name, text, url) {
    return '<div class="wl-check ' + (ok ? "ok" : "no") + '"><i></i><div><b>' + name + "</b><span>" + text +
      (url ? ' \u00B7 <a href="#" data-url="' + url + '">get it</a>' : "") + "</span></div></div>";
  }

  function open() {
    if (!overlay) build();
    overlay.classList.remove("out");
    overlay.style.display = "";
    step = 0;
    go(0);
  }

  function close() {
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
    overlay.classList.add("out");
    setTimeout(function () { overlay.style.display = "none"; }, 320);
  }

  J.showWelcome = open;
  var again = $("#welcomeAgain");
  if (again) again.addEventListener("click", open);

  var seen = false;
  try { seen = localStorage.getItem(KEY) === "1"; } catch (e) {}
  if (!seen) setTimeout(open, 450);
})();
