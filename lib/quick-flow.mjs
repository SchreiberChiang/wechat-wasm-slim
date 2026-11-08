// 快速流程：把一份很小的项目设置翻译成现有的「PCK 导出」和「官方转换」请求，
// 再交给共用任务核心按「计划 → 带计划摘要执行」运行。
//
// 这里不新增任何放行规则：草稿由面板同款表单生成器产出，路径冲突、已有输出、
// 预算、编辑器指纹、引擎配对和转换器指纹全部仍由 task-core 及各执行器检查。
// 快速流程只负责：找安装版里的固定文件、选默认值、建本次运行目录、把两步串起来。
import fs from 'node:fs';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createTaskService, taskPlanIdentity} from './task-core.mjs';
import {readTaskEventProgress} from './task-events.mjs';
import {isPluginEnabled} from './godot-plugin-state.mjs';
import {scanRemovedClasses, describeHits} from './pck-feature-scan.mjs';
import {refreshMinigamePck} from './pck-refresh.mjs';
import {resolveDevtools, openWeChatProject} from '../editor/workbench/open-project.mjs';
import {buildExportRequestDraft} from '../editor/workbench/export-request-form.mjs';
import {buildOfficialConvertRequestDraft} from '../editor/workbench/official-convert-request-form.mjs';
import {OFFICIAL_C050_CAPABILITY_PROFILE} from '../convert/lib/official-engine-admission.mjs';
import {CUSTOM_PAIR_PROFILE} from './custom-pair-task.mjs';
import {planCustomProjectUsage} from '../convert/lib/custom-project-usage.mjs';
import {customModuleSelection} from '../engine/custom-module-selection.mjs';
import {normalizeCustomWasmRequest} from '../engine/custom-wasm-plan.mjs';
import {inspectPck} from './pck-inventory.mjs';
import {PCK_PARTITION_LIMIT_BYTES} from './pck-partition.mjs';
import {loadBundledFingerprint} from '../convert/lib/bundled-pair.mjs';
import {readPreparedSource} from '../convert/lib/official-custom-context.mjs';
import {buildResourcePartitionRequestDraft} from '../editor/workbench/resource-request-form.mjs';
import {buildResourceRuntimeDraft} from '../editor/workbench/resource-runtime-form.mjs';
import {inspectResourceProjectSource} from './resource-project-source-plan.mjs';
import {sceneSourceGraph, sceneOwnership, planScenePacks, scenePackResourceConfig, SCENE_PACK_ROOT} from './scene-packs.mjs';
import {packageSizeReport} from './package-size.mjs';
import {setPckBoolSetting, SKIP_PREWARM_SETTING} from './pck-project-setting.mjs';

const MiB = 1024 * 1024;
export const QUICK_SETTINGS_SCHEMA = 'wxslim-quick-settings-v1';
export const DEFAULT_SETTINGS_NAME = 'wxslim-export.json';
export const runtimeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SIMPLE_INTERFACES = path.join(runtimeRoot, 'convert', 'assets', 'simple-delivery-interface.js');

export const DEVTOOLS_ASSEMBLER = path.join(runtimeRoot, 'convert', 'assemble-devtools-device.mjs');

// locale 默认 zh_CN：同包电脑预览工具只接受固定 c050 的 zh_CN 转换结果。
const DEFAULTS = Object.freeze({
  template: '', orientation: 'portrait', glx: true, skipPrewarm: false, subpackages: 'none', scenes: [],
  appid: '', appidFrom: '', gameName: '', output: '', locale: 'zh_CN', devtoolsPreview: true, devtools: '',
  exportBudgetMiB: 128, importCacheBudgetMiB: 256, largePck: false, loginCode: false, confirmNo3d: false, confirmRemovedModules: false, pairProof: '', rebuiltPreparation: '',
});
const TYPES = {
  template: 'string', orientation: 'string', glx: 'boolean', skipPrewarm: 'boolean', subpackages: 'string', scenes: 'array',
  appid: 'string', appidFrom: 'string', gameName: 'string', output: 'string', locale: 'string', devtoolsPreview: 'boolean', devtools: 'string',
  exportBudgetMiB: 'number', importCacheBudgetMiB: 'number', largePck: 'boolean', loginCode: 'boolean', confirmNo3d: 'boolean', confirmRemovedModules: 'boolean', pairProof: 'string', rebuiltPreparation:'string',
};

// 模板 → 安装版 profiles.json 里的配对。2D 用自建纯 2D 配对：随附引擎由安装版内的固定指纹单核验，
// 每次转换还要一份绑定本次启动 PCK 的功能声明（被移除的 3D 功能游戏没有用到），由作者在设置里确认。
export const TEMPLATE_PAIRS = Object.freeze({full: 'full', conservative: 'conservative', '2d': 'pure-2d'});
export const CONSERVATIVE_MODULES = Object.freeze(['enet', 'fbx', 'gltf', 'mobile_vr', 'upnp', 'vhacd', 'webxr']);
const TEMPLATE_NAMES = {full:'完整', conservative:'保守', '2d':'纯 2D'};
export const PURE_2D_FEATURES = Object.freeze({schema: 'wxslim-custom-wasm-plan-v1', dimensions: '2d', disabledModules: [], disabledClasses: []});
/** 2D 模板相对完整模板移除的引擎模块（不读 PCK，用于提示）。 */
export function pure2dRemovedModules() {
  const modules = customModuleSelection(normalizeCustomWasmRequest(PURE_2D_FEATURES));
  return [...new Set([...modules.explicitDisabledModules, ...modules.additionalRemovedFromFull])].sort();
}

function quickError(code, message) {
  return Object.assign(Error(message), {code});
}
const typeOf = value => Array.isArray(value) ? 'array' : typeof value;
const blocker = (code, message, field) => ({code, message, ...(field ? {field} : {})});

export function templateRequirements(template) {
  if (!Object.hasOwn(TEMPLATE_PAIRS, template)) throw quickError('QUICK_TEMPLATE_UNKNOWN', '无法识别所选模板');
  const confirmations = [];
  if (template === '2d') confirmations.push({field:'confirmNo3d', removed3d:true, removedModules:pure2dRemovedModules()});
  if (template === 'conservative') confirmations.push({field:'confirmRemovedModules', removed3d:false, removedModules:[...CONSERVATIVE_MODULES]});
  return {schema:'wxslim-template-requirements-v1', template, name:TEMPLATE_NAMES[template],
    pair:TEMPLATE_PAIRS[template], confirmations, automaticInputs:['js','wasm','transformer','interfaces',
      ...(confirmations.length ? ['customPreparation','projectUsage'] : [])]};
}

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
  for (const key of ['template', 'appid', 'appidFrom', 'gameName', 'output', 'locale', 'pairProof', 'rebuiltPreparation', 'devtools']) settings[key] = settings[key].trim();
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
  if (!settings.template) list.push(blocker('QUICK_TEMPLATE_MISSING', '未选择模板（template：full / conservative / 2d）', 'template'));
  else if (settings.template === 'custom')
    list.push(blocker('QUICK_TEMPLATE_CUSTOM_PENDING', '自定义模板需要重新编译引擎，快速流程暂不支持；请选择已提供的模板', 'template'));
  else if (!Object.hasOwn(TEMPLATE_PAIRS, settings.template)) list.push(blocker('QUICK_TEMPLATE_UNKNOWN', `未知模板 ${settings.template}`, 'template'));
  if (settings.template === '2d' && settings.confirmNo3d !== true)
    list.push(blocker('QUICK_2D_NEEDS_CONFIRMATION', '2D 模板会移除 3D 功能（' + pure2dRemovedModules().join('、') + '）。确认游戏没有用到后，在设置里勾选确认（confirmNo3d: true）', 'confirmNo3d'));
  if (settings.template === 'conservative' && settings.confirmRemovedModules !== true)
    list.push({code:'QUICK_CONSERVATIVE_NEEDS_CONFIRMATION', field:'confirmRemovedModules',
      message:'请确认游戏未使用保守配方移除的模块：'+CONSERVATIVE_MODULES.join('、')});
  if (!['portrait', 'landscape'].includes(settings.orientation)) list.push(blocker('QUICK_ORIENTATION', 'orientation 只能是 portrait 或 landscape', 'orientation'));
  if (settings.skipPrewarm && settings.template === 'full') list.push(blocker('QUICK_PREWARM_FULL', '完整模板保留启动时的默认 3D 预热，不能跳过；跳过预热只在保守和 2D 模板可用', 'skipPrewarm'));
  if (settings.subpackages === 'scenes') {
    if (!settings.scenes.length) list.push(blocker('QUICK_SCENES_EMPTY', '选了按场景分包，但还没有添加要延后下载的场景', 'scenes'));
    else if (settings.scenes.length > 64 || settings.scenes.some(s => typeof s !== 'string' || !/^res:\/\/.+\.(tscn|scn)$/i.test(s)))
      list.push(blocker('QUICK_SCENES_PATH', '分包场景必须是 res:// 开头的 .tscn 或 .scn 文件，最多 64 个', 'scenes'));
  } else if (settings.subpackages !== 'none') list.push(blocker('QUICK_SUBPACKAGES_UNKNOWN', 'subpackages 只能是 none 或 scenes', 'subpackages'));
  if (!settings.output) list.push(blocker('QUICK_OUTPUT_MISSING', '未设置输出目录（output）', 'output'));
  else if (!path.isAbsolute(settings.output)) list.push(blocker('QUICK_OUTPUT_RELATIVE', '输出目录必须是绝对路径', 'output'));
  else if (!isDirectory(settings.output)) list.push(blocker('QUICK_OUTPUT_NOT_FOUND', `输出目录不存在：${settings.output}`, 'output'));
  if (!/^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/.test(settings.locale)) list.push(blocker('QUICK_LOCALE_FORMAT', '语言写法不对，例如 zh_CN 或 en', 'locale'));
  if (settings.loginCode && settings.template && settings.template !== 'full')
    list.push(blocker('QUICK_LOGIN_CODE_TEMPLATE', '登录 code 目前只在完整模板上接通，请换成完整模板或关闭登录 code', 'loginCode'));
  // 分包组装要求转换后的接口文件与分包接口逐字节相同，追加登录适配后核对不过。
  if (settings.loginCode && settings.subpackages === 'scenes')
    list.push(blocker('QUICK_LOGIN_CODE_SCENES', '登录 code 和按场景分包暂时不能同时用，请先关掉其中一个', 'loginCode'));
  if (settings.appid && !/^wx[0-9a-f]{16}$/.test(settings.appid)) list.push(blocker('QUICK_APPID_FORMAT', 'AppID 格式应为 wx 加 16 位小写十六进制', 'appid'));
  if (settings.appidFrom && !(path.isAbsolute(settings.appidFrom) && isFile(settings.appidFrom)))
    list.push(blocker('QUICK_APPID_SOURCE', `AppID 来源文件不存在：${settings.appidFrom}`, 'appidFrom'));
  if (settings.devtools)
    try { resolveDevtools(settings.devtools); } catch (e) { list.push(blocker(e.code, e.message, 'devtools')); }
  if (previewEnabled(settings)) {
    if (!settings.appidFrom) list.push(blocker('QUICK_PREVIEW_NEEDS_APPID_SOURCE', '电脑预览包需要 AppID 来源：在设置里填 appidFrom（已有小游戏的 project.config.json），或设 devtoolsPreview: false', 'appidFrom'));
    if (settings.locale !== 'zh_CN') list.push(blocker('QUICK_PREVIEW_LOCALE', '电脑预览包只支持 locale: "zh_CN"，或设 devtoolsPreview: false', 'locale'));
  }
  if (!Number.isSafeInteger(settings.exportBudgetMiB) || settings.exportBudgetMiB < 8 || settings.exportBudgetMiB > 272)
    list.push(blocker('QUICK_EXPORT_BUDGET', 'exportBudgetMiB 需在 8 到 272 之间', 'exportBudgetMiB'));
  if (!Number.isSafeInteger(settings.importCacheBudgetMiB) || settings.importCacheBudgetMiB < 0 || settings.importCacheBudgetMiB > 4096)
    list.push(blocker('QUICK_IMPORT_BUDGET', 'importCacheBudgetMiB 需在 0 到 4096 之间', 'importCacheBudgetMiB'));
  return list;
}

/** GLX 包在电脑开发者工具里无法渲染，因此 GLX 时默认再生成一个「电脑走 WebGL2、真机走 GLX」的同包预览。 */
export function previewEnabled(settings) {
  return settings.glx === true && settings.devtoolsPreview === true;
}

/** 主场景：res:// 路径直接用；uid:// 时在工程场景文件头里查找对应路径。 */
export function resolveMainScene(projectDir, projectFileText) {
  const match = /^run\/main_scene\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(projectFileText);
  if (!match) return '';
  const value = JSON.parse(`"${match[1]}"`);
  if (value.startsWith('res://')) return value;
  if (!value.startsWith('uid://')) return '';
  const found = [];
  const visit = (dir, depth) => {
    if (depth > 16 || found.length) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file, depth + 1);
      else if (entry.name.endsWith('.tscn')) {
        const head = fs.readFileSync(file, 'utf8').slice(0, 512);
        if (head.includes(`uid="${value}"`)) found.push('res://' + path.relative(projectDir, file).split(path.sep).join('/'));
      }
    }
  };
  visit(projectDir, 0);
  return found[0] ?? '';
}

/** 不分包的游戏也用资源配置描述：只有一个启动包，即导出的完整 PCK。 */
export function bootOnlyResourceConfig(pck, entryScene, sha256, bytes) {
  return {schema: 'wxslim-resource-packs-v1',
    packs: [{id: 'boot', role: 'boot', file: pck, bytes, sha256, requires: [], entryScene}],
    dependencies: [], reservedRoots: [], reservedNames: []};
}

function assembleDevtoolsPreview({convertOutput, packsFile, output, appidFrom}) {
  const result = spawnSync(process.execPath, [DEVTOOLS_ASSEMBLER, convertOutput, packsFile, output, appidFrom, '--write'],
    {encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 4 * MiB});
  if (result.error || result.status !== 0) {
    const tail = String(result.stderr || result.error || '').trim().split(/\r?\n/).slice(-3).join(' | ');
    throw quickError('QUICK_DEVTOOLS_ASSEMBLY_FAILED', '电脑预览包生成失败：' + tail);
  }
  return JSON.parse(String(result.stdout).trim().split(/\r?\n/).pop());
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

// Keep the original public call signature for panels with saved proof settings.
export function resolvePairProof(release, _explicit = '', _env = process.env, pair = 'pure-2d') {
  if (!['pure-2d','conservative'].includes(pair)) throw quickError('QUICK_TEMPLATE_UNKNOWN','配对类型无效');
  const file = path.join(release, 'engines', pair, 'fingerprint.json');
  try { loadBundledFingerprint(file, pair); }
  catch { throw quickError('QUICK_PAIR_FINGERPRINT', '安装版的 ' + pair + ' 引擎指纹单缺失或不匹配，请检查安装版路径。'); }
  return file;
}

/** 安装版位置：显式参数；安装版 runtime 的上一级；源码旁边的 release 目录。 */
export function resolveRelease(explicit = '', template = 'full') {
  const candidates = explicit ? [path.resolve(explicit)] : [path.dirname(runtimeRoot), path.join(path.dirname(runtimeRoot), 'release')];
  const root = candidates.find(dir => isFile(path.join(dir, 'RELEASE.json')) && isFile(path.join(dir, 'profiles.json')));
  if (!root) throw quickError('QUICK_RELEASE_NOT_FOUND', '找不到安装版目录（需含 RELEASE.json 和 profiles.json），可用 --release 指定');
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'profiles.json'), 'utf8'));
  const key = TEMPLATE_PAIRS[template] ?? 'full';
  const full = profiles?.pairs?.[key];
  const expected = key === 'full' ? {profile: OFFICIAL_C050_CAPABILITY_PROFILE, prepared: false} : {profile: CUSTOM_PAIR_PROFILE, prepared: true};
  if (full?.profile !== expected.profile || full.requiresPreparedSource !== expected.prepared)
    throw quickError('QUICK_RELEASE_PAIR', `安装版缺少${TEMPLATE_NAMES[template]}模板配对`);
  const transformers = Object.keys(profiles.files || {}).filter(name => /^tools\/wx-transformer-[^/]+\.exe$/.test(name));
  if (transformers.length !== 1) throw quickError('QUICK_RELEASE_TRANSFORMER', '安装版中应恰好有一个微信转换器');
  const resolved = {
    root, profile: full.profile, pair: key,
    js: path.join(root, ...full.js.split('/')), wasm: path.join(root, ...full.wasm.split('/')),
    transformer: path.join(root, ...transformers[0].split('/')),
    prewarmSkippable: full.startupPrewarmSkippable === true,
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
  throw quickError('QUICK_EDITOR_NOT_FOUND', '找不到 Godot 编辑器：用 --editor 指定，或设置 WXSLIM_GODOT_EDITOR，或先在游戏里启用微信导出插件');
}

export function runName(name, date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const slug = (name || 'game').replace(/[\\/:*?"<>|\s.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game';
  return `${slug}-${stamp}`;
}

/**
 * 输出目录与游戏工程、编辑器、安装版不能互相包含。共用导出任务也会拒绝
 * （PCK_EXPORT_OUTPUT_OVERLAP），这里提前给出能看懂的提示并指向 output 设置。
 */
export function outputOverlapBlockers(output, projectDir, editor = '', releaseRoot = '') {
  const real = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const norm = p => process.platform === 'win32' ? real(p).toLowerCase() : real(p);
  const within = (parent, child) => { const rel = path.relative(norm(parent), norm(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  const list = [];
  if (within(projectDir, output))
    list.push(blocker('QUICK_OUTPUT_INSIDE_PROJECT', `输出目录在游戏工程里面，导出时会把上次的输出也打进游戏包。请选一个游戏工程之外的文件夹：${output}`, 'output'));
  else if (within(output, projectDir))
    list.push(blocker('QUICK_OUTPUT_CONTAINS_PROJECT', `游戏工程在输出目录里面。请为输出单独选一个文件夹，不要选游戏工程的上级目录：${output}`, 'output'));
  if (editor && within(output, editor))
    list.push(blocker('QUICK_OUTPUT_CONTAINS_EDITOR', `Godot 编辑器在输出目录里面，请另选输出文件夹：${output}`, 'output'));
  if (releaseRoot && (within(releaseRoot, output) || within(output, releaseRoot)))
    list.push(blocker('QUICK_OUTPUT_OVERLAPS_RELEASE', `输出目录与插件安装版目录重叠，请另选输出文件夹：${output}`, 'output'));
  return list;
}

/** 分包加载脚本（WxResource 自动加载和 4 个脚本）在游戏工程里的状态：installed / missing / conflict。 */
export function receiverStatus(projectFile) {
  try {
    const plan = inspectResourceProjectSource(projectFile);
    if (plan.status === 'ALREADY_MATCHED_NOT_RUNTIME_PROOF') return {state: 'installed', plan};
    if (plan.status === 'BLOCKED') return {state: 'conflict', plan};
    return {state: 'missing', plan};
  } catch (e) {
    return {state: 'conflict', error: e.code || 'RESOURCE_PROJECT_SOURCE_FAILED'};
  }
}

function receiverBlockers(projectFile) {
  const status = receiverStatus(projectFile);
  if (status.state === 'installed') return [];
  if (status.state === 'missing')
    return [blocker('QUICK_RECEIVER_MISSING', '按场景分包要先往游戏里装分包加载脚本（WxResource）。在面板点「装分包加载脚本」，或运行 quick receiver 游戏目录 --write', 'receiver')];
  return [blocker('QUICK_RECEIVER_CONFLICT', '游戏里已有同名的分包加载脚本或 WxResource 自动加载，但内容和插件的不一样。请先手动移除或改名后再试', 'receiver')];
}

/**
 * 往游戏工程装分包加载脚本：走共用任务 resource-project-install（只新建缺少的 4 个脚本、在 project.godot 插入 WxResource 自动加载，
 * 不覆盖已有文件、不回滚）。不加 write 时只返回将要写入的内容。任务记录写在输出目录下新的 *-receiver 目录。
 */
export async function installReceiver({project, settingsFile = '', now = new Date(), write = false}, {service = createTaskService()} = {}) {
  const projectDir = path.resolve(project), projectFile = path.join(projectDir, 'project.godot');
  if (!isFile(projectFile)) throw quickError('QUICK_PROJECT_NOT_FOUND', `不是 Godot 工程目录：${projectDir}`);
  const result = {schema: 'wxslim-quick-receiver-v1', project: projectDir};
  const status = receiverStatus(projectFile);
  if (status.state === 'installed') return {...result, status: 'ALREADY_INSTALLED', writes: 'NONE'};
  if (status.state === 'conflict') return {...result, status: 'BLOCKED', blockers: receiverBlockers(projectFile), writes: 'NONE'};
  const planned = status.plan.plannedWrites.map(w => ({path: w.path, action: w.action === 'CREATE' ? '新建' : '插入自动加载 WxResource'}));
  const settings = loadQuickSettings(settingsFile ? path.resolve(settingsFile) : path.join(projectDir, DEFAULT_SETTINGS_NAME));
  const blockers = [];
  if (!settings.output || !path.isAbsolute(settings.output) || !isDirectory(settings.output))
    blockers.push(blocker('QUICK_OUTPUT_NOT_FOUND', '装加载脚本前先选好输出目录（任务记录会写在那里）', 'output'));
  else blockers.push(...outputOverlapBlockers(settings.output, projectDir));
  if (blockers.length) return {...result, status: 'BLOCKED', blockers, planned, writes: 'NONE'};
  if (!write) return {...result, status: 'PLANNED', planned, writes: 'NONE'};
  const name = settings.gameName || projectName(fs.readFileSync(projectFile, 'utf8')) || path.basename(projectDir);
  const dir = path.join(settings.output, runName(name, now) + '-receiver');
  fs.mkdirSync(dir);
  const requests = path.join(dir, 'requests');
  fs.mkdirSync(requests);
  const files = {configFile: path.join(requests, 'install-config.json'), requestFile: path.join(requests, 'install-request.json')};
  writeDraft(buildResourceRuntimeDraft('install', {projectFile, output: path.join(dir, 'task'), budgetBytes: 8 * MiB, allowProjectWrites: true}, files), files);
  const plan = await service.plan(files.requestFile);
  if (plan.eligible !== true) return {...result, status: 'FAILED', run: dir, error: {code: 'QUICK_RECEIVER_PLAN_INELIGIBLE', message: '装加载脚本的检查没通过，游戏工程没有改动', field: 'receiver'}};
  const outcome = await service.execute(files.requestFile, {write: true, expectedPlanSha256: taskPlanIdentity(plan)});
  return {...result, status: outcome.status === 'SUCCESS' ? 'INSTALLED' : 'FAILED', run: dir, planned, taskId: outcome.taskId,
    ...(outcome.status === 'SUCCESS' ? {} : {error: {code: 'QUICK_RECEIVER_FAILED', reasonCode: outcome.failureCode, message: '装加载脚本没有完成，已写入的文件保留，请查看任务记录', field: 'receiver'}})};
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
    blockers.push(blocker('QUICK_WEB_PRESET', presets.length ? `工程有 ${presets.length} 个 Web 导出预设，快速流程需要恰好一个` : '工程缺少 Web 导出预设（在 Godot「项目 → 导出」中添加 Web 预设）', 'exportPreset'));
  const projectText = fs.readFileSync(projectFile, 'utf8');
  // 面板的导出过滤由插件注册；装了却没启用时，插件脚本会被打进游戏包。
  if (fs.existsSync(path.join(projectDir, 'addons', 'wxslim_readonly')) && !isPluginEnabled(projectText))
    blockers.push(blocker('QUICK_PLUGIN_NOT_ENABLED', '游戏里装了微信导出插件但没有启用，导出会把插件脚本打进游戏包。请在 Godot「项目 → 项目设置 → 插件」中启用它，启用后插件会自动完成准备', 'plugin'));
  const name = settings.gameName || projectName(projectText) || path.basename(projectDir);
  const preview = previewEnabled(settings);
  const scenesMode = settings.subpackages === 'scenes';
  const mainScene = preview || scenesMode ? resolveMainScene(projectDir, projectText) : '';
  if (scenesMode && !mainScene) blockers.push(blocker('QUICK_SCENES_MAIN_SCENE', '按场景分包需要工程设置了主场景（项目设置 → 应用 → 运行 → 主场景），首包从它启动', 'mainScene'));
  if (scenesMode) blockers.push(...receiverBlockers(projectFile));
  if (scenesMode && settings.scenes.length && !blockers.some(b => b.field === 'scenes')) {
    try { sceneOwnership(sceneSourceGraph(projectDir), settings.scenes, mainScene); }
    catch (e) { if (!e.field) throw e; blockers.push(blocker(e.code, e.message, e.field)); }
  }
  if (preview && !mainScene && !scenesMode) blockers.push(blocker('QUICK_MAIN_SCENE', '电脑预览包需要工程设置了主场景（项目设置 → 应用 → 运行 → 主场景）', 'mainScene'));
  if (preview && !isFile(DEVTOOLS_ASSEMBLER)) blockers.push(blocker('QUICK_DEVTOOLS_ASSEMBLER_MISSING', `缺少同包预览工具：${DEVTOOLS_ASSEMBLER}`, 'release'));
  let editorPath = '', releaseInfo = null;
  try { editorPath = resolveEditor(projectDir, editor, env); } catch (e) { blockers.push(blocker(e.code, e.message, 'editor')); }
  try { releaseInfo = resolveRelease(release, settings.template); } catch (e) { blockers.push(blocker(e.code, e.message, 'release')); }
  if (settings.skipPrewarm && settings.template !== 'full' && releaseInfo && !releaseInfo.prewarmSkippable)
    blockers.push(blocker('QUICK_PREWARM_UNSUPPORTED', '这个安装版里的引擎还不能跳过预热，请换成新版插件', 'skipPrewarm'));
  let pairProof = '';
  if (releaseInfo?.profile === CUSTOM_PAIR_PROFILE && !settings.rebuiltPreparation)
    try { pairProof = resolvePairProof(releaseInfo.root, settings.pairProof, env, releaseInfo.pair); } catch (e) { blockers.push(blocker(e.code, e.message, 'release')); }
  if (!isFile(SIMPLE_INTERFACES)) blockers.push(blocker('QUICK_INTERFACES_MISSING', `缺少默认接口文件：${SIMPLE_INTERFACES}`, 'release'));
  if (settings.output && path.isAbsolute(settings.output) && isDirectory(settings.output))
    blockers.push(...outputOverlapBlockers(settings.output, projectDir, editorPath, releaseInfo?.root));
  const run =settings.output && path.isAbsolute(settings.output) ? path.join(settings.output, runName(name, now)) : '';
  return {
    project: projectDir, settingsFile: file, settings, name, preset: presets.length === 1 ? presets[0] : '',
    editor: editorPath, release: releaseInfo, interfaces: SIMPLE_INTERFACES, blockers, preview, mainScene, pairProof,
    run, exportOutput: run && path.join(run, 'pck'), convertOutput: run && path.join(run, 'wechat'), requests: run && path.join(run, 'requests'),
    previewOutput: run && preview ? path.join(run, 'devtools') : '',
    scenes: scenesMode, splitOutput: run && scenesMode ? path.join(run, 'split') : '',
    interfacesOutput: run && scenesMode ? path.join(run, 'interfaces') : '',
    assembleOutput: run && scenesMode && !preview ? path.join(run, 'final') : '',
  };
}

export function exportPayload(inputs) {
  return {
    project: inputs.project, preset: inputs.preset, output: inputs.exportOutput,
    budgetBytes: inputs.settings.exportBudgetMiB * MiB, cacheGrowthBudgetBytes: inputs.settings.importCacheBudgetMiB * MiB,
    allowImportWrites: true,
  };
}

function templateFeatures(pair) {
  if (pair==='pure-2d') return PURE_2D_FEATURES;
  return {...PURE_2D_FEATURES,dimensions:'3d',disabledModules:pair==='conservative' ? [...CONSERVATIVE_MODULES] : []};
}

async function resolveTaskInputs(options) {
  const inputs = resolveQuickInputs(options);
  if (inputs.blockers.length || !inputs.settings.rebuiltPreparation) return inputs;
  const file = path.resolve(path.dirname(inputs.settingsFile),inputs.settings.rebuiltPreparation);
  const field = 'rebuiltPreparation';
  try {
    const config = readJson(file,65536);
    if (!config || !['wxslim-rebuilt-capability-pair-v1','wxslim-custom-pair-preparation-v1'].includes(config.schema))
      throw quickError('QUICK_REBUILT_CONFIG','重建配对需要此次源码构建生成的配对准备文件。');
    const base = path.dirname(file), raw = path.resolve(base,config.rawTaskRoot);
    const terminal = readJson(path.join(raw,'terminal.json'));
    if (terminal?.status!=='SUCCESS' || terminal.taskId!==config.rawTaskId)
      throw quickError('QUICK_REBUILT_TASK','重建配对需要原始引擎任务成功完成并捕获产物。');
    const prepared = await readPreparedSource(file);
    const {summary} = prepared, pair = inputs.release.pair;
    const expectedSchema = pair==='pure-2d' ? 'wxslim-custom-pair-preparation-v1' : 'wxslim-rebuilt-capability-pair-v1';
    if (config.schema!==expectedSchema || summary.taskId!==terminal.taskId || summary.retainedFixed || summary.retainedEvidence ||
        (pair!=='pure-2d' && summary.moduleProfile!==pair) ||
        !isDeepStrictEqual(normalizeCustomWasmRequest(summary.features),normalizeCustomWasmRequest(templateFeatures(pair))))
      throw quickError('QUICK_REBUILT_TEMPLATE','引擎配方或裁剪项与当前选择的模板不一致。');
    // The offline builder captures all three fresh recipes under this raw task's artifacts directory.
    const wasm = path.join(raw,'artifacts','godot.wasm'), js = path.resolve(base,config.outputJs);
    for (const [actual,pin] of [[wasm,summary.inputs.wasm],[js,summary.outputJs]]) {
      const stat = fs.lstatSync(actual);
      if (!stat.isFile() || path.relative(fs.realpathSync(actual),actual)!=='' || stat.size!==pin.bytes ||
          createHash('sha256').update(fs.readFileSync(actual)).digest('hex')!==pin.sha256)
        throw quickError('QUICK_REBUILT_BYTES','重建配对的 JS 或 WASM 与审核收据不一致。');
    }
    inputs.release = {...inputs.release,profile:CUSTOM_PAIR_PROFILE,js,wasm};
    inputs.pairProof = file;
    inputs.rebuiltEngine = {pair,taskId:summary.taskId,wasmSha256:summary.inputs.wasm.sha256};
  } catch (e) {
    const known = typeof e.code==='string' && e.code.startsWith('QUICK_REBUILT_');
    inputs.blockers.push(blocker(known ? e.code : 'QUICK_REBUILT_REVIEW',known ? e.message : '重建配对的原始输入或来源收据未通过复核。',field));
  }
  return inputs;
}

/**
 * 保守和 2D 模板：在导出的 PCK 里找这个模板已经去掉的类（场景、资源、三种模式的脚本）。
 * 找到就停下并说明是哪些类、在哪些文件里；找不到时仍以作者的确认为准（运行时用字符串拼出的类名查不到）。
 */
export function checkRemovedClasses(template, pckFile) {
  if (!['2d', 'conservative'].includes(template)) return {applies: false};
  const scan = scanRemovedClasses(fs.readFileSync(pckFile), template);
  if (scan.hits.length) {
    const error = quickError('QUICK_REMOVED_CLASSES_USED', `游戏里用到了${{conservative: "保守模板", "2d": "2D 模板"}[template]}去掉的功能：${describeHits(scan)}。请换成完整模板，或从游戏里去掉这些用法。`);
    error.field = 'template';
    error.hits = scan.hits;
    throw error;
  }
  return {applies: true, hits: [], scanned: scan.scanned, unreadable: scan.unreadable};
}

/** 2D 模板：按本次启动 PCK 生成功能声明；removedFeaturesUnused 来自作者在设置里的确认。 */
export function pure2dUsage(pckBytes, confirmed) {
  const {declaration} = planCustomProjectUsage(PURE_2D_FEATURES, pckBytes);
  if (confirmed !== true) throw quickError('QUICK_2D_NEEDS_CONFIRMATION', '2D 模板需要先确认游戏没有用到被移除的 3D 功能');
  return {...declaration, removedFeaturesUnused: true};
}

export function convertPayload(inputs, pck, pckBytes = null, interfaces = inputs.interfaces) {
  const {settings, release} = inputs;
  const custom = release.profile === CUSTOM_PAIR_PROFILE;
  let projectUsage;
  if (custom && release.pair === 'conservative') {
    if (settings.confirmRemovedModules !== true) throw quickError('QUICK_CONSERVATIVE_NEEDS_CONFIRMATION','请确认游戏未使用保守配方移除的模块');
    projectUsage = {...planCustomProjectUsage(templateFeatures(release.pair),pckBytes).declaration, removedFeaturesUnused:true};
  } else if (custom && release.pair==='full' && inputs.rebuiltEngine) {
    const {declaration} = planCustomProjectUsage(templateFeatures('full'),pckBytes);
    if (declaration.engine3dRemoved || declaration.removedModules.length || declaration.disabledClasses.length)
      throw quickError('QUICK_REBUILT_TEMPLATE','完整版声明中存在裁剪项。');
    projectUsage = {...declaration,removedFeaturesUnused:true};
  } else if (custom) {
    projectUsage = pure2dUsage(pckBytes, settings.confirmNo3d);
  }
  return {
    engineProfile: release.profile, removedModules: null,
    ...(custom ? {customPreparation: inputs.pairProof, projectUsage} : {}),
    js: release.js, wasm: release.wasm, pck, transformer: release.transformer, interfaces,
    output: inputs.convertOutput, renderMode: settings.glx ? 'glx' : 'webgl', name: inputs.name,
    locale: settings.locale, orientation: settings.orientation,
    ...(settings.largePck ? {largePckBudget: true} : {}),
    ...(settings.loginCode ? {loginCode: true} : {}),
  };
}

function writeDraft(draft, files) {
  fs.writeFileSync(files.configFile, draft.configText, {flag: 'wx'});
  fs.writeFileSync(files.requestFile, draft.requestText, {flag: 'wx'});
}

function stepSummary(inputs) {
  return [
    {step: 'export', title: '导出 PCK', detail: `预设「${inputs.preset}」→ ${inputs.exportOutput}`, note: '会更新游戏工程的导入缓存（.godot、.import、.uid），不改场景和脚本'},
    ...(inputs.scenes ? [
      {step: 'split', title: '按场景拆包', detail: `${inputs.settings.scenes.length} 个场景各成一个分包，其余留在首包 → ${inputs.splitOutput}`,
        note: '只拆导出的 PCK，不改游戏工程；用字符串拼路径动态加载的资源分析不到，需要自己确认'},
      {step: 'interfaces', title: '生成分包接口', detail: `按拆出的包和引擎文件生成 interfaces.js → ${inputs.interfacesOutput}`},
    ] : []),
    {step: 'convert', title: '官方转换', ...(inputs.settings.template === '2d' ? {note: `纯 2D 引擎，移除 ${pure2dRemovedModules().join('、')}；转换时核对随附的引擎指纹`} : {}),
      detail: `${TEMPLATE_NAMES[inputs.settings.template]}模板 · ${inputs.settings.glx ? 'GLX' : 'WebGL'} · ${inputs.settings.orientation === 'portrait' ? '竖屏' : '横屏'} → ${inputs.convertOutput}`},
    ...(inputs.preview ? [{step: 'devtools', title: '生成电脑预览包', detail: `同一个包：开发者工具走 WebGL2，真机走 GLX → ${inputs.previewOutput}`,
      note: '预览包有自己的包号；真机 GLX 仍需单独验收'}] : []),
    ...(inputs.assembleOutput ? [{step: 'assemble', title: '组装分包', detail: `把各场景分包放进小游戏工程并登记到 game.json → ${inputs.assembleOutput}`}] : []),
    {step: 'open', title: '在开发者工具中打开', detail: inputs.settings.appidFrom ? `AppID 来自 ${inputs.settings.appidFrom}` : '需要先设置 appidFrom（已有小游戏的 project.config.json），开发者工具不接受占位 AppID', optional: true},
  ];
}

/**
 * 只读检查。导出步骤会在系统临时目录生成草稿并跑一次共用计划，
 * 因此能提前发现编辑器指纹、预设、磁盘余量等问题；转换计划依赖导出产物，留到执行时再做。
 */
export async function quickPlan(options, {service = createTaskService()} = {}) {
  const inputs = await resolveTaskInputs(options);
  const result = {schema: 'wxslim-quick-plan-v1', ready: false, project: inputs.project, settingsFile: inputs.settingsFile,
    name: inputs.name, editor: inputs.editor, release: inputs.release?.root ?? null, run: inputs.run, steps: stepSummary(inputs),
    blockers: inputs.blockers, exportPlan: null, writes: 'NONE_IN_PROJECT_OR_OUTPUT',
    ...(inputs.rebuiltEngine ? {rebuiltEngine:inputs.rebuiltEngine} : {})};
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

// 包体大小：按微信代码包限制统计开发者工具打开的那份工程。只做提示，统计失败也不影响导出。
function measurePackage(projectConfig) {
  try { return packageSizeReport(path.dirname(projectConfig)); }
  catch (e) { return {schema: 'wxslim-package-size-v1', ok: true, problems: [], lines: [], summary: `包体：没能统计（${e.message}）`}; }
}

// 跳过默认 3D 预热：引擎读 PCK 里的 startup/gles3/skip_default_3d_prewarm。不改游戏工程，只在导出的 PCK 副本里写这条设置。
function applySkipPrewarm(inputs, buffer) {
  if (!inputs.settings.skipPrewarm) return {pck: buffer, changed: false};
  return setPckBoolSetting(buffer, SKIP_PREWARM_SETTING, true);
}

// ---------- 只更新游戏资源 ----------
// 改了游戏、引擎和设置都没变时，只重新导出 PCK，直接替换进这次运行在开发者工具里打开的那份工程
// （电脑预览包、组包结果或转换结果），不再跑微信转换器，也不新建工程：开发者工具看到文件变化会自动重新编译。
// 旧版本留下的 RUN/live/minigame 仍按原样识别（它就是当时打开的工程）。

export const LIVE_DIR = 'live';
const REFRESH_LOG = 'REFRESH-LOG.json';

export function liveConfig(run) { return path.join(run, LIVE_DIR, 'minigame', 'project.config.json'); }

function refreshMismatch(inputs, config, render) {
  const want = {engineProfile: inputs.release.profile, renderMode: inputs.settings.glx ? 'glx' : 'webgl', name: inputs.name,
    locale: inputs.settings.locale, orientation: inputs.settings.orientation, loginCode: inputs.settings.loginCode === true,
    largePck: inputs.settings.largePck === true};
  const had = {engineProfile: config.engineProfile, renderMode: config.renderMode, name: config.name, locale: config.locale,
    orientation: config.orientation, loginCode: config.loginCode === true, largePck: Boolean(config.budgetBytes)};
  const labels = {engineProfile: '模板', renderMode: 'GLX', name: '游戏名', locale: '语言', orientation: '横竖屏', loginCode: '登录 code', largePck: '大 PCK'};
  const changed = Object.keys(want).filter(key => want[key] !== had[key]).map(key => labels[key]);
  if (!changed.length && createHash('sha256').update(fs.readFileSync(inputs.release.wasm)).digest('hex') !== render.wasmSha256) changed.push('插件引擎版本');
  return changed;
}

export async function quickRefresh(options, {service = createTaskService(), openProject = null, report = () => {}} = {}) {
  const base = {schema: 'wxslim-quick-refresh-v1'};
  const run = typeof options.run === 'string' && path.isAbsolute(options.run) ? options.run : '';
  const status = run ? quickRunStatus(run) : null;
  if (status?.status !== 'SUCCESS' || status.steps.convert !== 'SUCCESS' || !status.openTarget)
    return {...base, status: 'BLOCKED', blockers: [blocker('QUICK_REFRESH_RUN', '只更新游戏资源需要一次已完成的导出，请先点「导出并转换」', 'run')]};
  const inputs = await resolveTaskInputs(options);
  // 按场景分包：分包场景要和上次一样（包名、包数都由它决定）；拆出来的包名不一样时在拆包后再拦一次。
  const scenesRun = status.scenePacks.length > 0 || isFile(path.join(run, 'requests', 'split-request.json'));
  const previousScenes = status.scenePacks.map(p => p.scene).sort();
  const wantScenes = inputs.settings.subpackages === 'scenes' ? [...inputs.settings.scenes].sort() : [];
  if (scenesRun !== (inputs.settings.subpackages === 'scenes') || JSON.stringify(previousScenes) !== JSON.stringify(wantScenes))
    inputs.blockers.push(blocker('QUICK_REFRESH_SCENES', '分包设置（是否按场景分包、分包场景）和上次导出时不一样，请点「导出并转换」完整导出一次', 'subpackages'));
  if (openProject === openWeChatProject && !inputs.settings.devtools)
    try { resolveDevtools(''); } catch (e) { inputs.blockers.push(blocker(e.code, e.message, 'devtools')); }
  // 就是这次运行在开发者工具里打开的那份工程。
  const target = path.dirname(status.openTarget);
  const config = readJson(path.join(run, 'requests', 'convert-config.json'));
  const render = readJson(path.join(target,'godot-data', 'render-config.json'));
  if (!config || !render) inputs.blockers.push(blocker('QUICK_REFRESH_RUN', '找不到上次转换的记录，请完整导出一次', 'run'));
  else if (!inputs.blockers.length) {
    const changed = refreshMismatch(inputs, config, render);
    if (changed.length) inputs.blockers.push(blocker('QUICK_REFRESH_SETTINGS', `${changed.join('、')}和上次导出时不一样，只更新游戏资源会对不上，请点「导出并转换」完整导出一次`, 'run'));
  }
  if (inputs.blockers.length) return {...base, status: 'BLOCKED', blockers: inputs.blockers};

  // 临时工作目录：放这次导出的 PCK 和任务记录。替换完成（或取消）后删掉，只在出错时留下来方便查原因；
  // 每次更新的结果记在 RUN/REFRESH-LOG.json。
  const dir = path.join(run, runName('refresh', new Date()));
  const result = {...base, status: 'RUNNING', run, steps: {}};
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return {...base, status: 'FAILED', run, error: {code: 'QUICK_RUN_EXISTS', message: '刚刚已经更新过一次，请稍后再试。'}};
  }
  try {
    const local = {...inputs, run, requests: path.join(dir, 'requests'), exportOutput: path.join(dir, 'pck'),
      splitOutput: path.join(dir, 'split'), interfacesOutput: path.join(dir, 'interfaces')};
    fs.mkdirSync(local.requests);
    report({step: 'start', phase: 'start', run});
    const files = {configFile: path.join(local.requests, 'export-config.json'), requestFile: path.join(local.requests, 'export-request.json')};
    writeDraft(buildExportRequestDraft({editorExecutable: inputs.editor}, exportPayload(local), files), files);
    result.steps.export = await planAndExecute(service, files.requestFile, 'export', report, local);
    const pckFile = path.join(local.exportOutput, 'full.pck');
    if (!isFile(pckFile)) throw quickError('QUICK_PCK_MISSING', '导出成功但没有找到 full.pck');
    report({step: 'check', phase: 'execute'});
    result.steps.featureScan = checkRemovedClasses(inputs.settings.template, pckFile);
    let pck = applySkipPrewarm(inputs, fs.readFileSync(pckFile)).pck, bootFile = pckFile, scenes = null;
    if (scenesRun) {
      // 和完整导出一样重新拆包、重新生成分包接口（含各分包指纹），只是不再跑微信转换器。
      const startup = path.join(dir, 'startup.pck');
      fs.writeFileSync(startup, pck, {flag: 'wx'});
      scenes = await splitScenes(service, local, startup, report);
      const before = status.scenePacks.map(p => p.id).sort(), after = scenes.packs.map(p => p.id).sort();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw Object.assign(quickError('QUICK_REFRESH_SCENES', '这次拆出来的分包和上次不一样，请点「导出并转换」完整导出一次'), {field: 'subpackages'});
      for (const id of after)
        if (!isFile(path.join(target, SCENE_PACK_ROOT, id, 'content.bin')))
          throw quickError('QUICK_REFRESH_SCENES', `打开的工程里没有分包 ${id}，请完整导出一次`);
      if (!isFile(path.join(target, 'godot-data', 'local-interfaces.js'))) throw quickError('QUICK_REFRESH_SCENES', '打开的工程里没有分包接口文件，请完整导出一次');
      bootFile = scenes.pck;
      pck = fs.readFileSync(scenes.pck);
      result.steps.split = scenes.splitStep;
      result.steps.interfaces = scenes.interfacesStep;
    }
    let projectUsageSha256 = null;
    if (inputs.release.profile === CUSTOM_PAIR_PROFILE)
      projectUsageSha256 = createHash('sha256').update(JSON.stringify(convertPayload(inputs, bootFile, pck).projectUsage)).digest('hex');
    report({step: 'check', phase: 'done', status: 'SUCCESS'});
    stopIfCancelled(local, 'replace');
    report({step: 'replace', phase: 'execute'});
    result.steps.replace = refreshMinigamePck(target, pck, {projectUsageSha256});
    if (scenes) {
      // 分包内容和分包接口（记录每个包的大小和指纹，游戏下载分包时按它核对）一起换。
      const changedPacks = [];
      for (const p of scenes.packs) {
        const file = path.join(target, SCENE_PACK_ROOT, p.id, 'content.bin'), bytes = fs.readFileSync(path.join(local.splitOutput, 'packs', p.id + '.pck'));
        if (!fs.readFileSync(file).equals(bytes)) { fs.writeFileSync(file, bytes); changedPacks.push(p.id); }
      }
      const iface = path.join(target, 'godot-data', 'local-interfaces.js'), ifaceBytes = fs.readFileSync(scenes.interfaces);
      const ifaceChanged = !fs.readFileSync(iface).equals(ifaceBytes);
      if (ifaceChanged) fs.writeFileSync(iface, ifaceBytes);
      result.steps.replace = {...result.steps.replace, changed: result.steps.replace.changed || changedPacks.length > 0 || ifaceChanged, changedPacks, interfacesChanged: ifaceChanged};
      result.scenePacks = scenes.packs;
    }
    report({step: 'replace', phase: 'done', status: 'SUCCESS'});
    const logFile = path.join(run, REFRESH_LOG);
    const log = readJson(logFile) ?? {schema: 'wxslim-refresh-log-v1', refreshes: []};
    log.refreshes.push({at: new Date().toISOString(), target,...result.steps.replace});
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n');
    result.packageId = result.steps.replace.packageId;
    result.projectConfig = status.openTarget;
    result.packageSize = measurePackage(status.openTarget);
    // 只在游戏资源真的变了时才叫开发者工具：同一个工程已经开着，它会切到前台并按新文件重新编译。
    if (openProject && result.steps.replace.changed) {
      stopIfCancelled(local, 'open');
      report({step: 'open', phase: 'execute'});
      // 电脑预览包已带 AppID；其余工程按设置里的来源写入。
      const fromPreview = target.includes(path.sep + 'devtools' + path.sep);
      result.steps.open = openProject(status.openTarget,fromPreview ? '' : inputs.settings.appidFrom, inputs.settings.devtools);
      report({step: 'open', phase: 'done'});
    }
    result.status = 'SUCCESS';
  } catch (e) {
    result.status = e.code === 'QUICK_CANCELLED' ? 'CANCELLED' : 'FAILED';
    const plain = typeof e.code === 'string' && e.code.startsWith('QUICK_');
    result.error = {code: plain ? e.code : 'QUICK_REFRESH_FAILED', message: plain ? e.message : `只更新游戏资源中途出错停下了（${e.message}）`,
      ...(e.reasonCode ? {reasonCode: e.reasonCode} : {}), ...(e.field ? {field: e.field} : {})};
  }
  if (result.status === 'FAILED') {
    result.refresh = dir;
    fs.writeFileSync(path.join(dir, 'REFRESH-RESULT.json'), JSON.stringify(result, null, 2) + '\n');
  } else {
    fs.rmSync(dir, {recursive: true, force: true});
  }
  return result;
}

// ---------- 取消 ----------
// 取消分两层，都不新增控制器、不强杀进程：
//   1. 运行目录里的取消标记：快速流程在每一步开始执行前检查，看到就停在步骤之间；
//   2. 正在执行的共用任务：按 active-task.json 找到请求文件和任务目录，走共用任务核心的 cancel（写 cancel.json，
//      由执行器在自己的安全点停止）。两层都不回滚，已写入的内容保留在本次运行目录。
export const CANCEL_MARKER = 'cancel-requested.json';
const ACTIVE_TASK = 'active-task.json';

function cancelRequested(inputs) { return isFile(path.join(inputs.run, CANCEL_MARKER)); }
function stopIfCancelled(inputs, step) {
  if (cancelRequested(inputs)) throw quickError('QUICK_CANCELLED', `已按取消请求在「${step}」开始前停止`);
}

/** 共用计划里的任务目录：转换任务用计划给出的 taskRoot，导出任务就是它的输出目录。 */
export function planTaskRoot(plan) {
  const root = plan?.action === 'official-convert' ? plan.plan?.taskRoot : plan?.plan?.input?.output;
  return typeof root === 'string' && path.isAbsolute(root) ? root : '';
}

async function planAndExecute(service, requestFile, step, report, inputs) {
  report({step, phase: 'plan'});
  const plan = await service.plan(requestFile);
  if (plan.eligible !== true) throw Object.assign(quickError('QUICK_PLAN_INELIGIBLE', `${step} 的共用计划未通过`), {plan});
  const planSha256 = taskPlanIdentity(plan);
  // 先登记要执行的任务再检查取消标记：取消方先写标记再读登记，二者总能对上其中一个。
  fs.writeFileSync(path.join(inputs.requests, ACTIVE_TASK), JSON.stringify({step, requestFile, taskRoot: planTaskRoot(plan)}, null, 2) + '\n');
  stopIfCancelled(inputs, step);
  report({step, phase: 'execute', planSha256});
  const outcome = await service.execute(requestFile, {write: true, expectedPlanSha256: planSha256});
  report({step, phase: 'done', status: outcome.status, taskId: outcome.taskId});
  if (outcome.status === 'CANCELLED') throw Object.assign(quickError('QUICK_CANCELLED', `${step} 已按取消请求停止`), {outcome});
  if (outcome.status !== 'SUCCESS') {
    const errors = {
      PCK_EXPORT_RECEIPT_LIMIT: ['导出结果超过收据大小或导出预算限制，请检查导出预算和资源数量。','exportBudgetMiB'],
      PCK_EXPORT_CACHE_BUDGET: ['Godot 导入缓存的增长超过本次允许的大小。','importCacheBudgetMiB'],
      PCK_EXPORT_ERROR_LOG: ['Godot 在导出日志中报告了错误，请查看本次导出的日志。','project'],
      PCK_EXPORT_CHILD_FAILED: ['Godot 导出进程返回失败，请查看本次导出的日志。','project'],
    };
    const reasonCode = outcome.failureCode;
    const [message,field] = Object.hasOwn(errors,reasonCode) ? errors[reasonCode] :
      [{export: 'Godot 导出失败，请查看本次导出的任务记录。', split: '按场景拆包失败，请查看本次运行 split 目录里的任务记录。',
        interfaces: '生成分包接口失败，请查看本次运行 interfaces 目录里的任务记录。', assemble: '组装分包失败，请查看本次运行 final 目录里的任务记录。'}[step]
        ?? '官方转换失败，请查看本次转换的任务记录。', ['split', 'interfaces', 'assemble'].includes(step) ? 'scenes' : undefined];
    throw Object.assign(quickError('QUICK_TASK_NOT_SUCCESS',message),{outcome,reasonCode,field});
  }
  return {planSha256, outcome};
}

function readTaskOwner(root) {
  try {
    const file = path.join(root, 'TASK.json'), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 16384) return null;
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof owner?.taskId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(owner.taskId) ? owner : null;
  } catch { return null; }
}

// 每个共用任务步骤在运行目录里的任务目录。
const STEP_DIRS = Object.freeze({export: 'pck', split: 'split', interfaces: 'interfaces', convert: 'wechat', assemble: 'final'});

function matchesExistingPath(expected, recorded) {
  if (typeof recorded !== 'string' || !path.isAbsolute(recorded) || path.relative(expected, recorded) !== '') return false;
  try { return path.relative(expected, fs.realpathSync(expected)) === ''; }
  catch { return false; }
}

function activeTaskRoot(run, active) {
  const dir = STEP_DIRS[active?.step] ?? '';
  if (!dir) return null;
  const root = path.resolve(run, dir);
  return matchesExistingPath(root, active.taskRoot) ? root : null;
}

/**
 * 取消一次正在进行的快速运行。先写取消标记，再找正在执行的共用任务并请求取消。
 * 任务还没建立时最多等 waitMs；等不到也没关系，运行会在下一步开始前因标记停止。
 */
export async function cancelQuickRun(run, {service = createTaskService(), waitMs = 15000, pollMs = 500} = {}) {
  if (typeof run !== 'string' || !path.isAbsolute(run) || !isDirectory(path.join(run, 'requests')))
    throw quickError('QUICK_CANCEL_RUN_INVALID', `不是快速流程的运行目录：${run}`);
  let markerWritten = true;
  try {
    fs.writeFileSync(path.join(run, CANCEL_MARKER), JSON.stringify({schema: 'wxslim-quick-cancel-marker-v1', at: new Date().toISOString()}) + '\n', {flag: 'wx'});
  } catch (e) { if (e.code !== 'EEXIST') throw e; markerWritten = false; }
  const result = {schema: 'wxslim-quick-cancel-v1', status: 'CANCEL_REQUESTED', run, markerWritten, task: null,
    boundary: '在共用任务的安全点或下一步开始前停止；不强杀进程、不回滚，已写入内容保留'};
  const deadline = Date.now() + waitMs;
  for (;;) {
    const active = readJson(path.join(run, 'requests', ACTIVE_TASK));
    const root = activeTaskRoot(run, active);
    const owner = root && readTaskOwner(root);
    if (owner && matchesExistingPath(path.resolve(run, 'requests', active.step + '-request.json'), active.requestFile)) {
      const status = await service.status(active.requestFile, {root: active.taskRoot, taskId: owner.taskId});
      const task = {step: active.step, taskId: owner.taskId, status: status.status};
      if (status.terminalPresent === true) { result.task = {...task, alreadyEnded: true}; return result; }
      if (status.inputBinding === 'MATCHED_EXECUTION_SNAPSHOT') {
        const cancelled = await service.cancel(active.requestFile, {root: active.taskRoot, taskId: owner.taskId, write: true});
        result.task = {...task, accepted: cancelled.cancel?.accepted === true, duplicate: cancelled.cancel?.duplicate === true, alreadyEnded: cancelled.cancel?.alreadyEnded === true};
        return result;
      }
    }
    if (Date.now() >= deadline) {
      result.note = '没有找到正在执行的共用任务；运行会在下一步开始前停止';
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

/**
 * 按场景分包：算归属 → 共用拆包任务写出各 PCK → 写资源配置 → 共用接口任务生成 interfaces.js。
 * 返回转换要用的首包和接口文件，以及资源配置（预览包或组包任务再用它把分包放进小游戏工程）。
 */
async function splitScenes(service, inputs, fullPck, report) {
  report({step: 'split', phase: 'analyze'});
  const buffer = fs.readFileSync(fullPck), inventory = inspectPck(buffer);
  let plan;
  try { plan = planScenePacks({projectDir: inputs.project, scenes: inputs.settings.scenes, mainScene: inputs.mainScene, pck: buffer}); }
  catch (e) { throw Object.assign(quickError(e.code || 'QUICK_SCENES_FAILED', e.message), e.field ? {field: e.field} : {}); }
  for (const r of plan.resources) {
    if (r.payloadBytes > 30 * MiB) throw Object.assign(quickError('QUICK_SCENE_PACK_TOO_LARGE', `场景 ${r.scene} 的分包超过 30 MiB，微信单个分包放不下，请拆成更小的场景`), {field: 'scenes'});
  }
  const splitFiles = {configFile: path.join(inputs.requests, 'split-config.json'), requestFile: path.join(inputs.requests, 'split-request.json')};
  const snapshot = {sourcePath: fullPck, pin: {bytes: inventory.bytes, sha256: inventory.sha256}, inventory, buffer};
  const splitBudget = Math.min(PCK_PARTITION_LIMIT_BYTES + 4 * MiB, Math.ceil(inventory.bytes / MiB) * MiB + 6 * MiB);
  writeDraft(buildResourcePartitionRequestDraft({sourcePath: fullPck, output: inputs.splitOutput, budgetBytes: splitBudget,
    packs: plan.packs, dependencyAcknowledged: true}, snapshot, splitFiles), splitFiles);
  const splitStep = await planAndExecute(service, splitFiles.requestFile, 'split', report, inputs);
  const packFile = id => path.join(inputs.splitOutput, 'packs', id + '.pck');
  const pins = new Map();
  for (const p of plan.packs) {
    const bytes = fs.readFileSync(packFile(p.id));
    pins.set(p.id, {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  const packsFile = path.join(inputs.requests, 'scene-packs.json');
  fs.writeFileSync(packsFile, JSON.stringify(scenePackResourceConfig(plan, inputs.mainScene, packFile, id => pins.get(id)), null, 2) + '\n', {flag: 'wx'});
  const interfacesFiles = {configFile: path.join(inputs.requests, 'interfaces-config.json'), requestFile: path.join(inputs.requests, 'interfaces-request.json')};
  writeDraft(buildResourceRuntimeDraft('interfaces', {resourceConfigFile: packsFile, js: inputs.release.js, wasm: inputs.release.wasm,
    output: inputs.interfacesOutput, budgetBytes: 8 * MiB}, interfacesFiles), interfacesFiles);
  const interfacesStep = await planAndExecute(service, interfacesFiles.requestFile, 'interfaces', report, inputs);
  const interfaces = path.join(inputs.interfacesOutput, 'interfaces.js');
  if (!isFile(interfaces)) throw quickError('QUICK_INTERFACES_MISSING', '分包接口生成成功但没有找到 interfaces.js');
  return {pck: packFile('boot'), interfaces, packsFile, splitStep, interfacesStep,
    packs: plan.resources.map(r => ({id: r.id, scene: r.scene, entries: r.paths.length, ...pins.get(r.id)}))};
}

/** 执行：新建本次运行目录，依次导出、转换，可选打开开发者工具。任一步失败即停止，不重试、不回滚。 */
export async function quickRun(options, {service = createTaskService(), openProject = null, report = () => {}, assemble = assembleDevtoolsPreview} = {}) {
  const inputs = await resolveTaskInputs(options);
  // 打开工具会把转换结果里的占位 AppID 换成来源文件中的 AppID；没有来源时开发者工具拒绝打开，提前拦下。
  if (openProject && !inputs.settings.appidFrom)
    inputs.blockers.push(blocker('QUICK_OPEN_NEEDS_APPID_SOURCE', '要在开发者工具中打开，需要在设置里填 appidFrom（已有小游戏的 project.config.json）', 'appidFrom'));
  // 真正打开开发者工具时，先确认能找到它，免得导出转换完才失败。
  if (openProject === openWeChatProject && !inputs.settings.devtools)
    try { resolveDevtools(''); } catch (e) { inputs.blockers.push(blocker(e.code, e.message, 'devtools')); }
  if (inputs.blockers.length) return {schema: 'wxslim-quick-run-v1', status: 'BLOCKED', blockers: inputs.blockers, writes: 'NONE'};
  const result = {schema: 'wxslim-quick-run-v1', status: 'RUNNING', run: inputs.run, steps: {}};
  try {
    fs.mkdirSync(inputs.run);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const collision = {code: 'QUICK_RUN_EXISTS', field: 'output', message: '本次运行目录已经存在，请稍后重试。'};
    return {schema: 'wxslim-quick-run-v1', status: 'FAILED', run: inputs.run, steps: {}, error: collision, writes: 'NONE'};
  }
  try {
    fs.mkdirSync(inputs.requests);
    report({step: 'start', phase: 'start', run: inputs.run});
    const exportFiles = {configFile: path.join(inputs.requests, 'export-config.json'), requestFile: path.join(inputs.requests, 'export-request.json')};
    writeDraft(buildExportRequestDraft({editorExecutable: inputs.editor}, exportPayload(inputs), exportFiles), exportFiles);
    result.steps.export = await planAndExecute(service, exportFiles.requestFile, 'export', report, inputs);
    const fullPck = path.join(inputs.exportOutput, 'full.pck');
    if (!isFile(fullPck)) throw quickError('QUICK_PCK_MISSING', '导出成功但没有找到 full.pck');
    result.steps.featureScan = checkRemovedClasses(inputs.settings.template, fullPck);
    let pck = fullPck, interfaces = inputs.interfaces, scenePacksFile = '';
    if (inputs.settings.skipPrewarm) {
      // 导出的 full.pck 保持原样；写好设置的副本放在 startup/，后面的拆包和转换都用它。
      const startup = path.join(inputs.run, 'startup');
      fs.mkdirSync(startup);
      pck = path.join(startup, 'full.pck');
      fs.writeFileSync(pck, applySkipPrewarm(inputs, fs.readFileSync(fullPck)).pck, {flag: 'wx'});
      result.steps.prewarm = {skipped: true, setting: SKIP_PREWARM_SETTING, pck};
    }
    if (inputs.scenes) {
      const split = await splitScenes(service, inputs, pck, report);
      ({pck, interfaces} = split);
      scenePacksFile = split.packsFile;
      result.steps.split = split.splitStep;
      result.steps.interfaces = split.interfacesStep;
      result.scenePacks = split.packs;
    }
    const convertFiles = {configFile: path.join(inputs.requests, 'convert-config.json'), requestFile: path.join(inputs.requests, 'convert-request.json')};
    let snapshot;
    if (inputs.release.profile === CUSTOM_PAIR_PROFILE) {
      // 自建配对的表单要求本次 PCK 的快照，并核对声明正好覆盖这份 PCK。
      const buffer = fs.readFileSync(pck), inventory = inspectPck(buffer);
      snapshot = {sourcePath: pck, pin: {bytes: inventory.bytes, sha256: inventory.sha256}, inventory, buffer};
    }
    writeDraft(buildOfficialConvertRequestDraft(convertPayload(inputs, pck, snapshot?.buffer, interfaces), convertFiles, snapshot), convertFiles);
    result.steps.convert = await planAndExecute(service, convertFiles.requestFile, 'convert', report, inputs);
    const projectConfig = path.join(inputs.convertOutput, 'converted', 'minigame', 'project.config.json');
    if (!isFile(projectConfig)) throw quickError('QUICK_MINIGAME_MISSING', '转换成功但没有找到 project.config.json');
    result.projectConfig = projectConfig;
    let openTarget = projectConfig, openSource = inputs.settings.appidFrom;
    if (inputs.preview) {
      stopIfCancelled(inputs, 'devtools');
      // 同包工具读取官方转换任务的收据和产物，写到新的 devtools 目录；原转换输出不改。
      // 分包时直接用拆包后的资源配置：同包工具把各分包放进预览工程并登记到 game.json。
      let packsFile = scenePacksFile;
      if (!packsFile) {
        const bytes = fs.readFileSync(pck);
        packsFile = path.join(inputs.requests, 'devtools-packs.json');
        const packs = bootOnlyResourceConfig(pck, inputs.mainScene, createHash('sha256').update(bytes).digest('hex'), bytes.length);
        fs.writeFileSync(packsFile, JSON.stringify(packs, null, 2) + '\n', {flag: 'wx'});
      }
      report({step: 'devtools', phase: 'execute'});
      const assembled = assemble({convertOutput: inputs.convertOutput, packsFile, output: inputs.previewOutput, appidFrom: inputs.settings.appidFrom});
      report({step: 'devtools', phase: 'done', status: 'SUCCESS'});
      const previewConfig = path.join(inputs.previewOutput, 'minigame', 'project.config.json');
      if (!isFile(previewConfig)) throw quickError('QUICK_DEVTOOLS_MISSING', '电脑预览包生成后没有找到 project.config.json');
      result.steps.devtools = {packageId: assembled.packageId, parent: assembled.parent, files: assembled.files, bytes: assembled.bytes};
      result.devtoolsConfig = previewConfig;
      // 预览包已由同包工具写入来源 AppID，打开时不再改写。
      openTarget = previewConfig;
      openSource = '';
    } else if (inputs.assembleOutput) {
      // 不生成预览包（WebGL）时，用共用组包任务把分包写进转换结果的副本。
      const assembleFiles = {configFile: path.join(inputs.requests, 'assemble-config.json'), requestFile: path.join(inputs.requests, 'assemble-request.json')};
      const packBytes = result.scenePacks.reduce((sum, p) => sum + p.bytes, 0);
      const budgetBytes = Math.min(384 * MiB, Math.max(4 * MiB, Math.ceil((directoryBytes(inputs.convertOutput) + packBytes) / MiB) * MiB + 16 * MiB));
      writeDraft(buildResourceRuntimeDraft('assembly', {resourceConfigFile: scenePacksFile, officialConfigFile: convertFiles.configFile,
        convertedOutput: path.join(inputs.convertOutput, 'converted'), output: inputs.assembleOutput, budgetBytes}, assembleFiles), assembleFiles);
      result.steps.assemble = await planAndExecute(service, assembleFiles.requestFile, 'assemble', report, inputs);
      const assembledConfig = path.join(inputs.assembleOutput, 'converted', 'minigame', 'project.config.json');
      if (!isFile(assembledConfig)) throw quickError('QUICK_ASSEMBLE_MISSING', '分包组装完成后没有找到 project.config.json');
      result.assembledConfig = assembledConfig;
      openTarget = assembledConfig;
    }
    result.packageSize = measurePackage(openTarget);
    if (openProject) {
      stopIfCancelled(inputs, 'open');
      report({step: 'open', phase: 'execute'});
      result.steps.open = openProject(openTarget, openSource, inputs.settings.devtools);
      report({step: 'open', phase: 'done'});
    }
    result.status = 'SUCCESS';
  } catch (e) {
    result.status = e.code === 'QUICK_CANCELLED' ? 'CANCELLED' : 'FAILED';
    // 底层意外错误（文件读写等）不是给用户看的原因：说明在哪一步停下，原始信息留在括号里供排查。
    const plain = typeof e.code === 'string' && e.code.startsWith('QUICK_');
    result.error = {code: plain ? e.code : 'QUICK_RUN_FAILED', message: plain ? e.message : `运行中途出错停下了（${e.message}）`,
      ...(!plain && e.code ? {reasonCode: String(e.code)} : {}),
      ...(e.reasonCode ? {reasonCode:e.reasonCode} : {}), ...(e.field ? {field:e.field} : {}),
      ...(e.outcome ? {task: e.outcome} : {}), ...(e.plan ? {plan: e.plan} : {})};
    result.note = '已写入的目录和任务记录保留在本次运行目录中，不自动清理或重试。';
  }
  writeRunSummary(inputs.run, result);
  return result;
}

// ---------- 已有运行 ----------
// 每次运行结束时在运行目录写一份小摘要，供面板「最近运行」和 quick runs 读取；没有摘要的旧运行由任务收据推断。
export const RUN_SUMMARY = 'RUN-RESULT.json';

function writeRunSummary(run, result) {
  if (!run || !isDirectory(run)) return;
  const summary = {schema: 'wxslim-quick-run-summary-v1', status: result.status, finishedAt: new Date().toISOString(),
    ...(result.error ? {error: {code:result.error.code,message:result.error.message,
      ...(result.error.reasonCode ? {reasonCode:result.error.reasonCode} : {}),
      ...(result.error.field ? {field:result.error.field} : {})}} : {}),
    projectConfig: result.projectConfig ?? '', devtoolsConfig: result.devtoolsConfig ?? '', assembledConfig: result.assembledConfig ?? '',
    ...(result.scenePacks ? {scenePacks: result.scenePacks} : {}),
    ...(result.packageSize ? {packageSize: (({summary, mainBytes, totalBytes, ok, problems, lines}) => ({summary, mainBytes, totalBytes, ok, problems, lines}))(result.packageSize)} : {}),
    packageId: result.steps?.devtools?.packageId ?? result.steps?.convert?.outcome?.packageId ?? '',
    convertPackageId: result.steps?.convert?.outcome?.packageId ?? result.steps?.devtools?.parent ?? ''};
  try { fs.writeFileSync(path.join(run, RUN_SUMMARY), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'}); } catch {}
}

function readJson(file, limit = 1048576) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function directoryBytes(root, budget = {entries: 200000}) {
  let total = 0;
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (--budget.entries < 0) return total;
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    try { total += entry.isDirectory() ? directoryBytes(file, budget) : fs.lstatSync(file).size; }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  return total;
}

/** 一次运行的状态：SUCCESS / CANCELLED / FAILED / UNFINISHED（可能仍在运行，也可能进程已中断）。 */
export function quickRunStatus(run) {
  const requests = path.join(run, 'requests');
  if (!isDirectory(requests) || !isFile(path.join(requests, 'export-request.json'))) return null;
  const summary = readJson(path.join(run, RUN_SUMMARY));
  const terminal = step => readJson(path.join(run, step, 'terminal.json'))?.status ?? '';
  const exportStatus = terminal('pck'), convertStatus = terminal('wechat');
  const splitStatus = terminal('split'), interfacesStatus = terminal('interfaces'), assembleStatus = terminal('final');
  const taskStatuses = [exportStatus, splitStatus, interfacesStatus, convertStatus, assembleStatus];
  const preview = readJson(path.join(run, 'devtools', 'PACKAGE.json'));
  const devtoolsConfig = path.join(run, 'devtools', 'minigame', 'project.config.json');
  const assembledConfig = path.join(run, 'final', 'converted', 'minigame', 'project.config.json');
  const projectConfig = path.join(run, 'wechat', 'converted', 'minigame', 'project.config.json');
  // 分包的运行会写拆包请求；这类运行的最终结果是预览包或组包结果，单独的转换结果不含分包。
  const scenesRun = isFile(path.join(requests, 'split-request.json'));
  let status = summary?.status;
  let progress = null;
  if (!status) {
    const active = readJson(path.join(requests, ACTIVE_TASK));
    const root = activeTaskRoot(run, active);
    const activeRunning = root && isFile(path.join(root, 'TASK.json')) && !isFile(path.join(root, 'terminal.json'));
    const owner = activeRunning && readTaskOwner(root);
    if (owner) progress = {step: active.step, taskId: owner.taskId, ...readTaskEventProgress(root, owner.taskId)};
    if (taskStatuses.includes('CANCELLED')) status = 'CANCELLED';
    // 停在两步之间的取消没有任务收据：有取消标记且没有未结束的任务，就是已取消。
    else if (isFile(path.join(run, CANCEL_MARKER)) && !activeRunning) status = 'CANCELLED';
    else if (taskStatuses.some(s => s && s !== 'SUCCESS')) status = 'FAILED';
    else if (convertStatus === 'SUCCESS' && (preview || (!isDirectory(path.join(run, 'devtools')) && (!scenesRun || assembleStatus === 'SUCCESS')))) status = 'SUCCESS';
    else status = 'UNFINISHED';
  }
  const live = liveConfig(run);
  const openTarget = status !== 'SUCCESS' ? '' : isFile(live) ? live : isFile(devtoolsConfig) ? devtoolsConfig : isFile(assembledConfig) ? assembledConfig :
    !scenesRun && isFile(projectConfig) ? projectConfig : '';
  return {
    run, name: path.basename(run), status, source: summary ? 'summary' : 'receipts',
    steps: {export: exportStatus || 'NONE', ...(scenesRun ? {split: splitStatus || 'NONE', interfaces: interfacesStatus || 'NONE'} : {}),
      convert: convertStatus || 'NONE', ...(scenesRun ? {assemble: assembleStatus || 'NONE'} : {}), devtools: preview ? 'SUCCESS' : 'NONE'},
    scenePacks: summary?.scenePacks ?? [],
    cancelRequested: isFile(path.join(run, CANCEL_MARKER)), progress,
    error: summary?.error ?? null,
    packageId: summary?.packageId || preview?.packageId || '', convertPackageId: summary?.convertPackageId || preview?.parent || '',
    openTarget, bytes: directoryBytes(run), modified: fs.statSync(run).mtimeMs,
  };
}

/** 列出输出目录下的快速流程运行，最新的在前。只读，不写任何文件。 */
export function listQuickRuns(output, {limit = 20} = {}) {
  if (typeof output !== 'string' || !path.isAbsolute(output) || !isDirectory(output))
    throw quickError('QUICK_RUNS_OUTPUT_INVALID', `输出目录不存在：${output}`);
  const runs = [];
  for (const entry of fs.readdirSync(output, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const status = quickRunStatus(path.join(output, entry.name));
    if (status) runs.push(status);
  }
  runs.sort((a, b) => b.modified - a.modified || (a.name < b.name ? 1 : -1));
  return {schema: 'wxslim-quick-runs-v1', output, total: runs.length, runs: runs.slice(0, limit)};
}
