import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  normalizeQuickSettings, settingsBlockers, findWebPresets, projectName, runName, resolveQuickInputs,
  quickPlan, quickRun, cancelQuickRun, pure2dRemovedModules, resolvePairProof, planTaskRoot, CANCEL_MARKER, listQuickRuns, quickRunStatus, RUN_SUMMARY, exportPayload, convertPayload, resolveMainScene, QUICK_SETTINGS_SCHEMA, SIMPLE_INTERFACES,
} from '../lib/quick-flow.mjs';
import {runQuickCli} from '../lib/quick-cli.mjs';
import {templateRequirements} from '../lib/quick-flow.mjs';
import {runQuickAdapter} from '../editor/workbench/quick-adapter.mjs';
import {taskPlanIdentity} from '../lib/task-core.mjs';
import {buildExportRequestDraft} from '../editor/workbench/export-request-form.mjs';
import {buildOfficialConvertRequestDraft} from '../editor/workbench/official-convert-request-form.mjs';

const NOW = new Date(2026, 10, 7, 9, 5, 3);
const PRESETS = '[preset.0]\nname="Web"\nplatform="Web"\nexport_filter="all_resources"\n\n[preset.0.options]\nfoo=1\n\n[preset.1]\nname="Win"\nplatform="Windows Desktop"\n';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });

// 结构正确的最小 Godot 4.7.2 PCK（只含 project.binary），供需要读取 PCK 的 2D 声明使用。
function makePck() {
  const name = Buffer.from('project.binary'), data = Buffer.from('structural-only PCK body');
  const offset = 113, end = offset + data.length, pad = Math.ceil(name.length / 4) * 4, b = Buffer.alloc(end + 4 + 40 + pad);
  b.write('GDPC'); b.writeUInt32LE(4, 4); [4, 7, 2].forEach((v, i) => b.writeUInt32LE(v, 8 + 4 * i));
  b.writeBigUInt64LE(113n, 24); b.writeBigUInt64LE(BigInt(end), 32); b.writeUInt32LE(1, end);
  let at = end + 4; b.writeUInt32LE(pad, at); at += 4; name.copy(b, at); at += pad;
  b.writeBigUInt64LE(0n, at); b.writeBigUInt64LE(BigInt(data.length), at + 8);
  createHash('md5').update(data).digest().copy(b, at + 16); data.copy(b, offset); return b;
}

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-test-'));
  temporary.push(root);
  const release = path.join(root, 'release'), project = path.join(root, 'game'), output = path.join(root, 'out');
  const fingerprint = path.join(release, 'engines', 'pure-2d', 'fingerprint.json');
  for (const dir of [release, project, output, path.join(release, 'engines', 'full'), path.join(release, 'engines', 'pure-2d'), path.join(release, 'tools')]) fs.mkdirSync(dir, {recursive: true});
  fs.copyFileSync(new URL('../offline/vendor/engines/pure-2d/fingerprint.json', import.meta.url), fingerprint);
  fs.writeFileSync(path.join(release, 'RELEASE.json'), '{}');
  fs.writeFileSync(path.join(release, 'profiles.json'), JSON.stringify({
    schema: 1, files: {'engines/full/godot.prepared.js': {}, 'engines/full/godot.wasm': {}, 'tools/wx-transformer-v1.0.35-win.exe': {}},
    pairs: {full: {profile: 'full-official-c050-capability-dev', js: 'engines/full/godot.prepared.js', wasm: 'engines/full/godot.wasm', requiresPreparedSource: false},
      'pure-2d': {profile: 'custom-official-c050-dev', js: 'engines/pure-2d/godot.prepared.js', wasm: 'engines/pure-2d/godot.wasm', requiresPreparedSource: true}},
  }));
  for (const file of ['engines/full/godot.prepared.js', 'engines/full/godot.wasm', 'engines/pure-2d/godot.prepared.js', 'engines/pure-2d/godot.wasm', 'tools/wx-transformer-v1.0.35-win.exe']) fs.writeFileSync(path.join(release, file), 'x');
  fs.writeFileSync(path.join(project, 'project.godot'), '[application]\nconfig/name="小测试"\nrun/main_scene="res://main.tscn"\n');
  fs.writeFileSync(path.join(project, 'export_presets.cfg'), PRESETS);
  const editor = path.join(root, 'godot.exe');
  fs.writeFileSync(editor, 'x');
  const settings = {schema: QUICK_SETTINGS_SCHEMA, template: 'full', orientation: 'landscape', glx: true, devtoolsPreview: false, output, ...overrides};
  fs.writeFileSync(path.join(project, 'wxslim-export.json'), JSON.stringify(settings));
  return {root, release, project, output, editor, fingerprint, options: {project, editor, release, now: NOW}};
}

test('a timestamp collision never adds a result to a run owned by another caller', async () => {
  const f = fixture();
  const {run} = resolveQuickInputs(f.options);
  fs.mkdirSync(run);
  const result = await quickRun(f.options);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'QUICK_RUN_EXISTS');
  assert.equal(result.writes, 'NONE');
  assert.deepEqual(fs.readdirSync(run), []);
});

test('a missing or failed rebuilt source blocks both panel actions before any output', async () => {
  const f = fixture({rebuiltPreparation:'review/preparation.json'});
  const review = path.join(f.project,'review'), raw = path.join(review,'raw');
  fs.mkdirSync(raw,{recursive:true});
  const taskId = '3cc52e62-3086-4559-b050-e1dbff9d94a6';
  for (const code of ['QUICK_REBUILT_CONFIG','QUICK_REBUILT_TASK']) {
    const plan = await quickPlan(f.options);
    const run = await quickRun(f.options);
    assert.equal(plan.ready,false);
    assert.equal(run.status,'BLOCKED');
    assert.equal(run.writes,'NONE');
    for (const result of [plan,run]) assert(result.blockers.some(b => b.field==='rebuiltPreparation' && b.code===code));
    assert.deepEqual(fs.readdirSync(f.output),[]);
    if (code==='QUICK_REBUILT_CONFIG') {
      fs.writeFileSync(path.join(review,'preparation.json'),JSON.stringify({schema:'wxslim-rebuilt-capability-pair-v1',rawTaskRoot:'raw',rawTaskId:taskId}));
      fs.writeFileSync(path.join(raw,'terminal.json'),JSON.stringify({status:'FAILED',taskId}));
    }
  }
});

test('conservative settings expose seven removals and require a PCK-specific confirmation', () => {
  const {confirmations} = templateRequirements('conservative');
  assert.equal(confirmations[0].removed3d, false);
  assert.deepEqual(confirmations[0].removedModules, ['enet','fbx','gltf','mobile_vr','upnp','vhacd','webxr']);
  const settings = normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, template: 'conservative', output: os.tmpdir(), devtoolsPreview:false});
  assert(settingsBlockers(settings).some(b => b.field === 'confirmRemovedModules'));
  const inputs = {settings, release:{profile:'custom-official-c050-dev', pair:'conservative'}, pairProof:'conservative.json'};
  const bytes = makePck();
  assert.throws(() => convertPayload(inputs, 'boot.pck', bytes), e => e.code === 'QUICK_CONSERVATIVE_NEEDS_CONFIRMATION');
  settings.confirmRemovedModules = true;
  const config = convertPayload(inputs, 'boot.pck', bytes);
  assert.equal(config.customPreparation, inputs.pairProof);
  assert.equal(config.projectUsage.pck.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(config.projectUsage.removedModules, confirmations[0].removedModules);
  assert.equal(config.projectUsage.engine3dRemoved, false);
});

function fakeService({eligible = true, status = 'SUCCESS'} = {}) {
  const calls = [];
  return {
    calls,
    async plan(file) {
      const request = JSON.parse(fs.readFileSync(file, 'utf8'));
      const config = JSON.parse(fs.readFileSync(request.configFile, 'utf8'));
      calls.push({kind: 'plan', action: request.action, file});
      return {schema: 'wxslim-task-plan-v1', action: request.action, eligible, purpose: 'development-test', plan: {config}};
    },
    async execute(file, options) {
      const request = JSON.parse(fs.readFileSync(file, 'utf8'));
      const config = JSON.parse(fs.readFileSync(request.configFile, 'utf8'));
      calls.push({kind: 'execute', action: request.action, file, options});
      if (status === 'SUCCESS' && request.action === 'project-pck-export') {
        fs.mkdirSync(config.output);
        fs.writeFileSync(path.join(config.output, 'full.pck'), makePck());
      }
      if (status === 'SUCCESS' && request.action === 'official-convert') {
        const mini = path.join(config.output, 'converted', 'minigame');
        fs.mkdirSync(mini, {recursive: true});
        fs.writeFileSync(path.join(mini, 'project.config.json'), '{}');
      }
      return {schema: 'wxslim-task-result-v1', action: request.action, status, taskId: 't-' + calls.length};
    },
  };
}

test('settings: schema, unknown fields and types are rejected; defaults fill the rest', () => {
  assert.throws(() => normalizeQuickSettings({}), {code: 'QUICK_SETTINGS_SCHEMA'});
  assert.throws(() => normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, templte: 'full'}), {code: 'QUICK_SETTINGS_FIELDS'});
  assert.throws(() => normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, glx: 'yes'}), {code: 'QUICK_SETTINGS_TYPE'});
  const value = normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, template: ' full '});
  assert.equal(value.template, 'full');
  assert.equal(value.orientation, 'portrait');
  assert.equal(value.glx, true);
  assert.equal(value.locale, 'zh_CN');
  assert.equal(value.devtoolsPreview, true);
});

test('blockers: unsupported combinations are named instead of silently downgraded', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-out-'));
  temporary.push(out);
  const base = normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, template: 'full', output: out, devtoolsPreview: false});
  assert.deepEqual(settingsBlockers(base), []);
  const codes = s => settingsBlockers({...base, ...s}).map(b => b.code);
  assert.deepEqual(codes({template: ''}), ['QUICK_TEMPLATE_MISSING']);
  assert.deepEqual(codes({template: '2d'}), ['QUICK_2D_NEEDS_CONFIRMATION']);
  assert.deepEqual(codes({template: '2d', confirmNo3d: true}), []);
  assert.deepEqual(codes({template: 'custom'}), ['QUICK_TEMPLATE_CUSTOM_PENDING']);
  assert.deepEqual(codes({skipPrewarm: true}), ['QUICK_PREWARM_UNSUPPORTED']);
  assert.deepEqual(codes({template: '2d', confirmNo3d: true, skipPrewarm: true}), ['QUICK_PREWARM_UNSUPPORTED']);
  assert.deepEqual(codes({subpackages: 'scenes'}), ['QUICK_SCENES_EMPTY']);
  assert.deepEqual(codes({subpackages: 'scenes', scenes: ['levels/a.tscn']}), ['QUICK_SCENES_PATH']);
  assert.deepEqual(codes({subpackages: 'scenes', scenes: ['res://levels/a.tscn']}), []);
  assert.deepEqual(codes({subpackages: 'parts'}), ['QUICK_SUBPACKAGES_UNKNOWN']);
  assert.deepEqual(codes({locale: 'en'}), []);
  assert.deepEqual(codes({locale: 'zh CN'}), ['QUICK_LOCALE_FORMAT']);
  assert.deepEqual(codes({loginCode: true}), []);
  assert.deepEqual(codes({loginCode: true, template: '2d', confirmNo3d: true}), ['QUICK_LOGIN_CODE_TEMPLATE']);
  assert.deepEqual(codes({loginCode: true, subpackages: 'scenes', scenes: ['res://levels/a.tscn']}), ['QUICK_LOGIN_CODE_SCENES']);
  for (const s of [{subpackages: 'scenes'}, {locale: 'x'}, {loginCode: true, template: 'conservative', confirmRemovedModules: true}])
    assert.ok(settingsBlockers({...base, ...s}).every(b => typeof b.field === 'string'), '每个拦截都要指向一个设置');
  assert.deepEqual(codes({output: ''}), ['QUICK_OUTPUT_MISSING']);
  assert.deepEqual(codes({output: 'relative/out'}), ['QUICK_OUTPUT_RELATIVE']);
  assert.deepEqual(codes({output: path.join(out, 'missing')}), ['QUICK_OUTPUT_NOT_FOUND']);
  assert.deepEqual(codes({appid: 'wx123'}), ['QUICK_APPID_FORMAT']);
  assert.deepEqual(codes({exportBudgetMiB: 500}), ['QUICK_EXPORT_BUDGET']);
});

test('presets, project name and run name', () => {
  assert.deepEqual(findWebPresets(PRESETS), ['Web']);
  assert.deepEqual(findWebPresets(PRESETS + '\n[preset.2]\nname="Web2"\nplatform="Web"\n'), ['Web', 'Web2']);
  assert.equal(projectName('[application]\nconfig/name="My \\"Game\\""\n'), 'My "Game"');
  assert.equal(runName('a b/c', NOW), 'a-b-c-20261107-090503');
  assert.equal(runName('', NOW), 'game-20261107-090503');
});

test('inputs: an output folder overlapping the game, editor or release is named in plain words before any export plan', async () => {
  const f = fixture();
  const settingsFile = path.join(f.project, 'wxslim-export.json');
  const withOutput = output => fs.writeFileSync(settingsFile, JSON.stringify({...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), output}));
  const inside = path.join(f.project, '临时输出');
  fs.mkdirSync(inside);
  withOutput(inside);
  const blockers = resolveQuickInputs(f.options).blockers;
  assert.deepEqual(blockers.map(b => [b.code, b.field]), [['QUICK_OUTPUT_INSIDE_PROJECT', 'output']]);
  assert.match(blockers[0].message, /游戏工程之外/);
  const service = {plan: async () => { throw new Error('export plan must not run'); }};
  const plan = await quickPlan(f.options, {service});
  assert.equal(plan.ready, false);
  assert.equal(plan.exportPlan, null);
  withOutput(f.root);
  assert.deepEqual(resolveQuickInputs(f.options).blockers.map(b => b.code).sort(),
    ['QUICK_OUTPUT_CONTAINS_EDITOR', 'QUICK_OUTPUT_CONTAINS_PROJECT', 'QUICK_OUTPUT_OVERLAPS_RELEASE']);
  withOutput(f.output);
  assert.deepEqual(resolveQuickInputs(f.options).blockers, []);
});

test('inputs: a wrong WeChat DevTools location is named and points at the devtools setting', () => {
  const f = fixture({devtools: 'C:/nowhere/微信开发者工具.exe'});
  assert.deepEqual(resolveQuickInputs(f.options).blockers.map(b => [b.code, b.field]), [['QUICK_DEVTOOLS_INVALID', 'devtools']]);
});

test('inputs: an installed but disabled panel plugin blocks export so its scripts stay out of the PCK', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.project, 'addons', 'wxslim_readonly'), {recursive: true});
  assert.deepEqual(resolveQuickInputs(f.options).blockers.map(b => [b.code, b.field]), [['QUICK_PLUGIN_NOT_ENABLED', 'plugin']]);
  fs.appendFileSync(path.join(f.project, 'project.godot'), '\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/wxslim_readonly/plugin.cfg")\n');
  assert.deepEqual(resolveQuickInputs(f.options).blockers, []);
});

test('inputs: fixed files come from the release, editor and preset are resolved, nothing is written', () => {
  const f = fixture();
  const before = fs.readdirSync(f.output);
  const inputs = resolveQuickInputs(f.options);
  assert.deepEqual(inputs.blockers, []);
  assert.equal(inputs.preset, 'Web');
  assert.equal(inputs.name, '小测试');
  assert.equal(inputs.release.js, path.join(f.release, 'engines', 'full', 'godot.prepared.js'));
  assert.equal(inputs.release.transformer, path.join(f.release, 'tools', 'wx-transformer-v1.0.35-win.exe'));
  assert.equal(inputs.interfaces, SIMPLE_INTERFACES);
  assert.equal(inputs.run, path.join(f.output, '小测试-20261107-090503'));
  assert.deepEqual(fs.readdirSync(f.output), before);
});

test('run: drafts equal the panel form builders and each step executes the plan it just reviewed', async () => {
  const f = fixture();
  const appidFrom = path.join(f.root, 'project.config.json');
  fs.writeFileSync(appidFrom, '{}');
  const settingsFile = path.join(f.project, 'wxslim-export.json');
  fs.writeFileSync(settingsFile, JSON.stringify({...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), appidFrom}));
  const service = fakeService();
  const opened = [];
  const result = await quickRun(f.options, {service, openProject: (file, from) => { opened.push([file, from]); return {ok: true}; }});
  assert.equal(result.status, 'SUCCESS', JSON.stringify(result.error));
  assert.deepEqual(service.calls.map(c => `${c.kind}:${c.action}`),
    ['plan:project-pck-export', 'execute:project-pck-export', 'plan:official-convert', 'execute:official-convert']);
  const inputs = resolveQuickInputs(f.options);
  const requests = path.join(result.run, 'requests');
  const exportDraft = buildExportRequestDraft({editorExecutable: f.editor}, exportPayload(inputs),
    {configFile: path.join(requests, 'export-config.json'), requestFile: path.join(requests, 'export-request.json')});
  assert.equal(fs.readFileSync(path.join(requests, 'export-config.json'), 'utf8'), exportDraft.configText);
  assert.equal(fs.readFileSync(path.join(requests, 'export-request.json'), 'utf8'), exportDraft.requestText);
  const convertDraft = buildOfficialConvertRequestDraft(convertPayload(inputs, path.join(inputs.exportOutput, 'full.pck')),
    {configFile: path.join(requests, 'convert-config.json'), requestFile: path.join(requests, 'convert-request.json')});
  assert.equal(fs.readFileSync(path.join(requests, 'convert-config.json'), 'utf8'), convertDraft.configText);
  const convertConfig = JSON.parse(convertDraft.configText);
  assert.equal(convertConfig.engineProfile, 'full-official-c050-capability-dev');
  assert.equal(convertConfig.renderMode, 'glx');
  assert.equal(convertConfig.orientation, 'landscape');
  assert.equal(convertConfig.interfaces, SIMPLE_INTERFACES);
  for (const call of service.calls.filter(c => c.kind === 'execute')) {
    assert.equal(call.options.write, true);
    assert.match(call.options.expectedPlanSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(result.steps.export.planSha256, service.calls[1].options.expectedPlanSha256);
  assert.equal(result.projectConfig, path.join(result.run, 'wechat', 'converted', 'minigame', 'project.config.json'));
  assert.deepEqual(opened, [[result.projectConfig, appidFrom]]);
});

test('run: digest passed to execute is the identity of the reviewed plan', async () => {
  const f = fixture();
  const service = fakeService();
  const plans = [];
  const wrapped = {...service, async plan(file) { const p = await service.plan(file); plans.push(p); return p; }, execute: service.execute};
  await quickRun(f.options, {service: wrapped});
  const executes = service.calls.filter(c => c.kind === 'execute');
  assert.equal(executes[0].options.expectedPlanSha256, taskPlanIdentity(plans[0]));
  assert.equal(executes[1].options.expectedPlanSha256, taskPlanIdentity(plans[1]));
});

test('run: an ineligible export plan stops before any execution', async () => {
  const f = fixture();
  const service = fakeService({eligible: false});
  const result = await quickRun(f.options, {service});
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'QUICK_PLAN_INELIGIBLE');
  assert.deepEqual(service.calls.map(c => c.kind), ['plan']);
});

test('run: a failed export does not continue to conversion', async () => {
  const f = fixture();
  const service = fakeService({status: 'FAILED'});
  const result = await quickRun(f.options, {service});
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'QUICK_TASK_NOT_SUCCESS');
  assert.deepEqual(service.calls.map(c => `${c.kind}:${c.action}`), ['plan:project-pck-export', 'execute:project-pck-export']);
});

test('run: an existing run directory is never reused', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.output, '小测试-20261107-090503'));
  const service = fakeService();
  const result = await quickRun(f.options, {service});
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(service.calls, []);
});

test('run: --open without an AppID source is blocked before anything is written', async () => {
  const f = fixture();
  const service = fakeService();
  const result = await quickRun(f.options, {service, openProject: () => ({})});
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.blockers.map(b => b.code), ['QUICK_OPEN_NEEDS_APPID_SOURCE']);
  assert.deepEqual(fs.readdirSync(f.output), []);
  assert.deepEqual(service.calls, []);
});

test('preview: GLX preview needs an AppID source, zh_CN and a main scene', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-out-'));
  temporary.push(out);
  const base = normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, template: 'full', output: out});
  assert.deepEqual(settingsBlockers(base).map(b => b.code), ['QUICK_PREVIEW_NEEDS_APPID_SOURCE']);
  assert.deepEqual(settingsBlockers({...base, glx: false}).map(b => b.code), [], 'WebGL needs no preview package');
  const source = path.join(out, 'project.config.json');
  fs.writeFileSync(source, '{}');
  assert.deepEqual(settingsBlockers({...base, appidFrom: source, locale: 'en'}).map(b => b.code), ['QUICK_PREVIEW_LOCALE']);
  assert.equal(resolveMainScene(out, 'run/main_scene="res://a/b.tscn"\n'), 'res://a/b.tscn');
  fs.mkdirSync(path.join(out, 'levels'));
  fs.writeFileSync(path.join(out, 'levels', 'start.tscn'), '[gd_scene format=3 uid="uid://abc123"]\n');
  assert.equal(resolveMainScene(out, 'run/main_scene="uid://abc123"\n'), 'res://levels/start.tscn');
  assert.equal(resolveMainScene(out, '[application]\n'), '');
});

test('preview: run assembles the same-package preview and opens it without rewriting the AppID', async () => {
  const f = fixture();
  const appidFrom = path.join(f.root, 'project.config.json');
  fs.writeFileSync(appidFrom, '{}');
  const settingsFile = path.join(f.project, 'wxslim-export.json');
  fs.writeFileSync(settingsFile, JSON.stringify({...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), devtoolsPreview: true, appidFrom}));
  const assembled = [], opened = [];
  const assemble = args => {
    assembled.push(args);
    const mini = path.join(args.output, 'minigame');
    fs.mkdirSync(mini, {recursive: true});
    fs.writeFileSync(path.join(mini, 'project.config.json'), '{}');
    return {packageId: 'wxslim-preview', parent: 'wxslim-parent', files: 3, bytes: 10};
  };
  const result = await quickRun(f.options, {service: fakeService(), assemble, openProject: (file, from) => { opened.push([file, from]); return {}; }});
  assert.equal(result.status, 'SUCCESS', JSON.stringify(result.error));
  assert.equal(assembled.length, 1);
  assert.equal(assembled[0].convertOutput, path.join(result.run, 'wechat'));
  assert.equal(assembled[0].output, path.join(result.run, 'devtools'));
  assert.equal(assembled[0].appidFrom, appidFrom);
  const packs = JSON.parse(fs.readFileSync(assembled[0].packsFile, 'utf8'));
  assert.equal(packs.packs.length, 1);
  assert.equal(packs.packs[0].role, 'boot');
  assert.equal(packs.packs[0].entryScene, 'res://main.tscn');
  assert.equal(packs.packs[0].file, path.join(result.run, 'pck', 'full.pck'));
  assert.equal(result.steps.devtools.packageId, 'wxslim-preview');
  assert.deepEqual(opened, [[path.join(result.run, 'devtools', 'minigame', 'project.config.json'), '']]);
});

test('run: blocked settings write nothing', async () => {
  const f = fixture({template: '2d'});
  const service = fakeService();
  const result = await quickRun(f.options, {service});
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(f.output), []);
  assert.deepEqual(service.calls, []);
});

test('plan: export plan runs from a temporary draft and leaves output untouched', async () => {
  const f = fixture();
  const service = fakeService();
  const result = await quickPlan(f.options, {service});
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.equal(result.exportPlan.eligible, true);
  assert.deepEqual(fs.readdirSync(f.output), []);
  const planned = service.calls[0];
  assert.equal(fs.existsSync(planned.file), false, 'temporary draft removed');
  assert.deepEqual(service.calls.map(c => c.kind), ['plan']);
});

test('cli: run needs --write; unknown flags are refused', async () => {
  const out = [], err = [];
  const io = {stdout: {write: s => out.push(s)}, stderr: {write: s => err.push(s)}};
  assert.equal(await runQuickCli(['run', 'X'], io), 1);
  assert.match(err.join(''), /--write/);
  assert.equal(await runQuickCli(['plan', 'X', '--bogus'], io), 1);
});

test('cancel: a marker written during export stops the run before conversion executes', async () => {
  const f = fixture();
  const service = fakeService();
  const execute = service.execute;
  service.execute = async (file, options) => {
    const outcome = await execute(file, options);
    const run = path.dirname(path.dirname(file));
    fs.writeFileSync(path.join(run, CANCEL_MARKER), '{}');
    return outcome;
  };
  const result = await quickRun(f.options, {service});
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.error.code, 'QUICK_CANCELLED');
  assert.deepEqual(service.calls.map(c => `${c.kind}:${c.action}`), ['plan:project-pck-export', 'execute:project-pck-export', 'plan:official-convert']);
  assert.ok(fs.existsSync(path.join(result.run, 'pck', 'full.pck')), 'nothing is rolled back');
});

test('cancel: a task that ends CANCELLED makes the run CANCELLED, not FAILED', async () => {
  const f = fixture();
  const result = await quickRun(f.options, {service: fakeService({status: 'CANCELLED'})});
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.error.task.status, 'CANCELLED');
});

test('cancel: the active shared task is cancelled through the task service with an explicit write', async () => {
  const f = fixture();
  const run = path.join(f.output, 'r1'), root = path.join(run, 'wechat'), requestFile = path.join(run, 'requests', 'convert-request.json');
  fs.mkdirSync(path.join(run, 'requests'), {recursive: true});
  fs.mkdirSync(root);
  fs.writeFileSync(requestFile, '{}');
  fs.writeFileSync(path.join(run, 'requests', 'active-task.json'), JSON.stringify({step: 'convert', requestFile, taskRoot: root}));
  fs.writeFileSync(path.join(root, 'TASK.json'), JSON.stringify({schema: 'wxslim-official-task-v1', taskId: 'abc'}));
  const calls = [];
  const service = {
    status(file, options) { calls.push(['status', file, options]); return {status: 'NO_TERMINAL_RECEIPT', terminalPresent: false, inputBinding: 'MATCHED_EXECUTION_SNAPSHOT'}; },
    async cancel(file, options) { calls.push(['cancel', file, options]); return {cancel: {accepted: true}}; },
  };
  const first = await cancelQuickRun(run, {service, waitMs: 0});
  assert.equal(first.markerWritten, true);
  assert.deepEqual(first.task, {step: 'convert', taskId: 'abc', status: 'NO_TERMINAL_RECEIPT', accepted: true, duplicate: false, alreadyEnded: false});
  assert.deepEqual(calls[1], ['cancel', requestFile, {root, taskId: 'abc', write: true}]);
  const second = await cancelQuickRun(run, {service, waitMs: 0});
  assert.equal(second.markerWritten, false);
});

test('cancel: an ended task is not cancelled; no task yet leaves only the marker', async () => {
  const f = fixture();
  const run = path.join(f.output, 'r2');
  fs.mkdirSync(path.join(run, 'requests'), {recursive: true});
  const service = {status() { throw Error('no status without a task'); }, cancel() { throw Error('no cancel'); }};
  const result = await cancelQuickRun(run, {service, waitMs: 0});
  assert.equal(result.task, null);
  assert.ok(fs.existsSync(path.join(run, CANCEL_MARKER)));
  await assert.rejects(cancelQuickRun(path.join(f.output, 'missing'), {service, waitMs: 0}), {code: 'QUICK_CANCEL_RUN_INVALID'});
  assert.equal(planTaskRoot({action: 'official-convert', plan: {taskRoot: run}}), run);
  assert.equal(planTaskRoot({action: 'project-pck-export', plan: {input: {output: run}}}), run);
  assert.equal(planTaskRoot({action: 'project-pck-export', plan: {input: {output: 'relative'}}}), '');
});

test('adapter: cancel finds the run from its start event and refuses ended or unknown runs', async () => {
  const f = fixture();
  const state = path.join(f.root, 'state'), logs = path.join(state, 'logs');
  fs.mkdirSync(logs, {recursive: true});
  const configFile = path.join(state, 'local-config.json');
  fs.writeFileSync(configFile, JSON.stringify({}));
  const seen = [];
  const cancel = async run => { seen.push(run); return {schema: 'wxslim-quick-cancel-v1', status: 'CANCEL_REQUESTED'}; };
  const call = async (token, request) => {
    fs.writeFileSync(path.join(logs, token + '.quick-request.private.json'), JSON.stringify(request));
    return runQuickAdapter(configFile, 'cancel', token, {cancel, load: () => ({})});
  };
  const run = path.join(f.output, 'r3');
  fs.writeFileSync(path.join(logs, '1-1.quick-events.private.jsonl'), JSON.stringify({step: 'start', phase: 'start', run}) + '\n');
  const missing = await call('1-2', {runToken: '1-9'});
  assert.equal(missing.code, 'QUICK_ADAPTER_CANCEL_NOT_STARTED');
  const ok = await call('1-3', {runToken: '1-1'});
  assert.equal(ok.status, 'CANCEL_REQUESTED');
  assert.deepEqual(seen, [run]);
  fs.writeFileSync(path.join(logs, '1-1.quick-result.private.json'), '{}');
  const ended = await call('1-4', {runToken: '1-1'});
  assert.equal(ended.code, 'QUICK_ADAPTER_CANCEL_ENDED');
  const bad = await call('1-5', {runToken: '../x'});
  assert.equal(bad.code, 'QUICK_ADAPTER_CANCEL');
});

test('opening a finished run resolves its existing project and refuses an unfinished run', async () => {
  const f = fixture();
  const run = fakeRun(f.output, 'completed', {exportStatus:'SUCCESS', convertStatus:'SUCCESS'});
  const source = path.join(f.root, 'project.config.json');
  const launched = [];
  const io = {stdout:{write(){}}, stderr:{write(){}}, openProject:(...args)=>{launched.push(args); return {opened:true};}};
  assert.equal(await runQuickCli(['open', run, '--appid-from', source], io), 1);
  assert.equal(await runQuickCli(['open', run, '--write', '--appid-from', source], io), 0);
  const unfinished = fakeRun(f.output, 'unfinished', {exportStatus:'SUCCESS'});
  assert.equal(await runQuickCli(['open', unfinished, '--write'], io), 1);
  assert.deepEqual(launched, [[path.join(run,'wechat/converted/minigame/project.config.json'), source]]);
});

function fakeRun(output, name, {exportStatus, convertStatus, marker = false, preview = false, active = null} = {}) {
  const run = path.join(output, name);
  fs.mkdirSync(path.join(run, 'requests'), {recursive: true});
  fs.writeFileSync(path.join(run, 'requests', 'export-request.json'), '{}');
  for (const [dir, status] of [['pck', exportStatus], ['wechat', convertStatus]]) {
    if (!status) continue;
    fs.mkdirSync(path.join(run, dir), {recursive: true});
    fs.writeFileSync(path.join(run, dir, 'TASK.json'), JSON.stringify({taskId: dir}));
    if (status !== 'RUNNING') fs.writeFileSync(path.join(run, dir, 'terminal.json'), JSON.stringify({status}));
  }
  if (convertStatus === 'SUCCESS') {
    fs.mkdirSync(path.join(run, 'wechat', 'converted', 'minigame'), {recursive: true});
    fs.writeFileSync(path.join(run, 'wechat', 'converted', 'minigame', 'project.config.json'), '{}');
  }
  if (preview) {
    fs.mkdirSync(path.join(run, 'devtools', 'minigame'), {recursive: true});
    fs.writeFileSync(path.join(run, 'devtools', 'PACKAGE.json'), JSON.stringify({packageId: 'wxslim-p', parent: 'wxslim-c'}));
    fs.writeFileSync(path.join(run, 'devtools', 'minigame', 'project.config.json'), '{}');
  }
  if (marker) fs.writeFileSync(path.join(run, CANCEL_MARKER), '{}');
  if (active) fs.writeFileSync(path.join(run, 'requests', 'active-task.json'), JSON.stringify({step: active, requestFile: '', taskRoot: path.join(run, active === 'export' ? 'pck' : 'wechat')}));
  return run;
}

test('runs: a finished run writes a summary that the run list reads back', async () => {
  const f = fixture();
  const result = await quickRun(f.options, {service: fakeService()});
  const summary = JSON.parse(fs.readFileSync(path.join(result.run, RUN_SUMMARY), 'utf8'));
  assert.equal(summary.status, 'SUCCESS');
  assert.equal(summary.projectConfig, result.projectConfig);
  const listed = listQuickRuns(f.output);
  assert.equal(listed.total, 1);
  assert.equal(listed.runs[0].status, 'SUCCESS');
  assert.equal(listed.runs[0].source, 'summary');
  assert.equal(listed.runs[0].openTarget, result.projectConfig);
  const cancelled = await quickRun({...f.options, now: new Date(2026, 10, 7, 9, 6, 0)}, {service: fakeService({status: 'CANCELLED'})});
  assert.equal(JSON.parse(fs.readFileSync(path.join(cancelled.run, RUN_SUMMARY), 'utf8')).error.code, 'QUICK_CANCELLED');
});

test('progress shows only the bound task event and a partial owner never completes a pending cancel', async () => {
  const f = fixture();
  const run = fakeRun(f.output, 'live', {exportStatus:'RUNNING', active:'export', marker:true});
  const event = {taskId:'pck', at:'2026-11-08T00:00:00.000Z', stage:'EXPORT', status:'RUNNING', details:{private:'omitted'}};
  fs.writeFileSync(path.join(run, 'pck/events.jsonl'), JSON.stringify(event) + '\n');
  const state = quickRunStatus(run);
  assert.equal(state.status, 'UNFINISHED');
  assert.equal(state.cancelRequested, true);
  assert.equal(state.progress.taskId, 'pck');
  assert.equal(state.progress.step, 'export');
  assert.equal(state.progress.readStatus, 'COMPLETE');
  assert.deepEqual(state.progress.lastEvent, {stage:event.stage, status:event.status, at:event.at, wallMs:null});
  assert.equal(state.progress.scope, 'LAST_RECORDED_EVENT_NOT_LIVENESS_OR_TERMINAL');
  fs.writeFileSync(path.join(run,'pck/TASK.json'), '{');
  assert.equal(quickRunStatus(run).progress, null);
  assert.equal(quickRunStatus(run).status, 'UNFINISHED');
  const sibling = fakeRun(f.output, 'sibling', {exportStatus:'RUNNING',active:'export'});
  const record = {step:'export', taskRoot:path.join(sibling,'pck'), requestFile:path.join(sibling,'requests/export-request.json')};
  fs.writeFileSync(path.join(run,'requests/active-task.json'), JSON.stringify(record));
  assert.equal(quickRunStatus(run).progress, null);
  const never = () => assert.fail('cancel crossed the run boundary');
  const cancelled = await cancelQuickRun(run, {service:{status:never, cancel:never},waitMs:0});
  assert.equal(cancelled.task, null);
  assert.equal(fs.existsSync(path.join(sibling,CANCEL_MARKER)), false);
});

test('runs: runs without a summary are inferred from task receipts and the cancel marker', () => {
  const f = fixture();
  const status = name => quickRunStatus(path.join(f.output, name)).status;
  fakeRun(f.output, 'ok', {exportStatus: 'SUCCESS', convertStatus: 'SUCCESS', preview: true});
  fakeRun(f.output, 'ok-no-preview', {exportStatus: 'SUCCESS', convertStatus: 'SUCCESS'});
  fakeRun(f.output, 'cancel-task', {exportStatus: 'SUCCESS', convertStatus: 'CANCELLED', marker: true});
  fakeRun(f.output, 'cancel-between', {exportStatus: 'SUCCESS', marker: true, active: 'export'});
  fakeRun(f.output, 'cancel-pending', {exportStatus: 'SUCCESS', convertStatus: 'RUNNING', marker: true, active: 'convert'});
  fakeRun(f.output, 'failed', {exportStatus: 'FAILED'});
  fakeRun(f.output, 'running', {exportStatus: 'RUNNING', active: 'export'});
  fs.mkdirSync(path.join(f.output, 'not-a-run'));
  assert.equal(status('ok'), 'SUCCESS');
  assert.equal(quickRunStatus(path.join(f.output, 'ok')).packageId, 'wxslim-p');
  assert.equal(status('ok-no-preview'), 'SUCCESS');
  assert.equal(status('cancel-task'), 'CANCELLED');
  assert.equal(status('cancel-between'), 'CANCELLED');
  assert.equal(status('cancel-pending'), 'UNFINISHED', 'a requested cancel is not done until the task ends');
  assert.equal(status('failed'), 'FAILED');
  assert.equal(status('running'), 'UNFINISHED');
  assert.equal(quickRunStatus(path.join(f.output, 'failed')).openTarget, '');
  assert.equal(quickRunStatus(path.join(f.output, 'not-a-run')), null);
  assert.equal(listQuickRuns(f.output).total, 7);
  assert.throws(() => listQuickRuns(path.join(f.output, 'missing')), {code: 'QUICK_RUNS_OUTPUT_INVALID'});
});

test('adapter: runs lists the output; cancel by run directory only for unfinished runs', async () => {
  const f = fixture();
  const state = path.join(f.root, 'state'), logs = path.join(state, 'logs');
  fs.mkdirSync(logs, {recursive: true});
  const configFile = path.join(state, 'local-config.json');
  const cancelled = [];
  const call = async (token, mode, request) => {
    fs.writeFileSync(path.join(logs, token + '.quick-request.private.json'), JSON.stringify(request));
    return runQuickAdapter(configFile, mode, token, {load: () => ({}), cancel: async run => { cancelled.push(run); return {status: 'CANCEL_REQUESTED'}; }});
  };
  const done = fakeRun(f.output, 'done', {exportStatus: 'SUCCESS', convertStatus: 'SUCCESS'});
  const running = fakeRun(f.output, 'running', {exportStatus: 'RUNNING', active: 'export'});
  const listed = await call('2-1', 'runs', {output: f.output});
  assert.equal(listed.total, 2);
  assert.equal((await call('2-2', 'cancel', {run: done})).code, 'QUICK_ADAPTER_CANCEL_ENDED');
  assert.equal((await call('2-3', 'cancel', {run: f.output})).code, 'QUICK_ADAPTER_CANCEL');
  assert.equal((await call('2-4', 'cancel', {run: running})).status, 'CANCEL_REQUESTED');
  assert.deepEqual(cancelled, [running]);
  assert.equal((await call('2-5', 'runs', {output: 'relative'})).code, 'QUICK_ADAPTER_RUNS');
});

test('2d: the run converts with the pure-2D pair, the installed fingerprint and a declaration bound to this PCK', async () => {
  const f = fixture({template: '2d', confirmNo3d: true});
  const service = fakeService();
  const result = await quickRun(f.options, {service});
  assert.equal(result.status, 'SUCCESS');
  const config = JSON.parse(fs.readFileSync(path.join(result.run, 'requests', 'convert-config.json'), 'utf8'));
  assert.equal(config.engineProfile, 'custom-official-c050-dev');
  assert.equal(config.js, path.join(f.release, 'engines', 'pure-2d', 'godot.prepared.js'));
  assert.equal(config.customPreparation, f.fingerprint);
  const pck = fs.readFileSync(path.join(result.run, 'pck', 'full.pck'));
  assert.deepEqual(config.projectUsage.pck, {bytes: pck.length, sha256: createHash('sha256').update(pck).digest('hex')});
  assert.equal(config.projectUsage.removedFeaturesUnused, true);
  assert.deepEqual(config.projectUsage.removedModules, pure2dRemovedModules());
  assert.equal(config.projectUsage.engine3dRemoved, true);
});

test('2d: no confirmation or no installed fingerprint blocks before anything is written', async () => {
  const unconfirmed = fixture({template: '2d'});
  const blocked = await quickRun(unconfirmed.options, {service: fakeService()});
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(blocked.blockers.some(b => b.code === 'QUICK_2D_NEEDS_CONFIRMATION'));
  const noProof = fixture({template: '2d', confirmNo3d: true});
  fs.rmSync(noProof.fingerprint);
  const service = fakeService();
  const result = await quickRun({...noProof.options, env: {}}, {service});
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.some(b => b.code === 'QUICK_PAIR_FINGERPRINT'));
  assert.deepEqual(service.calls, []);
  assert.deepEqual(fs.readdirSync(noProof.output), []);
});

test('2d: legacy proof settings cannot override or repair the installed fingerprint', () => {
  const f = fixture();
  const other = path.join(f.root, 'old-proof');
  assert.equal(resolvePairProof(f.release, other, {WXSLIM_PAIR_PROOF:other}), f.fingerprint);
  fs.copyFileSync(new URL('../offline/vendor/engines/conservative/fingerprint.json', import.meta.url), f.fingerprint);
  assert.throws(() => resolvePairProof(f.release, other, {}), {code:'QUICK_PAIR_FINGERPRINT'});
});
