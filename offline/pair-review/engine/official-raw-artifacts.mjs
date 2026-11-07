// Raw capture inspection only. No target JS evaluation, instance, transformation,
// Brotli creation, host selection or build admission. No caller hash overrides.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import linkage from './official-glx-library/audit-linkage.cjs';
import {inspectOfficialGlue} from './official-glue-inspection.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const missing=/\b(?:undefined symbol|undefined reference|unresolved symbol|missing function|unresolved function)\b/i;
const symbol=s=>typeof s==='string'&&s.length<=160&&/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(s)?s:null;
let acorn;
function parse(source){
  if(!acorn){const module={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module,exports:module.exports});acorn=module.exports;}
  return acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true});
}
const fn=n=>n&&['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
function children(n){
  const out=[];for(const [k,v]of Object.entries(n)){if(['loc','start','end'].includes(k))continue;
    if(Array.isArray(v)){for(const child of v)if(child?.type)out.push(child);}else if(v?.type)out.push(v);}
  return out;
}
function allNodes(root){const list=[];function walk(n){list.push(n);for(const c of children(n))walk(c);}walk(root);return list;}
function ownNodes(root){const list=[];function walk(n){if(fn(n))return;list.push(n);for(const c of children(n))walk(c);}walk(root);return list;}
function messageEvidence(node){
  return ownNodes(node).filter(n=>n.type==='Literal'&&typeof n.value==='string'&&missing.test(n.value));
}

export function inspectOfficialRawArtifacts(options){
  assert.equal(arguments.length,1,'RAW_ONE_ARGUMENT');
  assert(options&&Object.getPrototypeOf(options)===Object.prototype,'RAW_OPTIONS');
  const keys=['js','wasm','symbols','compilerStdout','compilerStderr'];
  assert.deepEqual(Reflect.ownKeys(options).sort(),keys.slice().sort(),'RAW_EXACT_KEYS');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(options,key);assert(d&&Object.hasOwn(d,'value')&&Buffer.isBuffer(d.value),'RAW_BUFFER_DATA_INPUTS');}
  const {js,wasm,symbols,compilerStdout,compilerStderr}=options;
  const issues=[],unknown=[],logEvidence=[];
  const report={schema:'wxslim-official-raw-artifacts-v1',status:'RAW_ARTIFACTS_INSPECTED_NOT_ADMITTED',
    artifactState:'RAW_CAPTURED_NOT_FINALIZED',admission:'NOT_ADMITTED',
    inputs:Object.fromEntries(keys.map(k=>[k,pin(options[k])])),
    issues,unknown,compilerDiagnostics:logEvidence,
    wasm:{staticallyValidated:false,structureParsed:false,imports:[],exports:[]},
    symbols:{...pin(symbols),meaning:'Captured identity only; symbol-map correspondence requires capture-command provenance'},
    glue:null,missingStubFunctions:[],
    boundaries:{targetJsEvaluated:false,wasmValidation:'WebAssembly.validate plus existing structural parser',wasmModuleConstructed:false,
      wasmInstantiated:false,hostBindings:'NOT_PROVEN',finalPair:'NOT_PROVEN',postprocessed:false,runtime:'NOT_RUN',phone:'NOT_RUN',
      timeout:'Synchronous validation is not deadline-enforced; caller may isolate it in an owned bounded worker/process'}};
  function issue(code,evidence){issues.push({code,...evidence});}
  for(const [channel,bytes]of [['compilerStdout',compilerStdout],['compilerStderr',compilerStderr]]){
    const text=bytes.toString('utf8');let offset=0;
    for(const [index,line]of text.split('\n').entries()){
      if(missing.test(line)){
        const evidence={channel,line:index+1,utf16Start:offset,utf16End:offset+line.length,lineSha256:sha(Buffer.from(line)),decodedUtf8Lossy:!Buffer.from(text).equals(bytes)};
        logEvidence.push(evidence);issue('RAW_LINKER_MISSING_DIAGNOSTIC',evidence);
      }
      offset+=line.length+1;
    }
  }
  try { report.wasm.staticallyValidated=WebAssembly.validate(wasm); }
  catch (_) { issue('RAW_WASM_STATIC_VALIDATION_EXCEPTION',{}); }
  if(!report.wasm.staticallyValidated)issue('RAW_WASM_INVALID',{});
  let binary=null;
  if(report.wasm.staticallyValidated){
    try { binary=linkage.parseWasm(wasm);report.wasm.structureParsed=true; }
    catch (_) { issue('RAW_WASM_STRUCTURAL_PARSER_UNSUPPORTED',{}); }
  }
  const named=(value)=>({symbol:symbol(value),nameSha256:sha(Buffer.from(value))});
  if(binary){
    report.wasm.imports=binary.imports.map(p=>({module:named(p.module),name:named(p.name),kind:p.kind,signature:p.signature??null}));
    report.wasm.exports=binary.exports.map(p=>({name:named(p.name),kind:p.kind,index:p.index,signature:p.signature??null}));
    report.wasm.definedFunctionCount=binary.definedFunctionCount;
  }
  const source=js.toString('utf8');let ast=null,indexed=null;
  if(!Buffer.from(source).equals(js))issue('RAW_JS_INVALID_UTF8',{});
  else {
    try { ast=parse(source); }
    catch (_) { issue('RAW_JS_INVALID_SYNTAX',{}); }
  }
  if(ast&&binary){
    try { report.glue=inspectOfficialGlue({js,wasm}); }
    catch (_) { issue('RAW_GLUE_INSPECTOR_UNSUPPORTED',{}); }
  }
  if(ast){
    try { indexed=linkage.indexJs(source,{parse(){return ast;}}); }
    catch (_) { unknown.push({code:'RAW_JS_INDEX_UNSUPPORTED'}); }
    const position=n=>({type:n.type,utf16Start:n.start,utf16End:n.end,byteStart:Buffer.byteLength(source.slice(0,n.start)),
      byteEnd:Buffer.byteLength(source.slice(0,n.end)),line:n.loc.start.line,column:n.loc.start.column,sha256:sha(Buffer.from(source.slice(n.start,n.end)))});
    for(const f of allNodes(ast).filter(fn)){
      const body=ownNodes(f.body),calls=body.filter(n=>n.type==='CallExpression');
      const directAbort=calls.filter(n=>n.callee.type==='Identifier'&&n.callee.name==='abort');
      // Fixed Emscripten missing-JS stubs call abort(message), or emit the
      // missing-function diagnostic through err() and then call abort(-1).
      // String literals in ordinary Error construction/logging are not stubs.
      const diagnostic=calls.filter(n=>n.callee.type==='Identifier'&&['err','error'].includes(n.callee.name)&&n.arguments.some(a=>messageEvidence(a).length));
      const abortWithMessage=directAbort.filter(n=>n.arguments.some(a=>messageEvidence(a).length));
      const abortMinusOne=directAbort.filter(n=>n.arguments.length===1&&n.arguments[0].type==='UnaryExpression'&&n.arguments[0].operator==='-'&&n.arguments[0].argument.type==='Literal'&&n.arguments[0].argument.value===1);
      const candidates=[...abortWithMessage,...(diagnostic.length?abortMinusOne:[])];
      if(!candidates.length)continue;
      // Parameter/catch shadows cannot be claimed as the runtime abort helper.
      const unsafe=candidates.some(call=>{
        const bindings=indexed?.lookup(indexed.scopeOf.get(call.callee), 'abort');
        if(body.some(n=>n.type==='CatchClause'&&call.start>=n.start&&call.end<=n.end))return true;
        if(!bindings)return false;
        // A user-defined function named abort is not the generated runtime
        // helper. Only the pinned SDK's ABORT latch + throw shape is recognized;
        // every other bound callee remains unknown, rather than a linker claim.
        const resolved=indexed.resolve(call.callee,indexed.scopeOf.get(call.callee));
        if(!resolved.okay||resolved.kind!=='function')return true;
        const helper=ownNodes(resolved.node.body);
        return !helper.some(n=>n.type==='AssignmentExpression'&&n.left.type==='Identifier'&&n.left.name==='ABORT')||
          !helper.some(n=>n.type==='ThrowStatement');
      });
      if(unsafe){unknown.push({code:'RAW_ABORT_BINDING_UNSUPPORTED',function:position(f),calls:candidates.map(position)});continue;}
      const entry={classification:'ACTUAL_MISSING_STUB_ABORT_CALL',function:position(f),calls:candidates.map(position),diagnosticCalls:diagnostic.map(position),
        linkedImports:(report.glue?.linkage.wasmImports??[]).filter(p=>p.definition?.utf16Start===f.start).map(p=>({module:p.module,name:p.name,status:p.status})),
        executed:false};
      report.missingStubFunctions.push(entry);issue('RAW_MISSING_FUNCTION_STUB',entry);
    }
  }
  if(report.glue){
    for(const link of report.glue.linkage.wasmImports)if(link.status!=='DECLARATIVE_FUNCTION_LINK_OBSERVED')unknown.push({code:'RAW_IMPORT_BINDING_NOT_PROVEN',link});
  }
  if(issues.length){
    report.status='RAW_ARTIFACTS_REJECTED_NOT_ADMITTED';
    const error=new Error('OFFICIAL_RAW_ARTIFACTS_REJECTED');error.code='OFFICIAL_RAW_ARTIFACTS_REJECTED';error.report=report;throw error;
  }
  return report;
}
