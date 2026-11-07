import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {loadBundledFingerprint} from '../convert/lib/bundled-pair.mjs';
import {readPreparedSource} from '../convert/lib/official-custom-context.mjs';

const root = fileURLToPath(new URL('../offline/vendor/engines/', import.meta.url));
test('registered fingerprints reject modified descriptors and another registered profile', t => {
  const file = path.join(root, 'conservative', 'fingerprint.json');
  assert.throws(() => loadBundledFingerprint(file, 'pure-2d'), /BUNDLED_FINGERPRINT_MISMATCH/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-pin-'));
  t.after(() => fs.rmSync(tmp,{recursive:true,force:true}));
  const changed = JSON.parse(fs.readFileSync(file));
  changed.features.disabledModules = [];
  const candidate = path.join(tmp,'fingerprint.json');
  fs.writeFileSync(candidate,JSON.stringify(changed));
  assert.throws(() => loadBundledFingerprint(candidate), /BUNDLED_FINGERPRINT_MISMATCH/);
});

test('registered input recheck rejects a one-byte mutation and a swapped vendor pair', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wxslim-pair-'));
  t.after(() => fs.rmSync(tmp,{recursive:true,force:true}));
  for (const file of ['fingerprint.json','godot.prepared.js','godot.wasm'])
    fs.copyFileSync(path.join(root,'pure-2d',file),path.join(tmp,file));
  const handle = await readPreparedSource(path.join(tmp,'fingerprint.json'));
  const wasm = path.join(tmp,'godot.wasm'), fd = fs.openSync(wasm,'r+');
  try {
    const byte = Buffer.alloc(1);
    assert.equal(fs.readSync(fd,byte,0,1,10),1);
    byte[0] ^= 1;
    assert.equal(fs.writeSync(fd,byte,0,1,10),1);
  } finally { fs.closeSync(fd); }
  assert.throws(handle.recheck,/BUNDLED_ENGINE_MISMATCH godot.wasm/);
  fs.copyFileSync(path.join(root,'conservative','godot.wasm'),wasm);
  await assert.rejects(readPreparedSource(path.join(tmp,'fingerprint.json')), /BUNDLED_ENGINE_MISMATCH|BUNDLED_PAIR_ORDINARY_FILE/);
});
