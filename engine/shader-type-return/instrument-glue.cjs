'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MARKER = 'WXSLIM_SHADER_TYPE_RETURN_GLUE_V1';
const ANCHOR = 'function evalBatchRenderSyncInt(ptr,bufferLen){const binaryData=new Uint8Array(Module.HEAPU8.buffer,ptr,bufferLen);const view=new Uint32Array(binaryData.buffer,binaryData.byteOffset,bufferLen/4);if(typeof Module!=="undefined"&&Module.wxContextGlobal){return Module.wxContextGlobal.batchRender(view)}return-1}';
const ENTRY = '/*' + MARKER + '*/let wxslimTypeToken=null;try{const state=Module["__wxslimShaderFailureStateV1"];if(state&&state.typeTake)wxslimTypeToken=state.typeTake(ptr,bufferLen)}catch(wxslimTypeObserverError){}';
const OBSERVE = 'try{if(wxslimTypeToken)wxslimTypeToken.capture(wxslimTypeRaw)}catch(wxslimTypeObserverError){}';
function instrumentGlue(source) {
  if (typeof source !== 'string') throw new TypeError('Generated glue must be text');
  if (source.includes(MARKER)) throw new Error('Shader TYPE return instrumentation already present');
  if (source.split(ANCHOR).length !== 2) throw new Error('Expected exactly one pinned evalBatchRenderSyncInt anchor');
  const patched = ANCHOR.replace('{const binaryData=', '{' + ENTRY + 'const binaryData=')
    .replace('return Module.wxContextGlobal.batchRender(view)', 'const wxslimTypeRaw=Module.wxContextGlobal.batchRender(view);' + OBSERVE + 'return wxslimTypeRaw');
  return source.replace(ANCHOR, patched);
}
module.exports = { instrumentGlue, ANCHOR, MARKER, ENTRY, OBSERVE };
if (require.main === module) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Usage: node instrument-glue.cjs INPUT OUTPUT');
  if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error('Input and output must be different paths; refusing in-place overwrite');
  fs.writeFileSync(output, instrumentGlue(fs.readFileSync(input, 'utf8')), { flag: 'wx' });
}
