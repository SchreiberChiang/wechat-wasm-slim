import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { verifyHost as verifyParent } from '../glx-native-ledger-titles/verify-host.mjs';
import { options } from '../glx-native-framecolor/audit.mjs';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const PARENT_ID = 'native-glx-validation-e3bff4670c2ecebbbe0c';
export const PARENT_MANIFEST_SHA = '7c2d8c5ed4534992ec40caa367cbece19cbede99a1cfc38290745079a683f3b4';
export const allowedVersions = ['3.15.2', '3.17.5'];
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(file);
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const changedParentFiles = ['clock-gates.js', 'identity.js'];

export function auditParent(parentDir) {
    assert.ok(path.isAbsolute(parentDir), 'Absolute parent directory required');
    const manifestBytes = read(path.join(parentDir, 'CANDIDATE.json'));
    assert.equal(sha(manifestBytes), PARENT_MANIFEST_SHA, 'Frozen parent manifest mismatch');
    const parent = JSON.parse(manifestBytes);
    assert.equal(parent.identity.packageId, PARENT_ID);
    assert.equal(verifyParent(parentDir).status, 'PASS_STATIC_NOT_RUN');
    assert.deepEqual(fs.readdirSync(parentDir).sort(), [...parent.files.map(file => file.name), 'CANDIDATE.json'].sort());
    const files = {};
    for (const item of parent.files) {
        assert.equal(path.basename(item.name), item.name);
        const bytes = files[item.name] = read(path.join(parentDir, item.name));
        assert.equal(bytes.length, item.bytes, 'Parent length changed: ' + item.name);
        assert.equal(sha(bytes), item.sha256, 'Parent bytes changed: ' + item.name);
    }
    assert.deepEqual(files['identity.js'], Buffer.from('module.exports = ' + JSON.stringify(parent.identity) + ';\n'));
    return { parent, files, manifestBytes };
}

export function planHost({ parentDir }) {
    const base = auditParent(parentDir);
    const gate = read(path.join(here, 'clock-gates.cjs'));
    const originalGate = base.files['clock-gates.js'].toString('utf8');
    const condition = "if (sdk !== '3.17.5')";
    const message = 'Actual SDKVersion must be 3.17.5; no instantiate, retry or fallback.';
    assert.equal(originalGate.split(condition).length, 2, 'Frozen condition anchor changed');
    assert.equal(originalGate.split(message).length, 2, 'Frozen message anchor changed');
    const expectedGate = originalGate.replace(condition, "if (sdk !== '3.15.2' && sdk !== '3.17.5')")
        .replace(message, 'Actual SDKVersion must be 3.15.2 or 3.17.5; no instantiate, retry or fallback.');
    assert.deepEqual(gate, Buffer.from(expectedGate), 'Only the exact version predicate and rejection reason may change');
    new vm.Script(gate.toString('utf8'), { filename: 'clock-gates.js-syntax-only' });
    const shared = { ...base.files, 'clock-gates.js': gate };
    delete shared['identity.js'];
    const { packageId: oldId, ...oldInputs } = base.parent.identity;
    const inputs = { ...oldInputs, parentPackageId: PARENT_ID, parentManifestSha256: PARENT_MANIFEST_SHA,
        generatorSha256: sha(read(fileURLToPath(import.meta.url))),
        files: Object.fromEntries(Object.entries(shared).map(([name, bytes]) => [name, sha(bytes)])) };
    const identity = { packageId: 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20), ...inputs };
    const files = { ...shared, 'identity.js': Buffer.from('module.exports = ' + JSON.stringify(identity) + ';\n') };
    const inheritedFilesExact = Object.keys(base.files).filter(name => !changedParentFiles.includes(name));
    for (const name of inheritedFilesExact) assert.deepEqual(files[name], base.files[name], 'Unexpected runtime change: ' + name);
    const manifest = { ...base.parent, identity, status: 'prepared-not-run', parentDirectory: path.resolve(parentDir),
        parentManifestSha256: PARENT_MANIFEST_SHA,
        files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) })),
        changedParentFiles, addedFiles: [], inheritedFilesExact,
        sdkPolicy: { allowedVersions, actualVersion: 'READ_FROM_RUNTIME_UNCHANGED',
            readerExpectedVersion: 'EXPLICIT_EXACT_VERSION_PER_STAGE', stageOrder: ['3.17.5', '3.15.2'] },
        state: { ...base.parent.state, compilerJs: 'EXACT_PARENT_BYTES_NOT_RUN', adapter: 'EXACT_PARENT_BYTES_NOT_RUN',
            wasm: 'EXACT_PARENT_BYTES_NOT_INSTANTIATED', library: 'SAME_HASH_NOT_RELINKED',
            preview: 'NOT_UPLOADED', phone: 'NOT_RUN', cloud: 'DISABLED' } };
    return { manifest, files, base };
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
        changed: manifest.changedParentFiles, sdkPolicy: manifest.sdkPolicy, preview: 'NOT_UPLOADED' }));
}
