import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBuild, here, options, sha } from './audit.mjs';

// File preparation only. All validation precedes output creation.
export function prepareHost({ buildDir, adapterFile, projectDir, output }) {
    if (fs.existsSync(output)) throw Error('Output already exists; refusing to overwrite.');
    const { report, js, wasm } = auditBuild(buildDir);
    const adapter = fs.readFileSync(adapterFile);
    if (sha(adapter) !== '84c679ae0a6dbb226afb24110860e5142ac113a2e3a00a93449a09edeb4647f6')
        throw Error('Fixed adapter hash mismatch.');
    const host = fs.readFileSync(path.join(here, '../glx-native-triangle/host-template.cjs'));
    const observer = fs.readFileSync(path.join(here, '../glx-native-validation/observer.cjs'));
    const pin = fs.readFileSync(path.join(here, 'PINNED_PAIR.json'));
    const common = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.config.json'), 'utf8'));
    const privateConfig = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.private.config.json'), 'utf8'));
    if (common.compileType !== 'game' || typeof common.appid !== 'string' || !common.appid)
        throw Error('Existing minigame AppID/config required; no new account or AppID is selected.');
    common.projectname = 'native-glx-contrast-' + report.wasmSha256.slice(0, 12);
    privateConfig.projectname = common.projectname;
    common.libVersion = '3.17.5';
    privateConfig.libVersion = '3.17.5';
    // The local seal contains provenance paths and must never enter a preview.
    common.packOptions = common.packOptions || {};
    common.packOptions.ignore = common.packOptions.ignore || [];
    if (!common.packOptions.ignore.some(item => item.type === 'file' && item.value === 'CANDIDATE.json'))
        common.packOptions.ignore.push({ type: 'file', value: 'CANDIDATE.json' });
    const preludeTemplate = '// Audited local prelude; generated JS follows unchanged.\n' +
        'var __triangleIdentity = require("./identity.js");\n' +
        'var __triangleSession = GameGlobal.__nativeTriangleEvidence;\n' +
        'var __triangleHost = require("./host.js").createHost(GameGlobal, wx, __triangleIdentity, __triangleSession.host);\n' +
        'var Module = __triangleHost.moduleConfig;\n' +
        'Module.print = function(message) { __triangleSession.native(message, false); };\n' +
        'Module.printErr = function(message) { __triangleSession.native(message, true); };\n' +
        'var WebAssembly = __triangleHost.errorApi;\n' +
        'Object.defineProperty(Module, "HEAPU8", { get: function() { return HEAPU8; } });\n' +
        '// BEGIN ORIGINAL TRIANGLE.JS BYTES\n';
    const entry = Buffer.from('var identity = require("./identity.js");\n' +
        'GameGlobal.__nativeTriangleEvidence = require("./observer.js").start(GameGlobal, wx, identity);\n' +
        'require("./weapp-adapter.js");\nrequire("./triangle-hosted.js");\n');
    const game = Buffer.from(JSON.stringify({ deviceOrientation: 'portrait', iOSHighPerformance: true,
        'iOSHighPerformance+': true }, null, 2) + '\n');
    const serialize = object => Buffer.from(JSON.stringify(object, null, 2) + '\n');
    const shared = { 'game.js': entry, 'game.json': game, 'host.js': host, 'observer.js': observer,
        'weapp-adapter.js': adapter, 'triangle.wasm': wasm,
        'project.config.json': serialize(common), 'project.private.config.json': serialize(privateConfig) };
    const identityInputs = { variant: 'blue-green-contrast-v1',
        parentPackageId: 'native-glx-validation-57ccb8dd415854427515',
        jsSha256: sha(js), wasmSha256: sha(wasm), sourceSha256: report.sourceSha256,
        librarySha256: report.librarySha256, pinSha256: sha(pin), preludeTemplateSha256: sha(preludeTemplate),
        generatorSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
        files: Object.fromEntries(Object.entries(shared).map(([name, bytes]) => [name, sha(bytes)])) };
    const identity = { packageId: 'native-glx-validation-' + sha(JSON.stringify(identityInputs)).slice(0, 20), ...identityInputs };
    const prelude = Buffer.from(preludeTemplate);
    const files = { ...shared, 'identity.js': Buffer.from('module.exports = ' + JSON.stringify(identity) + ';\n'),
        'triangle-hosted.js': Buffer.concat([prelude, js]) };
    const manifest = { schema: 'native-glx-validation-candidate-v1', identity,
        status: 'prepared-not-run', buildRecordSha256: report.buildRecordSha256,
        originalBuild: path.resolve(buildDir, 'BUILD.json'), adapterSource: path.resolve(adapterFile),
        projectConfigSource: path.resolve(projectDir),
        originalJsOffset: prelude.length, originalJsLength: js.length, preludeSha256: sha(prelude),
        files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) })),
        shaderObservations: { perSessionMaxTypeReads: 3, typeMeaning: 'GLX query return, not independently observed platform object type',
            sourceMeaning: 'GLSL input preserved; platform actual compile input not observed',
            timingEffect: 'adds synchronous batch boundaries; disappearance of failure is not proof of repair' },
        state: { generatedJs: 'NOT_RUN', wasm: 'NOT_INSTANTIATED', adapter: 'NOT_RUN', preview: 'NOT_UPLOADED',
            phone: 'NOT_RUN', visibleRendering: 'NOT_VERIFIED', lifecycle: 'NOT_VERIFIED', cloud: 'DISABLED' },
        notes: ['Only native runtime change versus the parent is the reviewed blue/green glClearColor expression; original time formula and submission preserved.',
            'No Godot engine, PCK, loader, SDK, WASM splitting or rendering optimization.',
            'AppID and compilation settings copied from parent; display names and common/private libVersion target 3.17.5 changed; local CANDIDATE.json excluded from preview.',
            'Configured base-library version is not proof of actual phone SDKVersion.',
            'Session tag identifies a JS observer lifetime; it does not independently prove OS process replacement.',
            'Original compiler output and adapter copied byte-for-byte; same-scope HEAPU8 getter retained.',
            'Observer does not create contexts, submit frames, poll, send cloud data, or write storage.'] };
    fs.mkdirSync(output, { recursive: false });
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
    fs.writeFileSync(path.join(output, 'CANDIDATE.json'), serialize(manifest), { flag: 'wx' });
    return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = options(process.argv.slice(2), ['--build-dir', '--adapter', '--project-dir', '--out']);
    const manifest = prepareHost({ buildDir: args['--build-dir'], adapterFile: args['--adapter'],
        projectDir: args['--project-dir'], output: args['--out'] });
    console.log(JSON.stringify({ status: manifest.status, packageId: manifest.identity.packageId, files: manifest.files.length,
        phone: manifest.state.phone, cloud: manifest.state.cloud }));
}
