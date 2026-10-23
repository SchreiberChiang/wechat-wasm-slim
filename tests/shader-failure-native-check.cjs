'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
if (!process.argv[2]) throw new Error('Usage: node tests/shader-failure-native-check.cjs path/to/fixture.js');
const create = require(path.resolve(process.argv[2]));
(async () => {
  const originalInfo = console.info;
  let recordLogs = 0;
  console.info = (...args) => { assert.equal(args[0], '[WXSLIM_SHADER_FAILURE_V1]'); recordLogs++; };
  try {
    for (const mode of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const module = await create({ noInitialRun: true });
      let returned, escaped;
      try { returned = mode === 6 ? module._run_longjmp_fixture() : mode === 8 ? module._run_cpp_query_fixture() : module._run_fixture(mode); } catch (error) { escaped = error; }
      module._destroy_fixture();
      const state = module.__wxslimShaderFailureStateV1;
      if (mode === 1) {
        assert.equal(returned, 29); assert.equal(state, undefined);
        assert.deepEqual(module.fixtureEvents, ['original-display']);
      } else {
        assert.equal(state.active, false); assert.equal(state.armed, false);
        const record = module.__wxslimShaderFailureV1;
        assert.ok(record); assert.equal(record.shader, 17);
        if (mode === 7) {
          assert.equal(record.error.available, false); assert.deepEqual(module.fixtureEvents, []);
          process.stdout.write('mode=7 PASS no-log unavailable/zeroqueries\n'); continue;
        }
        assert.equal(record.error.text, 'compile error');
        assert.equal(module.fixtureEvents[0], 'original-display');
        if (mode === 0) {
          assert.equal(returned, 29); assert.equal(record.batchReturnedType, 35633);
          assert.equal(record.batchReturnedSourceLength, 12);
          assert.deepEqual(module.fixtureEvents, ['original-display', 'TYPE', 'LENGTH']);
          const first = record; assert.equal(module._run_fixture(0), 29); module._destroy_fixture();
          assert.equal(module.__wxslimShaderFailureV1, first);
          assert.deepEqual(module.fixtureEvents, ['original-display']);
        } else {
          assert.equal(record.batchReturnedSourceLength, -2147483648);
          assert.equal(record.GLX_BATCH_RETURN.available, false);
          assert.equal(record.batchReturnedType, mode === 2 ? -2147483648 : 35633);
          if (mode <= 3 || mode === 6 || mode === 8) { assert.equal(returned, mode === 6 ? 39 : mode === 8 ? 43 : 29); assert.equal(escaped, undefined); }
          else { assert.equal(escaped, mode === 4 ? 71 : Infinity); }
        }
      }
      process.stdout.write(`mode=${mode} PASS events=${JSON.stringify(module.fixtureEvents)}${mode === 0 ? ' (second failure; first asserted display,TYPE,LENGTH)' : ''}\n`);
    }
    const raii = await create({ noInitialRun: true });
    assert.equal(raii._run_raii_fixture(), 41);
    assert.equal(raii.__wxslimShaderFailureStateV1.active, false);
    assert.equal(raii.__wxslimShaderFailureStateV1.armed, false);
    assert.ok(raii.__wxslimShaderFailureV1);
    assert.equal(recordLogs, 9);
    process.stdout.write('C++ RAII unwind PASS\n10/10 owned SDK/WASM boundary cases passed; no target GLX archive, GPU or network used.\n');
  } finally { console.info = originalInfo; }
})().catch(error => { console.error(error); process.exitCode = 1; });
