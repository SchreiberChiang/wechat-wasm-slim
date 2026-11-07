// Pure host-source proposal from an inspected raw pair. No target execution,
// package output, profile registration or converter admission.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import linkage from './official-glx-library/audit-linkage.cjs';
import {inspectOfficialGlue} from './official-glue-inspection.mjs';
import {proposeUnregisteredRawPostprocess} from './official-raw-postprocess.mjs';
import {prepareSecureRandomBridge} from '../convert/lib/secure-random-bridge.mjs';
import {getOfficialRecipe,OFFICIAL_C050_CAPABILITY_PROFILE} from '../convert/lib/official-engine-admission.mjs';

const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
// Same ABI and four emitted helper bodies observed in all three authenticated
// c050 raw pairs. These are the host contract, not guessed mangled export names.
const abiRows=[
 ['_glxUpdateContextId',1,0],['_glxInit',1,0],['_glxInitBufferDataAndGlState',2,0],['_glxCommandBufferFlush',0,0],
 ['_glxShowOpenData',3,0],['_glxHideOpenData',0,0],['_glxPushBindTexture',2,0],['_glxIsTexture',1,1],
 ['_glxGetBoundTexture2D',0,1],['_glxGetTextureIdMapValue',1,1],['_glxPushTexImage2DPlaceholder',0,0],
 ['_glBindTexture',2,0],['_glCompressedTexImage2D',8,0],['_glCompressedTexSubImage2D',9,0],['_glIsTexture',1,1],
 ['_glTexImage2D',9,0],['_glTexSubImage2D',9,0],['_glTexStorage2D',5,0],['_glxGetVideoTempBuffer',2,1],
 ['_glxVideoUpdateToTexture',6,0],['_glxVideoDestroy',1,0],['_free',1,0],['__Z14godot_web_mainiPPc',2,1],
 ['_main',2,1],['_malloc',1,1],['_godot_wechat_random_buffer',1,1]
];
const requiredAbi=new Map(abiRows.map(([name,p,r])=>[name,{params:Array(p).fill(127),results:Array(r).fill(127)}]));
requiredAbi.get('_glxVideoUpdateToTexture').params[5]=126; // preserve the real i64 ABI
const helperPins={
 GodotFS:{bytes:1679,sha256:'d5aeaf9508bb4dc7e1a1e5d5174bf1b584d23ce530a9a3c4f6298fe3169582f2'},
 GodotConfig:{bytes:909,sha256:'c7e9e5c12224a6f4bf5dd935286567d27287db444dfacc25d6129c164ec71c0a'},
 callMain:{bytes:351,sha256:'49e3efe94da03c487cd5d2e95ecf3b27614d832feccc56ecc4bf0740fbf85b04'},
 _godot_js_wechat_entropy_take:{bytes:621,sha256:'93fd162bab79aaca70cacf6b962f6d6a6f171fdf028de183e370e07fb0f4d3dd'}
};
let acorn;
function parser(){if(!acorn){const m={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:m,exports:m.exports});acorn=m.exports;}return acorn;}
const identifier=(n,name)=>n?.type==='Identifier'&&n.name===name;
const memberName=n=>n?.type==='MemberExpression'?n.computed?n.property?.type==='Literal'?n.property.value:null:n.property?.name:null;
const moduleProperty=(n,name)=>n?.type==='MemberExpression'&&identifier(n.object,'Module')&&memberName(n)===name;

export function proposeCustomRawHost(options){
 const proposed=proposeUnregisteredRawPostprocess(...arguments);
 const {js,wasm}=options,source=js.toString('utf8'),j=linkage.indexJs(source,parser()),binary=linkage.parseWasm(wasm);
 const captures=proposed.receipt.capturedImports,glue=inspectOfficialGlue({js,wasm});
 const imports=binary.imports,links=glue.linkage.wasmImports;
 assert.equal(links.length,imports.length,'CUSTOM_HOST_IMPORT_COUNT');
 assert.equal(j.mapping.size,imports.length,'CUSTOM_HOST_IMPORT_MAP_COUNT');
 assert.equal(new Set(imports.map(i=>i.module+':'+i.name)).size,imports.length,'CUSTOM_HOST_DUPLICATE_IMPORT');
 const capturedByImport=new Map(captures.captures.map(c=>[c.module+':'+c.import,c]));
 let capturedCount=0;
 const imported=links.map(link=>{
  assert(link.module==='a'&&link.kind===0,'CUSTOM_HOST_IMPORT_KIND');
  const mapped=j.mapping.get(link.name);assert(mapped,'CUSTOM_HOST_MISSING_IMPORT');
  const actual=imports.find(i=>i.module===link.module&&i.name===link.name);
  assert(actual&&actual.kind===0,'CUSTOM_HOST_IMPORT_BINARY');assert.deepEqual(link.signature,actual.signature);
  let proof='DECLARATIVE_FUNCTION_LINK';
  if(link.status!=='DECLARATIVE_FUNCTION_LINK_OBSERVED'){
   const capture=capturedByImport.get(link.module+':'+link.name);
   assert(capture&&link.status==='UNKNOWN_OR_UNSUPPORTED'&&link.reason==='MUTATED_ALIAS_REQUIRES_REVIEW','CUSTOM_HOST_UNRESOLVED_IMPORT');
   assert.deepEqual(link.signature,capture.signature,'CUSTOM_HOST_CAPTURE_SIGNATURE');
   assert.deepEqual(link.aliasChain,[capture.alias,capture.original],'CUSTOM_HOST_CAPTURE_ALIAS');
   assert.equal(link.definition?.utf16Start,capture.definition.start);assert.equal(link.definition?.utf16End,capture.definition.end);
   assert.equal(link.definition?.sha256,capture.definition.sha256,'CUSTOM_HOST_CAPTURE_BODY');
   capturedCount++;proof='CAPTURE_BEFORE_NATIVE_REBIND';
  }
  return {module:link.module,name:link.name,signature:link.signature,proof,definitionSha256:link.definition?.sha256??null};
 });
 assert.equal(capturedCount,7,'CUSTOM_HOST_CAPTURE_COUNT');
 const nodes=[],parents=new WeakMap(),owners=new WeakMap();
 const isFunction=n=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
 function walk(n,p,owner){nodes.push(n);if(p)parents.set(n,p);owners.set(n,owner);
  for(const v of Object.values(n))for(const c of Array.isArray(v)?v:[v])if(c?.type)walk(c,n,isFunction(n)?n:owner);
 }walk(j.ast);
 const factory=nodes.find(n=>n.start===captures.topology.factory.start&&n.end===captures.topology.factory.end&&n.type===captures.topology.factory.type);
 assert(factory?.body.type==='BlockStatement','CUSTOM_HOST_FACTORY');
 const scope=n=>j.scopeOf.get(n)||j.scopeOf.get(parents.get(n)),lookup=(n,name)=>j.lookup(scope(n),name);
 const moduleBinding=lookup(factory.body,'Module');assert(moduleBinding?.length===1,'CUSTOM_HOST_MODULE_BINDING');
 const writesTo=(name,bindings)=>nodes.filter(n=>(n.type==='AssignmentExpression'&&identifier(n.left,name)&&lookup(n.left,name)===bindings)||
  (n.type==='UpdateExpression'&&identifier(n.argument,name)&&lookup(n.argument,name)===bindings));
 const directFunction=name=>{
  const f=j.allFunctions.filter(n=>n.id?.name===name);assert(f.length===1&&parents.get(f[0])===factory.body,'CUSTOM_HOST_DIRECT_FUNCTION_'+name);
  const b=lookup(factory.body,name);assert(b?.length===1&&b[0].node===f[0]&&b[0].kind==='function','CUSTOM_HOST_FUNCTION_BINDING_'+name);
  assert.equal(writesTo(name,b).length,0,'CUSTOM_HOST_FUNCTION_REASSIGNED_'+name);return f[0];
 };
 const assign=directFunction('assignWasmExports'),nativeMapping={},nativeDetails=[],internalNativeDetails=[];
 assert(assign.params.length===1&&identifier(assign.params[0],'wasmExports'),'CUSTOM_HOST_NATIVE_PARAMETER');
 const exportBinding=lookup(assign.body,'wasmExports');
 assert(exportBinding?.length===1&&exportBinding[0].kind==='parameter','CUSTOM_HOST_NATIVE_PARAMETER_BINDING');
 for(const statement of assign.body.body){
  const outer=statement.expression;
  assert(statement.type==='ExpressionStatement'&&outer?.type==='AssignmentExpression'&&outer.operator==='=',
   'CUSTOM_HOST_NATIVE_STATEMENT'); // no early exit, conditional or unrelated call
  if(outer.left.type==='Identifier'){
   assert(outer.right?.type==='MemberExpression'&&identifier(outer.right.object,'wasmExports')&&
    lookup(outer.right.object,'wasmExports')===exportBinding,'CUSTOM_HOST_INTERNAL_NATIVE_ASSIGNMENT');
   const entry=binary.exports.find(e=>e.name===memberName(outer.right));
   assert(entry?.kind===0&&entry.index>=imports.length,'CUSTOM_HOST_INTERNAL_NATIVE_EXPORT');
   internalNativeDetails.push({name:outer.left.name,export:entry.name,index:entry.index,signature:entry.signature});continue;
  }
  assert(outer.left.type==='MemberExpression','CUSTOM_HOST_NATIVE_TARGET');
  const name=memberName(outer.left);
  assert(moduleProperty(outer.left,name)&&typeof name==='string'&&/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),'CUSTOM_HOST_NATIVE_PROPERTY');
  assert(!Object.hasOwn(nativeMapping,name),'CUSTOM_HOST_DUPLICATE_NATIVE');
  assert.equal(lookup(outer.left.object,'Module'),moduleBinding,'CUSTOM_HOST_NATIVE_MODULE_SCOPE');
  const inner=outer.right;
  assert(inner.type==='AssignmentExpression'&&inner.operator==='='&&identifier(inner.left,name)&&identifier(inner.right.object,'wasmExports'),
   'CUSTOM_HOST_NATIVE_ASSIGNMENT');
  assert.equal(lookup(inner.right.object,'wasmExports'),exportBinding,'CUSTOM_HOST_NATIVE_EXPORT_SCOPE');
  const exportName=memberName(inner.right),entry=binary.exports.find(e=>e.name===exportName);
  assert(entry?.kind===0&&entry.index>=imports.length,'CUSTOM_HOST_NATIVE_DEFINED_EXPORT');
  const bindings=lookup(factory.body,name);assert(bindings?.length&&bindings.every(b=>b.kind==='var'),'CUSTOM_HOST_NATIVE_LOCAL');
  assert.equal(lookup(inner.left,name),bindings,'CUSTOM_HOST_NATIVE_LOCAL_SCOPE');
  const writes=writesTo(name,bindings);
  assert(writes.length===1&&writes[0]===inner,'CUSTOM_HOST_NATIVE_REASSIGNED');
  if(requiredAbi.has(name))assert.deepEqual(entry.signature,requiredAbi.get(name),'CUSTOM_HOST_NATIVE_ABI_'+name);
  else assert(['__emwebxr_on_input_event','__emwebxr_on_simple_event'].includes(name),'CUSTOM_HOST_UNREVIEWED_NATIVE_EXPORT');
  nativeMapping[name]=exportName;nativeDetails.push({name,export:exportName,index:entry.index,signature:entry.signature,
   requiredByFixedContract:requiredAbi.has(name),functionSemantics:'NOT_PROVEN_BY_ABI'});
 }
 for(const name of requiredAbi.keys())assert(Object.hasOwn(nativeMapping,name),'CUSTOM_HOST_REQUIRED_EXPORT_'+name);
 assert.equal(new Set(Object.values(nativeMapping)).size,Object.keys(nativeMapping).length,'CUSTOM_HOST_NATIVE_EXPORT_ALIAS');
 const helpers={};
 for(const name of ['GodotFS','GodotConfig']){
  const bindings=lookup(factory.body,name);assert(bindings?.length===1&&bindings[0].kind==='var','CUSTOM_HOST_OBJECT_BINDING_'+name);
  assert.equal(writesTo(name,bindings).length,0,'CUSTOM_HOST_OBJECT_REASSIGNED_'+name);
  const d=bindings[0].node;assert(d.init?.type==='ObjectExpression'&&parents.get(parents.get(d))===factory.body,'CUSTOM_HOST_OBJECT_SHAPE_'+name);
  const actual=pin(Buffer.from(source.slice(d.init.start,d.init.end)));assert.deepEqual(actual,helperPins[name],'CUSTOM_HOST_OBJECT_BODY_'+name);helpers[name]=actual;
 }
 for(const name of ['callMain','_godot_js_wechat_entropy_take']){
  const f=directFunction(name),actual=pin(Buffer.from(source.slice(f.start,f.end)));
  assert.deepEqual(actual,helperPins[name],'CUSTOM_HOST_FUNCTION_BODY_'+name);helpers[name]=actual;
 }
 const hostContract=getOfficialRecipe(OFFICIAL_C050_CAPABILITY_PROFILE).hostAdapter;
 const bridge=prepareSecureRandomBridge();
 for(const key of ['base','host','lifecycle','derived'])assert.deepEqual(bridge.receipt[key],hostContract[key],'CUSTOM_HOST_BRIDGE_PIN_'+key);
 const expectedAssignments={initConfig:'Module["initConfig"]=GodotConfig.init_config',initFS:'Module["initFS"]=GodotFS.init',
  copyToFS:'Module["copyToFS"]=GodotFS.copy_to_fs',callMain:'Module["callMain"]=callMain',
  __WXSLIM_UPSTREAM_WXMEMFS__:'Module["__WXSLIM_UPSTREAM_WXMEMFS__"]='+JSON.stringify(hostContract.storage.derivedSourceSha256)};
 const bindings={};
 for(const [name,text]of Object.entries(expectedAssignments)){
  const found=j.assignments.filter(n=>moduleProperty(n.left,name));
  assert(found.length===1&&owners.get(found[0])===factory&&parents.get(parents.get(found[0]))===factory.body,'CUSTOM_HOST_PUBLIC_BINDING_'+name);
  const a=found[0];assert.equal(source.slice(a.start,a.end),text,'CUSTOM_HOST_PUBLIC_VALUE_'+name);
  assert.equal(lookup(a.left.object,'Module'),moduleBinding);bindings[name]=pin(Buffer.from(text));
  if(a.right.type==='MemberExpression')assert.equal(lookup(a.right.object,a.right.object.name),lookup(factory.body,a.right.object.name));
  if(a.right.type==='MemberExpression'){
   const objectName=a.right.object.name,property=memberName(a.right),binding=lookup(factory.body,objectName);
   const changed=nodes.some(n=>{
    const target=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'?n.argument:
     n.type==='UnaryExpression'&&n.operator==='delete'?n.argument:null;
    return target?.type==='MemberExpression'&&identifier(target.object,objectName)&&memberName(target)===property&&lookup(target.object,objectName)===binding;
   });assert(!changed,'CUSTOM_HOST_PUBLIC_HELPER_MUTATED_'+name);
  }
 }
 const entropy=directFunction('_godot_js_wechat_entropy_take');
 const entropyImports=[...j.mapping.entries()].filter(([,v])=>identifier(v.expr,'_godot_js_wechat_entropy_take'));
 assert.equal(entropyImports.length,1,'CUSTOM_HOST_ENTROPY_IMPORT');
 const entropyKey=entropyImports[0][0],entropyEntry=imports.find(i=>i.module==='a'&&i.name===entropyKey);
 assert.deepEqual(entropyEntry?.signature,{params:[127,127],results:[127]},'CUSTOM_HOST_ENTROPY_ABI');
 assert.equal(lookup(entropyImports[0][1].expr,'_godot_js_wechat_entropy_take')?.[0].node,entropy,'CUSTOM_HOST_ENTROPY_SCOPE');
 const views=directFunction('updateMemoryViews');
 const heapWrites=j.assignments.filter(a=>moduleProperty(a.left,'HEAPU8'));
 assert(heapWrites.length===1&&owners.get(heapWrites[0])===views,'CUSTOM_HOST_HEAP_WRITE_OWNER');
 assert.equal(source.slice(heapWrites[0].start,heapWrites[0].end),'Module["HEAPU8"]=HEAPU8=new Uint8Array(b)','CUSTOM_HOST_HEAP_VIEW');
 const b=lookup(heapWrites[0],'b');assert(b?.length===1&&source.slice(b[0].node.start,b[0].node.end)==='b=wasmMemory.buffer','CUSTOM_HOST_HEAP_BUFFER');
 const hostProposal={schema:'wxslim-custom-host-source-proposal-v1',status:'HOST_SOURCE_PROPOSED_NOT_ADMITTED',
  id:hostContract.id,bridge:pin(bridge.source),sourceContract:structuredClone(hostContract),
  inputs:{js:pin(js),wasm:pin(wasm)},allImportBindings:imported,nativeMapping,nativeDetails,internalNativeDetails,helpers,publicBindings:bindings,
  entropy:{import:entropyKey,signature:entropyEntry.signature,nativeBufferExport:nativeMapping._godot_wechat_random_buffer,
   nativeBufferSignature:requiredAbi.get('_godot_wechat_random_buffer'),cryptographicQuality:'NOT_TESTED'},
  storage:{backend:hostContract.storage.backend,marker:hostContract.storage.derivedSourceSha256,initializationAndCopyHelpers:'EXACT_KNOWN_BYTES',
   completeBackendBody:'REQUIRES_AUTHENTICATED_SOURCE_BUILD',persistence:'NOT_TESTED'},
  linkage:'ALL_IMPORTS_DECLARATIVE_OR_CAPTURE_ROUTE_CHECKED',nativeSemantics:'NOT_PROVEN_BY_ABI_OR_STRIPPED_SYMBOL_MAP',
  sourceProvenance:'REQUIRES_COMPLETED_CUSTOM_RAW_TASK_RECHECK',lexicalResolution:'REVIEWED_EMITTED_SHAPES_NOT_GENERAL_JS_PROOF',hostInstalled:false,converterAccepted:false,
  admission:'NOT_ADMITTED',runtime:'NOT_RUN',targetExecuted:false,wasmInstantiated:false,written:false};
 return {js:proposed.js,bridge:Buffer.from(bridge.source),receipt:{...proposed.receipt,hostProposal}};
}
