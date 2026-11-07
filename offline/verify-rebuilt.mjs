import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareRebuiltCapabilityPair, REBUILT_PAIR_SCHEMA} from '../engine/rebuilt-capability-pair.mjs';
import {prepareCustomPairTask, executeCustomPairTask, CUSTOM_PAIR_CONFIG, CUSTOM_PAIR_PROFILE} from '../lib/custom-pair-task.mjs';
import {planCustomProjectUsage} from '../convert/lib/custom-project-usage.mjs';
import {readPreparedSource} from '../convert/lib/official-custom-context.mjs';

const [recipe, rawArg, pckArg, workArg, confirmation, example, ...extra] = process.argv.slice(2);
assert(['full','conservative','pure-2d'].includes(recipe) && rawArg && pckArg && workArg &&
  confirmation === '--confirm-game-features' && (example === undefined || example === '--verify-example-edit') && !extra.length,
  'Usage: node offline/verify-rebuilt.mjs full|conservative|pure-2d RAW_TASK STARTUP.pck NEW_WORK --confirm-game-features [--verify-example-edit]');
const source = fileURLToPath(new URL('../',import.meta.url));
const raw = fs.realpathSync(rawArg), pck = fs.realpathSync(pckArg);
const work = path.resolve(workArg);
function within(base, item) {
  const rel = path.relative(base,item);
  return !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);
}
for(const input of [source,raw,pck]) assert(!within(work,input) && !within(input,work),'Keep outputs separate from inputs');
assert.equal(path.relative(fs.realpathSync(path.dirname(work)),path.dirname(work)),'');
const load = file => JSON.parse(fs.readFileSync(file,'utf8'));
const save = (name,value) => fs.writeFileSync(path.join(work,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const terminal = load(path.join(raw,'terminal.json'));
assert.equal(terminal.status,'SUCCESS','Completed successful raw build required');
const build = load(path.join(raw,'BUILD.json'));
assert.equal(build.plan.request.profile,recipe==='pure-2d'?'custom':recipe);
fs.mkdirSync(work);
const custom = recipe === 'pure-2d';
const file = path.join(work,'preparation.json');
save('preparation.json',{schema:custom?CUSTOM_PAIR_CONFIG:REBUILT_PAIR_SCHEMA,rawTaskRoot:raw,rawTaskId:terminal.taskId,
  outputJs:'godot.prepared.js',receipt:'preparation-receipt.json'});
if(custom){
  const {input,before} = await prepareCustomPairTask(file);
  const result = await executeCustomPairTask(input,before,{writeAuthorized:true});
  assert.equal(result.status,'SUCCESS');
}else{
  await prepareRebuiltCapabilityPair(file,true);
}
const prepared = await readPreparedSource(file);
assert.equal(prepared.summary.taskId,terminal.taskId);
const features = prepared.summary.features;
assert.equal(features.dimensions,custom?'2d':'3d');
const usage = planCustomProjectUsage(features,fs.readFileSync(pck));
const wasm = path.join(build.plan.artifactRoot || path.join(raw,'artifacts'),'godot.wasm');
const digest = b => createHash('sha256').update(b).digest('hex');
const rebuiltWasm = fs.readFileSync(wasm);
assert.equal(digest(rebuiltWasm),prepared.summary.inputs.wasm.sha256);
let sourceEdit;
if (example) {
  const originalText = 'GODOT_WECHAT_LIFECYCLE_MAIN_LOOP_NOT_READY';
  const editedText = originalText + ': notification skipped';
  const lock = load(path.join(source,'packaging/vendor-lock.json'));
  const relative = lock.pairs[recipe].wasm;
  const original = fs.readFileSync(path.join(source,'offline/vendor',relative));
  const originalSha256 = digest(original);
  assert.deepEqual({bytes:original.length, sha256:originalSha256}, lock.files[relative]);
  assert.notEqual(originalSha256, prepared.summary.inputs.wasm.sha256, 'Rebuilt WASM matches the historical WASM');
  for (const [bytes, expected, excluded] of [[original,originalText,editedText], [rebuiltWasm,editedText,originalText]]) {
    assert(bytes.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])));
    assert(bytes.includes(Buffer.from(expected+'\0')) && !bytes.includes(Buffer.from(excluded+'\0')),
      'Expected a distinct compiled diagnostic in each WASM');
  }
  const cpp = 'platform/web/display_server_web.cpp';
  const preparedCpp = fs.readFileSync(path.join(build.plan.source,cpp));
  const exampleCppSha256 = '5106bed52d17bacba8b8b0d3e5ce498e4cc4cd598ea986ae0fea38f8108aec56';
  assert.equal(digest(preparedCpp),exampleCppSha256,'The materialized C++ source differs from the example patch');
  assert(preparedCpp.includes(Buffer.from('WARN_PRINT_ONCE("'+editedText+'");')));
  sourceEdit = {cpp,cppSha256:exampleCppSha256,originalWasmSha256:originalSha256,
    rebuiltWasmSha256:prepared.summary.inputs.wasm.sha256,compiledDiagnostic:editedText};
}
await prepared.recheck();
const output = path.join(work,'wechat');
save('convert.json',{schema:'wxslim-official-inputs-v1',engineProfile:CUSTOM_PAIR_PROFILE,
  js:path.join(work,'godot.prepared.js'),wasm,pck,transformer:path.join(source,'offline/vendor/tools/wx-transformer-v1.0.35-win.exe'),
  interfaces:path.join(source,'convert/assets/simple-delivery-interface.js'),output,renderMode:'glx',locale:'zh_CN',orientation:'portrait',
  name:'GLX-'+recipe,customPreparation:file,projectUsage:{...usage.declaration,removedFeaturesUnused:true}});
const entry = path.join(source,'convert/official.mjs');
function run(step,args){
  const result = spawnSync(process.execPath,[entry,...args],{cwd:work,encoding:'utf8',windowsHide:true,maxBuffer:64*2**20});
  for(const key of ['stdout','stderr']) fs.writeFileSync(path.join(work,step+'.'+key),result[key]||'',{flag:'wx'});
  if(result.error)throw result.error;
  assert.equal(result.status,0,step+' failed. See '+path.join(work,step+'.stderr'));
  return JSON.parse(result.stdout);
}
const execution = run('conversion',['execute',path.join(work,'convert.json'),'--write']);
assert.equal(execution.status,'SUCCESS');
const game = path.join(output,'converted/minigame');
const review = run('pair-review',['custom-output-audit',file,game]);
assert.equal(review.status,'PASS_SOURCE_STATIC_ONLY');
assert(review.sourceBuildReaudited && review.sevenRulesPreserved && review.hostBridgeExact);
const audit = load(path.join(output,'AUDIT.json'));
for(const entry of audit.files){
  const file = path.resolve(game,entry.path);
  assert(within(game,file) && path.relative(fs.realpathSync(file),file)==='');
  assert.equal(digest(fs.readFileSync(file)),entry.sha256,entry.path);
}
const summary = {recipe,rawTaskId:terminal.taskId,wasm:prepared.summary.inputs.wasm,packageId:audit.packageId,
  files:audit.files.length,pck:usage.declaration.pck,sourceAudit:review.status,...(sourceEdit ? {sourceEdit} : {}),runtime:'NOT_RUN'};
save('result.json',summary);
console.log(JSON.stringify(summary));

