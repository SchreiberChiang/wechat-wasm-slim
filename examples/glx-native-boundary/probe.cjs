'use strict';

const LIMIT = 96;
const own = (value, key) => { try { const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d ? d.value : undefined; } catch (_) { return undefined; } };
const short = value => typeof value === 'string' ? value.slice(0, 1024) : undefined;
function metadata(value, depth = 0) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, 1024);
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (!value || typeof value !== 'object' || depth > 2) return typeof value;
    const result = Object.create(null);
    try { for (const key of Object.getOwnPropertyNames(value).slice(0, 24)) { const d = Object.getOwnPropertyDescriptor(value, key); result[key.slice(0, 80)] = d && 'value' in d ? metadata(d.value, depth + 1) : 'accessor-not-read'; } } catch (_) { return 'unreadable'; }
    return result;
}

exports.create = function create(root, identity) {
    const packageId = short(own(identity, 'packageId')) || 'unknown';
    const startupMarkers = Object.create(null);
    for (const key of ['__glxTriangleLocalObserverV1', '__nativeTriangleHostStarted', '__isAdapterInjected', '__nativeTriangleBoundary']) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(root, key);
            startupMarkers[key] = !descriptor ? { present: false } : 'value' in descriptor ? { present: true, descriptor: 'data', value: metadata(descriptor.value) } : { present: true, descriptor: 'accessor-not-read' };
        } catch (_) { startupMarkers[key] = { unreadable: true }; }
    }
    let sessionTag = null, sequence = 0, exhausted = false, outputFailures = 0, throwEvents = 0, reader = null, installed = false, emitting = false;
    const counts = Object.create(null);
    const runtime = () => {
        if (!reader) return null;
        try { return metadata(reader()); } catch (_) { return { readFailed: true }; }
    };
    const output = event => {
        if (emitting) { outputFailures++; return; }
        emitting = true;
        try {
            const consoleObject = root && root.console;
            if (!consoleObject || typeof consoleObject.info !== 'function') throw Error('console.info unavailable');
            consoleObject.info('[GLX_TRIANGLE_BOUNDARY] ' + JSON.stringify(event));
        } catch (_) { outputFailures++; }
        finally { emitting = false; }
    };
    const send = (kind, stage, ordinal, detail) => {
        if (sessionTag === null || exhausted) return;
        if (emitting) { outputFailures++; return; }
        try {
            const terminal = sequence === LIMIT - 1;
            const event = { schema: 'triangle-js-boundary-v1', packageId, sessionTag, sequence: ++sequence,
                kind: terminal ? 'notice' : kind, stage: terminal ? 'budget' : stage, ordinal: terminal ? 1 : ordinal,
                counts: { ...counts }, runtime: runtime(), outputFailures, throwEvents,
                detail: terminal ? { kind: 'budget-exhausted', exhausted: true, eventLimit: LIMIT } : metadata(detail), exhausted: terminal };
            if (terminal) exhausted = true;
            output(event);
        } catch (_) { outputFailures++; }
    };
    const invoke = (stage, fn, receiver, args) => {
        const ordinal = counts[stage] = (counts[stage] || 0) + 1;
        const selected = ordinal === 1 || ordinal === 2 || ordinal === 61;
        if (selected) send('enter', stage, ordinal);
        let result;
        try { result = Reflect.apply(fn, receiver, args); }
        catch (error) {
            if (throwEvents < 4) {
                throwEvents++;
                const primitiveValuePresent = error === null || typeof error === 'boolean' || typeof error === 'string' || (typeof error === 'number' && Number.isFinite(error));
                const detail = { thrownType: error === null ? 'null' : typeof error, primitiveValuePresent };
                if (typeof error === 'number' && !Number.isFinite(error)) detail.nonfiniteNumber = Number.isNaN(error) ? 'NaN' : error > 0 ? '+Infinity' : '-Infinity';
                if (primitiveValuePresent) detail.primitiveValue = typeof error === 'string' ? short(error) : error;
                const message = short(own(error, 'message')), stack = short(own(error, 'stack'));
                if (message !== undefined) detail.message = message;
                if (stack !== undefined) detail.stack = stack;
                send('throw', stage, ordinal, detail);
            }
            throw error;
        }
        if (selected) send('return', stage, ordinal);
        return result;
    };
    const api = {
        bindSession(value) {
            if (typeof value !== 'string' || !value || value.length > 256) throw Error('Bounded sessionTag required');
            if (sessionTag !== null) { if (sessionTag !== value) throw Error('Boundary probe session is immutable'); return api; }
            sessionTag = value;
            send('notice', 'startup', 1, { kind: 'startup', startupMarkers, eventLimit: LIMIT });
            return api;
        },
        invoke,
        notice(kind, detail) { send('notice', 'notice', 1, { kind, detail }); },
        wrapAfterFrame(fn) {
            const boundSession = sessionTag;
            if (boundSession === null) throw Error('Bind session before wrapping after-frame');
            return function () {
                const receiver = this, args = arguments;
                // Both wrappers close over this probe; a later root probe cannot rebind it.
                return invoke('after-frame', function () { return invoke('native-flush', fn, receiver, args); }, receiver, args);
            };
        },
        installMainLoop(mainLoop, stateReader) {
            if (installed) return false;
            if (!mainLoop || typeof mainLoop.runIter !== 'function' || typeof mainLoop.requestAnimationFrame !== 'function' || typeof stateReader !== 'function') throw Error('MainLoop/stateReader contract missing');
            const originalRunIter = mainLoop.runIter, originalRaf = mainLoop.requestAnimationFrame;
            reader = stateReader;
            mainLoop.runIter = function (delegate) {
                const receiver = this, args = Array.from(arguments);
                if (typeof delegate === 'function') args[0] = function () { return invoke('native-callback', delegate, this, arguments); };
                return invoke('run-iter', originalRunIter, receiver, args);
            };
            mainLoop.requestAnimationFrame = function (callback) {
                const args = Array.from(arguments);
                if (typeof callback === 'function') args[0] = function () { return invoke('raf-delivery', callback, this, arguments); };
                return invoke('raf-request', originalRaf, this, args);
            };
            installed = true; return true;
        },
        snapshot() { return { packageId, sessionTag, sequence, eventLimit: LIMIT, exhausted, outputFailures, throwEvents, installed, counts: { ...counts } }; }
    };
    return api;
};
