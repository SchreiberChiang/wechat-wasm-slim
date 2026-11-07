import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildOfficialConvertRequestDraft} from './official-convert-request-form.mjs';
import {normalizeConfig} from '../../convert/official.mjs';
test('local login checkbox drafts the same default-off public configuration, without execution',()=>{
  const root=path.resolve('MEMORY_ONLY_LOGIN_FORM');
  const base={js:path.join(root,'prepared.js'),wasm:path.join(root,'paired.wasm'),pck:path.join(root,'game.pck'),transformer:path.join(root,'fixed.exe'),interfaces:path.join(root,'original-interfaces.js'),output:path.join(root,'output'),renderMode:'webgl',name:'登录源码检查',locale:'zh_CN',orientation:'portrait',engineProfile:'full-official-c050-capability-dev',removedModules:null};
  const files={configFile:path.join(root,'config.json'),requestFile:path.join(root,'request.json')};
  const off=buildOfficialConvertRequestDraft(base,files);
  assert.deepEqual(buildOfficialConvertRequestDraft({...base,loginCode:false},files),off);
  const on=buildOfficialConvertRequestDraft({...base,loginCode:true},files);
  assert.deepEqual(on.config,{...off.config,loginCode:true});
  assert.deepEqual(on.request,off.request);assert.equal(on.request.purpose,'development-test');
  assert.deepEqual(normalizeConfig(on.config).options,{...normalizeConfig(off.config).options,loginCode:true});
  for(const value of [null,1,'true',{}])assert.throws(()=>buildOfficialConvertRequestDraft({...base,loginCode:value},files),{code:'LOCAL_OFFICIAL_FORM_LOGIN_BOOLEAN'});
  assert.throws(()=>buildOfficialConvertRequestDraft({...base,loginCode:true,autoLogin:true},files),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});
});
