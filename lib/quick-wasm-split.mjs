// 面板和命令行的「WASM 分包」动作：生成采集包、生成正式分包、预览二维码。规则见 lib/wasm-split.mjs。
//   node wxslim.mjs quick wasmsplit-collect GAME_DIR --run RUN_DIR --write [--settings FILE]
//   node wxslim.mjs quick wasmsplit-release GAME_DIR --run RUN_DIR --write [--settings FILE]
//   node wxslim.mjs quick preview GAME_DIR --run RUN_DIR --write [--settings FILE]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {quickRunStatus, resolveTaskInputs} from './quick-flow.mjs';
import {WASM_SPLIT_DIR, WASM_SPLIT_STATE, symbolsFromMap, placeholderSymbols, prepareEntryForTool, restoreEntryAfterTool,
  patchCollectionRuntime, setIosCode2Delay, syncDevtoolsLaunchCode, ignoreInPackage, wasmParts, runOfficialCli, explainCliFailure} from './wasm-split.mjs';
import {previewWeChatProject} from '../editor/workbench/open-project.mjs';

const SYMBOLS = 'game.symbols.json';
const blocker = (code, message, field) => ({code, message, ...(field ? {field} : {})});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };

/** 踩坑文档（随插件分发在 runtime/docs/，源码在 docs/）。所有入口在做 WASM 分包前都要提醒用户读它。 */
export const WASM_SPLIT_NOTES = fileURLToPath(new URL('../docs/WASM分包注意事项.md', import.meta.url));
export const WASM_SPLIT_REMINDERS = [
  '采集时要把「启动后最初几秒」会出现的东西都走一遍，尤其是 iPhone（iPhone 不能停下来等余包，余包下完之前缺函数会出错；插件默认启动后 5 秒开始下载余包）',
  'iPhone 和安卓都要测，一个平台采集通过不能代表另一个平台',
  '玩完把小游戏切到后台，等 1～2 分钟再生成正式分包，否则这一轮的采集可能还没传上去',
  '换了引擎（模板、插件版本）必须重新采集；新玩法用到新的引擎功能时要继续补采',
  '不要把采集包当正式包发布',
];

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

async function callTool(ctx, args, report, label, {noKey = false} = {}) {
  fs.mkdirSync(ctx.paths.logs, {recursive: true});
  const log = path.join(ctx.paths.logs, `${label}-${Date.now()}.log`);
  const out = fs.openSync(log, 'w');
  try {
    // 微信后台偶尔断开（-202 Read From Socket Error、连接重置、超时）。官方工具按状态机推进，重跑同一条命令会接着做。
    for (let attempt = 1; ; attempt++) {
      const result = await runOfficialCli({node: process.execPath, cli: ctx.cli, cwd: ctx.paths.root,
        args: [...args, '-p', ctx.paths.minigame, ...(noKey ? [] : ['-k', ctx.key])],
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

/** 调用会改入口的官方命令（init / dosplit）：前后替我们的分流器处理入口。 */
async function withEntry(ctx, args, report, label) {
  const saved = prepareEntryForTool(ctx.paths.minigame);
  let tool;
  try { tool = await callTool(ctx, args, report, label); }
  finally {
    if (saved) {
      try { restoreEntryAfterTool(ctx.paths.minigame, saved); }
      catch (e) { if (!tool) fs.writeFileSync(path.join(ctx.paths.minigame, 'game.js'), saved.router); else throw e; }
    }
  }
  return tool;
}

/** 云端对这个引擎的采集情况（官方 getinfo）。 */
async function cloudInfo(ctx, report) {
  const file = path.join(ctx.paths.root, 'gameinfo.txt');
  await callTool(ctx, ['getinfo', '-o', file], report, 'getinfo');
  const info = readJson(file) ?? {};
  return {isProfile: info.isProfile === true, subVersion: Number(info.subVersion ?? 0), collected: Number(info.profileFuncNum ?? 0),
    increment: Number(info.profileIncrementFuncNum ?? 0), total: Number(info.sourceFuncNum ?? 0)};
}

function currentMd5(minigame) {
  try { return readJson(path.join(minigame, 'wx-game-kit', 'config.json'))?.launch?.code?.fileMD5 ?? ''; } catch { return ''; }
}

/**
 * 生成采集包，结束时手里一定是 Profile（采集）包：
 *   - 已经是采集包：沿用；
 *   - 已有正式分包：继续补采，正式包另存一份，再做 Profile 分包，云端在已有采集上累计；
 *   - 第一次：复制工程、init；云端已有这个引擎的拆分结果时 init 会直接给正式包，这时接着做 Profile 分包；
 *   - fresh（完整重采）：从未分包的工程重新开始，并用官方 switch-md5 换一个引擎编号，让后台当成全新的包从零采集。
 */
export async function quickWasmSplitCollect(options, {report = () => {}} = {}) {
  const fresh = options.fresh === true;
  const ctx = await prepare(options, 'collect');
  if (ctx.status === 'BLOCKED') return ctx;
  if (ctx.blockers.length) return {...ctx.base, status: 'BLOCKED', blockers: ctx.blockers};
  const {paths, base} = ctx;
  try {
    const state = readJson(paths.state);
    if (!fresh && state?.state === 'collecting' && isDir(paths.minigame)) {
      return {...base, status: 'SUCCESS', run: ctx.run, state: 'collecting', mode: 'reused', minigame: paths.minigame, parts: wasmParts(paths.minigame)};
    }
    const stamp = Date.now();
    let mode, symbolsKind = state?.symbols ?? '';
    if (!fresh && state?.state === 'released' && isDir(paths.minigame)) {
      mode = 'supplement';
      report({step: 'wasmsplit', phase: 'execute', message: '另存当前正式分包，继续补采'});
      fs.cpSync(paths.minigame, `${paths.minigame}-release-${stamp}`, {recursive: true});
    } else {
      mode = fresh ? 'fresh' : 'first';
      if (isDir(paths.minigame)) fs.renameSync(paths.minigame, `${paths.minigame}-${stamp}`);
      fs.mkdirSync(paths.root, {recursive: true});
      report({step: 'wasmsplit', phase: 'execute', message: '复制小游戏工程'});
      fs.cpSync(ctx.source, paths.minigame, {recursive: true});
      const symbolsMap = path.join(path.dirname(ctx.inputs.release.wasm), 'godot.symbols');
      const symbols = isFile(symbolsMap) ? symbolsFromMap(fs.readFileSync(symbolsMap, 'utf8')) : placeholderSymbols(fs.readFileSync(ctx.inputs.release.wasm));
      symbolsKind = isFile(symbolsMap) ? 'engine' : 'placeholder';
      fs.writeFileSync(path.join(paths.minigame, SYMBOLS), JSON.stringify(symbols));
      ignoreInPackage(paths.minigame, SYMBOLS);
      if (fresh) {
        report({step: 'wasmsplit', phase: 'execute', message: '换一个引擎编号（switch-md5），让微信后台当成新包'});
        await callTool(ctx, ['switch-md5', '-d', `fresh ${path.basename(ctx.run)}`], report, 'switch-md5', {noKey: true});
        syncDevtoolsLaunchCode(paths.minigame);
      }
      report({step: 'wasmsplit', phase: 'execute', message: '上传引擎并在云端预处理（第一次要几分钟）'});
      await withEntry(ctx, ['init', '-d', `${path.basename(ctx.run)} ${ctx.inputs.release.pair}${fresh ? ' fresh' : ''}`], report, 'init');
    }
    let info = await cloudInfo(ctx, report);
    if (mode === 'supplement' || !info.isProfile) {
      // 正式包（或云端直接给的已有正式结果）→ 做 Profile 分包，得到真正的采集包。
      report({step: 'wasmsplit', phase: 'execute', message: '生成采集版（Profile 分包）'});
      await withEntry(ctx, ['dosplit'], report, 'profile');
      if (mode === 'first') mode = 'cloud-existing';
      info = await cloudInfo(ctx, report);
    }
    const runtime = path.join(paths.minigame, 'wasm-split.js');
    fs.writeFileSync(runtime, patchCollectionRuntime(fs.readFileSync(runtime, 'utf8')));
    syncDevtoolsLaunchCode(paths.minigame);
    const md5 = currentMd5(paths.minigame);
    writeState(paths, {state: 'collecting', mode, run: ctx.run, pair: ctx.inputs.release.pair, symbols: symbolsKind, md5,
      collectedBefore: info.collected, totalFunctions: info.total, cloudProfile: info.isProfile, subVersion: info.subVersion});
    return {...base, status: 'SUCCESS', run: ctx.run, state: 'collecting', mode, md5, minigame: paths.minigame, parts: wasmParts(paths.minigame),
      symbols: symbolsKind, collectedBefore: info.collected, totalFunctions: info.total, cloudProfile: info.isProfile};
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
    const info = await cloudInfo(ctx, report);
    if (!info.collected) throw Object.assign(Error('云端还没有收到采集数据：请用手机打开采集包（预览二维码），把游戏主要流程玩一遍再来'), {code: 'QUICK_WASMSPLIT_NO_COLLECTION'});
    // 这一轮新增的函数：云端的 profileIncrementFuncNum；没有就用「这次总数 − 生成采集包时的总数」。
    const before = Number(state.collectedBefore ?? 0);
    const added = info.increment > 0 ? info.increment : Math.max(0, info.collected - before);
    // 补采这一轮还没收到新函数时先停下：手机上报和后台汇总有延迟，马上拆分就会丢掉这轮采集。
    // 第一次采集（first / fresh）以总数为准；用户确认后（force）仍可拆分。
    if (added === 0 && state.state === 'collecting' && ['supplement', 'cloud-existing'].includes(state.mode) && options.force !== true)
      return {...base, status: 'NEEDS_CONFIRMATION', run: ctx.run, code: 'QUICK_WASMSPLIT_NO_NEW_FUNCTIONS', collectedFunctions: info.collected, totalFunctions: info.total,
        message: `云端这一轮还没有收到新的函数（共 ${info.collected} / ${info.total}）。手机采集的数据上传和后台汇总要一点时间：玩完后把小游戏切到后台或关掉，等一两分钟再点「生成正式分包」。如果这一轮确实没有走新路线，也可以仍然生成。`};
    if (state.state === 'collecting') {
      if (isDir(paths.collect)) fs.rmSync(paths.collect, {recursive: true, force: true});
      fs.cpSync(paths.minigame, paths.collect, {recursive: true});
    }
    report({step: 'wasmsplit', phase: 'execute', message: `按采集结果拆分（${info.collected} / ${info.total} 个函数，这一轮新增 ${added}）`});
    const tool = await withEntry(ctx, ['dosplit', '--release'], report, 'release');
    // iPhone 余包下载时间：官方 30 秒，插件默认 5 秒，面板可调（docs/WASM分包注意事项.md 第 9 条）。
    const delay = Number.isInteger(ctx.inputs.settings.wasmsplitIosDelay) ? ctx.inputs.settings.wasmsplitIosDelay : 5;
    const runtimeFile = path.join(paths.minigame, 'wasm-split.js');
    if (delay !== 30) fs.writeFileSync(runtimeFile, setIosCode2Delay(fs.readFileSync(runtimeFile, 'utf8'), delay));
    syncDevtoolsLaunchCode(paths.minigame);
    writeState(paths, {state: 'released', mode: state.mode ?? '', run: ctx.run, pair: ctx.inputs.release.pair, md5: currentMd5(paths.minigame), symbols: state.symbols ?? '',
      collectedFunctions: info.collected, totalFunctions: info.total, addedThisRound: added, collectedBefore: before, iosCode2DelaySeconds: delay, log: tool.log});
    return {...base, status: 'SUCCESS', run: ctx.run, state: 'released', mode: state.mode ?? '', minigame: paths.minigame, collectedFunctions: info.collected,
      totalFunctions: info.total, addedThisRound: added, iosCode2DelaySeconds: delay, parts: wasmParts(paths.minigame), log: tool.log, notes: 'docs/WASM分包注意事项.md'};
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
  // 正式分包：按当前设置调 iPhone 余包下载时间（不用重新拆分就能试不同的值）。
  const split = readWasmSplitState(run);
  if (split?.state === 'released' && options.settingsFile) {
    const delay = readJson(options.settingsFile)?.wasmsplitIosDelay;
    const runtimeFile = path.join(project, 'wasm-split.js');
    if (Number.isInteger(delay) && isFile(runtimeFile)) {
      try { fs.writeFileSync(runtimeFile, setIosCode2Delay(fs.readFileSync(runtimeFile, 'utf8'), delay)); }
      catch (e) { return {...base, status: 'FAILED', run, error: {code: e.code || 'QUICK_PREVIEW_FAILED', message: e.message, field: 'wasmsplitIosDelay'}}; }
      fs.writeFileSync(path.join(run, 'wasmsplit', 'STATE.json'), JSON.stringify({...split, iosCode2DelaySeconds: delay}, null, 2) + '\n');
    }
  }
  const qrFile = path.join(run, 'preview-' + Date.now() + '.png');
  try {
    const result = preview(project, qrFile, options.devtools || '');
    return {...base, status: 'SUCCESS', run, project, qrFile: result.qrFile, sizes: result.sizes, wasmSplit: readWasmSplitState(run)?.state ?? 'none'};
  } catch (e) {
    return {...base, status: 'FAILED', run, error: {code: e.code || 'QUICK_PREVIEW_FAILED', message: e.message, ...(e.field ? {field: e.field} : {})}};
  }
}
