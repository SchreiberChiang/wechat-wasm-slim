import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stageCandidate, PINNED_SOURCE, PINNED_LIBRARY_SHA256} from '../engine/stage-candidate.mjs';
const base = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-stage-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (name, bytes) => {const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes); return file;};
  const upstream = path.join(root, 'upstream'), baseline = [];
  for (const name of ['game.js', 'glx-config.js', 'godot-loader.js', 'weapp-adapter.js', 'engine/game.js', 'engine/godot-sdk.js', 'engine/godot.js', 'engine/godot.wasm.br', 'engine/empty-tips.bin', 'subpackages/subpack/game.js']) {
    const bytes = Buffer.from(name === 'game.js' ? "import './weapp-adapter'\nimport './glx-config'\nimport './godot-loader'\nGameGlobal.__godotMinigameNativeAudioMinDurationSeconds = 9007199254740991;\n" : name === 'engine/game.js' ? "const pack = '/engine/empty-tips.bin';" : '// synthetic ' + name);
    write('upstream/' + name, bytes); baseline.push({sha256: sha(bytes), path: name, bytes: bytes.length});
  }
  const upstreamManifest = write('baseline.json', JSON.stringify(baseline));
  write('config/project.config.json', JSON.stringify({appid: 'synthetic-private-appid', compileType: 'game'})); write('config/project.private.config.json', '{}');
  const wasm = Buffer.concat([Buffer.from('0061736d01000000', 'hex'), Buffer.from('synthetic')]);
  const pair = {'godot.js': Buffer.from('// synthetic engine'), 'godot.wasm': wasm, 'godot.wasm.br': zlib.brotliCompressSync(wasm)};
  const outputs = Object.fromEntries(Object.entries(pair).map(([name, bytes]) => {write('build/artifacts/' + name, bytes); return [name, {bytes: bytes.length, sha256: sha(bytes)}];}));
  const profile = JSON.stringify({type: 'build_profile', disabled_classes: [], disabled_build_options: {}});
  write('build/profile.gdbuild', profile);
  const build = {identity: {pin: PINNED_SOURCE, patches: [], cppdefines: '', glxLibrary: {sha256: PINNED_LIBRARY_SHA256}}, finishedAt: '2026-10-23T00:00:00Z', profileSha256: sha(profile), sconsArgs: ['modules_enabled_by_default=yes', 'use_wx_glx=yes'], outputs, pairing: {sha256: sha(JSON.stringify(outputs)), brotliDecodesToWasm: true}};
  write('build/BUILD.json', JSON.stringify(build)); const pck = write('acceptance.pck', 'synthetic PCK');
  return {root, write, build, opts: {upstream, upstreamManifest, buildDir: path.join(root, 'build'), configDir: path.join(root, 'config'), pck, pckSha256: sha('synthetic PCK'), out: path.join(root, 'candidate')}};
}
test('stages entire author baseline with paired engine, same PCK, unchanged protected shell and complete hashes', t => {
  const f = fixture(t), rec = stageCandidate(f.opts);
  assert.equal(rec.identity.mode, 'webgl');
  for (const item of rec.fileManifest) assert.equal(sha(fs.readFileSync(path.join(f.opts.out, item.path))), item.sha256);
  for (const item of rec.preservedAuthorShell) assert.deepEqual(fs.readFileSync(path.join(f.opts.out, item.path)), fs.readFileSync(path.join(f.opts.upstream, item.path)));
  assert.equal(fs.readFileSync(path.join(f.opts.out, 'engine/empty-tips.bin'), 'utf8'), 'synthetic PCK');
  assert.match(fs.readFileSync(path.join(f.opts.out, 'game.js'), 'utf8'), /^import '.\/weapp-adapter'\nimport '.\/glx-config'\nimport '.\/candidate-mode'\nimport '.\/candidate-observer'\nimport '.\/godot-loader'/);
  for (const file of ['project.config.json', 'project.private.config.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(f.opts.out, file))).projectname, rec.projectname);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.opts.out, 'project.config.json'))).appid, 'synthetic-private-appid');
  assert.equal(rec.identity.recipe.modeTemplateSha256, sha(fs.readFileSync(path.join(base, '../engine/assets/candidate-mode.js'))));
  assert.equal(rec.identity.recipe.observerTemplateSha256, sha(fs.readFileSync(path.join(base, '../engine/assets/candidate-observer.js'))));
  assert.equal(rec.identity.recipe.stagerSha256, sha(fs.readFileSync(path.join(base, '../engine/stage-candidate.mjs'))));
  assert.equal(rec.evidence.visibleRendering, 'not_verified');
  assert.ok(!JSON.stringify(rec).includes('synthetic-private-appid'));
  assert.throws(() => stageCandidate(f.opts), /already exists/);
  const glx = stageCandidate({...f.opts, mode: 'glx', out: path.join(f.root, 'glx')});
  assert.notEqual(glx.identity.packageId, rec.identity.packageId);
  assert.equal(glx.identity.pckSha256, rec.identity.pckSha256);
});
for (const [name, mutate, pattern] of [
  ['dirty author input', f => f.write('upstream/weapp-adapter.js', 'changed'), /baseline manifest mismatch/],
  ['extra author input', f => f.write('upstream/extra.js', 'changed'), /baseline manifest mismatch/],
  ['unfinished build', f => {delete f.build.finishedAt; f.write('build/BUILD.json', JSON.stringify(f.build));}, /not finished/],
  ['trimmed or mismatched full profile', f => f.write('build/profile.gdbuild', '{}'), /Full GLX build profile/],
  ['missing engine pair member', f => fs.unlinkSync(path.join(f.root, 'build/artifacts/godot.js')), /ENOENT/],
  ['mismatched paired JS', f => f.write('build/artifacts/godot.js', 'changed'), /SHA256\/size mismatch/],
  ['PCK mismatch', f => f.write('acceptance.pck', 'other'), /PCK SHA256 mismatch/],
  ['forged pairing record', f => {f.build.pairing.sha256 = '0'.repeat(64); f.write('build/BUILD.json', JSON.stringify(f.build));}, /pairing identity mismatch/],
  ['Brotli decoded mismatch despite consistent declared output hashes', f => {const bytes = zlib.brotliCompressSync(Buffer.from('other')); f.write('build/artifacts/godot.wasm.br', bytes); f.build.outputs['godot.wasm.br'] = {bytes: bytes.length, sha256: sha(bytes)}; f.build.pairing.sha256 = sha(JSON.stringify(f.build.outputs)); f.write('build/BUILD.json', JSON.stringify(f.build));}, /decoded WASM mismatch/]
]) test('refuses ' + name + ' before output creation', t => {
  const f = fixture(t); mutate(f); assert.throws(() => stageCandidate(f.opts), pattern); assert.equal(fs.existsSync(f.opts.out), false);
});
for (const field of ['pin', 'library', 'patches', 'cppdefines']) test('rejects pinned build identity mismatch: ' + field, t => {
  const f = fixture(t);
  if (field === 'library') f.build.identity.glxLibrary.sha256 = '0'.repeat(64);
  else f.build.identity[field] = field === 'patches' ? ['custom.patch'] : 'modified';
  f.write('build/BUILD.json', JSON.stringify(f.build));
  assert.throws(() => stageCandidate(f.opts), /Pinned candidate source/); assert.equal(fs.existsSync(f.opts.out), false);
});
for (const duplicate of [false, true]) test('rejects nonunique or missing startup import anchor: ' + duplicate, t => {
  const f = fixture(t), file = path.join(f.opts.upstream, 'game.js'), original = fs.readFileSync(file, 'utf8');
  const changed = duplicate ? original + original : original.replace("import './glx-config'", "import './different-config'");
  fs.writeFileSync(file, changed);
  const rows = JSON.parse(fs.readFileSync(f.opts.upstreamManifest)); const row = rows.find(row => row.path === 'game.js'); row.sha256 = sha(changed); row.bytes = Buffer.byteLength(changed); fs.writeFileSync(f.opts.upstreamManifest, JSON.stringify(rows));
  assert.throws(() => stageCandidate(f.opts), /anchor must occur exactly once/); assert.equal(fs.existsSync(f.opts.out), false);
});
test('refuses symlink/reparse input and overlap', t => {
  const f = fixture(t); const link = path.join(f.root, 'linked');
  fs.symlinkSync(f.opts.upstream, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stageCandidate({...f.opts, upstream: link}), /Reparse\/symlink/);
  assert.throws(() => stageCandidate({...f.opts, out: path.join(f.opts.upstream, 'new')}), /overlaps input/);
});
function runtime(mode, capability = true) {
  const root = {}, canvas = {}, lifecycle = {}, logs = [], scope = {console: {info: value => logs.push(value)}, GameGlobal: root, wx: {env: {isSupportEmscriptenGLX: capability}, getSystemInfoSync: () => ({model: 'mock device', version: 'mock wechat', SDKVersion: 'mock SDK'}), onHide: fn => {lifecycle.hide = fn;}, onShow: fn => {lifecycle.show = fn;}}, canvas};
  root.window = {}; vm.createContext(scope);
  const source = fs.readFileSync(path.join(base, '../engine/assets/candidate-mode.js'), 'utf8').replace('__CANDIDATE_MODE__', JSON.stringify(mode)).replace('__CANDIDATE_IDENTITY__', JSON.stringify({mode, packageId: 'synthetic-package'}));
  vm.runInContext(source, scope);
  vm.runInContext(fs.readFileSync(path.join(base, '../engine/assets/candidate-observer.js'), 'utf8'), scope);
  return {root, canvas, lifecycle, logs, api: root.AuthorReleaseAcceptance, read: () => JSON.parse(root.AuthorReleaseAcceptance.readDiagnosticJson())};
}
test('mode gate executes before any context: WebGL forced, GLX unsupported/unknown refused', () => {
  assert.equal(runtime('webgl', true).root.__GODOT_DISABLE_WXGLX, true);
  assert.equal(runtime('glx').root.__GODOT_DISABLE_WXGLX, false);
  for (const cap of [false, undefined, null, 1]) {
    // undefined uses default argument, test explicit missing env separately below.
    if (cap !== undefined) assert.throws(() => runtime('glx', cap), /no fallback allowed/);
  }
  const code = fs.readFileSync(path.join(base, '../engine/assets/candidate-mode.js'), 'utf8').replace('__CANDIDATE_MODE__', '"glx"').replace('__CANDIDATE_IDENTITY__', '{}');
  assert.throws(() => vm.runInNewContext(code, {GameGlobal: {}, wx: {env: {}}}), /no fallback allowed/);
});
test('observer distinguishes request, actual context, init and unverified rendering; never invents GLX from capability', () => {
  const h = runtime('glx'); assert.equal(h.read().actualMode, 'unknown'); assert.equal(h.read().modeEvidence, 'pending');
  h.root.__godotMinigameWXGLXEnabled = true;
  const ctx = {canvas: h.canvas, emscriptenGLX: {ctxid: 7, isWebGL2: true}}, native = {ctxid: 7, isWebGL2: true};
  h.root.GODOTSDK = {engine: {rtenv: {ctx, wxContextGlobal: native}}}; h.root.godotLoader = {gl: ctx};
  const state = h.read(); assert.equal(state.actualMode, 'glx'); assert.equal(state.nativeContextIdMatches, true); assert.equal(state.modeEvidence, 'observed');
  assert.equal(state.initialization.completion, 'not_verified'); assert.equal(state.visibleRendering, 'not_verified');
  assert.equal(h.root.window.AuthorReleaseAcceptance, h.api);
  native.ctxid = 8; assert.equal(h.read().modeEvidence, 'failed'); assert.match(h.api.readIdentityText(), /FAILED: Native descriptor ctxid mismatch/);
  delete ctx.emscriptenGLX; assert.match(h.api.readIdentityText(), /FAILED: Actual context is webgl/);
});
test('observer flags selected mode, canvas, loader and invalid native identity mismatches', () => {
  const h = runtime('glx'), ctx = {canvas: {}, emscriptenGLX: {ctxid: '0'}};
  h.root.__godotMinigameWXGLXEnabled = false; h.root.GODOTSDK = {engine: {rtenv: {ctx, wxContextGlobal: {ctxid: '0'}}}}; h.root.godotLoader = {gl: {}};
  assert.equal(h.read().errors.length, 4); assert.equal(h.read().modeEvidence, 'failed');
});
test('native descriptor copies may use numeric zero context ID', () => {
  const h = runtime('glx'), ctx = {canvas: h.canvas, emscriptenGLX: {ctxid: 0}};
  h.root.GODOTSDK = {engine: {rtenv: {ctx, wxContextGlobal: {ctxid: 0}}}};
  assert.equal(h.read().nativeContextIdMatches, true);
});
test('local observer records stable session, device, lifecycle and scene-read evidence without automatic log spam', () => {
  const h = runtime('webgl'); assert.equal(h.logs.length, 0);
  h.lifecycle.hide(); h.lifecycle.show(); h.lifecycle.show(); assert.equal(h.logs.length, 0);
  const before = h.read(); assert.equal(before.initialization.sceneRead, false); assert.equal(before.device.SDKVersion, 'mock SDK');
  assert.deepEqual(before.lifecycle, {hide: 1, show: 2});
  h.api.readIdentityText(); h.api.readIdentityText();
  assert.equal(h.logs.filter(value => value.startsWith('[SELFBUILD_CANDIDATE_SCENE]')).length, 1);
  const after = h.read(); assert.equal(after.sessionTag, before.sessionTag); assert.equal(after.initialization.sceneRead, true); assert.equal(after.initialization.nativeInitializationSuccess, 'not_verified');
});
test('unsupported GLX records identity and one blocked summary before throwing, without fallback or context creation', () => {
  const source = fs.readFileSync(path.join(base, '../engine/assets/candidate-mode.js'), 'utf8').replace('__CANDIDATE_MODE__', '"glx"').replace('__CANDIDATE_IDENTITY__', JSON.stringify({packageId: 'blocked-package', mode: 'glx'}));
  for (const env of [{isSupportEmscriptenGLX: false}, {}]) {
    const root = {}, logs = [], context = vm.createContext({GameGlobal: root, wx: {env}, console: {info: line => logs.push(line)}});
    for (let i = 0; i < 2; i++) assert.throws(() => vm.runInContext(source, context), /no fallback allowed/);
    assert.equal(logs.length, 1); assert.ok(logs[0].startsWith('[SELFBUILD_CANDIDATE_BLOCKED] '));
    const state = JSON.parse(logs[0].slice('[SELFBUILD_CANDIDATE_BLOCKED] '.length));
    assert.equal(state.packageId, 'blocked-package'); assert.equal(state.requestedMode, 'glx'); assert.equal(state.capabilityPresent, 'isSupportEmscriptenGLX' in env); assert.equal(state.capability, 'isSupportEmscriptenGLX' in env ? false : null);
    assert.equal(state.actualMode, 'unknown'); assert.equal(state.initialization, 'blocked'); assert.equal(state.failureCode, 'GLX_CAPABILITY_UNAVAILABLE'); assert.equal(state.visibleRendering, 'not_verified'); assert.match(state.reason, /no fallback allowed/);
    assert.equal(root.__SelfbuildCandidateIdentity.packageId, 'blocked-package'); assert.equal(Object.isFrozen(root.__SelfbuildCandidateBlocked), true); assert.equal(root.GODOTSDK, undefined); assert.equal(root.__GODOT_DISABLE_WXGLX, undefined);
  }
});
