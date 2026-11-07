import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readCustomWasmPlan} from '../engine/custom-wasm-plan.mjs';
import {engineCommand,runEngineCli} from '../engine/fixed-engine.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const file=fileURLToPath(new URL('../engine/custom-2d-plan.example.json',import.meta.url));
function streams(){let output='',error='';return {stdout:{write:s=>output+=s},stderr:{write:s=>error+=s},output:()=>output,error:()=>error};}

test('shared CLI and standalone configuration reader give the same 2D feature plan without dispatching execution',()=>{
  const before=fs.readFileSync(file),fail=()=>assert.fail('must not dispatch an executing or task-control operation');
  const actual=engineCommand(['custom-plan',file],{execute:fail,inspect:fail,cancel:fail,audit:fail,pairExecute:fail});
  assert.deepEqual(actual,readCustomWasmPlan(file));
  assert.equal(actual.profile.disabled_build_options.disable_3d,true);
  assert.equal(actual.executionSupported,false);assert.equal(actual.executionAuthorized,false);
  assert(fs.readFileSync(file).equals(before));
});

test('custom-plan rejects execution flags, extra arguments, missing and non-file configurations',async()=>{
  for(const args of [['custom-plan'],['custom-plan',file,'--write'],['custom-plan',file,'--write','--force'],['custom-plan',root],['custom-plan',file+'.absent']]){
    const io=streams();assert.equal(await runEngineCli(args,io),1);assert.equal(io.output(),'');
    const error=JSON.parse(io.error());assert.equal(error.code,'CUSTOM_WASM_PLAN_REJECTED');
    assert.equal(error.executionAuthorized,false);assert.equal(error.buildExecuted,false);
    assert(!io.error().includes(root));
  }
});

test('custom-plan rejects a result falsely claiming execution, registration or written work',async()=>{
  const genuine=readCustomWasmPlan(file);
  for(const patch of [{executionSupported:true},{executionAuthorized:true},{workCreated:true},{buildExecuted:true},{converterAccepted:true},{status:'SUCCESS'},{phone:'PASS'}]){
    const io=streams();assert.equal(await runEngineCli(['custom-plan',file],{...io,command:()=>({...genuine,...patch})}),1);
    assert.equal(io.output(),'');assert.equal(JSON.parse(io.error()).code,'CUSTOM_WASM_PLAN_REJECTED');
  }
});

test('public wxslim entry works from another cwd with an absolute configuration path',()=>{
  const before=fs.readFileSync(file),cli=fileURLToPath(new URL('../wxslim.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[cli,'engine','custom-plan',file],{cwd:fileURLToPath(new URL('../engine/',import.meta.url)),encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),readCustomWasmPlan(file));assert(fs.readFileSync(file).equals(before));
});
