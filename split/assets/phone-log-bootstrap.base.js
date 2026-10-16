try {
 const c=require('./phone-log-config');
 let effective=c;try{if(wx.getSystemInfoSync().platform==='devtools')effective=Object.assign({},c,{enabled:false});}catch(_){}
 const relay=require('./phone-log').installPhoneLog(wx,console,effective);
 GameGlobal.__PHONE_LOG_RELAY__=relay;
 console.info('[PHONE_LOG_RELAY]',relay?relay.status():(effective.enabled?'Existing relay unavailable; game continues':'Disabled; no cloud relay'));
} catch(error) { console.warn('[PHONE_LOG_RELAY] init failed; game continues',error&&error.message); }
