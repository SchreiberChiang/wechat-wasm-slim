/* SOURCE_ONLY. Explicit SocketTask session core; not a browser WebSocket,
 * host installation, network queue, delivery receipt, timer or retry policy.
 */
(function () { 'use strict';
function createSocketTaskSession(options) {
  const connectSocket = options && options.connectSocket;
  const emit = options && options.emit;
  const maxBytes = options && options.maxPendingBytes;
  const maxSends = options && options.maxPendingSends;
  function requireValue(ok, code) { if (!ok) throw new TypeError(code); }
  requireValue(typeof connectSocket === 'function', 'SOCKET_CONNECT_REQUIRED');
  requireValue(typeof emit === 'function', 'SOCKET_EMIT_REQUIRED');
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 0, 'SOCKET_BYTE_BUDGET_REQUIRED');
  requireValue(Number.isSafeInteger(maxSends) && maxSends > 0, 'SOCKET_SEND_BUDGET_REQUIRED');
  const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  let state = 'IDLE', task = null, alive = true, installing = false, queued = [];
  let connectApiStatus = 'NOT_CALLED', closeApiStatus = 'NOT_CALLED';
  let lastError = null, actualCloseCode = null, closeReasonKnown = false;
  let closedObserved = false, observedCloseReason;
  let pendingBytes = 0, sequence = 0, cleanupFailureCount = 0, detachUnavailableCount = 0;
  let activeCall = null, suppressObserver = false;
  const pending = new Map(), subscriptions = [];

  function utf8Length(text) {
    let size = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) size++;
      else if (code < 0x800) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
        && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
      else size += 3; // Lone surrogate follows UTF-8 replacement encoding.
    }
    return size;
  }
  function snapshot() {
    return Object.freeze({schema: 'wxslim-websocket-task-session-v1', preparation: 'SOURCE_ONLY',
      state, connectApiStatus, closeApiStatus, lastError, actualCloseCode, closeReasonKnown, closedObserved,
      pendingApiBytes: pendingBytes, pendingApiCount: pending.size,
      cleanupFailureCount, detachUnavailableCount});
  }
  function publish(type, fields, payload) {
    if (!alive || suppressObserver) return;
    const event = Object.assign({type}, snapshot(), fields);
    if (payload !== undefined) Object.defineProperty(event, 'payload', {value: payload, enumerable: false});
    try { emit(Object.freeze(event)); }
    catch (error) {
      if (activeCall && !activeCall.observerError) activeCall.observerError = {error};
      throw error;
    }
  }
  // Never turn an observer's exception into a SocketTask failure.
  function platform(action, failed) {
    const previous = activeCall, call = {observerError: null};
    activeCall = call;
    try {
      const value = action();
      if (call.observerError) throw call.observerError.error;
      return value;
    } catch (error) {
      if (call.observerError) throw call.observerError.error;
      return failed();
    } finally { activeCall = previous; }
  }
  function packet(value, measureOnly) {
    if (typeof value === 'string') return {data: value, bytes: utf8Length(value), kind: 'TEXT'};
    let buffer = value, offset = 0, length;
    if (ArrayBuffer.isView(value)) {
      buffer = value.buffer; offset = value.byteOffset; length = value.byteLength;
    }
    const total = byteLength.call(buffer); // Rejects unknown and SharedArrayBuffer data.
    if (length === undefined) length = total;
    const view = new Uint8Array(buffer, offset, length);
    if (measureOnly) return {view, bytes: length, kind: 'BINARY'};
    const copy = new Uint8Array(view);
    return {data: copy.buffer, bytes: copy.byteLength, kind: 'BINARY'};
  }
  function finish(entry, status) {
    if (!pending.has(entry.id)) return;
    pending.delete(entry.id); pendingBytes -= entry.bytes; entry.status = status;
    publish('SEND_TERMINAL', {sendId: entry.id, status, bytes: entry.bytes});
  }
  function cancelAll(status) {
    const entries = Array.from(pending.values());
    pending.clear(); pendingBytes = 0;
    for (const entry of entries) entry.status = status;
    return entries;
  }
  function reportCancelled(entries) {
    for (const entry of entries) publish('SEND_TERMINAL', {sendId: entry.id, status: entry.status, bytes: entry.bytes});
  }
  function detach() {
    const all = subscriptions.splice(0);
    for (const sub of all) {
      try {
        const off = task[sub.off];
        if (typeof off === 'function') off.call(task, sub.listener);
        else detachUnavailableCount++;
      } catch (_) { cleanupFailureCount++; }
    }
  }
  function cleanupClose() {
    if (!task || closedObserved) return;
    let terminal = false;
    try {
      task.close({success: function () { terminal = true; }, fail: function () {
        if (!terminal) { terminal = true; cleanupFailureCount++; }
      }});
    } catch (_) { terminal = true; cleanupFailureCount++; }
  }
  function invalidate(nextState, code) {
    if (nextState === 'DISPOSED') alive = false;
    state = nextState === 'FAILED' && closedObserved ? 'CLOSED' : nextState;
    lastError = code;
    queued = []; installing = false;
    cancelAll(nextState === 'DISPOSED' ? 'CANCELLED_DISPOSED' : 'CANCELLED_SETUP');
    detach(); cleanupClose();
  }
  function recordClose(value) {
    if (closedObserved) return;
    closedObserved = true;
    try {
      const code = value && value.code;
      actualCloseCode = Number.isInteger(code) && code >= 0 && code <= 65535 ? code : null;
      const reason = value && value.reason;
      if (typeof reason === 'string') { observedCloseReason = reason; closeReasonKnown = true; }
    } catch (_) { lastError = 'CLOSE_EVENT_FIELDS_INVALID'; }
  }
  function publishClose() {
    publish('CLOSE', {}, closeReasonKnown ? Object.freeze({reason: observedCloseReason}) : undefined);
  }
  function receive(type, value) {
    if (!alive || state === 'CLOSED' || state === 'FAILED') return;
    if (installing) {
      // Snapshot message bytes at callback time, not after registration returns.
      let captured;
      if (type === 'MESSAGE') {
        try { captured = {data: packet(value && value.data).data}; }
        catch (_) { captured = null; }
      } else if (type === 'CLOSE') {
        try { captured = {code: value && value.code, reason: value && value.reason}; }
        catch (_) { captured = null; }
        recordClose(captured);
      }
      queued.push([type, captured]); return;
    }
    if (type === 'OPEN') {
      if (state !== 'CONNECTING') return;
      state = 'OPEN'; publish('OPEN');
    } else if (type === 'MESSAGE') {
      if (state !== 'OPEN' && state !== 'CLOSING') return;
      let data;
      try { data = packet(value && value.data); }
      catch (_) { lastError = 'MESSAGE_DATA_INVALID'; publish('MESSAGE_REJECTED'); return; }
      publish('MESSAGE', {bytes: data.bytes, kind: data.kind}, Object.freeze({data: data.data}));
    } else if (type === 'ERROR') {
      lastError = 'SOCKET_ERROR';
      publish('ERROR'); // No inferred close, close code, or send receipt.
    } else if (type === 'CLOSE') {
      recordClose(value);
      state = 'CLOSED';
      const cancelled = cancelAll('CANCELLED_CLOSED');
      // Internal state and all counters are final before any observer runs.
      detach();
      publishClose();
      reportCancelled(cancelled);
    }
  }
  function start(config) {
    requireValue(alive && state === 'IDLE', 'SOCKET_START_ONCE');
    const url = config && config.url, protocols = config && config.protocols === undefined ? [] : config && config.protocols;
    const address = typeof url === 'string' && /^wss:\/\/(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]+))?(?:[/?][^\s#]*)?$/.exec(url);
    requireValue(address && !/[\x00-\x20\x7f\\]/.test(url)
      && (address[2] === undefined || (Number(address[2]) > 0 && Number(address[2]) <= 65535)), 'SOCKET_WSS_URL_REQUIRED');
    requireValue(Array.isArray(protocols) && protocols.every(p => typeof p === 'string'
      && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(p)) && new Set(protocols).size === protocols.length,
    'SOCKET_PROTOCOLS_INVALID');
    state = 'CONNECTING'; connectApiStatus = 'PENDING'; installing = true;
    let apiTerminal = false, setupFailed = false;
    function api(status) {
      if (!alive || state === 'FAILED' || apiTerminal) return;
      apiTerminal = true; connectApiStatus = status;
      if (status === 'FAILED') { setupFailed = true; lastError = 'CONNECT_API_FAILED'; }
      if (!installing) {
        // A late API failure is evidence about API acceptance, never a
        // replacement for an already observed socket lifecycle event.
        if (setupFailed && state === 'CONNECTING') {
          invalidate('FAILED', 'CONNECT_API_FAILED');
          publish('CONNECT_FAILED');
          return;
        }
        publish('CONNECT_API', {status});
      }
    }
    platform(function () {
      task = connectSocket({url, protocols: protocols.slice(), success: () => api('SUCCESS'), fail: () => api('FAILED')});
      if (!task || (typeof task !== 'object' && typeof task !== 'function')) { setupFailed = true; lastError = 'CONNECT_TASK_INVALID'; }
      if (!setupFailed) {
        if (typeof task.send !== 'function' || typeof task.close !== 'function') throw new TypeError('SOCKET_TASK_METHOD_REQUIRED');
        for (const pair of [['onOpen', 'offOpen', 'OPEN'], ['onMessage', 'offMessage', 'MESSAGE'],
          ['onError', 'offError', 'ERROR'], ['onClose', 'offClose', 'CLOSE']]) {
          const listener = value => receive(pair[2], value);
          subscriptions.push({off: pair[1], listener});
          const subscribe = task[pair[0]];
          if (typeof subscribe !== 'function') throw new TypeError('SOCKET_SUBSCRIPTION_REQUIRED');
          subscribe.call(task, listener);
        }
      }
    }, function () { setupFailed = true; lastError = 'CONNECT_SETUP_THROW'; });
    if (setupFailed) {
      invalidate('FAILED', lastError);
      // Preserve a real close observed during registration, without replaying
      // OPEN/MESSAGE from an installation that never completed.
      if (closedObserved) publishClose();
      publish('CONNECT_FAILED');
      return snapshot();
    }
    installing = false;
    const events = queued; queued = [];
    // Commit every event already observed during registration even if an
    // observer throws. Suppress further delivery, then rethrow the first value.
    let observerFailure = null;
    try {
      if (apiTerminal) {
        try { publish('CONNECT_API', {status: connectApiStatus}); }
        catch (error) { observerFailure = {error}; suppressObserver = true; }
      }
      for (const event of events) {
        try { receive(event[0], event[1]); }
        catch (error) { if (!observerFailure) observerFailure = {error}; suppressObserver = true; }
      }
    } finally { suppressObserver = false; }
    if (observerFailure) throw observerFailure.error;
    return snapshot();
  }
  function send(value) {
    requireValue(alive && state === 'OPEN', 'SOCKET_NOT_OPEN');
    let data;
    try { data = packet(value, true); }
    catch (_) { lastError = 'SEND_DATA_INVALID'; publish('SEND_REJECTED', {status: 'INVALID_DATA'}); return null; }
    if (pending.size >= maxSends || data.bytes > maxBytes - pendingBytes) {
      lastError = 'SEND_BUDGET_EXCEEDED'; publish('SEND_REJECTED', {status: 'BUDGET_EXCEEDED', bytes: data.bytes}); return null;
    }
    if (data.kind === 'BINARY') {
      try { data.data = new Uint8Array(data.view).buffer; }
      catch (_) { lastError = 'SEND_DATA_INVALID'; publish('SEND_REJECTED', {status: 'INVALID_DATA'}); return null; }
    }
    requireValue(sequence < Number.MAX_SAFE_INTEGER, 'SOCKET_SEQUENCE_EXHAUSTED');
    const entry = {id: ++sequence, bytes: data.bytes, status: 'PENDING'};
    const receipt = Object.freeze({id: entry.id, bytes: entry.bytes, get status() { return entry.status; }});
    pending.set(entry.id, entry); pendingBytes += entry.bytes;
    platform(function () {
      task.send({data: data.data, success: () => { if (alive) finish(entry, 'API_SUCCESS'); },
        fail: () => { if (alive) finish(entry, 'API_FAILED'); }});
    }, function () {
      lastError = 'SEND_CALL_THROW';
      // A prior real API receipt remains terminal; a subsequent synchronous
      // throw is still recorded rather than disappearing as apparent success.
      finish(entry, 'API_THROW');
    });
    return receipt;
  }
  function close(config) {
    requireValue(alive && (state === 'OPEN' || state === 'CONNECTING'), 'SOCKET_CLOSE_STATE_INVALID');
    const code = config && config.code, reason = config && config.reason;
    requireValue(code === undefined || code === 1000 || (Number.isInteger(code) && code >= 3000 && code <= 4999), 'SOCKET_CLOSE_CODE_INVALID');
    requireValue(reason === undefined || (typeof reason === 'string' && utf8Length(reason) <= 123), 'SOCKET_CLOSE_REASON_INVALID');
    state = 'CLOSING'; closeApiStatus = 'PENDING';
    let terminal = false;
    function done(status) {
      if (!alive || terminal) return;
      terminal = true; closeApiStatus = status;
      if (status !== 'SUCCESS') lastError = 'CLOSE_API_FAILED';
      publish('CLOSE_API', {status});
    }
    const args = {success: () => done('SUCCESS'), fail: () => done('FAILED')};
    if (code !== undefined) args.code = code;
    if (reason !== undefined) args.reason = reason;
    platform(() => task.close(args), () => {
      done('THREW');
      lastError = 'CLOSE_CALL_THROW';
    });
    return snapshot();
  }
  function dispose() {
    if (state !== 'DISPOSED') invalidate('DISPOSED', lastError);
    return snapshot();
  }
  return Object.freeze({start, send, close, dispose, snapshot});
}
if (typeof module === 'object' && module.exports) module.exports = createSocketTaskSession;
}());
