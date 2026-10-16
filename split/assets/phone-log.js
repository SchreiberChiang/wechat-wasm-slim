'use strict';

// Load before the adapter/engine. This does not change engine or WASM assets.
function installPhoneLog(wx, targetConsole, config) {
  if (!config || !config.enabled) return null;
  if (!config.env || !config.build) throw new Error('phone-log requires env and build');
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return null;
  var previous = targetConsole.__phoneLogRelay;
  if (previous) return previous;
  var session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  var queue = [], seq = 0, dropped = 0, busy = false, stopped = false;
  var failures = 0, retryAt = 0, lastError = null, timer;
  var originals = {}, hooks = [];
  var device = {};
  try {
    var info = wx.getSystemInfoSync();
    device = { platform: info.platform || 'unknown', system: info.system || '',
      model: info.model || '', SDKVersion: info.SDKVersion || '' };
  } catch (_) { device.platform = 'unknown'; }
  var maxQueue = 256, maxBatch = 24;
  function scrub(text) {
    return text
      .replace(/((?:authorization|cookie)\s*[=:]\s*)[^\r\n]+/gi, '$1[redacted]')
      .replace(/((?:token|secret|password|openid|unionid)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
  }
  function render(value) {
    try {
      if (value instanceof Error) return scrub(value.stack || value.message).slice(0, 4096);
      var seen = [];
      var text = typeof value === 'string' ? value : JSON.stringify(value, function (key, item) {
        if (/token|secret|password|authorization|cookie|openid|unionid/i.test(key)) return '[redacted]';
        if (item && typeof item === 'object') {
          if (seen.indexOf(item) !== -1) return '[circular]';
          seen.push(item);
        }
        return item;
      });
      return scrub(String(text)).slice(0, 4096);
    } catch (_) { return '[unserializable]'; }
  }
  function record(level, args) {
    if (stopped) return;
    var message = args.map(render).join(' ').slice(0, 4096);
    if (typeof config.keep === 'function' && !config.keep(level, message)) return;
    queue.push({ seq: ++seq, at: Date.now(), level: level, message: message });
    if (queue.length > maxQueue) { queue.shift(); dropped++; }
  }
  function failed(error) {
    busy = false; failures++;
    lastError = render(error && (error.errMsg || error.message) || error);
    retryAt = Date.now() + Math.min(30000, 1000 * Math.pow(2, Math.min(failures, 5)));
  }
  function flush() {
    if (stopped || busy || !queue.length || Date.now() < retryAt) return;
    var batch = queue.slice(0, maxBatch);
    var dropCount = dropped;
    busy = true;
    try {
      wx.cloud.callFunction({ name: config.functionName || 'phoneLogIngest',
        config: { env: config.env },
        data: { schema: 1, build: config.build, session: session,
          device: device,
          batchId: String(batch[0].seq) + '-' + String(batch[batch.length - 1].seq),
          dropped: dropCount, entries: batch },
        success: function (response) {
          if (!response || !response.result || response.result.ok !== true) {
            failed('ingest rejected batch'); return;
          }
          var end = batch[batch.length - 1].seq;
          queue = queue.filter(function (entry) { return entry.seq > end; });
          dropped = Math.max(0, dropped - dropCount);
          busy = false; failures = 0; retryAt = 0; lastError = null;
        }, fail: failed });
    } catch (error) { failed(error); }
  }
  var api = {
    session: session, flush: flush,
    status: function () { return { session: session, build: config.build, queued: queue.length,
      dropped: dropped, busy: busy, failures: failures, lastError: lastError }; },
    stop: function () {
      stopped = true; clearInterval(timer);
      Object.keys(originals).forEach(function (level) { targetConsole[level] = originals[level]; });
      hooks.forEach(function (hook) { if (typeof wx[hook[1]] === 'function') wx[hook[1]](hook[2]); });
      delete targetConsole.__phoneLogRelay;
    }
  };
  // Telemetry must not stop the game if CloudBase is unavailable.
  try { wx.cloud.init({ env: config.env, traceUser: false }); }
  catch (_) { return null; }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    if (typeof targetConsole[level] !== 'function') return;
    originals[level] = targetConsole[level];
    targetConsole[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      originals[level].apply(targetConsole, args);
      record(level, args);
    };
  });
  function hook(on, off, callback) {
    if (typeof wx[on] === 'function') { wx[on](callback); hooks.push([on, off, callback]); }
  }
  hook('onError', 'offError', function (error) { record('error', [error]); flush(); });
  hook('onUnhandledRejection', 'offUnhandledRejection', function (event) {
    record('error', ['unhandledRejection', event.reason]); flush();
  });
  hook('onHide', 'offHide', flush);
  hook('onShow', 'offShow', flush);
  targetConsole.__phoneLogRelay = api;
  record('info', ['PHONE_LOG_START', config.build, session, device]);
  timer = setInterval(flush, 1000);
  return api;
}
module.exports = { installPhoneLog: installPhoneLog };
