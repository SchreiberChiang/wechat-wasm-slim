// Explicit c050 development host selection. No JS/WASM mutation, target evaluation or I/O writes.
import fs from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sha,md5,checkInputs,UPSTREAM_ADAPTER_REQUIRED_PROBLEM} from './inputs.mjs';
import {OFFICIAL_C050_PROFILE,OFFICIAL_C050_CONSERVATIVE_PROFILE,isOfficialC050Profile,checkFixedPair,getOfficialRecipe,getRecipeIdentity} from './official-engine-admission.mjs';
import {prepareSecureRandomBridge} from './secure-random-bridge.mjs';
import {proposeCustomRawHost} from '../../engine/custom-host-bindings.mjs';
import {CUSTOM_PAIR_PROFILE} from '../../lib/custom-pair-task.mjs';
import {renderStorageBridge} from './storage-adapter.mjs';
import {customConversionContext,readPreparedSource} from './official-custom-context.mjs';
export {OFFICIAL_C050_PROFILE} from './official-engine-admission.mjs';
export {OFFICIAL_C050_CONSERVATIVE_PROFILE,OFFICIAL_C050_CAPABILITY_PROFILE,isOfficialC050Profile} from './official-engine-admission.mjs';

const pin=b=>({bytes:b.length,sha256:sha(b)});
// wx-transformer 1.0.35's observed, non-executing prefix declaration.
// Exact bytes are intentional: a different converter/helper requires review.
const STACK_TRACE_HELPER_SHA256='5c5bc43f37bdd39f10a20dc3376d83528f413a13604302072620797e38451a20';
const TITLE_NAME='_godot_js_display_window_title_set';
const TITLE_NOOP='function _godot_js_display_window_title_set(p_data){}';
const ICON_NAME='_godot_js_display_window_icon_set';
const ICON_NOOP='function _godot_js_display_window_icon_set(p_ptr,p_len){}';
const preparedAdapters=new WeakMap();
let acorn;
function parse(source) {
  if(!acorn){const own={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:own,exports:own.exports});acorn=own.exports;}
  // Only the trusted parser runs; generated engine/framework text is never evaluated.
  return acorn.parse(source,{ecmaVersion:2022});
}
function nodes(root) {
  const result=[];
  function visit(value){if(!value||typeof value!=='object')return;if(value.type)result.push(value);for(const v of Object.values(value)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}}
  visit(root);return result;
}
function prefixUsesHelperName(prefix) {
  function visit(node,parent,key) {
    if(!node||typeof node!=='object')return false;
    // Only explicit simple local shadowing is exempt. An unshadowed closure
    // (including an IIFE) can rebind the outer helper and must be inspected.
    // Other binding forms fail closed rather than assuming a local scope.
    if(['FunctionExpression','ArrowFunctionExpression','FunctionDeclaration'].includes(node.type)&&
      (node.params.some(p=>p.type==='Identifier'&&p.name==='jsStackTrace')||
        node.type==='FunctionExpression'&&node.id?.name==='jsStackTrace'))return false;
    if(node.type==='Identifier'&&node.name==='jsStackTrace'){
      const property=(parent?.type==='MemberExpression'&&key==='property'&&!parent.computed)||
        (parent?.type==='Property'&&key==='key'&&!parent.computed&&!parent.shorthand);
      return !property;
    }
    return Object.entries(node).some(([key,value])=>Array.isArray(value)?value.some(n=>visit(n,node,key)):visit(value,node,key));
  }
  return prefix.some(n=>visit(n));
}
const id=(n,name)=>n?.type==='Identifier'&&n.name===name;
const key=n=>n?.computed?n.property?.value:n?.property?.name;
const member=(n,object,name)=>n?.type==='MemberExpression'&&id(n.object,object)&&key(n)===name;
const one=(all,predicate,label)=>{const found=all.filter(predicate);assert.equal(found.length,1,'C050_OUTPUT_UNIQUE_'+label);return found[0];};
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}

function directVariable(body,name) {
  return one(body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations),n=>id(n.id,name),'DIRECT_'+name);
}
function iifeReturnedFunction(declaration,label) {
  const call=declaration.init;
  assert(call?.type==='CallExpression'&&call.arguments.length===0&&call.callee.type==='ArrowFunctionExpression'&&call.callee.body.type==='BlockStatement','C050_SCOPE_IIFE_'+label);
  const returned=one(call.callee.body.body,n=>n.type==='ReturnStatement','RETURN_'+label);
  assert.equal(call.callee.body.body.at(-1),returned,'C050_SCOPE_RETURN_LAST_'+label);
  assert.equal(returned.argument?.type,'FunctionExpression','C050_SCOPE_RETURN_FUNCTION_'+label);
  return returned.argument;
}
function selectedEngine(body) {
  const declaration=directVariable(body,'Godot'),factory=iifeReturnedFunction(declaration,'Godot');
  assert.equal(factory.async,true,'C050_SCOPE_ASYNC_ENGINE');
  assert(factory.body.body.at(-1)?.type==='ReturnStatement'&&id(factory.body.body.at(-1).argument,'moduleRtn'),'C050_SCOPE_ENGINE_RETURN');
  return {declaration,factory};
}
function fixedImportNames(profile){
  assert(isOfficialC050Profile(profile),'C050_SCOPE_FIXED_PROFILE');
  return profile===OFFICIAL_C050_CONSERVATIVE_PROFILE?{title:'_e',icon:'_d'}:{title:'lf',icon:'ie'};
}
function scopedCritical(source,factory,importNames) {
  const body=factory.body.body,direct=body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:n.type==='ExpressionStatement'?[n.expression]:[n]);
  for(const name of ['evalCheckWxContextGlobalIdAvailable','evalBatchRenderSyncString','evalBatchRenderSyncInt','_godot_js_wechat_entropy_take','evalRegisterAfterDoFrame','assignWasmExports',TITLE_NAME,ICON_NAME])
    one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,name),'DIRECT_'+name);
  for(const name of ['__godotMinigameOriginalCommitFrame','wasmImports'])directVariable(body,name);
  one(direct,n=>n.type==='AssignmentExpression'&&id(n.left,'_emscripten_webgl_commit_frame')&&n.right.type==='FunctionExpression','DIRECT_COMMIT_WRAPPER');
  one(direct,n=>n.type==='AssignmentExpression'&&member(n.left,'Module','__WXSLIM_UPSTREAM_WXMEMFS__'),'DIRECT_STORAGE_MARKER');
  const all=nodes(factory),critical=criticalSource(source,all);
  const title=one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,TITLE_NAME),'DIRECT_TITLE');
  assert.equal(source.slice(title.start,title.end),TITLE_NOOP,'C050_TITLE_NOOP');
  const imports=directVariable(body,'wasmImports');
  assert.equal(imports.init?.type,'ObjectExpression','C050_TITLE_IMPORT_OBJECT');
  const binding=one(imports.init.properties,n=>n.type==='Property'&&!n.computed&&id(n.key,importNames.title),'TITLE_IMPORT');
  assert(binding.kind==='init'&&!binding.method&&!binding.shorthand&&id(binding.value,TITLE_NAME),'C050_TITLE_IMPORT_BINDING');
  // This fixed generated factory has exactly the declaration and lf reference.
  // Reject any additional use/rebinding instead of assuming a later assignment safe.
  const refs=all.filter(n=>id(n,TITLE_NAME));
  assert(refs.length===2&&refs.includes(title.id)&&refs.includes(binding.value),'C050_TITLE_BINDING_REFERENCES');
  const icon=one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,ICON_NAME),'DIRECT_ICON');
  assert.equal(source.slice(icon.start,icon.end),ICON_NOOP,'C050_ICON_NOOP');
  const iconBinding=one(imports.init.properties,n=>n.type==='Property'&&!n.computed&&id(n.key,importNames.icon),'ICON_IMPORT');
  assert(iconBinding.kind==='init'&&!iconBinding.method&&!iconBinding.shorthand&&id(iconBinding.value,ICON_NAME),'C050_ICON_IMPORT_BINDING');
  const iconRefs=all.filter(n=>id(n,ICON_NAME));
  assert(iconRefs.length===2&&iconRefs.includes(icon.id)&&iconRefs.includes(iconBinding.value),'C050_ICON_BINDING_REFERENCES');
  const getter=one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,'getWasmImports'),'DIRECT_IMPORT_GETTER');
  assert.equal(source.slice(getter.start,getter.end),'function getWasmImports(){return{a:wasmImports}}','C050_TITLE_IMPORT_GETTER');
  const returnedMap=one(nodes(getter),n=>id(n,'wasmImports'),'RETURNED_IMPORT_MAP');
  const mapRefs=all.filter(n=>id(n,'wasmImports'));
  assert(mapRefs.length===2&&mapRefs.includes(imports.id)&&mapRefs.includes(returnedMap),'C050_TITLE_IMPORT_MAP_REFERENCES');
  const creator=one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,'createWasm'),'DIRECT_WASM_CREATOR');
  const getCall=one(nodes(creator),n=>n.type==='CallExpression'&&id(n.callee,'getWasmImports'),'IMPORT_GETTER_CALL');
  assert.equal(getCall.arguments.length,0,'C050_TITLE_IMPORT_GETTER_ARGUMENTS');
  const getterRefs=all.filter(n=>id(n,'getWasmImports'));
  assert(getterRefs.length===2&&getterRefs.includes(getter.id)&&getterRefs.includes(getCall.callee),'C050_TITLE_IMPORT_GETTER_REFERENCES');
  const creatorNodes=nodes(creator);
  const info=one(creatorNodes,n=>n.type==='VariableDeclarator'&&id(n.id,'info')&&n.init===getCall,'IMPORT_HANDOFF_LOCAL');
  assert.equal(directVariable(creator.body.body,'info'),info,'C050_TITLE_DIRECT_HANDOFF_LOCAL');
  const explicit=one(creatorNodes,n=>n.type==='CallExpression'&&member(n.callee,'Module','instantiateWasm'),'IMPORT_HANDOFF_EXPLICIT');
  const fallback=one(creatorNodes,n=>n.type==='CallExpression'&&id(n.callee,'instantiateAsync'),'IMPORT_HANDOFF_FALLBACK');
  assert(id(explicit.arguments[0],'info')&&id(fallback.arguments[2],'info'),'C050_TITLE_IMPORT_HANDOFF_ARGUMENTS');
  const infoRefs=creatorNodes.filter(n=>id(n,'info'));
  assert(infoRefs.length===3&&infoRefs.includes(info.id)&&infoRefs.includes(explicit.arguments[0])&&infoRefs.includes(fallback.arguments[2]),'C050_TITLE_IMPORT_HANDOFF_REFERENCES');
  // Compare only the import handoff. The fixed converter inserts callbacks and
  // timing elsewhere in createWasm; those are not title-rule changes.
  // Later SDK/native behavior remains a separate runtime acceptance gate.
  critical.importGetter=source.slice(getter.start,getter.end);
  critical.importLocal=source.slice(info.start,info.end);
  critical.explicitImportHandoff=source.slice(explicit.start,explicit.end);
  critical.fallbackImportHandoff=source.slice(fallback.start,fallback.end);
  for(const [name,label] of [['evalRegisterAfterDoFrame','frameOwner'],['assignWasmExports','exportOwner']]){
    const owner=one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,name),'DIRECT_'+name);
    critical[label]=source.slice(owner.start,owner.end);
    if(label==='frameOwner')one(nodes(owner),n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&key(n.callee)==='registerAfterDoFrame','FRAME_IN_OWNER');
    else one(nodes(owner),n=>n.type==='AssignmentExpression'&&member(n.left,'Module','_godot_wechat_random_buffer'),'EXPORT_IN_OWNER');
  }
  return critical;
}

function criticalSource(source,all) {
  const predicates={
    return0:n=>n.type==='FunctionDeclaration'&&id(n.id,'evalCheckWxContextGlobalIdAvailable'),
    windowTitle:n=>n.type==='FunctionDeclaration'&&id(n.id,TITLE_NAME),
    windowIcon:n=>n.type==='FunctionDeclaration'&&id(n.id,ICON_NAME),
    shaderString:n=>n.type==='FunctionDeclaration'&&id(n.id,'evalBatchRenderSyncString'),
    shaderInt:n=>n.type==='FunctionDeclaration'&&id(n.id,'evalBatchRenderSyncInt'),
    frame:n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&key(n.callee)==='registerAfterDoFrame',
    commitOriginal:n=>n.type==='VariableDeclarator'&&id(n.id,'__godotMinigameOriginalCommitFrame'),
    commitWrapper:n=>n.type==='AssignmentExpression'&&id(n.left,'_emscripten_webgl_commit_frame')&&n.right.type==='FunctionExpression',
    entropyImport:n=>n.type==='FunctionDeclaration'&&id(n.id,'_godot_js_wechat_entropy_take'),
    entropyBinding:n=>n.type==='VariableDeclarator'&&id(n.id,'wasmImports'),
    randomExport:n=>n.type==='AssignmentExpression'&&member(n.left,'Module','_godot_wechat_random_buffer'),
    storageMarker:n=>n.type==='AssignmentExpression'&&member(n.left,'Module','__WXSLIM_UPSTREAM_WXMEMFS__'),
  };
  return Object.fromEntries(Object.entries(predicates).map(([name,predicate])=>{const n=one(all,predicate,name);return [name,source.slice(n.start,n.end)];}));
}

function checkCriticalSource(actual,expected) {
  const code='C050_OUTPUT_ENGINE_RULE_OR_RANDOM_BINDING_CHANGED';
  // Both records are produced internally from scoped AST nodes. Compare every
  // string exactly; hashes are diagnostics, never the equality decision.
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),code);
  for(const key of Object.keys(expected)) {
    assert(typeof actual[key]==='string'&&typeof expected[key]==='string',code);
    if(actual[key]!==expected[key]) {
      // Do not ask AssertionError to diff the whole minified import table.
      // Formatting an expected rejection can otherwise exhaust the Node heap.
      throw Object.assign(Error(code),{code,field:key,
        actual:pin(Buffer.from(actual[key])),expected:pin(Buffer.from(expected[key]))});
    }
  }
}

export function prepareOfficialC050Adapter({profile,js,wasm}) {
  assert(isOfficialC050Profile(profile),'C050_EXPLICIT_DEVELOPMENT_PROFILE');
  assert(Buffer.isBuffer(js)&&Buffer.isBuffer(wasm),'C050_INPUT_BUFFERS');
  // This independently enforces the exact registered prepared pair, never caller pins.
  const recipe=getOfficialRecipe(profile);checkFixedPair(js,wasm,profile);
  const host=recipe.hostAdapter;
  assert.equal(host?.schema,'wxslim-official-c050-host-adapter-v1','C050_HOST_SCHEMA');
  assert.equal(host.id,'official-c050-secure-random-and-storage-v1','C050_HOST_ID');
  assert.equal(host.secureRandomMode,'WECHAT_CTR_DRBG_V1','C050_RANDOM_MODE');
  const prepared=prepareSecureRandomBridge();
  for(const name of ['base','host','lifecycle','derived'])assert.deepEqual(prepared.receipt[name],host[name],'C050_HOST_PIN_'+name);
  const storage=JSON.parse(fs.readFileSync(new URL('../../engine/official-upstream-storage-tail.json',import.meta.url)));
  assert.equal(host.storage?.backend,'upstream-wxmemfs','C050_STORAGE_BACKEND');
  assert.equal(host.storage.derivedSourceSha256,storage.upstream.derived.sha256,'C050_STORAGE_BODY_PIN');
  const custom=profile===CUSTOM_PAIR_PROFILE?customConversionContext():null;
  const expected=custom?customOutputExpected(custom.sourceHandle()):null;
  const importNames=expected?.importNames??fixedImportNames(profile);
  const source=js.toString('utf8'),tree=parse(source),all=nodes(tree),critical=expected?.critical??scopedCritical(source,selectedEngine(tree.body).factory,importNames);
  const marker=one(all,n=>n.type==='AssignmentExpression'&&member(n.left,'Module','__WXSLIM_UPSTREAM_WXMEMFS__'),'storageMarker');
  assert.equal(marker.right.type,'Literal','C050_STORAGE_MARKER_LITERAL');
  assert.equal(marker.right.value,host.storage.derivedSourceSha256,'C050_ACTUAL_STORAGE_MARKER');
  assert.equal(critical.return0,'function evalCheckWxContextGlobalIdAvailable(){return 0}','C050_RETURN0');
  assert(critical.shaderString.includes('/*WXSLIM_SHADER_FAILURE_GLUE_V1*/'),'C050_SHADER_STRING');
  assert(critical.shaderInt.includes('/*WXSLIM_SHADER_TYPE_RETURN_GLUE_V1*/'),'C050_SHADER_INT');
  assert.equal(critical.frame,'Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();})','C050_FRAME_WRAPPER');
  assert(critical.commitWrapper.includes('context.flush()')&&critical.commitWrapper.includes('context.commit()'),'C050_COMMIT_WRAPPER');
  const receipt=frozen({schema:'wxslim-official-c050-adapter-v1',id:host.id,profile,...getRecipeIdentity(profile),
    originalJs:pin(js),effectiveJs:pin(js),wasm:pin(wasm),hostAdapter:structuredClone(host),
    derivedSource:structuredClone(storage.upstream.derived),engineBytesChanged:false,
    status:'HOST_SELECTED_STATIC_ONLY',runtime:'NOT_RUN',phone:'NOT_RUN',visual:'NOT_VERIFIED',admission:'NOT_ADMITTED'});
  const adapter={bridge:Buffer.from(prepared.source),receipt,runtimeOptions:frozen({storageBackend:'upstream-wxmemfs',
    upstreamWxmemfsSha256:host.storage.derivedSourceSha256,secureRandomMode:host.secureRandomMode,
    secureRandomBridgeSha256:host.derived.sha256,officialC050Adapter:receipt})};
  preparedAdapters.set(adapter,{critical,bridge:Buffer.from(prepared.source),receipt,importNames,hostCritical:!!custom});
  return Object.freeze(adapter);
}

export function checkOfficialC050Inputs(inp,adapter) {
  const expected=preparedAdapters.get(adapter);assert(expected,'C050_INPUT_PREPARED_ADAPTER_REQUIRED');
  assert(adapter.bridge.equals(expected.bridge),'C050_INPUT_BRIDGE_CHANGED');
  assert(isOfficialC050Profile(adapter.receipt.profile),'C050_INPUT_PROFILE');
  const recipe=getOfficialRecipe(adapter.receipt.profile);
  assert.equal(expected.receipt.recipeSha256,getRecipeIdentity(adapter.receipt.profile).recipeSha256,'C050_INPUT_RECIPE_IDENTITY');
  function verify(){
    for(const name of ['js','wasm']){
      const actual=pin(fs.readFileSync(inp[name]));
      assert.deepEqual(actual,recipe.engine[name],'C050_INPUT_ACTUAL_'+name);
      assert.deepEqual(actual,name==='js'?expected.receipt.originalJs:expected.receipt.wasm,'C050_INPUT_RECEIPT_'+name);
    }
  }
  verify();
  const checked=checkInputs(inp);
  verify(); // The generic checker re-reads inputs; changed documents never inherit admission.
  assert.equal(checked.problems.filter(problem=>problem===UPSTREAM_ADAPTER_REQUIRED_PROBLEM).length,1,'C050_INPUT_EXPECTED_STORAGE_GUARD');
  const problems=checked.problems.filter(problem=>problem!==UPSTREAM_ADAPTER_REQUIRED_PROBLEM);
  return {...checked,problems,ok:problems.length===0};
}

export function inspectOfficialC050AdapterOutput(framework,adapter,{bridge}={}) {
  const expected=preparedAdapters.get(adapter);assert(expected,'C050_OUTPUT_PREPARED_ADAPTER_REQUIRED');
  assert.deepEqual(adapter.receipt,expected.receipt,'C050_OUTPUT_RECEIPT_CHANGED');
  assert.equal(expected.receipt.recipeSha256,getRecipeIdentity(adapter.receipt.profile).recipeSha256,'C050_OUTPUT_RECIPE_IDENTITY');
  assert(Buffer.isBuffer(adapter.bridge)&&adapter.bridge.equals(expected.bridge),'C050_OUTPUT_BRIDGE_CHANGED');
  inspectOutputSource(framework,expected,bridge);
  return {schema:'wxslim-official-c050-output-audit-v1',status:'PASS_STATIC_ONLY',profile:adapter.receipt.profile,
    recipeId:adapter.receipt.recipeId,hostBridgeExact:true,sevenRulesPreserved:true,windowTitleNoop:true,windowIconNoop:true,randomBindingsPreserved:true,
    upstreamWxmemfsSha256:adapter.runtimeOptions.upstreamWxmemfsSha256,executed:false,runtime:'NOT_RUN',admission:'NOT_ADMITTED'};
}

// Shared structural comparison only. Fixed callers retain their original exact
// pair admission. Custom callers below separately prove raw source provenance.
function inspectOutputSource(framework,expected,bridge) {
  assert(Buffer.isBuffer(framework),'C050_OUTPUT_BUFFER');
  assert.equal(typeof bridge,'string','C050_OUTPUT_RENDERED_BRIDGE_REQUIRED');
  const options=/renderMode:("(?:\\.|[^"\\])*"),locale:("(?:\\.|[^"\\])*"),expectedPackBytes/.exec(bridge);
  assert(options&&['webgl','glx'].includes(JSON.parse(options[1]))&&typeof JSON.parse(options[2])==='string','C050_OUTPUT_BRIDGE_OPTIONS');
  const rendered=expected.bridge.toString('utf8').replace('__WXSLIM_RENDER_MODE__',()=>options[1]).replace('__WXSLIM_LOCALE__',()=>options[2]);
  assert.equal(bridge,rendered,'C050_OUTPUT_BRIDGE_NOT_FIXED_DERIVATION');
  const source=framework.toString('utf8');assert(Buffer.from(source).equals(framework),'C050_OUTPUT_UTF8');
  const tree=parse(source),all=nodes(tree);
  const outer=iifeReturnedFunction(directVariable(tree.body,'commFrameWork'),'commFrameWork');
  assert(!outer.async&&outer.params.length===1&&id(outer.params[0],'commFrameWork'),'C050_SCOPE_OUTER_PARAMETER');
  const body=outer.body.body,{declaration,factory}=selectedEngine(body);
  const actual=scopedCritical(source,factory,expected.importNames);
  if(expected.hostCritical)Object.assign(actual,customHostCritical(source,factory));
  checkCriticalSource(actual,expected.critical);
  // Match actual parsed sibling statements, not marker strings hidden in comments.
  const host=parse(bridge).body;assert.equal(host.length,2,'C050_OUTPUT_BRIDGE_SHAPE');
  const texts=host.map(n=>bridge.slice(n.start,n.end));
  const declarationStatement=one(body,n=>n.type==='VariableDeclaration'&&n.declarations.includes(declaration),'DIRECT_GODOT_STATEMENT');
  const at=body.indexOf(declarationStatement);
  const prefix=body.slice(0,at);
  const stackTrace=one(prefix,n=>n.type==='FunctionDeclaration'&&id(n.id,'jsStackTrace'),'PREFIX_STACK_TRACE_HELPER');
  assert.equal(sha(source.slice(stackTrace.start,stackTrace.end)),STACK_TRACE_HELPER_SHA256,'C050_SCOPE_FIXED_STACK_TRACE_HELPER');
  // The helper body is not executed when declared. No other declaration,
  // reassignment or same-scope reference may substitute a different helper.
  assert(!prefixUsesHelperName(prefix.filter(n=>n!==stackTrace)),'C050_SCOPE_STACK_TRACE_BINDING');
  assert(prefix.every(n=>n===stackTrace||['VariableDeclaration','ExpressionStatement'].includes(n.type)),'C050_SCOPE_NO_PREFIX_CONTROL_FLOW');
  assert(body[at+1]&&body[at+2]&&texts.every((text,i)=>source.slice(body[at+i+1].start,body[at+i+1].end)===text),'C050_OUTPUT_EXACT_ACTIVE_HOST_BRIDGE_REQUIRED');
  assert.equal(at+3,body.length-1,'C050_SCOPE_NO_INTERPOSED_OR_EARLY_RETURN');
  const returned=body.at(-1);
  assert(returned?.type==='ReturnStatement'&&member(returned.argument,'commFrameWork','ready'),'C050_SCOPE_READY_RETURN');
  one(all,n=>n.type==='AssignmentExpression'&&n.left?.type==='MemberExpression'&&key(n.left)==='__WXSLIM_GODOT_BRIDGE__','hostBridgeAssignment');
}

function customHostCritical(source,factory){
  const body=factory.body.body,all=nodes(factory),critical={},objects=new Map();
  for(const name of ['GodotFS','GodotConfig']){
    const d=directVariable(body,name);assert(d.init?.type==='ObjectExpression','C050_CUSTOM_HOST_OBJECT');
    assert.equal(all.filter(n=>n.type==='VariableDeclarator'&&id(n.id,name)).length,1,'C050_CUSTOM_HOST_OBJECT_SHADOW');
    critical['host_'+name]=source.slice(d.start,d.end);
    objects.set(name,d.init);
  }
  for(const name of ['callMain','updateMemoryViews']){
    const f=one(body,n=>n.type==='FunctionDeclaration'&&id(n.id,name),'CUSTOM_HOST_'+name);
    assert.equal(all.filter(n=>n.type==='FunctionDeclaration'&&id(n.id,name)).length,1,'C050_CUSTOM_HOST_FUNCTION_SHADOW');
    critical['host_'+name]=source.slice(f.start,f.end);
  }
  const protectedNames=new Set(['GodotFS','GodotConfig','callMain','updateMemoryViews']);
  for(const n of all){
    const target=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'?n.argument:n.type==='UnaryExpression'&&n.operator==='delete'?n.argument:null;
    assert(!(target?.type==='Identifier'&&protectedNames.has(target.name)),'C050_CUSTOM_HOST_REBOUND');
    if(target?.type==='MemberExpression'&&protectedNames.has(target.object?.name)){
      // Initialization/cleanup updates state inside the original helper. Its
      // entire body is byte-compared below; writes outside that body may not
      // replace a method or bypass the authenticated helper.
      const owner=objects.get(target.object.name);
      assert(owner&&n.start>=owner.start&&n.end<=owner.end,'C050_CUSTOM_HOST_MEMBER_CHANGED');
    }
  }
  for(const name of ['initConfig','initFS','copyToFS','callMain','__WXSLIM_UPSTREAM_WXMEMFS__','HEAPU8']){
    const a=one(all,n=>n.type==='AssignmentExpression'&&member(n.left,'Module',name),'CUSTOM_HOST_PUBLIC_'+name);
    if(name!=='HEAPU8')assert(body.some(n=>n.type==='ExpressionStatement'&&n.expression===a),'C050_CUSTOM_PUBLIC_DIRECT');
    critical['public_'+name]=source.slice(a.start,a.end);
  }
  return critical;
}

function customOutputExpected(handle){
  const js=handle.js,bridge=handle.bridge,host=handle.summary.derivation.hostProposal;
  assert(Buffer.isBuffer(js)&&Buffer.isBuffer(bridge),'C050_CUSTOM_SOURCE_BUFFERS');
  assert.deepEqual(pin(js),handle.summary.outputJs,'C050_CUSTOM_PREPARED_JS');
  assert.deepEqual(pin(bridge),handle.summary.outputBridge,'C050_CUSTOM_PREPARED_BRIDGE');
  const source=js.toString('utf8');assert(Buffer.from(source).equals(js),'C050_CUSTOM_UTF8');
  const tree=parse(source),factory=selectedEngine(tree.body).factory,imports=directVariable(factory.body.body,'wasmImports');
  assert(imports.init?.type==='ObjectExpression','C050_CUSTOM_IMPORT_MAP');
  const importNames={};
  for(const [label,name,params]of [['title',TITLE_NAME,[127]],['icon',ICON_NAME,[127,127]]]){
    const entry=one(imports.init.properties,p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&!p.method&&!p.shorthand&&id(p.value,name),'CUSTOM_'+label);
    assert(entry.key.type==='Identifier','C050_CUSTOM_IMPORT_KEY');
    const linked=one(host.allImportBindings,x=>x.module==='a'&&x.name===entry.key.name,'CUSTOM_LINK_'+label);
    assert.deepEqual(linked.signature,{params,results:[]},'C050_CUSTOM_IMPORT_ABI');importNames[label]=entry.key.name;
  }
  const critical=scopedCritical(source,factory,importNames);
  Object.assign(critical,customHostCritical(source,factory));
  // Observed wx-transformer 1.0.35 adds this exact finally callback. The
  // authenticated raw helper remains the fixed 351-byte function; this is an
  // expected converter edit, not permission for arbitrary helper mutations.
  assert.equal(sha(critical.host_callMain),'49e3efe94da03c487cd5d2e95ecf3b27614d832feccc56ecc4bf0740fbf85b04','C050_CUSTOM_RAW_CALL_MAIN');
  critical.host_callMain=critical.host_callMain.slice(0,-1)+' finally {\r\nif (Module.calledMainCb) {Module.calledMainCb();}}\r\n}';
  return {critical,bridge:Buffer.from(bridge),importNames,hostCritical:true};
}

// Pure source proposal for model tests and investigation. It deliberately has
// no build provenance and cannot create a registered adapter or converter input.
export function inspectCustomC050OutputProposal({rawJs,wasm,framework,bridge}){
  assert.equal(arguments.length,1,'C050_CUSTOM_SINGLE_ARGUMENT');
  assert.deepEqual(Object.keys(arguments[0]).sort(),['rawJs','wasm','framework','bridge'].sort(),'C050_CUSTOM_PROPOSAL_KEYS');
  const proposal=proposeCustomRawHost({js:rawJs,wasm});
  const expected=customOutputExpected({js:proposal.js,bridge:proposal.bridge,summary:{
    outputJs:pin(proposal.js),outputBridge:pin(proposal.bridge),derivation:proposal.receipt}});
  inspectOutputSource(framework,expected,bridge);
  return {schema:'wxslim-custom-c050-output-source-proposal-v1',status:'SOURCE_MATCH_NOT_AUTHENTICATED',
    framework:pin(framework),js:pin(proposal.js),wasm:pin(wasm),importNames:expected.importNames,
    nativeMapping:proposal.receipt.hostProposal.nativeMapping,hostBridgeExact:true,sevenRulesPreserved:true,
    hostHelpersAndExportsPreserved:true,converterCallMainCallback:'EXACT_OBSERVED_1_0_35',sourceBuildReaudited:false,converterAccepted:false,
    targetExecuted:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN',phone:'NOT_RUN'};
}

function readOrdinary(file,max){
  assert(typeof file==='string'&&path.isAbsolute(file),'C050_CUSTOM_ABSOLUTE_FILE');
  const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p),st=fs.lstatSync(file);
  assert(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=max&&norm(fs.realpathSync(file))===norm(file),'C050_CUSTOM_REGULAR_FILE');
  const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
  for(const k of ['size','dev','ino','mtimeMs','ctimeMs'])assert.equal(st[k],after[k],'C050_CUSTOM_FILE_DRIFT');
  assert.equal(bytes.length,st.size);return bytes;
}

// Component comparison, not provenance: the authenticated entry below obtains
// the expected identity from the completed source audit, not from package JSON.
export function checkC050StoredWasm(launch,compressed,expected){
  assert(launch?.useWasmCodeSplit===false&&launch.gameDir===''&&/^[0-9a-f]{15}$/.test(launch.fileMD5),'C050_CUSTOM_WHOLE_WASM_REQUIRED');
  assert(Buffer.isBuffer(compressed)&&compressed.length>0&&compressed.length<=256*1024*1024,'C050_CUSTOM_COMPRESSED_BYTES');
  assert(Number.isSafeInteger(expected?.bytes)&&expected.bytes>0&&expected.bytes<=256*1024*1024&&/^[0-9a-f]{64}$/.test(expected.sha256),'C050_CUSTOM_RAW_WASM_PIN');
  const decoded=brotliDecompressSync(compressed,{maxOutputLength:expected.bytes});
  assert.deepEqual(pin(decoded),expected,'C050_CUSTOM_PACKAGED_WASM');
  assert.equal(md5(decoded).slice(0,15),launch.fileMD5,'C050_CUSTOM_LAUNCH_WASM_ID');
  return {compressed:pin(compressed),decoded:pin(decoded),storage:'WHOLE_BROTLI',instantiated:false};
}

// Read-only post-conversion gate. A receipt supplied by the caller never grants
// admission: the default completed-task checker reaudits source/artifacts and
// regenerates prepared JS before any framework comparison. No DI via options.
export async function auditCompletedCustomC050Output(options){
  assert.equal(arguments.length,1,'C050_CUSTOM_SINGLE_ARGUMENT');
  assert.deepEqual(Object.keys(options).sort(),['preparationConfig','project'].sort(),'C050_CUSTOM_AUDIT_KEYS');
  const {preparationConfig,project}=options,prepared=await readPreparedSource(preparationConfig);
  assert(typeof project==='string'&&path.isAbsolute(project),'C050_CUSTOM_PROJECT');
  const files={framework:path.join(project,'framework.js'),manifest:path.join(project,'godot-data','render-config.json'),
    launch:path.join(project,'wx-game-kit','config.json')};
  const limits={framework:8*1024*1024,manifest:512*1024,launch:512*1024},bytes={};
  for(const [key,max]of Object.entries(limits))bytes[key]=readOrdinary(files[key],max);
  const manifest=JSON.parse(bytes.manifest),launch=JSON.parse(bytes.launch).launch?.code,o=manifest.runtimeOptions;
  assert.equal(manifest.engineJsSha256,prepared.summary.outputJs.sha256,'C050_CUSTOM_MANIFEST_JS');
  assert.equal(manifest.wasmSha256,prepared.summary.inputs.wasm.sha256,'C050_CUSTOM_MANIFEST_WASM');
  assert.equal(o?.engineContract?.profile,CUSTOM_PAIR_PROFILE,'C050_CUSTOM_MANIFEST_PROFILE');
  assert.deepEqual(o.engineContract.customSource,{taskId:prepared.summary.taskId,sourcePlanSha256:prepared.summary.sourcePlanSha256,
    preparationReceiptSha256:prepared.preparation.receipt.sha256},'C050_CUSTOM_MANIFEST_SOURCE');
  assert(['glx','webgl'].includes(manifest.requestedMode)&&typeof o.locale==='string'&&o.locale.length>0&&o.locale.length<=128,'C050_CUSTOM_HOST_OPTIONS');
  const bridge=renderStorageBridge(prepared.bridge.toString('utf8'),manifest.requestedMode,o.locale);
  assert(typeof launch?.fileMD5==='string'&&/^[0-9a-f]{15}$/.test(launch.fileMD5),'C050_CUSTOM_WASM_FILENAME');
  files.wasm=path.join(project,'wasmcode',launch.fileMD5+'.wasm.br');limits.wasm=256*1024*1024;
  bytes.wasm=readOrdinary(files.wasm,limits.wasm);
  const storedWasm=checkC050StoredWasm(launch,bytes.wasm,prepared.summary.inputs.wasm);
  const expected=customOutputExpected(prepared);inspectOutputSource(bytes.framework,expected,bridge);
  await prepared.recheck();
  for(const [key,max]of Object.entries(limits))assert(readOrdinary(files[key],max).equals(bytes[key]),'C050_CUSTOM_FINAL_FILE_DRIFT');
  return {schema:'wxslim-completed-custom-c050-output-audit-v1',status:prepared.bundled?'PASS_FINGERPRINT_STATIC_ONLY':'PASS_SOURCE_STATIC_ONLY',
    preparation:prepared.preparation,sourceTaskId:prepared.summary.taskId,sourceCommit:prepared.summary.sourceCommit,
    sourcePlanSha256:prepared.summary.sourcePlanSha256,features:prepared.summary.features,
    inputs:{js:prepared.summary.outputJs,wasm:prepared.summary.inputs.wasm},framework:pin(bytes.framework),bridge:pin(Buffer.from(bridge)),
    manifest:pin(bytes.manifest),launch:pin(bytes.launch),storedWasm,requestedMode:manifest.requestedMode,
    importNames:expected.importNames,nativeMapping:prepared.summary.derivation.hostProposal.nativeMapping,
    ...(prepared.summary.retainedFixed || prepared.summary.retainedEvidence ? {originalBuildStatus:'FAILED',sourceBasis:prepared.bundled?'BUNDLED_ENGINE_FINGERPRINT':'RETAINED_ARTIFACT_REAUDIT'} : {}),
    ...(prepared.bundled ? {pairFingerprintVerified:true} : {}),
    sourceBuildReaudited:!prepared.bundled,hostBridgeExact:true,sevenRulesPreserved:true,hostHelpersAndExportsPreserved:true,
    converterCallMainCallback:'EXACT_OBSERVED_1_0_35',
    effectiveCompilerMacros:prepared.summary.effectiveCompilerMacros,otherPackageAssets:'NOT_CHECKED_BY_THIS_ENTRY',
    converterAccepted:false,targetExecuted:false,written:false,admission:'NOT_ADMITTED',runtime:'NOT_RUN',phone:'NOT_RUN'};
}
