// In-memory PCK/settings models; no engine, fixture project or file writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditResourceGameBootPck,inspectResourceGameBoot} from '../lib/resource-game-boot-audit.mjs';
import {createResourceGameFacadeSources} from '../lib/resource-game-facade-sources.mjs';
import {resourceCommand} from '../lib/resource-pack-cli.mjs';

const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
function string(s){const b=Buffer.from(s),pad=Buffer.alloc((4-b.length%4)%4);return Buffer.concat([u32(4),u32(b.length),b,pad]);}
function settings(pairs){return Buffer.concat([Buffer.from('ECFG'),u32(pairs.length),...pairs.flatMap(([k,v])=>{const key=Buffer.from(k),value=typeof v==='string'?string(v):v;return [u32(key.length),key,u32(value.length),value];})]);}
function pack(files){
  const rows=[...files].map(([name,value])=>{const text=Buffer.from(name),p=Buffer.alloc(Math.ceil(text.length/4)*4);text.copy(p);return {path:p,data:Buffer.from(value)};});
  const end=112+rows.reduce((n,p)=>n+p.data.length,0),b=Buffer.alloc(end+4+rows.reduce((n,p)=>n+4+p.path.length+36,0));
  b.write('GDPC');b.writeUInt32LE(4,4);[4,7,2].forEach((v,i)=>b.writeUInt32LE(v,8+i*4));b.writeUInt32LE(2,20);b.writeBigUInt64LE(112n,24);b.writeBigUInt64LE(BigInt(end),32);b.writeUInt32LE(rows.length,end);
  let at=end+4,offset=0;
  for(const p of rows){b.writeUInt32LE(p.path.length,at);at+=4;p.path.copy(b,at);at+=p.path.length;b.writeBigUInt64LE(BigInt(offset),at);b.writeBigUInt64LE(BigInt(p.data.length),at+8);createHash('md5').update(p.data).digest().copy(b,at+16);at+=36;p.data.copy(b,112+offset);offset+=p.data.length;}
  return b;
}
function fixture(){
  const bundle=createResourceGameFacadeSources(),files=new Map(bundle.files),props=[['application/run/main_scene','res://boot.tscn'],['autoload/WxResource','*res://godot-resource-game-facade.gd']];
  files.set('boot.tscn','[gd_scene format=3]\n[node name="Boot" type="Node"]');
  return {files,props,build(){files.set('project.binary',settings(props));return pack(files);}};
}
const audit=f=>auditResourceGameBootPck(f.build(),{entryScene:'res://boot.tscn'}),codes=r=>r.blockers.map(b=>b.code);

test('checks actual exported script and settings bytes without claiming runtime or scene semantics',()=>{
  const f=fixture(),bytes=f.build(),before=Buffer.from(bytes),r=auditResourceGameBootPck(bytes,{entryScene:'res://boot.tscn'});
  assert.equal(r.status,'PASS_REQUIRED_BOOT_WIRING_BYTES_ONLY');assert.equal(r.scripts.length,4);assert.deepEqual(r.blockers,[]);assert(bytes.equals(before));
  assert.equal(r.settings.autoload,'*res://godot-resource-game-facade.gd');assert.equal(r.scene.mapping,'DIRECT');assert.equal(r.runtimeEligible,false);assert.equal(r.sceneSemantics,'NOT_PARSED_OR_RUN');assert.equal(r.phone,'NOT_RUN');
});
test('missing or altered runtime source is blocked even when PCK directory hashes are self-consistent',()=>{
  for(const name of createResourceGameFacadeSources().files.keys()){
    const missing=fixture();missing.files.delete(name);assert(codes(audit(missing)).includes('RESOURCE_BOOT_SCRIPT_MISSING'));
    const altered=fixture();altered.files.set(name,altered.files.get(name)+'\n');assert(codes(audit(altered)).includes('RESOURCE_BOOT_SCRIPT_SOURCE_MISMATCH'));
  }
});
test('compiled or remapped scripts cannot be accepted merely because source text is present',()=>{
  for(const name of ['godot-resource-game-facade.gd.remap','godot-resource-game-facade.gdc','godot-resource-game-facade.gdc.remap']){
    const f=fixture();f.files.set(name,'compiled-or-redirected');assert(codes(audit(f)).includes('RESOURCE_BOOT_SCRIPT_REDIRECT_UNVERIFIED'));
  }
});
test('autoload disablement, missing binding, duplicate resident runtime and main mismatch block',()=>{
  const disabled=fixture();disabled.props[1][1]=disabled.props[1][1].slice(1);assert(codes(audit(disabled)).includes('RESOURCE_BOOT_AUTOLOAD_REQUIRED'));
  const missing=fixture();missing.props.pop();assert(codes(audit(missing)).includes('RESOURCE_BOOT_AUTOLOAD_REQUIRED'));
  for(const p of [['autoload/Other','*res://godot-resource-pack-session.gd'],['autoload/WxResourceReceiver','*res://other.gd']]){const f=fixture();f.props.push(p);assert(codes(audit(f)).includes('RESOURCE_BOOT_DUPLICATE_RUNTIME_AUTOLOAD'));}
  const main=fixture();main.props[0][1]='uid://unknown';assert(codes(audit(main)).includes('RESOURCE_BOOT_MAIN_SCENE_MISMATCH'));
});
test('actual scene remap target must be owned; ambiguous, missing and malformed mappings fail',()=>{
  const f=fixture();f.files.delete('boot.tscn');f.files.set('boot.tscn.remap','[remap]\npath="res://.godot/exported/boot.scn"\n');f.files.set('.godot/exported/boot.scn','binary-scene-model');
  assert.equal(audit(f).status,'PASS_REQUIRED_BOOT_WIRING_BYTES_ONLY');assert.equal(audit(f).scene.mapping,'EXPORTED_SCENE_REMAP');
  f.files.set('boot.tscn','text');assert(codes(audit(f)).includes('RESOURCE_BOOT_AMBIGUOUS_SCENE_MAPPING'));f.files.delete('boot.tscn');
  f.files.delete('.godot/exported/boot.scn');assert(codes(audit(f)).includes('RESOURCE_BOOT_SCENE_TARGET_UNVERIFIED'));
  f.files.set('boot.tscn.remap','[remap]\npath="res://../outside.scn"\n');assert(codes(audit(f)).includes('RESOURCE_BOOT_SCENE_TARGET_UNVERIFIED'));
  f.files.set('boot.tscn.remap','unknown format');assert(codes(audit(f)).includes('RESOURCE_BOOT_SCENE_REMAP_UNVERIFIED'));
  f.files.delete('boot.tscn.remap');assert(codes(audit(f)).includes('RESOURCE_BOOT_MAIN_SCENE_MISSING'));
});
test('binary settings reject duplicate keys, wrong scalar types and extra payload',()=>{
  const duplicate=fixture();duplicate.props.push(duplicate.props[1]);assert.throws(()=>audit(duplicate),{code:'RESOURCE_BOOT_SETTINGS_DUPLICATE'});
  const typed=fixture();typed.props[1][1]=Buffer.concat([u32(1),u32(1)]);assert.throws(()=>audit(typed),{code:'RESOURCE_BOOT_SETTINGS_STRING_TYPE'});
  const tail=fixture();tail.props[1][1]=Buffer.concat([string('*res://godot-resource-game-facade.gd'),u32(0)]);assert.throws(()=>audit(tail),{code:'RESOURCE_BOOT_SETTINGS_TAIL'});
  const padding=fixture();const value=string('x');value[value.length-1]=1;padding.props[1][1]=value;assert.throws(()=>audit(padding),{code:'RESOURCE_BOOT_SETTINGS_STRING_PADDING'});
});
test('unrelated bounded variants are skipped, not executed or forced into string types',()=>{
  const f=fixture();f.props.push(['application/config/unknown',Buffer.concat([u32(24),u32(0)])]);assert.equal(audit(f).status,'PASS_REQUIRED_BOOT_WIRING_BYTES_ONLY');
});
test('feature-specific main/autoload overrides cannot be treated as the base wiring',()=>{
  for(const key of ['application/run/main_scene.web','autoload/WxResource.web','autoload/WxResourceReceiver.mobile']){
    const f=fixture();f.props.push([key,'res://another.tscn']);assert(codes(audit(f)).includes('RESOURCE_BOOT_WIRING_FEATURE_OVERRIDE_UNVERIFIED'));
  }
});
test('malformed pack, settings, entry and command arguments fail explicitly before I/O',()=>{
  const f=fixture(),bytes=f.build();bytes[120]^=1;assert.throws(()=>auditResourceGameBootPck(bytes,{entryScene:'res://boot.tscn'}),{code:'PCK_MD5'});
  assert.throws(()=>auditResourceGameBootPck(f.build(),{entryScene:'res://../boot.tscn'}),{code:'RESOURCE_BOOT_ENTRY_SCENE'});
  f.files.set('project.binary',Buffer.from('ECFG'));assert.throws(()=>auditResourceGameBootPck(pack(f.files),{entryScene:'res://boot.tscn'}),{code:'RESOURCE_BOOT_SETTINGS_BOUNDS'});
  assert.throws(()=>inspectResourceGameBoot({schema:'wrong'}),{code:'RESOURCE_BOOT_REQUEST'});
  assert.throws(()=>resourceCommand(['boot-check','unused','--write']),{code:'RESOURCE_BOOT_ARGUMENTS'});
});
