// Explicit future clean-checkout materializer. No invocation at module load.
// Reuses the original authenticated whole-tree preparation before seven writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {materializeOfficialBuildSources,compareOfficialPostbuildManifest,classifyOfficialGeneratedPath} from './official-build-source-runtime.mjs';
import {planOfficialBuild} from './official-build-plan.mjs';
import {planOfficialCapabilitySources} from './official-capability-source-plan.mjs';
import {capabilityFollowupMetadata,applyCapabilityFollowupSources} from './official-capability-followup-source.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const safe=p=>typeof p==='string'&&p&&!path.posix.isAbsolute(p)&&!/[\\:\0\r\n]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&s.toLowerCase()!=='.git');
const same=(a,b,label)=>assert.deepEqual({bytes:a.bytes,sha256:a.sha256},{bytes:b.bytes,sha256:b.sha256},label);
function rowsMap(rows){const map=new Map(),folded=new Set();assert(Array.isArray(rows));for(const p of rows){assert(safe(p.path)&&!folded.has(p.path.toLowerCase()),'CAP_SOURCE_PATH');assert(Number.isSafeInteger(p.bytes)&&p.bytes>=0&&/^[a-f0-9]{64}$/.test(p.sha256));map.set(p.path,{bytes:p.bytes,sha256:p.sha256});folded.add(p.path.toLowerCase());}return map;}
function dirs(map){const result=new Set();for(const p of map.keys()){let d=path.posix.dirname(p);while(d!=='.'){result.add(d);d=path.posix.dirname(d);}}return [...result].sort();}
function rows(map){return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([p,v])=>({path:p,...v}));}
function rootPath(p){assert(typeof p==='string'&&path.isAbsolute(p)&&!/[\0\r\n]/.test(p));const root=path.resolve(p),s=fs.lstatSync(root);assert(s.isDirectory()&&!s.isSymbolicLink());assert.equal(norm(fs.realpathSync(root)),norm(root),'CAP_SOURCE_ROOT_LINK');return root;}
function regular(file){const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink(),'CAP_SOURCE_FILE');assert.equal(norm(fs.realpathSync(file)),norm(file),'CAP_SOURCE_LINK');return s;}
function unchanged(a,b){for(const k of ['size','mtimeMs','ctimeMs','dev','ino'])assert.equal(a[k],b[k],'CAP_SOURCE_DRIFT');}
function read(root,p){assert(safe(p));const file=path.join(root,p),s=regular(file),b=fs.readFileSync(file);unchanged(regular(file),s);assert.equal(b.length,s.size);return b;}
async function snapshot(root,beforeFile=()=>{}){
  const files=new Map(),directories=[],folded=new Set();
  async function visit(dir,prefix=''){
    for(const name of fs.readdirSync(dir).sort()){
      if(!prefix&&name==='.git')continue;
      const p=prefix+name;assert(safe(p)&&!folded.has(p.toLowerCase()),'CAP_SOURCE_PATH_COLLISION');folded.add(p.toLowerCase());
      const file=path.join(dir,name),s=fs.lstatSync(file);assert(!s.isSymbolicLink());assert.equal(norm(fs.realpathSync(file)),norm(file));
      if(s.isDirectory()){directories.push(p);await visit(file,p+'/');}else{
        assert(s.isFile());beforeFile(p,s);const h=createHash('sha256');let bytes=0;
        for await(const chunk of fs.createReadStream(file)){bytes+=chunk.length;assert(bytes<=s.size);h.update(chunk);}
        unchanged(regular(file),s);assert.equal(bytes,s.size);files.set(p,{bytes,sha256:h.digest('hex')});
      }
    }
  }
  await visit(root);return {files,directories:directories.sort()};
}
function matchSnapshot(actual,expected){assert.equal(actual.files.size,expected.size,'CAP_SOURCE_INVENTORY');const expectedDirectories=dirs(expected);assert.equal(actual.directories.length,expectedDirectories.length,'CAP_SOURCE_DIRECTORIES');for(let i=0;i<expectedDirectories.length;i++)assert.equal(actual.directories[i],expectedDirectories[i],'CAP_SOURCE_DIRECTORY '+i);for(const[p,v]of expected){assert(actual.files.has(p),'CAP_SOURCE_MISSING '+p);same(actual.files.get(p),v,'CAP_SOURCE_CONTENT '+p);}}

// Pure baseline transformation. Hashes check consistency, not independent trust.
// Only a live materializer result or an authenticated executor snapshot is valid provenance.
export function deriveCapabilityPrebuildManifest(base,profile){
  const old=planOfficialBuild({profile}),plan=planOfficialCapabilitySources({profile}),m=capabilityFollowupMetadata();
  assert(base&&base.schema==='wxslim-official-prebuild-source-manifest-v1','CAP_SOURCE_BASE_SCHEMA');
  assert.equal(base.commit,plan.source.commit);assert.equal(base.profile,profile);assert.equal(base.planSha256,old.planSha256);
  const {manifestSha256,...body}=base;assert.equal(hash(Buffer.from(stable(body))),manifestSha256,'CAP_SOURCE_BASE_HASH');
  const files=rowsMap(base.files);assert.equal(files.size,base.preparedCheckedFiles);assert.deepEqual(base.directories,dirs(files));
  for(const p of old.finalOutputs){assert(files.has(p.path));same(files.get(p.path),p,'CAP_SOURCE_BASE_OUTPUT');}
  for(const p of m.extraOfficialInputs){assert(files.has(p.path));same(files.get(p.path),p,'CAP_SOURCE_EXTRA_PARENT');}
  for(const p of plan.retiredSources)assert(!files.has(p.source.path),'CAP_SOURCE_RETIRED');
  const before=new Map(files);for(const p of plan.finalOutputs){assert(files.has(p.path),'CAP_SOURCE_NEW_PATH_NOT_APPROVED');files.set(p.path,{bytes:p.bytes,sha256:p.sha256});}
  const changed=[...files.keys()].filter(p=>JSON.stringify(files.get(p))!==JSON.stringify(before.get(p))).sort();
  assert.deepEqual(changed,m.changedPaths.slice().sort(),'CAP_SOURCE_EXACT_SEVEN');
  const result={...body,schema:'wxslim-official-capability-prebuild-source-manifest-v1',baseManifestSha256:manifestSha256,
    basePlanSha256:old.planSha256,planSha256:plan.planSha256,files:rows(files),directories:dirs(files),capabilityChangedPaths:changed,
    baselineTrust:'Requires live original whole-tree materialization or executor-authenticated frozen receipts; checksum alone is not source authenticity.'};
  return {...result,manifestSha256:hash(Buffer.from(stable(result)))};
}

export async function materializeOfficialCapabilitySources(options){
  assert.equal(arguments.length,1);assert(options&&Object.getPrototypeOf(options)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(options).sort(),['source','gitExecutable','profile','upstreamSource','write'].sort());
  for(const k of Object.keys(options))assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,k),'value'));
  assert.equal(options.write,true,'CAP_SOURCE_WRITE_AUTHORIZATION_REQUIRED');
  const plan=planOfficialCapabilitySources({profile:options.profile}),root=rootPath(options.source),m=capabilityFollowupMetadata();
  assert(typeof options.gitExecutable==='string'&&path.isAbsolute(options.gitExecutable));regular(options.gitExecutable);
  const gitBefore=fs.readFileSync(options.gitExecutable),env={...process.env};for(const k of Object.keys(env))if(/^GIT_/i.test(k))delete env[k];env.GIT_NO_REPLACE_OBJECTS='1';env.GIT_OPTIONAL_LOCKS='0';
  const git=args=>execFileSync(options.gitExecutable,['--no-optional-locks','--no-replace-objects','-C',root,...args],{env,windowsHide:true,maxBuffer:1024*1024});
  const extra=new Map();for(const p of m.extraOfficialInputs){const b=git(['cat-file','blob',plan.source.commit+':'+p.path]);same(pin(b),p,'CAP_SOURCE_GIT_PARENT');assert.equal(createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex'),p.gitBlob);extra.set(p.path,b);}
  const state={basePreparationAttempted:false,baseCompleted:false,overlayAttempts:[],overlayCompleted:[],nativeBuildRun:false,rollback:false,retry:false};
  try{
    state.basePreparationAttempted=true;
    const base=await materializeOfficialBuildSources(options);state.baseCompleted=true;
    const baseline=deriveCapabilityPrebuildManifest(base.baseline,options.profile),before=rowsMap(base.baseline.files),expected=rowsMap(baseline.files);
    matchSnapshot(await snapshot(root),before);
    const baseOutputs=new Map(m.baseOutputs.map(p=>[p.path,read(root,p.path)])),prepared=applyCapabilityFollowupSources(baseOutputs,extra);
    assert.equal(planOfficialCapabilitySources({profile:options.profile}).planSha256,plan.planSha256,'CAP_SOURCE_PLAN_DRIFT');
    for(const p of m.changedPaths){
      rootPath(root);assert(safe(p));const file=path.join(root,p),s=regular(file);assert.equal(s.nlink,1,'CAP_SOURCE_HARDLINK');
      same(pin(read(root,p)),before.get(p),'CAP_SOURCE_BEFORE_WRITE');const bytes=prepared.outputs.get(p);same(pin(bytes),expected.get(p),'CAP_SOURCE_PREPARED');
      state.overlayAttempts.push(p);const fd=fs.openSync(file,'r+');
      try{const open=fs.fstatSync(fd);assert(open.isFile()&&open.nlink===1);unchanged(open,s);unchanged(regular(file),s);rootPath(root);fs.writeFileSync(fd,bytes);fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      same(pin(read(root,p)),expected.get(p),'CAP_SOURCE_WRITTEN');state.overlayCompleted.push(p);
    }
    matchSnapshot(await snapshot(root),expected);matchSnapshot(await snapshot(root),expected);
    assert.equal(git(['rev-parse','HEAD']).toString().trim(),plan.source.commit,'CAP_SOURCE_HEAD_DRIFT');
    assert(fs.readFileSync(options.gitExecutable).equals(gitBefore));assert.equal(planOfficialCapabilitySources({profile:options.profile}).planSha256,plan.planSha256);
    return {baseline,receipt:{schema:'wxslim-official-capability-source-materialization-v1',status:'PREPARED_SOURCE_ONLY_NOT_BUILD_ADMITTED',
      planSha256:plan.planSha256,base:base.receipt,overlay:prepared.receipt,...state,wholeTreeMethod:'Original authenticated complete source preparation plus exact seven-file overlay and two complete content comparisons',
      sourceWrites:base.receipt.sourceWrites+state.overlayCompleted.length,engineRun:false,postbuildBaselineTrust:'Executor must freeze both receipts and complete manifests; checksum is not independent authentication.'}};
  }catch(error){const failure=Error('CAP_SOURCE_MATERIALIZATION_FAILED',{cause:error});failure.code='CAP_SOURCE_MATERIALIZATION_FAILED';failure.state=state;failure.possibleSideEffects=state.basePreparationAttempted?'PARTIAL_SOURCE_POSSIBLE':'NONE';throw failure;}
}

function validateCapabilityBaseline(baseline){
  assert(baseline?.schema==='wxslim-official-capability-prebuild-source-manifest-v1');
  const {manifestSha256,...body}=baseline;assert.equal(hash(Buffer.from(stable(body))),manifestSha256,'CAP_POSTBUILD_BASELINE_HASH');
  const plan=planOfficialCapabilitySources({profile:baseline.profile});assert.equal(baseline.commit,plan.source.commit);assert.equal(baseline.planSha256,plan.planSha256,'CAP_POSTBUILD_PLAN_DRIFT');
  assert.equal(baseline.basePlanSha256,plan.basePlanSha256);assert(/^[a-f0-9]{64}$/.test(baseline.baseManifestSha256));
  assert.deepEqual(baseline.capabilityChangedPaths,capabilityFollowupMetadata().changedPaths.slice().sort());
  const expected=rowsMap(baseline.files);assert.equal(expected.size,baseline.preparedCheckedFiles);assert.deepEqual(baseline.directories,dirs(expected));
  for(const p of plan.finalOutputs){assert(expected.has(p.path));same(expected.get(p.path),p,'CAP_POSTBUILD_OUTPUT');}
  for(const p of plan.retiredSources)assert(!expected.has(p.source.path));
  return {plan,expected};
}

// Pure exact-content check. It cannot establish baseline provenance or replace
// the real filesystem/link/HEAD checks in the executor's precompile gate.
export function compareCapabilityPrecompileManifest({baseline,actualFiles,directories}){
  const {plan,expected}=validateCapabilityBaseline(baseline);
  assert(actualFiles instanceof Map&&Array.isArray(directories));
  matchSnapshot({files:actualFiles,directories},expected);
  return {schema:'wxslim-official-capability-precompile-source-audit-v1',status:'PREPARED_SOURCE_EXACT_NOT_COMPILED',
    planSha256:plan.planSha256,baselineManifestSha256:baseline.manifestSha256,checkedSourceFiles:expected.size,
    generatedFilesAccepted:false,sourceWritten:false,compilerExecuted:false};
}

export async function auditOfficialCapabilityPrecompileSource(options){
  assert.equal(arguments.length,1);assert(options&&Object.getPrototypeOf(options)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(options).sort(),['source','gitExecutable','baseline'].sort());
  for(const k of Object.keys(options))assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,k),'value'));
  const {source,gitExecutable,baseline}=options,root=rootPath(source);
  assert.equal(norm(root),norm(baseline.source),'CAP_PRECOMPILE_BASELINE_ROOT');
  const {plan,expected}=validateCapabilityBaseline(baseline);
  assert(typeof gitExecutable==='string'&&path.isAbsolute(gitExecutable));regular(gitExecutable);
  const gitBefore=fs.readFileSync(gitExecutable),env={...process.env};for(const k of Object.keys(env))if(/^GIT_/i.test(k))delete env[k];
  env.GIT_NO_REPLACE_OBJECTS='1';env.GIT_OPTIONAL_LOCKS='0';
  const head=()=>execFileSync(gitExecutable,['--no-optional-locks','--no-replace-objects','-C',root,'rev-parse','HEAD'],{env,windowsHide:true,maxBuffer:1024*1024}).toString().trim();
  assert.equal(head(),plan.source.commit,'CAP_PRECOMPILE_HEAD_DRIFT');
  const beforeFile=(p,s)=>{assert(expected.has(p),'CAP_PRECOMPILE_UNKNOWN_FILE '+p);assert.equal(s.size,expected.get(p).bytes,'CAP_PRECOMPILE_SIZE '+p);};
  const first=await snapshot(root,beforeFile),result=compareCapabilityPrecompileManifest({baseline,actualFiles:first.files,directories:first.directories});
  matchSnapshot(await snapshot(root,beforeFile),expected);
  assert.equal(head(),plan.source.commit,'CAP_PRECOMPILE_HEAD_DRIFT');assert(fs.readFileSync(gitExecutable).equals(gitBefore),'CAP_PRECOMPILE_GIT_DRIFT');
  assert.equal(planOfficialCapabilitySources({profile:baseline.profile}).planSha256,plan.planSha256,'CAP_PRECOMPILE_PLAN_DRIFT');
  return {...result,source:root,head:plan.source.commit,baselineTrust:'Executor-authenticated materialization and frozen manifest required; checksum alone is insufficient.'};
}

export async function auditOfficialCapabilityPostbuildSource(options){
  assert.equal(arguments.length,1);assert(options&&Object.getPrototypeOf(options)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(options).sort(),['source','baseline'].sort());
  for(const k of Object.keys(options))assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,k),'value'));
  const {source,baseline}=options;
  const root=rootPath(source);assert.equal(norm(root),norm(baseline.source));
  const {plan,expected}=validateCapabilityBaseline(baseline),manifestSha256=baseline.manifestSha256;
  const beforeFile=(p,s)=>{if(expected.has(p))assert.equal(s.size,expected.get(p).bytes,'CAP_POSTBUILD_SIZE');else classifyOfficialGeneratedPath(p);};
  const first=await snapshot(root,beforeFile),result=compareOfficialPostbuildManifest({baselineFiles:expected,actualFiles:first.files});
  const addedDirectories=first.directories.filter(p=>!baseline.directories.includes(p));for(const p of addedDirectories)assert(result.observed.some(x=>x.path.startsWith(p+'/')),'CAP_POSTBUILD_EMPTY_DIRECTORY');
  const second=await snapshot(root,beforeFile);assert.deepEqual(rows(first.files),rows(second.files));assert.deepEqual(first.directories,second.directories);
  return {schema:'wxslim-official-capability-postbuild-source-audit-v1',status:'SOURCE_STABLE_GENERATED_PENDING_REVIEW_NOT_ADMITTED',...result,
    checkedSourceFiles:expected.size,planSha256:plan.planSha256,baselineManifestSha256:manifestSha256,sourceWritten:false,rawBuildAdmitted:false,
    baselineTrust:'Requires executor-authenticated frozen materialization receipts; not standalone Git authentication.'};
}
