// 输入检查：Godot 4 Web 导出（godot.js + godot.wasm + .pck，可选 .js.symbols）是否能交给 convert。
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';

export const sha = b => crypto.createHash('sha256').update(b).digest('hex');
export const md5 = b => crypto.createHash('md5').update(b).digest('hex');
// Emscripten 模块定义结束、Godot 的 Engine 包装开始的位置；桥接代码接在这之前。
export const MODULE_TAIL = "\nif (typeof exports === 'object' && typeof module === 'object') {";
// citizenll/godot 微信分支在 JS 胶水里的运行时约定（启动桥依赖这些名字）。
const WX_MARKERS = ['GODOTSDK', '__godotMinigameWXGLXEnabled', '__GODOT_DISABLE_WXGLX', 'wx.getFileSystemManager', 'GameGlobal'];
const GODOT_EXPORTS = ['initConfig', 'initFS', 'copyToFS', 'callMain'];

/** 从导出目录和显式参数里找出 js / wasm / pck / symbols。 */
export function locateInputs({exportDir, js, wasm, pck, symbols}) {
  const r = {js, wasm, pck, symbols};
  if (exportDir) {
    const files = fs.readdirSync(exportDir).map(f => path.join(exportDir, f)).filter(f => fs.statSync(f).isFile());
    const pick = (list, what) => { if (list.length !== 1) throw Error(`导出目录里${what}有 ${list.length} 个，请用参数明确指定：` + list.map(f => path.basename(f)).join('、')); return list[0]; };
    r.js ??= pick(files.filter(f => f.endsWith('.js') && !/\.(worklet|service\.worker|audio\.position\.worklet)\.js$/.test(f) && fs.readFileSync(f, 'utf8').includes('var Godot = ')), 'Godot 引擎 JS（含 var Godot =）');
    const stem = path.basename(r.js, '.js');
    r.wasm ??= fs.existsSync(path.join(exportDir, stem + '.wasm')) ? path.join(exportDir, stem + '.wasm') : pick(files.filter(f => f.endsWith('.wasm')), '.wasm');
    r.pck ??= pick(files.filter(f => f.endsWith('.pck')), '.pck');
    r.symbols ??= [r.js + '.symbols', path.join(exportDir, stem + '.js.symbols')].find(f => fs.existsSync(f));
  }
  for (const k of ['js', 'wasm', 'pck']) if (!r[k]) throw Error(`缺少输入 ${k}：用 --export <导出目录>，或 --${k} <文件>`);
  for (const k of Object.keys(r)) if (r[k]) { r[k] = path.resolve(r[k]); if (!fs.statSync(r[k]).isFile()) throw Error('不是文件：' + r[k]); }
  return r;
}

/** 返回 {ok, facts, problems[], warnings[]}。problems 非空时不能转换。 */
export function checkInputs(inp) {
  const problems = [], warnings = [], facts = {};
  const js = fs.readFileSync(inp.js, 'utf8');
  facts.jsBytes = Buffer.byteLength(js);
  if (!js.includes('var Godot = ')) problems.push('JS 里找不到 “var Godot = ”：不是 Godot 4 Web 导出的引擎 JS。');
  const tail = js.lastIndexOf(MODULE_TAIL);
  if (tail < 0 || !js.slice(tail).includes('module.exports = Godot;')) problems.push('JS 末尾找不到 Emscripten 的 module.exports = Godot 段：可能被压缩或改过，无法接入启动桥。');
  for (const n of GODOT_EXPORTS) if (!js.includes(n)) problems.push('JS 缺少 Godot 运行时接口 ' + n + '。');
  const missing = WX_MARKERS.filter(m => !js.includes(m));
  facts.wechatRuntime = missing.length === 0;
  if (missing.length) problems.push('引擎不是 citizenll/godot 微信分支编译的（JS 缺少微信运行时约定：' + missing.join('、') + '）。官方 Godot 模板不能直接用，要用微信分支自编译的 Web 模板。');
  facts.needsNowPolyfill = /=\s*nowPolyfill\b/.test(js); // 新版微信分支引擎依赖全局 nowPolyfill，启动桥会补上
  if (/\bPThread\b/.test(js)) problems.push('引擎是多线程版（含 PThread）。小游戏只能用 threads=no 的单线程模板。');
  if (js.includes('WXGameKit') || js.includes('__WX15_GODOT_BRIDGE__')) problems.push('JS 已经被转换或接过启动桥了。请用 Godot 原始导出的 JS。');
  const wasm = fs.readFileSync(inp.wasm);
  facts.wasmBytes = wasm.length; facts.wasmMd5 = md5(wasm); facts.wasmSha256 = sha(wasm);
  if (wasm.readUInt32LE(0) !== 0x6d736100 || wasm.readUInt32LE(4) !== 1) problems.push('.wasm 文件头不对（不是 WebAssembly 1.0）。');
  const pck = fs.readFileSync(inp.pck);
  facts.pckBytes = pck.length; facts.pckSha256 = sha(pck);
  if (pck.subarray(0, 4).toString('latin1') !== 'GDPC') problems.push('.pck 文件头不是 GDPC（如果导出时把 PCK 嵌进了别的文件，请改成单独导出 .pck）。');
  else {
    facts.pckFormat = pck.readUInt32LE(4); facts.godotVersion = [8, 12, 16].map(o => pck.readUInt32LE(o)).join('.');
    if (!facts.godotVersion.startsWith('4.')) problems.push('PCK 不是 Godot 4 导出的（版本 ' + facts.godotVersion + '）。');
    else if (facts.godotVersion !== '4.7.2') warnings.push('PCK 来自 Godot ' + facts.godotVersion + '；本工具只在 4.7.2 上验证过，导出用的编辑器版本要和引擎模板一致。');
  }
  if (inp.symbols) {
    const head = fs.readFileSync(inp.symbols, 'utf8').slice(0, 200);
    if (!/^\d+:\S/.test(head)) problems.push('符号表格式不对（应为 Emscripten --emit-symbol-map 的 “编号:函数名” 行）。');
    facts.symbols = true;
    // 覆盖完整 ≠ 名称可读：名称是纯数字时分包照样能做，只是缺函数时查不出 C++ 函数名。只警告，不要求重编。
    const names = fs.readFileSync(inp.symbols, 'utf8').split('\n').filter(Boolean).map(l => l.slice(l.indexOf(':') + 1));
    facts.symbolCount = names.length; facts.readableSymbolRatio = names.length ? names.filter(n => /[A-Za-z_]/.test(n)).length / names.length : 0;
    if (facts.readableSymbolRatio < 0.5) warnings.push(`符号表覆盖 ${names.length} 个函数，但只有 ${(facts.readableSymbolRatio * 100).toFixed(0)}% 的名称可读（其余是编号）。分包不受影响；缺函数时查不出 C++ 名称。这不是重编的理由。`);
  } else { facts.symbols = false; warnings.push('没有符号表（.js.symbols）。可以转换和运行，但 split 分包的 init/lookup 需要它：编译引擎模板时加 linkflags=--emit-symbol-map（trim build 默认会带）。'); }
  return {ok: problems.length === 0, facts, problems, warnings};
}
