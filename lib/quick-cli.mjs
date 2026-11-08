// 快速流程命令行：
//   node wxslim.mjs quick init GAME_DIR [--output DIR]           生成设置文件模板
//   node wxslim.mjs quick plan GAME_DIR [选项]                    只读检查，列出将要做的事和缺项
//   node wxslim.mjs quick run  GAME_DIR --write [--open] [选项]   导出并转换（可选打开开发者工具）
//   node wxslim.mjs quick cancel RUN_DIR --write                  取消一次正在进行的运行（不回滚）
//   node wxslim.mjs quick runs OUTPUT_DIR                         列出输出目录下的运行及状态（只读）
// 选项：--settings FILE  --editor GODOT_EXE  --release RELEASE_DIR
import fs from 'node:fs';
import path from 'node:path';
import {quickPlan, quickRun, cancelQuickRun, listQuickRuns, quickRunStatus, templateRequirements, installReceiver, DEFAULT_SETTINGS_NAME, QUICK_SETTINGS_SCHEMA} from './quick-flow.mjs';

const USAGE = [
  'node wxslim.mjs quick init GAME_DIR [--output DIR]',
  'node wxslim.mjs quick plan GAME_DIR [--settings FILE] [--editor GODOT_EXE] [--release DIR]',
  'node wxslim.mjs quick run GAME_DIR --write [--open] [--settings FILE] [--editor GODOT_EXE] [--release DIR]',
  'node wxslim.mjs quick cancel RUN_DIR --write',
  'node wxslim.mjs quick runs OUTPUT_DIR',
  'node wxslim.mjs quick status RUN_DIR',
  'node wxslim.mjs quick open RUN_DIR --write [--appid-from project.config.json]',
  'node wxslim.mjs quick requirements full|conservative|2d',
  'node wxslim.mjs quick receiver GAME_DIR [--write] [--settings FILE]   按场景分包前往游戏里装分包加载脚本（不加 --write 只列出要写的文件）',
].join('\n');

function parse(args) {
  const [command, project, ...rest] = args;
  const options = {command, project, write: false, open: false};
  const valued = {'--settings': 'settingsFile', '--editor': 'editor', '--release': 'release', '--output': 'output', '--appid-from': 'appidFrom'};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--write') options.write = true;
    else if (flag === '--open') options.open = true;
    else if (Object.hasOwn(valued, flag) && rest[i + 1] && !rest[i + 1].startsWith('--')) options[valued[flag]] = rest[++i];
    else throw Object.assign(Error(`无法识别的参数：${flag}`), {code: 'QUICK_ARGUMENT'});
  }
  if (!['init', 'plan', 'run', 'cancel', 'runs', 'status', 'requirements', 'open', 'receiver'].includes(command) || !project) throw Object.assign(Error('参数不完整'), {code: 'QUICK_ARGUMENT'});
  if ((command === 'run' || command === 'cancel' || command === 'open') && !options.write) throw Object.assign(Error('执行需要显式加 --write'), {code: 'QUICK_WRITE_REQUIRED'});
  if (options.appidFrom && command !== 'open') throw Object.assign(Error('--appid-from 适用于打开已有运行'), {code:'QUICK_ARGUMENT'});
  return options;
}

function init({project, output = ''}) {
  const file = path.join(path.resolve(project), DEFAULT_SETTINGS_NAME);
  const value = {schema: QUICK_SETTINGS_SCHEMA, template: 'full', orientation: 'portrait', glx: true, skipPrewarm: false,
    subpackages: 'none', scenes: [], appid: '', appidFrom: '', gameName: '', output: output ? path.resolve(output) : '', locale: 'zh_CN',
    devtoolsPreview: true, largePck: false, loginCode: false};
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  return {schema: 'wxslim-quick-init-v1', settingsFile: file, next: '填好 output（已存在的目录）和 appidFrom（已有小游戏的 project.config.json）后运行 quick plan'};
}

export async function runQuickCli(args, {stdout = process.stdout, stderr = process.stderr, plan = quickPlan, run = quickRun, cancel = cancelQuickRun, runs = listQuickRuns, openProject} = {}) {
  let options;
  try { options = parse(args); }
  catch (e) { stderr.write(`错误：${e.message}\n用法：\n${USAGE}\n`); return 1; }
  try {
    if (options.command === 'requirements') {
      stdout.write(JSON.stringify(templateRequirements(options.project), null, 2)+'\n');
      return 0;
    }
    if (options.command === 'open') {
      const status = quickRunStatus(path.resolve(options.project));
      if (status?.status !== 'SUCCESS' || status.steps.convert !== 'SUCCESS' || !status.openTarget)
        throw Object.assign(Error('请选取已完成转换且有小游戏工程的运行'), {code:'QUICK_OPEN_RUN_INVALID', field:'run'});
      const launch = openProject ?? (await import('../editor/workbench/open-project.mjs')).openWeChatProject;
      const result = await launch(status.openTarget, options.appidFrom || '');
      stdout.write(JSON.stringify({schema:'wxslim-quick-open-v1', run:status.run, packageId:status.packageId, result}, null, 2)+'\n');
      return 0;
    }
    if (options.command === 'status') {
      const status = quickRunStatus(path.resolve(options.project));
      if (!status) throw Object.assign(Error('未找到此运行的记录'), {code:'QUICK_RUN_NOT_FOUND'});
      stdout.write(JSON.stringify(status, null, 2)+'\n');
      return 0;
    }
    if (options.command === 'receiver') {
      const result = await installReceiver({project: options.project, settingsFile: options.settingsFile, write: options.write});
      stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.status === 'BLOCKED') stderr.write('还不能装：\n' + result.blockers.map(b => `  - ${b.message}`).join('\n') + '\n');
      return ['INSTALLED', 'ALREADY_INSTALLED', 'PLANNED'].includes(result.status) ? 0 : result.status === 'BLOCKED' ? 2 : 1;
    }
    if (options.command === 'init') {
      stdout.write(JSON.stringify(init(options), null, 2) + '\n');
      return 0;
    }
    if (options.command === 'plan') {
      const result = await plan(options);
      stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.ready) stderr.write('还不能执行：\n' + result.blockers.map(b => `  - ${b.message}`).join('\n') + '\n');
      return result.ready ? 0 : 2;
    }
    if (options.command === 'runs') {
      stdout.write(JSON.stringify(runs(path.resolve(options.project)), null, 2) + '\n');
      return 0;
    }
    if (options.command === 'cancel') {
      const result = await cancel(path.resolve(options.project));
      stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }
    let open = null;
    if (options.open) open = openProject ?? (await import('../editor/workbench/open-project.mjs')).openWeChatProject;
    const report = event => stderr.write(`[quick] ${event.step} ${event.phase}${event.status ? ' ' + event.status : ''}\n`);
    const result = await run(options, {openProject: open, report});
    stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status === 'BLOCKED') stderr.write('还不能执行：\n' + result.blockers.map(b => `  - ${b.message}`).join('\n') + '\n');
    return result.status === 'SUCCESS' ? 0 : result.status === 'BLOCKED' ? 2 : result.status === 'CANCELLED' ? 3 : 1;
  } catch (e) {
    stderr.write(JSON.stringify({schema: 'wxslim-quick-error-v1', code: e.code || 'QUICK_FAILED', message: e.message, ...(e.field ? {field:e.field} : {})}) + '\n');
    return 1;
  }
}
