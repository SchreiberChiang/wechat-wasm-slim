import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const [root,parent,assets,revision='reuse']=process.argv.slice(2);
assert(root&&parent&&assets&&['baseline','reuse'].includes(revision),'Usage: NEW_APPROVED_ROOT APPROVED_10914_RUNTIME VERIFIED_ASSET_SCENE baseline|reuse');
assert(!fs.existsSync(root),'Refuse overwriting an existing directory');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=(p,n)=>fs.readFileSync(path.join(p,n));
const delivery=JSON.parse(read(repo,'docs/evidence/GLX_LIGHTING_DELIVERY_20261103.json'));
assert.equal(sha(read(parent,'CANDIDATE.json')),delivery.frozenManifestSha256);
const old=JSON.parse(read(parent,'CANDIDATE.json'));
for(const f of old.fileManifest)assert.equal(sha(read(parent,f.path)),f.sha256,f.path);
assert.equal(old.identity.packageId,delivery.packageId);
// Self-owned text inputs live in Git. Only the licensed font, recorded reference
// images and frozen host/engine pair remain external; no old project tree needed.
const dependencies=JSON.parse(read(here,'regression19-inputs.json'));
const mappings=dependencies.repositorySources.map(row=>revision==='baseline'?(dependencies.baselineOverrides.find(x=>x.target===row.target)??row):row);
const inputs=mappings.map(row=>({path:row.target,origin:'repository',source:row.repositoryPath,sha256:row.sha256,bytes:read(repo,row.repositoryPath).length}));
for(const row of [dependencies.font,...dependencies.references])inputs.push({path:row.path,origin:'assets',source:row.path,sha256:row.sha256,bytes:row.bytes});
for(const row of inputs){const b=read(row.origin==='repository'?repo:assets,row.source);assert.equal(sha(b),row.sha256,'input '+row.path);assert.equal(b.length,row.bytes);}
const snapshot={schema:'regression19-inputs-v2',parent,parentManifestSha256:delivery.frozenManifestSha256,parentPackageId:delivery.packageId,assets,revision,sourceInputs:inputs,enginePair:delivery.enginePair,librarySha256:delivery.librarySha256,globalIdCheck:'return 0',budgetBytes:100*1048576,scope:'one scene, one runtime, references/evidence; no engine or SDK tree copy'};
fs.mkdirSync(root);
for(const d of ['scene','scene/fonts','scene/references','minigame','evidence'])fs.mkdirSync(path.join(root,d));
const write=(dest,bytes)=>{fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});};
for(const f of [...old.fileManifest,{path:'CANDIDATE.json'}])write(path.join(root,'minigame',f.path),read(parent,f.path));
for(const row of inputs)write(path.join(root,'scene',row.path),read(row.origin==='repository'?repo:assets,row.source));
write(path.join(root,'evidence/INPUTS.json'),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({root,parent:delivery.packageId,revision,copiedRuntimeBytes:old.fileManifest.reduce((n,f)=>n+f.bytes,0),sourceInputs:inputs.length,engineRebuilt:false}));
