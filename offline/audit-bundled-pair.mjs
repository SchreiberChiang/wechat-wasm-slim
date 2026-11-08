// Explicit historical review. Daily exports never load the historical reviewer.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPortablePair} from '../convert/lib/portable-pair.mjs';
import {readBundledPair} from '../convert/lib/bundled-pair.mjs';
import {getOfficialRecipe, OFFICIAL_C050_CAPABILITY_PROFILE} from '../convert/lib/official-engine-admission.mjs';

const [pair, proof] = process.argv.slice(2);
assert(process.argv.length === 4 && ['conservative','pure-2d'].includes(pair) && proof,
  'node offline/audit-bundled-pair.mjs conservative|pure-2d RESTORED_PROOF');
const fingerprint = fileURLToPath(new URL('./vendor/engines/' + pair + '/fingerprint.json', import.meta.url));
const bundled = readBundledPair(fingerprint, getOfficialRecipe(OFFICIAL_C050_CAPABILITY_PROFILE));
const original = await readPortablePair(path.resolve(proof, pair + '.json'));
try {
  const summary = original.summary, expected = bundled.summary;
  for (const key of ['taskId','sourceCommit','sourceRecipe','sourcePlanSha256','features','build','selectedProfile','outputJs','outputBridge'])
    assert.deepEqual(summary[key], expected[key], key);
  for (const key of ['js','wasm']) assert.deepEqual(summary.inputs[key], expected.inputs[key], key);
  assert.deepEqual(original.preparation.receipt, bundled.preparation.receipt);
  assert(original.js.equals(bundled.js) && original.bridge.equals(bundled.bridge));
  const host = summary.derivation.hostProposal, registered = expected.derivation.hostProposal;
  assert.deepEqual(host.sourceContract, registered.sourceContract);
  assert.deepEqual(host.nativeMapping, registered.nativeMapping);
  for (const binding of registered.allImportBindings)
    assert.deepEqual(host.allImportBindings.find(i => i.module === binding.module && i.name === binding.name)?.signature, binding.signature);
  assert(summary.retainedFixed || summary.retainedEvidence, 'Expected retained build evidence');
  console.log(JSON.stringify({pair, status:'PASS_RETAINED_ARTIFACT_REAUDIT', originalBuildStatus:'FAILED',
    fingerprint:bundled.preparation.configuration, js:summary.outputJs, wasm:summary.inputs.wasm}));
} finally { original.close(); }
