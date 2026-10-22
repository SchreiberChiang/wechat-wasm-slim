// Explicit diagnostic copy only; GPU queries may change timing. Never used by normal convert.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {instrumentDiagnosticEngine} from './diagnostic-engine.mjs';
export function instrumentPresentationEngine(source) {
  let result = instrumentDiagnosticEngine(source);
  const probe = fs.readFileSync(new URL('./presentation-probe.js', import.meta.url), 'utf8');
  for (const [anchor, replacement] of [
    ['__WXSLIM_FRAME_PROBE__.batchAsync(Module.wxContextGlobal,view);', '__WXSLIM_PRESENTATION_PROBE__.batch(Module.wxContextGlobal,view,drawcall);'],
    ['__WXSLIM_FRAME_PROBE__.swap(Module.wxContextGlobal)', '__WXSLIM_PRESENTATION_PROBE__.swap(Module.wxContextGlobal)'],
    ['installWXGLXPatches();', 'installWXGLXPatches();\n' + probe + '\n']
  ]) {
    if (result.split(anchor).length !== 2) throw Error('Presentation anchor must be unique: ' + anchor);
    result = result.replace(anchor, () => replacement);
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    if (args.length !== 4) throw Error('Use --input <original godot.js> --out <new godot.js>');
    for (let i = 0; i < args.length; i += 2) {
      if (!['--input', '--out'].includes(args[i]) || options[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid arguments');
      options[args[i]] = args[i + 1];
    }
    const output = path.resolve(options['--out']);
    if (fs.existsSync(output)) throw Error('Output already exists; no overwrite');
    fs.writeFileSync(output, instrumentPresentationEngine(fs.readFileSync(options['--input'], 'utf8')), {flag: 'wx'});
    console.log('Created explicit presentation diagnostic engine copy');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
