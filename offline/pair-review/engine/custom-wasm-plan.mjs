// Read-only custom feature planning. Does not register an engine pair or execute a build.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planOfficialCapabilitySources} from './official-capability-source-plan.mjs';
import {officialModuleRequirements} from './official-module-audit.mjs';
import {customModuleSelection} from './custom-module-selection.mjs';

const fields=['schema','dimensions','disabledModules','disabledClasses'];
export function normalizeCustomWasmRequest(request) {
  assert(request&&Object.getPrototypeOf(request)===Object.prototype,'CUSTOM_WASM_OBJECT');
  assert.deepEqual(Reflect.ownKeys(request).sort(),fields.slice().sort(),'CUSTOM_WASM_FIELDS');
  for(const key of fields)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(request,key),'value'),'CUSTOM_WASM_DATA_FIELDS');
  assert.equal(request.schema,'wxslim-custom-wasm-plan-v1');
  assert(['2d','3d'].includes(request.dimensions),'CUSTOM_WASM_DIMENSIONS');
  for(const key of ['disabledModules','disabledClasses']){
    assert(Array.isArray(request[key])&&request[key].length<=1024,'CUSTOM_WASM_LIST');
    assert(request[key].every(v=>typeof v==='string'&&/^[A-Za-z_][A-Za-z_0-9]*$/.test(v)),'CUSTOM_WASM_NAME');
    assert.equal(new Set(request[key]).size,request[key].length,'CUSTOM_WASM_DUPLICATE');
  }
  const modules=officialModuleRequirements('full').moduleDirectories;
  const disabledModules=request.disabledModules.slice().sort(),disabledClasses=request.disabledClasses.slice().sort();
  for(const name of disabledModules){
    assert(modules.includes(name),'CUSTOM_WASM_UNKNOWN_MODULE '+name);
    assert(!['gdscript','mbedtls'].includes(name),'CUSTOM_WASM_REQUIRED_ADAPTER_MODULE '+name);
  }
  return {schema:request.schema,dimensions:request.dimensions,disabledModules,disabledClasses};
}

export function planCustomWasm(request) {
  const normalized=normalizeCustomWasmRequest(request);
  const {disabledModules,disabledClasses}=normalized;
  const source=planOfficialCapabilitySources({profile:'full'});
  const modules=officialModuleRequirements('full').moduleDirectories;
  const profile={type:'build_profile',disabled_classes:disabledClasses,disabled_build_options:{
    disable_3d:request.dimensions==='2d',
    ...Object.fromEntries(disabledModules.map(name=>['module_'+name+'_enabled',false])),
  }};
  const profileText=JSON.stringify(profile,null,2)+'\n';
  return {
    schema:'wxslim-custom-wasm-plan-result-v1',status:'PLAN_ONLY_UNBUILT_UNREGISTERED',
    sourceCommit:source.source.commit,sourceRecipe:'official-c050-capability-24',sourcePlanSha256:source.planSha256,
    sourceFiles:source.finalOutputs,assembly:source.assembly,library:source.library,toolchain:source.toolchain,
    requested:request,profile,profileText,profileSha256:createHash('sha256').update(profileText).digest('hex'),
    sconsArgumentTemplate:source.argumentTemplate.map(a=>a.startsWith('build_profile=')?'build_profile=<CUSTOM_PROFILE_SNAPSHOT>':a),
    parameterChanges:['build_profile content only; no library, toolchain, GLX, exception, optimisation or link-policy override'],
    impliedByFixedSource:request.dimensions==='2d'?['disable_navigation_3d=true','disable_physics_3d=true','disable_xr=true']:[],
    moduleUniverse:modules,moduleSelection:customModuleSelection({dimensions:request.dimensions,disabledModules}),
    warnings:[
      'Class names are syntax-checked only; class existence and dependencies require source/build/PCK audits.',
      'moduleSelection records expected implicit removals from fixed source rules; actual generated registration, compiler macros and class removal still require build audits.',
      'disable_3d does not remove the unconditional GLES3 default scene-shader bind in this fixed source.',
      'Dropping modules may invalidate storage/input/audio/network/resource capabilities; no existing acceptance is inherited.',
      'Do not modify old full/conservative policy or replace registered hashes to make this plan pass.',
    ],
    next:['Review source/feature dependencies and approve build directory/resources.',
      'Materialize the exact source recipe including generated sources; use the proposed feature profile in a separately audited build.',
      'Capture raw paired JS/WASM/symbols, audit exports/imports and actual modules, derive JS once from raw output.',
      'Register a new audited pair and postprocess mapping before the fixed official conversion executor will accept it.',
      'Export a compatible PCK and run device GLX acceptance; use a pure 2D fixture for the 2D profile.'],
    buildExecuted:false,converterAccepted:false,executionSupported:false,executionAuthorized:false,workCreated:false,phone:'NOT_RUN',performance:'NOT_MEASURED',
  };
}

// Shared by the standalone entry and wxslim engine custom-plan. Never writes a
// profile, claims an output directory, or delegates to a build executor.
export function readCustomWasmPlan(file) {
  assert(typeof file==='string'&&file.length>0,'CUSTOM_WASM_CONFIG_PATH');
  const stat=fs.lstatSync(file);
  assert(stat.isFile()&&!stat.isSymbolicLink(),'CUSTOM_WASM_CONFIG_REGULAR_FILE');
  assert(stat.size<=128*1024,'CUSTOM_WASM_CONFIG_SIZE');
  const bytes=fs.readFileSync(file);assert(bytes.length<=128*1024,'CUSTOM_WASM_CONFIG_SIZE');
  return planCustomWasm(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assert(process.argv.length===4&&process.argv[2]==='--config','Usage: node engine/custom-wasm-plan.mjs --config <json>');
    console.log(JSON.stringify(readCustomWasmPlan(process.argv[3]),null,2));
  }catch(e){console.error(String(e));process.exitCode=1;}
}
