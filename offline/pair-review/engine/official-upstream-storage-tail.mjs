// Source preparation only. No source-tree mutation, SCons or target execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
import {replayUpstreamWxmemfsRead} from './upstream-wxmemfs-read-contract.mjs';

const home=fileURLToPath(new URL('../',import.meta.url));
const sc='platform/web/SCsub',os='platform/web/js/libs/library_wxslim_os.js';
const backend='platform/web/js/libs/library_wxslim_upstream_fs.js';
const read=p=>fs.readFileSync(path.join(home,p));
const meta=()=>JSON.parse(read('engine/official-upstream-storage-tail.json'));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path??'source pin');
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'TAIL_UNIQUE_ANCHOR');return s.replace(a,()=>b);};
const feature="\t\tif (ftr === 'wechat' || ftr === 'minigame' || ftr === 'wxgame') {\n\t\t\treturn (typeof wx !== 'undefined') ? 1 : 0;\n\t\t}\n";

// The entire reviewed body is inside a runtime factory, never evaluated by the
// Emscripten library loader. Its own var WXMEMFS and var GODOTSDK stay local.
export function renderOfficialUpstreamFs({sourceBytes}) {
  assert(Buffer.isBuffer(sourceBytes),'TAIL_UPSTREAM_BUFFER');
  const m=meta();same(sourceBytes,m.upstream.source);
  const patches=m.upstream.patches.map(p=>{const b=read(p.path);same(b,p);return b;});
  const license=read(m.upstream.license.path);same(license,m.upstream.license);
  const prepared=replayUpstreamWxmemfsRead({sourceBytes,patchBytes:patches[0],readPatchBytes:patches[1]});
  same(prepared.source,m.upstream.derived);
  const source='/* Derived from godothub/godot-minigame '+m.upstream.commit+'\n'+license.toString()+'*/\n'+
    'mergeInto(LibraryManager.library, {\n'+
    '  $WXSLIMUpstreamCreate__deps: [\'$FS\'],\n'+
    '  $WXSLIMUpstreamCreate: function () {\n'+prepared.source+'\nreturn WXMEMFS;\n  },\n'+
    '  $WXMEMFS__deps: [\'$WXSLIMUpstreamCreate\'],\n'+
    '  $WXMEMFS__postset: \'WXMEMFS = WXSLIMUpstreamCreate();\',\n'+
    '  $WXMEMFS: {},\n});\n';
  new vm.Script(source,{filename:backend}); // Parse, do not run the library.
  const start=source.indexOf(prepared.source);
  assert(start>0&&source.indexOf(prepared.source,start+1)===-1,'TAIL_COMPLETE_BODY_ONCE');
  return {source,body:prepared.source,receipt:prepared.receipt,bodyPin:pin(prepared.source)};
}

export function prepareOfficialUpstreamStorageTail({parents,officialOs,sourceBytes}) {
  const m=meta();assert(parents instanceof Map,'TAIL_PARENT_MAP');
  assert.deepEqual([...parents.keys()].sort(),[sc,os].sort(),'TAIL_EXACT_TWO_PARENTS');
  for(const p of m.parents)same(parents.get(p.path),p);
  assert(Buffer.isBuffer(officialOs),'TAIL_OFFICIAL_OS_BUFFER');same(officialOs,m.officialOs);
  const library=renderOfficialUpstreamFs({sourceBytes});same(library.source,m.generatedLibrary);
  const patch=read(m.patch.path);same(patch,m.patch);
  const outputs=replayUnifiedPatch(patch,p=>parents.get(p)??null);
  assert.deepEqual([...outputs.keys()].sort(),[sc,os].sort(),'TAIL_PATCH_SCOPE');
  const beforeSc=parents.get(sc).toString(),afterSc=outputs.get(sc).text;
  assert.equal(afterSc,once(beforeSc,'# Owned persistent factory is generated and hash-checked before linking.\n',
    '# Fixed upstream WXMEMFS is generated and hash-checked before linking.\n')
    .replace('sys_env.AddJSLibraries(["js/libs/library_wxslim_persistent.js"])','sys_env.AddJSLibraries(["js/libs/library_wxslim_upstream_fs.js"])'),'TAIL_ONLY_LIBRARY_SELECTION');
  assert(!afterSc.includes('library_wxslim_persistent.js'));
  const original=officialOs.toString();
  let expected=once(original,'\t\tconst ua = navigator.userAgent;',feature+'\t\tconst ua = navigator.userAgent;');
  expected=once(expected,"$GodotFS__deps: ['$FS', '$IDBFS', '$GodotRuntime']","$GodotFS__deps: ['$FS', '$IDBFS', '$GodotRuntime', '$WXMEMFS']");
  expected=once(expected,"\t\t'Module[\"copyToFS\"] = GodotFS.copy_to_fs;',",
    "\t\t'Module[\"copyToFS\"] = GodotFS.copy_to_fs;',\n\t\t'Module[\"__WXSLIM_UPSTREAM_WXMEMFS__\"] = \""+m.upstream.derived.sha256+"\";',");
  expected=once(expected,'FS.mount(IDBFS, {}, path);','FS.mount(WXMEMFS, {}, path);');
  assert.equal(outputs.get(os).text,expected,'TAIL_OS_ONLY_FEATURE_DEPS_MARKER_MOUNT');
  for(const token of ['WXSLIMPersistentCreate','init_persistent','verify_persistent','persistent_status','_wxslim_session'])assert(!expected.includes(token),'TAIL_CUSTOM_REMAINS');
  new vm.Script(expected,{filename:os});
  outputs.set(backend,{text:library.source,added:true});
  for(const p of m.outputs)same(outputs.get(p.path)?.text,p);
  assert.throws(()=>replayUnifiedPatch(patch,p=>outputs.get(p)?.text??parents.get(p)??null));
  return {outputs,library,receipt:{schema:'wxslim-official-upstream-storage-tail-v1',status:'PASS_SOURCE_PREPARATION_ONLY',
    baseCommit:m.baseCommit,parents:m.parents,patch:m.patch,outputs:m.outputs,upstream:m.upstream,
    retired:m.retired,oldCustomApiRemoved:true,fullBackendBodyUnchanged:true,
    browserSelection:'Original library_godot_os.js and IDBFS remain selected when use_wx_glx=false',
    initialization:'Existing host explicitly calls initFS([/userfs]); GodotFS creates mount directories and mounts WXMEMFS before main',
    persistentFlag:'Existing GodotFS _idbfs name now records successful mount/sync; it is not durability evidence',
    sourceTreeWritten:false,buildPlanRegistered:false,compiled:false,engineRun:false,phone:'NOT_RUN',runtimeAcceptance:'NOT_INHERITED',
    remaining:m.remaining}};
}

export function readExplicitUpstreamSource(file) {
  assert(typeof file==='string'&&path.isAbsolute(file),'TAIL_EXPLICIT_SOURCE_PATH');
  const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'TAIL_REGULAR_SOURCE');
  const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  assert.equal(norm(fs.realpathSync(file)),norm(file),'TAIL_REAL_SOURCE');return fs.readFileSync(file);
}
