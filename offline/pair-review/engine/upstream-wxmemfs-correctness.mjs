// Source-only, in-memory preparation. Never writes/applies/executes upstream JS.
// Upstream: godothub/godot-minigame, 099277108e30c0af92bcbbbe7171fa073ae37606.
// MIT, Copyright (c) 2026 GodotHub contributors. Retain upstream LICENSE on reuse:
// https://github.com/godothub/godot-minigame/blob/099277108e30c0af92bcbbbe7171fa073ae37606/LICENSE
// This small patch is not a complete copy or a license clearance for other components.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';

const target = 'platform/web/js/libs/library_godot_memfs.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = bytes => ({bytes: bytes.length, sha256: hash(bytes)});
export const upstreamWxmemfsPins = Object.freeze({
  base: Object.freeze({bytes: 30148, sha256: 'a96d4cde41cf91a83a77cb4eb6f23d40e3231f3c4d1a84465198a5e128c77d95'}),
  patch: Object.freeze({bytes: 6166, sha256: '5fdb4725dc430839bc76166817a5aae60188dafb6b4f12b008fef3bf42fa2d4c'}),
  derived: Object.freeze({bytes: 31968, sha256: 'b723024801e55c410eeb8ce53536b4db3b0f800856f9fa6020b6d63614383fa8'}),
});
function readRegular(file) {
  assert(typeof file === 'string' && path.isAbsolute(file), 'WXMEMFS_EXPLICIT_ABSOLUTE_FILE');
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'WXMEMFS_REGULAR_SOURCE');
  assert.equal(fs.realpathSync(file).toLowerCase(), path.resolve(file).toLowerCase(), 'WXMEMFS_REAL_SOURCE_PATH');
  return fs.readFileSync(file);
}
function parser() {
  const own = {exports: {}};
  // Trusted Node parser only; never evaluate the target to inspect it.
  vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], {module: own, exports: own.exports});
  return own.exports;
}
function methodRanges(source, parse) {
  const ast = parse(source, {ecmaVersion: 2022}), found = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id.name === 'WXMEMFS') found.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(ast); assert.equal(found.length, 1, 'WXMEMFS_UNIQUE_OBJECT');
  const object = found[0].init; assert.equal(object.type, 'ObjectExpression');
  const select = (obj, name) => {
    const matches = obj.properties.filter(p => (p.key.name ?? p.key.value) === name);
    assert.equal(matches.length, 1, 'WXMEMFS_UNIQUE_METHOD_' + name); return matches[0].value;
  };
  const output = [];
  for (const [parent, name] of [[null,'persistNode'],['node_ops','setattr'],['stream_ops','open'],['stream_ops','close']]) {
    const fn = select(parent ? select(object, parent) : object, name);
    assert.equal(fn.type, 'FunctionExpression'); output.push({name: parent ? parent + '.' + name : name, start: fn.start, end: fn.end});
  }
  return output.sort((a,b) => a.start-b.start);
}
function mask(source, ranges) {
  let out = '', offset = 0;
  for (const range of ranges) { out += source.slice(offset,range.start) + '/* FIXED_METHOD:' + range.name + ' */'; offset = range.end; }
  return out + source.slice(offset);
}

// Public pure-buffer entry permits rejection tests without changing any file.
export function replayUpstreamWxmemfs({sourceBytes, patchBytes} = {}) {
  assert(Buffer.isBuffer(sourceBytes) && Buffer.isBuffer(patchBytes), 'WXMEMFS_BUFFERS');
  assert.deepEqual(pin(sourceBytes), upstreamWxmemfsPins.base, 'WXMEMFS_BASE_PIN');
  assert.deepEqual(pin(patchBytes), upstreamWxmemfsPins.patch, 'WXMEMFS_PATCH_PIN');
  const text = sourceBytes.toString('utf8'); assert(Buffer.from(text).equals(sourceBytes), 'WXMEMFS_UTF8');
  const normalized = text.replaceAll('\r\n','\n');
  const files = replayUnifiedPatch(patchBytes, name => { assert.equal(name,target,'WXMEMFS_PATCH_TARGET'); return sourceBytes; });
  assert.deepEqual([...files.keys()],[target]);
  const source = files.get(target).text, derived = Buffer.from(source);
  assert.deepEqual(pin(derived), upstreamWxmemfsPins.derived, 'WXMEMFS_DERIVED_PIN');
  const parse = parser().parse, before = methodRanges(normalized, parse), after = methodRanges(source, parse);
  assert.deepEqual(before.map(x=>x.name),after.map(x=>x.name));
  assert.equal(mask(normalized,before),mask(source,after),'WXMEMFS_OUTSIDE_FOUR_METHODS_CHANGED');
  new vm.Script(source, {filename:'upstream-wxmemfs-correctness-source.js'}); // Parse only.
  return {source, receipt: {
    schema:'upstream-wxmemfs-correctness-source-v1', status:'SOURCE_ONLY_UNAPPLIED',
    upstream:{repository:'godothub/godot-minigame',commit:'099277108e30c0af92bcbbbe7171fa073ae37606',
      path:'skills/sources/godot-4.6.2-rc-a16e481cf4/platform/web/js/libs/library_godot_fs.js',
      url:'https://github.com/godothub/godot-minigame/blob/099277108e30c0af92bcbbbe7171fa073ae37606/skills/sources/godot-4.6.2-rc-a16e481cf4/platform/web/js/libs/library_godot_fs.js',
      license:'MIT',copyright:'Copyright (c) 2026 GodotHub contributors',
      licenseURL:'https://github.com/godothub/godot-minigame/blob/099277108e30c0af92bcbbbe7171fa073ae37606/LICENSE',
      distributionRequirement:'Retain upstream copyright and MIT license; no clearance for unrelated code or binaries.'},
    target, base:pin(sourceBytes), normalizedBase:pin(Buffer.from(normalized)),
    patch:{path:'engine/upstream-wxmemfs-correctness.patch',...pin(patchBytes)}, derived:pin(derived),
    replay:'fixed-source-audit.replayUnifiedPatch; exact context/locations, no fuzz',
    changedMethods:after.map(({name,start,end})=>({name,startUTF16:start,endUTF16:end})), unchangedOutsideMethods:true,
    behavior:['persistNode copies only the logical Uint8Array range, including nonzero byteOffset',
      'zero truncation marks the node and reaches close before or after stream registration without scanning',
      'native close-write failure is FS.ErrnoError(EIO=29), with non-enumerable original cause and finally cleanup',
      'failed last close abandons truncation marker; without retained contents clears lazy-loaded state so next open reads actual native bytes',
      'with remaining refs, shared bytes and pending truncation stay valid; an explicit remaining-stream close may commit, not automatic recovery'],
    sdk:{version:'4.0.10',errno:'cache/sysroot/include/bits/errno.h:7 EIO -> __WASI_ERRNO_IO; wasi/api.h:261 -> 29',
      close:'src/lib/libfs.js:1189-1204 closes FD table in finally; on error stream.fd itself remains stale in this SDK'},
    scope:'No change to mount, path mapping, scanning, mknod, rename, other truncation sizes or browser routing',
    notProven:['readable/obfuscated whole-object equivalence','generated JS/WASM pairing','libc/Godot error propagation at runtime','native wx bytes or restart recovery','failed native write may already have partly changed the file; no rollback or unchanged-old-bytes guarantee','atomicity or durability'],
    productionSourceMutated:false, buildRun:false, targetCodeExecutedByPreparer:false, platformApiCalled:false,
  }};
}
export function prepareUpstreamWxmemfs({sourcePath, patchPath = fileURLToPath(new URL('./upstream-wxmemfs-correctness.patch',import.meta.url))} = {}) {
  return replayUpstreamWxmemfs({sourceBytes:readRegular(sourcePath),patchBytes:readRegular(patchPath)});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert(process.argv.length===3,'Usage: node upstream-wxmemfs-correctness.mjs ABSOLUTE_EXISTING_READABLE_SOURCE');
    console.log(JSON.stringify(prepareUpstreamWxmemfs({sourcePath:process.argv[2]}).receipt,null,2));
  } catch (_) { console.error(JSON.stringify({status:'REJECTED_SOURCE_ONLY',code:'WXMEMFS_PREPARATION_REJECTED'})); process.exitCode=1; }
}
