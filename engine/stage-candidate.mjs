import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ACCEPTANCE_PCK_SHA256 = 'b7f26680f9e3ee6a5734de8db308e8a78bce32b030c6772d8479285dadc690ea';
export const PINNED_SOURCE = 'df3cdd9bc9941a20cb5575d781cde6f937637bcb';
export const PINNED_LIBRARY_SHA256 = 'c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function plainPath(input) {
  if (!input) throw Error('Required input path is missing');
  const absolute = path.resolve(input);
  let cursor = absolute;
  while (true) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Reparse/symlink path refused: ' + cursor); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return absolute;
}
function readFile(file) {
  plainPath(file);
  if (!fs.lstatSync(file).isFile()) throw Error('Regular file required: ' + file);
  return fs.readFileSync(file);
}
function snapshot(dir) {
  const result = new Map();
  function walk(rel) {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const file = path.join(dir, rel, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Reparse/symlink input refused: ' + file);
      const key = path.posix.join(rel.replaceAll('\\', '/'), name);
      if (stat.isDirectory()) walk(key);
      else if (stat.isFile()) result.set(key, readFile(file));
      else throw Error('Non-regular input refused: ' + file);
    }
  }
  walk(''); return result;
}
function manifest(files) {
  return [...files].map(([path, bytes]) => ({path, bytes: bytes.length, sha256: hash(bytes)})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function checked(file, expected, label) {
  const bytes = readFile(file);
  if (!expected || expected.bytes !== bytes.length || expected.sha256 !== hash(bytes)) throw Error(label + ' SHA256/size mismatch');
  return bytes;
}
const inside = (a, b) => { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

// All inputs are read and validated before creating a new output directory.
export function stageCandidate(options) {
  const mode = options.mode ?? 'webgl';
  if (!['webgl', 'glx'].includes(mode)) throw Error('Mode must be webgl or glx');
  const upstream = plainPath(options.upstream), buildDir = plainPath(options.buildDir), configDir = plainPath(options.configDir), pckFile = plainPath(options.pck), out = plainPath(options.out);
  if (fs.existsSync(out)) throw Error('Output already exists; refusing to overwrite');
  for (const input of [upstream, buildDir, configDir, pckFile, plainPath(options.upstreamManifest)]) {
    if (inside(input, out) || inside(out, input)) throw Error('Output overlaps input');
  }
  const files = snapshot(upstream);
  const baseline = JSON.parse(readFile(options.upstreamManifest));
  const normalizedBaseline = Array.isArray(baseline) ? baseline.map(row => ({path: row.path, bytes: row.bytes, sha256: row.sha256})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : null;
  if (!normalizedBaseline || json(manifest(files)) !== json(normalizedBaseline)) throw Error('Author baseline manifest mismatch: dirty or mismatched input');
  for (const file of ['game.js', 'glx-config.js', 'godot-loader.js', 'weapp-adapter.js', 'engine/game.js', 'engine/godot-sdk.js', 'engine/godot.js', 'engine/godot.wasm.br', 'engine/empty-tips.bin']) {
    if (!files.has(file)) throw Error('Author shell missing required file: ' + file);
  }
  for (const file of ['candidate-mode.js', 'candidate-observer.js', 'CANDIDATE.json']) if (files.has(file)) throw Error('Author baseline contains reserved candidate path: ' + file);
  const buildBytes = readFile(path.join(buildDir, 'BUILD.json')), build = JSON.parse(buildBytes);
  if (!build.finishedAt || !Number.isFinite(Date.parse(build.finishedAt))) throw Error('Build is not finished');
  if (build.identity?.pin !== PINNED_SOURCE || build.identity?.glxLibrary?.sha256 !== PINNED_LIBRARY_SHA256 || !Array.isArray(build.identity?.patches) || build.identity.patches.length || build.identity.cppdefines !== '') throw Error('Pinned candidate source/library/patch/macro identity mismatch');
  const profileBytes = readFile(path.join(buildDir, 'profile.gdbuild')), profile = JSON.parse(profileBytes);
  if (hash(profileBytes) !== build.profileSha256 || !Array.isArray(profile.disabled_classes) || profile.disabled_classes.length || !profile.disabled_build_options || Object.keys(profile.disabled_build_options).length || !build.sconsArgs?.includes('modules_enabled_by_default=yes') || !build.sconsArgs.includes('use_wx_glx=yes')) throw Error('Full GLX build profile/arguments evidence mismatch');
  if (!build.pairing?.brotliDecodesToWasm || !build.outputs) throw Error('Build pair evidence missing');
  const pair = new Map();
  for (const name of ['godot.js', 'godot.wasm', 'godot.wasm.br']) pair.set(name, checked(path.join(buildDir, 'artifacts', name), build.outputs[name], name));
  if (build.pairing.sha256 !== hash(JSON.stringify(build.outputs))) throw Error('Build pairing identity mismatch');
  if (!zlib.brotliDecompressSync(pair.get('godot.wasm.br')).equals(pair.get('godot.wasm'))) throw Error('Brotli decoded WASM mismatch');
  if (pair.get('godot.wasm').subarray(0, 8).toString('hex') !== '0061736d01000000') throw Error('Invalid WASM header');
  const pck = readFile(pckFile), pckSha256 = options.pckSha256 ?? ACCEPTANCE_PCK_SHA256;
  if (hash(pck) !== pckSha256) throw Error('Acceptance PCK SHA256 mismatch');
  if (!files.get('engine/game.js').toString().includes("'/engine/empty-tips.bin'")) throw Error('Author PCK path contract mismatch');
  const configs = new Map();
  for (const name of ['project.config.json', 'project.private.config.json']) {
    const bytes = readFile(path.join(configDir, name)); JSON.parse(bytes); configs.set(name, bytes);
  }
  const config = JSON.parse(configs.get('project.config.json'));
  if (typeof config.appid !== 'string' || !config.appid.trim()) throw Error('Authorized local config has no AppID');
  const projectname = 'selfbuild-' + mode + '-' + build.pairing.sha256.slice(0, 12);
  for (const [name, bytes] of configs) configs.set(name, Buffer.from(json({...JSON.parse(bytes), projectname})));
  const preserved = ['glx-config.js', 'godot-loader.js', 'weapp-adapter.js', 'engine/game.js', 'engine/godot-sdk.js'];
  const shell = preserved.map(name => ({path: name, sha256: hash(files.get(name))}));
  const modeTemplate = readFile(path.join(here, 'assets/candidate-mode.js')), observerTemplate = readFile(path.join(here, 'assets/candidate-observer.js'));
  const recipe = {stagerSha256: hash(readFile(fileURLToPath(import.meta.url))), modeTemplateSha256: hash(modeTemplate), observerTemplateSha256: hash(observerTemplate)};
  const identityCore = {schema: 'selfbuild-candidate-identity-v1', mode, recipe, buildRecordSha256: hash(buildBytes), enginePairSha256: build.pairing.sha256, pckSha256, authorManifestSha256: hash(json(baseline)), shellSha256: hash(json(shell)), configSha256: hash(Buffer.concat([...configs.values()]))};
  const identity = {...identityCore, packageId: 'selfbuild-' + mode + '-' + hash(json(identityCore)).slice(0, 20)};
  const modeSource = modeTemplate.toString().replace('__CANDIDATE_MODE__', JSON.stringify(mode)).replace('__CANDIDATE_IDENTITY__', JSON.stringify(identity));
  files.set('candidate-mode.js', Buffer.from(modeSource));
  files.set('candidate-observer.js', observerTemplate);
  const originalEntry = files.get('game.js'), entry = originalEntry.toString();
  const anchor = /^import '\.\/weapp-adapter'\r?\nimport '\.\/glx-config'\r?\nimport '\.\/godot-loader'\r?$/gm;
  if ([...entry.matchAll(anchor)].length !== 1) throw Error('Author startup import anchor must occur exactly once');
  const audioSetting = 'GameGlobal.__godotMinigameNativeAudioMinDurationSeconds = 9007199254740991;';
  if (entry.split(audioSetting).length !== 2) throw Error('Author acceptance native-audio setting missing or ambiguous');
  // Adapter establishes window first; both local modules run before loader evaluation.
  files.set('game.js', Buffer.from(entry.replace(anchor, match => match.replace("import './godot-loader'", "import './candidate-mode'\nimport './candidate-observer'\nimport './godot-loader'"))));
  files.set('engine/godot.js', pair.get('godot.js')); files.set('engine/godot.wasm.br', pair.get('godot.wasm.br')); files.set('engine/empty-tips.bin', pck);
  for (const [name, bytes] of configs) files.set(name, bytes);
  const record = {schema: 'selfbuild-candidate-package-v1', identity, buildFinishedAt: build.finishedAt, preservedAuthorShell: shell, startupChanges: [{path: 'game.js', change: 'Insert candidate-mode and candidate-observer after adapter/config and before loader', beforeSha256: hash(originalEntry), afterSha256: hash(files.get('game.js'))}, {path: 'candidate-mode.js', change: 'Add explicit mode/capability gate and package identity'}, {path: 'candidate-observer.js', change: 'Add local memory observer for the unchanged acceptance PCK'}], nativeAudioPolicy: {setting: audioSetting, source: 'Already present unchanged in both upstream and accepted r01 entry'}, projectname, fileManifestScope: 'all package files except CANDIDATE.json (self-reference excluded)', fileManifest: manifest(files), evidence: {staticPairVerification: 'verified', runtime: 'not_run', visibleRendering: 'not_verified', authorFixReplicated: 'not_verified'}, purpose: 'Entire paired engine compatibility baseline with author shell; local staging only'};
  files.set('CANDIDATE.json', Buffer.from(json(record)));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  plainPath(out); fs.mkdirSync(out);
  for (const [name, bytes] of files) { const target = path.join(out, name); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes, {flag: 'wx'}); }
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const allowed = new Set(['upstream', 'upstream-manifest', 'build-dir', 'pck', 'pck-sha256', 'config-dir', 'out', 'mode']);
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i].replace(/^--/, '');
      if (!process.argv[i].startsWith('--') || !allowed.has(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw Error('Expected explicit --name value arguments');
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (camel in options) throw Error('Duplicate argument: ' + key);
      options[camel] = process.argv[i + 1];
    }
    const record = stageCandidate(options);
    console.log(JSON.stringify({packageId: record.identity.packageId, mode: record.identity.mode, files: record.fileManifest.length, runtime: 'not_run'}));
  } catch (error) { console.error('Candidate staging refused: ' + error.message); process.exitCode = 1; }
}
