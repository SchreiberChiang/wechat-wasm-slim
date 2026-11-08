// Looks inside an exported PCK for classes that a trimmed template no longer has.
// Scenes and resources (binary .scn/.res or text .tscn/.tres), scripts in all three
// export modes (text .gd, binary .gdc, compressed .gdc) and project.binary are read.
// It finds class names written in the game's files; it cannot see names built at
// run time from strings, so the author's confirmation stays required.
import zlib from 'node:zlib';
import fs from 'node:fs';
import {inspectPck} from './pck-inventory.mjs';

const TABLE = JSON.parse(fs.readFileSync(new URL('./removed-feature-classes.json', import.meta.url), 'utf8'));
const READ = /\.(scn|res|tscn|tres|gd|gdc|cfg|binary)$/i;
const MAX_FILE = 32 * 1024 * 1024;

export function removedClassTable(template) {
  const entry = TABLE.templates[template];
  return entry ? entry.classes : null;
}

// Binary tokens store identifiers one UTF-32 character at a time, each XOR 0xb6.
function decodeBinaryTokens(bytes) {
  let data = bytes;
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'GDSC' && data.readUInt32LE(8) > 0)
    data = zlib.zstdDecompressSync(data.subarray(12), {maxOutputLength: MAX_FILE});
  const flipped = Buffer.from(data.map(byte => byte ^ 0xb6)).toString('latin1');
  return [data.toString('latin1'), flipped.replace(/([A-Za-z0-9_])\x00\x00\x00/g, '$1')];
}

export function scanRemovedClasses(pckBytes, template) {
  const classes = removedClassTable(template);
  if (!classes) return {template, applies: false, hits: [], unreadable: [], scanned: 0};
  const names = Object.keys(classes).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![A-Za-z0-9_])(${names.join('|')})(?![A-Za-z0-9_])`, 'g');
  const pack = inspectPck(pckBytes);
  const found = new Map(), unreadable = [];
  let scanned = 0;
  for (const entry of pack.entries) {
    if (!READ.test(entry.path) || entry.bytes === 0) continue;
    if (entry.bytes > MAX_FILE) { unreadable.push(entry.path); continue; }
    const bytes = pckBytes.subarray(entry.offset, entry.offset + entry.bytes);
    let texts;
    try {
      if (bytes.subarray(0, 4).toString('latin1') === 'RSCC') { unreadable.push(entry.path); continue; }
      texts = entry.path.endsWith('.gdc') ? decodeBinaryTokens(bytes) : [bytes.toString('latin1')];
    } catch { unreadable.push(entry.path); continue; }
    scanned++;
    for (const text of texts) for (const m of text.matchAll(pattern)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(entry.path);
    }
  }
  const hits = [...found].map(([name, files]) => ({class: name, from: classes[name], files: [...files].sort()}))
    .sort((a, b) => a.class < b.class ? -1 : 1);
  return {template, applies: true, hits, unreadable, scanned};
}

/** 一句话说明命中了哪些类、在哪些文件里，给面板和命令行用。 */
export function describeHits(scan, limit = 6) {
  const label = from => from === 'Godot 3D' ? '3D 功能' : from.replace('module:', '模块 ');
  const lines = scan.hits.slice(0, limit).map(h => `${h.class}（${label(h.from)}，见 ${h.files.slice(0, 2).map(f => f.replace(/^\.godot\/exported\/[^/]+\/export-[0-9a-f]+-/, '')).join('、')}${h.files.length > 2 ? ' 等' : ''}）`);
  if (scan.hits.length > limit) lines.push(`还有 ${scan.hits.length - limit} 个`);
  return lines.join('；');
}
