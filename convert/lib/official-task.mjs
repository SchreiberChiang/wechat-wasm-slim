// Local official conversion receipts only; cancellation never kills a process.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const schema = 'wxslim-official-task-v1';
const terminals = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);
function fail(code, message) { const error = Error(message); error.code = code; throw error; }
function writeNew(file, value) {
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function regular(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('TASK_PATH_INVALID', 'linked or unexpected task path');
  return stat;
}
function owner(root, taskId) {
  regular(root, true); regular(path.join(root, 'TASK.json'));
  const record = readJson(path.join(root, 'TASK.json'));
  if (record.schema !== schema || record.taskId !== taskId) fail('TASK_ID_MISMATCH', 'task identity mismatch');
  return record;
}
function existing(root, name, taskId) {
  const file = path.join(root, name);
  try { regular(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const record = readJson(file);
  if (!record || record.schema !== schema || record.taskId !== taskId || !(name === 'terminal.json' ? terminals.has(record.status) : record.status === 'CANCEL_REQUESTED')) fail('TASK_ID_MISMATCH', 'task receipt identity or status mismatch');
  return record;
}
function measure(root) {
  let bytes = 0;
  for (const item of fs.readdirSync(root)) {
    const file = path.join(root, item), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) fail('TASK_PATH_INVALID', 'linked task content');
    if (stat.isDirectory()) bytes += measure(file);
    else if (stat.isFile()) bytes += stat.size;
    else fail('TASK_PATH_INVALID', 'unexpected task content');
  }
  return bytes;
}
function budget(root, record) {
  if (measure(root) > record.budgetBytes) fail('TASK_BUDGET_EXCEEDED', 'task logical file size exceeds budget');
}
export function measureTaskBytes(root) { regular(root, true); return measure(root); }
function plainJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false;
  seen.add(value);
  const valid = Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => 'value' in descriptor && plainJson(descriptor.value, seen));
  seen.delete(value); return valid;
}
function locked(root, taskId, action) {
  owner(root, taskId);
  const lock = path.join(root, '.control-lock');
  try { fs.mkdirSync(lock); }
  catch (error) { if (error.code === 'EEXIST') fail('TASK_LOCKED', 'task control lock is busy'); throw error; }
  let completed = false, result;
  try { owner(root, taskId); result = action(); completed = true; }
  finally {
    try { fs.rmdirSync(lock); } // Only this call's newly created empty lock.
    catch (error) {
      if (!completed || !existing(root, 'terminal.json', taskId)) throw error;
      // The terminal is already durable. Cleanup cannot turn it into a failure.
      result = {...result, controlLockWarning:{code:error.code || 'TASK_LOCK_RELEASE_FAILED', message:'Terminal persisted; control lock could not be removed. Inspect retained task lock.'}};
    }
  }
  return result;
}

export function inspectTask(root, taskId) {
  root = path.resolve(root);
  const record = owner(root, taskId);
  return {root, taskId, owner:record, terminal:existing(root, 'terminal.json', taskId), cancellation:existing(root, 'cancel.json', taskId), logicalBytes:measure(root)};
}

export function requestCancellation(root, taskId, {expectedRecipeId} = {}) {
  root = path.resolve(root);
  return locked(root, taskId, () => {
    const record = owner(root, taskId), terminal = existing(root, 'terminal.json', taskId);
    if (expectedRecipeId !== undefined && record.recipeId !== expectedRecipeId) fail('TASK_RECIPE_MISMATCH', 'task recipe changed or belongs to another task type');
    if (terminal) return {taskId, alreadyEnded:true, terminal};
    const previous = existing(root, 'cancel.json', taskId);
    if (previous) return {taskId, accepted:true, duplicate:true};
    budget(root, record);
    const cancellation = {schema, taskId, at:new Date().toISOString(), status:'CANCEL_REQUESTED'};
    if (measure(root) + Buffer.byteLength(JSON.stringify(cancellation) + '\n') > record.budgetBytes) fail('TASK_BUDGET_EXCEEDED', 'cancellation receipt exceeds task budget');
    writeNew(path.join(root, 'cancel.json'), cancellation);
    return {taskId, accepted:true, duplicate:false};
  });
}

export function createTask(root, {budgetBytes, recipeId}) {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0 || typeof recipeId !== 'string' || !recipeId) fail('TASK_CONFIG_INVALID', 'positive budget and recipe required');
  root = path.resolve(root);
  const parent = path.dirname(root), realParent = fs.realpathSync(parent);
  regular(parent, true);
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(parent) !== normalize(realParent)) fail('TASK_PATH_INVALID', 'task parent must be its real path');
  fs.mkdirSync(root); // Exclusive claim. Never reuse or remove an existing root.
  const taskId = randomUUID(), record = {schema, taskId, recipeId, budgetBytes, createdAt:new Date().toISOString()};
  writeNew(path.join(root, 'TASK.json'), record);
  const log = path.join(root, 'events.jsonl'), fd = fs.openSync(log, 'wx');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  budget(root, record);
  let logFailed = false;
  const check = () => { owner(root, taskId); budget(root, record); };
  const isCancellationRequested = () => { check(); return !!existing(root, 'cancel.json', taskId); };
  // Observation while an owned child is changing its cache must not recursively
  // measure that active tree. Budget enforcement remains in the existing gates.
  const readCancellationRequested = () => { owner(root, taskId); return !!existing(root, 'cancel.json', taskId); };
  return {
    root, taskId,
    isCancellationRequested,
    readCancellationRequested,
    event(event) {
      check();
      if (!event || typeof event !== 'object' || Array.isArray(event) || !Object.keys(event).length || Object.keys(event).some(key => !['status', 'stage', 'details'].includes(key)) || !plainJson(event) || ['status', 'stage'].some(key => event[key] !== undefined && (typeof event[key] !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(event[key])))) fail('TASK_EVENT_INVALID', 'events contain status/stage tokens and plain JSON details only');
      if (existing(root, 'terminal.json', taskId)) fail('TASK_ENDED', 'task already ended');
      let handle;
      try {
        regular(log);
        handle = fs.openSync(log, fs.constants.O_APPEND | fs.constants.O_WRONLY); fs.writeFileSync(handle, JSON.stringify({taskId, at:new Date().toISOString(), ...event}) + '\n'); fs.fsyncSync(handle);
      } catch (error) { logFailed = true; throw error; }
      finally { if (handle !== undefined) try { fs.closeSync(handle); } catch (error) { logFailed = true; throw error; } }
      budget(root, record);
    },
    checkpoint(stage) {
      check();
      if (existing(root, 'terminal.json', taskId)) fail('TASK_ENDED', 'task already ended');
      if (existing(root, 'cancel.json', taskId)) fail('TASK_CANCELLED', 'task cancellation requested');
      if (logFailed) fail('TASK_LOG_FAILED', 'task event log failed');
      if (stage !== undefined && (typeof stage !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(stage))) fail('TASK_EVENT_INVALID', 'invalid stage');
    },
    finish(status, details = {}) {
      if (!terminals.has(status)) fail('TASK_STATUS_INVALID', 'invalid terminal status');
      if (!plainJson(details)) fail('TASK_EVENT_INVALID', 'terminal details must be plain JSON');
      return locked(root, taskId, () => {
        const previous = existing(root, 'terminal.json', taskId);
        if (previous) return previous;
        check();
        if (existing(root, 'cancel.json', taskId)) status = 'CANCELLED';
        if (logFailed && status === 'SUCCESS') fail('TASK_LOG_FAILED', 'cannot succeed after event log failure');
        const terminal = {schema, taskId, at:new Date().toISOString(), status, details};
        const serializedBytes = Buffer.byteLength(JSON.stringify(terminal) + '\n');
        if (measure(root) + 2 * serializedBytes > record.budgetBytes) fail('TASK_BUDGET_EXCEEDED', 'terminal receipt exceeds task budget');
        // Flush and close the staged receipt before an exclusive atomic terminal commit.
        // Keep its hardlink as evidence: no required file write follows terminal.json.
        const staged = path.join(root, '.terminal-' + randomUUID() + '.json');
        writeNew(staged, terminal);
        fs.linkSync(staged, path.join(root, 'terminal.json'));
        return terminal; // No additional receipt or log writes after the terminal commit.
      });
    },
  };
}
