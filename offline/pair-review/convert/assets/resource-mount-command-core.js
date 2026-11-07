/* Shared ES2016 mount coordinator; caller injects the unique state-core dependency. */
(function(){'use strict';
function createResourceMountCommandCore(dependencies){
const advanceResourceLoad=dependencies&&dependencies.advanceResourceLoad;
if(typeof advanceResourceLoad!=='function')throw new TypeError('RESOURCE_CORE_DEPENDENCY_REQUIRED');
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
// Explicit MOUNT-only coordinator. No platform/FS/scene/receipt operations.
const copy=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.keys(value).forEach(key=>freeze(value[key]));Object.freeze(value);}return value;}
function canonical(value){return value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'):JSON.stringify(value);}
const equal=(a,b)=>canonical(a)===canonical(b);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>hasOwn(value,k));
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
const CODE=/^RESOURCE_COMMAND_[A-Z0-9_]{1,47}$/;
const PREINVOKE=new Set(['CANCEL_CHECK','NOT_ACTIVE','PENDING','OP','PACK_REQUIRED','PACK','BEGIN_REQUIRED','FAILURE_LATCHED','BYTES','UNEXPECTED_BYTES','REQUEST_ID_LIMIT','JSON_LIMIT','CANCELLED_BEFORE_INVOKE','PREINVOKE_FAILED'].map(code=>'RESOURCE_COMMAND_'+code));
function boundedUtf8(text){
  if(typeof text!=='string')return false;
  let bytes=0;
  for(let index=0;index<text.length;index++){
    const code=text.charCodeAt(index);
    if(code<128)bytes++;else if(code<2048)bytes+=2;
    else if(code>=0xd800&&code<=0xdbff&&index+1<text.length&&text.charCodeAt(index+1)>=0xdc00&&text.charCodeAt(index+1)<=0xdfff){bytes+=4;index++;}
    else bytes+=3;
    if(bytes>262144)return false;
  }
  return true;
}
const safeErrorCode=cause=>typeof (cause==null?undefined:cause.code)==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(cause.code)?cause.code:null;

function createResourceMountCommand({bridge,state:input,boot}){
  need(bridge&&typeof bridge.dispatchTracked==='function'&&typeof (bridge.interface==null?undefined:bridge.interface.configuration)==='function','RESOURCE_MOUNT_BRIDGE_INVALID');
  // Reuse the state machine's complete restoration validation, without advancing it.
  advanceResourceLoad(input,{type:'DOWNLOAD_COMPLETE',identity:(input==null?undefined:input.identity)});
  need(input.phase==='MOUNTING'&&input.mountDispatch==='INTENT_ONLY','RESOURCE_MOUNT_STATE_INVALID');
  let config;
  try{const raw=bridge.interface.configuration();need(boundedUtf8(raw),'RESOURCE_MOUNT_CONFIG_INVALID');config=JSON.parse(raw);}catch(ignored){throw Object.assign(Error('RESOURCE_MOUNT_CONFIG_INVALID'),{code:'RESOURCE_MOUNT_CONFIG_INVALID'});}
  const identity={taskId:input.identity.taskId,attemptId:input.identity.attemptId,engineSession:input.identity.engineSessionId};
  need(exact(config,['schema','identity','boot','manifest'])&&config.schema==='wxslim-resource-command-config-v1'&&equal(config.identity,identity),'RESOURCE_MOUNT_IDENTITY_INVALID');
  need(exact(boot,['packageId','pckSha256','wasmSha256'])&&equal(config.boot,boot),'RESOURCE_MOUNT_BOOT_INVALID');
  need(Array.isArray((config.manifest==null?undefined:config.manifest.packs))&&config.manifest.packs.filter(p=>p.id===input.identity.packId).length===1,'RESOURCE_MOUNT_PACK_INVALID');
  // This coordinator advances a target-scene transaction. Dependency-only pack
  // mounts use the command transport, never the LOAD_SCENE transition below.
  need(typeof config.manifest.packs.find(p=>p.id===input.identity.packId).entryScene==='string','RESOURCE_MOUNT_TARGET_HAS_NO_SCENE');
  // Input state is caller evidence, not proof of staged files or dependency mounts.
  // The actual helper remains responsible for deciding whether MOUNT is allowed.
  let state=copy(input),started=false,cancelled=state.cancelRequested,outcome='READY',invocation=null,report=null,observedReport=null,unknownCode=null,transportErrorCode=null,handedOff=false;
  const intents=[];
  const apply=(type,extra={})=>{const next=advanceResourceLoad(state,Object.assign({type,identity:state.identity},extra));need(next.disposition==='APPLIED','RESOURCE_MOUNT_TRANSITION_INVALID');state=next.state;Array.prototype.push.apply(intents,next.intents);};
  const snapshot=()=>freeze(copy({schema:'wxslim-resource-mount-command-v1',state,outcome,invocation,report,observedReport,intents,unknownCode,transportErrorCode,
    stateOwner:handedOff?'CALLER':'ADAPTER',
    started,cancelRequested:cancelled,sceneExecuted:false,receiptWritten:false,runtimeVerified:false,evidenceScope:'CALLER_AND_COMMAND_TRANSPORT_ONLY'}));
  const finish=()=>{handedOff=true;return snapshot();};
  const unknown=code=>{
    outcome='UNKNOWN';unknownCode=code;
    // Preserve a report observed before a throwing callback without treating it
    // as a successful operation. The real bridge retains this diagnostic.
    try{const current=typeof bridge.status==='function'?bridge.status():undefined;const value=current&&current.pending?current.pending.observedReport:undefined;if(value&&equal(value.identity,identity)&&value.op==='MOUNT'&&value.packId===state.identity.packId)observedReport=copy(value);}catch(ignored){}
    return finish();
  };
  function validTicket(value){
    if(!exact(value,['schema','identity','status','code','header','sideEffects','runtimeVerified'])||value.schema!=='wxslim-resource-command-invocation-v1'||!equal(value.identity,identity)||value.runtimeVerified!==false||!CODE.test(value.code))return false;
    if(value.status==='NOT_INVOKED')return value.header===null&&value.sideEffects==='NOT_INVOKED'&&PREINVOKE.has(value.code);
    const header=value.header;
    return value.status==='INVOKED'&&value.code==='RESOURCE_COMMAND_CALLBACK_INVOKED'&&value.sideEffects==='UNKNOWN'&&exact(header,['schema','identity','requestId','op','packId'])&&header.schema==='wxslim-resource-command-v1'&&equal(header.identity,identity)&&header.op==='MOUNT'&&header.packId===state.identity.packId&&typeof header.requestId==='string'&&/^[1-9][0-9]{0,31}$/.test(header.requestId);
  }
  function performStart(){
      need(!started,'RESOURCE_MOUNT_START_ONCE');started=true;outcome='RUNNING';
      let tracked;
      try{tracked=bridge.dispatchTracked('MOUNT',state.identity.packId,undefined,{cancelRequested:()=>cancelled});}
      catch(ignored){return unknown('RESOURCE_MOUNT_NO_INVOCATION_EVIDENCE');}
      // Observe result rejection immediately, but never interpret it before the ticket.
      const observed=Promise.resolve((tracked==null?undefined:tracked.result)).then(value=>({ok:true,value}),cause=>({ok:false,code:safeErrorCode(cause)}));
      if(!tracked||typeof (tracked.invocation==null?undefined:tracked.invocation.then)!=='function'||typeof (tracked.result==null?undefined:tracked.result.then)!=='function')return unknown('RESOURCE_MOUNT_TRACKING_INVALID');
      return Promise.resolve(tracked.invocation).then(function(ticket){
      if(!validTicket(ticket))return unknown('RESOURCE_MOUNT_INVOCATION_INVALID');
      invocation=copy(ticket);
      if(ticket.status==='NOT_INVOKED'){
        if(ticket.code==='RESOURCE_COMMAND_CANCELLED_BEFORE_INVOKE'){
          if(!cancelled)return unknown('RESOURCE_MOUNT_CANCEL_EVIDENCE_INVALID');
          apply('MOUNT_NOT_DISPATCHED');outcome='CANCELLED_BEFORE_INVOKE';
        }else{apply('MOUNT_DISPATCH_FAILED',{details:{code:ticket.code}});outcome='PREINVOKE_FAILED';}
        return finish();
      }
      apply('MOUNT_DISPATCHED');
      return observed.then(function(received){
      if(!received.ok){transportErrorCode=received.code;return unknown('RESOURCE_MOUNT_RESULT_UNKNOWN');}
      const value=received.value;
      if(!exact(value,['schema','identity','requestId','op','packId','result','summary'])||value.schema!=='wxslim-resource-command-result-v1'||!equal(value.identity,identity)||value.requestId!==ticket.header.requestId||value.op!=='MOUNT'||value.packId!==state.identity.packId||typeof (value.result==null?undefined:value.result.ok)!=='boolean')return unknown('RESOURCE_MOUNT_REPORT_INVALID');
      // The real bridge validates full helper result/summary consistency first.
      report=copy(value);
      if(value.result.ok){
        if(!['MOUNTED','ALREADY_MOUNTED'].includes(value.result.code))return unknown('RESOURCE_MOUNT_REPORT_INVALID');
        apply('MOUNT_SUCCESS');
      }else{
        if(typeof value.result.code!=='string'||!/^([A-Z][A-Z0-9_]{0,63})$/.test(value.result.code))return unknown('RESOURCE_MOUNT_REPORT_INVALID');
        apply('MOUNT_FAILURE',{details:{code:value.result.code}});
      }
      outcome='MOUNT_REPORTED';return finish();
      });
      },function(){return unknown('RESOURCE_MOUNT_NO_INVOCATION_EVIDENCE');});
  }
  return Object.freeze({snapshot,
    // Execute the pre-await prefix synchronously, as the former async API did.
    start(){try{return Promise.resolve(performStart());}catch(cause){return Promise.reject(cause);}},
    cancel(){if(!handedOff&&!cancelled){cancelled=true;apply('CANCEL');}return snapshot();}
  });
}

return Object.freeze({createResourceMountCommand:createResourceMountCommand});
}
if(typeof module==='object'&&module.exports)module.exports=createResourceMountCommandCore;
}());
