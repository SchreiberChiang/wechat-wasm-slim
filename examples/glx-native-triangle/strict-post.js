// Loaded after the unmodified, SHA256-pinned Godot MIT-licensed context patch.
// Keep its create/current initialization ordering but make failure observable.
// These are local patch helpers, not additional WeChat APIs.
wxGLXCallNative = function (name, args) {
    const fn = wxGLXGetNativeExport(name);
    if (!fn) throw new Error('[native-triangle] Missing native export: ' + name);
    return fn.apply(Module, args || []);
};

wxGLXIsRuntimeSupported = function () {
    if (wxGLXGetPinnedMode() !== true) {
        throw new Error('[native-triangle] Host must explicitly select GLX before creating context.');
    }
    if (!wxGLXHasNativeBindings() || !wxGLXGetNativeExport('glxCommandBufferFlush')) {
        throw new Error('[native-triangle] Required GLX native exports are missing.');
    }
    return true;
};
