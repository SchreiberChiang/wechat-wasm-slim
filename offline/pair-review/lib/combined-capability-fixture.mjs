// In-memory source composition only. No directories, export, engine or services.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createCapabilityDemoFixture,renderCapabilityDemoInterfaces} from './capability-demo-fixture.mjs';
import {createNetworkObservationFixture} from './network-observation-fixture.mjs';
import {createStorageCnInterfaces} from './storage-validation-cn-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(relative){
  const file=new URL(relative,import.meta.url),before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>128*1024)throw Error('COMBINED_CAPABILITY_SOURCE_INVALID');
  const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
  if(bytes.length!==before.size||['size','mtimeMs','ctimeMs','dev','ino'].some(k=>before[k]!==after[k]))throw Error('COMBINED_CAPABILITY_SOURCE_CHANGED');
  const source=bytes.toString('utf8');if(!Buffer.from(source).equals(bytes))throw Error('COMBINED_CAPABILITY_SOURCE_UTF8');
  return {source,pin:{source:relative,bytes:bytes.length,sha256:sha(bytes)}};
}
const scene=`[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" path="res://simple.tscn" id="1_game"]
[ext_resource type="Script" path="res://combined-pages.gd" id="2_pages"]

[node name="CombinedCapabilityDemo" type="Node"]

[node name="Game" parent="." instance=ExtResource("1_game")]

[node name="NavigationLayer" type="CanvasLayer" parent="."]
layer = 10

[node name="Pages" type="Control" parent="NavigationLayer"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2
script = ExtResource("2_pages")
`;

export function createCombinedCapabilityFixture({storageAssets}={}){
  const base=createCapabilityDemoFixture(),network=createNetworkObservationFixture();
  const files=new Map(base.files),sourcePins={...base.sourcePins};
  // Keep the original independent observation scene/script available, but only
  // the combined main scene creates live observation instances.
  const anchor='run/main_scene="res://capabilities.tscn"',project=files.get('project.godot');
  if(project.split(anchor).length!==2)throw Error('COMBINED_CAPABILITY_MAIN_SCENE_ANCHOR');
  files.set('project.godot',project.replace(anchor,'run/main_scene="res://combined-capabilities.tscn"'));
  files.set('godot-network-observation.gd',network.files.get('godot-network-observation.gd'));
  sourcePins['godot-network-observation.gd']=network.sourcePins['godot-network-observation.gd'];
  for(const [name,relative]of [
    ['combined-pages.gd','./godot-combined-capability-pages.gd'],
    ['combined-input-audio.gd','./godot-combined-input-audio.gd'],
    ['combined-network.gd','./godot-combined-network.gd'],
  ]){
    const item=read(relative);files.set(name,item.source);sourcePins[name]=item.pin;
  }
  files.set('combined-capabilities.tscn',scene);
  const storage=storageAssets!==undefined;
  if(storage){
    // Bytes are supplied by the approved caller; no private path or font tool is
    // embedded, and this function performs no filesystem mutation.
    const {font,license}=storageAssets||{};
    if(!Buffer.isBuffer(font)||font.length!==63548||sha(font)!=='bf2fff152bbfb672170ceafbed03ffde8da6901d36df73e32899dd9e8dbfc46f')throw Error('COMBINED_STORAGE_FONT_PIN');
    if(typeof license!=='string'||sha(license)!=='88f117575237307bdd86a17ef15e21790fc9a662fe4dfb103ca1ca077f0d9982')throw Error('COMBINED_STORAGE_FONT_LICENSE');
    files.set('StorageCJK.otf',Buffer.from(font));files.set('StorageCJK-OFL.txt',license);
    sourcePins['StorageCJK.otf']={source:'explicit checked StorageCJK UI2 subset; large Chinese controls',bytes:font.length,sha256:sha(font)};
    sourcePins['StorageCJK-OFL.txt']={source:'explicit OFL license',bytes:Buffer.byteLength(license),sha256:sha(license)};
    for(const name of ['godot-upstream-storage-observation.gd','godot-storage-validation-cn.gd']){
      const item=read('./'+name);files.set(name,item.source);sourcePins[name]=item.pin;
    }
    for(const name of ['input','network','storage']){
      const item=read('./godot-combined-'+name+'-simple.gd');
      files.set('combined-'+name+'-simple.gd',item.source);sourcePins['combined-'+name+'-simple.gd']=item.pin;
    }
    const application='[application]\n',p=files.get('project.godot');
    if(p.split(application).length!==2||p.includes('config/use_custom_user_dir')||p.includes('config/custom_user_dir_name'))throw Error('COMBINED_STORAGE_USER_ROOT_ANCHOR');
    files.set('project.godot',p.replace(application,application+'config/use_custom_user_dir=true\nconfig/custom_user_dir_name="wxslim_upstream_storage_probe"\n'));
    files.set('combined-capabilities.tscn',scene+'storage_page_enabled = true\nsimple_ui_enabled = true\n');
  }
  const totalBytes=[...files.values()].reduce((n,s)=>n+Buffer.byteLength(s),0);
  if(totalBytes>256*1024)throw Error('COMBINED_CAPABILITY_SOURCE_BUDGET');
  return {schema:'wxslim-combined-capability-fixture-v1',purpose:'DEVELOPMENT_MANUAL_OBSERVATION_NOT_ACCEPTANCE',files,sourcePins,totalBytes,
    unchanged:['simple.gd','simple.tscn','export_presets.cfg','capability-observation.gd','godot-network-observation.gd'],
    changedProjectFields:['application.run/main_scene',...(storage?['application.config/use_custom_user_dir','application.config/custom_user_dir_name']:[])],defaultPage:'Game',
    pages:['Game','Input / Audio','Network desktop',...(storage?['Storage']:[])],pageLifetime:'ONE_INSTANCE_PER_PAGE_STORAGE_LAZY',
    storage:storage?{enabled:true,expectedUserRoot:'/userfs/wxslim_upstream_storage_probe/',fileChecks:'UNCHANGED_INHERITED_CORE',locator:'COMPLETED_WRITE_ONLY',writeAndRead:'MANUAL_ONCE_PER_SESSION',font:'EXPLICIT_PINNED_SUBSET'}:{enabled:false},
    presentation:storage?'CHINESE_PREVIOUS_NEXT_LARGE_ACTIONS_DETAILS_FOLDED':'ORIGINAL_THREE_TAB_SOURCE',
    navigation:'MANUAL_ONLY_BUSY_NETWORK_REFUSES_LEAVE',autoReplay:false,autoConnect:false,
    networkDesktopAuthorization:'EXACT_DEVTOOLS_PLATFORM_AND_MATCHING_SIMPLE_IDENTITY_REQUIRED',
    sourceOnly:true,parser:'NOT_RUN',import:'NOT_RUN',export:'NOT_RUN',runtime:'NOT_RUN',phone:'NOT_RUN',
    executionAuthorizedByFixture:false,
    limitations:['No project or engine generated; source composition only',
      'No new host listener or Simple identity; existing capability interfaces are reused',
      'Hidden input page keeps lifecycle/process and actual audio completion behavior; input is disabled',
      'Network desktop observations need an explicitly authorized bounded loopback service and manual port',
      'No automatic input, IME, audible audio, network backend, visual or device acceptance']};
}

export function renderCombinedCapabilityInterfaces({storageCloud}={}){
  // The existing renderer owns the only listeners and the Simple identity.
  const base=renderCapabilityDemoInterfaces(),scope=read('../convert/assets/combined-capability-scope.js');
  const install=`
(function(root){
  'use strict';
  var targets=[root,root.window,typeof globalThis!=='undefined'?globalThis:null,typeof window!=='undefined'?window:null],unique=[];
  targets.forEach(function(target){
    if(!target||(typeof target!=='object'&&typeof target!=='function')||unique.indexOf(target)!==-1)return;
    if('WxslimCombinedCapabilityScope' in target)throw Error('COMBINED_SCOPE_ALREADY_PRESENT');
    unique.push(target);
  });
  var simple=root.SimpleGlxDelivery;
  if(!simple||typeof simple.getObservationIdentity!=='function')throw Error('COMBINED_SIMPLE_IDENTITY_REQUIRED');
  var create=(function(){var module={exports:{}};
${scope.source}
    return module.exports;}());
  var api=create({wx:root.wx||(typeof wx!=='undefined'?wx:null),identityProvider:function(){return simple.getObservationIdentity();}});
  unique.forEach(function(target){Object.defineProperty(target,'WxslimCombinedCapabilityScope',{value:api,writable:false,configurable:false});});
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);
`;
  const keys=['WxslimCombinedCapabilityScope',...(storageCloud?['UpstreamStorageObservation','StorageValidationFlow','__WXSLIM_STORAGE_CLOUD__','SimpleGlxDelivery']:[])];
  const preflight=`(function(root){[root,root.window,typeof globalThis!=='undefined'?globalThis:null,typeof window!=='undefined'?window:null].forEach(function(target){if(target&&(typeof target==='object'||typeof target==='function')){if(!Object.isExtensible(target))throw Error('COMBINED_GLOBAL_NOT_EXTENSIBLE');${JSON.stringify(keys)}.forEach(function(key){if(key in target)throw Error('COMBINED_SCOPE_ALREADY_PRESENT');});}});})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`;
  const storage=storageCloud?createStorageCnInterfaces({...storageCloud,reuseDelivery:true}):null;
  const forward=storage?`(function(root){'use strict';
 var relay=root.__WXSLIM_STORAGE_CLOUD__,simple=root.SimpleGlxDelivery;
 if(!relay||!simple)throw Error('COMBINED_LOG_INTERFACES_REQUIRED');
 var prefixes=['[CAPABILITY_OBSERVATION]','[NETWORK_PROBE]','[SIMPLE_READY]','[SIMPLE_LIFECYCLE]'];
 ['log','info'].forEach(function(level){var original=console[level];console[level]=function(){
   original.apply(console,arguments);
   var head=arguments[0];
   if(typeof head!=='string'||!prefixes.some(function(prefix){return head.indexOf(prefix)===0;}))return;
   try {var id=JSON.parse(simple.getObservationIdentity());
     var line=Array.prototype.map.call(arguments,function(v){return typeof v==='string'?v:JSON.stringify(v);}).join(' ');
     relay.emit('info','[COMBINED_OBSERVATION] '+JSON.stringify({ref:id.ref,line:line}));
   } catch(error){console.warn('[COMBINED_FORWARD_FAILED]',String(error));}
 };});
 relay.emit('info','[COMBINED_ID] '+simple.getObservationIdentity());
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`:'';
  const source=preflight+base.source+install+(storage?storage.source+forward:''),bytes=Buffer.byteLength(source);
  if(bytes>128*1024)throw Error('COMBINED_CAPABILITY_INTERFACES_BUDGET');
  return {...base,schema:'wxslim-combined-capability-interfaces-v1',source,bytes,sha256:sha(source),
    assets:{...base.assets,'combined-capability-scope.js':{bytes:scope.pin.bytes,sha256:scope.pin.sha256}},
    runtimeScope:{schema:'wxslim-combined-capability-runtime-scope-v1',systemInfoReads:'ONCE_AT_INITIALIZATION',listenersAdded:0,
      desktopEligibility:'platform === devtools with matching bounded Simple identity',nativeStateProof:false},
    storage:storage?{enabled:true,interfacesSha256:storage.sha256,cloud:storage.cloud,identity:'SHARED_SIMPLE_NO_NEW_SESSION',scriptLanguage:'ES2022',nativeChecks:'ONLY_MANUAL_WRITE_BUTTON',observationRelay:'ALLOWLISTED_INPUT_AUDIO_NETWORK_READY_LIFECYCLE',relayIsFullConsole:false}:{enabled:false},
    compositionGeneratorSha256:read('./combined-capability-fixture.mjs').pin.sha256};
}
