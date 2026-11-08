import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import {sha} from './inputs.mjs';
import {CUSTOM_PAIR_PROFILE, readCompletedCustomPairTask} from '../../lib/custom-pair-task.mjs';
import {bundledPairSchema,readBundledPair} from './bundled-pair.mjs';
import {getOfficialRecipe, getRecipeIdentity, OFFICIAL_C050_CAPABILITY_PROFILE} from './official-engine-admission.mjs';

// The existing converter looks up recipes by profile at many checkpoints.
// Custom pins belong to one verified request, never to a process-wide registry.
const active = new AsyncLocalStorage();
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function customConversionContext() {
  const state = active.getStore();
  return state?.live ? state.context : null;
}

export async function readPreparedSource(file) {
  let cfg;
  try {
    const stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, 'bounded preparation config required');
    cfg = JSON.parse(fs.readFileSync(file));
  } catch {
    // 缺失、不是普通文件或不是 JSON：与其他准备失败一样报共用错误码，什么都没有写。
    throw Object.assign(Error('TASK_PAIR_PREPARATION_FAILED'), {code:'TASK_PAIR_PREPARATION_FAILED',
      reason:'PAIR_CUSTOM_PREPARATION_UNREADABLE', possibleSideEffects:'NONE'});
  }
  if (cfg.schema === bundledPairSchema) return readBundledPair(file, getOfficialRecipe(OFFICIAL_C050_CAPABILITY_PROFILE));
  if (cfg.schema === 'wxslim-rebuilt-capability-pair-v1') {
    const {readRebuiltCapabilityPair} = await import('../../engine/rebuilt-capability-pair.mjs');
    return readRebuiltCapabilityPair(file);
  }
  return readCompletedCustomPairTask(file);
}

export function withOfficialConfiguration(file, action) {
  const source = fs.readFileSync(file);
  const raw = JSON.parse(source);
  if (raw.engineProfile !== CUSTOM_PAIR_PROFILE) return active.getStore() ? active.run(null,action) : action();
  assert(typeof raw.customPreparation === 'string' && raw.customPreparation.trim(), 'customPreparation is required');
  const preparationConfig = path.resolve(path.dirname(path.resolve(file)), raw.customPreparation);
  return runCustom();

  async function runCustom() {
    const prepared = await readPreparedSource(preparationConfig);
    const {summary, preparation} = prepared;
    const base = getOfficialRecipe(OFFICIAL_C050_CAPABILITY_PROFILE);
    const baseIdentity = getRecipeIdentity(OFFICIAL_C050_CAPABILITY_PROFILE);
    const host = summary.derivation.hostProposal;
    assert.equal(summary.sourceCommit, base.engine.sourceCommit);
    assert.deepEqual(host.sourceContract, base.hostAdapter);
    assert.deepEqual(summary.outputBridge, base.hostAdapter.derived);
    const customSource = {taskId:summary.taskId, sourcePlanSha256:summary.sourcePlanSha256,
      preparationReceiptSha256:preparation.receipt.sha256};
    const rebuilt = summary.schema === 'wxslim-rebuilt-capability-pair-source-v1';
    const recipe = freeze({...base, id:rebuilt?'official-c050-rebuilt-'+summary.moduleProfile+'-development-v1':'official-c050-custom-development-v1',
      validation:summary.retainedFixed?'RETAINED_FAILED_FIXED_CAPABILITY_OUTPUT_RECHECKED':rebuilt?'COMPLETED_FIXED_CAPABILITY_BUILD_RECHECKED':summary.retainedEvidence?'FAILED_CUSTOM_RAW_RETAINED_BYTES_RECHECKED':'COMPLETED_CUSTOM_BUILD_SOURCE_RECHECKED', features:summary.features,
      engine:{...base.engine, profile:CUSTOM_PAIR_PROFILE, moduleSet:rebuilt?summary.moduleProfile:'custom', js:summary.outputJs,
        wasm:summary.inputs.wasm, preparation:'Seven rules applied to this source task', nativeMapping:host.nativeMapping},
      options:{...base.options, name:'glx-official-c050-custom-dev'},
      provenance:{base:baseIdentity, customSource, build:summary.build, selectedProfile:summary.selectedProfile,
        rawJs:summary.inputs.js, postprocessRules:base.provenance.postprocessRules},
      limits:['Development testing only. The project declaration and runtime must match this build.']});
    const identity = freeze({recipeId:recipe.id, recipeSha256:sha(JSON.stringify(recipe))});
    const configBytes = fs.readFileSync(preparationConfig);
    assert.equal(sha(configBytes), preparation.configuration.sha256);
    const paths = JSON.parse(configBytes);
    const resolve = p => path.resolve(path.dirname(preparationConfig), p);
    const context = Object.freeze({record:Object.freeze({recipe,identity}), preparationConfig, bundled:prepared.bundled === true,
      sourceRecipe:summary.sourceRecipe, protectedRoot:prepared.protectedRoot ?? resolve(paths.rawTaskRoot), rebuilt, retainedFixed:!!summary.retainedFixed,
      protectedFiles:Object.freeze(prepared.protectedRoot ? [preparationConfig] : [preparationConfig,resolve(paths.outputJs),resolve(paths.receipt)]),
      customSource:freeze(customSource), recheck:prepared.recheck,
      // Factory/output checks compare to their own copy, including the selected
      // minified import keys. No converter caller can replace the approved bytes.
      sourceHandle:() => ({js:Buffer.from(prepared.js),bridge:Buffer.from(prepared.bridge),summary:freeze(prepared.summary)})});
    assert(fs.readFileSync(file).equals(source), 'custom conversion configuration changed during admission');
    const state = {context, live:true};
    try { return await active.run(state, action); }
    finally { state.live = false; prepared.close?.(); }
  }
}
