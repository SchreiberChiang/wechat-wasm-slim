import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { options } from '../glx-native-framecolor/audit.mjs';
import { planHost, prepareHost, PARENT_ID, sha } from './prepare-host.mjs';
import { verifyHost } from './verify-host.mjs';

const args = options(process.argv.slice(2), ['--parent-dir', '--out']);
assert.ok(path.isAbsolute(args['--out']) && !fs.existsSync(args['--out']), 'Fresh absolute evidence directory required');
fs.mkdirSync(args['--out']);
const parentDir = args['--parent-dir'];
const baseline = Object.fromEntries(fs.readdirSync(parentDir).map(name => [name, sha(fs.readFileSync(path.join(parentDir, name)))]));
const results = [];
function check(name, fn) { try { fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.stack }); } }
const clone = (from, label) => { const dir = path.join(args['--out'], label); fs.cpSync(from, dir, { recursive: true, errorOnExist: true }); return dir; };
const loadOwnModule = bytes => { const box = { exports: {} }; vm.runInNewContext(bytes.toString('utf8'), box); return box.exports; };
let plan, accepted, gates;

check('prepare and verify one common descendant of exact e3 parent', () => {
    plan = planHost({ parentDir }); accepted = path.join(args['--out'], 'accepted-host');
    assert.deepEqual(prepareHost({ parentDir, output: accepted }), plan.manifest);
    assert.equal(verifyHost(accepted).status, 'PASS_STATIC_NOT_RUN');
    assert.equal(plan.manifest.identity.parentPackageId, PARENT_ID);
    assert.equal(plan.manifest.files.length, 13);
    assert.deepEqual(plan.manifest.sdkPolicy.allowedVersions, ['3.15.2', '3.17.5']);
    gates = loadOwnModule(plan.files['clock-gates.js']);
});
check('only two runtime files differ; eleven other files remain exact', () => {
    const changed = Object.keys(plan.files).filter(name => !plan.files[name].equals(plan.base.files[name]));
    assert.deepEqual(changed.sort(), ['clock-gates.js', 'identity.js']);
    assert.equal(plan.manifest.inheritedFilesExact.length, 11);
    for (const name of plan.manifest.inheritedFilesExact) assert.deepEqual(plan.files[name], plan.base.files[name], name);
    const identities = JSON.parse(plan.files['identity.js'].toString().slice('module.exports = '.length, -2));
    assert.deepEqual(identities, plan.manifest.identity);
});
check('gate diff is only the exact predicate and rejection message; context gate remains exact', () => {
    const before = plan.base.files['clock-gates.js'].toString('utf8');
    const restored = plan.files['clock-gates.js'].toString('utf8')
        .replace("if (sdk !== '3.15.2' && sdk !== '3.17.5')", "if (sdk !== '3.17.5')")
        .replace('Actual SDKVersion must be 3.15.2 or 3.17.5;', 'Actual SDKVersion must be 3.17.5;');
    assert.equal(restored, before);
});
check('both exact runtime SDK values return unchanged and add no success log or side effect', () => {
    for (const sdk of ['3.15.2', '3.17.5']) {
        let reads = 0; const emitted = [];
        assert.equal(gates.requireVersion({ getSystemInfoSync() { reads++; return { SDKVersion: sdk }; } }, e => emitted.push(e)), sdk);
        assert.equal(reads, 1); assert.equal(emitted.length, 0);
    }
});
check('other missing or malformed actual versions fail closed and preserve actual returned value', () => {
    for (const sdk of ['3.17.4', '3.15.1', '', '3.15.2 ', '3.17.5-beta', undefined, null, 3175]) {
        const emitted = [];
        assert.throws(() => gates.requireVersion({ getSystemInfoSync: () => ({ SDKVersion: sdk }) }, e => emitted.push(e)), /must be/);
        assert.equal(emitted.length, 1); assert.equal(emitted[0].actualSdkVersion, String(sdk));
        assert.equal(emitted[0].status, 'blocked');
    }
});
check('SDK read failures remain failures, with no fallback or fabricated version', () => {
    const emitted = [];
    assert.throws(() => gates.requireVersion({ getSystemInfoSync() { throw new Error('fake read failure'); } }, e => emitted.push(e)), /Cannot read/);
    assert.equal(emitted.length, 1); assert.ok(!Object.hasOwn(emitted[0], 'actualSdkVersion'));
});
check('actual entry version is still produced by unchanged observer, not candidate policy', () => {
    const observer = loadOwnModule(plan.files['observer.js']);
    for (const sdk of ['3.15.2', '3.17.5', '3.17.4']) {
        const events = [], root = { console: { log() {}, error() {}, info() {} } };
        observer.start(root, { getSystemInfoSync: () => ({ SDKVersion: sdk }), getLaunchOptionsSync: () => ({ scene: 1089 }) },
            plan.manifest.identity, event => events.push(event));
        assert.equal(events[0].kind, 'entry'); assert.equal(events[0].detail.sdkVersion, sdk);
        assert.equal(events[0].packageId, plan.manifest.identity.packageId);
    }
});
check('GLX and canvas mismatch still reject, without changing context or querying GPU', () => {
    const canvas = {}, metadata = { ctxid: 2, platform: 1, isWebGL2: true };
    const module = { canvas, ctx: { canvas, emscriptenGLX: metadata }, wxContextGlobal: { ...metadata } };
    assert.equal(gates.requireContext(module), true);
    assert.throws(() => gates.requireContext({ ...module, wxContextGlobal: { ...metadata, ctxid: 3 } }), /not verified/);
    assert.throws(() => gates.requireContext({ ...module, ctx: { canvas } }), /not verified/);
});
check('refuse existing output and preserve accepted candidate', () => {
    const hash = sha(fs.readFileSync(path.join(accepted, 'CANDIDATE.json')));
    assert.throws(() => prepareHost({ parentDir, output: accepted }), /refusing overwrite/);
    assert.equal(sha(fs.readFileSync(path.join(accepted, 'CANDIDATE.json'))), hash);
});
check('changed parent manifest refuses preparation before creating output', () => {
    const dir = clone(parentDir, 'tampered-parent-manifest');
    fs.appendFileSync(path.join(dir, 'CANDIDATE.json'), ' ');
    const output = path.join(args['--out'], 'must-not-exist');
    assert.throws(() => prepareHost({ parentDir: dir, output }), /parent manifest mismatch/);
    assert.ok(!fs.existsSync(output));
});
check('changed parent runtime or unexpected extra file refuses preparation', () => {
    const runtime = clone(parentDir, 'tampered-parent-runtime');
    fs.appendFileSync(path.join(runtime, 'triangle.wasm'), 'fake-tamper');
    assert.throws(() => planHost({ parentDir: runtime }));
    const extra = clone(parentDir, 'tampered-parent-extra');
    fs.writeFileSync(path.join(extra, 'extra.js'), 'fake-tamper');
    assert.throws(() => planHost({ parentDir: extra }));
});
check('verification refuses changed gate, WASM, identity and manifest policy', () => {
    for (const name of ['clock-gates.js', 'triangle.wasm', 'identity.js']) {
        const dir = clone(accepted, 'tampered-child-' + name);
        fs.appendFileSync(path.join(dir, name), 'fake-tamper');
        assert.throws(() => verifyHost(dir));
    }
    const dir = clone(accepted, 'tampered-child-policy'), file = path.join(dir, 'CANDIDATE.json');
    const manifest = JSON.parse(fs.readFileSync(file)); manifest.sdkPolicy.allowedVersions.push('3.17.4');
    fs.writeFileSync(file, JSON.stringify(manifest)); assert.throws(() => verifyHost(dir));
});
check('frozen parent files all remain exact', () => {
    assert.deepEqual(fs.readdirSync(parentDir).sort(), Object.keys(baseline).sort());
    for (const [name, hash] of Object.entries(baseline)) assert.equal(sha(fs.readFileSync(path.join(parentDir, name))), hash, name);
});
const report = { scope: 'self-authored version gate and observer fake; static package seals',
    generatedJs: 'NOT_RUN', adapter: 'NOT_RUN', wasm: 'NOT_INSTANTIATED', phone: 'NOT_RUN',
    passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length, results };
fs.writeFileSync(path.join(args['--out'], 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
if (report.failed) process.exitCode = 1;
