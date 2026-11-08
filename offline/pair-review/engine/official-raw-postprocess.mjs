// Source preparation for closed c050 full/conservative/capability raw pairs. Does not write files,
// evaluate the generated target, register an engine, or run a converter.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {inspectCapturedImports,inspectConservativeCapturedImports,inspectUnregisteredCapturedImports} from './official-captured-imports.mjs';
import linkage from './official-glx-library/audit-linkage.cjs';
import {inspectOfficialGraphicsInput} from './official-graphics-postprocess.mjs';
import {identifyOfficialRawPair} from './official-raw-identities.mjs';
export {OFFICIAL_FULL_RAW_PAIR,OFFICIAL_CONSERVATIVE_RAW_PAIR,OFFICIAL_CAPABILITY_RAW_PAIR} from './official-raw-identities.mjs';

const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const FRAME='Module.wxContextGlobal.registerAfterDoFrame(Module._glxCommandBufferFlush)';
const DYNAMIC='Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();})';
const IMPORTS='var wasmImports={';
const COMMIT='var __godotMinigameOriginalCommitFrame=_emscripten_webgl_commit_frame;'+
 '_emscripten_webgl_commit_frame=function(){var result=__godotMinigameOriginalCommitFrame();'+
 'var context=typeof GL!=="undefined"&&GL.currentContext&&GL.currentContext.GLctx;'+
 'if(context){if(typeof context.flush==="function"){context.flush()}if(typeof context.commit==="function"){context.commit()}}return result;};';
const ID='function evalCheckWxContextGlobalIdAvailable(){if(typeof Module!=="undefined"&&Module.wxContextGlobal&&typeof Module.wxContextGlobal.fetchAndIncId==="function"){return 1}return 0}';
const ZERO='function evalCheckWxContextGlobalIdAvailable(){return 0}';
// Mini Game HTMLDocument.title is read-only. Preserve the prior successful
// port's exact no-op, including its void ABI; do not modify the global DOM.
const TITLE='function _godot_js_display_window_title_set(p_data){document.title=GodotRuntime.parseString(p_data)}';
const TITLE_NOOP='function _godot_js_display_window_title_set(p_data){}';
// Mini Game has no webpage favicon. Retain the imported void ABI only.
const ICON="function _godot_js_display_window_icon_set(p_ptr,p_len){let link=document.getElementById(\"-gd-engine-icon\");const old_icon=GodotDisplay.window_icon;if(p_ptr){if(link===null){link=document.createElement(\"link\");link.rel=\"icon\";link.id=\"-gd-engine-icon\";document.head.appendChild(link)}const png=new Blob([GodotRuntime.heapSlice(HEAPU8,p_ptr,p_len)],{type:\"image/png\"});GodotDisplay.window_icon=URL.createObjectURL(png);link.href=GodotDisplay.window_icon}else{if(link){link.remove()}GodotDisplay.window_icon=null}if(old_icon){URL.revokeObjectURL(old_icon)}}";
const ICON_NOOP="function _godot_js_display_window_icon_set(p_ptr,p_len){}";
const helperPins=[
 {path:'./shader-failure/instrument-glue.cjs',sha256:'5778bd25ed34a050bd2285b53886953528299e9ceb677573aee5a2b8efff76d0'},
 {path:'./shader-type-return/instrument-glue.cjs',sha256:'f60329e242d84b3dcc24fb579812de6538a148ebf6c4904f2af2cac34c607c7c'}
];
function unique(source,needle){const at=source.indexOf(needle);assert(at>=0&&source.indexOf(needle,at+needle.length)<0,'OFFICIAL_POSTPROCESS_UNIQUE_ANCHOR');return at;}
function helpers(){return helperPins.map(h=>{
 const file=new URL(h.path,import.meta.url),bytes=fs.readFileSync(file);
 assert.equal(pin(bytes).sha256,h.sha256,'OFFICIAL_POSTPROCESS_HELPER_DRIFT');
 // Execute only the authenticated local helper bytes in a fresh context, never
 // a mutable require-cache export or the target engine. CLI I/O is unavailable.
 const localModule={exports:{}};
 const localRequire=name=>{assert(['node:fs','node:path'].includes(name),'OFFICIAL_POSTPROCESS_HELPER_IMPORT');return Object.freeze({});};
 localRequire.main=null;
 const factory=new vm.Script('(function(require,module,exports){'+bytes.toString('utf8')+'\n})',
  {filename:h.path}).runInNewContext({},{timeout:1000});
 factory(localRequire,localModule,localModule.exports);
 assert.equal(typeof localModule.exports.instrumentGlue,'function','OFFICIAL_POSTPROCESS_HELPER_API');
 return {identity:{path:'engine/'+h.path.slice(2),...pin(bytes)},impl:localModule.exports};
});}

// Read-only inspection for a future custom build. Whole-byte fixed admission
// below is deliberately unchanged; these locations alone cannot admit a pair.
export function inspectUnregisteredRawPostprocess(options){
 const captured=inspectUnregisteredCapturedImports(...arguments);
 assert.equal(captured.status,'CAPTURE_ROUTE_INSPECTED_NOT_ADMITTED','UNREGISTERED_POSTPROCESS_CAPTURE');
 const {js,wasm}=options,source=js.toString('utf8'),graphic=inspectOfficialGraphicsInput(js),tools=helpers();
 const parserModule={exports:{}};
 vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:parserModule,exports:parserModule.exports});
 const j=linkage.indexJs(source,parserModule.exports),binary=linkage.parseWasm(wasm);
 const nodes=[],parents=new WeakMap();
 function walk(n,p){
  nodes.push(n);if(p)parents.set(n,p);
  for(const v of Object.values(n))for(const c of Array.isArray(v)?v:[v])if(c?.type)walk(c,n);
 }
 walk(j.ast);
 const topology=captured.inspection.topology;
 const factory=nodes.find(n=>n.start===topology.factory.start&&n.end===topology.factory.end&&n.type===topology.factory.type);
 assert(factory?.async&&factory.body.type==='BlockStatement','UNREGISTERED_POSTPROCESS_FACTORY');
 const scope=n=>j.scopeOf.get(n)||j.scopeOf.get(parents.get(n));
 const lookup=(n,name)=>j.lookup(scope(n),name);
 const reference=name=>nodes.filter(n=>n.type==='Identifier'&&n.name===name&&
  !(parents.get(n)?.type==='MemberExpression'&&parents.get(n).property===n&&!parents.get(n).computed)&&
  !(parents.get(n)?.type==='Property'&&parents.get(n).key===n&&!parents.get(n).computed&&!parents.get(n).shorthand));
 const moduleBinding=lookup(factory.body,'Module');
 assert(moduleBinding?.length===1&&moduleBinding[0].kind==='var'&&
  parents.get(parents.get(moduleBinding[0].node))===factory.body,'UNREGISTERED_POSTPROCESS_MODULE_BINDING');
 const position=n=>({type:n.type,inputByteOffset:Buffer.byteLength(source.slice(0,n.start)),bytes:Buffer.byteLength(source.slice(n.start,n.end)),sha256:pin(Buffer.from(source.slice(n.start,n.end))).sha256});
 const directFunction=(name,text)=>{
  const defs=j.allFunctions.filter(f=>f.id?.name===name),bindings=lookup(factory.body,name);
  assert(defs.length===1&&parents.get(defs[0])===factory.body,'UNREGISTERED_POSTPROCESS_DIRECT_FUNCTION_'+name);
  const def=defs[0];
  assert.equal(source.slice(def.start,def.end),text,'UNREGISTERED_POSTPROCESS_FUNCTION_SHAPE_'+name);
  assert.equal(unique(source,text),def.start,'UNREGISTERED_POSTPROCESS_FUNCTION_LOCATION_'+name);
  assert(bindings?.length===1&&bindings[0].node===def,'UNREGISTERED_POSTPROCESS_FUNCTION_BINDING_'+name);
  for(const n of reference('Module').filter(n=>n.start>=def.start&&n.end<=def.end))
   assert.equal(lookup(n,'Module'),moduleBinding,'UNREGISTERED_POSTPROCESS_SHADOWED_MODULE');
  return {def,bindings};
 };
 const mappedImport=(name,bindings,declaration,params,results)=>{
  const mapped=[...j.mapping.entries()].filter(([,v])=>v.expr.type==='Identifier'&&v.expr.name===name);
  assert.equal(mapped.length,1,'UNREGISTERED_POSTPROCESS_SINGLE_IMPORT_'+name);
  const [key,value]=mapped[0],refs=reference(name);
  assert(refs.length===2&&refs.includes(declaration)&&refs.includes(value.expr)&&lookup(value.expr,name)===bindings,
   'UNREGISTERED_POSTPROCESS_REFERENCE_'+name);
  const imported=binary.imports.filter(v=>v.module==='a'&&v.name===key);
  assert.equal(imported.length,1,'UNREGISTERED_POSTPROCESS_WASM_IMPORT_'+name);
  assert.equal(imported[0].kind,0,'UNREGISTERED_POSTPROCESS_FUNCTION_IMPORT_'+name);
  assert.deepEqual(imported[0].signature,{params,results},'UNREGISTERED_POSTPROCESS_IMPORT_SIGNATURE_'+name);
  return {module:'a',name:key,signature:imported[0].signature};
 };
 const rules=[
  ...tools.map(h=>({rule:h.impl.MARKER,name:h.impl.ANCHOR.slice(9,h.impl.ANCHOR.indexOf('(')),text:h.impl.ANCHOR,params:[127,127],results:[127]})),
  {rule:'official-global-id-return0',name:'evalCheckWxContextGlobalIdAvailable',text:ID,params:[],results:[127]},
  {rule:'disable-window-title',name:'_godot_js_display_window_title_set',text:TITLE,params:[127],results:[]},
  {rule:'disable-window-icon',name:'_godot_js_display_window_icon_set',text:ICON,params:[127,127],results:[]}
 ];
 const sites=rules.map(r=>{
  const {def,bindings}=directFunction(r.name,r.text);
  return {rule:r.rule,target:r.name,...position(def),import:mappedImport(r.name,bindings,def.id,r.params,r.results)};
 });
 const registerText='function evalRegisterAfterDoFrame(){if(Module&&Module["wxContextGlobal"]){console.log("🚀 registerAfterDoFrame register");'+FRAME+'}}';
 const register=directFunction('evalRegisterAfterDoFrame',registerText);
 const frame=nodes.filter(n=>n.type==='CallExpression'&&n.start===graphic.frame&&source.slice(n.start,n.end)===FRAME);
 assert.equal(frame.length,1,'UNREGISTERED_POSTPROCESS_FRAME_NODE');
 assert(frame[0].start>register.def.start&&frame[0].end<register.def.end,'UNREGISTERED_POSTPROCESS_FRAME_OWNER');
 sites.push({rule:'wx-glx-after-do-frame-wrapper',target:'evalRegisterAfterDoFrame',...position(frame[0]),
  import:mappedImport('evalRegisterAfterDoFrame',register.bindings,register.def.id,[],[])});
 const commitName='_emscripten_webgl_commit_frame',originalName='_emscripten_webgl_do_commit_frame';
 const commit=lookup(factory.body,commitName),original=lookup(factory.body,originalName);
 assert(commit?.length===1&&commit[0].kind==='var'&&original?.length===1&&original[0].kind==='var','UNREGISTERED_POSTPROCESS_COMMIT_BINDING');
 const decl=commit[0].node,statement=parents.get(decl),originalDecl=original[0].node,originalStatement=parents.get(originalDecl);
 assert(parents.get(statement)===factory.body&&parents.get(originalStatement)===factory.body&&
  statement.declarations.length===1&&originalStatement.declarations.length===1&&
  decl.init?.type==='Identifier'&&decl.init.name===originalName&&lookup(decl.init,originalName)===original,
  'UNREGISTERED_POSTPROCESS_COMMIT_ALIAS');
 const originalText='var _emscripten_webgl_do_commit_frame=()=>{if(!GL.currentContext||!GL.currentContext.GLctx){return-3}if(!GL.currentContext.attributes.explicitSwapControl){return-3}return 0};';
 assert.equal(source.slice(originalStatement.start,originalStatement.end),originalText,'UNREGISTERED_POSTPROCESS_COMMIT_BODY');
 const originalRefs=reference(originalName);
 assert(originalRefs.length===2&&originalRefs.includes(originalDecl.id)&&originalRefs.includes(decl.init),'UNREGISTERED_POSTPROCESS_COMMIT_REFERENCE');
 const glBinding=lookup(factory.body,'GL');
 assert(glBinding?.length===1,'UNREGISTERED_POSTPROCESS_GL_BINDING');
 for(const n of reference('GL').filter(n=>n.start>=originalDecl.start&&n.end<=originalDecl.end))
  assert.equal(lookup(n,'GL'),glBinding,'UNREGISTERED_POSTPROCESS_SHADOWED_GL');
 const imports=j.imports[0],importsStatement=parents.get(imports);
 assert(importsStatement.type==='VariableDeclaration'&&importsStatement.kind==='var'&&importsStatement.declarations.length===1&&
  parents.get(importsStatement)===factory.body&&importsStatement.start===graphic.imports&&originalStatement.start<statement.start&&statement.end<importsStatement.start,
  'UNREGISTERED_POSTPROCESS_COMMIT_INSERTION');
 sites.push({rule:'commit-frame-wrapper',target:commitName,...position(importsStatement),insertOnly:true,
  original:position(originalStatement),alias:position(statement),
  import:mappedImport(commitName,commit,decl.id,[],[127])});
 sites.sort((a,b)=>a.inputByteOffset-b.inputByteOffset);
 assert.equal(sites.length,7);
 return {schema:'wxslim-unregistered-postprocess-inspection-v1',status:'EDIT_SITES_INSPECTED_NOT_ADMITTED',
  inputs:{js:pin(js),wasm:pin(wasm)},sites,capturedImports:captured,helperSources:tools.map(t=>t.identity),
  sourceRecipe:'NOT_PROVEN',library:'NOT_PROVEN',allImports:'NOT_PROVEN',hostContract:'NOT_PROVEN',
  admission:'NOT_ADMITTED',runtime:'NOT_RUN',targetJsEvaluated:false,wasmInstantiated:false,outputsWritten:false};
}

export function prepareOfficialRawPostprocess(options){
 assert.equal(arguments.length,1,'OFFICIAL_POSTPROCESS_ONE_ARGUMENT');
 assert(options&&Object.getPrototypeOf(options)===Object.prototype,'OFFICIAL_POSTPROCESS_OPTIONS');
 assert.deepEqual(Reflect.ownKeys(options).sort(),['js','wasm'],'OFFICIAL_POSTPROCESS_EXACT_KEYS');
 for(const name of ['js','wasm'])assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,name),'value'),'OFFICIAL_POSTPROCESS_DATA_INPUTS');
 const {js,wasm}=options;
 assert(Buffer.isBuffer(js)&&Buffer.isBuffer(wasm),'OFFICIAL_POSTPROCESS_BUFFERS');
 const {profile,pair}=identifyOfficialRawPair({js,wasm});
 const captured=(profile==='conservative'?inspectConservativeCapturedImports:inspectCapturedImports)({js,wasm});
 return deriveRawSource({js,wasm,profile,pair,captured});
}

// Pure candidate derivation for custom-build checking. It is intentionally not
// accepted by the fixed preparer/converter and provides no provenance claim.
export function proposeUnregisteredRawPostprocess(options){
 const proof=inspectUnregisteredRawPostprocess(...arguments);
 const {js,wasm}=options;
 const result=deriveRawSource({js,wasm,profile:'unregistered',pair:{sourceCommit:null,wasm:pin(wasm)},captured:proof.capturedImports.inspection});
 assert.deepEqual(result.receipt.input,proof.inputs.js,'UNREGISTERED_POSTPROCESS_INPUT_CHANGED');
 assert.deepEqual(result.receipt.wasm,proof.inputs.wasm,'UNREGISTERED_POSTPROCESS_INPUT_CHANGED');
 for(const edit of result.receipt.edits){
  const site=proof.sites.find(s=>s.rule===edit.rule);
  assert(site&&site.inputByteOffset===edit.inputByteOffset,'UNREGISTERED_POSTPROCESS_EDIT_LOCATION_CHANGED');
  if(site.insertOnly)assert.equal(edit.removed.bytes,0);
  else assert.deepEqual(edit.removed,{bytes:site.bytes,sha256:site.sha256},'UNREGISTERED_POSTPROCESS_EDIT_CONTENT_CHANGED');
 }
 return {js:result.js,receipt:{...result.receipt,schema:'wxslim-unregistered-raw-source-proposal-v1',
  status:'SOURCE_PROPOSED_NOT_ADMITTED',editSiteInspection:proof,sourceRecipe:'NOT_PROVEN',library:'NOT_PROVEN',allImports:'NOT_PROVEN'}};
}

function deriveRawSource({js,wasm,profile,pair,captured}){
 const source=js.toString('utf8');assert(Buffer.from(source).equals(js),'OFFICIAL_POSTPROCESS_UTF8');
 new vm.Script(source,{filename:'official-raw-not-executed.js'});
 assert.equal(captured.status,'SOURCE_VALUE_CAPTURE_PROVEN','OFFICIAL_POSTPROCESS_CAPTURE_UNPROVEN');
 assert.equal(captured.captures.length,7,'OFFICIAL_POSTPROCESS_CAPTURE_COUNT');
 const graphic=inspectOfficialGraphicsInput(js),tools=helpers(),edits=[];
 const add=(rule,remove,insert,start=unique(source,remove))=>{
  assert.equal(source.slice(start,start+remove.length),remove,'OFFICIAL_POSTPROCESS_ANCHOR');
  edits.push({rule,inputByteOffset:Buffer.byteLength(source.slice(0,start)),remove:Buffer.from(remove),insert:Buffer.from(insert)});
 };
 add('wx-glx-after-do-frame-wrapper',FRAME,DYNAMIC,graphic.frame);
 add('commit-frame-wrapper','',COMMIT,graphic.imports);
 for(const helper of tools){
  const {MARKER,ANCHOR,instrumentGlue}=helper.impl;
  assert(!source.includes(MARKER),'OFFICIAL_POSTPROCESS_ALREADY_INSTRUMENTED');
  const inserted=instrumentGlue(ANCHOR);
  assert.throws(()=>instrumentGlue(inserted));
  add(MARKER,ANCHOR,inserted);
 }
 assert(!source.includes(ZERO),'OFFICIAL_POSTPROCESS_ALREADY_RETURN_ZERO');
 add('official-global-id-return0',ID,ZERO);
 add('disable-window-title',TITLE,TITLE_NOOP);
 add('disable-window-icon',ICON,ICON_NOOP);
 edits.sort((a,b)=>a.inputByteOffset-b.inputByteOffset);
 const chunks=[];let cursor=0,delta=0;
 for(const e of edits){
  assert(e.inputByteOffset>=cursor,'OFFICIAL_POSTPROCESS_OVERLAP');
  assert(js.subarray(e.inputByteOffset,e.inputByteOffset+e.remove.length).equals(e.remove));
  chunks.push(js.subarray(cursor,e.inputByteOffset),e.insert);cursor=e.inputByteOffset+e.remove.length;
  e.outputByteOffset=e.inputByteOffset+delta;delta+=e.insert.length-e.remove.length;
 }
 chunks.push(js.subarray(cursor));const output=Buffer.concat(chunks);
 let reversed=output;
 for(const e of [...edits].reverse()){
  assert(reversed.subarray(e.outputByteOffset,e.outputByteOffset+e.insert.length).equals(e.insert));
  reversed=Buffer.concat([reversed.subarray(0,e.outputByteOffset),e.remove,reversed.subarray(e.outputByteOffset+e.insert.length)]);
 }
 assert(reversed.equals(js),'OFFICIAL_POSTPROCESS_OUTSIDE_EDITS');
 new vm.Script(output.toString('utf8'),{filename:'official-prepared-not-executed.js'});
 assert.deepEqual(pin(wasm),pair.wasm);
 return {js:output,receipt:{schema:'wxslim-official-raw-postprocess-v1',status:'SOURCE_PREPARATION_NOT_RUNTIME_ADMITTED',
  sourceCommit:pair.sourceCommit,profile,input:pin(js),wasm:pin(wasm),output:pin(output),
  edits:edits.map(e=>({rule:e.rule,inputByteOffset:e.inputByteOffset,outputByteOffset:e.outputByteOffset,removed:pin(e.remove),inserted:pin(e.insert)})),
  helperSources:tools.map(h=>h.identity),capturedImports:captured,
  allOtherJsBytesPreserved:true,wasmChanged:false,return0:true,syntaxParsed:true,
  policies:{graphics:'Same two previously reviewed compatibility rules; no new render fix',
   shaderHelpers:'Existing failure/type observation only; no rendering state change',
   i64:'Preserve HEAP64 and BigInt; do not replace with low-32-bit emulation',
   invokes:'Preserve generated minified imports; no synthetic name:name entries',
   inode:'Preserve complete original BigInt stat.ino write, including zero',
   clock:'Preserve original performance.now; official host contract still to verify',
   runtimeError:'Preserve original abort rejection and throw; platform constructor still to verify',
   windowTitle:'No-op the unsupported webpage title setter; same signature/import, no DOM write or parameter decode',
   windowIcon:'No-op the unsupported webpage favicon setter; same signature/import, no DOM, Blob or URL access'},
  completePostprocessor:false,hostContract:'PENDING',productionRegistered:false,
  written:false,targetExecuted:false,wasmInstantiated:false,runtime:'NOT_RUN',phone:'NOT_RUN',admission:'NOT_ADMITTED',
  remaining:['Versioned host selection with secure randomness before factory',
   'Official loader clock, RuntimeError and async instantiation-failure contract',
   'Final derived-pair/host audit and separately scoped conversion/runtime acceptance']}};
}
