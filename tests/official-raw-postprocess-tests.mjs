import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {prepareOfficialRawPostprocess,OFFICIAL_FULL_RAW_PAIR} from '../engine/official-raw-postprocess.mjs';
const dir=process.env.OFFICIAL_CAPTURE_RAW_DIR;
assert(dir,'Explicit official raw capture directory required; no fixture fallback or skipped real-input check');
const js=fs.readFileSync(path.join(dir,'godot.raw.js')),wasm=fs.readFileSync(path.join(dir,'godot.wasm'));
let prepared;

test('isolated icon no-op preserves void ABI and avoids DOM, Blob, URL and heap access',()=>{
 const result=prepareOfficialRawPostprocess({js,wasm});
 const text='function _godot_js_display_window_icon_set(p_ptr,p_len){}';
 assert.equal(result.js.toString().split(text).length,2);
 const sandbox={};
 for(const name of ['document','Blob','URL','GodotRuntime','GodotDisplay','HEAPU8'])
  Object.defineProperty(sandbox,name,{get(){throw Error('UNEXPECTED_BROWSER_ACCESS:'+name);}});
 for(const args of ['0,0','7,32'])assert.equal(new vm.Script(text+';_godot_js_display_window_icon_set('+args+');').runInNewContext(sandbox,{timeout:1000}),undefined);
 const edit=result.receipt.edits.find(e=>e.rule==='disable-window-icon');
 assert.equal(edit.removed.bytes,555);assert.equal(edit.inserted.bytes,57);
});

test('only the isolated title setter is executed: old write fails, new void ABI does not touch DOM',()=>{
 const result=prepareOfficialRawPostprocess({js,wasm});
 const before=js.toString().match(/function _godot_js_display_window_title_set\(p_data\)\{[^}]*\}/g);
 const after=result.js.toString().match(/function _godot_js_display_window_title_set\(p_data\)\{[^}]*\}/g);
 assert.equal(before.length,1);assert.equal(after.length,1);
 assert.equal(after[0],'function _godot_js_display_window_title_set(p_data){}');
 let decoded=0;
 const document={};Object.defineProperty(document,'title',{value:'unchanged',writable:false,configurable:false});
 const sandbox={document,GodotRuntime:{parseString(){decoded++;return 'new title';}}};
 const invoke=text=>new vm.Script('"use strict";'+text+';_godot_js_display_window_title_set(7);').runInNewContext(sandbox,{timeout:1000});
 assert.throws(()=>invoke(before[0]),/read only/);assert.equal(decoded,1);
 decoded=0;assert.equal(invoke(after[0]),undefined);assert.equal(decoded,0);assert.equal(document.title,'unchanged');
 Object.defineProperty(sandbox,'document',{get(){throw Error('UNEXPECTED_DOM_ACCESS');}});
 assert.equal(invoke(after[0]),undefined);
 assert.equal(result.receipt.edits.find(e=>e.rule==='disable-window-title').removed.bytes,100);
 assert.equal(result.receipt.edits.find(e=>e.rule==='disable-window-title').inserted.bytes,53);
});
test('exact real c050 pair derives only seven reviewed rules in memory',()=>{
 prepared=prepareOfficialRawPostprocess({js,wasm});
 const r=prepared.receipt;
 assert.equal(r.edits.length,7);assert.equal(r.return0,true);assert.equal(r.allOtherJsBytesPreserved,true);
 assert.equal(r.capturedImports.status,'SOURCE_VALUE_CAPTURE_PROVEN');assert.equal(r.capturedImports.captures.length,7);
 assert.equal(r.wasmChanged,false);assert.equal(r.admission,'NOT_ADMITTED');assert.equal(r.completePostprocessor,false);
 assert.equal(r.written,false);assert.equal(r.targetExecuted,false);assert.equal(r.productionRegistered,false);
 assert.deepEqual(r.input,OFFICIAL_FULL_RAW_PAIR.js);assert.deepEqual(r.wasm,OFFICIAL_FULL_RAW_PAIR.wasm);
 assert.deepEqual(js,fs.readFileSync(path.join(dir,'godot.raw.js')));assert.deepEqual(wasm,fs.readFileSync(path.join(dir,'godot.wasm')));
});
test('drift, truncation, mixed pair, repeated processing, and caller pins reject',()=>{
 const changed=Buffer.from(js);changed[0]^=1;
 for(const input of [changed,js.subarray(0,js.length-1),prepared.js])assert.throws(()=>prepareOfficialRawPostprocess({js:input,wasm}),/RAW_JS_PIN/);
 const changedWasm=Buffer.from(wasm);changedWasm[8]^=1;
 assert.throws(()=>prepareOfficialRawPostprocess({js,wasm:changedWasm}),/RAW_WASM_PIN/);
 assert.throws(()=>prepareOfficialRawPostprocess({js,wasm,pin:OFFICIAL_FULL_RAW_PAIR}),/EXACT_KEYS/);
 assert.throws(()=>prepareOfficialRawPostprocess({js,wasm},{}),/ONE_ARGUMENT/);
});
test('native i64, imports and remaining host-dependent sites are not rewritten',()=>{
 const before=js.toString(),after=prepared.js.toString();
 for(const text of ['performance.now()','new WebAssembly.RuntimeError(what)','BigInt(stat.ino)','wasmTable.get(ptr)']){
  assert(before.includes(text),text);assert.equal(after.split(text).length,before.split(text).length,text);
 }
 assert(after.includes('function evalCheckWxContextGlobalIdAvailable(){return 0}'));
 assert(!after.includes('fetchAndIncId===\"function\"){return 1}return 0}'));
 assert(prepared.receipt.edits.some(e=>e.inputByteOffset!==e.outputByteOffset));
});
test('caller require-cache mutations cannot replace authenticated helper bytes',()=>{
 const require=createRequire(import.meta.url),helper=require('../engine/shader-failure/instrument-glue.cjs');
 const original={...helper};
 try{
  helper.MARKER='poison';helper.ANCHOR='function poison(){}';
  helper.instrumentGlue=()=>{throw Error('Shared cache must never execute');};
  const result=prepareOfficialRawPostprocess({js,wasm});
  assert(result.js.equals(prepared.js));assert.deepEqual(result.receipt.output,prepared.receipt.output);
 }finally{Object.assign(helper,original);}
});
test('accessor input is rejected without invoking getters',()=>{
 let calls=0;const options={wasm};Object.defineProperty(options,'js',{enumerable:true,get(){calls++;return js;}});
 assert.throws(()=>prepareOfficialRawPostprocess(options),/DATA_INPUTS/);assert.equal(calls,0);
});
