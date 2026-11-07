import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const tools = fs.realpathSync(process.argv[2]);
const git = path.join(tools,'git-windows/mingw64/bin/git.exe');
const engine = path.join(tools,'c050.git');
const commit = 'c050c09b105c3715e1caa57a7109cd752047fd89';
const object = commit+':thirdparty/certs/ca-bundle.crt';
const blob = execFileSync(git,['--no-replace-objects','-C',engine,'cat-file','blob',object],{windowsHide:true});
const verified = execFileSync(git,['--no-replace-objects','-C',engine,'rev-parse',object],{encoding:'utf8',windowsHide:true}).trim();
assert.equal(createHash('sha1').update('blob '+blob.length+'\0').update(blob).digest('hex'),verified);
const editor = path.join(tools,'godot-4.7.2');
const profile = path.join(editor,'editor_data');
fs.mkdirSync(profile);
const certs = path.join(profile,'godot-public-roots.crt');
fs.writeFileSync(certs,blob,{flag:'wx'});
const settings = '[gd_resource type="EditorSettings" format=3]\n\n[resource]\nnetwork/tls/editor_tls_certificates = '+
  JSON.stringify(certs.replaceAll('\\','/'))+'\n';
fs.writeFileSync(path.join(profile,'editor_settings-4.7.tres'),settings,{flag:'wx'});
fs.writeFileSync(path.join(editor,'._sc_'),'',{flag:'wx'});
