// Read-only bridge to the one Python toolchain planner. Does not install or
// introduce a second acquisition/cache recipe or an executable task action.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=fileURLToPath(new URL('./',import.meta.url));
const schema='wxslim-official-toolchain-request-v1',GiB=2**30;
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['schema','root','basePython','jobs','budgetBytes'];
function read(file){
  const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'TOOLCHAIN_REGULAR_INPUT');
  return fs.readFileSync(file);
}
export function normalizeToolchainPlanRequest(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'TOOLCHAIN_REQUEST_OBJECT');
  assert([Object.prototype,null].includes(Object.getPrototypeOf(value)),'TOOLCHAIN_PLAIN_REQUEST');
  assert(!Object.getOwnPropertySymbols(value).length,'TOOLCHAIN_NO_SYMBOLS');
  const fields=Object.getOwnPropertyDescriptors(value);
  for(const [key,d]of Object.entries(fields))assert(names.includes(key)&&Object.hasOwn(d,'value')&&d.enumerable,'TOOLCHAIN_UNKNOWN_OR_ACCESSOR_FIELD');
  assert.equal(value.schema,schema,'TOOLCHAIN_REQUEST_SCHEMA');
  for(const key of ['root','basePython'])assert(typeof value[key]==='string'&&value[key].trim()===value[key]&&!value[key].includes('\0')&&path.isAbsolute(value[key]),'TOOLCHAIN_ABSOLUTE_PATH');
  const jobs=Object.hasOwn(value,'jobs')?value.jobs:6,budgetBytes=Object.hasOwn(value,'budgetBytes')?value.budgetBytes:8*GiB;
  assert(Number.isInteger(jobs)&&jobs>=1&&jobs<=16,'TOOLCHAIN_JOBS');
  assert(Number.isSafeInteger(budgetBytes)&&budgetBytes>=4*GiB&&budgetBytes<=20*GiB,'TOOLCHAIN_BUDGET');
  return {schema,root:path.resolve(value.root),basePython:path.resolve(value.basePython),jobs,budgetBytes};
}
export function validateToolchainPlanReply(reply,request,lock,policy){
  const r=normalizeToolchainPlanRequest(request);
  assert.equal(reply?.schema,'wxslim-official-toolchain-plan-v1','TOOLCHAIN_REPLY_SCHEMA');
  assert.equal(reply.writes,false,'TOOLCHAIN_READ_ONLY');assert.equal(reply.executionAuthorized,false,'TOOLCHAIN_NO_AUTHORIZATION');
  for(const key of ['root','basePython','jobs','budgetBytes'])assert.equal(reply[key],r[key],'TOOLCHAIN_REPLY_REQUEST');
  assert.deepEqual(reply.downloads,[...lock.archives,...lock.metadata],'TOOLCHAIN_REPLY_DOWNLOADS');
  assert.equal(reply.knownArchiveBytes,lock.archives.reduce((sum,x)=>sum+x.bytes,0),'TOOLCHAIN_REPLY_ARCHIVE_SIZE');
  assert.deepEqual(reply.thinTargets,lock.thinTargets,'TOOLCHAIN_REPLY_TARGETS');
  assert.deepEqual(reply.cacheCommand,['official-cache-build.py','--lto=thin','build',...lock.thinTargets],'TOOLCHAIN_REPLY_CACHE_COMMAND');
  assert.deepEqual(reply.cacheHashes,policy.thinLtoLibraries,'TOOLCHAIN_REPLY_CACHE_HASHES');
  assert.deepEqual(reply.scons,{version:policy.sconsVersion,wheel:policy.sconsWheel,source:'https://pypi.org/simple'},'TOOLCHAIN_REPLY_SCONS');
  assert(Array.isArray(reply.remainingExternalInputs)&&reply.remainingExternalInputs.every(x=>typeof x==='string'),'TOOLCHAIN_REPLY_EXTERNAL');
  assert(Array.isArray(reply.limitations)&&reply.limitations.every(x=>typeof x==='string'),'TOOLCHAIN_REPLY_LIMITATIONS');
  return reply;
}
export function officialToolchainPlan(file){
  assert.equal(arguments.length,1,'TOOLCHAIN_PLAN_ONE_CONFIG');
  assert.equal(process.platform,'win32','TOOLCHAIN_WINDOWS_RECIPE');
  assert(typeof file==='string'&&file.length,'TOOLCHAIN_CONFIG_FILE');
  const config=path.resolve(file),bytes=read(config);assert(bytes.length<=16*1024,'TOOLCHAIN_CONFIG_SIZE');
  const request=normalizeToolchainPlanRequest(JSON.parse(bytes.toString('utf8')));
  const source=path.join(here,'official-toolchain.py'),lockFile=path.join(here,'official-toolchain-downloads.json'),policyFile=path.join(here,'fixed-toolchain-cache.json');
  const lock=JSON.parse(read(lockFile)),policy=JSON.parse(read(policyFile));
  const before=[config,source,path.join(here,'official-cache-build.py'),lockFile,policyFile,request.basePython].map(file=>({file,sha256:sha(read(file))}));
  assert.equal(before.at(-1).sha256,policy.pythonBaseExeSha256,'TOOLCHAIN_FIXED_BASE_PYTHON');
  // -I ignores inherited Python paths/options/user site; -B prevents pyc writes.
  // The root is only an argument; it is never this process's working directory.
  const stdout=execFileSync(request.basePython,['-I','-B',source,'--root',request.root,'--base-python',request.basePython,
    '--jobs',String(request.jobs),'--budget-bytes',String(request.budgetBytes)],
    {cwd:here,encoding:'utf8',windowsHide:true,maxBuffer:256*1024,timeout:20000,stdio:['ignore','pipe','pipe']});
  for(const row of before)assert.equal(sha(read(row.file)),row.sha256,'TOOLCHAIN_PLAN_INPUT_DRIFT');
  const plan=validateToolchainPlanReply(JSON.parse(stdout),request,lock,policy);
  return {schema:'wxslim-official-toolchain-cli-plan-v1',status:'PLAN_ONLY',plan,
    inputs:before.map(({file,sha256})=>({role:file===config?'request':file===request.basePython?'basePython':path.basename(file),sha256})),
    executionSupported:false,executionAuthorized:false,workCreated:false,dependenciesInstalled:false,
    placement:'NOT_CHECKED_BY_READ_ONLY_PLAN',runtime:'NOT_RUN',
    remaining:'Actual installation needs a separately approved fresh location and execution review; no install task or plugin execution is admitted.'};
}
