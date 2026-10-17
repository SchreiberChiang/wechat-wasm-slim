/* wechat-wasm-slim convert：注册 WXGameKit 自定义数据处理。
 * 插件解压首包数据（data-package/<md5>.data.bin）后回调这里：校验大小和 GDPC 文件头，
 * 复制出 PCK 字节留给 Godot 启动桥在 initFS 之后 copyToFS，并释放转换器加的资源依赖门。
 */
(function (root) {
  'use strict';
  var kit = typeof WXGameKit !== 'undefined' ? WXGameKit : root.WXGameKit;
  var meta = root.__WXSLIM_PACKAGE_META__ || root.__WX15_PACKAGE_META__;  // 旧名兼容
  var state = {stage:'NEW', calls:0, accepted:false};
  root.__WXSLIM_RESOURCE_STATE__ = state;
  function check(value, code) { if (!value) throw Error(code); }
  function mark(stage) {
    state.stage = stage;
    if (typeof console !== 'undefined') console.log('[WXSLIM_RESOURCE]', stage);
  }
  mark('REGISTERING_CUSTOM_HANDLER');
  check(kit && kit.loader && typeof kit.loader.setCustomProcessRawDataHandler === 'function', 'WXSLIM_CUSTOM_RESOURCE_HOOK_MISSING');
  check(meta && Number.isInteger(meta.size) && meta.size>0 && meta.pck && Number.isInteger(meta.pckBytes) && meta.pckBytes>0 && meta.pck.start>=0 && meta.pck.end<=meta.size && meta.pck.end-meta.pck.start===meta.pckBytes, 'WXSLIM_CUSTOM_RESOURCE_METADATA');
  kit.loader.setCustomProcessRawDataHandler(function (module) {
    state.calls++;
    try {
      check(module && module.rawData, 'WXSLIM_CUSTOM_RESOURCE_RAW_DATA_MISSING');
      var raw = module.rawData;
      var bytes = ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : new Uint8Array(raw);
      check(bytes.byteLength === meta.size, 'WXSLIM_CUSTOM_RESOURCE_SIZE');
      var pck = bytes.subarray(meta.pck.start, meta.pck.end);
      check(pck.byteLength === meta.pckBytes && pck[0] === 71 && pck[1] === 68 && pck[2] === 80 && pck[3] === 67, 'WXSLIM_CUSTOM_RESOURCE_PCK_HEADER');
      module.__WXSLIM_CUSTOM_PCK_BYTES__ = new Uint8Array(pck);
      state.retainedPckBytes = module.__WXSLIM_CUSTOM_PCK_BYTES__.byteLength;
      module.__WXSLIM_CUSTOM_PACKAGE_READY__ = true;
      state.accepted = true;
      state.bytes = bytes.byteLength;
      mark('VALIDATED_FOR_GODOT_MOUNT');
      if(typeof module.__WXSLIM_RELEASE_ASSET_GATE__==='function'){state.gateReleased=module.__WXSLIM_RELEASE_ASSET_GATE__();mark('VALIDATED_GATE_CONNECTED');}
    } catch (error) {
      state.error = String(error && error.message || error);
      mark('FAILED');
      throw error;
    }
  });
  mark('CUSTOM_HANDLER_REGISTERED');
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
