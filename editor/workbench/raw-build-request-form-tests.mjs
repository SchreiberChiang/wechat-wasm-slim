// Local draft and real common planning only. No selected dependency is opened.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRawBuildRequestDraft,RAW_BUILD_FORM_RECIPES} from './raw-build-request-form.mjs';
import {normalizeOfficialRawBuildRequest,officialRawExecutionPlan} from '../../engine/official-build-preflight.mjs';
import {commandArgs} from './adapter.mjs';
const root=path.resolve('MEMORY_ONLY_RAW_BUILD_FORM_NOT_CREATED');
function fixture(){return {payload:{sourceRecipe:'official-c050-capability-24',profile:'full',work:path.join(root,'new-work'),
  ...Object.fromEntries(['sdk','python','library','sconsWheel','sdkArchive','gitExecutable','upstreamSource'].map(p=>[p,path.join(root,'已选依赖-'+p)])),jobs:6,budgetBytes:8*2**30},
  files:{configFile:path.join(root,'草稿配置.json'),requestFile:path.join(root,'草稿任务.json')}};}
const build=f=>buildRawBuildRequestDraft(f.payload,f.files);
test('both explicit source recipes and module profiles produce the actual shared raw plan without execution',()=>{
  assert.equal(fs.existsSync(root),false);
  for(const recipe of RAW_BUILD_FORM_RECIPES)for(const profile of ['full','conservative']){
    const f=fixture();f.payload.sourceRecipe=recipe.id;f.payload.profile=profile;const draft=build(f),plan=officialRawExecutionPlan(draft.config);
    assert.deepEqual(normalizeOfficialRawBuildRequest(draft.config),draft.config);assert.equal(draft.config.schema,recipe.schema);
    assert.equal(plan.sourceRecipe,recipe.id);assert.equal(plan.request.profile,profile);assert.equal(plan.executionCommand,null);assert.equal(plan.executionAuthorized,false);
    assert.equal(plan.runtime,'NOT_RUN');assert.equal(plan.plannedTerminal.admission,'NOT_ADMITTED');
    assert.deepEqual(draft.request,{schema:'wxslim-task-request-v1',action:'official-raw-engine-build',configFile:f.files.configFile,purpose:'development-test',scope:{}});
    assert.equal(draft.configText,JSON.stringify(draft.config,null,2)+'\n');assert.equal(draft.requestText,JSON.stringify(draft.request,null,2)+'\n');
    assert.deepEqual(commandArgs({repositoryRoot:root,requestFile:f.files.requestFile},'plan'),[path.join(root,'wxslim.mjs'),'task','plan',f.files.requestFile]);
  }
  assert.equal(fs.existsSync(root),false);
});
test('form cannot inject execution authorization, compiler switches, source pins or acceptance scope',()=>{
  for(const extra of [{write:true},{confirmed:true},{purpose:'supported-use'},{scope:{platform:'ios'}},{sconsArgs:[]},{schema:'auto'},{commit:'other'},{skipAudit:true}]){
    const f=fixture();Object.assign(f.payload,extra);assert.throws(()=>build(f),/LOCAL_RAW_FORM_FIELDS/);
  }
  for(const key of Object.keys(fixture().payload)){const f=fixture();delete f.payload[key];assert.throws(()=>build(f),/LOCAL_RAW_FORM_FIELDS/);}
  let reads=0;const f=fixture();Object.defineProperty(f.payload,'sourceRecipe',{enumerable:true,get(){reads++;return 'official-c050-capability-24';}});
  assert.throws(()=>build(f));assert.equal(reads,0);
});
test('explicit custom 2D selection reaches the common raw planner and requires the capability sources',()=>{
  const f=fixture();
  f.payload.profile='custom';
  f.payload.sourceRecipe='official-c050-capability-24';
  f.payload.features=JSON.parse(fs.readFileSync(new URL('../../engine/custom-2d-plan.example.json',import.meta.url)));
  const {config}=build(f);
  assert.equal(config.schema,'wxslim-official-custom-raw-build-request-v1');
  assert.equal(config.features.dimensions,'2d');
  assert.equal(officialRawExecutionPlan(config).sourceRecipe,'official-c050-capability-custom');
  f.payload.sourceRecipe='official-c050-base-20';
  assert.throws(()=>build(f),/LOCAL_RAW_CUSTOM_CAPABILITY_RECIPE_REQUIRED/);
  delete f.payload.features;
  assert.throws(()=>build(f),/LOCAL_RAW_FORM_FIELDS/);
});
test('fixed recipe and profile choices do not silently fall back or upgrade',()=>{
  for(const sourceRecipe of ['latest','auto','full','official-c050-capability-25',null]){const f=fixture();f.payload.sourceRecipe=sourceRecipe;assert.throws(()=>build(f),/LOCAL_RAW_FORM_RECIPE/);}
  for(const profile of ['full-capability','default','auto',null]){const f=fixture();f.payload.profile=profile;assert.throws(()=>build(f),/OFFICIAL_RAW_EXPLICIT_PROFILE/);}
});
test('common path, jobs and budget bounds remain in effect with no inferred local dependencies',()=>{
  for(const key of ['work','sdk','python','library','sconsWheel','sdkArchive','gitExecutable','upstreamSource']){
    for(const value of ['relative','',fixture().payload[key]+'\n']){const f=fixture();f.payload[key]=value;assert.throws(()=>build(f));}
  }
  for(const changed of [{jobs:0},{jobs:17},{jobs:1.5},{budgetBytes:7*2**30},{budgetBytes:21*2**30}]){const f=fixture();Object.assign(f.payload,changed);assert.throws(()=>build(f));}
  for(const changed of [{jobs:1},{jobs:16},{budgetBytes:20*2**30}]){const f=fixture();Object.assign(f.payload,changed);assert.doesNotThrow(()=>build(f));}
});
test('draft paths and data objects reject unknown keys, aliases and getters without side effects',()=>{
  for(const files of [null,{}, {...fixture().files,write:true},{...fixture().files,requestFile:'relative'}]){const f=fixture();f.files=files;assert.throws(()=>build(f));}
  let reads=0;const f=fixture();Object.defineProperty(f.files,'configFile',{enumerable:true,get(){reads++;return path.join(root,'other');}});
  assert.throws(()=>build(f));assert.equal(reads,0);assert.equal(fs.existsSync(root),false);
});
