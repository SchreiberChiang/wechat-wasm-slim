// Read-only preservation audit. Does not start an engine, render, stage or upload.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {unpackPck} from '../startup-prewarm/scene.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=(root,n)=>fs.readFileSync(path.join(root,n));
const json=(root,n)=>JSON.parse(read(root,n));
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();
const deps=json(here,'regression19-inputs.json');
const saved=json(repo,'docs/evidence/GLX_REGRESSION19_CLOSEOUT_20261103.json');

export function auditRepository(){
  for(const row of [...deps.repositorySources,...deps.baselineOverrides])assert.equal(sha(read(repo,row.repositoryPath)),row.sha256,row.repositoryPath);
  const catalog=json(here,'regression19-cases.json');
  assert.equal(catalog.groups.length,8);
  assert.equal(catalog.groups.flatMap(g=>g.states).length,19);
  assert.equal(deps.references.length,19);
  // Every literal res:// dependency must be in the saved source/asset contract.
  const available=new Set([...deps.repositorySources.map(x=>x.target),deps.font.path,...deps.references.map(x=>x.path)]);
  for(const row of deps.repositorySources.filter(x=>/\.(gd|tscn)$/.test(x.target))){
    for(const match of read(repo,row.repositoryPath).toString().matchAll(/res:\/\/([^"'\s]+)["']/g)){
      if(match[1]==='references/')continue; // catalog-derived nineteen paths
      assert(available.has(match[1]),'unlisted scene dependency '+match[1]);
    }
  }
  assert(!deps.repositorySources.some(x=>/native\.gd$/.test(x.target)),'desktop checker in runtime source map');
  assert.deepEqual(saved.candidates.reuse.changedPckEntries,['regression19-main.gd','regression19-renderer.gd']);
  assert.deepEqual(saved.candidates.reuse.changedRuntimePayload,['candidate-mode.js','engine/empty-tips.bin']);
  return {sourceMappings:deps.repositorySources.length,baselineSources:deps.baselineOverrides.length,states:19,references:19};
}

export function auditLocal(root){
  const ev=path.join(root,'evidence'),scene=path.join(root,'scene'),runtime=path.join(root,'minigame');
  const baseline=json(ev,'REUSE_BASELINE_20261103.json');
  const candidate=json(runtime,'CANDIDATE.json');
  assert.equal(candidate.candidateId,saved.candidates.baseline.id,'original runtime restored');
  assert.equal(sha(read(runtime,'CANDIDATE.json')),saved.candidates.baseline.manifestSha256);
  for(const f of baseline.runtime)assert.equal(sha(read(runtime,f.path)),f.sha256,'protected runtime '+f.path);
  assert.deepEqual(walk(runtime),baseline.runtime.map(f=>f.path.replaceAll('\\','/')).sort());
  for(const row of deps.repositorySources)assert.equal(sha(read(scene,row.target)),row.sha256,'current scene '+row.target);
  for(const row of [deps.font,...deps.references])assert.equal(sha(read(scene,row.path)),row.sha256,'asset '+row.path);
  for(const row of deps.baselineOverrides)assert.equal(baseline.originalSource.find(x=>x.path===row.target)?.text,read(repo,row.repositoryPath).toString());
  const oldPckBytes=read(runtime,'engine/empty-tips.bin'),nextPckBytes=read(ev,'regression19-reuse.pck');
  assert.equal(sha(oldPckBytes),saved.candidates.baseline.pckSha256);
  assert.equal(sha(nextPckBytes),saved.candidates.reuse.pckSha256);
  const oldPck=unpackPck(oldPckBytes),nextPck=unpackPck(nextPckBytes);
  assert.deepEqual([...oldPck.keys()].sort(),[...nextPck.keys()].sort());
  assert.equal(nextPck.size,saved.candidates.reuse.pckEntryCount);
  const changed=[...nextPck].filter(([n,b])=>!b.equals(oldPck.get(n))).map(([n])=>n).sort();
  assert.deepEqual(changed,saved.candidates.reuse.changedPckEntries);
  for(const row of deps.repositorySources.filter(x=>/\.(gd|gdshader|json|txt)$/.test(x.target))){
    assert(nextPck.get(row.target)?.equals(read(repo,row.repositoryPath)),'PCK source '+row.target);
  }
  for(const row of deps.baselineOverrides)assert(oldPck.get(row.target)?.equals(read(repo,row.repositoryPath)),'baseline PCK '+row.target);
  assert(![...nextPck.keys()].some(n=>/regression19-.*native/.test(n)));
  const js=read(runtime,'engine/godot.js'),br=read(runtime,'engine/godot.wasm.br');
  assert.equal(sha(js),saved.enginePair.js);assert.equal(sha(br),saved.enginePair.br);
  assert.equal(sha(brotliDecompressSync(br)),saved.enginePair.wasm);
  assert.match(js.toString(),/function _?evalCheckWxContextGlobalIdAvailable\([^)]*\)\s*\{\s*return 0;?\s*\}/);
  // The overlay exists as two prepared files; inspect it without applying it.
  const replacements={'candidate-mode.js':'reuse-candidate-mode.js','engine/empty-tips.bin':'regression19-reuse.pck'};
  for(const f of saved.candidates.reuse.fileManifest){
    const b=replacements[f.path]?read(ev,replacements[f.path]):read(runtime,f.path);
    assert.equal(sha(b),f.sha256,'prepared candidate '+f.path);assert.equal(b.length,f.bytes);
  }
  const matcher=/G\.__SelfbuildCandidateIdentity = Object\.freeze\(\{[^\n]+\}\);/;
  const a=read(runtime,'candidate-mode.js').toString(),b=read(ev,'reuse-candidate-mode.js').toString();
  assert(matcher.test(a)&&matcher.test(b));assert.equal(a.replace(matcher,'IDENTITY'),b.replace(matcher,'IDENTITY'));
  assert(b.includes(saved.candidates.reuse.id));
  const native=json(ev,'native-reuse-verify.json'),previous=json(ev,'native-verify.json');
  for(const [name,expected] of [['native-verify.json',saved.nativeReference.evidence[0]],['native-reuse-verify.json',saved.nativeReference.evidence[1]]])assert.equal(sha(read(ev,name)),expected.sha256);
  assert.deepEqual(native.failures,[]);assert.equal(native.states.length,19);assert.equal(native.repeatedTransitions.length,27);
  assert.equal(native.visualComparisons.length,38);assert(native.visualComparisons.every(x=>x.exactPixels&&x.rgbaMeanAbsoluteByteDifference===0));
  for(const x of [...native.states,...native.repeatedTransitions])assert.deepEqual(x.parameters,previous.states.find(y=>y.key===x.key)?.parameters);
  // Raw private logs stay outside Git; only allowlisted facts and hashes are saved.
  const oldReports=json(ev,'PHONE_TIMINGS_20261103.json').summaries;
  const reuseReport=json(ev,'REUSE_PHONE_TIMINGS_76b987e0.json');
  const reports=[...oldReports,reuseReport];
  for(let i=0;i<reports.length;i++){
    const report=reports[i],publicRecord=saved.phone[i],bytes=fs.readFileSync(report.file??report.source);
    assert.equal(sha(bytes),publicRecord.rawLog.sha256);assert.equal(bytes.length,publicRecord.rawLog.bytes);
    const lines=bytes.toString().split(/\r?\n/),events=[],ids=[];
    for(const line of lines){
      const m=line.match(/\[REG_(ID|OP)\]\s+(\{.*)$/);
      if(m)(m[1]==='ID'?ids:events).push(JSON.parse(m[2]));
    }
    assert(ids.length>0);const id=ids[0];
    for(const [k,v] of Object.entries(publicRecord.identity))assert.deepEqual(id[k],v,'phone identity '+k);
    const records=events.map(x=>x.record),seq=records.map(x=>x.seq);
    assert.deepEqual([seq[0],seq.at(-1)],publicRecord.sequenceRange);
    assert(seq.every((n,k)=>k===0||n===seq[k-1]+1),'REG_OP continuity');
    const ready=records.filter(x=>x.event==='state_ready');
    assert.equal(ready.length,publicRecord.transitions.length);
    assert.deepEqual([...new Set(ready.map(x=>x.state))].sort(),[...publicRecord.uniqueStates].sort());
    const warnings=lines.filter(x=>x.includes('WARNING: Image format RGBAFloat not supported by hardware, converting to RGBAHalf.'));
    assert.equal(warnings.length,4);
  }
  return {protectedRuntimeFiles:baseline.runtime.length,preparedPayloadFiles:saved.candidates.reuse.fileManifest.length,
    pckEntries:nextPck.size,changedPckEntries:changed,nativeEvidenceRechecked:true,privateRawLogsRehashed:reports.length,
    renderingOrBuildRun:false,engineInstantiated:false,filesWritten:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result={repository:auditRepository()};
  if(process.argv[2])result.local=auditLocal(process.argv[2]);
  console.log(JSON.stringify({audit:'PASS',...result},null,2));
}
