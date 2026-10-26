import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyze, cli } from './read-log.mjs';

const manifest = { schema: 'native-glx-ledger-candidate-v1',
    identity: { packageId: 'native-glx-validation-0123456789abcdef0123', parentPackageId: 'native-glx-validation-9b31f77db008bc37fda1',
        variant: 'js-boundary-v1', diagnosticVariant: 'execution-ledger-v1', wasmSha256: 'fake' } };
const tagged = (prefix, value, tag = 'new') => '[info] [GLX_TRIANGLE_' + prefix + '] ' + JSON.stringify({ packageId: manifest.identity.packageId, sessionTag: tag, ...value });
function base(tag = 'new', color61 = true) {
    const lines = [], notice = (sequence, stage, detail) => tagged('BOUNDARY', { schema: 'triangle-js-boundary-v1', sequence, kind: 'notice', stage, ordinal: 1,
        counts: {}, outputFailures: 0, throwEvents: 0, exhausted: false, runtime: {}, detail }, tag);
    lines.push(notice(1, 'startup', { kind: 'startup' }), tagged('EVIDENCE', { kind: 'entry', sequence: 1, detail: { sdkVersion: '3.17.5' } }, tag));
    for (const [i, api] of ['onError', 'onUnhandledRejection'].entries()) lines.push(notice(i + 2, 'notice', { kind: 'error-hook-coverage', detail: { api, present: true, registered: true, registrationThrew: false } }));
    for (let i = 0; i < 2; i++) {
        const detail = { schema: 'triangle-shader-type-v1', stage: 'created-before-source', shaderId: i + 1, expectedType: [35633, 35632][i], returnedType: [35633, 35632][i], publicContextHandle: 1, readOrdinal: i + 1 };
        lines.push('[log] [GLX_TRIANGLE_SHADER] ' + JSON.stringify(detail), tagged('EVIDENCE', { kind: 'shader', sequence: i + 2, detail }, tag));
    }
    lines.push(tagged('EVIDENCE', { kind: 'host', sequence: 4, detail: { summary: { ...manifest.identity, status: 'initialization-snapshot', mode: 'GLX', actualMode: 'glx', actualContextMetadataMatch: true, actualContextCanvasMatch: true } } }, tag));
    for (let i = 0; i < (color61 ? 2 : 1); i++) lines.push('[log] [GLX_TRIANGLE_COLOR] ' + JSON.stringify({ schema: 'triangle-frame-color-v1', frame: i * 60 + 1, sampleOrdinal: i + 1,
        phaseIndex: i, color: ['red', 'green'][i], rgbaComputed: [[1, 0, 0, 1], [0, 1, 0, 1]][i], publicContextHandle: 1, sampleLimit: 180, budgetExhausted: false }));
    return lines;
}
function ledger(count = 1, open = false) {
    const transition = count * 2 + Number(open), all = [];
    for (let i = 1; i <= count; i++) all.push({ transition: i * 2 - 1, stage: 'native-callback', ordinal: i, kind: 'enter' }, { transition: i * 2, stage: 'native-callback', ordinal: i, kind: 'return' });
    if (open) all.push({ transition, stage: 'native-callback', ordinal: count + 1, kind: 'enter' });
    return { transition, active: Number(open), limit: 16, flags: { stageOverflow: false, openOverflow: false, countInvalid: false, invalidFinish: false, invalidStage: false, invalidOrdinal: false },
        stages: [{ stage: 'native-callback', enter: count + Number(open), return: count, throw: 0 }], last: all.slice(-16),
        open: open ? [{ stage: 'native-callback', ordinal: count + 1, transition }] : [] };
}
function checkpoint(index, { tag = 'new', count = index, actual = [5000, 10000][index - 1], open = false, change } = {}) {
    const scheduledAt = { raw: 1000, valid: true }, actualAt = { raw: actual, valid: true };
    const event = { schema: 'triangle-execution-checkpoint-v1', checkpoint: index, plannedDelayMs: [4000, 9000][index - 1], scheduledAt, actualAt,
        elapsedMs: actual - 1000, elapsedValid: actual >= 1000,
        snapshot: { ledger: ledger(count, open), boundary: { packageId: manifest.identity.packageId, sessionTag: tag, eventLimit: 96, sequence: 3, outputFailures: 0, throwEvents: 0, exhausted: false }, runtime: {}, ledgerIntegrationFailures: 0 },
        diagnostics: { packageId: manifest.identity.packageId, sessionTag: tag, armed: true, duplicateArm: false, scheduledAt, outputAttempts: index,
            plans: [4000, 9000].map((delayMs, i) => ({ delayMs, registered: true, fired: i < index, duplicateFire: false, staleSession: false, outputAttempted: i < index })) } };
    if (change) change(event);
    return tagged('CHECKPOINT', event, tag);
}
const run = (lines, previous, candidate = manifest) => analyze(lines.join('\n'), candidate, previous);
const comparison = report => report.checkpointSessions.find(item => item.sessionTag === 'new')?.comparison;
const codes = report => report.stopReasons.map(item => item.code);
test('same-package same-session snapshots preserve boundary gates and expose call transitions only', () => {
    const lines = [...base(), checkpoint(1), checkpoint(2, { count: 80, open: true })], report = run(lines);
    assert.equal(report.stopRequired, false); assert.equal(report.schema, 'triangle-js-ledger-log-analysis-v1');
    assert.equal(comparison(report).observation, 'COUNTER_PROGRESS_OBSERVED'); assert.equal(comparison(report).observedWindowMs, 5000);
    assert.deepEqual(comparison(report).layers['native-callback'].delta, { enter: 80, return: 79, throw: 0 });
    assert.equal(report.checkpointSessions[0].checkpoints[1].ledgerInspection.open[0].ordinal, 81);
    assert.equal(report.checkpointSessions[0].checkpoints[1].ledgerInspection.layers['native-callback'].difference, 1);
    assert.equal(report.visibleValidation, 'NOT_PROVEN'); assert.equal(report.fpsValidation, 'NOT_MEASURED');
    assert.equal(report.rawLogSha256, crypto.createHash('sha256').update(lines.join('\n')).digest('hex'));
});
test('missing 61 remains an original stop gate and never proves RAF stopped', () => {
    const report = run([...base('new', false), checkpoint(1), checkpoint(2)]);
    assert.ok(codes(report).includes('FRAME_61_COLOR_NOT_OBSERVED'));
    assert.equal(comparison(report).observation, 'COUNTER_PROGRESS_OBSERVED');
    assert.match(report.limits.join(' '), /never proof RAF stopped/);
});
test('missing checkpoints and session splits leave progress unknown', () => {
    assert.equal(run(base()).sessions[0].checkpointCoverage.observation, 'UNKNOWN');
    assert.equal(comparison(run([...base(), checkpoint(1)])).observation, 'UNKNOWN');
    const mixed = run([...base('old'), checkpoint(1, { tag: 'old' }), ...base(), checkpoint(2)]);
    assert.equal(mixed.checkpointSessions.length, 2);
    assert.ok(mixed.checkpointSessions.every(item => item.comparison.observation === 'UNKNOWN'));
});
test('close callbacks never infer stoppage from their nominal 4/9 second schedules', () => {
    const report = run([...base(), checkpoint(1, { count: 1, actual: 11000 }), checkpoint(2, { count: 1, actual: 11001 })]);
    assert.equal(comparison(report).observation, 'UNKNOWN'); assert.equal(comparison(report).observedWindowMs, 1);
    assert.equal(comparison(report).reason, 'OBSERVATION_WINDOW_TOO_SHORT');
});
test('adequate unchanged window means only no counter progress observed', () => {
    const report = run([...base(), checkpoint(1), checkpoint(2, { count: 1 })]);
    assert.equal(comparison(report).observation, 'NO_COUNTER_PROGRESS_OBSERVED');
    assert.equal(comparison(report).clockReliability, 'NOT_CERTIFIED');
});
test('invalid actual clock, inconsistent elapsed and differing starts leave timing unknown', () => {
    for (const change of [e => { e.actualAt.valid = false; }, e => { e.actualAt.raw = 0; }, e => { e.elapsedMs = 1; }, e => { e.scheduledAt.raw = 999; e.elapsedMs = e.actualAt.raw - 999; }]) {
        const report = run([...base(), checkpoint(1), checkpoint(2, { change })]);
        assert.equal(comparison(report).observation, 'UNKNOWN'); assert.equal(comparison(report).reason, 'ACTUAL_TIME_WINDOW_UNRELIABLE');
    }
});
test('invalid ledger sums, tails, flags, missing snapshots and integration failures remain unknown', () => {
    for (const change of [e => { delete e.snapshot.ledger; }, e => { e.snapshot.ledger.active = 1; }, e => { e.snapshot.ledger.last[0].transition = 88; },
        e => { e.snapshot.ledger.flags.openOverflow = true; }, e => { e.snapshot.ledgerIntegrationFailures = 1; }]) {
        const report = run([...base(), checkpoint(1), checkpoint(2, { change })]);
        assert.equal(comparison(report).observation, 'UNKNOWN'); assert.equal(report.stopRequired, true);
    }
});
test('valid cumulative counter regression is rejected', () => {
    const report = run([...base(), checkpoint(1, { count: 4 }), checkpoint(2, { count: 1 })]);
    assert.ok(codes(report).includes('LEDGER_COUNTER_REGRESSION')); assert.equal(comparison(report).observation, 'UNKNOWN');
});
test('throw counts and last/open facts retain their own meaning without a completion claim', () => {
    const report = run([...base(), checkpoint(1), checkpoint(2, { count: 2, open: true, change: event => {
        const ledger = event.snapshot.ledger;
        ledger.stages[0].return = 1; ledger.stages[0].throw = 1;
        ledger.last[3].kind = 'throw';
    } })]);
    assert.equal(report.stopRequired, false);
    assert.deepEqual(comparison(report).layers['native-callback'].delta, { enter: 2, return: 0, throw: 1 });
    assert.equal(report.checkpointSessions[0].checkpoints[1].ledgerInspection.last.at(-2).kind, 'throw');
    assert.equal(comparison(report).layers['native-callback'].second.difference, 1);
});
test('checkpoint and boundary budgets/failures stay independent', () => {
    for (const [change, code] of [[e => { e.snapshot.boundary.exhausted = true; }, 'PROBE_BUDGET_EXHAUSTED'],
        [e => { e.snapshot.boundary.outputFailures = 1; }, 'PROBE_OUTPUT_FAILURE'],
        [e => { e.diagnostics.outputAttempts = 3; }, 'CHECKPOINT_DIAGNOSTICS_INVALID'],
        [e => { e.diagnostics.plans[0].outputError = {}; }, 'CHECKPOINT_FAILURE'],
        [e => { e.diagnostics.plans[1].registered = false; }, 'CHECKPOINT_FAILURE'],
        [e => { e.diagnostics.plans[0] = null; }, 'CHECKPOINT_FAILURE'],
        [e => { e.diagnostics.outputAttempts = 1; }, 'CHECKPOINT_DIAGNOSTICS_INVALID'],
        [e => { e.snapshot.runtime.readFailed = true; }, 'RUNTIME_COUNTER_COVERAGE_FAILED']]) {
        assert.ok(codes(run([...base(), checkpoint(1), checkpoint(2, { change })])).includes(code));
    }
});
test('foreign packages, malformed JSON, checkpoint schemas, duplicates and candidate identity are rejected', () => {
    assert.ok(codes(run([...base(), checkpoint(1).replace(manifest.identity.packageId, 'other')])).includes('PACKAGE_MISMATCH'));
    assert.ok(codes(run([...base(), '[GLX_TRIANGLE_CHECKPOINT] invalid'])).includes('INVALID_JSON'));
    assert.ok(codes(run([...base(), checkpoint(1, { change: e => { e.schema = 'other'; } })])).includes('CHECKPOINT_SCHEMA_INVALID'));
    assert.ok(codes(run([...base(), checkpoint(1), checkpoint(1)])).includes('CHECKPOINT_DUPLICATE_OR_ORDER'));
    assert.ok(codes(run([...base(), checkpoint(2), checkpoint(1)])).includes('CHECKPOINT_DUPLICATE_OR_ORDER'));
    assert.ok(codes(run(base(), undefined, { ...manifest, identity: { ...manifest.identity, parentPackageId: 'other' } })).includes('INVALID_CANDIDATE'));
});
test('stager manifest shape requires parent identity inside identity, never a top-level substitute', () => {
    assert.equal(Object.hasOwn(manifest, 'parentPackageId'), false);
    assert.ok(!codes(run(base())).includes('INVALID_CANDIDATE'));
    const { parentPackageId, ...identityWithoutParent } = manifest.identity;
    const topLevelOnly = { ...manifest, parentPackageId, identity: identityWithoutParent };
    assert.ok(codes(run([], undefined, topLevelOnly)).includes('INVALID_CANDIDATE'));
});
test('old SDK, host and shader gates are preserved', () => {
    for (const [old, replacement, code] of [['"sdkVersion":"3.17.5"', '"sdkVersion":"3.15.2"', 'SDK_GATE_FAILED'],
        ['"actualMode":"glx"', '"actualMode":"webgl"', 'GLX_HOST_GATE_FAILED'], ['"returnedType":35633', '"returnedType":0', 'SHADER_TYPE_GATE_FAILED']])
        assert.ok(codes(run(base().map(line => line.replace(old, replacement)))).includes(code));
});
test('previous report links tags without using old snapshots as new-session checkpoints', () => {
    const previous = run([...base('old'), checkpoint(1, { tag: 'old' }), checkpoint(2, { tag: 'old' })]);
    const report = run([...base(), checkpoint(2)], previous);
    assert.equal(comparison(report).observation, 'UNKNOWN'); assert.ok(!codes(report).includes('PREVIOUS_IDENTITY_MISMATCH'));
    assert.ok(codes(run(base(), { schema: 'other' })).includes('PREVIOUS_IDENTITY_MISMATCH'));
    const oldOnly = run([checkpoint(1, { tag: 'old' }), checkpoint(2, { tag: 'old' })], previous);
    assert.equal(oldOnly.checkpointSessions[0].comparison.observation, 'UNKNOWN');
    assert.equal(oldOnly.checkpointSessions[0].comparison.reason, 'CURRENT_SESSION_ENTRY_NOT_OBSERVED');
});
test('CLI uses absolute paths and cannot overwrite captured inputs or existing reports', () => {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(tempRoot, 'ledger-reader-test-'));
    try {
        const log = path.join(dir, 'raw.log'), candidate = path.join(dir, 'candidate.json'), out = path.join(dir, 'report.json');
        const bytes = Buffer.from([...base(), checkpoint(1), checkpoint(2)].join('\n'));
        fs.writeFileSync(log, bytes); fs.writeFileSync(candidate, JSON.stringify(manifest));
        assert.equal(cli(['--log', log, '--candidate', candidate, '--out', out]).stopRequired, false);
        assert.deepEqual(fs.readFileSync(log), bytes);
        assert.throws(() => cli(['--log', log, '--candidate', candidate, '--out', log]), /EEXIST/);
        assert.throws(() => cli(['--log', log, '--candidate', candidate, '--out', 'relative']), /absolute/);
    } finally {
        const resolved = fs.realpathSync(dir);
        assert.equal(path.dirname(resolved), tempRoot, 'Cleanup target must be directly within the verified temporary root');
        assert.ok(path.basename(resolved).startsWith('ledger-reader-test-'), 'Cleanup target must retain the owned test prefix');
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});
