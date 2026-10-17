// 计时模块（assets/wxslim-timing.js）契约测试：按游戏实际的打印方式回放日志，确认汇总行真的会输出。
// 覆盖两种写法：Star Tap（Godot print → console.log 一整行，字段 event）和打砖块（console.info 两个参数，字段 stage）。
import fs from 'node:fs';import vm from 'node:vm';

function sandbox(sizes) {
  let now = 1000; const out = [], timers = [];
  const con = {log: () => {}, info: (...a) => out.push(a.map(String).join(' ')), error: () => {}, warn: () => {}};
  const g = {console: con, Date: {now: () => now}, JSON, Math, setTimeout: (f, ms) => timers.push({f, at: now + (ms || 0)}), setInterval: () => 0,
    wx: {getSystemInfoSync: () => ({platform: 'ios', model: 'test', version: '8', SDKVersion: '3'}), setStorageSync: () => {}}, __WXSLIM_SIZES__: sizes};
  g.GameGlobal = g; g.globalThis = g;
  const tick = ms => { now += ms; for (const t of timers.splice(0)) if (t.at <= now) t.f(); else timers.push(t); };
  return {g, out, tick, mark: (n, v) => g.__WXSLIM_TIMING__.mark(n, v)};
}
const load = (src, sizes) => { const s = sandbox(sizes); vm.runInNewContext(src, s.g); return s; };
const has = (out, re) => out.some(l => re.test(l));
const godotPrint = (s, obj) => s.g.console.log('[STARTUP_3D_FLOW] ' + JSON.stringify(obj));
const nativeStartup = s => s.g.console.log('[WX_NATIVE_STARTUP] ' + JSON.stringify({schema: 'wx-native-startup-v1', records: [{id: 1, label: 'webmain_total', duration_us: 1200000}]}));

export function runTimingTests(src) {
  const cases = [
    ['Star Tap 写法：未分包工程（convert 默认装）也输出首包进场景，callMain 取自原生计时', () => {
      const s = load(src, {primaryBr: 6e6, code1Br: null, mode: 'nosplit'});
      s.g.console.log('[WXSLIM_BOOT]', 'WASM_INSTANTIATED'); s.tick(500); nativeStartup(s); s.tick(300);
      godotPrint(s, {event: 'two_d_first_frame', scene: 'title'});
      if (!has(s.out, /首包进场景：总计 \d+ms.*callMain 1200ms.*未分包/)) throw Error('没有首包进场景汇总：' + s.out.join(' / '));
      godotPrint(s, {event: 'click', scene: '2d'}); s.tick(150); godotPrint(s, {event: 'scene_first_frame', scene: '2d'});
      if (!has(s.out, /进2D：总计 150ms（未分包）/)) throw Error('没有进 2D 汇总：' + s.out.join(' / '));
    }],
    ['Star Tap 写法：分包后点进 3D，统计下载、编译和场景加载', () => {
      const s = load(src, {primaryBr: 3e6, code1Br: 3.5e6, mode: 'onclick'});
      s.mark('callmain_ms', 1100); godotPrint(s, {event: 'two_d_first_frame', scene: 'title'});
      godotPrint(s, {event: 'click', scene: '3d'}); s.tick(10); s.mark('click_request', false);
      s.tick(800); s.mark('code1_downloaded'); s.tick(400); s.mark('code1_ready'); s.tick(300); godotPrint(s, {event: 'game_3d_first_frame'});
      if (!has(s.out, /点击进3D：总计 1510ms \| 下载剩余WASM\(3\.50MB\) 800ms \| 编译实例化 400ms \| 场景加载到首帧 300ms/)) throw Error('点进 3D 汇总不对：' + s.out.join(' / '));
      godotPrint(s, {event: 'click', scene: '2d'}); s.tick(5); s.mark('click_request', true); s.tick(100); godotPrint(s, {event: 'scene_first_frame', scene: '2d'});
      if (!has(s.out, /再次进2D：总计 105ms（剩余WASM已在内存/)) throw Error('再次进入汇总不对：' + s.out.join(' / '));
    }],
    ['Star Tap 写法：方案一里 2D 不过点击门，按“首包已含”统计', () => {
      const s = load(src, {primaryBr: 4e6, code1Br: 2.5e6, mode: 'onclick'});
      godotPrint(s, {event: 'click', scene: '2d'}); s.tick(90); godotPrint(s, {event: 'scene_first_frame', scene: '2d'});
      if (!has(s.out, /进2D：总计 90ms（首包已含这个场景的代码/)) throw Error(s.out.join(' / '));
    }],
    ['打砖块写法：console.info 两个参数、字段 stage、给出 transition_total_ms', () => {
      const s = load(src, {primaryBr: 3.5e6, code1Br: 5.6e6, mode: 'onclick'});
      s.mark('callmain_ms', 3000); s.g.console.info('[STARTUP_3D_FLOW]', JSON.stringify({stage: 'two_d_first_frame'}));
      if (!has(s.out, /首包进场景：总计/)) throw Error('没有首包进场景汇总');
      s.mark('click_request', false); s.tick(700); s.mark('code1_downloaded'); s.tick(300); s.mark('code1_ready');
      s.g.console.info('[STARTUP_3D_FLOW]', JSON.stringify({stage: 'game_3d_first_frame', detail: {transition_total_ms: 1500}}));
      if (!has(s.out, /点击进3D：总计 1500ms \| 下载剩余WASM\(5\.60MB\) 700ms \| 编译实例化 300ms \| 场景加载到首帧 500ms/)) throw Error(s.out.join(' / '));
    }],
    ['进场景失败写进汇总', () => {
      const s = load(src, {primaryBr: 3e6, code1Br: 3e6, mode: 'onclick'});
      godotPrint(s, {event: 'click', scene: '3d'}); godotPrint(s, {event: 'transition_failed', scene: '3d', status: 'DOWNLOAD_FAILED_RETRYABLE'});
      if (!has(s.out, /进3D失败：DOWNLOAD_FAILED_RETRYABLE/)) throw Error(s.out.join(' / '));
    }],
  ];
  return cases.map(([name, fn]) => { try { fn(); return {name, ok: true}; } catch (e) { return {name, ok: false, error: e.message.slice(0, 400)}; } });
}

if (process.argv[1] && process.argv[1].endsWith('timing-tests.mjs')) {
  const src = fs.readFileSync(new URL('../assets/wxslim-timing.js', import.meta.url), 'utf8');
  for (const r of runTimingTests(src)) console.log(r.ok ? 'PASS' : 'FAIL', r.name, r.ok ? '' : r.error);
}
