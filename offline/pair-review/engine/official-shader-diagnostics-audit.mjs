// Pure source replay/inspection: no source-tree writes, SDK, SCons or target execution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
const cpp='drivers/gles3/shader_gles3.cpp',sc='platform/web/SCsub';
const id=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const same=(b,p)=>assert.deepEqual(id(b),{bytes:p.bytes,sha256:p.sha256},p.path);
const meta=()=>JSON.parse(fs.readFileSync(new URL('./official-shader-diagnostics.json',import.meta.url),'utf8'));
const anchor='    sys_env.AddJSLibraries(["js/libs/library_wxslim_persistent.js"])\n';
const extra='    sys_env.AddJSLibraries([\n        "js/libs/library_wxslim_shader_failure.js",\n        "js/libs/library_wxslim_shader_type_return.js",\n    ])\n';
export function officialShaderDiagnosticsInputPlan(){return meta().inputs;}
export function prepareOfficialShaderDiagnostics(sources){
  assert.equal(arguments.length,1,'EXTERNAL_PLAN_NOT_ACCEPTED');const m=meta();
  assert.equal(m.baseCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
  assert.deepEqual([...sources.keys()].sort(),[cpp,sc].sort(),'EXACT_TWO_INPUTS');
  for(const p of m.inputs)same(sources.get(p.path),p);
  const patch=fs.readFileSync(new URL('./official-shader-diagnostics.patch',import.meta.url));same(patch,m.patch);
  const out=replayUnifiedPatch(patch,p=>sources.get(p)??null);
  assert.deepEqual([...out.keys()].sort(),m.outputs.map(p=>p.path).sort(),'EXACT_SEVEN_OUTPUTS');assert.equal(out.size,7);
  for(const p of m.outputs){same(out.get(p.path).text,p);assert.equal(out.get(p.path).added,p.added);}
  assert(!out.has('godot_process.js')&&!out.has('platform/web/js/patches/patch_em_gl.js'),'NO_OLD_PROCESSOR_OR_OFFICIAL_GL_PATCH');
  assert.throws(()=>replayUnifiedPatch(patch,p=>out.get(p)?.text??sources.get(p)??null));
  const baseline=fs.readFileSync(new URL('./alpha-preserve-lighting/baseline-shader-diagnostic.patch',import.meta.url));same(baseline,m.provenance);
  assert.equal(id(baseline).sha256,'84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6');
  const retained=baseline.toString().split(/(?=^diff --git )/m).filter(s=>s.startsWith('diff --git a/'+cpp+' ')||m.outputs.some(p=>p.added&&s.startsWith('diff --git a/'+p.path+' ')));
  assert.equal(retained.length,6);const original=replayUnifiedPatch(Buffer.from(retained.join('')),p=>p===cpp?sources.get(cpp):null);
  const condition=/#if defined\(WEB_ENABLED\) && defined\(WECHAT_GLX_EXPERIMENTAL\)\n([\s\S]*?)#endif\n/g;
  for(const [name,value]of original){
    if(name===cpp)assert.equal(out.get(name).text.replace(condition,(_,body)=>body),value.text.replace(condition,(_,body)=>body),'MACRO_ON_BASELINE_CPP');
    else assert.equal(out.get(name).text,value.text,'ORIGINAL_DIAGNOSTIC_PAYLOAD: '+name);
  }
  const text=out.get(cpp).text;assert.equal([...text.matchAll(condition)].length,11,'CPP_MACRO_REGIONS');
  assert.equal(text.replace(condition,''),sources.get(cpp).toString(),'MACRO_OFF_ENTIRE_CPP');
  const before=sources.get(sc).toString();assert.equal(before.split(anchor).length,2);
  assert.equal(out.get(sc).text,before.replace(anchor,anchor+extra),'ONLY_CONDITIONAL_LIBRARY_INSERTION');
  const syntax=[];for(const [name,value]of out)if(/\.(?:js|cjs)$/.test(name)){new vm.Script(value.text,{filename:name});syntax.push(name);}
  const header=out.get('drivers/gles3/wxslim_shader_failure.h').text;
  const extern=header.slice(header.indexOf('extern "C" {'),header.indexOf('// Only the two'));
  const abi=[...extern.matchAll(/\b(int|void) (wxslim_shader_\w+)\(([^)]*)\);/g)].map(v=>({name:v[2],argumentCount:v[3].trim()?v[3].split(',').length:0,returnType:v[1]}));
  assert.deepEqual(abi,m.abi.externC,'HEADER_ABI');
  assert(header.includes('EM_JS_DEPS(wxslim_shader_failure_guard_deps, "$stackSave,$stackRestore,$dynCall");'),'GUARD_DEPS');
  const libs=m.outputs.filter(p=>p.path.endsWith('.js')).map(p=>out.get(p.path).text).join('\n');
  for(const fn of abi){const match=libs.match(new RegExp('\\b'+fn.name+': function \\(([^)]*)\\)'));assert(match,'JS_ABI_FUNCTION');assert.equal(match[1].trim()?match[1].split(',').length:0,fn.argumentCount,'JS_ABI_ARITY');}
  for(const p of m.abi.jsDependencies){const lines=out.get(p.path).text.split('\n').filter(l=>l.includes('__sig')||l.includes('__deps:'));assert.deepEqual(lines,p.sigs,'ORIGINAL_JS_DEPS');}
  const receipt={schema:'wxslim-official-shader-diagnostics-audit-v1',status:'PASS_SOURCE_DIAGNOSTICS_ONLY',baseCommit:m.baseCommit,
    inputs:m.inputs,patch:m.patch,outputs:m.outputs,macroOffEntireCppUnchanged:true,macroOnEqualsRetainedBaseline:true,retainedFivePayloadsUnchanged:true,
    abi,sourcesSyntaxParsed:syntax,buildParametersAdded:[],oldGodotProcessIncluded:false,postprocessorWired:false,
    sourceTreeWritten:false,sconsExecuted:false,compiled:false,engineRun:false,phone:'NOT_RUN',
    boundary:'Header/JS source contracts and models only; generated instrumentation, SDK signature expansion, native imports and device observations remain required.'};
  return {receipt,outputs:out,scsubBefore:before,scsubSource:out.get(sc).text};
}
