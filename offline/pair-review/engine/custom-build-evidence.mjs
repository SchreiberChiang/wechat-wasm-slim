// Audit existing emitted settings and physical object inventory. This does not
// expand SCons commands, inspect archive members, or prove final linked removal.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeCustomWasmRequest} from './custom-wasm-plan.mjs';
import {customModuleSelection} from './custom-module-selection.mjs';
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const safe=p=>typeof p==='string'&&p.length>0&&!/[\\:\0\r\n]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const fixedSettings=Object.freeze({platform:'web',target:'template_release',arch:'wasm32',threads:false,lto:'thin',optimize:'size',
 builtin_mbedtls:true,module_mbedtls_enabled:true,module_gdscript_enabled:true,use_wx_glx:true,opengl3:true,vulkan:false,wasm_simd:false});
export function auditCustomBuildEvidence({features,observed,environmentBytes,expectedProfile,programSuffix}){
 const r=normalizeCustomWasmRequest(features),selection=customModuleSelection(r);
 assert(Array.isArray(observed)&&observed.length>0,'CUSTOM_BUILD_INVENTORY_REQUIRED');
 assert(typeof programSuffix==='string'&&/^\.web\.template_release\.wasm32(?:\.[a-z0-9_-]+)*$/.test(programSuffix),'CUSTOM_BUILD_SUFFIX');
 assert(typeof expectedProfile==='string'&&expectedProfile.length>0&&!/[\0\r\n]/.test(expectedProfile),'CUSTOM_BUILD_PROFILE_PATH');
 const rows=new Map();
 for(const row of observed){
  assert(row&&safe(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'CUSTOM_BUILD_INVENTORY_ROW');
  assert(!rows.has(row.path),'CUSTOM_BUILD_DUPLICATE_PATH');rows.set(row.path,row);
 }
 const raw=Buffer.from(environmentBytes),text=raw.toString('utf8');assert(Buffer.from(text).equals(raw),'CUSTOM_BUILD_ENV_UTF8');
 assert.deepEqual(pin(raw),{bytes:rows.get('.scons_env.json')?.bytes,sha256:rows.get('.scons_env.json')?.sha256},'CUSTOM_BUILD_ENV_INVENTORY_BINDING');
 const env=JSON.parse(text);assert(env&&Object.getPrototypeOf(env)===Object.prototype,'CUSTOM_BUILD_ENV_OBJECT');
 const settings={...fixedSettings,disable_3d:r.dimensions==='2d',disable_physics_3d:r.dimensions==='2d',disable_navigation_3d:r.dimensions==='2d',disable_xr:r.dimensions==='2d'};
 for(const name of r.disabledModules)settings['module_'+name+'_enabled']=false;
 for(const [name,value]of Object.entries(settings))assert(Object.hasOwn(env,name)&&env[name]===value,'CUSTOM_BUILD_RECORDED_SETTING '+name);
 assert.equal(env.build_profile,expectedProfile,'CUSTOM_BUILD_RECORDED_PROFILE');
 assert.equal(env.OBJSUFFIX,programSuffix+'.o','CUSTOM_BUILD_OBJECT_SUFFIX');assert.equal(env.PROGSUFFIX,programSuffix,'CUSTOM_BUILD_PROGRAM_SUFFIX');
 const allowed=new Set(selection.expectedModules),universe=new Set(selection.registrationUniverse),objects=[],archives=[];
 for(const row of rows.values()){
  if(!/\.(o|a)$/.test(row.path))continue;
  assert(row.path.startsWith('bin/obj/'),'CUSTOM_BUILD_UNEXPECTED_OBJECT_LOCATION');
  assert(row.bytes>0,'CUSTOM_BUILD_EMPTY_OBJECT');
  const extension=row.path.endsWith('.o')?'.o':'.a';assert(row.path.endsWith(programSuffix+extension),'CUSTOM_BUILD_MIXED_OBJECT_SUFFIX');
  const relative=row.path.slice('bin/obj/'.length);
  if(r.dimensions==='2d')assert(!relative.startsWith('scene/3d/'),'CUSTOM_BUILD_3D_SCENE_OBJECT_IN_2D');
  const module=relative.match(/^modules\/([^/]+)\//)?.[1];
  if(module){assert(universe.has(module),'CUSTOM_BUILD_UNKNOWN_MODULE_OBJECT');assert(allowed.has(module),'CUSTOM_BUILD_DISABLED_MODULE_OBJECT '+module);}
  if(relative.startsWith('modules/libmodule_')){
   assert.equal(extension,'.a','CUSTOM_BUILD_MODULE_ARCHIVE_KIND');
   const name=relative.slice('modules/libmodule_'.length,-(programSuffix+'.a').length);
   assert(universe.has(name)&&allowed.has(name),'CUSTOM_BUILD_DISABLED_OR_UNKNOWN_MODULE_ARCHIVE '+name);
  }
  (extension==='.o'?objects:archives).push({path:row.path,bytes:row.bytes,sha256:row.sha256});
 }
 const requiredObjects=['core/object/object','scene/register_scene_types','scene/2d/node_2d','platform/web/os_web','drivers/gles3/rasterizer_gles3',
  'thirdparty/mbedtls/library/aes','thirdparty/mbedtls/library/ctr_drbg',...(r.dimensions==='3d'?['scene/3d/node_3d']:[])].map(p=>'bin/obj/'+p+programSuffix+'.o');
 const requiredArchives=['scene/libscene','modules/libmodule_gdscript','modules/libmodule_mbedtls'].map(p=>'bin/obj/'+p+programSuffix+'.a');
 for(const p of [...requiredObjects,...requiredArchives])assert(rows.has(p),'CUSTOM_BUILD_REQUIRED_OUTPUT_MISSING '+p);
 objects.sort((a,b)=>a.path.localeCompare(b.path,'en'));archives.sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const manifest=[...objects,...archives];
 return {schema:'wxslim-custom-build-evidence-v1',status:'PASS_RECORDED_SETTINGS_AND_PHYSICAL_INVENTORY_ONLY',
  requested:r,environment:pin(raw),recordedSettings:settings,profilePathMatched:true,
  programSuffix,objectCount:objects.length,archiveCount:archives.length,physicalManifest:pin(Buffer.from(JSON.stringify(manifest))),
  requiredOutputs:[...requiredObjects,...requiredArchives],excludedModules:selection.registrationUniverse.filter(n=>!allowed.has(n)),
  scene3dObjects:r.dimensions==='2d'?'ABSENT_IN_CHECKED_INVENTORY':'REQUIRED_NODE_OBJECT_PRESENT',
  emittedCommands:'NOT_AVAILABLE_FROM_THIS_EVIDENCE',effectiveCompilerMacros:'NOT_PROVEN',archiveMembers:'NOT_INSPECTED',
  disabledClassBinaryRemoval:'NOT_PROVEN',finalLinkedRemoval:'NOT_PROVEN',rawBuildAdmitted:false,runtime:'NOT_RUN',
  limits:['Requires the executor authenticated post-build whole-tree inventory, not a caller-invented list.',
   'File presence and recorded environment are not command execution or archive/link membership proof.',
   '2D excludes scene/3d objects and disabled module directories/archives, not every shared 3D renderer symbol.']};
}
