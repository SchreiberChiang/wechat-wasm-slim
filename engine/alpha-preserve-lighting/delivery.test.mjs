// In-memory fixtures and optional read-only local provenance checks. No engine runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {home,repo,recipe,historical,read,sha,verifyRecipe,applyByteEdits,hostFromArchive,returnZero,prebuiltPair,rebuiltPair,checkDependencies,sources,checkPck,packageFiles,writeNew} from './delivery.mjs';
import {buildPlan} from './delivery-build.mjs';
const inputs=JSON.parse(process.env.SIMPLE_DELIVERY_INPUTS||'null');
const original='function evalCheckWxContextGlobalIdAvailable(){if(typeof Module!=="undefined"&&Module.wxContextGlobal&&typeof Module.wxContextGlobal.fetchAndIncId==="function"){return 1}return 0}';
const script=f=>read(path.join(home,f)).toString();
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
// Synthetic PCK tests exercise validation, never stand in for an editor export.
function fixturePck(extra=new Map()){
  const key=Buffer.from('application/run/main_scene'),value=Buffer.from('res://simple.tscn');
  const binary=Buffer.concat([Buffer.from('ECFG'),u32(1),u32(key.length),key,u32(value.length),value]);
  const entries=new Map([['simple.gd',sources().get('simple.gd')],['simple.tscn',sources().get('simple.tscn')],['project.binary',binary],...extra]);
  let offset=40;const data=[],table=[];
  for(const [name,b] of entries){const n=Buffer.from(name);data.push(b);table.push(u32(n.length),n,u64(offset),u64(b.length),createHash('md5').update(b).digest(),u32(0));offset+=b.length;}
  return Buffer.concat([Buffer.from('GDPC'),u32(4),Buffer.alloc(16),u64(0),u64(offset),...data,u32(entries.size),...table]);
}
function syntaxModule(bytes){const p=spawnSync(process.execPath,['--input-type=module','--check'],{input:bytes,windowsHide:true,encoding:'utf8'});assert.equal(p.status,0,p.stderr);}

test('recipe four patches, Windows transport patch and full profile hashes',()=>assert.equal(verifyRecipe().patches,4));
test('single ID change rejects duplicate application and unrelated input',()=>{
  const raw=Buffer.from('prefix;'+original+';suffix');const out=returnZero(raw);
  assert.equal(out.toString(),'prefix;function evalCheckWxContextGlobalIdAvailable(){return 0};suffix');
  assert.throws(()=>returnZero(out));assert.throws(()=>returnZero(Buffer.from(original+original)));assert.throws(()=>returnZero(Buffer.from('')));
});
test('byte transformation checks both input and output, refuses repeat',()=>{
  const before=Buffer.from('ABC'),after=Buffer.from('AB!C');const rule={beforeSha256:sha(before),afterSha256:sha(after),edits:[{start:2,end:2,removedSha256:sha(Buffer.alloc(0)),insert:'!'}]};
  assert.deepEqual(applyByteEdits(before,rule),after);assert.throws(()=>applyByteEdits(after,rule));assert.throws(()=>applyByteEdits(before,{...rule,afterSha256:'0'.repeat(64)}));
});
test('new output guard refuses existing repo without touching it',()=>assert.throws(()=>writeNew(repo,new Map()),/existing/));
test('source preparation contains one scene, no historical imports or GPU probes',()=>{
  assert.deepEqual([...sources().keys()],['simple.gd','simple.tscn','project.godot','export_presets.cfg']);
  const text=script('delivery-simple.gd');assert(!/res:\/\/(?!simple)|JavaScriptBridge\.eval|get_shader|read_pixels|RenderingServer\./.test(text));
  assert(text.includes('TRANSPARENCY_ALPHA')&&text.includes('0.48')&&text.includes('viewport.get_texture()'));
});
test('synthetic PCK accepts exact sources and rejects historical or changed resource',()=>{
  assert.equal(checkPck(fixturePck()).entries.length,3);
  assert.throws(()=>checkPck(fixturePck(new Map([['legacy.gd',Buffer.from('x')]]))),/Unexpected/);
  assert.throws(()=>checkPck(fixturePck(new Map([['simple.gd',Buffer.from('x')]]))),/source mismatch/);
});
test('build plan uses fixed semantic arguments, one checkout and safe default',()=>{
  const cfg={work:path.resolve('unused-delivery-test'),sdk:'input-sdk',python:'input-python',library:'input-library',editor:'input-editor',jobs:4};
  const plan=buildPlan(cfg);const norm=a=>a.map(x=>x.startsWith('--jobs=')?'jobs':x.startsWith('build_profile=')?'profile':x.startsWith('wx_glx_lib=')?'library':x);
  assert.deepEqual(norm(plan.sconsArgs),norm(historical.build.sconsArgs));assert.equal(plan.patches.length,5);assert(plan.noRetry&&plan.noUpload);assert(!plan.sconsArgs.some(x=>x.startsWith('cppdefines=')));
});
test('new JS entry and observer parse without executing host or engine',()=>{syntaxModule(read(path.join(home,'delivery-entry.js')));new vm.Script(script('delivery-observer.js'));});
function mockObserver(ctx){
  const logs=[];const G={__SelfbuildCandidateIdentity:{mode:'glx',packageId:'fixture'},GODOTSDK:{engine:{rtenv:{ctx}}}};
  const sandbox={GameGlobal:G,wx:{getSystemInfoSync:()=>({SDKVersion:'fixture'}),onHide:()=>{},onShow:()=>{}},console:{info:(...x)=>logs.push(['info',...x]),warn:(...x)=>logs.push(['warn',...x]),error:(...x)=>logs.push(['error',...x])}};
  vm.runInNewContext(script('delivery-observer.js'),sandbox);return {G,logs};
}
test('observer emits identity and ready once, preserves unknown/mismatch',()=>{
  const x=mockObserver({emscriptenGLX:{ctxid:1}});x.G.SimpleGlxDelivery.sceneReady();x.G.SimpleGlxDelivery.sceneReady();
  assert.equal(x.logs.filter(x=>x[1]==='[SIMPLE_ID]').length,1);assert.equal(x.logs.filter(x=>x[1]==='[SIMPLE_READY]').length,1);
  const y=mockObserver(null);assert(y.G.SimpleGlxDelivery.sceneReady().includes('MODE NOT ACCEPTED'));assert(y.logs.some(x=>x[1]==='[SIMPLE_MODE_MISMATCH]'));
});
test('mode selection refuses unsupported GLX instead of fallback (mock only)',()=>{
  const text=read(path.join(repo,'engine/assets/candidate-mode.js')).toString().replace('__CANDIDATE_MODE__','"glx"').replace('__CANDIDATE_IDENTITY__','{"packageId":"fixture"}');
  const G={};assert.throws(()=>vm.runInNewContext(text,{GameGlobal:G,wx:{env:{isSupportEmscriptenGLX:false}},console:{info(){}}}),/no fallback/);
});

test('real fixed dependencies match (read-only, no compiler/editor run)',{skip:!inputs},()=>checkDependencies(inputs));
test('real author archive produces exact host, all JS parses; wrong archive refused',{skip:!inputs},()=>{
  const archive=read(inputs.hostArchive),files=hostFromArchive(archive);assert.equal(files.size,5);for(const b of files.values())syntaxModule(b);
  const bad=Buffer.from(archive);bad[0]^=1;assert.throws(()=>hostFromArchive(bad),/fingerprint/);
});
test('real prebuilt and historical rebuild audit agree, without factory or WASM instantiation',{skip:!inputs},()=>{
  const pair=prebuiltPair(read(inputs.js),read(inputs.br)),rebuilt=rebuiltPair(inputs.build);
  assert.deepEqual(pair.js,rebuilt.js);assert.deepEqual(pair.br,rebuilt.br);assert(rebuilt.audit.imports.length>0);assert(rebuilt.audit.exports.length>0);
});
test('real host plus synthetic PCK packages in memory only; imports and historical exclusion',{skip:!inputs},()=>{
  const pair=prebuiltPair(read(inputs.js),read(inputs.br));
  const files=packageFiles({archive:read(inputs.hostArchive),pair,pck:fixturePck(),appid:'wx0000000000000000'});
  for(const [name,b] of files)if(name.endsWith('.js')){
    syntaxModule(b);
    for(const m of b.toString().matchAll(/(?:from\s*|import\s*|require\s*\()\s*['"](\.[^'"]+)['"]/g)){
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1]));assert(files.has(resolved)||files.has(resolved+'.js'),`${name} -> ${resolved}`);
    }
  }
  const config=JSON.parse(files.get('project.config.json'));assert.deepEqual(config.setting,recipe.host.compilerSettings);assert(config.setting.es6&&config.setting.enhance&&config.setting.swc&&!config.setting.disableSWC);
  assert(![...files.keys()].some(p=>/probe|cloud|autotest|reference|observer-v/.test(p)));
  assert.equal(JSON.parse(files.get('CANDIDATE.json')).identity.visual,'NOT_VERIFIED');
});
test('all patches replay exactly against pinned source, including Windows transport',{skip:!inputs},()=>{
  const result=new Map();const lf=b=>b.toString().replaceAll('\r\n','\n');
  for(const patch of [...recipe.engine.patches,recipe.engine.windowsLinkPatch])for(const section of lf(read(path.join(repo,patch.path))).split(/(?=^diff --git )/m).filter(Boolean)){
    const lines=section.split('\n'),head=/^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[0]);assert(head&&head[1]===head[2]);const name=head[1];
    if(!result.has(name))result.set(name,lines.includes('--- /dev/null')?'':lf(execFileSync('git',['--no-optional-locks','-C',inputs.source,'show',`${recipe.engine.source.commit}:${name}`],{windowsHide:true,maxBuffer:8e6})));
    const text=result.get(name),old=text?text.split('\n'):[];if(text.endsWith('\n'))old.pop();let cursor=0;const out=[];
    for(let i=1;i<lines.length;i++){
      const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);if(!h)continue;
      const start=Math.max(0,Number(h[1])-1);assert(start>=cursor&&start<=old.length);out.push(...old.slice(cursor,start));cursor=start;let removed=0,added=0;
      assert.equal(out.length,Math.max(0,Number(h[3])-1));
      while(i+1<lines.length&&/^[ +\-]/.test(lines[i+1])){const row=lines[++i];if(row[0]!=='+'){assert.equal(old[cursor++],row.slice(1));removed++;}if(row[0]!=='-'){out.push(row.slice(1));added++;}}
      assert.equal(removed,Number(h[2]??1));assert.equal(added,Number(h[4]??1));
    }
    out.push(...old.slice(cursor));result.set(name,out.join('\n')+'\n');
  }
  for(const [name,text] of result)assert.equal(lf(read(path.join(inputs.source,name))),text,name);
  assert.equal(result.size,10);
});
