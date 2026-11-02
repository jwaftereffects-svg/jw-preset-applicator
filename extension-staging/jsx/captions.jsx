// Sentence Studio host. Uses the user's complete text layer, including plugin effects.
var SentenceStudio = (function(){
    var template = null;
    var statePath = Folder.userData.fsName+'/FoxStudio/speech-data';
    var savedPath = statePath+'/animation-template.aep';
    function encode(v) {
        if(v===undefined||v===null)return 'null';
        if(typeof v==='string')return '"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\x00-\x1f\u2028\u2029]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';
        if(typeof v==='number')return isFinite(v)?String(v):'null';
        if(typeof v==='boolean')return String(v);
        var out=[],k;if(v instanceof Array){for(k=0;k<v.length;k++)out.push(encode(v[k]));return '['+out.join(',')+']';}
        for(k in v)if(v.hasOwnProperty(k))out.push(encode(k)+':'+encode(v[k]));return '{'+out.join(',')+'}';
    }
    function comp(){var c=app.project.activeItem;if(!(c instanceof CompItem))throw Error('Open a composition first.');return c;}
    function sourceText(l){return l.property('ADBE Text Properties').property('ADBE Text Document');}
    function animatedLeaves(g,out,path){
        for(var i=1;i<=g.numProperties;i++){
            var p=g.property(i);var trail=path.concat([i]);
            if(p.propertyType===PropertyType.PROPERTY){if(p.numKeys)out.push({property:p,path:trail});}
            else animatedLeaves(p,out,trail);
        }
    }
    function resolve(l,path){var p=l;for(var i=0;i<path.length;i++)p=p.property(path[i]);return p;}
    function keys(p){
        var out=[];
        for(var i=1;i<=p.numKeys;i++){
            var k={time:p.keyTime(i),value:p.keyValue(i),inType:p.keyInInterpolationType(i),outType:p.keyOutInterpolationType(i),inEase:p.keyInTemporalEase(i),outEase:p.keyOutTemporalEase(i)};
            try{k.continuous=p.keyTemporalContinuous(i);k.auto=p.keyTemporalAutoBezier(i);}catch(e){}
            out.push(k);
        }
        return out;
    }
    function analyze(l){
        if(!(l instanceof TextLayer))throw Error('Select a text layer with your entrance, exit, and tracking animation.');
        var src=sourceText(l);if(src.numKeys||src.expressionEnabled)throw Error('The template needs static source text. Text animator keyframes are supported.');
        var anim=l.property('ADBE Text Properties').property('ADBE Text Animators');
        var entrance=null,exit=null,tracking=null;
        for(var a=1;a<=anim.numProperties;a++){
            var g=anim.property(a);var ss=g.property('ADBE Text Selectors');
            for(var s=1;s<=ss.numProperties;s++){
                var sel=ss.property(s);
                for(var j=1;j<=sel.numProperties;j++){
                    var p=sel.property(j);
                    if(p.propertyType===PropertyType.PROPERTY&&p.numKeys>=2&&!p.expressionEnabled){
                        if(!entrance)entrance=p;else if(!exit)exit=p;
                    }
                }
            }
            var ap=g.property('ADBE Text Animator Properties').property('ADBE Text Tracking Amount');
            if(ap&&ap.numKeys>=2&&!ap.expressionEnabled)tracking=ap;
        }
        if(!entrance||!exit||!tracking)throw Error('Template needs two animated range selectors and animated Tracking Amount.');
        function descriptor(p){var trail=[],current=p;for(var i=p.propertyDepth;i>0;i--){trail.unshift(current.propertyIndex);current=current.propertyGroup(1);}return {path:trail,keys:keys(p)};}
        var data={name:l.name,entrance:descriptor(entrance),exit:descriptor(exit),tracking:descriptor(tracking),sourceStart:l.startTime,tail:Math.max(0,l.outPoint-exit.keyTime(exit.numKeys))};
        data.fadeOut=exit.keyTime(exit.numKeys)-exit.keyTime(1);
        if(data.fadeOut<=0)throw Error('Template fade-out duration must be positive.');
        return data;
    }
    function findTemplate(){
        if(template){try{template.index;return template;}catch(e){template=null;}}
        for(var i=1;i<=app.project.numItems;i++){
            var item=app.project.item(i);
            if(item instanceof CompItem&&item.comment==='SentenceStudio:template'&&item.numLayers){template=item.layer(1);return template;}
        }
        // Import the saved original without altering its animation.
        var file=File(savedPath);if(!file.exists)throw Error('Select your original text layer and capture it as a template.');
        var opts=new ImportOptions(file);opts.importAs=ImportAsType.PROJECT;
        var folder=app.project.importFile(opts);folder.name='Sentence Studio · Template';
        var candidate=null;
        function scan(f){for(var j=1;j<=f.numItems;j++){var it=f.item(j);if(it instanceof CompItem){for(var k=1;k<=it.numLayers;k++){if(it.layer(k) instanceof TextLayer&&!candidate)candidate=it.layer(k);}}else if(it instanceof FolderItem)scan(it);}}
        scan(folder);if(!candidate)throw Error('No text layer found in saved template.');
        var store=app.project.items.addComp('Sentence Studio · Template',candidate.containingComp.width,candidate.containingComp.height,1,candidate.containingComp.duration,candidate.containingComp.frameRate);
        store.parentFolder=folder;store.comment='SentenceStudio:template';candidate.copyToComp(store);template=store.layer(1);return template;
    }
    function capture(){
        var c=comp(), selected=c.selectedLayers;if(selected.length!==1)throw Error('Select exactly one text layer.');
        var original=selected[0], info=analyze(original);
        app.beginUndoGroup('Capture Sentence Studio template');
        try{
            for(var i=1;i<=app.project.numItems;i++){var previous=app.project.item(i);if(previous instanceof CompItem&&previous.comment==='SentenceStudio:template')previous.comment='SentenceStudio:archived-template';}
            var folder=app.project.items.addFolder('Sentence Studio · Template');
            var store=app.project.items.addComp('Sentence Studio · Template',c.width,c.height,c.pixelAspect,c.duration,c.frameRate);
            store.parentFolder=folder;store.comment='SentenceStudio:template';original.copyToComp(store);template=store.layer(1);
        }finally{app.endUndoGroup();}
        return {name:info.name,fadeOut:info.fadeOut,tail:info.tail};
    }
    function retime(p,data,begin,end,linear){
        var oldStart=data[0].time,oldEnd=data[data.length-1].time;
        while(p.numKeys)p.removeKey(p.numKeys);
        for(var i=0;i<data.length;i++){
            var d=data[i];var time=begin+(d.time-oldStart)/(oldEnd-oldStart)*(end-begin);p.setValueAtTime(time,d.value);
            var n=p.nearestKeyIndex(time);p.setInterpolationTypeAtKey(n,linear?KeyframeInterpolationType.LINEAR:d.inType,linear?KeyframeInterpolationType.LINEAR:d.outType);
            if(linear)continue;
            try{
                var factor=(oldEnd-oldStart)/(end-begin),ie=[],oe=[];
                for(var j=0;j<d.inEase.length;j++){ie.push(new KeyframeEase(d.inEase[j].speed*factor,d.inEase[j].influence));oe.push(new KeyframeEase(d.outEase[j].speed*factor,d.outEase[j].influence));}
                p.setTemporalEaseAtKey(n,ie,oe);if(d.continuous!==undefined)p.setTemporalContinuousAtKey(n,d.continuous);if(d.auto!==undefined)p.setTemporalAutoBezierAtKey(n,d.auto);
            }catch(e){}
        }
    }
    function wrap(l,words,time,limit,layout){
        var p=sourceText(l),doc=p.value;
        var scale=l.property('ADBE Transform Group').property('ADBE Scale').valueAtTime(time,false)[0]/100;
        function set(text){doc.text=text;p.setValue(doc);return l.sourceRectAtTime(time,false).width*Math.abs(scale);}
        var lines=[],line='',breakAt=0;
        if(layout!=='width'&&words.length>=4){
            // Balance using actual rendered widths, while avoiding orphan words.
            var best=Infinity;
            for(var split=2;split<=words.length-2;split++){
                var top=words.slice(0,split).join(' '),bottom=words.slice(split).join(' ');
                var topWidth=set(top),bottomWidth=set(bottom),score=Math.abs(topWidth-bottomWidth)+Math.max(0,Math.max(topWidth,bottomWidth)-limit)*5;
                if(score<best){best=score;breakAt=split;}
            }
        }
        for(var i=0;i<words.length;i++){
            if(i===breakAt&&breakAt>0&&line){lines.push(line);line='';}
            var candidate=line?line+' '+words[i]:words[i];
            if(set(lines.concat([candidate]).join('\r'))>limit&&line){lines.push(line);line=words[i];}else line=candidate;
        }
        if(line)lines.push(line);
        var text=lines.join('\r'),width=set(text);
        // One very long word cannot wrap at a word boundary; fit it by reducing font size.
        if(width>limit){doc=p.value;doc.fontSize=doc.fontSize*limit/width;doc.text=text;p.setValue(doc);}
        return text;
    }
    function build(args){
        var c=comp(),groups=args.groups;if(!groups||!groups.length)throw Error('No caption groups to build.');
        var fade=Number(args.fadeOut),width=Number(args.width);
        if(!isFinite(fade)||fade<=0||fade>20)throw Error('Fade-out must be between 0 and 20 seconds.');
        if(!isFinite(width)||width<.2||width>1)throw Error('Invalid caption width.');
        var frame=1/c.frameRate,last=-1;
        for(var v=0;v<groups.length;v++){
            var g=groups[v];if(!g.words||g.words.length<1||g.words.length>7||!isFinite(g.start)||!isFinite(g.end)||g.start<0||g.end<=g.start||g.start<last)throw Error('Invalid word group '+(v+1));
            if(g.end+fade>=c.duration)throw Error('Composition is too short. Extend it past '+(g.end+fade+.3).toFixed(2)+' seconds.');last=g.start;
        }
        var src=findTemplate(),info=analyze(src),made=[],old=[];
        for(var i=1;i<=c.numLayers;i++)if(c.layer(i).comment==='SentenceStudio:caption')old.push(c.layer(i));
        app.beginUndoGroup('Build Sentence Studio captions');
        try{
            for(var n=0;n<groups.length;n++){
                var group=groups[n];src.copyToComp(c);var l=c.layer(1);made.push(l);l.locked=false;l.enabled=true;l.shy=false;l.guideLayer=false;
                var start=Math.round(group.start/frame)*frame,end=Math.max(start+frame,Math.round(group.end/frame)*frame),finish=end+Math.max(frame,Math.round(fade/frame)*frame);
                l.startTime=info.sourceStart+start-info.entrance.keys[0].time;l.inPoint=start;l.outPoint=Math.min(c.duration,finish+info.tail);
                retime(resolve(l,info.entrance.path),info.entrance.keys,start,end);
                retime(resolve(l,info.exit.path),info.exit.keys,end,finish);
                retime(resolve(l,info.tracking.path),info.tracking.keys,start,finish,true);
                var wordTexts=[];for(var z=0;z<group.words.length;z++)wordTexts.push(String(group.words[z].word));
                var wrapped=wrap(l,wordTexts,finish,c.width*width,args.lineLayout||'balanced');
                l.name=('000'+(n+1)).slice(-3)+' · '+group.text;l.comment='SentenceStudio:caption';l.label=9;
            }
            // Replace only previously generated captions, after all new layers succeed.
            for(var o=0;o<old.length;o++){old[o].locked=false;old[o].remove();}
            for(var q=1;q<=c.numLayers;q++)c.layer(q).selected=false;
            if(made.length)made[0].selected=true;
            return {count:made.length,composition:c.name,fadeOut:fade};
        }catch(e){for(var m=made.length-1;m>=0;m--)try{made[m].remove();}catch(ignore){}throw e;}
        finally{app.endUndoGroup();}
    }
    // ---- Pop-up style: no animation. White TikTok Sans Medium, black outline, "- " before each sentence.
    // Each caption appears on the frame its first word starts and stays until the next caption
    // (or a short hold after its last word when there is a pause). ES3 only, no chained ?: (AE mis-parses it).
    var POPUP_FONT='TikTokSans-Medium';
    function popupFrames(groups,fd,duration){
        var hold=0.4,out=[],i;
        for(i=0;i<groups.length;i++){
            var g=groups[i];
            if(!g.words||g.words.length<1||g.words.length>7||!isFinite(g.start)||!isFinite(g.end)||g.start<0||g.end<=g.start)throw Error('Invalid word group '+(i+1));
            if(i&&g.start<groups[i-1].start)throw Error('Word groups must be in time order.');
        }
        for(i=0;i<groups.length;i++){
            var s=Math.floor(groups[i].start/fd+1e-4);
            var e=Math.round((groups[i].end+hold)/fd);
            if(i+1<groups.length){
                var next=Math.floor(groups[i+1].start/fd+1e-4);
                if(e>next)e=next;
            }
            if(e<s+1)e=s+1;
            if(e*fd>duration+fd/2)throw Error('Composition is too short. Extend it past '+(e*fd+.3).toFixed(2)+' seconds.');
            out.push({startF:s,endF:e});
        }
        return out;
    }
    function stylePopup(prop,text,size){
        var d=prop.value;
        try{d.resetCharStyle();d.resetParagraphStyle();}catch(e){}
        d.text=text;d.font=POPUP_FONT;d.fontSize=size;
        d.applyFill=true;d.fillColor=[1,1,1];
        d.applyStroke=true;d.strokeColor=[0,0,0];d.strokeWidth=Math.max(1,size*0.11);d.strokeOverFill=false;
        d.justification=ParagraphJustification.CENTER_JUSTIFY;d.tracking=0;
        try{d.lineJoinType=LineJoinType.LINE_JOIN_ROUND;}catch(e){}
        prop.setValue(d);
    }
    function buildPopup(args){
        var c=comp(),groups=args.groups;if(!groups||!groups.length)throw Error('No caption groups to build.');
        var fd=c.frameDuration,size=Number(args.popupSize),width=Number(args.width),height=Number(args.popupY);
        if(!isFinite(size)||size<8||size>400)throw Error('Pop-up size must be between 8 and 400 px.');
        if(!isFinite(width)||width<.2||width>1)width=.9;
        if(!isFinite(height)||height<0||height>100)height=50;
        var frames=popupFrames(groups,fd,c.duration),made=[],old=[],fontOk=true;
        for(var i=1;i<=c.numLayers;i++)if(c.layer(i).comment==='SentenceStudio:caption')old.push(c.layer(i));
        app.beginUndoGroup('Build Sentence Studio pop-up captions');
        try{
            for(var n=0;n<groups.length;n++){
                var g=groups[n],f=frames[n],text='- '+g.text,shown=f.startF*fd;
                var l=c.layers.addText(text);made.push(l);
                var prop=l.property('ADBE Text Properties').property('ADBE Text Document');
                // Measure the cap height once with "H" so every caption shares the same baseline (no jumping).
                stylePopup(prop,'H',size);
                if(prop.value.font!==POPUP_FONT)fontOk=false;
                var cap=l.sourceRectAtTime(shown,false);
                stylePopup(prop,text,size);
                var r=l.sourceRectAtTime(shown,false),limit=c.width*width;
                if(r.width>limit){
                    // Keep one line: shrink this caption to fit the safe width.
                    var fit=size*limit/r.width;stylePopup(prop,'H',fit);cap=l.sourceRectAtTime(shown,false);stylePopup(prop,text,fit);r=l.sourceRectAtTime(shown,false);
                }
                var tr=l.property('ADBE Transform Group');
                tr.property('ADBE Anchor Point').setValue([r.left+r.width/2,cap.top+cap.height/2]);
                tr.property('ADBE Position').setValue([c.width/2,c.height*height/100]);
                l.inPoint=shown;l.outPoint=f.endF*fd;
                l.name=('000'+(n+1)).slice(-3)+' · '+g.text;l.comment='SentenceStudio:caption';l.label=9;
            }
            // Replace only previously generated captions, after all new layers succeed.
            for(var o=0;o<old.length;o++){old[o].locked=false;old[o].remove();}
            for(var q=1;q<=c.numLayers;q++)c.layer(q).selected=false;
            if(made.length)made[0].selected=true;
            return {count:made.length,composition:c.name,style:'popup',fontOk:fontOk};
        }catch(e){for(var m=made.length-1;m>=0;m--)try{made[m].remove();}catch(ignore){}throw e;}
        finally{app.endUndoGroup();}
    }
    // ---- Widescreen style: white bold caps (Arial Bold), wide tracking, Difference blend, centered.
    // Words build up one at a time: one layer per caption, Source Text keyframes on each word.
    var WIDE_FONTS=['Arial-BoldMT','Helvetica-Bold','ArialMT'];
    function styleWide(prop,text,size,font){
        var d=prop.value;
        try{d.resetCharStyle();d.resetParagraphStyle();}catch(e){}
        d.text=text;d.font=font;d.fontSize=size;
        d.applyFill=true;d.fillColor=[1,1,1];d.applyStroke=false;
        d.justification=ParagraphJustification.CENTER_JUSTIFY;d.tracking=60;
        return d;
    }
    function buildWidescreen(args){
        var c=comp(),groups=args.groups;if(!groups||!groups.length)throw Error('No caption groups to build.');
        var fd=c.frameDuration,width=Number(args.width),height=Number(args.popupY);
        if(!isFinite(width)||width<.2||width>1)width=.9;
        if(!isFinite(height)||height<0||height>100)height=50;
        var size=Math.round(c.width*0.031);
        var frames=popupFrames(groups,fd,c.duration),made=[],old=[],fontOk=true,font=null;
        for(var i=1;i<=c.numLayers;i++)if(c.layer(i).comment==='SentenceStudio:caption')old.push(c.layer(i));
        app.beginUndoGroup('Build Sentence Studio widescreen captions');
        try{
            for(var n=0;n<groups.length;n++){
                var g=groups[n],f=frames[n],shown=f.startF*fd,full=String(g.text).toUpperCase();
                var l=c.layers.addText(full);made.push(l);
                var prop=l.property('ADBE Text Properties').property('ADBE Text Document');
                if(!font){for(var k=0;k<WIDE_FONTS.length&&!font;k++){prop.setValue(styleWide(prop,'H',size,WIDE_FONTS[k]));if(prop.value.font===WIDE_FONTS[k])font=WIDE_FONTS[k];}if(!font){font=WIDE_FONTS[0];fontOk=false;}}
                // Size from the full sentence so every word step shares one size and baseline.
                var sz=size;prop.setValue(styleWide(prop,full,sz,font));
                var r=l.sourceRectAtTime(shown,false),limit=c.width*width;
                if(r.width>limit)sz=size*limit/r.width;
                prop.setValue(styleWide(prop,'H',sz,font));var cap=l.sourceRectAtTime(shown,false);
                // One keyframe per word: the line grows as each word is spoken (hold keys).
                var built='',lastF=-1;
                for(var w=0;w<g.words.length;w++){
                    built=built?built+' '+String(g.words[w].word).toUpperCase():String(g.words[w].word).toUpperCase();
                    var wf=Math.floor(Number(g.words[w].start)/fd+1e-4);if(!isFinite(wf)||wf<f.startF)wf=f.startF;
                    if(wf>=f.endF)wf=f.endF-1;if(wf<=lastF)wf=lastF;
                    var doc=styleWide(prop,built,sz,font);
                    prop.setValueAtTime(wf*fd,doc);lastF=wf;
                }
                var tr=l.property('ADBE Transform Group');
                // Centre-justified point text is centred on x=0, so the line stays centred as it grows.
                tr.property('ADBE Anchor Point').setValue([0,cap.top+cap.height/2]);
                tr.property('ADBE Position').setValue([c.width/2,c.height*height/100]);
                l.blendingMode=BlendingMode.DIFFERENCE;
                l.inPoint=shown;l.outPoint=f.endF*fd;
                l.name=('000'+(n+1)).slice(-3)+' · '+g.text;l.comment='SentenceStudio:caption';l.label=9;
            }
            for(var o=0;o<old.length;o++){old[o].locked=false;old[o].remove();}
            for(var q=1;q<=c.numLayers;q++)c.layer(q).selected=false;
            if(made.length)made[0].selected=true;
            return {count:made.length,composition:c.name,style:'widescreen',fontOk:fontOk};
        }catch(e){for(var m=made.length-1;m>=0;m--)try{made[m].remove();}catch(ignore){}throw e;}
        finally{app.endUndoGroup();}
    }
    // ---- Custom styles: one builder for every user style (and anything Pop-up / Widescreen can do).
    // style: { font, size (px, 0 = auto), fill [r,g,b], stroke bool, strokeColor [r,g,b], strokeWidth (fraction of size),
    //          caps bool, tracking, blend, wordByWord bool, prefix, y (% from top), shadow bool }
    var BLENDS={normal:'NORMAL',difference:'DIFFERENCE',add:'ADD',screen:'SCREEN',overlay:'OVERLAY',softlight:'SOFT_LIGHT',multiply:'MULTIPLY'};
    function styleDoc(prop,text,s,size,font){
        var d=prop.value;
        try{d.resetCharStyle();d.resetParagraphStyle();}catch(e){}
        d.text=text;d.font=font;d.fontSize=size;
        d.applyFill=true;d.fillColor=s.fill||[1,1,1];
        if(s.stroke){d.applyStroke=true;d.strokeColor=s.strokeColor||[0,0,0];d.strokeWidth=Math.max(.5,size*(Number(s.strokeWidth)||.11));d.strokeOverFill=false;}
        else d.applyStroke=false;
        d.justification=ParagraphJustification.CENTER_JUSTIFY;d.tracking=Number(s.tracking)||0;
        try{d.lineJoinType=LineJoinType.LINE_JOIN_ROUND;}catch(e){}
        return d;
    }
    function addShadow(l,size){
        try{
            var fx=l.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
            var op=fx.property('ADBE Drop Shadow-0002'),dist=fx.property('ADBE Drop Shadow-0004'),soft=fx.property('ADBE Drop Shadow-0005');
            if(op){op.setValue(op.hasMax?op.maxValue*.7:70);}
            if(dist)dist.setValue(Math.max(2,size*.07));
            if(soft)soft.setValue(Math.max(4,size*.18));
        }catch(e){}
    }
    function buildStyled(args){
        var c=comp(),groups=args.groups,s=args.style||{};if(!groups||!groups.length)throw Error('No caption groups to build.');
        var fd=c.frameDuration,width=Number(args.width);
        if(!isFinite(width)||width<.2||width>1)width=.9;
        var height=Number(s.y);if(!isFinite(height)||height<0||height>100)height=50;
        var size=Number(s.size)>0?Number(s.size):Math.round(c.width*.031);
        if(size<4||size>800)throw Error('Text size must be between 4 and 800 px.');
        var frames=popupFrames(groups,fd,c.duration),made=[],old=[],fontOk=true,font=null;
        var caps=!!s.caps,prefix=String(s.prefix||'');
        function txt(t){t=String(t);return caps?t.toUpperCase():t;}
        for(var i=1;i<=c.numLayers;i++)if(c.layer(i).comment==='SentenceStudio:caption')old.push(c.layer(i));
        app.beginUndoGroup('Build captions: '+(s.name||'custom style'));
        try{
            for(var n=0;n<groups.length;n++){
                var g=groups[n],f=frames[n],shown=f.startF*fd,full=txt(prefix+g.text);
                var l=c.layers.addText(full);made.push(l);
                var prop=l.property('ADBE Text Properties').property('ADBE Text Document');
                if(!font){
                    var tries=[s.font||'ArialMT','Arial-BoldMT','ArialMT'];
                    for(var k=0;k<tries.length&&!font;k++){prop.setValue(styleDoc(prop,'H',s,size,tries[k]));if(prop.value.font===tries[k])font=tries[k];}
                    if(!font){font=tries[0];}
                    fontOk=font===(s.font||'ArialMT');
                }
                var sz=size;prop.setValue(styleDoc(prop,full,s,sz,font));
                var r=l.sourceRectAtTime(shown,false),limit=c.width*width;
                if(r.width>limit)sz=size*limit/r.width;
                prop.setValue(styleDoc(prop,'H',s,sz,font));var cap=l.sourceRectAtTime(shown,false);
                if(s.wordByWord){
                    var built=txt(prefix),lastF=-1;
                    for(var w=0;w<g.words.length;w++){
                        var wd=txt(g.words[w].word);
                        built=(w===0)?built+wd:built+' '+wd;
                        var wf=Math.floor(Number(g.words[w].start)/fd+1e-4);if(!isFinite(wf)||wf<f.startF)wf=f.startF;
                        if(wf>=f.endF)wf=f.endF-1;if(wf<=lastF)wf=lastF;
                        prop.setValueAtTime(wf*fd,styleDoc(prop,built,s,sz,font));lastF=wf;
                    }
                } else prop.setValue(styleDoc(prop,full,s,sz,font));
                var tr=l.property('ADBE Transform Group');
                // centre-justified point text is centred on x=0, so the line stays centred as it grows
                tr.property('ADBE Anchor Point').setValue([0,cap.top+cap.height/2]);
                tr.property('ADBE Position').setValue([c.width/2,c.height*height/100]);
                var bm=BLENDS[s.blend||'normal'];if(bm&&bm!=='NORMAL'){try{l.blendingMode=BlendingMode[bm];}catch(e){}}
                if(s.shadow)addShadow(l,sz);
                l.inPoint=shown;l.outPoint=f.endF*fd;
                l.name=('000'+(n+1)).slice(-3)+' · '+g.text;l.comment='SentenceStudio:caption';l.label=9;
            }
            for(var o=0;o<old.length;o++){old[o].locked=false;old[o].remove();}
            for(var q=1;q<=c.numLayers;q++)c.layer(q).selected=false;
            if(made.length)made[0].selected=true;
            return {count:made.length,composition:c.name,style:s.name||'custom',fontOk:fontOk,font:font};
        }catch(e){for(var m=made.length-1;m>=0;m--)try{made[m].remove();}catch(ignore){}throw e;}
        finally{app.endUndoGroup();}
    }
    // Installed fonts for the style editor (AE 2024+ has app.fonts; older versions return an empty list).
    function fontList(){
        var out=[];
        try{
            var fams=app.fonts.allFonts;
            for(var i=0;i<fams.length&&out.length<4000;i++){
                var fam=fams[i];
                for(var j=0;j<fam.length;j++){var f=fam[j];out.push({ps:f.postScriptName,family:f.familyName,style:f.styleName});}
            }
        }catch(e){}
        return out;
    }
    function audioSource(quiet){
        var c=comp(),layers=c.selectedLayers;
        if(layers.length!==1){if(quiet)return null;throw Error('Select one audio, video, or precomp layer in AE.');}
        return layerAudio(c,layers[0],quiet);
    }
    function layerAudio(c,l,quiet){
        if(!l.hasAudio||!l.source){if(quiet)return null;throw Error('Selected layer needs audio.');}
        if(l.source instanceof CompItem)return {kind:'precomp',name:l.name,key:c.id+':'+l.id,compId:c.id,layerId:l.id,offset:l.inPoint,duration:l.outPoint-l.inPoint};
        if(!l.source.file){if(quiet)return null;throw Error('Selected layer has no media source.');}
        if(l.timeRemapEnabled||l.stretch!==100)throw Error('Render time-remapped or stretched audio first, then choose that file.');
        return {kind:'file',key:c.id+':'+l.id,path:l.source.file.fsName,name:l.name,offset:l.inPoint,trimStart:Math.max(0,l.inPoint-l.startTime),duration:l.outPoint-l.inPoint};
    }
    function targetAudio(args){
        for(var i=1;i<=app.project.numItems;i++){var c=app.project.item(i);if(c instanceof CompItem&&c.id===args.compId){
            if(args.compOnly)return {kind:'precomp',compOnly:true,name:c.name,key:'comp:'+c.id,compId:c.id,offset:0,duration:c.duration};
            for(var j=1;j<=c.numLayers;j++)if(c.layer(j).id===args.layerId)return layerAudio(c,c.layer(j),false);
        }}throw Error('This audio target is no longer available. Refresh the picker.');
    }
    function targets(){
        var out=[],active=app.project.activeItem;
        if(active instanceof CompItem){for(var j=1;j<=active.numLayers;j++){var l=active.layer(j);if(l.hasAudio)out.push({name:l.name,type:l.source instanceof CompItem?'Precomp layer':'Audio layer',compId:active.id,layerId:l.id});}}
        for(var i=1;i<=app.project.numItems&&out.length<60;i++){var c=app.project.item(i);if(c instanceof CompItem&&c.hasAudio)out.push({name:c.name,type:'Composition mix',compId:c.id,compOnly:true});}
        return out;
    }
    function timelineTargets(){
        var c=app.project.activeItem;if(!(c instanceof CompItem))return null;
        var layers=[];for(var j=1;j<=c.numLayers;j++){var l=c.layer(j);layers.push({index:j,layerId:l.id,name:l.name,sourceName:l.source?l.source.name:'',hasAudio:!!l.hasAudio});}
        return {compId:c.id,compName:c.name,layers:layers};
    }
    // "Audio Only" isn't a template in every AE version (AE 2026 has "AIFF 48kHz"), so pick what exists.
    function useAudioOutput(om){
        var names=[],pats=[/audio only/i,/^aiff/i,/\bwav\b/i],p,n;
        try{names=om.templates||[];}catch(e){}
        for(p=0;p<pats.length;p++){
            for(n=0;n<names.length;n++){
                if(/^_HIDDEN/.test(names[n])||!pats[p].test(names[n]))continue;
                om.applyTemplate(names[n]);
                return /aiff/i.test(names[n])?'aif':'wav';
            }
        }
        try{om.setSettings({'Format':'WAV'});try{om.setSettings({'Output Audio':'On'});}catch(e2){}return 'wav';}
        catch(e3){throw Error('No audio-only output template found (have: '+names.join(', ')+').');}
    }
    function renderAudio(args){
        var c=null,l=null;
        for(var i=1;i<=app.project.numItems;i++){var item=app.project.item(i);if(item instanceof CompItem&&item.id===args.compId)c=item;}
        if(!c)throw Error('Audio composition is no longer available. Select the layer again.');
        for(var j=1;j<=c.numLayers;j++)if(c.layer(j).id===args.layerId)l=c.layer(j);
        if(!args.compOnly&&(!l||!l.hasAudio))throw Error('Audio layer is no longer available.');
        var rq=app.project.renderQueue;if(rq.rendering)throw Error('Wait until the current render finishes.');
        var outputFolder=Folder(statePath+'/rendered-audio');outputFolder.create();
        var output=null;
        var queued=[],audioFlags=[],q=null;
        try{
            for(var k=1;k<=rq.numItems;k++){var existing=rq.item(k);if(existing.status===RQItemStatus.QUEUED){queued.push(existing);existing.render=false;}}
            if(!args.compOnly)for(var n=1;n<=c.numLayers;n++){var other=c.layer(n);if(other.hasAudio){audioFlags.push({layer:other,enabled:other.audioEnabled});other.audioEnabled=other.id===l.id;}}
            q=rq.items.add(c);q.timeSpanStart=args.compOnly?0:l.inPoint;q.timeSpanDuration=args.compOnly?c.duration:l.outPoint-l.inPoint;
            var om=q.outputModule(1),ext=useAudioOutput(om);
            output=File(outputFolder.fsName+'/selected-'+(args.compOnly?c.id:l.id)+'-'+new Date().getTime()+'.'+ext);
            om.file=output;q.render=true;
            rq.render();if(q.status!==RQItemStatus.DONE||!output.exists)throw Error('Audio render did not complete.');
            return {kind:'rendered',key:args.compOnly?'comp:'+c.id:c.id+':'+l.id,path:output.fsName,name:args.compOnly?c.name:l.name,offset:q.timeSpanStart,trimStart:0,duration:q.timeSpanDuration,compId:c.id,layerId:args.compOnly?null:l.id,compOnly:!!args.compOnly};
        }finally{
            if(q)try{q.remove();}catch(e){}
            for(var a=0;a<audioFlags.length;a++)try{audioFlags[a].layer.audioEnabled=audioFlags[a].enabled;}catch(e){}
            for(var r=0;r<queued.length;r++)try{queued[r].render=true;}catch(e){}
        }
    }
    function call(action,payload){
        try{
            var args=payload?eval('('+payload+')'):{};var result;
            if(action==='configure'){statePath=args.state; savedPath=statePath+'/animation-template.aep'; result={configured:true};}
            else if(action==='capture')result=capture();
            else if(action==='template'){
                if(template){try{template.index;}catch(invalid){template=null;}}
                if(template){var data=analyze(template);result={name:data.name,fadeOut:data.fadeOut,tail:data.tail};}
                else if(File(savedPath).exists)result={name:'Original TEXT animation',fadeOut:2.2,tail:0.2666666667};
                else throw Error('Select your text layer and capture it as a template.');
            }
            else if(action==='audio')result=audioSource();
            else if(action==='targets')result=targets();
            else if(action==='timelineTargets')result=timelineTargets();
            else if(action==='targetAudio')result=targetAudio(args);
            else if(action==='selection'){try{result=audioSource(true);}catch(noComp){result=null;}}
            else if(action==='renderAudio')result=renderAudio(args);
            else if(action==='build')result=build(args);
            else if(action==='popup')result=buildPopup(args);
            else if(action==='widescreen')result=buildWidescreen(args);
            else if(action==='styled')result=buildStyled(args);
            else if(action==='fonts')result=fontList();
            else if(action==='purgeMemory'){try{app.purge(PurgeTarget.IMAGE_CACHES);}catch(purgeErr){} result={purged:true};}
            else if(action==='seek'){var c=comp();c.time=Math.max(0,Math.min(c.duration,args.time));result={time:c.time};}
            else throw Error('Unknown action');
            return encode({ok:true,result:result});
        }catch(e){return encode({ok:false,error:String(e)});}
    }
    return {call:call};
})();
