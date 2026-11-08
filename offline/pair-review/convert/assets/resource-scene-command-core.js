/* Shared ES2016 scene coordinator; caller injects the unique state-core dependency. */
(function(){'use strict';
function createResourceSceneCommandCore(dependencies){
const advanceResourceLoad=dependencies&&dependencies.advanceResourceLoad;
if(typeof advanceResourceLoad!=='function')throw new TypeError('RESOURCE_CORE_DEPENDENCY_REQUIRED');
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
// Explicit LOAD_SCENE coordinator. No engine, FS, scene or receipt calls here.
const copy=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.keys(value).forEach(key=>freeze(value[key]));Object.freeze(value);}return value;}
function normalizeData(value,seen=new Set()){
  if(value===null||['string','boolean'].includes(typeof value))return value;
  if(typeof value==='number'){need(Number.isFinite(value),'RESOURCE_SCENE_DATA_INVALID');return value;}
  need(typeof value==='object'&&!seen.has(value),'RESOURCE_SCENE_DATA_INVALID');
  const prototype=Object.getPrototypeOf(value);
  need(Array.isArray(value)||prototype===null||Object.getPrototypeOf(prototype)===null,'RESOURCE_SCENE_DATA_INVALID');
  seen.add(value);const result=Array.isArray(value)?[]:{};
  for(const key of Reflect.ownKeys(value)){
    if(Array.isArray(value)&&key==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    need(typeof key==='string'&&descriptor&&'value'in descriptor,'RESOURCE_SCENE_DATA_INVALID');
    Object.defineProperty(result,key,{value:normalizeData(descriptor.value,seen),enumerable:true,writable:true,configurable:true});
  }
  seen.delete(value);return result;
}
function plain(value){try{normalizeData(value);return true;}catch(ignored){return false;}}
function boundedUtf8(text){if(typeof text!=='string')return false;let bytes=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c<128)bytes++;else if(c<2048)bytes+=2;else if(c>=0xd800&&c<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}else bytes+=3;if(bytes>262144)return false;}return true;}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>hasOwn(value,k));
function canonical(value){return value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'):JSON.stringify(value);}
const equal=(a,b)=>canonical(a)===canonical(b);
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
const code=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value);
const safeError=cause=>code((cause==null?undefined:cause.code))?cause.code:null;
const PREINVOKE=new Set(['CANCEL_CHECK','NOT_ACTIVE','PENDING','OP','PACK_REQUIRED','PACK','BEGIN_REQUIRED','FAILURE_LATCHED','BYTES','UNEXPECTED_BYTES','REQUEST_ID_LIMIT','JSON_LIMIT','CANCELLED_BEFORE_INVOKE','PREINVOKE_FAILED','ENTRY_SCENE_NOT_DECLARED'].map(c=>'RESOURCE_COMMAND_'+c));
const evidenceKeys=['schema','entryScene','loadedResourcePath','resourceLoadAttempted','packedSceneVerified','canInstantiate','instantiated','targetInstanceId','signalConnectError','changeAttempted','changeError','submitted','sceneChangedObserved','currentSceneId','currentScenePath','exactInstance','parentIsRoot','insideTree','nodeReady','queuedForDeletion','guardState','state','rollbackPerformed','visualVerified','evidenceScope'];

function createResourceSceneCommand({bridge,state:input,boot}){
  need(bridge&&typeof bridge.dispatchTracked==='function'&&typeof (bridge.interface==null?undefined:bridge.interface.configuration)==='function','RESOURCE_SCENE_BRIDGE_INVALID');
  advanceResourceLoad(input,{type:'DOWNLOAD_COMPLETE',identity:(input==null?undefined:input.identity)});
  need(input.phase==='SCENE_LOADING'&&input.sceneDispatch==='INTENT_ONLY'&&input.mountState==='MOUNTED','RESOURCE_SCENE_STATE_INVALID');
  let config;
  try{const text=bridge.interface.configuration();need(boundedUtf8(text),'RESOURCE_SCENE_CONFIG_INVALID');config=JSON.parse(text);}catch(ignored){throw Object.assign(Error('RESOURCE_SCENE_CONFIG_INVALID'),{code:'RESOURCE_SCENE_CONFIG_INVALID'});}
  const identity={taskId:input.identity.taskId,attemptId:input.identity.attemptId,engineSession:input.identity.engineSessionId};
  need(exact(config,['schema','identity','boot','manifest'])&&config.schema==='wxslim-resource-command-config-v1'&&equal(config.identity,identity),'RESOURCE_SCENE_IDENTITY_INVALID');
  need(exact(boot,['packageId','pckSha256','wasmSha256'])&&equal(config.boot,boot),'RESOURCE_SCENE_BOOT_INVALID');
  need(exact(config.manifest,['packs'])&&Array.isArray(config.manifest.packs)&&config.manifest.packs.filter(p=>(p==null?undefined:p.id)===input.identity.packId).length===1,'RESOURCE_SCENE_PACK_INVALID');
  const target=config.manifest.packs.find(p=>p.id===input.identity.packId),entry=target.entryScene;
  need(typeof entry==='string'&&entry.length<=1024&&/^res:\/\/.+\.(tscn|scn)$/.test(entry)&&entry.slice(6).split('/').every(p=>p&&p!=='.'&&p!=='..')&&!/[\\\u0000-\u001f\u007f]/.test(entry),'RESOURCE_SCENE_ENTRY_INVALID');
  let state=copy(input),started=false,cancelled=state.cancelRequested,tracked=null,handedOff=false,outcome='READY',invocation=null,report=null,observedReport=null,unknownCode=null,transportErrorCode=null,cancelErrorCode=null;
  const intents=[];
  const apply=(type,extra={})=>{const next=advanceResourceLoad(state,Object.assign({type,identity:state.identity},extra));need(next.disposition==='APPLIED','RESOURCE_SCENE_TRANSITION_INVALID');state=next.state;Array.prototype.push.apply(intents,next.intents);};
  const snapshot=()=>{
    const evidence=(report==null?undefined:report.result.evidence)||(observedReport==null||observedReport.result==null?undefined:observedReport.result.evidence)||null;
    return freeze(copy({schema:'wxslim-resource-scene-command-v1',state,outcome,invocation,report,observedReport,intents,unknownCode,transportErrorCode,cancelErrorCode,stateOwner:handedOff?'CALLER':'ADAPTER',started,cancelRequested:cancelled,
      sceneExecuted:evidence?evidence.resourceLoadAttempted:((invocation==null?undefined:invocation.status)==='NOT_INVOKED'||!started?false:null),sceneChangeAttempted:evidence?evidence.changeAttempted:null,sceneTreeConfirmed:evidence?evidence.state==='TREE_CONFIRMED':null,
      sceneExecutedMeaning:'Observed resourceLoadAttempted, not callback count or visual rendering',visualVerified:false,receiptWritten:false,runtimeVerified:false,evidenceScope:'CALLER_AND_COMMAND_TRANSPORT_ONLY'}));
  };
  const finish=()=>{handedOff=true;return snapshot();};
  const unknown=reason=>{
    outcome='UNKNOWN';unknownCode=reason;
    try{const current=typeof bridge.status==='function'?bridge.status():undefined;const raw=current&&current.pending?current.pending.observedReport:undefined;if(raw){const value=normalizeData(raw);if(equal(value.identity,identity)&&value.op==='LOAD_SCENE'&&value.packId===state.identity.packId&&(!invocation||value.requestId===(invocation.header==null?undefined:invocation.header.requestId))){validateReport(value,(invocation==null||invocation.header==null?undefined:invocation.header.requestId));observedReport=value;}}}catch(ignored){}
    return finish();
  };
  function validTicket(value){
    if(!plain(value)||!exact(value,['schema','identity','status','code','header','sideEffects','runtimeVerified'])||value.schema!=='wxslim-resource-command-invocation-v1'||!equal(value.identity,identity)||value.runtimeVerified!==false)return false;
    if(value.status==='NOT_INVOKED')return value.header===null&&value.sideEffects==='NOT_INVOKED'&&PREINVOKE.has(value.code);
    const h=value.header;return value.status==='INVOKED'&&value.code==='RESOURCE_COMMAND_CALLBACK_INVOKED'&&value.sideEffects==='UNKNOWN'&&exact(h,['schema','identity','requestId','op','packId'])&&h.schema==='wxslim-resource-command-v1'&&equal(h.identity,identity)&&h.op==='LOAD_SCENE'&&h.packId===state.identity.packId&&typeof h.requestId==='string'&&/^[1-9][0-9]{0,31}$/.test(h.requestId);
  }
  function validateReport(value,requestId){
    need(plain(value)&&boundedUtf8(JSON.stringify(value))&&exact(value,['schema','identity','requestId','op','packId','result','summary'])&&value.schema==='wxslim-resource-command-result-v1'&&equal(value.identity,identity)&&value.requestId===requestId&&value.op==='LOAD_SCENE'&&value.packId===state.identity.packId,'RESOURCE_SCENE_REPORT_INVALID');
    const r=value.result,s=value.summary;
    need(r&&typeof r.ok==='boolean'&&code(r.code),'RESOURCE_SCENE_REPORT_INVALID');
    need(exact(s,['schema','initialized','engineSession','operation','dirty','managedRootState','declaredBytes','heldVerifiedBytes','fsReservedUpperBoundBytes','packs','rollbackPerformed','sceneLoadAttempted','scope','memoryScope'])&&s.schema==='wxslim-godot-resource-session-v1'&&s.initialized===true&&s.engineSession===identity.engineSession&&typeof s.operation==='string'&&typeof s.dirty==='boolean'&&typeof s.managedRootState==='string'&&s.rollbackPerformed===false&&s.sceneLoadAttempted===false&&typeof s.scope==='string'&&typeof s.memoryScope==='string'&&Array.isArray(s.packs)&&s.packs.length===config.manifest.packs.length,'RESOURCE_SCENE_SUMMARY_INVALID');
    for(const key of ['declaredBytes','heldVerifiedBytes','fsReservedUpperBoundBytes'])need(Number.isSafeInteger(s[key])&&s[key]>=0&&s[key]<=64*1024*1024,'RESOURCE_SCENE_SUMMARY_INVALID');
    const basePackKeys=['id','bytes','sha256','entryScene','requires','state','fileState','mountState','mountCalls','lastError','fileResiduePossible'],optionalPackKeys=['verifiedBytes','verifiedSha256','stagedBytes','stagedSha256'];
    const seen=new Set();for(const p of s.packs){const pin=config.manifest.packs.find(pin=>pin.id===(p==null?undefined:p.id));need(pin&&!seen.has(p.id)&&basePackKeys.every(k=>hasOwn(p,k))&&Object.keys(p).every(k=>basePackKeys.includes(k)||optionalPackKeys.includes(k)),'RESOURCE_SCENE_SUMMARY_INVALID');seen.add(p.id);for(const key of ['id','bytes','sha256','entryScene','requires'])need(equal(p[key],pin[key]),'RESOURCE_SCENE_SUMMARY_INVALID');need(['DECLARED','VERIFIED','VERIFY_FAILED','STAGING','STAGE_FAILED','STAGED_VERIFIED','UNKNOWN_DIRTY','MOUNT_FAILED','MOUNTED'].includes(p.state)&&typeof p.fileState==='string'&&['NOT_ATTEMPTED','UNKNOWN_DIRTY','MOUNTED'].includes(p.mountState)&&[0,1].includes(p.mountCalls)&&typeof p.lastError==='string'&&typeof p.fileResiduePossible==='boolean','RESOURCE_SCENE_SUMMARY_INVALID');}
    need(s.declaredBytes===config.manifest.packs.reduce((n,p)=>n+p.bytes,0),'RESOURCE_SCENE_SUMMARY_INVALID');
    if(!hasOwn(r,'evidence')){need(!r.ok&&exact(r,hasOwn(r,'engineError')?['ok','code','engineError']:['ok','code']),'RESOURCE_SCENE_REPORT_INVALID');if('engineError'in r)need(Number.isSafeInteger(r.engineError)&&r.engineError>=0,'RESOURCE_SCENE_REPORT_INVALID');return;}
    need(exact(r,['ok','code','evidence'])&&exact(r.evidence,evidenceKeys),'RESOURCE_SCENE_REPORT_INVALID');const e=r.evidence;
    need(e.schema==='wxslim-resource-scene-evidence-v1'&&e.entryScene===entry&&e.rollbackPerformed===false&&e.visualVerified===false&&e.evidenceScope==='NATIVE_OR_WEB_SCENE_TREE_ONLY','RESOURCE_SCENE_EVIDENCE_INVALID');
    for(const key of ['loadedResourcePath','currentScenePath'])need(e[key]===null||(typeof e[key]==='string'&&e[key].length<=1024&&(e[key]===''||e[key].startsWith('res://'))),'RESOURCE_SCENE_EVIDENCE_INVALID');
    for(const key of ['resourceLoadAttempted','packedSceneVerified','instantiated','changeAttempted','submitted','sceneChangedObserved'])need(typeof e[key]==='boolean','RESOURCE_SCENE_EVIDENCE_INVALID');
    for(const key of ['canInstantiate','exactInstance','parentIsRoot','insideTree','nodeReady','queuedForDeletion'])need(e[key]===null||typeof e[key]==='boolean','RESOURCE_SCENE_EVIDENCE_INVALID');
    for(const key of ['targetInstanceId','currentSceneId'])need(e[key]===null||(typeof e[key]==='string'&&/^[1-9][0-9]{0,31}$/.test(e[key])),'RESOURCE_SCENE_EVIDENCE_INVALID');
    for(const key of ['signalConnectError','changeError'])need(e[key]===null||(Number.isSafeInteger(e[key])&&e[key]>=0),'RESOURCE_SCENE_EVIDENCE_INVALID');
    need(['NOT_CHECKED','ALLOWED','DENIED','INVALID'].includes(e.guardState)&&['NOT_ATTEMPTED','PREPARE_FAILED','NOT_SUBMITTED','SUBMITTED_UNCONFIRMED','TREE_CONFIRMED','UNKNOWN_AFTER_SUBMIT'].includes(e.state),'RESOURCE_SCENE_EVIDENCE_INVALID');
    need(!e.submitted||(e.changeAttempted&&e.changeError===0&&e.instantiated),'RESOURCE_SCENE_EVIDENCE_INVALID');need(!e.instantiated||(e.packedSceneVerified&&e.canInstantiate===true&&e.targetInstanceId!==null),'RESOURCE_SCENE_EVIDENCE_INVALID');need(!e.changeAttempted||(e.instantiated&&e.signalConnectError===0),'RESOURCE_SCENE_EVIDENCE_INVALID');
    const mounted=s.packs.find(p=>p.id===target.id);need(mounted.state==='MOUNTED'&&mounted.mountState==='MOUNTED'&&mounted.mountCalls===1&&mounted.verifiedBytes===target.bytes&&mounted.verifiedSha256===target.sha256&&mounted.stagedBytes===target.bytes&&mounted.stagedSha256===target.sha256&&mounted.fileState==='VERIFIED_READBACK','RESOURCE_SCENE_MOUNT_EVIDENCE_INVALID');
    if(e.state==='TREE_CONFIRMED'||r.ok)need(e.state==='TREE_CONFIRMED'&&e.resourceLoadAttempted&&e.packedSceneVerified&&e.canInstantiate===true&&e.instantiated&&e.submitted&&e.sceneChangedObserved&&e.targetInstanceId===e.currentSceneId&&e.exactInstance===true&&e.parentIsRoot===true&&e.insideTree===true&&e.nodeReady===true&&e.queuedForDeletion===false&&e.loadedResourcePath===entry&&e.currentScenePath===entry,'RESOURCE_SCENE_EVIDENCE_INVALID');
    if(r.ok)need(r.code==='SCENE_TREE_CONFIRMED'&&e.guardState==='ALLOWED'&&!s.dirty&&s.operation==='','RESOURCE_SCENE_EVIDENCE_INVALID');
  }
  function latchCancel(){if(tracked&&typeof tracked.cancel==='function'){try{tracked.cancel();}catch(cause){cancelErrorCode=safeError(cause)||'RESOURCE_SCENE_CANCEL_LATCH_FAILED';}}}
  function performStart(){
      need(!started,'RESOURCE_SCENE_START_ONCE');started=true;outcome='RUNNING';
      try{tracked=bridge.dispatchTracked('LOAD_SCENE',state.identity.packId,undefined,{cancelRequested:()=>cancelled});}catch(ignored){return unknown('RESOURCE_SCENE_NO_INVOCATION_EVIDENCE');}
      let observed;try{observed=Promise.resolve((tracked==null?undefined:tracked.result)).then(value=>({ok:true,value}),cause=>({ok:false,code:safeError(cause)}));}catch(ignored){return unknown('RESOURCE_SCENE_TRACKING_INVALID');}
      if(!tracked||typeof (tracked.invocation==null?undefined:tracked.invocation.then)!=='function'||typeof (tracked.result==null?undefined:tracked.result.then)!=='function'||typeof tracked.cancel!=='function')return unknown('RESOURCE_SCENE_TRACKING_INVALID');
      if(cancelled)latchCancel();
      return Promise.resolve(tracked.invocation).then(function(rawTicket){
      let ticket;try{ticket=normalizeData(rawTicket);if(!validTicket(ticket))return unknown('RESOURCE_SCENE_INVOCATION_INVALID');}catch(ignored){return unknown('RESOURCE_SCENE_NO_INVOCATION_EVIDENCE');}
      invocation=copy(ticket);
      if(ticket.status==='NOT_INVOKED'){
        if(ticket.code==='RESOURCE_COMMAND_CANCELLED_BEFORE_INVOKE'){if(!cancelled)return unknown('RESOURCE_SCENE_CANCEL_EVIDENCE_INVALID');apply('SCENE_NOT_DISPATCHED');outcome='CANCELLED_BEFORE_INVOKE';}
        else{apply('SCENE_DISPATCH_FAILED',{details:{code:ticket.code}});outcome='PREINVOKE_FAILED';}return finish();
      }
      apply('SCENE_DISPATCHED');return observed.then(function(received){if(!received.ok){transportErrorCode=received.code;return unknown('RESOURCE_SCENE_RESULT_UNKNOWN');}
      let actual;try{actual=normalizeData(received.value);validateReport(actual,ticket.header.requestId);}catch(ignored){return unknown('RESOURCE_SCENE_REPORT_INVALID');}
      report=actual;
      if(report.result.ok)apply('SCENE_SUCCESS');else apply('SCENE_FAILURE',{details:{code:report.result.code}});
      outcome='SCENE_REPORTED';return finish();
      });
      },function(){return unknown('RESOURCE_SCENE_NO_INVOCATION_EVIDENCE');});
  }
  return Object.freeze({snapshot,cancel(){if(!handedOff&&!cancelled){cancelled=true;apply('CANCEL');latchCancel();}return snapshot();},
    start(){try{return Promise.resolve(performStart());}catch(cause){return Promise.reject(cause);}}
  });
}

return Object.freeze({createResourceSceneCommand:createResourceSceneCommand});
}
if(typeof module==='object'&&module.exports)module.exports=createResourceSceneCommandCore;
}());
