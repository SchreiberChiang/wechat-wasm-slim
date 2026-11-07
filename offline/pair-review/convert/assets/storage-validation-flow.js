'use strict';
// Development UI coordinator only. The tested files still use Godot FileAccess.
// wx storage holds only a locator for a COMPLETED write, never the test bytes.
function createStorageValidationFlow({wx, observer, root, log, cloudStatus}) {
  let identity=null, sequence=0, action=null, index=0, failed=false, nativeResult=null;
  const writeSteps=['environment','empty','bytes','bytes','grow','truncate','truncate','missing_parent','complete'];
  const readSteps=['environment','previous_target','empty','bytes','grow','truncate','complete'];
  const emit=(event,details)=>log('[STORAGE_FLOW] '+JSON.stringify({schema:'storage-flow-v1',seq:++sequence,
    ref:identity?.ref??null,event,details}));
  const key=()=> 'wxslim.storage.completed.v1.'+identity.packageId;
  const answer=x=>JSON.stringify(x);
  function ready() {
    if(!identity) {
      const i=JSON.parse(observer.begin());
      if(i.schema!=='wxslim-upstream-storage-observation-v1')throw Error('FLOW_IDENTITY_NOT_READY');
      let device={};try{const d=wx.getSystemInfoSync();device={model:d.model,system:d.system,wechatVersion:d.version,SDKVersion:d.SDKVersion};}catch(_){}
      identity=i;emit('ready',{packageId:i.packageId,session:i.session,requestedMode:i.requestedMode,
        actualMode:i.actualMode,sdkVersion:i.sdkVersion,device,locatorOnly:true,
        wasmSha256:root.__WXSLIM_RENDER_CONFIG__?.wasmSha256??null,
        returnZero:'PINNED_FRAMEWORK_STATIC_CHECK',backendSource:'existing engine context descriptor; not native GL query'});
    }
  }
  function prior() {
    ready();
    let saved;try{saved=wx.getStorageSync(key());}catch(_){return {ok:false,code:'LOCATOR_READ_FAILED'};}
    if(saved===''||saved==null)return {ok:false,code:'NO_COMPLETED_WRITE'};
    if(!saved||saved.schema!=='storage-completed-locator-v1'||saved.packageId!==identity.packageId||saved.status!=='WRITE_CHECK_PASSED')return {ok:false,code:'LOCATOR_INVALID'};
    if(saved.ref===identity.ref)return {ok:false,code:'REOPEN_REQUIRED'};
    const result=JSON.parse(observer.describePrevious(saved.ref));
    if(result.ok!==true)return {ok:false,code:'LOCATOR_TARGET_REJECTED'};
    return {ok:true,code:'PREVIOUS_WRITE_READY',previousRef:saved.ref,locatorSource:'wx_storage_completed_write_only',restartProof:'DIFFERENT_SESSION_ONLY'};
  }
  function start() {
    try{ready();const p=prior();emit('locator',p);return answer({...p,currentRef:identity.ref,actualMode:identity.actualMode,sdkVersion:identity.sdkVersion});}
    catch(_){emit('failure',{code:'FLOW_START_FAILED'});return answer({ok:false,code:'FLOW_START_FAILED'});}
  }
  function nativeCheck() {
    if(nativeResult)return answer(nativeResult);
    nativeResult={ok:false,status:'STARTED',nativeCalls:0,requestedBytes:32,outputBytesDisclosed:0,cryptographicQuality:'NOT_TESTED'};
    let pointer=0,heap,valid=false;
    const own=(o,n)=>{const d=Object.getOwnPropertyDescriptor(o,n);if(!d||!Object.hasOwn(d,'value'))throw Error('NATIVE_EXPORT_MISSING');return d.value;};
    try {
      ready();const boot=root.__WXSLIM_BOOT_STATE__,config=root.__WXSLIM_RENDER_CONFIG__;
      if(!boot||boot.stage!=='MAIN_RETURNED'||boot.runtimeInitialized!==true||boot.packMounted!==true||boot.mainCalls!==1||config.packageVersion!==identity.packageId)throw Error('NATIVE_BOOT_NOT_READY');
      const state=boot.secureRandom;
      if(!state||!state.prepared||!state.installed||state.closed||state.nativeState!=='BOUND'||state.cleanupFailures!==0)throw Error('NATIVE_RANDOM_NOT_READY');
      const m=root.WXGameKit?.gameInstance?.Module;
      if(!m||own(m,'__wxslimSecureRandomMode')!=='WECHAT_CTR_DRBG_V1')throw Error('NATIVE_MODULE_UNAVAILABLE');
      const native=own(m,'_godot_wechat_random_buffer'),assertReady=own(m,'__wxslimEntropyAssertReady');
      if(typeof native!=='function'||typeof assertReady!=='function')throw Error('NATIVE_EXPORT_MISSING');
      assertReady.call(m);nativeResult.nativeCalls=1;pointer=native.call(m,32);heap=own(m,'HEAPU8');
      valid=heap instanceof Uint8Array&&Number.isInteger(pointer)&&pointer>0&&pointer<=heap.length-1024;
      if(!valid)throw Error('NATIVE_RETURN_INVALID');
      heap.fill(0,pointer,pointer+1024);nativeResult.clearedBytes=1024;
      nativeResult.ok=true;nativeResult.status='PASS_NATIVE_ABI_ONLY';
    } catch(error) {nativeResult.status='FAILED';nativeResult.code=/^[A-Z_]+$/.test(error.message)?error.message:'NATIVE_CHECK_FAILED';}
    emit('native_check',nativeResult);return answer(nativeResult);
  }
  function observe(json) {
    try {
      ready();const r=JSON.parse(json);
      if(failed)throw Error('FLOW_ALREADY_FAILED');
      if(!action){if(!['WRITE_CURRENT','READ_PREVIOUS'].includes(r.mode))throw Error('FLOW_ACTION');action=r.mode;}
      const steps=action==='WRITE_CURRENT'?writeSteps:readSteps;
      if(r.ref!==identity.ref||r.mode!==action||r.seq!==index+1||r.step!==steps[index])throw Error('FLOW_SEQUENCE');
      index++;emit('check',r);
      if(r.expectedSatisfied!==true){failed=true;return answer({ok:false,code:'FILE_CHECK_FAILED'});}
      if(r.step==='complete'&&action==='WRITE_CURRENT') {
        const record={schema:'storage-completed-locator-v1',packageId:identity.packageId,ref:identity.ref,status:'WRITE_CHECK_PASSED'};
        wx.setStorageSync(key(),record);
        if(JSON.stringify(wx.getStorageSync(key()))!==JSON.stringify(record))throw Error('LOCATOR_SAVE_UNCONFIRMED');
        emit('completed_write_locator_saved',{ref:identity.ref,containsTestBytes:false});
        return answer({ok:true,code:'WRITE_PASSED_REOPEN_NOW'});
      }
      if(r.step==='complete') {
        const p=prior();if(!p.ok||p.previousRef!==r.previousRef||r.writePerformed!==false)throw Error('FLOW_PREVIOUS_LINK');
        emit('previous_read_complete',{previousRef:p.previousRef,writePerformed:false,restartProof:'DIFFERENT_SESSION_ONLY'});
        return answer({ok:true,code:'PREVIOUS_READ_PASSED'});
      }
      return answer({ok:true,code:'STEP_PASSED'});
    } catch(error){failed=true;const code=/^[A-Z_]+$/.test(error.message)?error.message:'FLOW_FAILED';emit('failure',{code});return answer({ok:false,code});}
  }
  return Object.freeze({start,nativeCheck,observe,cloudStatus:()=>answer(cloudStatus?cloudStatus():{available:false})});
}
module.exports=createStorageValidationFlow;
