import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sha} from './inputs.mjs';
import {prepareSecureRandomBridge} from './secure-random-bridge.mjs';

export const bundledPairSchema = 'wxslim-bundled-engine-fingerprint-v1';
const fingerprints = Object.freeze({
  conservative: 'cef29ea4b1ba2f445cbfd91be9569c92295954103b974d729365072663f1d986',
  'pure-2d': '3f9a4cfc11bbd07bd421471c8d4eae65c494cf625f4c35a6e2274c32e6aa78b3',
});

function readFile(file, maximum) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.size <= maximum && path.relative(fs.realpathSync(file), path.resolve(file)) === '',
    'BUNDLED_PAIR_ORDINARY_FILE');
  return fs.readFileSync(file);
}

export function loadBundledFingerprint(file, pair) {
  const bytes = readFile(file, 8192);
  const record = JSON.parse(bytes);
  assert(record.schema === bundledPairSchema && Object.hasOwn(fingerprints, record.pair) &&
    (!pair || pair === record.pair) && sha(bytes) === fingerprints[record.pair], 'BUNDLED_FINGERPRINT_MISMATCH');
  return {record, configuration:{bytes:bytes.length, sha256:fingerprints[record.pair]}};
}

function checkBytes(bytes, expected, name) {
  assert(bytes.length === expected.bytes && sha(bytes) === expected.sha256, 'BUNDLED_ENGINE_MISMATCH ' + name);
}

export function readBundledPair(file, base) {
  const root = path.dirname(path.resolve(file));
  const {record:r, configuration} = loadBundledFingerprint(file);
  function checked(name, expected) {
    const bytes = readFile(path.join(root, name), expected.bytes);
    checkBytes(bytes, expected, name);
    return bytes;
  }
  function recheck() {
    loadBundledFingerprint(file, r.pair);
    checked('godot.wasm', r.wasm);
    return checked('godot.prepared.js', r.js);
  }
  const js = recheck();
  const bridge = Buffer.from(prepareSecureRandomBridge().source);
  checkBytes(bridge, r.bridge, 'host bridge');
  const summary = {
    ...(r.pair === 'conservative' ? {schema:'wxslim-rebuilt-capability-pair-source-v1', moduleProfile:'conservative', retainedFixed:true}
      : {retainedEvidence:true}),
    taskId:r.taskId, features:r.features, sourceCommit:r.sourceCommit, sourceRecipe:r.sourceRecipe,
    sourcePlanSha256:r.sourcePlanSha256, build:r.build, selectedProfile:r.selectedProfile,
    inputs:{js:r.rawJs, wasm:r.wasm}, outputJs:r.js, outputBridge:r.bridge,
    derivation:{hostProposal:{sourceContract:base.hostAdapter, nativeMapping:r.nativeMapping, allImportBindings:r.importBindings}},
  };
  return {bundled:true, js, bridge, summary, protectedRoot:root, preparation:{configuration, receipt:r.receipt}, recheck};
}
