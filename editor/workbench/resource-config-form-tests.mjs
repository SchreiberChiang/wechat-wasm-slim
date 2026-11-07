// Structural PCK models; filesystem and task status are injected read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readPartitionCatalog,buildRuntimeResourceConfig,prepareRuntimeResourceConfig} from './resource-config-form.mjs';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {planResourceInventories} from '../../lib/resource-pack-plan.mjs';
const base=path.resolve('MODEL_ONLY_RESOURCE_CONFIGURATION'),sha=b=>createHash('sha256').update(b).digest('hex'),json=v=>Buffer.from(JSON.stringify(v));
function pck(names){
  const rows=names.map(name=>({name:Buffer.from(name),data:Buffer.from('PCK structure model: '+name)}));let end=113;
  for(const row of rows){row.offset=end;end+=row.data.length+7;}
  const b=Buffer.alloc(end+4+rows.reduce((n,r)=>n+40+Math.ceil(r.name.length/4)*4,0));b.write('GDPC');b.writeUInt32LE(4,4);
  [4,7,2].forEach((n,i)=>b.writeUInt32LE(n,8+4*i));b.writeBigUInt64LE(113n,24);b.writeBigUInt64LE(BigInt(end),32);b.writeUInt32LE(rows.length,end);let at=end+4;
  for(const r of rows){const pad=Math.ceil(r.name.length/4)*4;b.writeUInt32LE(pad,at);at+=4;r.name.copy(b,at);at+=pad;b.writeBigUInt64LE(BigInt(r.offset-113),at);b.writeBigUInt64LE(BigInt(r.data.length),at+8);createHash('md5').update(r.data).digest().copy(b,at+16);at+=36;r.data.copy(b,r.offset);}return b;
}
function fixture(){
  const root=path.join(base,'partition'),selection={requestFile:path.join(base,'request.json'),root,taskId:'model-task'};
  const buffers=new Map([['boot',pck(['project.binary','boot.tscn','boot.gd'])],['shared',pck(['texture.bin'])],['level',pck(['level.tscn'])]]);
  const files=new Map(),handles=new Map(),calls=[];let handle=1;
  const put=(file,b)=>files.set(path.resolve(file),Buffer.from(b));
  const plan={planSha256:'a'.repeat(64),outputs:[...buffers].map(([id,b])=>({id,role:id==='boot'?'boot':'resource',path:'packs/'+id+'.pck',bytes:b.length,sha256:sha(b)}))};
  const planFile=path.join(root,'PLAN.private.json');put(planFile,json(plan));
  for(const[id,b]of buffers)put(path.join(root,'packs',id+'.pck'),b);
  const stat=f=>({dev:1,ino:[...files.keys()].indexOf(f)+1,size:files.get(f).length,mtimeMs:1,ctimeMs:1,isFile:()=>true,isSymbolicLink:()=>false});
  const io={realpathSync:f=>path.resolve(f),lstatSync:f=>stat(path.resolve(f)),openSync(f,mode){assert.equal(mode,'r');calls.push(f);const fd=handle++;handles.set(fd,path.resolve(f));return fd;},
    fstatSync:fd=>stat(handles.get(fd)),readSync(fd,target,offset,length,position){return files.get(handles.get(fd)).copy(target,offset,position,position+length);},closeSync:fd=>handles.delete(fd)};
  const state={action:'resource-pck-partition',status:'SUCCESS',terminalPresent:true,inputBinding:'MATCHED_EXECUTION_SNAPSHOT',taskId:selection.taskId,recipeId:'resource-pck-partition:'+plan.planSha256,requestSha256:'b'.repeat(64),configurationSha256:'c'.repeat(64)};
  let checks=0;const f={root,selection,buffers,files,handles,calls,put,io,plan,planFile,state,onStatus:null};
  f.status=()=>{checks++;f.onStatus?.(checks);return structuredClone(state);};
  f.read=()=>readPartitionCatalog(selection,{io,status:f.status});
  f.payload={catalogToken:'123-456',packs:[{id:'boot',root:null,requires:[],entryScene:'res://boot.tscn'},
    {id:'shared',root:'resources/shared',requires:[],entryScene:null},{id:'level',root:'resources/level',requires:['shared'],entryScene:'res://level.tscn'}],
    dependencies:[{from:'res://level.tscn',to:'res://texture.bin',kind:'runtime-declaration'}],dependencyAcknowledged:true};
  return f;
}
test('catalog requires successful shared status and verifies every current PCK; buffers never cross UI',()=>{
  const f=fixture(),r=f.read();assert.equal(r.packs.length,3);assert.equal(f.handles.size,0);assert.equal(r.receiverInBootPck,'NOT_PROVEN');
  assert.deepEqual(r.packs.find(p=>p.id==='level').sceneCandidates,['res://level.tscn']);
  assert(r.packs.every(p=>!Object.hasOwn(p,'buffer')&&!Object.hasOwn(p,'inventory')));
});
test('unknown/failure/running/wrong-task receipts cannot seed the resource form',()=>{
  for(const change of [s=>s.status='FAILED',s=>s.status='NO_TERMINAL_RECEIPT',s=>s.action='official-convert',s=>s.terminalPresent=false,s=>s.inputBinding='UNKNOWN']){
    const f=fixture();change(f.state);assert.throws(f.read,{code:'LOCAL_RESOURCE_PARTITION_SUCCESS_REQUIRED'});assert.equal(f.calls.length,0);
  }
});
test('task handoff or changed raw output is rejected; no filename traversal',()=>{
  const f=fixture();f.onStatus=n=>{if(n===2)f.state.taskId='different';};assert.throws(f.read,{code:'LOCAL_RESOURCE_CATALOG_CHANGED'});
  const g=fixture();g.put(path.join(g.root,'packs/level.pck'),pck(['different.tscn']));assert.throws(g.read,{code:'LOCAL_RESOURCE_CATALOG_OUTPUT_CHANGED'});
  const h=fixture();h.plan.outputs[1].path='../other.pck';h.put(h.planFile,json(h.plan));assert.throws(h.read,{code:'LOCAL_RESOURCE_CATALOG_OUTPUT'});
});
test('declarations preserve catalog roles/pins and shared validator accepts correct multi-pack order',()=>{
  const f=fixture(),c=f.read(),d=buildRuntimeResourceConfig(f.payload,c),inventories=new Map([...f.buffers].map(([id,b])=>[id,inspectPck(b)]));
  const p=planResourceInventories(d.config,inventories,{sourceBuffers:f.buffers});
  assert.deepEqual(p.loadOrder,['boot','shared','level']);assert.equal(p.dependencyCoverage,'DECLARED_EDGES_ONLY_NOT_COMPLETE_RESOURCE_OR_UID_SCAN');
  assert.deepEqual(d.config.packs.map(p=>p.sha256),c.packs.map(p=>p.sha256));
});
test('missing required pack edge or wrong scene fails common plan, not silently inferred',()=>{
  for(const change of [p=>p.packs[2].requires=[],p=>p.packs[2].entryScene='res://missing.tscn']){
    const f=fixture();change(f.payload);const d=buildRuntimeResourceConfig(f.payload,f.read()),inv=new Map([...f.buffers].map(([id,b])=>[id,inspectPck(b)]));
    assert.throws(()=>planResourceInventories(d.config,inv,{sourceBuffers:f.buffers}),e=>['RESOURCE_DECLARED_FILE_DEPENDENCY_ORDER','RESOURCE_ENTRY_SCENE_NOT_OWNED'].includes(e.code));
  }
});
test('form cannot inject roles, pins or execution authority and needs explicit dependency acknowledgement',()=>{
  for(const key of ['write','execute','status','configFile']){const f=fixture();f.payload[key]=true;assert.throws(()=>buildRuntimeResourceConfig(f.payload,f.read()),{code:'LOCAL_RESOURCE_CONFIG_FIELDS'});}
  for(const key of ['role','file','sha256','bytes']){const f=fixture();f.payload.packs[1][key]=true;assert.throws(()=>buildRuntimeResourceConfig(f.payload,f.read()),{code:'LOCAL_RESOURCE_CONFIG_PACK_FIELDS'});}
  const f=fixture();f.payload.dependencyAcknowledged=false;assert.throws(()=>buildRuntimeResourceConfig(f.payload,f.read()),{code:'LOCAL_RESOURCE_CONFIG_DEPENDENCY_ACK'});
});
test('prepare rechecks receipt ownership and current catalog instead of trusting UI pins',()=>{
  const f=fixture(),logs=path.join(base,'logs'),catalog=f.read(),receiptFile=path.join(logs,'123-456.result.private.json');
  const receipt={schema:'wxslim-local-plugin-result-v1',token:'123-456',operation:'resource-partition-outputs',ok:true,executionAuthorized:false,data:catalog};
  f.put(receiptFile,json(receipt));assert.equal(prepareRuntimeResourceConfig(logs,f.payload,{io:f.io,status:f.status}).config.packs.length,3);
  receipt.data.packs[1].sha256='f'.repeat(64);f.put(receiptFile,json(receipt));assert.throws(()=>prepareRuntimeResourceConfig(logs,f.payload,{io:f.io,status:f.status}),{code:'LOCAL_RESOURCE_CATALOG_STALE'});
  receipt.executionAuthorized=true;f.put(receiptFile,json(receipt));assert.throws(()=>prepareRuntimeResourceConfig(logs,f.payload,{io:f.io,status:f.status}),{code:'LOCAL_RESOURCE_CATALOG_RECEIPT'});
});
test('configuration is deterministic and no declared data or current catalog is mutated',()=>{
  const f=fixture(),c=f.read(),before=structuredClone({payload:f.payload,c}),a=buildRuntimeResourceConfig(f.payload,c),b=buildRuntimeResourceConfig(f.payload,c);
  assert.deepEqual(a,b);a.config.packs[2].requires.push('extra');a.config.dependencies[0].to='changed';assert.deepEqual({payload:f.payload,c},before);assert.deepEqual(buildRuntimeResourceConfig(f.payload,c),b);
});
