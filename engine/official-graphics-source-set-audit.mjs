// Read-only source set replay. No checkout creation, git apply, build or target execution.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import vm from 'node:vm';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const baseCommit='c050c09b105c3715e1caa57a7109cd752047fd89';

export function graphicsSourceSetPlan() {
  const seed=read('official-graphics-conditional-seed.json'),detect=read('official-glx-detect.json'),context=read('official-glx-context-source.json');
  assert.equal(seed.baseCommit,baseCommit);assert.equal(context.baseCommit,baseCommit);
  const sources=new Map(seed.inputs.map(p=>[p.path,{path:p.path,bytes:p.bytes,sha256:p.sha256}]));
  assert.equal(detect.base.commit,baseCommit);
  const detectBefore={path:detect.file,...detect.base};
  assert(detectBefore && detectBefore.path==='platform/web/detect.py','DETECT_BASE_SCHEMA');
  sources.set(detectBefore.path,{path:detectBefore.path,bytes:detectBefore.bytes,sha256:detectBefore.sha256});
  for(const p of context.inputs)sources.set(p.path,{path:p.path,bytes:p.bytes,sha256:p.sha256});
  assert.equal(sources.size,9);
  const stages=[
    {path:'official-glx-detect.patch',pin:detect.patch,outputs:[{path:detect.file,...detect.derived}]},
    {path:'official-graphics-conditional-seed.patch',pin:seed.patch,outputs:seed.outputs},
    {path:'official-glx-context-source.patch',pin:context.patch,outputs:context.outputs},
  ];
  return {baseCommit,sources,stages,newPath:context.newFile.path};
}
export function auditGraphicsSourceSet(sources) {
  assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');
  const plan=graphicsSourceSetPlan();
  assert.deepEqual([...sources.keys()].sort(),[...plan.sources.keys()].sort());
  for(const [p,expected]of plan.sources)assert.deepEqual(pin(sources.get(p)),{bytes:expected.bytes,sha256:expected.sha256},p);
  const state=new Map(),stages=[];
  for(const step of plan.stages) {
    const patch=fs.readFileSync(path.join(here,step.path));
    assert.deepEqual(pin(patch),{bytes:step.pin.bytes,sha256:step.pin.sha256});
    replayUnifiedPatch(patch,p=>sources.has(p)?sources.get(p):null,state);
    for(const o of step.outputs)assert.deepEqual(pin(state.get(o.path).text),{bytes:o.bytes,sha256:o.sha256},o.path);
    assert.throws(()=>replayUnifiedPatch(patch,p=>state.get(p)?.text??sources.get(p)));
    stages.push({path:'engine/'+step.path,...pin(patch),outputs:step.outputs});
  }
  assert.equal(state.size,9);assert(state.get(plan.newPath).added);
  assert(!state.has('platform/web/js/patches/patch_em_gl.js'));
  const sc=state.get('platform/web/SCsub').text;
  assert(sc.includes('if env["use_wx_glx"]:\n    sys_env.AddJSPost(["js/patches/wxslim_glx_context.js"])'));
  for(const name of ['platform/web/js/libs/library_godot_display.js',plan.newPath])new vm.Script(state.get(name).text);
  return {schema:'wxslim-official-graphics-source-set-audit-v1',status:'PASS_COMBINED_SOURCE_REPLAY_ONLY',baseCommit,
    inputFiles:sources.size,inputBytes:[...sources.values()].reduce((n,b)=>n+Buffer.byteLength(b),0),changedOrAddedFiles:state.size,
    stages,originalShaderSourcePatchUnchanged:true,sourceTreeWritten:false,compilerRun:false,engineRun:false,
    wholePlatformReady:false,postprocessorOfficialRawVerified:false,
    remaining:['audio/FS/JSBridge/input/network/platform source units','official generated glue and native ABI pairing',
      'rebase alpha/shadow and preserve return0 in full recipe','clean build and browser/GLX device acceptance','license review']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),plan=graphicsSourceSetPlan(),sources=new Map();
  if(args.length===1&&args[0]==='--fetch-fixed-nine') {
    for(const [p,expected]of plan.sources){
      const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+baseCommit+'/'+p,{redirect:'error',signal:AbortSignal.timeout(15000)});
      assert(r.ok,'SOURCE_HTTP');const chunks=[];let length=0;
      for await(const b of r.body){length+=b.length;assert(length<=expected.bytes,'SOURCE_SIZE_LIMIT');chunks.push(b);}
      sources.set(p,Buffer.concat(chunks));
    }
    const absence=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+baseCommit+'/'+plan.newPath,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
    assert.equal(absence.status,404,'NEW_PATH_NOT_ABSENT');
  } else if(args.length===2&&args[0]==='--source-root') {
    const root=fs.realpathSync(args[1]);assert(!fs.existsSync(path.join(root,plan.newPath)),'NEW_PATH_EXISTS');
    for(const p of plan.sources.keys()) {
      const name=fs.realpathSync(path.join(root,p));assert(name.startsWith(root+path.sep),'SOURCE_OUTSIDE_ROOT');
      sources.set(p,fs.readFileSync(name));
    }
  } else throw Error('Usage: --source-root <fixed-official-source> OR --fetch-fixed-nine');
  console.log(JSON.stringify(auditGraphicsSourceSet(sources),null,2));
}
