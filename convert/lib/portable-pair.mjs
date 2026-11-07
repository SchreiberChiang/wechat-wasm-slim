import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';

export const portablePairSchema = 'wxslim-retained-pair-location-v1';

// One isolated reader owns the original auditor's handle. Retire an idle
// reader; a subsequent checkpoint then starts with a fresh full source audit.
function retainedReader(directory,profile) {
  let worker, timer, pending, first;
  let queue = Promise.resolve();
  function close() {
    clearTimeout(timer);
    const previous = worker;
    worker = undefined;
    if (previous) void previous.terminate();
  }
  function start() {
    const child = new Worker(new URL('./portable-pair-reader.mjs',import.meta.url),{workerData:{directory,profile}});
    worker = child;
    function failed(error) {
      if (child !== worker) return;
      close();
      pending?.reject(error);
      pending = undefined;
    }
    child.on('error',failed);
    child.on('exit',code=>failed(new Error('Portable reader exited before its next checkpoint: '+code)));
    child.on('message',result=>{
      if (!pending || child !== worker) return;
      try {
        if (result !== true) {
          if (first) assert.deepEqual(result,first,'PORTABLE_SOURCE_CHANGED');
          else first = result;
        }
        assert(first,'PORTABLE_READER_INCOMPLETE');
        pending.resolve(first);
      } catch (error) { failed(error); return; }
      pending = undefined;
      child.unref();
      timer = setTimeout(close,30000);
      timer.unref();
    });
  }
  function check() {
    const run = queue.then(()=>new Promise((resolve,reject)=>{
      clearTimeout(timer);
      pending = {resolve,reject};
      if (!worker) start();
      else { worker.ref(); worker.postMessage('recheck'); }
    }));
    queue = run.catch(()=>{});
    return run;
  }
  return {check,close};
}

export async function readPortablePair(file) {
  const bytes = fs.readFileSync(file);
  const cfg = JSON.parse(bytes);
  assert.deepEqual(Object.keys(cfg).sort(),['profile','schema']);
  assert.equal(cfg.schema,portablePairSchema);
  assert(['conservative','pure-2d'].includes(cfg.profile),'PORTABLE_UNKNOWN_PROFILE');
  const directory = path.dirname(path.resolve(file));
  const reader = retainedReader(directory,cfg.profile);
  async function check() {
    assert.equal(path.relative(path.resolve(file),fs.realpathSync(file)), '', 'PORTABLE_LINKED_CONFIG');
    assert(fs.readFileSync(file).equals(bytes),'PORTABLE_CONFIG_CHANGED');
    return reader.check();
  }
  const first = await check();
  return {...first,js:Buffer.from(first.js),bridge:Buffer.from(first.bridge),protectedRoot:directory,
    preparation:{...first.preparation,configuration:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},
    recheck:async()=>{await check();},close:reader.close};
}
