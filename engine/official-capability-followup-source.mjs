// Independent source-only composition. Never materializes, compiles, registers
// an executor/recipe, evaluates engine libraries, or creates a JS/WASM pair.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {prepareOfficialBuildSources} from './official-build-source.mjs';
import {planOfficialBuild} from './official-build-plan.mjs';
import {prepareOfficialImeSessionSource,IME_SESSION_FILE} from './official-ime-session-source.mjs';
import {prepareHttpResponseSources} from './official-http-response-source.mjs';
import {prepareOfficialAudioPendingPause,AUDIO_PENDING_PAUSE_FILE} from './official-audio-pending-pause.mjs';
import {prepareOfficialLifecycleNotifications,LIFECYCLE_JS,LIFECYCLE_CPP} from './official-lifecycle-notifications.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
export const followupIdentity = bytes => ({bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')});
const same=(bytes,p)=>assert.deepEqual(followupIdentity(bytes),{bytes:p.bytes,sha256:p.sha256},'FOLLOWUP_PIN '+p.path);
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
export function capabilityFollowupMetadata() {
  const m=JSON.parse(read('engine/official-capability-followup-source.json'));
  assert.equal(m.schema,'official-capability-followup-source-v1');
  assert.equal(m.status,'SOURCE_ONLY_UNREGISTERED_NO_JS_WASM');
  assert.equal(m.baseCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
  for(const p of m.dependencies)same(read(p.path),p);
  assert.deepEqual(m.profiles,['full','conservative']);
  assert.equal(m.followupPatches.length,4);assert.equal(m.changedPaths.length,7);
  return m;
}
let parser;
function jsAbi(text) {
  if(!parser){const module={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module,exports:module.exports});parser=module.exports;}
  const ast=parser.parse(text,{ecmaVersion:2022}),rows=[];
  function walk(n){if(!n||typeof n!=='object')return;if(n.type==='Property'){const name=n.key.name??n.key.value;if(/__(sig|proxy)$/.test(name))rows.push([name,text.slice(n.value.start,n.value.end)]);}for(const [k,v]of Object.entries(n))if(!['start','end'].includes(k)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}
  walk(ast);return rows;
}
function displayDeps(text) {
  jsAbi(text); // Initializes the same source-only parser.
  const tree=parser.parse(text,{ecmaVersion:2022});
  const library=tree.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]).filter(n=>n.id?.name==='GodotDisplay');
  assert.equal(library.length,1,'FOLLOWUP_DISPLAY_LIBRARY');
  const deps=library[0].init.properties.filter(n=>(n.key.name??n.key.value)==='$GodotDisplay__deps');
  assert.equal(deps.length,1,'FOLLOWUP_DISPLAY_DEPENDENCIES');
  assert.equal(deps[0].value.type,'ArrayExpression');
  return Array.from(deps[0].value.elements,n=>{assert.equal(n.type,'Literal');return n.value;});
}
// Public pure overlay entry lets callers explicitly reject repeated overlays.
// The two additional inputs MUST be c050 Git blob bytes, never working files.
export function applyCapabilityFollowupSources(baseOutputs,extraOfficialBlobs) {
  const m=capabilityFollowupMetadata();assert(baseOutputs instanceof Map&&extraOfficialBlobs instanceof Map);
  assert.deepEqual([...baseOutputs.keys()].sort(),m.baseOutputs.map(p=>p.path).sort(),'FOLLOWUP_EXACT_31_BASE_OUTPUTS');
  for(const p of m.baseOutputs){assert(Buffer.isBuffer(baseOutputs.get(p.path)));same(baseOutputs.get(p.path),p);}
  assert.deepEqual([...extraOfficialBlobs.keys()].sort(),m.extraOfficialInputs.map(p=>p.path).sort(),'FOLLOWUP_EXACT_EXTRA_BLOBS');
  const before=new Map([...baseOutputs].map(([p,b])=>[p,Buffer.from(b)]));
  for(const p of m.extraOfficialInputs){const b=extraOfficialBlobs.get(p.path);assert(Buffer.isBuffer(b));same(b,p);assert.equal(gitBlob(b),p.gitBlob,'FOLLOWUP_EXTRA_GIT_BLOB');assert(!before.has(p.path));before.set(p.path,Buffer.from(b));}
  assert.equal(before.size,33);const outputs=new Map(before);
  const [imePatch,httpPatch,audioPatch,lifecyclePatch]=m.followupPatches.map(p=>{const bytes=read(p.path);same(bytes,p);return bytes;});
  outputs.set(IME_SESSION_FILE,prepareOfficialImeSessionSource(outputs.get(IME_SESSION_FILE),imePatch));
  const httpParents=new Map(m.httpPaths.map(p=>[p,outputs.get(p).toString('utf8')]));
  const replay=replayUnifiedPatch(httpPatch,p=>{assert(m.httpPaths.includes(p),'FOLLOWUP_HTTP_PATCH_SCOPE');return httpParents.get(p);});
  assert.deepEqual([...replay.keys()],m.httpPaths,'FOLLOWUP_HTTP_EXACT_THREE_PATHS');
  const expected=prepareHttpResponseSources(httpParents);
  for(const [p,v]of replay){assert.equal(v.text,expected.get(p));outputs.set(p,Buffer.from(v.text));}
  const audioParent=outputs.get(AUDIO_PENDING_PAUSE_FILE);
  const audioPrepared=prepareOfficialAudioPendingPause(audioParent);
  const audioReplay=replayUnifiedPatch(audioPatch,p=>{assert.equal(p,AUDIO_PENDING_PAUSE_FILE,'FOLLOWUP_AUDIO_PATCH_SCOPE');return audioParent;});
  assert.deepEqual([...audioReplay.keys()],[AUDIO_PENDING_PAUSE_FILE]);
  const audioOutput=Buffer.from(audioReplay.get(AUDIO_PENDING_PAUSE_FILE).text);
  assert(audioOutput.equals(audioPrepared.source),'FOLLOWUP_AUDIO_EXACT_PREPARER_OUTPUT');
  assert.deepEqual(audioPrepared.receipt.changedMethods,m.audioPause.changedMethods);
  assert.equal(audioPrepared.receipt.hideShowWiring,'NOT_ADDED');
  outputs.set(AUDIO_PENDING_PAUSE_FILE,audioOutput);
  const lifecycleParents=new Map([LIFECYCLE_JS,LIFECYCLE_CPP].map(p=>[p,outputs.get(p)]));
  const lifecyclePrepared=prepareOfficialLifecycleNotifications(lifecycleParents);
  const lifecycleReplay=replayUnifiedPatch(lifecyclePatch,p=>{assert(lifecycleParents.has(p),'FOLLOWUP_LIFECYCLE_PATCH_SCOPE');return lifecycleParents.get(p);});
  assert.deepEqual([...lifecycleReplay.keys()],[LIFECYCLE_JS,LIFECYCLE_CPP],'FOLLOWUP_LIFECYCLE_EXACT_TWO_PATHS');
  for(const [p,v]of lifecycleReplay){const b=Buffer.from(v.text);assert(b.equals(lifecyclePrepared.sources.get(p)),'FOLLOWUP_LIFECYCLE_EXACT_PREPARER_OUTPUT');outputs.set(p,b);}
  assert.equal(lifecyclePrepared.receipt.explicitNewDependency,'$GodotOS');
  assert.equal(lifecyclePrepared.receipt.atexitFailurePolicy,m.lifecycle.atexitFailurePolicy);
  assert.deepEqual(displayDeps(outputs.get(LIFECYCLE_JS).toString()),[...displayDeps(before.get(LIFECYCLE_JS).toString()),'$GodotOS'],'FOLLOWUP_ONLY_DISPLAY_OS_DEPENDENCY_ADDED');
  const changed=[...outputs.keys()].filter(p=>!outputs.get(p).equals(before.get(p))).sort();
  assert.deepEqual(changed,m.changedPaths.slice().sort(),'FOLLOWUP_ONLY_SEVEN_CHANGED_PATHS');
  for(const p of m.outputs)same(outputs.get(p.path),p);
  assert.equal(outputs.size,33);assert.equal(m.outputs.length,33);
  for(const p of [IME_SESSION_FILE,m.httpPaths[0],AUDIO_PENDING_PAUSE_FILE,LIFECYCLE_JS])assert.deepEqual(jsAbi(outputs.get(p).toString()),jsAbi(before.get(p).toString()),'FOLLOWUP_JS_ABI_UNCHANGED');
  for(const p of m.preservedSourcePaths)assert(outputs.get(p).equals(before.get(p)),'FOLLOWUP_SELECTION_OR_ABI_CHANGED '+p);
  return {outputs,receipt:{schema:'official-capability-followup-overlay-v1',status:'SOURCE_ONLY_UNREGISTERED_NO_JS_WASM',baseOutputs:31,extraOfficialInputs:2,distinctOfficialInputFiles:26,additionalDistinctOfficialInputs:1,overlappingOfficialInputPaths:m.overlappingOfficialInputPaths,outputFiles:33,changedPaths:changed,unchangedPaths:[...outputs.keys()].filter(p=>!changed.includes(p)).sort(),privateLayoutChange:m.privateLayoutChange,sourceWritten:false,compiled:false,executorRegistered:false,usableJsWasm:false,audioPauseCandidateIncluded:true,audioPauseHideShowWiring:'NOT_ADDED',lifecycleNotificationsCandidateIncluded:true,lifecycleRevision:2,lifecycleJsDependencyAdded:'$GodotOS',osSourceUnchanged:true,lifecycleCleanupFailureDoesNotRejectExit:true,nativeNotificationReceipt:'NOT_PROVEN_VOID_CALLBACK',automaticAudioRecoveryAdded:false}};
}
export function prepareOfficialCapabilityFollowupSources(options) {
  assert.equal(arguments.length,1);assert(options&&typeof options==='object'&&!Array.isArray(options));
  const keys=['profile','officialBlobs','upstreamSource','extraOfficialBlobs'];assert.deepEqual(Reflect.ownKeys(options).sort(),keys.slice().sort(),'FOLLOWUP_EXACT_OPTIONS');
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(options,k);assert(d&&Object.hasOwn(d,'value'),'FOLLOWUP_DATA_OPTIONS');}
  assert(['full','conservative'].includes(options.profile),'FOLLOWUP_EXPLICIT_PROFILE');
  const m=capabilityFollowupMetadata(),plan=planOfficialBuild({profile:options.profile});
  assert.equal(plan.patches.length,20);assert.deepEqual(plan.finalOutputs,m.baseOutputs);
  assert.deepEqual(plan.argumentTemplate,m.baseArgumentTemplate);assert.deepEqual(plan.library,m.baseLibrary);
  for(const p of m.overlappingOfficialInputPaths)assert(options.officialBlobs.get(p).equals(options.extraOfficialBlobs.get(p)),'FOLLOWUP_OVERLAPPING_GIT_BLOB');
  const base=prepareOfficialBuildSources({profile:options.profile,officialBlobs:options.officialBlobs,upstreamSource:options.upstreamSource});
  const followup=applyCapabilityFollowupSources(base.outputs,options.extraOfficialBlobs);
  return {...followup,receipt:{...followup.receipt,profile:options.profile,baseCommit:m.baseCommit,basePlanSha256:plan.planSha256,basePatchCount:20,followupPatchCount:4,officialInputs:25,upstreamSource:followupIdentity(options.upstreamSource),argumentTemplateUnchanged:true,libraryUnchanged:true,scsubUnchanged:true,abiSignaturesAndProxiesUnchanged:true,jsDependenciesUnchanged:false,executionAuthorized:false,buildReady:false}};
}
