import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { planHost } from './prepare-host.mjs';
import { restoreProbe } from './extend-probe.mjs';

export function verifyHost(output) {
    assert.ok(path.isAbsolute(output), 'Absolute candidate directory required');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'CANDIDATE.json')));
    assert.equal(manifest.schema, 'native-glx-ledger-candidate-v1');
    const plan = planHost({ parentDir: manifest.parentDirectory });
    assert.deepEqual(manifest, plan.manifest, 'Candidate provenance/runtime source changed');
    assert.deepEqual(fs.readdirSync(output).sort(), [...Object.keys(plan.files), 'CANDIDATE.json'].sort(), 'Candidate file set changed');
    for (const [name, bytes] of Object.entries(plan.files))
        assert.deepEqual(fs.readFileSync(path.join(output, name)), bytes, 'Candidate bytes changed: ' + name);
    assert.deepEqual(restoreProbe(fs.readFileSync(path.join(output, 'boundary-probe.js'))), plan.base.files['boundary-probe.js']);
    return { status: 'PASS_STATIC_NOT_RUN', packageId: manifest.identity.packageId, files: manifest.files.length,
        parentPackageId: manifest.identity.parentPackageId, parentProbeRestore: 'EXACT_BYTES',
        compilerHostedJs: 'EXACT_PARENT_BYTES', wasm: 'EXACT_PARENT_BYTES', library: 'SAME_HASH_NOT_RELINKED',
        otherInheritedFiles: 'EXACT_PARENT_BYTES', timers: 'TWO_ONE_SHOT_OBSERVATIONS',
        generatedExecution: 'NOT_RUN', wasmInstantiation: 'NOT_RUN', phone: 'NOT_RUN', preview: 'NOT_UPLOADED' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    console.log(JSON.stringify(verifyHost(process.argv[2])));
