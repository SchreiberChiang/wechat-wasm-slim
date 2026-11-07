// In-memory replay of existing fixes. No compiler, SDK changes or runtime claims.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p));
const json=p=>JSON.parse(read(p));
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(pin(b),{bytes:p.bytes,sha256:p.sha256},p.path);
function plan(){const f=json('engine/official-file-errors.json'),s=json('engine/official-render-fixes.json');assert.equal(f.baseCommit,s.baseCommit);return {f,s,inputs:[f.input,s.input]};}
export function officialRenderFileInputs(){return plan().inputs;}
export function auditOfficialRenderFile(sources){
  assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');
  const {f,s,inputs}=plan();assert.deepEqual([...sources.keys()].sort(),inputs.map(p=>p.path).sort());
  for(const p of inputs)same(sources.get(p.path),p);
  const state=new Map(),stages=[];
  for(const p of [f.patch,...s.patches]){
    const patch=read(p.path);same(patch,p);replayUnifiedPatch(patch,n=>sources.get(n)??null,state);
    const target=p===f.patch?f.output.path:s.output.path;const expected=p===f.patch?f.output:p.output;same(state.get(target).text,expected);
    assert.throws(()=>replayUnifiedPatch(patch,n=>state.get(n)?.text??sources.get(n)??null));
    stages.push({path:p.path,...pin(patch),outputs:[{path:target,...pin(state.get(target).text)}]});
  }
  const cpp=state.get(f.output.path).text;
  const pattern=/#if defined\(WEB_ENABLED\) && defined\(WECHAT_GLX_EXPERIMENTAL\)\n([\s\S]*?)#else\n([\s\S]*?)#endif\n/g;
  assert.equal([...cpp.matchAll(pattern)].length,2);assert(!cpp.includes('__EMSCRIPTEN_GLX__'));
  assert(cpp.replace(pattern,(_,yes,no)=>no)===sources.get(f.input.path).toString(),'NON_WECHAT_FILEACCESS_CHANGED');
  const priorState=new Map();
  for(const p of f.derivedFrom){const b=read(p.path);same(b,p);replayUnifiedPatch(b,n=>sources.get(n)??null,priorState);same(priorState.get(f.output.path).text,p.output);}
  assert(priorState.get(f.output.path).text===cpp,'COMPOSED_OLD_FIXES_DIFFER');
  return {schema:'wxslim-official-render-file-audit-v1',status:'PASS_SOURCE_ONLY',baseCommit:f.baseCommit,inputs,stages,
    outputs:[f.output,s.output],nonWechatFileAccessEqualsOfficial:true,
    shaderMatchesRecordedSuccessfulSource:true,shaderIsNotWechatMacroIsolated:true,
    obsoleteFileAccessMacroAbsent:true,storageInitializationFixed:false,compiled:false,runtime:false,
    remaining:['baseline shader diagnostics and generated-JS instrumentation','return0 and final paired output','FileAccess compiled branch and native IO','new official full/conservative build and GLX visual acceptance']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),p=plan(),sources=new Map();
  if(args.length===1&&args[0]==='--fetch-fixed-two'){
    for(const input of p.inputs){const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+p.f.baseCommit+'/'+input.path,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok,'SOURCE_HTTP');const chunks=[];let size=0;for await(const b of r.body){size+=b.length;assert(size<=input.bytes,'SOURCE_SIZE_LIMIT');chunks.push(b)}sources.set(input.path,Buffer.concat(chunks));}
  }else if(args.length===2&&args[0]==='--source-root'){
    const dir=fs.realpathSync(args[1]);for(const input of p.inputs){const file=fs.realpathSync(path.join(dir,input.path));assert(file.startsWith(dir+path.sep),'SOURCE_OUTSIDE_ROOT');sources.set(input.path,fs.readFileSync(file));}
  }else throw Error('Usage: --fetch-fixed-two OR --source-root <fixed-official-source>');
  console.log(JSON.stringify(auditOfficialRenderFile(sources),null,2));
}
