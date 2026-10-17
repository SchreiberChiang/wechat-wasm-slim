// Offline tests of the patched runtime with realistic WeChat semantics:
// a waiterMode subpackage task completes only via await(); a normal task completes when the platform fires it.
import vm from 'node:vm';
export function runWaiterTests(src) {
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); if (i < 0 || j < i) throw Error('CUT ' + a); return src.slice(i, j); };
  const block = a => { const i = src.indexOf(a); let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } };
  const core = cut('/* WXSLIM_CLICK_OWNED_CORE_BEGIN', '/* WXSLIM_CLICK_OWNED_CORE_END */'), F = cut('function F(e,a){', 'function _(e){'), D = block('function D(e){'), V = cut('(v=function(e){', '&&(I=v)');
  function env(canAwait, missingCode1 = false) {
    const log = [], tasks = [];
    const ctx = {console: {log() {}, info() {}, error(...a) { log.push('error:' + String(a[0])); }}, Date, setTimeout() {}, Promise, Error, JSON, Math,
      wx: {setStorageSync() {}, createSignal: () => null, loadSubpackage(o) { if (missingCode1) { log.push('load:missing'); const t = {o, waiter: !!o.waiterMode, await() { o.fail && o.fail({errMsg: 'not found'}); throw Error('subpackage not found'); }, complete() { o.fail && o.fail({errMsg: 'not found'}); }, onProgressUpdate() {}}; tasks.push(t); return t; } const t = {o, waiter: !!o.waiterMode, done: false, complete() { if (!this.done) { this.done = true; o.success && o.success(); } }, await() { if (!this.waiter) throw Error('await on non-waiter'); this.complete(); }, onProgressUpdate() {}}; tasks.push(t); log.push('load:' + (t.waiter ? 'waiter' : 'normal')); return t; }},
      WXWebAssembly: {Instance: function () { log.push('syncInstance'); }, instantiate() { log.push('asyncInstantiate'); return {then(n) { ctx.__asyncN = n; return {catch() {}}; }}; }},
      window: {wasm_split_info: {primary: {table: {length: 10}, memory: {buffer: {byteLength: 1}}, 'global$0': {}, 'global$1': {}, 'global$2': {}, 'global$3': {}}}}};
    ctx.GameGlobal = ctx; ctx.CODE_FILE_MD5 = 'x'; ctx.wasm_split_info = ctx.window.wasm_split_info; vm.createContext(ctx);
    vm.runInContext(`var tableSize=1;var mod={};function m(){return mod;}function h(){return 5;}function r(){}function l(){}function w(){return {};}function G(){return null;}
 var c={canAwaitLoad:${canAwait},loadSubWasmCallbacks:[],loadSubWasmTask:void 0,loadSubWasmDone:!1,subWasmInstantiating:!1,subWasmInstantiated:!1,wasmcode1Name:'wasmcode1',wasmcode1Path:'wasmcode1/'};
 var v,I=null;${core}\n${F}\n${D}\n${V}&&(I=v);__WXSLIM_CLICK__.bind();globalThis.T={core:__WXSLIM_CLICK__,gate:GameGlobal.__WXSLIM_CLICK_GATE__};`, ctx);
    return {...ctx.T, ctx, log, platformTick() { tasks.filter(t => !t.waiter).forEach(t => t.complete()); }};
  }
  const eq = (a, b, m) => { if (a !== b) throw Error(m + ': ' + a); };
  const measured = src.includes("state='PRIMARY_ONLY'");
  const cases = measured ? [
    ['实测模式：点击直接 READY，不下载', () => { const e = env(true); eq(e.gate.request(), 'READY', 'req'); eq(e.gate.status(), 'READY', 'status'); if (e.log.some(x => x.startsWith('load:'))) throw Error('downloaded'); }],
    ['实测模式安卓缺函数 → 兜底拉取次包', () => { const e = env(true); e.gate.request(); e.core.wait(); eq(e.gate.status(), 'READY', 's'); if (!e.log.includes('syncInstance')) throw Error('no instance'); }],
    ['实测模式 iOS 缺函数 → 报错并记录函数', () => { const e = env(false); e.gate.request(); let threw = false; try { e.core.wait(); } catch (x) { threw = true; } if (!threw || !e.log.some(x => x.startsWith('error:[WXSLIM_PRIMARY_MISS]'))) throw Error('no logged error'); }],
    ['去掉次包后安卓缺函数 → 明确失败并记录', () => { const e = env(true, true); e.gate.request(); let threw = false; try { e.core.wait(); } catch (x) { threw = true; } if (!threw || !e.log.some(x => x.startsWith('error:[WXSLIM_FALLBACK_FAILED]'))) throw Error('no logged failure'); }],
  ] : [
    ['安卓点击后异步下载完成，不冻结', () => { const e = env(true); e.gate.request(); e.platformTick(); e.ctx.__asyncN && e.ctx.__asyncN(); eq(e.gate.status(), 'READY', 'stuck'); if (e.log.includes('syncInstance')) throw Error('froze'); }],
    ['安卓下载中缺函数 → 等待模式下载 + 同步实例化', () => { const e = env(true); e.gate.request(); e.core.wait(); eq(e.gate.status(), 'READY', 's'); e.platformTick(); eq(e.gate.status(), 'READY', 'late'); }],
    ['安卓下载完、异步实例化中缺函数', () => { const e = env(true); e.gate.request(); e.platformTick(); e.core.wait(); eq(e.gate.status(), 'READY', 's'); e.ctx.__asyncN && e.ctx.__asyncN(); eq(e.gate.status(), 'READY', 'late'); }],
    ['安卓点击前缺函数 → 官方同步路径', () => { const e = env(true); e.core.wait(); eq(e.gate.status(), 'READY', 's'); eq(e.gate.request(), 'READY', 'reuse'); }],
    ['iOS 点击后正常', () => { const e = env(false); e.gate.request(); e.platformTick(); e.ctx.__asyncN(); eq(e.gate.status(), 'READY', 's'); }],
    ['iOS 缺函数保持明确报错', () => { const e = env(false); e.gate.request(); let threw = false; try { e.core.wait(); } catch (x) { threw = /WXSLIM_PRIMARY_COVERAGE_MISS/.test(x.message); } if (!threw) throw Error('no explicit error'); }],
  ];
  return cases.map(([name, fn]) => { try { fn(); return {name, ok: true}; } catch (e) { return {name, ok: false, error: e.message}; } });
}
