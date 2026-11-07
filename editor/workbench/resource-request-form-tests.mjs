// Structural PCK byte models in memory only. No real project/task/directories,
// editor, disk inspection, resource import mapping guesses or runtime claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {partitionPck} from '../../lib/pck-partition.mjs';
import {buildResourcePartitionRequestDraft} from './resource-request-form.mjs';
const MiB=1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
const BOOT=['project.binary','.godot/uid_cache.bin','.godot/global_script_class_cache.cfg','.godot/extension_list.cfg','boot.gd','scripts/player.gdc','scripts/player.gd.remap','Scripts/HERO.GD'];
const RESOURCE=['levels/a.tscn.remap','.godot/exported/actual-a.scn','shared/checker.svg.import','.godot/imported/actual-checker.ctex'];
function pck(names){
  const rows=names.map(name=>({name:Buffer.from(name),data:Buffer.from('structure-only model: '+name)}));let end=113;
  for(const row of rows){row.offset=end;end+=row.data.length+7;}
  const b=Buffer.alloc(end+4+rows.reduce((n,r)=>n+40+Math.ceil(r.name.length/4)*4,0));b.write('GDPC');b.writeUInt32LE(4,4);
  [4,7,2].forEach((n,i)=>b.writeUInt32LE(n,8+4*i));b.writeBigUInt64LE(113n,24);b.writeBigUInt64LE(BigInt(end),32);b.writeUInt32LE(rows.length,end);let at=end+4;
  for(const r of rows){const pad=Math.ceil(r.name.length/4)*4;b.writeUInt32LE(pad,at);at+=4;r.name.copy(b,at);at+=pad;b.writeBigUInt64LE(BigInt(r.offset-113),at);b.writeBigUInt64LE(BigInt(r.data.length),at+8);createHash('md5').update(r.data).digest().copy(b,at+16);at+=36;r.data.copy(b,r.offset);}return b;
}
function fixture(){
  const base=path.resolve('MEMORY_ONLY_RESOURCE_FORM'),sourcePath=path.join(base,'完整游戏.pck'),buffer=pck([...BOOT,...RESOURCE]);
  return {payload:{sourcePath,output:path.join(base,'拆包任务'),budgetBytes:8*MiB,packs:[{id:'boot',role:'boot',paths:[...BOOT]},{id:'level',role:'resource',paths:[...RESOURCE]}],dependencyAcknowledged:true},
    snapshot:{sourcePath,pin:{bytes:buffer.length,sha256:sha(buffer)},inventory:inspectPck(buffer),buffer},
    files:{configFile:path.join(base,'拆包配置.json'),requestFile:path.join(base,'拆包请求.json')}};
}
const build=f=>buildResourcePartitionRequestDraft(f.payload,f.snapshot,f.files);

test('exact config/request/text shapes use the real PCK pin and validate with the actual partition core',()=>{
  const f=fixture(),draft=build(f),split=partitionPck(f.snapshot.buffer,draft.config.partition);
  assert.deepEqual(Object.keys(draft).sort(),['config','request','configText','requestText'].sort());
  assert.deepEqual(draft.config,{schema:'wxslim-pck-partition-task-v1',sourcePath:f.payload.sourcePath,partition:{schema:'wxslim-pck-partition-v1',source:f.snapshot.pin,packs:f.payload.packs},output:f.payload.output,budgetBytes:8*MiB});
  assert.deepEqual(draft.request,{schema:'wxslim-task-request-v1',action:'resource-pck-partition',configFile:f.files.configFile,purpose:'development-test',scope:{}});
  assert.equal(draft.configText,JSON.stringify(draft.config,null,2)+'\n');assert.equal(draft.requestText,JSON.stringify(draft.request,null,2)+'\n');
  assert.equal(split.audit.exactOwnershipUnion,true);assert.equal(split.audit.entryCount,BOOT.length+RESOURCE.length);assert.equal(split.audit.engineRun,'NOT_RUN');
  assert(!draft.configText.includes('dependencyAcknowledged'));assert(!draft.configText.includes('"buffer"'));assert(!draft.configText.includes('"inventory"'));assert(!Object.hasOwn(draft,'outputs'));
});

test('all-boot default is a valid ownership draft without inventing a runtime resource manifest',()=>{
  const f=fixture();f.payload.packs=[{id:'boot',role:'boot',paths:[...BOOT,...RESOURCE]}];const draft=build(f);assert.equal(draft.config.partition.packs.length,1);
  assert(!Object.hasOwn(draft,'runtimeEligible'));assert(!Object.hasOwn(draft,'executionAuthorized'));
});

test('every actual entry must have exactly one owner; unknown/missing/duplicate entries reuse core rejections',()=>{
  for(const [mutate,code]of [[f=>f.payload.packs[1].paths.pop(),'PCK_PARTITION_MISSING_PATH'],[f=>f.payload.packs[1].paths.push('not-exported.svg'),'PCK_PARTITION_UNKNOWN_PATH'],[f=>f.payload.packs[1].paths.push(RESOURCE[0]),'PCK_PARTITION_DUPLICATE_OWNER']]){
    const f=fixture();mutate(f);assert.throws(()=>build(f),{code});
  }
});

test('metadata, scripts and script remaps cannot move out of boot, using the original core rule',()=>{
  for(const name of BOOT){const f=fixture();f.payload.packs[0].paths=f.payload.packs[0].paths.filter(p=>p!==name);f.payload.packs[1].paths.push(name);assert.throws(()=>build(f),{code:'PCK_PARTITION_BOOT_ONLY'});}
});

test('exactly one boot, canonical IDs, unique pack IDs and exact nested fields follow the actual core',()=>{
  for(const mutate of [f=>f.payload.packs[0].role='resource',f=>f.payload.packs[1].role='boot',f=>f.payload.packs[1].id='Uppercase',f=>f.payload.packs[1].id='boot',f=>f.payload.packs[1].id='1invalid',f=>f.payload.packs[1].root='not-partition-schema',f=>f.payload.packs[1].paths=['res://levels/a.tscn']]){
    const f=fixture();mutate(f);assert.throws(()=>build(f),error=>{assert(error.code.startsWith('PCK_PARTITION_'));return true;});
  }
});

test('payload cannot forge pins, inspection state, extra authority or execution options',()=>{
  for(const key of ['source','pin','sha256','inventory','buffer','status','validated','execute','write','purpose','scope']){const f=fixture();f.payload[key]=true;assert.throws(()=>build(f),{code:'LOCAL_RESOURCE_FORM_FIELDS'});}
  for(const key of Object.keys(fixture().payload)){const f=fixture();delete f.payload[key];assert.throws(()=>build(f),{code:'LOCAL_RESOURCE_FORM_FIELDS'});}
  for(const value of [false,0,1,'true',null]){const f=fixture();f.payload.dependencyAcknowledged=value;assert.throws(()=>build(f),{code:'LOCAL_RESOURCE_FORM_DEPENDENCY_ACK'});}
});

test('adapter snapshot source path, pin, inventory and actual bytes must agree',()=>{
  for(const mutate of [f=>f.snapshot.sourcePath=path.resolve('other.pck'),f=>f.snapshot.pin.sha256='0'.repeat(64),f=>f.snapshot.pin.bytes++,f=>f.snapshot.inventory.entries.pop(),f=>f.snapshot.inventory.entries[0].path='forged',f=>f.snapshot.inventory.status='CLAIMED_PASS',f=>f.snapshot.inventory.sha256='0'.repeat(64)]){
    const f=fixture();mutate(f);assert.throws(()=>build(f),error=>{assert(['LOCAL_RESOURCE_FORM_SNAPSHOT','LOCAL_RESOURCE_FORM_SNAPSHOT_CHANGED'].includes(error.code));return true;});
  }
  const f=fixture();f.snapshot.buffer[113]^=1;assert.throws(()=>build(f),{code:'PCK_MD5'});
  const missing=fixture();delete missing.snapshot.buffer;assert.throws(()=>build(missing),{code:'LOCAL_RESOURCE_FORM_SNAPSHOT'});
});

test('task budget bounds and absolute fields match the task schema without file or output existence checks',()=>{
  for(const budgetBytes of [4*MiB,260*MiB]){const f=fixture();f.payload.budgetBytes=budgetBytes;assert.equal(build(f).config.budgetBytes,budgetBytes);}
  for(const budgetBytes of [4*MiB-1,260*MiB+1,4*MiB+0.5,NaN,Infinity,'8388608']){const f=fixture();f.payload.budgetBytes=budgetBytes;assert.throws(()=>build(f),{code:'RESOURCE_PARTITION_TASK_BUDGET'});}
  for(const [group,key]of [['payload','sourcePath'],['payload','output'],['files','configFile'],['files','requestFile']])for(const value of ['relative','',' '+fixture()[group][key],fixture()[group][key]+'\u0000',fixture()[group][key]+'\r',fixture()[group][key]+'\n']){
    const f=fixture();f[group][key]=value;assert.throws(()=>build(f),{code:'LOCAL_RESOURCE_FORM_PATH'});
  }
  const f=fixture();f.files.extra=true;assert.throws(()=>build(f),{code:'LOCAL_RESOURCE_FORM_DESTINATIONS'});
});

test('same inputs are deterministic and neither source bytes, inventory nor caller declarations are mutated',()=>{
  const f=fixture(),bytes=Buffer.from(f.snapshot.buffer),before=structuredClone({payload:f.payload,pin:f.snapshot.pin,inventory:f.snapshot.inventory,files:f.files});
  const a=build(f),b=build(f);assert.deepEqual(a,b);assert.deepEqual(f.snapshot.buffer,bytes);assert.deepEqual({payload:f.payload,pin:f.snapshot.pin,inventory:f.snapshot.inventory,files:f.files},before);
  a.config.partition.source.sha256='caller edit';a.config.partition.packs[0].paths.pop();a.request.scope.edited=true;
  assert.deepEqual(build(f),b);assert.deepEqual(f.snapshot.buffer,bytes);
});
