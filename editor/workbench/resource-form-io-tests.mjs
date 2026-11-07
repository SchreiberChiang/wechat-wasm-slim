// All filesystem operations below are an injected in-memory model. No real
// PCK/source read, output directory, task, editor, build or network operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readStableResourceFile,readResourceInventory,readResourceDeclaration} from './resource-form-io.mjs';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {PCK_PARTITION_LIMIT_BYTES} from '../../lib/pck-partition.mjs';
const MiB=1024*1024,base=path.resolve('MEMORY_ONLY_RESOURCE_IO'),logs=path.join(base,'logs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v)+'\n');
const key=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);

function memoryIO(entries){
  const files=new Map(),handles=new Map(),calls=[];let ino=100,nextFD=10;
  function put(file,bytes,options={}){
    const record={bytes:Buffer.from(bytes),kind:'file',stat:{dev:1,ino:ino++,size:bytes.length,mtimeMs:1000,ctimeMs:2000},maxRead:Infinity,...options};
    files.set(key(file),record);return record;
  }
  for(const [file,bytes]of entries)put(file,bytes);
  const state={files,handles,calls,put,hook:null};
  const emit=(op,details={})=>{const call={op,...details};calls.push(call);state.hook?.(call,state);};
  function named(file){const r=files.get(key(file));if(!r)throw Object.assign(Error('model missing file'),{code:'ENOENT'});return r;}
  function stat(r){return {...r.stat,isFile:()=>r.kind==='file',isSymbolicLink:()=>r.kind==='link'};}
  const io={
    realpathSync(file){emit('realpath',{file});return named(file).realpath??path.resolve(file);},
    lstatSync(file){emit('lstat',{file});return stat(named(file));},
    openSync(file,mode){emit('open',{file,mode});assert.equal(mode,'r');const fd=nextFD++;handles.set(fd,{record:named(file),closed:false,fstats:0,reads:0});return fd;},
    fstatSync(fd){const h=handles.get(fd);assert(h&&!h.closed);h.fstats++;emit('fstat',{fd,index:h.fstats});return stat(h.record);},
    readSync(fd,target,offset,length,position){const h=handles.get(fd);assert(h&&!h.closed);h.reads++;emit('read',{fd,offset,length,position,index:h.reads});
      const r=h.record,count=Math.max(0,Math.min(length,r.bytes.length-position,r.maxRead));if(count)r.bytes.copy(target,offset,position,position+count);return count;},
    closeSync(fd){const h=handles.get(fd);assert(h&&!h.closed);h.closed=true;emit('close',{fd});}
  };
  return {...state,io,state,record:file=>named(file),opened:()=>calls.filter(c=>c.op==='open').length,closed:()=>calls.filter(c=>c.op==='close').length};
}
function allClosed(f){assert.equal(f.closed(),f.opened());assert([...f.handles.values()].every(h=>h.closed));}

// Same structural PCK4 fixture layout as resource-request-form-tests. The bytes
// go through the actual inspectPck, not a caller-authored inventory receipt.
function buildPck(names=['project.binary','boot.gd','levels/a.tscn','shared/checker.svg.import']){
  const rows=names.map(name=>({name:Buffer.from(name),data:Buffer.from('structure-only model: '+name)}));let end=113;
  for(const row of rows){row.offset=end;end+=row.data.length+7;}
  const b=Buffer.alloc(end+4+rows.reduce((n,r)=>n+40+Math.ceil(r.name.length/4)*4,0));b.write('GDPC');b.writeUInt32LE(4,4);
  [4,7,2].forEach((n,i)=>b.writeUInt32LE(n,8+4*i));b.writeBigUInt64LE(113n,24);b.writeBigUInt64LE(BigInt(end),32);b.writeUInt32LE(rows.length,end);let at=end+4;
  for(const r of rows){const pad=Math.ceil(r.name.length/4)*4;b.writeUInt32LE(pad,at);at+=4;r.name.copy(b,at);at+=pad;b.writeBigUInt64LE(BigInt(r.offset-113),at);b.writeBigUInt64LE(BigInt(r.data.length),at+8);createHash('md5').update(r.data).digest().copy(b,at+16);at+=36;r.data.copy(b,r.offset);}return b;
}
function declarationFixture(){
  const sourcePath=path.join(base,'完整游戏.pck'),buffer=buildPck(),inventory=inspectPck(buffer),pin={bytes:buffer.length,sha256:sha(buffer)};
  const payload={declarationToken:'123-456',declarationSha256:'',inventoryToken:'123-455'};
  const declarationFile=path.join(logs,payload.declarationToken+'.resource-declaration.private.json'),receiptFile=path.join(logs,payload.inventoryToken+'.result.private.json');
  const declaration={sourcePath,output:path.join(base,'future-task'),budgetBytes:8*MiB,packs:[{id:'boot',role:'boot',paths:inventory.entries.map(e=>e.path)}],dependencyAcknowledged:true};
  const receipt={schema:'wxslim-local-plugin-result-v1',token:payload.inventoryToken,operation:'resource-inventory',ok:true,executionAuthorized:false,data:{schema:'wxslim-local-resource-inventory-v1',sourcePath,pin,inventory}};
  const f=memoryIO([[sourcePath,buffer],[declarationFile,json(declaration)],[receiptFile,json(receipt)]]);
  function setDeclaration(value){f.put(declarationFile,json(value));payload.declarationSha256=sha(f.record(declarationFile).bytes);}
  function setReceipt(value){f.put(receiptFile,json(value));}
  setDeclaration(declaration);
  return {...f,sourcePath,buffer,inventory,pin,payload,declaration,receipt,declarationFile,receiptFile,setDeclaration,setReceipt,read:()=>readResourceDeclaration(logs,payload,f.io)};
}

test('stable read returns independently owned bytes, permits exact limit and closes one read-only handle',()=>{
  const file=path.join(base,'small.bin'),f=memoryIO([[file,Buffer.from([1,2,3,4,5])]]),result=readStableResourceFile(file,5,f.io);
  assert.deepEqual(result,Buffer.from([1,2,3,4,5]));assert.equal(f.opened(),1);allClosed(f);result[0]=99;assert.equal(f.record(file).bytes[0],1);
  assert.deepEqual(f.calls.filter(c=>c.op==='read').map(c=>[c.position,c.length]),[[0,5]]);
});
test('partial reads advance exact positions until complete; zero short read closes and rejects',()=>{
  const file=path.join(base,'partial.bin'),f=memoryIO([[file,Buffer.from('abcdefg')]]);f.record(file).maxRead=2;
  assert.equal(readStableResourceFile(file,7,f.io).toString(),'abcdefg');assert.deepEqual(f.calls.filter(c=>c.op==='read').map(c=>c.position),[0,2,4,6]);allClosed(f);
  const broken=memoryIO([[file,Buffer.from('abc')]]);broken.record(file).stat.size=4;assert.throws(()=>readStableResourceFile(file,4,broken.io),{code:'LOCAL_RESOURCE_SHORT_READ'});allClosed(broken);
});
test('size and argument limits reject before allocating/reading a synthetic large input',()=>{
  const file=path.join(base,'tiny.bin');
  for(const size of [0,-1,6,Number.MAX_SAFE_INTEGER+1,NaN,Infinity]){const f=memoryIO([[file,Buffer.from('tiny')]]);f.record(file).stat.size=size;assert.throws(()=>readStableResourceFile(file,5,f.io),{code:'LOCAL_RESOURCE_FILE_LIMIT'});assert.equal(f.opened(),0);assert.equal(f.closed(),0);}
  for(const limit of [0,-1,0.5,NaN,Infinity,'4']){const f=memoryIO([[file,Buffer.from('tiny')]]);assert.throws(()=>readStableResourceFile(file,limit,f.io),{code:'LOCAL_RESOURCE_READ_ARGUMENT'});assert.deepEqual(f.calls,[]);}
  for(const name of ['relative.bin','',file+'\0',file+'\n',file+'\r',' '+file]){const f=memoryIO([[file,Buffer.from('tiny')]]);assert.throws(()=>readStableResourceFile(name,4,f.io),{code:'LOCAL_RESOURCE_READ_ARGUMENT'});assert.deepEqual(f.calls,[]);}
});
test('initial symlink, non-file and parent realpath indirection fail before open',()=>{
  const file=path.join(base,'linked.bin');
  for(const kind of ['link','directory']){const f=memoryIO([[file,Buffer.from('tiny')]]);f.record(file).kind=kind;assert.throws(()=>readStableResourceFile(file,4,f.io),{code:'LOCAL_RESOURCE_FILE_LIMIT'});assert.equal(f.opened(),0);}
  const f=memoryIO([[file,Buffer.from('tiny')]]);f.record(file).realpath=path.join(base,'different.bin');assert.throws(()=>readStableResourceFile(file,4,f.io),{code:'LOCAL_RESOURCE_LINK_PATH'});assert.equal(f.opened(),0);
});
test('open-time and post-read fstat changes in every bound identity field reject and close',()=>{
  const file=path.join(base,'change.bin');
  for(const field of ['dev','ino','size','mtimeMs','ctimeMs'])for(const index of [1,2]){
    const f=memoryIO([[file,Buffer.from('tiny')]]);f.state.hook=call=>{if(call.op==='fstat'&&call.index===index)f.record(file).stat[field]++;};
    assert.throws(()=>readStableResourceFile(file,4,f.io),{code:'LOCAL_RESOURCE_FILE_CHANGED'});allClosed(f);if(index===1)assert.equal(f.calls.some(c=>c.op==='read'),false);
  }
});
test('named-path replacement and late realpath changes reject even while the old fd remains stable',()=>{
  const file=path.join(base,'replace.bin'),f=memoryIO([[file,Buffer.from('tiny')]]);
  f.state.hook=call=>{if(call.op==='read')f.put(file,Buffer.from('tiny'));};assert.throws(()=>readStableResourceFile(file,4,f.io),{code:'LOCAL_RESOURCE_FILE_CHANGED'});allClosed(f);
  const moved=memoryIO([[file,Buffer.from('tiny')]]);let realpaths=0;moved.state.hook=call=>{if(call.op==='realpath'&&++realpaths===2)moved.record(file).realpath=path.join(base,'moved.bin');};assert.throws(()=>readStableResourceFile(file,4,moved.io),{code:'LOCAL_RESOURCE_LINK_PATH'});allClosed(moved);
});
test('IO exceptions preserve failure and close already-open handles; close failure cannot report success',()=>{
  const file=path.join(base,'error.bin');
  for(const op of ['fstat','read']){const f=memoryIO([[file,Buffer.from('tiny')]]);f.state.hook=call=>{if(call.op===op)throw Object.assign(Error('model IO error'),{code:'EIO'});};assert.throws(()=>readStableResourceFile(file,4,f.io),{code:'EIO'});allClosed(f);}
  const close=memoryIO([[file,Buffer.from('tiny')]]);close.state.hook=call=>{if(call.op==='close')throw Object.assign(Error('model close error'),{code:'EIO'});};assert.throws(()=>readStableResourceFile(file,4,close.io),{code:'EIO'});allClosed(close);
  const open=memoryIO([[file,Buffer.from('tiny')]]);open.state.hook=call=>{if(call.op==='open')throw Object.assign(Error('model open error'),{code:'EACCES'});};assert.throws(()=>readStableResourceFile(file,4,open.io),{code:'EACCES'});assert.equal(open.closed(),0);assert.equal(open.handles.size,0);
});
test('resource inventory uses actual structural PCK bytes and owns no task/authority state',()=>{
  const file=path.join(base,'source.pck'),b=buildPck(),f=memoryIO([[file,b]]),r=readResourceInventory({sourcePath:file},f.io);
  assert.deepEqual(r,{sourcePath:file,pin:{bytes:b.length,sha256:sha(b)},inventory:inspectPck(b),buffer:b});assert.equal(r.inventory.status,'PASS_PCK_STRUCTURE_ONLY');allClosed(f);
  for(const field of ['runtimeEligible','executionAuthorized','taskExecuted','outputs'])assert(!Object.hasOwn(r,field));
  r.buffer[0]=0;assert.equal(f.record(file).bytes[0],71);
});
test('inventory exact payload, corrupt PCK and 256 MiB declared size fail without reading any large bytes',()=>{
  const file=path.join(base,'source.pck'),b=buildPck();
  for(const payload of [{},{sourcePath:file,execute:true},{sourcePath:'relative'},null]){const f=memoryIO([[file,b]]);assert.throws(()=>readResourceInventory(payload,f.io),{code:'LOCAL_RESOURCE_INVENTORY_FIELDS'});assert.deepEqual(f.calls,[]);}
  const bad=Buffer.from(b);bad[113]^=1;const f=memoryIO([[file,bad]]);assert.throws(()=>readResourceInventory({sourcePath:file},f.io),{code:'PCK_MD5'});allClosed(f);
  const huge=memoryIO([[file,Buffer.from('not large')]]);huge.record(file).stat.size=PCK_PARTITION_LIMIT_BYTES+1;assert.throws(()=>readResourceInventory({sourcePath:file},huge.io),{code:'LOCAL_RESOURCE_FILE_LIMIT'});assert.equal(huge.opened(),0);
});
test('declaration succeeds only after re-reading exact source bytes/pin/inventory against a read-only inventory receipt',()=>{
  const f=declarationFixture(),r=f.read();assert.deepEqual(r.declaration,f.declaration);assert.deepEqual(r.snapshot,{sourcePath:f.sourcePath,pin:f.pin,inventory:f.inventory,buffer:f.buffer});allClosed(f);assert.equal(f.opened(),3);
  assert.deepEqual(f.calls.filter(c=>c.op==='open').map(c=>c.file),[f.declarationFile,f.receiptFile,f.sourcePath]);assert(f.calls.every(c=>!['write','mkdir','rename','unlink'].includes(c.op)));
});
test('invalid token/hash/log root or payload shape is rejected before any file access',()=>{
  const mutations=[p=>p.declarationToken='../escape',p=>p.inventoryToken='bad',p=>p.declarationToken='1'.repeat(13)+'-1',p=>p.inventoryToken='1-'+'1'.repeat(25),p=>p.declarationSha256='A'.repeat(64),p=>p.declarationSha256='0'.repeat(63),p=>p.declarationSha256=null,p=>p.extra=true,p=>delete p.inventoryToken];
  for(const mutate of mutations){const f=declarationFixture();mutate(f.payload);assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_DECLARATION_REFERENCE'});assert.deepEqual(f.calls,[]);}
  const f=declarationFixture();assert.throws(()=>readResourceDeclaration('relative',f.payload,f.io),{code:'LOCAL_RESOURCE_DECLARATION_REFERENCE'});assert.deepEqual(f.calls,[]);
});
test('declaration hash drift rejects before receipt/source reads; malformed JSON never becomes an accepted declaration',()=>{
  const f=declarationFixture();f.record(f.declarationFile).bytes[0]^=1;assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_DECLARATION_CHANGED'});assert.equal(f.opened(),1);allClosed(f);
  const malformed=declarationFixture();malformed.put(malformed.declarationFile,Buffer.from('{broken'));malformed.payload.declarationSha256=sha(malformed.record(malformed.declarationFile).bytes);assert.throws(()=>malformed.read(),SyntaxError);allClosed(malformed);
});
test('inventory receipt must be successful, token-bound, resource-inventory and explicitly read-only',()=>{
  const mutations=[r=>r.schema='wrong',r=>r.token='123-999',r=>r.operation='plan',r=>r.ok=false,r=>r.ok='true',r=>r.executionAuthorized=true,r=>delete r.executionAuthorized,r=>r.data.schema='wrong',r=>r.data=null];
  for(const mutate of mutations){const f=declarationFixture();mutate(f.receipt);f.setReceipt(f.receipt);assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_INVENTORY_RECEIPT'});assert.equal(f.opened(),2);allClosed(f);}
  for(const value of [null,false,42,'receipt']){const f=declarationFixture();f.setReceipt(value);assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_INVENTORY_RECEIPT'});allClosed(f);}
});
test('receipt and declaration source paths must be explicit and agree before source PCK reads',()=>{
  for(const sourcePath of [undefined,null,42,'relative.pck',path.join(base,'other.pck')]){
    const f=declarationFixture();f.receipt.data.sourcePath=sourcePath;f.setReceipt(f.receipt);assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_INVENTORY_SOURCE_CHANGED'});assert.equal(f.opened(),2);allClosed(f);
  }
  for(const value of [null,{}, {sourcePath:'relative.pck'}]){const f=declarationFixture();f.setDeclaration(value);assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_INVENTORY_SOURCE_CHANGED'});allClosed(f);}
});
test('receipt pin/inventory tampering or a later valid-but-different PCK is stale rather than reused',()=>{
  const mutations=[r=>r.data.pin.bytes++,r=>r.data.pin.sha256='0'.repeat(64),r=>r.data.pin.extra=true,r=>delete r.data.pin,r=>r.data.inventory.entries.pop(),r=>r.data.inventory.entries[0].path='forged',r=>r.data.inventory.status='CLAIMED_PASS',r=>delete r.data.inventory];
  for(const mutate of mutations){const f=declarationFixture();mutate(f.receipt);f.setReceipt(f.receipt);assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_INVENTORY_STALE'});assert.equal(f.opened(),3);allClosed(f);}
  const f=declarationFixture();f.put(f.sourcePath,buildPck(['project.binary','different.tscn']));assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_INVENTORY_STALE'});allClosed(f);
});
test('declaration and receipt have independent small-document limits before their handles are opened',()=>{
  for(const [field,size,opened]of [['declarationFile',MiB+1,0],['receiptFile',2*MiB+1,1]]){
    const f=declarationFixture();f.record(f[field]).stat.size=size;assert.throws(()=>f.read(),{code:'LOCAL_RESOURCE_FILE_LIMIT'});assert.equal(f.opened(),opened);allClosed(f);
  }
});
