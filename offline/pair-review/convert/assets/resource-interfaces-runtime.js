/* Explicit ES2016 interfaces installer; no downloads, engine calls or timers at load. */
(function () {
  'use strict';
  var STARTUP = '__WXSLIM_RESOURCE_STARTUP__', APP = '__WXSLIM_RESOURCE_APP__';
  function need(value, code) { if (!value) { var e = new Error(code); e.code = code; throw e; } }
  function field(value, name) {
    need(value && (typeof value === 'object' || typeof value === 'function'), 'RESOURCE_INTERFACES_OBJECT');
    var d = Object.getOwnPropertyDescriptor(value, name);
    need(d && Object.prototype.hasOwnProperty.call(d, 'value'), 'RESOURCE_INTERFACES_DATA_FIELD'); return d.value;
  }
  function vacant(root, name) { need(!(name in root) && !Object.getOwnPropertyDescriptor(root, name), 'RESOURCE_INTERFACES_COLLISION'); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (k) { freeze(value[k]); }); Object.freeze(value); } return value; }
  function installResourceInterfaces(options) {
    var root = options.root, spec = options.spec, factories = options.factories, platformWx = field(options, 'wx');
    need(root && typeof root === 'object', 'RESOURCE_INTERFACES_ROOT');
    var roots = [root], windowDescriptor = Object.getOwnPropertyDescriptor(root, 'window');
    need(Array.isArray(options.globalRoots), 'RESOURCE_INTERFACES_GLOBAL_ROOTS');
    options.globalRoots.forEach(function (item) {
      if (item === null) return;
      need(item && (typeof item === 'object' || typeof item === 'function'), 'RESOURCE_INTERFACES_GLOBAL_ROOTS');
      if (roots.indexOf(item) < 0) roots.push(item);
    });
    if (windowDescriptor) {
      // The actual WeChat devtools host exposes window through a native getter.
      // Resolve this platform handle once; custom config/identity fields below
      // still require own data properties. Getter errors are not suppressed.
      var windowValue = root.window;
      need(windowValue && (typeof windowValue === 'object' || typeof windowValue === 'function'), 'RESOURCE_INTERFACES_WINDOW');
      if (roots.indexOf(windowValue) < 0) roots.push(windowValue);
    }
    roots.forEach(function (r) { vacant(r, APP); }); vacant(root, STARTUP);
    function renderIdentity() {
      var config = field(root, '__WXSLIM_RENDER_CONFIG__');
      need(field(config, 'schema') === 'wxslim-render-config-v1' && field(config, 'fallback') === 'error', 'RESOURCE_INTERFACES_RENDER_SCHEMA');
      var result = {};
      ['packageVersion','requestedMode','engineJsSha256','wasmSha256','pckSha256'].forEach(function (key) { result[key] = field(config, key); });
      need(typeof result.packageVersion === 'string' && /^wxslim-[0-9a-f]{20}$/.test(result.packageVersion) && ['glx','webgl'].indexOf(result.requestedMode) >= 0, 'RESOURCE_INTERFACES_RENDER_IDENTITY');
      ['engineJsSha256','wasmSha256','pckSha256'].forEach(function (key) { need(result[key] === spec.pins[key], 'RESOURCE_INTERFACES_RENDER_PIN'); });
      return result;
    }
    var pinned = freeze(renderIdentity());
    // Correlation only, not a security nonce; generated on every script startup.
    var session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    need(/^[a-z0-9_-]{8,64}$/.test(session), 'RESOURCE_INTERFACES_SESSION');
    var identity = freeze({taskId:'resource-' + session, attemptId:'attempt-' + session, engineSession:session});
    var boot = freeze({packageId:pinned.packageVersion, pckSha256:pinned.pckSha256, wasmSha256:pinned.wasmSha256});
    var stateCore = factories.state(), mountCore = factories.mount({advanceResourceLoad:stateCore.advanceResourceLoad}), sceneCore = factories.scene({advanceResourceLoad:stateCore.advanceResourceLoad});
    var lifecycle = factories.lifecycle({createBridge:factories.command, roots:roots, identity:identity, boot:boot, manifest:spec.manifest});
    var executor = null, installed = false, closed = false, attempted = false;
    function invalidate(reason) {
      closed = true;
      // Cancel does not claim that a running request was aborted or rolled back.
      var cancelFailed = false;
      try { if (executor) executor.close(); } catch (_) { cancelFailed = true; }
      var result = lifecycle.hooks.invalidate(reason);
      return cancelFailed ? freeze({ok:false,code:'RESOURCE_INTERFACES_CANCEL_FAILED',lifecycle:result}) : result;
    }
    function status() { return freeze({schema:'wxslim-resource-interfaces-v2', identity:copy(identity), boot:copy(boot), planSha256:spec.planSha256,
      developmentOnly:true, installed:installed, closed:closed, lifecycle:lifecycle.status(), executor:executor ? executor.snapshot() : null,
      runtimeVerified:false, visualVerified:false, persistentReceiptWritten:false}); }
    var api = Object.freeze({status:status,
      load:function (packId) { need(installed && !closed && executor, 'RESOURCE_INTERFACES_NOT_READY'); return executor.load(packId); },
      cancel:function (loadId) { need(installed && executor, 'RESOURCE_INTERFACES_NOT_READY'); return executor.cancel(loadId); },
      // Local session shutdown blocks new loads, but leaves receiver callbacks
      // installed until their owner has observed the actual pending result.
      close:function () { need(installed && executor, 'RESOURCE_INTERFACES_NOT_READY'); return executor.close(); }
    });
    var hooks = Object.freeze({install:function (module) {
      need(!attempted && !closed, 'RESOURCE_INTERFACES_INSTALL_ONCE'); attempted = true;
      try {
        need(JSON.stringify(renderIdentity()) === JSON.stringify(pinned), 'RESOURCE_INTERFACES_RENDER_CHANGED');
        need(field(root, STARTUP) === hooks, 'RESOURCE_INTERFACES_STARTUP_REPLACED');
        roots.forEach(function (r) { need(field(r, APP) === api, 'RESOURCE_INTERFACES_APP_REPLACED'); });
        // wx is a platform handle supplied by the generated lexical entry. On
        // phones it need not be an own data property of GameGlobal. This does
        // not relax the owned configuration/identity checks above.
        need(platformWx && (typeof platformWx === 'object' || typeof platformWx === 'function'), 'RESOURCE_INTERFACES_WX_UNAVAILABLE');
        var result = lifecycle.hooks.install(module), controller = lifecycle.controller();
        need(!closed, 'RESOURCE_INTERFACES_CLOSED_DURING_INSTALL');
        var reader = factories.reader({wx:platformWx, manifest:controller.readerManifest,
          cancelRequested:function () {
            var current = executor ? executor.snapshot() : null;
            return closed || !!(current && (current.closed || (current.activeJob && current.activeJob.cancelRequested === true)));
          }});
        need(factories.executor && typeof factories.executor.createSession === 'function', 'RESOURCE_INTERFACES_SESSION_FACTORY');
        executor = factories.executor.createSession({stateCore:stateCore, mountCore:mountCore, sceneCore:sceneCore, bridge:controller, reader:reader, boot:boot});
        need(!closed, 'RESOURCE_INTERFACES_CLOSED_DURING_INSTALL'); installed = true; return result;
      } catch (cause) { invalidate('RESOURCE_INTERFACES_INSTALL_FAILED'); throw cause; }
    }, invalidate:invalidate});
    var published = [];
    try {
      roots.forEach(function (r) { vacant(r, APP); published.push({root:r,name:APP,value:api}); Object.defineProperty(r, APP, {value:api,configurable:true,writable:false}); });
      vacant(root, STARTUP); published.push({root:root,name:STARTUP,value:hooks}); Object.defineProperty(root, STARTUP, {value:hooks,configurable:true,writable:false});
    } catch (cause) {
      invalidate('RESOURCE_INTERFACES_PUBLICATION_FAILED');
      published.forEach(function (item) { var d=Object.getOwnPropertyDescriptor(item.root,item.name); if (d && d.value === item.value) Reflect.deleteProperty(item.root,item.name); });
      throw cause;
    }
    return Object.freeze({status:status});
  }
  if (typeof module === 'object' && module.exports) module.exports = installResourceInterfaces;
}());
