/* Explicit host adapter preparation. No automatic installation, wx globals,
 * engine fallback, filesystem writes, unmounts or platform durability claims.
 */
(function () { 'use strict';
const KEY = '__WXSLIM_PERSISTENT_FILES__';
const METHOD_NAMES = ['initPersistentFileSession','verifyPersistentFiles','persistentFileStatus'];
const OPTION_NAMES = ['sessionId','identity','directoryName','nativeDirectoryPolicy','createMountpoint','maxFileBytes','maxTotalBytes','maxEntries','maxDepth','maxRequests'];
function createPersistentHostRuntime(options) {
  const internal = new WeakMap(), token = /^[A-Za-z0-9_.-]{1,128}$/, codeToken = /^[A-Z][A-Z0-9_]{0,95}$/;
  function problem(code) { const e = new Error(code); internal.set(e,code); throw e; }
  function need(ok,code) { if (!ok) problem(code || 'SAVE_HOST_INVALID_DATA'); }
  function data(object,key) {
    const d = Object.getOwnPropertyDescriptor(object,key);
    need(d && Object.prototype.hasOwnProperty.call(d,'value'),'SAVE_HOST_DATA_REQUIRED'); return d.value;
  }
  function exact(object,keys) {
    need(object && typeof object === 'object' && !Array.isArray(object),'SAVE_HOST_OBJECT_REQUIRED');
    const own = Reflect.ownKeys(object); need(own.length === keys.length && own.every(k=>keys.indexOf(k)!==-1),'SAVE_HOST_FIELDS');
    const result = {}; keys.forEach(k=>{ result[k]=data(object,k); }); return result;
  }
  function freeze(value) { if (value && typeof value==='object') { Object.keys(value).forEach(k=>freeze(value[k])); Object.freeze(value); } return value; }
  function identity(value) {
    const result=exact(value,['packageId','wasmSha256']);
    need(typeof result.packageId==='string' && token.test(result.packageId) && typeof result.wasmSha256==='string' && /^[a-f0-9]{64}$/.test(result.wasmSha256),'SAVE_HOST_IDENTITY');
    return freeze(result);
  }
  function equalIdentity(value) { const other=identity(value); return other.packageId===config.identity.packageId && other.wasmSha256===config.identity.wasmSha256; }
  function integer(value,min,max) { return Number.isSafeInteger(value) && value>=min && value<=max; }
  const input=exact(options,['roots','wx','sessionOptions']), config=exact(input.sessionOptions,OPTION_NAMES);
  config.identity=identity(config.identity);
  need(typeof config.sessionId==='string' && token.test(config.sessionId),'SAVE_HOST_SESSION_ID');
  need(typeof config.directoryName==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(config.directoryName),'SAVE_HOST_DIRECTORY');
  need(['EXISTING_ONLY','CREATE_IF_MISSING'].indexOf(config.nativeDirectoryPolicy)!==-1 && typeof config.createMountpoint==='boolean','SAVE_HOST_DIRECTORY_POLICY');
  need(integer(config.maxFileBytes,1,1024*1024) && integer(config.maxTotalBytes,config.maxFileBytes,64*1024*1024)
    && integer(config.maxEntries,1,4096) && integer(config.maxDepth,1,32) && integer(config.maxRequests,1,1000000),'SAVE_HOST_LIMITS');
  freeze(config);
  need(Array.isArray(input.roots) && input.roots.length>0 && input.roots.length<=8,'SAVE_HOST_ROOTS');
  const roots=[];
  for (let i=0;i<input.roots.length;i++) { const root=data(input.roots,String(i)); need(root && (typeof root==='object'||typeof root==='function') && roots.indexOf(root)===-1,'SAVE_HOST_ROOTS'); roots.push(root); }
  need(input.wx && typeof input.wx==='object','SAVE_HOST_WX_REQUIRED');
  const wx=input.wx;
  let phase='NEW', attempted=false, invalidated=false, reason=null, module=null, methods=null, pending=null, ticketSerial=0, lastResult=null, busy=false;
  const cleanupErrors=[];let foreignRootsPreserved=0;
  let initializationStage='NOT_STARTED', initializationFailure=null, engineInitAttempted=false;
  function safeCode(error) { return internal.has(error) ? internal.get(error) : 'SAVE_HOST_OPERATION_FAILED'; }
  // Fixed vocabulary from the owned factory/session START path. Never publish
  // an arbitrary message, code, path, stack or toJSON from an external object.
  const startCodes=['SAVE_BUSY','SAVE_START_ONCE','SAVE_SESSION_INVALIDATED','SAVE_SESSION_CLOSING',
    'SAVE_MOUNTPOINT_MISSING','SAVE_MOUNTPOINT_NOT_VACANT_MEMFS','SAVE_NATIVE_ROOT_MISSING',
    'SAVE_NATIVE_NOT_DIRECTORY','SAVE_SYNC_RESULT_REQUIRED','SAVE_MOUNT_NOT_READY',
    'SAVE_OPERATION_FAILED','SAVE_SESSION_READY'];
  const initCodes=startCodes.concat(['SAVE_INIT_ALREADY_SELECTED','SAVE_INIT_AFTER_SHUTDOWN','SAVE_INIT_FAILED',
    'SAVE_FACTORY_OPTIONS_REQUIRED','SAVE_FACTORY_OPTION_FIELDS','SAVE_FACTORY_OPTION_DATA_FIELDS',
    'SAVE_FACTORY_IDENTITY_REQUIRED','SAVE_FACTORY_IDENTITY_FIELDS','SAVE_FACTORY_IDENTITY_DATA_FIELDS',
    'SAVE_OBJECT_REQUIRED','SAVE_OBJECT_FIELDS','SAVE_DATA_FIELDS_REQUIRED','SAVE_SESSION_ID',
    'SAVE_PACKAGE_IDENTITY','SAVE_NATIVE_DIRECTORY','SAVE_NATIVE_DIRECTORY_POLICY','SAVE_MOUNTPOINT_POLICY',
    'SAVE_REQUEST_LIMIT','SAVE_SDK_REQUIRED','SAVE_FS_REQUIRED','SAVE_OWNED_ROOT_REQUIRED','SAVE_LIMIT_REQUIRED','SAVE_METHOD_REQUIRED']);
  ['EIO','EINVAL','EBUSY','EFBIG','ENOSPC','ENOTSUP','ENODEV','ENOENT','EEXIST','ENOTDIR','EISDIR','ENOTEMPTY','S_IFDIR','S_IFREG','S_IFMT']
    .forEach(k=>initCodes.push('SAVE_CONSTANT_REQUIRED_'+k));
  function diagnosticData(value,key) {
    if (!value || (typeof value!=='object' && typeof value!=='function')) return undefined;
    const d=Object.getOwnPropertyDescriptor(value,key);
    return d && Object.prototype.hasOwnProperty.call(d,'value') ? d.value : undefined;
  }
  function member(value,list) { return list.indexOf(value)!==-1 ? value : null; }
  function rawNumber(value) { return Number.isSafeInteger(value) && value>=-2147483648 && value<=2147483647 ? value : null; }
  const startStages=['START_GUARD','MEMORY_LOOKUP','MEMORY_CREATE','MEMORY_VALIDATE','PARENT_STAT',
    'TARGET_STAT','TARGET_MISSING_CHECK','TARGET_MKDIR','TARGET_RESTAT','FS_MOUNT','MOUNT_VALIDATE',
    'PARENT_GUARD','TARGET_CREATE_GUARD','PRE_MOUNT_GUARD','POST_MOUNT_GUARD'];
  const startRoles=['NONE','MEMORY_MOUNT','NATIVE_PARENT','NATIVE_TARGET'];
  function projectStartLocation(receipt,out) {
    // New receipts identify the failing START branch. Old receipts stay unknown.
    // Enumerations only: no paths, state queries, getter execution or retry.
    for(const entry of [['failureStage',startStages],['failurePathRole',startRoles],['failedOperation',startStages]]) {
      try { out[entry[0]]=member(diagnosticData(receipt,entry[0]),entry[1]); } catch (_) { /* unknown */ }
    }
  }
  function projectCauseCode(cause,out) {
    if(cause===null || (typeof cause!=='object' && typeof cause!=='function')) {out.causeCodeRead='NOT_OBJECT';return;}
    let d;
    try {d=Object.getOwnPropertyDescriptor(cause,'code');} catch (_) {out.causeCodeRead='UNREADABLE';return;}
    if(!d) {out.causeCodeRead='ABSENT';return;}
    if(!Object.prototype.hasOwnProperty.call(d,'value')) {out.causeCodeRead='ACCESSOR';return;}
    const value=d.value;out.causeCodeRead='DATA';out.causeCodeType=value===null?null:typeof value;
    out.causeCodeToken=member(value,['ENOENT','EACCES','EPERM','ENOTDIR','EEXIST','EIO']);
    out.causeCodeNumber=rawNumber(value);
    // Arbitrary strings/objects remain unreported. This diagnostic must never
    // feed nativeMissing(), authorize mkdir or turn unknown into success.
  }
  function projectInitializationCause(receipt,out) {
    let descriptor;
    try { descriptor=Object.getOwnPropertyDescriptor(receipt,'cause'); }
    catch (_) { out.causeRead='UNREADABLE';return; }
    if(!descriptor) { out.causeRead='ABSENT';return; }
    if(!Object.prototype.hasOwnProperty.call(descriptor,'value')) { out.causeRead='ACCESSOR';return; }
    const cause=descriptor.value;
    out.causeRead='OBSERVED';out.causeType=cause===null?null:typeof cause;
    projectCauseCode(cause,out);
    // Null and throw-undefined are observed values, unlike an absent property.
    // Never inspect a prototype, invoke getters, or follow nested cause chains.
    let text;
    try { text=typeof cause==='string'?cause:diagnosticData(cause,'message'); }
    catch (_) { out.causeMessageRead='UNREADABLE';return; }
    if(typeof text!=='string') { out.causeMessageRead='NOT_DATA_STRING';return; }
    if(text.length>2048) { out.causeMessageRead='OVER_LIMIT';return; }
    out.causeMessageRead='OBSERVED';out.causeErrorToken=member(text,initCodes);
    // Text classification is diagnostic evidence only, never an errno mapping
    // or a reason to create a directory, retry, or relax initialization gates.
    if(text.indexOf('no such file or directory')!==-1 || /(?:^|[^A-Za-z0-9_])ENOENT(?:$|[^A-Za-z0-9_])/.test(text)) {
      out.messageKind='MISSING_PATH_TEXT';
    }
  }
  function boundStatus(value,schema) {
    const id=diagnosticData(value,'identity');
    return diagnosticData(value,'schema')===schema && diagnosticData(value,'sessionId')===config.sessionId
      && diagnosticData(id,'packageId')===config.identity.packageId && diagnosticData(id,'wasmSha256')===config.identity.wasmSha256;
  }
  function captureInitializationFailure(error) {
    const out={schema:'wxslim-persistent-init-failure-v1',stage:initializationStage,code:safeCode(error),
      errorToken:null,statusRead:'NOT_ATTEMPTED',observation:'ONCE_AFTER_REJECTION_NOT_FAILURE_TIME',
      sessionPhase:null,backendPhase:null,receiptRead:'NOT_OBSERVED',receiptCode:null,
      errno:null,nativeCode:null,memoryDirectoryCreated:null,nativeDirectoryCreated:null,nativeMutationAttempted:null,
      failureStage:null,failurePathRole:null,failedOperation:null,
      causeRead:'NOT_OBSERVED',causeType:null,causeMessageRead:'NOT_OBSERVED',messageKind:null,causeErrorToken:null,
      causeCodeRead:'NOT_OBSERVED',causeCodeType:null,causeCodeToken:null,causeCodeNumber:null};
    // Only an exact owned token may survive this projection; never log the
    // original message. The original exception remains on the local cause.
    try { out.errorToken=member(diagnosticData(error,'message'),initCodes); } catch (_) { /* unknown */ }
    if(engineInitAttempted) {
      try {
        const fn=methods && methods.persistentFileStatus;
        if(typeof fn!=='function')out.statusRead='METHOD_UNAVAILABLE';
        else if(diagnosticData(module,'persistentFileStatus')!==fn)out.statusRead='METHOD_CHANGED';
        else {
          out.statusRead='CALL_FAILED';
          const observed=fn.call(module); // one existing read-only status call; no native I/O or retry
          out.statusRead='PROJECTION_FAILED';
          if(observed===null)out.statusRead='NO_SESSION';
          else if(!boundStatus(observed,'wxslim-persistent-session-status-v1'))out.statusRead='IDENTITY_MISMATCH';
          else {
            out.statusRead='OBSERVED';
            out.sessionPhase=member(diagnosticData(observed,'phase'),['NEW','STARTING','READY','FAILED','INVALIDATED','STOPPED']);
            out.backendPhase=member(diagnosticData(diagnosticData(observed,'backend'),'phase'),['NEW','RESTORING','READY','TAINTED','DETACHED','MOUNT_FAILED']);
            ['memoryDirectoryCreated','nativeDirectoryCreated','nativeMutationAttempted'].forEach(k=>{
              const v=diagnosticData(observed,k);out[k]=typeof v==='boolean'?v:null;
            });
            const r=diagnosticData(observed,'lastReceipt');
            if(r===null)out.receiptRead='NONE';
            else if(!boundStatus(r,'wxslim-persistent-session-v1') || diagnosticData(r,'operation')!=='START')out.receiptRead='IDENTITY_OR_OPERATION_MISMATCH';
            else {
              out.receiptRead='OBSERVED';out.receiptCode=member(diagnosticData(r,'code'),startCodes);
              projectStartLocation(r,out);
              projectInitializationCause(r,out);
              const e=diagnosticData(r,'error');out.errno=rawNumber(diagnosticData(e,'errno'));out.nativeCode=rawNumber(diagnosticData(e,'nativeCode'));
            }
          }
        }
      } catch (_) {
        if(out.statusRead==='OBSERVED')out.statusRead='PROJECTION_FAILED';
        // Keep any fields already read as own data, leave the rest unknown.
        // Never replace the original initialization failure.
      }
    }
    return freeze(out);
  }
  function ownPublication(root) { const d=Object.getOwnPropertyDescriptor(root,KEY); return !!(d && Object.prototype.hasOwnProperty.call(d,'value') && d.value===client); }
  function removeOwn() {
    foreignRootsPreserved=0;
    roots.forEach((root,index)=>{
      try {
        if (ownPublication(root)) { need(delete root[KEY],'SAVE_HOST_REMOVE_FAILED');need(!ownPublication(root),'SAVE_HOST_REMOVE_FAILED'); }
        else if(Object.getOwnPropertyDescriptor(root,KEY) || KEY in root)foreignRootsPreserved++;
      } catch (_) {
        if(!cleanupErrors.some(error=>error.rootIndex===index))cleanupErrors.push(Object.freeze({rootIndex:index,code:'SAVE_HOST_REMOVE_FAILED'}));
      }
    });
  }
  function invalidate(value) {
    invalidated=true;phase='INVALIDATED';reason=typeof value==='string' && codeToken.test(value) ? value : 'SAVE_HOST_INVALIDATED';pending=null;removeOwn();
    return freeze({ok:cleanupErrors.length===0,code:reason,interfacesInvalidated:true,cleanupErrors:cleanupErrors.slice(),foreignRootsPreserved,mountDisposition:'NOT_UNMOUNTED_BY_HOST',nativeFilesDeleted:false});
  }
  function availableRoots() { roots.forEach(root=>need(!Object.getOwnPropertyDescriptor(root,KEY) && !(KEY in root),'SAVE_HOST_ROOT_OCCUPIED')); }
  function unchangedMethods() { METHOD_NAMES.forEach(name=>need(data(module,name)===methods[name],'SAVE_HOST_METHOD_CHANGED')); }
  function ownedRoots() { roots.forEach(root=>need(ownPublication(root),'SAVE_HOST_ROOT_CHANGED')); }
  function sessionStatus() {
    unchangedMethods(); const s=methods.persistentFileStatus.call(module);
    need(s && typeof s==='object','SAVE_HOST_SESSION_NOT_READY');
    need(data(s,'sessionId')===config.sessionId && equalIdentity(data(s,'identity')),'SAVE_HOST_IDENTITY_MISMATCH');
    need(data(s,'phase')==='READY' && data(s,'active')===true && data(data(s,'backend'),'phase')==='READY','SAVE_HOST_SESSION_NOT_READY');
    const closing=Object.getOwnPropertyDescriptor(s,'closing'); need(!closing || data(s,'closing')===false,'SAVE_HOST_SESSION_NOT_READY');
    const id=data(s,'nextRequestId'), generation=data(data(s,'backend'),'generation');
    need(integer(id,1,config.maxRequests+1) && integer(generation,0,Number.MAX_SAFE_INTEGER),'SAVE_HOST_SESSION_STATE');
    return {requestId:id,generation};
  }
  function ready() {
    need(!invalidated && phase==='READY','SAVE_HOST_NOT_READY');
    try { ownedRoots(); const s=sessionStatus();ownedRoots();unchangedMethods();return s; }
    catch (error) { invalidate(safeCode(error));throw error; }
  }
  function result(code,ticket,writer,receipt) {
    const value=freeze({schema:'wxslim-persistent-client-result-v1',ok:!!(receipt && receipt.status==='VERIFIED'),code,
      ticket:ticket||null,writerEvidenceSource:'GODOT_FILEACCESS_CALLER_REPORTED',writer:writer||null,receipt:receipt||null,engineResultVerified:false});
    lastResult=value; return JSON.stringify(value);
  }
  function guarded(action) {
    if (busy) return result('SAVE_HOST_BUSY',null,null,null);
    busy=true;try { return action(); } catch (error) { return result(safeCode(error),null,null,null); } finally { busy=false; }
  }
  function path(value) {
    need(typeof value==='string' && value.length>0 && value.length<=1024,'SAVE_HOST_PATH');
    const parts=value.split('/');need(parts.length<=config.maxDepth && parts.every(p=>p.length>0 && p.length<=255
      && !/[\\:\x00-\x1f\x7f?#%]/.test(p) && ['.','..','__proto__','prototype','constructor'].indexOf(p)===-1),'SAVE_HOST_PATH');return value;
  }
  function parse(value,limit) { need(typeof value==='string' && value.length<=limit,'SAVE_HOST_JSON');try { return JSON.parse(value); } catch (_) { problem('SAVE_HOST_JSON'); } }
  function writer(value) {
    const w=exact(value,['openError','storeReturned','storeError','flushError','closeError','stillOpen']);
    need(integer(w.openError,0,2147483647),'SAVE_HOST_WRITER');
    if (w.openError!==0) need(['storeReturned','storeError','flushError','closeError','stillOpen'].every(k=>w[k]===null),'SAVE_HOST_WRITER');
    else need(typeof w.storeReturned==='boolean' && typeof w.stillOpen==='boolean' && ['storeError','flushError','closeError'].every(k=>integer(w[k],0,2147483647)),'SAVE_HOST_WRITER');
    return freeze(w);
  }
  function sameTicket(value,expected) {
    const t=exact(value,['schema','sessionId','identity','ticketId','requestId','relativePath','byteLength','generationBeforeWrite']);
    need(equalIdentity(t.identity) && Object.keys(t).filter(k=>k!=='identity').every(k=>t[k]===expected[k]),'SAVE_HOST_TICKET_MISMATCH');
  }
  function decode(value,length) {
    need(typeof value==='string' && value.length===Math.ceil(length/3)*4,'SAVE_HOST_BASE64');
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out=new Uint8Array(length);let at=0;
    for (let i=0;i<value.length;i+=4) {
      const a=alphabet.indexOf(value.charAt(i)), b=alphabet.indexOf(value.charAt(i+1)), c=value.charAt(i+2), d=value.charAt(i+3);
      need(a>=0 && b>=0,'SAVE_HOST_BASE64');const final=i+4===value.length,remain=length-at;
      if (final && remain===1) { need(c==='=' && d==='=' && (b&15)===0,'SAVE_HOST_BASE64');out[at++]=(a<<2)|(b>>4); }
      else if (final && remain===2) { const n=alphabet.indexOf(c);need(n>=0 && d==='=' && (n&3)===0,'SAVE_HOST_BASE64');out[at++]=(a<<2)|(b>>4);out[at++]=((b&15)<<4)|(n>>2); }
      else { const n=alphabet.indexOf(c),m=alphabet.indexOf(d);need(n>=0 && m>=0 && remain>=3,'SAVE_HOST_BASE64');out[at++]=(a<<2)|(b>>4);out[at++]=((b&15)<<4)|(n>>2);out[at++]=((n&3)<<6)|m; }
    }
    need(at===length,'SAVE_HOST_BASE64');return out;
  }
  function cleanReceipt(value,requestId) {
    // Project only the session service's public receipt vocabulary. Unknown
    // errors, raw causes, paths and injected Module properties never reach JSON.
    need(value && typeof value==='object','SAVE_HOST_RECEIPT');
    const r={};
    ['schema','operation','sessionId','requestId','status','code','expectedGeneration','generationBefore','generationAfter','engineResultVerified','restartRecovery','durability','atomicity','nativeReadbackVerified'].forEach(k=>{r[k]=data(value,k);});
    need(r.schema==='wxslim-persistent-session-v1' && r.operation==='VERIFY' && r.sessionId===config.sessionId && r.requestId===requestId
      && ['VERIFIED','FAILED'].indexOf(r.status)!==-1 && typeof r.code==='string' && codeToken.test(r.code)
      && r.engineResultVerified===false && r.restartRecovery==='NOT_TESTED' && r.durability==='NOT_PROVEN' && r.atomicity==='NOT_PROVEN','SAVE_HOST_RECEIPT');
    ['expectedGeneration','generationBefore','generationAfter'].forEach(k=>need(r[k]===null || integer(r[k],0,Number.MAX_SAFE_INTEGER),'SAVE_HOST_RECEIPT'));
    need(r.nativeReadbackVerified===null || typeof r.nativeReadbackVerified==='boolean','SAVE_HOST_RECEIPT');
    need(equalIdentity(data(value,'identity')),'SAVE_HOST_RECEIPT');r.identity=config.identity;
    const w=data(value,'callerWriterEvidence');r.callerWriterEvidence=w===null ? null : exact(w,['storeReturned','storeError','flushError','closeError']);
    if (w!==null) need(typeof r.callerWriterEvidence.storeReturned==='boolean' && ['storeError','flushError','closeError'].every(k=>integer(r.callerWriterEvidence[k],0,2147483647)),'SAVE_HOST_RECEIPT');
    const files=data(value,'files');need(Array.isArray(files) && files.length<=1,'SAVE_HOST_RECEIPT');
    r.files=files.map(file=>{const f=exact(file,['id','expectedBytes','memoryBytes','nativeBytes','memoryNativeMatch','expectedContentMatch']);need(f.id==='save' && ['expectedBytes','memoryBytes','nativeBytes'].every(k=>integer(f[k],0,config.maxFileBytes)) && typeof f.memoryNativeMatch==='boolean' && typeof f.expectedContentMatch==='boolean','SAVE_HOST_RECEIPT');return f;});
    const claim=Object.getOwnPropertyDescriptor(value,'claim');if(claim){r.claim=data(value,'claim');need(typeof r.claim==='string' && codeToken.test(r.claim),'SAVE_HOST_RECEIPT');}
    const err=Object.getOwnPropertyDescriptor(value,'error');if(err){const e=exact(data(value,'error'),['code','errno','nativeCode']);need(typeof e.code==='string' && codeToken.test(e.code) && ['errno','nativeCode'].every(k=>e[k]===null || Number.isSafeInteger(e[k])),'SAVE_HOST_RECEIPT');r.error=e;}
    return freeze(r);
  }
  const client=Object.freeze({
    configurationJSON:function () { return guarded(()=>{ready();return JSON.stringify({schema:'wxslim-persistent-client-config-v1',sessionId:config.sessionId,identity:config.identity,mountPath:'/userfs',maxFileBytes:config.maxFileBytes,maxRequests:config.maxRequests});}); },
    prepareFile:function (relativePath,byteLength) { return guarded(()=>{
      const s=ready();
      path(relativePath);need(integer(byteLength,0,config.maxFileBytes),'SAVE_HOST_BYTE_LENGTH');need(!pending,'SAVE_HOST_PENDING');
      need(s.requestId<=config.maxRequests,'SAVE_HOST_REQUEST_LIMIT');need(ticketSerial<Number.MAX_SAFE_INTEGER,'SAVE_HOST_TICKET_LIMIT');
      pending=freeze({schema:'wxslim-persistent-ticket-v1',sessionId:config.sessionId,identity:config.identity,ticketId:++ticketSerial,requestId:s.requestId,relativePath,byteLength,generationBeforeWrite:s.generation});
      return JSON.stringify({ok:true,code:'SAVE_PREPARED',ticket:pending});
    }); },
    completeFile:function (ticketJSON,writerJSON,base64) { return guarded(()=>{
      const ticket=pending;pending=null;let w=null;
      try {
        ready();
        need(ticket,'SAVE_HOST_NO_PENDING');sameTicket(parse(ticketJSON,8192),ticket);w=writer(parse(writerJSON,2048));const bytes=decode(base64,ticket.byteLength);
        const s=ready();need(s.requestId===ticket.requestId && s.generation>=ticket.generationBeforeWrite,'SAVE_HOST_REQUEST_CHANGED');
        const writerEvidence=w.openError===0 && w.stillOpen===false ? {storeReturned:w.storeReturned,storeError:w.storeError,flushError:w.flushError,closeError:w.closeError} : null;
        const observed=methods.verifyPersistentFiles.call(module,{sessionId:config.sessionId,requestId:ticket.requestId,expectedGeneration:s.generation,files:[{id:'save',relativePath:ticket.relativePath,bytes}],writerEvidence});
        need(!observed || typeof observed.then!=='function','SAVE_HOST_SYNC_VERIFY_REQUIRED');
        // Failed verification may legitimately quarantine its backend. Do not
        // turn a genuine FAILED receipt into success or demand READY afterward.
        need(!invalidated && phase==='READY','SAVE_HOST_NOT_READY');
        try { ownedRoots();unchangedMethods(); } catch(error) { invalidate(safeCode(error));throw error; }
        const receipt=cleanReceipt(observed,ticket.requestId);
        need((writerEvidence===null && receipt.callerWriterEvidence===null) || (writerEvidence!==null && receipt.callerWriterEvidence!==null
          && Object.keys(writerEvidence).every(k=>writerEvidence[k]===receipt.callerWriterEvidence[k])),'SAVE_HOST_RECEIPT');
        if(receipt.status==='VERIFIED')need(writerEvidence && writerEvidence.storeReturned && writerEvidence.storeError===0 && writerEvidence.flushError===0 && writerEvidence.closeError===0
          && receipt.expectedGeneration===s.generation && receipt.generationBefore===s.generation && receipt.generationAfter===s.generation
          && receipt.nativeReadbackVerified===true && receipt.files.length===1 && receipt.files[0].expectedBytes===ticket.byteLength
          && receipt.files[0].memoryBytes===ticket.byteLength && receipt.files[0].nativeBytes===ticket.byteLength
          && receipt.files[0].memoryNativeMatch && receipt.files[0].expectedContentMatch,'SAVE_HOST_RECEIPT');
        if(receipt.status==='VERIFIED'){const after=ready();need(after.generation===s.generation && after.requestId===ticket.requestId+1,'SAVE_HOST_RECEIPT');}
        return result(receipt.code,ticket,w,receipt);
      } catch (error) { return result(safeCode(error),ticket,w,null); }
    }); },
  });
  function initialize(value) {
    if(attempted)return Promise.reject(new Error('SAVE_HOST_INITIALIZE_ONCE'));
    attempted=true;phase=invalidated?'INVALIDATED':'INITIALIZING';
    return Promise.resolve().then(function () {
      initializationStage='CHECK_ROOTS';
      need(!invalidated,'SAVE_HOST_INVALIDATED');availableRoots();
      initializationStage='CAPTURE_METHODS';
      need(value && typeof value==='object','SAVE_HOST_MODULE_REQUIRED');module=value;methods={};
      METHOD_NAMES.forEach(name=>{const fn=data(module,name);need(typeof fn==='function','SAVE_HOST_ENGINE_UNSUPPORTED');methods[name]=fn;});
      initializationStage='GET_FILE_SYSTEM';
      const getManager=wx.getFileSystemManager;need(typeof getManager==='function','SAVE_HOST_WX_METHOD');
      const fileSystem=getManager.call(wx);
      initializationStage='GET_USER_DATA_PATH';
      const env=wx.env,userDataPath=env && env.USER_DATA_PATH;
      need(!invalidated,'SAVE_HOST_INVALIDATED');need(fileSystem && typeof fileSystem==='object' && typeof userDataPath==='string','SAVE_HOST_WX_HANDLES');
      const args={};OPTION_NAMES.forEach(name=>{args[name]=config[name];});args.fileSystem=fileSystem;args.userDataPath=userDataPath;
      initializationStage='ENGINE_INITIALIZE';
      unchangedMethods();engineInitAttempted=true;return methods.initPersistentFileSession.call(module,args);
    }).then(function (receipt) {
      initializationStage='CHECK_INIT_RECEIPT';
      need(!invalidated,'SAVE_HOST_INVALIDATED');need(receipt && data(receipt,'status')==='READY','SAVE_HOST_INIT_FAILED');
      initializationStage='VERIFY_SESSION';sessionStatus();
      initializationStage='CHECK_PUBLICATION';availableRoots();need(!invalidated,'SAVE_HOST_INVALIDATED');unchangedMethods();
      initializationStage='PUBLISH_INTERFACE';
      roots.forEach(root=>Object.defineProperty(root,KEY,{value:client,writable:false,configurable:true,enumerable:false}));
      initializationStage='CHECK_PUBLISHED_INTERFACE';
      ownedRoots();unchangedMethods();need(!invalidated,'SAVE_HOST_INVALIDATED');phase='READY';initializationStage='READY';return Object.freeze({ok:true,code:'SAVE_HOST_READY'});
    }).catch(function (error) {
      initializationFailure=captureInitializationFailure(error);
      if(!invalidated)phase='FAILED';removeOwn();
      const wrapped=new Error(safeCode(error));
      Object.defineProperty(wrapped,'cause',{value:error}); // local debugger only, not serialized or sent to console
      throw wrapped;
    });
  }
  return Object.freeze({hooks:Object.freeze({initialize,invalidate}),status:function () {
    return freeze({schema:'wxslim-persistent-host-status-v1',phase,sessionId:config.sessionId,identity:config.identity,initializationAttempted:attempted,invalidated,reason,pendingTicket:pending,lastResult,
      cleanupErrors:cleanupErrors.slice(),foreignRootsPreserved,mountDisposition:'NOT_UNMOUNTED_BY_HOST',nativeFilesDeleted:false,
      initializationStage,initializationFailure});
  }});
}
if(typeof module==='object' && module.exports)module.exports=createPersistentHostRuntime;
}());
