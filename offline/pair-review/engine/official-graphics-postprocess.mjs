// SOURCE_ONLY: two fixed df3 graphics rules; no build integration or target execution.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const FRAME='Module.wxContextGlobal.registerAfterDoFrame(Module._glxCommandBufferFlush)';
const DYNAMIC='Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();})';
const IMPORTS='var wasmImports={';
const MARKER='var __godotMinigameOriginalCommitFrame=_emscripten_webgl_commit_frame;';
const WRAPPER=MARKER+'_emscripten_webgl_commit_frame=function(){var result=__godotMinigameOriginalCommitFrame();var context=typeof GL!=="undefined"&&GL.currentContext&&GL.currentContext.GLctx;if(context){if(typeof context.flush==="function"){context.flush()}if(typeof context.commit==="function"){context.commit()}}return result;};';
export const referenceInput=Object.freeze({bytes:478655,sha256:'982e4241ffbf1d69039e7c460fc1c403f551d414be811f0569111eed3361f2af'});
const identity=b=>({bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});
function fail(code){throw Error(code);}
function unique(s,token,code){const i=s.indexOf(token);if(i<0||s.indexOf(token,i+token.length)>=0)fail(code);return i;}

// Structural inspection is not admission. Only the whole-byte pinned input below
// can be derived; token-only/comment fixtures cannot become admitted JS.
export function inspectOfficialGraphicsInput(raw){
  if(!Buffer.isBuffer(raw))fail('GRAPHICS_BUFFER_REQUIRED');
  const s=raw.toString('utf8');
  if(!Buffer.from(s,'utf8').equals(raw))fail('GRAPHICS_UTF8_REQUIRED');
  if(s.includes('__godotMinigameOriginalCommitFrame')||s.includes(DYNAMIC))fail('GRAPHICS_ALREADY_DERIVED');
  const frame=unique(s,FRAME,'GRAPHICS_FRAME_NOT_UNIQUE');
  const imports=unique(s,IMPORTS,'GRAPHICS_IMPORTS_NOT_UNIQUE');
  const declarations=[...s.matchAll(/(?:var|let|const)\s+_emscripten_webgl_commit_frame\s*=|function\s+_emscripten_webgl_commit_frame\s*\(/g)];
  if(declarations.length!==1)fail('GRAPHICS_COMMIT_DECLARATION_NOT_UNIQUE');
  if(declarations[0].index>=imports)fail('GRAPHICS_COMMIT_AFTER_IMPORTS');
  return {frame,imports};
}

export function postprocessOfficialGraphics(raw){
  const positions=inspectOfficialGraphicsInput(raw);
  if(raw.length!==referenceInput.bytes||identity(raw).sha256!==referenceInput.sha256)fail('GRAPHICS_INPUT_NOT_PINNED');
  const s=raw.toString('utf8');
  const edits=[
    {rule:'wx-glx-after-do-frame-wrapper',start:positions.frame,remove:FRAME,insert:DYNAMIC},
    {rule:'commit-frame-wrapper',start:positions.imports,remove:'',insert:WRAPPER},
  ].map(e=>({...e,byteOffset:Buffer.byteLength(s.slice(0,e.start))})).sort((a,b)=>a.byteOffset-b.byteOffset);
  const chunks=[];let cursor=0;
  for(const e of edits){
    assert(raw.subarray(e.byteOffset,e.byteOffset+Buffer.byteLength(e.remove)).equals(Buffer.from(e.remove)));
    chunks.push(raw.subarray(cursor,e.byteOffset),Buffer.from(e.insert));cursor=e.byteOffset+Buffer.byteLength(e.remove);
  }
  chunks.push(raw.subarray(cursor));
  const output=Buffer.concat(chunks);
  // Independent reverse splice proves all other bytes were preserved.
  let restored=output;let delta=edits.reduce((n,e)=>n+Buffer.byteLength(e.insert)-Buffer.byteLength(e.remove),0);
  for(const e of [...edits].reverse()){
    delta-=Buffer.byteLength(e.insert)-Buffer.byteLength(e.remove);
    const at=e.byteOffset+delta,added=Buffer.from(e.insert);
    assert(restored.subarray(at,at+added.length).equals(added));
    restored=Buffer.concat([restored.subarray(0,at),Buffer.from(e.remove),restored.subarray(at+added.length)]);
  }
  assert(restored.equals(raw));
  return {output,receipt:{schema:'wxslim-official-graphics-postprocess-v1',status:'SOURCE_ONLY_REFERENCE_REPLAY',
    input:identity(raw),output:identity(output),edits:edits.map(e=>({rule:e.rule,inputByteOffset:e.byteOffset,removed:identity(Buffer.from(e.remove)),inserted:identity(Buffer.from(e.insert))})),
    unchangedBytesVerified:true,sourceCommit:'df3cdd9bc9941a20cb5575d781cde6f937637bcb',
    officialGeneratedInputVerified:false,integrated:false,compiled:false,targetExecuted:false,runtime:'NOT_RUN'}};
}
