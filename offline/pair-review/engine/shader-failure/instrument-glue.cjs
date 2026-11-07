'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MARKER = 'WXSLIM_SHADER_FAILURE_GLUE_V1';
// Exact adapter from the pinned source-built glue. No target glue is evaluated.
const ANCHOR = 'function evalBatchRenderSyncString(ptr,bufferLen){const binaryData=new Uint8Array(Module.HEAPU8.buffer,ptr,bufferLen);const view=new Uint32Array(binaryData.buffer,binaryData.byteOffset,bufferLen/4);if(typeof Module!=="undefined"&&Module.wxContextGlobal){const batchResult=Module.wxContextGlobal.batchRender(view);const batchResultStr=typeof batchResult==="object"?JSON.stringify(batchResult):batchResult;const ptr=Module._malloc(Module.lengthBytesUTF8(batchResultStr)+1);Module.stringToUTF8(batchResultStr,ptr,Module.lengthBytesUTF8(batchResultStr)+1);return ptr}return 0}';
const ENTRY = '/*' + MARKER + '*/let wxslimFailureToken=null;try{const state=Module["__wxslimShaderFailureStateV1"];if(state)wxslimFailureToken=state.take()}catch(wxslimObserverError){}';
const OBSERVE = 'try{if(wxslimFailureToken)wxslimFailureToken.capture(batchResult,batchResultStr)}catch(wxslimObserverError){}';
function instrumentGlue(source) {
  if (typeof source !== 'string') throw new TypeError('Generated glue must be text');
  if (source.includes(MARKER)) throw new Error('Shader failure instrumentation already present');
  if (source.split(ANCHOR).length !== 2) throw new Error('Expected exactly one pinned evalBatchRenderSyncString anchor');
  const patched = ANCHOR.replace('{const binaryData=', '{' + ENTRY + 'const binaryData=')
    .replace(';return ptr}', ';' + OBSERVE + 'return ptr}');
  return source.replace(ANCHOR, patched);
}
module.exports = { instrumentGlue, ANCHOR, MARKER, ENTRY, OBSERVE };
if (require.main === module) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Usage: node instrument-glue.cjs INPUT OUTPUT');
  if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error('Input and output must be different paths; refusing in-place overwrite');
  fs.writeFileSync(output, instrumentGlue(fs.readFileSync(input, 'utf8')), { flag: 'wx' });
}
