import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {auditBuffers} from '../engine/audit-pair.mjs';

const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function fixture() {
  // One valid void function exported under four names; validates mapping checks without running it.
  const wasm = Buffer.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,17,4,1,97,0,0,1,98,0,0,1,99,0,0,1,100,0,0,10,4,1,2,0,11]);
  const glue = Buffer.from('WXMEMFS callMain copyToFS GodotJSWrapper __godotMinigameOriginalCommitFrame __godotMinigameWXGLXEnabled; ' +
    ['_glxInit', '_glxInitBufferDataAndGlState', '_glxUpdateContextId', '_glxCommandBufferFlush'].map((n, i) => `Module["${n}"]=${n}=wasmExports["${'abcd'[i]}"];`).join('') +
    'Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();});Module.wxContextGlobal.batchRenderAsync(view);Module.wxContextGlobal.swapWindow();');
  const compressed = zlib.brotliCompressSync(wasm), input = {glue, wasm, compressed, build: {finishedAt: 'test', outputs: {}}};
  seal(input); return input;
}
function seal(input) {
  for (const [name, b] of [['godot.js', input.glue], ['godot.wasm', input.wasm], ['godot.wasm.br', input.compressed]]) input.build.outputs[name] = {bytes: b.length, sha256: hash(b)};
}
test('static audit connects generated GLX names to actual WASM exports without claiming rendering', () => {
  const result = auditBuffers(fixture()); assert.equal(result.nativeMapping._glxInit, 'a');
  assert.equal(result.exports.length, 4); assert.equal(result.initialization, 'not_run'); assert.equal(result.visibleRendering, 'not_verified');
});
test('mixed JS from another build is rejected even if WASM still decodes', () => {
  const input = fixture(); input.glue = Buffer.concat([input.glue, Buffer.from(' changed')]);
  assert.throws(() => auditBuffers(input), /Build output mismatch: godot.js/);
});
test('self-consistent hashes cannot hide a glue mapping to a missing native function', () => {
  const input = fixture(); input.glue = Buffer.from(input.glue.toString().replace('wasmExports["a"]', 'wasmExports["missing"]')); seal(input);
  assert.throws(() => auditBuffers(input), /Native export mapping/);
});
test('unfinished build and truncated WASM fail the static audit', () => {
  const input = fixture(); delete input.build.finishedAt; assert.throws(() => auditBuffers(input), /Complete BUILD/);
  input.build.finishedAt = 'test'; input.wasm = input.wasm.subarray(0, -1); input.compressed = zlib.brotliCompressSync(input.wasm); seal(input);
  assert.throws(() => auditBuffers(input), WebAssembly.CompileError);
});
