// Pure in-memory PCK4 partitioning, not a Godot exporter or a dependency scanner.
// Fixed df3cdd9bc9941a20cb5575d781cde6f937637bcb layout evidence:
// core/io/pck_packer.cpp:94-125,174-211,217-268; pck_packer.h default alignment 32.
// core/io/file_access_pack.cpp:287-369 reads standalone v4 base + relative offsets.
// Only ordinary standalone PCK4/4.7.2 accepted by inspectPck; never mount or write.
import {createHash} from 'node:crypto';
import {inspectPck} from './pck-inventory.mjs';

export const PCK_PARTITION_LIMIT_BYTES = 256 * 1024 * 1024;
const HASH=/^[a-f0-9]{64}$/,ID=/^[a-z][a-z0-9_-]{0,47}$/;
const METADATA=new Set(['project.binary','project.godot','.godot/uid_cache.bin','.godot/global_script_class_cache.cfg','.godot/extension_list.cfg']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const md5=bytes=>createHash('md5').update(bytes).digest();
const fail=code=>{throw Object.assign(Error(code),{code});};
const need=(value,code)=>{if(!value)fail(code);};
function exact(value,keys){
  need(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'PCK_PARTITION_OBJECT');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  need(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&Object.hasOwn(descriptors[key],'value')),'PCK_PARTITION_KEYS');
}
function dataArray(value){
  need(Array.isArray(value),'PCK_PARTITION_ARRAY');
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
  need(names.length===value.length+1&&names.every(key=>key==='length'||(typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<value.length&&Object.hasOwn(descriptors[key],'value'))),'PCK_PARTITION_ARRAY');
}
function validPath(value){
  need(typeof value==='string'&&value.length>0&&value===value.normalize('NFC')&&!/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/u.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'PCK_PARTITION_PATH');
  // Reject unpaired surrogates rather than UTF8 replacement of a requested name.
  need(Buffer.from(value,'utf8').toString('utf8')===value,'PCK_PARTITION_PATH');
  return value;
}
const align32=value=>Math.ceil(value/32)*32;
const bootOnly=name=>METADATA.has(name.toLowerCase())||/^(uid_cache\.bin|global_script_class_cache\.cfg|extension_list\.cfg)$/i.test(name.split('/').at(-1))||/\.(gd|gdc)(\.remap)?$/i.test(name);
const sorted=paths=>paths.slice().sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function normalize(config){
  exact(config,['schema','source','packs']);need(config.schema==='wxslim-pck-partition-v1','PCK_PARTITION_SCHEMA');
  exact(config.source,['bytes','sha256']);
  need(Number.isSafeInteger(config.source.bytes)&&config.source.bytes>=104&&config.source.bytes<=PCK_PARTITION_LIMIT_BYTES&&typeof config.source.sha256==='string'&&HASH.test(config.source.sha256),'PCK_PARTITION_SOURCE_PIN');
  dataArray(config.packs);need(config.packs.length>0&&config.packs.length<=128,'PCK_PARTITION_PACK_COUNT');
  const ids=new Set(),owners=new Map(),aliases=new Set();
  const packs=config.packs.map(pack=>{
    exact(pack,['id','role','paths']);need(typeof pack.id==='string'&&ID.test(pack.id)&&!ids.has(pack.id)&&['boot','resource'].includes(pack.role),'PCK_PARTITION_PACK');ids.add(pack.id);
    dataArray(pack.paths);const paths=pack.paths.map(path=>{
      validPath(path);need(!owners.has(path),'PCK_PARTITION_DUPLICATE_OWNER');
      const alias=path.normalize('NFC').toLowerCase();need(!aliases.has(alias),'PCK_PARTITION_PATH_ALIAS');
      need(pack.role==='boot'||!bootOnly(path),'PCK_PARTITION_BOOT_ONLY');
      owners.set(path,pack.id);aliases.add(alias);return path;
    });return {id:pack.id,role:pack.role,paths:sorted(paths)};
  });
  need(packs.filter(pack=>pack.role==='boot').length===1,'PCK_PARTITION_ONE_BOOT');
  return freeze({schema:config.schema,source:{bytes:config.source.bytes,sha256:config.source.sha256},packs});
}
function ordinaryBuffer(value){
  if(!Buffer.isBuffer(value))return false;
  try{Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(value.buffer);return true;}catch{return false;}
}
function assertSource(source,pin){
  need(ordinaryBuffer(source),'PCK_PARTITION_SOURCE_BUFFER');
  need(source.length<=PCK_PARTITION_LIMIT_BYTES,'PCK_PARTITION_SOURCE_BUDGET');
  need(source.length===pin.bytes&&sha(source)===pin.sha256,'PCK_PARTITION_SOURCE_CHANGED');
}
function prepare(source,raw){
  // Validate input descriptors before reading configuration values; no callbacks.
  const config=normalize(raw);assertSource(source,config.source);
  const snapshot=Buffer.from(source);assertSource(snapshot,config.source);assertSource(source,config.source);
  const inventory=inspectPck(snapshot);
  need(inventory.engineVersion.major===4&&inventory.engineVersion.minor===7&&inventory.engineVersion.patch===2,'PCK_PARTITION_ENGINE_VERSION');
  const entries=new Map(),aliases=new Set();
  for(const entry of inventory.entries){
    validPath(entry.path);const alias=entry.path.normalize('NFC').toLowerCase();need(!aliases.has(alias),'PCK_PARTITION_PATH_ALIAS');aliases.add(alias);entries.set(entry.path,entry);
  }
  const owned=config.packs.flatMap(pack=>pack.paths);
  need(owned.every(path=>entries.has(path)),'PCK_PARTITION_UNKNOWN_PATH');
  need(owned.length===entries.size,'PCK_PARTITION_MISSING_PATH');
  need(entries.has('project.binary'),'PCK_PARTITION_COMPLETE_BOOT_REQUIRED');
  return {config,snapshot,entries,inventory};
}
function layout(paths,entries){
  let cursor=128;const files=paths.map(path=>{const entry=entries.get(path),offset=cursor;cursor=align32(cursor+entry.bytes);return {path,entry,offset,name:Buffer.from(path)};});
  const directoryOffset=cursor;
  const bytes=cursor+4+files.reduce((sum,file)=>sum+4+Math.ceil(file.name.length/4)*4+36,0);
  need(Number.isSafeInteger(bytes)&&bytes<=PCK_PARTITION_LIMIT_BYTES,'PCK_PARTITION_OUTPUT_BUDGET');
  return {files,directoryOffset,bytes};
}
function writePack(snapshot,plan){
  const output=Buffer.alloc(plan.bytes);output.write('GDPC');output.writeUInt32LE(4,4);
  [4,7,2].forEach((value,index)=>output.writeUInt32LE(value,8+index*4));output.writeUInt32LE(2,20);
  output.writeBigUInt64LE(128n,24);output.writeBigUInt64LE(BigInt(plan.directoryOffset),32);output.writeUInt32LE(plan.files.length,plan.directoryOffset);
  let cursor=plan.directoryOffset+4;
  for(const file of plan.files){
    const payload=snapshot.subarray(file.entry.offset,file.entry.offset+file.entry.bytes);
    payload.copy(output,file.offset);
    const padded=Math.ceil(file.name.length/4)*4;output.writeUInt32LE(padded,cursor);cursor+=4;file.name.copy(output,cursor);cursor+=padded;
    output.writeBigUInt64LE(BigInt(file.offset-128),cursor);output.writeBigUInt64LE(BigInt(payload.length),cursor+8);md5(payload).copy(output,cursor+16);output.writeUInt32LE(0,cursor+32);cursor+=36;
  }
  return output;
}
function auditPrepared(source,prepared,outputs){
  const {config,snapshot,entries}=prepared;dataArray(outputs);need(outputs.length===config.packs.length,'PCK_PARTITION_OUTPUT_SET');
  const byId=new Map();let total=0;
  for(const output of outputs){
    exact(output,['id','role','buffer','bytes','sha256']);need(!byId.has(output.id),'PCK_PARTITION_OUTPUT_SET');
    need(ordinaryBuffer(output.buffer),'PCK_PARTITION_OUTPUT_BUFFER');total+=output.buffer.length;need(total<=PCK_PARTITION_LIMIT_BYTES,'PCK_PARTITION_OUTPUT_BUDGET');byId.set(output.id,output);
  }
  const packs=config.packs.map(pack=>{
    const output=byId.get(pack.id);need(output&&output.role===pack.role,'PCK_PARTITION_OUTPUT_SET');
    need(output.bytes===output.buffer.length&&output.sha256===sha(output.buffer),'PCK_PARTITION_OUTPUT_CHANGED');
    const inventory=inspectPck(output.buffer),expected=layout(pack.paths,entries);
    need(inventory.formatVersion===4&&inventory.packFlags===2&&inventory.fileBase===128&&inventory.directoryOffset===expected.directoryOffset&&inventory.bytes===expected.bytes&&[inventory.engineVersion.major,inventory.engineVersion.minor,inventory.engineVersion.patch].join('.')==='4.7.2','PCK_PARTITION_OUTPUT_LAYOUT');
    need(inventory.entries.length===pack.paths.length&&inventory.entries.every((entry,index)=>entry.path===pack.paths[index]),'PCK_PARTITION_OUTPUT_PATHS');
    const records=inventory.entries.map((entry,index)=>{
      const original=entries.get(entry.path),input=snapshot.subarray(original.offset,original.offset+original.bytes),actual=output.buffer.subarray(entry.offset,entry.offset+entry.bytes);
      need(entry.offset===expected.files[index].offset&&entry.bytes===original.bytes&&entry.sha256===original.sha256&&entry.md5===original.md5&&actual.equals(input),'PCK_PARTITION_PAYLOAD_CHANGED');
      return {path:entry.path,bytes:entry.bytes,sha256:entry.sha256,md5:entry.md5,sourceOffset:original.offset,outputOffset:entry.offset,payloadMatchesSource:true};
    });
    // Also bind zero padding/header/directory layout, not only the payload hashes.
    need(output.buffer.equals(writePack(snapshot,expected)),'PCK_PARTITION_NONCANONICAL_OUTPUT');
    return {id:pack.id,role:pack.role,bytes:output.bytes,sha256:output.sha256,entries:records};
  });
  assertSource(source,config.source);
  return freeze({schema:'wxslim-pck-partition-audit-v1',status:'PASS_IN_MEMORY_PARTITION_ONLY',source:config.source,sourceUnchanged:true,configSha256:sha(JSON.stringify(config)),entryCount:entries.size,exactOwnershipUnion:true,packs,totalOutputBytes:total,
    formatEvidence:{sourceCommit:'df3cdd9bc9941a20cb5575d781cde6f937637bcb',alignment:32,fileBase:128,packFlags:2,formatVersion:4,engineVersion:'4.7.2'},
    budget:{sourceLimitBytes:PCK_PARTITION_LIMIT_BYTES,aggregateOutputLimitBytes:PCK_PARTITION_LIMIT_BYTES,scope:'Logical input and output byte budgets; source snapshot, outputs, audit copies and allocator overhead may coexist; not a process memory peak limit'},
    dependencyCoverage:'OWNERSHIP_ONLY_NOT_COMPLETE_RESOURCE_UID_SCRIPT_OR_EXTENSION_DEPENDENCY_SCAN',runtimeEligible:false,engineRun:'NOT_RUN',mount:'NOT_RUN',phone:'NOT_RUN',
    limitations:['No Godot export, mount, ResourceLoader or script execution','Metadata and gd/gdc/gd.remap are forced to boot; this is not dependency completeness','Mutable returned buffers are checked only at audit time; re-audit before later use','No guarantee a partition meets WeChat quotas, helper 32MiB limits or runtime behavior']});
}

/** Exact source pin + complete root-relative ownership list. No implicit paths. */
export function partitionPck(source,config){
  const prepared=prepare(source,config),plans=prepared.config.packs.map(pack=>layout(pack.paths,prepared.entries));
  need(plans.reduce((sum,plan)=>sum+plan.bytes,0)<=PCK_PARTITION_LIMIT_BYTES,'PCK_PARTITION_OUTPUT_BUDGET');
  const outputs=prepared.config.packs.map((pack,index)=>{const buffer=writePack(prepared.snapshot,plans[index]);return Object.freeze({id:pack.id,role:pack.role,buffer,bytes:buffer.length,sha256:sha(buffer)});});
  return Object.freeze({schema:'wxslim-pck-partition-result-v1',outputs:Object.freeze(outputs),audit:auditPrepared(source,prepared,outputs)});
}
/** Rechecks actual buffers, including source pin, ownership and payload bytes. */
export function auditPckPartition(source,config,outputs){return auditPrepared(source,prepare(source,config),outputs);}
