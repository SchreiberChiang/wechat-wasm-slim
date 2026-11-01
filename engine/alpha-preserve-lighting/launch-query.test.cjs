'use strict';
// Host-only launch contract checks. Does not load an engine, WASM, or device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'launch-query.js'), 'utf8');
const cases = [
  ['empty query', { query: {} }, true, 'default', null],
  ['missing query', {}, true, 'default', null],
  ['null query', { query: null }, true, 'default', null],
  ['unrelated parameter', { query: { other: '1' } }, true, 'default', null],
  ['explicit enable', { query: { autotest: '1' } }, true, 'query', null],
  ['explicit disable', { query: { autotest: '0' } }, false, 'query', 'query_disabled'],
  ['numeric enable', { query: { autotest: 1 } }, true, 'query', null],
  ['numeric disable', { query: { autotest: 0 } }, false, 'query', 'query_disabled'],
  ['empty value', { query: { autotest: '' } }, false, 'query', 'autotest_invalid'],
  ['invalid value', { query: { autotest: 'bad' } }, false, 'query', 'autotest_invalid'],
  ['invalid options', null, false, 'unavailable', 'launch_options_invalid'],
  ['invalid query', { query: 'bad' }, false, 'unavailable', 'launch_query_invalid'],
];
for (const [name, options, enabled, activationSource, reason] of cases) {
  let reads = 0;
  const GameGlobal = {};
  vm.runInNewContext(source, { GameGlobal, wx: { getLaunchOptionsSync() { reads++; return options; } } });
  const result = GameGlobal.__TwoCaseLaunch;
  assert.equal(result.enabled, enabled, name);
  assert.equal(result.activationSource, activationSource, name);
  assert.equal(result.reason, reason, name);
  assert.equal(result.source, 'wx.getLaunchOptionsSync', name);
  assert.equal(reads, 1, name);
  assert(Object.isFrozen(result));
  const base = ['--main-pack', '/engine/empty-tips.bin'];
  const args = GameGlobal.__TwoCaseStartArgs(base);
  assert.equal(base.length, 2, 'must not mutate engine arguments');
  assert.equal(args[2], '--');
  assert.deepEqual(JSON.parse(args[3].slice('--wx-launch='.length)), JSON.parse(JSON.stringify(result)));
  assert.throws(() => GameGlobal.__TwoCaseStartArgs(['--']));
}
for (const [name, wx, reason] of [
  ['missing API', {}, 'launch_api_unavailable'],
  ['throwing API', { getLaunchOptionsSync() { throw new Error('fixture'); } }, 'launch_query_throw'],
]) {
  const GameGlobal = {};
  vm.runInNewContext(source, { GameGlobal, wx });
  assert.equal(GameGlobal.__TwoCaseLaunch.enabled, false, name);
  assert.equal(GameGlobal.__TwoCaseLaunch.reason, reason, name);
}
console.log('14 launch cases passed; engine, WASM and rendering not executed.');
