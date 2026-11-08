import assert from 'node:assert/strict';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {normalizeCustomWasmRequest} from '../../engine/custom-wasm-plan.mjs';
import {customModuleSelection} from '../../engine/custom-module-selection.mjs';

// The author reviews the game's use of engine features, including dynamic
// loads. Parsing a PCK verifies its files and identity, not that review.
export function planCustomProjectUsage(features, pckBytes) {
  const requested = normalizeCustomWasmRequest(features);
  const modules = customModuleSelection(requested);
  const pack = inspectPck(pckBytes);
  assert.deepEqual(pack.engineVersion, {major:4, minor:7, patch:2}, 'custom Web recipe requires a Godot 4.7.2 PCK');
  assert(pack.entries.some(entry => entry.path === 'project.binary'), 'startup PCK needs project.binary');
  const removed = [...new Set([...modules.explicitDisabledModules, ...modules.additionalRemovedFromFull])].sort();
  const declaration = {
    schema:'wxslim-custom-project-usage-v1',
    pck:{bytes:pack.bytes, sha256:pack.sha256}, features:requested,
    engine3dRemoved:requested.dimensions === '2d',
    removedModules:removed, disabledClasses:requested.disabledClasses,
    removedFeaturesUnused:null
  };
  return {declaration, packedFiles:pack.entries.length, engineVersion:pack.engineVersion,
    review:'AUTHOR_REVIEW_REQUIRED', runtime:'NOT_RUN'};
}

export function checkCustomProjectUsage(features, pckBytes, supplied) {
  const {declaration, packedFiles, engineVersion} = planCustomProjectUsage(features, pckBytes);
  declaration.removedFeaturesUnused = true;
  // Compare the whole declaration; unknown fields, partial reviews, stale PCK
  // bytes or a declaration for a different custom profile must not be reused.
  assert.deepEqual(supplied, declaration, 'project usage must cover this exact PCK and every removed feature');
  return {declaration, packedFiles, engineVersion, review:'MATCHED_AUTHOR_DECLARATION',
    dependencyClosure:'NOT_INFERRED', runtime:'NOT_RUN'};
}
