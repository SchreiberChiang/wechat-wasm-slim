'use strict';
function validate(event) {
  if (!event || event.schema !== 1) throw new Error('invalid schema');
  for (const key of ['build', 'session', 'batchId']) {
    if (typeof event[key] !== 'string' || !/^[a-zA-Z0-9._-]{1,96}$/.test(event[key])) {
      throw new Error('invalid ' + key);
    }
  }
  if (!Number.isSafeInteger(event.dropped) || event.dropped < 0) throw new Error('invalid dropped');
  if (!Array.isArray(event.entries) || event.entries.length < 1 || event.entries.length > 24) {
    throw new Error('invalid batch size');
  }
  let last = 0;
  const entries = event.entries.map(entry => {
    if (!entry || !Number.isSafeInteger(entry.seq) || entry.seq <= last ||
        !Number.isSafeInteger(entry.at) || entry.at < 0 ||
        !['log', 'info', 'warn', 'error', 'debug'].includes(entry.level) ||
        typeof entry.message !== 'string' || entry.message.length > 4096) throw new Error('invalid entry');
    last = entry.seq;
    return { seq: entry.seq, at: entry.at, level: entry.level, message: entry.message };
  });
  if (event.batchId !== entries[0].seq + '-' + entries[entries.length - 1].seq) throw new Error('invalid batch id');
  const device = {};
  for (const key of ['platform', 'system', 'model', 'SDKVersion']) {
    const value = event.device && event.device[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 128)) throw new Error('invalid device');
    device[key] = value || '';
  }
  const data = { schema: 1, build: event.build, session: event.session, device,
    batchId: event.batchId, dropped: event.dropped, entries };
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 300000) throw new Error('batch too large');
  return data;
}
module.exports = { validate };
