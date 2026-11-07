// Actual pinned JS library functions with modeled heap/ID/C++ callback boundaries.
// No engine, WASM, WeChat or linked-glue dead-code-elimination acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
const baseCommit='c050c09b105c3715e1caa57a7109cd752047fd89';
const forkCommit='df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const pins={
  'platform/web/javascript_bridge_singleton.cpp':{bytes:15502,sha256:'0ca5d3366e740ba5ef6470fb68e6eb75708b813284912ce1506bdc2c5da66146',blob:'d3a62038799f6d31577f4da80f8d24c0f572aaf0',forkBytes:14976,forkSha256:'190601f92debabf3e42a7230fc280d666a3f466f4469ca85e0e58c2d90738f07'},
  'platform/web/js/libs/library_godot_javascript_singleton.js':{bytes:13522,sha256:'d65c74d148ca2f9bc33644cc6f6330c85f28c8803416951ac31865195f22296d',blob:'3ff6abba600ded6bedefbca3a6b74b9bf2a49835',forkBytes:14600,forkSha256:'06799fe5b4012522cc828f4b8104cdad7458a1b5d882af709aceb49d72cba2d4'},
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const identity=b=>({bytes:Buffer.byteLength(b),sha256:sha(b)});
let parser;
function parse(source) {
  if(!parser){const own={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:own,exports:own.exports});parser=own.exports;}
  return parser.parse(source,{ecmaVersion:2022});
}
function declaration(source,name) {
  const nodes=parse(source).body.flatMap(s=>s.declarations||[]).filter(d=>d.id.name===name);
  assert.equal(nodes.length,1);const n=nodes[0].init;assert.equal(n.type,'ObjectExpression');
  return source.slice(n.start,n.end);
}
function properties(source,name) {
  const code='('+declaration(source,name)+')',node=parse(code).body[0].expression;
  return new Map(node.properties.map(p=>[p.key.name??p.key.value,code.slice(p.value.start,p.value.end)]));
}
function model(source,{wechat=false,browserWxOnly=false,globalRoot={},gameRoot={},windowRoot={},noWindow=false}={}) {
  const ids=new Map(),values=new Map(),strings=new Map(),errors=[],freed=[],heap=new Uint8Array(8192);let next=1,nextString=100;
  const context=vm.createContext({ArrayBuffer,Uint8Array,SharedArrayBuffer,Array,Map,
    IDHandler:{add(v){const id=next++;ids.set(id,v);return id;},get:id=>ids.get(id),remove:id=>ids.delete(id)},
    HEAPU8:heap,GodotRuntime:{parseString:v=>typeof v==='number'?strings.get(v):v,
      getHeapValue:p=>values.get(p)??0,setHeapValue:(p,v)=>values.set(p,v),allocString:v=>{const id=nextString++;strings.set(id,v);return id;},
      get_func:v=>v,error:(...v)=>errors.push(v)},
  });
  if(!noWindow)context.window=windowRoot;
  context.globalThis=globalRoot;
  if(wechat){context.GameGlobal=gameRoot;context.wx={getSystemInfoSync(){return {};}};}
  else if(browserWxOnly)context.wx={getSystemInfoSync(){return {};}};
  vm.runInContext('var Library=('+declaration(source,'GodotJSWrapper')+');var GodotJSWrapper=Library.$GodotJSWrapper;GodotJSWrapper.proxies=new Map();var EvalLibrary=('+declaration(source,'GodotEval')+');',context);
  return {lib:context.Library,wrapper:context.GodotJSWrapper,eval:context.EvalLibrary,ids,values,strings,errors,freed,heap,
    get(name){return context.Library.godot_js_wrapper_interface_get(name);},
    create(name,args=[]){const convert=(_p,index,exchange,lock)=>{const value=args[index];values.set(lock,0);if(typeof value==='number'){values.set(exchange,value);return 2;}if(typeof value==='string'){const ptr=nextString++;strings.set(ptr,value);values.set(exchange,ptr);return 4;}throw Error('TEST_ARGUMENT_TYPE');};
      const type=context.Library.godot_js_wrapper_create_object(name,0,args.length,convert,10,20,(...v)=>freed.push(v));return {type,value:values.get(10)};},
  };
}
if(process.env.WXSLIM_OFFICIAL_JSBRIDGE_SOURCE!=='fetch-fixed-c050'||!process.env.WXSLIM_FIXED_ENGINE_SOURCE) {
  test('JSBridge requires explicit fixed-source retrieval and local source opt-in',{skip:'Set WXSLIM_OFFICIAL_JSBRIDGE_SOURCE=fetch-fixed-c050 and WXSLIM_FIXED_ENGINE_SOURCE; no default network or source evaluation'},()=>{});
} else {
  const root=process.env.WXSLIM_FIXED_ENGINE_SOURCE;assert(path.isAbsolute(root));
  const base=new Map(),fork=new Map();
  for(const [name,pin]of Object.entries(pins)) {
    const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+baseCommit+'/'+name,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok);
    const source=await r.text();assert.deepEqual(identity(source),{bytes:pin.bytes,sha256:pin.sha256});
    const b=Buffer.from(source),blob=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');assert.equal(blob,pin.blob);
    base.set(name,source);
    const local=execFileSync('git',['-C',root,'show',forkCommit+':'+name]);assert.deepEqual(identity(local),{bytes:pin.forkBytes,sha256:pin.forkSha256});fork.set(name,local.toString());
  }
  const patch=fs.readFileSync(new URL('../engine/official-jsbridge-source.patch',import.meta.url));
  const changed=replayUnifiedPatch(patch,name=>{assert(base.has(name));return base.get(name);});
  const cppName=[...base.keys()][0],jsName=[...base.keys()][1],cpp=changed.get(cppName).text,js=changed.get(jsName).text,original=base.get(jsName);
  test('strict two-file replay, reverse and duplicate rejection',()=>{
    assert.deepEqual([...changed.keys()],[cppName,jsName]);assert.throws(()=>replayUnifiedPatch(patch,n=>changed.get(n).text));
    const reverse=patch.toString().split('\n').map(line=>{const h=/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);if(h)return `@@ -${h[3]},${h[4]} +${h[1]},${h[2]} @@`;if(line.startsWith('--- ')||line.startsWith('+++ '))return line;if(line.startsWith('+'))return '-'+line.slice(1);if(line.startsWith('-'))return '+'+line.slice(1);return line;}).join('\n');
    for(const [name,item]of replayUnifiedPatch(Buffer.from(reverse),n=>changed.get(n).text))assert.equal(item.text,base.get(name));
  });
  test('C++ changes only eval body branch; browser body and all Variant/callback code remain exact',()=>{
    const first='Variant JavaScriptBridge::eval(const String &p_code, bool p_use_global_exec_context) {\n',last='\n}\n\nbool JavaScriptBridge::is_js_buffer';
    const start=cpp.indexOf(first)+first.length,end=cpp.indexOf(last,start),body=cpp.slice(start,end);
    const split=/^#ifdef WECHAT_GLX_EXPERIMENTAL\n([\s\S]*?)#else\n([\s\S]*?)#endif$/.exec(body);assert(split);
    assert(!/godot_js_eval\s*\(|new\s+Function|\beval\s*\(/.test(split[1]));assert(split[1].includes('return Variant();'));
    assert(split[2].endsWith('\n'));
    const restored=cpp.slice(0,start)+split[2].slice(0,-1)+cpp.slice(end);assert.equal(restored,base.get(cppName));
    assert(cpp.includes('obj->_callable.call(arg);'));assert(cpp.includes('Variant ret;\n\tconst Variant *v = &ret;'));
  });
  test('all existing export signatures/proxies and unrelated production methods are exact',()=>{
    const before=properties(original,'GodotJSWrapper'),after=properties(js,'GodotJSWrapper');assert.deepEqual([...after.keys()],[...before.keys()]);
    for(const [name,code]of before)if(!['$GodotJSWrapper','godot_js_wrapper_interface_get','godot_js_wrapper_create_object'].includes(name))assert.equal(after.get(name),code,name);
    assert.equal(declaration(js,'GodotEval'),declaration(original,'GodotEval'),'Browser eval library deliberately remains official source; linked DCE NOT_PROVEN');
    const old=properties('const Inner='+before.get('$GodotJSWrapper')+';','Inner'),next=properties('const Inner='+after.get('$GodotJSWrapper')+';','Inner');
    for(const [name,code]of old)assert.equal(next.get(name),code,name);
    assert.deepEqual([...next.keys()].filter(n=>!old.has(n)),['isWechatRuntime','resolveWechatNamedObject']);
    assert(!/new\s+Function\s*\(/.test(js));
  });
  test('ordinary browser preserves window selection over global object',()=>{
    for(const s of [original,js]){const local={},remote={};const m=model(s,{globalRoot:{api:local},windowRoot:{api:remote}});assert.equal(m.wrapper.get_proxied_value(m.get('api')),remote);}
  });
  test('browser with a wx-like API but no GameGlobal keeps official branch',()=>{
    const expected={};const m=model(js,{browserWxOnly:true,globalRoot:{api:{}},windowRoot:{api:expected}});assert.equal(m.wrapper.get_proxied_value(m.get('api')),expected);
  });
  test('WeChat exact local global first, then GameGlobal, then window',()=>{
    const a={},b={},c={};const m=model(js,{wechat:true,globalRoot:{a,clash:a},gameRoot:{b,clash:b},windowRoot:{c,clash:c}});
    for(const [name,value]of [['a',a],['b',b],['c',c],['clash',a]])assert.equal(m.wrapper.get_proxied_value(m.get(name)),value);
    assert.equal(m.get('absent'),0);
  });
  test('WeChat throws on bridged root access are skipped without reading twice or logging payload',()=>{
    let calls=0;const root={};Object.defineProperty(root,'api',{get(){calls++;throw Error('PRIVATE_TEST_DETAIL');}});const api={};
    const m=model(js,{wechat:true,globalRoot:root,gameRoot:{api}});assert.equal(m.wrapper.get_proxied_value(m.get('api')),api);assert.equal(calls,1);assert.deepEqual(m.errors,[]);
  });
  test('WeChat works without window; known null shadows later roots',()=>{
    const m=model(js,{wechat:true,noWindow:true,globalRoot:{nullable:null},gameRoot:{api:{},nullable:{}}});assert(m.get('api')>0);assert.equal(m.wrapper.get_proxied_value(m.get('nullable')),null);
  });
  test('GODOTSDK audio object chain keeps actual objects through production proxy getters',()=>{
    const context={},sdk={audio:{WEBAudio:{audioContext:context}}};const m=model(js,{wechat:true,gameRoot:{GODOTSDK:sdk}});let id=m.get('GODOTSDK');
    for(const name of ['audio','WEBAudio','audioContext']){assert.equal(m.lib.godot_js_wrapper_object_get(id,10,name),24);id=m.values.get(10);}
    assert.equal(m.wrapper.get_proxied_value(id),context);
  });
  test('ordinary browser constructor keeps its original second property read after argument conversion',()=>{
    for(const s of [original,js]){let gets=0;function First(){this.kind='first';}function Second(){this.kind='second';}const win={};Object.defineProperty(win,'Example',{get(){return ++gets===1?First:Second;}});const m=model(s,{windowRoot:win});const r=m.create('Example',[7]);assert.equal(r.type,24);assert.equal(m.wrapper.get_proxied_value(r.value).kind,'second');assert.equal(gets,2);}
  });
  test('WeChat create_object constructs real resolved target with converted primitive arguments',()=>{
    function Example(n,s){this.number=n;this.text=s;}const m=model(js,{wechat:true,gameRoot:{Example}});const r=m.create('Example',[7,'value']);assert.equal(r.type,24);const value=m.wrapper.get_proxied_value(r.value);assert(value instanceof Example);assert.equal(value.number,7);assert.equal(value.text,'value');
    assert.equal(m.create('Absent').type,-1);assert.equal(model(js,{wechat:true,gameRoot:{NotConstructor:{}}}).create('NotConstructor').type,-1);
  });
  test('Variant conversion and proxy reference lifetime retain official behavior',()=>{
    const m=model(js,{wechat:true});for(const [value,type]of [[null,0],[undefined,0],[true,1],[7,2],[1.25,3],[7n,2],['text',4]])assert.equal(m.wrapper.js2variant(value,10),type);
    m.values.set(10,9007199254740992n);assert.equal(m.wrapper.variant2js(2,10),9007199254740992n);m.values.set(10,7n);assert.equal(m.wrapper.variant2js(2,10),7);
    const obj={};const a=m.wrapper.get_proxied(obj),b=m.wrapper.get_proxied(obj);assert.equal(a,b);m.lib.godot_js_wrapper_object_unref(a);assert(m.ids.has(a));m.lib.godot_js_wrapper_object_unref(b);assert(!m.ids.has(a));
  });
  test('actual callback wrapper receives temporary argument proxy; modeled C++ NIL is preserved',()=>{
    const m=model(js,{wechat:true});let received;const id=m.lib.godot_js_wrapper_create_cb(23,(ref,args,count)=>{assert.equal(ref,23);received=m.wrapper.get_proxied_value(args);assert.equal(count,2);m.lib.godot_js_wrapper_object_set_cb_ret(0,10);return 'NOT_CPP_RETURN_RECEIPT';});
    const callback=m.wrapper.get_proxied_value(id),before=m.ids.size;assert.equal(callback(7,'text'),null);assert.deepEqual(received,[7,'text']);assert.equal(m.ids.size,before);
    m.lib.godot_js_wrapper_object_unref(id);assert.equal(callback(),undefined);
  });
  test('negative control: upstream callback throw still lacks finally cleanup; not fixed by this unit',()=>{
    const m=model(js,{wechat:true}),error=Error('callback boundary');const id=m.lib.godot_js_wrapper_create_cb(23,()=>{throw error;});const n=m.ids.size;
    assert.throws(()=>m.wrapper.get_proxied_value(id)(),e=>e===error);assert.equal(m.ids.size,n+1,'Known temporary-proxy cleanup limitation retained');
  });
  test('byte bridge preserves Uint8Array slice and retains known non-Uint8Array whole-buffer limitation',()=>{
    const m=model(js,{wechat:true}),bytes=new Uint8Array([77,0,128,255,99]);const transfer=value=>{const id=m.wrapper.get_proxied(value);let count=-1;m.lib.godot_js_wrapper_object_transfer_buffer(id,0,0,(_a,_w,n)=>{count=n;return 0;});return [...m.heap.slice(0,count)];};
    assert.deepEqual(transfer(bytes.subarray(1,4)),[0,128,255]);assert.deepEqual(transfer(new DataView(bytes.buffer,1,3)),[77,0,128,255,99]);assert.equal(m.wrapper.isBuffer(new Uint8Array(new SharedArrayBuffer(4))),true);
  });
  test('official browser eval production function still converts result; WeChat C++ branch is source-only proof',()=>{
    const m=model(js);assert.equal(m.eval.godot_js_eval('1 + 2',0,10,0,0,()=>0),3);assert.equal(m.values.get(10),3);assert.equal(m.eval.godot_js_eval('true',1,10,0,0,()=>0),1);assert.equal(m.values.get(10),true);
  });
  test('identity receipt: no final-glue DCE, engine, platform or sandbox assertion',t=>{
    t.diagnostic(JSON.stringify({baseCommit,forkCommit,inputs:[...base].map(([path,text])=>({path,...identity(text),gitBlob:pins[path].blob})),fork:[...fork].map(([path,text])=>({path,...identity(text)})),outputs:[...changed].map(([path,v])=>({path,...identity(v.text)})),patch:identity(patch),evidence:'ACTUAL_JS_WITH_MODELED_HEAP_CALLBACKS_CPP_SOURCE_BRANCH_ONLY',wasm:false,linkedDce:'NOT_VERIFIED',sandbox:false}));
  });
}
