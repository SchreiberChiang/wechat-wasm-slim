import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildOfficialConvertRequestDraft} from './official-convert-request-form.mjs';
import {normalizeConfig} from '../../convert/official.mjs';
test('prewarm default preserves existing form and forced-on request is rejected',()=>{
  const root=path.resolve('MEMORY_ONLY_PREWARM_FORM');
  const fields={js:path.join(root,'input.js'),wasm:path.join(root,'input.wasm'),pck:path.join(root,'input.pck'),
    transformer:path.join(root,'converter.exe'),interfaces:path.join(root,'interfaces.js'),output:path.join(root,'out'),
    renderMode:'glx',name:'preview',locale:'zh_CN',orientation:'portrait'};
  const files={configFile:path.join(root,'config.json'),requestFile:path.join(root,'request.json')};
  for(const engineProfile of ['full-official-c050-dev','full-official-c050-capability-dev']) for(const loginCode of [false,true]){
    const payload={...fields,engineProfile,removedModules:null,loginCode};
    const before=buildOfficialConvertRequestDraft(payload,files);
    assert.deepEqual(buildOfficialConvertRequestDraft({...payload,skipDefault3dPrewarm:false},files),before);
    assert.deepEqual(normalizeConfig(before.config).options,normalizeConfig(buildOfficialConvertRequestDraft({...payload,skipDefault3dPrewarm:false},files).config).options);
    assert.throws(()=>buildOfficialConvertRequestDraft({...payload,skipDefault3dPrewarm:true},files),{code:'PREWARM_ENGINE_REBUILD_REQUIRED'});
    for(const skipDefault3dPrewarm of [1,null,'false'])assert.throws(()=>buildOfficialConvertRequestDraft({...payload,skipDefault3dPrewarm},files),{code:'PREWARM_BOOLEAN_REQUIRED'});
  }
});
