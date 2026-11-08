// Independent development recipe. Import/plan never starts a build. Explicit
// execute --write is additionally subject to the user's approved placement.
// Old full/conservative recipes and admission rules are deliberately untouched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync, constants} from 'node:zlib';
import {recipe, historical, repo, sha, verifyRecipe, returnZero} from './alpha-preserve-lighting/delivery.mjs';
import {planPersistentBuild} from './persistent-build-plan.mjs';
import {renderPersistentLibrary} from './persistent-factory-source.mjs';
import {auditPersistentSource, assertPersistentSourceUnchanged} from './persistent-source-audit.mjs';
import {inspectPersistentPairBuffers} from './persistent-pair-audit.mjs';
import {normalizeSemanticArguments} from './fixed-engine-plan.mjs';
import {auditFixedModules} from './fixed-module-audit.mjs';
import {cancellationReader, cancellationSignals, checkResourceHeadroom, rejectBuildEnvironmentOverrides, assertRawCaptureOutputs} from './fixed-build.mjs';
import {runBuildPhases} from './fixed-build-lifecycle.mjs';
import {buildEnv, buildIdentity, SOURCE_TESTS} from '../trim/lib/build.mjs';
import {createTask, inspectTask} from '../convert/lib/official-task.mjs';
import {runOwnedProcess} from '../convert/lib/owned-process.mjs';

const GiB=2**30, schema='wxslim-persistent-execution-v1';
export const PERSISTENT_PHASES=Object.freeze(['SNAPSHOT','SOURCE','SOURCE_AUDIT','SOURCE_TESTS','PRECOMPILE','COMPILE','CAPTURE_RAW','POSTPROCESS','ARTIFACTS','FINAL_AUDIT']);
const pathFields=['baselineSource','work','sdk','python','library','editor','sconsWheel','sdkArchive','gitExecutable'];
const implementationFiles=['engine/persistent-build.mjs','engine/persistent-source-audit.mjs','engine/persistent-pair-audit.mjs','engine/persistent-build-plan.mjs','engine/persistent-factory-source.mjs','engine/fixed-build.mjs','engine/fixed-build-lifecycle.mjs','engine/fixed-engine-plan.mjs','engine/fixed-engine-policy.json','engine/fixed-source-audit.mjs','engine/fixed-module-audit.mjs','engine/fixed-dependency-audit.py','engine/fixed-toolchain-cache.json','engine/audit-pair.mjs','engine/alpha-preserve-lighting/delivery.mjs','engine/alpha-preserve-lighting/delivery-build.mjs','engine/alpha-preserve-lighting/delivery-recipe.json','engine/alpha-preserve-lighting/delivery-resources.ps1','trim/lib/build.mjs','convert/lib/owned-process.mjs','convert/lib/official-task.mjs'];
const identity=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const overlap=(a,b)=>norm(a)===norm(b)||norm(a).startsWith(norm(b)+path.sep)||norm(b).startsWith(norm(a)+path.sep);
const failure=(code,message)=>Object.assign(Error(message),{code});
function regular(file){const st=fs.lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink(),'PERSISTENT_REGULAR_FILE_REQUIRED');const bytes=fs.readFileSync(file),after=fs.lstatSync(file);for(const k of ['size','mtimeMs','ctimeMs','ino','dev'])assert.equal(after[k],st[k],'PERSISTENT_INPUT_CHANGED_DURING_READ');assert.equal(bytes.length,st.size);return bytes;}
function writeNew(file,bytes){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const writeJSON=(file,value)=>writeNew(file,JSON.stringify(value,null,2)+'\n');
function child(root,relative){assert(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.includes('\\')&&relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'PERSISTENT_RELATIVE_PATH_REQUIRED');const out=path.resolve(root,relative);assert(norm(out).startsWith(norm(root)+path.sep));let at=root;assert.equal(norm(fs.realpathSync(root)),norm(root));for(const part of relative.split('/')){at=path.join(at,part);if(fs.existsSync(at))assert(!fs.lstatSync(at).isSymbolicLink(),'PERSISTENT_LINKED_TASK_PATH');}return out;}
function measuredTree(root){let bytes=0,transientGone=0;for(const name of fs.readdirSync(root)){const file=path.join(root,name);let st;try{st=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT'){transientGone++;continue;}throw e;}assert(!st.isSymbolicLink(),'PERSISTENT_LINKED_TASK_CONTENT');if(st.isDirectory()){const r=measuredTree(file);bytes+=r.bytes;transientGone+=r.transientGone;}else{assert(st.isFile());bytes+=st.size;}}return {bytes,transientGone};}
const implementations=()=>implementationFiles.map(p=>({path:p,...identity(regular(path.join(repo,p)))}));

// Legacy read-only helpers resolve git/git.exe through PATH. Prove that both
// spellings select the explicit executable in each environment, before use.
function assertGitResolution(r,env=process.env){
  assert.equal(process.platform,'win32','PERSISTENT_FIXED_WINDOWS_RECIPE_ONLY');
  const where=path.join(process.env.SystemRoot||'C:/Windows','System32/where.exe');
  for(const name of ['git','git.exe']){
    const first=execFileSync(where,[name],{env,cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:10000}).trim().split(/\r?\n/)[0];
    assert.equal(norm(fs.realpathSync(first)),norm(fs.realpathSync(r.gitExecutable)),'PERSISTENT_GIT_RESOLUTION_DIFFERS');
  }
  return identity(regular(r.gitExecutable));
}
function protectActualTree(r,tree){assert(!overlap(r.work,tree)&&!overlap(r.work,fs.realpathSync(tree)),'PERSISTENT_WORK_OVERLAPS_PROTECTED_INPUT');}
function checkPinnedDependencies(r,env){
  verifyRecipe();assert.equal(sha(regular(process.execPath)),recipe.toolchain.driverNode.sha256);
  for(const pin of recipe.toolchain.sdkFiles)assert.equal(sha(regular(path.join(r.sdk,pin.path))),pin.sha256,'PERSISTENT_FIXED_SDK_FILE');
  assert.equal(sha(regular(r.library)),recipe.engine.library.sha256);assert.equal(sha(regular(r.editor)),recipe.editor.sha256);
  // buildEnv clears PYTHONHOME/PYTHONPATH and keeps bytecode disabled. Never run
  // the old helper's inherited-environment Python -c before this check.
  assert(!Object.keys(env).some(k=>/^(PYTHONHOME|PYTHONPATH|PYTHONINSPECT|PYTHONOPTIMIZE)$/i.test(k)&&env[k]),'PERSISTENT_PYTHON_ENV_OVERRIDE');
  const result=JSON.parse(execFileSync(r.python,['-B','-c','import json, platform, sys, SCons; print(json.dumps({"python":platform.python_version(),"scons":SCons.__version__,"base":sys._base_executable}))'],{env,encoding:'utf8',windowsHide:true,timeout:20000}));
  assert.equal(result.python,'3.14.0');assert.equal(result.scons,'4.11.1');assert(path.isAbsolute(result.base));assert.equal(sha(regular(result.base)),recipe.toolchain.pythonBaseSha256);protectActualTree(r,path.dirname(result.base));
  return {status:'PASS_PINNED_DEPENDENCIES_ONLY',python:result.python,scons:result.scons,base:identity(regular(result.base))};
}

export function normalizePersistentExecutionRequest(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'PERSISTENT_REQUEST_OBJECT_REQUIRED');
  const keys=['schema',...pathFields,'jobs','budgetBytes'];
  assert.deepEqual(Reflect.ownKeys(value).sort(),[...keys].sort(),'PERSISTENT_EXACT_REQUEST_FIELDS');
  const r={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);assert(d&&Object.hasOwn(d,'value'),'PERSISTENT_DATA_FIELD_REQUIRED');r[k]=d.value;}
  assert.equal(r.schema,schema);for(const k of pathFields){assert(typeof r[k]==='string'&&r[k].trim()===r[k]&&path.isAbsolute(r[k])&&!/[<>\r\n\0]/.test(r[k]),'PERSISTENT_ABSOLUTE_PATH_REQUIRED: '+k);r[k]=path.resolve(r[k]);}
  assert(Number.isInteger(r.jobs)&&r.jobs>=1&&r.jobs<=16,'PERSISTENT_EXPLICIT_JOBS_1_TO_16');
  assert(Number.isSafeInteger(r.budgetBytes)&&r.budgetBytes>=8*GiB&&r.budgetBytes<=20*GiB,'PERSISTENT_BUDGET_8_TO_20_GIB');
  return r;
}

export function persistentExecutionPlan(raw){
  const request=normalizePersistentExecutionRequest(raw);assertGitResolution(request);
  const sourcePlan=planPersistentBuild({source:request.baselineSource});
  const work=request.work,source=path.join(work,'engine'),profile=path.join(work,'inputs/profile.gdbuild'),library=path.join(work,'inputs/libemscriptenglx.a');
  const sconsArgs=sourcePlan.sconsArgumentTemplate.map(a=>a.startsWith('--jobs=')?'--jobs='+request.jobs:a.startsWith('build_profile=')?'build_profile='+profile:a.startsWith('wx_glx_lib=')?'wx_glx_lib='+library:a);
  assert.deepEqual(normalizeSemanticArguments(sconsArgs),normalizeSemanticArguments(historical.build.sconsArgs),'PERSISTENT_SEMANTIC_PARAMETERS_CHANGED');
  const value={schema:'wxslim-persistent-execution-plan-v1',request,sourcePlan,work,source,profile,library,sconsArgs,phases:[...PERSISTENT_PHASES],
    writes:'One separately approved fresh checkout, input snapshots, logs and outputs within work; no baseline or SDK writes.',
    reuse:'Existing fixed tools and frozen SDK cache only; no object-copy or incremental-hit claim.',
    renderRecipe:'Unchanged shader fixes/026e/full profile/return0; new file error and persistence source patches only.',
    runtime:'NOT_RUN',executionAuthorized:false};
  return {...value,planSha256:sha(Buffer.from(JSON.stringify(value)))};
}

export function validatePersistentPlacement(raw){
  const r=normalizePersistentExecutionRequest(raw);assert(!fs.existsSync(r.work),'PERSISTENT_NEW_WORK_REQUIRED');
  assert.equal(norm(fs.realpathSync(path.dirname(r.work))),norm(path.dirname(r.work)),'PERSISTENT_REAL_PARENT_REQUIRED');
  const python=fs.realpathSync(r.python),candidate=path.resolve(path.dirname(python),'..');
  const pyRoot=fs.existsSync(path.join(candidate,'pyvenv.cfg'))?candidate:path.dirname(python);
  const protectedTrees=[repo,r.baselineSource,r.sdk,pyRoot,path.dirname(r.editor),path.dirname(r.gitExecutable)];
  const venvConfig=path.join(candidate,'pyvenv.cfg');
  if(fs.existsSync(venvConfig)){
    const text=regular(venvConfig).toString();
    for(const key of ['home','executable']){const matches=[...text.matchAll(new RegExp('^'+key+'\\s*=\\s*(.+)$','gm'))];assert.equal(matches.length,1,'PERSISTENT_VENV_BASE_CONFIGURATION');const value=matches[0][1].trim();assert(path.isAbsolute(value));protectedTrees.push(key==='home'?value:path.dirname(value));}
  }
  for(const p of [...protectedTrees,...['library','editor','sconsWheel','sdkArchive','gitExecutable'].map(k=>r[k])]){
    const real=fs.realpathSync(p);assert(!overlap(r.work,p)&&!overlap(r.work,real),'PERSISTENT_WORK_OVERLAPS_PROTECTED_INPUT');
  }
  return {status:'PASS_PLACEMENT_ONLY',protectedTrees};
}

export function assertPersistentRecordedInputs({plan,identity:got,sconsArgs,profileBytes}){
  assert(plan?.schema==='wxslim-persistent-execution-plan-v1');const p=plan.sourcePlan;
  assert(Buffer.isBuffer(profileBytes));assert.equal(sha(profileBytes),recipe.engine.profile.sha256);
  assert.deepEqual(sconsArgs,plan.sconsArgs,'PERSISTENT_ACTUAL_ARGUMENTS_CHANGED');
  assert.deepEqual(normalizeSemanticArguments(sconsArgs),normalizeSemanticArguments(historical.build.sconsArgs));
  assert.equal(got?.pin,p.sourceCommit);assert.equal(got.cppdefines,'');assert.equal(got.lto,'thin');assert.equal(got.ltoJobs,8);assert.equal(got.symbols,true);
  assert.equal(got.profileSha256,recipe.engine.profile.sha256);
  assert.equal(norm(got.sdk?.path),norm(plan.request.sdk));assert.equal(norm(got.sdk?.python?.path),norm(plan.request.python));assert.equal(norm(got.hostRuntime?.node?.path),norm(process.execPath));
  assert.deepEqual(got.patches?.map(f=>f.sha256),p.patches.map(f=>f.sha256),'PERSISTENT_SEVEN_PATCH_IDENTITIES');
  assert.equal(got.glxLibrary?.sha256,p.libraryRequirement.sha256);assert.equal(got.glxLibrary?.bytes,p.libraryRequirement.bytes);assert.equal(norm(got.glxLibrary?.path),norm(plan.library));
  assert.equal(got.hostRuntime?.node?.sha256,recipe.toolchain.driverNode.sha256);assert.equal(got.sdk?.pythonBase?.sha256,recipe.toolchain.pythonBaseSha256);
  for(const pin of recipe.toolchain.sdkFiles){const entries=got.sdk.files.filter(f=>norm(f.path)===norm(path.join(plan.request.sdk,pin.path)));assert.equal(entries.length,1);assert.equal(entries[0].sha256,pin.sha256);}
  assert.equal(got.windowsAdapterSha256,historical.build.windowsLinkAdapterSha256);
  assert.deepEqual(got.commonArgs,historical.build.sconsArgs.slice(0,historical.build.sconsArgs.indexOf('lto=thin')));
  return {status:'PASS_PERSISTENT_RECORDED_INPUTS_ONLY',actualFilesRead:false,buildCompleted:false,runtimeVerified:false};
}
function currentInputs(plan,got){
  assertPersistentRecordedInputs({plan,identity:got,sconsArgs:plan.sconsArgs,profileBytes:regular(plan.profile)});
  const pin=expected=>{const current=identity(regular(expected.path));assert.deepEqual(current,{bytes:expected.bytes,sha256:expected.sha256});return {path:expected.path,...current};};
  return {library:pin(got.glxLibrary),node:pin(got.hostRuntime.node),python:pin(got.sdk.python),pythonBase:pin(got.sdk.pythonBase),sdkFiles:got.sdk.files.map(pin),profile:identity(regular(plan.profile))};
}
function resourceSample(dir){const ps=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');const system=JSON.parse(execFileSync(ps,['-NoProfile','-File',path.join(repo,'engine/alpha-preserve-lighting/delivery-resources.ps1')],{encoding:'utf8',windowsHide:true,timeout:20000}));const disk=fs.statfsSync(dir);return {at:new Date().toISOString(),freeMemory:os.freemem(),totalMemory:os.totalmem(),cpuCount:os.availableParallelism(),freeDisk:disk.bavail*disk.bsize,...system};}
function dependencyAudit(r,env,cwd){const report=JSON.parse(execFileSync(r.python,['-B',path.join(repo,'engine/fixed-dependency-audit.py'),'--sdk',r.sdk,'--scons-wheel',r.sconsWheel,'--sdk-archive',r.sdkArchive],{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}));assert.equal(report.status,'PASS_DEPENDENCIES_ONLY');return report;}
function cleanLogs(root,commands){for(const c of commands){assert(c.result?.closed&&c.result.outcome==='SUCCESS'&&c.result.exitCode===0,'PERSISTENT_COMMAND_NOT_SUCCESSFUL');for(const key of ['stdout','stderr']){const bytes=regular(child(root,c[key]));assert.deepEqual(identity(bytes),c[key+'Identity']);assert(!/warning: undefined symbol:|error: undefined symbol:|unresolved symbol:|missing function:/i.test(bytes.toString()),'PERSISTENT_UNRESOLVED_LINK_LOG');}}}
function childEnvironment(r){return {...buildEnv({emsdk:r.sdk,python:r.python}),EM_FROZEN_CACHE:'1',EMCC_CORES:String(r.jobs),BINARYEN_CORES:String(r.jobs),TEMP:path.join(r.work,'temp'),TMP:path.join(r.work,'temp'),EMCC_TEMP_DIR:path.join(r.work,'temp')};}

// Explicit read-only readiness check. May run version/cache/resource readers,
// but never SCons, compiler, source tests, checkout, mkdir or a task writer.
export function preflightPersistentBuild(raw){
  const r=normalizePersistentExecutionRequest(raw),placement=validatePersistentPlacement(r);rejectBuildEnvironmentOverrides(process.env);
  const plan=persistentExecutionPlan(r),env=childEnvironment(r),gitIdentity=assertGitResolution(r,env),pinnedDependencies=checkPinnedDependencies(r,env);
  const resources=resourceSample(path.dirname(r.work));checkResourceHeadroom(resources,{jobs:r.jobs,budgetBytes:r.budgetBytes,initial:true});
  const dependencies=dependencyAudit(r,env,path.dirname(r.work));assert(!fs.existsSync(r.work),'PERSISTENT_PREFLIGHT_CREATED_WORK');
  return {schema:'wxslim-persistent-preflight-v1',status:'READ_ONLY_PREFLIGHT_PASS_NOT_AUTHORIZATION',plan,placement,gitIdentity,pinnedDependencies,resources,dependencies,workCreated:false,compilerExecuted:false};
}

export async function executePersistentBuild(raw,{write=false}={}){
  assert.equal(write,true,'PERSISTENT_EXPLICIT_WRITE_REQUIRED');assert.equal(process.platform,'win32','PERSISTENT_FIXED_WINDOWS_RECIPE_ONLY');
  const preflight=preflightPersistentBuild(raw),plan=preflight.plan,r=plan.request,work=plan.work;
  const implementation=implementations(),gitIdentity=preflight.gitIdentity;
  const tc={emsdk:r.sdk,python:r.python,engineSource:plan.source,pin:plan.sourcePlan.sourceCommit,glxLibrary:plan.library,glxLibrarySha256:plan.sourcePlan.libraryRequirement.sha256,patches:plan.sourcePlan.patches.map(p=>path.join(work,'inputs',p.path)),cppdefines:''};
  const env=childEnvironment(r),initial=preflight.resources,dependenciesBefore=preflight.dependencies;
  const task=createTask(work,{budgetBytes:r.budgetBytes,recipeId:'persistent-dev:'+plan.planSha256});
  const signals=cancellationSignals(task),cancelDisk=cancellationReader(work,task.taskId),isCancelled=()=>signals.isRequested()||cancelDisk();
  const commands=[],samples=[initial],phaseBoundaries=[];
  const record={schema:'wxslim-persistent-build-v1',taskId:task.taskId,plan,implementation,gitIdentity,dependenciesBefore,commands,samples,phaseBoundaries,attempts:1,engineExecution:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',environment:Object.fromEntries(['EMSDK','EM_CONFIG','EM_CACHE','EM_FROZEN_CACHE','EMSDK_PYTHON','EMCC_CORES','BINARYEN_CORES','PYTHONDONTWRITEBYTECODE','TEMP','TMP','EMCC_TEMP_DIR'].map(k=>[k,env[k]]))};
  let sequence=0,pressure=null,beforeSource,inputsBefore,rawWasmSha;
  const sample=()=>{const s=resourceSample(work),size=measuredTree(work),row={...s,logicalBytes:size.bytes,transientFilesGone:size.transientGone};samples.push(row);checkResourceHeadroom(s,{jobs:r.jobs,budgetBytes:r.budgetBytes,logicalBytes:size.bytes});return row;};
  const run=async(stage,exe,args,cwd=plan.source)=>{
    task.checkpoint(stage);const prefix=String(++sequence).padStart(3,'0')+'-'+stage;
    const c={stage,executable:exe,args:[...args],cwd,startedAt:new Date().toISOString(),stdout:'logs/'+prefix+'.stdout.log',stderr:'logs/'+prefix+'.stderr.log'};commands.push(c);
    const timer=setInterval(()=>{try{sample();}catch(e){pressure??={code:'RESOURCE_PRESSURE',message:String(e.message)};}},15000);
    try{c.result=await runOwnedProcess({executable:exe,args,cwd,env,stdoutPath:child(work,c.stdout),stderrPath:child(work,c.stderr),isCancellationRequested:isCancelled});}
    finally{clearInterval(timer);c.endedAt=new Date().toISOString();for(const key of ['stdout','stderr'])if(fs.existsSync(child(work,c[key])))c[key+'Identity']=identity(regular(child(work,c[key])));}
    if(c.result.outcome==='CANCELLED')throw failure('TASK_CANCELLED','Owned child closed after cancellation; no next phase');
    assert(c.result.closed&&c.result.outcome==='SUCCESS',c.result.error||'PERSISTENT_OWNED_PROCESS_FAILED');if(pressure)throw failure(pressure.code,pressure.message);task.checkpoint(stage);
    return {command:prefix,exitCode:c.result.exitCode,elapsedMs:c.result.elapsedMs};
  };
  const git=(args,cwd=plan.source)=>run('SOURCE',r.gitExecutable,args,cwd);
  const sourceAudit=()=>{assert.deepEqual(assertGitResolution(r),gitIdentity);return auditPersistentSource({source:plan.source,plan:plan.sourcePlan});};
  const phases=[
    {name:'SNAPSHOT',run:async()=>{
      for(const name of ['inputs','logs','temp','artifacts','evidence'])fs.mkdirSync(path.join(work,name));
      const profile=regular(path.join(repo,recipe.engine.profile.path)),library=regular(r.library);assert.equal(sha(profile),recipe.engine.profile.sha256);assert.deepEqual(identity(library),{bytes:plan.sourcePlan.libraryRequirement.bytes,sha256:plan.sourcePlan.libraryRequirement.sha256});writeNew(plan.profile,profile);writeNew(plan.library,library);
      const byPath=new Map([...plan.sourcePlan.inputs,...implementation].map(f=>[f.path,f]));record.snapshots=[];
      for(const item of byPath.values()){const bytes=regular(path.join(repo,item.path));assert.deepEqual(identity(bytes),{bytes:item.bytes,sha256:item.sha256});const dest=child(work,'inputs/'+item.path);fs.mkdirSync(path.dirname(dest),{recursive:true});writeNew(dest,bytes);record.snapshots.push({path:'inputs/'+item.path,...identity(bytes)});}
      writeJSON(child(work,'inputs/REQUEST.json'),r);writeJSON(child(work,'inputs/PLAN.json'),plan);return {inputCount:record.snapshots.length,profile:identity(profile),library:identity(library)};
    }},
    {name:'SOURCE',run:async()=>{
      await git(['init',plan.source],work);await git(['config','core.autocrlf','false']);await git(['remote','add','origin',recipe.engine.source.repository]);await git(['fetch','--depth=1','origin',plan.sourcePlan.sourceCommit]);await git(['checkout','--detach',plan.sourcePlan.sourceCommit]);
      for(const item of plan.sourcePlan.patches){const file=child(work,'inputs/'+item.path);assert.deepEqual(identity(regular(file)),{bytes:item.bytes,sha256:item.sha256});await git(['apply','--check',file]);await git(['apply',file]);}
      const sourceBuffers=Object.fromEntries(plan.sourcePlan.generatedLibrary.inputs.map(i=>[i.path,regular(child(work,'inputs/'+i.path))]));
      const library=renderPersistentLibrary({sourceBuffers,expectedHashes:Object.fromEntries(plan.sourcePlan.generatedLibrary.inputs.map(i=>[i.path,i.sha256]))});assert.deepEqual(identity(Buffer.from(library.source)),{bytes:plan.sourcePlan.generatedLibrary.bytes,sha256:plan.sourcePlan.generatedLibrary.sha256});writeNew(child(work,'engine/'+plan.sourcePlan.generatedLibrary.path),library.source);
      return {sourceCommit:plan.sourcePlan.sourceCommit,patches:plan.sourcePlan.patches.map(p=>p.sha256),generated:identity(Buffer.from(library.source))};
    }},
    {name:'SOURCE_AUDIT',run:async()=>{beforeSource=sourceAudit();record.sourceAfterPatches=beforeSource;writeJSON(child(work,'evidence/source-after-patches.json'),beforeSource);return {status:beforeSource.status};}},
    {name:'SOURCE_TESTS',run:async()=>{for(const name of SOURCE_TESTS)await run('SOURCE_TESTS',process.execPath,[path.join(plan.source,'platform/web/js/tests',name)]);return {tests:[...SOURCE_TESTS],persistenceCoverage:false};}},
    {name:'PRECOMPILE',run:async()=>{
      record.sourceBeforeCompile=sourceAudit();assertPersistentSourceUnchanged(beforeSource,record.sourceBeforeCompile);
      assert.deepEqual(assertGitResolution(r),gitIdentity);record.identity=await buildIdentity({tc,profileFile:plan.profile,stage:plan.source,lto:'thin',symbols:true,ltoJobs:8});record.sconsArgs=plan.sconsArgs;inputsBefore=currentInputs(plan,record.identity);record.inputsBeforeCompile=inputsBefore;
      assert.deepEqual(dependencyAudit(r,env,work),dependenciesBefore);assert.deepEqual(implementations(),implementation);return {status:'PASS_CURRENT_PERSISTENT_INPUTS_ONLY'};
    }},
    {name:'COMPILE',run:async()=>{const result=await run('COMPILE',r.python,['-m','SCons',...plan.sconsArgs]);record.sourceAfterCompile=sourceAudit();assertPersistentSourceUnchanged(beforeSource,record.sourceAfterCompile);record.modules=auditFixedModules({source:plan.source,profile:'full'});return {...result,modules:record.modules.enabledModules.length,timing:'SCons compilation/link/WASM optimization combined unless actual logs expose boundaries'};}},
    {name:'CAPTURE_RAW',run:async()=>{
      const raw=regular(path.join(plan.source,'bin/.web_zip/godot.js')),wasm=regular(path.join(plan.source,'bin/.web_zip/godot.wasm')),symbols=regular(path.join(plan.source,'bin/godot.web.template_release.wasm32.nothreads.js.symbols'));rawWasmSha=sha(wasm);
      for(const [name,bytes]of Object.entries({'emscripten-before-godot-process.js':raw,'godot.wasm':wasm,'godot.js.symbols':symbols}))writeNew(child(work,'artifacts/'+name),bytes);record.rawCapture={rawJs:identity(raw),wasm:identity(wasm),symbols:identity(symbols)};return record.rawCapture;
    }},
    {name:'POSTPROCESS',run:async()=>{const result=await run('POSTPROCESS',process.execPath,[path.join(plan.source,'godot_process.js')]);assert.equal(sha(regular(path.join(plan.source,'bin/.web_zip/godot.wasm'))),rawWasmSha);return result;}},
    {name:'ARTIFACTS',run:async()=>{
      const js=regular(path.join(plan.source,'bin/.web_zip/godot.js')),wasm=regular(child(work,'artifacts/godot.wasm')),derived=returnZero(js),br=brotliCompressSync(wasm,{params:{[constants.BROTLI_PARAM_QUALITY]:11,[constants.BROTLI_PARAM_SIZE_HINT]:wasm.length}});
      for(const [name,bytes]of Object.entries({'godot.js':js,'godot-return0.js':derived,'godot.wasm.br':br}))writeNew(child(work,'artifacts/'+name),bytes);
      record.outputs=Object.fromEntries(['emscripten-before-godot-process.js','godot.js.symbols','godot.wasm','godot.js','godot-return0.js','godot.wasm.br'].map(name=>[name,identity(regular(child(work,'artifacts/'+name)))]));assertRawCaptureOutputs(record.rawCapture,record.outputs);return {outputs:record.outputs,postprocessCount:1,globalId:'return 0'};
    }},
    {name:'FINAL_AUDIT',run:async()=>{
      record.sourceFinal=sourceAudit();assertPersistentSourceUnchanged(beforeSource,record.sourceFinal);assert.deepEqual(currentInputs(plan,record.identity),inputsBefore);assert.deepEqual(auditFixedModules({source:plan.source,profile:'full'}),record.modules);
      record.dependenciesAfter=dependencyAudit(r,env,work);assert.deepEqual(record.dependenciesAfter,dependenciesBefore);assert.deepEqual(implementations(),implementation);assert.deepEqual(identity(regular(r.gitExecutable)),gitIdentity);
      for(const snap of record.snapshots)assert.deepEqual(identity(regular(child(work,snap.path))),{bytes:snap.bytes,sha256:snap.sha256});assert.deepEqual(JSON.parse(regular(child(work,'inputs/REQUEST.json'))),r);assert.deepEqual(JSON.parse(regular(child(work,'inputs/PLAN.json'))),plan);for(const [name,pin]of Object.entries(record.outputs))assert.deepEqual(identity(regular(child(work,'artifacts/'+name))),pin);cleanLogs(work,commands);
      const js=regular(child(work,'artifacts/godot.js')),glue=regular(child(work,'artifacts/godot-return0.js'));assert(returnZero(js).equals(glue));record.pair=inspectPersistentPairBuffers({glue,wasm:regular(child(work,'artifacts/godot.wasm')),compressed:regular(child(work,'artifacts/godot.wasm.br'))});writeJSON(child(work,'evidence/pair-static.json'),record.pair);
      return {status:'STATIC_CHECKS_COMPLETE_AWAITING_TERMINAL',runtime:'NOT_RUN',deploymentAdmission:'NOT_ADMITTED'};
    }}
  ];
  try{return await runBuildPhases({phases,isCancelled,beforePhase:name=>{task.checkpoint(name);if(pressure)throw failure(pressure.code,pressure.message);phaseBoundaries.push({phase:name,before:sample()});},onEvent:event=>{if(event.status==='PASS')phaseBoundaries.at(-1).after=sample();task.event(event);},finish:(status,details)=>{record.phases=details.phases;record.requestedTerminal=status;record.status='REQUIRES_MATCHING_TASK_TERMINAL';record.endedAt=new Date().toISOString();if(details.error)record.failure=details.error;if(details.eventErrors)record.eventErrors=details.eventErrors;record.signalCancellationErrors=signals.errors;const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');writeNew(child(work,'BUILD.json'),bytes);return task.finish(status,{kind:'PERSISTENT_DEV_ENGINE_BUILD',build:identity(bytes),runtime:'NOT_RUN',deploymentAdmission:'NOT_ADMITTED'});}});}finally{signals.detach();}
}

export function auditCompletedPersistentBuild(root,taskId){
  root=path.resolve(root);const state=inspectTask(root,taskId),terminal=state.terminal;assert.equal(terminal?.status,'SUCCESS','PERSISTENT_SUCCESS_TERMINAL_REQUIRED');assert.equal(terminal.details.kind,'PERSISTENT_DEV_ENGINE_BUILD');assert(!state.cancellation,'PERSISTENT_SUCCESS_CANCEL_CONFLICT');assert(state.logicalBytes<=state.owner.budgetBytes);
  const bytes=regular(child(root,'BUILD.json'));assert.deepEqual(identity(bytes),terminal.details.build);const b=JSON.parse(bytes);assert.equal(b.schema,'wxslim-persistent-build-v1');assert.equal(b.taskId,taskId);assert.equal(b.requestedTerminal,'SUCCESS');assert.equal(b.attempts,1);
  const p=b.plan;assert.equal(norm(p.work),norm(root));assert.equal(norm(p.source),norm(path.join(root,'engine')));assert.equal(state.owner.recipeId,'persistent-dev:'+p.planSha256);
  const original={...p};delete original.planSha256;assert.equal(sha(Buffer.from(JSON.stringify(original))),p.planSha256);assert.deepEqual(persistentExecutionPlan(p.request),p,'PERSISTENT_CURRENT_PLAN_DIFFERS');
  assert.deepEqual(b.phases.map(f=>f.name),PERSISTENT_PHASES);assert(b.phases.every(f=>f.status==='pass'));assert.deepEqual(b.implementation,implementations());assert.deepEqual(identity(regular(p.request.gitExecutable)),b.gitIdentity);
  for(const stage of ['sourceBeforeCompile','sourceAfterCompile','sourceFinal'])assertPersistentSourceUnchanged(b.sourceAfterPatches,b[stage]);assertPersistentSourceUnchanged(b.sourceFinal,auditPersistentSource({source:p.source,plan:p.sourcePlan}));
  assert.deepEqual(b.dependenciesBefore,b.dependenciesAfter);assert.equal(b.dependenciesBefore.status,'PASS_DEPENDENCIES_ONLY');assert.deepEqual(b.modules,auditFixedModules({source:p.source,profile:'full'}));assert.deepEqual(b.inputsBeforeCompile,currentInputs(p,b.identity));assert.deepEqual(b.sconsArgs,p.sconsArgs);
  const one=stage=>{const a=b.commands.filter(c=>c.stage===stage);assert.equal(a.length,1);return a[0];};const compile=one('COMPILE'),post=one('POSTPROCESS');assert.equal(norm(compile.executable),norm(p.request.python));assert.equal(norm(compile.cwd),norm(p.source));assert.deepEqual(compile.args,['-m','SCons',...p.sconsArgs]);assert.equal(norm(post.executable),norm(b.identity.hostRuntime.node.path));assert.equal(norm(post.cwd),norm(p.source));assert.deepEqual(post.args,[path.join(p.source,'godot_process.js')]);
  const tests=b.commands.filter(c=>c.stage==='SOURCE_TESTS');assert.deepEqual(tests.map(c=>c.args),SOURCE_TESTS.map(n=>[path.join(p.source,'platform/web/js/tests',n)]));for(const c of tests){assert.equal(norm(c.executable),norm(b.identity.hostRuntime.node.path));assert.equal(norm(c.cwd),norm(p.source));}cleanLogs(root,b.commands);
  for(const snap of b.snapshots)assert.deepEqual(identity(regular(child(root,snap.path))),{bytes:snap.bytes,sha256:snap.sha256});assert.deepEqual(JSON.parse(regular(child(root,'inputs/REQUEST.json'))),p.request);assert.deepEqual(JSON.parse(regular(child(root,'inputs/PLAN.json'))),p);assertRawCaptureOutputs(b.rawCapture,b.outputs);assert.deepEqual(b.phases.find(f=>f.name==='CAPTURE_RAW').result,b.rawCapture);
  const names=['emscripten-before-godot-process.js','godot.js','godot-return0.js','godot.wasm','godot.wasm.br','godot.js.symbols'];assert.deepEqual(Object.keys(b.outputs).sort(),[...names].sort());const f={};for(const name of names){f[name]=regular(child(root,'artifacts/'+name));assert.deepEqual(identity(f[name]),b.outputs[name]);}
  assert(returnZero(f['godot.js']).equals(f['godot-return0.js']));const pair=inspectPersistentPairBuffers({glue:f['godot-return0.js'],wasm:f['godot.wasm'],compressed:f['godot.wasm.br']});
  return {schema:'wxslim-persistent-build-static-v1',status:'BUILD_STATIC_AUDIT_PASS_RUNTIME_NOT_RUN',taskId,build:identity(bytes),outputs:b.outputs,pair,phone:'NOT_RUN',deploymentAdmission:'NOT_ADMITTED'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [action,file,extra,...rest]=process.argv.slice(2);assert(!rest.length);if(action==='plan'||action==='preflight'){assert(file&&!extra);const request=JSON.parse(regular(path.resolve(file)));console.log(JSON.stringify(action==='plan'?persistentExecutionPlan(request):preflightPersistentBuild(request),null,2));}else if(action==='execute'){assert(file&&extra==='--write');console.log(JSON.stringify(await executePersistentBuild(JSON.parse(regular(path.resolve(file))),{write:true})));}else if(action==='audit'){assert(file&&extra);console.log(JSON.stringify(auditCompletedPersistentBuild(path.resolve(file),extra)));}else throw Error('plan CONFIG | preflight CONFIG | execute CONFIG --write | audit TASK_ROOT TASK_ID');}
  catch(e){console.error(JSON.stringify({schema:'wxslim-persistent-build-error-v1',status:'FAILED',code:e.code||'PERSISTENT_BUILD_REJECTED',message:String(e.message)}));process.exitCode=1;}
}
