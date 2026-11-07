// Pure inspection of the initial supported PCK subset, not the engine's full format support.
// Fixed df3cdd9: core/io/file_access_pack.{h,cpp}; core/io/pck_packer.cpp:94-125,243-268.
// Accept standalone v4, pack flags 0/REL_FILEBASE(2), ordinary file flags 0,
// a canonical writer header (40 field bytes + 64 zero reserved bytes), and
// root-relative paths without res://. Entries.offset is the absolute PCK byte offset.
// No extraction, script execution, mounting, resource dependency or runtime acceptance.
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';

const HEADER_BYTES = 104;
const MAX_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const messages = Object.freeze({
  PCK_INPUT: 'PCK input must be a Buffer.',
  PCK_HEADER: 'PCK header is incomplete.',
  PCK_MAGIC: 'Standalone PCK magic is required by this tool.',
  PCK_VERSION: 'Only PCK format 4 is supported by this tool.',
  PCK_PACK_FLAGS: 'Encrypted, bundle or unknown package flags are outside this tool scope.',
  PCK_RESERVED: 'Canonical zero reserved header fields are required by this tool.',
  PCK_INTEGER: 'PCK offset or size exceeds safe integer limits.',
  PCK_BOUNDS: 'PCK field or payload exceeds input bounds.',
  PCK_LAYOUT: 'PCK header, directory and payload regions conflict.',
  PCK_DIRECTORY: 'PCK directory count or layout is invalid.',
  PCK_PADDING: 'PCK path length or zero padding is invalid.',
  PCK_UTF8: 'PCK path is not valid UTF-8.',
  PCK_PATH: 'Canonical root-relative PCK paths are required by this tool.',
  PCK_DUPLICATE: 'Duplicate PCK resource paths are refused by this tool.',
  PCK_FILE_FLAGS: 'Encrypted, removal, delta or unknown entry flags are outside this tool scope.',
  PCK_OVERLAP: 'Overlapping nonempty PCK payloads are refused by this tool.',
  PCK_MD5: 'PCK payload does not match its directory MD5.',
});
function requirePck(condition, code) {
  if (!condition) throw Object.assign(new Error(messages[code]), {code});
}
const hash = (kind, bytes) => createHash(kind).update(bytes).digest('hex');

export function inspectPck(buffer) {
  requirePck(Buffer.isBuffer(buffer), 'PCK_INPUT');
  requirePck(buffer.length >= HEADER_BYTES, 'PCK_HEADER');
  requirePck(buffer.readUInt32LE(0) === 0x43504447, 'PCK_MAGIC');
  const formatVersion = buffer.readUInt32LE(4);
  requirePck(formatVersion === 4, 'PCK_VERSION');
  const engineVersion = {major:buffer.readUInt32LE(8), minor:buffer.readUInt32LE(12), patch:buffer.readUInt32LE(16)};
  const packFlags = buffer.readUInt32LE(20);
  requirePck(packFlags === 0 || packFlags === 2, 'PCK_PACK_FLAGS');
  requirePck(buffer.subarray(40, HEADER_BYTES).every(byte => byte === 0), 'PCK_RESERVED');
  function range(start, length) {
    requirePck(Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length >= 0, 'PCK_INTEGER');
    requirePck(start <= Number.MAX_SAFE_INTEGER - length, 'PCK_INTEGER');
    requirePck(start <= buffer.length && length <= buffer.length - start, 'PCK_BOUNDS');
  }
  function u64(at) {
    range(at, 8);
    const value = buffer.readBigUInt64LE(at);
    requirePck(value <= MAX_INTEGER, 'PCK_INTEGER');
    return Number(value);
  }
  const fileBase = u64(24), directoryOffset = u64(32);
  requirePck(fileBase >= HEADER_BYTES && directoryOffset >= HEADER_BYTES, 'PCK_LAYOUT');
  range(fileBase, 0); range(directoryOffset, 4);
  const count = buffer.readUInt32LE(directoryOffset);
  // Shortest supported row is 4-byte length + 4-byte path + 36-byte metadata.
  requirePck(count <= Math.floor((buffer.length - directoryOffset - 4) / 44), 'PCK_DIRECTORY');
  let cursor = directoryOffset + 4;
  const entries = [], seen = new Set(), decoder = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
  for (let i = 0; i < count; i++) {
    range(cursor, 4);
    const nameLength = buffer.readUInt32LE(cursor); cursor += 4;
    requirePck(nameLength > 0 && nameLength % 4 === 0, 'PCK_PADDING');
    range(cursor, nameLength);
    const padded = buffer.subarray(cursor, cursor + nameLength); cursor += nameLength;
    let rawLength = padded.length;
    while (rawLength > 0 && padded[rawLength - 1] === 0) rawLength--;
    const padding = padded.length - rawLength;
    requirePck(rawLength > 0 && padding <= 3 && padding === (4 - rawLength % 4) % 4, 'PCK_PADDING');
    let name;
    try { name = decoder.decode(padded.subarray(0, rawLength)); }
    catch { requirePck(false, 'PCK_UTF8'); }
    requirePck(name && !/[\\:\u0000-\u001f\u007f-\u009f\ufeff]/u.test(name) &&
      name.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'PCK_PATH');
    requirePck(!seen.has(name), 'PCK_DUPLICATE'); seen.add(name);
    range(cursor, 36);
    const relativeOffset = u64(cursor), bytes = u64(cursor + 8);
    const md5 = buffer.subarray(cursor + 16, cursor + 32).toString('hex');
    const flags = buffer.readUInt32LE(cursor + 32); cursor += 36;
    requirePck(flags === 0, 'PCK_FILE_FLAGS');
    requirePck(relativeOffset <= Number.MAX_SAFE_INTEGER - fileBase, 'PCK_INTEGER');
    const offset = fileBase + relativeOffset;
    range(offset, bytes);
    requirePck(offset >= HEADER_BYTES, 'PCK_LAYOUT');
    entries.push({path:name,offset,bytes,md5});
  }
  const directoryEnd = cursor;
  const nonempty = entries.filter(entry => entry.bytes > 0).sort((a,b) => a.offset - b.offset);
  for (let i = 0; i < nonempty.length; i++) {
    const entry = nonempty[i], end = entry.offset + entry.bytes;
    requirePck(end <= directoryOffset || entry.offset >= directoryEnd, 'PCK_LAYOUT');
    if (i > 0) requirePck(entry.offset >= nonempty[i-1].offset + nonempty[i-1].bytes, 'PCK_OVERLAP');
  }
  for (const entry of entries) {
    const data = buffer.subarray(entry.offset, entry.offset + entry.bytes);
    requirePck(hash('md5', data) === entry.md5, 'PCK_MD5');
    entry.sha256 = hash('sha256', data);
  }
  return {schema:'wxslim-pck-inventory-v1',formatVersion,engineVersion,packFlags,fileBase,directoryOffset,
    entries,bytes:buffer.length,sha256:hash('sha256',buffer),status:'PASS_PCK_STRUCTURE_ONLY'};
}
