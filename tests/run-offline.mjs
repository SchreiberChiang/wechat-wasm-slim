import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const source = fileURLToPath(new URL('../', import.meta.url));
const [stateDirectory, ...args] = process.argv.slice(2);
assert(stateDirectory && !args.length, 'Usage: node tests/run-offline.mjs PREPARED_TOOL_DIRECTORY');
const state = fs.realpathSync(stateDirectory);
const sourceFile = name => path.join(source, 'offline', name);
const required = {
  OFFICIAL_CAPTURE_RAW_DIR: sourceFile('fixtures/c050'),
  WXSLIM_C050_EXISTING_FRAMEWORK: sourceFile('fixtures/c050/framework.js'),
  WXSLIM_GRAPHICS_RAW_JS: sourceFile('fixtures/df3/emscripten-before-godot-process.js'),
  WXSLIM_CUSTOM_STARTUP_PCK: sourceFile('fixtures/game/boot.pck'),
  WXSLIM_CAPABILITY_FOLLOWUP_SOURCE: path.join(state, 'c050.git'),
  WXSLIM_CAPABILITY_FOLLOWUP_REQUEST: path.join(state, 'source-request.json'),
  WXSLIM_C050_HTTP_SOURCE: sourceFile('fixtures/http'),
  WXSLIM_IME_SESSION_SOURCE: sourceFile('fixtures/ime/library_godot_input.js'),
  WXSLIM_EXISTING_CAPABILITY_PROJECT: sourceFile('fixtures/stored'),
  WXSLIM_MODEL_PYTHON: path.join(state, 'venv/Scripts/python.exe'),
  WXSLIM_FIXED_PYTHON: path.join(state, 'venv/Scripts/python.exe'),
  WXSLIM_PINNED_GIT_EXE: path.join(state, 'git-windows/mingw64/bin/git.exe'),
  WXSLIM_C050_GIT: path.join(state, 'c050.git'),
  WXSLIM_FIXED_ENGINE_SOURCE: path.join(state, 'df3.git'),
  WXSLIM_SHADER_DF3_ROOT: path.join(state, 'df3.git'),
  WXSLIM_AUDIO_DF3_ROOT: path.join(state, 'df3.git'),
  WXSLIM_FIXED_HTTP_FIXTURES: sourceFile('fixtures/fork-http'),
  WXSLIM_OFFICIAL_SOURCE_ROOT: sourceFile('fixtures/c050-source'),
  WXSLIM_CUSTOM_MODULE_SOURCE: sourceFile('fixtures/modules'),
};
for (const [key, filename] of Object.entries(required)) {
  assert(fs.existsSync(filename), 'Missing offline input ' + key + ' at ' + filename);
}
const files = ['editor/workbench', 'tests'].flatMap(dir =>
  fs.readdirSync(path.join(source, dir)).filter(name => name.endsWith('-tests.mjs')).sort()
    .map(name => path.join(dir, name)));
const result = spawnSync(path.join(state, 'node.exe'),
  ['--test', '--test-concurrency=4', '--test-reporter=tap', ...files], {
    cwd: source, windowsHide: true, stdio: ['ignore','pipe','inherit'], encoding:'utf8', maxBuffer:64*2**20,
    env: {...process.env, ...required,
      PATH: path.dirname(required.WXSLIM_PINNED_GIT_EXE) + path.delimiter + process.env.PATH,
      GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'NUL', GIT_NO_REPLACE_OBJECTS:'1',
      GIT_CONFIG_COUNT:'2', GIT_CONFIG_KEY_0:'safe.directory', GIT_CONFIG_KEY_1:'safe.directory',
      GIT_CONFIG_VALUE_0:required.WXSLIM_C050_GIT.replaceAll('\\','/'), GIT_CONFIG_VALUE_1:required.WXSLIM_AUDIO_DF3_ROOT.replaceAll('\\','/')},
  });
if (result.error) throw result.error;
process.stdout.write(result.stdout);
if (result.status !== 0) process.exitCode = result.status ?? 1;
else {
  const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)\r?$/gm)]
    .map(([,name,value])=>[name,Number(value)]));
  assert(counts.tests > 0 && counts.pass === counts.tests &&
    ['fail','skipped','cancelled','todo'].every(name=>counts[name]===0),'Offline regression requires every test to run and pass');
}
