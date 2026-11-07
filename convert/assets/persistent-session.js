/* Owned session/request layer, preparation only. No automatic installation.
 * This service observes exact bytes after the caller has flushed/closed files;
 * it does not authenticate caller reports, flush libc, or promise durability.
 */
(function () { 'use strict';
const createBackend = require('./persistent-memfs.js');
function createPersistentSession(options) {
  const FS=options.FS, MEMFS=options.MEMFS, C=options.constants, native=options.fileSystem;
  const errors=new WeakMap(), token=/^[A-Za-z0-9_.-]{1,128}$/;
  function problem(code) { const e=new Error(code); errors.set(e,code); throw e; }
  function need(ok,code) { if(!ok) problem(code); }
  function freeze(value) {
    if(value && typeof value==='object' && !Object.isFrozen(value)) {Object.keys(value).forEach(key=>freeze(value[key]));Object.freeze(value);}return value;
  }
  function exact(value,keys) {
    need(value && typeof value==='object' && !Array.isArray(value),'SAVE_OBJECT_REQUIRED');
    const own=Reflect.ownKeys(value);need(own.length===keys.length && own.every(key=>keys.includes(key)),'SAVE_OBJECT_FIELDS');
    keys.forEach(key=>{const d=Object.getOwnPropertyDescriptor(value,key);need(d && Object.prototype.hasOwnProperty.call(d,'value'),'SAVE_DATA_FIELDS_REQUIRED');});
  }
  need(options && typeof options.sessionId==='string' && token.test(options.sessionId),'SAVE_SESSION_ID');
  exact(options.identity,['packageId','wasmSha256']);
  need(typeof options.identity.packageId==='string' && token.test(options.identity.packageId)
    && typeof options.identity.wasmSha256==='string' && /^[a-f0-9]{64}$/.test(options.identity.wasmSha256),'SAVE_PACKAGE_IDENTITY');
  const identity=freeze({packageId:options.identity.packageId,wasmSha256:options.identity.wasmSha256});
  const sessionId=options.sessionId, mountPath='/userfs';
  const parent=options.userDataPath, directory=options.directoryName;
  need(typeof parent==='string' && !parent.endsWith('/') && typeof directory==='string'
    && /^[A-Za-z0-9_-]{1,64}$/.test(directory),'SAVE_NATIVE_DIRECTORY');
  const nativeRoot=parent+'/'+directory, policy=options.nativeDirectoryPolicy;
  need(['EXISTING_ONLY','CREATE_IF_MISSING'].includes(policy),'SAVE_NATIVE_DIRECTORY_POLICY');
  need(typeof options.createMountpoint==='boolean','SAVE_MOUNTPOINT_POLICY');
  const createMountpoint=options.createMountpoint, maxFile=options.maxFileBytes, maxTotal=options.maxTotalBytes;
  const maxRequests=options.maxRequests;
  need(Number.isSafeInteger(maxRequests)&&maxRequests>0&&maxRequests<=1000000,'SAVE_REQUEST_LIMIT');
  const backend=createBackend({FS,MEMFS,constants:C,fileSystem:native,rootPath:nativeRoot,
    maxFileBytes:maxFile,maxTotalBytes:maxTotal,maxEntries:options.maxEntries,maxDepth:options.maxDepth});
  const stat=native.statSync, mkdir=native.mkdirSync;
  let phase='NEW', busy=false, invalidated=false, invalidationReason=null, next=1, closing=false;
  let root=null, slot=null, ownedMount=null, lastReceipt=null;
  let memoryDirectoryCreated=false,nativeDirectoryCreated=false,nativeMutationAttempted=false;
  function active() {
    try { return !!(root && slot && ownedMount && slot.mounted===ownedMount
      && FS.root && FS.root.mount && FS.getMounts(FS.root.mount).includes(ownedMount)); } catch(_){return false;}
  }
  function safeNumber(error,name) { try {const n=error && error[name];return Number.isSafeInteger(n)?n:null;}catch(_){return null;} }
  function errorData(cause) {return {code:errors.get(cause)||'SAVE_OPERATION_FAILED',errno:safeNumber(cause,'errno'),nativeCode:safeNumber(cause,'errCode')};}
  function receipt(operation,requestId) {return {schema:'wxslim-persistent-session-v1',operation,sessionId,identity,requestId,
    status:'FAILED',code:null,expectedGeneration:null,generationBefore:null,generationAfter:null,files:[],
    callerWriterEvidence:null,nativeReadbackVerified:null,
    engineResultVerified:false,restartRecovery:'NOT_TESTED',durability:'NOT_PROVEN',atomicity:'NOT_PROVEN'};}
  function finish(value,cause) {
    if(arguments.length>1) {value.error=errorData(cause);value.code=value.error.code;Object.defineProperty(value,'cause',{value:cause});}
    lastReceipt=freeze(value);return lastReceipt;
  }
  function denied(operation,code,id) {const value=receipt(operation,id===undefined?null:id);value.code=code;return freeze(value);}
  function alive() {need(!invalidated,'SAVE_SESSION_INVALIDATED');}
  function ready() {
    alive();need(phase==='READY','SAVE_SESSION_NOT_READY');
    if(!active()){invalidated=true;phase='INVALIDATED';invalidationReason='SAVE_MOUNT_INACTIVE';problem('SAVE_MOUNT_INACTIVE');}
    need(backend.inspect().phase==='READY','SAVE_BACKEND_NOT_READY');
  }
  function directoryStat(path) {
    const s=stat.call(native,path,false);
    need(s && !Array.isArray(s) && typeof s.isDirectory==='function' && typeof s.isFile==='function'
      && s.isDirectory()===true && s.isFile()===false,'SAVE_NATIVE_NOT_DIRECTORY');return s;
  }
  function nativeMissing(cause) {
    try {const n=cause && cause.errCode, code=cause && cause.code;return n===1300002 || code==='ENOENT';}catch(_){return false;}
  }
  function memoryMissing(cause) {
    try {return cause instanceof FS.ErrnoError && cause.errno===C.ENOENT;}catch(_){return false;}
  }
  function start() {
    if(busy)return denied('START','SAVE_BUSY');
    if(phase!=='NEW')return denied('START','SAVE_START_ONCE');
    busy=true;phase='STARTING';const r=receipt('START',null);
    let failureStage='START_GUARD',failurePathRole='NONE',failedOperation=null;
    function location(stage,role) {failureStage=stage;failurePathRole=role;failedOperation=null;}
    function observe(stage,role,action) {
      location(stage,role);
      try {return action();}catch(cause){failedOperation=stage;throw cause;}
    }
    try {
      alive();need(!closing,'SAVE_SESSION_CLOSING');
      try {slot=observe('MEMORY_LOOKUP','MEMORY_MOUNT',()=>FS.lookupPath(mountPath,{follow_mount:false}).node);}catch(cause){
        if(!memoryMissing(cause))throw cause;
        need(createMountpoint,'SAVE_MOUNTPOINT_MISSING');
        observe('MEMORY_CREATE','MEMORY_MOUNT',()=>FS.mkdir(mountPath,0o700));memoryDirectoryCreated=true;
        slot=observe('MEMORY_LOOKUP','MEMORY_MOUNT',()=>FS.lookupPath(mountPath,{follow_mount:false}).node);
      }
      location('MEMORY_VALIDATE','MEMORY_MOUNT');
      need(slot && FS.isDir(slot.mode) && slot.mount && slot.mount.type===MEMFS && !slot.mounted
        && Object.keys(slot.contents).length===0,'SAVE_MOUNTPOINT_NOT_VACANT_MEMFS');
      observe('PARENT_STAT','NATIVE_PARENT',()=>directoryStat(parent));
      location('PARENT_GUARD','NONE');alive();
      try {observe('TARGET_STAT','NATIVE_TARGET',()=>directoryStat(nativeRoot));}catch(cause){
        // Keep TARGET_STAT as the failed operation while classifying its error.
        // Only fixed labels are recorded; no path or extra native query.
        failureStage='TARGET_MISSING_CHECK';
        if(!nativeMissing(cause))throw cause;
        need(policy==='CREATE_IF_MISSING','SAVE_NATIVE_ROOT_MISSING');
        location('TARGET_CREATE_GUARD','NONE');alive();
        nativeMutationAttempted=true;const returned=observe('TARGET_MKDIR','NATIVE_TARGET',()=>mkdir.call(native,nativeRoot,false));
        need(!returned || typeof returned.then!=='function','SAVE_SYNC_RESULT_REQUIRED');
        observe('TARGET_RESTAT','NATIVE_TARGET',()=>directoryStat(nativeRoot));nativeDirectoryCreated=true;
      }
      location('PRE_MOUNT_GUARD','NONE');alive();root=observe('FS_MOUNT','MEMORY_MOUNT',()=>FS.mount(backend.type,{},mountPath));
      location('MOUNT_VALIDATE','MEMORY_MOUNT');ownedMount=root.mount;
      location('POST_MOUNT_GUARD','NONE');alive();location('MOUNT_VALIDATE','MEMORY_MOUNT');
      need(active() && backend.inspect().phase==='READY','SAVE_MOUNT_NOT_READY');
      phase='READY';r.status='READY';r.code='SAVE_SESSION_READY';
      r.memoryDirectoryCreated=memoryDirectoryCreated;r.nativeDirectoryCreated=nativeDirectoryCreated;
      r.restoration='MOUNT_READ_COMPLETED_NO_POPULATE_CALL';return finish(r);
    }catch(cause){
      phase=invalidated?'INVALIDATED':'FAILED';r.memoryDirectoryCreated=memoryDirectoryCreated;
      r.nativeDirectoryCreated=nativeDirectoryCreated;r.nativeMutationAttempted=nativeMutationAttempted;
      r.failureStage=failureStage;r.failurePathRole=failurePathRole;r.failedOperation=failedOperation;
      r.ownedMountPresent=active();return finish(r,cause);
    }finally{busy=false;}
  }
  function snapshotBytes(value) {
    try {
      const view=ArrayBuffer.isView(value),buffer=view?value.buffer:value;
      need(!view || Object.prototype.toString.call(value)==='[object Uint8Array]','SAVE_EXPECTED_BYTES_REQUIRED');
      const full=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(buffer);
      const length=view?value.byteLength:full, offset=view?value.byteOffset:0;
      need(length<=maxFile,'SAVE_EXPECTED_FILE_TOO_LARGE');
      return new Uint8Array(new Uint8Array(buffer,offset,length));
    }catch(cause){if(errors.has(cause))throw cause;problem('SAVE_EXPECTED_BYTES_REQUIRED');}
  }
  function pathParts(value) {
    need(typeof value==='string'&&value.length>0&&value.length<=1024,'SAVE_RELATIVE_PATH');
    const parts=value.split('/');
    need(parts.every(x=>x.length>0&&x.length<=255&&!/[\\:\x00-\x1f\x7f?#%]/.test(x)
      && !['.','..','__proto__','prototype','constructor'].includes(x)),'SAVE_RELATIVE_PATH');return parts;
  }
  function writer(value) {
    if(value===null)return null;
    exact(value,['storeReturned','storeError','flushError','closeError']);
    need(typeof value.storeReturned==='boolean' && ['storeError','flushError','closeError'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0&&value[k]<=2147483647),'SAVE_WRITER_EVIDENCE_INVALID');
    return {storeReturned:value.storeReturned,storeError:value.storeError,flushError:value.flushError,closeError:value.closeError};
  }
  function verify(request) {
    if(busy)return denied('VERIFY','SAVE_BUSY');
    busy=true;const r=receipt('VERIFY',null);
    try {
      ready();need(!closing,'SAVE_SESSION_CLOSING');exact(request,['sessionId','requestId','expectedGeneration','files','writerEvidence']);
      need(request.sessionId===sessionId,'SAVE_SESSION_MISMATCH');
      need(Number.isSafeInteger(request.requestId)&&request.requestId===next,'SAVE_REQUEST_SEQUENCE');
      need(next<=maxRequests,'SAVE_REQUEST_LIMIT_REACHED');r.requestId=next++;
      need(Number.isSafeInteger(request.expectedGeneration)&&request.expectedGeneration>=0,'SAVE_GENERATION_REQUIRED');
      r.expectedGeneration=request.expectedGeneration;r.generationBefore=backend.inspect().generation;
      need(r.expectedGeneration===r.generationBefore,'SAVE_GENERATION_CHANGED');
      need(Array.isArray(request.files)&&request.files.length>0&&request.files.length<=64,'SAVE_EXPECTED_FILES');
      const expected=[],ids=new Set(),paths=new Set();let total=0;
      for(const file of request.files){
        exact(file,['id','relativePath','bytes']);need(typeof file.id==='string'&&token.test(file.id)&&!ids.has(file.id),'SAVE_FILE_ID');
        pathParts(file.relativePath);need(!paths.has(file.relativePath),'SAVE_DUPLICATE_PATH');
        const bytes=snapshotBytes(file.bytes);total+=bytes.length;need(total<=maxTotal,'SAVE_EXPECTED_TOTAL_TOO_LARGE');
        ids.add(file.id);paths.add(file.relativePath);expected.push({id:file.id,relativePath:file.relativePath,bytes});
      }
      r.callerWriterEvidence=writer(request.writerEvidence);
      need(r.callerWriterEvidence!==null,'SAVE_WRITER_EVIDENCE_MISSING');
      need(r.callerWriterEvidence.storeReturned && r.callerWriterEvidence.storeError===0
        && r.callerWriterEvidence.flushError===0 && r.callerWriterEvidence.closeError===0,'SAVE_CALLER_WRITER_FAILED');
      need(backend.inspect().openHandles===0,'SAVE_HANDLES_STILL_OPEN');alive();
      const result=backend.verifyFiles(expected,r.expectedGeneration);
      alive();need(active(),'SAVE_MOUNT_INACTIVE');
      r.generationAfter=backend.inspect().generation;need(r.generationAfter===r.generationBefore,'SAVE_GENERATION_CHANGED');
      r.files=result.files.map((value,index)=>Object.assign({id:expected[index].id},value));
      r.nativeReadbackVerified=result.files.every(file=>file.memoryNativeMatch);
      need(result.allExpectedMatch,'SAVE_EXPECTED_CONTENT_MISMATCH');
      r.status='VERIFIED';r.code='SAVE_EXPECTED_BYTES_OBSERVED';
      r.claim='EXPECTED_BYTES_MATCH_MEMORY_AND_NATIVE_THIS_REQUEST';return finish(r);
    }catch(cause){
      r.generationAfter=backend.inspect().generation;
      if(!invalidated && phase==='READY' && backend.inspect().phase!=='READY')phase='FAILED';
      // An empty files array / null readback flag means this request did not
      // finish verification, not that no reads occurred or all files failed.
      // Neither a failed caller write nor an expected-content mismatch is erased
      // by some other successful request. Each receipt keeps its own identity.
      return finish(r,cause);
    }finally{busy=false;}
  }
  // Lifecycle observation is deliberately separate from an application request.
  // It never invents writer evidence or marks a business save VERIFIED.
  function checkStorage() {
    if(busy)return denied('CHECK_STORAGE','SAVE_BUSY');
    busy=true;const r=receipt('CHECK_STORAGE',null);
    try {
      ready();need(backend.inspect().openHandles===0,'SAVE_HANDLES_STILL_OPEN');
      r.generationBefore=backend.inspect().generation;
      let calls=0, failure=null;
      backend.type.syncfs(ownedMount,false,function(error){calls++;failure=error;});
      need(calls===1,'SAVE_SYNC_CALLBACK_INCOMPLETE');if(failure)throw failure;
      alive();need(active(),'SAVE_MOUNT_INACTIVE');
      r.generationAfter=backend.inspect().generation;need(r.generationAfter===r.generationBefore,'SAVE_GENERATION_CHANGED');
      r.status='OBSERVED';r.code='SAVE_TREE_MEMORY_NATIVE_OBSERVED';r.nativeReadbackVerified=true;
      r.claim='MEMORY_AND_NATIVE_TREE_MATCH_THIS_OBSERVATION';return finish(r);
    }catch(cause){
      r.generationAfter=backend.inspect().generation;
      if(!invalidated && phase==='READY' && backend.inspect().phase!=='READY')phase='FAILED';
      return finish(r,cause);
    }finally{busy=false;}
  }
  function beginShutdown() {
    closing=true;
    const r=receipt('BEGIN_SHUTDOWN',null);r.status='CLOSING';r.code='SAVE_NEW_REQUESTS_CLOSED';
    // Active verification is synchronous and retains its own receipt. No forced
    // close, fabricated write result, or platform action is performed here.
    return freeze(r);
  }
  function invalidate(reason) {
    invalidated=true;invalidationReason=typeof reason==='string'&&token.test(reason)?reason:'SAVE_INVALIDATED';phase='INVALIDATED';
    const r=receipt('INVALIDATE',null);r.status='INVALIDATED';r.code=invalidationReason;return freeze(r);
  }
  function stop() {
    if(busy)return denied('STOP','SAVE_BUSY');
    busy=true;const r=receipt('STOP',null);
    try {
      need(backend.inspect().openHandles===0,'SAVE_HANDLES_STILL_OPEN');
      // Never unmount a replacement or an unrelated filesystem.
      if(active())FS.unmount(mountPath);
      invalidated=true;phase='STOPPED';r.status='STOPPED';r.code='SAVE_SESSION_STOPPED';
      r.nativeFilesDeleted=false;return finish(r);
    }catch(cause){return finish(r,cause);}finally{busy=false;}
  }
  function status() {return freeze({schema:'wxslim-persistent-session-status-v1',sessionId,identity,phase,
    active:active(),invalidated,invalidationReason,closing,nextRequestId:next,requestLimit:maxRequests,
    memoryDirectoryCreated,nativeDirectoryCreated,nativeMutationAttempted,
    backend:backend.inspect(),lastReceipt,engineResultVerified:false});}
  return Object.freeze({start,verify,status,stop,invalidate,checkStorage,beginShutdown});
}
if(typeof module==='object'&&module.exports)module.exports=createPersistentSession;
}());
