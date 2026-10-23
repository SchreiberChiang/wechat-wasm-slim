import {fileURLToPath} from 'node:url';
// 工具包自身的测试入口（不联网、不碰小游戏后台）：
//   node tests/run.mjs                               契约测试 + 计时测试 + 所有 .mjs 的 node --check
//   node tests/run.mjs --godot <Godot 4.7.2 可执行文件>  再 headless 跑 tests/godot-flow，核对插件在电脑上的分支和打印格式（也可用环境变量 WXSLIM_GODOT）
//   node tests/run.mjs --flow-log <Godot 输出.txt>     再把一份真实的 Godot 输出（例如 Star Tap 自动测试）回放进计时模块，可以写多次
// 分包运行时（wasm-split.js）的离线测试要真实的官方产物，在 `kit verify --project <工程>` 里跑。
import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process';
import {runContracts} from './contracts.mjs';

const argv = process.argv.slice(2), opts = (k) => argv.flatMap((a, i) => a === '--' + k ? [argv[i + 1]] : a.startsWith('--' + k + '=') ? [a.slice(k.length + 3)] : []);
const godot = opts('godot')[0] || process.env.WXSLIM_GODOT || null, flowLogs = opts('flow-log');
if (godot && !fs.existsSync(godot)) { console.error('找不到 Godot 可执行文件：' + godot); process.exit(2); }
for (const f of flowLogs) if (!fs.existsSync(f)) { console.error('找不到 --flow-log 文件：' + f); process.exit(2); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', '.godot', '.local', 'kit-work', 'work']);
const mjs = []; (function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { if (skip.has(e.name)) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p) : e.name.endsWith('.mjs') && mjs.push(p); } })(root);
const results = mjs.map(f => { const r = spawnSync(process.execPath, ['--check', f], {encoding: 'utf8'}); return {name: 'node --check ' + path.relative(root, f).replace(/\\/g, '/'), ok: r.status === 0, error: (r.stderr || '').slice(0, 400)}; });
for (const rel of ['convert/assets/godot-bridge.js', 'convert/assets/render-runtime.js', 'convert/assets/render-observer.js', 'examples/glx-smoke/local-interfaces.js', 'examples/glx-smoke/frame-probe.js', 'examples/glx-smoke/presentation-probe.js', 'examples/glx-smoke/presentation-loader.js', 'examples/glx-smoke/canvas-export-probe.js', 'examples/glx-native-triangle/strict-post.js']) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, rel)], {encoding: 'utf8'});
  results.push({name: 'node --check ' + rel, ok: r.status === 0, error: (r.stderr || '').slice(0, 400)});
}
results.push(...runContracts({godot, flowLogs}));
const renderTests = spawnSync(process.execPath, ['--test', 'tests/config-tests.mjs', 'tests/render-config-tests.mjs', 'tests/render-runtime-tests.mjs', 'tests/glx-frame-probe-tests.mjs', 'tests/glx-cloud-interfaces-tests.mjs', 'tests/glx-smoke-identity-tests.mjs', 'tests/glx-acceptance-summary-tests.mjs', 'tests/glx-presentation-tests.mjs', 'tests/glx-canvas-export-tests.mjs', 'tests/selfbuild-contract-tests.mjs', 'tests/selfbuild-pair-tests.mjs', 'tests/selfbuild-candidate-tests.mjs', 'tests/shader-failure-js-tests.mjs', 'tests/shader-failure-stage-tests.mjs', 'tests/shader-type-return-tests.mjs', 'tests/shader-type-return-stage-tests.mjs'], {cwd: root, encoding: 'utf8', timeout: 120000});
results.push({name: '配置与 WebGL/GLX 运行时合同', ok: renderTests.status === 0, error: (renderTests.stdout || '') + (renderTests.stderr || '')});

for (const x of results) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.ok ? '' : '\n    ' + x.error.replace(/\n/g, '\n    '));
const failed = results.filter(x => !x.ok).length;
console.log(`结果：通过 ${results.length - failed}，失败 ${failed}${godot ? '' : '（没给 --godot，Godot headless 用例未跑）'}`);
if (failed) process.exitCode = 1;
