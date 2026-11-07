// Independent candidate gate. Read-only Git/source inspection and in-memory
// replay only; never applies patches, writes a checkout, invokes SDK or builds.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
import {validatePersistentPatchScope, normalizePersistentBuildRequest} from './persistent-build-plan.mjs';
import {renderPersistentLibrary} from './persistent-factory-source.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = 'df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const generatedPath = 'platform/web/js/libs/library_wxslim_persistent.js';
const recipePath = 'engine/alpha-preserve-lighting/delivery-recipe.json';
const baselinePatches = [
  'engine/alpha-preserve-lighting/baseline-shader-diagnostic.patch',
  'engine/alpha-preserve-lighting/scene-alpha-restore.patch',
  'engine/alpha-preserve-lighting/scene-light-output.patch',
  'engine/alpha-preserve-lighting/scene-alpha-output.patch',
  'engine/alpha-preserve-lighting/delivery-windows-link.patch',
];
const newPatches = [
  {path: 'engine/wechat-file-error-propagation.patch', kind: 'file-errors'},
  {path: 'engine/wechat-persistent-init.patch', kind: 'persistent-init'},
];
const components = ['convert/assets/persistent-file-transport.js', 'convert/assets/persistent-memfs.js', 'convert/assets/persistent-session.js'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = bytes => ({bytes: bytes.length, sha256: hash(bytes)});
const safe = name => typeof name === 'string' && !!name && !name.includes('\\') && !name.includes(':') && !path.posix.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..');
const norm = name => process.platform === 'win32' ? path.resolve(name).toLowerCase() : path.resolve(name);
function dataClone(value, seen = new Set(), budget = {nodes: 0}) {
  assert(++budget.nodes <= 100000, 'PERSISTENT_PLAN_DATA_BOUND');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { assert(Number.isFinite(value), 'PERSISTENT_PLAN_FINITE_NUMBER'); return value; }
  assert(value && typeof value === 'object' && !seen.has(value), 'PERSISTENT_PLAN_PLAIN_DATA_REQUIRED');
  seen.add(value);
  const array = Array.isArray(value), result = array ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    assert(typeof key === 'string' && key !== '__proto__', 'PERSISTENT_PLAN_DATA_KEY');
    if (array) assert(/^(?:0|[1-9]\d*)$/.test(key), 'PERSISTENT_PLAN_ARRAY_KEY');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'PERSISTENT_PLAN_DATA_DESCRIPTOR_REQUIRED');
    result[key] = dataClone(descriptor.value, seen, budget);
  }
  if (array) assert.equal(Object.keys(result).length, value.length, 'PERSISTENT_PLAN_DENSE_ARRAY_REQUIRED');
  seen.delete(value);
  return result;
}

/** Integrity/schema gate only; a hash is not a signature or build authorization. */
export function validatePersistentPlan(value) {
  const plan = dataClone(value);
  const keys = ['schema', 'status', 'source', 'sourceCommit', 'profile', 'executionAuthorized', 'sourceWritesAuthorized', 'baseline', 'inputs', 'patches', 'files', 'generatedLibrary', 'sconsArgumentTemplate', 'libraryRequirement', 'incrementalImpact', 'blockers', 'scope', 'planSha256'];
  assert.deepEqual(Object.keys(plan).sort(), keys.sort(), 'PERSISTENT_PLAN_KEYS');
  const {planSha256, ...payload} = plan;
  assert(/^[a-f0-9]{64}$/.test(planSha256), 'PERSISTENT_PLAN_HASH_REQUIRED');
  assert.equal(hash(Buffer.from(JSON.stringify(payload))), planSha256, 'PERSISTENT_PLAN_HASH_MISMATCH');
  assert.equal(plan.schema, 'persistent-dev-plan-v1');
  assert.equal(plan.status, 'PLANNED_NOT_APPLIED_NOT_BUILT');
  assert.equal(plan.sourceCommit, commit);
  assert.equal(plan.profile, 'full');
  assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.sourceWritesAuthorized, false);
  normalizePersistentBuildRequest({source: plan.source});
  assert.equal(plan.baseline?.audit?.status, 'PASS_SOURCE_ONLY');
  assert.equal(plan.baseline.audit.sourceCommit, commit);
  for (const list of [plan.inputs, plan.patches, plan.files]) {
    assert(Array.isArray(list) && list.length && list.length <= 128, 'PERSISTENT_PLAN_LIST_BOUND');
    assert(list.every(item => item && safe(item.path)), 'PERSISTENT_PLAN_RELATIVE_PATH');
    assert.equal(new Set(list.map(item => item.path)).size, list.length, 'PERSISTENT_PLAN_DUPLICATE_PATH');
  }
  assert.equal(plan.patches.length, 7);
  assert.equal(plan.generatedLibrary.path, generatedPath);
  assert.equal(plan.generatedLibrary.written, false);
  assert.equal(plan.incrementalImpact?.cacheHitEstimate, 'NOT_ESTIMATED');
  assert.deepEqual(plan.incrementalImpact.atLeast, ['drivers/unix/file_access_unix.cpp recompilation', 'JS library generation and Emscripten link', 'godot_process and final artifact derivation']);
  assert(Array.isArray(plan.blockers) && plan.blockers.length >= 4 && plan.blockers.every(item => typeof item === 'string' && item), 'PERSISTENT_PLAN_BLOCKERS_REQUIRED');
  assert(Array.isArray(plan.scope) && plan.scope.length >= 4 && plan.scope.every(item => typeof item === 'string' && item), 'PERSISTENT_PLAN_SCOPE_REQUIRED');
  return plan;
}

/** These are generated-output exemptions, not source integrity certification. */
export function isPersistentGeneratedPath(name) {
  if (!safe(name)) return false;
  return name.startsWith('bin/') || name.startsWith('obj/') || name.startsWith('build/')
    || /(?:^|\/)[^/]+\.gen\.[^/]+$/.test(name)
    || /\.(?:o|os|ox|lo|a|bc|d|pyc)$/.test(name)
    || /(?:^|\/)__pycache__\/[^/]+\.pyc$/.test(name)
    || /^\.scons(?:ign[^/]*\.dblite|_env\.json|_node_count)$/.test(name);
}

function regularWithin(root, name) {
  assert(safe(name), 'PERSISTENT_UNSAFE_FILE_PATH');
  const file = path.join(root, name);
  assert(norm(fs.realpathSync(file)).startsWith(norm(root) + path.sep), 'PERSISTENT_LINK_ESCAPE');
  let current = file;
  while (norm(current) !== norm(root)) {
    assert(!fs.lstatSync(current).isSymbolicLink(), 'PERSISTENT_LINKED_PATH');
    current = path.dirname(current);
  }
  assert(fs.lstatSync(file).isFile(), 'PERSISTENT_REGULAR_FILE_REQUIRED');
  return fs.readFileSync(file);
}

export function auditPersistentSource({source, plan: inputPlan}) {
  const plan = validatePersistentPlan(inputPlan);
  source = normalizePersistentBuildRequest({source}).source;
  assert(norm(fs.realpathSync(source)) === norm(source), 'PERSISTENT_SOURCE_REAL_ROOT_REQUIRED');
  assert(fs.lstatSync(source).isDirectory() && !fs.lstatSync(source).isSymbolicLink(), 'PERSISTENT_SOURCE_DIRECTORY_REQUIRED');
  const git = args => execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-c', 'diff.autoRefreshIndex=false', '-c', 'core.quotePath=false', '-C', source, ...(args[0] === 'diff' ? ['diff', '--no-textconv', ...args.slice(1)] : args)], {windowsHide: true, maxBuffer: 32 * 1024 * 1024});
  const names = args => git(args).toString('utf8').split('\0').filter(Boolean).sort();
  assert.equal(norm(git(['rev-parse', '--show-toplevel']).toString().trim()), norm(source), 'PERSISTENT_SOURCE_CHECKOUT_ROOT_REQUIRED');
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), commit, 'PERSISTENT_SOURCE_HEAD_DIFFERS');
  const indexFlags = names(['ls-files', '-v', '-z']);
  assert(indexFlags.every(item => item.startsWith('H ')), 'PERSISTENT_NONSTANDARD_INDEX_FLAGS');
  // Establish the allowed repository input set before reading any plan-supplied
  // path. A recomputed digest must not authorize arbitrary repository reads.
  const currentRecipe = JSON.parse(regularWithin(repo, recipePath));
  assert.equal(currentRecipe.engine.source.commit, commit);
  assert.deepEqual([...currentRecipe.engine.patches, currentRecipe.engine.windowsLinkPatch].map(item => item.path), baselinePatches);
  assert.equal(currentRecipe.engine.profile.path, 'examples/glx-smoke/full-engine.gdbuild');
  assert.equal(currentRecipe.historicalBuild, 'build-settings-20261103.json');
  const historicalPath = 'engine/alpha-preserve-lighting/' + currentRecipe.historicalBuild;
  const expectedInputs = [...baselinePatches, ...newPatches.map(item => item.path), ...components, recipePath, historicalPath, currentRecipe.engine.profile.path, 'engine/fixed-engine-policy.json', 'engine/persistent-factory-source.mjs', 'engine/persistent-build-plan.mjs', 'engine/fixed-source-audit.mjs'].sort();
  assert.deepEqual(plan.inputs.map(item => item.path).sort(), expectedInputs, 'PERSISTENT_COMPLETE_INPUT_SET_DIFFERS');
  const inputs = new Map();
  for (const item of plan.inputs) {
    const bytes = regularWithin(repo, item.path);
    assert.deepEqual(id(bytes), {bytes: item.bytes, sha256: item.sha256}, 'PERSISTENT_REPO_INPUT_CHANGED: ' + item.path);
    inputs.set(item.path, bytes);
  }
  assert(inputs.has(recipePath), 'PERSISTENT_RECIPE_INPUT_REQUIRED');
  const recipe = JSON.parse(inputs.get(recipePath));
  assert.equal(recipe.engine.source.commit, commit);
  const oldPatches = [...recipe.engine.patches, recipe.engine.windowsLinkPatch];
  assert.deepEqual(oldPatches.map(item => item.path), baselinePatches, 'PERSISTENT_BASELINE_PATCH_SET_DIFFERS');
  assert.deepEqual([...inputs.keys()].sort(), expectedInputs, 'PERSISTENT_COMPLETE_INPUT_SET_DIFFERS');
  assert.deepEqual(plan.baseline.recipe, {path: recipePath, ...id(inputs.get(recipePath))});
  assert.deepEqual(plan.baseline.audit.recipe, id(inputs.get(recipePath)));
  assert.equal(hash(inputs.get(recipe.engine.profile.path)), recipe.engine.profile.sha256);
  const policy = JSON.parse(inputs.get('engine/fixed-engine-policy.json'));
  assert.equal(policy.sourceCommit, commit);
  assert.equal(policy.full.path, recipe.engine.profile.path);
  assert.equal(policy.full.sha256, recipe.engine.profile.sha256);
  const historical = JSON.parse(inputs.get(historicalPath));
  assert.equal(historical.source.commit, commit);
  assert.deepEqual(plan.sconsArgumentTemplate, historical.build.sconsArgs.map(value => value.startsWith('--jobs=') ? '--jobs=<SCHEDULING_NOT_SELECTED>' : value === 'build_profile=<FULL_PROFILE>' ? 'build_profile=<FROZEN_FULL_PROFILE>' : value === 'wx_glx_lib=<EXACT_026E_LIBRARY>' ? 'wx_glx_lib=<FROZEN_026E_LIBRARY>' : value));
  assert.deepEqual(plan.libraryRequirement, {bytes: recipe.engine.library.bytes, sha256: recipe.engine.library.sha256, checkedOnDisk: false});
  const blobs = new Map();
  function original(name) {
    assert(safe(name), 'PERSISTENT_REPLAY_PATH_INVALID');
    if (!blobs.has(name)) blobs.set(name, git(['ls-tree', '--name-only', commit, '--', name]).toString().trim() ? git(['show', commit + ':' + name]) : null);
    return blobs.get(name);
  }
  const replay = new Map(), patchEvidence = [];
  for (const item of oldPatches) {
    const bytes = inputs.get(item.path);
    assert.equal(hash(bytes), item.sha256, 'PERSISTENT_BASELINE_PATCH_HASH');
    replayUnifiedPatch(bytes, original, replay);
    patchEvidence.push({path: item.path, kind: 'baseline', ...id(bytes)});
  }
  const oldReplay = new Map(replay);
  assert.deepEqual(plan.baseline.audit.patches, oldPatches.map(item => ({path: item.path, ...id(inputs.get(item.path))})));
  const baselineFiles = new Map(plan.baseline.audit.files.map(item => [item.path, item]));
  assert.equal(baselineFiles.size, plan.baseline.audit.files.length, 'PERSISTENT_DUPLICATE_BASELINE_FILE');
  assert.deepEqual([...baselineFiles.keys()].sort(), [...oldReplay.keys()].sort());
  for (const [name, item] of oldReplay) assert.deepEqual(baselineFiles.get(name).lf, id(Buffer.from(item.text)), 'PERSISTENT_BASELINE_REPLAY_DIFFERS');
  for (const item of newPatches) {
    const bytes = inputs.get(item.path), paths = validatePersistentPatchScope(bytes, item.kind);
    paths.forEach(original);
    replayUnifiedPatch(bytes, original, replay);
    patchEvidence.push({path: item.path, kind: item.kind, paths, ...id(bytes)});
  }
  assert.deepEqual(plan.patches, patchEvidence, 'PERSISTENT_PLAN_PATCH_EVIDENCE_DIFFERS');
  assert.equal(original(generatedPath), null, 'PERSISTENT_GENERATED_PATH_TRACKED_AT_BASE');
  assert(!replay.has(generatedPath), 'PERSISTENT_GENERATED_PATCH_COLLISION');
  const sourceBuffers = Object.fromEntries(components.map(name => [name, inputs.get(name)]));
  const library = renderPersistentLibrary({sourceBuffers});
  assert.deepEqual(plan.generatedLibrary, {path: generatedPath, ...id(Buffer.from(library.source)), inputs: library.inputs, deps: library.deps, constants: library.constants, written: false}, 'PERSISTENT_GENERATED_IDENTITY_DIFFERS');
  replay.set(generatedPath, {text: library.source, added: true});
  const expectedFiles = [...replay].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({path: name, kind: item.added ? 'added' : 'modified', originalBlob: original(name) === null ? null : id(original(name)), currentFixedBaseline: baselineFiles.has(name) ? baselineFiles.get(name).raw : original(name) === null ? null : id(original(name)), expectedLf: id(Buffer.from(item.text))}));
  assert.deepEqual(plan.files, expectedFiles, 'PERSISTENT_PLAN_FILE_EVIDENCE_DIFFERS');
  const expectedTracked = [...replay].filter(([, item]) => !item.added).map(([name]) => name).sort();
  const expectedUntracked = [...replay].filter(([, item]) => item.added).map(([name]) => name).sort();
  const changed = names(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', 'HEAD', '--', '.']);
  const untracked = names(['ls-files', '--others', '--exclude-standard', '-z']);
  assert.deepEqual(changed, expectedTracked, 'PERSISTENT_TRACKED_SET_DIFFERS_OR_NEW_PATCHES_MISSING');
  assert.deepEqual(untracked, expectedUntracked, 'PERSISTENT_UNTRACKED_SET_DIFFERS_OR_GENERATED_LIBRARY_MISSING');
  assert.equal(git(['diff', '--no-ext-diff', '--summary', 'HEAD', '--', '.']).length, 0, 'PERSISTENT_MODE_OR_TYPE_CHANGE');
  const trackedDiff = git(['diff', '--no-ext-diff', '--binary', 'HEAD', '--', '.']);
  const stagedDiff = git(['diff', '--cached', '--no-ext-diff', '--binary', 'HEAD', '--', '.']);
  const staged = names(['diff', '--cached', '--no-ext-diff', '--name-only', '-z', 'HEAD', '--', '.']);
  assert(staged.every(name => expectedTracked.includes(name)), 'PERSISTENT_UNEXPECTED_STAGED_PATH');
  function checkIgnored() {
    for (const name of names(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])) {
      assert(isPersistentGeneratedPath(name), 'PERSISTENT_IGNORED_SOURCE_OR_UNKNOWN_FILE: ' + name);
      // Do not hash generated objects or certify them, but refuse linked paths.
      const file = path.join(source, name);
      assert(norm(fs.realpathSync(file)).startsWith(norm(source) + path.sep), 'PERSISTENT_IGNORED_LINK_ESCAPE');
      let cursor = file;
      while (norm(cursor) !== norm(source)) { assert(!fs.lstatSync(cursor).isSymbolicLink(), 'PERSISTENT_IGNORED_LINK'); cursor = path.dirname(cursor); }
      assert(fs.lstatSync(file).isFile(), 'PERSISTENT_IGNORED_NOT_REGULAR');
    }
  }
  checkIgnored();
  const files = expectedFiles.map(item => {
    const bytes = regularWithin(source, item.path), lf = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
    assert(Buffer.from(bytes.toString('utf8')).equals(bytes), 'PERSISTENT_SOURCE_UTF8');
    assert.deepEqual(id(lf), item.expectedLf, 'PERSISTENT_SOURCE_CONTENT_DIFFERS: ' + item.path);
    if (item.path === generatedPath) assert.deepEqual(id(bytes), item.expectedLf, 'PERSISTENT_GENERATED_RAW_BYTES_DIFFER');
    return {path: item.path, kind: item.kind, raw: id(bytes), lf: id(lf)};
  });
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), commit, 'PERSISTENT_HEAD_CHANGED_DURING_AUDIT');
  assert.deepEqual(names(['ls-files', '-v', '-z']), indexFlags, 'PERSISTENT_INDEX_FLAGS_CHANGED');
  assert.deepEqual(names(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', 'HEAD', '--', '.']), changed);
  assert.deepEqual(names(['ls-files', '--others', '--exclude-standard', '-z']), untracked);
  assert(git(['diff', '--no-ext-diff', '--binary', 'HEAD', '--', '.']).equals(trackedDiff));
  assert(git(['diff', '--cached', '--no-ext-diff', '--binary', 'HEAD', '--', '.']).equals(stagedDiff));
  checkIgnored();
  for (const item of files) assert.deepEqual(id(regularWithin(source, item.path)), item.raw, 'PERSISTENT_SOURCE_CHANGED_DURING_AUDIT');
  for (const item of plan.inputs) assert.deepEqual(id(regularWithin(repo, item.path)), {bytes: item.bytes, sha256: item.sha256}, 'PERSISTENT_INPUT_CHANGED_DURING_AUDIT');
  return {
    schema: 'persistent-dev-source-audit-v1', status: 'PASS_PERSISTENT_SOURCE_ONLY', sourceCommit: commit, planSha256: plan.planSha256,
    inputs: plan.inputs, patches: patchEvidence, generatedLibrary: plan.generatedLibrary, files,
    tracked: {paths: changed, diff: id(trackedDiff), stagedPaths: staged, stagedDiff: id(stagedDiff)}, untracked: {paths: untracked},
    ignored: {policy: 'Generated bin/obj/build, gen files, object/archive/bytecode and SCons outputs only; extra ignored sources and links rejected.', contentIntegrity: 'NOT_AUDITED; no cache-hit or generated-object provenance claim'},
    implementation: {path: 'engine/persistent-source-audit.mjs', ...id(regularWithin(repo, 'engine/persistent-source-audit.mjs'))},
    limitations: ['Candidate source membership and exact in-memory replay only; no compiler/SDK/engine/device execution.', 'Plan digest provides consistency, not authentication or authorization.', 'Generated build outputs are exempt from content hashing; this gate cannot certify their provenance or runtime behavior.', 'Existing fixed-source audit, full/conservative recipes and admission gates are unchanged.'],
  };
}

export function assertPersistentSourceUnchanged(before, after) {
  assert.equal(before?.status, 'PASS_PERSISTENT_SOURCE_ONLY');
  assert.equal(after?.status, 'PASS_PERSISTENT_SOURCE_ONLY');
  assert.deepEqual(after, before, 'PERSISTENT_SOURCE_EVIDENCE_CHANGED');
  return true;
}
