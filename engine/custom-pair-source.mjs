// Recheck an existing completed custom raw task and derive JS only in memory.
// No builds, directories, payload writes, converter registration or runtime.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auditCompletedOfficialRawBuild} from './official-build-raw.mjs';
import {customRawSourcePlan,OFFICIAL_CUSTOM_RAW_REQUEST} from './official-custom-source-plan.mjs';
import {proposeCustomRawHost} from './custom-host-bindings.mjs';
import {auditRetainedCustom2dSource,retainedProvenance,retainedTaskId} from './retained-custom-2d-source.mjs';

const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const names={js:'godot.raw.js',wasm:'godot.wasm',symbols:'godot.js.symbols'};
const limits={js:4*1024*1024,wasm:256*1024*1024,symbols:64*1024*1024};
const sourceNames=['engine/custom-pair-source.mjs','engine/official-raw-postprocess.mjs','engine/official-captured-imports.mjs',
 'engine/official-glx-library/audit-linkage.cjs','engine/shader-failure/instrument-glue.cjs','engine/shader-type-return/instrument-glue.cjs',
 'engine/custom-host-bindings.mjs','engine/official-glue-inspection.mjs','convert/lib/secure-random-bridge.mjs',
 'convert/lib/official-engine-admission.mjs','convert/official-c050-capability-recipe.json',
 'convert/assets/godot-bridge.js','convert/assets/secure-random-host.js','convert/assets/secure-random-lifecycle.js'];
function regular(file,max,allowEmpty=false){
 if(file instanceof URL)file=fileURLToPath(file);
 const st=fs.lstatSync(file);
 assert(st.isFile()&&!st.isSymbolicLink()&&(st.size>0||allowEmpty)&&st.size<=max,'CUSTOM_PAIR_REGULAR_INPUT');
 assert.equal(norm(fs.realpathSync(file)),norm(file),'CUSTOM_PAIR_LINKED_INPUT');
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
 for(const k of ['size','dev','ino','mtimeMs','ctimeMs'])assert.equal(st[k],after[k],'CUSTOM_PAIR_READ_DRIFT');
 assert.equal(bytes.length,st.size);return bytes;
}
function json(bytes){const text=bytes.toString('utf8');assert(Buffer.from(text).equals(bytes),'CUSTOM_PAIR_UTF8');return JSON.parse(text);}
function customRequest(build){
 assert.equal(build.schema,'wxslim-official-raw-build-v1','CUSTOM_PAIR_BUILD_SCHEMA');
 assert.equal(build.plan?.request?.schema,OFFICIAL_CUSTOM_RAW_REQUEST,'CUSTOM_PAIR_CUSTOM_TASK_REQUIRED');
 assert.equal(build.plan.request.profile,'custom','CUSTOM_PAIR_CUSTOM_PROFILE_REQUIRED');
 return build.plan.request;
}

// Consistency only: a caller-created report is not authenticated by this helper.
// The public checker below always obtains `audit` from the real raw-task auditor.
export function matchCustomPairBuildEvidence({buildBytes,audit}){
 assert(Buffer.isBuffer(buildBytes),'CUSTOM_PAIR_BUILD_BYTES');
 const build=json(buildBytes),request=customRequest(build);
 assert.equal(audit?.schema,'wxslim-official-raw-completed-audit-v1','CUSTOM_PAIR_AUDIT_SCHEMA');
 assert.equal(audit.status,'RAW_TASK_RECHECKED_NOT_ADMITTED','CUSTOM_PAIR_AUDIT_STATUS');
 assert.equal(audit.profile,'custom','CUSTOM_PAIR_AUDIT_PROFILE');
 assert.equal(audit.sourceRecipe,'official-c050-capability-custom','CUSTOM_PAIR_SOURCE_RECIPE');
 assert.equal(audit.taskId,build.taskId,'CUSTOM_PAIR_TASK_ID');
 assert.equal(audit.admission,'NOT_ADMITTED');assert.equal(audit.postprocess,'NOT_RUN');assert.equal(audit.runtime,'NOT_RUN');
 assert.deepEqual(audit.build,pin(buildBytes),'CUSTOM_PAIR_BUILD_CHANGED');
 assert.equal(build.requestedTerminal,'SUCCESS','CUSTOM_PAIR_BUILD_NOT_SUCCESS');
 const source=customRawSourcePlan({profile:'custom',features:request.features});
 assert.equal(audit.sourceCommit,source.source.commit,'CUSTOM_PAIR_SOURCE_COMMIT');
 assert.equal(build.plan.sourcePlanSha256,source.planSha256,'CUSTOM_PAIR_CURRENT_SOURCE_PLAN');
 assert.equal(build.plan.sourceRecipe,audit.sourceRecipe,'CUSTOM_PAIR_BUILD_RECIPE');
 assert.deepEqual(audit.outputs,build.capture?.outputs,'CUSTOM_PAIR_CAPTURE_RECORD');
 assert.deepEqual(Object.keys(audit.outputs).sort(),Object.values(names).sort(),'CUSTOM_PAIR_CAPTURE_SET');
 for(const [key,name]of Object.entries(names)){
  const p=audit.outputs[name];assert(Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=limits[key]&&/^[a-f0-9]{64}$/.test(p.sha256),'CUSTOM_PAIR_ARTIFACT_ID');
 }
 return {schema:'wxslim-custom-pair-evidence-match-v1',status:'CONSISTENT_RECORDS_NOT_AUTHENTICATED',taskId:build.taskId,
  build:pin(buildBytes),sourceCommit:audit.sourceCommit,sourceRecipe:audit.sourceRecipe,sourcePlanSha256:source.planSha256,
  features:source.features,selectedProfile:source.selectedProfile,rawOutputs:audit.outputs,
  provenance:'REQUIRES_REAL_COMPLETED_TASK_REAUDIT',admission:'NOT_ADMITTED'};
}

export async function prepareCompletedCustomPairSource(work,taskId){
 return prepareSource(work,taskId,false,arguments.length);
}

export async function prepareDevelopmentCustomPairSource(work,taskId){
 return prepareSource(work,taskId,taskId===retainedTaskId,arguments.length);
}

async function prepareSource(work,taskId,retained,arity){
 let stage='INPUTS';
 try{
  assert.equal(arity,2,'CUSTOM_PAIR_TWO_ARGUMENTS');
  assert(typeof work==='string'&&path.isAbsolute(work)&&!/[\0\r\n]/.test(work),'CUSTOM_PAIR_ABSOLUTE_WORK');
  assert(typeof taskId==='string'&&/^[a-f0-9-]{36}$/.test(taskId),'CUSTOM_PAIR_TASK_ID_FORMAT');
  work=path.resolve(work);
  const st=fs.lstatSync(work);assert(st.isDirectory()&&!st.isSymbolicLink(),'CUSTOM_PAIR_WORK_DIRECTORY');
  assert.equal(norm(fs.realpathSync(work)),norm(work),'CUSTOM_PAIR_LINKED_WORK');
  const buildFile=path.join(work,'BUILD.json'),buildBytes=regular(buildFile,32*1024*1024),build=json(buildBytes);
  customRequest(build);assert.equal(build.taskId,taskId,'CUSTOM_PAIR_REQUESTED_TASK');
  const inspectors=retained?[...sourceNames,'engine/retained-custom-2d-source.mjs','engine/custom-build-evidence.mjs','engine/custom-feature-audit.mjs','engine/official-capability-source-runtime.mjs','engine/official-raw-artifacts.mjs']:sourceNames;
  const sources=Object.fromEntries(inspectors.map(name=>[name,pin(regular(new URL('../'+name,import.meta.url),4*1024*1024))]));
  stage='RAW_BUILD_REAUDIT';
  const audit=retained?await auditRetainedCustom2dSource(work,regular):await auditCompletedOfficialRawBuild(work,taskId);
  stage='SOURCE_RECIPE';
  const evidence=retained?audit.evidence:matchCustomPairBuildEvidence({buildBytes,audit});
  // The root comes only from the independently authenticated execution plan,
  // including its explicit resume route; callers cannot supply artifact paths.
  const root=retained?audit.root:build.plan.artifactRoot||path.join(work,'artifacts');
  const rawNames=retained?audit.names:names;
  assert(path.isAbsolute(root),'CUSTOM_PAIR_ARTIFACT_ROOT');
  assert.equal(norm(fs.realpathSync(root)),norm(root),'CUSTOM_PAIR_ARTIFACT_ROOT_LINK');
  stage='ARTIFACTS';
  const bytes={},identities={};
  for(const [key,name]of Object.entries(rawNames)){
   bytes[key]=regular(path.join(root,name),limits[key]);identities[key]=pin(bytes[key]);
   assert.deepEqual(identities[key],audit.outputs[name],'CUSTOM_PAIR_ARTIFACT_CHANGED');
  }
  stage='DERIVE_SOURCE_AND_HOST';
  const proposed=proposeCustomRawHost({js:bytes.js,wasm:bytes.wasm});
  assert.deepEqual(proposed.receipt.input,identities.js);assert.deepEqual(proposed.receipt.wasm,identities.wasm);
  stage='FINAL_RECHECK';
  const recheck=()=>{
   assert.deepEqual(pin(regular(buildFile,32*1024*1024)),audit.build,'CUSTOM_PAIR_BUILD_CHANGED');
   if(retained)audit.recheck();
   for(const [key,name]of Object.entries(rawNames))assert.deepEqual(pin(regular(path.join(root,name),limits[key])),identities[key],'CUSTOM_PAIR_ARTIFACT_CHANGED');
   for(const name of inspectors)assert.deepEqual(pin(regular(new URL('../'+name,import.meta.url),4*1024*1024)),sources[name],'CUSTOM_PAIR_INSPECTOR_CHANGED');
  };
  recheck();
  const summary={schema:retained?'wxslim-retained-custom-pair-source-check-v1':'wxslim-completed-custom-pair-source-check-v1',status:'CUSTOM_PAIR_SOURCE_CHECKED_NOT_ADMITTED',
   taskId,build:audit.build,sourceCommit:evidence.sourceCommit,sourceRecipe:evidence.sourceRecipe,sourcePlanSha256:evidence.sourcePlanSha256,
   features:evidence.features,selectedProfile:evidence.selectedProfile,buildProvenance:retained?retainedProvenance:'COMPLETED_CUSTOM_RAW_TASK_RECHECKED',
   ...(retained?{retainedEvidence:audit.record}:{}),
   inputs:identities,outputJs:pin(proposed.js),outputBridge:pin(proposed.bridge),sources,derivation:proposed.receipt,
   effectiveCompilerMacros:build.customBuildEvidence?.effectiveCompilerMacros??'NOT_PROVEN',
   sourceTreeRechecked:true,rawArtifactBytesRechecked:true,artifactPaths:'FROM_AUTHENTICATED_BUILD_PLAN_ONLY',
   executionAuthorized:false,buildExecuted:false,workCreated:false,written:false,wasmCopied:false,
   hostSelected:false,converterAccepted:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN',phone:'NOT_RUN',
   remaining:['Review effective compiler commands and archive/link evidence for the chosen features.',
    'Persist the reviewed JS and host through the common preparation task; audit converted output before admission.',
    'Separately approve conversion and same-package GLX acceptance; a source proposal is not a runnable engine.']};
  // Only in-process preparation receives bytes and a checkpoint recheck. The
  // read-only CLI below still returns the public summary, never executable text.
  return {summary,js:proposed.js,bridge:proposed.bridge,recheck};
 }catch(error){
  const reason=typeof error?.code==='string'&&/^[A-Z][A-Z_]{1,79}$/.test(error.code)?error.code:'CHECK_REJECTED';
  throw Object.assign(Error('CUSTOM_PAIR_SOURCE_CHECK_REJECTED'),{code:'CUSTOM_PAIR_SOURCE_CHECK_REJECTED',stage,reason,
   executionAuthorized:false,buildExecuted:false,workCreated:false,written:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN'});
 }
}

export async function checkCompletedCustomPairSource(...args){
 return (await prepareCompletedCustomPairSource(...args)).summary;
}
