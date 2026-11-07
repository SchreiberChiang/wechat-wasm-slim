// Source replay and isolated method models; never execute an engine or WASM.
// Explicit --fetch-fixed-three reuses three approved official files in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
const meta=JSON.parse(fs.readFileSync(new URL('../engine/official-audio-source.json',import.meta.url),'utf8'));
const patch=fs.readFileSync(new URL('../engine/official-audio-source.patch',import.meta.url));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const box={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:box,exports:box.exports});
const parse=s=>box.exports.parse(s,{ecmaVersion:'latest'});
const canonical=n=>JSON.stringify(n,(k,v)=>['start','end','raw'].includes(k)?undefined:v);
const key=n=>n.key.name??n.key.value;
function inventory(ast){
  const map=new Map();
  function members(nodes,parent){for(const n of nodes){const path=parent+'.'+key(n);assert(!map.has(path));map.set(path,n);if(n.type==='Property'&&n.value.type==='ObjectExpression')members(n.value.properties,path);}}
  for(const n of ast.body){if(n.type==='ClassDeclaration')members(n.body.body,n.id.name);else if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.init?.type==='ObjectExpression')members(d.init.properties,d.id.name);}
  return map;
}
function projectCpp(text,enabled){
  let active=true,inOwn=false,out='';
  for(const line of text.split(/(?<=\n)/)){
    if(line==='#ifdef WECHAT_GLX_EXPERIMENTAL\n'){assert(!inOwn);inOwn=true;active=enabled;continue;}
    if(inOwn&&line==='#else\n'){active=!enabled;continue;}
    if(inOwn&&line==='#endif // WECHAT_GLX_EXPERIMENTAL\n'){inOwn=false;active=true;continue;}
    if(active)out+=line;
  }
  assert(!inOwn);return out;
}
function reverse(text){return text.split('\n').map(l=>{
  const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(l);
  if(h)return `@@ -${h[3]},${h[4]??1} +${h[1]},${h[2]??1} @@`;
  if(l.startsWith('--- ')||l.startsWith('+++ '))return l;
  return l.startsWith('+')?'-'+l.slice(1):l.startsWith('-')?'+'+l.slice(1):l;
}).join('\n');}
test('metadata pins bounded three-file candidate and explicit unfinished lifecycle',()=>{
  assert.equal(meta.schema,'wxslim-official-audio-source-v1');assert.equal(meta.inputs.length,3);
  assert.deepEqual(pin(patch),{bytes:meta.patch.bytes,sha256:meta.patch.sha256});
  assert.equal(meta.status,'SOURCE_ONLY_LIFECYCLE_NOT_CLOSED');assert.equal(meta.integrated,false);
  assert.equal(meta.selection.jsPreprocessorMacro,false);assert.equal(meta.selection.SCsubChanged,false);
  assert.equal(meta.unchangedContract.defaultCacheBytes,8388608);assert.equal(meta.unchangedContract.defaultNativeSampleMinSeconds,3);
  assert(meta.blockingFollowups.some(s=>s.includes('notifyFinished')));
});
test('patch scope excludes helper/worker/other runtime libraries and JS preprocessor macro',()=>{
  const names=[...patch.toString().matchAll(/^diff --git a\/(\S+) b\/\S+$/gm)].map(m=>m[1]);
  assert.deepEqual(names,meta.inputs.map(x=>x.path));
  const js=patch.toString().split('diff --git a/platform/web/js/libs/library_godot_audio.js')[1];
  assert(!/^\+#(?:if|ifdef)/m.test(js));
});
let sources=null,derived=null,sourceJS,outputJS,originals,targets;
if(process.argv.includes('--fetch-fixed-three')){
  sources=new Map();
  for(const item of meta.inputs){const b=await new Promise((resolve,reject)=>https.get(`https://raw.githubusercontent.com/godotengine/godot/${meta.baseCommit}/${item.path}`,r=>{
    if(r.statusCode!==200){r.resume();reject(Error('OFFICIAL_SOURCE_HTTP'));return;}const chunks=[];
    r.on('data',b=>chunks.push(b));r.on('end',()=>resolve(Buffer.concat(chunks)));r.on('error',reject);
  }).on('error',reject));assert.deepEqual(pin(b),{bytes:item.bytes,sha256:item.sha256});sources.set(item.path,b.toString());}
  derived=replayUnifiedPatch(patch,p=>sources.get(p));sourceJS=sources.get(meta.inputs[2].path);outputJS=derived.get(meta.inputs[2].path).text;
  originals=inventory(parse(sourceJS));targets=inventory(parse(outputJS));
}else console.log('# NOT_RUN full source replay/models: explicit --fetch-fixed-three required; no implicit download');
const replayOptions={skip:!sources};
test('fixed official forward/reverse replay and duplicate rejection',replayOptions,()=>{
  for(const item of meta.outputs)assert.deepEqual(pin(derived.get(item.path).text),{bytes:item.bytes,sha256:item.sha256});
  const back=replayUnifiedPatch(Buffer.from(reverse(patch.toString())),p=>derived.get(p)?.text);
  for(const [p,s]of sources)assert.equal(back.get(p).text,s);
  assert.throws(()=>replayUnifiedPatch(patch,p=>derived.get(p)?.text));
  assert.throws(()=>replayUnifiedPatch(patch,p=>p===meta.inputs[0].path?sources.get(p).replace('#include "core/config/engine.h"','#include "WRONG.h"'):sources.get(p)));
});
test('C++ macro off exactly reproduces all official bytes; macro on retains fork SHA/native/ABI',replayOptions,()=>{
  for(const item of meta.inputs.slice(0,2))assert.equal(projectCpp(derived.get(item.path).text,false),sources.get(item.path));
  const cpp=projectCpp(derived.get(meta.inputs[0].path).text,true),h=projectCpp(derived.get(meta.inputs[1].path).text,true);
  assert(cpp.includes('CryptoCore::SHA256Context'));assert(cpp.includes('godot_audio_sample_register_native_stream('));
  for(const name of ['godot_audio_wechat_is_available','godot_audio_wechat_get_native_audio_min_duration','godot_audio_wechat_can_cache_pcm','godot_audio_sample_register_native_stream'])assert(h.includes(name+'('));
});
test('every changed original function preserves its entire non-WeChat body and parameters',replayOptions,()=>{
  let checked=0;
  for(const unit of meta.jsUnits){const a=originals.get(unit.path),b=targets.get(unit.path);assert(b,unit.path);
    if(unit.kind==='function'){
      assert.equal(canonical(a.value.params),canonical(b.value.params));
      const first=b.value.body.body[0];assert.equal(first.type,'IfStatement');
      assert.equal(outputJS.slice(first.test.start,first.test.end),'!GodotAudio.isWeChat()');
      assert.equal(canonical(first.consequent.body.slice(0,-1)),canonical(a.value.body.body),unit.path);
      assert.equal(first.consequent.body.at(-1).type,'ReturnStatement');assert.equal(first.consequent.body.at(-1).argument,null);checked++;
    }else if(unit.kind==='retained-official-member-omitted-by-fork')assert.equal(canonical(a),canonical(b));
  }
  assert(checked>25);
});
test('unmodified official methods/properties and all original 34 signatures remain semantic equals',replayOptions,()=>{
  const changed=new Set(meta.jsUnits.filter(u=>u.kind==='function').map(u=>u.path));let signatures=0;
  for(const [path,a]of originals){const b=targets.get(path);assert(b,path);
    if(a.value?.type==='ObjectExpression'||changed.has(path))continue;
    assert.equal(canonical(a),canonical(b),path);
    if(path.endsWith('__sig'))signatures++;
  }
  assert.equal(signatures,34);
  assert.equal(targets.get('_GodotAudio.godot_audio_sample_register_native_stream__sig').value.value,'viiiiiiiiii');
});
test('optional df3 body provenance and whole-byte C++ macro-on identity',{
  skip:!sources||!process.env.WXSLIM_AUDIO_DF3_ROOT,
},()=>{
  const forkSources=new Map(meta.forkInputs.map(p=>{const b=execFileSync('git',['-C',process.env.WXSLIM_AUDIO_DF3_ROOT,'show',meta.derivationCommit+':'+p.path]);assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256});return[p.path,b.toString()];}));
  for(const item of meta.inputs.slice(0,2))assert.equal(projectCpp(derived.get(item.path).text,true),forkSources.get(item.path));
  let fork=forkSources.get(meta.inputs[2].path).replaceAll('typeof wx !== "undefined"','GodotAudio.isWeChat()').replaceAll('typeof wx === "undefined"','!GodotAudio.isWeChat()').replace('const ctx = GODOTSDK.audio.WEBAudio.audioContext;','const ctx = GodotAudio.getWeChatContext();');
  let map=inventory(parse(fork));const body=map.get('_GodotAudio.godot_audio_is_available').value.body;
  fork=fork.slice(0,body.start+1)+'\nGodotAudio.getWeChatContext();'+fork.slice(body.start+1);map=inventory(parse(fork));
  for(const unit of meta.jsUnits){if(unit.kind.startsWith('retained-'))continue;const got=targets.get(unit.path),want=map.get(unit.path);assert(want,unit.path);
    if(unit.kind==='function')assert.equal(canonical(got.value.body.body.slice(1)),canonical(want.value.body.body),unit.path);
    else assert.equal(canonical(got),canonical(want),unit.path);
  }
});
function model(paths,context){
  const fields=paths.map(([name,path])=>name+':'+outputJS.slice(targets.get(path).value.start,targets.get(path).value.end)).join(',');
  return vm.runInNewContext('({'+fields+'})',context);
}
test('platform gate only inspects properties; ordinary webpage wx object stays browser',replayOptions,()=>{
  let calls=0;const context={wx:{getSystemInfoSync(){calls++;throw Error('MUST_NOT_CALL');}}};
  const m=model([['isWeChat','_GodotAudio.$GodotAudio.isWeChat']],context);
  assert.equal(m.isWeChat(),false);context.GameGlobal={};assert.equal(m.isWeChat(),true);assert.equal(calls,0);
  context.wx={};assert.equal(m.isWeChat(),false);context.GameGlobal=null;assert.equal(m.isWeChat(),false);
});
test('WeChat requires owned host context and concrete methods; never browser fallback',replayOptions,()=>{
  const context={GameGlobal:{},wx:{getSystemInfoSync(){throw Error('NO_QUERY');}},GodotAudio:null};
  const m=model([['isWeChat','_GodotAudio.$GodotAudio.isWeChat'],['getWeChatContext','_GodotAudio.$GodotAudio.getWeChatContext'],['available','_GodotAudio.godot_audio_is_available']],context);context.GodotAudio=m;
  assert.throws(()=>m.available(),/WXSLIM_WECHAT_AUDIO_CONTEXT_REQUIRED/);
  const ctx={destination:{},sampleRate:48000};for(const method of ['createGain','createBuffer','createBufferSource','createScriptProcessor','resume','close'])ctx[method]=()=>{};
  context.GameGlobal.GODOTSDK={audio:{WEBAudio:{audioContext:ctx}}};assert.equal(m.available(),1);assert.equal(m.getWeChatContext(),ctx);
  delete ctx.createScriptProcessor;assert.throws(()=>m.available(),/WXSLIM_WECHAT_AUDIO_CONTEXT_REQUIRED/);
});
test('browser availability/worklet/ScriptProcessor follow exact original behavior',replayOptions,()=>{
  const context={window:{},wx:{},GodotAudio:{isWeChat:()=>false,ctx:{}}};
  const m=model([['available','_GodotAudio.godot_audio_is_available'],['worklet','_GodotAudio.godot_audio_has_worklet'],['script','_GodotAudio.godot_audio_has_script_processor']],context);
  assert.equal(m.available(),0);context.window.AudioContext=function(){};assert.equal(m.available(),1);
  assert.equal(m.worklet(),0);context.GodotAudio.ctx.audioWorklet={};assert.equal(m.worklet(),1);
  assert.equal(m.script(),0);context.GodotAudio.ctx.createScriptProcessor=()=>{};assert.equal(m.script(),1);
});
test('native stop invalidates first, releases reference and destroys rather than pools context',replayOptions,()=>{
  const active=new Map(),calls=[];const wxState={activePlaybacks:active,releaseCache(hash){calls.push(['release',hash]);assert(!active.has('p'));},destroyContext(ctx){calls.push(['destroy',ctx]);assert(!active.has('p'));}};
  const context={GodotAudio:{WX:wxState}};const m=model([['stop','_GodotAudio.$GodotAudio.WX.stopSample']],context);
  const ctx={},playback={ctx,hashRef:true,streamInfo:{hash:'hash'},cancelled:false};active.set('p',playback);
  assert.equal(m.stop('p'),true);assert.equal(playback.cancelled,true);assert.equal(playback.hashRef,false);assert.equal(m.stop('p'),false);
  assert.deepEqual(calls,[['release','hash'],['destroy',ctx]]);
});
test('known lifecycle defect remains a blocking negative control, not a false fixed claim',replayOptions,()=>{
  const sentinel={sentinel:true},calls=[];const context={GodotAudio:{sampleFinishedCallback(){throw sentinel;}},GodotRuntime:{allocString(){calls.push('alloc');return 12;},free(){calls.push('free');}}};
  const m=model([['finished','_GodotAudio.$GodotAudio.WX.notifyFinished']],context);
  assert.throws(()=>m.finished('p'),e=>e===sentinel);assert.deepEqual(calls,['alloc']);
  const close=targets.get('_GodotAudio.$GodotAudio.close_async');assert(!outputJS.slice(close.start,close.end).includes('activePlaybacks'));
  assert.equal(meta.status,'SOURCE_ONLY_LIFECYCLE_NOT_CLOSED');
});
