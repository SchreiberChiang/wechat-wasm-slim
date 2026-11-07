// Offline only: actual pinned JS functions, modeled wx/heap/callback ordering.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

export const identity = data => ({bytes:Buffer.byteLength(data),sha256:createHash('sha256').update(data).digest('hex')});
const pins = {
  'library_godot_fetch.js':{bytes:9159,sha256:'06740803e8cff87a074e9b09d492c224e969bdefe11094bf19dbe647812553b5'},
  'library_godot_os.js':{bytes:15059,sha256:'79025fde693a2310a61c58fcca8e657bc04c6fa5eda589d0aafc8d18ee081acf'},
};
function parser() {
  const require=createRequire(import.meta.url);
  try { return require('acorn'); } catch(e) { if(e.code!=='MODULE_NOT_FOUND')throw e; }
  const source=process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
  assert.equal(typeof source,'string','Existing Acorn required; no dependency installation');
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports},{timeout:1000});
  return module.exports;
}
function extract(source,name,acorn) {
  const ast=acorn.parse(source,{ecmaVersion:2022}), matches=[];
  for(const statement of ast.body)for(const d of statement.declarations||[])
    if(d.id.type==='Identifier'&&d.id.name===name)matches.push(d.init);
  assert.equal(matches.length,1,'Unique actual declaration: '+name);
  const node=matches[0];assert.equal(node.type,'ObjectExpression');
  const code=source.slice(node.start,node.end);
  return {code,metadata:{name,start:node.start,end:node.end,...identity(code)}};
}
export function loadFixedSource(root=process.env.WXSLIM_FIXED_HTTP_FIXTURES || process.env.WXSLIM_FIXED_ENGINE_SOURCE) {
  if(!root)return {skip:'WXSLIM_FIXED_ENGINE_SOURCE is not set; fixed source not evaluated'};
  assert(typeof root==='string'&&path.isAbsolute(root),'Explicit absolute fixed engine source required');
  const acorn=parser(),loaded={},texts={},sources=[];
  for(const [name,pin] of Object.entries(pins)) {
    const file=path.join(root,'platform/web/js/libs',name);
    if(!fs.existsSync(file))return {skip:'Explicit fixed engine source missing: '+name};
    const bytes=fs.readFileSync(file),actual=identity(bytes);
    assert.deepEqual(actual,pin,'Fixed source drift: '+name);
    const item=extract(bytes.toString('utf8'),name==='library_godot_fetch.js'?'GodotFetch':'IDHandler',acorn);
    loaded[name]=item.code;texts[name]=bytes.toString('utf8');sources.push({name,...actual,extraction:item.metadata});
  }
  const host=fs.readFileSync(new URL('../convert/assets/wx-compat.js',import.meta.url),'utf8');
  return {loaded,texts,host,sources,hostIdentity:identity(host),parserVersion:acorn.version};
}
export function withFetchModelSource(source,text) {
  const acorn=parser(),item=extract(text,'GodotFetch',acorn);
  return {...source,loaded:{...source.loaded,'library_godot_fetch.js':item.code},
    changedFetch:{...identity(text),extraction:item.metadata}};
}
export function fetchLibraryProperties(text) {
  const acorn=parser(),item=extract(text,'GodotFetch',acorn);
  const obj=acorn.parse('('+item.code+')',{ecmaVersion:2022}).body[0].expression;
  return Array.from(obj.properties,p=>({name:p.key.name??p.key.value,code:('('+item.code+')').slice(p.value.start,p.value.end)}));
}
export function createFetchModel(source,{host=false,missingChunk=false,missingHeaders=false,abortThrows=false,listenerThrows=false,requestHook=null,abortHook=null,loggerThrows=false}={}) {
  const requests=[],errors=[],hostLogs=[],allocations=[],frees=[],heap=new Int8Array(65536);
  const wx={request(options) {
    const entry={options,headers:null,chunk:null,aborts:0,headerRegistrations:0,chunkRegistrations:0};
    const task={abort(){entry.aborts++;if(abortHook)abortHook(entry);if(abortThrows)throw Error('MODEL_ABORT_THROW');}};
    if(!missingHeaders)task.onHeadersReceived=cb=>{entry.headerRegistrations++;if(listenerThrows)throw Error('MODEL_LISTENER_THROW');entry.headers=cb;};
    if(!missingChunk)task.onChunkReceived=cb=>{entry.chunkRegistrations++;if(listenerThrows)throw Error('MODEL_LISTENER_THROW');entry.chunk=cb;};
    entry.task=task;requests.push(entry);if(requestHook)requestHook(entry);return task;
  }};
  const runtime={error:e=>{errors.push(e);if(loggerThrows)throw Error('MODEL_LOGGER_THROW');},heapCopy:(_heap,bytes,offset)=>heap.set(bytes,offset),
    heapSlice:(h,start,size)=>h.slice(start,start+size),parseString:x=>x,parseStringArray:x=>x,
    get_func:x=>x,allocStringArray:x=>{allocations.push(x);return x;},freeStringArray(p,n){frees.push({p,n});}};
  const context=vm.createContext({wx,HEAP8:heap,GodotRuntime:runtime,ArrayBuffer,Uint8Array,Int8Array,
    TextEncoder,TextDecoder,console:{log:x=>hostLogs.push(x)},Blob:function(){},WebSocket:function(){}});
  vm.runInContext('var IDHandler=('+source.loaded['library_godot_os.js']+').$IDHandler;\n'+
    'var FetchLibrary=('+source.loaded['library_godot_fetch.js']+');var GodotFetch=FetchLibrary.$GodotFetch;',context,{timeout:1000});
  if(host)vm.runInContext(source.host,context,{timeout:1000,filename:'actual-wx-compat.js'});
  return {fetch:context.GodotFetch,api:context.FetchLibrary,ids:context.IDHandler,requests,errors,hostLogs,heap,runtime,allocations,frees,
    create(body=null,method='GET'){return context.GodotFetch.create(method,'https://model.invalid/offline',{},body);},
    headers(index,res){requests[index].headers?.(res);},
    // The model respects the selected option. This is not a real platform schedule.
    chunk(index,data){const r=requests[index];if(r.options.enableChunked)r.chunk?.({data});},
    success(index,res){requests[index].options.success(res);},fail(index,error){requests[index].options.fail(error);},
    read(id,size=65536){const count=context.FetchLibrary.godot_js_fetch_read_chunk(id,0,size);return Array.from(heap.subarray(0,count),x=>x&255);}};
}
