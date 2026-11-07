import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeQuickSettings, settingsBlockers, findWebPresets, projectName, runName, resolveQuickInputs,
  quickPlan, quickRun, exportPayload, convertPayload, QUICK_SETTINGS_SCHEMA, SIMPLE_INTERFACES,
} from '../lib/quick-flow.mjs';
import {runQuickCli} from '../lib/quick-cli.mjs';
import {taskPlanIdentity} from '../lib/task-core.mjs';
import {buildExportRequestDraft} from '../editor/workbench/export-request-form.mjs';
import {buildOfficialConvertRequestDraft} from '../editor/workbench/official-convert-request-form.mjs';

const NOW = new Date(2026, 10, 7, 9, 5, 3);
const PRESETS = '[preset.0]\nname="Web"\nplatform="Web"\nexport_filter="all_resources"\n\n[preset.0.options]\nfoo=1\n\n[preset.1]\nname="Win"\nplatform="Windows Desktop"\n';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-test-'));
  temporary.push(root);
  const release = path.join(root, 'release'), project = path.join(root, 'game'), output = path.join(root, 'out');
  for (const dir of [release, project, output, path.join(release, 'engines', 'full'), path.join(release, 'tools')]) fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(release, 'RELEASE.json'), '{}');
  fs.writeFileSync(path.join(release, 'profiles.json'), JSON.stringify({
    schema: 1, files: {'engines/full/godot.prepared.js': {}, 'engines/full/godot.wasm': {}, 'tools/wx-transformer-v1.0.35-win.exe': {}},
    pairs: {full: {profile: 'full-official-c050-capability-dev', js: 'engines/full/godot.prepared.js', wasm: 'engines/full/godot.wasm', requiresPreparedSource: false}},
  }));
  for (const file of ['engines/full/godot.prepared.js', 'engines/full/godot.wasm', 'tools/wx-transformer-v1.0.35-win.exe']) fs.writeFileSync(path.join(release, file), 'x');
  fs.writeFileSync(path.join(project, 'project.godot'), '[application]\nconfig/name="小测试"\n');
  fs.writeFileSync(path.join(project, 'export_presets.cfg'), PRESETS);
  const editor = path.join(root, 'godot.exe');
  fs.writeFileSync(editor, 'x');
  const settings = {schema: QUICK_SETTINGS_SCHEMA, template: 'full', orientation: 'landscape', glx: true, output, ...overrides};
  fs.writeFileSync(path.join(project, 'wxslim-export.json'), JSON.stringify(settings));
  return {root, release, project, output, editor, options: {project, editor, release, now: NOW}};
}

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
        fs.writeFileSync(path.join(config.output, 'full.pck'), 'pck');
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
  assert.equal(value.locale, 'en');
});

test('blockers: unsupported combinations are named instead of silently downgraded', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-out-'));
  temporary.push(out);
  const base = normalizeQuickSettings({schema: QUICK_SETTINGS_SCHEMA, template: 'full', output: out});
  assert.deepEqual(settingsBlockers(base), []);
  const codes = s => settingsBlockers({...base, ...s}).map(b => b.code);
  assert.deepEqual(codes({template: ''}), ['QUICK_TEMPLATE_MISSING']);
  assert.deepEqual(codes({template: '2d'}), ['QUICK_TEMPLATE_NEEDS_PREPARATION']);
  assert.deepEqual(codes({template: 'custom'}), ['QUICK_TEMPLATE_NEEDS_PREPARATION']);
  assert.deepEqual(codes({skipPrewarm: true}), ['QUICK_PREWARM_UNSUPPORTED']);
  assert.deepEqual(codes({subpackages: 'scenes'}), ['QUICK_SUBPACKAGES_PENDING']);
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
