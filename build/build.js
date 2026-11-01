// Builds JW Preset Applicator Pro from extension-staging.
//
//   node build.js personal   -> updates your installed copy, with your own defaults from build/personal.json
//   node build.js release    -> clean copy for the installer: generic ID, no personal defaults,
//                               then zips it to dist\payload.zip
//
// Local-only files (not in the repo, see .gitignore):
//   build/personal.json        { "bundle": "...", "config": { ... } } for the "personal" target
//   build/leak-patterns.txt    one word per line that must never appear in a release (names, emails, ...)
//
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");

const VERSION = "1.4.0";
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "extension-staging");
function readLocal(name, fallback) {
  try { return fs.readFileSync(path.join(__dirname, name), "utf8"); } catch (e) { return fallback; }
}
const PERSONAL = JSON.parse(readLocal("personal.json", "{}"));
const PERSONAL_BUNDLE = PERSONAL.bundle || "com.jwpresetapplicator.dev";
const TARGETS = {
  personal: {
    bundle: PERSONAL_BUNDLE,
    out: path.join(os.homedir(), "AppData", "Roaming", "Adobe", "CEP", "extensions", PERSONAL_BUNDLE),
    config: PERSONAL.config || {}
  },
  release: {
    bundle: "com.jwpresetapplicator.pro",
    out: path.join(ROOT, "dist", "com.jwpresetapplicator.pro"),
    config: {}
  }
};

const which = process.argv[2];
const T = TARGETS[which];
if (!T) { console.error("usage: node build.js personal|release"); process.exit(1); }

// files that make up the extension (anything else in staging is ignored)
const FILES = ["compat.js", "index.html", "style.css", "skin3.css", "panel.js", "topaz.js", "extras.js", "welcome.js", "layers.js", "ease.js", "renderfix.js", "skin.js", "home.js", "scenecut.js", "scenedetect.js", "scroll.html", "quick.html", "quick.css", "quick.js", "quickhost.js", "vocals.js", "engine/vocals.py", "audiotools.js", "craft.js", "jsx/host.jsx", "jsx/library.jsx", "jsx/craft.jsx",
  // Auto Captions (formerly the separate Sentence Studio panel)
  "captions.js", "captions.css", "planner.js", "audio-cache.js", "jsx/captions.jsx",
  "engine/worker.py", "engine/pin_overlay.py", "engine/timeline_hover.py"];

// ExtendScript can't be trusted with raw non-ASCII, so escape it in scripts
function escapeNonAscii(s) { return s.replace(/[^\x00-\x7F]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")); }

// ---- older After Effects (CC 2018-2021) run Chromium 57-74, which lacks some newer CSS.
// The source CSS stays modern; this adds fallbacks to the shipped copy:
//   inset        -> top/right/bottom/left            (Chromium 87)
//   place-items  -> align-items + justify-items      (Chromium 59)
//   grid gap     -> grid-gap                         (Chromium 66)
//   flex gap     -> child margins under html.jw-nogap, which compat.js turns on (Chromium 84)
//   aspect-ratio -> listed for compat.js to size by hand (Chromium 88)
function splitTop(s, isSep) {
  const out = []; let depth = 0, quote = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { cur += c; if (c === quote && s[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === "(") depth++; else if (c === ")") depth--;
    if (depth === 0 && isSep(c)) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}
const words = v => splitTop(v.trim(), c => /\s/.test(c)).filter(Boolean);

function cssCompat(css, aspectRules) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const extra = {}; // media query -> fallback rules

  function leaf(sel, body, media) {
    const decls = splitTop(body, c => c === ";");
    const props = {};
    for (const d of decls) { const k = d.indexOf(":"); if (k > 0) props[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim(); }
    const display = (props.display || "").toLowerCase();
    const flow = (props["flex-direction"] || "") + " " + (props["flex-flow"] || "") + " " + (props["flex-wrap"] || "");
    const isFlex = /^(inline-)?flex\b/.test(display) || (!/grid/.test(display) && /\S/.test(flow));
    const selectors = splitTop(sel, c => c === ",").map(s => s.trim()).filter(s => s && s.indexOf("::") < 0);

    return decls.map(d => {
      const k = d.indexOf(":");
      if (k < 0) return d;
      const p = d.slice(0, k).trim().toLowerCase();
      let v = d.slice(k + 1).trim();
      const imp = /!important\s*$/i.test(v) ? " !important" : "";
      v = v.replace(/\s*!important\s*$/i, "");
      const lead = d.match(/^\s*/)[0], orig = d.trim();
      const w = words(v);

      if (p === "inset" && w.length) {
        const [t, r = t, b = t, l = r] = w;
        return lead + `top: ${t}${imp}; right: ${r}${imp}; bottom: ${b}${imp}; left: ${l}${imp}; ` + orig;
      }
      if (p === "place-items" && w.length) {
        return lead + `align-items: ${w[0]}${imp}; justify-items: ${w[1] || w[0]}${imp}; ` + orig;
      }
      if (p === "aspect-ratio") {
        const m = /^([\d.]+)\s*(?:\/\s*([\d.]+))?$/.exec(v);
        if (m) for (const s of selectors) if (!/:(hover|active|focus)/.test(s)) aspectRules.push([s, (+m[1]) / (+(m[2] || 1))]);
        return d;
      }
      if ((p === "gap" || p === "row-gap" || p === "column-gap") && w.length) {
        if (!isFlex) return lead + `grid-${p}: ${v}${imp}; ` + orig;
        if (p !== "gap") return d;
        const row = w[0], col = w[1] || w[0];
        const dir = (/column-reverse/.test(flow) && "column-reverse") || (/column/.test(flow) && "column") || (/row-reverse/.test(flow) && "row-reverse") || "row";
        const wraps = /(^|\s)wrap/.test(flow);
        const list = extra[media] || (extra[media] = []);
        for (const s of selectors) {
          if (wraps) list.push(`html.jw-nogap ${s} > * { margin-right: ${col}; margin-bottom: ${row}; }`);
          else if (dir === "column") list.push(`html.jw-nogap ${s} > *:not(:last-child) { margin-bottom: ${row}; }`);
          else if (dir === "column-reverse") list.push(`html.jw-nogap ${s} > *:not(:last-child) { margin-top: ${row}; }`);
          else if (dir === "row-reverse") list.push(`html.jw-nogap ${s} > *:not(:last-child) { margin-left: ${col}; }`);
          else list.push(`html.jw-nogap ${s} > *:not(:last-child) { margin-right: ${col}; }`);
        }
        return d;
      }
      return d;
    }).join(";");
  }

  function walk(s, media) {
    let out = "", start = 0, quote = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) { if (c === quote && s[i - 1] !== "\\") quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === ";") { out += s.slice(start, i + 1); start = i + 1; continue; }
      if (c !== "{") continue;
      let depth = 1, j = i + 1, q = null;
      for (; j < s.length && depth; j++) {
        const cj = s[j];
        if (q) { if (cj === q && s[j - 1] !== "\\") q = null; continue; }
        if (cj === '"' || cj === "'") q = cj;
        else if (cj === "{") depth++;
        else if (cj === "}") depth--;
      }
      const prelude = s.slice(start, i), sel = prelude.trim(), inner = s.slice(i + 1, j - 1);
      let body;
      if (/^@(media|supports)\b/i.test(sel)) body = walk(inner, /^@media/i.test(sel) ? sel : media);
      else if (sel.charAt(0) === "@") body = inner; // keyframes, font-face: leave alone
      else body = leaf(sel, inner, media);
      out += prelude + "{" + body + "}";
      start = i = j;
      i--;
    }
    return out + s.slice(start);
  }

  let result = walk(css, "");
  const blocks = Object.keys(extra).map(m => m ? `${m} {\n${extra[m].join("\n")}\n}` : extra[m].join("\n"));
  if (blocks.length) result += "\n\n/* older After Effects: flex gap fallback (compat.js turns on html.jw-nogap) */\n" + blocks.join("\n") + "\n";
  return result;
}

if (which === "release") fs.rmSync(T.out, { recursive: true, force: true });
fs.mkdirSync(path.join(T.out, "jsx"), { recursive: true });
fs.mkdirSync(path.join(T.out, "CSXS"), { recursive: true });
fs.mkdirSync(path.join(T.out, "engine"), { recursive: true });

const aspectRules = [];
for (const f of FILES) {
  let data = fs.readFileSync(path.join(SRC, f), "utf8");
  if (/\.css$/.test(f)) data = cssCompat(data, aspectRules);
  if (/\.(js|jsx)$/.test(f)) {
    data = escapeNonAscii(data);
    new Function(data); // refuse to ship a file that doesn't parse
  }
  fs.writeFileSync(path.join(T.out, f), data);
}
// hand compat.js the aspect-ratio rules found in the CSS
fs.writeFileSync(path.join(T.out, "compat.js"),
  "window.JW_COMPAT_AR = " + escapeNonAscii(JSON.stringify(aspectRules)) + ";\n" + fs.readFileSync(path.join(T.out, "compat.js"), "utf8"));
console.log("older-AE fallbacks: " + aspectRules.length + " aspect-ratio rules");

// Ctrl+Space helper: compiled from helper/JWQuick.cs with the C# compiler that ships with Windows
(function buildHelper() {
  const csc = path.join(process.env.WINDIR || "C:/Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const dir = path.join(T.out, "helper"), exe = path.join(dir, "JWQuick.exe"), tmp = path.join(os.tmpdir(), "JWQuick-" + Date.now() + ".exe");
  fs.mkdirSync(dir, { recursive: true });
  cp.execFileSync(csc, ["-nologo", "-target:exe", "-optimize+", "-platform:x64", "-out:" + tmp, path.join(SRC, "helper", "JWQuick.cs")], { stdio: "inherit" });
  try { fs.copyFileSync(tmp, exe); fs.rmSync(exe.replace(/.exe$/, ".new.exe"), { force: true }); }
  catch (e) { fs.copyFileSync(tmp, exe.replace(/.exe$/, ".new.exe")); console.log("helper is running: the update is staged and swaps in when the panel starts"); }
  fs.rmSync(tmp, { force: true });
})();

fs.writeFileSync(path.join(T.out, "config.js"),
  "/* Per-install defaults, written by build.js */\nwindow.JWPA_CONFIG = " + JSON.stringify(T.config, null, 2) + ";\n");

const manifest = fs.readFileSync(path.join(SRC, "CSXS", "manifest.template.xml"), "utf8")
  .replace(/\{\{BUNDLE\}\}/g, T.bundle).replace(/\{\{VERSION\}\}/g, VERSION);
fs.writeFileSync(path.join(T.out, "CSXS", "manifest.xml"), manifest);

// remove files from older versions that are no longer part of the extension
const keep = new Set(FILES.concat(["config.js", "CSXS/manifest.xml", "helper/JWQuick.exe", "helper/JWQuick.new.exe"]).map(f => f.replace(/\//g, path.sep)));
(function prune(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name, full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== ".debug") prune(full, r); }
    else if (!keep.has(r)) { fs.rmSync(full); console.log("removed old file", r); }
  }
})(T.out, "");

if (which === "release") {
  // leak check: nothing personal may end up in the shipped files
  const words = readLocal("leak-patterns.txt", "").split(/\r?\n/).map(s => s.trim()).filter(s => s && s[0] !== "#");
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bad = words.length ? new RegExp(words.map(esc).join("|"), "i") : null;
  if (!bad) console.log("leak check skipped (no build/leak-patterns.txt)");
  for (const f of bad ? FILES.concat(["config.js", "CSXS/manifest.xml"]) : []) {
    const t = fs.readFileSync(path.join(T.out, f), "utf8");
    const m = bad.exec(t);
    if (m) { console.error("PERSONAL DATA LEFT in " + f + ": " + m[0]); process.exit(2); }
  }
  const zip = path.join(ROOT, "dist", "payload.zip");
  fs.rmSync(zip, { force: true });
  cp.execFileSync("powershell", ["-NoProfile", "-Command",
    "Compress-Archive -Path '" + path.join(T.out, "*") + "' -DestinationPath '" + zip + "' -CompressionLevel Optimal"], { stdio: "inherit" });
  console.log("payload:", zip, Math.round(fs.statSync(zip).size / 1024) + " KB");
}
console.log("built", which, "->", T.out);
