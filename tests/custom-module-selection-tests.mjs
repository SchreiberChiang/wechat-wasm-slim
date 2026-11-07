import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {customModuleSelection,auditCustomModuleBuffers} from '../engine/custom-module-selection.mjs';
import {officialModuleRequirements,auditOfficialModuleSource} from '../engine/official-module-audit.mjs';
import {planOfficialCapabilitySources} from '../engine/official-capability-source-plan.mjs';
const full=officialModuleRequirements('full'),headers=names=>'#pragma once\n'+names.map(n=>'#define MODULE_'+n.toUpperCase()+'_ENABLED\n').join('');
const registration='#include "register_module_types.h"\n#include "modules/modules_enabled.gen.h"\n'+full.moduleDirectories.map(n=>'#include "modules/'+n+'/register_types.h"\n').join('')+
 ['initialize','uninitialize'].map(kind=>'void '+kind+'_modules(ModuleInitializationLevel p_level) {\n'+full.moduleDirectories.map(n=>'#ifdef MODULE_'+n.toUpperCase()+'_ENABLED\n'+kind+'_'+n+'_module(p_level);\n#endif\n').join('')+'}\n').join('');

test('2D alone accounts for eleven implicit removals, keeping the remaining fixed module set',()=>{
  const p=customModuleSelection({dimensions:'2d',disabledModules:[]});
  assert.deepEqual(p.additionalRemovedFromFull,['csg','fbx','gltf','godot_physics_3d','gridmap','jolt_physics','meshoptimizer','mobile_vr','navigation_3d','vhacd','webxr']);
  assert.equal(p.expectedModules.length,35);assert.equal(p.compiled,false);
  assert(p.sourcePins.some(x=>x.path==='SConstruct'));assert(p.sourcePins.some(x=>x.path==='platform/web/detect.py'));
});
test('required dependencies cascade while optional dependencies do not remove their consumers',()=>{
  const p=customModuleSelection({dimensions:'3d',disabledModules:['ogg','freetype','gltf','basis_universal','svg','jsonrpc','websocket']});
  assert.deepEqual(p.additionalRemovedFromFull,['fbx','ktx','msdfgen','theora','vorbis']);
  assert(p.expectedModules.includes('gdscript'));assert(p.expectedModules.includes('text_server_adv'));
  for(const n of p.additionalRemovedFromFull)assert.equal(p.excluded.find(x=>x.name===n).reasons[0].kind,'MISSING_REQUIRED_MODULE');
});
test('custom module declarations are checked against the requested plan and real registration guards',()=>{
  const config={dimensions:'2d',disabledModules:['ogg']},p=customModuleSelection(config);
  const result=auditCustomModuleBuffers({...config,enabledHeader:headers(p.expectedModules),registration});
  assert.equal(result.status,'PASS_EXPECTED_CUSTOM_DECLARATIONS_ONLY');assert.equal(result.syntheticHeaderIsBuildEvidence,false);assert.equal(result.compilationProven,false);
  for(const names of [full.expectedModules,p.expectedModules.slice(1),p.expectedModules.concat('raycast'),p.expectedModules.concat(p.expectedModules[0])])assert.throws(()=>auditCustomModuleBuffers({...config,enabledHeader:headers(names),registration}));
  assert.throws(()=>auditCustomModuleBuffers({...config,enabledHeader:headers(p.expectedModules)+'#undef MODULE_GDSCRIPT_ENABLED\n',registration}));
  assert.throws(()=>auditCustomModuleBuffers({...config,enabledHeader:headers(p.expectedModules),registration:registration.replace('initialize_gdscript_module','initialize_mbedtls_module')}));
});
test('a default-disabled module remains reported as an explicit request with no fabricated removal from the full build',()=>{
  const p=customModuleSelection({dimensions:'3d',disabledModules:['mono']});
  assert.deepEqual(p.expectedModules,full.expectedModules);assert.deepEqual(p.additionalRemovedFromFull,[]);
  assert.deepEqual(p.excluded.find(x=>x.name==='mono').reasons.map(x=>x.kind),['FIXED_WEB_RELEASE_BASELINE','EXPLICIT_DISABLED_MODULE']);
  for(const disabledModules of [['gdscript'],['mbedtls'],['random'],['ogg','ogg']])assert.throws(()=>customModuleSelection({dimensions:'3d',disabledModules}));
});

const source=process.env.WXSLIM_CUSTOM_MODULE_SOURCE,python=process.env.WXSLIM_FIXED_PYTHON;
test('optional actual authenticated source replay agrees for full, conservative, 2D, every single removable module and a dependency combination',{skip:!source||!python},()=>{
  const plan=planOfficialCapabilitySources({profile:'full'});
  const h=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(h(fs.readFileSync(python)),plan.toolchain.expectedPython.exeSha256);
  const audit=auditOfficialModuleSource({source:path.resolve(source),profile:'full'});assert.equal(audit.status,'PASS_PREPARED_MODULE_SOURCE_ONLY');
  const cases=[];
  for(const dimensions of ['3d','2d']){
    cases.push({dimensions,disabledModules:[]},{dimensions,disabledModules:['gltf','fbx','vhacd','webxr','mobile_vr','enet','upnp']});
    for(const name of full.moduleDirectories.filter(n=>!['gdscript','mbedtls'].includes(n)))cases.push({dimensions,disabledModules:[name]});
    cases.push({dimensions,disabledModules:['ogg','freetype','gltf','basis_universal','svg','jsonrpc','websocket']});
  }
  const run=spawnSync(python,['-B',fileURLToPath(new URL('../engine/custom-module-replay.py',import.meta.url)),path.resolve(source)],{input:JSON.stringify(cases),encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30000});
  assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');const result=JSON.parse(run.stdout);
  assert.equal(result.status,'PASS_FIXED_SOURCE_MODEL_ONLY');assert.equal(result.compilerExecuted,false);assert.equal(result.cases.length,cases.length);
  for(let i=0;i<cases.length;i++)assert.deepEqual(result.cases[i].enabledModules,customModuleSelection(cases[i]).expectedModules,JSON.stringify(cases[i]));
  const live=auditCustomModuleBuffers({dimensions:'3d',disabledModules:[],enabledHeader:fs.readFileSync(path.join(source,'modules/modules_enabled.gen.h')),registration:fs.readFileSync(path.join(source,'modules/register_module_types.gen.cpp'))});
  assert.deepEqual(live.actualModules,full.expectedModules);
  assert.deepEqual(auditOfficialModuleSource({source:path.resolve(source),profile:'full'}),audit);
});
