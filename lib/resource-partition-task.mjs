// General exported-PCK file task. Reuses the shared receipt/cancel controller;
// never exports a project, infers dependencies, starts an engine or uploads.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {partitionPck,auditPckPartition,PCK_PARTITION_LIMIT_BYTES} from './pck-partition.mjs';
import {createTask,inspectTask,measureTaskBytes} from '../convert/lib/official-task.mjs';
import {readTaskEventProgress} from './task-events.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const RESERVE=4*1024*1024,MAX_BUDGET=PCK_PARTITION_LIMIT_BYTES+RESERVE;
const SOURCE_FILES=['./resource-partition-task.mjs','./pck-partition.mjs','./pck-inventory.mjs','./task-core.mjs','../convert/lib/official-task.mjs'];
function read(file,limit,expected){
  const before=fs.lstatSync(file,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_PARTITION_TASK_FILE');
  need(before.size>0&&before.size<=BigInt(limit),'RESOURCE_PARTITION_TASK_INPUT_BUDGET');
  if(expected)need(before.size===BigInt(expected.bytes),'RESOURCE_PARTITION_TASK_CHANGED');
  const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(Number(before.size));
  try{
    need(same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_PARTITION_TASK_CHANGED');
    let at=0;while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,null);need(n>0,'RESOURCE_PARTITION_TASK_CHANGED');at+=n;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_PARTITION_TASK_CHANGED');
  }finally{fs.closeSync(fd);}
  need(same(before,fs.lstatSync(file,{bigint:true}))&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_PARTITION_TASK_CHANGED');
  if(expected)assert.deepEqual(pin(bytes),expected,'RESOURCE_PARTITION_TASK_CHANGED');
  return bytes;
}
function document(file,limit=1024*1024){const bytes=read(file,limit);return {file,value:JSON.parse(bytes),...pin(bytes)};}
function normalized(raw,base){
  need(exact(raw,['schema','sourcePath','partition','output','budgetBytes'])&&raw.schema==='wxslim-pck-partition-task-v1','RESOURCE_PARTITION_TASK_CONFIG');
  for(const k of ['sourcePath','output'])need(typeof raw[k]==='string'&&raw[k].trim()===raw[k]&&raw[k]&&!/[\u0000\r\n]/.test(raw[k]),'RESOURCE_PARTITION_TASK_PATH');
  need(Number.isSafeInteger(raw.budgetBytes)&&raw.budgetBytes>=RESERVE&&raw.budgetBytes<=MAX_BUDGET,'RESOURCE_PARTITION_TASK_BUDGET');
  const source=raw.partition?.source;
  need(exact(source,['bytes','sha256'])&&Number.isSafeInteger(source.bytes)&&source.bytes>=104&&source.bytes<=PCK_PARTITION_LIMIT_BYTES&&/^[a-f0-9]{64}$/.test(source.sha256),'PCK_PARTITION_SOURCE_PIN');
  return {...structuredClone(raw),sourcePath:path.resolve(base,raw.sourcePath),output:path.resolve(base,raw.output)};
}
function outputParent(input,absent){
  const parent=path.dirname(input.output),s=fs.lstatSync(parent);
  need(s.isDirectory()&&!s.isSymbolicLink()&&norm(fs.realpathSync(parent))===norm(parent),'RESOURCE_PARTITION_TASK_PARENT');
  need(norm(input.sourcePath)!==norm(input.output)&&!norm(input.sourcePath).startsWith(norm(input.output)+path.sep),'RESOURCE_PARTITION_TASK_OVERLAP');
  if(absent){try{fs.lstatSync(input.output);need(false,'RESOURCE_PARTITION_TASK_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function sourcePins(){return SOURCE_FILES.map(file=>{const bytes=fs.readFileSync(new URL(file,import.meta.url));return {file,...pin(bytes)};});}
function planHash(plan){const {planSha256,...identity}=plan;return sha(JSON.stringify(identity));}
function prepare(file,includeBuffers=false){
  file=path.resolve(file);const config=document(file),input=normalized(config.value,path.dirname(file));outputParent(input,true);
  need(norm(file)!==norm(input.output)&&!norm(file).startsWith(norm(input.output)+path.sep),'RESOURCE_PARTITION_TASK_OVERLAP');
  const source=read(input.sourcePath,PCK_PARTITION_LIMIT_BYTES,input.partition.source),split=partitionPck(source,input.partition);
  const outputs=split.outputs.map(({id,role,bytes,sha256})=>({id,role,path:'packs/'+id+'.pck',bytes,sha256}));
  need(outputs.every(p=>!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(p.id)),'RESOURCE_PARTITION_TASK_RESERVED_NAME');
  const total=outputs.reduce((n,p)=>n+p.bytes,0);need(total+RESERVE<=input.budgetBytes,'RESOURCE_PARTITION_TASK_BUDGET');
  const plan={schema:'wxslim-resource-partition-task-plan-v1',input,configuration:{bytes:config.bytes,sha256:config.sha256},
    sources:sourcePins(),outputs,outputBytes:total,receiptReserveBytes:RESERVE,
    evidence:'PCK_BYTE_OWNERSHIP_ONLY_NOT_EXPORT_COMPLETENESS_OR_DEPENDENCY_CLOSURE',
    exportPerformed:false,engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',admission:'NOT_ADMITTED'};
  plan.planSha256=planHash(plan);
  const auditEstimate=json({...split.audit,taskId:'0'.repeat(36),planSha256:plan.planSha256,writtenFiles:outputs,
    dependencyCoverage:'NOT_INFERRED',engineRun:'NOT_RUN',phone:'NOT_RUN',admission:'NOT_ADMITTED'}).length;
  need(json(plan).length<=1024*1024&&json(input).length<=1024*1024&&
    json(plan).length+json(input).length+auditEstimate+256*1024<=RESERVE,'RESOURCE_PARTITION_TASK_RECEIPT_BUDGET');
  assert.equal(document(file).sha256,config.sha256);
  return {input:{...input,configurationFile:file},before:{configuration:plan.configuration,planSha256:plan.planSha256},plan,profile:'resource-pck-partition-v1',...(includeBuffers?{source,split}:{})};
}
export function prepareResourcePartitionTask(file){return prepare(file);}
function put(file,bytes){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const errorCode=e=>/^(RESOURCE_|PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(e?.code??'')?e.code:'RESOURCE_PARTITION_TASK_FAILED';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

export async function executeResourcePartitionTask(input,before,{writeAuthorized=false}={}){
  need(writeAuthorized===true,'TASK_WRITE_REQUIRED');
  const prepared=prepare(input.configurationFile,true);
  assert.deepEqual(prepared.input,input,'RESOURCE_PARTITION_TASK_CHANGED');assert.deepEqual(prepared.before,before,'RESOURCE_PARTITION_TASK_CHANGED');
  const {plan,source,split}=prepared,task=createTask(input.output,{budgetBytes:input.budgetBytes,recipeId:'resource-pck-partition:'+plan.planSha256});
  const start=performance.now();let stage='SNAPSHOT',auditPin=null,terminalStatus='SUCCESS',failure=null;const phases=[];
  try{
    put(path.join(task.root,'REQUEST.private.json'),json(plan.input));put(path.join(task.root,'PLAN.private.json'),json(plan));
    fs.mkdirSync(path.join(task.root,'packs'));task.event({stage,status:'SUCCEEDED'});
    await turn();task.checkpoint('WRITE_PACKS');stage='WRITE_PACKS';let phase=performance.now();
    for(const output of split.outputs){
      task.checkpoint(stage);put(path.join(task.root,'packs',output.id+'.pck'),output.buffer);
      task.event({stage,status:'RUNNING',details:{packId:output.id,bytes:output.bytes,sha256:output.sha256}});await turn();
    }
    phases.push({name:stage,wallMs:performance.now()-phase,status:'SUCCESS'});
    task.checkpoint('VERIFY');stage='VERIFY';phase=performance.now();
    assert.deepEqual(sourcePins(),plan.sources,'RESOURCE_PARTITION_TASK_SOURCE_CHANGED');
    assert.deepEqual(pin(read(input.sourcePath,PCK_PARTITION_LIMIT_BYTES,input.partition.source)),input.partition.source);
    assert.deepEqual(pin(read(input.configurationFile,1024*1024)),plan.configuration);
    const actual=split.outputs.map(p=>({...p,buffer:read(path.join(task.root,'packs',p.id+'.pck'),PCK_PARTITION_LIMIT_BYTES,{bytes:p.bytes,sha256:p.sha256})}));
    assert.deepEqual(fs.readdirSync(path.join(task.root,'packs')).sort(),plan.outputs.map(p=>path.basename(p.path)).sort());
    const audit={...auditPckPartition(source,input.partition,actual),status:'PASS_WRITTEN_PCK_BYTES_ONLY',taskId:task.taskId,planSha256:plan.planSha256,
      writtenFiles:plan.outputs,dependencyCoverage:'NOT_INFERRED',engineRun:'NOT_RUN',phone:'NOT_RUN',admission:'NOT_ADMITTED'};
    const bytes=json(audit);put(path.join(task.root,'AUDIT.json'),bytes);auditPin=pin(bytes);
    phases.push({name:stage,wallMs:performance.now()-phase,status:'SUCCESS'});task.event({stage,status:'SUCCEEDED'});
    await turn();task.checkpoint('COMPLETE');stage='COMPLETE';
  }catch(error){
    const code=errorCode(error);put(path.join(task.root,'FAILURE.private.json'),json({stage,code,error:String(error).slice(0,4096),stack:String(error.stack??'').slice(0,16384)}));
    terminalStatus=error.code==='TASK_CANCELLED'?'CANCELLED':'FAILED';failure={stage,code};
  }
  // Terminal commit is outside the work catch: an inspection error afterwards
  // must never append failure files or try to rewrite a committed SUCCESS.
  const terminal=task.finish(terminalStatus,{kind:'RESOURCE_PCK_PARTITION',planSha256:plan.planSha256,...failure,audit:auditPin,phases,admission:'NOT_ADMITTED',engineRun:'NOT_RUN'});
  return {status:terminal.status,terminal,taskId:task.taskId,elapsedMs:performance.now()-start,logicalBytes:measureTaskBytes(task.root),audit:auditPin,phases};
}

// Returns the same shape consumed by the shared status/cancel implementation.
// No engine/PCK action: inspect owner/receipts and bind the current config/source.
export function controlResourcePartitionTask({source,request,config,root,taskId}){
  const input=normalized(config.value,path.dirname(config.file));outputParent(input,false);
  need(norm(input.output)===norm(root),'TASK_ID_MISMATCH');
  need(norm(fs.realpathSync(root))===norm(root),'TASK_PATH_INVALID');
  const state=inspectTask(root,taskId),saved=document(path.join(root,'REQUEST.private.json')),plan=document(path.join(root,'PLAN.private.json'));
  assert.deepEqual(saved.value,input);assert.deepEqual(plan.value.input,input);
  assert.deepEqual(plan.value.configuration,{bytes:fs.statSync(config.file).size,sha256:config.sha256});
  assert.equal(planHash(plan.value),plan.value.planSha256);const recipeId='resource-pck-partition:'+plan.value.planSha256;
  assert.equal(state.owner.recipeId,recipeId);assert.equal(state.owner.budgetBytes,input.budgetBytes);
  const documents=[saved,plan],terminal=state.terminal;
  if(terminal){
    assert.equal(terminal.details?.kind,'RESOURCE_PCK_PARTITION');assert.equal(terminal.details.planSha256,plan.value.planSha256);
    assert.equal(terminal.details.admission,'NOT_ADMITTED');assert.equal(terminal.details.engineRun,'NOT_RUN');
    if(terminal.status==='SUCCESS'){
      const audit=document(path.join(root,'AUDIT.json'),RESERVE);documents.push(audit);
      assert.deepEqual({bytes:audit.bytes,sha256:audit.sha256},terminal.details.audit);assert.equal(audit.value.taskId,taskId);assert.equal(audit.value.planSha256,plan.value.planSha256);
      assert.equal(audit.value.status,'PASS_WRITTEN_PCK_BYTES_ONLY');assert.deepEqual(audit.value.source,input.partition.source);assert.deepEqual(audit.value.writtenFiles,plan.value.outputs);
    }
  }
  const stable=()=>{for(const d of [source,config,...documents])assert.equal(document(d.file,RESERVE).sha256,d.sha256);read(input.sourcePath,PCK_PARTITION_LIMIT_BYTES,input.partition.source);};stable();
  const warnings=[];
  if(state.logicalBytes>input.budgetBytes)warnings.push({code:'TASK_BUDGET_EXCEEDED',message:'超出原任务预算；不扩大预算。'});
  try{const s=fs.lstatSync(path.join(root,'.control-lock'));need(s.isDirectory()&&!s.isSymbolicLink(),'TASK_PATH_INVALID');warnings.push({code:'TASK_CONTROL_LOCK_PRESENT',message:'控制锁存在；不据此认定进程存活，不接管或移除锁。'});}catch(e){if(e.code!=='ENOENT')throw e;}
  return {root,taskId,recipeId,stable,output:{schema:'wxslim-task-status-v1',action:request.action,taskId,recipeId,profile:'resource-pck-partition-v1',packageId:null,
    requestSha256:source.sha256,configurationSha256:config.sha256,status:terminal?.status??(state.cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),
    terminalPresent:!!terminal,cancellationRequested:!!state.cancellation,inputBinding:'MATCHED_EXECUTION_SNAPSHOT',logicalBytes:state.logicalBytes,budgetBytes:input.budgetBytes,
    warnings,progress:readTaskEventProgress(root,taskId),taskFailureCode:/^(RESOURCE_|PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(terminal?.details?.code??'')?terminal.details.code:null,
    processLiveness:'NOT_OBSERVED',admission:'NOT_ADMITTED',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
    scope:'Receipt/config/source binding only; not a current output re-audit, dependency proof or runtime acceptance.'}};
}
