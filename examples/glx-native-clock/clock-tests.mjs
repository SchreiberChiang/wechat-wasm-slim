import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// Static source and synthetic numeric models only, never phone observations.
const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const baseline = () => read(path.join(here, '../glx-native-contrast/main.cpp'));
const candidate = () => read(path.join(here, 'main.cpp'));
const gate = () => createRequire(import.meta.url)('./clock-gates.cjs');
const compact = value => value.replace(/\s+/g, '');
test('main and shader stay unchanged and the frame GL call sequence stays unchanged', () => {
    const old = baseline(), next = candidate();
    assert.equal(next.slice(next.indexOf('int main() {')), old.slice(old.indexOf('int main() {')));
    const shader = old.slice(old.indexOf('static GLuint shader('), old.indexOf('static void frame() {')).trim();
    assert.ok(next.includes(shader), 'Original shader source and failure path changed');
    const calls = source => [...source.slice(source.indexOf('static void frame() {'), source.indexOf('int main() {'))
        .matchAll(/\b(gl[A-Z]\w*)\s*\([^;]*?\);/g)].map(match => compact(match[0]));
    assert.deepEqual(calls(next), calls(old));
    assert.ok(!next.includes('glFlush(') && !next.includes('glFinish('));
});
test('source retains the raw double, double division and float phase driving the original wave', () => {
    const source = compact(candidate());
    assert.ok(source.includes('constdoubleraw_clock=emscripten_get_now();'));
    assert.ok(source.includes('constdoubleseconds_before_float=raw_clock/1000.0;'));
    assert.ok(source.includes('constfloatphase_after_float=float(seconds_before_float);'));
    assert.ok(source.includes('constfloatwave=0.5f+0.5f*std::sin(phase_after_float);'));
    assert.equal((candidate().match(/emscripten_get_now\(\)/g) || []).length, 1, 'Clock driving the color was sampled more than once');
});
test('only the marked observations and named intermediates differ from contrast', () => {
    const stripped = candidate()
        .replace(/^[ \t]*\/\/ BEGIN CLOCK (STATE|FRAME|REPORT)\n[\s\S]*?^[ \t]*\/\/ END CLOCK \1\n/gm, '')
        .replace(/^[ \t]*\/\/ BEGIN CLOCK VALUES\n[\s\S]*?^[ \t]*\/\/ END CLOCK VALUES\n/gm,
            '    const float wave = 0.5f + 0.5f * std::sin(float(emscripten_get_now() / 1000.0));\n');
    assert.equal(stripped, baseline());
});
test('only frames 1 and 61 sample after draw, with a hard limit of two and a reference-only clock', () => {
    const source = candidate(), flat = compact(source);
    const frame = source.slice(source.indexOf('static void frame() {'), source.indexOf('int main() {'));
    const report = frame.slice(frame.indexOf('// BEGIN CLOCK REPORT'), frame.indexOf('// END CLOCK REPORT'));
    assert.ok(flat.includes('staticunsignedclock_frame=0;') && flat.includes('staticunsignedclock_samples=0;'));
    assert.equal((source.match(/\+\+clock_frame/g) || []).length, 1);
    assert.ok(compact(report).includes('if((clock_frame==1||clock_frame==61)&&clock_samples<2){++clock_samples;'));
    assert.equal((source.match(/\+\+clock_samples/g) || []).length, 1);
    assert.equal((source.match(/emscripten_date_now\(\)/g) || []).length, 1);
    assert.ok(report.includes('const double reference_wall_ms = emscripten_date_now();'));
    assert.equal((frame.slice(0, frame.indexOf('// BEGIN CLOCK REPORT')).match(/reference_wall_ms|emscripten_date_now/g) || []).length, 0);
    assert.ok(frame.indexOf('glDrawArrays(') < frame.indexOf('// BEGIN CLOCK REPORT'));
    assert.equal((source.match(/\[GLX_TRIANGLE_CLOCK\]/g) || []).length, 1);
    for (const field of ['frame', 'sampleOrdinal', 'rawClockDouble', 'secondsBeforeFloat', 'phaseAfterFloat', 'wave', 'referenceWallMs', 'rgbaComputed', 'publicContextHandle'])
        assert.ok(report.includes(field));
    assert.equal((report.match(/%\.17g/g) || []).length, 8);
    assert.ok(report.includes('double(phase_after_float), double(wave), reference_wall_ms'));
    assert.ok(report.includes('double(0.10f + wave * 0.65f)') && report.includes('double(0.80f - wave * 0.70f)'));
});
test('synthetic epoch-seconds model: frames can advance while float phase stays fixed', () => {
    const epochMilliseconds = 1792869000000; // Illustrative input, not a measured phone clock.
    const raw = milliseconds => milliseconds / 1000; // Adapter implementation when injected.
    const phase = milliseconds => Math.fround(raw(milliseconds) / 1000);
    assert.equal(phase(epochMilliseconds), phase(epochMilliseconds + 20000));
    assert.equal(phase(epochMilliseconds + 125000) - phase(epochMilliseconds), 0.125);
    assert.equal(Math.log2(phase(epochMilliseconds)) | 0, 20);
    assert.equal(2 ** (20 - 23), 0.125);
    assert.equal(raw(epochMilliseconds + 20000) - raw(epochMilliseconds), 20);
    assert.equal((2 * Math.PI) / (1 / 1000), 2 * Math.PI * 1000);
});
test('synthetic millisecond epochs and relative milliseconds have different float behavior', () => {
    const epochMilliseconds = 1792869000000;
    const epochPhase = Math.fround(epochMilliseconds / 1000);
    assert.equal(2 ** (Math.floor(Math.log2(epochPhase)) - 23), 128);
    const relativePhase = elapsedMilliseconds => Math.fround(elapsedMilliseconds / 1000);
    assert.notEqual(relativePhase(1000), relativePhase(1000 + 1000 / 60));
    for (const raw of [0, 1, 1000, 1792869000, epochMilliseconds]) {
        const oldPhase = Math.fround(raw / 1000);
        const secondsDouble = raw / 1000;
        const newPhase = Math.fround(secondsDouble);
        assert.equal(newPhase, oldPhase, 'Named intermediates must not repair the model');
    }
});
test('fake SDK metadata only admits exact 3.17.5 and reports blocked metadata', () => {
    const { requireVersion } = gate();
    const events = [];
    const noOtherApi = sdk => new Proxy({ getSystemInfoSync: () => ({ SDKVersion: sdk }) }, {
        get(target, name) { assert.equal(name, 'getSystemInfoSync'); return target[name]; }
    });
    assert.doesNotThrow(() => requireVersion(noOtherApi('3.17.5'), value => events.push(value)));
    assert.equal(events.length, 0);
    for (const sdk of ['3.15.2', '3.17.5 ', '', undefined]) {
        const blocked = [];
        assert.throws(() => requireVersion(noOtherApi(sdk), value => blocked.push(value)));
        assert.ok(blocked.some(value => value.status === 'blocked'));
    }
    const blocked = [];
    assert.throws(() => requireVersion({ getSystemInfoSync() { throw Error('unavailable metadata'); } }, value => blocked.push(value)));
    assert.ok(blocked.some(value => value.status === 'blocked'));
});
test('fake context gate checks actual GLX metadata and canvas without GPU calls', () => {
    const { requireContext } = gate();
    const module = () => {
        const canvas = {};
        const metadata = { ctxid: 2, platform: 1, isWebGL2: true };
        return { canvas, ctx: { canvas, emscriptenGLX: { ...metadata } }, wxContextGlobal: metadata };
    };
    const unexpected = [];
    const valid = module();
    valid.ctx = new Proxy(valid.ctx, { get(target, name) {
        if (!(name in target)) { unexpected.push(name); throw Error('Unexpected context API'); }
        return target[name];
    } });
    assert.doesNotThrow(() => requireContext(valid, () => assert.fail('Valid GLX context blocked')));
    assert.deepEqual(unexpected, []);
    for (const alter of [
        value => { delete value.ctx; },
        value => { delete value.ctx.emscriptenGLX; },
        value => { value.ctx.emscriptenGLX.isWebGL2 = false; },
        value => { value.wxContextGlobal.isWebGL2 = false; },
        value => { value.ctx.emscriptenGLX.ctxid = 9; },
        value => { value.ctx.emscriptenGLX.platform = 9; },
        value => { value.ctx.canvas = {}; }
    ]) {
        const invalid = module(), events = []; alter(invalid);
        assert.throws(() => requireContext(invalid, value => events.push(value)));
        assert.ok(events.some(value => value.status === 'blocked'));
    }
});
test('prelude fake host: SDK blocks before host creation and context blocks before CLOCK forwarding', () => {
    const preparation = read(path.join(here, 'prepare-host.mjs'));
    const start = preparation.indexOf('const preludeTemplate = ') + 'const preludeTemplate = '.length;
    const end = preparation.indexOf('\n    const entry =', start);
    assert.ok(start >= 'const preludeTemplate = '.length && end > start);
    // Evaluate only the trusted concatenated literal expression, then its
    // prelude with self-authored gates and a fake host. No suffix is supplied.
    const prelude = vm.runInNewContext('(' + preparation.slice(start, end).trim().replace(/;$/, '') + ')', {}, { timeout: 1000 });
    assert.ok(prelude.endsWith('// BEGIN ORIGINAL TRIANGLE.JS BYTES\n'));
    const setup = sdk => {
        const events = [], forwarded = [], requires = [];
        let hostCreations = 0, instantiations = 0;
        const canvas = {}, metadata = { isWebGL2: true, platform: 1, ctxid: 2 };
        const moduleConfig = { canvas, ctx: { canvas, emscriptenGLX: { ...metadata } }, wxContextGlobal: metadata,
            instantiateWasm() { instantiations++; assert.fail('Prelude must not instantiate'); } };
        const session = { host: event => events.push(event), native: (message, error) => forwarded.push([message, error]) };
        const wx = { getSystemInfoSync: () => ({ SDKVersion: sdk }) };
        const context = vm.createContext({ GameGlobal: { __nativeTriangleEvidence: session }, wx, require(name) {
            requires.push(name);
            if (name === './identity.js') return { packageId: 'fake-clock-package' };
            if (name === './clock-gates.js') return gate();
            assert.equal(name, './host.js', 'Unexpected module execution');
            return { createHost() { hostCreations++; return { moduleConfig, errorApi: {} }; } };
        } });
        return { run: () => vm.runInContext(prelude, context, { timeout: 1000 }), events, forwarded, requires, moduleConfig,
            counts: () => ({ hostCreations, instantiations }) };
    };
    const wrong = setup('3.15.2');
    assert.throws(wrong.run, /3\.17\.5/);
    assert.deepEqual(wrong.counts(), { hostCreations: 0, instantiations: 0 });
    assert.ok(!wrong.requires.includes('./host.js'));
    assert.equal(wrong.events[0].status, 'blocked');
    const valid = setup('3.17.5'); valid.run();
    assert.deepEqual(valid.counts(), { hostCreations: 1, instantiations: 0 });
    const clock = '[GLX_TRIANGLE_CLOCK] {"frame":1}';
    valid.moduleConfig.print(clock);
    assert.deepEqual(valid.forwarded, [[clock, false]]);
    valid.moduleConfig.ctx.canvas = {};
    assert.throws(() => valid.moduleConfig.print(clock), /GLX context/);
    assert.equal(valid.forwarded.length, 1, 'Invalid context forwarded a CLOCK line');
    const error = 'original stderr ' + 'E'.repeat(5000);
    valid.moduleConfig.print('ordinary stdout'); valid.moduleConfig.printErr(error);
    assert.deepEqual(valid.forwarded.slice(1), [['ordinary stdout', false], [error, true]]);
    assert.equal(valid.events.at(-1).status, 'blocked');
});
