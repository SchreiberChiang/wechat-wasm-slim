/* SOURCE_ONLY. Explicit ownership of the existing entropy host; no DRBG here.
 * Hook failures throw their original value. Native termination runs outside the
 * entropy hook stack, never as a reentrant C export from its seed callback.
 */
(function () { 'use strict';
function createSecureRandomLifecycle(options) {
  const module = options.module;
  if (!module || typeof module !== 'object' || typeof options.createSecureRandomHost !== 'function')
    throw new TypeError('SECURE_RANDOM_LIFECYCLE_OPTIONS');
  const names = ['__wxslimSecureRandomMode', '__wxslimEntropyTake', '__wxslimEntropyAssertReady'];
  for (const name of names) if (name in module) throw new Error('SECURE_RANDOM_HOOK_OWNERSHIP');
  const host = options.createSecureRandomHost({wx: options.wx,
    setTimeout: options.setTimeout, clearTimeout: options.clearTimeout});
  let closed = false, prepared = false, installed = false, preparation = null;
  let native = null, nativeAttempted = false, nativeState = 'UNBOUND_UNKNOWN';
  let hookDepth = 0, deferred = false, cleanupFailures = 0, diagnosticFailures = 0;
  let inspecting = false, nativeFault = false;
  function publish() {
    try { if (typeof options.onStatus === 'function') options.onStatus(status()); }
    catch (_) { diagnosticFailures = Math.min(65535, diagnosticFailures + 1); }
  }
  function unknown(code) {
    nativeState = code;
    if (!nativeFault) { nativeFault = true; cleanupFailures++; }
  }
  function discoverNative() {
    if (inspecting) return false;
    inspecting = true;
    try {
      // Factory rejection can precede ready/bindNative, even after C used the
      // DRBG. Inspect only our captured Module, outside any entropy hook stack.
      const descriptor = Object.getOwnPropertyDescriptor(module, '_godot_wechat_random_buffer');
      if (!descriptor) {
        if (native) unknown('EXPORT_CHANGED_UNKNOWN');
        else nativeState = 'UNBOUND_UNKNOWN';
        return false;
      }
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        unknown('EXPORT_ACCESSOR_UNKNOWN'); return false;
      }
      if (typeof descriptor.value !== 'function') {
        unknown('EXPORT_INVALID_UNKNOWN'); return false;
      }
      if (native && native !== descriptor.value) {
        unknown('EXPORT_CHANGED_UNKNOWN'); return false;
      }
      native = descriptor.value;
      nativeState = 'BOUND';
      return true;
    } catch (_) { unknown('EXPORT_UNREADABLE_UNKNOWN'); return false; }
    finally { inspecting = false; }
  }
  function terminateNative() {
    if (!closed || nativeAttempted || hookDepth || !discoverNative()) return;
    nativeAttempted = true;
    try { native.call(module, 0); nativeState = 'TERMINATED'; }
    catch (_) { nativeState = 'TERMINATION_FAILED'; cleanupFailures++; }
  }
  function deferTermination() {
    if (deferred) return;
    deferred = true;
    Promise.resolve().then(function () { deferred = false; terminateNative(); publish(); });
  }
  function close() {
    if (!closed) {
      closed = true;
      try { host.close(); } catch (_) { cleanupFailures++; }
    }
    if (hookDepth) deferTermination(); else terminateNative();
    publish();
    return status();
  }
  function invoke(method, argument) {
    hookDepth++;
    try {
      if (closed) throw new Error('SECURE_RANDOM_LIFECYCLE_CLOSED');
      return method.call(host, argument);
    } catch (error) { close(); throw error; }
    finally { hookDepth--; }
  }
  const take = function (target) { return invoke(host.take, target); };
  const ready = function () { return invoke(host.assertReady); };
  function checkHooks() {
    const expected = ['WECHAT_CTR_DRBG_V1', take, ready];
    for (let index = 0; index < names.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(module, names[index]);
      if (!descriptor || descriptor.value !== expected[index]) throw new Error('SECURE_RANDOM_HOOK_OWNERSHIP');
    }
  }
  function prepare() {
    if (preparation) return preparation;
    preparation = Promise.resolve().then(function () {
      if (closed) throw new Error('SECURE_RANDOM_LIFECYCLE_CLOSED');
      return host.prepare();
    }).then(function () {
      if (closed) throw new Error('SECURE_RANDOM_LIFECYCLE_CLOSED');
      // Recheck after asynchronous acquisition: a caller may have claimed fields.
      for (const name of names) if (name in module) throw new Error('SECURE_RANDOM_HOOK_OWNERSHIP');
      Object.defineProperties(module, {
        __wxslimSecureRandomMode: {value: 'WECHAT_CTR_DRBG_V1', writable: true, enumerable: true, configurable: true},
        __wxslimEntropyTake: {value: take, writable: true, enumerable: true, configurable: true},
        __wxslimEntropyAssertReady: {value: ready, writable: true, enumerable: true, configurable: true}
      });
      installed = true; prepared = true;
      publish();
      return status();
    }).catch(function (error) { close(); throw error; });
    return preparation;
  }
  function bindNative(value) {
    try {
      if (value !== module) throw new Error('SECURE_RANDOM_MODULE_IDENTITY');
      const descriptor = Object.getOwnPropertyDescriptor(module, '_godot_wechat_random_buffer');
      if (!descriptor || typeof descriptor.value !== 'function') throw new Error('SECURE_RANDOM_EXPORT_REQUIRED');
      if (native && native !== descriptor.value) throw new Error('SECURE_RANDOM_EXPORT_CHANGED');
      native = descriptor.value;
      if (!nativeAttempted) nativeState = 'BOUND';
      if (closed) { terminateNative(); throw new Error('SECURE_RANDOM_LIFECYCLE_CLOSED'); }
      if (!prepared || !installed) throw new Error('SECURE_RANDOM_NOT_PREPARED');
      checkHooks();
      publish();
    } catch (error) { close(); throw error; }
  }
  function status() {
    return Object.freeze({closed, prepared, installed, nativeState, cleanupFailures, diagnosticFailures, cleanupDeferred: deferred});
  }
  return Object.freeze({prepare, bindNative, close, status});
}
if (typeof module === 'object' && module.exports) module.exports = createSecureRandomLifecycle;
}());
