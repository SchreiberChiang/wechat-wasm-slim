// No GL queries, state changes, polling, cloud forwarding or console filtering.
(function () {
  const G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  const identity = G.__SelfbuildCandidateIdentity;
  let info = {}, ready = false;
  try { info = wx.getSystemInfoSync(); } catch (e) { console.warn('[SIMPLE_ENV_UNKNOWN]', String(e)); }
  const session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  function state() {
    const runtime = G.GODOTSDK && G.GODOTSDK.engine && G.GODOTSDK.engine.rtenv;
    const ctx = runtime && runtime.ctx;
    return {actualMode:!ctx?'unknown':ctx.emscriptenGLX?'glx':'webgl',source:'existing runtime context descriptor, not a native GL query'};
  }
  console.info('[SIMPLE_ID]', JSON.stringify({identity,session,device:{model:info.model,system:info.system,wechatVersion:info.version,SDKVersion:info.SDKVersion},visual:'NOT_VERIFIED'}));
  const api = Object.freeze({sceneReady() {
    const observed = state();
    const accepted = observed.actualMode === identity.mode;
    if (!ready) { ready = true; console.info('[SIMPLE_READY]', JSON.stringify({session,...observed,modeMatches:accepted,visual:'NOT_VERIFIED'})); }
    if (!accepted) console.error('[SIMPLE_MODE_MISMATCH]', identity.mode, observed.actualMode);
    return identity.packageId + '\nBackend: ' + observed.actualMode + ' / SDK: ' + (info.SDKVersion || 'unknown') + '\n' + (accepted ? 'Observe cube, red panel and shadow.' : 'MODE NOT ACCEPTED');
  }});
  G.SimpleGlxDelivery = api;
  if (G.window) G.window.SimpleGlxDelivery = api;
  if (typeof window !== 'undefined') window.SimpleGlxDelivery = api;
  if (wx.onHide) wx.onHide(() => console.info('[SIMPLE_LIFECYCLE]', session, 'hide'));
  if (wx.onShow) wx.onShow(() => console.info('[SIMPLE_LIFECYCLE]', session, 'show'));
})();
