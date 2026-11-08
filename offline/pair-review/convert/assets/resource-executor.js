/* Explicit ES2016 serial resource executor. CJS only; never auto-starts or persists. */
(function () {
  'use strict';
  function need(value, code) { if (!value) { var e = new Error(code); e.code = code; throw e; } }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (k) { freeze(value[k]); }); Object.freeze(value); } return value; }
  function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}'; return JSON.stringify(v); }
  function equal(a, b) { return canonical(a) === canonical(b); }
  function exact(v, names) { return v && typeof v === 'object' && !Array.isArray(v) && Reflect.ownKeys(v).length === names.length && names.every(function (k) { return Object.prototype.hasOwnProperty.call(v, k); }); }
  function safeCode(cause, fallback) { try { var d = cause && Object.getOwnPropertyDescriptor(cause, 'code'); if (d && typeof d.value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(d.value)) return d.value; } catch (_) {} return fallback; }
  function readDiagnostic(cause) {
    var result = {api:'readFile',errno:null,reason:'UNKNOWN'};
    try {
      var outer = Object.getOwnPropertyDescriptor(cause, 'platformDiagnostic'), value = outer && outer.value;
      if (!value || Reflect.ownKeys(value).length !== 3) return result;
      var api = Object.getOwnPropertyDescriptor(value, 'api'), errno = Object.getOwnPropertyDescriptor(value, 'errno'), reason = Object.getOwnPropertyDescriptor(value, 'reason');
      if (!api || !errno || !reason || api.value !== 'readFile' || !Object.prototype.hasOwnProperty.call(errno, 'value') || !Object.prototype.hasOwnProperty.call(reason, 'value')) return result;
      if (errno.value !== null && (typeof errno.value !== 'number' || !Number.isSafeInteger(errno.value) || errno.value < -2147483648 || errno.value > 2147483647)) return result;
      if (['PERMISSION_DENIED','NOT_FOUND','INVALID_ARGUMENT','UNKNOWN'].indexOf(reason.value) < 0) return result;
      return {api:'readFile',errno:errno.value,reason:reason.value};
    } catch (_) { return result; }
  }
  function utf8Bounded(text) { if (typeof text !== 'string') return false; var n = 0; for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); if (c < 128) n++; else if (c < 2048) n += 2; else if (c >= 55296 && c <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { n += 4; i++; } else n += 3; if (n > 262144) return false; } return true; }
  var PREINVOKE = ['CANCEL_CHECK','NOT_ACTIVE','PENDING','OP','PACK_REQUIRED','PACK','BEGIN_REQUIRED','FAILURE_LATCHED','BYTES','UNEXPECTED_BYTES','REQUEST_ID_LIMIT','JSON_LIMIT','CANCELLED_BEFORE_INVOKE','PREINVOKE_FAILED','ENTRY_SCENE_NOT_DECLARED'].map(function (code) { return 'RESOURCE_COMMAND_' + code; });
  function createOneJob(options, skipBegin) {
    need(exact(options, ['stateCore', 'mountCore', 'sceneCore', 'bridge', 'reader', 'boot']), 'RESOURCE_EXECUTOR_OPTIONS');
    var stateCore = options.stateCore, mountCore = options.mountCore, sceneCore = options.sceneCore, bridge = options.bridge, reader = options.reader;
    need(stateCore && typeof stateCore.initialResourceLoadState === 'function' && typeof stateCore.advanceResourceLoad === 'function' && mountCore && typeof mountCore.createResourceMountCommand === 'function' && sceneCore && typeof sceneCore.createResourceSceneCommand === 'function', 'RESOURCE_EXECUTOR_CORES');
    need(bridge && typeof bridge.dispatchTracked === 'function' && bridge.interface && typeof bridge.interface.configuration === 'function' && typeof bridge.interface.isAcceptedBuffer === 'function' && typeof bridge.status === 'function' && reader && typeof reader.read === 'function', 'RESOURCE_EXECUTOR_TRANSPORT');
    var text = bridge.interface.configuration(); need(utf8Bounded(text), 'RESOURCE_EXECUTOR_CONFIG');
    var config = freeze(JSON.parse(text)), boot = freeze(copy(options.boot));
    if (skipBegin) need(bridge.status().beginSucceeded === true, 'RESOURCE_EXECUTOR_BEGIN_NOT_CONFIRMED');
    need(exact(config, ['schema', 'identity', 'boot', 'manifest']) && config.schema === 'wxslim-resource-command-config-v1' && equal(config.boot, boot), 'RESOURCE_EXECUTOR_BINDING');
    need(exact(config.identity, ['taskId', 'attemptId', 'engineSession']) && exact(config.manifest, ['packs']) && Array.isArray(config.manifest.packs), 'RESOURCE_EXECUTOR_CONFIG');
    var allow = Object.create(null), total = 0;
    config.manifest.packs.forEach(function (p) {
      need(exact(p, ['id', 'bytes', 'sha256', 'entryScene', 'requires']) && typeof p.id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(p.id) && !allow[p.id] && Number.isSafeInteger(p.bytes) && p.bytes >= 4 && p.bytes <= 33554432 && /^[a-f0-9]{64}$/.test(p.sha256) && (p.entryScene === null || typeof p.entryScene === 'string') && Array.isArray(p.requires), 'RESOURCE_EXECUTOR_PACK');
      allow[p.id] = p; total += p.bytes;
    });
    need(config.manifest.packs.length > 0 && config.manifest.packs.length <= 128 && total <= 67108864, 'RESOURCE_EXECUTOR_BUDGET');
    var visiting = Object.create(null), done = Object.create(null);
    function visit(id, order) {
      need(allow[id] && !visiting[id], 'RESOURCE_EXECUTOR_DEPENDENCY'); if (done[id]) return;
      visiting[id] = true; var seen = Object.create(null);
      allow[id].requires.forEach(function (dep) { need(typeof dep === 'string' && dep !== id && !seen[dep], 'RESOURCE_EXECUTOR_DEPENDENCY'); seen[dep] = true; visit(dep, order); });
      delete visiting[id]; done[id] = true; order.push(id);
    }
    var all = []; Object.keys(allow).forEach(function (id) { visit(id, all); });
    var started = false, finished = false, cancelled = false, target = null, targetState = null, active = null, activeAdapter = false, cancelErrorCode = null;
    var outcome = 'NEW', operations = [], adapters = [], lastSummary = null, failure = null, memoryReceipt = null, sceneConfirmed = false;
    function snapshot() {
      var observedState = targetState, observationErrorCode = null, lateObservedReport = null, observedSummary = lastSummary;
      if (activeAdapter && active && typeof active.snapshot === 'function') {
        try { var adapterState = active.snapshot().state; stateCore.advanceResourceLoad(adapterState, {type:'DOWNLOAD_COMPLETE',identity:adapterState.identity}); need(equal(adapterState.identity, targetState.identity), 'RESOURCE_EXECUTOR_OBSERVATION_IDENTITY'); observedState = adapterState; }
        catch (cause) { observationErrorCode = safeCode(cause, 'RESOURCE_EXECUTOR_OBSERVATION_FAILED'); }
      }
      try { var transport = bridge.status(), raw = transport.pending && transport.pending.observedReport;
        if (raw && equal(raw.identity, config.identity) && raw.requestId === transport.pending.header.requestId && raw.op === transport.pending.header.op && raw.packId === transport.pending.header.packId) { lateObservedReport = raw; observedSummary = raw.summary; }
      } catch (_) {}
      var mounted = observedSummary && observedSummary.packs ? observedSummary.packs.filter(function (p) { return p.state === 'MOUNTED'; }).map(function (p) { return p.id; }) : [];
      return freeze(copy({schema:'wxslim-resource-executor-v1', outcome:outcome, started:started, finished:finished, cancelRequested:cancelled,
        identity:config.identity, boot:boot, manifest:config.manifest, targetPackId:target, targetState:observedState, targetStateOwner:finished?'CALLER':activeAdapter?'ADAPTER':'EXECUTOR', operations:operations, adapters:adapters,
        lastSummary:observedSummary, lateObservedReport:lateObservedReport, observationErrorCode:observationErrorCode, mountedPacks:mounted, failure:failure, memoryReceipt:memoryReceipt, cancelErrorCode:cancelErrorCode,
        receiptScope:'MEMORY_ONLY_NOT_PERSISTED', sceneTreeConfirmationObserved:sceneConfirmed, visualVerified:false, runtimeVerified:false, capabilityEnabled:false, rollbackPerformed:false}));
    }
    function apply(type, extra) {
      var event = {type:type, identity:targetState.identity}; Object.keys(extra || {}).forEach(function (k) { event[k] = extra[k]; });
      var next = stateCore.advanceResourceLoad(targetState, event); need(next.disposition === 'APPLIED', 'RESOURCE_EXECUTOR_STATE'); targetState = next.state;
    }
    function stop(kind, code, id, op, diagnostic) {
      var value = {executorStop:true, kind:kind, code:code, packId:id, op:op};
      if (diagnostic) value.platformDiagnostic = diagnostic;
      throw value;
    }
    function updateSummary(report) { if (report && report.summary) lastSummary = copy(report.summary); }
    function checkBindings() { need(bridge.interface.configuration() === text, 'RESOURCE_EXECUTOR_CONFIG_CHANGED'); }
    function finish(kind) {
      if (kind === 'SUCCESS' && !sceneConfirmed) { kind = 'UNKNOWN'; failure = {packId:target, op:'LOAD_SCENE', code:'RESOURCE_EXECUTOR_SCENE_PROOF_MISSING'}; }
      if (kind !== 'UNKNOWN' && targetState && targetState.phase === 'COMMITTING') {
        var desired = targetState.requestedTerminal;
        if (desired === 'SUCCESS' && cancelled) desired = 'CANCELLED';
        // This caller event confirms only the memory receipt below, never disk.
        apply('COMMIT_SUCCESS', {status:desired, details:{receiptScope:'MEMORY_ONLY_NOT_PERSISTED', persisted:false}}); kind = desired;
      }
      outcome = kind; finished = true; active = null;
      if (kind !== 'UNKNOWN') memoryReceipt = freeze(copy({schema:'wxslim-resource-executor-memory-receipt-v1', scope:'MEMORY_ONLY_NOT_PERSISTED', status:kind,
        identity:config.identity, targetPackId:target, boot:boot, lastSummary:lastSummary, failure:failure, persisted:false, visualVerified:false}));
      return snapshot();
    }
    function cancelledBoundary(id, op) { if (cancelled) stop('CANCELLED', 'RESOURCE_EXECUTOR_CANCELLED', id, op); }
    function command(op, id, bytes) {
      cancelledBoundary(id, op); checkBindings();
      var record = {packId:id, op:op, invocation:null, report:null, observedReport:null, outcome:'WAITING', code:null}; operations.push(record);
      var tracked;
      try { tracked = bridge.dispatchTracked(op, id, bytes, {cancelRequested:function () { return cancelled; }}); }
      catch (cause) { record.outcome = 'UNKNOWN'; stop('UNKNOWN', safeCode(cause, 'RESOURCE_EXECUTOR_NO_TICKET'), id, op); }
      active = tracked; activeAdapter = false;
      var observed = Promise.resolve(tracked && tracked.result).then(function (v) { return {ok:true, value:v}; }, function (cause) { return {ok:false, code:safeCode(cause, 'RESOURCE_EXECUTOR_RESULT_UNKNOWN')}; });
      need(tracked && tracked.invocation && typeof tracked.invocation.then === 'function' && tracked.result && typeof tracked.result.then === 'function', 'RESOURCE_EXECUTOR_TRACKING');
      return Promise.resolve(tracked.invocation).then(function (ticket) {
        need(exact(ticket, ['schema', 'identity', 'status', 'code', 'header', 'sideEffects', 'runtimeVerified']) && ticket.schema === 'wxslim-resource-command-invocation-v1' && equal(ticket.identity, config.identity) && ticket.runtimeVerified === false, 'RESOURCE_EXECUTOR_TICKET');
        record.invocation = copy(ticket);
        if (ticket.status === 'NOT_INVOKED') {
          need(ticket.header === null && ticket.sideEffects === 'NOT_INVOKED' && PREINVOKE.indexOf(ticket.code) >= 0, 'RESOURCE_EXECUTOR_TICKET');
          record.outcome = 'NOT_INVOKED'; record.code = ticket.code; active = null;
          stop(cancelled && ticket.code === 'RESOURCE_COMMAND_CANCELLED_BEFORE_INVOKE' ? 'CANCELLED' : 'FAILED', ticket.code, id, op);
        }
        var h = ticket.header;
        need(ticket.status === 'INVOKED' && ticket.code === 'RESOURCE_COMMAND_CALLBACK_INVOKED' && ticket.sideEffects === 'UNKNOWN' && h && h.op === op && h.packId === id && equal(h.identity, config.identity) && typeof h.requestId === 'string' && /^[1-9][0-9]{0,31}$/.test(h.requestId), 'RESOURCE_EXECUTOR_TICKET');
        record.outcome = 'INVOKED';
        return observed.then(function (received) {
          if (!received.ok) {
            record.outcome = 'UNKNOWN'; record.code = received.code;
            try { var raw = bridge.status().pending.observedReport; if (raw && raw.requestId === h.requestId && raw.op === op && raw.packId === id && equal(raw.identity, config.identity)) { record.observedReport = copy(raw); updateSummary(raw); } } catch (_) {}
            stop('UNKNOWN', received.code, id, op);
          }
          var report = received.value;
          need(exact(report, ['schema', 'identity', 'requestId', 'op', 'packId', 'result', 'summary']) && report.schema === 'wxslim-resource-command-result-v1' && report.requestId === h.requestId && report.op === op && report.packId === id && equal(report.identity, config.identity) && report.result && typeof report.result.ok === 'boolean', 'RESOURCE_EXECUTOR_REPORT');
          record.report = copy(report); updateSummary(report); record.outcome = report.result.ok ? 'REPORTED_OK' : 'REPORTED_FAILED'; active = null;
          if (!report.result.ok) stop(cancelled ? 'CANCELLED' : 'FAILED', report.result.code, id, op);
          return report;
        });
      });
    }
    function readPack(id) {
      cancelledBoundary(id, 'READ'); checkBindings();
      var record = {packId:id, op:'READ', outcome:'WAITING', bytes:null, expectedSha256:null, hashVerified:false, code:null}; operations.push(record);
      return Promise.resolve().then(function () { return reader.read(id); }).then(function (value) {
        var pin = allow[id]; need(value && value.status === 'READ_PENDING_HASH_VERIFICATION' && value.id === id && value.length === pin.bytes && value.expectedHash === pin.sha256 && value.hashVerified === false && value.artifactIntegrityChecked === false && value.runtimeVerified === false && value.executionAuthorized === false && bridge.interface.isAcceptedBuffer(value.bytes) === true && value.bytes.byteLength === pin.bytes, 'RESOURCE_EXECUTOR_READ_PIN');
        record.outcome = 'READ_PENDING_HASH_VERIFICATION'; record.bytes = value.length; record.expectedSha256 = value.expectedHash;
        return value.bytes;
      }, function (cause) {
        record.outcome = 'READ_FAILED'; record.code = safeCode(cause, 'RESOURCE_EXECUTOR_READ_FAILED');
        if (record.code === 'RESOURCE_READER_READ_FAILED') record.platformDiagnostic = readDiagnostic(cause);
        stop(cancelled ? 'CANCELLED' : 'FAILED', record.code, id, 'READ', record.platformDiagnostic);
      });
    }
    function dependency(id) {
      return readPack(id).then(function (bytes) { return command('VERIFY', id, bytes); }).then(function () { cancelledBoundary(id, 'STAGE'); return command('STAGE', id); }).then(function () { cancelledBoundary(id, 'MOUNT'); return command('MOUNT', id); }).then(function () { cancelledBoundary(id, 'DEPENDENCY_COMPLETE'); });
    }
    function runAdapter(factory, op) {
      cancelledBoundary(target, op); checkBindings();
      var adapter = factory({bridge:bridge, state:targetState, boot:boot}); active = adapter; activeAdapter = true;
      return adapter.start().then(function (value) {
        adapters.push(copy(value)); active = null; activeAdapter = false; targetState = value.state; updateSummary(value.report || value.observedReport);
        if (value.outcome === 'UNKNOWN') stop('UNKNOWN', value.transportErrorCode || value.unknownCode || 'RESOURCE_EXECUTOR_ADAPTER_UNKNOWN', target, op);
        need(['MOUNT_REPORTED','SCENE_REPORTED','PREINVOKE_FAILED','CANCELLED_BEFORE_INVOKE'].indexOf(value.outcome) >= 0, 'RESOURCE_EXECUTOR_ADAPTER_OUTCOME');
        if (op === 'LOAD_SCENE' && value.report && value.report.result && value.report.result.ok) {
          var r = value.report, e = r.result.evidence;
          need(r.op === 'LOAD_SCENE' && r.packId === target && equal(r.identity, config.identity) && r.result.code === 'SCENE_TREE_CONFIRMED' && e && e.state === 'TREE_CONFIRMED' && e.sceneChangedObserved === true && e.exactInstance === true && e.targetInstanceId === e.currentSceneId && e.parentIsRoot === true && e.insideTree === true && e.nodeReady === true && e.queuedForDeletion === false && e.loadedResourcePath === allow[target].entryScene && e.currentScenePath === allow[target].entryScene && e.visualVerified === false, 'RESOURCE_EXECUTOR_SCENE_PROOF_INVALID');
          sceneConfirmed = true;
        }
        return value;
      });
    }
    function targetFlow() {
      cancelledBoundary(target, 'TARGET_START');
      targetState = stateCore.initialResourceLoadState({taskId:config.identity.taskId, attemptId:config.identity.attemptId, engineSessionId:config.identity.engineSession, packId:target}); apply('START');
      return readPack(target).then(function (bytes) { apply('DOWNLOAD_SUCCESS'); if (targetState.phase === 'COMMITTING') return null; return command('VERIFY', target, bytes); }).then(function () {
        if (targetState.phase === 'COMMITTING') return null;
        apply('VERIFY_SUCCESS'); if (targetState.phase === 'COMMITTING') return null; return command('STAGE', target);
      }).then(function () {
        if (targetState.phase === 'COMMITTING') return null;
        apply('STAGE_SUCCESS'); if (targetState.phase === 'COMMITTING') return null;
        return runAdapter(mountCore.createResourceMountCommand, 'MOUNT');
      }).then(function () {
        if (targetState.phase === 'COMMITTING') return null;
        return runAdapter(sceneCore.createResourceSceneCommand, 'LOAD_SCENE');
      }).then(function () { need(targetState.phase === 'COMMITTING', 'RESOURCE_EXECUTOR_TARGET_UNSETTLED'); return finish(targetState.requestedTerminal); });
    }
    function handleFailure(cause) {
      var known = cause && cause.executorStop === true, kind = known ? cause.kind : 'UNKNOWN';
      failure = {packId:known ? cause.packId : target, op:known ? cause.op : 'EXECUTOR', code:known ? cause.code : safeCode(cause, 'RESOURCE_EXECUTOR_UNKNOWN')};
      if (known && failure.op === 'READ' && failure.code === 'RESOURCE_READER_READ_FAILED') failure.platformDiagnostic = readDiagnostic(cause);
      if (kind === 'UNKNOWN') return finish('UNKNOWN');
      if (targetState && ['DOWNLOADING', 'VERIFYING', 'STAGING'].indexOf(targetState.phase) >= 0) {
        var phase = targetState.phase;
        if (cancelled && !targetState.cancelRequested) apply('CANCEL');
        apply({DOWNLOADING:'DOWNLOAD_FAILURE', VERIFYING:'VERIFY_FAILURE', STAGING:'STAGE_FAILURE'}[phase], {details:{code:/^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code) ? failure.code : 'RESOURCE_EXECUTOR_OPERATION_FAILED'}});
      }
      return finish(kind);
    }
    return Object.freeze({snapshot:snapshot,
      cancel:function () {
        if (finished) return snapshot(); cancelled = true;
        if (active && typeof active.cancel === 'function') { try { var observed = active.cancel(); if (activeAdapter && observed && observed.state) targetState = observed.state; } catch (cause) { cancelErrorCode = safeCode(cause, 'RESOURCE_EXECUTOR_CANCEL_LATCH_FAILED'); } }
        if (targetState && !activeAdapter && !targetState.cancelRequested) apply('CANCEL');
        if (!started) return finish('CANCELLED');
        return snapshot();
      },
      load:function (id) {
        need(!started, 'RESOURCE_EXECUTOR_LOAD_ONCE'); started = true; target = id;
        if (finished || cancelled) return Promise.resolve(snapshot());
        need(typeof id === 'string' && allow[id] && typeof allow[id].entryScene === 'string', 'RESOURCE_EXECUTOR_TARGET_ENTRY');
        visiting = Object.create(null); done = Object.create(null); var order = []; visit(id, order); outcome = 'LOADING';
        var chain = Promise.resolve().then(function () {
          if (skipBegin) { checkBindings(); need(bridge.status().beginSucceeded === true, 'RESOURCE_EXECUTOR_BEGIN_NOT_CONFIRMED'); return null; }
          return command('BEGIN', '');
        });
        order.slice(0, -1).forEach(function (dep) { chain = chain.then(function () { return dependency(dep); }); });
        return chain.then(targetFlow).catch(handleFailure);
      }
    });
  }
  // Preserve the public one-job v1 factory and its LOAD_ONCE/cancel semantics.
  function createResourceExecutor(options) { return createOneJob(options, false); }
  createResourceExecutor.createSession = function (options) {
    // Validate using the same inert one-job core. There is no second transport,
    // render runtime, state machine or engine session hidden in this wrapper.
    createOneJob(options, false);
    var owned = Object.freeze({stateCore:options.stateCore,mountCore:options.mountCore,sceneCore:options.sceneCore,bridge:options.bridge,reader:options.reader,boot:freeze(copy(options.boot))});
    var bridge = owned.bridge, text = bridge.interface.configuration(), config = freeze(JSON.parse(text));
    var active = null, sequence = '0', closed = false, closedReason = null, history = [], historyDropped = 0, HISTORY_LIMIT = 8;
    function seal(reason) { if (!closed) { closed = true; closedReason = reason; } }
    function observe() {
      var value = null;
      try {
        if (bridge.interface.configuration() !== text) { seal('RESOURCE_EXECUTOR_SESSION_CONFIG_CHANGED'); return null; }
        value = bridge.status();
        if (!value || !equal(value.identity, config.identity)) seal('RESOURCE_EXECUTOR_SESSION_TRANSPORT_UNAVAILABLE');
        else if (value.invalidated || value.unknownFailure) seal('RESOURCE_EXECUTOR_SESSION_TRANSPORT_CLOSED');
        else if (value.failureCode) seal('RESOURCE_EXECUTOR_SESSION_COMMAND_FAILED');
        // Startup status is read before the Godot receiver attaches. A clean
        // not-yet-attached bridge is observable; it is not ready for load yet.
        else if (value.attached !== true && !(value.attached === false && value.beginSucceeded === false && !value.pending && !value.lastSummary)) seal('RESOURCE_EXECUTOR_SESSION_TRANSPORT_UNAVAILABLE');
        else if (value.lastSummary && value.lastSummary.dirty) seal('RESOURCE_EXECUTOR_SESSION_DIRTY');
        else if (value.pending && !active) seal('RESOURCE_EXECUTOR_SESSION_UNOWNED_PENDING');
      } catch (_) { seal('RESOURCE_EXECUTOR_SESSION_OBSERVATION_FAILED'); }
      return value;
    }
    function snapshot() {
      var transport = observe(), job = active ? active.executor.snapshot() : null;
      return freeze(copy({schema:'wxslim-resource-executor-session-v1',identity:config.identity,boot:owned.boot,manifest:config.manifest,
        phase:closed ? 'CLOSED' : active ? 'RUNNING' : 'IDLE',closed:closed,closedReason:closedReason,busy:active !== null || !!(transport && transport.pending),
        activeLoadId:active ? active.loadId : null,activeJob:job,lastLoadId:sequence,history:history,historyLimit:HISTORY_LIMIT,historyDropped:historyDropped,
        transport:transport,visualVerified:false,runtimeVerified:false,rollbackPerformed:false,receiptScope:'MEMORY_ONLY_NOT_PERSISTED'}));
    }
    function nextId() {
      var digits = sequence.split(''), carry = true;
      for (var i = digits.length - 1; i >= 0 && carry; i--) {
        if (digits[i] === '9') digits[i] = '0'; else { digits[i] = String(Number(digits[i]) + 1); carry = false; }
      }
      if (carry) digits.unshift('1'); var next = digits.join('');
      need(next.length <= 32, 'RESOURCE_EXECUTOR_SESSION_LOAD_ID_LIMIT'); return next;
    }
    function retain(job, result, rejection) {
      var failure = result && result.failure;
      history.push(freeze({loadId:job.loadId,targetPackId:job.packId,outcome:result ? result.outcome : 'UNKNOWN',
        failureCode:rejection || (failure ? failure.code : null),sceneTreeConfirmationObserved:!!(result && result.sceneTreeConfirmationObserved)}));
      if (history.length > HISTORY_LIMIT) { history.shift(); historyDropped++; }
    }
    return Object.freeze({snapshot:snapshot,
      load:function (id) {
        var transport = observe();
        need(!closed, 'RESOURCE_EXECUTOR_SESSION_CLOSED');
        need(transport && transport.attached === true, 'RESOURCE_EXECUTOR_SESSION_NOT_ATTACHED');
        need(!active && !(transport && transport.pending), 'RESOURCE_EXECUTOR_SESSION_BUSY');
        need(typeof id === 'string' && config.manifest.packs.some(function (p) { return p.id === id && typeof p.entryScene === 'string'; }), 'RESOURCE_EXECUTOR_TARGET_ENTRY');
        var loadId = nextId(), executor = createOneJob(owned, transport.beginSucceeded === true);
        var job = {loadId:loadId,packId:id,executor:executor}; sequence = loadId; active = job;
        // Every continuation closes over its own job. Repeated same-pack loads
        // never mutate another job's state, cancellation latch or receipt.
        return Promise.resolve().then(function () { return executor.load(id); }).then(function (result) {
          need(active === job, 'RESOURCE_EXECUTOR_SESSION_JOB_CHANGED');
          if (result.outcome === 'UNKNOWN') seal('RESOURCE_EXECUTOR_SESSION_JOB_UNKNOWN');
          else if (result.cancelErrorCode) seal('RESOURCE_EXECUTOR_SESSION_CANCEL_UNCONFIRMED');
          else if (result.outcome === 'FAILED' && (!result.failure || result.failure.op !== 'READ')) seal('RESOURCE_EXECUTOR_SESSION_JOB_FAILED');
          observe(); retain(job, result, null); active = null;
          return freeze({schema:'wxslim-resource-executor-session-load-v1',loadId:loadId,result:result});
        }).catch(function (cause) {
          seal('RESOURCE_EXECUTOR_SESSION_JOB_REJECTED');
          if (active === job) { retain(job, null, safeCode(cause, 'RESOURCE_EXECUTOR_SESSION_JOB_REJECTED')); active = null; }
          throw cause;
        });
      },
      cancel:function (loadId) {
        var matched = !!active && typeof loadId === 'string' && loadId === active.loadId;
        if (matched) { try { active.executor.cancel(); } catch (_) { seal('RESOURCE_EXECUTOR_SESSION_CANCEL_UNCONFIRMED'); } }
        return freeze({schema:'wxslim-resource-executor-session-cancel-v1',loadId:typeof loadId === 'string' ? loadId : null,matched:matched,session:snapshot()});
      },
      close:function () {
        seal('RESOURCE_EXECUTOR_SESSION_CLOSED_BY_CALLER');
        if (active) { try { active.executor.cancel(); } catch (_) {} }
        // Pending commands, Promise observers and mounted files remain owned by
        // the existing bridge/receiver; closing neither aborts nor invalidates.
        return snapshot();
      }
    });
  };
  if (typeof module === 'object' && module.exports) module.exports = createResourceExecutor;
}());
