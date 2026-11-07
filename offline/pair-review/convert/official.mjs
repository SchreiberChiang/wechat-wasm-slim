// Fixed official-route checks plus an explicitly authorized, owned conversion task.
// No engine builds, uploads or WebAssembly instantiation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {sha, checkInputs, pckMountPath, md5} from './lib/inputs.mjs';
import {renderManifest} from './lib/render.mjs';
import {DISTRIBUTION_SOURCE_FILES} from './lib/distribution-notices.mjs';
import {prepareLoginCodeInterfaces,LOGIN_CODE_RUNTIME_SOURCE} from '../lib/login-code-interfaces.mjs';
import {describeStartupPrewarm,validateStartupPrewarmRequest} from '../lib/startup-prewarm.mjs';
import {auditConvertedInputs} from './lib/official-contract.mjs';
import {executeOfficial} from './official-execute.mjs';
import {prepareTransformerGlue} from './lib/conversion-core.mjs';
import {CUSTOM_PAIR_PROFILE} from '../lib/custom-pair-task.mjs';
import {auditCompletedCustomC050Output} from './lib/official-c050-adapter.mjs';
import {planCustomProjectUsage,checkCustomProjectUsage} from './lib/custom-project-usage.mjs';
import {customConversionContext,withOfficialConfiguration,readPreparedSource} from './lib/official-custom-context.mjs';
import {fixedRecipe, getOfficialRecipe, getRecipeIdentity, checkFixedPair, normalizeProjectUsage, checkProjectUsage} from './lib/official-engine-admission.mjs';
import {STORAGE_PROFILE,prepareStorageAdapter,readStorageSource} from './lib/storage-adapter.mjs';
import {OFFICIAL_C050_PROFILE,OFFICIAL_C050_CONSERVATIVE_PROFILE,OFFICIAL_C050_CAPABILITY_PROFILE,isOfficialC050Profile,prepareOfficialC050Adapter,checkOfficialC050Inputs} from './lib/official-c050-adapter.mjs';
export {fixedRecipe, checkFixedPair} from './lib/official-engine-admission.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(f);
const json = f => JSON.parse(read(f));
const configKeys = new Set(['schema', 'js', 'wasm', 'pck', 'transformer', 'interfaces', 'output', 'renderMode', 'name', 'locale', 'orientation', 'engineProfile', 'projectUsage', 'upstreamSource', 'loginCode', 'skipDefault3dPrewarm', 'customPreparation', 'budgetBytes']);
const sourceFiles = ['official.mjs', 'official-execute.mjs', 'official-recipe.json', 'official-conservative-recipe.json', 'lib/official-engine-admission.mjs', 'convert.mjs', 'lib/conversion-core.mjs', 'lib/official-task.mjs', 'lib/owned-process.mjs', 'lib/official-contract.mjs', 'lib/inputs.mjs', 'lib/render.mjs', 'lib/verify.mjs', 'assets/startup-failure.js', 'assets/godot-bridge.js', 'assets/render-observer.js', 'assets/render-runtime.js', 'assets/custom-package.js', 'assets/asset-gate.js', 'assets/single-entry.js', 'assets/wx-compat.js', 'assets/local-interfaces.js', 'assets/simple-delivery-interface.js', '../godot-addon/addons/wx_split/wx_split.js', '../split/assets/wxslim-timing.js'];
export const TASK_BUDGET_BYTES = 120 * 1024 * 1024;
sourceFiles.push('official-upstream-read-recipe.json','lib/storage-adapter.mjs','../engine/fixed-source-audit.mjs','../engine/upstream-wxmemfs-rule.mjs',
  '../engine/upstream-wxmemfs-correctness.mjs','../engine/upstream-wxmemfs-correctness.patch',
  '../engine/upstream-wxmemfs-read-contract.mjs','../engine/upstream-wxmemfs-read-contract.patch','../engine/upstream-wxmemfs.LICENSE');
const c050SourceFiles = ['official-c050-recipe.json','lib/official-c050-adapter.mjs','lib/secure-random-bridge.mjs',
  'assets/secure-random-host.js','assets/secure-random-lifecycle.js','../engine/official-upstream-storage-tail.json',
  '../engine/official-glx-library/audit-linkage.cjs'];
c050SourceFiles.push(...DISTRIBUTION_SOURCE_FILES.map(p=>'../'+p));
sourceFiles.push('../lib/login-code-interfaces.mjs');
sourceFiles.push('../lib/startup-prewarm.mjs');
export const snapshotFileKeys=cfg=>['js','wasm','pck','interfaces',...(cfg.engineProfile===STORAGE_PROFILE?['upstreamSource']:[])];
const bytesIdentity = value => ({bytes: value.length, sha256: sha(value)});
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function normalizeConfig(raw, dir = process.cwd()) {
  assert(object(raw) && Object.keys(raw).every(k => configKeys.has(k)), 'unknown official configuration key; no private config merging or implicit overrides');
  assert.equal(raw.schema, 'wxslim-official-inputs-v1');
  for (const key of ['js', 'wasm', 'pck', 'transformer']) assert(typeof raw[key] === 'string' && raw[key].trim(), 'explicit input required: ' + key);
  for (const key of ['interfaces', 'output', 'name', 'locale', 'orientation', 'renderMode']) if (raw[key] !== undefined) assert(typeof raw[key] === 'string' && raw[key].trim(), 'nonempty string required: ' + key);
  if (raw.budgetBytes !== undefined) assert([TASK_BUDGET_BYTES, 144 * 1024 * 1024].includes(raw.budgetBytes), 'unsupported explicit official task budget');
  const profile = raw.engineProfile === undefined ? 'full' : raw.engineProfile;
  if (profile===CUSTOM_PAIR_PROFILE) {
    assert(typeof raw.customPreparation==='string' && customConversionContext()?.preparationConfig===path.resolve(dir,raw.customPreparation),'matching completed custom preparation required');
  } else assert.equal(raw.customPreparation,undefined,'customPreparation requires a custom profile');
  validateStartupPrewarmRequest(raw.skipDefault3dPrewarm, profile, customConversionContext()?.sourceRecipe);
  if(raw.loginCode!==undefined)assert(typeof raw.loginCode==='boolean','loginCode must be an explicit boolean');
  if(raw.loginCode===true)assert(isOfficialC050Profile(profile),'loginCode requires a fixed official C050 profile');
  const recipe = getOfficialRecipe(profile), usage = normalizeProjectUsage(raw.projectUsage, profile);
  if(profile===STORAGE_PROFILE)assert(typeof raw.upstreamSource==='string'&&raw.upstreamSource.trim(),'explicit upstreamSource required for storage development profile');
  else assert.equal(raw.upstreamSource,undefined,'upstreamSource is only valid for storage development profile');
  const cfg = {...raw, engineProfile:profile};
  if (usage !== null) cfg.projectUsage = usage;
  for (const key of ['js', 'wasm', 'pck', 'transformer', 'interfaces', 'output','upstreamSource','customPreparation']) if (cfg[key]) cfg[key] = path.resolve(dir, cfg[key]);
  cfg.interfaces ??= path.join(home, recipe.interface);
  const options = {...recipe.options};
  if(cfg.loginCode===true)options.loginCode=true;
  for (const key of ['renderMode', 'name', 'locale', 'orientation']) if (cfg[key] !== undefined) options[key] = cfg[key];
  assert(['glx', 'webgl'].includes(options.renderMode), 'explicit glx/webgl only, no fallback');
  assert(['portrait', 'landscape'].includes(options.orientation), 'invalid orientation');
  return {...cfg, options};
}
export function readConfiguration(file) {
  const absolute = path.resolve(file), bytes = read(absolute);
  return {...normalizeConfig(JSON.parse(bytes), path.dirname(absolute)), configuration: {file:absolute, ...bytesIdentity(bytes)}};
}

// Recheck the effective in-memory configuration as well as the original file.
// A caller changing cfg.options or a nested declaration cannot evade a source-file snapshot.
function validateNormalizedConfig(cfg) {
  assert(object(cfg) && Object.keys(cfg).every(k => configKeys.has(k) || k === 'options' || k === 'configuration'), 'invalid normalized official configuration');
  const normalized = normalizeConfig(Object.fromEntries([...configKeys].filter(k => Object.hasOwn(cfg,k)).map(k => [k,cfg[k]])));
  for (const key of ['js','wasm','pck','transformer','interfaces','output','engineProfile','projectUsage','options','upstreamSource','loginCode','skipDefault3dPrewarm','customPreparation','budgetBytes']) assert.deepEqual(cfg[key],normalized[key], 'effective configuration mismatch: '+key);
  return normalized;
}

export function snapshotInputs(cfg) {
  validateNormalizedConfig(cfg);
  const identity = getRecipeIdentity(cfg.engineProfile);
  const configuration = cfg.configuration ? bytesIdentity(read(cfg.configuration.file)) : null;
  if (configuration) {
    assert.deepEqual(configuration, {bytes:cfg.configuration.bytes,sha256:cfg.configuration.sha256}, 'configuration changed since load');
    const original = normalizeConfig(json(cfg.configuration.file),path.dirname(cfg.configuration.file));
    for (const key of ['engineProfile','projectUsage','options','budgetBytes']) assert.deepEqual(cfg[key],original[key], 'configuration semantic fields changed since load: '+key);
  }
  return {
    engineSelection:{profile:cfg.engineProfile,...identity,projectUsage:cfg.projectUsage ? structuredClone(cfg.projectUsage) : null,
      ...(cfg.engineProfile===CUSTOM_PAIR_PROFILE?{customSource:customConversionContext().customSource}:{})},
    effectiveOptions:{...cfg.options},
    ...(cfg.budgetBytes !== undefined ? {budgetBytes:cfg.budgetBytes} : {}),
    files: Object.fromEntries([...snapshotFileKeys(cfg),'transformer'].map(key => [key, bytesIdentity(key==='upstreamSource'?readStorageSource(cfg[key]):read(cfg[key]))])),
    sources: Object.fromEntries(sourceFiles.concat(isOfficialC050Profile(cfg.engineProfile)?c050SourceFiles:[],
      cfg.engineProfile===OFFICIAL_C050_CONSERVATIVE_PROFILE?['official-c050-conservative-recipe.json']:[],
      cfg.engineProfile===OFFICIAL_C050_CAPABILITY_PROFILE || cfg.engineProfile===CUSTOM_PAIR_PROFILE?['official-c050-capability-recipe.json']:[],
      cfg.engineProfile===CUSTOM_PAIR_PROFILE?['lib/official-custom-context.mjs','lib/custom-project-usage.mjs','../lib/custom-pair-task.mjs','../lib/pck-inventory.mjs']:[],
      cfg.engineProfile===CUSTOM_PAIR_PROFILE && customConversionContext()?.rebuilt?['../engine/rebuilt-capability-pair.mjs','../engine/retained-conservative-capability.mjs']:[],
      cfg.options.loginCode===true?['../'+LOGIN_CODE_RUNTIME_SOURCE]:[]).map(name => [name, bytesIdentity(read(path.join(home, name)))])),
    configuration,
  };
}
export function assertSnapshotUnchanged(expected, actual) { assert.deepEqual(actual, expected, 'input/tool/adapter changed during operation'); }

export function checkOfficialInputs(cfg) {
  const snapshot = snapshotInputs(cfg), recipe = getOfficialRecipe(cfg.engineProfile);
  const custom=cfg.engineProfile===CUSTOM_PAIR_PROFILE?customConversionContext():null;
  const projectUsage = checkProjectUsage(cfg.projectUsage,cfg.engineProfile,snapshot.files.pck,custom?read(cfg.pck):undefined);
  const pair = checkFixedPair(read(cfg.js), read(cfg.wasm),cfg.engineProfile);
  if(custom?.rebuilt) pair.provenance=custom.retainedFixed?'MATCHES_RETAINED_FAILED_FIXED_CAPABILITY_RAW_AND_PREPARATION':'MATCHES_COMPLETED_FIXED_CAPABILITY_RAW_AND_PREPARATION';
  const c050Adapter=isOfficialC050Profile(cfg.engineProfile)?prepareOfficialC050Adapter({profile:cfg.engineProfile,js:read(cfg.js),wasm:read(cfg.wasm)}):null;
  const engineContract = Object.freeze({profile:cfg.engineProfile,...getRecipeIdentity(cfg.engineProfile),projectUsageSha256:projectUsage ? sha(JSON.stringify(projectUsage)) : null,
    ...(custom?{customSource:custom.customSource}:{})});
  assert.equal(snapshot.files.transformer.sha256, recipe.transformer.sha256, 'fixed official converter fingerprint');
  const inputCheck = c050Adapter?checkOfficialC050Inputs(cfg,c050Adapter):checkInputs(cfg); assert(inputCheck.ok, inputCheck.problems.join('\n'));
  assert.equal(inputCheck.facts.godotVersion, recipe.pckVersion, 'PCK export version must match fixed recipe');
  const adapter=cfg.engineProfile===STORAGE_PROFILE?prepareStorageAdapter({profile:cfg.engineProfile,js:read(cfg.js),wasm:read(cfg.wasm),sourceBytes:readStorageSource(cfg.upstreamSource)}):null;
  const o = cfg.options, login=prepareLoginCodeInterfaces(read(cfg.interfaces),o.loginCode===true), interfacesSha256=sha(login.source);
  const expectedManifest = renderManifest({renderMode:o.renderMode, js:adapter?.effectiveJs??read(cfg.js), wasm:read(cfg.wasm), pck:read(cfg.pck), godotVersion:recipe.pckVersion,
    transformerVersion:recipe.transformer.version, pluginVersion:recipe.plugin.version,
    runtimeOptions:{orientation:o.orientation,locale:o.locale,name:o.name,compat:o.compat,splitBridge:o.splitBridge,loadingPage:o.loadingPage,timing:o.timing,interfacesSha256,engineContract,...(adapter?.runtimeOptions??{}),...(c050Adapter?.runtimeOptions??{}),...(login.receipt?{loginCode:login.receipt}:{})}});
  assertSnapshotUnchanged(snapshot, snapshotInputs(cfg));
  return {schema:'wxslim-official-preflight-v1', status:'PASS_STATIC_ONLY', ...getRecipeIdentity(cfg.engineProfile), engineContract, projectUsage,
    inputs:Object.fromEntries(['js','wasm','pck',...(adapter?['upstreamSource']:[])].map(k => [k,{path:cfg[k],...snapshot.files[k]}])),
    transformer:{path:cfg.transformer,...recipe.transformer}, plugin:recipe.plugin,
    librarySha256:recipe.engine.librarySha256, returnZero:true, inputCheck, pairAudit:pair, snapshot, expectedManifest,...(adapter?{storageAdapter:adapter.receipt}:{}),...(c050Adapter?{officialC050Adapter:c050Adapter.receipt}:{}),...(login.receipt?{loginCode:login.receipt}:{}),
    pckMount:pckMountPath(cfg.pck), engineRun:'NOT_RUN', phone:'NOT_RUN', visual:'NOT_VERIFIED'};
}

export function conversionPlan(cfg, before) {
  assertSnapshotUnchanged(before.snapshot,snapshotInputs(cfg));
  const recipe = getOfficialRecipe(cfg.engineProfile);
  assert(cfg.output, 'explicit output required for plan');
  assert(!fs.existsSync(cfg.output), 'output exists; do not overwrite a baseline');
  assert(fs.statSync(path.dirname(cfg.output)).isDirectory(), 'output parent must already exist in an approved scope');
  const resolvedOutput = path.join(fs.realpathSync(path.dirname(cfg.output)),path.basename(cfg.output));
  if (cfg.engineProfile===CUSTOM_PAIR_PROFILE) {
    const custom=customConversionContext();
    const within=(root,file)=>{const rel=path.relative(root,file);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
    assert(!within(custom.protectedRoot,resolvedOutput)&&!within(resolvedOutput,custom.protectedRoot),'completed raw build is protected');
    for(const file of custom.protectedFiles) assert(!within(resolvedOutput,file),'output contains custom preparation records');
  }
  for (const key of [...snapshotFileKeys(cfg),'transformer']) {
    const rel = path.relative(resolvedOutput, fs.realpathSync(cfg[key]));
    assert(rel.startsWith('..' + path.sep) || path.isAbsolute(rel), 'output cannot contain a protected input');
  }
  const o = cfg.options;
  const snapshotBytes = snapshotFileKeys(cfg).reduce((n,k)=>n+before.snapshot.files[k].bytes,0);
  const estimatedAdditionalBytes = snapshotBytes + 32*1024*1024 + before.snapshot.files.pck.bytes*3;
  const budgetBytes = cfg.budgetBytes ?? TASK_BUDGET_BYTES;
  assert(estimatedAdditionalBytes <= budgetBytes, 'estimated task exceeds selected official conversion budget');
  return {schema:'wxslim-official-plan-v1', status:'PLANNED_NOT_EXECUTED', recipeId:before.recipeId, recipeSha256:before.recipeSha256, engineContract:before.engineContract, projectUsage:before.projectUsage,
    startupPrewarm:describeStartupPrewarm(cfg.engineProfile, customConversionContext()?.sourceRecipe),
    expectedPackageId:before.expectedManifest.packageVersion, inputs:before.snapshot.files, sources:before.snapshot.sources,
    options:o, pckMount:before.pckMount, toolchain:{transformer:cfg.transformer,transformerVersion:recipe.transformer.version,transformerSha256:recipe.transformer.sha256,plugin:recipe.plugin},
    taskRoot:cfg.output, convertedOutput:path.join(cfg.output,'converted'),
    execution:'official execute CONFIG --write; shared conversion core, explicit pinned toolchain, no private defaults',
    snapshotKeys:snapshotFileKeys(cfg), transformerCopied:false,...(before.storageAdapter?{storageAdapter:before.storageAdapter}:{}),...(before.officialC050Adapter?{officialC050Adapter:before.officialC050Adapter}:{}),...(before.loginCode?{loginCode:before.loginCode}:{}),
    appid:'NOT_READ_OR_SUPPLIED; placeholder until an explicitly private project configuration step',
    writeAuthorized:false, estimatedAdditionalBytes, budgetBytes, budgetEnforcement:'checkpoints and observation; not an OS disk quota', engineRun:'NOT_RUN', phone:'NOT_RUN', visual:'NOT_VERIFIED'};
}

export function auditOfficialOutput(cfg, before) {
  assert(cfg.output, 'output required');
  assertSnapshotUnchanged(before.snapshot, snapshotInputs(cfg));
  const audit = auditConvertedInputs({output:cfg.output, before});
  const mini = path.join(cfg.output, 'minigame');
  assert.deepEqual(json(path.join(mini,'godot-data/render-config.json')), before.expectedManifest, 'recomputed identity, options and adapter source');
  const report = json(path.join(cfg.output,'CONVERT_REPORT.json'));
  assert.equal(report.pckPath, before.pckMount, 'PCK mount path');
  assert.deepEqual(report.engineContract,before.engineContract, 'conversion report engine contract');
  for (const name of ['render-runtime.js','custom-package.js','single-entry.js','wx-compat.js']) assert(read(path.join(mini,'godot-data',name)).equals(read(path.join(home,'assets',name))), 'direct asset differs: '+name);
  assert(read(path.join(mini,'godot-data/local-interfaces.js')).equals(read(cfg.interfaces)), 'actual interfaces differ');
  const entry = read(path.join(mini,'game.js')).toString();
  const imports = [...entry.matchAll(/import\s+['"]\.\/godot-data\/([^'";]+)['"]/g)].map(m => m[1].replace(/\.js$/, ''));
  for (const name of ['render-config','render-runtime','package-info','custom-package','single-entry','wx-compat','local-interfaces']) assert.equal(imports.filter(x => x === name).length, 1, 'exactly one active import: '+name);
  assert(imports.indexOf('wx-compat') < imports.indexOf('local-interfaces'), 'compat before game interfaces');
  for (const name of ['wx-split.js','wxslim-timing.js','wxslim-sizes.js']) {
    assert(!fs.existsSync(path.join(mini,'godot-data',name)), 'unexpected disabled asset: '+name);
    assert(!entry.includes(name.replace('.js','')), 'unexpected disabled entry: '+name);
  }
  const pluginCfg = json(path.join(mini,'wx-game-kit/config.json'));
  checkRuntimeSettings({game:json(path.join(mini,'game.json')), project:json(path.join(mini,'project.config.json')), plugin:pluginCfg,
    framework:read(path.join(mini,'framework.js')).toString(), packageInfo:read(path.join(mini,'godot-data/package-info.js')).toString(), options:cfg.options, mount:before.pckMount, engineContract:before.engineContract});
  assert.equal(pluginCfg.launch.code.fileMD5, md5(read(cfg.wasm)).slice(0,15));
  assert.deepEqual(fs.readdirSync(path.join(mini,'wasmcode')).filter(n => n.endsWith('.wasm.br')), [pluginCfg.launch.code.fileMD5+'.wasm.br']);
  assert.deepEqual(fs.readdirSync(path.join(mini,'data-package')).filter(n => n.endsWith('.data.bin')), [pluginCfg.launch.data.fileMD5+'.data.bin']);
  assertSnapshotUnchanged(before.snapshot, snapshotInputs(cfg));
  return {...audit, recipeId:before.recipeId, recipeSha256:before.recipeSha256, engineContract:before.engineContract, projectUsage:before.projectUsage, sourceSnapshotsMatch:true, expectedManifestMatches:true,
    pairingProvenance:before.pairAudit.provenance, buildRecordReaudited:false, pckContentsVisualAcceptance:'NOT_INHERITED',
    scope:'Read-only exact input pair, active copied assets, identity/options/import/export audit. No engine execution or device acceptance inferred.'};
}

export function publicCheckSummary(before) {
  return {schema:'wxslim-official-input-summary-v1', status:before.status, recipeId:before.recipeId, recipeSha256:before.recipeSha256,
    packageId:before.expectedManifest.packageVersion, requestedMode:before.expectedManifest.requestedMode, engineContract:before.engineContract, projectUsage:before.projectUsage,
    inputs:before.snapshot.files, sourceFingerprints:before.snapshot.sources, pckMount:before.pckMount,...(before.storageAdapter?{storageAdapter:before.storageAdapter}:{}),...(before.officialC050Adapter?{officialC050Adapter:before.officialC050Adapter}:{}),...(before.loginCode?{loginCode:before.loginCode}:{}),
    imports:before.pairAudit.imports.length, exports:before.pairAudit.exports.length, bindings:before.pairAudit.jsImportBindings,
    provenance:before.pairAudit.provenance, buildRecordReaudited:before.engineContract?.profile===CUSTOM_PAIR_PROFILE &&
      customConversionContext()!==null && before.pairAudit.buildRecordReaudited===true, warnings:before.inputCheck.warnings,
    engineRun:'NOT_RUN', phone:'NOT_RUN', visual:'NOT_VERIFIED'};
}

export function checkRuntimeSettings({game, project, plugin, framework, packageInfo, options, mount, engineContract = null}) {
  const recipe = getOfficialRecipe(engineContract?.profile ?? 'full');
  assert.equal(game.deviceOrientation, options.orientation, 'actual game orientation');
  assert.equal(project.projectname, options.name, 'actual developer-tool project name');
  assert.equal(plugin.project?.app?.name, options.name, 'actual plugin app name');
  assert.deepEqual(plugin.runtime?.contextConfig, {contextType:2,contextAttributes:recipe.contextAttributes,contextExt:{enableGLX:options.renderMode==='glx',enableMetal:false}}, 'actual fixed context attributes');
  const starts = [...framework.matchAll(/__WXSLIM_GODOT_BRIDGE__\.start\(Godot,Module,\{autoCallMainAfterMount:true,renderMode:("(?:\\.|[^"\\])*"),locale:("(?:\\.|[^"\\])*"),expectedPackBytes:/g)];
  assert.equal(starts.length, 1, 'unique fixed converter bridge options');
  assert.equal(JSON.parse(starts[0][1]), options.renderMode, 'actual bridge mode');
  assert.equal(JSON.parse(starts[0][2]), options.locale, 'actual bridge locale');
  const assignment = /^\s*GameGlobal\.__WXSLIM_PACKAGE_META__\s*=\s*(\{[\s\S]*\})\s*;\s*$/.exec(packageInfo);
  assert(assignment, 'package meta must be a single JSON assignment');
  const meta = JSON.parse(assignment[1]);
  assert.equal(meta.pck?.filename, mount, 'actual runtime PCK mount');
  assert.equal(meta.remotePackageName, options.name + '.data', 'actual package name');
  if (engineContract !== null) {
    assert.deepEqual(meta.engineContract,engineContract, 'actual package engine contract');
    assert.equal(meta.engineMode,engineContract.profile + '_engine_not_split', 'actual engine module profile / unsplit WASM');
  }
}

// Recreate the transformer's JS input in memory from a completed custom build.
// The PCK and remaining conversion inputs are checked separately by the task.
export async function checkCustomTransformerInput(preparationConfig, renderMode, locale, project) {
  assert(['webgl','glx'].includes(renderMode), 'explicit render mode required');
  assert(typeof locale === 'string' && locale.trim() && locale.length <= 128, 'explicit locale required');
  const prepared = await readPreparedSource(preparationConfig);
  let usage, projectFiles;
  if (project !== undefined) {
    assert.deepEqual(Object.keys(project).sort(), ['declaration','pck']);
    projectFiles = {pck:read(project.pck), declaration:read(project.declaration)};
    usage = checkCustomProjectUsage(prepared.summary.features, projectFiles.pck, JSON.parse(projectFiles.declaration));
  }
  const observerPath = path.join(home, 'assets', 'render-observer.js');
  const observer = read(observerPath);
  const glue = prepareTransformerGlue({js:prepared.js, observer:observer.toString('utf8'),
    bridgeTemplate:prepared.bridge.toString('utf8'), renderMode, locale});
  new Script(glue.source, {filename:'godot-bridged.js'});
  await prepared.recheck();
  assert(read(observerPath).equals(observer), 'observer changed during check');
  if (projectFiles) {
    for (const key of ['pck','declaration']) assert(read(project[key]).equals(projectFiles[key]), 'project input changed: ' + key);
  }
  return {profile:CUSTOM_PAIR_PROFILE, status:'TRANSFORMER_JS_INPUT_CHECKED', renderMode, locale,
    customSource:{taskId:prepared.summary.taskId, sourcePlanSha256:prepared.summary.sourcePlanSha256,
      preparationReceiptSha256:prepared.preparation.receipt.sha256},
    preparedJs:prepared.summary.outputJs, wasm:prepared.summary.inputs.wasm,
    observer:bytesIdentity(observer), transformerJs:bytesIdentity(Buffer.from(glue.source)),
    renderedBridge:bytesIdentity(Buffer.from(glue.bridge)), ...(usage ? {projectUsage:usage} : {}),
    converterExecuted:false, runtime:'NOT_RUN'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, config, ...extra] = process.argv.slice(2);
    let result;
    if (action === 'custom-project-plan') {
      assert(config && extra.length === 1, 'custom-project-plan FEATURES.json STARTUP.pck');
      result = planCustomProjectUsage(json(config), read(extra[0]));
    } else if (action === 'custom-input-check') {
      assert(config && [2,4].includes(extra.length), 'custom-input-check PREPARATION.json glx|webgl LOCALE [STARTUP.pck USAGE.json]');
      result = await checkCustomTransformerInput(config, extra[0], extra[1],
        extra.length === 4 ? {pck:extra[2], declaration:extra[3]} : undefined);
    } else if (action === 'custom-output-audit') {
      assert(config && extra.length === 1, 'custom-output-audit PREPARATION.json MINIGAME_DIRECTORY');
      result = await auditCompletedCustomC050Output({preparationConfig:config, project:path.resolve(extra[0])});
    } else if (action === 'cancel' || action === 'status') {
      assert(config && extra.length===1, 'cancel|status TASK_ROOT TASK_ID');
      const {requestCancellation,inspectTask}=await import('./lib/official-task.mjs');
      result = action==='cancel' ? requestCancellation(path.resolve(config),extra[0]) : inspectTask(path.resolve(config),extra[0]);
    } else if (action === 'execute') {
      assert(config && extra.length===1 && extra[0]==='--write', 'execute CONFIG --write requires explicit output authorization');
      result=await withOfficialConfiguration(config,()=>executeOfficial(readConfiguration(config),{writeAuthorized:true}));
      if(result.status!=='SUCCESS')process.exitCode=result.status==='CANCELLED'?2:1;
    } else {
      assert(['check','plan','audit'].includes(action) && config && !extra.length, 'check|plan|audit CONFIG; read-only');
      result = await withOfficialConfiguration(config,()=>{
        const cfg = readConfiguration(config), before = checkOfficialInputs(cfg);
        return action === 'check' ? publicCheckSummary(before) : action === 'plan' ? conversionPlan(cfg,before) : auditOfficialOutput(cfg,before);
      });
    }
    console.log(JSON.stringify(result,null,2));
  } catch (e) {
    // Detailed native messages may contain private paths; keep CLI failure output bounded.
    const message = e.code === 'ENOENT' ? '输入或配置文件不存在，请在本机核对显式路径。' : e.code === 'EACCES' ? '无法读取输入或配置，请在本机核对权限。' : '官方路线操作未通过；请核对配置或任务目录中的本地记录。不会自动重试或覆盖。';
    console.error(JSON.stringify({schema:'wxslim-official-error-v1',status:'FAILED',code:e.code || 'OFFICIAL_CHECK_FAILED',message, engineRun:'NOT_RUN'}));
    process.exitCode=1;
  }
}
