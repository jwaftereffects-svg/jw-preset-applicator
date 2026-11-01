/*
    JW Preset Applicator Pro - Layer Library (After Effects side)

    Saves selected layers (and everything inside precomps) as a plain data description,
    and rebuilds them in any project. Uses the same layout as Verse Flow's .vrs files,
    so those can be inserted directly:

      { format, version, name, createdAt, originalTimeOrigin,
        sourceComposition: { width, height, pixelAspect, frameRate },
        layers: [ { name, kind, label, startTime, inPoint, outPoint, stretch, ...flags,
                    source: { kind: "solid" | "comp" | "file" | "none", ... },
                    properties: [ node ], parentIndex } ],
        warnings: [] }

      node = { matchName, name, index, add, kind: "group" | "property",
               children | keys + value, expression, expressionEnabled }

    Times of the saved (top-level) layers and their keys are relative to the earliest
    in-point, so inserting just adds the playhead time. Layers inside precomps keep the
    precomp's own times.
*/

var JWLIB = (function () {
    var MAX_DEPTH = 12;

    // ---------------------------------------------------------------- reading layers
    function interpName(t) {
        if (t === KeyframeInterpolationType.HOLD) return "hold";
        if (t === KeyframeInterpolationType.LINEAR) return "linear";
        return "bezier";
    }
    function interpType(s) {
        if (s === "hold") return KeyframeInterpolationType.HOLD;
        if (s === "linear") return KeyframeInterpolationType.LINEAR;
        return KeyframeInterpolationType.BEZIER;
    }

    function serializeValue(p, v) {
        var T = PropertyValueType;
        var vt = p.propertyValueType;
        if (vt === T.SHAPE) {
            return { type: "shape", vertices: v.vertices, inTangents: v.inTangents, outTangents: v.outTangents, closed: v.closed };
        }
        if (vt === T.TEXT_DOCUMENT) {
            var o = { type: "text", text: v.text };
            var fields = ["font", "fontSize", "applyFill", "applyStroke", "strokeWidth", "tracking", "leading", "autoLeading",
                "baselineShift", "fauxBold", "fauxItalic", "allCaps", "smallCaps", "horizontalScale", "verticalScale", "tsume", "strokeOverFill"];
            for (var i = 0; i < fields.length; i++) { try { o[fields[i]] = v[fields[i]]; } catch (e) {} }
            try { if (v.applyFill) o.fillColor = v.fillColor; } catch (e1) {}
            try { if (v.applyStroke) o.strokeColor = v.strokeColor; } catch (e2) {}
            try { o.justification = String(v.justification); } catch (e3) {}
            return o;
        }
        if (vt === T.MARKER) {
            return { type: "marker", comment: v.comment, chapter: v.chapter, url: v.url, frameTarget: v.frameTarget,
                cuePointName: v.cuePointName, duration: v.duration, eventCuePoint: v.eventCuePoint, label: v.label, protectedRegion: v.protectedRegion };
        }
        return v;
    }

    function serializeKeys(p, offset) {
        var keys = [];
        for (var k = 1; k <= p.numKeys; k++) {
            var o = { time: p.keyTime(k) - offset, value: serializeValue(p, p.keyValue(k)) };
            try { o.inType = interpName(p.keyInInterpolationType(k)); o.outType = interpName(p.keyOutInterpolationType(k)); } catch (e) {}
            try {
                var ie = p.keyInTemporalEase(k), oe = p.keyOutTemporalEase(k);
                o.inEase = []; o.outEase = [];
                for (var a = 0; a < ie.length; a++) o.inEase.push({ speed: ie[a].speed, influence: ie[a].influence });
                for (var b = 0; b < oe.length; b++) o.outEase.push({ speed: oe[b].speed, influence: oe[b].influence });
            } catch (e1) {}
            try { o.temporalContinuous = p.keyTemporalContinuous(k); o.temporalAutoBezier = p.keyTemporalAutoBezier(k); } catch (e2) {}
            try {
                if (p.isSpatial) {
                    o.inSpatial = p.keyInSpatialTangent(k); o.outSpatial = p.keyOutSpatialTangent(k);
                    o.spatialContinuous = p.keySpatialContinuous(k); o.spatialAutoBezier = p.keySpatialAutoBezier(k);
                    o.roving = p.keyRoving(k);
                }
            } catch (e3) {}
            keys.push(o);
        }
        return keys;
    }

    // Only what differs from a fresh layer is stored (unchanged settings come back as defaults),
    // except that added items (effects, masks, shape contents) are always kept.
    function serializeGroup(g, offset, depth) {
        var out = [];
        for (var i = 1; i <= g.numProperties; i++) {
            var p;
            try { p = g.property(i); } catch (e) { continue; }
            if (!p) continue;
            var added = g.propertyType === PropertyType.INDEXED_GROUP;
            var node = { matchName: p.matchName, name: p.name, index: i, add: added };
            if (p.propertyType === PropertyType.PROPERTY) {
                var vt = p.propertyValueType;
                if (vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.CUSTOM_VALUE) continue;
                var keyed = false, hasExpr = false, modified = true;
                try { keyed = p.numKeys > 0; } catch (e1) {}
                try { hasExpr = p.canSetExpression && p.expression !== ""; } catch (e2) {}
                try { modified = p.isModified; } catch (e3) {}
                if (!keyed && !hasExpr && !modified) continue;
                node.kind = "property";
                node.keys = keyed ? serializeKeys(p, offset) : [];
                if (!keyed) { try { node.value = serializeValue(p, p.value); } catch (e4) {} }
                if (hasExpr) { node.expression = p.expression; node.expressionEnabled = p.expressionEnabled; }
                try { if (p.matchName === "ADBE Position" && p.dimensionsSeparated) node.separated = true; } catch (e5) {}
                out.push(node);
            } else {
                node.kind = "group";
                node.children = serializeGroup(p, offset, depth);
                try { if (added) node.enabled = p.enabled; } catch (e6) {}
                if (added || node.children.length) out.push(node);
            }
        }
        return out;
    }

    function layerKind(L) {
        if (L instanceof TextLayer) return "text";
        if (L instanceof ShapeLayer) return "shape";
        if (L instanceof CameraLayer) return "camera";
        if (L instanceof LightLayer) return "light";
        try { if (L.nullLayer) return "null"; } catch (e) {}
        try { if (L.adjustmentLayer) return "adjustment"; } catch (e1) {}
        return "av";
    }

    function serializeSource(L, depth, seen, warnings) {
        var s = null;
        try { s = L.source; } catch (e) {}
        if (!s) return { kind: "none" };
        if (s instanceof CompItem) {
            if (depth >= MAX_DEPTH || seen[s.id]) { warnings.push("Skipped a precomp nested too deep: " + s.name); return { kind: "none" }; }
            seen[s.id] = true;
            var c = {
                name: s.name, width: s.width, height: s.height, pixelAspect: s.pixelAspect, duration: s.duration, frameRate: s.frameRate,
                displayStartTime: s.displayStartTime, backgroundColor: s.bgColor, workAreaStart: s.workAreaStart, workAreaDuration: s.workAreaDuration,
                layers: serializeLayers(s, collectAll(s), 0, depth + 1, seen, warnings)
            };
            delete seen[s.id];
            return { kind: "comp", composition: c };
        }
        if (s instanceof FootageItem) {
            if (s.mainSource instanceof SolidSource) {
                return { kind: "solid", name: s.name, color: s.mainSource.color, width: s.width, height: s.height, pixelAspect: s.pixelAspect };
            }
            if (s.file) {
                return { kind: "file", name: s.name, path: s.file.fsName, width: s.width, height: s.height, duration: s.duration, isStill: !!s.mainSource.isStill };
            }
        }
        return { kind: "none" };
    }

    function collectAll(comp) {
        var a = [];
        for (var i = 1; i <= comp.numLayers; i++) a.push(comp.layer(i));
        return a;
    }

    function serializeLayers(comp, layers, offset, depth, seen, warnings) {
        var byIndex = {}, out = [], i;
        for (i = 0; i < layers.length; i++) byIndex[layers[i].index] = i;
        for (i = 0; i < layers.length; i++) {
            var L = layers[i];
            var o = {
                name: L.name, kind: layerKind(L), label: L.label,
                startTime: L.startTime - offset, inPoint: L.inPoint - offset, outPoint: L.outPoint - offset,
                stretch: L.stretch, enabled: L.enabled, solo: L.solo, shy: L.shy, locked: L.locked
            };
            var flags = ["threeDLayer", "guideLayer", "adjustmentLayer", "motionBlur", "collapseTransformation", "timeRemapEnabled", "audioEnabled"];
            for (var f = 0; f < flags.length; f++) { try { o[flags[f]] = L[flags[f]]; } catch (e) {} }
            try { o.blendingMode = enumName(BlendingMode, L.blendingMode); } catch (e1) {}
            try { o.trackMatteType = enumName(TrackMatteType, L.trackMatteType); } catch (e2) {}
            try { o.comment = L.comment; } catch (e3) {}
            o.parentIndex = -1;
            try { if (L.parent && byIndex.hasOwnProperty(L.parent.index)) o.parentIndex = byIndex[L.parent.index]; } catch (e4) {}
            o.source = (o.kind === "text" || o.kind === "shape" || o.kind === "camera" || o.kind === "light") ? { kind: "none" } : serializeSource(L, depth, seen, warnings);
            o.properties = serializeGroup(L, offset, depth);
            out.push(o);
        }
        return out;
    }

    function enumName(E, v) {
        for (var k in E) { try { if (E[k] === v) return k; } catch (e) {} }
        return String(v);
    }

    // ---------------------------------------------------------------- rebuilding layers
    function sameValue(a, b) {
        if (a instanceof Array && b instanceof Array) {
            if (a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
            return true;
        }
        return a === b;
    }

    function toAEValue(p, v) {
        if (v && typeof v === "object" && !(v instanceof Array)) {
            if (v.type === "shape") {
                var sh = new Shape();
                sh.vertices = v.vertices; sh.inTangents = v.inTangents; sh.outTangents = v.outTangents; sh.closed = v.closed;
                return sh;
            }
            if (v.type === "text") {
                var td;
                try { td = p.value; td.text = v.text; } catch (e) { td = new TextDocument(v.text); }
                var fields = ["font", "fontSize", "applyFill", "applyStroke", "fillColor", "strokeColor", "strokeWidth", "tracking", "leading",
                    "autoLeading", "baselineShift", "fauxBold", "fauxItalic", "allCaps", "smallCaps", "horizontalScale", "verticalScale", "tsume", "strokeOverFill"];
                for (var i = 0; i < fields.length; i++) {
                    if (v[fields[i]] === undefined) continue;
                    if (fields[i] === "leading" && v.autoLeading) continue;
                    try { td[fields[i]] = v[fields[i]]; } catch (e1) {}
                }
                try { if (v.justification !== undefined) td.justification = Number(v.justification); } catch (e2) {}
                return td;
            }
            if (v.type === "marker") {
                var m = new MarkerValue(v.comment || "");
                var mf = ["chapter", "url", "frameTarget", "cuePointName", "duration", "eventCuePoint", "label", "protectedRegion"];
                for (var j = 0; j < mf.length; j++) { try { if (v[mf[j]] !== undefined) m[mf[j]] = v[mf[j]]; } catch (e3) {} }
                return m;
            }
        }
        return v;
    }

    function findChild(group, node) {
        var p = null;
        try { p = group.property(node.matchName); } catch (e) {}
        if (!p && node.name) { try { p = group.property(node.name); } catch (e1) {} }
        if (!p && node.index) { try { p = group.property(node.index); if (p && p.matchName !== node.matchName) p = null; } catch (e2) {} }
        return p;
    }

    function applyKeys(p, keys, offset, stats) {
        while (p.numKeys > 0) p.removeKey(1);
        var times = [], k;
        for (k = 0; k < keys.length; k++) {
            var t = keys[k].time + offset;
            times.push(t);
            try { p.setValueAtTime(t, toAEValue(p, keys[k].value)); } catch (e) { stats.skipped++; }
        }
        for (k = 0; k < keys.length; k++) {
            var d = keys[k], idx;
            try { idx = p.nearestKeyIndex(times[k]); } catch (e1) { continue; }
            var anyBezier = d.inType === "bezier" || d.outType === "bezier" || (!d.inType && !d.outType);
            if (anyBezier && d.inEase && d.outEase && d.inEase.length) {
                try {
                    var ie = [], oe = [], a;
                    for (a = 0; a < d.inEase.length; a++) ie.push(new KeyframeEase(d.inEase[a].speed, Math.max(0.1, Math.min(100, d.inEase[a].influence))));
                    for (a = 0; a < d.outEase.length; a++) oe.push(new KeyframeEase(d.outEase[a].speed, Math.max(0.1, Math.min(100, d.outEase[a].influence))));
                    p.setTemporalEaseAtKey(idx, ie, oe);
                } catch (e2) {}
                try { if (d.temporalContinuous !== undefined) p.setTemporalContinuousAtKey(idx, d.temporalContinuous); } catch (e3) {}
                try { if (d.temporalAutoBezier !== undefined) p.setTemporalAutoBezierAtKey(idx, d.temporalAutoBezier); } catch (e4) {}
            }
            try { if (d.inType || d.outType) p.setInterpolationTypeAtKey(idx, interpType(d.inType), interpType(d.outType)); } catch (e5) {}
            try { if (d.inSpatial && d.outSpatial) p.setSpatialTangentsAtKey(idx, d.inSpatial, d.outSpatial); } catch (e6) {}
            try { if (d.spatialContinuous !== undefined) p.setSpatialContinuousAtKey(idx, d.spatialContinuous); } catch (e7) {}
            try { if (d.spatialAutoBezier !== undefined) p.setSpatialAutoBezierAtKey(idx, d.spatialAutoBezier); } catch (e8) {}
            try { if (d.roving && idx > 1 && idx < p.numKeys) p.setRovingAtKey(idx, true); } catch (e9) {}
        }
    }

    function applyNodes(group, nodes, offset, stats) {
        if (!nodes) return;
        // separated position must be switched on before X/Y Position can take values
        for (var s = 0; s < nodes.length; s++) {
            if (nodes[s].matchName === "ADBE Position" && nodes[s].separated) { try { group.property("ADBE Position").dimensionsSeparated = true; } catch (e) {} }
            if (/^ADBE Position_\d$/.test(nodes[s].matchName) && ((nodes[s].keys && nodes[s].keys.length) || nodes[s].value !== undefined)) {
                try { group.property("ADBE Position").dimensionsSeparated = true; } catch (e0) {}
            }
        }
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i], p = null;
            if (n.kind === "group") {
                if (n.add) {
                    try { p = group.addProperty(n.matchName); } catch (e1) { stats.missing.push(n.name || n.matchName); continue; }
                    try { if (n.name && p.name !== n.name) p.name = n.name; } catch (e2) {}
                    try { if (n.enabled === false) p.enabled = false; } catch (e3) {}
                } else {
                    p = findChild(group, n);
                }
                if (p) applyNodes(p, n.children, offset, stats);
                continue;
            }
            p = findChild(group, n);
            if (!p) { stats.skipped++; continue; }
            try {
                if (n.keys && n.keys.length) applyKeys(p, n.keys, offset, stats);
                else if (n.value !== undefined && n.value !== null) {
                    var cur; try { cur = p.value; } catch (e4) {}
                    if (typeof n.value === "object" && !(n.value instanceof Array)) p.setValue(toAEValue(p, n.value));
                    else if (!sameValue(cur, n.value)) p.setValue(n.value);
                }
                stats.props++;
            } catch (e5) { stats.skipped++; }
            if (n.expression) {
                try { p.expression = n.expression; p.expressionEnabled = n.expressionEnabled !== false; } catch (e6) { stats.skipped++; }
            }
        }
    }

    function findFolder(name, parent) {
        parent = parent || app.project.rootFolder;
        for (var i = 1; i <= parent.numItems; i++) {
            var it = parent.item(i);
            if (it instanceof FolderItem && it.name === name) return it;
        }
        var f = app.project.items.addFolder(name);
        f.parentFolder = parent;
        return f;
    }

    var fileCache = {};
    function footageFor(src, stats, folder) {
        var key = String(src.path || src.name).toLowerCase();
        if (fileCache[key]) return fileCache[key];
        // already in the project?
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            try { if (it instanceof FootageItem && it.file && it.file.fsName.toLowerCase() === key) return (fileCache[key] = it); } catch (e) {}
        }
        var item = null, f = new File(src.path || "");
        if (src.path && f.exists) {
            try { item = app.project.importFile(new ImportOptions(f)); } catch (e1) {}
        }
        if (!item) {
            item = app.project.importPlaceholder(src.name || "Missing footage", Math.max(4, src.width || 1920), Math.max(4, src.height || 1080), 30, Math.max(1, src.duration || 10));
            stats.placeholders.push(src.name || src.path);
        }
        try { item.parentFolder = folder; } catch (e2) {}
        return (fileCache[key] = item);
    }

    function buildComp(c, stats, folder, depth) {
        var comp = app.project.items.addComp(c.name || "Comp", Math.max(4, Math.round(c.width || 1920)), Math.max(4, Math.round(c.height || 1080)),
            c.pixelAspect || 1, Math.max(0.05, c.duration || 1), c.frameRate || 30);
        comp.parentFolder = folder;
        try { if (c.backgroundColor) comp.bgColor = c.backgroundColor; } catch (e) {}
        try { if (c.displayStartTime) comp.displayStartTime = c.displayStartTime; } catch (e1) {}
        buildLayers(comp, c.layers || [], 0, stats, folder, depth + 1);
        try { comp.workAreaStart = c.workAreaStart || 0; comp.workAreaDuration = c.workAreaDuration || comp.duration; } catch (e2) {}
        return comp;
    }

    function createLayer(comp, L, stats, folder, depth) {
        var s = L.source || { kind: "none" }, layer;
        if (L.kind === "text") layer = comp.layers.addText("");
        else if (L.kind === "shape") layer = comp.layers.addShape();
        else if (L.kind === "camera") layer = comp.layers.addCamera(L.name || "Camera", [comp.width / 2, comp.height / 2]);
        else if (L.kind === "light") layer = comp.layers.addLight(L.name || "Light", [comp.width / 2, comp.height / 2]);
        else if (L.kind === "null") layer = comp.layers.addNull();
        else if (s.kind === "comp" && s.composition && depth < MAX_DEPTH) layer = comp.layers.add(buildComp(s.composition, stats, folder, depth));
        else if (s.kind === "file") layer = comp.layers.add(footageFor(s, stats, folder));
        else if (s.kind === "solid") {
            var sw = s.width || comp.width, sh = s.height || comp.height;
            // a full-frame solid / adjustment layer is rebuilt at the size of the comp it goes into
            if (stats.fit && depth === 0 && Math.abs(sw - stats.fit.srcW) < 2 && Math.abs(sh - stats.fit.srcH) < 2) { sw = comp.width; sh = comp.height; }
            layer = comp.layers.addSolid(s.color || [0, 0, 0], s.name || L.name || "Solid", Math.max(4, Math.round(sw)),
                Math.max(4, Math.round(sh)), s.pixelAspect || 1, Math.max(comp.duration, 1));
        }
        else if (L.adjustmentLayer || L.kind === "adjustment") layer = comp.layers.addSolid([1, 1, 1], L.name || "Adjustment Layer", comp.width, comp.height, comp.pixelAspect, Math.max(comp.duration, 1));
        else layer = comp.layers.addNull();
        return layer;
    }

    // ---- fitting a preset made in one comp size into another ----
    // fit = { fx, fy, srcW, srcH }: how much wider/taller the target comp is than the original.
    function scaleProp(p, fn) {
        if (!p) return;
        try {
            if (p.numKeys > 0) { for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, fn(p.keyValue(k))); }
            else p.setValue(fn(p.value));
        } catch (e) {}
    }
    function mul2(fx, fy) { return function (v) { var o = v.slice(0); o[0] *= fx; o[1] *= fy; return o; }; }

    function fitToComp(layer, L, fit) {
        if (Math.abs(fit.fx - 1) < 1e-4 && Math.abs(fit.fy - 1) < 1e-4) return;
        var tr = layer.property("ADBE Transform Group");
        if (!tr) return;
        var s = L.source || {}, isComp = s.kind === "comp" && s.composition;
        var fullFrameSolid = s.kind === "solid" && Math.abs(layer.source.width - layer.containingComp.width) < 2 && Math.abs(layer.source.height - layer.containingComp.height) < 2;

        // keep the layer in the same relative spot of the frame
        var pos = tr.property("ADBE Position");
        if (pos && pos.dimensionsSeparated) {
            scaleProp(tr.property("ADBE Position_0"), function (v) { return v * fit.fx; });
            scaleProp(tr.property("ADBE Position_1"), function (v) { return v * fit.fy; });
        } else scaleProp(pos, mul2(fit.fx, fit.fy));

        // a solid rebuilt at the new size: its anchor moves with it
        if (fullFrameSolid) scaleProp(tr.property("ADBE Anchor Point"), mul2(fit.fx, fit.fy));

        // a full-frame precomp: scale it up/down so it still fills the comp
        if (isComp && Math.abs(s.composition.width - fit.srcW) < 2 && Math.abs(s.composition.height - fit.srcH) < 2) {
            var f = Math.max(fit.fx, fit.fy);
            scaleProp(tr.property("ADBE Scale"), mul2(f, f));
        }
    }

    // ---- "Fit to comp size": what Ctrl+Alt+Shift+G (Fit to Comp Height) does, but keeping animation ----
    // For precomps, adjustment layers and full-frame solids / clips: anchor to the centre of the layer,
    // layer to the centre of the comp, scaled so its height matches the comp. Keyframed scale and
    // position are adjusted (every key moved / multiplied the same way) instead of being replaced.
    function shouldFitHeight(layer, L) {
        if (!(layer instanceof AVLayer) || !layer.source) return false;
        if (L.kind === "text" || L.kind === "shape") return false;
        var src = layer.source, comp = layer.containingComp;
        if (!src.width || !src.height) return false;
        if (src instanceof CompItem || layer.adjustmentLayer || L.adjustmentLayer) return true;
        // solids and footage: only ones shaped like the frame (not small boxes or strips)
        var ar = (src.width / src.height) / (comp.width / comp.height);
        return ar > 0.8 && ar < 1.25 && src.height >= comp.height * 0.4;
    }

    function firstValue(p) { return p.numKeys > 0 ? p.keyValue(1) : p.value; }
    function mapProp(p, fn) {
        if (!p) return;
        try {
            if (p.numKeys > 0) { for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, fn(p.keyValue(k))); }
            else p.setValue(fn(p.value));
        } catch (e) {}
    }

    function fitHeight(layer) {
        var tr = layer.property("ADBE Transform Group");
        if (!tr) return false;
        var comp = layer.containingComp, src = layer.source, w = src.width, h = src.height;
        var cx = comp.width / 2, cy = comp.height / 2, want = comp.height / h * 100;

        // anchor to the middle of the layer (left alone if it's animated)
        var ap = tr.property("ADBE Anchor Point");
        if (ap && ap.numKeys === 0) {
            var a = ap.value.slice(0); a[0] = w / 2; a[1] = h / 2;
            try { ap.setValue(a); } catch (e0) {}
        }

        // scale: height matches the comp, flips kept; animated scale is multiplied by the same amount
        var sc = tr.property("ADBE Scale"), s0 = firstValue(sc), base = Math.abs(s0[1]) || 100, f = want / base;
        mapProp(sc, function (v) { var o = v.slice(0); o[0] *= f; o[1] *= f; if (o.length > 2) o[2] *= f; return o; });

        // position: centred; animated position keeps its motion, moved so the first key is centred
        var pos = tr.property("ADBE Position");
        if (pos && pos.dimensionsSeparated) {
            var px = tr.property("ADBE Position_0"), py = tr.property("ADBE Position_1");
            var dx = cx - firstValue(px), dy = cy - firstValue(py);
            mapProp(px, function (v) { return v + dx; });
            mapProp(py, function (v) { return v + dy; });
        } else if (pos) {
            var p0 = firstValue(pos), ddx = cx - p0[0], ddy = cy - p0[1];
            mapProp(pos, function (v) { var o = v.slice(0); o[0] += ddx; o[1] += ddy; return o; });
        }
        return true;
    }

    function buildLayers(comp, list, offset, stats, folder, depth) {
        var made = [];
        // add bottom-most first so the final stack matches the saved order
        for (var i = list.length - 1; i >= 0; i--) {
            var L = list[i], layer;
            try { layer = createLayer(comp, L, stats, folder, depth); } catch (e) { stats.failed.push(L.name); made[i] = null; continue; }
            made[i] = layer;
            try { layer.name = L.name; } catch (e1) {}
            try { if (L.stretch && Math.abs(L.stretch - 100) > 1e-6) layer.stretch = L.stretch; } catch (e2) {}
            try { layer.startTime = (L.startTime || 0) + offset; } catch (e3) {}
            try { if (L.threeDLayer) layer.threeDLayer = true; } catch (e4) {}
            try { if (L.timeRemapEnabled) layer.timeRemapEnabled = true; } catch (e5) {}
            try { if (L.adjustmentLayer) layer.adjustmentLayer = true; } catch (e6) {}
            applyNodes(layer, L.properties, offset, stats);
            if (depth === 0 && stats.fitOn) {
                var fitted = false;
                try { if (shouldFitHeight(layer, L)) fitted = fitHeight(layer); } catch (eFh) {}
                if (fitted) stats.fitCount++;
                // other layers (text, shapes, nulls...) keep their relative spot when the comp size differs
                else if (stats.fit) { try { fitToComp(layer, L, stats.fit); } catch (eFit) {} }
            }
            try { layer.inPoint = (L.inPoint || 0) + offset; } catch (e7) {}
            try { layer.outPoint = (L.outPoint || 0) + offset; } catch (e8) {}
            var flags = ["label", "enabled", "shy", "guideLayer", "motionBlur", "collapseTransformation", "audioEnabled", "comment"];
            for (var f = 0; f < flags.length; f++) { try { if (L[flags[f]] !== undefined) layer[flags[f]] = L[flags[f]]; } catch (e9) {} }
            try { if (L.blendingMode && BlendingMode[L.blendingMode] !== undefined) layer.blendingMode = BlendingMode[L.blendingMode]; } catch (e10) {}
            stats.layers++;
        }
        for (var j = 0; j < list.length; j++) {
            if (!made[j]) continue;
            var pi = list[j].parentIndex;
            if (pi !== undefined && pi >= 0 && made[pi]) { try { made[j].parent = made[pi]; } catch (e11) {} }
            try { if (list[j].trackMatteType && list[j].trackMatteType !== "NO_TRACK_MATTE" && TrackMatteType[list[j].trackMatteType] !== undefined) made[j].trackMatteType = TrackMatteType[list[j].trackMatteType]; } catch (e12) {}
        }
        for (var k = 0; k < list.length; k++) { try { if (made[k] && list[k].locked) made[k].locked = true; } catch (e13) {} }
        return made;
    }

    // ---------------------------------------------------------------- API
    var api = {};

    api.save = function (o) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return { error: "Open a comp first." };
        var sel = comp.selectedLayers;
        if (!sel.length) return { error: "Select the layers or precomps to save." };
        var layers = [];
        for (var i = 0; i < sel.length; i++) layers.push(sel[i]);
        layers.sort(function (a, b) { return a.index - b.index; });
        var origin = 1e9;
        for (var j = 0; j < layers.length; j++) if (layers[j].inPoint < origin) origin = layers[j].inPoint;
        var warnings = [];
        var preset = {
            format: "JWLayerPreset", version: 1, name: o.name || layers[0].name,
            createdAt: new Date().toUTCString(), originalTimeOrigin: origin,
            sourceComposition: { width: comp.width, height: comp.height, pixelAspect: comp.pixelAspect, frameRate: comp.frameRate },
            layers: serializeLayers(comp, layers, origin, 0, {}, warnings),
            warnings: warnings
        };
        return { preset: preset };
    };

    api.insert = function (preset, o) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return { error: "Open a comp first." };
        if (!preset || !preset.layers || !preset.layers.length) return { error: "That preset has no layers." };
        var at = comp.time;
        if (o && o.at === "selected" && comp.selectedLayers.length) at = comp.selectedLayers[0].inPoint;
        var stats = { layers: 0, props: 0, skipped: 0, missing: [], placeholders: [], failed: [], fitOn: !(o && o.fit === false), fitCount: 0 };
        var src = preset.sourceComposition || {};
        if (stats.fitOn && src.width && src.height && (src.width !== comp.width || src.height !== comp.height)) {
            stats.fit = { fx: comp.width / src.width, fy: comp.height / src.height, srcW: src.width, srcH: src.height };
            stats.fitted = src.width + "×" + src.height + " → " + comp.width + "×" + comp.height;
        }
        fileCache = {};
        app.beginUndoGroup("Insert Layer Preset: " + (preset.name || ""));
        try {
            var hasComps = false;
            for (var i = 0; i < preset.layers.length; i++) if (preset.layers[i].source && preset.layers[i].source.kind === "comp") hasComps = true;
            var folder = findFolder("JW Layer Library");
            if (hasComps) folder = findFolder(preset.name || "Preset", folder);
            var before = comp.numLayers;
            var made = buildLayers(comp, preset.layers, at, stats, folder, 0);
            var sel = comp.selectedLayers;
            for (var s = 0; s < sel.length; s++) sel[s].selected = false;
            for (var m = 0; m < made.length; m++) if (made[m]) made[m].selected = true;
        } catch (e) {
            app.endUndoGroup();
            return { error: e.toString() + (e.line ? " (line " + e.line + ")" : "") };
        }
        app.endUndoGroup();
        return { stats: stats };
    };

    return api;
})();
