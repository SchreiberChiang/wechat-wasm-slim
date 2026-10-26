import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { verifyHost as verifyParent } from '../glx-native-boundary/verify-host.mjs';
import { options } from '../glx-native-framecolor/audit.mjs';
import { extendProbe, entryAddition, PARENT_PROBE_SHA, sha } from './extend-probe.mjs';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const PARENT_ID = 'native-glx-validation-9b31f77db008bc37fda1';
export const PARENT_MANIFEST_SHA = '2fa5a6c5acaf2969317e870e563414080cbbc56cacda74f445a5f34df8991f57';
const read = file => fs.readFileSync(file);
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const changedParentFiles = ['game.js', 'identity.js', 'boundary-probe.js'];

export function auditParent(parentDir) {
    assert.ok(path.isAbsolute(parentDir), 'Absolute parent directory required');
    const manifestBytes = read(path.join(parentDir, 'CANDIDATE.json'));
    assert.equal(sha(manifestBytes), PARENT_MANIFEST_SHA, 'Frozen parent manifest mismatch');
    const parent = JSON.parse(manifestBytes);
    assert.equal(parent.schema, 'native-glx-boundary-candidate-v1');
    assert.equal(parent.identity.packageId, PARENT_ID, 'Unknown parent package');
    const { packageId, ...parentInputs } = parent.identity;
    assert.equal(packageId, 'native-glx-validation-' + sha(JSON.stringify(parentInputs)).slice(0, 20));
    // Rebuild the parent plan from its original source/build provenance; never
    // trust only a candidate's own file hashes or the library's version marker.
    assert.equal(verifyParent(parentDir).status, 'PASS_STATIC_NOT_RUN');
    assert.deepEqual(fs.readdirSync(parentDir).sort(), [...parent.files.map(item => item.name), 'CANDIDATE.json'].sort());
    const files = {};
    for (const item of parent.files) {
        assert.equal(path.basename(item.name), item.name);
        const bytes = files[item.name] = read(path.join(parentDir, item.name));
        assert.equal(bytes.length, item.bytes, 'Parent seal length mismatch: ' + item.name);
        assert.equal(sha(bytes), item.sha256, 'Parent seal mismatch: ' + item.name);
    }
    assert.equal(sha(files['boundary-probe.js']), PARENT_PROBE_SHA);
    assert.equal(sha(files['triangle.wasm']), parent.identity.wasmSha256);
    assert.deepEqual(files['identity.js'], Buffer.from('module.exports = ' + JSON.stringify(parent.identity) + ';\n'));
    return { parent, files, manifestBytes };
}

export function planHost({ parentDir }) {
    const base = auditParent(parentDir);
    const { patched, proof } = extendProbe(base.files['boundary-probe.js']);
    const ledger = read(path.join(here, 'ledger.cjs'));
    const shared = { ...base.files };
    delete shared['identity.js'];
    shared['game.js'] = Buffer.concat([base.files['game.js'], Buffer.from(entryAddition)]);
    shared['boundary-probe.js'] = patched;
    shared['execution-ledger.js'] = ledger;
    // All inherited compiler output, host, observer, orientation, settings,
    // adapter and gates stay exact. Only the diagnostic module is substituted.
    for (const [name, bytes] of Object.entries(base.files)) if (!changedParentFiles.includes(name))
        assert.deepEqual(shared[name], bytes, 'Unexpected inherited change: ' + name);
    for (const name of ['game.js', 'boundary-probe.js', 'execution-ledger.js'])
        new vm.Script(shared[name].toString('utf8'), { filename: name + '-syntax-only' });
    const { packageId: oldPackageId, ...oldInputs } = base.parent.identity;
    const inputs = { ...oldInputs, variant: 'js-boundary-v1', diagnosticVariant: 'execution-ledger-v1',
        parentPackageId: PARENT_ID, parentManifestSha256: PARENT_MANIFEST_SHA,
        generatorSha256: sha(read(fileURLToPath(import.meta.url))),
        probeExtenderSha256: sha(read(path.join(here, 'extend-probe.mjs'))),
        probeExtensionSha256: sha(JSON.stringify(proof)),
        ledgerSha256: sha(ledger), checkpointDelaysMs: [4000, 9000], checkpointOutputLimit: 2,
        files: Object.fromEntries(Object.entries(shared).map(([name, bytes]) => [name, sha(bytes)])) };
    const identity = { packageId: 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20), ...inputs };
    const files = { ...shared, 'identity.js': Buffer.from('module.exports = ' + JSON.stringify(identity) + ';\n') };
    const manifest = { schema: 'native-glx-ledger-candidate-v1', identity,
        status: 'prepared-not-run', parentDirectory: path.resolve(parentDir), parentManifestSha256: PARENT_MANIFEST_SHA,
        originalBuild: base.parent.originalBuild, buildRecordSha256: base.parent.buildRecordSha256,
        compilerHostedJsSha256: sha(files['triangle-hosted.js']),
        inheritedCompilerPatch: base.parent.patch, probeExtension: proof,
        files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) })),
        changedParentFiles, addedFiles: ['execution-ledger.js'],
        inheritedFilesExact: Object.keys(base.files).filter(name => !changedParentFiles.includes(name)),
        observations: { ledger: 'Every existing invoke: enter/return/throw; bounded stage/open/last data',
            checkpointDelaysMs: [4000, 9000], outputLimit: 2, prefix: '[GLX_TRIANGLE_CHECKPOINT]',
            clock: 'Date.now wall-clock observations, not FPS or a guaranteed callback interval',
            existingBoundarySelection: [1, 2, 61], existingBoundaryLimit: 96, existingColorLimit: 180,
            effect: 'Extra memory updates, two timers and two logs can change reproduction timing' },
        state: { compilerJs: 'EXACT_PARENT_BYTES_NOT_RUN', adapter: 'EXACT_PARENT_BYTES_NOT_RUN',
            wasm: 'EXACT_PARENT_BYTES_NOT_INSTANTIATED', library: 'SAME_HASH_NOT_RELINKED',
            preview: 'NOT_UPLOADED', phone: 'NOT_RUN', cloud: 'DISABLED' },
        limits: ['Timers only observe; no extra RAF, frame, flush, batch, swap, GPU query or recovery.',
            'No Promise awaiting, touch handler, overlay, repeating watchdog, persistence, enumeration or phone operation.',
            'Missing checkpoints cannot distinguish a blocked JS thread, undelivered timers and lost logs.',
            'Two close/invalid wall-clock timestamps do not establish a meaningful stalled interval.',
            'Return means only the synchronous JS boundary, never GPU or visible pixels.',
            'This new package/session cannot recover or supply evidence for the unknown old live session.'] };
    return { manifest, files, base, patched, proof };
}

export function prepareHost({ parentDir, output }) {
    assert.ok(path.isAbsolute(output), 'Absolute fresh output directory required');
    if (fs.existsSync(output)) throw Error('Output already exists; refusing overwrite');
    const plan = planHost({ parentDir });
    fs.mkdirSync(output);
    for (const [name, bytes] of Object.entries(plan.files)) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
    fs.writeFileSync(path.join(output, 'CANDIDATE.json'), jsonBytes(plan.manifest), { flag: 'wx' });
    return plan.manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = options(process.argv.slice(2), ['--parent-dir', '--out']);
    const manifest = prepareHost({ parentDir: args['--parent-dir'], output: args['--out'] });
    console.log(JSON.stringify({ packageId: manifest.identity.packageId, files: manifest.files.length,
        compilerJs: manifest.state.compilerJs, wasm: manifest.state.wasm, preview: 'NOT_UPLOADED' }));
}
