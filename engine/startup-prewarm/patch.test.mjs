import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {GUARD,transform} from './patch.mjs';
const main='before\n\tGLOBAL_DEF_RST("application/run/flush_stdout_on_print.debug", true);\nafter';
const initialize='\t\tmaterial_storage->shaders.scene_shader.initialize(global_defines);';
const create='\t\tscene_globals.shader_default_version = material_storage->shaders.scene_shader.version_create();';
const bind='\t\tmaterial_storage->shaders.scene_shader.version_bind_shader(scene_globals.shader_default_version, SceneShaderGLES3::MODE_COLOR);';
test('only default bind is guarded; initialization/version allocation/ordinary draw remain',()=>{
  const draw='version_bind_shader(shader->version, instance_variant, spec_constants);';
  const cpp=[initialize,create,bind,draw].join('\n'),result=transform(main,cpp);
  assert.equal(result['main/main.cpp'],main.replace('true);','true);\n\tGLOBAL_DEF_RST("startup/gles3/skip_default_3d_prewarm", false);'));
  assert.equal(result['drivers/gles3/rasterizer_scene_gles3.cpp'],[initialize,create,GUARD,draw].join('\n'));
  assert.throws(()=>transform(result['main/main.cpp'],cpp));
  assert.throws(()=>transform(main,cpp+'\n'+bind));
});
test('source guard truth table: Web false binds; Web true skips; native always binds',()=>{
  // Source-level control-flow execution only: translate the exact tiny C++ guard to JS.
  // This is not a shader/runtime or compiled-C++ acceptance claim.
  for(const web of [false,true])for(const setting of [false,true]){
    let source=GUARD.replace(/#ifdef WEB_ENABLED\n([\s\S]*?)#else\n([\s\S]*?)#endif/,(_,a,b)=>web?a:b);
    source=source.replace(/const bool /g,'const ').replace('bool(GLOBAL_GET("startup/gles3/skip_default_3d_prewarm"))','setting').replace(bind.trim(),'bind();');
    let count=0;vm.runInNewContext(source,{setting,bind:()=>count++});
    assert.equal(count,web&&setting?0:1);
  }
});
test('distributed patch contains the exact pure transform additions',()=>{
  const patch=fs.readFileSync(new URL('./skip-default-3d-prewarm.patch',import.meta.url),'utf8');
  const added=patch.split('\n').filter(s=>s.startsWith('+')&&!s.startsWith('+++')).map(s=>s.slice(1)).join('\n');
  assert(added.includes(GUARD));
  assert(added.includes('GLOBAL_DEF_RST("startup/gles3/skip_default_3d_prewarm", false);'));
  assert(!added.includes('scene_shader.initialize('));assert(!added.includes('version_create()'));
});
