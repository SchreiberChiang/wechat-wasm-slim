import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setPckBoolSetting, readPckBoolSetting, readProjectBinary, writeProjectBinary, boolVariant, SKIP_PREWARM_SETTING} from '../lib/pck-project-setting.mjs';
import {inspectPck} from '../lib/pck-inventory.mjs';

// A small canonical PCK (format 4, Godot 4.7.2) with a binary project config and one scene.
function pck(files) {
  const entries = Object.entries(files).map(([path, payload]) => ({path, name: Buffer.from(path), payload: Buffer.from(payload)}));
  let cursor = 128;
  for (const e of entries) { e.offset = cursor; cursor = Math.ceil((cursor + e.payload.length) / 32) * 32; }
  const dir = cursor, size = dir + 4 + entries.reduce((s, e) => s + 4 + Math.ceil(e.name.length / 4) * 4 + 36, 0);
  const out = Buffer.alloc(size);
  out.write('GDPC'); out.writeUInt32LE(4, 4); out.writeUInt32LE(4, 8); out.writeUInt32LE(7, 12); out.writeUInt32LE(2, 16); out.writeUInt32LE(2, 20);
  out.writeBigUInt64LE(128n, 24); out.writeBigUInt64LE(BigInt(dir), 32); out.writeUInt32LE(entries.length, dir);
  let d = dir + 4;
  for (const e of entries) {
    e.payload.copy(out, e.offset);
    const padded = Math.ceil(e.name.length / 4) * 4;
    out.writeUInt32LE(padded, d); d += 4; e.name.copy(out, d); d += padded;
    out.writeBigUInt64LE(BigInt(e.offset - 128), d); out.writeBigUInt64LE(BigInt(e.payload.length), d + 8);
    createHash('md5').update(e.payload).digest().copy(out, d + 16); d += 36;
  }
  return out;
}
const project = writeProjectBinary([{name: 'application/config/name', value: Buffer.from([4, 0, 0, 0, 1, 0, 0, 0, 0x41, 0, 0, 0])}]);

test('skip prewarm: the setting is added to project.binary and every other file keeps its bytes', () => {
  const source = pck({'project.binary': project, 'main.scn': 'RSRC scene bytes'});
  assert.equal(readPckBoolSetting(source, SKIP_PREWARM_SETTING), null);
  const {pck: out, changed} = setPckBoolSetting(source, SKIP_PREWARM_SETTING, true);
  assert.equal(changed, true);
  assert.equal(readPckBoolSetting(out, SKIP_PREWARM_SETTING), true);
  const before = inspectPck(source), after = inspectPck(out);
  assert.deepEqual(after.entries.map(e => e.path), before.entries.map(e => e.path));
  assert.equal(after.entries[1].sha256, before.entries[1].sha256);
  const rows = readProjectBinary(out.subarray(after.entries[0].offset, after.entries[0].offset + after.entries[0].bytes));
  assert.deepEqual(rows.map(r => r.name), ['application/config/name', SKIP_PREWARM_SETTING]);
  assert.ok(rows[1].value.equals(boolVariant(true)));
  assert.equal(setPckBoolSetting(out, SKIP_PREWARM_SETTING, true).changed, false);
  assert.equal(readPckBoolSetting(setPckBoolSetting(out, SKIP_PREWARM_SETTING, false).pck, SKIP_PREWARM_SETTING), false);
});

test('skip prewarm: a PCK without project.binary is refused', () => {
  assert.throws(() => setPckBoolSetting(pck({'main.scn': 'x'}), SKIP_PREWARM_SETTING, true), e => e.code === 'PCK_SETTING_NO_PROJECT');
});
