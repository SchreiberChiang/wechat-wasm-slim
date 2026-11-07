// Read existing raw files; negative fixtures are memory-only and never execute.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {proposeCustomRawHost} from '../engine/custom-host-bindings.mjs';
import {prepareOfficialRawPostprocess} from '../engine/official-raw-postprocess.mjs';
import {prepareOfficialC050Adapter} from '../convert/lib/official-c050-adapter.mjs';
const dir=process.env.OFFICIAL_CAPTURE_RAW_DIR;
assert(dir,'Explicit existing full raw input directory required; no successful model fallback');
const js=fs.readFileSync(path.join(dir,'godot.raw.js')),wasm=fs.readFileSync(path.join(dir,'godot.wasm'));
const source=js.toString('utf8'),input={js,wasm},proposed=proposeCustomRawHost(input),host=proposed.receipt.hostProposal;
const hash=b=>createHash('sha256').update(b).digest('hex');
const changed=(before,after)=>{assert.equal(source.split(before).length,2,'unique mutation');return {js:Buffer.from(source.replace(before,after)),wasm};};
const reject=(input,pattern)=>assert.throws(()=>proposeCustomRawHost(input),pattern);

test('real pair imports, native ABI and host bodies match without claiming runtime or source provenance',()=>{
 const fixed=prepareOfficialRawPostprocess(input);assert(proposed.js.equals(fixed.js));
 const fixedHost=prepareOfficialC050Adapter({profile:'full-official-c050-dev',js:fixed.js,wasm});
 assert.equal(host.status,'HOST_SOURCE_PROPOSED_NOT_ADMITTED');
 assert.equal(host.allImportBindings.length,775);
 assert.equal(host.allImportBindings.filter(x=>x.proof==='CAPTURE_BEFORE_NATIVE_REBIND').length,7);
 assert.equal(host.nativeDetails.filter(x=>x.requiredByFixedContract).length,26);
 assert.equal(Object.keys(host.nativeMapping).length,28);
 assert.deepEqual(host.entropy.nativeBufferSignature,{params:[127],results:[127]});
 assert.equal(host.bridge.sha256,hash(proposed.bridge));
 assert.equal(host.bridge.sha256,host.sourceContract.derived.sha256);
 assert(proposed.bridge.equals(fixedHost.bridge)); // Fixed-pair admission remains independently enforced.
 assert.equal(host.nativeSemantics,'NOT_PROVEN_BY_ABI_OR_STRIPPED_SYMBOL_MAP');
 assert.equal(host.sourceProvenance,'REQUIRES_COMPLETED_CUSTOM_RAW_TASK_RECHECK');
 for(const field of ['hostInstalled','converterAccepted','targetExecuted','wasmInstantiated','written'])assert.equal(host[field],false);
 assert.equal(host.admission,'NOT_ADMITTED');assert.equal(host.runtime,'NOT_RUN');
});

// Rename only one export's UTF-8 bytes inside section 7; same length, no code changes.
function renamedExport(bytes,before,after){
 assert.equal(Buffer.byteLength(before),Buffer.byteLength(after));const out=Buffer.from(bytes);let p=8,count=0;
 const u32=()=>{let n=0,s=0,b;do{b=out[p++];n+=(b&127)*2**s;s+=7;}while(b&128);return n;};
 while(p<out.length){const id=out[p++],size=u32(),end=p+size;if(id===7){const entries=u32();for(let i=0;i<entries;i++){
  const size=u32(),start=p;p+=size;const name=out.subarray(start,p).toString('utf8');p++;u32();
  if(name===before){out.write(after,start,size,'utf8');count++;}
 }}p=end;}assert.equal(count,1);return out;
}
test('native mapping follows the actual paired export rather than a fixed mangled name; old admission still rejects it',()=>{
 const old=host.nativeMapping._glxUpdateContextId,next='wx';assert.notEqual(old,next);
 assert(!Object.values(host.nativeMapping).includes(next));
 const custom={...changed('wasmExports["'+old+'"]','wasmExports["'+next+'"]'),wasm:renamedExport(wasm,old,next)};
 const result=proposeCustomRawHost(custom);assert.equal(result.receipt.hostProposal.nativeMapping._glxUpdateContextId,next);
 assert.equal(result.receipt.hostProposal.admission,'NOT_ADMITTED');
 assert.throws(()=>prepareOfficialRawPostprocess(custom),/OFFICIAL_POSTPROCESS_RAW_JS_PIN/);
});

test('native ABI mismatch, early return and unrelated calls in native assignment owner reject',()=>{
 reject(changed('Module["_free"]=_free=wasmExports["'+host.nativeMapping._free+'"]',
  'Module["_free"]=_free=wasmExports["'+host.nativeMapping._malloc+'"]'),/CUSTOM_HOST_NATIVE_ABI/);
 for(const prefix of ['return;','unknown();'])reject(changed('function assignWasmExports(wasmExports){',
  'function assignWasmExports(wasmExports){'+prefix),/UNREGISTERED_POSTPROCESS_CAPTURE|CUSTOM_HOST_NATIVE_STATEMENT/);
});

test('matched helpers do not excuse later reassignments, member replacement or missing public binding',()=>{
 for(const extra of ['GodotFS={};','GodotFS.init=function(){};','callMain=other;'])
  reject(changed('Module["initFS"]=GodotFS.init','Module["initFS"]=GodotFS.init;'+extra),/CUSTOM_HOST_(OBJECT_REASSIGNED|PUBLIC_HELPER_MUTATED|FUNCTION_REASSIGNED)/);
 reject(changed('Module["initFS"]=GodotFS.init','Module["initFS"]=GodotFS.copy_to_fs'),/CUSTOM_HOST_PUBLIC_VALUE/);
});

test('entropy failure handling is exact source, not accepted on name and signature alone',()=>{
 reject(changed('return 0}catch(_){if(view){','return 0}catch(_){return 0;if(view){'),/CUSTOM_HOST_FUNCTION_BODY/);
 reject(changed('Module["__WXSLIM_UPSTREAM_WXMEMFS__"]="'+host.storage.marker+'"',
  'Module["__WXSLIM_UPSTREAM_WXMEMFS__"]="'+'0'.repeat(64)+'"'),/CUSTOM_HOST_PUBLIC_VALUE/);
});

test('all imports must resolve; an unrelated unresolved import cannot hide behind the seven capture proofs',()=>{
 // This routine is outside the seven postprocessing targets and the texture captures.
 const match=source.match(/([A-Za-z_$][A-Za-z0-9_$]*):__abort_js(?=,|\})/);assert(match);
 reject(changed(match[0],match[1]+':_unknown_missing_import'),/CUSTOM_HOST_UNRESOLVED_IMPORT/);
});

test('no caller overrides, repeated preparation or writes; input file identities stay unchanged',()=>{
 assert.throws(()=>proposeCustomRawHost({...input,allowUnknown:true}));
 assert.throws(()=>proposeCustomRawHost(input,{}));
 let getters=0;assert.throws(()=>proposeCustomRawHost({wasm,get js(){getters++;return js;}}));assert.equal(getters,0);
 reject({js:proposed.js,wasm},/GRAPHICS_ALREADY_DERIVED/);
 assert(fs.readFileSync(path.join(dir,'godot.raw.js')).equals(js));assert(fs.readFileSync(path.join(dir,'godot.wasm')).equals(wasm));
});
