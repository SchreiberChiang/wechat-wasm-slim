// Deterministic source rule only: no pair admission, process execution or writes.
// The caller must separately validate the original JS/WASM recipe and the
// final host selector. The legacy fixture also transforms its pinned framework;
// new conversion code must use the raw-only wrapper, never that legacy path.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {replayUpstreamWxmemfs} from './upstream-wxmemfs-correctness.mjs';
import {replayUpstreamWxmemfsRead} from './upstream-wxmemfs-read-contract.mjs';
import {checkEngineJs} from '../convert/lib/inputs.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
const one=(values,label)=>{assert.equal(values.length,1,label);return values[0];};
const id=(node,name)=>node?.type==='Identifier'&&node.name===name;
const member=(node,object,name)=>node?.type==='MemberExpression'&&!node.computed&&id(node.object,object)&&id(node.property,name);
let acorn;
function parse(source){
 if(!acorn){const own={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:own,exports:own.exports});acorn=own.exports;}
 return acorn.parse(source,{ecmaVersion:2022});
}
function nodes(root){
 const all=[];function visit(n){if(!n||typeof n!=='object')return;if(n.type)all.push(n);
  for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}}
 visit(root);return all;
}
function locate(source){
 const all=nodes(parse(source));
 assert(!all.some(n=>n.type==='Identifier'&&n.name==='WXMEMFS'),'UPSTREAM_ALREADY_INSERTED');
 assert(!source.includes('__WXSLIM_UPSTREAM_WXMEMFS__'),'UPSTREAM_MARKER_EXISTS');
 const declaration=name=>n=>n.type==='VariableDeclaration'&&n.kind==='var'&&n.declarations.length===1&&id(n.declarations[0].id,name);
 const factory=one(all.filter(n=>n.type==='FunctionExpression'&&n.async&&n.body.body.some(declaration('GodotFS'))),'UPSTREAM_FACTORY');
 const godot=one(factory.body.body.filter(declaration('GodotFS')),'UPSTREAM_GODOT_FS');
 const fs=one(factory.body.body.filter(declaration('FS')),'UPSTREAM_REAL_FS');
 assert.equal(fs.declarations[0].init.type,'ObjectExpression');assert(fs.end<godot.start,'UPSTREAM_FS_ORDER');
 const mod=one(factory.body.body.filter(declaration('Module')),'UPSTREAM_MODULE');
 assert(id(mod.declarations[0].init,'moduleArg')&&mod.end<fs.start,'UPSTREAM_MODULE_BINDING');
 const object=godot.declarations[0].init;assert.equal(object.type,'ObjectExpression');
 const init=one(object.properties.filter(p=>!p.computed&&(p.key.name??p.key.value)==='init'),'UPSTREAM_INIT').value;
 assert.equal(init.type,'FunctionExpression');
 const callback=one(nodes(init).filter(n=>n.type==='CallExpression'&&
   n.callee.type==='MemberExpression'&&!n.callee.computed&&id(n.callee.property,'forEach')&&member(n.callee.object,'GodotFS','_mount_points')),'UPSTREAM_PATH_ITERATION').arguments[0];
 assert(callback.type==='FunctionExpression'&&callback.params.length===1&&id(callback.params[0],'path'),'UPSTREAM_PATH_CALLBACK');
 const mounts=nodes(init).filter(n=>n.type==='CallExpression'&&member(n.callee,'FS','mount'));
 const mount=one(mounts,'UPSTREAM_UNIQUE_MOUNT');
 assert.equal(callback.body.body.length,2,'UPSTREAM_MOUNT_ORDER');
 const first=callback.body.body[0].expression;
 assert(first?.type==='CallExpression'&&id(first.callee,'createRecursive')&&first.arguments.length===1&&id(first.arguments[0],'path'),'UPSTREAM_DIRECTORY_ORDER');
 assert.equal(callback.body.body[1].expression,mount,'UPSTREAM_DIRECT_MOUNT');
 assert(mount.arguments.length===3&&id(mount.arguments[0],'IDBFS')&&mount.arguments[1].type==='ObjectExpression'&&mount.arguments[1].properties.length===0&&id(mount.arguments[2],'path'),'UPSTREAM_MOUNT_ARGUMENTS');
 const zero=one(all.filter(n=>n.type==='FunctionDeclaration'&&id(n.id,'evalCheckWxContextGlobalIdAvailable')),'UPSTREAM_RETURN_ZERO');
 assert(zero.body.body.length===1&&zero.body.body[0].type==='ReturnStatement'&&zero.body.body[0].argument?.value===0,'UPSTREAM_RETURN_ZERO_VALUE');
 return {godot,argument:mount.arguments[0],init,zero};
}
function derive(bytes,prepared,licenseBytes){
 const source=bytes.toString('utf8');assert(Buffer.from(source).equals(bytes),'UPSTREAM_UTF8');
 const found=locate(source),body=prepared.source;
 // WXMEMFS's trailing `var GODOTSDK` remains local to this IIFE. FS and wx
 // resolve in the original factory. SDK helper assignments remain upstream behavior.
 const inserted='\n/* WXMEMFS: godothub/godot-minigame 099277108e30c0af92bcbbbe7171fa073ae37606\n'+licenseBytes.toString('utf8')+'*/\n'+
  'var WXMEMFS=(function(){\n'+body+'\nreturn WXMEMFS;})();\n'+
  'Module["__WXSLIM_UPSTREAM_WXMEMFS__"]="'+prepared.receipt.derived.sha256+'";\n';
 const a=found.argument,start=found.godot.start;
 const result=source.slice(0,start)+inserted+source.slice(start,a.start)+'WXMEMFS'+source.slice(a.end);
 const reversed=result.slice(0,start)+result.slice(start+inserted.length,a.start+inserted.length)+'IDBFS'+result.slice(a.start+inserted.length+7);
 assert.equal(reversed,source,'UPSTREAM_ONLY_INSERT_AND_MOUNT_ARGUMENT');
 const output=Buffer.from(result);new vm.Script(result,{filename:'upstream-wxmemfs-pair.js'});
 const all=nodes(parse(result));
 const afterZero=one(all.filter(n=>n.type==='FunctionDeclaration'&&id(n.id,'evalCheckWxContextGlobalIdAvailable')),'UPSTREAM_AFTER_RETURN_ZERO');
 assert.equal(result.slice(afterZero.start,afterZero.end),source.slice(found.zero.start,found.zero.end));
 const afterGodot=one(all.filter(n=>n.type==='VariableDeclarator'&&id(n.id,'GodotFS')),'UPSTREAM_AFTER_GODOT_FS');
 const afterInit=afterGodot.init.properties.find(p=>(p.key.name??p.key.value)==='init').value;
 return {glue:output,init:result.slice(afterInit.start,afterInit.end),receipt:{
  before:pin(bytes),after:pin(output),inserted:pin(Buffer.from(inserted)),
  insertByteOffset:Buffer.byteLength(source.slice(0,start)),mountArgumentByteOffset:Buffer.byteLength(source.slice(0,a.start)),
  exactOutsideTwoChanges:true,returnZeroPreserved:true,scope:'IIFE in original Godot factory after FS declaration; single legacy mount argument only',
 }};
}

export function deriveUpstreamWxmemfsGlue(input) {
 assert(input && typeof input==='object' && !Array.isArray(input),'UPSTREAM_RULE_INPUT');
 assert.deepEqual(Object.keys(input).sort(),['glue','sourceBytes','patchBytes','licenseBytes'].sort(),'UPSTREAM_RULE_KEYS');
 for(const key of Object.keys(input))assert(Buffer.isBuffer(input[key]),'UPSTREAM_RULE_BUFFER_'+key);
 assert(input.licenseBytes.length===1078 && sha(input.licenseBytes)==='0f637dfcc5630c028c84fe4e39242fe76b1d36dd28a9871637deaf12156971e6','UPSTREAM_LICENSE_PIN');
 const prepared=replayUpstreamWxmemfs({sourceBytes:input.sourceBytes,patchBytes:input.patchBytes});
 return derive(input.glue,prepared,input.licenseBytes);
}

// Source-only future adapter entry; not a registered production recipe.
// Keep the shared raw-input rejection rather than allowing already-adapted JS.
export function deriveRawUpstreamWxmemfsGlue(input) {
 assert(input && Buffer.isBuffer(input.glue),'UPSTREAM_RAW_BUFFER');
 const checked=checkEngineJs(input.glue.toString('utf8'));
 assert.equal(checked.problems.length,0,'UPSTREAM_RAW_REQUIRED: '+checked.problems.join('; '));
 return deriveUpstreamWxmemfsGlue(input);
}

// New source-only profile. The legacy four-method entry remains byte-identical
// for historical replay. This entry is raw-input-only and does not admit a pair
// or register a production adapter. Callers must perform the separate ABI audit.
export function deriveRawUpstreamWxmemfsReadGlue(input) {
 assert(input && typeof input==='object' && !Array.isArray(input),'UPSTREAM_READ_RULE_INPUT');
 assert.deepEqual(Object.keys(input).sort(),['glue','sourceBytes','patchBytes','readPatchBytes','licenseBytes'].sort(),'UPSTREAM_READ_RULE_KEYS');
 for(const key of Object.keys(input))assert(Buffer.isBuffer(input[key]),'UPSTREAM_READ_RULE_BUFFER_'+key);
 const checked=checkEngineJs(input.glue.toString('utf8'));
 assert.equal(checked.problems.length,0,'UPSTREAM_RAW_REQUIRED: '+checked.problems.join('; '));
 assert(input.licenseBytes.length===1078 && sha(input.licenseBytes)==='0f637dfcc5630c028c84fe4e39242fe76b1d36dd28a9871637deaf12156971e6','UPSTREAM_LICENSE_PIN');
 const prepared=replayUpstreamWxmemfsRead({sourceBytes:input.sourceBytes,patchBytes:input.patchBytes,readPatchBytes:input.readPatchBytes});
 const result=derive(input.glue,prepared,input.licenseBytes);
 result.receipt.profile='upstream-wxmemfs-read-contract-source-v1';
 result.receipt.source=prepared.receipt;
 result.receipt.status='DERIVED_IN_MEMORY_NOT_RUN';
 result.receipt.productionAdapterRegistered=false;
 return result;
}

// Read-only post-conversion check. The converter may wrap the outer module,
// but the complete inserted source, local mount and marker must survive intact.
export function inspectUpstreamWxmemfsReadGlue(glue,prepared,expectedBridge) {
 assert(Buffer.isBuffer(glue)&&prepared&&Buffer.isBuffer(prepared.glue),'UPSTREAM_EMITTED_BUFFERS');
 const source=glue.toString('utf8');assert(Buffer.from(source).equals(glue),'UPSTREAM_EMITTED_UTF8');
 const insertion=prepared.glue.subarray(prepared.receipt.insertByteOffset,
   prepared.receipt.insertByteOffset+prepared.receipt.inserted.bytes).toString('utf8');
 assert.equal(sha(Buffer.from(insertion)),prepared.receipt.inserted.sha256,'UPSTREAM_EMITTED_EXPECTED_INSERT');
 assert.equal(source.split(insertion).length,2,'UPSTREAM_EMITTED_COMPLETE_SOURCE_REQUIRED');
 const all=nodes(parse(source));
 const direct=name=>n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>id(d.id,name));
 const factory=one(all.filter(n=>n.type==='FunctionExpression'&&n.async&&n.body.body.some(direct('GodotFS'))),'UPSTREAM_EMITTED_FACTORY');
 const declarations=factory.body.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations);
 const fs=one(declarations.filter(n=>id(n.id,'FS')),'UPSTREAM_EMITTED_FS');
 const backend=one(declarations.filter(n=>id(n.id,'WXMEMFS')),'UPSTREAM_EMITTED_BACKEND');
 const godot=one(declarations.filter(n=>id(n.id,'GodotFS')),'UPSTREAM_EMITTED_GODOT');
 assert(fs.end<backend.start&&backend.end<godot.start,'UPSTREAM_EMITTED_SCOPE_ORDER');
 const init=one(godot.init.properties.filter(p=>!p.computed&&(p.key.name??p.key.value)==='init'),'UPSTREAM_EMITTED_INIT').value;
 assert.equal(source.slice(init.start,init.end),prepared.init,'UPSTREAM_EMITTED_INIT_CHANGED');
 const mounts=nodes(init).filter(n=>n.type==='CallExpression'&&member(n.callee,'FS','mount'));
 assert.equal(mounts.length,1,'UPSTREAM_EMITTED_MOUNT_COUNT');assert(id(mounts[0].arguments[0],'WXMEMFS'),'UPSTREAM_EMITTED_MOUNT_TARGET');
 const assignments=all.filter(n=>n.type==='AssignmentExpression'&&n.left?.type==='MemberExpression'&&id(n.left.object,'Module')&&
   (n.left.computed?n.left.property.value:n.left.property.name)==='__WXSLIM_UPSTREAM_WXMEMFS__');
 const marker=one(assignments,'UPSTREAM_EMITTED_MARKER');
 assert(marker.start>backend.end&&marker.end<godot.start,'UPSTREAM_EMITTED_MARKER_SCOPE');
 assert.equal(marker.operator,'=');assert.equal(marker.right.type,'Literal');assert.equal(marker.right.value,prepared.receipt.source.derived.sha256);
 let hostBridgeExact=false;
 if(expectedBridge!==undefined) {
  assert(typeof expectedBridge==='string','UPSTREAM_EMITTED_BRIDGE_TEXT');
  const expected=parse(expectedBridge);
  assert.equal(expected.body.length,2,'UPSTREAM_EMITTED_BRIDGE_SHAPE');
  assert.equal(expected.body[0].type,'ExpressionStatement');assert.equal(expected.body[1].type,'IfStatement');
  const statements=expected.body.map(n=>expectedBridge.slice(n.start,n.end));
  const matches=[];
  for(const n of all.filter(n=>n.type==='Program'||n.type==='BlockStatement')) {
   for(let i=0;i<n.body.length-1;i++)if(n.body[i].type===expected.body[0].type&&n.body[i+1].type===expected.body[1].type&&
     source.slice(n.body[i].start,n.body[i].end)===statements[0]&&source.slice(n.body[i+1].start,n.body[i+1].end)===statements[1])matches.push(n);
  }
  assert.equal(matches.length,1,'UPSTREAM_EMITTED_EXACT_HOST_BRIDGE_REQUIRED');
  const bridgeAssignments=all.filter(n=>n.type==='AssignmentExpression'&&n.left?.type==='MemberExpression'&&
    (n.left.computed?n.left.property.value:n.left.property.name)==='__WXSLIM_GODOT_BRIDGE__');
  assert.equal(bridgeAssignments.length,1,'UPSTREAM_EMITTED_SINGLE_HOST_BRIDGE');
  hostBridgeExact=true;
 }
 return {completeInsertedSource:true,localFactoryScope:true,uniqueMount:'WXMEMFS',sourceSha256:marker.right.value,markerCount:1,hostBridgeExact,executed:false};
}
