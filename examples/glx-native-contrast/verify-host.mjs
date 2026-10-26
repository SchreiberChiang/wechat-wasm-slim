import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { auditBuild, here, sha } from './audit.mjs';

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Usage: node verify-host.mjs ABSOLUTE_CANDIDATE_DIR');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'CANDIDATE.json'), 'utf8'));
assert.equal(manifest.schema, 'native-glx-validation-candidate-v1');
const names = manifest.files.map(file => file.name);
assert.equal(new Set(names).size, names.length);
assert.deepEqual(fs.readdirSync(output).sort(), [...names, 'CANDIDATE.json'].sort(), 'Unexpected candidate files');
for (const file of manifest.files) {
    assert.equal(path.basename(file.name), file.name, 'Manifest must only contain direct files');
    const bytes = fs.readFileSync(path.join(output, file.name));
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha(bytes), file.sha256);
}
const { packageId, ...inputs } = manifest.identity;
assert.equal(packageId, 'native-glx-validation-' + sha(JSON.stringify(inputs)).slice(0, 20));
for (const [name, hash] of Object.entries(inputs.files))
    assert.equal(hash, sha(fs.readFileSync(path.join(output, name))));
const identityFile = fs.readFileSync(path.join(output, 'identity.js'), 'utf8');
assert.ok(identityFile.startsWith('module.exports = ') && identityFile.endsWith(';\n'));
assert.deepEqual(JSON.parse(identityFile.slice('module.exports = '.length, -2)), manifest.identity);
const { report, js, wasm } = auditBuild(path.dirname(manifest.originalBuild));
assert.equal(report.buildRecordSha256, manifest.buildRecordSha256);
for (const name of ['jsSha256', 'wasmSha256', 'sourceSha256', 'librarySha256'])
    assert.equal(inputs[name], report[name], 'Identity/build mismatch: ' + name);
assert.equal(inputs.pinSha256, sha(fs.readFileSync(path.join(here, 'PINNED_PAIR.json'))));
assert.equal(inputs.generatorSha256, sha(fs.readFileSync(path.join(here, 'prepare-host.mjs'))));
const hosted = fs.readFileSync(path.join(output, 'triangle-hosted.js'));
assert.equal(hosted.length, manifest.originalJsOffset + manifest.originalJsLength);
assert.equal(sha(hosted.subarray(0, manifest.originalJsOffset)), manifest.preludeSha256);
assert.equal(sha(hosted.subarray(0, manifest.originalJsOffset)), inputs.preludeTemplateSha256);
assert.deepEqual(hosted.subarray(manifest.originalJsOffset), js);
assert.deepEqual(fs.readFileSync(path.join(output, 'triangle.wasm')), wasm);
assert.equal(sha(fs.readFileSync(path.join(output, 'weapp-adapter.js'))),
    '84c679ae0a6dbb226afb24110860e5142ac113a2e3a00a93449a09edeb4647f6');
const config = JSON.parse(fs.readFileSync(path.join(output, 'project.config.json'), 'utf8'));
assert.ok(config.packOptions.ignore.some(item => item.type === 'file' && item.value === 'CANDIDATE.json'));
console.log(JSON.stringify({ status: 'PASS', packageId, files: names.length,
    originalJsSuffixEqual: true, wasmBytesEqual: true, adapterHashPinned: true,
    generatedJs: 'NOT_RUN', wasm: 'NOT_INSTANTIATED', adapter: 'NOT_RUN', phone: 'NOT_RUN' }));
