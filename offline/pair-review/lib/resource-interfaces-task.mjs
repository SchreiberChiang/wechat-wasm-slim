// Existing-file preparation only. Shared task receipts never imply runtime acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {renderResourceInterfacesFromFiles} from './resource-interfaces-bundle.mjs';
import {normalizeResourceConfig} from './resource-pack-plan.mjs';
import {createTask,inspectTask,measureTaskBytes} from '../convert/lib/official-task.mjs';
import {readTaskEventProgress} from './task-events.mjs';

const MiB=1024*1024,RESERVE=3*MiB;
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const SOURCES=['./resource-interfaces-task.mjs','./resource-interfaces-bundle.mjs','./resource-pack-plan.mjs','./pck-inventory.mjs','./task-events.mjs','./task-core.mjs','../convert/lib/official-task.mjs',
  ...['resource-command-bridge.js','resource-subpackage-reader.js','resource-host-lifecycle.js','resource-load-state-core.js','resource-mount-command-core.js','resource-scene-command-core.js','resource-executor.js','resource-interfaces-runtime.js'].map(f=>'../convert/assets/'+f)];
function read(file,limit,expected){
  const before=fs.lstatSync(file,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_INTERFACES_TASK_FILE');
  need(before.size>0n&&before.size<=BigInt(limit),'RESOURCE_INTERFACES_TASK_INPUT_BUDGET');
  if(expected)need(before.size===BigInt(expected.bytes),'RESOURCE_INTERFACES_TASK_CHANGED');
  const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(Number(before.size));
  try{
    need(same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_INTERFACES_TASK_CHANGED');
    let at=0;while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,null);need(n>0,'RESOURCE_INTERFACES_TASK_CHANGED');at+=n;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_INTERFACES_TASK_CHANGED');
  }finally{fs.closeSync(fd);}
  need(same(before,fs.lstatSync(file,{bigint:true}))&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_INTERFACES_TASK_CHANGED');
  if(expected)assert.deepEqual(pin(bytes),expected,'RESOURCE_INTERFACES_TASK_CHANGED');
  return bytes;
}
function document(file,limit=MiB){const b=read(file,limit);return {file,value:JSON.parse(b),...pin(b)};}
function inputPath(value){
  need(typeof value==='string'&&value&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f]/.test(value),'RESOURCE_INTERFACES_TASK_PATH');return value;
}
function normalized(raw,base){
  need(exact(raw,['schema','resourceConfigFile','engine','output','budgetBytes'])&&raw.schema==='wxslim-resource-interfaces-task-v1','RESOURCE_INTERFACES_TASK_CONFIG');
  need(exact(raw.engine,['js','wasm','expected'])&&exact(raw.engine.expected,['engineJsSha256','wasmSha256'])&&Object.values(raw.engine.expected).every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)),'RESOURCE_INTERFACES_TASK_ENGINE');
  need(Number.isSafeInteger(raw.budgetBytes)&&raw.budgetBytes>=4*MiB&&raw.budgetBytes<=8*MiB,'RESOURCE_INTERFACES_TASK_BUDGET');
  return {...structuredClone(raw),resourceConfigFile:path.resolve(base,inputPath(raw.resourceConfigFile)),output:path.resolve(base,inputPath(raw.output)),
    engine:{...structuredClone(raw.engine),js:path.resolve(base,inputPath(raw.engine.js)),wasm:path.resolve(base,inputPath(raw.engine.wasm))}};
}
function parent(output,absent){
  const dir=path.dirname(output),s=fs.lstatSync(dir);
  need(s.isDirectory()&&!s.isSymbolicLink()&&norm(fs.realpathSync(dir))===norm(dir),'RESOURCE_INTERFACES_TASK_PARENT');
  if(absent)try{fs.lstatSync(output);need(false,'RESOURCE_INTERFACES_TASK_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
}
function disjoint(output,files){for(const file of files)need(norm(file)!==norm(output)&&!norm(file).startsWith(norm(output)+path.sep),'RESOURCE_INTERFACES_TASK_OVERLAP');}
function sourcePins(){return SOURCES.map(file=>({file,...pin(read(fileURLToPath(new URL(file,import.meta.url)),MiB))}));}
function planHash(plan){const {planSha256,...rest}=plan;return sha(JSON.stringify(rest));}
function prepare(file,includeBundle=false){
  file=path.resolve(file);const config=document(file),input=normalized(config.value,path.dirname(file));parent(input.output,true);
  const resource=document(input.resourceConfigFile),base=path.dirname(resource.file),sources=sourcePins();
  for(const p of resource.value.packs??[])inputPath(p.file);
  const normalizedResources=normalizeResourceConfig(resource.value,base);
  const resourcePacks=normalizedResources.packs.filter(p=>p.role==='resource');
  need(resourcePacks.length>0&&resourcePacks.length<=128&&resourcePacks.every(p=>p.bytes<=32*MiB)&&resourcePacks.reduce((n,p)=>n+p.bytes,0)<=64*MiB,'RESOURCE_INTERFACES_RUNTIME_LIMIT');
  const files=[file,resource.file,input.engine.js,input.engine.wasm,...normalizedResources.packs.map(p=>p.file),...SOURCES.map(f=>fileURLToPath(new URL(f,import.meta.url)))];disjoint(input.output,files);
  const inputs=[{role:'engine-js',file:input.engine.js,...pin(read(input.engine.js,256*MiB))},{role:'engine-wasm',file:input.engine.wasm,...pin(read(input.engine.wasm,256*MiB))},
    ...normalizedResources.packs.map(p=>({role:p.role,id:p.id,file:p.file,...pin(read(p.file,p.role==='resource'?32*MiB:256*MiB,{bytes:p.bytes,sha256:p.sha256}))}))];
  const bundle=renderResourceInterfacesFromFiles({config:resource.value,base,engine:input.engine,expected:input.engine.expected,developmentOnly:true});
  const {source,...metadata}=bundle,output={path:'interfaces.js',bytes:bundle.bytes,sha256:bundle.sha256};
  const plan={schema:'wxslim-resource-interfaces-task-plan-v1',input,configuration:pin(read(file,MiB)),resourceConfiguration:{file:resource.file,bytes:resource.bytes,sha256:resource.sha256},
    sources,inputs,outputs:[output],resourcePlanSha256:bundle.planSha256,outputBytes:bundle.bytes,receiptReserveBytes:RESERVE,
    exportPerformed:false,conversionPerformed:false,engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',admission:'NOT_ADMITTED',
    evidence:'STATIC_RESOURCE_INTERFACES_ONLY_NOT_A_CONVERTED_GAME_OR_DEVICE_ACCEPTANCE'};
  plan.planSha256=planHash(plan);
  need(bundle.bytes+RESERVE<=input.budgetBytes,'RESOURCE_INTERFACES_TASK_BUDGET');
  need(json(plan).length<=MiB&&json(input).length<=MiB&&json(metadata).length<=MiB&&json(plan).length+json(input).length+json(metadata).length+256*1024<=RESERVE,'RESOURCE_INTERFACES_TASK_RECEIPT_BUDGET');
  assert.deepEqual(pin(read(file,MiB)),{bytes:config.bytes,sha256:config.sha256},'RESOURCE_INTERFACES_TASK_CHANGED');
  assert.deepEqual(pin(read(resource.file,MiB)),{bytes:resource.bytes,sha256:resource.sha256},'RESOURCE_INTERFACES_TASK_CHANGED');
  for(const p of inputs)read(p.file,256*MiB,{bytes:p.bytes,sha256:p.sha256});
  assert.deepEqual(sourcePins(),sources,'RESOURCE_INTERFACES_TASK_SOURCE_CHANGED');
  // Bind the actual assets loaded by the renderer as well as its implementation.
  assert.equal(bundle.generatorSha256,sources.find(p=>p.file==='./resource-interfaces-bundle.mjs').sha256);
  for(const [asset,p]of Object.entries(bundle.assetPins))assert.deepEqual(p,(({bytes,sha256})=>({bytes,sha256}))(sources.find(s=>s.file==='../convert/assets/'+asset)));
  return {input:{...input,configurationFile:file},before:{configuration:plan.configuration,planSha256:plan.planSha256},plan,profile:'resource-interfaces-prepare-v1',...(includeBundle?{bundle,metadata}:{})};
}
export function prepareResourceInterfacesTask(file){return prepare(file);}
function put(file,bytes){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const errorCode=e=>/^(RESOURCE_|PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(e?.code??'')?e.code:'RESOURCE_INTERFACES_TASK_FAILED';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
export async function executeResourceInterfacesTask(input,before,{writeAuthorized=false}={}){
  need(writeAuthorized===true,'TASK_WRITE_REQUIRED');
  const prepared=prepare(input.configurationFile,true);
  assert.deepEqual(prepared.input,input,'RESOURCE_INTERFACES_TASK_CHANGED');assert.deepEqual(prepared.before,before,'RESOURCE_INTERFACES_TASK_CHANGED');
  const {plan,bundle,metadata}=prepared,task=createTask(input.output,{budgetBytes:input.budgetBytes,recipeId:'resource-interfaces-prepare:'+plan.planSha256});
  const start=performance.now(),phases=[];let stage='SNAPSHOT',auditPin=null,status='SUCCESS',failure=null;
  try{
    put(path.join(task.root,'REQUEST.private.json'),json(plan.input));put(path.join(task.root,'PLAN.private.json'),json(plan));task.event({stage,status:'SUCCEEDED'});
    await turn();task.checkpoint('WRITE_INTERFACES');stage='WRITE_INTERFACES';let at=performance.now();
    put(path.join(task.root,'interfaces.js'),Buffer.from(bundle.source));
    task.event({stage,status:'SUCCEEDED',details:plan.outputs[0]});phases.push({name:stage,wallMs:performance.now()-at,status:'SUCCESS'});
    await turn();task.checkpoint('VERIFY');stage='VERIFY';at=performance.now();
    assert.deepEqual(sourcePins(),plan.sources,'RESOURCE_INTERFACES_TASK_SOURCE_CHANGED');
    read(input.configurationFile,MiB,plan.configuration);read(input.resourceConfigFile,MiB,{bytes:plan.resourceConfiguration.bytes,sha256:plan.resourceConfiguration.sha256});
    for(const p of plan.inputs)read(p.file,256*MiB,{bytes:p.bytes,sha256:p.sha256});
    read(path.join(task.root,'interfaces.js'),input.budgetBytes,{bytes:bundle.bytes,sha256:bundle.sha256});
    const audit={...metadata,schema:'wxslim-resource-interfaces-task-audit-v1',status:'PASS_WRITTEN_INTERFACES_BYTES_ONLY',taskId:task.taskId,planSha256:plan.planSha256,resourcePlanSha256:bundle.planSha256,
      bundleSchema:metadata.schema,writtenFiles:plan.outputs,exportPerformed:false,conversionPerformed:false,engineRun:'NOT_RUN',admission:'NOT_ADMITTED'};
    const bytes=json(audit);put(path.join(task.root,'AUDIT.json'),bytes);auditPin=pin(bytes);
    phases.push({name:stage,wallMs:performance.now()-at,status:'SUCCESS'});task.event({stage,status:'SUCCEEDED'});
    await turn();task.checkpoint('COMPLETE');stage='COMPLETE';
  }catch(error){
    failure={stage,code:errorCode(error)};put(path.join(task.root,'FAILURE.private.json'),json({...failure,error:String(error).slice(0,4096),stack:String(error.stack??'').slice(0,16384)}));
    status=error.code==='TASK_CANCELLED'?'CANCELLED':'FAILED';
  }
  const terminal=task.finish(status,{kind:'RESOURCE_INTERFACES_PREPARE',planSha256:plan.planSha256,...failure,audit:auditPin,phases,admission:'NOT_ADMITTED',engineRun:'NOT_RUN'});
  return {status:terminal.status,terminal,taskId:task.taskId,elapsedMs:performance.now()-start,logicalBytes:measureTaskBytes(task.root),audit:auditPin,phases};
}

// Control binds the saved execution, without reading mutable PCK/engine/generator inputs.
export function controlResourceInterfacesTask({source,request,config,root,taskId}){
  const input=normalized(config.value,path.dirname(config.file));parent(input.output,false);need(norm(input.output)===norm(root),'TASK_ID_MISMATCH');
  need(norm(fs.realpathSync(root))===norm(root),'TASK_PATH_INVALID');
  const state=inspectTask(root,taskId),saved=document(path.join(root,'REQUEST.private.json')),plan=document(path.join(root,'PLAN.private.json'));
  assert.equal(plan.value.schema,'wxslim-resource-interfaces-task-plan-v1');
  assert.deepEqual(saved.value,input);assert.deepEqual(plan.value.input,input);
  assert.deepEqual(plan.value.configuration,{bytes:read(config.file,MiB).length,sha256:config.sha256});assert.equal(planHash(plan.value),plan.value.planSha256);
  const recipeId='resource-interfaces-prepare:'+plan.value.planSha256;assert.equal(state.owner.recipeId,recipeId);assert.equal(state.owner.budgetBytes,input.budgetBytes);
  const documents=[saved,plan],terminal=state.terminal;
  if(terminal){
    assert.equal(terminal.details?.kind,'RESOURCE_INTERFACES_PREPARE');assert.equal(terminal.details.planSha256,plan.value.planSha256);
    assert.equal(terminal.details.admission,'NOT_ADMITTED');assert.equal(terminal.details.engineRun,'NOT_RUN');
    if(terminal.status==='SUCCESS'){
      const audit=document(path.join(root,'AUDIT.json'));documents.push(audit);
      assert.deepEqual({bytes:audit.bytes,sha256:audit.sha256},terminal.details.audit);assert.equal(audit.value.taskId,taskId);assert.equal(audit.value.planSha256,plan.value.planSha256);
      assert.equal(audit.value.status,'PASS_WRITTEN_INTERFACES_BYTES_ONLY');assert.deepEqual(audit.value.writtenFiles,plan.value.outputs);assert.equal(audit.value.resourcePlanSha256,plan.value.resourcePlanSha256);
    }
  }
  const stable=()=>{for(const d of [source,config,...documents])assert.equal(document(d.file).sha256,d.sha256);};stable();
  const warnings=[];if(state.logicalBytes>input.budgetBytes)warnings.push({code:'TASK_BUDGET_EXCEEDED',message:'超出原任务预算；不扩大预算。'});
  try{const s=fs.lstatSync(path.join(root,'.control-lock'));need(s.isDirectory()&&!s.isSymbolicLink(),'TASK_PATH_INVALID');warnings.push({code:'TASK_CONTROL_LOCK_PRESENT',message:'控制锁存在；不据此认定进程存活，不接管或移除锁。'});}catch(e){if(e.code!=='ENOENT')throw e;}
  return {root,taskId,recipeId,stable,output:{schema:'wxslim-task-status-v1',action:request.action,taskId,recipeId,profile:'resource-interfaces-prepare-v1',packageId:null,
    requestSha256:source.sha256,configurationSha256:config.sha256,status:terminal?.status??(state.cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),terminalPresent:!!terminal,
    cancellationRequested:!!state.cancellation,inputBinding:'MATCHED_EXECUTION_SNAPSHOT',logicalBytes:state.logicalBytes,budgetBytes:input.budgetBytes,warnings,progress:readTaskEventProgress(root,taskId),
    taskFailureCode:/^(RESOURCE_|PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(terminal?.details?.code??'')?terminal.details.code:null,
    processLiveness:'NOT_OBSERVED',admission:'NOT_ADMITTED',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
    scope:'Execution snapshot and receipts only; not a current output re-audit, converted game, dependency proof or device acceptance.'}};
}
