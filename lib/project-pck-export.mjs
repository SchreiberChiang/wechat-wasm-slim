// Normal fixed-editor export for a user-selected project. No project/SDK copy,
// arbitrary command, rendering patch, converter, upload or dependency inference.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createTask,inspectTask,measureTaskBytes,requestCancellation} from '../convert/lib/official-task.mjs';
import {runOwnedProcess} from '../convert/lib/owned-process.mjs';
import {inspectPck} from './pck-inventory.mjs';
import {readTaskEventProgress} from './task-events.mjs';

const M=1024*1024;
const need=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const hash=b=>createHash('sha256').update(b).digest('hex');
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const inside=(a,b)=>norm(a)===norm(b)||norm(b).startsWith(norm(a)+path.sep);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
function canonical(file,directory=false){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile())&&norm(fs.realpathSync(file))===norm(file),'PCK_EXPORT_PATH');return s;}
function pin(file,max=256*M){
  const before=canonical(file);need(before.size<=max,'PCK_EXPORT_INPUT_LIMIT');
  const fd=fs.openSync(file,'r'),h=createHash('sha256'),chunk=Buffer.alloc(M);let bytes=0;
  const same=s=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>s[k]===before[k]);
  try{need(same(fs.fstatSync(fd)),'PCK_EXPORT_INPUT_CHANGED');let n;while((n=fs.readSync(fd,chunk,0,Math.min(chunk.length,before.size-bytes+1),null))>0){bytes+=n;need(bytes<=before.size,'PCK_EXPORT_INPUT_CHANGED');h.update(chunk.subarray(0,n));}need(same(fs.fstatSync(fd)),'PCK_EXPORT_INPUT_CHANGED');}finally{fs.closeSync(fd);}
  need(bytes===before.size&&same(canonical(file)),'PCK_EXPORT_INPUT_CHANGED');return {bytes,sha256:h.digest('hex')};
}
function doc(file,max=M){const before=pin(file,max),b=fs.readFileSync(file);assert.deepEqual({bytes:b.length,sha256:hash(b)},before);return {file,value:JSON.parse(b),...before};}
function normalize(raw,base){
  need(exact(raw,['schema','editor','project','preset','output','budgetBytes','cacheGrowthBudgetBytes','allowImportWrites'])&&raw.schema==='wxslim-project-pck-export-v1','PCK_EXPORT_CONFIG');
  need(raw.allowImportWrites===true,'PCK_EXPORT_IMPORT_WRITE_ACK');
  for(const k of ['editor','project','output','preset'])need(typeof raw[k]==='string'&&raw[k]===raw[k].trim()&&raw[k]&&!/[\u0000\r\n]/.test(raw[k]),'PCK_EXPORT_CONFIG');
  need(Number.isSafeInteger(raw.budgetBytes)&&raw.budgetBytes>=8*M&&raw.budgetBytes<=272*M&&
    Number.isSafeInteger(raw.cacheGrowthBudgetBytes)&&raw.cacheGrowthBudgetBytes>=0&&raw.cacheGrowthBudgetBytes<=2**32,'PCK_EXPORT_BUDGET');
  return {...raw,...Object.fromEntries(['editor','project','output'].map(k=>[k,path.resolve(base,raw[k])]))};
}
// Only inspect relevant ordinary String/bool fields; let Godot parse everything
// else. Ambiguous/duplicate sections or fields are refused, never approximated.
function presetCheck(bytes,name){
  const text=bytes.toString('utf8').replace(/^\uFEFF/,''),sections=new Map();let section=null;
  for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith(';')||line.startsWith('#'))continue;
    if(line.startsWith('[')){need(/^\[[^\]\r\n]+\]$/.test(line),'PCK_EXPORT_PRESET_SYNTAX');need(!sections.has(line),'PCK_EXPORT_PRESET_DUPLICATE');section=new Map();sections.set(line,section);continue;}
    need(section,'PCK_EXPORT_PRESET_SYNTAX');const m=/^([A-Za-z0-9_/.]+)\s*=\s*(.*)$/.exec(line);
    // Multiline values in unrelated options are handled by Godot, not this gate.
    if(!m)continue;need(!section.has(m[1]),'PCK_EXPORT_PRESET_DUPLICATE');section.set(m[1],m[2]);
  }
  const string=(v)=>{need(typeof v==='string'&&/^"(?:[^"\\]|\\.)*"$/.test(v),'PCK_EXPORT_PRESET_STRING');const result=JSON.parse(v);need(typeof result==='string','PCK_EXPORT_PRESET_STRING');return result;};
  const presets=[...sections].filter(([k])=>/^\[preset\.\d+\]$/.test(k)).filter(([,s])=>string(s.get('name'))===name);
  need(presets.length===1,'PCK_EXPORT_PRESET_UNIQUE');const [key,p]=presets[0];
  need(string(p.get('platform'))==='Web'&&string(p.get('export_filter'))==='all_resources','PCK_EXPORT_PRESET_FULL_WEB');
  const includeFilter=string(p.get('include_filter')),excludeFilter=string(p.get('exclude_filter'));
  for(const field of ['encrypt_pck','encrypt_directory'])need(p.get(field)===undefined||p.get(field)==='false','PCK_EXPORT_ENCRYPTION_UNSUPPORTED');
  return {section:key,name,platform:'Web',exportFilter:'all_resources',includeFilter,excludeFilter,interpretation:'EXISTING_FILTERS_PRESERVED; NOT_PROOF_OF_GENERAL_DEPENDENCY_CLOSURE'};
}
function projectInventory(project){
  canonical(project,true);const files=[];let total=0;
  function visit(dir,depth){need(depth<=64,'PCK_EXPORT_PROJECT_LIMIT');for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(dir===project&&['.git','.godot'].includes(e.name))continue;
    const file=path.join(dir,e.name),s=fs.lstatSync(file);need(!s.isSymbolicLink(),'PCK_EXPORT_PROJECT_LINK');
    if(s.isDirectory())visit(file,depth+1);else{need(s.isFile()&&files.length<20000,'PCK_EXPORT_PROJECT_LIMIT');const id=pin(file);total+=id.bytes;need(total<=2**31,'PCK_EXPORT_PROJECT_LIMIT');files.push({path:path.relative(project,file).replaceAll('\\','/'),...id});}
  }}visit(project,0);return {files,bytes:total};
}
function cacheBytes(project){const cache=path.join(project,'.godot');try{canonical(cache,true);return measureTaskBytes(cache);}catch(e){if(e.code==='ENOENT')return 0;throw e;}}
function sourcePins(){return ['./project-pck-export.mjs','./pck-inventory.mjs','./task-core.mjs','../engine/alpha-preserve-lighting/delivery-recipe.json','../convert/lib/owned-process.mjs','../convert/lib/official-task.mjs'].map(file=>{const b=fs.readFileSync(new URL(file,import.meta.url));return {file,bytes:b.length,sha256:hash(b)}});}
function planHash(plan){const {planSha256,...rest}=plan;return hash(json(rest));}
function buildPlan(file,{editorIdentity}={}){
  file=path.resolve(file);const config=doc(file),input=normalize(config.value,path.dirname(file));
  canonical(input.project,true);canonical(path.dirname(input.output),true);need(!inside(input.project,input.output)&&!inside(input.output,input.project)&&!inside(input.output,input.editor)&&!inside(input.output,file),'PCK_EXPORT_OUTPUT_OVERLAP');
  try{fs.lstatSync(input.output);need(false,'PCK_EXPORT_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const recipe=editorIdentity??JSON.parse(fs.readFileSync(new URL('../engine/alpha-preserve-lighting/delivery-recipe.json',import.meta.url))).editor;
  const editorPin=pin(input.editor);need(editorPin.sha256===recipe.sha256,'PCK_EXPORT_EDITOR_PIN');
  pin(path.join(input.project,'project.godot'),M);const presetPath=path.join(input.project,'export_presets.cfg'),presetPin=pin(presetPath,M);
  const presetBytes=fs.readFileSync(presetPath);assert.deepEqual({bytes:presetBytes.length,sha256:hash(presetBytes)},presetPin);
  const preset=presetCheck(presetBytes,input.preset),project=projectInventory(input.project),cache=cacheBytes(input.project);
  const plan={schema:'wxslim-project-pck-export-plan-v1',input,configuration:{bytes:config.bytes,sha256:config.sha256},editor:{version:recipe.version,...editorPin},
    preset,project,cacheBeforeBytes:cache,implementation:sourcePins(),commands:[{stage:'EXPORT',args:['--headless','--path',input.project,'--export-pack',input.preset,path.join(input.output,'full.pck')]}],
    sourceEffects:'NORMAL_IMPORT_CACHE_AND_NEW_IMPORT_UID_SIDECARS; EXISTING_SOURCE_CHANGES_REJECTED_NOT_ROLLED_BACK',
    concurrency:'DO_NOT_EDIT_OR_EXPORT_SAME_PROJECT_DURING_TASK; NO_CROSS_EDITOR_LOCK_CLAIM',
    dependencies:'NOT_SCANNED; NORMAL_GODOT_EXPORT_PLUGINS_MAY_RUN',
    budgetPolicy:'PREFLIGHT_FREE_SPACE_AND_POST_CHILD_CHECKS; NOT_A_LIVE_DISK_QUOTA; NEVER_FORCE_KILL',
    engineBuild:false,converterRun:false,phone:'NOT_RUN',visual:'NOT_VERIFIED',admission:'NOT_ADMITTED'};
  need(json(plan).length<4*M,'PCK_EXPORT_RECEIPT_LIMIT');assert.equal(doc(file).sha256,config.sha256);
  plan.planSha256=planHash(plan);return {input:{...input,configurationFile:file},before:{configuration:plan.configuration,planSha256:plan.planSha256},plan,profile:'project-pck-export-v1'};
}
export function prepareProjectPckExport(file){return buildPlan(file);}
function put(file,value){const bytes=Buffer.isBuffer(value)?value:json(value),fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function compareProject(before,after){
  const old=new Map(before.files.map(f=>[f.path,f])),current=new Map(after.files.map(f=>[f.path,f]));for(const f of before.files)assert.deepEqual(current.get(f.path),f,'PCK_EXPORT_PROJECT_CHANGED');
  const added=after.files.filter(f=>!old.has(f.path));
  for(const f of added){const base=f.path.replace(/\.(?:import|uid)$/,'');need(base!==f.path&&old.has(base),'PCK_EXPORT_UNEXPECTED_PROJECT_WRITE');}
  return added;
}
const safeCode=e=>/^(PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(e?.code??'')?e.code:'PCK_EXPORT_FAILED';
function availableDisk(directory){const s=fs.statfsSync(directory,{bigint:true});return s.bavail*s.bsize;}
function checkDisk(input,available=availableDisk){
  const parent=path.dirname(input.output),sameVolume=fs.statSync(parent).dev===fs.statSync(input.project).dev;
  const reserve=64*M;
  need(BigInt(available(parent))>=BigInt(input.budgetBytes+reserve+(sameVolume?input.cacheGrowthBudgetBytes:0)),'PCK_EXPORT_DISK_RESERVE');
  if(!sameVolume)need(BigInt(available(input.project))>=BigInt(input.cacheGrowthBudgetBytes+reserve),'PCK_EXPORT_DISK_RESERVE');
}

// Test-only dependency injection is a module factory, never JSON/user options.
export function createProjectPckExporter({runChild=runOwnedProcess,prepare=buildPlan,freeMemory=os.freemem,totalMemory=os.totalmem,availableSpace=availableDisk}={}){
  return async function execute(input,before,{writeAuthorized=false}={}){
    need(writeAuthorized===true,'TASK_WRITE_REQUIRED');const current=prepare(input.configurationFile);assert.deepEqual(current.input,input);assert.deepEqual(current.before,before);
    need(freeMemory()>=Math.max(2**31,totalMemory()*0.2),'PCK_EXPORT_MEMORY_RESERVE');checkDisk(input,availableSpace);const {plan}=current;
    const task=createTask(input.output,{budgetBytes:input.budgetBytes,recipeId:'project-pck-export:'+plan.planSha256});
    let status='SUCCESS',stage='PREPARE',failure=null,result=null,auditPin=null,cancelled=false,cancelReceiptError=null;const start=performance.now(),phases=[];
    const cancel=()=>{cancelled=true;try{requestCancellation(task.root,task.taskId);}catch(error){cancelReceiptError=String(error);}};
    process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
    try{
      fs.mkdirSync(path.join(task.root,'logs'));put(path.join(task.root,'REQUEST.private.json'),plan.input);put(path.join(task.root,'PLAN.private.json'),plan);
      stage='EXPORT';task.checkpoint(stage);task.event({stage,status:'RUNNING'});const phaseStart=performance.now();
      result=await runChild({executable:input.editor,args:plan.commands[0].args,cwd:input.project,
        stdoutPath:path.join(task.root,'logs/EXPORT.stdout.log'),stderrPath:path.join(task.root,'logs/EXPORT.stderr.log'),observeAfterMs:120000,
        isCancellationRequested:()=>cancelled||task.readCancellationRequested(),onEvent:event=>task.event({stage:'EXPORT',status:'RUNNING',details:event})});
      put(path.join(task.root,'logs/EXPORT.process.json'),result);phases.push({name:stage,wallMs:performance.now()-phaseStart,exitCode:result.exitCode,closed:result.closed,outcome:result.outcome});
      need(result.closed===true,'PCK_EXPORT_CHILD_NOT_CLOSED');need(!cancelReceiptError,'PCK_EXPORT_CANCEL_RECEIPT_FAILED');need(!cancelled&&result.outcome!=='CANCELLED','TASK_CANCELLED');
      task.checkpoint('VERIFY');stage='VERIFY';need(result.outcome==='SUCCESS'&&result.exitCode===0&&result.signal===null,'PCK_EXPORT_CHILD_FAILED');
      const stdout=path.join(task.root,'logs/EXPORT.stdout.log'),stderr=path.join(task.root,'logs/EXPORT.stderr.log');const logPins={stdout:pin(stdout,8*M),stderr:pin(stderr,8*M)};
      const logs=fs.readFileSync(stdout,'utf8')+'\n'+fs.readFileSync(stderr,'utf8');need(!/SCRIPT ERROR:|Parse Error:|ERROR:/.test(logs),'PCK_EXPORT_ERROR_LOG');
      assert.deepEqual(pin(input.editor),{bytes:plan.editor.bytes,sha256:plan.editor.sha256});assert.deepEqual(sourcePins(),plan.implementation);assert.deepEqual(pin(input.configurationFile,M),plan.configuration);
      const after=projectInventory(input.project),generated=compareProject(plan.project,after),cacheAfter=cacheBytes(input.project);
      need(cacheAfter-plan.cacheBeforeBytes<=input.cacheGrowthBudgetBytes,'PCK_EXPORT_CACHE_BUDGET');
      const pckPath=path.join(task.root,'full.pck'),pckPin=pin(pckPath,256*M),pck=fs.readFileSync(pckPath);assert.deepEqual({bytes:pck.length,sha256:hash(pck)},pckPin);
      const inventory=inspectPck(pck);need(inventory.engineVersion.major===4&&inventory.engineVersion.minor===7&&inventory.engineVersion.patch===2&&inventory.entries.some(e=>e.path==='project.binary'),'PCK_EXPORT_PACK_FORMAT');
      const audit={schema:'wxslim-project-pck-export-audit-v1',status:'PASS_EDITOR_EXIT_AND_EXPORTED_PCK_STRUCTURE_ONLY',taskId:task.taskId,planSha256:plan.planSha256,
        editor:plan.editor,preset:plan.preset,pck:pckPin,inventory,logs:logPins,generatedSidecars:generated,cacheBeforeBytes:plan.cacheBeforeBytes,cacheAfterBytes:cacheAfter,
        sourceFilesUnchanged:true,dependencies:'NOT_SCANNED',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',admission:'NOT_ADMITTED'};
      const bytes=json(audit);need(bytes.length<4*M&&measureTaskBytes(task.root)+bytes.length+M<=input.budgetBytes,'PCK_EXPORT_RECEIPT_LIMIT');put(path.join(task.root,'AUDIT.json'),bytes);auditPin={bytes:bytes.length,sha256:hash(bytes)};
      task.event({stage,status:'SUCCEEDED'});task.checkpoint('COMPLETE');
    }catch(error){failure={stage,code:safeCode(error)};status=error.code==='TASK_CANCELLED'?'CANCELLED':'FAILED';put(path.join(task.root,'FAILURE.private.json'),{...failure,error:String(error).slice(0,4096),stack:String(error.stack??'').slice(0,16384),cancelReceiptError,childClosed:result?.closed??null,rollbackPerformed:false});
    }finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
    const terminal=task.finish(status,{kind:'PROJECT_PCK_EXPORT',planSha256:plan.planSha256,...failure,audit:auditPin,phases,admission:'NOT_ADMITTED',engineRun:'NOT_RUN'});
    return {status:terminal.status,terminal,taskId:task.taskId,elapsedMs:performance.now()-start,logicalBytes:measureTaskBytes(task.root),audit:auditPin,phases};
  };
}
export const executeProjectPckExport=createProjectPckExporter();

// Status/cancel bind durable snapshots, not the live import tree. A changed user
// file must not prevent cancellation of an already-owned export. Acceptance is
// still decided by the executor's before/after source and cache checks.
export function controlProjectPckExport({source,request,config,root,taskId}){
  const input=normalize(config.value,path.dirname(config.file));need(norm(root)===norm(input.output),'TASK_ID_MISMATCH');canonical(root,true);
  const state=inspectTask(root,taskId),saved=doc(path.join(root,'REQUEST.private.json')),snapshot=doc(path.join(root,'PLAN.private.json'),4*M),plan=snapshot.value;
  assert.deepEqual(saved.value,input);assert.deepEqual(plan.input,input);assert.equal(plan.schema,'wxslim-project-pck-export-plan-v1');
  assert.deepEqual(plan.configuration,{bytes:fs.statSync(config.file).size,sha256:config.sha256});assert.equal(plan.planSha256,planHash(plan));
  const recipeId='project-pck-export:'+plan.planSha256;assert.equal(state.owner.recipeId,recipeId);assert.equal(state.owner.budgetBytes,input.budgetBytes);
  const records=[saved,snapshot],terminal=state.terminal;
  if(terminal){
    assert.equal(terminal.details?.kind,'PROJECT_PCK_EXPORT');assert.equal(terminal.details.planSha256,plan.planSha256);
    assert.equal(terminal.details.admission,'NOT_ADMITTED');assert.equal(terminal.details.engineRun,'NOT_RUN');
    if(terminal.status==='SUCCESS'){
      const audit=doc(path.join(root,'AUDIT.json'),4*M);records.push(audit);
      assert.deepEqual({bytes:audit.bytes,sha256:audit.sha256},terminal.details.audit);assert.equal(audit.value.taskId,taskId);assert.equal(audit.value.planSha256,plan.planSha256);
      assert.equal(audit.value.status,'PASS_EDITOR_EXIT_AND_EXPORTED_PCK_STRUCTURE_ONLY');assert.equal(audit.value.sourceFilesUnchanged,true);
      assert.deepEqual(audit.value.editor,plan.editor);assert.deepEqual(audit.value.preset,plan.preset);
    }
  }
  const stable=()=>{for(const r of [source,config,...records])assert.equal(doc(r.file,4*M).sha256,r.sha256);};stable();
  const warnings=[];if(state.logicalBytes>input.budgetBytes)warnings.push({code:'TASK_BUDGET_EXCEEDED',message:'超出原任务预算，不自动扩容。'});
  try{canonical(path.join(root,'.control-lock'),true);warnings.push({code:'TASK_CONTROL_LOCK_PRESENT',message:'控制锁存在，不据此推断存活或自动接管。'});}catch(e){if(e.code!=='ENOENT')throw e;}
  return {root,taskId,recipeId,stable,output:{schema:'wxslim-task-status-v1',action:request.action,taskId,recipeId,profile:'project-pck-export-v1',packageId:null,
    requestSha256:source.sha256,configurationSha256:config.sha256,status:terminal?.status??(state.cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),terminalPresent:!!terminal,
    cancellationRequested:!!state.cancellation,inputBinding:'MATCHED_EXECUTION_SNAPSHOT',logicalBytes:state.logicalBytes,budgetBytes:input.budgetBytes,
    warnings,progress:readTaskEventProgress(root,taskId),taskFailureCode:/^(PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(terminal?.details?.code??'')?terminal.details.code:null,
    processLiveness:'NOT_OBSERVED',admission:'NOT_ADMITTED',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
    scope:'Bound execution receipts only; does not recheck current project, cache or output bytes. Cancellation waits for owned child closure; no rollback.'}};
}
export const projectPckExportTesting=Object.freeze({buildPlan,presetCheck,compareProject,checkDisk});
