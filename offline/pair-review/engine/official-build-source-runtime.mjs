// Future executor primitives. Merely importing this module performs no source
// reads or writes. Materialization requires explicit write:true and clean audit.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planOfficialBuild} from './official-build-plan.mjs';
import {prepareOfficialBuildSources,auditOfficialBuildCheckout} from './official-build-source.mjs';
const commit='c050c09b105c3715e1caa57a7109cd752047fd89';
const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=b=>({bytes:b.length,sha256:hash(b)});
const stable=v=>JSON.stringify(v,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const safe=p=>typeof p==='string'&&p&&!path.posix.isAbsolute(p)&&!/[\\:\0\r\n]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&s.toLowerCase()!=='.git');
const norm=p=>process.platform==='win32'?p.toLowerCase():p;
function exact(obj,keys){assert(obj&&typeof obj==='object'&&!Array.isArray(obj));assert.deepEqual(Reflect.ownKeys(obj).sort(),keys.slice().sort(),'SOURCE_RUNTIME_OPTIONS');for(const k of keys)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(obj,k),'value'),'SOURCE_RUNTIME_DATA_FIELDS');}
function rootPath(value){assert(typeof value==='string'&&path.isAbsolute(value)&&!/[\0\r\n]/.test(value),'SOURCE_RUNTIME_ABSOLUTE_ROOT');const root=path.resolve(value),s=fs.lstatSync(root);assert(s.isDirectory()&&!s.isSymbolicLink());assert.equal(norm(fs.realpathSync(root)),norm(root),'SOURCE_RUNTIME_ROOT_LINK');return root;}
function inside(root,p){assert(safe(p),'SOURCE_RUNTIME_PATH');const file=path.join(root,p);assert(norm(file).startsWith(norm(root)+path.sep));return file;}
function regular(root,p){const file=inside(root,p),s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink(),'SOURCE_RUNTIME_REGULAR');assert.equal(norm(fs.realpathSync(file)),norm(path.resolve(file)),'SOURCE_RUNTIME_LINK');return {file,stat:s};}
function sameFile(actual,expected,label){
 assert(actual.isFile()&&expected.isFile(),label);
 for(const k of ['size','mtimeMs','ctimeMs','ino','dev'])assert.equal(actual[k],expected[k],label);
}
async function filePin(root,p){
 const {file,stat}=regular(root,p),h=createHash('sha256');let bytes=0;
 for await(const chunk of fs.createReadStream(file)){bytes+=chunk.length;assert(bytes<=stat.size,'SOURCE_RUNTIME_FILE_GREW');h.update(chunk);}
 const after=regular(root,p).stat;assert.equal(bytes,stat.size);sameFile(after,stat,'SOURCE_RUNTIME_FILE_IDENTITY_CHANGED');
 return {bytes,sha256:h.digest('hex')};
}
function same(actual,expected,label){assert.deepEqual({bytes:actual.bytes,sha256:actual.sha256},{bytes:expected.bytes,sha256:expected.sha256},label);}
async function snapshot(root,beforeFile=()=>{}){
 const files=new Map(),directories=[],folded=new Set();
 async function visit(dir,prefix=''){
  for(const name of fs.readdirSync(dir)){
   if(!prefix&&name==='.git')continue;
   const p=prefix+name;assert(safe(p)&&!folded.has(p.toLowerCase()),'SOURCE_RUNTIME_COLLISION');folded.add(p.toLowerCase());
   const file=inside(root,p),s=fs.lstatSync(file);assert(!s.isSymbolicLink(),'SOURCE_RUNTIME_SYMLINK');assert.equal(norm(fs.realpathSync(file)),norm(file),'SOURCE_RUNTIME_LINK');
   if(s.isDirectory()){directories.push(p);await visit(file,p+'/');}else {assert(s.isFile(),'SOURCE_RUNTIME_SPECIAL');beforeFile(p,s);files.set(p,await filePin(root,p));}
  }
 }
 await visit(root);return {files,directories:directories.sort()};
}
function manifestRows(files){return [...files].sort(([a],[b])=>a.localeCompare(b)).map(([p,pin])=>({path:p,...pin}));}
function expectedDirs(files){const result=new Set();for(const p of files.keys()){let d=path.posix.dirname(p);while(d!=='.'){result.add(d);d=path.posix.dirname(d);}}return [...result].sort();}

export async function materializeOfficialBuildSources(options){
 assert.equal(arguments.length,1);exact(options,['source','gitExecutable','profile','upstreamSource','write']);assert.equal(options.write,true,'SOURCE_EXPLICIT_WRITE_TRUE');
 const root=rootPath(options.source),plan=planOfficialBuild({profile:options.profile});
 const baseAudit=await auditOfficialBuildCheckout({source:root,gitExecutable:options.gitExecutable,profile:options.profile,mode:'base'});
 const before=await snapshot(root);assert.equal(before.files.size,baseAudit.checkedFiles);
 assert(typeof options.upstreamSource==='string'&&path.isAbsolute(options.upstreamSource),'SOURCE_EXPLICIT_UPSTREAM_PATH');
 const upstreamFile=path.resolve(options.upstreamSource),upstreamStat=fs.lstatSync(upstreamFile);assert(upstreamStat.isFile()&&!upstreamStat.isSymbolicLink());
 assert.equal(norm(fs.realpathSync(upstreamFile)),norm(upstreamFile),'SOURCE_UPSTREAM_LINK');
 assert.equal(upstreamStat.size,plan.upstreamSource.fixedSource.bytes);const upstream=fs.readFileSync(upstreamFile);same(identity(upstream),plan.upstreamSource.fixedSource,'SOURCE_UPSTREAM_PIN');
 const blobs=new Map();for(const p of plan.officialInputs){const {file}=regular(root,p.path);const b=fs.readFileSync(file);same(identity(b),p,'SOURCE_OFFICIAL_INPUT');blobs.set(p.path,b);}
 const prepared=prepareOfficialBuildSources({profile:options.profile,officialBlobs:blobs,upstreamSource:upstream});assert.equal(prepared.receipt.planSha256,plan.planSha256);
 const expected=new Map(before.files);
 for(const p of plan.finalOutputs){
  assert.equal(p.added,!before.files.has(p.path),'SOURCE_OUTPUT_ADDED');
  const bytes=prepared.outputs.get(p.path);same(identity(bytes),p,'SOURCE_PREPARED_OUTPUT');
  if(!p.added)same(await filePin(root,p.path),before.files.get(p.path),'SOURCE_ORIGINAL_CHANGED_BEFORE_WRITE');
  let parent=path.posix.dirname(p.path),chain=[];while(parent!=='.'){chain.unshift(parent);parent=path.posix.dirname(parent);}
  for(const dir of chain){const target=inside(root,dir);if(!fs.existsSync(target))fs.mkdirSync(target);const s=fs.lstatSync(target);assert(s.isDirectory()&&!s.isSymbolicLink());assert.equal(norm(fs.realpathSync(target)),norm(target),'SOURCE_PARENT_LINK');}
  rootPath(root);
  const file=inside(root,p.path);let original=null;
  if(p.added)assert(!fs.existsSync(file),'SOURCE_ADDED_ALREADY_PRESENT');else {
   original=regular(root,p.path).stat;assert.equal(original.nlink,1,'SOURCE_WRITE_HARDLINK');
  }
  const fd=fs.openSync(file,p.added?'wx':'r+');try{
   // r+ does not truncate on open. Reject a replaced/symlinked destination
   // before writing any content through the descriptor. This is an identity
   // recheck, not an OS directory-handle lock against concurrent mutation.
   const opened=fs.fstatSync(fd);assert(opened.isFile(),'SOURCE_OPENED_NOT_REGULAR');assert.equal(opened.nlink,1,'SOURCE_OPENED_HARDLINK');
   if(original)sameFile(opened,original,'SOURCE_OPENED_IDENTITY_CHANGED');
   rootPath(root);
   for(const dir of chain){const target=inside(root,dir),s=fs.lstatSync(target);assert(s.isDirectory()&&!s.isSymbolicLink(),'SOURCE_PARENT_CHANGED');assert.equal(norm(fs.realpathSync(target)),norm(target),'SOURCE_PARENT_LINK');}
   sameFile(regular(root,p.path).stat,opened,'SOURCE_OPENED_PATH_CHANGED');
   fs.writeFileSync(fd,bytes);fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  same(await filePin(root,p.path),p,'SOURCE_WRITTEN_OUTPUT');expected.set(p.path,{bytes:p.bytes,sha256:p.sha256});
 }
 // Failures leave partial preparation in place; there is no reset, delete or retry.
 const preparedAudit=await auditOfficialBuildCheckout({source:root,gitExecutable:options.gitExecutable,profile:options.profile,mode:'prepared'});
 const after=await snapshot(root);assert.deepEqual([...after.files.keys()].sort(),[...expected.keys()].sort(),'SOURCE_PREPARED_INVENTORY');
 for(const [p,b]of after.files)same(b,expected.get(p),'SOURCE_PREPARED_MANIFEST');assert.deepEqual(after.directories,expectedDirs(expected));
 same(identity(fs.readFileSync(upstreamFile)),plan.upstreamSource.fixedSource,'SOURCE_UPSTREAM_DRIFT');
 const baseline={schema:'wxslim-official-prebuild-source-manifest-v1',commit,profile:options.profile,source:root,planSha256:plan.planSha256,
  files:manifestRows(expected),directories:after.directories,baseTree:baseAudit.tree,baseTrackedFiles:baseAudit.trackedBaseFiles,
  preparedCheckedFiles:preparedAudit.checkedFiles,generatedSources:plan.generatedSources,retiredSources:plan.retiredSources};
 return {baseline:{...baseline,manifestSha256:hash(Buffer.from(stable(baseline)))},receipt:{schema:'wxslim-official-source-materialization-v1',status:'PREPARED_SOURCE_ONLY_NOT_BUILD_ADMITTED',
  planSha256:plan.planSha256,baseAudit,preparedAudit,prepared:prepared.receipt,sourceWrites:plan.finalOutputs.length,
  nativeBuildRun:false,postbuildBaselineTrust:'Executor must freeze the returned complete manifest; its checksum alone is not independent authentication.'}};
}

// Classification means "record as generated and require review", never source
// admission. Even bin/cache paths cannot contain arbitrary injected C/Python.
export function classifyOfficialGeneratedPath(p){
 assert(safe(p),'POSTBUILD_PATH');
 // Fixed official SConstruct calls methods.dump/show_progress: these two root
 // metadata files are generated even without a TTY. Observe their identity,
 // never publish the environment dump or treat it as source/build admission.
 if(p==='.scons_env.json'||p==='.scons_node_count')return 'SCONS_METADATA_OBSERVED_NOT_ADMITTED';
 if(/(?:^|\/)[a-zA-Z0-9_.-]+\.gen\.(?:h|cpp)$/.test(p))return 'GODOT_GENERATED_SOURCE_PENDING_REVIEW';
 if(/\.(?:c|cc|cpp|cxx|h|hpp|py|mjs|gd|glsl|inc|inl)$/.test(p)||/(?:^|\/)(?:SCsub|SConstruct)$/.test(p))throw new Error('POSTBUILD_UNKNOWN_SOURCE '+p);
 if(p.startsWith('bin/')&&/\.(?:js|wasm|symbols|map|zip|a|o|br|gz|html|json|png|svg|ico)$/.test(p))return 'BIN_ARTIFACT_OBSERVED_NOT_ADMITTED';
 if(p.endsWith('.js'))throw new Error('POSTBUILD_UNKNOWN_SOURCE '+p);
 if(/\.(?:o|a)$/.test(p))return 'OBJECT_OR_ARCHIVE_OBSERVED_NOT_ADMITTED';
 if(/^\.sconsign[^/]*\.dblite$/.test(p)||/^\.scons_cache\/[a-fA-F0-9/]+$/.test(p))return 'SCONS_CACHE_OBSERVED_NOT_ADMITTED';
 throw new Error('POSTBUILD_UNKNOWN_GENERATED_FILE '+p);
}
export function compareOfficialPostbuildManifest({baselineFiles,actualFiles}){
 assert(baselineFiles instanceof Map&&actualFiles instanceof Map);const observed=[];
 for(const p of actualFiles.keys())assert(safe(p),'POSTBUILD_PATH');
 for(const [p,b]of baselineFiles){assert(safe(p),'POSTBUILD_BASELINE_PATH');assert(actualFiles.has(p),'POSTBUILD_SOURCE_MISSING '+p);same(actualFiles.get(p),b,'POSTBUILD_SOURCE_CHANGED '+p);}
 for(const [p,b]of actualFiles)if(!baselineFiles.has(p))observed.push({path:p,...b,classification:classifyOfficialGeneratedPath(p),admission:'NOT_ADMITTED'});
 return {sourceStable:true,generatedPendingReview:observed.length>0,observed,rawAdmission:'NOT_ADMITTED'};
}
export async function auditOfficialPostbuildSource(options){
 assert.equal(arguments.length,1);exact(options,['source','baseline']);const root=rootPath(options.source),baseline=options.baseline;
 assert(baseline&&baseline.schema==='wxslim-official-prebuild-source-manifest-v1'&&baseline.commit===commit);
 assert.equal(norm(root),norm(baseline.source),'POSTBUILD_BASELINE_ROOT');const {manifestSha256,...body}=baseline;assert.equal(hash(Buffer.from(stable(body))),manifestSha256,'POSTBUILD_BASELINE_HASH');
 const plan=planOfficialBuild({profile:baseline.profile});assert.equal(plan.planSha256,baseline.planSha256,'POSTBUILD_PLAN_CHANGED');
 const base=new Map();for(const p of baseline.files){assert(safe(p.path)&&!base.has(p.path));base.set(p.path,{bytes:p.bytes,sha256:p.sha256});}
 assert.equal(base.size,baseline.preparedCheckedFiles);for(const p of plan.finalOutputs){assert(base.has(p.path));same(base.get(p.path),p,'POSTBUILD_PLANNED_OUTPUT');}
 const beforeFile=(p,s)=>{if(base.has(p))assert.equal(s.size,base.get(p).bytes,'POSTBUILD_SOURCE_SIZE '+p);else classifyOfficialGeneratedPath(p);};
 const first=await snapshot(root,beforeFile),result=compareOfficialPostbuildManifest({baselineFiles:base,actualFiles:first.files});
 const newDirectories=first.directories.filter(p=>!baseline.directories.includes(p));
 for(const dir of newDirectories)assert(result.observed.some(p=>p.path.startsWith(dir+'/')),'POSTBUILD_UNKNOWN_EMPTY_DIRECTORY '+dir);
 const second=await snapshot(root,beforeFile);assert.deepEqual(manifestRows(second.files),manifestRows(first.files),'POSTBUILD_OBSERVATION_DRIFT');assert.deepEqual(second.directories,first.directories);
 return {schema:'wxslim-official-postbuild-source-audit-v1',status:'SOURCE_STABLE_GENERATED_PENDING_REVIEW_NOT_ADMITTED',...result,
  source:root,planSha256:plan.planSha256,baselineManifestSha256:manifestSha256,checkedSourceFiles:base.size,
  observedDirectories:newDirectories.map(path=>({path,admission:'NOT_ADMITTED'})),
  baselineTrust:'Requires executor-owned frozen prepared manifest; not standalone Git tree authentication.',sourceWritten:false,rawBuildAdmitted:false};
}
