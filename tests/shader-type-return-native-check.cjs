'use strict';
// Only accepts our SDK-built microfixture, never a Godot/GLX engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
if (!process.argv[2]) throw new Error('Usage: node tests/shader-type-return-native-check.cjs owned-fixture.js [report.json]');
const fixturePath = path.resolve(process.argv[2]);
const create = require(fixturePath);
const cases = [];
const hash = file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
(async () => {
  const originalInfo = console.info;
  console.info = (...args) => assert.equal(args[0], '[WXSLIM_SHADER_FAILURE_V1]');
  try {
    for (const mode of [0,1,2,3,4,5,6,7,8,9,10,11]) {
      const module = await create({ noInitialRun: true });
      let returned, escaped;
      try {
        returned = mode === 6 ? module._run_longjmp_fixture()
          : mode === 8 ? module._run_cpp_query_fixture()
          : mode === 9 ? module._run_type_longjmp_fixture()
          : mode === 10 ? module._run_type_cpp_fixture() : module._run_fixture(mode);
      } catch (error) { escaped = error; }
      module._destroy_fixture();
      const state = module.__wxslimShaderFailureStateV1;
      const r = module.__wxslimShaderFailureV1;
      const type = r && r.GLX_TYPE_RAW_RETURN;
      if (mode === 1) {
        assert.equal(returned,29); assert.equal(escaped,undefined);
        assert.equal(state,undefined); assert.equal(module.fixtureBeforeType,undefined);
        assert.deepEqual(module.fixtureEvents,['original-display']);
      } else if (mode === 7) {
        assert.equal(type,undefined); assert.equal(r.error.available,false);
        assert.deepEqual(module.fixtureEvents,[]);
      } else {
        assert.equal(state.active,false); assert.equal(type.armCount,1);
        assert.equal(type.validArmCount,true);
        assert.equal(type.captureCount, [2,9,10].includes(mode) ? 0 : 1);
        assert.equal(type.returnObserved, ![2,9,10].includes(mode));
        assert.equal(type.takeCount, [9,10].includes(mode) ? 0 : 1);
        // Cleanup must block a late import, including TYPE exceptions before take.
        assert.equal(state.typeTake(99,4),null);
        if (![9,10].includes(mode)) {
          assert.deepEqual(module.fixtureBeforeType,{active:true,typeArmCount:1,sourceArmCount:0});
          assert.equal(type.ptr,8); assert.equal(type.byteLength,12);
        }
        if (mode === 0 || mode === 11) {
          assert.equal(returned,29); assert.equal(escaped,undefined);
          assert.deepEqual(module.fixtureEvents,['original-display','TYPE','LENGTH']);
          assert.equal(module.fixtureLengthTake,false);
          assert.equal(r.batchReturnedType,mode === 11 ? 35632 : 35633);
          assert.equal(type.rawType,mode === 11 ? 'string' : 'number');
          assert.equal('numericValue' in type,mode === 0);
          if (mode === 0) assert.equal(type.numericValue,35633);
          const first = r;
          assert.equal(module._run_fixture(mode),29); module._destroy_fixture();
          assert.equal(module.__wxslimShaderFailureV1,first);
          assert.deepEqual(module.fixtureEvents,['original-display']);
        } else {
          assert.equal(r.batchReturnedSourceLength,-2147483648);
          assert.equal(r.batchReturnedType,[2,9,10].includes(mode) ? -2147483648 : 35633);
          if (mode === 4 || mode === 5) assert.equal(escaped,mode === 4 ? 71 : Infinity);
          else { assert.equal(escaped,undefined); assert.equal(returned,mode === 6 ? 39 : mode === 8 ? 43 : mode === 9 ? 47 : mode === 10 ? 53 : 29); }
        }
      }
      cases.push({ mode, passed:true, returned: returned ?? null,
        escaped: escaped === Infinity ? 'Infinity' : escaped ?? null,
        typeArmCount:type ? type.armCount : 0, typeTakeCount:type ? type.takeCount : 0,
        typeCaptureCount:type ? type.captureCount : 0 });
    }
    const raii = await create({ noInitialRun:true });
    assert.equal(raii._run_raii_fixture(),41);
    assert.equal(raii.__wxslimShaderFailureStateV1.active,false);
    assert.equal(raii.__wxslimShaderFailureV1.GLX_TYPE_RAW_RETURN,undefined);
    cases.push({ mode:'RAII-before-query',passed:true,typeArmCount:0 });
    const directory = path.dirname(fixturePath);
    const files = [__filename,fixturePath,path.join(directory,'native-fixture.cpp'),path.join(directory,'native-header.h'),fixturePath.replace(/\.js$/,'.wasm')];
    const report = { version:1, scope:'Owned microfixture and pinned Emscripten SDK only; no target engine, GLX, GPU, network or phone',
      passed:cases.length,failed:0,cases,files:files.filter(fs.existsSync).map(hash) };
    const json = JSON.stringify(report,null,2) + '\n';
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]),json,{flag:'wx'});
    process.stdout.write(json);
  } finally { console.info = originalInfo; }
})().catch(error => { console.error(error); process.exitCode=1; });
