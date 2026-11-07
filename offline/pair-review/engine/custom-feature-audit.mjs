// Checks generated declarations, never claims that C++ class removal or macros
// are proven. Whole fixed-source and emitted-command/object audits stay required.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeCustomWasmRequest} from './custom-wasm-plan.mjs';
import {auditCustomModuleBuffers} from './custom-module-selection.mjs';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
export function auditCustomDisabledClasses({features,disabledClassesHeader}){
 const r=normalizeCustomWasmRequest(features),raw=Buffer.from(disabledClassesHeader),text=raw.toString('utf8');
 assert(Buffer.from(text).equals(raw),'CUSTOM_CLASSES_UTF8');
 let clean=text.replaceAll('\r\n','\n').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 assert.equal((clean.match(/^\s*#pragma once\s*$/gm)||[]).length,1,'CUSTOM_CLASSES_PRAGMA');
 clean=clean.replace(/^\s*#pragma once\s*$/gm,'');const actual=[];
 clean=clean.replace(/class ([A-Za-z_][A-Za-z0-9_]*); template <> struct is_class_enabled<([A-Za-z_][A-Za-z0-9_]*)> : std::false_type \{\};/g,(_line,a,b)=>{assert.equal(a,b,'CUSTOM_CLASSES_TYPE_MISMATCH');actual.push(a);return '';});
 assert.equal(clean.trim(),'','CUSTOM_CLASSES_UNRECOGNIZED_CONTENT');
 assert.deepEqual(actual,r.disabledClasses,'CUSTOM_CLASSES_SET_OR_ORDER_MISMATCH');
 return {status:'PASS_REQUESTED_CLASS_DECLARATIONS_ONLY',actualClasses:actual,header:pin(raw),classExistence:'NOT_PROVEN',compiledOut:'NOT_PROVEN',runtime:'NOT_RUN'};
}
export function auditCustomGeneratedFeatures({features,enabledHeader,registration,disabledClassesHeader}){
 const r=normalizeCustomWasmRequest(features);
 return {schema:'wxslim-custom-generated-features-v1',status:'PASS_CUSTOM_GENERATED_DECLARATIONS_ONLY',
   modules:auditCustomModuleBuffers({dimensions:r.dimensions,disabledModules:r.disabledModules,enabledHeader,registration}),
   classes:auditCustomDisabledClasses({features:r,disabledClassesHeader}),
   effectiveCompilerMacros:'PENDING_COMMAND_OBJECT_REVIEW',actualRemovedObjects:'PENDING_COMMAND_OBJECT_REVIEW',linkedPairAdmitted:false,runtime:'NOT_RUN'};
}
