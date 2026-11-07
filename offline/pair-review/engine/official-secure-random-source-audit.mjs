// Fixed-source GET / pure memory replay only. Never invokes SCons or target code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cpp='core/crypto/crypto_core.cpp',core='core/crypto/SCsub',sc='platform/web/SCsub',detect='platform/web/detect.py';
const pre='platform/web/js/libs/library_godot_crypto.js',entropy='platform/web/js/libs/library_godot_wechat_entropy.js';
const metadata=()=>JSON.parse(fs.readFileSync(new URL('./official-secure-random-source.json',import.meta.url)));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path);
const read=p=>{const b=fs.readFileSync(path.join(root,p.path));same(b,p);return b};
export function officialSecureRandomInputPlan(){return metadata().officialInputs;}
export async function fetchOfficialSecureRandomInputs(){
 const m=metadata(),sources=new Map();
 for(const input of m.officialInputs){
  const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+m.baseCommit+'/'+input.path,{redirect:'error',signal:AbortSignal.timeout(15000)});
  assert(r.ok,'FIXED_SOURCE_HTTP');const chunks=[];let size=0;
  for await(const b of r.body){size+=b.length;assert(size<=input.bytes,'FIXED_SOURCE_LIMIT');chunks.push(b);}
  const b=Buffer.concat(chunks);same(b,input);sources.set(input.path,b);
 }
 for(const name of [pre,entropy]){
  const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+m.baseCommit+'/'+name,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,404,'NEW_PATH_EXISTS_IN_OFFICIAL_BASE');
 }
 return sources;
}
export function prepareOfficialSecureRandomSources(sources){
 assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');const m=metadata();
 assert.equal(m.baseCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
 assert.deepEqual([...sources.keys()].sort(),[cpp,core,sc,detect].sort(),'EXACT_FOUR_OFFICIAL_INPUTS');
 assert.equal(m.officialInputs.length,4);for(const p of m.officialInputs)same(sources.get(p.path),p);
 assert.equal(pin(sources.get(cpp)).sha256,'e5401beaa0f9dacf7c82e00300adf33a8935e97a4b019c6a8cde979b0ebd0769');
 assert.equal(pin(sources.get(core)).sha256,'4b16ce9bc271a4c5f080b81439a24eb3baa6e8a89461a941332bd32c626549c2');
 assert.deepEqual(m.prerequisites.map(p=>p.path),['official-glx-detect','official-glx-context-source','official-storage-source','official-http-selection','official-shader-diagnostics'].map(p=>'engine/'+p+'.patch'));
 let scsub=sources.get(sc).toString(),detection;
 for(const p of m.prerequisites){
  const patch=read(p);
  if(p.path==='engine/official-glx-detect.patch')detection=replayUnifiedPatch(patch,p=>sources.get(p)??null).get(detect).text;
  else {
   const portion=patch.toString().split(/(?=^diff --git )/m).filter(s=>s.startsWith('diff --git a/'+sc+' ')).join('');assert(portion,'SCSUB_PREREQUISITE');
   scsub=replayUnifiedPatch(Buffer.from(portion),()=>scsub).get(sc).text;
  }
 }
 const parents=new Map([[cpp,sources.get(cpp)],[core,sources.get(core)],[sc,scsub],[detect,detection]]);
 for(const p of m.inputs)same(parents.get(p.path),p);
 assert.equal(pin(scsub).sha256,'0e791e965c1182d704df794b7b8841575a2b764566a474fc0df137b8e67d3c24');
 assert.equal(pin(detection).sha256,'27ee74d628083a2135c3c58223efddef87778f0697f1483d93cc13407eae4e96');
 const patch=read(m.patch);assert(!patch.includes(13),'PATCH_LF_ONLY');
 const outputs=replayUnifiedPatch(patch,p=>parents.get(p)??null);
 assert.deepEqual([...outputs.keys()].sort(),[cpp,sc,detect,pre,entropy].sort(),'EXACT_FIVE_OUTPUTS');
 assert.equal(m.outputs.length,5);for(const p of m.outputs){same(outputs.get(p.path).text,p);assert.equal(outputs.get(p.path).added,p.added);}
 assert.throws(()=>replayUnifiedPatch(patch,p=>outputs.get(p)?.text??parents.get(p)??null),'DUPLICATE_MUST_REJECT');
 const original=sources.get(cpp).toString(),result=outputs.get(cpp).text,point=original.indexOf('// RandomGenerator\n');assert(point>0);
 assert(result.startsWith(original.slice(0,point))&&result.endsWith(original.slice(point)),'CPP_ONLY_INSERTION');
 const region=result.slice(point,result.length-(original.length-point));
 assert(region.startsWith('#if defined(WEB_ENABLED) && defined(WECHAT_GLX_EXPERIMENTAL)\n')&&region.endsWith('#endif\n\n'));
 let depth=0;for(const l of region.trimEnd().split('\n')){if(/^#if/.test(l))depth++;if(/^#endif/.test(l))depth--;assert(depth>=0);}
 assert.equal(depth,0);assert(!/^#else/m.test(region),'NO_MACRO_OFF_BRANCH');
 assert.equal(result.slice(0,point)+result.slice(point+region.length),original,'MACRO_OFF_WHOLE_CPP');
 for(const forbidden of ['OS::','RandomGenerator::','memalloc(','memfree(','mbedtls_entropy_func'])assert(!region.includes(forbidden),'NO_OS_ALLOCATOR_ENTROPY_RECURSION');
 const exportLine='    env["EXPORTED_FUNCTIONS"] += ["_godot_wechat_random_buffer"]\n';
 assert.equal(outputs.get(detect).text,detection.replace('    env.Append(CPPDEFINES=["WECHAT_GLX_EXPERIMENTAL"])\n','    env.Append(CPPDEFINES=["WECHAT_GLX_EXPERIMENTAL"])\n'+exportLine),'ONLY_EXPORT_INSERTION');
 assert.equal(outputs.get(sc).text,scsub+'\n# Owned synchronous entropy bridge; browser builds keep their original crypto path.\nif env["use_wx_glx"]:\n    sys_env.AddJSPre(["js/libs/library_godot_crypto.js"])\n    sys_env.AddJSLibraries(["js/libs/library_godot_wechat_entropy.js"])\n','ONLY_CONDITIONAL_SCSUB_INSERTION');
 for(const p of [pre,entropy]){const source=outputs.get(p).text;new vm.Script(source,{filename:p});assert(!source.includes('Math.random'),'NO_WEAK_RANDOM');}
 const receipt={schema:'wxslim-official-secure-random-audit-v1',status:'PASS_SOURCE_REPLAY_ONLY_NOT_COMPILED',baseCommit:m.baseCommit,
  officialInputs:m.officialInputs,prerequisites:m.prerequisites,inputs:m.inputs,patch:m.patch,outputs:m.outputs,abi:m.abi,
  macroOffEntireCppUnchanged:true,ordinaryBrowserScsubAndDetectBranchUnchanged:true,newPaths:[pre,entropy],
  predecessorScope:'Only exact detect/SCsub projections of reviewed 15-patch chain; does not re-audit the other platform outputs.',
  buildParametersAdded:[],sourceTreeWritten:false,sconsExecuted:false,mbedtlsCompiled:false,mbedtlsExecuted:false,engineRun:false,realWxCalled:false,phone:'NOT_RUN',remaining:m.remaining};
 return {outputs,receipt,parents};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);let sources;
 if(args.length===1&&args[0]==='--fetch-fixed-four')sources=await fetchOfficialSecureRandomInputs();
 else if(args.length===2&&args[0]==='--source-root'){
  const dir=fs.realpathSync(args[1]);sources=new Map();
  for(const p of officialSecureRandomInputPlan()){const file=fs.realpathSync(path.join(dir,p.path));assert(file.startsWith(dir+path.sep),'SOURCE_OUTSIDE_ROOT');sources.set(p.path,fs.readFileSync(file));}
  for(const p of [pre,entropy])assert(!fs.existsSync(path.join(dir,p)),'NEW_PATH_ALREADY_EXISTS');
 }else throw Error('Usage: --fetch-fixed-four OR --source-root <fixed official c050 source>');
 console.log(JSON.stringify(prepareOfficialSecureRandomSources(sources).receipt,null,2));
}
