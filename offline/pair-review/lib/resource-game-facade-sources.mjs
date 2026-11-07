// Bounded source preparation and read-only boot wiring checks. Never installs,
// starts/imports/exports a project, changes addon settings or creates directories.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const LIMIT=1024*1024;
const NAMES=['godot-resource-game-facade.gd','godot-resource-command-receiver.gd','godot-resource-pack-session.gd','godot-resource-scene-loader.gd'];
const AUTOLOAD='WxResource="*res://godot-resource-game-facade.gd"';
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
function read(file){
  const before=fs.lstatSync(file,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_FACADE_SOURCE_FILE');
  need(before.size>0n&&before.size<=BigInt(LIMIT),'RESOURCE_FACADE_SOURCE_LIMIT');
  const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(Number(before.size));
  try{
    need(same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_FACADE_SOURCE_CHANGED');
    let at=0;while(at<bytes.length){const count=fs.readSync(fd,bytes,at,bytes.length-at,null);need(count>0,'RESOURCE_FACADE_SOURCE_CHANGED');at+=count;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_FACADE_SOURCE_CHANGED');
  }finally{fs.closeSync(fd);}
  need(same(before,fs.lstatSync(file,{bigint:true}))&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_FACADE_SOURCE_CHANGED');
  return bytes;
}
function text(value){
  need(typeof value==='string'||Buffer.isBuffer(value),'RESOURCE_FACADE_SOURCE_BYTES');
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  need(bytes.length>0&&bytes.length<=LIMIT,'RESOURCE_FACADE_SOURCE_LIMIT');
  const result=bytes.toString('utf8');need(Buffer.from(result).equals(bytes),'RESOURCE_FACADE_SOURCE_UTF8');return result;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function canonical(value){return typeof value==='string'&&value!==''&&value===value.normalize('NFC')&&!/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/.test(value)&&value.split('/').every(p=>p!==''&&p!=='.'&&p!=='..');}

export function createResourceGameFacadeSources(){
  const files=new Map(),snapshots=[];
  for(const name of NAMES){const bytes=read(fileURLToPath(new URL('./'+name,import.meta.url)));files.set(name,text(bytes));snapshots.push({path:name,...pin(bytes)});}
  const bytes=snapshots.reduce((n,p)=>n+p.bytes,0);need(bytes<=128*1024,'RESOURCE_FACADE_SOURCE_LIMIT');
  const implementation=pin(read(fileURLToPath(import.meta.url)));
  const runtimeProtocol=freeze({resourceAppSchema:'wxslim-resource-interfaces-v2',sessionSchema:'wxslim-resource-executor-session-v1',loadSchema:'wxslim-resource-executor-session-load-v1',cancelSchema:'wxslim-resource-executor-session-cancel-v1'});
  return Object.freeze({schema:'wxslim-resource-game-facade-sources-v2',files,bytes,snapshots:freeze(snapshots),implementation:freeze(implementation),runtimeProtocol,
    requiredAutoload:freeze({name:'WxResource',path:'res://godot-resource-game-facade.gd',line:AUTOLOAD,section:'autoload'}),
    reservedRootNames:freeze(['WxResource','WxResourceReceiver']),requiredBootSourcePaths:freeze([...NAMES]),
    sourceSha256:hash(JSON.stringify({snapshots,implementation,autoload:AUTOLOAD,runtimeProtocol})),
    loadPolicy:'SERIAL_SESSION_LOADS_WHILE_IDLE_HEALTHY',multiLevelSupported:true,
    resultRetention:freeze({summaryLimit:8,summaryPolicy:'RING_WITH_DROPPED_COUNT',rawPolicy:'LATEST_SETTLED_LOAD_ONLY',rawLimitBytes:LIMIT}),
    shutdownScope:'LOCAL_FACADE_DRAIN_NOT_JS_HOST_DISPOSAL',
    limitations:freeze(['Call load_pack(pack_id) explicitly; never chain WxSplit.enter_scene for that transition',
      'Serial loads use one resident receiver/session; next load requires the actual session to be IDLE and healthy',
      'Callbacks and deferred cleanup are generation-bound; the completed signal returns before another load is admitted',
      'Only eight recent completion summaries and the latest settled raw envelope are retained; older raw results are explicitly unavailable',
      'Pending cancellation or UNKNOWN does not release callbacks; original Promise must actually settle',
      'Foreign JS exceptions cannot be caught by this GDScript facade; pending state and retained callbacks remain',
      'A pending native read can prevent local shutdown completion indefinitely; no fake timeout or abort',
      'Forced removal or engine exit while pending is undrained and unknown, not a safe shutdown',
      'Requires APP v2 and session v1; older exported boot PCKs require a fresh source-matched export and are not admitted by this source check',
      'Source wiring and declared boot ownership are not actual exported-PCK completeness',
      'No JS host disposal, PCK unmount, staged-file cleanup, rollback or visual acceptance']),
    sourceValidation:'STATIC_TEXT_CHECKS_ONLY_NO_GODOT_PARSE',runtimeEligible:false,installationPerformed:false,
    godotRun:'NOT_RUN',export:'NOT_RUN',conversion:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED'});
}

// Only ordinary project.godot autoload/main-scene strings are interpreted.
// Complex/duplicate fields are blockers, never guessed or rewritten.
function projectFields(source,blockers){
  const autoload=new Map(),sections=new Set();let current='',mainScene=null;
  for(const raw of source.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith(';')||line.startsWith('#'))continue;
    if(line.startsWith('[')){
      if(!/^\[[A-Za-z0-9_/.]+\]$/.test(line)){blockers.push({code:'RESOURCE_FACADE_PROJECT_SECTION'});current='';continue;}
      current=line.slice(1,-1);if(sections.has(current))blockers.push({code:'RESOURCE_FACADE_PROJECT_DUPLICATE_SECTION',section:current});sections.add(current);continue;
    }
    if(current!=='autoload'&&!(current==='application'&&/^run\/main_scene\s*=/.test(line)))continue;
    const match=/^([A-Za-z_][A-Za-z0-9_/.]*)\s*=\s*("(?:[^"\\]|\\.)*")$/.exec(line);
    if(!match){blockers.push({code:'RESOURCE_FACADE_PROJECT_FIELD',section:current});continue;}
    let value;try{value=JSON.parse(match[2]);}catch(error){if(!(error instanceof SyntaxError))throw error;blockers.push({code:'RESOURCE_FACADE_PROJECT_STRING',field:match[1]});continue;}
    if(current==='autoload'){
      if(autoload.has(match[1]))blockers.push({code:'RESOURCE_FACADE_PROJECT_DUPLICATE_AUTOLOAD',name:match[1]});autoload.set(match[1],value);
    }else{
      if(mainScene!==null)blockers.push({code:'RESOURCE_FACADE_PROJECT_DUPLICATE_MAIN'});mainScene=value;
    }
  }
  return {autoload,mainScene};
}

/** In-memory static model entry. sourceFiles represent source bytes, NOT PCKs. */
export function preflightResourceGameFacadeBootSource({projectSource,sourceFiles,bootSourcePaths}){
  const project=text(projectSource),prepared=createResourceGameFacadeSources(),blockers=[];
  need(sourceFiles instanceof Map&&Array.isArray(bootSourcePaths)&&bootSourcePaths.length<=20000,'RESOURCE_FACADE_PREFLIGHT_INPUT');
  need(bootSourcePaths.every(canonical)&&new Set(bootSourcePaths).size===bootSourcePaths.length,'RESOURCE_FACADE_BOOT_PATHS');
  const owned=new Set(bootSourcePaths),{autoload,mainScene}=projectFields(project,blockers);
  if(autoload.get('WxResource')!=='*res://godot-resource-game-facade.gd')blockers.push({code:'RESOURCE_FACADE_AUTOLOAD_REQUIRED',expected:AUTOLOAD});
  for(const [name,value]of autoload){
    const resource=value.startsWith('*')?value.slice(1):value;
    if(NAMES.some(file=>resource==='res://'+file)&&(name!=='WxResource'||resource!=='res://godot-resource-game-facade.gd'))blockers.push({code:'RESOURCE_FACADE_DUPLICATE_RUNTIME_AUTOLOAD',name});
    if(name==='WxResourceReceiver')blockers.push({code:'RESOURCE_FACADE_RECEIVER_ROOT_RESERVED',name});
  }
  const inspected=[];
  for(const expected of prepared.snapshots){
    if(!owned.has(expected.path))blockers.push({code:'RESOURCE_FACADE_BOOT_SOURCE_NOT_DECLARED',path:expected.path});
    if(!sourceFiles.has(expected.path)){blockers.push({code:'RESOURCE_FACADE_BOOT_SOURCE_MISSING',path:expected.path});continue;}
    const bytes=Buffer.from(text(sourceFiles.get(expected.path))),actual=pin(bytes);inspected.push({path:expected.path,...actual});
    if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)blockers.push({code:'RESOURCE_FACADE_BOOT_SOURCE_CHANGED',path:expected.path});
  }
  let mainPath=null;
  if(typeof mainScene!=='string'||!mainScene.startsWith('res://')||!canonical(mainScene.slice(6))||!(/\.(tscn|scn)$/.test(mainScene))){
    blockers.push({code:'RESOURCE_FACADE_EXPLICIT_MAIN_SCENE_REQUIRED'});
  }else{
    mainPath=mainScene.slice(6);
    if(!owned.has(mainPath))blockers.push({code:'RESOURCE_FACADE_BOOT_MAIN_NOT_DECLARED',path:mainPath});
    if(!sourceFiles.has(mainPath))blockers.push({code:'RESOURCE_FACADE_BOOT_MAIN_MISSING',path:mainPath});
    else{
      const bytes=sourceFiles.get(mainPath),buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);need(buffer.length>0&&buffer.length<=LIMIT,'RESOURCE_FACADE_SOURCE_LIMIT');
      inspected.push({path:mainPath,...pin(buffer)});
      if(mainPath.endsWith('.tscn')){
        const scene=text(bytes);
        if(NAMES.some(file=>scene.includes('res://'+file)))blockers.push({code:'RESOURCE_FACADE_RUNTIME_ON_MAIN_SCENE',path:mainPath});
      }
    }
  }
  const projectPin=pin(Buffer.isBuffer(projectSource)?projectSource:Buffer.from(projectSource));
  const result={schema:'wxslim-resource-game-facade-boot-preflight-v2',status:blockers.length?'BLOCKED':'PASS_SOURCE_WIRING_ONLY',blockers,
    sourceSha256:prepared.sourceSha256,project:projectPin,files:inspected,declaredBootSourcePaths:[...bootSourcePaths],mainScene,
    requiredAutoload:prepared.requiredAutoload,reservedRootNames:prepared.reservedRootNames,
    legacyWxSplitPresent:autoload.has('WxSplit'),legacyEntryPolicy:'CALL_FACADE_DIRECTLY_DO_NOT_CHAIN_WXSPLIT_ENTER',
    loadPolicy:prepared.loadPolicy,multiLevelSupported:true,shutdownScope:prepared.shutdownScope,runtimeProtocol:prepared.runtimeProtocol,resultRetention:prepared.resultRetention,
    existingExportCompatibility:'NOT_PROVEN_REQUIRES_FRESH_SOURCE_MATCHED_EXPORT',
    dependencyClosure:'NOT_SCANNED',exportedBootCoverage:'NOT_PROVEN',sourceValidation:prepared.sourceValidation,
    installationPerformed:false,godotRun:'NOT_RUN',export:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',runtimeEligible:false};
  return freeze({...result,preflightSha256:hash(JSON.stringify(result))});
}

/** Read-only current project wrapper. Missing wiring yields blockers; unsafe
 * paths, inconsistent reads and other filesystem failures remain hard errors. */
export function preflightResourceGameFacadeBoot({projectFile,bootSourcePaths}){
  need(typeof projectFile==='string'&&projectFile.trim()===projectFile&&projectFile&&!/[\u0000-\u001f]/.test(projectFile),'RESOURCE_FACADE_PROJECT_PATH');
  projectFile=path.resolve(projectFile);const projectBytes=read(projectFile),project=text(projectBytes),sourceFiles=new Map(),readPins=[];
  const fields=projectFields(project,[]),main=fields.mainScene;
  const names=[...NAMES];if(typeof main==='string'&&main.startsWith('res://')&&canonical(main.slice(6))&&/\.(tscn|scn)$/.test(main))names.push(main.slice(6));
  for(const name of new Set(names)){
    const file=path.resolve(path.dirname(projectFile),name);
    try{const bytes=read(file);sourceFiles.set(name,bytes);readPins.push({file,...pin(bytes)});}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const result=preflightResourceGameFacadeBootSource({projectSource:projectBytes,sourceFiles,bootSourcePaths});
  need(hash(read(projectFile))===hash(projectBytes),'RESOURCE_FACADE_SOURCE_CHANGED');
  for(const item of readPins){const actual=pin(read(item.file));need(actual.bytes===item.bytes&&actual.sha256===item.sha256,'RESOURCE_FACADE_SOURCE_CHANGED');}
  return freeze({...result,projectFile,scope:'READ_ONLY_SOURCE_WIRING_AND_DECLARED_BOOT_PATHS_NOT_EXPORTED_PCK_AUDIT'});
}
