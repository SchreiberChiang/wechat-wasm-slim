import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import zlib from 'node:zlib';import {execFile,spawn} from 'node:child_process';
export const sha = b => crypto.createHash('sha256').update(b).digest('hex');
export const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v, flag) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', flag ? {flag} : undefined);
export function check(v, code) { if (!v) throw Object.assign(Error(code), {code}); }
export function copyTree(a, b) { check(!fs.existsSync(b), 'TARGET_EXISTS:' + b); (function c(x, y) { fs.mkdirSync(y, {recursive: true}); for (const e of fs.readdirSync(x, {withFileTypes: true})) { const s = path.join(x, e.name), d = path.join(y, e.name); check(!fs.lstatSync(s).isSymbolicLink(), 'SYMLINK:' + s); e.isDirectory() ? c(s, d) : fs.copyFileSync(s, d, fs.constants.COPYFILE_EXCL); } })(a, b); }
export function editText(file, fn) { const s = fs.readFileSync(file, 'utf8'), n = fn(s); check(n !== s, 'NO_CHANGE:' + file); fs.writeFileSync(file, n); }
export function replaceOnce(s, a, b, label) { const n = s.split(a).length - 1; check(n === 1, `ANCHOR_${n ? 'NOT_UNIQUE' : 'MISSING'}:${label || a.slice(0, 50)}`); return s.replace(a, b); }
export const kitDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const asset = n => fs.readFileSync(path.join(kitDir, 'assets', n), 'utf8');

/** Project facts the kit relies on. */
export function projectInfo(dir) {
  const cfg = readJson(path.join(dir, 'wx-game-kit/config.json')), cache = path.join(dir, '.plugincache/codesplitv2/config.json');
  const md5 = cfg.launch.code.fileMD5, split = fs.existsSync(cache) ? readJson(cache).split : null;
  const size = d => { const f = path.join(dir, d, md5 + '.wasm.br'); return fs.existsSync(f) ? fs.statSync(f).size : null; };
  return {md5, appid: readJson(path.join(dir, 'project.config.json')).appid, subVersion: split?.subVersion ?? cfg.wasmSplit?.subVersion, isProfile: split?.isProfile, dataMd5: cfg.launch.data.fileMD5, primaryBr: size('wasmcode'), code1Br: size('wasmcode1'), code2Br: size('wasmcode2')};
}

/** Swap the Godot PCK inside the compressed data package (keeps the leading notice file), update all metadata. */
export function installPck(dir, pckPath, label, engineMode) {
  const pck = fs.readFileSync(pckPath), cfgFile = path.join(dir, 'wx-game-kit/config.json'), cfg = readJson(cfgFile);
  const infoFile = path.join(dir, 'godot-data/package-info.js'), info = fs.readFileSync(infoFile, 'utf8'), meta = JSON.parse(info.slice(info.indexOf('{')).trim().replace(/;$/, ''));
  const old = zlib.brotliDecompressSync(fs.readFileSync(path.join(dir, 'data-package', cfg.launch.data.fileMD5 + '.data.bin')));
  check(sha(old) === meta.dataSha256, 'DATA_PACKAGE_META_MISMATCH');
  check(pck.subarray(0, 4).toString() === 'GDPC', 'NOT_A_GODOT_PCK');
  const data = Buffer.concat([old.subarray(0, meta.pck.start), pck]), br = zlib.brotliCompressSync(data, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11}}), md5 = crypto.createHash('md5').update(data).digest('hex').slice(0, 16);
  const out = path.join(dir, 'data-package', md5 + '.data.bin'); if (!fs.existsSync(out)) fs.writeFileSync(out, br);
  Object.assign(meta, {remotePackageName: label + '.data', size: data.length, pckBytes: pck.length, pckSha256: sha(pck), dataSha256: sha(data), engineMode}); meta.pck.end = data.length; meta.files.find(f => f.filename === meta.pck.filename).end = data.length;
  // 新旧两个全局名都写：2026-10-17 前 convert 的工程里，胶水读的是 __WX15_PACKAGE_META__
  fs.writeFileSync(infoFile, 'GameGlobal.__WXSLIM_PACKAGE_META__=GameGlobal.__WX15_PACKAGE_META__=' + JSON.stringify(meta) + ';\n');
  writeJson(path.join(dir, 'godot-data/package.metadata.json'), {files: meta.files, remote_package_size: data.length});
  cfg.launch.data.fileMD5 = md5; cfg.launch.data.fileSize = data.length; cfg.launch.data.optFileSize = data.length; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 4) + '\n');
  for (const f of fs.readdirSync(path.join(dir, 'data-package'))) if (f.endsWith('.data.bin') && f !== md5 + '.data.bin') fs.unlinkSync(path.join(dir, 'data-package', f));
  return {pckBytes: pck.length, pckSha256: sha(pck), dataId: md5};
}

/** Common packaging fixes every build needs. */
export function packagingFixes(dir, projectName) {
  const gf = path.join(dir, 'game.json'), g = readJson(gf), k = Array.isArray(g.subpackages) ? 'subpackages' : 'subPackages';
  g[k] = g[k].filter(x => x.name !== 'wasmcode2'); writeJson(gf, g); // wasmcode2 is packignored; declared-but-missing fails upload (800059)
  const pf = path.join(dir, 'project.config.json'), pc = readJson(pf); pc.projectname = projectName;
  if (!pc.packOptions.ignore.some(x => x.type === 'folder' && x.value.replace(/\/$/, '') === 'wasmcode2')) pc.packOptions.ignore.push({type: 'folder', value: 'wasmcode2'});
  writeJson(pf, pc);
  const tc = path.join(dir, '.plugincache/codesplitv2/config.json'); if (fs.existsSync(tc)) { const t = readJson(tc); t.project.workspaceRoot = dir; fs.writeFileSync(tc, JSON.stringify(t, null, 2)); }
}

/** Timing + whitelisted cloud log relay. keep = regex source for uploaded lines (errors always kept). */
export function installTelemetry(dir, {label, cloud, keep, mode = 'onclick'}) {
  const info = projectInfo(dir); fs.mkdirSync(path.join(dir, 'godot-data'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'godot-data/wxslim-sizes.js'), 'GameGlobal.__WXSLIM_SIZES__=' + JSON.stringify({primaryBr: info.primaryBr, code1Br: info.code1Br, mode}) + ';\n');
  fs.writeFileSync(path.join(dir, 'godot-data/wxslim-timing.js'), asset('wxslim-timing.js'));
  fs.writeFileSync(path.join(dir, 'phone-log.js'), asset('phone-log.js'));
  fs.writeFileSync(path.join(dir, 'phone-log-bootstrap.js'), replaceOnce(asset('phone-log-bootstrap.base.js'), 'const relay=', `effective=Object.assign({},effective,{keep:function(level,text){return level==='error'||/${keep}/.test(text);}});\n const relay=`, 'bootstrap'));
  fs.writeFileSync(path.join(dir, 'phone-log-config.js'), 'module.exports = ' + JSON.stringify({enabled: !!cloud?.env, env: cloud?.env || '', build: label, functionName: cloud?.functionName || 'phoneLogIngest'}, null, 2) + ';\n');
  // 老工程（2026-10-17 前 convert 的）里有 wx15-* 计时文件和 import：换成新的，避免装两份计时
  for (const old of ['wx15-sizes.js', 'wx15-timing.js']) fs.rmSync(path.join(dir, 'godot-data', old), {force: true});
  editText(path.join(dir, 'game.js'), s => {
    s = s.split("import './godot-data/wx15-sizes';\n").join('').split("import './godot-data/wx15-timing';\n").join('').split("GameGlobal.__WX15_TIMING__.mark('loader_start_ok');").join("GameGlobal.__WXSLIM_TIMING__.mark('loader_start_ok');");
    // convert 已经装了计时（wxslim-sizes/wxslim-timing 在最前面）时，只在它们后面补云日志引导；文件内容在上面已覆盖为分包后的版本。
    if (!s.includes("import './godot-data/wxslim-timing';")) s = "import './godot-data/wxslim-sizes';\nimport './godot-data/wxslim-timing';\nimport './phone-log-bootstrap';\n" + s;
    else if (!s.includes("import './phone-log-bootstrap';")) s = s.replace("import './godot-data/wxslim-timing';\n", "import './godot-data/wxslim-timing';\nimport './phone-log-bootstrap';\n");
    // Optional mark: only when the template's loader success line exists (otherwise the summary shows 插件加载器就绪 未知).
    if (s.includes("mark('loader_start_ok')") || s.split("console.log('start success');").length !== 2) return s + '\n';
    return s.replace("console.log('start success');", "GameGlobal.__WXSLIM_TIMING__.mark('loader_start_ok');\n    console.log('start success');");
  });
}

let DEVTOOLS = process.env.WECHAT_DEVTOOLS_DIR || 'C:/Program Files (x86)/Tencent/\u5fae\u4fe1web\u5f00\u53d1\u8005\u5de5\u5177';
export const setDevtoolsDir = d => { if (d) DEVTOOLS = d; };
export function wechatide(clientName, tool, args, {cwd, timeout = 120000, evidenceDir} = {}) {
  const exe = path.join(DEVTOOLS, '\u5fae\u4fe1\u5f00\u53d1\u8005\u5de5\u5177.exe'), entry = path.join(DEVTOOLS, 'resources/app.asar.unpacked/js/common/cli/skill-index.js');
  const bootstrap = "const e=process.argv[1],a=process.argv.slice(2).filter(x=>x!=='--electron');if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,e,'--electron',...a];require(e)";
  const env = {...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_TLS_REJECT_UNAUTHORIZED: '1', cwd: cwd || process.cwd()}; delete env.NODE_OPTIONS;
  return new Promise(res => execFile(exe, ['-e', bootstrap, entry, '-c', clientName, tool, ...args], {env, cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 ** 2}, (error, stdout, stderr) => {
    let raw = null; try { raw = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch {}
    if (evidenceDir) { fs.mkdirSync(evidenceDir, {recursive: true}); const d = fs.mkdtempSync(path.join(evidenceDir, tool + '-')); fs.writeFileSync(path.join(d, 'stdout.private.txt'), stdout || ''); fs.writeFileSync(path.join(d, 'stderr.private.txt'), stderr || ''); }
    res({ok: raw?.ok === true, raw, error});
  }));
}

/** Official wasmsplit-v2-ci call. Key path never printed; output to private log files. */
export function officialCli({cli, args, keyPath, logBase, timeoutMs = 900000}) {
  const env = {...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1'}; for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'WASM_SPLIT_PRIVATE_KEY_PATH', 'WASMSPLIT_LOG_FULL_SIG']) delete env[k];
  const out = fs.openSync(logBase + '.stdout.private.txt', 'wx'), err = fs.openSync(logBase + '.stderr.private.txt', 'wx');
  const child = spawn(process.execPath, [cli, ...args, '-k', keyPath], {env, windowsHide: true, stdio: ['ignore', out, err]});
  const timer = setTimeout(() => child.kill(), timeoutMs);
  return new Promise(r => child.once('close', code => { clearTimeout(timer); r(code); }));
}
