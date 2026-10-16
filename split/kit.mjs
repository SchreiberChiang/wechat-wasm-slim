#!/usr/bin/env node
// 微信小游戏 WASM 分包工具（官方 wasmsplit-v2-ci + 点击下载门 + 兜底 + 中文云日志）。用法见 README.md。
import fs from 'node:fs';import path from 'node:path';
import {sha, readJson, writeJson, check, copyTree, editText, asset, kitDir, projectInfo, installPck, packagingFixes, installTelemetry, wechatide, officialCli, setDevtoolsDir} from './lib/common.mjs';
import {patchRuntime} from './lib/runtime-patches.mjs';

const argv = process.argv.slice(2), cmd = argv[0];
const opt = k => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : undefined; };
const flag = k => argv.includes('--' + k);
const need = k => { const v = opt(k); check(v, 'MISSING_OPTION --' + k); return v; };
const abs = p => path.resolve(p);
function config() { const f = abs(need('config')); const c = readJson(f); c.__dir = path.dirname(f); c.__file = f; if (c.devtoolsDir) setDevtoolsDir(path.resolve(c.__dir, c.devtoolsDir)); return c; }
// Private key: env WASMSPLIT_KIT_KEY, config.privateKeyPath, or legacy config.keyMetadata (JSON with privateKeyPath). Never printed.
function keyPathOf(c) { const k = process.env.WASMSPLIT_KIT_KEY || (c.privateKeyPath && path.resolve(c.__dir, c.privateKeyPath)) || (c.keyMetadata && readJson(path.resolve(c.__dir, c.keyMetadata)).privateKeyPath); check(k && path.isAbsolute(k) && fs.existsSync(k), 'PRIVATE_KEY_NOT_CONFIGURED'); return k; }
const fromCfg = (c, p) => path.resolve(c.__dir, p);
const ledgerDir = c => { const d = fromCfg(c, c.workDir || '.'); fs.mkdirSync(path.join(d, 'ledgers'), {recursive: true}); return d; };
const KEEP_RELEASE = 'WX15_TIMING|WX15_RELEASE_CLICK|WX15_FALLBACK|PHONE_LOG_START|transition_failed|COVERAGE_MISS|WX15_CLICK_';
const KEEP_COLLECT = 'WX15_TIMING|PHONE_LOG_START|transition_failed|collection_gate_complete';

/** Build labels must be unique per uploaded package (two versions sharing a label are indistinguishable in cloud logs). */
function claimLabel(c, label) {
  const f = path.join(ledgerDir(c), 'ledgers', 'labels.json'), used = fs.existsSync(f) ? readJson(f) : {};
  check(!used[label], 'LABEL_ALREADY_USED:' + label); used[label] = new Date().toISOString(); writeJson(f, used);
}

const commands = {
  // 正式包：官方 Release 产物 → 点击下载门 + 计时/云日志 + 兜底 + 安卓 waiterMode 修复 + 正式 PCK。
  async assemble() {
    const c = config(), from = abs(need('from')), out = abs(need('out')), label = need('label'), mode = opt('mode') || 'onclick', drop = flag('drop-secondary');
    check(['onclick', 'measured'].includes(mode), 'MODE onclick|measured'); check(!drop || mode === 'measured', 'DROP_SECONDARY_NEEDS_MEASURED');
    const info = projectInfo(from); check(info.isProfile === false, 'NEED_RELEASE_OUTPUT (isProfile=false)');
    copyTree(from, out);
    const rf = path.join(out, 'wasm-split.js'), r = patchRuntime(fs.readFileSync(rf, 'utf8'), {mode: 'release', core: asset('click-owned-runtime-core.js'), measured: mode === 'measured', allowUnknownTemplate: flag('allow-unknown-runtime')});
    fs.writeFileSync(rf, r.text);
    // PCK swap only applies to projects that carry godot-data/package-info.js (our export glue); otherwise the project's own PCK is used.
    const pck = c.releasePck ? installPck(out, fromCfg(c, c.releasePck), label.toLowerCase(), 'release_primary_then_click_complement') : 'PROJECT_PCK_UNCHANGED';
    if (c.releaseInterfaces) fs.copyFileSync(fromCfg(c, c.releaseInterfaces), path.join(out, 'godot-data/local-interfaces.js'));
    if (drop) { fs.rmSync(path.join(out, 'wasmcode1'), {recursive: true}); const gf = path.join(out, 'game.json'), g = readJson(gf), k = Array.isArray(g.subpackages) ? 'subpackages' : 'subPackages'; g[k] = g[k].filter(x => x.name !== 'wasmcode1'); writeJson(gf, g); }
    installTelemetry(out, {label, cloud: c.cloud, keep: KEEP_RELEASE + '|WX15_PRIMARY_MISS|WX15_FALLBACK_FAILED', mode});
    packagingFixes(out, c.projectName + ' ' + label);
    claimLabel(c, label);
    const result = {kind: 'release', mode, dropSecondary: drop, at: new Date().toISOString(), from, out, label, runtime: {before: r.beforeSha256, after: r.afterSha256, patches: r.applied.length}, pck, ...projectInfo(out)};
    writeJson(path.join(path.dirname(out), path.basename(out) + '.ASSEMBLY.json'), result); console.log(JSON.stringify(result, null, 1));
  },
  // 真机采集包：官方 Profile 产物 → 训练 PCK（点击后走完等待但不进重场景）+ 训练等待门 + 计时/云日志。
  async 'collect-pack'() {
    const c = config(), from = abs(need('from')), out = abs(need('out')), label = need('label');
    const info = projectInfo(from); check(info.isProfile === true, 'NEED_PROFILE_OUTPUT (isProfile=true)');
    copyTree(from, out);
    const rf = path.join(out, 'wasm-split.js'), r = patchRuntime(fs.readFileSync(rf, 'utf8'), {mode: 'profile', allowUnknownTemplate: flag('allow-unknown-runtime')}); fs.writeFileSync(rf, r.text);
    const full = flag('full-game'), pckFile = full ? c.releasePck : c.trainingPck, pck = pckFile ? installPck(out, fromCfg(c, pckFile), label.toLowerCase(), full ? 'profile_collection_full_game' : 'profile_collection_heavy_scene_locked') : 'PROJECT_PCK_UNCHANGED';
    // Training gate is appended to a script the game already loads (config.trainingGateHost, default godot-data/local-interfaces.js).
    const li = path.join(out, c.trainingGateHost || 'godot-data/local-interfaces.js'); if (c.releaseInterfaces) fs.copyFileSync(fromCfg(c, c.releaseInterfaces), li);
    check(fs.existsSync(li), 'TRAINING_GATE_HOST_MISSING:' + li);
    editText(li, s => s.includes('WX15_TRAINING12_GATE') ? s + '\n' : s + '\n' + asset('training-gate.js'));
    installTelemetry(out, {label, cloud: c.cloud, keep: KEEP_COLLECT});
    packagingFixes(out, c.projectName + ' ' + label);
    claimLabel(c, label);
    const result = {kind: 'collect', at: new Date().toISOString(), from, out, label, pck, ...projectInfo(out)};
    writeJson(path.join(path.dirname(out), path.basename(out) + '.ASSEMBLY.json'), result); console.log(JSON.stringify(result, null, 1));
  },
  // 官方 CLI：dosplit profile|release / getinfo / showfuncname。一次一个台账，不自动重试。
  async split() {
    const c = config(), mode = argv[1], project = fromCfg(c, c.workProject); check(['profile', 'release', 'getinfo', 'showfuncname'].includes(mode), 'MODE');
    const tag = opt('tag') || new Date().toISOString().replace(/[:.]/g, '-'), base = path.join(ledgerDir(c), 'ledgers', `split-${mode}-${tag}`);
    const before = projectInfo(project); writeJson(base + '.json', {mode, startedAt: new Date().toISOString(), before}, 'wx');
    const keyPath = keyPathOf(c);
    const args = mode === 'profile' ? ['dosplit', '-p', project] : mode === 'release' ? ['dosplit', '-p', project, '--release'] : mode === 'getinfo' ? ['getinfo', '-p', project, '-o', base + '.gameinfo.private.txt'] : ['showfuncname', '-p', project, '-o', base + '-funcnames'];
    const code = await officialCli({cli: fromCfg(c, c.officialCli), args, keyPath, logBase: base});
    const after = projectInfo(project); writeJson(base + '.json', {mode, finishedAt: new Date().toISOString(), exitCode: code, before, after});
    const tail = fs.readFileSync(base + '.stdout.private.txt', 'utf8').split('\n').filter(l => /subVersion|FuncNum|完成|个\)|失败|错误/.test(l) && !/key|sig|token/i.test(l));
    console.log(JSON.stringify({mode, exitCode: code, subVersion: after.subVersion, isProfile: after.isProfile}), '\n' + tail.join('\n'));
    if (code !== 0) process.exitCode = 1;
  },
  // 离线测试：用真实运行时代码 + 模拟 wx（waiterMode 只有 await() 才完成）。
  async verify() {
    const {runWaiterTests} = await import('./lib/offline-tests.mjs'); const r = runWaiterTests(fs.readFileSync(path.join(abs(need('project')), 'wasm-split.js'), 'utf8'));
    for (const x of r) console.log(x.ok ? 'PASS' : 'FAIL', x.name, x.ok ? '' : x.error); if (r.some(x => !x.ok)) process.exitCode = 1;
  },
  // 开发者工具本地操作（不含上传）：open / refresh / close / console / screenshot。
  async ide() {
    const c = config(), action = argv[1], project = abs(need('project'));
    const map = {open: 'open_project_window', refresh: 'simulator_refresh', close: 'close_project_window', console: 'get_simulator_console', screenshot: 'simulator_screenshot'};
    check(map[action], 'IDE_ACTION'); const args = ['--project', project]; if (action === 'console') args.push('--command', opt('grep') || 'grep WX15_TIMING');
    if (action === 'screenshot') args.push('--path', abs(opt('path') || path.join(ledgerDir(c), 'shot.jpg')));
    const r = await wechatide(c.clientName || 'Claude', map[action], args, {cwd: path.dirname(project), evidenceDir: path.join(ledgerDir(c), 'ide-evidence')});
    console.log(action === 'console' ? String(r.raw?.result ?? '').split('\n').map(l => l.replace(/","\{.*$/, '').slice(0, 300)).join('\n') : JSON.stringify(r.raw?.result ?? r.raw));
  },
  // 体验版上传（需在开发者工具里人工确认）。上传前不要关项目窗口，否则会 abort。
  async upload() {
    const c = config(), project = abs(need('project')), version = need('version'), desc = need('desc');
    const f = path.join(ledgerDir(c), 'ledgers', `upload-${version}.json`), ledger = {project, version, desc, reservedAt: new Date().toISOString(), label: readLabel(project)};
    writeJson(f, ledger, 'wx');
    const r = await wechatide(c.clientName || 'Claude', 'upload', ['--project', project, '--upload-version', version, '--desc', desc], {cwd: path.dirname(project), timeout: 300000, evidenceDir: path.join(ledgerDir(c), 'ide-evidence')});
    Object.assign(ledger, {finishedAt: new Date().toISOString(), ok: r.ok, status: r.raw?.result?.status ?? (r.ok ? 'success' : 'failed'), taskId: r.raw?.result?.taskId ?? null, message: r.raw?.message ?? null}); writeJson(f, ledger);
    console.log(JSON.stringify(ledger, null, 1), ledger.taskId ? '\n→ 请在开发者工具里确认；之后用 `kit task --id ' + ledger.taskId + '` 查询结果' : '');
  },
  async task() { const c = config(); const r = await wechatide(c.clientName || 'Claude', 'polling_task_result', ['--task-id', need('id')]); const x = r.raw?.result || {}; console.log(JSON.stringify(r.ok ? {status: x.status, detail: x.detail, error: x.error, updatedAt: x.updatedAt && new Date(x.updatedAt).toISOString()} : {error: r.raw?.message || String(r.error).slice(0, 200)})); },
  // 云日志（只读），按会话输出中文摘要。--since ISO 时间可过滤旧会话。
  async logs() {
    const c = config(), project = abs(need('project')), label = readLabel(project), appid = projectInfo(project).appid, since = opt('since') || '';
    const tmp = fs.mkdtempSync(path.join(ledgerDir(c), 'ledgers', 'cloud-read-'));
    writeJson(path.join(tmp, 'q.json'), {build: label}); writeJson(path.join(tmp, 'p.json'), {_id: 0, session: 1, receivedAt: 1, device: 1, dropped: 1, entries: 1}); writeJson(path.join(tmp, 's.json'), [{key: 'receivedAt', direction: -1}]);
    const r = await wechatide(c.clientName || 'Claude', 'cloud_db_read_doc', ['--appid', appid, '--env', c.cloud.env, '--collection-name', c.cloud.collection || 'phone_log_batches', '--query-file', path.join(tmp, 'q.json'), '--projection-file', path.join(tmp, 'p.json'), '--sort-file', path.join(tmp, 's.json'), '--limit', '100', '--offset', opt('offset') || '0'], {timeout: 90000});
    const rows = r.raw?.result?.data || []; const sessions = {};
    for (const row of rows) { const s = sessions[row.session] ??= {device: row.device, entries: []}; s.entries.push(...(row.entries || [])); }
    const lines = [`build ${label} rows ${rows.length} sessions ${Object.keys(sessions).length}`];
    for (const [id, s] of Object.entries(sessions)) { const e = s.entries.sort((a, b) => a.seq - b.seq), start = new Date(e[0]?.at).toISOString(); if (start < since) continue; const d = s.device || {};
      lines.push(`== ${id} ${d.platform} ${d.model} ${d.system} start ${start}`); let last = '';
      for (const x of e) { const m = x.message; if (m.includes('WX15_FALLBACK') || m.includes('PHONE_LOG_START')) continue;
        if (m.includes('WX15_TIMING')) lines.push('  ' + m.replace(/^\[WX15_TIMING\]\s*/, '').replace(/\s*\{"kind".*$/, ''));
        else if (m.includes('WX15_RELEASE_CLICK')) { const g = (m.match(/"state":"(\w+)"/) || [])[1]; if (g && g !== last) { lines.push('  点击门 ' + g); last = g; } }
        else lines.push('  [' + x.level + '] ' + m.slice(0, 240)); } }
    fs.writeFileSync(path.join(tmp, 'DIGEST.txt'), lines.join('\n') + '\n'); console.log(lines.join('\n'));
  },
  // 兜底日志里的函数编号（表槽位）→ 函数名。需要完整 WASM（.plugincache/codesplitv2/backup）和 symbols.json。
  async lookup() { const {lookupSlots} = await import('./lib/lookup.mjs'); const c = config(); for (const l of lookupSlots(fromCfg(c, c.workProject), fromCfg(c, c.symbols), argv.slice(1).filter(x => /^\d+$/.test(x)).map(Number))) console.log(l); },
  async info() { console.log(JSON.stringify(projectInfo(abs(need('project'))), null, 1)); },
};
function readLabel(project) { const m = fs.readFileSync(path.join(project, 'phone-log-config.js'), 'utf8').match(/"build":\s*"([^"]+)"/); check(m, 'NO_BUILD_LABEL'); return m[1]; }

try { check(commands[cmd], '用法：node kit.mjs <assemble|collect-pack|split|verify|ide|upload|task|logs|lookup|info> ...（见 README.md）'); await commands[cmd](); }
catch (e) { console.error('ERROR', e.code || e.message); process.exitCode = 1; }
