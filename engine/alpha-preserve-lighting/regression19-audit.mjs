import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [root]=process.argv.slice(2);assert(root,'ROOT');
const runtime=path.join(root,'minigame'),evidence=path.join(root,'evidence');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=(p,n)=>fs.readFileSync(path.join(p,n));
const json=(p,n)=>JSON.parse(read(p,n));
const c=json(runtime,'CANDIDATE.json'),i=json(evidence,'INPUTS.json'),parent=json(i.parent,'CANDIDATE.json');
assert.equal(c.candidateId,c.identity.packageId);
assert.equal(c.identity.parentPackageId,i.parentPackageId);
for(const f of c.fileManifest)assert.equal(sha(read(runtime,f.path)),f.sha256,'candidate '+f.path);
for(const f of parent.fileManifest)assert.equal(sha(read(i.parent,f.path)),f.sha256,'parent '+f.path);
assert.equal(sha(read(i.parent,'CANDIDATE.json')),i.parentManifestSha256);
for(const f of i.sourceInputs){
 const inputRoot=f.origin==='repository'?repo:f.origin==='assets'?i.assets:i.baseline;
 assert.equal(sha(read(inputRoot,f.source??f.path)),f.sha256,'scene input '+f.path);
}
const source=json(evidence,'SOURCE_MANIFEST.json');assert.equal(source.sha256,c.identity.sceneSourceManifestSha256);
for(const f of source.files)assert.equal(sha(read(path.join(root,'scene'),f.path)),f.sha256,'source '+f.path);
assert.equal(sha(read(runtime,'engine/godot.js')),c.enginePair.js);
const wasm=brotliDecompressSync(read(runtime,'engine/godot.wasm.br'));
assert.equal(sha(wasm),c.enginePair.wasm);assert(WebAssembly.validate(wasm));
assert.equal(sha(read(runtime,'engine/godot.wasm.br')),c.enginePair.br);
assert.equal(sha(JSON.stringify([c.enginePair.js,c.enginePair.wasm,c.enginePair.br])),c.enginePair.sha256);
assert.equal(c.identity.librarySha256,i.librarySha256);
const syntax=[];
for(const f of c.fileManifest.filter(f=>f.path.endsWith('.js'))){
 const r=spawnSync(process.execPath,['--check',path.join(runtime,f.path)],{encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0,`${f.path}: ${r.stderr}`);syntax.push(f.path);
}
const modeCode=read(runtime,'candidate-mode.js').toString();assert(modeCode.includes(JSON.stringify(c.identity)));
assert(modeCode.includes('no fallback allowed'));assert(modeCode.includes("G.__GODOT_DISABLE_WXGLX = mode === 'webgl'"));
for(const n of ['project.config.json','project.private.config.json']){const a=json(runtime,n),b=json(i.parent,n);delete a.projectname;delete b.projectname;assert.deepEqual(a,b,'config change beyond display name');}
// Transport-only unit check: no factory/context creation, no GL API mocked or invoked.
const calls=[];const out={log(...a){calls.push(['log',...a]);},error(...a){calls.push(['error',...a]);},warn(...a){calls.push(['warn',...a]);}};
const rawError=out.error,rawWarn=out.warn;
const G={__SelfbuildCandidateIdentity:c.identity,__SelfbuildPhoneEvidence:{sessionTag:'offline-transport-only',device:{SDKVersion:'fixture'}},GODOTSDK:{engine:{rtenv:{ctx:{}}}}};
vm.runInNewContext(read(runtime,'regression-host.js').toString(),{GameGlobal:G,console:out,Date});
const event={event:'fixture',values:[true,false,null,0,0.48],status:'unknown'};
out.log('[GLX_REGRESSION] '+JSON.stringify(event));out.log('[GLX_REGRESSION] '+JSON.stringify(event));
assert.equal(calls.filter(x=>x[1].startsWith('[REG_ID]')).length,1);
const ops=calls.filter(x=>x[1].startsWith('[REG_OP]'));assert.equal(ops.length,2);
for(const x of ops)assert.deepEqual(JSON.parse(x[1].slice('[REG_OP] '.length)).record,event);
assert.equal(out.warn,rawWarn);assert.equal(out.error,rawError);
out.log('[GLX_REGRESSION] malformed');assert(calls.some(x=>x[0]==='error'&&x[1].startsWith('[REG_LOG_ERROR]')));
const native=json(evidence,'native-verify.json');assert.deepEqual(native.failures,[]);assert.equal(native.states.length,19);
const engineModule=new WebAssembly.Module(wasm); // Static compile/inspection only; never instantiate.
const imports=WebAssembly.Module.imports(engineModule),exports=WebAssembly.Module.exports(engineModule);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);
const size=walk(root).reduce((n,f)=>n+fs.statSync(f).size,0);assert(size<i.budgetBytes,'approved disk ceiling');
const report={schema:'regression19-audit-v1',candidateId:c.candidateId,mode:c.identity.mode,enginePair:c.enginePair,sourceManifestSha256:source.sha256,pckSha256:c.identity.pckSha256,syntaxFiles:syntax,imports,exports,wasmInstantiated:false,parentPayloadUnchanged:true,oldSceneInputsUnchanged:true,configOnlyDisplayNamesChanged:true,logTransport:'unit check only; not rendering proof',nativeStructure:{states:19,failures:[],renderer:native.renderingMethod,engine:native.engine},newDirectoryBytesBeforeReport:size,phone:'NOT_RUN',upload:'NOT_UPLOADED',runtimeWarningsNotSuppressed:true};
fs.writeFileSync(path.join(evidence,'AUDIT-'+c.identity.mode+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidateId:c.candidateId,syntaxFiles:syntax.length,imports:imports.length,exports:exports.length,nativeStates:19,newDirectoryMiB:size/1048576,phone:'NOT_RUN',audit:'PASS'}));
