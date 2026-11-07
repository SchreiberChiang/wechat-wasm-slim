// Development provenance for the independently reviewed 2D compiler output.
// A failed task may enter this route only with this exact record and payload.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {auditOfficialCapabilityPostbuildSource} from './official-capability-source-runtime.mjs';
import {customRawSourcePlan} from './official-custom-source-plan.mjs';
import {auditCustomGeneratedFeatures} from './custom-feature-audit.mjs';
import {auditCustomBuildEvidence} from './custom-build-evidence.mjs';
import {inspectOfficialRawArtifacts} from './official-raw-artifacts.mjs';

export const retainedTaskId='afff8268-4e8f-4335-a96b-42593411cd1a';
export const retainedProvenance='FAILED_CUSTOM_RAW_RETAINED_BYTES_RECHECKED';
const stem='godot.web.template_release.wasm32.nothreads';
const outputs={
 js:{name:stem+'.js',bytes:423868,sha256:'8f2a34f7a7be2ff6decf1a7d8c2aca1f62ecc8d3f395b48590d2a28f00246abe'},
 wasm:{name:stem+'.wasm',bytes:52243631,sha256:'4585d1710ac4b942fb0305073c7b9a925f90a429ff4a74294ddc7775cd0fd2e4'},
 symbols:{name:stem+'.js.symbols',bytes:841899,sha256:'412440b4321c9e9b1a241fefa0ae71ecda74cffeb0fefcbb3ecc4923c1245203'}
};
const anchors={
 'BUILD.json':'666c30413f18129cdc3116e9b7ba32a151a4841b4f3f7683402ae3051abf563f',
 'terminal.json':'08d72821c64261c1747d1a654c7346cf109ebf396ed1b507a4de050dd6ab4393',
 'events.jsonl':'26dd8a7d68b7e3eab8c14ca384693a2124e3b474dd12f8f147af88204e1cad91',
 'engine/.sconsign5.dblite':'28e1c9928b28606e75356052e0384e6384c31bca8d2255cff7c004461d2614ac',
 'engine/.scons_env.json':'f09010feb70d441559d3cf005fc431eec4d170190d2f3ef110317d36ef98aa34'
};
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});

export async function auditRetainedCustom2dSource(work,regular){
 const read=rel=>regular(path.join(work,rel),256*1024*1024,rel.startsWith('logs/'));
 const checkAnchors=()=>{for(const [name,sha] of Object.entries(anchors))assert.equal(pin(read(name)).sha256,sha,'RETAINED_RECORD '+name);};
 checkAnchors();
 const build=JSON.parse(read('BUILD.json')),terminal=JSON.parse(read('terminal.json')),owner=JSON.parse(read('TASK.json'));
 assert.equal(build.taskId,retainedTaskId);assert.equal(terminal.taskId,retainedTaskId);assert.equal(owner.taskId,retainedTaskId);
 assert.equal(owner.recipeId,'official-raw:'+build.plan.planSha256);
 assert.equal(path.resolve(work),path.resolve(build.plan.work));assert.equal(path.resolve(work,'engine'),path.resolve(build.plan.source));
 assert.equal(terminal.status,'FAILED');assert.equal(terminal.details.artifactState,'RAW_NOT_CAPTURED');
 assert.deepEqual(terminal.details.build,pin(read('BUILD.json')));assert.equal(build.capture,undefined);
 const compile=build.commands.at(-1);assert.equal(compile.stage,'COMPILE');assert.equal(compile.result.closed,true);assert.equal(compile.result.exitCode,0);
 assert.deepEqual(JSON.parse(read('evidence/command-007.json')),compile);
 for(const s of build.snapshots)assert.deepEqual(pin(read(s.path)),{bytes:s.bytes,sha256:s.sha256},s.path);
 for(const c of build.commands)for(const channel of ['stdout','stderr'])assert.deepEqual(pin(read(c[channel])),c[channel+'Identity']);
 const baseline=read('evidence/prepared-manifest.json');assert.deepEqual(pin(baseline),build.baselineFile);
 assert.deepEqual(pin(read('evidence/materialization.json')),build.materializationFile);
 const plan=customRawSourcePlan(build.plan.request),features=plan.features;
 assert.equal(plan.planSha256,build.plan.sourcePlanSha256);assert.deepEqual(pin(read('inputs/profile.gdbuild')),{bytes:plan.selectedProfile.bytes,sha256:plan.selectedProfile.sha256});
 const tree=await auditOfficialCapabilityPostbuildSource({source:build.plan.source,baseline:JSON.parse(baseline)});
 const generated=auditCustomGeneratedFeatures({features,enabledHeader:read('engine/modules/modules_enabled.gen.h'),
  registration:read('engine/modules/register_module_types.gen.cpp'),disabledClassesHeader:read('engine/core/disabled_classes.gen.h')});
 const inventory=auditCustomBuildEvidence({features,observed:tree.observed,environmentBytes:read('engine/.scons_env.json'),
  expectedProfile:build.plan.profile,programSuffix:build.retainedRaw.names.progSuffix});
 assert.equal(inventory.physicalManifest.sha256,'2cf033f0d0c6195d68f16afae8a568ac0aa0fca7320af3ce323041f71ca1854c');
 const raw={},names={},identities={};
 for(const [key,{name,bytes,sha256}] of Object.entries(outputs)){
  names[key]=name;raw[key]=read('engine/bin/'+name);identities[name]={bytes,sha256};
  assert.deepEqual(pin(raw[key]),identities[name],'RETAINED_OUTPUT '+name);
 }
 const inspection=inspectOfficialRawArtifacts({...raw,compilerStdout:read(compile.stdout),compilerStderr:read(compile.stderr)});
 assert.equal(inspection.issues.length,0);assert.equal(inspection.wasm.staticallyValidated,true);
 checkAnchors();
 return {root:path.join(work,'engine/bin'),names,outputs:identities,build:terminal.details.build,
  evidence:{sourceCommit:plan.source.commit,sourceRecipe:build.plan.sourceRecipe,sourcePlanSha256:plan.planSha256,features,selectedProfile:plan.selectedProfile},
  record:{taskId:retainedTaskId,originalTerminal:'FAILED',originalArtifactState:'RAW_NOT_CAPTURED',originalAdmission:'NOT_ADMITTED',
   failure:build.failure.code,compilerExit:compile.result.exitCode,anchors,baseline:build.baselineFile,sourceFiles:tree.checkedSourceFiles,
   generatedFeatures:generated.status,enabledModules:generated.modules.selection.expectedModules,
   inventory:inventory.physicalManifest,objects:inventory.objectCount,archives:inventory.archiveCount,
   library:pin(read('inputs/libemscriptenglx.a')),inputs:outputs,imports:inspection.wasm.imports.length,exports:inspection.wasm.exports.length,
   linkEvidence:'SCons content signatures and recorded link flags; expanded linker arguments and member map unavailable'},
  recheck:checkAnchors};
}
