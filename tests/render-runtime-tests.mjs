// Node VM contracts only: these tests do not establish WeChat, native GLX or device rendering compatibility.
// Run: node --test tests/render-runtime-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeRenderMode, transformerConfig} from '../convert/lib/inputs.mjs';
import {renderManifest} from '../convert/lib/render.mjs';

const source = name => fs.readFileSync(new URL('../convert/assets/' + name, import.meta.url), 'utf8');
const runtimeSource = source('render-runtime.js');
const observerSource = source('render-observer.js');
const bridgeSource = source('godot-bridge.js');
const nativeNames = ['glxInit', 'glxInitBufferDataAndGlState', 'glxUpdateContextId'];
const plain = value => JSON.parse(JSON.stringify(value));

function harness({mode = 'webgl', capability, missingConfig = false, config = {}} = {}) {
  const logs = [], forbiddenCalls = [], callbacks = {}, modals = [], audioActions = [];
  const forbidden = name => (...args) => { forbiddenCalls.push(name); throw Error('Unexpected external API: ' + name); };
  const audio = {state: 'suspended', createGain() {}, createBuffer() {}, close() { audioActions.push('close'); return Promise.resolve(); }, resume: forbidden('audio.resume'), suspend: forbidden('audio.suspend')};
  const wx = {
    env: capability === undefined ? {} : {isSupportEmscriptenGLX: capability},
    onHide: cb => { callbacks.hide = cb; }, onShow: cb => { callbacks.show = cb; }, onWindowResize: cb => { callbacks.resize = cb; },
    showModal: arg => { modals.push(arg); }, getFileSystemManager() { return {}; }, createWebAudioContext() { audioActions.push('create'); return audio; },
    request: forbidden('request'), uploadFile: forbidden('uploadFile'), setStorage: forbidden('setStorage'), setStorageSync: forbidden('setStorageSync'),
    getStorageSync: forbidden('getStorageSync'), cloud: {init: forbidden('cloud.init'), callFunction: forbidden('cloud.callFunction')}
  };
  const root = {wx};
  if (!missingConfig) root.__WXSLIM_RENDER_CONFIG__ = {schema: 'wxslim-render-config-v1', requestedMode: mode, packageVersion: 'wxslim-vm-contract', versions: {godot: '4.7.2', wxGameKit: '1.3.15'}, ...config};
  const context = vm.createContext({GameGlobal: root, wx, console: {warn: (...args) => logs.push(args.join(' ')), log() {}}, Uint8Array, Date, Promise, setInterval: forbidden('setInterval'), setTimeout: forbidden('setTimeout'), fetch: forbidden('fetch')});
  let runtimeError = null;
  try { vm.runInContext(runtimeSource, context, {filename: 'render-runtime.js'}); } catch (error) { runtimeError = error; }
  return {root, context, runtimeError, api: root.__WXSLIM_RENDER_DIAGNOSTIC__, logs, forbiddenCalls, callbacks, modals, audioActions};
}

function installObserver(h, {module = {}, bindings = true, resize = false, nativeThrows = null} = {}) {
  const nativeCalls = [], originalCalls = [];
  const exports = Object.fromEntries(nativeNames.map(name => [name, function (...args) {
    nativeCalls.push({name, args, receiver: this});
    if (name === nativeThrows) throw Error('private-native-error token=DO_NOT_LOG_NATIVE');
    return name === 'glxUpdateContextId' ? 7 : undefined;
  }]));
  if (!bindings) delete exports.glxInitBufferDataAndGlState;
  Object.assign(h.context, {
    Module: module, GLctx: null, GL: {currentContext: null, ...(resize ? {resizeOffscreenFramebuffer() {}} : {})},
    wxGLXGetRoot: () => h.root,
    wxGLXGetNativeExport: name => exports[name] || null,
    wxGLXHasNativeBindings: () => nativeNames.every(name => typeof exports[name] === 'function'),
    wxGLXCallNative(name, args) {
      originalCalls.push(name);
      try { return exports[name]?.apply(module, args || []); } catch { return null; }
    }
  });
  vm.runInContext(observerSource, h.context, {filename: 'render-observer.js'});
  function setContext(mode, {ctxid = 42, moduleCtxid = ctxid, webgl2 = true, moduleContext = true} = {}) {
    const actual = mode === null ? null : mode === 'glx' ? {emscriptenGLX: {ctxid, isWebGL2: webgl2, platform: 1}} : {};
    h.context.GLctx = actual;
    h.context.GL.currentContext = actual ? {GLctx: actual, attributes: {majorVersion: webgl2 ? 2 : 1}} : null;
    if (mode === 'glx' && moduleContext) module.wxContextGlobal = {ctxid: moduleCtxid};
    return actual;
  }
  const call = (name, args = []) => h.context.wxGLXCallNative(name, args);
  return {module, nativeCalls, originalCalls, setContext, call};
}

function initializeGLX(h, observer, {buffer = true} = {}) {
  observer.setContext('glx');
  observer.call('glxInit', [true]);
  if (buffer) observer.call('glxInitBufferDataAndGlState', [2, 1]);
  observer.call('glxUpdateContextId', [42]);
}

function summaryLines(h) { return h.logs.filter(line => line.startsWith('[WXSLIM_RENDER_SUMMARY] ')); }

test('missing mode normalizes to explicit WebGL throughout generated config and runtime', () => {
  const mode = normalizeRenderMode();
  const manifest = renderManifest({js: 'vm-engine', wasm: Buffer.from('vm-wasm'), pck: Buffer.from('GDPC'), godotVersion: '4.7.2', transformerVersion: '1.0.35', pluginVersion: '1.3.15'});
  assert.equal(mode, 'webgl');
  assert.equal(manifest.requestedMode, 'webgl');
  assert.equal(transformerConfig({}).enableGLX, false);
  const h = harness({config: manifest, capability: true});
  assert.equal(h.runtimeError, null);
  assert.equal(h.root.__godotMinigameWXGLXEnabled, false);
  assert.equal(h.root.__GODOT_DISABLE_WXGLX, true);
  assert.equal(h.api.read().actualContext, null);
  assert.equal(h.api.read().initialization, 'pending');
  assert.equal(h.api.read().packageVersion, manifest.packageVersion);
});

test('WebGL accepts missing, false and true capability without selecting GLX', () => {
  for (const capability of [undefined, false, true, 'true', 1]) {
    const h = harness({capability});
    assert.equal(h.runtimeError, null);
    assert.equal(h.root.__godotMinigameWXGLXEnabled, false);
    h.api.prepare({}, 'webgl');
  }
});

test('GLX requires literal true; missing, false and nonboolean values are readable environment blocks', () => {
  for (const capability of [undefined, false, 'true', 1, null, {}, []]) {
    const h = harness({mode: 'glx', capability});
    assert.match(h.runtimeError.message, /WXSLIM_GLX_CAPABILITY_UNAVAILABLE/);
    const result = h.api.read();
    assert.equal(result.initialization, 'blocked');
    assert.equal(result.actualContext, null);
    assert.equal(result.requestedMode, 'glx');
    assert.equal(result.capability.present, capability !== undefined);
    assert.equal(result.capability.value, capability === false ? false : null);
    assert.match(result.failureReason.message, /环境阻断/);
    assert.equal(summaryLines(h).length, 1);
  }
  const supported = harness({mode: 'glx', capability: true});
  assert.equal(supported.runtimeError, null);
  assert.equal(supported.root.__godotMinigameWXGLXEnabled, true);
  assert.equal(supported.root.__GODOT_DISABLE_WXGLX, false);
});

test('missing/invalid runtime config fails closed rather than guessing an actual mode', () => {
  for (const options of [{missingConfig: true}, {mode: 'auto'}, {config: {schema: 'unknown'}}]) {
    const h = harness(options);
    assert.match(h.runtimeError.message, /WXSLIM_RENDER_CONFIG_INVALID/);
    assert.equal(h.api.read().initialization, 'failed');
    assert.equal(h.api.read().actualContext, null);
  }
});

test('bridge mode mismatch or changed pins stop before initialization', () => {
  const mismatch = harness();
  assert.throws(() => mismatch.api.prepare({}, 'glx'), /WXSLIM_RENDER_CONFIG_MISMATCH/);
  for (const field of ['__godotMinigameWXGLXEnabled', '__GODOT_DISABLE_WXGLX']) {
    const h = harness({mode: 'glx', capability: true});
    h.root[field] = !h.root[field];
    assert.throws(() => h.api.prepare({}, 'glx'), /WXSLIM_RENDER_PIN_CHANGED/);
    assert.equal(h.api.read().initialization, 'failed');
  }
});

test('WebGL rejects loader native context; GLX validates a loader context id', () => {
  assert.throws(() => harness().api.prepare({wxContextGlobal: {ctxid: 1}}, 'webgl'), /WXSLIM_UNEXPECTED_GLX_CONTEXT/);
  for (const wxContextGlobal of [null, {}, {ctxid: '1'}, {ctxid: NaN}, {ctxid: Infinity}]) {
    const h = harness({mode: 'glx', capability: true});
    assert.throws(() => h.api.prepare({wxContextGlobal}, 'glx'), /WXSLIM_GLX_CONTEXT_INVALID/);
  }
  const valid = harness({mode: 'glx', capability: true});
  valid.api.prepare({wxContextGlobal: {ctxid: 0}}, 'glx');
  assert.equal(valid.api.read().bufferInitialization, 'loader_owned_unverified');
});

test('observer reads actual GLctx and module identity, never configured/pinned mode', () => {
  const h = harness({mode: 'glx', capability: true});
  const observer = installObserver(h, {resize: true});
  assert.equal(observer.module.__WXSLIM_READ_RENDER__().context, null);
  observer.setContext('webgl');
  assert.deepEqual(plain(observer.module.__WXSLIM_READ_RENDER__().context), {mode: 'webgl', webgl2: true});
  observer.setContext('glx', {moduleCtxid: 9});
  const actual = observer.module.__WXSLIM_READ_RENDER__();
  assert.equal(actual.context.mode, 'glx');
  assert.equal(actual.moduleContextMatches, false);
  assert.equal(actual.offscreenResizeFunction, true);
});

test('missing observer/bindings and absent actual context fail with distinct reasons', () => {
  assert.throws(() => harness().api.attach({}), /WXSLIM_RENDER_OBSERVER_MISSING/);
  const missing = harness({mode: 'glx', capability: true});
  const noBindings = installObserver(missing, {bindings: false});
  assert.throws(() => missing.api.attach(noBindings.module), /WXSLIM_GLX_BINDINGS_MISSING/);
  const absent = harness();
  absent.api.attach(installObserver(absent).module);
  assert.throws(() => absent.api.complete(), /WXSLIM_RENDER_CONTEXT_MISSING/);
  assert.equal(absent.api.read().actualContext, null);
});

test('actual context mismatch fails in both directions without fallback', () => {
  for (const mode of ['webgl', 'glx']) {
    const h = harness({mode, capability: true});
    const observer = installObserver(h);
    h.api.prepare(observer.module, mode);
    h.api.attach(observer.module);
    observer.setContext(mode === 'glx' ? 'webgl' : 'glx');
    assert.throws(() => h.api.complete(), /WXSLIM_RENDER_CONTEXT_MISMATCH/);
    assert.equal(h.api.read().requestedMode, mode);
    assert.equal(h.root.__godotMinigameWXGLXEnabled, mode === 'glx');
    assert.equal(h.api.read().initialization, 'failed');
  }
});

test('GLX context version and module ctxid must match actual context', () => {
  for (const options of [{webgl2: false}, {moduleCtxid: 13}, {moduleContext: false}]) {
    const h = harness({mode: 'glx', capability: true}), observer = installObserver(h);
    h.api.attach(observer.module);
    observer.setContext('glx', options);
    assert.throws(() => h.api.complete(), /WXSLIM_GLX_CONTEXT_MISMATCH/);
  }
});

test('GLX observes all native initialization steps and preserves return values/receivers', () => {
  const h = harness({mode: 'glx', capability: true}), observer = installObserver(h);
  h.api.prepare(observer.module, 'glx');
  h.api.attach(observer.module);
  initializeGLX(h, observer);
  assert.equal(observer.call('glxUpdateContextId', [42]), 7);
  h.api.complete();
  const result = h.api.read();
  assert.equal(result.initialization, 'initialized');
  assert.equal(result.visibleRendering, 'not_verified');
  assert.equal(result.bufferInitialization, 'returned');
  assert.equal(result.native.glxUpdateContextId.calls, 2);
  for (const name of nativeNames) assert.equal(result.native[name].result, 'returned');
  assert.ok(observer.nativeCalls.every(call => call.receiver === observer.module));
  assert.equal(observer.originalCalls.length, 0);
});

test('each native GLX exception escapes the old swallow-wrapper, fails once and is sanitized', () => {
  for (const nativeThrows of nativeNames) {
    const h = harness({mode: 'glx', capability: true}), observer = installObserver(h, {nativeThrows});
    h.api.attach(observer.module);
    observer.setContext('glx');
    assert.throws(() => observer.call(nativeThrows, ['DO_NOT_LOG_ARGS']), /WXSLIM_GLX_NATIVE_FAILED/);
    h.api.fail(Error('token=DO_NOT_LOG_CATCH'));
    const result = h.api.read();
    assert.equal(result.initialization, 'failed');
    assert.equal(result.native[nativeThrows].result, 'threw');
    assert.equal(summaryLines(h).length, 1);
    assert.doesNotMatch(JSON.stringify(result) + h.logs.join(''), /DO_NOT_LOG/);
  }
});

test('WebGL native behavior stays on the existing wrapper including its error handling', () => {
  const h = harness(), observer = installObserver(h, {nativeThrows: 'glxInit'});
  h.api.attach(observer.module);
  observer.setContext('webgl');
  assert.equal(observer.call('glxInit', [false]), null);
  h.api.complete();
  assert.deepEqual(observer.originalCalls, ['glxInit']);
  assert.deepEqual(plain(h.api.read().native), {});
  assert.equal(h.api.read().initialization, 'initialized');
});

test('GLX native init or context update left unobserved cannot report initialized', () => {
  for (const omitted of ['glxInit', 'glxUpdateContextId']) {
    const h = harness({mode: 'glx', capability: true}), observer = installObserver(h);
    h.api.attach(observer.module);
    observer.setContext('glx');
    for (const name of nativeNames) if (name !== omitted) observer.call(name);
    assert.throws(() => h.api.complete(), /WXSLIM_GLX_INIT_UNOBSERVED/);
    assert.equal(h.api.read().initialization, 'failed');
  }
});

test('loader-owned GLX context without observed buffer initialization is inconclusive', () => {
  const h = harness({mode: 'glx', capability: true}), observer = installObserver(h, {module: {wxContextGlobal: {ctxid: 42}}});
  h.api.prepare(observer.module, 'glx');
  h.api.attach(observer.module);
  initializeGLX(h, observer, {buffer: false});
  h.api.complete();
  assert.equal(h.api.read().initialization, 'inconclusive');
  assert.equal(h.api.read().failureReason.code, 'WXSLIM_GLX_BUFFER_UNOBSERVED');
  assert.equal(h.api.read().bufferInitialization, 'loader_owned_unverified');
  assert.equal(h.api.read().visibleRendering, 'not_verified');
});

test('summary emits only once, read returns a detached snapshot and show is user-triggered', () => {
  const h = harness(), observer = installObserver(h);
  h.api.attach(observer.module); observer.setContext('webgl');
  h.api.complete(); h.api.complete();
  const snapshot = h.api.read(); snapshot.initialization = 'forged'; snapshot.lifecycle.recovery = 'passed';
  assert.equal(h.api.read().initialization, 'initialized');
  assert.equal(h.api.read().lifecycle.recovery, 'not_verified');
  assert.equal(summaryLines(h).length, 1);
  assert.equal(h.modals.length, 0);
  h.api.show();
  assert.equal(h.modals.length, 1);
  assert.equal(JSON.parse(h.modals[0].content).actualContext.mode, 'webgl');
});

test('lifecycle observations are bounded counters and never claim recovery or operate audio', () => {
  const h = harness({mode: 'glx', capability: true});
  h.callbacks.hide(); h.callbacks.show(); h.callbacks.resize();
  for (let i = 0; i < 65536; i++) h.callbacks.show();
  assert.deepEqual(plain(h.api.read().lifecycle), {hide: 1, show: 65535, resize: 1, recovery: 'not_verified'});
  assert.equal(summaryLines(h).length, 0);
  assert.deepEqual(h.audioActions, []);
  assert.deepEqual(h.forbiddenCalls, []);
});

async function bridgeFixture({mode = 'webgl', autoCallMain = true, factoryError = false, nativeThrows = null, onMain = null, mainReturn = () => 0} = {}) {
  const h = harness({mode, capability: true}), order = [], exitCodes = [], module = {canvas: {}};
  const observer = installObserver(h, {module, nativeThrows});
  vm.runInContext(bridgeSource, h.context, {filename: 'godot-bridge.js'});
  let copied = null, initOptions = null;
  module.onRuntimeInitialized = function () { order.push('loader-runtime-notify'); };
  module.initConfig = options => { order.push('initConfig'); initOptions = options; };
  module.initFS = async mounts => { order.push('initFS'); assert.deepEqual(plain(mounts), []); };
  module.copyToFS = (name, data) => { order.push('copyToFS'); copied = {name, data: [...data]}; };
  module.callMain = args => {
    order.push('callMain');
    assert.deepEqual(plain(args), ['--main-pack', '/minimal.pck']);
    if (mode === 'glx') initializeGLX(h, observer); else { observer.setContext('webgl'); observer.call('glxInit', [false]); }
    if (onMain) onMain(h, observer, initOptions);
    return mainReturn();
  };
  const factory = async actual => {
    order.push('factory'); assert.equal(actual, module); assert.equal(module.noInitialRun, true);
    if (factoryError) throw Error('private factory failure token=DO_NOT_LOG_FACTORY');
    actual.onRuntimeInitialized(); return actual;
  };
  const options = {renderMode: mode, packPath: '/minimal.pck', expectedPackBytes: 4, autoCallMainAfterMount: autoCallMain, onExit(code) { exitCodes.push(code); }, readPack() { order.push('readPack'); return new Uint8Array([71, 68, 80, 67]); }};
  const promise = h.root.__WXSLIM_GODOT_BRIDGE__.start(factory, module, options);
  return {h, observer, module, order, exitCodes, promise, get copied() { return copied; }, get initOptions() { return initOptions; }};
}

test('real bridge runs factory/config/FS/PCK/main in order for both requested modes', async () => {
  for (const mode of ['webgl', 'glx']) {
    const fixture = await bridgeFixture({mode});
    assert.equal(await fixture.promise, fixture.module);
    assert.deepEqual(fixture.order, ['factory', 'initConfig', 'initFS', 'readPack', 'copyToFS', 'loader-runtime-notify', 'callMain']);
    assert.deepEqual(fixture.copied, {name: '/minimal.pck', data: [71, 68, 80, 67]});
    assert.equal(fixture.initOptions.canvas, fixture.module.canvas);
    assert.equal(fixture.h.root.__WXSLIM_BOOT_STATE__.mainCalls, 1);
    assert.equal(fixture.h.api.read().actualContext.mode, mode);
    assert.equal(fixture.h.api.read().initialization, 'initialized');
    assert.equal(fixture.h.api.read().visibleRendering, 'not_verified');
    assert.equal(summaryLines(fixture.h).length, 1);
    assert.deepEqual(fixture.h.forbiddenCalls, []);
  }
});

test('loader-owned delayed callMain leaves diagnostics pending until actual context creation', async () => {
  const fixture = await bridgeFixture({mode: 'glx', autoCallMain: false});
  await fixture.promise;
  assert.equal(fixture.h.api.read().initialization, 'pending');
  assert.equal(fixture.h.api.read().actualContext, null);
  assert.equal(summaryLines(fixture.h).length, 0);
  fixture.module.callMain([]);
  assert.equal(fixture.h.api.read().initialization, 'initialized');
  assert.throws(() => fixture.module.callMain([]), /WXSLIM_DUPLICATE_MAIN/);
  assert.equal(summaryLines(fixture.h).length, 1);
});

test('factory failure creates one sanitized local summary without storage, cloud or audio resume', async () => {
  const fixture = await bridgeFixture({factoryError: true});
  await assert.rejects(fixture.promise, /DO_NOT_LOG_FACTORY/);
  const {h} = fixture;
  assert.equal(h.api.read().initialization, 'failed');
  assert.equal(h.api.read().failureReason.code, 'WXSLIM_RENDER_BOOT_FAILED');
  assert.doesNotMatch(JSON.stringify(h.api.read()) + h.logs.join(''), /DO_NOT_LOG_FACTORY/);
  assert.equal(summaryLines(h).length, 1);
  assert.deepEqual(h.forbiddenCalls, []);
  assert.deepEqual(h.audioActions, ['create', 'close']);
});

test('native exception in real bridge rejects startup and never emits GLX success', async () => {
  const fixture = await bridgeFixture({mode: 'glx', nativeThrows: 'glxInitBufferDataAndGlState'});
  await assert.rejects(fixture.promise, /WXSLIM_GLX_NATIVE_FAILED/);
  const result = fixture.h.api.read();
  assert.equal(result.initialization, 'failed');
  assert.equal(result.failureReason.code, 'WXSLIM_GLX_NATIVE_FAILED');
  assert.equal(result.actualContext?.mode, 'glx', 'failure summary should read an already available actual context, not retain the pre-main null snapshot');
  assert.equal(summaryLines(fixture.h).length, 1);
  assert.doesNotMatch(fixture.h.logs.join(''), /DO_NOT_LOG_NATIVE|"initialization":"initialized"/);
});

test('mode pins changed during main are rejected again at initialization completion', async () => {
  const fixture = await bridgeFixture({mode: 'glx', onMain(h) { h.root.__godotMinigameWXGLXEnabled = false; h.root.__GODOT_DISABLE_WXGLX = true; }});
  await assert.rejects(fixture.promise, /WXSLIM_RENDER_PIN_CHANGED/);
  assert.equal(fixture.h.api.read().initialization, 'failed');
  assert.equal(fixture.h.api.read().failureReason.code, 'WXSLIM_RENDER_PIN_CHANGED');
});

test('failed initialization is terminal and cannot later become a contradictory success', () => {
  const h = harness(), observer = installObserver(h);
  h.api.attach(observer.module);
  assert.throws(() => h.api.complete(), /WXSLIM_RENDER_CONTEXT_MISSING/);
  observer.setContext('webgl');
  try { h.api.complete(); } catch { /* Remaining failed by throwing is also acceptable. */ }
  assert.equal(h.api.read().initialization, 'failed');
  assert.equal(h.api.read().failureReason.code, 'WXSLIM_RENDER_CONTEXT_MISSING');
  assert.equal(summaryLines(h).length, 1);
  const emitted = JSON.parse(summaryLines(h)[0].slice('[WXSLIM_RENDER_SUMMARY] '.length));
  assert.equal(h.api.read().initialization, emitted.initialization);
});

test('read refreshes actual context without creating a context or claiming lifecycle recovery', () => {
  let createdContexts = 0;
  const h = harness({mode: 'glx', capability: true});
  const observer = installObserver(h, {module: {canvas: {getContext() { createdContexts++; throw Error('read must not create context'); }}}});
  h.api.attach(observer.module);
  assert.equal(h.api.read().actualContext, null);
  observer.setContext('glx');
  assert.equal(h.api.read().actualContext.mode, 'glx');
  assert.equal(h.api.read().moduleContextMatches, true);
  observer.module.wxContextGlobal.ctxid = 99;
  assert.equal(h.api.read().moduleContextMatches, false);
  observer.setContext('webgl', {webgl2: false});
  assert.deepEqual(plain(h.api.read().actualContext), {mode: 'webgl', webgl2: false});
  observer.setContext(null);
  h.callbacks.hide(); h.callbacks.show();
  assert.equal(h.api.read().actualContext, null);
  assert.equal(h.api.read().initialization, 'pending');
  assert.equal(h.api.read().lifecycle.recovery, 'not_verified');
  assert.equal(createdContexts, 0);
  assert.equal(summaryLines(h).length, 0);
  assert.deepEqual(h.forbiddenCalls, []);
});

test('callMain returning zero or undefined remains valid through the real bridge', async () => {
  for (const mode of ['webgl', 'glx']) for (const value of [0, undefined]) {
    const fixture = await bridgeFixture({mode, mainReturn: () => value});
    await fixture.promise;
    assert.equal(fixture.h.api.read().initialization, 'initialized');
    assert.equal(fixture.h.api.read().failureReason, null);
    assert.equal(summaryLines(fixture.h).length, 1);
  }
});

test('nonzero callMain return fails even after actual GLX context and all native initialization steps', async () => {
  for (const value of [-1, 1, 37]) {
    const fixture = await bridgeFixture({mode: 'glx', mainReturn: () => value});
    await assert.rejects(fixture.promise, /WXSLIM_GODOT_MAIN_FAILED/);
    const result = fixture.h.api.read();
    assert.equal(result.actualContext.mode, 'glx');
    for (const name of nativeNames) assert.equal(result.native[name].result, 'returned');
    assert.equal(result.initialization, 'failed');
    assert.equal(result.failureReason.code, 'WXSLIM_GODOT_MAIN_FAILED');
    assert.equal(summaryLines(fixture.h).length, 1);
    assert.doesNotMatch(fixture.h.logs.join(''), /"initialization":"initialized"/);
  }
});

test('bridge onExit forwards zero/undefined without marking a healthy initialization failed', async () => {
  for (const code of [0, undefined]) {
    const fixture = await bridgeFixture({mode: 'glx', onMain(h, observer, options) { options.onExit(code); }});
    await fixture.promise;
    assert.deepEqual(fixture.exitCodes, [code]);
    assert.equal(fixture.h.api.read().initialization, 'initialized');
    assert.equal(fixture.h.api.read().failureReason, null);
    assert.equal(summaryLines(fixture.h).length, 1);
  }
});

test('bridge onExit nonzero is terminal even when callMain subsequently returns zero', async () => {
  for (const code of [-1, 8]) {
    const fixture = await bridgeFixture({mode: 'glx', onMain(h, observer, options) { options.onExit(code); }});
    await assert.rejects(fixture.promise, /WXSLIM_RENDER_ALREADY_FAILED/);
    assert.deepEqual(fixture.exitCodes, [code]);
    const result = fixture.h.api.read();
    assert.equal(result.initialization, 'failed');
    assert.equal(result.failureReason.code, 'WXSLIM_GODOT_MAIN_FAILED');
    assert.equal(result.actualContext.mode, 'glx');
    for (const name of nativeNames) assert.equal(result.native[name].result, 'returned');
    assert.throws(() => fixture.h.api.complete(0), /WXSLIM_RENDER_ALREADY_FAILED/);
    assert.equal(fixture.h.api.read().initialization, 'failed');
    assert.equal(summaryLines(fixture.h).length, 1);
    assert.doesNotMatch(fixture.h.logs.join(''), /"initialization":"initialized"/);
  }
});

test('new GLX context without buffer initialization fails rather than claiming loader-owned uncertainty', () => {
  const h = harness({mode: 'glx', capability: true}), observer = installObserver(h);
  h.api.prepare(observer.module, 'glx');
  h.api.attach(observer.module);
  initializeGLX(h, observer, {buffer: false});
  assert.throws(() => h.api.complete(0), /WXSLIM_GLX_INIT_UNOBSERVED/);
  assert.equal(h.api.read().initialization, 'failed');
  assert.equal(h.api.read().failureReason.code, 'WXSLIM_GLX_INIT_UNOBSERVED');
  assert.notEqual(h.api.read().bufferInitialization, 'loader_owned_unverified');
  assert.equal(summaryLines(h).length, 1);
});

test('fresh actual GLX context requires finite matching numeric ctxids on both sides', () => {
  for (const invalid of [undefined, NaN, Infinity, -Infinity, null, '42']) {
    for (const side of ['actual', 'module', 'both']) {
      const h = harness({mode: 'glx', capability: true}), observer = installObserver(h);
      h.api.prepare(observer.module, 'glx');
      h.api.attach(observer.module);
      initializeGLX(h, observer);
      if (side !== 'module') h.context.GLctx.emscriptenGLX.ctxid = invalid;
      if (side !== 'actual') observer.module.wxContextGlobal.ctxid = invalid;
      assert.equal(h.api.read().moduleContextMatches, false, 'invalid ' + side + ' ctxid must not compare as valid');
      assert.throws(() => h.api.complete(0), /WXSLIM_GLX_CONTEXT_MISMATCH/);
      assert.equal(h.api.read().initialization, 'failed');
    }
  }
});
