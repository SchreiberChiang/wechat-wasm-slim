// Manual, in-memory inspection only. No startup logging, storage, network, or uploads.
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  // Capture once, before the bounded relay can stop and delete its console property.
  var relay = typeof console !== 'undefined' && console.__phoneLogRelay;
  var cloudSession = relay && typeof relay.session === 'string' && relay.session ? relay.session : null;
  var localSession = cloudSession ? null : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  function shortCode(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  function readRender() {
    var diagnostic = G.__WXSLIM_RENDER_DIAGNOSTIC__;
    if (!diagnostic || typeof diagnostic.read !== 'function') return {available: false, reason: 'Rendering diagnostic API is absent from this package.'};
    try { return diagnostic.read(); }
    catch (error) { return {available: false, reason: 'Rendering diagnostic read failed: ' + String(error && error.message || error)}; }
  }
  function identity(render) {
    var config = G.__WXSLIM_RENDER_CONFIG__ || {};
    var actual = render && render.actualContext && render.actualContext.mode;
    return {
      packageVersion: render.packageVersion || config.packageVersion || 'unknown',
      actualMode: actual === 'glx' || actual === 'webgl' ? actual : 'unknown',
      sessionSource: cloudSession ? 'existing cloud relay' : 'local/no cloud',
      sessionTag: shortCode(cloudSession || localSession),
      cloudSession: cloudSession,
      localSession: localSession,
      visibleRendering: 'not_verified', audio: 'not_verified'
    };
  }
  var api = Object.freeze({
    readIdentityText: function () {
      var info = identity(readRender());
      return 'Package: ' + info.packageVersion + '\nActual context: ' + info.actualMode +
        ' | ' + info.sessionSource + ' #' + info.sessionTag;
    },
    readDiagnosticJson: function () {
      var render = readRender();
      return JSON.stringify(Object.assign({}, render, {acceptanceIdentity: identity(render)}), null, 2);
    },
  });
  G.WxSlimGlxSmoke = api;
  if (G.window && G.window !== G) G.window.WxSlimGlxSmoke = api;
})();
