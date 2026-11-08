// Fixed historical glue replay only. This is NOT the complete official postprocessor.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {postprocessOfficialGraphics,referenceInput} from './official-graphics-postprocess.mjs';
import {returnZero} from './alpha-preserve-lighting/delivery.mjs';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const baseline='engine/alpha-preserve-lighting/baseline-shader-diagnostic.patch';
const baselineSha='84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6';
const helperPaths=[
 ['engine/shader-failure/instrument-glue.cjs','platform/web/js/patches/wxslim_shader_instrument.cjs'],
 ['engine/shader-type-return/instrument-glue.cjs','platform/web/js/patches/wxslim_shader_type_instrument.cjs'],
];
const originalId='function evalCheckWxContextGlobalIdAvailable(){if(typeof Module!=="undefined"&&Module.wxContextGlobal&&typeof Module.wxContextGlobal.fetchAndIncId==="function"){return 1}return 0}';
const zeroId='function evalCheckWxContextGlobalIdAvailable(){return 0}';
const pin=b=>({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')});

function helpers(){
 const bytes=fs.readFileSync(path.join(root,baseline));assert.equal(pin(bytes).sha256,baselineSha,'BASELINE_PATCH_CHANGED');
 const names=helperPaths.map(p=>p[1]);
 const sections=bytes.toString().split(/(?=^diff --git )/m).filter(s=>names.some(n=>s.startsWith('diff --git a/'+n+' b/'+n+'\n')));
 assert.equal(sections.length,2);const state=replayUnifiedPatch(Buffer.from(sections.join('')),()=>null);
 return helperPaths.map(([file,derived])=>{
   const b=fs.readFileSync(path.join(root,file));assert(b.equals(Buffer.from(state.get(derived).text)),'HELPER_NOT_BASELINE_IDENTICAL');
   return {file,...pin(b),impl:require(path.join(root,file))};
 });
}

function unique(text,needle){
 const at=text.indexOf(needle);assert(at>=0&&text.indexOf(needle,at+needle.length)<0,'EXACTLY_ONE_ANCHOR_REQUIRED');return at;
}

export function replayOfficialShaderGlueReference(raw){
 assert.equal(arguments.length,1,'EXTERNAL_INPUT_PIN_NOT_ACCEPTED');
 assert(Buffer.isBuffer(raw),'BUFFER_REQUIRED');assert.deepEqual(pin(raw),referenceInput,'RAW_REFERENCE_NOT_PINNED');
 const source=raw.toString();assert(Buffer.from(source).equals(raw),'UTF8_REQUIRED');
 const tools=helpers();
 for(const h of tools)assert(!source.includes(h.impl.MARKER),'ALREADY_INSTRUMENTED');
 unique(source,originalId);assert(!source.includes(zeroId),'ALREADY_RETURN_ZERO');
 const graphics=postprocessOfficialGraphics(raw);
 let current=graphics.output.toString();const steps=[];
 for(const helper of tools){
   const {ANCHOR,instrumentGlue,MARKER}=helper.impl;
   const at=unique(current,ANCHOR),before=current;
   // Derive the exact replacement separately; never evaluate generated target glue.
   const replacement=instrumentGlue(ANCHOR);
   const actual=instrumentGlue(before);
   assert.equal(actual,before.slice(0,at)+replacement+before.slice(at+ANCHOR.length),'UNRELATED_GLUE_CHANGED');
   const reverseAt=unique(actual,replacement);
   assert.equal(actual.slice(0,reverseAt)+ANCHOR+actual.slice(reverseAt+replacement.length),before,'REVERSE_MISMATCH');
   unique(actual,MARKER);assert.throws(()=>instrumentGlue(actual));
   steps.push({rule:MARKER,helper:{path:helper.file,bytes:helper.bytes,sha256:helper.sha256},input:pin(before),output:pin(actual),
     inputByteOffset:Buffer.byteLength(before.slice(0,at)),removed:pin(ANCHOR),inserted:pin(replacement),otherBytesPreserved:true});
   current=actual;
 }
 const before=current,at=unique(before,originalId);
 const result=returnZero(Buffer.from(before));current=result.toString();
 assert.equal(current,before.slice(0,at)+zeroId+before.slice(at+originalId.length),'RETURN_ZERO_OTHER_BYTES_CHANGED');
 unique(current,zeroId);assert.throws(()=>returnZero(result));
 steps.push({rule:'official-global-id-return0',input:pin(before),output:pin(result),inputByteOffset:Buffer.byteLength(before.slice(0,at)),removed:pin(originalId),inserted:pin(zeroId),otherBytesPreserved:true});
 new vm.Script(current,{filename:'derived-reference-not-executed.js'});
 return {output:result,receipt:{schema:'wxslim-official-shader-glue-reference-v1',status:'REFERENCE_REPLAY_ONLY_NOT_A_RUNTIME_CANDIDATE',
   input:pin(raw),output:pin(result),graphics:graphics.receipt,steps,syntaxParsed:true,targetExecuted:false,
   baselinePatch:{path:baseline,sha256:baselineSha},officialGeneratedInputVerified:false,completePostprocessor:false,
   remaining:['actual official emitted glue and native imports/invoke pairing','runtime clock/i64/error/stat compatibility decisions','secure randomness and storage/host closure','actual full/conservative build and runtime acceptance']}};
}
