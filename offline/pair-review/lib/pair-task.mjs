// Bounded-file task adapter only. The existing pair preparer owns all writes.
// No task directory, cancellation controller, cleanup, retry or target execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readConfig,checkOfficialPairPreparation,executeOfficialPairPreparation} from '../engine/official-pair-prepare.mjs';
import {isOfficialC050Profile} from '../convert/lib/official-engine-admission.mjs';

const JS_LIMIT=4*1024*1024,RECEIPT_LIMIT=1024*1024,WASM_LIMIT=256*1024*1024;
const pin=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const norm=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
const need=(value,reason)=>{if(!value)throw Object.assign(Error(reason),{pairReason:reason});};
function validPin(value,max){
  return value&&Object.keys(value).sort().join(',')==='bytes,sha256'&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&
    value.bytes<=max&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
}
function read(file,max){
  need(typeof file==='string'&&path.isAbsolute(file),'PAIR_TASK_PATH_INVALID');
  const before=fs.lstatSync(file);
  need(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=max&&norm(fs.realpathSync(file))===norm(file),'PAIR_TASK_FILE_INVALID');
  const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
  need(after.isFile()&&!after.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file)&&bytes.length===before.size&&
    ['size','dev','ino','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'PAIR_TASK_FILE_CHANGED');
  return {data:bytes,...pin(bytes)};
}
function identity(record){return {bytes:record.bytes,sha256:record.sha256};}
function parent(config){
  need(norm(path.dirname(config.outputJs))===norm(path.dirname(config.receipt)),'PAIR_TASK_PARENT_MISMATCH');
  const directory=path.dirname(config.outputJs),stat=fs.lstatSync(directory);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&norm(fs.realpathSync(directory))===norm(directory),'PAIR_TASK_PARENT_INVALID');
  return directory;
}
function absent(file){
  try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
  need(false,'PAIR_TASK_OUTPUT_EXISTS');
}
function checkInput(input,before){
  need(input&&typeof input.file==='string'&&path.isAbsolute(input.file)&&input.config?.schema==='wxslim-official-pair-preparation-v1','PAIR_TASK_INPUT_INVALID');
  const cfg=input.config;
  need(Object.keys(cfg).sort().join(',')==='outputJs,rawJs,receipt,schema,wasm'&&
    ['rawJs','wasm','outputJs','receipt'].every(k=>typeof cfg[k]==='string'&&path.isAbsolute(cfg[k])),'PAIR_TASK_INPUT_INVALID');
  need(new Set([input.file,cfg.rawJs,cfg.wasm,cfg.outputJs,cfg.receipt].map(norm)).size===5,'PAIR_TASK_PATH_COLLISION');
  need(before?.schema==='wxslim-official-pair-preparation-check-v1'&&before.status==='CHECKED_NOT_WRITTEN'&&
    isOfficialC050Profile(before.profile)&&before.admission==='NOT_ADMITTED'&&before.written===false&&before.writeAuthorized===false&&
    before.runtime==='NOT_RUN'&&before.engineRun==='NOT_RUN'&&before.phone==='NOT_RUN'&&before.visual==='NOT_VERIFIED'&&before.wasmCopied===false,'PAIR_TASK_CHECK_INVALID');
  need(validPin(before.outputJs,JS_LIMIT)&&validPin(before.configuration,64*1024)&&
    validPin(before.inputs?.rawJs,JS_LIMIT)&&validPin(before.inputs?.wasm,WASM_LIMIT),'PAIR_TASK_PIN_INVALID');
  assert.deepEqual(input.configuration,before.configuration,'PAIR_TASK_CONFIGURATION_MISMATCH');
  const document=read(input.file,64*1024);assert.deepEqual(identity(document),before.configuration,'PAIR_TASK_CONFIGURATION_CHANGED');
  const raw=JSON.parse(document.data.toString('utf8')),normalized={schema:raw.schema};
  need(Object.keys(raw).sort().join(',')==='outputJs,rawJs,receipt,schema,wasm','PAIR_TASK_CONFIGURATION_MISMATCH');
  for(const key of ['rawJs','wasm','outputJs','receipt']){
    need(typeof raw[key]==='string'&&raw[key].trim(),'PAIR_TASK_CONFIGURATION_MISMATCH');
    normalized[key]=path.resolve(path.dirname(input.file),raw[key]);
  }
  assert.deepEqual(cfg,normalized,'PAIR_TASK_CONFIGURATION_MISMATCH');
  return parent(cfg);
}
function inputsUnchanged(input,before){
  assert.deepEqual(identity(read(input.config.rawJs,before.inputs.rawJs.bytes)),before.inputs.rawJs,'PAIR_TASK_RAW_CHANGED');
  assert.deepEqual(identity(read(input.config.wasm,before.inputs.wasm.bytes)),before.inputs.wasm,'PAIR_TASK_WASM_CHANGED');
}
const projection=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['schema','status','written','writeAuthorized','derivation'].includes(key)));
function wrapped(error,invoked){
  const flags=value=>value&&typeof value==='object'?{js:typeof value.js==='boolean'?value.js:null,receipt:typeof value.receipt==='boolean'?value.receipt:null}:null;
  const reasons=['PAIR_TASK_PATH_INVALID','PAIR_TASK_FILE_INVALID','PAIR_TASK_FILE_CHANGED','PAIR_TASK_PARENT_MISMATCH','PAIR_TASK_PARENT_INVALID',
    'PAIR_TASK_INPUT_INVALID','PAIR_TASK_PATH_COLLISION','PAIR_TASK_CHECK_INVALID','PAIR_TASK_PIN_INVALID','PAIR_TASK_CONFIGURATION_MISMATCH',
    'PAIR_TASK_OUTPUT_EXISTS','PAIR_TASK_RETURN_MISMATCH','PAIR_TASK_RECEIPT_MISMATCH','PAIR_TASK_JS_MISMATCH'];
  const reason=reasons.includes(error?.pairReason)?error.pairReason:
    /^PAIR_PREPARE_[A-Z_]{1,80}$/.test(error?.reason||'')?error.reason:'PAIR_TASK_VERIFICATION_REJECTED';
  const effects=['NONE','PARTIAL_OUTPUT_POSSIBLE','UNKNOWN_UNTIL_OUTPUTS_INSPECTED'];
  return Object.assign(Error('TASK_PAIR_PREPARATION_FAILED'),{code:'TASK_PAIR_PREPARATION_FAILED',reason,
    created:flags(error?.created),attempted:flags(error?.attempted),
    possibleSideEffects:effects.includes(error?.possibleSideEffects)?error.possibleSideEffects:invoked?'PARTIAL_OUTPUT_POSSIBLE':'NONE'});
}

export function preparePairTask(file,{readPair=readConfig,checkPair=checkOfficialPairPreparation}={}){
  try{
    const input=readPair(file),before=checkPair(file),outputDirectory=checkInput(input,before);
    need(norm(input.file)===norm(path.resolve(file)),'PAIR_TASK_INPUT_INVALID');
    absent(input.config.outputJs);absent(input.config.receipt);
    return {input,before,plan:{...before,outputDirectory,outputs:{js:input.config.outputJs,receipt:input.config.receipt}},profile:before.profile};
  }catch(error){throw wrapped(error,false);}
}
export function executePairTask(input,before,{executePair=executeOfficialPairPreparation}={}){
  let invoked=false;
  try{
    checkInput(input,before);absent(input.config.outputJs);absent(input.config.receipt);inputsUnchanged(input,before);
    invoked=true;const result=executePair(input.file,{writeAuthorized:true});
    need(result?.schema==='wxslim-official-pair-preparation-result-v1'&&result.status==='PREPARED_NOT_ADMITTED'&&
      result.written===true&&result.writeAuthorized===true,'PAIR_TASK_RETURN_MISMATCH');
    const receipt=read(input.config.receipt,RECEIPT_LIMIT),stored=JSON.parse(receipt.data.toString('utf8'));
    assert.deepEqual(stored,result,'PAIR_TASK_RECEIPT_MISMATCH');
    assert.deepEqual(projection(stored),projection(before),'PAIR_TASK_RECEIPT_MISMATCH');
    const js=read(input.config.outputJs,JS_LIMIT);assert.deepEqual(identity(js),before.outputJs,'PAIR_TASK_JS_MISMATCH');
    checkInput(input,before);inputsUnchanged(input,before);
    assert.deepEqual(identity(read(input.config.outputJs,JS_LIMIT)),identity(js),'PAIR_TASK_JS_MISMATCH');
    assert.deepEqual(identity(read(input.config.receipt,RECEIPT_LIMIT)),identity(receipt),'PAIR_TASK_RECEIPT_MISMATCH');
    return {status:'SUCCESS',executionMode:'bounded-files',taskId:null,artifactState:'PREPARED_NOT_ADMITTED',admission:'NOT_ADMITTED',
      profile:before.profile,packageId:null,outputs:{js:{path:input.config.outputJs,...identity(js)},receipt:{path:input.config.receipt,...identity(receipt)}},
      engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'};
  }catch(error){throw wrapped(error,invoked);}
}
