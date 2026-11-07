// Memory-only helper/adapter/shared-status/CAS models. Never calls adapter.run,
// a real task, editor, converter, config write, target tree or directory creator.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deriveExecutionSelection,validateExecutionSelectionPayload} from './execution-selection.mjs';
import {home,selectExecution} from './adapter.mjs';
import {prepareAction,observeExecution,bindObservedTask,taskRootFromPlan} from './action-confirmation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

function fixture(status='SUCCESS'){
  const configFile=path.join(home,'local-config.json'),requestFile=path.join(home,'MEMORY_ONLY_EXECUTION_REQUEST.json'),inputFile=path.join(home,'MEMORY_ONLY_EXECUTION_CONFIG.json');
  const root=path.join(home,'MEMORY_ONLY_TASK'),logs=path.join(home,'logs'),executionToken='123-789',operationToken='123-999';
  const config={schema:'wxslim-local-plugin-config-v1',nodeExecutable:process.execPath,repositoryRoot:path.resolve(home,'../..'),editorExecutable:path.join(home,'editor.exe'),requestFile,taskRoot:'',taskId:''};
  const files=new Map();let clock=1,fd=0,configReads=0,statusCalls=0,observations=0;
  const missing=()=>Object.assign(Error('missing'),{code:'ENOENT'});
  function put(file,value,kind='file'){files.set(file,{bytes:Buffer.from(typeof value==='string'?value:JSON.stringify(value)),stamp:clock++,kind,link:false});}
  const io={
    lstatSync(file){const v=files.get(file);if(!v)throw missing();return {size:v.bytes.length,dev:1,ino:1,mtimeMs:v.stamp,ctimeMs:v.stamp,isFile:()=>v.kind==='file',isDirectory:()=>v.kind==='directory',isSymbolicLink:()=>v.link};},
    readFileSync(file,encoding){if(file===configFile){configReads++;if(f.driftAtRead===configReads)put(configFile,{...config,taskId:'concurrent-change'});}const v=files.get(file);if(!v)throw missing();return encoding?v.bytes.toString(encoding):Buffer.from(v.bytes);},
    openSync(file,flags){assert.equal(flags,'wx');if(files.has(file))throw Object.assign(Error('busy'),{code:'EEXIST'});put(file,'lock');return ++fd;},closeSync(){},
    writeFileSync(file,value,{flag}={}){assert.equal(flag,'wx');if(files.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});put(file,Buffer.isBuffer(value)?value.toString('utf8'):value);},
    renameSync(from,to){if(f.renameFailure)throw Object.assign(Error('rename failed'),{code:'EACCES'});assert(files.has(from));files.set(to,files.get(from));files.delete(from);},
    unlinkSync(file){assert(files.has(file));files.delete(file);}
  };
  const f={configFile,requestFile,inputFile,root,logs,executionToken,operationToken,config,files,put,io,driftAtRead:null,renameFailure:false,onObserve:null};
  put(configFile,config);put(requestFile,{schema:'wxslim-task-request-v1',action:'official-convert',configFile:path.basename(inputFile),purpose:'development-test',scope:{}});put(inputFile,{output:root});put(root,'','directory');
  const plan={schema:'wxslim-task-plan-v1',action:'official-convert',purpose:'development-test',eligible:true,requestSha256:sha(files.get(requestFile).bytes),configurationSha256:sha(files.get(inputFile).bytes),profile:'full-official-c050-dev',packageId:'wxslim-'+'a'.repeat(20),plan:{taskRoot:root,recipeId:'memory-official-recipe'}};
  const owner={schema:'wxslim-official-task-v1',taskId:'memory-task-01',recipeId:'memory-official-recipe',budgetBytes:120*1024*1024};put(path.join(root,'TASK.json'),owner);
  const assessment={schema:'wxslim-task-status-v1',action:plan.action,taskId:owner.taskId,recipeId:owner.recipeId,profile:plan.profile,packageId:plan.packageId,requestSha256:plan.requestSha256,configurationSha256:plan.configurationSha256,
    inputBinding:'MATCHED_EXECUTION_SNAPSHOT',status,terminalPresent:['SUCCESS','FAILED','CANCELLED'].includes(status),warnings:[],processLiveness:'NOT_OBSERVED'};
  const service={plan(file){assert.equal(file,requestFile);return structuredClone(plan);},status(file,selection){statusCalls++;assert.equal(file,requestFile);assert.equal(selection.root,root);assert.equal(selection.taskId,JSON.parse(io.readFileSync(path.join(root,'TASK.json'),'utf8')).taskId);return structuredClone(assessment);}};
  const preparation=prepareAction(configFile,config,'execute','123-456',{service,io});
  const dispatch={schema:'wxslim-local-task-dispatch-v1',executionToken,configuration:structuredClone(config),preparation};
  const dispatchFile=path.join(logs,executionToken+'.dispatch.private.json');put(dispatchFile,dispatch);
  const expectedConfigurationText=io.readFileSync(configFile,'utf8'),payload={executionToken,expectedConfigurationText};configReads=0;
  const dependencies={io,readDispatch(token){const file=path.join(logs,token+'.dispatch.private.json'),stat=io.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=2*1024*1024);return JSON.parse(io.readFileSync(file,'utf8'));},
    observe(value){observations++;if(f.onObserve)f.onObserve(observations);return bindObservedTask(logs,value.executionToken,observeExecution(value,{service,io}),io);}};
  return Object.assign(f,{payload,dispatch,dispatchFile,plan,owner,assessment,service,dependencies,get statusCalls(){return statusCalls;},get observations(){return observations;},
    run(value=payload){return selectExecution(configFile,config,value,operationToken,dependencies);},currentText(){return io.readFileSync(configFile,'utf8');},assertUnchanged(){assert.equal(io.readFileSync(configFile,'utf8'),expectedConfigurationText);}});
}

test('fresh matched task selection is saved through the actual adapter orchestration/CAS and echoes the original configuration',()=>{
  for(const status of ['SUCCESS','FAILED','CANCELLED','NO_TERMINAL_RECEIPT','CANCEL_REQUESTED']){
    const f=fixture(status),beforeInputs=[f.requestFile,f.inputFile,path.join(f.root,'TASK.json')].map(file=>[file,sha(f.io.readFileSync(file))]),result=f.run();
    assert.equal(result.schema,'wxslim-local-execution-selection-v1');assert.equal(result.executionToken,f.executionToken);assert.equal(result.expectedConfigurationText,f.payload.expectedConfigurationText);
    assert.deepEqual(result.selection,{requestFile:f.requestFile,taskRoot:f.root,taskId:f.owner.taskId});assert.equal(result.selectionSaved,true);assert.equal(result.taskExecuted,false);assert.equal(result.assessment.status,status);
    assert.equal(f.currentText(),result.configurationText);assert.deepEqual(JSON.parse(result.configurationText),{...f.config,...result.selection});
    for(const [file,pin]of beforeInputs)assert.equal(sha(f.io.readFileSync(file)),pin);
    assert.equal(f.files.has(path.join(f.logs,'selection.lock')),false);assert(![...f.files.keys()].some(file=>file.endsWith('.tmp')));
  }
});

test('payload allows only executionToken and original configuration text, never GUI-supplied identity or authority',()=>{
  const f=fixture();assert.deepEqual(validateExecutionSelectionPayload(f.payload),f.payload);
  for(const key of ['selection','root','taskRoot','taskId','assessment','dispatch','write','io','confirmed'])assert.throws(()=>f.run({...f.payload,[key]:'spoof'}),{code:'LOCAL_EXECUTION_SELECTION_PAYLOAD'});
  for(const value of [null,[],{},'text',{executionToken:'../escape',expectedConfigurationText:'{}'},{...f.payload,expectedConfigurationText:'中'.repeat(6000)}])assert.throws(()=>f.run(value),{code:'LOCAL_EXECUTION_SELECTION_PAYLOAD'});
  f.assertUnchanged();
});

test('a different current REQUEST path cannot adopt the old token even if its bytes are identical',()=>{
  const f=fixture(),other=path.join(home,'MEMORY_ONLY_OTHER_REQUEST.json');f.put(other,f.io.readFileSync(f.requestFile,'utf8'));f.config.requestFile=other;
  assert.throws(()=>deriveExecutionSelection(f.config,f.dispatch,f.dependencies.observe(f.dispatch),taskRootFromPlan(f.plan)),{code:'LOCAL_EXECUTION_SELECTION_REQUEST_CHANGED'});f.assertUnchanged();
});

test('node/repository/editor changes invalidate the context while old root/id may be explicitly replaced',()=>{
  for(const key of ['nodeExecutable','repositoryRoot','editorExecutable']){const f=fixture(),current={...f.config,[key]:f.config[key]+'-changed'};assert.throws(()=>deriveExecutionSelection(current,f.dispatch,f.dependencies.observe(f.dispatch),f.root),{code:'LOCAL_EXECUTION_SELECTION_ENVIRONMENT_CHANGED'});f.assertUnchanged();}
  const f=fixture(),current={...f.config,taskRoot:path.join(home,'OLD_SELECTION'),taskId:'old-task'};assert.deepEqual(deriveExecutionSelection(current,f.dispatch,f.dependencies.observe(f.dispatch),f.root),{requestFile:f.requestFile,taskRoot:f.root,taskId:f.owner.taskId});
});

test('REQUEST/config drift, missing/partial/linked TASK and wrong recipe cannot be selected',()=>{
  for(const fault of ['request','config','missing','partial','link','recipe']){
    const f=fixture(),ownerFile=path.join(f.root,'TASK.json');
    if(fault==='request')f.put(f.requestFile,{changed:true});if(fault==='config')f.put(f.inputFile,{changed:true});if(fault==='missing')f.files.delete(ownerFile);if(fault==='partial')f.put(ownerFile,'{');if(fault==='link')f.files.get(ownerFile).link=true;if(fault==='recipe')f.put(ownerFile,{...f.owner,recipeId:'wrong'});
    assert.throws(()=>f.run(),{code:'LOCAL_EXECUTION_SELECTION_UNBOUND'});f.assertUnchanged();
  }
});

test('shared status identity and incomplete snapshot bindings are checked rather than trusting stdout task IDs',()=>{
  for(const key of ['taskId','recipeId','action','profile','packageId','requestSha256','configurationSha256','inputBinding']){
    const f=fixture();f.assessment[key]='wrong';assert.throws(()=>f.run(),{code:'LOCAL_EXECUTION_SELECTION_UNBOUND'});f.assertUnchanged();
  }
  const f=fixture(),observed=f.dependencies.observe(f.dispatch);observed.taskRoot=path.join(home,'wrong-output');assert.throws(()=>deriveExecutionSelection(f.config,f.dispatch,observed,f.root),{code:'LOCAL_EXECUTION_SELECTION_MISMATCH'});
});

test('first-owner binding prevents a same-root replacement during the final observation',()=>{
  const f=fixture();f.onObserve=n=>{if(n===2){f.put(path.join(f.root,'TASK.json'),{...f.owner,taskId:'replaced-task'});f.assessment.taskId='replaced-task';}};
  assert.throws(()=>f.run(),{code:'LOCAL_EXECUTION_SELECTION_UNBOUND'});f.assertUnchanged();
});

test('unknown/stale dispatch token and bounded two-file preparation do not invent a task directory',()=>{
  const unknown=fixture();assert.throws(()=>unknown.run({...unknown.payload,executionToken:'123-111'}),{code:'ENOENT'});unknown.assertUnchanged();
  const mismatch=fixture();mismatch.put(mismatch.dispatchFile,{...mismatch.dispatch,executionToken:'123-112'});assert.throws(()=>mismatch.run());mismatch.assertUnchanged();
  const bounded=fixture();bounded.dispatch.preparation.assessment.action='official-pair-prepare';bounded.dispatch.preparation.assessment.executionMode='bounded-files';bounded.put(bounded.dispatchFile,bounded.dispatch);
  assert.throws(()=>bounded.run(),{code:'LOCAL_BOUNDED_FILES_NO_TASK_ROOT'});bounded.assertUnchanged();
});

test('stale original config and an external change during CAS are never silently overwritten',()=>{
  const stale=fixture();stale.put(stale.configFile,{...stale.config,taskId:'newer-selection'});const changed=stale.currentText();assert.throws(()=>stale.run());assert.equal(stale.currentText(),changed);
  const drift=fixture();drift.driftAtRead=3;assert.throws(()=>drift.run());assert.equal(JSON.parse(drift.currentText()).taskId,'concurrent-change');assert.equal(drift.files.has(path.join(drift.logs,'selection.lock')),false);
});

test('cooperative lock and rename failure retain current configuration and release only this operation temporary files',()=>{
  const locked=fixture();locked.put(path.join(locked.logs,'selection.lock'),'foreign lock');assert.throws(()=>locked.run(),{code:'EEXIST'});locked.assertUnchanged();assert.equal(locked.io.readFileSync(path.join(locked.logs,'selection.lock'),'utf8'),'foreign lock');
  const failed=fixture();failed.renameFailure=true;assert.throws(()=>failed.run(),{code:'EACCES'});failed.assertUnchanged();assert.equal(failed.files.has(path.join(failed.logs,'selection.lock')),false);assert(![...failed.files.keys()].some(file=>file.endsWith('.tmp')));
});

test('pure selection derivation does not mutate inputs or return a shared mutable selection',()=>{
  const f=fixture(),observation=f.dependencies.observe(f.dispatch),before=structuredClone({current:f.config,dispatch:f.dispatch,observation});
  const result=deriveExecutionSelection(f.config,f.dispatch,observation,f.root);result.taskId='caller-edit';assert.deepEqual({current:f.config,dispatch:f.dispatch,observation},before);assert.equal(deriveExecutionSelection(f.config,f.dispatch,observation,f.root).taskId,f.owner.taskId);
});
