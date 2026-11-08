// Independent opt-in inspection. No target JS evaluation, WASM instantiation,
// build, filesystem write, package mutation, provenance or runtime admission.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {renderPersistentLibrary} from './persistent-factory-source.mjs';

const natives=['_glxInit','_glxInitBufferDataAndGlState','_glxUpdateContextId','_glxCommandBufferFlush'];
const runtimeTokens=['callMain','copyToFS','GodotJSWrapper','__godotMinigameOriginalCommitFrame','__godotMinigameWXGLXEnabled'];
const routes={initPersistentFileSession:'init_persistent',verifyPersistentFiles:'verify_persistent',persistentFileStatus:'persistent_status'};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Error(code);};
let parser;
function parse(text){
  if(!parser){const own={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:own,exports:own.exports});parser=own.exports;}
  return parser.parse(text,{ecmaVersion:2022});
}
function nodes(root){const out=[];function visit(node){if(!node||typeof node!=='object')return;if(typeof node.type==='string')out.push(node);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}visit(root);return out;}
const id=(node,name)=>node?.type==='Identifier'&&node.name===name;
function property(node){if(node?.type!=='MemberExpression'||node.optional)return null;return node.computed?node.property.type==='Literal'?node.property.value:null:node.property.name;}
const member=(node,object,name)=>node?.type==='MemberExpression'&&id(node.object,object)&&property(node)===name;
const fn=node=>node?.type==='FunctionExpression'||node?.type==='FunctionDeclaration';
function one(values,code){need(values.length===1,code);return values[0];}
function declared(all,name){return one(all.filter(n=>(n.type==='FunctionDeclaration'&&id(n.id,name))||(n.type==='VariableDeclarator'&&id(n.id,name)&&fn(n.init))), 'PERSISTENT_FUNCTION_MISSING_OR_AMBIGUOUS_'+name);}
function functionNode(node){return node.type==='VariableDeclarator'?node.init:node;}
function objectMethod(object,name){const p=one(object.properties.filter(p=>p.type==='Property'&&!p.computed&&(p.key.name??p.key.value)===name),'PERSISTENT_METHOD_MISSING_OR_AMBIGUOUS_'+name);need(p.kind==='init'&&fn(p.value),'PERSISTENT_METHOD_NOT_FUNCTION_'+name);return p.value;}

function inspectPersistentContracts(ast){
  const all=nodes(ast),exportRoutes={};
  for(const [name,target] of Object.entries(routes)){
    const assignment=one(all.filter(n=>n.type==='AssignmentExpression'&&member(n.left,'Module',name)),'PERSISTENT_EXPORT_MISSING_OR_AMBIGUOUS_'+name);
    need(assignment.operator==='='&&member(assignment.right,'GodotFS',target),'PERSISTENT_EXPORT_WRONG_ROUTE_'+name);exportRoutes[name]='GodotFS.'+target;
  }
  const fsDecl=one(all.filter(n=>n.type==='VariableDeclarator'&&id(n.id,'GodotFS')&&n.init?.type==='ObjectExpression'),'PERSISTENT_GODOTFS_OBJECT_MISSING_OR_AMBIGUOUS');
  const init=objectMethod(fsDecl.init,'init_persistent'),verify=objectMethod(fsDecl.init,'verify_persistent'),status=objectMethod(fsDecl.init,'persistent_status');
  const initNodes=nodes(init),factoryCall=one(initNodes.filter(n=>n.type==='CallExpression'&&id(n.callee,'WXSLIMPersistentCreate')),'PERSISTENT_FACTORY_CALL_MISSING_OR_AMBIGUOUS');
  need(init.params.length===1&&init.params[0].type==='Identifier'&&factoryCall.arguments.length===1&&id(factoryCall.arguments[0],init.params[0].name),'PERSISTENT_FACTORY_OPTIONS_NOT_ROUTED');
  const session=one(initNodes.filter(n=>n.type==='VariableDeclarator'&&n.init===factoryCall&&n.id.type==='Identifier'),'PERSISTENT_SESSION_BINDING_MISSING');
  need(initNodes.some(n=>n.type==='AssignmentExpression'&&member(n.left,'GodotFS','_wxslim_session')&&id(n.right,session.id.name)),'PERSISTENT_SESSION_NOT_RETAINED');
  for(const name of ['start','status'])need(initNodes.some(n=>n.type==='CallExpression'&&member(n.callee,session.id.name,name)),'PERSISTENT_SESSION_CALL_MISSING_'+name);
  for(const [method,name] of [[verify,'verify'],[status,'status']])need(nodes(method).some(n=>n.type==='CallExpression'&&property(n.callee)===name&&member(n.callee.object,'GodotFS','_wxslim_session')),'PERSISTENT_SESSION_ROUTE_MISSING_'+name);
  const factory=functionNode(declared(all,'WXSLIMPersistentCreate')),factoryNodes=nodes(factory);
  for(const dependency of ['FS','MEMFS'])need(factoryNodes.some(n=>n.type==='AssignmentExpression'&&member(n.left,'clean',dependency)&&id(n.right,dependency)),'PERSISTENT_FACTORY_DEPENDENCY_MISSING_'+dependency);
  const constantAssignment=one(factoryNodes.filter(n=>n.type==='AssignmentExpression'&&member(n.left,'clean','constants')),'PERSISTENT_CONSTANTS_INJECTION_MISSING');
  need(constantAssignment.right.type==='CallExpression'&&member(constantAssignment.right.callee,'Object','freeze')&&constantAssignment.right.arguments.length===1&&constantAssignment.right.arguments[0].type==='ObjectExpression','PERSISTENT_CONSTANTS_SHAPE_UNSUPPORTED');
  const constants=constantAssignment.right.arguments[0].properties.map(p=>{need(p.type==='Property'&&!p.computed&&p.kind==='init'&&p.value.type==='Literal'&&Number.isSafeInteger(p.value.value),'PERSISTENT_CONSTANT_NOT_INTEGER_LITERAL');return {name:p.key.name??p.key.value,value:p.value.value};});
  need(new Set(constants.map(c=>c.name)).size===constants.length,'PERSISTENT_DUPLICATE_CONSTANT');
  const rendered=renderPersistentLibrary();need(JSON.stringify(constants.map(c=>c.name).sort())===JSON.stringify(rendered.constants),'PERSISTENT_CONSTANT_NAMES_MISMATCH');
  const chain=[['transportFactory','createPersistentFileTransport',null,null],['backendFactory','createPersistentMemfs','transportFactory','createTransport'],['sessionFactory','createPersistentSession','backendFactory','createBackend']];
  for(const [binding,implementation,dependency,alias] of chain){
    const d=one(factoryNodes.filter(n=>n.type==='VariableDeclarator'&&id(n.id,binding)),'PERSISTENT_FACTORY_BINDING_MISSING_'+binding),call=d.init;
    need(call?.type==='CallExpression'&&fn(call.callee),'PERSISTENT_FACTORY_WRAPPER_UNSUPPORTED_'+binding);
    const inner=nodes(call.callee);declared(inner,implementation);
    need(call.callee.body.body.at(-1)?.type==='ReturnStatement'&&member(call.callee.body.body.at(-1).argument,'module','exports'),'PERSISTENT_FACTORY_EXPORT_RETURN_MISSING_'+binding);
    need(inner.some(n=>n.type==='AssignmentExpression'&&member(n.left,'module','exports')&&id(n.right,implementation)),'PERSISTENT_FACTORY_EXPORT_MISSING_'+binding);
    if(dependency){
      need(call.arguments.length===1&&id(call.arguments[0],dependency)&&call.callee.params.length===1&&call.callee.params[0].type==='Identifier','PERSISTENT_FACTORY_CHAIN_MISMATCH_'+binding);
      need(inner.some(n=>n.type==='VariableDeclarator'&&id(n.id,alias)&&id(n.init,call.callee.params[0].name)),'PERSISTENT_FACTORY_ALIAS_MISSING_'+binding);
    }else need(call.arguments.length===0&&call.callee.params.length===0,'PERSISTENT_FACTORY_TRANSPORT_ARGUMENT');
  }
  need(factory.body.body.at(-1)?.type==='ReturnStatement'&&factory.body.body.at(-1).argument?.type==='CallExpression'&&id(factory.body.body.at(-1).argument.callee,'sessionFactory')&&factory.body.body.at(-1).argument.arguments.length===1&&id(factory.body.body.at(-1).argument.arguments[0],'clean'),'PERSISTENT_FACTORY_SESSION_RETURN_MISSING');
  const returnZero=functionNode(declared(all,'evalCheckWxContextGlobalIdAvailable'));
  need(returnZero.body.body.length===1&&returnZero.body.body[0].type==='ReturnStatement'&&returnZero.body.body[0].argument?.type==='Literal'&&returnZero.body.body[0].argument.value===0,'PERSISTENT_GLOBAL_ID_RETURN_ZERO_REQUIRED');
  return {exportRoutes,factory:'WXSLIMPersistentCreate',dependencyNames:rendered.deps,closureDependencies:['FS','MEMFS'],constants,
    factoryChain:chain.map(([binding,implementation,dependency])=>({binding,implementation,dependency})),
    ownedSourceInputs:rendered.inputs,globalIdReturnZero:true,
    evidence:'AST export/call/dependency routing only; complete compiled component equivalence is not established.',
    dependencyMetadata:'__deps is build-time library metadata; final-glue FS/MEMFS references are inspected, not an invented emitted __deps token.'};
}

export function inspectPersistentPairBuffers({glue,wasm,compressed}){
  for(const [name,b] of Object.entries({glue,wasm,compressed}))need(Buffer.isBuffer(b)&&b.length>0,'PERSISTENT_PAIR_BUFFER_REQUIRED_'+name);
  need(zlib.brotliDecompressSync(compressed).equals(wasm),'Compressed/raw WASM mismatch');
  const text=glue.toString('utf8');need(Buffer.from(text).equals(glue),'PERSISTENT_GLUE_UTF8_REQUIRED');
  new vm.Script(text,{filename:'persistent-pair-glue.js'});const ast=parse(text),all=nodes(ast);
  need(!/missing function:|unresolved symbol:/i.test(text),'Generated missing-function placeholder');
  // Missing new exports is the primary diagnostic for a genuine historical
  // pair. Old WXMEMFS evidence is not rewritten or accepted as new persistence.
  const persistence=inspectPersistentContracts(ast);
  need(!text.includes('WXMEMFS'),'PERSISTENT_LEGACY_WXMEMFS_FORBIDDEN');
  need(!text.includes('wx-fs-mount'),'PERSISTENT_LEGACY_FS_MOUNT_REWRITE_FORBIDDEN');
  for(const token of runtimeTokens)need(text.includes(token),'Missing runtime token: '+token);
  const module=new WebAssembly.Module(wasm),imports=WebAssembly.Module.imports(module),exports=WebAssembly.Module.exports(module);
  const importMap=one(all.filter(n=>n.type==='VariableDeclarator'&&id(n.id,'wasmImports')),'Missing or ambiguous JS import map');
  need(importMap.init?.type==='ObjectExpression','Invalid JS import map');const bindings={};
  for(const p of importMap.init.properties){
    need(p.type==='Property'&&!p.computed&&p.kind==='init'&&!p.method&&p.key.type==='Identifier'&&p.value.type==='Identifier'&&!Object.hasOwn(bindings,p.key.name),'Invalid or duplicate JS import binding');
    Object.defineProperty(bindings,p.key.name,{value:p.value.name,enumerable:true});
  }
  for(const item of imports)need(item.module==='a'&&Object.hasOwn(bindings,item.name),'Missing JS binding for WASM import: '+item.module+'.'+item.name);
  const functions=new Set(exports.filter(e=>e.kind==='function').map(e=>e.name)),nativeMapping={};
  for(const name of natives){
    const assignment=one(all.filter(n=>n.type==='AssignmentExpression'&&member(n.left,'Module',name)),'Native export mapping missing/ambiguous: '+name),rhs=assignment.right;
    need(assignment.operator==='='&&rhs?.type==='AssignmentExpression'&&rhs.operator==='='&&id(rhs.left,name)&&rhs.right?.type==='MemberExpression'&&id(rhs.right.object,'wasmExports')&&typeof property(rhs.right)==='string'&&functions.has(property(rhs.right)),'Native export mapping missing/ambiguous: '+name);
    nativeMapping[name]=property(rhs.right);
  }
  const submission={afterFrameInvokesNativeFlush:/registerAfterDoFrame\(function\(\)\{return Module\._glxCommandBufferFlush\(\);?\}\)/.test(text),batchRenderAsyncPresent:text.includes('Module.wxContextGlobal.batchRenderAsync('),swapWindowPresent:text.includes('Module.wxContextGlobal.swapWindow(')};
  need(Object.values(submission).every(Boolean),'Expected native submission glue missing');
  return {schema:'wxslim-persistent-pair-static-v1',inspectedAt:new Date().toISOString(),staticChecks:'PASS_OBSERVED_CONTRACTS_ONLY',admission:'NOT_ADMITTED',
    inputs:Object.fromEntries(Object.entries({glue,wasm,compressed}).map(([name,b])=>[name,{bytes:b.length,sha256:hash(b)}])),
    imports,exports,bindings,nativeMapping,submission,runtimeTokens,persistence,legacyFilesystem:{wxmemfsAbsent:true,oldMountRewriteAbsent:true},
    wasmMarkerPresence:{glx0111:wasm.includes(Buffer.from('0.1.11')),glx20251205:wasm.includes(Buffer.from('2025.12.05'))},
    remainingGates:['Build an explicitly authorized candidate and inspect its actual SDK-emitted factory form; current structural parser forms are unconfirmed by a candidate build.',
      'Bind complete source/component, patch, toolchain, GLX archive and output hashes in a separate build-provenance audit; source hashes here identify current reviewed inputs, not compiler consumption.',
      'Review numeric cDefs and complete optimized component equivalence; dependency/name routing alone does not prove the implementation.',
      'Verify C++ FileAccess error propagation, import/native calling conventions and actual host initialization without legacy fallback.',
      'Run authorized device write/read/failure/lifecycle/restart acceptance with exact package and session identities; no atomicity or power-loss claim follows from readback.'],
    scope:'Brotli byte pairing, JS parse/AST contracts, WASM module validation/import/export names and static GLX submission mappings only. No executable glue evaluation or WASM instantiation.',
    compiledFormConfirmed:false,componentImplementationEquivalent:'NOT_VERIFIED',initialization:'not_run',persistentSave:'not_verified',visibleRendering:'not_verified',phone:'not_run',restartRecovery:'NOT_TESTED',durability:'NOT_PROVEN'};
}
