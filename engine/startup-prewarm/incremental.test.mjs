import test from 'node:test';import assert from 'node:assert/strict';
import {sconsArgs,dryRunGate,separate} from './incremental.mjs';
test('relocation changes only the profile path and retains compiler budget',()=>{
  const old=['optimize=size','lto=thin','--jobs=4','linkflags=--emit-symbol-map -Wl,--thinlto-jobs=2','build_profile=old'];
  assert.deepEqual(sconsArgs(old,'new'),[...old.slice(0,-1),'build_profile=new']);
  assert.throws(()=>sconsArgs(old.map(x=>x==='optimize=size'?'optimize=none':x),'new'));
});
test('dry-run refuses an unexpected full rebuild or missing targeted objects',()=>{
  const okay='Compiling main/main.cpp ...\nCompiling drivers/gles3/rasterizer_scene_gles3.cpp ...\nLinking Program bin/godot.js ...';
  assert.equal(dryRunGate(okay).fullRebuild,false);
  assert.throws(()=>dryRunGate(okay+'\nCompiling core/object/object.cpp ...'));
  assert.throws(()=>dryRunGate('Linking Program bin/godot.js ...'));
});
test('input/output overlap is rejected in both directions',()=>{
  assert.throws(()=>separate('input','input/output'));assert.throws(()=>separate('input/output','input'));assert.throws(()=>separate('input','input'));assert.doesNotThrow(()=>separate('input','other'));
});
