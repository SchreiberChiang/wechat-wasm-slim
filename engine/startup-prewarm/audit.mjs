// Read-only baseline/source audit. Does not build, export, instantiate WASM or use WeChat.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hash,json,manifest,readTree,verifyParent} from '../functional-acceptance/stage.mjs';

export const BASELINE = Object.freeze({packageId:'ios-functional-glx-912c537585a6f3a07ef5',manifestSha256:'fa54b3f15d4fbb989bed9bf9a9c67743a1283e803684f17cb5598bf193938215'});
const need=(ok,msg)=>{if(!ok)throw Error(msg);};
export function inspectEngine(cpp,main,build) {
  const unconditional='material_storage->shaders.scene_shader.version_bind_shader(scene_globals.shader_default_version, SceneShaderGLES3::MODE_COLOR);';
  need(cpp.includes(unconditional),'Expected default scene shader bind missing; manual review required');
  need(!/skip_default_3d_prewarm|WX_LAB_RUNTIME_PREWARM_POLICY/.test(cpp+'\n'+main),'Engine policy changed; manual review required');
  need(build.identity.cppdefines===''&&build.identity.patches.length===1&&build.identity.patches[0].sha256==='84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6','Unexpected build policy/patch identity');
  return {projectSettingSupported:false,defaultSceneShaderBind:'unconditional',line:cpp.slice(0,cpp.indexOf(unconditional)).split('\n').length,engineRebuildRequiredToSkipDefault:true};
}
export function inspectScene(files) {
  const main=files.get('main.gd')?.toString()||'', project=files.get('project.godot')?.toString()||'';
  need(main.includes('select_step(0)'),'Unexpected startup scene selection');
  const catalog=JSON.parse(files.get('cases.json'));
  need(catalog.cards[0].steps[0].id==='B01-image','Unexpected startup case');
  const active=[];
  for(const [name,b] of files)if(/\.gd$/.test(name)&&/prewarm_default_3d_shader\s*\(|WxLabStartupControl|RenderingServer\.force_draw\s*\(/.test(b.toString()))active.push(name);
  need(active.length===0,'Possible scene prewarm calls require manual review: '+active.join(', '));
  need(!project.includes('skip_default_3d_prewarm'),'Scene contains unsupported setting');
  return {startupStep:'B01-image',activePrewarmCallMarkers:active,classification:'No explicit scene prewarm call found; 3D constructors remain in on-demand test functions',runtimeVerified:false};
}
export function verifyPackedScripts(pck,source) {
  need(pck.toString('ascii',0,4)==='GDPC','Standalone PCK required');
  const base=Number(pck.readBigUInt64LE(24));let cursor=Number(pck.readBigUInt64LE(32));
  const count=pck.readUInt32LE(cursor);cursor+=4;const packed=new Map();
  for(let i=0;i<count;i++) {
    const n=pck.readUInt32LE(cursor);cursor+=4;const name=pck.toString('utf8',cursor,cursor+n).replace(/\0+$/,'');cursor+=n;
    const offset=Number(pck.readBigUInt64LE(cursor));cursor+=8;const length=Number(pck.readBigUInt64LE(cursor));cursor+=8;
    const md5=pck.subarray(cursor,cursor+16).toString('hex');cursor+=16;need(pck.readUInt32LE(cursor)===0,'Encrypted/removed PCK entry refused');cursor+=4;
    const bytes=pck.subarray(base+offset,base+offset+length);need(bytes.length===length&&crypto.createHash('md5').update(bytes).digest('hex')===md5,'PCK entry hash mismatch');packed.set(name,bytes);
  }
  const checked=[];for(const [name,bytes]of packed)if(name.endsWith('.gd')){need(source.get(name)?.equals(bytes),'Packed/source script mismatch: '+name);checked.push(name);}
  need(checked.includes('main.gd')&&checked.includes('renderer.gd')&&checked.includes('renderer_base.gd')&&checked.includes('renderer_round3.gd'),'Expected packed scripts missing');
  return {entryCount:count,checkedScripts:checked.sort(),md5EntriesVerified:true};
}
export function audit({baseline,buildDir,sceneSource,output}) {
  const target=path.resolve(output);need(!fs.existsSync(target),'Output exists; refusing overwrite');
  const trees=readTree(baseline),record=verifyParent(trees,'glx',{dir:baseline,...BASELINE});
  const source=readTree(sceneSource,{source:true}),sourceHash=hash(json(manifest(source)));
  need(sourceHash===record.identity.sceneSourceManifestSha256,'Scene source differs from exact baseline source manifest');
  const buildFile=path.join(buildDir,'BUILD.json'),buildBytes=fs.readFileSync(buildFile),build=JSON.parse(buildBytes);
  need(hash(buildBytes)===record.identity.buildRecordSha256,'Build record differs from baseline');
  const cppPath=path.join(buildDir,'engine/drivers/gles3/rasterizer_scene_gles3.cpp'),mainPath=path.join(buildDir,'engine/main/main.cpp');
  const cpp=fs.readFileSync(cppPath),main=fs.readFileSync(mainPath);
  const report={schema:'startup-prewarm-readonly-audit-v1',at:new Date().toISOString(),baseline:BASELINE,sourceManifestSha256:sourceHash,
    engine:inspectEngine(cpp.toString(),main.toString(),build),scene:inspectScene(source),pck:verifyPackedScripts(trees.get('engine/empty-tips.bin'),source),
    sourceEvidence:[{path:cppPath,sha256:hash(cpp)},{path:mainPath,sha256:hash(main)},{path:buildFile,sha256:hash(buildBytes)}],
    retainedIncrementalDirectory:path.resolve(buildDir),decision:'No scene-only no-prewarm candidate exported; new engine patch/build needed for default shader bind',
    timing:{measurement:'not_run',prewarmDuration:'not_measured',startup30SecondsAttribution:'not_established',originalEvidence:'not_modified'},
    actions:{engineBuild:false,pckExport:false,wasmInstantiation:false,phone:false,devtools:false,upload:false,cloudRequests:false},
    scope:'Static source/build/package identity only; no native, WebGL or GLX runtime acceptance'};
  // All checks finish before creating a new, separate report directory.
  const inputs=[baseline,buildDir,sceneSource].map(x=>path.resolve(x));
  for(const input of inputs){const rel=path.relative(input,target);need(rel&& !(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)),'Output overlaps input');}
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'AUDIT.json'),json(report),{flag:'wx'});return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const opts={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];need(['--baseline','--build-dir','--scene-source','--output'].includes(key)&&!opts[key]&&process.argv[i+1],'Usage: --baseline DIR --build-dir DIR --scene-source DIR --output NEW_DIR');opts[key]=process.argv[i+1];}need(Object.keys(opts).length===4,'Four arguments required');console.log(json(audit({baseline:opts['--baseline'],buildDir:opts['--build-dir'],sceneSource:opts['--scene-source'],output:opts['--output']})));}
  catch(e){console.error('Prewarm audit refused: '+e.message);process.exitCode=1;}
}
