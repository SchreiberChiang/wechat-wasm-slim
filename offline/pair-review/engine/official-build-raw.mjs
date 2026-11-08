// One fixed official-source compilation. Raw SUCCESS is deliberately NOT an
// engine admission: no final postprocess, conversion, upload or runtime here.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {officialRawSourceRecipe,OFFICIAL_BASE_RAW_REQUEST} from './official-raw-source-recipe.mjs';
import {OFFICIAL_CUSTOM_RAW_REQUEST,rawRecipePlanInput,rawMaterializationProfile,selectedRawProfileBytes} from './official-custom-source-plan.mjs';
import {auditCustomGeneratedFeatures} from './custom-feature-audit.mjs';
import {auditCustomBuildEvidence} from './custom-build-evidence.mjs';
import {officialRawExecutionPlan,preflightOfficialRawBuild,officialRawChildEnvironment,officialRawResourceSnapshot,OFFICIAL_RAW_PHASES} from './official-build-preflight.mjs';
import {auditOfficialModuleSource,auditOfficialModuleBuffers} from './official-module-audit.mjs';
import {inspectOfficialRawArtifacts} from './official-raw-artifacts.mjs';
import {runBuildPhases} from './fixed-build-lifecycle.mjs';
import {cancellationReader,cancellationSignals,checkResourceHeadroom} from './fixed-build.mjs';
import {runOwnedProcess} from '../convert/lib/owned-process.mjs';
import {createTask,inspectTask} from '../convert/lib/official-task.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const outputNames=Object.freeze({js:'godot.raw.js',wasm:'godot.wasm',symbols:'godot.js.symbols'});
const json=b=>JSON.parse(b.toString('utf8'));
function fail(code,message=code){const error=Error(message);error.code=code;throw error;}
function inside(root,relative){
 assert(typeof relative==='string'&&relative&&!path.isAbsolute(relative)&&!/[\\:\0\r\n]/.test(relative)&&relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'RAW_RELATIVE_PATH');
 const target=path.resolve(root,relative);assert(norm(target).startsWith(norm(root)+path.sep),'RAW_PATH_ESCAPE');return target;
}
function regular(file){
 const st=fs.lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink(),'RAW_REGULAR_FILE');assert.equal(norm(fs.realpathSync(file)),norm(file),'RAW_LINKED_FILE');
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
 for(const field of ['size','dev','ino','mtimeMs','ctimeMs'])assert.equal(after[field],st[field],'RAW_READ_DRIFT');
 assert.equal(bytes.length,st.size);return bytes;
}
function writeNew(file,bytes){
 assert(Buffer.isBuffer(bytes));const parent=path.dirname(file);assert.equal(norm(fs.realpathSync(parent)),norm(parent),'RAW_WRITE_PARENT_LINK');
 const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 assert.deepEqual(pin(regular(file)),pin(bytes),'RAW_WRITE_DRIFT');
}
function writeJson(file,value){writeNew(file,Buffer.from(JSON.stringify(value,null,2)+'\n'));}
function mkdirInside(root,relative){
 let current=root;for(const segment of relative.split('/')){
  assert(segment&&segment!=='.'&&segment!=='..'&&!/[\\:\0\r\n]/.test(segment));current=path.join(current,segment);
  if(!fs.existsSync(current))fs.mkdirSync(current);
  const st=fs.lstatSync(current);assert(st.isDirectory()&&!st.isSymbolicLink());assert.equal(norm(fs.realpathSync(current)),norm(current),'RAW_DIRECTORY_LINK');
 }return current;
}
function measuredTree(root){
 let bytes=0,transientGone=0;
 function visit(dir){for(const name of fs.readdirSync(dir)){
  const file=path.join(dir,name);let st;try{st=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT'){transientGone++;continue;}throw e;}
  assert(!st.isSymbolicLink(),'RAW_MONITOR_LINK');if(st.isDirectory())visit(file);else{assert(st.isFile(),'RAW_MONITOR_SPECIAL');bytes+=st.size;}
 }}visit(root);return {bytes,transientGone};
}
function selectedEnv(env){return Object.fromEntries(['EMSDK','EM_CONFIG','EM_CACHE','EM_FROZEN_CACHE','EMSDK_PYTHON','EMCC_CORES','BINARYEN_CORES','PYTHONDONTWRITEBYTECODE','TEMP','TMP','EMCC_TEMP_DIR'].filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));}
function dependencyAudit(request,env){
 const report=json(Buffer.from(execFileSync(request.python,['-B',path.join(repo,'engine/fixed-dependency-audit.py'),'--sdk',request.sdk,'--scons-wheel',request.sconsWheel,'--sdk-archive',request.sdkArchive],
  {cwd:request.work,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:120000})));
 assert.equal(report.status,'PASS_DEPENDENCIES_ONLY');return report;
}
function assertInputs(preflight,sourcePlan){
 const {request:r}=preflight.plan;
 assert.equal(recomputeRawPlan(preflight.plan).planSha256,preflight.plan.planSha256,'RAW_EXECUTOR_OR_PLAN_DRIFT');
 for(const [file,expected]of [[process.execPath,sourcePlan.toolchain.driverNode],
  [r.python,{sha256:sourcePlan.toolchain.expectedPython.exeSha256}],
  [preflight.placement.pythonBase.executable,{sha256:sourcePlan.toolchain.expectedPython.baseSha256}],
  [r.gitExecutable,preflight.gitIdentity],[r.library,sourcePlan.library],[r.sconsWheel,sourcePlan.toolchain.scons.wheel],
  [r.sdkArchive,sourcePlan.toolchain.sdkArchive],[r.upstreamSource,sourcePlan.upstreamSource.fixedSource]]){
  const actual=pin(regular(file));assert.equal(actual.sha256,expected.sha256,'RAW_DEPENDENCY_DRIFT');if(expected.bytes!==undefined)assert.equal(actual.bytes,expected.bytes);
 }
}
function verifySnapshots(work,rows){for(const row of rows)assert.deepEqual(pin(regular(inside(work,row.path))),{bytes:row.bytes,sha256:row.sha256},'RAW_SNAPSHOT_DRIFT '+row.path);}
function verifySnapshotInventory(work,rows,plan,sourcePlan){
 const expected=new Map([...sourcePlan.dependencies,...plan.implementation].map(p=>['inputs/repository/'+p.path,{bytes:p.bytes,sha256:p.sha256}]));
 for(const [name,p]of [['profile.gdbuild',sourcePlan.selectedProfile],['libemscriptenglx.a',sourcePlan.library],['upstream-source.js',sourcePlan.upstreamSource.fixedSource]])expected.set('inputs/'+name,{bytes:p.bytes,sha256:p.sha256});
 expected.set('inputs/REQUEST.json',pin(Buffer.from(JSON.stringify(plan.request,null,2)+'\n')));
 expected.set('inputs/PLAN.json',pin(Buffer.from(JSON.stringify(plan,null,2)+'\n')));
 const actual=new Map(rows.map(p=>[p.path,{bytes:p.bytes,sha256:p.sha256}]));assert.equal(actual.size,rows.length,'RAW_DUPLICATE_SNAPSHOTS');
 assert.deepEqual([...actual.keys()].sort(),[...expected.keys(),'inputs/pyvenv.cfg'].sort(),'RAW_SNAPSHOT_SET');
 for(const [name,p]of expected)assert.deepEqual(actual.get(name),p,'RAW_SNAPSHOT_RECIPE_MISMATCH');verifySnapshots(work,rows);
}

// Custom selection changes the build profile, never the authenticated source
// materializer. This dispatcher is shared by completion and independent re-audit.
export function auditRawGeneratedConfiguration(request,readSource){
 const enabledHeader=readSource('modules/modules_enabled.gen.h'),registration=readSource('modules/register_module_types.gen.cpp');
 if(request.schema===OFFICIAL_CUSTOM_RAW_REQUEST)return auditCustomGeneratedFeatures({features:request.features,enabledHeader,registration,
  disabledClassesHeader:readSource('core/disabled_classes.gen.h')});
 return auditOfficialModuleBuffers({profile:request.profile,enabledHeader,registration});
}

// Pure name selection: an engine/wrapped/zip output can never substitute for
// the earliest Program node, and ambiguity is an error rather than a guess.
export function selectOfficialRawOutputs(binNames){
 assert(Array.isArray(binNames)&&binNames.every(n=>typeof n==='string'&&!/[\\/\0\r\n]/.test(n)),'RAW_BIN_NAMES');
 assert.equal(new Set(binNames).size,binNames.length,'RAW_DUPLICATE_BIN_NAMES');
 const selected=binNames.filter(n=>/^godot\.web\.template_release\.wasm32(?:\.[a-z0-9_-]+)*\.js$/.test(n)&&!/(?:\.engine|\.wrapped)\.js$/.test(n));
 assert.equal(selected.length,1,'RAW_PROGRAM_NOT_UNIQUE');const js=selected[0],wasm=js.slice(0,-3)+'.wasm',symbols=js+'.symbols';
 assert(binNames.includes(wasm)&&binNames.includes(symbols),'RAW_COMPANIONS_MISSING');
 return {js,wasm,symbols,progSuffix:js.slice('godot'.length,-3)};
}
export function assertOfficialRawTerminal(terminal){
 assert(terminal?.status==='SUCCESS','RAW_TASK_NOT_SUCCESS');const d=terminal.details;
 assert(d?.kind==='OFFICIAL_RAW_BUILD'&&d.artifactState==='RAW_CAPTURED_NOT_FINALIZED'&&d.admission==='NOT_ADMITTED'&&d.postprocess==='NOT_RUN','RAW_TERMINAL_KIND');
 assert(d.build&&Number.isSafeInteger(d.build.bytes)&&/^[a-f0-9]{64}$/.test(d.build.sha256),'RAW_TERMINAL_BUILD_ID');
 return {status:'RAW_TASK_SUCCESS_NOT_FINAL_ENGINE',admission:'NOT_ADMITTED'};
}
function expectedGitCommands(plan){return [['init','--template='+path.join(plan.work,'inputs/git-template'),plan.source],
  ['-C',plan.source,'config','core.autocrlf','false'],['-C',plan.source,'config','core.hooksPath',path.join(plan.work,'inputs/git-hooks')],
  ['-C',plan.source,'remote','add','origin',plan.sourceRepository],['-C',plan.source,'fetch','--no-tags','--depth=1','origin',plan.sourceCommit],
  ['-C',plan.source,'checkout','--detach',plan.sourceCommit]];}
function assertClosedCommands(commands,work){
 for(const command of commands){const result=command.result;assert(result?.closed===true&&result.outcome==='SUCCESS'&&result.exitCode===0&&result.signal===null&&Number.isInteger(result.pid)&&result.pid>0,'RAW_CHILD_NOT_SUCCESSFULLY_CLOSED');
  for(const key of ['stdout','stderr'])assert.deepEqual(pin(regular(inside(work,command[key]))),command[key+'Identity'],'RAW_COMMAND_LOG_DRIFT');
 }
}
function assertCommands(commands,plan){
 const expectedGit=plan.resume?[]:expectedGitCommands(plan);
 assert.equal(commands.length,expectedGit.length+1,'RAW_UNEXPECTED_COMMAND_COUNT');
 for(let i=0;i<expectedGit.length;i++){assert.equal(commands[i].stage,'SOURCE');assert.equal(commands[i].executable,plan.request.gitExecutable);assert.equal(commands[i].cwd,plan.work);assert.deepEqual(commands[i].args,expectedGit[i],'RAW_SOURCE_COMMAND_CHANGED');}
 const compile=commands.filter(c=>c.stage==='COMPILE');assert.equal(compile.length,1,'RAW_ONE_COMPILE_ATTEMPT');
 assert.equal(compile[0].executable,plan.request.python);assert.equal(compile[0].cwd,plan.source);
 assert.deepEqual(compile[0].args,['-m','SCons',...plan.sconsArgs],'RAW_COMPILE_ARGUMENTS_CHANGED');
 assertClosedCommands(commands,plan.work);return compile[0];
}

// Explicit reuse is confined to the one pre-compiler EOL failure. It cannot
// resume a compiler attempt, prepared/modified tree or arbitrary old task.
export function officialRawResumePlan(value){
 assert.equal(arguments.length,1);assert(value&&Object.getPrototypeOf(value)===Object.prototype,'RAW_RESUME_REQUEST');
 assert.deepEqual(Reflect.ownKeys(value).sort(),['schema','parentWork','parentTaskId','work'].sort());
 for(const k of Object.keys(value))assert(Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'),'RAW_RESUME_DATA_FIELDS');
 assert.equal(value.schema,'wxslim-official-raw-resume-v1');
 for(const k of ['parentWork','work'])assert(typeof value[k]==='string'&&path.isAbsolute(value[k])&&!/[\0\r\n]/.test(value[k]),'RAW_RESUME_ABSOLUTE_PATH');
 assert(typeof value.parentTaskId==='string'&&/^[0-9a-f-]{36}$/.test(value.parentTaskId),'RAW_RESUME_PARENT_ID');
 const request={...value,parentWork:path.resolve(value.parentWork),work:path.resolve(value.work)};
 assert.equal(norm(path.dirname(request.work)),norm(request.parentWork),'RAW_RESUME_DIRECT_CHILD');
 assert(/^resume-[0-9]{2}$/.test(path.basename(request.work)),'RAW_RESUME_RECEIPT_DIRECTORY');
 const state=inspectTask(request.parentWork,request.parentTaskId),terminalBytes=regular(path.join(request.parentWork,'terminal.json'));
 assert.equal(state.terminal?.status,'FAILED','RAW_RESUME_PARENT_NOT_FAILED');assert.equal(state.terminal.details.kind,'OFFICIAL_RAW_BUILD');
 assert.equal(state.terminal.details.artifactState,'RAW_NOT_CAPTURED');assert.equal(state.terminal.details.admission,'NOT_ADMITTED');
 const bytes=regular(path.join(request.parentWork,'BUILD.json')),parent=json(bytes);assert.deepEqual(pin(bytes),state.terminal.details.build,'RAW_RESUME_PARENT_RECEIPT');
 assert.equal(parent.plan.request.schema,OFFICIAL_BASE_RAW_REQUEST,'RAW_RESUME_ONLY_ORIGINAL_RECIPE');
 assert.equal(parent.taskId,request.parentTaskId);assert.equal(norm(parent.plan.work),norm(request.parentWork));assert.equal(parent.attempts,1);
 assert.equal(parent.plan.sourceCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');assert.equal(norm(parent.plan.source),norm(path.join(request.parentWork,'engine')));
 assert.equal(parent.plan.resume,undefined,'RAW_RESUME_NOT_RECURSIVE');
 assert.equal(state.owner.recipeId,'official-raw:'+parent.plan.planSha256);assert.equal(state.owner.budgetBytes,parent.plan.request.budgetBytes);
 assert.deepEqual(parent.phases.map(p=>[p.name,p.status]),[['SNAPSHOT','pass'],['SOURCE','fail']]);
 assert.equal(parent.failure.code,'ERR_ASSERTION');assert.equal(parent.failure.message,'SOURCE_FILE_SIZE\n\n1768 !== 1730\n','RAW_RESUME_ONLY_REVIEWED_EOL_FAILURE');
 assert(!parent.materialization&&!parent.baselineFile&&!parent.capture,'RAW_RESUME_PARENT_ALREADY_PREPARED');
 assert.equal(parent.commands.length,6);const expected=expectedGitCommands(parent.plan);
 for(let i=0;i<expected.length;i++){assert.equal(parent.commands[i].stage,'SOURCE');assert.equal(parent.commands[i].executable,parent.plan.request.gitExecutable);assert.equal(parent.commands[i].cwd,parent.plan.work);assert.deepEqual(parent.commands[i].args,expected[i]);}
 assertClosedCommands(parent.commands,request.parentWork);verifySnapshots(request.parentWork,parent.snapshots);
 assert.deepEqual(json(regular(path.join(request.parentWork,'inputs/REQUEST.json'))),parent.plan.request,'RAW_RESUME_PARENT_REQUEST_DRIFT');
 const fresh=officialRawExecutionPlan({...parent.plan.request,work:request.work}),{planSha256:unused,...body}=fresh;
 const plan={...body,source:parent.plan.source,budgetRoot:request.parentWork,artifactRoot:path.join(request.parentWork,'artifacts'),tempRoot:path.join(request.parentWork,'temp'),controlBudgetBytes:20*2**20,
  resume:{request,parentBuild:pin(bytes),parentTerminal:pin(terminalBytes),originalPlanSha256:parent.plan.planSha256,
   sourceAction:'READ_ONLY_BASE_AUDIT_THEN_PREPARE_EXISTING_CHECKOUT',download:false,copySourceTree:false,parentTerminalChanged:false}};
 return {...plan,planSha256:sha(Buffer.from(JSON.stringify(plan)))};
}
const recomputeRawPlan=plan=>plan.resume?officialRawResumePlan(plan.resume.request):officialRawExecutionPlan(plan.request);

export async function executeOfficialRawBuild(value,options={}){
 assert.equal(arguments.length,2,'RAW_EXPLICIT_OPTIONS');assert.deepEqual(Reflect.ownKeys(options),['write'],'RAW_ONLY_WRITE_OPTION');assert.equal(options.write,true,'RAW_EXPLICIT_WRITE_REQUIRED');
 // Preflight must finish before the exclusive work-directory claim. Nothing in
 // a plan or a successful dependency check authorizes this call on its own.
 const preflight=preflightOfficialRawBuild(value);return executePreparedOfficialRaw(preflight);
}
export async function executeOfficialRawResume(value,options={}){
 assert.equal(arguments.length,2,'RAW_EXPLICIT_OPTIONS');assert.deepEqual(Reflect.ownKeys(options),['write'],'RAW_ONLY_WRITE_OPTION');assert.equal(options.write,true,'RAW_EXPLICIT_WRITE_REQUIRED');
 const plan=officialRawResumePlan(value),preflight=preflightOfficialRawBuild(plan.request);
 assert.deepEqual(officialRawResumePlan(value),plan,'RAW_RESUME_PARENT_CHANGED_DURING_PREFLIGHT');
 assert.equal(norm(fs.realpathSync(plan.artifactRoot)),norm(plan.artifactRoot),'RAW_RESUME_ARTIFACT_LINK');
 assert.deepEqual(fs.readdirSync(plan.artifactRoot),[],'RAW_RESUME_REQUIRES_EMPTY_ORIGINAL_ARTIFACTS');
 assert.equal(norm(fs.realpathSync(plan.tempRoot)),norm(plan.tempRoot),'RAW_RESUME_TEMP_LINK');
 assert.deepEqual(fs.readdirSync(plan.tempRoot),[],'RAW_RESUME_REQUIRES_EMPTY_ORIGINAL_TEMP');
 // Preflight's placement/dependency/resource checks apply to this new small
 // receipt directory. The approved engine tree is independently audited below.
 return executePreparedOfficialRaw({...preflight,plan,reusedSource:true});
}
async function executePreparedOfficialRaw(preflight){
 const plan=preflight.plan,r=plan.request,work=r.work,budgetRoot=plan.budgetRoot||work,artifactRoot=plan.artifactRoot||path.join(work,'artifacts');
 const sourceRecipe=officialRawSourceRecipe(r.schema),sourcePlan=sourceRecipe.plan(rawRecipePlanInput(r)),sourceProfile=rawMaterializationProfile(r),env={...officialRawChildEnvironment(r),...(plan.tempRoot?{TEMP:plan.tempRoot,TMP:plan.tempRoot,EMCC_TEMP_DIR:plan.tempRoot}:{})};
 assert.equal(plan.sourceRecipe,sourceRecipe.id);assert.equal(plan.sourcePlanSha256,sourcePlan.planSha256,'RAW_SOURCE_RECIPE_DRIFT');
 const task=createTask(work,{budgetBytes:plan.controlBudgetBytes||r.budgetBytes,recipeId:'official-raw:'+plan.planSha256});
 const signals=cancellationSignals(task),diskCancel=cancellationReader(work,task.taskId),isCancelled=()=>signals.isRequested()||diskCancel();
 const record={schema:'wxslim-official-raw-build-v1',taskId:task.taskId,plan,preflight,environment:selectedEnv(env),commands:[],samples:[preflight.resources],
  boundaries:[],snapshots:[],attempts:1,runtime:'NOT_RUN',phone:'NOT_RUN',postprocess:'NOT_RUN',admission:'NOT_ADMITTED'};
 let pressure=null,sequence=0,baseline=null;
 const evidence=name=>path.join(work,'evidence',name+'.json');
 const checkPreparedReceipts=()=>{
  assert.deepEqual(pin(regular(evidence('prepared-manifest'))),record.baselineFile,'RAW_BASELINE_MANIFEST_CHANGED');
  const materialization=regular(evidence('materialization'));
  assert.deepEqual(pin(materialization),record.materializationFile,'RAW_MATERIALIZATION_RECEIPT_CHANGED');
  assert.deepEqual(json(materialization),record.materialization,'RAW_MATERIALIZATION_RECORD_CHANGED');
 };
 const sample=()=>{
  const resources=officialRawResourceSnapshot(budgetRoot),size=measuredTree(budgetRoot),row={...resources,logicalBytes:size.bytes,transientFilesGone:size.transientGone};
  if(plan.controlBudgetBytes){row.controlBytes=measuredTree(work).bytes;assert(row.controlBytes<plan.controlBudgetBytes-1024*1024,'RAW_CONTROL_BUDGET_RESERVE');}
  record.samples.push(row);checkResourceHeadroom(row,{jobs:r.jobs,budgetBytes:r.budgetBytes,logicalBytes:size.bytes});return row;
 };
 const run=async(stage,executable,args,cwd=plan.source)=>{
  task.checkpoint(stage);if(pressure)fail('RAW_RESOURCE_PRESSURE',pressure.message);
  const number=String(++sequence).padStart(3,'0'),stdout='logs/'+number+'-'+stage+'.stdout.log',stderr='logs/'+number+'-'+stage+'.stderr.log';
  const command={stage,executable,args:[...args],cwd,startedAt:new Date().toISOString(),stdout,stderr,events:[]};record.commands.push(command);
  // Autonomous observations, no model polling. Pressure prevents later phases;
  // the already-running compiler is never killed or silently restarted.
  const monitor=setInterval(()=>{try{sample();}catch(error){pressure??={at:new Date().toISOString(),message:String(error.message)};}},30000);
  try{command.result=await runOwnedProcess({executable,args,cwd,env,stdoutPath:inside(work,stdout),stderrPath:inside(work,stderr),isCancellationRequested:isCancelled,
   onEvent:e=>{command.events.push({type:e.type,elapsedMs:e.elapsedMs,pid:e.pid??null,...(e.exitCode!==undefined?{exitCode:e.exitCode}:{}),...(e.signal!==undefined?{signal:e.signal}:{})});}});}
  finally{clearInterval(monitor);command.endedAt=new Date().toISOString();for(const channel of ['stdout','stderr'])if(fs.existsSync(inside(work,command[channel])))command[channel+'Identity']=pin(regular(inside(work,command[channel])));writeJson(evidence('command-'+number),command);}
  if(command.result.outcome==='CANCELLED')fail('TASK_CANCELLED','Owned child closed after cancellation');
  assert(command.result.closed===true&&command.result.outcome==='SUCCESS'&&Number.isInteger(command.result.pid),command.result.error||'RAW_OWNED_PROCESS_FAILED');
  if(pressure)fail('RAW_RESOURCE_PRESSURE',pressure.message);task.checkpoint(stage);
  return {command:number,exitCode:command.result.exitCode,wallMs:command.result.elapsedMs};
 };
 const git=args=>run('SOURCE',r.gitExecutable,args,work);
 const phases=[
  {name:'SNAPSHOT',run:async()=>{
   for(const dir of ['inputs','logs','evidence','inputs/git-template','inputs/git-hooks'])mkdirInside(work,dir);
   if(!plan.resume){mkdirInside(work,'artifacts');mkdirInside(work,'temp');}
   assertInputs(preflight,sourcePlan);
   const save=(relative,bytes,expected)=>{if(expected)assert.deepEqual(pin(bytes),{bytes:expected.bytes,sha256:expected.sha256},'RAW_SNAPSHOT_INPUT_MISMATCH');mkdirInside(work,path.posix.dirname(relative));writeNew(inside(work,relative),bytes);record.snapshots.push({path:relative,...pin(bytes)});};
   const inputs=new Map([...sourcePlan.dependencies,...plan.implementation].map(p=>[p.path,p]));
   for(const p of inputs.values())save('inputs/repository/'+p.path,regular(path.join(repo,p.path)),p);
   save('inputs/profile.gdbuild',selectedRawProfileBytes(sourcePlan,p=>regular(path.join(repo,p))),sourcePlan.selectedProfile);
   save('inputs/libemscriptenglx.a',regular(r.library),sourcePlan.library);
   save('inputs/upstream-source.js',regular(r.upstreamSource),sourcePlan.upstreamSource.fixedSource);
   save('inputs/pyvenv.cfg',regular(preflight.placement.pythonBase.config));
   save('inputs/REQUEST.json',Buffer.from(JSON.stringify(r,null,2)+'\n'));
   save('inputs/PLAN.json',Buffer.from(JSON.stringify(plan,null,2)+'\n'));
   writeJson(evidence('preflight'),preflight);verifySnapshotInventory(work,record.snapshots,plan,sourcePlan);return {files:record.snapshots.length,bytes:record.snapshots.reduce((n,p)=>n+p.bytes,0)};
  }},
  {name:'SOURCE',run:async()=>{
   if(!plan.resume){
    await git(['init','--template='+path.join(work,'inputs/git-template'),plan.source]);
    await git(['-C',plan.source,'config','core.autocrlf','false']);
    await git(['-C',plan.source,'config','core.hooksPath',path.join(work,'inputs/git-hooks')]);
    await git(['-C',plan.source,'remote','add','origin',plan.sourceRepository]);
    await git(['-C',plan.source,'fetch','--no-tags','--depth=1','origin',plan.sourceCommit]);
    await git(['-C',plan.source,'checkout','--detach',plan.sourceCommit]);
   }
   task.checkpoint('SOURCE');
   const result=await sourceRecipe.materialize({source:plan.source,gitExecutable:r.gitExecutable,profile:sourceProfile,upstreamSource:path.join(work,'inputs/upstream-source.js'),write:true});
   baseline=result.baseline;writeJson(evidence('prepared-manifest'),baseline);record.baselineFile=pin(regular(evidence('prepared-manifest')));
   record.materialization=result.receipt;writeJson(evidence('materialization'),result.receipt);record.materializationFile=pin(regular(evidence('materialization')));
   return {commit:plan.sourceCommit,manifest:record.baselineFile,preparedFiles:baseline.preparedCheckedFiles,modifiedOrAdded:result.receipt.sourceWrites,reusedCheckout:!!plan.resume};
  }},
  {name:'SOURCE_AUDIT',run:async()=>{
   record.modulesBefore=auditOfficialModuleSource({source:plan.source,profile:sourceProfile});writeJson(evidence('module-source'),record.modulesBefore);
   checkPreparedReceipts();verifySnapshots(work,record.snapshots);
   return {status:record.modulesBefore.status,sourceWholeTree:sourceRecipe.preparedStatus(record.materialization)};
  }},
  {name:'PRECOMPILE',run:async()=>{
   assertInputs(preflight,sourcePlan);verifySnapshotInventory(work,record.snapshots,plan,sourcePlan);
   assert.deepEqual(regular(preflight.placement.pythonBase.config),regular(path.join(work,'inputs/pyvenv.cfg')),'RAW_PYTHON_CONFIGURATION_DRIFT');
   checkPreparedReceipts();
   record.sourceBeforeCompile=await sourceRecipe.precompile({source:plan.source,gitExecutable:r.gitExecutable,profile:sourceProfile,baseline,receipt:record.materialization});
   record.dependenciesPrecompile=dependencyAudit(r,env);assert.deepEqual(record.dependenciesPrecompile,preflight.dependencies,'RAW_SDK_CHANGED_BEFORE_COMPILE');
   const resources=sample();checkResourceHeadroom(resources,{jobs:r.jobs,budgetBytes:r.budgetBytes,initial:true});
   writeJson(evidence('precompile'),{source:record.sourceBeforeCompile,dependencies:record.dependenciesPrecompile,resources});return {status:'PRECOMPILE_INPUTS_CHECKED',jobs:r.jobs,thinLtoJobs:8};
  }},
  {name:'COMPILE',run:async()=>{
   const result=await run('COMPILE',r.python,['-m','SCons',...plan.sconsArgs]);
   return {...result,timing:'SCons compilation/link/WASM optimization combined; unobserved substage times are not inferred'};
  }},
  {name:'CAPTURE_RAW',run:async()=>{
   const bin=path.join(plan.source,'bin'),selected=selectOfficialRawOutputs(fs.readdirSync(bin)),capture={selected,inputs:{},outputs:{},later:[]};
   for(const key of ['js','wasm','symbols']){const bytes=regular(path.join(bin,selected[key]));capture.inputs[key]={path:'bin/'+selected[key],...pin(bytes)};writeNew(path.join(artifactRoot,outputNames[key]),bytes);capture.outputs[outputNames[key]]=pin(bytes);}
   const stem=selected.js.slice(0,-3);for(const name of [stem+'.engine.js',stem+'.wrapped.js','.web_zip/godot.js','.web_zip/godot.wasm']){
    const file=path.join(bin,name);if(fs.existsSync(file))capture.later.push({path:'bin/'+name,...pin(regular(file)),selectedForRaw:false});
   }
   record.capture=capture;writeJson(evidence('raw-capture'),capture);return capture;
  }},
  {name:'RAW_AUDIT',run:async()=>{
   checkPreparedReceipts();
   record.postbuildSource=await sourceRecipe.postbuild({source:plan.source,baseline});writeJson(evidence('postbuild-source'),record.postbuildSource);
   record.modulesAfter=auditOfficialModuleSource({source:plan.source,profile:sourceProfile});assert.deepEqual(record.modulesAfter,record.modulesBefore,'RAW_MODULE_SOURCE_DRIFT');
   record.generatedModules=auditRawGeneratedConfiguration(r,p=>regular(path.join(plan.source,p)));
   writeJson(evidence('generated-modules'),record.generatedModules);
   if(r.schema===OFFICIAL_CUSTOM_RAW_REQUEST){
    record.customBuildEvidence=auditCustomBuildEvidence({features:r.features,observed:record.postbuildSource.observed,
     environmentBytes:regular(path.join(plan.source,'.scons_env.json')),expectedProfile:plan.profile,programSuffix:record.capture.selected.progSuffix});
    writeJson(evidence('custom-build-evidence'),record.customBuildEvidence);
   }
   const compile=assertCommands(record.commands,plan);
   try{record.rawInspection=inspectOfficialRawArtifacts({js:regular(path.join(artifactRoot,outputNames.js)),wasm:regular(path.join(artifactRoot,outputNames.wasm)),symbols:regular(path.join(artifactRoot,outputNames.symbols)),compilerStdout:regular(inside(work,compile.stdout)),compilerStderr:regular(inside(work,compile.stderr))});}
   catch(error){if(error.report){record.rawInspection=error.report;writeJson(evidence('raw-inspection'),error.report);}throw error;}
   writeJson(evidence('raw-inspection'),record.rawInspection);
   record.dependenciesAfter=dependencyAudit(r,env);assert.deepEqual(record.dependenciesAfter,preflight.dependencies,'RAW_SDK_CHANGED_AFTER_COMPILE');
   assertInputs(preflight,sourcePlan);verifySnapshotInventory(work,record.snapshots,plan,sourcePlan);
   for(const key of ['js','wasm','symbols']){
    assert.deepEqual(pin(regular(path.join(artifactRoot,outputNames[key]))),record.capture.outputs[outputNames[key]],'RAW_CAPTURE_CHANGED');
    assert.deepEqual(pin(regular(inside(plan.source,record.capture.inputs[key].path))),record.capture.outputs[outputNames[key]],'RAW_SOURCE_OUTPUT_CHANGED');
   }
   return {status:'RAW_INSPECTED_NOT_ADMITTED',postprocess:'NOT_RUN',generatedSources:'PENDING_REVIEW',effectiveMbedtlsObjectsAndFlags:'PENDING_COMMAND_OBJECT_REVIEW',runtime:'NOT_RUN'};
  }}
 ];
 assert.deepEqual(phases.map(p=>p.name),OFFICIAL_RAW_PHASES);
 try{return await runBuildPhases({phases,isCancelled,
  beforePhase:name=>{task.checkpoint(name);if(pressure)fail('RAW_RESOURCE_PRESSURE',pressure.message);record.boundaries.push({phase:name,before:sample()});},
  onEvent:event=>{if(event.status==='PASS')record.boundaries.at(-1).after=sample();task.event(event);},
  finish:(status,details)=>{
   record.phases=details.phases;record.requestedTerminal=status;record.status='REQUIRES_MATCHING_TASK_TERMINAL';record.endedAt=new Date().toISOString();
   if(details.error)record.failure=details.error;if(details.eventErrors)record.eventErrors=details.eventErrors;
   record.pressure=pressure;record.signalCancellationErrors=signals.errors;
   // Keep failed outputs in place, including a successful compile whose next
   // phase was cancelled/resource-blocked. Do not copy a large WASM after a
   // memory/disk gate failed, or label an uncaptured output as a paired capture.
   const compile=record.commands.find(c=>c.stage==='COMPILE');
   if(!record.capture&&compile?.result?.closed){
    try{const names=selectOfficialRawOutputs(fs.readdirSync(path.join(plan.source,'bin')));record.retainedRaw={status:'IN_PLACE_UNVERIFIED',directory:'engine/bin',names,
     identities:'NOT_CAPTURED',reason:'Stopped before complete capture; no retry, transformation or removal performed'};}
    catch(error){record.retainedRaw={status:'NO_UNIQUE_COMPLETE_TRIPLE_OBSERVED',reason:String(error.message),outputsRemoved:false};}
   }
   const partial=fs.existsSync(artifactRoot)&&fs.readdirSync(artifactRoot).length>0;
   const artifactState=record.capture?'RAW_CAPTURED_NOT_FINALIZED':partial?'RAW_CAPTURE_PARTIAL':'RAW_NOT_CAPTURED';
   record.artifactState=artifactState;
   const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');writeNew(path.join(work,'BUILD.json'),bytes);
   try{assert(measuredTree(budgetRoot).bytes+2*bytes.length<r.budgetBytes,'RAW_AGGREGATE_BUDGET');return task.finish(status,{kind:'OFFICIAL_RAW_BUILD',profile:r.profile,sourceRecipe:sourceRecipe.id,build:pin(bytes),artifactState,admission:'NOT_ADMITTED',postprocess:'NOT_RUN',runtime:'NOT_RUN'});}
   catch(error){const wrapped=Error('Raw build receipt retained; task terminal could not be confirmed: '+String(error.message));wrapped.code='RAW_TERMINAL_NOT_CONFIRMED';
    wrapped.evidence={work,taskId:task.taskId,build:pin(bytes),artifactState,terminalFilePresent:fs.existsSync(path.join(work,'terminal.json')),cause:error.code||error.name};throw wrapped;}
  }});}finally{signals.detach();}
}

// Independent re-read after the durable terminal. This never upgrades raw data
// to a usable engine or rewrites a failed/cancelled receipt to make it pass.
export async function auditCompletedOfficialRawBuild(work,taskId){
 assert.equal(arguments.length,2);assert(path.isAbsolute(work));work=path.resolve(work);
 const task=inspectTask(work,taskId);assertOfficialRawTerminal(task.terminal);
 const bytes=regular(path.join(work,'BUILD.json'));assert.deepEqual(pin(bytes),task.terminal.details.build,'RAW_BUILD_RECEIPT_CHANGED');
 const build=json(bytes),plan=recomputeRawPlan(build.plan);
 assert.deepEqual(build.plan,plan,'RAW_CURRENT_RECIPE_DIFFERS');assert.equal(norm(work),norm(plan.work));assert.equal(build.taskId,taskId);
 assert.equal(task.owner.recipeId,'official-raw:'+plan.planSha256);assert.equal(task.owner.budgetBytes,plan.controlBudgetBytes||plan.request.budgetBytes);
 assert.equal(build.attempts,1);assert.equal(build.requestedTerminal,'SUCCESS');assert.equal(build.admission,'NOT_ADMITTED');assert.equal(build.postprocess,'NOT_RUN');
 assert.deepEqual(build.phases.map(p=>p.name),OFFICIAL_RAW_PHASES);assert(build.phases.every(p=>p.status==='pass'),'RAW_INCOMPLETE_PHASES');
 const sourceRecipe=officialRawSourceRecipe(plan.request.schema);assert.equal(plan.sourceRecipe,sourceRecipe.id);assert.equal(task.terminal.details.sourceRecipe,sourceRecipe.id);
 verifySnapshotInventory(work,build.snapshots,plan,sourceRecipe.plan(rawRecipePlanInput(plan.request)));
 const artifactRoot=plan.artifactRoot||path.join(work,'artifacts');
 assert.deepEqual(fs.readdirSync(artifactRoot).sort(),Object.values(outputNames).sort(),'RAW_EXTRA_ARTIFACTS');
 const baselineBytes=regular(path.join(work,'evidence/prepared-manifest.json'));assert.deepEqual(pin(baselineBytes),build.baselineFile);
 const materialization=regular(path.join(work,'evidence/materialization.json'));assert.deepEqual(pin(materialization),build.materializationFile);assert.deepEqual(json(materialization),build.materialization);
 const postbuild=await sourceRecipe.postbuild({source:plan.source,baseline:json(baselineBytes)});assert.deepEqual(postbuild,build.postbuildSource,'RAW_POSTBUILD_TREE_CHANGED');
 assert.deepEqual(auditOfficialModuleSource({source:plan.source,profile:rawMaterializationProfile(plan.request)}),build.modulesAfter);
 assert.deepEqual(auditRawGeneratedConfiguration(plan.request,p=>regular(path.join(plan.source,p))),build.generatedModules);
 if(plan.request.schema===OFFICIAL_CUSTOM_RAW_REQUEST)assert.deepEqual(auditCustomBuildEvidence({features:plan.request.features,observed:postbuild.observed,
  environmentBytes:regular(path.join(plan.source,'.scons_env.json')),expectedProfile:plan.profile,programSuffix:build.capture.selected.progSuffix}),build.customBuildEvidence);
 const compile=assertCommands(build.commands,plan),actual={};
 for(const key of ['js','wasm','symbols']){actual[key]=regular(path.join(artifactRoot,outputNames[key]));assert.deepEqual(pin(actual[key]),build.capture.outputs[outputNames[key]]);assert.deepEqual(pin(regular(inside(plan.source,build.capture.inputs[key].path))),pin(actual[key]));}
 const inspection=inspectOfficialRawArtifacts({...actual,compilerStdout:regular(inside(work,compile.stdout)),compilerStderr:regular(inside(work,compile.stderr))});assert.deepEqual(inspection,build.rawInspection);
 assert.deepEqual(build.dependenciesPrecompile,build.preflight.dependencies);assert.deepEqual(build.dependenciesAfter,build.preflight.dependencies);
 return {schema:'wxslim-official-raw-completed-audit-v1',status:'RAW_TASK_RECHECKED_NOT_ADMITTED',taskId,build:pin(bytes),outputs:build.capture.outputs,
  sourceCommit:plan.sourceCommit,sourceRecipe:sourceRecipe.id,profile:plan.request.profile,programSuffix:build.capture.selected.progSuffix,postprocess:'NOT_RUN',admission:'NOT_ADMITTED',runtime:'NOT_RUN',
  dependencyScope:'Historical before/after receipts; this re-audit does not execute the SDK again',remaining:['Generated-source and effective command/object review','Official final JS postprocess and paired admission','Official conversion and real runtime/device acceptance']};
}

// This explicit standalone entry is not registered as an admitted engine in
// the shared converter/plugin. A plan/read-only preflight cannot start a build.
if(process.argv[1]&&norm(process.argv[1])===norm(fileURLToPath(import.meta.url))){
 try{
  const [command,...args]=process.argv.slice(2);let result;
  if((command==='plan'||command==='preflight')&&args.length===1){const request=json(regular(path.resolve(args[0])));result=command==='plan'?officialRawExecutionPlan(request):preflightOfficialRawBuild(request);}
  else if(command==='resume-plan'&&args.length===1)result=officialRawResumePlan(json(regular(path.resolve(args[0]))));
  else if(command==='execute'&&args.length===2&&args[0]==='--write'){result=await executeOfficialRawBuild(json(regular(path.resolve(args[1]))),{write:true});}
  else if(command==='resume'&&args.length===2&&args[0]==='--write'){result=await executeOfficialRawResume(json(regular(path.resolve(args[1]))),{write:true});}
  else if(command==='audit'&&args.length===2)result=await auditCompletedOfficialRawBuild(path.resolve(args[0]),args[1]);
  else fail('RAW_CLI_USAGE','plan|preflight REQUEST.json; execute --write REQUEST.json; resume-plan REQUEST.json; resume --write RESUME.json; audit WORK TASK_ID');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.status==='FAILED'||result.status==='CANCELLED')process.exitCode=1;
 }catch(error){process.stderr.write(JSON.stringify({status:'FAILED_OR_NOT_STARTED',code:error.code||'OFFICIAL_RAW_REJECTED',message:String(error.message),...(error.evidence?{evidence:error.evidence}:{})})+'\n');process.exitCode=1;}
}
