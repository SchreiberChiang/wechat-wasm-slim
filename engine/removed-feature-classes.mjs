// Generates lib/removed-feature-classes.json: the Godot classes that the trimmed
// templates no longer register, read from the pinned c050 source.
//   node engine/removed-feature-classes.mjs C050_GIT_DIR [--write]
// A game that loads any of these classes cannot run on that template.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeCustomWasmRequest} from './custom-wasm-plan.mjs';
import {customModuleSelection} from './custom-module-selection.mjs';
import {PURE_2D_FEATURES, CONSERVATIVE_MODULES} from '../lib/quick-flow.mjs';

const COMMIT = 'c050c09b105c3715e1caa57a7109cd752047fd89';
const [gitDir, flag] = process.argv.slice(2);
if (!gitDir || ![undefined, '--write'].includes(flag)) throw Error('node engine/removed-feature-classes.mjs C050_GIT_DIR [--write]');
const git = (...args) => execFileSync('git', ['--git-dir', gitDir, ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const show = file => git('show', `${COMMIT}:${file}`);
const REGISTER = /\b(?:GDREGISTER_(?:ABSTRACT_|VIRTUAL_|INTERNAL_|RUNTIME_)?CLASS|ClassDB::register_(?:abstract_|virtual_|internal_|runtime_|custom_instance_)?class<)\s*\(?\s*([A-Z][A-Za-z0-9_]*)/g;

// Classes registered inside preprocessor blocks that the given defines switch off.
// Each block is evaluated twice: with the trimmed build's defines and with none
// (the full build). A class counts as removed when the full build registers it
// and the trimmed build does not. Unrelated conditions (tools, platforms) count as on.
function guardedClasses(text, disabled) {
  const evaluate = (condition, defines) => {
    const expr = condition.replace(/\/\/.*$/, '').replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, name) => defines.has(name) ? 'true' : 'false');
    if (!/^[\s!()|&]*((true|false)[\s!()|&]*)*$/.test(expr)) return true;
    return Function(`return (${expr});`)();
  };
  const none = new Set(), stack = [];
  const frame = (trim, full) => ({trim, full});
  const found = new Set();
  for (const line of text.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = /^#ifndef\s+(\w+)/.exec(t))) stack.push(frame(!disabled.has(m[1]), true));
    else if ((m = /^#ifdef\s+(\w+)/.exec(t))) stack.push(frame(disabled.has(m[1]), false));
    else if ((m = /^#if\s+(.*)$/.exec(t))) stack.push(frame(evaluate(m[1], disabled), evaluate(m[1], none)));
    else if (/^#else/.test(t)) { const top = stack.pop(); stack.push(frame(!top.trim, !top.full)); }
    else if (/^#endif/.test(t)) stack.pop();
    else if (stack.every(f => f.full) && !stack.every(f => f.trim)) for (const r of line.matchAll(REGISTER)) found.add(r[1]);
  }
  return found;
}

function moduleClasses(module) {
  const files = git('ls-tree', '-r', '--name-only', COMMIT, `modules/${module}/`).split('\n').filter(f => /\.(cpp|h)$/.test(f) && !f.includes('/thirdparty/'));
  const found = new Set();
  for (const file of files) for (const r of show(file).matchAll(REGISTER)) found.add(r[1]);
  return found;
}

function removedModules(features) {
  const modules = customModuleSelection(normalizeCustomWasmRequest(features));
  return [...new Set([...modules.explicitDisabledModules, ...modules.additionalRemovedFromFull])].sort();
}

function template(features, coreDefines) {
  const classes = {};
  if (coreDefines.length) {
    const disabled = new Set(coreDefines);
    for (const file of ['scene/register_scene_types.cpp', 'servers/register_server_types.cpp'])
      for (const name of guardedClasses(show(file), disabled)) classes[name] ??= 'Godot 3D';
  }
  const modules = removedModules(features);
  for (const module of modules) for (const name of moduleClasses(module)) classes[name] ??= 'module:' + module;
  return {removedModules: modules, classes: Object.fromEntries(Object.entries(classes).sort(([a], [b]) => a < b ? -1 : 1))};
}

const result = {
  schema: 'wxslim-removed-feature-classes-v1',
  source: {repository: 'godotengine/godot', commit: COMMIT, generator: 'engine/removed-feature-classes.mjs'},
  templates: {
    '2d': template(PURE_2D_FEATURES, ['_3D_DISABLED', 'PHYSICS_3D_DISABLED', 'NAVIGATION_3D_DISABLED', 'XR_DISABLED']),
    conservative: template({...PURE_2D_FEATURES, dimensions: '3d', disabledModules: [...CONSERVATIVE_MODULES]}, []),
  },
};
const out = fileURLToPath(new URL('../lib/removed-feature-classes.json', import.meta.url));
const text = JSON.stringify(result, null, 2) + '\n';
if (flag === '--write') fs.writeFileSync(out, text);
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.templates).map(([k, v]) => [k, {modules: v.removedModules.length, classes: Object.keys(v.classes).length}]))));
