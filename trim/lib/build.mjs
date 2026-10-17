// 编译：按 .gdbuild 编译微信版 Godot Web 引擎（配方来自已验证的 build-trim/research-trim）。
// 每次编译用独立的源码克隆（约 0.9 GB），日志写文件；同一目录可以续编（scons 增量）。
import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import zlib from 'node:zlib';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// lto 不在这里：由 build 参数 --lto 决定（full 体积最小但链接内存大；thin 内存小、速度快，Star Tap 实测 full 触发内存保护后用 thin 成功）。
export const COMMON_ARGS = ['platform=web', 'target=template_release', 'arch=wasm32', 'threads=no', 'wasm_simd=no', 'dlink_enabled=no', 'use_wx_glx=yes', 'javascript_eval=yes', 'opengl3=yes', 'optimize=size', 'debug_symbols=no', 'use_closure_compiler=no', 'initial_memory=32', 'stack_size=5120'];
// 编译器偶发崩溃的特征（Windows 访问冲突等），只有这类失败才自动重试；配置错误、源码错误直接失败。
const RETRYABLE = /0xC0000005|3221225477|Access violation|clang(\+\+)?: error: (unable to execute command|clang frontend command failed)|PLEASE submit a bug report|Stack dump:/i;
const RUNTIME_TOKENS = ['callMain', 'WXMEMFS', 'GodotJSWrapper', 'godot_js_wrapper_interface_get', '__godotMinigameOriginalCommitFrame'];
const SOURCE_TESTS = ['test_wechat_webgl_context_attributes.js', 'test_godot_process_commit_frame.js', 'test_wechat_glx_runtime.js'];
// Windows 命令行长度限制：em++ 链接参数改用 response 文件（只改 LINK，llvm-ar 保持原样）。
const DETECT_ANCHOR = '    env["ARCOM"] = "${TEMPFILE(\'$ARCOM_POSIX\',\'$ARCOMSTR\')}"\n';
const LINK_ADAPTER = '    # ENGINE_LAB_WINDOWS_LINK_RESPONSE_V2\n    import shlex\n    from SCons.Platform import TempFileMunge\n\n    class LinkTempFileMungeV2(TempFileMunge):\n        def __call__(self, target, source, env, for_signature):\n            if for_signature:\n                return self.cmd\n            link_env = env.Clone()\n            link_env["TEMPFILEARGESCFUNC"] = lambda arg: shlex.quote(str(arg))\n            link_env["TEMPFILEENCODING"] = "utf-8"\n            return super().__call__(target, source, link_env, for_signature)\n\n    env["LINKCOM_POSIX_V2"] = env["LINKCOM"].replace("$TARGET", "$TARGET.posix").replace("$SOURCES", "$SOURCES.posix")\n    env["LINK_TEMPFILE_V2"] = LinkTempFileMungeV2\n    env["LINKCOM"] = "${LINK_TEMPFILE_V2(\'$LINKCOM_POSIX_V2\',\'$LINKCOMSTR\')}"\n';

function run(cmd, args, {cwd, env, log, timeoutMs = 3 * 3600e3}) {
  return new Promise((resolve, reject) => {
    const out = log ? fs.openSync(log, 'a') : 'ignore';
    const child = spawn(cmd, args, {cwd, env, windowsHide: true, stdio: ['ignore', out, out]});
    const t = setTimeout(() => { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}); }, timeoutMs);
    child.once('error', reject); child.once('close', code => { clearTimeout(t); if (log) fs.closeSync(out); code === 0 ? resolve() : reject(Error(`${path.basename(cmd)} exit ${code}${log ? '，日志：' + log : ''}`)); });
  });
}
const capture = (cmd, args, opt = {}) => new Promise((res, rej) => { let s = ''; const c = spawn(cmd, args, {...opt, windowsHide: true}); c.stdout.on('data', d => s += d); c.stderr.on('data', d => s += d); c.once('close', code => code === 0 ? res(s.trim()) : rej(Error(s.trim()))); });

/** 检查工具链：Python+SCons、emscripten 4.0.10、git、源码固定提交。 */
export async function checkToolchain(tc) {
  const r = {};
  const env = buildEnv(tc);
  r.python = await capture(tc.python, ['--version'], {env});
  r.scons = await capture(tc.python, ['-c', 'import SCons;print(SCons.__version__)'], {env});
  r.emcc = (await capture(tc.python, [path.join(tc.emsdk, 'upstream/emscripten/emcc.py'), '--version'], {env})).split('\n')[0];
  if (!/4\.0\.10/.test(r.emcc)) throw Error('需要 emscripten 4.0.10（引擎附带的 libemscriptenglx 只匹配这个版本）：' + r.emcc);
  r.commit = await capture('git.exe', ['-C', tc.engineSource, 'rev-parse', 'HEAD']);
  if (tc.pin && r.commit !== tc.pin) throw Error(`引擎源码提交不对：期望 ${tc.pin}，实际 ${r.commit}`);
  return r;
}
export function buildEnv(tc) {
  const base = {...process.env}, cache = path.join(tc.emsdk, 'upstream/emscripten/cache');
  const env = {...base, EMSDK: tc.emsdk, EM_CONFIG: path.join(tc.emsdk, '.emscripten'), EMSDK_PYTHON: tc.python, EM_CACHE: cache, PATH: [path.dirname(tc.python), path.join(tc.emsdk, 'upstream/emscripten'), tc.emsdk, base.PATH ?? base.Path ?? ''].join(path.delimiter)};
  delete env.Path; delete env.NODE_OPTIONS; return env;
}

/** 编译一个 .gdbuild。workDir 下：engine/（源码克隆）、logs/、artifacts/、BUILD.json。 */
export async function buildEngine({tc, profileFile, workDir, symbols = true, jobs = 8, retries = 2, lto = 'full', ltoJobs = 4, maxMinutes = 120, onLog = () => {}}) {
  if (!['full', 'thin', 'none'].includes(lto)) throw Error('--lto 只能是 full / thin / none');
  await fsp.mkdir(path.join(workDir, 'logs'), {recursive: true});
  const stage = path.join(workDir, 'engine'), logs = path.join(workDir, 'logs'), state = path.join(workDir, 'BUILD.json');
  const rec = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : {startedAt: new Date().toISOString()};
  // 编译身份：源码提交、补丁、宏、编译参数、build profile 的哈希。续编时必须和上次完全一致，否则拒绝混用。
  const identity = {pin: tc.pin || null, patches: (tc.patches || []).map(p => ({file: path.basename(p), sha256: sha(fs.readFileSync(p))})), cppdefines: tc.cppdefines || '', lto, symbols, profileSha256: sha(fs.readFileSync(profileFile)), commonArgs: COMMON_ARGS};
  if (rec.identity && JSON.stringify(rec.identity) !== JSON.stringify(identity)) throw Error('这个 --work 目录上次的编译输入不同（源码/补丁/宏/参数/profile），不能续编。换一个新的 --work 目录。差异见 ' + state);
  rec.identity = identity;
  const save = () => fs.writeFileSync(state, JSON.stringify(rec, null, 2) + '\n');
  const env = {...buildEnv(tc), TEMP: path.join(workDir, 'temp'), TMP: path.join(workDir, 'temp'), EMCC_TEMP_DIR: path.join(workDir, 'temp')}; await fsp.mkdir(env.TEMP, {recursive: true});
  if (!fs.existsSync(stage)) {
    onLog('克隆引擎源码（独立副本）…');
    await run('git.exe', ['clone', '--no-local', '--no-hardlinks', '--no-checkout', tc.engineSource, stage], {log: path.join(logs, 'clone.log')});
    await run('git.exe', ['-C', stage, 'config', 'core.autocrlf', 'false'], {log: path.join(logs, 'clone.log')});
    await run('git.exe', ['-C', stage, 'checkout', '--detach', tc.pin || 'HEAD'], {log: path.join(logs, 'clone.log')});
    for (const p of tc.patches || []) await run('git.exe', ['-C', stage, 'apply', '--whitespace=nowarn', p], {log: path.join(logs, 'patches.log')});
  }
  const detect = path.join(stage, 'platform/web/detect.py'); let dt = fs.readFileSync(detect, 'utf8');
  if (!dt.includes('ENGINE_LAB_WINDOWS_LINK_RESPONSE_V')) { if (dt.split(DETECT_ANCHOR).length !== 2) throw Error('detect.py 锚点变了，无法加 Windows 链接适配'); fs.writeFileSync(detect, dt.replace(DETECT_ANCHOR, DETECT_ANCHOR + '\n' + LINK_ADAPTER)); }
  for (const t of SOURCE_TESTS) { const f = path.join(stage, 'platform/web/js/tests', t); if (fs.existsSync(f)) await run(process.execPath, [f], {cwd: stage, env, log: path.join(logs, 'source-tests.log')}); }
  const profile = path.join(workDir, 'profile.gdbuild'); fs.copyFileSync(profileFile, profile);
  const args = [...COMMON_ARGS, `lto=${lto}`, `--jobs=${jobs}`, 'modules_enabled_by_default=yes', `build_profile=${profile}`];
  if (tc.cppdefines) args.push(`cppdefines=${tc.cppdefines}`);
  const linkflags = [symbols ? '--emit-symbol-map' : '', lto === 'thin' ? `-Wl,--thinlto-jobs=${ltoJobs}` : ''].filter(Boolean).join(' ');
  if (linkflags) args.push('linkflags=' + linkflags);
  rec.sconsArgs = args; rec.profileSha256 = sha(fs.readFileSync(profile)); save();
  onLog(`开始编译（约 30–50 分钟），日志：${path.join(logs, 'build.log')}`);
  // 编译器偶发崩溃（如 clang 0xC0000005）时自动重试；SCons 增量编译，重试只补未完成的部分。
  // 只对编译器崩溃自动重试；所有尝试共用 maxMinutes 总预算。
  const t0 = Date.now(), deadline = t0 + maxMinutes * 60e3; rec.attempts = rec.attempts || 0;
  for (let i = 0; ; i++) {
    rec.attempts++; save();
    const left = deadline - Date.now(); if (left <= 0) throw Error(`超过总时间预算 ${maxMinutes} 分钟`);
    const logFile = path.join(logs, 'build.log'), before = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    try { await run(tc.python, ['-m', 'SCons', ...args], {cwd: stage, env, log: logFile, timeoutMs: left}); break; }
    catch (e) {
      const fd = fs.openSync(logFile, 'r'), size = fs.statSync(logFile).size, len = Math.min(size - before, 2e6), buf = Buffer.alloc(Math.max(len, 0));
      if (len > 0) fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
      const retryable = RETRYABLE.test(buf.toString('utf8'));
      if (!retryable) throw Error(`${e.message}（不是编译器崩溃，不自动重试）`);
      if (i >= retries) throw Error(`${e.message}（编译器崩溃，已重试 ${retries} 次）`);
      onLog(`编译器崩溃（${e.message}），第 ${i + 1} 次自动重试（同一目录增量续编）…`);
    }
  }
  rec.buildMinutes = Math.round((Date.now() - t0) / 600) / 100;
  const enabled = [...fs.readFileSync(path.join(stage, 'modules/modules_enabled.gen.h'), 'utf8').matchAll(/^#define MODULE_(\w+)_ENABLED\b/gm)].map(x => x[1].toLowerCase()).sort();
  await run(process.execPath, [path.join(stage, 'godot_process.js')], {cwd: stage, env, log: path.join(logs, 'postprocess.log')});
  const glue = fs.readFileSync(path.join(stage, 'bin/.web_zip/godot.js')), raw = fs.readFileSync(path.join(stage, 'bin/.web_zip/godot.wasm')), text = glue.toString('utf8');
  for (const tok of RUNTIME_TOKENS) if (!text.includes(tok)) throw Error('godot.js 缺少微信运行时约定：' + tok);
  if (raw.toString('hex', 0, 8) !== '0061736d01000000') throw Error('不是 WASM 文件');
  const br = zlib.brotliCompressSync(raw, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length}});
  const art = path.join(workDir, 'artifacts'); await fsp.mkdir(art, {recursive: true});
  fs.writeFileSync(path.join(art, 'godot.js'), glue); fs.writeFileSync(path.join(art, 'godot.wasm'), raw); fs.writeFileSync(path.join(art, 'godot.wasm.br'), br);
  const symSrc = [path.join(stage, 'bin/.web_zip/godot.js.symbols'), path.join(stage, 'bin/godot.web.template_release.wasm32.nothreads.js.symbols')].find(fs.existsSync);
  if (symSrc) { const lines = fs.readFileSync(symSrc, 'utf8'); fs.writeFileSync(path.join(art, 'godot.js.symbols'), lines); const map = {}; for (const l of lines.split('\n')) { const i = l.indexOf(':'); if (i > 0) map[l.slice(0, i)] = l.slice(i + 1).trim(); } fs.writeFileSync(path.join(art, 'symbols.json'), JSON.stringify(map)); }
  Object.assign(rec, {finishedAt: new Date().toISOString(), enabledModules: enabled, wasmBytes: raw.length, wasmBrBytes: br.length, glueBytes: glue.length, symbols: !!symSrc, wasmSha256: sha(raw)}); save();
  return rec;
}
