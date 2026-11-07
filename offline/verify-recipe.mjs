import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectPck} from '../lib/pck-inventory.mjs';

const [recipe, toolsArg, releaseArg, workArg, ...extra] = process.argv.slice(2);
assert(['full','conservative','pure-2d'].includes(recipe) && toolsArg && releaseArg && workArg && !extra.length,
  'Usage: node offline/verify-recipe.mjs full|conservative|pure-2d TOOLS RELEASE NEW_WORK');
const source = fileURLToPath(new URL('../',import.meta.url));
const tools = fs.realpathSync(toolsArg), release = fs.realpathSync(releaseArg), work = path.resolve(workArg);
function within(root, file) {
  const rel=path.relative(root,file);
  return !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);
}
for(const tree of [source,tools,release]) assert(!within(tree,work) && !within(work,tree),'Use a separate run directory');
assert.equal(path.relative(fs.realpathSync(path.dirname(work)),path.dirname(work)),'','Ordinary parent directory required');
fs.mkdirSync(work);
const game=path.join(work,'game'), runs=path.join(work,'runs'), logs=path.join(work,'logs');
for(const dir of [runs,logs,path.join(work,'temp'),path.join(work,'roaming'),path.join(work,'local')]) fs.mkdirSync(dir);
const node=path.join(tools,'node.exe'), editor=path.join(tools,'godot-4.7.2/godot.windows.opt.tools.64.exe');
const cli=path.join(release,'runtime/wxslim.mjs');
const env={...process.env, TEMP:path.join(work,'temp'), TMP:path.join(work,'temp'),
  APPDATA:path.join(work,'roaming'), LOCALAPPDATA:path.join(work,'local')};
function call(step,bin,args) {
  const ret=spawnSync(bin,args,{cwd:work,env,encoding:'utf8',windowsHide:true,maxBuffer:32*2**20,timeout:20*60*1000});
  for(const key of ['stdout','stderr']) fs.writeFileSync(path.join(logs,step+'.'+key),ret[key]||'',{flag:'wx'});
  if(ret.error) throw ret.error;
  assert.equal(ret.status,0,step+' failed; see '+path.join(logs,step+'.stderr'));
  return ret.stdout;
}
function sha(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
fs.cpSync(path.join(source,'examples/simple'),game,{recursive:true,filter:file=>!['.godot','.git'].includes(path.basename(file))});
const settings={schema:'wxslim-quick-settings-v1',template:recipe==='pure-2d'?'2d':recipe,
  glx:true,orientation:'portrait',output:runs,devtoolsPreview:false,gameName:'GLX-'+recipe,
  confirmRemovedModules:recipe==='conservative',confirmNo3d:recipe==='pure-2d'};
fs.writeFileSync(path.join(game,'wxslim-export.json'),JSON.stringify(settings,null,2),{flag:'wx'});
call('install',node,[path.join(release,'install.mjs'),game,editor,'--state-root',path.join(work,'state')]);
const project=path.join(game,'project.godot');
assert(!fs.readFileSync(project,'utf8').includes('[editor_plugins]'),'Expected a fresh example');
fs.appendFileSync(project,'\n[editor_plugins]\nenabled=PackedStringArray("res://addons/wxslim_readonly/plugin.cfg")\n');
call('import',editor,['--headless','--path',game,'--log-file',path.join(logs,'godot.log'),'--import']);
const options=[game,'--editor',editor,'--release',release];
assert.equal(JSON.parse(call('plan',node,[cli,'quick','plan',...options])).ready,true);
const result=JSON.parse(call('run',node,[cli,'quick','run',...options,'--write']));
assert.equal(result.status,'SUCCESS');
assert(within(runs,result.run));
const status=JSON.parse(call('status',node,[cli,'quick','status',result.run]));
assert.equal(status.status,'SUCCESS');
const pck=path.join(result.run,'pck/full.pck');
const resources=inspectPck(fs.readFileSync(pck)).entries.map(item=>item.path);
assert(resources.includes('simple.tscn') && resources.includes('simple.gd'));
assert(resources.every(name=>!name.startsWith('addons/')),'Editor scripts in game PCK');
const task=path.join(result.run,'wechat'), output=path.join(task,'converted/minigame');
const audit=JSON.parse(fs.readFileSync(path.join(task,'AUDIT.json'),'utf8'));
assert.equal(audit.packageId,status.packageId);
for(const entry of audit.files){
  const file=path.resolve(output,entry.path);
  assert(within(output,file) && path.relative(fs.realpathSync(file),file)==='');
  assert.equal(sha(file),entry.sha256,entry.path);
}
let pairAudit;
if(recipe!=='full'){
  const proof=env.WXSLIM_PAIR_PROOF || path.join(path.dirname(release),'proof');
  const location=fs.realpathSync(path.join(proof,recipe+'.json'));
  const config=JSON.parse(fs.readFileSync(path.join(result.run,'requests/convert-config.json'),'utf8'));
  assert.equal(path.relative(location,fs.realpathSync(config.customPreparation)),'','Unexpected proof selected');
  pairAudit=JSON.parse(call('pair-review',node,[path.join(release,'runtime/convert/official.mjs'),
    'custom-output-audit',location,output]));
  assert.equal(pairAudit.status,'PASS_SOURCE_STATIC_ONLY');
  assert(pairAudit.sourceBuildReaudited && pairAudit.sevenRulesPreserved && pairAudit.hostBridgeExact);
}
const evidence={recipe,packageId:audit.packageId,files:audit.files.length,pckSha256:sha(pck),resources,
  sourceAudit:pairAudit?.status,phone:'NOT_RUN',networkServices:'NOT_RUN'};
fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(evidence));
