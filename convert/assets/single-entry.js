/* wechat-wasm-slim convert：WXGameKit 会对同一个 Module 多次请求模块工厂；
 * 这里保证 Godot 工厂只真正执行一次，同一个 Module 复用同一个 Promise，不同 Module 直接拒绝。
 */
(function(root){
 'use strict';
 var firstModule=null, firstPromise=null;
 var state={requests:0,nativeFactoryCalls:0,reusedRequests:0,status:'NEW'};
 root.__WX15_ENTRY_STATE__=state;
 root.__WX15_CREATE_SINGLE_ENTRY__=function(factory){
  if(typeof factory!=='function')throw Error('WX15_ENTRY_FACTORY_REQUIRED');
  return function(module){
   state.requests++;
   if(!module || typeof module!=='object'){state.status='INVALID_MODULE';return Promise.reject(Error('WX15_ENTRY_MODULE_REQUIRED'));}
   if(firstPromise){
    if(firstModule!==module){state.status='DISTINCT_MODULE_REJECTED';return Promise.reject(Error('WX15_DISTINCT_MODULE_REQUIRES_FRESH_SESSION'));}
    state.reusedRequests++;state.lastSameModule=true;
    return firstPromise;
   }
   firstModule=module;state.status='STARTING';
   // Assign the one Promise before the actual handler can synchronously reenter.
   firstPromise=Promise.resolve().then(function(){
    state.nativeFactoryCalls++;return factory(module);
   }).then(function(result){state.status='FULFILLED';return result;},function(error){state.status='REJECTED';state.error=String(error&&error.message||error);throw error;});
   return firstPromise;
  };
 };
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);
