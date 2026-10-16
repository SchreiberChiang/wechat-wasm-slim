// WX15 timing summary. Loaded first from game.js; clock = Date.now() from game.js start
// (excludes WeChat's main-package download before game.js runs).
(function(root){
 'use strict';
 var t0=Date.now(),marks={},click=null,summaries=[],callMainMs=null,firstDone=false;
 var fmt=function(v){return v==null?'未知':Math.round(v)+'ms';},mb=function(b){return b?(b/1e6).toFixed(2)+'MB':'未知';},SZ=root.__WX15_SIZES__||{};
 var since=function(k){return marks[k]!=null?marks[k]-t0:null;};
 var device='';try{var i=wx.getSystemInfoSync();device=(i.platform||'')+' '+(i.model||'')+' 微信'+(i.version||'')+' 基础库'+(i.SDKVersion||'');}catch(_){}
 function emit(text,data){summaries.push(data);try{wx.setStorageSync('WX15_TIMING_SUMMARY',summaries);}catch(_){}console.info('[WX15_TIMING] '+text,JSON.stringify(data));}
 var dropped={spam:0,dupErrors:0};
 var sh={compiles:0,compileUs:0,slowest:null,firsts:0,dropped:0,failed:0};
 function shaderText(scope){if(!sh.compiles&&!sh.firsts&&!sh.failed&&scope.indexOf('再次')===0)return;var t='着色器('+scope+')：编译 '+sh.compiles+' 次共 '+fmt(sh.compileUs/1000)+(sh.slowest?'（最慢 '+sh.slowest.name+' '+fmt(sh.slowest.us/1000)+'）':'')+(sh.failed?' 失败 '+sh.failed+' 次':'')+' | 首次使用 '+sh.firsts+' 个 | 已拦截重复绑定日志 '+sh.dropped+' 行 | 其它刷屏 '+dropped.spam+' 行 | 重复错误 '+dropped.dupErrors+' 行';
  var d={kind:'shader',scope:scope,compiles:sh.compiles,compileMs:Math.round(sh.compileUs/1000),slowest:sh.slowest,firsts:sh.firsts,droppedBindLogs:sh.dropped,failed:sh.failed};sh.compiles=0;sh.compileUs=0;sh.slowest=null;sh.firsts=0;sh.failed=0;emit(t,d);}
 function first(force){
  if(firstDone||marks.two_d_first_frame==null||(callMainMs==null&&!force))return;firstDone=true;
  var total=since('two_d_first_frame'),wasm=since('primary_wasm_ready');
  emit('首包进场景：总计 '+fmt(total)+'（从游戏脚本开始计） | 插件加载器就绪 '+fmt(since('loader_start_ok'))+' | 首包WASM('+mb(SZ.primaryBr)+')下载编译就绪 '+fmt(wasm)+' | WASM就绪到2D首帧 '+fmt(total!=null&&wasm!=null?total-wasm:null)+'（其中callMain '+fmt(callMainMs)+'） | 未下载剩余WASM | WASM堆 '+mb(heap())+' | '+device+bench,
   {kind:'first_scene',heapBytes:heap(),totalMs:total,primaryWasmBytes:SZ.primaryBr||null,loaderReadyMs:since('loader_start_ok'),primaryWasmReadyMs:wasm,callMainMs:callMainMs,device:device+bench});shaderText('启动到2D首帧');fpsWindow('2D',3000,5000);
 }
 function mark(name,value){
  var now=Date.now();
  if(name==='callmain_ms'){if(callMainMs==null)callMainMs=value;first(false);return;}
  if(name==='click_request'){click={at:now,reused:!!value};return;}
  if(name==='code1_downloaded'||name==='code1_ready'){if(click)click[name]=now;return;}
  if(name==='fallback'){var v=value||{};emit((v.clicked?'点击后':'点击前')+'首包缺函数：同步等待剩余WASM '+fmt(v.ms)+'（函数编号 '+v.func+'）',{kind:'primary_miss_fallback',clicked:!!v.clicked,waitMs:v.ms,func:v.func});if(click){click.fallbackMs=v.ms;}return;}
  if(marks[name]==null)marks[name]=now;
  if(name==='two_d_first_frame'){first(false);setTimeout(function(){first(true);},3000);}
 }
 function threeD(transitionMs){
  var c=click||{};if(c.fallbackMs!=null){emit('点击进3D：总计 '+fmt(transitionMs)+' | 其中缺函数同步等待剩余WASM('+mb(SZ.code1Br)+'，下载+编译) '+fmt(c.fallbackMs),{kind:'enter_3d',totalMs:transitionMs,fallbackWaitMs:c.fallbackMs,code1Bytes:SZ.code1Br||null,reusedCode:false});click=null;return;}var dl=c.code1_downloaded&&c.at?c.code1_downloaded-c.at:null,inst=c.code1_ready&&c.code1_downloaded?c.code1_ready-c.code1_downloaded:null,reused=!c.code1_downloaded;
  emit(reused?(SZ.mode==='measured'&&!c.reused?'进3D(实测模式)：总计 '+fmt(transitionMs)+'（首包已含3D代码，未下载剩余WASM）':'再次进3D：总计 '+fmt(transitionMs)+'（剩余WASM已在内存，未重新下载）'):
   '点击进3D：总计 '+fmt(transitionMs)+' | 下载剩余WASM('+mb(SZ.code1Br)+') '+fmt(dl)+' | 编译实例化 '+fmt(inst)+' | 3D资源加载到首帧 '+fmt(transitionMs!=null&&dl!=null&&inst!=null?transitionMs-dl-inst:null),
   {kind:'enter_3d',totalMs:transitionMs,code1Bytes:SZ.code1Br||null,downloadMs:dl,instantiateMs:inst,reusedCode:reused});
  click=null;shaderText(reused?'再次进3D期间':'点击进3D期间');fpsWindow(reused?'再次3D':'3D',0,5000);
 }
 // Godot's console.info('[STARTUP_3D_FLOW]', json) arrives through this console.
 // Only key flow stages are printed; per-step stages are summarized above instead.
 var keep={transition_failed:1};
 var info=console.info;
 console.info=function(){
  try{if(arguments[0]==='[STARTUP_3D_FLOW]'){var r=JSON.parse(arguments[1]);
   if(r.stage==='two_d_first_frame')mark('two_d_first_frame');
   else if(r.stage==='transition_failed')emit('进3D失败：'+(r.detail&&r.detail.error_code),{kind:'enter_3d_failed',code:r.detail&&r.detail.error_code});
   else if(r.stage==='game_3d_first_frame')threeD(r.detail&&r.detail.transition_total_ms);
   if(!keep[r.stage])return;}
   if(typeof arguments[0]==='string'&&arguments[0].indexOf('[REPRO_')===0)return;
  }catch(_){}
  return info.apply(console,arguments);
 };
 // Native callMain breakdown from Godot's [WX_NATIVE_STARTUP]/[WX_NATIVE_SETUP_DETAIL] prints (console.log).
 var CN={webmain_total:'原生main总计',main_setup:'Setup',display_server_create:'创建显示服务器/WebGL',rendering_server_init:'渲染服务器初始化',main_start:'Main::start',scene_tree_initialize:'场景树初始化',theme_and_default_font:'主题与默认字体',main_scene_load:'主场景加载',main_scene_instantiate:'主场景实例化',main_scene_add:'主场景入树',gles3_scene_ctor:'GLES3场景渲染器',gles3_scene_default3d_prewarm:'默认3D预热',first_main_loop_callback:'首次主循环',first_rendering_draw:'首次绘制',
  setup_phase1:'Setup一阶段',os_initialize:'OS初始化',core_type_registration:'核心类型注册',project_pack_setup:'项目与PCK挂载',core_modules_extensions:'核心模块扩展',uid_autoload_cache:'UID与自动加载',setup_phase2:'Setup二阶段',server_types_modules:'服务器类型与模块',audio_driver_server:'音频驱动',translations_remaps:'翻译重映射',text_server_setup:'文本服务器',scene_type_registration:'场景类型注册',scene_modules_extensions:'场景模块扩展',finalize_setup:'Setup收尾'};
 function nativeLine(title,v){
  var rs=(v.records||[]).filter(function(r){return r.duration_us!=null;}),ms=function(r){return Math.round(r.duration_us/1000);};
  var tops=rs.filter(function(r){return !r.parent;});
  var parts=tops.map(function(t){var kids=rs.filter(function(r){return r.parent===t.id&&ms(r)>=20;}).sort(function(a,b){return b.duration_us-a.duration_us;});
   return (CN[t.label]||t.label)+' '+ms(t)+'ms'+(kids.length?'['+kids.map(function(k){return (CN[k.label]||k.label)+' '+ms(k);}).join('、')+']':'');});
  emit(title+'：'+parts.join(' | ')+'（20ms以下子项省略）',{kind:'native',schema:v.schema,records:rs.map(function(r){return [r.label,ms(r),r.parent];})});
 }
 var log=console.log;
 console.log=function(){
  try{var a=arguments[0];
   if(arguments.length===1&&typeof a==='function')return;
   if(typeof a==='string'&&(a.indexOf('代码分包1下载进度')===0||a.indexOf('资源包下载进度')>=0||a.indexOf('[minigamefe keyValueReport]')===0||a==='Module is'||a==='unity framework')){dropped.spam++;return;}
   if(typeof a==='string'&&a.indexOf('[WX_SHADER_')===0){var o=JSON.parse(a.slice(a.indexOf('{')));
    if(a.indexOf('[WX_SHADER_BIND]')===0){if(!o.first){sh.dropped++;return;}sh.firsts++;return;}
    else if(a.indexOf('[WX_SHADER_COMPILE]')===0){sh.compiles++;sh.compileUs+=o.total_us||0;if(!o.ok)sh.failed++;if(!sh.slowest||o.total_us>sh.slowest.us)sh.slowest={name:o.shader+'#'+o.variant+'/'+o.specialization,us:o.total_us};}return;}
   else if(typeof a==='string'&&a.indexOf('[WX_NATIVE_')>=0){var j=JSON.parse(a.slice(a.indexOf('{')));
   if(a.indexOf('[WX_NATIVE_STARTUP]')>=0)nativeLine('callMain内部(原生计时)',j);else if(a.indexOf('[WX_NATIVE_SETUP_DETAIL]')>=0)nativeLine('Setup细分(原生计时)',j);return;}}catch(_){}
  return log.apply(console,arguments);
 };
 // Memory / frame-rate observation (JS side only; no engine change).
 var bench='';try{wx.getDeviceBenchmarkInfo&&wx.getDeviceBenchmarkInfo({success:function(r){bench=' 设备等级'+(r.benchmarkLevel!=null?r.benchmarkLevel:'?')+(r.modelLevel!=null?'/机型档'+r.modelLevel:'');}});}catch(_){}
 function heap(){try{var k=root.WXGameKit,mod=k&&k.gameInstance&&k.gameInstance.Module,h=mod&&(mod.HEAPU8||mod.HEAP8),b=h&&h.buffer;if(!b){var p=root.wasm_split_info&&root.wasm_split_info.primary;b=p&&p.memory&&p.memory.buffer;}return b?b.byteLength:null;}catch(_){return null;}}
 var peak=0,warnings=0,windows={};
 setInterval(function(){var h=heap();if(h&&h>peak)peak=h;},1000);
 try{wx.onMemoryWarning&&wx.onMemoryWarning(function(r){warnings++;var h=heap();emit('内存告警：级别 '+(r&&r.level!=null?r.level:'未知(iOS无级别)')+' | WASM堆 '+mb(h)+' | 峰值 '+mb(peak),{kind:'memory_warning',level:r&&r.level,heapBytes:h,peakBytes:peak});});}catch(_){}
 var raf=typeof requestAnimationFrame==='function'?requestAnimationFrame:(typeof root.requestAnimationFrame==='function'?root.requestAnimationFrame:null);
 var hideSeq=0;try{wx.onHide&&wx.onHide(function(){hideSeq++;});}catch(_){}
 function fpsWindow(label,delay,ms,retry){if(!retry){windows[label]=(windows[label]||0)+1;if(windows[label]>1)return;}
  setTimeout(function(){if(!raf){emit('帧率('+label+')：无法测量(无requestAnimationFrame)',{kind:'fps',label:label});return;}
   var start=0,last=0,frames=0,worst=0,janks=0,seq0=hideSeq;
   function tick(){var now=Date.now();if(!start){start=last=now;}else{var d=now-last;last=now;frames++;if(d>worst)worst=d;if(d>50)janks++;}
    if(now-start<ms)raf(tick);else{if(hideSeq!==seq0||worst>1000){if(!retry){emit('帧率('+label+')：测量期间切到后台，作废，3秒后重测',{kind:'fps_invalid',label:label,worstMs:worst});fpsWindow(label,3000,ms,true);}return;}var fps=frames*1000/(now-start),h=heap();if(h&&h>peak)peak=h;
     emit('帧率('+label+'，测'+(ms/1000)+'秒)：平均 '+fps.toFixed(1)+'fps | 最长一帧 '+worst+'ms | 卡顿(>50ms) '+janks+'次 | WASM堆 '+mb(h)+'（峰值 '+mb(peak)+'） | 内存告警 '+warnings+'次',
      {kind:'fps',label:label,fps:Math.round(fps*10)/10,worstMs:worst,janks:janks,heapBytes:h,peakBytes:peak,memoryWarnings:warnings});}}
   raf(tick);},delay);}
 var errSeen={},err=console.error;
 console.error=function(){try{var k=Array.prototype.map.call(arguments,function(x){return typeof x==='string'?x:'';}).join(' ').slice(0,200);if(k){errSeen[k]=(errSeen[k]||0)+1;if(errSeen[k]>1){dropped.dupErrors++;return;}}}catch(_){}return err.apply(console,arguments);};
 root.__WX15_TIMING__={mark:mark,t0:t0,dropped:dropped};
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);
