// 面板和命令行的「WASM 分包」动作：生成采集包、生成正式分包、预览二维码。规则见 lib/wasm-split.mjs。
//   node wxslim.mjs quick wasmsplit-collect GAME_DIR --run RUN_DIR --write [--settings FILE]
//   node wxslim.mjs quick wasmsplit-release GAME_DIR --run RUN_DIR --write [--settings FILE]
//   node wxslim.mjs quick preview GAME_DIR --run RUN_DIR --write [--settings FILE]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {quickRunStatus, resolveTaskInputs} from './quick-flow.mjs';
import {WASM_SPLIT_DIR, WASM_SPLIT_STATE, symbolsFromMap, placeholderSymbols, prepareEntryForTool, restoreEntryAfterTool,
  patchCollectionRuntime, syncDevtoolsLaunchCode, ignoreInPackage, wasmParts, runOfficialCli, explainCliFailure} from './wasm-split.mjs';
import {previewWeChatProject} from '../editor/workbench/open-project.mjs';

const SYMBOLS = 'game.symbols.json';
const blocker = (code, message, field) => ({code, message, ...(field ? {field} : {})});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };

export function wasmSplitPaths(run) {
  const root = path.join(run, WASM_SPLIT_DIR);
  return {root, minigame: path.join(root, 'minigame'), collect: path.join(root, 'collect'), state: path.join(root, WASM_SPLIT_STATE), logs: path.join(root, 'logs')};
}

/** 这次运行原来打开的小游戏工程（电脑预览包、组包结果或转换结果），不含 WASM 分包副本。 */
function baseMinigame(run) {
  for (const rel of [['devtools', 'minigame'], ['final', 'converted', 'minigame'], ['wechat', 'converted', 'minigame']]) {
    const dir = path.join(run, ...rel);
    if (isFile(path.join(dir, 'project.config.json'))) return dir;
  }
  return '';
}

export function readWasmSplitState(run) { return readJson(wasmSplitPaths(run).state); }

async function prepare(options, action) {
  const base = {schema: 'wxslim-quick-wasmsplit-v1', action};
  const run = typeof options.run === 'string' && path.isAbsolute(options.run) ? options.run : '';
  const status = run ? quickRunStatus(run) : null;
  if (status?.status !== 'SUCCESS' || status.steps.convert !== 'SUCCESS')
    return {...base, status: 'BLOCKED', blockers: [blocker('QUICK_WASMSPLIT_RUN', 'WASM 分包需要一次已完成的导出，请先点「导出并转换」', 'run')]};
  const inputs = await resolveTaskInputs(options);
  const blockers = inputs.blockers.filter(b => ['editor', 'release'].includes(b.field));
  const key = inputs.settings.wasmsplitKey;
  if (action !== 'preview' && !(key && path.isAbsolute(key) && isFile(key)))
    blockers.push(blocker('QUICK_WASMSPLIT_KEY', '请在「发布信息 → WASM 分包密钥」里选择分包用的私钥文件（公钥要先上传到小游戏后台「Wasm 分包 CI 鉴权配置」）', 'wasmsplitKey'));
  const source = baseMinigame(run);
  if (!source) blockers.push(blocker('QUICK_WASMSPLIT_RUN', '这次运行里没有小游戏工程，请完整导出一次', 'run'));
  const render = source ? readJson(path.join(source, 'godot-data', 'render-config.json')) : null;
  if (action !== 'preview' && inputs.release && render && sha(fs.readFileSync(inputs.release.wasm)) !== render.wasmSha256)
    blockers.push(blocker('QUICK_WASMSPLIT_ENGINE', '插件里的引擎和这次运行用的不一样（模板或插件版本变了），请先完整导出一次', 'run'));
  const cli = inputs.release ? path.join(inputs.release.root, 'tools', 'wasmsplit-v2-ci', 'bin', 'cli.js') : '';
  if (action !== 'preview' && inputs.release && !isFile(cli))
    blockers.push(blocker('QUICK_WASMSPLIT_TOOL', '插件里缺少微信官方分包工具 wasmsplit-v2-ci，请换成新版插件', 'release'));
  return {base, run, status, inputs, blockers, key, source, cli, paths: run ? wasmSplitPaths(run) : null};
}

function writeState(paths, state) { fs.writeFileSync(paths.state, JSON.stringify({schema: 'wxslim-wasmsplit-state-v1', ...state, at: new Date().toISOString()}, null, 2) + '\n'); }

async function callTool(ctx, args, report, label) {
  fs.mkdirSync(ctx.paths.logs, {recursive: true});
  const log = path.join(ctx.paths.logs, `${label}-${Date.now()}.log`);
  const out = fs.openSync(log, 'w');
  try {
    // 微信后台偶尔断开（-202 Read From Socket Error、连接重置、超时）。官方工具按状态机推进，重跑同一条命令会接着做。
    for (let attempt = 1; ; attempt++) {
      const result = await runOfficialCli({node: process.execPath, cli: ctx.cli, cwd: ctx.paths.root,
        args: [...args, '-p', ctx.paths.minigame, '-k', ctx.key],
        onLine: line => { fs.writeSync(out, line + '\n'); if (/^→|^✓|已等待|预处理|分包|下载|应用|上传/.test(line)) report({step: 'wasmsplit', phase: 'progress', message: line.slice(0, 120)}); }});
      if (result.code === 0) return {log, tail: result.tail, attempts: attempt};
      const network = /\[-202\]|Read From Socket|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up|EAI_AGAIN/i.test(result.tail);
      if (!network || attempt >= 3) throw Object.assign(Error(explainCliFailure(result.tail).message), explainCliFailure(result.tail), {log});
      fs.writeSync(out, `--- 第 ${attempt} 次遇到网络错误，10 秒后重试 ---\n`);
      report({step: 'wasmsplit', phase: 'progress', message: `微信后台网络错误，10 秒后第 ${attempt + 1} 次重试`});
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  } finally { fs.closeSync(out); }
}

/** 生成采集包。已经在采集状态（同一个引擎）时直接重用，不再上传。 */
export async function quickWasmSplitCollect(options, {report = () => {}} = {}) {
  const ctx = await prepare(options, 'collect');
  if (ctx.status === 'BLOCKED') return ctx;
  if (ctx.blockers.length) return {...ctx.base, status: 'BLOCKED', blockers: ctx.blockers};
  const {paths, base} = ctx;
  try {
    const state = readJson(paths.state);
    if (state?.state === 'collecting' && isDir(paths.minigame)) {
      return {...base, status: 'SUCCESS', run: ctx.run, state: 'collecting', reused: true, minigame: paths.minigame, parts: wasmParts(paths.minigame)};
    }
    // 新的分包副本：之前的副本（比如上一轮正式包）改名留着，不删。
    if (isDir(paths.minigame)) fs.renameSync(paths.minigame, paths.minigame + '-' + Date.now());
    fs.mkdirSync(paths.root, {recursive: true});
    report({step: 'wasmsplit', phase: 'execute', message: '复制小游戏工程'});
    fs.cpSync(ctx.source, paths.minigame, {recursive: true});
    const symbolsMap = path.join(path.dirname(ctx.inputs.release.wasm), 'godot.symbols');
    const symbols = isFile(symbolsMap) ? symbolsFromMap(fs.readFileSync(symbolsMap, 'utf8')) : placeholderSymbols(fs.readFileSync(ctx.inputs.release.wasm));
    fs.writeFileSync(path.join(paths.minigame, SYMBOLS), JSON.stringify(symbols));
    ignoreInPackage(paths.minigame, SYMBOLS);
    const saved = prepareEntryForTool(paths.minigame);
    let tool;
    try {
      report({step: 'wasmsplit', phase: 'execute', message: '上传引擎并在云端预处理（几分钟）'});
      tool = await callTool(ctx, ['init', '-d', `${path.basename(ctx.run)} ${ctx.inputs.release.pair}`], report, 'init');
    } finally { if (saved) { try { restoreEntryAfterTool(paths.minigame, saved); } catch (e) { if (!tool) fs.writeFileSync(path.join(paths.minigame, 'game.js'), saved.router); else throw e; } } }
    const runtime = path.join(paths.minigame, 'wasm-split.js');
    fs.writeFileSync(runtime, patchCollectionRuntime(fs.readFileSync(runtime, 'utf8')));
    syncDevtoolsLaunchCode(paths.minigame);
    writeState(paths, {state: 'collecting', run: ctx.run, pair: ctx.inputs.release.pair, symbols: isFile(symbolsMap) ? 'engine' : 'placeholder', log: tool.log});
    return {...base, status: 'SUCCESS', run: ctx.run, state: 'collecting', minigame: paths.minigame, parts: wasmParts(paths.minigame),
      symbols: isFile(symbolsMap) ? 'engine' : 'placeholder', log: tool.log};
  } catch (e) {
    return {...base, status: 'FAILED', run: ctx.run, error: {code: e.code || 'QUICK_WASMSPLIT_FAILED', message: e.message, ...(e.field ? {field: e.field} : {}), ...(e.log ? {log: e.log} : {})}};
  }
}

/** 生成正式分包：要求先有采集包并在手机上玩过。 */
export async function quickWasmSplitRelease(options, {report = () => {}} = {}) {
  const ctx = await prepare(options, 'release');
  if (ctx.status === 'BLOCKED') return ctx;
  const state = ctx.paths ? readJson(ctx.paths.state) : null;
  if (!ctx.blockers.length && !(state && ['collecting', 'released'].includes(state.state) && isDir(ctx.paths.minigame)))
    ctx.blockers.push(blocker('QUICK_WASMSPLIT_NOT_COLLECTING', '还没有采集包：先点「生成采集包」，用手机打开把游戏主要流程玩一遍', 'run'));
  if (ctx.blockers.length) return {...ctx.base, status: 'BLOCKED', blockers: ctx.blockers};
  const {paths, base} = ctx;
  try {
    report({step: 'wasmsplit', phase: 'execute', message: '读取采集到的函数'});
    const infoFile = path.join(paths.root, 'gameinfo.txt');
    await callTool(ctx, ['getinfo', '-o', infoFile], report, 'getinfo');
    const info = readJson(infoFile) ?? {};
    const collected = Number(info.profileFuncNum ?? info.profileIncrementFuncNum ?? 0), total = Number(info.sourceFuncNum ?? 0);
    if (!collected) throw Object.assign(Error('云端还没有收到采集数据：请用手机打开采集包（预览二维码），把游戏主要流程玩一遍再来'), {code: 'QUICK_WASMSPLIT_NO_COLLECTION'});
    if (state.state === 'collecting') {
      if (isDir(paths.collect)) fs.rmSync(paths.collect, {recursive: true, force: true});
      fs.cpSync(paths.minigame, paths.collect, {recursive: true});
    }
    const saved = prepareEntryForTool(paths.minigame);
    let tool;
    try {
      report({step: 'wasmsplit', phase: 'execute', message: `按采集结果拆分（${collected} / ${total} 个函数）`});
      tool = await callTool(ctx, ['dosplit', '--release'], report, 'release');
    } finally { if (saved) { try { restoreEntryAfterTool(paths.minigame, saved); } catch (e) { if (!tool) fs.writeFileSync(path.join(paths.minigame, 'game.js'), saved.router); else throw e; } } }
    syncDevtoolsLaunchCode(paths.minigame);
    writeState(paths, {state: 'released', run: ctx.run, pair: ctx.inputs.release.pair, collectedFunctions: collected, totalFunctions: total, log: tool.log});
    return {...base, status: 'SUCCESS', run: ctx.run, state: 'released', minigame: paths.minigame, collectedFunctions: collected, totalFunctions: total, parts: wasmParts(paths.minigame), log: tool.log};
  } catch (e) {
    return {...base, status: 'FAILED', run: ctx.run, error: {code: e.code || 'QUICK_WASMSPLIT_FAILED', message: e.message, ...(e.field ? {field: e.field} : {}), ...(e.log ? {log: e.log} : {})}};
  }
}

/** 预览二维码：这次运行当前在开发者工具里打开的工程（有 WASM 分包副本时就是它）。 */
export async function quickPreview(options, {preview = previewWeChatProject} = {}) {
  const base = {schema: 'wxslim-quick-preview-v1'};
  const run = typeof options.run === 'string' && path.isAbsolute(options.run) ? options.run : '';
  const status = run ? quickRunStatus(run) : null;
  if (status?.status !== 'SUCCESS' || !status.openTarget)
    return {...base, status: 'BLOCKED', blockers: [blocker('QUICK_PREVIEW_RUN', '预览需要一次已完成的导出', 'run')]};
  const project = path.dirname(status.openTarget);
  const qrFile = path.join(run, 'preview-' + Date.now() + '.png');
  try {
    const result = preview(project, qrFile, options.devtools || '');
    return {...base, status: 'SUCCESS', run, project, qrFile: result.qrFile, sizes: result.sizes, wasmSplit: readWasmSplitState(run)?.state ?? 'none'};
  } catch (e) {
    return {...base, status: 'FAILED', run, error: {code: e.code || 'QUICK_PREVIEW_FAILED', message: e.message, ...(e.field ? {field: e.field} : {})}};
  }
}
