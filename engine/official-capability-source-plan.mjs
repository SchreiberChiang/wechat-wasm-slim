// Complete source recipe for the four capability fixes. Read-only and portable.
// Does not select a tree, create files, authorize a build, or replace old recipes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planOfficialBuild,normalizeOfficialBuildPlanRequest} from './official-build-plan.mjs';
import {capabilityFollowupMetadata} from './official-capability-followup-source.mjs';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url));
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));return value;}
export function planOfficialCapabilitySources(request){
  assert.equal(arguments.length,1);
  const {profile}=normalizeOfficialBuildPlanRequest(request),base=planOfficialBuild({profile}),m=capabilityFollowupMetadata();
  assert.deepEqual(base.finalOutputs,m.baseOutputs);
  assert.deepEqual(base.argumentTemplate,m.baseArgumentTemplate);assert.deepEqual(base.library,m.baseLibrary);
  const inputs=new Map(base.officialInputs.map(p=>[p.path,p]));
  for(const input of m.extraOfficialInputs){
    const previous=inputs.get(input.path);
    if(previous)assert.deepEqual({bytes:previous.bytes,sha256:previous.sha256},{bytes:input.bytes,sha256:input.sha256});
    inputs.set(input.path,{...previous,...input});
  }
  assert.equal(inputs.size,26);
  const dependencies=new Map();
  for(const input of [...base.dependencies,...m.dependencies]){
    const previous=dependencies.get(input.path);if(previous)assert.deepEqual(pin(read(input.path)),{bytes:previous.bytes,sha256:previous.sha256});
    assert.deepEqual(pin(read(input.path)),{bytes:input.bytes,sha256:input.sha256});dependencies.set(input.path,input);
  }
  for(const name of ['engine/official-capability-source-plan.mjs','engine/official-capability-source-runtime.mjs','engine/official-build-source-runtime.mjs','engine/official-capability-followup-source.json',
    'engine/official-raw-source-recipe.mjs','engine/official-build-preflight.mjs','engine/official-build-raw.mjs'])dependencies.set(name,{path:name,...pin(read(name))});
  const plan={schema:'wxslim-official-capability-source-plan-v1',status:'SOURCE_PLAN_ONLY',profile,
    source:{repository:base.source.repository,commit:m.baseCommit,wholeTreeVerified:false},basePlanSha256:base.planSha256,
    officialInputs:[...inputs.values()],upstreamSource:base.upstreamSource,
    assembly:[
      {stage:'BASE',implementation:'engine/official-build-source.mjs',export:'prepareOfficialBuildSources',
        patches:base.patches,generatedSources:base.generatedSources,postPatchTransform:base.postPatchTransform,outputFiles:31,
        note:'Use the exact existing generator, including the generated storage backend and SCsub relocation; applying patches alone is insufficient.'},
      {stage:'CAPABILITY',implementation:'engine/official-capability-followup-source.mjs',export:'applyCapabilityFollowupSources',
        extraOfficialInputs:m.extraOfficialInputs,patches:m.followupPatches.map((p,i)=>({...p,order:21+i})),outputFiles:33,
        changedPaths:m.changedPaths,note:'Overlay once on authenticated base outputs; reject already patched or drifted inputs.'}
    ],
    finalOutputs:m.outputs,retiredSources:base.retiredSources,dependencies:[...dependencies.values()],
    selectedProfile:base.selectedProfile,argumentTemplate:base.argumentTemplate,toolchain:base.toolchain,library:base.library,
    parameterChanges:[],sourceWritten:false,executionAuthorized:false,executionCommand:null,buildReady:false,
    gates:{sourceReplay:'NOT_RUN_BY_PLAN',actualIncrementalFull:'SEPARATE_EVIDENCE_REQUIRED',cleanFullBuild:'NOT_RUN',
      cleanConservativeBuild:'NOT_RUN',sourceMaterializer:'IMPLEMENTED_NOT_EXECUTED',executorIntegration:'EXPLICIT_RAW_EXECUTOR_IMPLEMENTED_NOT_EXECUTED',runtime:'NOT_RUN',phone:'NOT_RUN'},
    requirements:['Use this complete source recipe in the shared materializer, whole-tree auditor and build snapshot before a clean build.',
      'Keep old build and runtime receipts immutable; a fresh plan does not inherit their success.',
      'After each real link, verify the new raw pair and derive JS once from raw output; do not reuse unrelated prepared JS.',
      'Complete and conservative use identical sources; only the fixed module profile differs. Each emitted pair requires its own audit and runtime acceptance.']};
  return {...plan,planSha256:pin(Buffer.from(canonical(plan))).sha256};
}
