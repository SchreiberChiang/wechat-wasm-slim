import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {candidateFiles, stageCandidate, validateBuild, assertReviewedDiff, assertLibraryMacroArgs, hash, manifest, PARENT_PACKAGE_ID, assertPatchIdentity, assertSourceScope, assertPairBytes, DIAGNOSTIC_PATCH_SHA256} from '../engine/shader-type-return/stage-candidate.mjs';
import {sourceState} from '../trim/lib/build.mjs';

function owned() {
  const identity = {packageId: PARENT_PACKAGE_ID, mode: 'glx', enginePairSha256: 'old-pair'};
  const files = new Map(Object.entries({
    'CANDIDATE.json': JSON.stringify({identity}),
    'candidate-mode.js': '(function () { const G = GameGlobal;\n  const mode = "glx";\n  G.__SelfbuildCandidateIdentity = Object.freeze(' + JSON.stringify(identity) + ');\n G.__GODOT_DISABLE_WXGLX = mode === "webgl";})();',
    'candidate-relay.js': 'old network relay',
    'project.config.json': JSON.stringify({appid: 'owned-test', projectname: 'old', setting: {es6: true}}),
    'project.private.config.json': JSON.stringify({projectname: 'old', setting: {compileHotReLoad: false}}),
    'engine/empty-tips.bin': '中文PCK fixture', 'engine/godot.js': 'old-js', 'engine/godot.wasm.br': 'old-br',
    'godot-loader.js': 'unchanged loader frame graphics', 'game.js': 'unchanged entry', '中文.txt': '保留',
  }).map(([k, v]) => [k, Buffer.from(v)]));
  const build = {outputs: {owned: 'output hashes'}, pairing: {sha256: 'new-pair', brotliDecodesToWasm: true}};
  const validated = {build, buildHash: 'build-hash', patchHash: 'patch-hash', patchManifestHash: 'meta-hash', pair: new Map([['godot.js', Buffer.from('new-js')], ['godot.wasm.br', Buffer.from('new-br')]])};
  return {files, parent: {identity}, validated};
}

test('owned package transformation pairs engines, preserves unrelated bytes and keeps mode/identity/no-network relay consistent', () => {
  for (const mode of ['webgl', 'glx']) {
    const f = owned(), result = candidateFiles(f.files, f.parent, f.validated, mode), r = result.record;
    assert.equal(r.identity.mode, mode); assert.equal(r.identity.enginePairSha256, 'new-pair');
    assert.equal(r.identity.parentPackageId, PARENT_PACKAGE_ID); assert.equal(r.identity.buildRecordSha256, 'build-hash');
    const changed = ['candidate-mode.js', 'candidate-relay.js', 'project.config.json', 'project.private.config.json', 'engine/godot.js', 'engine/godot.wasm.br'];
    assert.deepEqual(r.changes.map(x => x.path).sort(), changed.sort());
    for (const [name, bytes] of f.files) if (!changed.includes(name) && name !== 'CANDIDATE.json') assert.ok(result.files.get(name).equals(bytes));
    assert.equal(result.files.get('engine/godot.js').toString(), 'new-js'); assert.equal(result.files.get('engine/godot.wasm.br').toString(), 'new-br');
    const context = vm.createContext({GameGlobal: {}});
    vm.runInContext(result.files.get('candidate-relay.js').toString(), context);
    vm.runInContext(result.files.get('candidate-mode.js').toString(), context);
    assert.equal(context.GameGlobal.__ShaderDiagnosticRelay.cloudEnabled, false);
    assert.equal(context.GameGlobal.__ShaderDiagnosticRelay.packageId, r.identity.packageId);
    assert.equal(context.GameGlobal.__ShaderDiagnosticRelay.mode, mode);
    assert.equal(context.GameGlobal.__SelfbuildCandidateIdentity.packageId, r.identity.packageId);
    assert.equal(context.GameGlobal.__GODOT_DISABLE_WXGLX, mode === 'webgl');
    assert.equal(JSON.parse(result.files.get('project.config.json')).projectname, r.projectname);
    assert.equal(r.state.runtime, 'not_run'); assert.equal(r.state.cloudRelay, 'disabled');
    const noRecord = new Map(result.files); noRecord.delete('CANDIDATE.json'); assert.deepEqual(r.fileManifest, manifest(noRecord));
    assert.equal(hash(f.files.get('engine/empty-tips.bin')), r.identity.pckSha256);
  }
});

test('pure transformation rejects ambiguous identity/mode anchors and invalid mode', () => {
  const f = owned(); assert.throws(() => candidateFiles(f.files, f.parent, f.validated, 'other'), /Mode/);
  f.files.set('candidate-mode.js', Buffer.from('missing anchors'));
  assert.throws(() => candidateFiles(f.files, f.parent, f.validated, 'webgl'), /anchors/);
});

test('production staging refuses existing/overlapping outputs and forged seal before any output write', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-stage-reject-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const parent = path.join(dir, 'parent'), buildDir = path.join(dir, 'build'); fs.mkdirSync(parent); fs.mkdirSync(buildDir);
  const seal = path.join(dir, 'seal.json'), patchManifest = path.join(dir, 'diag.patch.json'); fs.writeFileSync(seal, '{}'); fs.writeFileSync(patchManifest, '{}');
  const base = {parent, buildDir, seal, patchManifest};
  await assert.rejects(stageCandidate({...base, out: parent}), /already exists/);
  await assert.rejects(stageCandidate({...base, out: path.join(parent, 'new')}), /overlaps/);
  const out = path.join(dir, 'new'); await assert.rejects(stageCandidate({...base, out}), /seal SHA256/);
  assert.equal(fs.existsSync(out), false); assert.deepEqual(fs.readdirSync(parent), []);
});

test('validateBuild checks actual repository root, source drift and HEAD before accepting mutable metadata', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-live-source-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const engine = path.join(dir, 'engine'); fs.mkdirSync(engine);
  const git = (...args) => execFileSync('git.exe', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-C', engine, ...args], {windowsHide: true});
  git('init', '-q'); git('config', 'user.name', 'Owned fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(engine, 'owned.cpp'), 'owned original'); git('add', '.'); git('commit', '-qm', 'Owned fixture');
  const stage = await sourceState(engine);
  const buildFile = path.join(dir, 'BUILD.json'), patchManifest = path.join(dir, 'forged.patch.json');
  fs.writeFileSync(buildFile, JSON.stringify({stage})); fs.writeFileSync(patchManifest, '{}');
  await assert.rejects(validateBuild(dir, patchManifest), /Live stage HEAD/);
  fs.writeFileSync(path.join(engine, 'owned.cpp'), 'unexpected source drift');
  await assert.rejects(validateBuild(dir, patchManifest), /stage source/);
  fs.writeFileSync(buildFile, JSON.stringify({stage: await sourceState(engine)}));
  await assert.rejects(validateBuild(dir, patchManifest), /Live stage HEAD/);
  const nested = path.join(dir, 'nested'); fs.mkdirSync(nested); fs.mkdirSync(path.join(nested, 'engine'));
  fs.writeFileSync(path.join(nested, 'BUILD.json'), JSON.stringify({stage}));
  // A nested directory of the fixture repository cannot masquerade as the source root.
  const nestedInsideRepo = path.join(engine, 'nested'); fs.mkdirSync(nestedInsideRepo); fs.mkdirSync(path.join(nestedInsideRepo, 'engine'));
  fs.writeFileSync(path.join(nestedInsideRepo, 'BUILD.json'), JSON.stringify({stage}));
  await assert.rejects(validateBuild(nestedInsideRepo, patchManifest), /repository root/);
});

test('reviewed diff rejects modified original blocks, changed added bytes, and nonreviewed Windows adapter', () => {
  const names = ['drivers/gles3/wxslim_shader_failure.h', 'platform/web/js/libs/library_wxslim_shader_failure.js', 'platform/web/js/patches/wxslim_shader_instrument.cjs', 'platform/web/js/libs/library_wxslim_shader_type_return.js', 'platform/web/js/patches/wxslim_shader_type_instrument.cjs'];
  const original = 'diff --git a/owned.cpp b/owned.cpp\nindex 111..222 100644\n--- a/owned.cpp\n+++ b/owned.cpp\n@@ -1 +1 @@\n-before\n+after\n';
  const newBlocks = names.map(name => `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n+owned added source\n`).join('');
  const additions = new Map(names.map(name => [name, Buffer.from('owned added source\n')]));
  const patch = Buffer.from(original + newBlocks);
  assert.throws(() => assertReviewedDiff(original.replace('+after', '+unexpected'), patch, Buffer.from('owned detect'), additions), /diff differs/);
  additions.set(names[0], Buffer.from('changed beyond exact reviewed patch\n'));
  assert.throws(() => assertReviewedDiff(original, patch, Buffer.from('owned detect'), additions), /Added stage file differs/);
  additions.set(names[0], Buffer.from('owned added source\n'));
  assert.throws(() => assertReviewedDiff(original, patch, Buffer.from('owned detect'), additions), /Windows adapter differs/);
});

test('SCons library and macro arguments cannot override the recorded reviewed identity', () => {
  const identity = {glxLibrary: {path: 'owned/pinned-library.a'}, cppdefines: ''};
  const library = 'wx_glx_lib=owned/pinned-library.a';
  assert.doesNotThrow(() => assertLibraryMacroArgs([library, 'platform=web'], identity));
  assert.doesNotThrow(() => assertLibraryMacroArgs([library, 'cppdefines='], identity));
  for (const args of [[], ['wx_glx_lib=other.a'], [library, library], [library, 'wx_glx_lib=other.a'], ['wx_glx_lib']]) {
    assert.throws(() => assertLibraryMacroArgs(args, identity), /GLX library/);
  }
  for (const args of [[library, 'cppdefines=UNREVIEWED'], [library, 'cppdefines=', 'cppdefines='], [library, 'cppdefines=', 'cppdefines=UNREVIEWED'], [library, 'cppdefines']]) {
    assert.throws(() => assertLibraryMacroArgs(args, identity), /cppdefines/);
  }
  assert.throws(() => assertLibraryMacroArgs([library], {...identity, cppdefines: 'UNREVIEWED'}), /cppdefines/);
});

test('new route pins the exact reviewed patch and refuses forged or old patch bytes', () => {
  assert.equal(DIAGNOSTIC_PATCH_SHA256, '84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6');
  for (const bytes of [Buffer.from('owned forged patch'), fs.readFileSync(new URL('../engine/shader-failure/native.patch', import.meta.url))]) {
    assert.throws(() => assertPatchIdentity(bytes, {patchSha256: hash(bytes)}), /Fixed reviewed diagnostic patch SHA256/);
  }
});

test('source scope requires exactly five additions and three modifications plus Windows adapter', () => {
  const modified = ['drivers/gles3/shader_gles3.cpp', 'platform/web/SCsub', 'godot_process.js', 'platform/web/detect.py'];
  const added = ['drivers/gles3/wxslim_shader_failure.h', 'platform/web/js/libs/library_wxslim_shader_failure.js', 'platform/web/js/patches/wxslim_shader_instrument.cjs', 'platform/web/js/libs/library_wxslim_shader_type_return.js', 'platform/web/js/patches/wxslim_shader_type_instrument.cjs'].sort();
  const diff = modified.map(name => `diff --git a/${name} b/${name}\n`).join('');
  assert.doesNotThrow(() => assertSourceScope(diff, added));
  assert.throws(() => assertSourceScope(diff, [...added, 'platform/web/js/patches/untracked.cjs'].sort()), /Unexpected untracked/);
  assert.throws(() => assertSourceScope(diff, added.filter(name => !name.endsWith('type_instrument.cjs'))), /Unexpected untracked/);
  assert.throws(() => assertSourceScope(diff + 'diff --git a/untracked.cjs b/untracked.cjs\n', added), /changes exceed/);
});

test('pair gate refuses either missing or duplicate marker and mixed WASM/Brotli pair', () => {
  const wasm = Buffer.from('0061736d01000000', 'hex');
  const markers = ['WXSLIM_SHADER_FAILURE_GLUE_V1', 'WXSLIM_SHADER_TYPE_RETURN_GLUE_V1'];
  function pair(js = markers.join(';')) {
    return new Map([['godot.js', Buffer.from(js)], ['godot.wasm', wasm], ['godot.wasm.br', zlib.brotliCompressSync(wasm)]]);
  }
  assert.doesNotThrow(() => assertPairBytes(pair()));
  for (const marker of markers) {
    assert.throws(() => assertPairBytes(pair(markers.filter(m => m !== marker).join(';'))), /marker missing/);
    assert.throws(() => assertPairBytes(pair(markers.join(';') + marker)), /marker missing/);
  }
  const mixed = pair(); mixed.set('godot.wasm.br', zlib.brotliCompressSync(Buffer.concat([wasm, Buffer.from([0])])));
  assert.throws(() => assertPairBytes(mixed), /WASM\/Brotli mismatch/);
});

test('pure package defaults to WebGL; GLX is explicit and both keep relay off', () => {
  const f = owned();
  const defaultPackage = candidateFiles(f.files, f.parent, f.validated);
  assert.equal(defaultPackage.record.identity.mode, 'webgl');
  assert.match(defaultPackage.record.identity.packageId, /^shader-type-return-webgl-/);
  const glx = candidateFiles(f.files, f.parent, f.validated, 'glx');
  assert.equal(glx.record.identity.mode, 'glx');
  assert.match(glx.record.identity.packageId, /^shader-type-return-glx-/);
  for (const result of [defaultPackage, glx]) {
    assert.equal(result.record.state.cloudRelay, 'disabled');
    assert.equal(result.record.identity.cloudRelay, 'disabled');
    assert.doesNotMatch(result.files.get('candidate-relay.js').toString(), /wx\.|setTimeout|fetch\(|https?:/);
  }
});
