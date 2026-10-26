import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { options } from '../glx-native-framecolor/audit.mjs';
import { prepareHost, planHost, here } from './prepare-host.mjs';
import { verifyHost } from './verify-host.mjs';
import { patchCompilerJs, restoreCompilerJs, replacements, installation, sha, SAME_WASM_SHA } from './patch-generated.mjs';

const require = createRequire(import.meta.url);
const probeCode = require('./probe.cjs');
const hostCode = require('./host.cjs');
const observerCode = require('./observer.cjs');
const gates = require('../glx-native-framecolor/clock-gates.cjs');
const args = options(process.argv.slice(2), ['--parent-dir', '--build-dir', '--out']);
assert.ok(!fs.existsSync(args['--out']), 'Fresh test evidence directory required');
fs.mkdirSync(args['--out']);
const results = [];
function check(name, fn) { try { fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, message: error.stack }); } }
const inputNames = ['CANDIDATE.json', 'triangle-hosted.js', 'triangle.wasm', 'host.js', 'observer.js', 'weapp-adapter.js', 'clock-gates.js', 'game.js', 'game.json', 'identity.js', 'project.config.json', 'project.private.config.json'];
const before = Object.fromEntries(inputNames.map(name => [name, sha(fs.readFileSync(path.join(args['--parent-dir'], name)))]));
const optionsBase = { parentDir: args['--parent-dir'], buildDir: args['--build-dir'] };
let plan, candidate;
check('plan and prepare the paired candidate without running compiler JS/WASM', () => {
    plan = planHost(optionsBase);
    candidate = path.join(args['--out'], 'accepted-host');
    const manifest = prepareHost({ ...optionsBase, output: candidate });
    assert.deepEqual(manifest, plan.manifest);
    assert.equal(manifest.files.length, 12);
    assert.equal(manifest.state.preview, 'NOT_UPLOADED');
});
check('reproduce and verify every candidate byte', () => assert.equal(verifyHost(candidate).status, 'PASS_STATIC_NOT_RUN'));
check('refuse an existing output without changing it', () => {
    const beforeSeal = sha(fs.readFileSync(path.join(candidate, 'CANDIDATE.json')));
    assert.throws(() => prepareHost({ ...optionsBase, output: candidate }), /refusing overwrite/);
    assert.equal(sha(fs.readFileSync(path.join(candidate, 'CANDIDATE.json'))), beforeSeal);
});
check('reject unknown compiler JS before patching', () => assert.throws(() => patchCompilerJs(Buffer.from('unknown')), /frozen/));
check('restore all three diagnostic sites and suffix to exact parent compiler bytes', () => {
    assert.deepEqual(restoreCompilerJs(plan.patched), plan.baseJs);
    assert.equal(plan.manifest.patch.edits.length, 3);
    assert.equal(sha(plan.files['triangle.wasm']), SAME_WASM_SHA);
});
check('reject altered patched JS or missing installation', () => {
    assert.throws(() => restoreCompilerJs(Buffer.from(plan.patched.toString().replace('"batch",function', '"changed",function'))));
    assert.throws(() => restoreCompilerJs(plan.patched.subarray(0, -1)));
});
check('preserve adapter/gates/orientation and change no AppID or compilation setting', () => {
    for (const name of ['weapp-adapter.js', 'clock-gates.js', 'game.json'])
        assert.deepEqual(plan.files[name], fs.readFileSync(path.join(args['--parent-dir'], name)));
    for (const name of ['project.config.json', 'project.private.config.json']) {
        const old = JSON.parse(fs.readFileSync(path.join(args['--parent-dir'], name)));
        const next = JSON.parse(plan.files[name]);
        delete old.projectname; delete next.projectname;
        assert.deepEqual(next, old);
    }
});
check('reject a tampered parent without making the requested output', () => {
    const dir = path.join(args['--out'], 'bad-parent'); fs.mkdirSync(dir);
    for (const name of inputNames) fs.copyFileSync(path.join(args['--parent-dir'], name), path.join(dir, name));
    fs.appendFileSync(path.join(dir, 'triangle.wasm'), 'changed');
    const output = path.join(args['--out'], 'bad-parent-rejected-output');
    assert.throws(() => prepareHost({ parentDir: dir, buildDir: args['--build-dir'], output }), /seal mismatch/);
    assert.ok(!fs.existsSync(output));
});
check('detect a tampered candidate, retaining the original accepted host', () => {
    const dir = path.join(args['--out'], 'bad-candidate'); fs.cpSync(candidate, dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'boundary-probe.js'), '\n// changed\n');
    assert.throws(() => verifyHost(dir), /Candidate bytes changed/);
    assert.equal(verifyHost(candidate).status, 'PASS_STATIC_NOT_RUN');
});

// Evaluate ONLY the newly authored replacement expressions, never the compiler
// program or original adapter. Every target method here is our fake function.
check('new batch/swap expressions preserve receiver, one call, return object and order', () => {
    const calls = [], token = {}, view = {}, receiver = {
        batchRenderAsync(arg) { assert.equal(this, receiver); assert.equal(arg, view); calls.push('batch'); return token; },
        swapWindow() { assert.equal(this, receiver); calls.push('swap'); return token; }
    };
    const probe = probeCode.create({ console: { info() {} } }, { packageId: 'fake' }).bindSession('fake');
    const context = { Module: { wxContextGlobal: receiver }, view, __triangleBoundary: probe };
    assert.equal(vm.runInNewContext(replacements[1].after, context), token);
    assert.equal(vm.runInNewContext(replacements[2].after, context), token);
    assert.deepEqual(calls, ['batch', 'swap']);
    const fault = {}; receiver.batchRenderAsync = () => { throw fault; };
    assert.throws(() => vm.runInNewContext(replacements[1].after, context), error => error === fault);
});
check('registration expression passes one callback and preserves old-session flush closure', () => {
    const events = [], calls = [], value = {}, receiver = {
        registerAfterDoFrame(callback) { assert.equal(this, receiver); calls.push(callback); return value; }
    };
    const probe = probeCode.create({ console: { info: text => events.push(JSON.parse(text.slice(text.indexOf('{')))) } }, { packageId: 'fake' }).bindSession('old');
    const original = function (arg) { assert.equal(this, receiver); assert.equal(arg, value); return value; };
    const context = { Module: { wxContextGlobal: receiver, _glxCommandBufferFlush: original }, __triangleBoundary: probe };
    assert.equal(vm.runInNewContext(replacements[0].after, context), value);
    assert.equal(calls.length, 1);
    context.__triangleBoundary = probeCode.create({ console: { info() {} } }, { packageId: 'fake' }).bindSession('new');
    assert.equal(calls[0].call(receiver, value), value);
    assert.ok(events.filter(event => event.stage === 'after-frame').every(event => event.sessionTag === 'old'));
});

function fakePrelude(sdk = '3.17.5') {
    const events = [], raw = [], requires = [], canvas = { getContext() {} }, callbacks = {};
    const wx = { env: { isSupportEmscriptenGLX: true }, getSystemInfoSync: () => ({ SDKVersion: sdk }),
        getLaunchOptionsSync: () => ({ scene: 1011 }), onShow: fn => { callbacks.show = fn; }, onHide: fn => { callbacks.hide = fn; },
        onError: fn => { callbacks.error = fn; }, onUnhandledRejection: fn => { callbacks.rejection = fn; },
        WXWebAssembly: { instantiate() { assert.fail('No real/fake instance needed in this prelude test'); } } };
    const root = { canvas, window: {}, document: { querySelector: () => canvas }, requestAnimationFrame() {}, cancelAnimationFrame() {},
        console: { info: line => events.push(JSON.parse(line.slice(line.indexOf('{')))), log: line => raw.push(line), error: line => raw.push(line) } };
    const context = vm.createContext({ GameGlobal: root, wx, HEAPU8: new Uint8Array(1), require(name) {
        requires.push(name);
        if (name === './identity.js') return plan.manifest.identity;
        if (name === './boundary-probe.js') return probeCode;
        if (name === './observer.js') return observerCode;
        if (name === './host.js') return hostCode;
        if (name === './clock-gates.js') return gates;
        if (name === './weapp-adapter.js') return {}; // Deliberate fake. Never load the actual adapter.
        if (name === './triangle-hosted.js') return {}; // Never load/evaluate the compiler program.
        assert.fail('Unexpected require: ' + name);
    } });
    vm.runInContext(plan.files['game.js'].toString('utf8'), context);
    const run = () => vm.runInContext(plan.prelude.toString('utf8'), context);
    return { run, context, root, wx, events, raw, requires, callbacks };
}
check('entry/prelude use the same probe/session and preserve startup without real adapter or WASM', () => {
    const f = fakePrelude(); f.run();
    const { Module } = f.context;
    assert.ok(Module.instantiateWasm);
    assert.equal(f.events.find(event => event.schema === 'triangle-js-boundary-v1').sessionTag, f.root.__nativeTriangleEvidence.sessionTag);
    assert.deepEqual(f.requires.slice(0, 4), ['./identity.js', './boundary-probe.js', './observer.js', './weapp-adapter.js']);
    assert.ok(!f.root.__isAdapterInjected, 'Fake adapter must remain a stub');
});
check('wrong actual SDK blocks before host creation or instantiate', () => {
    const f = fakePrelude('3.15.2');
    assert.throws(f.run, /3.17.5/);
    assert.ok(!f.requires.includes('./host.js'));
    assert.ok(!f.root.__nativeTriangleHostStarted);
});
check('COLOR gate failure is rethrown and reported at its exact output boundary', () => {
    const f = fakePrelude(); f.run();
    assert.throws(() => f.context.Module.print('[GLX_TRIANGLE_COLOR] {}'), /GLX context/);
    assert.ok(f.events.some(event => event.kind === 'throw' && event.stage === 'color-output'));
    assert.deepEqual(f.raw, []);
});
check('late host failure remains observable after the one initialization snapshot', () => {
    const f = fakePrelude(); f.run();
    const mod = f.context.Module, metadata = { isWebGL2: true, ctxid: 2, platform: 1 };
    mod.wxContextGlobal = metadata; mod.ctx = { canvas: f.root.canvas, emscriptenGLX: { ...metadata } };
    mod.postRun[0](); mod.onAbort('fake late abort');
    assert.equal(f.events.filter(event => event.kind === 'host').length, 1);
    assert.ok(f.events.some(event => event.detail?.kind === 'host-failure'));
});
check('self-authored installation wraps a fake MainLoop once without scheduling anything', () => {
    const f = fakePrelude(); f.run();
    let schedules = 0;
    f.context.MainLoop = { runIter(fn) { return fn(); }, requestAnimationFrame() { schedules++; },
        currentlyRunningMainloop: 0, currentFrameNumber: 0, running: true, timingMode: 1, timingValue: 1 };
    f.context.ABORT = false; f.context.runtimeExited = false;
    vm.runInContext(installation, f.context);
    const wrapped = f.context.MainLoop.runIter;
    vm.runInContext(installation, f.context);
    assert.equal(f.context.MainLoop.runIter, wrapped);
    assert.equal(schedules, 0);
    assert.equal(f.context.MainLoop.runIter(() => 37), 37);
});
check('parent evidence files remain byte-identical', () => {
    for (const [name, hash] of Object.entries(before)) assert.equal(sha(fs.readFileSync(path.join(args['--parent-dir'], name))), hash);
});
const report = { scope: 'self-authored expressions/prelude/probe/host/observer and fake APIs only',
    compilerProgramExecution: 'NOT_RUN', adapterExecution: 'NOT_RUN', wasmExecution: 'NOT_RUN',
    passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, results };
fs.writeFileSync(path.join(args['--out'], 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
if (report.failed) process.exitCode = 1;
