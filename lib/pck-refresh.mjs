// Puts a newly exported PCK into an already converted mini game, without running
// the WeChat converter again. The engine (framework.js, wasm) stays as it was; only
// the data package that carries the PCK and the records of its size and hash change:
//   data-package/<md5>.data.bin, wx-game-kit/config*.json launch.data,
//   godot-data/package-info.js, godot-data/package.metadata.json, godot-data/render-config.json/.js
// conversion-core.mjs writes the same layout: a notice file followed by the PCK.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';

const sha = b => createHash('sha256').update(b).digest('hex');
const md5 = b => createHash('md5').update(b).digest('hex');
const NOTICE = Buffer.from('wechat-wasm-slim convert: this data package carries the Godot PCK (last file). No network assets.\n');
const META_PREFIX = 'GameGlobal.__WXSLIM_PACKAGE_META__=';
const RENDER_PREFIX = 'GameGlobal.__WXSLIM_RENDER_CONFIG__=';

function fail(code, message) { throw Object.assign(Error(message), {code}); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeAtomic(file, bytes) {
  const temp = file + '.refresh.tmp';
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
}
function firstLine(text, prefix, what) {
  const end = text.indexOf(';\n');
  if (!text.startsWith(prefix) || end < 0) fail('PCK_REFRESH_LAYOUT', `预览工程里的 ${what} 格式不认识，请完整导出一次`);
  return {json: JSON.parse(text.slice(prefix.length, end)), rest: text.slice(end + 2)};
}

/**
 * minigame：要更新的小游戏工程目录（含 project.config.json）。返回新旧包号和是否有变化。
 * projectUsageSha256：裁剪模板按新 PCK 生成的功能声明的哈希，写进渲染配置的引擎合约。
 */
export function refreshMinigamePck(minigame, pck, {projectUsageSha256 = null} = {}) {
  const f = rel => path.join(minigame, ...rel.split('/'));
  const kitFiles = ['wx-game-kit/config.json', 'wx-game-kit/config.devtools.json'].filter(rel => fs.existsSync(f(rel)));
  if (!kitFiles.length || !fs.existsSync(f('godot-data/package-info.js')) || !fs.existsSync(f('godot-data/render-config.json')))
    fail('PCK_REFRESH_LAYOUT', '这不是插件转换出的小游戏工程，请完整导出一次');
  const kits = kitFiles.map(rel => [rel, readJson(f(rel))]);
  const oldId = kits[0][1].launch?.data?.fileMD5;
  const metaFile = f('godot-data/package-info.js');
  const metaText = firstLine(fs.readFileSync(metaFile, 'utf8'), META_PREFIX, 'package-info.js');
  const meta = metaText.json;
  if (typeof oldId !== 'string' || !meta.pck?.filename || meta.files?.length !== 2) fail('PCK_REFRESH_LAYOUT', '小游戏工程里的数据包记录不完整，请完整导出一次');
  const renderFile = f('godot-data/render-config.json'), renderJsFile = f('godot-data/render-config.js');
  const render = readJson(renderFile);
  const pckSha256 = sha(pck);
  if (pckSha256 === meta.pckSha256) return {changed: false, packageId: render.packageVersion, pckSha256};

  // 1. New data package next to the old one; the old one is removed only after every record points at the new one.
  const data = Buffer.concat([NOTICE, pck]), dataId = md5(data).slice(0, 16);
  const pckEntry = {filename: meta.pck.filename, start: NOTICE.length, end: data.length};
  const files = [{filename: '/WXSLIM-NOTICE.txt', start: 0, end: NOTICE.length}, pckEntry];
  const oldData = f(`data-package/${oldId}.data.bin`), newData = f(`data-package/${dataId}.data.bin`);
  writeAtomic(newData, zlib.brotliCompressSync(data, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11}}));

  // 2. Records of size and hash.
  for (const [rel, kit] of kits) {
    Object.assign(kit.launch.data, {fileMD5: dataId, fileSize: data.length, optFileSize: data.length});
    writeAtomic(f(rel), JSON.stringify(kit, null, 2) + '\n');
  }
  Object.assign(meta, {size: data.length, pck: pckEntry, pckBytes: pck.length, pckSha256, files, dataSha256: sha(data)});
  writeAtomic(metaFile, META_PREFIX + JSON.stringify(meta) + ';\n' + metaText.rest);
  writeAtomic(f('godot-data/package.metadata.json'), JSON.stringify({files, remote_package_size: data.length}) + '\n');
  const previous = render.packageVersion;
  render.pckSha256 = pckSha256;
  if (projectUsageSha256 && render.runtimeOptions?.engineContract?.projectUsageSha256) render.runtimeOptions.engineContract.projectUsageSha256 = projectUsageSha256;
  render.refreshedFrom ??= previous;
  render.packageVersion = 'wxslim-' + sha(JSON.stringify({parent: previous, pckSha256})).slice(0, 20);
  const renderText = JSON.stringify(render, null, 2) + '\n';
  writeAtomic(renderFile, renderText);
  if (fs.existsSync(renderJsFile)) {
    const js = firstLine(fs.readFileSync(renderJsFile, 'utf8'), RENDER_PREFIX, 'render-config.js');
    writeAtomic(renderJsFile, RENDER_PREFIX + JSON.stringify(render) + ';\n' + js.rest);
  }
  if (oldData !== newData && fs.existsSync(oldData)) fs.unlinkSync(oldData);
  return {changed: true, packageId: render.packageVersion, previousPackageId: previous, pckSha256, dataBytes: data.length};
}
