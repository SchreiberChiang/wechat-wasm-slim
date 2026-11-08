// Controlled desktop fixture only, not the public general-project exporter.
// A plan is read-only. Execution requires an explicitly approved NEW small root.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createResourceExportFixture} from './resource-export-fixture.mjs';
import {inspectPck} from './pck-inventory.mjs';
import {partitionPck,auditPckPartition} from './pck-partition.mjs';
import {createTask,measureTaskBytes,requestCancellation,inspectTask} from '../convert/lib/official-task.mjs';
import {runOwnedProcess} from '../convert/lib/owned-process.mjs';

const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BUDGET=20*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const normal=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const contains=(parent,file)=>normal(parent)===normal(file)||normal(file).startsWith(normal(parent)+path.sep);
function regular(file){const stat=fs.lstatSync(file);need(stat.isFile()&&!stat.isSymbolicLink(),'RESOURCE_LAB_FILE');return stat;}
function pin(file){
  const before=regular(file),hash=createHash('sha256'),chunk=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');let bytes=0;
  try{let count;while((count=fs.readSync(fd,chunk,0,chunk.length,null))>0){hash.update(chunk.subarray(0,count));bytes+=count;need(bytes<=before.size,'RESOURCE_LAB_INPUT_CHANGED');}}
  finally{fs.closeSync(fd);}
  const after=regular(file);need(bytes===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ino===before.ino,'RESOURCE_LAB_INPUT_CHANGED');
  return {bytes,sha256:hash.digest('hex')};
}
function writeNew(file,value){const data=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n';const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function sourceInputs(){
  const fixture=createResourceExportFixture(),files=new Map(fixture.files);
  files.set('native_verify.gd',fs.readFileSync(path.join(REPO,'tests/godot-pck-native-verify.gd'),'utf8'));
  files.set('source-only-marker.txt','Source fallback sentinel; this file MUST NOT enter any PCK.\n');
  return {files,expectedProof:fixture.expectedProof};
}
function buildLabPlan(raw,allowExisting=false){
  need(exact(raw,['schema','editor','output','budgetBytes'])&&raw.schema==='wxslim-resource-export-lab-v1','RESOURCE_LAB_REQUEST');
  need(raw.budgetBytes===BUDGET,'RESOURCE_LAB_BUDGET');
  need(typeof raw.editor==='string'&&path.isAbsolute(raw.editor)&&typeof raw.output==='string'&&path.isAbsolute(raw.output),'RESOURCE_LAB_ABSOLUTE_PATH');
  const editor=path.resolve(raw.editor),output=path.resolve(raw.output),parent=path.dirname(output);
  need(!contains(REPO,output)&&!contains(output,REPO)&&!contains(output,editor),'RESOURCE_LAB_OUTPUT_OVERLAP');
  need(allowExisting||!fs.existsSync(output),'RESOURCE_LAB_OUTPUT_EXISTS');
  const st=fs.lstatSync(parent);need(st.isDirectory()&&!st.isSymbolicLink()&&normal(fs.realpathSync(parent))===normal(parent),'RESOURCE_LAB_PARENT');
  const recipe=JSON.parse(fs.readFileSync(path.join(REPO,'engine/alpha-preserve-lighting/delivery-recipe.json'),'utf8'));
  const editorPin=pin(editor);need(editorPin.sha256===recipe.editor.sha256,'RESOURCE_LAB_EDITOR_PIN');
  const input=sourceInputs(),sources=[...input.files].map(([file,text])=>({file,bytes:Buffer.byteLength(text),sha256:sha(text)}));
  need(sources.reduce((sum,file)=>sum+file.bytes,0)<256*1024,'RESOURCE_LAB_SOURCE_BUDGET');
  const project=path.join(output,'source'),packs=path.join(output,'packs');
  return {schema:'wxslim-resource-export-lab-plan-v1',editor,editorVersion:recipe.editor.version,editorPin,output,budgetBytes:BUDGET,sources,
    commands:[{stage:'IMPORT',args:['--headless','--path',project,'--import']},{stage:'EXPORT',args:['--headless','--path',project,'--export-pack','Web',path.join(packs,'full.pck')]}],
    nativeModes:['boot_only','missing_shared','normal'],executionAuthorized:false,sourceCopy:'Generated small fixture only; no engine, SDK or previous project copy',
    runtimeScope:'Desktop PCK reader and dependency fixture; not production staging helper, JSBridge, WASM or WeChat',visual:'NOT_VERIFIED'};
}
export function planResourceExportLab(raw){return buildLabPlan(raw);}

function importedContinuation(plan,taskId){
  const original=inspectTask(plan.output,taskId),terminal=original.terminal;
  need(original.owner.recipeId==='native-resource-export-fixed-editor-v1'&&terminal?.status==='FAILED'&&terminal.details?.stage==='IMPORT_CLOSED'&&terminal.details?.code==='RESOURCE_LAB_CHILD_FAILED'&&terminal.details.stages?.length===1&&terminal.details.stages[0].stage==='IMPORT','RESOURCE_LAB_RESUME_SOURCE');
  const receiptPath=path.join(plan.output,'logs','IMPORT.process.json'),receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  const expectedObserverError="isCancellationRequested: ENOENT: no such file or directory, lstat '"+path.join(plan.output,'source','.godot','global_script_class_cache.cfg')+"'";
  need(receipt.closed===true&&receipt.exitCode===0&&receipt.signal===null&&receipt.outcome==='FAILED'&&receipt.cancelRequested===false&&receipt.logErrors?.length===0&&receipt.error===expectedObserverError,'RESOURCE_LAB_RESUME_IMPORT_EVIDENCE');
  const stdout=fs.readFileSync(path.join(plan.output,'logs','IMPORT.stdout.log'),'utf8'),stderr=fs.readFileSync(path.join(plan.output,'logs','IMPORT.stderr.log'),'utf8');
  need(stderr===''&&!/SCRIPT ERROR:|Parse Error:|ERROR:/.test(stdout),'RESOURCE_LAB_RESUME_IMPORT_LOG');
  need(fs.readdirSync(path.join(plan.output,'packs')).length===0,'RESOURCE_LAB_RESUME_OUTPUT_EXISTS');
  const previousPlan=JSON.parse(fs.readFileSync(path.join(plan.output,'PLAN.private.json'),'utf8'));
  need(JSON.stringify(plan)===JSON.stringify(previousPlan),'RESOURCE_LAB_RESUME_PLAN_CHANGED');
  for(const expected of plan.sources){const actual=pin(path.join(plan.output,'source',expected.file));need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'RESOURCE_LAB_RESUME_SOURCE_CHANGED');}
  const sourceSnapshot=[];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),st=fs.lstatSync(file);need(!st.isSymbolicLink(),'RESOURCE_LAB_RESUME_LINK');if(st.isDirectory())walk(file);else{regular(file);sourceSnapshot.push({file:path.relative(plan.output,file).replaceAll('\\','/'),...pin(file)});}}}
  walk(path.join(plan.output,'source'));
  const evidence=['TASK.json','terminal.json','PLAN.private.json','logs/IMPORT.process.json','logs/IMPORT.stdout.log','logs/IMPORT.stderr.log','events.jsonl'].map(file=>({file,...pin(path.join(plan.output,file))}));
  return {schema:'wxslim-resource-lab-continuation-v1',originalTaskId:taskId,originalStatus:'FAILED',importEvidence:'IMPORT_EXIT0_OBSERVER_FAILED',reason:receipt.error,originalPid:receipt.pid,evidence,sourceSnapshot,independentImportCommandsAlreadyRun:1,independentImportCommandsToRun:0,
    note:'Continues only unexecuted EXPORT/PARTITION/native checks. Exporter may perform its normal scan/import internally; logs remain authoritative.',root:path.join(plan.output,'continuation-after-import-01')};
}

// Exact bounded fixture classification, not a general import dependency scanner.
// Imported payload names come from the final PCK; native verification then checks
// the actual .import remap/UID and loaded texture path against this ownership.
export function classifyFixtureInventory(inventory,sourceBuffer,options={}){
  need(inventory?.status==='PASS_PCK_STRUCTURE_ONLY','RESOURCE_LAB_INVENTORY');
  // Two exact fixture recipes, never an arbitrary path/owner override. Omitting
  // the option preserves the original native verifier fixture byte contract.
  need(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(key=>key==='scriptProfile'),'RESOURCE_LAB_SCRIPT_PROFILE');
  const profile=options.scriptProfile===undefined?'native':options.scriptProfile;
  need(profile==='native'||profile==='runtime','RESOURCE_LAB_SCRIPT_PROFILE');
  const scripts=profile==='native'?['boot.gd','level.gd','native_verify.gd']:
    ['boot.gd','level.gd','runtime_trigger.gd','godot-resource-command-receiver.gd','godot-resource-pack-session.gd','godot-resource-scene-loader.gd'];
  const paths={boot:[],shared:[],level:[]};
  const boot=new Set(['project.binary','.godot/uid_cache.bin','.godot/global_script_class_cache.cfg',...scripts]);
  const entries=new Map(inventory.entries.map(entry=>[entry.path,entry])),targets=new Map(),remaps=new Map();
  need(entries.size===inventory.entries.length,'RESOURCE_LAB_INVENTORY');
  if(['boot.tscn.remap','level.tscn.remap'].some(name=>entries.has(name))){
    need(Buffer.isBuffer(sourceBuffer)&&sourceBuffer.length===inventory.bytes&&sha(sourceBuffer)===inventory.sha256,'RESOURCE_LAB_REMAP_SOURCE_PIN');
    for(const [scene,owner] of [['boot.tscn','boot'],['level.tscn','level']]){
      const name=scene+'.remap',entry=entries.get(name);if(!entry)continue;
      need(!entries.has(scene),'RESOURCE_LAB_SCENE_MAPPING_AMBIGUOUS');
      need(Number.isSafeInteger(entry.offset)&&Number.isSafeInteger(entry.bytes)&&entry.offset>=104&&entry.bytes>0&&entry.bytes<=4096&&entry.offset<=sourceBuffer.length-entry.bytes,'RESOURCE_LAB_REMAP_BOUNDS');
      const payload=sourceBuffer.subarray(entry.offset,entry.offset+entry.bytes);
      // The fixture's simple ConfigFile grammar only. JSON.parse validates the
      // quoted value's escapes; other keys/sections/comments are not inferred.
      need(payload.every(byte=>byte===9||byte===10||byte===13||(byte>=32&&byte<=126)),'RESOURCE_LAB_REMAP_GRAMMAR');
      const match=/^[ \t\r\n]*\[remap\][ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*path[ \t]*=[ \t]*("(?:[^"\\\r\n]|\\.)*")[ \t]*(?:\r?\n[ \t]*)*$/.exec(payload.toString('utf8'));
      need(match,'RESOURCE_LAB_REMAP_GRAMMAR');
      let target;try{target=JSON.parse(match[1]);}catch{need(false,'RESOURCE_LAB_REMAP_GRAMMAR');}
      need(typeof target==='string'&&target.startsWith('res://')&&target.endsWith('.scn')&&target.length<=1024,'RESOURCE_LAB_REMAP_TARGET');
      target=target.slice(6);
      need(target===target.normalize('NFC')&&!/[\\:\u0000-\u0020\u007f-\u009f\ufeff]/.test(target)&&target.split('/').every(part=>part&&part!=='.'&&part!=='..')&&entries.has(target),'RESOURCE_LAB_REMAP_TARGET');
      need(!targets.has(target),'RESOURCE_LAB_SCENE_TARGET_SHARED');targets.set(target,owner);remaps.set(name,owner);
    }
  }
  for(const entry of inventory.entries){
    const name=entry.path;
    if(boot.has(name))paths.boot.push(name);
    else if(name==='boot.tscn')paths.boot.push(name);
    else if(name==='level.tscn')paths.level.push(name);
    else if(remaps.has(name))paths[remaps.get(name)].push(name);
    else if(targets.has(name))paths[targets.get(name)].push(name);
    else if(['shared/checker.svg','shared/checker.svg.import'].includes(name)||/^\.godot\/imported\/checker\.svg-[a-f0-9]{32}(?:\.[a-z0-9_-]+)?\.ctex$/.test(name))paths.shared.push(name);
    else need(false,'RESOURCE_LAB_UNCLASSIFIED_EXPORT_PATH');
  }
  for(const required of boot)need(paths.boot.includes(required),'RESOURCE_LAB_BOOT_EXPORT_MISSING');
  need(paths.boot.includes('boot.tscn')||remaps.get('boot.tscn.remap')==='boot','RESOURCE_LAB_BOOT_EXPORT_MISSING');
  need((paths.level.includes('level.tscn')||remaps.get('level.tscn.remap')==='level')&&paths.shared.includes('shared/checker.svg.import')&&paths.shared.some(p=>p.startsWith('.godot/imported/')),'RESOURCE_LAB_RESOURCE_EXPORT_MISSING');
  return {schema:'wxslim-pck-partition-v1',source:{bytes:inventory.bytes,sha256:inventory.sha256},packs:Object.entries(paths).map(([id,list])=>({id,role:id==='boot'?'boot':'resource',paths:list}))};
}

function exportedContinuation(currentPlan,taskId,expectedFullPckSha256){
  need(typeof expectedFullPckSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedFullPckSha256),'RESOURCE_LAB_EXPORT_PIN_REQUIRED');
  const root=path.join(currentPlan.output,'continuation-after-import-01'),previous=inspectTask(root,taskId),terminal=previous.terminal;
  need(previous.owner.recipeId==='native-resource-export-fixed-editor-v1'&&terminal?.status==='FAILED'&&terminal.details?.stage==='PARTITION'&&terminal.details?.code==='RESOURCE_LAB_UNCLASSIFIED_EXPORT_PATH'&&terminal.details.stages?.length===1&&terminal.details.stages[0].stage==='EXPORT','RESOURCE_LAB_EXPORT_RESUME_SOURCE');
  const plan=JSON.parse(fs.readFileSync(path.join(root,'PLAN.private.json'),'utf8'));
  const firstPlan=JSON.parse(fs.readFileSync(path.join(currentPlan.output,'PLAN.private.json'),'utf8'));
  need(JSON.stringify(plan)===JSON.stringify(firstPlan),'RESOURCE_LAB_EXPORT_PLAN_IDENTITY');
  const {sources:oldSources,...oldPlan}=plan,{sources:currentSources,...newPlan}=currentPlan;
  need(JSON.stringify(oldPlan)===JSON.stringify(newPlan),'RESOURCE_LAB_EXPORT_PLAN_CHANGED');
  // Only the external diagnostic script may differ. Exported source bytes stay frozen.
  need(oldSources.length===currentSources.length&&oldSources.every(expected=>expected.file==='native_verify.gd'||JSON.stringify(expected)===JSON.stringify(currentSources.find(p=>p.file===expected.file))),'RESOURCE_LAB_EXPORT_SOURCE_RECIPE_CHANGED');
  for(const expected of oldSources){const actual=pin(path.join(plan.output,'source',expected.file));need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'RESOURCE_LAB_EXPORT_SOURCE_CHANGED');}
  const prior=JSON.parse(fs.readFileSync(path.join(root,'CONTINUATION.private.json'),'utf8'));
  for(const entry of prior.evidence)need(JSON.stringify(pin(path.join(plan.output,entry.file)))===JSON.stringify({bytes:entry.bytes,sha256:entry.sha256}),'RESOURCE_LAB_ORIGINAL_EVIDENCE_CHANGED');
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'logs','EXPORT.process.json'),'utf8'));
  need(receipt.closed===true&&receipt.exitCode===0&&receipt.signal===null&&receipt.outcome==='SUCCESS'&&receipt.cancelRequested===false&&receipt.logErrors?.length===0&&!receipt.error,'RESOURCE_LAB_EXPORT_PROCESS');
  const starts=fs.readFileSync(path.join(root,'events.jsonl'),'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line)).filter(event=>event.stage==='EXPORT'&&event.details?.type==='started');
  need(starts.length===1&&starts[0].taskId===taskId&&starts[0].details.pid===receipt.pid&&starts[0].details.executable===plan.editor&&JSON.stringify(starts[0].details.args)===JSON.stringify(plan.commands.find(c=>c.stage==='EXPORT').args)&&normal(starts[0].details.cwd)===normal(path.join(plan.output,'source')),'RESOURCE_LAB_EXPORT_COMMAND');
  const stdout=fs.readFileSync(path.join(root,'logs','EXPORT.stdout.log'),'utf8'),stderr=fs.readFileSync(path.join(root,'logs','EXPORT.stderr.log'),'utf8');
  need(stderr===''&&!/SCRIPT ERROR:|Parse Error:|ERROR:/.test(stdout),'RESOURCE_LAB_EXPORT_LOG');
  const packs=path.join(plan.output,'packs');need(JSON.stringify(fs.readdirSync(packs))===JSON.stringify(['full.pck']),'RESOURCE_LAB_EXPORT_OUTPUT_EXISTS');
  const fullPin=pin(path.join(packs,'full.pck'));need(fullPin.sha256===expectedFullPckSha256,'RESOURCE_LAB_EXPORT_PIN');
  const evidence=[...prior.evidence];
  function snapshot(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),st=fs.lstatSync(file);need(!st.isSymbolicLink(),'RESOURCE_LAB_RESUME_LINK');if(st.isDirectory())snapshot(file);else evidence.push({file:path.relative(plan.output,file).replaceAll('\\','/'),...pin(file)});}}
  snapshot(root);snapshot(path.join(plan.output,'source'));evidence.push({file:'packs/full.pck',...fullPin});
  return {plan,continuation:{schema:'wxslim-resource-lab-post-export-v1',originalTaskId:prior.originalTaskId,exportTaskId:taskId,originalStatus:'FAILED',exportTaskStatus:'FAILED',exportEvidence:'EXPORT_EXIT0_PARTITION_CLASSIFICATION_REJECTED',fullPin,evidence,
    independentImportCommandsAlreadyRun:1,independentExportCommandsAlreadyRun:1,independentImportCommandsToRun:0,independentExportCommandsToRun:0,
    externalVerifier:{file:'native_verify_external.gd',...pin(path.join(REPO,'tests/godot-pck-native-verify.gd'))},
    note:'Reuse exact successful exported PCK. New verifier is external and separately pinned; embedded old verifier and both failed receipts remain unchanged.',root:path.join(plan.output,'continuation-after-export-01')}};
}

export async function executeResourceExportLab(raw,{writeAuthorized=false,resumeImportTaskId=null,resumeExportTaskId=null,expectedFullPckSha256=null}={}){
  need(writeAuthorized===true,'RESOURCE_LAB_WRITE_AUTHORIZATION_REQUIRED');
  need(resumeImportTaskId===null||resumeExportTaskId===null,'RESOURCE_LAB_RESUME_EXCLUSIVE');
  const currentPlan=buildLabPlan(raw,resumeImportTaskId!==null||resumeExportTaskId!==null),input=sourceInputs();
  const exported=resumeExportTaskId===null?null:exportedContinuation(currentPlan,resumeExportTaskId,expectedFullPckSha256);
  const plan=exported?.plan||currentPlan,continuation=exported?.continuation||(resumeImportTaskId===null?null:importedContinuation(plan,resumeImportTaskId));
  if(!exported)need(JSON.stringify(plan.sources)===JSON.stringify([...input.files].map(([file,text])=>({file,bytes:Buffer.byteLength(text),sha256:sha(text)}))),'RESOURCE_LAB_SOURCE_CHANGED');
  const space=fs.statfsSync(path.dirname(plan.output));need(space.bavail*space.bsize>BUDGET+256*1024*1024,'RESOURCE_LAB_DISK_RESERVE');
  need(os.freemem()>=Math.max(2*1024**3,os.totalmem()*0.2),'RESOURCE_LAB_MEMORY_RESERVE');
  const previousBytes=continuation?measureTaskBytes(plan.output):0;
  need(previousBytes<BUDGET-1024*1024,'RESOURCE_LAB_CONTINUATION_BUDGET');
  const task=createTask(continuation?.root||plan.output,{budgetBytes:BUDGET-previousBytes,recipeId:'native-resource-export-fixed-editor-v1'}),started=performance.now(),stages=[];
  const project=path.join(plan.output,'source'),packs=path.join(plan.output,'packs'),logs=path.join(task.root,'logs');
  let stage='PREPARE',terminal,cancelRequested=false,cancelReceiptError=null;
  const cancel=()=>{cancelRequested=true;try{requestCancellation(task.root,task.taskId);}catch(error){cancelReceiptError=error.code||'CANCEL_RECEIPT_FAILED';process.stderr.write('Cancellation requested locally; durable request failed. Waiting for owned child and stopping later stages.\n');}};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  function check(next){need(!cancelRequested,'TASK_CANCELLED');task.checkpoint(next);need(measureTaskBytes(plan.output)<=BUDGET,'RESOURCE_LAB_TOTAL_BUDGET');need(pin(plan.editor).sha256===plan.editorPin.sha256,'RESOURCE_LAB_EDITOR_CHANGED');for(const expected of plan.sources){const actual=pin(path.join(project,expected.file));need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'RESOURCE_LAB_SOURCE_CHANGED');}stage=next;}
  async function child(name,args,cwd,{allowExpectedErrors=false}={}){
    check(name);need(os.freemem()>=Math.max(2*1024**3,os.totalmem()*0.2),'RESOURCE_LAB_MEMORY_RESERVE');
    task.event({stage:name,status:'RUNNING'});const before=measureTaskBytes(task.root),begin=performance.now();
    const result=await runOwnedProcess({executable:plan.editor,args,cwd,stdoutPath:path.join(logs,name+'.stdout.log'),stderrPath:path.join(logs,name+'.stderr.log'),observeAfterMs:120000,isCancellationRequested:()=>cancelRequested||task.readCancellationRequested(),onEvent:event=>task.event({stage:name,status:'RUNNING',details:event})});
    writeNew(path.join(logs,name+'.process.json'),result);
    stages.push({stage:name,elapsedMs:Math.round(performance.now()-begin),bytesBefore:before,bytesAfter:measureTaskBytes(task.root),childClosed:result.closed,childOutcome:result.outcome});
    check(name+'_CLOSED');need(result.outcome==='SUCCESS'&&result.closed===true,'RESOURCE_LAB_CHILD_FAILED');
    const stdout=fs.readFileSync(path.join(logs,name+'.stdout.log'),'utf8'),stderr=fs.readFileSync(path.join(logs,name+'.stderr.log'),'utf8');
    // Expected dependency failures are kept verbatim; the native negative receipt
    // must still prove the precise missing condition, not merely exit zero.
    need(!/SCRIPT ERROR:|Parse Error:/.test(stdout+'\n'+stderr),'RESOURCE_LAB_CHILD_SCRIPT_ERROR');
    if(!allowExpectedErrors)need(!/ERROR:/.test(stdout+'\n'+stderr),'RESOURCE_LAB_CHILD_ERROR_LOG');
    return {stdout,stderr};
  }
  try{
    if(continuation){fs.mkdirSync(logs);writeNew(path.join(task.root,'CONTINUATION.private.json'),continuation);}
    else{for(const dir of [project,packs,logs,path.join(project,'shared')])fs.mkdirSync(dir);for(const [name,text] of input.files)writeNew(path.join(project,name),text);}
    writeNew(path.join(task.root,'PLAN.private.json'),plan);
    const externalVerifier=exported?path.join(task.root,continuation.externalVerifier.file):null;
    if(externalVerifier){writeNew(externalVerifier,fs.readFileSync(path.join(REPO,'tests/godot-pck-native-verify.gd')));need(JSON.stringify(pin(externalVerifier))===JSON.stringify({bytes:continuation.externalVerifier.bytes,sha256:continuation.externalVerifier.sha256}),'RESOURCE_LAB_EXTERNAL_VERIFIER_CHANGED');}
    check('PREPARED');
    for(const command of plan.commands.filter(c=>!exported&&(!continuation||c.stage!=='IMPORT')))await child(command.stage,command.args,project);
    check('PARTITION');const full=fs.readFileSync(path.join(packs,'full.pck')),inventory=inspectPck(full),partition=classifyFixtureInventory(inventory,full),result=partitionPck(full,partition);
    for(const output of result.outputs)writeNew(path.join(packs,output.id+'.pck'),output.buffer);
    const reread=result.outputs.map(p=>({...p,buffer:fs.readFileSync(path.join(packs,p.id+'.pck'))}));
    const audit=auditPckPartition(fs.readFileSync(path.join(packs,'full.pck')),partition,reread);writeNew(path.join(task.root,'PARTITION.json'),audit);
    need(!fs.existsSync(path.join(packs,'override.cfg')),'RESOURCE_LAB_OVERRIDE_PRESENT');
    const native=[];
    for(const mode of plan.nativeModes){
      check('NATIVE_PREPARE');const runRoot=path.join(task.root,'run-'+mode);fs.mkdirSync(runRoot);need(fs.readdirSync(runRoot).length===0,'RESOURCE_LAB_RUN_NOT_EMPTY');
      const config={schema:'wxslim-native-pck-check-v1',mode,runRoot,sourceSentinel:'res://source-only-marker.txt',packs:audit.packs.map(p=>({id:p.id,file:path.join(packs,p.id+'.pck'),bytes:p.bytes,sha256:p.sha256,entries:p.entries.map(e=>({path:e.path,bytes:e.bytes,sha256:e.sha256}))})),
        level:{entry:'res://level.tscn',script:'res://level.gd',globalName:input.expectedProof.className,marker:input.expectedProof.marker,texturePath:'res://shared/checker.svg',textureWidth:16,textureHeight:16}};
      const configPath=path.join(task.root,'native-'+mode+'.private.json');writeNew(configPath,config);
      if(externalVerifier)need(JSON.stringify(pin(externalVerifier))===JSON.stringify({bytes:continuation.externalVerifier.bytes,sha256:continuation.externalVerifier.sha256}),'RESOURCE_LAB_EXTERNAL_VERIFIER_CHANGED');
      const args=['--headless','--path',runRoot,'--main-pack',path.join(packs,'boot.pck'),'--script',externalVerifier||'res://native_verify.gd','--',configPath,pin(configPath).sha256];
      const captured=await child('NATIVE_'+mode.toUpperCase(),args,runRoot,{allowExpectedErrors:mode==='missing_shared'});
      const reports=captured.stdout.split(/\r?\n/).filter(line=>line.startsWith('PCK_NATIVE_VERIFY '));need(reports.length===1,'RESOURCE_LAB_NATIVE_REPORT_MISSING');
      const report=JSON.parse(reports[0].slice('PCK_NATIVE_VERIFY '.length));
      const expected={boot_only:'EXPECTED_BOOT_ONLY_MISSING',missing_shared:'EXPECTED_SHARED_DEPENDENCY_MISSING',normal:'PASS_NATIVE_PACK_LOAD_ONLY'}[mode];
      need(report.status===expected&&report.mode===mode&&report.failures?.length===0,'RESOURCE_LAB_NATIVE_REPORT_FAILED');
      need(report.version?.hash==='ed1daf0bf001b61586d9930840f2f1394092c079','RESOURCE_LAB_NATIVE_VERSION');
      if(externalVerifier)need(normal(report.verifier?.path||'')===normal(externalVerifier)&&report.verifier?.sha256===continuation.externalVerifier.sha256&&JSON.stringify(pin(externalVerifier))===JSON.stringify({bytes:continuation.externalVerifier.bytes,sha256:continuation.externalVerifier.sha256}),'RESOURCE_LAB_EXECUTED_VERIFIER_PIN');
      native.push(report);writeNew(path.join(task.root,'NATIVE_'+mode.toUpperCase()+'.private.json'),report);
      auditPckPartition(fs.readFileSync(path.join(packs,'full.pck')),partition,result.outputs.map(p=>({...p,buffer:fs.readFileSync(path.join(packs,p.id+'.pck'))})));
    }
    check('FINAL');
    if(continuation)for(const original of continuation.evidence)need(JSON.stringify(pin(path.join(plan.output,original.file)))===JSON.stringify({bytes:original.bytes,sha256:original.sha256}),'RESOURCE_LAB_ORIGINAL_EVIDENCE_CHANGED');
    const details={status:'NATIVE_RESOURCE_FIXTURE_VERIFIED_ONLY',elapsedMs:Math.round(performance.now()-started),stages,editorPin:plan.editorPin,partitionAuditSha256:pin(path.join(task.root,'PARTITION.json')).sha256,native:native.map(r=>({mode:r.mode,status:r.status})),logicalBytesBeforeReceipt:measureTaskBytes(plan.output),continuationOf:continuation?.originalTaskId||null,originalTaskStatus:continuation?'FAILED':null,processMemoryPeak:'NOT_MEASURED',wechat:'NOT_RUN',wasmBridge:'NOT_RUN',productionStagingHelper:'NOT_RUN',visual:'NOT_VERIFIED'};
    const receiptReserve=2*Buffer.byteLength(JSON.stringify({schema:'wxslim-official-task-v1',taskId:task.taskId,at:new Date().toISOString(),status:'SUCCESS',details})+'\n');
    need(measureTaskBytes(plan.output)+receiptReserve<=BUDGET,'RESOURCE_LAB_TERMINAL_BUDGET');
    terminal=task.finish('SUCCESS',details);
  }catch(error){
    let errorReceiptFailure=null;
    try{writeNew(path.join(task.root,'ERROR.private.json'),{stage,code:error.code||'RESOURCE_LAB_FAILED',message:error.message,stack:error.stack});}catch(receiptError){errorReceiptFailure=receiptError.code||'ERROR_RECEIPT_FAILED';}
    try{terminal=task.finish(cancelRequested||error.code==='TASK_CANCELLED'?'CANCELLED':'FAILED',{stage,code:error.code||'RESOURCE_LAB_FAILED',cancelRequested,cancelReceiptError,errorReceiptFailure,elapsedMs:Math.round(performance.now()-started),stages,wechat:'NOT_RUN',visual:'NOT_VERIFIED'});}
    catch(terminalError){throw Object.assign(Error('Task terminal was not committed; retain output and inspect TASK/events/process logs.'),{code:'RESOURCE_LAB_TERMINAL_NOT_COMMITTED',originalCode:error.code||'RESOURCE_LAB_FAILED',errorReceiptFailure,terminalErrorCode:terminalError.code||'TERMINAL_RECEIPT_FAILED'});}
  }finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
  return {schema:'wxslim-resource-export-lab-result-v1',taskId:task.taskId,taskRoot:task.root,terminal,logicalBytes:measureTaskBytes(plan.output)};
}
