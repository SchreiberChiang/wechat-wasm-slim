// Local transport only: task-core/CLI own admission, execution and cancellation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {openWeChatProject} from './open-project.mjs';
import {STATUS} from '../../lib/capabilities.mjs';
import {prepareAction,confirmAction,isActionAdmission,claimConfirmation,observeExecution,bindObservedTask,taskRootFromPlan} from './action-confirmation.mjs';
import {buildExportRequestDraft} from './export-request-form.mjs';
import {buildRawBuildRequestDraft} from './raw-build-request-form.mjs';
import {prepareOfficialFormDraft} from './official-convert-request-form.mjs';
import {decodePayloadArgument} from './payload-wire.mjs';
import {validateExecutionSelectionPayload,deriveExecutionSelection} from './execution-selection.mjs';
import {buildResourcePartitionRequestDraft} from './resource-request-form.mjs';
import {readResourceInventory,readResourceDeclaration} from './resource-form-io.mjs';
import {buildResourceRuntimeDraft,resourceRuntimeNextInputs} from './resource-runtime-form.mjs';
import {readPartitionCatalog,prepareRuntimeResourceConfig} from './resource-config-form.mjs';
import {inspectResourcePlan} from '../../lib/resource-pack-plan.mjs';
import {inspectResourceGameBoot} from '../../lib/resource-game-boot-audit.mjs';
import {inspectResourceProjectSource} from '../../lib/resource-project-source-plan.mjs';

export const home = path.dirname(fileURLToPath(import.meta.url));
const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_DIRECTORY = 16 * 1024 * 1024; // leaves 4 MiB for editor import/cache and logs
const configKeys = ['schema','nodeExecutable','repositoryRoot','editorExecutable','requestFile','taskRoot','taskId'];
const operations = new Set(['list','capabilities','plan','status','execute','cancel']);
const localOperations = new Set([...operations,'open-project','prepare-export-request','prepare-raw-build-request','prepare-official-request','resource-inventory','prepare-resource-request','resource-partition-outputs','prepare-resource-config','resource-boot-check','resource-source-plan','prepare-resource-interfaces-request','prepare-resource-assembly-request','prepare-resource-install-request','save-selection','select-execution','prepare-execute','prepare-cancel','observe-execution','prepare-active-cancel']);
function requireThat(ok) { if (!ok) throw Error('LOCAL_PLUGIN_CONTRACT_REJECTED'); }
function ordinary(file,io=fs) { const s=io.lstatSync(file);requireThat(s.isFile()&&!s.isSymbolicLink());return s; }
export function loadConfig(file) {
  const state = path.dirname(path.resolve(file));
  requireThat(path.basename(file) === 'local-config.json');
  if (state !== home) {
    const ownerFile = path.join(state, 'project.json');
    ordinary(ownerFile);
    const owner = JSON.parse(fs.readFileSync(ownerFile,'utf8'));
    requireThat(typeof owner.project === 'string' && path.isAbsolute(owner.project));
    const project = fs.realpathSync(owner.project);
    const stateLocator = path.join(project,'.godot','wxslim','state.path');
    ordinary(stateLocator);
    requireThat(path.relative(state,fs.readFileSync(stateLocator,'utf8').trim()) === '');
    requireThat(path.relative(state,fs.realpathSync(state)) === '');
    const locator = path.join(project, 'addons', 'wxslim_readonly', 'workbench.path');
    ordinary(locator);
    requireThat(path.relative(home, fs.readFileSync(locator, 'utf8').trim()) === '');
  }
  requireThat(ordinary(file).size<=16384);
  const c=JSON.parse(fs.readFileSync(file,'utf8'));
  requireThat(c&&Object.getPrototypeOf(c)===Object.prototype&&Object.keys(c).length===configKeys.length&&configKeys.every(k=>Object.hasOwn(c,k)));
  requireThat(c.schema==='wxslim-local-plugin-config-v1');
  for(const k of configKeys.slice(1))requireThat(typeof c[k]==='string'&&c[k].length<=4096&&!c[k].includes('\0'));
  for(const k of ['nodeExecutable','repositoryRoot','editorExecutable'])requireThat(path.isAbsolute(c[k]));
  requireThat(path.resolve(c.repositoryRoot)===path.resolve(home,'../..'));
  requireThat(/^node(?:\.exe)?$/i.test(path.basename(c.nodeExecutable)));
  ordinary(c.nodeExecutable);ordinary(path.join(c.repositoryRoot,'wxslim.mjs'));
  for(const k of ['requestFile','taskRoot'])requireThat(c[k]===''||path.isAbsolute(c[k]));
  return c;
}
export function selectionConfiguration(current, selection, io=fs) {
  requireThat(selection&&Object.getPrototypeOf(selection)===Object.prototype&&Object.keys(selection).length===3&&['requestFile','taskRoot','taskId'].every(k=>typeof selection[k]==='string'&&selection[k].length<=4096&&!selection[k].includes('\0')));
  requireThat(path.isAbsolute(selection.requestFile));
  ordinary(selection.requestFile,io);
  if(selection.taskRoot!==''||selection.taskId!=='') {
    requireThat(path.isAbsolute(selection.taskRoot)&&/^[A-Za-z0-9_-]{1,128}$/.test(selection.taskId));
    const root=io.lstatSync(selection.taskRoot);requireThat(root.isDirectory()&&!root.isSymbolicLink());
  }
  return {...current,...selection};
}
// Exclusive cooperative lock plus byte comparison: never silently overwrite a stale UI snapshot.
// io injection is only for in-memory tests, never accepted from the UI protocol.
export function commitSelection(file, expected, next, token, io=fs) {
  const logs=path.join(path.dirname(file),'logs');
  const lock=path.join(logs,'selection.lock'),temporary=path.join(logs,token+'.selection.private.tmp');
  const fd=io.openSync(lock,'wx');let staged=false;
  try {
    requireThat(io.readFileSync(file,'utf8')===expected);
    io.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});staged=true;
    requireThat(io.readFileSync(file,'utf8')===expected);
    io.renameSync(temporary,file);staged=false;
  } finally {
    if(staged)io.unlinkSync(temporary);
    io.closeSync(fd);io.unlinkSync(lock);
  }
}
// Internal dependencies are only for memory tests, never GUI/argv options.
export function selectExecution(configFile,config,payload,operationToken,{io=fs,readDispatch,observe}={}){
  const value=validateExecutionSelectionPayload(payload);
  requireThat(/^[0-9]{1,12}-[0-9]{1,24}$/.test(operationToken)&&typeof readDispatch==='function'&&typeof observe==='function');
  requireThat(io.readFileSync(configFile,'utf8')===value.expectedConfigurationText);
  requireThat(JSON.stringify(JSON.parse(value.expectedConfigurationText))===JSON.stringify(config));
  const dispatch=readDispatch(value.executionToken);requireThat(dispatch.executionToken===value.executionToken);
  const expectedTaskRoot=taskRootFromPlan(dispatch.preparation?.assessment);
  let observed=observe(dispatch),selection=deriveExecutionSelection(config,dispatch,observed,expectedTaskRoot);
  const next=selectionConfiguration(config,selection,io);
  // Reobserve after ordinary path checks; first-owner binding rejects a replaced
  // TASK. Progress/terminal may advance without changing the derived selection.
  observed=observe(dispatch);
  const fresh=deriveExecutionSelection(config,dispatch,observed,expectedTaskRoot);
  requireThat(JSON.stringify(fresh)===JSON.stringify(selection));selection=fresh;
  commitSelection(configFile,value.expectedConfigurationText,next,operationToken,io);
  return {schema:'wxslim-local-execution-selection-v1',executionToken:value.executionToken,
    expectedConfigurationText:value.expectedConfigurationText,selection,configurationText:JSON.stringify(next,null,2)+'\n',
    assessment:observed.assessment,selectionSaved:true,taskExecuted:false};
}
export function commandArgs(config, operation,admission) {
  requireThat(operations.has(operation));
  if(operation==='execute'||operation==='cancel')requireThat(isActionAdmission(config,operation,admission));
  const entry=path.join(config.repositoryRoot,'wxslim.mjs');
  if(operation==='list')return [entry,'task','list'];
  if(operation==='capabilities')return [entry,'capabilities'];
  requireThat(config.requestFile&&path.isAbsolute(config.requestFile));
  if(operation==='plan')return [entry,'task','plan',config.requestFile];
  if(operation==='execute')return [entry,'task','execute',config.requestFile,'--write','--expected-plan-sha256',admission.assessmentSha256];
  requireThat(config.taskRoot&&path.isAbsolute(config.taskRoot)&&/^[A-Za-z0-9_-]{1,128}$/.test(config.taskId));
  return [entry,'task',operation==='cancel'?'cancel':'status',config.requestFile,config.taskRoot,config.taskId,...(operation==='cancel'?['--write']:[])];
}
export function decode(operation, stdout, exitCode, signal, truncated, stderr='') {
  const writing=operation==='execute'||operation==='cancel';
  if(signal||truncated) return {ok:false,code:truncated?'QUERY_OUTPUT_LIMIT':'CLI_QUERY_FAILED',...(writing?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{})};
  let data;try{data=JSON.parse(stdout);}catch{
    try{const value=JSON.parse(stderr);if(value?.schema==='wxslim-task-error-v1')return {ok:false,code:'CLI_TASK_REJECTED',data:value,
      possibleSideEffects:value.possibleSideEffects??(writing?'UNKNOWN_UNTIL_TASK_INSPECTED':'NONE')};}catch{}
    return {ok:false,code:'CLI_JSON_INVALID',...(writing?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{})};
  }
  const schemas={list:'wxslim-task-actions-v1',capabilities:'wxslim-capabilities-v1',plan:'wxslim-task-plan-v1',status:'wxslim-task-status-v1',execute:'wxslim-task-result-v1',cancel:'wxslim-task-cancel-v1'};
  if(!data||data.schema!==schemas[operation])return {ok:false,code:'CLI_SCHEMA_MISMATCH',...(writing?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{})};
  // CLI status describes the TASK with exit 1/2 too. Never hide those receipts.
  let expectedExit=0;
  if(operation==='status'||operation==='cancel') {
    if(!['SUCCESS','FAILED','CANCELLED','NO_TERMINAL_RECEIPT','CANCEL_REQUESTED'].includes(data.status)||typeof data.terminalPresent!=='boolean'||!Array.isArray(data.warnings)||data.processLiveness!=='NOT_OBSERVED')return {ok:false,code:'CLI_STATUS_INVALID',data,...(writing?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{})};
    expectedExit=data.status==='SUCCESS'?0:data.status==='CANCELLED'?2:1;
    if(operation==='cancel'&&data.cancel?.accepted===true)expectedExit=0;
  }
  if(operation==='execute'){
    const pairAction=['official-pair-prepare','custom-pair-prepare'].includes(data.action);
    const bounded=pairAction||data.executionMode==='bounded-files';
    const outputPin=v=>v&&typeof v.path==='string'&&path.isAbsolute(v.path)&&Number.isSafeInteger(v.bytes)&&v.bytes>0&&typeof v.sha256==='string'&&/^[a-f0-9]{64}$/.test(v.sha256);
    const valid=bounded?pairAction&&data.executionMode==='bounded-files'&&data.taskId===null&&data.status==='SUCCESS'&&
      data.artifactState==='PREPARED_NOT_ADMITTED'&&data.admission==='NOT_ADMITTED'&&data.outputs&&Object.keys(data.outputs).length===2&&outputPin(data.outputs.js)&&outputPin(data.outputs.receipt)&&
      path.resolve(data.outputs.js.path)!==path.resolve(data.outputs.receipt.path):
      data.executionMode===undefined&&['SUCCESS','FAILED','CANCELLED'].includes(data.status)&&typeof data.taskId==='string';
    if(!valid)return {ok:false,code:'CLI_EXECUTION_INVALID',data,possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'};
    expectedExit=data.status==='SUCCESS'?0:data.status==='CANCELLED'?2:1;
  }
  if(operation==='plan')expectedExit=!data.eligible&&data.purpose!=='inspect'?2:0;
  if(exitCode!==expectedExit)return {ok:false,code:'CLI_EXIT_MISMATCH',data,...(writing?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{})};
  if(operation==='capabilities') {
    if(!Array.isArray(data.capabilities)||data.capabilities.some(c=>!c||!Object.hasOwn(STATUS,c.status)||typeof c.id!=='string'||typeof c.name!=='string'||typeof c.limit!=='string'))return {ok:false,code:'CLI_CAPABILITIES_INVALID'};
    // Presentation uses the existing labels; no reimplementation of assessment.
    data.capabilities=data.capabilities.map(c=>({...c,statusLabel:STATUS[c.status]}));
  }
  return {ok:true,code:writing?'TASK_OPERATION_COMPLETED':'READ_ONLY_QUERY_COMPLETED',data,
    ...(writing?{possibleSideEffects:'TASK_RECORDS_AND_OUTPUT_MAY_EXIST'}:{})};
}
function directoryBytes(root){let total=0;for(const e of fs.readdirSync(root,{withFileTypes:true})){const f=path.join(root,e.name),s=fs.lstatSync(f);requireThat(!s.isSymbolicLink());total+=s.isDirectory()?directoryBytes(f):s.size;}return total;}
export async function run(configFile,operation,token,payload) {
  const opening = operation === 'open-project';
  requireThat(/^[0-9]{1,12}-[0-9]{1,24}$/.test(token)&&localOperations.has(operation));
  const writing=operation==='execute'||operation==='cancel';
  const active=operation==='observe-execution'||operation==='prepare-active-cancel';
  const selectingExecution=operation==='select-execution';
  const exportForm=operation==='prepare-export-request';
  const rawBuildForm=operation==='prepare-raw-build-request';
  const runtimeKind=operation==='prepare-resource-interfaces-request'?'interfaces':operation==='prepare-resource-assembly-request'?'assembly':operation==='prepare-resource-install-request'?'install':null;
  const resourceConfigForm=operation==='prepare-resource-config';
  const resourceCatalog=operation==='resource-partition-outputs';
  const resourceBoot=operation==='resource-boot-check';
  const resourceSource=operation==='resource-source-plan';
  const officialForm=operation==='prepare-official-request',resourceForm=operation==='prepare-resource-request',resourceInventory=operation==='resource-inventory',planningForm=exportForm||rawBuildForm||officialForm||resourceForm||runtimeKind!==null;
  requireThat(opening||operation==='save-selection'||selectingExecution||planningForm||resourceConfigForm||resourceCatalog||resourceBoot||resourceSource||resourceInventory||writing||active?typeof payload==='string'&&payload.length<=32768:payload===undefined);
  const config=loadConfig(configFile);
  const state=path.dirname(configFile);
  const logs=path.join(state,'logs');fs.mkdirSync(logs,{recursive:true});
  requireThat(directoryBytes(state)<MAX_DIRECTORY-MAX_OUTPUT*(writing?3:2)-(resourceForm||resourceConfigForm?2*1024*1024:65536));
  const stem=path.join(logs,token);requireThat(!fs.readdirSync(logs).some(f=>f.startsWith(token+'.')));
  function finish(response){
    const bytes=JSON.stringify(response,null,2)+'\n';requireThat(Buffer.byteLength(bytes)<=MAX_OUTPUT);
    const temporary=stem+'.result.private.tmp';fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,stem+'.result.private.json');return response;
  }
  if (opening) {
    const input = JSON.parse(payload);
    requireThat(typeof input.configFile === 'string' && Object.keys(input).every(k=>['configFile','appidFrom'].includes(k)) &&
      (input.appidFrom === undefined || typeof input.appidFrom === 'string'));
    try {
      return finish({schema:'wxslim-local-plugin-result-v1', token, operation, ok:true, code:'LOCAL_PROJECT_OPENED', data:openWeChatProject(input.configFile, input.appidFrom)});
    } catch (error) {
      return finish({schema:'wxslim-local-plugin-result-v1', token, operation, ok:false, code:'LOCAL_OPEN_FAILED', data:{message:error.message}});
    }
  }
  function dispatchRecord(executionToken){
    requireThat(/^[0-9]{1,12}-[0-9]{1,24}$/.test(executionToken));
    const file=path.join(logs,executionToken+'.dispatch.private.json');requireThat(ordinary(file).size<=MAX_OUTPUT);
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    requireThat(value.schema==='wxslim-local-task-dispatch-v1'&&value.executionToken===executionToken);return value;
  }
  function observe(executionToken){return bindObservedTask(logs,executionToken,observeExecution(dispatchRecord(executionToken)));}
  if(resourceSource){
    const input=JSON.parse(payload);requireThat(input&&Object.keys(input).length===1&&typeof input.projectFile==='string'&&path.isAbsolute(input.projectFile));
    const data=inspectResourceProjectSource(input.projectFile);
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_RESOURCE_SOURCE_PLAN_COMPLETED',data,
      executionAuthorized:false,possibleSideEffects:'LOCAL_LOGS_ONLY'});
  }
  if(resourceBoot){
    const data=inspectResourceGameBoot(JSON.parse(payload));
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_RESOURCE_BOOT_CHECK_COMPLETED',data,
      executionAuthorized:false,possibleSideEffects:'LOCAL_LOGS_ONLY'});
  }
  if(operation==='resource-partition-outputs'){
    const data=readPartitionCatalog(JSON.parse(payload));
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_RESOURCE_PARTITION_OUTPUTS_READ',data,
      executionAuthorized:false,possibleSideEffects:'LOCAL_LOGS_ONLY'});
  }
  if(resourceConfigForm){
    const draft=prepareRuntimeResourceConfig(logs,JSON.parse(payload)),file=stem+'.runtime-resources.private.json';
    fs.writeFileSync(file,draft.configText,{flag:'wx'});
    // Same read-only implementation as `wxslim resources plan`, not a second
    // dependency checker. Failure leaves the local draft and original error.
    const plan=inspectResourcePlan(draft.config,{base:path.dirname(file)});
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_RESOURCE_CONFIG_PLANNED',
      data:{schema:'wxslim-local-resource-config-draft-v1',configFile:file,selectionSaved:false,taskExecuted:false,plan},
      executionAuthorized:false,possibleSideEffects:'LOCAL_DRAFT_AND_LOGS_ONLY'});
  }
  if(resourceInventory){
    const snapshot=readResourceInventory(JSON.parse(payload));
    // Buffer never crosses the GUI/argv boundary. This receipt binds a later
    // declaration to the exact PCK contents the user inspected.
    const data={schema:'wxslim-local-resource-inventory-v1',sourcePath:snapshot.sourcePath,pin:snapshot.pin,inventory:snapshot.inventory};
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_RESOURCE_INVENTORY_READ',data,
      executionAuthorized:false,possibleSideEffects:'LOCAL_LOGS_ONLY'});
  }
  if(selectingExecution){
    const data=selectExecution(configFile,config,JSON.parse(payload),token,{readDispatch:dispatchRecord,
      observe:dispatch=>bindObservedTask(logs,dispatch.executionToken,observeExecution(dispatch))});
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_EXECUTION_SELECTION_SAVED',data,
      executionAuthorized:false,possibleSideEffects:'LOCAL_SELECTION_AND_LOGS_ONLY'});
  }
  if(active){
    const value=JSON.parse(payload);requireThat(value&&Object.keys(value).length===1&&typeof value.executionToken==='string');
    const observed=observe(value.executionToken);
    if(operation==='observe-execution')return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_EXECUTION_OBSERVED',data:observed,executionAuthorized:false});
    requireThat(observed.cancelEligible&&observed.taskId&&observed.status==='TASK_RECEIPT_MATCHED');
    const dispatch=dispatchRecord(value.executionToken),selection={...config,requestFile:dispatch.configuration.requestFile,taskRoot:observed.taskRoot,taskId:observed.taskId};
    const data={...await prepareAction(configFile,config,'cancel',token,{selection}),executionToken:value.executionToken,taskRoot:observed.taskRoot,taskId:observed.taskId};
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_ACTION_PREPARED',data,executionAuthorized:false,possibleSideEffects:'NONE'});
  }
  if(operation==='prepare-execute'||operation==='prepare-cancel'){
    const action=operation.slice('prepare-'.length),data=await prepareAction(configFile,config,action,token);
    return finish({schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_ACTION_PREPARED',data,executionAuthorized:false,possibleSideEffects:'NONE'});
  }
  let admission,commandConfig=config;
  if(writing){
    const confirmation=JSON.parse(payload);requireThat(typeof confirmation?.preparationToken==='string'&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(confirmation.preparationToken));
    const previous=path.join(logs,confirmation.preparationToken+'.result.private.json');requireThat(ordinary(previous).size<=MAX_OUTPUT);
    const prepared=JSON.parse(fs.readFileSync(previous,'utf8'));
    requireThat(prepared.schema==='wxslim-local-plugin-result-v1'&&prepared.token===confirmation.preparationToken&&
      (prepared.operation==='prepare-'+operation||operation==='cancel'&&prepared.operation==='prepare-active-cancel')&&prepared.ok===true);
    if(prepared.operation==='prepare-active-cancel'){
      const observed=observe(prepared.data.executionToken);
      requireThat(observed.cancelEligible&&observed.taskRoot===prepared.data.taskRoot&&observed.taskId===prepared.data.taskId);
    }
    admission=await confirmAction(configFile,config,operation,confirmation,prepared.data);commandConfig=admission.selection;
    // One exclusive local claim. No reuse/retry even if subsequent dispatch fails.
    claimConfirmation(logs,confirmation.preparationToken,token,operation);
    if(operation==='execute'){
      const dispatch={schema:'wxslim-local-task-dispatch-v1',executionToken:token,configuration:commandConfig,preparation:admission};
      const bytes=JSON.stringify(dispatch)+'\n';requireThat(Buffer.byteLength(bytes)<=MAX_OUTPUT);
      fs.writeFileSync(stem+'.dispatch.private.json',bytes,{flag:'wx'});
    }
  }
  if(operation==='save-selection') {
    const value=JSON.parse(payload);requireThat(value&&Object.keys(value).length===2&&typeof value.expected==='string'&&value.expected.length<=16384);
    requireThat(fs.readFileSync(configFile,'utf8')===value.expected);
    requireThat(JSON.stringify(JSON.parse(value.expected))===JSON.stringify(config));
    const next=selectionConfiguration(config,value.selection);
    commitSelection(configFile,value.expected,next,token);
    const response={schema:'wxslim-local-plugin-result-v1',token,operation,ok:true,code:'LOCAL_SELECTION_SAVED',data:{selection:value.selection,configurationText:JSON.stringify(next,null,2)+'\n'},executionAuthorized:false};
    const temporary=stem+'.result.private.tmp';fs.writeFileSync(temporary,JSON.stringify(response)+'\n',{flag:'wx'});fs.renameSync(temporary,stem+'.result.private.json');return response;
  }
  let draftFiles=null;
  if(planningForm){
    const kind=runtimeKind?'resource-'+runtimeKind:exportForm?'export':rawBuildForm?'raw-build':resourceForm?'resource':'official';
    draftFiles={configFile:stem+'.'+kind+'-config.private.json',requestFile:stem+'.'+kind+'-request.private.json'};
    let draft;
    if(rawBuildForm){
      draft=buildRawBuildRequestDraft(JSON.parse(payload),draftFiles);
    }else if(resourceForm){
      const {declaration,snapshot}=readResourceDeclaration(logs,JSON.parse(payload));
      draft=buildResourcePartitionRequestDraft(declaration,snapshot,draftFiles);
    }else if(runtimeKind){
      draft=buildResourceRuntimeDraft(runtimeKind,JSON.parse(payload),draftFiles);
    }else draft=exportForm?buildExportRequestDraft(config,JSON.parse(payload),draftFiles):prepareOfficialFormDraft(JSON.parse(payload),draftFiles,{readInventory:readResourceInventory});
    requireThat(Buffer.byteLength(draft.configText)+Buffer.byteLength(draft.requestText)<=(resourceForm?2*1024*1024:32768));
    // Only local configuration files. Output/project directories are never created here.
    // A later plan failure deliberately retains this draft and the original error.
    fs.writeFileSync(draftFiles.configFile,draft.configText,{flag:'wx'});
    fs.writeFileSync(draftFiles.requestFile,draft.requestText,{flag:'wx'});
    commandConfig={...config,requestFile:draftFiles.requestFile,taskRoot:'',taskId:''};
  }
  const commandOperation=planningForm?'plan':operation;
  const args=commandArgs(commandConfig,commandOperation,admission);
  const stdout=[],stderr=[];let captured=0,truncated=false,spawnFailed=false,spawnError='';
  const result=await new Promise(resolve=>{
    const child=spawn(config.nodeExecutable,args,{cwd:config.repositoryRoot,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const collect=target=>chunk=>{const take=Math.max(0,Math.min(chunk.length,MAX_OUTPUT-captured));if(take)target.push(chunk.subarray(0,take));captured+=take;if(take<chunk.length)truncated=true;};
    child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
    child.on('error',error=>{spawnFailed=true;spawnError=String(error.stack||error).slice(0,16384);});
    child.on('close',(code,signal)=>resolve({code,signal}));
  });
  const out=Buffer.concat(stdout),err=Buffer.concat(stderr);
  fs.writeFileSync(stem+'.stdout.private.log',out,{flag:'wx'});
  fs.writeFileSync(stem+'.stderr.private.log',err,{flag:'wx'});
  if(spawnError)fs.writeFileSync(stem+'.spawn-error.private.log',spawnError,{flag:'wx'});
  const response={schema:'wxslim-local-plugin-result-v1',token,operation,...(spawnFailed?{ok:false,code:'QUERY_SPAWN_FAILED',possibleSideEffects:writing?'UNKNOWN_UNTIL_TASK_INSPECTED':'NONE'}:decode(commandOperation,out.toString('utf8'),result.code,result.signal,truncated,err.toString('utf8'))),exitCode:result.code,signal:result.signal,rawLogsComplete:!truncated,executionAuthorized:writing};
  if(planningForm){
    response.draftFiles=draftFiles;
    response.possibleSideEffects='LOCAL_DRAFT_AND_LOGS_ONLY';
    if(response.ok){
      const nextInputs=runtimeKind==='interfaces'?resourceRuntimeNextInputs(response.data):null;
      response.code=runtimeKind?'LOCAL_RESOURCE_RUNTIME_DRAFT_PLANNED':exportForm?'LOCAL_EXPORT_DRAFT_PLANNED':rawBuildForm?'LOCAL_RAW_BUILD_DRAFT_PLANNED':resourceForm?'LOCAL_RESOURCE_DRAFT_PLANNED':'LOCAL_OFFICIAL_DRAFT_PLANNED';
      response.data={schema:runtimeKind?'wxslim-local-resource-runtime-draft-v1':exportForm?'wxslim-local-export-draft-v1':rawBuildForm?'wxslim-local-raw-build-draft-v1':resourceForm?'wxslim-local-resource-draft-v1':'wxslim-local-official-draft-v1',...draftFiles,selectionSaved:false,taskExecuted:false,plan:response.data,...(runtimeKind?{kind:runtimeKind,nextInputs}:{})};
    }
  }
  if (operation === 'execute' && response.ok && response.data?.status === 'SUCCESS') {
    const action = response.data.action;
    if (['project-pck-export','official-convert','resource-runtime-assemble'].includes(action)) {
      const root = taskRootFromPlan(admission.assessment);
      const outputFile = action === 'project-pck-export' ? 'full.pck' : 'converted/minigame/project.config.json';
      const location = path.join(root, outputFile);
      if (fs.existsSync(location)) response.outputFile = location;
    }
  }
  const temporary=stem+'.result.private.tmp';
  fs.writeFileSync(temporary,JSON.stringify(response,null,2)+'\n',{flag:'wx'});
  fs.renameSync(temporary,stem+'.result.private.json');
  return response;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  try{requireThat(args.length===3||args.length===4);const response=await run(args[0],args[1],args[2],decodePayloadArgument(args[3]));process.exitCode=response.ok?0:1;}
  catch(error){
    // Transport errors also receive a private raw record; never send raw paths to UI.
    if((args.length===3||args.length===4)&&localOperations.has(args[1])&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(args[2])) {
      try {
        loadConfig(args[0]);
        const state=path.dirname(args[0]),logs=path.join(state,'logs');fs.mkdirSync(logs,{recursive:true});
        requireThat(directoryBytes(state)<MAX_DIRECTORY);
        const stem=path.join(logs,args[2]);
        fs.writeFileSync(stem+'.adapter-error.private.log',String(error.stack||error).slice(0,16384),{flag:'wx'});
        const writing=args[1]==='execute'||args[1]==='cancel';
        const value={schema:'wxslim-local-plugin-result-v1',token:args[2],operation:args[1],ok:false,code:'LOCAL_ADAPTER_REJECTED',executionAuthorized:false,
          possibleSideEffects:writing?'UNKNOWN_UNTIL_TASK_INSPECTED':['prepare-export-request','prepare-official-request','prepare-resource-request','prepare-resource-config','prepare-resource-interfaces-request','prepare-resource-assembly-request'].includes(args[1])?'LOCAL_DRAFT_AND_LOGS_MAY_EXIST':['save-selection','select-execution'].includes(args[1])?'LOCAL_SELECTION_AND_LOGS_MAY_EXIST':'NONE'};
        const temp=stem+'.error.private.tmp';fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx'});
        if(!fs.existsSync(stem+'.result.private.json'))fs.renameSync(temp,stem+'.result.private.json');
      }catch{/* No complete result means UNKNOWN in the panel; never infer success. */}
    }
    process.stderr.write('LOCAL_ADAPTER_FAILED; inspect structured result and task receipts.\n');process.exitCode=1;
  }
}
