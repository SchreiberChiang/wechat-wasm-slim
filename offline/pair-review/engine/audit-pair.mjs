// Static checks only: never instantiate WASM or evaluate the generated glue.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const nativeNames = ['_glxInit', '_glxInitBufferDataAndGlState', '_glxUpdateContextId', '_glxCommandBufferFlush'];
const runtimeTokens = ['WXMEMFS', 'callMain', 'copyToFS', 'GodotJSWrapper', '__godotMinigameOriginalCommitFrame', '__godotMinigameWXGLXEnabled'];

export function inspectPairBuffers({glue, wasm, compressed}) {
  if (!zlib.brotliDecompressSync(compressed).equals(wasm)) throw Error('Compressed/raw WASM mismatch');
  const text = glue.toString('utf8');
  new vm.Script(text, {filename:'pair-glue.js'}); // Parse only; never evaluate the glue.
  if (/missing function:|unresolved symbol:/i.test(text)) throw Error('Generated missing-function placeholder');
  for (const token of runtimeTokens) if (!text.includes(token)) throw Error('Missing runtime token: ' + token);
  // Module construction validates code but does not call a start function or any import.
  const module = new WebAssembly.Module(wasm);
  const imports = WebAssembly.Module.imports(module), exports = WebAssembly.Module.exports(module);
  const maps = [...text.matchAll(/var wasmImports=\{([^}]*)\}/g)];
  if (maps.length !== 1) throw Error('Missing or ambiguous JS import map');
  const bindings = {};
  for (const item of maps[0][1].split(',').filter(item => item.trim())) {
    const pair = /^\s*([$A-Z_a-z][$\w]*)\s*:\s*([$A-Z_a-z][$\w]*)\s*$/.exec(item);
    if (!pair || Object.hasOwn(bindings, pair[1])) throw Error('Invalid or duplicate JS import binding');
    Object.defineProperty(bindings, pair[1], {value:pair[2], enumerable:true});
  }
  for (const item of imports) {
    if (item.module !== 'a' || !Object.hasOwn(bindings, item.name)) throw Error('Missing JS binding for WASM import: ' + item.module + '.' + item.name);
  }
  const exportedFunctions = new Set(exports.filter(x => x.kind === 'function').map(x => x.name));
  const nativeMapping = {};
  for (const name of nativeNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('Module\\["' + escaped + '"\\]\\s*=\\s*' + escaped + '\\s*=\\s*wasmExports\\["([^"\\n]+)"\\]');
    const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
    if (matches.length !== 1 || !exportedFunctions.has(matches[0][1])) throw Error('Native export mapping missing/ambiguous: ' + name);
    nativeMapping[name] = matches[0][1];
  }
  const submission = {
    afterFrameInvokesNativeFlush: /registerAfterDoFrame\(function\(\)\{return Module\._glxCommandBufferFlush\(\);?\}\)/.test(text),
    batchRenderAsyncPresent: text.includes('Module.wxContextGlobal.batchRenderAsync('),
    swapWindowPresent: text.includes('Module.wxContextGlobal.swapWindow(')
  };
  if (Object.values(submission).some(v => !v)) throw Error('Expected native submission glue missing');
  return {schema: 'wxslim-pair-bytes-static-v1', inspectedAt: new Date().toISOString(),
    nativeMapping, submission, imports, exports, runtimeTokens, bindings,
    wasmMarkerPresence: {glx0111: wasm.includes(Buffer.from('0.1.11')), glx20251205: wasm.includes(Buffer.from('2025.12.05'))},
    scope: 'Actual byte pairing, JS parsing, WASM imports/exports and static mappings only; no build provenance, instantiation, ABI/visual/lifecycle acceptance.',
    initialization: 'not_run', visibleRendering: 'not_verified', phone: 'not_run'};
}

export function auditBuffers({glue, wasm, compressed, build}) {
  if (!build?.finishedAt || !build.outputs) throw Error('Complete BUILD.json outputs required');
  const files = {'godot.js': glue, 'godot.wasm': wasm, 'godot.wasm.br': compressed};
  for (const [name, bytes] of Object.entries(files)) {
    if (build.outputs[name]?.sha256 !== sha256(bytes) || build.outputs[name]?.bytes !== bytes.length) throw Error('Build output mismatch: ' + name);
  }
  return {...inspectPairBuffers({glue, wasm, compressed}), schema:'wxslim-selfbuild-pair-static-v1',
    sourcePin:build.identity?.pin ?? null, outputs:build.outputs,
    scope:'Hashes, Brotli pairing, WASM validation/import/export names and static glue patterns only; no instantiation, ABI/visual/lifecycle acceptance.'};
}

export function auditPair(buildDir) {
  const build = JSON.parse(fs.readFileSync(path.join(buildDir, 'BUILD.json'), 'utf8'));
  const read = name => fs.readFileSync(path.join(buildDir, 'artifacts', name));
  return auditBuffers({glue: read('godot.js'), wasm: read('godot.wasm'), compressed: read('godot.wasm.br'), build});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
    if (!args.includes('--build-dir') || !args.includes('--out')) throw Error('Usage: node engine/audit-pair.mjs --build-dir <build> --out <new.json>');
    const out = path.resolve(value('--out'));
    if (fs.existsSync(out)) throw Error('Do not overwrite existing audit');
    const audit = auditPair(path.resolve(value('--build-dir')));
    fs.writeFileSync(out, JSON.stringify(audit, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({staticChecks: 'pass', imports: audit.imports.length, exports: audit.exports.length, nativeMapping: audit.nativeMapping, out}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
