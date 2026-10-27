import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEngine,inspectScene} from './audit.mjs';
const cpp='material_storage->shaders.scene_shader.version_bind_shader(scene_globals.shader_default_version, SceneShaderGLES3::MODE_COLOR);';
const build={identity:{cppdefines:'',patches:[{sha256:'84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6'}]}};
test('unsupported setting and changed build cannot silently retain baseline conclusion',()=>{
  assert.equal(inspectEngine(cpp,'',build).projectSettingSupported,false);
  assert.throws(()=>inspectEngine(cpp+' skip_default_3d_prewarm','',build));
  assert.throws(()=>inspectEngine(cpp,'',{identity:{...build.identity,cppdefines:'WX_LAB_RUNTIME_PREWARM_POLICY'}}));
});
test('startup case and explicit prewarm calls require review',()=>{
  const files=new Map([['main.gd',Buffer.from('select_step(0)')],['project.godot',Buffer.from('config_version=5')],['cases.json',Buffer.from(JSON.stringify({cards:[{steps:[{id:'B01-image'}]}]}))]]);
  assert.equal(inspectScene(files).startupStep,'B01-image');
  files.set('extra.gd',Buffer.from('WxLabStartupControl.prewarm_default_3d_shader()'));
  assert.throws(()=>inspectScene(files));
});
