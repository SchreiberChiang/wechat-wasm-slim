import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { options } from '../glx-native-framecolor/audit.mjs';
import { planHost, prepareHost, here, PARENT_ID } from './prepare-host.mjs';
import { verifyHost } from './verify-host.mjs';
import { extendProbe, restoreProbe, entryAddition, sha } from './extend-probe.mjs';
import { analyze as analyzeLog } from './read-log.mjs';

const require = createRequire(import.meta.url);
const args = options(process.argv.slice(2), ['--parent-dir', '--out']);
assert.ok(!fs.existsSync(args['--out']), 'Fresh local test evidence directory required');
fs.mkdirSync(args['--out']);
const parentDir = args['--parent-dir'];
const baseline = Object.fromEntries(fs.readdirSync(parentDir).map(name => [name, sha(fs.readFileSync(path.join(parentDir, name)))]));
const results = [];
function check(name, fn) { try { fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.stack }); } }
const clone = (from, label) => { const dir = path.join(args['--out'], label); fs.cpSync(from, dir, { recursive: true, errorOnExist: true }); return dir; };
let plan, accepted, probeModule;

check('prepare exact 9b31 descendant with thirteen runtime files', () => {
    plan = planHost({ parentDir }); accepted = path.join(args['--out'], 'accepted-host');
    assert.deepEqual(prepareHost({ parentDir, output: accepted }), plan.manifest);
    assert.equal(plan.manifest.identity.parentPackageId, PARENT_ID);
    assert.equal(plan.manifest.files.length, 13);
    assert.equal(plan.manifest.state.phone, 'NOT_RUN');
});
check('verify by reconstructing every file from current sources and parent provenance', () => {
    assert.equal(verifyHost(accepted).status, 'PASS_STATIC_NOT_RUN');
});
check('actual generated manifest is accepted by the reader without a top-level parent workaround', () => {
    assert.ok(!Object.hasOwn(plan.manifest, 'parentPackageId'));
    assert.ok(!analyzeLog('', plan.manifest).stopReasons.some(reason => reason.code === 'INVALID_CANDIDATE'));
});
check('restore the derived probe to exact frozen bytes without changing existing wrappers', () => {
    assert.deepEqual(restoreProbe(plan.files['boundary-probe.js']), plan.base.files['boundary-probe.js']);
    assert.throws(() => extendProbe(Buffer.from('unknown')), /frozen/);
    assert.throws(() => restoreProbe(Buffer.from(plan.files['boundary-probe.js'].toString().replace('ledgerFinish(ledgerToken', 'changed(ledgerToken'))));
});
check('compiler JS WASM adapter host observer settings and gates are byte-identical', () => {
    for (const name of plan.manifest.inheritedFilesExact) assert.deepEqual(plan.files[name], plan.base.files[name], name);
    assert.deepEqual(plan.files['triangle-hosted.js'], plan.base.files['triangle-hosted.js']);
    assert.deepEqual(plan.files['project.config.json'], plan.base.files['project.config.json']);
    assert.deepEqual(plan.files['project.private.config.json'], plan.base.files['project.private.config.json']);
    assert.deepEqual(plan.files['game.js'], Buffer.concat([plan.base.files['game.js'], Buffer.from(entryAddition)]));
});
check('refuse existing output without changing any accepted candidate byte', () => {
    const seal = sha(fs.readFileSync(path.join(accepted, 'CANDIDATE.json')));
    assert.throws(() => prepareHost({ parentDir, output: accepted }), /refusing overwrite/);
    assert.equal(sha(fs.readFileSync(path.join(accepted, 'CANDIDATE.json'))), seal);
});
check('reject a changed parent manifest before creating output', () => {
    const copied = clone(parentDir, 'parent-manifest-changed');
    fs.appendFileSync(path.join(copied, 'CANDIDATE.json'), ' ');
    const output = path.join(args['--out'], 'parent-manifest-rejected-output');
    assert.throws(() => prepareHost({ parentDir: copied, output }), /parent manifest mismatch/);
    assert.ok(!fs.existsSync(output));
});
check('reject changed parent bytes even when its manifest is unchanged', () => {
    const copied = clone(parentDir, 'parent-wasm-changed');
    fs.appendFileSync(path.join(copied, 'triangle.wasm'), 'changed');
    const output = path.join(args['--out'], 'parent-wasm-rejected-output');
    assert.throws(() => prepareHost({ parentDir: copied, output }));
    assert.ok(!fs.existsSync(output));
});
check('reject additional parent files before making candidate output', () => {
    const copied = clone(parentDir, 'parent-extra-file');
    fs.writeFileSync(path.join(copied, 'extra.js'), 'unexpected');
    const output = path.join(args['--out'], 'parent-extra-rejected-output');
    assert.throws(() => prepareHost({ parentDir: copied, output }));
    assert.ok(!fs.existsSync(output));
});
check('reject candidate alteration, self-resealed alteration, extra or missing files', () => {
    for (const kind of ['altered', 'resealed', 'extra', 'missing']) {
        const copied = clone(accepted, 'candidate-' + kind);
        if (kind === 'extra') fs.writeFileSync(path.join(copied, 'extra.js'), 'unexpected');
        else if (kind === 'missing') fs.renameSync(path.join(copied, 'execution-ledger.js'), path.join(copied, 'missing-module.evidence'));
        else {
            fs.appendFileSync(path.join(copied, 'execution-ledger.js'), '\n// tampered\n');
            if (kind === 'resealed') {
                const manifest = JSON.parse(fs.readFileSync(path.join(copied, 'CANDIDATE.json')));
                const bytes = fs.readFileSync(path.join(copied, 'execution-ledger.js'));
                manifest.files.find(item => item.name === 'execution-ledger.js').sha256 = sha(bytes);
                manifest.files.find(item => item.name === 'execution-ledger.js').bytes = bytes.length;
                manifest.identity.ledgerSha256 = sha(bytes);
                manifest.identity.files['execution-ledger.js'] = sha(bytes);
                const { packageId, ...inputs } = manifest.identity;
                manifest.identity.packageId = 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20);
                fs.writeFileSync(path.join(copied, 'CANDIDATE.json'), JSON.stringify(manifest));
            }
        }
        assert.throws(() => verifyHost(copied));
    }
    assert.equal(verifyHost(accepted).status, 'PASS_STATIC_NOT_RUN');
});
check('verification rejects changed runtime source through an isolated read fixture', () => {
    const originalRead = fs.readFileSync;
    let intercepted = 0;
    fs.readFileSync = function (file, ...rest) {
        const value = originalRead.call(fs, file, ...rest);
        if (path.resolve(String(file)) === path.join(here, 'ledger.cjs')) { intercepted++; return Buffer.concat([value, Buffer.from('\n// fake source drift\n')]); }
        return value;
    };
    try { assert.throws(() => verifyHost(accepted), /provenance\/runtime source changed/); }
    finally { fs.readFileSync = originalRead; }
    assert.ok(intercepted > 0);
    assert.equal(verifyHost(accepted).status, 'PASS_STATIC_NOT_RUN');
});

// The only package code evaluated below is our own probe and ledger module.
// Never require triangle-hosted.js, adapter, host, or instantiate the WASM.
check('load only the self-authored derived probe and ledger', () => {
    probeModule = require(path.join(accepted, 'boundary-probe.js'));
    assert.equal(typeof probeModule.create, 'function');
});
function newProbe(module = probeModule) {
    const records = [];
    const root = { console: { info(line) { records.push(JSON.parse(line.slice(line.indexOf('{')))); } } };
    const probe = module.create(root, plan.manifest.identity).bindSession('fake-session');
    return { probe, records, root };
}
check('all ordinals update ledger while original 1 2 61 boundary selection remains', () => {
    const { probe, records } = newProbe();
    for (let i = 0; i < 75; i++) assert.equal(probe.invoke('native-callback', x => x, null, [i]), i);
    assert.deepEqual(probe.ledgerSnapshot().ledger.stages, [{ stage: 'native-callback', enter: 75, return: 75, throw: 0 }]);
    assert.deepEqual(records.filter(event => event.stage === 'native-callback' && event.kind === 'enter').map(event => event.ordinal), [1, 2, 61]);
    assert.equal(probe.ledgerSnapshot().ledger.active, 0);
});
check('receiver arguments return identity and exact thrown values survive ledger updates', () => {
    const { probe } = newProbe(); const receiver = {}, token = {};
    let calls = 0;
    assert.equal(probe.invoke('batch', function (arg) { calls++; assert.equal(this, receiver); assert.equal(arg, token); return token; }, receiver, [token]), token);
    for (const fault of [NaN, Infinity, -Infinity, undefined, null, false, 0, 'unwind', Symbol('fault'), {}]) {
        let caught = false;
        try { probe.invoke('batch', () => { calls++; throw fault; }, null, []); }
        catch (error) { caught = true; assert.ok(Object.is(error, fault)); }
        assert.ok(caught);
    }
    const thenable = Object.defineProperty({}, 'then', { get() { assert.fail('Must not inspect returned promise/then'); } });
    assert.equal(probe.invoke('batch', () => thenable, null, []), thenable);
    assert.equal(calls, 11);
    const counters = probe.ledgerSnapshot().ledger.stages.find(item => item.stage === 'batch');
    assert.deepEqual(counters, { stage: 'batch', enter: 12, return: 2, throw: 10 });
});
check('nested call order and original submit callback count remain unchanged', () => {
    const { probe } = newProbe(); const calls = [], receiver = {}, result = {};
    const flush = function (arg) {
        assert.equal(this, receiver); assert.equal(arg, result); calls.push('flush');
        probe.invoke('batch', () => { calls.push('batch'); return result; }, null, []);
        probe.invoke('swap', () => { calls.push('swap'); return result; }, null, []);
        return result;
    };
    const callback = probe.wrapAfterFrame(flush);
    assert.equal(callback.call(receiver, result), result);
    assert.deepEqual(calls, ['flush', 'batch', 'swap']);
    for (const stage of ['after-frame', 'native-flush', 'batch', 'swap'])
        assert.deepEqual(probe.ledgerSnapshot().ledger.stages.find(item => item.stage === stage), { stage, enter: 1, return: 1, throw: 0 });
});
check('ledger require/begin/finish failures do not replace original values or errors', () => {
    for (const mode of ['require', 'begin', 'finish', 'snapshot']) {
        const exports = {};
        const fault = {};
        vm.runInNewContext(plan.files['boundary-probe.js'].toString('utf8'), { exports, require() {
            if (mode === 'require') throw fault;
            return { create() { return { begin() { if (mode === 'begin') throw fault; return {}; }, finish() { if (mode === 'finish') throw fault; }, snapshot() { if (mode === 'snapshot') throw fault; return {}; } }; } };
        } });
        const probe = exports.create({ console: { info() {} } }, plan.manifest.identity).bindSession('fake');
        const value = {}; assert.equal(probe.invoke('native-callback', () => value, null, []), value);
        assert.throws(() => probe.invoke('native-callback', () => { throw value; }, null, []), error => error === value);
        assert.ok(probe.ledgerSnapshot().ledgerIntegrationFailures > 0);
    }
});
check('checkpoints use two once-only fake timers and read progress without doing renderer work', () => {
    const { probe } = newProbe(); const timers = [], logs = [];
    let now = 100;
    const timerRoot = { Date: { now: () => now }, setTimeout(fn, delay) { timers.push({ fn, delay }); }, console: { info(line) { logs.push(JSON.parse(line.slice(line.indexOf('{')))); } } };
    probe.armCheckpoints(timerRoot); probe.armCheckpoints(timerRoot);
    assert.deepEqual(timers.map(item => item.delay), [4000, 9000]);
    probe.invoke('native-callback', () => 1, null, []);
    now = 4100; timers[0].fn();
    probe.invoke('native-callback', () => 2, null, []);
    now = 9100; timers[1].fn();
    assert.equal(logs.length, 2);
    assert.equal(logs[0].schema, 'triangle-execution-checkpoint-v1');
    assert.equal(logs[0].snapshot.ledger.stages[0].enter, 1);
    assert.equal(logs[1].snapshot.ledger.stages[0].enter, 2);
    assert.equal(logs[1].packageId, plan.manifest.identity.packageId);
    assert.equal(logs[1].sessionTag, 'fake-session');
    assert.equal(logs[0].plannedDelayMs, 4000);
    assert.equal(logs[1].plannedDelayMs, 9000);
});
check('entry adds only diagnostic timers and stubs engine and adapter imports', () => {
    const timers = [], requires = [], lines = [];
    const probe = probeModule;
    const root = { console: { info(line) { lines.push(line); } } };
    const consoleObject = { info(line) { lines.push(line); } };
    const context = vm.createContext({ GameGlobal: root, wx: {}, console: consoleObject, Date: { now: () => 100 },
        setTimeout(fn, delay) { timers.push({ fn, delay }); },
        require(name) {
            requires.push(name);
            if (name === './identity.js') return plan.manifest.identity;
            if (name === './boundary-probe.js') return probe;
            if (name === './observer.js') return { start(rootValue, wx, identity, noValue, boundary) { boundary.bindSession('entry-fake'); return { sessionTag: 'entry-fake' }; } };
            if (name === './weapp-adapter.js' || name === './triangle-hosted.js') return {};
            assert.fail('Unexpected import: ' + name);
        } });
    vm.runInContext(plan.files['game.js'].toString('utf8'), context);
    assert.deepEqual(requires, ['./identity.js', './boundary-probe.js', './observer.js', './weapp-adapter.js', './triangle-hosted.js']);
    assert.deepEqual(timers.map(item => item.delay), [4000, 9000]);
    assert.equal(root.__nativeTriangleEvidence.sessionTag, 'entry-fake');
    timers[0].fn(); assert.ok(lines.some(line => line.startsWith('[GLX_TRIANGLE_CHECKPOINT] ')));
});
check('checkpoint scheduling failure is isolated while original invocations still execute', () => {
    const { probe } = newProbe(); let calls = 0;
    assert.doesNotThrow(() => probe.armCheckpoints({ Date: { now: () => 10 }, setTimeout() { throw Error('fake unavailable'); }, console: { info() {} } }));
    assert.equal(probe.invoke('native-callback', () => ++calls, null, []), 1);
    assert.equal(calls, 1);
    assert.equal(probe.checkpointStatus().plans[0].registered, false);
});
check('real self-authored checkpoint packets and full candidate identity round-trip through the reader', () => {
    const lines = ['FAKE_ONLY_NO_DEVICE'], timers = [];
    let now = 100, frame = 0;
    const output = { info(line) { lines.push(line); }, log(line) { lines.push(line); }, error(line) { lines.push(line); } };
    const root = { console: output };
    const probe = probeModule.create(root, plan.manifest.identity);
    const wx = { getSystemInfoSync: () => ({ SDKVersion: '3.17.5' }), getLaunchOptionsSync: () => ({ scene: 1089 }),
        onShow() {}, onHide() {}, onError() {}, onUnhandledRejection() {} };
    const observer = require('../glx-native-boundary/observer.cjs').start(root, wx, plan.manifest.identity, undefined, probe);
    observer.host({ ...plan.manifest.identity, status: 'initialization-snapshot', mode: 'GLX', actualMode: 'glx',
        actualContextMetadataMatch: true, actualContextCanvasMatch: true });
    for (let i = 0; i < 2; i++) observer.native('[GLX_TRIANGLE_SHADER] ' + JSON.stringify({ schema: 'triangle-shader-type-v1',
        stage: 'created-before-source', shaderId: i + 1, expectedType: [35633, 35632][i], returnedType: [35633, 35632][i],
        publicContextHandle: 1, readOrdinal: i + 1 }), false);
    probe.installMainLoop({ runIter(fn) { return fn(); }, requestAnimationFrame() {} },
        () => ({ abort: false, runtimeExited: false, generation: 0, running: true, timingMode: 1, timingValue: 1 }));
    probe.armCheckpoints({ Date: { now: () => now }, console: output, setTimeout(fn, delay) { timers.push({ fn, delay }); } });
    const render = () => probe.invoke('native-callback', () => {
        frame++;
        probe.invoke('batch', () => 0, null, []); probe.invoke('swap', () => 0, null, []);
        if ((frame - 1) % 60 === 0) {
            const phase = Math.floor((frame - 1) / 60) % 3;
            observer.native('[GLX_TRIANGLE_COLOR] ' + JSON.stringify({ schema: 'triangle-frame-color-v1', frame,
                sampleOrdinal: Math.floor((frame - 1) / 60) + 1, phaseIndex: phase, color: ['red', 'green', 'blue'][phase],
                rgbaComputed: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]][phase], publicContextHandle: 1,
                sampleLimit: 180, budgetExhausted: false }), false);
        }
    }, null, []);
    for (let i = 0; i < 75; i++) render();
    now = 4100; timers[0].fn();
    for (let i = 0; i < 75; i++) render();
    now = 9100; timers[1].fn();
    const text = lines.join('\n'), result = analyzeLog(text, plan.manifest);
    assert.equal(result.stopRequired, false, JSON.stringify(result.stopReasons));
    const comparison = result.checkpointSessions.find(item => item.sessionTag === observer.sessionTag).comparison;
    assert.equal(comparison.observation, 'COUNTER_PROGRESS_OBSERVED');
    assert.equal(comparison.layers['native-callback'].delta.return, 75);
    assert.equal(comparison.layers.swap.delta.return, 75);
    assert.equal(result.visibleValidation, 'NOT_PROVEN');
    fs.writeFileSync(path.join(args['--out'], 'FAKE_ONLY_CHECKPOINT.log'), text, { flag: 'wx' });
    fs.writeFileSync(path.join(args['--out'], 'FAKE_ONLY_CHECKPOINT_ANALYSIS.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
});
check('frozen parent files remain byte-identical', () => {
    assert.deepEqual(fs.readdirSync(parentDir).sort(), Object.keys(baseline).sort());
    for (const [name, hash] of Object.entries(baseline)) assert.equal(sha(fs.readFileSync(path.join(parentDir, name))), hash, name);
});
const report = { scope: 'self-authored probe/ledger/entry + fake APIs and static pair only',
    compilerProgramExecution: 'NOT_RUN', adapterExecution: 'NOT_RUN', wasmExecution: 'NOT_RUN', phone: 'NOT_RUN',
    passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, results };
fs.writeFileSync(path.join(args['--out'], 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
if (report.failed) process.exitCode = 1;
