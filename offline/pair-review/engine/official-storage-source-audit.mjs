// Read-only official source replay. No checkout writes, SDK invocation or package admission.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
import {renderPersistentLibrary} from './persistent-factory-source.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const metaFile=new URL('./official-storage-source.json',import.meta.url);
const metadata=()=>JSON.parse(fs.readFileSync(metaFile,'utf8'));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(bytes,expected,label)=>assert.deepEqual(pin(bytes),{bytes:expected.bytes,sha256:expected.sha256},label);
const read=record=>{const b=fs.readFileSync(path.join(repo,record.path));same(b,record,record.path);return b};
const osPath='platform/web/js/libs/library_godot_os.js',scPath='platform/web/SCsub',newPath='platform/web/js/libs/library_wxslim_os.js';

export function officialStorageInputPlan(){return metadata().inputs;}

export async function fetchOfficialStorageInputs(){
  const m=metadata(),sources=new Map();
  for(const p of m.inputs){
    const url='https://raw.githubusercontent.com/godotengine/godot/'+m.baseCommit+'/'+p.path;
    const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok,'SOURCE_HTTP');
    const chunks=[];let size=0;
    for await(const b of r.body){size+=b.length;assert(size<=p.bytes,'SOURCE_SIZE_LIMIT');chunks.push(b);}
    const b=Buffer.concat(chunks);same(b,p,p.path);sources.set(p.path,b);
  }
  const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+m.baseCommit+'/'+newPath,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,404,'NEW_PATH_EXISTS');
  return sources;
}

export function prepareOfficialStorageSources(sources){
  assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');
  const m=metadata();
  assert.equal(m.baseCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
  assert.deepEqual([...sources.keys()].sort(),m.inputs.map(p=>p.path).sort(),'SOURCE_KEYS');
  for(const p of m.inputs)same(sources.get(p.path),p,p.path);
  const state=replayUnifiedPatch(read(m.prerequisite),p=>sources.get(p)??null);
  same(state.get(scPath).text,m.prerequisite.output,'CONTEXT_SCSUB');
  const beforeSc=state.get(scPath).text;
  const patch=read(m.patch);
  replayUnifiedPatch(patch,p=>sources.get(p)??null,state);
  for(const p of m.outputs)same(state.get(p.path).text,p,p.path);
  assert(!state.has(osPath),'OFFICIAL_BROWSER_OS_MUST_STAY_UNCHANGED');
  assert.throws(()=>replayUnifiedPatch(patch,p=>state.get(p)?.text??sources.get(p)??null));
  const init=read(m.ownedInit).toString();
  const osInit=init.split('diff --git a/platform/web/SCsub')[0];
  const oldSemantics=replayUnifiedPatch(Buffer.from(osInit),p=>{assert.equal(p,osPath);return sources.get(p)}).get(osPath).text;
  const source=state.get(newPath).text;
  const tag="\t\tif (ftr === 'wechat' || ftr === 'minigame' || ftr === 'wxgame') {\n\t\t\treturn (typeof wx !== 'undefined') ? 1 : 0;\n\t\t}\n";
  assert.equal(source.split(tag).length,2,'EXACT_FEATURE_TAG');
  assert(source.replace(tag,'')===oldSemantics,'PERSISTENT_INIT_REBASE_EQUIVALENCE');
  const abi=text=>[...text.matchAll(/\b(godot_js_\w+__sig):\s*(['"])([^'"]+)\2/g)].map(m=>[m[1],m[3]]);
  assert.deepEqual(abi(source),abi(sources.get(osPath).toString()),'OS_ABI_CHANGED');
  assert.equal(abi(source).length,14);
  new vm.Script(source);
  const expectedHashes=Object.fromEntries(m.generatedFactory.inputs.map(p=>[p.path,p.sha256]));
  const library=renderPersistentLibrary({expectedHashes});
  same(library.source,m.generatedFactory,'GENERATED_FACTORY');
  assert.deepEqual(library.inputs,m.generatedFactory.inputs);assert.deepEqual(library.constants,m.generatedFactory.constants);
  assert(!state.get(scPath).text.includes('library_godot_fs.js'),'LEGACY_FS_SHIM_SELECTED');
  const receipt={schema:'wxslim-official-storage-audit-v1',status:'PASS_SOURCE_REBASE_ONLY',baseCommit:m.baseCommit,
    inputs:m.inputs,prerequisite:m.prerequisite,patch:m.patch,outputs:m.outputs,
    originalBrowserOsUnchanged:true,existingPersistentLogicUnchanged:true,osSignatureCount:14,
    generatedFactory:m.generatedFactory,missingDirectoryClassification:'PRESERVED_UNRESOLVED',
    fileAccessCppGate:'REQUIRED_SEPARATE_REBASE_AND_COMPILED_BRANCH_AUDIT',
    sourceTreeWritten:false,sconsExecuted:false,compiled:false,runtime:false,storageAccepted:false};
  return {receipt,source,officialSource:sources.get(osPath).toString(),scsubBefore:beforeSc,scsubSource:state.get(scPath).text,library};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);let sources;
  if(args.length===1&&args[0]==='--fetch-fixed-two')sources=await fetchOfficialStorageInputs();
  else if(args.length===2&&args[0]==='--source-root'){
    const root=fs.realpathSync(args[1]);assert(!fs.existsSync(path.join(root,newPath)),'NEW_PATH_EXISTS');sources=new Map();
    for(const p of officialStorageInputPlan()){const file=fs.realpathSync(path.join(root,p.path));assert(file.startsWith(root+path.sep),'SOURCE_OUTSIDE_ROOT');sources.set(p.path,fs.readFileSync(file));}
  }else throw Error('Usage: --fetch-fixed-two OR --source-root <fixed-official-source>');
  console.log(JSON.stringify(prepareOfficialStorageSources(sources).receipt,null,2));
}
