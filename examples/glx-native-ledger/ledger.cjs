'use strict';

// Observation only: this module never calls a renderer or schedules a frame.
const LIMIT = 16;
const MAX = Number.MAX_SAFE_INTEGER;
const PREFIX = '[GLX_TRIANGLE_CHECKPOINT]';
const validInteger = value => Number.isSafeInteger(value) && value >= 0;
const raw = value => typeof value === 'string' && value.length > 2048
  ? { type: 'string', unavailable: 'length', length: value.length }
  : value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)
    ? value : { type: typeof value };
function errorData(error) { return { thrownType: typeof error, thrown: raw(error), nonFinite: typeof error === 'number' && !Number.isFinite(error) ? String(error) : null }; }

function create() {
  const stages = new Map();
  const tokens = new WeakMap();
  const open = [];
  const last = [];
  const flags = { stageOverflow: false, openOverflow: false, countInvalid: false, invalidFinish: false, invalidStage: false, invalidOrdinal: false };
  let transition = 0;
  let active = 0;
  function increment(value) {
    if (!validInteger(value) || value === MAX) { flags.countInvalid = true; return MAX; }
    return value + 1;
  }
  function record(stage, ordinal, kind) {
    transition = increment(transition);
    last.push({ transition, stage, ordinal, kind });
    if (last.length > LIMIT) last.shift();
  }
  function begin(stage, ordinal) {
    if (typeof stage !== 'string' || !stage.length || stage.length > 128) { flags.invalidStage = true; stage = '<invalid>'; }
    if (!validInteger(ordinal)) { flags.invalidOrdinal = true; ordinal = null; }
    let counters = stages.get(stage);
    if (!counters && stages.size < LIMIT) { counters = { enter: 0, return: 0, throw: 0 }; stages.set(stage, counters); }
    if (!counters) flags.stageOverflow = true;
    if (counters) counters.enter = increment(counters.enter);
    active = increment(active);
    record(stage, ordinal, 'enter');
    const token = Object.freeze({});
    const entry = { token, stage, ordinal, transition, counters, done: false };
    tokens.set(token, entry);
    if (open.length < LIMIT) open.push(entry); else flags.openOverflow = true;
    return token;
  }
  function finish(token, outcome) {
    const entry = token && (typeof token === 'object' || typeof token === 'function') ? tokens.get(token) : undefined;
    if (!entry || entry.done || (outcome !== 'return' && outcome !== 'throw')) { flags.invalidFinish = true; return false; }
    entry.done = true;
    if (entry.counters) entry.counters[outcome] = increment(entry.counters[outcome]);
    if (active > 0) active -= 1; else flags.countInvalid = true;
    const index = open.indexOf(entry);
    if (index >= 0) open.splice(index, 1);
    record(entry.stage, entry.ordinal, outcome);
    return true;
  }
  function snapshot() {
    return {
      transition, active, limit: LIMIT,
      flags: { ...flags },
      stages: Array.from(stages, ([stage, counters]) => ({ stage, ...counters })),
      last: last.map(entry => ({ ...entry })),
      open: open.map(entry => ({ stage: entry.stage, ordinal: entry.ordinal, transition: entry.transition }))
    };
  }
  return { begin, finish, snapshot };
}

// Copy untrusted reader data without invoking getters, toJSON, iterators, or then.
// A cycle, accessor, excessive depth/size, or exotic object becomes a marker.
function copyData(value, seen = new Set(), depth = 0, budget = { left: 4096 }) {
  if (--budget.left < 0) return { unavailable: 'size' };
  if (value === null || typeof value !== 'object') return raw(value);
  if (depth >= 8) return { unavailable: 'depth' };
  if (seen.has(value)) return { unavailable: 'cycle' };
  seen.add(value);
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return { unavailable: 'prototype' };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value) && descriptors.length.value > 128) return { unavailable: 'array-length', length: descriptors.length.value };
    const result = Array.isArray(value) ? [] : Object.create(null);
    let count = 0;
    for (const key of Object.keys(descriptors)) {
      if (key === 'length' && Array.isArray(value)) continue;
      if (key.length > 128) { Object.defineProperty(result, '__truncated', { value: true, enumerable: true }); continue; }
      if (++count > 128) { Object.defineProperty(result, '__truncated', { value: true, enumerable: true }); break; }
      const descriptor = descriptors[key];
      Object.defineProperty(result, key, { value: 'value' in descriptor ? copyData(descriptor.value, seen, depth + 1, budget) : { unavailable: 'accessor' }, enumerable: true, writable: true, configurable: true });
    }
    return result;
  } catch (_) { return { unavailable: 'copy-error' }; }
  finally { seen.delete(value); }
}

function createCheckpoints(options) {
  // Read options once; callers own the ordinary options object.
  const root = options.root;
  const packageId = typeof options.packageId === 'string' ? options.packageId : '<invalid>';
  const sessionTag = typeof options.sessionTag === 'string' ? options.sessionTag : '<invalid>';
  const readSnapshot = options.readSnapshot;
  const readSessionTag = options.readSessionTag;
  let armed = false;
  let duplicateArm = false;
  let outputAttempts = 0;
  let scheduledAt;
  const plans = [4000, 9000].map(delayMs => ({ delayMs, registered: false, fired: false, duplicateFire: false, staleSession: false, outputAttempted: false }));
  function clock() {
    try {
      const value = root.Date.now();
      return { raw: raw(value), valid: typeof value === 'number' && Number.isFinite(value), valueType: typeof value, nonFinite: typeof value === 'number' && !Number.isFinite(value) ? String(value) : null };
    } catch (error) { return { raw: null, valid: false, error: errorData(error) }; }
  }
  function snapshot() {
    return copyData({ armed, duplicateArm, packageId, sessionTag, scheduledAt, outputAttempts, plans });
  }
  function fire(plan) {
    if (plan.fired) { plan.duplicateFire = true; return; }
    plan.fired = true;
    plan.actualAt = clock();
    const elapsed = scheduledAt.valid && plan.actualAt.valid ? plan.actualAt.raw - scheduledAt.raw : NaN;
    plan.elapsedValid = Number.isFinite(elapsed) && elapsed >= 0;
    plan.elapsedMs = plan.elapsedValid ? elapsed : null;
    if (typeof readSessionTag === 'function') {
      try { if (readSessionTag() !== sessionTag) { plan.staleSession = true; return; } }
      catch (error) { plan.sessionReadError = errorData(error); return; }
    }
    let ledger;
    try { ledger = copyData(readSnapshot()); }
    catch (error) { plan.readerError = errorData(error); ledger = { unavailable: 'reader-error' }; }
    if (outputAttempts >= 2) return;
    outputAttempts += 1;
    plan.outputAttempted = true;
    try {
      // String serialization is confined to a descriptor-copied data tree.
      root.console.info(PREFIX + ' ' + JSON.stringify({ schema: 'triangle-execution-checkpoint-v1', packageId, sessionTag, checkpoint: plans.indexOf(plan) + 1, plannedDelayMs: plan.delayMs, scheduledAt, actualAt: plan.actualAt, elapsedMs: plan.elapsedMs, elapsedValid: plan.elapsedValid, snapshot: ledger, diagnostics: snapshot() }));
    } catch (error) { plan.outputError = errorData(error); }
  }
  function arm() {
    if (armed) { duplicateArm = true; return snapshot(); }
    armed = true;
    scheduledAt = clock();
    for (const plan of plans) {
      try {
        root.setTimeout(() => {
          try { fire(plan); } catch (error) { plan.callbackError = errorData(error); }
        }, plan.delayMs);
        plan.registered = true;
      } catch (error) { plan.registrationError = errorData(error); }
    }
    return snapshot();
  }
  return { arm, snapshot };
}

module.exports = { create, createCheckpoints };
