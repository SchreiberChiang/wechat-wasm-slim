// 统一配置 wxslim.json 的解析与校验测试（离线，不需要工具链）。运行：node --test tests/
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {FORMAT, isGameConfig, loadGameConfig, convertArgs, trimSettings, splitConfig, describe} from '../lib/game-config.mjs';
import {toBuildProfile} from '../trim/lib/scan.mjs';

const KIT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const STARTAP = path.join(KIT, 'examples/startap');
const APPID = 'wx' + '0123456789abcdef';

/** 在临时目录里放一个最小游戏：game/project.godot、build/g.pck、wx/i.js、engine/（假引擎文件）。 */
function sandbox(pub, priv) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-test-'));
  for (const [f, s] of Object.entries({'game/project.godot': '', 'build/g.pck': 'GDPC', 'wx/i.js': '', 'engine/godot.js': '', 'engine/godot.wasm': '', 'trim.config.json': fs.readFileSync(path.join(STARTAP, 'trim.config.json'), 'utf8'), 'old/minigame/project.config.json': JSON.stringify({appid: APPID})})) {
    fs.mkdirSync(path.dirname(path.join(d, f)), {recursive: true}); fs.writeFileSync(path.join(d, f), s);
  }
  fs.writeFileSync(path.join(d, 'wxslim.json'), typeof pub === 'string' ? pub : JSON.stringify({格式: FORMAT, ...pub}));
  if (priv !== undefined) fs.writeFileSync(path.join(d, 'wxslim.private.json'), JSON.stringify(priv));
  return {dir: d, file: path.join(d, 'wxslim.json')};
}
const base = () => ({game: {name: 'g', godotProject: './game', pck: './build/g.pck', interfaces: './wx/i.js'}, engine: {artifacts: './engine'}});
const loadErr = (pub, priv) => { const {file} = sandbox(pub, priv); try { loadGameConfig(file); } catch (e) { return e.message; } assert.fail('应该报错'); };

test('最小配置：路径解析为绝对路径，输出目录有默认值', () => {
  const {dir, file} = sandbox(base()), g = loadGameConfig(file);
  assert.equal(g.c.game.pck, path.join(dir, 'build/g.pck'));
  assert.equal(g.c.output.dir, path.join(dir, 'out'));
  assert.equal(g.c.output.convert, path.join(dir, 'out/convert'));
  assert.equal(g.privateFile, null);
});

test('未知键（顶层和段内）明确报错，并列出可用的键', () => {
  const m = loadErr({...base(), foo: 1, game: {...base().game, pckk: 'x'}});
  assert.match(m, /foo：未知的键/); assert.match(m, /game\.pckk：未知的键（可用：name、godotProject/);
});

test('“说明”类中文注释键可以出现在任何对象里', () => { const {file} = sandbox({...base(), 说明: 'x', engine: {说明: 'y', artifacts: './engine'}}); loadGameConfig(file); });

test('类型错误：枚举、布尔、整数、手动覆盖的值', () => {
  const m = loadErr({...base(), game: {...base().game, orientation: 'up', compat: 'yes'}, trim: {jobs: 1.5, lto: 'fast', overrides: {disable_3d: 'no'}}});
  assert.match(m, /game\.orientation 只能是 portrait \/ landscape/); assert.match(m, /game\.compat 必须是 true 或 false/);
  assert.match(m, /trim\.jobs 必须是正整数/); assert.match(m, /trim\.lto 只能是 full \/ thin \/ none/); assert.match(m, /trim\.overrides\.disable_3d 必须是 true 或 false/);
});

test('格式字段缺失或不对', () => {
  const {file} = sandbox(JSON.stringify(base())); assert.equal(isGameConfig(file), false);
  assert.throws(() => loadGameConfig(file), /缺少 格式/);
  assert.match(loadErr({...base(), 格式: 'x'}), /格式 必须是/);
});

test('JSON 写错时报出文件名', () => { const {file} = sandbox('{"格式": '); assert.throws(() => loadGameConfig(file), /配置 读不了或不是合法 JSON/); });

test('AppID、AppID 来源、私钥路径、云环境 ID 不能写进公开文件', () => {
  const m = loadErr({...base(), game: {...base().game, appidFrom: './old/minigame', appid: APPID}, split: {privateKeyPath: 'C:/k.pem', cloud: {env: 'env-1'}}});
  for (const k of ['game.appidFrom', 'game.appid', 'split.privateKeyPath', 'split.cloud.env']) assert.match(m, new RegExp(k.replace('.', '\\.') + ' 只能写在 wxslim\\.private\\.json'));
  const {file} = sandbox({...base(), split: {cloud: {env: null}}}); loadGameConfig(file); // null 可以写在公开文件
});

test('私密文件合并覆盖公开文件，路径按同目录解析，打印时隐藏', () => {
  const {dir, file} = sandbox(base(), {game: {appidFrom: './old/minigame', orientation: 'landscape'}, split: {cloud: {env: 'env-1'}}});
  const g = loadGameConfig(file);
  assert.equal(g.privateFile, path.join(dir, 'wxslim.private.json'));
  assert.equal(g.c.game.appidFrom, path.join(dir, 'old/minigame'));
  assert.equal(g.c.game.orientation, 'landscape'); assert.equal(g.c.game.pck, path.join(dir, 'build/g.pck'));
  const shown = JSON.stringify(describe(g)); assert.ok(!shown.includes('env-1') && !shown.includes('old')); assert.match(shown, /已设置/);
});

test('私密文件里的未知键和类型错误也报错', () => {
  const m = loadErr(base(), {game: {appid: 'abc'}, secret: 1});
  assert.match(m, /wxslim\.private\.json：secret：未知的键/); assert.match(m, /game\.appid 格式不对/);
});

test('--config 指向私密文件时拒绝', () => { const {dir} = sandbox(base(), {}); assert.throws(() => loadGameConfig(path.join(dir, 'wxslim.private.json')), /要指向公开的 wxslim\.json/); });

test('引擎来源：只能选一种；js 和 wasm 成对；fromTrim 需要 trim.work', () => {
  assert.match(loadErr({...base(), engine: {artifacts: './engine', js: './engine/godot.js', wasm: './engine/godot.wasm'}}), /只能选一种引擎来源/);
  assert.match(loadErr({...base(), engine: {js: './engine/godot.js'}}), /engine\.js 要和 engine\.wasm 一起写/);
  assert.match(loadErr({...base(), engine: {fromTrim: true}}), /engine\.fromTrim 需要 trim\.work/);
});

test('convert：从配置得到参数；输入路径不存在时报出键名和路径', () => {
  const {dir, file} = sandbox({...base(), game: {...base().game, compat: false, orientation: 'landscape'}}, {game: {appidFrom: './old/minigame'}});
  const {args, flags} = convertArgs(loadGameConfig(file));
  assert.deepEqual(args, {pck: path.join(dir, 'build/g.pck'), out: path.join(dir, 'out/convert'), export: path.join(dir, 'engine'), interfaces: path.join(dir, 'wx/i.js'), orientation: 'landscape', name: 'g', 'appid-from': path.join(dir, 'old/minigame')});
  assert.deepEqual(flags, {'no-compat': true, 'no-timing': false});
  const bad = sandbox({...base(), game: {...base().game, pck: './build/none.pck'}, engine: {js: './engine/godot.js', wasm: './engine/nope.wasm'}});
  assert.throws(() => convertArgs(loadGameConfig(bad.file)), e => /game\.pck 指向的文件不存在：.*none\.pck/.test(e.message) && /engine\.wasm 指向的文件不存在/.test(e.message));
  const noEngine = sandbox({...base(), engine: {}}); assert.throws(() => convertArgs(loadGameConfig(noEngine.file)), /没有引擎来源/);
  const fromTrim = sandbox({...base(), engine: {fromTrim: true}, trim: {work: './w'}}); assert.throws(() => convertArgs(loadGameConfig(fromTrim.file)), /还没有编译产物/);
});

test('trim：档位和手动覆盖叠加到裁剪配置上，覆盖写错按原有规则报错', () => {
  const {dir, file} = sandbox({...base(), trim: {level: 'minimal', overrides: {disable_physics_2d: false, module_mp3: true}, lto: 'thin', work: './w'}});
  const t = trimSettings(loadGameConfig(file)), cfg = t.load();
  assert.equal(t.configFile, path.join(dir, 'trim.config.json')); assert.equal(t.project, path.join(dir, 'game')); assert.equal(t.lto, 'thin'); assert.equal(t.work, path.join(dir, 'w'));
  assert.equal(cfg.当前档位, 'minimal');
  const o = toBuildProfile(cfg).profile.disabled_build_options;
  assert.equal(o.disable_physics_2d, undefined); assert.equal(o.module_mp3_enabled, undefined); assert.equal(o.module_text_server_adv_enabled, false);
  const bad = sandbox({...base(), trim: {overrides: {disable_everything: true}}});
  assert.throws(() => toBuildProfile(trimSettings(loadGameConfig(bad.file)).load()), /手动覆盖 有错误：disable_everything（未知的开关或模块）/);
  const missing = sandbox({...base(), trim: {config: './none.json'}});
  assert.throws(() => trimSettings(loadGameConfig(missing.file)).load(), /trim 配置不存在/);
});

test('split：缺的值从 game / output 推出来；命令要用的文件不存在时报错', () => {
  const {dir, file} = sandbox(base(), {split: {privateKeyPath: 'C:/keys/k.pem'}}), c = splitConfig(loadGameConfig(file));
  assert.equal(c.projectName, 'g'); assert.equal(c.workProject, path.join(dir, 'out/convert/minigame')); assert.equal(c.symbols, path.join(dir, 'out/convert/webgl/symbols.json'));
  assert.equal(c.releasePck, path.join(dir, 'build/g.pck')); assert.equal(c.releaseInterfaces, path.join(dir, 'wx/i.js')); assert.equal(c.trainingPck, null);
  assert.equal(c.cloud.env, null); assert.equal(c.privateKeyPath, path.resolve('C:/keys/k.pem')); assert.equal(c.__dir, dir);
  assert.throws(() => splitConfig(loadGameConfig(file), ['workProject']), /split\.workProject 指向的目录不存在：.*minigame（默认 <output\.convert>\/minigame，先 convert）/);
  const off = sandbox({...base(), split: {releasePck: null, releaseInterfaces: null}}); const c2 = splitConfig(loadGameConfig(off.file), ['releasePck']);
  assert.equal(c2.releasePck, null); assert.equal(c2.releaseInterfaces, null);
});

test('旧配置不会被当成统一配置', () => {
  for (const f of ['trim.config.json', 'planA.kit.json', 'planB.kit.json']) assert.equal(isGameConfig(path.join(STARTAP, f)), false, f);
  assert.equal(isGameConfig(path.join(STARTAP, 'wxslim.json')), true);
});

test('Star Tap 示例 wxslim.json 能通过校验', () => {
  const g = loadGameConfig(path.join(STARTAP, 'wxslim.json'));
  assert.equal(g.c.game.godotProject, path.join(STARTAP, 'game')); assert.equal(g.c.engine.fromTrim, true); assert.equal(g.c.trim.lto, 'thin');
});

// 命令行：新旧两种写法得到同样的 .gdbuild（trim profile 不需要工具链）。
const node = (...a) => spawnSync(process.execPath, a, {encoding: 'utf8'});
test('trim profile：旧写法（裁剪配置）和新写法（wxslim.json）结果一致', () => {
  const {dir, file} = sandbox({...base(), trim: {level: 'balanced'}});
  const a = node(path.join(KIT, 'trim/trim.mjs'), 'profile', '--config', path.join(STARTAP, 'trim.config.json'), '--out', path.join(dir, 'old.gdbuild'));
  const b = node(path.join(KIT, 'trim/trim.mjs'), 'profile', '--config', file);
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'old.gdbuild'), 'utf8'), fs.readFileSync(path.join(dir, 'out/g.gdbuild'), 'utf8'));
});

test('命令行：配置错误时三个工具和总入口都给出中文报错、退出码 1', () => {
  const {file} = sandbox({...base(), game: {...base().game, orientation: 'up'}});
  for (const a of [['convert/convert.mjs', 'check'], ['trim/trim.mjs', 'profile'], ['split/kit.mjs', 'info'], ['wxslim.mjs', 'config']]) {
    const r = node(path.join(KIT, a[0]), a[1], '--config', file);
    assert.equal(r.status, 1, a.join(' ')); assert.match(r.stderr, /game\.orientation 只能是 portrait \/ landscape/, a.join(' '));
  }
  const ok = node(path.join(KIT, 'wxslim.mjs'), 'config', '--config', path.join(STARTAP, 'wxslim.json'));
  assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /校验通过/);
});

test('命令行：wxslim.json 漏写“格式”时按统一配置报错，不当成旧配置', () => {
  const {file} = sandbox(JSON.stringify(base()));
  for (const a of [['trim/trim.mjs', 'profile'], ['split/kit.mjs', 'info'], ['convert/convert.mjs', 'check']]) {
    const r = node(path.join(KIT, a[0]), a[1], '--config', file);
    assert.equal(r.status, 1, a.join(' ')); assert.match(r.stderr, /缺少 格式/, a.join(' '));
  }
});

test('命令行：convert 的 --config 只接受统一配置', () => {
  const r = node(path.join(KIT, 'convert/convert.mjs'), 'check', '--config', path.join(STARTAP, 'planB.kit.json'));
  assert.equal(r.status, 1); assert.match(r.stderr, /要指向统一配置 wxslim\.json/);
});
