/* Star Tap 的游戏专用接口：只有微信登录 DemoWx（浏览器兼容由 convert 默认的 godot-data/wx-compat.js 提供）。
 * GDScript 用 JavaScriptBridge.get_interface("DemoWx") 调 startLogin()，然后轮询 state（pending / ok / fail），ok 时读 code。
 * gate2d：false = 方案一（只有 3D 过点击门）；true = 方案二（2D、3D 都过点击门，2D 代码也在余包）。
 * qa：正式包为 false；测试包设成 "2d" 或 "3d"，登录后自动玩一局（只用于开发者工具测试）。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  var demo = {gate2d: true, qa: false, state: 'idle', code: '', error: '', available: typeof wx !== 'undefined' && typeof wx.login === 'function'};
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
  // 分包版（wasmsplit onclick）才有点击门；Godot 直接 get_interface 一个不存在的名字会打错误日志，所以先问这里
  // 点击门的全局名：新名 __WXSLIM_CLICK_GATE__，旧版运行时（2026-10-17 前）叫 __WX15_RELEASE_CLICK_GATE__
  function has(n) { return !!(G[n] || (G.window && G.window[n])); }
  demo.clickGateName = function () { return has('__WXSLIM_CLICK_GATE__') ? '__WXSLIM_CLICK_GATE__' : has('__WX15_RELEASE_CLICK_GATE__') ? '__WX15_RELEASE_CLICK_GATE__' : ''; };
  demo.hasClickGate = function () { return demo.clickGateName() !== ''; };
  // 分包采集包（split collect-pack）会装训练等待门并发布这个诊断对象：点 3D 时只走完等待，不进 3D
  demo.isTraining = function () { return has('__WXSLIM_COLLECT_GATE__') || has('__WX15_TRAINING12_GATE_DIAGNOSTIC__'); };
  G.DemoWx = demo;
  if (G.window && G.window !== G) G.window.DemoWx = demo;
})();
