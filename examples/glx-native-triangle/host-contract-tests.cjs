'use strict';
// Execute ONLY the newly authored host against fake-wx. Never load generated JS,
// WASM, author adapter, or another third-party runtime.
const assert = require('node:assert/strict');
const { createHost } = require('./host-template.cjs');
const identity = { packageId: 'FAKE-CONTRACT-ONLY', jsSha256: 'fake-js', wasmSha256: 'fake-wasm' };
const turns = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function fixture(options = {}) {
    const events = [], summaries = [];
    const canvas = { getContext() { throw Error('Host must not create a context'); } };
    const api = { instantiate(file, imports) {
        events.push(['instantiate', file, imports]);
        if (options.reject) return Promise.reject(Error('fake instantiate failure'));
        return Promise.resolve({ instance: { exports: {} }, module: 'fake-module' });
    } };
    const root = { window: {}, canvas,
        document: { querySelector: selector => selector === '#' + canvas.id ? canvas : null },
        requestAnimationFrame() {}, cancelAnimationFrame() {},
        WebAssembly: { RuntimeError: Error } };
    const wx = { env: { isSupportEmscriptenGLX: true }, WXWebAssembly: api };
    if (options.globalWX) { root.WXWebAssembly = api; delete wx.WXWebAssembly; }
    return { root, wx, api, events, summaries, start: () => createHost(root, wx, identity, s => summaries.push(s)) };
}
(async () => {
    let count = 0;
    {
        const f = fixture(); const host = f.start(); const m = host.moduleConfig;
        assert.equal(m.canvas, f.root.canvas); assert.equal(f.root.canvas.id, 'canvas');
        assert.equal(f.root.__godotMinigameWXGLXEnabled, true);
        assert.equal(f.events.length, 0); assert.equal(f.summaries.length, 0);
        const imports = { a: { sentinel: 123 } };
        let receives = 0;
        assert.deepEqual(m.instantiateWasm(imports, (instance, module) => {
            receives++; assert.ok(instance.exports); assert.equal(module, 'fake-module');
        }), {});
        assert.equal(f.events.length, 0, 'instantiate must start after trailing JS patches can install');
        await turns(); assert.equal(receives, 1); assert.equal(f.events.length, 1);
        assert.equal(f.events[0][1], 'triangle.wasm'); assert.equal(f.events[0][2], imports);
        m.wxContextGlobal = { isWebGL2: true, ctxid: 42, platform: 7 };
        m.ctx = { canvas: f.root.canvas, emscriptenGLX: { ...m.wxContextGlobal } };
        m.postRun[0](); m.postRun[0](); m.onAbort('fake later abort');
        assert.equal(f.summaries.length, 1);
        assert.equal(f.summaries[0].contextId, 42);
        assert.equal(f.summaries[0].actualMode, 'glx');
        assert.equal(f.summaries[0].actualContextCanvasMatch, true);
        assert.equal(f.summaries[0].status, 'initialization-snapshot');
        assert.equal(f.summaries[0].visibleValidation, 'NOT_RUN');
        assert.throws(() => f.start(), /duplicate start/); assert.equal(f.summaries.length, 1);
        count++;
    }
    for (const mutate of [
        f => { f.wx.env.isSupportEmscriptenGLX = false; },
        f => { f.root.__godotMinigameWXGLXEnabled = false; },
        f => { f.root.__GODOT_DISABLE_WXGLX = true; },
        f => { delete f.wx.WXWebAssembly; },
        f => { delete f.root.document; },
        f => { f.root.document.querySelector = () => null; }
    ]) {
        const f = fixture(); mutate(f);
        assert.throws(f.start); assert.equal(f.summaries.length, 1); assert.equal(f.events.length, 0);
        assert.throws(f.start); assert.equal(f.summaries.length, 1); count++;
    }
    {
        const f = fixture({ reject: true }); const m = f.start().moduleConfig; let received = 0;
        m.instantiateWasm({}, () => received++); await turns();
        assert.equal(received, 0); assert.equal(f.events.length, 1); assert.equal(f.summaries.length, 1);
        assert.equal(f.summaries[0].status, 'blocked');
        assert.throws(() => m.instantiateWasm({}, () => {}), /duplicate instantiate/);
        assert.equal(f.events.length, 1); assert.equal(f.summaries.length, 1); count++;
    }
    {
        const f = fixture({ globalWX: true }); delete f.root.WebAssembly;
        const m = f.start().moduleConfig;
        m.onAbort('fake missing RuntimeError abort');
        assert.equal(f.summaries[0].reason, 'fake missing RuntimeError abort'); count++;
    }
    {
        const f = fixture(); const m = f.start().moduleConfig;
        m.postRun[0](); assert.equal(f.summaries[0].status, 'blocked');
        assert.throws(() => m.locateFile('unexpected.wasm'), /unexpected file/);
        assert.equal(f.summaries.length, 1); count++;
    }
    {
        const f = fixture(); const m = f.start().moduleConfig;
        m.wxContextGlobal = { isWebGL2: true, ctxid: 42, platform: 7 };
        m.postRun[0](); assert.equal(f.summaries[0].actualMode, 'unknown'); count++;
    }
    for (const mismatch of ['metadata', 'canvas']) {
        const f = fixture(); const m = f.start().moduleConfig;
        m.wxContextGlobal = { isWebGL2: true, ctxid: 42, platform: 7 };
        m.ctx = { canvas: f.root.canvas, emscriptenGLX: { ...m.wxContextGlobal } };
        if (mismatch === 'metadata') m.ctx.emscriptenGLX.ctxid = 99;
        else m.ctx.canvas = {};
        m.postRun[0](); assert.equal(f.summaries[0].status, 'blocked'); count++;
    }
    console.log(JSON.stringify({ status: 'PASS', scenarios: count, execution: 'local host with fake-wx only',
        generatedJs: 'NOT_RUN', wasm: 'NOT_RUN', adapter: 'NOT_RUN', device: 'NOT_RUN' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
