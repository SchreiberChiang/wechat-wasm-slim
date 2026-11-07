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

const [recipe, rawArg, pckArg, workArg, confirmation, ...extra] = process.argv.slice(2);
assert(['full','conservative','pure-2d'].includes(recipe) && rawArg && pckArg && workArg &&
  confirmation === '--confirm-game-features' && !extra.length,
  'Usage: node offline/verify-rebuilt.mjs full|conservative|pure-2d RAW_TASK STARTUP.pck NEW_WORK --confirm-game-features');
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
assert.equal(digest(fs.readFileSync(wasm)),prepared.summary.inputs.wasm.sha256);
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
  files:audit.files.length,pck:usage.declaration.pck,sourceAudit:review.status,runtime:'NOT_RUN'};
save('result.json',summary);
console.log(JSON.stringify(summary));

