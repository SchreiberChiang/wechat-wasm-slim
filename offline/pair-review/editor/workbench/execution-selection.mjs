// Pure selection derivation. GUI payloads cannot supply a task root, ID or
// assessment; the adapter supplies its freshly verified dispatch/observation.
import path from 'node:path';
const KEYS=['schema','nodeExecutable','repositoryRoot','editorExecutable','requestFile','taskRoot','taskId'];
const ENVIRONMENT=['schema','nodeExecutable','repositoryRoot','editorExecutable'];
const token=value=>typeof value==='string'&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(value);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
const absolute=value=>typeof value==='string'&&value!==''&&!value.includes('\0')&&path.isAbsolute(value);
const samePath=(a,b)=>absolute(a)&&absolute(b)&&(process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b));

export function validateExecutionSelectionPayload(value){
  need(exact(value,['executionToken','expectedConfigurationText'])&&token(value.executionToken)&&typeof value.expectedConfigurationText==='string'&&value.expectedConfigurationText.length>0&&Buffer.byteLength(value.expectedConfigurationText,'utf8')<=16384,'LOCAL_EXECUTION_SELECTION_PAYLOAD');
  return {executionToken:value.executionToken,expectedConfigurationText:value.expectedConfigurationText};
}

export function deriveExecutionSelection(currentConfig,dispatch,observed,expectedTaskRoot){
  need(exact(currentConfig,KEYS)&&exact(dispatch?.configuration,KEYS),'LOCAL_EXECUTION_SELECTION_CONFIGURATION');
  need(dispatch.schema==='wxslim-local-task-dispatch-v1'&&token(dispatch.executionToken),'LOCAL_EXECUTION_SELECTION_DISPATCH');
  const original=dispatch.configuration,plan=dispatch.preparation?.assessment;
  need(ENVIRONMENT.every(key=>currentConfig[key]===original[key]),'LOCAL_EXECUTION_SELECTION_ENVIRONMENT_CHANGED');
  need(currentConfig.schema==='wxslim-local-plugin-config-v1'&&samePath(currentConfig.requestFile,original.requestFile),'LOCAL_EXECUTION_SELECTION_REQUEST_CHANGED');
  need(plan?.schema==='wxslim-task-plan-v1'&&plan.eligible===true&&plan.purpose!=='inspect'&&dispatch.preparation?.confirmation?.action==='execute','LOCAL_EXECUTION_SELECTION_DISPATCH');
  need(plan.action!=='official-pair-prepare'&&plan.executionMode!=='bounded-files','LOCAL_EXECUTION_SELECTION_NO_TASK');
  need(observed?.schema==='wxslim-local-execution-observation-v1'&&observed.executionToken===dispatch.executionToken&&observed.status==='TASK_RECEIPT_MATCHED','LOCAL_EXECUTION_SELECTION_UNBOUND');
  // expectedTaskRoot comes from the shared taskRootFromPlan, never GUI input.
  need(samePath(observed.taskRoot,expectedTaskRoot),'LOCAL_EXECUTION_SELECTION_MISMATCH');
  const assessment=observed.assessment;
  need(absolute(observed.taskRoot)&&typeof observed.taskId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(observed.taskId)&&assessment?.schema==='wxslim-task-status-v1'&&assessment.inputBinding==='MATCHED_EXECUTION_SNAPSHOT'&&assessment.taskId===observed.taskId&&typeof assessment.recipeId==='string'&&assessment.recipeId!=='','LOCAL_EXECUTION_SELECTION_UNBOUND');
  need(['action','profile','packageId','requestSha256','configurationSha256'].every(key=>assessment[key]===plan[key]),'LOCAL_EXECUTION_SELECTION_MISMATCH');
  need(['SUCCESS','FAILED','CANCELLED','NO_TERMINAL_RECEIPT','CANCEL_REQUESTED'].includes(assessment.status)&&assessment.terminalPresent===['SUCCESS','FAILED','CANCELLED'].includes(assessment.status),'LOCAL_EXECUTION_SELECTION_UNBOUND');
  return {requestFile:original.requestFile,taskRoot:observed.taskRoot,taskId:observed.taskId};
}
