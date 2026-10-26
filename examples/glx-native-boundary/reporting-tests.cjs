'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const oldObserver = require('../glx-native-validation/observer.cjs');
const nextObserver = require('./observer.cjs');
const oldHost = require('../glx-native-triangle/host-template.cjs');
const nextHost = require('./host.cjs');
function observerHarness(implementation, probe, options = {}) {
    const events = [], raw = [], callbacks = {}, calls = [];
    const root = { console: { log(value) { raw.push(value); if (options.rawError) throw options.rawError; }, error(value) { raw.push(value); if (options.rawError) throw options.rawError; } } };
    const wx = { getSystemInfoSync() { calls.push('system'); return { SDKVersion: 'fake' }; }, getLaunchOptionsSync() { calls.push('launch'); return {}; } };
    for (const name of ['onShow', 'onHide', 'onError', 'onUnhandledRejection']) wx[name] = function (callback) { calls.push(name); callbacks[name] = callback; };
    if (options.missing) delete wx[options.missing];
    if (options.registrationThrow) wx[options.registrationThrow] = function () { calls.push(options.registrationThrow); throw Error('fake registration'); };
    const observer = implementation.start(root, wx, { packageId: 'fake' }, event => { events.push(event); if (options.emitThrow) throw options.emitThrow; }, probe);
    return { observer, events, raw, callbacks, calls, root, wx };
}
const normalized = events => events.map(({ sessionTag, ...event }) => event);
function hostHarness(implementation, probe) {
    const events = [], calls = [], canvas = { getContext() {} };
    const root = { canvas, window: {}, document: { querySelector(selector) { calls.push(['query', selector]); return canvas; } }, requestAnimationFrame() {}, cancelAnimationFrame() {}, WebAssembly: {} };
    const wx = { env: { isSupportEmscriptenGLX: true }, WXWebAssembly: { instantiate() { calls.push('instantiate'); throw Error('Real instantiate forbidden'); } } };
    const host = implementation.createHost(root, wx, { packageId: 'fake' }, event => events.push(event), probe);
    const module = host.moduleConfig;
    module.wxContextGlobal = { isWebGL2: true, ctxid: 2, platform: 1 };
    module.ctx = { canvas, emscriptenGLX: { ...module.wxContextGlobal } };
    return { module, events, calls, root, wx };
}
const forwardingProbe = notices => ({ bindSession() {}, notice(kind, detail) { notices.push({ kind, detail }); }, invoke(_kind, fn, receiver, args) { return fn.apply(receiver, args); } });

test('normal old/new observer calls, raw output and structured data match', () => {
    const notices = [], old = observerHarness(oldObserver), next = observerHarness(nextObserver, forwardingProbe(notices));
    const original = { message: 'fake error' };
    for (const h of [old, next]) {
        h.callbacks.onShow({ scene: 1 }); h.callbacks.onHide();
        h.callbacks.onError(original); h.callbacks.onUnhandledRejection(original);
        h.observer.native('ordinary raw', false);
        h.observer.native('[GLX_TRIANGLE_SHADER] {"schema":"fake"}', false);
        h.observer.host({ status: 'fake' });
    }
    assert.deepEqual(next.calls, old.calls); assert.deepEqual(next.raw, old.raw);
    assert.deepEqual(normalized(next.events), normalized(old.events));
    assert.deepEqual(notices.filter(x => x.kind === 'error-hook-coverage').map(x => x.detail), ['onError', 'onUnhandledRejection'].map(api => ({ api, present: true, registered: true, registrationThrew: false })));
});

test('normal old/new host behavior matches; late fail adds independent notices only; exit0 adds none', () => {
    const notices = [], old = hostHarness(oldHost), next = hostHarness(nextHost, forwardingProbe(notices));
    for (const h of [old, next]) {
        assert.equal(h.module.locateFile('triangle.wasm'), 'triangle.wasm'); h.module.postRun[0]();
        assert.equal(h.module.onAbort('late'), undefined); assert.equal(h.module.onExit(7), undefined); assert.equal(h.module.onExit(0), undefined);
    }
    assert.deepEqual(next.calls, old.calls); assert.deepEqual(next.events, old.events); assert.equal(next.events.length, 1);
    assert.deepEqual(notices, [{ kind: 'host-failure', detail: { reason: 'late' } }, { kind: 'host-failure', detail: { reason: 'native exit 7' } }]);
    assert.ok(!next.calls.includes('instantiate'));
});

test('fake instantiate failure remains one attempt without receive/retry or fallback', async () => {
    const notices = [], all = [];
    for (const implementation of [oldHost, nextHost]) {
        const h = hostHarness(implementation, forwardingProbe(notices)); let attempts = 0, receives = 0;
        h.wx.WXWebAssembly.instantiate = function (filename, imports) {
            attempts++; assert.equal(filename, 'triangle.wasm'); assert.equal(imports.fake, true);
            return Promise.reject(Error('fake instantiate rejection'));
        };
        assert.deepEqual(h.module.instantiateWasm({ fake: true }, () => { receives++; }), {});
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(attempts, 1); assert.equal(receives, 0);
        assert.equal(h.events[0].status, 'blocked');
        assert.throws(() => h.module.instantiateWasm({}, () => { receives++; }), /duplicate instantiate/);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(attempts, 1); assert.equal(receives, 0); all.push(h.events);
    }
    assert.deepEqual(all[0], all[1]);
    assert.deepEqual(notices.map(x => x.detail.reason), ['fake instantiate rejection', 'duplicate instantiate; no retry']);
});

test('missing/throwing hooks retain old calls and provide exact coverage notices', () => {
    for (const options of [{ missing: 'onError' }, { registrationThrow: 'onUnhandledRejection' }]) {
        const notices = [], old = observerHarness(oldObserver, undefined, options), next = observerHarness(nextObserver, forwardingProbe(notices), options);
        assert.deepEqual(next.calls, old.calls); assert.deepEqual(normalized(next.events), normalized(old.events));
        const api = options.missing || options.registrationThrow;
        assert.deepEqual(notices.find(x => x.detail.api === api).detail, { api, present: !options.missing, registered: false, registrationThrew: !!options.registrationThrow });
    }
});

test('original raw error object is rethrown once, raw can already exist, structured error absent', () => {
    const exactError = { fake: 'console failure' }, original = { message: 'original payload' }, notices = [];
    for (const implementation of [oldObserver, nextObserver]) {
        const h = observerHarness(implementation, forwardingProbe(notices), { rawError: exactError });
        assert.throws(() => h.callbacks.onError.call({ callbackReceiver: true }, original), error => error === exactError);
        assert.deepEqual(h.raw, [original]); assert.deepEqual(h.events.map(x => x.kind), ['entry']);
        assert.throws(() => h.observer.native('raw COLOR-like line', false), error => error === exactError);
        assert.equal(h.raw.length, 2);
    }
});

test('structured emit failure remains swallowed and now notices bounded internal kind', () => {
    const notices = [], exactError = { fake: 'emit' };
    const h = observerHarness(nextObserver, forwardingProbe(notices), { emitThrow: exactError });
    assert.doesNotThrow(() => h.observer.host({ status: 'fake' }));
    assert.doesNotThrow(() => h.callbacks.onError({ message: 'fake' }));
    assert.deepEqual(notices.filter(x => x.kind === 'structured-output-failure').map(x => x.detail), [{ kind: 'entry' }, { kind: 'host' }, { kind: 'error' }]);
});

test('probe failures are isolated while duplicate observer/host guards remain', () => {
    const probe = { bindSession() { throw Error('probe bind'); }, notice() { throw Error('probe notice'); }, invoke() { throw Error('probe invoke'); } };
    const h = observerHarness(nextObserver, probe); assert.doesNotThrow(() => h.callbacks.onError({ message: 'fake' }));
    assert.equal(h.raw.length, 1); assert.throws(() => nextObserver.start(h.root, h.wx, {}, () => {}, probe), /already started/);
    const host = hostHarness(nextHost, probe); host.module.postRun[0](); assert.doesNotThrow(() => host.module.onAbort('late'));
    assert.throws(() => nextHost.createHost(host.root, host.wx, {}, () => {}, probe), /duplicate start/);
});

test('bindSession happens before observer duplicate guard without clearing prior marker', () => {
    const root = { __glxTriangleLocalObserverV1: 'prior' }, calls = [];
    assert.throws(() => nextObserver.start(root, {}, {}, () => {}, { bindSession(tag) { calls.push({ tag, prior: root.__glxTriangleLocalObserverV1 }); } }), /already started/);
    assert.equal(calls.length, 1); assert.equal(calls[0].prior, 'prior'); assert.equal(root.__glxTriangleLocalObserverV1, 'prior');
});

// Extract only our own helper for return-value/receiver tests; no generated code is evaluated.
const observerSource = fs.readFileSync(require.resolve('./observer.cjs'), 'utf8');
const invokeText = observerSource.slice(observerSource.indexOf('    const invoke = '), observerSource.indexOf('    const send = '));
function invokeFor(probe) { return vm.runInNewContext('(function(probe){' + invokeText + ';return invoke;})')(probe); }
test('once helper isolates probe before/after failures and missing forward, preserving receiver/args/return object', () => {
    const receiver = {}, args = [{ exact: 'arg' }], exactReturn = {};
    for (const probe of [undefined, {}, { invoke() { throw Error('before'); } }, { invoke() {} }, { invoke(_k, fn, self, argv) { fn.apply(self, argv); throw Error('after'); } }, { invoke(_k, fn, self, argv) { fn.apply(self, argv); return fn.apply(self, argv); } }]) {
        let count = 0; const original = function (arg) { count++; assert.equal(this, receiver); assert.equal(arg, args[0]); return exactReturn; };
        assert.equal(invokeFor(probe)('fake', original, receiver, args), exactReturn); assert.equal(count, 1);
    }
});
test('once helper always rethrows original exact object even when probe catches/replaces it', () => {
    const exact = {};
    for (const probe of [undefined, { invoke(_k, fn) { try { fn(); } catch (_) { throw Error('replacement'); } } }, { invoke(_k, fn) { try { fn(); } catch (_) {} } }]) {
        let count = 0;
        assert.throws(() => invokeFor(probe)('fake', () => { count++; throw exact; }, null, []), error => error === exact);
        assert.equal(count, 1);
    }
});

test('actual self-authored probe interoperates with observer raw throw and host late failure', () => {
    const lines = [], raw = [], hooks = {}, exactError = Error('fake raw console failure');
    const root = { console: { info(line) { lines.push(line); }, log(value) { raw.push(value); }, error(value) { raw.push(value); throw exactError; } } };
    const probe = require('./probe.cjs').create(root, { packageId: 'fake' });
    const wx = { onError(fn) { hooks.error = fn; }, onUnhandledRejection(fn) { hooks.rejection = fn; } };
    const observer = nextObserver.start(root, wx, { packageId: 'fake' }, () => {}, probe);
    assert.throws(() => hooks.error({ message: 'fake original' }), error => error === exactError);
    assert.equal(raw.length, 1);
    const events = lines.map(line => JSON.parse(line.slice('[GLX_TRIANGLE_BOUNDARY] '.length)));
    assert.ok(events.every(event => event.sessionTag === observer.sessionTag));
    assert.ok(events.some(event => event.stage === 'wx-error' && event.kind === 'throw'));
    assert.equal(events.filter(event => event.detail && event.detail.kind === 'error-hook-coverage').length, 2);
    const hostLines = []; let actualProbe;
    const h = hostHarness(nextHost, { notice(kind, detail) { actualProbe.notice(kind, detail); } });
    h.root.console = { info(line) { hostLines.push(line); } };
    actualProbe = require('./probe.cjs').create(h.root, { packageId: 'fake' }); actualProbe.bindSession('fake-host-session');
    h.module.postRun[0](); h.module.onAbort('late fake reason'); h.module.onExit(0);
    assert.equal(h.events.length, 1);
    const hostEvents = hostLines.map(line => JSON.parse(line.slice('[GLX_TRIANGLE_BOUNDARY] '.length)));
    assert.equal(hostEvents.filter(event => event.detail && event.detail.kind === 'host-failure').length, 1);
});
