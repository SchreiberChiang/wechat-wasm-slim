// Offline only: node examples/glx-smoke/summarize-acceptance.mjs input.json output.json
// Groups by the complete relay session internally; never emits it or raw log text.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function sessionTag(session) {
  let hash = 2166136261;
  for (let i = 0; i < session.length; i++) hash = Math.imul(hash ^ session.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.length <= 160 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function select(source, keys, accept = string) {
  return Object.fromEntries(keys.filter(key => accept(source?.[key]) !== null).map(key => [key, accept(source[key])]));
}
// Revalidate the runtime's already-redacted location. Cloud input is not trusted,
// and neither arbitrary basenames nor raw stack/message/path fields are copied.
const errorNames = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'RuntimeError', 'CompileError', 'LinkError', 'unavailable']);
const locationFiles = new Set(['game.js', 'framework.js', 'index.js', 'render-runtime.js', 'render-observer.js', 'godot-bridge.js', 'custom-package.js', 'single-entry.js', 'WAGame.js', 'WAGameSubContext.js', 'WAService.js', 'WAServiceMainContext.js', 'WAWorker.js', 'WAWebview.js', 'game.wasm', 'framework.wasm', 'godot.wasm']);
const position = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
function failureLocation(value) {
  if (!object(value)) return null;
  const frames = [];
  for (const frame of (Array.isArray(value.frames) ? value.frames.slice(0, 64) : [])) {
    if (!object(frame) || !locationFiles.has(frame.file) || !['plugin', 'package', 'wasm'].includes(frame.scope) || !position(frame.line)) continue;
    if (frame.file.endsWith('.wasm') !== (frame.scope === 'wasm')) continue;
    if (frame.column !== undefined && !position(frame.column)) continue;
    frames.push({scope: frame.scope, file: frame.file, line: frame.line, ...(frame.column === undefined ? {} : {column: frame.column})});
    if (frames.length === 6) break;
  }
  return {errorName: errorNames.has(value.errorName) ? value.errorName : 'unavailable', status: frames.length ? 'available' : 'unavailable', frames};
}
function renderEvidence(source) {
  const result = select(source, ['packageVersion', 'requestedMode', 'observationStatus', 'initialization', 'bufferInitialization']);
  result.versions = select(source.versions, ['godot', 'transformer', 'wxGameKit']);
  result.actualContext = select(source.actualContext, ['mode']);
  if (typeof source.actualContext?.webgl2 === 'boolean') result.actualContext.webgl2 = source.actualContext.webgl2;
  result.failureCode = /^WXSLIM_[A-Z0-9_]{1,64}$/.test(source.failureReason?.code || '') ? source.failureReason.code : null;
  result.failureReported = source.failureReason != null;
  const location = failureLocation(source.failureReason?.location);
  if (location) result.failureLocation = location;
  result.lifecycle = select(source.lifecycle, ['hide', 'show', 'resize'], count);
  if (['not_verified', 'not_observed'].includes(source.lifecycle?.recovery)) result.lifecycle.recovery = source.lifecycle.recovery;
  result.native = {};
  for (const name of ['glxInit', 'glxInitBufferDataAndGlState', 'glxUpdateContextId']) {
    if (object(source.native?.[name])) result.native[name] = {...select(source.native[name], ['calls'], count), ...select(source.native[name], ['result'])};
  }
  result.visibleRendering = 'not_verified';
  return result;
}

export function summarizeAcceptance(response) {
  if (!object(response) || response.ok !== true || response.result?.success !== true || !Array.isArray(response.result.data)) throw Error('Cloud snapshot is unsuccessful or has an unsupported schema.');
  const data = response.result.data;
  const groups = new Map();
  for (const row of data) {
    if (!object(row) || typeof row.session !== 'string' || !row.session || !Array.isArray(row.entries)) throw Error('Cloud snapshot contains an invalid batch.');
    if (!groups.has(row.session)) groups.set(row.session, []);
    groups.get(row.session).push(row);
  }
  const runs = [], tags = new Set(), builds = new Set(), packages = new Set(), reasons = new Set();
  if (!data.length) reasons.add('no_sessions');
  for (const [session, rows] of groups) {
    const tag = sessionTag(session);
    if (tags.has(tag)) reasons.add('session_tag_collision');
    tags.add(tag);
    const run = {ordinal: runs.length + 1, sessionTag: tag, batches: rows.length, entries: 0, dropped: 0, droppedUnknownBatches: 0, builds: [], devices: [], bootStages: [], renderSummaries: [], malformedEntries: 0, malformedRenderSummaries: 0, ignoredEntries: 0, visibleRendering: 'not_verified', audio: 'not_verified'};
    const runBuilds = new Set(), runPackages = new Set();
    for (const row of rows) {
      if (string(row.build)) { runBuilds.add(row.build); builds.add(row.build); }
      if (count(row.dropped) === null) run.droppedUnknownBatches++; else run.dropped += row.dropped;
      const device = select(row.device, ['platform', 'model', 'system', 'SDKVersion']);
      if (Object.keys(device).length && !run.devices.some(d => JSON.stringify(d) === JSON.stringify(device))) run.devices.push(device);
      for (const entry of row.entries) {
        run.entries++;
        if (!object(entry) || typeof entry.message !== 'string') { run.malformedEntries++; continue; }
        const boot = entry.message.match(/^\[WXSLIM_BOOT\] ([A-Z_]{1,64})$/);
        if (boot) { if (!run.bootStages.includes(boot[1])) run.bootStages.push(boot[1]); continue; }
        const summary = entry.message.match(/^\[WXSLIM_RENDER_SUMMARY\]\s+(.*)$/s);
        if (!summary) { run.ignoredEntries++; continue; }
        let parsed;
        try { parsed = JSON.parse(summary[1]); } catch { run.malformedRenderSummaries++; continue; }
        if (!object(parsed)) { run.malformedRenderSummaries++; continue; }
        const safe = renderEvidence(parsed);
        if (safe.packageVersion) { runPackages.add(safe.packageVersion); packages.add(safe.packageVersion); }
        run.renderSummaries.push(safe);
      }
    }
    run.builds = [...runBuilds];
    run.packageVersions = [...runPackages];
    run.identityConflict = runBuilds.size > 1 || runPackages.size > 1;
    if (run.identityConflict) reasons.add('conflicting_session_identity');
    if (!runBuilds.size || !runPackages.size) reasons.add('missing_package_identity');
    runs.push(run);
  }
  if (builds.size > 1 || packages.size > 1) reasons.add('mixed_packages');
  const pager = select(response.result.pager, ['Offset', 'Limit', 'Total'], count);
  const total = count(response.result.total);
  const incomplete = (pager.Offset ?? 0) > 0 || (total !== null && total > data.length) || (pager.Total !== undefined && pager.Total > data.length) || response.result.hasMore === true || response.result.truncated === true || response.hasMore === true || response.truncated === true;
  if (incomplete) reasons.add('partial_snapshot');
  return {schema: 'wxslim-acceptance-summary-v1', source: 'offline_cloud_snapshot', recordOrder: 'source_batch_order_not_verified_chronological', coverage: {batches: data.length, total, pager, hasMore: response.result.hasMore === true || response.hasMore === true, truncated: response.result.truncated === true || response.truncated === true, completeness: incomplete ? 'partial' : 'not_verified', note: 'Snapshot metadata does not prove complete device capture; missing logs are not a rendering result.'}, automaticMapping: {scope: 'provided_snapshot_only', status: reasons.size ? 'refused' : 'eligible_by_session_tag', reasons: [...reasons]}, visibleRendering: 'not_verified', audio: 'not_verified', runs};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: node summarize-acceptance.mjs input.json output.json');
    const response = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    fs.writeFileSync(process.argv[3], JSON.stringify(summarizeAcceptance(response), null, 2) + '\n', {flag: 'wx'});
    console.log('Offline acceptance summary written; visual acceptance remains not_verified.');
  } catch {
    console.error('Acceptance summary failed: invalid input, unsupported cloud response, or output already exists/unwritable.');
    process.exitCode = 1;
  }
}
