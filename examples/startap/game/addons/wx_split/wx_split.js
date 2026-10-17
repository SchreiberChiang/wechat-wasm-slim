/* WXSLIM_ADDON_JS: wx_split 插件的 JS 侧（Godot 插件 addons/wx_split 配套）。
 * convert 默认装成 godot-data/wx-split.js（在 wx-compat 之后、local-interfaces 之前加载），游戏不用自己写。
 * 只放 GDScript 需要的探测函数，返回值都是字符串或布尔，每次调用时现查全局（采集门、点击门比这个文件晚挂上也没关系）：
 *   WxSplit.clickGateName()  点击门的全局名：新名 __WXSLIM_CLICK_GATE__ 优先，旧名 __WX15_RELEASE_CLICK_GATE__ 回退，没有返回 ''
 *   WxSplit.isCollect()      采集包（split collect-pack 装的训练等待门会发布 __WXSLIM_COLLECT_GATE__，旧名 __WX15_TRAINING12_GATE_DIAGNOSTIC__）
 *   WxSplit.isWechat()       在微信里（有 wx.getSystemInfoSync）
 *   WxSplit.qaMode()         自动测试模式：游戏接口文件里设 WxSplitConfig.qa = "2d" | "3d"（任意场景标记）；正式包不设
 *   WxSplit.gateFor(tag)     WxSplitConfig.gate[tag] 为 true / false 时返回 'on' / 'off'，否则 ''（按分包方案改哪些场景过门，不用改 PCK）
 * 游戏配置写在自己的接口文件（--interfaces / releaseInterfaces）里，例如：
 *   GameGlobal.WxSplitConfig = {gate: {'2d': true}, qa: '3d'};
 * Godot 直接 get_interface 一个不存在的名字会打错误日志，所以 GDScript 先问这里再取点击门。
 * 本文件可以重复加载（例如同时被 convert 默认装上、又拼进了游戏接口文件），不会覆盖已有的 WxSplit。 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  var W = G.window && G.window !== G ? G.window : null;
  if (G.WxSplit && G.WxSplit.__wxslimAddon) { if (W && !W.WxSplit) W.WxSplit = G.WxSplit; return; }
  function get(n) { var v = G[n]; if (v === undefined && W) v = W[n]; return v; }
  function has(n) { return !!get(n); }
  function cfg() { var c = get('WxSplitConfig'); return c && typeof c === 'object' ? c : {}; }
  var api = {
    __wxslimAddon: 1,
    version: '1',
    clickGateName: function () { return has('__WXSLIM_CLICK_GATE__') ? '__WXSLIM_CLICK_GATE__' : has('__WX15_RELEASE_CLICK_GATE__') ? '__WX15_RELEASE_CLICK_GATE__' : ''; },
    hasClickGate: function () { return api.clickGateName() !== ''; },
    isCollect: function () { return has('__WXSLIM_COLLECT_GATE__') || has('__WX15_TRAINING12_GATE_DIAGNOSTIC__'); },
    isWechat: function () { var w = get('wx'); if (w === undefined && typeof wx !== 'undefined') w = wx; return !!(w && typeof w.getSystemInfoSync === 'function'); },
    qaMode: function () { var q = cfg().qa; return typeof q === 'string' ? q : q === true ? '2d' : ''; },
    gateFor: function (tag) { var g = cfg().gate, v = g && typeof g === 'object' ? g[String(tag)] : undefined; return v === true ? 'on' : v === false ? 'off' : ''; },
  };
  G.WxSplit = api;
  if (W) W.WxSplit = api;
})();
