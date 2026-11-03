// Content export only: never uses the editor's Web engine/export template.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {read,sha,recipe,sources,checkPck} from './delivery.mjs';

export function exportPlan(config,scene,pck){
  assert(path.isAbsolute(scene)&&path.isAbsolute(pck),'explicit absolute paths');
  assert.equal(sha(read(config.editor)),recipe.editor.sha256,'fixed editor');
  for(const [name,bytes] of sources())assert(read(path.join(scene,name)).equals(bytes),'scene source '+name);
  assert(!fs.existsSync(pck),'preserve existing PCK; select a new explicit filename');
  assert(fs.statSync(path.dirname(pck)).isDirectory(),'approved output parent must exist');
  return {editor:config.editor,scene,pck,commands:[['--headless','--path',scene,'--import'],['--headless','--path',scene,'--export-pack','Web',pck]]};
}

export function exportContent(config,scene,pck){
  const plan=exportPlan(config,scene,pck),record={schema:'simple-pck-export-v1',editorSha256:recipe.editor.sha256,startedAt:new Date().toISOString(),phases:[],visual:'NOT_VERIFIED'};
  const log=pck+'.export.json';assert(!fs.existsSync(log),'existing export record');
  for(const [index,args] of plan.commands.entries()){
    const started=Date.now();
    const result=spawnSync(config.editor,args,{cwd:scene,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
    fs.writeFileSync(pck+`.stage-${index}.log`,(result.stdout??'')+(result.stderr??''),{flag:'wx'});
    record.phases.push({name:index===0?'import':'export',seconds:(Date.now()-started)/1000,exitCode:result.status,error:result.error?String(result.error):null});
    fs.writeFileSync(log,JSON.stringify(record,null,2)+'\n');
    assert(!result.error&&result.status===0,'editor failed; preserve logs and stop');
    assert(!/SCRIPT ERROR:|Parse Error:|ERROR:/.test((result.stdout??'')+(result.stderr??'')),'editor reported error; preserve output, do not package');
  }
  record.pck=checkPck(read(pck));record.status='EXPORTED_CONTENT_AUDIT_PASS_NOT_RUNTIME_ACCEPTANCE';
  fs.writeFileSync(log,JSON.stringify(record,null,2)+'\n');return record;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [cfg,scene,pck,action,...extra]=process.argv.slice(2);assert(cfg&&scene&&pck&&!extra.length&&(!action||action==='--execute'),'PRIVATE_CONFIG ABS_SCENE ABS_NEW_PCK [--execute]');const config=JSON.parse(read(cfg));console.log(JSON.stringify(action?exportContent(config,scene,pck):exportPlan(config,scene,pck),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
