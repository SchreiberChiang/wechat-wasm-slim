// Pure in-memory form models. No files, project copies, editor or task runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildExportRequestDraft} from './export-request-form.mjs';

const MiB=1024*1024;
function fixture(){
  const base=path.resolve('MEMORY_ONLY_EXPORT_FORM');
  return {local:{editorExecutable:path.join(base,'editor','godot.exe'),requestFile:'old-selection.json',taskId:'old-task'},
    payload:{project:path.join(base,'游戏 工程'),preset:'Web 导出',output:path.join(base,'导出结果'),budgetBytes:32*MiB,cacheGrowthBudgetBytes:64*MiB,allowImportWrites:true},
    files:{configFile:path.join(base,'任务 配置.json'),requestFile:path.join(base,'导出 请求.json')}};
}
const build=f=>buildExportRequestDraft(f.local,f.payload,f.files);

test('ordinary fields produce exact shared-backend config/request schemas and deterministic JSON text',()=>{
  const f=fixture(),draft=build(f);
  assert.deepEqual(Object.keys(draft).sort(),['config','request','configText','requestText'].sort());
  assert.deepEqual(draft.config,{schema:'wxslim-project-pck-export-v1',editor:f.local.editorExecutable,...f.payload});
  assert.deepEqual(draft.request,{schema:'wxslim-task-request-v1',action:'project-pck-export',configFile:f.files.configFile,purpose:'development-test',scope:{}});
  assert.equal(draft.configText,JSON.stringify(draft.config,null,2)+'\n');assert.equal(draft.requestText,JSON.stringify(draft.request,null,2)+'\n');
  assert.deepEqual(JSON.parse(draft.configText),draft.config);assert.deepEqual(JSON.parse(draft.requestText),draft.request);assert.deepEqual(build(f),draft);
  assert(!draft.requestText.includes('old-task'));assert(!draft.requestText.includes('old-selection'));
});

test('editor comes only from local configuration; no file or preset existence is claimed or required',()=>{
  const f=fixture();f.local.editor=path.resolve('ignored-other-editor.exe');f.local.output=path.resolve('ignored-output');
  f.payload.preset='任意待共同计划核验的预设';const draft=build(f);assert.equal(draft.config.editor,f.local.editorExecutable);assert.equal(draft.config.preset,f.payload.preset);
  assert(!Object.hasOwn(draft,'eligible'));assert(!Object.hasOwn(draft,'executionAuthorized'));assert(!Object.hasOwn(draft,'taskId'));
  f.payload.editor=f.local.editor;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_FIELDS'});
});

test('payload accepts exactly the six declared fields and rejects execution flags and extra metadata',()=>{
  for(const key of Object.keys(fixture().payload)){const f=fixture();delete f.payload[key];assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_FIELDS'});}
  for(const key of ['write','execute','confirmed','schema','action','purpose','configFile','editorExecutable','overwrite']){
    const f=fixture();f.payload[key]=true;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_FIELDS'});
  }
  for(const payload of [undefined,null,[],false,'payload']){const f=fixture();f.payload=payload;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_FIELDS'});}
  const f=fixture();f.payload[Symbol('write')]=true;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_FIELDS'});
});

test('project/output/local editor and both future destination files require absolute trimmed paths without NUL CR LF',()=>{
  for(const [group,key]of [['payload','project'],['payload','output'],['local','editorExecutable'],['files','configFile'],['files','requestFile']]){
    for(const value of ['relative/path','',' '+fixture()[group][key],fixture()[group][key]+' ',fixture()[group][key]+'\u0000',fixture()[group][key]+'\r',fixture()[group][key]+'\n',null,42]){
      const f=fixture();f[group][key]=value;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_PATH'});
    }
  }
  const f=fixture();delete f.local.editorExecutable;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_PATH'});
});

test('preset follows the backend nonempty trim and NUL CR LF rules without an invented name allowlist',()=>{
  for(const preset of ['', ' Web','Web ','Web\u0000','Web\r','Web\n',null,0,false]){const f=fixture();f.payload.preset=preset;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_PRESET'});}
  for(const preset of ['Web','Web (兼容) / 自定义','发布:测试','Web\tExport']){const f=fixture();f.payload.preset=preset;assert.equal(build(f).config.preset,preset);}
});

test('budgets use exact shared normalizer limits including both boundary values',()=>{
  for(const budgetBytes of [8*MiB,272*MiB])for(const cacheGrowthBudgetBytes of [0,2**32]){
    const f=fixture();Object.assign(f.payload,{budgetBytes,cacheGrowthBudgetBytes});assert.equal(build(f).config.budgetBytes,budgetBytes);assert.equal(build(f).config.cacheGrowthBudgetBytes,cacheGrowthBudgetBytes);
  }
  for(const budgetBytes of [8*MiB-1,272*MiB+1,0,-1,8*MiB+0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'8388608',null]){
    const f=fixture();f.payload.budgetBytes=budgetBytes;assert.throws(()=>build(f),{code:'PCK_EXPORT_BUDGET'});
  }
  for(const cacheGrowthBudgetBytes of [-1,2**32+1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'0',null]){
    const f=fixture();f.payload.cacheGrowthBudgetBytes=cacheGrowthBudgetBytes;assert.throws(()=>build(f),{code:'PCK_EXPORT_BUDGET'});
  }
});

test('import writes require the same explicit true acknowledgement as the shared export normalizer',()=>{
  for(const allowImportWrites of [false,0,1,'true',null]){const f=fixture();f.payload.allowImportWrites=allowImportWrites;assert.throws(()=>build(f),{code:'PCK_EXPORT_IMPORT_WRITE_ACK'});}
});

test('future destinations are exact and inputs stay untouched; generated objects never alias caller configuration',()=>{
  for(const files of [undefined,null,{},[],{configFile:fixture().files.configFile},{...fixture().files,write:true}]){
    const f=fixture();f.files=files;assert.throws(()=>build(f),{code:'LOCAL_EXPORT_FORM_DESTINATIONS'});
  }
  const f=fixture(),before=structuredClone(f);Object.freeze(f.local);Object.freeze(f.payload);Object.freeze(f.files);const draft=build(f);assert.deepEqual(f,before);
  draft.config.project='caller-edit';draft.request.scope.edited=true;assert.deepEqual(f,before);assert.notEqual(build(f).config.project,'caller-edit');assert.deepEqual(build(f).request.scope,{});
});
