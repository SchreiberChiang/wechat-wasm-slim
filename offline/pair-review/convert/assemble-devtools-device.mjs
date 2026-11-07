// Optional local acceptance mode for pinned c050 zh_CN packages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inventory,checkWorkersDirectory,checkReturnZero} from './lib/official-contract.mjs';
import {inspectResourcePlan,normalizeResourceConfig} from '../lib/resource-pack-plan.mjs';

const [taskArg,packsArg,outArg,appidArg,flag] = process.argv.slice(2);
assert(taskArg && packsArg && outArg && appidArg && [undefined,'--write'].includes(flag),
  'node assemble-devtools-device.mjs OFFICIAL_TASK RESOURCE_CONFIG OUT LOCAL_APPID_CONFIG [--write]');
const task=fs.realpathSync(taskArg), input=path.join(task,'converted','minigame'), out=path.resolve(outArg);
assert(!fs.existsSync(out) && fs.statSync(path.dirname(out)).isDirectory(),'Choose a new output with an existing parent');
function inside(root,target) {const rel=path.relative(root,target);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);}
assert(!inside(task,out) && !inside(out,task),'Protect existing official task');
const read=f=>fs.readFileSync(f), json=f=>JSON.parse(read(f)), pretty=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
function replaceOne(text,needle,next) {
  assert.equal(text.split(needle).length,2,'Expected unique anchor '+needle);
  return text.replace(needle,()=>next);
}
const terminal=json(path.join(task,'terminal.json')),auditData=read(path.join(task,'AUDIT.json')),audit=JSON.parse(auditData);
assert.equal(terminal.status,'SUCCESS');assert(terminal.details.childClosed && audit.returnZero);
assert.equal(terminal.details.auditSha256,sha(auditData));
const before=inventory(input);
assert.deepEqual(before,audit.files);
const payload=new Map(before.map(row=>[row.path,read(path.join(input,row.path))]));
function add(key,bytes) {
  assert(!payload.has(key) && !path.isAbsolute(key) && key.split('/').every(s=>s && s!=='.' && s!=='..' && !s.includes('\\')),'Duplicate or invalid package path');
  payload.set(key,bytes);
}
const proof=json(new URL('./assets/devtools-device-proof.json',import.meta.url));
const route=read(new URL('./assets/devtools-device-route.js',import.meta.url));assert.equal(sha(route),proof.routeSha256);
const strict=payload.get('framework.js').toString(),web=replaceOne(strict,proof.renderAnchorGlx,proof.renderAnchorWeb);
assert.equal(replaceOne(web,proof.renderAnchorWeb,proof.renderAnchorGlx),strict);checkReturnZero(strict);checkReturnZero(web);
add('framework-devtools.js',Buffer.from(web));
const entry=payload.get('game.js');add('start-device.js',entry);
add('start-devtools.js',Buffer.from(replaceOne(entry.toString(),'from "./framework"','from "./framework-devtools"')));
payload.set('game.js',route);
const kitPath='wx-game-kit/config.json', loaderPath='wx-game-kit/loader-config.js', renderPath='godot-data/render-config.json', renderJs='godot-data/render-config.js';
const kit=JSON.parse(payload.get(kitPath)),project=JSON.parse(payload.get('project.config.json')),appId=json(appidArg).appid;
assert(/^wx[0-9a-f]{16}$/.test(appId) && kit.project.app.appID===project.appid && project.compileType==='game');
assert(kit.runtime.contextConfig.contextExt.enableGLX===true && kit.runtime.contextConfig.contextExt.enableMetal===false && kit.runtime.contextConfig.contextType===2);
kit.project.app.appID=appId;project.appid=appId;payload.set(kitPath,pretty(kit));payload.set('project.config.json',pretty(project));
const desktopKit=structuredClone(kit);desktopKit.runtime.contextConfig.contextExt.enableGLX=false;add('wx-game-kit/config.devtools.json',pretty(desktopKit));
const loader=Buffer.from(replaceOne(payload.get(loaderPath).toString(),"'wx-game-kit/config.json'","(GameGlobal.__WXSLIM_ACCEPTANCE_ROUTE__.backend === 'webgl' ? 'wx-game-kit/config.devtools.json' : 'wx-game-kit/config.json')"));
assert.equal(sha(loader),proof.desktopLoaderSha256);payload.set(loaderPath,loader);
const raw=json(packsArg),base=path.dirname(path.resolve(packsArg));
inspectResourcePlan(raw,{base});const resource=normalizeResourceConfig(raw,base);
const manifest=JSON.parse(payload.get(renderPath)),game=JSON.parse(payload.get('game.json')),interfaces=payload.get('godot-data/local-interfaces.js');
assert(manifest.packageVersion===audit.packageId && manifest.requestedMode==='glx' && manifest.fallback==='error');
assert.equal(manifest.pckSha256,resource.packs.find(p=>p.role==='boot').sha256);
assert.equal(sha(interfaces),manifest.runtimeOptions.interfacesSha256);
assert(!/wx\.cloud|phoneLogIngest/.test(interfaces.toString()),'Local-only acceptance interface required');
for(const pack of resource.packs.filter(p=>p.role==='resource')) {
  const bytes=read(pack.file);assert.equal(sha(bytes),pack.sha256);assert.equal(bytes.length,pack.bytes);
  assert(interfaces.includes(pack.sha256) && interfaces.includes(pack.root+'/content.bin'),'Resource interface does not match this pack');
  assert(!game.subpackages.some(p=>p.name===pack.id || p.root===pack.root+'/'));
  game.subpackages.push({name:pack.id,root:pack.root+'/'});add(pack.root+'/game.js',Buffer.alloc(0));add(pack.root+'/content.bin',bytes);
}
payload.set('game.json',pretty(game));payload.delete(renderPath);payload.delete(renderJs);
const pins=()=>[...payload].map(([path,b])=>({path,bytes:b.length,sha256:sha(b)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const policy={schema:'wxslim-devtools-device-acceptance-v1',devtools:'webgl',device:'glx',capabilityFailure:'error',parent:manifest.packageVersion,telemetry:'local-only',assemblerSha256:sha(read(fileURLToPath(import.meta.url)))};
const next={...manifest,acceptancePolicy:policy};
next.packageVersion='wxslim-'+sha(pretty({assets:pins(),manifest:next})).slice(0,20);
add(renderPath,pretty(next));add(renderJs,Buffer.from('GameGlobal.__WXSLIM_RENDER_CONFIG__='+JSON.stringify(next)+';\nGameGlobal.__WXSLIM_RENDER_CONFIG__.requestedMode=GameGlobal.__WXSLIM_ACCEPTANCE_ROUTE__.backend;\n'));
const files=pins(),bytes=files.reduce((sum,p)=>sum+p.bytes,0);assert(bytes+1048576<32*1048576);
if(flag==='--write') {
  fs.mkdirSync(out);const dest=path.join(out,'minigame');fs.mkdirSync(dest);
  for(const dir of fs.readdirSync(input,{recursive:true,withFileTypes:true}).filter(e=>e.isDirectory()))fs.mkdirSync(path.join(dest,path.relative(input,path.join(dir.parentPath,dir.name))),{recursive:true});
  for(const [file,b] of payload){const target=path.join(dest,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b,{flag:'wx'});}
  const actual=inventory(dest);assert.equal(actual.length,files.length);
  for(const row of actual)assert.equal(row.sha256,sha(payload.get(row.path)));
  checkWorkersDirectory(dest,game);assert.deepEqual(inventory(input),before);
  fs.writeFileSync(path.join(out,'PACKAGE.json'),pretty({packageId:next.packageVersion,parent:manifest.packageVersion,payload:files,payloadBytes:bytes,policy}),{flag:'wx'});
}
console.log(JSON.stringify({packageId:next.packageVersion,parent:manifest.packageVersion,files:files.length,bytes,written:flag==='--write'}));
