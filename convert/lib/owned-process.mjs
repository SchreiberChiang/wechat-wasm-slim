// Observe only this child. Cancellation and observation deadlines never kill it.
import {spawn} from 'node:child_process';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

export async function runOwnedProcess({executable, args = [], cwd, stdoutPath, stderrPath, env,
  isCancellationRequested = () => false, onEvent = () => {}, observeAfterMs,
  spawnImpl = spawn, openLog = open}) {
  const started = performance.now(), errors = [], logErrors = [], eventTasks = [];
  let pid, exitCode = null, signal = null, cancelRequested = false, observationTimedOut = false, cancellationCheckFailed = false;
  const message = error => error instanceof Error ? error.message : String(error);
  function emit(type, details = {}) {
    try {
      const result = onEvent({type, pid, elapsedMs: performance.now() - started, ...details});
      if (result && typeof result.then === 'function') eventTasks.push(Promise.resolve(result).catch(e => errors.push('onEvent: ' + message(e))));
    } catch (e) { errors.push('onEvent: ' + message(e)); }
  }
  function checkCancellation() {
    if (cancelRequested || cancellationCheckFailed) return;
    try {
      if (isCancellationRequested()) { cancelRequested = true; emit('cancellation_requested'); }
    } catch (e) { cancellationCheckFailed = true; errors.push('isCancellationRequested: ' + message(e)); }
  }
  function logError(channel, operation, error) {
    const entry = {channel, operation, error: message(error)};
    logErrors.push(entry); emit('log_error', entry);
  }
  async function finishLog(handle, channel) {
    if (!handle) return;
    try { await handle.sync(); } catch (e) { logError(channel, 'fsync', e); }
    try { await handle.close(); } catch (e) { logError(channel, 'close', e); }
  }
  async function drain(stream, handle, channel) {
    let writable = true;
    try {
      for await (const chunk of stream) {
        if (!writable) continue; // A broken log must not block the child pipe.
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        try {
          let offset = 0;
          while (offset < bytes.length) {
            const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset, null);
            if (!(bytesWritten > 0)) throw Error('log write made no progress');
            offset += bytesWritten;
          }
        } catch (e) { writable = false; logError(channel, 'write', e); }
      }
    } catch (e) { errors.push(channel + ' pipe: ' + message(e)); }
    await finishLog(handle, channel);
  }
  async function result() {
    // Rejected asynchronous event observers are observed before reporting success.
    await Promise.all(eventTasks);
    const infrastructureFailed = errors.length > 0 || logErrors.length > 0;
    const outcome = infrastructureFailed ? 'FAILED' : cancelRequested ? 'CANCELLED' : exitCode === 0 && signal === null ? 'SUCCESS' : 'FAILED';
    const error = [...errors, ...logErrors.map(e => `${e.channel} ${e.operation}: ${e.error}`)];
    if (outcome === 'FAILED' && !error.length) error.push(`child closed with code ${exitCode}, signal ${signal}`);
    return {status: exitCode, outcome, ...(error.length ? {error: error.join('; ')} : {}), cancelRequested,
      observationTimedOut, pid, closed: true, elapsedMs: performance.now() - started, logErrors, exitCode, signal};
  }
  let stdoutLog, stderrLog, childEnv;
  try {
    if (!path.isAbsolute(executable ?? '') || /\.(?:cmd|bat)$/i.test(executable)) throw Error('absolute direct executable required; shell scripts are not accepted');
    if (!Array.isArray(args) || args.some(x => typeof x !== 'string')) throw Error('args must be a string array');
    args = [...args];
    // A supplied env is the complete child environment, snapshotted before any await.
    const environment = env === undefined ? process.env : env;
    if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) throw Error('env must be an object with string values');
    const entries = Object.entries(environment);
    if (entries.some(([, value]) => typeof value !== 'string')) throw Error('env values must be strings');
    childEnv = {...Object.fromEntries(entries), NODE_TLS_REJECT_UNAUTHORIZED: '1'};
    for (const value of [cwd, stdoutPath, stderrPath]) if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('absolute cwd and log paths required');
    if (stdoutPath === stderrPath) throw Error('stdout and stderr logs must differ');
    if (observeAfterMs !== undefined && (!Number.isFinite(observeAfterMs) || observeAfterMs < 0 || observeAfterMs > 2147483647)) throw Error('invalid observation deadline');
    checkCancellation();
    if (cancelRequested || errors.length) return await result();
    try { stdoutLog = await openLog(stdoutPath, 'wx'); } catch (e) { logError('stdout', 'open', e); throw e; }
    try { stderrLog = await openLog(stderrPath, 'wx'); } catch (e) { logError('stderr', 'open', e); throw e; }
  } catch (e) {
    errors.push('prepare: ' + message(e));
    await Promise.all([finishLog(stdoutLog, 'stdout'), finishLog(stderrLog, 'stderr')]);
    return result();
  }
  checkCancellation();
  if (cancelRequested || errors.length) {
    await Promise.all([finishLog(stdoutLog, 'stdout'), finishLog(stderrLog, 'stderr')]);
    return result();
  }
  let child;
  try { child = spawnImpl(executable, args, {cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv}); }
  catch (e) {
    errors.push('spawn: ' + message(e)); emit('spawn_error', {error: message(e)});
    await Promise.all([finishLog(stdoutLog, 'stdout'), finishLog(stderrLog, 'stderr')]);
    return result();
  }
  pid = child.pid;
  const closed = new Promise(resolve => {
    child.on('error', e => { errors.push('child: ' + message(e)); emit('process_error', {error: message(e)}); });
    child.on('exit', (code, childSignal) => emit('exit', {exitCode: code, signal: childSignal}));
    child.once('close', (code, childSignal) => {
      exitCode = code; signal = childSignal;
      emit('close', {exitCode, signal}); resolve();
    });
  });
  const drains = [drain(child.stdout, stdoutLog, 'stdout'), drain(child.stderr, stderrLog, 'stderr')];
  emit('started', {executable, args: [...args], cwd});
  const cancellationTimer = setInterval(checkCancellation, 25);
  const observationTimer = observeAfterMs === undefined ? null : setTimeout(() => {
    observationTimedOut = true; emit('observation_timeout');
  }, observeAfterMs);
  try {
    await closed;
    // This deadline observes child lifetime, not disk flushing after child close.
    if (observationTimer !== null) clearTimeout(observationTimer);
    await Promise.all(drains); checkCancellation();
  }
  finally { clearInterval(cancellationTimer); if (observationTimer !== null) clearTimeout(observationTimer); }
  return result();
}
