import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sessionTag, summarizeAcceptance} from '../examples/glx-smoke/summarize-acceptance.mjs';

const entry = data => ({message: '[WXSLIM_RENDER_SUMMARY] ' + JSON.stringify(data)});
const render = (packageVersion = 'test-package') => ({packageVersion, initialization: 'initialized', actualContext: {mode: 'glx', webgl2: true}, failureReason: null, visibleRendering: 'passed', lifecycle: {hide: 1, show: 1, resize: 0, recovery: 'not_verified'}});
const batch = (session = 'private-session', packageVersion = 'test-package') => ({session, build: 'test-build', device: {model: 'synthetic', SDKVersion: 'test', openid: 'PRIVATE_ID'}, dropped: 0, entries: [entry(render(packageVersion))]});
const cloud = data => ({ok: true, result: {success: true, data, total: data.length, pager: {Offset: 0, Limit: 100, Total: data.length}}});

// Compare against the phone code, including UTF-16 surrogate handling.
for (const session of ['private-session', '测试-session-😀', 'synthetic-1y99z58-54943']) {
  const context = {GameGlobal: {}, console: {__phoneLogRelay: {session}}};
  vm.runInNewContext(fs.readFileSync(new URL('../examples/glx-smoke/local-interfaces.js', import.meta.url), 'utf8'), context);
  const phone = JSON.parse(context.GameGlobal.WxSlimGlxSmoke.readDiagnosticJson());
  assert.equal(sessionTag(session), phone.acceptanceIdentity.sessionTag);
}

const first = batch(), second = batch();
second.entries = [{message: '[WXSLIM_BOOT] MAIN_RETURNED'}, entry({...render(), failureReason: {code: 'WXSLIM_RENDER_BOOT_FAILED', message: 'PRIVATE_ERROR'}, initialization: 'failed'}), {message: 'PRIVATE_RAW_LOG'}];
second.dropped = 2;
const result = summarizeAcceptance(cloud([first, second]));
assert.equal(result.runs.length, 1);
assert.equal(result.runs[0].batches, 2);
assert.equal(result.runs[0].dropped, 2);
assert.equal(result.runs[0].renderSummaries.length, 2);
assert.deepEqual(result.runs[0].bootStages, ['MAIN_RETURNED']);
assert.equal(result.runs[0].renderSummaries[1].failureCode, 'WXSLIM_RENDER_BOOT_FAILED');
assert.equal(result.runs[0].renderSummaries[0].lifecycle.hide, 1);
assert.equal(result.runs[0].renderSummaries[0].visibleRendering, 'not_verified');
assert.equal(result.visibleRendering, 'not_verified');
assert.equal(result.automaticMapping.status, 'eligible_by_session_tag');
assert.equal(result.automaticMapping.scope, 'provided_snapshot_only');
assert.ok(!/PRIVATE_|private-session/.test(JSON.stringify(result)));

const missing = batch();
missing.entries = [{message: '[WXSLIM_RENDER_SUMMARY] {invalid'}, {message: '[WXSLIM_RENDER_SUMMARY] null'}, {oops: true}];
delete missing.dropped;
const absent = summarizeAcceptance(cloud([missing]));
assert.equal(absent.runs[0].malformedRenderSummaries, 2);
assert.equal(absent.runs[0].malformedEntries, 1);
assert.equal(absent.runs[0].droppedUnknownBatches, 1);
assert.equal(absent.runs[0].visibleRendering, 'not_verified');
assert.ok(absent.automaticMapping.reasons.includes('missing_package_identity'));
for (const input of [{ok: false}, {ok: true, result: {success: false}}, {ok: true, result: {success: true, data: {}}}, cloud([{session: 'x'}])]) assert.throws(() => summarizeAcceptance(input));
assert.equal(summarizeAcceptance(cloud([])).automaticMapping.status, 'refused');

const conflict = summarizeAcceptance(cloud([batch('one', 'package-a'), batch('one', 'package-b')]));
assert.equal(conflict.runs[0].identityConflict, true);
assert.ok(conflict.automaticMapping.reasons.includes('conflicting_session_identity'));
const mixed = summarizeAcceptance(cloud([batch('one', 'package-a'), batch('two', 'package-b')]));
assert.ok(mixed.automaticMapping.reasons.includes('mixed_packages'));
const a = 'synthetic-1y99z58-54943', b = 'synthetic-1a2k2n6-55797';
assert.equal(sessionTag(a), sessionTag(b));
const collision = summarizeAcceptance(cloud([batch(a), batch(b)]));
assert.equal(collision.runs.length, 2);
assert.equal(collision.automaticMapping.status, 'refused');
assert.ok(collision.automaticMapping.reasons.includes('session_tag_collision'));

for (const patch of [{total: 5}, {pager: {Offset: 1, Limit: 1, Total: 1}}, {hasMore: true}, {truncated: true}]) {
  const response = cloud([batch()]); Object.assign(response.result, patch);
  const partial = summarizeAcceptance(response);
  assert.equal(partial.coverage.completeness, 'partial');
  assert.equal(partial.automaticMapping.status, 'refused');
  assert.ok(partial.automaticMapping.reasons.includes('partial_snapshot'));
}
assert.equal(result.coverage.completeness, 'not_verified');

// Only the bounded diagnostic coordinates survive; arbitrary fields in a cloud
// record must not turn this projection into a raw stack or account-data export.
const located = batch();
const locations = [
  {scope: 'plugin', file: 'index.js', line: 1, column: 230, path: 'PRIVATE_PATH', functionName: 'PRIVATE_FN'},
  {scope: 'package', file: 'framework.js', line: 12},
  {scope: 'package', file: 'PRIVATE_TOKEN.js', line: 1, column: 2},
  {scope: 'plugin', file: 'https://PRIVATE_HOST/index.js', line: 1},
  {scope: 'PRIVATE_SCOPE', file: 'index.js', line: 1},
  {scope: 'wasm', file: 'framework.js', line: 1},
  {scope: 'package', file: 'game.wasm', line: 1},
  {scope: 'plugin', file: 'index.js', line: 0},
  {scope: 'plugin', file: 'index.js', line: 1, column: -1},
  {scope: 'plugin', file: 'index.js', line: 2147483648},
  ...Array.from({length: 20}, (_, i) => ({scope: 'package', file: 'game.js', line: 100 + i, column: 2}))
];
located.entries = [entry({...render(), initialization: 'failed', failureReason: {code: 'WXSLIM_RENDER_BOOT_FAILED', message: 'PRIVATE_MESSAGE', stack: 'PRIVATE_STACK', location: {errorName: 'TypeError', status: 'available', frames: locations, raw: 'PRIVATE_RAW'}}})];
const locatedOutput = summarizeAcceptance(cloud([located]));
const safeLocation = locatedOutput.runs[0].renderSummaries[0].failureLocation;
assert.equal(safeLocation.errorName, 'TypeError');
assert.equal(safeLocation.status, 'available');
assert.equal(safeLocation.frames.length, 6);
assert.deepEqual(safeLocation.frames.slice(0, 2), [{scope: 'plugin', file: 'index.js', line: 1, column: 230}, {scope: 'package', file: 'framework.js', line: 12}]);
assert.doesNotMatch(JSON.stringify(locatedOutput), /PRIVATE_/);
assert.equal(result.runs[0].renderSummaries[1].failureLocation, undefined);
located.entries = [entry({...render(), failureReason: {location: {errorName: 'PRIVATE_NAME', status: 'available', frames: [null, {scope: 'plugin', file: 'index.js', line: '1'}]}}})];
assert.deepEqual(summarizeAcceptance(cloud([located])).runs[0].renderSummaries[0].failureLocation, {errorName: 'unavailable', status: 'unavailable', frames: []});

// CLI creates a new output and refuses to overwrite it; errors do not echo raw input.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-acceptance-test-'));
try {
  const input = path.join(dir, 'input.json'), output = path.join(dir, 'output.json');
  fs.writeFileSync(input, '\uFEFF' + JSON.stringify(cloud([batch()])));
  const cli = fileURLToPath(new URL('../examples/glx-smoke/summarize-acceptance.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [cli, input, output], {encoding: 'utf8'});
  assert.equal(run().status, 0);
  const saved = fs.readFileSync(output, 'utf8');
  assert.equal(run().status, 1);
  assert.equal(fs.readFileSync(output, 'utf8'), saved);
  fs.writeFileSync(input, 'PRIVATE_INVALID_INPUT');
  const failed = run(); assert.equal(failed.status, 1); assert.ok(!failed.stderr.includes('PRIVATE'));
} finally {
  const resolved = fs.realpathSync(dir);
  const tempRoot = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase());
  assert.ok(path.basename(resolved).startsWith('wxslim-acceptance-test-'));
  fs.rmSync(resolved, {recursive: true, force: true});
}
console.log('GLX acceptance summary tests passed.');
