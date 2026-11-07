// Candidate form/transport checks only. No editor, task output, converter or game.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {normalizeConfig} from '../../convert/official.mjs';
import {checkProjectUsage} from '../../convert/lib/official-engine-admission.mjs';
import {buildOfficialConvertRequestDraft,prepareOfficialFormDraft,OFFICIAL_FORM_MODULES} from './official-convert-request-form.mjs';

function makePck(){
  const name=Buffer.from('project.binary'),data=Buffer.from('structural-only PCK body');
  const offset=113,end=offset+data.length,pad=Math.ceil(name.length/4)*4,b=Buffer.alloc(end+4+40+pad);
  b.write('GDPC');b.writeUInt32LE(4,4);[4,7,2].forEach((v,i)=>b.writeUInt32LE(v,8+4*i));
  b.writeBigUInt64LE(113n,24);b.writeBigUInt64LE(BigInt(end),32);b.writeUInt32LE(1,end);
  let at=end+4;b.writeUInt32LE(pad,at);at+=4;name.copy(b,at);at+=pad;
  b.writeBigUInt64LE(0n,at);b.writeBigUInt64LE(BigInt(data.length),at+8);
  createHash('md5').update(data).digest().copy(b,at+16);data.copy(b,offset);return b;
}
function fixture(){
  const base=path.resolve('MEMORY_ONLY_PROFILE_FORM'),buffer=makePck(),inventory=inspectPck(buffer),pck=path.join(base,'game.pck');
  return {base,payload:{js:path.join(base,'engine.js'),wasm:path.join(base,'engine.wasm'),pck,transformer:path.join(base,'converter.exe'),interfaces:path.join(base,'interfaces.js'),output:path.join(base,'output'),renderMode:'webgl',name:'profile test',locale:'en',orientation:'portrait',engineProfile:'conservative-official-c050-dev',removedModules:Object.fromEntries(OFFICIAL_FORM_MODULES.map(m=>[m,'unused']))},
    snapshot:{sourcePath:pck,pin:{bytes:inventory.bytes,sha256:inventory.sha256},inventory,buffer},files:{configFile:path.join(base,'config.json'),requestFile:path.join(base,'request.json')}};
}
const build=f=>buildOfficialConvertRequestDraft(f.payload,f.files,f.snapshot);

test('explicit conservative profile binds declarations to real PCK bytes and reuses common admission',()=>{
  const f=fixture(),d=build(f),n=normalizeConfig(d.config,f.base);
  assert.equal(n.engineProfile,f.payload.engineProfile);assert.deepEqual(d.config.projectUsage.pck,f.snapshot.pin);
  assert.deepEqual(checkProjectUsage(n.projectUsage,n.engineProfile,f.snapshot.pin),d.config.projectUsage);
  assert.equal(d.request.purpose,'development-test');assert.equal(d.request.action,'official-convert');
  assert(!Object.hasOwn(d,'eligible'));assert(!Object.hasOwn(d,'executionAuthorized'));assert(!Object.hasOwn(d.config,'removedModules'));
  assert.throws(()=>checkProjectUsage(n.projectUsage,n.engineProfile,{...f.snapshot.pin,sha256:'0'.repeat(64)}));
});

test('each removed module requires an explicit unused declaration, never unknown/used or bulk truth',()=>{
  for(const key of OFFICIAL_FORM_MODULES)for(const value of ['unknown','used',true,false,null,undefined]){
    const f=fixture();f.payload.removedModules[key]=value;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_MODULE_NOT_CONFIRMED'});
  }
  for(const mutate of [m=>delete m.enet,m=>m.extra='unused']){const f=fixture();mutate(f.payload.removedModules);assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_USAGE_FIELDS'});}
});

test('PCK path, actual content, pin and inspected inventory must agree; caller pin is not authoritative',()=>{
  for(const mutate of [f=>f.snapshot.sourcePath=path.join(f.base,'other.pck'),f=>f.snapshot.pin.sha256='a'.repeat(64),f=>f.snapshot.pin.bytes++,f=>f.snapshot.inventory.entries[0].path='invented']){
    const f=fixture();mutate(f);assert.throws(()=>build(f),e=>['LOCAL_OFFICIAL_FORM_PCK_SNAPSHOT','LOCAL_OFFICIAL_FORM_PCK_CHANGED'].includes(e.code));
  }
  const f=fixture();f.snapshot.buffer[113]^=1;assert.throws(()=>build(f),{code:'PCK_MD5'});
  const absent=fixture();assert.throws(()=>buildOfficialConvertRequestDraft(absent.payload,absent.files),{code:'LOCAL_OFFICIAL_FORM_PCK_SNAPSHOT'});
});

test('explicit full profile omits projectUsage and never reads a PCK through the conservative path',()=>{
  const f=fixture();f.payload.engineProfile='full-official-c050-dev';f.payload.removedModules=null;
  const d=prepareOfficialFormDraft(f.payload,f.files,{readInventory(){assert.fail('full must defer input read to common plan');}});
  assert.equal(d.config.engineProfile,'full-official-c050-dev');assert(!Object.hasOwn(d.config,'projectUsage'));
  assert.equal(normalizeConfig(d.config,f.base).engineProfile,'full-official-c050-dev');
  for(const value of [{},fixture().payload.removedModules,undefined]){f.payload.removedModules=value;assert.throws(()=>prepareOfficialFormDraft(f.payload,f.files),{code:'LOCAL_OFFICIAL_FORM_FULL_USAGE'});}
});

test('old saved full form remains deterministic; no caller can inject projectUsage or supported-use',()=>{
  const f=fixture();delete f.payload.engineProfile;delete f.payload.removedModules;
  const before=structuredClone(f.payload),d=prepareOfficialFormDraft(f.payload,f.files);
  assert.equal(d.config.engineProfile,'full-official-c050-dev');assert.deepEqual(f.payload,before);
  for(const key of ['projectUsage','supportedUse','write','status','appid','confirmed']){const p={...f.payload,[key]:true};assert.throws(()=>prepareOfficialFormDraft(p,f.files),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});}
});

test('adapter reader called once only after payload validation; errors stop without drafts',()=>{
  const f=fixture();let reads=0;
  const d=prepareOfficialFormDraft(f.payload,f.files,{readInventory:p=>{reads++;assert.deepEqual(p,{sourcePath:f.payload.pck});return f.snapshot;}});
  assert.equal(reads,1);assert.equal(d.config.projectUsage.pck.sha256,f.snapshot.pin.sha256);
  for(const bad of [{...f.payload,engineProfile:'full'},{...f.payload,removedModules:{...f.payload.removedModules,enet:'unknown'}},{...f.payload,pck:'relative.pck'}]){
    assert.throws(()=>prepareOfficialFormDraft(bad,f.files,{readInventory:()=>assert.fail('must reject before reading')}));
  }
  const error=Object.freeze({code:'MODEL_READ_FAILED'});assert.throws(()=>prepareOfficialFormDraft(f.payload,f.files,{readInventory:()=>{throw error;}}),e=>e===error);
  assert.throws(()=>prepareOfficialFormDraft(f.payload,f.files),{code:'LOCAL_OFFICIAL_FORM_PCK_READER'});
});

test('draft cannot mutate or alias caller declarations and never carries source buffer',()=>{
  const f=fixture(),before=structuredClone(f.payload),bytes=Buffer.from(f.snapshot.buffer),a=build(f),b=build(f);
  assert.deepEqual(a,b);assert.deepEqual(f.payload,before);assert.deepEqual(f.snapshot.buffer,bytes);
  assert.notEqual(a.config.projectUsage.removedModules,f.payload.removedModules);
  assert(!a.configText.includes('structural-only'));assert(!a.configText.includes('inventory'));
});
