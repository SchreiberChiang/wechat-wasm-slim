// 把一次已经验收过的重建引擎（offline/verify-rebuilt.mjs 的输出目录）换成随附引擎：
// 写 offline/vendor/engines/<pair>/{godot.wasm,godot.prepared.js,fingerprint.json}，
// 并更新 packaging/vendor-lock.json、offline/inputs.json 和 convert/lib/bundled-pair.mjs 里的指纹。
//
//   node offline/bundle-rebuilt-engine.mjs conservative|pure-2d CHECK_DIR [--startup-prewarm-skippable] --write
//
// 不加 --write 只打印将要写入的内容。完整模板的引擎不经过这里。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readPreparedSource} from '../convert/lib/official-custom-context.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write'), skippable = args.includes('--startup-prewarm-skippable');
const [pair, checkArg] = args.filter(a => !a.startsWith('--'));
assert(['conservative', 'pure-2d'].includes(pair) && checkArg,
  'Usage: node offline/bundle-rebuilt-engine.mjs conservative|pure-2d CHECK_DIR [--startup-prewarm-skippable] [--write]');
const source = fileURLToPath(new URL('../', import.meta.url));
const check = path.resolve(checkArg);
const sha = b => createHash('sha256').update(b).digest('hex');
const pin = b => ({bytes: b.length, sha256: sha(b)});
const result = JSON.parse(fs.readFileSync(path.join(check, 'result.json'), 'utf8'));
assert.equal(result.recipe, pair, 'CHECK_DIR belongs to another recipe');
assert.equal(result.sourceAudit, 'PASS_SOURCE_STATIC_ONLY', 'The rebuilt pair must pass verify-rebuilt first');
const preparation = path.join(check, 'preparation.json');
const prepared = await readPreparedSource(preparation);
const s = prepared.summary;
assert.equal(s.taskId, result.rawTaskId);
const raw = JSON.parse(fs.readFileSync(preparation, 'utf8')).rawTaskRoot;
const build = JSON.parse(fs.readFileSync(path.join(raw, 'BUILD.json'), 'utf8'));
const wasm = fs.readFileSync(path.join(build.plan.artifactRoot || path.join(raw, 'artifacts'), 'godot.wasm'));
const js = fs.readFileSync(path.join(check, 'godot.prepared.js'));
assert.deepEqual(pin(wasm), {bytes: s.inputs.wasm.bytes, sha256: s.inputs.wasm.sha256});
assert.deepEqual(pin(js), {bytes: s.outputJs.bytes, sha256: s.outputJs.sha256});
const receiptBytes = fs.readFileSync(path.join(check, 'preparation-receipt.json'));
const buildBytes = fs.readFileSync(path.join(raw, 'BUILD.json'));

// 转换时只核对标题和图标两个导入的签名（convert/lib/official-c050-adapter.mjs customOutputExpected）。
const host = s.derivation.hostProposal, text = js.toString('utf8');
const importKey = name => { const m = new RegExp('([A-Za-z_$][\\w$]*):\\s*' + name.replace(/\$/g, '\\$') + '\\b').exec(text); assert(m, 'import for ' + name); return m[1]; };
const wanted = ['_godot_js_display_window_title_set', '_godot_js_display_window_icon_set'].map(importKey);
const importBindings = wanted.map(name => { const b = host.allImportBindings.find(x => x.module === 'a' && x.name === name); assert(b, 'binding ' + name); return b; });

const previous = JSON.parse(fs.readFileSync(path.join(source, 'offline/vendor/engines', pair, 'fingerprint.json'), 'utf8'));
const fingerprint = {
  schema: 'wxslim-bundled-engine-fingerprint-v1', pair,
  js: pin(js), wasm: pin(wasm), features: s.features, sourceCommit: s.sourceCommit, sourceRecipe: s.sourceRecipe,
  sourcePlanSha256: s.sourcePlanSha256, taskId: s.taskId, originalBuildStatus: 'SUCCESS',
  receipt: pin(receiptBytes), build: pin(buildBytes), selectedProfile: s.selectedProfile,
  rawJs: {bytes: s.inputs.js.bytes, sha256: s.inputs.js.sha256}, bridge: {bytes: s.outputBridge.bytes, sha256: s.outputBridge.sha256},
  nativeMapping: host.nativeMapping, importBindings, removedModules: previous.removedModules,
  ...(skippable ? {startupPrewarmSkippable: true} : {}),
};
const fingerprintBytes = Buffer.from(JSON.stringify(fingerprint, null, 2) + '\n');
assert(fingerprintBytes.length <= 8192, 'fingerprint must stay under 8 KiB');
const plan = {pair, taskId: s.taskId, wasm: pin(wasm), js: pin(js), fingerprint: pin(fingerprintBytes), startupPrewarmSkippable: skippable};
console.log(JSON.stringify(plan, null, 2));
if (!write) process.exit(0);

const dir = path.join(source, 'offline/vendor/engines', pair);
fs.writeFileSync(path.join(dir, 'godot.wasm'), wasm);
fs.writeFileSync(path.join(dir, 'godot.prepared.js'), js);
fs.writeFileSync(path.join(dir, 'fingerprint.json'), fingerprintBytes);
const rel = name => `engines/${pair}/${name}`;
const files = {[rel('godot.wasm')]: pin(wasm), [rel('godot.prepared.js')]: pin(js), [rel('fingerprint.json')]: pin(fingerprintBytes)};

const lockFile = path.join(source, 'packaging/vendor-lock.json');
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
for (const [name, value] of Object.entries(files)) { assert(lock.files[name], 'vendor-lock lacks ' + name); lock.files[name] = value; }
if (skippable) lock.pairs[pair].startupPrewarmSkippable = true; else delete lock.pairs[pair].startupPrewarmSkippable;
fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');

const inputsFile = path.join(source, 'offline/inputs.json');
const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
for (const [name, value] of Object.entries(files)) {
  const row = inputs.files['vendor/' + name];
  assert(row, 'offline/inputs.json lacks vendor/' + name);
  Object.assign(row, value, {origin: 'packaging/vendor-lock.json'});
}
fs.writeFileSync(inputsFile, JSON.stringify(inputs, null, 2) + '\n');

const pairFile = path.join(source, 'convert/lib/bundled-pair.mjs');
const code = fs.readFileSync(pairFile, 'utf8');
const key = pair === 'conservative' ? 'conservative' : "'pure-2d'";
const re = new RegExp('(\\n  ' + key.replace(/[-']/g, m => '\\' + m) + ": ')[0-9a-f]{64}(')");
assert(re.test(code), 'bundled-pair.mjs fingerprint line');
fs.writeFileSync(pairFile, code.replace(re, `$1${pin(fingerprintBytes).sha256}$2`));
console.log('written');
