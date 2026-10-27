import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {enableSkipSetting,prepareScene,projectProperties} from './scene.mjs';
test('adds one explicit startup property and refuses ambiguous existing policy',()=>{
  const source='config_version=5\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n';
  assert.equal(enableSkipSetting(source),source+'\n[startup]\ngles3/skip_default_3d_prewarm=true\n');
  assert.throws(()=>enableSkipSetting(enableSkipSetting(source)),/existing/);assert.throws(()=>enableSkipSetting('[startup]\na=1\n[rendering]\n'),/section/);
});
test('scene copy preserves all other source bytes and refuses overwriting',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prewarm-scene-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const src=path.join(root,'source'),out=path.join(root,'copy');fs.mkdirSync(src);fs.writeFileSync(path.join(src,'project.godot'),'[rendering]\nx=1\n');fs.writeFileSync(path.join(src,'main.gd'),'extends Node\n');const r=prepareScene({source:src,target:out});assert.deepEqual(r.changes,['project.godot']);assert.equal(fs.readFileSync(path.join(src,'main.gd'),'utf8'),fs.readFileSync(path.join(out,'main.gd'),'utf8'));assert.throws(()=>prepareScene({source:src,target:out}),/New scene/);
});
test('binary config parser retains exact raw property variants',()=>{
  const key=Buffer.from('startup/gles3/skip_default_3d_prewarm'),buf=Buffer.alloc(4+4+4+key.length+4+8);buf.write('ECFG');let p=4;buf.writeUInt32LE(1,p);p+=4;buf.writeUInt32LE(key.length,p);p+=4;key.copy(buf,p);p+=key.length;buf.writeUInt32LE(8,p);p+=4;buf.writeUInt32LE(1,p);buf.writeUInt32LE(1,p+4);const props=projectProperties(buf);assert.equal(props.get(key.toString()).toString('hex'),'0100000001000000');assert.throws(()=>projectProperties(Buffer.concat([buf,Buffer.alloc(1)])),/tail/);
});
