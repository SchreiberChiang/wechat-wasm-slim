import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PLACEHOLDER_APPID} from '../../convert/lib/verify.mjs';

function readLocalConfig(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1024 * 1024 ||
      path.relative(path.resolve(file), fs.realpathSync(file)) !== '') {
    throw Error('请选择本机的普通 JSON 文件');
  }
  const text = fs.readFileSync(file, 'utf8');
  return {text, json: JSON.parse(text.replace(/^\uFEFF/, ''))};
}

// 共用组包任务（resource-runtime-assemble）成功写出的转换结果副本：TASK.json 和 terminal.json 都属于这次组包，
// 副本里沿用的 CONVERT_REPORT.json 指向原转换的 converted/minigame。
export function assembledCopy(root, report) {
  const converted = path.dirname(root), task = path.dirname(converted);
  if (path.basename(root) !== 'minigame' || path.basename(converted) !== 'converted') return false;
  if (typeof report?.minigame !== 'string' || path.basename(report.minigame) !== 'minigame' || path.basename(path.dirname(report.minigame)) !== 'converted') return false;
  try {
    const owner = readLocalConfig(path.join(task, 'TASK.json')).json, terminal = readLocalConfig(path.join(task, 'terminal.json')).json;
    return typeof owner.recipeId === 'string' && owner.recipeId.startsWith('resource-runtime-assemble:') && terminal.status === 'SUCCESS' &&
      terminal.taskId === owner.taskId && terminal.details?.kind === 'RESOURCE_RUNTIME_ASSEMBLE';
  } catch { return false; }
}

// Only replace the two placeholder fields of an official output (or a completed assembly copy of one). A retry with
// the same source can finish a partial update. Never overwrite another AppID.
export function configureLocalAppId(configFile, sourceFile) {
  const root = path.dirname(configFile);
  const kitFile = path.join(root, 'wx-game-kit/config.json');
  const files = [configFile, kitFile];
  const values = () => files.map((file, i) => {
    const row = readLocalConfig(file);
    return {...row, file, id: i === 0 ? row.json.appid : row.json.project?.app?.appID};
  });
  const valid = id => typeof id === 'string' && /^wx[0-9a-f]{16}$/.test(id) && id !== PLACEHOLDER_APPID;
  if (!sourceFile) {
    const [project, kit] = values();
    if (!valid(project.id) || project.id !== kit.id) throw Error('请选择已有小游戏的 project.config.json 作为 AppID 来源');
    return 0;
  }
  if (!path.isAbsolute(sourceFile) || path.basename(sourceFile) !== 'project.config.json') throw Error('AppID 来源须为已有小游戏的 project.config.json');
  const source = readLocalConfig(sourceFile).json;
  if (source.compileType !== 'game' || !valid(source.appid)) throw Error('来源小游戏缺少有效的 AppID');
  const lock = path.join(path.dirname(root), '.wxslim-local-appid.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
    fs.writeFileSync(fd, JSON.stringify({pid:process.pid, project:root}));
    const entries = values();
    if (entries.some(e => e.id !== PLACEHOLDER_APPID && e.id !== source.appid)) throw Error('目标已绑定其他 AppID，保留原工程');
    const changes = entries.filter(e => e.id === PLACEHOLDER_APPID);
    if (changes.length) {
      const report = readLocalConfig(path.join(path.dirname(root), 'CONVERT_REPORT.json')).json;
      if (report.appidSource !== 'placeholder' || (path.relative(root, report.minigame) !== '' && !assembledCopy(root, report))) throw Error('目标与官方转换回执不匹配');
    }
    for (const {file,text} of changes) {
      const placeholder = JSON.stringify(PLACEHOLDER_APPID);
      if (text.split(placeholder).length !== 2) throw Error('目标配置中的占位符不唯一');
      const tmp = file + '.' + randomUUID() + '.tmp';
      fs.writeFileSync(tmp, text.replace(placeholder, JSON.stringify(source.appid)), {flag:'wx', flush:true});
      try {
        if (readLocalConfig(file).text !== text) throw Error('目标配置已被其他进程修改');
        fs.renameSync(tmp, file);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    }
    if (values().some(e => e.id !== source.appid)) throw Error('两个本地 AppID 字段核对失败');
    return changes.length;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
}

// Use argv directly with the same Electron CLI entry as the installed cli.bat.
// The selected project path is always a separate argument.
const DEVTOOLS_CLI = 'resources/app.asar.unpacked/js/common/cli/index.js';
const isDevtoolsDir = dir => ['cli.bat', '微信开发者工具.exe', DEVTOOLS_CLI].every(name => fs.existsSync(path.join(dir, name)));

/**
 * 微信开发者工具的安装目录。顺序：面板或设置里指定的位置（安装目录或其中的 .exe/cli.bat）、
 * 环境变量 WXSLIM_WECHAT_DEVTOOLS、PATH、常见安装位置。找不到时说明怎么在面板里指定。
 */
export function resolveDevtools(explicit = '', env = process.env) {
  const asDir = value => {
    const p = path.resolve(String(value).replace(/^"|"$/g, ''));
    return fs.existsSync(p) && fs.statSync(p).isFile() ? path.dirname(p) : p;
  };
  if (explicit) {
    const dir = asDir(explicit);
    if (isDevtoolsDir(dir)) return dir;
    throw Object.assign(Error(`设置的微信开发者工具位置不对：${explicit}。请选择安装目录里的「微信开发者工具.exe」。`), {code: 'QUICK_DEVTOOLS_INVALID', field: 'devtools'});
  }
  const pathDirs = (env.PATH || '').split(path.delimiter).map(s => s.replace(/^"|"$/g, '')).filter(path.isAbsolute);
  const defaults = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean).flatMap(root => [path.join(root, 'Tencent', '微信web开发者工具'), path.join(root, '微信web开发者工具')]);
  const found = [...(env.WXSLIM_WECHAT_DEVTOOLS ? [asDir(env.WXSLIM_WECHAT_DEVTOOLS)] : []), ...pathDirs, ...defaults].find(isDevtoolsDir);
  if (found) return found;
  throw Object.assign(Error('没有找到微信开发者工具。请在面板「发布信息 → 微信开发者工具」里选择安装目录中的「微信开发者工具.exe」。'), {code: 'QUICK_DEVTOOLS_NOT_FOUND', field: 'devtools'});
}

export function openWeChatProject(configFile, appidFrom = '', devtools = '') {
  if (typeof configFile !== 'string' || !path.isAbsolute(configFile) || path.basename(configFile) !== 'project.config.json') {
    throw Error('请选择小游戏根目录中的 project.config.json');
  }
  const project = path.dirname(configFile);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  if (config.compileType !== 'game' || !['game.js', 'game.json'].every(name => fs.statSync(path.join(project, name)).isFile())) {
    throw Error('所选工程缺少小游戏入口或配置');
  }
  const cli = DEVTOOLS_CLI;
  const install = resolveDevtools(devtools);
  const appIdFieldsChanged = configureLocalAppId(configFile, appidFrom);
  const bootstrap = "const entry=process.argv[1];process.argv=[process.execPath,'--ms-enable-electron-run-as-node',entry,'--electron',...process.argv.slice(2)];require(entry)";
  const result = spawnSync(path.join(install, '微信开发者工具.exe'), ['-e', bootstrap, path.join(install, cli), 'open', '--project', project], {
    cwd: install, env: {...process.env, cwd: project, ELECTRON_RUN_AS_NODE: '1'}, shell: false, windowsHide: true,
    encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024
  });
  if (result.error || result.status !== 0) throw Error('微信开发者工具未确认打开，检查本机工具的服务端口和项目设置');
  return {project, cliExitCode: result.status, appIdFieldsChanged};
}

/**
 * 用开发者工具命令行「预览」：上传到微信并生成手机扫码用的二维码图片（qrFile，PNG）。
 * 工程里已有真实 AppID（电脑预览包、WASM 分包副本都已写入）。
 */
export function previewWeChatProject(project, qrFile, devtools = '') {
  if (!path.isAbsolute(project) || !fs.existsSync(path.join(project, 'project.config.json'))) throw Error('没有可预览的小游戏工程');
  const install = resolveDevtools(devtools);
  const bootstrap = "const entry=process.argv[1];process.argv=[process.execPath,'--ms-enable-electron-run-as-node',entry,'--electron',...process.argv.slice(2)];require(entry)";
  const result = spawnSync(path.join(install, '微信开发者工具.exe'), ['-e', bootstrap, path.join(install, DEVTOOLS_CLI), 'preview', '--project', project,
    '--qr-format', 'image', '--qr-output', qrFile], {
    cwd: install, env: {...process.env, cwd: project, ELECTRON_RUN_AS_NODE: '1'}, shell: false, windowsHide: true,
    encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0 || !fs.existsSync(qrFile)) {
    const text = String((result.stdout || '') + (result.stderr || '')).split('\n').filter(l => /error|✖|失败/i.test(l)).slice(-3).join(' ');
    throw Object.assign(Error('开发者工具没能生成预览二维码' + (text ? '：' + text.slice(0, 300) : '，请确认开发者工具已登录并开启服务端口')), {code: 'QUICK_PREVIEW_FAILED'});
  }
  const sizes = {};
  for (const m of String(result.stdout || '').matchAll(/│\s*(\S+)\s*│\s*'([^']+)'\s*│\s*(\d+)\s*│/g)) sizes[m[1]] = Number(m[3]);
  // 开发者工具不管 --qr-output 写什么扩展名，实际写出的是 JPEG；按文件头改成真实扩展名，图片查看器和 Godot 才读得出来。
  const head = fs.readFileSync(qrFile).subarray(0, 4);
  const real = head[0] === 0xff && head[1] === 0xd8 ? '.jpg' : head[0] === 0x89 && head[1] === 0x50 ? '.png' : path.extname(qrFile);
  let file = qrFile;
  if (real !== path.extname(qrFile)) { file = qrFile.slice(0, -path.extname(qrFile).length) + real; fs.renameSync(qrFile, file); }
  return {project, qrFile: file, sizes};
}
