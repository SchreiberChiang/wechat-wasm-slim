// Content-only derivation. This module never imports an engine or runs build tools.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const PARENTS = Object.freeze({
  glx: {dir:'E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/candidate-glx', manifestSha256:'10157ec424746065718eb0929d91c046e43c045ec09509206416d412dd2ed2d3', packageId:'godot-official-glx-026e-a169d60be3d6db10c33c'},
  webgl: {dir:'E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-webgl-control-20261026-01/candidate-webgl', manifestSha256:'ec0ca6a01729c6d3cb8259b5e02dc46e92d4b793ec81afecdb658a605f18f91f', packageId:'godot-official-glx-026e-webgl-control-1f5d72f561644b764c5d'}
});
export const CHANGED_PATHS = ['CANDIDATE.json','candidate-mode.js','candidate-relay.js','engine/empty-tips.bin','project.config.json','project.private.config.json'].sort();
export const ENGINE = Object.freeze({
  librarySha256:'026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8',
  pairSha256:'399b6522bd17f135087a669a9934ac68832efad837ad9fca418208a6dbbc316a',
  jsSha256:'e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb',
  brSha256:'a3fa7032ace37840021c58bd06b6b49f7b0468c01dde4b9d63a33bc2d2cd82cf',
  wasmSha256:'ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244',
  wasmBytes:65184325
});
export const hash = b => crypto.createHash('sha256').update(b).digest('hex');
export const json = x => JSON.stringify(x,null,2)+'\n';
export const manifest = files => [...files].map(([path,b])=>({path,bytes:b.length,sha256:hash(b)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const need = (ok,message) => {if(!ok)throw Error(message);};
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const self = fileURLToPath(import.meta.url);
const inside = (a,b) => {const r=path.relative(a,b);return !r||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
function plain(input) {
  need(typeof input==='string'&&input.length>0,'Nonempty path required');
  const absolute=path.resolve(input);
  for(let p=absolute;;p=path.dirname(p)) {
    try {need(!fs.lstatSync(p).isSymbolicLink(),'Symlink/reparse path refused: '+p);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(path.dirname(p)===p)break;
  }
  return absolute;
}
export function readTree(input,{source=false}={}) {
  const dir=plain(input),files=new Map();need(fs.lstatSync(dir).isDirectory(),'Directory required');
  function walk(rel) {
    for(const name of fs.readdirSync(path.join(dir,rel)).sort()) {
      // Generated imports and VCS state are not scene source inputs.
      if(source&&['.godot','.git'].includes(name))continue;
      const key=path.posix.join(rel,name),file=path.join(dir,key),s=fs.lstatSync(file);
      need(!s.isSymbolicLink(),'Symlink/reparse tree entry refused: '+key);
      if(s.isDirectory())walk(key);else {need(s.isFile(),'Regular file required: '+key);files.set(key,fs.readFileSync(file));}
    }
  }
  walk('');return files;
}
export function verifyParent(files,mode,rule=PARENTS[mode]) {
  need(rule&&files.size===27&&hash(files.get('CANDIDATE.json')||'')===rule.manifestSha256,'Pinned parent manifest/tree mismatch: '+mode);
  const record=JSON.parse(files.get('CANDIDATE.json'));
  const without=new Map(files);without.delete('CANDIDATE.json');
  need(equal(manifest(without),record.fileManifest),'Parent sealed file manifest mismatch: '+mode);
  need(record.identity.packageId===rule.packageId&&record.identity.mode===mode&&record.identity.cloudRelay==='disabled','Parent identity mismatch');
  need(record.identity.librarySha256===ENGINE.librarySha256&&record.identity.enginePairSha256===ENGINE.pairSha256,'Original engine/library required');
  need(hash(files.get('engine/godot.js'))===ENGINE.jsSha256&&hash(files.get('engine/godot.wasm.br'))===ENGINE.brSha256,'Original engine bytes required; pixel probe engines refused');
  need(record.enginePair.sha256===ENGINE.pairSha256&&record.enginePair.brotliDecodesToWasm===true&&hash(JSON.stringify(record.engineOutputs))===ENGINE.pairSha256,'Original engine pair record mismatch');
  const decoded=zlib.brotliDecompressSync(files.get('engine/godot.wasm.br'));
  need(decoded.length===ENGINE.wasmBytes&&hash(decoded)===ENGINE.wasmSha256,'Original decoded WASM mismatch');
  need(record.engineOutputs['godot.js'].sha256===ENGINE.jsSha256&&record.engineOutputs['godot.wasm.br'].sha256===ENGINE.brSha256&&record.engineOutputs['godot.wasm'].sha256===ENGINE.wasmSha256,'Engine output record mismatch');
  return record;
}
export function validateScene(pck,sourceFiles) {
  need(Buffer.isBuffer(pck)&&pck.length>=112&&pck.subarray(0,4).toString()==='GDPC','Standalone Godot PCK required');
  need(sourceFiles.has('project.godot')&&sourceFiles.has('export_presets.cfg'),'Scene source requires project.godot and export_presets.cfg');
  // These refer specifically to invasive probe packages, not ordinary SubViewports.
  const forbidden=/offscreen-3d-probe|offscreen3d-probe|godot_js_offscreen_probe|OFFSCREEN_3D_PROBE|__Offscreen3DProbe/i;
  for(const [name,b] of sourceFiles)need(!forbidden.test(name)&&!forbidden.test(b.toString()),'Pixel probe marker refused in scene source: '+name);
  need(!forbidden.test(pck.toString()),'Pixel probe marker refused in PCK');
  return {scenePckSha256:hash(pck),sceneSourceManifestSha256:hash(json(manifest(sourceFiles)))};
}
function replaceOne(src,old,next,label) {need(src.split(old).length===2,'Ambiguous '+label);return src.replace(old,()=>next);}
export function derive(parentFiles,mode,pck,scene,stagerSha256,rule=PARENTS[mode]) {
  const parent=verifyParent(parentFiles,mode,rule),old=parent.identity;
  const core={schema:'ios-functional-acceptance-identity-v1',mode,parentPackageId:old.packageId,parentManifestSha256:rule.manifestSha256,
    parentEnginePairSha256:old.enginePairSha256,enginePairSha256:old.enginePairSha256,librarySha256:old.librarySha256,
    sourcePin:old.sourcePin,patchSha256:old.patchSha256,buildRecordSha256:old.buildRecordSha256,
    pckSha256:scene.scenePckSha256,...scene,stagerSha256,scope:'local-only',cloudRelay:'disabled',upload:'not_uploaded',pureEnginePass:false};
  need(core.pckSha256===hash(pck),'Scene PCK identity mismatch');
  const identity={...core,packageId:'ios-functional-'+mode+'-'+hash(json(core)).slice(0,20)};
  const files=new Map(parentFiles),projectname=identity.packageId;
  files.set('engine/empty-tips.bin',pck);
  files.set('candidate-mode.js',Buffer.from(replaceOne(files.get('candidate-mode.js').toString(),
    'G.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(old)+');',
    'G.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(identity)+');','candidate identity')));
  files.set('candidate-relay.js',Buffer.from(replaceOne(files.get('candidate-relay.js').toString(),
    JSON.stringify({packageId:old.packageId,mode,cloudEnabled:false}),JSON.stringify({packageId:identity.packageId,mode,cloudEnabled:false}),'disabled relay identity')));
  for(const name of ['project.config.json','project.private.config.json']) {
    const src=files.get(name).toString(),config=JSON.parse(src);let count=0;
    const next=src.replace(/("projectname"\s*:\s*)("(?:[^"\\]|\\.)*")/g,(_,prefix,value)=>{need(JSON.parse(value)===config.projectname,'Projectname mismatch');count++;return prefix+JSON.stringify(projectname);});
    need(count===1,'Ambiguous projectname');const after=JSON.parse(next);need(equal({...after,projectname:config.projectname},config),'Config changed beyond projectname');files.set(name,Buffer.from(next));
  }
  files.delete('CANDIDATE.json');
  const record={schema:'ios-functional-acceptance-package-v1',identity,projectname,engineOutputs:parent.engineOutputs,enginePair:parent.enginePair,
    engineIntegrity:{jsSha256:ENGINE.jsSha256,brotliSha256:ENGINE.brSha256,decodedWasmSha256:ENGINE.wasmSha256,decodedWasmBytes:ENGINE.wasmBytes,brotliDecodedHashVerified:true},
    fileManifestScope:'Every file except CANDIDATE.json',fileManifest:manifest(files),
    changes:manifest(files).filter(r=>CHANGED_PATHS.includes(r.path)).map(r=>({...r,beforeSha256:hash(parentFiles.get(r.path))})),
    parentEvidence:{manifestSha256:rule.manifestSha256,meaning:'Parent engine/host provenance only; no new-scene runtime acceptance inherited'},
    state:{scope:'local-only',runtime:'not_run',visibleRendering:'not_verified',phone:'not_run',upload:'not_uploaded',preview:'not_authorized',cloudRelay:'disabled',cloudRequests:'not_sent'}};
  files.set('CANDIDATE.json',Buffer.from(json(record)));verifyDerived(files,parentFiles,record);return {files,record};
}
export function verifyDerived(files,parentFiles,record) {
  need(files.size===27,'Candidate file count changed');
  const changed=manifest(files).filter(r=>!parentFiles.get(r.path)?.equals(files.get(r.path))).map(r=>r.path).sort();
  need(equal(changed,CHANGED_PATHS),'Changes exceed exact six-path content/identity scope');
  const without=new Map(files);without.delete('CANDIDATE.json');need(equal(manifest(without),record.fileManifest),'Derived sealed manifest mismatch');
  need(hash(files.get('engine/empty-tips.bin'))===record.identity.scenePckSha256,'Derived scene PCK hash mismatch');
}
export function stage({scenePck,sceneSource,output}) {
  const out=plain(output),pckPath=plain(scenePck),source=plain(sceneSource);
  need(!fs.existsSync(out),'Output already exists; refusing overwrite');
  for(const input of [pckPath,source,...Object.values(PARENTS).map(x=>plain(x.dir))])need(!inside(input,out)&&!inside(out,input),'Output/input overlap');
  need(fs.lstatSync(pckPath).isFile(),'Regular PCK input required');
  const pck=fs.readFileSync(pckPath),sourceFiles=readTree(source,{source:true}),scene=validateScene(pck,sourceFiles),stagerSha256=hash(fs.readFileSync(self));
  // Validate both complete parents and both derived trees before any output write.
  const parents={};for(const mode of ['glx','webgl']) {parents[mode]=readTree(PARENTS[mode].dir);verifyParent(parents[mode],mode);}
  const candidates={};for(const mode of ['glx','webgl'])candidates[mode]=derive(parents[mode],mode,pck,scene,stagerSha256);
  need(candidates.glx.files.get('engine/empty-tips.bin').equals(candidates.webgl.files.get('engine/empty-tips.bin')),'Two scene PCKs differ');
  fs.mkdirSync(path.dirname(out),{recursive:true});plain(out);fs.mkdirSync(out);
  for(const mode of ['glx','webgl']) {
    const target=path.join(out,'candidate-'+mode);fs.mkdirSync(target);
    for(const [name,bytes]of candidates[mode].files) {const file=path.join(target,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}
    need(equal(manifest(readTree(target)),manifest(candidates[mode].files)),'Written candidate differs from validated plan');
  }
  const report={schema:'ios-functional-staging-v1',...scene,scenePckBytes:pck.length,sceneSource:source,sceneSourceManifestScope:'All scene source files except .godot and .git directories',sceneSourceManifest:manifest(sourceFiles),changedPaths:CHANGED_PATHS,
    candidates:['glx','webgl'].map(mode=>({mode,target:path.join(out,'candidate-'+mode),packageId:candidates[mode].record.identity.packageId,manifestSha256:hash(candidates[mode].files.get('CANDIDATE.json'))})),state:candidates.glx.record.state};
  fs.writeFileSync(path.join(out,'STAGING.json'),json(report),{flag:'wx'});return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===self) {
  try {const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){need(['--scene-pck','--scene-source','--output'].includes(args[i])&&!opts[args[i]]&&args[i+1]&&!args[i+1].startsWith('--'),'Usage: --scene-pck FILE --scene-source DIR --output NEW_DIR');opts[args[i]]=args[i+1];}need(Object.keys(opts).length===3,'All three arguments required');console.log(json(stage({scenePck:opts['--scene-pck'],sceneSource:opts['--scene-source'],output:opts['--output']})));}
  catch(e){console.error('Functional acceptance staging refused: '+e.message);process.exitCode=1;}
}
