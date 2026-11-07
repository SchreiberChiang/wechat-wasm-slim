// 快速流程：把一份很小的项目设置翻译成现有的「PCK 导出」和「官方转换」请求，
// 再交给共用任务核心按「计划 → 带计划摘要执行」运行。
//
// 这里不新增任何放行规则：草稿由面板同款表单生成器产出，路径冲突、已有输出、
// 预算、编辑器指纹、引擎配对和转换器指纹全部仍由 task-core 及各执行器检查。
// 快速流程只负责：找安装版里的固定文件、选默认值、建本次运行目录、把两步串起来。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTaskService, taskPlanIdentity} from './task-core.mjs';
import {buildExportRequestDraft} from '../editor/workbench/export-request-form.mjs';
import {buildOfficialConvertRequestDraft} from '../editor/workbench/official-convert-request-form.mjs';
import {OFFICIAL_C050_CAPABILITY_PROFILE} from '../convert/lib/official-engine-admission.mjs';

const MiB = 1024 * 1024;
export const QUICK_SETTINGS_SCHEMA = 'wxslim-quick-settings-v1';
export const DEFAULT_SETTINGS_NAME = 'wxslim-export.json';
export const runtimeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SIMPLE_INTERFACES = path.join(runtimeRoot, 'convert', 'assets', 'simple-delivery-interface.js');

const DEFAULTS = Object.freeze({
  template: '', orientation: 'portrait', glx: true, skipPrewarm: false, subpackages: 'none', scenes: [],
  appid: '', appidFrom: '', gameName: '', output: '', locale: 'en',
  exportBudgetMiB: 128, importCacheBudgetMiB: 256, largePck: false,
});
const TYPES = {
  template: 'string', orientation: 'string', glx: 'boolean', skipPrewarm: 'boolean', subpackages: 'string', scenes: 'array',
  appid: 'string', appidFrom: 'string', gameName: 'string', output: 'string', locale: 'string',
  exportBudgetMiB: 'number', importCacheBudgetMiB: 'number', largePck: 'boolean',
};

function quickError(code, message) {
  return Object.assign(Error(message), {code});
}
const typeOf = value => Array.isArray(value) ? 'array' : typeof value;
const blocker = (code, message) => ({code, message});

/** 读取并校验快速流程设置。未知字段直接拒绝，避免拼错的设置被静默忽略。 */
export function normalizeQuickSettings(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== QUICK_SETTINGS_SCHEMA) {
    throw quickError('QUICK_SETTINGS_SCHEMA', `设置文件需要 "schema": "${QUICK_SETTINGS_SCHEMA}"`);
  }
  const unknown = Object.keys(raw).filter(key => key !== 'schema' && !Object.hasOwn(TYPES, key));
  if (unknown.length) throw quickError('QUICK_SETTINGS_FIELDS', '设置文件含未知字段：' + unknown.join('、'));
  const settings = {...DEFAULTS, scenes: []};
  for (const [key, type] of Object.entries(TYPES)) {
    if (!Object.hasOwn(raw, key)) continue;
    if (typeOf(raw[key]) !== type) throw quickError('QUICK_SETTINGS_TYPE', `设置字段 ${key} 的类型应为 ${type}`);
    settings[key] = type === 'array' ? [...raw[key]] : raw[key];
  }
  for (const key of ['template', 'appid', 'appidFrom', 'gameName', 'output', 'locale']) settings[key] = settings[key].trim();
  return settings;
}

export function loadQuickSettings(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { throw quickError('QUICK_SETTINGS_MISSING', `找不到设置文件 ${file}`); }
  let raw;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); }
  catch { throw quickError('QUICK_SETTINGS_JSON', `设置文件不是合法 JSON：${file}`); }
  return normalizeQuickSettings(raw);
}

/** 当前快速流程能处理的组合；其余组合给出明确原因，而不是退回到需要手工配置的路径。 */
export function settingsBlockers(settings) {
  const list = [];
  if (!settings.template) list.push(blocker('QUICK_TEMPLATE_MISSING', '未选择模板（template：full / 2d / custom）'));
  else if (settings.template === '2d' || settings.template === 'custom')
    list.push(blocker('QUICK_TEMPLATE_NEEDS_PREPARATION', `${settings.template === '2d' ? '2D' : '自定义'}模板使用自建配对，需要配对准备文件和本次 PCK 的功能声明，快速流程暂只支持完整模板`));
  else if (settings.template !== 'full') list.push(blocker('QUICK_TEMPLATE_UNKNOWN', `未知模板 ${settings.template}`));
  if (!['portrait', 'landscape'].includes(settings.orientation)) list.push(blocker('QUICK_ORIENTATION', 'orientation 只能是 portrait 或 landscape'));
  if (settings.skipPrewarm && settings.template === 'full') list.push(blocker('QUICK_PREWARM_UNSUPPORTED', '完整模板的引擎启动时固定预热，跳过预热需要重建引擎'));
  if (settings.subpackages === 'scenes') list.push(blocker('QUICK_SUBPACKAGES_PENDING', '按场景分包尚未接入快速流程，请先用 subpackages: "none"'));
  else if (settings.subpackages !== 'none') list.push(blocker('QUICK_SUBPACKAGES_UNKNOWN', 'subpackages 只能是 none 或 scenes'));
  if (!settings.output) list.push(blocker('QUICK_OUTPUT_MISSING', '未设置输出目录（output）'));
  else if (!path.isAbsolute(settings.output)) list.push(blocker('QUICK_OUTPUT_RELATIVE', '输出目录必须是绝对路径'));
  else if (!isDirectory(settings.output)) list.push(blocker('QUICK_OUTPUT_NOT_FOUND', `输出目录不存在：${settings.output}`));
  if (settings.appid && !/^wx[0-9a-f]{16}$/.test(settings.appid)) list.push(blocker('QUICK_APPID_FORMAT', 'AppID 格式应为 wx 加 16 位小写十六进制'));
  if (settings.appidFrom && !(path.isAbsolute(settings.appidFrom) && isFile(settings.appidFrom)))
    list.push(blocker('QUICK_APPID_SOURCE', `AppID 来源文件不存在：${settings.appidFrom}`));
  if (!Number.isSafeInteger(settings.exportBudgetMiB) || settings.exportBudgetMiB < 8 || settings.exportBudgetMiB > 272)
    list.push(blocker('QUICK_EXPORT_BUDGET', 'exportBudgetMiB 需在 8 到 272 之间'));
  if (!Number.isSafeInteger(settings.importCacheBudgetMiB) || settings.importCacheBudgetMiB < 0 || settings.importCacheBudgetMiB > 4096)
    list.push(blocker('QUICK_IMPORT_BUDGET', 'importCacheBudgetMiB 需在 0 到 4096 之间'));
  return list;
}

function isDirectory(file) { try { return fs.statSync(file).isDirectory(); } catch { return false; } }
function isFile(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }

/** 只取 platform="Web" 的预设；多于一个时要求在设置里写明，避免猜错。 */
export function findWebPresets(text) {
  const names = [];
  let current = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[preset\.\d+\]$/.test(line)) { current = {}; names.push(current); continue; }
    if (line.startsWith('[')) { current = null; continue; }
    const match = current && /^(name|platform)\s*=\s*"((?:[^"\\]|\\.)*)"$/.exec(line);
    if (match) current[match[1]] = JSON.parse(`"${match[2]}"`);
  }
  return names.filter(p => p.platform === 'Web' && p.name).map(p => p.name);
}

export function projectName(projectFileText) {
  const match = /^config\/name\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(projectFileText);
  return match ? JSON.parse(`"${match[1]}"`) : '';
}

/** 安装版位置：显式参数；安装版 runtime 的上一级；源码旁边的 release 目录。 */
export function resolveRelease(explicit = '') {
  const candidates = explicit ? [path.resolve(explicit)] : [path.dirname(runtimeRoot), path.join(path.dirname(runtimeRoot), 'release')];
  const root = candidates.find(dir => isFile(path.join(dir, 'RELEASE.json')) && isFile(path.join(dir, 'profiles.json')));
  if (!root) throw quickError('QUICK_RELEASE_NOT_FOUND', '找不到安装版目录（需含 RELEASE.json 和 profiles.json），可用 --release 指定');
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'profiles.json'), 'utf8'));
  const full = profiles?.pairs?.full;
  if (full?.profile !== OFFICIAL_C050_CAPABILITY_PROFILE || full.requiresPreparedSource !== false)
    throw quickError('QUICK_RELEASE_PAIR', '安装版缺少可直接使用的完整模板配对');
  const transformers = Object.keys(profiles.files || {}).filter(name => /^tools\/wx-transformer-[^/]+\.exe$/.test(name));
  if (transformers.length !== 1) throw quickError('QUICK_RELEASE_TRANSFORMER', '安装版中应恰好有一个微信转换器');
  const resolved = {
    root, profile: full.profile,
    js: path.join(root, ...full.js.split('/')), wasm: path.join(root, ...full.wasm.split('/')),
    transformer: path.join(root, ...transformers[0].split('/')),
  };
  for (const key of ['js', 'wasm', 'transformer'])
    if (!isFile(resolved[key])) throw quickError('QUICK_RELEASE_FILE', `安装版缺少文件：${resolved[key]}`);
  return resolved;
}

/** 编辑器路径属于本机配置：显式参数、环境变量、游戏工程的插件安装记录。 */
export function resolveEditor(project, explicit = '', env = process.env) {
  if (explicit) return path.resolve(explicit);
  if (env.WXSLIM_GODOT_EDITOR) return path.resolve(env.WXSLIM_GODOT_EDITOR);
  try {
    const state = fs.readFileSync(path.join(project, '.godot', 'wxslim', 'state.path'), 'utf8').trim();
    const config = JSON.parse(fs.readFileSync(path.join(state, 'local-config.json'), 'utf8'));
    if (typeof config.editorExecutable === 'string' && path.isAbsolute(config.editorExecutable)) return config.editorExecutable;
  } catch { /* 未安装插件时没有记录，继续报缺失 */ }
  throw quickError('QUICK_EDITOR_NOT_FOUND', '找不到 Godot 编辑器：用 --editor 指定，或设置 WXSLIM_GODOT_EDITOR，或先用安装版 install.mjs 安装插件');
}

export function runName(name, date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const slug = (name || 'game').replace(/[\\/:*?"<>|\s.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game';
  return `${slug}-${stamp}`;
}

/** 汇总一次运行要用到的所有输入；不写任何文件。 */
export function resolveQuickInputs({project, settingsFile = '', editor = '', release = '', now = new Date(), env = process.env}) {
  const projectDir = path.resolve(project);
  const projectFile = path.join(projectDir, 'project.godot');
  if (!isFile(projectFile)) throw quickError('QUICK_PROJECT_NOT_FOUND', `不是 Godot 工程目录：${projectDir}`);
  const file = settingsFile ? path.resolve(settingsFile) : path.join(projectDir, DEFAULT_SETTINGS_NAME);
  const settings = loadQuickSettings(file);
  const blockers = settingsBlockers(settings);
  const presetsFile = path.join(projectDir, 'export_presets.cfg');
  const presets = isFile(presetsFile) ? findWebPresets(fs.readFileSync(presetsFile, 'utf8')) : [];
  if (presets.length !== 1)
    blockers.push(blocker('QUICK_WEB_PRESET', presets.length ? `工程有 ${presets.length} 个 Web 导出预设，快速流程需要恰好一个` : '工程缺少 Web 导出预设（在 Godot「项目 → 导出」中添加 Web 预设）'));
  const name = settings.gameName || projectName(fs.readFileSync(projectFile, 'utf8')) || path.basename(projectDir);
  let editorPath = '', releaseInfo = null;
  try { editorPath = resolveEditor(projectDir, editor, env); } catch (e) { blockers.push(blocker(e.code, e.message)); }
  try { releaseInfo = resolveRelease(release); } catch (e) { blockers.push(blocker(e.code, e.message)); }
  if (!isFile(SIMPLE_INTERFACES)) blockers.push(blocker('QUICK_INTERFACES_MISSING', `缺少默认接口文件：${SIMPLE_INTERFACES}`));
  const run = settings.output && path.isAbsolute(settings.output) ? path.join(settings.output, runName(name, now)) : '';
  return {
    project: projectDir, settingsFile: file, settings, name, preset: presets.length === 1 ? presets[0] : '',
    editor: editorPath, release: releaseInfo, interfaces: SIMPLE_INTERFACES, blockers,
    run, exportOutput: run && path.join(run, 'pck'), convertOutput: run && path.join(run, 'wechat'), requests: run && path.join(run, 'requests'),
  };
}

export function exportPayload(inputs) {
  return {
    project: inputs.project, preset: inputs.preset, output: inputs.exportOutput,
    budgetBytes: inputs.settings.exportBudgetMiB * MiB, cacheGrowthBudgetBytes: inputs.settings.importCacheBudgetMiB * MiB,
    allowImportWrites: true,
  };
}

export function convertPayload(inputs, pck) {
  const {settings, release} = inputs;
  return {
    engineProfile: release.profile, removedModules: null,
    js: release.js, wasm: release.wasm, pck, transformer: release.transformer, interfaces: inputs.interfaces,
    output: inputs.convertOutput, renderMode: settings.glx ? 'glx' : 'webgl', name: inputs.name,
    locale: settings.locale, orientation: settings.orientation,
    ...(settings.largePck ? {largePckBudget: true} : {}),
  };
}

function writeDraft(draft, files) {
  fs.writeFileSync(files.configFile, draft.configText, {flag: 'wx'});
  fs.writeFileSync(files.requestFile, draft.requestText, {flag: 'wx'});
}

function stepSummary(inputs) {
  return [
    {step: 'export', title: '导出 PCK', detail: `预设「${inputs.preset}」→ ${inputs.exportOutput}`, note: '会更新游戏工程的导入缓存（.godot、.import、.uid），不改场景和脚本'},
    {step: 'convert', title: '官方转换', detail: `完整模板 · ${inputs.settings.glx ? 'GLX' : 'WebGL'} · ${inputs.settings.orientation === 'portrait' ? '竖屏' : '横屏'} → ${inputs.convertOutput}`},
    {step: 'open', title: '在开发者工具中打开', detail: inputs.settings.appidFrom ? `AppID 来自 ${inputs.settings.appidFrom}` : '使用占位 AppID（设置 appidFrom 可绑定真实 AppID）', optional: true},
  ];
}

/**
 * 只读检查。导出步骤会在系统临时目录生成草稿并跑一次共用计划，
 * 因此能提前发现编辑器指纹、预设、磁盘余量等问题；转换计划依赖导出产物，留到执行时再做。
 */
export async function quickPlan(options, {service = createTaskService()} = {}) {
  const inputs = resolveQuickInputs(options);
  const result = {schema: 'wxslim-quick-plan-v1', ready: false, project: inputs.project, settingsFile: inputs.settingsFile,
    name: inputs.name, editor: inputs.editor, release: inputs.release?.root ?? null, run: inputs.run, steps: stepSummary(inputs),
    blockers: inputs.blockers, exportPlan: null, writes: 'NONE_IN_PROJECT_OR_OUTPUT'};
  if (inputs.blockers.length) return result;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-plan-'));
  try {
    const files = {configFile: path.join(scratch, 'export-config.json'), requestFile: path.join(scratch, 'export-request.json')};
    // 只读检查时运行目录尚未创建；把导出目标放在输出目录下同名位置，使「父目录已存在」的检查可以照常进行。
    const probe = {...inputs, exportOutput: inputs.run};
    writeDraft(buildExportRequestDraft({editorExecutable: inputs.editor}, exportPayload(probe), files), files);
    const plan = await service.plan(files.requestFile);
    result.exportPlan = {eligible: plan.eligible === true, planSha256: taskPlanIdentity(plan)};
    if (plan.eligible !== true) result.blockers.push(blocker('QUICK_EXPORT_PLAN_INELIGIBLE', '共用导出计划未通过，详见 exportPlanDetail'));
    result.exportPlanDetail = plan;
  } catch (e) {
    result.blockers.push(blocker(e.code || 'QUICK_EXPORT_PLAN_FAILED', '共用导出计划未通过：' + (e.code || e.message)));
  } finally {
    fs.rmSync(scratch, {recursive: true, force: true});
  }
  result.ready = result.blockers.length === 0;
  return result;
}

async function planAndExecute(service, requestFile, step, report) {
  report({step, phase: 'plan'});
  const plan = await service.plan(requestFile);
  if (plan.eligible !== true) throw Object.assign(quickError('QUICK_PLAN_INELIGIBLE', `${step} 的共用计划未通过`), {plan});
  const planSha256 = taskPlanIdentity(plan);
  report({step, phase: 'execute', planSha256});
  const outcome = await service.execute(requestFile, {write: true, expectedPlanSha256: planSha256});
  report({step, phase: 'done', status: outcome.status, taskId: outcome.taskId});
  if (outcome.status !== 'SUCCESS') throw Object.assign(quickError('QUICK_TASK_NOT_SUCCESS', `${step} 未成功：${outcome.status}`), {outcome});
  return {planSha256, outcome};
}

/** 执行：新建本次运行目录，依次导出、转换，可选打开开发者工具。任一步失败即停止，不重试、不回滚。 */
export async function quickRun(options, {service = createTaskService(), openProject = null, report = () => {}} = {}) {
  const inputs = resolveQuickInputs(options);
  if (inputs.blockers.length) return {schema: 'wxslim-quick-run-v1', status: 'BLOCKED', blockers: inputs.blockers, writes: 'NONE'};
  const result = {schema: 'wxslim-quick-run-v1', status: 'RUNNING', run: inputs.run, steps: {}};
  try {
    fs.mkdirSync(inputs.run);
    fs.mkdirSync(inputs.requests);
    const exportFiles = {configFile: path.join(inputs.requests, 'export-config.json'), requestFile: path.join(inputs.requests, 'export-request.json')};
    writeDraft(buildExportRequestDraft({editorExecutable: inputs.editor}, exportPayload(inputs), exportFiles), exportFiles);
    result.steps.export = await planAndExecute(service, exportFiles.requestFile, 'export', report);
    const pck = path.join(inputs.exportOutput, 'full.pck');
    if (!isFile(pck)) throw quickError('QUICK_PCK_MISSING', '导出成功但没有找到 full.pck');
    const convertFiles = {configFile: path.join(inputs.requests, 'convert-config.json'), requestFile: path.join(inputs.requests, 'convert-request.json')};
    writeDraft(buildOfficialConvertRequestDraft(convertPayload(inputs, pck), convertFiles), convertFiles);
    result.steps.convert = await planAndExecute(service, convertFiles.requestFile, 'convert', report);
    const projectConfig = path.join(inputs.convertOutput, 'converted', 'minigame', 'project.config.json');
    if (!isFile(projectConfig)) throw quickError('QUICK_MINIGAME_MISSING', '转换成功但没有找到 project.config.json');
    result.projectConfig = projectConfig;
    if (openProject) {
      report({step: 'open', phase: 'execute'});
      result.steps.open = openProject(projectConfig, inputs.settings.appidFrom);
      report({step: 'open', phase: 'done'});
    }
    result.status = 'SUCCESS';
  } catch (e) {
    result.status = 'FAILED';
    result.error = {code: e.code || 'QUICK_RUN_FAILED', message: e.message, ...(e.outcome ? {task: e.outcome} : {}), ...(e.plan ? {plan: e.plan} : {})};
    result.note = '已写入的目录和任务记录保留在本次运行目录中，不自动清理或重试。';
  }
  return result;
}
