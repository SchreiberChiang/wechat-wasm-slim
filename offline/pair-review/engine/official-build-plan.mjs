// Read-only planning from already audited evidence. No replay, GET, source tree,
// environment selection, SDK process, directory creation or execution command.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const metadataPath='engine/official-build-plan.json';
const metadataSha='53cf9b93bf79d5b9c8e68c6aaf1af82dda964e5043c9e586d5377f078be2611d';
const commit='c050c09b105c3715e1caa57a7109cd752047fd89';
const hash=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:hash(b)});
const canonical=v=>JSON.stringify(sort(v));
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
function local(name){
 assert(typeof name==='string'&&/^[a-zA-Z0-9_.\/-]+$/.test(name)&&!path.posix.isAbsolute(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'PLAN_RELATIVE_DEPENDENCY');
 const target=path.join(root,name),st=fs.lstatSync(target);assert(st.isFile()&&!st.isSymbolicLink(),'PLAN_REGULAR_DEPENDENCY');
 const actual=fs.realpathSync(target),normalize=p=>process.platform==='win32'?p.toLowerCase():p;
 assert.equal(normalize(actual),normalize(path.resolve(target)),'PLAN_LINKED_DEPENDENCY');
 return fs.readFileSync(target);
}
function same(bytes,p){assert.deepEqual(pin(bytes),{bytes:p.bytes,sha256:p.sha256},'PLAN_DEPENDENCY_CHANGED '+p.path);}
export function normalizeOfficialBuildPlanRequest(request){
 assert.equal(arguments.length,1,'PLAN_ONE_REQUEST');
 assert(request&&typeof request==='object'&&!Array.isArray(request),'PLAN_REQUEST_OBJECT');
 assert.deepEqual(Reflect.ownKeys(request),['profile'],'PLAN_ONLY_PROFILE_ACCEPTED');
 const d=Object.getOwnPropertyDescriptor(request,'profile');assert(d&&Object.hasOwn(d,'value'),'PLAN_PROFILE_DATA_FIELD');
 assert(['full','conservative'].includes(d.value),'PLAN_EXPLICIT_FULL_OR_CONSERVATIVE');return {profile:d.value};
}
export function planOfficialBuild(request){
 assert.equal(arguments.length,1,'PLAN_ONE_REQUEST');const {profile}=normalizeOfficialBuildPlanRequest(request);
 const ownPath='engine/official-build-plan.mjs',ownBytes=local(ownPath),metaBytes=local(metadataPath);
 assert.equal(hash(metaBytes),metadataSha,'PLAN_METADATA_CHANGED');const m=JSON.parse(metaBytes);
 assert.equal(m.baseCommit,commit);assert.equal(m.patches.length,20);assert.equal(new Set(m.patches.map(p=>p.path)).size,20);
 const snapshots=new Map();for(const p of m.dependencies){assert(!snapshots.has(p.path),'PLAN_DUPLICATE_DEPENDENCY');const b=local(p.path);same(b,p);snapshots.set(p.path,b);}
 const json=p=>{assert(snapshots.has(p),'PLAN_UNPINNED_INPUT '+p);return JSON.parse(snapshots.get(p));};
 const evidence=json(m.evidence),bridge=json(m.secureRandomBridgeEvidence),tail=json('engine/official-upstream-storage-tail.json');
 assert.equal(evidence.status,'PASS_SOURCE_ONLY_NOT_BUILD_READY');assert.equal(evidence.baseCommit,commit);
 assert.equal(evidence.inputFiles,25);assert.equal(evidence.officialInputs.length,25);assert.equal(evidence.outputFiles,31);assert.equal(evidence.finalOutputs.length,31);assert.equal(evidence.patchCount,20);
 for(const rows of [evidence.officialInputs,evidence.finalOutputs])assert.equal(new Set(rows.map(p=>p.path)).size,rows.length,'PLAN_DUPLICATE_SOURCE_PATH');
 assert.equal(evidence.postPatchTransform.kind,'EXPLICIT_POST_PATCH_SCSUB_BLOCK_RELOCATION');
 assert(evidence.postPatchTransform.identicalBlock&&evidence.postPatchTransform.otherBytesUnchanged&&evidence.postPatchTransform.reverseExact);
 assert(evidence.postPatchTransform.afterLine<evidence.postPatchTransform.consumerLine);
 assert.equal(evidence.finalOutputs.find(p=>p.path==='platform/web/SCsub').sha256,evidence.postPatchTransform.after.sha256);
 assert(!evidence.finalOutputs.some(p=>p.path==='core/crypto/SCsub'),'PLAN_REFERENCE_IS_NOT_OUTPUT');
 const generated=evidence.finalOutputs.find(p=>p.path===tail.generatedLibrary.path);
 assert(generated,'PLAN_GENERATED_BACKEND_MISSING');
 assert.deepEqual({bytes:generated.bytes,sha256:generated.sha256},{bytes:tail.generatedLibrary.bytes,sha256:tail.generatedLibrary.sha256});
 for(const retired of tail.retired)assert(!evidence.finalOutputs.some(p=>p.path===retired.path),'PLAN_RETIRED_SOURCE_IN_OUTPUT');
 assert.equal(bridge.status,'PASS_SOURCE_MODELS_ONLY_NOT_BUILD_READY');
 for(const [field,name]of [['base','convert/assets/godot-bridge.js'],['host','convert/assets/secure-random-host.js'],['lifecycle','convert/assets/secure-random-lifecycle.js']])same(snapshots.get(name),{path:name,...bridge.derivation[field]});
 assert.equal(bridge.derivation.outsideEditsBytesUnchanged,true);
 for(let i=0;i<m.patches.length;i++){const p=m.patches[i];assert.equal(p.order,i+1);same(snapshots.get(p.path),p);}
 const selected=m.profiles[profile];assert(selected,'PLAN_PROFILE_NOT_REGISTERED');same(snapshots.get(selected.path),selected);
 const profileJson=json(selected.path);assert.equal(profileJson.type,'build_profile');assert.deepEqual(profileJson.disabled_classes,[]);
 const policy=json('engine/fixed-engine-policy.json');assert.equal(policy[profile].path,selected.path);assert.equal(policy[profile].sha256,selected.sha256);
 const disabled=Object.keys(profileJson.disabled_build_options).sort();
 assert.deepEqual(disabled,policy[profile].disabledModules.map(p=>'module_'+p+'_enabled').sort());
 assert(Object.values(profileJson.disabled_build_options).every(v=>v===false));
 const donor=json(m.donorArguments),cache=json(m.toolchainPolicy),recipe=json('engine/alpha-preserve-lighting/delivery-recipe.json');
 const args=donor.build.sconsArgs;assert(Array.isArray(args)&&args.every(s=>typeof s==='string'));
 for(const prefix of ['--jobs=','build_profile=','wx_glx_lib='])assert.equal(args.filter(a=>a.startsWith(prefix)).length,1);
 assert(args.includes('build_profile=<FULL_PROFILE>')&&args.includes('wx_glx_lib=<EXACT_026E_LIBRARY>'));
 const library=recipe.engine.library;assert.equal(library.bytes,3866614);assert.equal(library.sha256,'026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8');
 const plan={schema:'wxslim-official-build-plan-v1',status:'PLAN_ONLY_NOT_BUILD_READY',profile,
  source:{repository:'https://github.com/godotengine/godot',commit,wholeTreeVerified:false,sourcePath:'NOT_SELECTED'},
  implementation:{path:ownPath,...pin(ownBytes)},metadata:{path:metadataPath,...pin(metaBytes)},dependencies:m.dependencies,
  sourceEvidence:{path:m.evidence,...pin(snapshots.get(m.evidence)),meaning:'25 fixed blobs and 31 derived outputs; not a whole source tree or emitted pair'},
  officialInputs:evidence.officialInputs,patches:m.patches,postPatchTransform:evidence.postPatchTransform,finalOutputs:evidence.finalOutputs,
  upstreamSource:{path:'NOT_SELECTED',fixedSource:tail.upstream.source,repository:tail.upstream.repository,commit:tail.upstream.commit,
   repositoryPath:tail.upstream.repositoryPath,sourcePathMeaning:tail.upstream.sourcePathMeaning,actualBytesRead:false},
  generatedSources:[{output:tail.generatedLibrary,body:tail.upstream.derived,bodyIncludedWhole:tail.upstream.bodyIncludedWhole,
   preparer:{...m.dependencies.find(p=>p.path==='engine/official-upstream-storage-tail.mjs'),export:'renderOfficialUpstreamFs'},
   backendPreparation:{...m.dependencies.find(p=>p.path==='engine/upstream-wxmemfs-read-contract.mjs'),export:'replayUpstreamWxmemfsRead',patches:tail.upstream.patches},
   license:tail.upstream.license,deps:tail.upstream.deps,materialized:false}],
  retiredSources:tail.retired.map(p=>({source:p,action:'DO_NOT_MATERIALIZE_REJECT_IF_PRESENT',removed:false})),
  sourceAssembly:{implementation:m.dependencies.find(p=>p.path==='engine/official-basic-capability-combination.mjs'),
   export:'auditOfficialBasicCapabilityCombination',inputs:'Exact 25 fixed official blobs plus separately authenticated upstreamSource bytes',
   action:'Recompute the full source combination including generated runtime backend and explicit SCsub relocation; verify every one of the 31 output paths and hashes before materialization.',
   applyingTwentyPatchesAloneIsSufficient:false,executed:false},
  selectedProfile:{...selected,disabledModules:policy[profile].disabledModules,moduleCompatibilityWithOfficialTree:'NOT_VERIFIED'},
  argumentTemplate:args.map(a=>a.startsWith('--jobs=')?'--jobs=<NOT_SELECTED>':a.startsWith('build_profile=')?'build_profile=<SELECTED_PROFILE_SNAPSHOT>':a),
  parameterProvenance:{donor:m.donorArguments,meaning:'Argument template only; df3 recipe/source/binary identity is not inherited',newUserArguments:[],
   effectiveSettingsPendingCompile:{builtin_mbedtls:true,module_mbedtls_enabled:true,threads:false,wasm_simd:false,dlink_enabled:false,proxy_to_pthread:false,opengl3:true,disable_exceptions:false},
   sourceDefinedSettingsPendingCompile:{cppdefine:'WECHAT_GLX_EXPERIMENTAL',cxxAndLink:'-fexceptions',longjmpCompileAndLink:'emscripten',
    link:['-sCHECK_NULL_WRITES=0','-sERROR_ON_UNDEFINED_SYMBOLS=0','<EXACT_026E_LIBRARY>'],
    runtimeExports:['ccall','cwrap','stringToUTF8','lengthBytesUTF8'],offscreenFramebuffer:'OMITTED_FOR_GLX',
    wasmBigint:'SDK_DEFAULT_TRUE_NOT_FORCED_FALSE',windows:{condition:'use_wx_glx and os.name == nt',adapter:'ENGINE_LAB_WINDOWS_LINK_RESPONSE_V2',
     argumentEscaping:'shlex.quote',responseEncoding:'utf-8',targetAndSources:'posix',signaturePath:'original command returned'}},
   note:'mbedTLS settings are required effective settings to verify, not silently added command-line arguments'},
  library:{bytes:library.bytes,sha256:library.sha256,path:'NOT_SELECTED'},
  toolchain:{version:'Emscripten 4.0.10',driverNode:recipe.toolchain.driverNode,policy:{path:m.toolchainPolicy,...pin(snapshots.get(m.toolchainPolicy))},
   expectedPython:{version:cache.pythonVersion,exeSha256:cache.pythonExeSha256,baseSha256:cache.pythonBaseExeSha256},scons:{version:cache.sconsVersion,wheel:cache.sconsWheel},sdkArchive:cache.sdkArchive,
   sdkFiles:cache.sdkFiles,thinLtoLibraries:cache.thinLtoLibraries,actualPaths:'NOT_SELECTED',actualDependencyAudit:'NOT_RUN',
   hostRequirements:['Explicit Node/Git/Python/SDK/SCons wheel/archive paths and identities','Git/git.exe resolution in parent and sanitized child','Read-only selected SDK/cache/header audit and Python base/venv validation','Protected placement and current resources before any authorized executor']},
  secureRandomBridge:{evidence:{path:m.secureRandomBridgeEvidence,...pin(snapshots.get(m.secureRandomBridgeEvidence))},derivation:bridge.derivation,integrated:false},
  exportsAdded:evidence.exportsAdded,rawCapture:{status:'PLANNED_NOT_CONFIRMED_BY_SCONS',earliest:'build[0] = #bin/godot${PROGSUFFIX}.js',wasm:'build[1] = #bin/godot${PROGSUFFIX}.wasm',symbols:"build[0] + '.symbols' (--emit-symbol-map)",
   nameExampleOnly:'godot.web.template_release.wasm32.nothreads.js',actualProgSuffix:'MUST_RECORD_FROM_REAL_SCONS',
   separateLaterOutputs:['.engine.js','.wrapped.js','.web_zip/godot.js'],
   fixedOfficialScsub:{bytes:4631,sha256:'d8292a8945f941c061f6484ea2bcce783d7838cde8ecad8ff3ca86ff29b36180',lines:{buildTargets:78,addProgram:103,engine:117,wrapped:[120,126],templateZip:131}}},
  work:'NOT_SELECTED',jobs:'NOT_SELECTED',budgetBytes:'NOT_SELECTED',executionAuthorized:false,executionCommand:null,
  gates:{wholeOfficialTree:'NOT_VERIFIED',actualDependencyAndFrozenCache:'NOT_RUN',officialModuleSelection:'NOT_RUN',hostRegistration:'NOT_INTEGRATED',
   mbedtlsCompilationAndShutdown:'NOT_RUN',completePostprocess:'NOT_IMPLEMENTED_FOR_OFFICIAL_OUTPUT',actualRawAndFinalPair:'NOT_AVAILABLE',
   undefinedImportStubs:'MUST_REJECT_DESPITE_ERROR_ON_UNDEFINED_SYMBOLS_0',runtime:'NOT_RUN',phone:'NOT_RUN'},
  remaining:['Authenticate entire c050 source tree and exact permitted changes/generated files without importing df3 source identity.',
   'Verify official full/conservative module selection, builtin mbedTLS/AES/CTR_DRBG settings and actual Windows response-file/link behavior.',
   'Freeze approved host integration and new official postprocessor; clock/RuntimeError/stat/invoke rules remain inspection-first.',
   'Capture earliest raw program outputs separately from engine/wrapped/zip; verify emitted imports/exports/ABI and reject missing stubs.',
   'Only a separately authorized executor may create a workspace/build; no old binary or device result is inherited.']};
 // A plan cannot silently authenticate bytes that changed while it was read.
 for(const p of m.dependencies)same(local(p.path),p);assert(local(metadataPath).equals(metaBytes),'PLAN_METADATA_DRIFT');assert(local(ownPath).equals(ownBytes),'PLAN_IMPLEMENTATION_DRIFT');
 return {...plan,planSha256:hash(Buffer.from(canonical(plan)))};
}
