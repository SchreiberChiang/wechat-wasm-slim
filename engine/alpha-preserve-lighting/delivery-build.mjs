// Single checkout, fixed successful recipe. No execution without --execute.
// Build evidence is recorded separately from runtime/visual acceptance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync,constants} from 'node:zlib';
import assert from 'node:assert/strict';
import {repo,recipe,historical,read,sha,checkDependencies,rebuiltPair} from './delivery.mjs';
import {buildEnv,buildIdentity,sourceState,outputPair,SOURCE_TESTS} from '../../trim/lib/build.mjs';

export function buildPlan(config) {
  assert(config.work && path.isAbsolute(config.work),'explicit absolute NEW build directory');
  assert(config.sdk && config.python && config.library && config.editor,'dependency configuration required');
  const work=path.resolve(config.work),stage=path.join(work,'engine');
  const jobs=config.jobs??Math.max(1,Math.min(8,Math.floor(os.availableParallelism()*0.7)));
  assert(Number.isInteger(jobs)&&jobs>=1&&jobs<=16,'jobs 1..16; scheduling only');
  const profile=path.join(repo,recipe.engine.profile.path);
  const args=historical.build.sconsArgs.map(a=>a.startsWith('--jobs=')?`--jobs=${jobs}`:a==='build_profile=<FULL_PROFILE>'?`build_profile=${profile}`:a==='wx_glx_lib=<EXACT_026E_LIBRARY>'?`wx_glx_lib=${path.resolve(config.library)}`:a);
  assert(!args.some(a=>a.includes('<')),'unresolved recipe parameter');
  return {work,stage,jobs,profile,sconsArgs:args,patches:[...recipe.engine.patches,recipe.engine.windowsLinkPatch],
    writes:['one source checkout, objects, logs, artifacts inside work','SDK cache only if the supplied SDK requires it'],
    noUpload:true,noRetry:true,cleanBuildValidated:false,
    stages:['git init/fetch exact commit/checkout','apply four patches and Windows response-file patch','source tests','SCons compile/link/optimize','godot_process once','Brotli quality 11','pair/import/export audit']};
}

function freeDisk(dir){const s=fs.statfsSync(dir);return s.bavail*s.bsize;}
function snapshot(dir){
  const system=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',path.join(repo,'engine/alpha-preserve-lighting/delivery-resources.ps1')],{encoding:'utf8',windowsHide:true}));
  return {at:new Date().toISOString(),freeMemory:os.freemem(),totalMemory:os.totalmem(),freeDisk:freeDisk(dir),system};
}
let transientFilesGone=0;
function treeBytes(dir){let bytes=0;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);assert(!item.isSymbolicLink(),'budget traversal refuses symlink');try{bytes+=item.isDirectory()?treeBytes(file):fs.statSync(file).size;}catch(e){if(e.code!=='ENOENT')throw e;transientFilesGone++;}}return bytes;}
async function command(exe,args,{cwd,env,log,onLine}){
  await new Promise((resolve,reject)=>{
    const output=fs.createWriteStream(log,{flags:'a'});
    const p=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let carry='',spawnError=null;
    function consume(data){output.write(data);if(onLine){carry+=data.toString();const lines=carry.split(/\r?\n/);carry=lines.pop();for(const line of lines)onLine(line);}}
    p.stdout.on('data',consume);p.stderr.on('data',consume);
    p.once('error',e=>{spawnError=e;});
    p.once('close',code=>{if(onLine&&carry)onLine(carry);output.end(()=>spawnError?reject(spawnError):code===0?resolve():reject(Error(`${path.basename(exe)} exit ${code}; preserve ${log}`)));});
  });
}

export async function executeBuild(config,{resumeBeforeSource=false}={}){
  const plan=buildPlan(config);checkDependencies(config);
  assert(process.platform==='win32','This exact recipe has only a Windows reference');
  assert(resumeBeforeSource||!fs.existsSync(plan.work),'refuse existing directory: no overwrite or automatic resume');
  let prior=null;
  if(resumeBeforeSource){
    prior=JSON.parse(read(path.join(plan.work,'BUILD.json')));
    assert(prior.status==='STOPPED'&&prior.phases.length===1&&prior.phases[0].name==='fresh-thinlto-system-libraries'&&prior.phases[0].status==='PASS','resume only completed cache preparation, before source exists');
    assert(!fs.existsSync(plan.stage),'resume refuses an existing engine checkout');
    assert.deepEqual(prior.plan,plan,'resume inputs changed');
    assert.equal(prior.recipeSha256,sha(read(path.join(repo,'engine/alpha-preserve-lighting/delivery-recipe.json'))));
    for(const f of prior.freshCache)assert.equal(sha(read(path.join(config.sdk,'upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/thinlto',f.name+'.a'))),f.sha256,'fresh cache changed');
  }
  assert(fs.statSync(path.dirname(plan.work)).isDirectory(),'approved parent directory must exist');
  assert(os.availableParallelism()>=11,'fixed ThinLTO 8 needs CPU headroom; review scheduling before running');
  assert(plan.jobs<=Math.floor(os.availableParallelism()*0.75),'leave at least 25% logical CPUs');
  const initial=snapshot(path.dirname(plan.work));
  const minimum=Math.max(12*2**30,initial.totalMemory*.4);
  assert(initial.freeMemory>=minimum,'memory below conservative start gate; do not change recipe');
  assert(initial.system.commitHeadroomBytes>=8*2**30,'commit headroom below 8 GiB');
  assert(initial.system.cpuPercent<60,'existing CPU load too high for starting this fixed build');
  assert(initial.freeDisk>=20*2**30,'reserve 20 GiB before this first clean build');
  assert(config.budgetRoot&&path.resolve(plan.work).startsWith(path.resolve(config.budgetRoot)+path.sep),'work must be inside approved budget root');
  assert(treeBytes(config.budgetRoot)<18*2**30,'approved root nearing 20 GiB budget');
  // Config must describe separately approved dependency installation; never point
  // this writer at the preserved shared SDK merely because its hashes match.
  assert(config.sdkCacheWriteApproved===true,'SDK cache write scope must be approved separately');
  if(!prior){fs.mkdirSync(plan.work);for(const name of ['logs','temp','artifacts'])fs.mkdirSync(path.join(plan.work,name));}
  const record=prior??{schema:'simple-delivery-build-v1',startedAt:new Date().toISOString(),recipeSha256:sha(read(path.join(repo,'engine/alpha-preserve-lighting/delivery-recipe.json'))),
    plan,phases:[],samples:[initial],sourceTests:[],attempts:1,cleanEnvironmentReproduction:'NOT_VERIFIED',visual:'NOT_VERIFIED'};
  const recordPath=path.join(plan.work,'BUILD.json');
  if(prior){
    const bytes=read(recordPath);fs.writeFileSync(path.join(plan.work,'logs/cache-stage-interrupted.json'),bytes,{flag:'wx'});
    record.resume={at:new Date().toISOString(),previousRecordSha256:sha(bytes),reason:'transient ENOENT in budget scan; no engine compilation attempted'};
    delete record.failure;delete record.monitorFailure;delete record.status;delete record.endedAt;
  }
  const save=()=>fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');
  const tc={emsdk:config.sdk,python:config.python,engineSource:plan.stage,pin:recipe.engine.source.commit,glxLibrary:config.library,
    glxLibrarySha256:recipe.engine.library.sha256,patches:recipe.engine.patches.map(p=>path.join(repo,p.path)),cppdefines:''};
  // Binaryen has its own pool; EMCC_CORES does not limit wasm-opt.
  // Fixed Binaryen 8c82b6884: src/support/threads.cpp, getNumCores().
  const env={...buildEnv(tc),EMCC_CORES:String(plan.jobs),BINARYEN_CORES:String(plan.jobs),TEMP:path.join(plan.work,'temp'),TMP:path.join(plan.work,'temp'),EMCC_TEMP_DIR:path.join(plan.work,'temp')};
  record.scheduling={sconsJobs:plan.jobs,emccCores:plan.jobs,binaryenCores:plan.jobs,thinLtoJobs:8};
  let pressure=false;
  async function phase(name,task){
    assert(!pressure,'resource threshold was crossed; preserve state, do not start next phase');
    const before=snapshot(plan.work);assert(before.freeMemory>=Math.max(2*2**30,before.totalMemory*.2)&&before.system.commitHeadroomBytes>=2*2**30,'insufficient memory before next phase');
    before.budgetRootBytes=treeBytes(config.budgetRoot);assert(before.budgetRootBytes<18*2**30,'budget nearly exhausted; next phase refused');
    const row={name,before};record.phases.push(row);save();const start=Date.now();
    try{await task();row.status='PASS';}catch(e){row.status='FAIL';row.message=String(e);throw e;}
    finally{row.wallSeconds=(Date.now()-start)/1000;row.after=snapshot(plan.work);row.diskFreeDelta=row.after.freeDisk-before.freeDisk;save();}
  }
  // Sampling is evidence, not a safe mid-link suspension mechanism. Never kill
  // a compiler; pressure prevents the NEXT phase, and remains visible to caller.
  const monitor=setInterval(()=>{try{const s=snapshot(plan.work);record.samples.push(s);if(record.samples.length%4===0){s.budgetRootBytes=treeBytes(config.budgetRoot);s.transientFilesGone=transientFilesGone;}if(s.freeMemory<Math.max(2*2**30,s.totalMemory*.2)||s.system.commitHeadroomBytes<2*2**30||s.budgetRootBytes>18*2**30){pressure=true;console.error('Resource threshold crossed; next phase blocked. Current process is not killed.');}save();}catch(e){pressure=true;record.monitorFailure=String(e);save();}},15000);
  const run=(exe,args,name,cwd=plan.stage,onLine)=>command(exe,args,{cwd,env,log:path.join(plan.work,'logs',name+'.log'),onLine});
  try{
    if(!prior)await phase('fresh-thinlto-system-libraries',async()=>{
      const targets=['libal','libc','libc++','libc++abi','libcompiler_rt','libdlmalloc','libGL-webgl2','libhtml5','libsockets','libstubs'];
      const cacheEnv={...env,EM_FROZEN_CACHE:'0'};
      await command(config.python,[path.join(config.sdk,'upstream/emscripten/embuilder.py'),'--lto=thin','build',...targets],{cwd:plan.work,env:cacheEnv,log:path.join(plan.work,'logs/fresh-system-libraries.log')});
      const cacheDir=path.join(config.sdk,'upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/thinlto');
      record.freshCache=targets.map(name=>({name,sha256:sha(read(path.join(cacheDir,name+'.a')))}));
      record.cachePolicy='Built locally from fixed SDK sources; FROZEN_CACHE override only for embuilder, not engine build';
    });
    await phase('source',async()=>{
      await run('git',['init',plan.stage],'source',plan.work);
      await run('git',['config','core.autocrlf','false'],'source');
      await run('git',['remote','add','origin',recipe.engine.source.repository],'source');
      await run('git',['fetch','--depth=1','origin',recipe.engine.source.commit],'source');
      await run('git',['checkout','--detach',recipe.engine.source.commit],'source');
      for(const patch of plan.patches){await run('git',['apply','--check',path.join(repo,patch.path)],'patches');await run('git',['apply',path.join(repo,patch.path)],'patches');}
      record.stage=await sourceState(plan.stage);assert.equal(record.stage.head,recipe.engine.source.commit);
      record.identity=await buildIdentity({tc,profileFile:plan.profile,stage:plan.stage,lto:'thin',symbols:true,ltoJobs:8});
      record.profileSha256=recipe.engine.profile.sha256;record.sconsArgs=plan.sconsArgs;
    });
    await phase('source-tests',async()=>{for(const test of SOURCE_TESTS){const file=path.join(plan.stage,'platform/web/js/tests',test);assert(fs.existsSync(file),'required source test missing');await run(process.execPath,[file],'source-tests');record.sourceTests.push(test);}});
    const events=[];
    await phase('scons-compile-link-optimize',()=>run(config.python,['-m','SCons',...plan.sconsArgs],'build',plan.stage,line=>{
      // SCons/LLVM may not expose independent optimizer boundaries. Do not invent timings.
      if(/Compiling |Linking |wasm-opt|Optimizing /i.test(line))events.push({at:new Date().toISOString(),line});
    }));
    record.compilerEvents=events;record.separateLinkAndOptimizerTiming='Only where observable in build.log; combined phase otherwise';
    await phase('godot-process',()=>run(process.execPath,[path.join(plan.stage,'godot_process.js')],'postprocess'));
    await phase('brotli-and-artifacts',async()=>{
      const glue=read(path.join(plan.stage,'bin/.web_zip/godot.js')),wasm=read(path.join(plan.stage,'bin/.web_zip/godot.wasm'));
      const br=brotliCompressSync(wasm,{params:{[constants.BROTLI_PARAM_QUALITY]:11,[constants.BROTLI_PARAM_SIZE_HINT]:wasm.length}});
      for(const [name,b] of Object.entries({'godot.js':glue,'godot.wasm':wasm,'godot.wasm.br':br}))fs.writeFileSync(path.join(plan.work,'artifacts',name),b,{flag:'wx'});
      Object.assign(record,outputPair(glue,wasm,br));record.finishedAt=new Date().toISOString();save();
    });
    await phase('static-pair-audit',async()=>{const pair=rebuiltPair(plan.work);fs.writeFileSync(path.join(plan.work,'PAIR_AUDIT.json'),JSON.stringify(pair.audit,null,2)+'\n',{flag:'wx'});});
    record.status='BUILT_STATIC_AUDIT_PASS_RUNTIME_NOT_RUN';save();
  }catch(e){record.status='STOPPED';record.failure=String(e);save();throw e;}
  finally{clearInterval(monitor);record.endedAt=new Date().toISOString();save();}
  return {status:record.status,work:plan.work,phases:record.phases};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [file,action,...extra]=process.argv.slice(2);assert(file&&extra.length===0&&(!action||['--execute','--resume-before-source'].includes(action)),'PRIVATE_CONFIG [--execute|--resume-before-source]');const cfg=JSON.parse(read(file));console.log(JSON.stringify(action?await executeBuild(cfg,{resumeBeforeSource:action==='--resume-before-source'}):buildPlan(cfg),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
