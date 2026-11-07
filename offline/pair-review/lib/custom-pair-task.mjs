// Async source-provenance branch of bounded pair preparation. No new task
// controller, raw build, directory creation, WASM copy, conversion or runtime.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareDevelopmentCustomPairSource} from '../engine/custom-pair-source.mjs';
import {retainedProvenance,retainedTaskId} from '../engine/retained-custom-2d-source.mjs';

export const CUSTOM_PAIR_PROFILE='custom-official-c050-dev'; // not a converter registration
export const CUSTOM_PAIR_CONFIG='wxslim-custom-pair-preparation-v1';
const JS_LIMIT=4*1024*1024,RECEIPT_LIMIT=4*1024*1024;
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const need=(value,reason)=>{if(!value)throw Object.assign(Error(reason),{reason});};
const same=(a,b)=>need(isDeepStrictEqual(a,b),'PAIR_CUSTOM_IDENTITY_CHANGED');
const receiptFor=before=>({...before,schema:'wxslim-custom-pair-preparation-result-v1',status:'PREPARED_NOT_ADMITTED',written:true,writeAuthorized:true});
const sourceFiles=['lib/custom-pair-task.mjs','lib/task-core.mjs','lib/capabilities.mjs','lib/capabilities.json'];
function regular(file,max){
 if(file instanceof URL)file=fileURLToPath(file);
 const st=fs.lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=max&&norm(fs.realpathSync(file))===norm(file),'PAIR_CUSTOM_FILE_INVALID');
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
 need(bytes.length===st.size&&['size','dev','ino','mtimeMs','ctimeMs'].every(k=>st[k]===after[k]),'PAIR_CUSTOM_FILE_CHANGED');
 return bytes;
}
function parent(file){const st=fs.lstatSync(file);need(st.isDirectory()&&!st.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'PAIR_CUSTOM_PARENT_INVALID');return {dev:st.dev,ino:st.ino};}
function absent(file){try{fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return;throw e;}need(false,'PAIR_CUSTOM_OUTPUT_EXISTS');}
function safePath(base,value){
 need(typeof value==='string'&&value.trim()&&!/[\0\r\n]/.test(value),'PAIR_CUSTOM_PATH_INVALID');
 const result=path.resolve(base,value);
 if(process.platform==='win32')need(result.slice(path.parse(result).root.length).split(path.sep).every(p=>
  !/[<>:"|?*]/.test(p)&&!/[. ]$/.test(p)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)),'PAIR_CUSTOM_PATH_INVALID');
 return result;
}
function readConfig(file){
 need(typeof file==='string'&&file.trim(),'PAIR_CUSTOM_CONFIG_REQUIRED');file=path.resolve(file);
 const bytes=regular(file,64*1024),text=bytes.toString('utf8');need(Buffer.from(text).equals(bytes),'PAIR_CUSTOM_CONFIG_UTF8');
 const raw=JSON.parse(text);assert.deepEqual(Object.keys(raw).sort(),['schema','rawTaskRoot','rawTaskId','outputJs','receipt'].sort());
 need(raw.schema===CUSTOM_PAIR_CONFIG&&typeof raw.rawTaskId==='string'&&/^[a-f0-9-]{36}$/.test(raw.rawTaskId),'PAIR_CUSTOM_CONFIG_SCHEMA');
 const base=path.dirname(file),config={schema:CUSTOM_PAIR_CONFIG,rawTaskId:raw.rawTaskId};
 for(const key of ['rawTaskRoot','outputJs','receipt'])config[key]=safePath(base,raw[key]);
 need(norm(path.dirname(config.outputJs))===norm(path.dirname(config.receipt)),'PAIR_CUSTOM_SAME_PARENT_REQUIRED');
 need(new Set([file,config.outputJs,config.receipt].map(norm)).size===3,'PAIR_CUSTOM_PATH_COLLISION');
 // A completed raw task is immutable evidence; write to a separate already
 // approved/existing parent, not anywhere in its source/artifact/record tree.
 for(const target of [config.outputJs,config.receipt]){
  const rel=path.relative(norm(config.rawTaskRoot),norm(target));
  need(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep),'PAIR_CUSTOM_RAW_TREE_PROTECTED');
 }
 return {file,config,configuration:pin(bytes)};
}
function bounded(error,created={js:false,receipt:false},attempted={js:false,receipt:false}){
 const touched=Object.values(created).some(Boolean)||Object.values(attempted).some(Boolean);
 return Object.assign(Error('TASK_PAIR_PREPARATION_FAILED'),{code:'TASK_PAIR_PREPARATION_FAILED',
  reason:/^PAIR_CUSTOM_[A-Z_]{1,64}$/.test(error?.reason||'')?error.reason:
   error?.code==='CUSTOM_PAIR_SOURCE_CHECK_REJECTED'?'PAIR_CUSTOM_SOURCE_REJECTED':error?.code==='EEXIST'?'PAIR_CUSTOM_OUTPUT_EXISTS':'PAIR_CUSTOM_CHECK_REJECTED',
  created:{...created},attempted:{...attempted},possibleSideEffects:touched?'PARTIAL_OUTPUT_POSSIBLE':'NONE'});
}
function validateSource(handle,input){
 const s=handle?.summary,h=s?.derivation?.hostProposal;
 const retained=s?.schema==='wxslim-retained-custom-pair-source-check-v1'&&s.taskId===retainedTaskId&&
  s.buildProvenance===retainedProvenance&&s.retainedEvidence?.originalTerminal==='FAILED'&&s.retainedEvidence?.originalArtifactState==='RAW_NOT_CAPTURED';
 const completed=s?.schema==='wxslim-completed-custom-pair-source-check-v1'&&s.buildProvenance==='COMPLETED_CUSTOM_RAW_TASK_RECHECKED';
 need((completed||retained)&&s.status==='CUSTOM_PAIR_SOURCE_CHECKED_NOT_ADMITTED'&&
  s.taskId===input.config.rawTaskId&&s.sourceRecipe==='official-c050-capability-custom'&&
  s.sourceTreeRechecked===true&&s.rawArtifactBytesRechecked===true&&s.admission==='NOT_ADMITTED'&&s.runtime==='NOT_RUN'&&s.phone==='NOT_RUN',
  'PAIR_CUSTOM_SOURCE_SUMMARY');
 for(const key of ['executionAuthorized','buildExecuted','workCreated','written','wasmCopied','hostSelected','converterAccepted'])need(s[key]===false,'PAIR_CUSTOM_SOURCE_SUMMARY');
 need(h?.status==='HOST_SOURCE_PROPOSED_NOT_ADMITTED'&&h.admission==='NOT_ADMITTED'&&h.hostInstalled===false&&h.converterAccepted===false,
  'PAIR_CUSTOM_HOST_SUMMARY');
 need(Buffer.isBuffer(handle.js)&&handle.js.length>0&&handle.js.length<=JS_LIMIT&&Buffer.isBuffer(handle.bridge)&&
  typeof handle.recheck==='function','PAIR_CUSTOM_SOURCE_BYTES');
 assert.deepEqual(pin(handle.js),s.outputJs);assert.deepEqual(pin(handle.bridge),s.outputBridge);
}

// Injection is for isolated protocol tests only; requests never select a source
// checker. Default exports below always use the completed-task source auditor.
export function createCustomPairPreparation({prepareSource=prepareDevelopmentCustomPairSource}={}){
 async function prepare(file,{completed=false}={}){
  const input=readConfig(file),cfg=input.config,outputDirectory=path.dirname(cfg.outputJs),parentPin=parent(outputDirectory);
  if(!completed){absent(cfg.outputJs);absent(cfg.receipt);}
  const sources=Object.fromEntries(sourceFiles.map(name=>[name,pin(regular(new URL('../'+name,import.meta.url),4*1024*1024))]));
  const handle=await prepareSource(cfg.rawTaskRoot,cfg.rawTaskId);validateSource(handle,input);
  const sourceCheck=structuredClone(handle.summary);
  const before={schema:'wxslim-custom-pair-preparation-check-v1',status:'CHECKED_NOT_WRITTEN',profile:CUSTOM_PAIR_PROFILE,
   configuration:input.configuration,sourceCheck,outputJs:pin(handle.js),outputBridge:pin(handle.bridge),sources,
   wasmCopied:false,bridgeWritten:false,hostInstalled:false,converterAccepted:false,
   writeAuthorized:false,written:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
   scope:'New JS and receipt only; host bytes are derived but not installed. Source and file identities are checkpoint checks, not an adversarial filesystem transaction.'};
  need(Buffer.byteLength(JSON.stringify(receiptFor(before),null,2)+'\n')<=RECEIPT_LIMIT,'PAIR_CUSTOM_RECEIPT_TOO_LARGE');
  const stable=async()=>{
   assert.deepEqual(readConfig(input.file),input,'PAIR_CUSTOM_CONFIG_CHANGED');assert.deepEqual(parent(outputDirectory),parentPin);
   for(const name of sourceFiles)assert.deepEqual(pin(regular(new URL('../'+name,import.meta.url),4*1024*1024)),sources[name]);
   await handle.recheck();validateSource(handle,input);same(handle.summary,sourceCheck);
  };
  await stable();
  return {input,before,plan:{...before,outputDirectory,outputs:{js:cfg.outputJs,receipt:cfg.receipt}},profile:CUSTOM_PAIR_PROFILE,handle,stable};
 }
 return Object.freeze({
  async prepare(file){try{const {input,before,plan,profile}=await prepare(file);return {input,before,plan,profile};}catch(e){throw bounded(e);}},
  // A saved receipt is not authority. Recreate its source audit and derivation
  // from the real raw task before accepting either persisted file. This is a
  // read-only in-process handle, not a converter registration or runtime pass.
  async readCompleted(file){
   try{
    const state=await prepare(file,{completed:true}),cfg=state.input.config;
    const expected=receiptFor(state.before),saved=regular(cfg.receipt,RECEIPT_LIMIT);
    same(JSON.parse(saved.toString('utf8')),expected);
    same(regular(cfg.outputJs,JS_LIMIT),state.handle.js);
    const receiptPin=pin(saved),jsPin=pin(state.handle.js);
    const recheck=async()=>{
     await state.stable();
     same(pin(regular(cfg.receipt,RECEIPT_LIMIT)),receiptPin);
     same(pin(regular(cfg.outputJs,JS_LIMIT)),jsPin);
    };
    await recheck();
    return {summary:structuredClone(state.handle.summary),js:Buffer.from(state.handle.js),bridge:Buffer.from(state.handle.bridge),
     preparation:{schema:'wxslim-completed-custom-preparation-check-v1',status:'PREPARED_FILES_RECHECKED_NOT_ADMITTED',
      configuration:state.input.configuration,receipt:receiptPin,js:jsPin,rawTaskId:cfg.rawTaskId,
      sourceReaudited:true,written:false,converterAccepted:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN'},recheck};
   }catch(e){throw bounded(e);}
  },
  async execute(input,before,{writeAuthorized=false}={}){
   const created={js:false,receipt:false},attempted={js:false,receipt:false};
   try{
    need(writeAuthorized===true,'PAIR_CUSTOM_WRITE_REQUIRED');
    const state=await prepare(input?.file),cfg=state.input.config;
    // Caller snapshots cannot select bytes or skip the source/build recheck.
    same(state.input,input);same(state.before,before);
    const write=(file,bytes,key)=>{attempted[key]=true;fs.writeFileSync(file,bytes,{flag:'wx',flush:true});created[key]=true;
     assert.deepEqual(pin(regular(file,bytes.length)),pin(bytes));};
    await state.stable();absent(cfg.outputJs);absent(cfg.receipt);
    write(cfg.outputJs,state.handle.js,'js');await state.stable();
    assert.deepEqual(pin(regular(cfg.outputJs,JS_LIMIT)),before.outputJs);
    const receipt=receiptFor(state.before);
    const receiptBytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');need(receiptBytes.length<=RECEIPT_LIMIT,'PAIR_CUSTOM_RECEIPT_TOO_LARGE');
    write(cfg.receipt,receiptBytes,'receipt');await state.stable();
    assert.deepEqual(pin(regular(cfg.outputJs,JS_LIMIT)),before.outputJs);
    same(regular(cfg.receipt,RECEIPT_LIMIT),receiptBytes);
    return {status:'SUCCESS',executionMode:'bounded-files',taskId:null,artifactState:'PREPARED_NOT_ADMITTED',admission:'NOT_ADMITTED',
     profile:CUSTOM_PAIR_PROFILE,packageId:null,sourceTaskId:before.sourceCheck.taskId,
     outputs:{js:{path:cfg.outputJs,...before.outputJs},receipt:{path:cfg.receipt,...pin(receiptBytes)}},
     wasmCopied:false,bridgeWritten:false,hostInstalled:false,converterAccepted:false,engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'};
   }catch(e){throw bounded(e,created,attempted);}
  }
 });
}
const production=createCustomPairPreparation();
export const prepareCustomPairTask=production.prepare;
export const executeCustomPairTask=production.execute;
export const readCompletedCustomPairTask=production.readCompleted;
