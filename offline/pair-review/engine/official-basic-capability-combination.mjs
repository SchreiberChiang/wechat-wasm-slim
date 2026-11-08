// SOURCE ONLY. Fixed source maps are supplied by the caller; no fetch, writes,
// compiler, library evaluation or runtime initialization is performed here.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {officialWebSocketCombinationInputs,auditOfficialWebSocketCombination} from './official-websocket-combination-audit.mjs';
import {prepareOfficialAudioStartContract} from './official-audio-start-contract.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const pin=b=>({bytes:Buffer.byteLength(b),sha256:createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path);
const read=p=>{const b=fs.readFileSync(new URL('../'+p.path,import.meta.url));same(b,p);return b;};
const sc='platform/web/SCsub',cpp='core/crypto/crypto_core.cpp',core='core/crypto/SCsub';
const upstreamBlock='# Fixed upstream WXMEMFS is generated and hash-checked before linking.\nif env["use_wx_glx"]:\n    sys_env.AddJSLibraries(["js/libs/library_wxslim_upstream_fs.js"])';
const retiredBlock='# Owned persistent factory is generated and hash-checked before linking.\nif env["use_wx_glx"]:\n    sys_env.AddJSLibraries(["js/libs/library_wxslim_persistent.js"])';
const randomTail='\n# Owned synchronous entropy bridge; browser builds keep their original crypto path.\nif env["use_wx_glx"]:\n    sys_env.AddJSPre(["js/libs/library_godot_crypto.js"])\n    sys_env.AddJSLibraries(["js/libs/library_godot_wechat_entropy.js"])\n';
// Separate, explicit post-patch transform. The old random patch remains intact.
export function relocateSecureRandomSelection(source){
 assert.equal(typeof source,'string');
 assert(source.endsWith(randomTail),'RANDOM_SELECTION_MUST_BE_EXACT_EOF_BLOCK');
 const block=randomTail.slice(1),anchor='for lib in sys_env["JS_LIBS"]:\n';
 assert.equal(source.split(block).length,2,'RANDOM_SELECTION_UNIQUE_BLOCK');
 assert.equal(source.split(anchor).length,2,'RANDOM_SELECTION_UNIQUE_CONSUMER');
 const base=source.slice(0,-randomTail.length);
 const moved=base.replace(anchor,()=>block+'\n'+anchor);
 assert(moved.indexOf(block)<moved.indexOf(anchor),'RANDOM_SELECTION_BEFORE_CONSUMPTION');
 assert.equal(moved.split(block).length,2);
 assert.equal(moved.replace(block+'\n','')+randomTail,source,'RANDOM_SELECTION_REVERSE_EXACT');
 return {source:moved,receipt:{kind:'EXPLICIT_POST_PATCH_SCSUB_BLOCK_RELOCATION',before:pin(source),after:pin(moved),
  block:pin(block),beforeLine:source.slice(0,source.indexOf(block)).split('\n').length,
  afterLine:moved.slice(0,moved.indexOf(block)).split('\n').length,
  consumerLine:moved.slice(0,moved.indexOf(anchor)).split('\n').length,
  identicalBlock:true,otherBytesUnchanged:true,reverseExact:true}};
}
function owned(){
 const m=JSON.parse(fs.readFileSync(new URL('./official-basic-capability-combination.json',import.meta.url)));
 assert.equal(m.baseCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
 for(const p of m.dependencies)read(p);
 const random=JSON.parse(read(m.dependencies.find(p=>p.path==='engine/official-secure-random-source.json')));
 const audio=JSON.parse(read(m.dependencies.find(p=>p.path==='engine/official-audio-start-contract.json')));
 const base=officialWebSocketCombinationInputs();assert.equal(base.baseCommit,m.baseCommit);
 const extra=random.officialInputs.filter(p=>[cpp,core].includes(p.path));
 assert.deepEqual(extra.map(p=>p.path),[cpp,core]);
 const inputs=[...base.inputs,...extra];assert.equal(inputs.length,25);assert.equal(new Set(inputs.map(p=>p.path)).size,25);
 return {m,random,audio,base,inputs};
}
export function officialBasicCapabilityInputs(){const p=owned();return {baseCommit:p.m.baseCommit,inputs:p.inputs,upstream:p.base.upstream,status:'NOT_BUILD_READY'};}
export function auditOfficialBasicCapabilityCombination(sources,options){
 assert.equal(arguments.length,2,'BASIC_EXACT_ARGUMENTS');
 assert(options&&typeof options==='object');assert.deepEqual(Reflect.ownKeys(options),['sourceBytes']);
 assert(Buffer.isBuffer(options.sourceBytes));assert(sources instanceof Map);
 const {m,random,audio,base,inputs}=owned();
 assert.deepEqual([...sources.keys()].sort(),inputs.map(p=>p.path).sort(),'BASIC_EXACT_25_INPUTS');
 for(const p of inputs){assert(Buffer.isBuffer(sources.get(p.path)));same(sources.get(p.path),p);}
 const previous=auditOfficialWebSocketCombination(new Map(base.inputs.map(p=>[p.path,sources.get(p.path)])),options);
 assert.equal(previous.outputs.size,28);assert.equal(previous.receipt.totalPatchCount,18);
 const outputs=new Map([...previous.outputs].map(([p,v])=>[p,{...v}]));
 assert(!outputs.has(cpp)&&!outputs.has(core),'CRYPTO_NOT_PREVIOUSLY_MODIFIED');
 const scParent=outputs.get(sc).text;same(scParent,m.scsubParent);
 const parts=read(random.patch).toString().split(/(?=^diff --git )/m).filter(Boolean);
 assert.equal(parts.length,5,'RANDOM_EXACT_FIVE_PATCH_SECTIONS');
 const touched=[];
 const replayRandomPart=(part,reader)=>{
  // An EOF append patch alone can match again at its old context. Authenticate
  // its parent before replay, rather than assuming the patch parser rejects it.
  const header=/^diff --git a\/([^\n ]+) b\/([^\n ]+)\n/.exec(part);
  assert(header&&header[1]===header[2],'RANDOM_SECTION_HEADER');
  const name=header[1],parent=name===sc?m.scsubParent:random.inputs.find(p=>p.path===name);
  if(parent)same(reader(name),parent);
  else assert.equal(reader(name),null,'RANDOM_NEW_PATH_MUST_BE_ABSENT');
  return replayUnifiedPatch(Buffer.from(part),reader);
 };
 for(const part of parts){
  const parsed=replayRandomPart(part,p=>outputs.get(p)?.text??sources.get(p)??null);
  assert.equal(parsed.size,1);const [name,result]=[...parsed][0];touched.push(name);
  const expected=random.outputs.find(p=>p.path===name);assert(expected,'RANDOM_UNEXPECTED_PATH');
  assert.equal(result.added,expected.added);
  if(name===sc){
   // Rebase only the append hunk. It must preserve every byte of the storage
   // predecessor, then project back to the fixed historical random output.
   const originalParent=random.inputs.find(p=>p.path===sc);
   assert.equal(scParent.split(upstreamBlock).length,2,'ONE_UPSTREAM_SELECTION');
   same(scParent.replace(upstreamBlock,retiredBlock),originalParent);
   assert(result.text.startsWith(scParent),'SCSUB_REBASE_MUST_BE_APPEND_ONLY');
   same(result.text.replace(upstreamBlock,retiredBlock),expected);
   assert.equal(result.text.length-scParent.length,expected.bytes-originalParent.bytes);
  }else{
   const parent=random.inputs.find(p=>p.path===name);
   if(parent)same(outputs.get(name)?.text??sources.get(name),parent);
   else assert(!outputs.has(name)&&!sources.has(name),'RANDOM_NEW_PATH_EXISTS');
   same(result.text,expected);
  }
  assert.throws(()=>replayRandomPart(part,p=>p===name?result.text:outputs.get(p)?.text??sources.get(p)??null),'RANDOM_DUPLICATE_REJECT');
  outputs.set(name,result);
 }
 assert.deepEqual(touched.sort(),random.outputs.map(p=>p.path).sort());
 const relocated=relocateSecureRandomSelection(outputs.get(sc).text);
 assert.throws(()=>relocateSecureRandomSelection(relocated.source),'RELOCATION_REPEAT_REJECT');
 outputs.set(sc,{...outputs.get(sc),text:relocated.source});
 const ap=audio.inputs[0].path;assert(outputs.has(ap));same(outputs.get(ap).text,audio.inputs[0]);
 const prepared=prepareOfficialAudioStartContract(Buffer.from(outputs.get(ap).text));
 assert.equal(audio.patch.file,'engine/official-audio-start-contract.patch','AUDIO_FIXED_PATCH_PATH');
 const aPatch=read({...audio.patch,path:audio.patch.file}),aReplay=replayUnifiedPatch(aPatch,p=>outputs.get(p)?.text??null);
 assert.deepEqual([...aReplay.keys()],[ap]);assert.equal(aReplay.get(ap).text,prepared.source.toString());
 same(prepared.source,audio.outputs[0]);
 assert.throws(()=>prepareOfficialAudioStartContract(prepared.source),'AUDIO_REPEAT_REJECT');
 assert.throws(()=>replayUnifiedPatch(aPatch,p=>p===ap?prepared.source:null),'AUDIO_DUPLICATE_REJECT');
 outputs.set(ap,aReplay.get(ap));
 // The crypto SCsub is a pinned read-only selection reference, NOT an output.
 assert(!outputs.has(core));assert.equal(outputs.size,previous.outputs.size+3,'ONLY_CPP_AND_TWO_NEW_JS_ADDED');
 assert.equal(outputs.size,31);
 const changed=new Set([...touched,ap]);
 for(const [p,v]of previous.outputs)if(!changed.has(p))assert.equal(outputs.get(p).text,v.text,'UNRELATED_OUTPUT_CHANGED '+p);
 const expectedNames=new Set([...previous.outputs.keys(),cpp,...random.outputs.filter(p=>p.added).map(p=>p.path)]);
 assert.deepEqual([...outputs.keys()].sort(),[...expectedNames].sort());
 assert(!outputs.has('platform/web/js/libs/library_wxslim_persistent.js'),'RETIRED_FACTORY_MUST_STAY_RETIRED');
 const syntax=[];for(const [p,v]of outputs)if(p.endsWith('.js')||p.endsWith('.cjs')){new vm.Script(v.text,{filename:p});syntax.push(p);}
 return {outputs,receipt:{schema:'wxslim-official-basic-capability-combination-v1',status:'PASS_SOURCE_ONLY_NOT_BUILD_READY',baseCommit:m.baseCommit,
  officialInputs:inputs,inputFiles:25,totalPatchCount:20,predecessor:previous.receipt,dependencies:m.dependencies,
  random:{patch:random.patch,parents:random.inputs,outputs:random.outputs,abi:random.abi,scsubRebasedParent:m.scsubParent,
   scsubActualOutput:{path:sc,...pin(outputs.get(sc).text)},historicalScsubOutputVerifiedByExactReverseProjection:true,
   postPatchRelocation:relocated.receipt},
  audio:{patch:audio.patch,parents:audio.inputs,outputs:audio.outputs,preparation:prepared.receipt},
  finalOutputs:[...outputs].map(([p,v])=>({path:p,...pin(v.text),added:v.added})),outputFiles:31,
  readOnlyReference:inputs.find(p=>p.path===core),syntaxChecked:syntax,
  exportsAdded:random.exportsAdded,buildParametersAdded:[],hostIntegrated:false,buildPlanRegistered:false,
  sourceTreeWritten:false,compilerRun:false,engineRun:false,wasmInstantiated:false,networkRun:false,phone:'NOT_RUN',runtimeAcceptance:'NOT_INHERITED',
  remaining:['Host prepare/mode/take/health and C shutdown integration are not installed.','Freeze a separate official build recipe; actual mbedTLS compilation/imports/exports and emitted pair remain unverified.','Source replay and prior audio JS models are not target runtime acceptance.']}};
}
