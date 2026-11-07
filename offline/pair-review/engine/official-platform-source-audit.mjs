// Partial platform assembly in memory only. Does not authorize a build or runtime capability.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {graphicsSourceSetPlan,auditGraphicsSourceSet} from './official-graphics-source-set-audit.mjs';
import {officialStorageInputPlan,prepareOfficialStorageSources} from './official-storage-source-audit.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(repo,p));
const meta=p=>JSON.parse(read(p));
const base='c050c09b105c3715e1caa57a7109cd752047fd89';
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p,label)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},label);
const simple=p=>({path:p.path,bytes:p.bytes,sha256:p.sha256});
function inputPlan(){
  const g=graphicsSourceSetPlan(),j=meta('engine/official-jsbridge-source.json'),s=meta('engine/official-storage-source.json');
  assert.equal(j.baseCommit,base);assert.equal(s.baseCommit,base);
  const inputs=new Map(g.sources);
  for(const p of [...j.inputs,...officialStorageInputPlan()]){
    if(inputs.has(p.path))assert.deepEqual(simple(inputs.get(p.path)),simple(p),'INCONSISTENT_SOURCE_PIN');
    else inputs.set(p.path,simple(p));
  }
  assert.equal(inputs.size,12);
  return {inputs,newPaths:[g.newPath,s.outputs.find(p=>p.path!=='platform/web/SCsub').path,s.generatedFactory.path]};
}
export function auditOfficialPlatformSources(sources){
  assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');
  const plan=inputPlan();assert.deepEqual([...sources.keys()].sort(),[...plan.inputs.keys()].sort());
  for(const p of plan.inputs.values())same(sources.get(p.path),p,p.path);
  const g=graphicsSourceSetPlan();
  const graphics=auditGraphicsSourceSet(new Map([...sources].filter(([p])=>g.sources.has(p))));
  const storage=prepareOfficialStorageSources(new Map(officialStorageInputPlan().map(p=>[p.path,sources.get(p.path)])));
  const jsbridge=meta('engine/official-jsbridge-source.json');
  const s=meta('engine/official-storage-source.json');
  const stages=[...graphics.stages,{path:jsbridge.patch.file,...pin(read(jsbridge.patch.file)),outputs:jsbridge.outputs},{...s.patch,outputs:s.outputs}];
  same(read(jsbridge.patch.file),jsbridge.patch,'JSBRIDGE_PATCH');
  const state=new Map(),stageReceipts=[];
  for(const stage of stages){
    const patch=read(stage.path);same(patch,stage,stage.path);
    replayUnifiedPatch(patch,p=>sources.get(p)??null,state);
    for(const p of stage.outputs)same(state.get(p.path).text,p,p.path);
    stageReceipts.push({path:stage.path,...pin(patch),outputs:stage.outputs.map(simple)});
  }
  assert(!state.has(s.generatedFactory.path),'GENERATED_PATH_COLLISION');
  state.set(s.generatedFactory.path,{added:true,text:storage.library.source});
  assert.equal(state.size,13);
  assert(!state.has('platform/web/js/libs/library_godot_os.js'));
  assert(!state.has('platform/web/js/patches/patch_em_gl.js'));
  for(const [name,v]of state){
    if(name.endsWith('.js')&&name!==s.generatedFactory.path)new vm.Script(v.text);
  }
  return {schema:'wxslim-official-partial-platform-source-audit-v1',status:'PASS_PARTIAL_SOURCE_COMBINATION_ONLY',baseCommit:base,
    inputFiles:sources.size,inputBytes:[...sources.values()].reduce((n,b)=>n+b.length,0),patches:stageReceipts,
    finalOutputs:[...state].map(([name,v])=>({path:name,...pin(v.text),added:v.added})),
    graphics,storage:storage.receipt,jsbridge:{patch:jsbridge.patch,validation:jsbridge.validation,finalLinkedEvalOmission:'NOT_VERIFIED'},
    sourceTreeWritten:false,generatedFactoryWritten:false,compilerRun:false,engineRun:false,wholePlatformReady:false,
    remaining:['audio source and lifecycle integration','input backend and HTTP/WebSocket source integration','secure random source and platform runtime glue','FileAccessUnix error/macro rebase and compiled audit','storage failure diagnosis and actual IO','alpha/shadow and return0 complete recipe replay','license audit, clean full/conservative build and scoped device acceptance']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),plan=inputPlan(),sources=new Map();
  if(args.length===1&&args[0]==='--fetch-fixed-twelve'){
    for(const p of plan.inputs.values()){
      const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+base+'/'+p.path,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok,'SOURCE_HTTP');
      const chunks=[];let size=0;for await(const b of r.body){size+=b.length;assert(size<=p.bytes,'SOURCE_SIZE_LIMIT');chunks.push(b)}sources.set(p.path,Buffer.concat(chunks));
    }
    for(const p of plan.newPaths){const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+base+'/'+p,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,404,'NEW_PATH_EXISTS')}
  }else if(args.length===2&&args[0]==='--source-root'){
    const root=fs.realpathSync(args[1]);for(const p of plan.newPaths)assert(!fs.existsSync(path.join(root,p)),'NEW_PATH_EXISTS');
    for(const p of plan.inputs.values()){const file=fs.realpathSync(path.join(root,p.path));assert(file.startsWith(root+path.sep),'SOURCE_OUTSIDE_ROOT');sources.set(p.path,fs.readFileSync(file))}
  }else throw Error('Usage: --fetch-fixed-twelve OR --source-root <fixed-official-source>');
  console.log(JSON.stringify(auditOfficialPlatformSources(sources),null,2));
}
