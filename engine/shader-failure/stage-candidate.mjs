// One-off source-built diagnostic candidate; both modes deliberately disable the old cloud relay.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PINNED_SOURCE, PINNED_LIBRARY_SHA256} from '../stage-candidate.mjs';
import {COMMON_ARGS, assertStageInputs, sourceState} from '../../trim/lib/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PARENT_PACKAGE_ID = 'selfbuild-glx-engine-first-1d284f320d422f6848a9';
export const PARENT_SEAL_SHA256 = 'ba51d3cddb9e6fa571b1085d989d49bd6388c27e7d63a2646d0a3994ccb794e5';
// Reviewed v2 patch; no override option.
export const DIAGNOSTIC_PATCH_SHA256 = 'fff071e50459bb5434b3a14c2d38927d655f632044f4ec0dba96369e8d50fd3b';
// Exact pinned detect.py plus the existing Windows response-file adapter.
export const WINDOWS_DETECT_SHA256 = '4ed190ddb2a6bee45c8794fc69e72fc2a6a337a19e44a2bb24b3f1edd37037a7';
export const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = x => JSON.stringify(x, null, 2) + '\n';
const order = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
export const manifest = files => [...files].map(([path, b]) => ({path, bytes: b.length, sha256: hash(b)})).sort(order);
function plain(input) {
  if (!input) throw Error('Required path missing');
  const absolute = path.resolve(input);
  for (let p = absolute;; p = path.dirname(p)) {
    try { if (fs.lstatSync(p).isSymbolicLink()) throw Error('Symlink/reparse path refused: ' + p); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(p) === p) break;
  }
  return absolute;
}
const read = file => { plain(file); if (!fs.lstatSync(file).isFile()) throw Error('Regular file required'); return fs.readFileSync(file); };
const inside = (a, b) => { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
function tree(dir) {
  const files = new Map();
  function walk(rel) {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const key = path.posix.join(rel, name), file = path.join(dir, key), st = fs.lstatSync(file);
      if (st.isSymbolicLink()) throw Error('Symlink/reparse input refused');
      if (st.isDirectory()) walk(key); else if (st.isFile()) files.set(key, read(file)); else throw Error('Nonregular input');
    }
  }
  walk(''); return files;
}
function checked(file, expected) {
  const b = read(file);
  if (!expected || expected.bytes !== b.length || expected.sha256 !== hash(b)) throw Error('Size/hash mismatch: ' + file);
  return b;
}
const patchFiles = ['drivers/gles3/wxslim_shader_failure.h', 'platform/web/js/libs/library_wxslim_shader_failure.js', 'platform/web/js/patches/wxslim_shader_instrument.cjs', 'drivers/gles3/shader_gles3.cpp', 'platform/web/SCsub', 'godot_process.js'];
const addedFiles = patchFiles.slice(0, 3);
const ownedInputs = ['native.patch', 'native-header.h', 'library.js', 'instrument-glue.cjs', 'prepare-source-patch.mjs'];
export function assertLibraryMacroArgs(args, identity) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw Error('Invalid SCons arguments');
  const libraries = args.filter(arg => arg.split('=')[0] === 'wx_glx_lib');
  if (libraries.length !== 1 || libraries[0] !== 'wx_glx_lib=' + identity?.glxLibrary?.path) throw Error('SCons GLX library must occur exactly once and match build identity');
  const macros = args.filter(arg => arg.split('=')[0] === 'cppdefines');
  if (identity.cppdefines !== '' || macros.length > 1 || macros.some(arg => arg !== 'cppdefines=')) throw Error('SCons cppdefines must be empty and unambiguous');
}
export function assertReviewedDiff(trackedDiff, patch, detectBytes, additions) {
  const blocks = trackedDiff.split(/(?=^diff --git )/m).filter(block => block.startsWith('diff --git '));
  const diagnostic = blocks.filter(block => !block.startsWith('diff --git a/platform/web/detect.py b/platform/web/detect.py\n')).join('');
  const reviewedBlocks = patch.toString().split(/(?=^diff --git )/m).filter(block => block.startsWith('diff --git '));
  const originalBlocks = reviewedBlocks.filter(block => !/^new file mode /m.test(block)).join('');
  if (diagnostic.trim() !== originalBlocks.trim()) throw Error('Live diagnostic diff differs from exact reviewed patch');
  for (const name of addedFiles) {
    const block = reviewedBlocks.find(block => block.startsWith('diff --git a/' + name + ' b/' + name + '\n'));
    if (!block || !/^new file mode /m.test(block)) throw Error('Reviewed added file missing');
    const hunk = block.slice(block.indexOf('\n@@') + 1).split('\n');
    const lines = hunk.filter(line => line.startsWith('+')).map(line => line.slice(1));
    const expected = Buffer.from(lines.join('\n') + (block.includes('\\ No newline at end of file') ? '' : '\n'));
    if (!additions?.get(name)?.equals(expected)) throw Error('Added stage file differs from exact reviewed patch: ' + name);
  }
  if (hash(detectBytes) !== WINDOWS_DETECT_SHA256) throw Error('Live Windows adapter differs from exact reviewed detect.py');
}
export async function assertLiveSource(buildDir, build) {
  const stage = plain(path.join(buildDir, 'engine'));
  const git = (...args) => execFileSync('git.exe', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-C', stage, ...args], {encoding: 'utf8', windowsHide: true}).trim();
  if (plain(git('rev-parse', '--show-toplevel')).toLowerCase() !== stage.toLowerCase()) throw Error('Build stage is not its repository root');
  const live = await sourceState(stage);
  assertStageInputs(build.stage, live);
  if (git('rev-parse', 'HEAD') !== PINNED_SOURCE || live.head !== PINNED_SOURCE) throw Error('Live stage HEAD does not match pinned source');
  const changed = [...live.trackedDiff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map(m => { if (m[1] !== m[2]) throw Error('Live stage rename refused'); return m[1]; }).sort();
  if (json(changed) !== json([...patchFiles.slice(3), 'platform/web/detect.py'].sort())) throw Error('Live source changes exceed exact diagnostic/Windows-adapter scope');
  const allUntracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort();
  if (json(allUntracked) !== json([...addedFiles].sort())) throw Error('Unexpected untracked stage files');
  return live;
}
export async function validateBuild(buildDir, patchManifestPath) {
  const buildBytes = read(path.join(buildDir, 'BUILD.json')), build = JSON.parse(buildBytes);
  const live = await assertLiveSource(buildDir, build);
  const metaBytes = read(patchManifestPath), meta = JSON.parse(metaBytes);
  if (!patchManifestPath.endsWith('.patch.json')) throw Error('Expected diagnostic .patch.json manifest');
  const patchPath = patchManifestPath.slice(0, -5), patch = read(patchPath);
  if (!/^[a-f0-9]{64}$/.test(DIAGNOSTIC_PATCH_SHA256) || hash(patch) !== DIAGNOSTIC_PATCH_SHA256) throw Error('Fixed reviewed diagnostic patch SHA256 mismatch or not pinned');
  assertReviewedDiff(live.trackedDiff, patch, read(path.join(buildDir, 'engine', 'platform/web/detect.py')), new Map(addedFiles.map(name => [name, read(path.join(buildDir, 'engine', name))])));
  const diffFiles = [...patch.toString().matchAll(/^diff --git a\/(\S+) b\/(\S+)\r?$/gm)].map(m => { if (m[1] !== m[2]) throw Error('Renamed patch path refused'); return m[1]; }).sort();
  if (meta.schema !== 'wxslim-shader-failure-source-patch-v1' || meta.sourcePin !== PINNED_SOURCE || meta.patchSha256 !== hash(patch) || json(diffFiles) !== json([...patchFiles].sort())) throw Error('Diagnostic patch scope/hash mismatch');
  if (!Array.isArray(meta.inputs) || meta.inputs.length !== ownedInputs.length || new Set(meta.inputs.map(r => r.name)).size !== ownedInputs.length || !ownedInputs.every(name => meta.inputs.some(r => r.name === name && r.sha256 === hash(read(path.join(here, name)))))) throw Error('Diagnostic patch owned inputs mismatch');
  if (!Array.isArray(meta.files) || meta.files.length !== patchFiles.length || new Set(meta.files.map(r => r.name)).size !== patchFiles.length || !patchFiles.every(name => meta.files.some(r => r.name === name && r.sha256 === hash(read(path.join(buildDir, 'engine', name)))))) throw Error('Diagnostic stage source files mismatch');
  if (build.initialization?.version !== 1 || build.initialization?.status !== 'complete' || !Number.isFinite(Date.parse(build.finishedAt))) throw Error('Build not complete');
  assertStageInputs(build.stage, build.stage);
  const id = build.identity;
  if (id?.pin !== PINNED_SOURCE || build.stage.head !== PINNED_SOURCE || id.cppdefines !== '' || id.glxLibrary?.sha256 !== PINNED_LIBRARY_SHA256 || id.patches?.length !== 1 || id.patches[0].file !== path.basename(patchPath) || id.patches[0].sha256 !== hash(patch)) throw Error('Pinned diagnostic build identity mismatch');
  checked(id.glxLibrary.path, id.glxLibrary);
  assertLibraryMacroArgs(build.sconsArgs, id);
  const profileBytes = read(path.join(buildDir, 'profile.gdbuild')), profile = JSON.parse(profileBytes);
  if (hash(profileBytes) !== build.profileSha256 || id.profileSha256 !== build.profileSha256 || !Array.isArray(profile.disabled_classes) || profile.disabled_classes.length || !profile.disabled_build_options || Object.keys(profile.disabled_build_options).length || !COMMON_ARGS.every(a => build.sconsArgs?.includes(a)) || !build.sconsArgs.includes('modules_enabled_by_default=yes')) throw Error('Full build profile/arguments mismatch');
  for (const arg of [...COMMON_ARGS, 'modules_enabled_by_default=yes']) if (build.sconsArgs.filter(a => a.split('=')[0] === arg.split('=')[0]).length !== 1) throw Error('Ambiguous build argument override');
  for (const arg of build.sconsArgs) if (/^(module_.+_enabled=no|modules_enabled_by_default=no)/.test(arg)) throw Error('Trimmed module argument refused');
  if (!build.outputs || !build.pairing?.brotliDecodesToWasm || build.pairing.sha256 !== hash(JSON.stringify(build.outputs))) throw Error('Pair identity mismatch');
  if (json(Object.keys(build.outputs).sort()) !== json(['godot.js', 'godot.wasm', 'godot.wasm.br']) || json([...(build.pairing.files || [])].sort()) !== json(['godot.js', 'godot.wasm', 'godot.wasm.br'])) throw Error('Pair file set mismatch');
  const pair = new Map(['godot.js', 'godot.wasm', 'godot.wasm.br'].map(name => [name, checked(path.join(buildDir, 'artifacts', name), build.outputs[name])]));
  if (!zlib.brotliDecompressSync(pair.get('godot.wasm.br')).equals(pair.get('godot.wasm')) || pair.get('godot.wasm').subarray(0, 8).toString('hex') !== '0061736d01000000') throw Error('WASM/Brotli mismatch');
  if (pair.get('godot.js').toString().split('WXSLIM_SHADER_FAILURE_GLUE_V1').length !== 2) throw Error('Diagnostic glue marker missing/ambiguous');
  return {build, buildHash: hash(buildBytes), patchHash: hash(patch), patchManifestHash: hash(metaBytes), pair};
}

// Pure package transformation exposed for independently owned fixtures; production trust gates live below.
export function candidateFiles(parentFiles, parentRecord, validated, mode) {
  if (!['webgl', 'glx'].includes(mode)) throw Error('Mode must be webgl or glx');
  const files = new Map(parentFiles), {build, pair} = validated;
  const configs = ['project.config.json', 'project.private.config.json'];
  const identityCore = {schema: 'wxslim-shader-failure-candidate-identity-v1', mode, parentPackageId: PARENT_PACKAGE_ID, parentSealSha256: PARENT_SEAL_SHA256, parentEnginePairSha256: parentRecord.identity.enginePairSha256, enginePairSha256: build.pairing.sha256, buildRecordSha256: validated.buildHash, patchSha256: validated.patchHash, patchManifestSha256: validated.patchManifestHash, pckSha256: hash(files.get('engine/empty-tips.bin')), cloudRelay: 'disabled', stagerSha256: hash(read(fileURLToPath(import.meta.url)))};
  const identity = {...identityCore, packageId: 'shader-diagnostic-' + mode + '-' + hash(json(identityCore)).slice(0, 20)};
  const projectname = 'shader-diagnostic-' + mode + '-' + build.pairing.sha256.slice(0, 12);
  const source = files.get('candidate-mode.js').toString();
  const modeAnchor = '  const mode = "glx";';
  const identityAnchor = '  G.__SelfbuildCandidateIdentity = Object.freeze(' + JSON.stringify(parentRecord.identity) + ');';
  if (source.split(modeAnchor).length !== 2 || source.split(identityAnchor).length !== 2) throw Error('Parent mode/identity anchors ambiguous');
  files.set('candidate-mode.js', Buffer.from(source.replace(modeAnchor, '  const mode = ' + JSON.stringify(mode) + ';').replace(identityAnchor, '  G.__SelfbuildCandidateIdentity = Object.freeze(' + JSON.stringify(identity) + ');')));
  // Keep its import in place; no console wrapper, wx APIs, timers, or network calls.
  files.set('candidate-relay.js', Buffer.from('// Diagnostic candidate: cloud relay disabled in both modes.\n(function () { const G = typeof GameGlobal !== "undefined" ? GameGlobal : globalThis; G.__ShaderDiagnosticRelay = Object.freeze(' + JSON.stringify({packageId: identity.packageId, mode, cloudEnabled: false}) + '); })();\n'));
  files.set('engine/godot.js', pair.get('godot.js')); files.set('engine/godot.wasm.br', pair.get('godot.wasm.br'));
  for (const name of configs) files.set(name, Buffer.from(json({...JSON.parse(files.get(name)), projectname})));
  files.delete('CANDIDATE.json');
  const changes = manifest(files).filter(r => !parentFiles.get(r.path)?.equals(files.get(r.path))).map(r => ({...r, beforeSha256: parentFiles.has(r.path) ? hash(parentFiles.get(r.path)) : null}));
  const record = {schema: 'wxslim-shader-failure-candidate-package-v1', identity, projectname, engineOutputs: build.outputs, enginePair: build.pairing, changes, fileManifestScope: 'Every file except CANDIDATE.json', fileManifest: manifest(files), state: {runtime: 'not_run', visibleRendering: 'not_verified', blackScreenFixed: 'not_verified', cloudRelay: 'disabled', cloudRequests: 'not_sent', preview: 'not_authorized'}, purpose: 'First failed shader evidence only; source-built diagnostic candidate, not a fix or stability claim'};
  files.set('CANDIDATE.json', Buffer.from(json(record)));
  return {files, record};
}

export async function stageCandidate(options) {
  const mode = options.mode ?? 'webgl';
  if (!['webgl', 'glx'].includes(mode)) throw Error('Mode must be webgl or glx');
  const parent = plain(options.parent), sealPath = plain(options.seal), buildDir = plain(options.buildDir), patchManifest = plain(options.patchManifest), out = plain(options.out);
  if (fs.existsSync(out)) throw Error('Output already exists; refusing overwrite');
  for (const input of [parent, sealPath, buildDir, patchManifest, patchManifest.slice(0, -5)]) if (inside(input, out) || inside(out, input)) throw Error('Output overlaps input');
  const sealBytes = read(sealPath);
  if (hash(sealBytes) !== PARENT_SEAL_SHA256) throw Error('Fixed parent seal SHA256 mismatch');
  const seal = JSON.parse(sealBytes), files = tree(parent);
  if (seal.packageId !== PARENT_PACKAGE_ID || seal.files?.length !== 27 || files.size !== 27 || json(manifest(files)) !== json([...seal.files].sort(order))) throw Error('Sealed parent tree mismatch');
  const parentRecord = JSON.parse(files.get('CANDIDATE.json'));
  if (parentRecord.identity?.packageId !== PARENT_PACKAGE_ID || parentRecord.identity.mode !== 'glx') throw Error('Parent identity mismatch');
  const withoutRecord = new Map(files); withoutRecord.delete('CANDIDATE.json');
  if (json(manifest(withoutRecord)) !== json([...parentRecord.fileManifest].sort(order))) throw Error('Parent internal manifest mismatch');
  const validated = await validateBuild(buildDir, patchManifest);
  const {files: output, record} = candidateFiles(files, parentRecord, validated, mode);
  // No writes occur until every input and transformation gate has passed.
  fs.mkdirSync(path.dirname(out), {recursive: true}); plain(out); fs.mkdirSync(out);
  for (const [name, bytes] of output) { const target = path.join(out, name); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes, {flag: 'wx'}); }
  return record;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, allowed = new Set(['parent', 'seal', 'build-dir', 'patch-manifest', 'out', 'mode']);
    for (let i = 2; i < process.argv.length; i += 2) {
      const arg = process.argv[i], key = arg.slice(2), value = process.argv[i + 1], camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!arg.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--') || camel in options) throw Error('Expected unique --name value arguments');
      options[camel] = value;
    }
    const r = await stageCandidate(options); console.log(JSON.stringify({packageId: r.identity.packageId, mode: r.identity.mode, cloudRelay: 'disabled', runtime: 'not_run'}));
  } catch (error) { console.error('Diagnostic staging refused: ' + error.message); process.exitCode = 1; }
}
