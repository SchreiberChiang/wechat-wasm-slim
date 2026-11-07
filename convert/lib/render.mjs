import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {sha, normalizeRenderMode, normalizeLoadingPage} from './inputs.mjs';
import {DISTRIBUTION_SOURCE_FILES} from './distribution-notices.mjs';

export const RENDER_SCHEMA = 'wxslim-render-config-v1';
const asset = name => fs.readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');
export function instrumentRender(js, observer = asset('render-observer.js')) {
  const anchor = 'installWXGLXPatches();';
  if (js.split(anchor).length !== 2) throw Error('GL 上下文观察锚点不唯一或不存在：installWXGLXPatches(); 请先用 doctor 核对微信引擎，不能猜测实际上下文。');
  for (const token of ['wxGLXHasNativeBindings', 'wxGLXCallNative', 'wxGLXGetNativeExport', 'wxGLXGetRoot', 'GLctx']) {
    if (!js.includes(token)) throw Error('GL 上下文观察缺少引擎约定：' + token);
  }
  return js.replace(anchor, () => anchor + '\n' + observer);
}
export function renderManifest({renderMode, js, wasm, pck, godotVersion, transformerVersion, pluginVersion, runtimeOptions = {}}) {
  const requestedMode = normalizeRenderMode(renderMode);
  const profile = runtimeOptions.engineContract?.profile;
  const c050 = ['full-official-c050-dev','conservative-official-c050-dev','full-official-c050-capability-dev','custom-official-c050-dev'].includes(profile);
  runtimeOptions = {...runtimeOptions, loadingPage: normalizeLoadingPage(runtimeOptions.loadingPage)};
  // Content identity, including uncommitted adapter edits. No input paths or account data.
  const adapterSha256 = sha(Buffer.concat(['../convert.mjs', './conversion-core.mjs', './inputs.mjs', './render.mjs', '../../lib/login-code-interfaces.mjs', '../assets/startup-failure.js', '../assets/godot-bridge.js', '../assets/render-runtime.js', '../assets/render-observer.js', '../assets/asset-gate.js', '../assets/custom-package.js', '../assets/single-entry.js', '../assets/wx-compat.js', '../../godot-addon/addons/wx_split/wx_split.js', '../../split/assets/wxslim-timing.js']
    .concat(runtimeOptions.loginCode?['../assets/login-code-runtime.js']:[])
    .concat(['./storage-adapter.mjs','../official-upstream-read-recipe.json','../../engine/fixed-source-audit.mjs','../../engine/upstream-wxmemfs-rule.mjs',
      '../../engine/upstream-wxmemfs-correctness.mjs','../../engine/upstream-wxmemfs-correctness.patch',
      '../../engine/upstream-wxmemfs-read-contract.mjs','../../engine/upstream-wxmemfs-read-contract.patch','../../engine/upstream-wxmemfs.LICENSE'])
    .concat(c050?['../official-c050-recipe.json','./official-c050-adapter.mjs',
      './secure-random-bridge.mjs','../assets/secure-random-host.js','../assets/secure-random-lifecycle.js',
      '../../engine/official-upstream-storage-tail.json','./official-engine-admission.mjs','./official-contract.mjs','../../engine/official-glx-library/audit-linkage.cjs']:[])
    .concat(runtimeOptions.engineContract?.profile==='conservative-official-c050-dev'?['../official-c050-conservative-recipe.json']:[])
    .concat(['full-official-c050-capability-dev','custom-official-c050-dev'].includes(profile)?['../official-c050-capability-recipe.json']:[])
    .concat(profile==='custom-official-c050-dev'?['./official-custom-context.mjs','./custom-project-usage.mjs','../../lib/custom-pair-task.mjs','../../lib/pck-inventory.mjs']:[])
    .concat(c050?DISTRIBUTION_SOURCE_FILES.map(p=>'../../'+p):[])
    .map(name => fs.readFileSync(fileURLToPath(new URL(name, import.meta.url))))));
  const inputs = {engineJsSha256: sha(js), wasmSha256: sha(wasm), pckSha256: sha(pck)};
  return {schema: RENDER_SCHEMA, requestedMode, fallback: 'error',
    packageVersion: 'wxslim-' + sha(JSON.stringify({requestedMode, adapterSha256, ...inputs, godotVersion, transformerVersion, pluginVersion, runtimeOptions})).slice(0, 20),
    adapterSha256, ...inputs, runtimeOptions, versions: {godot: godotVersion, transformer: transformerVersion, wxGameKit: pluginVersion}};
}
