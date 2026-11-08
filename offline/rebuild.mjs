import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {executeOfficialRawBuild} from '../engine/official-build-raw.mjs';
import {OFFICIAL_CAPABILITY_RAW_REQUEST} from '../engine/official-raw-source-recipe.mjs';
import {OFFICIAL_CUSTOM_RAW_REQUEST} from '../engine/official-custom-source-plan.mjs';

const [recipe, toolDir, sdkDir, output, write, ...extra] = process.argv.slice(2);
assert(['full','conservative','pure-2d'].includes(recipe) && toolDir && sdkDir && output && write === '--write' && !extra.length,
  'Usage: node offline/rebuild.mjs full|conservative|pure-2d TOOLS PREPARED_SDK NEW_OUTPUT --write');
const source = fileURLToPath(new URL('../',import.meta.url));
const tools = fs.realpathSync(toolDir);
const sdk = fs.realpathSync(sdkDir);
const dependencies = JSON.parse(fs.readFileSync(path.join(sdk,'TOOLCHAIN_RESULT.json'),'utf8'));
assert.equal(dependencies.status,'PASS_DEPENDENCIES_ONLY','The toolchain must pass its complete pinned dependency audit');
const custom = recipe === 'pure-2d';
const request = {
  schema: custom ? OFFICIAL_CUSTOM_RAW_REQUEST : OFFICIAL_CAPABILITY_RAW_REQUEST,
  profile: custom ? 'custom' : recipe,
  ...(custom ? {features:{schema:'wxslim-custom-wasm-plan-v1',dimensions:'2d',disabledModules:[],disabledClasses:[]}} : {}),
  sourceTransport:'bundled-c050-pack',
  work:path.resolve(output), sdk:path.join(sdk,'tools/emsdk'), python:path.join(sdk,'tools/venv/Scripts/python.exe'),
  library:path.join(source,'engine/alpha-preserve-lighting/libemscriptenglx-4.0.10-026e.a'),
  sconsWheel:path.join(sdk,'downloads/scons-4.11.1-py3-none-any.whl'),
  sdkArchive:path.join(sdk,'downloads/emscripten-4.0.10-wasm-binaries.zip'),
  gitExecutable:path.join(tools,'git-windows/mingw64/bin/git.exe'),
  upstreamSource:path.join(source,'offline/upstream/library_godot_memfs.js'), jobs:4, budgetBytes:8*2**30,
};
const result=await executeOfficialRawBuild(request,{write:true});
console.log(JSON.stringify(result));
if (result.status !== 'SUCCESS') process.exitCode=1;
