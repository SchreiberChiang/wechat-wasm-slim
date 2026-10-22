// Opt-in diagnostic engine copy only. Never patches the input, converter defaults or an existing package.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MARKER = 'WXSLIM_FRAME_PROBE_V1';
const defaultProbe = () => fs.readFileSync(new URL('./frame-probe.js', import.meta.url), 'utf8');
export const DIAGNOSTIC_ANCHORS = Object.freeze({
  install: 'installWXGLXPatches();',
  loop: 'var iterFunc=getWasmTableEntry(func);setMainLoop(iterFunc,fps,simulateInfiniteLoop)',
  afterFrame: 'Module.wxContextGlobal.registerAfterDoFrame(function(){return Module._glxCommandBufferFlush();})',
  batchAsync: 'Module.wxContextGlobal.batchRenderAsync(view);',
  swap: 'Module.wxContextGlobal.swapWindow()'
});

function requireUnique(js, anchor, name) {
  const count = js.split(anchor).length - 1;
  if (count !== 1) throw Error('Diagnostic anchor ' + name + ' must occur exactly once; found ' + count + '. No output was written.');
}

export function instrumentDiagnosticEngine(js, probeSource = defaultProbe()) {
  if (typeof js !== 'string' || typeof probeSource !== 'string') throw TypeError('Engine and probe sources must be strings.');
  if (js.includes(MARKER) || js.includes('__WXSLIM_FRAME_PROBE__')) throw Error('Engine already contains the frame diagnostic probe.');
  if (!probeSource.includes(MARKER) || !probeSource.includes('var __WXSLIM_FRAME_PROBE__')) throw Error('Unrecognized frame probe source.');
  for (const [name, anchor] of Object.entries(DIAGNOSTIC_ANCHORS)) requireUnique(js, anchor, name);
  for (const token of ['var MainLoop=', 'var GLctx;', 'Module["_glxCommandBufferFlush"]', 'wxGLXGetRoot']) {
    if (!js.includes(token)) throw Error('Diagnostic engine contract missing: ' + token);
  }
  const replacements = {
    loop: 'var iterFunc=getWasmTableEntry(func);setMainLoop(__WXSLIM_FRAME_PROBE__.wrapLoop(iterFunc),fps,simulateInfiniteLoop)',
    afterFrame: '__WXSLIM_FRAME_PROBE__.registerAfterFrame(Module.wxContextGlobal,function(){return Module._glxCommandBufferFlush();})',
    batchAsync: '__WXSLIM_FRAME_PROBE__.batchAsync(Module.wxContextGlobal,view);',
    swap: '__WXSLIM_FRAME_PROBE__.swap(Module.wxContextGlobal)'
  };
  let result = js;
  for (const [name, replacement] of Object.entries(replacements)) result = result.replace(DIAGNOSTIC_ANCHORS[name], () => replacement);
  // Preserve this exact anchor: normal convert subsequently inserts its render observer here.
  result = result.replace(DIAGNOSTIC_ANCHORS.install, () => DIAGNOSTIC_ANCHORS.install + '\n' + probeSource + '\n');
  requireUnique(result, DIAGNOSTIC_ANCHORS.install, 'install after instrumentation');
  return result;
}

function runCli(args) {
  const usage = 'Usage: node examples/glx-smoke/diagnostic-engine.mjs --input <original godot.js> --out <new godot.js>';
  if (args.length !== 4) throw Error(usage);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--input', '--out'].includes(key) || options[key] || !value || value.startsWith('--')) throw Error(usage);
    options[key] = value;
  }
  if (!options['--input'] || !options['--out']) throw Error(usage);
  const input = path.resolve(options['--input']), output = path.resolve(options['--out']);
  if (input.toLowerCase() === output.toLowerCase() || fs.existsSync(output)) throw Error('Output must be a new path; existing inputs or outputs are never overwritten.');
  if (!fs.statSync(input).isFile()) throw Error('Input must be an existing engine JS file.');
  const result = instrumentDiagnosticEngine(fs.readFileSync(input, 'utf8'));
  // Exclusive create also rejects a concurrent writer. The parent directory must already exist.
  fs.writeFileSync(output, result, {flag: 'wx'});
  console.log('Created diagnostic engine copy: ' + output);
  console.log('Use this new JS with the unchanged paired WASM in normal convert. This probe observes; it does not repair rendering.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runCli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
