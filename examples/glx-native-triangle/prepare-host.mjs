import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Pure file preparation: never imports/evaluates adapter, generated JS, or WASM.
const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i], value = process.argv[i + 1];
    if (!['--build-dir', '--upstream', '--out'].includes(name) || args.has(name) || !value)
        throw Error('Use --build-dir ABSOLUTE_PATH --upstream ABSOLUTE_PATH --out NEW_ABSOLUTE_PATH.');
    if (!path.isAbsolute(value)) throw Error(name + ' must be absolute.');
    args.set(name, value);
}
if (args.size !== 3) throw Error('All of --build-dir, --upstream, --out are required.');
const input = args.get('--build-dir');
const author = args.get('--upstream');
const output = args.get('--out');
if (fs.existsSync(output)) throw Error('Output already exists; refusing to overwrite.');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const js = fs.readFileSync(path.join(input, 'triangle.js'));
const wasm = fs.readFileSync(path.join(input, 'triangle.wasm'));
// Two audited pairs only. 05 reproduces its known Safari shim failure;
// normal preparation uses corrected 06. Selection never retries another pair.
const auditedPairs = [
    { label: 'build-05-known-safari-shim-failure',
      js: 'ee7395a473a791aabbb05fba7eb9e1860e1d6130010c088000e04066bf3c2816',
      wasm: '1f67ed7160c6d8550c1f7ffc4dad30bcd5cc072604a47f82bb001954c8b8f52a' },
    { label: 'build-06-safari-shim-disabled',
      js: 'bb0c6c827293ae1d60e0fc9693056cb778af4a57df156926f985b6cc474d35f4',
      wasm: '1f67ed7160c6d8550c1f7ffc4dad30bcd5cc072604a47f82bb001954c8b8f52a' }
];
const expected = auditedPairs.find(pair => sha(js) === pair.js && sha(wasm) === pair.wasm);
if (!expected) throw Error('Pinned JS/WASM pair mismatch.');
if (wasm.subarray(0, 8).toString('hex') !== '0061736d01000000') throw Error('Invalid WASM header.');
const adapter = fs.readFileSync(path.join(author, 'weapp-adapter.js'));
if (sha(adapter) !== '84c679ae0a6dbb226afb24110860e5142ac113a2e3a00a93449a09edeb4647f6')
    throw Error('Author adapter hash mismatch.');
const host = fs.readFileSync(path.join(here, 'host-template.cjs'));
const preludeTemplate = '// Local audited host prelude; original compiler output begins after marker.\n' +
    'var __triangleIdentity = __IDENTITY_JSON__;\n' +
    'var __triangleHost = require("./host.js").createHost(GameGlobal, wx, __triangleIdentity, function(summary) { console.log("[native-triangle-host] " + JSON.stringify(summary)); });\n' +
    'var Module = __triangleHost.moduleConfig;\n' +
    'var WebAssembly = __triangleHost.errorApi;\n' +
    'Object.defineProperty(Module, "HEAPU8", { get: function() { return HEAPU8; } });\n' +
    '// BEGIN ORIGINAL TRIANGLE.JS BYTES\n';
const entry = Buffer.from("require('./weapp-adapter.js');\nrequire('./triangle-hosted.js');\n");
const game = Buffer.from(JSON.stringify({ deviceOrientation: 'portrait', iOSHighPerformance: true,
    'iOSHighPerformance+': true }, null, 2) + '\n');
const identityInputs = { jsSha256: expected.js, wasmSha256: expected.wasm,
    hostSha256: sha(host), preludeTemplateSha256: sha(preludeTemplate),
    generatorSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    adapterSha256: sha(adapter), gameEntrySha256: sha(entry), gameConfigSha256: sha(game) };
const identity = { packageId: 'native-triangle-' + sha(JSON.stringify(identityInputs)), ...identityInputs };
const prelude = Buffer.from(preludeTemplate.replace('__IDENTITY_JSON__', JSON.stringify(identity)));
const files = { 'game.js': entry, 'game.json': game, 'host.js': host, 'weapp-adapter.js': adapter,
    'triangle-hosted.js': Buffer.concat([prelude, js]), 'triangle.wasm': wasm };
const manifest = {
    schema: 1, status: 'host-prepared-not-run', identity, directoryLabel: path.basename(output),
    auditedPair: expected.label,
    preludeSha256: sha(prelude), preludeTemplateSha256: sha(preludeTemplate),
    originalBuild: path.join(input, 'BUILD.json'),
    deviceValidation: 'NOT_RUN', generatedCodeExecution: 'NOT_RUN',
    adapterSource: path.join(author, 'weapp-adapter.js'), adapterSha256: sha(adapter),
    adapterPolicy: 'copied byte-for-byte; not executed during preparation',
    originalJsOffset: prelude.length, originalJsLength: js.length,
    originalJsSuffixSha256: sha(files['triangle-hosted.js'].subarray(prelude.length)),
    heapDependencyAudit: {
        literalModuleHeapReferences: [...new Set(js.toString().match(/Module(?:\.HEAP[A-Z0-9]+|\[["']HEAP[A-Z0-9]+["']\])/g))],
        allBracketModuleReferences: [...new Set(js.toString().match(/Module\[[^\]]+\]/g))].sort(),
        moduleOverridesPresent: js.includes(Buffer.from('moduleOverrides')),
        getter: 'non-enumerable same-scope live local HEAPU8; Object.assign override copying does not replace it'
    },
    changes: [
        'game.js: require original adapter before hosted JS; no Godot loader or engine SDK',
        'game.json: retain author orientation/performance flags; omit engine subpackages/plugins',
        'host.js: local capability gate, explicit GLX pin, Module config and one summary',
        'triangle-hosted.js: prepended Module/RuntimeError namespace binding; original JS bytes unchanged',
        'Module.HEAPU8: live getter to original local HEAPU8, matching author exposed heap needed by GLX imports',
        'summary: compare Module.ctx.emscriptenGLX with metadata and canvas, unknown if actual current context absent',
        'canvas.id=canvas: allow author querySelector to resolve native #canvas target',
        'instantiateWasm: WX namespace local path, microtask scheduling and callback; no fallback/retry',
        'triangle.wasm and weapp-adapter.js: unchanged copied bytes'
    ],
    sources: [
        'author weapp-adapter.js:52-99 global injection;192-200 canvas/RAF;610-628 wx.createCanvas;706-715 querySelector',
        'author engine/godot.js:549-563 instantiateWasm local-path/callback contract',
        'author godot-loader.js:104-112 capability/mode/context selection, used as source only, never copied/executed',
        'triangle.js: existing Module.instantiateWasm and run dependency; strict-post from original pinned build',
        'author engine/godot.js updateMemoryViews: exports Module.HEAPU8; triangle output omits that export',
        'triangle.js GL.makeContextCurrent: assigns actual GLctx to Module.ctx'
    ],
    limitations: [
        'WXWebAssembly namespace binding is local explicit adaptation, not copied author code; needs real host validation',
        'Original abort calls onAbort first; if RuntimeError is absent, subsequent original throw may be TypeError; no added startup gate',
        'Package hashes verified locally at preparation; no runtime crypto or byte verification in WeChat',
        'Removes both Godot renderer and loading-page context/handoff; not a single-factor Godot exclusion',
        'Original source depends on default framebuffer; alpha/default attributes and depth=false differ from loader',
        'No project AppID/config, preview, upload, retry, renderer fallback, forced swap, flush or added frame delay',
        'One postRun initialization snapshot: later errors do not update it; no proof of first-frame flush, pixels or lifecycle stability'
    ],
    files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) }))
};
fs.mkdirSync(output, { recursive: false });
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
fs.writeFileSync(path.join(output, 'HOST_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, status: manifest.status, files: manifest.files.length,
    originalJsSuffixSha256: manifest.originalJsSuffixSha256 }));
