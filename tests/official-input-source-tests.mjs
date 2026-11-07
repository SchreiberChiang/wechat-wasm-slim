// Actual pinned input functions, modeled DOM/events/keyboard/heap only.
// No actual C++, WASM, IME platform or device acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
import {replayInputCorrection} from '../engine/audit-wechat-input-contract.mjs';
const baseCommit='c050c09b105c3715e1caa57a7109cd752047fd89',forkCommit='df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const file='platform/web/js/libs/library_godot_input.js';
const pins={
  [file]:{bytes:23574,sha256:'bdf6ec2ff64820072c44de34fdf46683a1173ea037386059ce2946b02da29db3',forkBytes:23783,forkSha256:'795c86181b1848ba6c902e237d93c531093737835ca95f4909d591cb4e39c780'},
  'platform/web/godot_js.h':{bytes:7600,sha256:'7942335057dc849fae1f6c04665bdf4aeb27ecdab732bd1d3413c303328c8b16',forkBytes:7649,forkSha256:'ad248d3c6d61181dad38a2161b6decdbeab89c9b2fadec9582b9665900ea0918'},
  'platform/web/display_server_web.cpp':{bytes:49511,sha256:'2e4b1ebf3b08b39494e47f8b699797140d79d5c821263094c3997bb85af63b4e',forkBytes:49900,forkSha256:'0ec8154ce80fbb52352e504a2d52bbefc8584f1987909b26e3ed3fb10943cc23'},
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),id=b=>({bytes:Buffer.byteLength(b),sha256:sha(b)});
let parser;
function parse(text){if(!parser){const m={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:m,exports:m.exports});parser=m.exports;}return parser.parse(text,{ecmaVersion:2022});}
function object(text,name){const d=parse(text).body.flatMap(x=>x.declarations||[]).filter(x=>x.id.name===name);assert.equal(d.length,1);return text.slice(d[0].init.start,d[0].init.end);}
function props(text,name){const source='('+object(text,name)+')',n=parse(source).body[0].expression;return new Map(n.properties.map(p=>[p.key.name??p.key.value,source.slice(p.value.start,p.value.end)]));}
function model(source,{wechat=false,wxOnly=false}={}) {
  const listeners=[],calls=[],native=[],imeCalls=[],keyCalls=[],heap=new Map(),callbacks={input:null,confirm:null,complete:null},exits=[];
  const state={now:1000,offError:null,hideError:false,completeOnHide:false,lastComplete:null,hideCount:0,prevented:0,nativeResult:1};
  const rect=Object.freeze({x:10,y:20,width:100,height:50}),canvas={width:200,height:100,style:{},focus(){calls.push(['canvasFocus']);},getBoundingClientRect:()=>rect,parentElement:{appendChild:n=>calls.push(['append',n])}};
  const elements=[],timers=new Map();let nextTimer=0;
  const box={window:{},GodotConfig:{canvas},GodotOS:{atexit:fn=>exits.push(fn)},Date:{now:()=>state.now},
    document:{createElement:()=>{const e={style:{},focus(){calls.push(['elementFocus']);},remove(){calls.push(['remove']);}};elements.push(e);return e;}},
    navigator:{getGamepads:()=>['BROWSER_PAD']},setInterval(fn){const n=++nextTimer;timers.set(n,fn);return n;},clearInterval:n=>timers.delete(n),
    GodotEventListeners:{add:(target,event,callback,passive)=>listeners.push({target,event,callback,passive})},
    GodotRuntime:{get_func:x=>x,allocString:x=>x,free:x=>calls.push(['free',x]),stringToHeap:(value,pointer)=>calls.push(['string',value,pointer]),setHeapValue:(p,v)=>heap.set(p,v)},
  };
  if(wechat||wxOnly)box.wx={getSystemInfoSync(){return {};},showKeyboard:o=>calls.push(['show',o]),onKeyboardInput:fn=>callbacks.input=fn,onKeyboardConfirm:fn=>callbacks.confirm=fn};
  if(wechat)box.GameGlobal={};
  box.__globalAdapter={onKeyboardComplete:fn=>{callbacks.complete=fn;state.lastComplete=fn;},offKeyboardInput:fn=>off('input',fn),offKeyboardConfirm:fn=>off('confirm',fn),offKeyboardComplete:fn=>off('complete',fn),hideKeyboard:()=>{state.hideCount++;assert(state.hideCount<4);calls.push(['hide',box.GodotIME.active]);if(state.hideError)throw Error('MODEL_HIDE');if(state.completeOnHide)state.lastComplete({value:'late'});}};
  function off(kind,fn){assert.equal(fn,callbacks[kind]);calls.push(['off',kind,box.GodotIME.active]);if(state.offError===kind)throw Error('MODEL_OFF_'+kind);callbacks[kind]=null;}
  const context=vm.createContext(box,{codeGeneration:{strings:false,wasm:false}});
  vm.runInContext('var IMELibrary=('+object(source,'GodotIME')+');var GodotIME=IMELibrary.$GodotIME;var GodotIMEWechat=IMELibrary.$GodotIMEWechat;var GodotInputPlatform=IMELibrary.$GodotInputPlatform;var PadLibrary=('+object(source,'GodotInputGamepads')+');var GodotInputGamepads=PadLibrary.$GodotInputGamepads;var InputLibrary=('+object(source,'GodotInput')+');var GodotInput=InputLibrary.$GodotInput;',context);
  vm.runInContext(box.IMELibrary.$GodotIME__postset,context);
  return {box,context,listeners,calls,native,imeCalls,keyCalls,heap,callbacks,exits,state,canvas,rect,elements,timers,
    init(){box.InputLibrary.godot_js_set_ime_cb((...x)=>imeCalls.push(x),(...x)=>keyCalls.push(x),100,200);},
    register(kind){box.InputLibrary['godot_js_input_mouse_'+kind+'_cb']((...args)=>{native.push(args);return state.nativeResult;});},
  };
}
const moveEvent={clientX:30,clientY:45,movementX:2,movementY:-3,shiftKey:true,altKey:false,ctrlKey:true,metaKey:false};
if(process.env.WXSLIM_OFFICIAL_INPUT_SOURCE!=='fetch-fixed-c050'||!process.env.WXSLIM_FIXED_ENGINE_SOURCE)test('explicit fixed official input sources required',{skip:'No default network: set WXSLIM_OFFICIAL_INPUT_SOURCE=fetch-fixed-c050 and WXSLIM_FIXED_ENGINE_SOURCE'},()=>{});
else {
  const root=process.env.WXSLIM_FIXED_ENGINE_SOURCE;assert(path.isAbsolute(root));const base=new Map(),fork=new Map();
  for(const [name,p]of Object.entries(pins)){
    const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+baseCommit+'/'+name,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok);const text=await r.text();assert.deepEqual(id(text),{bytes:p.bytes,sha256:p.sha256});base.set(name,text);
    const b=execFileSync('git',['-C',root,'show',forkCommit+':'+name]);assert.deepEqual(id(b),{bytes:p.forkBytes,sha256:p.forkSha256});fork.set(name,b);
  }
  const patch=fs.readFileSync(new URL('../engine/official-input-source.patch',import.meta.url)),replay=replayUnifiedPatch(patch,n=>{assert.equal(n,file);return base.get(n);});
  const source=replay.get(file).text,original=base.get(file),v2=replayInputCorrection(fork.get(file)).toString();
  test('single-file strict replay and reverse, duplicate rejection and JS parse',()=>{
    assert.deepEqual([...replay.keys()],[file]);assert.throws(()=>replayUnifiedPatch(patch,()=>source));new vm.Script(source);
    const reverse=patch.toString().split('\n').map(l=>{const m=/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(l);if(m)return `@@ -${m[3]},${m[4]} +${m[1]},${m[2]} @@`;if(l.startsWith('--- ')||l.startsWith('+++ '))return l;if(l.startsWith('+'))return '-'+l.slice(1);if(l.startsWith('-'))return '+'+l.slice(1);return l;}).join('\n');assert.equal(replayUnifiedPatch(Buffer.from(reverse),()=>source).get(file).text,original);
  });
  test('official DOM IME exact; separate WeChat object is exact v2 production helper, not v1',()=>{
    assert.equal(props(source,'GodotIME').get('$GodotIME'),props(original,'GodotIME').get('$GodotIME'));
    assert.equal(props(source,'GodotIME').get('$GodotIMEWechat'),props(v2,'GodotIME').get('$GodotIME'));
    assert(source.includes("'$GodotInputPlatform', '$GodotIMEWechat'"));assert(source.includes('GodotIME = GodotIMEWechat;'));
  });
  test('existing export sig/proxy and unrelated input/drag-drop functions remain exact',()=>{
    const old=props(original,'GodotInput'),next=props(source,'GodotInput');assert.deepEqual([...next.keys()],[...old.keys()]);
    const allowed=['godot_js_input_mouse_move_cb','godot_js_input_mouse_wheel_cb','godot_js_input_touch_cb'];for(const [k,v]of old)if(!allowed.includes(k))assert.equal(next.get(k),v,k);
    assert.equal(object(source,'GodotInputDragDrop'),object(original,'GodotInputDragDrop'));
    const a=props(original,'GodotInputGamepads'),b=props(source,'GodotInputGamepads');for(const[k,v]of a)if(!['$GodotInputGamepads__deps','$GodotInputGamepads'].includes(k))assert.equal(b.get(k),v);
    assert.equal(b.get('$GodotInputGamepads').replace('\t\t\tif (GodotInputPlatform.isWechatRuntime()) return [];\n',''),a.get('$GodotInputGamepads'));
  });
  test('actual fixed official and fork header/C++ require pressure sixth and wheel mode first',()=>{
    for(const text of [base.get('platform/web/godot_js.h'),fork.get('platform/web/godot_js.h').toString()]){
      assert(text.includes('void (*p_callback)(double p_x, double p_y, double p_rel_x, double p_rel_y, int p_modifiers, double p_pressure)'));
      assert(text.includes('int (*p_callback)(int p_delta_mode, double p_delta_x, double p_delta_y)'));
    }
    for(const text of [base.get('platform/web/display_server_web.cpp'),fork.get('platform/web/display_server_web.cpp').toString()]){
      assert(text.includes('mouse_move_callback(double p_x, double p_y, double p_rel_x, double p_rel_y, int p_modifiers, double p_pressure)'));
      assert(text.includes('mouse_wheel_callback(int p_delta_mode, double p_delta_x, double p_delta_y)'));
    }
  });
  test('browser DOM activation/composition/cleanup retain official operations',()=>{
    for(const s of [original,source]){const m=model(s);m.init();assert.equal(m.elements.length,1);const ime=m.box.GodotIME.ime;m.box.GodotIME.ime_active(true);assert.equal(ime.style.display,'block');assert.equal(m.timers.size,1);
      m.listeners.find(x=>x.event==='compositionupdate').callback({type:'compositionupdate',data:'字'});assert.deepEqual(m.imeCalls.at(-1),[1,'字']);m.box.GodotIME.ime_position(20,40);assert.equal(ime.style.left,'20px');assert.equal(ime.style.top,'40px');m.box.GodotIME.clear();assert.equal(m.timers.size,0);assert.equal(m.calls.filter(x=>x[0]==='remove').length,1);}
  });
  test('browser keeps navigator gamepad and pointermove with unnormalized pressure',()=>{
    for(const s of [original,source]){const m=model(s);assert.deepEqual(m.box.GodotInputGamepads.get_pads(),['BROWSER_PAD']);m.register('move');assert.equal(m.listeners.at(-1).event,'pointermove');m.listeners.at(-1).callback(moveEvent);assert.deepEqual(m.native.at(-1),[40,50,4,-6,5,undefined]);}
    const m=model(source,{wxOnly:true});assert.deepEqual(m.box.GodotInputGamepads.get_pads(),['BROWSER_PAD']);m.init();assert.equal(m.elements.length,1);
  });
  test('WeChat selects only native IME and empty gamepads, caches startup backend',()=>{
    const m=model(source,{wechat:true});assert.equal(m.box.GodotIME,m.box.GodotIMEWechat);assert.equal(m.box.GodotInputGamepads.get_pads().length,0);m.init();assert.equal(m.elements.length,0);delete m.box.GameGlobal;assert.equal(m.box.GodotInputPlatform.isWechatRuntime(),true);
  });
  test('WeChat mouse uses six args with finite pressure or zero, original coordinates intact',()=>{
    const m=model(source,{wechat:true});m.register('move');assert.equal(m.listeners.at(-1).event,'mousemove');
    for(const [pressure,want]of [[undefined,0],[null,0],[NaN,0],[Infinity,0],[0,0],[0.6,0.6]]){m.listeners.at(-1).callback({...moveEvent,pressure});assert.deepEqual(m.native.at(-1),[40,50,4,-6,5,want]);}
  });
  test('wheel keeps browser values and WeChat mode/deltas defaults with preventDefault semantics',()=>{
    const b=model(source);b.register('wheel');b.listeners.at(-1).callback({preventDefault(){}});assert.deepEqual(b.native.at(-1),[undefined,0,0]);
    const m=model(source,{wechat:true});m.register('wheel');let prevented=0;for(const mode of [0,1,2,undefined,null]){m.listeners.at(-1).callback({deltaMode:mode,deltaX:4,deltaY:-3,preventDefault(){prevented++;}});assert.deepEqual(m.native.at(-1),[mode??0,4,-3]);}assert.equal(prevented,5);m.state.nativeResult=0;m.listeners.at(-1).callback({preventDefault(){prevented++;}});assert.equal(prevented,5);assert.deepEqual(m.native.at(-1),[0,0,0]);
  });
  test('touch preserves browser offset and uses WeChat zero origin without mutating host rect',()=>{
    for(const [wechat,x,y]of [[false,40,50],[true,60,90]]){const m=model(source,{wechat});m.box.InputLibrary.godot_js_input_touch_cb((...a)=>m.native.push(a),300,400);const listener=m.listeners.find(x=>x.event==='touchstart');let prevented=0;listener.callback({changedTouches:[{clientX:30,clientY:45,identifier:9}],cancelable:true,preventDefault(){prevented++;}});assert.equal(m.heap.get(400),x);assert.equal(m.heap.get(408),y);assert.equal(m.heap.get(300),9);assert.deepEqual(m.native.at(-1),[0,1]);assert.equal(prevented,1);assert.deepEqual(m.rect,{x:10,y:20,width:100,height:50});}
  });
  test('v2 clear before show and repeated clear do not hide native keyboard',()=>{
    const m=model(source,{wechat:true});m.init();m.box.GodotIME.clear();m.box.GodotIME.clear();assert.equal(m.box.GodotIME.ime,null);assert.equal(m.state.hideCount,0);
  });
  test('v2 active clear detaches identical callbacks before hide and prevents stale synchronous complete',()=>{
    const m=model(source,{wechat:true});m.init();m.box.GodotIME.ime.show();m.state.completeOnHide=true;const count=m.imeCalls.length;m.box.GodotIME.clear();assert.equal(m.state.hideCount,1);assert.deepEqual(m.calls.filter(x=>x[0]==='off'||x[0]==='hide'),[['off','input',false],['off','confirm',false],['off','complete',false],['hide',false]]);assert.equal(m.imeCalls.length,count);assert.equal(m.keyCalls.length,0);
  });
  test('v2 each off failure stays latched across repeated clear/show/init without native retry',()=>{
    for(const kind of ['input','confirm','complete']){const m=model(source,{wechat:true});m.init();const owner=m.box.GodotIME.ime;owner.show();m.state.offError=kind;assert.throws(()=>m.box.GodotIME.clear(),/MODEL_OFF/);const count=m.calls.length;assert.throws(()=>m.box.GodotIME.clear(),/MODEL_OFF/);assert.throws(()=>owner.show(),/MODEL_OFF/);assert.throws(()=>m.init(),/MODEL_OFF/);assert.equal(m.calls.length,count);assert.equal(m.box.GodotIME.ime,owner);assert.equal(m.state.hideCount,0);}
  });
  test('v2 native hide failure stays visible without repeat native call',()=>{
    const m=model(source,{wechat:true});m.init();const owner=m.box.GodotIME.ime;owner.show();m.state.hideError=true;assert.throws(()=>m.box.GodotIME.clear(),/MODEL_HIDE/);assert.throws(()=>m.box.GodotIME.clear(),/MODEL_HIDE/);assert.equal(m.box.GodotIME.ime,owner);assert.equal(m.state.hideCount,1);
  });
  test('v2 retired instance callbacks cannot edit replacement; reinit cleans active instance',()=>{
    const m=model(source,{wechat:true});m.init();const old=m.box.GodotIME.ime;old.show();const callbacks={...m.callbacks};m.init();assert.notEqual(m.box.GodotIME.ime,old);m.box.GodotIME.ime.show();const keys=m.keyCalls.length,imes=m.imeCalls.length;for(const cb of Object.values(callbacks))cb({value:'late'});assert.equal(m.keyCalls.length,keys);assert.equal(m.imeCalls.length,imes);assert.equal(m.state.hideCount,1);
  });
  test('existing normal text/confirm path still runs; not a full Chinese IME proof',()=>{
    const m=model(source,{wechat:true});m.init();m.box.GodotIME.ime.show();m.callbacks.input({value:'a'});assert(m.keyCalls.length>0);m.callbacks.confirm({value:'b'});assert.equal(m.box.GodotIME.initialText,'b');assert.equal(m.box.GodotIME.active,false);assert.equal(m.state.hideCount,1);
  });
  test('negative control: same-object old-session callback remains indistinguishable after hide/show',()=>{
    const m=model(source,{wechat:true});m.init();const owner=m.box.GodotIME.ime;owner.show();const stale=m.callbacks.input;owner.hide();m.state.now+=200;owner.show();const before=m.keyCalls.length;stale({value:'prior session'});assert(m.keyCalls.length>before,'Known v2 same-object session limit must not be misreported as fixed');
  });
  test('atexit postset routes to selected real backend clear; no false cleanup success on throw',()=>{
    const m=model(source,{wechat:true});m.init();m.box.GodotIME.ime.show();m.state.hideError=true;let resolved=false;assert.throws(()=>m.exits[0](()=>resolved=true,()=>{}),/MODEL_HIDE/);assert.equal(resolved,false);
  });
  test('identity receipt: source/model gates only, no device/full-IME acceptance',t=>{
    t.diagnostic(JSON.stringify({baseCommit,forkCommit,inputs:[...base].map(([path,text])=>({path,...id(text)})),referenceFork:[...fork].map(([path,b])=>({path,...id(b)})),v2Patch:{file:'engine/wechat-input-contract-v2.patch',...id(fs.readFileSync(new URL('../engine/wechat-input-contract-v2.patch',import.meta.url)))},v2Derived:id(v2),patch:id(patch),output:{path:file,...id(source)},evidence:'ACTUAL_JS_FUNCTIONS_MODELED_DOM_EVENTS_KEYBOARD_HEAP',cpp:'SIGNATURE_SOURCE_ONLY',wasm:false,WeChat:false,fullIme:false}));
  });
}
