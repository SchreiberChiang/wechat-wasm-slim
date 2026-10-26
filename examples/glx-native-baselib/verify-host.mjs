import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { planHost } from './prepare-host.mjs';

export function verifyHost(output) {
    assert.ok(path.isAbsolute(output), 'Absolute candidate directory required');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'CANDIDATE.json')));
    const plan = planHost({ parentDir: manifest.parentDirectory });
    assert.deepEqual(manifest, plan.manifest, 'Candidate source/provenance changed');
    assert.deepEqual(fs.readdirSync(output).sort(), [...Object.keys(plan.files), 'CANDIDATE.json'].sort());
    for (const [name, bytes] of Object.entries(plan.files))
        assert.deepEqual(fs.readFileSync(path.join(output, name)), bytes, 'Candidate bytes changed: ' + name);
    return { status: 'PASS_STATIC_NOT_RUN', packageId: manifest.identity.packageId, files: manifest.files.length,
        changedParentFiles: manifest.changedParentFiles, unchangedRuntimeFiles: manifest.inheritedFilesExact.length,
        allowedVersions: manifest.sdkPolicy.allowedVersions, wasm: 'EXACT_PARENT_BYTES_NOT_INSTANTIATED',
        compilerJs: 'EXACT_PARENT_BYTES_NOT_RUN', preview: 'NOT_UPLOADED', phone: 'NOT_RUN' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    console.log(JSON.stringify(verifyHost(process.argv[2])));
