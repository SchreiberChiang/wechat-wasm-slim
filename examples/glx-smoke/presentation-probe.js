/* WXSLIM_PRESENTATION_PROBE_V1: explicit synthetic-scene diagnostic; queries may synchronize the GPU. */
var __WXSLIM_PRESENTATION_PROBE__ = (function (root) {
  'use strict';
  var started = Date.now(), active = true, pending = 0, emitted = 0, timers = [];
  var totals = {batches: 0, bytes: 0, declaredDraws: 0, swaps: 0};
  function safe(fn) { try { return fn(); } catch (_) { return {queryFailed: true}; } }
  function finite(n) { return typeof n === 'number' && Number.isFinite(n) ? n : null; }
  function vector(v) {
    if (!v || v.length !== 4) return null;
    return Array.prototype.map.call(v, function (n) { return typeof n === 'boolean' ? n : finite(n); });
  }
  function binding(v) {
    if (v === null) return 'null_default';
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v === 0 ? 'native_zero' : 'native_nonzero';
    return v && typeof v === 'object' ? 'object' : 'unobserved';
  }
  function add(key, n) { if (typeof n === 'number' && Number.isFinite(n) && n >= 0) totals[key] = Math.min(2147483647, totals[key] + n); }
  function stop() {
    active = false;
    timers.forEach(function (id) { clearTimeout(id); }); timers.length = 0;
  }
  function emit(data) {
    if (emitted >= 2) return;
    var config = root.__WXSLIM_RENDER_CONFIG__ || {};
    data.schema = 'wxslim-presentation-probe-v1';
    data.packageVersion = /^wxslim-[a-f0-9]{20}$/.test(config.packageVersion || '') ? config.packageVersion : null;
    data.sampleNumber = ++emitted; data.relativeMillis = Date.now() - started;
    var loader = root.__WXSLIM_PRESENTATION_LOADER__ || {};
    data.loader = {markHook: loader.markHook === true, resolved: typeof loader.resolved === 'boolean' ? loader.resolved : null,
      outcome: ['hook_unavailable', 'awaiting_mark', 'mark_returned', 'mark_not_seen_before_timeout'].indexOf(loader.outcome) >= 0 ? loader.outcome : 'early_hook_absent'};
    data.submission = {batches: totals.batches, bytes: totals.bytes, declaredDraws: totals.declaredDraws, swaps: totals.swaps};
    data.limits = {queriesMaySynchronize: true, surface: 'engine_GLctx', bindingChanged: false, getErrorCalled: false, visiblePixels: 'not_verified', loaderOverlayVisibility: 'not_observed'};
    safe(function () { console.warn('[WXSLIM_PRESENTATION] ' + JSON.stringify(data)); });
    if (emitted === 2) stop();
  }
  function snapshot() {
    return safe(function () {
      var gl = typeof GLctx !== 'undefined' ? GLctx : null;
      if (!gl || !gl.emscriptenGLX) return {skipped: 'actual_glx_context_absent'};
      var result = {contextLost: null};
      if (typeof gl.isContextLost === 'function') result.contextLost = safe(function () { return gl.isContextLost(); });
      if (result.contextLost === true) return result;
      if (typeof gl.getParameter !== 'function') return {skipped: 'getParameter_absent', contextLost: result.contextLost};
      // WebGL2 enums; no native IDs, buffer contents or GL objects leave this closure.
      function get(p) { return gl.getParameter(p); }
      var draw = get(0x8CA6), read = get(0x8CAA), pack = get(0x88ED);
      result.drawFramebuffer = binding(draw); result.readFramebuffer = binding(read);
      result.viewport = vector(get(0x0BA2)); result.scissor = vector(get(0x0C10));
      var scissorEnabled = get(0x0C11); result.scissorEnabled = typeof scissorEnabled === 'boolean' ? scissorEnabled : scissorEnabled === 0 ? false : scissorEnabled === 1 ? true : null;
      result.colorMask = vector(get(0x0C23)); result.packBuffer = binding(pack);
      result.readBuffer = finite(get(0x0C02));
      result.packLayout = [finite(get(0x0D05)), finite(get(0x0D02)), finite(get(0x0D03)), finite(get(0x0D04))];
      result.framebufferStatus = typeof gl.checkFramebufferStatus === 'function' ? {
        draw: finite(gl.checkFramebufferStatus(0x8CA9)), read: finite(gl.checkFramebufferStatus(0x8CA8))
      } : null;
      result.attributes = safe(function () {
        if (typeof gl.getContextAttributes !== 'function') return null;
        var a = gl.getContextAttributes();
        return a ? {alpha: !!a.alpha, antialias: !!a.antialias, preserveDrawingBuffer: !!a.preserveDrawingBuffer} : null;
      });
      var width = finite(gl.drawingBufferWidth), height = finite(gl.drawingBufferHeight);
      result.size = [width, height];
      result.pixels = {skipped: 'read_preconditions_not_met'};
      // Query the already-bound READ framebuffer at its origin, even if native GLX represents it by a number.
      // Do not infer the default display target from a native handle. Never bind, set pack state, clear or flush.
      if (binding(read) === 'unobserved') result.pixels.skipped = 'read_binding_unobserved';
      else if ((pack !== null && pack !== 0) || result.packLayout[1] !== 0 || result.packLayout[2] !== 0 || result.packLayout[3] !== 0) result.pixels.skipped = 'pack_state_not_default';
      else if (!result.framebufferStatus || result.framebufferStatus.read !== 0x8CD5) result.pixels.skipped = 'read_framebuffer_not_complete';
      else if (result.readBuffer !== 0x0405 && !(result.readBuffer >= 0x8CE0 && result.readBuffer <= 0x8CEF)) result.pixels.skipped = 'read_color_buffer_not_selected';
      else if (typeof gl.readPixels !== 'function') result.pixels.skipped = 'readPixels_absent';
      else if (width > 0 && height > 0 && width <= 32768 && height <= 32768) {
        var rgbMin = 255, rgbMax = 0, nonblack = 0, alphaMin = 255, alphaMax = 0, unchanged = 0;
        // Origin is valid for any complete non-empty target; drawingBuffer dimensions need not match an offscreen FBO.
        // Upload only statistics for this synthetic task, never an image, GL handle or individual RGBA value.
        for (var i = 0; i < 1; i++) {
          var bytes = new Uint8Array([17, 83, 149, 211]);
          gl.readPixels(0, 0, 1, 1, 0x1908, 0x1401, bytes);
          if (bytes[0] === 17 && bytes[1] === 83 && bytes[2] === 149 && bytes[3] === 211) unchanged++;
          if (bytes[0] || bytes[1] || bytes[2]) nonblack++;
          for (var j = 0; j < 3; j++) { rgbMin = Math.min(rgbMin, bytes[j]); rgbMax = Math.max(rgbMax, bytes[j]); }
          alphaMin = Math.min(alphaMin, bytes[3]); alphaMax = Math.max(alphaMax, bytes[3]);
        }
        result.pixels = {target: 'current_read_framebuffer_origin_not_certified_display', readCallsReturned: 1, unchangedSentinels: unchanged, nonblackPoints: nonblack, rgbRange: [rgbMin, rgbMax], alphaRange: [alphaMin, alphaMax], readErrorNotQueried: true};
      }
      return result;
    });
  }
  function expire() {
    if (active && Date.now() - started >= 16000) {
      if (pending) emit({slot: pending, skipped: 'no_swap_before_deadline'});
      pending = 0; stop();
    }
  }
  function arm(slot) {
    expire(); if (!active) return;
    if (pending) emit({slot: pending, skipped: 'no_swap_before_next_slot'});
    pending = slot;
  }
  if (typeof setTimeout === 'function' && typeof clearTimeout === 'function') {
    timers.push(setTimeout(function () { arm(1); }, 4000));
    timers.push(setTimeout(function () { arm(2); }, 9000));
    timers.push(setTimeout(expire, 16000));
  } else stop();
  return {
    batch: function (owner, view, draws) {
      expire();
      var result = __WXSLIM_FRAME_PROBE__.batchAsync(owner, view);
      if (active) { add('batches', 1); add('bytes', view.byteLength); add('declaredDraws', draws); }
      return result;
    },
    swap: function (owner) {
      expire();
      var slot = active ? pending : 0, before;
      pending = 0;
      if (slot) before = snapshot();
      try {
        var result = __WXSLIM_FRAME_PROBE__.swap(owner);
        if (active) add('swaps', 1);
        if (slot) emit({slot: slot, originalSwap: 'returned', before: before, after: snapshot()});
        return result;
      } catch (error) {
        if (slot) emit({slot: slot, originalSwap: 'threw', before: before});
        throw error;
      }
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
