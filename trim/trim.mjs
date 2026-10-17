#!/usr/bin/env node
// 微信 Godot 引擎编译期裁剪：扫描项目 → 可手动开关的配置 → .gdbuild → 编译 → 替换进小游戏工程。用法见 ../README.md。
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {engineMap, scanProject, proposeConfig, toBuildProfile, normalizeOverrides} from './lib/scan.mjs';
import {checkToolchain, buildEngine} from './lib/build.mjs';
import {treatAsGameConfig, loadGameConfig, trimSettings} from '../lib/game-config.mjs';

const argv = process.argv.slice(2), cmd = argv[0];
const opt = k => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : undefined; };
const need = k => { const v = opt(k); if (!v) throw Error('缺少参数 --' + k); return path.resolve(v); };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
// --config 两种写法：统一配置 wxslim.json（读 game.godotProject 和 trim 段，命令行参数优先），或者旧的裁剪配置（scan 生成的格式，兼容）。
let game = null, settings;
const trimCfgOf = () => game ? settings ??= trimSettings(game) : null;
const val = (k, fromGame) => opt(k) ? path.resolve(opt(k)) : game && fromGame != null ? fromGame : need(k);
// 裁剪配置：统一配置时 = trim.config 指向的文件 + trim.level / trim.overrides；旧写法 = --config 文件本身。
const trimConfig = () => game ? trimCfgOf().load() : readJson(need('config'));
// 工具链配置：--toolchain 指定的文件 > 同目录 trim.toolchain.private.json（本机，不进仓库）> trim.toolchain.json（示例）。
// patches 相对路径按工具目录解析（私密配置里也能写 patches/xxx.patch）。
const home = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const toolchainFile = () => opt('toolchain') ? path.resolve(opt('toolchain')) : fs.existsSync(path.join(home, 'trim.toolchain.private.json')) ? path.join(home, 'trim.toolchain.private.json') : path.join(home, 'trim.toolchain.json');
const toolchain = () => { const f = toolchainFile(); const t = readJson(f); for (const k of ['engineSource', 'emsdk', 'python']) t[k] = path.resolve(path.dirname(f), t[k]); t.patches = (t.patches || []).map(p => path.resolve(path.dirname(f), p)); return t; };
const mb = n => (n / 1e6).toFixed(2) + ' MB';

const commands = {
  async check() { const r = await checkToolchain(toolchain()); console.log('工具链正常：', JSON.stringify(r, null, 1)); },

  // 扫描 Godot 项目（含 project.godot 的目录），生成可编辑的裁剪配置。
  async scan() {
    const t = trimCfgOf(), tc = toolchain(), project = val('project', t?.project), out = val('out', t?.configFile);
    if (!fs.existsSync(path.join(project, 'project.godot'))) throw Error('不是 Godot 项目目录（找不到 project.godot）');
    if (fs.existsSync(out)) throw Error('配置文件已存在，不覆盖：' + out);
    const map = engineMap(tc.engineSource), scan = scanProject(project, map.allClasses), cfg = proposeConfig({source: tc.engineSource, project, map, scan});
    fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`扫描了 ${scan.files} 个文件，项目用到 ${scan.used.size} 个引擎类。`);
    for (const lvl of ['conservative', 'balanced', 'minimal']) { cfg.当前档位 = lvl; const {profile, keptModules} = toBuildProfile(cfg); const off = Object.keys(profile.disabled_build_options).filter(k => k.startsWith('disable_')); console.log(`  ${lvl.padEnd(12)} 关掉大功能 ${off.length} 个 [${off.join(', ')}]，保留模块 ${keptModules.length} 个`); }
    console.log(`配置已写入 ${out}（默认档位 balanced）。打开它可以逐项看原因和风险，在“手动覆盖”里改。`);
  },

  // 根据配置生成 .gdbuild，并列出最终会去掉什么。
  async profile() {
    const cfg = trimConfig(), out = val('out', trimCfgOf()?.gdbuild), {profile, keptModules} = toBuildProfile(cfg);
    if (game) console.log(`统一配置 ${game.file}：裁剪配置 ${trimCfgOf().configFile}${game.c.trim.level ? '，档位由 trim.level 指定' : ''}${game.c.trim.overrides ? '，手动覆盖合并了 trim.overrides' : ''}`);
    fs.mkdirSync(path.dirname(out), {recursive: true});
    const ov = normalizeOverrides(cfg); if (Object.keys(ov).length) console.log('手动覆盖（已校验）：' + JSON.stringify(ov));
    fs.writeFileSync(out, JSON.stringify(profile, null, 2) + '\n');
    const o = profile.disabled_build_options;
    console.log(`档位 ${cfg.当前档位}；关掉：${Object.keys(o).filter(k => k.startsWith('disable_')).join(', ') || '（无）'}`);
    console.log(`去掉模块：${Object.keys(o).filter(k => o[k] === false).map(k => k.replace(/^module_|_enabled$/g, '')).join(', ') || '（无）'}`);
    console.log(`保留模块：${keptModules.join(', ')}`); console.log('已写入 ' + out);
  },

  // 编译。--work 是这次编译的独立目录（约 0.9 GB），失败后用同一目录重跑即可续编。
  async build() {
    const t = trimCfgOf(), tc = toolchain(), work = val('work', t?.work); let profileFile = opt('profile') && path.resolve(opt('profile'));
    if (!profileFile) { const cfg = trimConfig(); fs.mkdirSync(work, {recursive: true}); profileFile = path.join(work, 'from-config.gdbuild'); fs.writeFileSync(profileFile, JSON.stringify(toBuildProfile(cfg).profile, null, 2) + '\n'); }
    await checkToolchain(tc);
    const r = await buildEngine({tc, profileFile, workDir: work, symbols: !argv.includes('--no-symbols'), jobs: Number(opt('jobs') || t?.jobs || 8), retries: Number(opt('retries') || 2), lto: opt('lto') || t?.lto || tc.lto || 'full', ltoJobs: Number(opt('lto-jobs') || 4), maxMinutes: Number(opt('max-minutes') || t?.maxMinutes || 120), onLog: s => console.log(s)});
    console.log(`完成：用时 ${r.buildMinutes} 分钟；godot.wasm ${mb(r.wasmBytes)}，压缩后 godot.wasm.br ${mb(r.wasmBrBytes)}；保留模块 ${r.enabledModules.length} 个。产物在 ${path.join(work, 'artifacts')}`);
  },

  // 把编译好的引擎换进小游戏工程（复制到新目录，不改原工程）。
  async apply() {
    const art = need('engine'), mini = need('minigame'), out = need('out');
    if (fs.existsSync(out)) throw Error('输出目录已存在：' + out);
    if (fs.existsSync(path.join(mini, 'engine/godot.wasm.br')) && fs.existsSync(path.join(mini, 'engine/godot.js'))) {
      fs.cpSync(mini, out, {recursive: true, errorOnExist: true});
      fs.copyFileSync(path.join(art, 'godot.js'), path.join(out, 'engine/godot.js')); fs.copyFileSync(path.join(art, 'godot.wasm.br'), path.join(out, 'engine/godot.wasm.br'));
      const before = fs.statSync(path.join(mini, 'engine/godot.wasm.br')).size, after = fs.statSync(path.join(out, 'engine/godot.wasm.br')).size;
      console.log(`已生成 ${out}：engine/godot.wasm.br ${mb(before)} → ${mb(after)}（${((1 - after / before) * 100).toFixed(1)}%）。用微信开发者工具打开，把游戏完整玩一遍确认没被裁坏。`);
    } else if (fs.existsSync(path.join(mini, 'wx-game-kit/config.json'))) {
      console.log('这是通用适配（WXGameKit）工程：用 artifacts 里的引擎重新转换到新目录：');
      console.log(`  node convert/convert.mjs convert --export ${art} --pck <游戏.pck> --appid-from ${mini} --out <新目录>`);
      console.log('引擎变了以后 md5 会变，要重新做官方 init 和分包采集（split 工具）。');
    } else throw Error('认不出工程类型：既没有 engine/godot.wasm.br，也没有 wx-game-kit/config.json');
  },

  // 对比两份产物的大小。
  async compare() {
    const a = need('a'), b = need('b'), s = (d, f) => fs.existsSync(path.join(d, f)) ? fs.statSync(path.join(d, f)).size : null;
    for (const f of ['godot.wasm', 'godot.wasm.br', 'godot.js']) { const x = s(a, f), y = s(b, f); if (x && y) console.log(`${f.padEnd(14)} ${mb(x)} → ${mb(y)}（${((1 - y / x) * 100).toFixed(1)}%）`); }
  },
};
try {
  if (!commands[cmd]) throw Error('用法：node trim.mjs <check|scan|profile|build|apply|compare> [--config wxslim.json] ...（见 README.md）');
  if (opt('config') && treatAsGameConfig(opt('config'))) game = loadGameConfig(opt('config'));
  await commands[cmd]();
}
catch (e) { console.error('错误：', e.message); process.exitCode = 1; }
