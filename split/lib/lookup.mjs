// wasm_split wait id (function-table slot) → function index (element segment of the full WASM) → symbol name.
import fs from 'node:fs';import zlib from 'node:zlib';import path from 'node:path';
export function lookupSlots(project, symbolsFile, ids) {
  const dir = path.join(project, '.plugincache/codesplitv2/backup'), wasm = fs.readdirSync(dir).find(f => f.endsWith('.wasm.br'));
  const b = zlib.brotliDecompressSync(fs.readFileSync(path.join(dir, wasm)));
  let p = 8; const u = () => { let n = 0, k = 0, x; do { x = b[p++]; n += (x & 127) * 2 ** k; k += 7; } while (x & 128); return n; };
  const sleb = () => { let n = 0, k = 0, x; do { x = b[p++]; n |= (x & 127) << k; k += 7; } while (x & 128); if (k < 32 && (x & 64)) n |= -1 << k; return n; };
  const elems = [];
  while (p < b.length) { const id = b[p++], len = u(), end = p + len;
    if (id === 9) { const c = u(); for (let i = 0; i < c; i++) { const flags = u(); if (flags !== 0) throw Error('elem flags ' + flags); if (b[p++] !== 0x41) throw Error('elem offset op'); const off = sleb(); p++; const n = u(), fns = []; for (let j = 0; j < n; j++) fns.push(u()); elems.push({off, fns}); } }
    p = end; }
  const sym = JSON.parse(fs.readFileSync(symbolsFile, 'utf8')), name = f => String(sym[f] ?? '?').replace(/\\([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return ids.map(id => { for (const e of elems) { const i = id - e.off; if (i >= 0 && i < e.fns.length) return `槽位 ${id} → 函数 ${e.fns[i]}：${name(e.fns[i])}`; } return `槽位 ${id}：不在函数表内`; });
}
