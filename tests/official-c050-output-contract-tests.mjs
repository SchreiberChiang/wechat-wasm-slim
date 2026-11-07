// Actual registered pair bytes, in-memory manifest/framework models only.
// No converted project, transformer, engine factory or WASM module is executed.
// Prepared JS stays in memory. Exact virtual-path fs mocks below test binding
// logic, not a real disk-input preflight; no injected reader exists in production.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test,{before,after,mock} from 'node:test';
import {sha} from '../convert/lib/inputs.mjs';
import {renderManifest} from '../convert/lib/render.mjs';
import {renderStorageBridge} from '../convert/lib/storage-adapter.mjs';
import {OFFICIAL_C050_PROFILE,getOfficialRecipe,getRecipeIdentity} from '../convert/lib/official-engine-admission.mjs';
import {prepareOfficialC050Adapter} from '../convert/lib/official-c050-adapter.mjs';
import {bindManifest,auditOfficialC050Framework} from '../convert/lib/official-contract.mjs';
import {prepareOfficialRawPostprocess} from '../engine/official-raw-postprocess.mjs';
import {modelOfficialC050Framework,converterStackTraceHelper} from './official-c050-framework-model.mjs';

const capture=process.env.OFFICIAL_CAPTURE_RAW_DIR;
assert(capture&&path.isAbsolute(capture),'Explicit existing actual C050 raw capture directory required; no fixture fallback');
const rawPath=path.join(capture,'godot.raw.js'),realWasmPath=path.join(capture,'godot.wasm');
const raw=fs.readFileSync(rawPath),wasm=fs.readFileSync(realWasmPath),id=b=>({bytes:b.length,sha256:sha(b)});
const js=prepareOfficialRawPostprocess({js:raw,wasm}).js;
const jsPath=path.resolve('__C050_BINDING_MODEL_VIRTUAL_JS_NOT_WRITTEN__'),wasmPath=path.resolve('__C050_BINDING_MODEL_VIRTUAL_WASM_NOT_WRITTEN__');
const realRead=fs.readFileSync,realLstat=fs.lstatSync;
before(()=>{
  mock.method(fs,'readFileSync',function(file,...args){
    if(file===jsPath)return Buffer.from(js);
    if(file===wasmPath)return Buffer.from(wasm);
    return realRead.call(this,file,...args);
  });
  mock.method(fs,'lstatSync',function(file,...args){
    if(file===jsPath||file===wasmPath)return {isFile:()=>true,isSymbolicLink:()=>false};
    return realLstat.call(this,file,...args);
  });
});
after(()=>mock.restoreAll());
const adapter=prepareOfficialC050Adapter({profile:OFFICIAL_C050_PROFILE,js,wasm});
const recipe=getOfficialRecipe(OFFICIAL_C050_PROFILE),pck=Buffer.from('MANIFEST_MODEL_ONLY_NOT_A_GAME_PACKAGE');
const renderedBridge=renderStorageBridge(adapter.bridge.toString('utf8'),'glx','en');
const framework=modelOfficialC050Framework({js,bridge:renderedBridge});
function bound() {
  const engineContract={profile:OFFICIAL_C050_PROFILE,...getRecipeIdentity(OFFICIAL_C050_PROFILE),projectUsageSha256:null};
  const actual=renderManifest({renderMode:'glx',js,wasm,pck,godotVersion:recipe.pckVersion,
    transformerVersion:recipe.transformer.version,pluginVersion:recipe.plugin.version,
    runtimeOptions:{locale:'en',engineContract,...structuredClone(adapter.runtimeOptions)}});
  return {actual,report:{rendering:structuredClone(actual),officialC050Adapter:structuredClone(adapter.receipt)},
    before:{engineContract,inputs:{js:{path:jsPath,...id(js)},wasm:{path:wasmPath,...id(wasm)},pck:id(pck)},officialC050Adapter:structuredClone(adapter.receipt)},
    storedReceipt:structuredClone(adapter.receipt)};
}
const syncReport=f=>{f.report.rendering=structuredClone(f.actual);};
function audit(f,bytes=framework){return auditOfficialC050Framework({framework:bytes,...f});}

test('C050 manifest and actual complete fixed bridge bind independently without WASM compilation',()=>{
  const f=bound(),original=WebAssembly.Module;
  try {
    WebAssembly.Module=function(){throw Error('MODEL_MUST_NOT_COMPILE_WASM');};
    assert.equal(bindManifest(f.actual,f.report,f.before),f.actual);
    const result=audit(f);
    assert.equal(result.hostBridgeExact,true);assert.equal(result.sevenRulesPreserved,true);
    assert.equal(result.randomBindingsPreserved,true);assert.equal(result.executed,false);
    assert.equal(result.admission,'NOT_ADMITTED');
  } finally { WebAssembly.Module=original; }
  assert.deepEqual(id(fs.readFileSync(rawPath)),id(raw));assert.deepEqual(id(fs.readFileSync(realWasmPath)),id(wasm));
});

test('matching forged receipts in preflight, report and config cannot authenticate themselves',()=>{
  const f=bound();
  f.before.officialC050Adapter.hostAdapter.derived.sha256='0'.repeat(64);
  f.report.officialC050Adapter=structuredClone(f.before.officialC050Adapter);
  f.actual.runtimeOptions.officialC050Adapter=structuredClone(f.before.officialC050Adapter);syncReport(f);
  assert.throws(()=>bindManifest(f.actual,f.report,f.before),/recomputed official C050 preflight adapter/);
  assert.throws(()=>audit(f),/recomputed official C050 preflight adapter/);
});

test('report, runtime, stored receipt and engine-contract drift each reject',()=>{
  const changes=[
    f=>{delete f.report.officialC050Adapter;},
    f=>{f.actual.runtimeOptions.officialC050Adapter.admission='ADMITTED';syncReport(f);},
    f=>{f.before.engineContract.recipeSha256='0'.repeat(64);f.actual.runtimeOptions.engineContract=structuredClone(f.before.engineContract);syncReport(f);},
    f=>{f.actual.runtimeOptions.engineContract.profile='full';syncReport(f);},
  ];
  for(const change of changes){const f=bound();change(f);assert.throws(()=>bindManifest(f.actual,f.report,f.before));}
  const f=bound();f.storedReceipt.runtime='PASSED';assert.throws(()=>audit(f),/stored official C050 adapter receipt/);
});

test('all four actual runtime fields bind even when config and report drift together',()=>{
  for(const field of ['storageBackend','upstreamWxmemfsSha256','secureRandomMode','secureRandomBridgeSha256']) {
    const f=bound();f.actual.runtimeOptions[field]='changed';syncReport(f);
    assert.throws(()=>bindManifest(f.actual,f.report,f.before),new RegExp('official C050 runtime '+field));
  }
  const f=bound();f.before.inputs.js.sha256='0'.repeat(64);
  f.actual.engineJsSha256=f.before.inputs.js.sha256;syncReport(f);
  assert.throws(()=>bindManifest(f.actual,f.report,f.before),/C050 protected input hash js/);
});

test('output audit rejects missing, inert, duplicate, changed or differently rendered host bridge',()=>{
  const wrongLocale=renderStorageBridge(adapter.bridge.toString('utf8'),'glx','zh');
  const changed=renderedBridge.replace('secureRandom.prepare()','Promise.resolve()');assert.notEqual(changed,renderedBridge);
  for(const bridge of ['',JSON.stringify(renderedBridge)+';',renderedBridge+'\n'+renderedBridge,changed,wrongLocale])
    assert.throws(()=>audit(bound(),modelOfficialC050Framework({js,bridge})));
});

test('textually intact engine and bridge cannot move into inactive or unrelated scopes',()=>{
  const text=framework.toString('utf8');
  const afterReturn=text.replace(renderedBridge,'').replace('    return commFrameWork.ready;',
    '    return commFrameWork.ready;\n'+renderedBridge);
  assert.notEqual(afterReturn,text);
  const candidates=[
    'function neverCalled(){\n'+text+'\n}',
    text.replace(renderedBridge,'function neverStart(){\n'+renderedBridge+'\n}'),
    text.replace(renderedBridge,'if(false){\n'+renderedBridge+'\n}'),
    afterReturn,
    text.replace('var Godot =','var unrelatedGodot ='),
    text.replace('var Godot =','return commFrameWork.ready;\nvar Godot ='),
    text.replace('var Godot =','throw Error("inactive model");\nvar Godot ='),
  ];
  for(const candidate of candidates)assert.throws(()=>audit(bound(),Buffer.from(candidate)));
});

test('only the unique fixed direct converter helper is allowed in the prefix',()=>{
  const text=framework.toString('utf8'),helper=converterStackTraceHelper;
  assert.equal(text.split(helper).length,2);
  assert.equal(sha(helper),'5c5bc43f37bdd39f10a20dc3376d83528f413a13604302072620797e38451a20');
  assert.equal(audit(bound()).hostBridgeExact,true);
  const candidates=[
    text.replace(helper,''),
    text.replace(helper,helper+'\n'+helper),
    text.replace(helper,helper.replace('return error.stack.toString();','return "different";')),
    text.replace(helper,helper.replace('var error =', 'var error  =')),
    text.replace(helper,helper.replace('function jsStackTrace()', 'function renamedStackTrace()')),
    text.replace(helper,'function arbitraryHelper(){return 0;}'),
    text.replace(helper,helper+'\nfunction arbitraryHelper(){return 0;}'),
    text.replace(helper,'if(false){'+helper+'}'),
    text.replace(helper,'function hiddenHelper(){'+helper+'}'),
    text.replace(helper,'/*'+helper+'*/'),
    text.replace(helper,helper+'\nvar jsStackTrace;'),
    text.replace(helper,helper+'\njsStackTrace = function(){return "replaced";};'),
    text.replace(helper,'var {jsStackTrace}=other;\n'+helper),
    text.replace(helper,helper+'\n(()=>{jsStackTrace=function(){return "replaced";};})();'),
    text.replace(helper,helper+'\n(function(){jsStackTrace=0;})();'),
    text.replace(helper,helper+'\nvar later=function(){jsStackTrace=0;};'),
  ];
  for(const candidate of candidates){assert.notEqual(candidate,text);assert.throws(()=>audit(bound(),Buffer.from(candidate)));}
});

test('unrelated member keys and function-local names do not count as outer helper bindings',()=>{
  const text=framework.toString('utf8'),helper=converterStackTraceHelper;
  for(const extra of ['var unrelated={jsStackTrace:0}; unrelated.jsStackTrace=1;',
    'var unrelated=function(jsStackTrace){return jsStackTrace;};',
    'var unrelated=function jsStackTrace(){return jsStackTrace;};']){
    assert.equal(audit(bound(),Buffer.from(text.replace(helper,helper+'\n'+extra))).hostBridgeExact,true);
  }
  for(const extra of ['console.log(jsStackTrace);','var unrelated={jsStackTrace};','var unrelated={[jsStackTrace]:0};'])
    assert.throws(()=>audit(bound(),Buffer.from(text.replace(helper,helper+'\n'+extra))),/STACK_TRACE_BINDING/);
});

test('other profiles reject C050 receipt fields and C050 refuses legacy storage substitution',()=>{
  for(const profile of [undefined,'full','conservative','full-upstream-read-dev'])for(const site of ['before','report','runtime']) {
    const actual={engineJsSha256:'j',wasmSha256:'w',pckSha256:'p',runtimeOptions:{}};
    const report={rendering:structuredClone(actual)},before={inputs:{js:{sha256:'j'},wasm:{sha256:'w'},pck:{sha256:'p'}},...(profile?{engineContract:{profile}}:{})};
    if(site==='runtime'){actual.runtimeOptions.officialC050Adapter=undefined;report.rendering=structuredClone(actual);}
    else (site==='before'?before:report).officialC050Adapter=undefined;
    assert.throws(()=>bindManifest(actual,report,before),/unexpected official C050 adapter/);
  }
  const f=bound();f.before.storageAdapter=structuredClone(adapter.receipt);
  assert.throws(()=>bindManifest(f.actual,f.report,f.before),/cannot substitute the legacy storage adapter/);
});
