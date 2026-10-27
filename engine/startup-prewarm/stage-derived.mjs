// Exact, local-only packaging. Never evaluates target glue, instantiates WASM or uses WeChat.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {hash,json,manifest,readTree,verifyParent,ENGINE} from '../functional-acceptance/stage.mjs';
import {compareSkipOnly,unpackPck,projectProperties} from './scene.mjs';

export const BASELINE = Object.freeze({packageId:'ios-functional-glx-912c537585a6f3a07ef5',manifestSha256:'fa54b3f15d4fbb989bed9bf9a9c67743a1283e803684f17cb5598bf193938215'});
export const PINS = Object.freeze({sourcePin:'df3cdd9bc9941a20cb5575d781cde6f937637bcb',parentBuildSha256:'d2e324538417b829cdd555a03e90847e4a03d556e357daf2871196b741bff85c',patchSha256:'f275b6634d5949cb00e100ab363dbe9d37e8ad6fb171c20b3d43795d1f01bef2'});
export const ALLOWED_PATHS = Object.freeze(['CANDIDATE.json','candidate-mode.js','candidate-relay.js','engine/empty-tips.bin','engine/godot.js','engine/godot.wasm.br','project.config.json','project.private.config.json'].sort());
const OUTPUTS=['godot.js','godot.wasm','godot.wasm.br'];
const CHANGE_PATHS=['drivers/gles3/rasterizer_scene_gles3.cpp','main/main.cpp'];
const DEPENDENCIES=['incremental.mjs','patch.mjs','skip-default-3d-prewarm.patch','finalize.mjs','build.mjs','stage.mjs','audit-pair.mjs','audit-diagnostic-abi.cjs','audit-linkage.cjs'];
const CORE_CALLBACKS=['_glxInit','_glxInitBufferDataAndGlState','_glxUpdateContextId','_glxCommandBufferFlush'];
const TEXTURE_CALLBACKS=['_glCompressedTexImage2D','_glCompressedTexSubImage2D','_glTexImage2D','_glTexStorage2D','_glTexSubImage2D','_glxGetBoundTexture2D','_glxIsTexture','_glxPushBindTexture','_glxPushTexImage2DPlaceholder'];
const SETTING='startup/gles3/skip_default_3d_prewarm';
const self=fileURLToPath(import.meta.url),require=createRequire(import.meta.url);
const need=(v,m)=>{if(!v)throw Error(m);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const cleanName=n=>typeof n==='string'&&n.length>0&&!path.isAbsolute(n)&&!n.includes('\\')&&!n.split('/').some(x=>!x||x==='.'||x==='..');
const safeText=s=>!/[A-Z]:[\\/]|wx[a-f0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(s);
const inside=(a,b)=>{const r=path.relative(a,b);return !r||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
function plain(input){
  need(typeof input==='string'&&input.length>0,'Nonempty explicit path required');const p=path.resolve(input);
  for(let q=p;;q=path.dirname(q)){try{need(!fs.lstatSync(q).isSymbolicLink(),'Symlink/reparse path refused');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(q)===q)break;}
  return p;
}
const read=p=>{p=plain(p);need(fs.lstatSync(p).isFile(),'Regular file required');return fs.readFileSync(p);};
export function verifyBytes(bytes,expected,label){need(expected&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&hex(expected.sha256),'Missing exact file identity: '+label);need(bytes.length===expected.bytes&&hash(bytes)===expected.sha256,'File hash/size drift: '+label);return bytes;}
function fileIdentity(fid,label){need(fid&&typeof fid.path==='string','Missing file path: '+label);return verifyBytes(read(fid.path),fid,label);}
const parse=(b,label)=>{try{return JSON.parse(b);}catch{throw Error('Invalid JSON: '+label);}};
function checksPass(checks,label){need(Array.isArray(checks)&&checks.length>0&&checks.every(c=>c.pass===true),'Failed/missing checks: '+label);}

export function validateAdmission(a){
  need(a?.schema==='startup-prewarm-derived-admission-v1','Unsupported admission schema');
  need(safeText(json(a)),'Admission must not disclose machine paths, AppID or private keys');
  need(same(a.parent,BASELINE),'Admission parent differs from exact 912c baseline');
  for(const k of ['sourcePin','parentBuildSha256','patchSha256'])need(a[k]===PINS[k],'Admission pin drift: '+k);
  for(const k of ['handoffSha256','buildSha256','incrementalSha256','buildIdentitySha256','buildStageSha256','pairSha256','sconsArgsSha256'])need(hex(a[k]),'Missing admission hash: '+k);
  need(a.outputs&&same(Object.keys(a.outputs).sort(),[...OUTPUTS].sort()),'Exactly three admitted outputs required');for(const n of OUTPUTS)verifyBytesShape(a.outputs[n],n);
  need(hash(JSON.stringify(a.outputs))===a.pairSha256,'Admission pair digest mismatch');
  for(const n of ['pairSha256','abiSha256','linkageSha256'])need(hex(a.audits?.[n]),'Missing admitted audit hash: '+n);
  need(Number.isSafeInteger(a.audits.diagnosticAbiChecks)&&a.audits.diagnosticAbiChecks>0,'Missing admitted ABI check count');
  need(Array.isArray(a.dependencies)&&a.dependencies.length===9&&same(a.dependencies.map(x=>x.name).sort(),[...DEPENDENCIES].sort()),'Nine exact admitted dependencies required');
  for(const d of a.dependencies)verifyBytesShape(d,'dependency '+d.name);
  need(Array.isArray(a.sourceChanges)&&a.sourceChanges.length===2&&same(a.sourceChanges.map(x=>x.path).sort(),CHANGE_PATHS),'Exactly two admitted C++ changes required');
  for(const x of a.sourceChanges)need(hex(x.beforeSha256)&&hex(x.afterSha256)&&x.beforeSha256!==x.afterSha256,'Invalid admitted source change');
  need(a.scenes&&same(Object.keys(a.scenes).sort(),['compat','skip-only']),'Two explicit scene rules required');
  for(const rule of Object.values(a.scenes))need(hex(rule.pckSha256)&&hex(rule.sourceManifestSha256),'Missing exact scene rule');
  return a;
}
function verifyBytesShape(x,label){need(x&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&hex(x.sha256),'Invalid file identity: '+label);}

// Report facts are checked independently of handoff pass summaries. A static AST audit is
// additionally rerun by loadEvidence against actual output/unchanged host bytes.
export function verifyReportFacts({admission:a,handoff:h,build,incremental,pair,abi,linkage:link}){
  need(h?.schema==='startup-prewarm-exact-build-handoff-v1','Wrong handoff schema');
  for(const k of ['parentBuildSha256','patchSha256'])need(h[k]===a[k],'Handoff pin mismatch: '+k);
  need(h.runtime==='not_run'&&h.phone==='not_run'&&h.upload==='not_uploaded','Handoff runtime status drift');
  need(h.build?.sha256===a.buildSha256&&h.incremental?.sha256===a.incrementalSha256,'Handoff record hash mismatch');
  need(h.buildIdentitySha256===a.buildIdentitySha256&&h.buildStageSha256===a.buildStageSha256,'Handoff build fingerprint mismatch');
  need(build.finishedAt&&build.parentBuildSha256===a.parentBuildSha256&&build.schema==='startup-prewarm-incremental-build-v1','Incomplete/wrong incremental build');
  need(build.initialization?.status==='complete'&&build.identity?.pin===a.sourcePin,'Build completion/source pin mismatch');
  need(hash(JSON.stringify(build.identity))===a.buildIdentitySha256&&hash(JSON.stringify(build.stage))===a.buildStageSha256,'Actual build identity/stage drift');
  need(same(h.outputs,a.outputs)&&same(build.outputs,a.outputs)&&same(incremental.outputs,a.outputs),'Output records differ');
  need(h.pairSha256===a.pairSha256&&build.pairing?.sha256===a.pairSha256&&incremental.pairing?.sha256===a.pairSha256,'Pair metadata differs');
  need(h.raw?.postprocessCount===1&&incremental.raw?.postprocessCount===1,'Exactly one recorded postprocess required');
  need(incremental.phase==='static-audited'&&incremental.parentPreservation===true&&incremental.sourceTestsPass===true,'Incremental audit/parent preservation missing');
  need(Array.isArray(incremental.events)&&incremental.events.length===3&&incremental.events.every(x=>x.code===0&&x.timedOut===false),'Three successful original source tests required');
  need(same(h.sconsArgs,build.sconsArgs)&&same(h.sconsArgs,incremental.sconsArgs)&&hash(JSON.stringify(h.sconsArgs))===a.sconsArgsSha256,'SCons argument drift');
  for(const flag of ['optimize=size','lto=thin','--jobs=4','linkflags=--emit-symbol-map -Wl,--thinlto-jobs=2'])need(h.sconsArgs.includes(flag),'Compiler policy drift');
  need(!h.sconsArgs.some(x=>x.startsWith('cppdefines=')),'Unexpected macro override');
  need(h.host?.packageId===BASELINE.packageId&&h.host.manifestSha256===BASELINE.manifestSha256&&h.host.files?.length===27,'Wrong handoff host');
  const summary=h.audits;need(summary&&summary.pair?.sha256===a.audits.pairSha256&&summary.abi?.sha256===a.audits.abiSha256&&summary.linkage?.sha256===a.audits.linkageSha256,'Audit hash binding mismatch');
  need(summary.diagnosticAbiPass===true&&summary.diagnosticAbiChecks===a.audits.diagnosticAbiChecks&&summary.importCount===774&&summary.exportCount===43&&summary.pureEnginePass===false&&summary.staticSpecifiedHostPass===true&&summary.hostManifestSha256===BASELINE.manifestSha256,'Handoff audit summary differs');
  for(const n of ['missingLinkPlaceholders','allPlaceholderDefinitions','linkWarnings'])need(summary[n]===0,'Handoff missing-link evidence');
  need(pair.schema==='wxslim-selfbuild-pair-static-v1'&&same(pair.outputs,a.outputs)&&pair.sourcePin===a.sourcePin,'Pair report not bound to outputs');
  need(pair.imports?.length===774&&pair.exports?.length===43&&pair.initialization==='not_run'&&pair.phone==='not_run','Pair report count/status mismatch');
  need(pair.submission&&Object.values(pair.submission).length===3&&Object.values(pair.submission).every(v=>v===true),'Submission glue audit failure');
  for(const n of CORE_CALLBACKS)need(typeof pair.nativeMapping?.[n]==='string'&&pair.exports.some(e=>e.name===pair.nativeMapping[n]&&e.kind==='function'),'Native callback pair mapping missing');
  need(abi.schema==='wxslim-official-glx-026e-diagnostic-abi-static-v1'&&abi.buildRecordSha256===a.buildSha256&&abi.pass===true,'ABI report build mismatch');
  checksPass(abi.checks,'diagnostic ABI');need(abi.checks.length===a.audits.diagnosticAbiChecks&&abi.importCount===774&&abi.exportCount===43&&abi.sourcePin===a.sourcePin,'ABI report counts/source differ');
  for(const [n,k]of [['godot.js','js'],['godot.wasm','wasm'],['godot.wasm.br','br']])need(same(abi.artifacts?.[k],a.outputs[n]),'ABI artifact identity differs');
  need(abi.library?.actualMatches===true&&abi.library?.actual?.sha256===ENGINE.librarySha256,'Wrong actual GLX library in ABI report');
  need(link.schema==='official-glx-final-linkage-v1'&&link.buildMetadataSha256===a.buildSha256&&link.pureEnginePass===false&&link.pass===false,'Linkage report build/pure-engine status differs');
  const audit=link.audit;need(audit?.pass===false&&audit.importCount===774&&audit.exportCount===43&&audit.jsSha256===a.outputs['godot.js'].sha256&&audit.wasmSha256===a.outputs['godot.wasm'].sha256,'Linkage audit output mismatch');
  need(audit.wasmImportObjectCount===1&&audit.resolvedImports?.length===774&&audit.exports?.length===43,'Incomplete import/export audit');
  const unresolved=audit.resolvedImports.filter(x=>x.resolved!==true);need(unresolved.length===1&&unresolved[0].reason==='unbound nowPolyfill','Only original nowPolyfill may remain engine-only unresolved');
  need(audit.resolvedImports.every(x=>!x.missingPlaceholder),'Import placeholder present');
  for(const n of ['missingLinkPlaceholders','allPlaceholderDefinitions','linkWarnings'])need(Array.isArray(audit[n])&&audit[n].length===0,'Linkage report has missing/placeholder/warning evidence');
  need(audit.callbacks?.length===13&&same(audit.callbacks.map(x=>x.name).sort(),[...CORE_CALLBACKS,...TEXTURE_CALLBACKS].sort()),'Complete GLX callback inventory required');checksPass(audit.callbacks,'GLX callbacks');
  need(link.host?.packageId===BASELINE.packageId&&link.host.manifestSha256===BASELINE.manifestSha256&&link.host.staticContractPass===true&&link.host.symbol==='nowPolyfill','Wrong/failed exact host contract');checksPass(link.host.checks,'host contract');
  const closure=link.hostClosure;need(closure?.pureEnginePass===false&&closure.staticSpecifiedHostPass===true&&closure.imports?.length===774&&closure.imports.every(x=>x.resolvedWithSpecifiedHost===true),'Exact host closure missing');
  const closed=closure.imports.filter(x=>x.engineOnlyResolved===false);need(closed.length===1&&closed[0].hostSymbol==='nowPolyfill'&&closed[0].name===unresolved[0].name&&closed[0].module===unresolved[0].module,'Host closure must resolve only original nowPolyfill');
  const old=link.baseline?.audit,oldUnresolved=old?.resolvedImports?.filter(x=>x.resolved!==true);
  need(old&&old.jsSha256===ENGINE.jsSha256&&old.wasmSha256===ENGINE.wasmSha256&&oldUnresolved?.length===1&&oldUnresolved[0].reason==='unbound nowPolyfill'&&oldUnresolved[0].name===unresolved[0].name&&oldUnresolved[0].module===unresolved[0].module&&link.baseline.hostClosure?.staticSpecifiedHostPass===true,'Original engine baseline must retain the same host-scoped clock closure');
  need(link.boundaries?.targetJsExecuted===false&&link.boundaries?.wasmInstantiated===false&&link.boundaries?.phoneAccess===false,'Static audit boundary differs');
  return {pureEnginePass:false,staticSpecifiedHostPass:true,importCount:774,exportCount:43,diagnosticAbiChecks:abi.checks.length};
}

export function loadEvidence({handoff,admission,admissionSha256,parentFiles}){
  need(hex(admissionSha256),'Explicit admission SHA256 required');const admissionBytes=read(admission);need(hash(admissionBytes)===admissionSha256,'Admission SHA256 drift');const a=validateAdmission(parse(admissionBytes,'admission'));
  const handoffBytes=read(handoff);need(hash(handoffBytes)===a.handoffSha256,'Handoff SHA256 drift');const h=parse(handoffBytes,'handoff');
  const buildBytes=fileIdentity(h.build,'BUILD'),incrementalBytes=fileIdentity(h.incremental,'INCREMENTAL');
  need(h.build.sha256===a.buildSha256&&h.incremental.sha256===a.incrementalSha256,'Admitted build/record SHA differs');
  const build=parse(buildBytes,'BUILD'),incremental=parse(incrementalBytes,'INCREMENTAL');
  need(Array.isArray(h.dependencies)&&h.dependencies.length===9,'Missing handoff dependencies');
  const dependencies=[];for(const d of h.dependencies){const n=path.basename(d.path);const rule=a.dependencies.find(x=>x.name===n);need(rule&&rule.bytes===d.bytes&&rule.sha256===d.sha256,'Dependency admission drift');fileIdentity(d,'dependency '+n);dependencies.push(n);}need(same(dependencies.sort(),[...DEPENDENCIES].sort()),'Duplicate/missing dependency');
  need(path.resolve(h.build.path)===path.resolve(h.buildDir,'BUILD.json'),'Build directory/record mismatch');
  const outputs={};for(const n of OUTPUTS)outputs[n]=verifyBytes(read(path.join(h.buildDir,'artifacts',n)),a.outputs[n],n);
  need(zlib.brotliDecompressSync(outputs['godot.wasm.br']).equals(outputs['godot.wasm']),'Actual Brotli/raw pair differs');
  need(outputs['godot.wasm'].subarray(0,8).toString('hex')==='0061736d01000000','Invalid WASM header');
  need(outputs['godot.wasm'].includes(Buffer.from(SETTING)),'Compiled setting string absent');
  const library=build.identity?.glxLibrary;need(library?.sha256===ENGINE.librarySha256,'Build library pin differs');fileIdentity(library,'actual linked GLX library');
  need(Array.isArray(h.sourceChanges)&&h.sourceChanges.length===2&&same(h.sourceChanges.map(c=>c.path).sort(),CHANGE_PATHS)&&same(h.sourceChanges,incremental.sourceChanges),'Source change records differ');
  need(hash(read(path.join(incremental.base,'BUILD.json')))===PINS.parentBuildSha256,'Actual original BUILD drift');
  for(const c of h.sourceChanges){const rule=a.sourceChanges.find(x=>x.path===c.path);need(rule&&cleanName(c.path)&&c.before?.sha256===rule.beforeSha256&&c.after?.sha256===rule.afterSha256,'Source change admission differs');verifyBytes(read(path.join(incremental.base,'engine',c.path)),c.before,'before '+c.path);verifyBytes(read(path.join(h.buildDir,'engine',c.path)),c.after,'after '+c.path);}
  need(same(h.host.files,manifest(parentFiles)),'Actual baseline host tree differs from handoff');
  const pair=parse(fileIdentity(h.audits?.pair,'pair audit'),'pair audit'),abi=parse(fileIdentity(h.audits?.abi,'ABI audit'),'ABI audit'),linkage=parse(fileIdentity(h.audits?.linkage,'linkage audit'),'linkage audit');
  const facts=verifyReportFacts({admission:a,handoff:h,build,incremental,pair,abi,linkage});
  // Tool/parser code is hash-bound before loading; generated glue is only parsed as text.
  const auditorPath=h.dependencies.find(d=>path.basename(d.path)==='audit-linkage.cjs').path;
  need(path.resolve(auditorPath)===path.resolve(path.dirname(self),'../official-glx-library/audit-linkage.cjs'),'Only repository-owned static auditor permitted');
  const parserBytes=fileIdentity({path:linkage.parser?.path,bytes:read(linkage.parser?.path).length,sha256:linkage.parser?.sha256},'Acorn parser');need(parserBytes.length>0,'Parser missing');
  const acorn=require(plain(linkage.parser.path)),auditor=require(plain(auditorPath));
  const logs=[];for(const log of linkage.logFiles||[]){const bytes=read(log.file);need(hash(bytes)===log.sha256,'Link log drift');logs.push({file:log.file,text:bytes.toString()});}
  need(logs.length>0,'Actual linker logs required');
  const repeated=auditor.auditPair({js:outputs['godot.js'].toString(),wasm:outputs['godot.wasm'],acorn,logs});
  need(same(repeated,linkage.audit),'Static linkage recomputation differs from admitted report');
  const host=auditor.auditHostSources({sdkCode:parentFiles.get('engine/godot-sdk.js').toString(),entryCode:parentFiles.get('engine/game.js').toString(),gameCode:parentFiles.get('game.js').toString(),loaderCode:parentFiles.get('godot-loader.js').toString(),adapterCode:parentFiles.get('weapp-adapter.js').toString(),config:JSON.parse(parentFiles.get('game.json'))},acorn);
  need(host.staticContractPass===true&&same(host.checks,linkage.host.checks)&&host.definition===linkage.host.definition&&host.assignment===linkage.host.assignment,'Actual unchanged host no longer proves original nowPolyfill');
  need(same(auditor.withHostClosure(repeated,host),linkage.hostClosure),'Recomputed host closure differs');
  return {admission:a,admissionSha256,handoffSha256:hash(handoffBytes),buildSha256:hash(buildBytes),outputs,facts};
}

export function verifyScene({variant,pck,source,parentPck,admission}){
  need(['skip-only','compat'].includes(variant),'Unknown variant');const rule=admission.scenes[variant];need(hash(pck)===rule.pckSha256&&hash(json(manifest(source)))===rule.sourceManifestSha256,'Exact scene PCK/source manifest differs');
  const packed=unpackPck(pck),project=packed.get('project.binary');need(project,'Missing project.binary');const props=projectProperties(project),value=props.get(SETTING);
  need(value?.length===8&&value.readUInt32LE(0)===1&&value.readUInt32LE(4)===1,'Packed project setting must be bool true');
  const sourceProject=source.get('project.godot')?.toString()||'';need((sourceProject.match(/^gles3\/skip_default_3d_prewarm=true\s*$/gm)||[]).length===1,'Source skip request true missing/ambiguous');
  const checked=[];for(const [n,b]of packed){need(cleanName(n),'Unsafe PCK name');need(!/(?:^|\/)(?:local_[^/]*|alpha_mix_verify|compat_verify|compat_gate_verify|build_font)\.(?:gd|py)$/.test(n),'External harness must not be packed');if(/\.(?:gd|gdshader|gdshaderinc)$/.test(n)){need(source.get(n)?.equals(b),'Packed script/shader source mismatch: '+n);checked.push(n);}}
  for(const n of ['main.gd','renderer.gd','renderer_base.gd','renderer_round3.gd'])need(checked.includes(n),'Expected packed scene script missing');
  if(packed.has('cases.json'))need(source.get('cases.json')?.equals(packed.get('cases.json')),'Packed catalog/source mismatch');
  let skipOnly=null;if(variant==='skip-only')skipOnly=compareSkipOnly(parentPck,pck);
  else {
    for(const n of ['opaque_viewport_compat.gd','opaque_viewport_mix.gdshader'])need(checked.includes(n),'Compat implementation not packed');
    const gate=source.get('opaque_viewport_compat.gd').toString().replace(/^\s*#.*$/gm,'');
    for(const token of ['platform_evidence().android','device.has("platform")','device.get("system", null)','host_context.get("actualMode", "unknown") != "glx"','host_context.get("modeEvidence", "unknown") != "observed"','target.get_script() != null','source.transparent_bg','target.texture != source.get_texture()','target.use_parent_material','target.material != owned_material','not enabled'])need(gate.includes(token),'Compat safety gate missing: '+token);
    need(!/OS\.get_name|OS\.has_feature|if host_context\.get\("resultTrack"/.test(gate),'Compat must use cached actual Android evidence');
  }
  return {variant,pckSha256:hash(pck),sourceManifestSha256:rule.sourceManifestSha256,packedEntryCount:packed.size,checkedScripts:checked.sort(),externalHarnessExcluded:true,skipSetting:{name:SETTING,value:true,runtimeSkip:'NOT_VERIFIED'},skipOnly,compatibility:{requested:variant==='compat',scope:'One explicitly registered opaque SubViewport display; actual cached Android + observed GLX required',ios:'off',webgl:'off',phone:'not_run',rootCauseFixed:false}};
}

function replaceOne(s,old,next,label){need(s.split(old).length===2,'Absent/ambiguous '+label);return s.replace(old,()=>next);}
// Pure byte derivation, intentionally separate from the filesystem admission gate for tests.
// Call stage() for admitted packaging; a standalone derive return is not a verification receipt.
export function deriveCandidate({parentFiles,parentRecord,evidence,scene,pck,mode,stagerSha256}){
  need(['glx','webgl'].includes(mode),'Invalid requested mode');need(parentRecord.identity.mode==='glx'&&parentRecord.identity.packageId===BASELINE.packageId,'Exact GLX parent identity required');
  const a=evidence.admission,core={schema:'startup-prewarm-derived-identity-v1',mode,variant:scene.variant,provenance:'self-built',parentPackageId:BASELINE.packageId,parentManifestSha256:BASELINE.manifestSha256,parentEnginePairSha256:parentRecord.identity.enginePairSha256,enginePairSha256:a.pairSha256,librarySha256:ENGINE.librarySha256,sourcePin:a.sourcePin,patchSha256:a.patchSha256,parentBuildSha256:a.parentBuildSha256,buildRecordSha256:a.buildSha256,admissionSha256:evidence.admissionSha256,handoffSha256:evidence.handoffSha256,pckSha256:scene.pckSha256,scenePckSha256:scene.pckSha256,sceneSourceManifestSha256:scene.sourceManifestSha256,stagerSha256,prewarm:{configurationRequested:true,setting:SETTING,runtimeSkip:'NOT_VERIFIED',startupTiming:'NOT_MEASURED'},compatibility:scene.compatibility,scope:mode==='webgl'?'desktop-only-local-control':'local-only',cloudRelay:'disabled',upload:'not_uploaded',pureEnginePass:false,staticSpecifiedHostPass:true};
  need(safeText(json(core)),'Private path/AppID in candidate identity');const identity={...core,packageId:'selfbuild-no-prewarm-'+scene.variant+'-'+mode+'-'+hash(json(core)).slice(0,20)};
  const old=parentRecord.identity,files=new Map(parentFiles);files.set('engine/godot.js',evidence.outputs['godot.js']);files.set('engine/godot.wasm.br',evidence.outputs['godot.wasm.br']);files.set('engine/empty-tips.bin',pck);
  let modeText=replaceOne(files.get('candidate-mode.js').toString(),'const mode = "glx";','const mode = '+JSON.stringify(mode)+';','parent GLX mode literal');
  modeText=replaceOne(modeText,'G.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(old)+');','G.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(identity)+');','parent identity');files.set('candidate-mode.js',Buffer.from(modeText));
  files.set('candidate-relay.js',Buffer.from(replaceOne(files.get('candidate-relay.js').toString(),JSON.stringify({packageId:old.packageId,mode:'glx',cloudEnabled:false}),JSON.stringify({packageId:identity.packageId,mode,cloudEnabled:false}),'disabled relay identity')));
  for(const n of ['project.config.json','project.private.config.json']){const text=files.get(n).toString(),config=JSON.parse(text);let count=0;const next=text.replace(/("projectname"\s*:\s*)("(?:[^"\\]|\\.)*")/g,(_,prefix,value)=>{need(JSON.parse(value)===config.projectname,'Project name mismatch');count++;return prefix+JSON.stringify(identity.packageId);});need(count===1&&same({...JSON.parse(next),projectname:config.projectname},config),'Config changed beyond projectname');files.set(n,Buffer.from(next));}
  files.delete('CANDIDATE.json');const record={schema:'startup-prewarm-derived-package-v1',identity,projectname:identity.packageId,engineOutputs:a.outputs,enginePair:{sha256:a.pairSha256,brotliDecodesToWasm:true},engineIntegrity:{jsSha256:a.outputs['godot.js'].sha256,brotliSha256:a.outputs['godot.wasm.br'].sha256,decodedWasmSha256:a.outputs['godot.wasm'].sha256,decodedWasmBytes:a.outputs['godot.wasm'].bytes,brotliDecodedHashVerified:true},admission:{sha256:evidence.admissionSha256,handoffSha256:evidence.handoffSha256,buildSha256:a.buildSha256,audits:a.audits,meaning:'Hash-bound reports plus static linkage/unchanged-host recomputation; no runtime acceptance'},sceneEvidence:scene,fileManifestScope:'Every file except CANDIDATE.json',fileManifest:manifest(files),state:{runtime:'not_run',phone:'not_run',visibleRendering:'not_verified',preview:'not_uploaded',upload:'not_uploaded',cloudRelay:'disabled',pureEnginePass:false,staticSpecifiedHostPass:true,prewarmRuntimeSkip:'NOT_VERIFIED',startupTiming:'NOT_MEASURED',compatibilityPhonePass:false}};
  need(safeText(json(record)),'Private data in candidate metadata');files.set('CANDIDATE.json',Buffer.from(json(record)));verifyCandidate({files,parentFiles,record,evidence,pck,mode});return {files,record};
}
export function verifyCandidate({files,parentFiles,record,evidence,pck,mode}){
  need(['glx','webgl'].includes(mode)&&record.identity.mode===mode,'Candidate mode mismatch');need(files.size===27&&same([...files.keys()].sort(),[...parentFiles.keys()].sort()),'Exact 27-file set required');
  const changed=manifest(files).filter(x=>!files.get(x.path).equals(parentFiles.get(x.path))).map(x=>x.path);
  need(changed.every(n=>ALLOWED_PATHS.includes(n)),'Changed scope exceeds eight paths');for(const n of ALLOWED_PATHS.filter(n=>n!=='engine/godot.js'))need(changed.includes(n),'Required derived change absent: '+n);
  for(const [n,b]of files){need(cleanName(n),'Unsafe candidate path');if(!ALLOWED_PATHS.includes(n))need(b.equals(parentFiles.get(n)),'Original observer/loader/SDK/host changed');}
  need(files.get('engine/godot.js').equals(evidence.outputs['godot.js'])&&files.get('engine/godot.wasm.br').equals(evidence.outputs['godot.wasm.br'])&&files.get('engine/empty-tips.bin').equals(pck),'Candidate engine/PCK bytes differ');
  const a=evidence.admission;need(record.identity.enginePairSha256===a.pairSha256&&same(record.engineOutputs,a.outputs)&&record.identity.pureEnginePass===false&&record.state.phone==='not_run'&&record.identity.prewarm.configurationRequested===true&&record.identity.prewarm.runtimeSkip==='NOT_VERIFIED','Candidate identity/runtime claims differ');
  const text=files.get('candidate-mode.js').toString(),old=JSON.parse(parentFiles.get('CANDIDATE.json')).identity;let expected=replaceOne(parentFiles.get('candidate-mode.js').toString(),'const mode = "glx";','const mode = '+JSON.stringify(mode)+';','original mode literal');expected=replaceOne(expected,'G.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(old)+');','G.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(record.identity)+');','expected identity');need(text===expected,'Mode logic changed beyond mode/identity');need(text.includes("G.__GODOT_DISABLE_WXGLX = mode === 'webgl';"),'Original disable-mode logic missing');
  const relay=replaceOne(parentFiles.get('candidate-relay.js').toString(),JSON.stringify({packageId:old.packageId,mode:'glx',cloudEnabled:false}),JSON.stringify({packageId:record.identity.packageId,mode,cloudEnabled:false}),'expected disabled relay');need(files.get('candidate-relay.js').toString()===relay,'Relay changed beyond disabled identity');
  for(const n of ['project.config.json','project.private.config.json']){const before=JSON.parse(parentFiles.get(n)),after=JSON.parse(files.get(n));need(after.projectname===record.identity.packageId&&same({...after,projectname:before.projectname},before),'Config/AppID changed');}
  need(safeText(json(record)),'Private data in candidate metadata');const without=new Map(files);without.delete('CANDIDATE.json');need(same(manifest(without),record.fileManifest)&&files.get('CANDIDATE.json').equals(Buffer.from(json(record))),'Candidate manifest drift');
  return {changedPaths:changed.sort(),jsByteIdentical:files.get('engine/godot.js').equals(parentFiles.get('engine/godot.js'))};
}

export function stage({parent,handoff,admission,admissionSha256,scenePck,sceneSource,variant,mode,output}){
  need(['glx','webgl'].includes(mode)&&['skip-only','compat'].includes(variant),'Explicit valid mode and variant required');need(hex(admissionSha256),'Explicit admission SHA256 required');const target=plain(output);need(!fs.existsSync(target),'Output exists; refusing overwrite');
  const inputs=[parent,handoff,admission,scenePck,sceneSource].map(plain);for(const input of inputs)need(!inside(input,target)&&!inside(target,input),'Input/output overlap');
  const parentFiles=readTree(plain(parent)),parentRecord=verifyParent(parentFiles,'glx',{dir:parent,...BASELINE});
  const evidence=loadEvidence({handoff,admission,admissionSha256,parentFiles});
  // Include paths referenced by the admitted handoff in overlap checks before writing.
  const h=JSON.parse(read(handoff));for(const input of [h.buildDir,h.build.path,h.incremental.path,...h.dependencies.map(d=>d.path),...Object.values(h.audits).filter(x=>x&&typeof x==='object'&&x.path).map(x=>x.path)].map(plain))need(!inside(input,target)&&!inside(target,input),'Output overlaps exact evidence');
  const source=readTree(plain(sceneSource),{source:true}),pck=read(scenePck),scene=verifyScene({variant,pck,source,parentPck:parentFiles.get('engine/empty-tips.bin'),admission:evidence.admission});
  const derived=deriveCandidate({parentFiles,parentRecord,evidence,scene,pck,mode,stagerSha256:hash(read(self))});
  // All gates finish before output creation. Candidate itself is exactly the original 27 paths.
  fs.mkdirSync(path.dirname(target),{recursive:true});plain(target);fs.mkdirSync(target);for(const [n,b]of derived.files){const file=path.join(target,n);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b,{flag:'wx'});}
  const written=readTree(target);need(same(manifest(written),manifest(derived.files)),'Written candidate byte verification failed');const result=verifyCandidate({files:written,parentFiles,record:derived.record,evidence,pck,mode});
  return {schema:'startup-prewarm-derived-stage-receipt-v1',packageId:derived.record.identity.packageId,variant,mode,files:27,manifestSha256:hash(written.get('CANDIDATE.json')),admissionSha256,handoffSha256:evidence.handoffSha256,...result,state:derived.record.state};
}
export function parseOptions(argv){const allowed=['--parent','--handoff','--admission','--admission-sha256','--scene-pck','--scene-source','--variant','--mode','--output'],o={};for(let i=0;i<argv.length;i+=2){const k=argv[i],v=argv[i+1];need(allowed.includes(k)&&v&&!v.startsWith('--')&&!Object.hasOwn(o,k),'Nine unique explicit CLI options required');o[k]=v;}need(Object.keys(o).length===allowed.length&&hex(o['--admission-sha256']),'All nine options including pinned --admission and --admission-sha256 are mandatory');return {parent:o['--parent'],handoff:o['--handoff'],admission:o['--admission'],admissionSha256:o['--admission-sha256'],scenePck:o['--scene-pck'],sceneSource:o['--scene-source'],variant:o['--variant'],mode:o['--mode'],output:o['--output']};}
if(process.argv[1]&&path.resolve(process.argv[1])===self){try{console.log(json(stage(parseOptions(process.argv.slice(2)))));}catch(e){console.error('Exact no-prewarm staging refused: '+e.message);process.exitCode=1;}}
