// Runs before the author loader module is evaluated. No context is created here.
(function () {
  const G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  const mode = __CANDIDATE_MODE__;
  if (mode !== 'webgl' && mode !== 'glx') throw new Error('Candidate mode is invalid');
  G.__SelfbuildCandidateIdentity = Object.freeze(__CANDIDATE_IDENTITY__);
  if (mode === 'glx' && !(typeof wx !== 'undefined' && wx.env && wx.env.isSupportEmscriptenGLX === true)) {
    const reason = 'GLX experiment refused: wx.env.isSupportEmscriptenGLX is not true; no fallback allowed';
    if (!G.__SelfbuildCandidateBlocked) {
      const present = typeof wx !== 'undefined' && !!wx.env && 'isSupportEmscriptenGLX' in wx.env;
      const capability = present && typeof wx.env.isSupportEmscriptenGLX === 'boolean' ? wx.env.isSupportEmscriptenGLX : null;
      G.__SelfbuildCandidateBlocked = Object.freeze({packageId: G.__SelfbuildCandidateIdentity.packageId, requestedMode: mode, capabilityPresent: present, capability, actualMode: 'unknown', initialization: 'blocked', failureCode: 'GLX_CAPABILITY_UNAVAILABLE', reason, visibleRendering: 'not_verified'});
      if (typeof console !== 'undefined' && console.info) console.info('[SELFBUILD_CANDIDATE_BLOCKED] ' + JSON.stringify(G.__SelfbuildCandidateBlocked));
    }
    throw new Error(reason);
  }
  G.__GODOT_DISABLE_WXGLX = mode === 'webgl';
})();
