// SOURCE_ONLY: deterministic bridge derivation. No conversion registration.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({bytes: bytes.length, sha256: sha(bytes)});
export const SECURE_RANDOM_BRIDGE_PINS = Object.freeze({
  base: '85cb71a58f74ece87d43a3ef587e77ca8f921dbb72502debabe00c92d39057c0',
  host: '2e04abe0b0b4ad0efb50b91f803bd1e1a89f71890a2093fa84ff45a96fa773b0'
});
const load = name => fs.readFileSync(new URL('../assets/' + name, import.meta.url));
export function prepareSecureRandomBridge() {
  const base = load('godot-bridge.js'), host = load('secure-random-host.js'), lifecycle = load('secure-random-lifecycle.js');
  assert.equal(sha(base), SECURE_RANDOM_BRIDGE_PINS.base, 'SECURE_RANDOM_BASE_PIN');
  assert.equal(sha(host), SECURE_RANDOM_BRIDGE_PINS.host, 'SECURE_RANDOM_HOST_PIN');
  let source = base.toString('utf8');
  const baseEol = source.includes('\r\n') ? '\r\n' : '\n';
  assert(!source.replaceAll(baseEol, '').includes('\n'), 'SECURE_RANDOM_BASE_EOL');
  // Preserve base bytes. Adapt only finite edit templates, including embedded
  // CJS text; matching CRLF as a unit avoids introducing a second CR character.
  const editEol = text => text.replace(/\r\n|\n/g, baseEol);
  const changes = [];
  function replace(before, after, label) {
    before = editEol(before); after = editEol(after);
    assert.equal(source.split(before).length, 2, 'SECURE_RANDOM_UNIQUE_' + label);
    changes.push({before, after, label}); source = source.replace(before, () => after);
  }
  const factory = bytes => '(function(){var module={exports:{}};\n' + bytes.toString('utf8') + '\nreturn module.exports;}())';
  replace("  function check(value, code)",
    '  var createSecureRandomHost=' + factory(host) + ';\n' +
    '  var createSecureRandomLifecycle=' + factory(lifecycle) + ';\n' +
    '  var secureRandomStarting=false;\n  function check(value, code)', 'LOCAL_FACTORIES');
  replace("    if(root.__WXSLIM_BOOT_STATE__ && root.__WXSLIM_BOOT_STATE__.factoryCalls>0) return Promise.reject(Error('WXSLIM_RESTART_REQUIRED'));",
    "    if(secureRandomStarting) return Promise.reject(Error('WXSLIM_RESTART_REQUIRED'));\n" +
    "    if(root.__WXSLIM_BOOT_STATE__ && root.__WXSLIM_BOOT_STATE__.factoryCalls>0) return Promise.reject(Error('WXSLIM_RESTART_REQUIRED'));\n" +
    '    secureRandomStarting=true;', 'SYNCHRONOUS_START_OWNER');
  replace('    var upstreamStorage=false, upstreamStorageHash=null;',
    '    var upstreamStorage=false, upstreamStorageHash=null;\n    var secureRandom=null, secureRandomCleanupLogged=false;\n' +
    '    function secureRandomStatus(snapshot){\n' +
    '      state.secureRandom=snapshot;\n' +
    '      if(snapshot.cleanupFailures>0 && !secureRandomCleanupLogged){\n' +
    '        secureRandomCleanupLogged=true;\n' +
    "        try{if(typeof console!=='undefined' && typeof console.error==='function')console.error('[WXSLIM_SECURE_RANDOM_CLEANUP_INCOMPLETE]',snapshot.nativeState,snapshot.cleanupFailures);}catch(_){}\n" +
    '      }\n    }', 'OWNER');
  replace("      mark('FACTORY_START');state.factoryCalls++;\n      return Promise.resolve(factory(module)).then(function (m) {",
    "      secureRandom=createSecureRandomLifecycle({module:module,wx:wxApi,createSecureRandomHost:createSecureRandomHost,onStatus:secureRandomStatus,setTimeout:function(fn,ms){return root.setTimeout(fn,ms);},clearTimeout:function(id){return root.clearTimeout(id);}});\n" +
    "      return secureRandom.prepare().then(function(){\n      mark('FACTORY_START');state.factoryCalls++;\n      return factory(module);\n      }).then(function (m) {\n        secureRandom.bindNative(m);", 'PREPARE_FACTORY_READY');
  for (const reason of ['ENGINE_EXIT', 'CALL_MAIN_FAILED', 'STARTUP_FAILED']) {
    const indent = reason === 'ENGINE_EXIT' ? '          ' : reason === 'CALL_MAIN_FAILED' ? '              ' : '      ';
    const before = indent + "releaseResources('" + reason + "');";
    replace(before, indent + 'if(secureRandom)secureRandom.close();\n' + before, reason);
  }
  replace('      throw error;\n    });\n  }',
    '      throw error;\n    }).finally(function(){\n' +
    '      if(state.factoryCalls===0)secureRandomStarting=false;\n' +
    '    });\n  }', 'RELEASE_ONLY_BEFORE_FACTORY');
  // Reverse all finite edits: every original byte must be recoverable, including
  // render/audio/storage behavior and the untouched outer loader entry point.
  let reversed = source;
  for (const change of changes.slice().reverse()) {
    assert.equal(reversed.split(change.after).length, 2, 'SECURE_RANDOM_REVERSE_UNIQUE');
    reversed = reversed.replace(change.after, () => change.before);
  }
  assert.equal(reversed, base.toString('utf8'), 'SECURE_RANDOM_OUTSIDE_EDITS');
  const output = Buffer.from(source);
  return {source: output, receipt: {schema: 'wxslim-secure-random-bridge-v1', status: 'SOURCE_ONLY_NOT_INTEGRATED',
    base: identity(base), host: identity(host), lifecycle: identity(lifecycle), derived: identity(output),
    editLineEndings: baseEol === '\r\n' ? 'CRLF' : 'LF',
    changes: changes.map(change => change.label), outsideEditsBytesUnchanged: true,
    runtime: 'NOT_RUN', nativeTerminationBeforeBinding: 'UNKNOWN',
    limits: ['No conversion/profile registration', 'Existing engine crypto prelude is unchanged',
      'A host hook failure defers native cleanup; host rejection stays original', 'Native export failure is recorded, never reported as termination success']}};
}
