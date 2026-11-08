import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {auditCompletedOfficialRawBuild} from './official-build-raw.mjs';
import {planOfficialBuild} from './official-build-plan.mjs';
import {proposeCustomRawHost} from './custom-host-bindings.mjs';
import {retainedConservativeTask,auditRetainedConservativeBuild} from './retained-conservative-capability.mjs';

export const REBUILT_PAIR_SCHEMA = 'wxslim-rebuilt-capability-pair-v1';
const pin = bytes => ({bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')});
const limit = 1024 * 1024;

function read(file, maximum) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.size > 0 && stat.size <= maximum && path.relative(file,fs.realpathSync(file)) === '', 'REBUILT_PAIR_FILE');
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  assert(bytes.length === stat.size && ['dev','ino','mtimeMs','ctimeMs','size'].every(k=>stat[k] === after[k]), 'REBUILT_PAIR_CHANGED');
  return bytes;
}

async function derive(file) {
  file = path.resolve(file);
  const configBytes = read(file, 64 * 1024);
  const cfg = JSON.parse(configBytes);
  assert.deepEqual(Object.keys(cfg).sort(), ['schema','rawTaskRoot','rawTaskId','outputJs','receipt'].sort());
  assert.equal(cfg.schema,REBUILT_PAIR_SCHEMA);
  assert.match(cfg.rawTaskId,/^[a-f0-9-]{36}$/);
  for (const k of ['rawTaskRoot','outputJs','receipt']) {
    assert(typeof cfg[k] === 'string' && cfg[k].trim() && !/[\0\r\n]/.test(cfg[k]), 'REBUILT_PAIR_PATH');
    cfg[k] = path.resolve(path.dirname(file), cfg[k]);
    if (process.platform === 'win32') {
      const segments = cfg[k].slice(path.parse(cfg[k]).root.length).split(path.sep);
      assert(segments.every(n => n && !/[<>:"|?*]/.test(n) && !/[. ]$/.test(n) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n)), 'REBUILT_PAIR_WINDOWS_PATH');
    }
  }
  const outputParent = path.dirname(cfg.outputJs);
  assert.equal(path.relative(outputParent,path.dirname(cfg.receipt)),'','REBUILT_PAIR_OUTPUT_PARENT');
  assert.equal(path.relative(outputParent,fs.realpathSync(outputParent)),'','REBUILT_PAIR_OUTPUT_LINK');
  const distinct = [file,cfg.outputJs,cfg.receipt];
  assert.equal(new Set(distinct.map(f=>process.platform==='win32'?f.toLowerCase():f)).size,3,'REBUILT_PAIR_COLLISION');
  const relative = path.relative(cfg.rawTaskRoot,outputParent);
  assert(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep),'REBUILT_PAIR_PROTECT_RAW_TREE');
  const retained = cfg.rawTaskId === retainedConservativeTask;
  const audit = retained ? await auditRetainedConservativeBuild(cfg.rawTaskRoot) : await auditCompletedOfficialRawBuild(cfg.rawTaskRoot,cfg.rawTaskId);
  assert.equal(audit.status,retained?'RETAINED_FIXED_SOURCE_RECHECKED_NOT_ADMITTED':'RAW_TASK_RECHECKED_NOT_ADMITTED');
  assert.equal(audit.sourceRecipe,'official-c050-capability-24');
  assert(['full','conservative'].includes(audit.profile));
  const buildFile = path.join(cfg.rawTaskRoot,'BUILD.json');
  const buildBytes = read(buildFile,32*limit);
  assert.deepEqual(pin(buildBytes),audit.build);
  const build = JSON.parse(buildBytes);
  const artifactDir = retained ? path.join(cfg.rawTaskRoot,'engine/bin') : build.plan.artifactRoot || path.join(cfg.rawTaskRoot,'artifacts');
  const jsFile = path.join(artifactDir,audit.inPlace?.js ?? 'godot.raw.js'), wasmFile = path.join(artifactDir,audit.inPlace?.wasm ?? 'godot.wasm');
  const rawJs = read(jsFile,4*limit), rawWasm = read(wasmFile,256*limit);
  assert.deepEqual(pin(rawJs),audit.outputs['godot.raw.js']);
  assert.deepEqual(pin(rawWasm),audit.outputs['godot.wasm']);
  const proposed = proposeCustomRawHost({js:rawJs,wasm:rawWasm});
  const selectedProfile = planOfficialBuild({profile:audit.profile}).selectedProfile;
  const features = {schema:'wxslim-custom-wasm-plan-v1',dimensions:'3d',disabledClasses:[],disabledModules:selectedProfile.disabledModules};
  const inputs = {js:pin(rawJs),wasm:pin(rawWasm),symbols:audit.outputs['godot.js.symbols']};
  const summary = {schema:'wxslim-rebuilt-capability-pair-source-v1', taskId:audit.taskId, build:audit.build,
    sourceCommit:audit.sourceCommit, sourceRecipe:audit.sourceRecipe, sourcePlanSha256:build.plan.sourcePlanSha256,
    moduleProfile:audit.profile, features, selectedProfile, inputs, outputJs:pin(proposed.js), outputBridge:pin(proposed.bridge),
    derivation:proposed.receipt, ...(retained?{retainedFixed:audit.retained}:{}), admission:'NOT_ADMITTED', runtime:'NOT_RUN'};
  const receipt = {schema:'wxslim-rebuilt-capability-pair-result-v1',status:'PREPARED_NOT_ADMITTED',configuration:pin(configBytes),
    taskId:audit.taskId,build:audit.build,sourceCommit:audit.sourceCommit,sourcePlanSha256:summary.sourcePlanSha256,
    moduleProfile:audit.profile,features,inputs,outputJs:summary.outputJs,outputBridge:summary.outputBridge,
    rules:proposed.receipt.edits,hostContract:proposed.receipt.hostProposal.sourceContract,...(retained?{retainedFixed:audit.retained}:{}),wasmCopied:false,runtime:'NOT_RUN'};
  const recheckInputs = () => {
    audit.recheck?.();
    assert(read(file,64*1024).equals(configBytes));
    assert.deepEqual(pin(read(buildFile,32*limit)),audit.build);
    assert.deepEqual(pin(read(jsFile,4*limit)),inputs.js);
    assert.deepEqual(pin(read(wasmFile,256*limit)),inputs.wasm);
  };
  recheckInputs();
  return {cfg,summary,receipt,js:proposed.js,bridge:proposed.bridge,recheckInputs};
}

export async function prepareRebuiltCapabilityPair(file,write=false) {
  const s = await derive(file);
  assert(!fs.existsSync(s.cfg.outputJs) && !fs.existsSync(s.cfg.receipt),'REBUILT_PAIR_OUTPUT_EXISTS');
  if (!write) return {...s.receipt,status:'CHECKED_NOT_WRITTEN'};
  assert.equal(write,true);
  fs.writeFileSync(s.cfg.outputJs,s.js,{flag:'wx',flush:true});
  assert.deepEqual(pin(read(s.cfg.outputJs,4*limit)),s.receipt.outputJs);
  s.recheckInputs();
  fs.writeFileSync(s.cfg.receipt,JSON.stringify(s.receipt,null,2)+'\n',{flag:'wx',flush:true});
  assert.deepEqual(JSON.parse(read(s.cfg.receipt,limit)),s.receipt);
  return s.receipt;
}

export async function readRebuiltCapabilityPair(file) {
  const s = await derive(file);
  const receiptBytes = read(s.cfg.receipt,limit);
  assert.deepEqual(JSON.parse(receiptBytes),s.receipt);
  const recheck = () => {
    s.recheckInputs();
    assert(read(s.cfg.receipt,limit).equals(receiptBytes));
    assert(read(s.cfg.outputJs,4*limit).equals(s.js));
  };
  recheck();
  return {summary:s.summary,js:s.js,bridge:s.bridge,preparation:{configuration:s.receipt.configuration,receipt:pin(receiptBytes)},recheck};
}
