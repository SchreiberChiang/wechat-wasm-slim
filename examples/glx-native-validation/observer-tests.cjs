'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./observer.cjs');
function fixture(system = { model: 'fake', system: 'testOS', version: 'wx', SDKVersion: 'sdk' }) {
    const events = [], originals = [], handlers = {}, unexpected = [];
    const root = { console: { log: value => originals.push(['log', value]), error: value => originals.push(['error', value]), info: value => originals.push(['info', value]) } };
    const allowed = {
        getSystemInfoSync: () => system,
        getLaunchOptionsSync: () => ({ scene: 1001, query: { secret: 'MUST_NOT_RECORD' } }),
        onShow: fn => { handlers.show = fn; }, onHide: fn => { handlers.hide = fn; },
        onError: fn => { handlers.error = fn; }, onUnhandledRejection: fn => { handlers.rejection = fn; }
    };
    // Any context, transport, storage, timer or other wx access fails the test.
    const wx = new Proxy(allowed, { get(target, key) { if (!(key in target)) unexpected.push(String(key)); assert.ok(key in target, 'Unexpected wx API: ' + String(key)); return target[key]; } });
    const observer = start(root, wx, { packageId: 'pkg' }, event => events.push(event));
    return { events, originals, handlers, root, wx, observer, unexpected };
}
test('session association, duplicate rejection and independent new session', () => {
    const a = fixture(), b = fixture();
    assert.throws(() => start(a.root, a.wx, { packageId: 'pkg' }), /already started/);
    assert.notEqual(a.observer.sessionTag, b.observer.sessionTag);
    a.handlers.show({ scene: 1002, query: { secret: 'MUST_NOT_RECORD' } });
    a.observer.host({ status: 'initialization-snapshot', nested: { a: 1 } });
    for (const event of a.events) {
        assert.equal(event.packageId, 'pkg'); assert.equal(event.sessionTag, a.observer.sessionTag);
    }
    const serialized = JSON.stringify(a.events);
    assert.ok(!serialized.includes('MUST_NOT_RECORD'));
    assert.ok(!serialized.includes('visiblePass'));
    assert.equal(a.events.at(-1).detail.visibleValidation, 'NOT_RUN');
    assert.equal(a.events.at(-1).detail.summary.status, 'initialization-snapshot');
});
test('shader JSON budget and full original stdout/stderr remain intact', () => {
    const f = fixture();
    const longError = 'E'.repeat(6000);
    f.observer.native(longError, true);
    f.observer.native('[GLX_TRIANGLE_SHADER]broken', true);
    f.observer.native('[GLX_TRIANGLE_SHADER][]', false);
    for (let i = 0; i < 6; i++) f.observer.native('[GLX_TRIANGLE_SHADER]' + JSON.stringify({ i, note: longError }), false);
    assert.equal(f.events.filter(e => e.kind === 'shader').length, 3);
    assert.equal(f.events.find(e => e.kind === 'shader').detail.note.length, 2048);
    assert.deepEqual(f.originals[0], ['error', longError]);
    assert.equal(f.originals.length, 9);
});
test('lifecycle and shared error budgets preserve original errors', () => {
    const f = fixture();
    const original = { reason: new Error('original rejection') };
    for (let i = 0; i < 8; i++) { f.handlers.show({ scene: 1 }); f.handlers.hide(); }
    for (let i = 0; i < 4; i++) { f.handlers.error('E'.repeat(3000)); f.handlers.rejection(original); }
    assert.equal(f.events.filter(e => e.kind === 'show').length, 4);
    assert.equal(f.events.filter(e => e.kind === 'hide').length, 4);
    assert.equal(f.events.filter(e => ['error', 'unhandledRejection'].includes(e.kind)).length, 3);
    assert.equal(f.originals.length, 8);
    assert.equal(f.originals[1][1], original);
    assert.equal(f.events.find(e => e.kind === 'error').detail.message.length, 2048);
});
test('global budget includes entry and never suppresses original native errors', () => {
    const f = fixture();
    for (let i = 0; i < 40; i++) f.observer.host({ status: 'initialization-snapshot' });
    f.observer.native('late error', true); f.handlers.error('later error');
    assert.equal(f.events.length, 24);
    assert.deepEqual(f.originals, [['error', 'late error'], ['error', 'later error']]);
});
test('missing or throwing metadata yields unknown without blocking hooks', () => {
    const f = fixture(null);
    assert.equal(f.events[0].detail.model, 'unknown');
    const events = [];
    const observer = start({}, { getSystemInfoSync() { throw Error('unavailable'); }, getLaunchOptionsSync() { throw Error('unavailable'); } }, {}, e => events.push(e));
    assert.equal(events[0].detail.scene, 'unknown');
    assert.equal(observer.packageId, 'unknown');
    assert.doesNotThrow(() => observer.host({ get status() { throw Error('bad metadata'); } }));
    assert.equal(events[1].detail.summary.status, 'unknown');
});
test('default output prefix and throwing evidence sink do not gate rendering', () => {
    const lines = [];
    const observer = start({ console: { info: line => lines.push(line), log() {}, error() {} } }, {}, { packageId: 'p' });
    observer.host({ status: 'initialized' });
    assert.ok(lines.every(line => line.startsWith('[GLX_TRIANGLE_EVIDENCE] ')));
    const broken = start({}, {}, {}, () => { throw Error('sink failed'); });
    assert.doesNotThrow(() => broken.host({ status: 'initialized' }));
});
test('no access to wx network, storage or context APIs, even through caught errors', () => {
    const f = fixture();
    f.observer.host({ status: 'initialization-snapshot' });
    f.observer.native('[GLX_TRIANGLE_SHADER]{"expected":35633,"actual":35632}', false);
    f.handlers.show({ scene: 1001 }); f.handlers.hide();
    f.handlers.error('fake error'); f.handlers.rejection({ reason: 'fake rejection' });
    assert.deepEqual(f.unexpected, []);
});
