/* Explicit wx.login adapter. No request at installation, storage, logging,
 * guest fallback, checkSession or code2Session. Consume the code once in memory.
 * Local abandonment cannot abort a wx.login request already sent to WeChat. */
'use strict';
module.exports = function createLoginCode(options) {
  options = options || {};
  var wxApi = options.wx, now = options.now || Date.now;
  var timeoutMs = options.timeoutMs === undefined ? 10000 : options.timeoutMs;
  if (typeof now !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw Error('LOGIN_OPTIONS_INVALID');
  var nextId = 0, current = null, code = '', closed = false;
  function clock() { var t = now(); if (!Number.isFinite(t)) throw Error('LOGIN_CLOCK_INVALID'); return t; }
  function clear(reason, status) {
    code = '';
    if (current) { current.status = status; current.reason = reason; }
  }
  function expire() {
    if (!current || (current.status !== 'PENDING' && current.status !== 'CODE_READY')) return;
    var t;
    try { t = clock(); } catch (_) { clear('CLOCK_UNAVAILABLE', 'FAILED'); return; }
    if (t < current.startedAt) { clear('CLOCK_MOVED_BACKWARDS', 'FAILED'); return; }
    if (current.status === 'PENDING' && t >= current.deadline) clear('LOCAL_TIMEOUT', 'FAILED');
    // Conservative five-minute bound from request start, not a server assertion.
    if (current.status === 'CODE_READY' && t >= current.expiresAt) clear('LOCAL_CODE_EXPIRED', 'EXPIRED');
  }
  function snapshot() {
    expire();
    return {schema:'wxslim-login-code-v1', requestId:current ? current.id : 0,
      status:current ? current.status : closed ? 'CLOSED' : 'IDLE', reason:current ? current.reason : null,
      platformCallAttempted:current ? current.platformCallAttempted : false,
      codeAvailable:!!code, businessLogin:'NOT_PERFORMED', localCancellationOnly:true,
      error:current ? current.error : null, closed:closed};
  }
  function reply(ok, reason) { return JSON.stringify({ok:ok, reason:reason, state:snapshot()}); }
  function pending(id) { expire(); return !closed && current && current.id === id && current.status === 'PENDING'; }
  function field(object, key) {
    if (!object || typeof object !== 'object') return undefined;
    var d = Object.getOwnPropertyDescriptor(object,key);
    return d && Object.prototype.hasOwnProperty.call(d,'value') ? d.value : undefined;
  }
  function request() {
    expire();
    if (closed) return reply(false,'CLOSED');
    if (current && current.status === 'PENDING') return reply(false,'REQUEST_PENDING');
    if (code) return reply(false,'UNCONSUMED_CODE');
    if (nextId >= Number.MAX_SAFE_INTEGER) return reply(false,'REQUEST_COUNTER_EXHAUSTED');
    var t;
    try { t = clock(); } catch (_) { return reply(false,'CLOCK_UNAVAILABLE'); }
    var id = ++nextId;
    current = {id:id,status:'PENDING',reason:null,error:null,startedAt:t,deadline:t+timeoutMs,expiresAt:t+300000,platformCallAttempted:false};
    var login;
    try { login = wxApi && wxApi.login; } catch (_) { if (pending(id)) clear('API_ACCESS_FAILED','FAILED'); return reply(false,'API_ACCESS_FAILED'); }
    if (!pending(id)) return reply(false,'REQUEST_REPLACED');
    if (typeof login !== 'function') { clear('API_UNAVAILABLE','FAILED'); return reply(false,'API_UNAVAILABLE'); }
    try {
      if (!pending(id)) return reply(false,'REQUEST_REPLACED');
      current.platformCallAttempted = true;
      login.call(wxApi, {
        timeout:timeoutMs,
        success:function (result) {
          if (!pending(id)) return;
          try {
            var value = field(result,'code');
            if (!pending(id)) return;
            // A local resource bound, not a claim about the documented code format.
            if (typeof value !== 'string' || value.length === 0 || value.length > 4096) { clear('INVALID_CODE_RESULT','FAILED'); return; }
            code = value; current.status = 'CODE_READY'; current.reason = null;
          } catch (_) { if (pending(id)) clear('UNREADABLE_CODE_RESULT','FAILED'); }
        },
        fail:function (error) {
          if (!pending(id)) return;
          try {
            var message = field(error,'errMsg'), errno = field(error,'errno');
            if (!pending(id)) return;
            current.error = {message:typeof message === 'string' ? message.slice(0,512) : null,
              messageTruncated:typeof message === 'string' && message.length > 512,
              errno:typeof errno === 'number' && Number.isFinite(errno) ? errno : null};
            clear('WX_LOGIN_FAILED','FAILED');
          } catch (_) { if (pending(id)) clear('UNREADABLE_FAILURE_RESULT','FAILED'); }
        }
      });
    } catch (_) {
      // Preserve an already settled callback; do not overwrite reentrant state.
      if (pending(id)) clear('WX_LOGIN_THROW','FAILED');
    }
    return reply(current.id === id && (current.status === 'PENDING' || current.status === 'CODE_READY'),current.reason);
  }
  function takeCode(id) {
    expire();
    if (closed || !current || id !== current.id || current.status !== 'CODE_READY' || !code) return '';
    var value = code; clear('CODE_TAKEN','CONSUMED'); return value;
  }
  function abandon(id) {
    expire();
    if (!current || id !== current.id) return reply(false,'REQUEST_ID_MISMATCH');
    if (current.status !== 'PENDING' && current.status !== 'CODE_READY') return reply(false,'ALREADY_SETTLED');
    clear('LOCALLY_ABANDONED','ABANDONED'); return reply(true,'LOCALLY_ABANDONED');
  }
  function dispose() { if (!closed) { closed = true; clear('INTERFACE_CLOSED','CLOSED'); } return JSON.stringify(snapshot()); }
  return Object.freeze({request:request,getStatus:function(){return JSON.stringify(snapshot());},takeCode:takeCode,abandon:abandon,dispose:dispose});
};
