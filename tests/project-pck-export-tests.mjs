// Tiny file/child models only. No Godot, SDK, WeChat, project copy or upload.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createProjectPckExporter,projectPckExportTesting as internals} from '../lib/project-pck-export.mjs';
import {createTaskService,taskPlanIdentity} from '../lib/task-core.mjs';
import {assessCapability} from '../lib/capabilities.mjs';
const M=1024*1024,sha=b=>createHash('sha256').update(b).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const read=file=>JSON.parse(fs.readFileSync(file));
const preset='[preset.0]\nname="Web"\nplatform="Web"\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nencrypt_pck=false\nencrypt_directory=false\n[preset.0.options]\n';
function pck(){
  const name=Buffer.from('project.binary'),data=Buffer.from('MODEL_NOT_REAL_SETTINGS'),pad=Math.ceil(name.length/4)*4,start=113,end=start+data.length+7;
  const b=Buffer.alloc(end+4+40+pad);b.write('GDPC');b.writeUInt32LE(4,4);[4,7,2].forEach((n,i)=>b.writeUInt32LE(n,8+4*i));
  b.writeBigUInt64LE(BigInt(start),24);b.writeBigUInt64LE(BigInt(end),32);b.writeUInt32LE(1,end);let at=end+4;b.writeUInt32LE(pad,at);at+=4;name.copy(b,at);at+=pad;
  b.writeBigUInt64LE(0n,at);b.writeBigUInt64LE(BigInt(data.length),at+8);createHash('md5').update(data).digest().copy(b,at+16);data.copy(b,start);return b;
}
function fixture(t){
  const temp=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'wxslim-pck-export-model-'));
  t.after(()=>{const actual=fs.realpathSync(root);assert.equal(path.dirname(actual),temp);assert(path.basename(actual).startsWith('wxslim-pck-export-model-'));fs.rmSync(actual,{recursive:true});});
  const project=path.join(root,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n');fs.writeFileSync(path.join(project,'export_presets.cfg'),preset);fs.writeFileSync(path.join(project,'boot.gd'),'extends Node\n');fs.writeFileSync(path.join(project,'tile.png'),'MODEL_IMAGE');
  const editor=path.join(root,'fixed-editor.exe');fs.writeFileSync(editor,'MODEL_NOT_EXECUTABLE');
  const file=path.join(root,'input.json'),requestFile=path.join(root,'request.json'),output=path.join(root,'task');
  const config={schema:'wxslim-project-pck-export-v1',editor:'fixed-editor.exe',project:'project',preset:'Web',output:'task',budgetBytes:8*M,cacheGrowthBudgetBytes:M,allowImportWrites:true};
  const request={schema:'wxslim-task-request-v1',action:'project-pck-export',configFile:'input.json',purpose:'development-test'};write(file,config);write(requestFile,request);
  const editorIdentity={version:'4.7.2.stable.steam.ed1daf0bf',sha256:sha(fs.readFileSync(editor))};
  const prepare=file=>internals.buildPlan(file,{editorIdentity});
  let calls=0;
  const run=async options=>{calls++;assert.equal(options.executable,editor);assert.equal(options.cwd,project);assert.deepEqual(options.args,['--headless','--path',project,'--export-pack','Web',path.join(output,'full.pck')]);
    fs.writeFileSync(options.stdoutPath,'Godot model warning retained\n');fs.writeFileSync(options.stderrPath,'WARNING: model diagnostic\n');fs.writeFileSync(path.join(output,'full.pck'),pck());
    return {closed:true,outcome:'SUCCESS',exitCode:0,signal:null,pid:123,observationTimedOut:false};};
  const executor=(changes={})=>createProjectPckExporter({prepare,runChild:run,freeMemory:()=>4*2**30,totalMemory:()=>8*2**30,availableSpace:()=>100n*1024n**3n,...changes});
  const service=(changes={})=>createTaskService({prepareExport:prepare,executeExport:executor(changes)});
  return {root,project,editor,file,requestFile,output,config,request,prepare:()=>prepare(file),executor,service,run,calls:()=>calls};
}
test('plan binds fixed editor, selected preset, full project and tool inputs without creating output',t=>{
  const f=fixture(t),p=f.service().plan(f.requestFile);assert(p.eligible);assert.equal(p.identityScope,'PROJECT_SNAPSHOT_NOT_EXPORTED_OR_GAME_PACKAGE');assert.equal(p.plan.project.files.length,4);
  assert.equal(p.plan.implementation.length,6);assert.equal(p.importWrites,'EXPLICITLY_ACKNOWLEDGED');assert.equal(p.plan.engineBuild,false);assert.equal(p.executionAuthorized,false);assert(!fs.existsSync(f.output));
});
test('export model writes durable audit, logs, stages, terminal and status with no runtime admission',async t=>{
  const f=fixture(t),s=f.service(),plan=s.plan(f.requestFile),r=await s.execute(f.requestFile,{write:true,expectedPlanSha256:taskPlanIdentity(plan)});
  assert.equal(r.status,'SUCCESS');assert.equal(f.calls(),1);assert.equal(r.admission,'NOT_ADMITTED');assert.equal(r.packageId,null);assert.equal(r.phases[0].exitCode,0);
  const audit=read(path.join(f.output,'AUDIT.json'));assert.equal(audit.pck.sha256,sha(pck()));assert.equal(audit.sourceFilesUnchanged,true);assert.equal(audit.engineRun,'NOT_RUN');assert.equal(audit.dependencies,'NOT_SCANNED');
  assert.match(fs.readFileSync(path.join(f.output,'logs/EXPORT.stderr.log'),'utf8'),/WARNING:/);
  const status=s.status(f.requestFile,{root:f.output,taskId:r.taskId});assert.equal(status.status,'SUCCESS');assert.equal(status.inputBinding,'MATCHED_EXECUTION_SNAPSHOT');assert.equal(status.processLiveness,'NOT_OBSERVED');
  const cancel=s.cancel(f.requestFile,{root:f.output,taskId:r.taskId,write:true});assert.equal(cancel.cancel.alreadyEnded,true);assert(!fs.existsSync(path.join(f.output,'cancel.json')));
  await assert.rejects(()=>s.execute(f.requestFile,{write:true}),{code:'PCK_EXPORT_OUTPUT_EXISTS'});assert.equal(f.calls(),1);
});
test('normal new import/uid sidecars and bounded cache are recorded without allowing existing source changes',async t=>{
  const f=fixture(t),r=await f.service({runChild:async o=>{const result=await f.run(o);fs.writeFileSync(path.join(f.project,'tile.png.import'),'model');fs.writeFileSync(path.join(f.project,'boot.gd.uid'),'uid://model');fs.mkdirSync(path.join(f.project,'.godot'));fs.writeFileSync(path.join(f.project,'.godot/import-cache'),'CACHE');return result;}}).execute(f.requestFile,{write:true});
  assert.equal(r.status,'SUCCESS');const audit=read(path.join(f.output,'AUDIT.json'));assert.equal(audit.generatedSidecars.length,2);assert.equal(audit.cacheBeforeBytes,0);assert.equal(audit.cacheAfterBytes,5);
});
test('wrong editor, preset selection/encryption and unacknowledged import writes fail before output',t=>{
  const f=fixture(t);for(const change of [c=>c.allowImportWrites=false,c=>c.preset='Absent',c=>c.arbitraryCommand='unsafe']){const c=structuredClone(f.config);change(c);write(f.file,c);assert.throws(()=>f.prepare());assert(!fs.existsSync(f.output));}
  write(f.file,f.config);
  for(const text of [preset.replace('all_resources','selected_resources'),preset.replace('encrypt_pck=false','encrypt_pck=true'),preset.replace('platform="Web"','platform="Windows Desktop"'),preset+'[preset.0]\nname="Web"\n']){fs.writeFileSync(path.join(f.project,'export_presets.cfg'),text);assert.throws(()=>f.prepare());}
  fs.writeFileSync(path.join(f.project,'export_presets.cfg'),preset);fs.appendFileSync(f.editor,'changed');assert.throws(()=>f.prepare(),{code:'PCK_EXPORT_EDITOR_PIN'});assert.equal(f.calls(),0);
});
test('existing include/exclude filters are preserved and disclosed, not removed to obtain acceptance',async t=>{
  const f=fixture(t),file=path.join(f.project,'export_presets.cfg'),text=preset.replace('include_filter=""','include_filter="*.csv"').replace('exclude_filter=""','exclude_filter="*.md,*.log,*.json"');fs.writeFileSync(file,text);
  const s=f.service(),p=s.plan(f.requestFile);assert.equal(p.plan.preset.excludeFilter,'*.md,*.log,*.json');assert.equal(p.plan.preset.includeFilter,'*.csv');
  const r=await s.execute(f.requestFile,{write:true});assert.equal(r.status,'SUCCESS');assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(read(path.join(f.output,'AUDIT.json')).dependencies,'NOT_SCANNED');
});
test('output inside source or input and existing output are refused without overwriting',t=>{
  const f=fixture(t);for(const output of ['project/output','project','fixed-editor.exe']){write(f.file,{...f.config,output});assert.throws(()=>f.prepare());}
  write(f.file,f.config);fs.mkdirSync(f.output);fs.writeFileSync(path.join(f.output,'retain'),'sentinel');assert.throws(()=>f.prepare(),{code:'PCK_EXPORT_OUTPUT_EXISTS'});assert.equal(fs.readFileSync(path.join(f.output,'retain'),'utf8'),'sentinel');
});
test('no write, inspection and supported-use cannot start export or claim inherited rendering evidence',async t=>{
  const f=fixture(t),s=f.service();await assert.rejects(()=>s.execute(f.requestFile),{code:'TASK_WRITE_REQUIRED'});
  for(const purpose of ['inspect','supported-use']){write(f.requestFile,{...f.request,purpose});await assert.rejects(()=>s.execute(f.requestFile,{write:true}),{code:'TASK_CAPABILITY_DENIED'});}
  assert.equal(f.calls(),0);assert(!fs.existsSync(f.output));assert.equal(assessCapability({capability:'project-pck-export',purpose:'supported-use'}).eligible,false);
});
test('reviewed-plan or source changes reject execution before creating task directory',async t=>{
  const f=fixture(t),s=f.service(),plan=s.plan(f.requestFile),p=f.prepare();fs.appendFileSync(path.join(f.project,'boot.gd'),'# changed\n');
  await assert.rejects(()=>s.execute(f.requestFile,{write:true,expectedPlanSha256:taskPlanIdentity(plan)}),{code:'TASK_PLAN_CHANGED'});
  await assert.rejects(()=>f.executor()(p.input,p.before,{writeAuthorized:true}));assert(!fs.existsSync(f.output));assert.equal(f.calls(),0);
});
test('insufficient physical memory or disk leaves no task or child',async t=>{
  const f=fixture(t);for(const changes of [{freeMemory:()=>M},{availableSpace:()=>1n}]){await assert.rejects(()=>f.service(changes).execute(f.requestFile,{write:true}),/PCK_EXPORT_(MEMORY|DISK)_RESERVE/);assert(!fs.existsSync(f.output));}assert.equal(f.calls(),0);
});
test('exit zero with script error is FAILED with original output/logs retained, not silently retried',async t=>{
  const f=fixture(t),r=await f.service({runChild:async o=>{const r=await f.run(o);fs.appendFileSync(o.stderrPath,'SCRIPT ERROR: model parse failure\n');return r;}}).execute(f.requestFile,{write:true});
  assert.equal(r.status,'FAILED');assert.equal(read(path.join(f.output,'terminal.json')).details.code,'PCK_EXPORT_ERROR_LOG');assert.equal(f.calls(),1);assert(fs.existsSync(path.join(f.output,'full.pck')));assert(!fs.existsSync(path.join(f.output,'AUDIT.json')));
});
test('child failure, truncated PCK or wrong engine version cannot yield export acceptance',async t=>{
  for(const mode of ['exit','truncated','version']){const f=fixture(t),r=await f.service({runChild:async o=>{const r=await f.run(o);if(mode==='exit')return {...r,exitCode:1,outcome:'FAILED'};const b=pck();if(mode==='version')b.writeUInt32LE(6,12);fs.writeFileSync(path.join(f.output,'full.pck'),mode==='truncated'?b.subarray(0,20):b);return r;}}).execute(f.requestFile,{write:true});assert.equal(r.status,'FAILED');assert(!fs.existsSync(path.join(f.output,'AUDIT.json')));assert.equal(f.calls(),1);}
});
test('unexpected source writes and cache budget excess fail and preserve changes for diagnosis',async t=>{
  for(const mode of ['existing','unrelated','cache']){const f=fixture(t);if(mode==='cache'){f.config.cacheGrowthBudgetBytes=0;write(f.file,f.config);}
    const r=await f.service({runChild:async o=>{const r=await f.run(o);if(mode==='existing')fs.appendFileSync(path.join(f.project,'boot.gd'),'CHANGED');if(mode==='unrelated')fs.writeFileSync(path.join(f.project,'new.gd'),'NEW');if(mode==='cache'){fs.mkdirSync(path.join(f.project,'.godot'));fs.writeFileSync(path.join(f.project,'.godot/cache'),'NEW');}return r;}}).execute(f.requestFile,{write:true});
    assert.equal(r.status,'FAILED');assert.equal(read(path.join(f.output,'FAILURE.private.json')).rollbackPerformed,false);assert(!fs.existsSync(path.join(f.output,'AUDIT.json')));if(mode==='existing')assert.match(fs.readFileSync(path.join(f.project,'boot.gd'),'utf8'),/CHANGED/);
  }
});
test('live cancellation remains request-only until child closes; changed project does not disable cancellation',async t=>{
  const f=fixture(t);let release,started;const ready=new Promise(r=>started=r),closed=new Promise(r=>release=r);
  const s=f.service({runChild:async o=>{started();await closed;const r=await f.run(o);return {...r,outcome:o.isCancellationRequested()?'CANCELLED':'SUCCESS'};}});
  const running=s.execute(f.requestFile,{write:true});await ready;const owner=read(path.join(f.output,'TASK.json'));fs.appendFileSync(path.join(f.project,'boot.gd'),'# concurrent edit\n');
  const cancel=s.cancel(f.requestFile,{root:f.output,taskId:owner.taskId,write:true});assert.equal(cancel.status,'CANCEL_REQUESTED');assert.equal(cancel.cancel.accepted,true);assert.equal(cancel.processLiveness,'NOT_OBSERVED');assert(!fs.existsSync(path.join(f.output,'terminal.json')));
  release();const r=await running;assert.equal(r.status,'CANCELLED');assert.equal(f.calls(),1);assert(fs.existsSync(path.join(f.output,'full.pck')));assert(!fs.existsSync(path.join(f.output,'AUDIT.json')));
});
test('status and cancellation require matching task/config/snapshots and audit bytes',async t=>{
  const f=fixture(t),s=f.service(),r=await s.execute(f.requestFile,{write:true});assert.throws(()=>s.status(f.requestFile,{root:f.output,taskId:'wrong'}));
  write(f.file,{...f.config,preset:'other'});assert.throws(()=>s.cancel(f.requestFile,{root:f.output,taskId:r.taskId,write:true}));write(f.file,f.config);
  fs.appendFileSync(path.join(f.output,'AUDIT.json'),' ');assert.throws(()=>s.status(f.requestFile,{root:f.output,taskId:r.taskId}));
});
test('status describes historical receipts, not current-output byte re-audit or live process',async t=>{
  const f=fixture(t),s=f.service(),r=await s.execute(f.requestFile,{write:true});fs.appendFileSync(path.join(f.output,'full.pck'),'CHANGED AFTER TERMINAL');
  const status=s.status(f.requestFile,{root:f.output,taskId:r.taskId});assert.equal(status.status,'SUCCESS');assert.match(status.scope,/does not recheck/);assert.equal(status.processLiveness,'NOT_OBSERVED');assert.equal(status.admission,'NOT_ADMITTED');
});
test('production CLI lists new action but rejects fake editor and does not expose private paths',t=>{
  const f=fixture(t),call=args=>spawnSync(process.execPath,['wxslim.mjs','task',...args],{encoding:'utf8',timeout:15000});
  const list=call(['list']);assert.equal(list.status,0);assert(JSON.parse(list.stdout).actions.some(a=>a.action==='project-pck-export'));
  const result=call(['plan',f.requestFile]);assert.equal(result.status,1);assert(!result.stderr.includes(f.root));assert(!fs.existsSync(f.output));
});
