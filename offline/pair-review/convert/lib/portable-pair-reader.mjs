// Retained receipts fingerprint the original audit implementations and use their
// original absolute paths. Only this one-shot reader presents those names.
// All filesystem operations below use the physical files of the selected copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parentPort, workerData} from 'node:worker_threads';

const {directory, profile} = workerData;
const historical = 'F:\\GLX-OpenSource\\clean-20261104';
const records = {
  conservative: {
    config: 'c050-delivery-acceptance-01/conservative.pair.config.json',
    configSha: '1dfa1b23fc0f6888a0df416a9c7eb11de747a6587b208b6ef6b9cf53388ae47c',
    receipt: 'c050-delivery-acceptance-01/conservative.pair.receipt.json',
    receiptSha: '0a498fb093dbfa9622fd09d475806b255cf7ed4562bcc9f3a30121fee996cf4a',
    roots: ['c050-delivery-acceptance-01/conservative-raw','c050-delivery-acceptance-01/inputs'],
    js: 'c050-delivery-acceptance-01/conservative.prepared.js'
  },
  'pure-2d': {
    config: 'custom-2d-desktop-01/pair.config.json',
    configSha: '3b4cb8ba044e7dc6ea8aec4b3131161e013473604585dc809825322cf8ac1ebb',
    receipt: 'custom-2d-desktop-01/pair.receipt.json',
    receiptSha: 'af14e15cb964635ab608580d43b26493110a1132cf3d477db92d54dc08895027',
    roots: ['official-custom-2d-dev-01','custom-2d-desktop-01'],
    js: 'custom-2d-desktop-01/godot.prepared.js'
  }
};
assert(Object.hasOwn(records,profile));
const record = records[profile];
const real = fs.realpathSync.native.bind(fs);
const read = fs.readFileSync.bind(fs);
assert.equal(path.relative(directory,real(directory)), '');
const allowedFiles = [record.config, record.receipt, record.js, path.dirname(record.config)].map(name=>path.resolve(historical,name));
const allowedTrees = record.roots.map(name=>path.resolve(historical,name));

function within(root, file) {
  const rel = path.relative(root,file);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..'+path.sep);
}
assert(!within(historical,directory) && !within(directory,historical), 'PORTABLE_SEPARATE_DIRECTORY');
function locate(arg) {
  const value = arg instanceof URL ? fileURLToPath(arg) : arg;
  if (typeof value !== 'string' || !path.isAbsolute(value) || !within(historical,value)) return null;
  const logical = path.resolve(value);
  assert(allowedFiles.some(f=>path.relative(f,logical)==='') || allowedTrees.some(f=>within(f,logical)), 'PORTABLE_UNEXPECTED_RECORD_PATH');
  const physical = path.resolve(directory,path.relative(historical,logical));
  assert(within(directory,physical));
  // Check the final path and its ancestors, including directory junctions.
  assert.equal(path.relative(physical,real(physical)), '', 'PORTABLE_LINKED_EVIDENCE');
  return {physical,logical};
}
for (const method of ['readFileSync','lstatSync','statSync','readdirSync','createReadStream','openSync','open']) {
  const original = fs[method];
  fs[method] = function(file,...args) {
    const mapped = locate(file);
    if (mapped && (method === 'open' || method === 'openSync')) {
      assert(args[0] === 'r' || args[0] === fs.constants.O_RDONLY, 'PORTABLE_READ_ONLY');
    }
    return original.call(this,mapped?.physical ?? file,...args);
  };
}
const originalRealpath = fs.realpathSync;
function logicalRealpath(file,...args) {
  return locate(file)?.logical ?? originalRealpath(file,...args);
}
logicalRealpath.native = (file,...args)=>locate(file)?.logical ?? real(file,...args);
fs.realpathSync = logicalRealpath;
syncBuiltinESMExports();

function checkRecordPins() {
  for (const [name,expected] of [[record.config,record.configSha],[record.receipt,record.receiptSha]]) {
    const file = locate(path.resolve(historical,name)).physical;
    assert.equal(createHash('sha256').update(read(file)).digest('hex'), expected, 'PORTABLE_RECORD_DIGEST '+name);
  }
}
checkRecordPins();
const config = path.resolve(historical,record.config);
const pair = profile === 'conservative'
  ? await (await import('../../engine/rebuilt-capability-pair.mjs')).readRebuiltCapabilityPair(config)
  : await (await import('../../lib/custom-pair-task.mjs')).readCompletedCustomPairTask(config);
await pair.recheck();
checkRecordPins();
const {summary,preparation,js,bridge} = pair;
parentPort.postMessage({summary,preparation,js,bridge});
parentPort.on('message',async command=>{
  assert.equal(command,'recheck');
  checkRecordPins();
  await pair.recheck();
  checkRecordPins();
  parentPort.postMessage(true);
});
