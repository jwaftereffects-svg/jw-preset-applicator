(function(root){
  'use strict';
  async function clear(fs,path,stateRoot,wait){
    var folder=path.join(stateRoot,'rendered-audio');
    if(!fs.existsSync(folder))return {removed:0,failed:[]};
    var state=fs.realpathSync(stateRoot),resolved=fs.realpathSync(folder);
    if(fs.lstatSync(folder).isSymbolicLink()||path.relative(state,resolved)!=='rendered-audio')throw Error('Audio cache path is outside the extension data folder.');
    var files=fs.readdirSync(resolved).filter(function(name){return /^selected-\d+-\d+\.(wav|aif)$/i.test(name)&&fs.lstatSync(path.join(resolved,name)).isFile();});
    var removed=0,failed=[];
    for(var attempt=0;attempt<4&&files.length;attempt++){
      failed=[];
      files.forEach(function(name){try{fs.unlinkSync(path.join(resolved,name));removed++;}catch(e){if(e.code!=='ENOENT')failed.push(name);}});
      files=failed;
      if(files.length&&attempt<3)await wait([100,250,500][attempt]);
    }
    return {removed:removed,failed:failed};
  }
  var api={clear:clear};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.AudioCache=api;
})(typeof window!=='undefined'?window:globalThis);
