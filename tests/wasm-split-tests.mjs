import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {symbolsFromMap, placeholderSymbols, prepareEntryForTool, restoreEntryAfterTool, injectDevtoolsEntry, patchCollectionRuntime,
  COLLECT_MARKER, syncDevtoolsLaunchCode, ignoreInPackage, explainCliFailure} from '../lib/wasm-split.mjs';

const temporary = [];
test.after(() => { for (const d of temporary) fs.rmSync(d, {recursive: true, force: true}); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-wsplit-')); temporary.push(d); return d; };

test('symbols: the Emscripten index:name map becomes {id: name}; names may contain colons', () => {
  assert.deepEqual(symbolsFromMap('0:fimport$0\r\n1:godot::Object::get\n\nbad line\n'), {0: 'fimport$0', 1: 'godot::Object::get'});
  assert.throws(() => symbolsFromMap('\n'), e => e.code === 'WASM_SPLIT_SYMBOLS_EMPTY');
});

test('symbols: an engine without a map gets one placeholder per imported and defined function', () => {
  // magic+version, import section with 2 function imports and 1 memory import, function section with 3 functions.
  const name = s => [s.length, ...Buffer.from(s)];
  const imports = [3, ...name('a'), ...name('x'), 0, 0, ...name('a'), ...name('y'), 0, 1, ...name('a'), ...name('m'), 2, 0, 1];
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 2, imports.length, ...imports, 3, 4, 3, 0, 0, 0]);
  assert.deepEqual(placeholderSymbols(wasm), {0: 'f0', 1: 'f1', 2: 'f2', 3: 'f3', 4: 'f4'});
  assert.throws(() => placeholderSymbols(Buffer.from('not wasm')), e => e.code === 'WASM_SPLIT_NOT_WASM');
});

const ROUTER = "'use strict';\nif(desktop){require('./start-devtools');}else{require('./start-device');}\n";
const DEVICE = "import './godot-data/local-interfaces';\nimport commFrameWork from \"./framework\";\n\nstart();\n";
const DEVTOOLS = "import './godot-data/local-interfaces';\nimport commFrameWork from \"./framework-devtools\";\n\nstart();\n";

test('entry: the router is swapped for the device entry while the tool runs, then both entries get the split runtime and the router comes back', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'game.js'), ROUTER);
  fs.writeFileSync(path.join(d, 'start-device.js'), DEVICE);
  fs.writeFileSync(path.join(d, 'start-devtools.js'), DEVTOOLS);
  const saved = prepareEntryForTool(d);
  assert.equal(fs.readFileSync(path.join(d, 'game.js'), 'utf8'), DEVICE);
  // What the official tool does to game.js.
  fs.writeFileSync(path.join(d, 'game.js'), DEVICE.replace('import commFrameWork', "import './wasm-split.js';\nimport commFrameWork").replace('\n\nstart', '\n\nGameGlobal.WXGameKit.gameInstance.Module["instantiateWasm"] = GameGlobal.instantiateWasm;\nstart'));
  restoreEntryAfterTool(d, saved);
  assert.equal(fs.readFileSync(path.join(d, 'game.js'), 'utf8'), ROUTER);
  for (const f of ['start-device.js', 'start-devtools.js']) {
    const text = fs.readFileSync(path.join(d, f), 'utf8');
    assert.match(text, /import '\.\/wasm-split\.js';\nimport commFrameWork/);
    assert.match(text, /Module\["instantiateWasm"\] = GameGlobal\.instantiateWasm;/);
  }
  assert.equal(injectDevtoolsEntry(fs.readFileSync(path.join(d, 'start-devtools.js'), 'utf8')), fs.readFileSync(path.join(d, 'start-devtools.js'), 'utf8'));
});

test('entry: a single-entry game.js (WebGL result) is left to the official tool', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'game.js'), DEVICE);
  assert.equal(prepareEntryForTool(d), null);
});

test('collection patch: both anchors once, idempotent, and a changed runtime is refused in plain words', () => {
  const runtime = 'x;if(GameGlobal.canUseH5Renderer||c.canAwaitLoad||null!=G(!0)){let e="android&wasm3";y}else r("no signal api, start instantiate sub wasm"),D(!0),_(()=>a(n.instance,n.module))}';
  const patched = patchCollectionRuntime(runtime);
  assert.ok(patched.includes('if(c.canAwaitLoad){let e="android&wasm3"') && patched.includes(COLLECT_MARKER) && patched.includes('D(!1)'));
  assert.equal(patchCollectionRuntime(patched), patched);
  assert.throws(() => patchCollectionRuntime('new runtime'), e => e.code === 'WASM_SPLIT_RUNTIME_CHANGED' && /iPhone/.test(e.message));
});

test('config: the devtools kit config follows launch.code, and the symbols file stays out of the package', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'wx-game-kit'));
  fs.writeFileSync(path.join(d, 'wx-game-kit', 'config.json'), JSON.stringify({launch: {code: {fileMD5: 'a', useWasmCodeSplit: true}, data: {fileMD5: 'd1'}}}));
  fs.writeFileSync(path.join(d, 'wx-game-kit', 'config.devtools.json'), JSON.stringify({launch: {code: {fileMD5: 'a', useWasmCodeSplit: false}, data: {fileMD5: 'd2'}}, other: 1}));
  syncDevtoolsLaunchCode(d);
  const dev = JSON.parse(fs.readFileSync(path.join(d, 'wx-game-kit', 'config.devtools.json'), 'utf8'));
  assert.deepEqual([dev.launch.code.useWasmCodeSplit, dev.launch.data.fileMD5, dev.other], [true, 'd2', 1]);
  fs.writeFileSync(path.join(d, 'project.config.json'), JSON.stringify({packOptions: {ignore: [{type: 'folder', value: '.plugincache'}]}}));
  ignoreInPackage(d, 'game.symbols.json'); ignoreInPackage(d, 'game.symbols.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'project.config.json'), 'utf8')).packOptions.ignore.map(x => x.value), ['.plugincache', 'game.symbols.json']);
});

test('official tool failures are explained', () => {
  assert.equal(explainCliFailure('[ERROR] API 业务错误 [-10000401]: no privileges').field, 'wasmsplitKey');
  assert.match(explainCliFailure('[ERROR] API 业务错误 [-10000401]: no privileges').message, /Wasm 分包 CI 鉴权配置/);
  assert.equal(explainCliFailure('✗ init 失败: [4004] game.js 中缺少注入标记或锚点').code, 'WASM_SPLIT_ENTRY_ANCHOR');
  assert.match(explainCliFailure('line\n✗ dosplit 失败: 网络超时').message, /网络超时/);
});

test('iPhone code2 delay: the one official constant is rewritten in milliseconds; a changed runtime is refused', async () => {
  const {setIosCode2Delay} = await import('../lib/wasm-split.mjs');
  const runtime = 'var c={canAwaitLoad:!1,ARCHIVE_URL:void 0,kDelayLoadWasmcode2Time:3e4,kDelayFuncInitTime:0}';
  assert.match(setIosCode2Delay(runtime, 5), /kDelayLoadWasmcode2Time:5000,/);
  assert.match(setIosCode2Delay(setIosCode2Delay(runtime, 0), 30), /kDelayLoadWasmcode2Time:30000,/);
  assert.throws(() => setIosCode2Delay(runtime, -1), e => e.code === 'WASM_SPLIT_DELAY');
  assert.throws(() => setIosCode2Delay('no constant', 5), e => e.code === 'WASM_SPLIT_RUNTIME_CHANGED');
});
