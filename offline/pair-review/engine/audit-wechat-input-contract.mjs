// Read-only preparation check. Replays a proposed patch in memory; never writes
// the selected checkout, builds an engine, or executes a WASM/engine factory.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const inputPath='platform/web/js/libs/library_godot_input.js';
const commit='df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const pins={
  [inputPath]:{bytes:23783,sha256:'795c86181b1848ba6c902e237d93c531093737835ca95f4909d591cb4e39c780'},
  'platform/web/godot_js.h':{bytes:7649,sha256:'ad248d3c6d61181dad38a2161b6decdbeab89c9b2fadec9582b9665900ea0918'},
  'platform/web/display_server_web.cpp':{bytes:49900,sha256:'0ec8154ce80fbb52352e504a2d52bbefc8584f1987909b26e3ed3fb10943cc23'},
};
const patchPin={sha256:'58dcbe5e42adbd180b550eab0b04bcca26e292f187ba9a5138d591672163d36a'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>({bytes:value.length,sha256:hash(value)});
function regular(file){const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink(),'INPUT_NOT_REGULAR');assert(s.size<128*1024,'INPUT_TOO_LARGE');return fs.readFileSync(file);}
function acorn(){
  const require=createRequire(import.meta.url);
  try {const file=require.resolve('acorn');const rel=path.relative(root,file);if(rel&&!path.isAbsolute(rel)&&!rel.startsWith('..'+path.sep))return require(file);}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
  const code=process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
  assert.equal(typeof code,'string','EXISTING_ACORN_REQUIRED_NO_INSTALL');
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports},{timeout:1000});return module.exports;
}

export function replayInputCorrection(source,patch=regular(new URL('./wechat-input-contract-v2.patch',import.meta.url))){
  assert(Buffer.isBuffer(source),'SOURCE_BUFFER_REQUIRED');
  assert.deepEqual(identity(source),pins[inputPath],'SOURCE_PIN_MISMATCH');
  assert.equal(hash(patch),patchPin.sha256,'PATCH_PIN_MISMATCH');
  const files=replayUnifiedPatch(patch,name=>{assert.equal(name,inputPath);return source;});
  assert.deepEqual([...files.keys()],[inputPath]);
  const result=Buffer.from(files.get(inputPath).text);
  assert.equal(source.subarray(0,source.indexOf('/*\n * IME API')).toString(),result.subarray(0,result.indexOf('/*\n * IME API')).toString(),'COPYRIGHT_HEADER_CHANGED');
  return result;
}

function extract(text){
  const parser=acorn(),ast=parser.parse(text,{ecmaVersion:2022,sourceType:'script'});
  function property(variable,key){
    const declarations=ast.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).filter(n=>n.id.name===variable);
    assert.equal(declarations.length,1);const props=declarations[0].init.properties.filter(p=>(p.key.name??p.key.value)===key);
    assert.equal(props.length,1);return text.slice(props[0].value.start,props[0].value.end);
  }
  return {ime:property('GodotIME','$GodotIME'),input:property('GodotInput','$GodotInput'),move:property('GodotInput','godot_js_input_mouse_move_cb'),wheel:property('GodotInput','godot_js_input_mouse_wheel_cb'),parser:parser.version};
}

function model(parts){
  const listeners=[],calls=[],nativeCalls=[],imeCalls=[],keyCalls=[];
  const registered={input:null,confirm:null,complete:null};
  const state={nativeResult:1,completeOnHide:false,hideCount:0,offError:null,hideError:false,lastComplete:null,now:1000};
  const canvas={width:200,height:100,getBoundingClientRect:()=>({x:10,y:20,width:100,height:50})};
  const sandbox={window:{},GodotConfig:{canvas},Date:{now:()=>state.now},
    GodotEventListeners:{add:(target,event,callback,passive)=>listeners.push({target,event,callback,passive})},
    GodotRuntime:{get_func:()=> (...args)=>{nativeCalls.push(args);return state.nativeResult;},allocString:value=>value,free:()=>{},stringToHeap:(value,pointer)=>calls.push(['stringToHeap',value,pointer])},
    wx:{showKeyboard:options=>calls.push(['show',options]),onKeyboardInput:fn=>{registered.input=fn;},onKeyboardConfirm:fn=>{registered.confirm=fn;}},
  };
  sandbox.__globalAdapter={
    onKeyboardComplete:fn=>{registered.complete=fn;state.lastComplete=fn;},
    offKeyboardInput:fn=>off('input',fn),offKeyboardConfirm:fn=>off('confirm',fn),offKeyboardComplete:fn=>off('complete',fn),
    hideKeyboard:()=>{state.hideCount++;assert(state.hideCount<3,'RECURSIVE_HIDE');calls.push(['hide',sandbox.GodotIME.active]);if(state.hideError)throw Error('MODEL_HIDE_FAILURE');if(state.completeOnHide)state.lastComplete({value:'queued'});},
  };
  function off(kind,fn){assert.equal(fn,registered[kind],'CALLBACK_IDENTITY_CHANGED');calls.push(['off',kind,sandbox.GodotIME.active]);if(state.offError===kind)throw Error('MODEL_OFF_FAILURE');registered[kind]=null;}
  const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
  vm.runInContext('GodotIME=('+parts.ime+');GodotInput=('+parts.input+');move=('+parts.move+');wheel=('+parts.wheel+');',context,{timeout:1000});
  function imeInit(){sandbox.GodotIME.init((...args)=>imeCalls.push(args),(...args)=>keyCalls.push(args),100,200);}
  return {sandbox,context,listeners,calls,nativeCalls,imeCalls,keyCalls,registered,state,imeInit};
}

export function checkInputModels(original,corrected){
  const before=extract(original.toString()),after=extract(corrected.toString()),checks=[];
  function check(name,fn){fn();checks.push({name,pass:true});}
  const event={clientX:30,clientY:45,movementX:2,movementY:-3,shiftKey:true,altKey:false,ctrlKey:true,metaKey:false};
  check('original move is five arguments; corrected preserves route and first five',()=>{
    const a=model(before),b=model(after);a.sandbox.move(1);b.sandbox.move(1);
    assert.equal(a.listeners[0].event,'mousemove');assert.equal(b.listeners[0].event,'mousemove');
    a.listeners[0].callback(event);b.listeners[0].callback(event);
    assert.deepEqual(a.nativeCalls[0],[40,50,4,-6,5]);assert.deepEqual(b.nativeCalls[0],[40,50,4,-6,5,0]);
  });
  check('finite pressure preserved; missing or nonfinite pressure is explicit zero',()=>{
    const m=model(after);m.sandbox.move(1);
    for(const [value,expected] of [[undefined,0],[NaN,0],[Infinity,0],[0,0],[0.6,0.6]]){
      m.listeners[0].callback({...event,pressure:value});assert.equal(m.nativeCalls.at(-1)[5],expected);
    }
  });
  check('original wheel omits mode; corrected mode 0/1/2 and missing retain deltas',()=>{
    const a=model(before);a.sandbox.wheel(1);a.listeners[0].callback({deltaMode:1,deltaX:4,deltaY:-3,preventDefault(){}});assert.deepEqual(a.nativeCalls[0],[4,-3]);
    const m=model(after);m.sandbox.wheel(1);let prevented=0;
    for(const mode of [0,1,2,undefined,null]){m.listeners[0].callback({deltaMode:mode,deltaX:4,deltaY:-3,preventDefault(){prevented++;}});assert.deepEqual(m.nativeCalls.at(-1),[mode??0,4,-3]);}
    assert.equal(prevented,5);m.state.nativeResult=0;m.listeners[0].callback({deltaMode:0,preventDefault(){prevented++;}});assert.equal(prevented,5);assert.deepEqual(m.nativeCalls.at(-1),[0,0,0]);
  });
  check('original clear calls a missing method',()=>{const m=model(before);m.imeInit();assert.throws(()=>m.sandbox.GodotIME.clear(),/remove is not a function/);});
  check('clear before show and repeated clear do not call native hide',()=>{const m=model(after);m.imeInit();m.sandbox.GodotIME.clear();m.sandbox.GodotIME.clear();assert.equal(m.sandbox.GodotIME.ime,null);assert.equal(m.state.hideCount,0);});
  check('active clear unregisters identical callbacks before hide without committing text',()=>{
    const m=model(after);m.imeInit();m.sandbox.GodotIME.ime.show();const imeCount=m.imeCalls.length;m.sandbox.GodotIME.clear();
    assert.equal(m.sandbox.GodotIME.ime,null);assert.equal(m.sandbox.GodotIME.active,false);assert.equal(m.state.hideCount,1);
    assert.deepEqual(m.calls.filter(x=>x[0]==='off'||x[0]==='hide'),[['off','input',false],['off','confirm',false],['off','complete',false],['hide',false]]);
    assert.equal(m.keyCalls.length,0);assert.equal(m.imeCalls.length,imeCount);assert(Object.values(m.registered).every(x=>x===null));
  });
  check('synchronous stale complete during hide does not recurse or commit',()=>{
    const m=model(after);m.imeInit();m.sandbox.GodotIME.ime.show();m.state.completeOnHide=true;const imeCount=m.imeCalls.length;
    m.sandbox.GodotIME.clear();m.sandbox.GodotIME.clear();assert.equal(m.state.hideCount,1);assert.equal(m.keyCalls.length,0);assert.equal(m.imeCalls.length,imeCount);
  });
  check('existing normal text and confirm path still runs; this is not full IME equivalence',()=>{
    const m=model(after);m.imeInit();m.sandbox.GodotIME.ime.show();m.registered.input({value:'a'});assert(m.keyCalls.length>0);
    m.registered.confirm({value:'b'});assert.equal(m.sandbox.GodotIME.initialText,'b');assert.equal(m.sandbox.GodotIME.active,false);assert.equal(m.state.hideCount,1);
  });
  check('each unregister failure is latched; repeated clear/show/init cannot report successful cleanup',()=>{
    for(const kind of ['input','confirm','complete']){
      const m=model(after);m.imeInit();const owner=m.sandbox.GodotIME.ime;owner.show();m.state.offError=kind;
      assert.throws(()=>m.sandbox.GodotIME.clear(),/MODEL_OFF_FAILURE/);const count=m.calls.length;
      assert.throws(()=>m.sandbox.GodotIME.clear(),/MODEL_OFF_FAILURE/);assert.throws(()=>owner.show(),/MODEL_OFF_FAILURE/);assert.throws(()=>m.imeInit(),/MODEL_OFF_FAILURE/);
      assert.equal(m.sandbox.GodotIME.ime,owner);assert.equal(m.state.hideCount,0);assert.notEqual(m.registered[kind],null);assert.equal(m.calls.length,count);
    }
  });
  check('hide failure after unregister remains visible without a silent retry',()=>{
    const m=model(after);m.imeInit();const owner=m.sandbox.GodotIME.ime;owner.show();m.state.hideError=true;
    assert.throws(()=>m.sandbox.GodotIME.clear(),/MODEL_HIDE_FAILURE/);assert(Object.values(m.registered).every(x=>x===null));
    assert.throws(()=>m.sandbox.GodotIME.clear(),/MODEL_HIDE_FAILURE/);assert.equal(m.sandbox.GodotIME.ime,owner);assert.equal(m.state.hideCount,1);
  });
  check('queued input/confirm/complete from retired instance cannot change replacement input',()=>{
    const m=model(after);m.imeInit();m.sandbox.GodotIME.ime.show();const old={...m.registered};m.sandbox.GodotIME.clear();
    m.imeInit();m.sandbox.GodotIME.ime.show();const owner=m.sandbox.GodotIME.ime,keyCount=m.keyCalls.length,imeCount=m.imeCalls.length;
    for(const fn of Object.values(old))fn({value:'queued'});
    assert.equal(m.sandbox.GodotIME.ime,owner);assert.equal(m.sandbox.GodotIME.active,true);assert.equal(m.keyCalls.length,keyCount);assert.equal(m.imeCalls.length,imeCount);
  });
  check('reinitialization retires existing active callbacks before creating another instance',()=>{
    const m=model(after);m.imeInit();const previous=m.sandbox.GodotIME.ime;previous.show();m.imeInit();
    assert.notEqual(m.sandbox.GodotIME.ime,previous);assert.equal(m.state.hideCount,1);assert(Object.values(m.registered).every(x=>x===null));
  });
  return {parser:after.parser,checks};
}

export function auditWechatInput({source}){
  assert(source&&path.isAbsolute(source),'ABSOLUTE_SOURCE_REQUIRED');
  const git=args=>execFileSync('git',['--no-optional-locks','--no-replace-objects','-C',source,...args],{windowsHide:true,maxBuffer:256*1024}).toString().trim();
  assert.equal(git(['rev-parse','HEAD']),commit,'SOURCE_COMMIT_MISMATCH');
  const snapshot=Object.fromEntries(Object.entries(pins).map(([name,pin])=>{const bytes=regular(path.join(source,name));assert.deepEqual(identity(bytes),pin,'INPUT_PIN_MISMATCH:'+name);return [name,bytes];}));
  const original=snapshot[inputPath],patch=regular(new URL('./wechat-input-contract-v2.patch',import.meta.url)),corrected=replayInputCorrection(original,patch);
  const changed=Buffer.from(original);changed[0]^=1;assert.throws(()=>replayInputCorrection(changed,patch),/SOURCE_PIN_MISMATCH/);
  assert.throws(()=>replayInputCorrection(corrected,patch),/SOURCE_PIN_MISMATCH/);
  const checked=checkInputModels(original,corrected);
  for(const [name,bytes] of Object.entries(snapshot))assert(regular(path.join(source,name)).equals(bytes),'SOURCE_CHANGED_DURING_CHECK');
  assert.equal(git(['rev-parse','HEAD']),commit);
  return {schema:'wxslim-wechat-input-contract-check-v1',status:'PASS_TEXT_AND_MEMORY_MODEL_ONLY',sourceCommit:commit,
    inputs:Object.fromEntries(Object.entries(snapshot).map(([name,bytes])=>[name,identity(bytes)])),patch:identity(patch),proposedInput:identity(corrected),
    checks:[{name:'modified input rejected',pass:true},{name:'duplicate application rejected',pass:true},...checked.checks],parser:checked.parser,
    sourceWritten:false,buildStarted:false,engineFactoryCalled:false,phoneTested:false,
    limits:['Patch is against df3 input source; not a complete official-source port and not in the fixed build recipe.',
      'VM runs only exact extracted input helpers with fake event/keyboard APIs; no actual wx, canvas, compiler or WASM execution.',
      'Missing mouse pressure defaults to 0; absent wheel deltaMode defaults to pixel mode. No arbitrary invalid-mode conversion added.',
      'Unregister/hide exceptions are latched and propagate; this prevents false retry success, not recovery of the native keyboard. Full IME editing semantics and startup/show failures remain unaudited.',
      'No rendering, GLX library, source checkout, toolchain, generated JS/WASM/PCK or existing package was changed.']};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {assert.equal(process.argv.length,4,'usage: node engine/audit-wechat-input-contract.mjs --source <existing-fixed-checkout>');assert.equal(process.argv[2],'--source');console.log(JSON.stringify(auditWechatInput({source:process.argv[3]}),null,2));}
  catch(error){console.error(JSON.stringify({status:'FAILED',message:error.code==='ERR_ASSERTION'?error.message:'Input audit failed; retain local diagnostic',buildStarted:false}));process.exitCode=1;}
}
