'use strict';
const assert = require('node:assert/strict');
const { create, createCheckpoints } = require('./ledger.cjs');
let passed = 0;
function test(name, body) { body(); passed++; console.log('PASS', name); }
function fake(config = {}) {
  const timers = [], logs = [];
  let time = 100;
  const root = {
    Date: { now() { if (config.clockThrow) throw config.clockThrow; return config.clockValue === undefined ? time : config.clockValue; } },
    setTimeout(fn, delay) { if (config.timerThrow) throw config.timerThrow; timers.push({ fn, delay }); },
    console: { info(...args) { logs.push(args); if (config.consoleThrow) throw config.consoleThrow; } }
  };
  return { root, timers, logs, tick(value) { time = value; } };
}
function checkpoints(host, extra = {}) {
  return createCheckpoints({ root: host.root, packageId: 'test-package', sessionTag: 'test-session', readSnapshot: () => create().snapshot(), ...extra });
}
function payload(log) { assert.ok(log[0].startsWith('[GLX_TRIANGLE_CHECKPOINT] ')); return JSON.parse(log[0].slice('[GLX_TRIANGLE_CHECKPOINT] '.length)); }
test('return and throw transitions, independent snapshot copies', () => {
  const ledger = create();
  const first = ledger.begin('entry', 1);
  ledger.finish(first, 'return');
  const second = ledger.begin('entry', 2);
  ledger.finish(second, 'throw');
  const view = ledger.snapshot();
  assert.deepEqual(view.stages, [{ stage: 'entry', enter: 2, return: 1, throw: 1 }]);
  assert.deepEqual(view.last.map(item => item.kind), ['enter', 'return', 'enter', 'throw']);
  assert.equal(view.transition, 4);
  view.stages[0].enter = 99; view.last[0].stage = 'changed'; view.open.push({}); view.flags.countInvalid = true;
  assert.equal(ledger.snapshot().stages[0].enter, 2);
  assert.equal(ledger.snapshot().last[0].stage, 'entry');
  assert.equal(ledger.snapshot().flags.countInvalid, false);
});
test('synthetic probe preserves arbitrary thrown values and performs no then access', () => {
  const ledger = create();
  function invoke(fn, ordinal) { const token = ledger.begin('invoke', ordinal); try { const value = fn(); ledger.finish(token, 'return'); return value; } catch (error) { ledger.finish(token, 'throw'); throw error; } }
  const thrownValues = [NaN, undefined, null, 0, false, 'error', Symbol('error'), {}];
  thrownValues.forEach((value, index) => { let caught = false; try { invoke(() => { throw value; }, index); } catch (error) { caught = true; assert.ok(Object.is(error, value)); } assert.ok(caught); });
  const thenable = Object.defineProperty({}, 'then', { get() { throw Error('then accessed'); } });
  assert.equal(invoke(() => thenable, 20), thenable);
  assert.equal(ledger.snapshot().stages[0].throw, thrownValues.length);
});
test('nested calls, out of order completion and depth limits', () => {
  const ledger = create(); const tokens = [];
  for (let i = 0; i < 40; i++) tokens.push(ledger.begin('nested', i));
  const view = ledger.snapshot();
  assert.equal(view.active, 40); assert.equal(view.open.length, 16); assert.equal(view.last.length, 16); assert.equal(view.flags.openOverflow, true);
  for (const token of tokens) ledger.finish(token, 'return');
  assert.equal(ledger.snapshot().active, 0); assert.equal(ledger.snapshot().open.length, 0);
  assert.equal(ledger.snapshot().stages[0].return, 40);
  assert.equal(ledger.finish(tokens[0], 'return'), false);
});
test('invalid inputs and stage overflow stay bounded', () => {
  const ledger = create();
  for (let i = 0; i < 40; i++) ledger.finish(ledger.begin('stage' + i, i), 'return');
  ledger.begin({ toString() { throw Error('coercion'); } }, NaN);
  ledger.finish(null, 'throw');
  const view = ledger.snapshot();
  assert.equal(view.stages.length, 16); assert.equal(view.flags.stageOverflow, true);
  assert.equal(view.flags.invalidStage, true); assert.equal(view.flags.invalidOrdinal, true); assert.equal(view.flags.invalidFinish, true);
});
test('exactly two one shot timers, duplicate arm/fire suppressed, no renderer work', () => {
  const host = fake(); let reads = 0;
  host.root.requestAnimationFrame = host.root.flush = host.root.swap = () => { throw Error('renderer called'); };
  const observer = checkpoints(host, { readSnapshot() { reads++; return create().snapshot(); } });
  observer.arm(); observer.arm();
  assert.deepEqual(host.timers.map(timer => timer.delay), [4000, 9000]);
  host.tick(4100); host.timers[0].fn(); host.timers[0].fn();
  host.tick(9100); host.timers[1].fn(); host.timers[1].fn();
  assert.equal(reads, 2); assert.equal(host.logs.length, 2);
  assert.equal(observer.snapshot().outputAttempts, 2); assert.equal(observer.snapshot().duplicateArm, true);
  const output = payload(host.logs[0]);
  assert.equal(output.schema, 'triangle-execution-checkpoint-v1'); assert.equal(output.checkpoint, 1); assert.equal(output.plannedDelayMs, 4000);
  assert.equal(output.elapsedMs, 4000); assert.equal(output.actualAt.raw, 4100); assert.equal(output.scheduledAt.raw, 100);
});
test('timer registration errors are recorded with no retry', () => {
  const host = fake({ timerThrow: 'timer-error' }); const observer = checkpoints(host);
  observer.arm(); observer.arm();
  assert.equal(host.timers.length, 0);
  for (const plan of observer.snapshot().plans) assert.equal(plan.registrationError.thrown, 'timer-error');
});
test('reader, console and clock exceptions are isolated', () => {
  const host = fake({ consoleThrow: 'console-error', clockThrow: 'clock-error' });
  const observer = checkpoints(host, { readSnapshot() { throw 'reader-error'; } });
  observer.arm(); host.timers.forEach(timer => timer.fn());
  const view = observer.snapshot();
  assert.equal(view.outputAttempts, 2);
  for (const plan of view.plans) {
    assert.equal(plan.readerError.thrown, 'reader-error'); assert.equal(plan.outputError.thrown, 'console-error');
    assert.equal(plan.actualAt.valid, false); assert.equal(plan.elapsedValid, false); assert.equal(plan.elapsedMs, null);
  }
});
test('clock NaN, backwards time and throwing clock getter', () => {
  const host = fake({ clockValue: NaN }); const observer = checkpoints(host); observer.arm(); host.timers[0].fn();
  assert.equal(observer.snapshot().plans[0].elapsedValid, false);
  const backwards = fake(); const other = checkpoints(backwards); other.arm(); backwards.tick(50); backwards.timers[0].fn();
  assert.equal(other.snapshot().plans[0].elapsedValid, false);
  const getter = fake(); Object.defineProperty(getter.root, 'Date', { get() { throw 'date-getter'; } });
  const last = checkpoints(getter); last.arm(); getter.timers[0].fn(); assert.equal(last.snapshot().scheduledAt.error.thrown, 'date-getter');
});
test('getters/cycles/proxies in reader data do not escape or invoke accessors', () => {
  const host = fake(); let getterCalls = 0;
  const data = { plain: 1 }; data.self = data;
  Object.defineProperty(data, 'trap', { enumerable: true, get() { getterCalls++; throw Error('getter'); } });
  data.proxy = new Proxy({}, { ownKeys() { throw 'proxy'; } });
  const observer = checkpoints(host, { readSnapshot: () => data }); observer.arm(); host.timers[0].fn();
  const output = payload(host.logs[0]);
  assert.equal(getterCalls, 0); assert.equal(output.snapshot.trap.unavailable, 'accessor');
  assert.equal(output.snapshot.self.unavailable, 'cycle'); assert.equal(output.snapshot.proxy.unavailable, 'copy-error');
});
test('reentrant reader cannot duplicate arm or either checkpoint', () => {
  const host = fake(); let observer;
  observer = checkpoints(host, { readSnapshot() { observer.arm(); host.timers[0].fn(); host.timers[1].fn(); return { done: true }; } });
  observer.arm(); host.timers[0].fn();
  assert.equal(host.timers.length, 2); assert.equal(host.logs.length, 2); assert.equal(observer.snapshot().outputAttempts, 2);
});
test('stale or unreadable session suppresses checkpoint output', () => {
  const host = fake(); let current = 'new-session';
  const observer = checkpoints(host, { readSessionTag() { if (current === 'throw') throw 'session-error'; return current; } });
  observer.arm(); host.timers[0].fn(); current = 'throw'; host.timers[1].fn();
  assert.equal(host.logs.length, 0); assert.equal(observer.snapshot().plans[0].staleSession, true);
  assert.equal(observer.snapshot().plans[1].sessionReadError.thrown, 'session-error');
});
test('large sparse arrays and deep reader trees produce bounded markers', () => {
  const host = fake(); const sparse = []; sparse[100000000] = 1;
  let tree = {}; const top = tree; for (let i = 0; i < 100; i++) { tree.next = {}; tree = tree.next; }
  const observer = checkpoints(host, { readSnapshot: () => ({ sparse, top }) }); observer.arm(); host.timers[0].fn();
  const output = payload(host.logs[0]);
  assert.equal(output.snapshot.sparse.unavailable, 'array-length'); assert.ok(host.logs[0][0].length < 10000);
});
test('timer and console getters are isolated and elapsed overflow invalidates time', () => {
  const host = fake(); Object.defineProperty(host.root, 'setTimeout', { get() { throw 'timer-getter'; } });
  const observer = checkpoints(host); observer.arm(); assert.equal(observer.snapshot().plans[0].registrationError.thrown, 'timer-getter');
  const consoleHost = fake(); const other = checkpoints(consoleHost); other.arm();
  Object.defineProperty(consoleHost.root, 'console', { get() { throw 'console-getter'; } });
  consoleHost.timers[0].fn(); assert.equal(other.snapshot().plans[0].outputError.thrown, 'console-getter');
  const overflow = fake(); overflow.tick(-Number.MAX_VALUE); const last = checkpoints(overflow); last.arm(); overflow.tick(Number.MAX_VALUE); overflow.timers[0].fn();
  assert.equal(last.snapshot().plans[0].elapsedValid, false);
});
console.log('Ledger fake-only tests passed:', passed);
