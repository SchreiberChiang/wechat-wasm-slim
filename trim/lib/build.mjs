// 编译：按 .gdbuild 编译微信版 Godot Web 引擎（配方来自已验证的 build-trim/research-trim）。
// 每次编译用独立的源码克隆（约 0.9 GB），日志写文件；同一目录可以续编（scons 增量）。
import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import zlib from 'node:zlib';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// lto 不在这里：由 build 参数 --lto 决定（full 体积最小但链接内存大；thin 内存小、速度快，Star Tap 实测 full 触发内存保护后用 thin 成功）。
export const COMMON_ARGS = ['platform=web', 'target=template_release', 'arch=wasm32', 'threads=no', 'wasm_simd=no', 'dlink_enabled=no', 'use_wx_glx=yes', 'javascript_eval=yes', 'opengl3=yes', 'optimize=size', 'debug_symbols=no', 'use_closure_compiler=no', 'initial_memory=32', 'stack_size=5120'];
// 编译器偶发崩溃的特征（Windows 访问冲突等），只有这类失败才自动重试；配置错误、源码错误直接失败。
const RETRYABLE = /0xC0000005|3221225477|Access violation|clang(\+\+)?: error: (unable to execute command|clang frontend command failed)|PLEASE submit a bug report|Stack dump:/i;
export const RUNTIME_TOKENS = ['callMain', 'WXMEMFS', 'GodotJSWrapper', 'godot_js_wrapper_interface_get', '__godotMinigameOriginalCommitFrame'];
export const SOURCE_TESTS = ['test_wechat_webgl_context_attributes.js', 'test_godot_process_commit_frame.js', 'test_wechat_glx_runtime.js'];
// 引擎附带的 libemscriptenglx 只匹配这个 emscripten 版本（checkToolchain 里的判断与它一致，doctor 用它报告）。
export const EMSCRIPTEN_VERSION = '4.0.10';
// Windows 命令行长度限制：em++ 链接参数改用 response 文件（只改 LINK，llvm-ar 保持原样）。
export const DETECT_ANCHOR = '    env["ARCOM"] = "${TEMPFILE(\'$ARCOM_POSIX\',\'$ARCOMSTR\')}"\n';
const LINK_ADAPTER = '    # ENGINE_LAB_WINDOWS_LINK_RESPONSE_V2\n    import shlex\n    from SCons.Platform import TempFileMunge\n\n    class LinkTempFileMungeV2(TempFileMunge):\n        def __call__(self, target, source, env, for_signature):\n            if for_signature:\n                return self.cmd\n            link_env = env.Clone()\n            link_env["TEMPFILEARGESCFUNC"] = lambda arg: shlex.quote(str(arg))\n            link_env["TEMPFILEENCODING"] = "utf-8"\n            return super().__call__(target, source, link_env, for_signature)\n\n    env["LINKCOM_POSIX_V2"] = env["LINKCOM"].replace("$TARGET", "$TARGET.posix").replace("$SOURCES", "$SOURCES.posix")\n    env["LINK_TEMPFILE_V2"] = LinkTempFileMungeV2\n    env["LINKCOM"] = "${LINK_TEMPFILE_V2(\'$LINKCOM_POSIX_V2\',\'$LINKCOMSTR\')}"\n';

function run(cmd, args, {cwd, env, log, timeoutMs = 3 * 3600e3}) {
  return new Promise((resolve, reject) => {
    const out = log ? fs.openSync(log, 'a') : 'ignore';
    const child = spawn(cmd, args, {cwd, env, windowsHide: true, stdio: ['ignore', out, out]});
    const t = setTimeout(() => { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}); }, timeoutMs);
    child.once('error', reject); child.once('close', code => { clearTimeout(t); if (log) fs.closeSync(out); code === 0 ? resolve() : reject(Error(`${path.basename(cmd)} exit ${code}${log ? '，日志：' + log : ''}`)); });
  });
}
export const capture = (cmd, args, opt = {}) => new Promise((res, rej) => { let s = ''; const c = spawn(cmd, args, {...opt, windowsHide: true}); c.stdout.on('data', d => s += d); c.stderr.on('data', d => s += d); c.once('error', rej); c.once('close', code => code === 0 ? res(s.trim()) : rej(Error(s.trim()))); });

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
  r.glxLibrary = await glxInput(tc, r.commit, tc.engineSource);
  return r;
}
export function buildEnv(tc) {
  const base = {...process.env}, cache = path.join(tc.emsdk, 'upstream/emscripten/cache');
  // Only sanitize the child environment; never change the caller's SDK session.
  for (const k of Object.keys(base)) if (/^(EM_|EMCC_|EMSDK|EMMAKEN_|BINARYEN_)|^(NODE_OPTIONS|NODE_PATH|PYTHONHOME|PYTHONPATH)$/i.test(k)) delete base[k];
  const env = {...base, PYTHONDONTWRITEBYTECODE: '1', EMSDK: tc.emsdk, EM_CONFIG: path.join(tc.emsdk, '.emscripten'), EMSDK_PYTHON: tc.python, EM_CACHE: cache, PATH: [path.dirname(tc.python), path.join(tc.emsdk, 'upstream/emscripten'), tc.emsdk, base.PATH ?? base.Path ?? ''].join(path.delimiter)};
  delete env.Path; delete env.NODE_OPTIONS; return env;
}

export function resolveToolchain(t, file) {
  const tc = {...t}, base = path.dirname(path.resolve(file));
  for (const k of ['engineSource', 'emsdk', 'python', 'glxLibrary']) if (tc[k]) tc[k] = path.resolve(base, tc[k]);
  tc.patches = (tc.patches || []).map(p => path.resolve(base, p));
  return tc;
}
// Read-only inspection must not refresh .git/index before a resume refusal.
const git = (dir, args) => capture('git.exe', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-C', dir, ...args]);
const fileIdentity = file => ({path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file))});
const gitBlob = (dir, ref) => new Promise((resolve, reject) => {
  const c = spawn('git.exe', ['-C', dir, 'show', ref], {windowsHide: true}), chunks = []; let err = '';
  c.stdout.on('data', b => chunks.push(b)); c.stderr.on('data', b => err += b);
  c.once('error', reject); c.once('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(Error(err)));
});

/** Snapshot only Git source state: generated/ignored build trees are never traversed. */
export async function sourceState(dir) {
  const trackedDiff = await git(dir, ['diff', '--binary', 'HEAD', '--', '.']);
  const allNames = (await git(dir, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const names = allNames.filter(n => !/^(bin|build|\.scons|\.cache|\.godot)\//.test(n) && /\.(c|cc|cpp|h|hpp|py|js|mjs|json|gd|glsl|inc|inl|txt|patch)$|(^|\/)SC(sub|onstruct)$/.test(n));
  // Keep an aggregate digest and a bounded path preview, not a dump of untracked artifacts.
  const entries = names.map(name => {
    const file = path.join(dir, name), st = fs.lstatSync(file);
    return {path: name, bytes: st.size, sha256: st.isFile() ? sha(fs.readFileSync(file)) : sha(fs.readlinkSync(file))};
  });
  return {head: await git(dir, ['rev-parse', 'HEAD']), trackedDiff,
    trackedDiffSha256: sha(trackedDiff), untracked: {scope: 'source extensions and SCons files, excluding build/bin/cache directories', count: entries.length, excludedCount: allNames.length - names.length, sha256: sha(JSON.stringify(entries)), paths: names.slice(0, 40), truncated: names.length > 40}};
}

/** Resolve the exact library that will be linked, including the legacy bundled default. */
export async function glxInput(tc, commit, stage) {
  if (tc.glxLibrarySha256 && !tc.glxLibrary) throw Error('glxLibrarySha256 需要 glxLibrary');
  let library;
  if (tc.glxLibrary) {
    if (!/^[0-9a-f]{64}$/i.test(tc.glxLibrarySha256 || '')) throw Error('外部 glxLibrary 必须配置 64 位 glxLibrarySha256');
    library = {...fileIdentity(tc.glxLibrary), kind: 'external'};
    if (library.sha256 !== tc.glxLibrarySha256.toLowerCase()) throw Error('GLX library SHA256 mismatch: ' + library.path);
  } else {
    const files = (await git(tc.engineSource, ['ls-tree', '-r', '--name-only', commit])).split('\n');
    const matches = files.filter(f => /(^|\/)libemscriptenglx_4\.0\.10\.a$/.test(f));
    if (matches.length !== 1) throw Error('无法唯一确定源码附带的 libemscriptenglx_4.0.10.a');
    const blob = await gitBlob(tc.engineSource, `${commit}:${matches[0]}`);
    library = {kind: 'bundled', sourcePath: matches[0], path: path.resolve(stage, matches[0]), bytes: blob.length, sha256: sha(blob)};
  }
  return library;
}

export async function buildIdentity({tc, profileFile, stage, lto, symbols, ltoJobs}) {
  const commit = await git(tc.engineSource, ['rev-parse', tc.pin || 'HEAD']);
  const glxLibrary = await glxInput(tc, commit, stage);
  const sdkFiles = ['.emscripten', '.emsdk_version', 'upstream/emscripten/emscripten-version.txt', 'upstream/emscripten/emcc.py', 'upstream/emscripten/em++.py',
    'upstream/bin/clang.exe', 'upstream/bin/wasm-ld.exe', 'upstream/bin/wasm-opt.exe', 'upstream/bin/clang', 'upstream/bin/wasm-ld', 'upstream/bin/wasm-opt'];
  for (const category of ['node', 'python']) {
    const root = path.join(tc.emsdk, category);
    if (fs.existsSync(root)) for (const dir of fs.readdirSync(root)) for (const exe of category === 'node' ? ['node.exe', 'bin/node.exe', 'bin/node'] : ['python.exe', 'bin/python.exe', 'bin/python3']) {
      const rel = `${category}/${dir}/${exe}`; if (fs.existsSync(path.join(tc.emsdk, rel))) sdkFiles.push(rel);
    }
  }
  const files = sdkFiles.map(f => path.join(tc.emsdk, f)).filter(fs.existsSync).map(fileIdentity);
  // This is a bounded SDK fingerprint, not a claim of hashing every SDK/cache byte.
  const sdkRoot = await git(tc.emsdk, ['rev-parse', '--show-toplevel']).catch(() => null);
  const gitHead = sdkRoot && path.resolve(sdkRoot).toLowerCase() === path.resolve(tc.emsdk).toLowerCase() ? await git(tc.emsdk, ['rev-parse', 'HEAD']) : null;
  const venvConfig = path.join(path.dirname(tc.python), '..', 'pyvenv.cfg');
  const pythonVenv = fs.existsSync(venvConfig) ? fileIdentity(venvConfig) : null;
  const venvText = pythonVenv ? fs.readFileSync(venvConfig, 'utf8') : '';
  const baseExecutable = /^executable\s*=\s*(.+)$/m.exec(venvText)?.[1].trim();
  const sdk = {path: path.resolve(tc.emsdk), gitHead, files, python: fileIdentity(tc.python), pythonVenv,
    pythonBase: baseExecutable && fs.existsSync(baseExecutable) ? fileIdentity(baseExecutable) : null};
  return {contractVersion: 2, pin: commit, patches: (tc.patches || []).map(p => ({file: path.basename(p), sha256: sha(fs.readFileSync(p))})),
    cppdefines: tc.cppdefines || '', lto, ltoJobs: lto === 'thin' ? ltoJobs : null, symbols,
    profileSha256: sha(fs.readFileSync(profileFile)), commonArgs: COMMON_ARGS, glxLibrary, sdk,
    hostRuntime: {node: fileIdentity(process.execPath), versions: {...process.versions}}, windowsAdapterSha256: sha(LINK_ADAPTER)};
}

export function assertBuildIdentity(previous, identity, state) {
  if (previous && JSON.stringify(previous) !== JSON.stringify(identity)) throw Error('这个 --work 目录上次的编译输入不同（源码/补丁/宏/参数/profile/GLX/SDK），不能续编。换一个新的 --work 目录。差异见 ' + state);
}

export function assertStageInputs(previous, current) {
  if (!previous || !/^[0-9a-f]{40,64}$/.test(previous.head || '') || typeof previous.trackedDiff !== 'string' ||
      previous.trackedDiffSha256 !== sha(previous.trackedDiff) || !/^[0-9a-f]{64}$/.test(previous.untracked?.sha256 || '')) {
    throw Error('stage 初始化证据缺失或不完整，请保留现场并使用新目录');
  }
  if (previous.head !== current.head || previous.trackedDiffSha256 !== current.trackedDiffSha256 || previous.untracked.sha256 !== current.untracked.sha256) {
    throw Error('stage source 在续编前已改变（包含未跟踪源码），请保留现场并使用新目录');
  }
}

export function outputPair(glue, raw, br) {
  const outputs = Object.fromEntries([['godot.js', glue], ['godot.wasm', raw], ['godot.wasm.br', br]].map(([name, b]) => [name, {bytes: b.length, sha256: sha(b)}]));
  return {outputs, pairing: {sha256: sha(JSON.stringify(outputs)), files: Object.keys(outputs), brotliDecodesToWasm: zlib.brotliDecompressSync(br).equals(raw)}};
}

/** 编译一个 .gdbuild。workDir 下：engine/（源码克隆）、logs/、artifacts/、BUILD.json。 */
export async function buildEngine({tc, profileFile, workDir, symbols = true, jobs = 8, retries = 2, lto = 'full', ltoJobs = 4, maxMinutes = 120, onLog = () => {}}) {
  if (!['full', 'thin', 'none'].includes(lto)) throw Error('--lto 只能是 full / thin / none');
  const stage = path.join(workDir, 'engine'), logs = path.join(workDir, 'logs'), state = path.join(workDir, 'BUILD.json');
  // Fail closed before logs, records, adapters or temporary files can alter an interrupted scene.
  // Legacy records with complete stage evidence remain resumable; identity alone is not evidence.
  const resuming = fs.existsSync(workDir) && fs.readdirSync(workDir).length > 0;
  let rec = {startedAt: new Date().toISOString()};
  if (resuming) {
    const refuse = () => Error('构建初始化未完成或证据不可信，不能续编；请保留现场并使用新的 --work 目录');
    try { rec = JSON.parse(fs.readFileSync(state, 'utf8')); } catch { throw refuse(); }
    if (!rec || !rec.identity || !fs.existsSync(path.join(stage, '.git')) ||
        ('initialization' in rec && (rec.initialization?.version !== 1 || rec.initialization?.status !== 'complete'))) throw refuse();
    assertStageInputs(rec.stage, rec.stage);
    const stageRoot = await git(stage, ['rev-parse', '--show-toplevel']);
    if (path.resolve(stageRoot).toLowerCase() !== path.resolve(stage).toLowerCase()) throw refuse();
  }
  // 编译身份：源码提交、补丁、宏、编译参数、build profile 的哈希。续编时必须和上次完全一致，否则拒绝混用。
  const identity = await buildIdentity({tc, profileFile, stage, lto, symbols, ltoJobs});
  assertBuildIdentity(rec.identity, identity, state);
  if (resuming) {
    const current = await sourceState(stage);
    if (current.head !== identity.pin) throw Error('stage HEAD 不匹配编译身份');
    assertStageInputs(rec.stage, current);
    if (fileIdentity(identity.glxLibrary.path).sha256 !== identity.glxLibrary.sha256) throw Error('stage/external GLX library SHA256 mismatch');
  }
  await fsp.mkdir(logs, {recursive: true});
  rec.identity = identity;
  if (!resuming) rec.initialization = {version: 1, status: 'initializing'};
  const save = () => fs.writeFileSync(state, JSON.stringify(rec, null, 2) + '\n');
  rec.source = {...await sourceState(tc.engineSource), policy: 'Only the pinned commit is cloned; source working-tree changes are not copied.'};
  save();
  const env = {...buildEnv(tc), TEMP: path.join(workDir, 'temp'), TMP: path.join(workDir, 'temp'), EMCC_TEMP_DIR: path.join(workDir, 'temp')}; await fsp.mkdir(env.TEMP, {recursive: true});
  if (!resuming) {
    onLog('克隆引擎源码（独立副本）…');
    await run('git.exe', ['clone', '--no-local', '--no-hardlinks', '--no-checkout', tc.engineSource, stage], {log: path.join(logs, 'clone.log')});
    await run('git.exe', ['-C', stage, 'config', 'core.autocrlf', 'false'], {log: path.join(logs, 'clone.log')});
    await run('git.exe', ['-C', stage, 'checkout', '--detach', identity.pin], {log: path.join(logs, 'clone.log')});
    for (const p of tc.patches || []) await run('git.exe', ['-C', stage, 'apply', '--whitespace=nowarn', p], {log: path.join(logs, 'patches.log')});
  }
  const detect = path.join(stage, 'platform/web/detect.py'); let dt = fs.readFileSync(detect, 'utf8');
  if (!resuming && !dt.includes('ENGINE_LAB_WINDOWS_LINK_RESPONSE_V')) { if (dt.split(DETECT_ANCHOR).length !== 2) throw Error('detect.py 锚点变了，无法加 Windows 链接适配'); fs.writeFileSync(detect, dt.replace(DETECT_ANCHOR, DETECT_ANCHOR + '\n' + LINK_ADAPTER)); }
  const stageState = {...await sourceState(stage), policy: 'Pinned commit plus configured patches and Windows link response adapter.'};
  if (stageState.head !== identity.pin) throw Error('stage HEAD 不匹配编译身份');
  if (resuming) assertStageInputs(rec.stage, stageState);
  rec.stage = stageState;
  rec.stageInputs = rec.stage.trackedDiffSha256;
  if (fileIdentity(identity.glxLibrary.path).sha256 !== identity.glxLibrary.sha256) throw Error('stage/external GLX library SHA256 mismatch');
  rec.initialization = {version: 1, status: 'complete'};
  save();
  for (const t of SOURCE_TESTS) { const f = path.join(stage, 'platform/web/js/tests', t); if (fs.existsSync(f)) await run(process.execPath, [f], {cwd: stage, env, log: path.join(logs, 'source-tests.log')}); }
  const profile = path.join(workDir, 'profile.gdbuild'); fs.copyFileSync(profileFile, profile);
  const args = [...COMMON_ARGS, `lto=${lto}`, `--jobs=${jobs}`, 'modules_enabled_by_default=yes', `build_profile=${profile}`];
  args.push(`wx_glx_lib=${identity.glxLibrary.path}`);
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
  Object.assign(rec, {finishedAt: new Date().toISOString(), enabledModules: enabled, wasmBytes: raw.length, wasmBrBytes: br.length, glueBytes: glue.length, symbols: !!symSrc, wasmSha256: sha(raw), glueSha256: sha(glue), wasmBrSha256: sha(br), ...outputPair(glue, raw, br)}); save();
  return rec;
}
