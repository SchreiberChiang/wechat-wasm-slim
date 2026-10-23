import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {AUTHOR_LOADER_SHA256, TERMINAL_PROPERTY, sha256, patchLoaderTerminal} from '../engine/loader-terminal.mjs';

// Explicit author source is required; no private path or vendored loader fixture.
// Only this SHA-pinned loader runs, with fake wx/Image/RAF/canvas/GL. Never loads
// adapter, engine glue, WASM, network, WeChat, or a device.
function harness(source) {
  const trace = [], images = [], raf = [], listeners = new Map();
  let progressCallback, packageSuccess, serial = 0;
  let main, off;
  const value = x => {
    if (x === main) return '<main-canvas>';
    if (x === off) return '<off-canvas>';
    if (ArrayBuffer.isView(x)) return Array.from(x);
    if (x && typeof x === 'object') return x.fakeId || '<object>';
    return x;
  };
  const record = (kind, name, args = []) => trace.push([kind, name, ...Array.from(args, value)]);
  const methods = new Set(['createShader', 'shaderSource', 'compileShader', 'getShaderParameter', 'getShaderInfoLog',
    'deleteShader', 'createProgram', 'attachShader', 'linkProgram', 'getProgramParameter', 'getProgramInfoLog',
    'getAttribLocation', 'createBuffer', 'bindBuffer', 'bufferData', 'createTexture', 'bindTexture', 'texParameteri',
    'viewport', 'texImage2D', 'useProgram', 'enableVertexAttribArray', 'vertexAttribPointer', 'drawArrays',
    'flush', 'commit', 'deleteProgram', 'deleteBuffer', 'deleteTexture', 'disable', 'clearColor', 'clear']);
  const gl = new Proxy({}, {get(target, key) {
    if (key === 'canvas') return main;
    if (/^[A-Z_0-9]+$/.test(String(key))) return key;
    if (!methods.has(key)) throw new Error('Fake GL unsupported member: ' + String(key));
    return (...args) => {
      record('gl', key, args);
      if (key.startsWith('create')) return {fakeId: key + ':' + ++serial};
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return true;
      if (key === 'getAttribLocation') return args[1] === 'a_position' ? 0 : 1;
    };
  }});
  const draw2d = new Proxy({}, {get(target, key) {
    if (key in target) return target[key];
    return (...args) => record('2d', key, args);
  }, set(target, key, x) {record('2d-write', key, [x]); target[key] = x; return true;}});
  function canvas(label) {
    let width = 0, height = 0;
    const object = {style: new Proxy({}, {set(target, key, x) {
      record('canvas-write', label + '.style.' + String(key), [x]); target[key] = x; return true;
    }}), getContext(type, attrs) {
      record('context', label + '.' + type, [JSON.stringify(attrs)]);
      if (label === 'main') {assert.equal(type, 'wxwebgl2'); return gl;}
      assert.equal(type, '2d'); return draw2d;
    }};
    for (const key of ['width', 'height']) Object.defineProperty(object, key, {
      get: () => key === 'width' ? width : height,
      set(x) {record('canvas-write', label + '.' + key, [x]); if (key === 'width') width = x; else height = x;}
    });
    return object;
  }
  main = canvas('main'); off = canvas('off');
  const window = {devicePixelRatio: 2, innerWidth: 320, innerHeight: 640,
    addEventListener(name, handler) {record('event', 'add:' + name); listeners.set(name, handler);},
    removeEventListener(name, handler) {record('event', 'remove:' + name); if (listeners.get(name) === handler) listeners.delete(name);},
    requestAnimationFrame(callback) {record('schedule', 'RAF'); raf.push(callback); return raf.length;}};
  const wx = {env: {isSupportEmscriptenGLX: true},
    getWindowInfo: () => ({windowWidth: 320, windowHeight: 640, pixelRatio: 2}),
    loadSubpackage(options) {
      record('download', options.name); assert.equal(options.name, 'engine'); packageSuccess = options.success;
      return {onProgressUpdate(callback) {progressCallback = callback;}};
    }};
  class Image {
    constructor() {this.width = 400; this.height = 200; images.push(this);}
    set src(x) {record('image', 'src', [x]); this.source = x;}
    get src() {return this.source;}
  }
  const root = {};
  const context = vm.createContext({GameGlobal: root, window, wx, Image,
    document: {createElement(type) {assert.equal(type, 'canvas'); record('canvas', 'create-offscreen'); return off;}},
    console: {log() {}, warn() {}, error(...args) {throw Error('Unexpected fake loader error: ' + args.join(' '));}}});
  vm.runInContext(source, context, {filename: 'SHA-pinned-author-loader-fake-only.js'});
  const config = {textConfig: {firstStartText: 'first', initText: 'init', downloadingText: ['download'], style: {fontSize: 14, color: 'white'}},
    barConfig: {style: {width: 240, height: 25, borderRadius: 20, padding: 2, backgroundColor: 'black', foregroundColor: 'green'}},
    iconConfig: {visible: true, style: {width: 74, height: 30, bottom: 20}},
    materialConfig: {backgroundImage: 'images/background.jpg', iconImage: 'images/logo.png'}};
  const loader = new root.GodotLoader(main, config);
  return {trace, loader, gl, images, raf, listeners, root,
    progress(progress) {progressCallback({progress});}, success() {packageSuccess();}};
}
const sideEffects = trace => trace.filter(x => ['gl', 'canvas-write', '2d', '2d-write', 'context'].includes(x[0]));
export function runLoaderTerminalTests(source) {
  assert.equal(sha256(source), AUTHOR_LOADER_SHA256);
  const patched = patchLoaderTerminal(source);
  assert.throws(() => patchLoaderTerminal(source + '\n'), /Unknown author loader SHA256/);
  assert.throws(() => patchLoaderTerminal(patched), /already present/);
  assert.throws(() => patchLoaderTerminal('unknown source'), /Unknown author loader SHA256/);
  // Removing only the four inserted statements must restore exact author bytes.
  const restored = patched.replace(new RegExp('            if \\(this\\.' + TERMINAL_PROPERTY + '\\) return;\\r?\\n', 'g'), '')
    .replace(new RegExp('            this\\.' + TERMINAL_PROPERTY + ' = true;\\r?\\n'), '');
  assert.equal(restored, source);
  let scenarios = 1;
  const original = harness(source), fixed = harness(patched);
  assert.deepEqual(fixed.trace, original.trace, 'constructor behavior and original download order');
  const order = original.trace;
  const at = (kind, name) => order.findIndex(x => x[0] === kind && x[1] === name);
  assert.ok(at('canvas', 'create-offscreen') < at('context', 'main.wxwebgl2'));
  assert.ok(at('context', 'main.wxwebgl2') < at('image', 'src'));
  assert.ok(at('image', 'src') < at('canvas-write', 'main.width'));
  assert.ok(at('canvas-write', 'main.width') < at('event', 'add:resize'));
  assert.ok(at('event', 'add:resize') < at('download', 'engine'));
  assert.equal(fixed.root.__godotMinigameWXGLXEnabled, true);
  for (const h of [original, fixed]) {
    h.images[0].onload(); h.progress(25); h.raf.shift()(); h.listeners.get('resize')(); h.success();
  }
  assert.deepEqual(fixed.trace, original.trace, 'image/progress/RAF/resize/download success before cleanup');
  const queuedResize = [original.listeners.get('resize'), fixed.listeners.get('resize')];
  const before = [original.trace.length, fixed.trace.length];
  original.loader.cleanup(); fixed.loader.cleanup();
  assert.deepEqual(fixed.trace.slice(before[1]), original.trace.slice(before[0]), 'first cleanup preserves every original GPU operation/order');
  assert.deepEqual(fixed.trace.slice(before[1]).filter(x => x[0] === 'gl').map(x => x[1]),
    ['deleteProgram', 'deleteBuffer', 'deleteBuffer', 'deleteTexture', 'bindBuffer', 'bindTexture', 'useProgram',
      'disable', 'disable', 'disable', 'viewport', 'clearColor', 'clear']);
  assert.equal(fixed.loader.gl, fixed.gl, 'context retained for existing observer');
  scenarios++;
  const lateCases = [
    ['late image.onload', h => h.images[1].onload()],
    ['late progress sync', h => h.progress(75)],
    ['already queued RAF', h => {const jobs = h.raf.splice(0); assert.ok(jobs.length); for (const job of jobs) job();}],
    ['already queued resize', (h, index) => queuedResize[index]()],
    ['repeated cleanup', h => h.loader.cleanup()]
  ];
  const risk = [];
  for (const [name, action] of lateCases) {
    const start = [original.trace.length, fixed.trace.length];
    action(original, 0); action(fixed, 1);
    const oldEffects = sideEffects(original.trace.slice(start[0]));
    const fixedEffects = sideEffects(fixed.trace.slice(start[1]));
    assert.ok(oldEffects.some(x => x[0] === 'gl'), name + ': original reproduces post-cleanup GPU calls');
    assert.equal(fixedEffects.length, 0, name + ': patched makes no GPU or canvas/2D side effect');
    risk.push({case: name, originalGpuCalls: oldEffects.filter(x => x[0] === 'gl').length,
      originalCanvasWrites: oldEffects.filter(x => x[0] === 'canvas-write').length, patchedSideEffects: 0});
    scenarios++;
  }
  return {status: 'PASS', scenarios, sourceSha256: AUTHOR_LOADER_SHA256, patchedSha256: sha256(patched),
    scope: 'SHA-pinned author loader in fake wx/Image/RAF/canvas/GL only', risk,
    engineAdapterWasmNetworkDevice: 'NOT_RUN', rootCause: 'STATIC_RISK_REPRODUCTION_ONLY_NOT_PHONE_CAUSATION'};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--source' || !path.isAbsolute(process.argv[3]))
    throw Error('Use node tests/loader-terminal-tests.mjs --source ABSOLUTE_SHA_PINNED_AUTHOR_LOADER');
  console.log(JSON.stringify(runLoaderTerminalTests(fs.readFileSync(process.argv[3], 'utf8'))));
}
