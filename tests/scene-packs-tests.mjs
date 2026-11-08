import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sceneSourceGraph, sceneOwnership, planScenePacks, scenePackId, pckEntriesFor} from '../lib/scene-packs.mjs';
import {partitionPck} from '../lib/pck-partition.mjs';
import {prepareResourceProjectSource} from '../lib/resource-project-source-plan.mjs';
import {quickRun, quickPlan, resolveQuickInputs, quickRunStatus, installReceiver, receiverStatus, QUICK_SETTINGS_SCHEMA} from '../lib/quick-flow.mjs';
import {createTaskService} from '../lib/task-core.mjs';
import {runQuickAdapter} from '../editor/workbench/quick-adapter.mjs';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });
const tmp = prefix => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temporary.push(dir); return dir; };

/** 按 Godot 4.7.2 PCK4 格式写一个包（与拆包核心的写法一致）。 */
function buildPck(files) {
  const names = files.map(([name]) => Buffer.from(name));
  let cursor = 128;
  const offsets = files.map(([, data]) => { const at = cursor; cursor = Math.ceil((cursor + data.length) / 32) * 32; return at; });
  const directory = cursor;
  const size = directory + 4 + names.reduce((sum, n) => sum + 4 + Math.ceil(n.length / 4) * 4 + 36, 0);
  const b = Buffer.alloc(size);
  b.write('GDPC'); b.writeUInt32LE(4, 4); [4, 7, 2].forEach((v, i) => b.writeUInt32LE(v, 8 + 4 * i)); b.writeUInt32LE(2, 20);
  b.writeBigUInt64LE(128n, 24); b.writeBigUInt64LE(BigInt(directory), 32); b.writeUInt32LE(files.length, directory);
  let at = directory + 4;
  files.forEach(([, data], i) => {
    data.copy(b, offsets[i]);
    const pad = Math.ceil(names[i].length / 4) * 4;
    b.writeUInt32LE(pad, at); at += 4; names[i].copy(b, at); at += pad;
    b.writeBigUInt64LE(BigInt(offsets[i] - 128), at); b.writeBigUInt64LE(BigInt(data.length), at + 8);
    createHash('md5').update(data).digest().copy(b, at + 16); b.writeUInt32LE(0, at + 32); at += 36;
  });
  return b;
}

const remap = target => Buffer.from(`[remap]\n\npath="res://${target}"\n`);
const imported = target => Buffer.from(`[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\nuid="uid://x"\npath="res://${target}"\n`);

// 主场景用 icon.png；level1 用自己的背景和与 level2 共用的敌人场景；level2 只用敌人场景。
function gameFixture({installReceiver: install = true, extraScript = ''} = {}) {
  const root = tmp('wxslim-scene-');
  const project = path.join(root, 'game'), output = path.join(root, 'out');
  fs.mkdirSync(path.join(project, 'levels'), {recursive: true});
  fs.mkdirSync(output);
  const write = (rel, text) => fs.writeFileSync(path.join(project, rel), text);
  write('project.godot', '[application]\nconfig/name="分包测试"\nrun/main_scene="res://main.tscn"\nconfig/icon="res://icon.png"\n');
  write('export_presets.cfg', '[preset.0]\nname="Web"\nplatform="Web"\n');
  write('main.tscn', '[gd_scene format=3 uid="uid://main1"]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[ext_resource type="Texture2D" uid="uid://icon1" path="res://icon.png" id="2"]\n');
  write('main.gd', 'extends Node\nfunc go():\n\tget_tree().change_scene_to_file("res://levels/level1.tscn")\n' + extraScript);
  write('icon.png', 'png'); write('icon.png.import', '[remap]\nuid="uid://icon1"\npath="res://.godot/imported/icon.png-1.ctex"\n');
  write('levels/level1.tscn', '[gd_scene format=3 uid="uid://lvl1"]\n[ext_resource type="Texture2D" uid="uid://bg1" id="1"]\n[ext_resource type="PackedScene" path="res://levels/enemy.tscn" id="2"]\n[ext_resource type="Texture2D" path="res://icon.png" id="3"]\n');
  write('levels/bg.png', 'png'); write('levels/bg.png.import', '[remap]\nuid="uid://bg1"\npath="res://.godot/imported/bg.png-2.ctex"\n');
  write('levels/enemy.tscn', '[gd_scene format=3 uid="uid://enemy1"]\n[ext_resource type="Texture2D" path="res://levels/enemy.png" id="1"]\n');
  write('levels/enemy.png', 'png'); write('levels/enemy.png.import', '[remap]\nuid="uid://en1"\npath="res://.godot/imported/enemy.png-3.ctex"\n');
  write('levels/level2.tscn', '[gd_scene format=3 uid="uid://lvl2"]\n[ext_resource type="PackedScene" uid="uid://enemy1" id="1"]\n');
  const receiver = prepareResourceProjectSource(path.join(project, 'project.godot'));
  if (install) for (const [name, bytes] of receiver.contents) fs.writeFileSync(path.join(project, name), bytes);
  const scripts = install ? [...receiver.contents.keys()].filter(n => n.endsWith('.gd')) : [];
  const pck = buildPck([
    ['project.binary', Buffer.from('binary project settings')],
    ['main.tscn.remap', remap('.godot/exported/1/export-a-main.scn')], ['.godot/exported/1/export-a-main.scn', Buffer.from('main scene')],
    ['main.gd', Buffer.from('script')], ['icon.png.import', imported('.godot/imported/icon.png-1.ctex')], ['.godot/imported/icon.png-1.ctex', Buffer.from('icon pixels')],
    ['levels/level1.tscn.remap', remap('.godot/exported/1/export-b-level1.scn')], ['.godot/exported/1/export-b-level1.scn', Buffer.from('level one scene')],
    ['levels/bg.png.import', imported('.godot/imported/bg.png-2.ctex')], ['.godot/imported/bg.png-2.ctex', Buffer.from('background pixels')],
    ['levels/enemy.tscn.remap', remap('.godot/exported/1/export-c-enemy.scn')], ['.godot/exported/1/export-c-enemy.scn', Buffer.from('enemy scene')],
    ['levels/enemy.png.import', imported('.godot/imported/enemy.png-3.ctex')], ['.godot/imported/enemy.png-3.ctex', Buffer.from('enemy pixels')],
    ['levels/level2.tscn.remap', remap('.godot/exported/1/export-d-level2.scn')], ['.godot/exported/1/export-d-level2.scn', Buffer.from('level two scene')],
    ...scripts.map(name => [name, fs.readFileSync(path.join(project, name))]),
  ]);
  return {root, project, output, pck};
}

test('scene packs: a scene takes only files no other part of the game uses', () => {
  const f = gameFixture();
  const graph = sceneSourceGraph(f.project);
  assert.ok(graph.deps.get('levels/level1.tscn').has('levels/bg.png'), 'uid 引用也要算依赖');
  const owned = sceneOwnership(graph, ['res://levels/level1.tscn', 'res://levels/level2.tscn'], 'res://main.tscn');
  assert.deepEqual([...owned[0].own].sort(), ['levels/bg.png', 'levels/level1.tscn']);
  assert.deepEqual([...owned[1].own].sort(), ['levels/level2.tscn']);
  const plan = planScenePacks({projectDir: f.project, scenes: ['res://levels/level1.tscn', 'res://levels/level2.tscn'], mainScene: 'res://main.tscn', pck: f.pck});
  assert.deepEqual(plan.resources.map(r => [r.id, r.root, r.paths]), [
    ['level1', 'scenepacks/level1', ['levels/bg.png.import', '.godot/imported/bg.png-2.ctex', 'levels/level1.tscn.remap', '.godot/exported/1/export-b-level1.scn']],
    ['level2', 'scenepacks/level2', ['levels/level2.tscn.remap', '.godot/exported/1/export-d-level2.scn']],
  ]);
  assert.ok(plan.packs[0].paths.includes('levels/enemy.tscn.remap'), '两个分包共用的敌人场景留在首包');
  assert.ok(plan.packs[0].paths.includes('main.gd') && plan.packs[0].paths.includes('project.binary'));
  // 拆包核心接受这份归属：每个条目恰好属于一个包。
  const split = partitionPck(f.pck, {schema: 'wxslim-pck-partition-v1', source: plan.source, packs: plan.packs});
  assert.equal(split.audit.exactOwnershipUnion, true);
});

test('scene packs: scenes the first package needs, nested scenes and preloads are refused with the scenes field', () => {
  const f = gameFixture();
  const graph = sceneSourceGraph(f.project);
  const refuse = (scenes, code, main = 'res://main.tscn', g = graph) => assert.throws(() => sceneOwnership(g, scenes, main), e => e.code === code && e.field === 'scenes');
  refuse(['res://main.tscn'], 'QUICK_SCENES_MAIN');
  refuse(['res://levels/enemy.tscn'], 'QUICK_SCENES_USED_BY_BOOT');
  refuse(['res://levels/level1.tscn', 'res://levels/level2.tscn', 'res://levels/enemy.tscn'], 'QUICK_SCENES_NESTED');
  refuse(['res://levels/missing.tscn'], 'QUICK_SCENES_MISSING');
  refuse(['res://levels/level1.tscn', 'res://levels/level1.tscn'], 'QUICK_SCENES_DUPLICATE');
  const preloaded = gameFixture({extraScript: 'const L = preload("res://levels/level2.tscn")\n'});
  refuse(['res://levels/level2.tscn'], 'QUICK_SCENES_PRELOADED', 'res://main.tscn', sceneSourceGraph(preloaded.project));
  assert.equal(scenePackId('res://Level 1.tscn'), 'level_1');
  assert.equal(scenePackId('res://levels/2.tscn'), 'pack_2');
  const used = new Set(['level1']);
  assert.equal(scenePackId('a/level1.tscn', used), 'level1_2');
  const entries = new Map([['a.png.import', {offset: 0, bytes: 0}]]);
  assert.deepEqual(pckEntriesFor('a.gd', new Map([['a.gd', {}]]), Buffer.alloc(0)), [], '脚本从不移出首包');
  assert.deepEqual(pckEntriesFor('missing.png', entries, Buffer.alloc(0)), []);
});

test('scene packs: settings without the receiver, a main scene or with a bad scene are blocked before any output', async () => {
  const f = gameFixture({installReceiver: false});
  const settings = {schema: QUICK_SETTINGS_SCHEMA, template: 'full', devtoolsPreview: false, output: f.output, subpackages: 'scenes', scenes: ['res://levels/enemy.tscn']};
  fs.writeFileSync(path.join(f.project, 'wxslim-export.json'), JSON.stringify(settings));
  const inputs = resolveQuickInputs({project: f.project, editor: path.join(f.root, 'godot.exe'), release: f.root});
  const fields = Object.fromEntries(inputs.blockers.map(b => [b.code, b.field]));
  assert.equal(fields.QUICK_RECEIVER_MISSING, 'receiver');
  assert.equal(fields.QUICK_SCENES_USED_BY_BOOT, 'scenes');
  assert.equal(receiverStatus(path.join(f.project, 'project.godot')).state, 'missing');
  const run = await quickRun({project: f.project, editor: path.join(f.root, 'godot.exe'), release: f.root});
  assert.equal(run.status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(f.output), []);
});

test('receiver: plan lists the writes, install runs the shared task once, then reports it installed', async () => {
  const f = gameFixture({installReceiver: false});
  fs.writeFileSync(path.join(f.project, 'wxslim-export.json'), JSON.stringify({schema: QUICK_SETTINGS_SCHEMA, output: f.output}));
  const planned = await installReceiver({project: f.project});
  assert.equal(planned.status, 'PLANNED');
  assert.deepEqual(planned.planned.map(p => p.path).sort(), ['godot-resource-command-receiver.gd', 'godot-resource-game-facade.gd', 'godot-resource-pack-session.gd', 'godot-resource-scene-loader.gd', 'project.godot']);
  assert.deepEqual(fs.readdirSync(f.output), [], '只列出时什么都不写');
  const done = await installReceiver({project: f.project, write: true});
  assert.equal(done.status, 'INSTALLED', JSON.stringify(done.error));
  assert.match(fs.readFileSync(path.join(f.project, 'project.godot'), 'utf8'), /WxResource="\*res:\/\/godot-resource-game-facade\.gd"/);
  assert.equal(receiverStatus(path.join(f.project, 'project.godot')).state, 'installed');
  assert.equal((await installReceiver({project: f.project, write: true})).status, 'ALREADY_INSTALLED');
  const other = gameFixture({installReceiver: false});
  fs.writeFileSync(path.join(other.project, 'wxslim-export.json'), JSON.stringify({schema: QUICK_SETTINGS_SCHEMA, output: path.join(other.project, 'levels')}));
  const blocked = await installReceiver({project: other.project, write: true});
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.blockers[0].field, 'output');
});

/** 导出和转换用假结果；拆包和接口生成走真实的共用任务。 */
function mixedService(f) {
  const real = createTaskService();
  const calls = [];
  const fake = new Set(['project-pck-export', 'official-convert', 'resource-runtime-assemble']);
  const action = file => JSON.parse(fs.readFileSync(file, 'utf8')).action;
  return {calls,
    async plan(file) {
      const a = action(file); calls.push(`plan:${a}`);
      if (!fake.has(a)) return real.plan(file);
      return {schema: 'wxslim-task-plan-v1', action: a, eligible: true, plan: {}};
    },
    async execute(file, options) {
      const a = action(file); calls.push(`execute:${a}`);
      if (!fake.has(a)) return real.execute(file, options);
      const config = JSON.parse(fs.readFileSync(JSON.parse(fs.readFileSync(file, 'utf8')).configFile, 'utf8'));
      if (a === 'project-pck-export') { fs.mkdirSync(config.output); fs.writeFileSync(path.join(config.output, 'full.pck'), f.pck); }
      if (a === 'official-convert') {
        const mini = path.join(config.output, 'converted', 'minigame'); fs.mkdirSync(mini, {recursive: true}); fs.writeFileSync(path.join(mini, 'project.config.json'), '{}');
        fs.writeFileSync(path.join(config.output, 'terminal.json'), JSON.stringify({status: 'SUCCESS'}));
      }
      if (a === 'resource-runtime-assemble') {
        const mini = path.join(config.output, 'converted', 'minigame'); fs.mkdirSync(mini, {recursive: true}); fs.writeFileSync(path.join(mini, 'project.config.json'), '{}');
        fs.writeFileSync(path.join(config.output, 'terminal.json'), JSON.stringify({status: 'SUCCESS'}));
      }
      return {status: 'SUCCESS', taskId: 't-' + calls.length};
    }};
}

function releaseFixture(root) {
  const release = path.join(root, 'release');
  fs.mkdirSync(path.join(release, 'engines', 'full'), {recursive: true}); fs.mkdirSync(path.join(release, 'tools'));
  fs.writeFileSync(path.join(release, 'RELEASE.json'), '{}');
  fs.writeFileSync(path.join(release, 'profiles.json'), JSON.stringify({schema: 1,
    files: {'engines/full/godot.prepared.js': {}, 'engines/full/godot.wasm': {}, 'tools/wx-transformer-v1.0.35-win.exe': {}},
    pairs: {full: {profile: 'full-official-c050-capability-dev', js: 'engines/full/godot.prepared.js', wasm: 'engines/full/godot.wasm', requiresPreparedSource: false}}}));
  fs.writeFileSync(path.join(release, 'engines/full/godot.prepared.js'), 'engine js');
  fs.writeFileSync(path.join(release, 'engines/full/godot.wasm'), 'engine wasm');
  fs.writeFileSync(path.join(release, 'tools/wx-transformer-v1.0.35-win.exe'), 'x');
  const editor = path.join(root, 'godot.exe'); fs.writeFileSync(editor, 'x');
  return {release, editor};
}

test('scene run: split and interfaces run as shared tasks, conversion gets the first package and the generated interfaces', async () => {
  const f = gameFixture();
  const {release, editor} = releaseFixture(f.root);
  fs.writeFileSync(path.join(f.project, 'wxslim-export.json'), JSON.stringify({schema: QUICK_SETTINGS_SCHEMA, template: 'full', glx: false, devtoolsPreview: false,
    output: f.output, subpackages: 'scenes', scenes: ['res://levels/level1.tscn', 'res://levels/level2.tscn']}));
  const options = {project: f.project, editor, release, now: new Date(2026, 10, 8, 10, 0, 0)};
  const plan = await quickPlan(options, {service: {async plan() { return {eligible: true, plan: {}}; }}});
  assert.deepEqual(plan.steps.map(s => s.step), ['export', 'split', 'interfaces', 'convert', 'assemble', 'open']);
  const service = mixedService(f);
  const result = await quickRun(options, {service});
  assert.equal(result.status, 'SUCCESS', JSON.stringify(result.error));
  assert.deepEqual(service.calls, ['plan:project-pck-export', 'execute:project-pck-export', 'plan:resource-pck-partition', 'execute:resource-pck-partition',
    'plan:resource-interfaces-prepare', 'execute:resource-interfaces-prepare', 'plan:official-convert', 'execute:official-convert',
    'plan:resource-runtime-assemble', 'execute:resource-runtime-assemble']);
  const convert = JSON.parse(fs.readFileSync(path.join(result.run, 'requests', 'convert-config.json'), 'utf8'));
  assert.equal(convert.pck, path.join(result.run, 'split', 'packs', 'boot.pck'));
  assert.equal(convert.interfaces, path.join(result.run, 'interfaces', 'interfaces.js'));
  const packs = JSON.parse(fs.readFileSync(path.join(result.run, 'requests', 'scene-packs.json'), 'utf8'));
  assert.deepEqual(packs.packs.map(p => [p.id, p.entryScene, p.root]), [['boot', 'res://main.tscn', undefined], ['level1', 'res://levels/level1.tscn', 'scenepacks/level1'], ['level2', 'res://levels/level2.tscn', 'scenepacks/level2']]);
  const assemble = JSON.parse(fs.readFileSync(path.join(result.run, 'requests', 'assemble-config.json'), 'utf8'));
  assert.equal(assemble.convertedOutput, path.join(result.run, 'wechat', 'converted'), '组包读取转换任务里的 converted 目录');
  assert.equal(assemble.officialConfigFile, path.join(result.run, 'requests', 'convert-config.json'));
  assert.equal(assemble.output, path.join(result.run, 'final'));
  const interfaces = fs.readFileSync(convert.interfaces, 'utf8');
  for (const p of packs.packs.slice(1)) assert.ok(interfaces.includes(p.sha256) && interfaces.includes(p.root + '/content.bin'));
  assert.deepEqual(result.scenePacks.map(p => p.id), ['level1', 'level2']);
  const status = quickRunStatus(result.run);
  assert.equal(status.status, 'SUCCESS');
  assert.deepEqual(Object.keys(status.steps), ['export', 'split', 'interfaces', 'convert', 'assemble', 'devtools']);
  assert.equal(status.openTarget, path.join(result.run, 'final', 'converted', 'minigame', 'project.config.json'));
  assert.deepEqual(status.scenePacks.map(p => p.scene), ['res://levels/level1.tscn', 'res://levels/level2.tscn']);
});

test('adapter: requirements, status and open-by-run follow the quick interface', async () => {
  const f = gameFixture();
  const state = path.join(f.root, 'state'), logs = path.join(state, 'logs');
  fs.mkdirSync(logs, {recursive: true});
  const configFile = path.join(state, 'local-config.json');
  const opened = [];
  const call = async (token, mode, request) => {
    fs.writeFileSync(path.join(logs, token + '.quick-request.private.json'), JSON.stringify(request));
    return runQuickAdapter(configFile, mode, token, {load: () => ({}), open: (target, source) => { opened.push([target, source]); return {ok: true}; }});
  };
  const conservative = await call('3-1', 'requirements', {template: 'conservative'});
  assert.deepEqual(conservative.confirmations.map(c => c.field), ['confirmRemovedModules']);
  assert.equal(conservative.confirmations[0].removedModules.length, 7);
  assert.equal((await call('3-2', 'requirements', {template: 'x'})).code, 'QUICK_TEMPLATE_UNKNOWN');
  assert.equal((await call('3-3', 'status', {run: f.output})).code, 'QUICK_RUN_NOT_FOUND');
  assert.equal((await call('3-4', 'open', {run: f.output})).code, 'QUICK_OPEN_RUN_INVALID');
  // 已完成的不分包运行：打开转换结果时用面板手填 AppID 生成的来源替换占位 AppID。
  const run = path.join(f.output, 'done');
  fs.mkdirSync(path.join(run, 'requests'), {recursive: true});
  fs.writeFileSync(path.join(run, 'requests', 'export-request.json'), '{}');
  for (const dir of ['pck', 'wechat']) { fs.mkdirSync(path.join(run, dir), {recursive: true}); fs.writeFileSync(path.join(run, dir, 'terminal.json'), '{"status":"SUCCESS"}'); }
  const mini = path.join(run, 'wechat', 'converted', 'minigame'); fs.mkdirSync(mini, {recursive: true}); fs.writeFileSync(path.join(mini, 'project.config.json'), '{}');
  const ok = await call('3-5', 'open', {run, settings: {appid: 'wx0123456789abcdef'}});
  assert.equal(ok.status, 'SUCCESS');
  assert.equal(opened[0][0], path.join(mini, 'project.config.json'));
  assert.equal(JSON.parse(fs.readFileSync(opened[0][1], 'utf8')).appid, 'wx0123456789abcdef');
  const status = await call('3-6', 'status', {run});
  assert.equal(status.status, 'SUCCESS');
});
