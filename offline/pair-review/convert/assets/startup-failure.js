/* SOURCE_ONLY. Explicit captured-failure UI; no installation, timers or PCK dependency. */
(function () { 'use strict';
function createStartupFailure(options) {
  const wxApi=options && options.wx, packageId=options && options.packageId, logger=options && options.logger;
  if(!wxApi || typeof wxApi!=='object' || typeof logger!=='function' || typeof packageId!=='string' || !/^wxslim-[a-f0-9]{20}$/.test(packageId))throw new TypeError('STARTUP_FAILURE_OPTIONS');
  const stages=new Set(('UNKNOWN LOADER_START NEW FACTORY_START WASM_INSTANTIATED GODOT_RUNTIME_READY FS_UPSTREAM_INIT FS_READY PACK_READY_WAITING_LOADER_MAIN CALL_MAIN MAIN_RETURNED FAILED '+
    'NOT_STARTED CHECK_ROOTS CAPTURE_METHODS GET_FILE_SYSTEM GET_USER_DATA_PATH ENGINE_INITIALIZE CHECK_INIT_RECEIPT VERIFY_SESSION CHECK_PUBLICATION PUBLISH_INTERFACE CHECK_PUBLISHED_INTERFACE').split(' '));
  const codes=new Set(('UNKNOWN WXSLIM_RESTART_REQUIRED WXSLIM_FACTORY_CONFIG WXSLIM_PACK_OPTIONS_REQUIRED WXSLIM_PACK_SIZE_REQUIRED WXSLIM_WX_FS_REQUIRED WXSLIM_CANVAS_REQUIRED '+
    'WXSLIM_RENDER_RUNTIME_REQUIRED WXSLIM_PERSISTENT_STARTUP_CHANGED WXSLIM_PERSISTENT_STARTUP_DESCRIPTOR WXSLIM_PERSISTENT_STARTUP_HOOKS WXSLIM_RESOURCE_STARTUP_DESCRIPTOR WXSLIM_RESOURCE_STARTUP_HOOKS '+
    'WXSLIM_NATIVE_AUDIO_REQUIRED WXSLIM_INVALID_AUDIO_CONTEXT WXSLIM_COMMUNITY_AUDIO_REQUIRED WXSLIM_MODULE_IDENTITY_CHANGED WXSLIM_GODOT_EXPORTS_REQUIRED WXSLIM_RESOURCE_STARTUP_CHANGED WXSLIM_RESOURCE_INSTALL_FAILED '+
    'WXSLIM_PERSISTENT_INITIALIZATION_FAILED WXSLIM_PCK_PIN_SIZE_OR_HEADER WXSLIM_MAIN_BEFORE_PACK WXSLIM_DUPLICATE_MAIN WXSLIM_UNEXPECTED_MAIN_PACK WXSLIM_CUSTOM_PACKAGE_NOT_VALIDATED WXSLIM_RETAINED_PACKAGE_MISSING '+
    'WXSLIM_RENDER_BOOT_FAILED WXSLIM_GODOT_MAIN_FAILED WXSLIM_RENDER_CONTEXT_MISMATCH WXSLIM_RENDER_CONTEXT_MISSING WXSLIM_GLX_CAPABILITY_UNAVAILABLE WXSLIM_GLX_BINDINGS_MISSING WXSLIM_GLX_CONTEXT_UNAVAILABLE WXSLIM_GLX_NATIVE_FAILED '+
    'SAVE_HOST_OPERATION_FAILED SAVE_HOST_INIT_FAILED SAVE_HOST_ENGINE_UNSUPPORTED SAVE_HOST_MODULE_REQUIRED SAVE_HOST_INITIALIZE_ONCE SAVE_HOST_INVALIDATED SAVE_HOST_ROOT_CHANGED SAVE_HOST_ROOT_OCCUPIED SAVE_HOST_METHOD_CHANGED '+
    'SAVE_HOST_IDENTITY_MISMATCH SAVE_HOST_SESSION_NOT_READY SAVE_HOST_SESSION_STATE SAVE_HOST_WX_HANDLES SAVE_HOST_WX_METHOD SAVE_HOST_WX_REQUIRED SAVE_HOST_RECEIPT SAVE_HOST_REMOVE_FAILED '+
    'SAVE_OPERATION_FAILED SAVE_INIT_FAILED SAVE_INIT_ALREADY_SELECTED SAVE_INIT_AFTER_SHUTDOWN SAVE_NATIVE_ROOT_MISSING SAVE_NATIVE_NOT_DIRECTORY SAVE_MOUNTPOINT_MISSING SAVE_MOUNTPOINT_NOT_VACANT_MEMFS SAVE_MOUNT_NOT_READY SAVE_SESSION_NOT_ACTIVE SAVE_BUSY').split(' '));
  // Exact owned tokens only; these are not prefix/regex acceptance rules.
  'WXSLIM_STORAGE_BACKEND_UNSUPPORTED WXSLIM_UPSTREAM_STORAGE_PIN_REQUIRED WXSLIM_STORAGE_BACKENDS_CONFLICT WXSLIM_UPSTREAM_STORAGE_ENGINE_MISMATCH'.split(' ').forEach(code=>codes.add(code));
  ('WXSLIM_GLX_BUFFER_UNOBSERVED WXSLIM_GLX_CONTEXT_INVALID WXSLIM_GLX_CONTEXT_MISMATCH WXSLIM_GLX_INIT_UNOBSERVED WXSLIM_RENDER_ALREADY_FAILED WXSLIM_RENDER_CONFIG_INVALID WXSLIM_RENDER_CONFIG_MISMATCH WXSLIM_RENDER_OBSERVER_MISSING WXSLIM_RENDER_PIN_CHANGED WXSLIM_UNEXPECTED_GLX_CONTEXT '+
    'SAVE_HOST_ROOTS SAVE_HOST_IDENTITY SAVE_HOST_SESSION_ID SAVE_HOST_DIRECTORY SAVE_HOST_DIRECTORY_POLICY SAVE_HOST_LIMITS SAVE_HOST_FIELDS SAVE_HOST_OBJECT_REQUIRED SAVE_HOST_DATA_REQUIRED SAVE_HOST_INVALID_DATA '+
    'SAVE_FACTORY_OPTIONS_REQUIRED SAVE_FACTORY_OPTION_FIELDS SAVE_FACTORY_OPTION_DATA_FIELDS SAVE_FACTORY_IDENTITY_REQUIRED SAVE_FACTORY_IDENTITY_FIELDS SAVE_FACTORY_IDENTITY_DATA_FIELDS '+
    'SAVE_OBJECT_REQUIRED SAVE_OBJECT_FIELDS SAVE_DATA_FIELDS_REQUIRED SAVE_SESSION_ID SAVE_PACKAGE_IDENTITY SAVE_NATIVE_DIRECTORY SAVE_NATIVE_DIRECTORY_POLICY SAVE_MOUNTPOINT_POLICY SAVE_REQUEST_LIMIT SAVE_SDK_REQUIRED SAVE_FS_REQUIRED SAVE_OWNED_ROOT_REQUIRED SAVE_LIMIT_REQUIRED SAVE_METHOD_REQUIRED SAVE_PREPARED SAVE_SESSION_READY').split(' ').forEach(code=>codes.add(code));
  'EIO EINVAL EBUSY EFBIG ENOSPC ENOTSUP ENODEV ENOENT EEXIST ENOTDIR EISDIR ENOTEMPTY S_IFDIR S_IFREG S_IFMT'.split(' ').forEach(name=>codes.add('SAVE_CONSTANT_REQUIRED_'+name));
  const startStages=new Set('START_GUARD MEMORY_LOOKUP MEMORY_CREATE MEMORY_VALIDATE PARENT_STAT TARGET_STAT TARGET_MISSING_CHECK TARGET_MKDIR TARGET_RESTAT FS_MOUNT MOUNT_VALIDATE PARENT_GUARD TARGET_CREATE_GUARD PRE_MOUNT_GUARD POST_MOUNT_GUARD'.split(' '));
  const reads=new Set('NOT_OBSERVED NOT_ATTEMPTED OBSERVED ABSENT ACCESSOR UNREADABLE NOT_OBJECT DATA METHOD_UNAVAILABLE METHOD_CHANGED CALL_FAILED NO_SESSION IDENTITY_MISMATCH PROJECTION_FAILED NOT_DATA_STRING OVER_LIMIT'.split(' '));
  const phases=new Set('NEW STARTING READY FAILED CLOSED CLOSING INVALIDATED'.split(' '));
  const types=new Set('undefined object function boolean number bigint string symbol'.split(' '));
  const nativeCodes=new Set('ENOENT EACCES EPERM ENOTDIR EEXIST EIO'.split(' '));
  const fields={errorToken:codes,receiptCode:codes,causeErrorToken:codes,statusRead:reads,receiptRead:reads,causeRead:reads,causeMessageRead:reads,causeCodeRead:reads,
    sessionPhase:phases,backendPhase:phases,causeType:types,causeCodeType:types,causeCodeToken:nativeCodes,
    failureStage:startStages,failedOperation:startStages,failurePathRole:new Set(['NONE','MEMORY_MOUNT','NATIVE_PARENT','NATIVE_TARGET']),
    messageKind:new Set(['MISSING_PATH_TEXT']),targetStatPhase:new Set(['CALL','RESULT_CHECK','NOT_CALLED','NOT_TARGET_STAT'])};
  let reported=false,duplicates=0,modal='NOT_REQUESTED',clipboard='NOT_REQUESTED',helperFailures=0,loggerFailures=0,diagnostic=null,copyData=null;
  function read(object,key) {
    if(!object || (typeof object!=='object' && typeof object!=='function'))return undefined;
    try { const d=Object.getOwnPropertyDescriptor(object,key);return d && Object.prototype.hasOwnProperty.call(d,'value')?d.value:undefined; }
    catch (_) { return undefined; }
  }
  function log(code) {
    try { logger('[STARTUP_FAILURE] '+JSON.stringify({packageId,code})); }
    catch (_) { loggerFailures++; }
  }
  function failed(code) { helperFailures++;log(code); }
  // wx is the explicitly supplied platform API. Its documented methods need
  // not be own data properties; retain normal prototype/accessor lookup.
  function platformMethod(name) {
    try { return wxApi[name]; } catch (_) { failed('PLATFORM_API_LOOKUP_FAILED');return undefined; }
  }
  function status() { return Object.freeze({schema:'wxslim-startup-failure-status-v1',reported,duplicates,modal,clipboard,helperFailures,loggerFailures,diagnostic}); }
  function targetCause(value) {
    const observed=read(value,'status'),causeType=read(value,'causeType'),targetSource=read(value,'targetSource');
    const result={status:['OBSERVED','PROJECTION_FAILED','NOT_TARGET_STAT'].includes(observed)?observed:'UNKNOWN',
      causeType:types.has(causeType) || causeType==='null'?causeType:null,
      targetSource:targetSource==='CAPTURED_NATIVE_ROOT'?'CAPTURED_NATIVE_ROOT':'UNKNOWN',observationOnly:true,missingDirectoryAuthorized:false,fields:{}};
    const entries=read(value,'fields');
    for(const name of ['name','message','errMsg','code','errCode','errno']) {
      const entry=read(entries,name);if(entry===undefined)continue;
      const observedRead=read(entry,'read'),field={read:reads.has(observedRead)?observedRead:'UNKNOWN'};
      const type=read(entry,'type');if(type!==undefined)field.type=types.has(type)||type==='null'?type:null;
      const token=read(entry,'token');if(token!==undefined)field.token=(name==='name'?['Error','TypeError','RangeError','DOMException'].includes(token):nativeCodes.has(token))?token:null;
      for(const key of ['number','length']) {const n=read(entry,key);if(n!==undefined)field[key]=Number.isInteger(n)&&n>= (key==='length'?0:-2147483648)&&n<=2147483647?n:null;}
      const template=read(entry,'template');if(template!==undefined)field.template=['DOCUMENTED_TARGET','STAT_SYNC_PREFIX_TARGET','STAT_SYNC_PREFIX_STAT_QUOTED_TARGET','NODE_ENOENT_STAT_QUOTED_TARGET','UNRECOGNIZED','TOO_LONG'].includes(template)?template:null;
      const exact=read(entry,'exactTargetTemplate');if(exact!==undefined)field.exactTargetTemplate=typeof exact==='boolean'?exact:null;
      result.fields[name]=Object.freeze(field);
    }
    Object.freeze(result.fields);return Object.freeze(result);
  }
  function copy() {
    const method=platformMethod('setClipboardData');
    if(typeof method!=='function'){clipboard='UNAVAILABLE';failed('CLIPBOARD_UNAVAILABLE');return;}
    clipboard='REQUESTED';let settled=false;
    try { method.call(wxApi,{data:copyData,success:function(){if(!settled){settled=true;clipboard='COPIED';}},fail:function(){if(!settled){settled=true;clipboard='FAILED';failed('CLIPBOARD_FAILED');}}}); }
    catch (_) { if(!settled){settled=true;clipboard='THREW';}failed('CLIPBOARD_THROW'); }
  }
  function report(input) {
    // First captured failure wins, including reentrant reports from injected methods.
    if(reported){duplicates=Math.min(65535,duplicates+1);return status();}
    reported=true;
    const stage=read(input,'stage'),code=read(input,'code'),details=read(input,'details'),safe={};
    for(const key of Object.keys(fields)){
      const value=read(details,key);
      if(value!==undefined)safe[key]=fields[key].has(value)?value:null;
    }
    for(const key of ['errno','nativeCode','causeCodeNumber']){
      const value=read(details,key);
      if(value!==undefined)safe[key]=Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?value:null;
    }
    for(const key of ['memoryDirectoryCreated','nativeDirectoryCreated','nativeMutationAttempted']){
      const value=read(details,key);if(value!==undefined)safe[key]=typeof value==='boolean'?value:null;
    }
    const target=read(details,'targetStatCause');if(target!==undefined)safe.targetStatCause=targetCause(target);
    diagnostic=Object.freeze({schema:'wxslim-startup-failure-v1',packageId,stage:stages.has(stage)?stage:'UNKNOWN',code:codes.has(code)?code:'UNKNOWN',details:Object.freeze(safe)});
    copyData=JSON.stringify(diagnostic); // All fields above are owned primitives; no input toJSON/getters.
    if(copyData.length>4096){copyData=null;failed('DIAGNOSTIC_LIMIT');return status();}
    log('CAPTURED_FAILURE');
    const method=platformMethod('showModal');
    if(typeof method!=='function'){modal='UNAVAILABLE';failed('MODAL_UNAVAILABLE');return status();}
    modal='REQUESTED';let settled=false;
    try { method.call(wxApi,{title:'启动失败',content:'游戏未能完成启动。请复制诊断信息发给开发者。',showCancel:true,confirmText:'复制诊断',cancelText:'关闭',
      success:function(result){if(settled)return;settled=true;modal='RESPONDED';if(read(result,'confirm')===true)copy();},
      fail:function(){if(!settled){settled=true;modal='FAILED';failed('MODAL_FAILED');}}}); }
    catch (_) { if(!settled){settled=true;modal='THREW';}failed('MODAL_THROW'); }
    return status();
  }
  return Object.freeze({report,status});
}
if(typeof module==='object' && module.exports)module.exports=createStartupFailure;
}());
