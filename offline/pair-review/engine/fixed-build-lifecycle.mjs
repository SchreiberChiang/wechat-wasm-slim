// Sequential phase bookkeeping only. Phases own their process and evidence checks.
import {performance} from 'node:perf_hooks';

const terminals = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);
function errorRecord(error) {
  return {name:String(error?.name || 'Error'), code:String(error?.code || 'BUILD_PHASE_FAILED'), message:String(error?.message ?? error)};
}
function plainJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false;
  seen.add(value);
  const valid = Reflect.ownKeys(value).every(key => typeof key === 'string') && Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => 'value' in descriptor && plainJson(descriptor.value, seen));
  seen.delete(value); return valid;
}
function fail(code, message) { const error = Error(message); error.code = code; throw error; }

/** finish(status, details) owns the only durable terminal and may downgrade it. */
export async function runBuildPhases({phases, isCancelled = () => false, onEvent = () => {}, beforePhase = () => {}, finish}) {
  if (!Array.isArray(phases) || !phases.length || phases.some(phase => !phase || typeof phase.name !== 'string' || !phase.name.trim() || typeof phase.run !== 'function') || new Set(phases.map(phase => phase.name)).size !== phases.length || [isCancelled, onEvent, beforePhase, finish].some(fn => typeof fn !== 'function')) fail('BUILD_PHASE_CONFIG_INVALID', 'named phases and lifecycle callbacks required');
  const records = [], eventErrors = [];
  let primary = null;
  const checkCancellation = async () => {
    const cancelled = await isCancelled();
    if (typeof cancelled !== 'boolean') fail('BUILD_CANCEL_CHECK_INVALID', 'cancellation check must return boolean');
    if (cancelled) fail('TASK_CANCELLED', 'build cancellation requested');
  };
  // Snapshot the phase sequence; callbacks cannot add another phase while running.
  const sequence = phases.map(({name, run}) => ({name, run}));
  for (const [index, phase] of sequence.entries()) {
    const started = performance.now(), record = {name:phase.name, status:'running', wallMs:0};
    records.push(record);
    let eventFailed = false;
    const elapsed = () => Math.round((performance.now() - started) * 1000) / 1000;
    const emit = async status => {
      try { await onEvent({stage:phase.name, status, details:{wallMs:record.wallMs, ...(record.error ? {error:record.error} : {})}}); }
      catch (error) { eventFailed = true; throw error; }
    };
    try {
      await checkCancellation();
      await beforePhase(phase.name, index);
      await checkCancellation();
      await emit('RUNNING');
      await checkCancellation();
      const result = await phase.run();
      if (!plainJson(result)) fail('BUILD_PHASE_RESULT_INVALID', 'phase result must be plain JSON');
      record.result = JSON.parse(JSON.stringify(result));
      record.status = 'pass'; record.wallMs = elapsed();
      await emit('PASS');
    } catch (error) {
      primary = errorRecord(error);
      record.status = 'fail'; record.error = primary; record.wallMs = elapsed();
      // A failed error notification must not replace the actual phase failure.
      if (!eventFailed) try { await emit('FAIL'); } catch (eventError) { eventErrors.push(errorRecord(eventError)); }
      break;
    } finally { record.wallMs = elapsed(); }
  }
  // Catch cancellation after the final phase/event. The terminal writer handles
  // the remaining race between this check and its atomic terminal commit.
  if (!primary) try { await checkCancellation(); } catch (error) { primary = errorRecord(error); }
  const requestedStatus = primary ? primary.code === 'TASK_CANCELLED' ? 'CANCELLED' : 'FAILED' : 'SUCCESS';
  const details = {phases:records, ...(primary ? {error:primary} : {}), ...(eventErrors.length ? {eventErrors} : {})};
  const terminal = await finish(requestedStatus, details); // Exactly one call; failure propagates unchanged.
  if (!terminal || !terminals.has(terminal.status)) fail('BUILD_TERMINAL_INVALID', 'finish must return its actual terminal status');
  if (primary && terminal.status === 'SUCCESS') fail('BUILD_TERMINAL_INVALID', 'finish returned success after a failed or cancelled lifecycle');
  return {status:terminal.status, terminal, phases:records}; // No completion event or necessary write follows finish.
}
