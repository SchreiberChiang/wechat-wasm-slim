import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureLocalAppId, assembledCopy} from './open-project.mjs';
import {PLACEHOLDER_APPID} from '../../convert/lib/verify.mjs';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });
const APPID = 'wx0123456789abcdef';

// 一个转换结果目录：converted/CONVERT_REPORT.json + converted/minigame/{project.config.json, wx-game-kit/config.json}
function converted(task, reportMinigame) {
  const mini = path.join(task, 'converted', 'minigame');
  fs.mkdirSync(path.join(mini, 'wx-game-kit'), {recursive: true});
  fs.writeFileSync(path.join(mini, 'project.config.json'), JSON.stringify({compileType: 'game', appid: PLACEHOLDER_APPID}));
  fs.writeFileSync(path.join(mini, 'wx-game-kit', 'config.json'), JSON.stringify({project: {app: {appID: PLACEHOLDER_APPID}}}));
  fs.writeFileSync(path.join(task, 'converted', 'CONVERT_REPORT.json'), JSON.stringify({appidSource: 'placeholder', minigame: reportMinigame ?? mini}));
  return path.join(mini, 'project.config.json');
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-open-'));
  temporary.push(root);
  const source = path.join(root, 'source', 'project.config.json');
  fs.mkdirSync(path.dirname(source));
  fs.writeFileSync(source, JSON.stringify({compileType: 'game', appid: APPID}));
  return {root, source};
}

test('an official output and a completed assembly copy of it get the local AppID; look-alikes are refused', () => {
  const f = setup();
  const official = converted(path.join(f.root, 'run', 'wechat'));
  assert.equal(configureLocalAppId(official, f.source), 2);
  assert.equal(JSON.parse(fs.readFileSync(official, 'utf8')).appid, APPID);

  const finalTask = path.join(f.root, 'run', 'final');
  const copy = converted(finalTask, path.join(f.root, 'run', 'wechat', 'converted', 'minigame'));
  assert.throws(() => configureLocalAppId(copy, f.source), /目标与官方转换回执不匹配/, '没有组包收据时拒绝');
  fs.writeFileSync(path.join(finalTask, 'TASK.json'), JSON.stringify({taskId: 't1', recipeId: 'resource-runtime-assemble:abc'}));
  fs.writeFileSync(path.join(finalTask, 'terminal.json'), JSON.stringify({taskId: 't1', status: 'FAILED', details: {kind: 'RESOURCE_RUNTIME_ASSEMBLE'}}));
  assert.throws(() => configureLocalAppId(copy, f.source), /目标与官方转换回执不匹配/, '组包没成功时拒绝');
  fs.writeFileSync(path.join(finalTask, 'terminal.json'), JSON.stringify({taskId: 't1', status: 'SUCCESS', details: {kind: 'RESOURCE_RUNTIME_ASSEMBLE'}}));
  assert.equal(assembledCopy(path.dirname(copy), JSON.parse(fs.readFileSync(path.join(finalTask, 'converted', 'CONVERT_REPORT.json'), 'utf8'))), true);
  assert.equal(configureLocalAppId(copy, f.source), 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(copy), 'wx-game-kit', 'config.json'), 'utf8')).project.app.appID, APPID);

  const other = path.join(f.root, 'other');
  const stray = converted(other, path.join(f.root, 'elsewhere', 'minigame'));
  fs.writeFileSync(path.join(other, 'TASK.json'), JSON.stringify({taskId: 't2', recipeId: 'official-convert:abc'}));
  fs.writeFileSync(path.join(other, 'terminal.json'), JSON.stringify({taskId: 't2', status: 'SUCCESS', details: {kind: 'RESOURCE_RUNTIME_ASSEMBLE'}}));
  assert.throws(() => configureLocalAppId(stray, f.source), /目标与官方转换回执不匹配/, '别的任务目录不算组包副本');
});
