// 按场景分包：从游戏工程源码算出每个选中场景「独占」的文件，再对应到导出 PCK 里的条目。
//
// 规则偏保守，宁可多留在首包，也不把首包要用的文件挪走：
//   - 依赖来自工程里文本资源（.tscn / .tres）中出现的全部 res:// 和 uid:// 引用；
//   - 首包会用到的：project.godot 里的引用（主场景、自动加载、图标等）、脚本里的 res:// / uid:// 字面量、
//     以及没被任何选中场景用到的其他文本资源（可能按路径动态加载）。它们及其依赖都留在首包；
//   - 场景 S 的分包只放：S 的依赖闭包里，首包用不到、其他选中场景也用不到的文件；
//   - 脚本和工程元数据由拆包核心强制留在首包。
// 用字符串拼出来的动态加载（load("res://levels/" + name)）分析不到，界面会提示作者自行确认。
// 这里只算归属；拆包本身仍由共用任务 resource-pck-partition 按实际 PCK 字节执行和审核。
import fs from 'node:fs';
import path from 'node:path';
import {inspectPck} from './pck-inventory.mjs';

const TEXT_RESOURCE = /\.(tscn|tres)$/i;
const SCRIPT = /\.(gd|cs)$/i;
const SCENE = /\.(tscn|scn)$/i;
const BOOT_ONLY = /\.(gd|gdc)(\.remap)?$/i;
const MAX_FILES = 50000, MAX_TEXT = 4 * 1024 * 1024;
export const SCENE_PACK_ROOT = 'scenepacks';
const RES_LITERAL = /res:\/\/[^"'\s\]\[)(,]+/g;
const UID_LITERAL = /uid:\/\/[0-9a-z]+/g;

function sceneError(code, message, field = 'scenes') {
  return Object.assign(Error(message), {code, field});
}

/** 包名：场景文件名转小写，非法字符换成下划线；重名时加序号。 */
export function scenePackId(scene, used = new Set()) {
  let base = path.posix.basename(scene).replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
  if (!/^[a-z]/.test(base)) base = 'pack_' + base;
  base = base.slice(0, 44);
  let id = base, n = 2;
  while (used.has(id) || ['boot', 'wasmcode', 'data-package'].includes(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

function walk(projectDir) {
  const files = [];
  const visit = (dir, rel, depth) => {
    if (depth > 32) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), childRel, depth + 1);
      else if (entry.isFile()) {
        files.push(childRel);
        if (files.length > MAX_FILES) throw sceneError('QUICK_SCENES_PROJECT_TOO_LARGE', '游戏工程文件太多，无法分析分包依赖');
      }
    }
  };
  visit(projectDir, '', 0);
  return files;
}

function readText(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_TEXT) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

const stripRes = value => value.replace(/^res:\/\//, '');

/** 工程源码的引用图。只读，不改工程。 */
export function sceneSourceGraph(projectDir) {
  const files = walk(projectDir);
  const known = new Set(files);
  const uids = new Map();
  const texts = new Map();
  for (const rel of files) {
    if (TEXT_RESOURCE.test(rel) || SCRIPT.test(rel) || rel.endsWith('.import') || rel.endsWith('.uid')) {
      const text = readText(path.join(projectDir, rel));
      texts.set(rel, text);
      if (TEXT_RESOURCE.test(rel)) {
        const head = /^\s*\[gd_(?:scene|resource)\b[^\]]*\buid="(uid:\/\/[0-9a-z]+)"/.exec(text);
        if (head) uids.set(head[1], rel);
      } else if (rel.endsWith('.import')) {
        const match = /^uid="(uid:\/\/[0-9a-z]+)"/m.exec(text);
        if (match) uids.set(match[1], rel.slice(0, -'.import'.length));
      } else if (rel.endsWith('.uid')) {
        const match = /^(uid:\/\/[0-9a-z]+)\s*$/.exec(text.trim());
        if (match) uids.set(match[1], rel.slice(0, -'.uid'.length));
      }
    }
  }
  const references = text => {
    const found = new Set();
    for (const match of text.matchAll(RES_LITERAL)) {
      const rel = stripRes(match[0]);
      if (known.has(rel)) found.add(rel);
    }
    for (const match of text.matchAll(UID_LITERAL)) {
      const rel = uids.get(match[0]);
      if (rel) found.add(rel);
    }
    return found;
  };
  const deps = new Map();
  for (const rel of files) if (TEXT_RESOURCE.test(rel)) deps.set(rel, references(texts.get(rel) ?? ''));
  const scripts = new Map();
  for (const rel of files) if (SCRIPT.test(rel)) {
    const text = texts.get(rel) ?? '';
    const preloaded = new Set();
    for (const match of text.matchAll(/preload\s*\(\s*["']((?:res|uid):\/\/[^"']+)["']\s*\)/g)) {
      const rel2 = match[1].startsWith('uid://') ? uids.get(match[1]) : stripRes(match[1]);
      if (rel2) preloaded.add(rel2);
    }
    scripts.set(rel, {references: references(text), preloaded});
  }
  const projectRefs = references(readText(path.join(projectDir, 'project.godot')));
  return {files: known, deps, scripts, projectRefs, uids};
}

function closure(starts, deps) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const next of deps.get(rel) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/**
 * 计算每个选中场景独占的源码文件。scenes 为 res:// 路径。
 * 返回 [{scene, rel, own:Set<源码相对路径>}]；无法安全分包时抛出带 field 的错误。
 */
export function sceneOwnership(graph, scenes, mainScene) {
  const selected = scenes.map(scene => {
    if (typeof scene !== 'string' || !scene.startsWith('res://') || !SCENE.test(scene))
      throw sceneError('QUICK_SCENES_PATH', `分包场景必须是 res:// 开头的 .tscn 或 .scn 文件：${scene}`);
    const rel = stripRes(scene);
    if (!graph.files.has(rel)) throw sceneError('QUICK_SCENES_MISSING', `游戏工程里找不到这个场景：${scene}`);
    return {scene, rel};
  });
  if (new Set(selected.map(s => s.rel.toLowerCase())).size !== selected.length)
    throw sceneError('QUICK_SCENES_DUPLICATE', '分包场景列表里有重复的场景');
  if (mainScene && selected.some(s => s.scene === mainScene))
    throw sceneError('QUICK_SCENES_MAIN', `主场景 ${mainScene} 是游戏启动时就要用的，不能放进分包`);
  const closures = new Map(selected.map(s => [s.rel, closure([s.rel], graph.deps)]));
  const anySelected = new Set([...closures.values()].flatMap(set => [...set]));
  const roots = new Set(graph.projectRefs);
  const selectedRels = new Set(selected.map(s => s.rel));
  for (const [script, info] of graph.scripts) {
    for (const rel of info.references) {
      // 脚本里写场景路径用于切换场景（change_scene_to_file）是正常用法；preload 则会在首包加载时就要这个场景。
      if (selectedRels.has(rel) && !info.preloaded.has(rel)) continue;
      if (selectedRels.has(rel)) throw sceneError('QUICK_SCENES_PRELOADED', `脚本 res://${script} 用 preload 提前加载了 res://${rel}，它必须留在首包。请改成 load，或不分包这个场景`);
      roots.add(rel);
    }
  }
  for (const rel of graph.deps.keys()) if (!anySelected.has(rel)) roots.add(rel);
  const bootReach = closure(roots, graph.deps);
  return selected.map(s => {
    if (bootReach.has(s.rel)) throw sceneError('QUICK_SCENES_USED_BY_BOOT', `场景 ${s.scene} 被首包里的内容直接引用（主场景、自动加载、其他场景或工程设置），不能单独分包`);
    for (const other of selected) if (other !== s && closures.get(other.rel).has(s.rel))
      throw sceneError('QUICK_SCENES_NESTED', `场景 ${s.scene} 已经被分包场景 ${other.scene} 用到，只保留外层那个即可`);
    const own = new Set();
    for (const rel of closures.get(s.rel)) {
      if (bootReach.has(rel) || SCRIPT.test(rel)) continue;
      if (selected.some(other => other !== s && closures.get(other.rel).has(rel))) continue;
      own.add(rel);
    }
    return {...s, own};
  });
}

function entryText(pck, entry) {
  if (entry.bytes > 64 * 1024) return '';
  return pck.subarray(entry.offset, entry.offset + entry.bytes).toString('utf8');
}

/** 源码文件 → PCK 里的条目（文件本身、.remap 及其目标、.import 及导入产物、.uid）。 */
export function pckEntriesFor(rel, entries, pck) {
  const found = [];
  const add = name => { if (entries.has(name) && !BOOT_ONLY.test(name) && !found.includes(name)) found.push(name); };
  add(rel);
  add(rel + '.uid');
  for (const sidecar of [rel + '.remap', rel + '.import']) {
    const entry = entries.get(sidecar);
    if (!entry) continue;
    add(sidecar);
    for (const match of entryText(pck, entry).matchAll(/"res:\/\/(\.godot\/(?:exported|imported)\/[^"]+)"/g)) add(match[1]);
  }
  return found;
}

/**
 * 按场景分包的完整计划：拆包核心要的 packs（每个条目恰好属于一个包）和资源配置要的分包信息。
 * pck 为本次导出的完整 PCK 字节。
 */
export function planScenePacks({projectDir, scenes, mainScene, pck}) {
  const graph = sceneSourceGraph(projectDir);
  const owned = sceneOwnership(graph, scenes, mainScene);
  const inventory = inspectPck(pck);
  const entries = new Map(inventory.entries.map(entry => [entry.path, entry]));
  const assigned = new Map();
  const used = new Set();
  const resources = owned.map(s => {
    const id = scenePackId(s.rel, used);
    const paths = [];
    for (const rel of [...s.own].sort()) for (const name of pckEntriesFor(rel, entries, pck)) {
      if (assigned.has(name)) continue;
      assigned.set(name, id);
      paths.push(name);
    }
    const sceneEntries = pckEntriesFor(s.rel, entries, pck);
    if (!sceneEntries.length) throw sceneError('QUICK_SCENES_NOT_EXPORTED', `导出的 PCK 里没有场景 ${s.scene}，请检查导出预设的资源筛选`);
    const bytes = paths.reduce((sum, name) => sum + entries.get(name).bytes, 0);
    return {id, role: 'resource', scene: s.scene, root: `${SCENE_PACK_ROOT}/${id}`, paths, payloadBytes: bytes};
  });
  const boot = inventory.entries.map(entry => entry.path).filter(name => !assigned.has(name));
  return {
    packs: [{id: 'boot', role: 'boot', paths: boot}, ...resources.map(r => ({id: r.id, role: 'resource', paths: r.paths}))],
    resources,
    bootEntries: boot.length,
    source: {bytes: inventory.bytes, sha256: inventory.sha256},
  };
}

/** 拆包结果 → 资源配置（wxslim-resource-packs-v1）。packFile(id) 给出拆包任务写出的实际文件。 */
export function scenePackResourceConfig(plan, mainScene, packFile, pinOf) {
  return {
    schema: 'wxslim-resource-packs-v1',
    packs: [
      {id: 'boot', role: 'boot', file: packFile('boot'), ...pinOf('boot'), requires: [], entryScene: mainScene},
      ...plan.resources.map(r => ({id: r.id, role: 'resource', file: packFile(r.id), ...pinOf(r.id), requires: [], root: r.root, entryScene: r.scene})),
    ],
    dependencies: [], reservedRoots: [], reservedNames: [],
  };
}
