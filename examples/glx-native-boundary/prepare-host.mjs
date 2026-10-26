import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { auditBuild, options } from '../glx-native-framecolor/audit.mjs';
import { sha, patchCompilerJs, BASE_JS_SHA, SAME_WASM_SHA, SAME_LIBRARY_SHA } from './patch-generated.mjs';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const PARENT_ID = 'native-glx-validation-bee48002c945db68649a';
const read = file => fs.readFileSync(file);
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export function auditParent(parentDir, buildDir) {
    const parent = JSON.parse(read(path.join(parentDir, 'CANDIDATE.json')));
    assert.equal(parent.schema, 'native-glx-validation-candidate-v1');
    assert.equal(parent.identity.packageId, PARENT_ID, 'Unknown parent package');
    const { packageId, ...inputs } = parent.identity;
    assert.equal(packageId, 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20));
    const names = parent.files.map(item => item.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(fs.readdirSync(parentDir).sort(), [...names, 'CANDIDATE.json'].sort(), 'Unexpected parent files');
    const files = {};
    for (const item of parent.files) {
        assert.equal(path.basename(item.name), item.name);
        const bytes = files[item.name] = read(path.join(parentDir, item.name));
        assert.equal(bytes.length, item.bytes, 'Parent seal mismatch length: ' + item.name);
        assert.equal(sha(bytes), item.sha256, 'Parent seal mismatch: ' + item.name);
    }
    for (const [name, hash] of Object.entries(inputs.files)) assert.equal(sha(files[name]), hash);
    const identityText = files['identity.js'].toString('utf8');
    assert.ok(identityText.startsWith('module.exports = ') && identityText.endsWith(';\n'));
    assert.deepEqual(JSON.parse(identityText.slice('module.exports = '.length, -2)), parent.identity);
    const built = auditBuild(buildDir);
    assert.equal(path.resolve(parent.originalBuild), path.resolve(buildDir, 'BUILD.json'));
    assert.equal(parent.buildRecordSha256, built.report.buildRecordSha256);
    assert.equal(sha(built.js), BASE_JS_SHA);
    assert.equal(sha(built.wasm), SAME_WASM_SHA);
    assert.equal(built.report.librarySha256, SAME_LIBRARY_SHA);
    assert.deepEqual(files['triangle.wasm'], built.wasm);
    const hosted = files['triangle-hosted.js'];
    assert.equal(hosted.length, parent.originalJsOffset + parent.originalJsLength);
    assert.equal(sha(hosted.subarray(0, parent.originalJsOffset)), parent.preludeSha256);
    assert.deepEqual(hosted.subarray(parent.originalJsOffset), built.js);
    // Existing asynchronous host initialization is essential: the suffix installs
    // observations before the first real instance can be delivered to main.
    assert.ok(files['host.js'].includes(Buffer.from('Promise.resolve().then(function ()')));
    return { parent, files, ...built };
}

export function planHost({ parentDir, buildDir }) {
    const base = auditParent(parentDir, buildDir);
    const { patched, proof } = patchCompilerJs(base.js);
    const newHost = read(path.join(here, 'host.cjs'));
    assert.ok(newHost.includes(Buffer.from('Promise.resolve().then(function ()')));
    const entry = Buffer.from('var identity = require("./identity.js");\n' +
        'var boundary = require("./boundary-probe.js").create(GameGlobal, identity);\n' +
        'GameGlobal.__nativeTriangleEvidence = require("./observer.js").start(GameGlobal, wx, identity, undefined, boundary);\n' +
        'GameGlobal.__nativeTriangleBoundary = boundary;\n' +
        'require("./weapp-adapter.js");\nrequire("./triangle-hosted.js");\n');
    const prelude = Buffer.from('// Local JS boundary prelude; patched compiler JS follows.\n' +
        'var __triangleIdentity = require("./identity.js");\n' +
        'var __triangleSession = GameGlobal.__nativeTriangleEvidence;\n' +
        'var __triangleBoundary = GameGlobal.__nativeTriangleBoundary;\n' +
        'var __clockGates = require("./clock-gates.js");\n' +
        '__clockGates.requireVersion(wx, __triangleSession.host);\n' +
        'var __triangleHostCode = require("./host.js");\n' +
        'var __triangleHost = __triangleBoundary.invoke("host-create", __triangleHostCode.createHost, __triangleHostCode, [GameGlobal, wx, __triangleIdentity, __triangleSession.host, __triangleBoundary]);\n' +
        'var Module = __triangleHost.moduleConfig;\n' +
        'Module.print = function(message) { var color = typeof message === "string" && message.startsWith("[GLX_TRIANGLE_COLOR] "); return __triangleBoundary.invoke(color ? "color-output" : "native-output", function() { if (color) __clockGates.requireContext(Module, __triangleSession.host); return __triangleSession.native(message, false); }, this, []); };\n' +
        'Module.printErr = function(message) { return __triangleBoundary.invoke("native-stderr", function() { return __triangleSession.native(message, true); }, this, []); };\n' +
        'var WebAssembly = __triangleHost.errorApi;\n' +
        'Object.defineProperty(Module, "HEAPU8", { get: function() { return HEAPU8; } });\n' +
        '// BEGIN PATCHED COMPILER JS\n');
    const common = JSON.parse(base.files['project.config.json']);
    const privateConfig = JSON.parse(base.files['project.private.config.json']);
    assert.equal(common.libVersion, '3.17.5');
    assert.equal(privateConfig.libVersion, '3.17.5');
    common.projectname = privateConfig.projectname = 'native-glx-boundary-' + proof.patchedJsSha256.slice(0, 12);
    assert.ok(common.packOptions.ignore.some(item => item.type === 'file' && item.value === 'CANDIDATE.json'));
    const shared = {
        'game.js': entry, 'game.json': base.files['game.json'], 'host.js': newHost,
        'observer.js': read(path.join(here, 'observer.cjs')), 'boundary-probe.js': read(path.join(here, 'probe.cjs')),
        'weapp-adapter.js': base.files['weapp-adapter.js'], 'clock-gates.js': base.files['clock-gates.js'],
        'triangle.wasm': base.wasm,
        'project.config.json': serialize(common), 'project.private.config.json': serialize(privateConfig)
    };
    const inputs = { variant: 'js-boundary-v1', parentPackageId: PARENT_ID,
        jsSha256: proof.patchedJsSha256, baseJsSha256: BASE_JS_SHA, wasmSha256: SAME_WASM_SHA,
        sourceSha256: base.report.sourceSha256, librarySha256: SAME_LIBRARY_SHA,
        generatorSha256: sha(read(fileURLToPath(import.meta.url))), patcherSha256: sha(read(path.join(here, 'patch-generated.mjs'))),
        patchProofSha256: sha(JSON.stringify(proof)), preludeTemplateSha256: sha(prelude),
        files: Object.fromEntries(Object.entries(shared).map(([name, bytes]) => [name, sha(bytes)])) };
    const identity = { packageId: 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20), ...inputs };
    const files = { ...shared, 'identity.js': Buffer.from('module.exports = ' + JSON.stringify(identity) + ';\n'),
        'triangle-hosted.js': Buffer.concat([prelude, patched]) };
    for (const name of ['game.js', 'identity.js', 'triangle-hosted.js']) new vm.Script(files[name].toString('utf8'), { filename: name + '-not-executed' });
    const manifest = { schema: 'native-glx-boundary-candidate-v1', identity,
        status: 'prepared-not-run', parentDirectory: path.resolve(parentDir), originalBuild: path.resolve(buildDir, 'BUILD.json'),
        buildRecordSha256: base.report.buildRecordSha256, baseJsSha256: BASE_JS_SHA,
        diagnosticJsOffset: prelude.length, diagnosticJsBytes: patched.length,
        preludeSha256: sha(prelude), patch: proof,
        files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) })),
        observations: { eventLimit: 96, selectedOrdinals: [1, 2, 61], maxThrowEvents: 4,
            inheritedColorLimit: 180, oldCallbackSession: 'closure-bound observer session, not native context identity',
            timing: 'integer event/call order only; not elapsed time or FPS',
            effect: 'changes callback identity and adds CPU/allocation/log overhead; absence of fault is not proof of repair' },
        state: { generatedJs: 'NOT_RUN', adapter: 'NOT_RUN', wasm: 'NOT_INSTANTIATED',
            build: 'REUSED_EXACT_PARENT_PAIR_WITH_JS_OBSERVATIONS', preview: 'NOT_UPLOADED', phone: 'NOT_RUN', cloud: 'DISABLED' },
        limits: ['Only three exact JS call-site observations and a MainLoop wrapper installation; reversible to compiler JS bytes.',
            'Same C++/WASM/library/RGB/context properties; no extra RAF, flush, swap, timers, Promise handling or recovery.',
            'Raw original output and original throws remain; diagnostic emission failures are isolated and reported on later events.',
            'Old-session callback sightings are live JS-callback evidence only; missing sightings do not prove platform cleanup.',
            'Counter reach and submission API return are not evidence of visible pixels or GPU completion.',
            'Local manifest contains provenance paths; excluded from preview by inherited packOptions.'] };
    return { manifest, files, prelude, patched, baseJs: base.js, parent: base.parent };
}

export function prepareHost({ parentDir, buildDir, output }) {
    if (fs.existsSync(output)) throw Error('Output already exists; refusing overwrite');
    const plan = planHost({ parentDir, buildDir });
    fs.mkdirSync(output);
    for (const [name, bytes] of Object.entries(plan.files)) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
    fs.writeFileSync(path.join(output, 'CANDIDATE.json'), serialize(plan.manifest), { flag: 'wx' });
    return plan.manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = options(process.argv.slice(2), ['--parent-dir', '--build-dir', '--out']);
    const manifest = prepareHost({ parentDir: args['--parent-dir'], buildDir: args['--build-dir'], output: args['--out'] });
    console.log(JSON.stringify({ packageId: manifest.identity.packageId, files: manifest.files.length,
        wasm: 'EXACT_PARENT_BYTES', js: 'STATIC_CHECKED_NOT_RUN', preview: manifest.state.preview }));
}
