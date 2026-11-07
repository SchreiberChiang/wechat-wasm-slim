// Read-only persistent development planning. No checkout, git apply, SDK calls,
// source writes, compiler, engine, generated-glue evaluation or build execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auditFixedSource, assertSourceEvidenceUnchanged, replayUnifiedPatch} from './fixed-source-audit.mjs';
import {renderPersistentLibrary} from './persistent-factory-source.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = 'df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const recipePath = 'engine/alpha-preserve-lighting/delivery-recipe.json';
const generatedPath = 'platform/web/js/libs/library_wxslim_persistent.js';
const baselinePatchPaths = Object.freeze([
  'engine/alpha-preserve-lighting/baseline-shader-diagnostic.patch',
  'engine/alpha-preserve-lighting/scene-alpha-restore.patch',
  'engine/alpha-preserve-lighting/scene-light-output.patch',
  'engine/alpha-preserve-lighting/scene-alpha-output.patch',
  'engine/alpha-preserve-lighting/delivery-windows-link.patch',
]);
const candidateScopes = Object.freeze({
  'file-errors': ['drivers/unix/file_access_unix.cpp'],
  'persistent-init': ['godot_process.js', 'platform/web/SCsub', 'platform/web/js/libs/library_godot_os.js'],
});
const candidatePatches = Object.freeze([
  {path: 'engine/wechat-file-error-propagation.patch', kind: 'file-errors'},
  {path: 'engine/wechat-persistent-init.patch', kind: 'persistent-init'},
]);
const componentPaths = Object.freeze([
  'convert/assets/persistent-file-transport.js',
  'convert/assets/persistent-memfs.js',
  'convert/assets/persistent-session.js',
]);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const identity = buffer => ({bytes: buffer.length, sha256: hash(buffer)});
const safeRelative = name => typeof name === 'string' && name && !name.includes('\\') && !name.includes(':') && !path.posix.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..');

export function normalizePersistentBuildRequest(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'PLAN_REQUEST_OBJECT_REQUIRED');
  const keys = Reflect.ownKeys(value);
  assert.deepEqual(keys, ['source'], 'PLAN_ONLY_ACCEPTS_EXPLICIT_SOURCE');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'source');
  assert(descriptor && Object.hasOwn(descriptor, 'value'), 'PLAN_SOURCE_DATA_FIELD_REQUIRED');
  const source = descriptor.value;
  assert(typeof source === 'string' && source.trim() === source && path.isAbsolute(source) && !/[\r\n\0]/.test(source), 'PLAN_ABSOLUTE_SOURCE_REQUIRED');
  return {source: path.resolve(source)};
}

/** Scope admission only; strict syntax/context/line-count checks are replayed later. */
export function validatePersistentPatchScope(buffer, kind) {
  assert(Object.hasOwn(candidateScopes, kind), 'PLAN_UNKNOWN_PATCH_KIND');
  assert(Buffer.isBuffer(buffer), 'PLAN_PATCH_BUFFER_REQUIRED');
  const text = buffer.toString('utf8');
  assert(Buffer.from(text).equals(buffer), 'PLAN_PATCH_UTF8_REQUIRED');
  const headers = [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)\r?$/gm)];
  assert(headers.length, 'PLAN_PATCH_HEADERS_REQUIRED');
  const paths = headers.map(match => {
    assert(match[1] === match[2] && safeRelative(match[1]), 'PLAN_PATCH_PATH_INVALID');
    return match[1];
  });
  assert.equal(new Set(paths).size, paths.length, 'PLAN_DUPLICATE_PATCH_FILE');
  assert.deepEqual([...paths].sort(), [...candidateScopes[kind]].sort(), 'PLAN_PATCH_SCOPE_DIFFERS');
  return paths;
}

export function planPersistentBuild(request) {
  const {source} = normalizePersistentBuildRequest(request);
  assert(fs.lstatSync(source).isDirectory() && !fs.lstatSync(source).isSymbolicLink(), 'PLAN_EXISTING_SOURCE_DIRECTORY_REQUIRED');
  // This is intentionally the original, unrelaxed baseline gate.
  const baselineAudit = auditFixedSource({source});
  assert.equal(baselineAudit.sourceCommit, sourceCommit, 'PLAN_FIXED_HEAD_REQUIRED');
  const snapshots = new Map();
  function snapshot(relative, kind) {
    assert(safeRelative(relative), 'PLAN_INPUT_PATH_INVALID');
    if (!snapshots.has(relative)) {
      const file = path.join(repo, relative), stat = fs.lstatSync(file);
      assert(stat.isFile() && !stat.isSymbolicLink(), 'PLAN_REGULAR_INPUT_REQUIRED');
      snapshots.set(relative, {buffer: fs.readFileSync(file), kind});
    }
    return snapshots.get(relative).buffer;
  }
  const recipeBytes = snapshot(recipePath, 'baseline-recipe');
  assert.equal(hash(recipeBytes), baselineAudit.recipe.sha256, 'PLAN_BASELINE_RECIPE_CHANGED');
  const recipe = JSON.parse(recipeBytes);
  assert.equal(recipe.engine.source.commit, sourceCommit);
  const oldPatches = [...recipe.engine.patches, recipe.engine.windowsLinkPatch];
  assert.deepEqual(oldPatches.map(item => item.path), baselinePatchPaths, 'PLAN_BASELINE_PATCH_PATHS_CHANGED');
  const historicalPath = 'engine/alpha-preserve-lighting/' + recipe.historicalBuild;
  assert(safeRelative(historicalPath) && path.posix.basename(recipe.historicalBuild) === recipe.historicalBuild, 'PLAN_HISTORICAL_PATH_INVALID');
  const historical = JSON.parse(snapshot(historicalPath, 'historical-full-arguments'));
  assert.equal(historical.source.commit, sourceCommit);
  const profileBytes = snapshot(recipe.engine.profile.path, 'full-profile');
  assert.equal(hash(profileBytes), recipe.engine.profile.sha256, 'PLAN_FULL_PROFILE_HASH_DIFFERS');
  const policy = JSON.parse(snapshot('engine/fixed-engine-policy.json', 'unchanged-fixed-policy'));
  assert.equal(policy.sourceCommit, sourceCommit);
  assert.equal(policy.full.path, recipe.engine.profile.path);
  assert.equal(policy.full.sha256, recipe.engine.profile.sha256);
  const fullArgs = historical.build.sconsArgs;
  assert(Array.isArray(fullArgs) && fullArgs.every(value => typeof value === 'string'));
  for (const required of ['target=template_release', 'arch=wasm32', 'threads=no', 'wasm_simd=no', 'dlink_enabled=no', 'use_wx_glx=yes', 'lto=thin', 'use_closure_compiler=no', 'build_profile=<FULL_PROFILE>', 'wx_glx_lib=<EXACT_026E_LIBRARY>']) assert(fullArgs.includes(required), 'PLAN_FULL_BASELINE_ARGUMENT_MISSING: ' + required);
  const git = args => execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-C', source, ...args], {windowsHide: true, maxBuffer: 32 * 1024 * 1024});
  const originalBlobs = new Map();
  function original(name) {
    assert(safeRelative(name), 'PLAN_SOURCE_PATH_INVALID');
    if (!originalBlobs.has(name)) {
      const exists = git(['ls-tree', '--name-only', sourceCommit, '--', name]).toString().trim();
      originalBlobs.set(name, exists ? git(['show', sourceCommit + ':' + name]) : null);
    }
    return originalBlobs.get(name);
  }
  const expected = new Map(), patches = [];
  for (const item of oldPatches) {
    const buffer = snapshot(item.path, 'baseline-patch');
    assert.equal(hash(buffer), item.sha256, 'PLAN_BASELINE_PATCH_HASH_DIFFERS');
    replayUnifiedPatch(buffer, original, expected);
    patches.push({path: item.path, kind: 'baseline', ...identity(buffer)});
  }
  for (const item of candidatePatches) {
    const buffer = snapshot(item.path, 'persistent-patch');
    const paths = validatePersistentPatchScope(buffer, item.kind);
    // Record original Git blob identity even for paths already in the replay map.
    paths.forEach(original);
    replayUnifiedPatch(buffer, original, expected);
    patches.push({path: item.path, kind: item.kind, paths, ...identity(buffer)});
  }
  assert.equal(original(generatedPath), null, 'PLAN_GENERATED_PATH_ALREADY_TRACKED');
  assert(!expected.has(generatedPath), 'PLAN_GENERATED_PATH_COLLIDES_WITH_PATCH');
  const sourceBuffers = Object.fromEntries(componentPaths.map(name => [name, snapshot(name, 'owned-component')]));
  const library = renderPersistentLibrary({sourceBuffers, expectedHashes: Object.fromEntries(componentPaths.map(name => [name, hash(sourceBuffers[name])]))});
  snapshot('engine/persistent-factory-source.mjs', 'factory-generator');
  snapshot('engine/persistent-build-plan.mjs', 'plan-implementation');
  snapshot('engine/fixed-source-audit.mjs', 'strict-replay-and-baseline-audit');
  expected.set(generatedPath, {text: library.source, added: true});
  const files = [...expected].sort(([a], [b]) => a.localeCompare(b)).map(([name, result]) => {
    const blob = original(name);
    const baselineFile = path.join(source, name);
    let current = null;
    if (fs.existsSync(baselineFile)) {
      const stat = fs.lstatSync(baselineFile);
      assert(stat.isFile() && !stat.isSymbolicLink(), 'PLAN_BASELINE_PATH_NOT_REGULAR');
      current = identity(fs.readFileSync(baselineFile));
    }
    return {path: name, kind: result.added ? 'added' : 'modified', originalBlob: blob === null ? null : identity(blob), currentFixedBaseline: current, expectedLf: identity(Buffer.from(result.text))};
  });
  assert.equal(files.find(item => item.path === generatedPath).currentFixedBaseline, null, 'PLAN_GENERATED_FILE_ALREADY_EXISTS');
  const afterAudit = auditFixedSource({source});
  assertSourceEvidenceUnchanged(baselineAudit, afterAudit);
  for (const [relative, item] of snapshots) assert.equal(hash(fs.readFileSync(path.join(repo, relative))), hash(item.buffer), 'PLAN_INPUT_CHANGED_DURING_RENDER: ' + relative);
  const plan = {
    schema: 'persistent-dev-plan-v1', status: 'PLANNED_NOT_APPLIED_NOT_BUILT', source,
    sourceCommit, profile: 'full', executionAuthorized: false, sourceWritesAuthorized: false,
    baseline: {recipe: {path: recipePath, ...identity(recipeBytes)}, audit: baselineAudit, originalGate: 'auditFixedSource unchanged; complete old baseline required'},
    inputs: [...snapshots].map(([name, item]) => ({path: name, kind: item.kind, ...identity(item.buffer)})).sort((a, b) => a.path.localeCompare(b.path)),
    patches, files,
    generatedLibrary: {path: generatedPath, ...identity(Buffer.from(library.source)), inputs: library.inputs, deps: library.deps, constants: library.constants, written: false},
    sconsArgumentTemplate: fullArgs.map(value => value.startsWith('--jobs=') ? '--jobs=<SCHEDULING_NOT_SELECTED>' : value === 'build_profile=<FULL_PROFILE>' ? 'build_profile=<FROZEN_FULL_PROFILE>' : value === 'wx_glx_lib=<EXACT_026E_LIBRARY>' ? 'wx_glx_lib=<FROZEN_026E_LIBRARY>' : value),
    libraryRequirement: {bytes: recipe.engine.library.bytes, sha256: recipe.engine.library.sha256, checkedOnDisk: false},
    incrementalImpact: {atLeast: ['drivers/unix/file_access_unix.cpp recompilation', 'JS library generation and Emscripten link', 'godot_process and final artifact derivation'], cacheHitEstimate: 'NOT_ESTIMATED', unchangedObjects: 'Only SCons may decide reuse after a separately authorized integration; no object-copy plan.'},
    blockers: ['Writable candidate source placement and source changes are not authorized by this plan.', 'The independent persistent-dev executor still needs a first authorized real build and durable input/output/terminal evidence; this source plan does not execute it.', 'Old full/conservative pair checker requires WXMEMFS and is inapplicable; the independent structural pair checker still requires confirmation against actual compiled glue.', 'This source plan performs no toolchain/cache/resource preflight, compiler, generated glue, WASM, engine or device acceptance.'],
    scope: ['Read-only Git blobs plus strict cumulative in-memory text replay; generated library is memory-only.', 'Existing full/conservative recipes, source audit, pair checkers and byte admission remain unchanged.', 'Current baseline generated artifacts/objects are not inventoried or certified for reuse.', 'This is a df3-based persistent development plan, not completed official-source migration or persistent-save admission.'],
  };
  return {...plan, planSha256: hash(Buffer.from(JSON.stringify(plan)))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: node engine/persistent-build-plan.mjs ABSOLUTE_EXISTING_FIXED_ENGINE');
    process.stdout.write(JSON.stringify(planPersistentBuild({source: process.argv[2]}), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({schema: 'persistent-dev-plan-v1', status: 'REJECTED_READ_ONLY_PLAN', error: error.message}) + '\n');
    process.exitCode = 1;
  }
}
