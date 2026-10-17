// 契约测试：文档里的“游戏接入约定”（点击门、采集门、接口文件、[STARTUP_3D_FLOW] 计时事件）靠这些用例保证。
// 用的是仓库里真实的运行时文件（点击门核心、采集门、wx-compat、插件 JS、计时模块）和插件 GDScript 源码；
// 微信环境用 vm 模拟，Godot 一侧要么静态检查源码，要么（给了 Godot 可执行文件时）headless 跑 tests/godot-flow 截 stdout。
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import vm from 'node:vm'; import {spawnSync} from 'node:child_process';
import {runTimingTests} from '../split/lib/timing-tests.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const ADDON = 'godot-addon/addons/wx_split';
const src = {
  core: read('split/assets/click-owned-runtime-core.js'), collect: read('split/assets/collect-gate.js'), timing: read('split/assets/wxslim-timing.js'),
  compat: read('convert/assets/wx-compat.js'), addonJs: read(ADDON + '/wx_split.js'), addonGd: read(ADDON + '/wx_split.gd'),
  convert: read('convert/convert.mjs'), verify: read('convert/lib/verify.mjs'), kit: read('split/kit.mjs'),
};
// 点击门返回值的形状（split/README“游戏接入约定”）：IDLE / PENDING / READY，或以 _REQUIRED / _RETRYABLE 结尾的错误码
const GATE_SHAPE = /^(IDLE|PENDING|READY|[A-Z0-9_]+_(REQUIRED|RETRYABLE))$/;
const NEW_GATE = '__WXSLIM_CLICK_GATE__', OLD_GATE = '__WX15_RELEASE_CLICK_GATE__', NEW_COLLECT = '__WXSLIM_COLLECT_GATE__', OLD_COLLECT = '__WX15_TRAINING12_GATE_DIAGNOSTIC__';

const eq = (a, b, m) => { if (a !== b) throw Error(`${m}：得到 ${JSON.stringify(a)}，应为 ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw Error(m); };
const shape = s => ok(GATE_SHAPE.test(s), '点击门返回值形状不对：' + s);

// 模拟小游戏全局：GameGlobal 和 globalThis 是同一个对象，另有一个 window（WXGameKit 里 GameGlobal.window 存在且不同）
function wechat({withWx = true} = {}) {
  const logs = [], info = [];
  const g = {console: {log: (...a) => logs.push(a.map(String).join(' ')), info: (...a) => info.push(a.map(String).join(' ')), warn() {}, error() {}},
    Date, JSON, Math, Promise, Error, Object, Array, String, Number, Uint8Array, ArrayBuffer, DataView, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}};
  g.GameGlobal = g; g.globalThis = g; g.window = {}; g.navigator = {};
  if (withWx) g.wx = {getSystemInfoSync: () => ({platform: 'ios', model: 'test', version: '8', SDKVersion: '3'}), setStorageSync() {}, request() { return {abort() {}}; }, connectSocket() { return {onOpen() {}, onMessage() {}, onClose() {}, onError() {}, send() {}, close() {}}; },
    vibrateShort() {}, vibrateLong() {}, hideKeyboard() {}, onKeyboardComplete() {}, offKeyboardInput() {}, offKeyboardConfirm() {}, offKeyboardComplete() {}, login() {}};
  vm.createContext(g);
  return {g, logs, info, run: (code, name) => vm.runInContext(code, g, {filename: name})};
}
// 点击门核心（assemble 时插进官方 wasm-split.js 的那段）单独跑：官方运行时的函数用最小桩代替，下载和实例化由测试推进
function releaseGate(env) {
  env.run(`var tableSize=1;var mod={};function m(){return mod;}function h(){return 5;}
var c={canAwaitLoad:true,loadSubWasmCallbacks:[],loadSubWasmTask:void 0,subWasmInstantiated:false};
var pending=null;function F(cb){pending=cb;}function I(){__WXSLIM_CLICK__.beginI();c.subWasmInstantiated=true;__WXSLIM_CLICK__.successI();}
window.wasm_split_info={primary:{table:{length:10},memory:{buffer:{byteLength:1}},'global$0':{},'global$1':{},'global$2':{},'global$3':{}}};GameGlobal.CODE_FILE_MD5='x';
${src.core}
__WXSLIM_CLICK__.bind();`, 'click-owned-runtime-core.js');
  return {download: () => env.run('pending()'), fail: () => env.run('__WXSLIM_CLICK__.downloadFailed()'), miss: () => env.run('try{__WXSLIM_CLICK__.wait()}catch(e){}')};
}
const W = env => env.g.WxSplit;
// GDScript 通过 get_interface(名字) 取点击门：名字要在 GameGlobal（或 window）上能取到
const gateByName = env => { const n = W(env).clickGateName(); return n ? env.g[n] || env.g.window[n] : null; };

// 插件 GDScript 里对 JS 的调用、打印的事件（静态提取）
const gd = src.addonGd;
const gdJsCalls = [...new Set([...gd.matchAll(/\bapi\.(\w+)\(/g)].map(m => m[1]))];
const gdEvents = [...new Set([...gd.matchAll(/_flow\(\{"event": "(\w+)"/g)].map(m => m[1]))];
const timingEvents = new Set([...src.timing.matchAll(/ev==='(\w+)'/g)].map(m => m[1]).concat(Object.keys(JSON.parse(('{' + (src.timing.match(/var keep=\{([^}]*)\}/) || [, ''])[1] + '}').replace(/(\w+):/g, '"$1":')))));

// 计时模块沙盒：把 Godot 打印的行（console.log 一整行）喂进去，看汇总行
function timingSandbox(sizes) {
  let now = 1000; const out = [], timers = [];
  const g = {console: {log() {}, info: (...a) => out.push(a.map(String).join(' ')), error() {}, warn() {}}, Date: {now: () => now}, JSON, Math, setTimeout: (f, ms) => timers.push({f, at: now + (ms || 0)}), setInterval: () => 0,
    wx: {getSystemInfoSync: () => ({}), setStorageSync() {}}, __WXSLIM_SIZES__: sizes};
  g.GameGlobal = g; g.globalThis = g; vm.runInNewContext(src.timing, g);
  return {out, line: l => g.console.log(l), tick: ms => { now += ms; for (const t of timers.splice(0)) if (t.at <= now) t.f(); else timers.push(t); }, mark: (n, v) => g.__WXSLIM_TIMING__.mark(n, v)};
}
// 按插件 GDScript 的打印格式造一行：FLOW_TAG + " " + JSON.stringify(Dictionary)（Godot 的 JSON.stringify 不加空格、保持插入顺序）
const flowTag = (gd.match(/const FLOW_TAG := "([^"]+)"/) || [])[1];
const gdLine = obj => flowTag + ' ' + JSON.stringify(obj);

export function contractCases({godot = null, flowLogs = []} = {}) {
  const cases = [
    // ---------- 点击门 ----------
    ['点击门：新名优先，正式包 IDLE → PENDING → READY，新旧全局名是同一个对象', () => {
      const env = wechat(); env.run(src.addonJs, 'wx_split.js'); const r = releaseGate(env);
      eq(W(env).clickGateName(), NEW_GATE, 'clickGateName'); ok(env.g[OLD_GATE] === env.g[NEW_GATE] && env.g.window[NEW_GATE] === env.g[NEW_GATE], '新旧名、window 上的应是同一个点击门');
      const gate = gateByName(env); eq(gate.status(), 'IDLE', '初始'); const s1 = gate.request(); eq(s1, 'PENDING', 'request'); shape(s1);
      eq(gate.status(), 'PENDING', '下载中'); r.download(); const s2 = gate.status(); eq(s2, 'READY', '下载+实例化后'); shape(s2);
      eq(gate.request(), 'READY', '再次进入复用'); eq(W(env).isCollect(), false, '正式包不是采集包');
    }],
    ['点击门：下载失败 → DOWNLOAD_FAILED_RETRYABLE，可以重试；首包缺函数 → *_RESTART_REQUIRED', () => {
      const env = wechat(); env.run(src.addonJs, 'wx_split.js'); const r = releaseGate(env), gate = gateByName(env);
      gate.request(); r.fail(); const s = gate.status(); eq(s, 'DOWNLOAD_FAILED_RETRYABLE', '下载失败'); shape(s);
      eq(gate.request(), 'PENDING', '可重试'); r.miss(); const m = gate.status(); shape(m); ok(m.endsWith('_REQUIRED'), '缺函数应是 _REQUIRED 错误码：' + m);
      eq(gate.request(), m, '_REQUIRED 之后 request 原样返回错误码（GDScript 显示失败，不重试）');
    }],
    ['点击门：只有旧名（2026-10-17 前的运行时）时回退旧名；没分包时返回空名', () => {
      const env = wechat(); env.run(src.addonJs, 'wx_split.js'); eq(W(env).clickGateName(), '', '没分包'); eq(W(env).hasClickGate(), false, 'hasClickGate');
      const old = {request: () => 'PENDING', status: () => 'READY', cancel() {}}; env.g.window[OLD_GATE] = old;
      eq(W(env).clickGateName(), OLD_GATE, '只有旧名'); ok(gateByName(env) === old, '旧名取到的应是旧点击门');
      env.g[NEW_GATE] = {request: () => 'READY'}; eq(W(env).clickGateName(), NEW_GATE, '新旧都有时新名优先');
    }],
    ['点击门：插件 GDScript 只把 PENDING 当等待、只把 READY 当成功，其余原样返回', () => {
      ok(/const PENDING := "PENDING"/.test(gd) && /const READY := "READY"/.test(gd), '缺 READY / PENDING 常量');
      ok(/var status := str\(gate\.request\(\)\)\s*\n\s*while status == PENDING:\s*\n\s*await get_tree\(\)\.process_frame\s*\n\s*status = str\(gate\.status\(\)\)/.test(gd), '没有 request() 后按帧轮询 status() 的写法');
      ok(/if status != READY:\s*\n\s*_flow\(\{"event": "transition_failed", "scene": scene_tag, "status": status\}\)\s*\n\s*return status/.test(gd), '非 READY 时应打 transition_failed 并原样返回错误码');
      ok(/var gate_name := str\(api\.clickGateName\(\)\)\s*\n\s*if gate_name != "":\s*\n\s*var gate: JavaScriptObject = JavaScriptBridge\.get_interface\(gate_name\)/.test(gd), '取点击门之前要先问 WxSplit.clickGateName()（不存在时 Godot 会打错误日志）');
      const gi = [...gd.matchAll(/JavaScriptBridge\.get_interface\((\w+)\)/g)].map(m => m[1]).sort();
      eq(gi.join(','), 'JS_API,gate_name', 'get_interface 只允许取 WxSplit 和问出来的点击门名');
      ok(/if OS\.has_feature\("web"\):\s*\n\s*_api = JavaScriptBridge\.get_interface\(JS_API\)/.test(gd), 'WxSplit 只在 Web 导出里取');
      ok(/const JS_API := "WxSplit"/.test(gd), 'JS_API 应为 WxSplit');
    }],
    // ---------- 采集门 ----------
    ['采集门：训练等待门装上后 isCollect() 为真，点击门名仍是新名，PENDING 若干帧后 READY（不下载）', () => {
      const env = wechat(); env.run(src.addonJs, 'wx_split.js'); eq(W(env).isCollect(), false, '装门前');
      env.run(src.collect, 'collect-gate.js'); eq(W(env).isCollect(), true, '装门后（插件 JS 先加载、门后挂上也要认）');
      ok(env.g[NEW_COLLECT] && env.g[OLD_COLLECT], '新旧诊断对象名都要发布'); eq(W(env).clickGateName(), NEW_GATE, '采集包的点击门名');
      const gate = gateByName(env); eq(gate.request(), 'PENDING', 'request'); let s = 'PENDING', n = 0; while (s === 'PENDING' && n < 1000) { s = gate.status(); n++; }
      eq(s, 'READY', '轮询结果'); shape(s); ok(n > 1, '应至少等几帧'); eq(env.g[NEW_COLLECT].meaning, 'TRAINING_WAIT_NOT_DOWNLOAD', '诊断对象');
    }],
    ['采集门：只有旧诊断对象名时也认作采集包', () => {
      const env = wechat(); env.run(src.addonJs, 'wx_split.js'); env.g.window[OLD_COLLECT] = {state: 'IDLE'}; eq(W(env).isCollect(), true, '旧名');
    }],
    ['采集门：“过门即停”——READY 之后先判采集包，打 collection_gate_complete_3d_blocked 并返回 TRAINING_DONE，不 load() 场景', () => {
      const ready = gd.indexOf('if status != READY:'), coll = gd.indexOf('if bool(api.isCollect()):'), load = gd.indexOf('var scene := load(path) as PackedScene');
      ok(ready > 0 && coll > ready && load > coll, '顺序应为：等到 READY → 判采集包 → load()');
      ok(/if bool\(api\.isCollect\(\)\):\s*\n\s*_flow\(\{"event": "collection_gate_complete_3d_blocked", "scene": scene_tag\}\)\s*\n\s*return TRAINING_DONE/.test(gd), '采集包过门后应打事件并返回 TRAINING_DONE');
      ok(/const TRAINING_DONE := "TRAINING_DONE"/.test(gd), 'TRAINING_DONE 常量');
      ok(!/\bpreload\(/.test(gd), '插件里不能 preload 场景');
    }],
    ['采集门：插件 JS 拼进接口文件也不会让 collect-pack 误判“门已装”', () => {
      const markers = [...src.kit.matchAll(/s\.includes\('([^']+collection-only)'\)/g)].map(m => m[1]);
      ok(markers.length >= 2, 'kit.mjs 里找不到训练门的已装标记（collect-pack 的判断方式变了，要同步这个用例）');
      for (const m of markers) ok(!src.addonJs.includes(m), '插件 JS 不能含训练门标记：' + m);
      ok(src.collect.includes(markers[0]), '训练门自己的头注释要含标记');
    }],
    // ---------- 接口文件 ----------
    ['接口文件：按 convert 的 game.js 顺序加载 计时 → wx-compat → wx-split → 游戏接口 → 采集门，互不冲突', () => {
      const env = wechat(); env.g.__WXSLIM_SIZES__ = {primaryBr: 1, code1Br: null, mode: 'nosplit'};
      env.run(src.timing, 'wxslim-timing.js'); env.run(src.compat, 'wx-compat.js');
      const before = new Set(Object.keys(env.g)); env.run(src.addonJs, 'wx_split.js');
      const added = Object.keys(env.g).filter(k => !before.has(k)); eq(added.join(','), 'WxSplit', '插件 JS 只应新增 WxSplit 一个全局');
      env.run(read('examples/startap/wx/demowx-gate2d.js'), 'demowx-gate2d.js'); env.run(src.collect, 'collect-gate.js');
      ok(env.g.__WX_COMPAT__, 'wx-compat 应已生效'); ok(env.g.DemoWx && typeof env.g.DemoWx.startLogin === 'function', 'DemoWx 登录接口'); ok(env.g.window.WxSplit === env.g.WxSplit, 'window 上也要有 WxSplit');
      eq(W(env).gateFor('2d'), 'on', '方案二 2D 过门'); eq(W(env).gateFor('3d'), '', '3D 用 GDScript 默认'); eq(W(env).qaMode(), '', '正式接口不开自动测试'); eq(W(env).isWechat(), true, 'isWechat'); eq(W(env).isCollect(), true, '采集门');
      ok(!/WxSplit/.test(src.compat), 'wx-compat 不应碰 WxSplit');
    }],
    ['接口文件：插件 JS 重复加载（convert 默认装 + 拼进接口文件）保留第一个；配置 WxSplitConfig 先写后写都生效', () => {
      const env = wechat(); env.g.WxSplitConfig = {qa: '3d'}; env.run(src.addonJs, 'a'); const first = env.g.WxSplit; env.run(src.addonJs, 'b');
      ok(env.g.WxSplit === first, '重复加载不能替换'); eq(W(env).qaMode(), '3d', '先写的配置'); env.g.window.WxSplitConfig = {gate: {'2d': false}}; delete env.g.WxSplitConfig;
      eq(W(env).gateFor('2d'), 'off', '只写在 window 上的配置'); eq(W(env).qaMode(), '', '新配置里没有 qa');
      const qa = wechat(); qa.run(src.addonJs, 'x'); qa.run(read('examples/startap/wx/demowx-qa3d.js'), 'demowx-qa3d.js'); eq(W(qa).qaMode(), '3d', 'demowx-qa3d.js');
      const plain = wechat({withWx: false}); plain.run(src.addonJs, 'x'); eq(W(plain).isWechat(), false, '没有 wx 时'); eq(W(plain).qaMode(), '', '没配置');
    }],
    ['接口文件：插件 GDScript 调到的 JS 函数在插件 JS 里都有', () => {
      const env = wechat(); env.run(src.addonJs, 'x'); ok(gdJsCalls.length >= 4, '没提取到 GDScript 的 JS 调用');
      for (const f of gdJsCalls) eq(typeof W(env)[f], 'function', 'WxSplit.' + f);
    }],
    ['接口文件：convert 默认装 godot-data/wx-split.js（插件同一份源文件），import 在 wx-compat 之后、local-interfaces 之前；verify 会检查', () => {
      ok(src.convert.includes("'../godot-addon/addons/wx_split/wx_split.js'") && src.convert.includes("f('godot-data/wx-split.js')"), 'convert 没从插件目录复制 wx_split.js');
      const line = src.convert.split('\n').find(l => l.includes("import './godot-data/local-interfaces'")) || '';
      const a = line.indexOf("import './godot-data/wx-compat'"), b = line.indexOf("import './godot-data/wx-split'"), c = line.indexOf("import './godot-data/local-interfaces'");
      ok(a > 0 && b > a && c > b, 'game.js import 顺序应为 wx-compat → wx-split → local-interfaces');
      ok(src.verify.includes("import './godot-data/wx-split'") && src.verify.includes('WXSLIM_ADDON_JS'), 'convert verify 没检查 wx-split.js'); ok(src.addonJs.includes('WXSLIM_ADDON_JS'), '插件 JS 缺头标记');
    }],
    ['接口文件：examples/startap 里的插件副本和 godot-addon 一致', () => {
      for (const f of fs.readdirSync(path.join(root, ADDON))) {
        const x = read('examples/startap/game/addons/wx_split/' + f).replace(/\r\n/g, '\n').split('\n'), y = read(ADDON + '/' + f).replace(/\r\n/g, '\n').split('\n'), i = y.findIndex((l, k) => l !== x[k]);
        ok(i < 0 && x.length === y.length, `副本 ${f} 和源文件不同（第 ${i < 0 ? y.length + 1 : i + 1} 行起；改完插件要复制到 examples/startap/game/addons/wx_split）`);
      }
    }],
    // ---------- 计时 ----------
    ...runTimingTests(src.timing).map(r => ['计时：' + r.name, () => { if (!r.ok) throw Error(r.error); }]),
    ['计时：插件打印的事件名都是计时模块认识的，格式是“[STARTUP_3D_FLOW] + 空格 + JSON”', () => {
      eq(flowTag, '[STARTUP_3D_FLOW]', 'FLOW_TAG'); ok(/print\(FLOW_TAG \+ " " \+ JSON\.stringify\(event\)\)/.test(gd), '打印方式变了');
      for (const e of ['two_d_first_frame', 'click', 'scene_first_frame', 'transition_failed', 'collection_gate_complete_3d_blocked']) ok(gdEvents.includes(e), '插件没打 ' + e);
      for (const e of gdEvents) ok(timingEvents.has(e), '计时模块不认识插件的事件 ' + e);
    }],
    ['计时：按插件格式回放“标题 → 点 3D → 过门 → 3D 首帧”，输出首包进场景和点击进 3D 的分段', () => {
      const s = timingSandbox({primaryBr: 3e6, code1Br: 3.5e6, mode: 'onclick'});
      s.mark('callmain_ms', 1100); s.line(gdLine({event: 'two_d_first_frame', scene: 'title'}));
      ok(s.out.some(l => /首包进场景：总计/.test(l)), '没有首包进场景：' + s.out.join(' / '));
      s.line(gdLine({event: 'click', scene: '3d'})); s.tick(10); s.mark('click_request', false); s.tick(800); s.mark('code1_downloaded'); s.tick(400); s.mark('code1_ready'); s.tick(300);
      s.line(gdLine({event: 'scene_first_frame', scene: '3d'}));
      ok(s.out.some(l => /点击进3D：总计 1510ms \| 下载剩余WASM\(3\.50MB\) 800ms \| 编译实例化 400ms \| 场景加载到首帧 300ms/.test(l)), '点击进 3D 汇总不对：' + s.out.join(' / '));
      s.line(gdLine({event: 'click', scene: '2d'})); s.line(gdLine({event: 'transition_failed', scene: '2d', status: 'LOAD_FAILED'}));
      ok(s.out.some(l => /进2D失败：LOAD_FAILED/.test(l)), '失败汇总：' + s.out.join(' / '));
    }],
  ];
  for (const f of flowLogs) cases.push(['计时：回放真实 Godot 输出 ' + path.basename(f), () => replayFlow(fs.readFileSync(f, 'utf8'))]);
  if (godot) cases.push(['Godot headless：插件在电脑上的分支和打印格式（tests/godot-flow）', () => godotFlow(godot)]);
  return cases;
}

// 把 Godot stdout 里的 [STARTUP_3D_FLOW] 行喂给计时模块：至少要有首包进场景和一次进场景汇总
function replayFlow(text) {
  const lines = text.split(/\r?\n/).filter(l => l.startsWith('[STARTUP_3D_FLOW] '));
  ok(lines.length >= 3, '输出里 [STARTUP_3D_FLOW] 行太少：' + lines.length);
  for (const l of lines) { const j = JSON.parse(l.slice('[STARTUP_3D_FLOW] '.length)); ok(timingEvents.has(j.event), '不认识的事件 ' + j.event); }
  const s = timingSandbox({primaryBr: 6e6, code1Br: null, mode: 'nosplit'}); s.mark('callmain_ms', 1000);
  for (const l of lines) { s.line(l); s.tick(50); }
  ok(s.out.some(l => /首包进场景：总计/.test(l)), '没有首包进场景：' + s.out.join(' / '));
  ok(s.out.some(l => /进(2D|3D)：总计 \d+ms（未分包）/.test(l)), '没有进场景汇总：' + s.out.join(' / '));
  return lines.length;
}

function godotFlow(exe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxsplit-flow-'));
  try {
    for (const f of fs.readdirSync(path.join(root, 'tests/godot-flow'))) fs.copyFileSync(path.join(root, 'tests/godot-flow', f), path.join(dir, f));
    fs.mkdirSync(path.join(dir, 'addons/wx_split'), {recursive: true});
    for (const f of fs.readdirSync(path.join(root, ADDON))) fs.copyFileSync(path.join(root, ADDON, f), path.join(dir, 'addons/wx_split', f));
    const r = spawnSync(exe, ['--headless', '--path', dir, '--', '--qa-play=3d', '--qa-quit', '--qa-shot=x.png'], {encoding: 'utf8', timeout: 120000, windowsHide: true});
    const out = (r.stdout || '') + '\n' + (r.stderr || '');
    ok(r.status === 0, 'Godot 退出码 ' + r.status + (r.error ? ' ' + r.error.code : '') + '\n' + out.slice(-1500));
    const want = ['[WXSLIM_ADDON_TEST] qa_mode=3d qa_quit=true qa_shot=x.png wechat=false collect=false', '[STARTUP_3D_FLOW] {"event":"two_d_first_frame","scene":"title"}',
      '[STARTUP_3D_FLOW] {"event":"click","scene":"3d"}', '[STARTUP_3D_FLOW] {"event":"transition_failed","scene":"3d","status":"LOAD_FAILED"}', '[WXSLIM_ADDON_TEST] missing=LOAD_FAILED',
      '[STARTUP_3D_FLOW] {"event":"click","scene":"2d"}', '[WXSLIM_ADDON_TEST] enter=READY', '[STARTUP_3D_FLOW] {"event":"scene_first_frame","scene":"2d"}', '[WXSLIM_ADDON_TEST] done'];
    const lines = out.split(/\r?\n/); let at = -1;
    for (const w of want) { const i = lines.indexOf(w, at + 1); ok(i > at, '缺少或顺序不对：' + w + '\n' + lines.filter(l => l.startsWith('[')).join('\n')); at = i; }
    ok(!/SCRIPT ERROR|Parse Error/.test(out), '插件脚本报错：\n' + out.split(/\r?\n/).filter(l => /ERROR/.test(l)).join('\n'));
    replayFlow(out);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

export function runContracts(opts) {
  return contractCases(opts).map(([name, fn]) => { try { fn(); return {name, ok: true}; } catch (e) { return {name, ok: false, error: String(e.message).slice(0, 1200)}; } });
}
