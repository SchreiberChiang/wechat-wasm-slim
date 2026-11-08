// 面板 → 快速流程的本地传输层。只做三件事：
//   1. 把面板保存的设置翻译成快速流程设置文件；
//   2. 调用 lib/quick-flow.mjs 的 plan / run，或打开已有输出；
//   3. 把进度事件和最终结果写回插件 logs，供面板轮询。
// 放行、计划、执行、预算与路径检查全部在快速流程和共用任务核心里，这里不做任何放宽。
//
// 用法：node quick-adapter.mjs LOCAL_CONFIG MODE TOKEN
//   MODE = plan | run | open | cancel | runs | status | requirements | receiver
//   cancel 的请求是 {runToken}（按该次运行的进度事件找运行目录）或 {run}（「最近运行」里未结束的运行目录）；
//   runs 的请求是 {output}，只读列出该目录下的运行；status 的请求是 {run}，等同 quick status；
//   open 的请求是 {run, settings}，等同 quick open：只打开已完成转换的运行，需要时用面板的 AppID 来源；
//   requirements 的请求是 {template}，等同 quick requirements；
//   receiver 的请求是 {project, settings, write}，等同 quick receiver（按场景分包前往游戏里装分包加载脚本）。
//   请求内容读自 logs/TOKEN.quick-request.private.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './adapter.mjs';
import {quickPlan, quickRun, cancelQuickRun, listQuickRuns, quickRunStatus, templateRequirements, installReceiver, QUICK_SETTINGS_SCHEMA} from '../../lib/quick-flow.mjs';
import {openWeChatProject} from './open-project.mjs';

const PANEL_KEYS = ['template', 'orientation', 'glx', 'skipPrewarm', 'subpackages', 'scenes', 'appid', 'appidFrom', 'gameName', 'output', 'confirmNo3d',
  'confirmRemovedModules', 'locale', 'largePck', 'loginCode', 'devtoolsPreview', 'devtools'];
const MODES = ['plan', 'run', 'open', 'cancel', 'runs', 'status', 'requirements', 'receiver'];
const TOKEN = /^[0-9]{1,12}-[0-9]{1,24}$/;

function reject(code, message) {
  throw Object.assign(Error(message), {code});
}

/** 面板设置 → 快速流程设置。手填 AppID 在没有来源文件时，生成一个只含该 AppID 的本机来源记录。 */
export function quickSettingsFromPanel(panel, logs, token) {
  const settings = {schema: QUICK_SETTINGS_SCHEMA};
  for (const key of PANEL_KEYS) if (Object.hasOwn(panel, key)) settings[key] = panel[key];
  if (!settings.appidFrom && typeof settings.appid === 'string' && /^wx[0-9a-f]{16}$/.test(settings.appid)) {
    const dir = path.join(logs, `${token}-appid`);
    fs.mkdirSync(dir);
    const source = path.join(dir, 'project.config.json');
    fs.writeFileSync(source, JSON.stringify({compileType: 'game', appid: settings.appid,
      description: '由插件面板根据用户手填的 AppID 生成，仅作为本机 AppID 来源；不是微信后台校验结果'}, null, 2) + '\n', {flag: 'wx'});
    settings.appidFrom = source;
  }
  return settings;
}

function writeResult(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  fs.renameSync(temporary, file);
}

export async function runQuickAdapter(configFile, mode, token, {plan = quickPlan, run = quickRun, open = openWeChatProject, cancel = cancelQuickRun, load = loadConfig, runs = listQuickRuns, receiver = installReceiver} = {}) {
  if (!MODES.includes(mode) || !TOKEN.test(token)) reject('QUICK_ADAPTER_ARGUMENT', '参数无效');
  const config = load(configFile);
  const logs = path.join(path.dirname(path.resolve(configFile)), 'logs');
  fs.mkdirSync(logs, {recursive: true});
  const stem = path.join(logs, token);
  const resultFile = stem + '.quick-result.private.json';
  const eventsFile = stem + '.quick-events.private.jsonl';
  const report = event => fs.appendFileSync(eventsFile, JSON.stringify({at: Date.now(), ...event}) + '\n');
  try {
    const request = JSON.parse(fs.readFileSync(stem + '.quick-request.private.json', 'utf8'));
    let result;
    if (mode === 'runs') {
      if (typeof request.output !== 'string' || !path.isAbsolute(request.output)) reject('QUICK_ADAPTER_RUNS', '没有输出目录');
      result = runs(request.output);
    } else if (mode === 'cancel' && typeof request.run === 'string') {
      // 「最近运行」里的未结束运行：必须是快速流程运行目录，且按收据仍未结束。
      const status = path.isAbsolute(request.run) ? quickRunStatus(request.run) : null;
      if (!status) reject('QUICK_ADAPTER_CANCEL', '不是快速流程的运行目录');
      if (status.status !== 'UNFINISHED') reject('QUICK_ADAPTER_CANCEL_ENDED', '这次运行已经结束，无需取消');
      result = await cancel(request.run);
    } else if (mode === 'cancel') {
      // 只取消本面板发起、且仍在本插件 logs 里有进度记录的那次运行。
      if (typeof request.runToken !== 'string' || !TOKEN.test(request.runToken) || request.runToken === token) reject('QUICK_ADAPTER_CANCEL', '没有要取消的运行');
      const runEvents = path.join(logs, request.runToken + '.quick-events.private.jsonl');
      if (fs.existsSync(path.join(logs, request.runToken + '.quick-result.private.json'))) reject('QUICK_ADAPTER_CANCEL_ENDED', '这次运行已经结束，无需取消');
      const start = fs.existsSync(runEvents) ? fs.readFileSync(runEvents, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).find(e => e.phase === 'start') : null;
      if (typeof start?.run !== 'string' || !path.isAbsolute(start.run)) reject('QUICK_ADAPTER_CANCEL_NOT_STARTED', '运行目录尚未建立；请稍后再取消');
      result = await cancel(start.run);
    } else if (mode === 'status') {
      const status = typeof request.run === 'string' && path.isAbsolute(request.run) ? quickRunStatus(request.run) : null;
      if (!status) reject('QUICK_RUN_NOT_FOUND', '未找到此运行的记录');
      result = {schema: 'wxslim-quick-status-v1', ...status};
    } else if (mode === 'requirements') {
      result = templateRequirements(String(request.template ?? ''));
    } else if (mode === 'open') {
      // 与 quick open 相同：只打开已完成转换、有小游戏工程的运行。电脑预览包已写入 AppID；其余结果用面板的 AppID 来源替换占位 AppID。
      const status = typeof request.run === 'string' && path.isAbsolute(request.run) ? quickRunStatus(request.run) : null;
      if (status?.status !== 'SUCCESS' || status.steps.convert !== 'SUCCESS' || !status.openTarget)
        reject('QUICK_OPEN_RUN_INVALID', '这次运行没有可打开的小游戏工程，请选一次已完成的运行');
      const preview = status.openTarget.includes(path.sep + 'devtools' + path.sep);
      const panelSettings = quickSettingsFromPanel(request.settings ?? {}, logs, token);
      const source = preview ? '' : panelSettings.appidFrom || '';
      result = {schema: 'wxslim-quick-open-v1', status: 'SUCCESS', run: status.run, packageId: status.packageId, open: open(status.openTarget, source, panelSettings.devtools || '')};
    } else if (mode === 'receiver') {
      if (typeof request.project !== 'string' || !path.isAbsolute(request.project)) reject('QUICK_ADAPTER_PROJECT', '没有游戏工程目录');
      const settingsFile = stem + '.quick-settings.private.json';
      fs.writeFileSync(settingsFile, JSON.stringify(quickSettingsFromPanel(request.settings ?? {}, logs, token), null, 2) + '\n', {flag: 'wx'});
      result = await receiver({project: request.project, settingsFile, write: request.write === true});
    } else {
      if (typeof request.project !== 'string' || !path.isAbsolute(request.project)) reject('QUICK_ADAPTER_PROJECT', '没有游戏工程目录');
      const settingsFile = stem + '.quick-settings.private.json';
      fs.writeFileSync(settingsFile, JSON.stringify(quickSettingsFromPanel(request.settings ?? {}, logs, token), null, 2) + '\n', {flag: 'wx'});
      const options = {project: request.project, settingsFile, editor: config.editorExecutable};
      result = mode === 'plan' ? await plan(options) : await run(options, {report, openProject: request.open === true ? open : null});
      // 计划详情体积大且面板不直接展示，只保留摘要；完整计划仍可由 quick plan 命令行重现。
      if (result.exportPlanDetail) delete result.exportPlanDetail;
    }
    writeResult(resultFile, result);
    return result;
  } catch (error) {
    const result = {schema: 'wxslim-quick-adapter-error-v1', status: 'FAILED', code: error.code || 'QUICK_ADAPTER_FAILED', message: error.message, ...(error.field ? {field: error.field} : {})};
    writeResult(resultFile, result);
    return result;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [configFile, mode, token] = process.argv.slice(2);
  const result = await runQuickAdapter(configFile, mode, token);
  process.exitCode = result.status === 'FAILED' ? 1 : 0;
}
