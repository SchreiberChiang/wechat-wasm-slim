// 离线检查通用适配（WXGameKit）小游戏工程的结构，条件对应 split/SETUP.md 第 3 节。
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {sha, md5} from './inputs.mjs';

export const PLACEHOLDER_APPID = 'wx0000000000000000';

export function verifyProject(dir, plugin) {
  const out = [];
  const pass = m => out.push(['PASS', m]), warn = m => out.push(['WARN', m]), fail = m => out.push(['FAIL', m]);
  const file = rel => path.join(dir, rel), has = rel => fs.existsSync(file(rel));
  const json = rel => { try { return JSON.parse(fs.readFileSync(file(rel), 'utf8')); } catch (e) { fail(rel + ' 读不出来或不是 JSON：' + e.message); return null; } };
  const text = rel => has(rel) ? fs.readFileSync(file(rel), 'utf8') : '';

  const required = ['game.js', 'game.json', 'project.config.json', 'framework.js', 'wx-game-kit/config.json', 'wx-game-kit/index.js', 'wx-game-kit/custom/index.js', 'godot-data/package-info.js', 'godot-data/custom-package.js', 'godot-data/single-entry.js'];
  const missing = required.filter(r => !has(r));
  if (missing.length) { fail('缺少文件：' + missing.join('、')); return out; }
  pass('基本文件齐全（game.js、game.json、project.config.json、framework.js、wx-game-kit/、godot-data/）');

  const game = json('game.json'), pc = json('project.config.json'), cfg = json('wx-game-kit/config.json');
  if (!game || !pc || !cfg) return out;
  const p = game.plugins?.WXGameKit;
  if (!p) fail('game.json 没有声明 WXGameKit 插件');
  else if (p.provider !== plugin.provider) fail(`game.json 的 WXGameKit provider 是 ${p.provider}，应为 ${plugin.provider}`);
  else { pass(`game.json 声明 WXGameKit 插件 ${p.provider} v${p.version}`); if (p.version !== plugin.version) warn(`插件版本 ${p.version} 与验证过的 ${plugin.version} 不同`); }
  const subs = (game.subpackages || game.subPackages || []).map(s => s.name);
  for (const s of ['wasmcode', 'data-package']) if (!subs.includes(s)) fail('game.json 分包里没有 ' + s);
  if (subs.includes('wasmcode') && subs.includes('data-package')) pass('game.json 分包包含 wasmcode、data-package');
  if (pc.compileType !== 'game') fail('project.config.json 的 compileType 不是 game');
  if (pc.appid !== cfg.project?.app?.appID) fail('project.config.json 和 wx-game-kit/config.json 的 AppID 不一致');
  if (!pc.appid || pc.appid === PLACEHOLDER_APPID || pc.appid === 'touristappid') warn('AppID 还是占位符：开发者工具打开、init、上传前要换成真实 AppID（该 AppID 后台需已添加 WXGameKit 插件）。可以重新 convert 时加 --appid-from <已有工程>');
  else if (!/^wx[0-9a-f]{16}$/.test(pc.appid)) fail('AppID 格式不对');
  else pass('AppID 已填写（不显示具体值）');
  if (cfg.project?.engine?.name !== 'Custom') warn('wx-game-kit/config.json 的引擎名不是 Custom：' + cfg.project?.engine?.name);

  const code = cfg.launch?.code, data = cfg.launch?.data;
  if (!code?.fileMD5) { fail('wx-game-kit/config.json 缺少 launch.code.fileMD5'); return out; }
  if (!/^[0-9a-f]{15,16}$/.test(code.fileMD5)) fail('launch.code.fileMD5 不是 15/16 位十六进制：' + code.fileMD5);
  if (code.fileMD5.length !== 15) warn('launch.code.fileMD5 是 16 位：官方 switch-md5 只接受 15 位，需要换 md5 时会被拒绝');
  const split = code.useWasmCodeSplit === true || has('wasm-split.js');
  const br = 'wasmcode/' + code.fileMD5 + '.wasm.br';
  if (!has(br)) fail('找不到 ' + br);
  else if (split) pass(`已经是分包产物（${br}，wasm-split.js），跳过整包 WASM 检查`);
  else {
    let wasm = null; try { wasm = zlib.brotliDecompressSync(fs.readFileSync(file(br))); } catch { fail(br + ' 不是有效的 brotli'); }
    if (wasm) {
      if (wasm.readUInt32LE(0) !== 0x6d736100) fail(br + ' 解压后不是 WASM');
      else { pass(`${br} 解压为完整 WASM（${(wasm.length / 1e6).toFixed(2)} MB，压缩 ${(fs.statSync(file(br)).size / 1e6).toFixed(2)} MB）`);
        if (!md5(wasm).startsWith(code.fileMD5)) warn('fileMD5 不是这份 WASM 的 md5 前缀（手工改过名也能用，只是无法从文件名追溯）'); else pass('fileMD5 与 WASM 内容的 md5 一致'); }
    }
  }
  for (const f of fs.readdirSync(file('wasmcode'))) if (f.endsWith('.wasm.br') && f !== code.fileMD5 + '.wasm.br') warn('wasmcode/ 里有多余的 ' + f);

  if (!data?.fileMD5) fail('wx-game-kit/config.json 缺少 launch.data（首包数据）');
  else {
    const db = 'data-package/' + data.fileMD5 + '.data.bin';
    if (data.loadFromSubpackage !== true || data.isCompressed !== true) fail('launch.data 需要 loadFromSubpackage=true、isCompressed=true');
    if (!has(db)) fail('找不到 ' + db);
    else {
      let raw = null; try { raw = zlib.brotliDecompressSync(fs.readFileSync(file(db))); } catch { fail(db + ' 不是有效的 brotli'); }
      const info = text('godot-data/package-info.js'), meta = (() => { try { return JSON.parse(info.slice(info.indexOf('=') + 1).trim().replace(/;$/, '')); } catch { return null; } })();
      if (raw && meta) {
        const pck = raw.subarray(meta.pck?.start ?? 0, meta.pck?.end ?? 0);
        const checks = [[raw.length === data.fileSize && raw.length === data.optFileSize, 'launch.data.fileSize 与解压大小一致'],
          [md5(raw).startsWith(data.fileMD5), 'launch.data.fileMD5 与数据内容的 md5 一致'],
          [sha(raw) === meta.dataSha256 && raw.length === meta.size, 'package-info.js 的 dataSha256/size 与数据包一致'],
          [meta.pck && meta.pck.end === raw.length && pck.length === meta.pckBytes && sha(pck) === meta.pckSha256, 'PCK 位于数据包末尾，大小和 sha256 与 package-info.js 一致（split 的 PCK 替换依赖这一点）'],
          [pck.subarray(0, 4).toString('latin1') === 'GDPC', 'PCK 文件头 GDPC'],
          [typeof meta.pck?.filename === 'string' && meta.pck.filename.startsWith('/') && meta.pck.filename.endsWith('.pck'), 'PCK 挂载路径 ' + meta.pck?.filename]];
        for (const [ok, m] of checks) ok ? pass(m) : fail(m.replace('一致', '不一致'));
      } else if (raw) fail('godot-data/package-info.js 读不出 __WXSLIM_PACKAGE_META__');
    }
    for (const f of fs.readdirSync(file('data-package'))) if (f.endsWith('.data.bin') && f !== data.fileMD5 + '.data.bin') warn('data-package/ 里有多余的 ' + f + '（会被打进包里）');
  }

  const entry = text('game.js'), order = ["import './godot-data/package-info'", "import './wx-game-kit/index'", "import './godot-data/custom-package'", "import './godot-data/single-entry'", 'import commFrameWork from'];
  const idx = order.map(s => entry.indexOf(s));
  if (idx.some(i => i < 0) || idx.some((v, i) => i && v < idx[i - 1])) fail('game.js 的加载顺序不对，应为 package-info → wx-game-kit → custom-package → single-entry → framework');
  else pass('game.js 加载顺序正确');
  if (!entry.includes('setModuleFunctionHandler(GameGlobal.__WXSLIM_CREATE_SINGLE_ENTRY__(commFrameWork))')) fail('game.js 没有用单入口包装 Godot 工厂');
  if (entry.split("console.log('start success');").length !== 2) warn("game.js 没有模板的 console.log('start success') 行：split 计时里“插件加载器就绪”会显示未知");
  if (has('godot-data/local-interfaces.js') && !entry.includes("import './godot-data/local-interfaces'")) warn('godot-data/local-interfaces.js 存在但 game.js 没有加载它');
  const compatAt = entry.indexOf("import './godot-data/wx-compat'"), ifaceAt = entry.indexOf("import './godot-data/local-interfaces'");
  if (!has('godot-data/wx-compat.js')) warn('没有 godot-data/wx-compat.js（--no-compat 或旧产物）：Godot 的 HTTP、WebSocket 发送、LineEdit 键盘、震动在通用适配里不能用，除非游戏自己的接口文件补了');
  else if (compatAt < 0) fail('godot-data/wx-compat.js 存在但 game.js 没有加载它');
  else if (compatAt < idx[3] || (ifaceAt >= 0 && compatAt > ifaceAt) || compatAt > idx[4]) fail('game.js 里 wx-compat 的位置不对，应在 single-entry 之后、local-interfaces 和 framework 之前');
  else {
    const c = text('godot-data/wx-compat.js'), parts = [['__globalAdapter', '输入法'], ['TextDecoder', '文本编解码'], ["'Blob'", 'Blob'], ["'OPEN'", 'WebSocket 常量'], ['nav.vibrate', '震动'], ['enableChunked = false', 'wx.request 关分块'], ['res.statusCode', '头回调过滤']];
    const lack = parts.filter(([k]) => !c.includes(k)).map(([, n]) => n);
    lack.length ? fail('godot-data/wx-compat.js 不完整，缺少：' + lack.join('、')) : pass('godot-data/wx-compat.js 在 local-interfaces 之前加载，含输入法、文本编解码、Blob、WebSocket 常量、震动、wx.request 补丁');
  }
  // Godot 插件 wx_split 的 JS 侧：WxSplit 要在 local-interfaces 之前挂好（探测函数调用时才查点击门和采集门，和它们的加载顺序无关）
  const splitAt = entry.indexOf("import './godot-data/wx-split'");
  if (!has('godot-data/wx-split.js')) warn('没有 godot-data/wx-split.js（旧产物）：用了 Godot 插件 wx_split 的游戏要重新 convert，或把 godot-addon/addons/wx_split/wx_split.js 拼进接口文件');
  else if (splitAt < 0) fail('godot-data/wx-split.js 存在但 game.js 没有加载它');
  else if (splitAt < idx[3] || (ifaceAt >= 0 && splitAt > ifaceAt) || splitAt > idx[4]) fail('game.js 里 wx-split 的位置不对，应在 single-entry 之后、local-interfaces 和 framework 之前');
  else if (!text('godot-data/wx-split.js').includes('WXSLIM_ADDON_JS')) fail('godot-data/wx-split.js 不是 wx_split 插件的 JS');
  else pass('godot-data/wx-split.js（Godot 插件 wx_split 的 JS 侧）在 local-interfaces 之前加载');

  const fw = text('framework.js');
  const fwChecks = [[fw.split('__WXSLIM_GODOT_BRIDGE__.start(Godot,Module,').length === 2, 'framework.js 含 Godot 启动桥（只调用一次）'],
    [fw.includes('/* WXSLIM_ASSET_GATE_ADAPTER_BEGIN */') && fw.includes("Module.__WXSLIM_ADD_ASSET_GATE__('converter');"), 'framework.js 含资源依赖门补丁'],
    [!fw.includes("addRunDependency('wasm-preloadAssets');WXGameKit"), 'framework.js 不再直接添加资源依赖'],
    [!/=\s*nowPolyfill\b/.test(fw) || fw.includes('root.nowPolyfill = nowPolyfill'), 'framework.js 含全局 nowPolyfill 兜底（新版微信分支引擎需要）']];
  for (const [ok, m] of fwChecks) ok ? pass(m) : fail(m.replace('含', '缺少'));

  const lab = ['godot-data/local-diagnostic-init.js', 'godot-data/clean-profile-trace.js'].filter(has);
  if (lab.length) warn('工程里有实验诊断脚本：' + lab.join('、'));
  if (/setStorageSync\('WXSLIM_/.test(text('godot-data/custom-package.js') + text('godot-data/single-entry.js') + fw)) warn('工程里的胶水会把诊断写进本地存储（实验版行为）');

  const sym = path.join(path.dirname(dir), 'webgl', 'symbols.json');
  fs.existsSync(sym) ? pass('符号表 ../webgl/symbols.json 存在（split 配置里的 symbols 指向它）') : warn('没有 ../webgl/symbols.json：split 的 lookup 和问题排查需要符号表');
  has('godot-data/wxslim-timing.js') && /import '\.\/godot-data\/wxslim-timing'/.test(text('game.js')) ? pass('装了加载计时汇总（godot-data/wxslim-timing.js，日志前缀 [WXSLIM_TIMING]）') : warn('没有加载计时汇总（转换时用了 --no-timing？）：日志里不会有“首包进场景”“点击进场景”等统计');
  if (has('game.symbols.json')) {
    const pc = JSON.parse(text('project.config.json') || '{}'), ign = pc.packOptions?.ignore || [];
    ign.some(x => x.value === 'game.symbols.json') ? pass('工程里有 game.symbols.json（官方 init 要用），且已从小游戏包排除') : fail('game.symbols.json 没有在 project.config.json 的 packOptions.ignore 里，会被打进小游戏包');
  } else warn('工程里没有 game.symbols.json：官方 init 会报找不到符号表（把 ../webgl/symbols.json 复制进来并在 packOptions 忽略）');
  has('.plugincache/codesplitv2') ? pass('已做过官方 init（.plugincache/codesplitv2 存在）') : warn('还没做官方 init（split/SETUP.md 第 3 节第 2 条）：下一步 wasmsplit-v2-ci init，会上传 WASM，必须先取得授权');
  return out;
}
