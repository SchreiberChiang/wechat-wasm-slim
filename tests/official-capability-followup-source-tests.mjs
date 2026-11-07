// One small read-only Git batch plus in-memory source composition. No source
// materialization, compiler, engine evaluation, HTTP request or old behavior models.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {planOfficialBuild} from '../engine/official-build-plan.mjs';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
import {capabilityFollowupMetadata,prepareOfficialCapabilityFollowupSources,applyCapabilityFollowupSources,followupIdentity} from '../engine/official-capability-followup-source.mjs';
const m=capabilityFollowupMetadata(),plan=planOfficialBuild({profile:'full'});
const source=process.env.WXSLIM_CAPABILITY_FOLLOWUP_SOURCE,requestFile=process.env.WXSLIM_CAPABILITY_FOLLOWUP_REQUEST;
assert(source&&path.isAbsolute(source),'FOLLOWUP_EXPLICIT_SOURCE_REQUIRED');
assert(requestFile&&path.isAbsolute(requestFile),'FOLLOWUP_EXPLICIT_EXISTING_REQUEST_REQUIRED');
const request=JSON.parse(fs.readFileSync(requestFile));
assert(typeof request.gitExecutable==='string'&&path.isAbsolute(request.gitExecutable),'FOLLOWUP_EXPLICIT_GIT_PATH');
const sourceStat=fs.lstatSync(source);assert(sourceStat.isDirectory()&&!sourceStat.isSymbolicLink());assert.equal(fs.realpathSync(source).toLowerCase(),path.resolve(source).toLowerCase());
const upstreamFile=request.upstreamSource;assert(typeof upstreamFile==='string'&&path.isAbsolute(upstreamFile),'FOLLOWUP_EXPLICIT_UPSTREAM_PATH');
for(const p of [requestFile,request.gitExecutable,upstreamFile]){const st=fs.lstatSync(p);assert(st.isFile()&&!st.isSymbolicLink());assert.equal(fs.realpathSync(p).toLowerCase(),path.resolve(p).toLowerCase());}
const upstreamBefore=fs.statSync(upstreamFile),upstreamSource=fs.readFileSync(upstreamFile);
const upstreamPin={bytes:m.upstreamSource.fixedSource.bytes,sha256:m.upstreamSource.fixedSource.sha256};
assert.deepEqual(followupIdentity(upstreamSource),upstreamPin);
const entries=[...new Map([...plan.officialInputs,...m.extraOfficialInputs].map(p=>[p.path,p])).values()];assert.equal(entries.length,26);
const specs=[m.baseCommit,...entries.map(p=>m.baseCommit+':'+p.path)];
const stdout=execFileSync(request.gitExecutable,['--no-optional-locks','--no-replace-objects','-C',source,'cat-file','--batch'],{input:specs.join('\n')+'\n',windowsHide:true,maxBuffer:8*1024*1024});
const blobs=new Map();let cursor=0;
for(let index=0;index<specs.length;index++){
  const end=stdout.indexOf(10,cursor);assert(end>=cursor);const match=/^([0-9a-f]{40}) (commit|blob) (\d+)$/.exec(stdout.subarray(cursor,end).toString('ascii'));assert(match,'FOLLOWUP_GIT_BATCH_HEADER');
  const [,oid,type,count]=match,start=end+1,size=Number(count),bytes=Buffer.from(stdout.subarray(start,start+size));
  assert.equal(bytes.length,size);assert.equal(stdout[start+size],10,'FOLLOWUP_GIT_BATCH_TERMINATOR');cursor=start+size+1;
  assert.equal(createHash('sha1').update(Buffer.from(type+' '+bytes.length+'\0')).update(bytes).digest('hex'),oid,'FOLLOWUP_GIT_OBJECT_HASH');
  if(index===0){assert.equal(type,'commit');assert.equal(oid,m.baseCommit);}
  else {const pin=entries[index-1];assert.equal(type,'blob');assert.deepEqual(followupIdentity(bytes),{bytes:pin.bytes,sha256:pin.sha256});if(pin.gitBlob)assert.equal(oid,pin.gitBlob);blobs.set(pin.path,bytes);}
}
assert.equal(cursor,stdout.length,'FOLLOWUP_GIT_BATCH_COMPLETE');
const officialBlobs=new Map(plan.officialInputs.map(p=>[p.path,blobs.get(p.path)]));
const extraOfficialBlobs=new Map(m.extraOfficialInputs.map(p=>[p.path,blobs.get(p.path)]));
const options={profile:'full',officialBlobs,upstreamSource,extraOfficialBlobs};
// The successful combination is computed once for each required profile.
const full=prepareOfficialCapabilityFollowupSources(options);
const conservative=prepareOfficialCapabilityFollowupSources({...options,profile:'conservative'});
function reversePatch(bytes){return Buffer.from(bytes.toString().split('\n').map(l=>{const h=/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(l);if(h)return `@@ -${h[3]},${h[4]} +${h[1]},${h[2]} @@`;if(l.startsWith('--- ')||l.startsWith('+++ '))return l;return l[0]==='+'?'-'+l.slice(1):l[0]==='-'?'+'+l.slice(1):l;}).join('\n'));}
const reconstructedBase=new Map(full.outputs);
for(const pin of m.followupPatches.slice().reverse()){
  const reverse=reversePatch(fs.readFileSync(new URL('../'+pin.path,import.meta.url)));
  for(const [p,v]of replayUnifiedPatch(reverse,name=>reconstructedBase.get(name)))reconstructedBase.set(p,Buffer.from(v.text));
}
for(const p of m.extraOfficialInputs)reconstructedBase.delete(p.path);
test('authenticated c050 commit, 25 base blobs and two overlay parents with one overlap; 26 distinct official blobs',()=>{
  assert.equal(officialBlobs.size,25);assert.equal(extraOfficialBlobs.size,2);assert.equal(blobs.size,26);
  assert(officialBlobs.get(m.overlappingOfficialInputPaths[0]).equals(extraOfficialBlobs.get(m.overlappingOfficialInputPaths[0])));
  assert.equal(m.extraOfficialInputs[0].gitBlob,'b3c5f2fc87e2e601d0016835f428f547ce870ec0');
  assert.equal(m.extraOfficialInputs[1].gitBlob,'a76896ebf134010089c6578f5d3d8657d7e4dc96');
});
test('full/conservative produce identical 33 source outputs and exactly seven changed paths',()=>{
  assert.equal(full.outputs.size,33);assert.equal(conservative.outputs.size,33);
  assert.deepEqual([...full.outputs.keys()],[...conservative.outputs.keys()]);
  for(const [p,b]of full.outputs)assert(b.equals(conservative.outputs.get(p)),p);
  for(const result of [full,conservative]){
    assert.deepEqual(result.receipt.changedPaths,m.changedPaths.slice().sort());assert.equal(result.receipt.unchangedPaths.length,26);
    assert.equal(result.receipt.baseOutputs,31);assert.equal(result.receipt.extraOfficialInputs,2);assert.equal(result.receipt.basePatchCount,20);assert.equal(result.receipt.followupPatchCount,4);
  }
  // All 26 preserved paths are authenticated original-combination outputs.
  // Only seven paths receive the four followup patches.
  const pins=new Map(m.baseOutputs.map(p=>[p.path,p]));
  for(const p of full.receipt.unchangedPaths){const pin=pins.get(p);assert(pin,p);assert.deepEqual(followupIdentity(full.outputs.get(p)),{bytes:pin.bytes,sha256:pin.sha256});}
  assert.equal(reconstructedBase.size,31);
  for(const pin of m.baseOutputs)assert.deepEqual(followupIdentity(reconstructedBase.get(pin.path)),{bytes:pin.bytes,sha256:pin.sha256});
});
test('arguments, 026e library, source selection and ABI stay fixed; private header forces recompilation',()=>{
  const cp=planOfficialBuild({profile:'conservative'});
  assert.deepEqual(cp.argumentTemplate,m.baseArgumentTemplate);assert.deepEqual(cp.library,m.baseLibrary);
  for(const r of [full.receipt,conservative.receipt]){assert(r.argumentTemplateUnchanged&&r.libraryUnchanged&&r.scsubUnchanged&&r.abiSignaturesAndProxiesUnchanged);assert(r.privateLayoutChange.requiresRecompileOfAffectedCppConsumers);}
  assert(full.outputs.get('platform/web/http_client_web.h').toString().includes('bool response_headers_available = false;'));
  assert.equal(m.baseLibrary.sha256,'026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8');
});
test('source composition keeps pending audio pause separate from lifecycle notifications and every executor',()=>{
  for(const r of [full.receipt,conservative.receipt]){assert.equal(r.sourceWritten,false);assert.equal(r.compiled,false);assert.equal(r.executorRegistered,false);assert.equal(r.usableJsWasm,false);assert.equal(r.executionAuthorized,false);assert.equal(r.audioPauseCandidateIncluded,true);assert.equal(r.audioPauseHideShowWiring,'NOT_ADDED');assert.equal(r.buildReady,false);}
  assert.equal(m.originalTwentyPatchRecipeChanged,false);assert.equal(m.originalCheckerChanged,false);assert.equal(m.historicalSuccessReceiptsChanged,false);assert.equal(m.recipeRegistered,false);
  const audio=full.outputs.get(m.audioPause.path);assert.deepEqual(followupIdentity(audio),m.audioPause.output);
  assert.deepEqual(m.audioPause.changedMethods,['_GodotAudio.$GodotAudio.WX.startSample','_GodotAudio.$GodotAudio.WX.setPause']);
  assert(m.audioPause.backendSelectionUnchanged&&m.audioPause.poolPolicyUnchanged&&m.audioPause.errorContractsUnchanged);
});

test('lifecycle R2 adds one explicit JS dependency while ABI and OS final-sync source stay unchanged',()=>{
  for(const r of [full.receipt,conservative.receipt]){assert.equal(r.lifecycleNotificationsCandidateIncluded,true);assert.equal(r.lifecycleRevision,2);assert.equal(r.lifecycleJsDependencyAdded,'$GodotOS');assert.equal(r.jsDependenciesUnchanged,false);assert.equal(r.osSourceUnchanged,true);assert.equal(r.lifecycleCleanupFailureDoesNotRejectExit,true);assert.equal(r.nativeNotificationReceipt,'NOT_PROVEN_VOID_CALLBACK');assert.equal(r.automaticAudioRecoveryAdded,false);}
  assert.equal(m.lifecycle.explicitNewDependency,'$GodotOS');assert.equal(m.lifecycle.revision,2);assert.equal(m.lifecycle.scope,'NOTIFICATIONS_ONLY_NO_GAME_PAUSE_OR_AUDIO_RECOVERY');
  for(const [p,pin]of Object.entries(m.lifecycle.outputs))assert.deepEqual(followupIdentity(full.outputs.get(p)),pin);
  const os='platform/web/js/libs/library_wxslim_os.js',pin=m.baseOutputs.find(p=>p.path===os);assert(pin);assert.deepEqual(followupIdentity(full.outputs.get(os)),{bytes:pin.bytes,sha256:pin.sha256});
  assert(m.preservedSourcePaths.includes(os));assert.equal(m.lifecycle.shutdownResolution,'CONTINUATION_ONLY_NOT_CLEANUP_SUCCESS');
});
test('input drift fails without regenerating any candidate or substituting working-tree files',()=>{
  const key=officialBlobs.keys().next().value,drift=new Map(officialBlobs);drift.set(key,Buffer.concat([drift.get(key),Buffer.from('// drift\n')]));
  assert.throws(()=>prepareOfficialCapabilityFollowupSources({...options,officialBlobs:drift}));
  assert.throws(()=>prepareOfficialCapabilityFollowupSources({...options,upstreamSource:Buffer.concat([upstreamSource,Buffer.from('\n')])}));
  const changed=new Map(extraOfficialBlobs),p=changed.keys().next().value;changed.set(p,Buffer.from('working tree replacement\n'));
  // Overlay rejects drift before applying any followup to the exact base.
  assert.throws(()=>applyCapabilityFollowupSources(reconstructedBase,changed),/FOLLOWUP_PIN platform\/web\/http_client_web.cpp/);
  assert.throws(()=>prepareOfficialCapabilityFollowupSources({...options,extraOfficialBlobs:new Map()}));
});
test('wrong profiles, extra options and duplicate patched outputs fail closed',()=>{
  for(const profile of [undefined,'FULL','development',''])assert.throws(()=>prepareOfficialCapabilityFollowupSources({...options,profile}));
  assert.throws(()=>prepareOfficialCapabilityFollowupSources({...options,write:true}));
  assert.throws(()=>applyCapabilityFollowupSources(full.outputs,extraOfficialBlobs));
  const patched31=new Map(m.baseOutputs.map(p=>[p.path,full.outputs.get(p.path)]));
  assert.throws(()=>applyCapabilityFollowupSources(patched31,extraOfficialBlobs));
  for(const pin of m.followupPatches){const patch=fs.readFileSync(new URL('../'+pin.path,import.meta.url));assert.throws(()=>replayUnifiedPatch(patch,p=>full.outputs.get(p)));}
});
test('read-only inputs and existing source dependency snapshots remain unchanged',()=>{
  assert.deepEqual(followupIdentity(fs.readFileSync(upstreamFile)),upstreamPin);assert.equal(fs.statSync(upstreamFile).mtimeMs,upstreamBefore.mtimeMs);
  const after=capabilityFollowupMetadata();assert.deepEqual(after,m);
  for(const [p,b]of officialBlobs)assert.deepEqual(followupIdentity(b),followupIdentity(blobs.get(p)));
});
