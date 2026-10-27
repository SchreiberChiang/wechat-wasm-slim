// Separate, provenance-recorded seed build. Never invokes trim's old BUILD resume gate.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {buildEnv,buildIdentity,sourceState,assertStageInputs,outputPair,SOURCE_TESTS,RUNTIME_TOKENS,resolveToolchain} from '../../trim/lib/build.mjs';
import {hash,json} from '../functional-acceptance/stage.mjs';
import {planPatch} from './patch.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const need=(ok,msg)=>{if(!ok)throw Error(msg);};
export const PINS={build:'d2e324538417b829cdd555a03e90847e4a03d556e357daf2871196b741bff85c',patch:'f275b6634d5949cb00e100ab363dbe9d37e8ad6fb171c20b3d43795d1f01bef2',node:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de',nodePath:'C:/Program Files/nodejs/node.exe'};
const identity=file=>{const b=fs.readFileSync(file);return {bytes:b.length,sha256:hash(b)};};
export function separate(a,b){a=path.resolve(a);b=path.resolve(b);for(const [x,y]of [[a,b],[b,a]]){const r=path.relative(x,y);need(r&&(path.isAbsolute(r)||r==='..'||r.startsWith('..'+path.sep)),'Input/output overlap');}}
export function manifest(dir){const rows=[];function walk(rel){for(const name of fs.readdirSync(path.join(dir,rel)).sort()){const p=path.join(rel,name),s=fs.lstatSync(path.join(dir,p));need(!s.isSymbolicLink(),'Symlink refused: '+p);if(s.isDirectory())walk(p);else{need(s.isFile(),'Regular file required');rows.push({path:p.replaceAll('\\','/'),...identity(path.join(dir,p))});}}}walk('');return rows;}
function writeNew(file,value){fs.writeFileSync(file,json(value),{flag:'wx'});}
function driverCheck(){need(path.resolve(process.execPath).toLowerCase()===path.resolve(PINS.nodePath).toLowerCase()&&process.version==='v24.18.0'&&identity(process.execPath).sha256===PINS.node,'Exact original build driver required');}
export function sconsArgs(parentArgs,profile){need(parentArgs.filter(a=>a.startsWith('build_profile=')).length===1,'Unique profile argument required');const args=parentArgs.map(a=>a.startsWith('build_profile=')?'build_profile='+profile:a);need(args.includes('optimize=size')&&args.includes('lto=thin')&&args.includes('--jobs=4')&&args.includes('linkflags=--emit-symbol-map -Wl,--thinlto-jobs=2')&&!args.some(a=>a.startsWith('cppdefines=')),'Unexpected optimization/macro arguments');return args;}
export function dryRunGate(text){
  const compileLines=text.split(/\r?\n/).filter(l=>/Compiling\s+.*\.cpp\s*\.\.\./.test(l));
  const sources=compileLines.map(l=>l.trim().replace(/^.*?Compiling\s+/,'').replace(/\s*\.\.\.$/,''));
  const allowed=new Set(['main/main.cpp','drivers/gles3/rasterizer_scene_gles3.cpp']);
  need(sources.length===2&&sources.every(s=>allowed.has(s.replaceAll('\\','/'))),'Dry-run exceeds two expected C++ units or misses them: '+sources.join(', '));
  need(!/Compiling\s+.*\.(c|cc)\s*\.\.\./.test(text),'Unexpected C compilation');
  need(/Linking (?:Program|Static Library)/.test(text),'Expected relink absent');
  return {pass:true,compilationUnits:sources,fullRebuild:false,meaning:'SCons dry-run plan only; actual execution still separately recorded'};
}
async function run(exe,args,{cwd,env,log,timeoutMs=7200000}){
  const fd=fs.openSync(log,'wx');const startedAt=new Date().toISOString();
  return await new Promise((resolve,reject)=>{const c=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore',fd,fd]});let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;spawn('taskkill.exe',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});},timeoutMs);
    c.once('error',e=>{clearTimeout(timer);fs.closeSync(fd);reject(e);});
    c.once('close',(code,signal)=>{clearTimeout(timer);fs.closeSync(fd);resolve({executable:exe,args,startedAt,finishedAt:new Date().toISOString(),code,signal,timedOut,log,...identity(log)});});
  });
}
function save(root,rec){fs.writeFileSync(path.join(root,'INCREMENTAL.json'),json(rec));}
async function parentCheck(base,tc){const b=fs.readFileSync(path.join(base,'BUILD.json'));need(hash(b)===PINS.build,'Exact finished parent BUILD required');const parent=JSON.parse(b);need(parent.finishedAt&&parent.initialization.status==='complete','Parent unfinished');
  const current=await buildIdentity({tc,profileFile:path.join(base,'profile.gdbuild'),stage:path.join(base,'engine'),lto:'thin',symbols:true,ltoJobs:2});
  need(JSON.stringify(current)===JSON.stringify(parent.identity),'SDK/library/driver/profile/input fingerprint changed');assertStageInputs(parent.stage,await sourceState(path.join(base,'engine')));return parent;
}
export async function prepare({base,toolchain,root}){
  driverCheck();base=path.resolve(base);root=path.resolve(root);separate(base,root);need(!fs.existsSync(root),'New output directory required');
  const tc=resolveToolchain(JSON.parse(fs.readFileSync(toolchain)),toolchain),parent=await parentCheck(base,tc),patch=path.join(here,'skip-default-3d-prewarm.patch');need(identity(patch).sha256===PINS.patch,'Patch drift');
  const next=planPatch(path.join(base,'engine')),before=manifest(path.join(base,'engine'));
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'logs'));fs.mkdirSync(path.join(root,'evidence'));fs.mkdirSync(path.join(root,'temp'));const work=path.join(root,'work');fs.mkdirSync(work);
  const rec={schema:'startup-prewarm-controlled-incremental-v1',startedAt:new Date().toISOString(),phase:'copying',base,toolchain:identity(toolchain),parentBuildSha256:PINS.build,patch:identity(patch),driver:{path:process.execPath,version:process.version,...identity(process.execPath)},seedPolicy:'Full ordinary fs.copyFile copies; no hardlinks; old BUILD never resumed or rewritten',events:[]};save(root,rec);
  writeNew(path.join(root,'evidence','PARENT_BUILD.json'),parent);writeNew(path.join(root,'evidence','parent-engine-manifest.json'),before);
  // fs.cp copies regular file bytes; verify content and independent file identities.
  fs.cpSync(path.join(base,'engine'),path.join(work,'engine'),{recursive:true,preserveTimestamps:true,errorOnExist:true,force:false});
  const seeded=manifest(path.join(work,'engine'));need(JSON.stringify(seeded)===JSON.stringify(before),'Seed byte manifest mismatch');
  for(const row of before){const a=fs.statSync(path.join(base,'engine',row.path)),b=fs.statSync(path.join(work,'engine',row.path));need(a.dev!==b.dev||a.ino!==b.ino,'Hardlink seed refused: '+row.path);}
  fs.copyFileSync(path.join(base,'profile.gdbuild'),path.join(work,'profile.gdbuild'),fs.constants.COPYFILE_EXCL);
  for(const [name,text]of Object.entries(next))fs.writeFileSync(path.join(work,'engine',name),text);
  const stage=await sourceState(path.join(work,'engine'));rec.parentIdentity=parent.identity;rec.stage=stage;rec.sconsArgs=sconsArgs(parent.sconsArgs,path.join(work,'profile.gdbuild'));
  const patchedTc={...tc,patches:[...tc.patches,patch]};rec.identity=await buildIdentity({tc:patchedTc,profileFile:path.join(work,'profile.gdbuild'),stage:path.join(work,'engine'),lto:'thin',symbols:true,ltoJobs:2});
  rec.seed={files:before.length,bytes:before.reduce((n,r)=>n+r.bytes,0),objects:before.filter(r=>r.path.endsWith('.o')).length,manifestSha256:hash(json(before)),copyManifestMatches:true,noHardlinks:true};
  const retained=path.join(root,'evidence','parent-bin-output');fs.mkdirSync(retained);const bin=path.join(work,'engine','bin');rec.retainedSeedOutputs=[];
  for(const item of fs.readdirSync(bin)){if(item==='obj')continue;const p=path.join(bin,item);if(fs.lstatSync(p).isFile()||item==='.web_zip'){fs.renameSync(p,path.join(retained,item));rec.retainedSeedOutputs.push(item);}}
  rec.phase='dry-running';save(root,rec);console.log('Seed verified; dry-run starting');
  const env={...buildEnv(tc),TEMP:path.join(root,'temp'),TMP:path.join(root,'temp'),EMCC_TEMP_DIR:path.join(root,'temp')};
  rec.dryRun=await run(tc.python,['-m','SCons','--dry-run',...rec.sconsArgs],{cwd:path.join(work,'engine'),env,log:path.join(root,'logs','dry-run.log')});save(root,rec);need(rec.dryRun.code===0,'Dry-run failed; inspect private log');
  try{rec.dryRunPlan=dryRunGate(fs.readFileSync(rec.dryRun.log,'utf8'));rec.phase='dry-run-approved';}catch(e){rec.phase='dry-run-refused';rec.failure=e.message;save(root,rec);throw e;}
  rec.parentPreservation=JSON.stringify(before)===JSON.stringify(manifest(path.join(base,'engine')))&&identity(path.join(base,'BUILD.json')).sha256===PINS.build;need(rec.parentPreservation,'Parent changed');save(root,rec);console.log(json({phase:rec.phase,seed:rec.seed,dryRunPlan:rec.dryRunPlan}));return rec;
}
export async function build({base,toolchain,root}){
  driverCheck();root=path.resolve(root);const file=path.join(root,'INCREMENTAL.json'),rec=JSON.parse(fs.readFileSync(file)),work=path.join(root,'work'),stage=path.join(work,'engine');
  need(rec.phase==='dry-run-approved','Successful two-unit dry-run required');need(path.resolve(base)===rec.base,'Parent path drift');const tc=resolveToolchain(JSON.parse(fs.readFileSync(toolchain)),toolchain);await parentCheck(base,tc);
  need(identity(path.join(here,'skip-default-3d-prewarm.patch')).sha256===PINS.patch,'Patch drift');assertStageInputs(rec.stage,await sourceState(stage));
  need(JSON.stringify(rec.sconsArgs)===JSON.stringify(sconsArgs(JSON.parse(fs.readFileSync(path.join(base,'BUILD.json'))).sconsArgs,path.join(work,'profile.gdbuild'))),'SCons arguments drift');
  rec.patchSha256=PINS.patch;
  rec.sourceChanges=Object.keys(planPatch(path.join(base,'engine'))).sort().map(name=>({path:name,before:identity(path.join(base,'engine',name)),after:identity(path.join(stage,name))}));
  rec.recipe={script:identity(fileURLToPath(import.meta.url)),patchPlanner:identity(path.join(here,'patch.mjs')),buildHelpers:identity(path.resolve(here,'../../trim/lib/build.mjs'))};
  fs.copyFileSync(fileURLToPath(import.meta.url),path.join(root,'evidence','incremental-recipe-at-build.mjs'),fs.constants.COPYFILE_EXCL);
  const env={...buildEnv(tc),TEMP:path.join(root,'temp'),TMP:path.join(root,'temp'),EMCC_TEMP_DIR:path.join(root,'temp')};rec.phase='building';save(root,rec);console.log('Controlled two-unit incremental build started');
  rec.build=await run(tc.python,['-m','SCons',...rec.sconsArgs],{cwd:stage,env,log:path.join(root,'logs','build.log')});rec.phase=rec.build.code===0?'compiled':'build-failed';save(root,rec);need(rec.build.code===0,'Build failed; original failure log preserved');
  for(const t of SOURCE_TESTS){const p=path.join(stage,'platform/web/js/tests',t);if(fs.existsSync(p)){const r=await run(process.execPath,[p],{cwd:stage,env,log:path.join(root,'logs',t+'.log')});rec.events.push(r);save(root,rec);need(r.code===0,'Source test failed: '+t);}}
  const name='godot.web.template_release.wasm32.nothreads',bin=path.join(stage,'bin'),zip=path.join(bin,'.web_zip'),rawDir=path.join(root,'raw');fs.mkdirSync(rawDir);
  for(const suffix of ['.js','.engine.js','.wrapped.js','.wasm','.js.symbols','.zip']){const p=path.join(bin,name+suffix);need(fs.existsSync(p),'Regenerated output missing: '+suffix);fs.copyFileSync(p,path.join(rawDir,name+suffix),fs.constants.COPYFILE_EXCL);}
  const wrapped=fs.readFileSync(path.join(bin,name+'.wrapped.js')),wasm=fs.readFileSync(path.join(bin,name+'.wasm'));need(!wrapped.toString().includes('__godotMinigameOriginalCommitFrame'),'Raw wrapped JS already postprocessed');
  need(fs.readFileSync(path.join(zip,'godot.js')).equals(wrapped)&&fs.readFileSync(path.join(zip,'godot.wasm')).equals(wasm),'Fresh template zip extraction differs from raw wrapped pair');
  rec.raw={wrapped:identity(path.join(bin,name+'.wrapped.js')),wasm:identity(path.join(bin,name+'.wasm')),postprocessCount:0};rec.phase='postprocessing';save(root,rec);
  rec.postprocess=await run(process.execPath,[path.join(stage,'godot_process.js')],{cwd:stage,env,log:path.join(root,'logs','postprocess.log')});save(root,rec);need(rec.postprocess.code===0,'Postprocess failed');rec.raw.postprocessCount=1;
  const glue=fs.readFileSync(path.join(zip,'godot.js'));for(const tok of RUNTIME_TOKENS)need(glue.toString().includes(tok),'Runtime token missing: '+tok);need(wasm.subarray(0,8).toString('hex')==='0061736d01000000','Invalid WASM');
  const br=zlib.brotliCompressSync(wasm,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:wasm.length}}),art=path.join(work,'artifacts');fs.mkdirSync(art);
  for(const [n,b]of Object.entries({'godot.js':glue,'godot.wasm':wasm,'godot.wasm.br':br}))fs.writeFileSync(path.join(art,n),b,{flag:'wx'});
  const symbols=fs.readFileSync(path.join(bin,name+'.js.symbols'),'utf8'),symbolMap={};for(const l of symbols.split('\n')){const i=l.indexOf(':');if(i>0)symbolMap[l.slice(0,i)]=l.slice(i+1).trim();}fs.writeFileSync(path.join(art,'godot.js.symbols'),symbols,{flag:'wx'});writeNew(path.join(art,'symbols.json'),symbolMap);
  const result={schema:'startup-prewarm-incremental-build-v1',startedAt:rec.build.startedAt,finishedAt:new Date().toISOString(),identity:rec.identity,stage:rec.stage,initialization:{status:'complete',policy:'Verified byte-copy seed plus exactly two-file guard; independent incremental provenance'},sconsArgs:rec.sconsArgs,parentBuildSha256:PINS.build,incrementalRecord:path.join(root,'INCREMENTAL.json'),symbols:true,outputsProvenance:'Fresh raw linker/wrapper outputs, godot_process.js applied once',...outputPair(glue,wasm,br)};
  writeNew(path.join(work,'BUILD.json'),result);rec.outputs=result.outputs;rec.pairing=result.pairing;rec.phase='artifacts-complete';rec.finishedAt=result.finishedAt;
  const before=JSON.parse(fs.readFileSync(path.join(root,'evidence','parent-engine-manifest.json')));rec.parentPreservation=JSON.stringify(before)===JSON.stringify(manifest(path.join(base,'engine')))&&identity(path.join(base,'BUILD.json')).sha256===PINS.build;need(rec.parentPreservation,'Parent changed');save(root,rec);console.log(json({phase:rec.phase,work,outputs:rec.outputs,pairing:rec.pairing}));return rec;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){need(['--phase','--base','--toolchain','--root'].includes(args[i])&&args[i+1]&&!opts[args[i]],'Expected --phase prepare|build --base BUILD --toolchain FILE --root NEW_ROOT');opts[args[i]]=args[i+1];}need(Object.keys(opts).length===4&&['prepare','build'].includes(opts['--phase']),'Four unique options required');await ({prepare,build}[opts['--phase']])({base:opts['--base'],toolchain:opts['--toolchain'],root:opts['--root']});}
  catch(e){console.error('Controlled incremental refused: '+e.stack);process.exitCode=1;}
}
