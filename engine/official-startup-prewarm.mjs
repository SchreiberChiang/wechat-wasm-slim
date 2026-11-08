// Pure pinned source preparation; no filesystem, platform, factory or WASM calls.
// Lets a project skip the one default 3D scene shader compile that the GLES3 scene
// renderer does at startup. The project setting defaults to false, so every game
// that does not set it starts exactly as before (the bind runs). Only this one call
// is guarded: the shader version is still created and compiles on first 3D use.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const STARTUP_PREWARM_FILE = 'drivers/gles3/rasterizer_scene_gles3.cpp';
export const STARTUP_PREWARM_SETTING = 'startup/gles3/skip_default_3d_prewarm';
export const STARTUP_PREWARM_INPUT = Object.freeze({bytes: 212186, sha256: '6d0719c9cd2caf685a9825028183bdf058081d7bc92d4b27ed2587f39b081221'});
export const startupPrewarmPin = b => ({bytes: Buffer.byteLength(b), sha256: createHash('sha256').update(b).digest('hex')});
const ANCHOR = '\t\tmaterial_storage->shaders.scene_shader.version_bind_shader(scene_globals.shader_default_version, SceneShaderGLES3::MODE_COLOR);\n';
const GUARDED = '\t\t// wxslim: a project may skip this default 3D shader compile at startup (' + STARTUP_PREWARM_SETTING + ', default false).\n' +
  '\t\tif (!bool(GLOBAL_DEF("' + STARTUP_PREWARM_SETTING + '", false))) {\n' +
  '\t' + ANCHOR +
  '\t\t}\n';

export function prepareOfficialStartupPrewarm(source) {
  assert(Buffer.isBuffer(source), 'PREWARM_BUFFER');
  assert.deepEqual(startupPrewarmPin(source), STARTUP_PREWARM_INPUT, 'PREWARM_FIXED_SOURCE');
  const text = source.toString('utf8');
  assert(Buffer.from(text).equals(source), 'PREWARM_UTF8');
  assert.equal(text.split(ANCHOR).length, 2, 'PREWARM_UNIQUE_ANCHOR');
  assert(text.includes('#include "core/config/project_settings.h"'), 'PREWARM_PROJECT_SETTINGS_INCLUDE');
  const output = Buffer.from(text.replace(ANCHOR, () => GUARDED));
  return {source: output, receipt: {schema: 'wxslim-official-startup-prewarm-v1', status: 'SOURCE_ONLY_NOT_APPLIED',
    input: startupPrewarmPin(source), output: startupPrewarmPin(output), setting: STARTUP_PREWARM_SETTING, defaultValue: false,
    guardedCalls: 1, behaviourWhenUnset: 'UNCHANGED_BIND_RUNS', build: 'NOT_RUN', runtime: 'NOT_RUN'}};
}
