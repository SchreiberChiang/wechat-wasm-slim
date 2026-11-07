// AST-extracted real candidate object; minimal modeled keyboard, native callbacks,
// and allocator only. No factory, WASM, WeChat, device, network, or build execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {prepareOfficialImeSessionSource,extractImeSessionObject,imeSessionIdentity,IME_SESSION_PINS,IME_SESSION_FILE} from '../engine/official-ime-session-source.mjs';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
const file=process.env.WXSLIM_IME_SESSION_SOURCE;
assert(file&&path.isAbsolute(file),'EXPLICIT_ABSOLUTE_IME_SESSION_SOURCE_REQUIRED');
assert.equal(fs.realpathSync(file).toLowerCase(),path.resolve(file).toLowerCase(),'SOURCE_LINK_REJECTED');
const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());
const source=fs.readFileSync(file),patch=fs.readFileSync(new URL('../engine/official-ime-session-source.patch',import.meta.url));
assert.deepEqual(imeSessionIdentity(source),IME_SESSION_PINS.input);
const derived=prepareOfficialImeSessionSource(source,patch);
const candidate=extractImeSessionObject(derived.toString()).text,old=extractImeSessionObject(source.toString()).text;
function fixture(block=candidate,options={}) {
  const allocations=new Set(),listeners={input:new Set(),confirm:new Set(),complete:new Set()};
  const state={now:1000,onIme:null,onKey:null,onRegister:null,onHide:null,failAt:null,afterAdd:false,offFailures:new Map(),freeError:null,allocError:null,
    show:0,hide:0,keys:0,events:0,frees:0,allocs:0,options:[],registered:{},calls:[]};
  Object.assign(state,options);const sentinel=Object.freeze({kind:'MODEL_FAILURE'});
  function register(kind,cb){state.calls.push('on_'+kind);if(state.failAt===kind&&!state.afterAdd)throw sentinel;listeners[kind].add(cb);state.registered[kind]=cb;state.onRegister?.(kind,cb);if(state.failAt===kind)throw sentinel;}
  function off(kind,cb){state.calls.push('off_'+kind);if(state.offFailures.has(kind))throw state.offFailures.get(kind);listeners[kind].delete(cb);}
  const box={Date:{now:()=>state.now},GodotRuntime:{
    allocString(value){assert.equal(typeof value,'string');if(state.allocError)throw state.allocError;const ptr=++state.allocs;allocations.add(ptr);return ptr;},
    free(ptr){state.frees++;assert(allocations.delete(ptr));if(state.freeError)throw state.freeError;},
    stringToHeap(value,pointer,limit){assert.equal(typeof value,'string');assert([100,200].includes(pointer));assert.equal(limit,32);},
  },wx:{showKeyboard(opts){state.show++;state.options.push(opts);if(state.failAt==='show')throw sentinel;if(state.failAt==='syncFail')opts.fail({errMsg:'private platform payload'});},onKeyboardInput:cb=>register('input',cb),onKeyboardConfirm:cb=>register('confirm',cb)},
  __globalAdapter:{onKeyboardComplete:cb=>register('complete',cb),offKeyboardInput:cb=>off('input',cb),offKeyboardConfirm:cb=>off('confirm',cb),offKeyboardComplete:cb=>off('complete',cb),hideKeyboard(){state.hide++;state.calls.push('hide');state.onHide?.();if(state.failAt==='hide')throw sentinel;}}};
  const context=vm.createContext(box,{codeGeneration:{strings:false,wasm:false}});
  new vm.Script('var GodotIME=('+block+');').runInContext(context,{timeout:1000});
  const api=box.GodotIME;
  function init(){api.init((type,ptr)=>{assert(allocations.has(ptr));state.events++;state.onIme?.(type);},(...args)=>{state.keys++;state.onKey?.(...args);},100,200);}
  function capture(fn){try{fn();return {threw:false};}catch(value){return {threw:true,value};}}
  function counts(){return Object.values(listeners).map(s=>s.size);}
  init();return {api,state,sentinel,allocations,listeners,counts,init,capture};
}
test('strict fixed buffers; replay/reverse; only WeChat object changes; DOM and ABI exact',()=>{
  assert.deepEqual(imeSessionIdentity(derived),IME_SESSION_PINS.output);
  assert.equal(extractImeSessionObject(derived.toString(),'$GodotIME').text,extractImeSessionObject(source.toString(),'$GodotIME').text);
  const reverse=patch.toString().split('\n').map(l=>{const m=/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(l);if(m)return `@@ -${m[3]},${m[4]} +${m[1]},${m[2]} @@`;if(l.startsWith('--- ')||l.startsWith('+++ '))return l;return l[0]==='+'?'-'+l.slice(1):l[0]==='-'?'+'+l.slice(1):l;}).join('\n');
  assert.equal(replayUnifiedPatch(Buffer.from(reverse),()=>derived).get(IME_SESSION_FILE).text,source.toString());
  assert.throws(()=>replayUnifiedPatch(patch,()=>derived));
  assert.throws(()=>prepareOfficialImeSessionSource(derived,patch));
  assert.throws(()=>prepareOfficialImeSessionSource(source,Buffer.concat([patch,Buffer.from('\n')])));
  new vm.Script(derived.toString());
});
test('normal input, confirm fallback, complete and cooldown preserved',()=>{
  const f=fixture();f.api.initialText='a';f.api.ime.show();assert(f.api.active);f.state.registered.input({value:'ab'});assert.equal(f.api.initialText,'ab');
  f.state.registered.confirm({});assert.equal(f.api.active,false);assert.equal(f.api.initialText,'ab');assert.deepEqual(f.counts(),[0,0,0]);
  f.api.ime.show();assert.equal(f.state.show,1);f.state.now+=101;f.api.ime.show();f.state.registered.complete({value:'c'});assert.equal(f.api.initialText,'c');
  f.api.clear();assert.equal(f.api.ime,null);assert.equal(f.allocations.size,0);
});
for(const phase of ['start','input','confirm','complete'])for(const thrown of [Object.freeze({kind:'NATIVE_THROW'}),17,undefined])test('callback release preserves '+phase+' throw '+typeof thrown,()=>{
  const f=fixture();if(phase!=='start')f.api.ime.show();f.state.onIme=type=>{if(type===(phase==='start'?0:2))throw thrown;};
  const result=f.capture(()=>phase==='start'?f.api.ime.show():f.state.registered[phase]({value:'x'}));assert(result.threw);assert.equal(result.value,thrown);assert.equal(f.allocations.size,0);
  if(phase==='start'){assert.equal(f.api.active,false);assert.deepEqual(f.counts(),[0,0,0]);}
});
test('allocator and secondary release failures remain visible; native throw wins',()=>{
  const f=fixture(),allocError={kind:'ALLOC'};f.state.allocError=allocError;assert.equal(f.capture(()=>f.api.ime.show()).value,allocError);assert.equal(f.allocations.size,0);assert.equal(f.api.active,false);
  f.state.allocError=null;f.state.now+=101;const release={kind:'FREE'},native={kind:'NATIVE'};f.state.freeError=release;f.state.onIme=()=>{throw native;};assert.equal(f.capture(()=>f.api.ime.show()).value,native);assert.equal(f.api.ime.releaseError,release);
  f.state.now+=101;f.state.onIme=null;assert.equal(f.capture(()=>f.api.ime.show()).value,release);
});
for(const failAt of ['show','input','confirm','complete'])for(const afterAdd of [false,true])test('show rollback '+failAt+' afterAdd='+afterAdd,()=>{
  const f=fixture(candidate,{failAt,afterAdd});const r=f.capture(()=>f.api.ime.show());assert.equal(r.value,f.sentinel);assert.equal(f.api.active,false);assert.equal(f.api.ime.showError,f.sentinel);assert.deepEqual(f.counts(),[0,0,0]);assert.equal(f.state.hide,1);
  f.state.failAt=null;f.state.now+=101;f.api.ime.show();assert.equal(f.state.show,2);assert(f.api.active);assert.equal(f.api.ime.showError,null);f.api.clear();
});
for(const synchronous of [false,true])test('show fail callback recovers, throws privacy-safe error and exposes async failure '+synchronous,()=>{
  const f=fixture(candidate,{failAt:synchronous?'syncFail':null});let r;if(synchronous)r=f.capture(()=>f.api.ime.show());else {f.api.ime.show();r=f.capture(()=>f.state.options[0].fail({errMsg:'private payload',value:'private input'}));}
  assert(r.threw);assert.equal(r.value.message,'GODOT_IME_KEYBOARD_SHOW_FAILED');assert.equal(f.api.ime.showError,r.value);assert.equal(f.api.active,false);assert.deepEqual(f.counts(),[0,0,0]);assert(!String(r.value).includes('private'));
  f.state.failAt=null;f.state.now+=101;f.api.ime.show();assert(f.api.active);f.api.clear();
});
test('old per-show input/confirm/complete and failure closures cannot affect reopened session',()=>{
  const f=fixture();f.api.ime.show();const retired={...f.state.registered},failure=f.state.options[0].fail;f.api.ime.hide();f.state.now+=101;f.api.ime.show();
  const events=f.state.events,keys=f.state.keys,hide=f.state.hide;for(const fn of Object.values(retired))fn({value:'retired'});failure({});
  assert.equal(f.state.events,events);assert.equal(f.state.keys,keys);assert.equal(f.state.hide,hide);assert(f.api.active);f.api.clear();
});
test('retired object cannot hide new object or deliver native callbacks',()=>{
  const f=fixture();f.api.ime.show();const oldIme=f.api.ime,oldCb={...f.state.registered};f.api.clear();f.init();f.api.ime.show();const events=f.state.events,hide=f.state.hide;
  for(const fn of Object.values(oldCb))fn({value:'old'});oldIme.hide();oldIme.show();assert.equal(f.state.events,events);assert.equal(f.state.hide,hide);assert(f.api.active);f.api.clear();
});
for(const phase of ['start','input','confirm','complete'])for(const action of ['clear','replace','reopen'])test('native reentry '+phase+' '+action,()=>{
  const f=fixture();if(phase!=='start')f.api.ime.show();let once=true;
  f.state.onIme=()=>{if(!once)return;once=false;if(action==='clear')f.api.clear();else if(action==='replace'){f.api.clear();f.init();f.api.ime.show();}else {f.api.ime.hide();f.state.now+=101;f.api.ime.show();}};
  if(phase==='start')f.api.ime.show();else f.state.registered[phase]({value:'ab'});
  assert.equal(f.state.keys,0);assert.equal(f.allocations.size,0);assert.deepEqual(f.counts(),action==='clear'?[0,0,0]:[1,1,1]);
  assert.equal(f.api.active,action!=='clear');if(f.api.ime)f.api.clear();
});
for(const action of ['clear','replace','reopen'])test('key down reentry stops key up and all remaining characters '+action,()=>{
  const f=fixture();f.api.ime.show();f.state.onKey=()=>{f.state.onKey=null;if(action==='clear')f.api.clear();else if(action==='replace'){f.api.clear();f.init();f.api.ime.show();}else{f.api.ime.hide();f.state.now+=101;f.api.ime.show();}};
  f.state.registered.input({value:'abc'});assert.equal(f.state.keys,1);assert.equal(f.api.initialText,undefined);if(f.api.ime)f.api.clear();
});
for(const thrown of [Object.freeze({kind:'OFF_FAILURE'}),undefined])test('cleanup attempts all listeners then hide; failure latch preserves '+typeof thrown,()=>{
  const f=fixture();f.api.ime.show();f.state.offFailures.set('input',thrown);const ime=f.api.ime;const r=f.capture(()=>f.api.clear());assert(r.threw);assert.equal(r.value,thrown);assert.equal(ime.cleanupFailed,true);assert.equal(ime.cleanupError,thrown);assert.equal(f.api.ime,ime);assert.equal(f.api.active,false);assert.equal(f.state.hide,1);assert.deepEqual(f.counts(),[1,0,0]);
  for(const fn of [()=>ime.show(),()=>f.api.clear(),()=>f.init()]){const r=f.capture(fn);assert(r.threw);assert.equal(r.value,thrown);}
});
test('primary show error retained while cleanup failure remains latched',()=>{
  const cleanup={kind:'CLEANUP'},f=fixture(candidate,{failAt:'confirm',afterAdd:true});f.state.offFailures.set('input',cleanup);assert.equal(f.capture(()=>f.api.ime.show()).value,f.sentinel);assert.equal(f.api.ime.cleanupError,cleanup);assert(f.api.ime.cleanupFailed);assert.equal(f.state.hide,1);
});
test('async show failure retains cleanup latch and invalidates callbacks even when off fails',()=>{
  const f=fixture();f.api.ime.show();const callbacks={...f.state.registered},cleanup={kind:'OFF_FAILURE'};f.state.offFailures.set('input',cleanup);
  const r=f.capture(()=>f.state.options[0].fail({}));assert(r.threw);assert.equal(r.value.message,'GODOT_IME_KEYBOARD_SHOW_FAILED');assert.equal(f.api.ime.cleanupError,cleanup);assert(f.api.ime.cleanupFailed);
  const events=f.state.events;for(const cb of Object.values(callbacks))cb({value:'late'});assert.equal(f.state.events,events);assert.equal(f.state.keys,0);assert.equal(f.state.hide,1);assert.equal(f.capture(()=>f.init()).value,cleanup);
});
test('hide failure latches and prevents false clear/reinitialization success',()=>{
  const f=fixture();f.api.ime.show();f.state.failAt='hide';const ime=f.api.ime;assert.equal(f.capture(()=>f.api.clear()).value,f.sentinel);assert.deepEqual(f.counts(),[0,0,0]);assert.equal(f.api.ime,ime);assert.equal(f.api.active,false);assert.equal(f.capture(()=>f.init()).value,f.sentinel);
});
test('cleanup-time reinitialization is rejected before it can hide a replacement keyboard',()=>{
  const f=fixture();f.api.ime.show();const ime=f.api.ime;f.state.onHide=()=>f.init();const r=f.capture(()=>f.api.clear());assert(r.threw);assert.equal(r.value.message,'GODOT_IME_CLEANUP_IN_PROGRESS');assert.equal(ime.cleanupError,r.value);assert.equal(f.api.ime,ime);assert.equal(f.state.show,1);
});
test('cleanup-time complete delivery is invalidated before off/hide',()=>{
  const f=fixture();f.api.ime.show();const cb=f.state.registered.complete;f.state.onHide=()=>cb({value:'late'});const events=f.state.events;f.api.clear();assert.equal(f.state.events,events);assert.equal(f.state.keys,0);
});
test('old-source negative controls preserve four known defects',()=>{
  const leak=fixture(old);leak.state.onIme=()=>{throw 17;};assert.equal(leak.capture(()=>leak.api.ime.show()).value,17);assert.equal(leak.allocations.size,1);
  const stranded=fixture(old,{failAt:'confirm',afterAdd:true});assert(stranded.capture(()=>stranded.api.ime.show()).threw);assert(stranded.api.active);assert.deepEqual(stranded.counts(),[1,1,0]);
  const stale=fixture(old);stale.api.ime.show();const cb=stale.state.registered.input;stale.api.ime.hide();stale.state.now+=101;stale.api.ime.show();cb({value:'late'});assert(stale.state.keys>0);
  const reentry=fixture(old);reentry.api.ime.show();reentry.state.onIme=()=>reentry.api.clear();reentry.state.registered.input({value:'ab'});assert.equal(reentry.state.keys,4);
});
test('fixed source remained identical after all derivation/model operations',()=>{
  assert.deepEqual(imeSessionIdentity(fs.readFileSync(file)),IME_SESSION_PINS.input);assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);
});
