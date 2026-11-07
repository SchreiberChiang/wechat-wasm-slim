// Existing official output -> new owned resource package task. No conversion,
// project export, engine execution, upload, or private phone-stage dependency.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readConfiguration,checkOfficialInputs,auditOfficialOutput,snapshotInputs} from '../convert/official.mjs';
import {createTask,inspectTask,measureTaskBytes} from '../convert/lib/official-task.mjs';
import {normalizeResourceConfig,planResourceInventories} from './resource-pack-plan.mjs';
import {inspectPck} from './pck-inventory.mjs';
import {renderResourceInterfaces} from './resource-interfaces-bundle.mjs';
import {planResourceRuntimeAssembly,auditResourceRuntimeAssembly} from './resource-runtime-assembly.mjs';
import {readTaskEventProgress} from './task-events.mjs';

const MIB=1024*1024,INPUT_LIMIT=256*MIB,RESERVE=4*MIB,MAX_BUDGET=384*MIB;
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const within=(a,b)=>norm(a)===norm(b)||norm(a).startsWith(norm(b)+path.sep);
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const SOURCE_FILES=['resource-assembly-task.mjs','resource-runtime-assembly.mjs','resource-interfaces-bundle.mjs','resource-pack-plan.mjs','pck-inventory.mjs','task-events.mjs','../convert/lib/official-task.mjs'];
function ordinary(file,directory=false){
  const s=fs.lstatSync(file,{bigint:true});
  need(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile())&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_ASSEMBLY_TASK_PATH');return s;
}
function read(file,limit=INPUT_LIMIT,expected){
  const before=ordinary(file);need(before.size<=BigInt(limit),'RESOURCE_ASSEMBLY_TASK_INPUT_BUDGET');
  const fd=fs.openSync(file,'r'),b=Buffer.alloc(Number(before.size));
  try{
    need(same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_ASSEMBLY_TASK_CHANGED');let at=0;
    while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,null);need(n>0,'RESOURCE_ASSEMBLY_TASK_CHANGED');at+=n;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_ASSEMBLY_TASK_CHANGED');
  }finally{fs.closeSync(fd);}
  need(same(before,ordinary(file)),'RESOURCE_ASSEMBLY_TASK_CHANGED');if(expected)assert.deepEqual(pin(b),expected,'RESOURCE_ASSEMBLY_TASK_CHANGED');return b;
}
function document(file,limit=MIB){const b=read(file,limit);return {file,value:JSON.parse(b),...pin(b)};}
function tree(root){
  ordinary(root,true);const files=new Map(),directories=[],aliases=new Set();let total=0,count=0;
  const walk=(dir,prefix='')=>{
    const start=ordinary(dir,true),names=fs.readdirSync(dir).sort();
    for(const name of names){
      need(++count<=10000&&!/[\\:\u0000-\u001f\u007f-\u009f]/u.test(name)&&name===name.normalize('NFC'),'RESOURCE_ASSEMBLY_TASK_TREE');
      const relative=prefix+name,file=path.join(dir,name),s=fs.lstatSync(file);
      need(!aliases.has(relative.toLowerCase()),'RESOURCE_ASSEMBLY_TASK_ALIAS');aliases.add(relative.toLowerCase());
      if(s.isDirectory()&&!s.isSymbolicLink()){directories.push(relative);walk(file,relative+'/');}
      else{need(s.isFile()&&!s.isSymbolicLink(),'RESOURCE_ASSEMBLY_TASK_PATH');need(total+s.size<=INPUT_LIMIT,'RESOURCE_ASSEMBLY_TASK_INPUT_BUDGET');const b=read(file);total+=b.length;need(total<=INPUT_LIMIT,'RESOURCE_ASSEMBLY_TASK_INPUT_BUDGET');files.set(relative,b);}
    }
    need(same(start,ordinary(dir,true))&&JSON.stringify(names)===JSON.stringify(fs.readdirSync(dir).sort()),'RESOURCE_ASSEMBLY_TASK_CHANGED');
  };walk(root);
  return {files,directories:directories.sort(),records:[...files].map(([file,b])=>({path:file,...pin(b)})).sort((a,b)=>a.path.localeCompare(b.path)),bytes:total};
}
function treeIdentity(t){return {directories:t.directories,files:t.records,bytes:t.bytes};}
function sourcePins(){return SOURCE_FILES.map(file=>({file,...pin(fs.readFileSync(new URL(file,import.meta.url)))}));}
function normalized(raw,base){
  need(exact(raw,['schema','officialConfigFile','resourceConfigFile','convertedOutput','output','budgetBytes'])&&raw.schema==='wxslim-resource-assembly-task-v1','RESOURCE_ASSEMBLY_TASK_CONFIG');
  need(Number.isSafeInteger(raw.budgetBytes)&&raw.budgetBytes>=RESERVE&&raw.budgetBytes<=MAX_BUDGET,'RESOURCE_ASSEMBLY_TASK_BUDGET');
  const out={...raw};for(const k of ['officialConfigFile','resourceConfigFile','convertedOutput','output']){need(typeof raw[k]==='string'&&raw[k]&&raw[k].trim()===raw[k]&&!/[\u0000\r\n]/.test(raw[k]),'RESOURCE_ASSEMBLY_TASK_PATH');out[k]=path.resolve(base,raw[k]);}return out;
}
function outputGate(input,protectedPaths,absent=true){
  ordinary(path.dirname(input.output),true);
  for(const source of protectedPaths)need(!within(source,input.output)&&!within(input.output,source),'RESOURCE_ASSEMBLY_TASK_OVERLAP');
  if(absent){try{fs.lstatSync(input.output);need(false,'RESOURCE_ASSEMBLY_TASK_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function planHash(p){const {planSha256,...rest}=p;return sha(JSON.stringify(rest));}
function put(file,b){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function mkdirFor(root,file){const parts=file.split('/');parts.pop();let at=root;for(const p of parts){at=path.join(at,p);try{fs.mkdirSync(at);}catch(e){if(e.code!=='EEXIST')throw e;ordinary(at,true);}}}
const failureCode=e=>/^(RESOURCE_|PCK_|TASK_)[A-Z0-9_]{1,90}$/.test(e?.code??'')?e.code:'RESOURCE_ASSEMBLY_TASK_FAILED';
const nativeOfficial={readConfiguration,checkOfficialInputs,auditOfficialOutput,snapshotInputs};

/** Dependency injection is for JS models only, never configuration/CLI options.
 * Every injected service labels its plans/receipts MODEL_ONLY, regardless of the
 * adapter's claimed result. It cannot certify a registered fixed engine pair. */
export function createResourceAssemblyTaskService({official}={}){
  const model=official!==undefined,api=official??nativeOfficial;
  for(const key of Object.keys(nativeOfficial))need(typeof api[key]==='function','RESOURCE_ASSEMBLY_TASK_ADAPTER');
  const verification=model?'MODEL_ONLY_NOT_FIXED_PAIR_VERIFIED':'CURRENT_OFFICIAL_PREFLIGHT_AND_OUTPUT_AUDIT';
  function prepare(file,withBytes=false){
    file=path.resolve(file);const cfgDoc=document(file),input=normalized(cfgDoc.value,path.dirname(file));
    const officialDoc=document(input.officialConfigFile),resourceDoc=document(input.resourceConfigFile);
    // Apply runtime resource limits before even official preflight can read the
    // boot PCK. Unsupported declarations must not trigger large/resource reads.
    const resources=normalizeResourceConfig(resourceDoc.value,path.dirname(input.resourceConfigFile));
    const resourceDeclarations=resources.packs.filter(p=>p.role==='resource');
    need(resourceDeclarations.length>0&&resourceDeclarations.length<=128&&resourceDeclarations.every(p=>p.bytes<=32*MIB)&&resourceDeclarations.reduce((n,p)=>n+p.bytes,0)<=64*MIB,'RESOURCE_ASSEMBLY_TASK_RESOURCE_BUDGET');
    const cfg=api.readConfiguration(input.officialConfigFile);
    for(const key of ['js','wasm','pck','transformer','interfaces','upstreamSource'])if(cfg[key])ordinary(cfg[key]);
    const officialBefore=api.checkOfficialInputs(cfg);
    need(officialBefore.status==='PASS_STATIC_ONLY','RESOURCE_ASSEMBLY_TASK_OFFICIAL_PREFLIGHT');
    const protectedPaths=[file,input.officialConfigFile,input.resourceConfigFile,input.convertedOutput,...['js','wasm','pck','transformer','interfaces','upstreamSource'].filter(k=>cfg[k]).map(k=>cfg[k])];
    protectedPaths.push(...resources.packs.map(p=>p.file));outputGate(input,protectedPaths);
    const baseline=tree(input.convertedOutput);
    const originalAudit=api.auditOfficialOutput({...cfg,output:input.convertedOutput},officialBefore);
    const sourceBuffers=new Map(),resourcePcks=new Map(),inventories=new Map();let resourceBytes=0;
    for(const p of resources.packs){
      resourceBytes+=p.bytes;need(resourceBytes<=INPUT_LIMIT,'RESOURCE_ASSEMBLY_TASK_INPUT_BUDGET');
      const b=read(p.file,INPUT_LIMIT,{bytes:p.bytes,sha256:p.sha256});sourceBuffers.set(p.id,b);inventories.set(p.id,inspectPck(b));if(p.role==='resource')resourcePcks.set(p.id,b);
    }
    const boot=resources.packs.find(p=>p.role==='boot');
    need(read(cfg.pck).equals(sourceBuffers.get(boot.id)),'RESOURCE_ASSEMBLY_TASK_BOOT_BYTES');
    const enginePins={engineJsSha256:sha(read(cfg.js)),wasmSha256:sha(read(cfg.wasm)),pckSha256:boot.sha256};
    const runtimeConfig={...resourceDoc.value,packs:resourceDoc.value.packs.map(p=>({...p,file:resources.packs.find(r=>r.id===p.id).file}))};
    const runtimeInputs={config:runtimeConfig,sourceBuffers,enginePins};
    const bundle=renderResourceInterfaces({...runtimeInputs,developmentOnly:true});
    need(read(cfg.interfaces).equals(Buffer.from(bundle.source)),'RESOURCE_ASSEMBLY_TASK_INTERFACES_BYTES');
    const resourcePlan=planResourceInventories(runtimeConfig,inventories,{sourceBuffers});
    const originalFiles=new Map([...baseline.files].filter(([n])=>n.startsWith('minigame/')).map(([n,b])=>[n.slice(9),b]));
    need(originalFiles.has('game.json')&&originalFiles.has('project.config.json'),'RESOURCE_ASSEMBLY_TASK_OFFICIAL_TREE');
    const gameJSON=JSON.parse(originalFiles.get('game.json')),projectConfig=JSON.parse(originalFiles.get('project.config.json'));
    const assemblyInputs={gameJSON,projectConfig,plan:resourcePlan,manifest:bundle.manifest,candidateFiles:originalFiles,resourcePcks,runtimeInputs};
    const assembly=planResourceRuntimeAssembly(assemblyInputs),outputFiles=new Map(baseline.files);
    outputFiles.set('minigame/game.json',assembly.gameJSONFile.buffer);for(const r of assembly.additions)outputFiles.set('minigame/'+r.path,r.buffer);
    const outputDirectories=new Set(baseline.directories);for(const name of outputFiles.keys()){const parts=name.split('/');parts.pop();while(parts.length){outputDirectories.add(parts.join('/'));parts.pop();}}
    const outputBytes=[...outputFiles.values()].reduce((n,b)=>n+b.length,0);
    const plan={schema:'wxslim-resource-assembly-task-plan-v1',input,configuration:pin(read(file,MIB)),officialConfiguration:pin(read(input.officialConfigFile,MIB)),resourceConfiguration:pin(read(input.resourceConfigFile,MIB)),
      sources:sourcePins(),officialSnapshot:officialBefore.snapshot,officialVerification:verification,packageId:officialBefore.expectedManifest.packageVersion,
      baseline:treeIdentity(baseline),outputs:[...outputFiles].map(([name,b])=>({path:'converted/'+name,...pin(b)})).sort((a,b)=>a.path.localeCompare(b.path)),outputDirectories:[...outputDirectories].sort(),
      resourcePlanSha256:resourcePlan.planSha256,runtimeBinding:assembly.runtimeBinding,diff:assembly.diff,outputBytes,receiptReserveBytes:RESERVE,
      evidenceScope:'WRITTEN_RESOURCE_PACKAGE_STATIC_ONLY',dependencyCoverage:assembly.dependencyCoverage,
      byteBudgetScope:'Logical existing-file/output sizes only; not process memory peak, disk quota, or WeChat package quota',
      engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',admission:'NOT_ADMITTED'};
    plan.planSha256=planHash(plan);
    need(outputBytes+RESERVE<=input.budgetBytes&&json(plan).length*2+json(input).length+MIB<=RESERVE,'RESOURCE_ASSEMBLY_TASK_BUDGET');
    assert.deepEqual(treeIdentity(tree(input.convertedOutput)),plan.baseline,'RESOURCE_ASSEMBLY_TASK_CHANGED');
    assert.deepEqual(api.snapshotInputs(cfg),officialBefore.snapshot,'RESOURCE_ASSEMBLY_TASK_CHANGED');
    for(const d of [cfgDoc,officialDoc,resourceDoc])read(d.file,MIB,{bytes:d.bytes,sha256:d.sha256});
    return {input:{...input,configurationFile:file},before:{configuration:plan.configuration,planSha256:plan.planSha256},plan,profile:'resource-runtime-assemble-v1',...(withBytes?{cfg,officialBefore,originalAudit,baseline,outputFiles,assembly,assemblyInputs}:{})};
  }
  async function execute(input,before,{writeAuthorized=false}={}){
    need(writeAuthorized===true,'TASK_WRITE_REQUIRED');const p=prepare(input.configurationFile,true);
    assert.deepEqual(p.input,input,'RESOURCE_ASSEMBLY_TASK_CHANGED');assert.deepEqual(p.before,before,'RESOURCE_ASSEMBLY_TASK_CHANGED');
    const {plan}=p,task=createTask(input.output,{budgetBytes:input.budgetBytes,recipeId:'resource-runtime-assemble:'+plan.planSha256}),start=performance.now();
    let stage='SNAPSHOT',status='SUCCESS',failure=null,auditPin=null;const phases=[];
    try{
      put(path.join(task.root,'REQUEST.private.json'),json(plan.input));put(path.join(task.root,'PLAN.private.json'),json(plan));
      task.event({stage,status:'SUCCEEDED'});await turn();task.checkpoint('WRITE_PACKAGE');stage='WRITE_PACKAGE';let phase=performance.now();
      const destination=path.join(task.root,'converted');fs.mkdirSync(destination);
      for(const dir of plan.outputDirectories){task.checkpoint(stage);mkdirFor(destination,dir+'/placeholder');await turn();}
      for(const [name,b]of p.outputFiles){task.checkpoint(stage);mkdirFor(destination,name);put(path.join(destination,...name.split('/')),b);await turn();}
      phases.push({name:stage,status:'SUCCESS',wallMs:performance.now()-phase});task.event({stage,status:'SUCCEEDED'});
      task.checkpoint('VERIFY');stage='VERIFY';phase=performance.now();
      const actual=tree(destination),wanted={directories:plan.outputDirectories,files:plan.outputs.map(r=>({...r,path:r.path.slice(10)})),bytes:plan.outputBytes};
      assert.deepEqual(treeIdentity(actual),wanted,'RESOURCE_ASSEMBLY_TASK_OUTPUT_CHANGED');
      const mini=new Map([...actual.files].filter(([n])=>n.startsWith('minigame/')).map(([n,b])=>[n.slice(9),b]));
      const assembled=auditResourceRuntimeAssembly({originalGameJSON:p.assemblyInputs.gameJSON,gameJSON:JSON.parse(mini.get('game.json')),projectConfig:p.assemblyInputs.projectConfig,plan:p.assemblyInputs.plan,manifest:p.assemblyInputs.manifest,originalFiles:p.assemblyInputs.candidateFiles,candidateFiles:mini,resourcePcks:p.assemblyInputs.resourcePcks,runtimeInputs:p.assemblyInputs.runtimeInputs});
      const officialAudit=api.auditOfficialOutput({...p.cfg,output:destination},p.officialBefore);
      // Re-read sources after all output validation; timestamps are never an admission receipt.
      assert.deepEqual(treeIdentity(tree(input.convertedOutput)),plan.baseline,'RESOURCE_ASSEMBLY_TASK_CHANGED');
      assert.deepEqual(sourcePins(),plan.sources,'RESOURCE_ASSEMBLY_TASK_SOURCE_CHANGED');
      assert.deepEqual(api.snapshotInputs(p.cfg),plan.officialSnapshot,'RESOURCE_ASSEMBLY_TASK_CHANGED');
      read(input.configurationFile,MIB,plan.configuration);read(input.officialConfigFile,MIB,plan.officialConfiguration);read(input.resourceConfigFile,MIB,plan.resourceConfiguration);
      for(const pack of normalizeResourceConfig(p.assemblyInputs.runtimeInputs.config).packs)read(pack.file,INPUT_LIMIT,{bytes:pack.bytes,sha256:pack.sha256});
      const audit={schema:'wxslim-resource-assembly-task-audit-v1',status:'PASS_WRITTEN_STATIC_RESOURCE_ASSEMBLY_ONLY',taskId:task.taskId,planSha256:plan.planSha256,officialVerification:verification,
        originalOfficialAudit:p.originalAudit,officialAudit,assembly:assembled,writtenFiles:plan.outputs,outputDirectories:plan.outputDirectories,admission:'NOT_ADMITTED',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'};
      const b=json(audit);need(b.length<=MIB,'RESOURCE_ASSEMBLY_TASK_RECEIPT_BUDGET');put(path.join(task.root,'AUDIT.private.json'),b);auditPin=pin(b);
      phases.push({name:stage,status:'SUCCESS',wallMs:performance.now()-phase});task.event({stage,status:'SUCCEEDED'});await turn();task.checkpoint('COMPLETE');stage='COMPLETE';
      // The preceding yield permits cooperative cancellation; it must not also
      // permit changed inputs/output to inherit a stale successful audit.
      assert.deepEqual(treeIdentity(tree(destination)),wanted,'RESOURCE_ASSEMBLY_TASK_OUTPUT_CHANGED');
      assert.deepEqual(treeIdentity(tree(input.convertedOutput)),plan.baseline,'RESOURCE_ASSEMBLY_TASK_CHANGED');
      assert.deepEqual(api.snapshotInputs(p.cfg),plan.officialSnapshot,'RESOURCE_ASSEMBLY_TASK_CHANGED');
      assert.deepEqual(sourcePins(),plan.sources,'RESOURCE_ASSEMBLY_TASK_SOURCE_CHANGED');
      const currentBundle=renderResourceInterfaces({...p.assemblyInputs.runtimeInputs,developmentOnly:true});
      assert.equal(currentBundle.sha256,plan.runtimeBinding.interfacesSha256,'RESOURCE_ASSEMBLY_TASK_SOURCE_CHANGED');
      read(input.configurationFile,MIB,plan.configuration);read(input.officialConfigFile,MIB,plan.officialConfiguration);read(input.resourceConfigFile,MIB,plan.resourceConfiguration);
      for(const pack of normalizeResourceConfig(p.assemblyInputs.runtimeInputs.config).packs)read(pack.file,INPUT_LIMIT,{bytes:pack.bytes,sha256:pack.sha256});
    }catch(e){failure={stage,code:failureCode(e)};status=e.code==='TASK_CANCELLED'?'CANCELLED':'FAILED';put(path.join(task.root,'FAILURE.private.json'),json({...failure,error:String(e).slice(0,4096)}));}
    const terminal=task.finish(status,{kind:'RESOURCE_RUNTIME_ASSEMBLE',planSha256:plan.planSha256,officialVerification:verification,...failure,audit:auditPin,phases,admission:'NOT_ADMITTED',engineRun:'NOT_RUN'});
    return {status:terminal.status,terminal,taskId:task.taskId,elapsedMs:performance.now()-start,logicalBytes:measureTaskBytes(task.root),audit:auditPin,phases};
  }
  function control({source,request,config,root,taskId}){
    root=path.resolve(root);const input=normalized(config.value,path.dirname(config.file));outputGate(input,[config.file,input.officialConfigFile,input.resourceConfigFile,input.convertedOutput],false);
    need(norm(input.output)===norm(root),'TASK_ID_MISMATCH');ordinary(root,true);
    const state=inspectTask(root,taskId),saved=document(path.join(root,'REQUEST.private.json')),plan=document(path.join(root,'PLAN.private.json'));
    assert.deepEqual(saved.value,input);assert.deepEqual(plan.value.input,input);assert.deepEqual(plan.value.configuration,pin(read(config.file,MIB)));
    assert.equal(planHash(plan.value),plan.value.planSha256);assert.equal(plan.value.officialVerification,verification);
    const recipeId='resource-runtime-assemble:'+plan.value.planSha256;assert.equal(state.owner.recipeId,recipeId);assert.equal(state.owner.budgetBytes,input.budgetBytes);
    const docs=[saved,plan],terminal=state.terminal;
    if(terminal){assert.equal(terminal.details?.kind,'RESOURCE_RUNTIME_ASSEMBLE');assert.equal(terminal.details.planSha256,plan.value.planSha256);assert.equal(terminal.details.admission,'NOT_ADMITTED');assert.equal(terminal.details.officialVerification,verification);
      if(terminal.status==='SUCCESS'){const a=document(path.join(root,'AUDIT.private.json'));docs.push(a);assert.deepEqual({bytes:a.bytes,sha256:a.sha256},terminal.details.audit);assert.equal(a.value.taskId,taskId);assert.equal(a.value.planSha256,plan.value.planSha256);assert.equal(a.value.status,'PASS_WRITTEN_STATIC_RESOURCE_ASSEMBLY_ONLY');assert.equal(a.value.officialVerification,verification);assert.deepEqual(a.value.writtenFiles,plan.value.outputs);}}
    // Control binds the original task request and durable evidence only. Later
    // changes/removal of execution inputs must not prevent cancelling that task.
    const stable=()=>{for(const d of [source,config,...docs])read(d.file,RESERVE,{bytes:d.bytes??fs.statSync(d.file).size,sha256:d.sha256});};stable();
    const warnings=[];if(state.logicalBytes>input.budgetBytes)warnings.push({code:'TASK_BUDGET_EXCEEDED',message:'Task exceeds its original budget; no expansion.'});
    try{ordinary(path.join(root,'.control-lock'),true);warnings.push({code:'TASK_CONTROL_LOCK_PRESENT',message:'Retained control lock; process liveness is not inferred.'});}catch(e){if(e.code!=='ENOENT')throw e;}
    return {root,taskId,recipeId,stable,output:{schema:'wxslim-task-status-v1',action:request.action,taskId,recipeId,profile:'resource-runtime-assemble-v1',packageId:plan.value.packageId,
      requestSha256:source.sha256,configurationSha256:config.sha256,status:terminal?.status??(state.cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),terminalPresent:!!terminal,cancellationRequested:!!state.cancellation,
      inputBinding:'MATCHED_EXECUTION_SNAPSHOT',logicalBytes:state.logicalBytes,budgetBytes:input.budgetBytes,warnings,progress:readTaskEventProgress(root,taskId),taskFailureCode:terminal?.details?.code??null,
      processLiveness:'NOT_OBSERVED',officialVerification:verification,admission:'NOT_ADMITTED',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',scope:'Bound local receipts/config only; no current output re-audit or device acceptance.'}};
  }
  return Object.freeze({prepare,execute,control});
}
const service=createResourceAssemblyTaskService();
export const prepareResourceAssemblyTask=service.prepare;
export const executeResourceAssemblyTask=service.execute;
export const controlResourceAssemblyTask=service.control;
