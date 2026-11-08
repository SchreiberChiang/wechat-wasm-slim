// 包体大小报告：按微信小游戏的代码包限制，统计一个小游戏工程的主包和各分包大小。
//
// 这里的分包是 game.json 里登记的普通分包和独立分包，跟代码包一起上传，不是 CDN 远程资源，所以都受限：
//   - 主包（不在任何分包目录里的文件）不超过 4 MB；
//   - 主包加全部分包合计不超过 30 MB；
//   - 单个独立分包不超过 4 MB，普通分包单个不限。
// project.config.json 的 packOptions.ignore 里 folder / file / suffix / prefix 四种规则会被排除，和上传时一致；
// 其他规则类型（regexp、glob）不解析，相关文件照常计入，结果只会偏大不会偏小。
import fs from 'node:fs';
import path from 'node:path';

export const MB = 1024 * 1024;
export const PACKAGE_LIMITS = {mainBytes: 4 * MB, totalBytes: 30 * MB, independentBytes: 4 * MB};

const LABELS = {wasmcode: 'Godot 引擎', 'data-package': '首包游戏资源'};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function ignoredBy(rules, rel) {
  const name = rel.split('/').pop();
  return rules.some(rule => {
    const value = typeof rule?.value === 'string' ? rule.value.replace(/^\.?\//, '').replace(/\/$/, '') : '';
    if (!value) return false;
    switch (rule.type) {
      case 'folder': return rel === value || rel.startsWith(value + '/');
      case 'file': return rel === value;
      case 'suffix': return name.endsWith(rule.value);
      case 'prefix': return name.startsWith(rule.value);
      default: return false;
    }
  });
}

export function formatMB(bytes) { return (bytes / MB).toFixed(2) + ' MB'; }

/** 统计 minigame 目录（含 game.json）的包体。返回各部分大小、合计、超限问题和给面板看的中文文字。 */
export function packageSizeReport(minigame) {
  const game = readJson(path.join(minigame, 'game.json'));
  if (!game) throw Object.assign(Error('找不到 game.json，不是小游戏工程：' + minigame), {code: 'PACKAGE_SIZE_LAYOUT'});
  const config = readJson(path.join(minigame, 'project.config.json')) ?? {};
  const rules = Array.isArray(config.packOptions?.ignore) ? config.packOptions.ignore : [];
  const declared = [...(Array.isArray(game.subpackages) ? game.subpackages : []), ...(Array.isArray(game.subPackages) ? game.subPackages : [])];
  const parts = declared.filter(s => typeof s?.root === 'string').map(s => {
    const root = s.root.replace(/^\.?\//, '').replace(/\/$/, '');
    const name = typeof s.name === 'string' && s.name ? s.name : root;
    const label = LABELS[name] ?? (root.startsWith('scenepacks/') ? '场景分包 ' + name : '分包 ' + name);
    return {name, root, label, independent: s.independent === true, bytes: 0, files: 0};
  });
  const main = {name: '主包', root: '', label: '主包', independent: false, bytes: 0, files: 0};
  let ignoredBytes = 0, entries = 0;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (++entries > 200000) throw Object.assign(Error('小游戏工程里的文件太多，无法统计包体'), {code: 'PACKAGE_SIZE_TOO_MANY'});
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, childRel); continue; }
      if (!entry.isFile()) continue;
      const size = fs.statSync(full).size;
      if (ignoredBy(rules, childRel)) { ignoredBytes += size; continue; }
      const owner = parts.find(p => childRel === p.root || childRel.startsWith(p.root + '/')) ?? main;
      owner.bytes += size;
      owner.files += 1;
    }
  };
  walk(minigame, '');
  const totalBytes = main.bytes + parts.reduce((sum, p) => sum + p.bytes, 0);
  const problems = [];
  if (main.bytes > PACKAGE_LIMITS.mainBytes)
    problems.push({code: 'PACKAGE_MAIN_TOO_LARGE', message: `主包 ${formatMB(main.bytes)}，超过微信限制 4 MB`});
  if (totalBytes > PACKAGE_LIMITS.totalBytes)
    problems.push({code: 'PACKAGE_TOTAL_TOO_LARGE', message: `主包加分包合计 ${formatMB(totalBytes)}，超过微信限制 30 MB`});
  for (const p of parts) if (p.independent && p.bytes > PACKAGE_LIMITS.independentBytes)
    problems.push({code: 'PACKAGE_INDEPENDENT_TOO_LARGE', message: `独立分包 ${p.name} ${formatMB(p.bytes)}，超过微信限制 4 MB`});
  const summary = `包体：主包 ${formatMB(main.bytes)} / 4 MB · 合计 ${formatMB(totalBytes)} / 30 MB` +
    (problems.length ? ' · 超限' : ` · 还可加 ${formatMB(Math.max(0, PACKAGE_LIMITS.totalBytes - totalBytes))}`);
  const lines = [main, ...parts].map(p => `${p.label}${p.name !== p.label && !p.label.endsWith(p.name) ? `（${p.name}）` : ''}：${formatMB(p.bytes)}${p.independent ? '（独立分包）' : ''}`);
  // CDN 远程分包（lib/remote-packs.mjs）：不在小游戏包里，不计入上面的限制，单独列一行。
  const remote = readJson(path.join(minigame, 'wxslim-remote.json'));
  const remotePacks = remote?.packs && typeof remote.packs === 'object' ? Object.entries(remote.packs) : [];
  const remoteBytes = remotePacks.reduce((sum, [, p]) => sum + (Number.isSafeInteger(p?.bytes) ? p.bytes : 0), 0);
  if (remotePacks.length) lines.push(`CDN 远程分包 ${remotePacks.length} 个：${formatMB(remoteBytes)}（不占包体，放在 ${remote.baseUrl}）`);
  return {schema: 'wxslim-package-size-v1', minigame, limits: PACKAGE_LIMITS, mainBytes: main.bytes, totalBytes, ignoredBytes, remoteBytes,
    parts: [main, ...parts].map(({name, root, label, independent, bytes, files}) => ({name, root, label, independent, bytes, files})),
    ok: problems.length === 0, problems, summary, lines};
}
