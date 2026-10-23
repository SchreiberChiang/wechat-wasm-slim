import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import zlib from 'node:zlib';import {execFileSync} from 'node:child_process';
import {resolveToolchain, buildEnv, glxInput, buildIdentity, buildEngine, assertBuildIdentity, assertStageInputs, sourceState, outputPair, COMMON_ARGS, EMSCRIPTEN_VERSION} from '../trim/lib/build.mjs';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const git = (dir, ...args) => execFileSync('git.exe', ['-C', dir, ...args], {encoding: 'utf8', windowsHide: true}).trim();
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-selfbuild-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (p, b) => { const file = path.join(root, p); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, b); return file; };
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Selfbuild Test'); git(root, 'config', 'user.email', 'selfbuild@example.invalid'); git(root, 'config', 'core.autocrlf', 'false');
  write('platform/web/libemscriptenglx/libemscriptenglx_4.0.10.a', 'bundled-library'); write('source.cpp', 'original\n');
  write('.gitignore', 'sdk/\npython.exe\nprofile.gdbuild\nexternal.a\nwork/\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');
  const tc = {engineSource: root, pin: git(root, 'rev-parse', 'HEAD'), emsdk: path.join(root, 'sdk'), python: write('python.exe', 'test interpreter')};
  write('sdk/.emscripten', 'LLVM_ROOT="upstream/bin"'); write('sdk/.emsdk_version', 'sdk-release');
  write('sdk/upstream/emscripten/emscripten-version.txt', '4.0.10'); write('sdk/upstream/emscripten/emcc.py', 'compiler');
  write('sdk/upstream/bin/clang.exe', 'clang'); write('sdk/upstream/bin/wasm-ld.exe', 'linker'); write('sdk/node/24/node.exe', 'node');
  const profileFile = write('profile.gdbuild', '{}'), stage = path.join(root, 'work/engine');
  return {root, tc, write, profileFile, stage, opts: {tc, profileFile, stage, lto: 'thin', symbols: true, ltoJobs: 1}};
}

test('toolchain paths resolve relative to configuration; legacy defaults and fixed common args survive', () => {
  const tc = resolveToolchain({engineSource: './source', emsdk: '../sdk', python: './python', glxLibrary: './lib/glx.a', patches: ['patches/a.patch']}, path.resolve('config/toolchain.json'));
  assert.equal(tc.glxLibrary, path.resolve('config/lib/glx.a')); assert.equal(tc.emsdk, path.resolve('sdk'));
  assert.equal(resolveToolchain({engineSource: './source'}, path.resolve('tc.json')).glxLibrary, undefined);
  assert.equal(EMSCRIPTEN_VERSION, '4.0.10'); assert.ok(COMMON_ARGS.includes('use_wx_glx=yes')); assert.ok(COMMON_ARGS.includes('initial_memory=32'));
});

test('legacy bundled input uses committed bytes, not dirty source or implicit SCons lookup', async t => {
  const f = fixture(t); f.write('platform/web/libemscriptenglx/libemscriptenglx_4.0.10.a', 'dirty-library');
  const input = await glxInput(f.tc, f.tc.pin, f.stage);
  assert.equal(input.kind, 'bundled'); assert.equal(input.sha256, hash('bundled-library'));
  assert.equal(input.path, path.join(f.stage, 'platform/web/libemscriptenglx/libemscriptenglx_4.0.10.a'));
  assert.ok(path.isAbsolute(input.path));
});

test('external GLX requires and checks SHA256 before build actions', async t => {
  const f = fixture(t); f.tc.glxLibrary = f.write('external.a', 'library A');
  await assert.rejects(glxInput(f.tc, f.tc.pin, f.stage), /glxLibrarySha256/);
  f.tc.glxLibrarySha256 = '0'.repeat(64);
  await assert.rejects(buildEngine({...f.opts, workDir: path.dirname(f.stage)}), /GLX library SHA256 mismatch/);
  assert.equal(fs.existsSync(f.stage), false); assert.equal(fs.existsSync(path.join(path.dirname(f.stage), 'BUILD.json')), false);
});

test('resume rejects changed external bytes even if operator updates the expected library hash', async t => {
  const f = fixture(t); f.tc.glxLibrary = f.write('external.a', 'library A'); f.tc.glxLibrarySha256 = hash('library A');
  const identity = await buildIdentity(f.opts), workDir = path.dirname(f.stage);
  assert.equal(identity.glxLibrary.sha256, hash('library A')); assert.equal(identity.sdk.gitHead, null, 'ancestor repository must never impersonate SDK Git identity');
  fs.mkdirSync(workDir, {recursive: true}); fs.writeFileSync(path.join(workDir, 'BUILD.json'), JSON.stringify({identity}));
  f.write('external.a', 'library B');
  await assert.rejects(buildEngine({...f.opts, workDir}), /SHA256 mismatch/);
  f.tc.glxLibrarySha256 = hash('library B');
  await assert.rejects(buildEngine({...f.opts, workDir}), /不能续编/);
  assert.equal(fs.existsSync(f.stage), false);
});

test('SDK selected compiler/config/runtime files and actual source HEAD participate in identity', async t => {
  const f = fixture(t), first = await buildIdentity(f.opts);
  assertBuildIdentity(first, await buildIdentity(f.opts), 'state');
  for (const file of ['sdk/.emscripten', 'sdk/upstream/bin/clang.exe', 'sdk/upstream/bin/wasm-ld.exe', 'sdk/node/24/node.exe', 'python.exe']) {
    const previous = fs.readFileSync(path.join(f.root, file)); f.write(file, 'changed');
    const changed = await buildIdentity(f.opts); assert.throws(() => assertBuildIdentity(first, changed, 'state'), /不能续编/);
    f.write(file, previous);
  }
  assert.equal(first.pin, f.tc.pin); assert.equal(first.windowsAdapterSha256.length, 64);
  assert.equal(first.hostRuntime.node.sha256, hash(fs.readFileSync(process.execPath)));
  assert.equal(first.hostRuntime.versions.node, process.versions.node);
});

test('resume rejects a newly added custom module before accepting changed stage evidence', async t => {
  const f = fixture(t), before = await sourceState(f.root);
  assertStageInputs(before, await sourceState(f.root));
  f.write('modules/extra/SCsub', 'Import("env")\n'); f.write('modules/extra/register_types.cpp', 'void extra() {}');
  const changed = await sourceState(f.root);
  assert.equal(changed.trackedDiffSha256, before.trackedDiffSha256);
  assert.throws(() => assertStageInputs(before, changed), /未跟踪源码/);
});

test('resume fingerprints optimizer and official or legacy SDK runtime layouts', async t => {
  const f = fixture(t);
  const files = ['sdk/upstream/bin/wasm-opt.exe', 'sdk/upstream/bin/wasm-opt',
    'sdk/node/22.16.0_64bit/bin/node.exe', 'sdk/node/unix/bin/node',
    'sdk/python/3.13.3_64bit/python.exe', 'sdk/python/nested/bin/python.exe', 'sdk/python/unix/bin/python3'];
  for (const file of files) f.write(file, file);
  const first = await buildIdentity(f.opts);
  for (const file of [...files, 'sdk/node/24/node.exe']) {
    const absolute = path.join(f.root, file), original = fs.readFileSync(absolute);
    assert.equal(first.sdk.files.find(entry => entry.path === absolute)?.sha256, hash(original), file + ' must be fingerprinted');
    f.write(file, 'changed runtime or optimizer');
    const changed = await buildIdentity(f.opts);
    assert.throws(() => assertBuildIdentity(first, changed, 'state'), /不能续编/, file + ' changes must refuse resume');
    fs.writeFileSync(absolute, original);
  }
  assertBuildIdentity(first, await buildIdentity(f.opts), 'state');
});

test('source state distinguishes dirty source and summarizes untracked source without build artifact dump', async t => {
  const f = fixture(t); f.write('source.cpp', 'dirty\n'); f.write('new.cpp', 'new'); f.write('build/large.o', 'object');
  const state = await sourceState(f.root);
  assert.match(state.trackedDiff, /dirty/); assert.equal(state.untracked.count, 1); assert.deepEqual(state.untracked.paths, ['new.cpp']); assert.equal(state.untracked.excludedCount, 1);
});

test('compiler environment removes ambient overrides on the child copy only', () => {
  const keys = ['EM_LLVM_ROOT', 'EM_NODE_JS', 'EM_COMPILER_WRAPPER', 'EMCC_CFLAGS', 'EM_FROZEN_CACHE',
    'NODE_OPTIONS', 'NODE_PATH', 'PYTHONHOME', 'PYTHONPATH', 'Node_Options', 'Node_Path', 'PythonHome', 'PythonPath'], prior = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) process.env[k] = 'ambient';
    const env = buildEnv({emsdk: path.resolve('sdk'), python: path.resolve('python.exe')});
    for (const k of keys) { assert.equal(env[k], undefined); assert.equal(process.env[k], 'ambient'); }
    assert.equal(Object.keys(env).some(key => /^(NODE_OPTIONS|NODE_PATH|PYTHONHOME|PYTHONPATH)$/i.test(key)), false);
    assert.equal(env.EM_CONFIG, path.resolve('sdk/.emscripten'));
  } finally { for (const k of keys) if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
});

test('JS/WASM/Brotli pair records all hashes and checks decoded WASM', () => {
  const glue = Buffer.from('glue'), wasm = Buffer.from('wasm'), br = zlib.brotliCompressSync(wasm), pair = outputPair(glue, wasm, br);
  assert.equal(pair.outputs['godot.js'].sha256, hash(glue)); assert.equal(pair.outputs['godot.wasm'].sha256, hash(wasm)); assert.equal(pair.outputs['godot.wasm.br'].sha256, hash(br));
  assert.equal(pair.pairing.brotliDecodesToWasm, true);
  assert.notEqual(outputPair(Buffer.from('other'), wasm, br).pairing.sha256, pair.pairing.sha256);
  assert.equal(outputPair(glue, Buffer.from('other'), br).pairing.brotliDecodesToWasm, false);
});
