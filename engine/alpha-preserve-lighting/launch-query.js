// Read actual launch once; absent autotest defaults on. Explicit 0 disables.
(function (G) {
  'use strict';
  var result = {schema:'wx-launch-args-v1', source:'wx.getLaunchOptionsSync', available:false, enabled:false, autotest:null, reason:null, activationSource:'unavailable', launchPolicy:'default-on-explicit-0-off-v1'};
  try {
    if (typeof wx === 'undefined' || typeof wx.getLaunchOptionsSync !== 'function') result.reason='launch_api_unavailable';
    else {
      var options=wx.getLaunchOptionsSync();
      if (!options || typeof options !== 'object') result.reason='launch_options_invalid';
      else {
        var query=options.query;
        if (typeof query === 'undefined' || query === null) query={};
        if (typeof query !== 'object' || Array.isArray(query)) result.reason='launch_query_invalid';
        else {
          result.available=true;
          if (!Object.prototype.hasOwnProperty.call(query,'autotest')) {
            result.enabled=true;
            result.activationSource='default';
          } else {
            var value=query.autotest;
            result.autotest=typeof value==='string'||typeof value==='number'?value:null;
            result.activationSource='query';
            result.enabled=value==='1'||value===1;
            result.reason=result.enabled?null:(value==='0'||value===0?'query_disabled':'autotest_invalid');
          }
        }
      }
    }
  } catch (error) { result.reason='launch_query_throw'; result.error=String(error); }
  G.__TwoCaseLaunch=Object.freeze(result);
  G.__TwoCaseStartArgs=function(base) {
    if(!Array.isArray(base) || base.indexOf('--')!==-1) throw new Error('Unexpected engine base args');
    return base.concat(['--','--wx-launch='+JSON.stringify(result)]);
  };
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);
