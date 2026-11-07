// In-memory source composition, not a build recipe or runtime admission.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {graphicsSourceSetPlan} from './official-graphics-source-set-audit.mjs';
import {auditOfficialPlatformSources} from './official-platform-source-audit.mjs';
import {officialStorageInputPlan,prepareOfficialStorageSources} from './official-storage-source-audit.mjs';
import {officialRenderFileInputs,auditOfficialRenderFile} from './official-render-file-audit.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const baseCommit='c050c09b105c3715e1caa57a7109cd752047fd89';
const read=p=>fs.readFileSync(path.join(root,p));
const metadata=p=>JSON.parse(read('engine/'+p+'.json'));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const simple=p=>({path:p.path,bytes:p.bytes,sha256:p.sha256});
const same=(b,p,label)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},label??p.path);
const subset=(sources,inputs)=>new Map(inputs.map(p=>[p.path,sources.get(p.path)]));

function plan(){
  const graphics=graphicsSourceSetPlan();
  const jsbridge=metadata('official-jsbridge-source');
  const storage=metadata('official-storage-source');
  const input=metadata('official-input-source');
  const audio=metadata('official-audio-source');
  const http=metadata('official-http-source');
  const selection=metadata('official-http-selection');
  for(const m of [jsbridge,storage,input,audio,http,selection])assert.equal(m.baseCommit,baseCommit);
  const sources=new Map(graphics.sources);
  function add(items){
    for(const p of items){
      if(sources.has(p.path))assert.deepEqual(simple(sources.get(p.path)),simple(p),'CONFLICTING_SOURCE_PIN');
      else sources.set(p.path,simple(p));
    }
  }
  add([...jsbridge.inputs,...officialStorageInputPlan()]);
  const platformInputs=[...sources.values()];assert.equal(platformInputs.length,12);
  add([...officialRenderFileInputs(),...input.inputs,...audio.inputs,http.officialSource,http.officialCppConsumer,http.officialHeader]);
  assert.equal(sources.size,20);
  const newPaths=[graphics.newPath,storage.outputs.find(p=>p.path!=='platform/web/SCsub').path,storage.generatedFactory.path,http.newFile.path];
  assert.equal(new Set(newPaths).size,4);
  return {sources,newPaths,platformInputs,storage,input,audio,http,selection};
}

export function officialPlatformCombinationInputs(){
  const p=plan();
  return {baseCommit,inputs:[...p.sources.values()],newPaths:p.newPaths};
}

export function auditOfficialPlatformCombination(sources){
  assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');
  const p=plan();
  assert.deepEqual([...sources.keys()].sort(),[...p.sources.keys()].sort(),'SOURCE_KEYS');
  for(const input of p.sources.values())same(sources.get(input.path),input);
  const previous=auditOfficialPlatformSources(subset(sources,p.platformInputs));
  const rendering=auditOfficialRenderFile(subset(sources,officialRenderFileInputs()));
  const storage=prepareOfficialStorageSources(subset(sources,officialStorageInputPlan()));
  const stage=(patch,outputs)=>({path:patch.path??patch.file,bytes:patch.bytes,sha256:patch.sha256,outputs});
  const stages=[...previous.patches,...rendering.stages,
    stage(p.input.patch,p.input.outputs),stage(p.audio.patch,p.audio.outputs),
    stage(p.http.patch,[p.http.newFile]),stage(p.selection.patch,[p.selection.output])];
  assert.equal(stages.length,13);
  const state=new Map(),receipts=[],expectedFinal=new Map();
  for(const step of stages){
    const patch=read(step.path);same(patch,step);
    if(step.path===(p.selection.patch.path??p.selection.patch.file))same(state.get('platform/web/SCsub').text,p.selection.input,'HTTP_SELECTION_PREDECESSOR');
    replayUnifiedPatch(patch,n=>sources.get(n)??null,state);
    for(const output of step.outputs){
      same(state.get(output.path).text,output);
      expectedFinal.set(output.path,simple(output));
    }
    assert.throws(()=>replayUnifiedPatch(patch,n=>state.get(n)?.text??sources.get(n)??null),undefined,'DUPLICATE_PATCH_ACCEPTED');
    receipts.push({path:step.path,...pin(patch),outputs:step.outputs.map(simple)});
  }
  assert(!state.has(p.storage.generatedFactory.path),'GENERATED_PATH_COLLISION');
  same(storage.library.source,p.storage.generatedFactory);
  state.set(p.storage.generatedFactory.path,{added:true,text:storage.library.source});
  expectedFinal.set(p.storage.generatedFactory.path,simple(p.storage.generatedFactory));
  assert.deepEqual([...state.keys()].sort(),[...expectedFinal.keys()].sort(),'UNDECLARED_OUTPUT');
  assert.equal(state.size,20);
  assert.deepEqual([...state].filter(([,v])=>v.added).map(([name])=>name).sort(),p.newPaths.slice().sort(),'NEW_PATH_SCOPE');
  for(const output of expectedFinal.values())same(state.get(output.path).text,output);
  const unchanged=['platform/web/js/libs/library_godot_os.js','platform/web/js/patches/patch_em_gl.js',p.http.officialSource.path,p.http.officialCppConsumer.path];
  for(const name of unchanged)assert(!state.has(name),'UNEXPECTED_ORIGINAL_CHANGE: '+name);
  const parsed=[];
  for(const [name,value]of state){
    if(name.endsWith('.js')&&name!==p.storage.generatedFactory.path){new vm.Script(value.text,{filename:name});parsed.push(name);}
  }
  return {schema:'wxslim-official-platform-combination-audit-v1',status:'PASS_SOURCE_COMBINATION_ONLY',baseCommit,
    inputFiles:sources.size,inputBytes:[...sources.values()].reduce((sum,b)=>sum+b.length,0),
    inputs:[...p.sources.values()],patches:receipts,
    finalOutputs:[...state].map(([name,v])=>({path:name,...pin(v.text),added:v.added})),
    sourceJsSyntaxParsed:parsed,generatedFactorySyntax:'EMSCRIPTEN_MACRO_EXPANSION_NOT_RUN',unchangedOfficialPaths:unchanged,
    fileAccess:rendering,componentModelChecks:{input:p.input.validation,audio:p.audio.validation,http:p.http.modelValidation,selection:p.selection.validation},
    evidenceBoundary:'Models in component metadata are prior isolated checks, not rerun runtime or new platform acceptance.',
    sourceTreeWritten:false,generatedFactoryWritten:false,compilerRun:false,engineRun:false,wholePlatformReady:false,storageInitializationFixed:false,
    remaining:['audio native exit/callback release/failed-registration closure','shader-failure instrumentation and complete generated-JS postprocessing/return0 recipe',
      'WebSocket host integration and secure randomness','storage TARGET_STAT diagnosis and actual IO acceptance',
      'emitted dependency/ABI audit, license review, clean full/conservative builds and scoped GLX device acceptance']};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),p=plan(),sources=new Map();
  if(args.length===1&&args[0]==='--fetch-fixed-twenty'){
    for(const input of p.sources.values()){
      const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+baseCommit+'/'+input.path,{redirect:'error',signal:AbortSignal.timeout(15000)});
      assert(r.ok,'SOURCE_HTTP');const chunks=[];let size=0;
      for await(const b of r.body){size+=b.length;assert(size<=input.bytes,'SOURCE_SIZE_LIMIT');chunks.push(b);}
      sources.set(input.path,Buffer.concat(chunks));
    }
    for(const name of p.newPaths){const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+baseCommit+'/'+name,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,404,'NEW_PATH_EXISTS');}
  }else if(args.length===2&&args[0]==='--source-root'){
    const dir=fs.realpathSync(args[1]);
    for(const name of p.newPaths)assert(!fs.existsSync(path.join(dir,name)),'NEW_PATH_EXISTS');
    for(const input of p.sources.values()){const name=fs.realpathSync(path.join(dir,input.path));assert(name.startsWith(dir+path.sep),'SOURCE_OUTSIDE_ROOT');sources.set(input.path,fs.readFileSync(name));}
  }else throw Error('Usage: --fetch-fixed-twenty OR --source-root <fixed-official-source>');
  console.log(JSON.stringify(auditOfficialPlatformCombination(sources),null,2));
}
