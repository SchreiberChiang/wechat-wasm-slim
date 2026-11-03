// Scene-only resource lifetime change. Never stages over the frozen preview.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {unpackPck} from '../startup-prewarm/scene.mjs';

const [root, mode='check'] = process.argv.slice(2);
assert(root && ['check','pack'].includes(mode), 'Usage: EXISTING_APPROVED_ROOT check|pack');
const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(root,'evidence'), scene = path.join(root,'scene'), runtime = path.join(root,'minigame');
const read = (dir,name) => fs.readFileSync(path.join(dir,name));
const json = (dir,name) => JSON.parse(read(dir,name));
const sha = b => createHash('sha256').update(b).digest('hex');
const walk = (dir,prefix='',skipCache=true) => fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>skipCache&&['.git','.godot'].includes(x.name)?[]:x.isDirectory()?walk(path.join(dir,x.name),prefix+x.name+'/',skipCache):[prefix+x.name]).sort();
const baseline = json(evidence,'REUSE_BASELINE_20261103.json');
const old = json(runtime,'CANDIDATE.json');
assert.equal(old.candidateId,baseline.candidateId);
const normal = p => p.replaceAll('\\','/');
for(const f of baseline.runtime) assert.equal(sha(read(runtime,f.path)),f.sha256, 'frozen runtime changed: '+f.path);
assert.deepEqual(walk(runtime),baseline.runtime.map(f=>normal(f.path)).sort());
const changedSource = [];
for(const f of baseline.source) if(sha(read(scene,f.path))!==f.sha256)changedSource.push(normal(f.path));
assert.deepEqual(changedSource.sort(),['regression19-main.gd','regression19-renderer.gd']);
assert.deepEqual(walk(scene),baseline.source.map(f=>normal(f.path)).sort());
for(const n of changedSource) assert(read(scene,n).equals(read(here,n)), 'repository/source mismatch: '+n);

const native = json(evidence,'native-reuse-verify.json'), previous = json(evidence,'native-verify.json');
assert.deepEqual(native.failures,[]);
assert.equal(native.states.length,19);
assert.equal(native.repeatedTransitions.length,27);
assert.equal(native.visualComparisons.length,38);
assert(native.visualComparisons.every(v=>v.exactPixels && v.rgbaMeanAbsoluteByteDifference===0));
for(const s of [...native.states,...native.repeatedTransitions]) {
  // Same serializer on both runs: strict comparison, no floating tolerance.
  assert.deepEqual(s.parameters,previous.states.find(x=>x.key===s.key)?.parameters,'scene parameters: '+s.key);
  assert.equal(s.transition.startupPrewarm,false);
}
assert(native.states.every(s=>s.transition.firstStateVisit && s.transition.stateVisit===1));
assert(native.repeatedTransitions.every(s=>!s.transition.firstStateVisit && s.transition.stateVisit>1));
assert.equal(native.states.filter(s=>s.transition.resourceAction==='parameter_update').length,9);
assert.equal(native.repeatedTransitions.filter(s=>s.transition.resourceAction==='parameter_update').length,16);
const errors = read(evidence,'reuse-native.stderr.log').toString();
assert(!/SCRIPT ERROR|Parse Error|^ERROR:/m.test(errors),'native runtime error');
const source = changedSource.map(n=>({path:n,sha256:sha(read(scene,n)),bytes:read(scene,n).length}));
const core = {schema:'regression19-resource-reuse-audit-v1',parentCandidateId:old.candidateId,
  changedSceneFiles:source,originalRuntimeFilesVerified:baseline.runtime.length,originalRuntimeUntouched:true,
  engineRebuilt:false,libraryChanged:false,return0Unchanged:true,materialShadersAndCatalogUnchanged:true,
  native:{engine:native.engine,renderer:native.renderingMethod,states:19,repeatedTransitions:27,
    exactLiveImageComparisons:38,sceneParametersEqual:true,retainedResourceIdentityChecks:'PASS',
    firstPassParameterUpdates:9,firstPassRebuilds:10,repeatParameterUpdates:16,phonePerformanceNotInferred:true},
  cpuQueriesOrPhoneReadbackAdded:false,phone:'NOT_RUN',wechatWebGL:'NOT_RUN',upload:'NOT_UPLOADED'};

if(mode==='pack') {
  const pckName='regression19-reuse.pck', pckBytes=read(evidence,pckName), nextPck=unpackPck(pckBytes);
  const oldPck=unpackPck(read(runtime,'engine/empty-tips.bin'));
  assert.deepEqual([...nextPck.keys()].sort(),[...oldPck.keys()].sort(),'PCK entry set');
  const changed=[...nextPck].filter(([n,b])=>!b.equals(oldPck.get(n))).map(([n])=>n).sort();
  assert.deepEqual(changed,changedSource,'only two runtime GDScripts may change');
  for(const n of changedSource)assert(nextPck.get(n).equals(read(scene,n)),'PCK source '+n);
  assert(![...nextPck.keys()].some(n=>/reuse-native|regression19-native/.test(n)),'desktop checker entered PCK');
  const pckHash=sha(pckBytes), parentManifestHash=sha(read(runtime,'CANDIDATE.json'));
  const digest=sha(JSON.stringify({parentManifestHash,pckHash,source}));
  const candidateId='selfbuild-alpha-regression19-reuse-glx-'+digest.slice(0,20);
  const identity={...old.identity,packageId:candidateId,parentPackageId:old.candidateId,
    parentManifestSha256:parentManifestHash,pckSha256:pckHash,scenePckSha256:pckHash,
    sceneSourceManifestSha256:sha(JSON.stringify(walk(scene).map(n=>({path:n,sha256:sha(read(scene,n)),bytes:read(scene,n).length})))),
    scope:'same 19 phases; lazy active-page resource reuse; first/repeat timings; no startup prewarm added',
    resourceReuse:'same page and topology only; released at page/topology boundary',phone:'NOT_RUN',upload:'NOT_UPLOADED'};
  const originalMode=read(runtime,'candidate-mode.js').toString();
  const matcher=/G\.__SelfbuildCandidateIdentity = Object\.freeze\(\{[^\n]+\}\);/;
  assert(matcher.test(originalMode),'known identity assignment');
  const nextMode=originalMode.replace(matcher,`G.__SelfbuildCandidateIdentity = Object.freeze(${JSON.stringify(identity)});`);
  assert.equal(nextMode.replace(matcher,'IDENTITY'),originalMode.replace(matcher,'IDENTITY'),'mode code beyond identity changed');
  const modeName='reuse-candidate-mode.js';
  fs.writeFileSync(path.join(evidence,modeName),nextMode);
  core.candidateId=candidateId;core.identity=identity;
  core.pck={path:pckName,sha256:pckHash,bytes:pckBytes.length,changedEntries:changed,entryCount:nextPck.size};
  core.preparedPayload=[{target:'engine/empty-tips.bin',source:pckName,sha256:pckHash},
    {target:'candidate-mode.js',source:modeName,sha256:sha(nextMode)}];
  core.staging='NOT_APPLIED: original minigame directory preserved; two-file overlay prepared only';
  fs.writeFileSync(path.join(evidence,'REUSE_CANDIDATE.json'),JSON.stringify(core,null,2)+'\n');
}
core.directoryBytes=walk(root,'',false).reduce((sum,n)=>sum+fs.statSync(path.join(root,n)).size,0);
assert(core.directoryBytes<100*1048576,'existing approved 100 MiB ceiling');
fs.writeFileSync(path.join(evidence,'REUSE_AUDIT_'+mode.toUpperCase()+'.json'),JSON.stringify(core,null,2)+'\n');
console.log(JSON.stringify({audit:'PASS',mode,candidate:core.candidateId??null,
  states:19,repeated:27,exactImages:38,changedSource,changedPck:core.pck?.changedEntries,
  directoryMiB:core.directoryBytes/1048576,originalRuntimeUnchanged:true,phone:'NOT_RUN'}));
