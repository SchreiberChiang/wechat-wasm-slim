import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createTaskService,readTaskRequest,runTaskCli,taskPlanIdentity} from '../lib/task-core.mjs';
import {readCapabilities} from '../lib/capabilities.mjs';
import {assertExpectedPreflight} from '../convert/official-execute.mjs';
import {repo} from '../engine/alpha-preserve-lighting/delivery.mjs';
import {removedFeatures} from '../engine/fixed-engine-plan.mjs';
import {createTask,inspectTask,requestCancellation} from '../convert/lib/official-task.mjs';
import {createHash} from 'node:crypto';
import {readConfiguration} from '../convert/official.mjs';
import {STORAGE_PROFILE} from '../convert/lib/storage-adapter.mjs';
import {getRecipeIdentity,OFFICIAL_C050_PROFILE,isDevelopmentEngineProfile} from '../convert/lib/official-engine-admission.mjs';

const oldScope=readCapabilities().evidence['official-conservative-ios-first-open'].scope;
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x));
function fixture(t,{action='official-convert',purpose='development-test',scope={},profile='full'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wxslim-task-contract-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('wxslim-task-contract-'));fs.rmSync(dir,{recursive:true,force:true});});
  const cfg=path.join(dir,'config.json'),file=path.join(dir,'task.json');
  const raw={schema:'wxslim-task-request-v1',action,configFile:'config.json',purpose,scope};
  const config=action==='fixed-engine-build'?{schema:'wxslim-fixed-execution-v1',inputs:{schema:'wxslim-fixed-build-inputs-v1',profile,work:'output',sdk:'sdk',python:'python.exe',editor:'godot.exe',library:'glx.a',jobs:4,
    ...(profile==='conservative'?{requirements:{schema:'wxslim-engine-requirements-v1',features:Object.fromEntries(removedFeatures.map(k=>[k,'unused']))}}:{})},sconsWheel:'scons.whl',sdkArchive:'sdk.zip',gitExecutable:'git.exe',budgetBytes:8*2**30}:{};
  write(file,raw);write(cfg,config);return {dir,cfg,file,raw,config};
}
function officialAdapter(f,{packageId='wxslim-fixture-unobserved',mode='glx',profile='full',status='SUCCESS'}={}){
  const before={expectedManifest:{packageVersion:packageId},engineContract:{profile},snapshot:{files:{pck:{bytes:1,sha256:'a'.repeat(64)}}}};
  const calls=[];
  const api={readOfficial:()=>({options:{renderMode:mode},output:path.join(f.dir,'output')}),checkOfficial:()=>structuredClone(before),
    planOfficial:()=>({writes:['fixture-only'],executionAuthorized:false}),
    executeOfficial:async(input,options)=>{calls.push({input,options});assertExpectedPreflight(before,options.expectedPreflight);
      return {schema:'wxslim-official-execution-summary-v1',taskId:'fixture',packageId,engineContract:{profile},status,elapsedMs:1,logicalBytes:1};}};
  return {api,before,calls};
}
function streams(){let out='',err='';return {stdout:{write:s=>out+=s},stderr:{write:s=>err+=s},output:()=>out,error:()=>err};}
test('official login opt-in adds its development gate without granting runtime or business acceptance',t=>{
  const f=fixture(t),stub=officialAdapter(f,{profile:OFFICIAL_C050_PROFILE});
  const originalRead=stub.api.readOfficial;
  const service=createTaskService(stub.api),off=service.plan(f.file);
  assert(!off.assessments.some(a=>a.capability==='login-code'));
  const onService=createTaskService({...stub.api,readOfficial:()=>{const input=originalRead();input.options.loginCode=true;return input;}});
  const on=onService.plan(f.file),login=on.assessments.find(a=>a.capability==='login-code');
  assert(login);assert.equal(login.status,'implemented');assert.equal(login.eligible,true);
  assert.equal(on.executionAuthorized,false);assert.equal(on.phone,'NOT_RUN');assert.equal(stub.calls.length,0);
  write(f.file,{...f.raw,purpose:'supported-use'});
  assert.equal(onService.plan(f.file).eligible,false);assert.equal(stub.calls.length,0);
});
const pin=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
function pairFixture(t,{purpose='development-test'}={}){
  const f=fixture(t,{action:'official-pair-prepare',purpose});let calls=0,controls=0;
  const before={configuration:pin(fs.readFileSync(f.cfg)),profile:OFFICIAL_C050_PROFILE};
  const input={file:f.cfg},outputs={js:{path:path.join(f.dir,'new.js'),bytes:3,sha256:'a'.repeat(64)},receipt:{path:path.join(f.dir,'receipt.json'),bytes:4,sha256:'b'.repeat(64)}};
  const api={preparePair:()=>({input,before,profile:OFFICIAL_C050_PROFILE,plan:{...before,outputDirectory:f.dir,outputs:{js:outputs.js.path,receipt:outputs.receipt.path}}}),
    executePair:(received,checked)=>{assert.equal(received,input);assert.equal(checked,before);calls++;return{status:'SUCCESS',executionMode:'bounded-files',taskId:null,artifactState:'PREPARED_NOT_ADMITTED',admission:'NOT_ADMITTED',profile:OFFICIAL_C050_PROFILE,packageId:null,outputs,phone:'NOT_RUN',engineRun:'NOT_RUN',visual:'NOT_VERIFIED'};},
    inspectTask:()=>{controls++;throw Error('must not read task root');},cancelTask:()=>{controls++;throw Error('must not cancel');}};
  return {...f,api,before,outputs,service:createTaskService(api),get calls(){return calls;},get controls(){return controls;}};
}

test('bounded pair action is explicit about two files, no task controller and development-only admission',async t=>{
  const f=pairFixture(t),plan=f.service.plan(f.file);
  assert.equal(plan.executionMode,'bounded-files');assert.equal(plan.eligible,true);assert.equal(plan.packageId,null);
  assert.equal(plan.inputValidation,'ACTUAL_RAW_PAIR_AND_DERIVATION_CHECKED');assert.equal(plan.control.cancelSupported,false);assert.equal(plan.control.statusSupported,false);
  const result=await f.service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(plan)});
  assert.equal(f.calls,1);assert.equal(result.schema,'wxslim-task-result-v1');assert.equal(result.taskId,null);assert.equal(result.executionMode,'bounded-files');assert.equal(result.artifactState,'PREPARED_NOT_ADMITTED');assert.equal(result.admission,'NOT_ADMITTED');assert.deepEqual(result.outputs,f.outputs);
  for(const purpose of ['inspect','supported-use']){const denied=pairFixture(t,{purpose});assert.equal(denied.service.plan(denied.file).eligible,false);await assert.rejects(denied.service.execute(denied.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(denied.calls,0);}
  await assert.rejects(f.service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});assert.equal(f.calls,1);
});

test('bounded pair status and cancel refuse before reading config or any selected task directory',t=>{
  const f=pairFixture(t);fs.unlinkSync(f.cfg);
  const options={root:path.join(f.dir,'NOT_A_TASK'),taskId:'unrelated'};
  for(const action of ['status','cancel'])assert.throws(()=>f.service[action](f.file,{...options,...(action==='cancel'?{write:true}:{})}),e=>e.code==='TASK_CONTROL_UNSUPPORTED'&&e.possibleSideEffects==='NONE');
  assert.equal(f.controls,0);assert.equal(f.calls,0);assert(!fs.existsSync(options.root));
});

test('bounded pair CLI keeps partial-write metadata and rejects stale reviewed plans',async t=>{
  const f=pairFixture(t),planned=f.service.plan(f.file);f.before.configuration={...f.before.configuration,sha256:'c'.repeat(64)};
  await assert.rejects(f.service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(planned)}));assert.equal(f.calls,0);
  const failed=pairFixture(t),io=streams();
  const service=createTaskService({...failed.api,executePair:()=>{throw Object.assign(Error('PRIVATE_MACHINE_PATH'),{code:'TASK_PAIR_PREPARATION_FAILED',reason:'PAIR_PREPARE_OUTPUT_EXISTS',created:{js:true,receipt:false},attempted:{js:true,receipt:true},possibleSideEffects:'PARTIAL_OUTPUT_POSSIBLE'});}});
  assert.equal(await runTaskCli(['execute',failed.file,'--write'],{...io,service}),1);
  const error=JSON.parse(io.error());assert.equal(error.code,'TASK_PAIR_PREPARATION_FAILED');assert.equal(error.possibleSideEffects,'PARTIAL_OUTPUT_POSSIBLE');assert.deepEqual(error.filePreparation,{reason:'PAIR_PREPARE_OUTPUT_EXISTS',created:{js:true,receipt:false},attempted:{js:true,receipt:true}});assert(!io.error().includes('PRIVATE'));
  const unsupported=streams();assert.equal(await runTaskCli(['cancel',failed.file,failed.dir,'old-task','--write'],{...unsupported,service}),1);assert.equal(JSON.parse(unsupported.error()).possibleSideEffects,'NONE');
});
// Model only: the real persistent planner requires the fixed baseline and Git.
function persistentFixture(t,{saved=true,terminal=null}={}){
  const f=fixture(t,{action:'persistent-dev-engine-build',scope:oldScope}),root=path.join(f.dir,'output');
  const config={schema:'wxslim-persistent-execution-v1',...Object.fromEntries(['baselineSource','sdk','python','library','editor','sconsWheel','sdkArchive','gitExecutable'].map(k=>[k,path.join(f.dir,k)])),work:root,jobs:4,budgetBytes:8*2**30};
  write(f.cfg,config);
  const api={planPersistent(input){const plan={schema:'wxslim-persistent-execution-plan-v1',request:input,work:input.work,sourcePlan:{profile:'full'},profile:path.join(input.work,'inputs/profile.gdbuild')};return {...plan,planSha256:pin(Buffer.from(JSON.stringify(plan))).sha256};}};
  const service=createTaskService(api),plan=service.plan(f.file).plan;
  const makeControl=()=>{
    const task=createTask(root,{budgetBytes:config.budgetBytes,recipeId:'persistent-dev:'+plan.planSha256});
    if(saved){fs.mkdirSync(path.join(root,'inputs'));write(path.join(root,'inputs/REQUEST.json'),config);write(path.join(root,'inputs/PLAN.json'),plan);}
    if(terminal){write(path.join(root,'BUILD.json'),{schema:'wxslim-persistent-build-v1',taskId:task.taskId,plan,failure:{code:'MODEL_PERSISTENT_FAILED',message:'C:/private/error'}});task.finish(terminal,{kind:'PERSISTENT_DEV_ENGINE_BUILD',runtime:'NOT_RUN',deploymentAdmission:'NOT_ADMITTED',build:pin(fs.readFileSync(path.join(root,'BUILD.json')))});}
    return {task,options:{root,taskId:task.taskId}};
  };
  return {...f,config,root,api,service,plan,makeControl};
}

test('legacy persistent fresh execution is capability-denied while its independent readonly plan remains available',async t=>{
  const f=persistentFixture(t),calls=[];
  const service=createTaskService({...f.api,executePersistent:async(input,options)=>{calls.push({input,options});return {status:'SUCCESS',terminal:{status:'SUCCESS',taskId:'model',details:{kind:'PERSISTENT_DEV_ENGINE_BUILD',runtime:'NOT_RUN',deploymentAdmission:'NOT_ADMITTED',build:{bytes:1,sha256:'a'.repeat(64)}}},phases:[]};}});
  const p=service.plan(f.file);assert.equal(p.profile,'full');assert.equal(p.admission,'NOT_ADMITTED');assert.equal(p.eligible,false);assert.equal(p.packageId,null);
  assert.deepEqual(p.assessments.map(a=>a.capability),['engine-build-persistent-dev']);assert.deepEqual(p.assessments[0].matchedEvidence,[]);assert.equal(p.executionAuthorized,false);
  assert.equal(p.assessments[0].status,'unsupported');assert.equal(p.assessments[0].reason,'UNSUPPORTED_CONFIGURATION');
  await assert.rejects(service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(calls.length,0);assert(!fs.existsSync(f.root));
  const io=streams();assert.equal(await runTaskCli(['execute',f.file,'--write'],{...io,service}),1);
  assert.equal(JSON.parse(io.error()).code,'TASK_CAPABILITY_DENIED');assert.equal(calls.length,0);assert(!fs.existsSync(f.root));
  for(const purpose of ['inspect','supported-use']){write(f.file,{...f.raw,purpose});assert.equal(service.plan(f.file).eligible,false);await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});}
  assert.equal(calls.length,0);assert.equal(readCapabilities().capabilities.find(c=>c.id==='persistent-save').status,'unsupported');
  write(f.cfg,{...f.config,work:'relative'});assert.throws(()=>service.plan(f.file),/ABSOLUTE_PATH/);
});

test('persistent controls bind both snapshots, task type and BUILD without claiming admission',t=>{
  const f=persistentFixture(t),control=f.makeControl();
  assert.equal(f.service.plan(f.file).assessments[0].status,'unsupported');assert.equal(f.service.plan(f.file).eligible,false);
  assert.equal(f.service.status(f.file,control.options).status,'NO_TERMINAL_RECEIPT');assert.equal(f.service.status(f.file,control.options).admission,'NOT_ADMITTED');
  assert.equal(f.service.cancel(f.file,{...control.options,write:true}).cancel.accepted,true);assert.equal(control.task.readCancellationRequested(),true);
  const early=persistentFixture(t,{saved:false}),ec=early.makeControl();assert.throws(()=>early.service.cancel(early.file,{...ec.options,write:true}),{code:'TASK_CONTROL_BINDING_INCOMPLETE'});
  const changed=persistentFixture(t),cc=changed.makeControl();write(path.join(changed.root,'inputs/PLAN.json'),{...changed.plan,planSha256:'b'.repeat(64)});assert.throws(()=>changed.service.cancel(changed.file,{...cc.options,write:true}));assert.equal(cc.task.readCancellationRequested(),false);
  for(const status of ['SUCCESS','FAILED','CANCELLED']){
    const ended=persistentFixture(t,{terminal:status}),c=ended.makeControl(),s=ended.service.status(ended.file,c.options);assert.equal(s.status,status);assert.equal(s.admission,'NOT_ADMITTED');assert(!JSON.stringify(s).includes('private/error'));
    assert.equal(ended.service.cancel(ended.file,{...c.options,write:true}).cancel.alreadyEnded,true);
    fs.appendFileSync(path.join(ended.root,'BUILD.json'),' ');assert.throws(()=>ended.service.status(ended.file,c.options));
  }
  const wrong=persistentFixture(t),wc=wrong.makeControl();write(path.join(wrong.root,'TASK.json'),{...inspectTask(wrong.root,wc.task.taskId).owner,recipeId:'fixed-engine:'+wrong.plan.planSha256});assert.throws(()=>wrong.service.cancel(wrong.file,{...wc.options,write:true}));
});

test('historical persistent terminal kind, runtime, admission and BUILD pins are audited despite fresh execution denial',t=>{
  // Exercise durable status validation, not execute's earlier capability gate.
  for(const mutate of [
    details=>{details.kind='FIXED_ENGINE_BUILD';},
    details=>{details.runtime='RUN';},
    details=>{details.deploymentAdmission='ADMITTED';},
    details=>{delete details.build;},
    details=>{details.build.bytes++;},
    details=>{details.build.sha256='0'.repeat(64);},
  ]){
    const f=persistentFixture(t,{terminal:'SUCCESS'}),control=f.makeControl();
    const before=f.service.status(f.file,control.options);assert.equal(before.status,'SUCCESS');assert.equal(before.terminalPresent,true);
    assert.equal(before.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');assert.equal(before.admission,'NOT_ADMITTED');
    const terminalPath=path.join(f.root,'terminal.json'),terminal=JSON.parse(fs.readFileSync(terminalPath));
    mutate(terminal.details);write(terminalPath,terminal);
    assert.throws(()=>f.service.status(f.file,control.options),{code:'TASK_CONTROL_REJECTED'});
  }
});
function buildControl(t,{saved=true,terminal=null}={}){
  const f=fixture(t,{action:'fixed-engine-build',purpose:'inspect'}),service=createTaskService(),plan=service.plan(f.file).plan,root=plan.work;
  const task=createTask(root,{budgetBytes:plan.budgetBytes,recipeId:'fixed-engine:'+plan.semanticRecipeSha256});
  if(saved){fs.mkdirSync(path.join(root,'inputs'));write(path.join(root,'inputs','REQUEST.json'),plan.request);}
  if(terminal){const build={schema:'wxslim-fixed-build-v1',taskId:task.taskId,profileId:'full',plan:{request:plan.request},...(terminal==='FAILED'?{failure:{code:'MODEL_SOURCE_FAILED',message:'C:/private/build-path'}}:{})};write(path.join(root,'BUILD.json'),build);task.finish(terminal,{kind:'FIXED_ENGINE_BUILD',profile:'full',build:pin(fs.readFileSync(path.join(root,'BUILD.json')))});}
  return {...f,service,plan,root,task,options:{root,taskId:task.taskId}};
}
function officialControl(t,{terminal=null,profile='full'}={}){
  const f=fixture(t,{purpose:'inspect'}),root=path.join(f.dir,'output'),raw={schema:'wxslim-official-inputs-v1',js:'source.js',wasm:'source.wasm',pck:'source.pck',interfaces:'interfaces.js',transformer:'transformer.exe',output:'output',renderMode:'webgl'};
  if(isDevelopmentEngineProfile(profile))raw.engineProfile=profile;
  if(profile===STORAGE_PROFILE)raw.upstreamSource='upstream-source.js';
  const inputKeys=['js','wasm','pck','interfaces','transformer',...(profile===STORAGE_PROFILE?['upstreamSource']:[])];
  for(const name of ['source.js','source.wasm','source.pck','interfaces.js','transformer.exe',...(profile===STORAGE_PROFILE?['upstream-source.js']:[])])fs.writeFileSync(path.join(f.dir,name),'small model '+name);
  write(f.cfg,raw);const input=readConfiguration(f.cfg),inputs=Object.fromEntries(inputKeys.map(k=>[k,pin(fs.readFileSync(input[k]))]));
  const identity=isDevelopmentEngineProfile(profile)?getRecipeIdentity(profile):{recipeId:'repaired-full-026e-return0-v1',recipeSha256:'a'.repeat(64)},packageId='wxslim-'+'b'.repeat(20),task=createTask(root,{budgetBytes:120*1024*1024,recipeId:identity.recipeId});
  const plan={schema:'wxslim-official-plan-v1',...identity,taskRoot:root,convertedOutput:path.join(root,'converted'),options:input.options,engineContract:{profile},projectUsage:null,expectedPackageId:packageId,inputs,toolchain:{transformerSha256:inputs.transformer.sha256}};
  write(path.join(root,'PLAN.private.json'),plan);write(path.join(root,'PREFLIGHT.json'),{schema:'wxslim-official-input-summary-v1',...identity,packageId,inputs});
  if(terminal==='SUCCESS'){write(path.join(root,'AUDIT.json'),{status:'PASS_STATIC_ONLY',packageId});task.finish('SUCCESS',{packageId,auditSha256:pin(fs.readFileSync(path.join(root,'AUDIT.json'))).sha256});}
  else if(terminal)task.finish(terminal,{code:'MODEL_CONVERT_FAILED',privateError:'C:/private/converter'});
  const api={controlRecipe:()=>({transformer:{sha256:inputs.transformer.sha256}}),controlRecipeIdentity:()=>identity};
  return {...f,root,task,plan,input,inputs,api,service:createTaskService(api),options:{root,taskId:task.taskId}};
}

test('strict request schema rejects injected status, force, extra keys and saved plans',t=>{
  const f=fixture(t);
  for(const patch of [{force:true},{status:'verified'},{evidence:[]},{write:true},{action:'upload'},{schema:'wxslim-task-plan-v1'},{scope:{appid:'private'}},{purpose:'force'}]){
    write(f.file,{...f.raw,...patch});assert.throws(()=>readTaskRequest(f.file));
  }
  write(f.file,f.raw);assert.equal(readTaskRequest(f.file).request.configFile,f.cfg);
});

test('listing only advertises explicit shared task adapters, not upload or automatic export',()=>{
  const list=createTaskService().list();assert.deepEqual(list.actions.map(a=>a.action),['official-convert','fixed-engine-build','persistent-dev-engine-build','official-raw-engine-build','official-pair-prepare','custom-pair-prepare','resource-pck-partition','project-pck-export','resource-interfaces-prepare','resource-runtime-assemble','resource-project-install']);
  for(const entry of list.actions){
    const legacy=entry.action==='persistent-dev-engine-build';
    assert.equal(entry.assessment.status,legacy?'unsupported':'implemented');
    assert.equal(entry.assessment.eligible,!legacy);
    assert.equal(entry.requiresExplicitWrite,true);assert.equal(entry.assessment.executionAuthorized,false);
  }
});

test('resource interface task shares plan admission and execution without inheriting package or device acceptance',async t=>{
  const f=fixture(t,{action:'resource-interfaces-prepare',scope:oldScope}),calls=[];
  const input={configurationFile:f.cfg,output:path.join(f.dir,'interface-task')},before={configuration:pin(fs.readFileSync(f.cfg)),planSha256:'c'.repeat(64)};
  const api={prepareResourceInterfaces:()=>({input,before,profile:'resource-interfaces-prepare-v1',plan:{input,planSha256:before.planSha256}}),
    executeResourceInterfaces:async(i,b,o)=>{assert.equal(i,input);assert.equal(b,before);assert.equal(o.writeAuthorized,true);calls.push('execute');
      return {status:'SUCCESS',taskId:'interface-model',terminal:{status:'SUCCESS',taskId:'interface-model',details:{kind:'RESOURCE_INTERFACES_PREPARE',admission:'NOT_ADMITTED',engineRun:'NOT_RUN'}},audit:{bytes:1,sha256:'a'.repeat(64)},phases:[]};}};
  const service=createTaskService(api),plan=service.plan(f.file);
  assert.equal(plan.eligible,true);assert.equal(plan.identityScope,'RESOURCE_INTERFACE_INPUTS_NOT_GAME_PACKAGE');assert.equal(plan.packageId,null);
  assert.equal(plan.assessments[0].status,'implemented');assert.deepEqual(plan.assessments[0].matchedEvidence,[]);
  assert.equal(plan.receiverInBootPck,'NOT_PROVEN');assert.equal(plan.officialConversion,'NOT_RUN');assert.equal(plan.control.command,'task');
  await assert.rejects(()=>service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});assert.deepEqual(calls,[]);
  const result=await service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(plan)});
  assert.equal(result.status,'SUCCESS');assert.equal(result.packageId,null);assert.equal(result.admission,'NOT_ADMITTED');
  assert.equal(result.engineRun,'NOT_RUN');assert.equal(result.officialConversion,'NOT_RUN');assert.deepEqual(calls,['execute']);
  for(const purpose of ['inspect','supported-use']){write(f.file,{...f.raw,purpose});await assert.rejects(()=>service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});}
  assert.deepEqual(calls,['execute']);assert(!fs.existsSync(input.output));
});

test('resource interface task rejects reviewed-plan drift and contradictory terminal without guessing success',async t=>{
  const f=fixture(t,{action:'resource-interfaces-prepare'}),before={configuration:pin(fs.readFileSync(f.cfg))};let revision=1,runs=0;
  const service=createTaskService({prepareResourceInterfaces:()=>({input:{},before,profile:'resource-interfaces-prepare-v1',plan:{revision}}),
    executeResourceInterfaces:async()=>{runs++;return {status:'SUCCESS',terminal:{status:'FAILED',details:{kind:'RESOURCE_INTERFACES_PREPARE'}}};}});
  const plan=service.plan(f.file);revision++;
  await assert.rejects(()=>service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(plan)}),{code:'TASK_PLAN_CHANGED'});assert.equal(runs,0);
  await assert.rejects(()=>service.execute(f.file,{write:true}));assert.equal(runs,1);
});

test('resource assembly uses common admission without inheriting previous candidate acceptance',async t=>{
  const f=fixture(t,{action:'resource-runtime-assemble',scope:oldScope}),calls=[];
  const input={configurationFile:f.cfg,output:path.join(f.dir,'assembly-task')},before={configuration:pin(fs.readFileSync(f.cfg)),planSha256:'c'.repeat(64)};
  const packageId='wxslim-1234567890abcdef1234';
  const service=createTaskService({prepareResourceAssembly:()=>({input,before,profile:'resource-runtime-assemble-v1',plan:{input,packageId,planSha256:before.planSha256}}),
    executeResourceAssembly:async(i,b,o)=>{assert.equal(i,input);assert.equal(b,before);assert.equal(o.writeAuthorized,true);calls.push('execute');
      return {status:'SUCCESS',taskId:'assembly-model',terminal:{status:'SUCCESS',taskId:'assembly-model',details:{kind:'RESOURCE_RUNTIME_ASSEMBLE',admission:'NOT_ADMITTED',engineRun:'NOT_RUN'}},audit:{bytes:1,sha256:'a'.repeat(64)},phases:[]};}});
  const plan=service.plan(f.file);
  assert.equal(plan.eligible,true);assert.equal(plan.packageId,packageId);assert.equal(plan.identityScope,'CONVERTED_RESOURCE_INPUTS_NOT_DEVICE_ACCEPTANCE');
  assert.equal(plan.inputValidation,'OFFICIAL_CONVERTED_PAIR_BOOT_AND_RESOURCE_BYTES_CHECKED');
  assert.deepEqual(plan.assessments[0].matchedEvidence,[]);assert.equal(plan.receiverInBootPck,'NOT_PROVEN');assert.equal(plan.conversionPerformed,false);
  await assert.rejects(()=>service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});assert.deepEqual(calls,[]);
  const result=await service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(plan)});
  assert.equal(result.status,'SUCCESS');assert.equal(result.packageId,packageId);assert.equal(result.admission,'NOT_ADMITTED');
  assert.equal(result.engineRun,'NOT_RUN');assert.equal(result.conversionPerformed,false);assert.deepEqual(calls,['execute']);
  for(const purpose of ['inspect','supported-use']){write(f.file,{...f.raw,purpose});await assert.rejects(()=>service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});}
  assert.deepEqual(calls,['execute']);assert(!fs.existsSync(input.output));
});

test('resource assembly rejects plan drift and contradictory terminal',async t=>{
  const f=fixture(t,{action:'resource-runtime-assemble'}),before={configuration:pin(fs.readFileSync(f.cfg))};let revision=1,runs=0;
  const service=createTaskService({prepareResourceAssembly:()=>({input:{},before,profile:'resource-runtime-assemble-v1',plan:{revision,packageId:'wxslim-1234567890abcdef1234'}}),
    executeResourceAssembly:async()=>{runs++;return {status:'SUCCESS',terminal:{status:'FAILED',details:{kind:'RESOURCE_RUNTIME_ASSEMBLE'}}};}});
  const plan=service.plan(f.file);revision++;
  await assert.rejects(()=>service.execute(f.file,{write:true,expectedPlanSha256:taskPlanIdentity(plan)}),{code:'TASK_PLAN_CHANGED'});assert.equal(runs,0);
  await assert.rejects(()=>service.execute(f.file,{write:true}));assert.equal(runs,1);
});

test('inspect produces a readonly plan but cannot execute even with explicit write',async t=>{
  const f=fixture(t,{purpose:'inspect'}),a=officialAdapter(f),service=createTaskService(a.api);
  const plan=service.plan(f.file);assert.equal(plan.eligible,false);assert.equal(plan.reason,'INSPECTION_ONLY');
  assert.equal(plan.executionAuthorized,false);assert.equal(a.calls.length,0);
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(a.calls.length,0);
});

test('development conversion is awaited once and passes exact assessed input snapshot to executor',async t=>{
  const f=fixture(t),a=officialAdapter(f),service=createTaskService(a.api);
  await assert.rejects(service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});assert.equal(a.calls.length,0);
  const result=await service.execute(f.file,{write:true});assert.equal(a.calls.length,1);
  assert.deepEqual(a.calls[0].options,{writeAuthorized:true,expectedPreflight:{packageId:a.before.expectedManifest.packageVersion,snapshot:a.before.snapshot}});
  assert.equal(result.status,'SUCCESS');assert.equal(result.admission,'CONVERSION_AND_STATIC_AUDIT_ONLY');assert.equal(result.phone,'NOT_RUN');
  assert.equal(result.visual,'NOT_VERIFIED');assert(!fs.existsSync(path.join(f.dir,'output')),'model does not run a real converter');
});

test('a different package or backend cannot borrow old exact device observations',async t=>{
  const f=fixture(t,{scope:oldScope,purpose:'supported-use'}),a=officialAdapter(f),service=createTaskService(a.api);
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_SCOPE_MISMATCH'});
  const web=createTaskService(officialAdapter(f,{packageId:oldScope.packageId,mode:'webgl'}).api);
  assert.throws(()=>web.plan(f.file),{code:'TASK_SCOPE_MISMATCH'});assert.equal(a.calls.length,0);
});

test('exact historical scope can describe the same fixture identity but never asserts runtime now',t=>{
  const f=fixture(t,{scope:oldScope,purpose:'supported-use'}),service=createTaskService(officialAdapter(f,{packageId:oldScope.packageId,profile:'conservative'}).api);
  const plan=service.plan(f.file);assert.equal(plan.eligible,true);assert.equal(plan.assessments.length,3);
  assert(plan.assessments.every(a=>a.status==='verified'&&!a.runtimeVerifiedNow&&!a.executionAuthorized));
});

test('unobserved conversion is denied supported-use and is not auto-downgraded to development',async t=>{
  const f=fixture(t,{purpose:'supported-use'}),a=officialAdapter(f),service=createTaskService(a.api);
  assert.equal(service.plan(f.file).reason,'CAPABILITY_GATE_DENIED');
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(a.calls.length,0);
});

test('request or configuration drift during preparation is refused before executor',async t=>{
  for(const target of ['file','cfg']){
    const f=fixture(t),a=officialAdapter(f);a.api.planOfficial=()=>{fs.appendFileSync(f[target],'\n');return {};};
    await assert.rejects(createTaskService(a.api).execute(f.file,{write:true}),/changed during admission/);assert.equal(a.calls.length,0);
  }
});

test('execute re-reads configuration, it cannot execute a previously saved plan',async t=>{
  const f=fixture(t),a=officialAdapter(f),service=createTaskService(a.api);const plan=service.plan(f.file);
  write(f.file,{...f.raw,purpose:'inspect'});await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});
  write(f.file,plan);await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_REQUEST_INVALID'});assert.equal(a.calls.length,0);
});

test('conversion admission checks both identity and whole input/tool/adapter snapshot',()=>{
  const before={expectedManifest:{packageVersion:'fixture'},snapshot:{files:{pck:{bytes:2,sha256:'a'.repeat(64)}},sources:{adapter:{sha256:'b'.repeat(64)}}}};
  const expected={packageId:'fixture',snapshot:structuredClone(before.snapshot)};assertExpectedPreflight(before,expected);assertExpectedPreflight(before,null);
  for(const mutate of [b=>{b.expectedManifest.packageVersion='other';},b=>{b.snapshot.files.pck.bytes++;},b=>{b.snapshot.sources.adapter.sha256='c'.repeat(64);}]){
    const changed=structuredClone(before);mutate(changed);assert.throws(()=>assertExpectedPreflight(changed,expected));
  }
  assert.throws(()=>assertExpectedPreflight(before,{...expected,force:true}));
});

test('full build uses its own capability and actual fixed plan; it does not create work or borrow package evidence',async t=>{
  const f=fixture(t,{action:'fixed-engine-build',scope:oldScope}),calls=[];
  const service=createTaskService({executeBuild:async(input,options)=>{calls.push({input,options});return {status:'SUCCESS',terminal:{status:'SUCCESS',taskId:'fixture',details:{kind:'FIXED_ENGINE_BUILD',profile:'full',build:{bytes:1,sha256:'a'.repeat(64)}}},phases:[]};}});
  const plan=service.plan(f.file);assert.equal(plan.packageId,null);assert.equal(plan.assessments[0].capability,'engine-build-fixed');
  assert(plan.assessments.every(a=>a.status!=='verified'&&a.matchedEvidence.length===0));assert.equal(plan.eligible,true);
  assert.equal(plan.plan.work,path.join(f.dir,'output'));assert.equal(plan.plan.request.sdkArchive,path.join(f.dir,'sdk.zip'));
  const result=await service.execute(f.file,{write:true});assert.equal(calls.length,1);assert.deepEqual(calls[0].options,{write:true});assert.equal(result.admission,'REQUIRES_INDEPENDENT_AUDIT');
  assert(!fs.existsSync(path.join(f.dir,'output')));
  write(f.file,{...f.raw,purpose:'supported-use'});assert.equal(service.plan(f.file).reason,'NEW_BUILD_REQUIRES_ACCEPTANCE');
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(calls.length,1);
});

test('failed/cancelled results remain terminal outcomes; warning and timing survive without private error data',async t=>{
  for(const status of ['FAILED','CANCELLED']){
    const f=fixture(t,{action:'fixed-engine-build'}),service=createTaskService({executeBuild:async()=>({status,terminal:{status,taskId:'fixture',details:{kind:'FIXED_ENGINE_BUILD',profile:'full'},controlLockWarning:{code:'EACCES',message:'C:/private/path'}},phases:[{name:'COMPILE',status:'fail',wallMs:25,error:{message:'secret'}}]})});
    const result=await service.execute(f.file,{write:true});assert.equal(result.status,status);assert.equal(result.admission,'NOT_ADMITTED');assert.equal(result.controlLockWarning.code,'EACCES');assert.equal(result.phases[0].wallMs,25);
    assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('C:/private'));
  }
});

test('conservative build requires exact reviewed declarations and cannot inherit old package evidence',async t=>{
  const f=fixture(t,{action:'fixed-engine-build',profile:'conservative',scope:oldScope}),service=createTaskService();
  const plan=service.plan(f.file);assert.equal(plan.profile,'conservative');assert.equal(plan.eligible,true);
  assert.deepEqual(plan.assessments.map(a=>a.capability),['engine-build-fixed','trim-fixed-glx']);
  assert(plan.assessments.every(a=>a.matchedEvidence.length===0));
  assert.equal(plan.inputValidation,'SEMANTIC_PLAN_ONLY_EXECUTOR_DEPENDENCY_AND_RESOURCE_CHECKS_PENDING');
  const changed=structuredClone(f.config);changed.inputs.requirements.features[removedFeatures[0]]='unknown';write(f.cfg,changed);
  await assert.rejects(service.execute(f.file,{write:true}),/explicit unused declarations/);assert(!fs.existsSync(path.join(f.dir,'output')));
});

test('inconsistent executor candidate or missing terminal is not success',async t=>{
  const f=fixture(t),a=officialAdapter(f);a.api.executeOfficial=async()=>({schema:'wxslim-official-execution-summary-v1',status:'SUCCESS',packageId:'other'});
  await assert.rejects(createTaskService(a.api).execute(f.file,{write:true}),/candidate mismatch/);
  const b=fixture(t,{action:'fixed-engine-build'});await assert.rejects(createTaskService({executeBuild:async()=>({status:'SUCCESS'})}).execute(b.file,{write:true}),/durable terminal/);
});

test('CLI is strict, waits for completion, and reports failed/cancelled exit codes without retries',async()=>{
  for(const [status,code] of [['SUCCESS',0],['FAILED',1],['CANCELLED',2]]){
    const io=streams();let calls=0,finished=false;
    const pending=runTaskCli(['execute','fixture','--write'],{...io,service:{execute:async()=>{calls++;await new Promise(r=>setTimeout(r,2));finished=true;return {schema:'wxslim-task-result-v1',status};}}});
    assert.equal(io.output(),'');assert.equal(await pending,code);assert(finished);assert.equal(calls,1);
  }
  for(const args of [['execute','fixture'],['execute','fixture','--force'],['plan','fixture','--write']]){
    const io=streams();assert.equal(await runTaskCli(args,{...io,service:{execute(){assert.fail('must not execute');}}}),1);
    assert.equal(JSON.parse(io.error()).code,'TASK_ARGUMENT_INVALID');assert.equal(io.output(),'');
  }
});

test('unexpected adapter exception keeps side effects unknown and private error out of CLI',async()=>{
  const io=streams();assert.equal(await runTaskCli(['execute','fixture','--write'],{...io,service:{execute:async()=>{throw Error('machine-path-and-secret');}}}),1);
  assert.equal(JSON.parse(io.error()).possibleSideEffects,'UNKNOWN_UNTIL_TASK_INSPECTED');assert(!io.error().includes('machine-path'));assert.equal(io.output(),'');
});

test('real root CLI uses common list and build plan with no writer or native tool execution',t=>{
  const f=fixture(t,{action:'fixed-engine-build',purpose:'inspect'});
  for(const args of [['list'],['plan',f.file]]){
    const r=spawnSync(process.execPath,['wxslim.mjs','task',...args],{cwd:repo,encoding:'utf8',timeout:10000});
    assert.equal(r.status,0);assert.equal(r.stderr,'');assert(JSON.parse(r.stdout).schema.startsWith('wxslim-task-'));
  }
  assert(!fs.existsSync(path.join(f.dir,'output')));
});

test('status binds build request/type and never calls no-terminal receipt a running process',t=>{
  const f=buildControl(t),before=fs.readdirSync(f.root),s=f.service.status(f.file,f.options);
  assert.equal(s.status,'NO_TERMINAL_RECEIPT');assert.equal(s.processLiveness,'NOT_OBSERVED');assert.equal(s.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');assert.equal(s.admission,'NOT_REAUDITED');assert.equal(s.terminalPresent,false);assert.deepEqual(fs.readdirSync(f.root),before);assert(!JSON.stringify(s).includes(f.dir));
  const success=buildControl(t,{terminal:'SUCCESS'});assert.equal(success.service.status(success.file,success.options).status,'SUCCESS');
  const failed=buildControl(t,{terminal:'FAILED'}),r=failed.service.status(failed.file,failed.options);assert.equal(r.status,'FAILED');assert.equal(r.taskFailureCode,'MODEL_SOURCE_FAILED');assert(!JSON.stringify(r).includes('private/build'));
});

test('shared status exposes recorded progress without replacing terminal or cancellation binding',t=>{
  const f=buildControl(t);
  f.task.event({stage:'COMPILE',status:'RUNNING',details:{wallMs:0,private:'SECRET'}});
  const active=f.service.status(f.file,f.options);
  assert.equal(active.progress.lastEvent.stage,'COMPILE');assert.equal(active.progress.lastEvent.wallMs,0);
  assert.equal(active.status,'NO_TERMINAL_RECEIPT');assert.equal(active.processLiveness,'NOT_OBSERVED');assert(!JSON.stringify(active).includes('SECRET'));
  fs.appendFileSync(path.join(f.root,'events.jsonl'),'bad-complete-line\n');
  const broken=f.service.status(f.file,f.options);assert.equal(broken.progress.readStatus,'UNAVAILABLE');assert.equal(broken.progress.reason,'EVENT_RECORD_INVALID');
  assert.equal(broken.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');assert.equal(f.service.cancel(f.file,{...f.options,write:true}).cancel.accepted,true);
  const ended=buildControl(t,{terminal:'SUCCESS'});fs.writeFileSync(path.join(ended.root,'events.jsonl'),'bad\n');
  const terminal=ended.service.status(ended.file,ended.options);assert.equal(terminal.status,'SUCCESS');assert.equal(terminal.progress.readStatus,'UNAVAILABLE');
});
test('cancel requires explicit write and existing execution snapshot, then reuses durable old cancellation API',t=>{
  const f=buildControl(t);assert.throws(()=>f.service.cancel(f.file,f.options),{code:'TASK_WRITE_REQUIRED'});assert.equal(fs.existsSync(path.join(f.root,'cancel.json')),false);
  const cancelled=f.service.cancel(f.file,{...f.options,write:true});assert.equal(cancelled.cancel.accepted,true);assert.equal(cancelled.status,'CANCEL_REQUESTED');assert.equal(cancelled.terminalPresent,false);assert.equal(cancelled.processLiveness,'NOT_OBSERVED');assert.equal(f.task.readCancellationRequested(),true);assert.equal(f.service.cancel(f.file,{...f.options,write:true}).cancel.duplicate,true);
  const early=buildControl(t,{saved:false});assert.equal(early.service.status(early.file,early.options).inputBinding,'MISSING_EXECUTION_SNAPSHOT');assert.throws(()=>early.service.cancel(early.file,{...early.options,write:true}),{code:'TASK_CONTROL_BINDING_INCOMPLETE'});assert.equal(fs.existsSync(path.join(early.root,'cancel.json')),false);
});
test('official controls use plan/preflight/input pins, preserve failed terminal and return already-ended without cancel',t=>{
  const f=officialControl(t);assert.equal(f.service.status(f.file,f.options).status,'NO_TERMINAL_RECEIPT');assert.equal(f.service.cancel(f.file,{...f.options,write:true}).cancel.accepted,true);
  const ended=officialControl(t,{terminal:'SUCCESS'}),r=ended.service.cancel(ended.file,{...ended.options,write:true});assert.equal(r.status,'SUCCESS');assert.equal(r.cancel.alreadyEnded,true);assert.equal(fs.existsSync(path.join(ended.root,'cancel.json')),false);
  const failed=officialControl(t,{terminal:'FAILED'}),status=failed.service.status(failed.file,failed.options);assert.equal(status.status,'FAILED');assert.equal(status.taskFailureCode,'MODEL_CONVERT_FAILED');assert(!JSON.stringify(status).includes('private/converter'));
});
test('wrong task ID, selected root, changed output config and task type cannot redirect cancellation',t=>{
  const f=buildControl(t);assert.throws(()=>f.service.cancel(f.file,{...f.options,taskId:'other',write:true}));
  const second=buildControl(t);assert.throws(()=>f.service.cancel(f.file,{root:second.root,taskId:second.task.taskId,write:true}));assert.equal(second.task.readCancellationRequested(),false);
  const official=officialControl(t);write(official.cfg,{...JSON.parse(fs.readFileSync(official.cfg)),output:f.root});assert.throws(()=>official.service.cancel(official.file,{...f.options,write:true}));assert.equal(f.task.readCancellationRequested(),false);
  write(f.cfg,{...f.config,inputs:{...f.config.inputs,work:second.root}});assert.throws(()=>f.service.cancel(f.file,{...f.options,write:true}));assert.equal(f.task.readCancellationRequested(),false);
});
test('changed request/task snapshot/build or official input bytes refuse before cancellation',t=>{
  const f=buildControl(t);const saved=path.join(f.root,'inputs','REQUEST.json'),old=JSON.parse(fs.readFileSync(saved));write(saved,{...old,inputs:{...old.inputs,jobs:5}});assert.throws(()=>f.service.cancel(f.file,{...f.options,write:true}));assert.equal(f.task.readCancellationRequested(),false);
  const ended=buildControl(t,{terminal:'SUCCESS'});fs.appendFileSync(path.join(ended.root,'BUILD.json'),' ');assert.throws(()=>ended.service.status(ended.file,ended.options));
  const injected=buildControl(t,{terminal:'SUCCESS'}),terminalPath=path.join(injected.root,'terminal.json'),terminal=JSON.parse(fs.readFileSync(terminalPath));terminal.details.build.privatePath='C:/private/injected';write(terminalPath,terminal);assert.throws(()=>injected.service.status(injected.file,injected.options),e=>e.code==='TASK_CONTROL_REJECTED'&&!e.message.includes('C:/private')&&!e.message.includes(injected.dir));
  const official=officialControl(t);fs.appendFileSync(official.input.interfaces,'mutated');assert.throws(()=>official.service.cancel(official.file,{...official.options,write:true}));assert.equal(official.task.readCancellationRequested(),false);
});
test('document drift during inspection is rejected and expectedRecipeId is checked under original cancel lock',t=>{
  const f=buildControl(t);let calls=0;
  const service=createTaskService({inspectTask(root,id){const result=inspectTask(root,id);write(f.file,{...f.raw,purpose:'development-test'});return result;},cancelTask(){calls++;assert.fail('must not cancel');}});
  assert.throws(()=>service.cancel(f.file,{...f.options,write:true}));assert.equal(calls,0);assert.equal(f.task.readCancellationRequested(),false);
  const g=buildControl(t),guarded=createTaskService({cancelTask(root,id,options){assert.equal(options.expectedRecipeId,g.plan?'fixed-engine:'+g.plan.semanticRecipeSha256:'');const owner=path.join(root,'TASK.json');write(owner,{...JSON.parse(fs.readFileSync(owner)),recipeId:'other-task-type'});return requestCancellation(root,id,options);}});
  assert.throws(()=>guarded.cancel(g.file,{...g.options,write:true}),{code:'TASK_RECIPE_MISMATCH'});assert.equal(fs.existsSync(path.join(g.root,'cancel.json')),false);
});
test('control lock presence and release warnings are public, fixed messages with no private native errors',t=>{
  const f=buildControl(t);fs.mkdirSync(path.join(f.root,'.control-lock'));const status=f.service.status(f.file,f.options);assert(status.warnings.some(w=>w.code==='TASK_CONTROL_LOCK_PRESENT'));assert.throws(()=>f.service.cancel(f.file,{...f.options,write:true}),{code:'TASK_LOCKED'});fs.rmdirSync(path.join(f.root,'.control-lock'));
  const service=createTaskService({cancelTask(root,id,options){return {...requestCancellation(root,id,options),controlLockWarning:{code:'EACCES',message:'C:/secret/lock'}};}});const result=service.cancel(f.file,{...f.options,write:true});assert.equal(result.controlLockWarning.code,'EACCES');assert(!JSON.stringify(result).includes('C:/secret'));
});
test('shared control CLI strictly parses arguments and keeps terminal/unknown outcomes visible without paths',async t=>{
  const f=buildControl(t,{terminal:'FAILED'});const io=streams();assert.equal(await runTaskCli(['status',f.file,f.root,f.task.taskId],{...io,service:f.service}),1);assert.equal(JSON.parse(io.output()).status,'FAILED');assert(!io.output().includes(f.dir));
  for(const args of [['status',f.file,f.root],['status',f.file,f.root,f.task.taskId,'--write'],['cancel',f.file,f.root,f.task.taskId],['cancel',f.file,f.root,f.task.taskId,'--force']]){const out=streams();assert.equal(await runTaskCli(args,{...out,service:f.service}),1);assert.equal(JSON.parse(out.error()).code,'TASK_ARGUMENT_INVALID');}
  const bad=streams();assert.equal(await runTaskCli(['cancel',f.file,'C:/private/nonexistent','other','--write'],{...bad,service:f.service}),1);assert(!bad.error().includes('C:/private'));assert.equal(JSON.parse(bad.error()).possibleSideEffects,'UNKNOWN_UNTIL_TASK_INSPECTED');
  const active=buildControl(t),accepted=streams();assert.equal(await runTaskCli(['cancel',active.file,active.root,active.task.taskId,'--write'],{...accepted,service:active.service}),0);assert.equal(JSON.parse(accepted.output()).status,'CANCEL_REQUESTED');
});

function assertStorageDevelopmentSummary(value){
  assert.equal(value.profile,STORAGE_PROFILE);assert.equal(value.developmentProfile,true);
  assert.deepEqual(value.allowedPurposes,['inspect','development-test']);
  assert.equal(value.storageRuntime,'NOT_VERIFIED');assert.equal(value.persistentSaveAdmission,'NOT_ADMITTED');
  assert.equal(value.conversionSuccessMeaning,'CONVERSION_AND_STATIC_AUDIT_ONLY');
}
test('storage development profile refuses supported-use even when every simulated assessment is verified',async t=>{
  // Simulate future matching evidence via the existing preflight stub. This is
  // a policy model, never admission of this development pair under the old ID.
  const f=fixture(t,{purpose:'supported-use',scope:oldScope});
  const a=officialAdapter(f,{packageId:oldScope.packageId,mode:oldScope.backend,profile:STORAGE_PROFILE}),service=createTaskService(a.api);
  const plan=service.plan(f.file);assert(plan.assessments.every(v=>v.eligible&&v.status==='verified'));
  assert.equal(plan.eligible,false);assert.equal(plan.reason,'DEVELOPMENT_PROFILE_PURPOSE_DENIED');assertStorageDevelopmentSummary(plan);
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(a.calls.length,0);
  write(f.file,{...f.raw,purpose:'inspect'});const inspect=service.plan(f.file);
  assert.equal(inspect.reason,'INSPECTION_ONLY');assert.equal(inspect.eligible,false);assertStorageDevelopmentSummary(inspect);
  assert(!fs.existsSync(path.join(f.dir,'output')));
});
test('storage development-test follows the original capability gate and conversion success never means storage acceptance',async t=>{
  const f=fixture(t),a=officialAdapter(f,{profile:STORAGE_PROFILE}),service=createTaskService(a.api);
  const plan=service.plan(f.file);assert.equal(plan.eligible,true);assert.equal(plan.reason,'ELIGIBLE_WITH_EXPLICIT_WRITE');
  assert(plan.assessments.every(v=>v.eligible&&v.status==='implemented'));assertStorageDevelopmentSummary(plan);
  await assert.rejects(service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});
  const result=await service.execute(f.file,{write:true});assert.equal(a.calls.length,1);assert.equal(result.status,'SUCCESS');
  assert.equal(result.admission,'CONVERSION_AND_STATIC_AUDIT_ONLY');assert.equal(result.engineRun,'NOT_RUN');assert.equal(result.phone,'NOT_RUN');
  assertStorageDevelopmentSummary(result);assert(!fs.existsSync(path.join(f.dir,'output')));
  assert.equal(readCapabilities().capabilities.find(c=>c.id==='persistent-save').status,'unsupported');
});
test('storage development status preserves receipt outcomes without inferring runtime or acceptance',t=>{
  for(const terminal of [null,'SUCCESS','FAILED','CANCELLED']){
    const f=officialControl(t,{terminal,profile:STORAGE_PROFILE}),result=f.service.status(f.file,f.options);
    assert.equal(result.status,terminal??'NO_TERMINAL_RECEIPT');assert.equal(result.admission,'NOT_REAUDITED');
    assert.equal(result.engineRun,'NOT_INFERRED');assert.equal(result.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');
    assertStorageDevelopmentSummary(result);
  }
});
test('default full/conservative summaries remain unchanged and unknown preflight profiles still reject',t=>{
  for(const profile of ['full','conservative']){
    const f=fixture(t),a=officialAdapter(f,{profile}),plan=createTaskService(a.api).plan(f.file);
    assert.equal(plan.profile,profile);assert.equal(plan.eligible,true);
    for(const key of ['developmentProfile','allowedPurposes','storageRuntime','persistentSaveAdmission','conversionSuccessMeaning'])assert.equal(plan[key],undefined);
  }
  const f=fixture(t),a=officialAdapter(f,{profile:'unregistered-profile'});
  assert.throws(()=>createTaskService(a.api).plan(f.file),/only registered/);assert.equal(a.calls.length,0);
});

function assertC050DevelopmentSummary(value){
  assert.equal(value.profile,OFFICIAL_C050_PROFILE);assert.equal(value.developmentProfile,true);
  assert.deepEqual(value.allowedPurposes,['inspect','development-test']);
  assert.equal(value.admission,'NOT_ADMITTED');assert.equal(value.productionAdmission,'NOT_ADMITTED');
  assert.equal(value.officialEngineRuntime,'NOT_VERIFIED');assert.equal(value.deviceEvidence,'NOT_INHERITED');
  assert.equal(value.conversionSuccessMeaning,'CONVERSION_AND_STATIC_AUDIT_ONLY');
  assert.equal(value.storageRuntime,undefined);assert.equal(value.persistentSaveAdmission,undefined);
}

test('official c050 refuses supported-use even under matching prior evidence and never starts executor',async t=>{
  const f=fixture(t,{purpose:'supported-use',scope:oldScope});
  const a=officialAdapter(f,{packageId:oldScope.packageId,mode:oldScope.backend,profile:OFFICIAL_C050_PROFILE}),service=createTaskService(a.api);
  const plan=service.plan(f.file);assert(plan.assessments.every(v=>v.eligible&&v.status==='verified'));
  assert.equal(plan.eligible,false);assert.equal(plan.reason,'DEVELOPMENT_PROFILE_PURPOSE_DENIED');assertC050DevelopmentSummary(plan);
  await assert.rejects(service.execute(f.file,{write:true}),{code:'TASK_CAPABILITY_DENIED'});assert.equal(a.calls.length,0);
  write(f.file,{...f.raw,purpose:'inspect'});const inspect=service.plan(f.file);
  assert.equal(inspect.eligible,false);assert.equal(inspect.reason,'INSPECTION_ONLY');assertC050DevelopmentSummary(inspect);
  assert(!fs.existsSync(path.join(f.dir,'output')));
});

test('official c050 development-test model keeps dedicated not-admitted outcome after conversion',async t=>{
  const f=fixture(t),a=officialAdapter(f,{profile:OFFICIAL_C050_PROFILE}),service=createTaskService(a.api);
  const plan=service.plan(f.file);assert.equal(plan.eligible,true);assertC050DevelopmentSummary(plan);
  await assert.rejects(service.execute(f.file),{code:'TASK_WRITE_REQUIRED'});
  const result=await service.execute(f.file,{write:true});assert.equal(result.status,'SUCCESS');assert.equal(a.calls.length,1);
  assertC050DevelopmentSummary(result);assert.equal(result.engineRun,'NOT_RUN');assert.equal(result.phone,'NOT_RUN');
  assert(!fs.existsSync(path.join(f.dir,'output')));
});

test('official c050 status preserves receipt outcomes without borrowing runtime admission',t=>{
  for(const terminal of [null,'SUCCESS','FAILED','CANCELLED']){
    const f=officialControl(t,{terminal,profile:OFFICIAL_C050_PROFILE}),result=f.service.status(f.file,f.options);
    assert.equal(result.status,terminal??'NO_TERMINAL_RECEIPT');assert.equal(result.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');
    assert.equal(result.engineRun,'NOT_INFERRED');assertC050DevelopmentSummary(result);
  }
});

test('reviewed plan identity preserves every field while ignoring JSON key order',()=>{
  const first={schema:'wxslim-task-plan-v1',plan:{inputs:{wasm:{bytes:12,sha256:'a'.repeat(64)}},sources:['one','two']}};
  const second={plan:{sources:['one','two'],inputs:{wasm:{sha256:'a'.repeat(64),bytes:12}}},schema:first.schema};
  assert.equal(taskPlanIdentity(first),taskPlanIdentity(second));
  second.plan.inputs.wasm.sha256='b'.repeat(64);assert.notEqual(taskPlanIdentity(first),taskPlanIdentity(second));
  assert.throws(()=>taskPlanIdentity({}),{code:'TASK_PLAN_INVALID'});
});

test('the execution process rejects a changed input plan before invoking the executor',async t=>{
  const f=fixture(t),a=officialAdapter(f);let current='a'.repeat(64);
  const service=createTaskService({...a.api,planOfficial:()=>({inputs:{pck:{bytes:1,sha256:current}}})});
  const expectedPlanSha256=taskPlanIdentity(service.plan(f.file));current='b'.repeat(64);
  await assert.rejects(service.execute(f.file,{write:true,expectedPlanSha256}),{code:'TASK_PLAN_CHANGED'});assert.equal(a.calls.length,0);
  assert(!fs.existsSync(path.join(f.dir,'output')));
  const io=streams();assert.equal(await runTaskCli(['execute',f.file,'--write','--expected-plan-sha256',expectedPlanSha256],{...io,service}),1);
  assert.equal(JSON.parse(io.error()).code,'TASK_PLAN_CHANGED');assert.equal(a.calls.length,0);
  const currentSha=taskPlanIdentity(service.plan(f.file));const result=await service.execute(f.file,{write:true,expectedPlanSha256:currentSha});assert.equal(result.status,'SUCCESS');assert.equal(a.calls.length,1);
});

test('expected plan does not replace explicit write or capability checks; malformed flags never dispatch',async t=>{
  const f=fixture(t,{purpose:'inspect'}),a=officialAdapter(f),service=createTaskService(a.api),expectedPlanSha256=taskPlanIdentity(service.plan(f.file));
  await assert.rejects(service.execute(f.file,{expectedPlanSha256}),{code:'TASK_WRITE_REQUIRED'});
  await assert.rejects(service.execute(f.file,{write:true,expectedPlanSha256}),{code:'TASK_CAPABILITY_DENIED'});
  await assert.rejects(service.execute(f.file,{write:true,expectedPlanSha256:'bad'}),{code:'TASK_PLAN_INVALID'});
  for(const args of [['execute',f.file,'--write','--expected-plan-sha256','BAD'],['execute',f.file,'--write','--other',expectedPlanSha256]]){
    const io=streams();assert.equal(await runTaskCli(args,{...io,service}),1);assert.equal(JSON.parse(io.error()).code,'TASK_ARGUMENT_INVALID');
  }
  assert.equal(a.calls.length,0);
});
