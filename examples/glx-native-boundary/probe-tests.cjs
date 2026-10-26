'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('./probe.cjs');
function fixture() {
    const events = [], root = { console: { info(text) { events.push(JSON.parse(text.slice('[GLX_TRIANGLE_BOUNDARY] '.length))); } } };
    const probe = create(root, { packageId: 'fake-package' });
    return { root, events, probe };
}
test('create is silent/read-only and startup captures own data without invoking getters', () => {
    let reads = 0;
    const root = { console: { info(text) { events.push(JSON.parse(text.slice('[GLX_TRIANGLE_BOUNDARY] '.length))); } }, __nativeTriangleHostStarted: true, __isAdapterInjected: true, __nativeTriangleBoundary: { old: true } };
    Object.defineProperty(root, '__glxTriangleLocalObserverV1', { get() { reads++; throw Error('getter'); } });
    const before = Object.getOwnPropertyDescriptors(root), events = [];
    const probe = create(root, { packageId: 'fake' });
    assert.equal(events.length, 0); assert.equal(reads, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(root), before);
    probe.bindSession('session'); assert.equal(reads, 0); assert.equal(events.length, 1);
    assert.equal(events[0].detail.startupMarkers.__glxTriangleLocalObserverV1.descriptor, 'accessor-not-read');
    assert.equal(events[0].detail.startupMarkers.__nativeTriangleHostStarted.value, true);
    assert.deepEqual(Object.getOwnPropertyDescriptors(root), before);
});
test('session binds once, same value no reemit, different throws', () => {
    const { probe, events } = fixture(); probe.bindSession('one'); probe.bindSession('one');
    assert.equal(events.length, 1); assert.throws(() => probe.bindSession('two'), /immutable/);
    assert.equal(probe.snapshot().sessionTag, 'one');
});
test('invoke exact receiver args result and selected 1/2/61 ordinals', () => {
    const { probe, events } = fixture(); probe.bindSession('s');
    const receiver = {}, token = {}, arg = {};
    function fn(a, b) { assert.equal(this, receiver); assert.equal(a, arg); assert.equal(b, 7); return token; }
    for (let i = 0; i < 62; i++) assert.equal(probe.invoke('stage', fn, receiver, [arg, 7]), token);
    assert.deepEqual(events.filter(e => e.kind === 'enter').map(e => e.ordinal), [1, 2, 61]);
    assert.deepEqual(events.filter(e => e.kind === 'return').map(e => e.ordinal), [1, 2, 61]);
    assert.equal(probe.snapshot().counts.stage, 62);
});
test('primitive/null/object original throw identity retained, getter fields never read, max4 diagnostics', () => {
    const { probe, events } = fixture(); probe.bindSession('s'); let reads = 0;
    const object = {}; Object.defineProperty(object, 'message', { get() { reads++; throw 3; } });
    Object.defineProperty(object, 'stack', { get() { reads++; throw 4; } });
    for (const value of [null, 42, 'unwind', object, Symbol('x'), false]) {
        let caught = 'not-caught'; try { probe.invoke('failure', () => { throw value; }, null, []); } catch (error) { caught = error; }
        assert.equal(caught, value);
    }
    assert.equal(reads, 0); assert.equal(events.filter(e => e.kind === 'throw').length, 4);
    assert.deepEqual(events.filter(e => e.kind === 'throw').map(e => e.detail.primitiveValue), [null, 42, 'unwind', undefined]);
    assert.deepEqual(events.filter(e => e.kind === 'throw').map(e => e.detail.primitiveValuePresent), [true, true, true, false]);
    assert.equal(probe.snapshot().throwEvents, 4);
});
test('throw own message and stack bounded', () => {
    const { probe, events } = fixture(); probe.bindSession('s'); const error = { message: 'x'.repeat(2000), stack: 'y'.repeat(2000) };
    assert.throws(() => probe.invoke('f', () => { throw error; }, null, []), value => value === error);
    const event = events.find(e => e.kind === 'throw'); assert.equal(event.detail.message.length, 1024); assert.equal(event.detail.stack.length, 1024);
});
test('console and stateReader failures isolated; original call/result and throw preserved', () => {
    const root = { console: { info() { throw Error('output'); } } }, probe = create(root, {});
    const main = { runIter(fn) { return fn(); }, requestAnimationFrame(fn) { return fn(); } };
    probe.installMainLoop(main, () => { throw Error('state'); }); probe.bindSession('s');
    assert.equal(main.runIter(() => 77), 77); const token = {}; assert.throws(() => main.runIter(() => { throw token; }), e => e === token);
    assert.ok(probe.snapshot().outputFailures > 0);
});
test('96 hardcap includes explicit terminal exhaustion, no more output, counts continue', () => {
    const { probe, events } = fixture(); probe.bindSession('s');
    for (let i = 0; i < 150; ++i) probe.notice('sample', { i });
    assert.equal(events.length, 96); assert.equal(events.at(-1).exhausted, true);
    assert.equal(events.at(-1).detail.kind, 'budget-exhausted'); assert.equal(events.at(-1).sequence, 96);
    assert.equal(probe.invoke('late', () => 'done', null, []), 'done'); assert.equal(events.length, 96);
    assert.equal(probe.snapshot().counts.late, 1); assert.equal(probe.snapshot().exhausted, true);
});
test('after-frame wraps flush once with exact args/receiver and captures old session', () => {
    const { probe, events, root } = fixture(); probe.bindSession('old'); const receiver = {}, arg = {}, returned = {}; let calls = 0;
    const callback = probe.wrapAfterFrame(function (x) { calls++; assert.equal(this, receiver); assert.equal(x, arg); return returned; });
    const newer = create(root, {}); newer.bindSession('new'); root.__nativeTriangleBoundary = newer;
    assert.equal(callback.call(receiver, arg), returned); assert.equal(calls, 1);
    const seen = events.filter(e => e.stage === 'after-frame' || e.stage === 'native-flush');
    assert.deepEqual(seen.map(e => e.stage + ':' + e.kind), ['after-frame:enter', 'native-flush:enter', 'native-flush:return', 'after-frame:return']);
    assert.ok(seen.every(e => e.sessionTag === 'old'));
});
test('install once, single original RAF request, delayed delivery, native delegate exact this/args', () => {
    const { probe, events } = fixture(); probe.bindSession('s'); const callbacks = [], frameReceiver = {}, arg = {}; let requests = 0, nativeCalls = 0;
    const main = { runIter(fn, extra) { assert.equal(this, main); assert.equal(extra, arg); return fn.call(frameReceiver, 33); }, requestAnimationFrame(fn, extra) { assert.equal(this, main); assert.equal(extra, arg); requests++; callbacks.push(fn); return 'raf-id'; } };
    assert.equal(probe.installMainLoop(main, () => ({ ABORT: false, runtimeExited: false, currentlyRunningMainloop: 0 })), true);
    assert.equal(probe.installMainLoop(main, () => ({})), false);
    function native(value) { nativeCalls++; assert.equal(this, frameReceiver); assert.equal(value, 33); return 'frame'; }
    assert.equal(main.requestAnimationFrame(function (stamp) { assert.equal(this, frameReceiver); assert.equal(stamp, 123); return main.runIter(native, arg); }, arg), 'raf-id');
    assert.equal(requests, 1); assert.equal(nativeCalls, 0);
    assert.equal(callbacks[0].call(frameReceiver, 123), 'frame'); assert.equal(nativeCalls, 1); assert.equal(requests, 1);
    assert.deepEqual(events.filter(e => e.kind === 'enter').map(e => e.stage), ['raf-request', 'raf-delivery', 'run-iter', 'native-callback']);
    assert.equal(events.find(e => e.stage === 'native-callback').runtime.ABORT, false);
});
test('snapshot detached, notice getters not called, no timers/Promise or generated code needed', () => {
    const { probe } = fixture(); probe.bindSession('s'); const detail = {}; let reads = 0;
    Object.defineProperty(detail, 'trap', { enumerable: true, get() { reads++; throw Error(); } });
    probe.notice('safe', detail); assert.equal(reads, 0);
    const snap = probe.snapshot(); snap.counts.bad = 7; assert.equal(probe.snapshot().counts.bad, undefined);
    assert.throws(() => create({}, {}).wrapAfterFrame(() => {}), /Bind session/);
});
test('nonfunction delegates preserve exact input to original methods and original failure', () => {
    const { probe } = fixture(); probe.bindSession('s');
    const tokens = [null, 17, 'callback', undefined, {}], originalError = 'original failure';
    let expected, calls = 0;
    const main = { runIter(fn) { calls++; assert.equal(fn, expected); throw originalError; }, requestAnimationFrame(fn) { calls++; assert.equal(fn, expected); return fn; } };
    probe.installMainLoop(main, () => ({}));
    for (const token of tokens) {
        expected = token;
        assert.throws(() => main.runIter(token), error => error === originalError);
        assert.equal(main.requestAnimationFrame(token), token);
    }
    assert.equal(calls, 10); assert.equal(probe.snapshot().counts['native-callback'], undefined); assert.equal(probe.snapshot().counts['raf-delivery'], undefined);
});
test('events expose prior send failures, throw count and reader failure without throwing', () => {
    const events = []; let sends = 0;
    const root = { console: { info(text) { if (++sends === 1) throw Error('first output lost'); events.push(JSON.parse(text.slice('[GLX_TRIANGLE_BOUNDARY] '.length))); } } };
    const probe = create(root, {}); probe.bindSession('s');
    const main = { runIter(fn) { return fn(); }, requestAnimationFrame(fn) { return fn; } };
    probe.installMainLoop(main, () => { throw Error('state read'); });
    assert.throws(() => main.runIter(() => { throw 123; }), e => e === 123);
    assert.ok(events.every(e => e.outputFailures === 1 && e.runtime.readFailed === true));
    const thrown = events.filter(e => e.kind === 'throw'); assert.deepEqual(thrown.map(e => e.throwEvents), [1, 2]);
    assert.ok(thrown.every(e => e.detail.primitiveValue === 123));
});
test('invoke does not access overwritten function apply or returned then getter', () => {
    const { probe } = fixture(); probe.bindSession('s'); let applyReads = 0, thenReads = 0, calls = 0;
    const result = {}; Object.defineProperty(result, 'then', { get() { thenReads++; throw Error('then'); } });
    const receiver = {}, arg = {};
    function fn(value) { calls++; assert.equal(this, receiver); assert.equal(value, arg); return result; }
    Object.defineProperty(fn, 'apply', { get() { applyReads++; throw Error('apply'); } });
    assert.equal(probe.invoke('safe-call', fn, receiver, [arg]), result);
    assert.equal(calls, 1); assert.equal(applyReads, 0); assert.equal(thenReads, 0);
});
test('nonfinite original number throws retain classification and original throw identity', () => {
    const { probe, events } = fixture(); probe.bindSession('s');
    for (const value of [NaN, Infinity, -Infinity]) {
        let observed; try { probe.invoke('nonfinite', () => { throw value; }, null, []); } catch (error) { observed = error; }
        assert.ok(Object.is(observed, value));
    }
    const thrown = events.filter(e => e.kind === 'throw');
    assert.deepEqual(thrown.map(e => e.detail.nonfiniteNumber), ['NaN', '+Infinity', '-Infinity']);
    assert.ok(thrown.every(e => e.detail.primitiveValuePresent === false && e.detail.thrownType === 'number' && !('primitiveValue' in e.detail)));
});
test('diagnostic console synchronous reentry is bounded and guard resets after console throw', () => {
    let probe, outputCalls = 0, appCalls = 0; const recorded = [];
    const root = { console: { info(text) {
        outputCalls++; recorded.push(JSON.parse(text.slice('[GLX_TRIANGLE_BOUNDARY] '.length)));
        probe.notice('console-recursion', {});
        if (outputCalls === 1) throw Error('console failed after reentry');
    } } };
    probe = create(root, {}); probe.bindSession('s');
    assert.equal(probe.invoke('app', () => { appCalls++; return 81; }, null, []), 81);
    assert.equal(appCalls, 1); assert.equal(outputCalls, 3);
    assert.equal(probe.snapshot().sequence, 3); assert.equal(probe.snapshot().outputFailures, 4);
    assert.equal(recorded[1].outputFailures, 2); assert.equal(recorded[2].outputFailures, 3);
    root.console.info = text => recorded.push(JSON.parse(text.slice('[GLX_TRIANGLE_BOUNDARY] '.length)));
    probe.notice('guard-reset', {}); assert.equal(recorded.at(-1).detail.kind, 'guard-reset');
});
