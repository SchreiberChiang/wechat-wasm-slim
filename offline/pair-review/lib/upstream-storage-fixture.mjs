// SOURCE_ONLY: builds small source Maps/strings in memory; never writes a project.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
function reference(relative){
 const file=new URL(relative,import.meta.url),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024)throw Error('UPSTREAM_FIXTURE_SOURCE');
 const bytes=fs.readFileSync(file),source=bytes.toString('utf8');
 if(!Buffer.from(source).equals(bytes))throw Error('UPSTREAM_FIXTURE_UTF8');
 return {source,pin:{source:relative,bytes:bytes.length,sha256:sha(bytes)}};
}
export function createUpstreamStorageFixture(){
 const files=new Map(),sourcePins={};
 for(const[name,relative]of [
  ['godot-upstream-storage-observation.gd','./godot-upstream-storage-observation.gd'],
  ['export_presets.cfg','../engine/alpha-preserve-lighting/delivery-exports.cfg'],
 ]){const r=reference(relative);files.set(name,r.source);sourcePins[name]=r.pin;}
 // Same OS_Web custom user-directory mapping as the existing runtime fixture.
 // Fixed main.cpp:2256 -> core/os/os.cpp:434-441 initializes the directory.
 // This fixture/observer never creates it or selects/replaces a backend mount.
 files.set('project.godot',`config_version=5
[application]
config/name="WXSLIM Upstream Storage Probe"
run/main_scene="res://upstream-storage.tscn"
config/use_custom_user_dir=true
config/custom_user_dir_name="wxslim_upstream_storage_probe"
[display]
window/size/viewport_width=640
window/size/viewport_height=840
window/stretch/mode="canvas_items"
window/handheld/orientation=1
[editor]
export/convert_text_resources_to_binary=false
[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`);
 files.set('upstream-storage.tscn',`[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://godot-upstream-storage-observation.gd" id="1"]
[node name="UpstreamStorageObservation" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1")
`);
 return {schema:'wxslim-upstream-storage-fixture-v1',files,sourcePins,
  filePins:[...files].map(([path,source])=>({path,bytes:Buffer.byteLength(source),sha256:sha(source)})),
  totalBytes:[...files.values()].reduce((n,s)=>n+Buffer.byteLength(s),0),
  expectedUserRoot:'/userfs/wxslim_upstream_storage_probe/',
  prerequisites:['Root-owned profile selects the intended WXMEMFS implementation before main; fixture never mounts',
   'Existing render config/diagnostic and wx are present before installing static interfaces',
   'User root already exists by the explicit button press; files are retained and not retried'],
  sourceOnly:true,parser:'NOT_RUN',import:'NOT_RUN',export:'NOT_RUN',runtime:'NOT_RUN',phone:'NOT_RUN',
  restartRecovery:'NOT_TESTED',durability:'NOT_PROVEN',executionAuthorized:false};
}
export function createUpstreamStorageInterfaces({reuseDelivery=false}={}){
 const delivery=reference('../convert/assets/simple-delivery-interface.js');
 const observer=reference('../convert/assets/upstream-storage-observer.js');
 // All aliases are preflighted BEFORE either interface can be published. The
 // unchanged simple source first publishes its own API, then the same reference
 // and the observation-only API are made visible through every supported alias.
 // This is static source composition, not eval/Function or runtime source loading.
 const source=`// SOURCE_ONLY generated upstream storage observation interfaces.
(function () { 'use strict';
 var targets=[];
 function add(value) {
  if(value && (typeof value==='object'||typeof value==='function') && targets.indexOf(value)<0) targets.push(value);
 }
 if(typeof GameGlobal!=='undefined') add(GameGlobal);
 if(typeof window!=='undefined') add(window);
 if(typeof globalThis!=='undefined') add(globalThis);
 if(!targets.length) throw Error('UPSTREAM_STORAGE_GLOBAL_REQUIRED');
 var initial=targets.slice();
 initial.forEach(function (target) {
  // Browser Window.window is allowed to be an accessor. Read it during
  // preflight, before publication, instead of assuming an own data property.
  var value=target.window;
  if(value!==undefined && value!==null && typeof value!=='object' && typeof value!=='function') throw Error('UPSTREAM_STORAGE_WINDOW_TYPE');
  add(value);
 });
 var keys=${reuseDelivery?"['UpstreamStorageObservation']":"['SimpleGlxDelivery','UpstreamStorageObservation']"};
 targets.forEach(function (target) {
  if(!Object.isExtensible(target)) throw Error('UPSTREAM_STORAGE_GLOBAL_NOT_EXTENSIBLE');
  keys.forEach(function (key) {
   if(key in target) throw Error('UPSTREAM_STORAGE_INTERFACE_CONFLICT');
  });
 });
 var root=typeof GameGlobal!=='undefined'?GameGlobal:globalThis;
 if(!root || !root.__WXSLIM_RENDER_CONFIG__ || !root.__WXSLIM_RENDER_DIAGNOSTIC__) throw Error('UPSTREAM_STORAGE_RENDER_INTERFACE_REQUIRED');
 var createObserver=(function () {
  var module={exports:{}};
${observer.source}
  return module.exports;
 })();
${reuseDelivery?` // Combined demo owns the existing identity. Never create another session.
 if(!root.SimpleGlxDelivery) throw Error('UPSTREAM_STORAGE_SHARED_DELIVERY_REQUIRED');
 targets.forEach(function(target){
  if('SimpleGlxDelivery' in target && target.SimpleGlxDelivery!==root.SimpleGlxDelivery) throw Error('UPSTREAM_STORAGE_SHARED_DELIVERY_CONFLICT');
 });`:delivery.source}
 var delivery=root.SimpleGlxDelivery;
 if(!delivery || typeof delivery.sceneReady!=='function' || typeof delivery.getObservationIdentity!=='function') throw Error('UPSTREAM_STORAGE_DELIVERY_REQUIRED');
 var wxApi=root.wx || (typeof wx!=='undefined'?wx:{});
 var api=createObserver({wx:wxApi,delivery:delivery});
 targets.forEach(function (target) {
  if(target!==root) target.SimpleGlxDelivery=delivery;
  target.UpstreamStorageObservation=api;
 });
})();
`;
 return {schema:'wxslim-upstream-storage-interfaces-v1',source,
  sourcePins:{simpleDelivery:delivery.pin,upstreamStorageObserver:observer.pin},
  bytes:Buffer.byteLength(source),sha256:sha(source),
  installation:'Explicit evaluation by a future approved package only; source generation installs nothing.',
  interfaceNames:['SimpleGlxDelivery','UpstreamStorageObservation'],
  globals:['GameGlobal','window','globalThis','window aliases'],
  identity:'Existing SimpleGlxDelivery package/session/backend observation; no additional session',reuseDelivery,
  storageBackendInstalled:false,mountChanged:false,sourceOnly:true,runtime:'NOT_RUN',phone:'NOT_RUN',executionAuthorized:false};
}
