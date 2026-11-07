// 一键运行「需要外部材料」的回归测试。
//
// 这些测试故意不带替代夹具：缺材料就失败，避免误以为测过。本脚本只做两件事：
//   1. 在本机的历史构建目录和迁移证据目录里收集候选材料（原始抓取、转换输出、引擎源码、启动 PCK、Python）；
//   2. 对每个测试文件逐个尝试候选组合，由测试自己按固定指纹判断材料对不对；第一个全部通过的组合即记为结果。
// 不下载、不编译、不修改材料；测试本身只读。已手动设置的环境变量优先，不会被覆盖。
//
// 用法：node tests/run-external.mjs [--root DIR]... [--all] [--json FILE]
//   --root  额外的材料根目录；默认 ../../clean-20261104 和 ../portable-proof-01/proof（相对 source）
//   --all   找到材料后，用同一组环境变量再跑一遍全部测试（工作台 + tests/）
//   --json  把结果另存为 JSON
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const roots = [];
let all = false, jsonOut = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1]) roots.push(path.resolve(args[++i]));
  else if (args[i] === '--all') all = true;
  else if (args[i] === '--json' && args[i + 1]) jsonOut = path.resolve(args[++i]);
  else { console.error('用法：node tests/run-external.mjs [--root DIR]... [--all] [--json FILE]'); process.exit(2); }
}
if (!roots.length) roots.push(path.resolve(source, '../../clean-20261104'), path.resolve(source, '../portable-proof-01/proof'));
const existingRoots = roots.filter(dir => fs.existsSync(dir));

// ---------- 收集候选 ----------
const SKIP = new Set(['node_modules', '.git', 'emsdk', 'temp', 'logs', 'obj', 'bin']);
function walk(root, depth, visit) {
  let entries;
  try { entries = fs.readdirSync(root, {withFileTypes: true}); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) { if (depth > 0 && !SKIP.has(entry.name)) { visit(file, true); walk(file, depth - 1, visit); } }
    else visit(file, false);
  }
}
const found = {rawDirs: [], rawJs: [], frameworks: [], minigames: [], engineSources: [], requests: [], pcks: [], pythons: []};
for (const root of existingRoots) {
  walk(root, 6, (file, isDir) => {
    const name = path.basename(file);
    if (isDir) {
      if (name === 'engine' && fs.existsSync(path.join(file, 'platform', 'web', 'js', 'libs', 'library_godot_input.js'))) found.engineSources.push(file);
      return;
    }
    if (name === 'godot.raw.js') {
      found.rawJs.push(file);
      if (fs.existsSync(path.join(path.dirname(file), 'godot.wasm'))) found.rawDirs.push(path.dirname(file));
    } else if (name === 'framework.js' && file.includes(`${path.sep}minigame${path.sep}`)) {
      found.frameworks.push(file);
      if (fs.existsSync(path.join(path.dirname(file), 'wx-game-kit', 'config.json'))) found.minigames.push(path.dirname(file));
    }
    else if (name === 'REQUEST.json' && fs.statSync(file).size < 20000) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('"gitExecutable"') && text.includes('"upstreamSource"')) found.requests.push(file);
    } else if (name.endsWith('.pck') && fs.statSync(file).size < 64 * 1024 * 1024) found.pcks.push(file);
    else if (name === 'python.exe' && file.includes(`${path.sep}venv${path.sep}`)) found.pythons.push(file);
    // 原始 JS 不一定叫 godot.raw.js（例如 emscripten-before-godot-process.js），构建产物目录里的 JS 都算候选，靠指纹筛。
    else if (name.endsWith('.js') && path.basename(path.dirname(file)) === 'artifacts') found.rawJs.push(file);
  });
}
// 2D 启动 PCK 只取被历史 2D 功能声明绑定的那一份，避免把所有 PCK 都试一遍。
const usageFiles = [];
for (const root of existingRoots) walk(root, 4, (file, isDir) => { if (!isDir && path.basename(file) === 'startup-usage.json') usageFiles.push(file); });
const wantedPck = new Set(usageFiles.map(f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).pck?.sha256; } catch { return null; } }).filter(Boolean));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
found.startupPcks = found.pcks.filter(file => wantedPck.has(sha(file)));
const dedupe = list => [...new Set(list.map(f => path.resolve(f)))];
for (const key of Object.keys(found)) found[key] = dedupe(found[key]);
const imeFiles = found.engineSources.map(dir => path.join(dir, 'platform', 'web', 'js', 'libs', 'library_godot_input.js'));

// 测试里写死了指纹的单个文件：先按指纹筛候选，筛不出就直接报缺材料，不白跑。
const PINS = {
  WXSLIM_C050_EXISTING_FRAMEWORK: '19b61328740c90e9e45e7b8ee5483763768881425afd721584baedc59b98bbbe', // 第一次真实 c050 转换的 framework.js
  WXSLIM_GRAPHICS_RAW_JS: '982e4241ffbf1d69039e7c460fc1c403f551d414be811f0569111eed3361f2af', // 图形修正用的官方原始 godot.raw.js（478,655 字节，见 engine/official-graphics-postprocess.mjs referenceInput）
};
const pinned = (list, pin) => list.filter(file => sha(file) === pin);

// ---------- 每个测试需要什么 ----------
// 每项是 {变量: 候选列表}；脚本按笛卡尔积逐个尝试。WXSLIM_MODEL_PYTHON 对所有测试都设置。
const PLANS = [
  ['tests/custom-c050-output-tests.mjs', {OFFICIAL_CAPTURE_RAW_DIR: found.rawDirs}],
  ['tests/custom-host-bindings-tests.mjs', {OFFICIAL_CAPTURE_RAW_DIR: found.rawDirs}],
  ['tests/custom-project-usage-tests.mjs', {WXSLIM_CUSTOM_STARTUP_PCK: found.startupPcks}],
  ['tests/official-c050-existing-output-tests.mjs', {OFFICIAL_CAPTURE_RAW_DIR: found.rawDirs, WXSLIM_C050_EXISTING_FRAMEWORK: pinned(found.frameworks, PINS.WXSLIM_C050_EXISTING_FRAMEWORK)}],
  ['tests/official-c050-output-contract-tests.mjs', {OFFICIAL_CAPTURE_RAW_DIR: found.rawDirs}],
  ['tests/official-capability-followup-source-tests.mjs', {WXSLIM_CAPABILITY_FOLLOWUP_SOURCE: found.engineSources, WXSLIM_CAPABILITY_FOLLOWUP_REQUEST: found.requests}],
  ['tests/official-http-response-source-tests.mjs', {WXSLIM_C050_HTTP_SOURCE: found.engineSources}],
  ['tests/official-ime-session-tests.mjs', {WXSLIM_IME_SESSION_SOURCE: imeFiles}],
  ['tests/official-raw-postprocess-tests.mjs', {OFFICIAL_CAPTURE_RAW_DIR: found.rawDirs}],
  ['tests/custom-stored-wasm-tests.mjs', {WXSLIM_EXISTING_CAPABILITY_PROJECT: found.minigames}],
  ['tests/official-shader-glue-reference-tests.mjs', {WXSLIM_GRAPHICS_RAW_JS: pinned(found.rawJs, PINS.WXSLIM_GRAPHICS_RAW_JS)}],
];

function combinations(spec) {
  let combos = [{}];
  for (const [key, values] of Object.entries(spec)) {
    const fixed = process.env[key] ? [process.env[key]] : values;
    combos = combos.flatMap(c => fixed.map(v => ({...c, [key]: v})));
  }
  return combos;
}

function runTests(files, env) {
  const result = spawnSync(process.execPath, ['--test', ...files], {cwd: source, env: {...process.env, ...env}, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  const out = (result.stdout || '') + (result.stderr || '');
  const count = name => Number((out.match(new RegExp(`^ℹ ${name} (\\d+)`, 'm')) || [])[1] ?? NaN);
  const firstError = (out.match(/^\s*(AssertionError[^\n]*|Error[^\n]*)/m) || [])[1] ?? '';
  const tail = out.split(/^✖ failing tests:/m)[1] || '';
  const failing = [...new Set(tail.split(/\r?\n/).filter(l => l.startsWith('✖ ')).map(l => l.slice(2).replace(/ \([\d.]+ms\)$/, '')))];
  return {pass: count('pass'), fail: count('fail'), tests: count('tests'), firstError: firstError.trim().slice(0, 200), failing};
}

const python = process.env.WXSLIM_MODEL_PYTHON || found.pythons[0] || '';
const common = python ? {WXSLIM_MODEL_PYTHON: python} : {};
const report = {schema: 'wxslim-external-tests-v1', at: new Date().toISOString(), roots: existingRoots,
  candidates: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])), python, results: []};
const chosen = {...common};

console.log(`材料根目录：${existingRoots.join('；') || '（都不存在）'}`);
console.log(`候选：原始抓取 ${found.rawDirs.length}，framework ${found.frameworks.length}，转换输出 ${found.minigames.length}，引擎源码 ${found.engineSources.length}，请求 ${found.requests.length}，2D 启动 PCK ${found.startupPcks.length}，Python ${python ? 1 : 0}`);
for (const [file, spec] of PLANS) {
  const combos = combinations(spec);
  if (!combos.length || Object.values(spec).some(v => !v.length && !process.env[Object.keys(spec).find(k => spec[k] === v)])) {
    const missing = Object.entries(spec).filter(([k, v]) => !v.length && !process.env[k]).map(([k]) => k);
    report.results.push({file, status: 'NOT_RUN', missing, pins: Object.fromEntries(missing.filter(k => PINS[k]).map(k => [k, PINS[k]]))});
    console.log(`未运行  ${file}：缺 ${missing.map(k => PINS[k] ? `${k}（指纹 ${PINS[k].slice(0, 12)}…，本机找不到）` : k).join('、')}`);
    continue;
  }
  let best = null;
  for (const combo of combos) {
    const outcome = runTests([file], {...common, ...combo});
    if (!best || outcome.fail < best.outcome.fail) best = {combo, outcome};
    if (outcome.fail === 0 && outcome.pass > 0) break;
  }
  const ok = best.outcome.fail === 0 && best.outcome.pass > 0;
  report.results.push({file, status: ok ? 'PASS' : 'FAIL', tried: combos.length, env: best.combo, ...best.outcome});
  if (ok) Object.assign(chosen, best.combo);
  console.log(`${ok ? '通过' : '失败'}    ${file}：${best.outcome.pass}/${best.outcome.tests}${ok ? '' : '，' + best.outcome.firstError}`);
  for (const [k, v] of Object.entries(best.combo)) console.log(`        ${k}=${v}`);
}

if (all) {
  const files = [...fs.readdirSync(path.join(source, 'editor', 'workbench')).filter(f => f.endsWith('-tests.mjs')).map(f => path.join('editor', 'workbench', f)),
    ...fs.readdirSync(path.join(source, 'tests')).filter(f => f.endsWith('-tests.mjs')).map(f => path.join('tests', f))];
  const outcome = runTests(files, chosen);
  report.all = {env: chosen, ...outcome};
  console.log(`\n全部测试（带上面找到的材料）：${outcome.pass} 通过，${outcome.fail} 失败，共 ${outcome.tests}`);
  for (const name of outcome.failing) console.log('  失败：' + name);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
const failed = report.results.filter(r => r.status !== 'PASS').length;
console.log(`\n需外部材料的 ${PLANS.length} 个测试文件：${PLANS.length - failed} 个通过，${failed} 个未通过或未运行。`);
process.exitCode = failed || (report.all && report.all.fail) ? 1 : 0;
