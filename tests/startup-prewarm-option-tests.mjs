import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {describeStartupPrewarm,validateStartupPrewarmRequest} from '../lib/startup-prewarm.mjs';
import {normalizeConfig} from '../convert/official.mjs';

const root=path.resolve('MEMORY_ONLY_PREWARM_OPTION');
const fields={js:path.join(root,'input.js'),wasm:path.join(root,'input.wasm'),pck:path.join(root,'input.pck'),
  transformer:path.join(root,'converter.exe'),interfaces:path.join(root,'interfaces.js'),output:path.join(root,'out'),
  renderMode:'glx',name:'preview',locale:'zh_CN',orientation:'portrait'};
const profiles=['full-official-c050-dev','conservative-official-c050-dev','full-official-c050-capability-dev'];

test('unsupported native switch cannot silently pass through public conversion config',()=>{
  for(const engineProfile of profiles){
    assert.equal(describeStartupPrewarm(engineProfile).support,'REQUIRES_ENGINE_REBUILD');
    for(const renderMode of ['glx','webgl']) assert.throws(()=>normalizeConfig({schema:'wxslim-official-inputs-v1',...fields,renderMode,engineProfile,skipDefault3dPrewarm:true}),{code:'PREWARM_ENGINE_REBUILD_REQUIRED'});
  }
  assert.throws(()=>validateStartupPrewarmRequest(true,'unregistered-engine'),{code:'PREWARM_ENGINE_SUPPORT_UNKNOWN'});
});
test('default and explicitly disabled skip preserve runtime options',()=>{
  const original={schema:'wxslim-official-inputs-v1',...fields,engineProfile:profiles[2]};
  const before=normalizeConfig(original),after=normalizeConfig({...original,skipDefault3dPrewarm:false});
  assert.deepEqual(after.options,before.options);
  delete after.skipDefault3dPrewarm;assert.deepEqual(after,before);
  assert(!Object.hasOwn(before.options,'skipDefault3dPrewarm'));
});
test('invalid types are rejected instead of coercing or ignoring the request',()=>{
  for(const value of [null,0,1,'true','false',[],{}])assert.throws(()=>validateStartupPrewarmRequest(value,profiles[0]),{code:'PREWARM_BOOLEAN_REQUIRED'});
});

test('verified source recipe controls the prewarm status of a self-built pair', () => {
  const profile = 'custom-official-c050-dev';
  for (const recipe of ['official-c050-capability-24', 'official-c050-capability-custom']) {
    const result = describeStartupPrewarm(profile, recipe);
    assert.equal(result.support, 'REQUIRES_ENGINE_REBUILD');
    assert.equal(result.selectable, false);
    assert.throws(() => validateStartupPrewarmRequest(true, profile, recipe), {code: 'PREWARM_ENGINE_REBUILD_REQUIRED'});
  }
  for (const recipe of [undefined, 'different-source']) {
    assert.equal(describeStartupPrewarm(profile, recipe).support, 'UNKNOWN');
  }
});
