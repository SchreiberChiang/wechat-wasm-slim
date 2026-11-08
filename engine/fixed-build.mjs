// Fixed full/conservative builder. Preparation in this repository does not run it.
// No retries, cache creation, global toolchain writes or legacy trim execution.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {brotliCompressSync,constants} from 'node:zlib';
import {recipe,repo,read,sha,checkDependencies,returnZero} from './alpha-preserve-lighting/delivery.mjs';
import {fixedBuildPlan,normalizeFixedBuildConfig,assertFixedBuildInvariants,auditFixedBuildInputs} from './fixed-engine-plan.mjs';
import {auditFixedSource,assertSourceEvidenceUnchanged} from './fixed-source-audit.mjs';
import {auditFixedModules} from './fixed-module-audit.mjs';
import {inspectPairBuffers} from './audit-pair.mjs';
import {buildEnv,buildIdentity,SOURCE_TESTS} from '../trim/lib/build.mjs';
import {createTask,inspectTask,requestCancellation} from '../convert/lib/official-task.mjs';
import {runOwnedProcess} from '../convert/lib/owned-process.mjs';
import {runBuildPhases} from './fixed-build-lifecycle.mjs';

const GiB=2**30;
export const BUILD_PHASES=Object.freeze(['SNAPSHOT','SOURCE','SOURCE_AUDIT','SOURCE_TESTS','PRECOMPILE','COMPILE','CAPTURE_RAW','POSTPROCESS','ARTIFACTS','FINAL_AUDIT']);
const implementationFiles=['engine/fixed-build.mjs','engine/fixed-build-lifecycle.mjs','engine/fixed-engine-plan.mjs','engine/fixed-engine-policy.json','engine/fixed-source-audit.mjs','engine/fixed-module-audit.mjs','engine/fixed-dependency-audit.py','engine/fixed-toolchain-cache.json','engine/audit-pair.mjs','engine/alpha-preserve-lighting/delivery.mjs','engine/alpha-preserve-lighting/delivery-build.mjs','engine/alpha-preserve-lighting/delivery-recipe.json','engine/alpha-preserve-lighting/delivery-resources.ps1','trim/lib/build.mjs','convert/lib/owned-process.mjs','convert/lib/official-task.mjs'];
const failure=(code,message)=>Object.assign(Error(message),{code});
const id=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function regular(file){const st=fs.lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink(),'regular file required');return read(file);}
function writeNew(file,bytes){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const writeJson=(file,value)=>writeNew(file,JSON.stringify(value,null,2)+'\n');
function inside(root,file){assert(norm(file).startsWith(norm(root)+path.sep),'file must stay inside task root');let ancestor=file;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);const real=fs.realpathSync(ancestor),rootReal=fs.realpathSync(root);assert(norm(real)===norm(rootReal)||norm(real).startsWith(norm(rootReal)+path.sep),'linked path escapes task root');return file;}
function treeSize(root){let bytes=0,transientGone=0;for(const entry of fs.readdirSync(root)){const file=path.join(root,entry);let st;try{st=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT'){transientGone++;continue;}throw e;}assert(!st.isSymbolicLink(),'linked task content refused');if(st.isDirectory()){const row=treeSize(file);bytes+=row.bytes;transientGone+=row.transientGone;}else{assert(st.isFile());bytes+=st.size;}}return {bytes,transientGone};}

export function normalizeExecutionRequest(raw,base=process.cwd()){
  assert(raw&&typeof raw==='object'&&!Array.isArray(raw));
  assert(Object.keys(raw).every(k=>['schema','inputs','sconsWheel','sdkArchive','gitExecutable','budgetBytes'].includes(k)),'unknown execution input');
  assert.equal(raw.schema,'wxslim-fixed-execution-v1');
  const request={...raw,inputs:normalizeFixedBuildConfig(raw.inputs,base)};
  for(const k of ['sconsWheel','sdkArchive','gitExecutable']){assert(typeof raw[k]==='string'&&raw[k].trim(),'explicit dependency path required');request[k]=path.resolve(base,raw[k]);}
  assert(Number.isSafeInteger(raw.budgetBytes)&&raw.budgetBytes>=8*GiB&&raw.budgetBytes<=20*GiB,'explicit approved budget 8..20 GiB');
  return request;
}

export function executionPlan(raw){
  const request=normalizeExecutionRequest(raw),base=fixedBuildPlan(request.inputs),work=base.work;
  const inputs=path.join(work,'inputs'),profile=path.join(inputs,'profile.gdbuild'),library=path.join(inputs,'libemscriptenglx.a');
  return {...base,schema:'wxslim-fixed-execution-plan-v1',request,profile,library,
    sconsArgs:base.sconsArgs.map(a=>a.startsWith('build_profile=')?'build_profile='+profile:a.startsWith('wx_glx_lib=')?'wx_glx_lib='+library:a),
    source:base.stage,phases:[...BUILD_PHASES],budgetBytes:request.budgetBytes,
    snapshotInputs:['profile','five source/Windows patches','026e library','small recipe and executor source files'],
    cachePolicy:'Existing fixed SDK cache is read-only and frozen; missing libraries stop without embuilder or cache mutation.',
    timing:'Compilation/link/WASM optimization share a measured SCons interval unless the tool supplies separate boundaries; no invented per-link timing.',
    writes:['one new source/build checkout inside approved work','small input snapshots, logs, raw/processed/return0 JS and paired artifacts inside work'],
    cancellation:'Wait for owned child close and drained logs; no kill. Do not start subsequent phases.',
    admission:'terminal SUCCESS and independently rechecked build receipts/byte pair; never runtime acceptance',executionAuthorized:false};
}

export function validateWorkPlacement(request){
  const cfg=request.inputs,work=cfg.work,parent=fs.realpathSync(path.dirname(work));
  assert.equal(norm(parent),norm(path.dirname(work)),'new work parent must be its real path');
  assert(!fs.existsSync(work),'existing work refused');
  const python=fs.realpathSync(cfg.python),venvCandidate=path.resolve(path.dirname(python),'..');
  const pythonTree=fs.existsSync(path.join(venvCandidate,'pyvenv.cfg'))?venvCandidate:path.dirname(python);
  const protectedTrees=[repo,fs.realpathSync(cfg.sdk),pythonTree];
  const overlaps=(a,b)=>norm(a)===norm(b)||norm(a).startsWith(norm(b)+path.sep)||norm(b).startsWith(norm(a)+path.sep);
  for(const tree of protectedTrees)assert(!overlaps(work,tree),'work overlaps a protected repository/toolchain tree');
  for(const file of [cfg.library,cfg.editor,request.sconsWheel,request.sdkArchive,request.gitExecutable])assert(!overlaps(work,fs.realpathSync(file)),'work overlaps dependency');
  return {status:'PASS_WORK_PLACEMENT',protectedTrees};
}

// Fast polling deliberately avoids the task component's whole-tree budget scan.
// A writer creates cancel.json under .control-lock; wait for that atomic control
// section to finish before parsing. A persistent malformed receipt is an error.
export function cancellationReader(root,taskId){
  let transientSince=null;
  const transient=()=>{transientSince??=Date.now();if(Date.now()-transientSince>2000)throw failure('CANCEL_RECEIPT_INCOMPLETE','persistent task control lock or incomplete cancellation receipt');return false;};
  return ()=>{
    if(fs.existsSync(path.join(root,'.control-lock')))return transient();
    let bytes;try{bytes=regular(path.join(root,'cancel.json'));}catch(e){if(e.code==='ENOENT')return false;throw e;}
    if(fs.existsSync(path.join(root,'.control-lock')))return transient();
    let value;try{value=JSON.parse(bytes);}catch(e){if(e instanceof SyntaxError)return transient();throw e;}
    transientSince=null;assert.equal(value.schema,'wxslim-official-task-v1');assert.equal(value.taskId,taskId);assert.equal(value.status,'CANCEL_REQUESTED');return true;
  };
}

export function cancellationSignals(task,host=process,request=requestCancellation){
  const state={requested:false,errors:[]};
  const handler=()=>{state.requested=true;try{request(task.root,task.taskId);}catch(e){state.errors.push({code:e.code||'CANCEL_WRITE_FAILED',message:String(e.message)});}};
  host.on('SIGINT',handler);host.on('SIGTERM',handler);
  return {isRequested:()=>state.requested,errors:state.errors,detach:()=>{host.off('SIGINT',handler);host.off('SIGTERM',handler);}};
}

function resourceSnapshot(dir){
  const ps=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const system=JSON.parse(execFileSync(ps,['-NoProfile','-File',path.join(repo,'engine/alpha-preserve-lighting/delivery-resources.ps1')],{encoding:'utf8',windowsHide:true,timeout:20000}));
  const stat=fs.statfsSync(dir);
  return {at:new Date().toISOString(),freeMemory:os.freemem(),totalMemory:os.totalmem(),cpuCount:os.availableParallelism(),freeDisk:stat.bavail*stat.bsize,...system};
}
export function checkResourceHeadroom(sample,{jobs,budgetBytes,initial=false,logicalBytes=0}){
  assert(Number.isInteger(jobs)&&jobs>=1&&jobs<=16);
  assert(sample.cpuCount>=11&&jobs<=Math.floor(sample.cpuCount*.75),'fixed ThinLTO 8 needs CPU headroom');
  assert(sample.freeMemory>=Math.max((initial?8:2)*GiB,sample.totalMemory*(initial?.25:.1)),'insufficient available memory');
  assert(sample.commitHeadroomBytes>=(initial?8:2)*GiB,'insufficient commit headroom');
  assert(Number.isFinite(sample.cpuPercent)&&sample.cpuPercent>=0&&sample.cpuPercent<=100,'valid system CPU sample required');
  // CPU load only slows the build down; it never makes it unsafe. Memory, commit headroom, disk and budget
  // still stop the build, because running out of those is what corrupts output or hangs the machine.
  const cpuBusy=sample.cpuPercent>=(initial?60:90);
  if(initial)assert(sample.freeDisk>=budgetBytes+2*GiB,'insufficient free disk for approved budget and reserve');
  else {assert(sample.freeDisk>=2*GiB,'disk reserve low');assert(logicalBytes<budgetBytes-Math.min(GiB,budgetBytes*.1),'budget reserve low');}
  return {status:'PASS_CURRENT_RESOURCES',samplingIsGuarantee:false,cpuBusy};
}

function dependencyAudit(request,env,cwd){
  const cfg=request.inputs;
  const text=execFileSync(cfg.python,['-B',path.join(repo,'engine/fixed-dependency-audit.py'),'--sdk',cfg.sdk,'--scons-wheel',request.sconsWheel,'--sdk-archive',request.sdkArchive],{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  const report=JSON.parse(text);assert.equal(report.status,'PASS_DEPENDENCIES_ONLY');return report;
}
function implementationEvidence(){return implementationFiles.map(name=>({path:name,...id(regular(path.join(repo,name)))}));}
function selectedEnvironment(env){return Object.fromEntries(['EMSDK','EM_CONFIG','EM_CACHE','EM_FROZEN_CACHE','EMSDK_PYTHON','EMCC_CORES','BINARYEN_CORES','PYTHONDONTWRITEBYTECODE','TEMP','TMP','EMCC_TEMP_DIR'].map(k=>[k,env[k]]));}

export function assertRawCaptureOutputs(capture,outputs){
  for(const [key,name]of [['rawJs','emscripten-before-godot-process.js'],['wasm','godot.wasm'],['symbols','godot.js.symbols']]){assert(capture?.[key]&&outputs?.[name],'raw capture evidence required');assert.deepEqual(capture[key],outputs[name],'raw capture changed: '+key);}
}
export function rejectBuildEnvironmentOverrides(environment){
  for(const [key,value]of Object.entries(environment))if(['SCONSFLAGS','SCONS_LIB_DIR','PYTHONOPTIMIZE','PYTHONINSPECT'].includes(key.toUpperCase()))assert(!value,'unexpected build environment override: '+key);
}

// Shared API and explicit-write CLI use this same fixed-recipe executor.
export async function executeFixedBuild(raw,{write=false}={}){
  assert(write===true,'explicit write required');assert.equal(process.platform,'win32','fixed Windows recipe only');
  const plan=executionPlan(raw),request=plan.request,cfg=request.inputs,work=plan.work;
  validateWorkPlacement(request);
  rejectBuildEnvironmentOverrides(process.env);
  const gitIdentity=id(regular(request.gitExecutable));
  checkDependencies(cfg); // Fixed runtime/SDK/editor fingerprints before creating work.
  const implementation=implementationEvidence();
  const tc={emsdk:cfg.sdk,python:cfg.python,engineSource:plan.source,pin:recipe.engine.source.commit,glxLibrary:plan.library,glxLibrarySha256:recipe.engine.library.sha256,patches:recipe.engine.patches.map(p=>path.join(repo,p.path)),cppdefines:''};
  const env={...buildEnv(tc),EM_FROZEN_CACHE:'1',EMCC_CORES:String(plan.jobs),BINARYEN_CORES:String(plan.jobs),TEMP:path.join(work,'temp'),TMP:path.join(work,'temp'),EMCC_TEMP_DIR:path.join(work,'temp')};
  const initial=resourceSnapshot(path.dirname(work));checkResourceHeadroom(initial,{jobs:plan.jobs,budgetBytes:plan.budgetBytes,initial:true});
  const dependenciesBefore=dependencyAudit(request,env,path.dirname(work));
  const task=createTask(work,{budgetBytes:plan.budgetBytes,recipeId:'fixed-engine:'+plan.semanticRecipeSha256});
  const signals=cancellationSignals(task),diskCancellation=cancellationReader(work,task.taskId),isCancelled=()=>signals.isRequested()||diskCancellation(),commands=[],samples=[initial],phaseBoundaries=[];
  const record={schema:'wxslim-fixed-build-v1',taskId:task.taskId,profileId:cfg.profile,plan,implementation,gitIdentity,dependenciesBefore,environment:selectedEnvironment(env),commands,samples,phaseBoundaries,engineExecution:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',attempts:1};
  let inputEvidence,beforeSource,rawWasmSha,pressure=null,sequence=0;
  const evidence=name=>path.join(work,'evidence',name+'.json');
  const sample=()=>{const s=resourceSnapshot(work),size=treeSize(work),row={...s,logicalBytes:size.bytes,transientFilesGone:size.transientGone};samples.push(row);checkResourceHeadroom(s,{jobs:plan.jobs,budgetBytes:plan.budgetBytes,logicalBytes:size.bytes});return row;};
  const run=async(stage,exe,args,cwd=plan.source)=>{
    task.checkpoint(stage);const n=String(++sequence).padStart(3,'0'),stdoutPath=path.join(work,'logs',n+'-'+stage+'.stdout.log'),stderrPath=path.join(work,'logs',n+'-'+stage+'.stderr.log');
    const command={stage,executable:exe,args:[...args],cwd,startedAt:new Date().toISOString(),stdout:path.relative(work,stdoutPath),stderr:path.relative(work,stderrPath)};commands.push(command);
    const timer=setInterval(()=>{try{sample();}catch(e){pressure??={code:'RESOURCE_PRESSURE',message:String(e.message)};}},15000);
    try{command.result=await runOwnedProcess({executable:exe,args,cwd,env,stdoutPath,stderrPath,isCancellationRequested:isCancelled});}
    finally{clearInterval(timer);command.endedAt=new Date().toISOString();for(const key of ['stdout','stderr'])if(fs.existsSync(path.join(work,command[key])))command[key+'Identity']=id(regular(path.join(work,command[key])));}
    if(command.result.outcome==='CANCELLED')throw failure('TASK_CANCELLED','child closed after cancellation');
    assert(command.result.closed&&command.result.outcome==='SUCCESS',command.result.error||'owned process failed');
    if(pressure)throw failure(pressure.code,pressure.message);
    task.checkpoint(stage);return {command:n,exitCode:command.result.exitCode,elapsedMs:command.result.elapsedMs};
  };
  const git=(stage,args,cwd=plan.source)=>run(stage,request.gitExecutable,args,cwd);
  const phases=[
    {name:'SNAPSHOT',run:async()=>{
      for(const dir of ['inputs','logs','temp','artifacts','evidence'])fs.mkdirSync(path.join(work,dir));
      writeNew(plan.profile,regular(plan.selectedProfile.path));writeNew(plan.library,regular(cfg.library));
      const snapshots=[];
      for(const file of [...plan.patches,...implementation.map(f=>({path:f.path,sha256:f.sha256}))]){
        const dest=inside(work,path.join(work,'inputs',file.path)),bytes=regular(path.join(repo,file.path));assert.equal(sha(bytes),file.sha256);
        if(!fs.existsSync(dest)){fs.mkdirSync(path.dirname(dest),{recursive:true});writeNew(dest,bytes);snapshots.push({path:path.relative(work,dest),...id(bytes)});}
      }
      writeJson(path.join(work,'inputs','REQUEST.json'),request);record.snapshots=snapshots;
      return {profile:id(regular(plan.profile)),library:id(regular(plan.library)),files:snapshots.length};
    }},
    {name:'SOURCE',run:async()=>{
      await git('SOURCE',['init',plan.source],work);await git('SOURCE',['config','core.autocrlf','false']);await git('SOURCE',['remote','add','origin',recipe.engine.source.repository]);
      await git('SOURCE',['fetch','--depth=1','origin',recipe.engine.source.commit]);await git('SOURCE',['checkout','--detach',recipe.engine.source.commit]);
      for(const patch of plan.patches){const file=path.join(work,'inputs',patch.path);await git('SOURCE',['apply','--check',file]);await git('SOURCE',['apply',file]);}
      return {fixedCommit:recipe.engine.source.commit,patches:plan.patches.map(p=>p.sha256)};
    }},
    {name:'SOURCE_AUDIT',run:async()=>{beforeSource=auditFixedSource({source:plan.source});record.sourceAfterPatches=beforeSource;writeJson(evidence('source-after-patches'),beforeSource);return {status:beforeSource.status,files:beforeSource.files.length};}},
    {name:'SOURCE_TESTS',run:async()=>{for(const name of SOURCE_TESTS){const file=path.join(plan.source,'platform/web/js/tests',name);assert(fs.existsSync(file),'required source test');await run('SOURCE_TESTS',process.execPath,[file]);}return {tests:[...SOURCE_TESTS]};}},
    {name:'PRECOMPILE',run:async()=>{
      record.sourceBeforeCompile=auditFixedSource({source:plan.source});assertSourceEvidenceUnchanged(beforeSource,record.sourceBeforeCompile);writeJson(evidence('source-before-compile'),record.sourceBeforeCompile);
      record.identity=await buildIdentity({tc,profileFile:plan.profile,stage:plan.source,lto:'thin',symbols:true,ltoJobs:8});record.profileSha256=plan.selectedProfile.sha256;record.sconsArgs=plan.sconsArgs;
      assertFixedBuildInvariants(record,cfg.profile,{path:plan.profile,bytes:regular(plan.profile)});inputEvidence=auditFixedBuildInputs({build:record,profileId:cfg.profile});record.inputsBeforeCompile=inputEvidence;
      assert.deepEqual(dependencyAudit(request,env,work),dependenciesBefore,'dependencies changed before compilation');assert.deepEqual(implementationEvidence(),implementation,'executor inputs changed');
      return {status:inputEvidence.status,profile:record.profileSha256};
    }},
    {name:'COMPILE',run:async()=>{
      const result=await run('COMPILE',cfg.python,['-m','SCons',...plan.sconsArgs]);
      record.sourceAfterCompile=auditFixedSource({source:plan.source});assertSourceEvidenceUnchanged(beforeSource,record.sourceAfterCompile);writeJson(evidence('source-after-compile'),record.sourceAfterCompile);
      record.modules=auditFixedModules({source:plan.source,profile:cfg.profile});writeJson(evidence('generated-modules'),record.modules);
      return {...result,modules:record.modules.enabledModules.length,timing:'SCons compile/link/optimization combined; substage boundaries not inferred'};
    }},
    {name:'CAPTURE_RAW',run:async()=>{
      const raw=regular(path.join(plan.source,'bin/.web_zip/godot.js')),wasm=regular(path.join(plan.source,'bin/.web_zip/godot.wasm'));
      writeNew(path.join(work,'artifacts/emscripten-before-godot-process.js'),raw);writeNew(path.join(work,'artifacts/godot.wasm'),wasm);rawWasmSha=sha(wasm);
      const symbols=regular(path.join(plan.source,'bin/godot.web.template_release.wasm32.nothreads.js.symbols'));writeNew(path.join(work,'artifacts/godot.js.symbols'),symbols);
      record.rawCapture={rawJs:id(raw),wasm:id(wasm),symbols:id(symbols)};return record.rawCapture;
    }},
    {name:'POSTPROCESS',run:async()=>{const result=await run('POSTPROCESS',process.execPath,[path.join(plan.source,'godot_process.js')]);assert.equal(sha(regular(path.join(plan.source,'bin/.web_zip/godot.wasm'))),rawWasmSha,'postprocess changed WASM');return result;}},
    {name:'ARTIFACTS',run:async()=>{
      const js=regular(path.join(plan.source,'bin/.web_zip/godot.js')),wasm=regular(path.join(work,'artifacts/godot.wasm')),derived=returnZero(js);
      const br=brotliCompressSync(wasm,{params:{[constants.BROTLI_PARAM_QUALITY]:11,[constants.BROTLI_PARAM_SIZE_HINT]:wasm.length}});
      const files={'godot.js':js,'godot-return0.js':derived,'godot.wasm.br':br};for(const [name,bytes]of Object.entries(files))writeNew(path.join(work,'artifacts',name),bytes);
      record.outputs=Object.fromEntries([...Object.entries(files),['godot.wasm',wasm],['emscripten-before-godot-process.js',regular(path.join(work,'artifacts/emscripten-before-godot-process.js'))],['godot.js.symbols',regular(path.join(work,'artifacts/godot.js.symbols'))]].map(([name,bytes])=>[name,id(bytes)]));
      assertRawCaptureOutputs(record.rawCapture,record.outputs);
      return {outputs:record.outputs,globalId:'return 0',postprocessCount:1};
    }},
    {name:'FINAL_AUDIT',run:async()=>{
      record.sourceFinal=auditFixedSource({source:plan.source});assertSourceEvidenceUnchanged(beforeSource,record.sourceFinal);assert.deepEqual(auditFixedBuildInputs({build:record,profileId:cfg.profile}),inputEvidence);
      assert.deepEqual(auditFixedModules({source:plan.source,profile:cfg.profile}),record.modules,'generated module evidence changed');
      record.dependenciesAfter=dependencyAudit(request,env,work);assert.deepEqual(record.dependenciesAfter,dependenciesBefore,'SDK/cache/SCons changed');assert.deepEqual(implementationEvidence(),implementation,'executor changed');
      for(const snapshot of record.snapshots)assert.deepEqual(id(regular(inside(work,path.join(work,snapshot.path)))),{bytes:snapshot.bytes,sha256:snapshot.sha256},'snapshot changed');
      for(const [name,identity]of Object.entries(record.outputs))assert.deepEqual(id(regular(inside(work,path.join(work,'artifacts',name)))),identity,'output changed before terminal');
      assertRawCaptureOutputs(record.rawCapture,record.outputs);
      for(const command of commands){assert(command.result.outcome==='SUCCESS'&&command.result.closed);for(const channel of ['stdout','stderr']){const bytes=regular(path.join(work,command[channel]));assert.deepEqual(id(bytes),command[channel+'Identity']);assert(!/warning: undefined symbol:|error: undefined symbol:|unresolved symbol:|missing function:/i.test(bytes.toString()),'unresolved symbol or placeholder in logs');}}
      const js=regular(path.join(work,'artifacts/godot.js')),derived=regular(path.join(work,'artifacts/godot-return0.js')),wasm=regular(path.join(work,'artifacts/godot.wasm')),compressed=regular(path.join(work,'artifacts/godot.wasm.br'));
      assert(returnZero(js).equals(derived));record.pair=inspectPairBuffers({glue:derived,wasm,compressed});writeJson(evidence('pair-static'),record.pair);
      return {status:'STATIC_CHECKS_COMPLETE_AWAITING_TERMINAL',imports:record.pair.imports.length,exports:record.pair.exports.length,nativeMapping:record.pair.nativeMapping,runtime:'NOT_RUN'};
    }}
  ];
  try{return await runBuildPhases({phases,isCancelled,onEvent:event=>{if(event.status==='PASS')phaseBoundaries.at(-1).after=sample();task.event(event);},beforePhase:(name)=>{task.checkpoint(name);if(pressure)throw failure(pressure.code,pressure.message);phaseBoundaries.push({phase:name,before:sample()});},
    finish:(status,details)=>{
      record.phases=details.phases;record.requestedTerminal=status;record.status='REQUIRES_MATCHING_TASK_TERMINAL';record.endedAt=new Date().toISOString();if(details.error)record.failure=details.error;if(details.eventErrors)record.eventErrors=details.eventErrors;
      record.signalCancellationErrors=signals.errors;
      const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');writeNew(path.join(work,'BUILD.json'),bytes);
      return task.finish(status,{kind:'FIXED_ENGINE_BUILD',profile:cfg.profile,build:id(bytes),runtime:'NOT_RUN',visual:'NOT_VERIFIED'});
    }});}finally{signals.detach();}
}

// Check terminal first. A complete-looking BUILD or artifact directory cannot
// turn cancellation, a failed log drain or missing terminal into admission.
export function auditCompletedFixedBuild(root,taskId){
  const state=inspectTask(root,taskId),terminal=state.terminal;
  assert.equal(terminal?.status,'SUCCESS','successful matching durable terminal required');assert.equal(terminal.details.kind,'FIXED_ENGINE_BUILD');
  assert(!state.cancellation,'success/cancel receipts contradict each other');assert(state.logicalBytes<=state.owner.budgetBytes,'task exceeds budget');
  const buildBytes=regular(path.join(root,'BUILD.json'));assert.deepEqual(id(buildBytes),terminal.details.build,'terminal/BUILD binding');
  const build=JSON.parse(buildBytes);assert.equal(build.schema,'wxslim-fixed-build-v1');assert.equal(build.taskId,taskId);assert.equal(build.requestedTerminal,'SUCCESS');assert.equal(build.attempts,1);
  assert.equal(terminal.details.profile,build.profileId);assert.deepEqual(build.phases.map(p=>p.name),BUILD_PHASES);assert(build.phases.every(p=>p.status==='pass'));
  assert.equal(state.owner.recipeId,'fixed-engine:'+build.plan.semanticRecipeSha256);
  assert.equal(executionPlan(build.plan.request).semanticRecipeSha256,build.plan.semanticRecipeSha256,'semantic plan identity changed');
  assert(build.commands.length>0&&build.commands.every(c=>c.result?.outcome==='SUCCESS'&&c.result.closed&&c.result.exitCode===0));
  assert.equal(build.commands.filter(c=>c.stage==='COMPILE').length,1);assert.equal(build.commands.filter(c=>c.stage==='POSTPROCESS').length,1);
  assertSourceEvidenceUnchanged(build.sourceAfterPatches,build.sourceBeforeCompile);assertSourceEvidenceUnchanged(build.sourceAfterPatches,build.sourceAfterCompile);assertSourceEvidenceUnchanged(build.sourceAfterPatches,build.sourceFinal);
  assert.deepEqual(build.dependenciesBefore,build.dependenciesAfter);
  assert.equal(build.dependenciesBefore.status,'PASS_DEPENDENCIES_ONLY');
  const source=inside(root,build.plan.source);assertSourceEvidenceUnchanged(build.sourceFinal,auditFixedSource({source}));
  assert.deepEqual(build.modules,auditFixedModules({source,profile:build.profileId}));
  const compile=build.commands.find(c=>c.stage==='COMPILE'),post=build.commands.find(c=>c.stage==='POSTPROCESS');
  assert.equal(norm(compile.executable),norm(build.identity.sdk.python.path));assert.equal(norm(post.executable),norm(build.identity.hostRuntime.node.path));
  assert.deepEqual(compile.args,['-m','SCons',...build.sconsArgs]);assert.equal(norm(compile.cwd),norm(source));
  assert.deepEqual(post.args,[path.join(source,'godot_process.js')]);assert.equal(norm(post.cwd),norm(source));
  const tests=build.commands.filter(c=>c.stage==='SOURCE_TESTS');assert.deepEqual(tests.map(c=>c.args),SOURCE_TESTS.map(name=>[path.join(source,'platform/web/js/tests',name)]));
  for(const command of tests){assert.equal(norm(command.executable),norm(build.identity.hostRuntime.node.path));assert.equal(norm(command.cwd),norm(source));}
  const profile=inside(root,build.plan.profile);assertFixedBuildInvariants(build,build.profileId,{path:profile,bytes:regular(profile)});
  assert.deepEqual(auditFixedBuildInputs({build,profileId:build.profileId}),build.inputsBeforeCompile,'current named input files changed');
  assertRawCaptureOutputs(build.rawCapture,build.outputs);
  assert.deepEqual(build.phases.find(p=>p.name==='CAPTURE_RAW').result,build.rawCapture);
  assert.deepEqual(Object.keys(build.outputs).sort(),['emscripten-before-godot-process.js','godot.js','godot.js.symbols','godot-return0.js','godot.wasm','godot.wasm.br'].sort());
  for(const snapshot of build.snapshots)assert.deepEqual(id(regular(inside(root,path.join(root,snapshot.path)))),{bytes:snapshot.bytes,sha256:snapshot.sha256});
  const files={};for(const [name,identity]of Object.entries(build.outputs)){const file=inside(root,path.join(root,'artifacts',name));files[name]=regular(file);assert.deepEqual(id(files[name]),identity,'output differs');}
  for(const command of build.commands)for(const channel of ['stdout','stderr']){const bytes=regular(inside(root,path.join(root,command[channel])));assert.deepEqual(id(bytes),command[channel+'Identity']);assert(!/warning: undefined symbol:|error: undefined symbol:|unresolved symbol:|missing function:/i.test(bytes.toString()));}
  assert(returnZero(files['godot.js']).equals(files['godot-return0.js']));
  const pair=inspectPairBuffers({glue:files['godot-return0.js'],wasm:files['godot.wasm'],compressed:files['godot.wasm.br']});
  return {schema:'wxslim-fixed-build-admission-v1',status:'BUILD_AND_STATIC_AUDIT_PASS_RUNTIME_NOT_RUN',taskId,profile:build.profileId,build:id(buildBytes),outputs:build.outputs,nativeMapping:pair.nativeMapping,runtime:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'};
}
