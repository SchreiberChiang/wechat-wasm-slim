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
const vendor = mode === '--inputs' ? json(previous) : Object.fromEntries(Object.keys(lock.files).map(k => [k,path.join(previous,k)]));
const files = new Map();
function include(out, file, fixed) {
  assert(!files.has(out) && within(output,path.join(output,out)));
  const real=fs.realpathSync(file);
  assert.equal(path.relative(real,path.resolve(file)), '', 'Input link is not allowed');
  const bytes = read(real), record = pin(bytes);
  if (fixed) assert.deepEqual(record,fixed, out);
  files.set(out,{file:real,record});
}
for (const file of json(path.join(source,'packaging/runtime-files.json'))) include('runtime/'+file,path.join(source,file));
const archived = 'offline/pair-review/';
const archiveLock = read(path.join(source,archived,'lock.json'));
assert.equal(pin(archiveLock).sha256,'395f84991b09b0aab9423ccd60354ab65cfc453dcc6635377b70894eb411c9ca','Historical reviewer manifest');
include('runtime/'+archived+'lock.json',path.join(source,archived,'lock.json'));
for (const [file,expected] of Object.entries(JSON.parse(archiveLock).files))
  include('runtime/'+archived+file,path.join(source,archived,file),expected);
const addon = 'addons/wxslim_readonly';
for(const f of fs.readdirSync(path.join(source,'editor/workbench',addon))) {
  if (/\.(gd|gd\.uid|cfg)$/.test(f)) include(addon+'/'+f,path.join(source,'editor/workbench',addon,f));
}
for(const [file,hash] of Object.entries(lock.files)) include(file,vendor[file],hash);
for(const [to,from] of Object.entries({'install.mjs':'packaging/install.mjs','profiles.json':'packaging/vendor-lock.json','使用说明.md':'docs/安装版使用.md'})) include(to,path.join(source,from));
const bytes = [...files.values()].reduce((total,entry)=>total+entry.record.bytes,0);
assert(bytes+1048576<=256*1048576,'Release budget exceeded');
const manifest = {schema:'wxslim-local-release-v1', pluginVersion:'0.2-development',files:Object.fromEntries([...files].map(([key,v])=>[key,v.record]).sort(([a],[b])=>a<b?-1:a>b?1:0))};
if (write) {
  if (!fs.existsSync(output)) fs.mkdirSync(output);
  assert.deepEqual(fs.readdirSync(output),[],'Output must be empty');
  for(const [key,{file,record}] of files){
    const dest=path.join(output,key);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL);
    assert.deepEqual(pin(read(dest)),record,key);
  }
  fs.writeFileSync(path.join(output,'RELEASE.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({written:write,files:files.size,bytes,manifestIdentity:pin(Buffer.from(JSON.stringify(manifest))).sha256}));
