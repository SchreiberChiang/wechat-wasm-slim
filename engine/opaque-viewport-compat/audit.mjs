import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const own=path.join(repo,'examples/glx-opaque-alpha-compat');
const base=path.join(repo,'examples/glx-case4-alpha-mix');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(dir,n)=>fs.readFileSync(path.join(dir,n));
const changed=new Set(['renderer.gd','renderer.gd.uid','cases.json','export_presets.cfg']);
const retained=[];
for(const item of fs.readdirSync(own,{withFileTypes:true})){
  const n=item.name;
  if(item.isFile() && fs.existsSync(path.join(base,n)) && !changed.has(n) && n!=='README.md'){
    assert(read(own,n).equals(read(base,n)),`retained baseline bytes: ${n}`);retained.push(n);
  }
}
const a=JSON.parse(read(own,'cases.json')),b=JSON.parse(read(base,'cases.json'));
assert.deepEqual(a.cards.filter(c=>c.id!=='D15-alpha'),b.cards.filter(c=>c.id!=='D15-alpha'));
const shader=read(own,'opaque_viewport_mix.gdshader').toString();
assert(shader.includes('render_mode blend_mix;'));
assert(shader.includes('opaque_ui_alpha = COLOR.a;'));
assert(shader.includes('COLOR.a = opaque_ui_alpha;'));
assert(!/\btexture\s*\(|COLOR\s*=|COLOR\.rgb\s*=/.test(shader));
const guard=read(own,'opaque_viewport_compat.gd').toString().replace(/^\s*#.*$/gm,'');
for(const text of ['source.transparent_bg','target.texture != source.get_texture()','"android"','"glx"','"observed"','target.use_parent_material','target.material != owned_material','frame_pre_draw.connect(refresh)','not enabled','target.get_script() != null','platform_evidence().android','device.has("platform")','device.get("system", null)'])assert(guard.includes(text),text);
assert(!/has_alpha\s*\(|OS\.get_name|OS\.has_feature/.test(guard));
assert(read(own,'export_presets.cfg').toString().includes('compat_verify.gd,'));
assert(!guard.includes('if host_context.get("resultTrack"'));
assert(guard.includes('"platformEvidence": platform_evidence()'));
let packed=null;
if(process.argv[2]){
 const pck=fs.readFileSync(process.argv[2]);assert.equal(pck.toString('ascii',0,4),'GDPC');
 const offset=Number(pck.readBigUInt64LE(24));let cursor=Number(pck.readBigUInt64LE(32));const count=pck.readUInt32LE(cursor);cursor+=4;const files=new Map();
 for(let i=0;i<count;i++){
  const n=pck.readUInt32LE(cursor);cursor+=4;const name=pck.toString('utf8',cursor,cursor+n).replace(/\0+$/,'');cursor+=n;
  const pos=Number(pck.readBigUInt64LE(cursor));cursor+=8;const size=Number(pck.readBigUInt64LE(cursor));cursor+=8;const hash=pck.subarray(cursor,cursor+16).toString('hex');cursor+=16;assert.equal(pck.readUInt32LE(cursor),0);cursor+=4;
  const payload=pck.subarray(offset+pos,offset+pos+size);assert.equal(crypto.createHash('md5').update(payload).digest('hex'),hash);files.set(name,payload);
 }
 assert(![...files.keys()].some(n=>/compat_verify|compat_gate_verify|alpha_mix_verify|local_verify|build_font/.test(n)));
 for(const n of ['renderer.gd','renderer_base.gd','renderer_round3.gd','opaque_viewport_compat.gd','opaque_viewport_mix.gdshader','cases.json'])assert(files.get(n)?.equals(read(own,n)),`PCK source bytes: ${n}`);
 assert(files.has('fonts/AcceptanceCJK.otf.import'));
 assert([...files.keys()].some(n=>n.includes('AcceptanceCJK.otf-') && n.endsWith('.fontdata')));
 packed={sha256:sha(pck),bytes:pck.length,files:files.size,externalHarnessExcluded:true};
}
console.log(JSON.stringify({outcome:'PASS',retainedFiles:retained,otherCardsUnchanged:true,shaderPolicy:'RGB untouched; sampled alpha replaced by pre-sample UI alpha; one default sample',packed},null,2));




