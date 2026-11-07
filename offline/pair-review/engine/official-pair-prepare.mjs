// Exact source preparation only. No directories, WASM copies, target execution,
// conversion, task controller or runtime admission.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {prepareOfficialRawPostprocess} from './official-raw-postprocess.mjs';
import {OFFICIAL_RAW_PAIR_LIMITS} from './official-raw-identities.mjs';
import {prepareOfficialC050Adapter} from '../convert/lib/official-c050-adapter.mjs';
import {OFFICIAL_C050_PROFILE,OFFICIAL_C050_CONSERVATIVE_PROFILE,OFFICIAL_C050_CAPABILITY_PROFILE,getOfficialRecipe,getRecipeIdentity} from '../convert/lib/official-engine-admission.mjs';

const SCHEMA='wxslim-official-pair-preparation-v1';
const repo=fileURLToPath(new URL('../',import.meta.url));
const sourceNames=[
  'engine/official-pair-prepare.mjs','engine/official-raw-postprocess.mjs','engine/official-captured-imports.mjs',
  'engine/official-raw-identities.mjs','convert/official-c050-conservative-recipe.json','convert/official-c050-capability-recipe.json',
  'engine/official-graphics-postprocess.mjs','engine/official-glx-library/audit-linkage.cjs',
  'engine/shader-failure/instrument-glue.cjs','engine/shader-type-return/instrument-glue.cjs',
  'engine/official-upstream-storage-tail.json','convert/official-c050-recipe.json',
  'convert/lib/official-c050-adapter.mjs','convert/lib/official-engine-admission.mjs','convert/lib/secure-random-bridge.mjs',
  'convert/lib/official-contract.mjs','convert/lib/inputs.mjs','convert/lib/render.mjs',
  'convert/assets/godot-bridge.js','convert/assets/secure-random-host.js','convert/assets/secure-random-lifecycle.js','convert/assets/render-observer.js',
];
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
function bounded(error,created={js:false,receipt:false},attempted={js:false,receipt:false}) {
  const touched=created.js||created.receipt||attempted.js||attempted.receipt;
  const code=touched?'OFFICIAL_PAIR_PREPARATION_FAILED':'OFFICIAL_PAIR_PREPARATION_REJECTED';
  const reason=/^PAIR_PREPARE_[A-Z_]+$/.test(error?.code||'')?error.code:
    /^PAIR_PREPARE_[A-Z_]+$/.test(error?.reason||'')?error.reason:
      error?.code==='EEXIST'?'PAIR_PREPARE_OUTPUT_EXISTS':'PAIR_PREPARE_REJECTED';
  return Object.assign(Error(code),{code,reason,created:{...created},attempted:{...attempted},
    possibleSideEffects:touched?'PARTIAL_OUTPUT_POSSIBLE':'NONE'});
}
function regular(file,maxBytes) {
  const before=fs.lstatSync(file);
  need(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=maxBytes,'PAIR_PREPARE_REGULAR_INPUT');
  need(norm(fs.realpathSync(file))===norm(file),'PAIR_PREPARE_LINKED_INPUT');
  const bytes=fs.readFileSync(file);
  need(bytes.length===before.size&&bytes.length<=maxBytes,'PAIR_PREPARE_INPUT_CHANGED');
  const named=fs.lstatSync(file);
  need(named.isFile()&&!named.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'PAIR_PREPARE_INPUT_CHANGED');
  for(const key of ['size','dev','ino','mtimeMs','ctimeMs'])need(before[key]===named[key],'PAIR_PREPARE_INPUT_CHANGED');
  return {bytes,identity:pin(bytes),stat:before};
}
function same(record,now){
  assert.deepEqual(now.identity,record.identity,'PAIR_PREPARE_INPUT_CHANGED');
  for(const key of ['size','dev','ino','mtimeMs','ctimeMs'])need(record.stat[key]===now.stat[key],'PAIR_PREPARE_INPUT_CHANGED');
}
function parentIdentity(file){
  const st=fs.lstatSync(file);
  need(st.isDirectory()&&!st.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'PAIR_PREPARE_REAL_PARENT_REQUIRED');
  return {dev:st.dev,ino:st.ino};
}
function absent(file){
  try{fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return;throw e;}
  need(false,'PAIR_PREPARE_OUTPUT_EXISTS');
}

export function readConfig(file){
  try{
    need(typeof file==='string'&&file.trim(),'PAIR_PREPARE_CONFIG_REQUIRED');
    const absolute=path.resolve(file),record=regular(absolute,64*1024),text=record.bytes.toString('utf8');
    need(Buffer.from(text).equals(record.bytes),'PAIR_PREPARE_CONFIG_UTF8');
    const raw=JSON.parse(text);
    need(raw&&Object.getPrototypeOf(raw)===Object.prototype,'PAIR_PREPARE_CONFIG_SCHEMA');
    assert.deepEqual(Object.keys(raw).sort(),['schema','rawJs','wasm','outputJs','receipt'].sort());
    need(raw.schema===SCHEMA,'PAIR_PREPARE_CONFIG_SCHEMA');
    const config={schema:SCHEMA};
    for(const key of ['rawJs','wasm','outputJs','receipt']){
      need(typeof raw[key]==='string'&&raw[key].trim()&&!/[\0\r\n]/.test(raw[key]),'PAIR_PREPARE_CONFIG_PATH');
      config[key]=path.resolve(path.dirname(absolute),raw[key]);
      if(process.platform==='win32'){
        const parts=config[key].slice(path.parse(config[key]).root.length).split(path.sep);
        need(parts.every(p=>!/[<>:"|?*]/.test(p)&&!/[. ]$/.test(p)&&! /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)),
          'PAIR_PREPARE_CONFIG_PATH');
      }
    }
    need(new Set([absolute,...Object.values(config).slice(1)].map(norm)).size===5,'PAIR_PREPARE_PATH_COLLISION');
    need(norm(path.dirname(config.outputJs))===norm(path.dirname(config.receipt)),'PAIR_PREPARE_SAME_PARENT_REQUIRED');
    return {file:absolute,config,configuration:record.identity,record};
  }catch(e){throw bounded(e);}
}
function prepare(file){
  const read=readConfig(file),cfg=read.config,parent=path.dirname(cfg.outputJs),parentPin=parentIdentity(parent);
  absent(cfg.outputJs);absent(cfg.receipt);
  const inputs={rawJs:regular(cfg.rawJs,OFFICIAL_RAW_PAIR_LIMITS.js),wasm:regular(cfg.wasm,OFFICIAL_RAW_PAIR_LIMITS.wasm)};
  const sources=Object.fromEntries(sourceNames.map(name=>[name,regular(path.join(repo,name),4*1024*1024)]));
  const derived=prepareOfficialRawPostprocess({js:inputs.rawJs.bytes,wasm:inputs.wasm.bytes});
  const profiles={full:OFFICIAL_C050_PROFILE,conservative:OFFICIAL_C050_CONSERVATIVE_PROFILE,'full-capability':OFFICIAL_C050_CAPABILITY_PROFILE};
  need(Object.hasOwn(profiles,derived.receipt.profile),'PAIR_PREPARE_UNKNOWN_PROFILE');
  const profile=profiles[derived.receipt.profile];
  const adapter=prepareOfficialC050Adapter({profile,js:derived.js,wasm:inputs.wasm.bytes});
  const recipe=getOfficialRecipe(profile),identity=getRecipeIdentity(profile);
  assert.deepEqual(pin(derived.js),recipe.engine.js);assert.deepEqual(inputs.wasm.identity,recipe.engine.wasm);
  const stable=()=>{
    same(read.record,regular(read.file,64*1024));
    for(const [key,value]of Object.entries(inputs))same(value,regular(cfg[key],value.identity.bytes));
    for(const [name,value]of Object.entries(sources))same(value,regular(path.join(repo,name),4*1024*1024));
    assert.deepEqual(parentIdentity(parent),parentPin,'PAIR_PREPARE_PARENT_CHANGED');
    assert.deepEqual(getRecipeIdentity(profile),identity,'PAIR_PREPARE_RECIPE_CHANGED');
  };
  stable();
  const summary={schema:'wxslim-official-pair-preparation-check-v1',status:'CHECKED_NOT_WRITTEN',profile,...identity,
    configuration:read.configuration,inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.identity])),
    outputJs:pin(derived.js),wasmCopied:false,hostAdapter:adapter.receipt,
    sources:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,v.identity])),
    admission:'NOT_ADMITTED',runtime:'NOT_RUN',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',writeAuthorized:false,written:false,
    scope:'Exact source derivation and host selection only; original build failure, runtime and production admission are not repaired or inferred. Checkpoint identity checks are not an adversarial filesystem transaction.'};
  return {cfg,summary,derived,stable};
}
export function checkOfficialPairPreparation(file){
  try{return prepare(file).summary;}catch(e){throw bounded(e);}
}
export function executeOfficialPairPreparation(file,{writeAuthorized=false}={}){
  const created={js:false,receipt:false},attempted={js:false,receipt:false};
  try{
    need(writeAuthorized===true,'PAIR_PREPARE_WRITE_REQUIRED');
    const state=prepare(file),{cfg,summary,derived,stable}=state;
    function write(file,bytes,key){
      attempted[key]=true;
      fs.writeFileSync(file,bytes,{flag:'wx',flush:true});created[key]=true;
      assert.deepEqual(regular(file,bytes.length).identity,pin(bytes),'PAIR_PREPARE_WRITE_DRIFT');
    }
    stable();absent(cfg.outputJs);absent(cfg.receipt);
    write(cfg.outputJs,derived.js,'js');
    stable();
    assert.deepEqual(regular(cfg.outputJs,derived.js.length).identity,summary.outputJs,'PAIR_PREPARE_WRITE_DRIFT');
    const receipt={...summary,schema:'wxslim-official-pair-preparation-result-v1',status:'PREPARED_NOT_ADMITTED',
      written:true,writeAuthorized:true,derivation:derived.receipt};
    write(cfg.receipt,Buffer.from(JSON.stringify(receipt,null,2)+'\n'),'receipt');
    stable();
    assert.deepEqual(regular(cfg.outputJs,derived.js.length).identity,summary.outputJs,'PAIR_PREPARE_WRITE_DRIFT');
    return receipt;
  }catch(e){throw bounded(e,created,attempted);}
}
