// Text-only attribution for future fixed c050 packages. No runtime imports,
// GL calls, engine/PCK transformation or claim of blanket license coverage.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isOfficialC050Profile} from './official-engine-admission.mjs';

export const DISTRIBUTION_SOURCE_FILES=Object.freeze([
  'convert/lib/distribution-notices.mjs','engine/official-distribution-notices.json',
  'engine/alpha-preserve-lighting/LICENSE.godot.txt','engine/official-godot-COPYRIGHT.txt',
  'engine/official-godot-AUTHORS.md','engine/upstream-wxmemfs.LICENSE',
  'engine/alpha-preserve-lighting/GLX_LIBRARY_NOTICE.md'
]);
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
export function renderDistributionNotices(profile){
  assert(isOfficialC050Profile(profile),'DISTRIBUTION_FIXED_C050_PROFILE_REQUIRED');
  const meta=JSON.parse(read('engine/official-distribution-notices.json'));
  assert.equal(meta.schema,'wxslim-official-distribution-notices-v1');
  assert.equal(meta.output,'WXSLIM-THIRD-PARTY-NOTICES.txt');
  assert.equal(meta.sourceCommit,'c050c09b105c3715e1caa57a7109cd752047fd89');
  assert.deepEqual(meta.files.map(x=>x.path),DISTRIBUTION_SOURCE_FILES.slice(2));
  const parts=[Buffer.from('Fixed Godot c050 engine distribution notices\nProfile: '+profile+'\nGodot commit: '+meta.sourceCommit+
    '\nStorage source: godothub/godot-minigame '+meta.upstreamStorageCommit+'\nGLX static library SHA256: '+meta.librarySha256+
    '\n\nThese texts preserve source attributions. They do not license WeChat components, the game assets, or repository-owned code under MIT.\n'+
    'The Godot COPYRIGHT listing covers the upstream source distribution, including optional components; it does not prove that every listed component is linked.\n'+
    'Game asset notices and applicable official converter/SDK/platform terms must be supplied separately.\n')];
  for(const file of meta.files){
    const bytes=read(file.path);assert.equal(bytes.length,file.bytes,'DISTRIBUTION_SOURCE_SIZE');assert.equal(sha(bytes),file.sha256,'DISTRIBUTION_SOURCE_HASH');
    parts.push(Buffer.from('\n===== '+file.title+' =====\n'),bytes,Buffer.from('\n'));
  }
  const buffer=Buffer.concat(parts);
  return {path:meta.output,buffer,receipt:{schema:'wxslim-distribution-notices-v1',profile,path:meta.output,bytes:buffer.length,sha256:sha(buffer),
    sources:meta.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),scope:meta.scope,runtimeChanged:false,blanketLicenseGranted:false}};
}
export function auditDistributionNotices(profile,bytes,receipt){
  const expected=renderDistributionNotices(profile);
  assert(Buffer.isBuffer(bytes)&&bytes.equals(expected.buffer),'DISTRIBUTION_NOTICE_BYTES');
  assert.deepEqual(receipt,expected.receipt,'DISTRIBUTION_NOTICE_RECEIPT');
  return expected.receipt;
}
