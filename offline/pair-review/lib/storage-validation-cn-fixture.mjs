import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createUpstreamStorageFixture,createUpstreamStorageInterfaces} from './upstream-storage-fixture.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
export function createStorageCnFixture(){
 const base=createUpstreamStorageFixture();
 const files=new Map(base.files);
 files.set('godot-storage-validation-cn.gd',read('./godot-storage-validation-cn.gd'));
 const scene=files.get('upstream-storage.tscn');
 files.set('upstream-storage.tscn',scene.replace('res://godot-upstream-storage-observation.gd','res://godot-storage-validation-cn.gd'));
 files.set('project.godot',files.get('project.godot').replace('WXSLIM Upstream Storage Probe','中文存档验证'));
 return {files,baseCoreSha256:sha(files.get('godot-upstream-storage-observation.gd'))};
}
export function createStorageCnInterfaces({env,build,reuseDelivery=false,localOnly=false}){
 if(localOnly ? env!==undefined || build!==undefined : !/^[a-zA-Z0-9-]{1,100}$/.test(env)||!/^[-.a-zA-Z0-9_]{1,90}$/.test(build))throw Error('CLOUD_CONFIG');
 const base=createUpstreamStorageInterfaces({reuseDelivery}),flow=read('../convert/assets/storage-validation-flow.js');
 const relay=read('../split/assets/phone-log.js');
 const cloud=localOnly ? `(function(root){'use strict';
 root.__WXSLIM_STORAGE_CLOUD__=Object.freeze({emit:function(){},status:function(){return {available:false,localOnly:true};}});
 })(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n` : `(function(root){'use strict';
 var install=(function(){var module={exports:{}};\n${relay}\nreturn module.exports.installPhoneLog;}());
 var real=console, quiet={log:function(){},info:function(){},warn:function(){},error:function(){},debug:function(){}},accepted=0,limited=0,stopped=false;
 var api=install(wx,quiet,${JSON.stringify({enabled:true,env,build,functionName:'phoneLogIngest'})});
 function scrub(value){return String(value).replace(/[A-Za-z]:[\\\\/][^\\s"<>]+/g,'[local-path]').replace(/(?:wxfile|file):[^\\s"<>]+/g,'[private-path]').replace(/wx[a-f0-9]{16}/g,'[appid]');}
 function emit(level,text){if(stopped)return;if(accepted>=128){limited++;return;}accepted++;if(api)quiet[level](scrub(text));}
 function status(){return Object.assign({available:!!api,stopped:stopped,accepted:accepted,limited:limited},api?api.status():{});}
 root.__WXSLIM_STORAGE_CLOUD__={emit:emit,status:status};
 ['error','warn'].forEach(function(level){var original=real[level];real[level]=function(){original.apply(real,arguments);emit(level,Array.prototype.map.call(arguments,function(v){try{return v&&v.stack?v.stack:typeof v==='string'?v:JSON.stringify(v);}catch(_){return '[unserializable]';}}).join(' '));};});
 ['onShow','onHide'].forEach(function(name){if(typeof wx[name]==='function')wx[name](function(){emit('info','[STORAGE_LIFECYCLE] '+name);if(api)api.flush();});});
 if(typeof wx.onError==='function')wx.onError(function(error){emit('error','[STORAGE_UNCAUGHT] '+String(error));if(api)api.flush();});
 if(typeof wx.onUnhandledRejection==='function')wx.onUnhandledRejection(function(event){emit('error','[STORAGE_REJECTION] '+String(event.reason));if(api)api.flush();});
 if(api)setTimeout(function(){api.stop();stopped=true;},600000);
 })(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`;
 const bind=`\n(function(root){'use strict';
 var create=(function(){var module={exports:{}};\n${flow}\nreturn module.exports;}());
 // The SDK may expose WXGameKit as a lexical global rather than a root field.
 var access={};Object.defineProperties(access,{__WXSLIM_BOOT_STATE__:{get:function(){return root.__WXSLIM_BOOT_STATE__;}},__WXSLIM_RENDER_CONFIG__:{get:function(){return root.__WXSLIM_RENDER_CONFIG__;}},WXGameKit:{get:function(){return typeof WXGameKit!=='undefined'?WXGameKit:root.WXGameKit;}}});
 var relay=root.__WXSLIM_STORAGE_CLOUD__;
 var api=create({wx:wx,observer:root.UpstreamStorageObservation,root:access,
 log:function(text){console.info(text);relay.emit('info',text);},cloudStatus:relay.status});
 [root,root.window,typeof window!=='undefined'?window:null,typeof globalThis!=='undefined'?globalThis:null].forEach(function(target){if(target)target.StorageValidationFlow=api;});
 })(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`;
 // Shared composition must reject collisions before installing any log hooks.
 const preflight=reuseDelivery?`(function(root){'use strict';
 if(!root.SimpleGlxDelivery)throw Error('STORAGE_CN_SHARED_DELIVERY_REQUIRED');
 [root,root.window,typeof window!=='undefined'?window:null,typeof globalThis!=='undefined'?globalThis:null].forEach(function(target){
 if(!target)return;
 if(!Object.isExtensible(target))throw Error('STORAGE_CN_GLOBAL_NOT_EXTENSIBLE');
 ['UpstreamStorageObservation','StorageValidationFlow','__WXSLIM_STORAGE_CLOUD__'].forEach(function(key){if(key in target)throw Error('STORAGE_CN_INTERFACE_CONFLICT');});
 if('SimpleGlxDelivery' in target&&target.SimpleGlxDelivery!==root.SimpleGlxDelivery)throw Error('STORAGE_CN_SHARED_DELIVERY_CONFLICT');
 });})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`:'';
 const source=preflight+cloud+base.source+bind;
 return {source,sha256:sha(source),bytes:Buffer.byteLength(source),cloud:localOnly?{available:false,localOnly:true}:{build,maxEntries:128,sessionMs:600000,entryMaxChars:4096,queueLimit:256,existingFunction:'phoneLogIngest'},baseInterfacesSha256:base.sha256};
}
