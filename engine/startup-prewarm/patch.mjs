// Pure transformation and read-only pinned planning; callers own copying/applying/building.
import fs from 'node:fs';
import path from 'node:path';
import {hash} from '../functional-acceptance/stage.mjs';
const bind='\t\tmaterial_storage->shaders.scene_shader.version_bind_shader(scene_globals.shader_default_version, SceneShaderGLES3::MODE_COLOR);';
export const GUARD=`#ifdef WEB_ENABLED
\t\tconst bool skip_default_3d_prewarm = bool(GLOBAL_GET("startup/gles3/skip_default_3d_prewarm"));
#else
\t\tconst bool skip_default_3d_prewarm = false;
#endif
\t\t// Retain shader initialization and RID lifetime; defer only the default bind.
\t\tif (!skip_default_3d_prewarm) {
\t${bind}
\t\t}`;
const mainAnchor='\tGLOBAL_DEF_RST("application/run/flush_stdout_on_print.debug", true);';
const registration='\tGLOBAL_DEF_RST("startup/gles3/skip_default_3d_prewarm", false);';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Patch anchor absent or ambiguous');return s.replace(a,()=>b);};
export function transform(main,cpp) {
  if(/skip_default_3d_prewarm/.test(main+cpp))throw Error('Already patched or policy drift');
  return {'main/main.cpp':once(main,mainAnchor,mainAnchor+'\n'+registration),'drivers/gles3/rasterizer_scene_gles3.cpp':once(cpp,bind,GUARD)};
}
export function planPatch(engineDir) {
  const main=fs.readFileSync(path.join(engineDir,'main/main.cpp')),cpp=fs.readFileSync(path.join(engineDir,'drivers/gles3/rasterizer_scene_gles3.cpp'));
  if(hash(main)!=='2fa6ef2736aa28e2feced47ca872bce1a95e3e6c56bb6002a96660a008df8992'||hash(cpp)!=='6d0719c9cd2caf685a9825028183bdf058081d7bc92d4b27ed2587f39b081221')throw Error('Exact successful source required');
  return transform(main.toString(),cpp.toString());
}
