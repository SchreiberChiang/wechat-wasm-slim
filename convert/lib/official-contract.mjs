// Shared read-only official conversion contract. No engine execution or uploads.
// Accepts an already checked input record; does not load a build or community host.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {brotliDecompressSync} from 'node:zlib';
import {sha, FRAMEWORK_ANCHORS} from './inputs.mjs';
import {verifyProject} from './verify.mjs';
import {startupFailureAsset} from './conversion-core.mjs';
import {prepareStorageAdapter,readStorageSource,inspectStorageAdapterOutput,renderStorageBridge} from './storage-adapter.mjs';
import {isOfficialC050Profile,checkFixedPair} from './official-engine-admission.mjs';
import {prepareOfficialC050Adapter,inspectOfficialC050AdapterOutput} from './official-c050-adapter.mjs';
import {auditDistributionNotices} from './distribution-notices.mjs';
import {auditLoginCodeInterfaces} from '../../lib/login-code-interfaces.mjs';

const read = file => fs.readFileSync(file);
const json = file => JSON.parse(read(file));
const zero = /function\s+evalCheckWxContextGlobalIdAvailable\s*\(\s*\)\s*\{\s*return\s+0\s*;?\s*\}/g;
export function auditOptionalLoginCode(before,report,interfaceBytes){
  assert.equal(before.snapshot.effectiveOptions.loginCode===true,before.loginCode!==undefined,'login selection matches snapshot');
  assert.deepEqual(before.loginCode,report.loginCode,'login receipt matches preflight');
  assert.deepEqual(report.loginCode,report.rendering.runtimeOptions.loginCode,'login receipt matches manifest');
  assert.equal(sha(interfaceBytes),report.rendering.runtimeOptions.interfacesSha256,'login interface hash');
  const checked=auditLoginCodeInterfaces(interfaceBytes,before.loginCode??null);
  if(checked)assert.deepEqual(checked.inputs.baseInterfaces,before.snapshot.files.interfaces,'login base matches original input');
  return checked;
}
export function checkReturnZero(text) {
  assert.equal([...text.matchAll(/function\s+evalCheckWxContextGlobalIdAvailable\s*\(/g)].length, 1, 'unique ID function');
  assert.equal([...text.matchAll(zero)].length, 1, 'ID function must retain return 0');
  return true;
}
export function readImportBindings(text) {
  const matches = [...text.matchAll(/var wasmImports=\{([^}]+)\}/g)];
  assert.equal(matches.length, 1, 'one fixed-engine import map');
  const result = {};
  for (const item of matches[0][1].split(',')) {
    const pair = /^\s*([$\w]+)\s*:\s*([$\w]+)\s*$/.exec(item);
    assert(pair, 'unexpected import expression; review rather than evaluating it');
    assert(!Object.hasOwn(result, pair[1]), 'duplicate import binding');
    result[pair[1]] = pair[2];
  }
  return result;
}
export function bindManifest(actual, report, before) {
  assert.deepEqual(actual, report.rendering, 'actual runtime identity must equal conversion report');
  if(isOfficialC050Profile(before.engineContract?.profile)) {
    assert(!before.storageAdapter,'C050 cannot substitute the legacy storage adapter');
    bindOfficialC050Manifest(actual,report,before,rebuildOfficialC050Adapter(before));
  } else {
    for(const value of [before,report,actual.runtimeOptions??{}])assert(!Object.hasOwn(value,'officialC050Adapter'),'unexpected official C050 adapter');
  }
  for (const [field, key] of [['engineJsSha256', 'js'], ['wasmSha256', 'wasm'], ['pckSha256', 'pck']]) {
    assert.equal(actual[field], key==='js'&&before.storageAdapter?before.storageAdapter.effectiveJs.sha256:before.inputs[key].sha256, 'actual manifest input: ' + key);
  }
  if(before.storageAdapter) {
    assert.equal(before.storageAdapter.originalJs.sha256,before.inputs.js.sha256,'storage original JS must remain original input');
    assert.equal(before.storageAdapter.wasm.sha256,before.inputs.wasm.sha256,'storage original WASM');
    assert.deepEqual(report.storageAdapter,before.storageAdapter,'reported storage adapter');
    assert.deepEqual(actual.runtimeOptions.storageAdapter,before.storageAdapter,'runtime storage adapter');
    assert.equal(actual.runtimeOptions.storageBackend,'upstream-wxmemfs');
    assert.equal(actual.runtimeOptions.upstreamWxmemfsSha256,before.storageAdapter.derivedSource.sha256);
  } else assert.equal(report.storageAdapter,undefined,'unexpected storage adapter');
  return actual;
}

// Receipts supplied by the preflight/report are comparisons, never their own
// authentication. Rebuild from the actual registered input bytes and host pins.
function rebuildOfficialC050Adapter(before) {
  assert(isOfficialC050Profile(before.engineContract?.profile),'C050 output profile');
  const bytes=Object.fromEntries(['js','wasm'].map(key=>{
    const input=before.inputs[key];
    assert(typeof input?.path==='string'&&path.isAbsolute(input.path),'C050 absolute protected input '+key);
    const stat=fs.lstatSync(input.path);assert(stat.isFile()&&!stat.isSymbolicLink(),'C050 regular protected input '+key);
    const value=read(input.path);
    assert.equal(value.length,input.bytes,'C050 protected input bytes '+key);
    assert.equal(sha(value),input.sha256,'C050 protected input hash '+key);
    return [key,value];
  }));
  return prepareOfficialC050Adapter({profile:before.engineContract.profile,...bytes});
}
function bindOfficialC050Manifest(actual,report,before,adapter) {
  assert.deepEqual(before.officialC050Adapter,adapter.receipt,'recomputed official C050 preflight adapter');
  assert.deepEqual(report.officialC050Adapter,adapter.receipt,'reported official C050 adapter');
  assert.deepEqual(actual.runtimeOptions?.officialC050Adapter,adapter.receipt,'runtime official C050 adapter');
  for(const key of ['profile','recipeId','recipeSha256'])assert.equal(before.engineContract[key],adapter.receipt[key],'official C050 engine contract '+key);
  assert.deepEqual(actual.runtimeOptions.engineContract,before.engineContract,'official C050 runtime engine contract');
  assert.equal(actual.engineJsSha256,adapter.receipt.effectiveJs.sha256,'official C050 unchanged engine JS');
  assert.equal(actual.wasmSha256,adapter.receipt.wasm.sha256,'official C050 unchanged WASM');
  for(const key of ['storageBackend','upstreamWxmemfsSha256','secureRandomMode','secureRandomBridgeSha256'])
    assert.equal(actual.runtimeOptions[key],adapter.runtimeOptions[key],'official C050 runtime '+key);
  assert(!Object.hasOwn(actual.runtimeOptions,'storageAdapter')&&!Object.hasOwn(report,'storageAdapter'),'C050 legacy storage adapter field');
}
export function auditOfficialC050Framework({framework,before,actual,report,storedReceipt}) {
  assert(Buffer.isBuffer(framework),'C050 framework buffer');
  assert.deepEqual(actual,report.rendering,'actual runtime identity must equal conversion report');
  const adapter=rebuildOfficialC050Adapter(before);
  bindOfficialC050Manifest(actual,report,before,adapter);
  assert.deepEqual(storedReceipt,adapter.receipt,'stored official C050 adapter receipt');
  const bridge=renderStorageBridge(adapter.bridge.toString('utf8'),actual.requestedMode,actual.runtimeOptions.locale);
  return inspectOfficialC050AdapterOutput(framework,adapter,{bridge});
}
export function inventory(dir) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const full = path.join(current, entry.name), stat = fs.lstatSync(full);
      assert(!stat.isSymbolicLink(), 'no linked candidate file: ' + full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) files.push({path: path.relative(dir, full).replaceAll('\\', '/'), bytes: stat.size, sha256: sha(read(full))});
    }
  }
  walk(dir); return files.sort((a, b) => a.path.localeCompare(b.path));
}
// The pinned official host declares this directory even when it is empty.
// File hashes alone cannot prove that required empty directories survived copying.
export function checkWorkersDirectory(project, game) {
  assert.equal(game?.workers, 'workers', 'fixed official workers path required');
  const root = fs.lstatSync(project);
  assert(root.isDirectory() && !root.isSymbolicLink(), 'ordinary official project directory required');
  const directory = path.join(project, 'workers'), stat = fs.lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'ordinary workers directory required');
  const expected = path.join(fs.realpathSync(project), 'workers'), actual = fs.realpathSync(directory);
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  assert.equal(normalize(actual), normalize(expected), 'workers directory must remain inside the official project');
  return {path:'workers', directoryChecked:true, scope:'FILESYSTEM_DIRECTORY_ONLY_WORKER_RUNTIME_NOT_RUN'};
}
export function auditConvertedInputs({output, before}) {
  const report = json(path.join(output, 'CONVERT_REPORT.json'));
  assert.equal(before.status, 'PASS_STATIC_ONLY');
  const project = path.join(output, 'minigame'), game = json(path.join(project, 'game.json'));
  const workers = checkWorkersDirectory(project, game), checks = verifyProject(project, before.plugin);
  assert.deepEqual(checks.filter(row => row[0] === 'FAIL'), [], 'converted project contract');
  const actual = bindManifest(json(path.join(project, 'godot-data/render-config.json')), report, before);
  const distributionNotices=isOfficialC050Profile(before.engineContract?.profile)?
    auditDistributionNotices(before.engineContract.profile,read(path.join(project,'WXSLIM-THIRD-PARTY-NOTICES.txt')),report.distributionNotices):null;
  for (const key of ['js', 'wasm', 'pck']) assert.equal(report.inputs[key].sha256, before.inputs[key].sha256, 'conversion input ' + key);
  assert.equal(report.transformer.sha256, before.transformer.sha256);
  assert.deepEqual(report.plugin, before.plugin);
  const plugin = game.plugins?.WXGameKit;
  assert.equal(plugin?.version, before.plugin.version, 'actual plugin version');
  assert.equal(plugin?.provider, before.plugin.provider, 'actual plugin provider');
  assert.equal(report.rendering.runtimeOptions.splitBridge, false, 'no WASM split bridge in this candidate');
  const framework = read(path.join(project, 'framework.js')).toString(), entry = read(path.join(project, 'game.js')).toString();
  checkReturnZero(framework);
  assert.equal(framework.split(FRAMEWORK_ANCHORS.bridge).length, 2, 'single Godot bridge');
  assert.equal(framework.split('WXSLIM_RENDER_OBSERVER_V1').length, 2, 'single render observer');
  assert(!/missing function:|unresolved symbol:/i.test(framework), 'no generated missing-function placeholders');
  const cfg = json(path.join(project, 'wx-game-kit/config.json'));
  assert.equal(cfg.launch.code.useWasmCodeSplit, false);
  const compressed = read(path.join(project, 'wasmcode', cfg.launch.code.fileMD5 + '.wasm.br'));
  const wasm = brotliDecompressSync(compressed,{maxOutputLength:before.inputs.wasm.bytes});
  assert.equal(sha(wasm), before.inputs.wasm.sha256, 'WASM unchanged');
  if(isOfficialC050Profile(before.engineContract?.profile)) {
    const pair=checkFixedPair(read(before.inputs.js.path),wasm,before.engineContract.profile); // structural parsing only
    assert.deepEqual(pair.imports,before.pairAudit.imports,'imports unchanged');
    assert.deepEqual(pair.exports,before.pairAudit.exports,'exports unchanged');
  } else {
    const mod = new WebAssembly.Module(wasm); // validation only, no imports/start/main execution
    assert.deepEqual(WebAssembly.Module.imports(mod), before.pairAudit.imports, 'imports unchanged');
    assert.deepEqual(WebAssembly.Module.exports(mod), before.pairAudit.exports, 'exports unchanged');
  }
  const originalJs = read(before.inputs.js.path);
  assert.equal(sha(originalJs), before.inputs.js.sha256, 'protected source JS unchanged');
  let storageCheck=null;
  if(before.storageAdapter) {
    const adapter=prepareStorageAdapter({profile:before.engineContract.profile,js:originalJs,wasm,sourceBytes:readStorageSource(before.inputs.upstreamSource.path)});
    assert.deepEqual(adapter.receipt,before.storageAdapter,'recomputed storage adapter');
    const options=actual.runtimeOptions;
    const bridge=renderStorageBridge(read(new URL('../assets/godot-bridge.js',import.meta.url)).toString(),actual.requestedMode,options.locale);
    storageCheck=inspectStorageAdapterOutput(Buffer.from(framework),adapter,{bridge});
    assert.deepEqual(json(path.join(output,'convert-work/STORAGE_ADAPTER.json')),adapter.receipt,'stored adapter receipt');
  }
  const officialC050Check=isOfficialC050Profile(before.engineContract?.profile)?auditOfficialC050Framework({framework:Buffer.from(framework),before,actual,report,
    storedReceipt:json(path.join(output,'convert-work/OFFICIAL_C050_ADAPTER.json'))}):null;
  const bindings = readImportBindings(framework);
  assert.deepEqual(bindings, readImportBindings(originalJs.toString()), 'JS import bindings unchanged by conversion');
  for (const item of before.pairAudit.imports) {
    assert.equal(item.module, 'a', 'fixed engine import namespace');
    assert(Object.hasOwn(bindings, item.name), 'WASM import has JS binding: ' + item.name);
  }
  for (const [name, symbol] of Object.entries(before.pairAudit.nativeMapping)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...framework.matchAll(new RegExp('Module\\["' + escaped + '"\\]\\s*=\\s*' + escaped + '\\s*=\\s*wasmExports\\["([^"\\n]+)"\\]', 'g'))];
    assert.equal(matches.length, 1, 'GLX export mapping count: ' + name);
    assert.equal(matches[0][1], symbol, 'GLX export mapping: ' + name);
  }
  assert(/registerAfterDoFrame\(function\(\)\{return Module\._glxCommandBufferFlush\(\);?\}\)/.test(framework), 'library submission retained');
  assert(framework.includes('Module.wxContextGlobal.batchRenderAsync(') && framework.includes('Module.wxContextGlobal.swapWindow('), 'library submission imports retained');
  const files = inventory(project);
  for (const name of ['weapp-adapter.js', 'glx-config.js', 'godot-loader.js', 'engine/game.js', 'engine/godot-sdk.js', 'godot-data/wx-split.js', 'wasm-split.js']) {
    assert(!files.some(row => row.path === name), 'community host/split file not allowed: ' + name);
  }
  assert(!/hao0917|godot-loader|godot-sdk|weapp-adapter/.test(entry), 'no community host entry');
  const interfaceBytes=read(path.join(project,'godot-data/local-interfaces.js'));
  auditOptionalLoginCode(before,report,interfaceBytes);
  // Historical packages keep their original receipts. This audit validates a
  // newly generated current-host package, including the pre-scene failure UI.
  const failureSource=read(path.join(project,'godot-data/startup-failure.js')).toString();
  assert.equal(failureSource,startupFailureAsset(read(new URL('../assets/startup-failure.js',import.meta.url)).toString()),'startup failure helper bytes match captured source');
  assert(failureSource.includes('wxslim-startup-failure-v1') && failureSource.includes('__WXSLIM_STARTUP_FAILURE__'),'startup failure helper present');
  assert.equal(entry.split("import './godot-data/startup-failure';").length,2,'one startup failure helper import');
  assert(entry.indexOf("import './godot-data/startup-failure';") < entry.indexOf('import commFrameWork from'),'failure helper precedes framework evaluation');
  assert(entry.includes("stage:'LOADER_START',code:'WXSLIM_RENDER_BOOT_FAILED'"),'loader captured failure reports outside PCK');
  return {schema: 'wxslim-official-candidate-audit-v1', at: new Date().toISOString(), status: 'PASS_STATIC_ONLY',
    ...(distributionNotices?{distributionNotices}:{}),
    ...(before.loginCode?{loginCode:before.loginCode}:{}),
    packageId: actual.packageVersion, requestedMode: actual.requestedMode, workers,
    frameworkSha256: sha(framework), wasmSha256: sha(wasm), pckSha256: actual.pckSha256,
    returnZero: true,...(storageCheck?{storageAdapter:before.storageAdapter,storageCheck}:{}),
    ...(officialC050Check?{officialC050Adapter:before.officialC050Adapter,officialC050Check}:{}), imports: before.pairAudit.imports.length, exports: before.pairAudit.exports.length,
    jsImportBindings: Object.keys(bindings).length, jsImportBindingsUnchanged: true,
    nativeMapping: before.pairAudit.nativeMapping, checks, files,
    payloadBytes: files.reduce((sum, row) => sum + row.bytes, 0),
    nativeWrapperChange: 'Existing convert observer propagates GLX native initialization exceptions; runtime validation pending',
    engineRun: 'NOT_RUN', phone: 'NOT_RUN', visual: 'NOT_VERIFIED'};
}
