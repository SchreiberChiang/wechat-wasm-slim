import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {instrumentPresentationEngine} from '../examples/glx-smoke/presentation-engine.mjs';

const source = fs.readFileSync(new URL('../examples/glx-smoke/presentation-probe.js', import.meta.url), 'utf8');
function harness({readTarget = null, pack = null, lost = false, throwQuery = false, pixelsUnwritten = false, markBeforeEngine = false} = {}) {
  let now = 0, id = 0;
  const timers = new Map(), calls = [], logs = [];
  const originalMark = function () { calls.push(['mark', this, ...arguments]); return 73; };
  const root = {__WXSLIM_RENDER_CONFIG__: {packageVersion: 'wxslim-12345678901234567890'}, __WXSLIM_TIMING__: {mark: originalMark}};
  const params = new Map([[0x8CA6, null], [0x8CAA, readTarget], [0x88ED, pack], [0x0BA2, [0,0,1206,2622]], [0x0C10, [0,0,1206,2622]], [0x0C11, false], [0x0C23, [true,true,true,true]], [0x0C02, 0x405], [0x0D05, 4], [0x0D02, 0], [0x0D03, 0], [0x0D04, 0]]);
  const gl = {
    emscriptenGLX: {}, drawingBufferWidth: 1206, drawingBufferHeight: 2622,
    isContextLost() { calls.push(['lost']); return lost; },
    getParameter(p) { calls.push(['get', p]); if (throwQuery) throw Error('PRIVATE_NATIVE_ERROR'); return params.get(p); },
    checkFramebufferStatus(target) { calls.push(['status', target]); return 0x8CD5; },
    getContextAttributes() { return {alpha: false, antialias: false, preserveDrawingBuffer: false}; },
    readPixels(x,y,w,h,format,type,bytes) { calls.push(['pixels',x,y,w,h]); if (!pixelsUnwritten) bytes.set([2,4,6,255]); },
  };
  for (const forbidden of ['bindFramebuffer', 'pixelStorei', 'clear', 'flush', 'finish', 'getError', 'getContext']) gl[forbidden] = () => assert.fail('Unexpected mutation/query: ' + forbidden);
  const frame = {batchAsync(owner, view) { return owner.batchRenderAsync(view); }, swap(owner) { return owner.swapWindow(); }};
  const ctx = vm.createContext({GameGlobal: root, GLctx: gl, __WXSLIM_FRAME_PROBE__: frame, Uint8Array,
    Date: {now: () => now}, console: {warn(s) { assert.ok(s.length < 4096); logs.push(JSON.parse(s.slice(s.indexOf('{')))); }},
    setTimeout(fn, ms) { timers.set(++id, {fn, at: now + ms}); return id; }, clearTimeout(key) { timers.delete(key); }});
  vm.runInContext(fs.readFileSync(new URL('../examples/glx-smoke/presentation-loader.js', import.meta.url), 'utf8'), ctx);
  if (markBeforeEngine) root.__WXSLIM_TIMING__.mark('loader_start_ok');
  vm.runInContext(source, ctx);
  const probe = vm.runInContext('__WXSLIM_PRESENTATION_PROBE__', ctx);
  function advance(ms) {
    const until = now + ms;
    for (let n = 0; n < 10; n++) {
      const entry = [...timers.entries()].filter(([,t]) => t.at <= until).sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = until;
  }
  return {probe, root, gl, params, calls, logs, timers, advance, originalMark, jump(ms) { now += ms; }};
}

test('presentation queries run only around two original swaps; native receiver/arguments/result survive', () => {
  const h = harness(), token = {}, view = new Uint32Array(8);
  const owner = {batchRenderAsync(v) { assert.equal(this, owner); assert.equal(v, view); return token; }, swapWindow() { assert.equal(this, owner); h.calls.push(['native_swap']); return token; }};
  assert.equal(h.probe.batch(owner, view, 4), token);
  assert.equal(h.probe.swap(owner), token); assert.equal(h.calls.filter(c=>c[0]==='pixels').length, 0);
  assert.equal(h.root.__WXSLIM_TIMING__.mark('loader_start_ok'), 73);
  h.advance(4000); h.calls.length=0;
  assert.equal(h.probe.swap(owner), token);
  assert.equal(h.calls.filter(c=>c[0]==='native_swap').length, 1);
  const swapIndex=h.calls.findIndex(c=>c[0]==='native_swap');
  assert.equal(h.calls.slice(0,swapIndex).filter(c=>c[0]==='pixels').length,1);
  assert.equal(h.calls.slice(swapIndex+1).filter(c=>c[0]==='pixels').length,1);
  assert.equal(h.logs[0].before.pixels.nonblackPoints,1);
  assert.equal(h.logs[0].loader.resolved,true);
  assert.deepEqual(h.logs[0].submission,{batches:1,bytes:32,declaredDraws:4,swaps:2});
  h.advance(5000); h.probe.swap(owner); h.advance(60000); h.probe.swap(owner);
  assert.equal(h.logs.length,2); assert.equal(h.timers.size,0);
  assert.equal(h.root.__WXSLIM_TIMING__.mark,h.originalMark);
});

for (const [label, options, reason] of [
  ['pixel pack buffer', {pack:{privateId:'PRIVATE_OBJECT'}}, 'pack_state_not_default'],
]) test('never rebinds ' + label + ' to obtain a pixel sample',()=>{
  const h=harness(options); h.advance(4000); h.probe.swap({swapWindow(){}});
  assert.equal(h.logs[0].before.pixels.skipped,reason);
  assert.equal(h.calls.some(c=>c[0]==='pixels'),false);
  assert.ok(!JSON.stringify(h.logs).includes('PRIVATE_OBJECT'));
});

test('lost contexts and query exceptions cannot suppress or duplicate the original swap',()=>{
  for(const options of [{lost:true},{throwQuery:true}]) {
    const h=harness(options);let swaps=0;h.advance(4000);h.probe.swap({swapWindow(){swaps++;}});
    assert.equal(swaps,1);assert.ok(!JSON.stringify(h.logs).includes('PRIVATE_NATIVE_ERROR'));
  }
});
test('native swap exception identity is preserved and not uploaded',()=>{
  const h=harness(),error=Error('PRIVATE_NATIVE_ERROR');h.advance(4000);
  assert.throws(()=>h.probe.swap({swapWindow(){throw error;}}),e=>e===error);
  assert.equal(h.logs[0].originalSwap,'threw');assert.ok(!JSON.stringify(h.logs).includes(error.message));
});
test('no-swap windows and delayed background timers end without GPU queries or extra frames',()=>{
  const h=harness();h.advance(60000);
  assert.equal(h.logs.length,2);assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
  assert.equal(h.root.__WXSLIM_TIMING__.mark,h.originalMark);
  const late=harness();late.advance(4000);late.jump(20000);let swaps=0;late.probe.swap({swapWindow(){swaps++;}});
  assert.equal(swaps,1);assert.equal(late.calls.length,0);assert.equal(late.logs[0].skipped,'no_swap_before_deadline');
});
test('unwritten pixel sentinels remain explicit, not certified black or successful readback',()=>{
  const h=harness({pixelsUnwritten:true});h.advance(4000);h.probe.swap({swapWindow(){}});
  assert.equal(h.logs[0].before.pixels.unchangedSentinels,1);
  assert.equal(h.logs[0].limits.visiblePixels,'not_verified');
});
test('instrumentation preserves the normal render-observer anchor and rejects repeated instrumentation',()=>{
  const fixture='var MainLoop={};var GLctx;var Module={};Module["_glxCommandBufferFlush"]=function(){};function wxGLXGetRoot(){};installWXGLXPatches();function loop(func,fps,simulateInfiniteLoop){var iterFunc=getWasmTableEntry(func);setMainLoop(iterFunc,fps,simulateInfiniteLoop)}function flush(){Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();});}function batch(view,drawcall){Module.wxContextGlobal.batchRenderAsync(view);Module.wxContextGlobal.swapWindow();}';
  const result=instrumentPresentationEngine(fixture);
  assert.doesNotThrow(()=>new vm.Script(result));
  assert.equal(result.split('installWXGLXPatches();').length,2);
  assert.ok(result.includes('__WXSLIM_PRESENTATION_PROBE__.batch(Module.wxContextGlobal,view,drawcall)'));
  assert.throws(()=>instrumentPresentationEngine(result));
});

test('early loader mark is captured before engine factory and native numeric bindings stay private',()=>{
  const h=harness({markBeforeEngine:true,readTarget:987654321,pack:0});
  h.params.set(0x8CA6,987654321);h.params.set(0x0C02,0x8CE0);h.params.set(0x0C11,1);
  h.advance(4000);h.probe.swap({swapWindow(){}});
  assert.equal(h.logs[0].loader.resolved,true);assert.equal(h.logs[0].loader.outcome,'mark_returned');
  assert.equal(h.logs[0].before.readFramebuffer,'native_nonzero');assert.equal(h.logs[0].before.packBuffer,'native_zero');
  assert.equal(h.logs[0].before.scissorEnabled,true);assert.equal(h.logs[0].before.pixels.readCallsReturned,1);
  assert.ok(!JSON.stringify(h.logs).includes('987654321'));
  assert.ok(h.calls.filter(c=>c[0]==='pixels').every(c=>c[1]===0&&c[2]===0));
});

test('unrecognized bindings retain precise shapes without logging handles or guessing default buffers',()=>{
  for(const [value,type,classification] of [[undefined,'undefined','undefined_unobservable'],[-1,'number','negative_integer'],[false,'boolean','boolean_false'],['','string','string']]){
    const h=harness();h.params.set(0x8CAA,value);h.gl.READ_FRAMEBUFFER_BINDING=0x8CAA;h.advance(4000);h.probe.swap({swapWindow(){}});
    assert.equal(h.logs[0].before.bindingShapes.read.type,type);assert.equal(h.logs[0].before.bindingShapes.read.classification,classification);
    assert.equal(h.logs[0].before.bindingShapes.read.constant,'matches');assert.ok(h.logs[0].before.pixels.skipped.startsWith('read_binding_'));
  }
});
