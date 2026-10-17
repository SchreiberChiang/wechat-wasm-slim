#!/usr/bin/env node
// 版本适配体检：换 Godot / 微信分支 / emscripten / wx-transformer / wasmsplit-v2-ci / WXGameKit 任何一个时，
// 一条命令列出工具依赖的锚点和约定哪里对不上。只读：不改仓库、不改输入；要写的临时文件（git 临时索引、
// --run-transformer 的转换输出）都放系统临时目录，结束即删。用法见 docs/UPGRADING.md。
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import zlib from 'node:zlib';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {sha, md5, MODULE_TAIL, FRAMEWORK_ANCHORS, GAMEJS_ANCHORS, transformerConfig, checkEngineJs} from './convert/lib/inputs.mjs';
import {PLACEHOLDER_APPID} from './convert/lib/verify.mjs';
import {checkRuntimeAnchors, OFFICIAL_RUNTIME_NORMALIZED_SHA256} from './split/lib/runtime-patches.mjs';
import {runWaiterTests} from './split/lib/offline-tests.mjs';
import {COMMON_ARGS, RUNTIME_TOKENS, SOURCE_TESTS, DETECT_ANCHOR, EMSCRIPTEN_VERSION, buildEnv, capture} from './trim/lib/build.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
// 工具代码里没有强制、只在文档里写明“验证过”的版本。
const VERIFIED = {godot: '4.7.2', wasmsplit: '2.1.5'};
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const flag = k => argv.includes('--' + k);
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = p => !!p && fs.existsSync(p);
const short = (s, n = 70) => { s = String(s).replace(/\r?\n/g, '⏎'); return s.length > n ? s.slice(0, n) + '…' : s; };

if (flag('help') || flag('h')) {
  console.log(`用法：node doctor.mjs [选项]   （只读，见 docs/UPGRADING.md）
  --engine <目录>             新引擎（含 godot.js、godot.wasm，可选 godot.js.symbols），例如 trim 的 artifacts/
  --js / --wasm / --symbols   分别指定引擎文件（代替 --engine）
  --transformer <exe>         新的 wx-transformer（默认用 convert 工具链配置里的）
  --run-transformer           实跑转换器核对 framework.js / game.js 锚点（约 1 分钟，只写系统临时目录）
  --runtime <wasm-split.js>   官方 wasmsplit-v2-ci 生成的原始运行时（dosplit 产物里的，不要用打过补丁的）
  --split-cli <cli.js|目录>   wasmsplit-v2-ci 安装位置，用来读版本号
  --engine-source <目录>      新的引擎源码 git 仓库（默认用 trim 工具链配置里的 engineSource + pin）
  --convert-toolchain <json>  convert 工具链配置（默认 convert/convert.toolchain.private.json，没有就用示例）
  --trim-toolchain <json>     trim 工具链配置（默认 trim/trim.toolchain.private.json，没有就用示例）
  --json                      输出 JSON`);
  process.exit(0);
}

const rows = [];
const LABEL = {PASS: '通过', FAIL: '不通过', WARN: '注意', SKIP: '跳过'};
const row = (part, item, status, detail = '', extra = {}) => rows.push({part, item, status, detail, ...extra});
// 工具源码里某个锚点/约定定义在哪一行（给“去哪里改”用）。
function srcLine(rel, needle) { try { const i = fs.readFileSync(path.join(home, rel), 'utf8').split(/\r?\n/).findIndex(l => l.includes(needle)); return i >= 0 ? `${rel}:${i + 1}` : rel; } catch { return rel; } }
const lineCol = (text, i) => { const before = text.slice(0, i), line = before.split('\n').length; return `第 ${line} 行第 ${i - before.lastIndexOf('\n')} 列`; };
// 锚点找不到时：目标文件里最长能匹配到的前缀在哪、下一段应该是什么、实际是什么。
function nearest(text, anchor) {
  let lo = 0, hi = anchor.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (text.includes(anchor.slice(0, m))) lo = m; else hi = m - 1; }
  if (lo < Math.min(8, anchor.length / 2)) return '目标文件里连锚点开头都找不到（这段代码可能被整体重写或改名了）';
  const at = text.indexOf(anchor.slice(0, lo));
  return `只能匹配前 ${lo}/${anchor.length} 个字符（目标文件${lineCol(text, at)}）；接下来应为「${short(anchor.slice(lo), 40)}」，实际为「${short(text.slice(at + lo, at + lo + 40), 40)}」`;
}
function occurrences(text, anchor) { const r = []; for (let i = text.indexOf(anchor); i >= 0 && r.length < 5; i = text.indexOf(anchor, i + 1)) r.push(lineCol(text, i)); return r.join('、'); }
// 每处锚点必须唯一命中。返回 null 表示通过，否则返回失败说明。
function anchorProblem(text, anchor) { const n = text.split(anchor).length - 1; return n === 1 ? null : n === 0 ? '找不到：' + nearest(text, anchor) : `出现 ${n} 次（${occurrences(text, anchor)}），不唯一`; }

// 工具链配置的选取顺序与 convert.mjs / trim.mjs 相同：显式参数 > 同目录 *.private.json > 示例。
function loadToolchain(kind) {
  const dir = path.join(home, kind), explicit = opt(kind + '-toolchain'), priv = path.join(dir, `${kind}.toolchain.private.json`);
  const file = explicit ? path.resolve(explicit) : exists(priv) ? priv : path.join(dir, `${kind}.toolchain.json`);
  const t = readJson(file), base = path.dirname(file);
  if (kind === 'convert') t.transformer = path.resolve(base, t.transformer);
  else { for (const k of ['engineSource', 'emsdk', 'python']) t[k] = path.resolve(base, t[k]); t.patches = (t.patches || []).map(p => path.resolve(base, p)); }
  return {tc: t, file, example: !explicit && !exists(priv)};
}
// 路径不存在：用的是示例配置 → 跳过（还没配本机工具链）；用的是本机配置 → 不通过。
function missingPath(part, item, p, tcInfo, what) {
  if (tcInfo.example) row(part, item, 'SKIP', `${what}不存在（${p}）：用的是示例配置 ${path.relative(home, tcInfo.file)}，本机没有 *.toolchain.private.json，也没给 --${part}-toolchain`);
  else row(part, item, 'FAIL', `${what}不存在：${p}`, {where: tcInfo.file, fix: `改工具链配置里的路径`});
}

// ---------- 引擎输入 ----------
function locateEngine() {
  let {js, wasm, symbols} = {js: opt('js'), wasm: opt('wasm'), symbols: opt('symbols')};
  const dir = opt('engine');
  if (dir) {
    const files = fs.readdirSync(dir).map(f => path.join(dir, f)).filter(f => fs.statSync(f).isFile());
    js ??= files.find(f => f.endsWith('.js') && !/\.(worklet|service\.worker|audio\.position\.worklet)\.js$/.test(f) && fs.readFileSync(f, 'utf8').includes('var Godot = '));
    const stem = js && path.basename(js, '.js');
    wasm ??= stem && exists(path.join(dir, stem + '.wasm')) ? path.join(dir, stem + '.wasm') : files.find(f => f.endsWith('.wasm'));
    symbols ??= [js && js + '.symbols', path.join(dir, 'godot.js.symbols')].find(exists);
  }
  return js ? {js: path.resolve(js), wasm: wasm && path.resolve(wasm), symbols: symbols && path.resolve(symbols)} : null;
}

// ---------- convert ----------
async function checkConvert(engine) {
  const P = 'convert', tcInfo = loadToolchain('convert'), tc = tcInfo.tc;
  let js = null;
  if (!engine) row(P, '引擎 JS（Emscripten 模块结构、微信运行时约定）', 'SKIP', '没给 --engine 或 --js');
  else {
    js = fs.readFileSync(engine.js, 'utf8');
    const {problems, facts} = checkEngineJs(js);
    if (problems.length) for (const p of problems) row(P, '引擎 JS：convert check 同款检查', 'FAIL', p, {where: srcLine('convert/lib/inputs.mjs', 'export function checkEngineJs'), fix: '确认引擎是 citizenll 微信分支、threads=no 编出的原始 godot.js；约定名字确实改了的话，同步改 inputs.mjs 的 WX_MARKERS / GODOT_EXPORTS / MODULE_TAIL 和 assets/godot-bridge.js'});
    else row(P, '引擎 JS：convert check 同款检查', 'PASS', `var Godot、module.exports 段、${['initConfig', 'initFS', 'copyToFS', 'callMain'].join('/')}、微信运行时约定、单线程${facts.needsNowPolyfill ? '；引擎依赖全局 nowPolyfill（启动桥会补）' : ''}`);
    const tails = js.split(MODULE_TAIL).length - 1;
    row(P, '启动桥截断点（Emscripten 模块定义末尾）', tails === 1 ? 'PASS' : tails === 0 ? 'FAIL' : 'WARN', tails === 1 ? '唯一命中' : tails === 0 ? anchorProblem(js, MODULE_TAIL) : `出现 ${tails} 次，convert 取最后一处（${occurrences(js, MODULE_TAIL)}）`,
      tails === 1 ? {} : {where: srcLine('convert/lib/inputs.mjs', 'export const MODULE_TAIL'), fix: '找到新 JS 里“Emscripten 模块工厂结束、CommonJS 导出开始”的那一行，改 MODULE_TAIL'});
    // 启动桥（convert/assets/godot-bridge.js 末尾）接在截断点之前，直接引用工厂作用域里的这些名字。
    const at = js.lastIndexOf(MODULE_TAIL), head = at >= 0 ? js.slice(0, at) : js;
    const scope = [['var Module=', /\bvar Module\s*=/], ['readyPromiseResolve=', /\breadyPromiseResolve\s*=/], ['readyPromiseReject', /\breadyPromiseReject\b/], ['var Godot = ', /\bvar Godot = /], ['noInitialRun', /\bnoInitialRun\b/], ['onRuntimeInitialized', /\bonRuntimeInitialized\b/]];
    const miss = scope.filter(([, re]) => !re.test(head)).map(([n]) => n);
    row(P, '启动桥接入点要用到的作用域名字', miss.length ? 'FAIL' : 'PASS', miss.length ? '截断点之前找不到：' + miss.join('、') : scope.map(([n]) => n.replace(/[= ]+$/, '')).join('、'),
      miss.length ? {where: srcLine('convert/assets/godot-bridge.js', "typeof readyPromiseResolve==='function'"), fix: '新版 Emscripten 改了 MODULARIZE 工厂的写法：看新 godot.js 末尾工厂里 Module / ready promise 的新名字，改 godot-bridge.js 最后一段'} : {});
    // asset-gate.js 插在转换器产物的 createWasm 之前，直接调用 Emscripten 的运行依赖计数。
    const gate = [['function addRunDependency(', /function addRunDependency\(/], ['function removeRunDependency(', /function removeRunDependency\(/], ['runDependencies', /\bvar runDependencies\b/], ['function createWasm(', /function createWasm\(/]];
    const gm = gate.filter(([, re]) => !re.test(js)).map(([n]) => n);
    row(P, 'asset-gate 依赖的 Emscripten 运行依赖函数', gm.length ? 'FAIL' : 'PASS', gm.length ? '引擎 JS 里找不到：' + gm.join('、') : gate.map(([n]) => n.replace(/^function |\($/g, '')).join('、'),
      gm.length ? {where: 'convert/assets/asset-gate.js', fix: '新版 Emscripten 改了运行依赖的实现：按新名字改 asset-gate.js，并用 --run-transformer 核对 framework.js 锚点'} : {});
    if (engine.wasm) { const w = fs.readFileSync(engine.wasm); row(P, '引擎 WASM 文件头', w.readUInt32LE(0) === 0x6d736100 && w.readUInt32LE(4) === 1 ? 'PASS' : 'FAIL', `${(w.length / 1e6).toFixed(2)} MB`); }
    else row(P, '引擎 WASM 文件头', 'SKIP', '没找到 .wasm');
    if (engine.symbols) row(P, '符号表格式', /^\d+:\S/.test(fs.readFileSync(engine.symbols, 'utf8').slice(0, 200)) ? 'PASS' : 'FAIL', path.basename(engine.symbols));
    else row(P, '符号表格式', 'WARN', '没有 .js.symbols：split 的 init/lookup 需要它（编译时 linkflags=--emit-symbol-map）');
  }

  // wx-transformer 身份
  const exe = opt('transformer') ? path.resolve(opt('transformer')) : tc.transformer;
  let transformerOk = false;
  if (!exists(exe)) { if (opt('transformer')) row(P, 'wx-transformer 版本和 sha256', 'FAIL', '文件不存在：' + exe); else missingPath(P, 'wx-transformer 版本和 sha256', exe, tcInfo, 'wx-transformer '); }
  else {
    transformerOk = true;
    const s = sha(fs.readFileSync(exe)), fileVer = (path.basename(exe).match(/v?(\d+\.\d+\.\d+)/) || [])[1];
    if (s === tc.transformerSha256) row(P, 'wx-transformer 版本和 sha256', 'PASS', `${tc.transformerVersion}，sha256 与 pin 一致（${s.slice(0, 12)}…）`);
    else row(P, 'wx-transformer 版本和 sha256', 'FAIL', `sha256 ${s.slice(0, 16)}… 与 pin ${String(tc.transformerSha256).slice(0, 16)}…（${tc.transformerVersion}）不一致${fileVer ? `；文件名版本 ${fileVer}` : ''}`,
      {where: srcLine('convert/convert.toolchain.json', 'transformerSha256'), fix: '用 --run-transformer 核对 framework.js / game.js 锚点和 convert→verify→开发者工具 全流程后，再改 convert.toolchain.json（及本机 private 配置）的 transformer、transformerVersion、transformerSha256'});
  }

  // 实跑转换器：核对 convert.mjs 在官方产物上的补丁锚点、配置字段、插件声明。
  if (!flag('run-transformer')) row(P, '转换器产物锚点（framework.js / game.js / config.json）', 'SKIP', '加 --run-transformer 实跑（约 1 分钟，只写系统临时目录，结束删除）');
  else if (!engine || !engine.wasm) row(P, '转换器产物锚点（framework.js / game.js / config.json）', 'SKIP', '需要 --engine（godot.js + godot.wasm）');
  else if (!transformerOk) row(P, '转换器产物锚点（framework.js / game.js / config.json）', 'SKIP', '没有可用的 wx-transformer');
  else await runTransformer(P, exe, engine, js, tc);
}

async function runTransformer(P, exe, engine, js, tc) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-doctor-'));
  try {
    const at = js.lastIndexOf(MODULE_TAIL);
    if (at < 0) return row(P, '转换器产物锚点', 'SKIP', '引擎 JS 没有截断点，接不上启动桥');
    // 与 convert.mjs 第 1 步相同：截断点之前 + 启动桥。
    const bridge = fs.readFileSync(path.join(home, 'convert/assets/godot-bridge.js'), 'utf8').replace('__WXSLIM_LOCALE__', '"en"');
    fs.writeFileSync(path.join(work, 'godot-bridged.js'), js.slice(0, at) + '\n' + bridge);
    const cfg = transformerConfig({jsFile: path.join(work, 'godot-bridged.js'), wasmFile: engine.wasm, symbolsFile: engine.symbols, outputDir: path.join(work, 'out'), appID: PLACEHOLDER_APPID, appName: 'doctor', engineVersion: VERIFIED.godot, orientation: 'portrait'});
    fs.writeFileSync(path.join(work, 'transformer.config.json'), JSON.stringify(cfg, null, 2));
    const t0 = Date.now(), run = spawnSync(exe, ['--config', path.join(work, 'transformer.config.json')], {cwd: work, windowsHide: true, timeout: 600000, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, env: {...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1'}});
    const mini = path.join(cfg.outputDir, 'minigame'), f = rel => path.join(mini, rel);
    if (run.status !== 0 || !exists(f('framework.js'))) return row(P, '转换器运行', 'FAIL', `退出码 ${run.status}${run.error ? '，' + run.error.code : ''}：${short((run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' '), 200)}`, {fix: '新版转换器的配置格式可能变了：对照它的 --help 改 convert/lib/inputs.mjs 的 transformerConfig'});
    row(P, '转换器运行', 'PASS', `${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    const fw = fs.readFileSync(f('framework.js'), 'utf8');
    for (const [k, a] of Object.entries(FRAMEWORK_ANCHORS)) { const e = anchorProblem(fw, a); row(P, `framework.js 锚点 ${k}`, e ? 'FAIL' : 'PASS', e || `「${short(a, 50)}」唯一命中`, e ? {where: srcLine('convert/lib/inputs.mjs', 'export const FRAMEWORK_ANCHORS'), fix: k === 'bridge' ? '转换器改写了启动桥那一行：看 framework.js 里 __WXSLIM_GODOT_BRIDGE__ 附近的新写法' : '在新 framework.js 里找到对应位置的新写法，改 FRAMEWORK_ANCHORS，并确认 asset-gate.js 插入点语义不变'} : {}); }
    const game = fs.readFileSync(f('game.js'), 'utf8');
    for (const [k, a] of Object.entries(GAMEJS_ANCHORS)) { const e = anchorProblem(game, a), optional = k === 'startOk'; row(P, `game.js 锚点 ${k}`, e ? (optional ? 'WARN' : 'FAIL') : 'PASS', e ? (optional ? '找不到或不唯一，convert 会跳过这处计时标记：' : '') + e : `「${short(a, 50)}」唯一命中`, e ? {where: srcLine('convert/lib/inputs.mjs', 'export const GAMEJS_ANCHORS'), fix: '对照新 game.js 改 GAMEJS_ANCHORS'} : {}); }
    // convert 第 4、7 步读写的配置字段
    let kc; try { kc = readJson(f('wx-game-kit/config.json')); } catch (e) { return row(P, 'wx-game-kit/config.json', 'FAIL', '读不到：' + e.message); }
    const fields = ['launch.code.fileMD5', 'launch.code', 'launch.data', 'project.app', 'develop.monitor', 'develop', 'loadingPage.iconConfig'];
    const fm = fields.filter(k => k.split('.').reduce((o, x) => o?.[x], kc) === undefined);
    row(P, 'wx-game-kit/config.json 字段', fm.length ? 'FAIL' : 'PASS', fm.length ? '缺少：' + fm.join('、') : fields.join('、'), fm.length ? {where: srcLine('convert/convert.mjs', 'cfg.project.app.appID'), fix: '按新配置结构改 convert.mjs 第 4、7 步'} : {});
    const br = f(`wasmcode/${kc.launch?.code?.fileMD5}.wasm.br`);
    row(P, 'wasmcode/<md5>.wasm.br 能还原原 WASM', exists(br) && zlib.brotliDecompressSync(fs.readFileSync(br)).equals(fs.readFileSync(engine.wasm)) ? 'PASS' : 'FAIL', exists(br) ? 'brotli 解压后与输入一致' : '找不到 ' + path.relative(mini, br), exists(br) ? {} : {fix: '转换器改了 WASM 存放方式：改 convert.mjs 第 4 步'});
    row(P, 'data-package 目录、project.config.json', exists(f('data-package')) && exists(f('project.config.json')) ? 'PASS' : 'FAIL', '');
    const plug = (() => { try { return readJson(f('game.json')).plugins?.WXGameKit; } catch { return null; } })();
    if (!plug) row(P, 'WXGameKit 插件声明', 'FAIL', 'game.json 没有 plugins.WXGameKit', {fix: '转换器模板变了：核对 convert/lib/verify.mjs 的插件检查'});
    else row(P, 'WXGameKit 插件声明', plug.provider === tc.plugin?.provider && plug.version === tc.plugin?.version ? 'PASS' : 'FAIL', plug.version === tc.plugin?.version ? `v${plug.version}${plug.provider === tc.plugin?.provider ? '' : '，但 provider 与配置不同'}` : `转换器模板里是 v${plug.version}，配置 pin 是 v${tc.plugin?.version}`,
      plug.version === tc.plugin?.version && plug.provider === tc.plugin?.provider ? {} : {where: srcLine('convert/convert.toolchain.json', '"plugin"'), fix: '新转换器带了新版 WXGameKit：开发者工具跑通后改 convert.toolchain.json（及 private 配置）的 plugin.version；小游戏后台也要添加对应插件版本'});
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}

// ---------- split ----------
function checkSplit() {
  const P = 'split', file = opt('runtime');
  if (!file) row(P, '官方运行时 wasm-split.js（模板 sha、补丁锚点）', 'SKIP', '没给 --runtime');
  else {
    const src = fs.readFileSync(file, 'utf8'), core = fs.readFileSync(path.join(home, 'split/assets/click-owned-runtime-core.js'), 'utf8');
    if (src.includes('__WXSLIM')) row(P, '运行时是官方原始产物', 'FAIL', '这个 wasm-split.js 已经被 kit 打过补丁', {fix: '用官方 dosplit 直接生成的 wasm-split.js'});
    let releaseText = null, measuredText = null;
    for (const [name, o] of [['release', {mode: 'release', core}], ['release + measured', {mode: 'release', core, measured: true}], ['profile（采集包）', {mode: 'profile'}]]) {
      const r = checkRuntimeAnchors(src, o);
      if (name === 'release') {
        const t = r.template, hasTable = /const tableSize = \d+/.test(src);
        row(P, '运行时模板（归一化 sha）', t.known ? 'PASS' : 'FAIL', t.known ? `${t.normalizedSha256.slice(0, 16)} 在已核对列表里` : `归一化 sha ${t.normalizedSha256.slice(0, 16)} 不在已核对列表（${OFFICIAL_RUNTIME_NORMALIZED_SHA256.join('、')}）${hasTable ? '' : '；另外找不到 const tableSize = N，归一化规则也要改'}`,
          t.known ? {} : {where: srcLine('split/lib/runtime-patches.mjs', 'export const OFFICIAL_RUNTIME_NORMALIZED_SHA256'), fix: '先让下面所有锚点通过、离线测试通过，并在开发者工具和真机上验证后，把新模板的归一化 sha 前 16 位加进 OFFICIAL_RUNTIME_NORMALIZED_SHA256（保留旧值）'});
      }
      const bad = r.results.filter(x => !x.ok), total = r.results.length;
      if (!bad.length) row(P, `补丁锚点：${name}`, 'PASS', `${total} 处全部唯一命中`);
      // 锚点来自前面某处补丁插入的文本、而那处本身就失败了 → 连带失败，合并成一行，先修源头。
      const failed = new Set(bad.map(b => b.label)), chained = bad.filter(b => b.from && failed.has(b.from));
      for (const src0 of new Set(chained.map(b => b.from))) row(P, `补丁锚点：${name} / 连带失败`, 'FAIL', `${chained.filter(b => b.from === src0).map(b => b.label).join('、')}：锚点在补丁 ${src0} 插入的本工具代码里，${src0} 失败导致这些也找不到`, {fix: `先修 ${src0}，再重跑 doctor`});
      for (const b of bad.filter(b => !chained.includes(b))) {
        const what = b.code === 'DEPENDS' ? '依赖的范围没找到（见上一条）' : b.code === 'ANCHOR' ? `匹配 ${b.count} 次，应为 1 次` : b.anchor ? anchorProblem(b.text, b.anchor) || b.code : b.code;
        const own = b.from ? `（这处锚点不在官方模板里，是前面补丁 ${b.from} 插入的本工具代码${b.from === 'owned_gate_core' ? '（split/assets/click-owned-runtime-core.js）' : ''}：先修 ${b.from}；它通过了还失败，说明工具自己的插入文本被改过）` : '';
        row(P, `补丁锚点：${name} / ${b.label}`, 'FAIL', what + own, {where: b.site ? `split/lib/runtime-patches.mjs:${b.site.line}（${b.site.fn}）` : 'split/lib/runtime-patches.mjs', fix: b.from ? `先处理 ${b.from}` : '这是官方模板里的锚点：在新 wasm-split.js 里找到同一逻辑的新写法（压缩后的变量名常会变），改这一行的锚点和替换文本，替换语义保持不变'});
      }
      if (!bad.length && o.mode === 'release') o.measured ? measuredText = r.text : releaseText = r.text;
    }
    // 补丁后的运行时用模拟 wx 跑一遍点击门/兜底/等待模式（与 kit verify 同一套离线测试）。
    for (const [name, text] of [['onclick', releaseText], ['measured', measuredText]]) {
      if (!text) { row(P, `离线测试（${name}）`, 'SKIP', '补丁锚点没全过'); continue; }
      let r; try { r = runWaiterTests(text); } catch (e) { row(P, `离线测试（${name}）`, 'FAIL', e.message, {where: 'split/lib/offline-tests.mjs', fix: '离线测试切片锚点（function F / function D / v=function）对不上：按新运行时改 offline-tests.mjs 的 cut/block'}); continue; }
      const bad = r.filter(x => !x.ok);
      row(P, `离线测试（${name}）`, bad.length ? 'FAIL' : 'PASS', bad.length ? bad.map(x => `${x.name}：${x.error}`).join('；') : `${r.length}/${r.length} 通过`, bad.length ? {where: 'split/lib/offline-tests.mjs', fix: '锚点虽然命中了，但运行时行为变了：读新运行时里点击门/兜底相关逻辑，修正补丁语义'} : {});
    }
  }
  const cli = opt('split-cli');
  if (!cli) row(P, 'wasmsplit-v2-ci 版本', 'SKIP', '没给 --split-cli');
  else {
    let d = path.resolve(cli); if (fs.statSync(d).isFile()) d = path.dirname(d);
    for (let i = 0; i < 4 && !exists(path.join(d, 'package.json')); i++) d = path.dirname(d);
    const pkg = exists(path.join(d, 'package.json')) ? readJson(path.join(d, 'package.json')) : null;
    if (!pkg) row(P, 'wasmsplit-v2-ci 版本', 'FAIL', '找不到 package.json');
    else row(P, 'wasmsplit-v2-ci 版本', pkg.version === VERIFIED.wasmsplit ? 'PASS' : 'WARN', `${pkg.name} ${pkg.version}${pkg.version === VERIFIED.wasmsplit ? '' : `（验证过的是 ${VERIFIED.wasmsplit}）`}`, pkg.version === VERIFIED.wasmsplit ? {} : {fix: '新 CLI 生成的 wasm-split.js 用 --runtime 检查；通过并真机验证后，更新 doctor.mjs 的 VERIFIED.wasmsplit 和 README / split/SETUP.md 的版本号'});
  }
}

// ---------- trim ----------
const git = (args, env) => spawnSync('git', args, {encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 ** 2, env: {...process.env, ...env}});
async function checkTrim(engine) {
  const P = 'trim', tcInfo = loadToolchain('trim'), tc = tcInfo.tc;
  if (engine) { const js = fs.readFileSync(engine.js, 'utf8'), miss = RUNTIME_TOKENS.filter(t => !js.includes(t)); row(P, '编译产物 godot.js 的微信运行时约定', miss.length ? 'FAIL' : 'PASS', miss.length ? '缺少：' + miss.join('、') : RUNTIME_TOKENS.join('、'), miss.length ? {where: srcLine('trim/lib/build.mjs', 'export const RUNTIME_TOKENS'), fix: '确认新微信分支确实改了这些名字后，改 RUNTIME_TOKENS（trim build 编完会用它把关）'} : {}); }
  else row(P, '编译产物 godot.js 的微信运行时约定', 'SKIP', '没给 --engine 或 --js');

  // 引擎源码：显式 --engine-source 用它的 HEAD；否则用工具链的 engineSource + pin。
  const newSrc = opt('engine-source'), src = newSrc ? path.resolve(newSrc) : tc.engineSource;
  if (!exists(src)) { if (newSrc) row(P, '引擎源码', 'FAIL', '目录不存在：' + src); else missingPath(P, '引擎源码', src, tcInfo, '引擎源码 '); }
  else {
    const head = git(['-C', src, 'rev-parse', 'HEAD']).stdout.trim();
    const commit = newSrc ? head : tc.pin || head;
    if (!/^[0-9a-f]{40}$/.test(head)) row(P, '引擎源码是 git 仓库', 'FAIL', src);
    else if (newSrc) row(P, '源码提交与 pin', head === tc.pin ? 'PASS' : 'WARN', head === tc.pin ? '与 pin 相同' : `新源码 HEAD ${head.slice(0, 9)}，pin 是 ${String(tc.pin).slice(0, 9)}：下面按新源码检查`, head === tc.pin ? {} : {where: srcLine('trim/trim.toolchain.json', '"pin"'), fix: '全部通过并编出可用引擎后，把 trim.toolchain.json（及 private 配置）的 engineSource/pin 改成新提交'});
    else row(P, '源码提交与 pin（checkToolchain）', head === tc.pin ? 'PASS' : 'FAIL', head === tc.pin ? head.slice(0, 9) : `HEAD ${head.slice(0, 9)} ≠ pin ${String(tc.pin).slice(0, 9)}：trim check/build 会拒绝`, head === tc.pin ? {} : {fix: '源码仓库切回 pin，或按升级流程改 pin'});
    if (/^[0-9a-f]{40}$/.test(head) && git(['-C', src, 'cat-file', '-e', commit + '^{commit}']).status === 0) checkSource(P, src, commit, tc);
    else if (/^[0-9a-f]{40}$/.test(head)) row(P, '源码里有 pin 提交', 'FAIL', `仓库里没有提交 ${commit}`);
  }

  // checkToolchain 的各项（逐项列出，不在第一处失败就停）
  if (!exists(tc.python)) missingPath(P, 'Python + SCons', tc.python, tcInfo, 'Python ');
  else {
    const env = buildEnv(tc);
    try { row(P, 'Python', 'PASS', await capture(tc.python, ['--version'], {env})); } catch (e) { row(P, 'Python', 'FAIL', short(e.message, 200)); }
    try { row(P, 'SCons', 'PASS', await capture(tc.python, ['-c', 'import SCons;print(SCons.__version__)'], {env})); } catch (e) { row(P, 'SCons', 'FAIL', short(e.message, 200), {fix: '在这个 Python 里 pip install scons'}); }
    if (!exists(tc.emsdk)) missingPath(P, 'emscripten 版本', tc.emsdk, tcInfo, 'emsdk ');
    else try { const v = (await capture(tc.python, [path.join(tc.emsdk, 'upstream/emscripten/emcc.py'), '--version'], {env})).split('\n')[0]; const ok = /4\.0\.10/.test(v) && v.includes(EMSCRIPTEN_VERSION);
      row(P, 'emscripten 版本', ok ? 'PASS' : 'FAIL', v, ok ? {} : {where: srcLine('trim/lib/build.mjs', "/4\\.0\\.10/.test"), fix: `引擎附带的 libemscriptenglx 只匹配 ${EMSCRIPTEN_VERSION}：要么装回 ${EMSCRIPTEN_VERSION}，要么换用为新 emscripten 重新编译了 libemscriptenglx 的微信分支，再改 build.mjs 的版本判断和 EMSCRIPTEN_VERSION`}); }
    catch (e) { row(P, 'emscripten 版本', 'FAIL', short(e.message, 200)); }
  }
  const g = git(['--version']); row(P, 'git', g.status === 0 ? 'PASS' : 'FAIL', (g.stdout || g.stderr || '').trim());
}

// 在 pin 提交上核对补丁、detect.py 锚点、编译选项、源码自带测试。用系统临时目录里的 git 索引和对象库，源码仓库不写任何东西。
function checkSource(P, src, commit, tc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-doctor-git-'));
  try {
    const objects = git(['-C', src, 'rev-parse', '--path-format=absolute', '--git-path', 'objects']).stdout.trim();
    fs.mkdirSync(path.join(tmp, 'objects'));
    const env = {GIT_INDEX_FILE: path.join(tmp, 'index'), GIT_OBJECT_DIRECTORY: path.join(tmp, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: objects};
    const ver = git(['-C', src, 'show', commit + ':version.py']).stdout, gv = ['major', 'minor', 'patch'].map(k => (ver.match(new RegExp(`^${k} = (\\d+)`, 'm')) || [])[1]).join('.'), status = (ver.match(/^status = "(\w+)"/m) || [])[1];
    row(P, 'Godot 版本（version.py）', gv === VERIFIED.godot ? 'PASS' : 'WARN', `${gv}${status ? ' ' + status : ''}${gv === VERIFIED.godot ? '' : `（验证过的是 ${VERIFIED.godot}）`}`, gv === VERIFIED.godot ? {} : {fix: '换 Godot 大版本见 docs/UPGRADING.md“换 Godot 版本”：PCK 要用同版本编辑器导出，验证后更新 doctor.mjs 的 VERIFIED.godot 和 README'});
    const rt = git(['-C', src, 'read-tree', commit], env);
    if (rt.status !== 0) return row(P, '补丁 git apply --check', 'FAIL', 'git read-tree 失败：' + short(rt.stderr, 200));
    let applied = true;
    for (const p of tc.patches || []) {
      if (!exists(p)) { row(P, `补丁 ${path.basename(p)}`, 'FAIL', '补丁文件不存在：' + p); applied = false; continue; }
      // 按 build 的顺序依次打进临时索引（后一个补丁可能依赖前一个）。
      const r = git(['-C', src, 'apply', '--cached', '--whitespace=nowarn', p], env);
      if (r.status === 0) { row(P, `补丁 ${path.basename(p)}`, 'PASS', `能在 ${commit.slice(0, 9)} 上干净应用`); continue; }
      applied = false;
      // 补丁文件里对应 hunk 头（@@ -行号）在第几行，方便直接打开看。
      const pl = fs.readFileSync(p, 'utf8').split(/\r?\n/), hunkAt = (file, ln) => { const d = pl.findIndex(l => l.startsWith(`diff --git a/${file} `)); const h = pl.findIndex((l, k) => k > d && l.startsWith(`@@ -${ln},`)); return d >= 0 && h >= 0 ? `，补丁第 ${h + 1} 行` : ''; };
      const fails = [...r.stderr.matchAll(/patch failed: (\S+):(\d+)|error: (\S+): (does not exist in index|already exists in index)/g)].map(m => m[1] ? `${m[1]} 第 ${m[2]} 行附近的 hunk${hunkAt(m[1], m[2])}` : `${m[3]} ${m[4] === 'does not exist in index' ? '在源码里不存在' : '已存在'}`);
      row(P, `补丁 ${path.basename(p)}`, 'FAIL', (fails.length ? '应用失败：' + [...new Set(fails)].join('、') : short(r.stderr, 300)), {where: path.relative(home, p), fix: '在新源码上手工把补丁的改动移植过去（看补丁里每个 hunk 的意图），重新生成 .patch 并改 trim.toolchain.json 的 patches；补丁 sha 变了，旧的 --work 编译目录不能续编'});
    }
    const show = f => { const r = git(['-C', src, 'show', applied ? ':' + f : `${commit}:${f}`], env); return r.status === 0 ? r.stdout : null; };
    const detect = show('platform/web/detect.py');
    if (detect == null) row(P, 'detect.py Windows 链接锚点', 'FAIL', '找不到 platform/web/detect.py');
    else if (detect.includes('ENGINE_LAB_WINDOWS_LINK_RESPONSE_V')) row(P, 'detect.py Windows 链接锚点', 'PASS', '源码已自带链接 response 适配，build 会跳过');
    else { const e = anchorProblem(detect, DETECT_ANCHOR); row(P, 'detect.py Windows 链接锚点', e ? 'FAIL' : 'PASS', e || `ARCOM 行唯一命中${applied ? '' : '（补丁没打上，按原始源码检查）'}`, e ? {where: srcLine('trim/lib/build.mjs', 'export const DETECT_ANCHOR'), fix: '在新 detect.py 的 Windows/Emscripten 配置段找到 ARCOM 的新写法，改 DETECT_ANCHOR；LINK_ADAPTER 必须插在 env 已有 LINKCOM 之后'} : {}); }
    if (detect) {
      const vers = detect.match(/only documented for Emscripten ([^'"]+)/);
      if (vers) row(P, '微信分支声明支持的 emscripten 版本', vers[1].includes(EMSCRIPTEN_VERSION) ? 'PASS' : 'WARN', vers[1].trim(), vers[1].includes(EMSCRIPTEN_VERSION) ? {} : {fix: `新分支不再声明支持 ${EMSCRIPTEN_VERSION}：按它支持的版本换 emsdk，并改 trim/lib/build.mjs 的版本判断`});
    }
    const scons = (show('SConstruct') || '') + (detect || ''), keys = [...COMMON_ARGS.map(a => a.split('=')[0]).filter(k => k !== 'platform'), 'lto', 'build_profile', 'modules_enabled_by_default', 'cppdefines', 'linkflags'];
    // 只认选项定义（opts.Add("x", …) / BoolVariable("x", …) / get_opts 里的 ("x", …) / 换行后的 "x",），不认 env["x"] 这种引用。
    const mk = keys.filter(k => !new RegExp(`(\\(\\s*|^\\s*)"${k}",`, 'm').test(scons));
    row(P, 'SCons 编译选项（COMMON_ARGS 等）', mk.length ? 'FAIL' : 'PASS', mk.length ? '新源码里找不到选项：' + mk.join('、') : `${keys.length} 个选项都在 SConstruct / detect.py 里`, mk.length ? {where: srcLine('trim/lib/build.mjs', 'export const COMMON_ARGS'), fix: '查新源码的选项名（scons --help），改 COMMON_ARGS；去掉的选项要确认默认值符合小游戏要求（单线程、无 SIMD、无动态链接）'} : {});
    const ls = git(['-C', src, 'ls-tree', '-r', '--name-only', commit, 'platform/web/js/tests/', 'godot_process.js']).stdout;
    const mt = SOURCE_TESTS.filter(t => !ls.includes('platform/web/js/tests/' + t));
    row(P, '源码自带测试（build 编前运行）', mt.length ? 'WARN' : 'PASS', mt.length ? '缺少（build 会静默跳过）：' + mt.join('、') : SOURCE_TESTS.join('、'), mt.length ? {where: srcLine('trim/lib/build.mjs', 'export const SOURCE_TESTS'), fix: '看新分支的 platform/web/js/tests/ 改 SOURCE_TESTS'} : {});
    row(P, 'godot_process.js（编完后处理）', ls.includes('godot_process.js') ? 'PASS' : 'FAIL', ls.includes('godot_process.js') ? '存在' : '源码根目录没有 godot_process.js', ls.includes('godot_process.js') ? {} : {where: srcLine('trim/lib/build.mjs', "'godot_process.js'"), fix: '新分支换了后处理方式：改 build.mjs 编译后的产物收集（bin/.web_zip）'});
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}

// ---------- 输出 ----------
const engine = locateEngine();
await checkConvert(engine);
checkSplit();
await checkTrim(engine);

const n = k => rows.filter(r => r.status === k).length;
if (flag('json')) console.log(JSON.stringify({rows, summary: {pass: n('PASS'), fail: n('FAIL'), warn: n('WARN'), skip: n('SKIP')}}, null, 1));
else {
  const cell = s => String(s).replace(/\|/g, '\\|');
  console.log('| 部分 | 检查项 | 结果 | 说明 |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.part} | ${cell(r.item)} | ${LABEL[r.status]} | ${cell(r.detail)} |`);
  const todo = rows.filter(r => r.status === 'FAIL' || (r.status === 'WARN' && (r.where || r.fix)));
  if (todo.length) {
    console.log('\n## 要处理的项');
    todo.forEach((r, i) => console.log(`${i + 1}. [${LABEL[r.status]}] ${r.part} / ${r.item}\n   原因：${r.detail}${r.where ? `\n   位置：${r.where}` : ''}${r.fix ? `\n   建议：${r.fix}` : ''}`));
  }
  console.log(`\n结果：通过 ${n('PASS')}，不通过 ${n('FAIL')}，注意 ${n('WARN')}，跳过 ${n('SKIP')}`);
}
if (n('FAIL')) process.exitCode = 1;
