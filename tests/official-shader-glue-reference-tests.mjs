import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {replayOfficialShaderGlueReference} from '../engine/official-shader-glue-reference.mjs';

const file=process.env.WXSLIM_GRAPHICS_RAW_JS;
assert(file,'Set explicit WXSLIM_GRAPHICS_RAW_JS to the fixed original capture; no optional success or private-path guessing');
const raw=fs.readFileSync(file),original=Buffer.from(raw);
let derived;
test('actual pinned raw glue composes two graphics rules, two original observers and return0',()=>{
 derived=replayOfficialShaderGlueReference(raw);assert(raw.equals(original));
 assert.equal(derived.receipt.graphics.edits.length,2);assert.equal(derived.receipt.steps.length,3);
 assert(derived.receipt.steps.every(s=>s.otherBytesPreserved));
 assert.equal(derived.receipt.completePostprocessor,false);assert.equal(derived.receipt.targetExecuted,false);
 assert.equal(derived.receipt.officialGeneratedInputVerified,false);
});
test('mutated input, caller pin and previously processed input cannot gain admission',()=>{
 const modified=Buffer.from(raw);modified[0]^=1;
 assert.throws(()=>replayOfficialShaderGlueReference(modified),/RAW_REFERENCE_NOT_PINNED/);
 assert.throws(()=>replayOfficialShaderGlueReference(raw,{input:raw}),/EXTERNAL_INPUT_PIN_NOT_ACCEPTED/);
 assert.throws(()=>replayOfficialShaderGlueReference(derived.output),/RAW_REFERENCE_NOT_PINNED/);
 assert.throws(()=>replayOfficialShaderGlueReference(raw.toString()),/BUFFER_REQUIRED/);
});
test('incomplete or zero byte input is not a shader-compatible runtime candidate',()=>{
 for(const b of [Buffer.alloc(0),raw.subarray(0,raw.length-1),Buffer.from('function evalCheckWxContextGlobalIdAvailable(){return 0}')])assert.throws(()=>replayOfficialShaderGlueReference(b),/RAW_REFERENCE_NOT_PINNED/);
});
