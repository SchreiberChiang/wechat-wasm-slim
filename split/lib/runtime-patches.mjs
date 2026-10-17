// Patches for the official wasmsplit V2 runtime (wasm-split.js, verified template sha 53322659…).
// Order and text are identical to the device-verified stage12 chain (03 → 05 → 08 → 13), see PLAYBOOK.md.
// Every anchor must match exactly once, otherwise the patch fails loudly (runtime template changed).
import crypto from 'node:crypto';
export const OFFICIAL_RUNTIME_SHA256 = ['53322659add07a2ad67daf93fefc3792ff7b70803d10c70ba414c3d08b6e2e29'];
// 模板身份按“函数表大小归一化”后的 sha 核对：官方运行时第 2 行 `const tableSize = N` 随游戏 WASM 变化，
// 其余内容与已核对模板逐字节相同才放行（Star Tap 实测：只有这一行不同）。
export const OFFICIAL_RUNTIME_NORMALIZED_SHA256 = ['e259ae35bac8c397'];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
export const normalizeRuntime = s => s.replace(/const tableSize = \d+/,'const tableSize = N');
const T = 'GameGlobal.__WXSLIM_TIMING__&&GameGlobal.__WXSLIM_TIMING__.mark';

// report 为数组时是“只检查”模式（doctor 用）：锚点对不上不抛错，记下结果继续往下查；不传时与原来完全一样，第一处失败就抛错。
function patcher(src, report) {
  let s = src; const applied = [], inserted = [];
  // 锚点不在官方模板里、而是前面某处补丁插入的文本（本工具自己的代码）时，记下是哪一处。
  const origin = a => a == null ? undefined : inserted.find(x => x.next.includes(a) && !x.old.includes(a))?.label;
  const site =() => { for (const l of String(Error().stack).split('\n')) { const m = l.match(/at (\S+) .*runtime-patches\.mjs:(\d+):\d+/); const fn = m && m[1].split('.').pop(); if (m && !['one', 'range', 'fail', 'site'].includes(fn)) return {fn, line: Number(m[2])}; } return null; };
  const fail = (code, label, info = {}) => { if (!report) throw Error(code + ':' + label); report.push({label, ok: false, code, ...info, from: origin(info.anchor), site: site()}); };
  const one = (old, next, label) => {
    if (report) inserted.push({label, old: old ?? '', next});
    if (old == null) return fail('DEPENDS', label);
    const n = s.split(old).length - 1;
    if (n !== 1) { if (!report) throw Error(`ANCHOR_${n === 0 ? 'MISSING' : 'NOT_UNIQUE'}:${label}`); report.push({label, ok: false, code: n === 0 ? 'ANCHOR_MISSING' : 'ANCHOR_NOT_UNIQUE', count: n, anchor: old, text: s, from: origin(old), site: site()}); return; }
    s = s.replace(old, next); applied.push(label); report?.push({label, ok: true});
  };
  const range = (startText, endText, label) => { const a = s.indexOf(startText), b = s.indexOf(endText, a); if (a < 0 || b < a) { fail('RANGE', label, {anchor: a < 0 ? startText : endText, text: s}); return null; } return s.slice(a, b); };
  return { one, range, fail, get text() { return s; }, applied };
}

/** Click-to-download gate (code1 only after the game's request), no code2, explicit miss error. */
export function clickGate(p, core) {
  p.one('var v,I=null;', 'var v,I=null;' + core, 'owned_gate_core');
  p.one('function F(e,a){', 'function F(e,a){if(!__WXSLIM_CLICK__.ownsDownload(e))throw Error("WXSLIM_CLICK_DOWNLOAD_NOT_OWNED");', 'F_owned_only');
  p.one('fail(e){l("load "+c.wasmcode1Name+" fail:",e);', 'fail(e){__WXSLIM_CLICK__.downloadFailed();l("load "+c.wasmcode1Name+" fail:",e);', 'F_terminal_failure_cleanup');
  p.one('v=function(e){r("start compileSubWasm: needBlock ",e);', 'v=function(e){__WXSLIM_CLICK__.beginI();r("start compileSubWasm: needBlock ",e);', 'I_owned_start');
  p.one('c.subWasmInstantiated=!0,c.canAwaitLoad', 'c.subWasmInstantiated=!0,__WXSLIM_CLICK__.successI(),c.canAwaitLoad', 'I_real_success');
  p.one('.then(n).catch(e=>{console.error(c.wasmcode1Name+" catch ",e)})', '.then(n).catch(e=>{__WXSLIM_CLICK__.failedI();console.error(c.wasmcode1Name+" catch ",e)})', 'I_real_failure');
  p.one(p.range('e.wasm_split.wait=function(){', ',e.wasm_split.logCall=', 'wait'), 'e.wasm_split.wait=function(){return __WXSLIM_CLICK__.wait()}', 'synchronous_void_wait');
  p.one('setTimeout(A,c.kDelayLoadWasmcode2Time)', 'void 0', 'disable_HP_archive_timer');
  p.one('function A(){', 'function A(){throw Error("WXSLIM_CODE2_DISABLED_IN_ORDINARY_ROUTE");', 'code2_unreachable_assert');
  p.one('if(Object.entries(n.instance.exports)', 'Object.entries(n.instance.exports)', 'primary_receive_expression');
  p.one(p.range(',WXGameKit.lifeCycle.on(WXGameKit.lifeCycle.event.InstantiateWasm,', '}),{}},GameGlobal.compileSubWasm=', 'tail'), ',__WXSLIM_CLICK__.bind(),a(n.instance,n.module)', 'primary_immediate_receive_no_HP_private_or_preload');
  const c0 = p.text.indexOf('GameGlobal.compileSubWasm=function()');
  if (c0 < 0) p.fail('RANGE', 'compile', {anchor: 'GameGlobal.compileSubWasm=function()', text: p.text});
  else p.one(p.text.slice(c0), 'GameGlobal.compileSubWasm=function(){return __WXSLIM_CLICK__.compile()};', 'compile_no_fake_ready');
  const m = p.text.match(/function publish\(\)\{try\{GameGlobal\.__WXSLIM_CLICK_DIAGNOSTIC__=\{[^}]*\};\}catch\(_\)\{\}\}/g);
  if (m?.length !== 1) p.fail('ANCHOR', 'publish', {count: m?.length || 0, anchor: 'function publish(){try{GameGlobal.__WXSLIM_CLICK_DIAGNOSTIC__={', text: p.text});
  else p.one(m[0], m[0].replace(';}catch', ';if(typeof wx.setStorageSync==="function")wx.setStorageSync("WXSLIM_CLICK_DIAGNOSTIC",GameGlobal.__WXSLIM_CLICK_DIAGNOSTIC__);console.log("[WXSLIM_CLICK]",JSON.stringify(GameGlobal.__WXSLIM_CLICK_DIAGNOSTIC__));}catch'), 'bounded_diagnostic');
}

/** Timing marks consumed by assets/wxslim-timing.js. */
export function timingMarks(p) {
  p.one('r("CallMain区间耗时",a.data.costTimeMs)', `(${T}("callmain_ms",a.data.costTimeMs),r("CallMain区间耗时",a.data.costTimeMs))`, 'mark_callmain');
  p.one(',__WXSLIM_CLICK__.bind(),', `,__WXSLIM_CLICK__.bind(),${T}("primary_wasm_ready"),`, 'mark_primary_ready');
  p.one("function request(){bump('requests');var current=status();", `function request(){bump('requests');var current=status();${T}("click_request",current==='READY');`, 'mark_click');
  p.one("function onDownloaded(){if(state!=='PENDING'||!attempt||attempt.phase!=='DOWNLOAD')return;", `function onDownloaded(){if(state!=='PENDING'||!attempt||attempt.phase!=='DOWNLOAD')return;${T}("code1_downloaded");`, 'mark_downloaded');
  p.one("receipt=snap();state='READY';publish();", `receipt=snap();state='READY';${T}("code1_ready");publish();`, 'mark_ready');
}

/** Primary-miss fallback (Android canAwaitLoad) + non-waiter click download (waiterMode tasks never complete without await()). */
export function fallbackAndWaiterFix(p) {
  p.one("var counts={requests:0,", "var counts={fallbacks:0,requests:0,", 'fb_count');
  p.one("blockedWarmups:counts.blockedWarmups};", "blockedWarmups:counts.blockedWarmups,fallbacks:counts.fallbacks};", 'fb_publish');
  p.one("ownsDownload:function(callback){return state==='PENDING'&&attempt&&attempt.phase==='DOWNLOAD'&&callback===onDownloaded;}",
    "ownsDownload:function(callback){return state==='PENDING'&&!!attempt&&(attempt.phase==='DOWNLOAD'&&callback===onDownloaded||attempt.phase==='FALLBACK'&&callback===I);}", 'fb_owns');
  p.one("beginI:function(){if(", "beginI:function(){if(state==='PENDING'&&attempt&&attempt.phase==='FALLBACK'){attempt.started=true;bump('instantiations');publish();return;}if(", 'fb_beginI');
  p.one("successI:function(){if(", "successI:function(){if(state==='READY')return;if(", 'fb_successI');
  p.one("failedI:function(){fail(", "failedI:function(){if(state==='READY')return;fail(", 'fb_failedI');
  p.one("wait:function(){if(status()==='READY')return;bump('coverageFailures');",
    "wait:function(){if(status()==='READY')return;" +
    "if(c.canAwaitLoad&&(state==='PENDING'||state==='IDLE')&&valid()){var t0=Date.now(),clicked=state==='PENDING',fn=GameGlobal.waitTableId&&GameGlobal.waitTableId.value;" +
    "if(state==='IDLE'){attempt={phase:'FALLBACK',snapshot:snap(),started:false};state='PENDING';bump('downloads');}else attempt.phase='FALLBACK';bump('fallbacks');publish();" +
    "var inflight=!!c.loadSubWasmTask&&!c.loadSubWasmDone;try{if(inflight){var wt=wx.loadSubpackage({name:c.wasmcode1Name,waiterMode:!0,success:function(){},fail:function(){}});wt.await();c.loadSubWasmDone=!0;}D(!0);}catch(e){fail('FALLBACK_FAILED_RESTART_REQUIRED');throw e;}" +
    "if(status()!=='READY'){fail('FALLBACK_NOT_READY_RESTART_REQUIRED');throw Error('WXSLIM_FALLBACK_NOT_READY');}" +
    `console.log('[WXSLIM_FALLBACK]',JSON.stringify({clicked:clicked,inflight:inflight,ms:Date.now()-t0,func:fn}));${T}('fallback',{clicked:clicked,ms:Date.now()-t0,func:fn});return;}` +
    "bump('coverageFailures');", 'fb_wait');
  p.one("try{F(onDownloaded,false);}catch(_){downloadFailed();}return st",
    "var awaitable=c.canAwaitLoad;c.canAwaitLoad=!1;try{F(onDownloaded,false);}catch(_){downloadFailed();}finally{c.canAwaitLoad=awaitable;}return st", 'android_non_waiter_click_download');
}

/** Every primary miss that ends in an explicit error also logs the table slot (error level → uploaded). */
export function missLogging(p) {
  p.one("bump('coverageFailures');fail('PRIMARY_COVERAGE_MISS_RESTART_REQUIRED');",
    "bump('coverageFailures');try{console.error('[WXSLIM_PRIMARY_MISS]',JSON.stringify({func:GameGlobal.waitTableId&&GameGlobal.waitTableId.value,state:state}));}catch(_){}fail('PRIMARY_COVERAGE_MISS_RESTART_REQUIRED');", 'miss_log');
  p.one("catch(e){fail('FALLBACK_FAILED_RESTART_REQUIRED');throw e;}",
    "catch(e){try{console.error('[WXSLIM_FALLBACK_FAILED]',JSON.stringify({func:fn,inflight:inflight,error:String(e&&e.message||e)}));}catch(_){}fail('FALLBACK_FAILED_RESTART_REQUIRED');throw e;}", 'fallback_fail_log');
}

/** measured mode: primary already holds every measured function (2D and heavy scene). The game's request
 * is answered READY without downloading; code1 is only fetched by the miss fallback (Android) if shipped. */
export function measuredMode(p) {
  p.one("if(current==='PENDING')return current;if(current!=='IDLE'&&current!=='DOWNLOAD_FAILED_RETRYABLE')return current;",
    "if(current==='PENDING')return current;if(current==='IDLE'&&valid()){state='PRIMARY_ONLY';publish();return state;}if(current!=='IDLE'&&current!=='DOWNLOAD_FAILED_RETRYABLE')return current;", 'measured_request');
  p.one("GameGlobal.__WXSLIM_CLICK_GATE__=Object.freeze({request:function(){return __WXSLIM_CLICK__.request();},status:function(){return __WXSLIM_CLICK__.status();}",
    "GameGlobal.__WXSLIM_CLICK_GATE__=Object.freeze({request:function(){var s=__WXSLIM_CLICK__.request();return s==='PRIMARY_ONLY'?'READY':s;},status:function(){var s=__WXSLIM_CLICK__.status();return s==='PRIMARY_ONLY'?'READY':s;}", 'measured_gate_api');
  p.one("if(c.canAwaitLoad&&(state==='PENDING'||state==='IDLE')&&valid()){", "if(c.canAwaitLoad&&(state==='PENDING'||state==='IDLE'||state==='PRIMARY_ONLY')&&valid()){", 'measured_fallback_state');
  p.one("if(state==='IDLE'){attempt={phase:'FALLBACK'", "if(state==='IDLE'||state==='PRIMARY_ONLY'){attempt={phase:'FALLBACK'", 'measured_fallback_attempt');
}

/**
 * 采集包：不能同步等待余包的设备（canAwaitLoad=false，例如 iPhone 高性能模式、开发者工具）先把 wasmcode1
 * 下载、实例化好，再进入 main。官方运行时在这类设备上如果有 wx.createSignal 或 H5 渲染器，会直接进 main，
 * 指望缺函数时用 signal 同步等；第一轮采集首包很小，启动阶段就会调用余包函数，iPhone 上抛 unhandledRejection、
 * 卡在“编译中”（Star Tap 实测）。这里改成走官方自己的“无 signal”分支，并用异步等待（D(!1) + 轮询），不阻塞线程。
 * 能同步等待的设备（新版安卓）保持官方原路径。只用于采集包，正式包不受影响。
 */
function collectionPreload(p) {
  p.one('GameGlobal.canUseH5Renderer||c.canAwaitLoad||null!=G(!0)){let e="android&wasm3"', 'c.canAwaitLoad){let e="android&wasm3"', 'collect_preload_code1_when_cannot_await');
  p.one('else r("no signal api, start instantiate sub wasm"),D(!0),_(()=>a(n.instance,n.module))',
    'else console.log("[WXSLIM_COLLECT] preload code1 before main (canAwaitLoad=false)"),r("no signal api, start instantiate sub wasm"),D(!1),_(()=>(console.log("[WXSLIM_COLLECT] code1 ready, enter main"),a(n.instance,n.module)))', 'collect_async_wait_code1_before_main');
}

/** 运行时模板身份：原始 sha 或“函数表大小归一化”后的 sha 是否在已核对列表里。 */
export function runtimeTemplate(src) {
  const before = sha(src), normalized = sha(normalizeRuntime(src));
  return {sha256: before, normalizedSha256: normalized, known: OFFICIAL_RUNTIME_SHA256.includes(before) || OFFICIAL_RUNTIME_NORMALIZED_SHA256.some(x => normalized.startsWith(x))};
}

function applyChain(p, {mode, core, measured}) {
  if (mode === 'release') { clickGate(p, core); timingMarks(p); fallbackAndWaiterFix(p); missLogging(p); if (measured) measuredMode(p); }
  else { p.one('r("CallMain区间耗时",a.data.costTimeMs)', `(${T}("callmain_ms",a.data.costTimeMs),r("CallMain区间耗时",a.data.costTimeMs))`, 'mark_callmain'); collectionPreload(p); }
}

/** Release runtime: click gate + marks + fallback + waiter fix (+ measured mode). Profile runtime: callMain mark only. */
export function patchRuntime(src, { mode, core, measured = false, allowUnknownTemplate = false }) {
  const t = runtimeTemplate(src);
  if (!allowUnknownTemplate && !t.known) throw Error('UNKNOWN_OFFICIAL_RUNTIME_TEMPLATE:' + t.sha256 + ' (re-verify anchors, then pass --allow-unknown-runtime)');
  const p = patcher(src);
  applyChain(p, {mode, core, measured});
  return { text: p.text, applied: p.applied, beforeSha256: t.sha256, afterSha256: sha(p.text) };
}

/** 只检查、不改文件（doctor 用）：按 patchRuntime 的顺序逐处核对锚点，失败不中断。
 * 返回 {template, results[{label, ok, code, count, anchor, text, site:{fn,line}}], text}；全部通过时 text 与 patchRuntime 的结果相同。 */
export function checkRuntimeAnchors(src, { mode, core, measured = false }) {
  const results = [], p = patcher(src, results);
  applyChain(p, {mode, core, measured});
  return { template: runtimeTemplate(src), results, text: p.text };
}
