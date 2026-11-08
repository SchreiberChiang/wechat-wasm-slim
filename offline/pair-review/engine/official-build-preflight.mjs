// Read-only planning and dependency/resource preflight for a separately approved
// official-source RAW build. No checkout, mkdir, compiler or converter entry.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {officialRawSourceRecipe,OFFICIAL_RAW_REQUEST_SCHEMAS} from './official-raw-source-recipe.mjs';
import {OFFICIAL_CUSTOM_RAW_REQUEST,rawRecipePlanInput} from './official-custom-source-plan.mjs';
import {normalizeCustomWasmRequest} from './custom-wasm-plan.mjs';
import {officialModuleRequirements} from './official-module-audit.mjs';
import {buildEnv} from '../trim/lib/build.mjs';
import {checkResourceHeadroom,rejectBuildEnvironmentOverrides} from './fixed-build.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),GiB=2**30;
const pathFields=['work','sdk','python','library','sconsWheel','sdkArchive','gitExecutable','upstreamSource'];
export const OFFICIAL_RAW_PHASES=Object.freeze(['SNAPSHOT','SOURCE','SOURCE_AUDIT','PRECOMPILE','COMPILE','CAPTURE_RAW','RAW_AUDIT']);
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const overlap=(a,b)=>norm(a)===norm(b)||norm(a).startsWith(norm(b)+path.sep)||norm(b).startsWith(norm(a)+path.sep);
const implementationPaths=['engine/official-build-preflight.mjs','engine/official-build-plan.mjs','engine/official-build-plan.json','engine/official-raw-source-recipe.mjs',
 'engine/official-build-raw.mjs','engine/official-build-source-runtime.mjs','engine/official-module-audit.mjs','engine/official-module-audit.json',
 'engine/official-checkout-eol.mjs','engine/official-checkout-eol.json',
 'engine/fixed-module-audit.mjs','engine/official-raw-artifacts.mjs','engine/official-glue-inspection.mjs','engine/official-glx-library/audit-linkage.cjs',
 'engine/official-build-source.mjs','engine/fixed-build.mjs','engine/fixed-engine-plan.mjs','engine/fixed-engine-policy.json',
 'engine/fixed-build-lifecycle.mjs','engine/fixed-dependency-audit.py','engine/fixed-toolchain-cache.json',
 'engine/alpha-preserve-lighting/delivery-resources.ps1','trim/lib/build.mjs','convert/lib/owned-process.mjs','convert/lib/official-task.mjs'];
function regular(file){
 const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink(),'OFFICIAL_PREFLIGHT_REGULAR_FILE');
 assert.equal(norm(fs.realpathSync(file)),norm(file),'OFFICIAL_PREFLIGHT_LINKED_FILE');
 const b=fs.readFileSync(file),after=fs.lstatSync(file);
 for(const k of ['size','mtimeMs','ctimeMs','ino','dev'])assert.equal(after[k],s[k],'OFFICIAL_PREFLIGHT_INPUT_DRIFT');
 assert.equal(b.length,s.size);return b;
}
const implementations=()=>implementationPaths.map(p=>({path:p,...pin(regular(path.join(root,p)))}));
function exact(value,keys){
 assert(value&&typeof value==='object'&&!Array.isArray(value),'OFFICIAL_RAW_REQUEST');
 assert.deepEqual(Reflect.ownKeys(value).sort(),[...keys].sort(),'OFFICIAL_RAW_EXACT_FIELDS');
 const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);assert(d&&Object.hasOwn(d,'value'),'OFFICIAL_RAW_DATA_FIELDS');out[k]=d.value;}return out;
}

export function normalizeOfficialRawBuildRequest(value){
 assert.equal(arguments.length,1,'OFFICIAL_RAW_ONE_REQUEST');
 const schema=Object.getOwnPropertyDescriptor(value??{},'schema');
 assert(schema&&Object.hasOwn(schema,'value'),'OFFICIAL_RAW_DATA_FIELDS');
 const custom=schema.value===OFFICIAL_CUSTOM_RAW_REQUEST;
 const r=exact(value,['schema','profile',...pathFields,'jobs','budgetBytes',...(custom?['features']:[])]);
 assert(OFFICIAL_RAW_REQUEST_SCHEMAS.includes(r.schema),'OFFICIAL_RAW_RECIPE_SCHEMA');
 assert((custom?['custom']:['full','conservative']).includes(r.profile),'OFFICIAL_RAW_EXPLICIT_PROFILE');
 if(custom)r.features=normalizeCustomWasmRequest(r.features);
 for(const k of pathFields){assert(typeof r[k]==='string'&&r[k].trim()===r[k]&&path.isAbsolute(r[k])&&!/[<>\0\r\n]/.test(r[k]),'OFFICIAL_RAW_ABSOLUTE_PATH '+k);r[k]=path.resolve(r[k]);}
 assert(Number.isInteger(r.jobs)&&r.jobs>=1&&r.jobs<=16,'OFFICIAL_RAW_JOBS');
 assert(Number.isSafeInteger(r.budgetBytes)&&r.budgetBytes>=8*GiB&&r.budgetBytes<=20*GiB,'OFFICIAL_RAW_BUDGET_8_TO_20_GIB');
 return r;
}

export function officialRawExecutionPlan(value){
 assert.equal(arguments.length,1,'OFFICIAL_RAW_ONE_REQUEST');
 const request=normalizeOfficialRawBuildRequest(value),recipe=officialRawSourceRecipe(request.schema),sourcePlan=recipe.plan(rawRecipePlanInput(request));
 const source=path.join(request.work,'engine'),profile=path.join(request.work,'inputs/profile.gdbuild'),library=path.join(request.work,'inputs/libemscriptenglx.a');
 const args=sourcePlan.argumentTemplate.map(a=>a.startsWith('--jobs=')?'--jobs='+request.jobs:a.startsWith('build_profile=')?'build_profile='+profile:a.startsWith('wx_glx_lib=')?'wx_glx_lib='+library:a);
 assert(args.every(a=>!/[<>]/.test(a)),'OFFICIAL_RAW_UNRESOLVED_ARGUMENT');
 for(const prefix of ['--jobs=','build_profile=','wx_glx_lib='])assert.equal(args.filter(a=>a.startsWith(prefix)).length,1,'OFFICIAL_RAW_DUPLICATE_ARGUMENT');
 const moduleRequirements=request.schema===OFFICIAL_CUSTOM_RAW_REQUEST?sourcePlan.moduleSelection:officialModuleRequirements(request.profile);
 const plan={schema:'wxslim-official-raw-execution-plan-v1',status:'PLAN_ONLY_EXECUTION_REQUIRES_APPROVED_SCOPE',request,
  sourceRecipe:recipe.id,sourcePlanSha256:sourcePlan.planSha256,sourceCommit:sourcePlan.source.commit,sourceRepository:sourcePlan.source.repository,
  work:request.work,source,profile,library,sconsArgs:args,phases:[...OFFICIAL_RAW_PHASES],implementation:implementations(),
  rawCapture:sourcePlan.rawCapture,sourceRequirement:{base:'Whole fixed official commit/tree and all tracked bytes',prepared:`Exactly the ${recipe.outputFiles} authenticated derived outputs plus all untouched original files`,
   postcompile:'Tracked source and generated-file inventory need a distinct post-build audit; pre-build audit cannot accept generated files'},
  dependencyProvenance:'Same fixed SDK/cache and parameter donor; dependency sourceCommitReference is historical, not current source identity',
  moduleRequirements:{officialModuleUniverse:'FIXED_OFFICIAL_METADATA_CHECKED',metadata:moduleRequirements.metadata,expectedModules:moduleRequirements.expectedModules,
   generatedHeaderAndRegistration:'NOT_AVAILABLE',builtinMbedtls:true,moduleMbedtls:true,actualAesAndCtrDrbgObjects:'NOT_AVAILABLE'},
  plannedTerminal:{taskStatus:'SUCCESS_ONLY_AFTER_OWNED_CHILD_CLOSE_AND_RAW_AUDIT',kind:'OFFICIAL_RAW_BUILD',artifactState:'RAW_CAPTURED_NOT_FINALIZED',admission:'NOT_ADMITTED',postprocess:'NOT_RUN'},
  runtime:'NOT_RUN',executionAuthorized:false,executionCommand:null,
  writes:'NONE during plan/preflight; eventual build requires one separately approved work path and capacity',
  noAutomaticRetry:true,noCacheRepair:true,noGlobalEnvironmentChange:true,
  remaining:['Execute the reviewed raw executor only in the separately approved fresh directory and capacity.',
   'Authenticate actual source/module configuration and emitted commands; metadata is not a real build.',
   'Capture earliest JS/WASM/symbols from actual SCons paths; record later wrappers separately.',
   'Official final postprocess and host registration are not completed by a raw build.']};
 return {...plan,planSha256:hash(Buffer.from(JSON.stringify(plan)))};
}

export function officialRawChildEnvironment(value){
 const r=normalizeOfficialRawBuildRequest(value);assertOfficialBuildEnvironment(process.env);
 const env=buildEnv({emsdk:r.sdk,python:r.python});
 for(const k of Object.keys(env))if(/^GIT_/i.test(k))delete env[k];
 return {...env,PATH:[path.dirname(r.gitExecutable),env.PATH].join(path.delimiter),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',
  EM_FROZEN_CACHE:'1',EMCC_CORES:String(r.jobs),BINARYEN_CORES:String(r.jobs),
  TEMP:path.join(r.work,'temp'),TMP:path.join(r.work,'temp'),EMCC_TEMP_DIR:path.join(r.work,'temp')};
}

export function assertOfficialBuildEnvironment(environment){
 rejectBuildEnvironmentOverrides(environment);
 const names=new Set(['CC','CXX','AR','LD','AS','NM','RANLIB','OBJCOPY','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS',
  'CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','OBJC_INCLUDE_PATH','LIBRARY_PATH','LIB','INCLUDE','CL','_CL_','CCC_OVERRIDE_OPTIONS']);
 for(const [name,value]of Object.entries(environment))if(names.has(name.toUpperCase()))assert(!value,'OFFICIAL_RAW_UNREVIEWED_BUILD_ENV '+name);
 return {status:'NO_REVIEWED_OVERRIDE_VARIABLES_PRESENT',coverage:'Explicit compiler/search variables; not every possible OS variable'};
}
function pythonBase(r){
 const venv=path.resolve(path.dirname(r.python),'..'),cfg=path.join(venv,'pyvenv.cfg'),text=regular(cfg).toString(),fields={};
 for(const key of ['home','executable']){const rows=[...text.matchAll(new RegExp('^'+key+'\\s*=\\s*(.+)$','gm'))];assert.equal(rows.length,1,'OFFICIAL_RAW_PYTHON_BASE_CONFIG');const p=rows[0][1].trim();assert(path.isAbsolute(p),'OFFICIAL_RAW_ABSOLUTE_PYTHON_BASE');fields[key]=path.resolve(p);}
 return {venv,config:cfg,home:fields.home,executable:fields.executable};
}
function sourceBoundary(file){
 const parent=path.dirname(file);let current=parent;
 for(let n=0;n<128;n++){
  if(fs.existsSync(path.join(current,'.git')))return {path:current,kind:'NEAREST_GIT_PARENT_NOT_OWNERSHIP_PROOF'};
  const next=path.dirname(current);if(next===current)return {path:parent,kind:'STANDALONE_SOURCE_PARENT_ONLY'};current=next;
 }
 throw Error('OFFICIAL_RAW_SOURCE_PARENT_DEPTH');
}

export function validateOfficialRawPlacement(value){
 const r=normalizeOfficialRawBuildRequest(value);assert(!fs.existsSync(r.work),'OFFICIAL_RAW_FRESH_WORK_REQUIRED');
 const parent=path.dirname(r.work);assert.equal(norm(fs.realpathSync(parent)),norm(parent),'OFFICIAL_RAW_REAL_PARENT');
 assert(fs.lstatSync(parent).isDirectory(),'OFFICIAL_RAW_PARENT_DIRECTORY');
 const base=pythonBase(r),upstreamBoundary=sourceBoundary(r.upstreamSource);
 const protectedPaths=[root,r.sdk,base.venv,base.home,path.dirname(base.executable),path.dirname(r.gitExecutable),upstreamBoundary.path,
  ...['library','sconsWheel','sdkArchive','upstreamSource'].map(k=>r[k])];
 for(const p of protectedPaths){const real=fs.realpathSync(p);assert(!overlap(r.work,p)&&!overlap(r.work,real),'OFFICIAL_RAW_PROTECTED_OVERLAP');}
 return {status:'PASS_PLACEMENT_ONLY',protectedPaths,pythonBase:base,upstreamBoundary,workCreated:false};
}

export function officialRawResourceSnapshot(directory){
 const ps=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const info=JSON.parse(execFileSync(ps,['-NoProfile','-File',path.join(root,'engine/alpha-preserve-lighting/delivery-resources.ps1')],{windowsHide:true,encoding:'utf8',timeout:20000}));
 const disk=fs.statfsSync(directory);return {at:new Date().toISOString(),freeMemory:os.freemem(),totalMemory:os.totalmem(),cpuCount:os.availableParallelism(),freeDisk:disk.bavail*disk.bsize,...info};
}
export function preflightOfficialRawBuild(value){
 assert.equal(arguments.length,1,'OFFICIAL_RAW_ONE_REQUEST');assert.equal(process.platform,'win32','OFFICIAL_RAW_WINDOWS_RECIPE');
 const plan=officialRawExecutionPlan(value),r=plan.request,sourcePlan=officialRawSourceRecipe(r.schema).plan(rawRecipePlanInput(r));
 const placement=validateOfficialRawPlacement(r),env=officialRawChildEnvironment(r),before=implementations();
 assert.deepEqual(before,plan.implementation,'OFFICIAL_RAW_IMPLEMENTATION_DRIFT');
 assert.equal(hash(regular(process.execPath)),sourcePlan.toolchain.driverNode.sha256,'OFFICIAL_RAW_FIXED_NODE');
 assert.equal(hash(regular(r.python)),sourcePlan.toolchain.expectedPython.exeSha256,'OFFICIAL_RAW_FIXED_PYTHON');
 const baseIdentity=pin(regular(placement.pythonBase.executable));
 assert.equal(baseIdentity.sha256,sourcePlan.toolchain.expectedPython.baseSha256,'OFFICIAL_RAW_FIXED_PYTHON_BASE_BEFORE_EXECUTION');
 for(const [name,expected]of [['library',sourcePlan.library],['sconsWheel',sourcePlan.toolchain.scons.wheel],['sdkArchive',sourcePlan.toolchain.sdkArchive],['upstreamSource',sourcePlan.upstreamSource.fixedSource]])
  assert.deepEqual(pin(regular(r[name])),{bytes:expected.bytes,sha256:expected.sha256},'OFFICIAL_RAW_DEPENDENCY '+name);
 const gitIdentity=pin(regular(r.gitExecutable));
 const where=path.join(process.env.SystemRoot||'C:/Windows','System32/where.exe');
 for(const name of ['git','git.exe']){
  const first=execFileSync(where,[name],{env,cwd:path.dirname(r.work),encoding:'utf8',windowsHide:true,timeout:10000}).trim().split(/\r?\n/)[0];
  assert.equal(norm(fs.realpathSync(first)),norm(fs.realpathSync(r.gitExecutable)),'OFFICIAL_RAW_GIT_RESOLUTION');
 }
 const dependencies=JSON.parse(execFileSync(r.python,['-B',path.join(root,'engine/fixed-dependency-audit.py'),'--sdk',r.sdk,'--scons-wheel',r.sconsWheel,'--sdk-archive',r.sdkArchive],
  {env,cwd:path.dirname(r.work),encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:120000}));
 assert.equal(dependencies.status,'PASS_DEPENDENCIES_ONLY');
 assert.deepEqual(dependencies.policy,{bytes:sourcePlan.toolchain.policy.bytes,sha256:sourcePlan.toolchain.policy.sha256},'OFFICIAL_RAW_DEPENDENCY_POLICY');
 const resources=officialRawResourceSnapshot(path.dirname(r.work));checkResourceHeadroom(resources,{jobs:r.jobs,budgetBytes:r.budgetBytes,initial:true});
 assert.deepEqual(implementations(),before,'OFFICIAL_RAW_IMPLEMENTATION_DRIFT');assert.deepEqual(pin(regular(r.gitExecutable)),gitIdentity,'OFFICIAL_RAW_GIT_DRIFT');
 assert.deepEqual(pythonBase(r),placement.pythonBase,'OFFICIAL_RAW_PYTHON_CONFIG_DRIFT');assert.deepEqual(pin(regular(placement.pythonBase.executable)),baseIdentity,'OFFICIAL_RAW_PYTHON_BASE_DRIFT');
 assert.equal(hash(regular(r.python)),sourcePlan.toolchain.expectedPython.exeSha256,'OFFICIAL_RAW_PYTHON_DRIFT');
 for(const [name,expected]of [['library',sourcePlan.library],['sconsWheel',sourcePlan.toolchain.scons.wheel],['sdkArchive',sourcePlan.toolchain.sdkArchive],['upstreamSource',sourcePlan.upstreamSource.fixedSource]])
  assert.deepEqual(pin(regular(r[name])),{bytes:expected.bytes,sha256:expected.sha256},'OFFICIAL_RAW_DEPENDENCY_DRIFT '+name);
 assert.equal(officialRawSourceRecipe(r.schema).plan(rawRecipePlanInput(r)).planSha256,plan.sourcePlanSha256,'OFFICIAL_RAW_SOURCE_PLAN_DRIFT');
 assert(!fs.existsSync(r.work),'OFFICIAL_RAW_PREFLIGHT_CREATED_WORK');
 return {schema:'wxslim-official-raw-preflight-v1',status:'READ_ONLY_PREREQUISITES_CHECKED_NOT_EXECUTED',plan,placement,gitIdentity,dependencies,resources,
  wholeSourceChecked:false,officialModuleSelectionChecked:false,workCreated:false,compilerExecuted:false,executionAuthorized:false};
}
