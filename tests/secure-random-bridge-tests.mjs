// SOURCE_ONLY actual derived bridge + existing host, fake platform/timers/WASM.
// No engine, crypto quality, actual WebGL context, wx or device execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prepareSecureRandomBridge, SECURE_RANDOM_BRIDGE_PINS} from '../convert/lib/secure-random-bridge.mjs';
import createSecureRandomLifecycle from '../convert/assets/secure-random-lifecycle.js';
import createSecureRandomHost from '../convert/assets/secure-random-host.js';

const prepared = prepareSecureRandomBridge();
const original = new Error('PRIVATE_ORIGINAL_FAILURE');
async function until(check) {
  for (let i = 0; i < 40 && !check(); i++) await Promise.resolve();
  assert(check(), 'expected bounded model progress');
}
function model(settings = {}) {
  const events = [], requests = [], timers = new Map();
  let timerId = 0, config, owner, factoryCalls = 0, stopped = 0;
  const audio = {state: 'running', createGain() {}, createBuffer() {}, close() { this.state = 'closed'; return Promise.resolve(); }};
  const wx = {getFileSystemManager() { throw Error('NO_FS_CALL_ALLOWED'); },
    createWebAudioContext() { events.push('audio'); return audio; },
    getUserCryptoManager() { events.push('manager'); return {getRandomValues(request) { requests.push(request); events.push('request'); settings.request?.(request); }}; }};
  const root = {wx, canvas: {}, console: {log() {}, error(...values) { events.push(values); if (settings.loggerThrow) throw undefined; }},
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    __WXSLIM_RENDER_DIAGNOSTIC__: {
      prepare(m, mode) { assert.equal(mode, 'webgl'); events.push('render-webgl'); },
      attach() { events.push('attach'); }, exit() { events.push('exit'); },
      fail(error) { events.push('failed'); }, complete() { events.push('complete'); }
    }};
  const module = {canvas: root.canvas};
  const context = vm.createContext({...root, GameGlobal: root});
  vm.runInContext(prepared.source.toString('utf8'), context, {filename: 'derived-secure-random-bridge.js'});
  function native(size) { assert.equal(size, 0); stopped++; events.push('terminate'); settings.terminate?.(); return 0; }
  const factory = async m => {
    factoryCalls++; owner = m; events.push('factory');
    assert.equal(m.__wxslimSecureRandomMode, 'WECHAT_CTR_DRBG_V1');
    assert.equal(typeof m.__wxslimEntropyTake, 'function');
    assert.equal(m.__wxslimEntropyAssertReady(), undefined);
    if (settings.factory) await settings.factory(m, native);
    if (!settings.noExport) m._godot_wechat_random_buffer = native;
    m.initConfig = value => { config = value; events.push('config'); };
    m.initFS = paths => { assert.equal(paths.length, 0); events.push('fs'); return settings.initFS ? settings.initFS(m) : null; };
    m.copyToFS = () => { events.push('pack'); };
    m.callMain = () => { events.push('main'); if (settings.mainThrow) throw original; return 0; };
    return m;
  };
  const options = {wx, renderMode: 'webgl', packPath: '/test.pck', expectedPackBytes: 4,
    readPack: () => new Uint8Array([71, 68, 80, 67]), ...settings.options};
  function start() { return root.__WXSLIM_GODOT_BRIDGE__.start(factory, module, options); }
  function success(index = 0) { requests[index].success({randomValues: new Uint8Array(4096).fill(73).buffer}); }
  function fireTimer(delay) {
    const entry = [...timers.entries()].find(([, value]) => value.ms === delay); assert(entry);
    // A real one-shot timer is no longer pending when its callback runs.
    timers.delete(entry[0]); entry[1].fn();
  }
  function fireTimeout() { fireTimer(5000); }
  return {root, module, events, requests, timers, start, success, fireTimeout, fireTimer,
    get config() { return config; }, get factoryCalls() { return factoryCalls; }, get stopped() { return stopped; }};
}
async function ready(f) {
  const promise = f.start(); await until(() => f.requests.length > 0); f.success(); return promise;
}

test('fixed derivation pins, finite reversible edits and no global factories', () => {
  assert.equal(prepared.receipt.base.sha256, SECURE_RANDOM_BRIDGE_PINS.base);
  assert.equal(prepared.receipt.host.sha256, SECURE_RANDOM_BRIDGE_PINS.host);
  assert.equal(prepared.receipt.outsideEditsBytesUnchanged, true);
  assert.deepEqual(prepareSecureRandomBridge().source, prepared.source);
  const f = model();
  assert.equal(f.root.createSecureRandomHost, undefined);
  assert.equal(f.root.createSecureRandomLifecycle, undefined);
  assert.equal(f.requests.length, 0);
});
test('actual prepare precedes factory; ordinary WebGL bridge keeps pack/main path and no C query', async () => {
  const f = model(); const promise = f.start(); await until(() => f.requests.length > 0);
  assert.equal(f.factoryCalls, 0); assert.equal(f.module.__wxslimEntropyTake, undefined);
  f.success(); const m = await promise;
  assert.equal(m, f.module); assert.equal(f.factoryCalls, 1); assert.equal(f.stopped, 0);
  assert(f.events.indexOf('request') < f.events.indexOf('factory'));
  assert.equal(m.__wxslimEntropyTake(new Uint8Array(48)), 48);
  assert.equal(f.stopped, 0); m.callMain([]); assert.equal(f.stopped, 0);
  f.config.onExit(0); assert.equal(f.stopped, 1); assert.equal(f.timers.size, 0);
  f.config.onExit(0); assert.equal(f.stopped, 1);
});
test('prepare failure/timeout and late receipt never enter factory', async () => {
  for (const timeout of [false, true]) {
    const f = model(); const promise = f.start(); const rejection = assert.rejects(promise, timeout ? /SECURE_RANDOM_TIMEOUT/ : /SECURE_RANDOM_API_FAILED/);
    await until(() => f.requests.length > 0);
    if (timeout) f.fireTimeout(); else f.requests[0].fail({errMsg: 'PRIVATE'});
    await rejection; f.success(); await Promise.resolve();
    assert.equal(f.factoryCalls, 0); assert.equal(f.stopped, 0); assert.equal(f.timers.size, 0);
  }
});
test('pending prepare rejects same/different Module starts before touching first owner or acquiring entropy', async () => {
  for (const sameModule of [true, false]) {
    const f = model(); const first = f.start(); const state = f.root.__WXSLIM_BOOT_STATE__;
    let secondFactoryCalls = 0;
    const other = sameModule ? f.module : {canvas: f.root.canvas};
    const second = f.root.__WXSLIM_GODOT_BRIDGE__.start(() => { secondFactoryCalls++; }, other, {});
    await assert.rejects(second, /WXSLIM_RESTART_REQUIRED/);
    assert.equal(f.root.__WXSLIM_BOOT_STATE__, state);
    await until(() => f.requests.length > 0); assert.equal(f.requests.length, 1);
    assert.equal(secondFactoryCalls, 0); assert.equal(f.factoryCalls, 0); assert.equal(f.stopped, 0);
    f.success(); await first;
    assert.equal(f.requests.length, 1); assert.equal(f.factoryCalls, 1); assert.equal(f.stopped, 0);
    assert.equal(f.root.__WXSLIM_BOOT_STATE__, state);
    await assert.rejects(f.start(), /WXSLIM_RESTART_REQUIRED/);
    assert.equal(f.root.__WXSLIM_BOOT_STATE__, state); assert.equal(f.stopped, 0);
    f.config.onExit(0);
  }
});
test('prepare failure releases synchronous owner only before factory entry', async () => {
  const f = model(); const first = f.start();
  await until(() => f.requests.length > 0); f.requests[0].fail({});
  await assert.rejects(first, /SECURE_RANDOM_API_FAILED/);
  const previous = f.root.__WXSLIM_BOOT_STATE__;
  const retry = f.start(); await until(() => f.requests.length === 2);
  assert.notEqual(f.root.__WXSLIM_BOOT_STATE__, previous);
  f.success(1); await retry; assert.equal(f.factoryCalls, 1); f.config.onExit(0);
  // This is an explicit caller start after a pre-factory failure, not host retry.
});
test('success then synchronous platform throw cannot enter factory', async () => {
  const f = model({request(r) { r.success({randomValues: new ArrayBuffer(4096)}); throw original; }});
  await assert.rejects(f.start(), /SECURE_RANDOM_CALL_THROW/);
  assert.equal(f.factoryCalls, 0);
});
test('take failure defers native termination until outside seed hook and closes all later hooks', async () => {
  const f = model(); const m = await ready(f); let caught;
  try { m.__wxslimEntropyTake(new Uint8Array(8193)); } catch (error) { caught = error; }
  assert.equal(caught.message, 'SECURE_RANDOM_TARGET'); assert.equal(f.stopped, 0);
  await Promise.resolve(); assert.equal(f.stopped, 1);
  assert.throws(() => m.__wxslimEntropyAssertReady(), /SECURE_RANDOM_LIFECYCLE_CLOSED/);
  await Promise.resolve(); assert.equal(f.stopped, 1);
});
test('background refill failure is noticed by health hook without taking another seed', async () => {
  const f = model(); const m = await ready(f); m.__wxslimEntropyTake(new Uint8Array(3072));
  f.fireTimer(0);
  assert.equal(f.requests.length, 2); f.requests[1].fail({errMsg: 'PRIVATE'});
  assert.throws(() => m.__wxslimEntropyAssertReady(), /SECURE_RANDOM_API_FAILED/);
  assert.equal(f.stopped, 0); await Promise.resolve(); assert.equal(f.stopped, 1);
});
test('factory rejection before export keeps original value and no fake termination', async () => {
  const f = model({factory() { throw original; }});
  await assert.rejects(ready(f), error => error === original);
  assert.equal(f.stopped, 0); assert.equal(f.timers.size, 0);
});
test('actual bridge discovers export after factory DRBG use then rejection; cleanup failure remains visible', async () => {
  const f = model({factory(m, native) {
    m._godot_wechat_random_buffer = native;
    // A seed callback can have run before the factory promise rejects.
    assert.equal(m.__wxslimEntropyTake(new Uint8Array(48)), 48);
    throw original;
  }, terminate() { throw Error('PRIVATE_TERMINATE'); }, loggerThrow: true});
  await assert.rejects(ready(f), error => error === original);
  assert.equal(f.stopped, 1);
  const snapshot = f.root.__WXSLIM_BOOT_STATE__.secureRandom;
  assert.equal(snapshot.closed, true); assert.equal(snapshot.nativeState, 'TERMINATION_FAILED');
  assert.equal(snapshot.cleanupFailures, 1);
  assert.equal(f.events.filter(value => Array.isArray(value) && value[0] === '[WXSLIM_SECURE_RANDOM_CLEANUP_INCOMPLETE]').length, 1);
  assert(!JSON.stringify(snapshot).includes('PRIVATE'));
});
test('actual bridge publishes deferred cleanup completion rather than only its initial snapshot', async () => {
  const f = model({terminate() { throw original; }}); const m = await ready(f);
  assert.throws(() => m.__wxslimEntropyTake(new Uint8Array(8193)), /SECURE_RANDOM_TARGET/);
  assert.equal(f.root.__WXSLIM_BOOT_STATE__.secureRandom.cleanupDeferred, true);
  assert.equal(f.stopped, 0); await Promise.resolve();
  assert.equal(f.root.__WXSLIM_BOOT_STATE__.secureRandom.cleanupDeferred, false);
  assert.equal(f.root.__WXSLIM_BOOT_STATE__.secureRandom.nativeState, 'TERMINATION_FAILED');
  assert.equal(f.root.__WXSLIM_BOOT_STATE__.secureRandom.cleanupFailures, 1);
});
test('post-factory startup/main failures terminate once without replacing original failure', async () => {
  const startup = model({initFS() { throw original; }, terminate() { throw Error('cleanup'); }});
  await assert.rejects(ready(startup), error => error === original); assert.equal(startup.stopped, 1);
  const main = model({mainThrow: true, options: {autoCallMainAfterMount: true}});
  await assert.rejects(ready(main), error => error === original); assert.equal(main.stopped, 1);
});
test('existing own/inherited hook fields are refused without overwriting or acquisition', async () => {
  for (const key of ['__wxslimSecureRandomMode', '__wxslimEntropyTake', '__wxslimEntropyAssertReady']) {
    const f = model(); Object.setPrototypeOf(f.module, {[key]: undefined});
    await assert.rejects(f.start(), /SECURE_RANDOM_HOOK_OWNERSHIP/);
    assert.equal(f.requests.length, 0); assert.equal(Object.hasOwn(f.module, key), false);
  }
});
test('missing native export and hook replacement fail ready gate', async () => {
  const missing = model({noExport: true}); await assert.rejects(ready(missing), /SECURE_RANDOM_EXPORT_REQUIRED/);
  const changed = model({factory(m) { m.__wxslimEntropyTake = () => 48; }});
  await assert.rejects(ready(changed), /SECURE_RANDOM_HOOK_OWNERSHIP/); assert.equal(changed.stopped, 1);
});
test('late factory ready after close binds and terminates, never revives; cleanup is idempotent', async () => {
  const module = {}; let request, stop = 0;
  const lifecycle = createSecureRandomLifecycle({module, createSecureRandomHost,
    wx: {getUserCryptoManager() { return {getRandomValues(r) { request = r; }}; }},
    setTimeout() { return 1; }, clearTimeout() {}});
  const p = lifecycle.prepare(); await until(() => request); request.success({randomValues: new ArrayBuffer(4096)}); await p;
  assert.equal(lifecycle.close().nativeState, 'UNBOUND_UNKNOWN');
  module._godot_wechat_random_buffer = value => { assert.equal(value, 0); stop++; };
  assert.throws(() => lifecycle.bindNative(module), /SECURE_RANDOM_LIFECYCLE_CLOSED/);
  assert.equal(lifecycle.status().nativeState, 'TERMINATED'); lifecycle.close(); assert.equal(stop, 1);
});
test('cleanup never executes export getters or substitutes a changed bound export', async () => {
  for (const accessor of [false, true]) {
    let getters = 0, stops = 0;
    const module = {};
    const lifecycle = createSecureRandomLifecycle({module, createSecureRandomHost() {
      return {prepare() {}, take() {}, assertReady() {}, close() {}};
    }});
    await lifecycle.prepare(); module._godot_wechat_random_buffer = () => { stops++; };
    lifecycle.bindNative(module);
    if (accessor) Object.defineProperty(module, '_godot_wechat_random_buffer', {get() { getters++; throw original; }});
    else module._godot_wechat_random_buffer = () => { stops++; };
    lifecycle.close();
    assert.equal(getters, 0); assert.equal(stops, 0);
    assert.equal(lifecycle.status().nativeState, accessor ? 'EXPORT_ACCESSOR_UNKNOWN' : 'EXPORT_CHANGED_UNKNOWN');
    assert.equal(lifecycle.status().cleanupFailures, 1);
  }
});
test('cleanup failure stays bounded in status, original falsy hook exceptions survive', async () => {
  for (const sentinel of [undefined, null, false, 0, '']) {
    const module = {}; let caught = false, inHook = false, stops = 0;
    const lifecycle = createSecureRandomLifecycle({module, createSecureRandomHost() {
      return {prepare() {}, take() { inHook = true; throw sentinel; }, assertReady() {}, close() { throw Error('PRIVATE'); }};
    }});
    await lifecycle.prepare(); module._godot_wechat_random_buffer = () => { assert.equal(inHook, false); stops++; throw Error('PRIVATE'); };
    lifecycle.bindNative(module);
    try { module.__wxslimEntropyTake(new Uint8Array(1)); } catch (error) { caught = true; assert.equal(error, sentinel); }
    assert(caught); inHook = false; await Promise.resolve();
    assert.equal(stops, 1); assert.equal(lifecycle.status().cleanupFailures, 2);
    assert.equal(lifecycle.status().nativeState, 'TERMINATION_FAILED');
    assert(!JSON.stringify(lifecycle.status()).includes('PRIVATE'));
  }
});
