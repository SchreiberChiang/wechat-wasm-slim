import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const guestSource = 'C:\\GLXSource';
const guestEvidence = 'C:\\GLXEvidence';
const guestScratch = 'C:\\GLXScratch';
const [action,...args] = process.argv.slice(2);
assert.equal(process.platform,'win32','Windows host required');

function within(root,file) {
  const relative = path.relative(root,file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..'+path.sep);
}
function ordinary(value) {
  const file = path.resolve(value);
  assert.equal(path.relative(fs.realpathSync(file),file),'','Expected an ordinary existing path');
  return file;
}
function writeJson(file,data) {
  fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
}
function xml(text) {
  return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}
function generate() {
  const [evidenceArg,scratchArg,...probes] = args;
  assert(evidenceArg && scratchArg && probes.length >= 3 && probes.pop() === '--write',
    'Usage: node offline/windows-sandbox.mjs prepare EMPTY_EVIDENCE EMPTY_SCRATCH LEGACY_FILE LEGACY_FILE [...] --write');
  const evidence = ordinary(evidenceArg), scratch = ordinary(scratchArg);
  const shares = [[source,guestSource,true],[evidence,guestEvidence,false],[scratch,guestScratch,false]];
  for(const [root] of shares) {
    assert(fs.statSync(root).isDirectory());
    assert(!shares.some(([other]) => other !== root && within(other,root)),'Folders must be disjoint');
  }
  assert.equal(new Set(shares.map(([dir])=>dir.toLowerCase())).size,3);
  for(const dir of [scratch,evidence]) assert.deepEqual(fs.readdirSync(dir),[],'Empty output folders required');
  const files = probes.map(value=>{
    const file = ordinary(value);
    assert(!shares.some(([dir])=>within(dir,file)),'Legacy canary must be outside all mapped folders');
    const stat = fs.statSync(file);
    assert(stat.isFile() && stat.size > 0,'Canary must exist on the host');
    return {file,bytes:stat.size};
  });
  assert.equal(new Set(files.map(row=>row.file.toLowerCase())).size,files.length);
  const mappings = shares.map(([dir,guest,readOnly])=>
    '    <MappedFolder>\n      <HostFolder>'+xml(dir)+'</HostFolder>\n      <SandboxFolder>'+guest+
    '</SandboxFolder>\n      <ReadOnly>'+readOnly+'</ReadOnly>\n    </MappedFolder>').join('\n');
  const config = '<Configuration>\n  <MemoryInMB>20480</MemoryInMB>\n  <Networking>Disable</Networking>\n  <ClipboardRedirection>Disable</ClipboardRedirection>\n  <MappedFolders>\n'+
    mappings+'\n  </MappedFolders>\n</Configuration>\n';
  writeJson(path.join(evidence,'host-canaries.json'),{schema:'wxslim-isolation-host-v1',files});
  fs.writeFileSync(path.join(evidence,'GLX-offline.wsb'),config,{flag:'wx'});
  console.log('Configuration written. Open it on a Windows host with Windows Sandbox available.');
}
function guestCheck() {
  assert(args.length===0 || (args.length===1 && args[0]==='--after'));
  assert.equal(path.relative(guestSource,source),'','Run inside the configured guest');
  assert.equal(path.relative(ordinary(path.join(guestScratch,'tools/node.exe')),process.execPath),'');
  const host = JSON.parse(fs.readFileSync(path.join(guestEvidence,'host-canaries.json'),'utf8'));
  assert.equal(host.schema,'wxslim-isolation-host-v1');
  assert(host.files.length >= 2);
  const denied = new Set(['EACCES','EPERM','EROFS','ENOENT','ENOTDIR']);
  function probe(file,operation) {
    try {
      const fd = fs.openSync(file,operation);
      fs.closeSync(fd);
      return 'OPENED';
    } catch(error) {
      if (!denied.has(error.code)) throw error;
      return error.code;
    }
  }
  const readme = path.join(guestSource,'README.md');
  assert.equal(probe(readme,'r'),'OPENED');
  const sourceWrite = probe(readme,'r+');
  const paths = host.files.map(row=>({file:row.file,hostBytes:row.bytes,read:probe(row.file,'r')}));
  const externalInterfaces = Object.entries(os.networkInterfaces()).filter(([,addresses])=>addresses.some(a=>!a.internal)).map(([name])=>name);
  const pass = ['EPERM','EACCES','EROFS'].includes(sourceWrite) && paths.every(row=>row.read!=='OPENED') && externalInterfaces.length===0;
  const evidence = {schema:'wxslim-isolation-observation-v1',at:new Date().toISOString(),status:pass?'PASS':'FAILED',
    sourceWrite,paths,externalInterfaces,
    guestResources:{logicalProcessors:os.availableParallelism(),totalMemoryBytes:os.totalmem(),freeMemoryBytes:os.freemem()}};
  writeJson(path.join(guestEvidence,args.length ? 'guest-isolation-after.json' : 'guest-isolation.json'),evidence);
  assert(pass,'Isolation conditions failed. See guest-isolation.json');
  console.log('Read-only source, hidden host canaries and no non-loopback network interface verified.');
}
if(action==='prepare') generate();
else if(action==='guest-check') guestCheck();
else throw Error('Use prepare or guest-check');
