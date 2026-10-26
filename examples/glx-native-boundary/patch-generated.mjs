import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';

export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const BASE_JS_SHA = '737ea15afbad5c87ee9a09ce2c27ce998f32966533fc74b7ea225aa04d30f3df';
export const SAME_WASM_SHA = 'c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79';
export const SAME_LIBRARY_SHA = 'c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a';
export const replacements = [
    { name: 'after-frame-registration', before: 'Module.wxContextGlobal.registerAfterDoFrame(Module._glxCommandBufferFlush)',
        after: '__triangleBoundary.invoke("after-frame-register",function(){return Module.wxContextGlobal.registerAfterDoFrame(__triangleBoundary.wrapAfterFrame(Module._glxCommandBufferFlush))},null,[])' },
    { name: 'original-batch-call', before: 'Module.wxContextGlobal.batchRenderAsync(view)',
        after: '__triangleBoundary.invoke("batch",function(){return Module.wxContextGlobal.batchRenderAsync(view)},null,[])' },
    { name: 'original-swap-call', before: 'Module.wxContextGlobal.swapWindow()',
        after: '__triangleBoundary.invoke("swap",function(){return Module.wxContextGlobal.swapWindow()},null,[])' }
];
export const installation = '\n// BEGIN LOCAL BOUNDARY INSTALL\n' +
    '__triangleBoundary.installMainLoop(MainLoop,function(){return {abort:ABORT,runtimeExited:runtimeExited,' +
    'generation:MainLoop.currentlyRunningMainloop,currentFrame:MainLoop.currentFrameNumber,' +
    'running:MainLoop.running,timingMode:MainLoop.timingMode,timingValue:MainLoop.timingValue};});\n' +
    '// END LOCAL BOUNDARY INSTALL\n';

export function patchCompilerJs(base) {
    assert.equal(sha(base), BASE_JS_SHA, 'Only the frozen framecolor compiler JS is accepted');
    let text = base.toString('utf8');
    const edits = [];
    for (const item of replacements) {
        assert.equal(text.split(item.before).length - 1, 1, 'Expected exactly one original anchor: ' + item.name);
        const offset = text.indexOf(item.before);
        edits.push({ ...item, baseUtf8Offset0: base.indexOf(Buffer.from(item.before)) });
        text = text.slice(0, offset) + item.after + text.slice(offset + item.before.length);
    }
    text += installation;
    const patched = Buffer.from(text);
    // Syntax compilation only. This never evaluates the compiler output.
    new vm.Script(text, { filename: 'boundary-compiler-js-not-executed.js' });
    assert.deepEqual(restoreCompilerJs(patched), base, 'Diagnostic edits must reverse byte-for-byte');
    return { patched, proof: { schema: 'native-boundary-js-patch-v1', baseJsSha256: sha(base),
        patchedJsSha256: sha(patched), baseBytes: base.length, patchedBytes: patched.length,
        edits, installation, restoration: 'EXACT_BYTES', execution: 'NOT_RUN' } };
}

export function restoreCompilerJs(patched) {
    let text = patched.toString('utf8');
    assert.ok(text.endsWith(installation), 'Missing exact boundary installation suffix');
    text = text.slice(0, -installation.length);
    for (const item of [...replacements].reverse()) {
        assert.equal(text.split(item.after).length - 1, 1, 'Changed diagnostic replacement: ' + item.name);
        text = text.replace(item.after, item.before);
    }
    return Buffer.from(text);
}
