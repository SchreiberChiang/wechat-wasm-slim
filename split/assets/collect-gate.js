/* WXSLIM_COLLECT_GATE: collection-only; PENDING hold is TRAINING_WAIT_NOT_DOWNLOAD.
 * 采集包专用的等待门：点击后等一会儿就返回 READY，但不下载余包。游戏用 __WXSLIM_COLLECT_GATE__ 是否存在判断“这是采集包”。
 * 旧名 __WX15_RELEASE_CLICK_GATE__ / __WX15_TRAINING12_GATE_DIAGNOSTIC__ 同时挂上，兼容 2026-10-17 以前的游戏代码。 */
(function(root){var state='IDLE',polls=0,c={requests:0,statusPolls:0,readyAfterPending:0,reuses:0,cancels:0};
 function publish(){try{GameGlobal.__WXSLIM_COLLECT_GATE__=GameGlobal.__WX15_TRAINING12_GATE_DIAGNOSTIC__={state:state,requests:c.requests,statusPolls:c.statusPolls,readyAfterPending:c.readyAfterPending,reuses:c.reuses,cancels:c.cancels,meaning:'TRAINING_WAIT_NOT_DOWNLOAD'};}catch(_){}}
 var api=Object.freeze({request:function(){c.requests++;if(state==='READY'){c.reuses++;publish();return state;}state='PENDING';polls=0;publish();return state;},
  status:function(){c.statusPolls++;if(state==='PENDING'&&++polls>=45){state='READY';c.readyAfterPending++;}publish();return state;},
  cancel:function(){c.cancels++;if(state==='PENDING')state='IDLE';publish();}});
 var holders=[];function add(x){if(x&&holders.indexOf(x)<0)holders.push(x);}add(root);if(typeof GameGlobal!=='undefined')add(GameGlobal);if(typeof window!=='undefined')add(window);holders.slice().forEach(function(x){add(x.window);add(x.__gameContextWindow);});
 holders.forEach(function(x){if(x.__WXSLIM_CLICK_GATE__!==undefined)throw new Error('gate exists');x.__WXSLIM_CLICK_GATE__=api;x.__WX15_RELEASE_CLICK_GATE__=api;});publish();})(globalThis);
