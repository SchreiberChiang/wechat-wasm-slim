// Recheck only the reviewed compiler output from this one stopped task.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {auditOfficialCapabilityPostbuildSource} from './official-capability-source-runtime.mjs';
import {planOfficialCapabilitySources} from './official-capability-source-plan.mjs';
import {auditOfficialModuleBuffers} from './official-module-audit.mjs';
import {auditCustomBuildEvidence} from './custom-build-evidence.mjs';
import {inspectOfficialRawArtifacts} from './official-raw-artifacts.mjs';

export const retainedConservativeTask = 'c2b24a6b-c948-4af4-abc1-e72de2faad07';
const anchors = {
  'BUILD.json':'dadaf158b0aba03e93e72d296781aa3e1389c4760a4c80420ee394589a43e40b',
  'terminal.json':'7494abb7732f620560adf954721540db54a94e0ab2d2b5f4f54e104ebe20a387',
  'events.jsonl':'006c6be1aaba7db62c67966d8d71045fa2402526271512db8de67c989275f4d7',
  'engine/.scons_env.json':'049580cfd565466505d33a4b6fa804f1c67e026b81cf8058eee8038a4a8d9a98',
  'engine/.sconsign5.dblite':'b8974c4a75465483fdb0213d23de8b94cbc8942688276ad3ba17ee38880d4536',
  '../inputs/postbuild-dependency-audit.json':'0cd2aa0130be6935e9cc012b0a73e82885a2da44ed4d2932f0c25e67b7db51de',
  '../inputs/conservative-final-link-argv.txt':'20d534ac83a927f8eb042f3455cdba7eb7050156fd39f048e7af11c2dde1f943'
};
const wanted = {js:'ecd50c02046b2b018e111dac752ba66e592c1c8d92dab9a1c6dfbcdbc4e7d681',
  wasm:'99dbe672e48c2847eae2c5a3e553b8f8594b949ff57c93da103713ba2d224915',
  symbols:'775dd185185df83c1e2f72dfa1c383f4f409d4939ab51d1aa1b10ea8659fb185'};
const pin = b => ({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});

export async function auditRetainedConservativeBuild(root) {
  const read = n => {
    const file=path.resolve(root,n),s=fs.lstatSync(file);
    assert(s.isFile() && path.relative(file,fs.realpathSync(file))==='' && s.size<=256*1024*1024,'RETAINED_REGULAR_FILE');
    return fs.readFileSync(file);
  };
  const json = n => JSON.parse(read(n));
  const recheck = () => {for(const [n,h] of Object.entries(anchors)) assert.equal(pin(read(n)).sha256,h,n);};
  recheck();
  const build=json('BUILD.json'), t=json('terminal.json'), owner=json('TASK.json'), cmd=build.commands.at(-1);
  for (const r of [build,t,owner]) assert.equal(r.taskId,retainedConservativeTask);
  assert.equal(path.relative(root,build.plan.work),'');assert.equal(path.relative(path.join(root,'engine'),build.plan.source),'');
  assert.equal(owner.recipeId,'official-raw:'+build.plan.planSha256);
  assert.equal(t.status,'FAILED');assert.equal(t.details.artifactState,'RAW_NOT_CAPTURED');assert.equal(t.details.admission,'NOT_ADMITTED');
  assert.deepEqual(t.details.build,pin(read('BUILD.json')));assert.equal(build.failure.code,'RAW_RESOURCE_PRESSURE');
  assert.equal(build.capture,undefined);assert.equal(build.attempts,1);
  assert.equal(build.plan.request.profile,'conservative');assert.equal(build.plan.sourceRecipe,'official-c050-capability-24');
  assert.equal(build.plan.sourcePlanSha256,planOfficialCapabilitySources({profile:'conservative'}).planSha256);
  assert.equal(cmd.stage,'COMPILE');assert(cmd.result.closed && cmd.result.exitCode===0 && !cmd.result.signal);
  assert.deepEqual(cmd.args,['-m','SCons',...build.plan.sconsArgs]);
  assert.deepEqual(json('evidence/command-007.json'),cmd);
  for(const c of build.commands)for(const key of ['stdout','stderr'])assert.deepEqual(pin(read(c[key])),c[key+'Identity']);
  for(const s of build.snapshots) assert.deepEqual(pin(read(s.path)),{bytes:s.bytes,sha256:s.sha256});
  assert.deepEqual(pin(read('evidence/prepared-manifest.json')),build.baselineFile);
  assert.deepEqual(pin(read('evidence/materialization.json')),build.materializationFile);
  assert.deepEqual(json('../inputs/postbuild-dependency-audit.json'),build.dependenciesPrecompile);
  const lib=path.join(root,'inputs','libemscriptenglx.a'),link=read('../inputs/conservative-final-link-argv.txt').toString();
  assert.equal(pin(read('inputs/libemscriptenglx.a')).sha256,'026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8');
  assert(link.includes(lib)&&link.includes('--thinlto-jobs=8')&&link.includes('--emit-symbol-map'));
  const tree=await auditOfficialCapabilityPostbuildSource({source:build.plan.source,baseline:json('evidence/prepared-manifest.json')});
  const modules=auditOfficialModuleBuffers({profile:'conservative',enabledHeader:read('engine/modules/modules_enabled.gen.h'),
    registration:read('engine/modules/register_module_types.gen.cpp')});
  const features={schema:'wxslim-custom-wasm-plan-v1',dimensions:'3d',disabledModules:['gltf','fbx','vhacd','webxr','mobile_vr','enet','upnp'],disabledClasses:[]};
  const names=build.retainedRaw.names;
  const inventory=auditCustomBuildEvidence({features,observed:tree.observed,environmentBytes:read('engine/.scons_env.json'),
    expectedProfile:build.plan.profile,programSuffix:names.progSuffix});
  assert.equal(inventory.physicalManifest.sha256,'e3c26916a65688bef1443357f407226c1c7b417846256d6c14b20bad41812f12');
  const bytes={},outputs={};
  for(const [key,logical] of Object.entries({js:'godot.raw.js',wasm:'godot.wasm',symbols:'godot.js.symbols'})){
    bytes[key]=read('engine/bin/'+names[key]);outputs[logical]=pin(bytes[key]);assert.equal(outputs[logical].sha256,wanted[key]);
  }
  const inspected=inspectOfficialRawArtifacts({...bytes,compilerStdout:read(cmd.stdout),compilerStderr:read(cmd.stderr)});
  assert(!inspected.issues.length && inspected.wasm.staticallyValidated);
  recheck();
  return {status:'RETAINED_FIXED_SOURCE_RECHECKED_NOT_ADMITTED',taskId:retainedConservativeTask,build:t.details.build,
    sourceCommit:build.plan.sourceCommit,sourceRecipe:build.plan.sourceRecipe,profile:'conservative',outputs,inPlace:names,recheck,
    retained:{originalTerminal:'FAILED',originalArtifactState:'RAW_NOT_CAPTURED',compilerExit:0,reason:build.failure.code,
      sourceFiles:tree.checkedSourceFiles,enabledModules:modules.enabledModules,objects:inventory.objectCount,archives:inventory.archiveCount,
      imports:inspected.wasm.imports.length,exports:inspected.wasm.exports.length,anchors}};
}
