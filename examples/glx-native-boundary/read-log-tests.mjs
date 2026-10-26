import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyze, cli } from './read-log.mjs';

const manifest = { schema: 'native-glx-boundary-candidate-v1', identity: { packageId: 'native-glx-validation-0123456789abcdef0123', wasmSha256: 'fake', variant: 'js-boundary-v1', files: { fake: 'hash' } } };
const evidence = (kind, sequence, detail, tag = 'session-a') => '[info] [GLX_TRIANGLE_EVIDENCE] ' + JSON.stringify({ kind, sequence, detail, packageId: manifest.identity.packageId, sessionTag: tag });
const shader = i => ({ schema: 'triangle-shader-type-v1', stage: 'created-before-source', shaderId: i + 1, expectedType: [35633, 35632][i], returnedType: [35633, 35632][i], publicContextHandle: 1, readOrdinal: i + 1 });
const color = ordinal => '[log] [GLX_TRIANGLE_COLOR] ' + JSON.stringify({ schema: 'triangle-frame-color-v1', frame: (ordinal - 1) * 60 + 1,
    sampleOrdinal: ordinal, phaseIndex: (ordinal - 1) % 3, color: ['red', 'green', 'blue'][(ordinal - 1) % 3],
    rgbaComputed: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]][(ordinal - 1) % 3], publicContextHandle: 1, sampleLimit: 180, budgetExhausted: ordinal === 180 });
function fixture({ tag = 'session-a', colorCount = 2, native61 = true } = {}) {
    const lines = [], counts = {};
    let sequence = 0, throwEvents = 0;
    const emit = (kind, stage, ordinal, detail, extra = {}) => {
        if (kind !== 'notice') counts[stage] = Math.max(counts[stage] || 0, ordinal);
        if (kind === 'throw') throwEvents++;
        const event = { schema: 'triangle-js-boundary-v1', packageId: manifest.identity.packageId, sessionTag: tag, sequence: ++sequence,
            kind, stage, ordinal, counts: { ...counts }, runtime: { abort: false, runtimeExited: false, generation: 0, currentFrame: 1, timingMode: 1, timingValue: 1, running: true },
            detail, exhausted: false, outputFailures: 0, throwEvents, ...extra };
        lines.push('[info] [GLX_TRIANGLE_BOUNDARY] ' + JSON.stringify(event)); return event;
    };
    const pair = (stage, ordinal) => { emit('enter', stage, ordinal); emit('return', stage, ordinal); };
    emit('notice', 'startup', 1, { kind: 'startup', startupMarkers: { __isAdapterInjected: { present: false } }, eventLimit: 96 });
    lines.push(evidence('entry', 1, { sdkVersion: '3.17.5' }, tag));
    for (const api of ['onError', 'onUnhandledRejection']) emit('notice', 'notice', 1, { kind: 'error-hook-coverage', detail: { api, present: true, registered: true, registrationThrew: false } });
    for (let i = 0; i < 2; i++) lines.push('[log] [GLX_TRIANGLE_SHADER] ' + JSON.stringify(shader(i)), evidence('shader', i + 2, shader(i), tag));
    lines.push(evidence('host', 4, { summary: { ...manifest.identity, status: 'initialization-snapshot', mode: 'GLX', actualMode: 'glx', actualContextMetadataMatch: true, actualContextCanvasMatch: true } }, tag));
    pair('after-frame-register', 1);
    pair('raf-request', 1);
    emit('enter', 'raf-delivery', 1); emit('enter', 'run-iter', 1); emit('enter', 'native-callback', 1);
    lines.push(color(1)); emit('return', 'native-callback', 1); emit('return', 'run-iter', 1); emit('return', 'raf-delivery', 1);
    pair('after-frame', 1); pair('native-flush', 1); pair('batch', 1); pair('swap', 1);
    if (native61) pair('native-callback', 61);
    for (let i = 2; i <= colorCount; i++) lines.push(color(i));
    return { lines, emit, pair };
}
const run = (lines, previous) => analyze(lines.join('\n'), manifest, previous);
const codes = report => report.stopReasons.map(reason => reason.code);
const mutateEvent = (lines, predicate, change) => {
    const at = lines.findIndex(line => { const position = line.indexOf('[GLX_TRIANGLE_BOUNDARY] '); return position >= 0 && predicate(JSON.parse(line.slice(position + 24))); });
    assert.ok(at >= 0);
    const prefix = '[info] [GLX_TRIANGLE_BOUNDARY] ';
    const event = JSON.parse(lines[at].slice(prefix.length)); change(event); lines[at] = prefix + JSON.stringify(event);
};
test('partial RGB stream is diagnosable without frame 361 or a visible/FPS claim', () => {
    const { lines } = fixture(), text = lines.join('\r\n'); const report = analyze(text, manifest);
    assert.equal(report.status, 'BOUNDARY_DIAGNOSTIC'); assert.equal(report.stopRequired, false);
    assert.equal(report.rawLogBytes, Buffer.byteLength(text));
    assert.equal(report.rawLogSha256, crypto.createHash('sha256').update(text).digest('hex'));
    const s = report.sessions[0];
    assert.equal(s.frame61ColorObserved, true); assert.equal(s.lastColorFrame, 61);
    assert.equal(s.nativeCallback61ReturnObserved, true);
    assert.deepEqual(s.layers.swap.returnedOrdinals, [1]);
    assert.equal(report.visibleValidation, 'NOT_PROVEN'); assert.equal(report.fpsValidation, 'NOT_MEASURED');
});
test('missing 61 retains request/delivery/native/flush/batch/swap layers, does not assert RAF stopped', () => {
    const f = fixture({ colorCount: 1, native61: false });
    f.emit('enter', 'native-callback', 61);
    const report = run(f.lines), s = report.sessions[0];
    assert.equal(report.status, 'BOUNDARY_DIAGNOSTIC');
    assert.ok(codes(report).includes('FRAME_61_COLOR_NOT_OBSERVED'));
    assert.deepEqual(s.layers['native-callback'].openSelectedOrdinals, [61]);
    assert.deepEqual(s.layers['raf-request'].returnedOrdinals, [1]);
    assert.deepEqual(s.layers['raf-delivery'].returnedOrdinals, [1]);
    assert.deepEqual(s.layers['native-flush'].returnedOrdinals, [1]);
    assert.match(report.limits.join(' '), /Missing selected events do not prove RAF stopped/);
});
test('startup notice is accepted before entry, preserving startup markers and runtime primitives', () => {
    const report = run(fixture().lines);
    assert.equal(report.sessions[0].boundaryEvents[0].logLine, 1);
    assert.equal(report.sessions[0].entryLine, 2);
    assert.equal(report.sessions[0].notices[0].detail.startupMarkers.__isAdapterInjected.present, false);
    assert.equal(report.sessions[0].boundaryEvents[0].runtime.running, true);
});
test('older session callback after a newer entry stays associated with its original session', () => {
    const a = fixture(), b = fixture({ tag: 'session-b' });
    const before = a.lines.length; a.pair('after-frame', 61);
    const report = run([...a.lines.slice(0, before), ...b.lines, ...a.lines.slice(before)]);
    assert.equal(report.stopRequired, false);
    assert.ok(report.observations.some(item => item.code === 'OLDER_SESSION_CALLBACK_OBSERVED' && item.sessionTag === 'session-a' && item.latestEntrySessionTag === 'session-b'));
    assert.deepEqual(report.sessions[0].layers['after-frame'].returnedOrdinals, [1, 61]);
    assert.ok(!codes(report).includes('PACKAGE_MISMATCH'));
});
test('unbound callbacks without an old entry are retained; previous report can establish the old tag', () => {
    const a = fixture(), previous = run(a.lines), before = a.lines.length; a.pair('after-frame', 61);
    const lines = [...fixture({ tag: 'session-b' }).lines, ...a.lines.slice(before)];
    const unbound = run(lines);
    assert.equal(unbound.stopRequired, false);
    assert.ok(unbound.observations.some(item => item.code === 'UNBOUND_SESSION_CALLBACK_OBSERVED'));
    const linked = run(lines, previous);
    assert.equal(linked.stopRequired, false);
    assert.ok(linked.observations.some(item => item.code === 'OLDER_SESSION_CALLBACK_OBSERVED'));
    assert.equal(linked.sessions.find(s => s.sessionTag === 'session-a').entryObserved, false);
});
test('an old unmatched native enter does not steal new-session raw shader/color lines', () => {
    const a = fixture(); a.emit('enter', 'native-callback', 2);
    const report = run([...a.lines, ...fixture({ tag: 'session-b' }).lines]);
    const second = report.sessions.find(s => s.sessionTag === 'session-b');
    assert.equal(second.rawShaderObservations.length, 2);
    assert.equal(second.colorSamples.length, 2);
    assert.ok(!report.stopReasons.some(reason => reason.sessionTag === 'session-b' && ['RAW_SHADER_MISMATCH', 'SHADER_COVERAGE_INCOMPLETE'].includes(reason.code)));
});
test('a missing paired enter/return in the middle is a boundary gap, not complete evidence', () => {
    const f = fixture();
    const lines = f.lines.filter(line => !(line.includes('[GLX_TRIANGLE_BOUNDARY]') && line.includes('"stage":"swap"')));
    const report = run(lines);
    assert.ok(codes(report).includes('BOUNDARY_EVENT_GAP'));
    assert.equal(report.stopRequired, true);
    assert.equal(report.sessions[0].sequenceGaps[0].kind, 'internal');
    assert.equal(report.sessions[0].sequenceGaps[0].to - report.sessions[0].sequenceGaps[0].from, 1);
});
test('an entry-anchored session must include sequence 1; a missing old prefix stays partial unknown', () => {
    const f = fixture();
    const missingStart = run(f.lines.slice(1));
    assert.ok(codes(missingStart).includes('BOUNDARY_EVENT_GAP'));
    assert.equal(missingStart.sessions[0].prefixPartial, true);
    const old = fixture({ tag: 'old-unbound' }); const before = old.lines.length; old.pair('after-frame', 61);
    const partial = run([...fixture().lines, ...old.lines.slice(before)]);
    const s = partial.sessions.find(item => item.sessionTag === 'old-unbound');
    assert.equal(partial.stopRequired, false);
    assert.equal(s.prefixPartial, true);
    assert.equal(s.sequenceGaps[0].coverage, 'UNKNOWN_PARTIAL_OLD_SESSION_PREFIX');
    assert.ok(!codes(partial).includes('PACKAGE_MISMATCH'));
});
test('late host failure and structured-output failures stop even after an initialized host', () => {
    for (const kind of ['host-failure', 'structured-output-failure']) {
        const f = fixture(); f.emit('notice', 'notice', 1, { kind, detail: { message: 'late failure' } });
        const report = run(f.lines);
        assert.equal(report.stopRequired, true);
        assert.ok(codes(report).includes(kind === 'host-failure' ? 'HOST_FAILURE_NOTICE' : 'STRUCTURED_OUTPUT_FAILURE'));
    }
});
test('hook coverage missing/false/registration error all stop with explicit reasons', () => {
    for (const bad of [{ present: false }, { registered: false }, { registrationThrew: true }]) {
        const f = fixture(); mutateEvent(f.lines, event => event.detail?.kind === 'error-hook-coverage', event => Object.assign(event.detail.detail, bad));
        assert.ok(codes(run(f.lines)).includes('ERROR_HOOK_COVERAGE_FAILED'));
    }
    const f = fixture();
    const lines = f.lines.filter(line => !line.includes('"api":"onError"'));
    assert.ok(codes(run(lines)).includes('ERROR_HOOK_COVERAGE_UNKNOWN'));
});
test('probe output failures and runtime metadata read failures produce coverage stop reasons', () => {
    for (const [change, code] of [[event => { event.outputFailures = 1; }, 'PROBE_OUTPUT_FAILURE'],
        [event => { delete event.outputFailures; }, 'OUTPUT_FAILURE_COUNT_UNKNOWN'],
        [event => { event.runtime = { readFailed: true }; }, 'RUNTIME_COUNTER_COVERAGE_FAILED']]) {
        const f = fixture(); mutateEvent(f.lines, event => event.stage === 'startup', change);
        assert.ok(codes(run(f.lines)).includes(code));
    }
});
test('96th terminal event and COLOR cap stop; bounded stream is not a pixel assertion', () => {
    const f = fixture();
    f.emit('notice', 'budget', 1, { kind: 'budget-exhausted', exhausted: true, eventLimit: 96 }, { sequence: 96, exhausted: true });
    assert.ok(codes(run(f.lines)).includes('PROBE_BUDGET_EXHAUSTED'));
    assert.ok(codes(run(fixture({ colorCount: 180 }).lines)).includes('COLOR_BUDGET_EXHAUSTED'));
});
test('observed ordinary/numeric throws stop with raw classification; unwind is distinct control flow', () => {
    for (const [detail, stopped, classification] of [
        [{ thrownType: 'object', primitiveValuePresent: false, message: 'GL failed' }, true, 'THROWN_VALUE_OBSERVED'],
        [{ thrownType: 'number', primitiveValuePresent: true, primitiveValue: 8 }, true, 'NUMERIC_SIGNAL_MEANING_NOT_CERTIFIED'],
        [{ thrownType: 'string', primitiveValuePresent: true, primitiveValue: 'unwind' }, false, 'KNOWN_UNWIND_CONTROL_FLOW']
    ]) {
        const f = fixture(); f.emit('throw', 'native-stderr', 3, detail);
        const report = run(f.lines), observed = report.sessions[0].layers['native-stderr'].throws[0];
        assert.equal(codes(report).includes('BOUNDARY_THROW_OBSERVED'), stopped);
        assert.equal(observed.classification, classification); assert.deepEqual(observed.detail, detail);
    }
});
for (const [name, change, code] of [
    ['different package', event => { event.packageId = 'other'; }, 'PACKAGE_MISMATCH'],
    ['unknown schema', event => { event.schema = 'other'; }, 'BOUNDARY_SCHEMA_OR_SEQUENCE'],
    ['over cap sequence', event => { event.sequence = 97; }, 'BOUNDARY_SCHEMA_OR_SEQUENCE'],
    ['invalid throw count', event => { event.throwEvents = 5; }, 'THROW_COUNTER_INVALID']
]) test('reject malformed probe field: ' + name, () => {
    const f = fixture(); mutateEvent(f.lines, event => event.stage === 'startup', change);
    assert.ok(codes(run(f.lines)).includes(code));
});
test('runtime error text, late error event, host mismatch, SDK and raw shader mismatch stop', () => {
    const f = fixture();
    assert.ok(codes(run([...f.lines, '[error] late Error: failed'])).includes('RUNTIME_ERROR_TEXT'));
    assert.ok(codes(run([...f.lines, evidence('error', 5, { message: 'late error' })])).includes('ERROR_OR_BLOCKED_EVIDENCE'));
    assert.ok(codes(run(f.lines.map(line => line.replace('"sdkVersion":"3.17.5"', '"sdkVersion":"3.15.2"')))).includes('SDK_GATE_FAILED'));
    assert.ok(codes(run(f.lines.map(line => line.replace('"actualMode":"glx"', '"actualMode":"webgl"')))).includes('GLX_HOST_GATE_FAILED'));
    const wrongRaw = f.lines.map(line => line.startsWith('[log] [GLX_TRIANGLE_SHADER]') ? line.replace('"returnedType":35633', '"returnedType":35632') : line);
    assert.ok(codes(run(wrongRaw)).includes('RAW_SHADER_MISMATCH'));
});
test('empty/malformed logs stay diagnostic with explicit missing layers; wrong previous never certifies tags', () => {
    const empty = run([]); assert.equal(empty.status, 'BOUNDARY_DIAGNOSTIC'); assert.ok(codes(empty).includes('NO_ENTRY_OBSERVED'));
    assert.equal(run(['[GLX_TRIANGLE_BOUNDARY] invalid']).status, 'STOP_INVALID_EVIDENCE');
    assert.ok(codes(run(fixture().lines, { schema: 'other' })).includes('PREVIOUS_IDENTITY_MISMATCH'));
    assert.equal(analyze(fixture().lines.join('\n'), { ...manifest, schema: 'native-glx-validation-candidate-v1' }).status, 'STOP_INVALID_EVIDENCE');
});
test('CLI writes only a new report and never overwrites captured evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-reader-self-test-'));
    try {
        const log = path.join(dir, 'raw.log'), candidate = path.join(dir, 'candidate.json'), out = path.join(dir, 'report.json');
        const bytes = Buffer.from(fixture({ colorCount: 1, native61: false }).lines.join('\n'));
        fs.writeFileSync(log, bytes); fs.writeFileSync(candidate, JSON.stringify(manifest));
        const report = cli(['--log', log, '--candidate', candidate, '--out', out]);
        assert.equal(report.status, 'BOUNDARY_DIAGNOSTIC'); assert.equal(report.stopRequired, true);
        assert.deepEqual(fs.readFileSync(log), bytes);
        assert.throws(() => cli(['--log', log, '--candidate', candidate, '--out', out]), /EEXIST/);
        assert.throws(() => cli(['--log', log, '--candidate', candidate, '--out', 'relative.json']), /absolute/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
