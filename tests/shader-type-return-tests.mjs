import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { instrumentGlue, ANCHOR, MARKER, ENTRY, OBSERVE } = require('../engine/shader-type-return/instrument-glue.cjs');
const typeLibrary = fs.readFileSync(new URL('../engine/shader-type-return/library.js', import.meta.url), 'utf8');
const failureLibrary = fs.readFileSync(new URL('../engine/shader-failure/library.js', import.meta.url), 'utf8');

function fixture(options = {}) {
  const { glx = true, missing = false, batchError } = options;
  const raw = Object.hasOwn(options, 'raw') ? options.raw : 35632;
  const library = {}, calls = [], logs = [], heap = new Uint8Array(64);
  const Module = { HEAPU8: heap };
  const platform = { batchRender(view) {
    calls.push({ receiver: this, view });
    if (batchError) throw batchError;
    return raw;
  } };
  Module.wxContextGlobal = missing ? null : platform;
  const context = vm.createContext({ Module, Uint8Array, Uint32Array,
    GameGlobal: { __godotMinigameWXGLXEnabled: glx },
    LibraryManager: { library }, mergeInto: Object.assign,
    UTF8ToString() { throw new Error('unexpected heap/source decoding'); },
    console: { info(...args) { logs.push(args); } }
  });
  vm.runInContext(failureLibrary, context);
  context.WXSLIMShaderFailure = library.$WXSLIMShaderFailure;
  vm.runInContext(typeLibrary, context);
  context.WXSLIMShaderTypeReturn = library.$WXSLIMShaderTypeReturn;
  // Owned, independent adapter fixture; no target JS/WASM or batch decoder runs.
  vm.runInContext(`function ownedIntAdapter(ptr,bufferLen) {
    ${ENTRY}
    const view = new Uint32Array(Module.HEAPU8.buffer,ptr,bufferLen/4);
    if (!Module.wxContextGlobal) return -1;
    const wxslimTypeRaw = Module.wxContextGlobal.batchRender(view);
    ${OBSERVE}
    return wxslimTypeRaw;
  }`, context);
  const call = (name, ...args) => library['wxslim_shader_failure_' + name](...args);
  return { Module, platform, context, calls, logs, heap, call,
    begin: () => call('begin', 1, 1, 35633, 0, 0, 0, 0, 0, 1),
    arm: () => call('arm_type'), adapter: () => context.ownedIntAdapter(8, 12),
    state: () => Module.__wxslimShaderFailureStateV1,
    record: () => Module.__wxslimShaderFailureStateV1?.record.GLX_TYPE_RAW_RETURN };
}

test('patch accepts exactly one pinned Int anchor and preserves all surrounding glue', () => {
  for (const source of ['', ANCHOR + ANCHOR]) assert.throws(() => instrumentGlue(source), /exactly one/);
  assert.throws(() => instrumentGlue(null), TypeError);
  const suffix = ';var wasmImports={owned:evalBatchRenderSyncInt};/*String adapter unchanged*/';
  const source = '/*owned prefix*/' + ANCHOR + suffix;
  const result = instrumentGlue(source);
  assert.equal(result.split(MARKER).length, 2);
  assert.throws(() => instrumentGlue(result), /already present/);
  assert.equal(result.replace(ENTRY, '').replace(OBSERVE, '')
    .replace('const wxslimTypeRaw=Module.wxContextGlobal.batchRender(view);return wxslimTypeRaw',
      'return Module.wxContextGlobal.batchRender(view)'), source);
  assert.ok(result.endsWith(suffix));
});

test('one armed token observes one return; original receiver/view/heap and return are preserved', () => {
  const f = fixture(); f.begin(); f.arm();
  assert.equal(f.adapter(), 35632);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.platform);
  assert.equal(f.calls[0].view.buffer, f.heap.buffer);
  assert.equal(f.calls[0].view.byteOffset, 8);
  assert.equal(f.calls[0].view.byteLength, 12);
  const r = f.record();
  assert.equal(r.takeCount, 1); assert.equal(r.captureCount, 1);
  assert.equal(r.ptr, 8); assert.equal(r.byteLength, 12);
  assert.equal(r.numericValue, 35632); assert.equal(r.returnObserved, true);
  const snapshot = JSON.stringify(r);
  f.adapter(); assert.equal(f.calls.length, 2); assert.equal(JSON.stringify(r), snapshot);
});

test('primitive categories retain finite numbers only and never retain raw containers', () => {
  for (const raw of [35632, 35633, '35632', [], null, undefined, NaN, Infinity, -Infinity, true, 7n, Symbol('owned')]) {
    const f = fixture({ raw }); f.begin(); f.arm();
    assert.equal(f.adapter(), raw);
    const r = f.record();
    assert.equal(r.rawType, typeof raw); assert.equal(r.rawNull, raw === null);
    assert.equal(r.captureCount, 1); assert.equal(r.returnObserved, true);
    assert.equal('numericValue' in r, typeof raw === 'number' && Number.isFinite(raw));
    assert.equal('numericFinite' in r, typeof raw === 'number');
    if (typeof raw === 'number') assert.equal(r.numericFinite, Number.isFinite(raw));
    assert.ok(Object.values(r).every(value => value !== raw || typeof raw === 'number' || typeof raw === 'boolean'));
    assert.doesNotThrow(() => JSON.stringify(r));
  }
});

test('hostile object getters, coercion methods, proxies and revoked proxies remain untouched', () => {
  let touches = 0;
  const fail = () => { touches++; throw new Error('raw object touched'); };
  const object = Object.defineProperties({}, {
    valueOf: { get: fail }, toString: { get: fail }, toJSON: { get: fail },
    [Symbol.toPrimitive]: { get: fail }
  });
  const proxy = new Proxy(object, { get: fail, ownKeys: fail, getPrototypeOf: fail });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const raw of [object, proxy, revoked.proxy]) {
    const f = fixture({ raw }); f.begin(); f.arm();
    assert.equal(f.adapter(), raw); assert.equal(touches, 0);
    assert.equal(f.record().rawType, 'object');
    f.call('end'); assert.equal(f.logs.length, 1); assert.equal(touches, 0);
  }
});

test('batch is not parsed or read and observer consumes the exact platform view', () => {
  const f = fixture(); f.begin(); f.arm();
  f.state().typeTake = function (ptr, len) {
    assert.equal(ptr, 8); assert.equal(len, 12);
    return { capture(raw) {
      assert.equal(raw, 35632);
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].view.buffer, f.heap.buffer);
    } };
  };
  // Arbitrary opaque bytes: the observer must not require valid batch opcodes.
  f.heap.fill(255); assert.equal(f.adapter(), 35632);
  assert.equal(f.calls.length, 1); assert.ok(f.heap.every(byte => byte === 255));
});

test('original platform exception escapes unchanged and never becomes an observed return', () => {
  const original = new Error('owned batch failure');
  const f = fixture({ batchError: original }); f.begin(); f.arm();
  assert.throws(f.adapter, error => error === original);
  assert.equal(f.calls.length, 1); assert.equal(f.record().takeCount, 1);
  assert.equal(f.record().captureCount, 0); assert.equal(f.record().returnObserved, false);
});

test('observer entry/capture errors are isolated without swallowing platform exceptions', () => {
  for (const phase of ['state', 'take', 'capture']) {
    const f = fixture(); f.begin(); f.arm();
    if (phase === 'state') Object.defineProperty(f.Module, '__wxslimShaderFailureStateV1', { get() { throw new Error('observer'); } });
    if (phase === 'take') f.state().typeTake = () => { throw new Error('observer'); };
    if (phase === 'capture') f.state().typeTake = () => ({ capture() { throw new Error('observer'); } });
    assert.equal(f.adapter(), 35632); assert.equal(f.calls.length, 1);
    assert.doesNotThrow(f.arm);
  }
  const original = new Error('platform still escapes');
  const f = fixture({ batchError: original }); f.begin();
  f.state().typeTake = () => { throw new Error('observer'); };
  assert.throws(f.adapter, error => error === original);
});

test('WebGL, absent failure, unarmed and ended failure never create raw return records', () => {
  for (const glx of [false, undefined, 1, 'true']) {
    const f = fixture({ glx }); f.context.GameGlobal.__godotMinigameWXGLXEnabled = glx;
    assert.equal(f.begin(), 0); f.arm(); f.adapter();
    assert.equal(f.state(), undefined); assert.equal(f.logs.length, 0);
  }
  const noFailure = fixture(); noFailure.arm(); noFailure.adapter(); assert.equal(noFailure.state(), undefined);
  const unarmed = fixture(); unarmed.begin(); unarmed.adapter(); assert.equal(unarmed.record(), undefined);
  const ended = fixture(); ended.begin(); ended.call('end'); ended.arm(); ended.adapter(); assert.equal(ended.record(), undefined);
});

test('missing context consumes at most one token without fabricating a raw return', () => {
  const f = fixture({ missing: true }); f.begin(); f.arm();
  assert.equal(f.adapter(), -1); assert.equal(f.calls.length, 0);
  assert.equal(f.record().takeCount, 1); assert.equal(f.record().captureCount, 0);
  assert.equal(f.record().returnObserved, false);
  f.adapter(); assert.equal(f.record().takeCount, 1);
});

test('duplicate arms before or after take invalidate the claim and never observe a second return', () => {
  for (const afterTake of [false, true]) {
    const f = fixture(); f.begin(); f.arm();
    if (afterTake) f.adapter();
    f.arm(); f.adapter();
    assert.equal(f.record().armCount, 2); assert.equal(f.record().validArmCount, false);
    assert.equal(f.record().takeCount, afterTake ? 1 : 0);
    assert.equal(f.record().captureCount, afterTake ? 1 : 0);
  }
});

// Handwritten independent WASM: import env.raw:()->i32; export run:()->i32.
// This is not an engine binary and contains no GL or third-party code.
const i32Boundary = new WebAssembly.Module(Uint8Array.from([
  0,97,115,109,1,0,0,0, 1,5,1,96,0,1,127,
  2,11,1,3,101,110,118,3,114,97,119,0,0,
  3,2,1,0, 7,7,1,3,114,117,110,0,1,
  10,6,1,4,0,16,0,11
]));

test('independent WASM distinguishes observed raw category from imported i32 conversion', () => {
  for (const [raw, expected] of [[35632,35632], [35633,35633], ['35632',35632], [null,0], [undefined,0], [NaN,0], [Infinity,0], [[],0], [[35633],35633]]) {
    const f = fixture({ raw }); f.begin(); f.arm();
    const wasm = new WebAssembly.Instance(i32Boundary, { env: { raw: f.adapter } });
    assert.equal(wasm.exports.run(), expected);
    assert.equal(f.record().rawType, typeof raw);
    assert.equal('numericValue' in f.record(), typeof raw === 'number' && Number.isFinite(raw));
    assert.equal(f.calls.length, 1);
  }
  let conversions = 0;
  const raw = { valueOf() { conversions++; return 35632; } };
  const f = fixture({ raw }); f.begin(); f.arm();
  const wasm = new WebAssembly.Instance(i32Boundary, { env: { raw: f.adapter } });
  assert.equal(wasm.exports.run(), 35632); assert.equal(conversions, 1);
  assert.equal(f.record().rawType, 'object'); assert.equal('numericValue' in f.record(), false);
});

test('WASM conversion exceptions remain distinct from successful raw-return observation', () => {
  const original = new Error('owned i32 coercion failure');
  const raw = { valueOf() { throw original; } };
  const f = fixture({ raw }); f.begin(); f.arm();
  const wasm = new WebAssembly.Instance(i32Boundary, { env: { raw: f.adapter } });
  assert.throws(() => wasm.exports.run(), error => error === original);
  assert.equal(f.record().returnObserved, true);
  assert.equal(f.record().rawType, 'object');
  assert.equal(f.record().captureCount, 1); assert.equal(f.calls.length, 1);
  for (const value of [7n, Symbol('owned')]) {
    const g = fixture({ raw: value }); g.begin(); g.arm();
    const instance = new WebAssembly.Instance(i32Boundary, { env: { raw: g.adapter } });
    assert.throws(() => instance.exports.run(), TypeError);
    assert.equal(g.record().returnObserved, true);
    assert.equal(g.record().rawType, typeof value);
  }
});
