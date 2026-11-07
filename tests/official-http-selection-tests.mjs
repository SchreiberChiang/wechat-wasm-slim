import {fileURLToPath} from 'node:url';
// Fixed-source GET/read + in-memory replay and selected Python AST execution.
// Does not import/execute SCons, compile, run an engine, or request business URLs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {officialStorageInputPlan,prepareOfficialStorageSources} from '../engine/official-storage-source-audit.mjs';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
const id=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});
const meta=JSON.parse(fs.readFileSync(new URL('../engine/official-http-selection.json',import.meta.url),'utf8'));
const sourceRoot=process.env.WXSLIM_OFFICIAL_SOURCE_ROOT || fileURLToPath(new URL('../offline/fixtures/c050-source/',import.meta.url));
const inputs=new Map(officialStorageInputPlan().map(p=>[p.path,fs.readFileSync(path.join(sourceRoot,p.path))]));
const before=prepareOfficialStorageSources(inputs).scsubSource;
const patch=fs.readFileSync(new URL('../engine/official-http-selection.patch',import.meta.url));
const replay=replayUnifiedPatch(patch,p=>{assert.equal(p,'platform/web/SCsub');return before;});
const after=replay.get('platform/web/SCsub').text;
test('exact storage prerequisite and single SCsub selection line replay; duplicate rejects',()=>{
  assert.deepEqual(id(before),{bytes:5019,sha256:'d68a2232b0a6a9c6691c7fb5849478ca4dbc36b6ab59fa66bd7786fe7c84262c'});
  assert.deepEqual(id(patch),{bytes:meta.patch.bytes,sha256:meta.patch.sha256});assert(!patch.includes(13));
  assert.deepEqual([...replay.keys()],['platform/web/SCsub']);assert.deepEqual(id(after),{bytes:meta.output.bytes,sha256:meta.output.sha256});
  assert.equal(before.split(meta.selection.before).length,2);assert.equal(after,before.replace(meta.selection.before,meta.selection.after));
  assert.throws(()=>replayUnifiedPatch(patch,()=>after));
  assert.throws(()=>replayUnifiedPatch(patch,()=>before.replace(meta.selection.before,'    "unapproved.js",')));
});
const script=`import ast,json,sys
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
 selected=[]
 for n in ast.parse(text).body:
  if call(n): selected.append(n)
  elif isinstance(n,ast.If) and n.body and all(call(b) for b in n.body) and not n.orelse: selected.append(n)
 r=Receiver()
 exec(compile(ast.Module(body=selected,type_ignores=[]),'library-selection-only','exec'),{'__builtins__':{},'env':{'use_wx_glx':glx,'javascript_eval':js},'sys_env':r})
 return r.calls
result=[]
for glx in [False,True]:
 for js in [False,True]:
  b=collect(x['before'],glx,js);a=collect(x['after'],glx,js)
  expected=[[k,[('js/libs/library_wxslim_fetch.js' if glx and k=='AddJSLibraries' and p=='js/libs/library_godot_fetch.js' else p) for p in v]] for k,v in b]
  assert a==expected
  assert sum(v.count('js/libs/library_wxslim_fetch.js') for k,v in a if k=='AddJSLibraries')==(1 if glx else 0)
  assert sum(v.count('js/libs/library_godot_fetch.js') for k,v in a if k=='AddJSLibraries')==(0 if glx else 1)
  result.append({'glx':glx,'javascriptEval':js,'before':b,'after':a})
print(json.dumps(result))
`;
function pythonModel(candidate=after){
  const python=process.env.WXSLIM_MODEL_PYTHON;assert(python&&path.isAbsolute(python),'Explicit absolute fixed venv WXSLIM_MODEL_PYTHON required');
  assert.equal(id(fs.readFileSync(python)).sha256,'7bcdf892816a8d651e89f008cfc2f1544a41f13089af70a227b9fc54ced8551f','FIXED_PYTHON_IDENTITY');
  return JSON.parse(execFileSync(python,['-X','utf8','-B','-c',script],{input:JSON.stringify({before,after:candidate}),encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}));
}
test('actual Python AST chooses exactly one fetch library for both modes; other lists/order stay unchanged',()=>{
  const r=pythonModel();assert.equal(r.length,4);assert.deepEqual(r.map(x=>[x.glx,x.javascriptEval]),[[false,false],[false,true],[true,false],[true,true]]);
});
test('selection model rejects unconditional WeChat selection and unrelated post-list changes',()=>{
  for(const candidate of [after.replace(meta.selection.after,'    "js/libs/library_wxslim_fetch.js",'),after.replace('"js/patches/patch_em_gl.js"','"js/patches/unrelated.js"')])assert.throws(()=>pythonModel(candidate));
});
test('new library identity remains exact and no SCsub source tree is written by this unit',()=>{
  const p=fs.readFileSync(new URL('../engine/official-http-source.patch',import.meta.url)),m=replayUnifiedPatch(p,()=>null);
  const source=m.get(meta.selectedNewSource.path).text;assert.deepEqual(id(source),{bytes:12888,sha256:'4bdaefe74d6cfd7c77b919fe71a9bc0b462701fb5eff358bc4259f5bc33cba10'});
  assert.equal(meta.applied,false);assert.equal(meta.compiled,false);assert.equal(meta.runtime,'NOT_RUN');
});
