// Replay + isolated actual-method models. No engine/WASM or real platform API.
// Explicit --fetch-fixed-audio reads only the already-approved official JS body.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import https from 'node:https';
import crypto from 'node:crypto';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
const meta=JSON.parse(fs.readFileSync(new URL('../engine/official-audio-lifecycle.json',import.meta.url),'utf8'));
const basis=JSON.parse(fs.readFileSync(new URL('../engine/official-audio-source.json',import.meta.url),'utf8'));
const patch=fs.readFileSync(new URL('../engine/official-audio-lifecycle.patch',import.meta.url));
const sourcePatch=fs.readFileSync(new URL('../engine/official-audio-source.patch',import.meta.url));
const path=meta.inputs[0].path;
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const box={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:box,exports:box.exports});
const parse=s=>box.exports.parse(s,{ecmaVersion:'latest'}),key=n=>n.key.name??n.key.value;
const canonical=n=>JSON.stringify(n,(k,v)=>['start','end','raw'].includes(k)?undefined:v);
function members(ast){const m=new Map();function add(list,p){for(const n of list){const name=p+'.'+key(n);m.set(name,n);if(n.value?.type==='ObjectExpression')add(n.value.properties,name);}}
  for(const n of ast.body){if(n.type==='ClassDeclaration')add(n.body.body,n.id.name);if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.init?.type==='ObjectExpression')add(d.init.properties,d.id.name);}return m;}
let source,output,map,baseMap;
if(process.argv.includes('--fetch-fixed-audio')){
  const bytes=await new Promise((resolve,reject)=>https.get(`https://raw.githubusercontent.com/godotengine/godot/${basis.baseCommit}/${path}`,r=>{if(r.statusCode!==200){r.resume();reject(Error('OFFICIAL_SOURCE_HTTP'));return;}const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve(Buffer.concat(chunks)));r.on('error',reject)}).on('error',reject));
  const official=basis.inputs.find(p=>p.path===path);assert.deepEqual(pin(bytes),{bytes:official.bytes,sha256:official.sha256});
  const part=sourcePatch.toString().split(/(?=^diff --git )/m).find(x=>x.startsWith('diff --git a/'+path+' '));
  source=replayUnifiedPatch(Buffer.from(part),()=>bytes).get(path).text;
  assert.deepEqual(pin(source),{bytes:meta.inputs[0].bytes,sha256:meta.inputs[0].sha256});
  output=replayUnifiedPatch(patch,()=>source).get(path).text;map=members(parse(output));baseMap=members(parse(source));
}else console.log('# NOT_RUN replay/models: --fetch-fixed-audio required; no implicit download');
const options={skip:!output};
const node=name=>map.get('_GodotAudio.$GodotAudio.'+name);
function fixture(){
  const calls=[],logs=[],requests=[],contexts=[];
  const context={Promise,Map,Set,Array,HEAPF32:new Float32Array(8),console:{error(){},log(){}},clearInterval(id){calls.push(['clear',id]);},GodotRuntime:{allocString(id){calls.push(['alloc',id]);return 7;},free(ptr){calls.push(['free',ptr]);},heapSub(){return [1,1,0,0,0,0,0,0];}},wx:{loadSubpackage(req){requests.push(req);},createInnerAudioContext(){const ctx=contexts.shift();assert(ctx);return ctx;}}};
  const values='({WX:'+output.slice(node('WX').value.start,node('WX').value.end)+',close_async:'+output.slice(node('close_async').value.start,node('close_async').value.end)+'})';
  const g=vm.runInNewContext(values,context);context.GodotAudio=g;g.isWeChat=()=>true;g.sampleFinishedCallback=()=>{calls.push(['finished']);};
  const w=g.WX,actualReleaseCache=w.releaseCache;for(const name of ['nativeStreams','activePlaybacks','subpackageLoads','busVolumes','busMutes','cacheRefs','cacheRecords'])w[name]=new Map();
  w.contextPool=[];w.cleanupErrorCount=0;w.error=(...args)=>logs.push(args[0]);w.acquireCache=()=>true;w.releaseCache=hash=>calls.push(['release',hash]);w.invalidateCacheRecord=hash=>calls.push(['invalidate',hash]);
  function ctx(){const handlers={},c={src:'',volume:1,playbackRate:1,startTime:0,autoplay:false,loop:false,handlers};
    for(const name of ['Canplay','Play','Pause','Stop','Ended','TimeUpdate','Error','Waiting','Seeking','Seeked']){c['on'+name]=fn=>{handlers[name]=fn;};c['off'+name]=()=>{calls.push(['off'+name,c]);delete handlers[name];};}
    c.play=()=>calls.push(['play',c]);c.stop=()=>calls.push(['stop',c]);c.destroy=()=>calls.push(['destroy',c]);return c;}
  function stream(id,subpackage='',kind='package'){w.nativeStreams.set(id,{kind,path:id+'.mp3',subpackage,hash:'hash',loopMode:'none'});}
  return {g,w,context,calls,logs,requests,contexts,ctx,stream,actualReleaseCache};
}
function close(g){return new Promise((resolve,reject)=>g.close_async(resolve,reject));}
test('bounded followup metadata preserves base and ABI/defaults',()=>{
  assert.deepEqual(pin(patch),{bytes:meta.patch.bytes,sha256:meta.patch.sha256});
  assert.deepEqual(pin(sourcePatch),{bytes:meta.dependsOn.bytes,sha256:meta.dependsOn.sha256});
  assert.equal(meta.inputs.length,1);assert.equal(meta.integrated,false);
  assert.equal(meta.unchanged.nativeABI,'viiiiiiiiii');assert.equal(meta.unchanged.defaultNativeMinSeconds,3);assert.equal(meta.unchanged.defaultCacheBytes,8388608);
});
test('followup output pin, strict reverse and duplicate rejection',options,()=>{
  assert.deepEqual(pin(output),{bytes:meta.outputs[0].bytes,sha256:meta.outputs[0].sha256});
  const reverse=patch.toString().split('\n').map(l=>{const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(l);if(h)return `@@ -${h[3]},${h[4]??1} +${h[1]},${h[2]??1} @@`;if(l.startsWith('--- ')||l.startsWith('+++ '))return l;return l.startsWith('+')?'-'+l.slice(1):l.startsWith('-')?'+'+l.slice(1):l;}).join('\n');
  assert.equal(replayUnifiedPatch(Buffer.from(reverse),()=>output).get(path).text,source);assert.throws(()=>replayUnifiedPatch(patch,()=>output));
});
test('non-WeChat original close body and every unrelated function remain AST-identical',options,()=>{
  const close=node('close_async').value.body.body[0];assert.equal(close.type,'IfStatement');
  assert.equal(canonical(close.consequent.body.slice(0,-1)),canonical(baseMap.get('_GodotAudio.$GodotAudio.close_async').value.body.body));
  const changed=new Set(meta.changedMethods);changed.add('_GodotAudio.$GodotAudio.WX.registerNativeStream');
  for(const [p,n]of baseMap){if(n.value?.type==='ObjectExpression'||changed.has(p))continue;assert.equal(canonical(map.get(p)),canonical(n),p);}
});
test('notify callback throws every primitive/original object but allocation always freed',options,()=>{
  for(const sentinel of [undefined,null,0,false,'',{sentinel:true},new Error('PRIVATE')]){
    const f=fixture();f.g.sampleFinishedCallback=()=>{throw sentinel;};assert.throws(()=>f.w.notifyFinished('p'),e=>Object.is(e,sentinel));
    assert.deepEqual(f.calls.map(c=>c[0]),['alloc','free']);
  }
});
test('free failure never masks callback exception and is recorded without private text',options,()=>{
  const f=fixture(),original={original:true};f.g.sampleFinishedCallback=()=>{throw original;};f.context.GodotRuntime.free=()=>{throw Error('PRIVATE_PATH');};
  assert.throws(()=>f.w.notifyFinished('p'),e=>e===original);assert.equal(f.w.cleanupErrorCount,1);
  const receipt=f.w.close();assert.equal(receipt.ok,false);assert(!JSON.stringify(receipt).includes('PRIVATE'));
});
test('normal package playback ends once; stale duplicate callbacks cannot finish twice',options,async()=>{
  const f=fixture(),c=f.ctx();f.contexts.push(c);f.stream('s');await f.w.startSample('p','s',0,0,1,0);
  const ended=c.handlers.Ended;ended();ended();assert.equal(f.calls.filter(c=>c[0]==='finished').length,1);assert.equal(f.w.activePlaybacks.size,0);
});
test('closed pending success/failure cannot create contexts, finish consumers or delete cache',options,async()=>{
  for(const failure of [false,true]){const f=fixture();f.stream('s','sub','cache');const p=f.w.startSample('p','s',0,0,1,0);assert.equal(f.requests.length,1);
    const receipt=f.w.close();assert.equal(receipt.ok,true);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.w.subpackageLoads.size,0);
    failure?f.requests[0].fail({errMsg:'PRIVATE'}):f.requests[0].success({});await p;
    assert.equal(f.calls.filter(c=>c[0]==='release').length,1);assert.equal(f.calls.filter(c=>c[0]==='finished').length,0);assert.equal(f.logs.length,0);
  }
});
test('reused playback ID rejects old subpackage failure and old same-context events',options,async()=>{
  const f=fixture();f.stream('old','sub');f.stream('new');const pending=f.w.startSample('p','old',0,0,1,0);
  const c=f.ctx();f.contexts.push(c);await f.w.startSample('p','new',0,0,1,0);const active=f.w.activePlaybacks.get('p');
  f.requests[0].fail({errMsg:'PRIVATE'});await pending;assert.equal(f.w.activePlaybacks.get('p'),active);assert.equal(f.logs.length,0);
  const oldEnded=c.handlers.Ended;oldEnded();f.contexts.push(c);await f.w.startSample('p','new',0,0,1,0);const second=f.w.activePlaybacks.get('p');oldEnded();assert.equal(f.w.activePlaybacks.get('p'),second);
});
test('stop before load invalidates pending playback and never plays late',options,async()=>{
  const f=fixture();f.stream('s','sub');const p=f.w.startSample('p','s',0,0,1,0);assert.equal(f.w.stopSample('p'),true);f.requests[0].success({});await p;assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.length,0);
});
test('synchronous onError callback exception is original rejection, not start/load failure',options,async()=>{
  for(const sentinel of [undefined,null,0,false,'',{original:true}]){const f=fixture(),c=f.ctx();f.contexts.push(c);f.stream('s');f.g.sampleFinishedCallback=()=>{throw sentinel;};c.play=()=>{c.handlers.Error({errMsg:'PRIVATE'});};
    await assert.rejects(f.w.startSample('p','s',0,0,1,0),e=>Object.is(e,sentinel));
    assert.equal(f.logs.length,1);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.filter(c=>c[0]==='free').length,1);
  }
});
test('platform swallowing or replacing callback throw still propagates first original through nested scopes',options,()=>{
  for(const sentinel of [undefined,null,0,false,'',{original:true}]){
    const f=fixture();let classified=0;f.g.sampleFinishedCallback=()=>{throw sentinel;};
    const failed=()=>{classified++;};
    assert.throws(()=>f.w.invokePlatform(()=>f.w.invokePlatform(()=>{try{f.w.notifyFinished('p');}catch(_){}throw Error('PLATFORM_REPLACEMENT');},failed),failed),e=>Object.is(e,sentinel));
    assert.equal(classified,0);assert.equal(f.w.callbackScope,null);assert.equal(f.calls.filter(c=>c[0]==='free').length,1);
  }
});
test('platform play throw keeps existing failure cleanup and one finished',options,async()=>{
  const f=fixture(),c=f.ctx();f.contexts.push(c);f.stream('s');c.play=()=>{throw Error('PRIVATE');};await f.w.startSample('p','s',0,0,1,0);
  assert.equal(f.logs.length,1);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.filter(c=>c[0]==='finished').length,1);assert.equal(f.calls.filter(c=>c[0]==='destroy').length,1);
});
test('actual subpackage failure cleans exact active and finishes once',options,async()=>{
  const f=fixture();f.stream('s','sub');const p=f.w.startSample('p','s',0,0,1,0);f.requests[0].fail({errMsg:'PRIVATE'});await p;assert.equal(f.logs.length,1);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.filter(c=>c[0]==='finished').length,1);
});
test('whole-engine invalidation precedes every off/stop/destroy and cleanup continues on failures',options,async()=>{
  const f=fixture(),a=f.ctx(),b=f.ctx();f.w.activePlaybacks.set('a',{ctx:a,hashRef:true,streamInfo:{hash:'h'},cancelled:false});f.w.contextPool.push(b);
  const order=[];a.offCanplay=()=>{assert.equal(f.w.closed,true);assert.equal(f.g.sampleFinishedCallback,null);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.w.contextPool.length,0);order.push('off');throw Error('PRIVATE');};a.stop=()=>{order.push('stop');throw Error('PRIVATE');};a.destroy=()=>{order.push('destroy');throw Error('PRIVATE');};
  const result=f.w.close();assert.equal(result.ok,false);assert.equal(result.errorCount,3);assert.deepEqual(order,['off','stop','destroy']);assert(f.calls.some(c=>c[0]==='destroy'&&c[1]===b));assert(f.calls.some(c=>c[0]==='offSeeked'&&c[1]===a));
  assert.equal(f.w.close(),result);assert.equal(order.length,3);await assert.rejects(close(f.g),/WXSLIM_AUDIO_CLOSE_INCOMPLETE/);
});
test('close_async is single-flight, includes native even without WebAudio and reports cleanup failure',options,async()=>{
  const f=fixture(),c=f.ctx();f.w.contextPool.push(c);let driver=0,web=0,done,entered;const started=new Promise(r=>{entered=r;});f.g.ctx={onstatechange(){throw Error('LATE');},close(){web++;assert.equal(this.onstatechange,null);entered();return new Promise(r=>{done=r;});}};f.g.driver={close(){driver++;return Promise.resolve();}};
  const a=close(f.g),b=close(f.g);await started;assert.equal(driver,1);assert.equal(web,1);done();await Promise.all([a,b]);assert.equal(f.calls.filter(x=>x[0]==='destroy').length,1);
  const z=fixture(),bad=z.ctx();bad.destroy=()=>{throw Error('PRIVATE');};z.w.contextPool.push(bad);await assert.rejects(close(z.g),/WXSLIM_AUDIO_CLOSE_INCOMPLETE/);
});
test('driver and WebAudio close failures still attempt remaining cleanup and reject fixed code',options,async()=>{
  const f=fixture(),calls=[];f.g.driver={close(){calls.push('driver');throw Error('PRIVATE');}};f.g.ctx={onstatechange(){},close(){calls.push('web');return Promise.reject(Error('PRIVATE'));}};
  await assert.rejects(close(f.g),e=>e.message==='WXSLIM_AUDIO_CLOSE_INCOMPLETE');assert.deepEqual(calls,['driver','web']);assert.equal(f.g.ctx,null);
});
test('reentrant close during native stop shares established close promise',options,async()=>{
  const f=fixture(),c=f.ctx();let again;f.w.contextPool.push(c);c.stop=()=>{again=close(f.g);};const first=close(f.g);await first;await again;assert.equal(f.calls.filter(c=>c[0]==='destroy').length,1);
});
test('saved late events after engine close do not log, allocate or notify dead consumer',options,async()=>{
  const f=fixture(),c=f.ctx();f.contexts.push(c);f.stream('s');await f.w.startSample('p','s',0,0,1,0);
  const events=[c.handlers.Ended,c.handlers.Stop,c.handlers.Error];await close(f.g);const before=f.calls.length;
  for(const event of events)event({errMsg:'PRIVATE'});assert.equal(f.calls.length,before);assert.equal(f.logs.length,0);assert.equal(f.g.sampleFinishedCallback,null);
});
test('ordinary browser executes original close path without any native close',options,async()=>{
  const f=fixture();let web=0;f.g.isWeChat=()=>false;f.g.ctx={close(){web++;return Promise.resolve();},onstatechange(){}};f.w.close=()=>{throw Error('MUST_NOT_ENTER_NATIVE');};
  await close(f.g);assert.equal(web,1);assert.equal(f.w.closed,false);
});
test('whole close releases actual invalid cache reference without unlink/index write; ordinary rule retained',options,()=>{
  const f=fixture(),calls=[];f.w.releaseCache=f.actualReleaseCache;f.w.invalidCacheHashes=new Set(['hash']);f.w.cacheRefs.set('hash',1);
  f.w.removeCacheRecord=()=>calls.push('remove');f.w.persistCacheIndex=()=>calls.push('index');
  f.w.activePlaybacks.set('p',{ctx:null,hashRef:true,streamInfo:{hash:'hash'},cancelled:false});
  assert.equal(f.w.close().ok,true);assert.equal(f.w.cacheRefs.has('hash'),false);assert.deepEqual(calls,[]);
  f.w.cacheRefs.set('hash',1);f.w.releaseCache('hash');assert.deepEqual(calls,['remove','index']);
});
test('setup off/setter/registration platform throws release exact reference and destroy once',options,async()=>{
  for(const failure of ['offCanplay','src','onEnded']){
    const f=fixture(),c=f.ctx();f.contexts.push(c);f.stream('s','','cache');
    if(failure==='src')Object.defineProperty(c,'src',{get(){return '';},set(){throw Error('PRIVATE');}});
    else c[failure]=()=>{throw Error('PRIVATE');};
    await f.w.startSample('p','s',0,0,1,0);
    assert.equal(f.w.activePlaybacks.size,0,failure);assert.equal(f.calls.filter(x=>x[0]==='release').length,1,failure);
    assert.equal(f.calls.filter(x=>x[0]==='destroy').length,1,failure);assert.equal(f.calls.filter(x=>x[0]==='finished').length,1,failure);
    assert.deepEqual(f.logs,['Playback setup failed']);
  }
});
test('getContext platform throw cleans active/cache and reports setup failure without pretending load failure',options,async()=>{
  const f=fixture();f.stream('s','','cache');f.context.wx.createInnerAudioContext=()=>{throw Error('PRIVATE');};await f.w.startSample('p','s',0,0,1,0);
  assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.filter(c=>c[0]==='release').length,1);assert.deepEqual(f.logs,['Playback setup failed']);
});
test('synchronous registration completion stops setup; callback throw remains original and freed',options,async()=>{
  for(const shouldThrow of [false,true]){const f=fixture(),c=f.ctx(),sentinel={original:true};f.contexts.push(c);f.stream('s','','cache');
    c.onEnded=fn=>fn();let later=0;c.onStop=()=>{later++;};c.onError=()=>{later++;};c.play=()=>{later++;};
    f.g.sampleFinishedCallback=()=>{if(shouldThrow)throw sentinel;};const promise=f.w.startSample('p','s',0,0,1,0);
    if(shouldThrow)await assert.rejects(promise,e=>e===sentinel);else await promise;
    assert.equal(later,0);assert.equal(f.logs.length,0);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.filter(c=>c[0]==='release').length,1);assert.equal(f.calls.filter(c=>c[0]==='free').length,1);
  }
});
test('close while acquiring context destroys context absent from close snapshot and never plays',options,async()=>{
  const f=fixture(),c=f.ctx();f.stream('s','','cache');f.context.wx.createInnerAudioContext=()=>{f.w.close();return c;};await f.w.startSample('p','s',0,0,1,0);
  assert.equal(f.w.closed,true);assert.equal(f.w.activePlaybacks.size,0);assert.equal(f.calls.filter(c=>c[0]==='destroy').length,1);assert.equal(f.calls.filter(c=>c[0]==='release').length,1);assert.equal(f.calls.filter(c=>c[0]==='play').length,0);
});
test('releaseContext reset reentering close cannot repool closed context',options,()=>{
  for(const trigger of ['offCanplay','autoplay']){const f=fixture(),c=f.ctx();let entered=false;
    const reenter=()=>{if(!entered){entered=true;f.w.close();}};
    if(trigger==='autoplay')Object.defineProperty(c,'autoplay',{set:reenter});else c.offCanplay=reenter;
    f.w.releaseContext(c);assert.equal(f.w.closed,true);assert.equal(f.w.contextPool.length,0);assert.equal(f.calls.filter(x=>x[0]==='destroy').length,1);
  }
});
test('async exception boundary remains internal rejection, no ABI propagation claim',()=>{
  assert.equal(meta.asyncExceptionBoundary.fullyClosed,false);assert.equal(meta.asyncExceptionBoundary.newExternalErrorChannel,false);assert.equal(meta.asyncExceptionBoundary.platformObservability,'NOT_RUN_NOT_PROVEN');
});
