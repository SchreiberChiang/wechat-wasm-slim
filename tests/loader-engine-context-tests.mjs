import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {TERMINAL_LOADER_SHA256, DEFERRED_PROPERTY, sha256, patchLoaderEngineContext, writeLoaderEngineContext} from '../engine/loader-engine-context.mjs';

// Only SHA-pinned loader text runs with fake APIs. No adapter, engine, WASM,
// real graphics, downloads, network, WeChat or device is loaded by these tests.
function harness(source, {capability = true, disableGLX = false} = {}) {
  const trace = [], images = [], raf = [], listeners = new Map();
  let progressCallback, packageSuccess, serial = 0, phase = 'loader', main, off;
  const value = x => x === main ? '<main-canvas>' : x === off ? '<off-canvas>' : ArrayBuffer.isView(x) ? Array.from(x) : x && typeof x === 'object' ? x.fakeId || '<object>' : x;
  const record = (kind, name, args = []) => trace.push([kind, name, ...Array.from(args, value)]);
  const methods = new Set(['createShader','shaderSource','compileShader','getShaderParameter','getShaderInfoLog','createProgram','attachShader','linkProgram','getProgramParameter','getProgramInfoLog','getAttribLocation','createBuffer','bindBuffer','bufferData','createTexture','bindTexture','texParameteri','viewport','texImage2D','useProgram','enableVertexAttribArray','vertexAttribPointer','drawArrays','flush','commit','deleteProgram','deleteBuffer','deleteTexture','disable','clearColor','clear']);
  const gl = new Proxy({}, {get(target, key) {
    if (key === 'canvas') return main;
    if (/^[A-Z_0-9]+$/.test(String(key))) return key;
    if (!methods.has(key)) throw Error('Unsupported fake GL member: ' + String(key));
    return (...args) => {
      record('gl', key, args);
      if (key.startsWith('create')) return {fakeId: key + ':' + ++serial};
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return true;
      if (key === 'getAttribLocation') return args[1] === 'a_position' ? 0 : 1;
    };
  }});
  const draw2d = new Proxy({}, {get(target, key) {return key in target ? target[key] : (...args) => record('2d', key, args);}, set(target, key, x) {record('2d-write', key, [x]); target[key] = x; return true;}});
  function canvas(label) {
    let width = 0, height = 0;
    const object = {style: new Proxy({}, {set(target, key, x) {record('canvas-write', label + '.style.' + String(key), [x]); target[key] = x; return true;}}),
      getContext(type, attrs) {
        record('context', label + '.' + type, [JSON.stringify(attrs), phase]);
        if (label === 'main') {assert.equal(type, capability && !disableGLX ? 'wxwebgl2' : 'webgl2'); return gl;}
        assert.equal(type, '2d'); return draw2d;
      }};
    for (const key of ['width', 'height']) Object.defineProperty(object, key, {get: () => key === 'width' ? width : height,
      set(x) {record('canvas-write', label + '.' + key, [x]); if (key === 'width') width = x; else height = x;}});
    return object;
  }
  main = canvas('main'); off = canvas('off');
  const window = {devicePixelRatio: 2, innerWidth: 320, innerHeight: 640,
    addEventListener(name, handler) {record('event', 'add:' + name); listeners.set(name, handler);},
    removeEventListener(name, handler) {record('event', 'remove:' + name); if (listeners.get(name) === handler) listeners.delete(name);},
    requestAnimationFrame(callback) {record('schedule', 'RAF'); raf.push(callback); return raf.length;}};
  const wx = {env: {isSupportEmscriptenGLX: capability}, getWindowInfo: () => ({windowWidth: 320, windowHeight: 640, pixelRatio: 2}),
    loadSubpackage(options) {record('download', options.name); assert.equal(options.name, 'engine'); packageSuccess = options.success;
      return {onProgressUpdate(callback) {progressCallback = callback;}};}};
  class Image {constructor() {this.width = 400; this.height = 200; images.push(this);} set src(x) {record('image', 'src', [x]); this.source = x;} get src() {return this.source;}}
  const root = disableGLX ? {__GODOT_DISABLE_WXGLX: true} : {};
  const context = vm.createContext({GameGlobal: root, window, wx, Image,
    document: {createElement(type) {assert.equal(type, 'canvas'); record('canvas', 'create-offscreen'); return off;}},
    console: {log() {}, warn() {}, error(...args) {throw Error('Unexpected fake loader error: ' + args.join(' '));}}});
  vm.runInContext(source, context, {filename: 'SHA-pinned-terminal-loader-fake-only.js', timeout: 1000});
  const config = {textConfig: {firstStartText: 'first', initText: 'init', downloadingText: ['download'], style: {fontSize: 14, color: 'white'}},
    barConfig: {style: {width: 240, height: 25, borderRadius: 20, padding: 2, backgroundColor: 'black', foregroundColor: 'green'}},
    iconConfig: {visible: true, style: {width: 74, height: 30, bottom: 20}}, materialConfig: {backgroundImage: 'images/background.jpg', iconImage: 'images/logo.png'}};
  const loader = new root.GodotLoader(main, config);
  return {trace, loader, root, gl, images, raf, listeners,
    progress(value) {progressCallback({progress: value});}, success() {packageSuccess();},
    engineTakeover() {phase = 'fake-engine'; const result = main.getContext('wxwebgl2', {explicitSwapControl: false}); phase = 'loader'; return result;}};
}
const gpu = trace => trace.filter(x => ['gl', 'context', '2d', '2d-write'].includes(x[0]));
const effects = trace => trace.filter(x => ['gl', 'context', '2d', '2d-write', 'canvas-write'].includes(x[0]));
const resources = trace => trace.filter(x => x[0] === 'gl' && ['createShader', 'createProgram', 'createBuffer', 'createTexture'].includes(x[1]));
const drain = h => {for (const fn of h.raf.splice(0)) fn();};

export function runLoaderEngineContextTests(source) {
  assert.equal(sha256(source), TERMINAL_LOADER_SHA256);
  const patched = patchLoaderEngineContext(source);
  assert.throws(() => patchLoaderEngineContext(source + '\n'), /Unknown terminal loader SHA256/);
  assert.throws(() => patchLoaderEngineContext('unknown'), /Unknown terminal loader SHA256/);
  assert.throws(() => patchLoaderEngineContext(patched), /already present/);
  assert.throws(() => patchLoaderEngineContext(Buffer.from(source)), /UTF-8 string/);
  const added = /\r?\n            if \(useWXGLX\) \{\r?\n                this\.gl = null;\r?\n                this\.__wxslimGLXContextDeferred = true;\r?\n                return;\r?\n            \}/g;
  assert.equal([...patched.matchAll(added)].length, 1);
  assert.equal(patched.replace(added, ''), source, 'single inserted GLX branch is the complete patch');
  let scenarios = 1;
  const original = harness(source), fixed = harness(patched);
  for (const name of ['createShader', 'createBuffer', 'createTexture']) assert.ok(resources(original.trace).some(x => x[1] === name), 'baseline really allocates ' + name);
  assert.equal(gpu(fixed.trace).length, 0, 'deferred loader has no main/offscreen context acquisition or GPU calls');
  assert.equal(fixed.loader.gl, null); assert.equal(fixed.loader[DEFERRED_PROPERTY], true);
  assert.equal(fixed.root.__godotMinigameWXGLXEnabled, true);
  for (const kind of ['image', 'download', 'event', 'canvas-write']) assert.deepEqual(fixed.trace.filter(x => x[0] === kind), original.trace.filter(x => x[0] === kind), kind + ' contract preserved');
  assert.deepEqual(fixed.trace.filter(x => x[0] === 'image').map(x => x[2]), ['images/background.jpg', 'images/logo.png']);
  assert.ok(fixed.trace.findIndex(x => x[0] === 'image') < fixed.trace.findIndex(x => x[0] === 'download'));
  scenarios++;
  fixed.images[0].onload(); fixed.progress(25); drain(fixed); fixed.listeners.get('resize')(); fixed.success();
  assert.equal(fixed.loader.progress, 1); assert.equal(fixed.loader.currentText, 'init');
  assert.equal(gpu(fixed.trace).length, 0, 'late image/progress/success/resize do not acquire a loader context');
  const queuedResize = fixed.listeners.get('resize');
  fixed.progress(75); const queuedRaf = fixed.raf.splice(0);
  fixed.loader.cleanup(); assert.equal(fixed.loader.__wxslimLoaderTerminal, true); assert.equal(fixed.listeners.has('resize'), false);
  const beforeTakeover = fixed.trace.length;
  assert.equal(fixed.engineTakeover(), fixed.gl);
  const context = fixed.trace.filter(x => x[0] === 'context');
  assert.equal(context.length, 1); assert.equal(context[0][1], 'main.wxwebgl2'); assert.equal(context[0][3], 'fake-engine');
  assert.equal(fixed.trace[beforeTakeover][0], 'context', 'first canvas context is acquired only by simulated engine');
  const beforeLate = fixed.trace.length;
  fixed.images[1].onload(); fixed.progress(99); fixed.success(); queuedResize(); for (const fn of queuedRaf) fn(); drain(fixed); fixed.loader.cleanup();
  assert.equal(effects(fixed.trace.slice(beforeLate)).length, 0, 'callbacks after cleanup cannot touch engine-owned canvas or GL');
  assert.equal(fixed.loader.gl, null, 'no fake equality with the engine-owned context');
  scenarios++;
  // Both explicit WebGL selection and capability-unavailable WebGL preserve the
  // complete baseline trace, including resources, downloads and first cleanup.
  for (const options of [{capability: false}, {capability: true, disableGLX: true}]) {
    const a = harness(source, options), b = harness(patched, options);
    assert.deepEqual(b.trace, a.trace);
    assert.equal(b.root.__godotMinigameWXGLXEnabled, false); assert.equal(b.loader[DEFERRED_PROPERTY], undefined);
    for (const h of [a, b]) {h.images[0].onload(); h.progress(25); drain(h); h.listeners.get('resize')(); h.success();}
    assert.deepEqual(b.trace, a.trace);
    const resize = [a.listeners.get('resize'), b.listeners.get('resize')];
    a.loader.cleanup(); b.loader.cleanup(); assert.deepEqual(b.trace, a.trace);
    for (const [i, h] of [a, b].entries()) {h.images[1].onload(); h.progress(75); drain(h); resize[i](); h.loader.cleanup();}
    assert.deepEqual(b.trace, a.trace, 'WebGL complete before/after-cleanup trace unchanged');
    scenarios++;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-engine-context-contract-'));
  try {
    const sourcePath = path.join(temp, 'terminal.js'); fs.writeFileSync(sourcePath, source);
    const outputPath = path.join(temp, 'owned', 'loader.js');
    const record = writeLoaderEngineContext({sourcePath, outputPath});
    assert.equal(record.parentTerminalSha256, TERMINAL_LOADER_SHA256); assert.equal(record.phoneValidation, 'NOT_PHONE_VERIFIED');
    assert.equal(record.generatorSha256, sha256(fs.readFileSync(fileURLToPath(new URL('../engine/loader-engine-context.mjs', import.meta.url)))));
    assert.equal(fs.readFileSync(outputPath, 'utf8'), patched);
    const written = fs.readFileSync(outputPath);
    assert.throws(() => writeLoaderEngineContext({sourcePath, outputPath}), /refusing overwrite/);
    assert.deepEqual(fs.readFileSync(outputPath), written);
    const manifestOnly = path.join(temp, 'owned', 'other-loader.js');
    assert.throws(() => writeLoaderEngineContext({sourcePath, outputPath: manifestOnly}), /refusing overwrite/);
    assert.equal(fs.existsSync(manifestOnly), false);
    const unknownSource = path.join(temp, 'unknown.js'); fs.writeFileSync(unknownSource, 'unknown');
    const refusedOutput = path.join(temp, 'refused', 'loader.js');
    assert.throws(() => writeLoaderEngineContext({sourcePath: unknownSource, outputPath: refusedOutput}), /Unknown terminal loader SHA256/);
    assert.equal(fs.existsSync(path.dirname(refusedOutput)), false, 'unknown input refuses before creating output directories');
    const repeatedOutput = path.join(temp, 'repeat', 'loader.js');
    assert.throws(() => writeLoaderEngineContext({sourcePath: outputPath, outputPath: repeatedOutput}), /already present/);
    assert.equal(fs.existsSync(path.dirname(repeatedOutput)), false);
    assert.throws(() => writeLoaderEngineContext({sourcePath: 'relative.js', outputPath: refusedOutput}), /absolute/);
    scenarios++;
  } finally {
    const resolvedTemp = fs.realpathSync(temp), tempParent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolvedTemp), tempParent, 'cleanup stays within the observed temporary directory');
    assert.ok(path.basename(resolvedTemp).startsWith('loader-engine-context-contract-'));
    fs.rmSync(resolvedTemp, {recursive: true, force: true});
  }
  return {status: 'PASS', scenarios, sourceSha256: TERMINAL_LOADER_SHA256, patchedSha256: sha256(patched),
    scope: 'SHA-pinned loader in fake wx/Image/RAF/canvas/GL only; simulated engine context acquisition',
    baselineAllocatedResources: resources(original.trace).map(x => x[1]), deferredLoaderGpuCalls: 0,
    engineAdapterWasmNetworkDevice: 'NOT_RUN', phoneValidation: 'NOT_PHONE_VERIFIED', rootCause: 'NOT_PROVEN'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--source' || !path.isAbsolute(process.argv[3]))
    throw Error('Use node tests/loader-engine-context-tests.mjs --source ABSOLUTE_SHA_PINNED_TERMINAL_LOADER');
  console.log(JSON.stringify(runLoaderEngineContextTests(fs.readFileSync(process.argv[3], 'utf8'))));
}
