'use strict';

// Local evidence only. No GL calls, timers, storage, or transport.
const STARTED = '__glxTriangleLocalObserverV1';
const PREFIX = '[GLX_TRIANGLE_SHADER]';
exports.start = function start(root, wxApi, identity, emit) {
    if (!root || (typeof root !== 'object' && typeof root !== 'function')) throw new Error('Observer root required');
    if (root[STARTED]) throw new Error('GLX triangle observer already started in this session');
    const sessionTag = 'triangle-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    Object.defineProperty(root, STARTED, { value: sessionTag });
    const output = root.console || console;
    const raw = (message, error) => {
        const fn = error ? output.error : output.log;
        if (typeof fn === 'function') fn.call(output, message);
    };
    const text = value => {
        try { return String(value).slice(0, 2048); } catch (_) { return 'unknown'; }
    };
    // Copy bounded JSON data only; never retain platform objects or invoke getters.
    const copy = (value, depth = 0) => {
        if (typeof value === 'string') return text(value);
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : 'unknown';
        if (!value || typeof value !== 'object' || depth > 8) return 'unknown';
        const result = Array.isArray(value) ? [] : Object.create(null);
        for (const key of Object.keys(value).slice(0, 128)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            result[text(key)] = descriptor && 'value' in descriptor ? copy(descriptor.value, depth + 1) : 'unknown';
        }
        return result;
    };
    const packageId = text(identity && identity.packageId || 'unknown');
    let count = 0, shaderCount = 0, errorCount = 0;
    const lifecycle = { show: 0, hide: 0 };
    const send = (kind, detail) => {
        if (count >= 24) return;
        const event = { kind, packageId, sessionTag, sequence: ++count, detail: copy(detail) };
        try {
            if (emit) emit(event);
            else output.info('[GLX_TRIANGLE_EVIDENCE] ' + JSON.stringify(event));
        } catch (_) { /* Evidence failure must never stop drawing. */ }
    };
    const read = (object, key) => {
        try { return object && object[key] != null ? text(object[key]) : 'unknown'; }
        catch (_) { return 'unknown'; }
    };
    let system, launch;
    try { system = wxApi.getSystemInfoSync(); } catch (_) { system = null; }
    try { launch = wxApi.getLaunchOptionsSync(); } catch (_) { launch = null; }
    send('entry', { model: read(system, 'model'), system: read(system, 'system'),
        wechatVersion: read(system, 'version'), sdkVersion: read(system, 'SDKVersion'), scene: read(launch, 'scene') });
    const error = (kind, original) => {
        raw(original, true); // Preserve the complete original even after evidence budgets expire.
        if (errorCount >= 3) return;
        errorCount++;
        let message = read(original, 'message');
        if (message === 'unknown') message = read(original, 'reason');
        if (message === 'unknown') message = text(original);
        send(kind, { message });
    };
    const subscribe = (name, callback) => {
        try { if (wxApi && typeof wxApi[name] === 'function') wxApi[name](callback); }
        catch (_) { /* Missing event support is not a rendering gate. */ }
    };
    subscribe('onShow', options => {
        if (lifecycle.show++ < 4) send('show', { scene: read(options, 'scene') });
    });
    subscribe('onHide', () => {
        if (lifecycle.hide++ < 4) send('hide', {});
    });
    subscribe('onError', value => error('error', value));
    subscribe('onUnhandledRejection', value => error('unhandledRejection', value));
    return {
        packageId, sessionTag,
        host(summary) {
            try { send('host', { summary, visibleValidation: 'NOT_RUN', lifecycleValidation: 'NOT_RUN' }); }
            catch (_) { /* Malformed metadata is not a rendering gate. */ }
        },
        native(message, isError) {
            raw(message, !!isError);
            if (shaderCount >= 3 || typeof message !== 'string' || !message.startsWith(PREFIX)) return;
            try {
                const parsed = JSON.parse(message.slice(PREFIX.length).trim());
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
                shaderCount++;
                send('shader', parsed);
            } catch (_) { /* Raw output above remains available. */ }
        }
    };
};
