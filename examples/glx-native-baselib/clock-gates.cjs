'use strict';

function reject(emit, reason, detail) {
    const summary = Object.assign({ status: 'blocked', actualMode: 'unknown', reason }, detail);
    if (typeof emit === 'function') emit(summary);
    throw new Error('[triangle-clock-gate] ' + reason);
}

exports.requireVersion = function requireVersion(wxApi, emit) {
    let sdk = 'unknown';
    try { sdk = String(wxApi.getSystemInfoSync().SDKVersion); }
    catch (_) { return reject(emit, 'Cannot read actual SDKVersion; no clock run is allowed.'); }
    if (sdk !== '3.15.2' && sdk !== '3.17.5')
        return reject(emit, 'Actual SDKVersion must be 3.15.2 or 3.17.5; no instantiate, retry or fallback.', { actualSdkVersion: sdk });
    return sdk;
};

// Inspect the existing public context metadata. Never query GL or change context.
exports.requireContext = function requireContext(moduleConfig, emit) {
    const actual = moduleConfig && moduleConfig.ctx;
    const metadata = actual && actual.emscriptenGLX;
    const pinned = moduleConfig && moduleConfig.wxContextGlobal;
    if (!actual || !metadata || !pinned || metadata.isWebGL2 !== true ||
        metadata.ctxid !== pinned.ctxid || metadata.platform !== pinned.platform ||
        metadata.isWebGL2 !== pinned.isWebGL2 || !moduleConfig.canvas || actual.canvas !== moduleConfig.canvas)
        return reject(emit, 'Actual GLX context/metadata/canvas not verified; clock record refused.');
    return true;
};
