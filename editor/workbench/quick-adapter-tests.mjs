import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {quickSettingsFromPanel, runQuickAdapter} from './quick-adapter.mjs';
import {normalizeQuickSettings} from '../../lib/quick-flow.mjs';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });
function logsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-quick-adapter-'));
  temporary.push(dir);
  return dir;
}

const PANEL = {storage: 'project', template: 'full', orientation: 'landscape', glx: true, skipPrewarm: false, subpackages: 'none', scenes: [],
  appid: 'wx0123456789abcdef', appidFrom: '', gameName: '测试', output: 'D:/out', project: 'D:/game'};

test('panel settings map to quick settings; panel-only keys are dropped', () => {
  const logs = logsDir();
  const settings = quickSettingsFromPanel({...PANEL, appidFrom: 'D:/mini/project.config.json'}, logs, '1-2');
  assert.equal(settings.appidFrom, 'D:/mini/project.config.json');
  assert.equal(Object.hasOwn(settings, 'storage'), false);
  assert.equal(Object.hasOwn(settings, 'project'), false);
  assert.deepEqual(fs.readdirSync(logs), [], 'no generated source when a real one exists');
  assert.doesNotThrow(() => normalizeQuickSettings(settings));
});

test('a typed AppID without a source file becomes a local AppID source record', () => {
  const logs = logsDir();
  const settings = quickSettingsFromPanel(PANEL, logs, '1-2');
  assert.equal(settings.appidFrom, path.join(logs, '1-2-appid', 'project.config.json'));
  const source = JSON.parse(fs.readFileSync(settings.appidFrom, 'utf8'));
  assert.equal(source.compileType, 'game');
  assert.equal(source.appid, PANEL.appid);
});

test('an invalid typed AppID is passed through for the quick flow to reject, never turned into a source', () => {
  const logs = logsDir();
  const settings = quickSettingsFromPanel({...PANEL, appid: 'wx123'}, logs, '1-2');
  assert.equal(settings.appidFrom, '');
  assert.deepEqual(fs.readdirSync(logs), []);
});

test('adapter refuses unknown modes and malformed tokens before reading anything', async () => {
  await assert.rejects(runQuickAdapter('missing/local-config.json', 'execute', '1-2'), {code: 'QUICK_ADAPTER_ARGUMENT'});
  await assert.rejects(runQuickAdapter('missing/local-config.json', 'run', '../x'), {code: 'QUICK_ADAPTER_ARGUMENT'});
});
