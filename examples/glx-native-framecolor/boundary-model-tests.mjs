import test from 'node:test';
import assert from 'node:assert/strict';

// Hand-written conditional models of the audited ordering, NOT execution of
// Emscripten, GLX, adapter, generated JS, WASM, RAF or a display compositor.
// Passing these cases only checks what the proposed observations can distinguish.
function model({ inlineSubmit = false, throwInSubmit = false, pauseAfterNative = false,
    dropLaterColorLogs = false, updateDisplay = true } = {}) {
    const state = { delivered: 0, nativeEntries: 0, nativeReturns: 0,
        submitEntries: 0, submitReturns: 0, successorRequests: 0,
        colorLogs: [], calculated: [], shown: [], nativeAbortEvents: 0 };
    const submit = () => {
        state.submitEntries++;
        if (throwInSubmit) throw Error('model submit exception');
        state.submitReturns++;
        if (updateDisplay) state.shown.push(state.calculated.at(-1));
    };
    const native = () => {
        const frame = ++state.nativeEntries;
        const phase = Math.floor((frame - 1) / 60) % 3;
        state.calculated.push(phase);
        if ((frame - 1) % 60 === 0 && (!dropLaterColorLogs || frame === 1)) state.colorLogs.push(frame);
        if (inlineSubmit) submit();
        state.nativeReturns++;
    };
    const runner = () => {
        state.delivered++;
        // Mirrors ordinary-error rethrow and successor placement only. Real
        // runtimeExit/ABORT/unwind/blockers and platform behavior are not modeled.
        native();
        if (pauseAfterNative) return;
        state.successorRequests++;
    };
    return { state, runner, submit };
}

test('model: normal native return precedes successor request', () => {
    const m = model();
    m.runner(); m.runner();
    assert.equal(m.state.nativeReturns, 2);
    assert.equal(m.state.successorRequests, 2);
    assert.deepEqual(m.state.colorLogs, [1]);
});

test('model: COLOR1 can exist although native did not return and successor was not requested', () => {
    const m = model({ inlineSubmit: true, throwInSubmit: true });
    assert.throws(m.runner, /model submit exception/);
    assert.deepEqual(m.state.colorLogs, [1]);
    assert.equal(m.state.nativeReturns, 0);
    assert.equal(m.state.successorRequests, 0);
    assert.equal(m.state.submitEntries, 1);
    assert.equal(m.state.submitReturns, 0);
    assert.equal(m.state.nativeAbortEvents, 0);
});

test('model: submit exception outside an already returned runner does not undo its request', () => {
    const m = model({ throwInSubmit: true });
    m.runner();
    assert.throws(m.submit, /model submit exception/);
    assert.equal(m.state.nativeReturns, 1);
    assert.equal(m.state.successorRequests, 1);
});

test('model: missing COLOR61 is compatible with 60 completed native callbacks', () => {
    const m = model();
    for (let i = 0; i < 60; i++) m.runner();
    assert.equal(m.state.nativeReturns, 60);
    assert.deepEqual(m.state.colorLogs, [1]);
    assert.ok(m.state.calculated.every(phase => phase === 0));
});

test('model: a generation/pause gate after native can omit successor without an exception', () => {
    const m = model({ pauseAfterNative: true });
    assert.doesNotThrow(m.runner);
    assert.equal(m.state.nativeReturns, 1);
    assert.equal(m.state.successorRequests, 0);
});

test('model: callback progression with no presentation still produces COLOR61 if logging works', () => {
    const m = model({ updateDisplay: false });
    for (let i = 0; i < 61; i++) { m.runner(); m.submit(); }
    assert.equal(m.state.nativeReturns, 61);
    assert.deepEqual(m.state.colorLogs, [1, 61]);
    assert.equal(m.state.calculated.at(-1), 1);
    assert.deepEqual(m.state.shown, []);
});

test('model: missing logging plus missing presentation can imitate COLOR1 and a static screen', () => {
    const m = model({ dropLaterColorLogs: true, updateDisplay: false });
    for (let i = 0; i < 61; i++) { m.runner(); m.submit(); }
    assert.equal(m.state.nativeReturns, 61);
    assert.deepEqual(m.state.colorLogs, [1]);
    assert.equal(m.state.calculated.at(-1), 1);
    assert.deepEqual(m.state.shown, []);
});
