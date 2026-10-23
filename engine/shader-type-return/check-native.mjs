// Build only our tiny native fixture against the prepared diagnostic header.
// No Godot binary, GLX archive, GPU, network or phone is executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildEnv, resolveToolchain, EMSCRIPTEN_VERSION } from '../../trim/lib/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--source', '--toolchain', '--out'].includes(args[i]) || !args[i + 1] || options[args[i]]) {
    throw Error('Usage: node engine/shader-type-return/check-native.mjs --source PREPARED_SOURCE --toolchain TOOLCHAIN_JSON --out NEW_DIRECTORY');
  }
  options[args[i]] = path.resolve(args[i + 1]);
}
if (Object.keys(options).length !== 3) throw Error('Require --source, --toolchain and --out');
const source = options['--source'], recipe = options['--toolchain'], out = options['--out'];
const tc = resolveToolchain(JSON.parse(fs.readFileSync(recipe, 'utf8')), recipe);
if (!tc.python || !tc.emsdk) throw Error('Toolchain requires python and emsdk');
const header = path.join(source, 'drivers/gles3/wxslim_shader_failure.h');
const headerBytes = fs.readFileSync(header), headerText = headerBytes.toString('utf8');
const baseHeader = fs.readFileSync(path.join(here, '../shader-failure/native-header.h'), 'utf8');
const expectedHeader = baseHeader
  .replace('void wxslim_shader_failure_arm_source();', 'void wxslim_shader_failure_arm_type();\nvoid wxslim_shader_failure_arm_source();')
  .replace('        glGetShaderiv(self->shader, GL_SHADER_TYPE, &returned_type);',
    '        wxslim_shader_failure_arm_type();\n        glGetShaderiv(self->shader, GL_SHADER_TYPE, &returned_type);');
if (headerText !== expectedHeader) throw Error('Prepared header differs from the minimal TYPE-before-query addition');
const libraries = [
  [path.join(source, 'platform/web/js/libs/library_wxslim_shader_failure.js'), path.join(here, '../shader-failure/library.js')],
  [path.join(source, 'platform/web/js/libs/library_wxslim_shader_type_return.js'), path.join(here, 'library.js')]
];
for (const [prepared, owned] of libraries) {
  if (!fs.readFileSync(prepared).equals(fs.readFileSync(owned))) throw Error('Prepared library mismatch: ' + path.basename(prepared));
}
const config = path.join(tc.emsdk, '.emscripten');
if (!/^FROZEN_CACHE\s*=\s*True\s*$/m.test(fs.readFileSync(config, 'utf8'))) throw Error('Requires existing FROZEN_CACHE = True; SDK/cache will not be modified');
const versionFile = path.join(tc.emsdk, 'upstream/emscripten/emscripten-version.txt');
const sdkVersion = fs.readFileSync(versionFile, 'utf8').trim().replace(/^"([0-9.]+)"$/, '$1');
if (sdkVersion !== EMSCRIPTEN_VERSION) throw Error('Requires pinned Emscripten ' + EMSCRIPTEN_VERSION);
// Atomic refusal also rejects an existing directory or dangling output symlink.
fs.mkdirSync(out);
const fixture = path.join(out, 'native-fixture.cpp'), copiedHeader = path.join(out, 'native-header.h');
fs.copyFileSync(path.join(here, 'native-fixture.cpp'), fixture, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(copiedHeader, headerBytes, { flag:'wx' });
if (!fs.readFileSync(fixture).equals(fs.readFileSync(path.join(here, 'native-fixture.cpp'))) ||
    !fs.readFileSync(copiedHeader).equals(headerBytes)) throw Error('Fixture/header copy mismatch');
const temporary = path.join(out, 'temp'); fs.mkdirSync(temporary);
const env = { ...buildEnv(tc), TEMP:temporary, TMP:temporary, EMCC_TEMP_DIR:temporary };
function run(command, commandArgs, logName) {
  const log = path.join(out, logName), fd = fs.openSync(log, 'wx');
  let result;
  try { result = spawnSync(command, commandArgs, { cwd:out, env, windowsHide:true, stdio:['ignore',fd,fd], timeout:300000 }); }
  finally { fs.closeSync(fd); }
  if (result.error || result.status !== 0) throw Error(`${logName} failed: ${result.error?.message || result.status}; preserved log: ${log}`);
  return { command, args:commandArgs, exitCode:result.status, log };
}
const js = path.join(out, 'runtime-fixture.js');
const compileArgs = [path.join(tc.emsdk, 'upstream/emscripten/em++.py'), fixture,
  '-DWEB_ENABLED','-DWECHAT_GLX_EXPERIMENTAL','-std=c++17','-Os','-flto=thin','-fexceptions',
  '-sSUPPORT_LONGJMP=emscripten','-sSTACK_SIZE=5242880','-sEXIT_RUNTIME=1','-sMAX_WEBGL_VERSION=2',
  '-sGL_ENABLE_GET_PROC_ADDRESS=0','-sENVIRONMENT=node','-sMODULARIZE=1','-sEXPORT_NAME=CreateWxslimFixture',
  '-sEXPORTED_FUNCTIONS=["_run_fixture","_destroy_fixture","_run_raii_fixture","_run_longjmp_fixture","_run_cpp_query_fixture","_run_type_longjmp_fixture","_run_type_cpp_fixture"]',
  '--no-entry', ...libraries.flatMap(([prepared]) => ['--js-library',prepared]), '-o',js];
const oldChecker = path.join(repo, 'tests/shader-failure-native-check.cjs');
const typeChecker = path.join(repo, 'tests/shader-type-return-native-check.cjs');
const commands = [run(tc.python, compileArgs, 'compile-link.log')];
commands.push(run(process.execPath, [oldChecker,js], 'old-check.log'));
commands.push(run(process.execPath, [typeChecker,js,path.join(out,'type-return-report.json')], 'type-return-check.log'));
const identities = [fileURLToPath(import.meta.url),recipe,config,versionFile,tc.python,compileArgs[0],
  path.join(here,'native-fixture.cpp'),header,copiedHeader,fixture,...libraries.flat(),oldChecker,typeChecker,
  js,js.replace(/\.js$/,'.wasm'),path.join(out,'type-return-report.json')].map(file => {
    const bytes = fs.readFileSync(file);
    return {path:file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  });
const report = {version:1,scope:'Owned native fixture only; no Godot/GLX/GPU/network/phone execution',
  source,toolchain:recipe,emscripten:EMSCRIPTEN_VERSION,frozenCache:true,
  oldContractPassed:10,typeContractPassed:13,commands,files:identities};
fs.writeFileSync(path.join(out,'native-check.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,oldContractPassed:10,typeContractPassed:13,report:path.join(out,'native-check.json')}));
