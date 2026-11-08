// CDN 远程分包：按场景分出的资源包不放进小游戏包，改放到 CDN。
// 小游戏包根目录写一份 wxslim-remote.json（CDN 地址 + 每个分包的文件名、大小、SHA-256），
// 运行时的分包读取（convert/assets/resource-subpackage-reader.js）看到它就改用 wx.downloadFile 下载并缓存。
// 要上传的文件放在 OUTPUT/cdn/ 下，文件名带指纹（scenepacks/<id>.<前 16 位>.bin），新旧版本不会互相覆盖。
// 只有分包资源能放 CDN：微信只允许运行代码包里的 wasm，引擎和 WASM 分包（wasmcode1/2）必须留在包里。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SCENE_PACK_ROOT} from './scene-packs.mjs';

export const REMOTE_CONFIG = 'wxslim-remote.json';
export const REMOTE_SCHEMA = 'wxslim-remote-packs-v1';
export const CDN_DIR = 'cdn';
// 大分包在慢网络上可能超过微信默认的 60 秒下载超时。
const DOWNLOAD_TIMEOUT_MS = 600000;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function remoteError(code, message, field = 'cdnBase') { return Object.assign(Error(message), {code, field}); }

/** CDN 地址：http(s)://主机[:端口]/路径/，必须以 / 结尾；不能带 ? 或 #。空字符串表示不用 CDN。 */
export function cdnBaseProblem(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { return 'CDN 地址写法不对，例如 https://cdn.example.com/game/'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'CDN 地址要以 http:// 或 https:// 开头';
  if (url.search || url.hash || /[?#\s]/.test(value)) return 'CDN 地址不能带 ? 或 #';
  if (!value.endsWith('/')) return 'CDN 地址要以 / 结尾，例如 https://cdn.example.com/game/';
  if (url.username || url.password) return 'CDN 地址不能带用户名或密码';
  return '';
}

export function cdnDirFor(run) { return path.join(path.dirname(run), CDN_DIR); }
export function remotePackPath(id, sha256) { return `${SCENE_PACK_ROOT}/${id}.${sha256.slice(0, 16)}.bin`; }
export function readRemoteConfig(minigame) {
  try { return JSON.parse(fs.readFileSync(path.join(minigame, REMOTE_CONFIG), 'utf8')); } catch { return null; }
}

function writeCdnFile(cdnDir, id, bytes) {
  const hash = sha(bytes), rel = remotePackPath(id, hash), file = path.join(cdnDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  let same = false;
  try { same = fs.readFileSync(file).equals(bytes); } catch {}
  if (!same) fs.writeFileSync(file, bytes);
  return {id, path: rel, bytes: bytes.length, sha256: hash, file};
}

function writeConfig(minigame, baseUrl, entries) {
  const value = {schema: REMOTE_SCHEMA, baseUrl, packs: Object.fromEntries(entries.map(e => [e.id, {path: e.path, bytes: e.bytes, sha256: e.sha256}]))};
  const file = path.join(minigame, REMOTE_CONFIG), text = JSON.stringify(value, null, 2) + '\n';
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch {}
  if (before !== text) fs.writeFileSync(file, text);
  return before !== text;
}

// 开发者工具默认校验合法域名；本机临时服务是 http + 局域网地址，不关掉校验就下载不了。
function relaxUrlCheck(minigame, baseUrl) {
  if (baseUrl.startsWith('https://')) return false;
  const file = path.join(minigame, 'project.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.setting?.urlCheck === false) return false;
  config.setting = {...(config.setting ?? {}), urlCheck: false};
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return true;
}

/**
 * 导出完成后：把小游戏工程里的场景分包挪到 CDN 文件夹，从 game.json 去掉对应分包，写 wxslim-remote.json。
 * packs 是这次拆出来的分包（id、bytes、sha256），用来核对挪走的就是这次的内容。
 */
export function applyRemotePacks({minigame, cdnDir, baseUrl, packs}) {
  const problem = cdnBaseProblem(baseUrl);
  if (!baseUrl || problem) throw remoteError('QUICK_CDN_BASE', problem || '没有填 CDN 地址');
  const gameFile = path.join(minigame, 'game.json'), game = JSON.parse(fs.readFileSync(gameFile, 'utf8'));
  const entries = [];
  for (const p of packs) {
    const dir = path.join(minigame, SCENE_PACK_ROOT, p.id), file = path.join(dir, 'content.bin');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== p.bytes || sha(bytes) !== p.sha256) throw remoteError('QUICK_CDN_PACK_MISMATCH', `小游戏工程里的分包 ${p.id} 和这次拆出来的不一致`, 'subpackages');
    entries.push(writeCdnFile(cdnDir, p.id, bytes));
    fs.rmSync(dir, {recursive: true, force: true});
  }
  try { if (!fs.readdirSync(path.join(minigame, SCENE_PACK_ROOT)).length) fs.rmdirSync(path.join(minigame, SCENE_PACK_ROOT)); } catch {}
  const ids = new Set(packs.map(p => p.id));
  game.subpackages = (game.subpackages ?? []).filter(s => !ids.has(s.name));
  game.networkTimeout = {...(game.networkTimeout ?? {}), downloadFile: Math.max(game.networkTimeout?.downloadFile ?? 0, DOWNLOAD_TIMEOUT_MS)};
  fs.writeFileSync(gameFile, JSON.stringify(game, null, 2) + '\n');
  writeConfig(minigame, baseUrl, entries);
  const urlCheckRelaxed = relaxUrlCheck(minigame, baseUrl);
  return summary(baseUrl, cdnDir, entries, {urlCheckRelaxed});
}

/** 只更新游戏资源：新的分包内容写进 CDN 文件夹（文件名随指纹变），更新 wxslim-remote.json。 */
export function refreshRemotePacks({minigame, cdnDir, baseUrl, packs}) {
  const problem = cdnBaseProblem(baseUrl);
  if (!baseUrl || problem) throw remoteError('QUICK_CDN_BASE', problem || '没有填 CDN 地址');
  const before = readRemoteConfig(minigame)?.packs ?? {};
  const entries = packs.map(p => writeCdnFile(cdnDir, p.id, p.buffer));
  const changedPacks = entries.filter(e => before[e.id]?.sha256 !== e.sha256).map(e => e.id);
  const configChanged = writeConfig(minigame, baseUrl, entries);
  relaxUrlCheck(minigame, baseUrl);
  return {...summary(baseUrl, cdnDir, entries), changedPacks, configChanged};
}

function summary(baseUrl, cdnDir, entries, extra = {}) {
  return {baseUrl, cdnDir, files: entries.map(({id, path: rel, bytes, sha256}) => ({id, path: rel, bytes, sha256, url: baseUrl + rel})),
    bytes: entries.reduce((n, e) => n + e.bytes, 0), ...extra};
}
