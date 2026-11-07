// Shared task admission/receipt models only. No raw executor, Git, SDK, compiler,
// converter, target JS/WASM or editor is invoked. Temporary files are tiny receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createTaskService,runTaskCli,taskPlanIdentity} from '../lib/task-core.mjs';
import {readCapabilities} from '../lib/capabilities.mjs';
import {normalizeOfficialRawBuildRequest,officialRawExecutionPlan} from '../engine/official-build-preflight.mjs';
import {officialRawSourceRecipe,OFFICIAL_BASE_RAW_REQUEST,OFFICIAL_CAPABILITY_RAW_REQUEST,OFFICIAL_CUSTOM_RAW_REQUEST} from '../engine/official-raw-source-recipe.mjs';
import {createTask,inspectTask} from '../convert/lib/official-task.mjs';

const ACTION='official-raw-engine-build',CAPABILITY='engine-build-official-raw-dev';
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
const pin=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
function streams(){let out='',err='';return {stdout:{write:s=>out+=s},stderr:{write:s=>err+=s},output:()=>out,error:()=>err};}
function fixture(t,{purpose='development-test',scope={},profile='full',outcome='SUCCESS',saved=true,schema=OFFICIAL_BASE_RAW_REQUEST,features}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wxslim-raw-task-model-'));
  t.after(()=>{
    const absolute=path.resolve(dir);assert.equal(path.dirname(absolute),path.resolve(os.tmpdir()));
    assert(path.basename(absolute).startsWith('wxslim-raw-task-model-'));fs.rmSync(absolute,{recursive:true,force:true});
  });
  const root=path.join(dir,'output'),file=path.join(dir,'task.json'),cfg=path.join(dir,'config.json');
  const request={schema:'wxslim-task-request-v1',action:ACTION,configFile:'config.json',purpose,scope};
  const config={schema,profile,...(features?{features}:{}),work:root,jobs:2,budgetBytes:8*2**30,
    ...Object.fromEntries(['sdk','python','library','sconsWheel','sdkArchive','gitExecutable','upstreamSource'].map(k=>[k,path.join(dir,k)]))};
  write(file,request);write(cfg,config);
  const calls=[],normalizations=[];
  const modelPlan=input=>{
    const plan={schema:'wxslim-official-raw-execution-plan-v1',status:'PLAN_ONLY_EXECUTION_REQUIRES_APPROVED_SCOPE',
      request:structuredClone(input),sourceRecipe:officialRawSourceRecipe(input.schema).id,work:input.work,profile:path.join(input.work,'inputs/profile.gdbuild'),
      runtime:'NOT_RUN',postprocess:'NOT_RUN',admission:'NOT_ADMITTED'};
    return {...plan,planSha256:pin(Buffer.from(JSON.stringify(plan))).sha256};
  };
  const artifactState=outcome==='SUCCESS'?'RAW_CAPTURED_NOT_FINALIZED':outcome==='FAILED'?'RAW_NOT_CAPTURED':'RAW_CAPTURE_PARTIAL';
  let result={status:outcome,terminal:{status:outcome,taskId:'model-raw-task',details:{kind:'OFFICIAL_RAW_BUILD',profile,sourceRecipe:officialRawSourceRecipe(schema).id,
    runtime:'NOT_RUN',postprocess:'NOT_RUN',admission:'NOT_ADMITTED',artifactState,build:{bytes:32,sha256:'a'.repeat(64)}}},
    phases:[{name:'COMPILE',status:outcome==='SUCCESS'?'pass':'fail',wallMs:12,error:{message:'C:/private/compiler-error'}}]};
  const api={normalizeRaw(input){normalizations.push(structuredClone(input));return normalizeOfficialRawBuildRequest(input);},
    planRaw:modelPlan,async executeRaw(input,options){calls.push({input,options});return structuredClone(result);}};
  const service=createTaskService(api),plan=modelPlan(normalizeOfficialRawBuildRequest(config));
  function makeControl(terminal=null){
    const task=createTask(root,{budgetBytes:config.budgetBytes,recipeId:'official-raw:'+plan.planSha256});
    if(saved){fs.mkdirSync(path.join(root,'inputs'));write(path.join(root,'inputs/REQUEST.json'),config);write(path.join(root,'inputs/PLAN.json'),plan);}
    if(terminal){
      const state=terminal==='SUCCESS'?'RAW_CAPTURED_NOT_FINALIZED':terminal==='FAILED'?'RAW_NOT_CAPTURED':'RAW_CAPTURE_PARTIAL';
      const build={schema:'wxslim-official-raw-build-v1',taskId:task.taskId,plan,attempts:1,requestedTerminal:terminal,
        status:'REQUIRES_MATCHING_TASK_TERMINAL',runtime:'NOT_RUN',phone:'NOT_RUN',postprocess:'NOT_RUN',admission:'NOT_ADMITTED',artifactState:state,
        ...(terminal==='FAILED'?{failure:{code:'MODEL_RAW_FAILED',message:'C:/private/compiler-error'}}:{})};
      write(path.join(root,'BUILD.json'),build);
      task.finish(terminal,{kind:'OFFICIAL_RAW_BUILD',profile,sourceRecipe:officialRawSourceRecipe(schema).id,runtime:'NOT_RUN',postprocess:'NOT_RUN',admission:'NOT_ADMITTED',artifactState:state,
        build:pin(fs.readFileSync(path.join(root,'BUILD.json')))});
    }
    return {task,options:{root,taskId:task.taskId}};
  }
  return {dir,root,file,cfg,request,config,api,service,plan,calls,normalizations,makeControl,get result(){return result;}};
}
const boundary=value=>{
  assert.equal(value.admission,'NOT_ADMITTED');assert.equal(value.postprocess,'NOT_RUN');
  assert.equal(value.phone,'NOT_RUN');assert.equal(value.visual,'NOT_VERIFIED');assert.equal(value.packageId,null);
};

test('official raw action is listed and only development-test is eligible without inherited device scope',async t=>{
  const oldScope=readCapabilities().evidence['official-conservative-ios-first-open'].scope;
  const f=fixture(t,{scope:oldScope}),p=f.service.plan(f.file);
  assert.equal(f.service.list().actions.some(a=>a.action===ACTION),true);
  assert.equal(p.profile,'full');assert.equal(p.packageId,null);assert.equal(p.eligible,true);assert.equal(p.executionAuthorized,false);
  assert.deepEqual(p.assessments.map(a=>a.capability),[CAPABILITY]);assert.deepEqual(p.assessments[0].matchedEvidence,[]);
  assert.equal(p.assessments[0].status,'implemented');assert.equal(p.assessments[0].purpose,'development-test');
  assert.equal(fs.existsSync(f.root),false);assert.equal(f.calls.length,0);assert(f.normalizations.length>0);
  for(const purpose of ['inspect','supported-use']){
    write(f.file,{...f.request,purpose});const denied=f.service.plan(f.file);
    assert.equal(denied.eligible,false);assert.deepEqual(denied.assessments[0].matchedEvidence,[]);
    await assert.rejects(f.service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});
  }
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.root),false);
});

test('shared task uses the real custom source plan and does not inherit fixed profile device acceptance',async t=>{
  const features={schema:'wxslim-custom-wasm-plan-v1',dimensions:'2d',disabledModules:['upnp'],disabledClasses:[]};
  const f=fixture(t,{schema:OFFICIAL_CUSTOM_RAW_REQUEST,profile:'custom',features});
  const service=createTaskService({...f.api,planRaw:officialRawExecutionPlan});
  const p=service.plan(f.file);assert.equal(p.profile,'custom');assert.equal(p.sourceRecipe,'official-c050-capability-custom');
  assert.deepEqual(p.plan.request.features,features);assert.equal(p.plan.moduleRequirements.expectedModules.length,34);
  assert.equal(p.eligible,true);assert.equal(p.executionAuthorized,false);assert.equal(p.admission,'NOT_ADMITTED');assert.deepEqual(p.assessments[0].matchedEvidence,[]);
  const s=streams();assert.equal(await runTaskCli(['plan',f.file],{...s,service}),0);assert.deepEqual(JSON.parse(s.output()),p);
  write(f.file,{...f.request,purpose:'supported-use'});assert.equal(service.plan(f.file).eligible,false);
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.root),false);
});

test('custom feature identity survives model execution and receipt checks, changed selection cannot control an old task',async t=>{
  const features={schema:'wxslim-custom-wasm-plan-v1',dimensions:'2d',disabledModules:[],disabledClasses:[]};
  const f=fixture(t,{schema:OFFICIAL_CUSTOM_RAW_REQUEST,profile:'custom',features}),p=f.service.plan(f.file);
  const r=await f.service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(p)});
  assert.equal(r.profile,'custom');assert.equal(r.sourceRecipe,'official-c050-capability-custom');boundary(r);
  assert.deepEqual(f.calls[0].input.features,features);
  const c=f.makeControl('SUCCESS');assert.equal(f.service.status(f.file,c.options).sourceRecipe,r.sourceRecipe);
  write(f.cfg,{...f.config,features:{...features,dimensions:'3d'}});
  assert.throws(()=>f.service.status(f.file,c.options));
});

test('raw model success, failure and cancellation stay raw not-admitted outcomes and omit phase error bodies',async t=>{
  for(const outcome of ['SUCCESS','FAILED','CANCELLED']){
    const f=fixture(t,{outcome});await assert.rejects(f.service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});
    const p=f.service.plan(f.file),r=await f.service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(p)});
    assert.equal(r.status,outcome);assert.equal(r.action,ACTION);assert.equal(r.profile,'full');assert.equal(r.taskId,'model-raw-task');boundary(r);
    assert.equal(r.artifactState,f.result.terminal.details.artifactState);assert.equal(r.engineRun,'NOT_RUN');
    assert.deepEqual(r.build,f.result.terminal.details.build);assert.deepEqual(r.phases,[{name:'COMPILE',status:outcome==='SUCCESS'?'pass':'fail',wallMs:12}]);
    assert(!JSON.stringify(r).includes('private/compiler-error'));assert.equal(f.calls.length,1);
    assert.deepEqual(f.calls[0].input,normalizeOfficialRawBuildRequest(f.config));assert.deepEqual(f.calls[0].options,{write:true});
    assert.equal(fs.existsSync(f.root),false,'model executor does not create a build');
  }
});

test('raw executor terminal kind/profile/runtime/build and raw admission boundaries cannot be forged',async t=>{
  for(const mutate of [
    r=>{r.terminal.status='FAILED';},r=>{r.terminal.details.kind='FIXED_ENGINE_BUILD';},r=>{r.terminal.details.profile='conservative';},
    r=>{r.terminal.details.sourceRecipe='other-recipe';},r=>{delete r.terminal.details.sourceRecipe;},
    r=>{r.terminal.details.runtime='RUN';},r=>{r.terminal.details.postprocess='PASS';},r=>{r.terminal.details.admission='ADMITTED';},
    r=>{r.terminal.details.artifactState='FINALIZED';},r=>{delete r.terminal.details.build;},r=>{r.terminal.details.build.bytes=0;},
  ]){const f=fixture(t);mutate(f.result);await assert.rejects(f.service.execute(f.file,{write:true}));assert.equal(f.calls.length,1);}
});

test('capability raw recipe is visible and bound in shared plan, result and status without inheriting acceptance',async t=>{
  const f=fixture(t,{schema:OFFICIAL_CAPABILITY_RAW_REQUEST}),p=f.service.plan(f.file);
  assert.equal(p.sourceRecipe,'official-c050-capability-24');assert.equal(p.eligible,true);assert.equal(p.executionAuthorized,false);
  assert.deepEqual(p.assessments[0].matchedEvidence,[]);assert.equal(p.profile,'full');
  const r=await f.service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(p)});
  assert.equal(r.sourceRecipe,p.sourceRecipe);assert.equal(r.admission,'NOT_ADMITTED');assert.equal(r.engineRun,'NOT_RUN');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].input.schema,OFFICIAL_CAPABILITY_RAW_REQUEST);
  const c=f.makeControl('SUCCESS'),s=f.service.status(f.file,c.options);assert.equal(s.sourceRecipe,p.sourceRecipe);
  assert.equal(s.admission,'NOT_ADMITTED');assert.equal(s.processLiveness,'NOT_OBSERVED');
  // A model success never launches Git, a compiler, target engine or SDK.
});

test('raw historical controls require both snapshots, current recipe budget, and keep progress as read-only evidence',t=>{
  const f=fixture(t),c=f.makeControl(),r=f.service.status(f.file,c.options);
  assert.equal(r.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');assert.equal(r.status,'NO_TERMINAL_RECEIPT');
  assert.equal(r.recipeId,'official-raw:'+f.plan.planSha256);assert.equal(r.profile,'full');assert.equal(r.admission,'NOT_ADMITTED');
  assert.equal(r.processLiveness,'NOT_OBSERVED');assert.equal(r.progress.scope,'LAST_RECORDED_EVENT_NOT_LIVENESS_OR_TERMINAL');
  c.task.event({stage:'COMPILE',status:'RUNNING',details:{private:'C:/private/compiler-error'}});
  const progressed=f.service.status(f.file,c.options);assert.equal(progressed.progress.lastEvent.stage,'COMPILE');
  assert(!JSON.stringify(progressed).includes('private/compiler-error'));
  assert.throws(()=>f.service.cancel(f.file,c.options),{code:'TASK_WRITE_REQUIRED'});
  const cancel=f.service.cancel(f.file,{...c.options,write:true});assert.equal(cancel.cancel.accepted,true);
  assert.equal(cancel.status,'CANCEL_REQUESTED');assert.equal(c.task.readCancellationRequested(),true);assert.equal(f.calls.length,0);
});

test('raw controls with either missing execution snapshot never enable cancellation',t=>{
  for(const missing of ['both','request','plan']){
    const f=fixture(t,{saved:false}),c=f.makeControl();
    if(missing!=='both'){fs.mkdirSync(path.join(f.root,'inputs'));write(path.join(f.root,'inputs',missing==='request'?'PLAN.json':'REQUEST.json'),missing==='request'?f.plan:f.config);}
    assert.equal(f.service.status(f.file,c.options).inputBinding,'MISSING_EXECUTION_SNAPSHOT');
    assert.throws(()=>f.service.cancel(f.file,{...c.options,write:true}),{code:'TASK_CONTROL_BINDING_INCOMPLETE'});
    assert.equal(c.task.readCancellationRequested(),false);
  }
});

test('raw terminal receipts preserve success/failure/cancel and never upgrade captured bytes to engine admission',t=>{
  for(const status of ['SUCCESS','FAILED','CANCELLED']){
    const f=fixture(t),c=f.makeControl(status),r=f.service.status(f.file,c.options);
    assert.equal(r.status,status);assert.equal(r.terminalPresent,true);assert.equal(r.admission,'NOT_ADMITTED');
    assert.equal(r.postprocess,'NOT_RUN');assert.equal(r.artifactState,status==='SUCCESS'?'RAW_CAPTURED_NOT_FINALIZED':status==='FAILED'?'RAW_NOT_CAPTURED':'RAW_CAPTURE_PARTIAL');
    assert(!JSON.stringify(r).includes('private/compiler-error'));
    assert.equal(f.service.cancel(f.file,{...c.options,write:true}).cancel.alreadyEnded,true);
    fs.appendFileSync(path.join(f.root,'BUILD.json'),' ');assert.throws(()=>f.service.status(f.file,c.options));
  }
});

test('raw owner, budget, plan, request and selected target drift reject status and cancellation',t=>{
  for(const target of ['recipe','budget','plan','request','config','taskId','root']){
    const f=fixture(t),c=f.makeControl();
    if(target==='recipe'||target==='budget'){
      const name=path.join(f.root,'TASK.json'),owner=inspectTask(f.root,c.task.taskId).owner;
      write(name,{...owner,...(target==='recipe'?{recipeId:'fixed-engine:'+f.plan.planSha256}:{budgetBytes:owner.budgetBytes+1})});
    }else if(target==='plan')write(path.join(f.root,'inputs/PLAN.json'),{...f.plan,planSha256:'0'.repeat(64)});
    else if(target==='request')write(path.join(f.root,'inputs/REQUEST.json'),{...f.config,jobs:3});
    else if(target==='config')write(f.cfg,{...f.config,jobs:3});
    else if(target==='taskId')c.options.taskId='different-task';
    else{const other=path.join(f.dir,'other');fs.mkdirSync(other);c.options.root=other;}
    assert.throws(()=>f.service.status(f.file,c.options));assert.throws(()=>f.service.cancel(f.file,{...c.options,write:true}));
    assert.equal(fs.existsSync(path.join(f.root,'cancel.json')),false);
  }
});

test('raw terminal and BUILD metadata pins and boundary fields reject tampering',t=>{
  const cases=[
    ['terminal',v=>{v.details.kind='OFFICIAL_ENGINE_BUILD';}],['terminal',v=>{v.details.profile='conservative';}],
    ['terminal',v=>{v.details.runtime='RUN';}],['terminal',v=>{v.details.postprocess='PASS';}],['terminal',v=>{v.details.admission='ADMITTED';}],
    ['terminal',v=>{v.details.artifactState='FINALIZED';}],['terminal',v=>{v.details.build.bytes++;}],['terminal',v=>{delete v.details.build;}],
    ['build',v=>{v.schema='wxslim-fixed-build-v1';}],['build',v=>{v.taskId='different-task';}],['build',v=>{v.plan.request.profile='conservative';}],
    ['build',v=>{v.runtime='RUN';}],['build',v=>{v.postprocess='PASS';}],['build',v=>{v.admission='ADMITTED';}],['build',v=>{v.artifactState='RAW_NOT_CAPTURED';}],
  ];
  for(const [which,mutate]of cases){
    const f=fixture(t),c=f.makeControl('SUCCESS'),terminalFile=path.join(f.root,'terminal.json'),buildFile=path.join(f.root,'BUILD.json');
    const file=which==='terminal'?terminalFile:buildFile,value=JSON.parse(fs.readFileSync(file));mutate(value);write(file,value);
    if(which==='build'){const terminal=JSON.parse(fs.readFileSync(terminalFile));terminal.details.build=pin(fs.readFileSync(buildFile));write(terminalFile,terminal);}
    assert.throws(()=>f.service.status(f.file,c.options));assert.throws(()=>f.service.cancel(f.file,{...c.options,write:true}));
  }
});

test('raw config/resume or dependency plan drift cannot reuse an earlier expected-plan confirmation',async t=>{
  const f=fixture(t),before=f.service.plan(f.file),original=f.api.planRaw;
  const changed=createTaskService({...f.api,planRaw:input=>({...original(input),planSha256:'b'.repeat(64)})});
  await assert.rejects(changed.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(before)}),{code:'TASK_PLAN_CHANGED'});
  assert.equal(f.calls.length,0);
  write(f.cfg,{...f.config,schema:'wxslim-official-raw-resume-v1',parentWork:f.root});
  assert.throws(()=>f.service.plan(f.file));assert.equal(f.calls.length,0);
});

test('raw CLI keeps explicit write and expected-plan gates, terminal exit statuses and structured errors',async t=>{
  const f=fixture(t),io=streams();
  assert.equal(await runTaskCli(['execute',f.file],{...io,service:f.service}),1);assert.equal(JSON.parse(io.error()).code,'TASK_ARGUMENT_INVALID');
  assert.equal(f.calls.length,0);
  const p=f.service.plan(f.file),bad=streams();assert.equal(await runTaskCli(['execute',f.file,'--write','--expected-plan-sha256','0'.repeat(64)],{...bad,service:f.service}),1);
  assert.equal(JSON.parse(bad.error()).code,'TASK_PLAN_CHANGED');assert.equal(f.calls.length,0);
  const malformed=streams();assert.equal(await runTaskCli(['execute',f.file,'--write','--expected-plan-sha256','ABC'],{...malformed,service:f.service}),1);
  assert.equal(JSON.parse(malformed.error()).code,'TASK_ARGUMENT_INVALID');assert.equal(f.calls.length,0);
  const ok=streams();assert.equal(await runTaskCli(['execute',f.file,'--write','--expected-plan-sha256',taskPlanIdentity(p)],{...ok,service:f.service}),0);
  assert.equal(JSON.parse(ok.output()).admission,'NOT_ADMITTED');assert.equal(f.calls.length,1);
  for(const [outcome,exit]of [['FAILED',1],['CANCELLED',2]]){
    const other=fixture(t,{outcome}),s=streams();assert.equal(await runTaskCli(['execute',other.file,'--write'],{...s,service:other.service}),exit);
    assert.equal(JSON.parse(s.output()).status,outcome);assert.equal(JSON.parse(s.output()).admission,'NOT_ADMITTED');
  }
});
