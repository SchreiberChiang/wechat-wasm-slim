/* Shared ES2016 caller-event state core; no globals or platform operations. */
(function(){'use strict';
function createResourceLoadStateCore(){
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
// Pure caller-event coordination. Intents do not call wx, FS, Godot or timers.
// v2 is the same-day, unshipped source contract; no production restoration migration.
const SCHEMA='wxslim-resource-load-state-v2';
const identityKeys=['taskId','attemptId','engineSessionId','packId'];
const phases=new Set(['READY','DOWNLOADING','VERIFYING','STAGING','MOUNTING','SCENE_LOADING','COMMITTING','RECEIPT_FAILED','ENDED']);
const terminals=new Set(['SUCCESS','FAILED','CANCELLED']);
const operations=new Set(['DOWNLOADING','VERIFYING','STAGING','MOUNTING','SCENE_LOADING']);
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
const stateKeys=['schema','identity','phase','cancelRequested','observationTimedOut','mountState','mountDispatch','sceneDispatch','sceneMayHaveChanged','requestedTerminal','terminal','failure','rollbackPerformed','evidenceScope','executionAuthorized','runtimeVerified'];
const dispatchStates=new Set(['NOT_REQUESTED','INTENT_ONLY','DISPATCHED','NOT_DISPATCHED','FAILED_BEFORE_DISPATCH']);
const events=new Set(['START','CANCEL','DOWNLOAD_PROGRESS','DOWNLOAD_COMPLETE','DOWNLOAD_OBSERVATION_TIMEOUT','DOWNLOAD_SUCCESS','DOWNLOAD_FAILURE','VERIFY_SUCCESS','VERIFY_FAILURE','STAGE_SUCCESS','STAGE_FAILURE','MOUNT_DISPATCHED','MOUNT_NOT_DISPATCHED','MOUNT_DISPATCH_FAILED','MOUNT_SUCCESS','MOUNT_FAILURE','SCENE_DISPATCHED','SCENE_NOT_DISPATCHED','SCENE_DISPATCH_FAILED','SCENE_SUCCESS','SCENE_FAILURE','COMMIT_SUCCESS','COMMIT_FAILURE']);
function fail(code){throw Object.assign(Error(code),{code});}
function need(value,code){if(!value)fail(code);}
function plain(value,seen=new Set()){
  if(value===null||['string','boolean'].includes(typeof value))return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object'||seen.has(value)||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))return false;
  seen.add(value);
  const valid=Reflect.ownKeys(value).every(k=>typeof k==='string')&&Reflect.ownKeys(value).map(k=>Object.getOwnPropertyDescriptor(value,k)).every(d=>'value'in d&&plain(d.value,seen));
  seen.delete(value);return valid;
}
function identity(value){
  need(plain(value)&&value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===4&&identityKeys.every(k=>typeof value[k]==='string'&&value[k].length>0&&value[k].length<=128&&!/[\u0000-\u001f\u007f]/.test(value[k])),'RESOURCE_LOAD_IDENTITY_INVALID');
  const result={};identityKeys.forEach(k=>{result[k]=value[k];});return result;
}
function freeze(value){if(value&&typeof value==='object'){for(const key of Object.keys(value))freeze(value[key]);Object.freeze(value);}return value;}
const clone=value=>JSON.parse(JSON.stringify(value));
function terminalConsistent(state,terminal){
  if(!terminal||Array.isArray(terminal)||!hasOwn(terminal,'status')||Object.keys(terminal).some(k=>!['status','cancelDisposition'].includes(k))||!terminals.has(terminal.status))return false;
  if(terminal.status!==state.requestedTerminal&&!(state.requestedTerminal==='SUCCESS'&&terminal.status==='CANCELLED'&&state.cancelRequested))return false;
  if(terminal.status==='SUCCESS'&&state.cancelRequested)return terminal.cancelDisposition==='ALREADY_ENDED';
  return terminal.cancelDisposition===undefined;
}
// Checks internal consistency of restored data only, not operation history or
// authenticity. Persistence and serialized callback delivery belong to callers.
function validateState(state){
  need(plain(state)&&state&&state.schema===SCHEMA&&Object.keys(state).length===stateKeys.length&&stateKeys.every(k=>hasOwn(state,k))&&phases.has(state.phase)&&['NOT_ATTEMPTED','UNKNOWN_DIRTY','MOUNTED'].includes(state.mountState)&&['cancelRequested','observationTimedOut','sceneMayHaveChanged'].every(k=>typeof state[k]==='boolean')&&state.executionAuthorized===false&&state.runtimeVerified===false&&state.rollbackPerformed===false&&state.evidenceScope==='CALLER_EVENTS_ONLY_NOT_RUNTIME_VERIFIED','RESOURCE_LOAD_STATE_INVALID');
  identity(state.identity);
  need(dispatchStates.has(state.mountDispatch)&&dispatchStates.has(state.sceneDispatch),'RESOURCE_LOAD_STATE_INVALID');
  need((state.mountDispatch==='DISPATCHED')===(state.mountState!=='NOT_ATTEMPTED'),'RESOURCE_LOAD_STATE_INVALID');
  need(state.sceneMayHaveChanged===(state.sceneDispatch==='DISPATCHED'),'RESOURCE_LOAD_STATE_INVALID');
  if(state.sceneDispatch!=='NOT_REQUESTED')need(state.mountState==='MOUNTED','RESOURCE_LOAD_STATE_INVALID');
  if(state.mountDispatch==='NOT_DISPATCHED'||state.sceneDispatch==='NOT_DISPATCHED')need(state.cancelRequested,'RESOURCE_LOAD_STATE_INVALID');
  // A pre-send failure must remain distinguishable from an attempted operation.
  if(state.mountDispatch==='FAILED_BEFORE_DISPATCH')need((state.failure==null?undefined:state.failure.phase)==='MOUNTING'&&state.sceneDispatch==='NOT_REQUESTED','RESOURCE_LOAD_STATE_INVALID');
  if(state.sceneDispatch==='FAILED_BEFORE_DISPATCH')need((state.failure==null?undefined:state.failure.phase)==='SCENE_LOADING','RESOURCE_LOAD_STATE_INVALID');
  const completing=['COMMITTING','RECEIPT_FAILED','ENDED'].includes(state.phase);
  need(completing?terminals.has(state.requestedTerminal):state.requestedTerminal===null,'RESOURCE_LOAD_STATE_INVALID');
  need(state.phase==='ENDED'?terminalConsistent(state,state.terminal):state.terminal===null,'RESOURCE_LOAD_STATE_INVALID');
  need(state.failure===null||(completing&&state.failure&&typeof state.failure==='object'&&!Array.isArray(state.failure)&&Object.keys(state.failure).length===2&&operations.has(state.failure.phase)&&typeof state.failure.code==='string'&&CODE.test(state.failure.code)),'RESOURCE_LOAD_STATE_INVALID');
  if(state.phase==='READY')need(!state.cancelRequested&&!state.observationTimedOut,'RESOURCE_LOAD_STATE_INVALID');
  if(['READY','DOWNLOADING','VERIFYING','STAGING'].includes(state.phase))need(state.mountDispatch==='NOT_REQUESTED'&&state.sceneDispatch==='NOT_REQUESTED','RESOURCE_LOAD_STATE_INVALID');
  if(state.phase==='MOUNTING')need(['INTENT_ONLY','DISPATCHED'].includes(state.mountDispatch)&&state.mountState!=='MOUNTED'&&state.sceneDispatch==='NOT_REQUESTED','RESOURCE_LOAD_STATE_INVALID');
  if(state.phase==='SCENE_LOADING')need(state.mountState==='MOUNTED'&&['INTENT_ONLY','DISPATCHED'].includes(state.sceneDispatch),'RESOURCE_LOAD_STATE_INVALID');
  if(state.sceneMayHaveChanged)need(state.mountState==='MOUNTED','RESOURCE_LOAD_STATE_INVALID');
  if(completing){
    need(state.mountDispatch!=='INTENT_ONLY'&&state.sceneDispatch!=='INTENT_ONLY','RESOURCE_LOAD_STATE_INVALID');
    if(state.mountDispatch==='NOT_DISPATCHED'||state.sceneDispatch==='NOT_DISPATCHED')need(state.requestedTerminal==='CANCELLED'&&state.failure===null,'RESOURCE_LOAD_STATE_INVALID');
    if(state.mountState==='UNKNOWN_DIRTY')need((state.failure==null?undefined:state.failure.phase)==='MOUNTING','RESOURCE_LOAD_STATE_INVALID');
    if(state.requestedTerminal==='SUCCESS')need(state.failure===null&&state.mountState==='MOUNTED'&&state.sceneMayHaveChanged,'RESOURCE_LOAD_STATE_INVALID');
    if(state.requestedTerminal==='FAILED')need(state.failure!==null,'RESOURCE_LOAD_STATE_INVALID');
    if(state.requestedTerminal==='CANCELLED')need(state.cancelRequested,'RESOURCE_LOAD_STATE_INVALID');
    if(state.failure){
      const phase=state.failure.phase;
      if(['DOWNLOADING','VERIFYING','STAGING'].includes(phase))need(state.mountDispatch==='NOT_REQUESTED'&&state.sceneDispatch==='NOT_REQUESTED','RESOURCE_LOAD_STATE_INVALID');
      if(phase==='MOUNTING')need((state.mountDispatch==='FAILED_BEFORE_DISPATCH'||state.mountState==='UNKNOWN_DIRTY')&&state.sceneDispatch==='NOT_REQUESTED','RESOURCE_LOAD_STATE_INVALID');
      if(phase==='SCENE_LOADING')need(state.mountState==='MOUNTED'&&['DISPATCHED','FAILED_BEFORE_DISPATCH'].includes(state.sceneDispatch),'RESOURCE_LOAD_STATE_INVALID');
    }
  }
}

function initialResourceLoadState(value){
  return freeze({schema:SCHEMA,identity:identity(value),phase:'READY',cancelRequested:false,observationTimedOut:false,
    // terminal:null means no confirmed receipt, never proof that disk has none.
    mountState:'NOT_ATTEMPTED',mountDispatch:'NOT_REQUESTED',sceneDispatch:'NOT_REQUESTED',sceneMayHaveChanged:false,requestedTerminal:null,terminal:null,failure:null,
    rollbackPerformed:false,evidenceScope:'CALLER_EVENTS_ONLY_NOT_RUNTIME_VERIFIED',executionAuthorized:false,runtimeVerified:false});
}

/** Every event has {type, identity, details?}; COMMIT_SUCCESS also has status.
 * MOUNT_DISPATCHED / SCENE_DISPATCHED record caller evidence of sending, even
 * when cancellation raced with that send. Only then are operation callbacks valid.
 * After CANCEL, MOUNT_NOT_DISPATCHED / SCENE_NOT_DISPATCHED explicitly settle an
 * INTENT_ONLY operation the caller prevented from being sent. No abort is implied.
 * MOUNT_DISPATCH_FAILED / SCENE_DISPATCH_FAILED settle a pre-send failure with
 * details.code (or the event name), preserving failure even if cancellation raced.
 * Restored v2 consistency checks do not authenticate caller evidence or history.
 */
function advanceResourceLoad(previous,event){
  validateState(previous);
  need(plain(event)&&event&&typeof event==='object'&&!Array.isArray(event)&&Object.keys(event).every(k=>['type','identity','details','status'].includes(k))&&events.has(event.type),'RESOURCE_LOAD_EVENT_INVALID');
  const incoming=identity(event.identity),state=clone(previous),intents=[];
  const result=disposition=>({state:freeze(state),intents:freeze(intents),disposition});
  if(identityKeys.some(k=>incoming[k]!==state.identity[k]))return result('IGNORED_IDENTITY');
  if(state.phase==='ENDED')return result('IGNORED_TERMINAL');
  if(state.phase==='RECEIPT_FAILED')return result('IGNORED_STATE');
  const intent=(type,extra={})=>intents.push(Object.assign({type,identity:Object.assign({},state.identity)},extra));
  const commit=status=>{
    state.phase='COMMITTING';state.requestedTerminal=status;
    intent('COMMIT_TERMINAL',{status,details:{mountState:state.mountState,mountDispatch:state.mountDispatch,sceneDispatch:state.sceneDispatch,mountedPacksRetained:state.mountState==='MOUNTED',partialMountPossible:state.mountState==='UNKNOWN_DIRTY',sceneMayHaveChanged:state.sceneMayHaveChanged,rollbackPerformed:false,runtimeVerified:false,failure:state.failure}});
  };
  if(event.type==='CANCEL'){
    if(state.cancelRequested)return result('IGNORED_DUPLICATE');
    state.cancelRequested=true;
    if(state.phase==='READY')commit('CANCELLED');
    else intent('REQUEST_CANCEL'); // No abort, unload or rollback intent exists.
    return result('APPLIED');
  }
  if(state.phase==='COMMITTING'){
    if(event.type==='COMMIT_FAILURE'){
      state.phase='RECEIPT_FAILED';state.terminal=null;
      return result('APPLIED');
    }
    if(event.type!=='COMMIT_SUCCESS')return result('IGNORED_STATE');
    // A late cancellation may lose to an already durable terminal. Require the
    // caller to explicitly report that result; never infer it from event timing.
    const terminal={status:event.status};if(event.details!=null&&event.details.cancelDisposition!==undefined)terminal.cancelDisposition=event.details.cancelDisposition;
    need(terminalConsistent(state,terminal),'RESOURCE_LOAD_TERMINAL_INVALID');
    state.phase='ENDED';state.terminal=terminal;
    return result('APPLIED');
  }
  if(state.phase==='READY'){
    if(event.type!=='START')return result('IGNORED_STATE');
    state.phase='DOWNLOADING';intent('START_DOWNLOAD');return result('APPLIED');
  }
  if(state.phase==='DOWNLOADING'&&event.type==='DOWNLOAD_OBSERVATION_TIMEOUT'){
    state.observationTimedOut=true;return result('APPLIED');
  }
  // Neither progress nor complete settles the actual load request.
  if(event.type==='DOWNLOAD_PROGRESS'||event.type==='DOWNLOAD_COMPLETE')return result('IGNORED_STATE');
  // These are caller observations at the send boundary, not effects of an intent.
  for(const [phase,prefix,key]of [['MOUNTING','MOUNT','mountDispatch'],['SCENE_LOADING','SCENE','sceneDispatch']]){
    if(state.phase!==phase)continue;
    if(event.type===`${prefix}_DISPATCHED`){
      if(state[key]!=='INTENT_ONLY')return result('IGNORED_STATE');
      state[key]='DISPATCHED';
      if(prefix==='MOUNT')state.mountState='UNKNOWN_DIRTY';else state.sceneMayHaveChanged=true;
      return result('APPLIED');
    }
    if(event.type===`${prefix}_NOT_DISPATCHED`){
      if(state[key]!=='INTENT_ONLY'||!state.cancelRequested)return result('IGNORED_STATE');
      state[key]='NOT_DISPATCHED';commit('CANCELLED');return result('APPLIED');
    }
    if(event.type===`${prefix}_DISPATCH_FAILED`){
      if(state[key]!=='INTENT_ONLY')return result('IGNORED_STATE');
      const code=(event.details==null||event.details.code==null?event.type:event.details.code);
      need(typeof code==='string'&&CODE.test(code),'RESOURCE_LOAD_EVENT_INVALID');
      state[key]='FAILED_BEFORE_DISPATCH';state.failure={phase,code};
      commit(state.cancelRequested?'CANCELLED':'FAILED');return result('APPLIED');
    }
  }
  const callbacks={DOWNLOADING:['DOWNLOAD_SUCCESS','DOWNLOAD_FAILURE'],VERIFYING:['VERIFY_SUCCESS','VERIFY_FAILURE'],STAGING:['STAGE_SUCCESS','STAGE_FAILURE'],MOUNTING:['MOUNT_SUCCESS','MOUNT_FAILURE'],SCENE_LOADING:['SCENE_SUCCESS','SCENE_FAILURE']};
  const accepted=callbacks[state.phase];
  if((!accepted||!accepted.includes(event.type)))return result('IGNORED_STATE');
  if((state.phase==='MOUNTING'&&state.mountDispatch!=='DISPATCHED')||(state.phase==='SCENE_LOADING'&&state.sceneDispatch!=='DISPATCHED'))return result('IGNORED_STATE');
  const operation=state.phase;
  if(event.type===accepted[1]){
    const code=(event.details==null||event.details.code==null?event.type:event.details.code);
    need(typeof code==='string'&&CODE.test(code),'RESOURCE_LOAD_EVENT_INVALID');
    state.failure={phase:operation,code};
    commit(state.cancelRequested?'CANCELLED':'FAILED');return result('APPLIED');
  }
  if(operation==='MOUNTING')state.mountState='MOUNTED';
  if(state.cancelRequested){commit('CANCELLED');return result('APPLIED');}
  if(operation==='DOWNLOADING'){state.phase='VERIFYING';intent('VERIFY_BYTES');}
  else if(operation==='VERIFYING'){state.phase='STAGING';intent('STAGE_BYTES');}
  else if(operation==='STAGING'){
    state.mountDispatch='INTENT_ONLY';state.phase='MOUNTING';intent('MOUNT_PACK');
  }else if(operation==='MOUNTING'){
    state.sceneDispatch='INTENT_ONLY';state.phase='SCENE_LOADING';intent('LOAD_SCENE');
  }else commit('SUCCESS');
  return result('APPLIED');
}

return Object.freeze({initialResourceLoadState:initialResourceLoadState,advanceResourceLoad:advanceResourceLoad});
}
if(typeof module==='object'&&module.exports)module.exports=createResourceLoadStateCore;
}());
