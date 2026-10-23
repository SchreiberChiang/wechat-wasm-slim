// Local memory reads only; never wraps rendering, initialization, animation, or swap.
(function () {
  const G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  const identity = G.__SelfbuildCandidateIdentity;
  if (!identity) throw new Error('Candidate identity missing before observer');
  let device = {}, sceneRead = false, hide = 0, show = 0;
  try { if (typeof wx !== 'undefined' && wx.getSystemInfoSync) device = wx.getSystemInfoSync() || {}; } catch (_) {}
  const sessionTag = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  if (typeof wx !== 'undefined' && wx.onHide) wx.onHide(() => { hide = Math.min(hide + 1, Number.MAX_SAFE_INTEGER); });
  if (typeof wx !== 'undefined' && wx.onShow) wx.onShow(() => { show = Math.min(show + 1, Number.MAX_SAFE_INTEGER); });
  function read() {
    const engine = G.GODOTSDK && G.GODOTSDK.engine;
    const runtime = engine && engine.rtenv;
    const ctx = runtime && runtime.ctx;
    const descriptor = ctx && ctx.emscriptenGLX;
    const native = runtime && runtime.wxContextGlobal;
    const actualMode = !ctx ? 'unknown' : descriptor ? 'glx' : 'webgl';
    const selectedMode = typeof G.__godotMinigameWXGLXEnabled === 'boolean' ? (G.__godotMinigameWXGLXEnabled ? 'glx' : 'webgl') : 'unknown';
    const errors = [];
    if (selectedMode !== 'unknown' && selectedMode !== identity.mode) errors.push('Loader selected ' + selectedMode + ', requested ' + identity.mode);
    if (actualMode !== 'unknown' && actualMode !== identity.mode) errors.push('Actual context is ' + actualMode + ', requested ' + identity.mode);
    const validId = value => Number.isSafeInteger(value) && value >= 0;
    const nativeContextIdMatches = descriptor && native && validId(descriptor.ctxid) && validId(native.ctxid) ? descriptor.ctxid === native.ctxid : null;
    if (actualMode === 'glx' && nativeContextIdMatches === false) errors.push('Native descriptor ctxid mismatch');
    if (actualMode === 'glx' && nativeContextIdMatches === null) errors.push('Native descriptor ctxid evidence unavailable');
    const canvasMatches = ctx && ctx.canvas && typeof canvas !== 'undefined' ? ctx.canvas === canvas : null;
    const loaderContextMatches = ctx && G.godotLoader && G.godotLoader.gl ? ctx === G.godotLoader.gl : null;
    if (canvasMatches === false) errors.push('Runtime canvas mismatch');
    if (loaderContextMatches === false) errors.push('Loader context mismatch');
    return {
      schema: 'selfbuild-candidate-observer-v1', identity, requestedMode: identity.mode,
      sessionTag, device: {model: device.model || 'unknown', system: device.system || 'unknown', wechatVersion: device.version || 'unknown', SDKVersion: device.SDKVersion || 'unknown'}, lifecycle: {hide, show},
      capability: typeof wx !== 'undefined' && wx.env && typeof wx.env.isSupportEmscriptenGLX === 'boolean' ? wx.env.isSupportEmscriptenGLX : null,
      selectedMode, actualMode, contextPresent: !!ctx, canvasMatches, loaderContextMatches, nativeContextIdMatches,
      initialization: {enginePresent: !!engine, runtimePresent: !!runtime, contextPresent: !!ctx, sceneRead, sceneEvidence: sceneRead ? 'acceptance PCK called readIdentityText' : 'not_observed', nativeInitializationSuccess: 'not_verified', completion: 'not_verified'},
      modeEvidence: errors.length ? 'failed' : actualMode === 'unknown' ? 'pending' : 'observed', errors,
      visibleRendering: 'not_verified', audio: 'not_verified', source: 'local memory only'
    };
  }
  const api = Object.freeze({
    readIdentityText() {
      if (!sceneRead) { sceneRead = true; if (typeof console !== 'undefined' && console.info) console.info('[SELFBUILD_CANDIDATE_SCENE] ' + JSON.stringify(read())); }
      const state = read();
      return 'Package: ' + identity.packageId + ' #' + sessionTag + '\nRequested: ' + identity.mode + ' | Actual context: ' + state.actualMode + '\n' + (state.errors.length ? 'FAILED: ' + state.errors.join('; ') : 'Mode evidence: ' + state.modeEvidence) + '\nVisible rendering: not_verified';
    },
    readDiagnosticJson() { const state = read(); if (typeof console !== 'undefined' && console.info) console.info('[SELFBUILD_CANDIDATE_MANUAL] ' + JSON.stringify(state)); return JSON.stringify(state, null, 2); }
  });
  G.AuthorReleaseAcceptance = api;
  if (G.window) G.window.AuthorReleaseAcceptance = api;
  if (typeof window !== 'undefined') window.AuthorReleaseAcceptance = api;
})();
