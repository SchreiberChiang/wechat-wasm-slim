/* Explicit ES2016 resource command transport. No global publication, I/O or engine calls. */
(function () {
  'use strict';
  var MAX_PACK = 32 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024, MAX_JSON = 256 * 1024;
  var HASH = /^[a-f0-9]{64}$/, ID = /^[a-z][a-z0-9_-]{0,47}$/;
  var typed = Object.getPrototypeOf(Uint8Array.prototype);
  var kind = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
  var bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
  var lengthOf = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
  var offsetOf = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
  var arrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  function error(code) { var e = new Error(code); e.code = code; return e; }
  function need(value, code) { if (!value) throw error(code); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function keys(value, expected) {
    need(object(value), 'RESOURCE_COMMAND_OBJECT');
    var actual = Reflect.ownKeys(value);
    need(actual.length === expected.length && actual.every(function (key) { return expected.indexOf(key) >= 0; }), 'RESOURCE_COMMAND_KEYS');
  }
  function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value); } return value; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function equal(a, b) { return canonical(a) === canonical(b); }
  function utf8Length(text) {
    var count = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) count++; else if (c < 2048) count += 2;
      else if (c >= 55296 && c <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { count += 4; i++; }
      else count += 3;
      need(count <= MAX_JSON, 'RESOURCE_COMMAND_JSON_LIMIT');
    }
    return count;
  }
  function parse(text) { need(typeof text === 'string', 'RESOURCE_COMMAND_JSON_REQUIRED'); utf8Length(text); return JSON.parse(text); }
  function serialize(value) { var text = JSON.stringify(value); utf8Length(text); return text; }
  function validIdentity(value) {
    keys(value, ['taskId', 'attemptId', 'engineSession']);
    ['taskId', 'attemptId'].forEach(function (key) { need(typeof value[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value[key]), 'RESOURCE_COMMAND_IDENTITY'); });
    need(typeof value.engineSession === 'string' && /^[a-z0-9_-]{8,64}$/.test(value.engineSession), 'RESOURCE_COMMAND_SESSION');
  }
  function validBoot(value) {
    keys(value, ['packageId', 'pckSha256', 'wasmSha256']);
    need(typeof value.packageId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.packageId) && HASH.test(value.pckSha256) && HASH.test(value.wasmSha256), 'RESOURCE_COMMAND_BOOT');
  }
  function acceptedBuffer(value) {
    try {
      if (kind.call(value) !== 'Uint8Array') return false;
      var bytes = lengthOf.call(value), offset = offsetOf.call(value), capacity = arrayLength.call(bufferOf.call(value));
      return Number.isSafeInteger(bytes) && bytes >= 4 && bytes <= MAX_PACK && Number.isSafeInteger(offset) && offset >= 0 && offset + bytes <= capacity;
    } catch (_) { return false; } // ArrayBuffer intrinsic rejects SharedArrayBuffer and detached buffers.
  }
  function increment(decimal) {
    var digits = decimal.split(''), carry = true;
    for (var i = digits.length - 1; i >= 0 && carry; i--) { if (digits[i] === '9') digits[i] = '0'; else { digits[i] = String(Number(digits[i]) + 1); carry = false; } }
    if (carry) digits.unshift('1'); return digits.join('');
  }

  function createResourceCommandBridge(options) {
    keys(options, ['module', 'identity', 'boot', 'manifest']);
    var engine = options.module; need(object(engine), 'RESOURCE_COMMAND_MODULE');
    ['initConfig', 'initFS', 'copyToFS', 'callMain'].forEach(function (key) { need(typeof engine[key] === 'function', 'RESOURCE_COMMAND_MODULE'); });
    validIdentity(options.identity); validBoot(options.boot); keys(options.manifest, ['packs']);
    var identity = freeze(clone(options.identity)), boot = freeze(clone(options.boot));
    var packs = options.manifest.packs, allow = Object.create(null), files = Object.create(null), total = 0;
    need(Array.isArray(packs) && packs.length > 0 && packs.length <= 128, 'RESOURCE_COMMAND_PACK_COUNT');
    var reader = [], helper = [];
    packs.forEach(function (pack) {
      keys(pack, ['id', 'root', 'file', 'bytes', 'sha256', 'entryScene', 'requires']);
      need(typeof pack.id === 'string' && ID.test(pack.id) && !Object.prototype.hasOwnProperty.call(allow, pack.id), 'RESOURCE_COMMAND_PACK_ID');
      need(typeof pack.root === 'string' && pack.root.length <= 128 && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(pack.root), 'RESOURCE_COMMAND_ROOT');
      need(pack.file === pack.root + '/content.bin' && !files[pack.file.toLowerCase()], 'RESOURCE_COMMAND_FILE');
      need(Number.isSafeInteger(pack.bytes) && pack.bytes >= 4 && pack.bytes <= MAX_PACK && typeof pack.sha256 === 'string' && HASH.test(pack.sha256), 'RESOURCE_COMMAND_PIN');
      // Resource-only dependencies explicitly have no entry; never invent one.
      if (pack.entryScene !== null) {
        need(typeof pack.entryScene === 'string' && pack.entryScene.length <= 1024 && /^res:\/\/.+\.(tscn|scn)$/.test(pack.entryScene), 'RESOURCE_COMMAND_ENTRY');
        need(!/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/.test(pack.entryScene.slice(6)) && pack.entryScene.slice(6).split('/').every(function (part) { return part && part !== '.' && part !== '..'; }), 'RESOURCE_COMMAND_ENTRY');
      }
      need(Array.isArray(pack.requires) && pack.requires.every(function (id, index) { return typeof id === 'string' && ID.test(id) && id !== pack.id && pack.requires.indexOf(id) === index; }), 'RESOURCE_COMMAND_REQUIRES');
      total += pack.bytes; need(total <= MAX_TOTAL, 'RESOURCE_COMMAND_TOTAL_LIMIT');
      var h = {id:pack.id, bytes:pack.bytes, sha256:pack.sha256, entryScene:pack.entryScene, requires:pack.requires.slice()};
      allow[pack.id] = h; files[pack.file.toLowerCase()] = true; helper.push(h);
      reader.push({id:pack.id, root:pack.root, file:pack.file, bytes:pack.bytes, sha256:pack.sha256});
    });
    var marks = Object.create(null);
    function visit(id) { need(allow[id] && marks[id] !== 1, 'RESOURCE_COMMAND_DEPENDENCY'); if (marks[id] === 2) return; marks[id] = 1; allow[id].requires.forEach(visit); marks[id] = 2; }
    Object.keys(allow).forEach(visit);
    var config = freeze({schema:'wxslim-resource-command-config-v1', identity:identity, boot:boot, manifest:{packs:helper}});
    var configJson = serialize(config); freeze(reader);
    var attached = false, attachAttempted = false, callback = null, begun = false, invalidated = false, unknown = false, failure = '', sequence = '0', pending = null, lastReport = null, lastSummary = null, ignoredReports = 0, sceneAttempted = false;
    function live() { return engine !== null && !invalidated && !unknown; }
    function unknownFailure(code) {
      unknown = true; failure = code;
      if (pending) { if (pending.queuedReport && !pending.observedReport) pending.observedReport = freeze(pending.queuedReport); pending.sideEffects = 'UNKNOWN'; if (!pending.settled) { pending.settled = true; pending.reject(error(code)); } }
    }
    function validateSummary(summary, operation, result) {
      keys(summary, ['schema', 'initialized', 'engineSession', 'operation', 'dirty', 'managedRootState', 'declaredBytes', 'heldVerifiedBytes', 'fsReservedUpperBoundBytes', 'packs', 'rollbackPerformed', 'sceneLoadAttempted', 'scope', 'memoryScope']);
      need(summary.schema === 'wxslim-godot-resource-session-v1' && typeof summary.initialized === 'boolean' && typeof summary.dirty === 'boolean', 'RESOURCE_COMMAND_SUMMARY');
      need(summary.engineSession === identity.engineSession || (operation === 'BEGIN' && !result.ok && !summary.initialized && summary.engineSession === ''), 'RESOURCE_COMMAND_SUMMARY_SESSION');
      need(typeof summary.operation === 'string' && summary.operation.length <= 64 && typeof summary.managedRootState === 'string' && summary.managedRootState.length <= 64, 'RESOURCE_COMMAND_SUMMARY');
      ['declaredBytes', 'heldVerifiedBytes', 'fsReservedUpperBoundBytes'].forEach(function (key) { need(Number.isSafeInteger(summary[key]) && summary[key] >= 0 && summary[key] <= MAX_TOTAL, 'RESOURCE_COMMAND_SUMMARY_BYTES'); });
      need(summary.rollbackPerformed === false && summary.sceneLoadAttempted === false && typeof summary.scope === 'string' && typeof summary.memoryScope === 'string', 'RESOURCE_COMMAND_SUMMARY_SCOPE');
      need(Array.isArray(summary.packs) && summary.packs.length === (summary.initialized ? helper.length : 0), 'RESOURCE_COMMAND_SUMMARY_PACKS');
      var seen = Object.create(null);
      summary.packs.forEach(function (pack) {
        var pin = allow[pack.id]; need(pin && !seen[pack.id], 'RESOURCE_COMMAND_SUMMARY_PACK'); seen[pack.id] = true;
        ['id', 'bytes', 'sha256', 'entryScene', 'requires'].forEach(function (key) { need(equal(pack[key], pin[key]), 'RESOURCE_COMMAND_SUMMARY_PIN'); });
        need(['DECLARED', 'VERIFIED', 'VERIFY_FAILED', 'STAGING', 'STAGE_FAILED', 'STAGED_VERIFIED', 'UNKNOWN_DIRTY', 'MOUNT_FAILED', 'MOUNTED'].indexOf(pack.state) >= 0 && typeof pack.fileState === 'string' && typeof pack.mountState === 'string' && (pack.mountCalls === 0 || pack.mountCalls === 1) && typeof pack.lastError === 'string' && typeof pack.fileResiduePossible === 'boolean', 'RESOURCE_COMMAND_PACK_STATE');
        if (['VERIFIED', 'STAGED_VERIFIED', 'MOUNTED'].indexOf(pack.state) >= 0) need(pack.verifiedSha256 === pin.sha256 && pack.verifiedBytes === pin.bytes, 'RESOURCE_COMMAND_VERIFIED_PIN');
        if (['STAGED_VERIFIED', 'MOUNTED'].indexOf(pack.state) >= 0) need(pack.stagedSha256 === pin.sha256 && pack.stagedBytes === pin.bytes && pack.fileState === 'VERIFIED_READBACK', 'RESOURCE_COMMAND_STAGED_PIN');
        if (pack.state === 'MOUNTED') need(pack.mountState === 'MOUNTED' && pack.mountCalls === 1, 'RESOURCE_COMMAND_MOUNT_STATE');
      });
      if (summary.initialized) need(summary.declaredBytes === total, 'RESOURCE_COMMAND_DECLARED_BYTES');
      if (result.ok) need(summary.initialized && (operation === 'SUMMARY' || !summary.dirty) && summary.operation === '', 'RESOURCE_COMMAND_SUCCESS_STATE');
    }
    function validateReport(report, request) {
      var result = report.result, summary = report.summary;
      need(object(result) && typeof result.ok === 'boolean' && typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(result.code), 'RESOURCE_COMMAND_RESULT');
      validateSummary(summary, request.op, result);
      if (request.op === 'LOAD_SCENE' && Object.prototype.hasOwnProperty.call(result, 'evidence')) {
        keys(result, ['ok', 'code', 'evidence']);
        var e = result.evidence;
        keys(e, ['schema','entryScene','loadedResourcePath','resourceLoadAttempted','packedSceneVerified','canInstantiate','instantiated','targetInstanceId','signalConnectError','changeAttempted','changeError','submitted','sceneChangedObserved','currentSceneId','currentScenePath','exactInstance','parentIsRoot','insideTree','nodeReady','queuedForDeletion','guardState','state','rollbackPerformed','visualVerified','evidenceScope']);
        need(e.schema === 'wxslim-resource-scene-evidence-v1' && e.entryScene === allow[request.packId].entryScene && typeof e.entryScene === 'string', 'RESOURCE_COMMAND_SCENE_IDENTITY');
        ['loadedResourcePath','currentScenePath'].forEach(function (key) { need(e[key] === null || (typeof e[key] === 'string' && e[key].length <= 1024 && (e[key] === '' || /^res:\/\//.test(e[key]))), 'RESOURCE_COMMAND_SCENE_PATH'); });
        ['resourceLoadAttempted','packedSceneVerified','instantiated','changeAttempted','submitted','sceneChangedObserved'].forEach(function (key) { need(typeof e[key] === 'boolean', 'RESOURCE_COMMAND_SCENE_BOOLEAN'); });
        ['canInstantiate','exactInstance','parentIsRoot','insideTree','nodeReady','queuedForDeletion'].forEach(function (key) { need(e[key] === null || typeof e[key] === 'boolean', 'RESOURCE_COMMAND_SCENE_OBSERVATION'); });
        ['targetInstanceId','currentSceneId'].forEach(function (key) { need(e[key] === null || (typeof e[key] === 'string' && /^[1-9][0-9]{0,31}$/.test(e[key])), 'RESOURCE_COMMAND_SCENE_INSTANCE'); });
        ['signalConnectError','changeError'].forEach(function (key) { need(e[key] === null || (Number.isSafeInteger(e[key]) && e[key] >= 0), 'RESOURCE_COMMAND_SCENE_ERROR'); });
        need(['NOT_CHECKED','ALLOWED','DENIED','INVALID'].indexOf(e.guardState) >= 0 && ['NOT_ATTEMPTED','PREPARE_FAILED','NOT_SUBMITTED','SUBMITTED_UNCONFIRMED','TREE_CONFIRMED','UNKNOWN_AFTER_SUBMIT'].indexOf(e.state) >= 0, 'RESOURCE_COMMAND_SCENE_STATE');
        need(e.rollbackPerformed === false && e.visualVerified === false && e.evidenceScope === 'NATIVE_OR_WEB_SCENE_TREE_ONLY', 'RESOURCE_COMMAND_SCENE_SCOPE');
        need(!e.submitted || (e.changeAttempted && e.changeError === 0 && e.instantiated), 'RESOURCE_COMMAND_SCENE_SUBMISSION');
        need(!e.instantiated || (e.packedSceneVerified && e.canInstantiate && e.targetInstanceId !== null), 'RESOURCE_COMMAND_SCENE_INSTANTIATION');
        need(!e.changeAttempted || (e.instantiated && e.signalConnectError === 0), 'RESOURCE_COMMAND_SCENE_CHANGE');
        if (e.state === 'TREE_CONFIRMED' || result.ok) {
          need(e.state === 'TREE_CONFIRMED' && e.resourceLoadAttempted && e.packedSceneVerified && e.canInstantiate && e.instantiated && e.submitted && e.sceneChangedObserved && e.targetInstanceId === e.currentSceneId && e.exactInstance === true && e.parentIsRoot === true && e.insideTree === true && e.nodeReady === true && e.queuedForDeletion === false && e.loadedResourcePath === e.entryScene && e.currentScenePath === e.loadedResourcePath, 'RESOURCE_COMMAND_SCENE_NOT_CONFIRMED');
        }
        need(!result.ok || (result.code === 'SCENE_TREE_CONFIRMED' && e.guardState === 'ALLOWED'), 'RESOURCE_COMMAND_SCENE_NOT_CONFIRMED');
        need(summary.packs.some(function (p) { return p.id === request.packId && p.state === 'MOUNTED'; }), 'RESOURCE_COMMAND_SCENE_MOUNT_REQUIRED');
        return;
      }
      if (!result.ok) {
        keys(result, Object.prototype.hasOwnProperty.call(result, 'engineError') ? ['ok', 'code', 'engineError'] : ['ok', 'code']);
        if ('engineError' in result) need(Number.isSafeInteger(result.engineError) && result.engineError >= 0, 'RESOURCE_COMMAND_ENGINE_ERROR');
        return;
      }
      if (request.op === 'BEGIN') { keys(result, ['ok', 'code', 'summary']); need(result.code === 'MANIFEST_ACCEPTED' && equal(result.summary, summary) && summary.packs.every(function (p) { return p.state === 'DECLARED'; }), 'RESOURCE_COMMAND_BEGIN_RESULT'); return; }
      if (request.op === 'SUMMARY') { keys(result, ['ok', 'code']); need(result.code === 'SUMMARY_OBSERVED', 'RESOURCE_COMMAND_SUMMARY_RESULT'); return; }
      if (request.op === 'ENTRY') {
        keys(result, ['ok', 'code', 'entryScene', 'existsVerified', 'packedSceneVerified', 'sceneLoadAttempted']);
        need(typeof allow[request.packId].entryScene === 'string' && result.code === 'ENTRY_ALLOWLISTED_ONLY' && result.entryScene === allow[request.packId].entryScene && result.existsVerified === false && result.packedSceneVerified === false && result.sceneLoadAttempted === false, 'RESOURCE_COMMAND_ENTRY_RESULT');
        need(summary.packs.some(function (p) { return p.id === request.packId && p.state === 'MOUNTED'; }), 'RESOURCE_COMMAND_ENTRY_STATE'); return;
      }
      need(request.op !== 'LOAD_SCENE', 'RESOURCE_COMMAND_SCENE_EVIDENCE_REQUIRED');
      keys(result, ['ok', 'code', 'pack']);
      var codes = {VERIFY:['VERIFIED', 'ALREADY_VERIFIED'], STAGE:['STAGED_VERIFIED', 'ALREADY_STAGED'], MOUNT:['MOUNTED', 'ALREADY_MOUNTED']};
      var states = {VERIFY:['VERIFIED', 'STAGED_VERIFIED', 'MOUNTED'], STAGE:['STAGED_VERIFIED', 'MOUNTED'], MOUNT:['MOUNTED']};
      need(codes[request.op].indexOf(result.code) >= 0 && result.pack.id === request.packId && states[request.op].indexOf(result.pack.state) >= 0 && summary.packs.some(function (p) { return p.id === request.packId && equal(p, result.pack); }), 'RESOURCE_COMMAND_PACK_RESULT');
    }
    function settle(report) {
      var item = pending; item.observedReport = freeze(report); lastReport = item.observedReport; lastSummary = report.summary;
      if (report.op === 'LOAD_SCENE' && report.result.evidence && sceneAttempted !== true) sceneAttempted = report.result.evidence.resourceLoadAttempted;
      if (!live() || item.settled) return;
      if (item.header.op === 'BEGIN' && report.result.ok) begun = true;
      if (!report.result.ok) failure = report.result.code;
      item.settled = true; pending = null; item.bytes = null; item.resolve(item.observedReport);
    }
    function receiveReport(text) {
      var report;
      try { report = parse(text); }
      catch (_) { if (pending && live()) unknownFailure('RESOURCE_COMMAND_INVALID_REPORT_UNKNOWN'); return false; }
      if (!pending) { ignoredReports++; return false; }
      var request = pending.header;
      if (!object(report) || !equal(report.identity, identity) || report.requestId !== request.requestId) { ignoredReports++; return false; }
      try {
        keys(report, ['schema', 'identity', 'requestId', 'op', 'packId', 'result', 'summary']);
        need(report.schema === 'wxslim-resource-command-result-v1' && report.op === request.op && report.packId === request.packId, 'RESOURCE_COMMAND_REPORT_HEADER');
        validateReport(report, request);
      } catch (_) { unknownFailure('RESOURCE_COMMAND_INVALID_REPORT_UNKNOWN'); return false; }
      if (pending.observedReport || pending.queuedReport) { ignoredReports++; return false; }
      if (pending.invoking) pending.queuedReport = report; else settle(report);
      return true;
    }
    function reportResult(text) {
      try { return receiveReport(text); }
      catch (_) { if (pending) unknownFailure('RESOURCE_COMMAND_INVALID_REPORT_UNKNOWN'); return false; }
    }
    var bridgeInterface = Object.freeze({
      configuration:function () { return configJson; },
      attach:function (helloJson, receiver) {
        need(live() && !attachAttempted, 'RESOURCE_COMMAND_ATTACH_ONCE'); attachAttempted = true;
        var hello = parse(helloJson); keys(hello, ['schema', 'identity', 'boot']);
        need(hello.schema === 'wxslim-resource-command-hello-v1' && equal(hello.identity, identity) && equal(hello.boot, boot) && typeof receiver === 'function', 'RESOURCE_COMMAND_HELLO');
        callback = receiver; attached = true; return true;
      },
      report:reportResult,
      isActive:function (identityJson) { try { var value = parse(identityJson); validIdentity(value); return live() && equal(value, identity); } catch (_) { return false; } },
      // Read only: never calls a caller guard or clears cancellation. Deferred
      // Godot work must match this exact request, not merely the engine session.
      isRequestActive:function (headerJson) { try { var value = parse(headerJson); return live() && pending !== null && !pending.settled && !pending.queuedReport && !pending.observedReport && !pending.cancelRequested && equal(value, pending.header); } catch (_) { return false; } },
      isAcceptedBuffer:acceptedBuffer
    });
    function dispatchTracked(op, packId, bytes, control) {
      var invocationResolve, resultResolve, resultReject, invoked = false, cancelledLatch = false, finished = false, requestItem = null;
      var invocation = new Promise(function (resolve) { invocationResolve = resolve; });
      var result = new Promise(function (resolve, reject) { resultResolve = resolve; resultReject = reject; });
      // A caller must consume the invocation receipt before the result. Observe
      // rejection here without changing the original, still-rejecting promise.
      result.catch(function () {});
      function receipt(status, code, header) {
        return freeze({schema:'wxslim-resource-command-invocation-v1', identity:identity,
          status:status, code:code, header:header || null,
          sideEffects:status === 'INVOKED' ? 'UNKNOWN' : 'NOT_INVOKED', runtimeVerified:false});
      }
      Promise.resolve().then(function () {
        if (control !== undefined) { keys(control, ['cancelRequested']); need(typeof control.cancelRequested === 'function', 'RESOURCE_COMMAND_CANCEL_CHECK'); }
        need(live() && attached, 'RESOURCE_COMMAND_NOT_ACTIVE'); need(!pending, 'RESOURCE_COMMAND_PENDING');
        need(['BEGIN', 'VERIFY', 'STAGE', 'MOUNT', 'ENTRY', 'LOAD_SCENE', 'SUMMARY'].indexOf(op) >= 0, 'RESOURCE_COMMAND_OP');
        need(typeof packId === 'string', 'RESOURCE_COMMAND_PACK_REQUIRED');
        need((op === 'BEGIN' || op === 'SUMMARY') ? packId === '' : !!allow[packId], 'RESOURCE_COMMAND_PACK');
        need(op === 'BEGIN' ? !begun && sequence === '0' : begun, 'RESOURCE_COMMAND_BEGIN_REQUIRED');
        need(!failure || op === 'SUMMARY', 'RESOURCE_COMMAND_FAILURE_LATCHED');
        need((op !== 'ENTRY' && op !== 'LOAD_SCENE') || allow[packId].entryScene !== null, 'RESOURCE_COMMAND_ENTRY_SCENE_NOT_DECLARED');
        var snapshot = null;
        if (op === 'VERIFY') { need(acceptedBuffer(bytes) && lengthOf.call(bytes) === allow[packId].bytes, 'RESOURCE_COMMAND_BYTES'); snapshot = new Uint8Array(lengthOf.call(bytes)); snapshot.set(bytes); }
        else need(bytes === undefined, 'RESOURCE_COMMAND_UNEXPECTED_BYTES');
        var next = increment(sequence); need(next.length <= 32, 'RESOURCE_COMMAND_REQUEST_ID_LIMIT');
        var header = freeze({schema:'wxslim-resource-command-v1', identity:identity, requestId:next, op:op, packId:packId});
        var headerJson = serialize(header), cancelled = false;
        // The guard is synchronous. No awaited work separates its decision from
        // invoking the real receiver. Async checks cannot establish this boundary.
        if (control !== undefined) {
          try { cancelled = control.cancelRequested(); } catch (_) { throw error('RESOURCE_COMMAND_CANCEL_CHECK'); }
          if (typeof cancelled !== 'boolean') {
            // Reject async guards without awaiting them. Observe a real Promise's
            // rejection so a rejected guard cannot escape as unhandledRejection.
            // Do not call arbitrary thenables or accept their eventual result.
            try { Promise.prototype.then.call(cancelled, function () {}, function () {}); } catch (_) {}
          }
          need(typeof cancelled === 'boolean', 'RESOURCE_COMMAND_CANCEL_CHECK');
        }
        need(!cancelled && !cancelledLatch, 'RESOURCE_COMMAND_CANCELLED_BEFORE_INVOKE');
        // The guard is caller code and may invalidate the session reentrantly.
        need(live() && attached, 'RESOURCE_COMMAND_NOT_ACTIVE'); need(!pending, 'RESOURCE_COMMAND_PENDING');
        var item = {header:header, bytes:snapshot, resolve:resultResolve, reject:resultReject, settled:false, invoking:true, queuedReport:null, observedReport:null, timedOut:false, sideEffects:'UNKNOWN',cancelRequested:false};
        requestItem = item;
        sequence = next; pending = item; invoked = true;
        if (op === 'LOAD_SCENE' && sceneAttempted !== true) sceneAttempted = null; // Actual deferred execution is not observed yet.
        invocationResolve(receipt('INVOKED', 'RESOURCE_COMMAND_CALLBACK_INVOKED', header));
        try { if (op === 'VERIFY') callback(headerJson, snapshot); else callback(headerJson); }
        catch (_) { if (item.queuedReport) item.observedReport = freeze(item.queuedReport); unknownFailure('RESOURCE_COMMAND_CALLBACK_THROW_UNKNOWN'); }
        item.invoking = false;
        if (item.queuedReport && live()) settle(item.queuedReport);
      }).catch(function (cause) {
        if (invoked) { unknownFailure('RESOURCE_COMMAND_POSTINVOKE_UNKNOWN'); resultReject(error('RESOURCE_COMMAND_POSTINVOKE_UNKNOWN')); return; }
        var code = cause && typeof cause.code === 'string' && /^RESOURCE_COMMAND_[A-Z0-9_]+$/.test(cause.code) ? cause.code : 'RESOURCE_COMMAND_PREINVOKE_FAILED';
        invocationResolve(receipt('NOT_INVOKED', code, null));
        resultReject(error(code));
      });
      result.then(function () { finished = true; }, function () { finished = true; });
      return Object.freeze({invocation:invocation, result:result, cancel:function () {
        if (finished || (requestItem && requestItem.settled)) return false;
        cancelledLatch = true; if (requestItem) requestItem.cancelRequested = true;
        return true; // Request only; no abort, result settlement or rollback.
      }});
    }
    function dispatch(op, packId, bytes) { return dispatchTracked(op, packId, bytes).result; }
    return Object.freeze({interface:bridgeInterface, dispatch:dispatch, dispatchTracked:dispatchTracked, readerManifest:reader,
      invalidate:function () { invalidated = true; if (pending && pending.queuedReport && !pending.observedReport) pending.observedReport = freeze(pending.queuedReport); if (pending && !pending.settled) { pending.settled = true; pending.reject(error('RESOURCE_COMMAND_INVALIDATED_SIDE_EFFECTS_UNKNOWN')); } return false; },
      observeTimeout:function () { if (pending) pending.timedOut = true; return !!pending; },
      status:function () { return freeze({schema:'wxslim-resource-command-status-v1', identity:identity, attached:attached, beginSucceeded:begun, invalidated:invalidated, unknownFailure:unknown, failureCode:failure, ignoredReports:ignoredReports, pending:pending ? {header:pending.header, timedOut:pending.timedOut, promiseSettled:pending.settled, cancelRequested:pending.cancelRequested, sideEffects:'UNKNOWN', observedReport:pending.observedReport} : null, lastReport:lastReport, lastSummary:lastSummary, runtime:'NOT_VERIFIED', sceneLoadAttempted:sceneAttempted, rollbackPerformed:false}); }
    });
  }
  if (typeof module === 'object' && module.exports) module.exports = createResourceCommandBridge;
}());
