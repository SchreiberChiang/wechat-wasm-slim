// Pure drafting from an adapter-owned PCK snapshot. Reuse the real in-memory
// partitioner for ownership/boot-only rules; never write its temporary buffers.
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {partitionPck,PCK_PARTITION_LIMIT_BYTES} from '../../lib/pck-partition.mjs';

const MiB=1024*1024;
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const absolute=value=>typeof value==='string'&&value!==''&&value===value.trim()&&!/[\u0000\r\n]/.test(value)&&path.isAbsolute(value);
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);

export function buildResourcePartitionRequestDraft(payload,sourceSnapshot,files){
  need(exact(payload,['sourcePath','output','budgetBytes','packs','dependencyAcknowledged']),'LOCAL_RESOURCE_FORM_FIELDS');
  need(exact(files,['configFile','requestFile']),'LOCAL_RESOURCE_FORM_DESTINATIONS');
  need(absolute(payload.sourcePath)&&absolute(payload.output)&&absolute(files.configFile)&&absolute(files.requestFile),'LOCAL_RESOURCE_FORM_PATH');
  need(payload.dependencyAcknowledged===true,'LOCAL_RESOURCE_FORM_DEPENDENCY_ACK');
  need(Number.isSafeInteger(payload.budgetBytes)&&payload.budgetBytes>=4*MiB&&payload.budgetBytes<=PCK_PARTITION_LIMIT_BYTES+4*MiB,'RESOURCE_PARTITION_TASK_BUDGET');
  need(exact(sourceSnapshot,['sourcePath','pin','inventory','buffer'])&&absolute(sourceSnapshot.sourcePath)&&samePath(payload.sourcePath,sourceSnapshot.sourcePath)&&exact(sourceSnapshot.pin,['bytes','sha256'])&&Buffer.isBuffer(sourceSnapshot.buffer)&&sourceSnapshot.buffer.length<=PCK_PARTITION_LIMIT_BYTES,'LOCAL_RESOURCE_FORM_SNAPSHOT');
  const actual=inspectPck(sourceSnapshot.buffer);
  need(actual.bytes===sourceSnapshot.pin.bytes&&actual.sha256===sourceSnapshot.pin.sha256&&isDeepStrictEqual(actual,sourceSnapshot.inventory),'LOCAL_RESOURCE_FORM_SNAPSHOT_CHANGED');
  const partition={schema:'wxslim-pck-partition-v1',source:{...sourceSnapshot.pin},packs:payload.packs};
  // All actual entries exactly once, one boot, valid IDs and boot-only metadata/
  // scripts are checked here by the existing core, not a second GUI algorithm.
  // The result (including output buffers) is discarded. Shared task plan still
  // re-reads current inputs and checks its real output/receipt budget and paths.
  partitionPck(sourceSnapshot.buffer,partition);
  const config={schema:'wxslim-pck-partition-task-v1',sourcePath:payload.sourcePath,
    partition:{...partition,packs:payload.packs.map(pack=>({id:pack.id,role:pack.role,paths:[...pack.paths]}))},output:payload.output,budgetBytes:payload.budgetBytes};
  const request={schema:'wxslim-task-request-v1',action:'resource-pck-partition',configFile:files.configFile,purpose:'development-test',scope:{}};
  const configText=JSON.stringify(config,null,2)+'\n',requestText=JSON.stringify(request,null,2)+'\n';
  need(Buffer.byteLength(configText)<=MiB&&Buffer.byteLength(requestText)<=MiB,'LOCAL_RESOURCE_FORM_DOCUMENT_LIMIT');
  return {config,request,configText,requestText};
}
