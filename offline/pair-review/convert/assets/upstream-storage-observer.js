/* Development observation only; this is not a storage backend.
 * Godot FileAccess writes through WXMEMFS. This helper only reads the small,
 * current-session or explicitly referenced previous-session fixture files
 * independently through the platform API. Previous references must belong to
 * this exact package and a different session; no discovery, writes or retries.
 * Construction performs no file access and does not install globals.
 * A successful readback requires statSync(path,false) before/after observation.
 * Empty files use real isFile/size metadata, never a fabricated bytes array or
 * a readFileSync call. The prior iOS position error did not establish file size.
 * Nonempty files require an actual ArrayBuffer and exact stat/read/stat lengths.
 * Fail fast: after a failed step, later reads/stats are not performed or claimed.
 * Equal metadata does not prove file identity/content stability between calls,
 * restart recovery, atomicity or durable storage. This observer writes nothing.
 */
(function () { 'use strict';
const SUFFIXES=['empty','bytes','grow','truncate'];
const REFERENCE=/^(wxslim-[a-f0-9]{20})#([a-z0-9]{1,24}-[a-z0-9]{1,24})$/;
function createUpstreamStorageObserver(options) {
  const wxApi=options.wx,delivery=options.delivery;
  let identity=null,fileSystem=null,nativeRoot=null;
  function captureIdentity() {
    if(identity)return JSON.stringify(identity);
    // Reuse the host's existing identity/backend observer, never query GL.
    delivery.sceneReady();
    const observed=JSON.parse(delivery.getObservationIdentity());
    const reference=observed && typeof observed.ref==='string' && REFERENCE.exec(observed.ref);
    if(!observed || observed.schema!=='wxslim-simple-observation-identity-v1' ||
      !reference || reference[0]!==observed.ref || reference[1]!==observed.packageId || reference[2]!==observed.session ||
      observed.ref!==observed.packageId+'#'+observed.session ||
      !['glx','webgl'].includes(observed.requestedMode) || observed.actualMode!==observed.requestedMode ||
      observed.sceneReadyObserved!==true)throw new Error('UPSTREAM_STORAGE_IDENTITY_NOT_READY');
    const parent=wxApi.env && wxApi.env.USER_DATA_PATH;
    if(typeof parent!=='string'||!parent||parent.endsWith('/'))throw new Error('UPSTREAM_STORAGE_NATIVE_ROOT_UNKNOWN');
    fileSystem=wxApi.getFileSystemManager();
    if(!fileSystem || typeof fileSystem.readFileSync!=='function' || typeof fileSystem.statSync!=='function')throw new Error('UPSTREAM_STORAGE_READBACK_UNAVAILABLE');
    nativeRoot=parent+'/wxslim_upstream_storage_probe/';
    identity=Object.freeze(Object.assign({},observed,{
      schema:'wxslim-upstream-storage-observation-v1',userRoot:'/userfs/wxslim_upstream_storage_probe/',
      filePrefix:'probe-'+observed.session+'-',restartRecovery:'NOT_TESTED'}));
    return JSON.stringify(identity);
  }
  function begin() {
    try {return captureIdentity();} catch(error) {
      try {console.error('[UPSTREAM_STORAGE_ENV_FAILED]',error);} catch(_) {}
      return JSON.stringify({ok:false,code:'IDENTITY_OR_NATIVE_READ_INTERFACE_NOT_READY'});
    }
  }
  function failure(code,stage,error,details) {
    // Keep the original exception (including falsy throws) in local console only.
    try {console.error('[UPSTREAM_STORAGE_READBACK_FAILED]',error);} catch(_) {}
    let nativeCode=null;try{const n=error && error.errCode;if(Number.isSafeInteger(n))nativeCode=n;}catch(_){}
    return Object.assign({ok:false,code,stage,nativeCode},details || {});
  }
  function statFile(path,stage) {
    let stats;
    try {stats=fileSystem.statSync(path,false);} catch(error) {return failure('NATIVE_STAT_FAILED',stage,error);}
    let file,size;
    try {
      if(!stats || typeof stats!=='object' || Array.isArray(stats))
        return failure('NATIVE_STAT_INVALID',stage,new Error('NATIVE_STAT_INVALID'));
      const isFile=stats.isFile;
      if(typeof isFile!=='function')return failure('NATIVE_STAT_INVALID',stage,new Error('NATIVE_STAT_INVALID'));
      file=isFile.call(stats);
      if(file!==true)return failure('NATIVE_NOT_FILE',stage,new Error('NATIVE_NOT_FILE'));
      size=stats.size;
    } catch(error) {return failure('NATIVE_STAT_INVALID',stage,error);}
    if(!Number.isSafeInteger(size) || size<0 || size>32)return failure('NATIVE_SIZE_INVALID',stage,new Error('NATIVE_SIZE_INVALID'));
    return {isFile:true,byteLength:size};
  }
  function readTarget(filePrefix,suffix) {
    const path=nativeRoot+filePrefix+suffix+'.bin';
    const before=statFile(path,'BEFORE_STAT');
    if(before.ok===false)return JSON.stringify(before);
    let bytes;
    if(before.byteLength>0) {
      let data;
      try {data=fileSystem.readFileSync(path);} catch(error) {return JSON.stringify(failure('NATIVE_READ_FAILED','READ',error,{before}));}
      let length;
      try {
        length=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(data);
        // Capture actual read bytes before the second native call can touch data.
        if(length===before.byteLength)bytes=Array.from(new Uint8Array(data));
      } catch(error) {return JSON.stringify(failure('NATIVE_READ_INVALID','READ',error,{before}));}
      if(length!==before.byteLength)return JSON.stringify(failure('NATIVE_LENGTH_MISMATCH','READ',new Error('NATIVE_LENGTH_MISMATCH'),{before,byteLength:length}));
    }
    const after=statFile(path,'AFTER_STAT');
    if(after.ok===false)return JSON.stringify(Object.assign({},after,{before}));
    if(after.byteLength!==before.byteLength)return JSON.stringify(failure('NATIVE_SIZE_CHANGED','AFTER_STAT',new Error('NATIVE_SIZE_CHANGED'),{before,after}));
    if(before.byteLength===0)return JSON.stringify({ok:true,code:'EMPTY_FILE_METADATA_VERIFIED',suffix,
      byteLength:0,readPerformed:false,evidence:'file_metadata',before,after});
    return JSON.stringify({ok:true,code:'NATIVE_BYTES_OBSERVED',suffix,bytes,
      byteLength:before.byteLength,readPerformed:true,evidence:'file_bytes',before,after});
  }
  function readback(suffix) {
    if(!identity || !SUFFIXES.includes(suffix))return JSON.stringify({ok:false,code:'READBACK_NOT_ALLOWED',stage:'GUARD'});
    return readTarget(identity.filePrefix,suffix);
  }
  function previousTarget(previousRef) {
    function denied(code) {return {ok:false,code,stage:'GUARD'};}
    if(!identity)return denied('PREVIOUS_TARGET_NOT_READY');
    if(typeof previousRef!=='string')return denied('PREVIOUS_REF_INVALID');
    const parts=REFERENCE.exec(previousRef);
    // JS $ also matches before a final newline: require the entire original input.
    if(!parts || parts[0]!==previousRef)return denied('PREVIOUS_REF_INVALID');
    if(parts[1]!==identity.packageId)return denied('PREVIOUS_PACKAGE_MISMATCH');
    if(parts[2]===identity.session)return denied('PREVIOUS_SESSION_SAME');
    return {ok:true,code:'PREVIOUS_TARGET_ACCEPTED',currentRef:identity.ref,previousRef,
      filePrefix:'probe-'+parts[2]+'-',userRoot:identity.userRoot,referenceSource:'explicit_input',
      samePackage:true,previousSessionDifferent:true,writePerformed:false,restartRecovery:'NOT_PROVEN_BY_READBACK'};
  }
  // JSON transport matches begin/readback; validation itself performs no I/O.
  function describePrevious(previousRef) {return JSON.stringify(previousTarget(previousRef));}
  function readPrevious(previousRef,suffix) {
    const target=previousTarget(previousRef);
    const reference={currentRef:identity?identity.ref:null,previousRef:target.ok?target.previousRef:null,
      referenceSource:'explicit_input',writePerformed:false,restartRecovery:'NOT_PROVEN_BY_READBACK'};
    if(!target.ok)return JSON.stringify(Object.assign({},target,reference));
    if(!SUFFIXES.includes(suffix))return JSON.stringify(Object.assign({ok:false,code:'READBACK_NOT_ALLOWED',stage:'GUARD'},reference));
    // Only this validated prefix and one whitelisted suffix reach the common reader.
    return JSON.stringify(Object.assign(JSON.parse(readTarget(target.filePrefix,suffix)),reference));
  }
  return Object.freeze({begin,readback,describePrevious,readPrevious});
}
module.exports=createUpstreamStorageObserver;
}());
