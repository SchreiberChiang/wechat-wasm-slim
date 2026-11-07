import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {auditRetainedCustom2dSource} from '../engine/retained-custom-2d-source.mjs';

test('a consistent-looking failure record cannot select its own reviewed payload',async()=>{
 const reads=[];
 const counterfeit=Buffer.from(JSON.stringify({requestedTerminal:'FAILED',artifactState:'RAW_NOT_CAPTURED'}));
 await assert.rejects(auditRetainedCustom2dSource(path.resolve('.'),file=>{
  reads.push(path.basename(file));
  return counterfeit;
 }),/RETAINED_RECORD BUILD.json/);
 assert.deepEqual(reads,['BUILD.json']);
});
