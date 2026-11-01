(function(root){
  'use strict';
  function validate(words) {
    if(!Array.isArray(words)||!words.length) throw Error('Detect speech or align a transcript first.');
    var lastStart=-Infinity;
    words.forEach(function(w,i){
      if(!String(w.word||'').trim()) throw Error('Word '+(i+1)+' is empty.');
      if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start) throw Error('Check start/end timing for word '+(i+1)+': '+w.word);
      if(w.start<lastStart) throw Error('Word timings must be in speech order. Check '+w.word+'.');
      lastStart=w.start;
    });
  }
  function group(words,options){
    validate(words);options=options||{};
    var smart=options.maxWords===undefined||options.maxWords==='smart';
    var limit=smart?7:Math.max(1,Math.min(7,Math.floor(Number(options.maxWords)||7))), pause=Number(options.pause)||.25;
    var groups=[],current=[];
    function add(part){groups.push({text:part.map(function(x){return x.word.trim();}).join(' '),start:part[0].start,end:Math.max.apply(null,part.map(function(x){return x.end;})),words:part.slice()});}
    function finish(phrase){
      if(!smart){for(var i=0;i<phrase.length;i+=limit)add(phrase.slice(i,i+limit));return;}
      if(phrase.length<=7){add(phrase);return;}
      // Prefer six/seven words; avoid orphan tails and awkward phrase breaks.
      var count=phrase.length,cost=new Array(count+1),choice=new Array(count),base=[0,60,12,8,5,3,0,.5];cost[count]=0;
      for(var at=count-1;at>=0;at--){
        cost[at]=Infinity;
        for(var length=1;length<=7&&at+length<=count;length++){
          var next=at+length,score=base[length]+cost[next];
          if(next<count){
            var last=phrase[next-1].word.toLowerCase().replace(/[^a-z]/g,'');
            if(/^(a|an|the|my|your|our|their|to|of|for|with|and|or|if|that|which|because)$/.test(last))score+=7;
            if(/[,;:]$/.test(phrase[next-1].word))score-=3;
            score-=Math.min(.3,Math.max(0,phrase[next].start-phrase[next-1].end))*12;
          }
          if(score<cost[at]){cost[at]=score;choice[at]=length;}
        }
      }
      for(var begin=0;begin<count;begin+=choice[begin])add(phrase.slice(begin,begin+choice[begin]));
    }
    words.forEach(function(w,i){
      current.push(w);
      var next=words[i+1];
      if(!next||/[.!?。！？]["'”’)]*$/.test(w.word)||next.start-w.end>pause+1e-9){
        finish(current);current=[];
      }
    });
    return groups;
  }
  var api={validate:validate,group:group};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CaptionPlanner=api;
})(typeof window!=='undefined'?window:globalThis);
