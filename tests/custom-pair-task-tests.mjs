// Tiny protocol fixtures, never successful custom-engine evidence. The real
// public preparer is separately checked to reject a fabricated raw task.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCustomPairPreparation,prepareCustomPairTask,readCompletedCustomPairTask,CUSTOM_PAIR_PROFILE,CUSTOM_PAIR_CONFIG} from '../lib/custom-pair-task.mjs';
import {createTaskService,runTaskCli,taskPlanIdentity} from '../lib/task-core.mjs';
import {getOfficialRecipe} from '../convert/lib/official-engine-admission.mjs';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const writeJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n');
const taskId='11111111-1111-4111-8111-111111111111';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wxslim-custom-pair-protocol-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('wxslim-custom-pair-protocol-'));fs.rmSync(dir,{recursive:true,force:true});});
 const root=path.join(dir,'raw-task');fs.mkdirSync(root);writeJson(path.join(root,'BUILD.json'),{model:true});
 const config={schema:CUSTOM_PAIR_CONFIG,rawTaskRoot:root,rawTaskId:taskId,outputJs:path.join(dir,'prepared.js'),receipt:path.join(dir,'PAIR.json')};
 const file=path.join(dir,'config.json');writeJson(file,config);
 const js=Buffer.from('PREPARED_JS_PROTOCOL_MODEL_NOT_EXECUTABLE'),bridge=Buffer.from('BRIDGE_MODEL_NOT_INSTALLED');
 const summary={schema:'wxslim-completed-custom-pair-source-check-v1',status:'CUSTOM_PAIR_SOURCE_CHECKED_NOT_ADMITTED',taskId,
  sourceRecipe:'official-c050-capability-custom',buildProvenance:'COMPLETED_CUSTOM_RAW_TASK_RECHECKED',sourceTreeRechecked:true,rawArtifactBytesRechecked:true,
  admission:'NOT_ADMITTED',runtime:'NOT_RUN',phone:'NOT_RUN',executionAuthorized:false,buildExecuted:false,workCreated:false,written:false,
  wasmCopied:false,hostSelected:false,converterAccepted:false,outputJs:pin(js),outputBridge:pin(bridge),
  derivation:{hostProposal:{status:'HOST_SOURCE_PROPOSED_NOT_ADMITTED',admission:'NOT_ADMITTED',hostInstalled:false,converterAccepted:false}},
  evidence:'MODEL_ONLY_NOT_AUTHENTICATED_SOURCE'};
 let sourceCalls=0,rechecks=0,onRecheck=()=>{};
 const api=createCustomPairPreparation({prepareSource:async(work,id)=>{
  sourceCalls++;assert.equal(work,root);assert.equal(id,taskId);
  return {summary:structuredClone(summary),js:Buffer.from(js),bridge:Buffer.from(bridge),recheck:async()=>{rechecks++;await onRecheck();}};
 }});
 const requestFile=path.join(dir,'REQUEST.json'),request={schema:'wxslim-task-request-v1',action:'custom-pair-prepare',configFile:'config.json',purpose:'development-test'};
 writeJson(requestFile,request);
 return {dir,root,file,config,js,bridge,summary,api,requestFile,request,get sourceCalls(){return sourceCalls;},get rechecks(){return rechecks;},
  onRecheck:fn=>{onRecheck=fn;},saveConfig:()=>writeJson(file,config),saveRequest:()=>writeJson(requestFile,request)};
}
const rejected=(run,effects='NONE')=>assert.rejects(run,e=>e.code==='TASK_PAIR_PREPARATION_FAILED'&&e.possibleSideEffects===effects);
const streams=()=>{let out='',err='';return {stdout:{write:s=>out+=s},stderr:{write:s=>err+=s},out:()=>out,err:()=>err};};

test('custom source preparation plans exact two outputs without creating directories or persisting payloads',async t=>{
 const f=fixture(t),files=fs.readdirSync(f.dir),r=await f.api.prepare(f.file);
 assert.equal(r.profile,CUSTOM_PAIR_PROFILE);assert.equal(r.before.status,'CHECKED_NOT_WRITTEN');
 assert.deepEqual(r.plan.outputs,{js:f.config.outputJs,receipt:f.config.receipt});assert.deepEqual(fs.readdirSync(f.dir),files);
 assert.equal(r.before.sourceCheck.evidence,'MODEL_ONLY_NOT_AUTHENTICATED_SOURCE');assert.equal(r.before.wasmCopied,false);
 assert.equal(f.sourceCalls,1);assert.equal(f.rechecks,1);assert(!Object.hasOwn(r,'handle'));
});

test('writes require explicit authorization, re-audit source, verify two files and preserve the raw task',async t=>{
 const f=fixture(t),r=await f.api.prepare(f.file),raw=fs.readFileSync(path.join(f.root,'BUILD.json'));
 await rejected(()=>f.api.execute(r.input,r.before));assert.equal(f.sourceCalls,1);
 const result=await f.api.execute(r.input,r.before,{writeAuthorized:true});assert.equal(f.sourceCalls,2);
 assert.equal(result.status,'SUCCESS');assert.equal(result.taskId,null);assert.equal(result.sourceTaskId,taskId);
 assert.equal(result.artifactState,'PREPARED_NOT_ADMITTED');assert.equal(result.converterAccepted,false);
 assert(fs.readFileSync(f.config.outputJs).equals(f.js));assert(fs.readFileSync(path.join(f.root,'BUILD.json')).equals(raw));
 const receipt=JSON.parse(fs.readFileSync(f.config.receipt));assert.equal(receipt.written,true);assert.equal(receipt.sourceCheck.written,false);
 assert.equal(receipt.hostInstalled,false);assert.deepEqual(receipt.outputBridge,pin(f.bridge));
 assert.deepEqual(fs.readdirSync(f.root),['BUILD.json']);assert.equal(fs.readdirSync(f.dir).filter(x=>x.endsWith('.wasm')).length,0);
 await rejected(()=>f.api.execute(r.input,r.before,{writeAuthorized:true})); // no overwrite or automatic resume
});

test('completed preparation reader reconstructs provenance instead of trusting a saved receipt',async t=>{
 const f=fixture(t),planned=await f.api.prepare(f.file);
 await f.api.execute(planned.input,planned.before,{writeAuthorized:true});const calls=f.sourceCalls;
 const files=fs.readdirSync(f.dir),read=await f.api.readCompleted(f.file);
 assert.equal(f.sourceCalls,calls+1);assert(read.js.equals(f.js));assert(read.bridge.equals(f.bridge));
 assert.equal(read.preparation.status,'PREPARED_FILES_RECHECKED_NOT_ADMITTED');assert.equal(read.preparation.written,false);
 assert.equal(read.preparation.converterAccepted,false);assert.deepEqual(fs.readdirSync(f.dir),files);
 await read.recheck();fs.writeFileSync(f.config.outputJs,'CHANGED');
 await assert.rejects(()=>read.recheck());await rejected(()=>f.api.readCompleted(f.file));
 assert.equal(fs.readFileSync(f.config.outputJs,'utf8'),'CHANGED');
});

test('completed reader refuses modified receipts and changed source even when file hashes were edited together',async t=>{
 for(const change of ['receipt','source','joint']){
  const f=fixture(t),planned=await f.api.prepare(f.file);await f.api.execute(planned.input,planned.before,{writeAuthorized:true});
  const saved=JSON.parse(fs.readFileSync(f.config.receipt));
  if(change==='source')f.summary.sourcePlanSha256='NEW_SOURCE';
  if(change==='receipt')saved.converterAccepted=true;
  if(change==='joint'){const changed=Buffer.from('UNAPPROVED_JS');fs.writeFileSync(f.config.outputJs,changed);saved.outputJs=pin(changed);saved.sourceCheck.outputJs=pin(changed);}
  writeJson(f.config.receipt,saved);await rejected(()=>f.api.readCompleted(f.file));
 }
});

test('production completed reader rejects a model task despite a consistent modeled JS and receipt',async t=>{
 const f=fixture(t),planned=await f.api.prepare(f.file);await f.api.execute(planned.input,planned.before,{writeAuthorized:true});
 await rejected(()=>readCompletedCustomPairTask(f.file));
});

test('changed reviewed selection/configuration or existing output cannot be silently accepted',async t=>{
 for(const change of ['source-summary','config','existing']){
  const f=fixture(t),r=await f.api.prepare(f.file);
  if(change==='source-summary')f.summary.extra='CHANGED_AFTER_PLAN';
  if(change==='config'){f.config.outputJs=path.join(f.dir,'different.js');f.saveConfig();}
  if(change==='existing')fs.writeFileSync(f.config.outputJs,'KEEP');
  await rejected(()=>f.api.execute(r.input,r.before,{writeAuthorized:true}));assert(!fs.existsSync(f.config.receipt));
  if(change==='existing')assert.equal(fs.readFileSync(f.config.outputJs,'utf8'),'KEEP');
 }
});

test('source or file drift after first write preserves partial output and accurate write flags',async t=>{
 const f=fixture(t),r=await f.api.prepare(f.file);
 f.onRecheck(()=>{if(fs.existsSync(f.config.outputJs))throw Error('PRIVATE_SOURCE_CHANGED');});
 await assert.rejects(()=>f.api.execute(r.input,r.before,{writeAuthorized:true}),e=>{
  assert.equal(e.possibleSideEffects,'PARTIAL_OUTPUT_POSSIBLE');assert.deepEqual(e.created,{js:true,receipt:false});
  assert.deepEqual(e.attempted,{js:true,receipt:false});assert(!JSON.stringify(e).includes('PRIVATE_SOURCE_CHANGED'));return true;
 });assert(fs.existsSync(f.config.outputJs));assert(!fs.existsSync(f.config.receipt));
});

test('receipt drift after both writes is detected and retained, not reported as success',async t=>{
 const f=fixture(t),r=await f.api.prepare(f.file);
 f.onRecheck(()=>{if(fs.existsSync(f.config.receipt))fs.writeFileSync(f.config.receipt,'BROKEN');});
 await assert.rejects(()=>f.api.execute(r.input,r.before,{writeAuthorized:true}),e=>{
  assert.deepEqual(e.created,{js:true,receipt:true});assert.equal(e.possibleSideEffects,'PARTIAL_OUTPUT_POSSIBLE');return true;
 });assert.equal(fs.readFileSync(f.config.receipt,'utf8'),'BROKEN');assert(fs.existsSync(f.config.outputJs));
});

test('invalid source/admission claims, payload pins and protected output locations reject before any write',async t=>{
 for(const edit of [f=>f.summary.written=true,f=>f.summary.sourceTreeRechecked=false,f=>f.summary.buildProvenance='CALLER_REPORT',
  f=>f.summary.outputJs.sha256='0'.repeat(64),f=>f.summary.derivation.hostProposal.hostInstalled=true,
  f=>{f.config.outputJs=path.join(f.root,'prepared.js');f.config.receipt=path.join(f.root,'PAIR.json');f.saveConfig();},
  f=>{f.config.receipt=f.config.outputJs;f.saveConfig();},f=>{f.config.outputJs=path.join(f.dir,'absent','out.js');f.config.receipt=path.join(f.dir,'absent','r.json');f.saveConfig();}]){
  const f=fixture(t);edit(f);await rejected(()=>f.api.prepare(f.file));assert(!fs.existsSync(f.config.outputJs));assert(!fs.existsSync(f.config.receipt));
 }
});

test('production entry rejects fake successful task data; protocol fixtures cannot grant converter admission',async t=>{
 const f=fixture(t);await rejected(()=>prepareCustomPairTask(f.file));assert(!fs.existsSync(f.config.outputJs));
 assert.throws(()=>getOfficialRecipe(CUSTOM_PAIR_PROFILE));assert(!fs.existsSync(f.config.receipt));
});

test('real common CLI awaits rejected custom source audit and returns bounded no-write failure',t=>{
 const f=fixture(t),cli=fileURLToPath(new URL('../wxslim.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[cli,'task','plan',f.requestFile],{cwd:os.tmpdir(),encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.equal(r.stdout,'');const result=JSON.parse(r.stderr);
 assert.equal(result.code,'TASK_PAIR_PREPARATION_FAILED');assert.equal(result.possibleSideEffects,'NONE');
 assert.deepEqual(result.filePreparation.created,{js:false,receipt:false});
 assert(!r.stderr.includes(f.dir));assert(!fs.existsSync(f.config.outputJs));assert(!fs.existsSync(f.config.receipt));
});

test('common CLI awaits async custom plan and executes the same bounded preparer once',async t=>{
 const f=fixture(t),service=createTaskService({prepareCustomPair:f.api.prepare,executeCustomPair:f.api.execute});
 const plan=await service.plan(f.requestFile);assert.equal(plan.eligible,true);assert.equal(plan.executionMode,'bounded-files');
 assert.equal(plan.identityScope,'CUSTOM_RAW_BUILD_AND_HOST_NOT_GAME_PACKAGE');assert.equal(plan.control.supported,false);
 const io=streams();assert.equal(await runTaskCli(['plan',f.requestFile],{service,...io}),0);
 assert.equal(JSON.parse(io.out()).action,'custom-pair-prepare');assert.equal(io.err(),'');
 const result=await service.execute(f.requestFile,{write:true,expectedPlanSha256:taskPlanIdentity(plan)});
 assert.equal(result.schema,'wxslim-task-result-v1');assert.equal(result.status,'SUCCESS');assert.equal(result.admission,'NOT_ADMITTED');
 assert.equal(result.action,'custom-pair-prepare');assert.equal(result.profile,CUSTOM_PAIR_PROFILE);
});

test('shared purpose, explicit-write, reviewed-plan and unsupported-control gates remain enforced',async t=>{
 const f=fixture(t),service=createTaskService({prepareCustomPair:f.api.prepare,executeCustomPair:f.api.execute});
 await assert.rejects(()=>service.execute(f.requestFile),e=>e.code==='TASK_WRITE_REQUIRED');
 await assert.rejects(()=>service.execute(f.requestFile,{write:true,expectedPlanSha256:'0'.repeat(64)}),e=>e.code==='TASK_PLAN_CHANGED');
 for(const purpose of ['inspect','supported-use']){
  f.request.purpose=purpose;f.saveRequest();assert.equal((await service.plan(f.requestFile)).eligible,false);
  await assert.rejects(()=>service.execute(f.requestFile,{write:true}),e=>e.code==='TASK_CAPABILITY_DENIED');
 }
 const missing=path.join(f.dir,'do-not-create');
 for(const action of ['status','cancel'])assert.throws(()=>service[action](f.requestFile,{root:missing,taskId, ...(action==='cancel'?{write:true}:{})}),e=>e.code==='TASK_CONTROL_UNSUPPORTED');
 assert(!fs.existsSync(missing));assert(!fs.existsSync(f.config.outputJs));
});
