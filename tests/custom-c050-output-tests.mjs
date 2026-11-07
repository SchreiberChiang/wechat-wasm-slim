// Existing raw bytes and in-memory converter-shaped models only. No converter,
// WASM instantiation or successful custom-build fixture is manufactured here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sha} from '../convert/lib/inputs.mjs';
import {proposeCustomRawHost} from '../engine/custom-host-bindings.mjs';
import {inspectCustomC050OutputProposal,auditCompletedCustomC050Output,prepareOfficialC050Adapter} from '../convert/lib/official-c050-adapter.mjs';
import {renderStorageBridge} from '../convert/lib/storage-adapter.mjs';
import {modelOfficialC050Framework,originalCallMain,convertedCallMain} from './official-c050-framework-model.mjs';
const dir=process.env.OFFICIAL_CAPTURE_RAW_DIR;
assert(dir,'Explicit existing raw files required; no substitute success fixture');
const rawJs=fs.readFileSync(path.join(dir,'godot.raw.js')),wasm=fs.readFileSync(path.join(dir,'godot.wasm'));
const original={js:sha(rawJs),wasm:sha(wasm)},proposal=proposeCustomRawHost({js:rawJs,wasm});
const bridge=renderStorageBridge(proposal.bridge.toString('utf8'),'webgl','zh_CN');
const framework=modelOfficialC050Framework({js:proposal.js,bridge});
const inspect=(overrides={})=>inspectCustomC050OutputProposal({rawJs,wasm,framework,bridge,...overrides});
const mutate=(before,after)=>{const text=framework.toString();assert.equal(text.split(before).length,2);return Buffer.from(text.replace(before,after));};

test('all dynamic mappings and critical source survive the converter model without runtime or build admission',()=>{
 const r=inspect();assert.equal(r.status,'SOURCE_MATCH_NOT_AUTHENTICATED');
 assert.deepEqual(r.importNames,{title:'lf',icon:'ie'});assert.deepEqual(r.nativeMapping,proposal.receipt.hostProposal.nativeMapping);
 for(const k of ['sourceBuildReaudited','converterAccepted','targetExecuted'])assert.equal(r[k],false);
 assert.equal(r.admission,'NOT_ADMITTED');assert.equal(r.runtime,'NOT_RUN');
 assert.equal(sha(rawJs),original.js);assert.equal(sha(wasm),original.wasm);
 assert.throws(()=>prepareOfficialC050Adapter({profile:'custom-official-c050-dev',js:proposal.js,wasm}),/EXPLICIT_DEVELOPMENT_PROFILE/);
});

// Change two same-length names only in the actual binary import section. This
// is a structural fixture, not a linked build or a test of native semantics.
function renameImports(bytes,changes){
 const out=Buffer.from(bytes);let p=8,changed=0;
 const u32=()=>{let n=0,s=0,b;do{b=out[p++];n+=(b&127)*2**s;s+=7;}while(b&128);return n;};
 const str=()=>{const len=u32(),at=p;p+=len;return {at,len,value:out.subarray(at,p).toString('utf8')};};
 while(p<out.length){const section=out[p++],size=u32(),end=p+size;
  if(section===2){const count=u32();for(let i=0;i<count;i++){
   const module=str(),name=str(),kind=out[p++];assert.equal(module.value,'a');assert.equal(kind,0);u32();
   if(Object.hasOwn(changes,name.value)){assert.equal(Buffer.byteLength(changes[name.value]),name.len);out.write(changes[name.value],name.at,name.len,'utf8');changed++;}
  }}p=end;
 }assert.equal(changed,Object.keys(changes).length);return out;
}

test('paired import renaming works without falling back to fixed full or conservative keys',()=>{
 let text=rawJs.toString();
 for(const [from,to,name]of [['lf','Qx','_godot_js_display_window_title_set'],['ie','Qy','_godot_js_display_window_icon_set']]){
  assert.equal(text.split(from+':'+name).length,2);assert(!text.includes(to+':'));
  text=text.replace(from+':'+name,to+':'+name);
 }
 const raw=Buffer.from(text),binary=renameImports(wasm,{lf:'Qx',ie:'Qy'}),next=proposeCustomRawHost({js:raw,wasm:binary});
 const output=modelOfficialC050Framework({js:next.js,bridge});
 const r=inspect({rawJs:raw,wasm:binary,framework:output});assert.deepEqual(r.importNames,{title:'Qx',icon:'Qy'});
 assert.throws(()=>inspect({rawJs:raw,framework:output})); // Unpaired import names rejected.
 assert.throws(()=>prepareOfficialC050Adapter({profile:'full-official-c050-dev',js:next.js,wasm:binary}));
});

test('output changes to native export owner, helper body, public binding and later helper writes reject',()=>{
 for(const [from,to]of [
  ['function assignWasmExports(wasmExports){','function assignWasmExports(wasmExports){return;'],
  ['Module["initFS"]=GodotFS.init','Module["initFS"]=GodotFS.copy_to_fs'],
  ['Module["initFS"]=GodotFS.init','Module["initFS"]=GodotFS.init;GodotFS.init=function(){};'],
 ]){
  assert.throws(()=>inspect({framework:mutate(from,to)}));
 }
 const changed=framework.toString().replace('var GodotFS={','var GodotFS={changed:true,');
 assert.notEqual(changed,framework.toString());assert.throws(()=>inspect({framework:Buffer.from(changed)}));
});

test('host bridge mismatch and converter early return reject; source reports cannot stand in for completed preparation',async()=>{
 assert.throws(()=>inspect({bridge:bridge+'\n// changed'}),/BRIDGE_NOT_FIXED_DERIVATION/);
 const output=framework.toString().replace('return commFrameWork.ready;','return null;');assert.notEqual(output,framework.toString());
 assert.throws(()=>inspect({framework:Buffer.from(output)}),/READY_RETURN/);
 await assert.rejects(()=>auditCompletedCustomC050Output({preparationConfig:'MISSING',project:'MISSING',sourceCheck:proposal.receipt}),/AUDIT_KEYS/);
 await assert.rejects(()=>auditCompletedCustomC050Output({preparationConfig:'MISSING',project:'MISSING'}),e=>e.code==='TASK_PAIR_PREPARATION_FAILED');
});

test('actual converter main callback is required exactly, not ignored or replaced by another callback',()=>{
 for(const next of [originalCallMain,convertedCallMain.replace('Module.calledMainCb();','Module.otherCallback();')]){
  assert.throws(()=>inspect({framework:mutate(convertedCallMain,next)}),e=>e.code==='C050_OUTPUT_ENGINE_RULE_OR_RANDOM_BINDING_CHANGED'&&e.field==='host_callMain');
 }
});
