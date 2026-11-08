// Fixed recipe planning and record gates. This module does not execute a build.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {recipe,historical,repo,read,sha,verifyRecipe} from './alpha-preserve-lighting/delivery.mjs';
import {buildPlan} from './alpha-preserve-lighting/delivery-build.mjs';
import {FULL_MODULES,CONSERVATIVE_REMOVED_MODULES,MODULE_BASELINE} from './fixed-module-audit.mjs';

const policyFile=path.join(repo,'engine/fixed-engine-policy.json');
const policy=JSON.parse(read(policyFile));
const configKeys=new Set(['schema','profile','work','sdk','python','library','editor','jobs','requirements']);
const ownObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys,label)=>assert(ownObject(value)&&Object.keys(value).every(k=>keys.includes(k)),label+' has unknown keys');
export const removedFeatures=Object.freeze(Object.keys(policy.removedFeatures));

export function resolveFixedProfile(id='full') {
  assert(['full','conservative'].includes(id),'only full or conservative fixed profiles');
  verifyRecipe();assert.equal(policy.sourceCommit,recipe.engine.source.commit);
  assert.equal(policy.sourceCommit,MODULE_BASELINE.sourceCommit);
  assert.deepEqual([...policy.conservative.disabledModules].sort(),CONSERVATIVE_REMOVED_MODULES,'reviewed removal policy differs');
  assert.deepEqual([...policy.keepModules].sort(),FULL_MODULES.filter(m=>!CONSERVATIVE_REMOVED_MODULES.includes(m)),'complete retained module contract');
  const definition=policy[id],file=path.join(repo,definition.path),bytes=read(file);
  assert.equal(sha(bytes),definition.sha256,'fixed profile bytes changed: '+id);
  const profile=JSON.parse(bytes);
  assert.deepEqual(Object.keys(profile).sort(),['disabled_build_options','disabled_classes','type']);
  assert.equal(profile.type,'build_profile');assert.deepEqual(profile.disabled_classes,[],'class trimming is not admitted');
  assert.deepEqual(profile.disabled_build_options,Object.fromEntries(definition.disabledModules.map(m=>['module_'+m+'_enabled',false])),'only reviewed module removals');
  assert(!definition.disabledModules.some(m=>policy.keepModules.includes(m)),'removed module overlaps mandatory keep list');
  if(id==='full')assert.equal(definition.sha256,recipe.engine.profile.sha256,'original full gate');
  return {id,path:file,relativePath:definition.path,sha256:definition.sha256,bytes:bytes.length,profile,disabledModules:[...definition.disabledModules],
    removedFeatures:id==='full'?[]:structuredClone(policy.removedFeatures),keepModules:[...policy.keepModules],policySha256:sha(read(policyFile)),
    buildStatus:id==='full'?'HISTORICAL_FULL_ONLY':definition.buildStatus,runtimeStatus:'NOT_INFERRED'};
}

export function assessProfileRequirements(id,requirements) {
  resolveFixedProfile(id);
  if(id==='full'&&requirements===undefined)return {status:'NO_FEATURE_REMOVAL',declarationIsDynamicProof:false};
  exactKeys(requirements,['schema','features'],'requirements');assert.equal(requirements.schema,'wxslim-engine-requirements-v1');
  exactKeys(requirements.features,removedFeatures,'features');
  for(const [key,value] of Object.entries(requirements.features))assert(['required','unused','unknown'].includes(value),'invalid feature requirement: '+key);
  const unresolved=removedFeatures.filter(key=>requirements.features[key]!=='unused');
  if(id==='conservative')assert.deepEqual(unresolved,[],'conservative requires explicit unused declarations for every removed feature; omitted/unknown is not unused');
  return {status:id==='full'?'NO_FEATURE_REMOVAL':'DECLARED_COMPATIBLE_NOT_RUNTIME_VERIFIED',features:{...requirements.features},declarationIsDynamicProof:false,
    limitation:'Source scans cannot prove absence of string-created classes or downloaded scripts/resources; require project dependency review and actual tests.'};
}

export function normalizeFixedBuildConfig(raw,base=process.cwd()) {
  assert(ownObject(raw)&&Object.keys(raw).every(k=>configKeys.has(k)),'unknown fixed build configuration key; no overrides/force');
  assert.equal(raw.schema,'wxslim-fixed-build-inputs-v1');
  const cfg={...raw,profile:raw.profile??'full'};
  for(const key of ['work','sdk','python','library','editor']){assert(typeof raw[key]==='string'&&raw[key].trim(),'explicit path required: '+key);cfg[key]=path.resolve(base,raw[key]);}
  assert(['full','conservative'].includes(cfg.profile),'unknown profile');
  if(cfg.jobs!==undefined)assert(Number.isInteger(cfg.jobs)&&cfg.jobs>=1&&cfg.jobs<=16,'jobs is scheduling only, 1..16');
  assessProfileRequirements(cfg.profile,cfg.requirements);
  return cfg;
}

export function normalizeSemanticArguments(args) {
  assert(Array.isArray(args)&&args.every(s=>typeof s==='string'),'argument list');
  for(const prefix of ['--jobs=','build_profile=','wx_glx_lib='])assert.equal(args.filter(a=>a.startsWith(prefix)).length,1,'unique argument: '+prefix);
  return args.map(s=>s.startsWith('--jobs=')?'--jobs=<SCHEDULING>':s.startsWith('build_profile=')?'build_profile=<FIXED_PROFILE>':s.startsWith('wx_glx_lib=')?'wx_glx_lib=<EXACT_026E_LIBRARY>':s);
}

function argumentValue(args,prefix) {
  const matches=args.filter(a=>a.startsWith(prefix));assert.equal(matches.length,1,'unique actual argument: '+prefix);
  return matches[0].slice(prefix.length);
}
function absoluteInput(file) {
  assert(typeof file==='string'&&path.isAbsolute(file)&&!/[<>\r\n\0]/.test(file),'actual absolute input path required');
  const normalized=path.resolve(file);return process.platform==='win32'?normalized.toLowerCase():normalized;
}
function sameInputPath(a,b,label) {assert.equal(absoluteInput(a),absoluteInput(b),label+' path differs');}

export function fixedBuildPlan(cfg) {
  const normalized=normalizeFixedBuildConfig(cfg),selected=resolveFixedProfile(normalized.profile),base=buildPlan(normalized);
  const args=base.sconsArgs.map(a=>a.startsWith('build_profile=')?'build_profile='+selected.path:a);
  assert.deepEqual(normalizeSemanticArguments(args),normalizeSemanticArguments(historical.build.sconsArgs),'semantic build arguments changed');
  const semantics={schema:'wxslim-fixed-build-semantics-v1',source:recipe.engine.source,patches:recipe.engine.patches,windowsLinkPatch:recipe.engine.windowsLinkPatch,
    profile:{id:selected.id,sha256:selected.sha256},library:recipe.engine.library.sha256,cppdefines:'',lto:'thin',ltoJobs:8,symbols:true,
    toolchain:{driverNode:recipe.toolchain.driverNode.sha256,pythonBase:recipe.toolchain.pythonBaseSha256,sdkFiles:recipe.toolchain.sdkFiles},args:normalizeSemanticArguments(args)};
  return {...base,schema:'wxslim-fixed-build-plan-v1',status:'PLANNED_NOT_BUILT',profile:selected.path,selectedProfile:selected,sconsArgs:args,
    semanticRecipeSha256:sha(Buffer.from(JSON.stringify(semantics))),semanticRecipe:semantics,requirements:assessProfileRequirements(selected.id,normalized.requirements),
    sourceEvidenceRequired:['after-patches','before-compile','after-compile'],profileSnapshotRequired:true,
    sizeSavings:'UNKNOWN_UNTIL_BUILD',executionAuthorized:false,newBuildRequired:selected.id==='conservative',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'};
}

// Use this alongside byte/static-pair inspection, never as proof that a build ran.
export function assertFixedBuildInvariants(build,profileId,frozenProfile) {
  const selected=resolveFixedProfile(profileId),cfg=recipe.engine,identity=build.identity;
  assert(identity&&build.sconsArgs,'real build identity and arguments required');
  const jobs=argumentValue(build.sconsArgs,'--jobs=');assert(/^(?:[1-9]|1[0-6])$/.test(jobs),'actual jobs must be 1..16');
  assert(frozenProfile&&Buffer.isBuffer(frozenProfile.bytes),'profile path and bytes evidence required');
  sameInputPath(argumentValue(build.sconsArgs,'build_profile='),frozenProfile.path,'actual profile');
  sameInputPath(argumentValue(build.sconsArgs,'wx_glx_lib='),identity.glxLibrary?.path,'actual GLX library');
  assert.equal(sha(frozenProfile.bytes),selected.sha256,'frozen profile bytes');
  assert.equal(identity.profileSha256,selected.sha256,'identity profile');
  assert.equal(build.profileSha256,selected.sha256,'top-level profile');
  assert.equal(identity.pin,cfg.source.commit);assert.equal(identity.glxLibrary?.sha256,cfg.library.sha256);
  assert.equal(identity.glxLibrary?.bytes,cfg.library.bytes);assert.equal(identity.cppdefines,'');assert.equal(identity.symbols,true);
  assert.equal(identity.lto,'thin');assert.equal(identity.ltoJobs,8);
  assert.deepEqual(identity.patches?.map(p=>p.sha256),cfg.patches.map(p=>p.sha256),'four patches and order');
  assert.equal(identity.windowsAdapterSha256,historical.build.windowsLinkAdapterSha256,'adapter marker only; actual patched source proof also required');
  assert.equal(identity.hostRuntime?.node?.sha256,recipe.toolchain.driverNode.sha256);
  assert.equal(identity.sdk?.pythonBase?.sha256,recipe.toolchain.pythonBaseSha256);
  for(const file of recipe.toolchain.sdkFiles){const matches=identity.sdk.files.filter(f=>f.path.replaceAll('\\','/').endsWith('/'+file.path));assert.equal(matches.length,1);assert.equal(matches[0].sha256,file.sha256);}
  assert.deepEqual(normalizeSemanticArguments(build.sconsArgs),normalizeSemanticArguments(historical.build.sconsArgs),'fixed semantic arguments');
  const expectedCommon=historical.build.sconsArgs.slice(0,historical.build.sconsArgs.indexOf('lto=thin'));
  assert.deepEqual(identity.commonArgs,expectedCommon,'identity common args');
  return {status:'PASS_RECORDED_INPUTS_ONLY',profileId,profileSha256:selected.sha256,actualPathsRead:false,patchedSourceProven:false,buildCompleted:false,runtimeVerified:false};
}

function readInput(file) {
  absoluteInput(file);const before=fs.lstatSync(file);assert(before.isFile()&&!before.isSymbolicLink(),'regular input required');
  const bytes=read(file),after=fs.lstatSync(file);
  assert(after.isFile()&&!after.isSymbolicLink());
  for(const field of ['size','mtimeMs','ctimeMs','ino','dev'])assert.equal(after[field],before[field],'input changed while read');
  assert.equal(bytes.length,before.size);
  return {path:path.resolve(file),bytes,identity:{path:path.resolve(file),bytes:bytes.length,sha256:sha(bytes)}};
}

// Read existing named inputs; do not execute any tool or treat present-day hashes
// as evidence of what a historical compiler actually consumed.
export function auditFixedBuildInputs({build,profileId}) {
  const profile=readInput(argumentValue(build.sconsArgs,'build_profile='));
  const record=assertFixedBuildInvariants(build,profileId,profile);
  const readExpected=expected=>{
    assert(expected&&typeof expected.sha256==='string','input identity required');
    const actual=readInput(expected.path).identity;
    assert.equal(actual.sha256,expected.sha256,'actual input hash differs');assert.equal(actual.bytes,expected.bytes,'actual input size differs');
    return actual;
  };
  const identity=build.identity;
  const inputs={profile:profile.identity,library:readExpected(identity.glxLibrary),driverNode:readExpected(identity.hostRuntime.node),
    pythonBase:readExpected(identity.sdk.pythonBase),sdkFiles:identity.sdk.files.map(readExpected)};
  return {...record,status:'PASS_CURRENT_INPUT_FILES_ONLY',actualPathsRead:true,inputs,
    limitation:'Current files match recorded paths and fixed hashes; no historical consumption, completion, source tree or runtime proof.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,file,...extra]=process.argv.slice(2);
    assert(action==='plan'&&file&&!extra.length,'plan CONFIG; execution is not yet exposed');
    const cfg=normalizeFixedBuildConfig(JSON.parse(read(file)),path.dirname(path.resolve(file)));
    console.log(JSON.stringify(fixedBuildPlan(cfg),null,2));
  } catch(e) {console.error(JSON.stringify({schema:'wxslim-fixed-build-error-v1',status:'FAILED',code:e.code||'FIXED_PLAN_REJECTED',message:'固定构建计划未通过；不创建目录或执行构建。'}));process.exitCode=1;}
}
