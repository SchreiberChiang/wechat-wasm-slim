/* WXSLIM_FRAME_PROBE_V1: opt-in diagnostic copy; bounded observation, never a rendering repair. */
var __WXSLIM_FRAME_PROBE__ = (function (root) {
  'use strict';
  var started = Date.now(), active = true, ended = false, endReason = null, phase = 'startup', printed = 0;
  var limit = 2147483647, timers = [], removers = [], canvases = [], lastSample = null;
  var counts = {
    loop: {registrations: 0, entered: 0, returned: 0, threw: 0},
    afterFrame: {registrations: 0, registrationReturned: 0, registrationThrew: 0, entered: 0, returned: 0, threw: 0},
    batchAsync: {entered: 0, returned: 0, threw: 0},
    swap: {entered: 0, returned: 0, threw: 0}
  };
  var events = {hide: 0, show: 0, contextLost: 0, contextRestored: 0};
  var coverage = {hide: false, show: false, canvasTargets: 0, cleanupErrors: 0};
  function increment(group, key) {
    // Background timers can be delayed. The next existing callback must not extend the observation window.
    if (active && Date.now() - started >= 15000) sample(true, 'deadline_observed_by_existing_callback');
    if (active) group[key] = Math.min(limit, group[key] + 1);
  }
  function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function count(value) { return number(value) === null ? null : Math.max(0, Math.min(limit, Math.floor(value))); }
  function bool(value) { return typeof value === 'boolean' ? value : null; }
  function choice(value, options) { return options.indexOf(value) >= 0 ? value : null; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function version(value) { return typeof value === 'string' && /^wxslim-[a-f0-9]{20}$/.test(value) ? value : null; }
  function safe(getter, fallback) { try { return getter(); } catch (_) { return fallback; } }
  function safeRender() {
    return safe(function () {
      var source = root.__WXSLIM_RENDER_DIAGNOSTIC__;
      if (!source || typeof source.read !== 'function') return {available: false};
      var state = source.read(), native = {}, names = ['glxInit', 'glxInitBufferDataAndGlState', 'glxUpdateContextId'];
      for (var i = 0; i < names.length; i++) {
        var item = state.native && state.native[names[i]];
        native[names[i]] = item ? {calls: count(item.calls), result: choice(item.result, ['not_observed', 'returned', 'threw'])} : null;
      }
      var failure = state.failureReason && state.failureReason.code;
      return {
        available: true, packageVersion: version(state.packageVersion),
        requestedMode: choice(state.requestedMode, ['webgl', 'glx']),
        initialization: choice(state.initialization, ['pending', 'blocked', 'failed', 'inconclusive', 'initialized']),
        failureCode: typeof failure === 'string' && /^WXSLIM_[A-Z0-9_]{1,64}$/.test(failure) ? failure : null,
        capability: {present: bool(state.capability && state.capability.present), value: bool(state.capability && state.capability.value)},
        actualContext: state.actualContext ? {mode: choice(state.actualContext.mode, ['webgl', 'glx']), webgl2: bool(state.actualContext.webgl2)} : null,
        moduleContextMatches: bool(state.moduleContextMatches), offscreenResizeFunction: bool(state.offscreenResizeFunction), native: native,
        visibleRendering: 'not_verified', recovery: 'not_verified'
      };
    }, {available: false, observationFailed: true});
  }
  function selectedCanvas() {
    if (typeof GodotConfig !== 'undefined' && GodotConfig && GodotConfig.canvas) return GodotConfig.canvas;
    return Module.canvas || root.canvas || null;
  }
  function canvasSnapshot() {
    return safe(function () {
      var selected = selectedCanvas(), moduleCanvas = Module.canvas || null;
      var configured = typeof GodotConfig !== 'undefined' && GodotConfig ? GodotConfig.canvas || null : null;
      var context = typeof GLctx !== 'undefined' ? GLctx : null;
      var current = typeof GL !== 'undefined' && GL.currentContext ? GL.currentContext.GLctx : null;
      var contextCanvas = context && context.canvas;
      var width = number(selected && selected.width), height = number(selected && selected.height);
      var dw = number(context && context.drawingBufferWidth), dh = number(context && context.drawingBufferHeight);
      return {
        selectedPresent: !!selected, modulePresent: !!moduleCanvas, configuredPresent: !!configured, rootPresent: !!root.canvas,
        moduleMatchesConfigured: moduleCanvas && configured ? moduleCanvas === configured : null,
        selectedMatchesRoot: selected && root.canvas ? selected === root.canvas : null,
        selectedMatchesContextCanvas: selected && contextCanvas ? selected === contextCanvas : null,
        currentMatchesGLctx: context && current ? context === current : null,
        width: width, height: height, nonzero: width !== null && height !== null ? width > 0 && height > 0 : null,
        drawingBufferWidth: dw, drawingBufferHeight: dh, drawingBufferNonzero: dw !== null && dh !== null ? dw > 0 && dh > 0 : null,
        isContextLostAvailable: !!(context && typeof context.isContextLost === 'function'), isContextLostQueried: false
      };
    }, {observationFailed: true});
  }
  function bootSnapshot() {
    return safe(function () {
      var boot = root.__WXSLIM_BOOT_STATE__ || {};
      return {
        stage: choice(boot.stage, ['NEW', 'FACTORY_START', 'WASM_INSTANTIATED', 'GODOT_RUNTIME_READY', 'FS_READY', 'CALL_MAIN', 'PACK_READY_WAITING_LOADER_MAIN', 'MAIN_RETURNED', 'FAILED']),
        factoryCalls: count(boot.factoryCalls), mainCalls: count(boot.mainCalls),
        runtimeInitialized: bool(boot.runtimeInitialized), packMounted: bool(boot.packMounted),
        runDependencyCount: count(boot.runDependencyCount), wasmInstantiatedCalls: count(boot.wasmInstantiatedCalls),
        calledMainCallbacks: count(boot.calledMainCallbacks)
      };
    }, {observationFailed: true});
  }
  function entrySnapshot() {
    return safe(function () {
      var state = root.__WXSLIM_ENTRY_STATE__ || {};
      return {
        status: choice(state.status, ['NEW', 'INVALID_MODULE', 'DISTINCT_MODULE_REJECTED', 'STARTING', 'FULFILLED', 'REJECTED']),
        requests: count(state.requests), nativeFactoryCalls: count(state.nativeFactoryCalls),
        reusedRequests: count(state.reusedRequests), lastSameModule: bool(state.lastSameModule)
      };
    }, {observationFailed: true});
  }
  function resourceSnapshot() {
    return safe(function () {
      var state = root.__WXSLIM_RESOURCE_STATE__ || {};
      return {
        stage: choice(state.stage, ['NEW', 'REGISTERING_CUSTOM_HANDLER', 'CUSTOM_HANDLER_REGISTERED', 'VALIDATED_FOR_GODOT_MOUNT', 'VALIDATED_GATE_CONNECTED', 'FAILED']),
        calls: count(state.calls), accepted: bool(state.accepted), gateReleased: bool(state.gateReleased),
        bytes: count(state.bytes), retainedPckBytes: count(state.retainedPckBytes)
      };
    }, {observationFailed: true});
  }
  function loopSnapshot() {
    return safe(function () {
      return {
        currentFrameNumber: count(MainLoop.currentFrameNumber),
        method: choice(MainLoop.method, ['', 'rAF', 'timeout', 'immediate']),
        functionPresent: typeof MainLoop.func === 'function', schedulerPresent: typeof MainLoop.scheduler === 'function',
        abort: typeof ABORT !== 'undefined' ? !!ABORT : null,
        runtimeExited: typeof runtimeExited !== 'undefined' ? !!runtimeExited : null,
        generation: counts.loop.registrations
      };
    }, {observationFailed: true});
  }
  function installCanvasListeners() {
    if (!active || canvases.length >= 3) return;
    safe(function () {
      var target = selectedCanvas();
      if (!target || canvases.indexOf(target) >= 0 || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return;
      // Remember attempted targets before calling host APIs: even partial host failures remain bounded.
      canvases.push(target); coverage.canvasTargets = canvases.length;
      function lost() { increment(events, 'contextLost'); }
      function restored() { increment(events, 'contextRestored'); }
      target.addEventListener('webglcontextlost', lost, false);
      removers.push(function () { target.removeEventListener('webglcontextlost', lost, false); });
      target.addEventListener('webglcontextrestored', restored, false);
      removers.push(function () { target.removeEventListener('webglcontextrestored', restored, false); });
    }, null);
  }
  function installLifecycle(api, on, off, key) {
    if (!api || typeof api[on] !== 'function' || typeof api[off] !== 'function') return;
    safe(function () {
      var callback = function () { if (active) { increment(events, key); phase = key === 'hide' ? 'hidden' : 'after_show'; } };
      api[on](callback);
      removers.push(function () { api[off](callback); });
      coverage[key] = true;
    }, null);
  }
  function read() {
    var render = safeRender(), config = root.__WXSLIM_RENDER_CONFIG__ || {};
    return {
      schema: 'wxslim-frame-probe-v1', packageVersion: version(config.packageVersion) || render.packageVersion || null,
      relativeMillis: Math.max(0, Date.now() - started), phase: phase,
      window: {origin: 'probe_installed', active: active, ended: ended, endReason: endReason, maximumScheduledMillis: 15000},
      counts: clone(counts), events: clone(events), coverage: clone(coverage), loop: loopSnapshot(),
      render: render, canvas: canvasSnapshot(), boot: bootSnapshot(), entry: entrySnapshot(), resource: resourceSnapshot(),
      evidence: {nativeLoopCounters: 'scheduled_callback_only', afterFrameCounters: 'existing_callback_calls_native_flush_once', batchAsyncCounters: 'host_call_return_only', visiblePixels: 'not_verified', recovery: 'not_verified'}
    };
  }
  function stop(reason) {
    if (ended) return;
    active = false; ended = true; endReason = reason || 'scheduled_final';
    for (var i = 0; i < timers.length; i++) safe(function () { clearTimeout(timers[i]); }, null);
    timers.length = 0;
    for (var j = 0; j < removers.length; j++) {
      try { removers[j](); } catch (_) { coverage.cleanupErrors++; }
    }
    removers.length = 0; canvases.length = 0;
  }
  function sample(final, reason) {
    if (ended || printed >= 3) return;
    installCanvasListeners();
    if (final) stop(reason);
    var state = read(), flat = {}, delta = {};
    for (var key in counts) for (var field in counts[key]) flat[key + '.' + field] = counts[key][field];
    flat.currentFrameNumber = state.loop.currentFrameNumber;
    for (var name in flat) {
      var previous = lastSample ? lastSample[name] : 0;
      delta[name] = flat[name] === null || previous === null ? null : flat[name] - previous;
    }
    state.deltaSincePreviousSample = delta;
    state.sampleNumber = ++printed;
    lastSample = flat;
    // Only these three bounded records; no raw errors, context ids, buffers or account/device data.
    safe(function () { console.warn('[WXSLIM_FRAME_PROBE] ' + JSON.stringify(state)); }, null);
  }
  function invoke(group, receiver, fn, args) {
    var measuring = active;
    if (measuring) increment(group, 'entered');
    try {
      var result = fn.apply(receiver, args);
      if (measuring) increment(group, 'returned');
      return result;
    } catch (error) {
      if (measuring) increment(group, 'threw');
      throw error;
    }
  }
  var api = {
    read: read,
    wrapLoop: function (fn) {
      if (!active) return fn;
      increment(counts.loop, 'registrations'); installCanvasListeners();
      return function () { return invoke(counts.loop, this, fn, arguments); };
    },
    registerAfterFrame: function (owner, callback) {
      if (!active) return owner.registerAfterDoFrame(callback);
      increment(counts.afterFrame, 'registrations');
      var wrapped = function () { return invoke(counts.afterFrame, this, callback, arguments); };
      try {
        var result = owner.registerAfterDoFrame(wrapped);
        increment(counts.afterFrame, 'registrationReturned'); return result;
      } catch (error) { increment(counts.afterFrame, 'registrationThrew'); throw error; }
    },
    batchAsync: function (owner, view) { return active ? invoke(counts.batchAsync, owner, owner.batchRenderAsync, [view]) : owner.batchRenderAsync(view); },
    swap: function (owner) { return active ? invoke(counts.swap, owner, owner.swapWindow, []) : owner.swapWindow(); }
  };
  root.__WXSLIM_FRAME_PROBE__ = Object.freeze({read: read});
  installCanvasListeners();
  var wxApi = root.wx || (typeof wx !== 'undefined' ? wx : null);
  installLifecycle(wxApi, 'onHide', 'offHide', 'hide');
  installLifecycle(wxApi, 'onShow', 'offShow', 'show');
  lastSample = {currentFrameNumber: loopSnapshot().currentFrameNumber};
  for (var initialGroup in counts) for (var initialField in counts[initialGroup]) lastSample[initialGroup + '.' + initialField] = counts[initialGroup][initialField];
  if (typeof setTimeout === 'function' && typeof clearTimeout === 'function') {
    timers.push(setTimeout(function () { sample(false); }, 3000));
    timers.push(setTimeout(function () { sample(false); }, 8000));
    timers.push(setTimeout(function () { sample(true); }, 15000));
  } else { phase = 'timers_unavailable'; stop('timers_unavailable'); }
  return api;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
