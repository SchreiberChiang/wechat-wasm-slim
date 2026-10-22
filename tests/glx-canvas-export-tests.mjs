import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {decodeOnePixel} from '../examples/glx-smoke/decode-canvas.mjs';
const source=fs.readFileSync(new URL('../examples/glx-smoke/canvas-export-probe.js',import.meta.url),'utf8');
function png(width=1,metadata=true){
  function chunk(name,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);return out;}
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(metadata?[chunk('tEXt',Buffer.from('PRIVATE_METADATA'))]:[]),chunk('IDAT',zlib.deflateSync(Buffer.from([0,25,50,75,255]))),chunk('IEND',Buffer.alloc(0))]);
}
function harness({image=png(),hangCleanup=false,lateExport=false}={}){
  const logs=[],timers=new Map(),calls=[];let id=0,exportOptions;
  const raw=image.buffer.slice(image.byteOffset,image.byteOffset+image.byteLength);
  const files={stat(o){calls.push('stat');o.success({stats:{size:image.length}});},readFile(o){calls.push('read');o.success({data:raw});},unlink(o){calls.push('unlink');assert.equal(o.filePath,'wxfile://tmp_owned');if(!hangCleanup)o.success();}};
  const canvas={width:1206,height:2622,toTempFilePath(o){exportOptions=o;calls.push('export');assert.equal(o.destWidth,1);assert.equal(o.destHeight,1);assert.equal(o.width,1206);if(!lateExport)o.success({tempFilePath:'wxfile://tmp_owned'});}};
  const ctx=vm.createContext({GameGlobal:{wx:{getFileSystemManager:()=>files},__WXSLIM_RENDER_CONFIG__:{packageVersion:'wxslim-12345678901234567890'}},Uint8Array,Date,console:{warn(s){assert.ok(s.length<4096);logs.push(JSON.parse(s.slice(s.indexOf('{'))));}},setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(i){timers.delete(i);}});
  vm.runInContext(source,ctx);const api=vm.runInContext('__WXSLIM_CANVAS_EXPORT__',ctx);
  return {api,canvas,files,logs,calls,timers,timeout(){for(const fn of [...timers.values()])fn();},completeExport(){exportOptions.success({tempFilePath:'wxfile://tmp_owned'});}};
}
test('owned canvas export is bounded, strips metadata, cleans its file and decodes locally',()=>{
  const h=harness();h.api.capture(1,h.canvas,h.canvas,h.canvas);h.api.capture(2,h.canvas,h.canvas,h.canvas);h.api.capture(3,h.canvas,h.canvas,h.canvas);
  assert.equal(h.logs.length,2);assert.equal(h.calls.filter(c=>c==='export').length,2);
  assert.equal(h.logs[0].tempFileCleanup,'removed');assert.equal(h.logs[0].result,'png_1x1_received');
  assert.ok(!Buffer.from(h.logs[0].pngHex,'hex').includes(Buffer.from('PRIVATE_METADATA')));
  assert.deepEqual(decodeOnePixel(h.logs[0].pngHex).rgb,[25,50,75]);assert.equal(h.timers.size,0);
  assert.ok(!JSON.stringify(h.logs).includes('wxfile://'));
});
test('wrong canvas and full-size exports are rejected without uploading any pixels',()=>{
  const h=harness();h.api.capture(1,h.canvas,{},h.canvas);assert.equal(h.logs[0].result,'canvas_identity_unconfirmed');assert.equal(h.calls.length,0);
  const bad=harness({image:png(1206)});bad.api.capture(1,bad.canvas,bad.canvas,bad.canvas);assert.equal(bad.logs[0].result,'png_validation_failed');assert.equal(bad.logs[0].pngHex,undefined);
});
test('missing callbacks time out, late temporary files are cleaned and logging remains once-only',()=>{
  const h=harness({lateExport:true});h.api.capture(1,h.canvas,h.canvas,h.canvas);h.timeout();h.completeExport();
  assert.equal(h.logs.length,1);assert.equal(h.logs[0].result,'timeout');assert.ok(h.calls.includes('unlink'));
  const stuck=harness({hangCleanup:true});stuck.api.capture(1,stuck.canvas,stuck.canvas,stuck.canvas);stuck.timeout();assert.equal(stuck.logs.length,1);assert.equal(stuck.logs[0].tempFileCleanup,'not_confirmed');
});
test('decoder rejects unbounded images and unsupported formats',()=>{
  assert.throws(()=>decodeOnePixel(png(2).toString('hex')));assert.throws(()=>decodeOnePixel('ff'.repeat(2000)));
});
