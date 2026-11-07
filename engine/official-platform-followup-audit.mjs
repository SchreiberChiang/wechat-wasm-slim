// Appends the reviewed shader diagnostics and audio lifecycle sources in memory.
// No build, source-tree writes or runtime acceptance.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import vm from 'node:vm';import {fileURLToPath} from 'node:url';
import {officialPlatformCombinationInputs,auditOfficialPlatformCombination} from './official-platform-combination-audit.mjs';
import {prepareOfficialShaderDiagnostics,officialShaderDiagnosticsInputPlan} from './official-shader-diagnostics-audit.mjs';
import {officialStorageInputPlan,prepareOfficialStorageSources} from './official-storage-source-audit.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p));
const meta=p=>JSON.parse(read('engine/'+p+'.json'));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path??p.file);
function plan(){
 const base=officialPlatformCombinationInputs(),shader=meta('official-shader-diagnostics'),audio=meta('official-audio-lifecycle');
 assert.equal(shader.baseCommit,base.baseCommit);assert.equal(shader.inputs[0].path,'drivers/gles3/shader_gles3.cpp');
 const inputs=[...base.inputs,shader.inputs[0]],newPaths=[...base.newPaths,...shader.outputs.filter(p=>p.added).map(p=>p.path)];
 assert.equal(new Set(inputs.map(p=>p.path)).size,21);assert.equal(new Set(newPaths).size,9);
 return {base,shader,audio,inputs,newPaths};
}
export function auditOfficialPlatformFollowups(sources){
 assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');const p=plan();
 assert.deepEqual([...sources.keys()].sort(),p.inputs.map(i=>i.path).sort());for(const input of p.inputs)same(sources.get(input.path),input);
 const base=auditOfficialPlatformCombination(new Map(p.base.inputs.map(i=>[i.path,sources.get(i.path)])));
 const state=new Map();for(const step of base.patches){const bytes=read(step.path);same(bytes,step);replayUnifiedPatch(bytes,n=>sources.get(n)??null,state);}
 const storage=prepareOfficialStorageSources(new Map(officialStorageInputPlan().map(i=>[i.path,sources.get(i.path)])));
 const factory=meta('official-storage-source').generatedFactory;same(storage.library.source,factory);state.set(factory.path,{text:storage.library.source,added:true});
 for(const output of base.finalOutputs)same(state.get(output.path).text,output);
 const shader=prepareOfficialShaderDiagnostics(new Map(officialShaderDiagnosticsInputPlan().map(i=>[i.path,state.get(i.path)?.text??sources.get(i.path)])));
 for(const output of p.shader.outputs)state.set(output.path,shader.outputs.get(output.path));
 same(read(p.audio.dependsOn.file),p.audio.dependsOn);for(const i of p.audio.inputs)same(state.get(i.path).text,i);
 const patch=read(p.audio.patch.file);same(patch,p.audio.patch);replayUnifiedPatch(patch,n=>sources.get(n)??null,state);
 for(const i of p.audio.outputs)same(state.get(i.path).text,i);
 assert.throws(()=>replayUnifiedPatch(patch,n=>state.get(n)?.text??sources.get(n)??null));
 new vm.Script(state.get(p.audio.outputs[0].path).text);
 const expected=new Map([...base.finalOutputs,...p.shader.outputs,...p.audio.outputs].map(i=>[i.path,i]));
 assert.equal(state.size,26);assert.deepEqual([...state.keys()].sort(),[...expected.keys()].sort());for(const i of expected.values())same(state.get(i.path).text,i);
 assert.deepEqual([...state].filter(([,v])=>v.added).map(([n])=>n).sort(),p.newPaths.slice().sort());
 return {schema:'wxslim-official-platform-followup-audit-v1',status:'PASS_SOURCE_COMBINATION_ONLY_NOT_BUILD_READY',baseCommit:p.base.baseCommit,
  inputFiles:sources.size,inputBytes:[...sources.values()].reduce((n,b)=>n+b.length,0),patchCount:base.patches.length+2,
  predecessorPatches:base.patches,shader:shader.receipt,audio:{patch:p.audio.patch,inputs:p.audio.inputs,outputs:p.audio.outputs,validation:p.audio.validation},
  finalOutputs:[...state].map(([name,v])=>({path:name,...pin(v.text),added:v.added})),
  sourceTreeWritten:false,compilerRun:false,engineRun:false,wholePlatformReady:false,generatedJsPairAvailable:false,
  remaining:['generated official JS/invoke/host/return0 full recipe','secure entropy provider','storage TARGET_STAT and real IO','audio registration/cache/manifest/async error observability','license review and clean full/conservative GLX device acceptance']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),p=plan(),sources=new Map();
 if(args.length===1&&args[0]==='--fetch-fixed-twenty-one'){
  for(const i of p.inputs){const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+p.base.baseCommit+'/'+i.path,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok,'SOURCE_HTTP');const chunks=[];let bytes=0;for await(const b of r.body){bytes+=b.length;assert(bytes<=i.bytes,'SOURCE_SIZE_LIMIT');chunks.push(b);}sources.set(i.path,Buffer.concat(chunks));}
  for(const name of p.newPaths){const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+p.base.baseCommit+'/'+name,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,404,'NEW_PATH_EXISTS');}
 }else if(args.length===2&&args[0]==='--source-root'){
  const dir=fs.realpathSync(args[1]);for(const name of p.newPaths)assert(!fs.existsSync(path.join(dir,name)),'NEW_PATH_EXISTS');
  for(const i of p.inputs){const file=fs.realpathSync(path.join(dir,i.path));assert(file.startsWith(dir+path.sep),'SOURCE_OUTSIDE_ROOT');sources.set(i.path,fs.readFileSync(file));}
 }else throw Error('Usage: --fetch-fixed-twenty-one OR --source-root <fixed-official-source>');
 console.log(JSON.stringify(auditOfficialPlatformFollowups(sources),null,2));
}
