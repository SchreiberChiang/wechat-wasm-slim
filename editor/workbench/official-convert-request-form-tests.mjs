// Pure in-memory models plus the actual public configuration normalizer.
// No selected input file, task plan, converter, editor, GUI or directory is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildOfficialConvertRequestDraft} from './official-convert-request-form.mjs';
import {normalizeConfig} from '../../convert/official.mjs';

function fixture(){
  const base=path.resolve('MEMORY_ONLY_OFFICIAL_FORM');
  return {base,payload:{js:path.join(base,'配对引擎.js'),wasm:path.join(base,'配对引擎.wasm'),pck:path.join(base,'游戏.pck'),
    transformer:path.join(base,'已有官方转换器.exe'),interfaces:path.join(base,'已有工程接口.js'),output:path.join(base,'新任务输出'),
    renderMode:'glx',name:'普通游戏',locale:'en',orientation:'portrait'},
    files:{configFile:path.join(base,'转换配置.json'),requestFile:path.join(base,'转换请求.json')}};
}
const build=f=>buildOfficialConvertRequestDraft(f.payload,f.files);

test('draft matches the actual official normalizeConfig and fixed c050 recipe without touching selected files',()=>{
  const f=fixture(),draft=build(f),normalized=normalizeConfig(draft.config,f.base);
  assert.deepEqual(Object.keys(draft).sort(),['config','request','configText','requestText'].sort());
  assert.deepEqual(draft.config,{schema:'wxslim-official-inputs-v1',engineProfile:'full-official-c050-dev',...f.payload});
  for(const [key,value]of Object.entries(draft.config))assert.deepEqual(normalized[key],value,key);
  assert.deepEqual(normalized.options,{renderMode:'glx',orientation:'portrait',locale:'en',name:'普通游戏',compat:true,splitBridge:false,loadingPage:'on',timing:false});
  assert.deepEqual(draft.request,{schema:'wxslim-task-request-v1',action:'official-convert',configFile:f.files.configFile,purpose:'development-test',scope:{}});
  assert.equal(draft.configText,JSON.stringify(draft.config,null,2)+'\n');assert.equal(draft.requestText,JSON.stringify(draft.request,null,2)+'\n');
  assert.deepEqual(JSON.parse(draft.configText),draft.config);assert.deepEqual(JSON.parse(draft.requestText),draft.request);
});

test('exact ten fields prevent unknown knobs, profile overrides, AppID, budgets and execution controls',()=>{
  for(const key of Object.keys(fixture().payload)){const f=fixture();delete f.payload[key];assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});}
  for(const [key,value]of [['engineProfile','full'],['projectUsage',{}],['upstreamSource','source'],['schema','other'],['options',{}],['appid','not-an-identifier'],['appID','not-an-identifier'],['budgetBytes',120*1024*1024],['cacheGrowthBudgetBytes',0],['write',true],['execute',true],['confirmed',true],['purpose','supported-use'],['scope',{}]]){
    const f=fixture();f.payload[key]=value;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});
  }
  for(const payload of [null,undefined,[],0,'payload']){const f=fixture();f.payload=payload;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});}
  const f=fixture();f.payload[Symbol('profile')]='full';assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});
  const legitimate=build(fixture()).config;assert.throws(()=>normalizeConfig({...legitimate,budgetBytes:145*1024*1024}));
});

test('large PCK budget is an explicit boolean selection and standard drafts keep their default',()=>{
  const f=fixture(), original=build(f).config;
  f.payload.largePckBudget=false;assert.deepEqual(build(f).config,original);
  f.payload.largePckBudget=true;assert.equal(normalizeConfig(build(f).config).budgetBytes,144*1024*1024);
  for (const value of [null,1,'true']) { f.payload.largePckBudget=value;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_BUDGET_BOOLEAN'}); }
});

test('every selected input, explicit converter/interfaces and future output require absolute trimmed paths',()=>{
  for(const key of ['js','wasm','pck','transformer','interfaces','output']){
    for(const value of [undefined,null,1,'','relative/file',' '+fixture().payload[key],fixture().payload[key]+' ',fixture().payload[key]+'\u0000',fixture().payload[key]+'\r',fixture().payload[key]+'\n']){
      const f=fixture();f.payload[key]=value;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_PATH'});
    }
  }
  // Paths are not inferred from the JS filename, preset, profile or a template.
  for(const key of ['transformer','interfaces']){const f=fixture();delete f.payload[key];assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_FIELDS'});}
});

test('only the real glx/webgl and portrait/landscape enums are accepted',()=>{
  for(const renderMode of ['glx','webgl'])for(const orientation of ['portrait','landscape']){
    const f=fixture();Object.assign(f.payload,{renderMode,orientation});const normalized=normalizeConfig(build(f).config,f.base);
    assert.equal(normalized.options.renderMode,renderMode);assert.equal(normalized.options.orientation,orientation);
  }
  for(const renderMode of ['webgl2','GLX','auto','metal',' glx','glx ',null,0]){
    const f=fixture();f.payload.renderMode=renderMode;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_RENDER_MODE'});
  }
  for(const orientation of ['auto','horizontal','Portrait',' portrait','landscape ',null,0]){
    const f=fixture();f.payload.orientation=orientation;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_ORIENTATION'});
  }
});

test('arbitrary nonempty locales and project names retain the public normalizer semantics',()=>{
  for(const locale of ['en','zh-CN','zh_Hans','fr','x-custom locale','  自定义区域  ','x\tlocale']){
    const f=fixture();f.payload.locale=locale;f.payload.name='  自定义 名称  ';const draft=build(f),normalized=normalizeConfig(draft.config,f.base);
    assert.equal(draft.config.locale,locale);assert.equal(normalized.options.locale,locale);assert.equal(normalized.options.name,f.payload.name);
  }
  for(const key of ['locale','name'])for(const value of ['', '   ','\t\n',null,0,false,{}]){
    const f=fixture();f.payload[key]=value;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_TEXT'});
  }
});

test('draft destinations require exact configFile/requestFile paths without switches or new path policies',()=>{
  for(const files of [undefined,null,[],{}, {configFile:fixture().files.configFile},{...fixture().files,write:true}]){
    const f=fixture();f.files=files;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_DESTINATIONS'});
  }
  for(const key of ['configFile','requestFile'])for(const value of ['relative.json','',null,' '+fixture().files[key],fixture().files[key]+'\u0000',fixture().files[key]+'\r',fixture().files[key]+'\n']){
    const f=fixture();f.files[key]=value;assert.throws(()=>build(f),{code:'LOCAL_OFFICIAL_FORM_PATH'});
  }
  // No extension/existence/link/overlap audit is invented by this pure builder.
  const f=fixture();f.payload.js=path.join(f.base,'existing-pair-file-without-extension');f.payload.interfaces=path.join(f.base,'user chosen interface');
  assert.equal(normalizeConfig(build(f).config,f.base).interfaces,f.payload.interfaces);
});

test('same inputs give identical drafts, never mutate caller objects or alias generated scope',()=>{
  const f=fixture(),before=structuredClone(f);Object.freeze(f.payload);Object.freeze(f.files);
  const a=build(f),b=build(f);assert.deepEqual(a,b);assert.deepEqual(f,before);
  a.config.js='caller edit';a.request.scope.edited=true;assert.deepEqual(f,before);assert.deepEqual(build(f),b);assert.deepEqual(b.request.scope,{});
});

test('budget and runtime knobs remain recipe-owned rather than fabricated form output',()=>{
  const draft=build(fixture());
  for(const key of ['budgetBytes','appid','appID','options','compat','splitBridge','loadingPage','timing','upstreamSource','projectUsage'])assert(!Object.hasOwn(draft.config,key),key);
  for(const key of ['eligible','executionAuthorized','taskId','outputCreated'])assert(!Object.hasOwn(draft,key),key);
});
