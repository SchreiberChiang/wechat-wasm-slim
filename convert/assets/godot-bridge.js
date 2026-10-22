/* wechat-wasm-slim convert：Godot 启动桥（追加到 Godot 导出 JS 末尾，再交给官方 wx-transformer）。
 * 来源：打砖块手工版 wxgamekit-15/godot-bridge.js 的最终形态，去掉了打砖块的 PCK 名称/字节数常量和本地存储诊断。
 * 顺序：Godot 工厂 → initConfig → initFS → 用数据包里取出的 PCK 做 copyToFS → 只调用一次 callMain(--main-pack)。
 */
(function (root) {
  'use strict';
  function check(value, code) { if (!value) throw Error(code); }
  // 较新的微信分支引擎把 emscripten_get_now 绑定到全局 nowPolyfill（模板版由 engine/godot-sdk.js 提供，写法与它一致）。
  if (typeof root.nowPolyfill !== 'function') {
    var nowStart = Date.now(), nowPolyfill = function () { return Date.now() - nowStart; };
    root.nowPolyfill = nowPolyfill;
    if (root.window && root.window !== root) root.window.nowPolyfill = nowPolyfill;
    if (typeof GameGlobal !== 'undefined') GameGlobal.nowPolyfill = nowPolyfill;
    if (typeof globalThis !== 'undefined') globalThis.nowPolyfill = nowPolyfill;
  }
  function start(factory, module, options) {
    var opts = options || {}, wxApi = opts.wx || root.wx || (typeof wx!=='undefined' ? wx : null);
    if(root.__WXSLIM_BOOT_STATE__ && root.__WXSLIM_BOOT_STATE__.factoryCalls>0) return Promise.reject(Error('WXSLIM_RESTART_REQUIRED'));
    var state = {stage:'NEW', factoryCalls:0, runtimeInitialized:false, packMounted:false, mainCalls:0};
    var ownedAudio=null, ownedSdk=null, previousRuntimeCallback=null;
    root.__WXSLIM_BOOT_STATE__ = state;
    function mark(stage) { state.stage=stage; state.events=state.events||[]; if(state.events.length<32)state.events.push({stage:stage,at:Date.now()}); if(typeof console!=='undefined' && typeof console.log==='function') console.log('[WXSLIM_BOOT]', stage); }
    function releaseOwnedAudio() {
      var owned=ownedAudio;ownedAudio=null;
      if(owned && owned.state!=='closed' && typeof owned.close==='function')Promise.resolve(owned.close()).catch(function(){});
      if(ownedSdk && root.GODOTSDK===ownedSdk)delete root.GODOTSDK;
      ownedSdk=null;
    }
    return Promise.resolve().then(function () {
      check(typeof factory==='function' && module && typeof module==='object','WXSLIM_FACTORY_CONFIG');
      check(typeof opts.readPack==='function' && typeof opts.packPath==='string' && opts.packPath.charAt(0)==='/','WXSLIM_PACK_OPTIONS_REQUIRED');
      check(Number.isInteger(opts.expectedPackBytes) && opts.expectedPackBytes>0,'WXSLIM_PACK_SIZE_REQUIRED');
      check(wxApi && typeof wxApi.getFileSystemManager==='function','WXSLIM_WX_FS_REQUIRED');
      check(module.canvas || root.canvas,'WXSLIM_CANVAS_REQUIRED');
      check(root.__WXSLIM_RENDER_DIAGNOSTIC__,'WXSLIM_RENDER_RUNTIME_REQUIRED');
      root.__WXSLIM_RENDER_DIAGNOSTIC__.prepare(module,opts.renderMode);
      var ownsAudio=false;
      if(!root.GODOTSDK) {
        check(typeof wxApi.createWebAudioContext==='function','WXSLIM_NATIVE_AUDIO_REQUIRED');
        var context=wxApi.createWebAudioContext();
        check(context && typeof context.createGain==='function' && typeof context.createBuffer==='function','WXSLIM_INVALID_AUDIO_CONTEXT');
        root.GODOTSDK={audio:{WEBAudio:{audioContext:context}}};ownsAudio=true;ownedAudio=context;ownedSdk=root.GODOTSDK;
      }
      check(root.GODOTSDK.audio && root.GODOTSDK.audio.WEBAudio && root.GODOTSDK.audio.WEBAudio.audioContext,'WXSLIM_COMMUNITY_AUDIO_REQUIRED');
      var nativeMonitor=module.monitorRunDependencies;
      module.monitorRunDependencies=function(left){ state.runDependencyCount=left; if(typeof nativeMonitor==='function')return nativeMonitor.apply(this,arguments); };
      var nativeInstantiated=module.wasmInstantiated;
      module.wasmInstantiated=function(){ state.wasmInstantiatedCalls=(state.wasmInstantiatedCalls||0)+1; mark('WASM_INSTANTIATED'); if(typeof nativeInstantiated==='function')return nativeInstantiated.apply(this,arguments); };
      var nativeCalledMain=module.calledMainCb;
      module.calledMainCb=function(){state.calledMainCallbacks=(state.calledMainCallbacks||0)+1;if(typeof nativeCalledMain==='function')return nativeCalledMain.apply(this,arguments);};
      var notifyRuntime=module.onRuntimeInitialized;previousRuntimeCallback=notifyRuntime;
      module.onRuntimeInitialized=function(){ state.runtimeInitialized=true; };
      module.noInitialRun=true;
      mark('FACTORY_START');state.factoryCalls++;
      return Promise.resolve(factory(module)).then(function (m) {
        check(m===module,'WXSLIM_MODULE_IDENTITY_CHANGED');
        root.__WXSLIM_RENDER_DIAGNOSTIC__.attach(m);
        check(typeof m.initConfig==='function' && typeof m.initFS==='function' && typeof m.copyToFS==='function' && typeof m.callMain==='function','WXSLIM_GODOT_EXPORTS_REQUIRED');
        mark('GODOT_RUNTIME_READY');
        m.initConfig({canvas:m.canvas || root.canvas,canvasResizePolicy:2,locale:opts.locale || 'en',virtualKeyboard:false,persistentDrops:false,focusCanvas:false,godotPoolSize:4,onExit:function(code){
          root.__WXSLIM_RENDER_DIAGNOSTIC__.exit(code);
          if(ownsAudio)releaseOwnedAudio();
          if(typeof opts.onExit==='function')opts.onExit(code);
        }});
        return Promise.resolve(m.initFS([])).then(function(){
          mark('FS_READY');return opts.readPack();
        }).then(function (data) {
          var bytes=data instanceof Uint8Array ? data : new Uint8Array(data);
          check(bytes.byteLength===opts.expectedPackBytes && bytes[0]===71 && bytes[1]===68 && bytes[2]===80 && bytes[3]===67,'WXSLIM_PCK_PIN_SIZE_OR_HEADER');
          m.copyToFS(opts.packPath,bytes);state.packMounted=true;
          if(m.__WXSLIM_CUSTOM_PCK_BYTES__===bytes)delete m.__WXSLIM_CUSTOM_PCK_BYTES__;
          var nativeMain=m.callMain;
          m.callMain=function(args){
            check(state.packMounted,'WXSLIM_MAIN_BEFORE_PACK');
            check(state.mainCalls===0,'WXSLIM_DUPLICATE_MAIN');
            var actual=Array.isArray(args)?args.slice():[];
            var packIndex=actual.indexOf('--main-pack');
            if(packIndex<0)actual.push('--main-pack',opts.packPath);
            else check(actual[packIndex+1]===opts.packPath,'WXSLIM_UNEXPECTED_MAIN_PACK');
            state.mainCalls++;mark('CALL_MAIN');
            try {
              var result=nativeMain.call(m,actual);
              root.__WXSLIM_RENDER_DIAGNOSTIC__.complete(result);
              return result;
            } catch(error) {
              root.__WXSLIM_RENDER_DIAGNOSTIC__.fail(error);
              throw error;
            }
          };
          mark('PACK_READY_WAITING_LOADER_MAIN');
          module.onRuntimeInitialized=notifyRuntime;
          if(typeof notifyRuntime==='function')notifyRuntime.call(m);
          if(opts.autoCallMainAfterMount===true){if(state.mainCalls===0)m.callMain(opts.arguments || []);mark('MAIN_RETURNED');}
          return m;
        });
      });
    }).catch(function(error){
      state.error=String(error && error.message || error);mark('FAILED');
      if(root.__WXSLIM_RENDER_DIAGNOSTIC__)root.__WXSLIM_RENDER_DIAGNOSTIC__.fail(error);
      if(module && typeof module==='object')module.onRuntimeInitialized=previousRuntimeCallback;
      if(state.mainCalls===0)releaseOwnedAudio();
      throw error;
    });
  }
  root.__WXSLIM_GODOT_BRIDGE__={start:start};
})(typeof GameGlobal!=='undefined' ? GameGlobal : globalThis);

if(typeof Module!=='undefined' && typeof readyPromiseResolve==='function' && typeof readyPromiseReject==='function') {
 var wxslimOuterResolve=readyPromiseResolve, wxslimOuterReject=readyPromiseReject;
 (typeof GameGlobal!=='undefined'?GameGlobal:globalThis).__WXSLIM_GODOT_BRIDGE__.start(Godot,Module,{autoCallMainAfterMount:true,renderMode:__WXSLIM_RENDER_MODE__,locale:__WXSLIM_LOCALE__,expectedPackBytes:GameGlobal.__WXSLIM_PACKAGE_META__.pckBytes,packPath:GameGlobal.__WXSLIM_PACKAGE_META__.pck.filename,readPack:function(){
 if(Module.__WXSLIM_CUSTOM_PACKAGE_READY__!==true)throw Error('WXSLIM_CUSTOM_PACKAGE_NOT_VALIDATED');
 var owned=Module.__WXSLIM_CUSTOM_PCK_BYTES__;
 if(!owned || owned.byteLength!==GameGlobal.__WXSLIM_PACKAGE_META__.pckBytes)throw Error('WXSLIM_RETAINED_PACKAGE_MISSING');
 return owned;
}}).then(wxslimOuterResolve,wxslimOuterReject);
}
