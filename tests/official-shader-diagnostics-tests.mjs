// Fixed-source reads/GET plus memory replay and selected Python AST execution.
// No SCons, compiler, engine, GL API, filesystem mutation or business network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {officialStorageInputPlan,fetchOfficialStorageInputs,prepareOfficialStorageSources} from '../engine/official-storage-source-audit.mjs';
import {prepareOfficialShaderDiagnostics} from '../engine/official-shader-diagnostics-audit.mjs';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
const cpp='drivers/gles3/shader_gles3.cpp',sc='platform/web/SCsub',base='c050c09b105c3715e1caa57a7109cd752047fd89';
const id=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const metadata=JSON.parse(fs.readFileSync(new URL('../engine/official-shader-diagnostics.json',import.meta.url),'utf8'));
const storageInputs=process.env.WXSLIM_OFFICIAL_SOURCE_ROOT?new Map(officialStorageInputPlan().map(p=>[p.path,fs.readFileSync(path.join(process.env.WXSLIM_OFFICIAL_SOURCE_ROOT,p.path))])):await fetchOfficialStorageInputs();
const storage=prepareOfficialStorageSources(storageInputs);
const selection=fs.readFileSync(new URL('../engine/official-http-selection.patch',import.meta.url));
const scsub=replayUnifiedPatch(selection,()=>storage.scsubSource).get(sc).text;
let originalCpp;
if(process.env.WXSLIM_OFFICIAL_SOURCE_ROOT)originalCpp=fs.readFileSync(path.join(process.env.WXSLIM_OFFICIAL_SOURCE_ROOT,cpp));
else {const r=await fetch('https://raw.githubusercontent.com/godotengine/godot/'+base+'/'+cpp,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(r.ok);originalCpp=Buffer.from(await r.arrayBuffer());assert(originalCpp.length<=128*1024);}
const sources=new Map([[cpp,originalCpp],[sc,Buffer.from(scsub)]]),prepared=prepareOfficialShaderDiagnostics(sources);
test('fixed official CPP and exact HTTP-selection SCsub feed seven outputs, no old processor',()=>{
  assert.deepEqual(id(originalCpp),{bytes:28071,sha256:'17c01277dc3468a1d53081f01a6f7665f5d0f82e7882a8198e1f486ee344d5d8'});
  assert.deepEqual(id(scsub),{bytes:5079,sha256:'30c1a567061eeba620b0346a5dc63835a8fac6f65f5b0b88efcda88befdeef03'});
  assert.equal(prepared.outputs.size,7);assert.equal([...prepared.outputs.values()].filter(v=>v.added).length,5);
  assert(!prepared.outputs.has('godot_process.js'));assert.equal(prepared.receipt.sourcesSyntaxParsed.length,4);
});
test('official CPP equals actual fixed df3 Git blob',{skip:!process.env.WXSLIM_SHADER_DF3_ROOT?'NOT_RUN: explicit WXSLIM_SHADER_DF3_ROOT required; no copied engine':false},()=>{
  const root=process.env.WXSLIM_SHADER_DF3_ROOT;assert(path.isAbsolute(root));
  const bytes=execFileSync('git',['--no-optional-locks','--no-replace-objects','-C',root,'show','df3cdd9bc9941a20cb5575d781cde6f937637bcb:'+cpp]);assert(bytes.equals(originalCpp));
});
test('macro-off whole CPP and five retained payloads remain exact original baseline',()=>{
  const text=prepared.outputs.get(cpp).text,pattern=/#if defined\(WEB_ENABLED\) && defined\(WECHAT_GLX_EXPERIMENTAL\)\n([\s\S]*?)#endif\n/g;
  assert.equal([...text.matchAll(pattern)].length,11);assert.equal(text.replace(pattern,''),originalCpp.toString());
  const baseline=fs.readFileSync(new URL('../engine/alpha-preserve-lighting/baseline-shader-diagnostic.patch',import.meta.url));
  assert.equal(id(baseline).sha256,'84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6');
  const paths=metadata.outputs.filter(p=>p.added).map(p=>p.path),sections=baseline.toString().split(/(?=^diff --git )/m).filter(s=>paths.some(p=>s.startsWith('diff --git a/'+p+' ')));
  const retained=replayUnifiedPatch(Buffer.from(sections.join('')),()=>null);assert.equal(retained.size,5);
  for(const [p,v]of retained)assert.equal(prepared.outputs.get(p).text,v.text);
});
test('changed CPP/predecessor, extra source and external plan reject before admission',()=>{
  assert.throws(()=>prepareOfficialShaderDiagnostics(sources,{}),/EXTERNAL_PLAN_NOT_ACCEPTED/);
  for(const name of [cpp,sc]){const altered=new Map(sources);altered.set(name,Buffer.concat([Buffer.from(altered.get(name)),Buffer.from('\n')]));assert.throws(()=>prepareOfficialShaderDiagnostics(altered));}
  assert.throws(()=>prepareOfficialShaderDiagnostics(new Map([...sources,['extra.js',Buffer.alloc(0)]])),/EXACT_TWO_INPUTS/);
  const patch=fs.readFileSync(new URL('../engine/official-shader-diagnostics.patch',import.meta.url));
  assert.throws(()=>replayUnifiedPatch(patch,p=>prepared.outputs.get(p)?.text??sources.get(p)??null));
});
const selectionModel=`import ast,json,sys
x=json.load(sys.stdin)
allowed={'AddJSLibraries','AddJSPre','AddJSPost','AddJSExterns'}
def collect(text,glx,js):
 class Receiver:
  def __init__(self): self.calls=[]
  def AddJSLibraries(self,v): self.calls.append(['AddJSLibraries',v])
  def AddJSPre(self,v): self.calls.append(['AddJSPre',v])
  def AddJSPost(self,v): self.calls.append(['AddJSPost',v])
  def AddJSExterns(self,v): self.calls.append(['AddJSExterns',v])
 def call(n):
  return isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and isinstance(n.value.func.value,ast.Name) and n.value.func.value.id=='sys_env' and n.value.func.attr in allowed
 chosen=[]
 for n in ast.parse(text).body:
  if call(n): chosen.append(n)
  elif isinstance(n,ast.If) and n.body and all(call(b) for b in n.body) and not n.orelse: chosen.append(n)
 r=Receiver();exec(compile(ast.Module(body=chosen,type_ignores=[]),'selected-SCsub-library-AST','exec'),{'__builtins__':{},'env':{'use_wx_glx':glx,'javascript_eval':js},'sys_env':r})
 return r.calls
result=[]
for glx in [False,True]:
 for js in [False,True]:
  before=collect(x['before'],glx,js);after=collect(x['after'],glx,js)
  expected=[]
  for entry in before:
   expected.append(entry)
   if glx and entry==['AddJSLibraries',['js/libs/library_wxslim_persistent.js']]: expected.append(['AddJSLibraries',['js/libs/library_wxslim_shader_failure.js','js/libs/library_wxslim_shader_type_return.js']])
  assert after==expected
  result.append({'glx':glx,'javascriptEval':js,'unchangedBrowser':not glx})
print(json.dumps(result))
`;
function select(after=prepared.scsubSource){
  const python=process.env.WXSLIM_MODEL_PYTHON;assert(python&&path.isAbsolute(python),'Explicit fixed absolute venv WXSLIM_MODEL_PYTHON required');
  assert.equal(id(fs.readFileSync(python)).sha256,'7bcdf892816a8d651e89f008cfc2f1544a41f13089af70a227b9fc54ced8551f');
  return JSON.parse(execFileSync(python,['-X','utf8','-B','-c',selectionModel],{input:JSON.stringify({before:prepared.scsubBefore,after}),encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}));
}
test('actual Python selection AST changes only GLX diagnostic list across four mode combinations',()=>{
  assert.equal(select().length,4);
  assert.throws(()=>select(prepared.scsubSource.replace('"js/libs/library_wxslim_shader_failure.js"','"js/libs/unapproved.js"')));
});
test('retained header/JS arities and dependencies do not claim compiled ABI or runtime pass',()=>{
  assert.equal(prepared.receipt.abi.length,6);assert.equal(prepared.receipt.abi.find(p=>p.name==='wxslim_shader_failure_begin').argumentCount,9);
  assert.equal(prepared.receipt.macroOffEntireCppUnchanged,true);assert.equal(prepared.receipt.retainedFivePayloadsUnchanged,true);
  assert.deepEqual(prepared.receipt.buildParametersAdded,[]);assert.equal(prepared.receipt.compiled,false);assert.equal(prepared.receipt.engineRun,false);assert.equal(prepared.receipt.postprocessorWired,false);
});
