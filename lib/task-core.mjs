// Shared task admission for CLI and the future local-only editor UI.
// No second build recipe, process controller, upload path or task directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assessCapability} from './capabilities.mjs';
import {readConfiguration,checkOfficialInputs,conversionPlan} from '../convert/official.mjs';
import {executeOfficial} from '../convert/official-execute.mjs';
import {withOfficialConfiguration} from '../convert/lib/official-custom-context.mjs';
import {normalizeExecutionRequest,executionPlan,executeFixedBuild} from '../engine/fixed-build.mjs';
import {normalizePersistentExecutionRequest,persistentExecutionPlan,executePersistentBuild} from '../engine/persistent-build.mjs';
import {inspectTask,requestCancellation} from '../convert/lib/official-task.mjs';
import {getOfficialRecipe,getRecipeIdentity,OFFICIAL_C050_PROFILE,isOfficialC050Profile,isConservativeEngineProfile,isDevelopmentEngineProfile} from '../convert/lib/official-engine-admission.mjs';
import {STORAGE_PROFILE} from '../convert/lib/storage-adapter.mjs';
import {readTaskEventProgress} from './task-events.mjs';
import {normalizeOfficialRawBuildRequest,officialRawExecutionPlan} from '../engine/official-build-preflight.mjs';
import {executeOfficialRawBuild} from '../engine/official-build-raw.mjs';
import {preparePairTask,executePairTask} from './pair-task.mjs';
import {prepareCustomPairTask,executeCustomPairTask,CUSTOM_PAIR_PROFILE} from './custom-pair-task.mjs';
import {prepareResourcePartitionTask,executeResourcePartitionTask,controlResourcePartitionTask} from './resource-partition-task.mjs';
import {prepareProjectPckExport,executeProjectPckExport,controlProjectPckExport} from './project-pck-export.mjs';
import {prepareResourceInterfacesTask,executeResourceInterfacesTask,controlResourceInterfacesTask} from './resource-interfaces-task.mjs';
import {prepareResourceAssemblyTask,executeResourceAssemblyTask,controlResourceAssemblyTask} from './resource-assembly-task.mjs';
import {prepareResourceProjectInstall,executeResourceProjectInstall,controlResourceProjectInstall} from './resource-project-install-task.mjs';

export const TASK_REQUEST_SCHEMA='wxslim-task-request-v1';
const actions=Object.freeze({
  'official-convert':{capability:'official-convert',controlCommand:'official'},
  'fixed-engine-build':{capability:'engine-build-fixed',controlCommand:'engine'},
  'persistent-dev-engine-build':{capability:'engine-build-persistent-dev',controlCommand:'task'},
  'official-raw-engine-build':{capability:'engine-build-official-raw-dev',controlCommand:'task'},
  'official-pair-prepare':{capability:'engine-official-pair-prepare',controlCommand:null},
  'custom-pair-prepare':{capability:'engine-official-pair-prepare',controlCommand:null},
  'resource-pck-partition':{capability:'resource-subpackages',controlCommand:'task'},
  'project-pck-export':{capability:'project-pck-export',controlCommand:'task'},
  'resource-interfaces-prepare':{capability:'resource-subpackages',controlCommand:'task'},
  'resource-runtime-assemble':{capability:'resource-subpackages',controlCommand:'task'},
  'resource-project-install':{capability:'resource-subpackages',controlCommand:'task'},
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isPairAction=action=>action==='official-pair-prepare'||action==='custom-pair-prepare';
// The UI/AI may bind an already reviewed plan to a later CLI process. Preserve
// every JSON field; sorted object keys only remove serialization-order noise.
export function taskPlanIdentity(value){
  if(!isObject(value)||value.schema!=='wxslim-task-plan-v1')fail('TASK_PLAN_INVALID','需要完整的共用任务计划。');
  const canonical=v=>Array.isArray(v)?v.map(canonical):isObject(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return digest(JSON.stringify(canonical(value)));
}
function developmentSummary(profile){
  if(isOfficialC050Profile(profile)||profile===CUSTOM_PAIR_PROFILE)return {profile,developmentProfile:true,allowedPurposes:['inspect','development-test'],
    officialEngineRuntime:'NOT_VERIFIED',productionAdmission:'NOT_ADMITTED',admission:'NOT_ADMITTED',
    conversionSuccessMeaning:'CONVERSION_AND_STATIC_AUDIT_ONLY',deviceEvidence:'NOT_INHERITED'};
  return profile===STORAGE_PROFILE?{profile,developmentProfile:true,allowedPurposes:['inspect','development-test'],
    storageRuntime:'NOT_VERIFIED',persistentSaveAdmission:'NOT_ADMITTED',conversionSuccessMeaning:'CONVERSION_AND_STATIC_AUDIT_ONLY'}:{};
}

function document(file){
  const absolute=path.resolve(file),stat=fs.lstatSync(absolute);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024*1024,'bounded ordinary JSON file required');
  const bytes=fs.readFileSync(absolute),after=fs.lstatSync(absolute);assert(bytes.length<=1024*1024&&bytes.length===stat.size);
  assert(after.isFile()&&!after.isSymbolicLink()&&['size','mtimeMs','ctimeMs','ino','dev'].every(k=>stat[k]===after[k]),'document changed while read');
  return {file:absolute,value:JSON.parse(bytes),sha256:digest(bytes)};
}
export function readTaskRequest(file){
  const source=document(file),raw=source.value;
  if(!isObject(raw)||Object.keys(raw).some(k=>!['schema','action','configFile','purpose','scope'].includes(k))||
    raw.schema!==TASK_REQUEST_SCHEMA||!Object.hasOwn(actions,raw.action)||typeof raw.configFile!=='string'||!raw.configFile.trim())
    fail('TASK_REQUEST_INVALID','任务仅接受固定 action、配置文件、用途及证据范围。');
  const purpose=raw.purpose??'inspect',scope=raw.scope??{};
  // Use the same strict scope/purpose parser as capability inspection.
  assessCapability({capability:actions[raw.action].capability,purpose,scope});
  return {source,request:{schema:TASK_REQUEST_SCHEMA,action:raw.action,configFile:path.resolve(path.dirname(source.file),raw.configFile),purpose,scope:structuredClone(scope)}};
}
function stableDocument(source){assert.equal(document(source.file).sha256,source.sha256,'task/config changed during admission');}
function warning(value){
  return {code:/^[A-Z][A-Z0-9_]{0,63}$/.test(value?.code||'')?value.code:'TASK_LOCK_RELEASE_FAILED',
    message:'终态已保存，但控制锁释放有告警；核对本地任务记录，不自动重试。'};
}
const samePath=(a,b)=>{const norm=v=>process.platform==='win32'?path.resolve(v).toLowerCase():path.resolve(v);return typeof a==='string'&&typeof b==='string'&&norm(a)===norm(b);};
const bytePin=value=>isObject(value)&&Object.keys(value).length===2&&Object.hasOwn(value,'bytes')&&Object.hasOwn(value,'sha256')&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
function rawTerminalDetails(terminal,profile,sourceRecipe){
  const details=terminal?.details;
  assert(['SUCCESS','FAILED','CANCELLED'].includes(terminal?.status),'raw terminal status required');
  assert.equal(details?.kind,'OFFICIAL_RAW_BUILD');assert.equal(details.profile,profile);
  if(sourceRecipe!==undefined)assert.equal(details.sourceRecipe,sourceRecipe,'raw source recipe mismatch');
  for(const key of ['runtime','postprocess'])assert.equal(details[key],'NOT_RUN');
  assert.equal(details.admission,'NOT_ADMITTED');assert(bytePin(details.build),'raw terminal requires bound BUILD');
  assert(['RAW_CAPTURED_NOT_FINALIZED','RAW_CAPTURE_PARTIAL','RAW_NOT_CAPTURED'].includes(details.artifactState),'raw artifact state required');
  if(terminal.status==='SUCCESS')assert.equal(details.artifactState,'RAW_CAPTURED_NOT_FINALIZED');
  return details;
}
function controlError(cause,writing=false){
  const known=['TASK_CONTROL_INVALID','TASK_CONTROL_UNSUPPORTED','TASK_CONTROL_BINDING_INCOMPLETE','TASK_WRITE_REQUIRED','TASK_LOCKED','TASK_RECIPE_MISMATCH','TASK_ID_MISMATCH','TASK_PATH_INVALID','TASK_BUDGET_EXCEEDED','TASK_REQUEST_INVALID'];
  const result=Error('任务控制绑定或本地收据未通过；请在本机核对记录，不自动重试。');result.code=known.includes(cause?.code)?cause.code:'TASK_CONTROL_REJECTED';result.possibleSideEffects=result.code==='TASK_CONTROL_UNSUPPORTED'?'NONE':writing?'UNKNOWN_UNTIL_TASK_INSPECTED':'NONE';return result;
}
function controlOptions(value,writeOption=false){
  const keys=writeOption?['root','taskId','write']:['root','taskId'];
  if(!isObject(value)||Object.keys(value).some(k=>!keys.includes(k))||typeof value.root!=='string'||!value.root.trim()||typeof value.taskId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.taskId))fail('TASK_CONTROL_INVALID','任务控制仅接受现有根目录、任务身份及明确写入开关。');
  return {...value,root:path.resolve(value.root)};
}
function lockPresent(root){try{const stat=fs.lstatSync(path.join(root,'.control-lock'));assert(stat.isDirectory()&&!stat.isSymbolicLink());return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function checkedFilePin(file,expected){
  assert(bytePin(expected),'recorded input pin required');
  const before=fs.lstatSync(file);assert(before.isFile()&&!before.isSymbolicLink()&&before.size===expected.bytes&&before.size<=256*1024*1024,'bounded matching input required');
  const hash=createHash('sha256'),fd=fs.openSync(file,'r'),chunk=Buffer.alloc(1024*1024);let bytes=0;
  try{const opened=fs.fstatSync(fd);assert(['size','mtimeMs','ctimeMs','ino','dev'].every(k=>before[k]===opened[k]));let count;while((count=fs.readSync(fd,chunk,0,Math.min(chunk.length,expected.bytes-bytes+1),null))>0){bytes+=count;assert(bytes<=expected.bytes);hash.update(chunk.subarray(0,count));}const after=fs.fstatSync(fd);assert(['size','mtimeMs','ctimeMs','ino','dev'].every(k=>before[k]===after[k]));}finally{fs.closeSync(fd);}
  const named=fs.lstatSync(file);assert(named.isFile()&&!named.isSymbolicLink()&&['size','mtimeMs','ctimeMs','ino','dev'].every(k=>before[k]===named[k]));assert.equal(bytes,expected.bytes);assert.equal(hash.digest('hex'),expected.sha256,'current input differs from task snapshot');
}

/** Dependency injection is for offline adapter tests, never read from a request. */
export function createTaskService(overrides={}){
  const api={readOfficial:readConfiguration,checkOfficial:checkOfficialInputs,planOfficial:conversionPlan,executeOfficial,
    normalizeBuild:normalizeExecutionRequest,planBuild:executionPlan,executeBuild:executeFixedBuild,
    normalizePersistent:normalizePersistentExecutionRequest,planPersistent:persistentExecutionPlan,executePersistent:executePersistentBuild,
    normalizeRaw:normalizeOfficialRawBuildRequest,planRaw:officialRawExecutionPlan,executeRaw:executeOfficialRawBuild,
    preparePair:preparePairTask,executePair:executePairTask,
    prepareCustomPair:prepareCustomPairTask,executeCustomPair:executeCustomPairTask,
    preparePartition:prepareResourcePartitionTask,executePartition:executeResourcePartitionTask,controlPartition:controlResourcePartitionTask,
    prepareExport:prepareProjectPckExport,executeExport:executeProjectPckExport,controlExport:controlProjectPckExport,
    prepareResourceInterfaces:prepareResourceInterfacesTask,executeResourceInterfaces:executeResourceInterfacesTask,controlResourceInterfaces:controlResourceInterfacesTask,
    prepareResourceAssembly:prepareResourceAssemblyTask,executeResourceAssembly:executeResourceAssemblyTask,controlResourceAssembly:controlResourceAssemblyTask,
    prepareResourceInstall:prepareResourceProjectInstall,executeResourceInstall:executeResourceProjectInstall,controlResourceInstall:controlResourceProjectInstall,
    inspectTask,cancelTask:requestCancellation,controlRecipe:getOfficialRecipe,controlRecipeIdentity:getRecipeIdentity,...overrides};

  function prepareControl(file,options){
    const {source,request}=readTaskRequest(file);
    if(isPairAction(request.action))fail('TASK_CONTROL_UNSUPPORTED','配对文件准备没有TASK或中途取消协议；请查看原准备收据与输出文件。');
    const config=document(request.configFile),root=options.root,taskId=options.taskId,documents=[],inputs=[];
    if(request.action==='resource-pck-partition')return api.controlPartition({source,request,config,root,taskId});
    if(request.action==='project-pck-export')return api.controlExport({source,request,config,root,taskId});
    if(request.action==='resource-interfaces-prepare')return api.controlResourceInterfaces({source,request,config,root,taskId});
    if(request.action==='resource-runtime-assemble')return api.controlResourceAssembly({source,request,config,root,taskId});
    if(request.action==='resource-project-install')return api.controlResourceInstall({source,request,config,root,taskId});
    assert(samePath(fs.realpathSync(root),root),'task root must be its actual path');
    function receipt(name,optional=false){try{const value=document(path.join(root,name));documents.push(value);return value.value;}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
    const owner=receipt('TASK.json'),state=api.inspectTask(root,taskId);
    assert.deepEqual(state.owner,owner,'task owner drift');assert.equal(owner.schema,'wxslim-official-task-v1');assert.equal(owner.taskId,taskId);assert(Number.isSafeInteger(owner.budgetBytes)&&owner.budgetBytes>0);
    const terminal=receipt('terminal.json',true),cancellation=receipt('cancel.json',true);assert.deepEqual(state.terminal,terminal);assert.deepEqual(state.cancellation,cancellation);
    if(terminal)assert(['SUCCESS','FAILED','CANCELLED'].includes(terminal.status)&&terminal.taskId===taskId);
    if(cancellation)assert.equal(cancellation.taskId,taskId);
    if(terminal&&cancellation)assert.equal(terminal.status,'CANCELLED','contradictory terminal/cancel receipts');
    let recipeId,profile,sourceRecipe,packageId=null,inputBinding='MISSING_EXECUTION_SNAPSHOT',build=null,taskFailureCode=null,artifactState=null;
    if(request.action==='official-raw-engine-build'){
      const input=api.normalizeRaw(config.value),plan=api.planRaw(input);
      sourceRecipe=plan.sourceRecipe;
      assert(!plan.resume,'special raw resume is not a shared action');
      assert(samePath(input.work,root),'configured raw work differs from selected task');profile=input.profile;recipeId='official-raw:'+plan.planSha256;
      assert.equal(owner.recipeId,recipeId,'raw request/task recipe mismatch');assert.equal(owner.budgetBytes,input.budgetBytes);
      const saved=receipt('inputs/REQUEST.json',true),savedPlan=receipt('inputs/PLAN.json',true);
      if(saved)assert.deepEqual(api.normalizeRaw(saved),input,'request differs from raw execution snapshot');
      if(savedPlan)assert.deepEqual(savedPlan,plan,'plan differs from raw execution snapshot');
      if(saved&&savedPlan)inputBinding='MATCHED_EXECUTION_SNAPSHOT';
      if(terminal){
        const details=rawTerminalDetails(terminal,profile,sourceRecipe);build=details.build;artifactState=details.artifactState;
        const record=receipt('BUILD.json');assert.deepEqual({bytes:fs.statSync(path.join(root,'BUILD.json')).size,sha256:digest(fs.readFileSync(path.join(root,'BUILD.json')))},build);
        assert.equal(record.schema,'wxslim-official-raw-build-v1');assert.equal(record.taskId,taskId);assert.deepEqual(record.plan,plan);
        for(const key of ['runtime','postprocess','phone'])assert.equal(record[key],'NOT_RUN');
        assert.equal(record.admission,'NOT_ADMITTED');assert.equal(record.artifactState,artifactState);taskFailureCode=record.failure?.code??null;
      }
    }else if(request.action==='persistent-dev-engine-build'){
      const input=api.normalizePersistent(config.value),plan=api.planPersistent(input);
      assert(samePath(input.work,root),'configured work differs from selected task');profile=plan.sourcePlan.profile;recipeId='persistent-dev:'+plan.planSha256;
      assert.equal(owner.recipeId,recipeId,'request/task recipe type mismatch');assert.equal(owner.budgetBytes,input.budgetBytes);
      const saved=receipt('inputs/REQUEST.json',true),savedPlan=receipt('inputs/PLAN.json',true);
      if(saved)assert.deepEqual(api.normalizePersistent(saved),input,'request differs from actual build snapshot');
      if(savedPlan)assert.deepEqual(savedPlan,plan,'plan differs from actual build snapshot');
      if(saved&&savedPlan)inputBinding='MATCHED_EXECUTION_SNAPSHOT';
      if(terminal){
        assert.equal(terminal.details?.kind,'PERSISTENT_DEV_ENGINE_BUILD');assert.equal(terminal.details.runtime,'NOT_RUN');assert.equal(terminal.details.deploymentAdmission,'NOT_ADMITTED');
        build=terminal.details.build;assert(bytePin(build),'persistent terminal requires bound BUILD');
        const record=receipt('BUILD.json');assert.deepEqual({bytes:fs.statSync(path.join(root,'BUILD.json')).size,sha256:digest(fs.readFileSync(path.join(root,'BUILD.json')))},build);
        assert.equal(record.schema,'wxslim-persistent-build-v1');assert.equal(record.taskId,taskId);assert.deepEqual(record.plan,plan);taskFailureCode=record.failure?.code??null;
      }
    }else if(request.action==='fixed-engine-build'){
      const input=api.normalizeBuild(config.value,path.dirname(config.file)),plan=api.planBuild(input);
      assert(samePath(input.inputs.work,root),'configured work differs from selected task');profile=input.inputs.profile;recipeId='fixed-engine:'+plan.semanticRecipeSha256;
      assert.equal(owner.recipeId,recipeId,'request/task recipe type mismatch');assert.equal(owner.budgetBytes,input.budgetBytes);
      const saved=receipt('inputs/REQUEST.json',true);
      if(saved){assert.deepEqual(api.normalizeBuild(saved,path.join(root,'inputs')),input,'request differs from actual build snapshot');inputBinding='MATCHED_EXECUTION_SNAPSHOT';}
      if(terminal){assert.equal(terminal.details?.kind,'FIXED_ENGINE_BUILD');assert.equal(terminal.details.profile,profile);build=terminal.details.build??null;if(terminal.status==='SUCCESS')assert(bytePin(build),'successful build requires bound BUILD');if(build){assert(bytePin(build));const record=receipt('BUILD.json');assert.equal(digest(fs.readFileSync(path.join(root,'BUILD.json'))),build.sha256);assert.equal(fs.statSync(path.join(root,'BUILD.json')).size,build.bytes);assert.equal(record.schema,'wxslim-fixed-build-v1');assert.equal(record.taskId,taskId);assert.equal(record.profileId,profile);assert.deepEqual(record.plan.request,input,'BUILD/request mismatch');taskFailureCode=record.failure?.code??null;}}
    }else{
      const input=api.readOfficial(config.file);assert(samePath(input.output,root),'configured output differs from selected task');profile=input.engineProfile??'full';
      const recipe=api.controlRecipe(profile),identity=api.controlRecipeIdentity(profile);recipeId=identity.recipeId;assert.equal(owner.recipeId,recipeId,'request/task recipe type mismatch');
      const plan=receipt('PLAN.private.json',true),preflight=receipt('PREFLIGHT.json',true);
      if(plan){assert.equal(plan.schema,'wxslim-official-plan-v1');assert.equal(plan.recipeId,recipeId);assert.equal(plan.recipeSha256,identity.recipeSha256);assert(samePath(plan.taskRoot,root)&&samePath(plan.convertedOutput,path.join(root,'converted')));assert.deepEqual(plan.options,input.options);assert.equal(plan.engineContract?.profile,profile);assert.deepEqual(plan.projectUsage,input.projectUsage??null);packageId=plan.expectedPackageId;assert(typeof packageId==='string'&&/^wxslim-[a-f0-9]{20}$/.test(packageId));
        for(const key of ['js','wasm','pck','interfaces','transformer',...(input.upstreamSource?['upstreamSource']:[])]){checkedFilePin(input[key],plan.inputs[key]);inputs.push({file:input[key],pin:plan.inputs[key]});}assert.equal(plan.toolchain?.transformerSha256,recipe.transformer.sha256);assert.equal(plan.inputs.transformer.sha256,recipe.transformer.sha256);
        if(preflight){assert.equal(preflight.schema,'wxslim-official-input-summary-v1');assert.equal(preflight.recipeId,recipeId);assert.equal(preflight.recipeSha256,identity.recipeSha256);assert.equal(preflight.packageId,packageId);assert.deepEqual(preflight.inputs,plan.inputs);inputBinding='MATCHED_EXECUTION_SNAPSHOT';}}
      else assert(!preflight,'preflight without matching plan');
      if(terminal?.status==='SUCCESS'){assert.equal(terminal.details?.packageId,packageId);const audit=receipt('AUDIT.json');assert.equal(digest(fs.readFileSync(path.join(root,'AUDIT.json'))),terminal.details.auditSha256);assert.equal(audit.status,'PASS_STATIC_ONLY');assert.equal(audit.packageId,packageId);}
      taskFailureCode=terminal?.details?.code??null;
    }
    const warnings=[];if(lockPresent(root))warnings.push({code:'TASK_CONTROL_LOCK_PRESENT',message:'控制锁存在；不据此认定进程存活，不自动接管或移除锁。'});
    if(state.logicalBytes>owner.budgetBytes)warnings.push({code:'TASK_BUDGET_EXCEEDED',message:'已观测逻辑大小超过原任务预算；不扩大预算。'});
    const stable=()=>{stableDocument(source);stableDocument(config);for(const value of documents)stableDocument(value);for(const value of inputs)checkedFilePin(value.file,value.pin);};
    stable();
    const output={schema:'wxslim-task-status-v1',action:request.action,taskId,recipeId,profile,packageId,requestSha256:source.sha256,configurationSha256:config.sha256,
      status:terminal?.status??(cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),terminalPresent:!!terminal,cancellationRequested:!!cancellation,inputBinding,
      logicalBytes:state.logicalBytes,budgetBytes:owner.budgetBytes,build,taskFailureCode:/^[A-Z][A-Z0-9_]{0,95}$/.test(taskFailureCode??'')?taskFailureCode:null,warnings,
      progress:readTaskEventProgress(root,taskId),
      processLiveness:'NOT_OBSERVED',admission:['persistent-dev-engine-build','official-raw-engine-build'].includes(request.action)?'NOT_ADMITTED':'NOT_REAUDITED',engineRun:'NOT_INFERRED',phone:'NOT_RUN',visual:'NOT_VERIFIED',
      ...(request.action==='official-raw-engine-build'?{sourceRecipe:sourceRecipe??null,rawBuildOnly:true,artifactState,postprocess:'NOT_RUN'}:{}),
      ...developmentSummary(profile),
      scope:'Existing local receipts and current request binding only; missing terminal is not evidence of a running process. No new execution or artifact acceptance.'};
    return {output,stable,root,taskId,recipeId};
  }

  function prepare(file){
    const {source,request}=readTaskRequest(file),config=document(request.configFile);
    let input,before,plan,packageId=null,profile,scope={...request.scope},capabilities;
    if(request.action==='custom-pair-prepare'){
      // Existing actions retain synchronous plans. Only authenticated raw-task
      // rereads need an asynchronous plan, awaited by the same CLI/UI protocol.
      return Promise.resolve(api.prepareCustomPair(config.file)).then(pair=>{
        ({input,before,plan,profile}=pair);assert.equal(profile,CUSTOM_PAIR_PROFILE);
        assert.equal(before.configuration.sha256,config.sha256,'custom pair/config binding changed');
        scope={};capabilities=['engine-official-pair-prepare'];return finish();
      });
    }else if(request.action==='resource-project-install'){
      ({input,before,plan,profile}=api.prepareResourceInstall(config.file));
      assert.equal(before.configuration.sha256,config.sha256,'resource install/config binding changed');
      scope={};capabilities=['resource-subpackages'];
    }else if(request.action==='resource-runtime-assemble'){
      ({input,before,plan,profile}=api.prepareResourceAssembly(config.file));
      assert.equal(before.configuration.sha256,config.sha256,'resource assembly/config binding changed');
      packageId=plan.packageId;
      assert(typeof packageId==='string'&&/^wxslim-[a-f0-9]{20}$/.test(packageId),'resource assembly requires audited official manifest identity');
      // This ID already binds the generated interfaces and all PCK pins. It
      // identifies bytes, not inherited device acceptance of the new assembly.
      scope={};capabilities=['resource-subpackages'];
    }else if(request.action==='resource-interfaces-prepare'){
      ({input,before,plan,profile}=api.prepareResourceInterfaces(config.file));
      assert.equal(before.configuration.sha256,config.sha256,'resource interfaces/config binding changed');
      scope={};capabilities=['resource-subpackages'];
    }else if(request.action==='project-pck-export'){
      ({input,before,plan,profile}=api.prepareExport(config.file));
      assert.equal(before.configuration.sha256,config.sha256,'export/config binding changed');
      scope={};capabilities=['project-pck-export'];
    }else if(request.action==='resource-pck-partition'){
      ({input,before,plan,profile}=api.preparePartition(config.file));
      assert.equal(before.configuration.sha256,config.sha256,'partition/config binding changed');
      scope={};capabilities=['resource-subpackages'];
    }else if(request.action==='official-pair-prepare'){
      const pair=api.preparePair(config.file);({input,before,plan,profile}=pair);
      assert(isOfficialC050Profile(profile));assert.equal(before.configuration.sha256,config.sha256,'pair/config binding changed');
      scope={};capabilities=['engine-official-pair-prepare'];
    }else if(request.action==='official-convert'){
      input=api.readOfficial(config.file);before=api.checkOfficial(input);plan=api.planOfficial(input,before);
      packageId=before.expectedManifest.packageVersion;profile=before.engineContract.profile;
      getOfficialRecipe(profile); // A stubbed preflight cannot introduce an unknown profile.
      if(scope.packageId!==undefined&&scope.packageId!==packageId)fail('TASK_SCOPE_MISMATCH','请求证据的包身份与本次实际输入不符。');
      if(scope.backend!==undefined&&scope.backend!==input.options.renderMode)fail('TASK_SCOPE_MISMATCH','请求证据的后端与实际配置不符。');
      scope={...scope,packageId,backend:input.options.renderMode};
      capabilities=['official-convert',input.options.renderMode==='glx'?'render-glx':'render-webgl'];
      if(input.options.loginCode===true)capabilities.push('login-code');
      if(isConservativeEngineProfile(profile)&&input.options.renderMode==='glx')capabilities.push('trim-fixed-glx');
    }else if(request.action==='official-raw-engine-build'){
      input=api.normalizeRaw(config.value);plan=api.planRaw(input);profile=input.profile;
      assert(!plan.resume,'special raw resume is not a shared action');
      scope={};capabilities=['engine-build-official-raw-dev'];
    }else if(request.action==='persistent-dev-engine-build'){
      input=api.normalizePersistent(config.value);plan=api.planPersistent(input);profile=plan.sourcePlan.profile;
      scope={};capabilities=['engine-build-persistent-dev'];
    }else{
      input=api.normalizeBuild(config.value,path.dirname(config.file));plan=api.planBuild(input);profile=input.inputs.profile;
      // Rebuilding does not create the same observed package by declaration.
      // This capability has no device observations and cannot borrow an old ID.
      scope={};capabilities=['engine-build-fixed'];
      if(isConservativeEngineProfile(profile))capabilities.push('trim-fixed-glx');
    }
    return finish();
    function finish(){
    const assessments=capabilities.map(capability=>assessCapability({capability,purpose:request.purpose,scope}));
    const buildUnobserved=['fixed-engine-build','persistent-dev-engine-build','official-raw-engine-build'].includes(request.action)&&request.purpose==='supported-use';
    const developmentPurposeDenied=(isDevelopmentEngineProfile(profile)||profile===CUSTOM_PAIR_PROFILE||['resource-pck-partition','project-pck-export','resource-interfaces-prepare','resource-runtime-assemble','resource-project-install'].includes(request.action))&&!['inspect','development-test'].includes(request.purpose);
    const eligible=request.purpose!=='inspect'&&!buildUnobserved&&!developmentPurposeDenied&&assessments.every(a=>a.eligible);
    stableDocument(source);stableDocument(config);
    const output={schema:'wxslim-task-plan-v1',status:'PLANNED_NOT_EXECUTED',action:request.action,purpose:request.purpose,
      requestSha256:source.sha256,configurationSha256:config.sha256,profile,packageId,
      identityScope:request.action==='resource-runtime-assemble'?'CONVERTED_RESOURCE_INPUTS_NOT_DEVICE_ACCEPTANCE':request.action==='resource-interfaces-prepare'?'RESOURCE_INTERFACE_INPUTS_NOT_GAME_PACKAGE':request.action==='project-pck-export'?'PROJECT_SNAPSHOT_NOT_EXPORTED_OR_GAME_PACKAGE':request.action==='resource-pck-partition'?'EXPORTED_PCK_FILES_NOT_GAME_PACKAGE':request.action==='official-pair-prepare'?'FIXED_ENGINE_PAIR_NOT_GAME_PACKAGE':packageId?'CURRENT_INPUT_CANDIDATE':'NEW_BUILD_NOT_YET_IDENTIFIED',
      inputValidation:request.action==='resource-runtime-assemble'?'OFFICIAL_CONVERTED_PAIR_BOOT_AND_RESOURCE_BYTES_CHECKED':request.action==='resource-interfaces-prepare'?'ACTUAL_PCKS_ENGINE_HASHES_AND_GENERATOR_CHECKED':request.action==='project-pck-export'?'FIXED_EDITOR_PROJECT_AND_SELECTED_PRESET_CHECKED':request.action==='resource-pck-partition'?'ACTUAL_PCK_BYTES_AND_EXPLICIT_OWNERSHIP_CHECKED':request.action==='official-pair-prepare'?'ACTUAL_RAW_PAIR_AND_DERIVATION_CHECKED':packageId?'ACTUAL_INPUT_PAIR_AND_SNAPSHOT_CHECKED':'SEMANTIC_PLAN_ONLY_EXECUTOR_DEPENDENCY_AND_RESOURCE_CHECKS_PENDING',
      assessments,eligible,reason:request.purpose==='inspect'?'INSPECTION_ONLY':developmentPurposeDenied?'DEVELOPMENT_PROFILE_PURPOSE_DENIED':buildUnobserved?'NEW_BUILD_REQUIRES_ACCEPTANCE':eligible?'ELIGIBLE_WITH_EXPLICIT_WRITE':'CAPABILITY_GATE_DENIED',
      executionAuthorized:false,plan,phone:'NOT_RUN',visual:'NOT_VERIFIED',
      ...(request.action==='persistent-dev-engine-build'?{admission:'NOT_ADMITTED'}:{}),
      ...(request.action==='official-raw-engine-build'?{sourceRecipe:plan.sourceRecipe??null,admission:'NOT_ADMITTED',rawBuildOnly:true,postprocess:'NOT_RUN'}:{}),
      ...(isPairAction(request.action)?{executionMode:'bounded-files'}:{}),
      ...(request.action==='custom-pair-prepare'?{identityScope:'CUSTOM_RAW_BUILD_AND_HOST_NOT_GAME_PACKAGE',inputValidation:before.sourceCheck?.retainedEvidence?'RETAINED_FAILED_TASK_AND_DYNAMIC_PAIR_CHECKED':'COMPLETED_CUSTOM_TASK_REAUDIT_AND_DYNAMIC_PAIR_CHECKED'}:{}),
      ...(request.action==='resource-pck-partition'?{admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED'}:{}),
      ...(request.action==='resource-interfaces-prepare'?{admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED',receiverInBootPck:'NOT_PROVEN',officialConversion:'NOT_RUN'}:{}),
      ...(request.action==='resource-runtime-assemble'?{admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED',receiverInBootPck:'NOT_PROVEN',conversionPerformed:false}:{}),
      ...(request.action==='resource-project-install'?{identityScope:'PROJECT_SOURCE_WIRING_NOT_EXPORTED_GAME',inputValidation:'EXACT_RUNTIME_SCRIPTS_AND_AUTOLOAD_INSERTION_CHECKED',admission:'NOT_ADMITTED',projectWrites:'EXPLICITLY_ACKNOWLEDGED',export:'NOT_RUN',cancellation:'BETWEEN_WRITES_NO_ROLLBACK'}:{}),
      ...(request.action==='project-pck-export'?{admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED',importWrites:'EXPLICITLY_ACKNOWLEDGED',cancellation:'WAIT_FOR_CHILD_CLOSE_NO_ROLLBACK'}:{}),
      ...developmentSummary(profile),
      privacy:'Plan contains local paths; do not publish it without redaction.',
      control:isPairAction(request.action)?{supported:false,statusSupported:false,cancelSupported:false,reason:'BOUNDED_FILE_PREPARATION_NO_TASK_CONTROLLER'}:{command:'task',arguments:['status REQUEST.json TASK_ROOT TASK_ID','cancel REQUEST.json TASK_ROOT TASK_ID --write'],
        policy:'Existing receipt/cancellation APIs; no new controller, forced termination or automatic retry.'}};
    return {source,config,request,input,before,output};
    }
  }
  function withConversionRecipe(file, action, includeAssembly=true) {
    const {request}=readTaskRequest(file);
    if(includeAssembly&&request.action==='resource-runtime-assemble'){
      const assembly=document(request.configFile);
      if(typeof assembly.value.officialConfigFile==='string'){
        const configFile=path.resolve(path.dirname(assembly.file),assembly.value.officialConfigFile);
        return withOfficialConfiguration(configFile,action);
      }
    }
    return request.action==='official-convert'?withOfficialConfiguration(request.configFile,action):action();
  }
  const service={
    list(){return {schema:'wxslim-task-actions-v1',actions:Object.entries(actions).map(([action,v])=>({action,
      assessment:assessCapability({capability:v.capability,purpose:'development-test'}),requiresExplicitWrite:true,
      ...(isPairAction(action)?{executionMode:'bounded-files',control:{statusSupported:false,cancelSupported:false}}:{})})),
      limitations:['Official conversion, engine builds, bounded official-pair preparation, explicit project export and PCK partition tasks are wired.','Project export invokes the fixed editor and may write import caches; normal export plugins may run. No project copy or automatic export.','PCK partition checks explicit ownership and bytes, not project export completeness or dependency closure.','Raw builds exclude final JS preparation, special resume, conversion and runtime admission.','Bounded pair preparation has no durable task ID, stage stream or mid-operation cancellation.','No upload, device control or automatic package acceptance.']};},
    plan(file){const state=prepare(file);return state?.then?state.then(value=>value.output):state.output;},
    status(file,options){try{return prepareControl(file,controlOptions(options)).output;}catch(e){throw controlError(e);}},
    cancel(file,options){
      try{
      const control=controlOptions(options,true);if(control.write!==true)fail('TASK_WRITE_REQUIRED','取消需要明确的 --write，并绑定已有任务收据。');
      const before=prepareControl(file,control);if(before.output.inputBinding!=='MATCHED_EXECUTION_SNAPSHOT')fail('TASK_CONTROL_BINDING_INCOMPLETE','执行输入快照尚不可核对；拒绝取消未完整绑定的任务。');
      before.stable();const result=api.cancelTask(before.root,before.taskId,{expectedRecipeId:before.recipeId});
      // Only cancel.json/terminal may legitimately appear during this API call.
      // Existing documents and configured inputs must remain byte-identical.
      before.stable();const after=prepareControl(file,control),state=after.output;
      assert.equal(state.recipeId,before.recipeId);assert.equal(state.taskId,before.taskId);
      if(result.alreadyEnded)assert(state.terminalPresent&&result.terminal?.status===state.status);else assert(result.accepted===true&&state.cancellationRequested,'cancellation must be locally durable');
      return {...state,schema:'wxslim-task-cancel-v1',cancel:{accepted:result.accepted===true,duplicate:result.duplicate===true,alreadyEnded:result.alreadyEnded===true},...(result.controlLockWarning?{controlLockWarning:warning(result.controlLockWarning)}:{})};
      }catch(e){throw controlError(e,options?.write===true);}
    },
    async execute(file,{write=false,expectedPlanSha256}={}){
      if(write!==true)fail('TASK_WRITE_REQUIRED','执行需要明确的 --write，且输出目录须已获得用户授权。');
      if(expectedPlanSha256!==undefined&&(typeof expectedPlanSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedPlanSha256)))fail('TASK_PLAN_INVALID','计划摘要格式无效。');
      // A saved plan is descriptive, not an execution token. Re-read everything.
      const state=await prepare(file),{request,input,before,output}=state;
      if(!output.eligible)fail('TASK_CAPABILITY_DENIED','能力或用途门禁拒绝本次任务；未启动执行器。');
      if(expectedPlanSha256!==undefined&&taskPlanIdentity(output)!==expectedPlanSha256)fail('TASK_PLAN_CHANGED','当前计划与已确认计划不同；未启动执行器。');
      stableDocument(state.source);stableDocument(state.config);
      if(isPairAction(request.action)){
        const pair=request.action==='custom-pair-prepare'?await api.executeCustomPair(input,before,{writeAuthorized:true}):await api.executePair(input,before);
        assert.equal(pair.status,'SUCCESS');assert.equal(pair.executionMode,'bounded-files');assert.equal(pair.taskId,null);
        assert.equal(pair.artifactState,'PREPARED_NOT_ADMITTED');assert.equal(pair.admission,'NOT_ADMITTED');assert.equal(pair.profile,output.profile);
        if(request.action==='custom-pair-prepare'){
          assert.equal(pair.sourceTaskId,before.sourceCheck.taskId);
          for(const key of ['wasmCopied','bridgeWritten','hostInstalled','converterAccepted'])assert.equal(pair[key],false);
        }
        return {...pair,schema:'wxslim-task-result-v1',action:request.action,requestSha256:output.requestSha256,configurationSha256:output.configurationSha256,
          ...developmentSummary(output.profile),recordScope:'Bounded file preparation receipt and actual output pins only; no TASK/events/terminal or process controller.'};
      }
      let result,summary;
      if(request.action==='resource-project-install'){
        result=await api.executeResourceInstall(input,before,{writeAuthorized:true});
        assert.equal(result.terminal?.status,result.status);assert.equal(result.terminal?.details?.kind,'RESOURCE_PROJECT_INSTALL');
        assert.equal(result.terminal.details.admission,'NOT_ADMITTED');assert.equal(result.terminal.details.engineRun,'NOT_RUN');
        summary={packageId:null,profile:output.profile,audit:result.audit,elapsedMs:result.elapsedMs,logicalBytes:result.logicalBytes,
          projectMayHaveChanged:result.projectMayHaveChanged,createdScriptAttempts:result.createdScriptAttempts,
          admission:'NOT_ADMITTED',export:'NOT_RUN',currentProjectState:'REQUIRES_EXPORTED_BOOT_CHECK',rollbackPerformed:false};
      }else if(request.action==='resource-runtime-assemble'){
        result=await api.executeResourceAssembly(input,before,{writeAuthorized:true});
        assert.equal(result.terminal?.status,result.status);assert.equal(result.terminal?.details?.kind,'RESOURCE_RUNTIME_ASSEMBLE');
        assert.equal(result.terminal.details.admission,'NOT_ADMITTED');assert.equal(result.terminal.details.engineRun,'NOT_RUN');
        summary={packageId:output.packageId,profile:output.profile,audit:result.audit,elapsedMs:result.elapsedMs,logicalBytes:result.logicalBytes,
          phases:result.phases,admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED',receiverInBootPck:'NOT_PROVEN',conversionPerformed:false};
      }else if(request.action==='resource-interfaces-prepare'){
        result=await api.executeResourceInterfaces(input,before,{writeAuthorized:true});
        assert.equal(result.terminal?.status,result.status);assert.equal(result.terminal?.details?.kind,'RESOURCE_INTERFACES_PREPARE');
        assert.equal(result.terminal.details.admission,'NOT_ADMITTED');assert.equal(result.terminal.details.engineRun,'NOT_RUN');
        summary={packageId:null,profile:output.profile,audit:result.audit,elapsedMs:result.elapsedMs,logicalBytes:result.logicalBytes,
          phases:result.phases,admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED',receiverInBootPck:'NOT_PROVEN',officialConversion:'NOT_RUN'};
      }else if(request.action==='project-pck-export'){
        result=await api.executeExport(input,before,{writeAuthorized:true});
        assert.equal(result.terminal?.status,result.status);assert.equal(result.terminal?.details?.kind,'PROJECT_PCK_EXPORT');
        assert.equal(result.terminal.details.admission,'NOT_ADMITTED');assert.equal(result.terminal.details.engineRun,'NOT_RUN');
        summary={packageId:null,profile:output.profile,audit:result.audit,elapsedMs:result.elapsedMs,logicalBytes:result.logicalBytes,
          phases:result.phases,admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED'};
        const code=result.terminal.details.code;
        if(result.status==='FAILED' && /^PCK_EXPORT_[A-Z_]{1,80}$/.test(code)) summary.failureCode=code;
      }else if(request.action==='resource-pck-partition'){
        result=await api.executePartition(input,before,{writeAuthorized:true});
        assert.equal(result.terminal?.status,result.status);assert.equal(result.terminal?.details?.kind,'RESOURCE_PCK_PARTITION');
        assert.equal(result.terminal.details.admission,'NOT_ADMITTED');assert.equal(result.terminal.details.engineRun,'NOT_RUN');
        summary={packageId:null,profile:output.profile,audit:result.audit,elapsedMs:result.elapsedMs,logicalBytes:result.logicalBytes,
          phases:result.phases,admission:'NOT_ADMITTED',dependencyClosure:'NOT_INFERRED'};
      }else if(request.action==='official-convert'){
        result=await api.executeOfficial(input,{writeAuthorized:true,expectedPreflight:{packageId:output.packageId,snapshot:before.snapshot}});
        assert.equal(result.schema,'wxslim-official-execution-summary-v1');
        assert.equal(result.packageId,output.packageId,'executor candidate mismatch');
        summary={packageId:result.packageId,engineContract:result.engineContract,elapsedMs:result.elapsedMs,logicalBytes:result.logicalBytes,
          admission:result.status==='SUCCESS'?'CONVERSION_AND_STATIC_AUDIT_ONLY':'NOT_ADMITTED'};
      }else if(request.action==='official-raw-engine-build'){
        result=await api.executeRaw(input,{write:true});
        assert.equal(result.terminal?.status,result.status,'matching raw durable terminal required');
        const details=rawTerminalDetails(result.terminal,output.profile,output.plan.sourceRecipe);
        summary={packageId:null,profile:output.profile,sourceRecipe:details.sourceRecipe??null,build:details.build,rawBuildOnly:true,artifactState:details.artifactState,postprocess:'NOT_RUN',
          phases:result.phases.map(p=>({name:p.name,status:p.status,wallMs:p.wallMs})),admission:'NOT_ADMITTED'};
      }else if(request.action==='persistent-dev-engine-build'){
        result=await api.executePersistent(input,{write:true});
        assert.equal(result.terminal?.status,result.status,'matching durable terminal required');
        assert.equal(result.terminal?.details?.kind,'PERSISTENT_DEV_ENGINE_BUILD','persistent engine terminal required');
        assert.equal(result.terminal.details.runtime,'NOT_RUN');assert.equal(result.terminal.details.deploymentAdmission,'NOT_ADMITTED');
        assert(bytePin(result.terminal.details.build),'persistent terminal requires bound BUILD');
        summary={packageId:null,profile:output.profile,build:result.terminal.details.build,
          phases:result.phases.map(p=>({name:p.name,status:p.status,wallMs:p.wallMs})),admission:'NOT_ADMITTED'};
      }else{
        result=await api.executeBuild(input,{write:true});
        assert.equal(result.terminal?.status,result.status,'matching durable terminal required');
        assert.equal(result.terminal?.details?.kind,'FIXED_ENGINE_BUILD','fixed engine terminal required');
        assert.equal(result.terminal.details.profile,output.profile,'executor profile mismatch');
        summary={packageId:null,profile:result.terminal.details.profile,build:result.terminal.details.build,
          phases:result.phases.map(p=>({name:p.name,status:p.status,wallMs:p.wallMs})),
          admission:result.status==='SUCCESS'?'REQUIRES_INDEPENDENT_AUDIT':'NOT_ADMITTED'};
      }
      assert(['SUCCESS','FAILED','CANCELLED'].includes(result.status),'executor terminal status required');
      const taskId=request.action==='official-convert'?result.taskId:result.terminal.taskId;
      assert(typeof taskId==='string'&&taskId,'task identity required');
      const lockWarning=result.controlLockWarning??result.terminal?.controlLockWarning;
      return {schema:'wxslim-task-result-v1',action:request.action,status:result.status,taskId,
        requestSha256:output.requestSha256,configurationSha256:output.configurationSha256,
        ...summary,...(lockWarning?{controlLockWarning:warning(lockWarning)}:{}),
        ...developmentSummary(output.profile),
        engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
        recordScope:'Task terminal and detailed errors are in the existing executor directory. This response does not add a second durable receipt.'};
    },
  };
  return Object.freeze({...service,
    plan:file=>withConversionRecipe(file,()=>service.plan(file)),
    async execute(file,options) {
      if(options?.write!==true) return service.execute(file,options);
      return withConversionRecipe(file,()=>service.execute(file,options));
    },
    status:(file,options)=>controlWithRecipe('status',file,options),
    cancel:(file,options)=>controlWithRecipe('cancel',file,options),
  });
  function controlWithRecipe(method,file,options) {
    const writing=method==='cancel'&&options?.write===true;
    try {
      const result=withConversionRecipe(file,()=>service[method](file,options),false);
      return result?.then?result.catch(e=>{throw controlError(e,writing);}):result;
    } catch(e) {throw controlError(e,writing);}
  }
}

export async function runTaskCli(args,{service=createTaskService(),stdout=process.stdout,stderr=process.stderr}={}){
  let attemptingWrite=false;
  try{
    assert(Array.isArray(args)&&args.every(a=>typeof a==='string'));
    let result;
    if(args.length===1&&args[0]==='list')result=service.list();
    else if(args.length===2&&args[0]==='plan')result=await service.plan(args[1]);
    else if((args.length===3||args.length===5)&&args[0]==='execute'&&args[2]==='--write'&&(args.length===3||args[3]==='--expected-plan-sha256'&&/^[a-f0-9]{64}$/.test(args[4]))){
      attemptingWrite=true;result=await service.execute(args[1],{write:true,...(args.length===5?{expectedPlanSha256:args[4]}:{})});
    }else if(args.length===4&&args[0]==='status')result=await service.status(args[1],{root:args[2],taskId:args[3]});
    else if(args.length===5&&args[0]==='cancel'&&args[4]==='--write'){
      attemptingWrite=true;result=await service.cancel(args[1],{root:args[2],taskId:args[3],write:true});
    }else fail('TASK_ARGUMENT_INVALID','task list | plan REQUEST.json | execute REQUEST.json --write | status REQUEST.json ROOT ID | cancel REQUEST.json ROOT ID --write');
    stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.schema==='wxslim-task-cancel-v1'&&result.cancel?.accepted===true)return 0;
    if(['wxslim-task-status-v1','wxslim-task-cancel-v1'].includes(result.schema))return result.status==='SUCCESS'?0:result.status==='CANCELLED'?2:1;
    return result.schema==='wxslim-task-plan-v1'&&!result.eligible&&result.purpose!=='inspect'?2:
      result.schema==='wxslim-task-result-v1'&&result.status!=='SUCCESS'?(result.status==='CANCELLED'?2:1):0;
  }catch(e){
    const known=['TASK_REQUEST_INVALID','TASK_SCOPE_MISMATCH','TASK_WRITE_REQUIRED','TASK_CAPABILITY_DENIED','TASK_PLAN_INVALID','TASK_PLAN_CHANGED','TASK_ARGUMENT_INVALID','TASK_CONTROL_INVALID','TASK_CONTROL_UNSUPPORTED','TASK_CONTROL_BINDING_INCOMPLETE','TASK_LOCKED','TASK_RECIPE_MISMATCH','TASK_ID_MISMATCH','TASK_PATH_INVALID','TASK_BUDGET_EXCEEDED','TASK_PAIR_PREPARATION_FAILED'];
    stderr.write(JSON.stringify({schema:'wxslim-task-error-v1',status:'FAILED',code:known.includes(e.code)?e.code:'TASK_REJECTED',
      message:known.includes(e.code)?'任务请求、身份、快照或控制收据未通过；请核对本地记录，不自动重试。':'任务或配套核验未通过，请查本地配置和任务日志；不会自动重试。',
      ...(e.code==='TASK_PAIR_PREPARATION_FAILED'?{filePreparation:{reason:/^PAIR_[A-Z_]{1,80}$/.test(e.reason??'')?e.reason:'PAIR_PREPARE_UNKNOWN',
        created:Object.fromEntries(['js','receipt'].map(k=>[k,typeof e.created?.[k]==='boolean'?e.created[k]:null])),
        attempted:Object.fromEntries(['js','receipt'].map(k=>[k,typeof e.attempted?.[k]==='boolean'?e.attempted[k]:null]))}}:{}),
      possibleSideEffects:e.code==='TASK_CONTROL_UNSUPPORTED'?'NONE':e.code==='TASK_PAIR_PREPARATION_FAILED'&&['NONE','PARTIAL_OUTPUT_POSSIBLE','UNKNOWN_UNTIL_OUTPUTS_INSPECTED'].includes(e.possibleSideEffects)?e.possibleSideEffects:attemptingWrite?'UNKNOWN_UNTIL_TASK_INSPECTED':'NONE',phone:'NOT_RUN',visual:'NOT_VERIFIED'})+'\n');
    return 1;
  }
}
