import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyze, diff, cli } from './read-log.mjs';

const manifest = { identity: { packageId: 'native-glx-validation-0123456789abcdef0123', variant: 'test-framecolor', wasmSha256: 'fake', files: { a: 'hash' } } };
const event = (kind, sequence, detail, sessionTag = 'session-a', extra = {}) => '[info] [GLX_TRIANGLE_EVIDENCE] ' + JSON.stringify({ kind, sequence, detail, packageId: manifest.identity.packageId, sessionTag, ...extra });
const shader = i => ({ schema: 'triangle-shader-type-v1', stage: 'created-before-source', shaderId: i + 1, expectedType: [35633, 35632][i], returnedType: [35633, 35632][i], publicContextHandle: 1, readOrdinal: i + 1 });
const sample = (ordinal, extra = {}) => '[log] [GLX_TRIANGLE_COLOR] ' + JSON.stringify({ schema: 'triangle-frame-color-v1', frame: (ordinal - 1) * 60 + 1, sampleOrdinal: ordinal, phaseIndex: (ordinal - 1) % 3, color: ['red', 'green', 'blue'][(ordinal - 1) % 3], rgbaComputed: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]][(ordinal - 1) % 3], publicContextHandle: 1, sampleLimit: 180, budgetExhausted: ordinal === 180, ...extra });
function fixture(count = 7, tag = 'session-a') {
    const result = [event('entry', 1, { sdkVersion: '3.17.5' }, tag)];
    for (let i = 0; i < 2; ++i) result.push('[log] [GLX_TRIANGLE_SHADER] ' + JSON.stringify(shader(i)), event('shader', i + 2, shader(i), tag));
    result.push(event('host', 4, { summary: { ...manifest.identity, mode: 'GLX', status: 'initialization-snapshot', actualMode: 'glx', actualContextMetadataMatch: true, actualContextCanvasMatch: true, contextId: 2 } }, tag));
    for (let i = 1; i <= count; ++i) result.push(sample(i));
    return result;
}
const run = (lines, previous) => analyze(lines.join('\n'), manifest, previous);
test('complete two cycles and next red, exact raw bytes and no visible/FPS claim', () => {
    const lines = fixture(), raw = lines.join('\r\n'), result = analyze(raw, manifest);
    assert.equal(result.status, 'COLOR_CALLBACK_CYCLES_OBSERVED');
    assert.equal(result.rawLogSha256, crypto.createHash('sha256').update(raw).digest('hex'));
    assert.equal(result.rawLogBytes, Buffer.byteLength(raw));
    assert.equal(result.sessions[0].lastFrame, 361);
    assert.equal(result.sessions[0].twoCyclesAndNextRedObserved, true);
    assert.equal(result.visibleValidation, 'NOT_PROVEN'); assert.equal(result.fpsValidation, 'NOT_MEASURED');
});
test('same JS session accepts repeated show/hide, stages do not pass lifecycle', () => {
    const lines = fixture(); lines.push(event('show', 5, {}), event('hide', 6, {}), event('show', 7, {}), event('stage', 8, { stage: 'resume' }));
    const result = run(lines); assert.equal(result.status, 'COLOR_CALLBACK_CYCLES_OBSERVED');
    assert.deepEqual(result.sessions[0].lifecycleEvents.map(x => x.kind), ['show', 'hide', 'show', 'stage']);
    assert.equal(result.lifecycleValidation, 'NOT_PROVEN');
});
test('multiple complete sessions, same exact package/identity', () => {
    const result = run([...fixture(), ...fixture(8, 'session-b')]);
    assert.equal(result.status, 'COLOR_CALLBACK_CYCLES_OBSERVED'); assert.equal(result.sessions.length, 2);
});
test('cumulative diff reports only newly recorded frames', () => {
    const previous = run(fixture()), result = run(fixture(9), previous);
    assert.equal(result.status, 'COLOR_CALLBACK_CYCLES_OBSERVED');
    assert.deepEqual(result.cumulativeDiff.sessions[0].addedFrames, [421, 481]);
    assert.deepEqual(diff(previous, previous).sessions[0].addedFrames, []);
    const newSession = run([...fixture(), ...fixture(7, 'session-b')], previous);
    assert.equal(newSession.cumulativeDiff.sessions[1].newSession, true);
});
test('diff rejects changed, missing cumulative frames/session and wrong identity', () => {
    const old = run(fixture(8)), shorter = run(fixture()); assert.equal(diff(old, shorter).status, 'STOP');
    const changed = structuredClone(old); changed.sessions[0].samples[0].rgbaComputed[0] = 0;
    assert.equal(diff(old, changed).status, 'STOP');
    const missing = run(fixture(7, 'session-b')); assert.equal(diff(old, missing).status, 'STOP');
    const badIdentity = { ...old, candidateIdentitySha256: 'wrong' }; assert.equal(diff(badIdentity, old).status, 'STOP');
});
for (const [name, mutate] of [
    ['missing two cycles', lines => lines.pop()],
    ['wrong SDK', lines => { lines[0] = event('entry', 1, { sdkVersion: '3.17.4' }); }],
    ['mixed package', lines => lines.push(event('show', 5, {}, 'session-a', { packageId: 'other' }))],
    ['unknown session', lines => lines.push(event('show', 5, {}, 'unknown'))],
    ['repeated session entry', lines => lines.push(event('entry', 1, { sdkVersion: '3.17.5' }))],
    ['JSON error', lines => lines.push('[GLX_TRIANGLE_COLOR] {bad')],
    ['structured JSON error', lines => lines.push('[GLX_TRIANGLE_EVIDENCE] nope')],
    ['raw error', lines => lines.push('[error] failure')],
    ['error event', lines => lines.push(event('error', 5, { message: 'oops' }))],
    ['blocked event', lines => lines.push(event('blocked', 5, {}))],
    ['wrong host hash', lines => { lines[5] = lines[5].replace('"wasmSha256":"fake"', '"wasmSha256":"other"'); }],
    ['wrong host mode', lines => { lines[5] = lines[5].replace('"actualMode":"glx"', '"actualMode":"webgl"'); }],
    ['wrong shader type', lines => { lines[2] = lines[2].replace('"returnedType":35633', '"returnedType":35632'); }],
    ['missing raw shader', lines => lines.splice(1, 1)],
    ['duplicate color frame', lines => lines.push(sample(7))],
    ['color mismatch', lines => { lines[6] = sample(1, { color: 'green' }); }],
    ['phase mismatch', lines => { lines[6] = sample(1, { phaseIndex: 1 }); }],
    ['RGBA mismatch', lines => { lines[6] = sample(1, { rgbaComputed: [0, 1, 0, 1] }); }],
    ['context mismatch', lines => { lines[7] = sample(2, { publicContextHandle: 3 }); }],
    ['budget flag wrong', lines => { lines[6] = sample(1, { budgetExhausted: true }); }],
    ['sample limit wrong', lines => { lines[6] = sample(1, { sampleLimit: 181 }); }],
    ['wrong ordinal', lines => { lines[6] = sample(1, { sampleOrdinal: 0 }); }],
]) test(`STOP: ${name}`, () => { const lines = fixture(); mutate(lines); assert.equal(run(lines).status, 'STOP'); });
test('180th cap and over-cap stop, 179 samples can be observed', () => {
    assert.equal(run(fixture(179)).status, 'COLOR_CALLBACK_CYCLES_OBSERVED');
    assert.equal(run(fixture(180)).status, 'STOP'); assert.equal(run(fixture(181)).status, 'STOP');
});
test('missing entry/session and incomplete second session stop without implying RAF failure', () => {
    assert.equal(run([]).status, 'STOP'); assert.equal(run([sample(1)]).status, 'STOP');
    assert.equal(run([...fixture(), ...fixture(2, 'session-b')]).status, 'STOP');
    assert.match(run([]).limits, /Missing samples do not prove RAF stopped/);
});
test('CLI new-only output, optional previous, malformed inputs produce STOP', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framecolor-reader-'));
    try {
        const log = path.join(dir, 'raw.log'), candidate = path.join(dir, 'CANDIDATE.json'), out = path.join(dir, 'out.json');
        fs.writeFileSync(log, fixture().join('\n')); fs.writeFileSync(candidate, JSON.stringify(manifest));
        assert.equal(cli(['--log', log, '--candidate', candidate, '--out', out]).status, 'COLOR_CALLBACK_CYCLES_OBSERVED');
        assert.throws(() => cli(['--log', log, '--candidate', candidate, '--out', out]), /EEXIST/);
        fs.writeFileSync(log, fixture(8).join('\n'));
        const next = cli(['--log', log, '--candidate', candidate, '--out', path.join(dir, 'next.json'), '--previous', out]);
        assert.deepEqual(next.cumulativeDiff.sessions[0].addedFrames, [421]);
        fs.writeFileSync(candidate, '{bad');
        assert.equal(cli(['--log', log, '--candidate', candidate, '--out', path.join(dir, 'bad.json')]).status, 'STOP');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
