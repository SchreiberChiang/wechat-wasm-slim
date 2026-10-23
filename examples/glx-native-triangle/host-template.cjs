'use strict';

// Local host wiring only. Never creates a context or submits rendering commands.
exports.createHost = function createHost(root, wxApi, identity, emit) {
    let summarized = false;
    let instantiateStarted = false;
    let failure = false;
    let moduleConfig;
    const summarize = (status, detail) => {
        if (summarized) return;
        summarized = true;
        emit(Object.assign({}, identity, { mode: 'GLX', status,
            visibleValidation: 'NOT_RUN', deviceValidation: 'NOT_RUN' }, detail));
    };
    const fail = (reason) => {
        failure = true;
        summarize('blocked', { reason: String(reason) });
        return new Error('[native-triangle-host] ' + reason);
    };
    if (root.__nativeTriangleHostStarted) throw new Error('[native-triangle-host] duplicate start; no retry');
    root.__nativeTriangleHostStarted = true;
    if (!wxApi || !wxApi.env || wxApi.env.isSupportEmscriptenGLX !== true)
        throw fail('EmscriptenGLX capability is not explicitly true');
    if (root.__GODOT_DISABLE_WXGLX === true || root.__godotMinigameWXGLXEnabled === false)
        throw fail('conflicting GLX configuration');
    const wasmApi = wxApi.WXWebAssembly || root.WXWebAssembly;
    if (!wasmApi || typeof wasmApi.instantiate !== 'function')
        throw fail('WXWebAssembly.instantiate unavailable');
    const errorApi = root.WebAssembly || wasmApi;
    // Only the original abort path uses RuntimeError. Do not add a new startup
    // requirement or synthesize a platform constructor. onAbort reports first;
    // if RuntimeError is missing the compiler's subsequent throw may be TypeError.
    const canvas = root.canvas;
    if (!root.window || !root.document || !canvas || typeof canvas.getContext !== 'function' ||
        typeof root.document.querySelector !== 'function' ||
        typeof root.requestAnimationFrame !== 'function' ||
        typeof root.cancelAnimationFrame !== 'function')
        throw fail('author adapter window/document/canvas/RAF contract missing');
    // main.cpp asks for #canvas; author's querySelector matches the existing canvas.id.
    canvas.id = 'canvas';
    if (root.document.querySelector('#canvas') !== canvas)
        throw fail('author document does not resolve #canvas to onscreen canvas');
    root.__godotMinigameWXGLXEnabled = true;
    root.__GODOT_DISABLE_WXGLX = false;
    moduleConfig = {
        canvas,
        locateFile: function (name) {
            if (name !== 'triangle.wasm') throw fail('unexpected file request: ' + name);
            return 'triangle.wasm';
        },
        instantiateWasm: function (imports, receive) {
            if (instantiateStarted) throw fail('duplicate instantiate; no retry');
            instantiateStarted = true;
            // Do not permit even a synchronous custom thenable to run main before the
            // original JS has installed its trailing context patch and strict-post.
            Promise.resolve().then(function () {
                return wasmApi.instantiate('triangle.wasm', imports);
            }).then(function (result) {
                if (failure) return;
                if (!result || !result.instance || !result.instance.exports)
                    throw new Error('WXWebAssembly returned no instance.exports');
                receive(result.instance, result.module);
            }).catch(function (error) {
                // Keep Emscripten's dependency blocked. No fallback, success callback,
                // retry, fetch, or second instantiate follows an error.
                fail(error && error.message ? error.message : error);
            });
            return {};
        },
        onAbort: function (reason) { fail(reason); },
        onExit: function (code) { if (code) fail('native exit ' + code); },
        postRun: [function () {
            const context = moduleConfig.wxContextGlobal;
            if (!context || !context.isWebGL2) {
                fail('postRun did not observe initialized WebGL2 GLX metadata');
                return;
            }
            // Original GL.makeContextCurrent assigns its actual GLctx to Module.ctx.
            const actual = moduleConfig.ctx;
            const actualMetadata = actual && actual.emscriptenGLX;
            if (actual && (!actualMetadata || actualMetadata.ctxid !== context.ctxid ||
                actualMetadata.platform !== context.platform || actualMetadata.isWebGL2 !== context.isWebGL2)) {
                fail('actual current context and GLX metadata disagree');
                return;
            }
            if (actual && actual.canvas && actual.canvas !== canvas) {
                fail('actual current context canvas differs from Module.canvas');
                return;
            }
            summarize('initialization-snapshot', {
                actualMode: actualMetadata ? 'glx' : 'unknown',
                actualContextMetadataMatch: actualMetadata ? true : 'unknown',
                actualContextCanvasMatch: actual && actual.canvas ? true : 'unknown',
                contextId: context.ctxid, platform: context.platform,
                note: 'One postRun snapshot only; later errors do not update it. No proof of first-frame flush, pixels, or lifecycle stability.'
            });
        }]
    };
    return { moduleConfig, errorApi };
};
