// Shared fixed-recipe CLI. Execution always requires an explicit --write.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {normalizeFixedBuildConfig,fixedBuildPlan} from './fixed-engine-plan.mjs';
import {normalizeExecutionRequest,executionPlan,auditCompletedFixedBuild,executeFixedBuild} from './fixed-build.mjs';
import {inspectTask,requestCancellation} from '../convert/lib/official-task.mjs';
import {checkOfficialPairPreparation,executeOfficialPairPreparation} from './official-pair-prepare.mjs';
import {planOfficialCapabilitySources} from './official-capability-source-plan.mjs';
import {officialToolchainPlan} from './official-toolchain-plan.mjs';
import {readCustomWasmPlan} from './custom-wasm-plan.mjs';
import {checkCompletedCustomPairSource} from './custom-pair-source.mjs';

function boundInputSnapshot(root,state){
  const file=path.join(root,'inputs','REQUEST.json');
  if(!fs.existsSync(file))return 'NOT_YET_AVAILABLE_OR_PREPARATION_FAILED';
  const st=fs.lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink(),'ordinary request snapshot required');
  const plan=executionPlan(normalizeExecutionRequest(JSON.parse(fs.readFileSync(file,'utf8')),path.dirname(file)));
  assert.equal(state.owner.recipeId,'fixed-engine:'+plan.semanticRecipeSha256,'task/request recipe mismatch');
  const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  assert.equal(norm(plan.work),norm(root),'task/request work mismatch');
  assert.equal(state.owner.budgetBytes,plan.budgetBytes,'task/request budget mismatch');
  return 'MATCHED_SNAPSHOT';
}

export function engineCommand(args,{execute=executeFixedBuild,inspect=inspectTask,cancel=requestCancellation,audit=auditCompletedFixedBuild,
  pairCheck=checkOfficialPairPreparation,pairExecute=executeOfficialPairPreparation,toolchainPlan=officialToolchainPlan,
  customPairCheck=checkCompletedCustomPairSource}={}){
  assert(Array.isArray(args)&&args.every(a=>typeof a==='string'),'argument strings required');
  const [action,file,taskId,...extra]=args;
  assert(!extra.length,'unexpected arguments');
  if(action==='rebuilt-pair-prepare'){
    assert(file && (!taskId || taskId==='--write'),'rebuilt-pair-prepare CONFIG [--write]');
    return import('./rebuilt-capability-pair.mjs').then(m=>m.prepareRebuiltCapabilityPair(file,taskId==='--write'));
  }
  if(action==='custom-plan'){
    assert(file&&!taskId,'custom-plan CONFIG is read-only; --write is not supported');
    return readCustomWasmPlan(file);
  }
  if(action==='custom-pair-check'){
    assert(file&&taskId&&taskId!=='--write','custom-pair-check RAW_TASK_ROOT TASK_ID is read-only');
    return customPairCheck(path.resolve(file),taskId);
  }
  if(action==='official-toolchain-plan'){
    assert(file&&!taskId,'official-toolchain-plan CONFIG is read-only');
    return toolchainPlan(file);
  }
  if(action==='official-capability-plan'){
    assert(file&&!taskId,'official-capability-plan full|conservative is read-only');
    return planOfficialCapabilitySources({profile:file});
  }
  if(action==='official-prepare-check'){
    assert(file&&!taskId,'official-prepare-check CONFIG requires one input');
    return pairCheck(file);
  }
  if(action==='official-prepare-execute'){
    assert(file&&taskId==='--write','official-prepare-execute CONFIG --write required');
    return pairExecute(file,{writeAuthorized:true});
  }
  if(action==='plan'||action==='build-plan'){
    assert(file&&!taskId,'one input JSON required');
    const base=path.dirname(path.resolve(file)),raw=JSON.parse(fs.readFileSync(file,'utf8'));
    return action==='plan'?fixedBuildPlan(normalizeFixedBuildConfig(raw,base)):executionPlan(normalizeExecutionRequest(raw,base));
  }
  if(action==='execute'){
    assert(file&&taskId==='--write','execute REQUEST --write required');
    const base=path.dirname(path.resolve(file)),raw=JSON.parse(fs.readFileSync(file,'utf8'));
    return execute(normalizeExecutionRequest(raw,base),{write:true});
  }
  if(action==='audit'){assert(file&&taskId,'audit ROOT TASK_ID');return audit(path.resolve(file),taskId);}
  if(action==='status'||action==='cancel'){
    assert(file&&taskId,'status|cancel ROOT TASK_ID');
    const root=path.resolve(file),state=inspect(root,taskId),recipeId=state.owner?.recipeId;
    assert(typeof recipeId==='string'&&/^fixed-engine:[a-f0-9]{64}$/.test(recipeId),'fixed engine task required');
    if(state.terminal)assert.equal(state.terminal.details?.kind,'FIXED_ENGINE_BUILD','fixed engine terminal required');
    if(state.terminal&&state.cancellation)assert.equal(state.terminal.status,'CANCELLED','terminal/cancel receipts contradict each other');
    const inputSnapshot=boundInputSnapshot(root,state);
    if(action==='cancel')return cancel(root,taskId,{expectedRecipeId:recipeId});
    return {schema:'wxslim-fixed-engine-status-v1',taskId,recipeId,
      status:state.terminal?.status??(state.cancellation?'CANCEL_REQUESTED':'NO_TERMINAL_RECEIPT'),
      terminalPresent:!!state.terminal,cancellationRequested:!!state.cancellation,
      logicalBytes:state.logicalBytes,budgetBytes:state.owner.budgetBytes,
      build:state.terminal?.details?.build??null,profile:state.terminal?.details?.profile??null,
      inputSnapshot,processLiveness:'NOT_OBSERVED',admission:'NOT_REAUDITED',runtime:'NOT_INFERRED',
      scope:'Receipt observation only. Missing terminal does not prove a process is running; SUCCESS requires independent engine audit before using artifacts.'};
  }
  throw Error('plan INPUTS | custom-plan CONFIG | build-plan REQUEST | execute REQUEST --write | status|cancel|audit ROOT TASK_ID | official-toolchain-plan CONFIG');
}

export async function runEngineCli(args,{command=engineCommand,stdout=process.stdout,stderr=process.stderr}={}){
  const mayExecute=args[0]==='execute'&&args.length===3&&args[2]==='--write';
  const mayPrepare=args[0]==='official-prepare-execute'&&args.length===3&&args[2]==='--write';
  const preparationAction=['official-prepare-check','official-prepare-execute'].includes(args[0]);
  try{
    const result=await command(args);
    let output=result;
    if(args[0]==='custom-plan'){
      assert.equal(result?.schema,'wxslim-custom-wasm-plan-result-v1');
      assert.equal(result.status,'PLAN_ONLY_UNBUILT_UNREGISTERED');
      for(const flag of ['buildExecuted','converterAccepted','executionSupported','executionAuthorized','workCreated'])assert.equal(result[flag],false);
      assert.equal(result.phone,'NOT_RUN');
    }
    if(args[0]==='custom-pair-check'){
      assert.equal(result?.schema,'wxslim-completed-custom-pair-source-check-v1');
      assert.equal(result.status,'CUSTOM_PAIR_SOURCE_CHECKED_NOT_ADMITTED');
      assert.equal(result.buildProvenance,'COMPLETED_CUSTOM_RAW_TASK_RECHECKED');
      for(const flag of ['executionAuthorized','buildExecuted','workCreated','written','wasmCopied','hostSelected','converterAccepted'])assert.equal(result[flag],false);
      assert.equal(result.admission,'NOT_ADMITTED');assert.equal(result.runtime,'NOT_RUN');assert.equal(result.phone,'NOT_RUN');
    }
    if(args[0]==='official-toolchain-plan'){
      assert.equal(result?.schema,'wxslim-official-toolchain-cli-plan-v1');
      assert.equal(result.status,'PLAN_ONLY');assert.equal(result.executionSupported,false);assert.equal(result.executionAuthorized,false);
      assert.equal(result.workCreated,false);assert.equal(result.dependenciesInstalled,false);assert.equal(result.runtime,'NOT_RUN');
    }
    if(args[0]==='official-prepare-check'){
      assert.equal(result?.schema,'wxslim-official-pair-preparation-check-v1');
      assert.equal(result.written,false);assert.equal(result.admission,'NOT_ADMITTED');assert.equal(result.runtime,'NOT_RUN');
    }else if(mayPrepare){
      assert.equal(result?.schema,'wxslim-official-pair-preparation-result-v1','preparation receipt required');
      assert.equal(result.status,'PREPARED_NOT_ADMITTED');assert.equal(result.written,true);
      assert.equal(result.admission,'NOT_ADMITTED');assert.equal(result.runtime,'NOT_RUN');
    }
    if(mayExecute){
      assert(['SUCCESS','FAILED','CANCELLED'].includes(result?.status)&&result?.terminal?.status===result.status,'execution terminal required');
      assert.equal(result.terminal.details?.kind,'FIXED_ENGINE_BUILD','fixed engine terminal required');
      output={schema:'wxslim-fixed-engine-execution-v1',status:result.terminal.status,taskId:result.terminal.taskId,
        profile:result.terminal.details.profile,build:result.terminal.details.build,
        phases:result.phases.map(p=>({name:p.name,status:p.status,wallMs:p.wallMs})),
        admission:'REQUIRES_INDEPENDENT_AUDIT',runtime:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',
        localDetails:'Full commands and errors remain in the task directory; no automatic retry.'};
      if(result.terminal.controlLockWarning)output.controlLockWarning={
        code:/^[A-Z][A-Z0-9_]{0,63}$/.test(result.terminal.controlLockWarning.code||'')?result.terminal.controlLockWarning.code:'TASK_LOCK_RELEASE_FAILED',
        message:'终态已保存，但任务控制锁未释放；请核对本地任务目录，不改写终态或自动重试。'};
    }
    stdout.write(JSON.stringify(output,null,2)+'\n');
    return mayExecute&&result.status!=='SUCCESS'?(result.status==='CANCELLED'?2:1):0;
  }catch(e){
    if(args[0]==='rebuilt-pair-prepare'){
      stderr.write(JSON.stringify({schema:'wxslim-rebuilt-pair-error-v1',status:'FAILED',code:'REBUILT_PAIR_REJECTED',
        reason:e.message,possibleSideEffects:args[2]==='--write'?'CHECK_REQUESTED_OUTPUTS':'NONE',
        admission:'NOT_ADMITTED',runtime:'NOT_RUN'})+'\n');
      return 1;
    }
    if(args[0]==='custom-pair-check'){
      const stages=['INPUTS','RAW_BUILD_REAUDIT','SOURCE_RECIPE','ARTIFACTS','DERIVE_SOURCE','FINAL_RECHECK'];
      stderr.write(JSON.stringify({schema:'wxslim-custom-pair-source-error-v1',status:'FAILED',code:'CUSTOM_PAIR_SOURCE_CHECK_REJECTED',
        stage:stages.includes(e.stage)?e.stage:'REQUEST_OR_RESULT',
        message:'自定义配对检查未通过；须提供已成功完成且可独立复核的自定义raw任务。未生成文件、构建或注册新引擎。',
        executionAuthorized:false,buildExecuted:false,workCreated:false,written:false,converterAccepted:false,
        admission:'NOT_ADMITTED',runtime:'NOT_RUN',phone:'NOT_RUN'})+'\n');
      return 1;
    }
    if(args[0]==='custom-plan'){
      stderr.write(JSON.stringify({schema:'wxslim-custom-wasm-plan-error-v1',status:'FAILED',code:'CUSTOM_WASM_PLAN_REJECTED',
        message:'自定义 WASM 配置未通过。请核对 dimensions、模块和类列表；此入口只生成计划，不接受 --write，也未执行构建。',
        executionAuthorized:false,workCreated:false,buildExecuted:false,converterAccepted:false,phone:'NOT_RUN'})+'\n');
      return 1;
    }
    if(args[0]==='official-toolchain-plan'){
      stderr.write(JSON.stringify({schema:'wxslim-official-toolchain-plan-error-v1',status:'FAILED',code:'OFFICIAL_TOOLCHAIN_PLAN_REJECTED',
        message:'工具链只读计划未通过；请核对配置和固定Python身份。没有执行安装、缓存生成或构建。',
        executionAuthorized:false,dependenciesInstalled:false,runtime:'NOT_RUN'})+'\n');
      return 1;
    }
    if(preparationAction){
      const flags=key=>e?.[key]&&['js','receipt'].every(k=>typeof e[key][k]==='boolean')?{js:e[key].js,receipt:e[key].receipt}:null;
      stderr.write(JSON.stringify({schema:'wxslim-official-pair-preparation-error-v1',status:'FAILED',code:'OFFICIAL_PAIR_PREPARATION_REJECTED',
        message:mayPrepare?'配对准备未完成；请保留配置指定的输出和收据核查，不自动补写、覆盖或重试。':'配对准备检查或参数未通过，没有据此生成配对。',
        possibleSideEffects:mayPrepare?(e.possibleSideEffects==='NONE'?'NONE':'PARTIAL_OUTPUT_POSSIBLE'):'NONE',
        created:flags('created'),attempted:flags('attempted'),runtime:'NOT_RUN',admission:'NOT_ADMITTED'})+'\n');
      return 1;
    }
    stderr.write(JSON.stringify({schema:'wxslim-fixed-engine-error-v1',status:'FAILED',code:'FIXED_ENGINE_REJECTED',
      message:mayExecute?'固定构建未正常结束；可能已有部分产物，请核对任务终态和本地日志。不会自动重试。':'固定构建请求或任务核验未通过；未据此认定构建或运行成功。',
      ...(mayExecute?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{}),runtime:'NOT_INFERRED'})+'\n');
    return 1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.exitCode=await runEngineCli(process.argv.slice(2));
}
