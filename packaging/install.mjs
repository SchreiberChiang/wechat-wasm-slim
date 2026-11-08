// Connects a copied plugin folder to this machine. The release is the folder
// GAME/addons/wxslim_readonly/ with the tool kit in its kit/ subfolder (which
// carries a .gdignore, so Godot never scans or exports it). The plugin runs
// this file by itself when it is enabled; people and AI agents can also run:
//   node GAME/addons/wxslim_readonly/kit/install.mjs [GODOT_EDITOR] [--state-root DIRECTORY]
// It verifies the kit, records the editor and Node for this machine, keeps the
// task state outside the game, and enables the plugin in project.godot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const kit = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let stateRoot = '';
const at = args.indexOf('--state-root');
if (at >= 0) { stateRoot = args[at + 1] || ''; args.splice(at, 2); }
assert(args.length <= 1 && (at < 0 || stateRoot), 'node install.mjs [GODOT_EDITOR] [--state-root DIRECTORY]');

function fail(code, message) {
  console.log(JSON.stringify({schema: 'wxslim-plugin-setup-v1', status: 'FAILED', code, message}));
  process.exit(1);
}
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) fail('SETUP_NODE_VERSION', `需要 Node.js 24 或更新版本，当前是 ${process.versions.node}`);

const addon = path.dirname(kit);
const project = path.dirname(path.dirname(addon));
if (path.basename(addon) !== 'wxslim_readonly' || path.basename(path.dirname(addon)) !== 'addons' || !fs.existsSync(path.join(project, 'project.godot')))
  fail('SETUP_NOT_IN_GAME', '插件文件夹要放在游戏工程的 addons/wxslim_readonly/ 里（和 project.godot 同一层的 addons 文件夹）');

const contains = (a, b) => { const rel = path.relative(a, b); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };
const hash = b => createHash('sha256').update(b).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// 1. The kit must match its manifest byte for byte.
const manifestBytes = fs.readFileSync(path.join(kit, 'RELEASE.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.schema, 'wxslim-plugin-kit-v1');
for (const [rel, pin] of Object.entries(manifest.files)) {
  const file = path.join(kit, rel);
  if (!contains(kit, file) || !fs.existsSync(file) || path.relative(file, fs.realpathSync(file)) !== '') fail('SETUP_KIT_INCOMPLETE', `插件文件不完整，缺少 ${rel}。请重新复制整个 wxslim_readonly 文件夹。`);
  const b = fs.readFileSync(file);
  if (b.length !== pin.bytes || hash(b) !== pin.sha256) fail('SETUP_KIT_CHANGED', `插件文件和发布时不一致：${rel}。请重新复制整个 wxslim_readonly 文件夹。`);
}

// 2. Godot editor: given by the plugin (the running editor) or by the caller.
const registration = path.join(project, '.godot', 'wxslim');
const pointer = path.join(registration, 'state.path');
const projectKey = hash(Buffer.from(process.platform === 'win32' ? project.toLowerCase() : project)).slice(0, 24);
const base = stateRoot || path.join(process.env.LOCALAPPDATA || path.join(path.dirname(project), '.wxslim-state'), 'Godot', 'WxSlim', 'projects');
const state = path.resolve(stateRoot || !fs.existsSync(pointer) ? path.join(base, projectKey) : fs.readFileSync(pointer, 'utf8').trim());
if (contains(project, state)) fail('SETUP_STATE_IN_GAME', '任务记录目录不能放在游戏工程里面');
const config = path.join(state, 'local-config.json');
let prior = null;
try { prior = readJson(config); } catch { /* first setup */ }
const editorArg = args[0] || prior?.editorExecutable || '';
if (!editorArg || !fs.existsSync(editorArg)) fail('SETUP_EDITOR', '需要 Godot 编辑器路径：从 Godot 里启用插件会自动填写，命令行运行时把编辑器 .exe 作为参数传入');
const editor = fs.realpathSync(path.resolve(editorArg));

for (const dir of [registration, state, path.join(state, 'logs')]) fs.mkdirSync(dir, {recursive: true});

// 3. Write the machine records; a crashed earlier run leaves a lock that expires after ten minutes.
const lease = path.join(registration, 'installation.lock');
try { if (Date.now() - fs.statSync(lease).mtimeMs > 600000) fs.unlinkSync(lease); } catch { /* no lock */ }
let fd;
try { fd = fs.openSync(lease, 'wx'); } catch { fail('SETUP_BUSY', '插件正在别处准备中，请稍后再试'); }
try {
  const token = randomUUID();
  const publishText = (file, text) => { const temp = file + '.' + token + '.tmp'; fs.writeFileSync(temp, text, {flag: 'wx'}); fs.renameSync(temp, file); };
  const runtime = path.join(kit, 'runtime');
  const same = prior && prior.repositoryRoot === runtime;
  publishText(path.join(addon, 'workbench.path'), path.join(runtime, 'editor', 'workbench').replaceAll('\\', '/') + '\n');
  publishText(path.join(state, 'project.json'), JSON.stringify({project}, null, 2) + '\n');
  publishText(pointer, state.replaceAll('\\', '/') + '\n');
  publishText(config, JSON.stringify({schema: 'wxslim-local-plugin-config-v1', nodeExecutable: process.execPath, repositoryRoot: runtime, editorExecutable: editor,
    requestFile: same ? prior.requestFile : '', taskRoot: same ? prior.taskRoot : '', taskId: same ? prior.taskId : ''}, null, 2) + '\n');
  const {enablePlugin} = await import(pathToFileURL(path.join(runtime, 'lib', 'godot-plugin-state.mjs')).href);
  const projectFile = path.join(project, 'project.godot'), projectText = fs.readFileSync(projectFile, 'utf8');
  const enabledText = enablePlugin(projectText);
  if (enabledText !== projectText) publishText(projectFile, enabledText);
  publishText(path.join(registration, 'installation.json'), JSON.stringify({schema: 2, releaseManifest: hash(manifestBytes), pluginVersion: manifest.pluginVersion,
    editor, node: process.execPath}, null, 2) + '\n');
  console.log(JSON.stringify({schema: 'wxslim-plugin-setup-v1', status: 'SUCCESS', project, state, editor, node: process.execPath,
    pluginVersion: manifest.pluginVersion, pluginEnabledNow: enabledText !== projectText}));
} finally { fs.closeSync(fd); fs.unlinkSync(lease); }
