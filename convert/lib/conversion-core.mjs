// Shared conversion packaging core. Transformer process ownership belongs to its caller.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sha, md5, pckMountPath, MODULE_TAIL, FRAMEWORK_ANCHORS as FA, GAMEJS_ANCHORS as GA, transformerConfig, normalizeRenderMode, normalizeLoadingPage, configureLoadingPage, checkInputs} from './inputs.mjs';
import {instrumentRender, renderManifest} from './render.mjs';
import {renderDistributionNotices} from './distribution-notices.mjs';
import {prepareLoginCodeInterfaces} from '../../lib/login-code-interfaces.mjs';
import {CUSTOM_PAIR_PROFILE} from '../../lib/custom-pair-task.mjs';
import {customConversionContext} from './official-custom-context.mjs';
import {checkCustomProjectUsage} from './custom-project-usage.mjs';
import {PLACEHOLDER_APPID} from './verify.mjs';
import {STORAGE_PROFILE,prepareStorageAdapter,readStorageSource,inspectStorageAdapterOutput} from './storage-adapter.mjs';
import {OFFICIAL_C050_PROFILE,OFFICIAL_C050_CONSERVATIVE_PROFILE,OFFICIAL_C050_CAPABILITY_PROFILE,isOfficialC050Profile,prepareOfficialC050Adapter,inspectOfficialC050AdapterOutput,checkOfficialC050Inputs} from './official-c050-adapter.mjs';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
function replaceOnce(s, a, b, label) { const n = s.split(a).length - 1; if (n !== 1) throw Error(`补丁锚点${n ? '不唯一' : '找不到'}：${label}（转换器版本变了？需要重新核对）`); return s.replace(a, () => b); }

// Construct exactly the source passed to wx-transformer. The caller owns
// input admission, the engine/bridge selection and any filesystem writes.
export function prepareTransformerGlue({js, observer, bridgeTemplate, locale, renderMode}) {
  const source = instrumentRender(js.toString('utf8'), observer);
  const at = source.lastIndexOf(MODULE_TAIL);
  assert(at >= 0, 'missing engine module tail');
  const localized = replaceOnce(bridgeTemplate, '__WXSLIM_LOCALE__', JSON.stringify(locale), 'locale');
  const bridge = replaceOnce(localized, '__WXSLIM_RENDER_MODE__', JSON.stringify(renderMode), 'render mode');
  return {source: source.slice(0, at) + '\n' + bridge, bridge};
}

// Static source embedding, not eval. Installing this helper performs no UI/IO;
// only an explicit caught failure reports, and only user confirmation copies.
export function startupFailureAsset(source) {
  return '(function(root){\nvar module={exports:{}};\n'+source+'\ntry {\n'+
    'if(!root.__WXSLIM_STARTUP_FAILURE__)root.__WXSLIM_STARTUP_FAILURE__=module.exports({wx:root.wx||(typeof wx!=="undefined"?wx:null),packageId:root.__WXSLIM_RENDER_CONFIG__.packageVersion,logger:function(line){console.error(line);}});\n'+
    '}catch(_){try{console.error("[STARTUP_FAILURE] HELPER_INSTALL_FAILED");}catch(__){}}\n'+
    '})(typeof GameGlobal!=="undefined"?GameGlobal:globalThis);\n';
}

// Metadata from the caller's registered-pair preflight. The shared raw converter
// does not claim build admission merely because a caller supplies this envelope.
export function copyEngineContract(value) {
  if (value === undefined || value === null) return null;
  assert(typeof value === 'object' && !Array.isArray(value));
  const custom = value.profile===CUSTOM_PAIR_PROFILE ? customConversionContext() : null;
  assert.deepEqual(Object.keys(value).sort(), ['profile','projectUsageSha256','recipeId','recipeSha256',...(custom?['customSource']:[])].sort(), 'exact engine contract');
  assert(custom || ['full','conservative',STORAGE_PROFILE,OFFICIAL_C050_PROFILE,OFFICIAL_C050_CONSERVATIVE_PROFILE,OFFICIAL_C050_CAPABILITY_PROFILE].includes(value.profile), 'engine profile');
  if (custom) assert.deepEqual(value.customSource,custom.customSource,'completed custom source required');
  assert(typeof value.recipeId === 'string' && /^[a-z0-9-]+$/.test(value.recipeId), 'recipe id');
  assert(typeof value.recipeSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.recipeSha256), 'recipe hash');
  assert(!custom && !['conservative',OFFICIAL_C050_CONSERVATIVE_PROFILE].includes(value.profile) ? value.projectUsageSha256 === null : typeof value.projectUsageSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.projectUsageSha256), 'PCK usage declaration hash');
  return Object.freeze({...value,...(custom?{customSource:custom.customSource}:{})});
}

/** Writes a newly claimed output only. Hooks own execution, cancellation and events. */
export async function convertProject(params, hooks) {
  const {tc, inp, out, renderMode, loadingPage, orientation, locale, name, interfaces, compat, splitBridge, timing, appid, appidSource} = params;
  const engineContract = copyEngineContract(params.engineContract);
  if(params.loginCode!==undefined)assert(typeof params.loginCode==='boolean','loginCode must be an explicit boolean');
  if(params.loginCode===true)assert(isOfficialC050Profile(engineContract?.profile),'loginCode requires a fixed official C050 profile');
  if (typeof hooks?.runTransformer !== 'function') throw Error('runTransformer hook required');
  // Capture small host assets before yielding; edits while the external converter is
  // running must not change which host bytes this operation subsequently packages.
  const assets = new Map(['godot-bridge.js', 'render-observer.js', 'asset-gate.js', 'render-runtime.js', 'custom-package.js', 'single-entry.js', 'wx-compat.js', 'local-interfaces.js', 'startup-failure.js']
    .map(n => [n, fs.readFileSync(path.join(home, 'assets', n), 'utf8')]));
  const asset = n => { if (!assets.has(n)) throw Error('asset not captured: ' + n); return assets.get(n); };
  const login=prepareLoginCodeInterfaces(interfaces ? fs.readFileSync(interfaces) : Buffer.from(asset('local-interfaces.js')),params.loginCode===true);
  const interfaceBytes=login.source;
  const splitBytes = splitBridge ? fs.readFileSync(path.join(home, '../godot-addon/addons/wx_split/wx_split.js')) : null;
  const timingBytes = timing ? fs.readFileSync(path.join(home, '../split/assets/wxslim-timing.js')) : null;
  const stage = async stage => { await hooks.checkpoint?.(stage); await hooks.onEvent?.({stage}); };
  await stage('PREPARE');
  normalizeRenderMode(renderMode); normalizeLoadingPage(loadingPage);
  if (!['portrait', 'landscape'].includes(orientation)) throw Error('--orientation 只能是 portrait 或 landscape');
  for (const [key, value] of Object.entries({compat, splitBridge, timing})) if (typeof value !== 'boolean') throw Error('explicit boolean required: ' + key);
  const originalJsBytes=fs.readFileSync(inp.js),wasmBytes=fs.readFileSync(inp.wasm);
  if (engineContract?.profile===CUSTOM_PAIR_PROFILE) {
    const custom=customConversionContext(), recipe=custom.record.recipe;
    assert.equal(tc.transformerSha256,recipe.transformer.sha256,'custom converter fingerprint');
    assert.equal(tc.transformerVersion,recipe.transformer.version,'custom converter version');
    assert.deepEqual(tc.plugin,recipe.plugin,'custom host plugin');
    const usage=checkCustomProjectUsage(recipe.features,fs.readFileSync(inp.pck),params.projectUsage);
    assert.equal(engineContract.projectUsageSha256,sha(JSON.stringify(usage.declaration)),'custom PCK declaration changed');
    await custom.recheck();
  }
  let storageAdapter=null;
  if(engineContract?.profile===STORAGE_PROFILE) {
    storageAdapter=prepareStorageAdapter({profile:engineContract.profile,js:originalJsBytes,wasm:wasmBytes,sourceBytes:readStorageSource(params.upstreamSource)});
    for(const k of ['profile','recipeId','recipeSha256'])assert.equal(engineContract[k],storageAdapter.receipt[k],'storage engine contract '+k);
  } else assert.equal(params.upstreamSource,undefined,'upstreamSource requires explicit storage development profile');
  const c050Adapter=isOfficialC050Profile(engineContract?.profile)?prepareOfficialC050Adapter({profile:engineContract.profile,js:originalJsBytes,wasm:wasmBytes}):null;
  if(c050Adapter)for(const k of ['profile','recipeId','recipeSha256'])assert.equal(engineContract[k],c050Adapter.receipt[k],'official C050 engine contract '+k);
  const r=c050Adapter?checkOfficialC050Inputs(inp,c050Adapter):checkInputs(inp);if(!r.ok)throw Error('输入检查没通过（见上面 ✗）');
  if (!fs.existsSync(tc.transformer)) throw Error('找不到官方 wx-transformer：' + tc.transformer + '（在 convert.toolchain.json 里改路径，或用 --toolchain 指定）');
  if (sha(fs.readFileSync(tc.transformer)) !== tc.transformerSha256) throw Error('wx-transformer 的 sha256 与 convert.toolchain.json 里的 pin 不一致：换了版本要先核对补丁锚点');
  if (interfaces && !fs.existsSync(interfaces)) throw Error('找不到 --interfaces 文件：' + interfaces);
  // 1. 在 Godot 引擎 JS 的模块定义末尾接上启动桥（原始导出文件不改）。
  fs.mkdirSync(out); // atomic claim: existing outputs are never reused or overwritten
  const work = path.join(out, 'convert-work'); fs.mkdirSync(work);
  const effectiveJs=storageAdapter?.effectiveJs??originalJsBytes;
  const glue = prepareTransformerGlue({js:effectiveJs, observer:asset('render-observer.js'),
    bridgeTemplate:c050Adapter ? c050Adapter.bridge.toString('utf8') : asset('godot-bridge.js'), locale, renderMode});
  const rendering = renderManifest({renderMode, js:effectiveJs, wasm:wasmBytes, pck: fs.readFileSync(inp.pck), godotVersion: r.facts.godotVersion, transformerVersion: tc.transformerVersion, pluginVersion: tc.plugin.version,
    runtimeOptions: {orientation, locale, name, compat, splitBridge, loadingPage, timing: timing, interfacesSha256: sha(interfaceBytes), ...(engineContract?{engineContract}:{}),...(storageAdapter?.runtimeOptions??{}),...(c050Adapter?.runtimeOptions??{}),...(login.receipt?{loginCode:login.receipt}:{})}});
  if(storageAdapter)writeJson(path.join(work,'STORAGE_ADAPTER.json'),storageAdapter.receipt);
  if(c050Adapter)writeJson(path.join(work,'OFFICIAL_C050_ADAPTER.json'),c050Adapter.receipt);
  const bridged = path.join(work, 'godot-bridged.js');
  const bridge = glue.bridge;
  fs.writeFileSync(bridged, glue.source);

  // 2. 官方转换器：复制 WXGameKit 模板、改写 JS 胶水为 framework.js、brotli 压缩 WASM、转换符号表。AppID 用占位符，转换后再填。
  const tcfg = transformerConfig({jsFile: bridged, wasmFile: inp.wasm, symbolsFile: inp.symbols, outputDir: path.join(work, 'transformer-out'), appID: PLACEHOLDER_APPID, appName: name, engineVersion: r.facts.godotVersion, orientation, renderMode});
  writeJson(path.join(work, 'transformer.config.json'), tcfg);
  await stage('TRANSFORM');
  const t0 = Date.now(), run = await hooks.runTransformer({executable:tc.transformer, args:['--config', path.join(work, 'transformer.config.json')], cwd:work,
    stdoutPath:path.join(work, 'transformer.stdout.txt'), stderrPath:path.join(work, 'transformer.stderr.txt')});
  if (run.status !== 0 || !fs.existsSync(path.join(tcfg.outputDir, 'minigame/framework.js'))) throw Error(`wx-transformer 失败（退出码 ${run.status}${run.error ? '，' + run.error.code : ''}），日志在 ${work}`);
  await stage('PACKAGE');
  const mini = path.join(out, 'minigame'); fs.renameSync(path.join(tcfg.outputDir, 'minigame'), mini);
  if (fs.existsSync(path.join(tcfg.outputDir, 'webgl'))) fs.renameSync(path.join(tcfg.outputDir, 'webgl'), path.join(out, 'webgl'));
  // Keep transformer-out residuals as evidence; never recursively remove a directory.
  const f = rel => path.join(mini, rel);

  // 3. framework.js：转换器加的资源依赖改由“数据校验通过才释放”的门控制。
  let fw = fs.readFileSync(f('framework.js'), 'utf8');
  replaceOnce(fw, FA.bridge, '', '启动桥');
  fw = replaceOnce(fw, FA.preloadAssets, "Module.__WXSLIM_ADD_ASSET_GATE__('converter');", 'wasm-preloadAssets');
  fw = replaceOnce(fw, FA.createWasm, asset('asset-gate.js') + FA.createWasm, 'createWasm');
  if(storageAdapter)inspectStorageAdapterOutput(Buffer.from(fw),storageAdapter,{bridge});
  if(c050Adapter)inspectOfficialC050AdapterOutput(Buffer.from(fw),c050Adapter,{bridge});
  fs.writeFileSync(f('framework.js'), fw);

  // 4. WASM 文件名改为 15 位 md5（官方 switch-md5 只认 15 位），并确认压缩包能还原出原 WASM。
  const cfgFile = f('wx-game-kit/config.json'), cfg = readJson(cfgFile), wasm = fs.readFileSync(inp.wasm), id = md5(wasm).slice(0, 15);
  if (cfg.runtime?.contextConfig?.contextExt?.enableGLX !== (renderMode === 'glx') || cfg.runtime?.contextConfig?.contextExt?.enableMetal !== false || cfg.runtime?.contextConfig?.contextType !== 2) throw Error('转换器产物渲染配置与请求不一致，拒绝生成可运行候选');
  const brOld = f(`wasmcode/${cfg.launch.code.fileMD5}.wasm.br`), brNew = f(`wasmcode/${id}.wasm.br`);
  if (!zlib.brotliDecompressSync(fs.readFileSync(brOld)).equals(wasm)) throw Error('转换器压缩出的 WASM 解压后与输入不一致');
  fs.renameSync(brOld, brNew); cfg.launch.code.fileMD5 = id; cfg.launch.code.useWasmCodeSplit = false;

  // 5. 首包数据：说明文件 + PCK（Emscripten file_packager 布局，PCK 必须在最后，split 的 PCK 替换依赖这一点）。
  const pck = fs.readFileSync(inp.pck), notice = Buffer.from('wechat-wasm-slim convert: this data package carries the Godot PCK (last file). No network assets.\n');
  const pckPath = pckMountPath(inp.pck);
  const data = Buffer.concat([notice, pck]), dataId = md5(data).slice(0, 16);
  const files = [{filename: '/WXSLIM-NOTICE.txt', start: 0, end: notice.length}, {filename: pckPath, start: notice.length, end: data.length}];
  for (const x of fs.readdirSync(f('data-package'))) if (x.endsWith('.data.bin')) fs.unlinkSync(f('data-package/' + x));
  fs.writeFileSync(f(`data-package/${dataId}.data.bin`), zlib.brotliCompressSync(data, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11}}));
  Object.assign(cfg.launch.data, {loadFromSubpackage: true, fileMD5: dataId, fileSize: data.length, optFileSize: data.length, isCompressed: true, subPrefix: ''});
  const meta = {remotePackageName: name + '.data', size: data.length, pck: files[1], pckBytes: pck.length, pckSha256: sha(pck), files, dataSha256: sha(data),
    engineMode:(engineContract?.profile || 'unregistered') + '_engine_not_split', ...(engineContract?{engineContract}:{})};

  // 6. 胶水文件和入口。
  fs.mkdirSync(f('godot-data'));
  writeJson(f('godot-data/render-config.json'), rendering);
  fs.writeFileSync(f('godot-data/render-config.js'), 'GameGlobal.__WXSLIM_RENDER_CONFIG__=' + JSON.stringify(rendering) + ';\n');
  fs.writeFileSync(f('godot-data/render-runtime.js'), asset('render-runtime.js'));
  fs.writeFileSync(f('godot-data/startup-failure.js'), startupFailureAsset(asset('startup-failure.js')));
  fs.writeFileSync(f('godot-data/package-info.js'), 'GameGlobal.__WXSLIM_PACKAGE_META__=' + JSON.stringify(meta) + ';\n');
  writeJson(f('godot-data/package.metadata.json'), {files, remote_package_size: data.length});
  for (const n of ['custom-package.js', 'single-entry.js']) fs.writeFileSync(f('godot-data/' + n), asset(n));
  // wx-compat.js 补通用适配运行时缺的浏览器对象（HTTP、WebSocket、键盘、震动），必须在游戏接口之前加载。
  if (compat) fs.writeFileSync(f('godot-data/wx-compat.js'), asset('wx-compat.js'));
  // wx-split.js 是 Godot 插件 addons/wx_split 的 JS 侧（点击门、采集包、自动测试开关的探测函数），和插件同一份源文件；不用插件的游戏装上也没有影响。
  if (splitBridge) fs.writeFileSync(f('godot-data/wx-split.js'), splitBytes);
  fs.writeFileSync(f('godot-data/local-interfaces.js'), interfaceBytes);
  let entry = fs.readFileSync(f('game.js'), 'utf8');
  entry = "import './godot-data/render-config';\nimport './godot-data/render-runtime';\nimport './godot-data/startup-failure';\nimport './godot-data/package-info';\n" + entry;
  // 加载计时汇总（和 split 共用 ../split/assets/wxslim-timing.js）：首包进场景、点进各场景、callMain 分解、帧率、内存。
  // 必须最先加载；split 组装时会按实际首包/余包大小覆盖 wxslim-sizes.js。--no-timing 不装。
  if (timing) {
    fs.writeFileSync(f('godot-data/wxslim-sizes.js'), 'GameGlobal.__WXSLIM_SIZES__=' + JSON.stringify({primaryBr: fs.statSync(brNew).size, code1Br: null, mode: 'nosplit'}) + ';\n');
    fs.writeFileSync(f('godot-data/wxslim-timing.js'), timingBytes);
    entry = "import './godot-data/wxslim-sizes';\nimport './godot-data/wxslim-timing';\n" + entry;
    if (entry.split(GA.startOk).length === 2) entry = entry.replace(GA.startOk, "GameGlobal.__WXSLIM_TIMING__.mark('loader_start_ok');\n    " + GA.startOk);
  }
  entry = replaceOnce(entry, GA.imports, "import './godot-data/custom-package';\nimport './godot-data/single-entry';\n" + (compat ? "import './godot-data/wx-compat';\n" : '') + (splitBridge ? "import './godot-data/wx-split';\n" : '') + "import './godot-data/local-interfaces';\n" + GA.imports, 'game.js import');
  entry = replaceOnce(entry, GA.handler, 'WXGameKit.loader.setModuleFunctionHandler(GameGlobal.__WXSLIM_CREATE_SINGLE_ENTRY__(commFrameWork));', 'setModuleFunctionHandler');
  entry = replaceOnce(entry, GA.startFail, "try{if(GameGlobal.__WXSLIM_STARTUP_FAILURE__)GameGlobal.__WXSLIM_STARTUP_FAILURE__.report({stage:'LOADER_START',code:'WXSLIM_RENDER_BOOT_FAILED'});}catch(_){}\n    GameGlobal.__WXSLIM_RENDER_DIAGNOSTIC__.fail(err);\n    " + GA.startFail, 'loader failure diagnostic');
  fs.writeFileSync(f('game.js'), entry);

  // 7. 配置：AppID、项目名；关掉开发期性能弹窗和默认 Unity 图标。
  cfg.project.app.appID = appid; cfg.project.app.name = name;
  configureLoadingPage(cfg, loadingPage);
  Object.assign(cfg.develop.monitor, {enable: false, showSuggestModal: false, showResultAfterLaunch: false}); cfg.develop.hideTimeLogModal = true; cfg.loadingPage.iconConfig.visible = false;
  writeJson(cfgFile, cfg);
  const pc = readJson(f('project.config.json')); pc.appid = appid; pc.projectname = name; pc.compileType = 'game';
  // 官方分包 CLI（wasmsplit-v2-ci init）只在工程目录里找符号表（默认 game.symbols.json）。放一份进工程，并从小游戏包里排除。
  const sym = path.join(out, 'webgl/symbols.json');
  if (splitBridge && fs.existsSync(sym)) {
    fs.copyFileSync(sym, f('game.symbols.json'));
    pc.packOptions ??= {}; pc.packOptions.ignore ??= [];
    if (!pc.packOptions.ignore.some(x => x.value === 'game.symbols.json')) pc.packOptions.ignore.push({type: 'file', value: 'game.symbols.json'});
  }
  writeJson(f('project.config.json'), pc);

  // Preserve attribution even when optimized JS has removed source comments.
  // Historical outputs are never patched in place.
  const notices=isOfficialC050Profile(engineContract?.profile)?renderDistributionNotices(engineContract.profile):null;
  if(notices)fs.writeFileSync(f(notices.path),notices.buffer,{flag:'wx'});

  await stage('FINAL');
  const result = {schema: 'wechat-wasm-slim-convert-v1', at: new Date().toISOString(), out, minigame: mini, symbols: fs.existsSync(path.join(out, 'webgl/symbols.json')) ? path.join(out, 'webgl/symbols.json') : null,
    ...(notices?{distributionNotices:notices.receipt}:{}),
    ...(login.receipt?{loginCode:login.receipt}:{}),
    inputs: Object.fromEntries(Object.entries(inp).filter(([, v]) => v).map(([k, v]) => [k, {path: v, sha256: sha(fs.readFileSync(v))}])),
    transformer: {version: tc.transformerVersion, sha256: tc.transformerSha256, ms: Date.now() - t0}, plugin: tc.plugin,
    appidSource, orientation, locale, compat, rendering, engineContract, ...(storageAdapter?{storageAdapter:storageAdapter.receipt}:{}),...(c050Adapter?{officialC050Adapter:c050Adapter.receipt}:{}),interfaces: interfaces || 'stub', codeMd5: id, dataMd5: dataId, pckPath, godotVersion: r.facts.godotVersion,
    sizes: {wasmBr: fs.statSync(brNew).size, dataBr: fs.statSync(f(`data-package/${dataId}.data.bin`)).size, pck: pck.length}};
  writeJson(path.join(out, 'CONVERT_REPORT.json'), result);
  return result;
}
