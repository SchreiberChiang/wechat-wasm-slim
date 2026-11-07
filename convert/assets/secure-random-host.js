/* SOURCE_ONLY: explicit raw-entropy transport for an independent DRBG seed callback.
 * No installation, browser selection, wx call or timer occurs at factory creation.
 * This is NOT a game random API and makes no claim about device verification.
 *
 * options: explicit wx, setTimeout(fn,ms), clearTimeout(handle); optional integers:
 * requestBytes=4096 (1..1048576), maxBytes=8192 (requestBytes..1048576),
 * lowWaterBytes=1024 (0..maxBytes-requestBytes), timeoutMs=5000 (1..2147483647).
 * Override lowWaterBytes when reducing maxBytes. Timers must run asynchronously.
 * maxBytes bounds the queue plus a pending receipt; take may additionally own a
 * temporary scratch of at most maxBytes. Platform-owned source buffers excluded.
 * prepare() is idempotent while pending/READY and resolves a fixed READY receipt.
 * take(Uint8Array) returns its exact nonzero length, or throws a fixed-code Error.
 * It accepts ordinary ArrayBuffer-backed Uint8Array views (including subviews),
 * rejects shared/detached buffers, and writes all requested bytes or none.
 * Low-water scheduling happens before the target write, so timer failures cannot
 * turn a failed take into a partial/successful write. No wx request starts in take.
 * assertReady() checks health on EVERY DRBG output, not only when taking a seed.
 * status() is read-only and exposes only fixed vocabulary, booleans and counts.
 * close() always wins, including during injected dependency calls. Other mutating
 * reentry fails closed. A timer firing before setTimeout returns is a failure.
 * First API receipt wins, but synchronous success is committed only AFTER the
 * platform call and timeout cleanup return: success-then-throw cannot start WASM.
 * A throw in platform code after an ASYNCHRONOUS callback has returned is outside
 * this module's call stack and cannot be inferred or attributed here.
 * Any acquisition/timer/length/exhaustion/reentry failure latches FAILED. No retry,
 * weak fallback or seed reuse. Late receipts cannot revive FAILED/CLOSED.
 * Owned queue/scratch copies are wiped; platform-owned buffers, caller output,
 * VM copies and an independent C DRBG context are outside this wipe guarantee.
 */
(function () { 'use strict';
const U8 = Uint8Array;
const setBytes = U8.prototype.set;
const fillBytes = U8.prototype.fill;
const typed = Object.getPrototypeOf(U8.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const typedBuffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const typedTag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const arrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
function fixedError(code) { const error = new Error(code); error.code = code; return error; }
function createSecureRandomHost(options) {
  let wx, setTimer, clearTimer, requestBytes, maxBytes, lowWaterBytes, timeoutMs;
  try {
    wx = options && options.wx; setTimer = options && options.setTimeout; clearTimer = options && options.clearTimeout;
    requestBytes = options.requestBytes === undefined ? 4096 : options.requestBytes;
    maxBytes = options.maxBytes === undefined ? 8192 : options.maxBytes;
    lowWaterBytes = options.lowWaterBytes === undefined ? 1024 : options.lowWaterBytes;
    timeoutMs = options.timeoutMs === undefined ? 5000 : options.timeoutMs;
  } catch (_) { throw new TypeError('SECURE_RANDOM_OPTIONS'); }
  if (!wx || typeof wx !== 'object' || typeof setTimer !== 'function' || typeof clearTimer !== 'function')
    throw new TypeError('SECURE_RANDOM_DEPENDENCIES');
  if (!Number.isSafeInteger(requestBytes) || requestBytes < 1 || requestBytes > 1048576
      || !Number.isSafeInteger(maxBytes) || maxBytes < requestBytes || maxBytes > 1048576
      || !Number.isSafeInteger(lowWaterBytes) || lowWaterBytes < 0 || lowWaterBytes > maxBytes - requestBytes
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
    throw new TypeError('SECURE_RANDOM_BUDGET');
  let state = 'NEW', errorCode = null, busy = false, manager = null, acquire = null;
  let availableBytes = 0, requestCount = 0, successCount = 0, consumedBytes = 0;
  let ignoredCallbacks = 0, cleanupFailureCount = 0, failureCount = 0;
  let queue = [], pending = null, refill = null, preparation = null, resolvePrepare, rejectPrepare;
  let preparationSettled = false;
  const timers = new Set();
  function terminal() { return state === 'FAILED' || state === 'CLOSED'; }
  function wipe(bytes) { if (bytes) fillBytes.call(bytes, 0); }
  function rejection() { return fixedError(errorCode || 'SECURE_RANDOM_NOT_READY'); }
  function settleFailure() {
    if (preparation && !preparationSettled) { preparationSettled = true; rejectPrepare(rejection()); }
  }
  function cancelTimer(record) {
    if (!record) return;
    record.active = false; timers.delete(record);
    if (!record.hasHandle || record.clearAttempted || record.fired) return;
    record.clearAttempted = true;
    try { clearTimer(record.handle); }
    catch (_) { cleanupFailureCount++; fail('SECURE_RANDOM_TIMER_CLEAR_THROW'); }
  }
  function erase() {
    for (const chunk of queue) wipe(chunk.bytes);
    queue = []; availableBytes = 0;
    if (pending) { pending.active = false; wipe(pending.receipt); pending.receipt = null; pending = null; }
    refill = null;
    for (const record of Array.from(timers)) cancelTimer(record);
  }
  function fail(code) {
    if (!terminal()) { state = 'FAILED'; errorCode = code; failureCount++; }
    // Erase before any injected clearTimeout call, which may throw/reenter.
    erase(); settleFailure();
  }
  function reentry() { fail('SECURE_RANDOM_REENTRANT'); return rejection(); }
  function timer(callback, delay) {
    const record = {active: true, setting: true, fired: false, hasHandle: false, clearAttempted: false};
    timers.add(record);
    try {
      record.handle = setTimer(function () {
        if (!record.active || terminal()) return;
        if (record.setting) { fail('SECURE_RANDOM_TIMER_REENTRANT'); return; }
        record.active = false; record.fired = true; timers.delete(record);
        if (busy) { fail('SECURE_RANDOM_REENTRANT'); return; }
        busy = true;
        try { callback(); } catch (_) { fail('SECURE_RANDOM_INTERNAL'); }
        finally { busy = false; }
      }, delay);
      record.hasHandle = true;
    } catch (_) { fail('SECURE_RANDOM_TIMER_SET_THROW'); }
    finally { record.setting = false; }
    if (!record.active || terminal()) cancelTimer(record);
    return record;
  }
  function finishReceipt(record) {
    if (!record.active || terminal() || !record.receipt || record.calling) return;
    const bytes = record.receipt; record.receipt = null;
    record.active = false; pending = null;
    cancelTimer(record.timer);
    if (terminal()) { wipe(bytes); return; }
    if (availableBytes + bytes.byteLength > maxBytes) { wipe(bytes); fail('SECURE_RANDOM_CAPACITY'); return; }
    queue.push({bytes, offset: 0}); availableBytes += bytes.byteLength; successCount++;
    state = 'READY';
    if (!preparationSettled) {
      preparationSettled = true;
      resolvePrepare(Object.freeze({state: 'READY', code: 'SECURE_RANDOM_READY'}));
    }
  }
  function receive(record, value, success) {
    if (!record.active || terminal() || record.received) { ignoredCallbacks++; return; }
    if (busy && !record.calling) { fail('SECURE_RANDOM_REENTRANT'); return; }
    const previousBusy = busy; busy = true; record.received = true;
    try {
      if (!success) { fail('SECURE_RANDOM_API_FAILED'); return; }
      let raw, copy;
      try {
        raw = value.randomValues;
        if (arrayLength.call(raw) !== requestBytes) { fail('SECURE_RANDOM_LENGTH'); return; }
        if (terminal()) return;
        copy = new U8(requestBytes); setBytes.call(copy, new U8(raw));
      } catch (_) { wipe(copy); fail('SECURE_RANDOM_RESULT'); return; }
      if (terminal()) { wipe(copy); return; }
      record.receipt = copy;
      finishReceipt(record);
    } finally { busy = previousBusy; }
  }
  function request() {
    if (terminal() || pending) return;
    if (availableBytes + requestBytes > maxBytes) { fail('SECURE_RANDOM_CAPACITY'); return; }
    const record = {active: true, received: false, calling: false, receipt: null, timer: null};
    pending = record;
    record.timer = timer(() => { if (record.active) fail('SECURE_RANDOM_TIMEOUT'); }, timeoutMs);
    if (terminal() || !record.active) return;
    record.calling = true; requestCount++;
    try {
      acquire.call(manager, {length: requestBytes,
        success: value => receive(record, value, true),
        fail: () => receive(record, null, false)});
    } catch (_) { fail('SECURE_RANDOM_CALL_THROW'); }
    finally { record.calling = false; }
    finishReceipt(record);
  }
  function scheduleRefill(remaining) {
    if (terminal() || pending || refill || remaining > lowWaterBytes) return;
    const record = timer(() => {
      refill = null;
      if (state === 'READY' && availableBytes <= lowWaterBytes) request();
    }, 0);
    if (record.active && !terminal()) refill = record;
  }
  function prepare() {
    if (busy) { const error = reentry(); return Promise.reject(error); }
    if (terminal()) return Promise.reject(rejection());
    if (preparation) return preparation;
    preparation = new Promise((resolve, reject) => { resolvePrepare = resolve; rejectPrepare = reject; });
    // It can reject inside a synchronous injected dependency before return.
    // This handler prevents an internal unhandled event; returned promise still rejects.
    preparation.catch(() => {});
    state = 'PREPARING'; busy = true;
    try {
      try {
        const getManager = wx.getUserCryptoManager;
        if (typeof getManager !== 'function') { fail('SECURE_RANDOM_MANAGER'); return preparation; }
        if (terminal()) return preparation;
        manager = getManager.call(wx);
        if (terminal()) return preparation;
        acquire = manager && manager.getRandomValues;
        if (typeof acquire !== 'function') { fail('SECURE_RANDOM_MANAGER'); return preparation; }
      } catch (_) { fail('SECURE_RANDOM_MANAGER_THROW'); return preparation; }
      if (!terminal()) request();
    } finally { busy = false; }
    return preparation;
  }
  function assertReady() {
    if (busy) throw reentry();
    if (state !== 'READY') throw rejection();
  }
  function take(target) {
    if (busy) throw reentry();
    busy = true;
    let scratch;
    try {
      if (state !== 'READY') { if (!terminal()) fail('SECURE_RANDOM_NOT_READY'); throw rejection(); }
      let length;
      try {
        if (typedTag.call(target) !== 'Uint8Array') throw 0;
        length = typedLength.call(target);
        arrayLength.call(typedBuffer.call(target)); // Reject SharedArrayBuffer.
        if (length < 1 || length > maxBytes) throw 0;
        new U8(typedBuffer.call(target)); // Reject detached ArrayBuffer, including zero-length views.
      } catch (_) { fail('SECURE_RANDOM_TARGET'); throw rejection(); }
      if (length > availableBytes) { fail('SECURE_RANDOM_EXHAUSTED'); throw rejection(); }
      try {
        scratch = new U8(length);
        let position = 0;
        for (const chunk of queue) {
          const count = Math.min(length - position, chunk.bytes.byteLength - chunk.offset);
          setBytes.call(scratch, new U8(chunk.bytes.buffer, chunk.offset, count), position);
          position += count; if (position === length) break;
        }
      } catch (_) { fail('SECURE_RANDOM_INTERNAL'); throw rejection(); }
      scheduleRefill(availableBytes - length);
      if (terminal()) throw rejection();
      // No injected call between this single intrinsic write and queue consumption.
      try {
        if (typedLength.call(target) !== length) throw 0;
        new U8(typedBuffer.call(target));
        setBytes.call(target, scratch);
      } catch (_) { fail('SECURE_RANDOM_TARGET'); throw rejection(); }
      let remaining = length;
      while (remaining) {
        const chunk = queue[0], count = Math.min(remaining, chunk.bytes.byteLength - chunk.offset);
        fillBytes.call(chunk.bytes, 0, chunk.offset, chunk.offset + count);
        chunk.offset += count; remaining -= count;
        if (chunk.offset === chunk.bytes.byteLength) queue.shift();
      }
      availableBytes -= length; consumedBytes += length;
      return length;
    } finally { wipe(scratch); busy = false; }
  }
  function close() {
    if (state === 'CLOSED') return status();
    const previousBusy = busy; busy = true;
    state = 'CLOSED'; if (!errorCode) errorCode = 'SECURE_RANDOM_CLOSED';
    try { erase(); settleFailure(); } finally { busy = previousBusy; }
    return status();
  }
  function status() {
    return Object.freeze({state, errorCode, availableBytes, requestCount, successCount, consumedBytes,
      ignoredCallbacks, cleanupFailureCount, failureCount, requestPending: pending !== null, refillScheduled: refill !== null});
  }
  return Object.freeze({prepare, take, assertReady, close, status});
}
if (typeof module === 'object' && module.exports) module.exports = createSecureRandomHost;
}());
