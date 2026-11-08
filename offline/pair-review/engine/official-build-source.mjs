// Source preparation / read-only checkout audit only. No checkout, writes,
// networking, compiler, SDK process or generated target evaluation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {auditOfficialBasicCapabilityCombination} from './official-basic-capability-combination.mjs';
import {planOfficialBuild} from './official-build-plan.mjs';
import {createOfficialCheckoutEolPolicy} from './official-checkout-eol.mjs';
const commit='c050c09b105c3715e1caa57a7109cd752047fd89';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const objectId=(type,b)=>createHash('sha1').update(Buffer.from(type+' '+b.length+'\0')).update(b).digest('hex');
const verifiedBlob=Symbol('internally verified streamed Git blob');
const safe=p=>typeof p==='string'&&p&&!p.includes('\\')&&!p.includes(':')&&!/[\0\r\n]/.test(p)&&!path.posix.isAbsolute(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&s.toLowerCase()!=='.git');
function exact(obj,keys){assert(obj&&typeof obj==='object'&&!Array.isArray(obj));assert.deepEqual(Reflect.ownKeys(obj).sort(),keys.slice().sort(),'SOURCE_EXACT_OPTIONS');for(const k of keys){const d=Object.getOwnPropertyDescriptor(obj,k);assert(d&&Object.hasOwn(d,'value'),'SOURCE_DATA_OPTIONS');}}
function match(bytes,p){assert(Buffer.isBuffer(bytes),'SOURCE_BUFFER');assert.deepEqual(pin(bytes),{bytes:p.bytes,sha256:p.sha256},'SOURCE_HASH '+p.path);}

export function prepareOfficialBuildSources(options){
 assert.equal(arguments.length,1);exact(options,['profile','officialBlobs','upstreamSource']);
 const plan=planOfficialBuild({profile:options.profile});
 assert(options.officialBlobs instanceof Map);assert(Buffer.isBuffer(options.upstreamSource));
 const inputs=new Map([...options.officialBlobs].map(([p,b])=>{assert(Buffer.isBuffer(b));return[p,Buffer.from(b)];}));
 const upstream=Buffer.from(options.upstreamSource);match(upstream,plan.upstreamSource.fixedSource);
 const combined=auditOfficialBasicCapabilityCombination(inputs,{sourceBytes:upstream});
 const outputs=new Map([...combined.outputs].map(([p,v])=>[p,Buffer.from(v.text)]));
 assert.equal(outputs.size,31);assert.deepEqual([...outputs.keys()].sort(),plan.finalOutputs.map(p=>p.path).sort());
 for(const p of plan.finalOutputs)match(outputs.get(p.path),p);
 for(const retired of plan.retiredSources)assert(!outputs.has(retired.source.path),'SOURCE_RETIRED_OUTPUT');
 return {outputs,receipt:{schema:'wxslim-official-build-source-preparation-v1',status:'PREPARED_IN_MEMORY_NOT_MATERIALIZED',
  commit,planSha256:plan.planSha256,inputFiles:inputs.size,upstreamSource:pin(upstream),outputs:plan.finalOutputs,
  generatedSources:plan.generatedSources,retiredSources:plan.retiredSources,postPatchTransform:plan.postPatchTransform,
  sourceWritten:false,wholeCheckoutAudited:false,compiled:false}};
}

// Generic pure Git-object verifier for bounded models. Its return value is NOT
// official admission: only auditOfficialBuildCheckout fixes the commit/plan.
export async function inspectGitSourceObjects({commitId,readObject,checkoutEolPolicy=null}){
 assert(/^[a-f0-9]{40}$/.test(commitId)&&typeof readObject==='function');
 const cache=new Map();let totalBytes=0;
 async function read(type,id){
  const key=type+':'+id;if(cache.has(key))return cache.get(key);
  const b=await readObject(type,id);
  if(type==='blob'&&b?.[verifiedBlob]===true){totalBytes+=b.bytes;assert.equal(b.objectId,id,'GIT_OBJECT_HASH');cache.set(key,b);}
  else {assert(Buffer.isBuffer(b),'GIT_OBJECT_BUFFER');assert.equal(objectId(type,b),id,'GIT_OBJECT_HASH');totalBytes+=b.length;
   cache.set(key,type==='blob'?{...pin(b),objectId:id,[verifiedBlob]:true}:b);}
  assert(totalBytes<=1024*1024*1024,'GIT_OBJECT_BUDGET');return cache.get(key);
 }
 const raw=await read('commit',commitId),first=/^tree ([a-f0-9]{40})\n/.exec(raw.toString('utf8'));assert(first,'GIT_COMMIT_TREE');
 const files=new Map(),checkoutFiles=new Map(),seenPaths=new Set(),folded=new Set();
 async function tree(id,prefix,ancestors){
  assert(!ancestors.has(id),'GIT_TREE_CYCLE');const next=new Set(ancestors);next.add(id);assert(next.size<=128,'GIT_TREE_DEPTH');
  const bytes=await read('tree',id);let at=0;
  while(at<bytes.length){
   const space=bytes.indexOf(32,at),nul=bytes.indexOf(0,space+1);assert(space>at&&nul>space,'GIT_TREE_FORMAT');
   const mode=bytes.toString('ascii',at,space),nameBytes=bytes.subarray(space+1,nul),name=nameBytes.toString('utf8');
   assert(Buffer.from(name).equals(nameBytes)&&!name.includes('/')&&safe(name),'GIT_TREE_PATH');assert(nul+21<=bytes.length,'GIT_TREE_OBJECT_ID');
   const child=bytes.subarray(nul+1,nul+21).toString('hex'),p=prefix+name;at=nul+21;
   assert(safe(p)&&!seenPaths.has(p)&&!folded.has(p.toLowerCase()),'GIT_TREE_DUPLICATE_OR_CASE_COLLISION');seenPaths.add(p);folded.add(p.toLowerCase());
   if(mode==='40000')await tree(child,p+'/',next);
   else{
    assert(mode==='100644'||mode==='100755','UNSUPPORTED_GIT_MODE_SYMLINK_OR_GITLINK');
    const body=await read('blob',child),row={path:p,mode,blob:child,bytes:body.bytes,sha256:body.sha256};files.set(p,row);
    checkoutFiles.set(p,checkoutEolPolicy?checkoutEolPolicy.project(row,body.body):row);
   }
  }
 }
 await tree(first[1],'',new Set());const checkoutEol=checkoutEolPolicy?checkoutEolPolicy.finalize(files):null;
 return {commit:commitId,tree:first[1],files,checkoutFiles,checkoutEol,objectCount:cache.size,objectBytes:totalBytes};
}

// One outstanding request; binary payload length, terminator, type, object ID
// and both hashes are checked. Blob payloads are never retained as tree data.
export function createGitBatchObjectReader({write,maxObjectBytes=128*1024*1024,maxTotalBytes=1024*1024*1024,retainBlobIds=new Set()}){
 assert(typeof write==='function');let pending=null,failed=null,ended=false,total=0,count=0;
 function abort(error){if(!failed)failed=error;if(pending){const p=pending;pending=null;p.reject(failed);}}
 function feed(chunk){
  try{
   assert(Buffer.isBuffer(chunk),'BATCH_CHUNK_BUFFER');let at=0;
   while(at<chunk.length){
    assert(pending,'BATCH_UNSOLICITED_OUTPUT');const p=pending;
    if(p.phase==='header'){
     const nl=chunk.indexOf(10,at),end=nl<0?chunk.length:nl;
     assert(chunk.subarray(at,end).every(b=>b>=32&&b<127),'BATCH_HEADER_ASCII');
     p.header+=chunk.toString('ascii',at,end);assert(p.header.length<=128,'BATCH_HEADER_BOUND');at=end;
     if(nl<0)break;at++;
     const m=/^([a-f0-9]{40}) (blob|tree|commit) (0|[1-9][0-9]*)$/.exec(p.header);assert(m,'BATCH_HEADER');
     assert.equal(m[1],p.id,'BATCH_OBJECT_ID');assert.equal(m[2],p.type,'BATCH_OBJECT_TYPE');
     p.size=Number(m[3]);assert(Number.isSafeInteger(p.size)&&p.size<=maxObjectBytes,'BATCH_OBJECT_BOUND');
     total+=p.size;count++;assert(total<=maxTotalBytes&&count<=1000000,'BATCH_TOTAL_BOUND');
     p.sha1=createHash('sha1').update(Buffer.from(p.type+' '+p.size+'\0'));p.sha256=createHash('sha256');p.remaining=p.size;p.parts=[];p.phase=p.size?'body':'terminator';
    }else if(p.phase==='body'){
     const n=Math.min(p.remaining,chunk.length-at),part=chunk.subarray(at,at+n);p.sha1.update(part);p.sha256.update(part);
     if(p.type!=='blob'||retainBlobIds.has(p.id))p.parts.push(Buffer.from(part));p.remaining-=n;at+=n;if(!p.remaining)p.phase='terminator';
    }else{
     assert.equal(chunk[at++],10,'BATCH_PAYLOAD_TERMINATOR');assert.equal(p.sha1.digest('hex'),p.id,'GIT_OBJECT_HASH');
     const digest=p.sha256.digest('hex'),value=p.type==='blob'?{bytes:p.size,sha256:digest,objectId:p.id,[verifiedBlob]:true,
      ...(retainBlobIds.has(p.id)?{body:Buffer.concat(p.parts,p.size)}:{})}:Buffer.concat(p.parts,p.size);
     pending=null;p.resolve(value);
    }
   }
  }catch(error){abort(error);}
 }
 return {feed,abort,end(){ended=true;if(pending)abort(new Error('BATCH_TRUNCATED_RESPONSE'));},
  read(type,id){
   if(failed)return Promise.reject(failed);if(ended)return Promise.reject(new Error('BATCH_ENDED'));
   assert(!pending,'BATCH_CONCURRENT_REQUEST');assert(['blob','tree','commit'].includes(type)&&/^[a-f0-9]{40}$/.test(id));
   return new Promise((resolve,reject)=>{pending={type,id,resolve,reject,header:'',phase:'header'};try{write(id+'\n');}catch(e){abort(e);}});
  },check(){if(failed)throw failed;assert(!pending,'BATCH_PENDING');return {objects:count,bytes:total};}};
}

// Pure content comparison. Disk collection below separately rejects symlinks,
// directories/files with colliding names, and unknown/untracked files.
export function compareSourceSnapshot({baseFiles,actualFiles,outputs,mode,retiredPaths=[]}){
 assert(baseFiles instanceof Map&&actualFiles instanceof Map&&outputs instanceof Map);assert(['base','prepared'].includes(mode),'SOURCE_MODE');
 const expected=new Map(baseFiles);if(mode==='prepared')for(const [p,v]of outputs){assert(safe(p));expected.set(p,{path:p,...pin(v)});}
 for(const p of retiredPaths)assert(!actualFiles.has(p),'SOURCE_RETIRED_PRESENT');
 assert.deepEqual([...actualFiles.keys()].sort(),[...expected.keys()].sort(),'SOURCE_UNKNOWN_OR_MISSING_FILE');
 for(const [p,v]of actualFiles){assert(safe(p));match(v,expected.get(p));}
 return {mode,trackedBaseFiles:baseFiles.size,checkedFiles:expected.size,fullContentMatched:true};
}

export function verifySourcePlanTreeBindings({baseFiles,officialInputs,finalOutputs}){
 assert(baseFiles instanceof Map);
 for(const p of officialInputs){const base=baseFiles.get(p.path);assert(base,'SOURCE_OFFICIAL_INPUT_MISSING');assert.deepEqual({bytes:base.bytes,sha256:base.sha256},{bytes:p.bytes,sha256:p.sha256},'SOURCE_OFFICIAL_INPUT_BASE_PIN');}
 for(const p of finalOutputs)assert.equal(p.added,!baseFiles.has(p.path),'SOURCE_OUTPUT_ADDED_FLAG '+p.path);
}

export function wireGitBatchStreams(child,batch){
 let stderrBytes=0;
 child.stdout.on('data',batch.feed);child.stdout.on('end',()=>batch.end());
 child.stdout.on('error',error=>batch.abort(error));
 child.stderr.on('error',error=>batch.abort(error));
 child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>65536)batch.abort(new Error('BATCH_STDERR_BOUND'));});
 child.stdin.on('error',error=>batch.abort(error));child.on('error',error=>batch.abort(error));
 return new Promise(resolve=>child.on('close',(code,signal)=>{batch.end();resolve({code,signal});}));
}

// This function owns only the cat-file child passed here. A kill request is not
// an exit observation: only its close promise can establish that it exited.
export async function settleGitBatchProcess({child,closed,timeoutMs=5000,killTimeoutMs=2000}){
 for(const ms of [timeoutMs,killTimeoutMs])assert(Number.isInteger(ms)&&ms>=1&&ms<=30000);
 const ownedPid=Number.isInteger(child.pid)?child.pid:null;
 async function bounded(ms){
  let timer;try{return await Promise.race([closed.then(result=>({closed:true,result})),new Promise(resolve=>{timer=setTimeout(()=>resolve({closed:false}),ms);})]);}
  finally{clearTimeout(timer);}
 }
 let stdinEndError=null,killError=null,killRequested=false;
 try{child.stdin.end();}catch(error){stdinEndError=error;}
 const graceful=await bounded(timeoutMs);
 if(graceful.closed)return {...graceful.result,ownedPid,processMayStillRunning:false,graceful:true,stdinEndError};
 try{killRequested=child.kill()===true;}catch(error){killError=error;}
 const forced=await bounded(killTimeoutMs);
 if(forced.closed)return {...forced.result,ownedPid,processMayStillRunning:false,graceful:false,killRequested,stdinEndError,killError};
 const error=new Error('BATCH_EXIT_UNCONFIRMED');error.code='BATCH_EXIT_UNCONFIRMED';
 Object.assign(error,{ownedPid,processMayStillRunning:true,killRequested,stdinEndError,killError});throw error;
}

export async function auditOfficialBuildCheckout(options){
 assert.equal(arguments.length,1);exact(options,['source','gitExecutable','profile','mode']);
 const plan=planOfficialBuild({profile:options.profile});assert(['base','prepared'].includes(options.mode),'SOURCE_MODE');
 for(const name of ['source','gitExecutable'])assert(typeof options[name]==='string'&&path.isAbsolute(options[name])&&!/[\0\r\n]/.test(options[name]),'SOURCE_EXPLICIT_ABSOLUTE_PATH');
 const normalize=p=>process.platform==='win32'?p.toLowerCase():p;
 const source=path.resolve(options.source),st=fs.lstatSync(source);assert(st.isDirectory()&&!st.isSymbolicLink(),'SOURCE_DIRECTORY');
 assert.equal(normalize(fs.realpathSync(source)),normalize(source),'SOURCE_ROOT_LINK');
 const executable=path.resolve(options.gitExecutable),tool=fs.lstatSync(executable);assert(tool.isFile()&&!tool.isSymbolicLink(),'SOURCE_GIT_REGULAR');
 assert.equal(normalize(fs.realpathSync(executable)),normalize(executable),'SOURCE_GIT_LINK');
 const toolBefore=fs.readFileSync(executable),env={...process.env};for(const k of Object.keys(env))if(/^GIT_/i.test(k))delete env[k];
 env.GIT_NO_REPLACE_OBJECTS='1';env.GIT_OPTIONAL_LOCKS='0';
 const git=args=>execFileSync(executable,['--no-optional-locks','--no-replace-objects','-C',source,...args],{env,windowsHide:true,maxBuffer:128*1024*1024});
 assert.equal(normalize(path.resolve(git(['rev-parse','--show-toplevel']).toString().trim())),normalize(source),'SOURCE_TOPLEVEL');
 assert.equal(git(['rev-parse','HEAD']).toString().trim(),commit,'SOURCE_FIXED_HEAD');
 const checkoutEolPolicy=createOfficialCheckoutEolPolicy();
 const child=spawn(executable,['--no-optional-locks','--no-replace-objects','-C',source,'cat-file','--batch'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const batch=createGitBatchObjectReader({write:line=>child.stdin.write(line),retainBlobIds:checkoutEolPolicy.retainedBlobIds}),closed=wireGitBatchStreams(child,batch);
 let settlement;const settle=()=>settlement??=(settleGitBatchProcess({child,closed}));
 let verified,batchEvidence;
 try{
  verified=await inspectGitSourceObjects({commitId:commit,checkoutEolPolicy,readObject:async(type,id)=>{
   const timer=setTimeout(()=>batch.abort(new Error('BATCH_OBJECT_TIMEOUT')),30000);
   try{return await batch.read(type,id);}finally{clearTimeout(timer);}
  }});batchEvidence=batch.check();
  const result=await settle();assert(result.graceful&&!result.stdinEndError,'BATCH_END_NOT_GRACEFUL');
  assert.equal(result.code,0,'BATCH_EXIT');assert.equal(result.signal,null,'BATCH_SIGNAL');batch.check();
 }catch(error){
  batch.abort(error);
  let result;try{result=await settle();}catch(exitError){if(exitError!==error)Object.defineProperty(exitError,'cause',{value:error});throw exitError;}
  const failure=new Error(error?.message||'BATCH_FAILED',{cause:error});failure.code=error?.code||'BATCH_FAILED';
  Object.assign(failure,{ownedPid:result.ownedPid,processMayStillRunning:false,gitProcessClose:result});throw failure;
 }
 // The prepared checkout need not trust any caller-returned Buffer or hash:
 // expected output hashes always come from the independently pinned plan.
 let actual=new Map(),directories=[];
 async function diskPin(file,initial){
  const hash=createHash('sha256');let bytes=0;const stream=fs.createReadStream(file);
  for await(const chunk of stream){bytes+=chunk.length;assert(bytes<=initial.size,'SOURCE_FILE_GREW');hash.update(chunk);}
  const after=fs.lstatSync(file);assert(after.isFile()&&!after.isSymbolicLink()&&after.size===initial.size&&after.mtimeMs===initial.mtimeMs&&after.ino===initial.ino,'SOURCE_FILE_READ_DRIFT');
  assert.equal(bytes,initial.size,'SOURCE_FILE_READ_SIZE');return {bytes,sha256:hash.digest('hex')};
 }
 async function collect(dir,prefix=''){
  for(const name of fs.readdirSync(dir)){
   if(!prefix&&name==='.git')continue;
   const relative=prefix+name;assert(safe(relative),'SOURCE_DISK_PATH');const file=path.join(dir,name),s=fs.lstatSync(file);
   assert(!s.isSymbolicLink(),'SOURCE_SYMLINK');assert.equal(normalize(fs.realpathSync(file)),normalize(path.resolve(file)),'SOURCE_LINK_ESCAPE');
   if(s.isDirectory()){assert(expectedDirs.has(relative),'SOURCE_UNKNOWN_DIRECTORY');directories.push(relative);await collect(file,relative+'/');}
   else {assert(s.isFile(),'SOURCE_SPECIAL_FILE');assert(expected.has(relative),'SOURCE_UNKNOWN_FILE');assert.equal(s.size,expected.get(relative).bytes,'SOURCE_FILE_SIZE');actual.set(relative,await diskPin(file,s));}
  }
 }
 verifySourcePlanTreeBindings({baseFiles:verified.files,officialInputs:plan.officialInputs,finalOutputs:plan.finalOutputs});
 const expected=new Map(verified.checkoutFiles);if(options.mode==='prepared')for(const p of plan.finalOutputs)expected.set(p.path,p);
 const expectedDirs=new Set();for(const p of expected.keys()){let d=path.posix.dirname(p);while(d!=='.'){expectedDirs.add(d);d=path.posix.dirname(d);}}
 await collect(source);
 for(const retired of plan.retiredSources)assert(!actual.has(retired.source.path),'SOURCE_RETIRED_PRESENT');
 assert.deepEqual([...actual.keys()].sort(),[...expected.keys()].sort(),'SOURCE_UNKNOWN_OR_MISSING_FILE');
 for(const [p,b]of actual)assert.deepEqual(b,{bytes:expected.get(p).bytes,sha256:expected.get(p).sha256},'SOURCE_HASH '+p);
 // Empty/untracked build directories are refused as well: this interface audits
 // pre-build source states, not a post-build tree with an ignored-output policy.
 assert.deepEqual(directories.sort(),[...expectedDirs].sort(),'SOURCE_UNKNOWN_DIRECTORY');
 assert.equal(git(['rev-parse','HEAD']).toString().trim(),commit,'SOURCE_HEAD_DRIFT');
 const firstFiles=actual;actual=new Map();directories=[];await collect(source);
 assert.deepEqual([...actual.keys()].sort(),[...firstFiles.keys()].sort(),'SOURCE_INVENTORY_DRIFT');
 assert.deepEqual(directories.sort(),[...expectedDirs].sort(),'SOURCE_DIRECTORY_DRIFT');
 for(const [p,b]of actual)assert.deepEqual(b,firstFiles.get(p),'SOURCE_CONTENT_DRIFT');
 assert(fs.readFileSync(executable).equals(toolBefore),'SOURCE_GIT_DRIFT');
 return {schema:'wxslim-official-checkout-audit-v1',status:'PASS_COMPLETE_SOURCE_CONTENT_ONLY',mode:options.mode,commit,tree:verified.tree,
  planSha256:plan.planSha256,source,git:{path:executable,...pin(toolBefore)},batch:batchEvidence,objectsVerified:verified.objectCount,objectBytes:verified.objectBytes,
  trackedBaseFiles:verified.files.size,checkedFiles:actual.size,checkedDirectories:directories.length,checkoutEol:verified.checkoutEol,
  finalOutputs:options.mode==='prepared'?plan.finalOutputs:[],generatedSources:plan.generatedSources,retiredSources:plan.retiredSources,
  newOrUnknownFilesAllowed:false,buildGeneratedTreeAudit:'UNSUPPORTED_USE_PREBUILD_CLEAN_SOURCE_STATE',
  indexOrHeadAloneUsedAsContentProof:false,sourceWritten:false,compilerRun:false,engineRun:false};
}
