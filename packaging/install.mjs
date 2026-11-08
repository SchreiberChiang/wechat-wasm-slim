import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const release = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opts=argv.slice(2),update=opts[0]==='--update';
if(update)opts.shift();
assert(argv.length>=2 && (opts.length===0 || (opts.length===2 && opts[0]==='--state-root')), 'node install.mjs GAME_PROJECT GODOT_EDITOR [--update] [--state-root DIRECTORY]');
const project = fs.realpathSync(path.resolve(argv[0]));
const editor = fs.realpathSync(path.resolve(argv[1]));
assert(fs.statSync(path.join(project,'project.godot')).isFile() && fs.statSync(editor).isFile());
function contains(a,b) {
  const rel=path.relative(a,b);return !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);
}
assert(!contains(project,release) && !contains(release,project),'Keep the release and the game project separate');
const hash = b=>createHash('sha256').update(b).digest('hex');
const readJson = file=>JSON.parse(fs.readFileSync(file));
const manifest=readJson(path.join(release,'RELEASE.json'));
assert.equal(manifest.schema,'wxslim-local-release-v1');
for(const [rel,pin] of Object.entries(manifest.files)) {
  const file=path.join(release,rel);
  assert(contains(release,file) && path.relative(file,fs.realpathSync(file))==='');
  const b=fs.readFileSync(file);
  assert(b.length===pin.bytes && hash(b)===pin.sha256,'Release content mismatch: '+rel);
}
const addonName='wxslim_readonly', prefix='addons/'+addonName+'/';
const workbench=path.join(release,'runtime','editor','workbench');
const addons=path.join(project,'addons'),target=path.join(addons,addonName);
const registration=path.join(project,'.godot','wxslim');
const pointer=path.join(registration,'state.path');
const projectKey=hash(Buffer.from(process.platform==='win32'?project.toLowerCase():project)).slice(0,24);
const base = opts[1] || path.join(process.env.LOCALAPPDATA || path.dirname(project),'Godot','WxSlim','projects');
const state=path.resolve(opts[1] || !fs.existsSync(pointer) ? path.join(base,projectKey) : fs.readFileSync(pointer,'utf8').trim());
assert(!contains(project,state)&&!contains(release,state),'Runtime logs must stay outside the game and release');
for(const dir of [addons,registration,state,path.join(state,'logs')]) {
  fs.mkdirSync(dir,{recursive:true});assert.equal(path.relative(dir,fs.realpathSync(dir)),'','Directory link');
}
const files=new Map(Object.keys(manifest.files).filter(k=>k.startsWith(prefix)).map(k=>[k.slice(prefix.length),fs.readFileSync(path.join(release,k))]));
files.set('workbench.path',Buffer.from(workbench.replaceAll('\\','/')+'\n'));
const installed=Object.fromEntries([...files].map(([k,v])=>[k,hash(v)]));
function inventory(dir) {
  return Object.fromEntries(fs.readdirSync(dir).map(k=>{
    const f=path.join(dir,k);assert(fs.lstatSync(f).isFile() && !fs.lstatSync(f).isSymbolicLink());return [k,hash(fs.readFileSync(f))];
  }));
}
function matches(a,b) {return Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>a[k]===b[k]);}
const config=path.join(state,'local-config.json'),receipt=path.join(registration,'installation.json'),lease=path.join(registration,'installation.lock');
const fd=fs.openSync(lease,'wx');
try {
  const priorConfig=fs.existsSync(config)?readJson(config):null;
  const same=priorConfig && priorConfig.repositoryRoot===path.resolve(release,'runtime');
  const cfg={schema:'wxslim-local-plugin-config-v1',nodeExecutable:process.execPath,repositoryRoot:path.resolve(release,'runtime'),editorExecutable:editor,
    requestFile:same?priorConfig.requestFile:'',taskRoot:same?priorConfig.taskRoot:'',taskId:same?priorConfig.taskId:''};
  const old=fs.existsSync(target)?inventory(target):null;
  const sameFiles=old && matches(old,installed);
  if(old && !sameFiles) {
    assert(update && fs.existsSync(receipt) && matches(old,readJson(receipt).files),'Existing addon differs. Only a verified managed installation can be updated.');
  }
  // Stage and swap inside the game's addons folder so the renames never cross
  // drives (the state folder is usually on C: while games may live on D: or F:).
  // Dot-prefixed folders are skipped by Godot's scanner and export.
  const token=randomUUID(),staged=path.join(addons,'.wxslim-staged-'+token),aside=path.join(addons,'.wxslim-previous-'+token);
  const backup=path.join(state,'previous-addon-'+token);
  let moved=false;
  if(!sameFiles) {
    try {
      fs.mkdirSync(staged);
      for(const [k,b] of files) fs.writeFileSync(path.join(staged,k),b,{flag:'wx'});
      assert(matches(inventory(staged),installed));
      if(old) {
        fs.cpSync(target,backup,{recursive:true,errorOnExist:true,force:false});
        assert(matches(inventory(backup),old),'Backup of the previous addon differs');
        fs.renameSync(target,aside);moved=true;
      }
      try {fs.renameSync(staged,target);} catch(error) {if(moved)fs.renameSync(aside,target);throw error;}
      if(moved) fs.rmSync(aside,{recursive:true,force:true});
    } finally {
      fs.rmSync(staged,{recursive:true,force:true});
    }
  }
  // Enable the plugin so its export filter keeps the panel out of the game PCK,
  // whether the game is exported from the panel or from the command line.
  const {enablePlugin}=await import(pathToFileURL(path.join(release,'runtime','lib','godot-plugin-state.mjs')).href);
  const projectFile=path.join(project,'project.godot'),projectText=fs.readFileSync(projectFile,'utf8');
  const enabledText=enablePlugin(projectText),pluginEnabledNow=enabledText!==projectText;
  if(pluginEnabledNow){const temp=projectFile+'.'+token+'.tmp';fs.writeFileSync(temp,enabledText,{flag:'wx'});fs.renameSync(temp,projectFile);}
  function publish(file,data){const temp=file+'.'+token+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);}
  publish(path.join(state,'project.json'),{project});
  const tmpPointer=pointer+'.'+token+'.tmp';fs.writeFileSync(tmpPointer,state.replaceAll('\\','/')+'\n',{flag:'wx'});fs.renameSync(tmpPointer,pointer);
  publish(config,cfg);
  publish(receipt,{schema:1,releaseManifest:hash(fs.readFileSync(path.join(release,'RELEASE.json'))),files:installed});
  console.log(JSON.stringify({addon:target,state,alreadyInstalled:!!sameFiles,previousAddon:old&&!sameFiles?backup:null,pluginEnabled:true,pluginEnabledNow}));
} finally {fs.closeSync(fd);fs.unlinkSync(lease);}
