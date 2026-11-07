// Scene-only derivation. Does not build or run an engine, or operate WeChat.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readTree,manifest,hash} from '../functional-acceptance/stage.mjs';
const need=(v,m)=>{if(!v)throw Error(m);};
export function enableSkipSetting(text){
  need(!text.includes('skip_default_3d_prewarm'),'Refuse existing prewarm setting');
  need(!/^\[startup\]\s*$/m.test(text),'Review existing startup section before derivation');
  need(/^\[rendering\]\s*$/m.test(text),'Expected Godot scene project');
  return text.replace(/\s*$/,'')+'\n\n[startup]\ngles3/skip_default_3d_prewarm=true\n';
}
export function prepareScene({source,target}){
  source=path.resolve(source);target=path.resolve(target);need(!fs.existsSync(target),'New scene directory required');
  const inside=(a,b)=>{const r=path.relative(a,b);return !r||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
  need(!inside(source,target)&&!inside(target,source),'Input/output directories must be separate');
  const before=readTree(source,{source:true}),after=new Map(before);need(before.has('project.godot'),'Missing project.godot');
  after.set('project.godot',Buffer.from(enableSkipSetting(before.get('project.godot').toString())));
  const changes=[...after].filter(([p,b])=>!b.equals(before.get(p))).map(([p])=>p);need(changes.length===1&&changes[0]==='project.godot','Only project setting may change');
  fs.mkdirSync(target,{recursive:true});for(const [p,b]of after){const dest=path.join(target,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b,{flag:'wx'});}
  return {schema:'skip-default-prewarm-scene-v1',changes,setting:{name:'startup/gles3/skip_default_3d_prewarm',value:true,requiresPatchedEngine:true},before:manifest(before),after:manifest(after),beforeManifestSha256:hash(JSON.stringify(manifest(before),null,2)+'\n'),afterManifestSha256:hash(JSON.stringify(manifest(after),null,2)+'\n')};
}
export function unpackPck(pck){
  need(pck.subarray(0,4).toString()==='GDPC'&&pck.readUInt32LE(4)===4,'Godot PCK format 4 required');
  const base=Number(pck.readBigUInt64LE(24));let cursor=Number(pck.readBigUInt64LE(32));const count=pck.readUInt32LE(cursor);cursor+=4;const entries=new Map();
  for(let i=0;i<count;i++){
    const len=pck.readUInt32LE(cursor);cursor+=4;const name=pck.toString('utf8',cursor,cursor+len).replace(/\0+$/,'');cursor+=len;
    const offset=Number(pck.readBigUInt64LE(cursor));cursor+=8;const length=Number(pck.readBigUInt64LE(cursor));cursor+=8;const md5=pck.subarray(cursor,cursor+16).toString('hex');cursor+=16;
    need(pck.readUInt32LE(cursor)===0,'Encrypted/removal entry refused');cursor+=4;need(!entries.has(name),'Duplicate PCK entry');
    const data=pck.subarray(base+offset,base+offset+length);need(data.length===length&&crypto.createHash('md5').update(data).digest('hex')===md5,'PCK entry mismatch');entries.set(name,data);
  }return entries;
}
export function projectProperties(bytes){
  need(bytes.subarray(0,4).toString()==='ECFG','Binary Godot project config required');let cursor=4;const count=bytes.readUInt32LE(cursor);cursor+=4;const values=new Map();
  for(let i=0;i<count;i++){const n=bytes.readUInt32LE(cursor);cursor+=4;const name=bytes.toString('utf8',cursor,cursor+n);cursor+=n;const length=bytes.readUInt32LE(cursor);cursor+=4;const raw=bytes.subarray(cursor,cursor+length);cursor+=length;need(raw.length===length&&!values.has(name),'Malformed/duplicate project property');values.set(name,raw);}
  need(cursor===bytes.length,'Unparsed binary config tail');return values;
}
export function compareSkipOnly(beforePck,afterPck){
  const before=unpackPck(beforePck),after=unpackPck(afterPck);need(JSON.stringify([...before.keys()].sort())===JSON.stringify([...after.keys()].sort()),'PCK entry set changed');
  const changed=[...before.keys()].filter(p=>!before.get(p).equals(after.get(p)));need(changed.length===1&&changed[0]==='project.binary','More than project.binary changed');
  const old=projectProperties(before.get('project.binary')),next=projectProperties(after.get('project.binary')),key='startup/gles3/skip_default_3d_prewarm';need(!old.has(key)&&next.has(key),'Expected one added prewarm property');
  need(next.get(key).length===8&&next.get(key).readUInt32LE(0)===1&&next.get(key).readUInt32LE(4)===1,'Expected bool true');
  next.delete(key);need(next.size===old.size,'Other config property added');for(const [n,v]of old)need(next.get(n)?.equals(v),'Other project property changed: '+n);
  return {entryCount:before.size,changedEntries:changed,addedProperty:key,propertyType:'bool',value:true,allOtherEntriesAndPropertiesIdentical:true,beforeSha256:hash(beforePck),afterSha256:hash(afterPck)};
}
