// 扫描：引擎源码里“每个开关/模块注册了哪些类” × 项目里“实际用到哪些类和资源格式” → 可编辑的裁剪配置。
import fs from 'node:fs';import path from 'node:path';

// Web 模板默认编入的模块（来自完整对照版 modules_enabled.gen.h），以及每个模块的中文说明和判断依据。
export const MODULES = {
  gdscript: {cn: 'GDScript 脚本', keepIf: p => p.ext.gd > 0, always: false},
  freetype: {cn: '字体渲染（FreeType）', always: true, note: '默认字体和所有文字都需要'},
  text_server_adv: {cn: '高级文字排版（复杂文字、双向文本）', always: true, minimalDrop: true, note: 'minimal 档可换成 text_server_fb（体积更小，不支持阿拉伯语等复杂排版，中英文正常）'},
  msdfgen: {cn: 'MSDF 字体（多通道距离场）', always: true, minimalDrop: true, keepIf: p => p.text.includes('multichannel_signed_distance_field = true'), note: '只有字体开启了 MSDF 才需要'},
  svg: {cn: 'SVG 图像', always: true, note: '默认主题图标依赖，保留'},
  webp: {cn: 'WebP 图像（含有损压缩导入的纹理）', keepIf: p => p.imageAssets > 0 || p.ext.webp > 0, note: '项目有图片资源时保留（有损导入会用到 WebP）'},
  jpg: {cn: 'JPEG 运行时解码', keepIf: p => p.runtimeImageLoad, note: '导入后的纹理不需要；只有运行时加载 .jpg 文件才需要'},
  bmp: {cn: 'BMP 运行时解码', keepIf: p => p.runtimeImageLoad},
  tga: {cn: 'TGA 运行时解码', keepIf: p => p.runtimeImageLoad},
  hdr: {cn: 'HDR 图像', keepIf: p => p.ext.hdr > 0},
  tinyexr: {cn: 'EXR 图像', keepIf: p => p.ext.exr > 0},
  dds: {cn: 'DDS 纹理', keepIf: p => p.ext.dds > 0},
  ktx: {cn: 'KTX 纹理', keepIf: p => p.ext.ktx > 0 || p.ext.ktx2 > 0},
  basis_universal: {cn: 'Basis 通用纹理压缩', keepIf: p => p.ext.basis > 0 || p.ext.ktx2 > 0 || p.text.includes('compress/mode=2')},
  astcenc: {cn: 'ASTC 纹理压缩器', keepIf: () => false, note: '运行时用不到的压缩编码器'},
  etcpak: {cn: 'ETC 纹理压缩器', keepIf: () => false, note: '运行时用不到的压缩编码器'},
  bcdec: {cn: 'BC 纹理解码（WebGL 不支持 S3TC 时的软件解码）', keepIf: p => p.text.includes('vram_texture'), note: '只有用了 VRAM 压缩纹理才需要'},
  ogg: {cn: 'Ogg 容器', keepIf: p => p.ext.ogg > 0 || p.ext.ogv > 0},
  vorbis: {cn: 'Ogg Vorbis 音频', keepIf: p => p.ext.ogg > 0},
  mp3: {cn: 'MP3 音频', keepIf: p => p.ext.mp3 > 0},
  theora: {cn: 'Theora 视频', keepIf: p => p.ext.ogv > 0},
  interactive_music: {cn: '交互式音乐', keepIf: null},
  regex: {cn: '正则表达式 RegEx', keepIf: null},
  zip: {cn: 'ZIP 读写', keepIf: null},
  jsonrpc: {cn: 'JSON-RPC', keepIf: null},
  mbedtls: {cn: 'TLS/加密（HTTPS、Crypto）', keepIf: p => /HTTPRequest|HTTPClient|WebSocketPeer|StreamPeerTLS|Crypto|HashingContext|AESContext|https:\/\//.test(p.text), note: '用到 HTTPS 或加密就必须保留'},
  enet: {cn: 'ENet 网络', keepIf: null},
  multiplayer: {cn: '高层多人网络', keepIf: null},
  websocket: {cn: 'WebSocket', keepIf: null},
  webrtc: {cn: 'WebRTC', keepIf: null},
  upnp: {cn: 'UPnP', keepIf: null},
  gltf: {cn: 'glTF 运行时导入', keepIf: null},
  fbx: {cn: 'FBX 运行时导入', keepIf: null},
  meshoptimizer: {cn: '网格优化（导入/LOD 生成）', keepIf: () => false, note: '导入期工具，运行时一般用不到'},
  vhacd: {cn: '凸分解（生成碰撞形状）', keepIf: null},
  csg: {cn: 'CSG 几何', keepIf: null},
  gridmap: {cn: 'GridMap', keepIf: null},
  noise: {cn: '噪声纹理', keepIf: null},
  visual_shader: {cn: '可视化着色器', keepIf: p => p.text.includes('VisualShader')},
  godot_physics_2d: {cn: 'Godot 2D 物理引擎', keepIf: null, switchLinked: 'disable_physics_2d'},
  godot_physics_3d: {cn: 'Godot 3D 物理引擎', keepIf: null, switchLinked: 'disable_physics_3d'},
  jolt_physics: {cn: 'Jolt 3D 物理引擎', keepIf: p => p.text.includes('Jolt'), switchLinked: 'disable_physics_3d'},
  navigation_2d: {cn: '2D 导航', keepIf: null, switchLinked: 'disable_navigation_2d'},
  navigation_3d: {cn: '3D 导航', keepIf: null, switchLinked: 'disable_navigation_3d'},
  mobile_vr: {cn: '移动 VR', keepIf: null},
  webxr: {cn: 'WebXR', keepIf: null},
};
export const SWITCHES = {
  disable_3d: {cn: '整套 3D（节点、渲染、3D 物理/导航/XR）', block: '_3D_DISABLED'},
  disable_physics_2d: {cn: '2D 物理（刚体、碰撞体、Area2D）', block: 'PHYSICS_2D_DISABLED'},
  disable_physics_3d: {cn: '3D 物理', block: 'PHYSICS_3D_DISABLED'},
  disable_navigation_2d: {cn: '2D 导航', block: 'NAVIGATION_2D_DISABLED'},
  disable_navigation_3d: {cn: '3D 导航', block: 'NAVIGATION_3D_DISABLED'},
  disable_xr: {cn: 'XR', block: 'XR_DISABLED'},
  disable_advanced_gui: {cn: '高级 GUI（RichTextLabel、Tree、TextEdit、GraphEdit 等）', block: 'ADVANCED_GUI_DISABLED'},
};

/** Classes registered inside `#ifndef X_DISABLED` blocks (tracks nesting). */
function classesByBlock(file) {
  const out = {}, stack = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^#if(n?def)?\s*(.*)$/))) { const d = t.match(/!?defined\((\w+_DISABLED)\)|ifndef\s+(\w+_DISABLED)/); stack.push(d ? (d[1] || d[2]) : null); continue; }
    if (t.startsWith('#else')) { stack[stack.length - 1] = null; continue; }
    if (t.startsWith('#endif')) { stack.pop(); continue; }
    for (const c of t.matchAll(/GDREGISTER_(?:VIRTUAL_|ABSTRACT_|INTERNAL_|RUNTIME_)?CLASS\((\w+)\)|register_class<(\w+)>/g)) for (const blk of stack.filter(Boolean)) (out[blk] ??= new Set()).add(c[1] || c[2]);
  }
  return out;
}
function moduleClasses(src, mod) {
  const set = new Set(), dir = path.join(src, 'modules', mod);
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['thirdparty', 'tests', 'editor'].includes(e.name)) walk(p); } else if (/register_types\.cpp$/.test(e.name)) for (const c of fs.readFileSync(p, 'utf8').matchAll(/GDREGISTER_(?:VIRTUAL_|ABSTRACT_|INTERNAL_|RUNTIME_)?CLASS\((\w+)\)|register_class<(\w+)>/g)) set.add(c[1] || c[2]); } };
  if (fs.existsSync(dir)) walk(dir);
  const docs = path.join(dir, 'doc_classes'); if (fs.existsSync(docs)) for (const f of fs.readdirSync(docs)) if (f.endsWith('.xml')) set.add(f.slice(0, -4));
  return set;
}

export function engineMap(src) {
  const blocks = classesByBlock(path.join(src, 'scene/register_scene_types.cpp'));
  for (const f of ['servers/register_server_types.cpp', 'scene/register_scene_types.cpp']) { const b = classesByBlock(path.join(src, f)); for (const [k, v] of Object.entries(b)) { blocks[k] ??= new Set(); v.forEach(x => blocks[k].add(x)); } }
  const allDocs = new Set(fs.readdirSync(path.join(src, 'doc/classes')).filter(f => f.endsWith('.xml')).map(f => f.slice(0, -4)));
  const modules = {}; for (const m of Object.keys(MODULES)) { modules[m] = moduleClasses(src, m); modules[m].forEach(c => allDocs.add(c)); }
  return {blocks, modules, allClasses: allDocs};
}

export function scanProject(dir, allClasses) {
  const ext = {}, used = new Map(); let text = '', imageAssets = 0, files = 0;
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true})) {
    if (e.name.startsWith('.') && e.name !== '.') continue; const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['addons_disabled', 'node_modules'].includes(e.name)) walk(p); continue; }
    files++; const x = path.extname(e.name).slice(1).toLowerCase(); ext[x] = (ext[x] || 0) + 1;
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'tga', 'bmp'].includes(x)) imageAssets++;
    if (['gd', 'tscn', 'tres', 'godot', 'cfg', 'import', 'gdshader'].includes(x)) { const s = fs.readFileSync(p, 'utf8'); text += s + '\n';
      for (const m of s.matchAll(/\b([A-Z][A-Za-z0-9_]{2,})\b/g)) if (allClasses.has(m[1])) { const r = path.relative(dir, p); if (!used.has(m[1])) used.set(m[1], new Set()); used.get(m[1]).add(r); } } } };
  walk(dir);
  return {ext: new Proxy(ext, {get: (o, k) => o[k] || 0}), used, text, imageAssets, files, runtimeImageLoad: /Image\.load|load_(png|jpg|webp|tga|bmp)_from_buffer|Image\.new\(\)\.load/.test(text)};
}

/** Build the editable config: every switch/module with 建议值、原因、风险，三档预设。 */
export function proposeConfig({source, project, map, scan}) {
  const usedIn = set => [...set].filter(c => scan.used.has(c)).sort();
  const switches = {}, modules = {};
  for (const [k, s] of Object.entries(SWITCHES)) {
    const u = usedIn(map.blocks[s.block] || new Set());
    switches[k] = {说明: s.cn, 项目用到的相关类: u.slice(0, 20), 建议: {conservative: false, balanced: u.length === 0, minimal: u.length === 0}, 风险: u.length ? '项目用到了，不能关' : '扫描没发现用到；动态创建的类（字符串/ClassDB.instantiate）扫描不到，关掉前请确认'};
  }
  // disable_3d implies physics/navigation 3D and XR off.
  for (const lvl of ['balanced', 'minimal']) if (switches.disable_3d.建议[lvl]) for (const k of ['disable_physics_3d', 'disable_navigation_3d', 'disable_xr']) switches[k].建议[lvl] = true;
  for (const [m, d] of Object.entries(MODULES)) {
    const u = usedIn(map.modules[m] || new Set()), byFiles = d.keepIf ? !!d.keepIf(scan) : false, need = d.always || u.length > 0 || byFiles;
    const 建议 = {};
    for (const lvl of ['conservative', 'balanced', 'minimal']) {
      if (d.switchLinked) {
        // 跟大开关绑定的模块（物理/导航实现）：开关关了才去掉，开关开着就必须保留实现。Jolt 只是可替换实现，没用到就去掉。
        建议[lvl] = m === 'jolt_physics' ? (lvl === 'conservative' || need) && !switches[d.switchLinked].建议[lvl] : !switches[d.switchLinked].建议[lvl];
      } else if (d.always || need) 建议[lvl] = true;
      else if (d.keepIf === null) 建议[lvl] = lvl === 'conservative'; // 只能靠“有没有用到它的类”判断：保守档保留，其它档去掉
      else 建议[lvl] = false;                                          // 有资源/写法规则且判断为不需要：三档都去掉
    }
    if (d.minimalDrop && !(u.length || byFiles)) 建议.minimal = false; // 只在 minimal 档去掉（text_server_adv 会换成精简版 text_server_fb）
    modules[m] = {说明: d.cn, 项目用到的相关类: u.slice(0, 12), 依据: d.switchLinked ? `跟随开关 ${d.switchLinked}` : d.always ? '基础模块，始终保留' : u.length ? '项目用到了它的类' : byFiles ? '项目里有对应的资源或写法' : '扫描没发现用到', 备注: d.note, 建议};
  }
  return {
    格式: 'wechat-wasm-slim/trim-config-v1', 生成时间: new Date().toISOString(), 引擎源码: source, 项目: project,
    使用说明: '把 当前档位 改成 conservative/balanced/minimal；要单独调整某一项，在 手动覆盖 里写 "disable_xxx": true/false 或 "module_xxx": true(保留)/false(去掉)。改完运行 trim profile 生成 .gdbuild。',
    当前档位: 'balanced', 手动覆盖: {},
    档位说明: {conservative: '只去掉明确用不到的编解码器和工具，最安全，收益小', balanced: '再关掉扫描确认没用到的大功能（如物理、导航、XR、高级GUI、没用到时的整套3D）和对应模块，推荐', minimal: '在 balanced 基础上把高级文字排版换成精简版等，收益最大，需要更仔细测试'},
    项目用到的引擎类数: scan.used.size, 开关: switches, 模块: modules,
  };
}

/** Resolve config (level + overrides) into a Godot .gdbuild. */
export function toBuildProfile(cfg) {
  const lvl = cfg.当前档位, o = cfg.手动覆盖 || {}, opts = {};
  for (const [k, s] of Object.entries(cfg.开关)) { const v = k in o ? !!o[k] : !!s.建议[lvl]; if (v) opts[k] = true; }
  const kept = [];
  for (const [m, d] of Object.entries(cfg.模块)) { const key = `module_${m}_enabled`; const keep = key in o ? !!o[key] : !!d.建议[lvl]; if (!keep) opts[key] = false; else kept.push(m); }
  // 去掉高级文字排版时必须换上精简版文字服务，否则没有任何文字能显示。
  if (opts.module_text_server_adv_enabled === false) { opts.module_text_server_fb_enabled = true; kept.push('text_server_fb'); }
  return {profile: {type: 'build_profile', disabled_classes: [], disabled_build_options: opts}, keptModules: kept.sort()};
}
