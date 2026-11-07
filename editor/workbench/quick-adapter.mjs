// 面板 → 快速流程的本地传输层。只做三件事：
//   1. 把面板保存的设置翻译成快速流程设置文件；
//   2. 调用 lib/quick-flow.mjs 的 plan / run，或打开已有输出；
//   3. 把进度事件和最终结果写回插件 logs，供面板轮询。
// 放行、计划、执行、预算与路径检查全部在快速流程和共用任务核心里，这里不做任何放宽。
//
// 用法：node quick-adapter.mjs LOCAL_CONFIG MODE TOKEN
//   MODE = plan | run | open | cancel；cancel 的请求是 {runToken}，按该次运行的进度事件找到运行目录。
//   请求内容读自 logs/TOKEN.quick-request.private.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './adapter.mjs';
import {quickPlan, quickRun, cancelQuickRun, QUICK_SETTINGS_SCHEMA} from '../../lib/quick-flow.mjs';
import {openWeChatProject} from './open-project.mjs';

const PANEL_KEYS = ['template', 'orientation', 'glx', 'skipPrewarm', 'subpackages', 'scenes', 'appid', 'appidFrom', 'gameName', 'output'];
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

export async function runQuickAdapter(configFile, mode, token, {plan = quickPlan, run = quickRun, open = openWeChatProject, cancel = cancelQuickRun, load = loadConfig} = {}) {
  if (!['plan', 'run', 'open', 'cancel'].includes(mode) || !TOKEN.test(token)) reject('QUICK_ADAPTER_ARGUMENT', '参数无效');
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
    if (mode === 'cancel') {
      // 只取消本面板发起、且仍在本插件 logs 里有进度记录的那次运行。
      if (typeof request.runToken !== 'string' || !TOKEN.test(request.runToken) || request.runToken === token) reject('QUICK_ADAPTER_CANCEL', '没有要取消的运行');
      const runEvents = path.join(logs, request.runToken + '.quick-events.private.jsonl');
      if (fs.existsSync(path.join(logs, request.runToken + '.quick-result.private.json'))) reject('QUICK_ADAPTER_CANCEL_ENDED', '这次运行已经结束，无需取消');
      const start = fs.existsSync(runEvents) ? fs.readFileSync(runEvents, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).find(e => e.phase === 'start') : null;
      if (typeof start?.run !== 'string' || !path.isAbsolute(start.run)) reject('QUICK_ADAPTER_CANCEL_NOT_STARTED', '运行目录尚未建立；请稍后再取消');
      result = await cancel(start.run);
    } else if (mode === 'open') {
      if (typeof request.projectConfig !== 'string' || !path.isAbsolute(request.projectConfig)) reject('QUICK_ADAPTER_OPEN', '没有可打开的转换结果');
      result = {schema: 'wxslim-quick-open-v1', status: 'SUCCESS', open: open(request.projectConfig, '')};
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
    const result = {schema: 'wxslim-quick-adapter-error-v1', status: 'FAILED', code: error.code || 'QUICK_ADAPTER_FAILED', message: error.message};
    writeResult(resultFile, result);
    return result;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [configFile, mode, token] = process.argv.slice(2);
  const result = await runQuickAdapter(configFile, mode, token);
  process.exitCode = result.status === 'FAILED' ? 1 : 0;
}
