// 转换器运行期间，任务目录里的临时文件会被创建又删除。观察子进程（取消检查、子进程事件）
// 不能递归统计这个正在变化的目录，否则「文件刚列出就被删掉」会让成功的转换被判失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTask} from '../convert/lib/official-task.mjs';

const roots = [];
test.after(() => { for (const dir of roots) fs.rmSync(dir, {recursive: true, force: true}); });

function taskWithVanishingFile(budgetBytes = 1024 * 1024) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-observe-')));
  roots.push(parent);
  const task = createTask(path.join(parent, 'task'), {budgetBytes, recipeId: 'test:observe'});
  const work = path.join(task.root, 'converted', 'convert-work');
  fs.mkdirSync(work, {recursive: true});
  fs.writeFileSync(path.join(work, 'vanishing.js'), 'x');
  return {task, work};
}

// 让目录遍历在 lstat 时撞上「刚被删除」的文件，与真实失败日志中的 ENOENT 相同。
function withVanishingLstat(action) {
  const original = fs.lstatSync;
  fs.lstatSync = function (file, ...rest) {
    if (String(file).endsWith('vanishing.js')) throw Object.assign(Error(`ENOENT: no such file or directory, lstat '${file}'`), {code: 'ENOENT'});
    return original.call(this, file, ...rest);
  };
  try { return action(); } finally { fs.lstatSync = original; }
}

test('measuring cancellation check fails on a file removed mid-walk (the original failure)', () => {
  const {task} = taskWithVanishingFile();
  withVanishingLstat(() => assert.throws(() => task.isCancellationRequested(), {code: 'ENOENT'}));
});

test('read-only cancellation check and observe() do not walk the active tree', () => {
  const {task} = taskWithVanishingFile();
  withVanishingLstat(() => {
    assert.equal(task.readCancellationRequested(), false);
    task.observe({stage: 'CONVERTER', status: 'RUNNING', details: {type: 'started'}});
    assert.throws(() => task.event({stage: 'CONVERTER', status: 'RUNNING'}), {code: 'ENOENT'});
  });
  const events = fs.readFileSync(path.join(task.root, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).details.type, 'started');
});

test('observe() validates events the same way as event()', () => {
  const {task} = taskWithVanishingFile();
  assert.throws(() => task.observe({stage: 'lowercase'}), {code: 'TASK_EVENT_INVALID'});
  assert.throws(() => task.observe({unknown: 1}), {code: 'TASK_EVENT_INVALID'});
});

test('budget is still enforced at the next checkpoint after the child closes', () => {
  const {task, work} = taskWithVanishingFile(64 * 1024);
  fs.writeFileSync(path.join(work, 'large.bin'), Buffer.alloc(128 * 1024));
  task.observe({stage: 'CONVERTER', status: 'RUNNING'});
  assert.equal(task.readCancellationRequested(), false);
  assert.throws(() => task.checkpoint('CONVERTER_CLOSED'), {code: 'TASK_BUDGET_EXCEEDED'});
});

test('the official executor observes the converter with the non-walking checks', () => {
  const source = fs.readFileSync(new URL('../convert/official-execute.mjs', import.meta.url), 'utf8');
  const runner = source.slice(source.indexOf('runTransformer:'), source.indexOf("task.checkpoint('CONVERTER_CLOSED')"));
  assert.match(runner, /isCancellationRequested:\(\)=>task\.readCancellationRequested\(\)/);
  assert.match(runner, /onEvent:event=>task\.observe\(/);
  assert.doesNotMatch(runner, /task\.isCancellationRequested\(\)|task\.event\(/);
});
