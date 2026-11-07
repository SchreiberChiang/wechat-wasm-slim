/* Explicit ES2016 factory. Observation only: no GL, storage, engine or recovery calls. */
(function (exportRoot) {
  'use strict';
  function createCapabilityObservation(options) {
    options = options || {};
    var wxApi = options.wx, limit = options.maxEvents === undefined ? 64 : options.maxEvents;
    if (!Number.isInteger(limit) || limit < 1 || limit > 256) throw Error('CAPABILITY_OBSERVATION_LIMIT_INVALID');
    var events = [], warnings = [], droppedWarnings = 0, droppedEvents = 0, sequence = 0;
    var started = false, disposed = false, registrations = [];
    var lifecycle = {status: 'unknown', hideCount: 0, showCount: 0, lastEvent: 'none', source: null, sequence: 0, unknown: true,
      countScope: 'Callbacks received by this instance only; zero is not a platform event total.'};
    var registration = {hide: 'unknown', show: 'unknown'}, overflow = false;
    function warn(code) {
      if (warnings.indexOf(code) !== -1) return;
      if (warnings.length < 32) warnings.push(code); else droppedWarnings++;
    }
    // Do not invoke getters on host objects. Missing/accessor/error are unknown, not fabricated values.
    function data(object, key, code) {
      try {
        if (!object || (typeof object !== 'object' && typeof object !== 'function')) { warn(code); return undefined; }
        var descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) { warn(code); return undefined; }
        return descriptor.value;
      } catch (_) { warn(code); return undefined; }
    }
    function text(object, key, code, pattern) {
      var value = data(object, key, code);
      if (typeof value !== 'string' || value.length > 160 || (pattern && !pattern.test(value))) { warn(code); return null; }
      return value;
    }
    function identity() {
      var config = null, provider = data(options, 'identityProvider', 'SIMPLE_IDENTITY_UNAVAILABLE');
      if (typeof provider === 'function') {
        try {
          var raw = provider();
          if (typeof raw === 'string' && raw.length <= 4096) config = JSON.parse(raw);
          else warn('SIMPLE_IDENTITY_INVALID');
        } catch (_) { warn('SIMPLE_IDENTITY_UNKNOWN'); }
      }
      return {source: 'explicit-simple-host-saved-observation-provider',
        packageId: text(config, 'packageId', 'PACKAGE_ID_UNKNOWN', /^wxslim-[a-f0-9]{20}$/),
        session: text(config, 'session', 'SESSION_UNKNOWN', /^[a-zA-Z0-9-]{1,128}$/),
        requestedMode: text(config, 'requestedMode', 'MODE_UNKNOWN', /^(glx|webgl)$/),
        selectedMode: null, selectedModeObservation: 'not_collected',
        actualMode: text(config, 'actualMode', 'ACTUAL_MODE_UNKNOWN', /^(glx|webgl)$/),
        sdkVersion: text(config, 'sdkVersion', 'SDK_VERSION_UNKNOWN'),
        identityVerified: false};
    }
    function record(kind) {
      if (disposed) return false;
      if (sequence === 65535) { overflow = true; lifecycle.unknown = true; lifecycle.status = 'unknown'; warn('OBSERVATION_COUNT_SATURATED'); return false; }
      sequence++;
      lifecycle[kind === 'hide' ? 'hideCount' : 'showCount']++;
      lifecycle.lastEvent = kind; lifecycle.source = 'wx.on' + (kind === 'hide' ? 'Hide' : 'Show'); lifecycle.sequence = sequence;
      if (events.length === limit) { events.shift(); droppedEvents++; }
      events.push({sequence: sequence, source: lifecycle.source, kind: kind});
      return true;
    }
    function start() {
      if (started || disposed) return false;
      started = true;
      ['hide', 'show'].forEach(function (kind) {
        var method = data(wxApi, kind === 'hide' ? 'onHide' : 'onShow', 'WX_' + kind.toUpperCase() + '_UNAVAILABLE');
        if (typeof method !== 'function') { warn('WX_' + kind.toUpperCase() + '_UNAVAILABLE'); return; }
        var callback = function () { record(kind); };
        registrations.push({kind: kind, callback: callback});
        try {
          method.call(wxApi, callback); registration[kind] = 'registered';
        } catch (_) { registration[kind] = 'unknown'; warn('WX_' + kind.toUpperCase() + '_REGISTRATION_UNKNOWN'); }
      });
      lifecycle.unknown = overflow || registration.hide !== 'registered' || registration.show !== 'registered';
      lifecycle.status = lifecycle.unknown ? 'unknown' : 'observing';
      return true;
    }
    function dispose() {
      if (disposed) return false;
      disposed = true;
      lifecycle.status = 'unavailable'; lifecycle.unknown = true;
      registrations.forEach(function (entry) {
        var method = data(wxApi, entry.kind === 'hide' ? 'offHide' : 'offShow', 'WX_UNSUBSCRIBE_UNAVAILABLE');
        if (typeof method !== 'function') { warn('WX_UNSUBSCRIBE_UNAVAILABLE'); return; }
        try { method.call(wxApi, entry.callback); } catch (_) { warn('WX_UNSUBSCRIBE_UNKNOWN'); }
      });
      return true;
    }
    return Object.freeze({start: start, dispose: dispose,
      getSnapshot: function () {
        var currentIdentity = identity();
        return JSON.stringify({schema: 'wxslim-capability-observation-v1', started: started, disposed: disposed,
          host: registration.hide === 'registered' || registration.show === 'registered' ? 'wechat' : 'unknown',
          identity: currentIdentity, registration: registration, lifecycle: lifecycle, sequence: sequence,
          events: events, maxEvents: limit, droppedEvents: droppedEvents, maxObservations: 65535,
          overflow: droppedEvents > 0 || overflow,
          observationCountSaturated: overflow, lostAfterSaturation: overflow ? 'unknown' : 0, warnings: warnings,
          maxWarnings: 32, droppedWarnings: droppedWarnings,
          boundary: 'wx callbacks observed by this instance only; Godot notifications must be recorded separately. Host is API registration evidence, not device verification.',
          automaticPauseResume: false, contextVerified: false, runtimeVerified: false, phone: 'NOT_RUN'});
      }});
  }
  if (typeof module === 'object' && module && module.exports) module.exports = createCapabilityObservation;
  else exportRoot.__WXSLIM_CREATE_CAPABILITY_OBSERVATION__ = createCapabilityObservation;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : typeof globalThis !== 'undefined' ? globalThis : this);
