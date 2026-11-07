// Byte planning/checking only; reads existing generator assets, never candidate
// directories. No writes, export, conversion, mount or CLI.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {inspectPck} from './pck-inventory.mjs';
import {renderResourceInterfaces} from './resource-interfaces-bundle.mjs';
import {renderCombinedResourceInterfaces} from './combined-resource-interfaces.mjs';

const HASH=/^[a-f0-9]{64}$/,ID=/^[a-z][a-z0-9_-]{0,47}$/;
const INPUT_LIMIT=256*1024*1024,PACK_LIMIT=32*1024*1024,TOTAL_PACK_LIMIT=64*1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
function need(v,code){if(!v)throw Object.assign(Error(code),{code});}
function clone(v,seen=new Set()){
  if(v===null||['string','boolean'].includes(typeof v))return v;
  if(typeof v==='number'){need(Number.isFinite(v),'RESOURCE_ASSEMBLY_JSON');return v;}
  need(v&&typeof v==='object'&&(Array.isArray(v)||[Object.prototype,null].includes(Object.getPrototypeOf(v))),'RESOURCE_ASSEMBLY_JSON');
  need(!seen.has(v),'RESOURCE_ASSEMBLY_JSON');seen.add(v);
  const out=Array.isArray(v)?[]:{};
  for(const key of Reflect.ownKeys(v)){
    if(Array.isArray(v)&&key==='length')continue;
    const d=Object.getOwnPropertyDescriptor(v,key);
    need(typeof key==='string'&&key!=='__proto__'&&d&&Object.hasOwn(d,'value'),'RESOURCE_ASSEMBLY_JSON');out[key]=clone(d.value,seen);
  }
  seen.delete(v);return out;
}
function exact(v,keys,code){need(v&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),code);}
function relative(v){
  need(typeof v==='string'&&v.length>0&&v.length<=1024&&v===v.normalize('NFC')&&Buffer.from(v).toString()===v&&!/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/u.test(v)&&v.split('/').every(p=>p&&p!=='.'&&p!=='..'),'RESOURCE_ASSEMBLY_PATH');return v;
}
const overlap=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
function bytesMap(input){
  need(input instanceof Map&&input.size<=10000,'RESOURCE_ASSEMBLY_FILES');
  const out=new Map(),aliases=new Set();let total=0;
  for(const [name,bytes]of input){
    relative(name);need(!aliases.has(name.toLowerCase()),'RESOURCE_ASSEMBLY_ALIAS');aliases.add(name.toLowerCase());
    need(Buffer.isBuffer(bytes),'RESOURCE_ASSEMBLY_BUFFER');
    try{Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(bytes.buffer);}catch{need(false,'RESOURCE_ASSEMBLY_BUFFER');}
    total+=bytes.length;need(total<=INPUT_LIMIT,'RESOURCE_ASSEMBLY_INPUT_BUDGET');out.set(name,Buffer.from(bytes));
  }
  for(const name of aliases){let at=name.indexOf('/');while(at>=0){need(!aliases.has(name.slice(0,at)),'RESOURCE_ASSEMBLY_FILE_DIRECTORY_ALIAS');at=name.indexOf('/',at+1);}}
  return out;
}
function jsonFile(files,name,value){
  need(files.has(name),'RESOURCE_ASSEMBLY_CONFIG_FILE_REQUIRED');let parsed;
  try{parsed=JSON.parse(files.get(name).toString('utf8'));}catch{need(false,'RESOURCE_ASSEMBLY_CONFIG_JSON');}
  need(isDeepStrictEqual(parsed,value),'RESOURCE_ASSEMBLY_CONFIG_BYTES_MISMATCH');
}
function unpackRoot(root){need(typeof root==='string'&&root.endsWith('/'),'RESOURCE_ASSEMBLY_ROOT');return relative(root.slice(0,-1));}
function checkedBase(game){
  need(!Object.hasOwn(game,'subPackages')&&Array.isArray(game.subpackages)&&game.subpackages.length===2,'RESOURCE_ASSEMBLY_OFFICIAL_SUBPACKAGES');
  const names=new Set(),roots=[];
  for(const p of game.subpackages){
    exact(p,['name','root'],'RESOURCE_ASSEMBLY_BASE_SUBPACKAGE');
    need(['wasmcode','data-package'].includes(p.name)&&!names.has(p.name)&&p.root===p.name+'/','RESOURCE_ASSEMBLY_OFFICIAL_SUBPACKAGES');names.add(p.name);roots.push(unpackRoot(p.root));
  }
  need(names.size===2,'RESOURCE_ASSEMBLY_OFFICIAL_SUBPACKAGES');
  if(Object.hasOwn(game,'parallelPreloadSubpackages')){
    need(Array.isArray(game.parallelPreloadSubpackages),'RESOURCE_ASSEMBLY_PARALLEL_PRELOAD');
    const seen=new Set();for(const p of game.parallelPreloadSubpackages){exact(p,['name'],'RESOURCE_ASSEMBLY_PARALLEL_PRELOAD');need(names.has(p.name)&&!seen.has(p.name),'RESOURCE_ASSEMBLY_PARALLEL_PRELOAD');seen.add(p.name);}
  }
  return {names,roots};
}
function exclusions(project,paths){
  need(project.minigameRoot===undefined||project.minigameRoot===''||project.minigameRoot==='.'||project.minigameRoot==='./','RESOURCE_ASSEMBLY_PROJECT_ROOT');
  const ignores=project.packOptions?.ignore??[];need(Array.isArray(ignores),'RESOURCE_ASSEMBLY_PACKAGE_RULE');
  for(const rule of ignores){
    exact(rule,['type','value'],'RESOURCE_ASSEMBLY_PACKAGE_RULE');need(typeof rule.value==='string'&&rule.value&&!/[\\\u0000-\u001f]/.test(rule.value),'RESOURCE_ASSEMBLY_PACKAGE_RULE');
    need(['file','folder','suffix'].includes(rule.type),'RESOURCE_ASSEMBLY_PACKAGE_RULE_UNSUPPORTED');
    const value=rule.value.replace(/^\.\//,'').replace(/\/$/,'').toLowerCase();
    need(value.length>0,'RESOURCE_ASSEMBLY_PACKAGE_RULE');
    for(const name of paths){const n=name.toLowerCase();need(!(rule.type==='suffix'?n.endsWith(value):rule.type==='file'?n===value:n===value||n.startsWith(value+'/')),'RESOURCE_ASSEMBLY_PACKAGE_EXCLUDED');}
  }
}
function record(file,buffer,kind){return {path:file,buffer,bytes:buffer.length,sha256:sha(buffer),kind};}

export function planResourceRuntimeAssembly({gameJSON,projectConfig,plan,manifest,candidateFiles,resourcePcks,runtimeInputs}){
  const combined=runtimeInputs!=null&&Object.hasOwn(runtimeInputs,'companion');
  exact(runtimeInputs,['config','sourceBuffers','enginePins',...(combined?['companion']:[])],'RESOURCE_ASSEMBLY_RUNTIME_INPUTS');
  const game=clone(gameJSON),project=clone(projectConfig),p=clone(plan),m=clone(manifest),base=bytesMap(candidateFiles);
  jsonFile(base,'game.json',game);jsonFile(base,'project.config.json',project);
  const existing=checkedBase(game);
  need(p.schema==='wxslim-resource-plan-v1'&&p.status==='PASS_DECLARED_PACK_PLAN_ONLY'&&p.runtimeEligible===false&&HASH.test(p.planSha256),'RESOURCE_ASSEMBLY_PLAN');
  const identity={inputSchema:p.inputSchema,packs:p.packs,dependencies:p.dependencies,sceneRemaps:p.sceneRemaps,reservedRoots:p.reservedRoots,reservedNames:p.reservedNames};
  need(sha(JSON.stringify(identity))===p.planSha256,'RESOURCE_ASSEMBLY_PLAN_IDENTITY');
  need(Array.isArray(p.packs)&&p.packs.filter(x=>x.role==='boot').length===1&&p.packs.every(x=>['boot','resource'].includes(x.role)),'RESOURCE_ASSEMBLY_PLAN');
  const boot=p.packs.find(x=>x.role==='boot'),resources=p.packs.filter(x=>x.role==='resource');
  const allIds=new Set(p.packs.map(x=>x.id));need(allIds.size===p.packs.length&&typeof boot.id==='string'&&ID.test(boot.id),'RESOURCE_ASSEMBLY_PLAN');
  const byId=new Map(p.packs.map(x=>[x.id,x])),visiting=new Set(),done=new Set();
  function visit(id){
    need(byId.has(id)&&!visiting.has(id),'RESOURCE_ASSEMBLY_DEPENDENCY');if(done.has(id))return;
    const item=byId.get(id);need(Array.isArray(item.requires)&&new Set(item.requires).size===item.requires.length,'RESOURCE_ASSEMBLY_DEPENDENCY');
    visiting.add(id);for(const dep of item.requires){need(dep!==id,'RESOURCE_ASSEMBLY_DEPENDENCY');visit(dep);}visiting.delete(id);done.add(id);
  }
  need(Array.isArray(boot.requires)&&boot.requires.length===0,'RESOURCE_ASSEMBLY_DEPENDENCY');for(const id of allIds)visit(id);
  need(resources.length>0&&resources.length<=128&&resourcePcks instanceof Map&&resourcePcks.size===resources.length,'RESOURCE_ASSEMBLY_RESOURCE_SET');
  exact(m,['packs'],'RESOURCE_ASSEMBLY_MANIFEST');need(Array.isArray(m.packs)&&m.packs.length===resources.length,'RESOURCE_ASSEMBLY_MANIFEST');
  const pins=new Map();for(const item of m.packs){exact(item,['id','root','file','bytes','sha256','entryScene','requires'],'RESOURCE_ASSEMBLY_MANIFEST');need(!pins.has(item.id),'RESOURCE_ASSEMBLY_DUPLICATE_NAME');pins.set(item.id,item);}
  const additions=[],newRoots=[],newNames=new Set(),newSubs=[];let total=0;
  for(const pack of resources){
    need(typeof pack.id==='string'&&ID.test(pack.id)&&!existing.names.has(pack.id)&&!newNames.has(pack.id),'RESOURCE_ASSEMBLY_DUPLICATE_NAME');newNames.add(pack.id);
    const root=unpackRoot(pack.subpackage?.root);need(pack.subpackage.name===pack.id&&/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(root),'RESOURCE_ASSEMBLY_ROOT');
    need(Array.isArray(p.reservedRoots)&&Array.isArray(p.reservedNames)&&!p.reservedNames.includes(pack.id)&&!p.reservedRoots.some(r=>overlap(relative(r).toLowerCase(),root.toLowerCase())),'RESOURCE_ASSEMBLY_RESERVED');
    need(!existing.roots.concat(newRoots).some(r=>overlap(r.toLowerCase(),root.toLowerCase())),'RESOURCE_ASSEMBLY_ROOT_OVERLAP');
    need(![...base.keys()].some(file=>overlap(file.toLowerCase(),root.toLowerCase())),'RESOURCE_ASSEMBLY_OVERWRITE');newRoots.push(root);
    need(pack.codePackageFile===root+'/content.bin'&&pack.requiredEntry===root+'/game.js'&&Array.isArray(pack.requires)&&pack.requires.every(id=>allIds.has(id)&&id!==pack.id)&&new Set(pack.requires).size===pack.requires.length,'RESOURCE_ASSEMBLY_PLAN');
    const expected={id:pack.id,root,file:pack.codePackageFile,bytes:pack.bytes,sha256:pack.sha256,entryScene:pack.entryScene,requires:pack.requires.filter(id=>id!==boot.id)};
    need(isDeepStrictEqual(pins.get(pack.id),expected),'RESOURCE_ASSEMBLY_MANIFEST_MISMATCH');
    need(Number.isSafeInteger(pack.bytes)&&pack.bytes>=104&&pack.bytes<=PACK_LIMIT&&HASH.test(pack.sha256),'RESOURCE_ASSEMBLY_PCK_BUDGET');total+=pack.bytes;need(total<=TOTAL_PACK_LIMIT,'RESOURCE_ASSEMBLY_PCK_BUDGET');
    const input=resourcePcks.get(pack.id);need(Buffer.isBuffer(input)&&input.length===pack.bytes,'RESOURCE_ASSEMBLY_PCK_PIN');
    const checked=bytesMap(new Map([[pack.codePackageFile,input]])).get(pack.codePackageFile),inventory=inspectPck(checked);
    need(inventory.sha256===pack.sha256&&inventory.formatVersion===4&&[inventory.engineVersion.major,inventory.engineVersion.minor,inventory.engineVersion.patch].join('.')==='4.7.2','RESOURCE_ASSEMBLY_PCK_PIN');
    additions.push(record(root+'/game.js',Buffer.alloc(0),'FIXED_EMPTY_ENTRY'),record(root+'/content.bin',checked,'PINNED_RESOURCE_PCK'));
    newSubs.push({name:pack.id,root:root+'/'});
  }
  // Rebuild from ALL actual PCK bytes and current static runtime sources. A
  // self-consistent public plan/hash is not proof of this runnable closure.
  const bundle=(combined?renderCombinedResourceInterfaces:renderResourceInterfaces)({...runtimeInputs,developmentOnly:true});
  need(bundle.planSha256===p.planSha256&&isDeepStrictEqual(bundle.manifest,m),'RESOURCE_ASSEMBLY_RUNTIME_PLAN_MISMATCH');
  need(base.has('godot-data/local-interfaces.js')&&base.get('godot-data/local-interfaces.js').equals(Buffer.from(bundle.source)),'RESOURCE_ASSEMBLY_INTERFACES_BYTES');
  need(base.has('godot-data/render-config.json'),'RESOURCE_ASSEMBLY_RENDER_CONFIG');
  let rendering;try{rendering=JSON.parse(base.get('godot-data/render-config.json').toString('utf8'));}catch{need(false,'RESOURCE_ASSEMBLY_RENDER_CONFIG');}
  need(rendering&&rendering.schema==='wxslim-render-config-v1'&&['glx','webgl'].includes(rendering.requestedMode)&&rendering.fallback==='error'&&/^wxslim-[a-f0-9]{20}$/.test(rendering.packageVersion),'RESOURCE_ASSEMBLY_RENDER_CONFIG');
  for(const key of ['engineJsSha256','wasmSha256','pckSha256'])need(rendering[key]===bundle.pins[key],'RESOURCE_ASSEMBLY_RENDER_PIN');
  need(rendering.runtimeOptions&&rendering.runtimeOptions.splitBridge===false&&rendering.runtimeOptions.interfacesSha256===bundle.sha256,'RESOURCE_ASSEMBLY_RENDER_INTERFACES');
  for(const pack of resources)need(resourcePcks.get(pack.id).equals(runtimeInputs.sourceBuffers.get(pack.id)),'RESOURCE_ASSEMBLY_RUNTIME_PCK_MISMATCH');
  exclusions(project,additions.map(x=>x.path));
  game.subpackages=game.subpackages.concat(newSubs);
  const gameBuffer=Buffer.from(JSON.stringify(game,null,2)+'\n'),gameRecord=record('game.json',gameBuffer,'GAME_JSON_UPDATE');
  need([...base.values()].reduce((n,b)=>n+b.length,0)-base.get('game.json').length+gameBuffer.length+additions.reduce((n,a)=>n+a.bytes,0)<=INPUT_LIMIT,'RESOURCE_ASSEMBLY_OUTPUT_BUDGET');
  return {schema:'wxslim-resource-runtime-assembly-plan-v1',gameJSON:game,gameJSONFile:gameRecord,additions,
    diff:{changed:[{path:'game.json',before:{bytes:base.get('game.json').length,sha256:sha(base.get('game.json'))},after:{bytes:gameBuffer.length,sha256:sha(gameBuffer)}}],added:additions.map(({path,bytes,sha256,kind})=>({path,bytes,sha256,kind})),removed:[]},
    planSha256:p.planSha256,resourceBytes:total,subpackagesAdded:newSubs,executionAuthorized:false,runtimeEligible:false,engineRun:'NOT_RUN',
    runtimeBinding:{interfacesSha256:bundle.sha256,interfacesBytes:bundle.bytes,pins:bundle.pins,generatorSha256:bundle.generatorSha256,assetPins:bundle.assetPins,...(combined?{composition:bundle.composition}:{}),source:'RECOMPUTED_FROM_ALL_PCK_BYTES_AND_CURRENT_ASSETS'},
    dependencyCoverage:'DECLARED_PLAN_ONLY_NOT_A_RESOURCE_OR_UID_SCAN',
    evidenceScope:'IN_MEMORY_ORDINARY_RESOURCE_ASSEMBLY_ONLY',officialAuditRequired:'Re-audit boot/data/JS/WASM pairing and unsplit engine settings with the existing official audit; this module does not certify them',
    byteBudget:{candidateInputLimit:INPUT_LIMIT,resourceInputLimit:TOTAL_PACK_LIMIT,scope:'Logical input byte limits, not process memory peak or platform quota'}};
}

export function auditResourceRuntimeAssembly({originalGameJSON,gameJSON,projectConfig,plan,manifest,originalFiles,candidateFiles,resourcePcks,runtimeInputs}){
  const expected=planResourceRuntimeAssembly({gameJSON:originalGameJSON,projectConfig,plan,manifest,candidateFiles:originalFiles,resourcePcks,runtimeInputs});
  const actual=bytesMap(candidateFiles),base=bytesMap(originalFiles),wanted=new Map(base);
  wanted.set('game.json',expected.gameJSONFile.buffer);for(const item of expected.additions)wanted.set(item.path,item.buffer);
  need(isDeepStrictEqual(clone(gameJSON),expected.gameJSON),'RESOURCE_ASSEMBLY_GAME_JSON_CHANGED');jsonFile(actual,'game.json',expected.gameJSON);
  need(actual.size===wanted.size&&[...wanted.keys()].every(name=>actual.has(name)),'RESOURCE_ASSEMBLY_FILE_SET');
  for(const [name,bytes]of wanted)need(actual.get(name).equals(bytes),'RESOURCE_ASSEMBLY_FILE_CHANGED');
  return {schema:'wxslim-resource-runtime-assembly-audit-v1',status:'PASS_STATIC_RESOURCE_ASSEMBLY_ONLY',planSha256:expected.planSha256,diff:expected.diff,
    files:[...actual].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),exactFileSet:true,originalFilesUnchangedExceptGameJSON:true,
    ordinaryResourcesOnly:true,executionAuthorized:false,runtimeEligible:false,engineRun:'NOT_RUN',runtimeBinding:expected.runtimeBinding,dependencyCoverage:expected.dependencyCoverage,officialAuditRequired:expected.officialAuditRequired};
}
