import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalSha = bytes => sha(bytes.toString('utf8').replace(/\r\n/g, '\n'));
export function options(argv, names) {
    const result = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i], value = argv[i + 1];
        if (!names.includes(key) || Object.hasOwn(result, key) || !value || !path.isAbsolute(value))
            throw Error('Expected unique absolute-path options: ' + names.join(' '));
        result[key] = value;
    }
    if (Object.keys(result).length !== names.length) throw Error('Missing required options: ' + names.join(' '));
    return result;
}

// Compile/decode only: never instantiate the WASM or evaluate generated JS.
export function auditBuild(buildDir) {
    const pin = JSON.parse(fs.readFileSync(path.join(here, 'PINNED_PAIR.json'), 'utf8'));
    const recordBytes = fs.readFileSync(path.join(buildDir, 'BUILD.json'));
    const record = JSON.parse(recordBytes);
    const js = fs.readFileSync(path.join(buildDir, 'triangle.js'));
    const wasm = fs.readFileSync(path.join(buildDir, 'triangle.wasm'));
    assert.equal(record.status, 'compiled-not-run');
    assert.equal(record.emscripten, '4.0.10');
    assert.equal(sha(js), pin.jsSha256, 'Pinned JS mismatch');
    assert.equal(sha(wasm), pin.wasmSha256, 'Pinned WASM mismatch');
    for (const [name, bytes] of [['triangle.js', js], ['triangle.wasm', wasm]])
        assert.equal(record.outputs.find(item => item.name === name)?.sha256, sha(bytes), 'Build/output mismatch');
    assert.equal(fs.readFileSync(path.join(record.sdk, 'upstream/emscripten/emscripten-version.txt'), 'utf8').trim().replaceAll('"', ''), '4.0.10');
    assert.equal(record.librarySha256, pin.librarySha256);
    assert.equal(sha(fs.readFileSync(record.library)), pin.librarySha256);
    assert.equal(record.contextPatchSha256, pin.contextPatchSha256);
    assert.equal(sha(fs.readFileSync(record.contextPatch)), pin.contextPatchSha256);
    const source = fs.readFileSync(path.join(here, 'main.cpp'));
    const recipe = fs.readFileSync(path.join(here, '../glx-native-triangle/build.ps1'));
    const strict = fs.readFileSync(path.join(here, '../glx-native-triangle/strict-post.js'));
    assert.equal(record.sourceSha256, sha(source), 'Live source differs from build');
    assert.equal(record.sourceSha256, pin.sourceSha256, 'Unreviewed source');
    assert.equal(record.recipeSha256, sha(recipe), 'Live recipe differs from build');
    assert.equal(record.strictPostSha256, sha(strict), 'Live strict-post differs from build');
    assert.equal(canonicalSha(recipe), pin.recipeCanonicalSha256);
    assert.equal(canonicalSha(strict), pin.strictPostCanonicalSha256);
    assert.equal(path.resolve(record.arguments[0]), path.resolve(here, 'main.cpp'));
    assert.equal(path.resolve(record.arguments[1]), path.resolve(record.library));
    for (const flag of ['-sMIN_WEBGL_VERSION=2', '-sMAX_WEBGL_VERSION=2', '-sOFFSCREEN_FRAMEBUFFER=0',
        '-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0', '-sGL_ENABLE_GET_PROC_ADDRESS=0', '-Wl,--thinlto-jobs=1'])
        assert.ok(record.arguments.includes(flag), 'Missing required flag: ' + flag);
    const baseline = fs.readFileSync(path.join(here, '../glx-native-contrast/main.cpp'), 'utf8').replace(/\r\n/g, '\n');
    const candidate = source.toString('utf8').replace(/\r\n/g, '\n');
    let restored = candidate;
    for (const label of ['STATE', 'FRAME', 'VALUES', 'REPORT']) {
        const block = new RegExp('^[ \\t]*// BEGIN CLOCK ' + label + '\\n[\\s\\S]*?^[ \\t]*// END CLOCK ' + label + '\\n', 'gm');
        assert.equal([...restored.matchAll(block)].length, 1, 'Exactly one clock block required: ' + label);
        restored = restored.replace(block, label === 'VALUES'
            ? '    const float wave = 0.5f + 0.5f * std::sin(float(emscripten_get_now() / 1000.0));\n' : '');
    }
    assert.equal(restored, baseline, 'Changes outside bounded observations; clock/color/submit must remain inherited');
    assert.ok(js.includes(Buffer.from('_emscripten_date_now=()=>Date.now()')), 'Reference clock must call Date.now in the pinned SDK');
    for (const token of ['getContextSafariWebGL2Fixed', 'fixedGetContext', 'WebGLRenderingContext'])
        assert.ok(!js.includes(Buffer.from(token)), 'Unexpected browser shim: ' + token);
    assert.ok(wasm.includes(Buffer.from('[GLX_TRIANGLE_SHADER]')));
    assert.ok(wasm.includes(Buffer.from('created-before-source')));
    assert.ok(wasm.includes(Buffer.from('first-compile-failure')));
    assert.ok(wasm.includes(Buffer.from('[GLX_TRIANGLE_CLOCK]')));
    const module = new WebAssembly.Module(wasm);
    const exports = WebAssembly.Module.exports(module);
    const imports = WebAssembly.Module.imports(module);
    const nativeMappings = {};
    for (const name of ['glxInit', 'glxInitBufferDataAndGlState', 'glxUpdateContextId', 'glxCommandBufferFlush']) {
        const match = js.toString('utf8').match(new RegExp('_' + name + '=wasmExports\\["([^"]+)"\\]'));
        assert.ok(match, 'Missing JS mapping: ' + name);
        assert.ok(exports.some(item => item.kind === 'function' && item.name === match[1]), 'Missing WASM export: ' + name);
        nativeMappings[name] = match[1];
    }
    const report = { status: 'static-validated-not-instantiated', jsSha256: sha(js), wasmSha256: sha(wasm),
        jsBytes: js.length, wasmBytes: wasm.length, buildRecordSha256: sha(recordBytes),
        sourceSha256: sha(source), librarySha256: pin.librarySha256, contextPatchSha256: pin.contextPatchSha256,
        nativeMappings, imports: imports.length, exports: exports.length,
        baselineExceptClockObservationsEqual: true, mainAndShaderUnchanged: true,
        originalClockColorAndSubmitPreserved: true, sampledFrames: [1, 61], maxClockSamples: 2,
        referenceClock: 'emscripten_date_now -> Date.now; reference only, not the color driver',
        generatedJsExecution: 'NOT_RUN', wasmInstantiation: 'NOT_RUN',
        deviceValidation: 'NOT_RUN', shaderRuntimeResults: 'NOT_OBSERVED' };
    return { report, js, wasm };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = options(process.argv.slice(2), ['--build-dir', '--out']);
    const { report } = auditBuild(args['--build-dir']);
    fs.writeFileSync(args['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report));
}
