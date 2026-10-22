/* WXSLIM_CANVAS_EXPORT_V1: at most two 1x1 exports of the owned synthetic smoke canvas. */
var __WXSLIM_CANVAS_EXPORT__ = (function (root) {
  'use strict';
  var attempts = 0;
  function corePngHex(buffer) {
    var b = new Uint8Array(buffer), signature = [137,80,78,71,13,10,26,10];
    if (b.length > 4096 || b.length < 45) throw Error('png_size');
    for (var k = 0; k < 8; k++) if (b[k] !== signature[k]) throw Error('png_signature');
    function u32(i) { return b[i]*16777216+b[i+1]*65536+b[i+2]*256+b[i+3]; }
    var selected = signature.slice(), at = 8, header = false, data = false, ended = false;
    while (at + 12 <= b.length) {
      var size = u32(at), end = at + size + 12;
      if (end > b.length) throw Error('png_chunk');
      var name = String.fromCharCode(b[at+4],b[at+5],b[at+6],b[at+7]);
      if (name === 'IHDR') {
        if (at !== 8 || size !== 13 || u32(at+8) !== 1 || u32(at+12) !== 1) throw Error('png_dimensions');
        header = true;
      }
      if (name === 'IDAT') data = true;
      if (['IHDR','IDAT','PLTE','tRNS','IEND'].indexOf(name) >= 0) {
        for (var j = at; j < end; j++) selected.push(b[j]);
      }
      if (selected.length > 1024) throw Error('png_payload_limit');
      at = end;
      if (name === 'IEND') { ended = true; break; }
    }
    if (!header || !data || !ended) throw Error('png_incomplete');
    return selected.map(function(n) { return ('0'+n.toString(16)).slice(-2); }).join('');
  }
  function capture(slot, canvas, rootCanvas, contextCanvas) {
    if (attempts >= 2) return;
    attempts++;
    var start = Date.now(), done = false, file = null, fs = null, cleaned = false;
    var record = {schema:'wxslim-canvas-export-v1', slot:slot, phase:'after_original_swap_return', source:'owned_game_canvas',
      packageVersion:(root.__WXSLIM_RENDER_CONFIG__ || {}).packageVersion || null, dimensions:[1,1],
      bindingChanged:false, visibleDisplay:'not_verified', exportMaySynchronize:true};
    var timeout;
    function output(reason) {
      if (done) return;
      done=true; clearTimeout(timeout); record.result=reason; record.elapsedMillis=Date.now()-start;
      record.tempFileCleanup=cleaned ? 'removed' : file ? 'not_confirmed' : 'not_created';
      try { console.warn('[WXSLIM_CANVAS_EXPORT] '+JSON.stringify(record)); } catch (_) {}
    }
    function finish(reason) {
      if (!file || !fs || typeof fs.unlink !== 'function') { output(reason); return; }
      try { fs.unlink({filePath:file,success:function(){cleaned=true;output(reason);},fail:function(){output(reason);}}); }
      catch (_) { output(reason); }
    }
    timeout=setTimeout(function(){finish('timeout');output('timeout');},3500);
    if (!canvas || canvas !== rootCanvas || canvas !== contextCanvas) { finish('canvas_identity_unconfirmed'); return; }
    if (typeof canvas.toTempFilePath !== 'function') { finish('canvas_export_unavailable'); return; }
    var wxApi=root.wx || (typeof wx !== 'undefined' ? wx : null);
    try { fs=wxApi && wxApi.getFileSystemManager(); } catch (_) {}
    if (!fs || typeof fs.stat !== 'function' || typeof fs.readFile !== 'function' || typeof fs.unlink !== 'function') { finish('file_api_unavailable'); return; }
    try {
      canvas.toTempFilePath({x:0,y:0,width:canvas.width,height:canvas.height,destWidth:1,destHeight:1,fileType:'png',
        fail:function(){finish('canvas_export_failed');},
        success:function(res){
          file=res && typeof res.tempFilePath==='string' ? res.tempFilePath : null;
          if (!file) { finish('temp_path_absent'); return; }
          if (done) { finish('late_export'); return; }
          try { fs.stat({path:file,recursive:false,fail:function(){finish('stat_failed');},success:function(stat){
            var size=stat && stat.stats && stat.stats.size;
            if (done) { finish('late_stat'); return; }
            if (!Number.isInteger(size) || size < 45 || size > 4096) { finish('export_size_rejected'); return; }
            try { fs.readFile({filePath:file,fail:function(){finish('read_failed');},success:function(read){
              if (done) { finish('late_read'); return; }
              try { record.pngHex=corePngHex(read.data); finish('png_1x1_received'); }
              catch (_) { finish('png_validation_failed'); }
            }}); } catch (_) { finish('read_threw'); }
          }}); } catch (_) { finish('stat_threw'); }
        }});
    } catch (_) { finish('export_threw'); }
  }
  return {capture:capture, corePngHex:corePngHex};
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
