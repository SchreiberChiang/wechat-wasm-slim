import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fs.realpathSync(fileURLToPath(new URL('../',import.meta.url))), home=path.join(root,'editor','workbench');
const editor=fs.realpathSync(path.resolve(process.argv[2]||''));
assert(process.argv.length===3 && fs.statSync(editor).isFile(),'node packaging/configure-workbench.mjs GODOT_EDITOR');
const config=path.join(home,'local-config.json'),value={schema:'wxslim-local-plugin-config-v1',nodeExecutable:process.execPath,repositoryRoot:root,editorExecutable:editor,requestFile:'',taskRoot:'',taskId:''};
if(fs.existsSync(config)){
 const old=JSON.parse(fs.readFileSync(config));
 assert(old.repositoryRoot===root && old.nodeExecutable===process.execPath && old.editorExecutable===editor,'Existing configuration differs. Review it before changing it.');
}else fs.writeFileSync(config,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
fs.mkdirSync(path.join(home,'logs'),{recursive:true});
console.log(path.join(home,'project.godot'));
