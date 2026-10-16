/* WX15_CLICK_OWNED_CORE_BEGIN: unsupported local adaptation; no auto-load. */
var __WX15_CLICK__=(function(){
 var state='UNBOUND',binding=null,attempt=null,receipt=null;
 var counts={requests:0,downloads:0,instantiations:0,reuses:0,cancels:0,coverageFailures:0,blockedWarmups:0};
 function bump(k){counts[k]=Math.min(255,counts[k]+1);}
 function snap(){var x=window.wasm_split_info,p=x&&x.primary;return {imports:x,module:m(),id:String(GameGlobal.CODE_FILE_MD5)+':'+String(h()),table:p&&p.table,memory:p&&p.memory,globals:p&&[p['global$0'],p['global$1'],p['global$2'],p['global$3']]};}
 function same(x,y){return !!x&&!!y&&x.imports===y.imports&&x.module===y.module&&x.id===y.id&&x.table===y.table&&x.memory===y.memory&&x.table&&x.table.length>=tableSize&&x.memory&&x.memory.buffer.byteLength>0&&x.globals&&y.globals&&x.globals.every(function(g,i){return g&&g===y.globals[i];});}
 function publish(){try{GameGlobal.__WX15_CLICK_DIAGNOSTIC__={state:state,requests:counts.requests,downloads:counts.downloads,instantiations:counts.instantiations,reuses:counts.reuses,cancels:counts.cancels,coverageFailures:counts.coverageFailures,blockedWarmups:counts.blockedWarmups};}catch(_){}}
 function fail(code){state=code;receipt=null;publish();}
 function valid(){try{return same(binding,snap());}catch(_){return false;}}
 function status(){if(state==='READY'){try{if(!receipt||!same(receipt,snap())||!c.subWasmInstantiated)fail('IDENTITY_CHANGED_RESTART_REQUIRED');}catch(_){fail('IDENTITY_CHANGED_RESTART_REQUIRED');}}return state;}
 function onDownloaded(){if(state!=='PENDING'||!attempt||attempt.phase!=='DOWNLOAD')return;attempt.phase='INSTANTIATE';try{I(false);}catch(_){fail('INSTANTIATE_FAILED_RESTART_REQUIRED');}}
 function request(){bump('requests');var current=status();if(current==='READY'){bump('reuses');publish();return current;}if(current==='PENDING')return current;if(current!=='IDLE'&&current!=='DOWNLOAD_FAILED_RETRYABLE')return current;if(!valid()){fail('IDENTITY_CHANGED_RESTART_REQUIRED');return state;}attempt={phase:'DOWNLOAD',snapshot:snap(),started:false};state='PENDING';bump('downloads');publish();try{F(onDownloaded,false);}catch(_){downloadFailed();}return state;}
 function downloadFailed(){if(state!=='PENDING'||!attempt||attempt.phase!=='DOWNLOAD')return;/* Only this completed owned download may clear its failed task. */c.loadSubWasmTask=void 0;c.loadSubWasmCallbacks=[];fail('DOWNLOAD_FAILED_RETRYABLE');}
 return {
  bind:function(){if(binding){if(!valid())fail('IDENTITY_CHANGED_RESTART_REQUIRED');return;}binding=snap();if(!valid()){fail('IDENTITY_CHANGED_RESTART_REQUIRED');return;}state='IDLE';publish();},
  request:request,status:status,cancel:function(){bump('cancels');publish();},
  ownsDownload:function(callback){return state==='PENDING'&&attempt&&attempt.phase==='DOWNLOAD'&&callback===onDownloaded;},
  downloadFailed:downloadFailed,
  beginI:function(){if(state!=='PENDING'||!attempt||attempt.phase!=='INSTANTIATE'||attempt.started||!same(attempt.snapshot,snap())){fail('INSTANTIATE_FAILED_RESTART_REQUIRED');throw Error('WX15_CLICK_I_NOT_OWNED');}attempt.started=true;bump('instantiations');publish();},
  successI:function(){if(state!=='PENDING'||!attempt||!attempt.started||!same(attempt.snapshot,snap())||!c.subWasmInstantiated){fail('INSTANTIATE_FAILED_RESTART_REQUIRED');return;}receipt=snap();state='READY';publish();},
  failedI:function(){fail('INSTANTIATE_FAILED_RESTART_REQUIRED');},
  wait:function(){if(status()==='READY')return;bump('coverageFailures');fail('PRIMARY_COVERAGE_MISS_RESTART_REQUIRED');throw Error('WX15_PRIMARY_COVERAGE_MISS');},
  compile:function(){if(status()==='READY')return Promise.resolve();bump('blockedWarmups');publish();return Promise.reject(Error('WX15_CLICK_REQUIRED_BEFORE_COMPILE'));}
 };
})();
GameGlobal.__WX15_RELEASE_CLICK_GATE__=Object.freeze({request:function(){return __WX15_CLICK__.request();},status:function(){return __WX15_CLICK__.status();},cancel:function(){__WX15_CLICK__.cancel();}});
(function(api){var holders=[];function add(x){if(x&&holders.indexOf(x)<0)holders.push(x);}add(GameGlobal);if(typeof globalThis!=='undefined')add(globalThis);if(typeof window!=='undefined')add(window);holders.slice().forEach(function(x){add(x.window);add(x.__gameContextWindow);});holders.forEach(function(x){x.__WX15_RELEASE_CLICK_GATE__=api;});})(GameGlobal.__WX15_RELEASE_CLICK_GATE__);
/* WX15_CLICK_OWNED_CORE_END */
