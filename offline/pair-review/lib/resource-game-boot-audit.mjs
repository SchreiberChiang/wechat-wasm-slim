// Read-only verification of required resource runtime wiring in actual boot PCKs.
// Does not install, export, mount, execute scripts or establish dependency closure.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPck} from './pck-inventory.mjs';
import {normalizeResourceConfig,inspectResourcePlan} from './resource-pack-plan.mjs';
import {createResourceGameFacadeSources,preflightResourceGameFacadeBoot} from './resource-game-facade-sources.mjs';

const MiB=1024*1024,sha=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const pin=b=>({bytes:b.length,sha256:sha(b)});
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const plainPath=s=>typeof s==='string'&&s!==''&&s===s.normalize('NFC')&&!/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/.test(s)&&s.split('/').every(x=>x!==''&&x!=='.'&&x!=='..');
function utf8(b){const s=b.toString('utf8');need(Buffer.from(s).equals(b),'RESOURCE_BOOT_UTF8');return s;}
function reader(b){
  let offset=0;
  const take=n=>{need(Number.isSafeInteger(n)&&n>=0&&n<=b.length-offset,'RESOURCE_BOOT_SETTINGS_BOUNDS');const p=b.subarray(offset,offset+n);offset+=n;return p;};
  return {take,u32:()=>take(4).readUInt32LE(),done:()=>need(offset===b.length,'RESOURCE_BOOT_SETTINGS_TAIL')};
}
// Fixed c050 ProjectSettings::_save_settings_binary and marshalls.cpp STRING.
// Skip unrequested variants using their bounded stored lengths; never evaluate them.
function wiringProperties(b){
  need(b.length<=MiB,'RESOURCE_BOOT_SETTINGS_LIMIT');
  const r=reader(b),out=new Map(),seen=new Set();
  need(r.take(4).toString('ascii')==='ECFG','RESOURCE_BOOT_SETTINGS_MAGIC');
  const count=r.u32();need(count>0&&count<=16384,'RESOURCE_BOOT_SETTINGS_COUNT');
  for(let i=0;i<count;i++){
    const length=r.u32();need(length>0&&length<=4096,'RESOURCE_BOOT_SETTINGS_KEY');
    const key=utf8(r.take(length));need(!/[\x00-\x1f\x7f]/.test(key)&&!seen.has(key),'RESOURCE_BOOT_SETTINGS_DUPLICATE');seen.add(key);
    const size=r.u32();need(size>=4&&size<=MiB,'RESOURCE_BOOT_SETTINGS_VARIANT');const value=r.take(size);
    if(key!=='application/run/main_scene'&&!key.startsWith('application/run/main_scene.')&&!key.startsWith('autoload/'))continue;
    const v=reader(value);need(v.u32()===4,'RESOURCE_BOOT_SETTINGS_STRING_TYPE');
    const n=v.u32();need(n<=4096,'RESOURCE_BOOT_SETTINGS_STRING_LIMIT');const text=utf8(v.take(n));
    need(v.take((4-n%4)%4).every(x=>x===0),'RESOURCE_BOOT_SETTINGS_STRING_PADDING');v.done();out.set(key,text);
  }
  r.done();return out;
}

export function auditResourceGameBootPck(bytes,{entryScene}={}){
  need(Buffer.isBuffer(bytes)&&bytes.length<=256*MiB,'RESOURCE_BOOT_PCK_LIMIT');
  need(typeof entryScene==='string'&&entryScene.startsWith('res://')&&plainPath(entryScene.slice(6))&&/\.(tscn|scn)$/.test(entryScene),'RESOURCE_BOOT_ENTRY_SCENE');
  const inventory=inspectPck(bytes),bundle=createResourceGameFacadeSources(),entries=new Map(inventory.entries.map(e=>[e.path,e]));
  need(JSON.stringify(inventory.engineVersion)===JSON.stringify({major:4,minor:7,patch:2}),'RESOURCE_BOOT_ENGINE_VERSION');
  const payload=name=>{const e=entries.get(name);return e?bytes.subarray(e.offset,e.offset+e.bytes):null;};
  const blockers=[],scripts=[];
  for(const item of bundle.snapshots){
    const actual=payload(item.path),redirects=[item.path+'.remap',item.path.slice(0,-3)+'.gdc',item.path.slice(0,-3)+'.gdc.remap'].filter(n=>entries.has(n));
    if(redirects.length)blockers.push({code:'RESOURCE_BOOT_SCRIPT_REDIRECT_UNVERIFIED',path:item.path,redirects});
    if(!actual){blockers.push({code:'RESOURCE_BOOT_SCRIPT_MISSING',path:item.path});continue;}
    const current=pin(actual);scripts.push({path:item.path,...current});
    if(current.bytes!==item.bytes||current.sha256!==item.sha256)blockers.push({code:'RESOURCE_BOOT_SCRIPT_SOURCE_MISMATCH',path:item.path});
  }
  const settingsBytes=payload('project.binary');need(settingsBytes,'RESOURCE_BOOT_PROJECT_BINARY_REQUIRED');
  const settings=wiringProperties(settingsBytes),autoload=settings.get('autoload/WxResource'),main=settings.get('application/run/main_scene');
  if(autoload!=='*'+bundle.requiredAutoload.path)blockers.push({code:'RESOURCE_BOOT_AUTOLOAD_REQUIRED',actual:autoload??null,expected:'*'+bundle.requiredAutoload.path});
  for(const [key,value]of settings){
    if(key.startsWith('application/run/main_scene.')||key.startsWith('autoload/WxResource.')||key.startsWith('autoload/WxResourceReceiver.'))blockers.push({code:'RESOURCE_BOOT_WIRING_FEATURE_OVERRIDE_UNVERIFIED',key});
    if(!key.startsWith('autoload/'))continue;
    const resource=value.startsWith('*')?value.slice(1):value;
    if(key==='autoload/WxResourceReceiver'||(bundle.snapshots.some(p=>resource==='res://'+p.path)&&key!=='autoload/WxResource'))blockers.push({code:'RESOURCE_BOOT_DUPLICATE_RUNTIME_AUTOLOAD',key});
  }
  if(main!==entryScene)blockers.push({code:'RESOURCE_BOOT_MAIN_SCENE_MISMATCH',actual:main??null,expected:entryScene});
  const logical=entryScene.slice(6),remap=payload(logical+'.remap'),direct=entries.has(logical);let scene=null;
  if(direct&&remap)blockers.push({code:'RESOURCE_BOOT_AMBIGUOUS_SCENE_MAPPING',path:logical});
  else if(direct)scene={logical:entryScene,stored:logical,mapping:'DIRECT'};
  else if(remap){
    need(remap.length<=64*1024,'RESOURCE_BOOT_SCENE_REMAP_LIMIT');
    const match=/^[ \t\r\n]*\[remap\][ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*path[ \t]*=[ \t]*("(?:[^"\\\r\n]|\\.)*")[ \t]*(?:\r?\n[ \t]*)*$/.exec(utf8(remap));
    if(!match)blockers.push({code:'RESOURCE_BOOT_SCENE_REMAP_UNVERIFIED',path:logical});
    else{
      const target=JSON.parse(match[1]);
      if(typeof target!=='string'||!target.startsWith('res://')||!plainPath(target.slice(6))||!target.endsWith('.scn')||!entries.has(target.slice(6)))blockers.push({code:'RESOURCE_BOOT_SCENE_TARGET_UNVERIFIED',path:logical});
      else scene={logical:entryScene,stored:target.slice(6),mapping:'EXPORTED_SCENE_REMAP',remapSha256:sha(remap)};
    }
  }else blockers.push({code:'RESOURCE_BOOT_MAIN_SCENE_MISSING',path:logical});
  return {schema:'wxslim-resource-game-boot-pck-audit-v1',status:blockers.length?'BLOCKED':'PASS_REQUIRED_BOOT_WIRING_BYTES_ONLY',blockers,
    boot:pin(bytes),sourceSha256:bundle.sourceSha256,scripts,settings:{...pin(settingsBytes),autoload:autoload??null,mainScene:main??null},scene,
    requiredScriptMode:'EXACT_SOURCE_TEXT_ONLY_COMPILED_OR_REDIRECTED_SCRIPTS_UNVERIFIED',
    sceneSemantics:'NOT_PARSED_OR_RUN',dependencyClosure:'NOT_SCANNED',runtimeEligible:false,engineRun:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'};
}

const norm=s=>process.platform==='win32'?path.resolve(s).toLowerCase():path.resolve(s);
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
function read(file,limit){
  const before=fs.lstatSync(file,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file)&&before.size>0n&&before.size<=BigInt(limit),'RESOURCE_BOOT_FILE_LIMIT');
  const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(Number(before.size));
  try{
    need(same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_BOOT_INPUT_CHANGED');let n=0;
    while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,null);need(count>0,'RESOURCE_BOOT_INPUT_CHANGED');n+=count;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_BOOT_INPUT_CHANGED');
  }finally{fs.closeSync(fd);}
  need(same(before,fs.lstatSync(file,{bigint:true}))&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_BOOT_INPUT_CHANGED');return bytes;
}

export function inspectResourceGameBoot(request,{base=process.cwd()}={}){
  need(exact(request,['schema','projectFile','resourceConfigFile'])&&request.schema==='wxslim-resource-boot-check-v1','RESOURCE_BOOT_REQUEST');
  for(const key of ['projectFile','resourceConfigFile'])need(typeof request[key]==='string'&&request[key]!==''&&request[key]===request[key].trim()&&!/[\u0000-\u001f]/.test(request[key]),'RESOURCE_BOOT_REQUEST_PATH');
  const projectFile=path.resolve(base,request.projectFile),configFile=path.resolve(base,request.resourceConfigFile),configBytes=read(configFile,MiB),raw=JSON.parse(utf8(configBytes));
  const config=normalizeResourceConfig(raw,path.dirname(configFile)),plan=inspectResourcePlan(raw,{base:path.dirname(configFile)}),boot=config.packs.find(p=>p.role==='boot');
  const bytes=read(boot.file,256*MiB);need(bytes.length===boot.bytes&&sha(bytes)===boot.sha256,'RESOURCE_BOOT_INPUT_PIN');
  const entryScene=plan.packs.find(p=>p.role==='boot').entryScene,pack=auditResourceGameBootPck(bytes,{entryScene});
  const paths=inspectPck(bytes).entries.map(e=>e.path);if(pack.scene&&!paths.includes(entryScene.slice(6)))paths.push(entryScene.slice(6));
  const source=preflightResourceGameFacadeBoot({projectFile,bootSourcePaths:paths}),blockers=[...source.blockers,...pack.blockers];
  if(source.mainScene!==entryScene)blockers.push({code:'RESOURCE_BOOT_PROJECT_ENTRY_MISMATCH',actual:source.mainScene,expected:entryScene});
  need(sha(read(configFile,MiB))===sha(configBytes)&&sha(read(boot.file,256*MiB))===boot.sha256,'RESOURCE_BOOT_INPUT_CHANGED');
  return {schema:'wxslim-resource-boot-check-v1',status:blockers.length?'BLOCKED':'PASS_SOURCE_AND_REQUIRED_BOOT_WIRING_ONLY',blockers,
    resourceConfiguration:pin(configBytes),resourcePlanSha256:plan.planSha256,source,pack,
    exportedBootCoverage:pack.status==='PASS_REQUIRED_BOOT_WIRING_BYTES_ONLY'?'REQUIRED_RUNTIME_SOURCE_AND_SETTINGS_CHECKED':'NOT_PROVEN',
    projectWritten:false,executionAuthorized:false,export:'NOT_RUN',runtimeEligible:false,phone:'NOT_RUN',visual:'NOT_VERIFIED'};
}

export function inspectResourceGameBootRequest(file){
  file=path.resolve(file);const bytes=read(file,MiB),request=JSON.parse(utf8(bytes)),result=inspectResourceGameBoot(request,{base:path.dirname(file)});
  need(sha(read(file,MiB))===sha(bytes),'RESOURCE_BOOT_INPUT_CHANGED');return result;
}
