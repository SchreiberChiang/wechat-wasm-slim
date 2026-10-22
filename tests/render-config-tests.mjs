// Generated render contract and CLI precedence: offline structural checks, no real engine or transformer execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyRenderContract, verifyProject, PLACEHOLDER_APPID} from '../convert/lib/verify.mjs';
import {renderManifest} from '../convert/lib/render.mjs';
import {FORMAT} from '../lib/game-config.mjs';
import {MODULE_TAIL, sha, md5} from '../convert/lib/inputs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const asset = name => fs.readFileSync(new URL('../convert/assets/' + name, import.meta.url), 'utf8');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-render-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('wxslim-render-test-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return dir;
}
const manifestFor = mode => renderManifest({renderMode: mode, js: Buffer.from('test engine'), wasm: Buffer.from('test wasm'), pck: Buffer.from('test pck'), godotVersion: '4.7.2', transformerVersion: '1.0.35', pluginVersion: '1.3.15'});
function fixture(t, mode = 'webgl') {
  const dir = temporary(t), manifest = manifestFor(mode);
  const write = (name, content) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); };
  const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
  const saveManifest = (value = manifest) => {
    write('godot-data/render-config.json', JSON.stringify(value));
    write('godot-data/render-config.js', 'GameGlobal.__WXSLIM_RENDER_CONFIG__=' + JSON.stringify(value) + ';\n');
  };
  saveManifest();
  write('godot-data/render-runtime.js', asset('render-runtime.js'));
  write('game.js', "import './godot-data/render-config';\nimport './godot-data/render-runtime';\nimport './wx-game-kit/index';\n");
  write('framework.js', asset('render-observer.js') + asset('godot-bridge.js').replace('__WXSLIM_RENDER_MODE__', JSON.stringify(mode)).replace('__WXSLIM_LOCALE__', '"en"'));
  const cfg = {runtime: {contextConfig: {contextType: 2, contextExt: {enableGLX: mode === 'glx', enableMetal: false}}}};
  return {dir, cfg, manifest, read, write, saveManifest, verify: () => verifyRenderContract(dir, cfg)};
}
const failures = result => result.filter(([level]) => level === 'FAIL').map(([, message]) => message);
const expectFailure = (result, pattern) => assert.match(failures(result).join('\n'), pattern);

function completeFixture(t) {
  const f = fixture(t), wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), pck = Buffer.from('GDPC-fixture-pck'), notice = Buffer.from('test notice\n');
  const data = Buffer.concat([notice, pck]), codeId = md5(wasm).slice(0, 15), dataId = md5(data).slice(0, 16);
  const plugin = {provider: 'wxe5a48f1ed5f544b7', version: '1.3.15'};
  const files = [{filename: '/notice.txt', start: 0, end: notice.length}, {filename: '/game.pck', start: notice.length, end: data.length}];
  Object.assign(f.manifest, renderManifest({renderMode: 'webgl', js: Buffer.from('test engine'), wasm, pck, godotVersion: '4.7.2', transformerVersion: '1.0.35', pluginVersion: plugin.version}));
  f.saveManifest();
  f.write('wasmcode/' + codeId + '.wasm.br', zlib.brotliCompressSync(wasm));
  f.write('data-package/' + dataId + '.data.bin', zlib.brotliCompressSync(data));
  f.cfg.project = {app: {appID: PLACEHOLDER_APPID}, engine: {name: 'Custom'}};
  f.cfg.launch = {code: {fileMD5: codeId, useWasmCodeSplit: false}, data: {fileMD5: dataId, loadFromSubpackage: true, isCompressed: true, fileSize: data.length, optFileSize: data.length}};
  f.write('wx-game-kit/config.json', JSON.stringify(f.cfg));
  f.write('project.config.json', JSON.stringify({appid: PLACEHOLDER_APPID, compileType: 'game'}));
  f.write('game.json', JSON.stringify({plugins: {WXGameKit: plugin}, subpackages: [{name: 'wasmcode'}, {name: 'data-package'}]}));
  for (const name of ['wx-game-kit/index.js', 'wx-game-kit/custom/index.js', 'godot-data/custom-package.js', 'godot-data/single-entry.js']) f.write(name, '');
  const metadata = {files, pck: files[1], pckBytes: pck.length, pckSha256: sha(pck), dataSha256: sha(data), size: data.length};
  f.write('godot-data/package-info.js', 'GameGlobal.__WXSLIM_PACKAGE_META__=' + JSON.stringify(metadata) + ';');
  f.write('game.js', "import './godot-data/render-config';\nimport './godot-data/render-runtime';\nimport './godot-data/package-info';\nimport './wx-game-kit/index';\nimport './godot-data/custom-package';\nimport './godot-data/single-entry';\nimport commFrameWork from './framework';\nWXGameKit.loader.setModuleFunctionHandler(GameGlobal.__WXSLIM_CREATE_SINGLE_ENTRY__(commFrameWork));\n");
  f.write('framework.js', f.read('framework.js') + asset('asset-gate.js') + "\nModule.__WXSLIM_ADD_ASSET_GATE__('converter');\n");
  return {...f, verifyAll: () => verifyProject(f.dir, plugin)};
}

test('完整生成合同：默认 WebGL 和显式 GLX 都通过静态一致性检查', t => {
  for (const mode of ['webgl', 'glx']) {
    const f = fixture(t, mode), result = f.verify();
    assert.deepEqual(failures(result), []);
    assert.ok(result.length >= 10);
    assert.equal(result.some(([level]) => level === 'WARN'), false);
  }
});

test('旧包没有渲染合同只给 WARN；部分文件和残留新入口都必须 FAIL', t => {
  const dir = temporary(t);
  const old = verifyRenderContract(dir, {});
  assert.deepEqual(old.map(([level]) => level), ['WARN']);
  assert.match(old[0][1], /无法据此确认 GLX/);
  for (const name of ['godot-data/render-config.json', 'godot-data/render-config.js', 'godot-data/render-runtime.js']) {
    const d = temporary(t), file = path.join(d, name);
    fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, '{}');
    expectFailure(verifyRenderContract(d, {}), /渲染合同文件不完整/);
  }
  fs.writeFileSync(path.join(dir, 'framework.js'), '/* WXSLIM_RENDER_OBSERVER_V1 */');
  expectFailure(verifyRenderContract(dir, {}), /渲染合同文件不完整/);
});

test('manifest JSON 与 JS 必须一致，禁止执行附加 JS', t => {
  const f = fixture(t, 'glx');
  f.write('godot-data/render-config.js', 'GameGlobal.__WXSLIM_RENDER_CONFIG__=' + JSON.stringify({...f.manifest, requestedMode: 'webgl'}) + ';');
  expectFailure(f.verify(), /内容不一致/);
  f.write('godot-data/render-config.js', f.read('godot-data/render-config.js') + '\nthrow Error("must not execute");');
  expectFailure(f.verify(), /不是可读取的单一渲染配置赋值/);
  f.write('godot-data/render-config.json', '{broken');
  expectFailure(f.verify(), /不是合法 JSON/);
});

test('manifest 必须包含有效模式、禁止回退策略、包身份和版本', t => {
  const f = fixture(t);
  for (const [patch, pattern] of [
    [{schema: 'unknown'}, /schema.*不满足/],
    [{requestedMode: 'auto'}, /requestedMode.*不满足/],
    [{fallback: 'webgl'}, /fallback=error.*不满足/],
    [{packageVersion: ''}, /packageVersion.*不满足/],
    [{wasmSha256: 'missing'}, /SHA256.*不满足/],
    [{versions: {godot: '4.7.2'}}, /WXGameKit 版本.*不满足/],
  ]) {
    f.saveManifest({...f.manifest, ...patch});
    expectFailure(f.verify(), pattern);
  }
});

test('packageVersion 随运行选项和接口内容变化，相同输入保持稳定', () => {
  const input = {renderMode: 'webgl', js: 'engine', wasm: Buffer.from('wasm'), pck: Buffer.from('GDPC'), godotVersion: '4.7.2', transformerVersion: '1.0.35', pluginVersion: '1.3.15'};
  const runtimeOptions = {orientation: 'portrait', locale: 'en', name: 'smoke', compat: true, timing: true, interfacesSha256: sha('interface v1')};
  const version = renderManifest({...input, runtimeOptions}).packageVersion;
  assert.equal(renderManifest({...input, runtimeOptions: {...runtimeOptions}}).packageVersion, version);
  for (const patch of [{orientation: 'landscape'}, {locale: 'zh'}, {name: 'other'}, {compat: false}, {timing: false}, {interfacesSha256: sha('interface v2')}]) {
    assert.notEqual(renderManifest({...input, runtimeOptions: {...runtimeOptions, ...patch}}).packageVersion, version, JSON.stringify(patch));
  }
});

test('完整包 manifest 的 WASM/PCK hash 必须与实际解压字节一致', t => {
  const f = completeFixture(t), valid = f.verifyAll();
  assert.deepEqual(failures(valid), []);
  assert.ok(valid.some(([level, message]) => level === 'PASS' && /wasmSha256 与实际完整 WASM 字节一致/.test(message)));
  assert.ok(valid.some(([level, message]) => level === 'PASS' && /pckSha256 与实际 PCK 字节一致/.test(message)));
  for (const [field, pattern] of [['wasmSha256', /wasmSha256 与实际完整 WASM 字节不一致/], ['pckSha256', /pckSha256 与实际 PCK 字节不一致/]]) {
    f.saveManifest({...f.manifest, [field]: '0'.repeat(64)});
    expectFailure(f.verifyAll(), pattern);
  }
});

test('split 产物仅提示转换身份过期风险，不对重写包声称身份一致', t => {
  const f = completeFixture(t);
  f.cfg.launch.code.useWasmCodeSplit = true;
  f.write('wx-game-kit/config.json', JSON.stringify(f.cfg));
  f.saveManifest({...f.manifest, wasmSha256: '0'.repeat(64), pckSha256: '0'.repeat(64)});
  const result = f.verifyAll();
  assert.deepEqual(failures(result), []);
  assert.ok(result.some(([level, message]) => level === 'WARN' && /只代表转换时身份，不能代表当前分包/.test(message)));
  assert.equal(result.some(([level, message]) => level === 'PASS' && /渲染合同 (?:wasm|pck)Sha256 与实际/.test(message)), false);
});

test('WXGameKit enableGLX 必须匹配请求，不能混用 Metal 或非 WebGL2 配置', t => {
  for (const mode of ['webgl', 'glx']) {
    const f = fixture(t, mode), context = f.cfg.runtime.contextConfig;
    context.contextExt.enableGLX = mode !== 'glx';
    expectFailure(f.verify(), /WXGameKit 渲染配置与请求不一致/);
    context.contextExt.enableGLX = mode === 'glx';
    context.contextExt.enableMetal = true;
    expectFailure(f.verify(), /WXGameKit 渲染配置与请求不一致/);
    context.contextExt.enableMetal = false;
    context.contextType = 1;
    expectFailure(f.verify(), /WXGameKit 渲染配置与请求不一致/);
  }
});

test('启动桥请求必须内嵌且一致；允许转换器引用属性名，拒绝错配或重复启动', t => {
  const f = fixture(t, 'glx'), source = f.read('framework.js');
  f.write('framework.js', source.replace('renderMode:"glx"', '"renderMode":"glx"'));
  assert.deepEqual(failures(f.verify()), []);
  f.write('framework.js', source.replace('renderMode:"glx"', 'renderMode:"webgl"'));
  expectFailure(f.verify(), /启动桥内嵌 renderMode/);
  f.write('framework.js', source.replace('renderMode:"glx"', 'renderMode:dynamicMode'));
  expectFailure(f.verify(), /启动桥内嵌 renderMode/);
  f.write('framework.js', source + '\n__WXSLIM_GODOT_BRIDGE__.start(Godot,Module,{renderMode:"glx"});');
  expectFailure(f.verify(), /启动桥内嵌 renderMode/);
});

test('配置和 runtime 必须先于加载器且只加载一次', t => {
  const f = fixture(t), original = f.read('game.js');
  for (const broken of [
    "import './wx-game-kit/index';\nimport './godot-data/render-config';\nimport './godot-data/render-runtime';",
    original.replace("import './godot-data/render-runtime';", ''),
    original + "import './godot-data/render-config';",
  ]) {
    f.write('game.js', broken); expectFailure(f.verify(), /渲染加载顺序不对或 import 不唯一/);
  }
  f.write('game.js', original.replaceAll("';", ".js';"));
  assert.deepEqual(failures(f.verify()), []);
});

test('诊断 runtime、实际上下文观察和三个启动阶段不可缺失', t => {
  const f = fixture(t), fw = f.read('framework.js'), runtime = f.read('godot-data/render-runtime.js');
  f.write('godot-data/render-runtime.js', ''); expectFailure(f.verify(), /缺少渲染诊断合同/);
  f.write('godot-data/render-runtime.js', runtime);
  f.write('framework.js', fw.replace('WXSLIM_RENDER_OBSERVER_V1', 'removed')); expectFailure(f.verify(), /缺少实际上下文观察入口/);
  for (const stage of ['prepare', 'attach', 'complete']) {
    f.write('framework.js', fw.replace('__WXSLIM_RENDER_DIAGNOSTIC__.' + stage + '(', '__WXSLIM_RENDER_DIAGNOSTIC__.removed('));
    expectFailure(f.verify(), /缺少 prepare、attach 或 complete/);
  }
});

test('CLI 渲染模式优先级：命令行 > private > public > webgl 默认', t => {
  const dir = temporary(t), config = path.join(dir, 'wxslim.json'), privateFile = path.join(dir, 'wxslim.private.json');
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const js = 'var Godot = {};\n/* GODOTSDK __godotMinigameWXGLXEnabled __GODOT_DISABLE_WXGLX wx.getFileSystemManager GameGlobal initConfig initFS copyToFS callMain wxGLXHasNativeBindings wxGLXCallNative wxGLXGetNativeExport wxGLXGetRoot GLctx */\ninstallWXGLXPatches();' + MODULE_TAIL + '\nmodule.exports = Godot;\n}';
  fs.writeFileSync(path.join(dir, 'engine.js'), js);
  fs.writeFileSync(path.join(dir, 'engine.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const pck = Buffer.alloc(32); pck.write('GDPC'); pck.writeUInt32LE(4, 8); pck.writeUInt32LE(7, 12); pck.writeUInt32LE(2, 16);
  fs.writeFileSync(path.join(dir, 'game.pck'), pck);
  const toolchain = path.join(dir, 'toolchain.json');
  writeJson(toolchain, {transformer: './intentionally-unavailable.exe'});
  const pub = {格式: FORMAT, game: {pck: './game.pck'}, engine: {js: './engine.js', wasm: './engine.wasm'}};
  writeJson(config, pub);
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'convert/convert.mjs'), 'check', '--config', config, '--toolchain', toolchain, ...args], {encoding: 'utf8'});
  const expectMode = (mode, ...args) => {
    const result = run(...args);
    assert.equal(result.status, 1); // Intentional missing transformer; no real toolchain needed or invoked.
    assert.match(result.stdout, new RegExp('请求渲染模式：' + mode + '（'));
    assert.match(result.stdout, /找不到官方 wx-transformer/);
    assert.equal(result.stderr, '');
  };
  expectMode('webgl');
  pub.game.renderMode = 'glx'; writeJson(config, pub); expectMode('glx');
  writeJson(privateFile, {game: {renderMode: 'webgl'}}); expectMode('webgl');
  expectMode('glx', '--render-mode', 'glx');
  expectMode('glx', '--render-mode=glx');
  expectMode('webgl', '--render-mode=webgl');
  for (const args of [['--render-mode=auto'], ['--render-mode='], ['--render-mode', 'glx', '--render-mode=webgl']]) {
    const result = run(...args);
    assert.equal(result.status, 1); assert.match(result.stderr, /--render-mode/);
    assert.doesNotMatch(result.stdout, /请求渲染模式：/);
  }
  writeJson(privateFile, {game: {renderMode: 'glx'}}); expectMode('webgl', '--render-mode', 'webgl');
  const invalid = run('--render-mode', 'auto');
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /--render-mode \/ game\.renderMode 只能是 webgl 或 glx/);
  assert.doesNotMatch(invalid.stdout, /请求渲染模式：/);
  const missingValue = run('--render-mode');
  assert.equal(missingValue.status, 1); assert.match(missingValue.stderr, /--render-mode 缺少值，只能是 webgl 或 glx/);
  assert.doesNotMatch(missingValue.stdout, /请求渲染模式：/);
});
