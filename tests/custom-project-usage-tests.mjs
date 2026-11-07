import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {planCustomProjectUsage, checkCustomProjectUsage} from '../convert/lib/custom-project-usage.mjs';
import {withOfficialConfiguration,customConversionContext} from '../convert/lib/official-custom-context.mjs';
import {createTaskService} from '../lib/task-core.mjs';
import {getOfficialRecipe} from '../convert/lib/official-engine-admission.mjs';

const packFile = process.env.WXSLIM_CUSTOM_STARTUP_PCK;
assert(packFile, 'set WXSLIM_CUSTOM_STARTUP_PCK to a retained Godot 4.7.2 startup PCK');
const bytes = fs.readFileSync(packFile);
const twoD = {schema:'wxslim-custom-wasm-plan-v1', dimensions:'2d', disabledModules:[], disabledClasses:[]};

test('PCK plan includes fixed-source implied removals and requires an explicit usage review', () => {
  const {declaration} = planCustomProjectUsage(twoD, bytes);
  assert(declaration.removedModules.includes('navigation_3d'));
  assert(declaration.removedModules.includes('meshoptimizer'));
  assert.equal(declaration.engine3dRemoved, true);
  assert.equal(declaration.removedFeaturesUnused, null);
  assert.throws(() => checkCustomProjectUsage(twoD, bytes, declaration));
  const reviewed = {...declaration, removedFeaturesUnused:true};
  const result = checkCustomProjectUsage(twoD, bytes, reviewed);
  assert.equal(result.review, 'MATCHED_AUTHOR_DECLARATION');
  assert.equal(result.dependencyClosure, 'NOT_INFERRED');
  assert.equal(result.runtime, 'NOT_RUN');
  for (const patch of [{pck:{...reviewed.pck,sha256:'0'.repeat(64)}}, {removedModules:[]},
    {engine3dRemoved:false}, {extra:true}]) {
    assert.throws(() => checkCustomProjectUsage(twoD, bytes, {...reviewed,...patch}));
  }
  assert.throws(() => checkCustomProjectUsage({...twoD,dimensions:'3d'}, bytes, reviewed));
});

test('project review covers explicit classes, module dependencies and export version', () => {
  const features = {...twoD, dimensions:'3d', disabledModules:['ogg'], disabledClasses:['Button']};
  const {declaration} = planCustomProjectUsage(features, bytes);
  assert.deepEqual(declaration.disabledClasses, ['Button']);
  for (const name of ['ogg','vorbis','theora']) assert(declaration.removedModules.includes(name));
  assert(!declaration.removedModules.includes('navigation_3d'));
  assert.throws(() => checkCustomProjectUsage(features, bytes, {...declaration,disabledClasses:[],removedFeaturesUnused:true}));
  const badVersion = Buffer.from(bytes);
  badVersion.writeUInt32LE(3,16);
  assert.throws(() => planCustomProjectUsage(features, badVersion), /4.7.2/);
});

test('a missing source preparation prevents a custom conversion input check', () => {
  const result = spawnSync(process.execPath,['wxslim.mjs','official','custom-input-check',
    'no-such-preparation.json','glx','zh_CN',packFile,'no-such-declaration.json'], {encoding:'utf8'});
  assert.equal(result.status,1);
  assert.equal(JSON.parse(result.stderr).code,'TASK_PAIR_PREPARATION_FAILED');
});

test('standalone and shared conversion require the saved source preparation before any output', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'wx-custom-recipe-'));
  const config=path.join(temp,'inputs.json'), request=path.join(temp,'request.json'), output=path.join(temp,'task');
  t.after(()=>{
    for (const file of [config,request]) if(fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(temp);
  });
  fs.writeFileSync(config,JSON.stringify({schema:'wxslim-official-inputs-v1', engineProfile:'custom-official-c050-dev',
    customPreparation:'missing-preparation.json', output, projectUsage:{removedFeaturesUnused:true}}));
  fs.writeFileSync(request,JSON.stringify({schema:'wxslim-task-request-v1',action:'official-convert',
    configFile:'inputs.json',purpose:'development-test'}));
  const expected={code:'TASK_PAIR_PREPARATION_FAILED'}, service=createTaskService();
  await assert.rejects(withOfficialConfiguration(config,()=>assert.fail('unverified custom scope entered')),expected);
  await assert.rejects(service.plan(request),expected);
  await assert.rejects(service.execute(request,{write:true}),expected);
  assert.equal(fs.existsSync(output),false);
  assert.equal(customConversionContext(),null);
  assert.throws(()=>getOfficialRecipe('custom-official-c050-dev'));
  for(const command of ['check','plan','execute']) {
    const argv=['wxslim.mjs','official',command,config,...(command==='execute'?['--write']:[])];
    const result=spawnSync(process.execPath,argv,{encoding:'utf8'});
    assert.equal(result.status,1);
    assert.equal(JSON.parse(result.stderr).code,expected.code);
    assert.equal(fs.existsSync(output),false);
  }
});
