#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
// Godot 4 Web 导出 → 微信小游戏通用适配（WXGameKit）工程。用法见 ../README.md 的“转换（convert）”。
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {sha, normalizeRenderMode, normalizeLoadingPage, locateInputs, checkInputs} from './lib/inputs.mjs';
import {instrumentRender} from './lib/render.mjs';
import {verifyProject, PLACEHOLDER_APPID} from './lib/verify.mjs';
import {convertProject} from './lib/conversion-core.mjs';
import {FORMAT, treatAsGameConfig, loadGameConfig, convertArgs} from '../lib/game-config.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
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
function requestedLoadingPage() {
  const inline = argv.filter(a => a.startsWith('--loading-page='));
  if (inline.length + argv.filter(a => a === '--loading-page').length > 1) throw Error('--loading-page 不能重复指定');
  if (inline.length) return normalizeLoadingPage(inline[0].slice('--loading-page='.length));
  if (argv.includes('--loading-page') && argOpt('loading-page') === undefined) throw Error('--loading-page 缺少值，只能是 on 或 off');
  return normalizeLoadingPage(argOpt('loading-page'));
}
const cfgArgs = () => fromCfg ??= game ? convertArgs(game) : {args: {}, flags: {}};
const opt = k => argOpt(k) ?? (game ? cfgArgs().args[k] : undefined);
const flag = k => argv.includes('--' + k) || !!(game && cfgArgs().flags[k]);
const need = k => { const v = opt(k); if (!v) throw Error('缺少参数 --' + k); return path.resolve(v); };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const mb = n => (n / 1e6).toFixed(2) + ' MB';
// 工具链配置：--toolchain > 同目录 convert.toolchain.private.json（本机，不进仓库）> convert.toolchain.json（示例）
const toolchain = () => { const f = path.resolve(opt('toolchain') || (fs.existsSync(path.join(home, 'convert.toolchain.private.json')) ? path.join(home, 'convert.toolchain.private.json') : path.join(home, 'convert.toolchain.json'))); const t = readJson(f); t.transformer = path.resolve(path.dirname(f), t.transformer); return t; };
const inputs = () => locateInputs({exportDir: opt('export') && path.resolve(opt('export')), js: opt('js'), wasm: opt('wasm'), pck: opt('pck'), symbols: opt('symbols')});

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
    const renderMode = requestedRenderMode(), loadingPage = requestedLoadingPage();
    try { instrumentRender(fs.readFileSync(inp.js, 'utf8')); } catch (e) { r.ok = false; r.problems.push(e.message); }
    console.log('请求渲染模式：' + renderMode + (renderMode === 'glx' ? '（实验；宿主能力与真实初始化须运行时验证）' : '（默认）'));
    console.log('官方加载页：' + loadingPage + (loadingPage === 'off' ? '（显式对照实验）' : '（默认）'));
    console.log('输入：\n' + ['js', 'wasm', 'pck', 'symbols'].map(k => `  ${k.padEnd(8)}${inp[k] || '（无）'}`).join('\n'));
    console.log(`引擎 JS ${mb(r.facts.jsBytes)}，WASM ${mb(r.facts.wasmBytes)}，PCK ${mb(r.facts.pckBytes)}（Godot ${r.facts.godotVersion ?? '?'}），符号表 ${r.facts.symbols ? '有' : '无'}，微信运行时约定 ${r.facts.wechatRuntime ? '有' : '无'}`);
    report(r);
    try { checkTransformer(toolchain()); console.log('官方 wx-transformer 已就位，版本与 pin 一致。'); } catch (e) { r.ok = false; console.log('  ✗ ' + e.message); }
    console.log(r.ok ? '检查通过，可以 convert。' : '检查没通过，先处理上面标 ✗ 的问题。');
    if (!r.ok) process.exitCode = 1;
  },

  // 生成新的通用适配工程：<out>/minigame（小游戏工程）、<out>/webgl/symbols.json（符号表）、<out>/convert-work（中间文件和转换器日志）。
  async convert() {
    const renderMode = requestedRenderMode(), loadingPage = requestedLoadingPage();
    const tc = toolchain(), inp = inputs(), out = need('out');
    if (fs.existsSync(out)) throw Error('输出目录已存在，不覆盖：' + out);
    const r = checkInputs(inp); report(r); if (!r.ok) throw Error('输入检查没通过（见上面 ✗）');
    checkTransformer(tc);
    const orientation = opt('orientation') || 'portrait'; if (!['portrait', 'landscape'].includes(orientation)) throw Error('--orientation 只能是 portrait 或 landscape');
    const locale = opt('locale') || 'en', name = opt('name') || path.basename(inp.pck, '.pck');
    const interfaces = opt('interfaces') && path.resolve(opt('interfaces'));
    if (interfaces && !fs.existsSync(interfaces)) throw Error('找不到 --interfaces 文件：' + interfaces);
    const compat = !flag('no-compat'), splitBridge = !flag('no-split-bridge');
    const {appid, source: appidSource} = resolveAppid();

    const result = await convertProject({tc, inp, out, renderMode, loadingPage, orientation, locale, name, interfaces, compat, splitBridge,
      timing: !flag('no-timing'), appid, appidSource}, {
      onEvent: ({stage}) => { if (stage === 'TRANSFORM') console.log('运行官方 wx-transformer（压缩 WASM 约 0.5–1 分钟）...'); },
      runTransformer: ({executable, args, cwd, stdoutPath, stderrPath}) => {
        const run = spawnSync(executable, args, {cwd, windowsHide: true, timeout: 600000, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, env: {...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1'}});
        fs.writeFileSync(stdoutPath, run.stdout || ''); fs.writeFileSync(stderrPath, run.stderr || '');
        return {status: run.status, error: run.error};
      },
    });
    const {rendering, codeMd5: id, dataMd5: dataId, pckPath, minigame: mini} = result;
    console.log('  渲染：' + renderMode + '；包版本 ' + rendering.packageVersion + '；运行时诊断 [WXSLIM_RENDER_SUMMARY]（转换成功不代表真机初始化通过）');
    console.log(`已生成 ${mini}\n  WASM 压缩后 ${mb(result.sizes.wasmBr)}（wasmcode/${id}.wasm.br），PCK ${mb(result.sizes.pck)} 放在 data-package/${dataId}.data.bin，挂载为 ${pckPath}`);
    console.log('  Godot 插件 wx_split 的 JS 侧：' + (splitBridge ? 'godot-data/wx-split.js（游戏配置写在 --interfaces 文件的 WxSplitConfig 里）' : '未生成（--no-split-bridge）'));
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
