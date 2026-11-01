/* JW Preset Applicator Pro - Auto Captions (Audio tab). Formerly the separate Sentence Studio panel.
 *
 * Local speech detection (faster-whisper + WhisperX, in the private Python engine at
 * %LOCALAPPDATA%\SentenceStudio\engine), word review, and caption layers built by jsx/captions.jsx.
 * Styles: Animated (captured template), Pop-up, Widescreen, plus your own custom styles.
 * Everything here is scoped to #cc-root and cc-* ids so it can't clash with the rest of the panel.
 */
(function () {
  'use strict';
  var J = window.JWPA;
  var $ = function (id) { return document.getElementById('cc-' + id); };
  var rootEl = $('root');
  if (!rootEl) return;

  var fs, path, os, spawn, url, EXT, python, ffmpeg, stateRoot, lockPath;
  var words = [], source = null, detectedLanguage = null, busy = false, needsRealign = false, polling = false;
  var hostQueue = Promise.resolve();
  var pickerArmed = false, pickerReady = false, pickerGeneration = 0, pickerBaseline = null, pickerDragging = false;
  var engineReady = false;
  var KEY = 'JW.captions.';

  // ------------------------------------------------------------------ AE access (serialised with a lock file shared by Fox Studio panels)
  function lockAE() {
    return new Promise(function (resolve, reject) {
      var token = Date.now() + '-' + Math.random(), started = Date.now();
      function attempt() {
        try {
          var fd = fs.openSync(lockPath, 'wx'); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token: token, started: Date.now() })); fs.closeSync(fd);
          resolve(function () { try { var lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); if (lock.token === token) fs.unlinkSync(lockPath); } catch (e) {} });
        } catch (e) {
          if (e.code !== 'EEXIST') return reject(e);
          try { var old = JSON.parse(fs.readFileSync(lockPath, 'utf8')); try { process.kill(old.pid, 0); } catch (dead) { if (dead.code === 'ESRCH') { fs.unlinkSync(lockPath); return setTimeout(attempt, 10); } } } catch (incomplete) {}
          if (Date.now() - started > 60000) return reject(Error('Another AE command is still running. Wait for it to finish.'));
          setTimeout(attempt, 100);
        }
      }
      attempt();
    });
  }
  function host(action, args) {
    var request = hostQueue.then(function () { return lockAE(); }).then(function (release) {
      return new Promise(function (resolve, reject) {
        if (!window.__adobe_cep__) { release(); return reject(Error('Open the panel inside After Effects.')); }
        var script = 'SentenceStudio.call(' + JSON.stringify(action) + ',' + JSON.stringify(JSON.stringify(args || {})) + ')';
        var notice = setTimeout(function () { if (action === 'build' || action === 'renderAudio') status('Waiting for AE. Close any open dialog or stop playback; this command is still pending.', 'busy'); }, 20000);
        window.__adobe_cep__.evalScript(script, function (response) {
          clearTimeout(notice); release();
          try { var data = JSON.parse(response); if (!data.ok) throw Error(data.error); resolve(data.result); } catch (e) { reject(e); }
        });
      });
    });
    hostQueue = request.catch(function () {});
    return request;
  }

  // ------------------------------------------------------------------ status, progress, busy
  function setProgress(value) { var p = Math.max(0, Math.min(100, Math.round(value))); $('progressFill').style.width = p + '%'; $('progressPercent').textContent = p + '%'; }
  function status(message, state) {
    if (/^Loading .*speech model/.test(message)) message = 'Preparing the speech model…';
    $('status').textContent = message; $('statusDot').className = 'cc-dot ' + (state || ''); $('enginePhase').textContent = message;
  }
  function setBusy(value) {
    busy = value; rootEl.classList.toggle('is-busy', value);
    ['transcribe', 'realign', 'generate', 'browse', 'selectedAudio', 'capture', 'dropper', 'reload'].forEach(function (id) { $(id).disabled = value || (!engineReady && /transcribe|realign|dropper/.test(id)); });
    $('transcribe').classList.toggle('busy', value && !!$('transcribe').dataset.running);
  }
  // the panel's live reload waits while a caption job is running
  var prevBusy = J && J.topazBusy;
  if (J) J.topazBusy = function () { return busy || !!(prevBusy && prevBusy()); };

  // ------------------------------------------------------------------ picking audio
  function cancelPicker() {
    pickerArmed = false; pickerReady = false; pickerGeneration++; rootEl.classList.remove('picking'); $('pickerTargets').hidden = true;
    $('pickerTitle').textContent = 'Pick audio'; $('pickerHint').textContent = 'Drag the pin onto a layer, or click it and then select a layer in AE';
  }
  async function pickTarget(target) {
    if (busy) return; cancelPicker(); $('followSelection').checked = false;
    try { setBusy(true); attachSource(await host('targetAudio', target)); setBusy(false); burst(); await recognize(false); }
    catch (e) { setBusy(false); status(e.message, 'error'); }
  }
  async function armPicker() {
    if (busy) return; pickerArmed = true; pickerReady = false; var generation = ++pickerGeneration;
    rootEl.classList.add('picking'); $('pickerTargets').hidden = false; $('pickerTitle').textContent = 'Choose a source';
    $('pickerHint').textContent = 'Drop onto a source below, or select a different layer in AE.'; $('targetList').textContent = 'Finding your audio…';
    try {
      var baseline = await host('selection'); if (!pickerArmed || generation !== pickerGeneration) return; pickerBaseline = (baseline || {}).key; pickerReady = true;
      var targets = await host('targets'); if (!pickerArmed || generation !== pickerGeneration) return;
      $('targetList').textContent = '';
      targets.forEach(function (t) {
        var b = document.createElement('button'); b.className = 'cc-target'; b._target = t;
        var icon = document.createElement('span'); icon.className = 'cc-target-ic'; icon.textContent = t.compOnly ? '▣' : '♫';
        var label = document.createElement('span'); label.className = 'cc-target-text';
        var name = document.createElement('strong'); name.textContent = t.name; var type = document.createElement('small'); type.textContent = t.type;
        label.appendChild(name); label.appendChild(type); b.appendChild(icon); b.appendChild(label);
        b.onclick = function () { pickTarget(t); }; $('targetList').appendChild(b);
      });
      if (!targets.length) $('targetList').textContent = 'Open a comp with audio, then pick again.';
    } catch (e) { if (generation === pickerGeneration) { cancelPicker(); status(e.message, 'error'); } }
  }
  function desktopPin(config, onEvent) {
    if (process.platform !== 'win32') return function () {};
    var child = spawn(python, [path.join(EXT, 'engine', 'pin_overlay.py'), JSON.stringify(config)], { windowsHide: true, env: Object.assign({}, process.env, { PYTHONUTF8: '1' }) });
    var closed = false;
    host('timelineTargets').then(function (snapshot) { if (!closed && child.stdin.writable) child.stdin.write(JSON.stringify({ timeline: snapshot }) + '\n'); }).catch(function () {});
    var buffer = '', errors = '';
    child.stdout.on('data', function (chunk) { buffer += chunk.toString(); var lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(function (line) { try { onEvent(JSON.parse(line)); } catch (e) {} }); });
    child.stderr.on('data', function (chunk) { errors = (errors + chunk.toString()).slice(-3000); });
    child.on('error', function () { onEvent({ event: 'closed', reason: 'error' }); });
    child.on('close', function (code) { closed = true; if (code && errors) console.warn('Desktop pin:', errors); onEvent({ event: 'exit' }); });
    return function () { closed = true; try { if (!child.killed && child.stdin.writable) child.stdin.end('{"stop":true}\n'); } catch (e) {} };
  }

  // ------------------------------------------------------------------ words + caption preview
  function save() {
    try { localStorage.setItem(KEY + 'session', JSON.stringify({ words: words, source: source, followSelection: $('followSelection').checked, language: detectedLanguage, offset: $('offset').value, transcript: $('transcript').value, needsRealign: needsRealign })); } catch (e) {}
  }
  function groups() { return CaptionPlanner.group(words, { maxWords: $('maxWords').value, pause: Number($('pause').value) }); }
  function updateGroups() {
    $('groups').textContent = '';
    if (!words.length) { var empty = document.createElement('div'); empty.className = 'cc-empty'; empty.textContent = 'Your captions appear here after detecting speech.'; $('groups').appendChild(empty); save(); return; }
    try {
      groups().forEach(function (g) {
        var row = document.createElement('div'); row.className = 'cc-group';
        var t = document.createElement('span'); t.textContent = g.text;
        var stamp = document.createElement('small'); stamp.textContent = g.start.toFixed(2) + ' → ' + g.end.toFixed(2) + 's';
        row.appendChild(t); row.appendChild(stamp); $('groups').appendChild(row);
      });
    } catch (e) { $('groups').textContent = e.message; }
    save();
  }
  function renderWords() {
    $('wordCount').textContent = words.length + (words.length === 1 ? ' word' : ' words'); $('words').textContent = '';
    if (!words.length) {
      $('words').innerHTML = '<div class="cc-empty"><strong>No words yet.</strong><small>Pick audio, then detect speech.</small></div>';
      $('reviewNote').textContent = 'Listen once and fine-tune the moments that matter.'; updateGroups(); return;
    }
    var header = document.createElement('div'); header.className = 'cc-word-head';
    ['#', 'Word', 'Start', 'End', ''].forEach(function (t) { var s = document.createElement('span'); s.textContent = t; header.appendChild(s); });
    $('words').appendChild(header);
    words.forEach(function (w, i) {
      var row = document.createElement('div'); row.className = 'cc-word-row' + (w.review ? ' low' : ''); row.dataset.index = i;
      var n = document.createElement('span'); n.className = 'cc-num'; n.textContent = i + 1; row.appendChild(n);
      ['word', 'start', 'end'].forEach(function (key) {
        var input = document.createElement('input'); input.className = 'cc-' + key; input.type = key === 'word' ? 'text' : 'number';
        input.value = w[key] === null ? '' : key === 'word' ? w[key] : w[key].toFixed(3);
        if (key !== 'word') { input.step = '0.001'; input.min = '0'; }
        input.title = key === 'word' ? 'Edit this word. Use Correct transcript to add or remove words.' : key + ' time in composition seconds';
        input.addEventListener('change', function () {
          if (key === 'word') {
            var text = input.value.trim(); if (!text || /\s/.test(text)) { input.value = w.word; status('Use Correct transcript to add or remove words.', 'error'); return; }
            w.word = text; needsRealign = true; $('transcript').value = words.map(function (x) { return x.word; }).join(' ');
            $('reviewNote').textContent = 'Text changed. Realign the corrected words before creating captions.';
          } else { w[key] = input.value === '' ? null : Number(input.value); w.review = !(Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start); }
          updateGroups();
        });
        row.appendChild(input);
      });
      var conf = document.createElement('span'); conf.className = 'cc-conf'; conf.textContent = w.review ? '!' : '·';
      conf.title = w.score === null ? 'No alignment score' : ('Alignment score: ' + Math.round(w.score * 100) + '%. Not a transcription accuracy percentage.'); row.appendChild(conf);
      n.title = 'Jump to this word in AE and the audio';
      n.onclick = function () { if (Number.isFinite(w.start)) { host('seek', { time: w.start }).catch(function (e) { status(e.message, 'error'); }); if (source) $('audio').currentTime = Math.max(0, w.start - Number($('offset').value) + (source.trimStart || 0)); } };
      $('words').appendChild(row);
    });
    var flagged = words.filter(function (w) { return w.review; }).length;
    $('reviewNote').textContent = flagged ? flagged + ' words need a look (amber). Missing timings must be entered or realigned.' : 'All words aligned. Listen once and adjust any timing that needs it.';
    updateGroups();
  }
  function attachSource(value) {
    var changed = source && ((source.key || source.path) !== (value.key || value.path) || source.offset !== value.offset || source.duration !== value.duration);
    source = value; $('sourceBadge').textContent = 'Linked'; $('sourceBadge').classList.add('on');
    $('sourceMeta').textContent = (value.compOnly ? 'Composition mix' : value.kind === 'precomp' ? 'Precomp audio' : 'Audio') + ' · starts ' + (value.offset || 0).toFixed(2) + 's';
    if (changed) { $('engineProgress').hidden = true; setProgress(0); words = []; detectedLanguage = null; needsRealign = false; $('transcript').value = ''; renderWords(); }
    $('offset').value = value.offset || 0;
    $('audioName').textContent = (value.name || (value.path ? path.basename(value.path) : 'Selected precomp')) + (value.kind === 'precomp' ? ' · audio renders when you detect' : '');
    if (value.path) { $('audio').src = url.pathToFileURL(value.path).href; $('audio').classList.add('loaded'); }
    else { $('audio').removeAttribute('src'); $('audio').classList.remove('loaded'); }
    save();
  }

  // ------------------------------------------------------------------ detection
  async function recognize(corrected) {
    if (busy) return;
    if (!engineReady) throw Error($('engineNote').textContent || 'The speech engine isn’t installed.');
    if (!source) throw Error('Pick audio or select an audio layer in AE first.');
    if (corrected && !$('transcript').value.trim()) throw Error('Enter the exact spoken transcript first.');
    setProgress(0); $('engineProgress').hidden = false;
    if (source.kind === 'precomp') {
      setBusy(true); status('Rendering the precomp’s audio…', 'busy');
      try { attachSource(await host('renderAudio', source)); } catch (e) { setBusy(false); throw e; }
    }
    var base = path.join(os.tmpdir(), 'sentence-studio', Date.now() + '-' + Math.random().toString(16).slice(2)); fs.mkdirSync(base, { recursive: true });
    var req = { audio: source.path, trimStart: source.trimStart || 0, duration: source.duration, ffmpeg: ffmpeg, output: path.join(base, 'result.json'), state: stateRoot,
      language: $('language').value, detectedLanguage: detectedLanguage, hints: $('hints').value,
      model: fs.existsSync(path.join(stateRoot, 'models', 'large-v3', 'model.bin')) ? path.join(stateRoot, 'models', 'large-v3') : 'large-v3' };
    if (corrected) req.transcript = $('transcript').value.trim();
    var request = path.join(base, 'request.json'); fs.writeFileSync(request, JSON.stringify(req));
    $('transcribe').dataset.running = '1'; setBusy(true); status('Starting local word detection…', 'busy');
    try {
      await new Promise(function (resolve, reject) {
        var env = Object.assign({}, process.env, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' });
        var child = spawn(python, [path.join(EXT, 'engine', 'worker.py'), request], { windowsHide: true, env: env }), buffer = '', errorLog = '', reported = '';
        child.stdout.on('data', function (chunk) {
          buffer += chunk.toString(); var lines = buffer.split(/\r?\n/); buffer = lines.pop();
          lines.forEach(function (line) { try { var item = JSON.parse(line); if (item.progress !== null && Number.isFinite(item.progress)) setProgress(item.progress); if (item.message) status(item.message, item.stage === 'error' ? 'error' : 'busy'); if (item.stage === 'error') reported = item.message; } catch (e) {} });
        });
        child.stderr.on('data', function (chunk) { errorLog = (errorLog + chunk.toString()).slice(-8000); });
        child.on('error', reject);
        child.on('close', function (code) { fs.writeFileSync(path.join(base, 'engine.log'), errorLog); if (code === 0) resolve(); else reject(Error(reported || 'Speech engine failed. See ' + path.join(base, 'engine.log'))); });
      });
      var result = JSON.parse(fs.readFileSync(req.output, 'utf8')), offset = Number($('offset').value);
      words = result.words.map(function (w) { return { word: w.word, start: w.start === null ? null : w.start + offset, end: w.end === null ? null : w.end + offset, score: w.score, review: w.review }; });
      detectedLanguage = result.language; $('transcript').value = result.transcript; needsRealign = false; renderWords(); setProgress(100);
      status('Aligned ' + words.length + ' words · ' + result.language.toUpperCase() + '. Review, then create.', 'ok');
      if (J) J.toast('Found ' + words.length + ' words', 'ok', 2200);
    } finally { delete $('transcribe').dataset.running; setBusy(false); }
  }

  async function resetSession() {
    if (busy) return false; setBusy(true);
    cancelPicker(); stopDrag();
    $('engineProgress').hidden = true; setProgress(0); source = null; words = []; detectedLanguage = null; needsRealign = false; pickerBaseline = null;
    $('followSelection').checked = false; $('transcript').value = ''; $('offset').value = '0'; $('hints').value = ''; $('language').value = 'auto'; $('file').value = '';
    $('audio').pause(); $('audio').removeAttribute('src'); $('audio').load(); $('audio').classList.remove('loaded');
    $('audioName').textContent = 'No audio linked yet'; $('sourceMeta').textContent = 'Select a layer in AE, or pick a file.'; $('sourceBadge').textContent = 'No source'; $('sourceBadge').classList.remove('on'); $('targetList').textContent = '';
    renderWords(); try { localStorage.removeItem(KEY + 'session'); } catch (e) {}
    status('Clearing rendered audio…');
    try {
      var cleanup = stateRoot ? await AudioCache.clear(fs, path, stateRoot, function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }) : { failed: [] };
      if (cleanup.failed.length) { status('Reset the text, but ' + cleanup.failed.length + ' audio renders are still in use. Close their previews and reset again.', 'error'); return false; }
      status('Reset. Pick audio to start fresh.'); return true;
    } finally { setBusy(false); }
  }

  // ------------------------------------------------------------------ caption styles (built-in + your own)
  var BUILT_IN = {
    popup: function () { return { name: 'Pop-up', font: 'TikTokSans-Medium', size: Number($('popupSize').value) || 70, fill: '#ffffff', stroke: true, strokeColor: '#000000', strokeWidth: 11, caps: false, shadow: false, tracking: 0, blend: 'normal', wordByWord: false, prefix: '- ', y: Number($('popupY').value) || 50 }; },
    widescreen: function () { return { name: 'Widescreen', font: 'Arial-BoldMT', size: 0, fill: '#ffffff', stroke: false, strokeColor: '#000000', strokeWidth: 11, caps: true, shadow: false, tracking: 60, blend: 'difference', wordByWord: true, prefix: '', y: Number($('popupY').value) || 50 }; }
  };
  var fontFamily = {}; // PostScript name -> family (for the preview)
  function loadStyles() { try { return JSON.parse(localStorage.getItem(KEY + 'styles')) || []; } catch (e) { return []; } }
  function saveStyles(list) { try { localStorage.setItem(KEY + 'styles', JSON.stringify(list)); } catch (e) {} }
  function findStyle(id) { return loadStyles().filter(function (s) { return s.id === id; })[0] || null; }
  function hexToRgb(h) { h = String(h || '#ffffff').replace('#', ''); return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
  function fillStyleSelect(selectValue) {
    var sel = $('captionStyle'), keep = selectValue || sel.value;
    Array.prototype.slice.call(sel.querySelectorAll('optgroup')).forEach(function (g) { g.remove(); });
    var mine = loadStyles();
    if (mine.length) {
      var grp = document.createElement('optgroup'); grp.label = 'Your styles';
      mine.forEach(function (s) { var o = document.createElement('option'); o.value = 'custom:' + s.id; o.textContent = s.name; grp.appendChild(o); });
      sel.appendChild(grp);
    }
    sel.value = keep; if (sel.value !== keep) sel.value = 'template';
    styleChanged();
  }
  function styleChanged() {
    var v = $('captionStyle').value, custom = v.indexOf('custom:') === 0;
    $('popupSizeRow').hidden = v !== 'popup';
    $('popupYRow').hidden = !(v === 'popup' || v === 'widescreen');
    $('fadeOut').closest('.fps-row').hidden = v !== 'template';
    $('lineLayout').closest('.fps-row').hidden = v !== 'template';
    $('editStyle').textContent = custom ? 'Edit this style…' : v === 'template' ? 'Make a new style…' : 'Customize this style…';
    try { localStorage.setItem(KEY + 'opt.captionStyle', v); } catch (e) {}
  }
  var editing = null; // id of the custom style open in the editor, or null for a new one
  function openEditor() {
    var v = $('captionStyle').value, spec, note;
    if (v.indexOf('custom:') === 0) { spec = findStyle(v.slice(7)); editing = spec && spec.id; note = 'Editing “' + (spec ? spec.name : '') + '”. Update it, or save a copy as a new style.'; }
    else {
      var from = BUILT_IN[v] ? v : 'popup'; spec = BUILT_IN[from](); editing = null;
      note = v === 'template' ? 'Animated captions use your captured template. Starting from Pop-up instead: change anything, then save it as a new style.' : 'Starting from ' + spec.name + '. Change anything, then save it as a new style.';
      spec.name = spec.name + ' copy';
    }
    if (!spec) return;
    $('editorNote').textContent = note;
    $('sName').value = spec.name || ''; $('sFont').value = spec.font || ''; $('sSize').value = spec.size || 0; $('sFill').value = spec.fill || '#ffffff';
    $('sStroke').checked = !!spec.stroke; $('sStrokeColor').value = spec.strokeColor || '#000000'; $('sStrokeWidth').value = spec.strokeWidth || 11;
    $('sCaps').checked = !!spec.caps; $('sShadow').checked = !!spec.shadow; $('sTracking').value = spec.tracking || 0; $('sBlend').value = spec.blend || 'normal';
    setBuild(spec.wordByWord ? 'word' : 'all'); $('sPrefix').value = spec.prefix || ''; $('sY').value = spec.y === undefined ? 50 : spec.y;
    $('sUpdate').hidden = !editing; $('sDelete').hidden = !editing;
    $('editor').hidden = false; preview(); loadFonts();
    $('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function setBuild(val) { Array.prototype.slice.call($('sBuild').querySelectorAll('button')).forEach(function (b) { b.classList.toggle('on', b.dataset.val === val); }); }
  function readEditor() {
    var on = $('sBuild').querySelector('button.on');
    return { name: $('sName').value.trim() || 'My style', font: $('sFont').value.trim() || 'ArialMT', size: Math.max(0, Number($('sSize').value) || 0), fill: $('sFill').value,
      stroke: $('sStroke').checked, strokeColor: $('sStrokeColor').value, strokeWidth: Math.max(1, Number($('sStrokeWidth').value) || 11), caps: $('sCaps').checked, shadow: $('sShadow').checked,
      tracking: Number($('sTracking').value) || 0, blend: $('sBlend').value, wordByWord: !!on && on.dataset.val === 'word', prefix: $('sPrefix').value, y: Math.max(0, Math.min(100, Number($('sY').value) || 50)) };
  }
  function preview() {
    var s = readEditor(), box = $('stylePreview'), span = box.querySelector('span');
    $('sStrokeColor').closest('.fps-row').hidden = !s.stroke;
    span.textContent = (s.prefix || '') + (s.wordByWord ? 'Words appear one by one' : 'Your caption looks like this');
    span.style.fontFamily = '"' + (fontFamily[s.font] || s.font) + '", "Segoe UI", sans-serif';
    span.style.fontWeight = /bold|black|heavy/i.test(s.font) ? '800' : /medium|semi/i.test(s.font) ? '600' : '400';
    span.style.color = s.fill; span.style.textTransform = s.caps ? 'uppercase' : 'none'; span.style.letterSpacing = (s.tracking / 1000) + 'em';
    span.style.webkitTextStroke = s.stroke ? Math.max(1, s.strokeWidth / 10) + 'px ' + s.strokeColor : '0';
    span.style.paintOrder = 'stroke fill';
    span.style.textShadow = s.shadow ? '0 2px 6px rgba(0,0,0,.75)' : 'none';
    span.style.mixBlendMode = { normal: 'normal', difference: 'difference', add: 'plus-lighter', screen: 'screen', overlay: 'overlay', softlight: 'soft-light', multiply: 'multiply' }[s.blend] || 'normal';
    box.style.alignItems = s.y < 34 ? 'flex-start' : s.y > 66 ? 'flex-end' : 'center';
  }
  var fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded || !window.__adobe_cep__) return; fontsLoaded = true;
    host('fonts').then(function (list) {
      var dl = $('fontList'); dl.textContent = '';
      (list || []).forEach(function (f) { fontFamily[f.ps] = f.family; var o = document.createElement('option'); o.value = f.ps; o.label = f.family + ' ' + f.style; dl.appendChild(o); });
      preview();
    }).catch(function () { fontsLoaded = false; });
  }
  function saveNew() {
    var spec = readEditor(); spec.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var list = loadStyles(); list.push(spec); saveStyles(list);
    editing = spec.id; $('sUpdate').hidden = false; $('sDelete').hidden = false;
    fillStyleSelect('custom:' + spec.id); status('Saved style “' + spec.name + '”.', 'ok'); if (J) J.toast('Saved style “' + spec.name + '”', 'ok', 2000);
  }
  function updateStyle() {
    if (!editing) return saveNew();
    var spec = readEditor(); spec.id = editing;
    saveStyles(loadStyles().map(function (s) { return s.id === editing ? spec : s; }));
    fillStyleSelect('custom:' + editing); status('Updated “' + spec.name + '”.', 'ok'); if (J) J.toast('Updated “' + spec.name + '”', 'ok', 2000);
  }
  function deleteStyle() {
    if (!editing) return;
    var gone = findStyle(editing); saveStyles(loadStyles().filter(function (s) { return s.id !== editing; }));
    editing = null; $('editor').hidden = true; fillStyleSelect('template'); status('Deleted “' + (gone ? gone.name : 'style') + '”.');
  }

  // ------------------------------------------------------------------ the pin (drag onto a layer)
  var button = $('dropper'), ghost = $('pickerGhost'), cable = $('pickerCable');
  var drag = null, frame = 0, hover = null, suppressClick = false;
  function reduced() { return document.body.classList.contains('reduce') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function clearHover() { if (hover) hover.classList.remove('drop-hover'); hover = null; }
  function stopDrag() { cancelAnimationFrame(frame); frame = 0; if (drag && drag.closeDesktop) drag.closeDesktop(); drag = null; pickerDragging = false; clearHover(); ghost.classList.remove('active'); cable.classList.remove('active'); }
  function desktop(d) {
    d.closeDesktop = desktopPin({ x: d.anchorX, y: d.anchorY, scale: devicePixelRatio || 1, reduced: reduced() }, function (event) {
      if (drag !== d) return;
      if (event.event === 'ready') { d.desktop = true; ghost.classList.remove('active'); cable.classList.remove('active'); }
      if (event.event === 'hover') $('pickerHint').textContent = event.target ? 'Over ' + event.target.name + ' · let go to use it.' : 'Move over an audio or precomp row in AE.';
      // dropped on a recognised timeline row: link that exact layer now; the overlay plays its landing animation meanwhile
      if (event.event === 'drop' && event.target && !d.dropped) { d.dropped = event.target; $('pickerHint').textContent = 'Linking ' + event.target.name + '…'; pickTarget({ compId: event.target.compId, layerId: event.target.layerId, name: event.target.name }); }
      if (event.event === 'closed' || event.event === 'exit') {
        d.desktop = false;
        if (d.dropped) { setTimeout(function () { if (drag === d) stopDrag(); }, 0); return; }
        if (event.reason === 'release' || event.reason === 'escape' || event.reason === 'timeout') setTimeout(function () { if (drag !== d) return; stopDrag(); if (event.reason === 'escape') cancelPicker(); else $('pickerHint').textContent = 'Now click an audio or precomp layer in AE.'; }, 100);
        else if (event.reason === 'error' || event.event === 'exit') { ghost.classList.add('active'); cable.classList.add('active'); }
      }
    });
  }
  function burst() {
    var r = button.getBoundingClientRect(), b = $('successBurst');
    b.style.left = (r.left + r.width / 2) + 'px'; b.style.top = (r.top + r.height / 2) + 'px';
    b.classList.remove('active'); void b.offsetWidth; b.classList.add('active'); button.classList.add('linked');
    setTimeout(function () { b.classList.remove('active'); button.classList.remove('linked'); }, 900);
  }
  function tick() {
    if (!drag) return; var d = drag, r = button.getBoundingClientRect(), ax = r.left + r.width / 2, ay = r.top + r.height / 2;
    d.vx = (d.vx + (d.tx - d.x) * .18) * .68; d.vy = (d.vy + (d.ty - d.y) * .18) * .68;
    d.x = reduced() ? d.tx : d.x + d.vx; d.y = reduced() ? d.ty : d.y + d.vy;
    ghost.style.transform = 'translate(' + (d.x - 22) + 'px,' + (d.y - 22) + 'px) rotate(' + Math.max(-22, Math.min(22, d.vx * 1.2)) + 'deg)';
    var sag = Math.min(90, Math.hypot(d.x - ax, d.y - ay) * .24), curve = 'M ' + ax + ' ' + ay + ' C ' + ax + ' ' + (ay + sag) + ' ' + d.x + ' ' + (d.y + sag) + ' ' + d.x + ' ' + d.y;
    Array.prototype.slice.call(cable.querySelectorAll('path')).forEach(function (p) { p.setAttribute('d', curve); });
    var dot = cable.querySelector('circle'); dot.setAttribute('cx', ax); dot.setAttribute('cy', ay);
    var el = document.elementFromPoint(d.tx, d.ty), target = el && el.closest('.cc-target');
    if (target !== hover) { clearHover(); hover = target; if (hover) hover.classList.add('drop-hover'); }
    var list = $('targetList'), lr = list.getBoundingClientRect();
    if (d.tx > lr.left && d.tx < lr.right && d.ty > lr.top && d.ty < lr.bottom) { if (d.ty > lr.bottom - 24) list.scrollTop += 4; else if (d.ty < lr.top + 24) list.scrollTop -= 4; }
    frame = requestAnimationFrame(tick);
  }
  button.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || busy || !engineReady) return; e.preventDefault(); button.setPointerCapture(e.pointerId); armPicker(); pickerDragging = true;
    var r = button.getBoundingClientRect(), ratio = devicePixelRatio || 1;
    drag = { id: e.pointerId, tx: e.clientX, ty: e.clientY, x: r.left + r.width / 2, y: r.top + r.height / 2, vx: 0, vy: 0, sx: e.clientX, sy: e.clientY,
      anchorX: (e.screenX + r.left + r.width / 2 - e.clientX) * ratio, anchorY: (e.screenY + r.top + r.height / 2 - e.clientY) * ratio, moved: false };
  });
  button.addEventListener('pointermove', function (e) {
    if (!drag || drag.id !== e.pointerId) return; drag.tx = e.clientX; drag.ty = e.clientY;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5 && !drag.moved) { drag.moved = true; ghost.classList.add('active'); cable.classList.add('active'); tick(); desktop(drag); }
  });
  button.addEventListener('pointerup', function (e) {
    if (!drag) return; var moved = drag.moved, el = document.elementFromPoint(e.clientX, e.clientY), target = el && el.closest('.cc-target');
    suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
    // let go outside the panel while the desktop pin is up: the pin decides (a drop on a timeline row, or nothing)
    if (moved && !target && drag.desktop) { var d = drag; setTimeout(function () { if (drag === d) stopDrag(); }, 4000); return; }
    stopDrag(); if (moved && target) pickTarget(target._target); else if (moved) $('pickerHint').textContent = 'Now click a different audio or precomp layer in AE.';
  });
  button.addEventListener('pointercancel', function () { stopDrag(); cancelPicker(); });
  button.addEventListener('click', function () { if (!suppressClick && !busy && engineReady) armPicker(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (drag || pickerArmed)) { stopDrag(); cancelPicker(); } });
  window.addEventListener('beforeunload', stopDrag);

  // ------------------------------------------------------------------ setup
  function bind(id, fn) { $(id).onclick = function () { Promise.resolve().then(fn).catch(function (e) { status(e.message, 'error'); setBusy(false); }); }; }
  function findEngine() {
    // an override file written by the setup, else Sentence Studio's engine folder
    var state = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SentenceStudio', 'engine'), py, ff;
    try { var rt = JSON.parse(fs.readFileSync(path.join(EXT, 'captions-runtime.json'), 'utf8').replace(/^﻿/, '')); if (rt.state) state = rt.state; py = rt.python; ff = rt.ffmpeg; if (rt.lockPath) lockPath = rt.lockPath; } catch (e) {}
    python = py || path.join(state, 'runtime', 'Scripts', 'python.exe'); ffmpeg = ff || path.join(state, 'bin', 'ffmpeg.exe'); stateRoot = state;
    return fs.existsSync(python) && fs.existsSync(ffmpeg) && fs.existsSync(path.join(EXT, 'engine', 'worker.py'));
  }
  // parts that don't need After Effects or Node: styles + editor, tabs, options
  function bindUi() {
    ['maxWords', 'pause'].forEach(function (id) { $(id).onchange = updateGroups; });
    ['popupSize', 'popupY', 'maxWords', 'lineLayout', 'width'].forEach(function (id) {
      try { var v = localStorage.getItem(KEY + 'opt.' + id); if (v !== null) $(id).value = v; } catch (e) {}
      $(id).addEventListener('change', function () { try { localStorage.setItem(KEY + 'opt.' + id, $(id).value); } catch (e) {} });
    });
    var savedStyle = null; try { savedStyle = localStorage.getItem(KEY + 'opt.captionStyle'); } catch (e) {}
    fillStyleSelect(savedStyle || 'template');
    $('captionStyle').addEventListener('change', function () { styleChanged(); if (!$('editor').hidden) openEditor(); });
    bind('editStyle', openEditor);
    bind('sSave', saveNew); bind('sUpdate', updateStyle); bind('sDelete', deleteStyle);
    $('sClose').onclick = function () { $('editor').hidden = true; };
    Array.prototype.slice.call($('sBuild').querySelectorAll('button')).forEach(function (b) { b.onclick = function () { setBuild(b.dataset.val); preview(); }; });
    Array.prototype.slice.call($('editor').querySelectorAll('input, select')).forEach(function (el) { el.addEventListener('input', preview); el.addEventListener('change', preview); });
    Array.prototype.slice.call(rootEl.querySelectorAll('.cc-tab')).forEach(function (tab) {
      tab.onclick = function () {
        Array.prototype.slice.call(rootEl.querySelectorAll('.cc-tab')).forEach(function (t) { t.classList.toggle('on', t === tab); });
        $('wordsPane').hidden = tab.dataset.ccTab !== 'words'; $('transcriptPane').hidden = tab.dataset.ccTab !== 'transcript';
      };
    });
  }
  function init() {
    renderWords();
    bindUi();
    var req = window.cep_node ? window.cep_node.require : window.require;
    if (!req) { $('engineNote').textContent = 'Auto captions work inside After Effects.'; $('engineNote').hidden = false; setBusy(false); return; }
    fs = req('fs'); path = req('path'); os = req('os'); spawn = req('child_process').spawn; url = req('url');
    EXT = J && J.extPath ? J.extPath() : path.dirname(decodeURIComponent(location.pathname).replace(/^\/(?=[A-Za-z]:)/, ''));
    lockPath = path.join(os.homedir(), '.fox-studio', 'ae-script.lock');
    engineReady = findEngine();
    try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch (e) {}
    if (!engineReady) {
      $('engineNote').textContent = 'The speech engine isn’t installed on this PC. Run the JW Preset Applicator setup again and keep “Auto captions” switched on (it downloads about 4 GB once).';
      $('engineNote').hidden = false;
    }
    setBusy(false);

    bind('capture', async function () { var t = await host('capture'); $('templateName').textContent = t.name; $('templateMeta').textContent = 'Fade in · ' + t.fadeOut.toFixed(2) + 's fade out · tracking'; $('fadeOut').value = t.fadeOut.toFixed(2); $('templateState').textContent = 'Ready'; status('Captured your selected text animation.', 'ok'); });
    bind('selectedAudio', async function () { cancelPicker(); attachSource(await host('audio')); status('Audio linked to its comp timing.', 'ok'); });
    bind('browse', function () {
      if (window.cep && window.cep.fs) {
        var result = window.cep.fs.showOpenDialog(false, false, 'Choose audio or video', '', ['wav', 'mp3', 'm4a', 'mp4', 'mov', 'mkv', 'webm', 'flac', 'aac', 'ogg']);
        if (result.err === 0 && result.data && result.data.length) { $('followSelection').checked = false; attachSource({ path: result.data[0], name: path.basename(result.data[0]), offset: 0, trimStart: 0 }); status('Audio ready for word detection.', 'ok'); }
        else if (result.err && result.err !== 0) throw Error('File picker error ' + result.err);
      } else $('file').click();
    });
    $('file').onchange = function () { if (this.files.length) { var f = this.files[0]; if (!f.path) { status('Choose the file from an audio layer in AE.', 'error'); return; } attachSource({ path: f.path, name: f.name, offset: 0, trimStart: 0 }); status('Audio ready for word detection.', 'ok'); } };
    bind('transcribe', function () { return recognize(false); }); bind('realign', function () { return recognize(true); });
    bind('generate', async function () {
      $('engineProgress').hidden = true;
      if (needsRealign) throw Error('Realign the corrected words first so the timings match your edits.');
      var planned = groups(), v = $('captionStyle').value, result, label;
      setBusy(true); status('Building ' + planned.length + ' captions…', 'busy');
      try {
        if (v.indexOf('custom:') === 0) {
          var s = findStyle(v.slice(7)); if (!s) throw Error('That style was deleted. Pick another one.');
          var spec = {}; for (var k in s) spec[k] = s[k]; spec.fill = hexToRgb(s.fill); spec.strokeColor = hexToRgb(s.strokeColor); spec.strokeWidth = (Number(s.strokeWidth) || 11) / 100;
          result = await host('styled', { groups: planned, width: Number($('width').value), style: spec }); label = '“' + s.name + '”';
        } else if (v === 'popup' || v === 'widescreen') {
          result = await host(v, { groups: planned, popupSize: Number($('popupSize').value), popupY: Number($('popupY').value), width: Number($('width').value) }); label = v === 'popup' ? 'pop-up' : 'widescreen';
        } else {
          result = await host('build', { groups: planned, fadeOut: Number($('fadeOut').value), width: Number($('width').value), lineLayout: $('lineLayout').value }); label = 'animated';
        }
        var fontNote = result.fontOk === false ? ' The font wasn’t found, so AE used a fallback.' : '';
        status('Created ' + result.count + ' ' + label + ' captions in ' + result.composition + '.' + fontNote, fontNote ? 'error' : 'ok');
        if (J) J.toast('Created ' + result.count + ' captions', 'ok', 2400);
      } finally { setBusy(false); }
    });
    var oldOffset = Number($('offset').value);
    $('offset').addEventListener('focus', function () { oldOffset = Number(this.value); });
    $('offset').onchange = function () { var next = Number(this.value), delta = next - oldOffset; words.forEach(function (w) { if (w.start !== null) w.start += delta; if (w.end !== null) w.end += delta; }); oldOffset = next; renderWords(); };
    $('transcript').oninput = function () { needsRealign = true; save(); };
    $('audio').ontimeupdate = function () {
      if (!source) return; var current = this.currentTime - (source.trimStart || 0) + Number($('offset').value);
      Array.prototype.slice.call($('words').querySelectorAll('.cc-word-row')).forEach(function (row) { var w = words[Number(row.dataset.index)]; row.classList.toggle('playing', current >= w.start && current < w.end); });
    };
    $('followSelection').onchange = save;
    $('reload').onclick = function () { resetSession().catch(function (e) { setBusy(false); status(e.message, 'error'); }); };
    $('cancelPicker').onclick = function () { stopDrag(); cancelPicker(); };

    try {
      var saved = JSON.parse(localStorage.getItem(KEY + 'session'));
      if (saved) {
        words = saved.words || []; detectedLanguage = saved.language; needsRealign = !!saved.needsRealign; $('followSelection').checked = saved.followSelection === true;
        if (saved.source) { attachSource(saved.source); status('Restored your previous audio.'); }
        $('offset').value = saved.offset || 0; $('transcript').value = saved.transcript || ''; if (words.length) renderWords();
      }
    } catch (e) {}

    if (!window.__adobe_cep__) return;
    // load the AE side (re-loaded on every panel load, so updates apply without restarting AE)
    var loadHost = lockAE().then(function (release) {
      return new Promise(function (resolve, reject) {
        window.__adobe_cep__.evalScript('$.evalFile(File(' + JSON.stringify(path.join(EXT, 'jsx', 'captions.jsx')) + ')); "loaded";', function (reply) { release(); reply === 'loaded' ? resolve() : reject(Error('Could not load the captions AE script: ' + reply)); });
      });
    });
    hostQueue = loadHost.catch(function () {});
    loadHost.then(function () { return host('configure', { state: stateRoot }); }).then(function () {
      setInterval(function () {
        if (busy || polling || pickerDragging || (pickerArmed ? !pickerReady : !$('followSelection').checked)) return;
        var pollGeneration = pickerGeneration; polling = true;
        host('selection').then(function (selected) {
          if (busy || pickerDragging || pollGeneration !== pickerGeneration) return;
          if (pickerArmed && pickerReady && selected && selected.key !== pickerBaseline) { cancelPicker(); attachSource(selected); burst(); recognize(false).catch(function (e) { status(e.message, 'error'); }); return; }
          if (!pickerArmed && $('followSelection').checked && selected && (!source || source.key !== selected.key || source.offset !== selected.offset || source.duration !== selected.duration || source.trimStart !== selected.trimStart && source.kind !== 'rendered')) { attachSource(selected); status('Linked ' + selected.name + ' from AE.'); }
        }).catch(function () {}).then(function () { polling = false; });
      }, 1200);
      return host('template');
    }).then(function (t) {
      $('templateName').textContent = t.name; $('fadeOut').value = t.fadeOut.toFixed(2); $('templateMeta').textContent = 'Fade in · ' + t.fadeOut.toFixed(2) + 's fade out · tracking';
    }).catch(function (e) {
      $('templateState').textContent = 'Not set';
      if (!/template/i.test(e.message)) status(e.message, 'error');
      else $('templateMeta').textContent = 'Select a text layer with your animation and click Capture to use Animated captions.';
    });
  }
  init();
})();
