// Optional, read-only projection of an already bound task's existing events.
// It is not a process monitor, terminal receipt, execution gate or log filter.
import fs from 'node:fs';
import path from 'node:path';

export const TASK_EVENT_LIMITS=Object.freeze({bytes:1024*1024,lineBytes:128*1024,lines:4096});
const fields=['dev','ino','size','mtimeMs','ctimeMs'];
const same=(a,b)=>fields.every(key=>a[key]===b[key]);
const ordinary=stat=>stat.isFile()&&!stat.isSymbolicLink();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const token=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value);
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const base=()=>({source:'events.jsonl',readStatus:'UNAVAILABLE',reason:null,bytesRead:0,eventCount:0,ignoredPartialBytes:0,lastEvent:null,
  scope:'LAST_RECORDED_EVENT_NOT_LIVENESS_OR_TERMINAL'});

/** io is injected only by offline tests; never taken from task configuration. */
export function readTaskEventProgress(root,taskId,{io=fs}={}){
  const result=base(),file=path.join(root,'events.jsonl');
  let fd,bytes,error;
  try{
    const before=io.lstatSync(file);
    if(!ordinary(before))return {...result,reason:'EVENT_LOG_NOT_REGULAR'};
    if(!Number.isSafeInteger(before.size)||before.size<0||before.size>TASK_EVENT_LIMITS.bytes)return {...result,reason:'EVENT_LOG_BYTE_LIMIT'};
    fd=io.openSync(file,'r');
    const opened=io.fstatSync(fd);
    if(!ordinary(opened)||!same(before,opened))return {...result,reason:'EVENT_LOG_CHANGED'};
    bytes=Buffer.alloc(before.size);
    while(result.bytesRead<bytes.length){
      const n=io.readSync(fd,bytes,result.bytesRead,bytes.length-result.bytesRead,result.bytesRead);
      if(!Number.isSafeInteger(n)||n<=0||n>bytes.length-result.bytesRead)return {...result,reason:'EVENT_LOG_CHANGED'};
      result.bytesRead+=n;
    }
    const after=io.fstatSync(fd),named=io.lstatSync(file);
    if(!ordinary(after)||!ordinary(named)||!same(before,after)||!same(before,named))return {...result,reason:'EVENT_LOG_CHANGED'};
  }catch(cause){error=cause.code==='ENOENT'?'EVENT_LOG_MISSING':'EVENT_LOG_READ_FAILED';}
  finally{if(fd!==undefined)try{io.closeSync(fd);}catch{error='EVENT_LOG_READ_FAILED';}}
  if(error)return {...result,reason:error};

  // A writer may have left an incomplete final line. Never parse it or present
  // it as a complete event. A bad complete line invalidates the whole projection.
  const end=bytes.lastIndexOf(10)+1;
  result.ignoredPartialBytes=bytes.length-end;
  const reject=reason=>({...result,readStatus:'UNAVAILABLE',reason,eventCount:0,lastEvent:null});
  if(result.ignoredPartialBytes>TASK_EVENT_LIMITS.lineBytes)return reject('EVENT_LINE_BYTE_LIMIT');
  let start=0;
  while(start<end){
    const stop=bytes.indexOf(10,start);
    if(stop-start>TASK_EVENT_LIMITS.lineBytes)return reject('EVENT_LINE_BYTE_LIMIT');
    if(result.eventCount>=TASK_EVENT_LIMITS.lines)return reject('EVENT_LOG_LINE_LIMIT');
    let event;
    try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,stop)));}
    catch{return reject('EVENT_RECORD_INVALID');}
    if(!object(event)||Object.keys(event).some(key=>!['taskId','at','stage','status','details'].includes(key))||
       !iso(event.at)||['stage','status'].some(key=>Object.hasOwn(event,key)&&!token(event[key])))return reject('EVENT_RECORD_INVALID');
    if(event.taskId!==taskId)return reject('EVENT_TASK_ID_MISMATCH');
    let wallMs=null;
    if(object(event.details)&&Object.hasOwn(event.details,'wallMs')){
      if(typeof event.details.wallMs!=='number'||!Number.isFinite(event.details.wallMs)||event.details.wallMs<0)return reject('EVENT_WALL_TIME_INVALID');
      wallMs=event.details.wallMs;
    }
    result.lastEvent={stage:event.stage??null,status:event.status??null,at:event.at,wallMs};
    result.eventCount++;
    start=stop+1;
  }
  result.readStatus=result.ignoredPartialBytes?'PARTIAL':'COMPLETE';
  result.reason=result.ignoredPartialBytes?'EVENT_TRAILING_PARTIAL':result.eventCount?null:'NO_EVENTS_RECORDED';
  return result;
}
