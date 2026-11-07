// Shared explicit source-install task. No export, engine build or template copy.
// Only missing scripts and one autoload insertion are writable. No rollback/retry.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareResourceProjectSource,inspectResourceProjectSource} from './resource-project-source-plan.mjs';
import {createTask,inspectTask,measureTaskBytes} from '../convert/lib/official-task.mjs';
import {readTaskEventProgress} from './task-events.mjs';

const M=1024*1024,sha=b=>createHash('sha256').update(b).digest('hex'),pin=b=>({bytes:b.length,sha256:sha(b)}),json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const inside=(a,b)=>norm(a)===norm(b)||norm(b).startsWith(norm(a)+path.sep);
const equalStat=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const names=['godot-resource-game-facade.gd','godot-resource-command-receiver.gd','godot-resource-pack-session.gd','godot-resource-scene-loader.gd'];
const sources=['./resource-project-install-task.mjs','./resource-project-source-plan.mjs','./resource-game-facade-sources.mjs',...names.map(n=>'./'+n),'./task-core.mjs','./task-events.mjs','../convert/lib/official-task.mjs'];
function read(file,limit=M){
 const before=fs.lstatSync(file,{bigint:true});need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(limit)&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_INSTALL_FILE');
 const fd=fs.openSync(file,'r'),b=Buffer.alloc(Number(before.size));
 try{need(equalStat(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_INSTALL_INPUT_CHANGED');let at=0;while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,null);need(n>0,'RESOURCE_INSTALL_INPUT_CHANGED');at+=n;}
 need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&equalStat(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_INSTALL_INPUT_CHANGED');}finally{fs.closeSync(fd);}
 need(equalStat(before,fs.lstatSync(file,{bigint:true}))&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_INSTALL_INPUT_CHANGED');return b;
}
function put(file,b){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function absent(file){try{fs.lstatSync(file);return false;}catch(e){if(e.code!=='ENOENT')throw e;return true;}}
function directory(file){const s=fs.lstatSync(file);need(s.isDirectory()&&!s.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_INSTALL_DIRECTORY');}
function document(file){const b=read(file);return {file,value:JSON.parse(b),...pin(b)};}
function normalized(raw,base){
 need(raw&&Object.getPrototypeOf(raw)===Object.prototype&&Object.keys(raw).sort().join(',')==='allowProjectWrites,budgetBytes,output,projectFile,schema'&&raw.schema==='wxslim-resource-project-install-v1'&&raw.allowProjectWrites===true,'RESOURCE_INSTALL_CONFIG');
 for(const k of ['projectFile','output'])need(typeof raw[k]==='string'&&raw[k]&&raw[k]===raw[k].trim()&&!/[\u0000-\u001f]/.test(raw[k]),'RESOURCE_INSTALL_PATH');
 need(Number.isSafeInteger(raw.budgetBytes)&&raw.budgetBytes>=4*M&&raw.budgetBytes<=8*M,'RESOURCE_INSTALL_BUDGET');
 return {...raw,projectFile:path.resolve(base,raw.projectFile),output:path.resolve(base,raw.output)};
}
function sourcePins(){return sources.map(file=>({file,...pin(read(fileURLToPath(new URL(file,import.meta.url))))}));}
const hashPlan=p=>{const {planSha256,...rest}=p;return sha(JSON.stringify(rest));};
function prepare(file){
 file=path.resolve(file);const config=document(file),input=normalized(config.value,path.dirname(file)),project=path.dirname(input.projectFile);
 directory(project);directory(path.dirname(input.output));need(absent(input.output),'RESOURCE_INSTALL_OUTPUT_EXISTS');
 need(!inside(project,input.output)&&!inside(input.output,project)&&!inside(input.output,file),'RESOURCE_INSTALL_OUTPUT_OVERLAP');
 const lock=path.join(project,'.wxslim-resource-install.lock');need(absent(lock),'RESOURCE_INSTALL_PROJECT_LOCKED');
 const candidate=prepareResourceProjectSource(input.projectFile);need(candidate.plan.status!=='BLOCKED','RESOURCE_INSTALL_SOURCE_CONFLICT');
 const implementations=sourcePins();for(const p of sources)need(!inside(input.output,fileURLToPath(new URL(p,import.meta.url))),'RESOURCE_INSTALL_OUTPUT_OVERLAP');
 const plan={schema:'wxslim-resource-project-install-plan-v1',input,configuration:{bytes:config.bytes,sha256:config.sha256},sourcePlan:candidate.plan,implementations,
   backup:{path:'project.godot.before',...pin(candidate.projectBytes)},projectLock:lock,
   taskOutputReserveBytes:3*M,projectTransientLimitBytes:M,projectNewScriptBytes:candidate.plan.copyBytes,
   writePolicy:'CREATE_MISSING_SCRIPTS_EXCLUSIVELY; LAST_RECHECK_THEN_RENAME_PROJECT; KEEP_PARTIAL_FILES_ON_FAILURE',
   concurrency:'COOPERATIVE_LOCK_ONLY; SAVE_PROJECT_FIRST; DO_NOT_EDIT_DURING_INSTALL; NO_CAS_GUARANTEE_AGAINST_NONCOOPERATING_WRITERS',
   cancellation:'CHECK_BETWEEN_WRITES; COMPLETED_WRITES_REMAIN; NO_ROLLBACK',
   taskExecuted:false,export:'NOT_RUN',engineRun:'NOT_RUN',phone:'NOT_RUN',admission:'NOT_ADMITTED'};
 need(candidate.projectBytes.length+3*M<=input.budgetBytes,'RESOURCE_INSTALL_BUDGET');
 plan.planSha256=hashPlan(plan);assert.deepEqual(pin(read(file)),plan.configuration);
 return {input:{...input,configurationFile:file},before:{configuration:plan.configuration,planSha256:plan.planSha256},plan,profile:'resource-project-install-v1',candidate};
}
export function prepareResourceProjectInstall(file){const {candidate,...result}=prepare(file);return result;}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const safe=e=>/^(RESOURCE_|TASK_)[A-Z0-9_]{1,100}$/.test(e?.code??'')?e.code:'RESOURCE_INSTALL_FAILED';

// Dependency injection is module-only for memory tests, never a config/argv option.
export function createResourceProjectInstaller({prepareCurrent=prepare,taskFactory=createTask,readBytes=read,writeNew=put,isAbsent=absent,
 rename=(a,b)=>fs.renameSync(a,b),unlink=p=>fs.unlinkSync(p),currentSourcePins=sourcePins,inspectSource=inspectResourceProjectSource,
 measure=measureTaskBytes,checkSpace=(input)=>{for(const dir of [path.dirname(input.projectFile),path.dirname(input.output)]){const s=fs.statfsSync(dir,{bigint:true});need(s.bavail*s.bsize>=BigInt(input.budgetBytes+16*M),'RESOURCE_INSTALL_DISK_RESERVE');}},yieldTurn=turn}={}){
 return async function execute(input,before,{writeAuthorized=false}={}){
  need(writeAuthorized===true,'TASK_WRITE_REQUIRED');const fresh=prepareCurrent(input.configurationFile);assert.deepEqual(fresh.input,input);assert.deepEqual(fresh.before,before);
  const {plan,candidate}=fresh;checkSpace(input);
  const task=taskFactory(input.output,{budgetBytes:input.budgetBytes,recipeId:'resource-project-install:'+plan.planSha256}),started=performance.now();
  need(/^[a-f0-9-]{36}$/.test(task.taskId),'RESOURCE_INSTALL_TASK_ID');
  const record={schema:'wxslim-resource-project-install-record-v1',taskId:task.taskId,planSha256:plan.planSha256,writes:[],projectMayHaveChanged:false,projectReplaced:false,lockAttempted:false,lockRemoved:false,rollbackPerformed:false,automaticRetry:false};
  const project=path.dirname(input.projectFile),temp=path.join(project,'.wxslim-resource-'+task.taskId+'.tmp'),lockBytes=json({schema:'wxslim-resource-project-lock-v1',taskId:task.taskId,planSha256:plan.planSha256});
  let stage='SNAPSHOT',status='SUCCESS',failure=null,audit=null,lockCreated=false;
  function invariants(){assert.deepEqual(pin(readBytes(input.configurationFile)),plan.configuration);assert.deepEqual(currentSourcePins(),plan.implementations);}
  function filesMatch(afterScripts=false,afterProject=false){
   for(const change of plan.sourcePlan.changes){
    const file=path.join(project,change.path),expected=change.path==='project.godot'?(afterProject?change.after:change.before):(afterScripts?change.after:change.before);
    if(expected===null)need(isAbsent(file),'RESOURCE_INSTALL_PROJECT_CHANGED');else assert.deepEqual(pin(readBytes(file)),expected,'RESOURCE_INSTALL_PROJECT_CHANGED');
   }
  }
  async function checkpoint(next){stage=next;await yieldTurn();task.checkpoint(next);invariants();}
  try{
   writeNew(path.join(task.root,'REQUEST.private.json'),json(plan.input));writeNew(path.join(task.root,'PLAN.private.json'),json(plan));
   invariants();filesMatch();writeNew(path.join(task.root,'project.godot.before'),candidate.projectBytes);assert.deepEqual(pin(readBytes(path.join(task.root,'project.godot.before'))),{bytes:plan.backup.bytes,sha256:plan.backup.sha256});
   task.event({stage,status:'SUCCEEDED'});
   if(candidate.contents.size){
    await checkpoint('LOCK_PROJECT');record.lockAttempted=true;writeNew(plan.projectLock,lockBytes);lockCreated=true;filesMatch();
    for(const change of plan.sourcePlan.changes.filter(c=>c.action==='CREATE')){
     await checkpoint('CREATE_SCRIPT');const file=path.join(project,change.path);need(isAbsent(file),'RESOURCE_INSTALL_PROJECT_CHANGED');
     const entry={path:change.path,action:'CREATE',status:'WRITE_ATTEMPTED'};record.writes.push(entry);record.projectMayHaveChanged=true;writeNew(file,candidate.contents.get(change.path));assert.deepEqual(pin(readBytes(file)),change.after);entry.status='WRITTEN_VERIFIED';
     task.event({stage,status:'SUCCEEDED',details:{path:change.path}});
    }
    filesMatch(true,false);
    if(candidate.contents.has('project.godot')){
     await checkpoint('REPLACE_PROJECT');filesMatch(true,false);record.projectTemporaryFile=temp;writeNew(temp,candidate.contents.get('project.godot'));
     const change=plan.sourcePlan.changes.find(c=>c.path==='project.godot');assert.deepEqual(pin(readBytes(temp)),change.after);filesMatch(true,false);
     record.projectMayHaveChanged=true;rename(temp,input.projectFile);record.projectReplaced=true;
     assert.deepEqual(pin(readBytes(input.projectFile)),change.after);task.event({stage,status:'SUCCEEDED'});
    }
   }
   await checkpoint('VERIFY');filesMatch(true,true);const checked=inspectSource(input.projectFile);need(checked.status==='ALREADY_MATCHED_NOT_RUNTIME_PROOF'&&checked.plannedWrites.length===0,'RESOURCE_INSTALL_FINAL_SOURCE_CHECK');
   audit={schema:'wxslim-resource-project-install-audit-v1',status:'PASS_INSTALLED_SOURCE_BYTES_ONLY',taskId:task.taskId,planSha256:plan.planSha256,
     sourceSha256:checked.sourceSha256,after:plan.sourcePlan.changes.map(c=>({path:c.path,...c.after})),projectReplaced:record.projectReplaced,createdScripts:record.writes.filter(w=>w.status==='WRITTEN_VERIFIED').map(w=>w.path),
     dependencyClosure:'NOT_SCANNED',export:'NOT_RUN',engineRun:'NOT_RUN',phone:'NOT_RUN',admission:'NOT_ADMITTED'};
  }catch(error){status=error.code==='TASK_CANCELLED'?'CANCELLED':'FAILED';failure={stage,code:safe(error),error:String(error).slice(0,4096)};}
  if(lockCreated){
   try{need(readBytes(plan.projectLock).equals(lockBytes),'RESOURCE_INSTALL_LOCK_CHANGED');unlink(plan.projectLock);record.lockRemoved=true;}
   catch(error){record.lockReleaseError={code:safe(error),error:String(error).slice(0,4096)};if(status==='SUCCESS'){status='FAILED';failure={stage:'RELEASE_LOCK',...record.lockReleaseError};}}
  }
  // The task controller may still accept cancellation at terminal commit.
  // This is a pre-terminal record; terminal.json remains authoritative.
  record.statusBeforeTerminal=status;record.failure=failure;record.wallMs=performance.now()-started;
  writeNew(path.join(task.root,'INSTALL.private.json'),json(record));if(failure)writeNew(path.join(task.root,'FAILURE.private.json'),json(failure));
  let auditPin=null;if(status==='SUCCESS'&&audit){const b=json(audit);writeNew(path.join(task.root,'AUDIT.json'),b);auditPin=pin(b);}
  const terminal=task.finish(status,{kind:'RESOURCE_PROJECT_INSTALL',planSha256:plan.planSha256,audit:auditPin,record:pin(json(record)),projectMayHaveChanged:record.projectMayHaveChanged,createdScriptAttempts:record.writes.length,admission:'NOT_ADMITTED',engineRun:'NOT_RUN'});
  return {status:terminal.status,terminal,taskId:task.taskId,elapsedMs:record.wallMs,logicalBytes:measure(task.root),audit:auditPin,projectMayHaveChanged:record.projectMayHaveChanged,createdScriptAttempts:record.writes.length};
 };
}
export const executeResourceProjectInstall=createResourceProjectInstaller();

export function createResourceProjectInstallController({inspect=inspectTask,readDocument=document,readBytes=read,checkDirectory=directory,readProgress=readTaskEventProgress}={}){
 return function control({source,request,config,root,taskId}){
 const input=normalized(config.value,path.dirname(config.file));need(norm(input.output)===norm(root),'TASK_ID_MISMATCH');checkDirectory(root);
 const state=inspect(root,taskId),saved=readDocument(path.join(root,'REQUEST.private.json')),snapshot=readDocument(path.join(root,'PLAN.private.json')),plan=snapshot.value;
 need(plan.schema==='wxslim-resource-project-install-plan-v1','RESOURCE_INSTALL_PLAN_SCHEMA');assert.deepEqual(saved.value,input);assert.deepEqual(plan.input,input);
 assert.deepEqual(plan.configuration,{bytes:readBytes(config.file).length,sha256:config.sha256});assert.equal(plan.planSha256,hashPlan(plan));
 const recipeId='resource-project-install:'+plan.planSha256;assert.equal(state.owner.recipeId,recipeId);assert.equal(state.owner.budgetBytes,input.budgetBytes);
 const documents=[saved,snapshot],terminal=state.terminal;
 if(terminal&&state.cancellation)assert.equal(terminal.status,'CANCELLED','contradictory terminal/cancel receipts');
 if(terminal){
  need(['SUCCESS','FAILED','CANCELLED'].includes(terminal.status)&&terminal.details?.kind==='RESOURCE_PROJECT_INSTALL'&&terminal.details.planSha256===plan.planSha256,'RESOURCE_INSTALL_TERMINAL_BINDING');
  need(terminal.details.admission==='NOT_ADMITTED'&&terminal.details.engineRun==='NOT_RUN','RESOURCE_INSTALL_TERMINAL_BINDING');
  const record=readDocument(path.join(root,'INSTALL.private.json'));documents.push(record);assert.deepEqual({bytes:record.bytes,sha256:record.sha256},terminal.details.record);assert.equal(record.value.taskId,taskId);
  const r=record.value;assert.equal(r.schema,'wxslim-resource-project-install-record-v1');assert.equal(r.planSha256,plan.planSha256);
  need(['SUCCESS','FAILED','CANCELLED'].includes(r.statusBeforeTerminal)&&(terminal.status==='CANCELLED'||terminal.status===r.statusBeforeTerminal),'RESOURCE_INSTALL_TERMINAL_BINDING');
  need(r.rollbackPerformed===false&&r.automaticRetry===false,'RESOURCE_INSTALL_TERMINAL_BINDING');
  assert.equal(r.projectMayHaveChanged,terminal.details.projectMayHaveChanged);assert.equal(r.writes.length,terminal.details.createdScriptAttempts);
  if(terminal.status==='SUCCESS'){
   const audit=readDocument(path.join(root,'AUDIT.json'));documents.push(audit);assert.deepEqual({bytes:audit.bytes,sha256:audit.sha256},terminal.details.audit);assert.equal(audit.value.taskId,taskId);assert.equal(audit.value.planSha256,plan.planSha256);assert.equal(audit.value.status,'PASS_INSTALLED_SOURCE_BYTES_ONLY');
   assert.deepEqual(pin(readBytes(path.join(root,'project.godot.before'))),{bytes:plan.backup.bytes,sha256:plan.backup.sha256});
   assert.deepEqual(audit.value.after,plan.sourcePlan.changes.map(c=>({path:c.path,...c.after})));
   assert.equal(audit.value.sourceSha256,plan.sourcePlan.sourceSha256);assert.equal(audit.value.projectReplaced,r.projectReplaced);
   for(const key of ['export','engineRun','phone'])assert.equal(audit.value[key],'NOT_RUN');assert.equal(audit.value.admission,'NOT_ADMITTED');
  }
 }
 const stable=()=>{for(const d of [source,config,...documents])assert.equal(readDocument(d.file).sha256,d.sha256);};stable();
 return {root,taskId,recipeId,stable,output:{schema:'wxslim-task-status-v1',action:request.action,taskId,recipeId,profile:'resource-project-install-v1',packageId:null,
  requestSha256:source.sha256,configurationSha256:config.sha256,status:terminal?.status??(state.cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),terminalPresent:!!terminal,cancellationRequested:!!state.cancellation,
  inputBinding:'MATCHED_EXECUTION_SNAPSHOT',logicalBytes:state.logicalBytes,budgetBytes:input.budgetBytes,progress:readProgress(root,taskId),processLiveness:'NOT_OBSERVED',warnings:[],
  projectMayHaveChanged:terminal?.details?.projectMayHaveChanged??null,createdScriptAttempts:terminal?.details?.createdScriptAttempts??null,currentProjectState:'NOT_REAUDITED',admission:'NOT_ADMITTED',engineRun:'NOT_RUN',phone:'NOT_RUN'}};
 };}
export const controlResourceProjectInstall=createResourceProjectInstallController();
