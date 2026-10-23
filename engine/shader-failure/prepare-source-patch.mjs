// Apply only to a new, clean source clone. Old build/package directories are not inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pin = 'df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--out') throw Error('Usage: --source NEW_CLEAN_SOURCE --out NEW_PATCH_FILE');
const source = path.resolve(args[1]), out = path.resolve(args[3]);
const git = (...a) => execFileSync('git.exe', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-C', source, ...a], {windowsHide: true});
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
if (fs.existsSync(out) || fs.existsSync(out + '.json')) throw Error('Output exists; preserve it and use a new path');
if (git('rev-parse', 'HEAD').toString().trim() !== pin || git('status', '--porcelain').toString().trim()) throw Error('Requires a clean clone at the pinned commit');
if (path.resolve(git('rev-parse', '--show-toplevel').toString().trim()).toLowerCase() !== source.toLowerCase()) throw Error('Source must be its repository root');
const additions = {
  'drivers/gles3/wxslim_shader_failure.h': 'native-header.h',
  'platform/web/js/libs/library_wxslim_shader_failure.js': 'library.js',
  'platform/web/js/patches/wxslim_shader_instrument.cjs': 'instrument-glue.cjs',
};
for (const name of Object.keys(additions)) if (fs.existsSync(path.join(source, name))) throw Error('Diagnostic source already exists: ' + name);
const replacements = [
  ['platform/web/SCsub', '    "js/libs/library_godot_webgl2.js",', '    "js/libs/library_godot_webgl2.js",\n    "js/libs/library_wxslim_shader_failure.js",'],
  ['godot_process.js', 'fs.writeFileSync(GODOT_JS_PATH, content);', '// Upstream commit-frame fixtures run in isolated temporary roots without this candidate library.\n// A real candidate source build contains it and must pass the exact diagnostic anchor gate.\nif (fs.existsSync("./platform/web/js/libs/library_wxslim_shader_failure.js")) {\n    content = require("./platform/web/js/patches/wxslim_shader_instrument.cjs").instrumentGlue(content);\n}\nfs.writeFileSync(GODOT_JS_PATH, content);'],
];
const originals = new Map();
for (const [name, anchor] of replacements) {
  const text = fs.readFileSync(path.join(source, name), 'utf8');
  if (text.split(anchor).length !== 2) throw Error('Expected exactly one anchor: ' + name);
  originals.set(name, text);
}
git('apply', '--check', path.join(here, 'native.patch'));
// All preconditions have passed; any subsequent failure preserves this new clone for inspection.
git('apply', '--whitespace=nowarn', path.join(here, 'native.patch'));
for (const [name, file] of Object.entries(additions)) fs.copyFileSync(path.join(here, file), path.join(source, name), fs.constants.COPYFILE_EXCL);
for (const [name, anchor, replacement] of replacements) fs.writeFileSync(path.join(source, name), originals.get(name).replace(anchor, replacement));
git('add', '-N', '--', ...Object.keys(additions));
const patch = git('diff', '--binary', 'HEAD', '--');
git('diff', '--check');
fs.writeFileSync(out, patch, {flag: 'wx'});
const files = [...Object.keys(additions), 'drivers/gles3/shader_gles3.cpp', ...replacements.map(r => r[0])];
const metadata = {schema: 'wxslim-shader-failure-source-patch-v1', sourcePin: pin, patchSha256: hash(patch),
  inputs: ['native.patch', 'native-header.h', 'library.js', 'instrument-glue.cjs', 'prepare-source-patch.mjs'].map(name => ({name, sha256: hash(fs.readFileSync(path.join(here, name)))})),
  files: files.map(name => ({name, sha256: hash(fs.readFileSync(path.join(source, name)))})),
  scope: 'First failed shader diagnostic only; unchanged GLX library, frame submission, pixel ratio and render settings'};
fs.writeFileSync(out + '.json', JSON.stringify(metadata, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({patch: out, sha256: metadata.patchSha256, files: files.length}));
