import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const AUTHOR_LOADER_SHA256 = '0e6bde33b9a63d3f452209838f0ef110a33890df8bc97fdedf25728bf00c03a4';
export const TERMINAL_PROPERTY = '__wxslimLoaderTerminal';
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// Pure exact-source patch. No loader evaluation, GPU access, downloads or hooks.
export function patchLoaderTerminal(source) {
  if (typeof source !== 'string') throw new TypeError('Loader source must be a UTF-8 string');
  if (source.includes(TERMINAL_PROPERTY)) throw new Error('Loader terminal patch already present');
  if (sha256(source) !== AUTHOR_LOADER_SHA256) throw new Error('Unknown author loader SHA256');
  let output = source;
  for (const method of ['resizeCanvases', 'render', 'cleanup']) {
    const pattern = new RegExp('        ' + method + '\\(\\) \\{(\\r?\\n)', 'g');
    let count = 0;
    output = output.replace(pattern, (header, newline) => {
      count++;
      return header + '            if (this.' + TERMINAL_PROPERTY + ') return;' + newline +
        (method === 'cleanup' ? '            this.' + TERMINAL_PROPERTY + ' = true;' + newline : '');
    });
    if (count !== 1) throw new Error('Expected one loader method: ' + method);
  }
  return output;
}

function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--source', '--out'].includes(key) || !value || args.has(key) || !path.isAbsolute(value))
      throw new Error('Use --source ABSOLUTE_AUTHOR_LOADER --out NEW_ABSOLUTE_LOADER_PATH');
    args.set(key, value);
  }
  if (args.size !== 2) throw new Error('Both --source and --out are required');
  const input = args.get('--source'), output = args.get('--out');
  const manifestPath = path.join(path.dirname(output), 'LOADER_TERMINAL_PATCH.json');
  if (fs.existsSync(output) || fs.existsSync(manifestPath)) throw new Error('Patch output or manifest already exists; refusing overwrite');
  const source = fs.readFileSync(input, 'utf8');
  const patched = patchLoaderTerminal(source);
  const manifest = {schema: 1, status: 'patched-not-run', sourcePath: input, sourceSha256: sha256(source),
    outputPath: output, outputSha256: sha256(patched), generatorSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    terminalProperty: TERMINAL_PROPERTY, edits: [
      'resizeCanvases: terminal early return', 'render: terminal early return',
      'cleanup: terminal early return then mark terminal before unchanged original body'],
    engineWasmAdapterNetworkExecution: 'NOT_RUN', deviceRootCause: 'NOT_PROVEN'};
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, patched, {flag: 'wx'});
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(manifest));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
