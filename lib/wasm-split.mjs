// WASM 分包（微信官方 wasmsplit-v2-ci 2.1.5）。把 2026-11-08 在测试游戏上手工跑通的步骤做成两个动作：
//   collect：复制这次运行打开的小游戏工程到 RUN/wasmsplit/minigame，放符号表，调用官方 init（上传引擎、云端预处理、
//            装上采集版运行时），再修好我们自己的结构并给 iPhone 打采集补丁。之后用手机打开采集包把游戏玩一遍。
//   release：读采集到的函数数，备份采集包到 RUN/wasmsplit/collect，调用官方 dosplit --release，再修好结构。
// 官方工具改动的只是工程副本；原转换结果和电脑预览包都不动。
//
// 我们要替官方工具处理的四件事（都在 docs/evidence/WASM_SPLIT_2D_20261108.json 里实测过）：
//   1. 符号表：官方要 game.symbols.json（{ "函数编号": "函数名" }）。保守、2D 引擎随附 Emscripten 的「编号:函数名」符号表；
//      完整模板的引擎没有，就按 wasm 里的函数总数生成占位名（f0、f1…）。符号表只给官方工具用，加进 packOptions.ignore 不打包。
//   2. 入口：电脑预览包的 game.js 是分流器（电脑走 start-devtools.js，真机走 start-device.js），官方工具找不到锚点
//      `import commFrameWork from "./framework"`。所以调用前临时把真机入口放进 game.js，调用后把注入后的内容写回
//      start-device.js，按同样方式给 start-devtools.js 加上两行，再恢复分流器。
//   3. 采集补丁：采集版首包很小，iPhone 高性能模式不能同步等余包，启动就卡死。采集版运行时改走「先异步加载余包再进游戏」。
//   4. 电脑配置：官方只改 wx-game-kit/config.json 的 launch.code，config.devtools.json 同步成一样。
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export const WASM_SPLIT_DIR = 'wasmsplit';
export const WASM_SPLIT_STATE = 'STATE.json';
const FRAMEWORK_IMPORTS = ['import commFrameWork from "./framework";', "import commFrameWork from './framework';"];
const DEVTOOLS_IMPORT = 'import commFrameWork from "./framework-devtools";';
const SPLIT_IMPORT = "import './wasm-split.js';";
const INSTANTIATE_LINE = 'GameGlobal.WXGameKit.gameInstance.Module["instantiateWasm"] = GameGlobal.instantiateWasm;';

const fail = (code, message, extra = {}) => { throw Object.assign(Error(message), {code, ...extra}); };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

// ---------- 1. 符号表 ----------
/** Emscripten --emit-symbol-map 的「编号:函数名」文本 → 官方要的 { "编号": "函数名" }。 */
export function symbolsFromMap(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0 && /^\d+$/.test(line.slice(0, i))) out[line.slice(0, i)] = line.slice(i + 1);
  }
  if (!Object.keys(out).length) fail('WASM_SPLIT_SYMBOLS_EMPTY', '引擎符号表是空的');
  return out;
}

/** 没有符号表的引擎：数出 wasm 里导入函数加自身函数的总数，按编号生成占位名。 */
export function placeholderSymbols(wasm) {
  if (!Buffer.isBuffer(wasm) || wasm.readUInt32LE(0) !== 0x6d736100) fail('WASM_SPLIT_NOT_WASM', '不是 wasm 文件');
  let p = 8, imports = 0, functions = 0;
  const leb = () => { let r = 0, s = 0, b; do { b = wasm[p++]; r += (b & 127) * 2 ** s; s += 7; } while (b & 128); return r; };
  const skipLimits = () => { const f = wasm[p++]; leb(); if (f & 1) leb(); };
  while (p < wasm.length) {
    const id = wasm[p++], length = leb(), start = p;
    if (id === 2) {
      for (let n = leb(); n > 0; n--) {
        let skip = leb(); p += skip; skip = leb(); p += skip;
        const kind = wasm[p++];
        if (kind === 0) { leb(); imports++; }
        else if (kind === 1) { p++; skipLimits(); }
        else if (kind === 2) skipLimits();
        else if (kind === 3) p += 2;
        else if (kind === 4) { p++; leb(); }
        else fail('WASM_SPLIT_NOT_WASM', '读不懂 wasm 的导入段');
      }
    } else if (id === 3) { functions = leb(); }
    p = start + length;
  }
  const total = imports + functions;
  if (!total) fail('WASM_SPLIT_NOT_WASM', 'wasm 里没有函数');
  return Object.fromEntries(Array.from({length: total}, (_, i) => [String(i), 'f' + i]));
}

// ---------- 2. 入口 ----------
export function hasFrameworkAnchor(text) { return FRAMEWORK_IMPORTS.some(a => text.includes(a)); }

/** 给电脑入口加上官方注入的两行（官方只会改它找得到锚点的那个文件）。已经加过就原样返回。 */
export function injectDevtoolsEntry(text) {
  if (text.includes(SPLIT_IMPORT)) return text;
  if (text.split(DEVTOOLS_IMPORT).length !== 2) fail('WASM_SPLIT_ENTRY_ANCHOR', 'start-devtools.js 里找不到引擎入口');
  return text.replace(DEVTOOLS_IMPORT, () => SPLIT_IMPORT + '\n' + DEVTOOLS_IMPORT + '\n\n' + INSTANTIATE_LINE);
}

/** 官方工具调用前：分流器 game.js 暂时换成真机入口。返回恢复用的记录；不是分流器时返回 null。 */
export function prepareEntryForTool(minigame) {
  const game = path.join(minigame, 'game.js'), device = path.join(minigame, 'start-device.js');
  const router = fs.readFileSync(game, 'utf8');
  if (hasFrameworkAnchor(router) || router.includes(SPLIT_IMPORT)) return null;
  if (!fs.existsSync(device)) fail('WASM_SPLIT_ENTRY_ANCHOR', 'game.js 里找不到引擎入口，也没有 start-device.js');
  fs.writeFileSync(game, fs.readFileSync(device, 'utf8'));
  return {router};
}

/** 官方工具调用后：注入后的入口写回 start-device.js，电脑入口加同样两行，恢复分流器。 */
export function restoreEntryAfterTool(minigame, saved) {
  if (!saved) return;
  const game = path.join(minigame, 'game.js');
  const injected = fs.readFileSync(game, 'utf8');
  if (!injected.includes(SPLIT_IMPORT)) fail('WASM_SPLIT_ENTRY_NOT_INJECTED', '官方工具没有在入口里装上分包运行时');
  fs.writeFileSync(path.join(minigame, 'start-device.js'), injected);
  const devtools = path.join(minigame, 'start-devtools.js');
  if (fs.existsSync(devtools)) fs.writeFileSync(devtools, injectDevtoolsEntry(fs.readFileSync(devtools, 'utf8')));
  fs.writeFileSync(game, saved.router);
}

// ---------- 3. 采集补丁 ----------
const COLLECT_PATCHES = [
  ['GameGlobal.canUseH5Renderer||c.canAwaitLoad||null!=G(!0)){let e="android&wasm3"', 'c.canAwaitLoad){let e="android&wasm3"'],
  ['else r("no signal api, start instantiate sub wasm"),D(!0),_(()=>a(n.instance,n.module))',
    'else console.log("[WXSLIM_COLLECT] preload code1 before main (canAwaitLoad=false)"),r("no signal api, start instantiate sub wasm"),D(!1),_(()=>(console.log("[WXSLIM_COLLECT] code1 ready, enter main"),a(n.instance,n.module)))'],
];
export const COLLECT_MARKER = '[WXSLIM_COLLECT]';

/** 采集版运行时：不能同步等余包的设备先异步加载余包再进游戏。锚点不是正好一处时直接报错（官方运行时换了写法）。 */
export function patchCollectionRuntime(text) {
  if (text.includes(COLLECT_MARKER)) return text;
  for (const [from, to] of COLLECT_PATCHES) {
    const n = text.split(from).length - 1;
    if (n !== 1) fail('WASM_SPLIT_RUNTIME_CHANGED', `官方分包运行时和已验证的版本不一样（锚点出现 ${n} 次），iPhone 采集补丁打不上`);
    text = text.replace(from, () => to);
  }
  return text;
}

// ---------- 4. 电脑配置 ----------
export function syncDevtoolsLaunchCode(minigame) {
  const kit = path.join(minigame, 'wx-game-kit'), main = readJson(path.join(kit, 'config.json'));
  const file = path.join(kit, 'config.devtools.json');
  if (!fs.existsSync(file)) return;
  const devtools = readJson(file);
  devtools.launch.code = main.launch.code;
  writeJson(file, devtools);
}

export function ignoreInPackage(minigame, name) {
  const file = path.join(minigame, 'project.config.json'), config = readJson(file);
  config.packOptions ??= {}; config.packOptions.ignore ??= [];
  if (!config.packOptions.ignore.some(x => x.value === name)) config.packOptions.ignore.push({type: 'file', value: name});
  writeJson(file, config);
}

/** 分包后各个 wasm 包的大小（压缩后字节）。 */
export function wasmParts(minigame) {
  return ['wasmcode', 'wasmcode1', 'wasmcode2'].flatMap(dir => {
    const d = path.join(minigame, dir);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(f => /\.wasm(\.br)?$/.test(f)).map(f => ({part: dir, bytes: fs.statSync(path.join(d, f)).size}));
  });
}

// ---------- 官方工具 ----------
/** 运行官方命令行，逐行回报输出；私钥路径只出现在参数里，不写进结果。 */
export function runOfficialCli({node, cli, args, cwd, onLine = () => {}}) {
  return new Promise((resolve) => {
    const child = spawn(node, [cli, ...args], {cwd, windowsHide: true});
    let tail = '';
    const take = chunk => { for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) { onLine(line.trim()); tail = (tail + '\n' + line).slice(-6000); } };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('close', code => resolve({code, tail}));
    child.on('error', error => resolve({code: -1, tail: String(error.message)}));
  });
}

/** 官方工具的报错 → 能看懂的原因。 */
export function explainCliFailure(tail) {
  if (/-10000401|no privileges/.test(tail)) return {code: 'WASM_SPLIT_AUTH', field: 'wasmsplitKey',
    message: '微信后台拒绝了这把密钥：请在小游戏管理后台「开发管理 → 研发工具箱 → 密钥管理 → Wasm 分包 CI 鉴权配置」上传它对应的公钥（不是「小程序代码上传密钥」）'};
  if (/ENOENT[^\n]*symbols/.test(tail)) return {code: 'WASM_SPLIT_SYMBOLS', message: '官方工具找不到符号表'};
  if (/4004|注入标记或锚点/.test(tail)) return {code: 'WASM_SPLIT_ENTRY_ANCHOR', message: '官方工具在入口文件里找不到要注入的位置'};
  if (/Collecting|收集态|getinfo/.test(tail) && /需处于|必须处于/.test(tail)) return {code: 'WASM_SPLIT_NOT_COLLECTING', message: '还没有采集包，请先点「生成采集包」并在手机上玩一遍'};
  const last = tail.split('\n').reverse().find(l => /✗|ERROR|失败|Error/.test(l)) || tail.split('\n').pop() || '';
  return {code: 'WASM_SPLIT_CLI_FAILED', message: '官方分包工具失败：' + last.replace(/^.*?(✗|\[ERROR\])\s*/, '').slice(0, 300)};
}
