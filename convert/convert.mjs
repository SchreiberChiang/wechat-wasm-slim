#!/usr/bin/env node
// Godot 4 Web 导出 → 微信小游戏通用适配（WXGameKit）工程。用法见 ../README.md 的“转换（convert）”。
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';import {spawnSync} from 'node:child_process';
import {sha, md5, MODULE_TAIL, FRAMEWORK_ANCHORS as FA, GAMEJS_ANCHORS as GA, transformerConfig, normalizeRenderMode, locateInputs, checkInputs} from './lib/inputs.mjs';
import {instrumentRender, renderManifest} from './lib/render.mjs';
import {verifyProject, PLACEHOLDER_APPID} from './lib/verify.mjs';
import {FORMAT, treatAsGameConfig, loadGameConfig, convertArgs} from '../lib/game-config.mjs';

const home = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const argv = process.argv.slice(2), cmd = argv[0];
const argOpt = k => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : undefined; };
// --config wxslim.json：从统一配置的 game / engine / output 段取值，命令行参数优先。不带 --config 时和以前完全一样。
let game = null, fromCfg;
function loadConfig() { const f = argOpt('config'); if (!f) return; if (!treatAsGameConfig(f)) throw Error(`convert 的 --config 要指向统一配置 wxslim.json（"格式": "${FORMAT}"）：${path.resolve(f)}`); game = loadGameConfig(f); }
function requestedRenderMode() {
  const inline = argv.filter(a => a.startsWith('--render-mode='));
  if (inline.length + argv.filter(a => a === '--render-mode').length > 1) throw Error('--render-mode 不能重复指定');
  if (inline.length) return normalizeRenderMode(inline[0].slice('--render-mode='.length));
  if (argv.includes('--render-mode') && argOpt('render-mode') === undefined) throw Error('--render-mode 缺少值，只能是 webgl 或 glx');
  return normalizeRenderMode(opt('render-mode'));
}
const cfgArgs = () => fromCfg ??= game ? convertArgs(game) : {args: {}, flags: {}};
const opt = k => argOpt(k) ?? (game ? cfgArgs().args[k] : undefined);
const flag = k => argv.includes('--' + k) || !!(game && cfgArgs().flags[k]);
const need = k => { const v = opt(k); if (!v) throw Error('缺少参数 --' + k); return path.resolve(v); };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const asset = n => fs.readFileSync(path.join(home, 'assets', n), 'utf8');
const mb = n => (n / 1e6).toFixed(2) + ' MB';
// 工具链配置：--toolchain > 同目录 convert.toolchain.private.json（本机，不进仓库）> convert.toolchain.json（示例）
const toolchain = () => { const f = path.resolve(opt('toolchain') || (fs.existsSync(path.join(home, 'convert.toolchain.private.json')) ? path.join(home, 'convert.toolchain.private.json') : path.join(home, 'convert.toolchain.json'))); const t = readJson(f); t.transformer = path.resolve(path.dirname(f), t.transformer); return t; };
const inputs = () => locateInputs({exportDir: opt('export') && path.resolve(opt('export')), js: opt('js'), wasm: opt('wasm'), pck: opt('pck'), symbols: opt('symbols')});
function replaceOnce(s, a, b, label) { const n = s.split(a).length - 1; if (n !== 1) throw Error(`补丁锚点${n ? '不唯一' : '找不到'}：${label}（转换器版本变了？需要重新核对）`); return s.replace(a, () => b); }

function checkTransformer(tc) {
  if (!fs.existsSync(tc.transformer)) throw Error('找不到官方 wx-transformer：' + tc.transformer + '（在 convert.toolchain.json 里改路径，或用 --toolchain 指定）');
  if (sha(fs.readFileSync(tc.transformer)) !== tc.transformerSha256) throw Error('wx-transformer 的 sha256 与 convert.toolchain.json 里的 pin 不一致：换了版本要先核对补丁锚点');
}
function report(r) {
  for (const p of r.problems) console.log('  ✗ ' + p);
  for (const w of r.warnings) console.log('  ! ' + w);
}
// AppID 只从参数或已有工程读取，不打印。
function resolveAppid() {
  const from = opt('appid-from');
  if (from) { const f = fs.statSync(from).isDirectory() ? path.join(from, 'project.config.json') : from; const a = readJson(f).appid; if (!/^wx[0-9a-f]{16}$/.test(a || '')) throw Error('--appid-from 指向的工程里没有有效 AppID'); return {appid: a, source: 'appid-from'}; }
  const a = opt('appid'); if (a) { if (!/^wx[0-9a-f]{16}$/.test(a)) throw Error('--appid 格式不对'); return {appid: a, source: 'appid'}; }
  return {appid: PLACEHOLDER_APPID, source: 'placeholder'};
}

const commands = {
  // 检查输入是否是合规的 Godot Web 导出（微信分支引擎、单线程、有 PCK），以及官方转换器是否就位。
  async check() {
    const inp = inputs(), r = checkInputs(inp);
    const renderMode = requestedRenderMode();
    try { instrumentRender(fs.readFileSync(inp.js, 'utf8')); } catch (e) { r.ok = false; r.problems.push(e.message); }
    console.log('请求渲染模式：' + renderMode + (renderMode === 'glx' ? '（实验；宿主能力与真实初始化须运行时验证）' : '（默认）'));
    console.log('输入：\n' + ['js', 'wasm', 'pck', 'symbols'].map(k => `  ${k.padEnd(8)}${inp[k] || '（无）'}`).join('\n'));
    console.log(`引擎 JS ${mb(r.facts.jsBytes)}，WASM ${mb(r.facts.wasmBytes)}，PCK ${mb(r.facts.pckBytes)}（Godot ${r.facts.godotVersion ?? '?'}），符号表 ${r.facts.symbols ? '有' : '无'}，微信运行时约定 ${r.facts.wechatRuntime ? '有' : '无'}`);
    report(r);
    try { checkTransformer(toolchain()); console.log('官方 wx-transformer 已就位，版本与 pin 一致。'); } catch (e) { r.ok = false; console.log('  ✗ ' + e.message); }
    console.log(r.ok ? '检查通过，可以 convert。' : '检查没通过，先处理上面标 ✗ 的问题。');
    if (!r.ok) process.exitCode = 1;
  },

  // 生成新的通用适配工程：<out>/minigame（小游戏工程）、<out>/webgl/symbols.json（符号表）、<out>/convert-work（中间文件和转换器日志）。
  async convert() {
    const renderMode = requestedRenderMode();
    const tc = toolchain(), inp = inputs(), out = need('out');
    if (fs.existsSync(out)) throw Error('输出目录已存在，不覆盖：' + out);
    const r = checkInputs(inp); report(r); if (!r.ok) throw Error('输入检查没通过（见上面 ✗）');
    checkTransformer(tc);
    const orientation = opt('orientation') || 'portrait'; if (!['portrait', 'landscape'].includes(orientation)) throw Error('--orientation 只能是 portrait 或 landscape');
    const locale = opt('locale') || 'en', name = opt('name') || path.basename(inp.pck, '.pck');
    const interfaces = opt('interfaces') && path.resolve(opt('interfaces'));
    if (interfaces && !fs.existsSync(interfaces)) throw Error('找不到 --interfaces 文件：' + interfaces);
    const compat = !flag('no-compat');
    const {appid, source: appidSource} = resolveAppid();

    // 1. 在 Godot 引擎 JS 的模块定义末尾接上启动桥（原始导出文件不改）。
    const work = path.join(out, 'convert-work'); fs.mkdirSync(work, {recursive: true});
    const originalJs = fs.readFileSync(inp.js, 'utf8'), js = instrumentRender(originalJs), at = js.lastIndexOf(MODULE_TAIL);
    const rendering = renderManifest({renderMode, js: originalJs, wasm: fs.readFileSync(inp.wasm), pck: fs.readFileSync(inp.pck), godotVersion: r.facts.godotVersion, transformerVersion: tc.transformerVersion, pluginVersion: tc.plugin.version,
      runtimeOptions: {orientation, locale, name, compat, timing: !flag('no-timing'), interfacesSha256: sha(interfaces ? fs.readFileSync(interfaces) : asset('local-interfaces.js'))}});
    const bridged = path.join(work, 'godot-bridged.js');
    const bridge = replaceOnce(replaceOnce(asset('godot-bridge.js'), '__WXSLIM_LOCALE__', JSON.stringify(locale), 'locale'), '__WXSLIM_RENDER_MODE__', JSON.stringify(renderMode), 'render mode');
    fs.writeFileSync(bridged, js.slice(0, at) + '\n' + bridge);

    // 2. 官方转换器：复制 WXGameKit 模板、改写 JS 胶水为 framework.js、brotli 压缩 WASM、转换符号表。AppID 用占位符，转换后再填。
    const tcfg = transformerConfig({jsFile: bridged, wasmFile: inp.wasm, symbolsFile: inp.symbols, outputDir: path.join(work, 'transformer-out'), appID: PLACEHOLDER_APPID, appName: name, engineVersion: r.facts.godotVersion, orientation, renderMode});
    writeJson(path.join(work, 'transformer.config.json'), tcfg);
    console.log('运行官方 wx-transformer（压缩 WASM 约 0.5–1 分钟）...');
    const t0 = Date.now(), run = spawnSync(tc.transformer, ['--config', path.join(work, 'transformer.config.json')], {cwd: work, windowsHide: true, timeout: 600000, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, env: {...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1'}});
    fs.writeFileSync(path.join(work, 'transformer.stdout.txt'), run.stdout || ''); fs.writeFileSync(path.join(work, 'transformer.stderr.txt'), run.stderr || '');
    if (run.status !== 0 || !fs.existsSync(path.join(tcfg.outputDir, 'minigame/framework.js'))) throw Error(`wx-transformer 失败（退出码 ${run.status}${run.error ? '，' + run.error.code : ''}），日志在 ${work}`);
    const mini = path.join(out, 'minigame'); fs.renameSync(path.join(tcfg.outputDir, 'minigame'), mini);
    if (fs.existsSync(path.join(tcfg.outputDir, 'webgl'))) fs.renameSync(path.join(tcfg.outputDir, 'webgl'), path.join(out, 'webgl'));
    fs.rmSync(tcfg.outputDir, {recursive: true});
    const f = rel => path.join(mini, rel);

    // 3. framework.js：转换器加的资源依赖改由“数据校验通过才释放”的门控制。
    let fw = fs.readFileSync(f('framework.js'), 'utf8');
    replaceOnce(fw, FA.bridge, '', '启动桥');
    fw = replaceOnce(fw, FA.preloadAssets, "Module.__WXSLIM_ADD_ASSET_GATE__('converter');", 'wasm-preloadAssets');
    fw = replaceOnce(fw, FA.createWasm, asset('asset-gate.js') + FA.createWasm, 'createWasm');
    fs.writeFileSync(f('framework.js'), fw);

    // 4. WASM 文件名改为 15 位 md5（官方 switch-md5 只认 15 位），并确认压缩包能还原出原 WASM。
    const cfgFile = f('wx-game-kit/config.json'), cfg = readJson(cfgFile), wasm = fs.readFileSync(inp.wasm), id = md5(wasm).slice(0, 15);
    if (cfg.runtime?.contextConfig?.contextExt?.enableGLX !== (renderMode === 'glx') || cfg.runtime?.contextConfig?.contextExt?.enableMetal !== false || cfg.runtime?.contextConfig?.contextType !== 2) throw Error('转换器产物渲染配置与请求不一致，拒绝生成可运行候选');
    const brOld = f(`wasmcode/${cfg.launch.code.fileMD5}.wasm.br`), brNew = f(`wasmcode/${id}.wasm.br`);
    if (!zlib.brotliDecompressSync(fs.readFileSync(brOld)).equals(wasm)) throw Error('转换器压缩出的 WASM 解压后与输入不一致');
    fs.renameSync(brOld, brNew); cfg.launch.code.fileMD5 = id; cfg.launch.code.useWasmCodeSplit = false;

    // 5. 首包数据：说明文件 + PCK（Emscripten file_packager 布局，PCK 必须在最后，split 的 PCK 替换依赖这一点）。
    const pck = fs.readFileSync(inp.pck), notice = Buffer.from('wechat-wasm-slim convert: this data package carries the Godot PCK (last file). No network assets.\n');
    const pckPath = '/' + path.basename(inp.pck).replace(/[^\w.-]/g, '_');
    const data = Buffer.concat([notice, pck]), dataId = md5(data).slice(0, 16);
    const files = [{filename: '/WXSLIM-NOTICE.txt', start: 0, end: notice.length}, {filename: pckPath, start: notice.length, end: data.length}];
    for (const x of fs.readdirSync(f('data-package'))) if (x.endsWith('.data.bin')) fs.unlinkSync(f('data-package/' + x));
    fs.writeFileSync(f(`data-package/${dataId}.data.bin`), zlib.brotliCompressSync(data, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11}}));
    Object.assign(cfg.launch.data, {loadFromSubpackage: true, fileMD5: dataId, fileSize: data.length, optFileSize: data.length, isCompressed: true, subPrefix: ''});
    const meta = {remotePackageName: name + '.data', size: data.length, pck: files[1], pckBytes: pck.length, pckSha256: sha(pck), files, dataSha256: sha(data), engineMode: 'full_engine_not_split'};

    // 6. 胶水文件和入口。
    fs.mkdirSync(f('godot-data'));
    writeJson(f('godot-data/render-config.json'), rendering);
    fs.writeFileSync(f('godot-data/render-config.js'), 'GameGlobal.__WXSLIM_RENDER_CONFIG__=' + JSON.stringify(rendering) + ';\n');
    fs.writeFileSync(f('godot-data/render-runtime.js'), asset('render-runtime.js'));
    fs.writeFileSync(f('godot-data/package-info.js'), 'GameGlobal.__WXSLIM_PACKAGE_META__=' + JSON.stringify(meta) + ';\n');
    writeJson(f('godot-data/package.metadata.json'), {files, remote_package_size: data.length});
    for (const n of ['custom-package.js', 'single-entry.js']) fs.writeFileSync(f('godot-data/' + n), asset(n));
    // wx-compat.js 补通用适配运行时缺的浏览器对象（HTTP、WebSocket、键盘、震动），必须在游戏接口之前加载。
    if (compat) fs.writeFileSync(f('godot-data/wx-compat.js'), asset('wx-compat.js'));
    // wx-split.js 是 Godot 插件 addons/wx_split 的 JS 侧（点击门、采集包、自动测试开关的探测函数），和插件同一份源文件；不用插件的游戏装上也没有影响。
    fs.writeFileSync(f('godot-data/wx-split.js'), fs.readFileSync(path.join(home, '../godot-addon/addons/wx_split/wx_split.js')));
    fs.writeFileSync(f('godot-data/local-interfaces.js'), interfaces ? fs.readFileSync(interfaces) : asset('local-interfaces.js'));
    let entry = fs.readFileSync(f('game.js'), 'utf8');
    entry = "import './godot-data/render-config';\nimport './godot-data/render-runtime';\nimport './godot-data/package-info';\n" + entry;
    // 加载计时汇总（和 split 共用 ../split/assets/wxslim-timing.js）：首包进场景、点进各场景、callMain 分解、帧率、内存。
    // 必须最先加载；split 组装时会按实际首包/余包大小覆盖 wxslim-sizes.js。--no-timing 不装。
    if (!flag('no-timing')) {
      fs.writeFileSync(f('godot-data/wxslim-sizes.js'), 'GameGlobal.__WXSLIM_SIZES__=' + JSON.stringify({primaryBr: fs.statSync(brNew).size, code1Br: null, mode: 'nosplit'}) + ';\n');
      fs.writeFileSync(f('godot-data/wxslim-timing.js'), fs.readFileSync(path.join(home, '../split/assets/wxslim-timing.js')));
      entry = "import './godot-data/wxslim-sizes';\nimport './godot-data/wxslim-timing';\n" + entry;
      if (entry.split(GA.startOk).length === 2) entry = entry.replace(GA.startOk, "GameGlobal.__WXSLIM_TIMING__.mark('loader_start_ok');\n    " + GA.startOk);
    }
    entry = replaceOnce(entry, GA.imports, "import './godot-data/custom-package';\nimport './godot-data/single-entry';\n" + (compat ? "import './godot-data/wx-compat';\n" : '') + "import './godot-data/wx-split';\nimport './godot-data/local-interfaces';\n" + GA.imports, 'game.js import');
    entry = replaceOnce(entry, GA.handler, 'WXGameKit.loader.setModuleFunctionHandler(GameGlobal.__WXSLIM_CREATE_SINGLE_ENTRY__(commFrameWork));', 'setModuleFunctionHandler');
    entry = replaceOnce(entry, GA.startFail, "GameGlobal.__WXSLIM_RENDER_DIAGNOSTIC__.fail(err);\n    " + GA.startFail, 'loader failure diagnostic');
    fs.writeFileSync(f('game.js'), entry);

    // 7. 配置：AppID、项目名；关掉开发期性能弹窗和默认 Unity 图标。
    cfg.project.app.appID = appid; cfg.project.app.name = name;
    Object.assign(cfg.develop.monitor, {enable: false, showSuggestModal: false, showResultAfterLaunch: false}); cfg.develop.hideTimeLogModal = true; cfg.loadingPage.iconConfig.visible = false;
    writeJson(cfgFile, cfg);
    const pc = readJson(f('project.config.json')); pc.appid = appid; pc.projectname = name; pc.compileType = 'game';
    // 官方分包 CLI（wasmsplit-v2-ci init）只在工程目录里找符号表（默认 game.symbols.json）。放一份进工程，并从小游戏包里排除。
    const sym = path.join(out, 'webgl/symbols.json');
    if (fs.existsSync(sym)) {
      fs.copyFileSync(sym, f('game.symbols.json'));
      pc.packOptions ??= {}; pc.packOptions.ignore ??= [];
      if (!pc.packOptions.ignore.some(x => x.value === 'game.symbols.json')) pc.packOptions.ignore.push({type: 'file', value: 'game.symbols.json'});
    }
    writeJson(f('project.config.json'), pc);

    const result = {schema: 'wechat-wasm-slim-convert-v1', at: new Date().toISOString(), out, minigame: mini, symbols: fs.existsSync(path.join(out, 'webgl/symbols.json')) ? path.join(out, 'webgl/symbols.json') : null,
      inputs: Object.fromEntries(Object.entries(inp).filter(([, v]) => v).map(([k, v]) => [k, {path: v, sha256: sha(fs.readFileSync(v))}])),
      transformer: {version: tc.transformerVersion, sha256: tc.transformerSha256, ms: Date.now() - t0}, plugin: tc.plugin,
      appidSource, orientation, locale, compat, rendering, interfaces: interfaces || 'stub', codeMd5: id, dataMd5: dataId, pckPath, godotVersion: r.facts.godotVersion,
      sizes: {wasmBr: fs.statSync(brNew).size, dataBr: fs.statSync(f(`data-package/${dataId}.data.bin`)).size, pck: pck.length}};
    writeJson(path.join(out, 'CONVERT_REPORT.json'), result);
    console.log('  渲染：' + renderMode + '；包版本 ' + rendering.packageVersion + '；运行时诊断 [WXSLIM_RENDER_SUMMARY]（转换成功不代表真机初始化通过）');
    console.log(`已生成 ${mini}\n  WASM 压缩后 ${mb(result.sizes.wasmBr)}（wasmcode/${id}.wasm.br），PCK ${mb(pck.length)} 放在 data-package/${dataId}.data.bin，挂载为 ${pckPath}`);
    console.log('  Godot 插件 wx_split 的 JS 侧：godot-data/wx-split.js（游戏配置写在 --interfaces 文件的 WxSplitConfig 里）');
    console.log('  浏览器兼容层：' + (compat ? 'godot-data/wx-compat.js（HTTP、WebSocket、键盘、震动）' : '未生成（--no-compat），游戏要自己在 --interfaces 里补'));
    console.log('  AppID：' + {placeholder: '占位符（打开开发者工具前要换成真实 AppID，可重新 convert 加 --appid-from）', appid: '来自 --appid', 'appid-from': '来自 --appid-from'}[appidSource]);
    console.log(`下一步：node convert/convert.mjs verify --project ${mini}${game && !argOpt('out') ? '（或 --config ' + game.file + '）' : ''}`);
  },

  // 离线检查工程结构（不联网、不改文件）。
  async verify() {
    const dir = !argOpt('project') && game ? path.join(argOpt('out') ? path.resolve(argOpt('out')) : game.c.output.convert, 'minigame') : need('project'), lines = verifyProject(dir, toolchain().plugin);
    for (const [k, m] of lines) console.log(`${k === 'PASS' ? '通过' : k === 'WARN' ? '注意' : '失败'}  ${m}`);
    const n = k => lines.filter(l => l[0] === k).length;
    console.log(`结果：通过 ${n('PASS')}，注意 ${n('WARN')}，失败 ${n('FAIL')}`);
    if (n('FAIL')) process.exitCode = 1;
  },
};
try { if (!commands[cmd]) throw Error('用法：node convert.mjs <check|convert|verify> [--config wxslim.json] ...（见 ../README.md）'); loadConfig(); await commands[cmd](); }
catch (e) { console.error('错误：', e.message); process.exitCode = 1; }
