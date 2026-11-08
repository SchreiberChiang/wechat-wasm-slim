// Source-only preparation for a later shared install task. No filesystem writes.
// Existing user files are never treated as replaceable merely by their filename.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createResourceGameFacadeSources} from './resource-game-facade-sources.mjs';

const LIMIT=1024*1024,sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function text(bytes){need(Buffer.isBuffer(bytes)&&bytes.length<=LIMIT,'RESOURCE_PROJECT_SOURCE_LIMIT');const s=bytes.toString('utf8');need(Buffer.from(s).equals(bytes),'RESOURCE_PROJECT_SOURCE_UTF8');return s;}

// Change only an insertion into project.godot. The main scene, render settings,
// unrelated autoloads, comments, BOM and existing newline bytes stay unchanged.
function autoloadInsertion(project,bundle){
  const source=text(project),blockers=[],sections=new Set(),bindings=new Map();let section='',headerEnd=-1,offset=0;
  need(project.length>0,'RESOURCE_PROJECT_EMPTY');
  if(source.slice(1).includes('\ufeff')||source.includes('\0'))blockers.push({code:'RESOURCE_PROJECT_TEXT_UNVERIFIED'});
  if(/\r(?!\n)/.test(source))blockers.push({code:'RESOURCE_PROJECT_NEWLINES_UNVERIFIED'});
  for(const raw of source.split(/(?<=\n)/)){
    const line=raw.replace(/^\ufeff/,'').trim();offset+=raw.length;
    if(!line||line.startsWith(';')||line.startsWith('#'))continue;
    if(line.startsWith('[')){
      const match=/^\[([A-Za-z0-9_/.]+)\]$/.exec(line);
      if(!match){blockers.push({code:'RESOURCE_PROJECT_SECTION_UNVERIFIED'});section='';continue;}
      section=match[1];if(sections.has(section))blockers.push({code:'RESOURCE_PROJECT_DUPLICATE_SECTION',section});sections.add(section);
      if(section==='autoload')headerEnd=offset;continue;
    }
    if(section!=='autoload')continue;
    const match=/^([A-Za-z_][A-Za-z0-9_/.]*)\s*=\s*("(?:[^"\\]|\\.)*")$/.exec(line);
    if(!match){blockers.push({code:'RESOURCE_PROJECT_AUTOLOAD_FIELD_UNVERIFIED'});continue;}
    let value;try{value=JSON.parse(match[2]);}catch{blockers.push({code:'RESOURCE_PROJECT_AUTOLOAD_STRING_UNVERIFIED',name:match[1]});continue;}
    const name=match[1];if(bindings.has(name))blockers.push({code:'RESOURCE_PROJECT_DUPLICATE_AUTOLOAD',name});bindings.set(name,value);
    if(name==='WxResourceReceiver'||name.startsWith('WxResource.')||name.startsWith('WxResourceReceiver.'))blockers.push({code:'RESOURCE_PROJECT_RESERVED_AUTOLOAD',name});
    const resource=value.startsWith('*')?value.slice(1):value;
    if(resource.startsWith('uid://'))blockers.push({code:'RESOURCE_PROJECT_AUTOLOAD_UID_UNVERIFIED',name});
    if(name!=='WxResource'&&bundle.snapshots.some(p=>resource==='res://'+p.path))blockers.push({code:'RESOURCE_PROJECT_DUPLICATE_RUNTIME_AUTOLOAD',name});
  }
  const expected='*'+bundle.requiredAutoload.path;
  if(bindings.has('WxResource')){
    if(bindings.get('WxResource')!==expected)blockers.push({code:'RESOURCE_PROJECT_AUTOLOAD_CONFLICT',name:'WxResource'});
    return {after:project,blockers,insertion:null};
  }
  if(blockers.length)return {after:project,blockers,insertion:null};
  const eol=source.includes('\r\n')?'\r\n':'\n';
  const at=headerEnd<0?source.length:headerEnd;
  const prefix=at>0&&!source.slice(0,at).endsWith('\n')?eol:'';
  const added=prefix+(headerEnd<0?eol+'[autoload]'+eol:'')+bundle.requiredAutoload.line+eol;
  const after=Buffer.from(source.slice(0,at)+added+source.slice(at));need(after.length<=LIMIT,'RESOURCE_PROJECT_SOURCE_LIMIT');
  return {after,blockers,insertion:{byteOffset:Buffer.byteLength(source.slice(0,at)),text:added}};
}

/** In-memory plan and exact candidate bytes for a future executor. */
export function prepareResourceProjectSourceBytes({projectBytes,existingFiles}){
  need(existingFiles instanceof Map,'RESOURCE_PROJECT_SOURCE_FILES');
  const bundle=createResourceGameFacadeSources(),names=new Set(bundle.files.keys());
  need([...existingFiles.keys()].every(k=>names.has(k)),'RESOURCE_PROJECT_UNEXPECTED_FILE');
  const insertion=autoloadInsertion(projectBytes,bundle),blockers=[...insertion.blockers],changes=[],contents=new Map();
  for(const [name,source]of bundle.files){
    const expected=Buffer.from(source),existing=existingFiles.get(name);let action='CREATE';
    if(existingFiles.has(name)){
      need(Buffer.isBuffer(existing)&&existing.length<=LIMIT,'RESOURCE_PROJECT_SOURCE_LIMIT');
      action=existing.equals(expected)?'UNCHANGED':'CONFLICT';
      if(action==='CONFLICT')blockers.push({code:'RESOURCE_PROJECT_SOURCE_CONFLICT',path:name});
    }
    changes.push({path:name,action,before:existingFiles.has(name)?pin(existing):null,after:pin(expected)});
    if(action==='CREATE')contents.set(name,expected);
  }
  const projectChanged=!projectBytes.equals(insertion.after);
  changes.push({path:'project.godot',action:projectChanged?'INSERT_AUTOLOAD':'UNCHANGED',before:pin(projectBytes),after:pin(insertion.after),insertion:insertion.insertion});
  if(projectChanged)contents.set('project.godot',insertion.after);
  if(blockers.length)contents.clear();
  const result={schema:'wxslim-resource-project-source-plan-v1',status:blockers.length?'BLOCKED':contents.size?'READY_FOR_REVIEW_NOT_EXECUTION':'ALREADY_MATCHED_NOT_RUNTIME_PROOF',blockers,changes,
    sourceSha256:bundle.sourceSha256,requiredAutoload:bundle.requiredAutoload,requiredBootSourcePaths:bundle.requiredBootSourcePaths,
    plannedWrites:blockers.length?[]:changes.filter(c=>['CREATE','INSERT_AUTOLOAD'].includes(c.action)).map(c=>({path:c.path,action:c.action,bytes:c.after.bytes,sha256:c.after.sha256})),
    copyBytes:[...contents].filter(([name])=>name!=='project.godot').reduce((n,[,b])=>n+b.length,0),
    policy:'CREATE_MISSING_RUNTIME_FILES_ONLY; KEEP_EXACT_MATCHES; NEVER_OVERWRITE_CONFLICTING_SOURCE; INSERT_AUTOLOAD_ONLY',
    mainSceneChanged:false,existingProjectSettingsChanged:false,autoloadAdded:projectChanged&&!blockers.length,
    projectWritten:false,executionAuthorized:false,installerImplemented:true,installationAction:'resource-project-install',export:'NOT_RUN',runtimeEligible:false,phone:'NOT_RUN',
    limitations:['This command only plans; use the separate explicit shared install task for writes','Requires explicit project write approval before installation; no automatic rollback or retry','No editor-unsaved-state or noncooperating concurrent-writer lock guarantee','No UID resolution, complete dependency scan or exported PCK proof','Call WxResource.load_pack(pack_id); this plan does not change gameplay scene transitions']};
  return {plan:{...result,planSha256:sha(JSON.stringify(result))},contents};
}

function read(file){
  const before=fs.lstatSync(file,{bigint:true}),same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
  need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(LIMIT)&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_PROJECT_SOURCE_FILE');
  const fd=fs.openSync(file,'r'),b=Buffer.alloc(Number(before.size));
  try{need(same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_PROJECT_INPUT_CHANGED');let at=0;while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,null);need(n>0,'RESOURCE_PROJECT_INPUT_CHANGED');at+=n;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0&&same(before,fs.fstatSync(fd,{bigint:true})),'RESOURCE_PROJECT_INPUT_CHANGED');
  }finally{fs.closeSync(fd);}
  need(same(before,fs.lstatSync(file,{bigint:true}))&&norm(fs.realpathSync(file))===norm(file),'RESOURCE_PROJECT_INPUT_CHANGED');return b;
}
export function prepareResourceProjectSource(projectFile){
  need(typeof projectFile==='string'&&projectFile===projectFile.trim()&&projectFile&&!/[\u0000-\u001f]/.test(projectFile),'RESOURCE_PROJECT_PATH');
  projectFile=path.resolve(projectFile);need(path.basename(projectFile)==='project.godot','RESOURCE_PROJECT_PATH');
  const projectBytes=read(projectFile),bundle=createResourceGameFacadeSources(),existingFiles=new Map(),absent=[];
  for(const name of bundle.files.keys()){
    try{existingFiles.set(name,read(path.join(path.dirname(projectFile),name)));}catch(error){if(error.code!=='ENOENT')throw error;absent.push(name);}
  }
  const {plan,contents}=prepareResourceProjectSourceBytes({projectBytes,existingFiles});
  need(read(projectFile).equals(projectBytes),'RESOURCE_PROJECT_INPUT_CHANGED');
  for(const [name,b]of existingFiles)need(read(path.join(path.dirname(projectFile),name)).equals(b),'RESOURCE_PROJECT_INPUT_CHANGED');
  for(const name of absent){try{fs.lstatSync(path.join(path.dirname(projectFile),name));need(false,'RESOURCE_PROJECT_INPUT_CHANGED');}catch(error){if(error.code!=='ENOENT')throw error;}}
  return {plan:{...plan,projectFile,scope:'READ_ONLY_SOURCE_INSTALLATION_PLAN_NO_PROJECT_WRITE'},contents,projectBytes};
}
export function inspectResourceProjectSource(projectFile){return prepareResourceProjectSource(projectFile).plan;}
