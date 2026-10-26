import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyze, cli } from './read-log.mjs';

const manifest = { identity: { packageId: 'native-glx-validation-0123456789abcdef0123', wasmSha256: 'fake-hash' } };
const event = (kind, sequence, detail, extra = {}) => '[info] [GLX_TRIANGLE_EVIDENCE] ' + JSON.stringify({ kind, sequence, packageId: manifest.identity.packageId, sessionTag: 'one-session', detail, ...extra });
const sample = (frame, extra = {}) => '[log] [GLX_TRIANGLE_CLOCK] ' + JSON.stringify({ schema: 'triangle-clock-two-frame-v1', frame, sampleOrdinal: frame === 1 ? 1 : 2,
    rawClockDouble: frame === 1 ? 1000000000000 : 1000000001000, secondsBeforeFloat: frame === 1 ? 1000000000 : 1000000001, phaseAfterFloat: 1000000000, wave: 0.4, referenceWallMs: frame === 1 ? 10000 : 11000, rgbaComputed: [0.05, 0.36, 0.52, 1], publicContextHandle: 1, ...extra });
const fixture = () => [event('entry', 1, { sdkVersion: '3.17.5' }), event('host', 2, { summary: { ...manifest.identity, mode: 'GLX', status: 'initialization-snapshot', actualMode: 'glx', actualContextMetadataMatch: true, actualContextCanvasMatch: true, contextId: 2 } }), sample(1), sample(61)];
const run = lines => analyze(lines.join('\n'), manifest);
test('two bounded samples, hashes, deltas, quantization, distinct native context namespace', () => {
    const raw = fixture().join('\n'); const result = analyze(raw, manifest);
    assert.equal(result.status, 'TWO_SAMPLES_OBSERVED');
    assert.equal(result.rawLogSha256, crypto.createHash('sha256').update(raw).digest('hex'));
    assert.equal(result.rawLogBytes, Buffer.byteLength(raw));
    assert.equal(result.deltas.rawClockDouble, 1000);
    assert.equal(result.rawChangesWhileFloatPhaseUnchanged, true);
    assert.equal(result.clockUnitIndication, 'RAW_NEAR_MILLISECONDS_PER_REFERENCE_MS');
    assert.equal(result.presentationValidation, 'NOT_PROVEN');
    assert.equal(result.lifecycleValidation, 'NOT_RUN');
});
test('seconds clock ratio is observational', () => {
    const lines = fixture(); lines[2] = sample(1, { rawClockDouble: 100 }); lines[3] = sample(61, { rawClockDouble: 101 });
    assert.equal(run(lines).clockUnitIndication, 'RAW_NEAR_SECONDS_PER_REFERENCE_MS');
});
for (const [name, mutate] of [
    ['missing 61', lines => lines.pop()],
    ['wrong actual SDK', lines => { lines[0] = event('entry', 1, { sdkVersion: '3.17.4' }); }],
    ['mixed package', lines => lines.push(event('show', 3, {}, { packageId: 'other' }))],
    ['mixed session', lines => lines.push(event('show', 3, {}, { sessionTag: 'other' }))],
    ['duplicate sample', lines => lines.push(sample(61))],
    ['wrong ordinal', lines => { lines[3] = sample(61, { sampleOrdinal: 1 }); }],
    ['wrong frame', lines => { lines[3] = sample(60); }],
    ['invalid JSON', lines => lines.push('[GLX_TRIANGLE_CLOCK] {bad')],
    ['invalid evidence JSON', lines => lines.push('[GLX_TRIANGLE_EVIDENCE] nope')],
    ['error event', lines => lines.push(event('error', 3, { message: 'failure' }))],
    ['raw error', lines => lines.push('[error] failure')],
    ['blocked host', lines => { lines[1] = event('host', 2, { summary: { ...manifest.identity, status: 'blocked' } }); }],
    ['missing canvas match', lines => { lines[1] = lines[1].replace('"actualContextCanvasMatch":true', '"actualContextCanvasMatch":"unknown"'); }],
    ['identity mismatch', lines => { lines[1] = lines[1].replace('fake-hash', 'other'); }],
    ['invalid numeric sample', lines => { lines[3] = sample(61, { rawClockDouble: null }); }],
    ['invalid RGBA', lines => { lines[3] = sample(61, { rgbaComputed: [] }); }],
    ['out of order', lines => { [lines[2], lines[3]] = [lines[3], lines[2]]; }],
]) test(`STOP: ${name}`, () => { const lines = fixture(); mutate(lines); assert.equal(run(lines).status, 'STOP'); });
test('empty log stays inconclusive, stage does not establish lifecycle', () => {
    const missing = analyze('', manifest); assert.equal(missing.status, 'STOP');
    assert.match(missing.limits, /Missing frame 61 does not prove RAF stopped/);
    const lines = fixture(); lines.push(event('stage', 3, { stage: 'resume' }));
    assert.equal(run(lines).lifecycleValidation, 'NOT_RUN');
});
test('CLI preserves original, writes new only, errors become STOP report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triangle-clock-read-'));
    try {
        const log = path.join(dir, 'raw.log'), candidate = path.join(dir, 'CANDIDATE.json'), out = path.join(dir, 'report.json');
        const raw = fixture().join('\r\n'); fs.writeFileSync(log, raw); fs.writeFileSync(candidate, JSON.stringify(manifest));
        assert.equal(cli(['--log', log, '--candidate', candidate, '--out', out]).status, 'TWO_SAMPLES_OBSERVED');
        assert.equal(fs.readFileSync(log, 'utf8'), raw);
        assert.throws(() => cli(['--log', log, '--candidate', candidate, '--out', out]), /EEXIST/);
        fs.writeFileSync(candidate, '{bad');
        const failure = cli(['--log', log, '--candidate', candidate, '--out', path.join(dir, 'failure.json')]);
        assert.equal(failure.status, 'STOP'); assert.ok(failure.reasons.some(x => x.startsWith('Input failure:')));
        assert.equal(failure.rawLogBytes, Buffer.byteLength(raw));
        assert.throws(() => cli(['--log', 'relative']), /absolute/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
