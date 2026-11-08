// Source-only follow-up to the fixed WXMEMFS correctness patch.
// Replays in memory; never mutates a checkout, evaluates the backend or calls wx.
// Upstream GodotHub/MIT attribution and license remain in the original receipt.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
import {replayUpstreamWxmemfs,upstreamWxmemfsPins} from './upstream-wxmemfs-correctness.mjs';

const target='platform/web/js/libs/library_godot_memfs.js';
const pin=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
export const upstreamWxmemfsReadPins=Object.freeze({
  base:upstreamWxmemfsPins.derived,
  patch:Object.freeze({bytes:8556,sha256:'404c69d1c60fcb559b6dbc0c731a6b5d1b3f92762c3efdfbbf2e230fa79b259b'}),
  derived:Object.freeze({bytes:33705,sha256:'8a60f258503496d554a20b68d62a0abfbbc87064e59c5912a8ad41d5346c16cf'}),
});
function readRegular(file) {
  assert(typeof file==='string'&&path.isAbsolute(file),'WXMEMFS_READ_EXPLICIT_ABSOLUTE_FILE');
  const stat=fs.lstatSync(file);
  assert(stat.isFile()&&!stat.isSymbolicLink(),'WXMEMFS_READ_REGULAR_FILE');
  assert.equal(fs.realpathSync(file).toLowerCase(),path.resolve(file).toLowerCase(),'WXMEMFS_READ_REAL_PATH');
  return fs.readFileSync(file);
}
function parser() {
  const own={exports:{}};
  vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:own,exports:own.exports});
  return own.exports;
}
function methods(source,parse) {
  const ast=parse(source,{ecmaVersion:2022}),found=[];
  function walk(node) {
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&node.id.name==='WXMEMFS')found.push(node);
    for(const value of Object.values(node)) {
      if(Array.isArray(value))value.forEach(walk);
      else if(value&&typeof value==='object')walk(value);
    }
  }
  walk(ast);assert.equal(found.length,1,'WXMEMFS_READ_UNIQUE_OBJECT');
  const object=found[0].init;assert.equal(object.type,'ObjectExpression');
  const select=(obj,name)=>{
    assert.equal(obj.type,'ObjectExpression');
    const values=obj.properties.filter(p=>!p.computed&&(p.key.name??p.key.value)===name);
    assert.equal(values.length,1,'WXMEMFS_READ_UNIQUE_METHOD_'+name);return values[0].value;
  };
  return [[null,'loadNode'],['stream_ops','open']].map(([parent,name])=>{
    const fn=select(parent?select(object,parent):object,name);
    assert.equal(fn.type,'FunctionExpression');
    return {name:parent?parent+'.'+name:name,start:fn.start,end:fn.end};
  }).sort((a,b)=>a.start-b.start);
}
function mask(source,ranges) {
  let result='',offset=0;
  for(const r of ranges){result+=source.slice(offset,r.start)+'/* READ_CONTRACT:'+r.name+' */';offset=r.end;}
  return result+source.slice(offset);
}
export function replayUpstreamWxmemfsRead({sourceBytes,patchBytes,readPatchBytes}={}) {
  const parent=replayUpstreamWxmemfs({sourceBytes,patchBytes});
  assert(Buffer.isBuffer(readPatchBytes),'WXMEMFS_READ_PATCH_BUFFER');
  assert.deepEqual(pin(readPatchBytes),upstreamWxmemfsReadPins.patch,'WXMEMFS_READ_PATCH_PIN');
  const base=Buffer.from(parent.source);
  assert.deepEqual(pin(base),upstreamWxmemfsReadPins.base,'WXMEMFS_READ_PARENT_PIN');
  const files=replayUnifiedPatch(readPatchBytes,name=>{assert.equal(name,target,'WXMEMFS_READ_PATCH_TARGET');return base;});
  assert.deepEqual([...files.keys()],[target]);
  const source=files.get(target).text,derived=Buffer.from(source);
  assert.deepEqual(pin(derived),upstreamWxmemfsReadPins.derived,'WXMEMFS_READ_DERIVED_PIN');
  const parse=parser().parse,before=methods(parent.source,parse),after=methods(source,parse);
  assert.deepEqual(before.map(r=>r.name),after.map(r=>r.name));
  assert.equal(mask(parent.source,before),mask(source,after),'WXMEMFS_READ_OUTSIDE_TWO_METHODS_CHANGED');
  new vm.Script(source,{filename:'upstream-wxmemfs-read-contract-source.js'}); // Parse only.
  return {source,receipt:{
    schema:'upstream-wxmemfs-read-contract-source-v1',status:'SOURCE_ONLY_UNAPPLIED',
    upstream:parent.receipt.upstream,target,
    input:parent.receipt.base,parentPatch:parent.receipt.patch,base:pin(base),
    patch:{path:'engine/upstream-wxmemfs-read-contract.patch',...pin(readPatchBytes)},derived:pin(derived),
    order:['fixed upstream readable source','upstream-wxmemfs-correctness.patch','upstream-wxmemfs-read-contract.patch'],
    replay:'exact unified context/locations, no fuzz; AST comparison outside loadNode and stream_ops.open',
    changedMethods:after.map(({name,start,end})=>({name,startUTF16:start,endUTF16:end})),unchangedOutsideMethods:true,
    behavior:[
      'An uncached native file load first requires successful statSync(path,false), actual file metadata and a nonnegative safe integer size.',
      'Size zero initializes an empty node without native readFileSync; this is metadata evidence, not a readback or durability claim.',
      'Nonempty native reads require an actual ArrayBuffer with exactly the observed size; all exceptions/mismatches become EIO=29 with original cause.',
      'Failed reads do not mark the node loaded or turn it into an empty file; later explicit open may retry.',
      'Failed backend open unwinds only its own SDK stream slot and WX record; native WeakMap reference commit is last and is never inferred from a shared count.',
      'Cleanup errors remain attached to the primary failure; optional logging cannot turn a successful open into failure.',
    ],
    sideEffects:['one added native statSync per uncached load; no polling or automatic retry','failed opens can consume a WX counter value, which is not reused'],
    sdk:{version:'4.0.10',open:'src/lib/libfs.js:1154-1170 registers before backend.open, without rollback',
      closeStream:'src/lib/libfs.js:479-481 only clears the matching SDK FD slot',errno:29},
    scope:'No change to mount/path mapping/scanning/mknod/close/rename, existing cached or truncated contents, rendering or WASM.',
    notProven:[
      'Godot/libc/WASM error propagation and actual WeChat stat/read behavior',
      'runtime pairing, restarted process persistence, atomicity or durability',
      'concurrent native writers may change same-sized data; stat and read are not atomic',
      'SDK create/truncate side effects before backend.open are not rolled back',
      'unchanged mknod/native-create failure handling and other existing upstream paths',
      'assumes standard native WeakMap prototype methods; arbitrary global intrinsic replacement is outside this contract',
    ],
    productionSourceMutated:false,buildRun:false,targetCodeExecutedByPreparer:false,platformApiCalled:false,
  }};
}
export function prepareUpstreamWxmemfsRead({sourcePath,
  patchPath=fileURLToPath(new URL('./upstream-wxmemfs-correctness.patch',import.meta.url)),
  readPatchPath=fileURLToPath(new URL('./upstream-wxmemfs-read-contract.patch',import.meta.url))}={}) {
  return replayUpstreamWxmemfsRead({sourceBytes:readRegular(sourcePath),patchBytes:readRegular(patchPath),readPatchBytes:readRegular(readPatchPath)});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    assert.equal(process.argv.length,3,'Usage: node upstream-wxmemfs-read-contract.mjs ABSOLUTE_EXISTING_READABLE_SOURCE');
    console.log(JSON.stringify(prepareUpstreamWxmemfsRead({sourcePath:process.argv[2]}).receipt,null,2));
  } catch(_) {console.error(JSON.stringify({status:'REJECTED_SOURCE_ONLY',code:'WXMEMFS_READ_PREPARATION_REJECTED'}));process.exitCode=1;}
}
