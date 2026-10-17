// 游戏级统一配置 wxslim.json（+ 同目录 wxslim.private.json）：一个游戏只填一份，convert / trim / split 各读自己那一段。
// 优先级：命令行参数 > wxslim.private.json > wxslim.json > 默认值。工具链（转换器、emsdk、python、引擎源码）仍是机器级配置，不在这里。
import fs from 'node:fs';import path from 'node:path';

export const FORMAT = 'wechat-wasm-slim/game-v1';
export const PRIVATE_NAME = 'wxslim.private.json';
const LEVELS = ['conservative', 'balanced', 'minimal'];

// 字段类型：str / bool / int / enum / obj / map（值全为布尔）/ 路径（in = 输入，用到时检查存在；out = 输出，不检查）。
// private: 只能写在 wxslim.private.json；nullable: 允许 null。
const str = {t: 'str'}, bool = {t: 'bool'}, int = {t: 'int'}, inFile = {t: 'path', io: 'in', kind: 'file'}, inDir = {t: 'path', io: 'in', kind: 'dir'}, inAny = {t: 'path', io: 'in'}, out = {t: 'path', io: 'out'};
const nul = s => ({...s, nullable: true});
export const SCHEMA = {t: 'obj', keys: {
  格式: {t: 'const', value: FORMAT},
  game: {t: 'obj', keys: {
    name: str, godotProject: inDir, pck: inFile, interfaces: nul(inFile),
    orientation: {t: 'enum', values: ['portrait', 'landscape']}, locale: str, compat: bool, timing: bool,
    appid: {t: 'str', pattern: /^wx[0-9a-f]{16}$/, private: true}, appidFrom: {...inAny, private: true},
  }},
  engine: {t: 'obj', keys: {fromTrim: bool, artifacts: inDir, export: inDir, js: inFile, wasm: inFile, symbols: inFile}},
  trim: {t: 'obj', keys: {
    config: {t: 'path', io: 'in', kind: 'file', mayBeMissing: true}, level: {t: 'enum', values: LEVELS}, overrides: {t: 'map'},
    lto: {t: 'enum', values: ['full', 'thin', 'none']}, work: out, jobs: int, maxMinutes: int,
  }},
  split: {t: 'obj', keys: {
    projectName: str, clientName: str, mode: {t: 'enum', values: ['onclick', 'measured']},
    workDir: out, workProject: out, symbols: out, officialCli: inFile, privateKeyPath: {...inFile, private: true},
    releasePck: nul(inFile), trainingPck: nul(inFile), releaseInterfaces: nul(inFile), trainingGateHost: str,
    cloud: {t: 'obj', keys: {env: nul({t: 'str', private: true}), functionName: str, collection: str}},
    devtoolsDir: inDir,
  }},
  output: {t: 'obj', keys: {dir: out, convert: out}},
}};

const typeName = s => ({str: '字符串', bool: 'true/false', int: '整数', enum: (s.values || []).join(' / '), obj: '对象', map: '对象（值为 true/false）', path: '路径字符串', const: JSON.stringify(s.value)})[s.t];

/** 校验一份（已合并的）配置，返回错误列表（中文，带键路径）。publicRaw 用来检查私密字段有没有写进公开文件。 */
export function validate(raw, publicRaw = raw) {
  const errs = [];
  (function walk(v, s, at, pub) {
    if (v === null && s.nullable) return;
    if (s.private && pub !== undefined && pub !== null) errs.push(`${at} 只能写在 ${PRIVATE_NAME}（不进仓库），不能写在 wxslim.json`);
    switch (s.t) {
      case 'obj': {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) { errs.push(`${at || '配置'} 必须是对象`); return; }
        for (const [k, x] of Object.entries(v)) {
          if (k === '说明' || k.startsWith('说明')) continue; // 中文注释键
          if (!(k in s.keys)) { errs.push(`${at ? at + '.' : ''}${k}：未知的键（可用：${Object.keys(s.keys).join('、')}）`); continue; }
          walk(x, s.keys[k], at ? at + '.' + k : k, pub && typeof pub === 'object' ? pub[k] : undefined);
        }
        return;
      }
      case 'map':
        if (typeof v !== 'object' || v === null || Array.isArray(v)) errs.push(`${at} 必须是${typeName(s)}`);
        else for (const [k, x] of Object.entries(v)) if (typeof x !== 'boolean') errs.push(`${at}.${k} 必须是 true 或 false`);
        return;
      case 'const': if (v !== s.value) errs.push(`${at} 必须是 ${JSON.stringify(s.value)}`); return;
      case 'str': case 'path': if (typeof v !== 'string' || !v) errs.push(`${at} 必须是非空${typeName(s)}`); else if (s.pattern && !s.pattern.test(v)) errs.push(`${at} 格式不对`); return;
      case 'bool': if (typeof v !== 'boolean') errs.push(`${at} 必须是 true 或 false`); return;
      case 'int': if (!Number.isInteger(v) || v <= 0) errs.push(`${at} 必须是正整数`); return;
      case 'enum': if (!s.values.includes(v)) errs.push(`${at} 只能是 ${s.values.join(' / ')}，现在是 ${JSON.stringify(v)}`); return;
    }
  })(raw, SCHEMA, '', publicRaw);
  if (raw?.格式 === undefined) errs.push(`缺少 格式（应为 "${FORMAT}"）`);
  if (!raw?.game) errs.push('缺少 game 段');
  const e = raw?.engine || {}, srcs = ['fromTrim', 'artifacts', 'export', 'js'].filter(k => k === 'fromTrim' ? e.fromTrim === true : e[k]);
  if (srcs.length > 1) errs.push(`engine 只能选一种引擎来源（fromTrim / artifacts / export / js+wasm），现在写了 ${srcs.join('、')}`);
  if (e.js && !e.wasm) errs.push('engine.js 要和 engine.wasm 一起写');
  if (e.wasm && !e.js) errs.push('engine.wasm 要和 engine.js 一起写');
  if (e.fromTrim === true && !raw?.trim?.work) errs.push('engine.fromTrim 需要 trim.work（编译目录，引擎在 <trim.work>/artifacts）');
  return errs;
}

function merge(a, b) {
  if (b === undefined) return a;
  if (typeof a !== 'object' || a === null || Array.isArray(a) || typeof b !== 'object' || b === null || Array.isArray(b)) return b;
  const r = {...a}; for (const [k, v] of Object.entries(b)) r[k] = merge(a[k], v); return r;
}
const readJsonFile = (f, what) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw Error(`${what} 读不了或不是合法 JSON：${f}（${e.code || e.message}）`); } };

/** 是不是统一配置（看 格式 字段；旧的 trim 配置、kit 配置都没有这个值）。 */
export function isGameConfig(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8'))?.格式 === FORMAT; } catch { return false; } }
/** 按统一配置处理：格式对，或者文件名是 wxslim*.json（写坏了也给统一配置的报错，不当成旧配置）。 */
export const treatAsGameConfig = file => isGameConfig(file) || /^wxslim.*\.json$/i.test(path.basename(file));

/** 读取并校验 wxslim.json（同目录有 wxslim.private.json 就合并覆盖）。路径都解析成绝对路径。 */
export function loadGameConfig(file) {
  file = path.resolve(file); const dir = path.dirname(file);
  if (path.basename(file) === PRIVATE_NAME) throw Error(`--config 要指向公开的 wxslim.json，${PRIVATE_NAME} 会自动合并`);
  const pub = readJsonFile(file, '配置'), privFile = path.join(dir, PRIVATE_NAME), priv = fs.existsSync(privFile) ? readJsonFile(privFile, '私密配置') : undefined;
  const privErrs = priv === undefined ? [] : validate({格式: FORMAT, game: {}, ...priv}, {}).map(e => PRIVATE_NAME + '：' + e).filter(e => !e.includes('缺少'));
  const raw = merge(pub, priv), errs = [...validate(raw, pub), ...privErrs];
  if (errs.length) throw Error('配置有错误（' + file + '）：\n  - ' + [...new Set(errs)].join('\n  - '));
  const abs = p => p == null ? p : path.resolve(dir, p);
  const c = structuredClone(raw);
  (function resolve(v, s) { if (!v || s.t !== 'obj') return; for (const [k, x] of Object.entries(v)) { const ks = s.keys[k]; if (!ks) continue; if (ks.t === 'path') v[k] = abs(x); else resolve(x, ks); } })(c, SCHEMA);
  c.game ??= {}; c.engine ??= {}; c.trim ??= {}; c.split ??= {}; c.output ??= {};
  c.output.dir ??= path.join(dir, 'out');
  c.output.convert ??= path.join(c.output.dir, 'convert');
  return {file, dir, privateFile: priv === undefined ? null : privFile, raw, c};
}

/** 检查用到的输入路径存在（键路径如 'game.pck'）；没写的跳过。 */
export function requirePaths(g, keys, {required = []} = {}) {
  const errs = [];
  for (const k of [...new Set([...keys, ...required])]) {
    const parts = k.split('.'); let v = g.c, s = SCHEMA;
    for (const p of parts) { v = v?.[p]; s = s?.keys?.[p]; }
    if (v == null) { if (required.includes(k)) errs.push(`缺少 ${k}`); continue; }
    if (!s || s.t !== 'path' || s.io !== 'in') continue;
    if (!fs.existsSync(v)) { errs.push(`${k} 指向的${s.kind === 'dir' ? '目录' : s.kind === 'file' ? '文件' : '路径'}不存在：${v}`); continue; }
    const st = fs.statSync(v);
    if (s.kind === 'dir' && !st.isDirectory()) errs.push(`${k} 应该是目录：${v}`);
    if (s.kind === 'file' && !st.isFile()) errs.push(`${k} 应该是文件：${v}`);
  }
  if (errs.length) throw Error('配置有错误（' + g.file + '）：\n  - ' + errs.join('\n  - '));
}

/** convert 用的参数（键名同命令行参数）。 */
export function convertArgs(g) {
  const {game, engine, trim, output} = g.c;
  requirePaths(g, ['game.pck', 'game.interfaces', 'game.appidFrom', 'engine.artifacts', 'engine.export', 'engine.js', 'engine.wasm', 'engine.symbols'], {required: ['game.pck']});
  const a = {pck: game.pck, out: output.convert};
  if (engine.fromTrim) { a.export = path.join(trim.work, 'artifacts'); if (!fs.existsSync(a.export)) throw Error(`engine.fromTrim：还没有编译产物 ${a.export}（先 trim build）`); }
  else if (engine.artifacts || engine.export) a.export = engine.artifacts || engine.export;
  else if (engine.js) Object.assign(a, {js: engine.js, wasm: engine.wasm});
  else throw Error('配置里没有引擎来源：在 engine 段写 fromTrim / artifacts / export / js+wasm 其中一种');
  if (engine.symbols) a.symbols = engine.symbols;
  for (const k of ['interfaces', 'orientation', 'locale', 'name', 'appid']) if (game[k] != null) a[k] = game[k];
  if (game.appidFrom) a['appid-from'] = game.appidFrom;
  const flags = {'no-compat': game.compat === false, 'no-timing': game.timing === false};
  return {args: a, flags};
}

/** trim 用的值：trim 配置文件（扫描生成的格式）+ 统一配置里的档位/手动覆盖。 */
export function trimSettings(g) {
  const {game, trim, output} = g.c;
  requirePaths(g, ['game.godotProject']);
  const r = {project: game.godotProject, configFile: trim.config || path.join(g.dir, 'trim.config.json'), work: trim.work, lto: trim.lto, jobs: trim.jobs, maxMinutes: trim.maxMinutes,
    gdbuild: path.join(output.dir, (game.name || 'game') + '.gdbuild')};
  r.load = () => {
    if (!fs.existsSync(r.configFile)) throw Error(`trim 配置不存在：${r.configFile}（先 trim scan --config ${g.file} 生成，或在 trim.config 指定）`);
    const cfg = readJsonFile(r.configFile, 'trim 配置');
    if (trim.level) cfg.当前档位 = trim.level;
    if (trim.overrides) cfg.手动覆盖 = {...(cfg.手动覆盖 || {}), ...trim.overrides};
    return cfg;
  };
  return r;
}

/** split（kit.mjs）用的配置：转成旧 *.kit.json 的形状（路径已是绝对路径）。
 *  needs = 这个命令要用到、必须存在的字段（kit 配置的键名，如 'releasePck'），写了但不存在就报错；默认值推出来的也查。 */
export function splitConfig(g, needs = []) {
  const {game, split: s, output} = g.c;
  const conv = output.convert;
  const r = {
    projectName: s.projectName || game.name || 'wechat-wasm-slim', clientName: s.clientName || 'Claude', mode: s.mode,
    workDir: s.workDir || path.join(output.dir, 'kit-work'), workProject: s.workProject || path.join(conv, 'minigame'), symbols: s.symbols || path.join(conv, 'webgl/symbols.json'),
    officialCli: s.officialCli || path.join(g.dir, 'node_modules/wasmsplit-v2-ci/bin/cli.js'), privateKeyPath: s.privateKeyPath,
    releasePck: s.releasePck === undefined ? game.pck : s.releasePck, trainingPck: s.trainingPck ?? null,
    releaseInterfaces: s.releaseInterfaces === undefined ? game.interfaces ?? null : s.releaseInterfaces, trainingGateHost: s.trainingGateHost,
    cloud: {env: s.cloud?.env ?? null, functionName: s.cloud?.functionName || 'phoneLogIngest', collection: s.cloud?.collection || 'phone_log_batches'},
    devtoolsDir: s.devtoolsDir, __dir: g.dir, __file: g.file,
  };
  // 报错时说清值从哪来：没写的字段是从 game / output 段推出来的。
  const DIRS = ['workProject', 'devtoolsDir'], from = {releasePck: s.releasePck === undefined ? ['game.pck', '（split.releasePck 没写时用它）'] : null, releaseInterfaces: s.releaseInterfaces === undefined ? ['game.interfaces', '（split.releaseInterfaces 没写时用它）'] : null, workProject: s.workProject ? null : ['split.workProject', '（默认 <output.convert>/minigame，先 convert）'], symbols: s.symbols ? null : ['split.symbols', '（默认 <output.convert>/webgl/symbols.json，先 convert）']};
  const errs = [];
  for (const k of needs) {
    const v = r[k]; if (v == null) continue;
    const st = fs.existsSync(v) ? fs.statSync(v) : null, dir = DIRS.includes(k);
    const [name, hint] = from[k] || ['split.' + k, ''];
    if (!st) errs.push(`${name} 指向的${dir ? '目录' : '文件'}不存在：${v}${hint}`);
    else if (dir ? !st.isDirectory() : !st.isFile()) errs.push(`${name} 应该是${dir ? '目录' : '文件'}：${v}${hint}`);
  }
  if (errs.length) throw Error('配置有错误（' + g.file + '）：\n  - ' + errs.join('\n  - '));
  return r;
}

/** 给人看的合并结果：私密值只显示“已设置”。 */
export function describe(g) {
  const c = structuredClone(g.c);
  if (c.game.appid) c.game.appid = '（已设置，来自 private）';
  if (c.game.appidFrom) c.game.appidFrom = '（已设置，来自 private）';
  if (c.split.privateKeyPath) c.split.privateKeyPath = '（已设置，来自 private）';
  if (c.split.cloud?.env) c.split.cloud.env = '（已设置，来自 private）';
  return c;
}
