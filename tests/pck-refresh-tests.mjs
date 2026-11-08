import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {refreshMinigamePck} from '../lib/pck-refresh.mjs';
import {quickRefresh} from '../lib/quick-flow.mjs';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });
const sha = b => createHash('sha256').update(b).digest('hex');
const NOTICE = Buffer.from('wechat-wasm-slim convert: this data package carries the Godot PCK (last file). No network assets.\n');

// A converted mini game laid out the way conversion-core.mjs writes it.
function minigame(pck) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-refresh-'));
  temporary.push(root);
  const f = rel => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), {recursive: true}); return p; };
  const data = Buffer.concat([NOTICE, pck]), id = createHash('md5').update(data).digest('hex').slice(0, 16);
  fs.writeFileSync(f(`data-package/${id}.data.bin`), zlib.brotliCompressSync(data));
  const kit = {launch: {data: {fileMD5: id, fileSize: data.length, optFileSize: data.length, isCompressed: true}}, other: 1};
  fs.writeFileSync(f('wx-game-kit/config.json'), JSON.stringify(kit));
  fs.writeFileSync(f('wx-game-kit/config.devtools.json'), JSON.stringify(kit));
  const files = [{filename: '/WXSLIM-NOTICE.txt', start: 0, end: NOTICE.length}, {filename: '/full.pck', start: NOTICE.length, end: data.length}];
  fs.writeFileSync(f('godot-data/package-info.js'), 'GameGlobal.__WXSLIM_PACKAGE_META__=' + JSON.stringify({remotePackageName: 'g.data', size: data.length, pck: files[1], pckBytes: pck.length, pckSha256: sha(pck), files, dataSha256: sha(data)}) + ';\n');
  fs.writeFileSync(f('godot-data/package.metadata.json'), JSON.stringify({files, remote_package_size: data.length}));
  const render = {packageVersion: 'wxslim-aaaaaaaaaaaaaaaaaaaa', pckSha256: sha(pck), wasmSha256: 'w', runtimeOptions: {engineContract: {projectUsageSha256: 'old'}}};
  fs.writeFileSync(f('godot-data/render-config.json'), JSON.stringify(render));
  fs.writeFileSync(f('godot-data/render-config.js'), 'GameGlobal.__WXSLIM_RENDER_CONFIG__=' + JSON.stringify(render) + ';\nGameGlobal.__WXSLIM_RENDER_CONFIG__.requestedMode=x;\n');
  fs.writeFileSync(f('framework.js'), 'engine');
  return root;
}

test('refresh: a new PCK replaces the data package and every record of its size and hash; the engine stays', () => {
  const root = minigame(Buffer.from('GDPC old game'));
  const next = Buffer.from('GDPC new game, longer than before');
  const result = refreshMinigamePck(root, next, {projectUsageSha256: 'new'});
  assert.equal(result.changed, true);
  assert.equal(result.previousPackageId, 'wxslim-aaaaaaaaaaaaaaaaaaaa');
  const read = rel => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
  const datas = fs.readdirSync(path.join(root, 'data-package'));
  assert.equal(datas.length, 1);
  for (const rel of ['wx-game-kit/config.json', 'wx-game-kit/config.devtools.json']) {
    const kit = JSON.parse(read(rel));
    assert.equal(`${kit.launch.data.fileMD5}.data.bin`, datas[0]);
    assert.equal(kit.other, 1);
  }
  const data = zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'data-package', datas[0])));
  assert.ok(data.equals(Buffer.concat([NOTICE, next])));
  const meta = JSON.parse(read('godot-data/package-info.js').replace(/^[^=]*=/, '').replace(/;\n$/, ''));
  assert.deepEqual([meta.pckSha256, meta.pckBytes, meta.pck.end, meta.remotePackageName], [sha(next), next.length, data.length, 'g.data']);
  const render = JSON.parse(read('godot-data/render-config.json'));
  assert.deepEqual([render.pckSha256, render.refreshedFrom, render.runtimeOptions.engineContract.projectUsageSha256], [sha(next), 'wxslim-aaaaaaaaaaaaaaaaaaaa', 'new']);
  assert.notEqual(render.packageVersion, 'wxslim-aaaaaaaaaaaaaaaaaaaa');
  assert.match(read('godot-data/render-config.js'), new RegExp(render.packageVersion + '.*;\\nGameGlobal\\.__WXSLIM_RENDER_CONFIG__\\.requestedMode=x;\\n$', 's'));
  assert.equal(read('framework.js'), 'engine');
  assert.equal(refreshMinigamePck(root, next).changed, false);
});

test('refresh: a folder that is not a converted mini game is refused in plain words', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-refresh-'));
  temporary.push(root);
  assert.throws(() => refreshMinigamePck(root, Buffer.from('x')), e => e.code === 'PCK_REFRESH_LAYOUT' && /完整导出/.test(e.message));
});

test('refresh: without a finished run nothing is exported and the button explains why', async () => {
  const service = {plan: async () => { throw Error('must not plan'); }};
  const result = await quickRefresh({project: os.tmpdir(), run: path.join(os.tmpdir(), 'no-such-run')}, {service});
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blockers[0].code, 'QUICK_REFRESH_RUN');
});
