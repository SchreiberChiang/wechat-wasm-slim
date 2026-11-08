import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {scanRemovedClasses, describeHits, removedClassTable} from '../lib/pck-feature-scan.mjs';

// Godot 4.7.2 PCK with the given files, laid out the way the exporter writes them.
function makePck(files) {
  const base = 112, blobs = Object.entries(files).map(([name, data]) => [Buffer.from(name), Buffer.isBuffer(data) ? data : Buffer.from(data)]);
  const body = Buffer.concat(blobs.map(([, data]) => data));
  const rows = [];
  let offset = 0;
  for (const [name, data] of blobs) {
    const pad = Math.ceil(name.length / 4) * 4;
    const row = Buffer.alloc(4 + pad + 36);
    row.writeUInt32LE(pad, 0); name.copy(row, 4);
    row.writeBigUInt64LE(BigInt(offset), 4 + pad); row.writeBigUInt64LE(BigInt(data.length), 12 + pad);
    createHash('md5').update(data).digest().copy(row, 20 + pad);
    rows.push(row); offset += data.length;
  }
  const head = Buffer.alloc(base);
  head.write('GDPC'); head.writeUInt32LE(4, 4); [4, 7, 2].forEach((v, i) => head.writeUInt32LE(v, 8 + 4 * i));
  head.writeBigUInt64LE(BigInt(base), 24); head.writeBigUInt64LE(BigInt(base + body.length), 32);
  const count = Buffer.alloc(4); count.writeUInt32LE(rows.length);
  return Buffer.concat([head, body, count, ...rows]);
}

// Binary tokens keep each identifier as a length and UTF-32 characters XOR 0xb6.
const tokens = name => {
  const length = Buffer.alloc(4); length.writeUInt32LE(name.length);
  return Buffer.concat([length, ...[...name].map(ch => { const b = Buffer.alloc(4); b.writeUInt32LE((ch.codePointAt(0) ^ 0xb6b6b6b6) >>> 0); return b; })]);
};
function gdc(identifiers, compressed) {
  const body = Buffer.concat([Buffer.from([1, 0, 0, 0]), ...identifiers.map(tokens), Buffer.from('"GLTFDocument"')]);
  const head = Buffer.alloc(12); head.write('GDSC'); head.writeUInt32LE(101, 4);
  if (!compressed) return Buffer.concat([head, body]);
  head.writeUInt32LE(body.length, 8);
  return Buffer.concat([head, zlib.zstdCompressSync(body)]);
}

test('feature scan: removed classes in scenes and scripts are named with their files; 2D games pass', () => {
  const scene = Buffer.concat([Buffer.from('RSRC\0\0\0\0'), Buffer.from('\x08\0\0\0Camera3D\0\x06\0\0\0Node2D\0', 'latin1')]);
  for (const compressed of [false, true]) {
    const pck = makePck({'project.binary': 'ECFG', '.godot/exported/1/export-ab-main.scn': scene, 'hero.gdc': gdc(['CharacterBody3D', 'Node2D'], compressed), 'icon.ctex': 'Camera3D'});
    const scan = scanRemovedClasses(pck, '2d');
    assert.deepEqual(scan.hits.map(h => [h.class, h.files]), [['Camera3D', ['.godot/exported/1/export-ab-main.scn']],
      ['CharacterBody3D', ['hero.gdc']], ['GLTFDocument', ['hero.gdc']]]);
    assert.match(describeHits(scan), /Camera3D（3D 功能，见 main\.scn）/);
    assert.deepEqual(scanRemovedClasses(pck, 'conservative').hits.map(h => h.class), ['GLTFDocument']);
    assert.equal(scanRemovedClasses(pck, 'full').applies, false);
  }
  const clean = makePck({'project.binary': 'ECFG', 'main.tscn': '[node name="Main" type="Node2D"]\n[node name="Cam" type="Camera2D"]\nvar a = Node3DGizmoLike', 'hero.gd': 'extends CharacterBody2D'});
  assert.deepEqual(scanRemovedClasses(clean, '2d').hits, []);
});

test('feature scan: the class table comes from the pinned Godot source and covers both trimmed templates', () => {
  const twoD = removedClassTable('2d'), conservative = removedClassTable('conservative');
  for (const name of ['Node3D', 'Camera3D', 'MeshInstance3D', 'RigidBody3D', 'CSGBox3D', 'GridMap', 'GLTFDocument']) assert.ok(twoD[name], name);
  for (const name of ['Node2D', 'Camera2D', 'Sprite2D', 'CharacterBody2D', 'AnimationPlayer', 'Timer']) assert.equal(twoD[name], undefined, name);
  for (const name of ['ENetMultiplayerPeer', 'GLTFDocument', 'UPNP', 'WebXRInterface']) assert.ok(conservative[name], name);
  assert.equal(conservative.Node3D, undefined);
});
