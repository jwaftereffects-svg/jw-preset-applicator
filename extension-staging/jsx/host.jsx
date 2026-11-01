/*
    JW Preset Applicator Pro - After Effects side of the extension.
    The HTML panel calls JWPAX.<function>(options) and gets a JSON string back.
    Saving this file makes the panel reload it automatically.
*/

var JWPAX = (function () {
    var SECTION = "JW_PresetApplicatorProPermanentCompact"; // shared with the ScriptUI panel
    var KEY_RECENTS = "recentPresets";
    var TIME_EPS = 0.0005;

    // ---------------- JSON out (ExtendScript has no JSON) ----------------
    function quote(s) {
        s = String(s);
        var out = '"';
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), code = s.charCodeAt(i);
            if (code === 34) out += '\\"';
            else if (code === 92) out += '\\\\';
            else if (code === 10) out += '\\n';
            else if (code === 13) out += '\\r';
            else if (code === 9) out += '\\t';
            else if (code < 32 || code === 8232 || code === 8233) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
            else out += c;
        }
        return out + '"';
    }

    function stringify(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return String(v);
        if (t === "string") return quote(v);
        if (v instanceof Array) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(stringify(v[i]));
            return "[" + a.join(",") + "]";
        }
        var parts = [];
        for (var k in v) if (v.hasOwnProperty(k)) parts.push(quote(k) + ":" + stringify(v[k]));
        return "{" + parts.join(",") + "}";
    }

    function ok(data) { data = data || {}; data.ok = true; return stringify(data); }
    function fail(msg) { return stringify({ ok: false, error: String(msg) }); }
    function errText(e) { return e.toString() + (e.line ? " (line " + e.line + ")" : ""); }

    // ---------------- Settings ----------------
    function getSetting(key, fallback) {
        try { if (app.settings.haveSetting(SECTION, key)) return app.settings.getSetting(SECTION, key); } catch (e) {}
        return fallback;
    }
    function saveSetting(key, value) {
        try { app.settings.saveSetting(SECTION, key, String(value)); } catch (e) {}
    }

    function loadFavorites() {
        var raw = getSetting(KEY_RECENTS, "");
        var list = raw ? raw.split("||") : [];
        var clean = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && new File(list[i]).exists && clean.length < 30) clean.push(list[i]);
        }
        return clean;
    }

    function addFavorite(path) {
        var list = [path], old = loadFavorites();
        for (var i = 0; i < old.length; i++) if (old[i] !== path && list.length < 30) list.push(old[i]);
        saveSetting(KEY_RECENTS, list.join("||"));
        return list;
    }

    // ---------------- Layer helpers ----------------
    function activeComp() {
        var c = app.project.activeItem;
        return (c instanceof CompItem) ? c : null;
    }

    function deselectAll(comp) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
    }

    // Change the selection without looping over every layer in the comp.
    function collapseApplied(comp, layers) {
        try {
            var props = comp.selectedProperties;
            for (var i = props.length - 1; i >= 0; i--) { try { props[i].selected = false; } catch (e0) {} }
        } catch (e1) {}
        try {
            var cmd = app.findMenuCommandId("Deselect All");
            if (cmd) app.executeCommand(cmd);
        } catch (e2) {}
        for (var j = 0; j < layers.length; j++) { try { layers[j].selected = false; } catch (e3) {} }
    }

    // Applying a preset twirls the layers open to show what it changed. Scripts can't twirl
    // directly, so use AE's own "reveal animated properties" command (the U key) on just those
    // layers. The first U switches them to showing every animated property (tested in AE 2026),
    // the second U closes them, the same as pressing U twice.
    var revealCmd = null;
    function closeTwirls(comp, layers) {
        if (revealCmd === null) {
            revealCmd = 0;
            var names = ["Reveal Properties with Animation", "Reveal Properties with Keyframes"];
            for (var n = 0; n < names.length && !revealCmd; n++) { try { revealCmd = app.findMenuCommandId(names[n]) || 0; } catch (e) {} }
        }
        if (!revealCmd || !layers.length) return false;
        try {
            var props = comp.selectedProperties;
            for (var i = props.length - 1; i >= 0; i--) { try { props[i].selected = false; } catch (e1) {} }
        } catch (e2) {}
        selectOnly(comp, layers); // the command works on the selected layers
        try { app.executeCommand(revealCmd); app.executeCommand(revealCmd); return true; } catch (e3) { return false; }
    }

    function rememberToClose(comp, layers, selectAfter) {
        var r = [], s = [], i;
        for (i = 0; i < layers.length; i++) r.push(layerRef(layers[i]));
        for (i = 0; i < selectAfter.length; i++) s.push(layerRef(selectAfter[i]));
        $.global.JWPAX_close = { compId: comp.id, layers: r, select: s };
    }

    function selectOnly(comp, layers) {
        var sel = comp.selectedLayers, i;
        for (i = 0; i < sel.length; i++) sel[i].selected = false;
        for (i = 0; i < layers.length; i++) layers[i].selected = true;
    }

    // Layer.applyPreset applies to every selected layer in the comp, so selecting all
    // the targets and calling it once is much faster than one call per layer.
    function applyToLayers(comp, layers, preset) {
        if (!layers.length) return;
        selectOnly(comp, layers);
        layers[0].applyPreset(preset);
    }

    function selectedLayers(comp) {
        var sel = comp.selectedLayers, out = [];
        for (var i = 0; i < sel.length; i++) out.push(sel[i]);
        return out;
    }

    function safeName(name) {
        var clean = name.replace(/[\\\/\:\*\?\"\<\>\|]/g, "_");
        return clean.length > 40 ? clean.substring(0, 40) : clean;
    }

    // The clip's file name without extension (falls back to the layer name).
    function sourceBaseName(layer) {
        try {
            var s = layer.source;
            if (s && s.file) return decodeURI(s.file.name).replace(/\.[^.]+$/, "");
            if (s && s.name) return s.name.replace(/\.[^.]+$/, "");
        } catch (e) {}
        return layer.name;
    }

    function getLayerSpan(layers) {
        var start = 999999, end = -999999;
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].inPoint < start) start = layers[i].inPoint;
            if (layers[i].outPoint > end) end = layers[i].outPoint;
        }
        return { start: start, end: end, duration: Math.max(end - start, 1 / 30) };
    }

    function findLayerUsingSource(comp, src) {
        for (var i = 1; i <= comp.numLayers; i++) {
            try { if (comp.layer(i).source === src) return comp.layer(i); } catch (e) {}
        }
        return null;
    }

    function trimCreatedPrecomp(newComp, originalComp, span) {
        if (!newComp || !span) return;
        // how far the clip's first visible frame sits from where the precomp layer starts:
        // "move all attributes" puts the precomp layer at 0, "leave attributes" at the clip's own startTime
        var nl = findLayerUsingSource(originalComp, newComp), outerStart = 0;
        try { if (nl) outerStart = nl.startTime; } catch (e0) {}
        var delta = span.start - outerStart;
        try { for (var i = 1; i <= newComp.numLayers; i++) newComp.layer(i).startTime -= delta; } catch (e) {}
        try { newComp.duration = span.duration; } catch (e2) {}
        if (nl) {
            try { nl.startTime = span.start; nl.inPoint = span.start; nl.outPoint = span.end; } catch (e3) {}
        }
    }

    // ---------------- Keyframe stretching ----------------
    // Snapshot key times before the preset; afterwards, keys that weren't there came from
    // the preset (effects AND the layer's own Transform props such as Opacity). Stretch
    // all of those together across the layer's in/out points.
    function walkProps(group, path, topMatch, fn) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { return; }
        for (var i = 1; i <= n; i++) {
            var p;
            try { p = group.property(i); } catch (e1) { continue; }
            if (!p) continue;
            var pth = path.concat([i]);
            var top = topMatch || p.matchName;
            if (p.propertyType === PropertyType.PROPERTY) {
                if (p.matchName === "ADBE Marker") continue;
                var nk = 0;
                try { nk = p.numKeys; } catch (e2) {}
                if (nk > 0) fn(p, pth, top);
            } else {
                walkProps(p, pth, top, fn);
            }
        }
    }

    // Walk a layer's keyed properties. Effects before effectStart are skipped entirely:
    // a preset adds new effects and never edits the ones already on the layer, so
    // scanning those is wasted time on layers with lots of effects.
    function walkLayer(layer, effectStart, fn) {
        var n = 0;
        try { n = layer.numProperties; } catch (e) { return; }
        for (var i = 1; i <= n; i++) {
            var g;
            try { g = layer.property(i); } catch (e1) { continue; }
            if (!g) continue;
            var mn = g.matchName;
            if (mn === "ADBE Marker") continue;
            if (mn === "ADBE Effect Parade") {
                for (var e = effectStart; e <= g.numProperties; e++) walkProps(g.property(e), [i, e], mn, fn);
            } else if (g.propertyType === PropertyType.PROPERTY) {
                var nk = 0;
                try { nk = g.numKeys; } catch (e2) {}
                if (nk > 0) fn(g, [i], mn);
            } else {
                walkProps(g, [i], mn, fn);
            }
        }
    }

    function snapshotLayer(layer) {
        var snap = {};
        walkLayer(layer, 999999, function (p, pth) {
            var times = [];
            for (var k = 1; k <= p.numKeys; k++) times.push(p.keyTime(k));
            snap[pth.join("/")] = times;
        });
        return snap;
    }

    function hadTime(list, t) {
        if (!list) return false;
        for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - t) < TIME_EPS) return true;
        return false;
    }

    function resolveProp(layer, pth) {
        var p = layer;
        for (var i = 0; i < pth.length; i++) { p = p.property(pth[i]); if (!p) return null; }
        return p;
    }

    function readKey(prop, i, preserve) {
        var k = { time: prop.keyTime(i), value: prop.keyValue(i) };
        if (preserve) {
            try { k.inInterp = prop.keyInInterpolationType(i); } catch (e) {}
            try { k.outInterp = prop.keyOutInterpolationType(i); } catch (e) {}
            try { k.inEase = prop.keyInTemporalEase(i); } catch (e) {}
            try { k.outEase = prop.keyOutTemporalEase(i); } catch (e) {}
            try { k.temporalContinuous = prop.keyTemporalContinuous(i); } catch (e) {}
            try { k.temporalAutoBezier = prop.keyTemporalAutoBezier(i); } catch (e) {}
            try { k.spatialContinuous = prop.keySpatialContinuous(i); } catch (e) {}
            try { k.spatialAutoBezier = prop.keySpatialAutoBezier(i); } catch (e) {}
            try { k.inSpatialTangent = prop.keyInSpatialTangent(i); } catch (e) {}
            try { k.outSpatialTangent = prop.keyOutSpatialTangent(i); } catch (e) {}
            try { k.roving = prop.keyRoving(i); } catch (e) {}
        }
        return k;
    }

    function scaleEase(arr, s) {
        var out = [];
        if (!arr) return out;
        for (var i = 0; i < arr.length; i++) {
            try { out.push(new KeyframeEase(arr[i].speed * s, arr[i].influence)); } catch (e) { out.push(arr[i]); }
        }
        return out;
    }

    // Restore a moved key's look. Order matters: writing temporal ease turns a key into a
    // Bezier key, so ease is only written for keys that were Bezier, and the original
    // interpolation (linear / hold / bezier) is applied last so it always wins.
    function writeKeyStyle(prop, idx, d, s, isEnd) {
        var B = KeyframeInterpolationType.BEZIER;
        var hasInterp = d.inInterp !== undefined && d.outInterp !== undefined;
        var anyBezier = hasInterp && (d.inInterp === B || d.outInterp === B);
        if (anyBezier) {
            try { if (d.inEase !== undefined && d.outEase !== undefined) prop.setTemporalEaseAtKey(idx, scaleEase(d.inEase, s), scaleEase(d.outEase, s)); } catch (e2) {}
            try { if (d.temporalContinuous !== undefined) prop.setTemporalContinuousAtKey(idx, d.temporalContinuous); } catch (e3) {}
            try { if (d.temporalAutoBezier !== undefined) prop.setTemporalAutoBezierAtKey(idx, d.temporalAutoBezier); } catch (e4) {}
        }
        try { if (hasInterp) prop.setInterpolationTypeAtKey(idx, d.inInterp, d.outInterp); } catch (e) {}
        try { if (d.spatialContinuous !== undefined) prop.setSpatialContinuousAtKey(idx, d.spatialContinuous); } catch (e5) {}
        try { if (d.spatialAutoBezier !== undefined) prop.setSpatialAutoBezierAtKey(idx, d.spatialAutoBezier); } catch (e6) {}
        try { if (d.inSpatialTangent !== undefined && d.outSpatialTangent !== undefined) prop.setSpatialTangentsAtKey(idx, d.inSpatialTangent, d.outSpatialTangent); } catch (e7) {}
        try { if (d.roving !== undefined && !isEnd) prop.setRovingAtKey(idx, d.roving); } catch (e8) {}
    }

    function stretchPresetKeys(layer, layerIn, layerOut, oldEffectCount, onlyNew, preserve, snap) {
        snap = snap || {};
        var jobs = [], j, k2;
        walkLayer(layer, onlyNew ? oldEffectCount + 1 : 1, function (p, pth, top) {
            var key = pth.join("/");
            var takeAll = (top === "ADBE Effect Parade"); // only new effects are walked when onlyNew is on
            var idx = [];
            for (var k = 1; k <= p.numKeys; k++) if (takeAll || !hadTime(snap[key], p.keyTime(k))) idx.push(k);
            if (idx.length) jobs.push({ path: pth, idx: idx });
        });
        if (!jobs.length) return 0;

        var gFirst = 999999, gLast = -999999;
        for (j = 0; j < jobs.length; j++) {
            var pj = resolveProp(layer, jobs[j].path);
            for (k2 = 0; k2 < jobs[j].idx.length; k2++) {
                var t = pj.keyTime(jobs[j].idx[k2]);
                if (t < gFirst) gFirst = t;
                if (t > gLast) gLast = t;
            }
        }
        var oldLen = gLast - gFirst, newLen = layerOut - layerIn;
        if (oldLen <= TIME_EPS || newLen <= 0) return 0;
        var speedScale = oldLen / newLen, moved = 0;

        for (j = 0; j < jobs.length; j++) {
            var prop = resolveProp(layer, jobs[j].path);
            if (!prop) continue;
            var idx = jobs[j].idx, data = [], times = [];
            for (k2 = 0; k2 < idx.length; k2++) data.push(readKey(prop, idx[k2], preserve));
            for (k2 = idx.length - 1; k2 >= 0; k2--) prop.removeKey(idx[k2]);
            // new times; two keys landing on the same time: the later one wins (as before)
            var batchT = [], batchV = [], at = {};
            for (k2 = 0; k2 < data.length; k2++) {
                var nt = layerIn + ((data[k2].time - gFirst) / oldLen) * newLen;
                nt = Math.min(layerOut, Math.max(layerIn, nt));
                times.push(nt);
                var slot = String(Math.round(nt / TIME_EPS));
                if (at[slot] === undefined) { at[slot] = batchT.length; batchT.push(nt); batchV.push(data[k2].value); }
                else batchV[at[slot]] = data[k2].value;
                moved++;
            }
            // one call per property instead of one per keyframe (much less work for AE)
            try { prop.setValuesAtTimes(batchT, batchV); }
            catch (eb) { for (k2 = 0; k2 < batchT.length; k2++) prop.setValueAtTime(batchT[k2], batchV[k2]); }
            if (preserve) {
                for (k2 = 0; k2 < data.length; k2++) {
                    var ki = prop.nearestKeyIndex(times[k2]);
                    writeKeyStyle(prop, ki, data[k2], speedScale, ki === 1 || ki === prop.numKeys);
                }
            }
        }
        return moved;
    }

    function setTwixtorInputFPS(layer, fps) {
        if (isNaN(fps) || fps <= 0) return false;
        var effects = layer.property("ADBE Effect Parade");
        if (!effects) return false;
        var changed = false;
        function scan(group) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p = group.property(i), name = "";
                try { name = p.name.toLowerCase(); } catch (e) {}
                if (p.propertyType === PropertyType.PROPERTY) {
                    var looks = (name.indexOf("input") !== -1 && name.indexOf("fps") !== -1) ||
                        (name.indexOf("input") !== -1 && name.indexOf("frame") !== -1) ||
                        name.indexOf("frame rate") !== -1 || name.indexOf("source fps") !== -1;
                    if (looks) { try { p.setValue(fps); changed = true; } catch (e2) {} }
                } else {
                    scan(p);
                }
            }
        }
        for (var e = 1; e <= effects.numProperties; e++) {
            var fx = effects.property(e), n = "", m = "";
            try { n = fx.name.toLowerCase(); } catch (er) {}
            try { m = fx.matchName.toLowerCase(); } catch (er2) {}
            if (n.indexOf("twixtor") !== -1 || m.indexOf("twixtor") !== -1) scan(fx);
        }
        return changed;
    }

    // ExtendScript reads "%xx" in a path as an escape: a preset named "50% zoom.ffx" would not be found
    function presetFile(p) { return new File(String(p).replace(/%/g, "%25")); }

    function checkInputs(o, needPreset) {
        if (needPreset && (!o.preset || !presetFile(o.preset).exists)) return "Pick a preset first.";
        var comp = activeComp();
        if (!comp) return "Open a comp first.";
        if (comp.selectedLayers.length === 0) return "Select layers first.";
        if (o.twixtor && (isNaN(o.fps) || o.fps <= 0)) return "Invalid FPS.";
        return "";
    }

    function placeTiming(layer, blackSolid, tIn, tOut) {
        layer.adjustmentLayer = !blackSolid;
        layer.startTime = blackSolid ? tIn : 0;
        layer.inPoint = tIn;
        layer.outPoint = tOut;
    }

    // ---------------- Public API ----------------
    var api = {};

    api.ping = function () { return ok({ version: app.version }); };

    api.getState = function () {
        return ok({
            favorites: loadFavorites(),
            theme: getSetting("themeName", "Blue Neon"),
            rainbow: getSetting("rainbowMode", "false") === "true",
            fast: getSetting("fastMode", "false") === "true",
            sets: getSetting("favoriteSets", "{}")
        });
    };

    api.saveSetting = function (o) { saveSetting(o.key, o.value); return ok(); };

    api.setFavorites = function (o) {
        saveSetting(KEY_RECENTS, (o.list || []).join("||"));
        return ok({ favorites: loadFavorites() });
    };

    api.addFavorite = function (o) { return ok({ favorites: addFavorite(o.path) }); };

    api.browse = function () {
        var f = File.openDialog("Select After Effects Preset (.ffx)", "*.ffx");
        if (!f) return ok({ path: "" });
        return ok({ path: f.fsName, favorites: addFavorite(f.fsName) });
    };

    api.selection = function () {
        var comp = activeComp();
        return ok({ comp: comp ? comp.name : "", count: comp ? comp.selectedLayers.length : 0 });
    };

    api.applyEffect = function (o) {
        var problem = checkInputs(o, true);
        if (problem) return fail(problem);
        var t0 = new Date().getTime(), tApply = 0, tAfter = 0;
        var comp = activeComp(), layers = selectedLayers(comp), preset = presetFile(o.preset), changed = 0;
        var presetB = null;
        if (o.presetB) {
            presetB = presetFile(o.presetB);
            if (!presetB.exists) return fail("The second preset for alternating is missing.");
        }
        app.beginUndoGroup("Apply Preset To Selected Layers");
        try {
            var oldCounts = [], snaps = [], i;
            for (i = 0; i < layers.length; i++) {
                var fx = layers[i].property("ADBE Effect Parade");
                oldCounts.push(fx ? fx.numProperties : 0);
                snaps.push(snapshotLayer(layers[i])); // also used by the intensity slider
            }
            rememberLastApplied(comp, layers, oldCounts);
            tApply = new Date().getTime();
            if (presetB) {
                // every other clip in time order: 1st, 3rd, 5th... get A; 2nd, 4th... get B
                var order = sortedByIn(layers), groupA = [], groupB = [];
                for (i = 0; i < order.length; i++) (i % 2 === 0 ? groupA : groupB).push(order[i]);
                applyToLayers(comp, groupA, preset);
                applyToLayers(comp, groupB, presetB);
            } else {
                applyToLayers(comp, layers, preset); // one call for every layer
            }
            tAfter = new Date().getTime();
            var lazy = [];
            for (i = 0; i < layers.length; i++) {
                var layer = layers[i];
                if (o.twixtor && setTwixtorInputFPS(layer, o.fps)) changed++;
                // Ctrl+Space: one layer -> keyframes start at the playhead (AE's own placement);
                // several layers -> stretched to each layer
                var stretchIt = o.quick ? layers.length > 1 : o.stretch;
                if (stretchIt) stretchPresetKeys(layer, layer.inPoint, layer.outPoint, oldCounts[i], o.onlyNew, o.preserve, snaps[i]);
                forceBlurMoReflect(layer);
                lazy.push({ layer: layerRef(layer), oldCount: oldCounts[i], snap: snaps[i] });
            }
            $.global.JWPAX_intensity = { compId: comp.id, lazy: lazy, entries: null, k: 1 };
            var tStretch = new Date().getTime();
            collapseApplied(comp, layers);
            selectOnly(comp, o.keepSel ? layers : []);
            // AE twirls the layers open only after this script returns, so the panel closes
            // them in a second call (api.closeLayers)
            if (o.closeLayers !== false) rememberToClose(comp, layers, o.keepSel ? layers : []);
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        // Ctrl+Space applies stay separate from the panel: nothing is added to its favorites
        var favs = o.noFavorite ? null : addFavorite(preset.fsName);
        if (presetB) favs = addFavorite(presetB.fsName);
        var tEnd = new Date().getTime();
        // how long each step took (ms), shown in the panel so slow steps are easy to spot
        var timing = { total: tEnd - t0, prep: tApply - t0, preset: tAfter - tApply, keys: tStretch - tAfter, tidy: tEnd - tStretch };
        return ok({ count: layers.length, twixtor: changed, favorites: favs, intensityProps: -1, alternated: !!presetB, timing: timing, closeLater: o.closeLayers !== false }); // -1: worked out when the slider is first used
    };

    // Second step of applying a preset: AE has now twirled the layers open, close them again
    // and put the selection back the way the apply left it.
    api.closeLayers = function () {
        var job = $.global.JWPAX_close;
        $.global.JWPAX_close = null;
        var comp = activeComp();
        if (!job || !comp || comp.id !== job.compId) return ok({ closed: 0 });
        var layers = [], sel = [], i, L;
        for (i = 0; i < job.layers.length; i++) { L = findLayer(comp, job.layers[i]); if (L) layers.push(L); }
        for (i = 0; i < job.select.length; i++) { L = findLayer(comp, job.select[i]); if (L) sel.push(L); }
        var done = closeTwirls(comp, layers);
        collapseApplied(comp, layers);
        selectOnly(comp, sel);
        return ok({ closed: done ? layers.length : 0 });
    };

    api.precompose = function (o) {
        var problem = checkInputs(o, false);
        if (problem) return fail(problem);
        var comp = activeComp(), layers = selectedLayers(comp), created = [];
        var prefix = o.name || "Precomp", moveAll = o.moveAll || o.together;
        app.beginUndoGroup("Precompose Selected Layers");
        try {
            if (o.together) {
                var idx = [], span = getLayerSpan(layers);
                for (var t = 0; t < layers.length; t++) idx.push(layers[t].index);
                idx.sort(function (a, b) { return a - b; });
                var nc = comp.layers.precompose(idx, prefix + "_Group", true);
                if (o.trim) trimCreatedPrecomp(nc, comp, span);
                created.push(nc);
            } else {
                // Smart names: "Prefix 03 - clipname", numbered in time order
                // (keyed by layer index: precomposing from the bottom up keeps the others' indexes)
                var nameByIndex = {}, order = sortedByIn(layers);
                for (var n = 0; n < order.length; n++) {
                    var nm = prefix + "_" + safeName(order[n].name);
                    if (o.smartNames) nm = prefix + " " + (n + 1 < 10 ? "0" : "") + (n + 1) + " - " + safeName(sourceBaseName(order[n]));
                    nameByIndex[order[n].index] = nm;
                }
                layers.sort(function (a, b) { return b.index - a.index; });
                for (var p = 0; p < layers.length; p++) {
                    var sp = getLayerSpan([layers[p]]);
                    var np = comp.layers.precompose([layers[p].index], nameByIndex[layers[p].index], moveAll);
                    if (o.trim) trimCreatedPrecomp(np, comp, sp);
                    created.push(np);
                }
            }
            var newLayers = [];
            for (var c = 0; c < created.length; c++) {
                var nl = findLayerUsingSource(comp, created[c]);
                if (nl) newLayers.push(nl);
            }
            if (o.labels && o.labels.length) applyLabels(newLayers, o.labels, o.labelStart || 0);
            selectOnly(comp, o.keepSel ? newLayers : []);
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ count: created.length, forcedMoveAll: o.together && !o.moveAll });
    };

    api.adjust = function (o) {
        var problem = checkInputs(o, true);
        if (problem) return fail(problem);
        var comp = activeComp(), layers = selectedLayers(comp), preset = presetFile(o.preset);
        var created = [], changed = 0, black = !!o.blackSolid;
        app.beginUndoGroup("Create Adjustment Layers And Apply Preset");
        try {
            // One solid per clip, or (single mode) one solid spanning every selected clip.
            var targets = [], i;
            if (o.single) {
                var span = getLayerSpan(layers), top = layers[0];
                for (i = 1; i < layers.length; i++) if (layers[i].index < top.index) top = layers[i];
                targets.push({ above: top, tIn: span.start, tOut: span.end, label: "All Selected" });
            } else {
                for (i = 0; i < layers.length; i++) targets.push({ above: layers[i], tIn: layers[i].inPoint, tOut: layers[i].outPoint, label: layers[i].name });
            }
            // Create every solid first, then apply the preset to all of them in one call.
            var spans = [], solid = null;
            for (i = 0; i < targets.length; i++) {
                var tg = targets[i], tIn = tg.tIn, tOut = tg.tOut, a;
                var nm = (black ? "Black Solid" : (o.name || "Preset Adjustment")) + " - " + tg.label;
                if (!solid) {
                    a = comp.layers.addSolid(black ? [0, 0, 0] : [1, 1, 1], nm, comp.width, comp.height, comp.pixelAspect, comp.duration);
                    solid = a.source;
                } else {
                    a = comp.layers.add(solid, comp.duration);
                    try { a.name = nm; } catch (en) {}
                }
                placeTiming(a, black, tIn, tOut);
                try { a.moveBefore(tg.above); } catch (e0) {}
                created.push(a);
                spans.push([tIn, tOut]);
            }
            // fresh solids have no keys or effects, so there is nothing to snapshot
            applyToLayers(comp, created, preset);
            for (i = 0; i < created.length; i++) {
                var adj = created[i], s0 = spans[i][0], s1 = spans[i][1];
                placeTiming(adj, black, s0, s1);
                if (o.twixtor && setTwixtorInputFPS(adj, o.fps)) changed++;
                if (o.stretch) stretchPresetKeys(adj, s0, s1, 0, true, o.preserve, {});
                forceBlurMoReflect(adj);
                placeTiming(adj, black, s0, s1);
            }
            if (o.labels && o.labels.length) applyLabels(created, o.labels, o.labelStart || 0);
            var finalSel = o.selectNew ? created : (o.keepSel ? layers : []);
            selectOnly(comp, finalSel);
            if (o.closeLayers !== false) rememberToClose(comp, created, finalSel);
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ count: created.length, blackSolid: black, twixtor: changed, favorites: addFavorite(preset.fsName), closeLater: o.closeLayers !== false });
    };

    // ---------------- Ease (curve editor) ----------------
    // A curve is a cubic-bezier [x1, y1, x2, y2] over one segment between two keys
    // (time and value both 0..1). AE stores easing per key as influence (%) and speed, so:
    //   out-ease of the first key:  influence = x1 * 100,       speed = (y1 / x1) * average speed
    //   in-ease of the second key:  influence = (1 - x2) * 100, speed = ((1 - y2) / (1 - x2)) * average speed
    // where average speed = value change / time. Spatial properties (Position) use the distance moved.
    // Which segments to ease, per property:
    //   two or more selected keys  -> every segment between the first and the last selected key
    //   one selected key           -> the segment leaving it (or the one arriving, if it's the last key)
    // Properties are found on the selected layers too, so it still works when only keys are selected.
    function easeSegments(comp) {
        var props = [], seen = [], sel = [];
        try { sel = comp.selectedProperties; } catch (e0) {}
        function consider(p) {
            if (!p || p.propertyType !== PropertyType.PROPERTY) return;
            for (var s = 0; s < seen.length; s++) if (seen[s] === p) return;
            seen.push(p);
            var keys = [];
            try { keys = p.selectedKeys; } catch (e) {}
            if (!keys || !keys.length || p.numKeys < 2) return;
            keys = keys.slice(0);
            keys.sort(function (a, b) { return a - b; });
            var first = keys[0], last = keys[keys.length - 1], segs = [];
            if (keys.length === 1) {
                if (first < p.numKeys) segs.push(first);
                else segs.push(first - 1);
            } else {
                for (var k = first; k < last; k++) segs.push(k);
            }
            if (segs.length) props.push({ prop: p, segs: segs });
        }
        function walk(group, depth) {
            if (depth > 12) return;
            for (var i = 1; i <= group.numProperties; i++) {
                var q = group.property(i);
                if (!q) continue;
                if (q.propertyType === PropertyType.PROPERTY) { if (q.numKeys > 1) consider(q); }
                else walk(q, depth + 1);
            }
        }
        for (var i = 0; i < sel.length; i++) consider(sel[i]);
        if (!props.length) {
            var layers = comp.selectedLayers;
            for (var j = 0; j < layers.length; j++) walk(layers[j], 0);
        }
        return props;
    }

    function segDeltas(p, k) {
        var v1 = p.keyValue(k), v2 = p.keyValue(k + 1), dt = p.keyTime(k + 1) - p.keyTime(k);
        var T = PropertyValueType, spatial = p.propertyValueType === T.TwoD_SPATIAL || p.propertyValueType === T.ThreeD_SPATIAL;
        if (spatial) {
            // speed along a motion path is distance along the path, which curves between keys
            // (AE's default), so measure the path itself, not the straight line between the keys
            var t1 = p.keyTime(k), len = 0, prev = v1, STEPS = 64;
            for (var s = 1; s <= STEPS; s++) {
                var cur = s === STEPS ? v2 : p.valueAtTime(t1 + dt * s / STEPS, true);
                var d = 0;
                for (var i = 0; i < v1.length; i++) d += (cur[i] - prev[i]) * (cur[i] - prev[i]);
                len += Math.sqrt(d);
                prev = cur;
            }
            return { dt: dt, dv: [len] };
        }
        if (v1 instanceof Array) {
            var out = [];
            for (var j = 0; j < v1.length; j++) out.push(v2[j] - v1[j]);
            return { dt: dt, dv: out };
        }
        return { dt: dt, dv: [v2 - v1] };
    }

    function clampInf(x) { return Math.max(0.1, Math.min(100, x)); }

    api.easeApply = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var c = o.curve, x1 = Math.max(0, Math.min(1, c[0])), y1 = c[1], x2 = Math.max(0, Math.min(1, c[2])), y2 = c[3];
        var list = easeSegments(comp);
        if (!list.length) return fail("No keyframes selected · click the keyframes you want to ease in the timeline, then Apply.");
        // dir: "out" eases only where each segment starts, "in" only where it ends, anything else both
        var doOut = o.dir !== "in", doIn = o.dir !== "out";
        var B = KeyframeInterpolationType.BEZIER, segCount = 0, propCount = 0;
        app.beginUndoGroup("Apply Ease Curve");
        try {
            for (var i = 0; i < list.length; i++) {
                var p = list[i].prop, okProp = false;
                for (var s = 0; s < list[i].segs.length; s++) {
                    var k = list[i].segs[s], d = segDeltas(p, k);
                    if (d.dt <= 0) continue;
                    var outE = [], inE = [];
                    for (var j = 0; j < d.dv.length; j++) {
                        var avg = d.dv[j] / d.dt;
                        // AE's smallest influence is 0.1%. A handle at the very edge (x1 = 0 or x2 = 1)
                        // means a near-vertical start/end: keep that steepness with the matching speed
                        // (speed 0 there would turn a sharp curve into a soft one)
                        var w1 = Math.max(x1, 0.001), w2 = Math.max(1 - x2, 0.001);
                        outE.push(new KeyframeEase((y1 / w1) * avg, clampInf(w1 * 100)));
                        inE.push(new KeyframeEase(((1 - y2) / w2) * avg, clampInf(w2 * 100)));
                    }
                    // keep the other side of each key as it was
                    var keepIn = p.keyInTemporalEase(k), keepOut = p.keyOutTemporalEase(k + 1);
                    if (keepIn.length !== outE.length) keepIn = outE;
                    if (keepOut.length !== inE.length) keepOut = inE;
                    if (doOut) {
                        try { p.setTemporalContinuousAtKey(k, false); } catch (e0) {}
                        try { p.setTemporalAutoBezierAtKey(k, false); } catch (e1) {}
                        p.setInterpolationTypeAtKey(k, p.keyInInterpolationType(k), B);
                        p.setTemporalEaseAtKey(k, keepIn, outE);
                    }
                    if (doIn) {
                        try { p.setTemporalContinuousAtKey(k + 1, false); } catch (e2) {}
                        try { p.setTemporalAutoBezierAtKey(k + 1, false); } catch (e3) {}
                        p.setInterpolationTypeAtKey(k + 1, B, p.keyOutInterpolationType(k + 1));
                        p.setTemporalEaseAtKey(k + 1, inE, keepOut);
                    }
                    segCount++; okProp = true;
                }
                if (okProp) propCount++;
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ segments: segCount, props: propCount });
    };

    // Turn the first selected segment's easing back into a curve.
    api.easeRead = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var list = easeSegments(comp);
        if (!list.length) return fail("Select two keyframes to read their curve.");
        var p = list[0].prop, k = list[0].segs[0], d = segDeltas(p, k);
        var o = p.keyOutTemporalEase(k)[0], n = p.keyInTemporalEase(k + 1)[0];
        var avg = d.dt > 0 ? d.dv[0] / d.dt : 0;
        var x1 = o.influence / 100, x2 = 1 - n.influence / 100;
        var linearOut = p.keyOutInterpolationType(k) === KeyframeInterpolationType.LINEAR;
        var linearIn = p.keyInInterpolationType(k + 1) === KeyframeInterpolationType.LINEAR;
        var y1 = linearOut || !avg ? x1 : (o.speed / avg) * x1;
        var y2 = linearIn || !avg ? x2 : 1 - (n.speed / avg) * (1 - x2);
        return ok({ curve: [x1, y1, x2, y2], prop: p.name });
    };

    // Native file dialogs for the panel (open / save one file).
    api.pickFile = function (o) {
        var f = File.openDialog(o.title || "Choose a file", o.filter || "*.*");
        return ok({ path: f ? f.fsName : "" });
    };
    api.saveFile = function (o) {
        var start = new File(Folder.myDocuments.fsName + "/" + (o.name || "export.txt"));
        var f = start.saveDlg(o.title || "Save as", o.filter || "*.*");
        return ok({ path: f ? f.fsName : "" });
    };

    // ---------------- Label colors ----------------
    // Reads the user's label colors/names if they customised them (otherwise the panel uses
    // After Effects' defaults).
    api.labelColors = function () {
        var out = [];
        for (var i = 1; i <= 16; i++) {
            var o = { id: i, name: "", hex: "" };
            try { o.name = app.preferences.getPrefAsString("Label Preference Text Section 7", "Label Text ID 2 # " + i, PREFType.PREF_Type_MACHINE_INDEPENDENT); } catch (e) {}
            try { o.hex = app.preferences.getPrefAsString("Label Preference Color Section 5", "Label Color ID 2 # " + i, PREFType.PREF_Type_MACHINE_INDEPENDENT); } catch (e1) {}
            out.push(o);
        }
        return ok({ labels: out });
    };

    // Give layers label colors in time order: labels[i % labels.length] for the i-th layer.
    // Precomp layers also recolor their comp in the Project panel.
    function applyLabels(layers, labels, start) {
        if (!labels || !labels.length) return 0;
        var list = sortedByIn(layers), n = 0;
        for (var i = 0; i < list.length; i++) {
            var lab = labels[(i + (start || 0)) % labels.length];
            try { list[i].label = lab; n++; } catch (e) {}
            try { if (list[i].source instanceof CompItem) list[i].source.label = lab; } catch (e1) {}
        }
        return n;
    }

    api.setLabels = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (!layers.length) return fail("Select layers first.");
        app.beginUndoGroup(o.labels && o.labels.length > 1 ? "Rainbow Labels" : "Set Label Color");
        var n = 0;
        try { n = applyLabels(layers, o.labels, 0); } catch (e) { app.endUndoGroup(); return fail(errText(e)); }
        app.endUndoGroup();
        return ok({ count: n });
    };

    // ---------------- Layer Library (logic lives in library.jsx) ----------------
    api.layersSave = function (o) {
        if (typeof JWLIB === "undefined") return fail("Layer library script isn't loaded · reload the panel.");
        var r = JWLIB.save(o);
        if (r.error) return fail(r.error);
        return ok({ preset: r.preset });
    };

    api.layersInsert = function (o) {
        if (typeof JWLIB === "undefined") return fail("Layer library script isn't loaded · reload the panel.");
        var r = JWLIB.insert(o.preset, o);
        if (r.error) return fail(r.error);
        // presets that use BlurMoCurves get the same Reflect rule as Apply Preset
        try { var comp = activeComp(), sel = comp.selectedLayers; for (var i = 0; i < sel.length; i++) forceBlurMoReflect(sel[i]); } catch (e) {}
        return ok(r.stats);
    };

    // ---------------- Sapphire BlurMoCurves: always Reflect ----------------
    // Wrap X / Wrap Y menus are No (1) / Tile (2) / Reflect (3) per Sapphire's docs.
    // Applied after every preset, whatever the preset itself had.
    var REFLECT = 3;
    function forceBlurMoReflect(layer) {
        var fx = null, changed = 0;
        try { fx = layer.property("ADBE Effect Parade"); } catch (e) {}
        if (!fx) return 0;
        for (var i = 1; i <= fx.numProperties; i++) {
            var ef = fx.property(i), id = "";
            try { id = ef.matchName + " " + ef.name; } catch (e1) {}
            if (!/blur\s*mo\s*curves/i.test(id)) continue;
            // matches "Wrap X" / "X Wrap", or X / Y inside a group called "Wrap"
            (function scan(g, inWrap) {
                for (var j = 1; j <= g.numProperties; j++) {
                    var p = g.property(j);
                    if (!p) continue;
                    var nm = "";
                    try { nm = String(p.name).replace(/^\s+|\s+$/g, ""); } catch (e2) {}
                    if (p.propertyType !== PropertyType.PROPERTY) { scan(p, /wrap/i.test(nm)); continue; }
                    var isWrap = /wrap\s*[xy]\b/i.test(nm) || /\b[xy]\s*wrap/i.test(nm) || (inWrap && /^[xy]$/i.test(nm));
                    if (!isWrap || p.propertyValueType !== PropertyValueType.OneD) continue;
                    try {
                        try { if (p.expression) p.expressionEnabled = false; } catch (e3) {}
                        while (p.numKeys > 0) p.removeKey(1);
                        if (p.value !== REFLECT) { p.setValue(REFLECT); changed++; }
                    } catch (e4) {}
                }
            })(ef, false);
        }
        return changed;
    }

    // ---------------- Effect tools ----------------
    function layerKey(comp, layer) {
        try { if (layer.id) return "id" + layer.id; } catch (e) {}
        return comp.id + ":" + layer.name;
    }

    // Remembers how many effects each layer had before the last Apply Preset,
    // so "Remove last preset" can take off exactly what it added.
    function rememberLastApplied(comp, layers, oldCounts) {
        var m = { compId: comp.id, layers: {} };
        for (var i = 0; i < layers.length; i++) m.layers[layerKey(comp, layers[i])] = oldCounts[i];
        $.global.JWPAX_lastApplied = m;
    }

    api.stripEffects = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (!layers.length) return fail("Select layers first.");
        var last = $.global.JWPAX_lastApplied;
        if (o.mode === "last" && (!last || last.compId !== comp.id)) return fail("Nothing to remove \u00B7 apply a preset in this comp first.");

        var removed = 0, touched = 0, skipped = 0;
        app.beginUndoGroup(o.mode === "last" ? "Remove Last Preset" : "Remove All Effects");
        try {
            for (var i = 0; i < layers.length; i++) {
                var fx = layers[i].property("ADBE Effect Parade");
                if (!fx) continue;
                var keepCount = 0;
                if (o.mode === "last") {
                    var k = layerKey(comp, layers[i]);
                    if (!last.layers.hasOwnProperty(k)) { skipped++; continue; }
                    keepCount = last.layers[k];
                }
                var before = fx.numProperties;
                for (var e = fx.numProperties; e > keepCount; e--) fx.property(e).remove();
                if (before > fx.numProperties) { removed += before - fx.numProperties; touched++; }
            }
        } catch (err) {
            app.endUndoGroup();
            return fail(errText(err));
        }
        app.endUndoGroup();
        if (o.mode === "last") $.global.JWPAX_lastApplied = null;
        return ok({ removed: removed, layers: touched, skipped: skipped });
    };

    // Copy one property tree onto an identical one, remapping key times with mapT.
    function copyProps(src, dst, mapT, speedScale) {
        for (var i = 1; i <= src.numProperties; i++) {
            var s, d;
            try { s = src.property(i); d = dst.property(i); } catch (e) { continue; }
            if (!s || !d) continue;
            if (s.propertyType !== PropertyType.PROPERTY) {
                try { d.enabled = s.enabled; } catch (e0) {}
                copyProps(s, d, mapT, speedScale);
                continue;
            }
            if (s.propertyValueType === PropertyValueType.NO_VALUE) continue;
            try {
                if (s.numKeys > 0) {
                    var data = [], k;
                    for (k = 1; k <= s.numKeys; k++) data.push(readKey(s, k, true));
                    while (d.numKeys > 0) d.removeKey(1);
                    var times = [];
                    for (k = 0; k < data.length; k++) { times.push(mapT(data[k].time)); d.setValueAtTime(times[k], data[k].value); }
                    for (k = 0; k < data.length; k++) {
                        var ki = d.nearestKeyIndex(times[k]);
                        writeKeyStyle(d, ki, data[k], speedScale, ki === 1 || ki === d.numKeys);
                    }
                } else {
                    d.setValue(s.value);
                }
            } catch (e1) {}
            try { if (s.expression) { d.expression = s.expression; d.expressionEnabled = s.expressionEnabled; } } catch (e2) {}
        }
    }

    // ---------------- Turbo AE ----------------
    // Speed settings that never change how anything looks:
    //   - this project renders on the graphics card (CUDA) instead of the CPU only
    //   - Multi-Frame Rendering on, using every CPU core (nothing held back)
    //   - cache frames while idle, disk cache on, GPU-accelerated viewers
    // The values from before are kept in AE's settings, so turning it off restores them exactly.
    var TURBO_PREFS = [
        ["Concurrent Frame Rendering", "Enable Concurrent Frame Renders", "bool", true],
        ["Concurrent Frame Rendering", "Number of Concurrent Frame Renders", "str", "-1"],
        ["Concurrent Frame Rendering", "Reserved CPU Power", "str", "10"],  // keep AE's 10% headroom so the PC never maxes out
        ["General Section", "Allow Idle Application Rendering", "bool", true],
        ["Disk Cache Controls", "Enabled 2", "str", "1"],
        ["Hardware Accelerated Viewers v2 (8bpc)", "Enable Always", "bool", true],
        ["Hardware Accelerated Viewers v2 (16bpc)", "Enable Always", "bool", true],
        ["Hardware Accelerated Viewers v2 (32bpc)", "Enable Always", "bool", true]
    ];
    var PT = function () { return PREFType.PREF_Type_MACHINE_SPECIFIC; };

    function readPref(p) {
        try {
            if (!app.preferences.havePref(p[0], p[1], PT())) return null;
            return p[2] === "bool" ? (app.preferences.getPrefAsBool(p[0], p[1], PT()) ? "1" : "0") : app.preferences.getPrefAsString(p[0], p[1], PT());
        } catch (e) { return null; }
    }
    function writePref(p, v) {
        try {
            if (p[2] === "bool") app.preferences.savePrefAsBool(p[0], p[1], v === true || v === "1", PT());
            else app.preferences.savePrefAsString(p[0], p[1], String(v), PT());
            return true;
        } catch (e) { return false; }
    }
    function gpuName(t) {
        if (typeof GpuAccelType === "undefined") return "?";
        if (t === GpuAccelType.CUDA) return "CUDA";
        if (t === GpuAccelType.SOFTWARE) return "CPU only";
        return String(t);
    }

    api.turbo = function (o) {
        var KEY = "turboBackup", notes = [], changed = 0;
        if (o.on) {
            // remember what was there (only the first time, so a second "on" can't overwrite it)
            if (!app.settings.haveSetting("JWPA", KEY) || app.settings.getSetting("JWPA", KEY) === "") {
                var bak = [];
                for (var i = 0; i < TURBO_PREFS.length; i++) { var v = readPref(TURBO_PREFS[i]); bak.push(v === null ? "~" : v); }
                app.settings.saveSetting("JWPA", KEY, bak.join("\u0001"));
            }
            for (var j = 0; j < TURBO_PREFS.length; j++) {
                var cur = readPref(TURBO_PREFS[j]), want = TURBO_PREFS[j][3];
                var wantStr = typeof want === "boolean" ? (want ? "1" : "0") : want;
                if (cur !== wantStr && writePref(TURBO_PREFS[j], want)) changed++;
            }
        } else if (app.settings.haveSetting("JWPA", KEY) && app.settings.getSetting("JWPA", KEY) !== "") {
            var old = app.settings.getSetting("JWPA", KEY).split("\u0001");
            for (var k = 0; k < TURBO_PREFS.length && k < old.length; k++) if (old[k] !== "~" && writePref(TURBO_PREFS[k], old[k])) changed++;
            try { app.settings.saveSetting("JWPA", KEY, ""); } catch (e1) {}
        }
        try { app.preferences.saveToDisk(); } catch (e2) {}

        // this project's renderer (only switched while Turbo is on; projects keep their own setting)
        var gpu = "?";
        try {
            gpu = gpuName(app.project.gpuAccelType);
            if (o.on && app.project && typeof GpuAccelType !== "undefined" && app.project.gpuAccelType === GpuAccelType.SOFTWARE) {
                var avail = app.availableGPUAccelTypes || [], cuda = false;
                for (var a = 0; a < avail.length; a++) if (avail[a] === GpuAccelType.CUDA) cuda = true;
                if (cuda) { app.project.gpuAccelType = GpuAccelType.CUDA; notes.push("this project now renders on the graphics card (was CPU only)"); gpu = "CUDA"; }
            }
        } catch (e3) {}
        return ok({ changed: changed, gpu: gpu, notes: notes });
    };

    api.turboGpu = function () {
        try {
            if (typeof GpuAccelType === "undefined" || app.project.gpuAccelType !== GpuAccelType.SOFTWARE) return ok({ switched: false });
            var avail = app.availableGPUAccelTypes || [];
            for (var a = 0; a < avail.length; a++) if (avail[a] === GpuAccelType.CUDA) { app.project.gpuAccelType = GpuAccelType.CUDA; return ok({ switched: true }); }
        } catch (e) {}
        return ok({ switched: false });
    };

    // ---------------- Fix BCC Ripple Dissolve white flash ----------------
    // Duplicated BCC Ripple Dissolve effects can flash white. Each one on the selected layers
    // (or every layer when nothing is selected) is rebuilt fresh with the same settings and
    // keyframes, and a "Layer to Reveal" that points at itself or at a layer that isn't there
    // during the transition is set to None. One undo step.
    var RIPPLE_RE = /Ripple Dissolve/i, REVEAL_ID = "BCC Ripple Dissolve-7405631";

    function revealOk(layer, idx) {
        if (!idx) return true;
        var comp = layer.containingComp;
        if (idx < 1 || idx > comp.numLayers) return false;
        var other = comp.layer(idx);
        if (other === layer) return false;
        return other.inPoint <= layer.inPoint + 0.001 && other.outPoint >= layer.outPoint - 0.001;
    }

    api.fixRipple = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp), i;
        if (!layers.length) for (i = 1; i <= comp.numLayers; i++) layers.push(comp.layer(i));
        var rebuilt = 0, reveals = 0, touched = 0;
        app.beginUndoGroup("Fix Ripple Dissolve Flash");
        try {
            for (i = 0; i < layers.length; i++) {
                var fx = layers[i].property("ADBE Effect Parade");
                if (!fx) continue;
                var hit = false;
                for (var e = 1; e <= fx.numProperties; e++) {
                    var old = fx.property(e);
                    if (!RIPPLE_RE.test(old.matchName)) continue;
                    var mn = old.matchName, nm = old.name, on = old.enabled;
                    if (!fx.canAddProperty(mn)) continue;
                    var fresh = fx.addProperty(mn);
                    old = fx.property(e); // adding can refresh references
                    copyProps(old, fresh, function (t) { return t; }, 1);
                    try { fresh.name = nm; } catch (e1) {}
                    try { fresh.enabled = on; } catch (e2) {}
                    fresh.moveTo(e);
                    fx.property(e + 1).remove();
                    fresh = fx.property(e);
                    var rv = null;
                    try { rv = fresh.property(REVEAL_ID); } catch (e3) {}
                    if (rv && rv.numKeys === 0 && !revealOk(layers[i], rv.value)) { try { rv.setValue(0); reveals++; } catch (e4) {} }
                    rebuilt++; hit = true;
                }
                if (hit) touched++;
            }
        } catch (err) {
            app.endUndoGroup();
            return fail(errText(err));
        }
        app.endUndoGroup();
        if (!rebuilt) return fail("No BCC Ripple Dissolve on " + (selectedLayers(comp).length ? "the selected layers" : "this comp") + ".");
        return ok({ rebuilt: rebuilt, layers: touched, reveals: reveals });
    };

    // ---------------- Quick Search (Ctrl+Space) ----------------
    // Every installed effect, for the search list (read-only).
    api.listEffects = function () {
        var out = [], fx = app.effects;
        for (var i = 0; i < fx.length; i++) {
            var e = fx[i];
            if (!e.category || /obsolete/i.test(e.category) || !e.displayName) continue;
            out.push({ n: e.displayName, m: e.matchName, c: e.category });
        }
        return ok({ effects: out });
    };

    // Adds one effect to every selected layer (like FX Console).
    api.addEffect = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp), n = 0, last = null;
        if (!layers.length) return fail("Select a layer to add " + (o.name || "the effect") + " to.");
        app.beginUndoGroup("Add " + (o.name || "Effect"));
        try {
            for (var i = 0; i < layers.length; i++) {
                var fx = layers[i].property("ADBE Effect Parade");
                if (!fx || !fx.canAddProperty(o.matchName)) continue;
                last = fx.addProperty(o.matchName);
                forceBlurMoReflect(layers[i]);
                n++;
            }
        } catch (e) { app.endUndoGroup(); return fail(errText(e)); }
        app.endUndoGroup();
        if (!n) return fail((o.name || "That effect") + " can't go on the selected layer(s).");
        return ok({ count: n });
    };

    // Step 1 of copying effects: remember the source layer (the first one you selected).
    api.copySource = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (!layers.length) return fail("Select the layer to copy effects from.");
        var src = layers[0], fx = src.property("ADBE Effect Parade");
        if (!fx || !fx.numProperties) return fail(src.name + " has no effects to copy.");
        var lid = -1;
        try { lid = src.id; } catch (e) {}
        return ok({ compId: comp.id, layerId: lid, index: src.index, name: src.name, effects: fx.numProperties, more: layers.length > 1 });
    };

    function findSource(o) {
        var c = null;
        try { c = app.project.itemByID(o.compId); } catch (e) {}
        if (!(c instanceof CompItem)) return null;
        for (var i = 1; i <= c.numLayers; i++) {
            var L = c.layer(i), lid = -2;
            try { lid = L.id; } catch (e1) {}
            if (o.layerId >= 0 && lid === o.layerId) return L;
        }
        // older After Effects without layer ids: same spot and name
        if (o.index >= 1 && o.index <= c.numLayers && c.layer(o.index).name === o.name) return c.layer(o.index);
        return null;
    }

    api.copyEffects = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp), src = null;
        if (o.source) {
            src = findSource(o.source);
            if (!src) return fail("The source layer (" + o.source.name + ") is gone · pick it again.");
        } else {
            // no remembered source: the first layer you selected is the source
            if (layers.length < 2) return fail("Select the source layer first, then the layers to copy to.");
            src = layers[0];
        }
        var targets = [];
        for (var q = 0; q < layers.length; q++) if (layers[q] !== src) targets.push(layers[q]);
        if (!targets.length) return fail("Now select the layers to paste " + src.name + "'s effects onto.");
        layers = [src].concat(targets);
        var sfx = src.property("ADBE Effect Parade");
        if (!sfx || !sfx.numProperties) return fail(src.name + " has no effects to copy.");

        var copied = 0, failedFx = [];
        app.beginUndoGroup("Copy Effects To Layers");
        try {
            for (var t = 0; t < layers.length; t++) {
                var dst = layers[t];
                if (dst === src) continue;
                var dfx = dst.property("ADBE Effect Parade");
                if (!dfx) continue;
                if (o.replace) while (dfx.numProperties > 0) dfx.property(dfx.numProperties).remove();

                var sLen = src.outPoint - src.inPoint, dLen = dst.outPoint - dst.inPoint;
                var stretch = o.stretch && sLen > 0 && dLen > 0;
                var mapT = stretch
                    ? function (tt) { return dst.inPoint + (tt - src.inPoint) / sLen * dLen; }
                    : function (tt) { return tt - src.inPoint + dst.inPoint; };
                var speedScale = stretch ? sLen / dLen : 1;

                for (var e = 1; e <= sfx.numProperties; e++) {
                    var se = sfx.property(e);
                    try {
                        var ne = dfx.addProperty(se.matchName);
                        try { ne.name = se.name; } catch (en) {}
                        try { ne.enabled = se.enabled; } catch (ee) {}
                        copyProps(se, ne, mapT, speedScale);
                        forceBlurMoReflect(dst);
                        copied++;
                    } catch (ex) {
                        if (failedFx.join("|").indexOf(se.name) < 0) failedFx.push(se.name);
                    }
                }
            }
        } catch (err) {
            app.endUndoGroup();
            return fail(errText(err));
        }
        app.endUndoGroup();
        return ok({ source: src.name, targets: layers.length - 1, effects: copied, failed: failedFx });
    };

    // ---------------- Preset intensity ----------------
    // After Apply Preset we keep the original value of every key the preset added.
    // The slider then scales each key's distance from the property's first key:
    // 100% = as the preset made it, 50% = half as strong, 150% = stronger.
    var NUMERIC_TYPES = null;
    function isScalable(p) {
        if (!NUMERIC_TYPES) {
            NUMERIC_TYPES = {};
            var T = PropertyValueType;
            NUMERIC_TYPES[T.OneD] = 1; NUMERIC_TYPES[T.TwoD] = 1; NUMERIC_TYPES[T.ThreeD] = 1;
            NUMERIC_TYPES[T.TwoD_SPATIAL] = 1; NUMERIC_TYPES[T.ThreeD_SPATIAL] = 1;
        }
        try { return NUMERIC_TYPES[p.propertyValueType] === 1; } catch (e) { return false; }
    }

    function layerRef(layer) {
        var r = { index: layer.index, name: layer.name, id: null };
        try { r.id = layer.id; } catch (e) {}
        return r;
    }

    function findLayer(comp, ref) {
        if (ref.id) { try { var l = app.project.layerByID(ref.id); if (l) return l; } catch (e) {} }
        if (ref.index <= comp.numLayers && comp.layer(ref.index).name === ref.name) return comp.layer(ref.index);
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === ref.name) return comp.layer(i);
        return null;
    }

    function collectIntensity(comp, layer, oldCount, snap, out) {
        walkLayer(layer, oldCount + 1, function (p, pth, top) {
            if (!isScalable(p) || p.numKeys < 2) return;
            var key = pth.join("/"), keys = [];
            for (var k = 1; k <= p.numKeys; k++) {
                var t = p.keyTime(k);
                if (top === "ADBE Effect Parade" || !hadTime(snap[key], t)) keys.push({ t: t, v: p.keyValue(k) });
            }
            if (keys.length >= 2) out.push({ layer: layerRef(layer), path: pth, keys: keys });
        });
    }

    function scaleValue(v, base, k) {
        if (v instanceof Array) {
            var r = [];
            for (var i = 0; i < v.length; i++) r.push(base[i] + (v[i] - base[i]) * k);
            return r;
        }
        return base + (v - base) * k;
    }

    api.setIntensity = function (o) {
        var rec = $.global.JWPAX_intensity;
        if (!rec) return fail("Apply a preset first \u00B7 the slider works on the last Apply Preset.");
        var comp = null;
        try { comp = app.project.itemByID(rec.compId); } catch (e) {}
        if (!(comp instanceof CompItem)) return fail("The comp from the last Apply Preset is gone.");
        if (!rec.entries) {
            rec.entries = [];
            for (var q = 0; q < (rec.lazy || []).length; q++) {
                var lz = rec.lazy[q], ly = findLayer(comp, lz.layer);
                if (ly) collectIntensity(comp, ly, lz.oldCount, lz.snap, rec.entries);
            }
            rec.lazy = null;
        }
        if (!rec.entries.length) return fail("This preset has no animated values to scale.");
        var k = Math.max(0, Math.min(3, (o.percent || 100) / 100)), changed = 0;
        app.beginUndoGroup("Preset Intensity " + Math.round(k * 100) + "%");
        try {
            for (var i = 0; i < rec.entries.length; i++) {
                var en = rec.entries[i], layer = findLayer(comp, en.layer);
                if (!layer) continue;
                var p = resolveProp(layer, en.path);
                if (!p) continue;
                var base = en.keys[0].v;
                for (var j = 0; j < en.keys.length; j++) {
                    var ki = p.nearestKeyIndex(en.keys[j].t);
                    if (Math.abs(p.keyTime(ki) - en.keys[j].t) > TIME_EPS) continue;
                    p.setValueAtKey(ki, scaleValue(en.keys[j].v, base, k));
                    changed++;
                }
            }
        } catch (err) {
            app.endUndoGroup();
            return fail(errText(err));
        }
        app.endUndoGroup();
        rec.k = k;
        return ok({ keys: changed, percent: Math.round(k * 100) });
    };

    // ---------------- Preset preview frames ----------------
    // Builds a small temporary comp, applies the preset to a checkerboard, and asks AE to
    // write PNG frames. AE writes them asynchronously, so the panel waits for the files and
    // then calls previewCleanup, which deletes everything this made.
    api.previewStart = function (o) {
        var preset = presetFile(o.preset);
        if (!preset.exists) return fail("Preset missing.");
        var hadSolids = false;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === "Solids" && it.parentFolder === app.project.rootFolder) hadSolids = true;
        }
        app.beginUndoGroup("JW Preview (temporary)");
        var size = 360, dur = 2, fps = 15, frames = Math.max(4, Math.min(16, o.frames || 10));
        var clipFile = o.clip ? new File(o.clip) : null;
        if (clipFile && !clipFile.exists) clipFile = null;
        var comp = app.project.items.addComp("_JWPA preview (temp)", size, size, 1, dur, fps);
        var made = { compId: comp.id, solidIds: [], footageIds: [], hadSolids: hadSolids };
        try {
            if (typeof comp.saveFrameToPng !== "function") throw new Error("This After Effects version can't save preview frames.");
            var bg = comp.layers.addSolid([0.06, 0.07, 0.09], "_jwpa_bg", size, size, 1, dur);
            made.solidIds.push(bg.source.id);
            var sample = null;
            if (clipFile) {
                // preview on the user's own clip, scaled to fill the square
                var foot = app.project.importFile(new ImportOptions(clipFile));
                made.footageIds.push(foot.id);
                if (foot.duration > 0.2 && foot.duration < dur) { dur = foot.duration; comp.duration = dur; bg.outPoint = dur; }
                sample = comp.layers.add(foot);
                var fill = Math.max(size / foot.width, size / foot.height) * 100;
                sample.property("ADBE Transform Group").property("ADBE Scale").setValue([fill, fill]);
                sample.name = "_jwpa_sample";
            } else {
                sample = comp.layers.addSolid([0.14, 0.15, 0.19], "_jwpa_sample", size, size, 1, dur);
                made.solidIds.push(sample.source.id);
                try {
                    var cb = sample.property("ADBE Effect Parade").addProperty("ADBE Checkerboard");
                    try { cb.property("ADBE Checkerboard-0003").setValue(40); } catch (e1) {}
                    try { cb.property("ADBE Checkerboard-0007").setValue([0.25, 0.8, 1, 1]); } catch (e2) {}
                } catch (e3) {}
            }
            var fx = sample.property("ADBE Effect Parade"), oldCount = fx.numProperties;
            var snap = snapshotLayer(sample);
            selectOnly(comp, [sample]);
            sample.applyPreset(preset);
            stretchPresetKeys(sample, 0, dur, oldCount, true, true, snap);
            var files = [];
            for (var f = 0; f < frames; f++) {
                var t = (f / (frames - 1)) * (dur - 1 / fps);
                var file = new File(o.dir + "/f" + f + ".png");
                comp.saveFrameToPng(t, file);
                files.push(file.fsName);
            }
            made.files = files;
            app.endUndoGroup();
            return ok(made);
        } catch (e) {
            cleanupPreview(made);
            app.endUndoGroup();
            return fail(errText(e));
        }
    };

    function cleanupPreview(o) {
        try { var c = app.project.itemByID(o.compId); if (c) c.remove(); } catch (e) {}
        var ids = (o.solidIds || []).concat(o.footageIds || []);
        for (var i = 0; i < ids.length; i++) {
            try { var s = app.project.itemByID(ids[i]); if (s) s.remove(); } catch (e2) {}
        }
        if (!o.hadSolids) {
            for (var j = app.project.numItems; j >= 1; j--) {
                var it = app.project.item(j);
                if (it instanceof FolderItem && it.name === "Solids" && it.numItems === 0 && it.parentFolder === app.project.rootFolder) it.remove();
            }
        }
    }

    api.previewCleanup = function (o) { app.beginUndoGroup("JW Preview cleanup"); cleanupPreview(o); app.endUndoGroup(); return ok(); };

    // Read-only: is the project set to render on the CPU only?
    api.renderInfo = function () {
        var cpuOnly = false;
        try { if (typeof GpuAccelType !== "undefined") cpuOnly = app.project.gpuAccelType === GpuAccelType.SOFTWARE; } catch (e) {}
        return ok({ cpuOnly: cpuOnly });
    };

    // ---------------- Quick export: describe comps to render (read-only) ----------------
    api.exportPrep = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var jobs = [], skipped = [], sel = comp.selectedLayers;
        function add(c, s, e, label) {
            if (countCompsNamed(c.name) > 1) { skipped.push("more than one comp is named \u201C" + c.name + "\u201D \u00B7 rename it"); return; }
            var sf = Math.round(s * c.frameRate), ef = Math.max(sf, Math.round(e * c.frameRate) - 1);
            jobs.push({ name: label, renderComp: c.name, startFrame: sf, endFrame: ef, frames: ef - sf + 1, fps: c.frameRate });
        }
        var usedLayers = false;
        if (!o.wholeComp) {
            for (var i = 0; i < sel.length; i++) {
                var L = sel[i], src = null;
                try { src = L.source; } catch (e) {}
                if (!(src instanceof CompItem)) continue;
                usedLayers = true;
                var problem = layerProblem(L);
                if (problem) { skipped.push(L.name + " " + problem); continue; }
                if (o.layerRange) add(src, L.inPoint - L.startTime, L.outPoint - L.startTime, L.name);
                else add(src, 0, src.duration, L.name);
            }
        }
        if (!usedLayers) add(comp, comp.workAreaStart, comp.workAreaStart + comp.workAreaDuration, comp.name + " (work area)");
        var saved = jobs.length ? saveForRender() : { saved: false };
        if (saved.error) return fail(saved.error);
        var dirty = false;
        return ok({
            saved: saved.saved,
            jobs: jobs, skipped: skipped, dirty: dirty,
            project: app.project.file ? app.project.file.fsName : "",
            projectFolder: app.project.file ? app.project.file.parent.fsName : "",
            aerender: Folder.appPackage.fsName + "\\aerender.exe",
            version: app.version.split(".")[0] + ".0"
        });
    };

    // ---------------- Instant preview (pre-rendered proxies) ----------------
    // Selected precomp layers -> their comps get rendered in the background at full quality and
    // set as proxies, so the timeline plays them back without rendering every frame live.
    function selectedPrecomps(comp) {
        var out = [], seen = {}, sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) {
            var src = null;
            try { src = sel[i].source; } catch (e) {}
            if (src instanceof CompItem && !seen[src.id]) { seen[src.id] = 1; out.push(src); }
        }
        return out;
    }

    api.proxyPrep = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var comps = selectedPrecomps(comp), jobs = [], skipped = [];
        if (!comps.length) return fail("Select precomp layers to pre-render (precompose plain layers first in the Precomp tab).");
        for (var i = 0; i < comps.length; i++) {
            var c = comps[i];
            if (countCompsNamed(c.name) > 1) { skipped.push("more than one comp is named “" + c.name + "” · rename it"); continue; }
            var frames = Math.max(1, Math.round(c.duration * c.frameRate));
            jobs.push({ name: c.name, renderComp: c.name, compId: c.id, startFrame: 0, endFrame: frames - 1, frames: frames, fps: c.frameRate, proxy: true });
        }
        var saved = jobs.length ? saveForRender() : { saved: false };
        if (saved.error) return fail(saved.error);
        return ok({
            saved: saved.saved, jobs: jobs, skipped: skipped,
            project: app.project.file ? app.project.file.fsName : "",
            projectName: app.project.file ? app.project.file.name.replace(/\.aep$/i, "") : "project",
            aerender: Folder.appPackage.fsName + "\\aerender.exe"
        });
    };

    api.setProxy = function (o) {
        var c = null;
        try { c = app.project.itemByID(o.compId); } catch (e) {}
        if (!(c instanceof CompItem)) return fail("That precomp is gone from the project.");
        var f = new File(String(o.file).replace(/%/g, "%25"));
        if (!f.exists) return fail("The pre-render file is missing.");
        app.beginUndoGroup("Use Pre-render For Instant Preview");
        try { c.setProxy(f); c.useProxy = true; } catch (e1) { app.endUndoGroup(); return fail(errText(e1)); }
        app.endUndoGroup();
        return ok({ name: c.name });
    };

    // selected precomps, or every comp with a proxy when nothing is selected
    api.clearProxies = function (o) {
        o = o || {};
        var comp = activeComp(), list = comp ? selectedPrecomps(comp) : [], files = [], n = 0;
        var mine = String(o.dir || "").toLowerCase().replace(/\//g, "\\");
        if (!list.length) for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i), f = null;
            if (!(it instanceof CompItem) || !it.proxySource) continue;
            try { f = it.proxySource.file ? it.proxySource.file.fsName.toLowerCase() : null; } catch (ef) {}
            if (mine && f && f.indexOf(mine) === 0) list.push(it); // never your own proxies
        }
        app.beginUndoGroup("Clear Pre-renders");
        try {
            for (var j = 0; j < list.length; j++) {
                if (!list[j].proxySource) continue;
                try { if (list[j].proxySource.file) files.push(list[j].proxySource.file.fsName); } catch (e0) {}
                list[j].setProxyToNone();
                n++;
            }
        } catch (e) { app.endUndoGroup(); return fail(errText(e)); }
        app.endUndoGroup();
        return ok({ cleared: n, files: files });
    };

    // ---------------- Split at markers ----------------
    api.splitAtMarkers = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (!layers.length) return fail("Select the clips to split.");
        var fd = comp.frameDuration, made = 0, splitLayers = 0, noMarkers = 0;

        function markerTimes(prop) {
            var t = [];
            try { for (var i = 1; i <= prop.numKeys; i++) t.push(Math.round(prop.keyTime(i) / fd) * fd); } catch (e) {}
            return t;
        }
        var compTimes = markerTimes(comp.markerProperty);

        app.beginUndoGroup("Split At Markers");
        try {
            for (var i = 0; i < layers.length; i++) {
                var L = layers[i];
                if (L.locked) continue;
                var times = markerTimes(L.property("ADBE Marker"));
                if (!times.length && o.useComp) times = compTimes;
                var cuts = [];
                for (var m = 0; m < times.length; m++) {
                    if (times[m] > L.inPoint + fd / 2 && times[m] < L.outPoint - fd / 2) cuts.push(times[m]);
                }
                cuts.sort(function (a, b) { return a - b; });
                if (!cuts.length) { noMarkers++; continue; }
                var bounds = [L.inPoint].concat(cuts).concat([L.outPoint]);
                for (var s = bounds.length - 2; s >= 1; s--) {
                    var d = L.duplicate();
                    d.inPoint = bounds[s];
                    d.outPoint = bounds[s + 1];
                    made++;
                }
                L.outPoint = bounds[1];
                splitLayers++;
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ layers: splitLayers, pieces: made + splitLayers, noMarkers: noMarkers });
    };

    // ---------------- Timeline tools ----------------
    function sortedByIn(layers) {
        return layers.slice().sort(function (a, b) { return a.inPoint - b.inPoint || a.index - b.index; });
    }

    api.sequence = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (layers.length < 2) return fail("Select at least 2 clips.");
        for (var l = 0; l < layers.length; l++) if (layers[l].locked) return fail(layers[l].name + " is locked.");
        var list = sortedByIn(layers), overlap = Math.max(0, Math.round(o.overlap || 0)) * comp.frameDuration;
        app.beginUndoGroup("Sequence Clips");
        try {
            for (var i = 1; i < list.length; i++) {
                var target = list[i - 1].outPoint - overlap;
                list[i].startTime += target - list[i].inPoint; // moves the clip without changing its trim
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ count: list.length, end: list[list.length - 1].outPoint });
    };

    // Save the open comp on its own as a new .aep (the comp plus only what it uses), then reopen
    // the user's project exactly as it was. Needs the project saved first, so nothing is lost.
    api.saveCompAlone = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var proj = app.project, orig = proj.file, dirty = true;
        try { if (typeof proj.dirty === "boolean") dirty = proj.dirty; } catch (e) {}
        if (!orig || dirty) {
            var ask = orig ? "Your project has unsaved changes.\nSave it now and continue?"
                           : "This project hasn't been saved yet.\nSave it first, then pick where the comp goes.";
            if (!confirm(ask)) return ok({ cancelled: true });
            if (orig) proj.save();
            else if (!proj.saveWithDialog()) return ok({ cancelled: true });
            orig = proj.file;
            if (!orig) return ok({ cancelled: true });
        }
        var safe = String(comp.name).replace(/[\\\/:*?"<>|]+/g, "_");
        var target = new File(orig.parent.fsName + "/" + safe + ".aep").saveDlg("Save \"" + comp.name + "\" as its own project", "After Effects Project:*.aep");
        if (!target) return ok({ cancelled: true });
        if (!/\.aepx?$/i.test(target.name)) target = new File(target.fsName + ".aep");
        if (target.fsName.toLowerCase() === orig.fsName.toLowerCase()) return fail("Pick a different file than your current project.");
        var compId = comp.id, name = comp.name, items = 0, err = null;
        try {
            proj.reduceProject([comp]);
            items = proj.numItems;
            proj.save(target);
        } catch (e2) { err = e2; }
        // Back to the full project, untouched on disk.
        try { proj.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e3) {}
        app.open(orig);
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it.id === compId && it instanceof CompItem) { it.openInViewer(); break; }
            }
        } catch (e4) {}
        if (err) return fail("Couldn't save the comp: " + errText(err));
        return ok({ file: target.fsName, name: name, items: items });
    };

    api.workArea = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (!layers.length) return fail("Select layers first.");
        var span = getLayerSpan(layers);
        var start = Math.max(0, span.start), end = Math.min(comp.duration, span.end);
        if (end - start < comp.frameDuration) return fail("Selection is too short.");
        app.beginUndoGroup("Work Area To Selection");
        try {
            comp.workAreaStart = start;
            comp.workAreaDuration = end - start;
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ seconds: Math.round((end - start) * 100) / 100 });
    };

    // A short solid that fades out at every cut between the selected clips.
    api.flashCuts = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (!layers.length) return fail("Select the clips to flash between.");
        var list = sortedByIn(layers), fd = comp.frameDuration;
        var frames = Math.max(1, Math.round(o.frames || 3)), len = frames * fd;
        var color = o.color === "black" ? [0, 0, 0] : [1, 1, 1];
        var top = layers[0];
        for (var i = 1; i < layers.length; i++) if (layers[i].index < top.index) top = layers[i];

        var cuts = [], seen = {};
        for (var c = o.includeFirst ? 0 : 1; c < list.length; c++) {
            var t = Math.round(list[c].inPoint / fd) * fd, key = String(Math.round(t / fd));
            if (!seen[key]) { seen[key] = true; cuts.push(t); }
        }
        if (!cuts.length) return fail("Select at least 2 clips (or turn on the first-clip flash).");

        var made = [];
        app.beginUndoGroup("Add Cut Flashes");
        try {
            for (var k = 0; k < cuts.length; k++) {
                var s = comp.layers.addSolid(color, (o.color === "black" ? "Black" : "White") + " Flash " + (k + 1),
                    comp.width, comp.height, comp.pixelAspect, len);
                s.startTime = cuts[k];
                s.inPoint = cuts[k];
                s.outPoint = Math.min(comp.duration, cuts[k] + len);
                try { s.moveBefore(top); } catch (e0) {}
                var op = s.property("ADBE Transform Group").property("ADBE Opacity");
                if (len - fd < fd * 0.5) op.setValue(o.strength || 100);   // a 1-frame flash: just on
                else { op.setValueAtTime(cuts[k], o.strength || 100); op.setValueAtTime(cuts[k] + len - fd, 0); }
                made.push(s);
            }
            selectOnly(comp, layers);
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ count: made.length, frames: frames });
    };

    // Splits N frames at every join between the selected clips off into their own layers (nothing moves)
    // with frame blending off on those pieces only. The main clips keep frame blending.
    // side: "split" takes a bit from both clips, "next" only the start of the next one, "prev" only the end of the previous one.
    api.cutJoins = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selectedLayers(comp);
        if (layers.length < 2) return fail("Select at least 2 clips.");
        for (var l = 0; l < layers.length; l++) if (layers[l].locked) return fail(layers[l].name + " is locked.");
        var list = sortedByIn(layers), fd = comp.frameDuration;
        var n = Math.max(1, Math.min(60, Math.round(o.frames || 4)));
        var side = o.side === "prev" || o.side === "next" ? o.side : "split";

        // plan the trims (in frames) and check every clip stays at least 1 frame long
        var cutIn = [], cutOut = [], i;
        for (i = 0; i < list.length; i++) { cutIn.push(0); cutOut.push(0); }
        // split: an odd extra frame goes to the front (end of the previous clip)
        var fromPrev = side === "prev" ? n : side === "split" ? Math.ceil(n / 2) : 0;
        for (i = 1; i < list.length; i++) {
            cutOut[i - 1] += fromPrev;
            cutIn[i] += n - fromPrev;
        }
        cutIn[0] = (n - fromPrev) || n; // the very start of the first clip gets a piece too
        for (i = 0; i < list.length; i++) {
            var len = Math.round((list[i].outPoint - list[i].inPoint) / fd);
            if (len - cutIn[i] - cutOut[i] < 1) return fail(list[i].name + " is too short to cut " + (cutIn[i] + cutOut[i]) + " frames from.");
        }

        var pieces = [];
        function setBlend(layer) { try { layer.frameBlendingType = FrameBlendingType.NO_FRAME_BLEND; } catch (eb) {} } // text/shape layers have none

        app.beginUndoGroup("Split Frames At Joins");
        try {
            for (i = 0; i < list.length; i++) {
                var L = list[i], inP = L.inPoint, outP = L.outPoint;
                if (cutOut[i]) { // last frames of this clip become their own layer, same spot
                    var t = L.duplicate();
                    t.inPoint = outP - cutOut[i] * fd;
                    t.outPoint = outP;
                    t.name = L.name + " join";
                    setBlend(t); pieces.push(t);
                }
                if (cutIn[i]) { // first frames of this clip become their own layer, same spot
                    var h = L.duplicate();
                    h.inPoint = inP;
                    h.outPoint = inP + cutIn[i] * fd;
                    h.name = L.name + " join";
                    setBlend(h); pieces.push(h);
                }
                L.inPoint = inP + cutIn[i] * fd;
                L.outPoint = outP - cutOut[i] * fd;
                // the big clips keep whatever frame blending they already had
            }
            comp.frameBlending = true; // comp switch on so the main clips' blending shows
            selectOnly(comp, pieces);
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ joins: list.length - 1, frames: n, pieces: pieces.length });
    };

    // ---------------- Scene Edit Detection gap fixer ----------------
    // Latest time a layer can end / earliest it can start without running out of footage.
    function sourceLimits(layer) {
        var lim = { minIn: -1e9, maxOut: 1e9 };
        try { if (layer.timeRemapEnabled) return lim; } catch (e) {}
        var src = null;
        try { src = layer.source; } catch (e1) {}
        var hasDuration = false, dur = 0;
        try {
            if (src && src.duration > 0 && !(src.mainSource && src.mainSource.isStill)) { hasDuration = true; dur = src.duration; }
        } catch (e2) {}
        if (!hasDuration) return lim; // solids, stills, text: can be any length
        var st = 1;
        try { st = layer.stretch / 100; } catch (e3) {}
        if (st >= 0) { lim.minIn = layer.startTime; lim.maxOut = layer.startTime + dur * st; }
        else { lim.minIn = layer.startTime + dur * st; lim.maxOut = layer.startTime; }
        return lim;
    }

    // Works on plain {inPoint, outPoint, limits} objects so it can be tested outside AE.
    // Returns the list of changes to make; nothing is touched here.
    function planSceneFixes(clips, fd, opts) {
        var tol = Math.max(1, Math.round(opts.tolerance || 2));
        var eps = fd * 0.01;
        var list = clips.slice().sort(function (a, b) { return a.inPoint - b.inPoint || a.outPoint - b.outPoint; });
        var changes = [], report = { gaps: 0, gapFrames: 0, overlaps: 0, overlapFrames: 0, bigGaps: 0, blocked: [] };

        for (var i = 1; i < list.length; i++) {
            var a = list[i - 1], b = list[i];
            var frames = Math.round((b.inPoint - a.outPoint) / fd);
            if (frames === 0) continue;

            if (frames > 0) {
                if (frames > tol) { report.bigGaps++; continue; }
                var canOut = b.inPoint <= a.limits.maxOut + eps;
                var canIn = a.outPoint >= b.limits.minIn - eps;
                var useNext = opts.fill === "next" ? canIn : !canOut && canIn;
                if (useNext) {
                    changes.push({ clip: b, prop: "inPoint", value: a.outPoint });
                    b.inPoint = a.outPoint;
                } else if (canOut) {
                    changes.push({ clip: a, prop: "outPoint", value: b.inPoint });
                    a.outPoint = b.inPoint;
                } else {
                    report.blocked.push(a.name + " \u2192 " + b.name);
                    continue;
                }
                report.gaps++;
                report.gapFrames += frames;
            } else if (opts.overlaps && -frames <= tol && b.outPoint > a.outPoint) {
                // overlapping cut: keep the clip that "fill" favours whole, trim the other
                if (opts.fill === "next") {
                    changes.push({ clip: a, prop: "outPoint", value: b.inPoint });
                    a.outPoint = b.inPoint;
                } else {
                    changes.push({ clip: b, prop: "inPoint", value: a.outPoint });
                    b.inPoint = a.outPoint;
                }
                report.overlaps++;
                report.overlapFrames += -frames;
            }
        }
        report.changes = changes;
        return report;
    }

    api.fixSceneGaps = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var sel = comp.selectedLayers;
        if (sel.length < 2) return fail("Select the clips from Scene Edit Detection (at least 2).");

        var clips = [];
        for (var i = 0; i < sel.length; i++) {
            if (sel[i].locked) return fail(sel[i].name + " is locked.");
            clips.push({ layer: sel[i], name: sel[i].name, inPoint: sel[i].inPoint, outPoint: sel[i].outPoint, limits: sourceLimits(sel[i]) });
        }
        var plan = planSceneFixes(clips, comp.frameDuration, o);
        if (!plan.changes.length) {
            return ok({ gaps: 0, overlaps: 0, bigGaps: plan.bigGaps, blocked: plan.blocked });
        }

        app.beginUndoGroup("Fix Scene Edit Gaps");
        try {
            for (var c = 0; c < plan.changes.length; c++) {
                var ch = plan.changes[c];
                ch.clip.layer[ch.prop] = ch.value;
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({
            gaps: plan.gaps, gapFrames: plan.gapFrames, overlaps: plan.overlaps, overlapFrames: plan.overlapFrames,
            bigGaps: plan.bigGaps, blocked: plan.blocked
        });
    };

    // ---------------- Smart Scene Detect ----------------
    // Step 1 (read-only): which selected layers can be analysed, and which part of their file.
    api.sceneDetectPrep = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var sel = comp.selectedLayers;
        if (!sel.length) return fail("Select the video layer(s) to detect scenes in.");
        var clips = [], skipped = [];
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i], s = null;
            try { s = L.source; } catch (e) {}
            if (!(s instanceof FootageItem && s.mainSource instanceof FileSource && !s.mainSource.isStill && s.file)) { skipped.push(L.name + " isn't a video file"); continue; }
            if (IMAGE_EXT.test(s.file.name)) { skipped.push(L.name + " is an image sequence"); continue; }
            var problem = layerProblem(L);
            if (problem) { skipped.push(L.name + " " + problem); continue; }
            if (L.locked) { skipped.push(L.name + " is locked"); continue; }
            clips.push({
                ref: layerRef(L), name: L.name, file: s.file.fsName, fps: s.frameRate || comp.frameRate,
                inPoint: L.inPoint, outPoint: L.outPoint, srcStart: L.inPoint - L.startTime, srcDur: L.outPoint - L.inPoint
            });
        }
        return ok({ clips: clips, skipped: skipped, fd: comp.frameDuration });
    };

    // Step 2: split one layer at the detected shot starts (or just mark them).
    // times = seconds after the layer's in-point where each new shot's first frame is.
    api.sceneSplit = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var L = findLayer(comp, o.ref);
        var fd = comp.frameDuration, eps = fd * 0.02;
        // make sure it's still exactly the layer that was analysed
        var same = false;
        try { same = !!L && L.source.file.fsName === o.file && Math.abs(L.inPoint - o.inPoint) < eps && Math.abs(L.outPoint - o.outPoint) < eps; } catch (e) {}
        if (!same) return fail((o.name || "The layer") + " changed while it was being analysed \u00B7 run it again.");

        // snap each shot start to the first comp frame that shows it
        var cuts = [], seen = {};
        for (var i = 0; i < (o.times || []).length; i++) {
            var t = Math.ceil((L.inPoint + o.times[i] - eps) / fd) * fd;
            var key = String(Math.round(t / fd));
            if (seen[key] || t <= L.inPoint + eps || t >= L.outPoint - eps) continue;
            seen[key] = true;
            cuts.push(t);
        }
        cuts.sort(function (a, b) { return a - b; });
        if (!cuts.length) return ok({ cuts: 0, layers: 0 });

        app.beginUndoGroup(o.mode === "markers" ? "Scene Detect Markers" : "Smart Scene Detect");
        try {
            if (o.mode === "markers") {
                var mk = L.property("ADBE Marker");
                for (var m = 0; m < cuts.length; m++) mk.setValueAtTime(cuts[m], new MarkerValue("Cut " + (m + 1)));
            } else {
                var bounds = [L.inPoint].concat(cuts).concat([L.outPoint]);
                // newest copy goes right above the original, so the stack reads top = latest shot
                for (var s = bounds.length - 2; s >= 1; s--) {
                    var d = L.duplicate();
                    d.inPoint = bounds[s];
                    d.outPoint = bounds[s + 1];
                }
                L.outPoint = bounds[1];
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ cuts: cuts.length, layers: o.mode === "markers" ? 0 : cuts.length + 1 });
    };

    // ---------------- Vocal Remover ----------------
    // Step 1 (read-only): which selected layers have audio from a file, and which part of it they use.
    api.vocalPrep = function () {
        var comp = activeComp();
        if (!comp) return ok({ clips: [], skipped: [], noComp: true });
        var sel = comp.selectedLayers, clips = [], skipped = [];
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i], s = null;
            try { s = L.source; } catch (e) {}
            if (s instanceof CompItem) {
                // precomps get their audio rendered first (vocalRender), exactly as it plays in this comp
                if (!L.hasAudio) { skipped.push(L.name + " has no audio"); continue; }
                var from = Math.max(0, L.inPoint), to = Math.min(comp.duration, L.outPoint);
                if (to - from < comp.frameDuration) { skipped.push(L.name + " isn't inside the comp's time"); continue; }
                clips.push({
                    ref: layerRef(L), name: L.name, precomp: true, compId: s.id,
                    inPoint: L.inPoint, outPoint: L.outPoint, renderStart: from, renderDur: to - from
                });
                continue;
            }
            if (!(s instanceof FootageItem && s.mainSource instanceof FileSource && s.file)) { skipped.push(L.name + " isn't an audio or video file"); continue; }
            if (!L.hasAudio) { skipped.push(L.name + " has no audio"); continue; }
            var problem = layerProblem(L);
            if (problem) { skipped.push(L.name + " " + problem); continue; }
            clips.push({
                ref: layerRef(L), name: L.name, file: s.file.fsName,
                inPoint: L.inPoint, outPoint: L.outPoint,
                srcStart: Math.max(0, L.inPoint - L.startTime), srcDur: L.outPoint - L.inPoint
            });
        }
        return ok({ clips: clips, skipped: skipped });
    };

    // Is this still exactly the layer that was picked? (footage: same file; precomp: same comp)
    function vocalLayer(comp, o) {
        var L = findLayer(comp, o.ref), eps = comp.frameDuration * 0.02, same = false;
        try {
            same = !!L && Math.abs(L.inPoint - o.inPoint) < eps && Math.abs(L.outPoint - o.outPoint) < eps &&
                (o.precomp ? L.source.id === o.compId : L.source.file.fsName === o.file);
        } catch (e) {}
        return same ? L : null;
    }

    // Set an output module to audio only. Template names differ between AE versions and languages
    // ("Audio Only" in older AE, "AIFF 48kHz" in AE 2026), so look for one, else set WAV directly.
    // Returns the file extension AE will write.
    function useAudioOutput(om) {
        var names = [], pats = [/audio only/i, /^aiff/i, /\bwav\b/i], p, n;
        try { names = om.templates || []; } catch (e) {}
        for (p = 0; p < pats.length; p++) {
            for (n = 0; n < names.length; n++) {
                if (/^_HIDDEN/.test(names[n]) || !pats[p].test(names[n])) continue;
                om.applyTemplate(names[n]);
                return /aiff/i.test(names[n]) ? "aif" : "wav";
            }
        }
        try {
            om.setSettings({ "Format": "WAV" });
            try { om.setSettings({ "Output Audio": "On" }); } catch (e2) {}
            return "wav";
        } catch (e3) {
            throw new Error("No audio-only output template found (have: " + names.join(", ") + ").");
        }
    }

    // Step 1b (precomps): render the layer's audio as it plays in this comp, solo, to a WAV.
    // o: { ref, compId, inPoint, outPoint, name, renderStart, renderDur, out }
    api.vocalRender = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open the comp with " + (o.name || "the precomp") + " again.");
        var L = vocalLayer(comp, o);
        if (!L) return fail((o.name || "The precomp") + " changed · run it again.");
        var rq = app.project.renderQueue;
        if (rq.rendering) return fail("Wait for the current render to finish.");
        var file = new File(o.out);
        if (!file.parent.exists) file.parent.create();
        if (file.exists) file.remove();

        var queued = [], audio = [], q = null, made = "";
        try {
            // render only our item, with only this layer audible
            for (var k = 1; k <= rq.numItems; k++) {
                var it = rq.item(k);
                if (it.status === RQItemStatus.QUEUED) { queued.push(it); it.render = false; }
            }
            for (var i = 1; i <= comp.numLayers; i++) {
                var other = comp.layer(i);
                if (!other.hasAudio) continue;
                audio.push({ layer: other, on: other.audioEnabled });
                other.audioEnabled = other.index === L.index;
            }
            q = rq.items.add(comp);
            q.timeSpanStart = o.renderStart;
            q.timeSpanDuration = o.renderDur;
            var om = q.outputModule(1);
            var ext = useAudioOutput(om);
            file = new File(file.fsName.replace(/\.[^.\\\/]+$/, "") + "." + ext);
            om.file = file;
            q.render = true;
            rq.render();
            try { made = om.file.fsName; } catch (e1) { made = file.fsName; }
            if (q.status !== RQItemStatus.DONE || !new File(made).exists) throw new Error("After Effects couldn't render the audio.");
        } catch (e) {
            made = "";
            var err = errText(e);
        } finally {
            if (q) { try { q.remove(); } catch (e2) {} }
            for (var a = 0; a < audio.length; a++) { try { audio[a].layer.audioEnabled = audio[a].on; } catch (e3) {} }
            for (var r = 0; r < queued.length; r++) { try { queued[r].render = true; } catch (e4) {} }
        }
        return made ? ok({ file: made }) : fail(err || "Render failed.");
    };

    // Step 2: import the stems and put them right above the original, lined up to the frame.
    // o: { ref?, precomp?, compId?, file, inPoint, outPoint, placeAt?, name, stems: { vocals, instrumental }, keep: both|vocals|instrumental, mute }
    api.vocalPlace = function (o) {
        var comp = activeComp(), L = null;
        if (o.ref) {
            if (!comp) return fail("Open the comp with " + (o.name || "the layer") + " again.");
            L = vocalLayer(comp, o);
            if (!L) return fail((o.name || "The layer") + " changed while it was being processed · run it again.");
        }
        var want = o.keep === "vocals" ? ["vocals"] : o.keep === "instrumental" ? ["instrumental"] : ["instrumental", "vocals"];
        var label = { vocals: "Vocals", instrumental: "Instrumental" };
        var base = String(o.name || "Song").replace(/\.[a-z0-9]{2,4}$/i, "");
        var added = 0;
        app.beginUndoGroup("Vocal Remover");
        try {
            var folder = findFolder("Vocal Remover");
            for (var i = 0; i < want.length; i++) {
                var f = new File(o.stems[want[i]]);
                if (!f.exists) throw new Error("Separated file is missing: " + f.fsName);
                var item = app.project.importFile(new ImportOptions(f));
                item.parentFolder = folder;
                item.name = base + " - " + label[want[i]];
                if (!comp) continue;
                var nl = comp.layers.add(item);
                if (L) { nl.moveBefore(L); nl.startTime = typeof o.placeAt === "number" ? o.placeAt : L.inPoint; }
                else nl.startTime = comp.time;
                added++;
            }
            if (L && o.mute && added) L.audioEnabled = false;
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ added: added, imported: want.length });
    };

    // ---------------- Scene gaps, auto mode ----------------
    // Step 1 (read-only): describe each small gap/overlap so the panel can look at the frames.
    function clipInfo(layer) {
        var info = { ref: layerRef(layer), name: layer.name, startTime: layer.startTime, file: "", stretch: 100, remap: false, limits: sourceLimits(layer) };
        try { info.stretch = layer.stretch; } catch (e) {}
        try { info.remap = !!layer.timeRemapEnabled; } catch (e2) {}
        try {
            var s = layer.source;
            if (s instanceof FootageItem && s.mainSource instanceof FileSource && !s.mainSource.isStill && s.file) info.file = s.file.fsName;
        } catch (e3) {}
        return info;
    }

    api.sceneGapPlan = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var sel = comp.selectedLayers;
        if (sel.length < 2) return fail("Select the clips from Scene Edit Detection (at least 2).");
        for (var l = 0; l < sel.length; l++) if (sel[l].locked) return fail(sel[l].name + " is locked.");
        var fd = comp.frameDuration, tol = Math.max(1, Math.round(o.tolerance || 2));
        var list = sortedByIn(selectedLayers(comp)), pairs = [], bigGaps = 0;
        for (var i = 1; i < list.length; i++) {
            var a = list[i - 1], b = list[i];
            var frames = Math.round((b.inPoint - a.outPoint) / fd);
            if (frames > tol) { bigGaps++; continue; }
            if (frames < 0 && (!o.overlaps || -frames > tol || b.outPoint <= a.outPoint)) continue;
            // frames === 0 is a normal cut: still checked, in case it's a frame or two off
            pairs.push({ a: clipInfo(a), b: clipInfo(b), aIn: a.inPoint, aOut: a.outPoint, bIn: b.inPoint, bOut: b.outPoint, frames: frames });
        }
        return ok({ fd: fd, pairs: pairs, bigGaps: bigGaps });
    };

    // Step 2: put each cut where the panel decided. cut = the time the next clip starts.
    api.applySceneCuts = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var done = 0, blocked = [], eps = comp.frameDuration * 0.01;
        app.beginUndoGroup("Fix Scene Edit Gaps (Auto)");
        try {
            for (var i = 0; i < (o.cuts || []).length; i++) {
                var c = o.cuts[i];
                var a = findLayer(comp, c.a), b = findLayer(comp, c.b);
                if (!a || !b) { blocked.push(c.aName + " \u2192 " + c.bName); continue; }
                var la = sourceLimits(a), lb = sourceLimits(b);
                if (c.cut > la.maxOut + eps || c.cut < lb.minIn - eps) { blocked.push(a.name + " \u2192 " + b.name); continue; }
                if (Math.abs(a.outPoint - c.cut) > eps) a.outPoint = c.cut;
                if (Math.abs(b.inPoint - c.cut) > eps) b.inPoint = c.cut;
                done++;
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ done: done, blocked: blocked });
    };

    // ---------------- Topaz: describe jobs (read-only, never changes the project) ----------------
    var IMAGE_EXT = /\.(png|jpe?g|tiff?|exr|dpx|tga|bmp|psd|gif|webp|heic|avif|hdr|cin|sgi|iff|pxr|crw|cr2|nef|arw|dng)$/i;

    function layerProblem(layer) {
        try { if (layer.timeRemapEnabled) return "has time remapping \u00B7 precompose it first"; } catch (e) {}
        try { if (Math.abs(layer.stretch - 100) > 0.001) return "is time-stretched \u00B7 precompose it first"; } catch (e2) {}
        return "";
    }

    function countCompsNamed(name) {
        var n = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) n++;
        }
        return n;
    }

    // Background renders (aerender) read the project file on disk, so anything not saved yet
    // (like a precomp made a minute ago) wouldn't exist there. Save first.
    function saveForRender() {
        if (!app.project.file) return { error: "Save the project once first (File > Save) \u00B7 background renders use the saved file." };
        try { app.project.save(); } catch (e) { return { error: "Couldn't save the project: " + e.toString() }; }
        return { saved: true };
    }

    api.topazPrep = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var sel = comp.selectedLayers;
        if (!sel.length) return fail("Select a layer or precomp first.");
        // An unsaved project is fine for plain video layers; the panel blocks precomps in that case.

        var dirty = false;
        try { dirty = !!app.project.dirty; } catch (e) {}
        var jobs = [], skipped = [];

        for (var i = 0; i < sel.length; i++) {
            var L = sel[i], src = null;
            try { src = L.source; } catch (e1) {}
            var problem = layerProblem(L);
            if (problem) { skipped.push(L.name + " " + problem); continue; }

            var job = {
                name: L.name,
                compId: comp.id,
                compName: comp.name,
                layerIndex: L.index,
                layerName: L.name,
                layerId: null,
                inPoint: L.inPoint,
                outPoint: L.outPoint
            };
            try { job.layerId = L.id; } catch (e2) {}
            var srcStart = L.inPoint - L.startTime, srcEnd = L.outPoint - L.startTime;

            if (src instanceof CompItem) {
                if (countCompsNamed(src.name) > 1) { skipped.push(L.name + ": more than one comp is named \u201C" + src.name + "\u201D \u00B7 rename it"); continue; }
                job.kind = "comp";
                job.renderComp = src.name;
                job.fps = src.frameRate;
                job.width = src.width;
                job.height = src.height;
                // aerender frame range inside the precomp (end frame is inclusive)
                job.startFrame = Math.round(srcStart * src.frameRate);
                job.endFrame = Math.max(job.startFrame, Math.round(srcEnd * src.frameRate) - 1);
                job.frames = job.endFrame - job.startFrame + 1;
            } else if (src instanceof FootageItem && src.mainSource instanceof FileSource && !src.mainSource.isStill && src.file) {
                if (IMAGE_EXT.test(src.file.name)) { skipped.push(L.name + " is an image sequence \u00B7 precompose it first"); continue; }
                job.kind = "footage";
                job.file = src.file.fsName;
                job.fps = src.frameRate || comp.frameRate;
                job.width = src.width;
                job.height = src.height;
                job.ss = Math.max(0, srcStart);
                job.duration = Math.max(1 / job.fps, srcEnd - srcStart);
                job.frames = Math.max(1, Math.round(job.duration * job.fps));
            } else {
                skipped.push(L.name + " has no video file \u00B7 precompose it first");
                continue;
            }
            jobs.push(job);
        }

        // Precomps are rendered from the saved file, so save first (like Media Encoder needs).
        var needsRender = false;
        for (var j = 0; j < jobs.length; j++) if (jobs[j].kind === "comp") needsRender = true;
        if (needsRender) {
            var sv = saveForRender();
            if (sv.error) return fail(sv.error);
            dirty = false;
        }

        return ok({
            jobs: jobs,
            skipped: skipped,
            dirty: dirty,
            project: app.project.file ? app.project.file.fsName : "",
            projectFolder: app.project.file ? app.project.file.parent.fsName : "",
            aerender: Folder.appPackage.fsName + "\\aerender.exe"
        });
    };

    api.pickFolder = function () {
        var f = Folder.selectDialog("Choose where Topaz renders are saved");
        return ok({ path: f ? f.fsName : "" });
    };

    // ---------------- Topaz: bring a finished file back in ----------------
    function findFolder(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === name && it.parentFolder === app.project.rootFolder) return it;
        }
        return app.project.items.addFolder(name);
    }

    function findOriginalLayer(o) {
        var comp = null;
        try { comp = app.project.itemByID(o.compId); } catch (e) {}
        if (!(comp instanceof CompItem)) return { comp: null, layer: null };
        var layer = null;
        if (o.layerId) { try { layer = app.project.layerByID(o.layerId); } catch (e2) {} }
        if (!layer && o.layerIndex <= comp.numLayers && comp.layer(o.layerIndex).name === o.layerName) layer = comp.layer(o.layerIndex);
        if (!layer) {
            for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === o.layerName) { layer = comp.layer(i); break; }
        }
        return { comp: comp, layer: layer };
    }

    function staticValue(prop, t) {
        try { return prop.numKeys ? prop.valueAtTime(t, false) : prop.value; } catch (e) { return null; }
    }

    // Which project file is open right now (used to avoid importing into the wrong project).
    api.projectPath = function () {
        return ok({ path: app.project.file ? app.project.file.fsName : "" });
    };

    // Import a finished export into a project folder (no timeline changes).
    api.importFile = function (o) {
        var f = new File(o.file);
        if (!f.exists) return fail("File not found: " + o.file);
        app.beginUndoGroup("Import Export");
        try {
            var io = new ImportOptions(f);
            if (o.sequence) { try { io.sequence = true; } catch (e0) {} }
            var item = app.project.importFile(io);
            item.parentFolder = findFolder(o.folder || "Exports");
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({});
    };

    api.topazImport = function (o) {
        var f = new File(o.file);
        if (!f.exists) return fail("Rendered file not found: " + o.file);
        app.beginUndoGroup("Import Topaz Render");
        var placed = false, note = "";
        try {
            var io = new ImportOptions(f);
            var item = app.project.importFile(io);
            item.parentFolder = findFolder("Topaz Renders");

            if (o.place) {
                var found = findOriginalLayer(o);
                if (!found.comp) {
                    note = "Original comp is gone, so it was only imported.";
                } else {
                    var nl = found.comp.layers.add(item);
                    if (found.layer) {
                        var orig = found.layer, t = orig.inPoint;
                        nl.moveBefore(orig);
                        nl.startTime = orig.inPoint; // the render starts at the original's in-point
                        var tr = orig.property("ADBE Transform Group"), ntr = nl.property("ADBE Transform Group");
                        var factor = (o.srcWidth && item.width) ? o.srcWidth / item.width : 1;
                        var sc = staticValue(tr.property("ADBE Scale"), t);
                        if (sc) ntr.property("ADBE Scale").setValue([sc[0] * factor, sc[1] * factor, (sc[2] || 100)]);
                        var pos = staticValue(tr.property("ADBE Position"), t);
                        var anc = staticValue(tr.property("ADBE Anchor Point"), t);
                        if (pos) ntr.property("ADBE Position").setValue(pos);
                        if (anc) ntr.property("ADBE Anchor Point").setValue([anc[0] / factor, anc[1] / factor, (anc[2] || 0)]);
                        var rot = staticValue(tr.property("ADBE Rotate Z"), t);
                        if (rot !== null) ntr.property("ADBE Rotate Z").setValue(rot);
                        nl.name = orig.name + " (Topaz)";
                        if (o.hideOriginal) { try { orig.enabled = false; } catch (eh) {} }
                    } else {
                        note = "Original layer not found, so it was added at the top.";
                        nl.name = o.layerName + " (Topaz)";
                    }
                    placed = true;
                }
            }
        } catch (e) {
            app.endUndoGroup();
            return fail(errText(e));
        }
        app.endUndoGroup();
        return ok({ placed: placed, note: note });
    };

    // Wrap every call so an unexpected error comes back as JSON instead of "EvalScript error."
    var safe = {};
    for (var name in api) {
        (function (fnName, fn) {
            safe[fnName] = function (o) {
                try { return fn(o || {}); } catch (e) { return fail(errText(e)); }
            };
        })(name, api[name]);
    }
    safe._stretch = { snapshotLayer: snapshotLayer, stretchPresetKeys: stretchPresetKeys }; // for tests
    return safe;
})();
