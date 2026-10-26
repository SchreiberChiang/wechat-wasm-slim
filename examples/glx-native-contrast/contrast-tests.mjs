import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Source text and elementary color math only; no generated JS/WASM/adapter.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const baseline = source(path.join(here, '../glx-native-validation/main.cpp'));
const candidate = source(path.join(here, 'main.cpp'));
const oldColor = 'glClearColor(0.03f, 0.08f + wave * 0.25f, 0.12f, 1.0f);';
const newColor = 'glClearColor(0.05f, 0.10f + wave * 0.65f, 0.80f - wave * 0.70f, 1.0f);';
const color = wave => [0.05, 0.10 + wave * 0.65, 0.80 - wave * 0.70];
test('only the clearColor expression changes; shader, main and frame order are preserved', () => {
    assert.equal(baseline.split(oldColor).length, 2);
    assert.equal(candidate.split(newColor).length, 2);
    assert.equal(candidate, baseline.replace(oldColor, newColor));
    for (const marker of ['static GLuint shader(', 'int main() {']) {
        const baselineEnd = marker.startsWith('static') ? baseline.indexOf('static void frame() {') : baseline.length;
        const candidateEnd = marker.startsWith('static') ? candidate.indexOf('static void frame() {') : candidate.length;
        assert.equal(candidate.slice(candidate.indexOf(marker), candidateEnd), baseline.slice(baseline.indexOf(marker), baselineEnd));
    }
});
test('blue and green endpoints are far apart and RGB remains inside display range', () => {
    const blue = color(0), green = color(1);
    assert.deepEqual(blue, [0.05, 0.10, 0.80]);
    assert.ok(Math.abs(green[1] - 0.75) < 1e-12 && Math.abs(green[2] - 0.10) < 1e-12);
    assert.ok(blue[2] - blue[1] >= 0.69);
    assert.ok(green[1] - green[2] >= 0.64);
    assert.ok(Math.hypot(...blue.map((value, i) => value - green[i])) > 0.95);
    for (let i = 0; i <= 1000; i++)
        assert.ok(color(i / 1000).every(channel => channel >= 0 && channel <= 1));
    assert.ok(candidate.includes('color = vec4(1.0, 0.35, 0.08, 1.0);'));
    assert.ok(1.0 - color(0)[0] >= 0.95 && 1.0 - color(1)[0] >= 0.95);
});
test('original wave timing is unchanged, with a 2 pi second cycle', () => {
    const timing = 'const float wave = 0.5f + 0.5f * std::sin(float(emscripten_get_now() / 1000.0));';
    assert.ok(baseline.includes(timing) && candidate.includes(timing));
    const wave = milliseconds => 0.5 + 0.5 * Math.sin(milliseconds / 1000);
    const period = 2 * Math.PI * 1000;
    for (let i = 0; i <= 16; i++)
        assert.ok(Math.abs(wave(i * period / 16) - wave(i * period / 16 + period)) < 1e-12);
    assert.ok(Math.abs(wave(period / 4) - 1) < 1e-12);
    assert.ok(Math.abs(wave(3 * period / 4)) < 1e-12);
});
test('stager rejects non-allowlisted variants before importing or creating outputs', () => {
    const runner = path.join(here, '../glx-native-validation/stager-tests.mjs');
    const child = spawnSync(process.execPath, [runner, '--variant-dir', path.join(here, 'unapproved')],
        { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Only the known validation and contrast sibling directories/);
});
test('stager rejects duplicate variant flags including attempts to override the wrapper', () => {
    const runner = path.join(here, '../glx-native-validation/stager-tests.mjs');
    for (const [file, args] of [
        [runner, ['--variant-dir', here, '--variant-dir', here]],
        [path.join(here, 'stager-tests.mjs'), ['--variant-dir', path.resolve(here, '../glx-native-validation')]]
    ]) {
        const child = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        assert.ifError(child.error);
        assert.notEqual(child.status, 0);
        assert.match(child.stderr, /Expected one absolute --variant-dir/);
    }
});
