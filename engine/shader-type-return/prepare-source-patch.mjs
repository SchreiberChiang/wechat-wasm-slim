// Add one raw-return observer to the sealed failure diagnostic in a NEW clone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(here, '../shader-failure');
const pin = 'df3cdd9bc9941a20cb5575d781cde6f937637bcb';
const basePatchSha = 'fff071e50459bb5434b3a14c2d38927d655f632044f4ec0dba96369e8d50fd3b';
const baseInputs = {
  'native.patch': '16f04a67f6d7bcb50426c3dd82a8fc100e68570d27c783c5987d942773f58899',
  'native-header.h': '426bb0cac0c0fafe751d22d0fa33ad791a3f2a89ace10bd3ab21619e80f0f335',
  'library.js': 'c1e9386f676e77d8883b634f3781a7737a3f8fe6e0694be7db0a82fbe4ac5ce6',
  'instrument-glue.cjs': '5778bd25ed34a050bd2285b53886953528299e9ceb677573aee5a2b8efff76d0',
  'prepare-source-patch.mjs': '3ea22cca2c1f95b956ab004643dcfb702a8ea3b58d79bffdd1fbf54ddc14c6fe'
};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--out') throw Error('Usage: --source NEW_CLEAN_SOURCE --out NEW_PATCH_FILE');
const source = path.resolve(args[1]), out = path.resolve(args[3]);
const git = (...a) => execFileSync('git.exe', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', '-C', source, ...a], {windowsHide: true});
for (const suffix of ['', '.json', '.base.patch', '.base.patch.json']) if (fs.existsSync(out + suffix)) throw Error('Output exists; preserve it and use a new path');
for (const [name, sha] of Object.entries(baseInputs)) if (hash(fs.readFileSync(path.join(base, name))) !== sha) throw Error('Sealed base input changed: ' + name);
const additions = {
  'platform/web/js/libs/library_wxslim_shader_type_return.js': 'library.js',
  'platform/web/js/patches/wxslim_shader_type_instrument.cjs': 'instrument-glue.cjs'
};
for (const name of Object.keys(additions)) if (fs.existsSync(path.join(source, name))) throw Error('Observer source already exists: ' + name);
// The sealed preparer checks the root, clean tree, pin, and all original anchors.
execFileSync(process.execPath, [path.join(base, 'prepare-source-patch.mjs'), '--source', source, '--out', out + '.base.patch'], {windowsHide: true, stdio: 'pipe'});
if (hash(fs.readFileSync(out + '.base.patch')) !== basePatchSha) throw Error('Generated base patch differs from sealed candidate; preserve this clone');

const replacements = [
  ['drivers/gles3/wxslim_shader_failure.h', 'void wxslim_shader_failure_arm_source();', 'void wxslim_shader_failure_arm_type();\nvoid wxslim_shader_failure_arm_source();'],
  ['drivers/gles3/wxslim_shader_failure.h', '        glGetShaderiv(self->shader, GL_SHADER_TYPE, &returned_type);', '        wxslim_shader_failure_arm_type();\n        glGetShaderiv(self->shader, GL_SHADER_TYPE, &returned_type);'],
  ['platform/web/SCsub', '    "js/libs/library_wxslim_shader_failure.js",', '    "js/libs/library_wxslim_shader_failure.js",\n    "js/libs/library_wxslim_shader_type_return.js",'],
  ['godot_process.js', '    content = require("./platform/web/js/patches/wxslim_shader_instrument.cjs").instrumentGlue(content);', '    content = require("./platform/web/js/patches/wxslim_shader_instrument.cjs").instrumentGlue(content);\n    content = require("./platform/web/js/patches/wxslim_shader_type_instrument.cjs").instrumentGlue(content);']
];
const updates = new Map();
for (const [name, anchor, replacement] of replacements) {
  const text = updates.get(name) ?? fs.readFileSync(path.join(source, name), 'utf8');
  if (text.split(anchor).length !== 2) throw Error('Expected exactly one new observer anchor: ' + name);
  updates.set(name, text.replace(anchor, replacement));
}
for (const [name, file] of Object.entries(additions)) fs.copyFileSync(path.join(here, file), path.join(source, name), fs.constants.COPYFILE_EXCL);
for (const [name, text] of updates) fs.writeFileSync(path.join(source, name), text);
git('add', '-N', '--', ...Object.keys(additions));
git('diff', '--check');
const patch = git('diff', '--binary', 'HEAD', '--');
const names = git('diff', '--name-only', 'HEAD', '--').toString().trim().split(/\r?\n/).sort();
const metadata = {schema: 'wxslim-shader-type-return-source-patch-v1', sourcePin: pin,
  basePatchSha256: basePatchSha, patchSha256: hash(patch),
  inputs: [
    ...Object.entries(baseInputs).map(([name, sha256]) => ({name: '../shader-failure/' + name, sha256})),
    ...['library.js', 'instrument-glue.cjs', 'prepare-source-patch.mjs'].map(name => ({name, sha256: hash(fs.readFileSync(path.join(here, name)))}))
  ],
  files: names.map(name => ({name, sha256: hash(fs.readFileSync(path.join(source, name)))})),
  scope: 'One raw JS return observation immediately around the existing first-failure TYPE query; no added GL queries or batch parsing; unchanged library, frame submission, source text and render settings'};
fs.writeFileSync(out, patch, {flag: 'wx'});
fs.writeFileSync(out + '.json', JSON.stringify(metadata, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({patch: out, sha256: metadata.patchSha256, files: names.length}));
