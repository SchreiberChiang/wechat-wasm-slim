// Read-only ordinary WeChat resource-subpackage / Godot PCK plan.
// Does not export, copy, download, mount or execute packs. Not WASM splitting.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {inspectPck} from './pck-inventory.mjs';

const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_-]{0,47}$/;
const MAIN_METADATA=new Set(['project.godot','project.binary','.godot/uid_cache.bin','.godot/global_script_class_cache.cfg']);
const MAX_INSPECT_BYTES=256*1024*1024; // Input-byte limit, not a peak-memory guarantee or WeChat quota.
const fail=code=>{throw Object.assign(new Error(code),{code});};
function need(value,code){if(!value)fail(code);}
function keys(value,allowed,code){need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),code);}
function unique(values,code){need(new Set(values).size===values.length,code);}
function relative(value){
  need(typeof value==='string'&&value.length>0&&value===value.normalize('NFC')&&!/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/.test(value),'RESOURCE_PATH_NOT_CANONICAL');
  need(!value.startsWith('/')&&!value.endsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'RESOURCE_PATH_NOT_CANONICAL');
  return value;
}
function resourcePath(value){need(typeof value==='string'&&value.startsWith('res://'),'RESOURCE_URI_REQUIRED');return relative(value.slice(6));}
function overlaps(a,b){return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');}

export function normalizeResourceConfig(raw,base=process.cwd()){
  keys(raw,['schema','packs','dependencies','reservedRoots','reservedNames'],'RESOURCE_CONFIG_KEYS');
  need(raw.schema==='wxslim-resource-packs-v1','RESOURCE_CONFIG_SCHEMA');
  need(Array.isArray(raw.packs)&&raw.packs.length>0&&raw.packs.length<=128,'RESOURCE_PACK_COUNT');
  need(Array.isArray(raw.dependencies)&&raw.dependencies.length<=100000,'RESOURCE_DEPENDENCIES_REQUIRED');
  need(Array.isArray(raw.reservedRoots),'RESOURCE_RESERVED_ROOTS_REQUIRED');
  need(Array.isArray(raw.reservedNames)&&raw.reservedNames.every(n=>typeof n==='string'&&ID.test(n)),'RESOURCE_RESERVED_NAMES_REQUIRED');
  const reservedRoots=raw.reservedRoots.map(relative);
  const reservedNames=[...raw.reservedNames];
  // Always protect directories emitted by the current fixed official converter.
  for(const root of ['wasmcode','data-package','godot-data','wx-game-kit'])if(!reservedRoots.includes(root))reservedRoots.push(root);
  for(const name of ['wasmcode','data-package'])if(!reservedNames.includes(name))reservedNames.push(name);
  unique(reservedRoots.map(p=>p.toLowerCase()),'RESOURCE_RESERVED_ROOT_DUPLICATE');
  unique(reservedNames,'RESOURCE_RESERVED_NAME_DUPLICATE');
  const packs=raw.packs.map(p=>{
    keys(p,['id','role','file','bytes','sha256','requires','root','entryScene'],'RESOURCE_PACK_KEYS');
    need(ID.test(p.id)&&['boot','resource'].includes(p.role),'RESOURCE_PACK_ID_ROLE');
    need(typeof p.file==='string'&&p.file.trim()===p.file&&p.file&&!/[\u0000\r\n]/.test(p.file),'RESOURCE_PACK_FILE');
    need(Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=MAX_INSPECT_BYTES&&HASH.test(p.sha256),'RESOURCE_PACK_PIN');
    need(Array.isArray(p.requires)&&p.requires.every(id=>typeof id==='string'&&ID.test(id)),'RESOURCE_PACK_REQUIRES');
    unique(p.requires,'RESOURCE_PACK_REQUIRES_DUPLICATE');
    need(Object.hasOwn(p,'entryScene'),'RESOURCE_ENTRY_SCENE_REQUIRED');
    const entryScene=p.entryScene===null?null:resourcePath(p.entryScene);
    need(entryScene===null?p.role==='resource':/\.(tscn|scn)$/.test(entryScene),'RESOURCE_ENTRY_SCENE_EXTENSION');
    if(p.role==='boot')need(p.root===undefined&&p.requires.length===0,'RESOURCE_BOOT_ROOT_OR_DEPENDENCY');
    else {need(!reservedNames.includes(p.id),'RESOURCE_NAME_RESERVED');relative(p.root);need(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(p.root),'RESOURCE_ROOT_CHARACTERS');need(!reservedRoots.some(r=>overlaps(r.toLowerCase(),p.root.toLowerCase())),'RESOURCE_ROOT_RESERVED');}
    return {...p,file:path.resolve(base,p.file),entryScene,requires:[...p.requires]};
  });
  unique(packs.map(p=>p.id),'RESOURCE_PACK_DUPLICATE_ID');
  need(packs.filter(p=>p.role==='boot').length===1,'RESOURCE_ONE_BOOT_REQUIRED');
  need(packs.reduce((s,p)=>s+p.bytes,0)<=MAX_INSPECT_BYTES,'RESOURCE_INSPECTION_BUDGET');
  const roots=packs.filter(p=>p.role==='resource').map(p=>p.root.toLowerCase());
  for(let i=0;i<roots.length;i++)for(let j=0;j<i;j++)need(!overlaps(roots[i],roots[j]),'RESOURCE_ROOT_OVERLAP');
  const dependencies=raw.dependencies.map(d=>{
    keys(d,['from','to','kind'],'RESOURCE_DEPENDENCY_KEYS');
    need(['exported-resource','runtime-declaration'].includes(d.kind),'RESOURCE_DEPENDENCY_KIND');
    return {from:resourcePath(d.from),to:resourcePath(d.to),kind:d.kind};
  });
  unique(dependencies.map(d=>d.from+'\0'+d.to+'\0'+d.kind),'RESOURCE_DEPENDENCY_DUPLICATE');
  return {schema:raw.schema,packs,dependencies,reservedRoots,reservedNames};
}

// Inventories must originate from inspectPck; this pure checker is also unit-testable.
// It never treats a caller-supplied inventory as a device/runtime certificate.
export function planResourceInventories(raw,inventories,{base=process.cwd(),sourceBuffers}={}){
  return planCheckedInventories(normalizeResourceConfig(raw,base),inventories,sourceBuffers);
}
function planCheckedInventories(config,inventories,sourceBuffers){
  const packs=config.packs,byId=new Map(packs.map(p=>[p.id,p])),boot=packs.find(p=>p.role==='boot');
  need(inventories instanceof Map&&inventories.size===packs.length,'RESOURCE_INVENTORY_SET');
  need(sourceBuffers===undefined||(sourceBuffers instanceof Map&&[...sourceBuffers.keys()].every(id=>byId.has(id))),'RESOURCE_SOURCE_BUFFER_SET');
  const order=[],visiting=new Set(),done=new Set(),closure=new Map();
  function visit(id){
    need(byId.has(id),'RESOURCE_DEPENDENCY_PACK_MISSING');
    if(done.has(id))return;
    need(!visiting.has(id),'RESOURCE_DEPENDENCY_CYCLE');visiting.add(id);
    const p=byId.get(id),needed=new Set();
    if(p.role==='resource'){visit(boot.id);needed.add(boot.id);}
    for(const dep of p.requires){need(dep!==id,'RESOURCE_DEPENDENCY_SELF');visit(dep);needed.add(dep);for(const transitive of closure.get(dep))needed.add(transitive);}
    closure.set(id,needed);visiting.delete(id);done.add(id);order.push(id);
  }
  visit(boot.id);for(const p of packs)visit(p.id);
  const owner=new Map(),caseOwner=new Map();
  for(const p of packs){
    const inv=inventories.get(p.id);
    need(inv?.status==='PASS_PCK_STRUCTURE_ONLY'&&inv.sha256===p.sha256&&inv.bytes===p.bytes,'RESOURCE_INVENTORY_PIN');
    need(inv.formatVersion===4&&inv.engineVersion?.major===4&&inv.engineVersion?.minor===7&&inv.engineVersion?.patch===2,'RESOURCE_ENGINE_VERSION_REVIEW_REQUIRED');
    for(const e of inv.entries){
      relative(e.path);
      need(!owner.has(e.path),'RESOURCE_CROSS_PACK_PATH_COLLISION');
      need(!caseOwner.has(e.path.toLowerCase()),'RESOURCE_CASE_ALIAS_COLLISION');
      if(p.role==='resource')need(!MAIN_METADATA.has(e.path),'RESOURCE_METADATA_BOOT_ONLY');
      owner.set(e.path,p.id);caseOwner.set(e.path.toLowerCase(),p.id);
    }
  }
  // A logical scene is accepted only as a direct owned file or through the
  // exact exported .remap payload. Caller inventory offsets are not evidence.
  const sceneRemaps=new Map(),checkedBuffers=new Map();
  function checkedPack(p){
    if(checkedBuffers.has(p.id))return checkedBuffers.get(p.id);
    const source=sourceBuffers?.get(p.id);
    need(Buffer.isBuffer(source),'RESOURCE_SCENE_REMAP_BYTES_REQUIRED');
    try{Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(source.buffer);}catch{fail('RESOURCE_SCENE_REMAP_BUFFER');}
    need(source.length===p.bytes&&createHash('sha256').update(source).digest('hex')===p.sha256,'RESOURCE_SCENE_REMAP_SOURCE_PIN');
    const snapshot=Buffer.from(source),actual=inspectPck(snapshot),declared=inventories.get(p.id);
    need(actual.bytes===p.bytes&&actual.sha256===p.sha256,'RESOURCE_SCENE_REMAP_SOURCE_PIN');
    need(actual.entries.length===declared.entries.length&&actual.entries.every((entry,index)=>['path','offset','bytes','md5','sha256'].every(key=>entry[key]===declared.entries[index][key])),'RESOURCE_SCENE_REMAP_INVENTORY_CHANGED');
    const checked={snapshot,entries:new Map(actual.entries.map(entry=>[entry.path,entry]))};checkedBuffers.set(p.id,checked);return checked;
  }
  function sceneOwner(logical){
    if(sceneRemaps.has(logical))return sceneRemaps.get(logical).packId;
    const direct=owner.get(logical),remapOwner=owner.get(logical+'.remap');
    if(remapOwner===undefined)return direct;
    // Having both representations is outside the single-remap contract.
    need(direct===undefined,'RESOURCE_SCENE_REMAP_AMBIGUOUS');
    const p=byId.get(remapOwner),checked=checkedPack(p),entry=checked.entries.get(logical+'.remap');
    need(entry&&entry.bytes>0&&entry.bytes<=16*1024,'RESOURCE_SCENE_REMAP_SIZE');
    let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(checked.snapshot.subarray(entry.offset,entry.offset+entry.bytes));}catch{fail('RESOURCE_SCENE_REMAP_GRAMMAR');}
    const match=/^[ \t\r\n]*\[remap\][ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*path[ \t]*=[ \t]*("(?:[^"\\\r\n]|\\.)*")[ \t]*(?:\r?\n[ \t]*)*$/.exec(text);
    need(match,'RESOURCE_SCENE_REMAP_GRAMMAR');
    let target;try{target=JSON.parse(match[1]);}catch{fail('RESOURCE_SCENE_REMAP_GRAMMAR');}
    target=resourcePath(target);need(target.endsWith('.scn'),'RESOURCE_SCENE_REMAP_TARGET');
    need(owner.get(target)===remapOwner&&checked.entries.has(target),'RESOURCE_SCENE_REMAP_TARGET_NOT_OWNED');
    sceneRemaps.set(logical,{packId:remapOwner,scene:'res://'+logical,remap:logical+'.remap',target:'res://'+target,sha256:entry.sha256});
    return remapOwner;
  }
  for(const p of packs)if(p.entryScene!==null)need(sceneOwner(p.entryScene)===p.id,'RESOURCE_ENTRY_SCENE_NOT_OWNED');
  need(owner.get('project.binary')===boot.id,'RESOURCE_BOOT_PROJECT_BINARY_REQUIRED');
  for(const d of config.dependencies){
    const resolve=name=>/\.(tscn|scn)$/.test(name)?sceneOwner(name):owner.get(name);
    const from=resolve(d.from),to=resolve(d.to);
    need(from!==undefined&&to!==undefined,'RESOURCE_DECLARED_FILE_DEPENDENCY_MISSING');
    need(from===to||closure.get(from).has(to),'RESOURCE_DECLARED_FILE_DEPENDENCY_ORDER');
  }
  const publicPacks=order.map(id=>{
    const p=byId.get(id),inv=inventories.get(id);
    return {id,role:p.role,bytes:p.bytes,sha256:p.sha256,entryScene:p.entryScene===null?null:'res://'+p.entryScene,requires:p.requires,
      mountAfter:[...closure.get(id)].sort(),entryCount:inv.entries.length,
      ...(p.role==='resource'?{subpackage:{name:id,root:p.root+'/'},codePackageFile:p.root+'/content.bin',requiredEntry:p.root+'/game.js'}:{})};
  });
  const identity={inputSchema:config.schema,packs:publicPacks,dependencies:config.dependencies,sceneRemaps:[...sceneRemaps.values()].sort((a,b)=>a.scene<b.scene?-1:a.scene>b.scene?1:0),reservedRoots:[...config.reservedRoots].sort(),reservedNames:[...config.reservedNames].sort()};
  return {schema:'wxslim-resource-plan-v1',status:'PASS_DECLARED_PACK_PLAN_ONLY',planSha256:createHash('sha256').update(JSON.stringify(identity)).digest('hex'),...identity,
    loadOrder:order,resourceFileCount:owner.size,pckBytes:packs.reduce((s,p)=>s+p.bytes,0),
    mountPolicy:{replaceFiles:false,conflicts:'rejected before mounting, never rely on first-wins',unloadSupported:false,retainMountedPackBytesOnFilesystem:true,hotReplacement:'NOT_SUPPORTED'},
    runtimeProtocol:['loadSubpackage success (not progress/complete)','read exact binary PCK','verify size and SHA256','copy to dedicated engine FS path','Godot load_resource_pack(path,false)','only a target with a declared scene may request scene loading after dependencies; null marks a mount-only dependency'],
    platformQuota:{status:'NOT_VERIFIED',reason:'PCK sum excludes engine/host and upload compression; official M units and accounting require tooling verification'},
    dependencyCoverage:'DECLARED_EDGES_ONLY_NOT_COMPLETE_RESOURCE_OR_UID_SCAN',
    implementation:{exporter:'NOT_IMPLEMENTED',runtimeLoader:'NOT_IMPLEMENTED',persistentCache:'NOT_IMPLEMENTED'},
    artifactIntegrityChecked:false,executionAuthorized:false,runtimeEligible:false,phone:'NOT_RUN',
    limitations:['Strict standalone PCK4 from fixed Godot 4.7.2 only; not a general format claim','Names/roots/path uniqueness and metadata ownership are tool constraints','No complete imported-resource, UID or script-class dependency scan yet','WeChat load task has no verified abort: cancellation may only stop later stages','Main project/UID/class metadata must be generated for the complete resource set; not verified here','No renderer or GLX acceptance inferred']};
}

export function inspectResourcePlan(raw,{base=process.cwd()}={}){
  const config=normalizeResourceConfig(raw,base),inventories=new Map(),sourceBuffers=new Map();
  for(const p of config.packs){
    const stat=fs.lstatSync(p.file);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===p.bytes,'RESOURCE_INPUT_FILE');
    const buffer=fs.readFileSync(p.file);
    need(buffer.length===p.bytes&&createHash('sha256').update(buffer).digest('hex')===p.sha256,'RESOURCE_INPUT_PIN');
    inventories.set(p.id,inspectPck(buffer));
    sourceBuffers.set(p.id,buffer);
  }
  return {...planCheckedInventories(config,inventories,sourceBuffers),artifactIntegrityChecked:true};
}
