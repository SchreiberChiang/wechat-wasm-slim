// Local confirmation envelope only; all admission semantics belong to task-core.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createTaskService,taskPlanIdentity} from '../../lib/task-core.mjs';

const SCHEMA='wxslim-local-task-confirmation-v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code='LOCAL_CONFIRMATION_REJECTED')=>{if(!value)throw Object.assign(Error(code),{code});};
const token=value=>typeof value==='string'&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(value);
const admissions=new WeakMap();
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const digest=value=>hash(JSON.stringify(canonical(value)));
function document(file,io=fs,maxBytes=1024*1024){
  const before=io.lstatSync(file);need(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maxBytes,'LOCAL_DOCUMENT_INVALID');
  const bytes=io.readFileSync(file),after=io.lstatSync(file);
  need(bytes.length===before.size&&['size','dev','ino','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'LOCAL_DOCUMENT_CHANGED');
  return {value:JSON.parse(bytes.toString('utf8')),sha256:hash(bytes),
    fileIdentity:Object.fromEntries(['size','dev','ino','mtimeMs','ctimeMs'].map(k=>[k,before[k]]))};
}
function binding(configFile,config,selection=config,io=fs){
  need(selection&&Object.keys(selection).length===Object.keys(config).length&&Object.keys(config).every(k=>
    Object.hasOwn(selection,k)&&(['requestFile','taskRoot','taskId'].includes(k)||selection[k]===config[k])));
  const local=document(configFile,io),request=document(selection.requestFile,io);
  need(digest(local.value)===digest(config));
  need(typeof request.value.configFile==='string'&&request.value.configFile.trim());
  const configuration=document(path.resolve(path.dirname(selection.requestFile),request.value.configFile),io);
  return {localConfiguration:{sha256:local.sha256,...local.fileIdentity},
    request:{sha256:request.sha256,...request.fileIdentity},configuration:{sha256:configuration.sha256,...configuration.fileIdentity},
    selection:{requestFile:selection.requestFile,taskRoot:selection.taskRoot,taskId:selection.taskId}};
}
function assessment(config,action,service){
  need(action==='execute'||action==='cancel');
  return action==='execute'?service.plan(config.requestFile):service.status(config.requestFile,{root:config.taskRoot,taskId:config.taskId});
}
function eligible(value,action){
  return action==='execute'?value?.schema==='wxslim-task-plan-v1'&&value.eligible===true&&value.purpose!=='inspect':
    value?.schema==='wxslim-task-status-v1'&&value.inputBinding==='MATCHED_EXECUTION_SNAPSHOT'&&value.terminalPresent===false&&
      ['NO_TERMINAL_RECEIPT','CANCEL_REQUESTED'].includes(value.status);
}
function assessmentIdentity(value,action){
  if(action==='execute')return value; // Entire plan and input/source/tool snapshot.
  // A running task's byte count, warnings and read-only progress may change
  // while the user confirms; progress is deliberately absent from this list.
  // Bind its stable shared identity; eligibility and terminal are checked afresh.
  const keys=['schema','action','taskId','recipeId','profile','packageId','requestSha256','configurationSha256','inputBinding','budgetBytes','build'];
  return Object.fromEntries(keys.map(key=>[key,value?.[key]]));
}
export function prepareAction(configFile,config,action,preparationToken,{service=createTaskService(),now=Date.now(),io=fs,selection=config}={}){
  need(token(preparationToken));
  const before=binding(configFile,config,selection,io),pending=assessment(selection,action,service);
  return pending?.then?pending.then(finish):finish(pending);
  function finish(value){
  const after=binding(configFile,config,selection,io);
  need(digest(before)===digest(after),'LOCAL_CONFIRMATION_INPUT_CHANGED');
  const assessmentSha256=action==='execute'?taskPlanIdentity(value):digest(assessmentIdentity(value,action));
  const bindingSha256=digest({action,binding:after,assessmentSha256});
  return {assessment:value,confirmation:eligible(value,action)?{schema:SCHEMA,action,preparationToken,bindingSha256}:null,
    // Retained only in the local result; it is never accepted back from the UI.
    binding:after,assessmentSha256,selection:{...selection}};
  }
}
export function confirmAction(configFile,config,action,payload,prepared,{service=createTaskService(),now=Date.now(),io=fs}={}){
  need(payload&&Object.getPrototypeOf(payload)===Object.prototype);
  need(Object.keys(payload).sort().join(',')===['schema','preparationToken','bindingSha256','confirmed'].sort().join(','));
  need(payload.schema===SCHEMA&&payload.confirmed===true&&token(payload.preparationToken)&&/^[a-f0-9]{64}$/.test(payload.bindingSha256));
  const proof=prepared?.confirmation;
  need(proof?.schema===SCHEMA&&proof.action===action&&proof.preparationToken===payload.preparationToken&&proof.bindingSha256===payload.bindingSha256);
  const pending=prepareAction(configFile,config,action,payload.preparationToken,{service,now,io,selection:prepared.selection});
  return pending?.then?pending.then(finish):finish(pending);
  function finish(current){
  // Compare the complete shared assessment, including input/source/tool pins.
  // No plan fields are removed. Any execute-plan drift needs a fresh preview.
  need(current.confirmation&&current.confirmation.bindingSha256===proof.bindingSha256&&
    current.assessmentSha256===prepared.assessmentSha256&&digest(current.binding)===digest(prepared.binding),'LOCAL_CONFIRMATION_PLAN_CHANGED');
  admissions.set(current,{action,selection:digest(current.selection),assessmentSha256:current.assessmentSha256});return current;
  }
}
export function isActionAdmission(config,action,value){
  const saved=admissions.get(value);return !!saved&&saved.action===action&&saved.selection===digest(config)&&
    saved.assessmentSha256===value.assessmentSha256&&(action!=='execute'||taskPlanIdentity(value.assessment)===saved.assessmentSha256);
}
export function claimConfirmation(logs,preparationToken,dispatchToken,action,io=fs){
  need(token(preparationToken)&&token(dispatchToken)&&(action==='execute'||action==='cancel'));
  io.writeFileSync(path.join(logs,preparationToken+'.consumed.private.json'),JSON.stringify({token:dispatchToken,operation:action})+'\n',{flag:'wx'});
}
export function taskRootFromPlan(value){
  need(value?.action!=='official-pair-prepare'&&value?.executionMode!=='bounded-files','LOCAL_BOUNDED_FILES_NO_TASK_ROOT');
  const root=value?.action==='official-convert'?value.plan?.taskRoot:
    ['project-pck-export','resource-pck-partition','resource-interfaces-prepare','resource-runtime-assemble','resource-project-install'].includes(value?.action)?value.plan?.input?.output:value?.plan?.work;
  need(typeof root==='string'&&path.isAbsolute(root),'LOCAL_EXECUTION_ROOT_UNAVAILABLE');return root;
}
function expectedRecipe(value){
  if(value.action==='official-convert')return value.plan?.recipeId;
  if(value.action==='fixed-engine-build')return 'fixed-engine:'+value.plan?.semanticRecipeSha256;
  if(value.action==='persistent-dev-engine-build')return 'persistent-dev:'+value.plan?.planSha256;
  if(value.action==='official-raw-engine-build')return 'official-raw:'+value.plan?.planSha256;
  if(['project-pck-export','resource-pck-partition','resource-interfaces-prepare','resource-runtime-assemble','resource-project-install'].includes(value.action))return value.action+':'+value.plan?.planSha256;
  return null;
}
export function observeExecution(dispatch,{service=createTaskService(),io=fs}={}){
  need(dispatch?.schema==='wxslim-local-task-dispatch-v1'&&token(dispatch.executionToken));
  const plan=dispatch.preparation?.assessment,config=dispatch.configuration;
  need(eligible(plan,'execute')&&dispatch.preparation.confirmation?.action==='execute');
  const bounded=['official-pair-prepare','custom-pair-prepare'].includes(plan.action);
  need(bounded===(plan.executionMode==='bounded-files'),'LOCAL_EXECUTION_MODE_MISMATCH');
  if(bounded)need(typeof plan.plan?.outputDirectory==='string'&&path.isAbsolute(plan.plan.outputDirectory)&&
    plan.control?.supported===false&&plan.control?.statusSupported===false&&plan.control?.cancelSupported===false&&
    plan.control?.reason==='BOUNDED_FILE_PREPARATION_NO_TASK_CONTROLLER','LOCAL_BOUNDED_FILES_CONTRACT');
  const root=bounded?null:taskRootFromPlan(plan),base={schema:'wxslim-local-execution-observation-v1',executionToken:dispatch.executionToken,
    taskRoot:root,taskId:null,assessment:null,cancelEligible:false,processLiveness:'NOT_OBSERVED',pidOwnership:'NOT_PROVEN'};
  try{
    const request=document(config.requestFile,io),configuration=document(path.resolve(path.dirname(config.requestFile),request.value.configFile),io);
    need(request.sha256===plan.requestSha256&&configuration.sha256===plan.configurationSha256,'LOCAL_EXECUTION_REQUEST_CHANGED');
    if(bounded)return {...base,status:'BOUNDED_FILE_OPERATION',reason:'NO_DURABLE_TASK_OR_CANCELLATION',outputDirectory:plan.plan.outputDirectory};
    let owner;
    try{
      const ownerFile=path.join(root,'TASK.json'),stat=io.lstatSync(ownerFile);
      need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16384,'LOCAL_EXECUTION_OWNER_INVALID');
      if(stat.size===0)return {...base,status:'TASK_RECEIPT_PENDING',reason:'TASK_OWNER_INCOMPLETE'};
      owner=document(ownerFile,io,16384).value;
    }catch(error){
      if(error.code==='ENOENT')return {...base,status:'TASK_RECEIPT_PENDING',reason:'TASK_OWNER_NOT_CREATED'};
      if(error instanceof SyntaxError)return {...base,status:'TASK_RECEIPT_PENDING',reason:'TASK_OWNER_INCOMPLETE'};
      throw error;
    }
    need(owner?.schema==='wxslim-official-task-v1'&&typeof owner.taskId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(owner.taskId)&&
      owner.recipeId===expectedRecipe(plan),'LOCAL_EXECUTION_TASK_MISMATCH');
    const value=service.status(config.requestFile,{root,taskId:owner.taskId});
    need(value.schema==='wxslim-task-status-v1'&&value.taskId===owner.taskId&&value.recipeId===owner.recipeId&&
      value.requestSha256===plan.requestSha256&&value.configurationSha256===plan.configurationSha256&&
      value.action===plan.action&&value.profile===plan.profile&&value.packageId===plan.packageId,'LOCAL_EXECUTION_TASK_MISMATCH');
    if(value.inputBinding!=='MATCHED_EXECUTION_SNAPSHOT')return {...base,status:'TASK_BINDING_PENDING',reason:'TASK_SNAPSHOT_NOT_BOUND'};
    return {...base,status:'TASK_RECEIPT_MATCHED',reason:'SHARED_TASK_BINDING_MATCHED',taskId:owner.taskId,assessment:value,cancelEligible:eligible(value,'cancel')};
  }catch(error){
    const allowed=['LOCAL_EXECUTION_REQUEST_CHANGED','LOCAL_EXECUTION_TASK_MISMATCH','LOCAL_EXECUTION_OWNER_INVALID',
      'LOCAL_DOCUMENT_INVALID','LOCAL_DOCUMENT_CHANGED','TASK_CONTROL_REJECTED','TASK_CONTROL_BINDING_INCOMPLETE',
      'TASK_ID_MISMATCH','TASK_RECIPE_MISMATCH','TASK_PATH_INVALID','TASK_BUDGET_EXCEEDED'];
    return {...base,status:'TASK_RECEIPT_REJECTED',reason:allowed.includes(error.code)?error.code:'TASK_BINDING_UNKNOWN'};
  }
}
export function bindObservedTask(logs,executionToken,value,io=fs){
  need(token(executionToken)&&value.executionToken===executionToken);
  if(value.status!=='TASK_RECEIPT_MATCHED')return value;
  const file=path.join(logs,executionToken+'.observed-task.private.json');
  const identity={executionToken,taskRoot:value.taskRoot,taskId:value.taskId,recipeId:value.assessment.recipeId};
  try{
    let existing;
    try{existing=document(file,io,16384).value;}catch(error){
      if(error.code!=='ENOENT')throw error;
      try{io.writeFileSync(file,JSON.stringify(identity)+'\n',{flag:'wx'});return value;}catch(writeError){if(writeError.code!=='EEXIST')throw writeError;}
      existing=document(file,io,16384).value;
    }
    need(digest(existing)===digest(identity),'LOCAL_EXECUTION_OWNER_CHANGED');return value;
  }catch{return {...value,status:'TASK_RECEIPT_REJECTED',reason:'LOCAL_EXECUTION_OWNER_CHANGED',taskId:null,assessment:null,cancelEligible:false};}
}
