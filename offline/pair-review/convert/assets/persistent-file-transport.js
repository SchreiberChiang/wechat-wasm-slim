/* Owned ES2016 file transport preparation. Not installed in any runtime.
 * Explicit injected WeChat FileSystemManager; no mount, global wx, timers,
 * directory creation, retries, rollback, cloud logging or FS cache.
 * Native call return and observed readback are not reboot/power-loss proof.
 */
(function () { 'use strict';
function createPersistentFileTransport(options) {
  const fs = options && options.fileSystem;
  const root = options && options.rootPath;
  const limit = options && options.maxBytes;
  const internalErrors = new WeakMap();
  function issue(code) { const e = new Error(code); internalErrors.set(e, code); return e; }
  function need(ok, code) { if (!ok) throw issue(code); }
  need(fs && typeof fs === 'object', 'SAVE_FS_REQUIRED');
  need(typeof root === 'string' && root.length <= 2048 && /^(?:[a-z][a-z0-9+.-]*:\/\/|\/).+/i.test(root)
    && !/[\\\x00-\x1f\x7f?#%]/.test(root) && !root.endsWith('/')
    && !root.split('/').some(x => x === '.' || x === '..'), 'SAVE_OWNED_ROOT_REQUIRED');
  need(Number.isSafeInteger(limit) && limit > 0 && limit <= 16 * 1024 * 1024, 'SAVE_LIMIT_REQUIRED');
  const methods = {};
  for (const name of ['statSync', 'readFileSync', 'writeFileSync', 'renameSync']) {
    need(typeof fs[name] === 'function', 'SAVE_METHOD_REQUIRED');
    methods[name] = fs[name];
  }
  const arrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
  let serial = 0, busy = false;
  function localPath(value) {
    need(typeof value === 'string' && value.length > 0 && value.length <= 1024
      && !/[\\:\x00-\x1f\x7f?#%]/.test(value), 'SAVE_RELATIVE_PATH_REQUIRED');
    need(value.split('/').every(x => x.length > 0 && x !== '.' && x !== '..'), 'SAVE_RELATIVE_PATH_REQUIRED');
    return root + '/' + value;
  }
  function bytes(value, allowView) {
    let buffer = value, offset = 0, length;
    if (allowView && ArrayBuffer.isView(value)) {
      buffer = value.buffer; offset = value.byteOffset; length = value.byteLength;
    }
    try { const total = arrayLength.call(buffer); if (length === undefined) length = total; }
    catch (_) { throw issue('SAVE_ARRAYBUFFER_REQUIRED'); }
    need(length <= limit, 'SAVE_FILE_TOO_LARGE');
    // This also rejects detached buffers. SharedArrayBuffer was rejected above.
    return new Uint8Array(new Uint8Array(buffer, offset, length));
  }
  function nativeCode(error) {
    try {
      if (!error) return null;
      const number = error.errCode;
      if (Number.isSafeInteger(number)) return number;
      const code = error.code;
      if (typeof code === 'string' && /^(?:EIO|ENOENT|EACCES|EPERM|ENOSPC|EEXIST|EINVAL)$/.test(code)) return code;
    } catch (_) { /* Preserve original cause separately; do not interpret getters. */ }
    return null;
  }
  function run(operation, action) {
    need(serial < Number.MAX_SAFE_INTEGER, 'SAVE_SEQUENCE_EXHAUSTED');
    const report = {schema: 'wxslim-persistent-file-transport-v1', sequence: ++serial, operation,
      stage: 'VALIDATE', status: 'FAILED', expectedBytes: null, actualBytes: null,
      platformMutationReturned: false, mayHaveMutated: false, readbackMatches: null,
      fileState: 'UNKNOWN', restartRecovery: 'NOT_TESTED', atomicity: 'NOT_PROVEN'};
    let ownsLock = false;
    try {
      need(!busy, 'SAVE_OPERATION_BUSY'); busy = true; ownsLock = true;
      action(report); report.stage = 'COMPLETE'; report.status = 'SUCCESS';
    } catch (cause) {
      const code = internalErrors.get(cause) || 'SAVE_NATIVE_CALL_FAILED';
      report.error = {code, nativeCode: nativeCode(cause)};
      // Keep raw errors available for local diagnostics, never serialize paths or payloads.
      Object.defineProperty(report, 'cause', {value: cause, enumerable: false});
    } finally { if (ownsLock) busy = false; }
    return Object.freeze(report);
  }
  function call(report, stage, name, args, mutation) {
    report.stage = stage;
    if (mutation) report.mayHaveMutated = true;
    const result = methods[name].apply(fs, args);
    // Sync API signatures must not silently become promises.
    need(!result || typeof result.then !== 'function', 'SAVE_SYNC_RESULT_REQUIRED');
    if (mutation) report.platformMutationReturned = true;
    return result;
  }
  function size(report, stage, file) {
    const stat = call(report, stage, 'statSync', [file, false], false);
    need(stat && !Array.isArray(stat), 'SAVE_REGULAR_FILE_REQUIRED');
    const isFile = stat.isFile;
    need(typeof isFile === 'function' && isFile.call(stat) === true, 'SAVE_REGULAR_FILE_REQUIRED');
    const length = stat.size;
    need(Number.isSafeInteger(length) && length >= 0 && length <= limit, 'SAVE_FILE_SIZE_INVALID');
    return length;
  }
  function read(report, prefix, file) {
    const length = size(report, prefix + '_STAT', file);
    // Positive length is bounded by the previously observed file size. For empty
    // files the documented API has no valid explicit zero length, so omit it.
    // Root must have one writer. Stat/read is not a filesystem snapshot lock.
    const args = length ? [file, undefined, 0, length] : [file];
    const value = bytes(call(report, prefix + '_READ', 'readFileSync', args, false), false);
    report.actualBytes = value.byteLength;
    need(value.byteLength === length, 'SAVE_READ_LENGTH_CHANGED');
    need(size(report, prefix + '_RESTAT', file) === length, 'SAVE_FILE_CHANGED_DURING_READ');
    return value;
  }
  function equal(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function verify(report, file, expected) {
    const actual = read(report, 'READBACK', file);
    report.readbackMatches = equal(actual, expected);
    report.fileState = report.readbackMatches ? 'READBACK_MATCHED' : 'READBACK_MISMATCH';
    need(report.readbackMatches, 'SAVE_READBACK_MISMATCH');
  }
  return Object.freeze({
    replaceFile: function (relativePath, input) {
      return run('REPLACE_FILE', function (report) {
        const file = localPath(relativePath), expected = bytes(input, true);
        report.expectedBytes = expected.byteLength;
        // Separate copy prevents the native receiver mutating our comparison basis.
        call(report, 'WRITE', 'writeFileSync', [file, new Uint8Array(expected).buffer], true);
        verify(report, file, expected);
      });
    },
    renameFile: function (oldRelativePath, newRelativePath, policy) {
      return run('RENAME_FILE', function (report) {
        const oldFile = localPath(oldRelativePath), newFile = localPath(newRelativePath);
        need(oldFile !== newFile, 'SAVE_RENAME_SAME_PATH');
        // Existing destination may be replaced if the platform permits it. Never
        // unlink it to force success. This is NOT a no-clobber/atomic rename API.
        need(policy === 'ALLOW_DESTINATION_REPLACEMENT', 'SAVE_RENAME_POLICY_REQUIRED');
        const expected = read(report, 'SOURCE', oldFile); report.expectedBytes = expected.byteLength;
        report.actualBytes = null;
        call(report, 'RENAME', 'renameSync', [oldFile, newFile], true);
        verify(report, newFile, expected);
      });
    },
    readFile: function (relativePath) {
      return run('READ_FILE', function (report) {
        const file = localPath(relativePath), value = read(report, 'FILE', file);
        report.fileState = 'READ_OBSERVED';
        // Caller explicitly requested data; omit it from automatic JSON logs.
        Object.defineProperty(report, 'data', {value, enumerable: false});
      });
    }
  });
}
if (typeof module === 'object' && module.exports) module.exports = createPersistentFileTransport;
}());
