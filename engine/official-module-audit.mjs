// Read-only module evidence for the fixed official prepared tree. No SCons,
// Python/config execution, compiler, target runtime or dependency installation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planOfficialBuild} from './official-build-plan.mjs';
import {auditModuleBuffers, FULL_MODULES, CONSERVATIVE_REMOVED_MODULES, REGISTRATION_MODULES} from './fixed-module-audit.mjs';

const metadataSha='c46b6788a52c04c71fb8c6d101055e9c1ad46dc854094308621720b6a6dae893';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
function exact(value,keys){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'OFFICIAL_MODULE_OPTIONS');
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort(),'OFFICIAL_MODULE_EXACT_FIELDS');
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);assert(d&&Object.hasOwn(d,'value'),'OFFICIAL_MODULE_DATA_FIELDS');}
}
function metadata(){
  const bytes=fs.readFileSync(new URL('./official-module-audit.json',import.meta.url));
  assert.equal(sha(bytes),metadataSha,'OFFICIAL_MODULE_METADATA_PIN');const m=JSON.parse(bytes);
  assert.deepEqual(m.moduleDirectories.map(d=>d.name).sort(),REGISTRATION_MODULES,'OFFICIAL_MODULE_UNIVERSE');
  assert.deepEqual(m.selection.conservativeDisabled,CONSERVATIVE_REMOVED_MODULES,'OFFICIAL_MODULE_CONSERVATIVE');
  assert.equal(m.parser.path,'engine/fixed-module-audit.mjs','OFFICIAL_MODULE_FIXED_PARSER');
  assert.deepEqual(pin(fs.readFileSync(new URL('../'+m.parser.path,import.meta.url))),{bytes:m.parser.bytes,sha256:m.parser.sha256},'OFFICIAL_MODULE_PARSER_PIN');
  assert.deepEqual(m.selection.expectedFullModules,FULL_MODULES,'OFFICIAL_MODULE_FULL_SET');
  return {m,identity:pin(bytes)};
}
export function officialModuleRequirements(profile){
  assert.equal(arguments.length,1);assert(['full','conservative'].includes(profile),'OFFICIAL_MODULE_PROFILE');
  const {m,identity}=metadata(),plan=planOfficialBuild({profile});
  const prepared=m.preparedPlanFiles.map(name=>{const p=plan.finalOutputs.find(p=>p.path===name);assert(p,'OFFICIAL_MODULE_PREPARED_PIN');return {path:name,bytes:p.bytes,sha256:p.sha256};});
  return {schema:'wxslim-official-module-requirements-v1',commit:m.commit,tree:m.tree,modulesTree:m.modulesTree,metadata:identity,
    preparedOnly:true,profile,sourcePins:[...m.sources,...prepared],moduleDirectories:m.moduleDirectories.map(d=>d.name),
    expectedModules:FULL_MODULES.filter(n=>profile==='full'||!CONSERVATIVE_REMOVED_MODULES.includes(n)),
    intendedSettings:{modulesEnabledByDefault:true,builtinMbedtls:true,moduleMbedtls:true,threads:false,wasmSimd:false},
    parser:m.parser,requiredCompileEvidence:m.selection.requiredCompileEvidence,
    actualAesCtrDrbgObjects:'PENDING_REAL_COMPILE',effectiveCompilerMacros:'PENDING_REAL_COMPILE'};
}
function regular(file){
  const st=fs.lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink(),'OFFICIAL_MODULE_REGULAR_SOURCE');
  const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  assert.equal(norm(fs.realpathSync(file)),norm(file),'OFFICIAL_MODULE_SOURCE_LINK');
  const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
  for(const name of ['size','mtimeMs','ctimeMs','ino','dev'])assert.equal(after[name],st[name],'OFFICIAL_MODULE_SOURCE_DRIFT');
  assert.equal(bytes.length,st.size);return bytes;
}
export function auditOfficialModuleSource(options){
  assert.equal(arguments.length,1);exact(options,['source','profile']);
  const requirements=officialModuleRequirements(options.profile);
  assert(typeof options.source==='string'&&path.isAbsolute(options.source),'OFFICIAL_MODULE_ABSOLUTE_SOURCE');
  const source=path.resolve(options.source),root=fs.lstatSync(source);
  assert(root.isDirectory()&&!root.isSymbolicLink(),'OFFICIAL_MODULE_SOURCE_DIRECTORY');
  const moduleRoot=path.join(source,'modules');
  const entries=fs.readdirSync(moduleRoot,{withFileTypes:true});
  for(const entry of entries)assert(!entry.isSymbolicLink(),'OFFICIAL_MODULE_DIRECTORY_LINK');
  const directories=entries.filter(d=>d.isDirectory()).map(d=>d.name).sort();
  assert.deepEqual(directories,requirements.moduleDirectories,'OFFICIAL_MODULE_DIRECTORY_UNIVERSE');
  const checked=requirements.sourcePins.map(expected=>{
    const bytes=regular(path.join(source,expected.path));
    assert.deepEqual(pin(bytes),{bytes:expected.bytes,sha256:expected.sha256},'OFFICIAL_MODULE_SOURCE_PIN '+expected.path);
    if(expected.gitBlob)assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),expected.gitBlob,'OFFICIAL_MODULE_GIT_BLOB');
    return {path:expected.path,...pin(bytes)};
  });
  // The fixed detector requires three files for every built-in module; config.py
  // is already checked by the complete pinned source list above.
  // Their complete contents remain covered by the separate whole-tree audit.
  for(const name of directories)for(const file of ['register_types.h','SCsub']){
    const target=path.join(moduleRoot,name,file),st=fs.lstatSync(target);assert(st.isFile()&&!st.isSymbolicLink(),'OFFICIAL_MODULE_DETECTION_FILE');
  }
  return {schema:'wxslim-official-module-source-audit-v1',status:'PASS_PREPARED_MODULE_SOURCE_ONLY',requirements,checked,
    wholeTreeAuthenticated:false,configurationExecuted:false,generatedModulesChecked:false,compiled:false,
    limits:['Requires separate authenticated prepared whole-tree audit; this checks only fixed module/configuration evidence.',
      'Default and planned settings are not observed SCons/preprocessor state.',
      'Actual AES/CTR_DRBG object membership, effective flags and linked imports/exports remain pending real compilation.']};
}
export function auditOfficialModuleBuffers(options){
  assert.equal(arguments.length,1);exact(options,['profile','enabledHeader','registration']);
  const {m,identity}=metadata();
  const {baseline:parserReference,...result}=auditModuleBuffers(options);
  assert(result.enabledModules.includes('mbedtls'),'OFFICIAL_MODULE_MBEDTLS_REQUIRED');
  return {...result,schema:'wxslim-official-generated-modules-v1',status:'PASS_OFFICIAL_EXPECTED_MODULE_DECLARATIONS_ONLY',
    official:{commit:m.commit,tree:m.tree,modulesTree:m.modulesTree,metadata:identity},
    parserReference:{sourceCommit:parserReference.sourceCommit,meaning:'Existing parser/expected capability set reused; official universe and source are separately pinned.'},
    wholeTreeAuthenticated:false,sourceAuditRequired:true,builtinMbedtlsEffective:'NOT_PROVEN_BY_DECLARATIONS',
    parser:m.parser,requiredCompileEvidence:m.selection.requiredCompileEvidence,
    actualAesCtrDrbgObjects:'PENDING_REAL_COMPILE_EVIDENCE',effectiveCompilerMacros:'PENDING_REAL_COMPILE_EVIDENCE'};
}
