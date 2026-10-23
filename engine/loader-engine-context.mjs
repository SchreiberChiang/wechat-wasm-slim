import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const TERMINAL_LOADER_SHA256 = '606480e28dc6c4d640dc03f588ccfa0465595b4b8e670a113e466c887227375f';
export const DEFERRED_PROPERTY = '__wxslimGLXContextDeferred';
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const ANCHOR = '            gameGlobal.__godotMinigameWXGLXEnabled = useWXGLX;';

// Independent experiment only; no change to the default stager or loader policy.
export function patchLoaderEngineContext(source) {
  if (typeof source !== 'string') throw new TypeError('Loader source must be a UTF-8 string');
  if (source.includes(DEFERRED_PROPERTY)) throw new Error('Loader engine-context patch already present');
  if (sha256(source) !== TERMINAL_LOADER_SHA256) throw new Error('Unknown terminal loader SHA256');
  if (source.split(ANCHOR).length !== 2) throw new Error('Expected one loader GLX mode pin');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.replace(ANCHOR, ANCHOR + newline + [
    '            if (useWXGLX) {',
    '                this.gl = null;',
    '                this.' + DEFERRED_PROPERTY + ' = true;',
    '                return;',
    '            }'
  ].join(newline));
}

export function writeLoaderEngineContext({sourcePath, outputPath}) {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(outputPath)) throw new Error('Source and output paths must be absolute');
  const manifestPath = path.join(path.dirname(outputPath), 'LOADER_ENGINE_CONTEXT_PATCH.json');
  if (fs.existsSync(outputPath) || fs.existsSync(manifestPath)) throw new Error('Patch output or manifest already exists; refusing overwrite');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchLoaderEngineContext(source);
  const manifest = {schema: 1, status: 'patched-not-run', phoneValidation: 'NOT_PHONE_VERIFIED',
    parentTerminalSha256: TERMINAL_LOADER_SHA256, sourcePath, sourceSha256: sha256(source), outputPath,
    outputSha256: sha256(patched), generatorSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    deferredProperty: DEFERRED_PROPERTY,
    edits: ['After existing mode pin: GLX sets gl=null, marks deferred and returns before loader context/resource creation'],
    preserved: ['WebGL branch', 'constructor/download/image/progress methods', 'terminal cleanup method and guards'],
    scope: 'Loader GPU ownership isolation; not a unique proof of resource-ID collision or a black-screen fix',
    engineWasmAdapterNetworkExecution: 'NOT_RUN'};
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, patched, {flag: 'wx'});
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return manifest;
}

function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--source', '--out'].includes(key) || !value || args.has(key) || !path.isAbsolute(value))
      throw new Error('Use --source ABSOLUTE_TERMINAL_LOADER --out NEW_ABSOLUTE_LOADER_PATH');
    args.set(key, value);
  }
  if (args.size !== 2) throw new Error('Both --source and --out are required');
  console.log(JSON.stringify(writeLoaderEngineContext({sourcePath: args.get('--source'), outputPath: args.get('--out')})));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
