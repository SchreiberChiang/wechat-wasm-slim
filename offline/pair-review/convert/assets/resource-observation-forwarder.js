// Development fixture evidence only. No resource, engine, GL or storage action.
// Original console calls always retain their arguments/return/exception.
(function () {
  'use strict';
  function install(options) {
    var root=options.root, logger=options.console, relay=options.relay, simple=options.simple;
    function need(v,c){if(!v)throw Error(c);}
    need(root && Object.isExtensible(root) && !('__WXSLIM_RESOURCE_LOG_FORWARDER__' in root),'RESOURCE_LOG_ALREADY_INSTALLED');
    need(logger && typeof logger.log==='function' && typeof logger.info==='function' && relay && typeof relay.emit==='function' &&
      simple && typeof simple.getObservationIdentity==='function','RESOURCE_LOG_DEPENDENCIES');
    var initial=JSON.parse(simple.getObservationIdentity()),resource=root.__WXSLIM_RESOURCE_APP__.status();
    need(/^wxslim-[a-f0-9]{20}$/.test(initial.packageId) && resource.boot.packageId===initial.packageId &&
      typeof initial.ref==='string' && initial.ref.length<=160 && /^[a-z0-9_-]{8,64}$/.test(resource.identity.engineSession),'RESOURCE_LOG_IDENTITY');
    var session=resource.identity.engineSession, ref=initial.ref, packageId=initial.packageId;
    var prefix='RESOURCE_RUNTIME_FIXTURE ', expectedScope='Fixture observations only; Promise resolution is not success and visual appearance requires human observation';
    var events=['ATTACH_OBSERVED','COMBINED_RESOURCE_ASSOCIATION','COMBINED_RESOURCE_IDENTITY_MISMATCH',
      'COMBINED_RESOURCE_REQUEST_SCOPE_INVALID','COMBINED_RESOURCE_CANCEL_SCOPE_INVALID','LOAD_REQUESTED','LOAD_NOT_REQUESTED',
      'FIXTURE_CALLBACK_UNAVAILABLE','FIXTURE_LOAD_RETURN_NOT_PROMISE_OBJECT','FIXTURE_THEN_RETURN_NOT_PROMISE_OBJECT',
      'CANCEL_UNCONFIRMED','CANCEL_BEFORE_LOAD','CANCEL_BEFORE_LOAD_UI_ONLY','CANCEL_REQUESTED','FIXTURE_RESOLVE_ARGUMENTS_INVALID',
      'FIXTURE_LOAD_CLAIM_INVALID','FIXTURE_RESULT_LOAD_ID_INVALID','FIXTURE_RESULT_IDENTITY_INVALID','LOAD_PROMISE_RESOLVED','LOAD_PROMISE_REJECTED'];
    var counts={observed:0,forwardAttempts:0,duplicate:0,limited:0,rejected:0,relayFailures:0}, seen=Object.create(null),reasons=Object.create(null);
    var limit=24, diagnosticSent=false;
    function safeCode(v){return v===null || (typeof v==='string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(v));}
    function plain(v){return v && typeof v==='object' && !Array.isArray(v);}
    function fields(v,allowed){return plain(v) && Object.keys(v).every(function(k){return allowed.indexOf(k)>=0;});}
    function decimal(v){return typeof v==='string' && /^[0-9]{1,24}$/.test(v);}
    function count(v){return v===null || (Number.isSafeInteger(v) && v>=0 && v<=1048576);}
    function proof(v){
      if(!fields(v,['ok','code','instanceId','path','marker','textureWidth','textureHeight','visualVerified']) || typeof v.ok!=='boolean' || !safeCode(v.code))return false;
      return (!('instanceId' in v)||decimal(v.instanceId)) && (!('path' in v)||v.path==='res://level.tscn') &&
        (!('marker' in v)||v.marker===null||v.marker==='wxslim-level-v1') &&
        (!('textureWidth' in v)||count(v.textureWidth)) && (!('textureHeight' in v)||count(v.textureHeight)) &&
        (!('visualVerified' in v)||v.visualVerified===false);
    }
    function data(v){
      if(!fields(v,['code','ready','parentIsRoot','receiverId','resourceRequest','triggerId','triggerIsCurrentScene','alreadyRequested',
        'outcome','noOperationsObserved','mounted','failureCode','rawBytes','contentProof','observedCode',
        'loadId','loadDispatched','nativeCancelDispatched']))return false;
      return Object.keys(v).every(function(k){var x=v[k];
        if(['code','failureCode','observedCode'].indexOf(k)>=0)return safeCode(x);
        if(['ready','parentIsRoot','resourceRequest','triggerIsCurrentScene','alreadyRequested','noOperationsObserved','loadDispatched','nativeCancelDispatched'].indexOf(k)>=0)return typeof x==='boolean';
        if(k==='loadId')return typeof x==='string' && /^[1-9][0-9]{0,31}$/.test(x);
        if(k==='receiverId'||k==='triggerId')return decimal(x);
        if(k==='outcome')return x===null || ['SUCCESS','FAILED','CANCELLED','UNKNOWN'].indexOf(x)>=0;
        if(k==='mounted')return Array.isArray(x)&&x.length<=2&&x.every(function(id){return id==='shared'||id==='level';})&&new Set(x).size===x.length;
        if(k==='rawBytes')return count(x);
        return k==='contentProof'&&proof(x);
      });
    }
    function emit(text){counts.forwardAttempts++;try{relay.emit('info',text);}catch(_){counts.relayFailures++;}}
    function reject(code){
      counts.rejected++;reasons[code]=(reasons[code]||0)+1;
      // One bounded diagnostic; bad payload/text is never attached. Local logs
      // still contain the exact original and are not changed or filtered.
      if(!diagnosticSent && counts.forwardAttempts<limit){diagnosticSent=true;emit('[COMBINED_RESOURCE_RELAY] '+JSON.stringify({ref:ref,code:code,evidence:'FORWARDING_INCOMPLETE_LOCAL_ORIGINAL_RETAINED'}));}
    }
    function observe(args){
      var head=args[0];if(typeof head!=='string'||head.indexOf(prefix)!==0)return;
      counts.observed++;
      if(counts.forwardAttempts>=limit){counts.limited++;return;}
      if(args.length>2 || (args.length===2&&typeof args[1]!=='string')){reject('RESOURCE_LOG_ARGUMENTS');return;}
      var text=head.slice(prefix.length)+(args.length===2?args[1]:'');
      if(text.length>4096){reject('RESOURCE_LOG_SIZE');return;}
      var record;try{record=JSON.parse(text);}catch(_){reject('RESOURCE_LOG_JSON');return;}
      if(!fields(record,['schema','event','state','packageId','engineSession','data','scope','visualVerified','persistentReceiptWritten']) ||
        record.schema!=='wxslim-resource-runtime-fixture-event-v1' || events.indexOf(record.event)<0 ||
        typeof record.state!=='string'||!/^[A-Z ]{1,48}$/.test(record.state) || record.scope!==expectedScope ||
        record.visualVerified!==false || record.persistentReceiptWritten!==false || !data(record.data)) {reject('RESOURCE_LOG_SCHEMA');return;}
      if(record.packageId!==packageId || record.engineSession!==session){reject('RESOURCE_LOG_SESSION');return;}
      var current;try{current=JSON.parse(simple.getObservationIdentity());}catch(_){reject('RESOURCE_LOG_CURRENT_ID');return;}
      if(current.ref!==ref || current.packageId!==packageId){reject('RESOURCE_LOG_CURRENT_ID');return;}
      // Deduplicate identical records only. A later changed failure/success is
      // not suppressed just because the event name has already appeared.
      var key=JSON.stringify(record);if(seen[key]){counts.duplicate++;return;}seen[key]=true;
      var line='[COMBINED_RESOURCE] '+JSON.stringify({ref:ref,resourceSession:session,record:record,scope:'FIXTURE_REPORTED_NOT_INDEPENDENT_GPU_OR_VISUAL_PROOF'});
      if(line.length>4000){reject('RESOURCE_LOG_ENVELOPE_SIZE');return;}
      emit(line);
    }
    var wrappers={};
    ['log','info'].forEach(function(level){var original=logger[level];wrappers[level]=function(){
      var result=original.apply(logger,arguments);
      try{observe(arguments);}catch(_){reject('RESOURCE_LOG_OBSERVER_FAILED');}
      return result;
    };});
    var api=Object.freeze({status:function(){return {schema:'wxslim-resource-log-forwarder-v1',ref:ref,resourceSession:session,
      counters:Object.assign({},counts),rejectionReasons:Object.assign({},reasons),maxForwardAttempts:limit,
      sharesExistingCloudQuota:true,fullConsole:false,originalResultForwarded:false,rawValues:'ACCEPTED_RECORDS_PRESERVED_NO_COERCION',
      delivery:'RELAY_STATUS_AND_CLOUD_RECEIPTS_REQUIRED_NOT_PROVEN_BY_FORWARD_ATTEMPTS'};}});
    Object.defineProperty(root,'__WXSLIM_RESOURCE_LOG_FORWARDER__',{value:api,writable:false,configurable:false});
    logger.log=wrappers.log;logger.info=wrappers.info;
    return api;
  }
  if(typeof module==='object' && module.exports)module.exports=install;
}());
