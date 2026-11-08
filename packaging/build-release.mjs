import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const [destination, ...args] = process.argv.slice(2);
const write = args.at(-1) === '--write';
if (write) args.pop();
const [mode, inputs] = args;
assert(destination && (!args.length || (args.length === 2 && ['--inputs','--reuse'].includes(mode))),
  'node packaging/build-release.mjs OUTPUT [--inputs LOCAL_VENDOR_JSON | --reuse PREVIOUS_RELEASE] [--write]');
const output = path.resolve(destination);
const previous = inputs ? path.resolve(inputs) : path.join(source,'offline','vendor');
function within(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
assert(!within(source,output) && !within(output,source) && !within(output,previous), 'Use a new output outside the source and input trees');
const read = file => fs.readFileSync(file);
const json = file => JSON.parse(read(file));
const pin = b => ({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const lock = json(path.join(source,'packaging/vendor-lock.json'));
// A previous release may use the old flat layout or the addons/wxslim_readonly/kit layout.
const previousKit = fs.existsSync(path.join(previous,'addons/wxslim_readonly/kit/RELEASE.json')) ? path.join(previous,'addons/wxslim_readonly/kit') : previous;
const vendor = mode === '--inputs' ? json(previous) : Object.fromEntries(Object.keys(lock.files).map(k => [k,path.join(previousKit,k)]));
// Release layout: OUTPUT/addons/wxslim_readonly/ is what people copy into a game.
// Its kit/ folder holds the tools and a .gdignore so Godot never scans or exports it.
const addon = 'addons/wxslim_readonly', kitDir = addon + '/kit/';
const files = new Map();
function includeBytes(out, bytes) {
  assert(!files.has(out) && within(output,path.join(output,out)));
  files.set(out,{bytes,record:pin(bytes)});
}
function include(out, file, fixed) {
  assert(!files.has(out) && within(output,path.join(output,out)));
  const real=fs.realpathSync(file);
  assert.equal(path.relative(real,path.resolve(file)), '', 'Input link is not allowed');
  const bytes = read(real), record = pin(bytes);
  if (fixed) assert.deepEqual(record,fixed, out);
  files.set(out,{file:real,record});
}
for (const file of json(path.join(source,'packaging/runtime-files.json'))) include(kitDir+'runtime/'+file,path.join(source,file));
for(const f of fs.readdirSync(path.join(source,'editor/workbench',addon))) {
  if (/\.(gd|gd\.uid|cfg)$/.test(f)) include(addon+'/'+f,path.join(source,'editor/workbench',addon,f));
}
includeBytes(kitDir+'.gdignore',Buffer.alloc(0));
for(const [file,hash] of Object.entries(lock.files)) {
  // Older releases and explicit vendor maps contain the engine binaries only.
  // Files a previous release does not have yet (fingerprints, the bundled Node.js) or has in an older
  // version (a rebuilt engine) come from offline/vendor.
  const stale = mode !== '--inputs' && fs.existsSync(vendor[file]) && fs.statSync(vendor[file]).size !== hash.bytes;
  const input = file.endsWith('/fingerprint.json') || stale || (mode !== '--inputs' && !fs.existsSync(vendor[file])) ? path.join(source,'offline/vendor',file) : vendor[file];
  include(kitDir+file,input,hash);
}
for(const [to,from] of Object.entries({[kitDir+'install.mjs']:'packaging/install.mjs',[kitDir+'profiles.json']:'packaging/vendor-lock.json',
  '使用说明.md':'docs/安装版使用.md','给AI的安装说明.md':'docs/给AI的安装说明.md','WASM分包注意事项.md':'docs/WASM分包注意事项.md','授权说明.md':'docs/授权说明.md'})) include(to,path.join(source,from));
const bytes = [...files.values()].reduce((total,entry)=>total+entry.record.bytes,0);
// Three engines, the WeChat converter and the bundled Node.js runtime (about 89 MiB).
assert(bytes+1048576<=384*1048576,'Release budget exceeded');
// The kit manifest lists every kit file relative to kit/; install.mjs checks them before setup.
const byKey = ([a],[b])=>a<b?-1:a>b?1:0;
const manifest = {schema:'wxslim-plugin-kit-v1', pluginVersion:'0.3-development',
  files:Object.fromEntries([...files].filter(([key])=>key.startsWith(kitDir)).map(([key,v])=>[key.slice(kitDir.length),v.record]).sort(byKey)),
  addon:Object.fromEntries([...files].filter(([key])=>key.startsWith(addon+'/')&&!key.startsWith(kitDir)).map(([key,v])=>[key.slice(addon.length+1),v.record]).sort(byKey))};
if (write) {
  if (!fs.existsSync(output)) fs.mkdirSync(output);
  assert.deepEqual(fs.readdirSync(output),[],'Output must be empty');
  for(const [key,{file,bytes,record}] of files){
    const dest=path.join(output,key);fs.mkdirSync(path.dirname(dest),{recursive:true});
    if (file) fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL); else fs.writeFileSync(dest,bytes,{flag:'wx'});
    assert.deepEqual(pin(read(dest)),record,key);
  }
  fs.writeFileSync(path.join(output,kitDir,'RELEASE.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({written:write,files:files.size,bytes,manifestIdentity:pin(Buffer.from(JSON.stringify(manifest))).sha256}));
