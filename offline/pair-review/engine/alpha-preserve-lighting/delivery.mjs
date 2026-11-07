// Explicit, offline preparation. Default operations are read-only; no uploads.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliDecompressSync, inflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {unpackPck,projectProperties} from '../startup-prewarm/scene.mjs';
import {auditBuffers} from '../audit-pair.mjs';

export const home=path.dirname(fileURLToPath(import.meta.url));
export const repo=path.resolve(home,'../..');
export const read=f=>fs.readFileSync(f);
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const recipe=JSON.parse(read(path.join(home,'delivery-recipe.json')));
export const historical=JSON.parse(read(path.join(home,recipe.historicalBuild)));
export const sourceMap={'simple.gd':'delivery-simple.gd','simple.tscn':'delivery-simple.tscn','project.godot':'delivery-project.godot','export_presets.cfg':'delivery-exports.cfg'};
export function sources(){return new Map(Object.entries(sourceMap).map(([n,f])=>[n,read(path.join(home,f))]));}
export function verifyRecipe(){
  for(const f of [...recipe.engine.patches,recipe.engine.windowsLinkPatch,recipe.engine.profile])assert.equal(sha(read(path.join(repo,f.path))),f.sha256,f.path);
  assert.equal(recipe.engine.library.sha256,historical.library.sha256);
  assert.equal(recipe.engine.source.commit,historical.source.commit);
  return {patches:recipe.engine.patches.length,windowsLinkPatch:true,scope:'hash verification, no build'};
}
export function applyByteEdits(input,rule){
  assert.equal(sha(input),rule.beforeSha256,'host source fingerprint');let cursor=0;const pieces=[];
  for(const e of rule.edits){assert(Number.isInteger(e.start)&&e.start>=cursor&&e.end>=e.start&&e.end<=input.length);assert.equal(sha(input.subarray(e.start,e.end)),e.removedSha256);pieces.push(input.subarray(cursor,e.start),Buffer.from(e.insert));cursor=e.end;}
  pieces.push(input.subarray(cursor));const out=Buffer.concat(pieces);assert.equal(sha(out),rule.afterSha256);return out;
}
// Read only selected members into memory after verifying the whole archive.
// No filesystem extraction, traversal paths, encrypted entries or ZIP64 support.
export function hostFromArchive(bytes){
  assert.equal(sha(bytes),recipe.host.archive.sha256,'host archive fingerprint');
  assert.equal(bytes.length,recipe.host.archive.bytes);
  let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  assert(eocd>=0);assert.equal(bytes.readUInt16LE(eocd+4),0);assert.equal(bytes.readUInt16LE(eocd+6),0);
  const count=bytes.readUInt16LE(eocd+10);assert(count<65535);let pos=bytes.readUInt32LE(eocd+16);const rows=[];
  for(let i=0;i<count;i++){
    assert.equal(bytes.readUInt32LE(pos),0x02014b50);const n=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32);
    rows.push({name:bytes.subarray(pos+46,pos+46+n).toString(),flags:bytes.readUInt16LE(pos+8),method:bytes.readUInt16LE(pos+10),packed:bytes.readUInt32LE(pos+20),size:bytes.readUInt32LE(pos+24),offset:bytes.readUInt32LE(pos+42)});pos+=46+n+extra+comment;
  }
  const files=new Map();
  for(const f of recipe.host.files){
    const matches=rows.filter(r=>r.name===f.path||r.name.endsWith('/'+f.path));assert.equal(matches.length,1,'unique archive member '+f.path);const r=matches[0];
    assert(!(r.flags&1)&&r.size===f.bytes&&r.size<2*1024*1024);assert.equal(bytes.readUInt32LE(r.offset),0x04034b50);
    const start=r.offset+30+bytes.readUInt16LE(r.offset+26)+bytes.readUInt16LE(r.offset+28),packed=bytes.subarray(start,start+r.packed);
    assert([0,8].includes(r.method));const b=r.method===0?packed:inflateRawSync(packed,{maxOutputLength:2*1024*1024});assert.equal(b.length,r.size);assert.equal(sha(b),f.sha256,f.path);files.set(f.path,b);
  }
  files.set('godot-loader.js',applyByteEdits(files.get('godot-loader.js'),JSON.parse(read(path.join(home,recipe.host.loaderEdits)))));
  return files;
}
export function returnZero(raw){
  const original='function evalCheckWxContextGlobalIdAvailable(){if(typeof Module!=="undefined"&&Module.wxContextGlobal&&typeof Module.wxContextGlobal.fetchAndIncId==="function"){return 1}return 0}';
  const text=raw.toString();assert.equal(text.split(original).length,2,'exactly one original ID function; do not stack postprocessing');
  return Buffer.from(text.replace(original,'function evalCheckWxContextGlobalIdAvailable(){return 0}'));
}
export function prebuiltPair(js,br){
  const wasm=brotliDecompressSync(br);for(const [k,b] of Object.entries({js,br,wasm}))assert.equal(sha(b),recipe.engine.prebuilt[k],'prebuilt '+k);
  return {js,br,wasm,origin:'verified-prebuilt',sourceBuild:'historical'};
}
export function rebuiltPair(dir){
  const build=JSON.parse(read(path.join(dir,'BUILD.json'))),cfg=recipe.engine;
  assert.equal(build.identity.pin,cfg.source.commit);assert.equal(build.identity.glxLibrary.sha256,cfg.library.sha256);
  assert.deepEqual(build.identity.patches.map(x=>x.sha256),cfg.patches.map(x=>x.sha256));assert.equal(build.identity.cppdefines,'');
  assert.equal(build.identity.lto,'thin');assert.equal(build.identity.ltoJobs,8);assert.equal(build.profileSha256,cfg.profile.sha256);
  assert.equal(build.identity.windowsAdapterSha256,historical.build.windowsLinkAdapterSha256);
  assert.equal(build.identity.hostRuntime.node.sha256,recipe.toolchain.driverNode.sha256);
  assert.equal(build.identity.sdk.pythonBase.sha256,recipe.toolchain.pythonBaseSha256);
  for(const f of recipe.toolchain.sdkFiles){const matches=build.identity.sdk.files.filter(x=>x.path.replaceAll('\\','/').endsWith('/'+f.path));assert.equal(matches.length,1,'SDK identity '+f.path);assert.equal(matches[0].sha256,f.sha256);}
  const normalize=a=>a.map(s=>s.startsWith('--jobs=')?'--jobs=<SCHEDULING>':s.startsWith('build_profile=')?'build_profile=<FULL_PROFILE>':s.startsWith('wx_glx_lib=')?'wx_glx_lib=<EXACT_026E_LIBRARY>':s);
  assert.deepEqual(normalize(build.sconsArgs),normalize(historical.build.sconsArgs));
  const glue=read(path.join(dir,'artifacts/godot.js')),wasm=read(path.join(dir,'artifacts/godot.wasm')),compressed=read(path.join(dir,'artifacts/godot.wasm.br'));
  const log=read(path.join(dir,'logs/build.log')).toString();assert(!/warning: undefined symbol:|error: undefined symbol:/i.test(log),'unresolved link symbol');
  assert(!/missing function:|unresolved symbol:/i.test(glue.toString()),'missing-function placeholder');
  const audit=auditBuffers({glue,wasm,compressed,build});
  return {js:returnZero(glue),br:compressed,wasm,origin:'rebuilt-audited',sourceBuild:sha(read(path.join(dir,'BUILD.json'))),audit};
}
export function checkPck(bytes){
  const entries=unpackPck(bytes);assert(entries.get('simple.gd')?.equals(sources().get('simple.gd')),'simple source mismatch');
  assert(entries.get('simple.tscn')?.equals(sources().get('simple.tscn')),'simple scene mismatch');
  const props=projectProperties(entries.get('project.binary'));
  assert(props.get('application/run/main_scene')?.includes(Buffer.from('simple.tscn')),'simple main scene');
  for(const n of entries.keys())assert(/^(simple\.(gd|tscn)(\.uid)?|project\.binary|\.godot\/(global_script_class_cache\.cfg|uid_cache\.bin))$/.test(n),'Unexpected PCK resource; review explicitly: '+n);
  return {sha256:sha(bytes),entries:[...entries.keys()]};
}
export function packageFiles({archive,pair,pck,appid,mode='glx'}){
  assert(['glx','webgl'].includes(mode));assert(/^wx[a-f0-9]{16}$/i.test(appid),'valid private AppID required');verifyRecipe();const content=checkPck(pck);
  const files=hostFromArchive(archive);files.set('engine/godot.js',pair.js);files.set('engine/godot.wasm.br',pair.br);files.set('engine/empty-tips.bin',pck);
  const identity={schema:'glx-simple-v1',mode,packageId:'glx-simple-'+sha(Buffer.from(JSON.stringify({pck:content.sha256,js:sha(pair.js),br:sha(pair.br),mode,loader:sha(files.get('godot-loader.js')),entry:sha(read(path.join(home,'delivery-entry.js'))),observer:sha(read(path.join(home,'delivery-observer.js'))),generator:sha(read(fileURLToPath(import.meta.url))),modeRule:sha(read(path.join(repo,'engine/assets/candidate-mode.js'))),recipe:sha(Buffer.from(JSON.stringify(recipe)))}))).slice(0,20),engineJsSha256:sha(pair.js),wasmSha256:sha(pair.wasm),brSha256:sha(pair.br),pckSha256:content.sha256,librarySha256:recipe.engine.library.sha256,globalId:'return 0',sourceBuild:pair.sourceBuild,visual:'NOT_VERIFIED'};
  const modeSource=read(path.join(repo,'engine/assets/candidate-mode.js')).toString().replace('__CANDIDATE_MODE__',JSON.stringify(mode)).replace('__CANDIDATE_IDENTITY__',JSON.stringify(identity));
  files.set('delivery-mode.js',Buffer.from(modeSource));files.set('delivery-observer.js',read(path.join(home,'delivery-observer.js')));files.set('game.js',read(path.join(home,'delivery-entry.js')));
  files.set('game.json',Buffer.from(JSON.stringify({deviceOrientation:'portrait',iOSHighPerformance:true,'iOSHighPerformance+':true,plugins:{},subpackages:[{name:'engine',root:'engine/'}]},null,2)+'\n'));
  files.set('project.config.json',Buffer.from(JSON.stringify({appid,projectname:'godot-glx-simple',compileType:'game',setting:recipe.host.compilerSettings},null,2)+'\n'));
  files.set('CANDIDATE.json',Buffer.from(JSON.stringify({identity,origin:pair.origin,files:[...files].map(([name,b])=>({path:name,bytes:b.length,sha256:sha(b)})),configurationIsPrivate:true,visual:'NOT_VERIFIED'},null,2)+'\n'));
  return files;
}
export function writeNew(dir,files){
  dir=path.resolve(dir);assert(!fs.existsSync(dir),'refuse existing output');assert(fs.statSync(path.dirname(dir)).isDirectory(),'parent must exist and be separately approved');
  for(const name of files.keys())assert(!name.split('/').some(x=>x==='..')&&!path.isAbsolute(name));
  fs.mkdirSync(dir);for(const [name,b] of files){const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b,{flag:'wx'});}
}
export function checkDependencies(config){
  verifyRecipe();assert.equal(sha(read(process.execPath)),recipe.toolchain.driverNode.sha256,'driver Node');
  for(const f of recipe.toolchain.sdkFiles)assert.equal(sha(read(path.join(config.sdk,f.path))),f.sha256,'SDK '+f.path);
  assert.equal(sha(read(config.library)),recipe.engine.library.sha256,'GLX library');
  assert.equal(sha(read(config.editor)),recipe.editor.sha256,'export editor');
  const run=code=>{const r=spawnSync(config.python,['-c',code],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  assert.equal(run('import platform; print(platform.python_version())'),'3.14.0');assert.equal(run('import SCons; print(SCons.__version__)'),'4.11.1');
  const base=run('import sys; print(sys._base_executable)');assert.equal(sha(read(base)),recipe.toolchain.pythonBaseSha256,'Python base');
  return {status:'PASS',scope:'versions and fixed file fingerprints; not a fresh installation or build'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const [cmd,file,out,write]=process.argv.slice(2);
    if(cmd==='recipe')console.log(JSON.stringify(verifyRecipe()));
    else if(cmd==='check')console.log(JSON.stringify(checkDependencies(JSON.parse(read(file)))));
    else if(cmd==='scene'){assert.equal(write,'--write','writing needs explicit --write');assert.equal(file,'simple');writeNew(out,sources());}
    else if(cmd==='package'){
      const cfg=JSON.parse(read(file));const pair=cfg.build?rebuiltPair(cfg.build):prebuiltPair(read(cfg.js),read(cfg.br));
      const files=packageFiles({archive:read(cfg.hostArchive),pck:read(cfg.pck),pair,appid:cfg.appid,mode:cfg.mode??'glx'});
      if(write==='--write')writeNew(out,files);else assert(!write,'unknown argument');
      console.log(JSON.stringify({status:write==='--write'?'PREPARED_NOT_RUN':'DRY_RUN',bytes:[...files.values()].reduce((n,b)=>n+b.length,0),fileCount:files.size,visual:'NOT_VERIFIED'}));
    } else throw Error('recipe | check CONFIG | scene simple NEW_DIR --write | package PRIVATE_CONFIG NEW_DIR [--write]');
  }catch(e){console.error(e.message);process.exitCode=1;}
}
