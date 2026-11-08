import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {packageSizeReport, MB} from '../lib/package-size.mjs';

const temporary = [];
test.after(() => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });

function minigame(files, game, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-size-'));
  temporary.push(root);
  for (const [rel, size] of Object.entries(files)) {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, Buffer.alloc(size));
  }
  fs.writeFileSync(path.join(root, 'game.json'), JSON.stringify(game));
  fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify(config));
  return root;
}

test('package size: files are counted in the subpackage whose root holds them, the rest is the main package', () => {
  const root = minigame({'game.js': 1000, 'wasmcode/godot.wasm.br': 8 * MB, 'data-package/a.data.bin': 2000,
    'scenepacks/level1/content.bin': 3000, 'scenepacks/level10/content.bin': 500, '.plugincache/x': 9 * MB, 'a.symbols.unityweb': 7 * MB},
  {subpackages: [{name: 'wasmcode', root: 'wasmcode/'}, {name: 'data-package', root: 'data-package/'}, {name: 'level1', root: 'scenepacks/level1/'}]},
  {packOptions: {ignore: [{value: '.plugincache', type: 'folder'}, {value: '.symbols.unityweb', type: 'suffix'}]}});
  const report = packageSizeReport(root);
  const bytes = Object.fromEntries(report.parts.map(p => [p.name, p.bytes]));
  const extra = fs.statSync(path.join(root, 'game.json')).size + fs.statSync(path.join(root, 'project.config.json')).size;
  // scenepacks/level10 is not under scenepacks/level1/: it stays in the main package.
  assert.deepEqual(bytes, {'主包': 1000 + 500 + extra, wasmcode: 8 * MB, 'data-package': 2000, level1: 3000});
  assert.equal(report.ignoredBytes, 16 * MB);
  assert.equal(report.ok, true);
  assert.match(report.summary, /^包体：主包 0\.00 MB \/ 4 MB · 合计 8\.01 MB \/ 30 MB · 还可加 21\.99 MB$/);
  assert.ok(report.lines.includes('Godot 引擎（wasmcode）：8.00 MB'));
  assert.ok(report.lines.includes('场景分包 level1：0.00 MB'));
});

test('package size: over 4 MB main, over 30 MB total and an oversized independent subpackage are each reported', () => {
  const root = minigame({'big.js': 5 * MB, 'wasmcode/e': 20 * MB, 'solo/x': 6 * MB},
    {subpackages: [{name: 'wasmcode', root: 'wasmcode'}, {name: 'solo', root: 'solo/', independent: true}]});
  const report = packageSizeReport(root);
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems.map(p => p.code), ['PACKAGE_MAIN_TOO_LARGE', 'PACKAGE_TOTAL_TOO_LARGE', 'PACKAGE_INDEPENDENT_TOO_LARGE']);
  assert.match(report.problems[1].message, /合计 31\.00 MB，超过微信限制 30 MB/);
  assert.match(report.summary, /· 超限$/);
});

test('package size: a folder without game.json is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-size-'));
  temporary.push(root);
  assert.throws(() => packageSizeReport(root), e => e.code === 'PACKAGE_SIZE_LAYOUT');
});
