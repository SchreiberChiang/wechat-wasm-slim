// Plan and generated-file models only: no directory, compiler, SDK or runtime.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OFFICIAL_CUSTOM_RAW_REQUEST,customRawSourcePlan,rawRecipePlanInput,rawMaterializationProfile,selectedRawProfileBytes} from '../engine/official-custom-source-plan.mjs';
import {officialRawSourceRecipe,OFFICIAL_BASE_RAW_REQUEST,OFFICIAL_CAPABILITY_RAW_REQUEST} from '../engine/official-raw-source-recipe.mjs';
import {officialRawExecutionPlan,normalizeOfficialRawBuildRequest} from '../engine/official-build-preflight.mjs';
import {executeOfficialRawBuild,auditRawGeneratedConfiguration} from '../engine/official-build-raw.mjs';
import {auditCustomDisabledClasses} from '../engine/custom-feature-audit.mjs';
import {officialModuleRequirements} from '../engine/official-module-audit.mjs';
const root=path.resolve('custom-raw-model-not-created');
const features=(extra={})=>({schema:'wxslim-custom-wasm-plan-v1',dimensions:'2d',disabledModules:[],disabledClasses:[],...extra});
const request=(f=features())=>({schema:OFFICIAL_CUSTOM_RAW_REQUEST,profile:'custom',features:f,
 work:path.join(root,'work'),sdk:path.join(root,'sdk'),python:path.join(root,'python.exe'),library:path.join(root,'glx.a'),
 sconsWheel:path.join(root,'scons.whl'),sdkArchive:path.join(root,'sdk.zip'),gitExecutable:path.join(root,'git.exe'),upstreamSource:path.join(root,'storage.js'),jobs:6,budgetBytes:8*2**30});
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const headers=names=>'#pragma once\n'+names.map(n=>'#define MODULE_'+n.toUpperCase()+'_ENABLED\n').join('');
const classHeader=names=>'/* generated model */\n#pragma once\n'+names.map(n=>`class ${n}; template <> struct is_class_enabled<${n}> : std::false_type {};\n`).join('');
const full=officialModuleRequirements('full');
const registration='#include "register_module_types.h"\n#include "modules/modules_enabled.gen.h"\n'+full.moduleDirectories.map(n=>'#include "modules/'+n+'/register_types.h"\n').join('')+
 ['initialize','uninitialize'].map(kind=>'void '+kind+'_modules(ModuleInitializationLevel p_level) {\n'+full.moduleDirectories.map(n=>'#ifdef MODULE_'+n.toUpperCase()+'_ENABLED\n'+kind+'_'+n+'_module(p_level);\n#endif\n').join('')+'}\n').join('');

test('custom request is explicit, normalized, cannot change fixed recipes or inject build settings',()=>{
 const r=request(features({disabledModules:['upnp','enet'],disabledClasses:['Sprite3D','Node3D']}));
 const n=normalizeOfficialRawBuildRequest(r);assert.deepEqual(n.features.disabledModules,['enet','upnp']);assert.deepEqual(n.features.disabledClasses,['Node3D','Sprite3D']);
 assert.deepEqual(r.features.disabledModules,['upnp','enet']);
 for(const changed of [{schema:OFFICIAL_BASE_RAW_REQUEST},{schema:OFFICIAL_CAPABILITY_RAW_REQUEST},{profile:'full'},{features:{...r.features,optimization:'speed'}},{sconsArgs:[]},{features:features({disabledModules:['mbedtls']})}])assert.throws(()=>normalizeOfficialRawBuildRequest({...r,...changed}));
 const {features:unused,...missing}=r;assert.throws(()=>normalizeOfficialRawBuildRequest(missing));
 let calls=0;assert.throws(()=>normalizeOfficialRawBuildRequest({...r,get schema(){calls++;return OFFICIAL_CUSTOM_RAW_REQUEST;}}));
 assert.throws(()=>normalizeOfficialRawBuildRequest({...r,get features(){calls++;return r.features;}}));assert.equal(calls,0);
});

test('custom 2D plan binds exact generated profile, same 33 sources/library/toolchain/command, distinct identity',()=>{
 const r=normalizeOfficialRawBuildRequest(request()),p=officialRawExecutionPlan(r),s=customRawSourcePlan(rawRecipePlanInput(r));
 const {features:unused,...fixed}=r;fixed.schema=OFFICIAL_CAPABILITY_RAW_REQUEST;fixed.profile='full';
 const fp=officialRawExecutionPlan(fixed),source=officialRawSourceRecipe(fixed.schema).plan(rawRecipePlanInput(fixed));
 assert.deepEqual(s.finalOutputs,source.finalOutputs);assert.deepEqual(s.assembly,source.assembly);assert.deepEqual(s.library,source.library);assert.deepEqual(s.toolchain,source.toolchain);
 assert.deepEqual(p.sconsArgs,fp.sconsArgs);assert.notEqual(p.planSha256,fp.planSha256);assert.notEqual(s.selectedProfile.sha256,source.selectedProfile.sha256);
 assert.equal(s.materializationPlanSha256,source.planSha256);assert.equal(rawMaterializationProfile(r),'full');assert.equal(rawMaterializationProfile({...fixed,profile:'conservative'}),'conservative');
 assert.equal(p.moduleRequirements.expectedModules.length,35);assert.equal(p.runtime,'NOT_RUN');assert.equal(p.plannedTerminal.admission,'NOT_ADMITTED');assert.equal(p.executionAuthorized,false);
 assert.equal(officialRawSourceRecipe(r.schema).materialize,officialRawSourceRecipe(fixed.schema).materialize);
 let reads=0;const bytes=selectedRawProfileBytes(s,()=>{reads++;throw Error('must not substitute repository profile');});assert.equal(reads,0);
 assert.deepEqual(pin(bytes),{bytes:s.selectedProfile.bytes,sha256:s.selectedProfile.sha256});assert.equal(JSON.parse(bytes).disabled_build_options.disable_3d,true);
 assert.throws(()=>selectedRawProfileBytes({...s,generatedProfileText:source.generatedProfileText??'{}'},()=>Buffer.from('{}')));
 assert.throws(()=>selectedRawProfileBytes({...s,selectedProfile:{...s.selectedProfile,sha256:'0'.repeat(64)}},()=>Buffer.from('{}')));
 for(const p of ['engine/custom-wasm-plan.mjs','engine/custom-module-selection.mjs','engine/official-custom-source-plan.mjs','engine/custom-feature-audit.mjs'])assert(s.dependencies.some(d=>d.path===p));
 assert.equal(fs.existsSync(root),false);
});

test('feature changes alter build identity while reordered choices normalize to the same plan',()=>{
 const f=features({disabledModules:['upnp','enet'],disabledClasses:['Sprite3D','Node3D']});
 const a=officialRawExecutionPlan(request(f)),b=officialRawExecutionPlan(request({...f,disabledModules:[...f.disabledModules].reverse(),disabledClasses:[...f.disabledClasses].reverse()}));
 assert.deepEqual(a,b);
 for(const change of [{dimensions:'3d'},{disabledModules:['upnp']},{disabledClasses:[]}])assert.notEqual(officialRawExecutionPlan(request({...f,...change})).planSha256,a.planSha256);
});

test('fixed profile snapshot still requires exact repository bytes and custom recipe cannot supply a stale fixed profile',()=>{
 for(const profile of ['full','conservative']){
  const s=officialRawSourceRecipe(OFFICIAL_CAPABILITY_RAW_REQUEST).plan({profile});let reads=[];
  const bytes=selectedRawProfileBytes(s,p=>{reads.push(p);return fs.readFileSync(new URL('../'+p,import.meta.url));});
  assert.deepEqual(reads,[s.selectedProfile.path]);assert.deepEqual(pin(bytes),{bytes:s.selectedProfile.bytes,sha256:s.selectedProfile.sha256});
  assert.throws(()=>selectedRawProfileBytes(s,()=>Buffer.from('{}')));
 }
});

test('generated class parser preserves all names and rejects changed, missing, duplicated or injected declarations',()=>{
 const f=features({disabledClasses:['Sprite3D','Node3D']}),h=classHeader(['Node3D','Sprite3D']);
 const r=auditCustomDisabledClasses({features:f,disabledClassesHeader:h});assert.deepEqual(r.actualClasses,['Node3D','Sprite3D']);assert.equal(r.compiledOut,'NOT_PROVEN');
 for(const bad of [classHeader([]),classHeader(['Node3D']),classHeader(['Node3D','Sprite3D','Sprite3D']),classHeader(['Sprite3D','Node3D']),h.replace('is_class_enabled<Node3D>','is_class_enabled<Sprite3D>'),h+'#define EXTRA 1\n',h.replace('#pragma once','')])assert.throws(()=>auditCustomDisabledClasses({features:f,disabledClassesHeader:bad}));
 assert.equal(auditCustomDisabledClasses({features:features(),disabledClassesHeader:classHeader([])}).actualClasses.length,0);
});

test('raw completion dispatcher reads actual selected modules and classes; rejects full-build declarations for 2D',()=>{
 const r=request(features({disabledClasses:['Sprite3D']})),p=officialRawExecutionPlan(r),read=[];
 const map=new Map([['modules/modules_enabled.gen.h',headers(p.moduleRequirements.expectedModules)],['modules/register_module_types.gen.cpp',registration],['core/disabled_classes.gen.h',classHeader(['Sprite3D'])]]);
 const result=auditRawGeneratedConfiguration(r,p=>{read.push(p);return Buffer.from(map.get(p));});
 assert.equal(result.status,'PASS_CUSTOM_GENERATED_DECLARATIONS_ONLY');assert.equal(result.modules.actualModules.length,35);assert.deepEqual(result.classes.actualClasses,['Sprite3D']);
 assert.equal(result.linkedPairAdmitted,false);assert.equal(result.actualRemovedObjects,'PENDING_COMMAND_OBJECT_REVIEW');assert.deepEqual(read,[...map.keys()]);
 map.set('modules/modules_enabled.gen.h',headers(full.expectedModules));assert.throws(()=>auditRawGeneratedConfiguration(r,p=>Buffer.from(map.get(p))));
 read.length=0;const fixed=auditRawGeneratedConfiguration({schema:OFFICIAL_CAPABILITY_RAW_REQUEST,profile:'full'},p=>{read.push(p);return Buffer.from(map.get(p));});
 assert.equal(fixed.status,'PASS_OFFICIAL_EXPECTED_MODULE_DECLARATIONS_ONLY');assert.equal(read.includes('core/disabled_classes.gen.h'),false);
});

test('custom executor cannot claim a directory or start compilation without explicit write',async()=>{
 await assert.rejects(executeOfficialRawBuild(request(),{write:false}),/RAW_EXPLICIT_WRITE_REQUIRED/);
 assert.equal(fs.existsSync(root),false);
});
