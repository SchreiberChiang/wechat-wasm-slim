// Generated-source declarations only: no compiler, preprocessor or engine execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Extracted read-only from the actual successful full build on 2026-11-04.
// Source: F:/GLX-OpenSource/clean-20261104/build/engine/modules/{modules_enabled.gen.h,register_module_types.gen.cpp}.
export const FULL_MODULES = Object.freeze(`astcenc basis_universal bcdec bmp csg dds enet etcpak fbx freetype gdscript gltf godot_physics_2d godot_physics_3d gridmap hdr interactive_music jolt_physics jpg jsonrpc ktx mbedtls meshoptimizer mobile_vr mp3 msdfgen multiplayer navigation_2d navigation_3d noise ogg regex svg text_server_adv tga theora tinyexr upnp vhacd visual_shader vorbis webp webrtc websocket webxr zip`.split(' ').sort());
export const CONSERVATIVE_REMOVED_MODULES = Object.freeze(['gltf','fbx','vhacd','webxr','mobile_vr','enet','upnp'].sort());
// The generator emits guarded calls/includes for disabled modules too. These are
// declarations of available source modules, not evidence they were enabled.
export const REGISTRATION_MODULES = Object.freeze(`astcenc basis_universal bcdec betsy bmp camera csg cvtt dds enet etcpak fbx freetype gdscript glslang gltf godot_physics_2d godot_physics_3d gridmap hdr interactive_music jolt_physics jpg jsonrpc ktx lightmapper_rd mbedtls meshoptimizer mobile_vr mono mp3 msdfgen multiplayer navigation_2d navigation_3d noise objectdb_profiler ogg openxr raycast regex svg text_server_adv text_server_fb tga theora tinyexr upnp vhacd visual_shader vorbis webp webrtc websocket webxr xatlas_unwrap zip`.split(' ').sort());
export const MODULE_BASELINE = Object.freeze({
  sourceCommit:'df3cdd9bc9941a20cb5575d781cde6f937637bcb',
  enabledHeader:{bytes:3734,sha256:'499f8bbf4b8b02d7d3f4c7c5fc397903f3a6ea7179a96c7073af6dc198ef4f14'},
  registration:{bytes:13750,sha256:'786a6423cf256fbe9093c9330c0fc70398f27455893a25c8a3eab292230e2c13'},
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({bytes:bytes.length,sha256:sha(bytes)});
function input(value) {
  assert(typeof value==='string' || Buffer.isBuffer(value),'module evidence must be text or Buffer');
  const raw=Buffer.isBuffer(value)?value:Buffer.from(value),text=raw.toString('utf8');
  assert(Buffer.from(text).equals(raw),'module evidence must be valid UTF-8');
  const normalized=text.replaceAll('\r\n','\n');
  return {text:normalized,evidence:{raw:identity(raw),lf:identity(Buffer.from(normalized))}};
}
const uncomment = text => text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
function unique(names,label) {
  assert.equal(new Set(names).size,names.length,'duplicate '+label);
  return names.sort();
}
function parseHeader(text) {
  let source=uncomment(text);
  assert.equal((source.match(/^\s*#pragma once\s*$/gm)||[]).length,1,'one generated header pragma required');
  source=source.replace(/^\s*#pragma once\s*$/gm,'');
  const modules=[];
  source=source.replace(/^\s*#define MODULE_([A-Z0-9_]+)_ENABLED[ \t]*$/gm,(_,name)=>{modules.push(name.toLowerCase());return '';});
  assert.equal(source.trim(),'','unexpected generated header expression');
  return unique(modules,'enabled module declaration');
}
function parseRegistration(text) {
  let source=uncomment(text);
  for(const header of ['register_module_types.h','modules/modules_enabled.gen.h']) {
    const token=`#include "${header}"`;
    assert.equal(source.split(token).length-1,1,'unique registration support include required');source=source.replace(token,'');
  }
  const included=[];
  source=source.replace(/^\s*#include "modules\/([a-z0-9_]+)\/register_types\.h"[ \t]*$/gm,(_,name)=>{included.push(name);return '';});
  unique(included,'module include');
  const functions={};
  source=source.replace(/void (initialize|uninitialize)_modules\(ModuleInitializationLevel p_level\)\s*\{([^{}]*)\}/g,(_,kind,body)=>{
    assert(!functions[kind],'duplicate generated registration function');
    const names=[];
    const remainder=body.replace(/#ifdef MODULE_([A-Z0-9_]+)_ENABLED\s+(initialize|uninitialize)_([a-z0-9_]+)_module\(p_level\);\s*#endif/g,(_block,guard,callKind,name)=>{
      assert.equal(callKind,kind,'registration call in wrong lifecycle function');
      assert.equal(guard.toLowerCase(),name,'module guard/call mismatch');names.push(name);return '';
    });
    assert.equal(remainder.trim(),'','unguarded, conditional or unexpected registration code');
    functions[kind]=unique(names,kind+' module call');return '';
  });
  assert.equal(source.trim(),'','unexpected registration source');
  assert(functions.initialize && functions.uninitialize,'both generated lifecycle functions required');
  assert.deepEqual(functions.initialize,included,'module includes and initialization differ');
  assert.deepEqual(functions.uninitialize,included,'initialization/uninitialization differ');
  assert.deepEqual(included,REGISTRATION_MODULES,'fixed source registration module universe differs');
  return {declaredModules:included,initialize:functions.initialize,uninitialize:functions.uninitialize};
}

export function auditModuleBuffers({enabledHeader,registration,profile='full'}) {
  assert(['full','conservative'].includes(profile),'explicit fixed full/conservative profile required');
  const h=input(enabledHeader),r=input(registration),enabledModules=parseHeader(h.text),parsed=parseRegistration(r.text);
  const expectedModules=FULL_MODULES.filter(name=>profile==='full'||!CONSERVATIVE_REMOVED_MODULES.includes(name));
  const removedFromFull=FULL_MODULES.filter(name=>!enabledModules.includes(name)),addedToFull=enabledModules.filter(name=>!FULL_MODULES.includes(name));
  assert.deepEqual(enabledModules,expectedModules,'enabled module set differs: missing required, extra deletion or addition');
  const activeInitializeModules=parsed.initialize.filter(name=>enabledModules.includes(name));
  const activeUninitializeModules=parsed.uninitialize.filter(name=>enabledModules.includes(name));
  assert.deepEqual(activeInitializeModules,enabledModules,'enabled header and active initialization differ');
  assert.deepEqual(activeUninitializeModules,enabledModules,'enabled header and active uninitialization differ');
  return {schema:'wxslim-fixed-generated-modules-v1',status:'PASS_GENERATED_MODULES_ONLY',profile,
    fullModules:[...FULL_MODULES],enabledModules,expectedModules,removedFromFull,addedToFull,
    requiredRetainedModules:FULL_MODULES.filter(name=>!CONSERVATIVE_REMOVED_MODULES.includes(name)),
    registration:{declaredModules:parsed.declaredModules,activeInitializeModules,activeUninitializeModules},
    evidence:{enabledHeader:h.evidence,registration:r.evidence},baseline:MODULE_BASELINE,
    limitations:['Exact generated module declarations and guarded registration only; no compilation, linking or runtime acceptance.',
      'Disabled modules may still have includes and guarded calls; only header-enabled guards count as active.',
      'Does not audit every ignored/generated file, prove compiled object membership or replace source/BUILD/pair audits.',
      'Conservative is an expected 7-module reduction contract, not evidence that a conservative build has run.']};
}

export function auditFixedModules({source,profile='full'}) {
  assert(source && path.isAbsolute(source),'absolute source directory required');
  const read=name=>{
    const file=path.join(source,'modules',name),stat=fs.lstatSync(file);
    assert(stat.isFile()&&!stat.isSymbolicLink(),'regular generated module file required');return fs.readFileSync(file);
  };
  return auditModuleBuffers({enabledHeader:read('modules_enabled.gen.h'),registration:read('register_module_types.gen.cpp'),profile});
}
