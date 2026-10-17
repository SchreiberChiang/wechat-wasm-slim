/* wechat-wasm-slim convert：浏览器对象兼容层（在 local-interfaces.js、Godot callMain 之前加载；--no-compat 不生成）。
 * 通用适配（WXGameKit）运行时缺少一些浏览器对象，Godot 引擎 JS 却会直接用到。下面每一项都在开发者工具里实测过
 * （Star Tap 联网小游戏，见 convert/README.md “wx-compat.js 补了什么”）：
 *  1. __globalAdapter：引擎的输入法代码（LineEdit 弹键盘）调用它的 hideKeyboard / onKeyboardComplete 等。
 *  2. TextEncoder / TextDecoder：引擎的 HTTP、WebSocket 代码会用到；已有时不补。
 *  3. Blob：引擎 WebSocket 收消息时判断 event.data instanceof Blob，没有 Blob 会直接抛错。
 *  4. WebSocket：开发者工具自带的实例没有 OPEN 常量，引擎判断 readyState !== OPEN 后静默丢掉所有发送；
 *     全局 WebSocket 只读不能替换，只给原型补常量。完全没有 WebSocket 时才用 wx.connectSocket 实现一个。
 *  5. navigator.vibrate：Input.vibrate_handheld 走它，转到 wx.vibrateShort / vibrateLong。
 *  6. wx.request：请求体是 TypedArray 视图时转成精确的 ArrayBuffer；只转发带 statusCode 的头回调
 *     （否则引擎把状态记成 0）；关掉 enableChunked（否则请求完成时还没交付数据，Godot 判成 RESULT_CANT_CONNECT）。
 * 每一项都是“缺什么补什么”，已有的不覆盖。结果记在 GameGlobal.__WX_COMPAT__，只打印一行汇总，不记录请求内容。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  var applied = [];
  // 有的全局属性是只读的（开发者工具里的 WebSocket 就是），赋值失败不能拖垮整个兼容层
  function setGlobal(name, value) {
    var ok = false;
    [G, typeof globalThis !== 'undefined' ? globalThis : null, G.window].forEach(function (t) {
      if (!t) return;
      try { t[name] = value; if (t[name] === value) ok = true; } catch (e) {}
    });
    return ok;
  }
  var hasWx = typeof wx !== 'undefined';

  // 1. 输入法适配对象
  if (!G.__globalAdapter && hasWx) {
    setGlobal('__globalAdapter', {
      hideKeyboard: function (o) { wx.hideKeyboard(o || {}); },
      onKeyboardComplete: function (cb) { wx.onKeyboardComplete(cb); },
      offKeyboardComplete: function (cb) { wx.offKeyboardComplete(cb); },
      offKeyboardInput: function (cb) { wx.offKeyboardInput(cb); },
      offKeyboardConfirm: function (cb) { wx.offKeyboardConfirm(cb); },
    });
    applied.push('globalAdapter');
  }

  // 2. 文本编解码（UTF-8）
  if (typeof G.TextEncoder !== 'function') {
    var TE = function () {};
    TE.prototype.encoding = 'utf-8';
    TE.prototype.encode = function (s) {
      s = String(s === undefined ? '' : s);
      var out = [], i, c, c2;
      for (i = 0; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { c2 = s.charCodeAt(i + 1); if (c2 >= 0xdc00 && c2 < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; } }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return new Uint8Array(out);
    };
    setGlobal('TextEncoder', TE);
    applied.push('TextEncoder');
  }
  if (typeof G.TextDecoder !== 'function') {
    var TD = function () {};
    TD.prototype.encoding = 'utf-8';
    TD.prototype.decode = function (b) {
      if (!b) return '';
      var a = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      var s = '', i = 0, c;
      while (i < a.length) {
        c = a[i++];
        if (c >= 0xf0) c = ((c & 7) << 18) | ((a[i++] & 63) << 12) | ((a[i++] & 63) << 6) | (a[i++] & 63);
        else if (c >= 0xe0) c = ((c & 15) << 12) | ((a[i++] & 63) << 6) | (a[i++] & 63);
        else if (c >= 0xc0) c = ((c & 31) << 6) | (a[i++] & 63);
        if (c >= 0x10000) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
        else s += String.fromCharCode(c);
      }
      return s;
    };
    setGlobal('TextDecoder', TD);
    applied.push('TextDecoder');
  }

  // 3. Blob（只需要能做 instanceof 判断）
  if (typeof G.Blob !== 'function') { setGlobal('Blob', function Blob() {}); applied.push('Blob'); }

  // 4. WebSocket：已有实现时只给原型补常量（全局只读）；没有时才用 wx.connectSocket 实现一个。
  var WSP = typeof G.WebSocket === 'function' ? G.WebSocket.prototype : null;
  if (WSP && WSP.OPEN !== 1) {
    try {
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k, i) { Object.defineProperty(WSP, k, {value: i, configurable: true}); });
      applied.push(WSP.OPEN === 1 ? 'WebSocket-consts' : 'WebSocket-consts-failed');
    } catch (e) { applied.push('WebSocket-consts-failed'); }
  }
  if (typeof G.WebSocket !== 'function' && hasWx && typeof wx.connectSocket === 'function') {
    var WS = function (url, protocols) {
      var self = this, opts = {url: url};
      self.url = url; self.readyState = 0; self.binaryType = 'arraybuffer'; self.bufferedAmount = 0; self.protocol = ''; self.extensions = '';
      if (protocols) opts.protocols = Array.isArray(protocols) ? protocols : [protocols];
      var task = self._task = wx.connectSocket(opts);
      task.onOpen(function (res) { self.readyState = 1; self.protocol = (res && res.protocol) || ''; if (self.onopen) self.onopen({type: 'open'}); });
      task.onMessage(function (res) { if (self.onmessage) self.onmessage({type: 'message', data: res.data}); });
      task.onError(function (res) { if (self.onerror) self.onerror({type: 'error', message: res && res.errMsg}); });
      task.onClose(function (res) {
        self.readyState = 3;
        var code = (res && res.code) || 1006;
        if (self.onclose) self.onclose({type: 'close', code: code, reason: (res && res.reason) || '', wasClean: code === 1000});
      });
    };
    WS.CONNECTING = WS.prototype.CONNECTING = 0;
    WS.OPEN = WS.prototype.OPEN = 1;
    WS.CLOSING = WS.prototype.CLOSING = 2;
    WS.CLOSED = WS.prototype.CLOSED = 3;
    WS.prototype.send = function (data) {
      if (ArrayBuffer.isView(data)) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this._task.send({data: data});
    };
    WS.prototype.close = function (code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      var o = {};
      if (code === 1000 || (code >= 3000 && code <= 4999)) o.code = code;
      if (reason) o.reason = String(reason).slice(0, 120);
      this._task.close(o);
    };
    applied.push(setGlobal('WebSocket', WS) ? 'WebSocket' : 'WebSocket-failed');
  }

  // 5. 震动
  var nav = G.navigator || (G.navigator = {});
  if (typeof nav.vibrate !== 'function' && hasWx) {
    try {
      nav.vibrate = function (ms) {
        var d = Array.isArray(ms) ? ms[0] : ms;
        if (!d) return true;
        if (d >= 300) wx.vibrateLong({});
        else wx.vibrateShort({type: d >= 60 ? 'heavy' : d >= 25 ? 'medium' : 'light'});
        return true;
      };
      applied.push('vibrate');
    } catch (e) { applied.push('vibrate-failed'); }
  }

  // 6. wx.request：请求体、头回调、关掉分块接收
  if (hasWx && typeof wx.request === 'function' && !wx.request.__wxCompatPatched) {
    var origRequest = wx.request;
    var patched = function (o) {
      var copy = {};
      for (var k in o) copy[k] = o[k];
      if (copy.data && ArrayBuffer.isView(copy.data)) { var v = copy.data; copy.data = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength); }
      copy.enableChunked = false;
      var task = origRequest.call(wx, copy);
      if (task && typeof task.onHeadersReceived === 'function') {
        var origHeaders = task.onHeadersReceived.bind(task);
        try { task.onHeadersReceived = function (cb) { return origHeaders(function (res) { if (res && res.statusCode) cb(res); }); }; } catch (e) {}
      }
      return task;
    };
    patched.__wxCompatPatched = true;
    try { wx.request = patched; applied.push(wx.request === patched ? 'request' : 'request-readonly'); } catch (e) { applied.push('request-failed'); }
  }

  G.__WX_COMPAT__ = applied;
  console.log('[WX_COMPAT] ' + (applied.join(',') || 'none'));
})();
