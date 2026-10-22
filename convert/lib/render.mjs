import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {sha, normalizeRenderMode} from './inputs.mjs';

export const RENDER_SCHEMA = 'wxslim-render-config-v1';
const asset = name => fs.readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');
export function instrumentRender(js) {
  const anchor = 'installWXGLXPatches();';
  if (js.split(anchor).length !== 2) throw Error('GL 上下文观察锚点不唯一或不存在：installWXGLXPatches(); 请先用 doctor 核对微信引擎，不能猜测实际上下文。');
  for (const token of ['wxGLXHasNativeBindings', 'wxGLXCallNative', 'wxGLXGetNativeExport', 'wxGLXGetRoot', 'GLctx']) {
    if (!js.includes(token)) throw Error('GL 上下文观察缺少引擎约定：' + token);
  }
  return js.replace(anchor, () => anchor + '\n' + asset('render-observer.js'));
}
export function renderManifest({renderMode, js, wasm, pck, godotVersion, transformerVersion, pluginVersion, runtimeOptions = {}}) {
  const requestedMode = normalizeRenderMode(renderMode);
  // Content identity, including uncommitted adapter edits. No input paths or account data.
  const adapterSha256 = sha(Buffer.concat(['../convert.mjs', './inputs.mjs', './render.mjs', '../assets/godot-bridge.js', '../assets/render-runtime.js', '../assets/render-observer.js', '../assets/asset-gate.js', '../assets/custom-package.js', '../assets/single-entry.js', '../assets/wx-compat.js', '../../godot-addon/addons/wx_split/wx_split.js', '../../split/assets/wxslim-timing.js']
    .map(name => fs.readFileSync(fileURLToPath(new URL(name, import.meta.url))))));
  const inputs = {engineJsSha256: sha(js), wasmSha256: sha(wasm), pckSha256: sha(pck)};
  return {schema: RENDER_SCHEMA, requestedMode, fallback: 'error',
    packageVersion: 'wxslim-' + sha(JSON.stringify({requestedMode, adapterSha256, ...inputs, godotVersion, transformerVersion, pluginVersion, runtimeOptions})).slice(0, 20),
    adapterSha256, ...inputs, runtimeOptions, versions: {godot: godotVersion, transformer: transformerVersion, wxGameKit: pluginVersion}};
}
