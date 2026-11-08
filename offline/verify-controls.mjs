import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const [toolsArg, releaseArg, workArg, ...extra] = process.argv.slice(2);
assert(toolsArg && releaseArg && workArg && !extra.length,
  'Usage: node offline/verify-controls.mjs TOOLS RELEASE NEW_WORK');
const source = fileURLToPath(new URL('../',import.meta.url));
const tools = fs.realpathSync(toolsArg), release = fs.realpathSync(releaseArg);
const work = path.resolve(workArg);
const inside = (dir,file) => {
  const relative = path.relative(dir,file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..'+path.sep);
};
assert.equal(path.relative(path.dirname(work),fs.realpathSync(path.dirname(work))),'');
for (const input of [source,tools,release]) assert(!inside(input,work) && !inside(work,input));
const node = path.join(tools,'node.exe'), cli = path.join(release,'runtime/wxslim.mjs');
const editor = path.join(tools,'godot-4.7.2/godot.windows.opt.tools.64.exe');
for (const file of [node,cli,editor]) assert(fs.statSync(file).isFile());
const runs = path.join(work,'runs'), game = path.join(work,'game');
const env = {...process.env,TMP:path.join(work,'temp'),TEMP:path.join(work,'temp'),
  APPDATA:path.join(work,'roaming'),LOCALAPPDATA:path.join(work,'local')};
fs.mkdirSync(work);
for (const dir of [runs,game,env.TEMP,env.APPDATA,env.LOCALAPPDATA]) fs.mkdirSync(dir);
for (const file of ['project.godot','export_presets.cfg','simple.gd','simple.tscn']) {
  fs.copyFileSync(path.join(source,'examples/simple',file),path.join(game,file),fs.constants.COPYFILE_EXCL);
}
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const save = (name,value) => {
  const file = path.join(work,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  return file;
};
function command(step,args,expected) {
  const child = spawnSync(node,[cli,'quick',...args],{env,cwd:work,encoding:'utf8',windowsHide:true});
  save(step+'.json',{exit:child.status,stdout:child.stdout,stderr:child.stderr});
  if (child.error) throw child.error;
  assert.equal(child.status,expected,step+' failed; see '+work);
  return JSON.parse(child.stdout);
}
const settings = {schema:'wxslim-quick-settings-v1',template:'full',orientation:'portrait',
  glx:true,devtoolsPreview:false,output:runs,gameName:'Control'};
const runArgs = file => ['run',game,'--release',release,'--editor',editor,'--settings',file,'--write'];
const importResult = spawnSync(editor,['--headless','--path',game,'--log-file',path.join(work,'godot.log'),'--import'],
  {env,cwd:work,encoding:'utf8',windowsHide:true});
if (importResult.error) throw importResult.error;
save('import.json',{exit:importResult.status,stdout:importResult.stdout,stderr:importResult.stderr});
assert.equal(importResult.status,0);

const unconfirmed = save('unconfirmed.json',{...settings,template:'conservative',confirmRemovedModules:false});
const blocked = command('blocked',runArgs(unconfirmed),2);
assert.equal(blocked.status,'BLOCKED');
assert.equal(blocked.writes,'NONE');
assert(blocked.blockers.some(b => b.code==='QUICK_CONSERVATIVE_NEEDS_CONFIRMATION' && b.field==='confirmRemovedModules'));
assert.deepEqual(fs.readdirSync(runs),[]);

const args = runArgs(save('cancel-settings.json',settings));
const child = spawn(node,[cli,'quick',...args],{env,cwd:work,windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout = '', stderr = '';
child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});
child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
const closed = new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('close',resolve);
});
let run, active, runningState;
const until = Date.now()+180000;
while (child.exitCode===null && child.signalCode===null && Date.now()<until) {
  const [name] = fs.readdirSync(runs);
  if (name) {
    run = path.join(runs,name);
    const file = path.join(run,'requests/active-task.json');
    try { active=read(file); }
    catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (active?.step==='convert' && path.relative(path.join(run,'wechat'),active.taskRoot)==='' &&
        fs.existsSync(path.join(active.taskRoot,'TASK.json')) && fs.statSync(path.join(active.taskRoot,'events.jsonl'),{throwIfNoEntry:false})?.size) {
      runningState = command('running-status',['status',run],0);
      break;
    }
  }
  await delay(40);
}
if (run && child.exitCode===null) command('cancel',['cancel',run,'--write'],0);
const exit = await closed;
save('cancelled-run.json',{exit,stdout,stderr});
assert.equal(active?.step,'convert','Expected a running owned conversion');
assert.equal(exit,3);
const cancelled = JSON.parse(stdout);
assert.equal(cancelled.steps.export.outcome.status,'SUCCESS');
assert.equal(cancelled.status,'CANCELLED');
const cancelReceipt = JSON.parse(read(path.join(work,'cancel.json')).stdout);
const terminal = read(path.join(run,'wechat/terminal.json'));
assert.equal(cancelReceipt.task.accepted,true);
assert.equal(terminal.taskId,cancelReceipt.task.taskId);
assert.equal(terminal.status,'CANCELLED');
assert.equal(runningState?.status,'UNFINISHED');
assert.equal(runningState.progress.step,'convert');
assert.equal(runningState.progress.taskId,terminal.taskId);
assert(runningState.progress.lastEvent?.at);
assert.equal(runningState.progress.scope,'LAST_RECORDED_EVENT_NOT_LIVENESS_OR_TERMINAL');
const cancelState = command('cancel-status',['status',run],0);
assert.equal(cancelState.status,'CANCELLED');
assert.equal(cancelState.openTarget,'');
assert.equal(cancelState.packageId,'');

// Leave less than the mandatory 1 MiB receipt reserve in an 8 MiB export.
// The file and its export are confined to this new acceptance directory.
const preset = path.join(game,'export_presets.cfg');
const presetText = fs.readFileSync(preset,'utf8');
assert(presetText.includes('include_filter=""'));
fs.writeFileSync(preset,presetText.replace('include_filter=""','include_filter="budget-check.bin"'));
const payload = Buffer.alloc(7.5*2**20,0x41);
fs.writeFileSync(path.join(game,'budget-check.bin'),payload,{flag:'wx'});
const failSettings = save('failure-settings.json',{...settings,gameName:'BudgetCheck',exportBudgetMiB:8});
const failure = command('failed',runArgs(failSettings),1);
assert.equal(failure.status,'FAILED');
assert.equal(failure.error?.code,'QUICK_TASK_NOT_SUCCESS');
assert.equal(failure.error.reasonCode,'PCK_EXPORT_RECEIPT_LIMIT');
assert.equal(failure.error.field,'exportBudgetMiB');
assert(inside(runs,failure.run));
const exportDir = path.join(failure.run,'pck');
const failedTerminal = read(path.join(exportDir,'terminal.json'));
const cause = read(path.join(exportDir,'FAILURE.private.json'));
assert.equal(failedTerminal.status,'FAILED');
assert.equal(cause.code,'PCK_EXPORT_RECEIPT_LIMIT');
assert.equal(cause.childClosed,true);
assert(fs.statSync(path.join(exportDir,'full.pck')).size >= payload.length);
const failedState = command('failed-status',['status',failure.run],0);
assert.equal(failedState.status,'FAILED');
assert.equal(failedState.error.reasonCode,cause.code);
assert.equal(failedState.error.field,failure.error.field);
assert.equal(failedState.packageId,'');
assert.equal(failedState.openTarget,'');
assert(!fs.existsSync(path.join(failure.run,'wechat')));
const result = {blocked:{field:'confirmRemovedModules',writes:'NONE'},
  cancelled:{export:'SUCCESS',conversion:terminal.status,quick:cancelState.status,taskId:terminal.taskId,progress:runningState.progress},
  failed:{export:failedTerminal.status,quick:failedState.status,reason:cause.code,field:failedState.error.field,taskId:failedTerminal.taskId}};
save('result.json',result);
console.log(JSON.stringify(result));
