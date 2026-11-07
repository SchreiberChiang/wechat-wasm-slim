// Tail of the historical fifteen-patch chain, all in memory. Not a build plan.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {auditOfficialPlatformFollowups} from './official-platform-followup-audit.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
import {prepareOfficialUpstreamStorageTail,readExplicitUpstreamSource} from './official-upstream-storage-tail.mjs';

const home=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(home,p));
const metadata=()=>JSON.parse(read('engine/official-upstream-storage-tail.json'));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path);
export function officialUpstreamStorageInputs(){const m=metadata();return {baseCommit:m.baseCommit,inputs:m.officialInputs,upstream:m.upstream.source,newPath:m.generatedLibrary.path};}

export function auditOfficialUpstreamStorageCombination(sources,{sourceBytes}={}) {
  const m=metadata();assert(sources instanceof Map,'UPSTREAM_COMBINATION_MAP');
  assert.deepEqual([...sources.keys()].sort(),m.officialInputs.map(p=>p.path).sort(),'UPSTREAM_EXACT_21_INPUTS');
  for(const p of m.officialInputs)same(sources.get(p.path),p);
  // Reuse the unchanged historical audit, including its own generated factory
  // and all previous source/metadata checks. That factory is NOT a final output.
  const previous=auditOfficialPlatformFollowups(sources);
  assert.equal(previous.patchCount,15);assert.equal(previous.finalOutputs.length,26);
  assert.deepEqual(previous.finalOutputs,m.predecessorOutputs,'UPSTREAM_PREDECESSOR_OUTPUT_DRIFT');
  const steps=[...previous.predecessorPatches,previous.shader.patch,previous.audio.patch];
  assert.equal(steps.length,15);
  const state=new Map();
  for(const step of steps){const p=step.path??step.file,bytes=read(p);same(bytes,{path:p,...step});replayUnifiedPatch(bytes,n=>sources.get(n)??null,state);}
  const retired=m.retired[0];assert(!state.has(retired.path),'UPSTREAM_GENERATED_FACTORY_MUST_NOT_BE_PATCHED');
  assert.deepEqual(previous.finalOutputs.find(p=>p.path===retired.path),retired,'UPSTREAM_RETIRE_EXACT_FACTORY');
  for(const output of previous.finalOutputs.filter(p=>p.path!==retired.path))same(state.get(output.path)?.text,output);
  const parents=new Map(m.parents.map(p=>[p.path,Buffer.from(state.get(p.path).text)]));
  const tail=prepareOfficialUpstreamStorageTail({parents,officialOs:sources.get(m.officialOs.path),sourceBytes});
  for(const [p,value]of tail.outputs)state.set(p,{...value,added:state.get(p)?.added??value.added});
  assert(!state.has(retired.path),'UPSTREAM_FACTORY_STILL_PRESENT');
  assert.equal(state.size,26);
  const expected=new Map([...previous.finalOutputs.filter(p=>p.path!==retired.path),...m.outputs].map(p=>[p.path,p]));
  assert.deepEqual([...state.keys()].sort(),[...expected.keys()].sort());
  for(const p of expected.values())same(state.get(p.path).text,p);
  const sc=state.get('platform/web/SCsub').text;
  assert(!sc.includes('library_wxslim_persistent.js'));
  assert.equal(sc.split('"js/libs/library_wxslim_upstream_fs.js"').length,2);
  assert(sc.includes('"js/libs/library_wxslim_os.js" if env["use_wx_glx"] else "js/libs/library_godot_os.js"'));
  assert(!state.has(m.officialOs.path),'UPSTREAM_BROWSER_OS_CHANGED');
  for(const [name,value]of state){if(/\.(?:js|cjs)$/.test(name))new vm.Script(value.text,{filename:name});}
  return {outputs:state,receipt:{schema:'wxslim-official-upstream-storage-combination-v1',status:'PASS_SOURCE_COMBINATION_ONLY_NOT_BUILD_READY',
    baseCommit:m.baseCommit,officialInputs:m.officialInputs,inputFiles:sources.size,
    historicalPatchCount:15,tailPatchCount:1,totalPatchCount:16,predecessorStatus:previous.status,
    predecessorOutputs:previous.finalOutputs,retired:m.retired,tail:tail.receipt,
    finalOutputs:[...state].map(([p,v])=>({path:p,...pin(v.text),added:v.added})),
    storageBackend:'upstream-wxmemfs',upstreamSourceSha256:m.upstream.derived.sha256,
    originalBrowserOsUnchanged:true,buildPlanRegistered:false,sourceTreeWritten:false,
    generatedJsPairAvailable:false,compiled:false,engineRun:false,phone:'NOT_RUN',runtimeAcceptance:'NOT_INHERITED',
    secureRandomCombined:false,remaining:m.remaining}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source-root'&&args[2]==='--upstream-source',
    'Usage: --source-root EXISTING_FIXED_OFFICIAL_SOURCE --upstream-source ABSOLUTE_FIXED_READABLE_SOURCE');
  const root=fs.realpathSync(args[1]),sources=new Map();
  for(const p of officialUpstreamStorageInputs().inputs){
    const file=fs.realpathSync(path.join(root,p.path)),rel=path.relative(root,file);
    assert(rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep),'UPSTREAM_SOURCE_OUTSIDE_ROOT');
    const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'UPSTREAM_SOURCE_REGULAR');
    sources.set(p.path,fs.readFileSync(file));
  }
  console.log(JSON.stringify(auditOfficialUpstreamStorageCombination(sources,{sourceBytes:readExplicitUpstreamSource(args[3])}).receipt,null,2));
}
