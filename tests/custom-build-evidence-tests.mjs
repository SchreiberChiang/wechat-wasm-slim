import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditCustomBuildEvidence} from '../engine/custom-build-evidence.mjs';
const suffix='.web.template_release.wasm32.nothreads';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const row=p=>({path:p,bytes:12,sha256:'1'.repeat(64)});
function fixture(dimensions='2d'){
 const features={schema:'wxslim-custom-wasm-plan-v1',dimensions,disabledModules:['upnp'],disabledClasses:[]};
 const env={platform:'web',target:'template_release',arch:'wasm32',threads:false,lto:'thin',optimize:'size',builtin_mbedtls:true,
  module_mbedtls_enabled:true,module_gdscript_enabled:true,use_wx_glx:true,opengl3:true,vulkan:false,wasm_simd:false,
  disable_3d:dimensions==='2d',disable_physics_3d:dimensions==='2d',disable_navigation_3d:dimensions==='2d',disable_xr:dimensions==='2d',
  module_upnp_enabled:false,build_profile:'D:/model/inputs/profile.gdbuild',OBJSUFFIX:suffix+'.o',PROGSUFFIX:suffix,
  CPPDEFINES:'<<non-serializable: deque>>',ENV:{SECRET_MODEL:'must never appear in result'}};
 const objects=['core/object/object','scene/register_scene_types','scene/2d/node_2d','platform/web/os_web','drivers/gles3/rasterizer_gles3',
  'thirdparty/mbedtls/library/aes','thirdparty/mbedtls/library/ctr_drbg',...(dimensions==='3d'?['scene/3d/node_3d']:[])];
 const archives=['scene/libscene','modules/libmodule_gdscript','modules/libmodule_mbedtls'];
 const observed=[...objects.map(p=>row('bin/obj/'+p+suffix+'.o')),...archives.map(p=>row('bin/obj/'+p+suffix+'.a'))];
 function build(changes={}){const environmentBytes=Buffer.from(JSON.stringify(env));return {features,observed:[...observed,{path:'.scons_env.json',...pin(environmentBytes)}],environmentBytes,expectedProfile:env.build_profile,programSuffix:suffix,...changes};}
 return {features,env,observed,build};
}
test('settings and physical membership remain explicitly distinct from commands/macros/link proof',()=>{
 for(const dimension of ['2d','3d']){
  const f=fixture(dimension),r=auditCustomBuildEvidence(f.build());assert.equal(r.status,'PASS_RECORDED_SETTINGS_AND_PHYSICAL_INVENTORY_ONLY');
  assert.equal(r.objectCount,dimension==='2d'?7:8);assert.equal(r.archiveCount,3);assert.equal(r.recordedSettings.disable_3d,dimension==='2d');
  for(const key of ['effectiveCompilerMacros','disabledClassBinaryRemoval','finalLinkedRemoval'])assert.equal(r[key],'NOT_PROVEN');
  assert.equal(r.archiveMembers,'NOT_INSPECTED');assert.equal(r.rawBuildAdmitted,false);assert.equal(r.runtime,'NOT_RUN');
  assert.equal(JSON.stringify(r).includes('must never appear'),false);assert.equal(JSON.stringify(r).includes('D:/model'),false);
 }
});
test('2D rejects any scene/3d object and transitively removed module objects or archives',()=>{
 for(const p of ['scene/3d/node_3d','scene/3d/physics/physics_body_3d','modules/gltf/document','modules/godot_physics_3d/body','modules/upnp/upnp']){
  const f=fixture();f.observed.push(row('bin/obj/'+p+suffix+'.o'));assert.throws(()=>auditCustomBuildEvidence(f.build()),/CUSTOM_BUILD_(3D_SCENE|DISABLED_MODULE)/);
 }
 for(const n of ['gltf','upnp','unknown']){const f=fixture();f.observed.push(row('bin/obj/modules/libmodule_'+n+suffix+'.a'));assert.throws(()=>auditCustomBuildEvidence(f.build()),/CUSTOM_BUILD_DISABLED_OR_UNKNOWN_MODULE_ARCHIVE/);}
 const f=fixture();f.observed.push(row('bin/obj/modules/unknown/x'+suffix+'.o'));assert.throws(()=>auditCustomBuildEvidence(f.build()),/CUSTOM_BUILD_UNKNOWN_MODULE_OBJECT/);
});
test('recorded settings must match dimensions, explicit exclusions and fixed render/toolchain settings',()=>{
 for(const change of [{disable_3d:false},{disable_physics_3d:false},{disable_navigation_3d:false},{disable_xr:false},{module_upnp_enabled:true},
  {threads:true},{lto:'full'},{optimize:'speed'},{use_wx_glx:false},{opengl3:false},{builtin_mbedtls:false},{module_gdscript_enabled:false},{wasm_simd:true},{arch:'wasm64'}]){
  const f=fixture();Object.assign(f.env,change);assert.throws(()=>auditCustomBuildEvidence(f.build()),/CUSTOM_BUILD_RECORDED_SETTING/);
 }
 const f=fixture();delete f.env.disable_3d;assert.throws(()=>auditCustomBuildEvidence(f.build()),/CUSTOM_BUILD_RECORDED_SETTING/);
});
test('environment bytes bind to whole-tree manifest and intended profile, not a separate unchecked report',()=>{
 const f=fixture(),a=f.build();assert.throws(()=>auditCustomBuildEvidence({...a,environmentBytes:Buffer.from('{}')}),/ENV_INVENTORY_BINDING/);
 assert.throws(()=>auditCustomBuildEvidence(f.build({expectedProfile:'D:/wrong.gdbuild'})),/RECORDED_PROFILE/);
 const b=f.build();b.observed.pop();assert.throws(()=>auditCustomBuildEvidence(b),/ENV_INVENTORY_BINDING/);
 for(const key of ['OBJSUFFIX','PROGSUFFIX']){const f=fixture();f.env[key]='wrong';assert.throws(()=>auditCustomBuildEvidence(f.build()),/SUFFIX/);}
});
test('empty, missing, mixed-output and duplicate inventories reject instead of proving absence from nothing',()=>{
 for(const index of [0,2,5,6,8,9]){const f=fixture();f.observed.splice(index,1);assert.throws(()=>auditCustomBuildEvidence(f.build()),/REQUIRED_OUTPUT_MISSING/);}
 for(const change of [r=>r.path='../escape.o',r=>r.path='bin/obj/a/../escape.o',r=>r.path=r.path.replace(suffix,'.wrong'),r=>r.bytes=0,r=>r.sha256='bad']){
  const f=fixture();change(f.observed[0]);assert.throws(()=>auditCustomBuildEvidence(f.build()));
 }
 const f=fixture();f.observed.push({...f.observed[0]});assert.throws(()=>auditCustomBuildEvidence(f.build()),/DUPLICATE_PATH/);
 const g=fixture();g.observed.length=0;assert.throws(()=>auditCustomBuildEvidence(g.build()),/REQUIRED_OUTPUT_MISSING/);
 const h=fixture();h.observed.push(row('old/cache'+suffix+'.o'));assert.throws(()=>auditCustomBuildEvidence(h.build()),/UNEXPECTED_OBJECT_LOCATION/);
});
