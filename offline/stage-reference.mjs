import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PARENTS, CHANGED_PATHS, derive, hash, json, manifest, readTree, validateScene,
  verifyDerived, verifyParent} from '../engine/functional-acceptance/stage.mjs';

const [projectArg, pckArg, outputArg, write, ...extra] = process.argv.slice(2);
assert(projectArg && pckArg && outputArg && write==='--write' && !extra.length,
  'Usage: node offline/stage-reference.mjs SCENE_SOURCE STARTUP.pck NEW_OUTPUT --write');
const source = fileURLToPath(new URL('../',import.meta.url));
const samples = path.join(source,'offline/fixtures/reference-parents');
const project = fs.realpathSync(projectArg), input = fs.realpathSync(pckArg);
const output = path.resolve(outputArg);
function within(base,file){
  const rel=path.relative(base,file);
  return !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);
}
for(const location of [project,input,source]) assert(!within(location,output) && !within(output,location));
assert.equal(path.relative(fs.realpathSync(path.dirname(output)),path.dirname(output)),'');
assert(!fs.existsSync(output),'Fresh output required');
const pck = fs.readFileSync(input), sceneFiles = readTree(project,{source:true});
const scene = validateScene(pck,sceneFiles);
const stagerSha256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
function loadParent(mode){
  const data=fs.readFileSync(path.join(samples,mode+'.json'));
  assert.equal(hash(data),PARENTS[mode].manifestSha256);
  const files=new Map([['CANDIDATE.json',data]]);
  for(const entry of JSON.parse(data).fileManifest){
    assert.match(entry.sha256,/^[0-9a-f]{64}$/);
    const bytes=fs.readFileSync(path.join(samples,entry.sha256));
    assert.equal(bytes.length,entry.bytes);
    assert.equal(hash(bytes),entry.sha256);
    files.set(entry.path,bytes);
  }
  verifyParent(files,mode);
  return files;
}
const modes=['glx','webgl'], parents={}, candidates={};
for(const mode of modes){
  parents[mode]=loadParent(mode);
  candidates[mode]=derive(parents[mode],mode,pck,scene,stagerSha256);
}
assert(candidates.glx.files.get('engine/empty-tips.bin').equals(candidates.webgl.files.get('engine/empty-tips.bin')));
fs.mkdirSync(output);
const identities={};
for(const mode of modes){
  const dest=path.join(output,'candidate-'+mode), candidate=candidates[mode];
  fs.mkdirSync(dest);
  for(const [key,bytes] of candidate.files){
    const file=path.join(dest,key);
    assert(within(dest,file));
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,bytes,{flag:'wx'});
  }
  const written=readTree(dest);
  assert.deepEqual(manifest(written),manifest(candidate.files));
  verifyDerived(written,parents[mode],candidate.record);
  identities[mode]=candidate.record.identity.packageId;
}
const result={schema:'wxslim-offline-reference-stage-v1',...scene,changedPaths:CHANGED_PATHS,identities,phone:'NOT_RUN'};
fs.writeFileSync(path.join(output,'result.json'),json(result),{flag:'wx'});
console.log(JSON.stringify(result));

