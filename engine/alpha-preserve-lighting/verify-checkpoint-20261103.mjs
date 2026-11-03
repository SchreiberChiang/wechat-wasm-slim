// Read-only: no build, WASM instantiation, package rewrite, or source checkout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const cfg = json(path.join(root, 'engine/alpha-preserve-lighting/build-settings-20261103.json'));
const delivery = json(path.join(root, 'docs/evidence/GLX_LIGHTING_DELIVERY_20261103.json'));
const args = process.argv.slice(2), opts = {};
for (let i = 0; i < args.length; i += 2) {
  check(/^--[a-z-]+$/.test(args[i]) && args[i + 1], 'Expected --name PATH pairs');
  check(!Object.hasOwn(opts, args[i].slice(2)), 'Duplicate argument');
  opts[args[i].slice(2)] = path.resolve(args[i + 1]);
}
const keys = ['package', 'parent', 'artifacts', 'source', 'library', 'build-record'];
check(Object.keys(opts).length === keys.length && keys.every(k => opts[k]),
  'Required: --package --parent --artifacts --source --library --build-record');
const hashFile = (file, expected, label) => check(sha(read(file)) === expected, `Hash mismatch: ${label}`);
const lf = bytes => bytes.toString('utf8').replaceAll('\r\n', '\n');

// Exact, non-fuzzy unified-diff replay, entirely in memory. No git apply writes.
const sourceFiles = new Map();
for (const patch of cfg.patches) {
  hashFile(path.join(root, patch.path), patch.sha256, patch.path);
  const sections = lf(read(path.join(root, patch.path))).split(/(?=^diff --git )/m).filter(Boolean);
  for (const section of sections) {
    const lines = section.split('\n');
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[0]);
    check(header && header[1] === header[2], 'Only plain same-path text patches supported');
    const name = header[1];
    check(!name.includes('..'), 'Unsafe patch path');
    if (!sourceFiles.has(name)) {
      const bytes = lines.includes('--- /dev/null') ? Buffer.alloc(0) : execFileSync('git',
        ['-C', opts.source, 'show', `${cfg.source.commit}:${name}`], { windowsHide: true, maxBuffer: 8e6 });
      sourceFiles.set(name, lf(bytes));
    }
    const original = sourceFiles.get(name), oldLines = original ? original.split('\n') : [];
    if (original.endsWith('\n')) oldLines.pop();
    let cursor = 0, output = [];
    for (let i = 1; i < lines.length; i++) {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
      if (!h) continue;
      const start = Number(h[1]) === 0 ? 0 : Number(h[1]) - 1;
      check(start >= cursor && start <= oldLines.length, `Invalid hunk offset: ${name}`);
      output.push(...oldLines.slice(cursor, start)); cursor = start;
      check(output.length === (Number(h[3]) === 0 ? 0 : Number(h[3]) - 1), `New hunk offset mismatch: ${name}`);
      let removed = 0, added = 0;
      while (i + 1 < lines.length && /^[ +\-]/.test(lines[i + 1])) {
        const line = lines[++i], kind = line[0], value = line.slice(1);
        if (kind !== '+') {
          check(oldLines[cursor] === value, `Patch context mismatch: ${patch.path} ${name}:${cursor + 1}`);
          cursor++; removed++;
        }
        if (kind !== '-') { output.push(value); added++; }
      }
      check(removed === Number(h[2] ?? 1) && added === Number(h[4] ?? 1), `Hunk length mismatch: ${name}`);
    }
    output.push(...oldLines.slice(cursor));
    sourceFiles.set(name, output.join('\n') + '\n');
  }
}
for (const [name, expected] of sourceFiles) {
  check(lf(read(path.join(opts.source, name))) === expected, `Patched source mismatch: ${name}`);
}
hashFile(path.join(root, cfg.profile.path), cfg.profile.sha256, 'full profile');
hashFile(path.join(root, 'trim/lib/build.mjs'), cfg.build.entrySha256, 'existing build driver');
hashFile(opts.library, cfg.library.sha256, 'official library');
hashFile(opts['build-record'], cfg.recordSha256, 'original build record');
const build = json(opts['build-record']);
check(build.stage.head === cfg.source.commit && build.identity.lto === cfg.build.lto &&
  build.identity.ltoJobs === cfg.build.ltoJobs, 'Build identity mismatch');
const normalizedArgs = build.sconsArgs.map(s => s.startsWith('build_profile=') ? 'build_profile=<FULL_PROFILE>' :
  s.startsWith('wx_glx_lib=') ? 'wx_glx_lib=<EXACT_026E_LIBRARY>' : s);
check(JSON.stringify(normalizedArgs) === JSON.stringify(cfg.build.sconsArgs), 'Build arguments mismatch');
for (const [name, data] of Object.entries(cfg.rawBuildOutputs)) hashFile(path.join(opts.artifacts, name), data.sha256, name);

const frozenPath = path.join(opts.package, 'CANDIDATE.json');
hashFile(frozenPath, delivery.frozenManifestSha256, 'frozen manifest');
hashFile(path.join(opts.parent, 'CANDIDATE.json'), delivery.parentFrozenManifestSha256, 'parent manifest');
const frozen = json(frozenPath), parent = json(path.join(opts.parent, 'CANDIDATE.json'));
check(frozen.identity.packageId === delivery.packageId && delivery.candidateId === delivery.packageId, 'Candidate identity mismatch');
const changes = [];
check(frozen.fileManifest.length === delivery.frozenPayloadFileCount, 'Payload count mismatch');
check(JSON.stringify(frozen.fileManifest.map(x => x.path).sort()) ===
  JSON.stringify(parent.fileManifest.map(x => x.path).sort()), 'Parent payload set changed');
for (const file of frozen.fileManifest) {
  hashFile(path.join(opts.package, file.path), file.sha256, `frozen payload ${file.path}`);
  const before = parent.fileManifest.find(x => x.path === file.path);
  hashFile(path.join(opts.parent, before.path), before.sha256, `parent payload ${before.path}`);
  if (before.sha256 !== file.sha256) changes.push(file.path);
}
check(JSON.stringify(changes.sort()) === JSON.stringify([...delivery.changedPayloadFiles].sort()), 'Payload change list mismatch');
for (const file of delivery.publicPayloadHashes) hashFile(path.join(opts.package, file.path), file.sha256, file.path);
const br = read(path.join(opts.package, 'engine/godot.wasm.br')), wasm = brotliDecompressSync(br);
check(sha(wasm) === delivery.enginePair.wasm && wasm.equals(read(path.join(opts.artifacts, 'godot.wasm'))), 'Brotli/WASM mismatch');
const rawJs = read(path.join(opts.artifacts, 'godot.js')).toString('utf8');
const original = 'function evalCheckWxContextGlobalIdAvailable(){if(typeof Module!=="undefined"&&Module.wxContextGlobal&&typeof Module.wxContextGlobal.fetchAndIncId==="function"){return 1}return 0}';
const replacement = 'function evalCheckWxContextGlobalIdAvailable(){return 0}';
check(rawJs.split(original).length === 2, 'Expected exactly one original global ID function');
const expectedJs = Buffer.from(rawJs.replace(original, replacement));
check(expectedJs.equals(read(path.join(opts.package, 'engine/godot.js'))), 'Package JS has other changes');
check(sha(expectedJs) === delivery.enginePair.js && sha(br) === delivery.enginePair.br, 'Delivery pair mismatch');
const pair = sha(Buffer.from(JSON.stringify([sha(expectedJs), sha(wasm), sha(br)])));
check(pair === delivery.enginePair.sha256 && pair === frozen.identity.enginePairSha256, 'Pair identity mismatch');
hashFile(path.join(opts.package, 'engine/empty-tips.bin'), delivery.pckSha256, 'PCK');
hashFile(frozenPath, delivery.frozenManifestSha256, 'frozen manifest after verification');
console.log(JSON.stringify({status:'PASS',scope:'read-only bytes and exact patch replay; no runtime proof',
  packageId:delivery.packageId,patches:cfg.patches.length,sourceFiles:sourceFiles.size,
  payloadFiles:frozen.fileManifest.length,parentPayloadFiles:parent.fileManifest.length,
  changedPayloadFiles:changes,pairSha256:pair,packagedJsChange:'only global ID return 0',
  sceneGlslSha256:sha(Buffer.from(sourceFiles.get('drivers/gles3/shaders/scene.glsl')))}, null, 2));
