import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PARENTS,CHANGED_PATHS,readTree,verifyParent,validateScene,derive,verifyDerived,hash,stage,json} from './stage.mjs';

// Fixed original trees are read as evidence fixtures; tests never write to them.
const fixturesAvailable=Object.values(PARENTS).every(p=>fs.existsSync(p.dir));
const integration=(name,fn)=>test(name,{skip:fixturesAvailable?false:'Exact private frozen parents are not distributed; set up the documented evidence fixtures first'},fn);
const parents={};if(fixturesAvailable)for(const mode of ['glx','webgl'])parents[mode]=readTree(PARENTS[mode].dir);
const pck=Buffer.alloc(128);pck.write('GDPC');pck.writeUInt32LE(4,4);pck.write('functional-content-fixture',112,16);
const sources=new Map([['project.godot',Buffer.from('config_version=5\n')],['export_presets.cfg',Buffer.from('[preset.0]\nname="Web"\n')],['main.gd',Buffer.from('extends Node\n')]]);
const scene=validateScene(pck,sources),stagerHash=hash(Buffer.from('test stager'));
const results={};if(fixturesAvailable)for(const mode of ['glx','webgl'])results[mode]=derive(parents[mode],mode,pck,scene,stagerHash);

integration('both exact parent trees and decompressed WASM pass pinned integrity checks',()=>{
  for(const mode of ['glx','webgl'])assert.equal(verifyParent(parents[mode],mode).identity.packageId,PARENTS[mode].packageId);
});
integration('content derivation changes exactly six paths and keeps identical PCKs',()=>{
  for(const mode of ['glx','webgl']){
    const {files,record}=results[mode];verifyDerived(files,parents[mode],record);
    assert.deepEqual([...files].filter(([name,b])=>!b.equals(parents[mode].get(name))).map(([n])=>n).sort(),CHANGED_PATHS);
    assert.equal(record.identity.parentManifestSha256,PARENTS[mode].manifestSha256);
    assert.equal(record.identity.scenePckSha256,hash(pck));assert.equal(record.identity.sceneSourceManifestSha256,scene.sceneSourceManifestSha256);
    assert.match(record.identity.packageId,new RegExp('^ios-functional-'+mode+'-[a-f0-9]{20}$'));
    assert.equal(record.engineIntegrity.brotliDecodedHashVerified,true);
    assert.equal(record.state.phone,'not_run');assert.equal(record.state.cloudRelay,'disabled');
    assert.equal(record.state.runtime,'not_run');assert.ok(!('staticSpecifiedHostPass' in record.identity));
    assert.ok(files.get('candidate-mode.js').toString().includes('const mode = "'+mode+'";'));
  }
  assert.ok(results.glx.files.get('engine/empty-tips.bin').equals(results.webgl.files.get('engine/empty-tips.bin')));
  assert.ok(results.glx.files.get('engine/godot.js').equals(results.webgl.files.get('engine/godot.js')));
});
integration('different content produces different identity without changing engine',()=>{
  const other=Buffer.from(pck);other[120]^=1;
  const next=derive(parents.glx,'glx',other,validateScene(other,sources),stagerHash);
  assert.notEqual(next.record.identity.packageId,results.glx.record.identity.packageId);
  assert.ok(next.files.get('engine/godot.js').equals(results.glx.files.get('engine/godot.js')));
});
integration('dirty original bytes, forged parent manifest, missing and extra paths are refused',()=>{
  for(const mutate of [m=>m.set('godot-loader.js',Buffer.from('changed')),m=>m.set('CANDIDATE.json',Buffer.from('{}')),m=>m.delete('game.js'),m=>m.set('extra.txt',Buffer.from('extra'))]){
    const files=new Map(parents.glx);mutate(files);assert.throws(()=>verifyParent(files,'glx'),/mismatch/);
  }
});
integration('resealed arbitrary engine bytes cannot bypass original engine gate',()=>{
  const files=new Map(parents.glx),record=JSON.parse(files.get('CANDIDATE.json'));
  files.set('engine/godot.js',Buffer.from('__Offscreen3DProbe'));
  record.fileManifest=record.fileManifest.map(r=>r.path==='engine/godot.js'?{path:r.path,bytes:files.get(r.path).length,sha256:hash(files.get(r.path))}:r);
  files.set('CANDIDATE.json',Buffer.from(json(record)));
  assert.throws(()=>verifyParent(files,'glx',{...PARENTS.glx,manifestSha256:hash(files.get('CANDIDATE.json'))}),/Original engine bytes required/);
});
integration('additional candidate host mutation is refused even if manifest is resealed',()=>{
  const {record}=results.glx,files=new Map(results.glx.files);files.set('game.js',Buffer.from('changed'));
  assert.throws(()=>verifyDerived(files,parents.glx,record),/six-path/);
});
test('pixel probe markers and non-PCK content refused; ordinary SubViewport source allowed',()=>{
  assert.throws(()=>validateScene(Buffer.from('not a pack'),sources),/PCK/);
  const bad=new Map(sources);bad.set('main.gd',Buffer.from('# offscreen-3d-probe'));
  assert.throws(()=>validateScene(pck,bad),/Pixel probe/);
  const okay=new Map(sources);okay.set('main.gd',Buffer.from('extends Node\nvar view: SubViewport\n'));
  assert.equal(validateScene(pck,okay).scenePckSha256,scene.scenePckSha256);
});
test('existing output rejected before any input read or overwrite',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'functional-stage-test-'));
  try {fs.writeFileSync(path.join(temp,'sentinel'),'preserve');assert.throws(()=>stage({scenePck:'does-not-exist.pck',sceneSource:'does-not-exist',output:temp}),/Output already exists/);assert.equal(fs.readFileSync(path.join(temp,'sentinel'),'utf8'),'preserve');}
  finally {fs.rmSync(temp,{recursive:true});}
});
