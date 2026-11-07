import test from 'node:test';
import assert from 'node:assert/strict';
import {planCustomWasm} from '../engine/custom-wasm-plan.mjs';
const base={schema:'wxslim-custom-wasm-plan-v1',dimensions:'2d',disabledModules:['gltf','fbx'],disabledClasses:[]};
test('2D proposal uses real Godot feature keys and reports transitive settings without claiming a build',()=>{
  const p=planCustomWasm(base);
  assert.equal(p.profile.disabled_build_options.disable_3d,true);
  assert.equal(p.profile.disabled_build_options.module_gltf_enabled,false);
  assert.equal(p.buildExecuted,false);assert.equal(p.converterAccepted,false);
  assert.deepEqual(p.impliedByFixedSource,['disable_navigation_3d=true','disable_physics_3d=true','disable_xr=true']);
  assert(p.warnings.some(w=>w.includes('unconditional GLES3')));
  assert.equal(p.sconsArgumentTemplate.filter(a=>a.startsWith('build_profile=')).length,1);
  for(const arg of ['use_wx_glx=yes','threads=no','lto=thin','opengl3=yes','optimize=size'])assert(p.sconsArgumentTemplate.includes(arg));
});
test('custom 3D module/class profile does not silently inherit fixed conservative restrictions',()=>{
  const p=planCustomWasm({...base,dimensions:'3d',disabledModules:['theora'],disabledClasses:['CSGBox3D']});
  assert.equal(p.profile.disabled_build_options.disable_3d,false);
  assert.deepEqual(p.profile.disabled_classes,['CSGBox3D']);
  assert.deepEqual(p.profile.disabled_build_options,{disable_3d:false,module_theora_enabled:false});
  assert.equal(p.status,'PLAN_ONLY_UNBUILT_UNREGISTERED');
});
test('unknown flags, modules and loss of required native/script backend are rejected',()=>{
  for(const extra of [{force:true},{lto:'none'},{library:'replacement'},{skipDefault3dPrewarm:true}])assert.throws(()=>planCustomWasm({...base,...extra}),/CUSTOM_WASM_FIELDS/);
  for(const disabledModules of [['missing_module'],['mbedtls'],['gdscript'],['gltf','gltf']])assert.throws(()=>planCustomWasm({...base,disabledModules}));
  assert.throws(()=>planCustomWasm({...base,disabledClasses:['A\nB']}),/CUSTOM_WASM_NAME/);
});
