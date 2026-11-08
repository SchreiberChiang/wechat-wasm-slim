/* Explicit ordinary-resource reader only. Never auto-starts, mounts or writes. */
(function (root) {
  'use strict';
  var HARD_LIMIT = 32 * 1024 * 1024; // Single-pack input limit, not platform quota or total retained memory.
  var REMOTE_CONFIG = 'wxslim-remote.json', CACHE_DIR = 'wxslim-packs';
  function ownData(value, key) {
    try { var d = value && Object.getOwnPropertyDescriptor(value, key); return d && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined; }
    catch (_) { return undefined; }
  }
  function readDiagnostic(cause) {
    var errno = ownData(cause, 'errno'), text = ownData(cause, 'errMsg'), reason = 'UNKNOWN';
    if (typeof errno !== 'number' || !Number.isSafeInteger(errno) || errno < -2147483648 || errno > 2147483647) errno = null;
    if (typeof text !== 'string') text = ownData(cause, 'message');
    // Classify a bounded local message, never copy it, its path or stack into a
    // public receipt. This category is not an independently proven OS cause.
    if (typeof text === 'string') {
      text = text.slice(0, 1024);
      if (/permission denied|operation not permitted|\bEACCES\b|\bEPERM\b/i.test(text)) reason = 'PERMISSION_DENIED';
      else if (/no such file|not found|\bENOENT\b/i.test(text)) reason = 'NOT_FOUND';
      else if (/invalid argument|invalid parameter|\bEINVAL\b/i.test(text)) reason = 'INVALID_ARGUMENT';
    }
    return Object.freeze({api:'readFile', errno:errno, reason:reason});
  }
  function error(code, cause) {
    var e = new Error(code); e.code = code; e.cause = cause;
    if (code === 'RESOURCE_READER_READ_FAILED') e.platformDiagnostic = readDiagnostic(cause);
    return e;
  }
  function requireValue(value, message) { if (!value) throw new TypeError(message); }
  function method(receiver, name) {
    try { var fn = receiver && receiver[name]; requireValue(typeof fn === 'function', 'required platform API unavailable'); return fn; }
    catch (cause) { throw error('RESOURCE_READER_API_UNAVAILABLE', cause); }
  }
  function invoke(fn, receiver, fields, code) {
    return new Promise(function (resolve, reject) {
      var invoking = true, first = null, ended = false;
      function deliver(item) { ended = true; if (item.ok) resolve(item.value); else reject(error(code, item.value)); }
      function settle(ok, value) {
        if (ended || first) return;
        if (invoking) first = {ok:ok, value:value};
        else deliver({ok:ok, value:value});
      }
      var options = {};
      Object.keys(fields).forEach(function (key) { options[key] = fields[key]; });
      options.success = function (value) { settle(true, value); };
      options.fail = function (cause) { settle(false, cause); };
      options.complete = function () {}; // complete is not a success receipt.
      try { fn.call(receiver, options); }
      catch (cause) { ended = true; reject(error(code, cause)); }
      invoking = false;
      if (!ended && first) deliver(first);
    });
  }

  function createResourceSubpackageReader(options) {
    var wxApi, observer, cancelled, limit, busy = false, allow = Object.create(null);
    try {
      requireValue(options && typeof options === 'object' && !Array.isArray(options), 'options required');
      requireValue(Object.keys(options).every(function (key) { return ['wx','manifest','maxBytes','cancelRequested','observer'].indexOf(key) >= 0; }), 'unknown reader option');
      wxApi = options.wx; observer = options.observer; cancelled = options.cancelRequested;
      requireValue(wxApi && (typeof wxApi === 'object' || typeof wxApi === 'function'), 'wx object required');
      requireValue(observer === undefined || typeof observer === 'function', 'observer must be a function');
      requireValue(cancelled === undefined || typeof cancelled === 'function', 'cancelRequested must be a function');
      limit = options.maxBytes === undefined ? HARD_LIMIT : options.maxBytes;
      requireValue(Number.isSafeInteger(limit) && limit >= 4 && limit <= HARD_LIMIT, 'invalid input-byte budget');
    } catch (cause) { throw error('RESOURCE_READER_OPTIONS_INVALID', cause); }
    try {
      requireValue(Array.isArray(options.manifest) && options.manifest.length > 0 && options.manifest.length <= 128, 'manifest array required');
      var files = Object.create(null);
      options.manifest.forEach(function (item) {
        requireValue(item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 5 && Object.keys(item).every(function (key) { return ['id','root','file','bytes','sha256'].indexOf(key) >= 0; }), 'exact manifest fields required');
        requireValue(typeof item.id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(item.id), 'invalid pack id');
        requireValue(typeof item.root === 'string' && item.root.length <= 128 && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(item.root), 'invalid subpackage root');
        requireValue(item.file === item.root + '/content.bin', 'file must be the exact allowlisted root/content.bin');
        requireValue(Number.isSafeInteger(item.bytes) && item.bytes >= 4 && item.bytes <= limit && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256), 'invalid size or hash pin');
        requireValue(!Object.prototype.hasOwnProperty.call(allow, item.id) && !files[item.file.toLowerCase()], 'duplicate id or file alias');
        allow[item.id] = Object.freeze({id:item.id, root:item.root, file:item.file, bytes:item.bytes, sha256:item.sha256});
        files[item.file.toLowerCase()] = true;
      });
    } catch (cause) { throw error('RESOURCE_READER_MANIFEST_INVALID', cause); }
    function observe(type, item) {
      return Promise.resolve().then(function () {
        if (observer) return observer({type:type, id:item.id, length:item.bytes});
      }).then(undefined, function (cause) { throw error('RESOURCE_READER_OBSERVER_FAILED', cause); });
    }
    function checkCancelled() {
      return Promise.resolve().then(function () { return cancelled ? cancelled() : false; }).then(function (value) {
        try { requireValue(typeof value === 'boolean', 'cancellation check must return boolean'); }
        catch (cause) { throw error('RESOURCE_READER_CANCEL_CHECK_FAILED', cause); }
        if (value) throw error('RESOURCE_READER_CANCELLED', null);
      }, function (cause) { throw error('RESOURCE_READER_CANCEL_CHECK_FAILED', cause); });
    }
    // CDN 远程分包：小游戏包根目录有 wxslim-remote.json 时，里面列出的分包从 CDN 下载，
    // 存进本地用户目录（按指纹命名，下次直接读缓存），不再走 loadSubpackage。大小和 SHA-256 照旧由后面核对。
    var remoteState, pruned = false;
    function remoteEntry(fsApi, item) {
      if (remoteState === undefined) {
        var text = null;
        try { text = fsApi.readFileSync(REMOTE_CONFIG, 'utf8'); } catch (_) { text = null; }
        if (typeof text !== 'string') remoteState = null;
        else {
          try {
            var value = JSON.parse(text);
            requireValue(value && value.schema === 'wxslim-remote-packs-v1' && typeof value.baseUrl === 'string' &&
              /^https?:\/\/[^\s?#]+\/$/.test(value.baseUrl) && value.packs && typeof value.packs === 'object' && !Array.isArray(value.packs), 'invalid remote pack config');
            remoteState = value;
          } catch (cause) { throw error('RESOURCE_READER_REMOTE_CONFIG', cause); }
        }
      }
      if (!remoteState || !Object.prototype.hasOwnProperty.call(remoteState.packs, item.id)) return null;
      var entry = remoteState.packs[item.id];
      if (!(entry && typeof entry.path === 'string' && /^[A-Za-z0-9_.\/-]+$/.test(entry.path) && entry.path.indexOf('..') < 0 &&
          entry.bytes === item.bytes && entry.sha256 === item.sha256)) throw error('RESOURCE_READER_REMOTE_PIN', {id:item.id});
      return {url:remoteState.baseUrl + entry.path};
    }
    function fileSize(fsApi, file) {
      try { var s = fsApi.statSync(file, false); return s && typeof s.size === 'number' ? s.size : -1; } catch (_) { return -1; }
    }
    function quietly(fn) { try { fn(); } catch (_) {} }
    function pruneCache(fsApi, dir) {
      // 只保留这一版用到的缓存，旧版本的分包删掉，免得占满用户目录。
      if (pruned) return; pruned = true;
      var keep = Object.create(null);
      Object.keys(remoteState.packs).forEach(function (id) { keep[remoteState.packs[id].sha256 + '.bin'] = true; });
      var names; try { names = fsApi.readdirSync(dir); } catch (_) { return; }
      (names || []).forEach(function (name) { if (!keep[name]) quietly(function () { fsApi.unlinkSync(dir + '/' + name); }); });
    }
    function fetchRemote(fsApi, remote, item) {
      var env = wxApi.env, base = env && env.USER_DATA_PATH;
      if (typeof base !== 'string' || !base) return Promise.reject(error('RESOURCE_READER_API_UNAVAILABLE', new Error('USER_DATA_PATH unavailable')));
      var dir = base + '/' + CACHE_DIR, done = dir + '/' + item.sha256 + '.bin', part = done + '.part';
      quietly(function () { fsApi.mkdirSync(dir, true); });
      pruneCache(fsApi, dir);
      if (fileSize(fsApi, done) === item.bytes) return Promise.resolve(done);
      quietly(function () { fsApi.unlinkSync(done); }); quietly(function () { fsApi.unlinkSync(part); });
      return invoke(method(wxApi, 'downloadFile'), wxApi, {url:remote.url, filePath:part}, 'RESOURCE_READER_REMOTE_DOWNLOAD').then(function (res) {
        var status = ownData(res, 'statusCode'), size = status === 200 ? fileSize(fsApi, part) : -1;
        if (status !== 200 || size !== item.bytes) {
          quietly(function () { fsApi.unlinkSync(part); });
          if (typeof console !== 'undefined') console.error('[wxslim] CDN 分包下载结果不对', item.id, remote.url, 'HTTP', status, '大小', size, '应为', item.bytes);
          throw error(status !== 200 ? 'RESOURCE_READER_REMOTE_HTTP' : 'RESOURCE_READER_REMOTE_SIZE', {statusCode:status, expected:item.bytes, actual:size});
        }
        try { fsApi.renameSync(part, done); } catch (cause) { throw error('RESOURCE_READER_REMOTE_CACHE', cause); }
        return done;
      }, function (cause) {
        quietly(function () { fsApi.unlinkSync(part); });
        var text = ownData(cause && cause.cause, 'errMsg');
        if (typeof console !== 'undefined') console.error('[wxslim] CDN 分包下载失败', item.id, remote.url, typeof text === 'string' ? text.slice(0, 300) : '');
        // 最常见的原因：CDN 域名没加进小游戏后台的 downloadFile 合法域名，或手机预览没打开「开发调试」。
        if (typeof text === 'string' && /domain|域名/i.test(text)) throw error('RESOURCE_READER_REMOTE_DOMAIN', cause.cause);
        throw cause;
      });
    }
    return Object.freeze({read:function (id) {
      if (busy) return Promise.reject(error('RESOURCE_READER_BUSY', new Error('reader already has an in-flight read')));
      busy = true;
      var item, fsApi, read, response, owned, length, filePath;
      // No platform calls during script/factory creation, or before this microtask.
      return Promise.resolve().then(function () {
        if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(allow, id)) throw error('RESOURCE_READER_UNKNOWN_PACK', new TypeError('pack is not allowlisted'));
        item = allow[id]; return checkCancelled();
      }).then(function () { return observe('LOAD_REQUESTED', item); }).then(checkCancelled).then(function () {
        var getFs = method(wxApi, 'getFileSystemManager');
        try { fsApi = getFs.call(wxApi); }
        catch (cause) { throw error('RESOURCE_READER_API_UNAVAILABLE', cause); }
        var remote = remoteEntry(fsApi, item);
        if (remote) return fetchRemote(fsApi, remote, item).then(function (file) { filePath = file; });
        filePath = item.file;
        return invoke(method(wxApi, 'loadSubpackage'), wxApi, {name:item.id}, 'RESOURCE_READER_LOAD_FAILED');
      }).then(function () { return observe('LOAD_SUCCEEDED', item); }).then(checkCancelled).then(function () {
        read = method(fsApi, 'readFile'); return observe('READ_REQUESTED', item);
      }).then(checkCancelled).then(function () {
        return invoke(read, fsApi, {filePath:filePath}, 'RESOURCE_READER_READ_FAILED'); // No encoding: ArrayBuffer.
      }).then(function (value) { response = value; return checkCancelled(); }).then(function () {
        var data;
        try { data = response.data; length = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(data); }
        catch (cause) { throw error('RESOURCE_READER_DATA_TYPE', cause); }
        if (length !== item.bytes) throw error('RESOURCE_READER_SIZE_MISMATCH', {expected:item.bytes, actual:length});
        var header;
        try { header = new Uint8Array(data, 0, 4); }
        catch (cause) { throw error('RESOURCE_READER_DATA_TYPE', cause); }
        if (header[0] !== 71 || header[1] !== 68 || header[2] !== 80 || header[3] !== 67) throw error('RESOURCE_READER_PCK_HEADER', {header:Array.prototype.slice.call(header)});
        try { owned = new Uint8Array(ArrayBuffer.prototype.slice.call(data, 0)); }
        catch (cause) { throw error('RESOURCE_READER_DATA_TYPE', cause); }
        return observe('READ_PENDING_HASH_VERIFICATION', item);
      }).then(checkCancelled).then(function () {
        // Caller owns this copy after completion; multiple retained results are not a memory quota.
        return {status:'READ_PENDING_HASH_VERIFICATION', id:item.id, bytes:owned, expectedHash:item.sha256, length:length,
          hashVerified:false, artifactIntegrityChecked:false, runtimeVerified:false, executionAuthorized:false};
      }).then(function (result) {
        busy = false; return result;
      }, function (cause) {
        busy = false; throw cause;
      });
    }});
  }
  if (typeof module === 'object' && module && module.exports) module.exports = createResourceSubpackageReader;
  else root.__WXSLIM_CREATE_RESOURCE_READER__ = createResourceSubpackageReader;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : typeof globalThis !== 'undefined' ? globalThis : this);
