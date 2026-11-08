// Interface required by the unchanged simple PCK. No rendering or GL API calls.
(function (root) {
  'use strict';
  var config = root.__WXSLIM_RENDER_CONFIG__;
  if (!config || !root.__WXSLIM_RENDER_DIAGNOSTIC__) throw Error('SIMPLE_OFFICIAL_RENDER_INTERFACE_REQUIRED');
  var wxApi = root.wx || (typeof wx !== 'undefined' ? wx : {}), info = {};
  try { info = wxApi.getSystemInfoSync(); }
  catch (error) { console.warn('[SIMPLE_ENV_UNKNOWN]', String(error)); }
  var session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), ready = false;
  var lastActualMode = 'unknown';
  var identity = {
    packageId: config.packageVersion, session: session, requestedMode: config.requestedMode,
    engineJsSha256: config.engineJsSha256, wasmSha256: config.wasmSha256, pckSha256: config.pckSha256,
    versions: config.versions,
    device: {model: info.model, system: info.system, wechatVersion: info.version, SDKVersion: info.SDKVersion},
    host: 'official-WXGameKit-with-owned-Godot-bridge', visual: 'NOT_VERIFIED'
  };
  console.info('[SIMPLE_ID]', JSON.stringify(identity));
  var api = Object.freeze({sceneReady: function () {
    var observed = root.__WXSLIM_RENDER_DIAGNOSTIC__.read();
    var actualMode = observed.actualContext ? observed.actualContext.mode : 'unknown';
    lastActualMode = actualMode;
    var accepted = actualMode === config.requestedMode;
    if (!ready) {
      ready = true;
      console.info('[SIMPLE_READY]', JSON.stringify({session: session, actualMode: actualMode,
        modeMatches: accepted, source: 'existing engine context descriptor; not a native GL query',
        visual: 'NOT_VERIFIED'}));
    }
    if (!accepted) console.error('[SIMPLE_MODE_MISMATCH]', config.requestedMode, actualMode);
    return config.packageVersion + '\nBackend: ' + actualMode + ' / SDK: ' + (info.SDKVersion || 'unknown') + '\n' +
      (accepted ? 'Observe cube, red panel and shadow.' : 'MODE NOT ACCEPTED');
  }, getObservationIdentity: function () {
    // Only returns the existing identity/last sceneReady observation. No context/API query.
    return JSON.stringify({schema: 'wxslim-simple-observation-identity-v1',
      ref: identity.packageId + '#' + session, packageId: identity.packageId, session: session,
      requestedMode: identity.requestedMode, actualMode: lastActualMode,
      sdkVersion: typeof info.SDKVersion === 'string' ? info.SDKVersion : null,
      sceneReadyObserved: ready, source: 'existing SIMPLE_ID and last sceneReady snapshot',
      nativeStateProof: false, visual: 'NOT_VERIFIED'});
  }});
  root.SimpleGlxDelivery = api;
  if (root.window) root.window.SimpleGlxDelivery = api;
  if (typeof window !== 'undefined') window.SimpleGlxDelivery = api;
  function recordLifecycle(apiName, eventName) {
    try {
      if (typeof wxApi[apiName] !== 'function') {
        console.warn('[SIMPLE_LIFECYCLE_UNAVAILABLE]', session, eventName); return;
      }
      wxApi[apiName](function () { console.info('[SIMPLE_LIFECYCLE]', session, eventName); });
    } catch (error) {
      // Diagnostic registration cannot prove an event hook was/was not installed.
      // Preserve the warning/cause; do not retry, recover or change engine policy.
      console.warn('[SIMPLE_LIFECYCLE_REGISTRATION_UNKNOWN]', session, eventName, error);
    }
  }
  recordLifecycle('onHide', 'hide');
  recordLifecycle('onShow', 'show');
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
