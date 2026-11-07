// Owned official conversion only. No compiler, upload, device or shared toolchain mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {sha} from './lib/inputs.mjs';
import {PLACEHOLDER_APPID} from './lib/verify.mjs';
import {convertProject} from './lib/conversion-core.mjs';
import {runOwnedProcess} from './lib/owned-process.mjs';
import {createTask, measureTaskBytes, requestCancellation} from './lib/official-task.mjs';
import {checkOfficialInputs, conversionPlan, snapshotInputs, snapshotFileKeys, assertSnapshotUnchanged, auditOfficialOutput, publicCheckSummary} from './official.mjs';
import {getOfficialRecipe} from './lib/official-engine-admission.mjs';
import {customConversionContext} from './lib/official-custom-context.mjs';

function writeNew(file, value) {
  const fd=fs.openSync(file,'wx');
  try { fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function localError(e) { return {name:e.name,code:e.code||'OFFICIAL_EXECUTION_FAILED',message:e.message,stack:e.stack}; }
function within(root,file) { const rel=path.relative(root,file);return rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep); }

export async function executeOfficial(cfg, {writeAuthorized=false, expectedPreflight=null}={}) {
  assert.equal(writeAuthorized,true,'explicit authorization required before creating a task');
  const started=performance.now(), before=checkOfficialInputs(cfg);
  // A shared GUI/CLI admission must bind the inputs it assessed. Rechecking
  // only after conversion would be too late: a different candidate could run.
  assertExpectedPreflight(before,expectedPreflight);
  const plan=conversionPlan(cfg,before);
  const space=fs.statfsSync(path.dirname(cfg.output));
  assert(space.bavail*space.bsize > plan.budgetBytes+256*1024*1024,'insufficient free storage for bounded task plus reserve');
  const recipe=getOfficialRecipe(before.engineContract.profile);
  const custom=cfg.customPreparation ? customConversionContext() : null;
  if(custom) await custom.recheck();
  const task=createTask(cfg.output,{budgetBytes:plan.budgetBytes,recipeId:before.recipeId});
  let child=null, frozenCfg=null, stage='SNAPSHOT', stageStart=performance.now(), terminal=null;
  const stages=[];
  function checkpoint(next) {
    task.checkpoint(next);
    assertSnapshotUnchanged(before.snapshot,snapshotInputs(cfg));
    if(frozenCfg)assertSnapshotUnchanged(before.snapshot,snapshotInputs(frozenCfg));
    const now=performance.now();
    stages.push({stage,elapsedMs:Math.round((now-stageStart)*1000)/1000,logicalBytes:measureTaskBytes(task.root)});
    stage=next;stageStart=now;
    task.event({stage:next,status:'RUNNING'});
  }
  // Signals request cancellation, never kill a converter. A signal delivered by
  // the OS to the whole console group may separately reach the external process.
  const cancelSignal=()=>{try{requestCancellation(task.root,task.taskId);}catch(e){process.stderr.write('Cancellation request could not be saved; inspect task records.\n');}};
  process.on('SIGINT',cancelSignal);process.on('SIGTERM',cancelSignal);
  try {
    writeNew(path.join(task.root,'PLAN.private.json'),plan);
    writeNew(path.join(task.root,'PREFLIGHT.json'),publicCheckSummary(before));
    task.checkpoint('SNAPSHOT');
    const snapshotRoot=path.join(task.root,'inputs');fs.mkdirSync(snapshotRoot);
    const copied={};
    for(const key of snapshotFileKeys(cfg)) {
      const dir=path.join(snapshotRoot,key);fs.mkdirSync(dir);
      const target=path.join(dir,path.basename(cfg[key]));assert(within(task.root,target));
      fs.copyFileSync(cfg[key],target,fs.constants.COPYFILE_EXCL);
      const fd=fs.openSync(target,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const bytes=fs.readFileSync(target);
      assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},before.snapshot.files[key],'copied input differs: '+key);
      copied[key]=target;
    }
    frozenCfg={...cfg,...copied,output:path.join(task.root,'converted'),options:{...cfg.options},
      ...(cfg.projectUsage?{projectUsage:structuredClone(cfg.projectUsage)}:{})};
    const portable={schema:'wxslim-official-inputs-v1',...Object.fromEntries(Object.entries(copied).map(([key,file])=>[key,path.relative(task.root,file)])),
      ...(cfg.budgetBytes !== undefined ? {budgetBytes:cfg.budgetBytes} : {}),
      transformer:cfg.transformer,output:'converted',renderMode:cfg.options.renderMode,name:cfg.options.name,locale:cfg.options.locale,orientation:cfg.options.orientation,
      engineProfile:before.engineContract.profile,...(cfg.customPreparation?{customPreparation:path.relative(task.root,cfg.customPreparation)}:{}),
      ...(cfg.projectUsage?{projectUsage:structuredClone(cfg.projectUsage)}:{}),...(cfg.options.loginCode===true?{loginCode:true}:{})};
    writeNew(path.join(task.root,'inputs.private.json'),portable);
    const tc={transformer:cfg.transformer,transformerVersion:recipe.transformer.version,transformerSha256:recipe.transformer.sha256,plugin:{...recipe.plugin}};
    writeNew(path.join(task.root,'toolchain.private.json'),tc);
    checkpoint('READY');
    const output=await convertProject({tc,inp:{js:frozenCfg.js,wasm:frozenCfg.wasm,pck:frozenCfg.pck},out:frozenCfg.output,...cfg.options,
      engineContract:before.engineContract,...(custom?{projectUsage:before.projectUsage}:{}),
      interfaces:frozenCfg.interfaces,upstreamSource:frozenCfg.upstreamSource,appid:PLACEHOLDER_APPID,appidSource:'placeholder'}, {
      checkpoint,
      runTransformer:async options=>{
        checkpoint('CONVERTER_RUNNING');
        child=await runOwnedProcess({...options,observeAfterMs:600000,
          isCancellationRequested:()=>task.isCancellationRequested(),
          onEvent:event=>task.event({stage:'CONVERTER',status:event.type==='cancellation_requested'?'CANCEL_REQUESTED_WAITING_CHILD':event.type==='observation_timeout'?'OBSERVATION_TIMEOUT_WAITING_CHILD':'RUNNING',details:event}),
        });
        writeNew(path.join(task.root,'CHILD.json'),child);
        // The runner returns only after close and log persistence; no packaging
        // occurs for a cancelled/failed process, even if its exit code is zero.
        task.checkpoint('CONVERTER_CLOSED');
        if(child.outcome!=='SUCCESS')throw Object.assign(new Error('converter process or log persistence failed'),{code:'TRANSFORMER_FAILED'});
        return {status:child.status};
      },
    });
    checkpoint('AUDIT');
    const audit=auditOfficialOutput(frozenCfg,before);
    if(custom) await custom.recheck();
    assert.equal(output.rendering.packageVersion,before.expectedManifest.packageVersion,'planned identity differs from actual conversion');
    writeNew(path.join(task.root,'AUDIT.json'),audit);
    checkpoint('COMMIT');
    const auditSha256=sha(fs.readFileSync(path.join(task.root,'AUDIT.json')));
    stages.push({stage,elapsedMs:Math.round((performance.now()-stageStart)*1000)/1000,logicalBytes:measureTaskBytes(task.root)});
    terminal=task.finish('SUCCESS',{packageId:output.rendering.packageVersion,engineContract:before.engineContract,auditSha256,elapsedMs:Math.round(performance.now()-started),stages,
      childClosed:child?.closed===true,childOutcome:child?.outcome,logicalBytesBeforeReceipt:measureTaskBytes(task.root),
      candidate:'converted/minigame',inputSnapshot:'inputs',transformerCopied:false,sourceChangeChecks:'all checkpoints and final audit; no claim against adversarial filesystem mutation',
      conversion:'PASS',audit:'PASS_STATIC_ONLY',engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'});
  } catch(e) {
    // Preserve partial output and full local error (may contain local paths).
    // If writing these receipts fails, reject rather than manufacture SUCCESS.
    writeNew(path.join(task.root,'ERROR.private.json'),localError(e));
    terminal=task.finish(e.code==='TASK_CANCELLED'?'CANCELLED':'FAILED',{engineContract:before.engineContract,code:e.code||'OFFICIAL_EXECUTION_FAILED',elapsedMs:Math.round(performance.now()-started),stages,
      lastStage:stage,childClosed:child?.closed??null,childOutcome:child?.outcome??null,engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'});
  } finally {process.off('SIGINT',cancelSignal);process.off('SIGTERM',cancelSignal);}
  return {schema:'wxslim-official-execution-summary-v1',taskId:task.taskId,status:terminal.status,packageId:before.expectedManifest.packageVersion,engineContract:before.engineContract,
    ...(terminal.controlLockWarning?{controlLockWarning:terminal.controlLockWarning}:{}),
    elapsedMs:Math.round(performance.now()-started),logicalBytes:measureTaskBytes(task.root),engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
    records:'TASK.json, terminal.json, events.jsonl; ERROR.private.json on failure. Paths in private receipts are local only.'};
}

export function assertExpectedPreflight(before,expected) {
  if(expected===null)return;
  assert(expected&&typeof expected==='object'&&!Array.isArray(expected));
  assert.deepEqual(Object.keys(expected).sort(),['packageId','snapshot']);
  assert.equal(before.expectedManifest.packageVersion,expected.packageId,'assessed package identity changed');
  assertSnapshotUnchanged(expected.snapshot,before.snapshot);
}
