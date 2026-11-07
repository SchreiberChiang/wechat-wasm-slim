// Custom feature profile for the same 24-patch official source recipe. Source
// materialization still uses the authenticated full recipe, not a new engine.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planOfficialCapabilitySources} from './official-capability-source-plan.mjs';
import {planOfficialBuild} from './official-build-plan.mjs';
import {planCustomWasm,normalizeCustomWasmRequest} from './custom-wasm-plan.mjs';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
export const OFFICIAL_CUSTOM_RAW_REQUEST='wxslim-official-custom-raw-build-request-v1';

export function customRawSourcePlan({profile,features}){
  assert.equal(profile,'custom','CUSTOM_RAW_PROFILE');
  const normalized=normalizeCustomWasmRequest(features),custom=planCustomWasm(normalized);
  const source=planOfficialCapabilitySources({profile:'full'}),base=planOfficialBuild({profile:'full'});
  assert.equal(custom.sourcePlanSha256,source.planSha256);
  const dependencies=new Map(source.dependencies.map(p=>[p.path,p]));
  for(const name of ['engine/custom-wasm-plan.mjs','engine/custom-module-selection.mjs','engine/official-custom-source-plan.mjs','engine/custom-feature-audit.mjs','engine/custom-build-evidence.mjs']){
    const bytes=fs.readFileSync(new URL('../'+name,import.meta.url));dependencies.set(name,{path:name,...pin(bytes)});
  }
  const {planSha256:materializationPlanSha256,...body}=source;
  const result={...body,schema:'wxslim-official-custom-source-plan-v1',profile:'custom',sourceMaterializationProfile:'full',
    materializationPlanSha256,features:normalized,dependencies:[...dependencies.values()],rawCapture:base.rawCapture,
    selectedProfile:{kind:'GENERATED_FROM_NORMALIZED_FEATURES',...pin(Buffer.from(custom.profileText))},
    generatedProfileText:custom.profileText,moduleSelection:custom.moduleSelection,
    parameterChanges:custom.parameterChanges,
    requirements:[...source.requirements,'Snapshot the generated profile and exact normalized feature request; never substitute the full profile.',
      'Audit actual custom module declarations and disabled-class declarations; these do not prove compiler macros, object removal or PCK compatibility.']};
  return {...result,planSha256:pin(Buffer.from(JSON.stringify(result))).sha256};
}

// Exact full/source profile and custom/build profile remain separate in receipts.
// Existing recipes keep their original argument shape for reproducible checks.
export const rawRecipePlanInput=request=>request.schema===OFFICIAL_CUSTOM_RAW_REQUEST?{profile:request.profile,features:request.features}:{profile:request.profile};
export const rawMaterializationProfile=request=>request.schema===OFFICIAL_CUSTOM_RAW_REQUEST?'full':request.profile;

export function selectedRawProfileBytes(sourcePlan,readRepository){
  const selected=sourcePlan.selectedProfile;
  if(selected.kind==='GENERATED_FROM_NORMALIZED_FEATURES'){
    assert.equal(sourcePlan.schema,'wxslim-official-custom-source-plan-v1');
    assert.equal(sourcePlan.profile,'custom');assert.equal(sourcePlan.sourceMaterializationProfile,'full');
    const expected=planCustomWasm(sourcePlan.features).profileText;
    assert.equal(sourcePlan.generatedProfileText,expected,'CUSTOM_RAW_PROFILE_CONTENT');
    const bytes=Buffer.from(expected);assert.deepEqual(pin(bytes),{bytes:selected.bytes,sha256:selected.sha256},'CUSTOM_RAW_PROFILE_PIN');return bytes;
  }
  assert.equal(sourcePlan.generatedProfileText,undefined,'CUSTOM_RAW_UNEXPECTED_PROFILE_TEXT');
  assert(typeof selected.path==='string');const bytes=readRepository(selected.path);
  assert.deepEqual(pin(bytes),{bytes:selected.bytes,sha256:selected.sha256},'RAW_FIXED_PROFILE_PIN');return bytes;
}
