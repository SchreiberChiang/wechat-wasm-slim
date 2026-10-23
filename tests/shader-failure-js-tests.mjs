import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { instrumentGlue, ANCHOR, MARKER, ENTRY, OBSERVE } = require('../engine/shader-failure/instrument-glue.cjs');
const librarySource = fs.readFileSync(new URL('../engine/shader-failure/library.js', import.meta.url), 'utf8');

test('instrumentation CLI refuses in-place or existing output without changing either file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-shader-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.js'), output = path.join(dir, 'output.js');
  const cli = fileURLToPath(new URL('../engine/shader-failure/instrument-glue.cjs', import.meta.url));
  fs.writeFileSync(input, ANCHOR); fs.writeFileSync(output, 'preserved output');
  const same = spawnSync(process.execPath, [cli, input, input], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(same.status, 0); assert.match(same.stderr, /Input and output must be different paths/);
  const existing = spawnSync(process.execPath, [cli, input, output], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(existing.status, 0); assert.match(existing.stderr, /EEXIST/);
  assert.equal(fs.readFileSync(input, 'utf8'), ANCHOR); assert.equal(fs.readFileSync(output, 'utf8'), 'preserved output');
  const fresh = path.join(dir, 'fresh.js');
  const success = spawnSync(process.execPath, [cli, input, fresh], { encoding: 'utf8', windowsHide: true });
  assert.equal(success.status, 0, success.stderr); assert.equal(fs.readFileSync(fresh, 'utf8'), instrumentGlue(ANCHOR));
});

function fixture({ glx = true, response = 'void main(){}', missing = false } = {}) {
  const events = [], decoded = [], logs = [], library = {}, strings = new Map([[100, 'original shader'], [200, 'original compiler error']]);
  const Module = {
    wxContextGlobal: missing ? null : { batchRender() { events.push('batch'); return typeof response === 'function' ? response() : response; } },
    _malloc(n) { events.push(['malloc', n]); return 1700; },
    lengthBytesUTF8(s) { events.push(['length', s]); return Buffer.byteLength(s); },
    stringToUTF8(s, p, n) { events.push(['write', s, p, n]); }
  };
  const context = vm.createContext({ Module, GameGlobal: { __godotMinigameWXGLXEnabled: glx }, console: { info(...args) { logs.push(args); } },
    LibraryManager: { library }, mergeInto(target, value) { Object.assign(target, value); },
    UTF8ToString(p, n) { decoded.push([p, n]); return new TextDecoder().decode(Buffer.from(strings.get(p) || '').subarray(0, n)); }
  });
  vm.runInContext(librarySource, context);
  context.WXSLIMShaderFailure = library.$WXSLIMShaderFailure;
  // Independently owned adapter fixture. Never load/evaluate any target glue.
  // The actual injection snippets run around this fake's existing conversion/allocation path.
  vm.runInContext(`function ownedAdapter() {
    ${ENTRY}
    if (!Module.wxContextGlobal) return 0;
    const batchResult = Module.wxContextGlobal.batchRender('owned request');
    const batchResultStr = typeof batchResult === 'object' ? JSON.stringify(batchResult) : batchResult;
    const ptr = Module._malloc(Module.lengthBytesUTF8(batchResultStr) + 1);
    Module.stringToUTF8(batchResultStr, ptr, Module.lengthBytesUTF8(batchResultStr) + 1);
    ${OBSERVE}
    return ptr;
  }`, context);
  const call = (name, ...args) => library['wxslim_shader_failure_' + name](...args);
  return { Module, context, events, decoded, logs, strings, call,
    begin: () => call('begin', 4, 7, 35633, 2, -1, 9, 100, Buffer.byteLength(strings.get(100)), 12),
    adapter: () => context.ownedAdapter(), record: () => Module.__wxslimShaderFailureV1 };
}

test('postprocessor rejects missing/duplicate anchors and double patch; keeps adapter path/import mapping', () => {
  for (const source of ['', ANCHOR + ANCHOR]) assert.throws(() => instrumentGlue(source), /exactly one/);
  const input = '/*original marker*/' + ANCHOR + ';var wasmImports={vl:evalBatchRenderSyncString};';
  const result = instrumentGlue(input);
  assert.equal(result.split(MARKER).length, 2);
  assert.ok(result.endsWith(';var wasmImports={vl:evalBatchRenderSyncString};'));
  assert.ok(result.startsWith('/*original marker*/'));
  assert.throws(() => instrumentGlue(result), /already present/);
  assert.equal(result.replace(ENTRY, '').replace(OBSERVE, ''), input);
});

test('nonGLX and nonboolean pin have no state, pointer reads or records', () => {
  for (const glx of [false, undefined, 1, 'true']) {
    const f = fixture({ glx }); f.context.GameGlobal.__godotMinigameWXGLXEnabled = glx;
    assert.equal(f.begin(), 0); f.call('arm_source'); f.adapter(); f.call('observe', 1, 2, 3); f.call('error', 200, 4, 12); f.call('end');
    assert.equal(f.Module.__wxslimShaderFailureStateV1, undefined); assert.deepEqual(f.decoded, []); assert.equal(f.logs.length, 0);
  }
});

test('one failure captures explicit source/error/types/context and exact allocation/return sequence', () => {
  const f = fixture(); assert.equal(f.begin(), 1);
  assert.equal(f.adapter(), 1700); // Unarmed log-like string import is ignored.
  f.events.length = 0;
  f.call('arm_source'); assert.equal(f.adapter(), 1700);
  assert.deepEqual(f.events, ['batch', ['length', 'void main(){}'], ['malloc', 14], ['length', 'void main(){}'], ['write', 'void main(){}', 1700, 14]]);
  f.call('observe', 35633, 13, 12); f.call('error', 200, 23, 12); f.call('end'); f.call('end');
  const r = f.record(); assert.equal(r.GODOT_ORIGINAL.source.text, 'original shader');
  assert.equal(r.GLX_BATCH_RETURN.source.text, 'void main(){}'); assert.equal(r.error.text, 'original compiler error');
  assert.equal(r.batchReturnedType, 35633); assert.equal(r.batchReturnedSourceLength, 13);
  assert.equal(r.contextAtFailure, 12); assert.equal(r.contextAfterQueries, 12); assert.equal(r.contextAtError, 12);
  assert.equal(r.PLATFORM_ACTUAL_COMPILE_INPUT.available, false); assert.ok(Object.isFrozen(r.GLX_BATCH_RETURN.source));
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0][0], '[WXSLIM_SHADER_FAILURE_V1]');
  assert.equal(f.begin(), 0); assert.equal(f.logs.length, 1);
});

test('one-shot token is consumed at entry before nested calls', () => {
  let nested = false, f;
  f = fixture({ response: () => { if (!nested) { nested = true; f.adapter(); return 'outer shader'; } return 'nested log'; } });
  f.begin(); f.call('arm_source'); f.adapter(); f.call('end');
  assert.equal(f.record().GLX_BATCH_RETURN.source.text, 'outer shader');
  assert.equal(f.Module.__wxslimShaderFailureStateV1.armed, false);
});

test('objects/null convert once and remain uncertified shader text', () => {
  let conversions = 0;
  const response = { toJSON() { conversions++; return { error: 'platform failure' }; } };
  const f = fixture({ response }); f.begin(); f.call('arm_source'); f.adapter(); f.call('end');
  assert.equal(conversions, 1); assert.equal(f.record().GLX_BATCH_RETURN.available, false);
  assert.equal(f.record().GLX_BATCH_RETURN.source.text, '{"error":"platform failure"}');
  const n = fixture({ response: null }); n.begin(); n.call('arm_source'); n.adapter(); n.call('end');
  assert.equal(n.record().GLX_BATCH_RETURN.rawNull, true); assert.equal(n.record().GLX_BATCH_RETURN.source.text, 'null');
});

test('source and error UTF8 retention caps, JS lengths, embedded NUL and console bounds', () => {
  const f = fixture({ response: '💡'.repeat(6000) }); f.strings.set(100, '你'.repeat(9000)); f.strings.set(200, '\u0001'.repeat(8000));
  f.begin(); f.call('arm_source'); f.adapter(); f.call('error', 200, 8000, 12); f.call('end');
  const r = f.record();
  for (const source of [r.GODOT_ORIGINAL.source, r.GLX_BATCH_RETURN.source]) {
    assert.ok(Buffer.byteLength(source.text) <= 16384); assert.equal(source.truncated, true);
  }
  assert.equal(r.GLX_BATCH_RETURN.source.jsLength, 12000);
  assert.ok(Buffer.byteLength(r.error.text) <= 4096); assert.equal(r.error.truncated, true);
  assert.ok(Buffer.byteLength(f.logs[0][1]) <= 40960);
  assert.deepEqual(f.decoded, [[100, 16384], [200, 4096]]);
  const nul = fixture({ response: 'a\0b' }); nul.begin(); nul.call('arm_source'); nul.adapter(); nul.call('observe', 35633, 1, 12); nul.call('end');
  assert.equal(nul.record().GLX_BATCH_RETURN.source.jsLength, 3); assert.equal(nul.record().batchReturnedSourceLength, 1);
});

test('original exceptions and absent context keep return/throw behavior and clear source token', () => {
  for (const thrown of [new Error('raw batch failure'), 17, Infinity]) {
    const f = fixture({ response: () => { throw thrown; } }); f.begin(); f.call('arm_source');
    assert.throws(f.adapter, e => e === thrown);
    assert.equal(f.Module.__wxslimShaderFailureStateV1.armed, false); assert.deepEqual(f.events, ['batch']);
    f.call('end'); assert.equal(f.record().GLX_BATCH_RETURN.available, false);
  }
  const f = fixture({ missing: true }); f.begin(); f.call('arm_source'); assert.equal(f.adapter(), 0); f.call('end');
  assert.equal(f.Module.__wxslimShaderFailureStateV1.armed, false); assert.equal(f.record().GLX_BATCH_RETURN.available, false);
});

test('conversion errors are not rescued, observer-only errors never alter return', () => {
  const rawError = new Error('toJSON failure');
  const broken = fixture({ response: { toJSON() { throw rawError; } } }); broken.begin(); broken.call('arm_source');
  assert.throws(broken.adapter, e => e === rawError); assert.deepEqual(broken.events, ['batch']);
  const observer = fixture(); observer.begin(); observer.call('arm_source');
  observer.Module.__wxslimShaderFailureStateV1.capture = () => { throw new Error('observer only'); };
  assert.equal(observer.adapter(), 1700); assert.equal(observer.events.at(-1)[0], 'write');
  observer.call('observe', -2147483648, -2147483648, 12); observer.call('error', 0, 0, 12); observer.call('end');
  assert.equal(observer.record().error.available, false);
  for (const response of [undefined, 42, Symbol('unsupported'), { toJSON() { return undefined; } }]) {
    const f = fixture(); f.Module.wxContextGlobal.batchRender = () => response; f.begin(); f.call('arm_source');
    assert.throws(f.adapter); assert.equal(f.Module.__wxslimShaderFailureStateV1.armed, false);
    f.call('end'); assert.equal(f.record().GLX_BATCH_RETURN.available, false);
  }
});

test('context changes, query sentinels and repeated source arms invalidate association', () => {
  for (const [type, length, context] of [[35633, 13, 99], [-2147483648, 13, 12], [35633, -2147483648, 12]]) {
    const f = fixture(); f.begin(); f.call('arm_source'); f.adapter(); f.call('observe', type, length, context); f.call('end');
    assert.equal(f.record().GLX_BATCH_RETURN.available, false); assert.equal(f.record().sourceImportCount, 1);
    assert.equal(f.record().queryObservationCount, 1);
  }
  const f = fixture(); f.begin(); f.call('arm_source'); f.call('arm_source'); f.adapter(); f.call('observe', 35633, 13, 12); f.call('end');
  assert.equal(f.record().sourceArmCount, 2); assert.equal(f.record().GLX_BATCH_RETURN.available, false);
});

test('decode failure still claims first failure and remains reportable; JSON control expansion is capped', () => {
  const f = fixture(); f.context.UTF8ToString = () => { throw new Error('decode failure'); };
  assert.equal(f.begin(), 1); assert.equal(f.begin(), 0); f.call('end');
  assert.equal(f.record().GODOT_ORIGINAL.available, false); assert.equal(f.logs.length, 1);
  const c = fixture({ response: '\u0001'.repeat(20000) }); c.strings.set(100, '\u0002'.repeat(20000));
  c.begin(); c.call('arm_source'); c.adapter(); c.call('end');
  assert.equal(c.record().consolePrefixTruncated, true); assert.ok(Buffer.byteLength(c.logs[0][1]) <= 40960);
  assert.equal(c.record().GLX_BATCH_RETURN.source.jsLength, 20000); assert.equal(c.record().GLX_BATCH_RETURN.source.truncated, true);
});

test('observe/end disarm without a completed adapter and all diagnostic imports suppress own exceptions', () => {
  const f = fixture(); f.begin(); f.call('arm_source'); f.call('observe', 1, 2, 3);
  assert.equal(f.Module.__wxslimShaderFailureStateV1.armed, false);
  f.call('arm_source'); f.call('end'); assert.equal(f.Module.__wxslimShaderFailureStateV1.armed, false);
  const g = fixture(); Object.defineProperty(g.Module, '__wxslimShaderFailureStateV1', { get() { throw new Error('owned observer unavailable'); } });
  assert.equal(g.begin(), 0);
  for (const [name, args] of [['arm_source', []], ['observe', [1, 2, 3]], ['error', [200, 5, 12]], ['end', []]]) assert.doesNotThrow(() => g.call(name, ...args));
});
