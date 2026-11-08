import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {applyRemotePacks, refreshRemotePacks, cdnBaseProblem, cdnDirFor, remotePackPath, REMOTE_CONFIG} from '../lib/remote-packs.mjs';
import {serveCdn, HEALTH_PATH} from '../lib/cdn-serve.mjs';
import {packageSizeReport} from '../lib/package-size.mjs';
import {normalizeQuickSettings, settingsBlockers} from '../lib/quick-flow.mjs';

const require = createRequire(import.meta.url);
const createReader = require('../convert/assets/resource-subpackage-reader.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });
function tmp(prefix) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temporary.push(dir); return dir; }
function pck(fill, size = 64) { const b = Buffer.alloc(size, fill); b.write('GDPC', 0, 'latin1'); return b; }

function minigame(packs) {
  const root = tmp('wxslim-remote-');
  const game = {subpackages: [{name: 'wasmcode', root: 'wasmcode/'}, {name: 'data-package', root: 'data-package/'}]};
  for (const [id, bytes] of Object.entries(packs)) {
    fs.mkdirSync(path.join(root, 'scenepacks', id), {recursive: true});
    fs.writeFileSync(path.join(root, 'scenepacks', id, 'content.bin'), bytes);
    fs.writeFileSync(path.join(root, 'scenepacks', id, 'game.js'), '');
    game.subpackages.push({name: id, root: `scenepacks/${id}/`});
  }
  fs.writeFileSync(path.join(root, 'game.json'), JSON.stringify(game));
  fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify({setting: {urlCheck: true}}));
  return root;
}

test('CDN base: only http(s) addresses ending in / without query, hash or credentials', () => {
  assert.equal(cdnBaseProblem(''), '');
  assert.equal(cdnBaseProblem('https://cdn.example.com/game/'), '');
  assert.equal(cdnBaseProblem('http://192.168.1.5:8686/'), '');
  for (const bad of ['cdn.example.com/', 'ftp://x/', 'https://x/game', 'https://x/?a=1/', 'https://u:p@x/'])
    assert.notEqual(cdnBaseProblem(bad), '', bad);
  const base = {schema: 'wxslim-quick-settings-v1', template: 'full', output: os.tmpdir()};
  const codes = s => settingsBlockers(normalizeQuickSettings({...base, ...s})).map(b => b.code);
  assert.ok(codes({cdnBase: 'https://x/'}).includes('QUICK_CDN_NEEDS_SCENES'));
  assert.ok(codes({cdnBase: 'x'}).includes('QUICK_CDN_BASE'));
  assert.ok(!codes({cdnBase: 'https://x/', subpackages: 'scenes', scenes: ['res://a.tscn']}).some(c => c.startsWith('QUICK_CDN')));
});

test('CDN apply: packs move to OUTPUT/cdn with fingerprinted names, game.json drops them, the package lists them as remote', () => {
  const a = pck(1, 100), b = pck(2, 200);
  const root = minigame({level1: a, level2: b}), cdnDir = path.join(tmp('wxslim-out-'), 'cdn');
  const result = applyRemotePacks({minigame: root, cdnDir, baseUrl: 'http://192.168.1.5:8686/',
    packs: [{id: 'level1', bytes: a.length, sha256: sha(a)}, {id: 'level2', bytes: b.length, sha256: sha(b)}]});
  assert.equal(fs.existsSync(path.join(root, 'scenepacks')), false);
  const game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
  assert.deepEqual(game.subpackages.map(s => s.name), ['wasmcode', 'data-package']);
  assert.ok(game.networkTimeout.downloadFile >= 600000);
  const config = JSON.parse(fs.readFileSync(path.join(root, REMOTE_CONFIG), 'utf8'));
  assert.equal(config.packs.level1.path, remotePackPath('level1', sha(a)));
  assert.ok(fs.readFileSync(path.join(cdnDir, ...config.packs.level2.path.split('/'))).equals(b));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')).setting.urlCheck, false);
  assert.equal(result.files[0].url, 'http://192.168.1.5:8686/' + config.packs.level1.path);
  const size = packageSizeReport(root);
  assert.equal(size.remoteBytes, 300);
  assert.ok(size.lines.some(line => line.includes('CDN 远程分包 2 个')));
  assert.throws(() => applyRemotePacks({minigame: minigame({level1: a}), cdnDir, baseUrl: 'https://x/', packs: [{id: 'level1', bytes: 1, sha256: sha(b)}]}), {code: 'QUICK_CDN_PACK_MISMATCH'});
  assert.equal(cdnDirFor(path.join('C:', 'out', 'run-1')), path.join('C:', 'out', 'cdn'));
});

test('CDN refresh: a changed pack gets a new file, unchanged ones stay, the config follows a new address', () => {
  const a = pck(1), b = pck(2), b2 = pck(3);
  const root = minigame({level1: a, level2: b}), cdnDir = path.join(tmp('wxslim-out-'), 'cdn');
  applyRemotePacks({minigame: root, cdnDir, baseUrl: 'https://cdn.example.com/g/', packs: [{id: 'level1', bytes: 64, sha256: sha(a)}, {id: 'level2', bytes: 64, sha256: sha(b)}]});
  const same = refreshRemotePacks({minigame: root, cdnDir, baseUrl: 'https://cdn.example.com/g/', packs: [{id: 'level1', buffer: a}, {id: 'level2', buffer: b}]});
  assert.deepEqual(same.changedPacks, []); assert.equal(same.configChanged, false);
  const next = refreshRemotePacks({minigame: root, cdnDir, baseUrl: 'https://cdn2.example.com/g/', packs: [{id: 'level1', buffer: a}, {id: 'level2', buffer: b2}]});
  assert.deepEqual(next.changedPacks, ['level2']); assert.equal(next.configChanged, true);
  assert.ok(fs.existsSync(path.join(cdnDir, ...remotePackPath('level2', sha(b)).split('/'))), 'old version kept for players still on it');
  assert.ok(fs.existsSync(path.join(cdnDir, ...remotePackPath('level2', sha(b2)).split('/'))));
});

test('CDN server: serves files under cdn only, answers the health check, refuses everything else', async () => {
  const root = path.join(tmp('wxslim-serve-'), 'cdn');
  fs.mkdirSync(path.join(root, 'scenepacks'), {recursive: true});
  fs.writeFileSync(path.join(root, 'scenepacks', 'a.bin'), Buffer.from('hello'));
  fs.writeFileSync(path.join(path.dirname(root), 'secret.txt'), 'no');
  const started = await serveCdn({root, port: 0, host: '127.0.0.1'});
  const port = started.server.address().port, url = p => `http://127.0.0.1:${port}${p}`;
  try {
    assert.equal(await (await fetch(url('/scenepacks/a.bin'))).text(), 'hello');
    assert.equal(await (await fetch(url(HEALTH_PATH))).text(), 'wxslim-cdn');
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/scenepacks/missing.bin', '/scenepacks/'])
      assert.equal((await fetch(url(p))).status, 404, p);
    assert.equal((await fetch(url('/scenepacks/a.bin'), {method: 'POST'})).status, 405);
  } finally { await new Promise(resolve => started.server.close(resolve)); }
});

// 假的 wx：记录调用，downloadFile 把给定内容写进内存文件系统。
function fakeWx({files = {}, remote = null, download = null}) {
  const store = new Map(Object.entries(files)), calls = [];
  if (remote) store.set('wxslim-remote.json', JSON.stringify(remote));
  const fsApi = {
    readFileSync(p) { if (!store.has(p)) throw Error('no such file ' + p); return store.get(p); },
    readFile({filePath, success, fail}) { calls.push('readFile:' + filePath); const v = store.get(filePath); if (!v) return fail({errMsg: 'no such file'}); const u = new Uint8Array(v); success({data: u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)}); },
    statSync(p) { if (!store.has(p)) throw Error('no such file'); return {size: store.get(p).length}; },
    mkdirSync() {}, readdirSync() { return [...store.keys()].filter(k => k.startsWith('/user/wxslim-packs/')).map(k => k.split('/').pop()); },
    unlinkSync(p) { store.delete(p); }, renameSync(a, b) { store.set(b, store.get(a)); store.delete(a); },
  };
  const wx = {env: {USER_DATA_PATH: '/user'}, getFileSystemManager: () => fsApi,
    loadSubpackage({name, success}) { calls.push('loadSubpackage:' + name); success({}); },
    downloadFile({url, filePath, success, fail}) { calls.push('download:' + url); const r = download(url); if (r.fail) return fail({errMsg: r.fail}); if (r.body) store.set(filePath, r.body); success({statusCode: r.status ?? 200}); }};
  return {wx, store, calls};
}
const manifestFor = (id, bytes) => [{id, root: 'scenepacks/' + id, file: 'scenepacks/' + id + '/content.bin', bytes: bytes.length, sha256: sha(bytes)}];

test('reader: without wxslim-remote.json packs still load as WeChat subpackages', async () => {
  const body = pck(7);
  const {wx, calls} = fakeWx({files: {'scenepacks/level1/content.bin': body}});
  const result = await createReader({wx, manifest: manifestFor('level1', body)}).read('level1');
  assert.deepEqual(calls, ['loadSubpackage:level1', 'readFile:scenepacks/level1/content.bin']);
  assert.ok(Buffer.from(result.bytes).equals(body));
});

test('reader: remote packs download once into the user directory, then read from cache; bad answers are not cached', async () => {
  const body = pck(9), old = '/user/wxslim-packs/' + 'f'.repeat(64) + '.bin';
  const remote = {schema: 'wxslim-remote-packs-v1', baseUrl: 'https://cdn.example.com/g/', packs: {level1: {path: 'scenepacks/level1.x.bin', bytes: body.length, sha256: sha(body)}}};
  const {wx, store, calls} = fakeWx({remote, files: {[old]: Buffer.alloc(3)}, download: () => ({body})});
  const reader = createReader({wx, manifest: manifestFor('level1', body)});
  const first = await reader.read('level1');
  assert.ok(Buffer.from(first.bytes).equals(body));
  assert.equal(store.has(old), false, 'stale cache from another version removed');
  await reader.read('level1');
  assert.deepEqual(calls.filter(c => c.startsWith('download')), ['download:https://cdn.example.com/g/scenepacks/level1.x.bin']);
  assert.ok(!calls.some(c => c.startsWith('loadSubpackage')));

  const errors = console.error; console.error = () => {};
  try {
    for (const [answer, code] of [[{status: 404}, 'RESOURCE_READER_REMOTE_HTTP'], [{body: Buffer.alloc(3)}, 'RESOURCE_READER_REMOTE_SIZE'],
      [{fail: 'downloadFile:fail url not in domain list'}, 'RESOURCE_READER_REMOTE_DOMAIN'], [{fail: 'timeout'}, 'RESOURCE_READER_REMOTE_DOWNLOAD']]) {
      const f = fakeWx({remote, download: () => answer});
      await assert.rejects(createReader({wx: f.wx, manifest: manifestFor('level1', body)}).read('level1'), {code});
      assert.ok(![...f.store.keys()].some(k => k.startsWith('/user/')), 'nothing left in the cache');
    }
    const pinned = fakeWx({remote: {...remote, packs: {level1: {...remote.packs.level1, bytes: 1}}}, download: () => ({body})});
    await assert.rejects(createReader({wx: pinned.wx, manifest: manifestFor('level1', body)}).read('level1'), {code: 'RESOURCE_READER_REMOTE_PIN'});
  } finally { console.error = errors; }
});
