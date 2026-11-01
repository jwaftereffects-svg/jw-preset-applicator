/*
    JW Preset Applicator Pro - Tools tab (After Effects side).
    Loaded after host.jsx; adds its functions onto JWPAX, so the panel calls them like the rest.
    ExtendScript is ES3: no forEach/indexOf/JSON, no trailing commas.
*/
(function () {
    if (typeof JWPAX === "undefined") return;

    // ---------------- JSON out ----------------
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
    function ok(d) { d = d || {}; d.ok = true; return stringify(d); }
    function fail(m) { return stringify({ ok: false, error: String(m) }); }
    function errText(e) { return e.toString() + (e.line ? " (line " + e.line + ")" : ""); }

    // ---------------- helpers ----------------
    function activeComp() { var c = app.project.activeItem; return (c instanceof CompItem) ? c : null; }
    function selected(comp) { var s = comp.selectedLayers, out = []; for (var i = 0; i < s.length; i++) out.push(s[i]); return out; }
    function byIndex(a, b) { return a.index - b.index; }
    function isAV(L) { return L instanceof AVLayer || L instanceof TextLayer || L instanceof ShapeLayer; }
    function rootFolder(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === name && it.parentFolder === app.project.rootFolder) return it;
        }
        return app.project.items.addFolder(name);
    }
    function findLayer(comp, ref) {
        if (!ref) return null;
        if (ref.index && ref.index <= comp.numLayers && comp.layer(ref.index).name === ref.name) return comp.layer(ref.index);
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === ref.name) return comp.layer(i);
        return null;
    }
    function compMarkerTimes(comp) {
        var out = [], m = comp.markerProperty;
        for (var i = 1; i <= m.numKeys; i++) out.push(m.keyTime(i));
        return out;
    }
    function layerMarkerTimes(L) {
        var out = [], m = L.property("ADBE Marker");
        if (m) for (var i = 1; i <= m.numKeys; i++) out.push(m.keyTime(i));
        return out;
    }
    function snap(comp, t) { var f = comp.frameDuration; return Math.round(t / f) * f; }
    function undo(name, fn) {
        app.beginUndoGroup(name);
        try { return fn(); } catch (e) { return fail(errText(e)); } finally { app.endUndoGroup(); }
    }
    // every leaf property under a layer or group
    function leaves(g, out) {
        for (var i = 1; i <= g.numProperties; i++) {
            var p = g.property(i);
            if (!p) continue;
            if (p.propertyType === PropertyType.PROPERTY) out.push(p);
            else leaves(p, out);
        }
        return out;
    }
    // selected properties if any (leaf ones), else every property of the selected layers
    function targetProps(comp, needKeys) {
        var sp = comp.selectedProperties, out = [], i;
        for (i = 0; i < sp.length; i++) if (sp[i].propertyType === PropertyType.PROPERTY) out.push(sp[i]);
        if (out.length) return { props: out, picked: true };
        var layers = selected(comp);
        for (i = 0; i < layers.length; i++) leaves(layers[i], out);
        return { props: out, picked: false };
    }

    var api = {};

    // ---------------- Create: solid, null, adjustment, camera, light ----------------
    api.craftAdd = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        return undo("Add " + o.kind, function () {
            var sel = selected(comp).sort(byIndex), above = sel.length ? sel[0] : null, L, cw = comp.width, ch = comp.height;
            var col = o.color || [0, 0, 0];
            if (o.kind === "solid") L = comp.layers.addSolid(col, o.name || "Solid", cw, ch, comp.pixelAspect, comp.duration);
            else if (o.kind === "null") { L = comp.layers.addNull(comp.duration); L.name = o.name || "Control"; }
            else if (o.kind === "adjustment") { L = comp.layers.addSolid([1, 1, 1], o.name || "Adjustment Layer", cw, ch, comp.pixelAspect, comp.duration); L.adjustmentLayer = true; L.label = 5; }
            else if (o.kind === "camera") L = comp.layers.addCamera(o.name || "Camera", [cw / 2, ch / 2]);
            else if (o.kind === "light") {
                L = comp.layers.addLight(o.name || "Light", [cw / 2, ch / 2]);
                var types = { point: LightType.POINT, spot: LightType.SPOT, parallel: LightType.PARALLEL, ambient: LightType.AMBIENT };
                try { L.lightType = types[o.light] || LightType.POINT; } catch (e1) {}
                try { L.property("ADBE Transform Group").property("ADBE Position").setValue([cw / 2, ch / 2, -400]); } catch (e2) {}
            } else return fail("Unknown layer type.");
            if (above && L !== above) { try { L.moveBefore(above); } catch (e3) {} }
            for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
            L.selected = true;
            return ok({ name: L.name });
        });
    };

    // ---------------- Cut to marker ----------------
    // Trims each selected layer's end to the first marker after the playhead (comp markers, else its own).
    api.craftCutToMarker = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selected(comp);
        if (!layers.length) return fail("Select the layers to trim.");
        var cm = compMarkerTimes(comp);
        return undo("Cut to marker", function () {
            var cut = 0, eps = comp.frameDuration / 2;
            for (var i = 0; i < layers.length; i++) {
                var L = layers[i], list = cm.length ? cm : layerMarkerTimes(L), from = Math.max(comp.time, L.inPoint), to = null;
                for (var k = 0; k < list.length; k++) if (list[k] > from + eps && (to === null || list[k] < to)) to = list[k];
                if (to !== null && to < L.outPoint - eps) { L.outPoint = to; cut++; }
            }
            if (!cut) return fail("No marker after the playhead inside the selected layers.");
            return ok({ count: cut });
        });
    };

    // ---------------- Sequence by markers ----------------
    // Layer 1 (top selected) starts at marker 1, layer 2 at marker 2, ...
    api.craftSeqMarkers = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selected(comp).sort(byIndex), m = compMarkerTimes(comp).sort(function (a, b) { return a - b; });
        if (!layers.length) return fail("Select the layers to place.");
        if (!m.length) return fail("Add comp markers first (Shift+8 or * on the number pad).");
        return undo("Sequence by markers", function () {
            var n = Math.min(layers.length, m.length);
            for (var i = 0; i < n; i++) {
                var L = layers[i];
                L.startTime += m[i] - L.inPoint;
                if (o.trim && i + 1 < m.length && L.outPoint > m[i + 1]) L.outPoint = m[i + 1];
            }
            return ok({ count: n, left: layers.length - n });
        });
    };

    // ---------------- Markers from times (beat detection runs in the panel) ----------------
    api.craftMarkers = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var L = o.where === "layer" ? findLayer(comp, o.ref) : null;
        if (o.where === "layer" && !L) return fail("The layer changed · run it again.");
        var mp = L ? L.property("ADBE Marker") : comp.markerProperty, tag = o.tag || "Beat";
        return undo("Beat markers", function () {
            for (var k = mp.numKeys; k >= 1; k--) { try { if (mp.keyValue(k).comment === tag) mp.removeKey(k); } catch (e) {} }
            var n = 0, last = -1;
            for (var i = 0; i < o.times.length; i++) {
                var t = snap(comp, o.times[i]);
                if (t < 0 || t > comp.duration || Math.abs(t - last) < comp.frameDuration / 2) continue;
                mp.setValueAtTime(t, new MarkerValue(tag));
                last = t; n++;
            }
            return ok({ count: n });
        });
    };

    // ---------------- Keep only these time ranges of a layer (silence cutting) ----------------
    // o: { ref, ranges: [[start, end], ...] in comp time, ripple }
    api.craftKeepRanges = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var L = findLayer(comp, o.ref);
        if (!L) return fail("The layer changed · run it again.");
        var r = o.ranges || [];
        if (!r.length) return fail("Nothing to keep.");
        return undo("Cut silence", function () {
            var made = [], f = comp.frameDuration;
            for (var i = 0; i < r.length; i++) {
                var s = Math.max(L.inPoint, snap(comp, r[i][0])), e = Math.min(L.outPoint, snap(comp, r[i][1]));
                if (e - s < f) continue;
                var d = L.duplicate();
                d.inPoint = s; d.outPoint = e;
                made.push(d);
            }
            if (!made.length) return fail("Nothing left after cutting.");
            // keep timeline order top to bottom = time order, right where the original was
            for (var k = 0; k < made.length; k++) made[k].moveBefore(L);
            var cutTime = 0;
            if (o.ripple) {
                var cursor = made[0].inPoint;
                for (var j = 0; j < made.length; j++) {
                    var shift = cursor - made[j].inPoint;
                    cutTime -= shift;
                    made[j].startTime += shift;
                    cursor = made[j].outPoint;
                }
            }
            L.remove();
            return ok({ pieces: made.length, removed: cutTime });
        });
    };

    // ---------------- Comp screenshot ----------------
    api.craftScreenshot = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var f = new File(o.file);
        if (!f.parent.exists) f.parent.create();
        comp.saveFrameToPng(comp.time, f);
        return ok({ file: f.fsName, name: comp.name, time: comp.time });
    };

    // ---------------- Fit to comp ----------------
    function setNow(prop, v, t) { if (prop.numKeys) prop.setValueAtTime(t, v); else prop.setValue(v); }
    api.craftFit = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = selected(comp);
        if (!layers.length) return fail("Select the layers to fit.");
        return undo("Fit to comp", function () {
            var n = 0, t = comp.time;
            for (var i = 0; i < layers.length; i++) {
                var L = layers[i];
                if (!isAV(L)) continue;
                var r = L.sourceRectAtTime(t, false);
                if (!(r.width > 0 && r.height > 0)) continue;
                var sx = comp.width / r.width * 100, sy = comp.height / r.height * 100, s;
                if (o.mode === "stretch") s = [sx, sy];
                else { var v = o.mode === "fit" ? Math.min(sx, sy) : Math.max(sx, sy); s = [v, v]; }
                var tr = L.property("ADBE Transform Group"), is3 = !!L.threeDLayer;
                setNow(tr.property("ADBE Anchor Point"), is3 ? [r.left + r.width / 2, r.top + r.height / 2, 0] : [r.left + r.width / 2, r.top + r.height / 2], t);
                setNow(tr.property("ADBE Position"), is3 ? [comp.width / 2, comp.height / 2, 0] : [comp.width / 2, comp.height / 2], t);
                setNow(tr.property("ADBE Scale"), is3 ? [s[0], s[1], 100] : s, t);
                n++;
            }
            if (!n) return fail("None of the selected layers can be scaled.");
            return ok({ count: n });
        });
    };

    // ---------------- Frame blending on every video layer ----------------
    api.craftFrameBlend = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var list = o.scope === "selected" ? selected(comp) : [], i;
        if (o.scope !== "selected") for (i = 1; i <= comp.numLayers; i++) list.push(comp.layer(i));
        var type = o.mode === "pixel" ? FrameBlendingType.PIXEL_MOTION : o.mode === "off" ? FrameBlendingType.NO_FRAME_BLEND : FrameBlendingType.FRAME_MIX;
        return undo("Frame blending", function () {
            var n = 0;
            for (i = 0; i < list.length; i++) {
                var L = list[i], s = null;
                try { s = L.source; } catch (e) {}
                if (!(L instanceof AVLayer) || !s || !L.hasVideo) continue;
                if (s instanceof FootageItem && (s.mainSource instanceof SolidSource || s.mainSource.isStill)) continue;
                try { L.frameBlendingType = type; n++; } catch (e2) {}
            }
            if (o.mode !== "off") comp.frameBlending = true;
            return ok({ count: n });
        });
    };

    // ---------------- Import a file and put it at the playhead (clipboard images, SFX) ----------------
    api.craftAddFile = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var f = new File(o.file);
        if (!f.exists) return fail("File not found: " + o.file);
        return undo("Add " + f.displayName, function () {
            var item = null, i;
            for (i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) { item = it; break; }
            }
            if (!item) {
                item = app.project.importFile(new ImportOptions(f));
                if (o.folder) item.parentFolder = rootFolder(o.folder);
            }
            var sel = selected(comp).sort(byIndex), L = comp.layers.add(item);
            L.startTime = comp.time;
            if (sel.length) { try { L.moveBefore(sel[0]); } catch (e) {} }
            if (o.fitDown && L.hasVideo && item.width && (item.width > comp.width || item.height > comp.height)) {
                var s = Math.min(comp.width / item.width, comp.height / item.height) * 100;
                L.property("ADBE Transform Group").property("ADBE Scale").setValue([s, s]);
            }
            for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
            L.selected = true;
            return ok({ name: L.name });
        });
    };

    // ---------------- Delete properties: expressions, keyframes or effects ----------------
    api.craftDeleteProps = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        if (!comp.selectedLayers.length) return fail("Select layers (or properties) first.");
        return undo("Delete " + o.what, function () {
            var n = 0, i;
            if (o.what === "effects") {
                var layers = selected(comp);
                for (i = 0; i < layers.length; i++) {
                    var fx = layers[i].property("ADBE Effect Parade");
                    if (!fx) continue;
                    for (var k = fx.numProperties; k >= 1; k--) { fx.property(k).remove(); n++; }
                }
                return ok({ count: n });
            }
            var tp = targetProps(comp), t = comp.time;
            for (i = 0; i < tp.props.length; i++) {
                var p = tp.props[i];
                try {
                    if (o.what === "expressions") {
                        if (p.canSetExpression && p.expression !== "") { p.expression = ""; n++; }
                    } else if (p.numKeys > 0) {
                        if (p.matchName === "ADBE Marker" || p.matchName === "ADBE Time Remapping") continue;
                        var v = p.valueAtTime(t, true);
                        for (var j = p.numKeys; j >= 1; j--) p.removeKey(j);
                        try { p.setValue(v); } catch (e1) {}
                        n++;
                    }
                } catch (e) {}
            }
            return ok({ count: n });
        });
    };

    // ---------------- Keyframe copy helpers ----------------
    function keyData(p, i) {
        var d = { t: p.keyTime(i), v: p.keyValue(i), it: p.keyInInterpolationType(i), ot: p.keyOutInterpolationType(i) };
        try { d.ie = p.keyInTemporalEase(i); d.oe = p.keyOutTemporalEase(i); } catch (e1) {}
        try { d.tc = p.keyTemporalContinuous(i); d.ta = p.keyTemporalAutoBezier(i); } catch (e2) {}
        if (p.isSpatial) { try { d.si = p.keyInSpatialTangent(i); d.so = p.keyOutSpatialTangent(i); d.sc = p.keySpatialContinuous(i); d.sa = p.keySpatialAutoBezier(i); d.rv = p.keyRoving(i); } catch (e3) {} }
        try { d.lb = p.keyLabel(i); } catch (e4) {}
        return d;
    }
    function putKey(p, d, t, speedScale) {
        var n = p.addKey(t);
        p.setValueAtKey(n, d.v);
        try { p.setInterpolationTypeAtKey(n, d.it, d.ot); } catch (e1) {}
        if (d.ie) {
            try {
                var ie = [], oe = [], s = speedScale || 1;
                for (var j = 0; j < d.ie.length; j++) { ie.push(new KeyframeEase(d.ie[j].speed * s, d.ie[j].influence)); oe.push(new KeyframeEase(d.oe[j].speed * s, d.oe[j].influence)); }
                p.setTemporalEaseAtKey(n, ie, oe);
            } catch (e2) {}
        }
        try { if (d.tc !== undefined) p.setTemporalContinuousAtKey(n, d.tc); if (d.ta !== undefined) p.setTemporalAutoBezierAtKey(n, d.ta); } catch (e3) {}
        if (d.si) { try { p.setSpatialTangentsAtKey(n, d.si, d.so); p.setSpatialContinuousAtKey(n, d.sc); p.setSpatialAutoBezierAtKey(n, d.sa); } catch (e4) {} }
        try { if (d.lb) p.setLabelAtKey(n, d.lb); } catch (e5) {}
        return n;
    }

    // ---------------- Stretch keyframes ----------------
    // Selected keys (or every key on the selected layers) spread out or squeezed by `factor`,
    // anchored on the earliest one. Speeds are scaled so the curves keep their shape.
    api.craftStretchKeys = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var factor = Number(o.factor);
        if (!(factor > 0.01 && factor < 100)) return fail("Use a stretch between 1% and 10000%.");
        var props = [], all = leaves, i, j, k;
        var sp = comp.selectedProperties;
        for (i = 0; i < sp.length; i++) if (sp[i].propertyType === PropertyType.PROPERTY && sp[i].selectedKeys && sp[i].selectedKeys.length) props.push({ p: sp[i], keys: sp[i].selectedKeys.slice(0) });
        if (!props.length) {
            var layers = selected(comp), list = [];
            for (i = 0; i < layers.length; i++) all(layers[i], list);
            for (i = 0; i < list.length; i++) {
                if (list[i].numKeys < 2 || list[i].matchName === "ADBE Marker") continue;
                var idx = [];
                for (j = 1; j <= list[i].numKeys; j++) idx.push(j);
                props.push({ p: list[i], keys: idx });
            }
        }
        if (!props.length) return fail("Select keyframes (or layers with keyframes) first.");
        var anchor = Infinity;
        for (i = 0; i < props.length; i++) for (j = 0; j < props[i].keys.length; j++) anchor = Math.min(anchor, props[i].p.keyTime(props[i].keys[j]));
        return undo("Stretch keyframes", function () {
            var moved = 0;
            for (i = 0; i < props.length; i++) {
                var p = props[i].p, data = [];
                for (j = 0; j < props[i].keys.length; j++) data.push(keyData(p, props[i].keys[j]));
                for (k = props[i].keys.length - 1; k >= 0; k--) p.removeKey(props[i].keys[k]);
                var added = [];
                for (j = 0; j < data.length; j++) {
                    var t = snap(comp, anchor + (data[j].t - anchor) * factor);
                    added.push(putKey(p, data[j], t, 1 / factor));
                    moved++;
                }
                // roving needs its neighbours in place first
                for (j = 0; j < data.length; j++) { try { if (data[j].rv) p.setRovingAtKey(p.nearestKeyIndex(snap(comp, anchor + (data[j].t - anchor) * factor)), true); } catch (e) {} }
            }
            return ok({ count: moved, props: props.length });
        });
    };

    // ---------------- Bounce / elastic expressions ----------------
    var MOTION = {
        bounce: {
            soft: [0.5, 3500, 4], medium: [0.65, 5000, 7], strong: [0.8, 6500, 10]
        },
        elastic: {
            soft: [0.04, 1.6, 6], medium: [0.07, 2.2, 4.5], strong: [0.11, 2.8, 3]
        }
    };
    function bounceExpr(e, g, nMax) {
        return "// JW Bounce\nvar e = " + e + ", g = " + g + ", nMax = " + nMax + ";\n" +
            "var n = 0;\nif (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }\n" +
            "if (n > 0) {\n  var t = time - key(n).time;\n  var v = -velocityAtTime(key(n).time - .001) * e;\n  var vl = length(v);\n" +
            "  var vu = (value instanceof Array) ? (vl > 0 ? normalize(v) : v * 0) : (v < 0 ? -1 : 1);\n" +
            "  var tCur = 0, segDur = 2 * vl / g, tNext = segDur, nb = 1;\n" +
            "  while (tNext < t && nb <= nMax) { vl *= e; segDur *= e; tCur = tNext; tNext += segDur; nb++; }\n" +
            "  if (nb <= nMax) { var d = t - tCur; value + vu * d * (vl - g * d / 2); } else value;\n} else value;";
    }
    function elasticExpr(amp, freq, decay) {
        return "// JW Elastic\nvar amp = " + amp + ", freq = " + freq + ", decay = " + decay + ";\n" +
            "var n = 0;\nif (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }\n" +
            "if (n > 0) {\n  var t = time - key(n).time;\n  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);\n" +
            "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n} else value;";
    }
    api.craftMotion = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var sp = comp.selectedProperties, props = [], i;
        for (i = 0; i < sp.length; i++) if (sp[i].propertyType === PropertyType.PROPERTY && sp[i].numKeys >= 2 && sp[i].canSetExpression) props.push(sp[i]);
        if (!props.length) {
            // no property picked: use keyed transform properties of the selected layers
            var layers = selected(comp);
            for (i = 0; i < layers.length; i++) {
                var tr = layers[i].property("ADBE Transform Group");
                if (!tr) continue;
                for (var k = 1; k <= tr.numProperties; k++) { var p = tr.property(k); if (p && p.numKeys >= 2 && p.canSetExpression && p.matchName !== "ADBE Opacity") props.push(p); }
            }
        }
        if (!props.length) return fail("Select a property with at least two keyframes (Position, Scale, Rotation...).");
        var group = MOTION[o.kind] || MOTION.elastic, set = group[o.strength] || group.medium;
        var expr = o.kind === "bounce" ? bounceExpr(set[0], set[1], set[2]) : elasticExpr(set[0], set[1], set[2]);
        return undo(o.kind === "bounce" ? "Bounce" : "Elastic", function () {
            var n = 0;
            for (i = 0; i < props.length; i++) { try { props[i].expression = expr; props[i].expressionEnabled = true; n++; } catch (e) {} }
            return ok({ count: n });
        });
    };

    // ---------------- Path to nulls ----------------
    api.craftPathToNulls = function () {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var sp = comp.selectedProperties, path = null, i;
        for (i = 0; i < sp.length; i++) {
            if (sp[i].matchName === "ADBE Vector Shape" || sp[i].matchName === "ADBE Mask Shape") { path = sp[i]; break; }
            // a selected mask or shape-path group: find its path inside
            try { if (sp[i].matchName === "ADBE Mask Atom") { path = sp[i].property("ADBE Mask Shape"); break; } } catch (e0) {}
            try { if (sp[i].matchName === "ADBE Vector Shape - Group") { path = sp[i].property("ADBE Vector Shape"); break; } } catch (e1) {}
        }
        if (!path) return fail("Twirl down a mask or shape and select its Path / Mask Path.");
        var L = path.propertyGroup(path.propertyDepth), shape = path.valueAtTime(comp.time, true), verts = shape.vertices;
        if (!verts.length) return fail("That path has no points.");
        return undo("Path to nulls", function () {
            var names = [], tmp = comp.layers.addNull(comp.duration), tp = tmp.property("ADBE Transform Group").property("ADBE Position");
            var at = [];
            // turn each point into comp space with an expression, read it, then drop the helper
            for (i = 0; i < verts.length; i++) {
                tp.expression = "thisComp.layer(" + L.index + ").toComp([" + verts[i][0] + "," + verts[i][1] + "])";
                var v = tp.valueAtTime(comp.time, false);
                at.push([v[0], v[1]]);
            }
            tmp.remove();
            var made = [];
            for (i = 0; i < verts.length; i++) {
                var n = comp.layers.addNull(comp.duration);
                n.name = L.name + " · Point " + (i + 1);
                n.label = 2;
                n.property("ADBE Transform Group").property("ADBE Position").setValue(at[i]);
                made.push(n);
                names.push(quote(n.name));
            }
            for (i = 0; i < made.length; i++) made[i].moveBefore(L);
            path.expression = "// JW Path to Nulls\nvar names = [" + names.join(", ") + "];\n" +
                "var p = thisProperty, pts = p.points();\n" +
                "for (var i = 0; i < names.length && i < pts.length; i++) {\n  var n = thisComp.layer(names[i]);\n  pts[i] = fromComp(n.toComp(n.anchorPoint));\n}\n" +
                "createPath(pts, p.inTangents(), p.outTangents(), p.isClosed());";
            return ok({ count: made.length, layer: L.name });
        });
    };

    // ---------------- Explode text ----------------
    function measure(meas, prop, doc, text, just, t) {
        doc.text = text;
        doc.justification = just;
        prop.setValue(doc);
        return meas.sourceRectAtTime(t, false);
    }
    function piecesOf(line, by) {
        var out = [], i;
        if (by === "lines") { if (/\S/.test(line)) out.push({ k: 0, s: line }); return out; }
        if (by === "chars") { for (i = 0; i < line.length; i++) if (/\S/.test(line.charAt(i))) out.push({ k: i, s: line.charAt(i) }); return out; }
        var re = /\S+/g, m;
        while ((m = re.exec(line)) !== null) out.push({ k: m.index, s: m[0] });
        return out;
    }
    function rotate(v, deg) { var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; }
    api.craftExplodeText = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var layers = [], s = selected(comp), i;
        for (i = 0; i < s.length; i++) if (s[i] instanceof TextLayer) layers.push(s[i]);
        if (!layers.length) return fail("Select a text layer.");
        var by = o.by || "words", t = comp.time;
        return undo("Explode text", function () {
            var total = 0, notes = [];
            for (var li = 0; li < layers.length; li++) {
                var L = layers[li], src = L.property("ADBE Text Properties").property("ADBE Text Document");
                var doc = src.valueAtTime(t, false);
                if (doc.boxText) { notes.push(L.name + " is paragraph text"); continue; }
                if (src.numKeys) { notes.push(L.name + " has animated text"); continue; }
                var full = doc.text, just = doc.justification, LEFT = ParagraphJustification.LEFT_JUSTIFY;
                var lines = full.split(/\r\n|\r|\n/);
                var meas = L.duplicate(), mp = meas.property("ADBE Text Properties").property("ADBE Text Document"), md = mp.value;
                meas.enabled = false;
                var h1 = measure(meas, mp, md, "H", LEFT, t), h2 = measure(meas, mp, md, "H\rH", LEFT, t), leading = h2.height - h1.height;
                var plan = [];
                for (var ln = 0; ln < lines.length; ln++) {
                    var line = lines[ln], parts = piecesOf(line, by);
                    if (!parts.length) continue;
                    var Lj = measure(meas, mp, md, line, just, t), L0 = measure(meas, mp, md, line, LEFT, t), shift = Lj.left - L0.left;
                    for (var pi = 0; pi < parts.length; pi++) {
                        var pc = parts[pi];
                        var A = measure(meas, mp, md, line.substr(0, pc.k) + pc.s, LEFT, t), P = measure(meas, mp, md, pc.s, LEFT, t);
                        var ox = A.left + A.width - P.width + shift - P.left, oy = ln * leading;
                        if (by === "lines") { ox = shift; }
                        plan.push({ s: pc.s, ox: ox, oy: oy, P: P });
                    }
                }
                meas.remove();
                if (!plan.length) continue;

                var tr = L.property("ADBE Transform Group"), ap = tr.property("ADBE Anchor Point"), pos = tr.property("ADBE Position");
                var simple = !L.threeDLayer && !ap.numKeys && !pos.numKeys && !ap.expressionEnabled && !pos.expressionEnabled && !pos.dimensionsSeparated &&
                    !tr.property("ADBE Scale").numKeys && !tr.property("ADBE Rotate Z").numKeys;
                var a0 = ap.value, p0 = pos.value, sc = tr.property("ADBE Scale").value, rot = tr.property("ADBE Rotate Z").value;
                var made = [];
                for (var q = 0; q < plan.length; q++) {
                    var it = plan[q], d = L.duplicate(), dp = d.property("ADBE Text Properties").property("ADBE Text Document"), dd = dp.value;
                    dd.text = it.s;
                    dd.justification = by === "lines" ? just : LEFT;
                    dp.setValue(dd);
                    if (by === "lines") { var R = d.sourceRectAtTime(t, false); it.P = R; it.ox = 0; }
                    var dtr = d.property("ADBE Transform Group"), dap = dtr.property("ADBE Anchor Point"), dpos = dtr.property("ADBE Position");
                    if (simple) {
                        // anchor in the middle of the piece, same spot on screen
                        var cx = it.P.left + it.P.width / 2, cy = it.P.top + it.P.height / 2;
                        var delta = [(it.ox + cx - a0[0]) * sc[0] / 100, (it.oy + cy - a0[1]) * sc[1] / 100];
                        var rd = rotate(delta, rot);
                        dap.setValue(a0.length > 2 ? [cx, cy, a0[2]] : [cx, cy]);
                        dpos.setValue(p0.length > 2 ? [p0[0] + rd[0], p0[1] + rd[1], p0[2]] : [p0[0] + rd[0], p0[1] + rd[1]]);
                    } else {
                        // animated/3D layer: shift the anchor instead so everything else keeps working
                        if (dap.numKeys) { for (var kk = 1; kk <= dap.numKeys; kk++) { var kv = dap.keyValue(kk); kv[0] -= it.ox; kv[1] -= it.oy; dap.setValueAtKey(kk, kv); } }
                        else { var av = dap.value; av[0] -= it.ox; av[1] -= it.oy; dap.setValue(av); }
                    }
                    d.name = it.s;
                    made.push(d);
                }
                for (q = 0; q < made.length; q++) made[q].moveBefore(L);
                L.enabled = false;
                L.selected = false;
                total += made.length;
            }
            if (!total) return fail(notes.length ? "Can't explode: " + notes.join(", ") + "." : "No text to split.");
            return ok({ count: total, note: notes.join(", ") });
        });
    };

    // ---------------- Un-precompose ----------------
    function isIdentity(L, src, comp) {
        var tr = L.property("ADBE Transform Group"), a = tr.property("ADBE Anchor Point"), p = tr.property("ADBE Position"), s = tr.property("ADBE Scale"), r = tr.property("ADBE Rotate Z");
        if (a.numKeys || p.numKeys || s.numKeys || r.numKeys || L.threeDLayer) return false;
        var av = a.value, pv = p.value, sv = s.value;
        return Math.abs(av[0] - pv[0]) < 0.01 && Math.abs(av[1] - pv[1]) < 0.01 && Math.abs(sv[0] - 100) < 0.01 && Math.abs(sv[1] - 100) < 0.01 && Math.abs(r.value) < 0.01;
    }
    function copyProp(from, to) {
        if (from.numKeys) { for (var i = 1; i <= from.numKeys; i++) putKey(to, keyData(from, i), from.keyTime(i)); }
        else to.setValue(from.value);
    }
    api.craftUnprecompose = function (o) {
        var comp = activeComp();
        if (!comp) return fail("Open a comp first.");
        var s = selected(comp), pre = [], i;
        for (i = 0; i < s.length; i++) { try { if (s[i].source instanceof CompItem) pre.push(s[i]); } catch (e) {} }
        if (!pre.length) return fail("Select a precomp layer.");
        return undo("Un-precompose", function () {
            var total = 0, notes = [];
            for (var pi = 0; pi < pre.length; pi++) {
                var P = pre[pi], src = P.source;
                if (P.timeRemapEnabled || P.stretch !== 100) { notes.push(P.name + " is time-remapped or stretched"); continue; }
                if (!src.numLayers) continue;
                var fx = P.property("ADBE Effect Parade"), masks = P.property("ADBE Mask Parade");
                if ((fx && fx.numProperties) || (masks && masks.numProperties)) notes.push(P.name + "'s own effects/masks aren't carried over");
                try { if (P.property("ADBE Transform Group").property("ADBE Opacity").value < 100) notes.push(P.name + "'s opacity isn't carried over"); } catch (e0) {}
                var n = src.numLayers, copies = [];
                for (i = n; i >= 1; i--) src.layer(i).copyToComp(comp);
                for (i = 1; i <= n; i++) copies.push(comp.layer(i));
                // timing: the precomp's time 0 sits at P.startTime
                for (i = 0; i < n; i++) copies[i].startTime += P.startTime;
                // parents and track mattes, as they were inside
                for (i = 0; i < n; i++) {
                    var orig = src.layer(i + 1);
                    try { if (orig.parent) { var pc = copies[orig.parent.index - 1]; if (copies[i].setParentWithJump) copies[i].setParentWithJump(pc); else copies[i].parent = pc; } } catch (e1) {}
                    try { if (orig.trackMatteLayer) copies[i].setTrackMatte(copies[orig.trackMatteLayer.index - 1], orig.trackMatteType); } catch (e2) {}
                }
                // the precomp layer's own move/scale/rotation goes onto a null that drives the top layers
                if (!isIdentity(P, src, comp)) {
                    var nl = comp.layers.addNull(comp.duration);
                    nl.name = P.name + " · Transform";
                    var ft = P.property("ADBE Transform Group"), nt = nl.property("ADBE Transform Group");
                    nl.threeDLayer = P.threeDLayer;
                    var names = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z"];
                    for (var k = 0; k < names.length; k++) { try { copyProp(ft.property(names[k]), nt.property(names[k])); } catch (e3) {} }
                    nl.inPoint = P.inPoint; nl.outPoint = P.outPoint;
                    nl.moveBefore(P);
                    for (i = 0; i < n; i++) { if (!copies[i].parent) { try { if (copies[i].setParentWithJump) copies[i].setParentWithJump(nl); else copies[i].parent = nl; } catch (e4) {} } }
                }
                for (i = 0; i < n; i++) copies[i].moveBefore(P);
                // only what was visible through the precomp layer
                for (i = n - 1; i >= 0; i--) {
                    var c = copies[i], a = Math.max(c.inPoint, P.inPoint), b = Math.min(c.outPoint, P.outPoint);
                    if (b - a < comp.frameDuration / 2) { try { c.remove(); } catch (e5) {} continue; }
                    try { c.inPoint = a; c.outPoint = b; } catch (e6) {}
                    total++;
                }
                if (o.keep) { P.enabled = false; try { P.audioEnabled = false; } catch (e7) {} } else P.remove();
            }
            if (!total) return fail(notes.length ? notes.join(", ") + "." : "Nothing to take out.");
            return ok({ count: total, note: notes.join(" · ") });
        });
    };

    // ---------------- Project health + optimizer ----------------
    var AUDIO = /\.(wav|mp3|aif|aiff|m4a|aac|ogg|flac|wma)$/i, IMAGE = /\.(png|jpe?g|psd|tiff?|gif|bmp|exr|tga|webp|ai|eps|svg|heic|dpx)$/i;
    api.craftHealth = function () {
        var p = app.project, unused = 0, missing = [], comps = 0, footage = 0, folders = 0, dirty = null;
        for (var i = 1; i <= p.numItems; i++) {
            var it = p.item(i);
            if (it instanceof CompItem) comps++;
            else if (it instanceof FolderItem) folders++;
            else if (it instanceof FootageItem) {
                footage++;
                if (it.footageMissing) missing.push(it.name);
                else if (!it.usedIn.length) unused++;
            }
        }
        try { if (typeof p.dirty === "boolean") dirty = p.dirty; } catch (e) {}
        var saved = null;
        try { if (p.file && p.file.exists) saved = p.file.modified.getTime(); } catch (e2) {}
        return ok({ items: p.numItems, comps: comps, footage: footage, folders: folders, unused: unused, missing: missing.slice(0, 20), missingCount: missing.length,
            file: p.file ? p.file.fsName : "", dirty: dirty, saved: saved });
    };
    api.craftOptimize = function (o) {
        return undo("Optimize project", function () {
            var p = app.project, r = { removed: 0, consolidated: 0, moved: 0 };
            if (o.consolidate) { try { r.consolidated = p.consolidateFootage(); } catch (e1) {} }
            if (o.removeUnused) { try { r.removed = p.removeUnusedFootage(); } catch (e2) {} }
            if (o.organize) {
                var todo = [];
                for (var i = 1; i <= p.numItems; i++) { var it = p.item(i); if (!(it instanceof FolderItem) && it.parentFolder === p.rootFolder) todo.push(it); }
                for (var k = 0; k < todo.length; k++) {
                    var x = todo[k], name = "Footage";
                    if (x instanceof CompItem) name = "Comps";
                    else if (x.mainSource instanceof SolidSource) name = "Solids";
                    else if (x.file && AUDIO.test(x.file.name)) name = "Audio";
                    else if (x.file && IMAGE.test(x.file.name)) name = "Images";
                    x.parentFolder = rootFolder(name);
                    r.moved++;
                }
                // empty folders left behind
                for (var j = p.numItems; j >= 1; j--) { var f = p.item(j); if (f instanceof FolderItem && f.numItems === 0) { try { f.remove(); r.removed++; } catch (e3) {} } }
            }
            return ok(r);
        });
    };

    // ---------------- Cache: clear RAM, then AE's own "empty disk cache" (it asks first) ----------------
    api.craftCache = function () {
        try { app.purge(PurgeTarget.ALL_CACHES); } catch (e) {}
        var names = ["All Memory & Disk Cache...", "Empty Disk Cache...", "All Memory & Disk Cache"], id = 0;
        for (var i = 0; i < names.length && !id; i++) { try { id = app.findMenuCommandId(names[i]) || 0; } catch (e1) {} }
        if (id) { app.executeCommand(id); return ok({ disk: true }); }
        return ok({ disk: false });
    };

    api.craftPickFolder = function (o) {
        var f = Folder.selectDialog(o.title || "Choose a folder");
        return ok({ path: f ? f.fsName : "" });
    };
    api.craftInfo = function () {
        var c = activeComp();
        return ok({ comp: c ? c.name : "", project: app.project.file ? app.project.file.fsName : "", projectFolder: app.project.file ? app.project.file.parent.fsName : "", version: app.version });
    };

    // ---------------- attach (wrapped so errors come back as JSON) ----------------
    for (var name in api) {
        (function (fnName, fn) {
            JWPAX[fnName] = function (o) { try { return fn(o || {}); } catch (e) { return fail(errText(e)); } };
        })(name, api[name]);
    }
})();
