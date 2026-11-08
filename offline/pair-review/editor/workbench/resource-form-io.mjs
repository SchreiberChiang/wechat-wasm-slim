// Local read boundary for the resource form. The CLI remains the execution authority.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {PCK_PARTITION_LIMIT_BYTES} from '../../lib/pck-partition.mjs';

const MiB=1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const token=value=>typeof value==='string'&&/^[0-9]{1,12}-[0-9]{1,24}$/.test(value);
const absolute=value=>typeof value==='string'&&value===value.trim()&&path.isAbsolute(value)&&!/[\0\r\n]/.test(value);
const normalized=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const sameStat=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);

// Dependency injection is for in-memory checks only, never accepted from argv.
export function readStableResourceFile(file,limit,io=fs){
  need(absolute(file)&&Number.isSafeInteger(limit)&&limit>0,'LOCAL_RESOURCE_READ_ARGUMENT');
  need(normalized(io.realpathSync(file))===normalized(file),'LOCAL_RESOURCE_LINK_PATH');
  const before=io.lstatSync(file);
  need(before.isFile()&&!before.isSymbolicLink()&&Number.isSafeInteger(before.size)&&before.size>0&&before.size<=limit,'LOCAL_RESOURCE_FILE_LIMIT');
  const fd=io.openSync(file,'r');
  try{
    need(sameStat(before,io.fstatSync(fd)),'LOCAL_RESOURCE_FILE_CHANGED');
    const bytes=Buffer.alloc(before.size);let read=0;
    while(read<bytes.length){const count=io.readSync(fd,bytes,read,bytes.length-read,read);need(count>0,'LOCAL_RESOURCE_SHORT_READ');read+=count;}
    need(sameStat(before,io.fstatSync(fd))&&sameStat(before,io.lstatSync(file)),'LOCAL_RESOURCE_FILE_CHANGED');
    need(normalized(io.realpathSync(file))===normalized(file),'LOCAL_RESOURCE_LINK_PATH');
    return bytes;
  }finally{io.closeSync(fd);}
}

export function readResourceInventory(payload,io=fs){
  need(exact(payload,['sourcePath'])&&absolute(payload.sourcePath),'LOCAL_RESOURCE_INVENTORY_FIELDS');
  const buffer=readStableResourceFile(payload.sourcePath,PCK_PARTITION_LIMIT_BYTES,io),inventory=inspectPck(buffer);
  return {sourcePath:payload.sourcePath,pin:{bytes:inventory.bytes,sha256:inventory.sha256},inventory,buffer};
}

export function readResourceDeclaration(logs,payload,io=fs){
  need(absolute(logs)&&exact(payload,['declarationToken','declarationSha256','inventoryToken'])&&token(payload.declarationToken)&&token(payload.inventoryToken)&&
    typeof payload.declarationSha256==='string'&&/^[a-f0-9]{64}$/.test(payload.declarationSha256),'LOCAL_RESOURCE_DECLARATION_REFERENCE');
  const declarationFile=path.join(logs,payload.declarationToken+'.resource-declaration.private.json');
  const bytes=readStableResourceFile(declarationFile,MiB,io);
  need(sha(bytes)===payload.declarationSha256,'LOCAL_RESOURCE_DECLARATION_CHANGED');
  const declaration=JSON.parse(bytes.toString('utf8'));
  const receiptFile=path.join(logs,payload.inventoryToken+'.result.private.json');
  const previous=JSON.parse(readStableResourceFile(receiptFile,2*MiB,io).toString('utf8'));
  need(previous&&typeof previous==='object'&&!Array.isArray(previous)&&previous.schema==='wxslim-local-plugin-result-v1'&&previous.token===payload.inventoryToken&&previous.operation==='resource-inventory'&&previous.ok===true&&
    previous.executionAuthorized===false&&previous.data?.schema==='wxslim-local-resource-inventory-v1','LOCAL_RESOURCE_INVENTORY_RECEIPT');
  need(absolute(declaration?.sourcePath)&&absolute(previous.data.sourcePath)&&normalized(previous.data.sourcePath)===normalized(declaration.sourcePath),'LOCAL_RESOURCE_INVENTORY_SOURCE_CHANGED');
  const snapshot=readResourceInventory({sourcePath:declaration.sourcePath},io);
  need(isDeepStrictEqual(snapshot.pin,previous.data.pin)&&isDeepStrictEqual(snapshot.inventory,previous.data.inventory),'LOCAL_RESOURCE_INVENTORY_STALE');
  return {declaration,snapshot};
}
