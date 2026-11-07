// Local resource declaration from an existing successful shared partition task.
// Reads actual PCKs again. No task, output directory or runtime is created here.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createTaskService} from '../../lib/task-core.mjs';
import {normalizeResourceConfig} from '../../lib/resource-pack-plan.mjs';
import {readStableResourceFile,readResourceInventory} from './resource-form-io.mjs';

const MiB=1024*1024;
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const absolute=v=>typeof v==='string'&&v&&v.trim()===v&&!/[\u0000-\u001f\u007f-\u009f]/.test(v)&&path.isAbsolute(v);
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const id=v=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,47}$/.test(v);
const binding=s=>Object.fromEntries(['action','taskId','recipeId','requestSha256','configurationSha256','status','terminalPresent','inputBinding'].map(k=>[k,s[k]]));

// Injected IO/status are only for models, not supplied by GUI payloads.
export function readPartitionCatalog(selection,{io=fs,status=(file,options)=>createTaskService().status(file,options)}={}){
  need(exact(selection,['requestFile','root','taskId'])&&absolute(selection.requestFile)&&absolute(selection.root)&&
    typeof selection.taskId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(selection.taskId),'LOCAL_RESOURCE_CATALOG_SELECTION');
  const options={root:selection.root,taskId:selection.taskId},before=status(selection.requestFile,options);
  need(before.action==='resource-pck-partition'&&before.status==='SUCCESS'&&before.terminalPresent===true&&before.inputBinding==='MATCHED_EXECUTION_SNAPSHOT','LOCAL_RESOURCE_PARTITION_SUCCESS_REQUIRED');
  const planFile=path.join(selection.root,'PLAN.private.json'),planBytes=readStableResourceFile(planFile,MiB,io),plan=JSON.parse(planBytes);
  need(before.recipeId==='resource-pck-partition:'+plan.planSha256&&Array.isArray(plan.outputs)&&plan.outputs.length>1&&plan.outputs.length<=128,'LOCAL_RESOURCE_CATALOG_PLAN');
  let total=0;const seen=new Set();
  const packs=plan.outputs.map(p=>{
    need(id(p.id)&&!seen.has(p.id)&&['boot','resource'].includes(p.role)&&p.path==='packs/'+p.id+'.pck'&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=256*MiB&&/^[a-f0-9]{64}$/.test(p.sha256),'LOCAL_RESOURCE_CATALOG_OUTPUT');
    seen.add(p.id);total+=p.bytes;need(total<=256*MiB,'LOCAL_RESOURCE_CATALOG_BUDGET');
    const file=path.join(selection.root,'packs',p.id+'.pck'),snapshot=readResourceInventory({sourcePath:file},io);
    need(snapshot.pin.bytes===p.bytes&&snapshot.pin.sha256===p.sha256,'LOCAL_RESOURCE_CATALOG_OUTPUT_CHANGED');
    const sceneCandidates=[...new Set(snapshot.inventory.entries.filter(e=>/\.(tscn|scn)(\.remap)?$/.test(e.path))
      .map(e=>'res://'+e.path.replace(/\.remap$/,'')))].sort();
    need(sceneCandidates.length<=2048,'LOCAL_RESOURCE_CATALOG_SCENES_LIMIT');
    return {id:p.id,role:p.role,file,...snapshot.pin,entryCount:snapshot.inventory.entries.length,sceneCandidates};
  });
  need(packs.filter(p=>p.role==='boot').length===1,'LOCAL_RESOURCE_CATALOG_BOOT');
  need(isDeepStrictEqual(binding(before),binding(status(selection.requestFile,options)))&&
    sha(readStableResourceFile(planFile,MiB,io))===sha(planBytes),'LOCAL_RESOURCE_CATALOG_CHANGED');
  return {schema:'wxslim-local-resource-catalog-v1',selection:{...selection},status:binding(before),plan:pin(planBytes),packs,
    evidence:'RECEIPT_AND_CURRENT_PCK_BYTES_ONLY',dependencyCoverage:'NOT_INFERRED',receiverInBootPck:'NOT_PROVEN',phone:'NOT_RUN'};
}

export function buildRuntimeResourceConfig(payload,catalog){
  need(exact(payload,['catalogToken','packs','dependencies','dependencyAcknowledged'])&&
    typeof payload.catalogToken==='string'&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(payload.catalogToken),'LOCAL_RESOURCE_CONFIG_FIELDS');
  need(payload.dependencyAcknowledged===true,'LOCAL_RESOURCE_CONFIG_DEPENDENCY_ACK');
  need(catalog?.schema==='wxslim-local-resource-catalog-v1'&&catalog.status?.action==='resource-pck-partition'&&catalog.status.status==='SUCCESS'&&
    Array.isArray(catalog.packs)&&Array.isArray(payload.packs)&&payload.packs.length===catalog.packs.length,'LOCAL_RESOURCE_CONFIG_CATALOG');
  const seen=new Set(),byId=new Map(catalog.packs.map(p=>[p.id,p]));
  const packs=payload.packs.map(p=>{
    need(exact(p,['id','root','requires','entryScene'])&&byId.has(p.id)&&!seen.has(p.id),'LOCAL_RESOURCE_CONFIG_PACK_FIELDS');seen.add(p.id);
    const actual=byId.get(p.id);
    need(actual.role!=='boot'||p.root===null,'LOCAL_RESOURCE_CONFIG_BOOT_ROOT');
    return {id:actual.id,role:actual.role,file:actual.file,bytes:actual.bytes,sha256:actual.sha256,
      requires:Array.isArray(p.requires)?[...p.requires]:p.requires,entryScene:p.entryScene,...(actual.role==='resource'?{root:p.root}:{})};
  });
  const config={schema:'wxslim-resource-packs-v1',packs,dependencies:structuredClone(payload.dependencies),reservedRoots:[],reservedNames:[]};
  // One shared validator owns roots/IDs/URI syntax and boot constraints. Actual
  // file dependency/scene ownership is then checked by resources plan.
  normalizeResourceConfig(config);
  const configText=JSON.stringify(config,null,2)+'\n';need(Buffer.byteLength(configText)<=MiB,'LOCAL_RESOURCE_CONFIG_LIMIT');
  return {config,configText};
}

export function prepareRuntimeResourceConfig(logs,payload,{io=fs,status}={}){
  need(absolute(logs)&&typeof payload?.catalogToken==='string'&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(payload.catalogToken),'LOCAL_RESOURCE_CONFIG_REFERENCE');
  const prior=JSON.parse(readStableResourceFile(path.join(logs,payload.catalogToken+'.result.private.json'),2*MiB,io));
  need(prior.schema==='wxslim-local-plugin-result-v1'&&prior.token===payload.catalogToken&&prior.operation==='resource-partition-outputs'&&prior.ok===true&&prior.executionAuthorized===false,'LOCAL_RESOURCE_CATALOG_RECEIPT');
  const current=readPartitionCatalog(prior.data.selection,{io,...(status?{status}:{})});
  need(isDeepStrictEqual(current,prior.data),'LOCAL_RESOURCE_CATALOG_STALE');
  return buildRuntimeResourceConfig(payload,current);
}
