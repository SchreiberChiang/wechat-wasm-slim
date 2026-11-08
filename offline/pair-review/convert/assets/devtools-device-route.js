'use strict';
var info=typeof wx.getDeviceInfo==='function'?wx.getDeviceInfo():wx.getSystemInfoSync();
if(!info||typeof info.platform!=='string'||!info.platform)throw Error('WXSLIM_ACCEPTANCE_PLATFORM_MISSING');
var desktop=info.platform==='devtools';
Object.defineProperty(GameGlobal,'__WXSLIM_ACCEPTANCE_ROUTE__',{value:Object.freeze({platform:info.platform,backend:desktop?'webgl':'glx'}),enumerable:true});
if(desktop){require('./start-devtools');}else{require('./start-device');}
