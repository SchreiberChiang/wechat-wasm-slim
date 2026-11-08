// Source-level/local form models only. No Godot, selected input files or tasks.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOfficialFormDraft,OFFICIAL_FORM_PROFILES,OFFICIAL_FORM_MODULES} from './official-convert-request-form.mjs';
import {normalizeConfig} from '../../convert/official.mjs';
import {getOfficialRecipe,OFFICIAL_C050_PROFILE as FULL,OFFICIAL_C050_CONSERVATIVE_PROFILE as TRIM,OFFICIAL_C050_CAPABILITY_PROFILE as CAPABILITY} from '../../convert/lib/official-engine-admission.mjs';
function fixture(){const root=path.resolve('MEMORY_ONLY_CAPABILITY_FORM');return {payload:{js:path.join(root,'prepared.js'),wasm:path.join(root,'engine.wasm'),pck:path.join(root,'game.pck'),transformer:path.join(root,'transformer.exe'),interfaces:path.join(root,'interfaces.js'),output:path.join(root,'output'),renderMode:'webgl',name:'基础能力验证',locale:'zh_CN',orientation:'portrait',engineProfile:CAPABILITY,removedModules:null},files:{configFile:path.join(root,'config.json'),requestFile:path.join(root,'request.json')}};}
test('new full capability form uses shared profile and remains development-only',()=>{
  const f=fixture(),before=structuredClone(f.payload);
  const r=prepareOfficialFormDraft(f.payload,f.files,{readInventory:()=>assert.fail('full must not use trim declaration reader')});
  assert.equal(r.config.engineProfile,CAPABILITY);assert.equal(normalizeConfig(r.config).engineProfile,CAPABILITY);
  assert.equal(r.request.purpose,'development-test');assert.equal(r.request.action,'official-convert');
  assert(!Object.hasOwn(r.config,'projectUsage'));assert(!Object.hasOwn(r,'executionAuthorized'));assert(!Object.hasOwn(r,'eligible'));
  assert.deepEqual(f.payload,before);assert.deepEqual(getOfficialRecipe(CAPABILITY).allowedPurposes,['inspect','development-test']);
  assert.equal(getOfficialRecipe(CAPABILITY).admission,'NOT_ADMITTED');
});
test('new full requires null trim declaration; no invented capability-trim or ordinary profile',()=>{
  const f=fixture();assert.throws(()=>prepareOfficialFormDraft({...f.payload,removedModules:Object.fromEntries(OFFICIAL_FORM_MODULES.map(p=>[p,'unused']))},f.files),{code:'LOCAL_OFFICIAL_FORM_FULL_USAGE'});
  for(const profile of ['conservative-official-c050-capability-dev','full','latest',undefined])assert.throws(()=>prepareOfficialFormDraft({...f.payload,engineProfile:profile},f.files),{code:'LOCAL_OFFICIAL_FORM_PROFILE'});
  assert.deepEqual(OFFICIAL_FORM_PROFILES,[FULL,TRIM,CAPABILITY,'custom-official-c050-dev']);assert(Object.isFrozen(OFFICIAL_FORM_PROFILES));
});
test('old explicit and legacy full drafts retain their previous profile and do not auto-upgrade',()=>{
  const f=fixture(),old={...f.payload,engineProfile:FULL};assert.equal(prepareOfficialFormDraft(old,f.files).config.engineProfile,FULL);
  const {engineProfile,removedModules,...legacy}=old;assert.equal(prepareOfficialFormDraft(legacy,f.files).config.engineProfile,FULL);
  assert.throws(()=>prepareOfficialFormDraft({...f.payload,purpose:'supported-use'},f.files),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});
});
test('the only panel picks templates through the quick flow and never names an engine profile itself',()=>{
  const dir=new URL('./addons/wxslim_readonly/',import.meta.url);
  assert.deepEqual(fs.readdirSync(dir).filter(name=>name.endsWith('.gd')).sort(),['plugin.gd','preview_panel.gd']);
  const source=fs.readFileSync(new URL('preview_panel.gd',dir),'utf8');
  assert(source.includes('[["full", "完整"], ["conservative", "保守"], ["2d", "2D"]]'));
  for(const mode of ['"requirements"','"receiver"','"status"','"runs"','"cancel"'])assert(source.includes(mode),mode);
  for(const profile of [FULL,TRIM,CAPABILITY,'custom-official-c050-dev'])assert(!source.includes(profile),profile);
  assert(!fs.readFileSync(new URL('plugin.gd',dir),'utf8').includes('preload("panel.gd")'));
});
