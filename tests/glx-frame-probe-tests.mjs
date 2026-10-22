// Offline VM contracts only. These tests do not demonstrate phone rendering or GLX recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {instrumentDiagnosticEngine} from '../examples/glx-smoke/diagnostic-engine.mjs';
import {instrumentRender} from '../convert/lib/render.mjs';

const probeSource = fs.readFileSync(new URL('../examples/glx-smoke/frame-probe.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const anchors = [
  'installWXGLXPatches();',
  'var iterFunc=getWasmTableEntry(func);setMainLoop(iterFunc,fps,simulateInfiniteLoop)',
  'Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();})',
  'Module.wxContextGlobal.batchRenderAsync(view);',
  'Module.wxContextGlobal.swapWindow()',
];
const engineFixture = [
  'var Module={}; var MainLoop={};',
  'Module["_glxCommandBufferFlush"]=function(){};',
  'function installWXGLXPatches(){}',
  anchors[0],
  'function registerLoop(func,fps,simulateInfiniteLoop){' + anchors[1] + ';}',
  'function registerFlush(){return ' + anchors[2] + ';}',
  'function submit(view){' + anchors[3] + 'return ' + anchors[4] + ';}',
  'var GLctx; function wxGLXHasNativeBindings(){} function wxGLXCallNative(){}',
  'function wxGLXGetNativeExport(){} function wxGLXGetRoot(){}',
].join('\n');

function harness({diagnosticThrows = false, unpairedListeners = false} = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), logs = [], forbiddenCalls = [], listenerCalls = [];
  const wxListeners = {hide: new Set(), show: new Set()};
  const canvasListeners = new Map();
  const forbidden = name => (...args) => { forbiddenCalls.push({name, count: args.length}); throw Error('Unexpected external call: ' + name); };
  const wx = {
    onHide(fn) { listenerCalls.push(['onHide', fn]); wxListeners.hide.add(fn); },
    onShow(fn) { listenerCalls.push(['onShow', fn]); wxListeners.show.add(fn); },
    offHide(fn) { listenerCalls.push(['offHide', fn]); assert.equal(wxListeners.hide.delete(fn), true); },
    offShow(fn) { listenerCalls.push(['offShow', fn]); assert.equal(wxListeners.show.delete(fn), true); },
    request: forbidden('wx.request'), uploadFile: forbidden('wx.uploadFile'), createCanvas: forbidden('wx.createCanvas'),
    setStorage: forbidden('wx.setStorage'), setStorageSync: forbidden('wx.setStorageSync'),
    getSystemInfoSync: forbidden('wx.getSystemInfoSync'),
  };
  if (unpairedListeners) { delete wx.offHide; delete wx.offShow; }
  const canvas = {
    width: 720, height: 1280,
    addEventListener(name, fn) { if (!canvasListeners.has(name)) canvasListeners.set(name, new Set()); canvasListeners.get(name).add(fn); listenerCalls.push(['canvas.add:' + name, fn]); },
    removeEventListener(name, fn) { assert.equal(canvasListeners.get(name)?.delete(fn), true); listenerCalls.push(['canvas.remove:' + name, fn]); },
    getContext: forbidden('canvas.getContext'),
  };
  if (unpairedListeners) delete canvas.removeEventListener;
  const nativeContext = {ctxid: 987654321, isWebGL2: true};
  const module = {canvas, wxContextGlobal: nativeContext};
  const root = {
    wx, canvas,
    __WXSLIM_RENDER_CONFIG__: {packageVersion: 'wxslim-probe-vm', requestedMode: 'glx'},
    __WXSLIM_BOOT_STATE__: {stage: 'MAIN_RETURNED', factoryCalls: 1, mainCalls: 1, error: 'PRIVATE_EXCEPTION_SENTINEL'},
    __WXSLIM_ENTRY_STATE__: {requests: 2, nativeFactoryCalls: 1, reusedRequests: 1, status: 'FULFILLED', error: 'PRIVATE_EXCEPTION_SENTINEL'},
    __WXSLIM_RESOURCE_STATE__: {stage: 'VALIDATED_FOR_GODOT_MOUNT', accepted: true, error: 'PRIVATE_EXCEPTION_SENTINEL'},
    __WXSLIM_RENDER_DIAGNOSTIC__: {read() {
      if (diagnosticThrows) throw Error('PRIVATE_EXCEPTION_SENTINEL');
      return {packageVersion: 'wxslim-probe-vm', requestedMode: 'glx', initialization: 'initialized', failureReason: {code: 'VM_ONLY', message: 'PRIVATE_EXCEPTION_SENTINEL'}, actualContext: {mode: 'glx', webgl2: true}, moduleContextMatches: true, observationStatus: 'available'};
    }},
  };
  const context = vm.createContext({
    GameGlobal: root, wx, Module: module, GLctx: {emscriptenGLX: nativeContext}, GL: {currentContext: {GLctx: null}},
    MainLoop: {currentFrameNumber: 1, running: true, func() {}}, ABORT: false,
    Date: class FakeDate extends Date { static now() { return now; } },
    console: {warn(...args) { logs.push(args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); }},
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, at: now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval: forbidden('setInterval'), requestAnimationFrame: forbidden('requestAnimationFrame'),
    fetch: forbidden('fetch'), WebGLRenderingContext: forbidden('WebGLRenderingContext'),
  });
  vm.runInContext(probeSource, context, {filename: 'frame-probe.js'});
  const probe = vm.runInContext('__WXSLIM_FRAME_PROBE__', context);
  function advance(milliseconds) {
    const until = now + milliseconds;
    for (let iterations = 0; ; iterations++) {
      assert.ok(iterations < 20, 'probe must not create an unbounded timer loop');
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = until;
  }
  return {probe, root, context, module, canvas, logs, timers, forbiddenCalls, listenerCalls, wxListeners, canvasListeners, advance, jumpWithoutTimers(milliseconds) { now += milliseconds; }};
}

test('instrumentation requires each exact engine anchor once and rejects repeated instrumentation', () => {
  const result = instrumentDiagnosticEngine(engineFixture);
  assert.equal(typeof result, 'string');
  assert.doesNotThrow(() => new vm.Script(result));
  assert.throws(() => instrumentDiagnosticEngine(result));
  for (const anchor of anchors) {
    assert.throws(() => instrumentDiagnosticEngine(engineFixture.replace(anchor, '/* anchor removed */')), 'missing ' + anchor);
    assert.throws(() => instrumentDiagnosticEngine(engineFixture + '\n' + anchor), 'duplicate ' + anchor);
  }
});

test('instrumented engine preserves the converter observer anchor and remains syntactically convertible', () => {
  const result = instrumentRender(instrumentDiagnosticEngine(engineFixture));
  assert.equal(result.split('installWXGLXPatches();').length - 1, 1);
  assert.match(result, /WXSLIM_RENDER_OBSERVER_V1/);
  assert.doesNotThrow(() => new vm.Script(result));
});

test('loop wrapper forwards receiver, argument identity, return and original exception exactly once', () => {
  const h = harness(), receiver = {}, arg = {private: 'PRIVATE_BUFFER_SENTINEL'}, returned = {};
  let calls = 0;
  const wrapped = h.probe.wrapLoop(function (value) { calls++; assert.equal(this, receiver); assert.equal(value, arg); return returned; });
  assert.equal(calls, 0);
  assert.equal(wrapped.call(receiver, arg), returned);
  assert.equal(calls, 1);
  const originalError = Error('PRIVATE_EXCEPTION_SENTINEL');
  const throwing = h.probe.wrapLoop(function () { calls++; assert.equal(this, receiver); throw originalError; });
  assert.throws(() => throwing.call(receiver), error => error === originalError);
  assert.equal(calls, 2);
  assert.deepEqual(plain(h.root.__WXSLIM_FRAME_PROBE__.read().counts.loop), {registrations: 2, entered: 2, returned: 1, threw: 1});
});

test('after-frame registration and original flush callback preserve all call semantics', () => {
  const h = harness(), receiver = {}, arg = {}, returned = {}, registrationResult = {};
  let registrationCalls = 0, callbackCalls = 0, callback;
  const owner = {registerAfterDoFrame(fn) { registrationCalls++; assert.equal(this, owner); callback = fn; return registrationResult; }};
  const result = h.probe.registerAfterFrame(owner, function (value) { callbackCalls++; assert.equal(this, receiver); assert.equal(value, arg); return returned; });
  assert.equal(result, registrationResult); assert.equal(registrationCalls, 1); assert.equal(callbackCalls, 0);
  assert.equal(callback.call(receiver, arg), returned); assert.equal(callbackCalls, 1);
  const originalError = Error('PRIVATE_EXCEPTION_SENTINEL');
  h.probe.registerAfterFrame(owner, function () { callbackCalls++; throw originalError; });
  assert.throws(() => callback.call(receiver), error => error === originalError);
  assert.equal(callbackCalls, 2); assert.equal(registrationCalls, 2);
  assert.deepEqual(plain(h.root.__WXSLIM_FRAME_PROBE__.read().counts.afterFrame), {registrations: 2, registrationReturned: 2, registrationThrew: 0, entered: 2, returned: 1, threw: 1});
  const registrationError = Error('PRIVATE_EXCEPTION_SENTINEL');
  const throwingOwner = {registerAfterDoFrame() { registrationCalls++; throw registrationError; }};
  assert.throws(() => h.probe.registerAfterFrame(throwingOwner, () => { callbackCalls++; }), error => error === registrationError);
  assert.equal(registrationCalls, 3); assert.equal(callbackCalls, 2);
  assert.deepEqual(plain(h.root.__WXSLIM_FRAME_PROBE__.read().counts.afterFrame), {registrations: 3, registrationReturned: 2, registrationThrew: 1, entered: 2, returned: 1, threw: 1});
});

test('batch and swap preserve receiver, returned Promise identity and original exception', () => {
  const h = harness(), view = new Uint8Array(Buffer.from('PRIVATE_BUFFER_SENTINEL')), returned = Promise.resolve('native return');
  let batchCalls = 0, swapCalls = 0;
  const owner = {
    batchRenderAsync(value) { batchCalls++; assert.equal(this, owner); assert.equal(value, view); return returned; },
    swapWindow() { swapCalls++; assert.equal(this, owner); assert.equal(arguments.length, 0); return returned; },
  };
  assert.equal(h.probe.batchAsync(owner, view), returned); assert.equal(batchCalls, 1);
  assert.equal(h.probe.swap(owner), returned); assert.equal(swapCalls, 1);
  const originalError = Error('PRIVATE_EXCEPTION_SENTINEL');
  owner.batchRenderAsync = function (value) { batchCalls++; assert.equal(this, owner); assert.equal(value, view); throw originalError; };
  owner.swapWindow = function () { swapCalls++; assert.equal(this, owner); throw originalError; };
  assert.throws(() => h.probe.batchAsync(owner, view), error => error === originalError);
  assert.throws(() => h.probe.swap(owner), error => error === originalError);
  assert.equal(batchCalls, 2); assert.equal(swapCalls, 2);
  const counts = plain(h.root.__WXSLIM_FRAME_PROBE__.read().counts);
  assert.deepEqual(counts.batchAsync, {entered: 2, returned: 1, threw: 1});
  assert.deepEqual(counts.swap, {entered: 2, returned: 1, threw: 1});
});

test('automatic samples are bounded to three, then timers and owned listeners are cleaned up', () => {
  const h = harness();
  assert.equal(h.logs.length, 0);
  assert.equal(h.timers.size, 3);
  h.advance(3000); assert.equal(h.logs.length, 1);
  h.advance(5000); assert.equal(h.logs.length, 2);
  h.advance(7000); assert.equal(h.logs.length, 3);
  assert.equal(h.timers.size, 0);
  assert.equal(h.wxListeners.hide.size + h.wxListeners.show.size, 0);
  assert.equal([...h.canvasListeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal(h.root.__WXSLIM_FRAME_PROBE__.read().window.ended, true);
  h.advance(60000); assert.equal(h.logs.length, 3);
  assert.deepEqual(h.forbiddenCalls, []);
});

test('unpaired event APIs are not subscribed, and failed observers cannot leak error bodies', () => {
  const h = harness({unpairedListeners: true, diagnosticThrows: true});
  assert.equal(h.listenerCalls.length, 0);
  assert.doesNotThrow(() => h.root.__WXSLIM_FRAME_PROBE__.read());
  assert.doesNotThrow(() => h.advance(20000));
  assert.ok(h.logs.length <= 3);
  assert.doesNotMatch(h.logs.join('\n'), /PRIVATE_EXCEPTION_SENTINEL|987654321|ctxid/i);
  assert.deepEqual(h.forbiddenCalls, []);
});

test('a delayed background timer cannot extend counting when the original loop resumes', () => {
  const h = harness(), returned = {};
  let calls = 0;
  const loop = h.probe.wrapLoop(function () { calls++; return returned; });
  h.jumpWithoutTimers(20000);
  assert.equal(loop(), returned);
  assert.equal(calls, 1, 'the original loop must still execute exactly once');
  const snapshot = plain(h.root.__WXSLIM_FRAME_PROBE__.read());
  assert.equal(snapshot.window.ended, true);
  assert.equal(snapshot.window.endReason, 'deadline_observed_by_existing_callback');
  assert.equal(snapshot.counts.loop.entered, 0);
  assert.equal(snapshot.counts.loop.returned, 0);
  assert.equal(h.logs.length, 1, 'the resumed callback records only the final bounded sample');
  assert.equal(h.timers.size, 0);
  assert.equal(h.wxListeners.hide.size + h.wxListeners.show.size, 0);
  assert.equal([...h.canvasListeners.values()].reduce((n, set) => n + set.size, 0), 0);
  h.advance(60000);
  assert.equal(h.logs.length, 1);
  assert.deepEqual(h.forbiddenCalls, []);
});

test('snapshots omit raw exception text, native context IDs and command buffer payloads', () => {
  const h = harness(), secret = Error('PRIVATE_EXCEPTION_SENTINEL');
  const owner = {batchRenderAsync() { throw secret; }};
  assert.throws(() => h.probe.batchAsync(owner, new Uint8Array(Buffer.from('PRIVATE_BUFFER_SENTINEL'))), error => error === secret);
  const snapshot = h.root.__WXSLIM_FRAME_PROBE__.read();
  h.advance(20000);
  const output = JSON.stringify(snapshot) + h.logs.join('\n');
  assert.doesNotMatch(output, /PRIVATE_EXCEPTION_SENTINEL|PRIVATE_BUFFER_SENTINEL|987654321|ctxid/i);
  assert.deepEqual(h.forbiddenCalls, []);
  assert.deepEqual(Object.keys(h.root.__WXSLIM_FRAME_PROBE__).sort(), ['read']);
});

test('event and frame deltas measure existing work without changing events or invoking native work', () => {
  const h = harness();
  let calls = 0;
  const loop = h.probe.wrapLoop(() => { calls++; });
  loop(); loop();
  const event = {private: 'PRIVATE_EXCEPTION_SENTINEL', preventDefault() { assert.fail('probe must not alter context-lost events'); }};
  for (const fn of h.wxListeners.hide) fn(event);
  for (const fn of h.wxListeners.show) fn(event);
  for (const fn of h.canvasListeners.get('webglcontextlost') || []) fn(event);
  for (const fn of h.canvasListeners.get('webglcontextrestored') || []) fn(event);
  h.context.MainLoop.currentFrameNumber = 10;
  h.advance(3000);
  const parse = text => JSON.parse(text.slice(text.indexOf('{')));
  const first = parse(h.logs[0]);
  assert.deepEqual(first.events, {hide: 1, show: 1, contextLost: 1, contextRestored: 1});
  assert.equal(first.deltaSincePreviousSample['loop.entered'], 2);
  assert.equal(first.loop.currentFrameNumber, 10);
  assert.equal(first.deltaSincePreviousSample.currentFrameNumber, 9, 'first delta is measured from the installation baseline of 1');
  loop(); h.context.MainLoop.currentFrameNumber = 11;
  h.advance(5000);
  const second = parse(h.logs[1]);
  assert.equal(second.deltaSincePreviousSample['loop.entered'], 1);
  assert.equal(second.deltaSincePreviousSample.currentFrameNumber, 1);
  assert.equal(calls, 3);
  h.advance(7000);
  const snapshot = plain(h.root.__WXSLIM_FRAME_PROBE__.read().counts);
  loop();
  assert.equal(calls, 4, 'ending observation must not disable the original loop');
  assert.deepEqual(plain(h.root.__WXSLIM_FRAME_PROBE__.read().counts), snapshot, 'ended observation must freeze counters');
  assert.equal(h.logs.length, 3);
  assert.deepEqual(h.forbiddenCalls, []);
});
