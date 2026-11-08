/* Explicit ES2016 CJS factory. No automatic globals, eval, timers, I/O or engine calls. */
(function () {
  'use strict';
  var NAME = '__WXSLIM_RESOURCE_BRIDGE__', TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;
  function error(code) { var value = new Error(code); value.code = code; return value; }
  function need(value, code) { if (!value) throw error(code); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys) {
    need(object(value), 'RESOURCE_HOST_OPTIONS_INVALID');
    var names = Reflect.ownKeys(value);
    need(names.length === keys.length && keys.every(function (key) { var descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value'); }), 'RESOURCE_HOST_OPTIONS_INVALID');
  }
  function copyJson(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { need(Number.isFinite(value), 'RESOURCE_HOST_OPTIONS_INVALID'); return value; }
    need(object(value) || Array.isArray(value), 'RESOURCE_HOST_OPTIONS_INVALID');
    seen = seen || []; need(seen.indexOf(value) < 0, 'RESOURCE_HOST_OPTIONS_INVALID'); seen.push(value);
    var result = Array.isArray(value) ? [] : {};
    Reflect.ownKeys(value).forEach(function (key) {
      if (Array.isArray(value) && key === 'length') return;
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      need(typeof key === 'string' && Object.prototype.hasOwnProperty.call(descriptor, 'value') && key !== '__proto__', 'RESOURCE_HOST_OPTIONS_INVALID');
      result[key] = copyJson(descriptor.value, seen);
    });
    seen.pop(); return result;
  }
  function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value); } return value; }
  function safeCode(cause, fallback) {
    if (cause && typeof cause === 'object') { var field = Object.getOwnPropertyDescriptor(cause, 'code'); if (field && typeof field.value === 'string' && TOKEN.test(field.value)) return field.value; }
    return fallback;
  }
  function createResourceHostLifecycle(options) {
    exact(options, ['createBridge', 'roots', 'identity', 'boot', 'manifest']);
    need(typeof options.createBridge === 'function' && Array.isArray(options.roots) && options.roots.length > 0, 'RESOURCE_HOST_OPTIONS_INVALID');
    var roots = [];
    options.roots.forEach(function (root) { need(root !== null && (typeof root === 'object' || typeof root === 'function'), 'RESOURCE_HOST_ROOT_INVALID'); if (roots.indexOf(root) < 0) roots.push(root); });
    need(roots.length > 0, 'RESOURCE_HOST_ROOT_INVALID');
    exact(options.identity, ['taskId', 'attemptId', 'engineSession']); exact(options.boot, ['packageId', 'pckSha256', 'wasmSha256']); exact(options.manifest, ['packs']);
    need(Array.isArray(options.manifest.packs), 'RESOURCE_HOST_OPTIONS_INVALID');
    options.manifest.packs.forEach(function (pack) { exact(pack, ['id', 'root', 'file', 'bytes', 'sha256', 'entryScene', 'requires']); });
    var configuration = freeze(copyJson({identity:options.identity, boot:options.boot, manifest:options.manifest})), createBridge = options.createBridge;
    var stage = 'NEW', installAttempted = false, invalidated = false, bridgeInvalidationAttempted = false, bridge = null, api = null, attemptedRoots = [], cleanedRoots = [], cleanupErrors = [], reason = null, installErrorCode = null, replacementCount = 0;
    function transport() {
      if (!bridge) return null;
      try {
        var value = bridge.status(), pending = value.pending;
        return {attached:value.attached === true, beginSucceeded:value.beginSucceeded === true, invalidated:value.invalidated === true, unknownFailure:value.unknownFailure === true,
          failureCode:typeof value.failureCode === 'string' && TOKEN.test(value.failureCode) ? value.failureCode : null,
          pending:pending ? {op:pending.header && ['BEGIN','VERIFY','STAGE','MOUNT','ENTRY','LOAD_SCENE','SUMMARY'].indexOf(pending.header.op) >= 0 ? pending.header.op : null,
            requestId:pending.header && typeof pending.header.requestId === 'string' && /^[1-9][0-9]{0,31}$/.test(pending.header.requestId) ? pending.header.requestId : null,
            promiseSettled:pending.promiseSettled === true, timedOut:pending.timedOut === true, sideEffects:'UNKNOWN'} : null};
      } catch (_) { return {unavailable:true, code:'RESOURCE_HOST_TRANSPORT_STATUS_FAILED'}; }
    }
    function status() { return freeze({schema:'wxslim-resource-host-lifecycle-v1', stage:stage, installAttempted:installAttempted, invalidated:invalidated, reason:reason, installErrorCode:installErrorCode, rootCount:roots.length, attemptedPublications:attemptedRoots.length, replacementCount:replacementCount, cleanupErrors:cleanupErrors.map(function (item) { return Object.assign({}, item); }), transport:transport(), runtimeVerified:false}); }
    function cleanup(rescan) {
      if (bridge && !bridgeInvalidationAttempted) {
        bridgeInvalidationAttempted = true;
        try { need(typeof bridge.invalidate === 'function', 'RESOURCE_HOST_BRIDGE_INVALID'); bridge.invalidate(); need(bridge.status().invalidated === true, 'RESOURCE_HOST_BRIDGE_INVALIDATION_UNCONFIRMED'); }
        catch (cause) { cleanupErrors.push({operation:'BRIDGE_INVALIDATE', code:safeCode(cause, 'RESOURCE_HOST_BRIDGE_INVALIDATION_FAILED')}); }
      }
      attemptedRoots.forEach(function (index) {
        if (cleanedRoots.indexOf(index) >= 0 && !rescan) return;
        if (cleanedRoots.indexOf(index) < 0) cleanedRoots.push(index);
        try {
          var descriptor = Object.getOwnPropertyDescriptor(roots[index], NAME);
          if (!descriptor) return;
          if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.value !== api) { replacementCount++; return; }
          need(Reflect.deleteProperty(roots[index], NAME), 'RESOURCE_HOST_ROOT_DELETE_FAILED');
          need(!Object.getOwnPropertyDescriptor(roots[index], NAME), 'RESOURCE_HOST_ROOT_DELETE_FAILED');
        } catch (cause) { cleanupErrors.push({operation:'ROOT_DELETE', rootIndex:index, code:safeCode(cause, 'RESOURCE_HOST_ROOT_DELETE_FAILED')}); }
      });
    }
    function invalidate(value) {
      if (!invalidated) {
        invalidated = true; reason = typeof value === 'string' && TOKEN.test(value) ? value : 'RESOURCE_HOST_INVALIDATED';
        cleanup(); stage = cleanupErrors.length ? 'INVALIDATED_WITH_ERRORS' : 'INVALIDATED';
      }
      return freeze({ok:cleanupErrors.length === 0, code:cleanupErrors.length ? 'RESOURCE_HOST_CLEANUP_INCOMPLETE' : 'RESOURCE_HOST_INVALIDATED', status:status()});
    }
    function vacant(root) { need(!(NAME in root) && !Object.getOwnPropertyDescriptor(root, NAME), 'RESOURCE_HOST_NAME_COLLISION'); }
    function checkVacant() { roots.forEach(vacant); }
    function install(module) {
      need(!installAttempted && !invalidated, 'RESOURCE_HOST_INSTALL_ONCE'); installAttempted = true; stage = 'INSTALLING';
      try {
        checkVacant(); need(!invalidated, 'RESOURCE_HOST_INVALIDATED_DURING_INSTALL');
        bridge = createBridge({module:module, identity:configuration.identity, boot:configuration.boot, manifest:configuration.manifest});
        need(!invalidated, 'RESOURCE_HOST_INVALIDATED_DURING_INSTALL');
        need(object(bridge) && typeof bridge.invalidate === 'function' && typeof bridge.status === 'function', 'RESOURCE_HOST_BRIDGE_INVALID');
        var descriptor = Object.getOwnPropertyDescriptor(bridge, 'interface');
        need(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') && object(descriptor.value), 'RESOURCE_HOST_INTERFACE_INVALID');
        api = descriptor.value;
        ['configuration','attach','report','isActive','isRequestActive','isAcceptedBuffer'].forEach(function (name) { need(typeof api[name] === 'function', 'RESOURCE_HOST_INTERFACE_INVALID'); });
        Object.freeze(api); checkVacant(); need(!invalidated, 'RESOURCE_HOST_INVALIDATED_DURING_INSTALL');
        roots.forEach(function (root, index) {
          vacant(root); need(!invalidated, 'RESOURCE_HOST_INVALIDATED_DURING_INSTALL'); attemptedRoots.push(index);
          Object.defineProperty(root, NAME, {value:api, configurable:true, enumerable:false, writable:false});
          var actual = Object.getOwnPropertyDescriptor(root, NAME);
          need(actual && Object.prototype.hasOwnProperty.call(actual, 'value') && actual.value === api, 'RESOURCE_HOST_PUBLICATION_FAILED');
          need(!invalidated, 'RESOURCE_HOST_INVALIDATED_DURING_INSTALL');
        });
        stage = 'INSTALLED'; return Object.freeze({ok:true, code:'RESOURCE_HOST_INSTALLED'});
      } catch (cause) {
        installErrorCode = safeCode(cause, 'RESOURCE_HOST_INSTALL_FAILED');
        // A publication trap can invalidate before its own defineProperty write.
        // Reinspect this install's attempted roots after that trap unwinds.
        if (!invalidated) invalidate('RESOURCE_HOST_INSTALL_FAILED'); else cleanup(true);
        stage = 'INSTALL_FAILED';
        throw error(installErrorCode);
      }
    }
    return Object.freeze({hooks:Object.freeze({install:install, invalidate:invalidate}), controller:function () { return bridge; }, status:status});
  }
  if (typeof module === 'object' && module.exports) module.exports = createResourceHostLifecycle;
}());
