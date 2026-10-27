import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {BASELINE,PINS,ALLOWED_PATHS,validateAdmission,verifyBytes,verifyReportFacts,loadEvidence,verifyScene,deriveCandidate,verifyCandidate,stage,parseOptions} from './stage-derived.mjs';
import {hash,json,manifest,ENGINE} from '../functional-acceptance/stage.mjs';

const SETTING='startup/gles3/skip_default_3d_prewarm',digest=s=>hash(Buffer.from(s));
const callbackNames=['_glxInit','_glxInitBufferDataAndGlState','_glxUpdateContextId','_glxCommandBufferFlush','_glCompressedTexImage2D','_glCompressedTexSubImage2D','_glTexImage2D','_glTexStorage2D','_glTexSubImage2D','_glxGetBoundTexture2D','_glxIsTexture','_glxPushBindTexture','_glxPushTexImage2DPlaceholder'];
const fid=(s)=>({bytes:Buffer.byteLength(s),sha256:digest(s)}),clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  const outputs={'godot.js':Buffer.from('new engine JS'), 'godot.wasm':Buffer.from('new engine WASM'), 'godot.wasm.br':Buffer.from('new compressed WASM')};
  const ids=Object.fromEntries(Object.entries(outputs).map(([n,b])=>[n,{bytes:b.length,sha256:hash(b)}]));
  const a={schema:'startup-prewarm-derived-admission-v1',...PINS,parent:{...BASELINE},handoffSha256:digest('handoff'),buildSha256:digest('build'),incrementalSha256:digest('incremental'),buildIdentitySha256:digest('{}'),buildStageSha256:digest('{}'),outputs:ids,pairSha256:hash(JSON.stringify(ids)),sconsArgsSha256:'',audits:{pairSha256:digest('pair'),abiSha256:digest('abi'),linkageSha256:digest('linkage'),diagnosticAbiChecks:3},dependencies:['incremental.mjs','patch.mjs','skip-default-3d-prewarm.patch','finalize.mjs','build.mjs','stage.mjs','audit-pair.mjs','audit-diagnostic-abi.cjs','audit-linkage.cjs'].map(name=>({name,...fid(name)})),sourceChanges:['drivers/gles3/rasterizer_scene_gles3.cpp','main/main.cpp'].map(p=>({path:p,beforeSha256:digest('before '+p),afterSha256:digest('after '+p)})),scenes:{'skip-only':{pckSha256:digest('pck'),sourceManifestSha256:digest('source')},compat:{pckSha256:digest('compat pck'),sourceManifestSha256:digest('compat source')}}};
  const args=['optimize=size','lto=thin','--jobs=4','linkflags=--emit-symbol-map -Wl,--thinlto-jobs=2'];a.sconsArgsSha256=hash(JSON.stringify(args));
  const build={schema:'startup-prewarm-incremental-build-v1',finishedAt:'test',parentBuildSha256:PINS.parentBuildSha256,initialization:{status:'complete'},identity:{pin:PINS.sourcePin},stage:{a:1},outputs:ids,pairing:{sha256:a.pairSha256},sconsArgs:args};a.buildIdentitySha256=hash(JSON.stringify(build.identity));a.buildStageSha256=hash(JSON.stringify(build.stage));
  const checks=[{name:'source',pass:true},{name:'ABI',pass:true},{name:'frame',pass:true}];
  const pair={schema:'wxslim-selfbuild-pair-static-v1',outputs:ids,sourcePin:PINS.sourcePin,imports:Array.from({length:774},(_,i)=>({module:'a',name:'i'+i,kind:'function'})),exports:Array.from({length:43},(_,i)=>({name:'e'+i,kind:'function'})),initialization:'not_run',phone:'not_run',submission:{a:true,b:true,c:true},nativeMapping:Object.fromEntries(callbackNames.slice(0,4).map((n,i)=>[n,'e'+i]))};
  const abi={schema:'wxslim-official-glx-026e-diagnostic-abi-static-v1',buildRecordSha256:a.buildSha256,pass:true,checks,importCount:774,exportCount:43,sourcePin:PINS.sourcePin,artifacts:{js:ids['godot.js'],wasm:ids['godot.wasm'],br:ids['godot.wasm.br']},library:{actualMatches:true,actual:{sha256:ENGINE.librarySha256}}};
  const resolved=Array.from({length:774},(_,i)=>({module:'a',name:'i'+i,resolved:i!==0,reason:i===0?'unbound nowPolyfill':null}));
  const linkage={schema:'official-glx-final-linkage-v1',buildMetadataSha256:a.buildSha256,pureEnginePass:false,pass:false,audit:{pass:false,importCount:774,exportCount:43,jsSha256:ids['godot.js'].sha256,wasmSha256:ids['godot.wasm'].sha256,wasmImportObjectCount:1,resolvedImports:resolved,exports:pair.exports,missingLinkPlaceholders:[],allPlaceholderDefinitions:[],linkWarnings:[],callbacks:callbackNames.map(name=>({name,pass:true}))},host:{...BASELINE,symbol:'nowPolyfill',staticContractPass:true,checks},hostClosure:{pureEnginePass:false,staticSpecifiedHostPass:true,imports:resolved.map(x=>({module:x.module,name:x.name,engineOnlyResolved:x.resolved,resolvedWithSpecifiedHost:true,hostSymbol:x.resolved?null:'nowPolyfill'}))},boundaries:{targetJsExecuted:false,wasmInstantiated:false,phoneAccess:false}};
  linkage.baseline={audit:{jsSha256:ENGINE.jsSha256,wasmSha256:ENGINE.wasmSha256,resolvedImports:clone(resolved)},hostClosure:{staticSpecifiedHostPass:true}};
  const summary={pair:{path:'pair.json',sha256:a.audits.pairSha256},abi:{path:'abi.json',sha256:a.audits.abiSha256},linkage:{path:'linkage.json',sha256:a.audits.linkageSha256},diagnosticAbiPass:true,diagnosticAbiChecks:3,importCount:774,exportCount:43,pureEnginePass:false,staticSpecifiedHostPass:true,hostManifestSha256:BASELINE.manifestSha256,missingLinkPlaceholders:0,allPlaceholderDefinitions:0,linkWarnings:0};
  const incremental={phase:'static-audited',parentPreservation:true,sourceTestsPass:true,events:[{code:0,timedOut:false},{code:0,timedOut:false},{code:0,timedOut:false}],outputs:ids,pairing:{sha256:a.pairSha256},raw:{postprocessCount:1},sconsArgs:args};
  const h={schema:'startup-prewarm-exact-build-handoff-v1',parentBuildSha256:a.parentBuildSha256,patchSha256:a.patchSha256,runtime:'not_run',phone:'not_run',upload:'not_uploaded',build:{sha256:a.buildSha256},incremental:{sha256:a.incrementalSha256},buildIdentitySha256:a.buildIdentitySha256,buildStageSha256:a.buildStageSha256,outputs:ids,pairSha256:a.pairSha256,raw:{postprocessCount:1},sconsArgs:args,host:{...BASELINE,files:Array(27).fill({})},audits:summary};
  return {admission:a,handoff:h,build,incremental,pair,abi,linkage,outputs};
}

test('admission is exact, explicit, path-free and hash-bound',()=>{
  const f=fixture();assert.equal(validateAdmission(f.admission),f.admission);
  for(const edit of [a=>a.parent.packageId='other',a=>a.patchSha256=digest('other'),a=>a.outputs['extra.bin']=fid('extra'),a=>a.dependencies.pop(),a=>a.sourceChanges.pop(),a=>a.scenes.compat.pckSha256='pending',a=>a.privatePath='C:/private/build',a=>a.audits.abiSha256='']){const a=clone(f.admission);edit(a);assert.throws(()=>validateAdmission(a));}
  assert.deepEqual(verifyBytes(Buffer.from('source'),fid('source'),'test'),Buffer.from('source'));
  assert.throws(()=>verifyBytes(Buffer.from('drift'),fid('source'),'test'),/drift/);
});

test('reports must prove facts, including original unresolved clock and exact host closure',()=>{
  const f=fixture();assert.equal(verifyReportFacts(f).pureEnginePass,false);
  const mutations=[
    x=>x.handoff.raw.postprocessCount=2,x=>x.build.identity.pin='other',x=>x.handoff.host.packageId='other',
    x=>x.handoff.audits.diagnosticAbiPass=false,x=>x.handoff.audits.importCount=773,x=>x.incremental.events[0].timedOut=true,
    x=>x.pair.nativeMapping._glxInit='absent',x=>x.pair.submission.a=false,x=>x.abi.checks[0].pass=false,
    x=>x.abi.artifacts.wasm.sha256=digest('wrong'),x=>x.linkage.audit.resolvedImports[0].reason='missing object property',
    x=>x.linkage.audit.resolvedImports[1].resolved=false,x=>x.linkage.audit.missingLinkPlaceholders.push({name:'missing'}),
    x=>x.linkage.audit.allPlaceholderDefinitions.push({name:'empty-replacement'}),x=>x.linkage.audit.linkWarnings.push({line:'warning'}),
    x=>x.linkage.audit.callbacks[0].pass=false,x=>x.linkage.host.staticContractPass=false,
    x=>x.linkage.hostClosure.imports[0].hostSymbol='fabricatedReplacement',x=>x.linkage.hostClosure.imports[1].resolvedWithSpecifiedHost=false,
    x=>x.linkage.pureEnginePass=true,x=>x.linkage.boundaries.targetJsExecuted=true,x=>x.linkage.baseline=null,
    x=>x.linkage.baseline.audit.resolvedImports[0].reason='new unresolved dependency'
  ];
  for(const mutate of mutations){const x=clone(f);mutate(x);assert.throws(()=>verifyReportFacts(x));}
});

function config(entries){const parts=[Buffer.from('ECFG')],count=Buffer.alloc(4);count.writeUInt32LE(entries.length);parts.push(count);for(const [name,value]of entries){const n=Buffer.from(name),len=Buffer.alloc(4),size=Buffer.alloc(4);len.writeUInt32LE(n.length);size.writeUInt32LE(value.length);parts.push(len,n,size,value);}return Buffer.concat(parts);}
function pck(files){const parts=[],header=Buffer.alloc(40),count=Buffer.alloc(4);header.write('GDPC');header.writeUInt32LE(4,4);header.writeBigUInt64LE(40n,32);count.writeUInt32LE(files.size);let directoryBytes=4;for(const [n]of files)directoryBytes+=4+Buffer.byteLength(n)+8+8+16+4;const base=40+directoryBytes;header.writeBigUInt64LE(BigInt(base),24);let offset=0;const payload=[];for(const [n,b]of files){const name=Buffer.from(n),row=Buffer.alloc(4+name.length+8+8+16+4);row.writeUInt32LE(name.length);name.copy(row,4);let i=4+name.length;row.writeBigUInt64LE(BigInt(offset),i);i+=8;row.writeBigUInt64LE(BigInt(b.length),i);i+=8;crypto.createHash('md5').update(b).digest().copy(row,i);parts.push(row);payload.push(b);offset+=b.length;}return Buffer.concat([header,count,...parts,...payload]);}
const bool=b=>{const x=Buffer.alloc(8);x.writeUInt32LE(1);x.writeUInt32LE(b?1:0,4);return x;};
function scenes(variant='skip-only'){
  const source=new Map(['main.gd','renderer.gd','renderer_base.gd','renderer_round3.gd'].map(n=>[n,Buffer.from('extends Node\n# '+n)]));source.set('project.godot',Buffer.from('[rendering]\n[ startup ]\n[startup]\ngles3/skip_default_3d_prewarm=true\n'));
  if(variant==='compat'){source.set('opaque_viewport_compat.gd',Buffer.from(['platform_evidence().android','device.has("platform")','device.get("system", null)','host_context.get("actualMode", "unknown") != "glx"','host_context.get("modeEvidence", "unknown") != "observed"','target.get_script() != null','source.transparent_bg','target.texture != source.get_texture()','target.use_parent_material','target.material != owned_material','not enabled'].join('\n')));source.set('opaque_viewport_mix.gdshader',Buffer.from('shader_type canvas_item;'));}
  const packed=new Map([...source].filter(([n])=>n!=='project.godot')),oldProps=[['ordinary',bool(false)]];packed.set('project.binary',config(oldProps));const before=pck(packed);packed.set('project.binary',config([...oldProps,[SETTING,bool(true)]]));const after=pck(packed),a=fixture().admission;a.scenes[variant]={pckSha256:hash(after),sourceManifestSha256:hash(json(manifest(source)))};return {source,packed,parentPck:before,pck:after,variant,admission:a};
}
test('skip-only compares every original PCK entry/property and source-packed scripts',()=>{
  const x=scenes();const r=verifyScene(x);assert.equal(r.skipOnly.allOtherEntriesAndPropertiesIdentical,true);assert.equal(r.skipSetting.runtimeSkip,'NOT_VERIFIED');
  const bad=scenes();bad.source.set('renderer.gd',Buffer.from('changed'));bad.admission.scenes['skip-only'].sourceManifestSha256=hash(json(manifest(bad.source)));assert.throws(()=>verifyScene(bad),/Packed script/);
  const falseFlag=scenes();falseFlag.packed.set('project.binary',config([['ordinary',bool(false)],[SETTING,bool(false)]]));falseFlag.pck=pck(falseFlag.packed);falseFlag.admission.scenes['skip-only'].pckSha256=hash(falseFlag.pck);assert.throws(()=>verifyScene(falseFlag),/bool true/);
  const extra=scenes();extra.packed.set('unrelated.txt',Buffer.from('added'));extra.pck=pck(extra.packed);extra.admission.scenes['skip-only'].pckSha256=hash(extra.pck);assert.throws(()=>verifyScene(extra),/entry set/);
});
test('compat is hash-pinned, gated to cached actual Android GLX, harness excluded',()=>{
  const x=scenes('compat');assert.equal(verifyScene(x).compatibility.ios,'off');
  const bad=scenes('compat');bad.source.set('opaque_viewport_compat.gd',Buffer.from('OS.get_name()'));bad.packed.set('opaque_viewport_compat.gd',bad.source.get('opaque_viewport_compat.gd'));bad.pck=pck(bad.packed);bad.admission.scenes.compat={pckSha256:hash(bad.pck),sourceManifestSha256:hash(json(manifest(bad.source)))};assert.throws(()=>verifyScene(bad),/safety gate/);
  const harness=scenes('compat');harness.packed.set('compat_gate_verify.gd',Buffer.from('extends SceneTree'));harness.pck=pck(harness.packed);harness.admission.scenes.compat.pckSha256=hash(harness.pck);assert.throws(()=>verifyScene(harness),/harness/);
});

function deriveFixture(mode='glx',sameJs=false){
  const f=fixture(),s=scenes(),scene=verifyScene(s),identity={packageId:BASELINE.packageId,mode:'glx',enginePairSha256:digest('old pair')};const parentRecord={identity};
  const modeScript='(function(){ const G=globalThis; const mode = "glx";\nG.__SelfbuildCandidateIdentity = Object.freeze('+JSON.stringify(identity)+');\nif(mode===\'glx\'&&wx.env.isSupportEmscriptenGLX!==true) throw Error("no fallback");\nG.__GODOT_DISABLE_WXGLX = mode === \'webgl\'; })();';
  const files=new Map([['CANDIDATE.json',Buffer.from(json(parentRecord))],['candidate-mode.js',Buffer.from(modeScript)],['candidate-relay.js',Buffer.from(JSON.stringify({packageId:BASELINE.packageId,mode:'glx',cloudEnabled:false}))],['engine/empty-tips.bin',s.parentPck],['engine/godot.js',sameJs?f.outputs['godot.js']:Buffer.from('old JS')],['engine/godot.wasm.br',Buffer.from('old BR')],['project.config.json',Buffer.from('{"projectname":"parent","appid":"preserve-project-identifier"}')],['project.private.config.json',Buffer.from('{"projectname":"parent","setting":{"x":1}}')]]);
  for(let i=0;files.size<27;i++)files.set('unchanged/host-'+i+'.js',Buffer.from('unchanged host '+i));
  const evidence={admission:f.admission,admissionSha256:digest('admission'),handoffSha256:digest('handoff'),outputs:f.outputs};evidence.admission.scenes=s.admission.scenes;const args={parentFiles:files,parentRecord,evidence,scene,pck:s.pck,mode,stagerSha256:digest('stager')};return {args,...deriveCandidate(args)};
}
test('derived scope is eight exact paths, all other 19 byte-identical, AppID/config retained',()=>{
  const x=deriveFixture();const r=verifyCandidate({...x.args,files:x.files,record:x.record});assert.deepEqual(r.changedPaths,ALLOWED_PATHS);assert.equal(x.record.identity.provenance,'self-built');assert.equal(x.record.identity.pureEnginePass,false);assert.equal(x.record.identity.prewarm.runtimeSkip,'NOT_VERIFIED');assert.equal(x.record.state.compatibilityPhonePass,false);
  assert(!json(x.record).includes('preserve-project-identifier'));
  const bad=new Map(x.files);bad.set('unchanged/host-0.js',Buffer.from('changed'));assert.throws(()=>verifyCandidate({...x.args,files:bad,record:x.record}),/scope/);
  const badConfig=new Map(x.files);badConfig.set('project.config.json',Buffer.from('{"projectname":"x","appid":"altered"}'));assert.throws(()=>verifyCandidate({...x.args,files:badConfig,record:x.record}),/Config/);
  const relay=new Map(x.files);relay.set('candidate-relay.js',Buffer.from('console.log("changed")'));assert.throws(()=>verifyCandidate({...x.args,files:relay,record:x.record}),/Relay/);
  assert.equal(verifyCandidate({...deriveFixture('glx',true).args,files:deriveFixture('glx',true).files,record:deriveFixture('glx',true).record}).jsByteIdentical,true);
});
test('mode selection changes original literal only; GLX fail-closed, WebGL control stays explicit',()=>{
  for(const mode of ['glx','webgl']){const x=deriveFixture(mode);const sandbox={wx:{env:{isSupportEmscriptenGLX:true}}};vm.runInNewContext(x.files.get('candidate-mode.js').toString(),sandbox);assert.equal(sandbox.__GODOT_DISABLE_WXGLX,mode==='webgl');assert.equal(sandbox.__SelfbuildCandidateIdentity.mode,mode);}
  const x=deriveFixture('glx');assert.throws(()=>vm.runInNewContext(x.files.get('candidate-mode.js').toString(),{wx:{env:{isSupportEmscriptenGLX:false}}}),/no fallback/);
  assert.throws(()=>deriveCandidate({...x.args,mode:'automatic'}),/mode/);
  const changed=new Map(x.files);changed.set('candidate-mode.js',Buffer.from(changed.get('candidate-mode.js').toString().replace("mode === 'webgl'","false")));assert.throws(()=>verifyCandidate({...x.args,files:changed,record:x.record}),/Mode logic/);
});
test('explicit admission/expected hash and nonexisting output are mandatory before writes',t=>{
  assert.throws(()=>parseOptions([]),/mandatory/);assert.throws(()=>parseOptions(['--admission','x','--admission-sha256','PENDING']),/mandatory/);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'exact-derived-test-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));const f=fixture(),admission=path.join(temp,'admission.json');fs.writeFileSync(admission,json(f.admission));
  assert.throws(()=>loadEvidence({admission,admissionSha256:digest('wrong'),handoff:'not-read',parentFiles:new Map()}),/Admission SHA256/);
  assert.throws(()=>loadEvidence({admission,admissionSha256:hash(fs.readFileSync(admission)),handoff:admission,parentFiles:new Map()}),/Handoff SHA256/);
  fs.writeFileSync(path.join(temp,'sentinel'),'preserve');assert.throws(()=>stage({mode:'glx',variant:'skip-only',admissionSha256:digest('admission'),output:temp}),/Output exists/);assert.equal(fs.readFileSync(path.join(temp,'sentinel'),'utf8'),'preserve');
});
