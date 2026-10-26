import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const baselineDirectory = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let variantDirectory = baselineDirectory, variantSeen = false;
for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] !== '--variant-dir') continue;
    assert.ok(!variantSeen && argv[i + 1] && path.isAbsolute(argv[i + 1]), 'Expected one absolute --variant-dir');
    variantSeen = true;
    variantDirectory = path.resolve(argv[i + 1]);
    argv.splice(i, 2); i -= 2;
}
assert.ok([baselineDirectory, path.resolve(baselineDirectory, '../glx-native-contrast'),
    path.resolve(baselineDirectory, '../glx-native-clock'),
    path.resolve(baselineDirectory, '../glx-native-framecolor')].includes(variantDirectory),
    'Only the known validation and contrast sibling directories are permitted');
const { prepareHost } = await import(pathToFileURL(path.join(variantDirectory, 'prepare-host.mjs')).href);
const { options, sha, here } = await import(pathToFileURL(path.join(variantDirectory, 'audit.mjs')).href);

// Retained, isolated test evidence. Never evaluate generated JS, WASM or adapter.
const args = options(argv, ['--build-dir', '--adapter', '--project-dir', '--old-wasm', '--out']);
const output = args['--out'];
assert.ok(!fs.existsSync(output), 'Choose a new output directory; test evidence is never deleted.');
fs.mkdirSync(output);
const results = [];
const read = file => fs.readFileSync(file);
const snapshot = files => Object.fromEntries(files.map(file => [file, sha(read(file))]));
const originals = [path.join(args['--build-dir'], 'BUILD.json'), path.join(args['--build-dir'], 'triangle.js'),
    path.join(args['--build-dir'], 'triangle.wasm'), args['--adapter'], args['--old-wasm'],
    path.join(args['--project-dir'], 'project.config.json'), path.join(args['--project-dir'], 'project.private.config.json')];
const originalHashes = snapshot(originals);
const base = { buildDir: args['--build-dir'], adapterFile: args['--adapter'], projectDir: args['--project-dir'] };
function check(name, run) {
    try { run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, message: String(error.message) }); }
}
function fixture(label, change) {
    const dir = path.join(output, label + '-input');
    fs.mkdirSync(dir);
    for (const file of ['BUILD.json', 'triangle.js', 'triangle.wasm'])
        fs.copyFileSync(path.join(base.buildDir, file), path.join(dir, file));
    change(dir);
    return dir;
}
function refused(label, changes, pattern) {
    const destination = path.join(output, label + '-rejected-output');
    const files = changes.buildDir ? ['BUILD.json', 'triangle.js', 'triangle.wasm'].map(name => path.join(changes.buildDir, name)) : [];
    if (changes.adapterFile) files.push(changes.adapterFile);
    const before = snapshot(files);
    assert.throws(() => prepareHost({ ...base, ...changes, output: destination }), pattern);
    assert.ok(!fs.existsSync(destination), 'Rejected input created output');
    assert.deepEqual(snapshot(files), before, 'Rejected input was modified');
}
let manifest;
const candidate = path.join(output, 'accepted-host');
check('accept exact compiled pair without executing it', () => {
    manifest = prepareHost({ ...base, output: candidate });
    assert.equal(manifest.status, 'prepared-not-run');
    assert.equal(manifest.state.wasm, 'NOT_INSTANTIATED');
    assert.equal(manifest.state.generatedJs, 'NOT_RUN');
    assert.equal(manifest.state.cloud, 'DISABLED');
});
check('reject old WASM before creating output', () => {
    const buildDir = fixture('old-wasm', dir => fs.copyFileSync(args['--old-wasm'], path.join(dir, 'triangle.wasm')));
    refused('old-wasm', { buildDir }, /Pinned WASM mismatch/);
});
check('reject changed compiler JS before creating output', () => {
    const buildDir = fixture('changed-js', dir => fs.appendFileSync(path.join(dir, 'triangle.js'), '\n// changed\n'));
    refused('changed-js', { buildDir }, /Pinned JS mismatch/);
});
check('reject incomplete BUILD before creating output', () => {
    const buildDir = fixture('incomplete-build', dir => {
        const file = path.join(dir, 'BUILD.json');
        const build = JSON.parse(read(file)); delete build.outputs;
        fs.writeFileSync(file, JSON.stringify(build));
    });
    refused('incomplete-build', { buildDir }, /find|outputs|undefined/i);
});
check('reject incorrect adapter before creating output', () => {
    const adapterFile = path.join(output, 'incorrect-adapter.js');
    fs.writeFileSync(adapterFile, Buffer.concat([read(base.adapterFile), Buffer.from('\n// altered\n')]));
    refused('incorrect-adapter', { adapterFile }, /adapter hash mismatch/);
});
check('existing output and its bytes remain unchanged', () => {
    const destination = path.join(output, 'existing-output'); fs.mkdirSync(destination);
    const sentinel = path.join(destination, 'sentinel.txt'); fs.writeFileSync(sentinel, 'retain this evidence');
    const before = snapshot([sentinel]);
    assert.throws(() => prepareHost({ ...base, output: destination }), /already exists/);
    assert.deepEqual(snapshot([sentinel]), before);
    assert.deepEqual(fs.readdirSync(destination), ['sentinel.txt']);
});
check('manifest matches all files and unchanged compiler suffix, WASM and adapter', () => {
    assert.ok(manifest, 'Acceptance prerequisite failed');
    for (const file of manifest.files) {
        const bytes = read(path.join(candidate, file.name));
        assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
    }
    assert.deepEqual(fs.readdirSync(candidate).sort(), [...manifest.files.map(file => file.name), 'CANDIDATE.json'].sort());
    const hosted = read(path.join(candidate, 'triangle-hosted.js'));
    assert.deepEqual(hosted.subarray(manifest.originalJsOffset), read(path.join(base.buildDir, 'triangle.js')));
    assert.equal(hosted.length - manifest.originalJsOffset, manifest.originalJsLength);
    assert.equal(sha(hosted.subarray(0, manifest.originalJsOffset)), manifest.preludeSha256);
    assert.deepEqual(read(path.join(candidate, 'triangle.wasm')), read(path.join(base.buildDir, 'triangle.wasm')));
    assert.deepEqual(read(path.join(candidate, 'weapp-adapter.js')), read(base.adapterFile));
});
check('identity binds all staged inputs without evaluating identity JS', () => {
    const { packageId, ...inputs } = manifest.identity;
    assert.equal(packageId, 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20));
    const identityText = read(path.join(candidate, 'identity.js')).toString('utf8');
    assert.ok(identityText.startsWith('module.exports = ') && identityText.endsWith(';\n'));
    assert.deepEqual(JSON.parse(identityText.slice('module.exports = '.length, -2)), manifest.identity);
    for (const [name, hash] of Object.entries(inputs.files)) assert.equal(sha(read(path.join(candidate, name))), hash);
    assert.equal(inputs.jsSha256, sha(read(path.join(base.buildDir, 'triangle.js'))));
    assert.equal(inputs.wasmSha256, sha(read(path.join(candidate, 'triangle.wasm'))));
    assert.equal(inputs.sourceSha256, sha(read(path.join(here, 'main.cpp'))));
    assert.equal(inputs.pinSha256, sha(read(path.join(here, 'PINNED_PAIR.json'))));
    assert.equal(inputs.generatorSha256, sha(read(path.join(here, 'prepare-host.mjs'))));
    assert.equal(inputs.preludeTemplateSha256, manifest.preludeSha256);
    assert.equal(manifest.buildRecordSha256, sha(read(path.join(base.buildDir, 'BUILD.json'))));
});
check('local candidate seal is excluded from packaging and existing exclusions are retained', () => {
    const original = JSON.parse(read(path.join(base.projectDir, 'project.config.json')));
    const staged = JSON.parse(read(path.join(candidate, 'project.config.json')));
    assert.ok(staged.packOptions.ignore.some(item => item.type === 'file' && item.value === 'CANDIDATE.json'));
    for (const item of original.packOptions?.ignore || [])
        assert.ok(staged.packOptions.ignore.some(actual => JSON.stringify(actual) === JSON.stringify(item)), 'Existing exclusion lost');
});
check('only prelude runs: live heap getter, stdout/stderr and host callback forwarding', () => {
    const hosted = read(path.join(candidate, 'triangle-hosted.js'));
    const prelude = hosted.subarray(0, manifest.originalJsOffset).toString('utf8');
    assert.ok(prelude.endsWith('// BEGIN ORIGINAL TRIANGLE.JS BYTES\n'));
    const forwarded = [], summaries = [], moduleConfig = {}, errorApi = {};
    const session = { host: summary => summaries.push(summary), native: (message, error) => forwarded.push([message, error]) };
    const root = { __nativeTriangleEvidence: session }, wx = { getSystemInfoSync: () => ({ SDKVersion: '3.17.5' }) }, required = [];
    let versionChecks = 0, contextChecks = 0;
    const clockVariant = path.basename(here) === 'glx-native-clock';
    const colorVariant = path.basename(here) === 'glx-native-framecolor';
    const gatedVariant = clockVariant || colorVariant;
    const context = vm.createContext({ GameGlobal: root, wx, require(name) {
        required.push(name);
        if (name === './identity.js') return manifest.identity;
        if (gatedVariant && name === './clock-gates.js') return {
            requireVersion(receivedWx, callback) {
                assert.equal(receivedWx, wx); assert.equal(callback, session.host);
                versionChecks++; return '3.17.5';
            },
            requireContext(receivedModule, callback) {
                assert.equal(receivedModule, moduleConfig); assert.equal(callback, session.host);
                contextChecks++;
            }
        };
        assert.equal(name, './host.js', 'Unexpected module execution');
        return { createHost(receivedRoot, receivedWx, identity, callback) {
            assert.equal(receivedRoot, root); assert.equal(receivedWx, wx);
            assert.equal(identity, manifest.identity); assert.equal(callback, session.host);
            callback({ status: 'fake-initialization' }); return { moduleConfig, errorApi };
        } };
    } });
    vm.runInContext(prelude, context, { timeout: 1000 });
    // These are synthetic views only. The generated suffix is never evaluated.
    vm.runInContext('var HEAPU8 = new Uint8Array(8);', context, { timeout: 1000 });
    const first = moduleConfig.HEAPU8;
    vm.runInContext('HEAPU8 = new Uint8Array(32);', context, { timeout: 1000 });
    assert.equal(first.byteLength, 8); assert.equal(moduleConfig.HEAPU8.byteLength, 32);
    assert.notEqual(first.buffer, moduleConfig.HEAPU8.buffer);
    assert.equal(Object.getOwnPropertyDescriptor(moduleConfig, 'HEAPU8').enumerable, false);
    const originalError = 'original error ' + 'E'.repeat(5000);
    moduleConfig.print('original stdout'); moduleConfig.printErr(originalError);
    assert.deepEqual(forwarded, [['original stdout', false], [originalError, true]]);
    if (gatedVariant) {
        assert.equal(versionChecks, 1);
        assert.equal(contextChecks, 0, 'Ordinary native output must not trigger context checks');
        const diagnosticLine = (colorVariant ? '[GLX_TRIANGLE_COLOR]' : '[GLX_TRIANGLE_CLOCK]') + ' {"frame":1}';
        moduleConfig.print(diagnosticLine);
        assert.equal(contextChecks, 1);
        assert.deepEqual(forwarded.at(-1), [diagnosticLine, false]);
    }
    assert.deepEqual(summaries, [{ status: 'fake-initialization' }]);
    assert.equal(context.WebAssembly, errorApi);
    assert.deepEqual(required.slice().sort(), (gatedVariant ? ['./identity.js', './host.js', './clock-gates.js'] : ['./identity.js', './host.js']).sort());
});
check('all original build, adapter and project input bytes remain unchanged', () => {
    assert.deepEqual(snapshot(originals), originalHashes);
});
check('original shader failure is printed before the added failed-shader query', () => {
    const source = read(path.join(here, 'main.cpp')).toString('utf8');
    const failed = source.slice(source.indexOf('    if (!ok) {'), source.indexOf('    return result;'));
    assert.ok(failed.indexOf('glGetShaderInfoLog(') >= 0);
    assert.ok(failed.indexOf('glGetShaderInfoLog(') < failed.indexOf('std::fprintf(stderr,'));
    assert.ok(failed.indexOf('std::fprintf(stderr,') < failed.indexOf('observe_shader_type("first-compile-failure"'));
    assert.ok(failed.indexOf('observe_shader_type("first-compile-failure"') < failed.indexOf('std::exit(2)'));
});
function verify(dir, label) {
    const child = spawnSync(process.execPath, [path.join(here, 'verify-host.mjs'), dir], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    fs.writeFileSync(path.join(output, label + '-verify.log'), (child.stdout || '') + (child.stderr || ''));
    assert.ifError(child.error);
    return child;
}
check('independent verifier accepts the untouched staged pair', () => {
    const child = verify(candidate, 'accepted');
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).packageId, manifest.identity.packageId);
});
for (const key of ['jsSha256', 'wasmSha256', 'sourceSha256', 'librarySha256', 'pinSha256', 'generatorSha256']) {
    check('independent verifier rejects re-signed incorrect identity claim: ' + key, () => {
        const dir = path.join(output, 'incorrect-claim-' + key);
        fs.cpSync(candidate, dir, { recursive: true, errorOnExist: true, force: false });
        const changed = JSON.parse(JSON.stringify(manifest));
        const { packageId: ignored, ...inputs } = changed.identity;
        inputs[key] = inputs[key] === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
        changed.identity = { packageId: 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20), ...inputs };
        const identityBytes = Buffer.from('module.exports = ' + JSON.stringify(changed.identity) + ';\n');
        fs.writeFileSync(path.join(dir, 'identity.js'), identityBytes);
        const record = changed.files.find(file => file.name === 'identity.js');
        record.bytes = identityBytes.length; record.sha256 = sha(identityBytes);
        fs.writeFileSync(path.join(dir, 'CANDIDATE.json'), JSON.stringify(changed, null, 2) + '\n');
        // All local identity and file seals are consistent, so rejection must
        // come from comparison with independently audited/pinned input bytes.
        const child = verify(dir, 'incorrect-claim-' + key);
        assert.notEqual(child.status, 0, 'Incorrect claim passed independent verification');
        assert.match(child.stderr, /AssertionError/);
        if (['jsSha256', 'wasmSha256', 'sourceSha256', 'librarySha256'].includes(key))
            assert.ok(child.stderr.includes('Identity/build mismatch: ' + key));
    });
}
const report = { schema: 'native-glx-validation-stager-tests-v1', passed: results.every(item => item.passed), results,
    scope: { generatedJs: 'NOT_EXECUTED', wasm: 'NOT_INSTANTIATED', adapter: 'NOT_EXECUTED',
        prelude: 'EXECUTED_WITH_FAKE_HOST_SESSION_AND_HEAP_ONLY', device: 'NOT_RUN', cloud: 'NOT_USED' } };
fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
