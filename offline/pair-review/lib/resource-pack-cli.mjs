// Shared resource CLI. Tiny native fixture execution requires explicit --write.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectResourcePlan} from './resource-pack-plan.mjs';
import {partitionPck,PCK_PARTITION_LIMIT_BYTES} from './pck-partition.mjs';
import {createHash} from 'node:crypto';
import {planResourceExportLab,executeResourceExportLab} from './resource-export-lab.mjs';
import {inspectTask,requestCancellation} from '../convert/lib/official-task.mjs';
import {renderResourceInterfacesFromFiles} from './resource-interfaces-bundle.mjs';
import {inspectResourceGameBootRequest} from './resource-game-boot-audit.mjs';
import {inspectResourceProjectSource} from './resource-project-source-plan.mjs';

function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function ordinary(stat){need(stat.isFile()&&!stat.isSymbolicLink(),'RESOURCE_PARTITION_SOURCE_FILE');}
function sameStat(a,b){need(['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]),'RESOURCE_PARTITION_SOURCE_CHANGED');}
function partitionCheck(raw,base){
  need(exact(raw,['schema','sourcePath','partition'])&&raw.schema==='wxslim-pck-partition-request-v1','RESOURCE_PARTITION_REQUEST');
  need(typeof raw.sourcePath==='string'&&raw.sourcePath.trim()===raw.sourcePath&&raw.sourcePath&&!/[\u0000\r\n]/.test(raw.sourcePath),'RESOURCE_PARTITION_SOURCE_PATH');
  const pin=raw.partition?.source;
  need(exact(pin,['bytes','sha256'])&&Number.isSafeInteger(pin.bytes)&&pin.bytes>=104&&pin.bytes<=PCK_PARTITION_LIMIT_BYTES&&typeof pin.sha256==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256),'PCK_PARTITION_SOURCE_PIN');
  const sourcePath=path.resolve(base,raw.sourcePath),before=fs.lstatSync(sourcePath,{bigint:true});ordinary(before);
  need(before.size<=BigInt(PCK_PARTITION_LIMIT_BYTES),'RESOURCE_PARTITION_SOURCE_BUDGET');
  need(before.size===BigInt(pin.bytes),'PCK_PARTITION_SOURCE_CHANGED');
  const fd=fs.openSync(sourcePath,'r');
  let bytes;
  try{
    const opened=fs.fstatSync(fd,{bigint:true});ordinary(opened);sameStat(before,opened);
    // A growing file must not make readFileSync allocate beyond the pinned size.
    bytes=Buffer.allocUnsafe(pin.bytes);let offset=0;
    while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);need(count>0,'RESOURCE_PARTITION_SOURCE_CHANGED');offset+=count;}
    need(fs.readSync(fd,Buffer.alloc(1),0,1,null)===0,'RESOURCE_PARTITION_SOURCE_CHANGED');
    const after=fs.fstatSync(fd,{bigint:true});ordinary(after);sameStat(opened,after);
    const named=fs.lstatSync(sourcePath,{bigint:true});ordinary(named);sameStat(before,named);
    need(bytes.length===pin.bytes&&createHash('sha256').update(bytes).digest('hex')===pin.sha256,'PCK_PARTITION_SOURCE_CHANGED');
  }finally{fs.closeSync(fd);}
  const result=partitionPck(bytes,raw.partition);
  // Recheck the named source after in-memory partitioning; the audit exposes no
  // filesystem paths and the newly generated PCK buffers are never serialized.
  const final=fs.lstatSync(sourcePath,{bigint:true});ordinary(final);sameStat(before,final);
  return result.audit;
}

export function resourceCommand(args){
  if(args[0]==='source-plan'){
    need(args.length===2,'RESOURCE_PROJECT_ARGUMENTS');
    return inspectResourceProjectSource(args[1]);
  }
  if(args[0]==='boot-check'){
    need(args.length===2,'RESOURCE_BOOT_ARGUMENTS');
    return inspectResourceGameBootRequest(args[1]);
  }
  if(args[0]==='interfaces-check'){
    need(args.length===2,'RESOURCE_INTERFACES_ARGUMENTS');
    const requestFile=path.resolve(args[1]),base=path.dirname(requestFile),request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
    need(exact(request,['schema','resourceConfig','engine','expected'])&&request.schema==='wxslim-resource-interfaces-check-v1'&&typeof request.resourceConfig==='string'&&exact(request.engine,['js','wasm'])&&exact(request.expected,['engineJsSha256','wasmSha256']),'RESOURCE_INTERFACES_REQUEST');
    const configFile=path.resolve(base,request.resourceConfig),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
    const result=renderResourceInterfacesFromFiles({config,base:path.dirname(configFile),engine:{js:path.resolve(base,request.engine.js),wasm:path.resolve(base,request.engine.wasm)},expected:request.expected,developmentOnly:true});
    const {source,...receipt}=result;
    return {...receipt,sourceWritten:false,executionAuthorized:false};
  }
  if(args[0]==='lab-continue-export'){
    need(args.length===5&&args[4]==='--write'&&/^[a-f0-9-]{36}$/.test(args[2])&&/^[a-f0-9]{64}$/.test(args[3]),'RESOURCE_LAB_ARGUMENTS');
    const request=JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8'));
    return executeResourceExportLab(request,{writeAuthorized:true,resumeExportTaskId:args[2],expectedFullPckSha256:args[3]});
  }
  if(args[0]==='lab-continue-import'){
    need(args.length===4&&args[3]==='--write'&&/^[a-f0-9-]{36}$/.test(args[2]),'RESOURCE_LAB_ARGUMENTS');
    const request=JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8'));
    return executeResourceExportLab(request,{writeAuthorized:true,resumeImportTaskId:args[2]});
  }
  if(['lab-status','lab-cancel'].includes(args[0])){
    need(args.length===3,'RESOURCE_LAB_ARGUMENTS');
    const current=inspectTask(args[1],args[2]);
    need(current.owner.recipeId==='native-resource-export-fixed-editor-v1','RESOURCE_LAB_TASK_ID');
    return args[0]==='lab-status'?current:requestCancellation(args[1],args[2]);
  }
  if(['lab-plan','lab-execute'].includes(args[0])){
    const executing=args[0]==='lab-execute';
    need(args.length===(executing?3:2)&&(!executing||args[2]==='--write'),'RESOURCE_LAB_ARGUMENTS');
    const request=JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8'));
    return executing?executeResourceExportLab(request,{writeAuthorized:true}):planResourceExportLab(request);
  }
  if(args.length!==2||!['plan','partition-check'].includes(args[0]))throw Object.assign(Error('plan|partition-check CONFIG.json only'),{code:'RESOURCE_PLAN_COMMAND_ONLY'});
  const file=path.resolve(args[1]),raw=JSON.parse(fs.readFileSync(file,'utf8'));
  if(args[0]==='partition-check')return partitionCheck(raw,path.dirname(file));
  return inspectResourcePlan(raw,{base:path.dirname(file)});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),mayExecute=(args[0]==='lab-execute'&&args.length===3&&args[2]==='--write')||(args[0]==='lab-continue-import'&&args.length===4&&args[3]==='--write')||(args[0]==='lab-continue-export'&&args.length===5&&args[4]==='--write');
  try{const result=await resourceCommand(args);console.log(JSON.stringify(result,null,2));if(mayExecute&&result.terminal?.status!=='SUCCESS')process.exitCode=2;}
  catch(error){console.error(JSON.stringify({schema:'wxslim-resource-error-v1',code:/^(RESOURCE_|PCK_|TASK_)[A-Z_]+$/.test(error.code||'')?error.code:'RESOURCE_PLAN_FAILED',message:mayExecute?'原生资源实验未正常结束；可能已有部分产物或运行，请核对任务终态和完整日志。':'资源工具请求未通过；没有据此认定任何运行验证通过。',executionAuthorized:mayExecute,...(mayExecute?{possibleSideEffects:'UNKNOWN_UNTIL_TASK_INSPECTED'}:{})}));process.exitCode=2;}
}
