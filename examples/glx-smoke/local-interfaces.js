// Manual, in-memory inspection only. No startup logging, storage, network, or uploads.
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  var api = Object.freeze({
    readDiagnosticJson: function () {
      var diagnostic = G.__WXSLIM_RENDER_DIAGNOSTIC__;
      if (!diagnostic || typeof diagnostic.read !== 'function') {
        return JSON.stringify({available: false, reason: 'Rendering diagnostic API is absent from this package.'});
      }
      try {
        return JSON.stringify(diagnostic.read(), null, 2);
      } catch (error) {
        return JSON.stringify({available: false, reason: 'Rendering diagnostic read failed: ' + String(error && error.message || error)});
      }
    },
  });
  G.WxSlimGlxSmoke = api;
  if (G.window && G.window !== G) G.window.WxSlimGlxSmoke = api;
})();
