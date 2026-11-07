import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildResourceRuntimeDraft,resourceRuntimeNextInputs} from './resource-runtime-form.mjs';

const MiB=1024*1024,base=path.resolve('MODEL_ONLY_NOT_CREATED'),sha=b=>createHash('sha256').update(b).digest('hex');
const file=name=>path.join(base,name);
const files={configFile:file('draft-config.json'),requestFile:file('request.json')};
test('source-install form requires explicit project acknowledgement and only generates the shared request',()=>{
  const payload={projectFile:file('project.godot'),output:file('install-task'),budgetBytes:4*MiB,allowProjectWrites:true};
  const result=buildResourceRuntimeDraft('install',payload,files,{readFile(){throw Error('form must not edit or copy project files');}});
  assert.deepEqual(result.config,{schema:'wxslim-resource-project-install-v1',...payload});assert.equal(result.request.action,'resource-project-install');
  assert.equal(result.request.purpose,'development-test');assert.equal(result.request.configFile,files.configFile);
  assert.throws(()=>buildResourceRuntimeDraft('install',{...payload,allowProjectWrites:false},files),{code:'LOCAL_RESOURCE_INSTALL_WRITE_ACK'});
  assert.throws(()=>buildResourceRuntimeDraft('install',{...payload,overwrite:true},files),{code:'LOCAL_RESOURCE_RUNTIME_FIELDS'});
  assert.throws(()=>buildResourceRuntimeDraft('install',{...payload,budgetBytes:9*MiB},files),{code:'LOCAL_RESOURCE_RUNTIME_BUDGET'});
});
function fixture(kind='interfaces'){
  const resources={schema:'wxslim-resource-packs-v1',packs:[
    {id:'boot',role:'boot',file:'packs/boot.pck',bytes:100,sha256:'a'.repeat(64),requires:[],entryScene:'res://boot.tscn'},
    {id:'shared',role:'resource',file:'packs/shared.pck',bytes:200,sha256:'b'.repeat(64),requires:[],root:'levels/shared',entryScene:null}],
    dependencies:[],reservedRoots:[],reservedNames:[]};
  const payload=kind==='interfaces'?{resourceConfigFile:file('packs.json'),js:file('paired.js'),wasm:file('paired.wasm'),output:file('interfaces-output'),budgetBytes:4*MiB}:
    {resourceConfigFile:file('packs.json'),officialConfigFile:file('official.json'),convertedOutput:file('converted'),output:file('assembled'),budgetBytes:16*MiB};
  const bytes=new Map([[file('packs.json'),Buffer.from(JSON.stringify(resources))],[file('paired.js'),Buffer.from('fixture JS')],[file('paired.wasm'),Buffer.from('fixture WASM')]]),reads=[];
  const readFile=(name,limit)=>{reads.push(name);const b=bytes.get(name);assert(b&&b.length<=limit);return Buffer.from(b);};
  return {resources,payload,bytes,reads,readFile,build:()=>buildResourceRuntimeDraft(kind,payload,files,{readFile})};
}

test('interface form derives actual engine hashes, exact shared task and no execution authority',()=>{
  const f=fixture(),r=f.build();
  assert.equal(r.config.schema,'wxslim-resource-interfaces-task-v1');
  assert.deepEqual(r.config.engine.expected,{engineJsSha256:sha(f.bytes.get(f.payload.js)),wasmSha256:sha(f.bytes.get(f.payload.wasm))});
  assert.deepEqual(r.request,{schema:'wxslim-task-request-v1',action:'resource-interfaces-prepare',configFile:files.configFile,purpose:'development-test',scope:{}});
  assert.deepEqual(JSON.parse(r.configText),r.config);assert.deepEqual(JSON.parse(r.requestText),r.request);
  assert.equal(f.reads.length,3);assert(!Object.hasOwn(r,'executionAuthorized'));
});

test('assembly form uses existing official/resource inputs; actual directory checks remain in shared plan',()=>{
  const f=fixture('assembly'),r=f.build();assert.equal(f.reads.length,0);
  assert.deepEqual(r.config,{schema:'wxslim-resource-assembly-task-v1',...f.payload});
  assert.equal(r.request.action,'resource-runtime-assemble');assert.equal(r.request.purpose,'development-test');
});

test('forged hashes, arbitrary authority, missing fields and wrong form kind rejected',()=>{
  for(const kind of ['interfaces','assembly'])for(const key of ['engine','expected','pin','eligible','execute','write','purpose','scope']){
    const f=fixture(kind);f.payload[key]=true;assert.throws(f.build,{code:'LOCAL_RESOURCE_RUNTIME_FIELDS'});
  }
  for(const kind of ['interfaces','assembly'])for(const key of Object.keys(fixture(kind).payload)){
    const f=fixture(kind);delete f.payload[key];assert.throws(f.build,{code:'LOCAL_RESOURCE_RUNTIME_FIELDS'});
  }
  for(const kind of ['__proto__','unknown','toString'])assert.throws(()=>buildResourceRuntimeDraft(kind,{},files),{code:'LOCAL_RESOURCE_RUNTIME_FIELDS'});
});

test('both forms reject relative paths and budgets outside their existing shared task limits',()=>{
  for(const kind of ['interfaces','assembly']){
    const f=fixture(kind);
    for(const key of Object.keys(f.payload).filter(k=>k!=='budgetBytes'))for(const value of ['relative','',file('x')+'\n',' '+file('x')]){
      const bad=fixture(kind);bad.payload[key]=value;assert.throws(bad.build,{code:'LOCAL_RESOURCE_RUNTIME_PATH'});
    }
    for(const n of [4*MiB-1,((kind==='interfaces'?8:384)*MiB)+1,4*MiB+0.5,NaN,'4194304']){
      const bad=fixture(kind);bad.payload.budgetBytes=n;assert.throws(bad.build,{code:'LOCAL_RESOURCE_RUNTIME_BUDGET'});
    }
    f.payload.budgetBytes=(kind==='interfaces'?8:384)*MiB;assert.equal(f.build().config.budgetBytes,f.payload.budgetBytes);
  }
});

test('invalid/reserved resources rejected by shared normalizer; boot-only is not a resource interface',()=>{
  const f=fixture();f.resources.packs[1].root='wasmcode/extra';f.bytes.set(f.payload.resourceConfigFile,Buffer.from(JSON.stringify(f.resources)));
  assert.throws(f.build,{code:'RESOURCE_ROOT_RESERVED'});
  const b=fixture();b.resources.packs.pop();b.bytes.set(b.payload.resourceConfigFile,Buffer.from(JSON.stringify(b.resources)));
  assert.throws(b.build,{code:'LOCAL_RESOURCE_RUNTIME_PACKS_REQUIRED'});
});

function sharedPlan(){
  const f=fixture(),d=f.build();return {schema:'wxslim-task-plan-v1',action:'resource-interfaces-prepare',eligible:true,executionAuthorized:false,
    plan:{schema:'wxslim-resource-interfaces-task-plan-v1',input:d.config,inputs:[{role:'boot',file:file('actual/boot.pck')}],outputs:[{path:'interfaces.js'}]}};
}
test('prefill comes from latest shared plan rather than a saved UI path; not task success',()=>{
  const p=sharedPlan(),before=structuredClone(p),next=resourceRuntimeNextInputs(p);
  assert.equal(next.pck,file('actual/boot.pck'));assert.equal(next.interfaces,file('interfaces-output/interfaces.js'));
  assert.equal(next.state,'SUGGESTED_PATHS_ONLY_EXECUTION_NOT_PERFORMED');assert.deepEqual(p,before);
  p.eligible=false;assert.equal(resourceRuntimeNextInputs(p),null);
});
test('wrong action/authority, duplicated boot, traversal output and incomplete prefill plan rejected',()=>{
  for(const change of [p=>p.action='official-convert',p=>p.executionAuthorized=true,p=>p.schema='other',p=>p.plan.inputs.push({...p.plan.inputs[0]}),p=>p.plan.inputs=[],p=>p.plan.outputs[0].path='../interfaces.js',p=>p.plan.input.engine.js='relative']){
    const p=sharedPlan();change(p);assert.throws(()=>resourceRuntimeNextInputs(p),{code:'LOCAL_RESOURCE_RUNTIME_PLAN'});
  }
});

test('same bytes are deterministic and callers cannot mutate future drafts through prior outputs',()=>{
  const f=fixture(),before=structuredClone(f.payload),a=f.build(),b=f.build();assert.deepEqual(a,b);assert.deepEqual(f.payload,before);
  a.config.engine.expected.wasmSha256='0'.repeat(64);a.request.scope.write=true;assert.deepEqual(f.build(),b);
});
