/* WXSLIM_RENDER_OBSERVER_V1: inserted inside the Godot factory, after its GL patches. */
Module.__WXSLIM_READ_RENDER__ = function () {
  var context = typeof GLctx !== 'undefined' ? GLctx : null;
  var nativeContext = context && context.emscriptenGLX;
  return {
    context: context ? {mode: nativeContext ? 'glx' : 'webgl', webgl2: nativeContext ? nativeContext.isWebGL2 === true : !!(GL.currentContext && GL.currentContext.attributes && GL.currentContext.attributes.majorVersion === 2)} : null,
    nativeBindings: wxGLXHasNativeBindings(),
    moduleContextMatches: nativeContext ? !!(Number.isFinite(nativeContext.ctxid) && Module.wxContextGlobal && Number.isFinite(Module.wxContextGlobal.ctxid) && Module.wxContextGlobal.ctxid === nativeContext.ctxid) : null,
    offscreenResizeFunction: typeof GL.resizeOffscreenFramebuffer === 'function'
  };
};
// Keep WebGL's existing native-call behavior. Experimental GLX must not swallow native failures.
var wxslimOriginalNativeCall = wxGLXCallNative;
wxGLXCallNative = function (name, args) {
  var root = wxGLXGetRoot(), diagnostic = root.__WXSLIM_RENDER_DIAGNOSTIC__;
  if (root.__godotMinigameWXGLXEnabled !== true || !diagnostic) return wxslimOriginalNativeCall(name, args);
  return diagnostic.nativeCall(name, function () {
    var nativeFunction = wxGLXGetNativeExport(name);
    if (!nativeFunction) throw Error('Missing GLX native binding');
    return nativeFunction.apply(Module, args || []);
  });
};
