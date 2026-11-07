// Source-only tail: reuse the historical storage combination, then two existing
// same-parent WebSocket patches. No source-tree writes, compiler or target run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {officialUpstreamStorageInputs,auditOfficialUpstreamStorageCombination} from './official-upstream-storage-combination-audit.mjs';
import {readExplicitUpstreamSource} from './official-upstream-storage-tail.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const home=fileURLToPath(new URL('../',import.meta.url));
const metadata=()=>JSON.parse(fs.readFileSync(new URL('./official-websocket-combination.json',import.meta.url)));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path);
function checked(p){const b=fs.readFileSync(path.join(home,p.path));same(b,p);return b;}
function plan(){
 const m=metadata();assert.equal(m.baseCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
 checked(m.predecessor.module);checked(m.predecessor.metadata);
 const base=officialUpstreamStorageInputs();assert.equal(base.baseCommit,m.baseCommit);assert.equal(base.inputs.length,21);
 assert.deepEqual(m.inputs.map(p=>p.path),['modules/websocket/library_godot_websocket.js','modules/websocket/emws_peer.cpp']);
 assert.equal(m.patches.length,2);assert.deepEqual(m.patches.map(p=>p.target),m.inputs.map(p=>p.path));
 assert.deepEqual(m.outputs.map(p=>p.path),m.inputs.map(p=>p.path));
 const inputs=[...base.inputs,...m.inputs];assert.equal(inputs.length,23);assert.equal(new Set(inputs.map(p=>p.path)).size,23);
 return {m,base,inputs};
}
export function officialWebSocketCombinationInputs(){
 const p=plan();return {baseCommit:p.m.baseCommit,inputs:p.inputs,upstream:p.base.upstream,newPath:p.base.newPath,
  predecessor:p.m.predecessor,websocketPatches:p.m.patches};
}
export function auditOfficialWebSocketCombination(sources,options){
 assert.equal(arguments.length,2,'WEBSOCKET_EXACT_ARGUMENTS');
 assert(options&&typeof options==='object'&&!Array.isArray(options),'WEBSOCKET_SOURCE_OPTIONS');
 assert.deepEqual(Reflect.ownKeys(options),['sourceBytes'],'WEBSOCKET_ONLY_UPSTREAM_SOURCE_OPTION');
 const {sourceBytes}=options;assert(Buffer.isBuffer(sourceBytes),'WEBSOCKET_UPSTREAM_BUFFER');
 const p=plan(),m=p.m;assert(sources instanceof Map,'WEBSOCKET_SOURCE_MAP');
 assert.deepEqual([...sources.keys()].sort(),p.inputs.map(v=>v.path).sort(),'WEBSOCKET_EXACT_23_INPUTS');
 for(const input of p.inputs){assert(Buffer.isBuffer(sources.get(input.path)),'WEBSOCKET_SOURCE_BUFFER');same(sources.get(input.path),input);}
 const previous=auditOfficialUpstreamStorageCombination(new Map(p.base.inputs.map(v=>[v.path,sources.get(v.path)])),{sourceBytes});
 assert.equal(previous.receipt.totalPatchCount,m.predecessor.patchCount);assert.equal(previous.outputs.size,m.predecessor.outputFiles);
 const outputs=new Map([...previous.outputs].map(([name,value])=>[name,{...value}]));
 for(const patch of m.patches){
  assert(!outputs.has(patch.target),'WEBSOCKET_TARGET_ALREADY_MODIFIED');const bytes=checked(patch);
  assert(!bytes.includes(13),'WEBSOCKET_PATCH_LF_ONLY');
  const changed=replayUnifiedPatch(bytes,name=>sources.get(name)??null);
  assert.deepEqual([...changed.keys()],[patch.target],'WEBSOCKET_PATCH_EXACT_FILE');
  const expected=m.outputs.find(v=>v.path===patch.target),result=changed.get(patch.target);
  same(result.text,expected);assert.equal(result.added,false);
  assert.throws(()=>replayUnifiedPatch(bytes,name=>changed.get(name)?.text??sources.get(name)??null),'WEBSOCKET_DUPLICATE_MUST_REJECT');
  outputs.set(patch.target,result);
 }
 const js=m.inputs[0].path,cpp=m.inputs[1].path;
 const abi=source=>Array.from(source.matchAll(/(godot_js_websocket_\w+__sig):\s*(['"])([^'"]+)\2/g),v=>({name:v[1],signature:v[3]}));
 const beforeAbi=abi(sources.get(js).toString()),afterAbi=abi(outputs.get(js).text);
 assert.deepEqual(beforeAbi,m.abi,'WEBSOCKET_OFFICIAL_ABI');assert.deepEqual(afterAbi,beforeAbi,'WEBSOCKET_FIVE_ABI_UNCHANGED');assert.equal(afterAbi.length,5);
 new vm.Script(outputs.get(js).text,{filename:js}); // Syntax only; not a library or runtime execution.
 const beforeCpp=sources.get(cpp).toString().split('\n'),afterCpp=outputs.get(cpp).text.split('\n');
 assert.equal(beforeCpp.length,afterCpp.length);const lines=[];
 for(let i=0;i<beforeCpp.length;i++)if(beforeCpp[i]!==afterCpp[i])lines.push(i+1);
 assert.deepEqual(lines,m.cppChangedLines,'WEBSOCKET_ONLY_TWO_CPP_DIAGNOSTICS');
 const expected=new Map([...previous.receipt.finalOutputs,...m.outputs].map(v=>[v.path,v]));
 assert.equal(expected.size,28);assert.equal(outputs.size,28);assert.deepEqual([...outputs.keys()].sort(),[...expected.keys()].sort());
 for(const output of expected.values())same(outputs.get(output.path).text,output);
 // No sockets were opened: this result is the scope of source replay only.
 return {outputs,receipt:{schema:'wxslim-official-websocket-combination-v1',status:'PASS_SOURCE_COMBINATION_ONLY_NOT_BUILD_READY',
  baseCommit:m.baseCommit,officialInputs:p.inputs,inputFiles:23,predecessor:m.predecessor,predecessorStatus:previous.receipt.status,
  historicalPatchCount:15,upstreamStorageTailPatchCount:1,websocketTailPatchCount:2,totalPatchCount:18,
  websocketInputs:m.inputs,websocketPatches:m.patches,websocketOutputs:m.outputs,abi:afterAbi,cppChangedLines:lines,
  ordinaryWeb:m.ordinaryWeb,fullBackendBodyUnchanged:previous.receipt.tail.fullBackendBodyUnchanged,
  retired:previous.receipt.retired,storageBackend:previous.receipt.storageBackend,
  finalOutputs:[...outputs].map(([name,value])=>({path:name,...pin(value.text),added:value.added})),
  newExports:[],newCompilerParameters:[],scsubChangedByThisTail:false,sourceTreeWritten:false,buildPlanRegistered:false,
  compilerRun:false,compiled:false,generatedJsPairAvailable:false,secureRandomCombined:false,
  glueEvaluated:false,wasmInstantiated:false,engineRun:false,networkRun:false,phone:'NOT_RUN',runtimeAcceptance:'NOT_INHERITED',
  remaining:[...previous.receipt.remaining,...m.remaining]}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source-root'&&args[2]==='--upstream-source',
  'Usage: --source-root EXISTING_FIXED_OFFICIAL_SOURCE --upstream-source ABSOLUTE_FIXED_READABLE_SOURCE');
 assert(path.isAbsolute(args[1]),'WEBSOCKET_EXPLICIT_OFFICIAL_SOURCE_ROOT');
 const root=fs.realpathSync(args[1]),sources=new Map();
 for(const input of officialWebSocketCombinationInputs().inputs){
  const file=path.join(root,input.path),stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===input.bytes,'WEBSOCKET_REGULAR_FIXED_SOURCE');
  const actual=fs.realpathSync(file),rel=path.relative(root,actual);assert(rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep),'WEBSOCKET_SOURCE_OUTSIDE_ROOT');
  sources.set(input.path,fs.readFileSync(file));
 }
 console.log(JSON.stringify(auditOfficialWebSocketCombination(sources,{sourceBytes:readExplicitUpstreamSource(args[3])}).receipt,null,2));
}
