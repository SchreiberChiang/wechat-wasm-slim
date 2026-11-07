// In-memory preparation only. No new project, export, conversion or engine mutation.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=relative=>{
  const file=new URL(relative,import.meta.url),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw Error('CAPABILITY_DEMO_SOURCE_INVALID');
  return fs.readFileSync(file);
};
const references={
  'project.godot':'../engine/alpha-preserve-lighting/delivery-project.godot',
  'export_presets.cfg':'../engine/alpha-preserve-lighting/delivery-exports.cfg',
  'simple.tscn':'../engine/alpha-preserve-lighting/delivery-simple.tscn',
  'simple.gd':'../engine/alpha-preserve-lighting/delivery-simple.gd',
  'capability-observation.gd':'./godot-capability-observation.gd'
};
const wrapper=`[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" path="res://simple.tscn" id="1_base"]
[ext_resource type="Script" path="res://capability-observation.gd" id="2_observation"]

[node name="CapabilityObservationDemo" instance=ExtResource("1_base")]

[node name="CapabilityObservationLayer" type="CanvasLayer" parent="."]
layer = 10

[node name="CapabilityObservation" type="Control" parent="CapabilityObservationLayer"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2
script = ExtResource("2_observation")
`;
export function createCapabilityDemoFixture(){
  const files=new Map(),sourcePins={};
  for(const [name,ref] of Object.entries(references)){
    const bytes=read(ref);sourcePins[name]={source:ref,bytes:bytes.length,sha256:sha(bytes)};
    files.set(name,bytes.toString('utf8'));
  }
  const original=files.get('project.godot'),anchor='run/main_scene="res://simple.tscn"';
  if(original.split(anchor).length!==2)throw Error('CAPABILITY_DEMO_MAIN_SCENE_ANCHOR');
  files.set('project.godot',original.replace(anchor,'run/main_scene="res://capabilities.tscn"'));
  files.set('capabilities.tscn',wrapper);
  const totalBytes=[...files.values()].reduce((n,s)=>n+Buffer.byteLength(s),0);
  if(totalBytes>160*1024)throw Error('CAPABILITY_DEMO_SOURCE_BUDGET');
  return {schema:'wxslim-capability-demo-fixture-v1',purpose:'DEVELOPMENT_OBSERVATION_NOT_DEFAULT_GAME',files,sourcePins,totalBytes,
    unchanged:['simple.gd','simple.tscn','export_presets.cfg'],
    changedProjectFields:['application.run/main_scene'],
    observations:['screen-touch and drag distinct from mouse/emulation','manual quiet tone request/finished distinct from audible result','wx callbacks distinct from Godot notifications'],
    limitations:['No automatic visual/audio/device acceptance','No IME/save/network/login implementation in this fixture','No rendering, engine, library, shader or pause-policy changes'],
    sourceOnly:true,import:'NOT_RUN',export:'NOT_RUN',runtime:'NOT_RUN',phone:'NOT_RUN'};
}
export function renderCapabilityDemoInterfaces(){
  const simple=read('../convert/assets/simple-delivery-interface.js');
  const observer=read('../convert/assets/capability-observation-interface.js');
  const bootstrap=`
(function (root) {
  'use strict';
  var create = (function () { var module = {exports:{}};
${observer.toString('utf8')}
  return module.exports; }());
  var simple = root.SimpleGlxDelivery;
  if (!simple || typeof simple.getObservationIdentity !== 'function') throw Error('CAPABILITY_SIMPLE_IDENTITY_REQUIRED');
  var targets = [root, root.window, typeof globalThis !== 'undefined' ? globalThis : null, typeof window !== 'undefined' ? window : null];
  var unique = [];
  targets.forEach(function (target) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function') || unique.indexOf(target) !== -1) return;
    if ('WxslimCapabilityObservation' in target) throw Error('CAPABILITY_INTERFACE_ALREADY_PRESENT');
    unique.push(target);
  });
  var observer = create({wx: root.wx || (typeof wx !== 'undefined' ? wx : null), maxEvents:16,
    identityProvider:function () { return simple.getObservationIdentity(); }});
  var api = Object.freeze({getSnapshot:function () { return observer.getSnapshot(); }});
  unique.forEach(function (target) { target.WxslimCapabilityObservation = api; });
  observer.start();
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
`;
  const preflight=`(function(root){
  'use strict';
  [root,root.window,typeof globalThis !== 'undefined' ? globalThis : null,typeof window !== 'undefined' ? window : null].forEach(function(target){
    if(target && (typeof target === 'object' || typeof target === 'function') && 'WxslimCapabilityObservation' in target) throw Error('CAPABILITY_INTERFACE_ALREADY_PRESENT');
  });
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);\n`;
  const source=preflight+simple.toString('utf8')+bootstrap;
  if(Buffer.byteLength(source)>128*1024)throw Error('CAPABILITY_DEMO_INTERFACES_BUDGET');
  return {schema:'wxslim-capability-demo-interfaces-v1',source,bytes:Buffer.byteLength(source),sha256:sha(source),
    assets:{'simple-delivery-interface.js':{bytes:simple.length,sha256:sha(simple)},'capability-observation-interface.js':{bytes:observer.length,sha256:sha(observer)}},
    generatorSha256:sha(read('./capability-demo-fixture.mjs')),executionAuthorized:false,phone:'NOT_RUN',developmentOnly:true};
}
