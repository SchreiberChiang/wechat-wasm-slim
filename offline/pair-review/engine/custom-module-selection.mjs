// Custom profiles only. Preserve the historical fixed parser and its pins.
// These rules describe c050's fixed Web template_release flags. Replay against
// authenticated config.py functions and compare real generated modules later.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {officialModuleRequirements} from './official-module-audit.mjs';
import {auditModuleBuffers} from './fixed-module-audit.mjs';
const dimensionRules=Object.freeze({
  csg:'disable_3d',fbx:'disable_3d',gltf:'disable_3d',gridmap:'disable_3d',meshoptimizer:'disable_3d',
  godot_physics_3d:'disable_physics_3d',jolt_physics:'disable_physics_3d',vhacd:'disable_physics_3d',
  navigation_3d:'disable_navigation_3d',mobile_vr:'disable_xr',webxr:'disable_xr',
});
const required=Object.freeze({fbx:['gltf'],ktx:['basis_universal'],msdfgen:['freetype'],theora:['ogg','vorbis'],vorbis:['ogg']});
const identity=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});

export function customModuleSelection({dimensions,disabledModules}){
  assert(['2d','3d'].includes(dimensions),'CUSTOM_MODULE_DIMENSIONS');
  const evidence=officialModuleRequirements('full');
  assert(Array.isArray(disabledModules)&&disabledModules.every(n=>evidence.moduleDirectories.includes(n)),'CUSTOM_MODULE_NAME');
  assert.equal(new Set(disabledModules).size,disabledModules.length,'CUSTOM_MODULE_DUPLICATE');
  assert(!disabledModules.some(n=>['gdscript','mbedtls'].includes(n)),'CUSTOM_MODULE_REQUIRED_BACKEND');
  const excluded=new Map();
  for(const name of evidence.moduleDirectories){
    const reasons=[];
    if(!evidence.expectedModules.includes(name))reasons.push({kind:'FIXED_WEB_RELEASE_BASELINE'});
    if(disabledModules.includes(name))reasons.push({kind:'EXPLICIT_DISABLED_MODULE'});
    if(dimensions==='2d'&&Object.hasOwn(dimensionRules,name))reasons.push({kind:'DIMENSION_CONDITION',condition:dimensionRules[name]});
    if(reasons.length)excluded.set(name,reasons);
  }
  // Fixed c050 has only these non-optional module dependencies for this release
  // route. Optional renderer/font/GDScript dependencies never disable an owner.
  let changed=true;
  while(changed){changed=false;for(const name of evidence.expectedModules){
    if(excluded.has(name))continue;
    const missing=(required[name]??[]).filter(n=>excluded.has(n));
    if(missing.length){excluded.set(name,[{kind:'MISSING_REQUIRED_MODULE',dependencies:missing}]);changed=true;}
  }}
  const expectedModules=evidence.expectedModules.filter(n=>!excluded.has(n));
  assert(expectedModules.includes('gdscript')&&expectedModules.includes('mbedtls'));
  const explicit=disabledModules.slice().sort();
  const sourceNames=new Set(['SConstruct','methods.py','platform/web/detect.py',...evidence.moduleDirectories.map(n=>'modules/'+n+'/config.py')]);
  return {schema:'wxslim-custom-module-selection-v1',status:'EXPECTED_FROM_FIXED_SOURCE_RULES_NOT_COMPILED',
    dimensions,explicitDisabledModules:explicit,expectedModules,
    additionalRemovedFromFull:evidence.expectedModules.filter(n=>excluded.has(n)&&!explicit.includes(n)),
    excluded:evidence.moduleDirectories.filter(n=>excluded.has(n)).map(name=>({name,reasons:excluded.get(name)})),
    requiredDependencies:required,dimensionConditions:dimensionRules,registrationUniverse:evidence.moduleDirectories,
    sourcePins:evidence.sourcePins.filter(p=>sourceNames.has(p.path)),metadata:evidence.metadata,
    classRemoval:'NOT_PROVEN_BY_MODULE_DECLARATIONS',sourceReplay:'SEPARATE_EVIDENCE_REQUIRED',compiled:false,runtime:'NOT_RUN'};
}

export function auditCustomModuleBuffers({dimensions,disabledModules,enabledHeader,registration}){
  const selection=customModuleSelection({dimensions,disabledModules});
  const raw=Buffer.isBuffer(enabledHeader)?enabledHeader:Buffer.from(enabledHeader),text=raw.toString('utf8');
  assert(Buffer.from(text).equals(raw),'CUSTOM_MODULE_HEADER_UTF8');
  let clean=text.replaceAll('\r\n','\n').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  assert.equal((clean.match(/^\s*#pragma once\s*$/gm)||[]).length,1,'CUSTOM_MODULE_PRAGMA');
  clean=clean.replace(/^\s*#pragma once\s*$/gm,'');
  const actual=[];
  clean=clean.replace(/^\s*#define MODULE_([A-Z0-9_]+)_ENABLED[ \t]*$/gm,(_,name)=>{actual.push(name.toLowerCase());return '';});
  assert.equal(clean.trim(),'','CUSTOM_MODULE_UNEXPECTED_HEADER');
  assert.equal(new Set(actual).size,actual.length,'CUSTOM_MODULE_DUPLICATE_DECLARATION');actual.sort();
  assert.deepEqual(actual,selection.expectedModules,'CUSTOM_MODULE_SET_MISMATCH');
  // Reuse the strict unchanged registration parser. Its synthetic full header
  // validates the common guarded registration structure, not this build's set.
  const full=officialModuleRequirements('full').expectedModules;
  const synthetic='#pragma once\n'+full.map(n=>'#define MODULE_'+n.toUpperCase()+'_ENABLED\n').join('');
  const structure=auditModuleBuffers({profile:'full',enabledHeader:synthetic,registration});
  const active=structure.registration.declaredModules.filter(n=>actual.includes(n));assert.deepEqual(active,actual);
  return {schema:'wxslim-custom-generated-modules-v1',status:'PASS_EXPECTED_CUSTOM_DECLARATIONS_ONLY',selection,actualModules:actual,
    evidence:{enabledHeader:identity(raw),registration:structure.evidence.registration},activeRegistration:active,
    syntheticHeaderIsBuildEvidence:false,compilationProven:false,classesProven:false,macrosProven:false,linkedPairAdmitted:false,runtime:'NOT_RUN'};
}
