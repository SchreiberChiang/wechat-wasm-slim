// Provenance join models are not successful build evidence. No build or SDK runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {matchCustomPairBuildEvidence,checkCompletedCustomPairSource} from '../engine/custom-pair-source.mjs';
import {customRawSourcePlan,OFFICIAL_CUSTOM_RAW_REQUEST} from '../engine/official-custom-source-plan.mjs';
import {engineCommand,runEngineCli} from '../engine/fixed-engine.mjs';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const taskId='11111111-1111-4111-8111-111111111111';
function fixture(){
 const features={schema:'wxslim-custom-wasm-plan-v1',dimensions:'2d',disabledModules:[],disabledClasses:[]};
 const source=customRawSourcePlan({profile:'custom',features});
 const outputs=Object.fromEntries(['godot.raw.js','godot.wasm','godot.js.symbols'].map(name=>[name,pin(Buffer.from('MODEL_'+name))]));
 const build={schema:'wxslim-official-raw-build-v1',taskId,requestedTerminal:'SUCCESS',
  plan:{request:{schema:OFFICIAL_CUSTOM_RAW_REQUEST,profile:'custom',features},sourcePlanSha256:source.planSha256,sourceRecipe:'official-c050-capability-custom'},capture:{outputs}};
 const encode=()=>Buffer.from(JSON.stringify(build));
 const audit={schema:'wxslim-official-raw-completed-audit-v1',status:'RAW_TASK_RECHECKED_NOT_ADMITTED',taskId,
  profile:'custom',sourceRecipe:build.plan.sourceRecipe,sourceCommit:source.source.commit,build:pin(encode()),outputs,
  admission:'NOT_ADMITTED',postprocess:'NOT_RUN',runtime:'NOT_RUN'};
 return {build,audit,source,encode,match:()=>matchCustomPairBuildEvidence({buildBytes:encode(),audit})};
}
test('consistency join binds features, source recipe and artifact identities but explicitly does not authenticate caller reports',()=>{
 const f=fixture(),r=f.match();assert.equal(r.status,'CONSISTENT_RECORDS_NOT_AUTHENTICATED');
 assert.deepEqual(r.features,f.source.features);assert.deepEqual(r.selectedProfile,f.source.selectedProfile);
 assert.deepEqual(r.rawOutputs,f.audit.outputs);assert.equal(r.provenance,'REQUIRES_REAL_COMPLETED_TASK_REAUDIT');
 assert.equal(r.admission,'NOT_ADMITTED');assert.equal(r.selectedProfile.kind,'GENERATED_FROM_NORMALIZED_FEATURES');
});
test('join rejects stale build bytes, mismatched task/commit/recipe, failed builds and admitted/runtime claims',()=>{
 for(const change of [
  f=>f.audit.taskId='22222222-2222-4222-8222-222222222222',f=>f.audit.sourceCommit='0'.repeat(40),
  f=>f.audit.sourceRecipe='official-c050-capability-24',f=>f.audit.profile='full',f=>f.audit.status='SUCCESS',
  f=>f.audit.admission='ADMITTED',f=>f.audit.runtime='RUN',f=>f.audit.postprocess='COMPLETE',
  f=>f.audit.build.sha256='0'.repeat(64),f=>{f.build.requestedTerminal='FAILED';f.audit.build=pin(f.encode());},
  f=>{f.build.plan.request.schema='wxslim-official-raw-build-request-v1';f.audit.build=pin(f.encode());},
 ]){const f=fixture();change(f);assert.throws(f.match);}
});
test('join does not reuse another feature selection or incomplete artifact set',()=>{
 for(const change of [
  f=>f.build.plan.request.features.dimensions='3d',f=>f.build.plan.request.features.disabledClasses=['MeshInstance3D'],
  f=>f.build.plan.sourcePlanSha256='0'.repeat(64),f=>delete f.build.capture.outputs['godot.js.symbols'],
  f=>f.build.capture.outputs['godot.wasm'].bytes=256*1024*1024+1,
 ]){const f=fixture();change(f);f.audit.build=pin(f.encode());assert.throws(f.match);}
});
test('real public checker rejects a fabricated successful record without task ownership/terminal and writes nothing',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wxslim-custom-pair-model-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('wxslim-custom-pair-model-'));fs.rmSync(dir,{recursive:true,force:true});});
 const f=fixture();fs.writeFileSync(path.join(dir,'BUILD.json'),f.encode());
 const before=fs.readdirSync(dir),bytes=fs.readFileSync(path.join(dir,'BUILD.json'));
 await assert.rejects(()=>checkCompletedCustomPairSource(dir,taskId),e=>e.code==='CUSTOM_PAIR_SOURCE_CHECK_REJECTED'&&e.stage==='RAW_BUILD_REAUDIT'&&e.written===false);
 assert.deepEqual(fs.readdirSync(dir),before);assert(fs.readFileSync(path.join(dir,'BUILD.json')).equals(bytes));
 await assert.rejects(()=>checkCompletedCustomPairSource(dir,taskId,{audit:f.audit}),/CUSTOM_PAIR_SOURCE_CHECK_REJECTED/);
});
const streams=()=>{let out='',err='';return {stdout:{write:s=>out+=s},stderr:{write:s=>err+=s},out:()=>out,err:()=>err};};
const resultModel=()=>({schema:'wxslim-completed-custom-pair-source-check-v1',status:'CUSTOM_PAIR_SOURCE_CHECKED_NOT_ADMITTED',
 buildProvenance:'COMPLETED_CUSTOM_RAW_TASK_RECHECKED',executionAuthorized:false,buildExecuted:false,workCreated:false,
 written:false,wasmCopied:false,hostSelected:false,converterAccepted:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN',phone:'NOT_RUN'});
test('shared CLI routes only the read-only custom check and rejects false execution or admission results',async()=>{
 let calls=0;const stop=()=>assert.fail('execution/control must not be dispatched');
 const dir=path.resolve('engine'),model=resultModel();
 const r=await engineCommand(['custom-pair-check',dir,taskId],{execute:stop,cancel:stop,inspect:stop,audit:stop,pairExecute:stop,
  customPairCheck:async(work,id)=>{calls++;assert.equal(work,dir);assert.equal(id,taskId);return model;}});
 assert.equal(r,model);assert.equal(calls,1);
 const io=streams();assert.equal(await runEngineCli(['custom-pair-check',dir,taskId],{...io,command:()=>model}),0);assert.deepEqual(JSON.parse(io.out()),model);
 for(const patch of [{written:true},{converterAccepted:true},{hostSelected:true},{buildExecuted:true},{admission:'ADMITTED'},{runtime:'RUN'},{phone:'PASS'},{buildProvenance:'CALLER_REPORT'}]){
  const io=streams();assert.equal(await runEngineCli(['custom-pair-check',dir,taskId],{...io,command:()=>({...model,...patch})}),1);
  assert.equal(io.out(),'');assert.equal(JSON.parse(io.err()).code,'CUSTOM_PAIR_SOURCE_CHECK_REJECTED');
 }
});
test('common CLI rejects execution flags and missing task input without leaking local paths',async()=>{
 const absent=path.join(os.tmpdir(),'wxslim-custom-pair-no-such-task-'+taskId);assert(!fs.existsSync(absent));
 for(const args of [['custom-pair-check'],['custom-pair-check',absent],['custom-pair-check',absent,'--write'],['custom-pair-check',absent,taskId,'--write'],['custom-pair-check',absent,taskId]]){
  const io=streams();assert.equal(await runEngineCli(args,io),1);assert.equal(io.out(),'');assert(!io.err().includes(absent));
  const r=JSON.parse(io.err());assert.equal(r.written,false);assert.equal(r.buildExecuted,false);
 }
 const cli=fileURLToPath(new URL('../wxslim.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[cli,'engine','custom-pair-check',absent,taskId],{cwd:os.tmpdir(),encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).code,'CUSTOM_PAIR_SOURCE_CHECK_REJECTED');assert(!fs.existsSync(absent));
});
