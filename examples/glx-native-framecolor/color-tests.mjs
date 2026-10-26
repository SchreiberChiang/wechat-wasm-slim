import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source text, synthetic integer models, and self-authored gates only.
const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const candidate = () => read(path.join(here, 'main.cpp'));
const baseline = () => read(path.join(here, '../glx-native-validation/main.cpp'));
const phase = frame => Math.floor((frame - 1) / 60) % 3;
const rgb = index => [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]][index];
test('synthetic integer model changes at frames 1/61/121 and repeats at 181 without a clock', () => {
    for (const [frame, expected] of [[1, 0], [60, 0], [61, 1], [120, 1], [121, 2], [180, 2], [181, 0], [241, 1], [301, 2], [361, 0]])
        assert.equal(phase(frame), expected);
    for (let frame = 1; frame <= 10801; frame++) {
        const color = rgb(phase(frame));
        assert.equal(color[3], 1);
        assert.equal(color.slice(0, 3).reduce((sum, value) => sum + value), 1);
        assert.ok(color.every(value => value === 0 || value === 1));
    }
});
test('synthetic per-session budget stops at 180 records and the final record declares exhaustion', () => {
    const records = [];
    let samples = 0;
    for (let frame = 1; frame <= 20000; frame++) {
        if ((frame - 1) % 60 === 0 && samples < 180) {
            samples++;
            records.push({ frame, sampleOrdinal: samples, phaseIndex: phase(frame), budgetExhausted: samples === 180 });
        }
    }
    assert.equal(records.length, 180);
    assert.equal(records[0].frame, 1); assert.equal(records.at(-1).frame, 10741);
    assert.equal(records.filter(record => record.budgetExhausted).length, 1);
    assert.equal(records.at(-1).budgetExhausted, true);
    assert.deepEqual(records.slice(0, 6).map(record => record.phaseIndex), [0, 1, 2, 0, 1, 2]);
});
test('main and original shader logic are unchanged; frame GL call order stays intact', () => {
    const old = baseline(), next = candidate();
    assert.equal(next.slice(next.indexOf('int main() {')), old.slice(old.indexOf('int main() {')));
    const shader = old.slice(old.indexOf('static GLuint shader('), old.indexOf('static void frame() {')).trim();
    assert.ok(next.includes(shader));
    const calls = source => [...source.slice(source.indexOf('static void frame() {'), source.indexOf('int main() {'))
        .matchAll(/\b(gl[A-Z]\w*)\s*\(/g)].map(match => match[1]);
    assert.deepEqual(calls(next), calls(old));
    assert.doesNotMatch(next, /emscripten_get_now\s*\(|emscripten_date_now\s*\(|std::sin\s*\(|glFlush\s*\(|glFinish\s*\(/);
});
test('the marked integer color substitutions are the only native differences from V1', () => {
    const source = candidate();
    const stripped = source
        .replace(/^[ \t]*\/\/ BEGIN COLOR (STATE|FRAME|REPORT)\n[\s\S]*?^[ \t]*\/\/ END COLOR \1\n/gm, '')
        .replace(/^[ \t]*\/\/ BEGIN COLOR VALUES\n[\s\S]*?^[ \t]*\/\/ END COLOR VALUES\n/gm,
            '    const float wave = 0.5f + 0.5f * std::sin(float(emscripten_get_now() / 1000.0));\n')
        .replace('glClearColor(rgb[0], rgb[1], rgb[2], 1.0f);', 'glClearColor(0.03f, 0.08f + wave * 0.25f, 0.12f, 1.0f);');
    assert.equal(stripped, baseline());
    const compact = source.replace(/\s+/g, '');
    assert.ok(compact.includes('constunsignedphase_index=((color_frame-1u)/60u)%3u;'));
    assert.ok(compact.includes('constGLfloatcolors[3][3]={{1.0f,0.0f,0.0f},{0.0f,1.0f,0.0f},{0.0f,0.0f,1.0f}};'));
    assert.ok(compact.includes('constGLfloat*rgb=colors[phase_index];'));
});
test('source emits only phase-boundary records after draw and never resets the 180-record budget', () => {
    const source = candidate(), compact = source.replace(/\s+/g, '');
    const report = source.slice(source.indexOf('// BEGIN COLOR REPORT'), source.indexOf('// END COLOR REPORT'));
    assert.ok(compact.includes('staticunsignedcolor_frame=0;') && compact.includes('staticunsignedcolor_samples=0;'));
    assert.ok(compact.includes('staticconstexprunsignedcolor_sample_limit=180;'));
    assert.equal((source.match(/\+\+color_frame/g) || []).length, 1);
    assert.equal((source.match(/\+\+color_samples/g) || []).length, 1);
    assert.equal((source.match(/color_samples\s*=(?!=)/g) || []).length, 1);
    assert.ok(report.replace(/\s+/g, '').includes('if((color_frame-1u)%60u==0&&color_samples<color_sample_limit){++color_samples;'));
    assert.ok(source.indexOf('glDrawArrays(') < source.indexOf('// BEGIN COLOR REPORT'));
    assert.equal((source.match(/\[GLX_TRIANGLE_COLOR\]/g) || []).length, 1);
    for (const field of ['triangle-frame-color-v1', 'frame', 'sampleOrdinal', 'phaseIndex', 'color', 'rgbaComputed', 'publicContextHandle', 'sampleLimit', 'budgetExhausted'])
        assert.ok(report.includes(field));
    assert.ok(report.includes('color_samples == color_sample_limit ? "true" : "false"'));
    assert.ok(report.includes('const char *names[3] = {"red", "green", "blue"};'));
    assert.ok(report.includes('double(rgb[0]), double(rgb[1]), double(rgb[2]), int(context)'));
});
test('prelude fake host admits only 3.17.5 and gates COLOR before forwarding complete raw lines', () => {
    const preparation = read(path.join(here, 'prepare-host.mjs'));
    const beginning = preparation.indexOf('const preludeTemplate = ') + 'const preludeTemplate = '.length;
    const end = preparation.indexOf('\n    const entry =', beginning);
    assert.ok(beginning >= 'const preludeTemplate = '.length && end > beginning);
    const prelude = vm.runInNewContext('(' + preparation.slice(beginning, end).trim().replace(/;$/, '') + ')', {}, { timeout: 1000 });
    assert.ok(prelude.endsWith('// BEGIN ORIGINAL TRIANGLE.JS BYTES\n'));
    assert.deepEqual(fs.readFileSync(path.join(here, 'clock-gates.cjs')),
        fs.readFileSync(path.join(here, '../glx-native-clock/clock-gates.cjs')));
    const gate = createRequire(import.meta.url)('./clock-gates.cjs');
    const setup = sdk => {
        const summaries = [], forwarded = [];
        let hosts = 0;
        const canvas = {}, metadata = { isWebGL2: true, ctxid: 2, platform: 1 };
        const moduleConfig = { canvas, ctx: { canvas, emscriptenGLX: { ...metadata } }, wxContextGlobal: metadata };
        const session = { host: summary => summaries.push(summary), native: (message, error) => forwarded.push([message, error]) };
        const context = vm.createContext({ GameGlobal: { __nativeTriangleEvidence: session },
            wx: { getSystemInfoSync: () => ({ SDKVersion: sdk }) }, require(name) {
                if (name === './identity.js') return { packageId: 'fake-framecolor-package' };
                if (name === './clock-gates.js') return gate;
                assert.equal(name, './host.js', 'Unexpected module execution');
                return { createHost() { hosts++; return { moduleConfig, errorApi: {} }; } };
            } });
        return { run: () => vm.runInContext(prelude, context, { timeout: 1000 }), moduleConfig, summaries, forwarded, hostCount: () => hosts };
    };
    const wrong = setup('3.15.2'); assert.throws(wrong.run, /3\.17\.5/);
    assert.equal(wrong.hostCount(), 0); assert.equal(wrong.summaries[0].status, 'blocked');
    const valid = setup('3.17.5'); valid.run();
    const line = '[GLX_TRIANGLE_COLOR] {"frame":1,"color":"red"}';
    valid.moduleConfig.print(line);
    assert.deepEqual(valid.forwarded, [[line, false]]);
    valid.moduleConfig.ctx.canvas = {};
    assert.throws(() => valid.moduleConfig.print(line), /GLX context/);
    assert.equal(valid.forwarded.length, 1);
    const error = 'original error ' + 'E'.repeat(5000);
    valid.moduleConfig.print('ordinary stdout'); valid.moduleConfig.printErr(error);
    assert.deepEqual(valid.forwarded.slice(1), [['ordinary stdout', false], [error, true]]);
});
