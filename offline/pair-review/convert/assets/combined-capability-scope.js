/* Combined-demo scope only. One system-info read, no listeners or networking. */
(function (exportRoot) {
  'use strict';
  function createCombinedCapabilityScope(options) {
    options = options || {};
    function data(object, name) {
      try {
        var d = object && Object.getOwnPropertyDescriptor(object, name);
        return d && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined;
      } catch (_) { return undefined; }
    }
    var provider = data(options, 'identityProvider'), wxApi = data(options, 'wx');
    var keys = ['schema','ref','packageId','session','requestedMode','actualMode','sdkVersion','sceneReadyObserved','source','nativeStateProof','visual'];
    function identity() {
      try {
        if (typeof provider !== 'function') return null;
        var raw = provider();
        if (typeof raw !== 'string' || raw.length > 4096) return null;
        var value = JSON.parse(raw);
        if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length ||
            !keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); })) return null;
        if (value.schema !== 'wxslim-simple-observation-identity-v1' ||
            typeof value.packageId !== 'string' || !/^wxslim-[a-f0-9]{20}$/.test(value.packageId) ||
            typeof value.session !== 'string' || !/^[a-z0-9]{1,24}-[a-z0-9]{1,16}$/.test(value.session) ||
            value.ref !== value.packageId + '#' + value.session) return null;
        if (['glx','webgl'].indexOf(value.requestedMode) === -1 || ['glx','webgl','unknown'].indexOf(value.actualMode) === -1 ||
            (value.sdkVersion !== null && (typeof value.sdkVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value.sdkVersion))) ||
            typeof value.sceneReadyObserved !== 'boolean' || value.source !== 'existing SIMPLE_ID and last sceneReady snapshot' ||
            value.nativeStateProof !== false || value.visual !== 'NOT_VERIFIED') return null;
        return {ref:value.ref, packageId:value.packageId, session:value.session};
      } catch (_) { return null; }
    }
    var initialIdentity = identity(), platform = null, platformReason = 'SYSTEM_INFO_API_UNAVAILABLE';
    try {
      var getInfo = data(wxApi, 'getSystemInfoSync');
      if (typeof getInfo === 'function') {
        // Deliberately exactly one invocation, even when the result is unknown.
        // The official DevTools result can expose platform through a getter.
        // Read that trusted API result once; keep own-data checks for our inputs.
        var info = getInfo.call(wxApi), observed = info == null ? undefined : info.platform;
        if (typeof observed === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(observed) && observed !== 'unknown') {
          platform = observed;
          platformReason = platform === 'devtools' ? 'DEVTOOLS_PLATFORM' : 'PLATFORM_NOT_DEVTOOLS';
        } else platformReason = 'PLATFORM_UNKNOWN';
      }
    } catch (_) { platformReason = 'SYSTEM_INFO_FAILED'; }
    return Object.freeze({getSnapshot:function () {
      var current = identity(), reason = platformReason;
      if (!initialIdentity || !current) reason = 'IDENTITY_UNAVAILABLE';
      else if (current.ref !== initialIdentity.ref) reason = 'IDENTITY_CHANGED';
      return JSON.stringify({schema:'wxslim-combined-capability-runtime-scope-v1',
        ref:current ? current.ref : null, packageId:current ? current.packageId : null, session:current ? current.session : null,
        platform:platform, desktopLoopbackEligible:reason === 'DEVTOOLS_PLATFORM', reason:reason,
        source:'wx.getSystemInfoSync().platform; one initialization read', nativeStateProof:false, visual:'NOT_VERIFIED'});
    }});
  }
  if (typeof module === 'object' && module.exports) module.exports = createCombinedCapabilityScope;
  else exportRoot.createCombinedCapabilityScope = createCombinedCapabilityScope;
})(typeof globalThis !== 'undefined' ? globalThis : this);
