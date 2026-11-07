// Synthetic source/binary contracts only. No target JS or WASM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOfficialRawArtifacts} from '../engine/official-raw-artifacts.mjs';

const leb=n=>{const b=[];do{let v=n&127;n>>>=7;if(n)v|=128;b.push(v);}while(n);return b;};
const str=s=>[...leb(Buffer.byteLength(s)),...Buffer.from(s)];
const section=(id,data)=>[id,...leb(data.length),...data];
function binary(){return Buffer.from([0,97,115,109,1,0,0,0,
  ...section(1,[1,96,0,0]),...section(2,[1,...str('a'),...str('x'),0,0]),
  ...section(3,[1,0]),...section(7,[1,...str('run'),0,1]),...section(10,[1,2,0,11])]);}
const fixture=(body='function actual(){}',binding='actual')=>({
  js:Buffer.from(body+'\nvar wasmImports={x:'+binding+'};function getWasmImports(){return {a:wasmImports};}'),
  wasm:binary(),symbols:Buffer.from('1:run\n'),compilerStdout:Buffer.alloc(0),compilerStderr:Buffer.alloc(0)});
function rejected(input){let report;assert.throws(()=>inspectOfficialRawArtifacts(input),error=>{assert.equal(error.code,'OFFICIAL_RAW_ARTIFACTS_REJECTED');report=error.report;return true;});assert.equal(report.status,'RAW_ARTIFACTS_REJECTED_NOT_ADMITTED');assert.equal(report.admission,'NOT_ADMITTED');return report;}

test('static valid raw bytes report actual imports/exports without final-pair or host admission',()=>{
  const input=fixture(),before=Object.fromEntries(Object.entries(input).map(([k,b])=>[k,Buffer.from(b)]));
  const r=inspectOfficialRawArtifacts(input);
  assert.equal(r.status,'RAW_ARTIFACTS_INSPECTED_NOT_ADMITTED');assert.equal(r.artifactState,'RAW_CAPTURED_NOT_FINALIZED');assert.equal(r.admission,'NOT_ADMITTED');
  assert.equal(r.wasm.staticallyValidated,true);assert.equal(r.wasm.structureParsed,true);
  assert.equal(r.wasm.imports[0].module.symbol,'a');assert.equal(r.wasm.imports[0].name.symbol,'x');assert.equal(r.wasm.exports[0].name.symbol,'run');
  assert.equal(r.boundaries.wasmModuleConstructed,false);assert.equal(r.boundaries.wasmInstantiated,false);assert.equal(r.boundaries.targetJsEvaluated,false);
  assert.equal(r.issues.length,0);for(const k of Object.keys(before))assert.deepEqual(input[k],before[k]);
});
test('unresolved host import and non-function import evidence never becomes final linkage success',()=>{
  const r=inspectOfficialRawArtifacts(fixture('', 'hostEntropy'));
  assert.equal(r.status,'RAW_ARTIFACTS_INSPECTED_NOT_ADMITTED');assert(r.unknown.some(p=>p.code==='RAW_IMPORT_BINDING_NOT_PROVEN'));
  assert.equal(r.boundaries.hostBindings,'NOT_PROVEN');assert.equal(r.glue.linkage.wasmImports[0].status,'UNKNOWN_OR_UNSUPPORTED');
  const memory=fixture();memory.wasm=Buffer.from([0,97,115,109,1,0,0,0,...section(2,[1,...str('a'),...str('x'),2,0,1])]);
  const nonfunction=inspectOfficialRawArtifacts(memory);assert.equal(nonfunction.wasm.imports[0].kind,2);
  assert(nonfunction.unknown.some(p=>p.code==='RAW_IMPORT_BINDING_NOT_PROVEN'));
});
test('actual abort diagnostic stub is rejected at implementation and call positions, including unused stubs',()=>{
  for(const body of ['function actual(){abort("missing function: PRIVATE_LINK_SYMBOL");}',
    'var ABORT=false;function abort(what){ABORT=true;throw new WebAssembly.RuntimeError(what);}function actual(){abort("missing function: PRIVATE_LINK_SYMBOL");}',
    'function actual(){err("missing function: PRIVATE_LINK_SYMBOL");abort(-1);}',
    'function actual(){}function unused(){abort("undefined symbol: PRIVATE_LINK_SYMBOL");}']){
    const input=fixture(body),r=rejected(input);assert(r.issues.some(p=>p.code==='RAW_MISSING_FUNCTION_STUB'));
    const stub=r.missingStubFunctions[0];assert(stub.calls.length>0);assert(stub.function.byteEnd>stub.function.byteStart);assert.equal(stub.executed,false);
    assert(!JSON.stringify(r).includes('PRIVATE_LINK_SYMBOL'));
  }
});
test('comments, strings and ordinary error/reporting functions are not missing stubs',()=>{
  const body='// missing function: harmless comment\nfunction actual(){const text="undefined symbol: normal text";return text;}'+
    'function report(){console.error("missing function: user message");throw new Error("unresolved symbol: normal error");}';
  const r=inspectOfficialRawArtifacts(fixture(body));assert.equal(r.missingStubFunctions.length,0);assert.equal(r.issues.length,0);
  const shadow=inspectOfficialRawArtifacts(fixture('function actual(abort){abort("missing function: callback argument");}'));
  assert.equal(shadow.issues.length,0);assert(shadow.unknown.some(p=>p.code==='RAW_ABORT_BINDING_UNSUPPORTED'));
  const business=inspectOfficialRawArtifacts(fixture('function abort(message){return message;}function actual(){return abort("missing function: business text");}'));
  assert.equal(business.issues.length,0);assert(business.unknown.some(p=>p.code==='RAW_ABORT_BINDING_UNSUPPORTED'));
});
test('compiler undefined/missing diagnostics fail without publishing raw log text or paths',()=>{
  for(const key of ['compilerStdout','compilerStderr']){
    const input=fixture();input[key]=Buffer.from('warning: undefined symbol: PRIVATE_LOG_SYMBOL in /private/path\n');
    const r=rejected(input);assert.equal(r.compilerDiagnostics[0].channel,key);assert.equal(r.compilerDiagnostics[0].line,1);
    assert(!JSON.stringify(r).includes('PRIVATE_LOG_SYMBOL'));assert(!JSON.stringify(r).includes('/private/path'));
  }
  const input=fixture();input.compilerStderr=Buffer.from('warning: no output file specified, not emitting output\n');
  assert.equal(inspectOfficialRawArtifacts(input).issues.length,0);
});
test('full static validation rejects malformed code even when the structural subset parser could skip it',()=>{
  const input=fixture();input.wasm=Buffer.from([0,97,115,109,1,0,0,0,...section(1,[1,96,0,0]),...section(3,[1,0]),...section(10,[1,2,0,255])]);
  const r=rejected(input);assert.equal(r.wasm.staticallyValidated,false);assert(r.issues.some(p=>p.code==='RAW_WASM_INVALID'));
  const bad=fixture();bad.js=Buffer.from('function {');assert(rejected(bad).issues.some(p=>p.code==='RAW_JS_INVALID_SYNTAX'));
});
test('exact Buffer inputs prohibit hashes/allow lists and do not invoke accessors',()=>{
  for(const extra of [{expectedHash:'any'},{allow:['anything']}])assert.throws(()=>inspectOfficialRawArtifacts({...fixture(),...extra}),/RAW_EXACT_KEYS/);
  assert.throws(()=>inspectOfficialRawArtifacts({...fixture(),symbols:'not bytes'}),/RAW_BUFFER_DATA_INPUTS/);
  let reads=0;const input=fixture();Object.defineProperty(input,'js',{get(){reads++;throw Error('PRIVATE');}});
  assert.throws(()=>inspectOfficialRawArtifacts(input),/RAW_BUFFER_DATA_INPUTS/);assert.equal(reads,0);
});
