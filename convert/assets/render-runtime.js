/* WXSLIM_RENDER_RUNTIME_V1: no context creation, storage, network or per-frame hooks. */
(function (root) {
  'use strict';
  var config = root.__WXSLIM_RENDER_CONFIG__ || {};
  var wxApi = root.wx || (typeof wx !== 'undefined' ? wx : {});
  var mode = config.requestedMode, reader = null, emitted = false;
  var summary = {
    schema: 'wxslim-render-diagnostic-v1', packageVersion: config.packageVersion || null,
    versions: config.versions || null, requestedMode: mode || null,
    capability: {present: false, value: null}, actualContext: null, observationStatus: 'not_observed',
    native: {}, initialization: 'pending', failureReason: null,
    visibleRendering: 'not_verified', lifecycle: {hide: 0, show: 0, resize: 0, recovery: 'not_verified'}
  };
  function read() {
    try { observe(); } catch (_) { summary.observationStatus = 'unavailable'; }
    return JSON.parse(JSON.stringify(summary));
  }
  function emit() {
    if (emitted) return;
    emitted = true;
    console.warn('[WXSLIM_RENDER_SUMMARY] ' + JSON.stringify(read()));
  }
  function errorLocation(error) {
    var location = {errorName: 'unavailable', status: 'unavailable', frames: []};
    // No message, function names, paths, URL parameters or dynamic asset names leave this helper.
    try {
      var name = error && error.name;
      if (['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'RuntimeError', 'CompileError', 'LinkError'].indexOf(name) !== -1) location.errorName = name;
      var stack = error && error.stack;
      if (typeof stack !== 'string') return location;
      var lines = stack.slice(0, 32768).split('\n').slice(0, 64);
      var files = ['game.js', 'framework.js', 'index.js', 'render-runtime.js', 'render-observer.js', 'godot-bridge.js', 'custom-package.js', 'single-entry.js', 'WAGame.js', 'WAGameSubContext.js', 'WAService.js', 'WAServiceMainContext.js', 'WAWorker.js', 'WAWebview.js', 'game.wasm', 'framework.wasm', 'godot.wasm'];
      for (var i = 0; i < lines.length && location.frames.length < 6; i++) {
        var frame = lines[i].trim();
        // Recognize JSC function@location and V8 at function (location) / at location only.
        if (/\beval\b/.test(frame)) continue;
        var at = frame.indexOf('@'), source;
        if (/^at\s/.test(frame)) {
          source = frame.slice(3).trim();
          var open = source.indexOf('(');
          if (open !== -1) {
            if (source.charAt(source.length - 1) !== ')') continue;
            source = source.slice(open + 1, -1);
          }
        } else if (at !== -1 && !/[:()]/.test(frame.slice(0, at))) source = frame.slice(at + 1);
        else continue;
        var match = /^([^\s()]+?):(\d{1,7})(?::(\d{1,7}))?$/.exec(source);
        if (!match || /[?#]/.test(match[1])) continue;
        var path = match[1].replace(/\\/g, '/'), file = path.slice(path.lastIndexOf('/') + 1);
        if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^(?:https?|wxfile|plugin|weapp|file):\/\//i.test(path) && !/^[a-z]:\//i.test(path)) continue;
        if (files.indexOf(file) === -1) continue;
        var line = Number(match[2]), column = match[3] === undefined ? undefined : Number(match[3]);
        if (line < 1 || column !== undefined && column < 1) continue;
        var safeFrame = {file: file, line: line, scope: /\.wasm$/.test(file) ? 'wasm' : /(?:^|\/)(?:plugins?|__plugin__)(?:\/|:)/i.test(path) ? 'plugin' : 'package'};
        if (column !== undefined) safeFrame.column = column;
        location.frames.push(safeFrame);
      }
      if (location.frames.length) location.status = 'available';
    } catch (_) { /* Unreadable error properties must not replace the original failure. */ }
    return location;
  }
  function fail(code, reason, originalError) {
    try { observe(); } catch (_) { summary.observationStatus = 'unavailable'; }
    if (summary.initialization !== 'failed' && summary.initialization !== 'blocked') {
      summary.initialization = code === 'WXSLIM_GLX_CAPABILITY_UNAVAILABLE' ? 'blocked' : 'failed';
      summary.failureReason = {code: code, message: reason};
      if (originalError !== undefined) summary.failureReason.location = errorLocation(originalError);
    }
    emit();
    var error = Error(code + ': ' + reason); error.wxslimRenderCode = code;
    return error;
  }
  function requireValue(ok, code, reason) { if (!ok) throw fail(code, reason); }
  function observe() {
    if (!reader) return;
    var state = reader();
    summary.actualContext = state.context;
    summary.nativeBindings = state.nativeBindings;
    summary.offscreenResizeFunction = state.offscreenResizeFunction;
    summary.moduleContextMatches = state.moduleContextMatches;
    summary.observationStatus = 'available';
  }
  var api = {
    read: read,
    // Explicit user action only. Works even if the engine never started.
    show: function () {
      if (typeof wxApi.showModal === 'function') wxApi.showModal({title: 'WXSLIM rendering diagnostic', content: JSON.stringify(read()), showCancel: false});
      return read();
    },
    fail: function (error) {
      var message = '', code;
      try { var rawMessage = error && error.message; if (typeof rawMessage === 'string') message = rawMessage; } catch (_) {}
      try { code = error && error.wxslimRenderCode; } catch (_) {}
      // The catch boundary can receive arbitrary third-party objects, not just our own Errors.
      if (['WXSLIM_GLX_BINDINGS_MISSING', 'WXSLIM_GLX_BUFFER_UNOBSERVED', 'WXSLIM_GLX_CAPABILITY_UNAVAILABLE', 'WXSLIM_GLX_CONTEXT_INVALID', 'WXSLIM_GLX_CONTEXT_MISMATCH', 'WXSLIM_GLX_CONTEXT_UNAVAILABLE', 'WXSLIM_GLX_INIT_UNOBSERVED', 'WXSLIM_GLX_NATIVE_FAILED', 'WXSLIM_GODOT_MAIN_FAILED', 'WXSLIM_RENDER_ALREADY_FAILED', 'WXSLIM_RENDER_BOOT_FAILED', 'WXSLIM_RENDER_CONFIG_INVALID', 'WXSLIM_RENDER_CONFIG_MISMATCH', 'WXSLIM_RENDER_CONTEXT_MISMATCH', 'WXSLIM_RENDER_CONTEXT_MISSING', 'WXSLIM_RENDER_OBSERVER_MISSING', 'WXSLIM_RENDER_PIN_CHANGED', 'WXSLIM_UNEXPECTED_GLX_CONTEXT'].indexOf(code) === -1) code = undefined;
      var reason = '启动未完成；请结合本地引擎错误日志定位。';
      if (/Canvas context mode mismatch/.test(message)) { code = 'WXSLIM_RENDER_CONTEXT_MISMATCH'; reason = '加载器与引擎上下文模式不匹配；已停止，未回退。'; }
      else if (/Failed to create pinned/.test(message)) { code = 'WXSLIM_GLX_CONTEXT_UNAVAILABLE'; reason = '宿主声明支持 GLX，但未返回请求的 GLX 上下文。'; }
      else if (/native bindings are missing/.test(message)) { code = 'WXSLIM_GLX_BINDINGS_MISSING'; reason = '引擎缺少 GLX 原生绑定。'; }
      return fail(code || 'WXSLIM_RENDER_BOOT_FAILED', reason, error);
    },
    prepare: function (module, expectedMode) {
      requireValue(expectedMode === mode, 'WXSLIM_RENDER_CONFIG_MISMATCH', '启动桥与包配置模式不一致，请重新转换。');
      requireValue(root.__godotMinigameWXGLXEnabled === (mode === 'glx') && root.__GODOT_DISABLE_WXGLX === (mode !== 'glx'), 'WXSLIM_RENDER_PIN_CHANGED', '加载阶段修改了渲染模式，拒绝混用上下文。');
      requireValue(mode !== 'webgl' || !module.wxContextGlobal, 'WXSLIM_UNEXPECTED_GLX_CONTEXT', '请求 WebGL，但加载器提供了 GLX 原生上下文。');
      if (mode === 'glx' && module.wxContextGlobal !== undefined) {
        requireValue(module.wxContextGlobal && Number.isFinite(module.wxContextGlobal.ctxid), 'WXSLIM_GLX_CONTEXT_INVALID', '加载器提供的 GLX 上下文缺少有效 ctxid。');
        summary.bufferInitialization = 'loader_owned_unverified';
      }
    },
    attach: function (module) {
      requireValue(typeof module.__WXSLIM_READ_RENDER__ === 'function', 'WXSLIM_RENDER_OBSERVER_MISSING', '引擎上下文观察入口缺失，请使用本工具重新转换。');
      reader = module.__WXSLIM_READ_RENDER__; observe();
      if (mode === 'glx') requireValue(summary.nativeBindings, 'WXSLIM_GLX_BINDINGS_MISSING', '引擎缺少 GLX 原生绑定，不能仅靠 enableGLX 启用。');
    },
    nativeCall: function (name, invoke) {
      // Fixed three entries; preserve the first failure and never collect native args.
      var record = summary.native[name] || (summary.native[name] = {calls: 0, result: 'not_observed'});
      record.calls = Math.min(65535, record.calls + 1);
      try { var result = invoke(); if (record.result !== 'threw') record.result = 'returned'; return result; }
      catch (error) { record.result = 'threw'; throw fail('WXSLIM_GLX_NATIVE_FAILED', name + ' 原生调用抛错；已停止，未回退 WebGL。', error); }
    },
    exit: function (code) {
      if (typeof code === 'number' && code !== 0) fail('WXSLIM_GODOT_MAIN_FAILED', 'Godot 非零退出（' + code + '），不能视为初始化通过。');
    },
    complete: function (mainResult) {
      requireValue(typeof mainResult !== 'number' || mainResult === 0, 'WXSLIM_GODOT_MAIN_FAILED', 'Godot callMain 返回非零退出码，不能视为初始化通过。');
      requireValue(summary.initialization !== 'failed' && summary.initialization !== 'blocked', 'WXSLIM_RENDER_ALREADY_FAILED', '此前初始化已失败，不能改写为成功。');
      requireValue(root.__godotMinigameWXGLXEnabled === (mode === 'glx') && root.__GODOT_DISABLE_WXGLX === (mode !== 'glx'), 'WXSLIM_RENDER_PIN_CHANGED', '初始化期间修改了渲染模式，拒绝把混用上下文报告为成功。');
      observe();
      requireValue(summary.actualContext !== null, 'WXSLIM_RENDER_CONTEXT_MISSING', 'callMain 返回后未观察到引擎实际上下文，不能声称初始化成功。');
      requireValue(summary.actualContext.mode === mode, 'WXSLIM_RENDER_CONTEXT_MISMATCH', '实际引擎上下文与请求模式不同，已停止，未回退。');
      if (mode === 'glx') {
        requireValue(summary.actualContext.webgl2 === true && summary.moduleContextMatches === true, 'WXSLIM_GLX_CONTEXT_MISMATCH', '引擎 GLX 上下文版本或 ctxid 与模块不匹配。');
        for (var i = 0, names = ['glxInit', 'glxUpdateContextId']; i < names.length; i++) {
          requireValue(summary.native[names[i]] && summary.native[names[i]].result === 'returned', 'WXSLIM_GLX_INIT_UNOBSERVED', names[i] + ' 未观察到正常返回。');
        }
        var buffer = summary.native.glxInitBufferDataAndGlState;
        if (!buffer || buffer.result !== 'returned') {
          requireValue(summary.bufferInitialization === 'loader_owned_unverified', 'WXSLIM_GLX_INIT_UNOBSERVED', '新建 GLX 上下文未观察到缓冲初始化正常返回。');
          summary.initialization = 'inconclusive';
          summary.failureReason = {code: 'WXSLIM_GLX_BUFFER_UNOBSERVED', message: '加载器已有上下文，未观察到本引擎缓冲初始化；不能声称 GLX 初始化通过。'};
          emit(); return;
        }
        summary.bufferInitialization = 'returned';
      }
      summary.initialization = 'initialized'; emit();
    }
  };
  root.__WXSLIM_RENDER_DIAGNOSTIC__ = api;
  try {
    requireValue(config.schema === 'wxslim-render-config-v1' && (mode === 'webgl' || mode === 'glx'), 'WXSLIM_RENDER_CONFIG_INVALID', '渲染配置缺失或模式无效；只接受 webgl/glx。');
    var capability = wxApi.env && wxApi.env.isSupportEmscriptenGLX;
    summary.capability = {present: typeof capability !== 'undefined', value: typeof capability === 'boolean' ? capability : null};
    requireValue(mode !== 'glx' || capability === true, 'WXSLIM_GLX_CAPABILITY_UNAVAILABLE', '当前微信宿主未明确提供 EmscriptenGLX 能力；这是环境阻断，不是游戏兼容性结论。');
    root.__godotMinigameWXGLXEnabled = mode === 'glx';
    root.__GODOT_DISABLE_WXGLX = mode !== 'glx';
    // Counts only. No pause/resume, recreation or automatic recovery claims.
    [['onHide', 'hide'], ['onShow', 'show'], ['onWindowResize', 'resize']].forEach(function (pair) {
      try {
        if (typeof wxApi[pair[0]] === 'function') wxApi[pair[0]](function () { summary.lifecycle[pair[1]] = Math.min(65535, summary.lifecycle[pair[1]] + 1); });
      } catch (_) { (summary.lifecycle.unavailableObservers || (summary.lifecycle.unavailableObservers = [])).push(pair[1]); }
    });
  } catch (error) { throw error; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
