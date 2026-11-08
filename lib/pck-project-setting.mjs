// 在导出的 PCK 里改一个工程设置，不动游戏工程里的 project.godot。
// 目前只用于「跳过默认 3D 预热」：把 startup/gles3/skip_default_3d_prewarm=true 写进 PCK 里的 project.binary。
// 只认 Godot 4 的二进制工程设置（ECFG：u32 条数，每条 u32 名长 + 名字 + u32 值长 + Variant 编码）。
// 其余文件按原字节、原顺序重新排成规范布局（与拆包写出的布局相同：文件区从 128 开始，32 字节对齐，目录在最后）。
import {createHash} from 'node:crypto';
import {inspectPck} from './pck-inventory.mjs';

export const SKIP_PREWARM_SETTING = 'startup/gles3/skip_default_3d_prewarm';
const need = (ok, code, message) => { if (!ok) throw Object.assign(Error(message ?? code), {code}); };
const align32 = n => Math.ceil(n / 32) * 32;
const VARIANT_BOOL = 1;

export function readProjectBinary(bytes) {
  need(bytes.length >= 8 && bytes.subarray(0, 4).toString('latin1') === 'ECFG', 'PCK_SETTING_FORMAT', 'project.binary 不是 Godot 4 的二进制工程设置');
  const count = bytes.readUInt32LE(4), rows = [];
  let cursor = 8;
  for (let i = 0; i < count; i++) {
    need(cursor + 4 <= bytes.length, 'PCK_SETTING_FORMAT');
    const nameLength = bytes.readUInt32LE(cursor); cursor += 4;
    need(cursor + nameLength + 4 <= bytes.length, 'PCK_SETTING_FORMAT');
    const name = bytes.toString('utf8', cursor, cursor + nameLength); cursor += nameLength;
    const valueLength = bytes.readUInt32LE(cursor); cursor += 4;
    need(cursor + valueLength <= bytes.length, 'PCK_SETTING_FORMAT');
    rows.push({name, value: bytes.subarray(cursor, cursor + valueLength)}); cursor += valueLength;
  }
  need(cursor === bytes.length, 'PCK_SETTING_FORMAT', 'project.binary 末尾有无法识别的内容');
  need(new Set(rows.map(r => r.name)).size === rows.length, 'PCK_SETTING_FORMAT', 'project.binary 里有重复的设置');
  return rows;
}

export function writeProjectBinary(rows) {
  const parts = [Buffer.from('ECFG', 'latin1'), u32(rows.length)];
  for (const {name, value} of rows) { const n = Buffer.from(name, 'utf8'); parts.push(u32(n.length), n, u32(value.length), value); }
  return Buffer.concat(parts);
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
export function boolVariant(value) { const b = Buffer.alloc(8); b.writeUInt32LE(VARIANT_BOOL, 0); b.writeUInt32LE(value ? 1 : 0, 4); return b; }

/** 返回改好设置的新 PCK（Buffer）。设置已经是这个值时原样返回 changed:false。 */
export function setPckBoolSetting(pck, name, value) {
  const inventory = inspectPck(pck);
  const project = inventory.entries.find(e => e.path === 'project.binary');
  need(project, 'PCK_SETTING_NO_PROJECT', 'PCK 里没有 project.binary，不是完整导出的游戏资源');
  const rows = readProjectBinary(pck.subarray(project.offset, project.offset + project.bytes));
  const encoded = boolVariant(value), at = rows.findIndex(r => r.name === name);
  if (at >= 0 && rows[at].value.equals(encoded)) return {pck, changed: false};
  if (at >= 0) rows[at] = {name, value: encoded}; else rows.push({name, value: encoded});
  const replaced = writeProjectBinary(rows);
  const files = inventory.entries.map(e => ({path: e.path, name: Buffer.from(e.path), payload: e.path === 'project.binary' ? replaced : pck.subarray(e.offset, e.offset + e.bytes)}));
  let cursor = 128;
  for (const file of files) { file.offset = cursor; cursor = align32(cursor + file.payload.length); }
  const directoryOffset = cursor;
  const bytes = directoryOffset + 4 + files.reduce((sum, f) => sum + 4 + Math.ceil(f.name.length / 4) * 4 + 36, 0);
  const out = Buffer.alloc(bytes);
  out.write('GDPC', 0, 'latin1'); out.writeUInt32LE(4, 4);
  out.writeUInt32LE(inventory.engineVersion.major, 8); out.writeUInt32LE(inventory.engineVersion.minor, 12); out.writeUInt32LE(inventory.engineVersion.patch, 16);
  out.writeUInt32LE(2, 20); out.writeBigUInt64LE(128n, 24); out.writeBigUInt64LE(BigInt(directoryOffset), 32);
  out.writeUInt32LE(files.length, directoryOffset);
  let dir = directoryOffset + 4;
  for (const f of files) {
    f.payload.copy(out, f.offset);
    const padded = Math.ceil(f.name.length / 4) * 4;
    out.writeUInt32LE(padded, dir); dir += 4; f.name.copy(out, dir); dir += padded;
    out.writeBigUInt64LE(BigInt(f.offset - 128), dir); out.writeBigUInt64LE(BigInt(f.payload.length), dir + 8);
    createHash('md5').update(f.payload).digest().copy(out, dir + 16); out.writeUInt32LE(0, dir + 32); dir += 36;
  }
  inspectPck(out); // 写出的 PCK 再按同一套规则读一遍
  return {pck: out, changed: true};
}

/** 读 PCK 里某个布尔设置；没有这条设置时返回 null。 */
export function readPckBoolSetting(pck, name) {
  const inventory = inspectPck(pck), project = inventory.entries.find(e => e.path === 'project.binary');
  if (!project) return null;
  const row = readProjectBinary(pck.subarray(project.offset, project.offset + project.bytes)).find(r => r.name === name);
  if (!row) return null;
  need(row.value.length === 8 && row.value.readUInt32LE(0) === VARIANT_BOOL, 'PCK_SETTING_TYPE', name + ' 不是布尔值');
  return row.value.readUInt32LE(4) === 1;
}
