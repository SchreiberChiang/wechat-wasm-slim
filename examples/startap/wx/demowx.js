/* Star Tap 的游戏专用接口：只有微信登录 DemoWx。
 * GDScript 用 JavaScriptBridge.get_interface("DemoWx") 调 startLogin()，然后轮询 state（pending / ok / fail），ok 时读 code。
 * 浏览器兼容（convert 默认的 godot-data/wx-compat.js）和点击门、采集包探测（插件 addons/wx_split 的 JS，convert 默认装成 godot-data/wx-split.js）都不在这里。
 * 方案一（标题 + 2D 首包，3D 余包）：不用写 WxSplitConfig，2D 不过点击门、3D 过门是 GDScript 里的默认值。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  var demo = {state: 'idle', code: '', error: '', available: typeof wx !== 'undefined' && typeof wx.login === 'function'};
  demo.startLogin = function () {
    demo.state = 'pending'; demo.code = ''; demo.error = '';
    try {
      wx.login({
        timeout: 10000,
        success: function (r) { if (r && r.code) { demo.code = r.code; demo.state = 'ok'; } else { demo.error = 'no code'; demo.state = 'fail'; } },
        fail: function (e) { demo.error = (e && e.errMsg) || 'login fail'; demo.state = 'fail'; },
      });
    } catch (e) { demo.error = String(e && e.message || e); demo.state = 'fail'; }
    return demo.state;
  };
  G.DemoWx = demo;
  if (G.window && G.window !== G) G.window.DemoWx = demo;
})();
