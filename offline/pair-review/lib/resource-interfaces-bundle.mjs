// Read-only compiler of static interfaces source. Does not write a runtime package.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeResourceConfig, planResourceInventories} from './resource-pack-plan.mjs';
import {inspectPck} from './pck-inventory.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
function runtimeBudget(packs){const resourceInputs=packs.filter(p=>p.role==='resource');need(resourceInputs.length>0&&resourceInputs.length<=128&&resourceInputs.reduce((n,p)=>n+p.bytes,0)<=64*1024*1024&&resourceInputs.every(p=>p.bytes>=4&&p.bytes<=32*1024*1024),'RESOURCE_INTERFACES_RUNTIME_LIMIT');}
const assets={command:'resource-command-bridge.js',reader:'resource-subpackage-reader.js',lifecycle:'resource-host-lifecycle.js',
  state:'resource-load-state-core.js',mount:'resource-mount-command-core.js',scene:'resource-scene-command-core.js',
  executor:'resource-executor.js',interfaces:'resource-interfaces-runtime.js'};
const json=value=>JSON.stringify(value).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

/** sourceBuffers are actual PCK bytes, never a caller-supplied validation receipt. */
export function renderResourceInterfaces({config,sourceBuffers,enginePins,developmentOnly,base=process.cwd()}){
  need(developmentOnly===true,'RESOURCE_INTERFACES_DEVELOPMENT_ONLY');
  need(enginePins&&Object.keys(enginePins).length===3&&['engineJsSha256','wasmSha256','pckSha256'].every(k=>typeof enginePins[k]==='string'&&/^[a-f0-9]{64}$/.test(enginePins[k])),'RESOURCE_INTERFACES_ENGINE_PINS');
  const normalized=normalizeResourceConfig(config,base),inventories=new Map(),owned=new Map();
  runtimeBudget(normalized.packs);
  need(sourceBuffers instanceof Map&&sourceBuffers.size===normalized.packs.length,'RESOURCE_INTERFACES_PCK_INPUTS');
  for(const p of normalized.packs){
    const bytes=sourceBuffers.get(p.id);
    need(Buffer.isBuffer(bytes)&&bytes.length===p.bytes&&sha(bytes)===p.sha256,'RESOURCE_INTERFACES_PCK_PIN');
    const snapshot=Buffer.from(bytes);owned.set(p.id,snapshot);inventories.set(p.id,inspectPck(snapshot));
  }
  const plan=planResourceInventories(config,inventories,{base,sourceBuffers:owned});
  const boot=plan.packs.find(p=>p.role==='boot'),resources=plan.packs.filter(p=>p.role==='resource');
  need(boot.sha256===enginePins.pckSha256,'RESOURCE_INTERFACES_BOOT_PIN');
  need(resources.length>0&&resources.length<=128&&resources.reduce((n,p)=>n+p.bytes,0)<=64*1024*1024&&resources.every(p=>p.bytes>=4&&p.bytes<=32*1024*1024),'RESOURCE_INTERFACES_RUNTIME_LIMIT');
  const manifest={packs:resources.map(p=>({id:p.id,root:p.subpackage.root.slice(0,-1),file:p.codePackageFile,
    bytes:p.bytes,sha256:p.sha256,entryScene:p.entryScene,requires:p.requires.filter(id=>id!==boot.id)}))};
  need(Buffer.byteLength(json(manifest))<240*1024,'RESOURCE_INTERFACES_MANIFEST_LIMIT');
  const spec={schema:'wxslim-resource-interfaces-spec-v1',planSha256:plan.planSha256,pins:{...enginePins},manifest};
  const assetPins={},modules=[];
  for(const [name,file] of Object.entries(assets)){
    const bytes=fs.readFileSync(new URL('../convert/assets/'+file,import.meta.url)),source=bytes.toString('utf8');
    assetPins[file]={bytes:bytes.length,sha256:sha(bytes)};
    modules.push(`var ${name} = (function () { var module = {exports:{}};\n${source}\nreturn module.exports; }());`);
  }
  const source=`/* Generated development interfaces. No platform acceptance implied. */\n(function (root) {\n'use strict';\n${modules.join('\n')}\ninterfaces({root:root,wx:typeof wx !== 'undefined' ? wx : root.wx,globalRoots:[typeof globalThis !== 'undefined' ? globalThis : null,typeof window !== 'undefined' ? window : null],spec:${json(spec)},factories:{command:command,reader:reader,lifecycle:lifecycle,state:state,mount:mount,scene:scene,executor:executor}});\n}(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis));\n`;
  return {schema:'wxslim-resource-interfaces-bundle-v1',source,bytes:Buffer.byteLength(source),sha256:sha(source),planSha256:plan.planSha256,
    generatorSha256:sha(fs.readFileSync(new URL('./resource-interfaces-bundle.mjs',import.meta.url))),assetPins,manifest,pins:{...enginePins},artifactIntegrityChecked:true,dependencyCoverage:plan.dependencyCoverage,
    enginePinsSource:'DECLARED_PINS_MATCHED_TO_RUNTIME_RENDER_CONFIG',developmentOnly:true,runtimeEligible:false,executionAuthorized:false,phone:'NOT_RUN',
    limitations:['PCK structure and declared edges only; not a complete dependency scan','Boot PCK must contain persistent receiver and scene-loader; not proven by this generator','No persistent terminal receipt, device runtime, quota or visual acceptance']};
}

/** Reads existing files only. No copy, export, network or write. */
export function renderResourceInterfacesFromFiles({config,base=process.cwd(),engine,expected,developmentOnly}){
  const normalized=normalizeResourceConfig(config,base),sourceBuffers=new Map();
  need(developmentOnly===true,'RESOURCE_INTERFACES_DEVELOPMENT_ONLY');runtimeBudget(normalized.packs);
  const ordinary=s=>need(s.isFile()&&!s.isSymbolicLink(),'RESOURCE_INTERFACES_INPUT_FILE');
  const same=(a,b)=>need(['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]),'RESOURCE_INTERFACES_INPUT_CHANGED');
  const read=(file,pinnedBytes)=>{
    const before=fs.lstatSync(file,{bigint:true});ordinary(before);
    need(before.size>0n&&before.size<=256n*1024n*1024n&&(pinnedBytes===undefined||before.size===BigInt(pinnedBytes)),'RESOURCE_INTERFACES_INPUT_SIZE');
    const fd=fs.openSync(file,'r');
    try{
      const opened=fs.fstatSync(fd,{bigint:true});ordinary(opened);same(before,opened);
      const buffer=Buffer.allocUnsafe(Number(before.size));let offset=0;
      while(offset<buffer.length){const n=fs.readSync(fd,buffer,offset,buffer.length-offset,null);need(n>0,'RESOURCE_INTERFACES_INPUT_CHANGED');offset+=n;}
      need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0,'RESOURCE_INTERFACES_INPUT_CHANGED');
      same(opened,fs.fstatSync(fd,{bigint:true}));const named=fs.lstatSync(file,{bigint:true});ordinary(named);same(before,named);return buffer;
    }finally{fs.closeSync(fd);}
  };
  for(const p of normalized.packs)sourceBuffers.set(p.id,read(p.file,p.bytes));
  const js=read(engine.js),wasm=read(engine.wasm),boot=normalized.packs.find(p=>p.role==='boot');
  need(sha(js)===expected.engineJsSha256&&sha(wasm)===expected.wasmSha256,'RESOURCE_INTERFACES_ENGINE_FILE_PIN');
  const result=renderResourceInterfaces({config,base,sourceBuffers,enginePins:{engineJsSha256:sha(js),wasmSha256:sha(wasm),pckSha256:boot.sha256},developmentOnly});
  return {...result,enginePinsSource:'EXISTING_FILES_HASHED_AND_MATCHED_TO_EXPECTED_PINS'};
}
