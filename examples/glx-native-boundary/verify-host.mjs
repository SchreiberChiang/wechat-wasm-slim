import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { planHost } from './prepare-host.mjs';
import { sha, restoreCompilerJs, SAME_WASM_SHA } from './patch-generated.mjs';

export function verifyHost(output) {
    assert.ok(path.isAbsolute(output), 'Absolute candidate directory required');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'CANDIDATE.json')));
    assert.equal(manifest.schema, 'native-glx-boundary-candidate-v1');
    const plan = planHost({ parentDir: manifest.parentDirectory, buildDir: path.dirname(manifest.originalBuild) });
    assert.deepEqual(manifest, plan.manifest, 'Candidate provenance/runtime source changed');
    assert.deepEqual(fs.readdirSync(output).sort(), [...Object.keys(plan.files), 'CANDIDATE.json'].sort());
    for (const [name, bytes] of Object.entries(plan.files)) assert.deepEqual(fs.readFileSync(path.join(output, name)), bytes, 'Candidate bytes changed: ' + name);
    const compilerPart = fs.readFileSync(path.join(output, 'triangle-hosted.js')).subarray(manifest.diagnosticJsOffset);
    assert.deepEqual(restoreCompilerJs(compilerPart), plan.baseJs);
    assert.equal(sha(fs.readFileSync(path.join(output, 'triangle.wasm'))), SAME_WASM_SHA);
    return { status: 'PASS_STATIC_NOT_RUN', packageId: manifest.identity.packageId, files: manifest.files.length,
        compilerJsRestore: 'EXACT_PARENT_BYTES', wasm: 'EXACT_PARENT_BYTES', adapterAndGates: 'EXACT_PARENT_BYTES',
        generatedExecution: 'NOT_RUN', phone: 'NOT_RUN', preview: 'NOT_UPLOADED' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyHost(process.argv[2])));
