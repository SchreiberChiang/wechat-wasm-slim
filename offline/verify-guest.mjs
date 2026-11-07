import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source = path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const scratch = 'C:\\GLXScratch', evidence = 'C:\\GLXEvidence';
assert.equal(process.platform,'win32');
assert.equal(path.relative('C:\\GLXSource', source),'','Run offline/verify-guest.cmd in the isolated Windows guest');
assert.equal(process.argv.length,2);
const tools = path.join(scratch,'tools'), node = path.join(tools,'node.exe');
assert.equal(path.relative(node,process.execPath),'','Bundled guest Node required');
assert.deepEqual(fs.readdirSync(scratch),['tools'],'Expected a fresh bootstrap');
const existing = fs.readdirSync(evidence);
for (const name of ['host-canaries.json','bootstrap.stdout','bootstrap.stderr']) assert(existing.includes(name));
assert(existing.every(name=>['host-canaries.json','GLX-offline.wsb','bootstrap.stdout','bootstrap.stderr'].includes(name)),
  'Use a fresh evidence directory');

const python = path.join(tools,'python-3.14.0','python.exe'), release = path.join(scratch,'release');
const temp = path.join(scratch,'tmp');
fs.mkdirSync(temp);
const windows = process.env.SystemRoot;
assert(windows && path.isAbsolute(windows));
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>
  !/^(PATH$|WXSLIM_|OFFICIAL_CAPTURE_RAW_DIR$|NODE_|GIT_|PYTHONPATH$|PYTHONHOME$)/i.test(key)));
env.PATH = [tools,path.dirname(python),path.join(tools,'git-windows/mingw64/bin'),
  path.join(windows,'System32'),path.join(windows,'System32/WindowsPowerShell/v1.0'),windows].join(path.delimiter);
Object.assign(env,{TEMP:temp,TMP:temp,GIT_CONFIG_GLOBAL:'NUL',GIT_CONFIG_NOSYSTEM:'1',PYTHONDONTWRITEBYTECODE:'1'});
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write = (name,data)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const steps = [];
let stage = 'bootstrap';

function run(name,exe,args) {
  stage = name;
  const stdout = fs.openSync(path.join(evidence,name+'.stdout'),'wx');
  try {
    const stderr = fs.openSync(path.join(evidence,name+'.stderr'),'wx');
    try {
      const child = spawnSync(exe,args,{env,cwd:source,windowsHide:true,stdio:['ignore',stdout,stderr]});
      if (child.error) throw child.error;
      assert.equal(child.status,0,name+' failed; inspect its logs in '+evidence);
    } finally { fs.closeSync(stderr); }
  } finally { fs.closeSync(stdout); }
  steps.push(name);
}
function checkIsolation(after=false) {
  run(after?'isolation-after':'isolation-before',node,['offline/windows-sandbox.mjs','guest-check',...(after?['--after']:[])]);
  const observed = read(path.join(evidence,after?'guest-isolation-after.json':'guest-isolation.json'));
  assert.equal(observed.status,'PASS');
  return observed;
}
function installed(recipe,preparation) {
  const name = 'installed-'+(preparation?'rebuilt-':'bundled-')+recipe;
  const output = path.join(scratch,name);
  run(name,node,['offline/verify-recipe.mjs',recipe,tools,release,output,...(preparation?['--rebuilt-preparation',preparation]:[])]);
  const result = read(path.join(output,'result.json'));
  assert.equal(result.recipe,recipe);
  assert(result.files>0 && result.packageId);
  const runs = fs.readdirSync(path.join(output,'runs'));
  assert.equal(runs.length,1);
  return {result,pck:path.join(output,'runs',runs[0],'pck/full.pck')};
}

try {
  const initial = checkIsolation();
  const editedDiagnostic = 'WARN_PRINT_ONCE("GODOT_WECHAT_LIFECYCLE_MAIN_LOOP_NOT_READY: notification skipped");';
  assert(fs.readFileSync(path.join(source,'engine/official-lifecycle-notifications.patch'),'utf8').includes(editedDiagnostic),
    'Map the source checkout with offline/examples/engine-diagnostic.patch applied');
  run('regression',node,['tests/run-offline.mjs',tools]);
  const tap = fs.readFileSync(path.join(evidence,'regression.stdout'),'utf8');
  const counts = Object.fromEntries([...tap.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)\r?$/gm)].map(m=>[m[1],Number(m[2])]));
  assert(counts.tests>0 && counts.pass===counts.tests && ['fail','skipped','cancelled','todo'].every(k=>counts[k]===0));
  run('build-release',node,['packaging/build-release.mjs',release,'--write']);
  const installer = read(path.join(evidence,'build-release.stdout'));
  assert(installer.written && installer.files>0);
  const recipes = ['full','conservative','pure-2d'], bundled = new Map(), pairs = [];
  for (const recipe of recipes) bundled.set(recipe,installed(recipe));
  const controlsDir = path.join(scratch,'controls');
  run('controls',node,['offline/verify-controls.mjs',tools,release,controlsDir]);
  const controls = read(path.join(controlsDir,'result.json'));
  assert.equal(controls.blocked.writes,'NONE');
  assert.equal(controls.cancelled.conversion,'CANCELLED');
  assert.equal(controls.failed.export,'FAILED');
  const sdk = path.join(scratch,'sdk');
  run('prepare-sdk',python,['-IB','engine/official-toolchain.py','--root',sdk,'--base-python',python,
    '--offline-inputs',path.join(source,'offline/downloads'),'--jobs','4','--write']);
  for (const recipe of recipes) {
    const raw = path.join(scratch,'raw-'+recipe), pair = path.join(scratch,'pair-'+recipe);
    run('rebuild-'+recipe,node,['offline/rebuild.mjs',recipe,tools,sdk,raw,'--write']);
    const terminal = read(path.join(raw,'terminal.json'));
    assert.equal(terminal.status,'SUCCESS');
    const previous = bundled.get(recipe);
    run('review-'+recipe,node,['offline/verify-rebuilt.mjs',recipe,raw,previous.pck,pair,'--confirm-game-features','--verify-example-edit']);
    const reviewed = read(path.join(pair,'result.json'));
    assert.equal(reviewed.rawTaskId,terminal.taskId);
    assert.notEqual(reviewed.sourceEdit.originalWasmSha256,reviewed.sourceEdit.rebuiltWasmSha256);
    const {result} = installed(recipe,path.join(pair,'preparation.json'));
    assert.equal(result.rebuiltEngine.taskId,terminal.taskId);
    assert.equal(result.rebuiltEngine.wasmSha256,reviewed.sourceEdit.rebuiltWasmSha256);
    assert.equal(result.sourceAudit,'PASS_SOURCE_STATIC_ONLY');
    assert.equal(result.pckSha256,previous.result.pckSha256);
    assert.equal(result.pckSha256,reviewed.pck.sha256);
    assert.notEqual(result.packageId,previous.result.packageId);
    pairs.push({recipe,bundled:previous.result,reviewed,installedRebuilt:result});
  }
  const final = checkIsolation(true);
  assert.deepEqual(final.paths,initial.paths);
  write('DELIVERY-RESULT.json',{status:'PASS',counts,installer,controls,pairs,steps});
} catch (error) {
  write('DELIVERY-FAILED.json',{stage,completed:steps,message:error.message});
  throw error;
}
