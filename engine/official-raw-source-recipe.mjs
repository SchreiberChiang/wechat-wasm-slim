// Closed source recipes for the common raw executor. No caller-supplied hooks.
// Selecting a recipe is not permission to create a checkout or start a build.
import assert from 'node:assert/strict';
import {planOfficialBuild} from './official-build-plan.mjs';
import {planOfficialCapabilitySources} from './official-capability-source-plan.mjs';
import {auditOfficialBuildCheckout} from './official-build-source.mjs';
import {materializeOfficialBuildSources,auditOfficialPostbuildSource} from './official-build-source-runtime.mjs';
import {materializeOfficialCapabilitySources,auditOfficialCapabilityPrecompileSource,auditOfficialCapabilityPostbuildSource} from './official-capability-source-runtime.mjs';
import {customRawSourcePlan,OFFICIAL_CUSTOM_RAW_REQUEST} from './official-custom-source-plan.mjs';
export {OFFICIAL_CUSTOM_RAW_REQUEST} from './official-custom-source-plan.mjs';

export const OFFICIAL_BASE_RAW_REQUEST='wxslim-official-raw-build-request-v1';
export const OFFICIAL_CAPABILITY_RAW_REQUEST='wxslim-official-capability-raw-build-request-v1';
export const OFFICIAL_RAW_REQUEST_SCHEMAS=Object.freeze([OFFICIAL_BASE_RAW_REQUEST,OFFICIAL_CAPABILITY_RAW_REQUEST,OFFICIAL_CUSTOM_RAW_REQUEST]);
const base=Object.freeze({id:'official-c050-base-20',outputFiles:31,plan:planOfficialBuild,
  materialize:materializeOfficialBuildSources,postbuild:auditOfficialPostbuildSource,
  preparedStatus:receipt=>receipt.preparedAudit.status,
  precompile:async({source,gitExecutable,profile,baseline,receipt})=>{
    assert.equal(baseline.schema,'wxslim-official-prebuild-source-manifest-v1');
    assert.equal(receipt.schema,'wxslim-official-source-materialization-v1');
    const result=await auditOfficialBuildCheckout({source,gitExecutable,profile,mode:'prepared'});
    assert.deepEqual(result,receipt.preparedAudit,'RAW_PRECOMPILE_SOURCE_DRIFT');return result;
  }});
const capability=Object.freeze({id:'official-c050-capability-24',outputFiles:34,
  plan:({profile})=>{
    const result=planOfficialCapabilitySources({profile}),original=planOfficialBuild({profile});
    assert.equal(result.basePlanSha256,original.planSha256);
    // Raw capture nodes are unchanged by the seven-source overlay.
    return {...result,rawCapture:original.rawCapture};
  },materialize:materializeOfficialCapabilitySources,postbuild:auditOfficialCapabilityPostbuildSource,
  preparedStatus:receipt=>receipt.status,
  precompile:async({source,gitExecutable,profile,baseline,receipt})=>{
    assert.equal(receipt.schema,'wxslim-official-capability-source-materialization-v1');
    assert.equal(receipt.planSha256,baseline.planSha256);
    assert.equal(baseline.profile,profile);
    assert.equal(receipt.base.planSha256,baseline.basePlanSha256);
    assert.equal(receipt.baseCompleted,true);
    assert.deepEqual(receipt.overlayAttempts.slice().sort(),baseline.capabilityChangedPaths);
    assert.deepEqual(receipt.overlayCompleted.slice().sort(),baseline.capabilityChangedPaths);
    return auditOfficialCapabilityPrecompileSource({source,gitExecutable,baseline});
  }});
const custom=Object.freeze({id:'official-c050-capability-custom',outputFiles:34,plan:customRawSourcePlan,
  // Caller supplies the separately authenticated source profile ('full'). The
  // custom feature selection is exclusively an input/profile.gdbuild change.
  materialize:capability.materialize,postbuild:capability.postbuild,
  preparedStatus:capability.preparedStatus,precompile:capability.precompile});
export function officialRawSourceRecipe(schema){
  assert.equal(arguments.length,1);assert(OFFICIAL_RAW_REQUEST_SCHEMAS.includes(schema),'OFFICIAL_RAW_RECIPE_SCHEMA');
  return schema===OFFICIAL_BASE_RAW_REQUEST?base:schema===OFFICIAL_CAPABILITY_RAW_REQUEST?capability:custom;
}
