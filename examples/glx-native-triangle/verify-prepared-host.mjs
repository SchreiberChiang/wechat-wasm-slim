import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const output = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'HOST_MANIFEST.json'), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(output, file.name));
    assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
}
const hosted = fs.readFileSync(path.join(output, 'triangle-hosted.js'));
assert.equal(sha(hosted.subarray(0, manifest.originalJsOffset)), manifest.preludeSha256);
assert.equal(manifest.identity.hostSha256, sha(fs.readFileSync(path.join(output, 'host.js'))));
assert.equal(manifest.identity.adapterSha256, manifest.adapterSha256);
const { packageId, ...identityInputs } = manifest.identity;
assert.equal(packageId, 'native-triangle-' + sha(JSON.stringify(identityInputs)));
const original = fs.readFileSync(path.join(path.dirname(manifest.originalBuild), 'triangle.js'));
assert.deepEqual(hosted.subarray(manifest.originalJsOffset), original);
assert.deepEqual(fs.readFileSync(path.join(output, 'triangle.wasm')),
    fs.readFileSync(path.join(path.dirname(manifest.originalBuild), 'triangle.wasm')));
assert.deepEqual(fs.readFileSync(path.join(output, 'weapp-adapter.js')),
    fs.readFileSync(manifest.adapterSource));
// Execute ONLY our new prelude, with a fake host and synthetic HEAPU8 locals.
// The compiler output after originalJsOffset is never parsed/evaluated here.
const fakeModule = {};
const context = vm.createContext({ GameGlobal: {}, wx: {}, console,
    require(name) {
        assert.equal(name, './host.js');
        return { createHost(root, wx, identity) {
            assert.equal(identity.packageId, manifest.identity.packageId);
            return { moduleConfig: fakeModule, errorApi: {} };
        } };
    } });
// The real concatenated compiler file declares var HEAPU8 in the same scope.
// Supply only that synthetic declaration; none of its generated body is used.
vm.runInContext(hosted.subarray(0, manifest.originalJsOffset).toString('utf8') + '\nvar HEAPU8;', context);
assert.equal(fakeModule.HEAPU8, undefined);
// Current original JS contains no moduleOverrides identifier. Cover the common
// override-copy pattern with synthetic local code anyway: the non-enumerable
// getter is excluded from the copy and survives the assignment back.
vm.runInContext('var moduleOverrides = Object.assign({}, Module); Object.assign(Module, moduleOverrides);', context);
assert.equal(Object.hasOwn(context.moduleOverrides, 'HEAPU8'), false);
assert.equal(typeof Object.getOwnPropertyDescriptor(fakeModule, 'HEAPU8').get, 'function');
vm.runInContext('var HEAPU8 = new Uint8Array([1,2,3]);', context);
assert.equal(fakeModule.HEAPU8[0], 1);
const old = fakeModule.HEAPU8;
vm.runInContext('HEAPU8 = new Uint8Array([7,8,9,10]);', context);
assert.notEqual(fakeModule.HEAPU8, old); assert.equal(fakeModule.HEAPU8[0], 7);
console.log(JSON.stringify({ status: 'PASS', packageId, files: manifest.files.length,
    originalJsBytesEqual: true, wasmBytesEqual: true, adapterBytesEqual: true,
    preludeSyntheticHeapRefresh: 'PASS', syntheticModuleOverridesCopy: 'PASS',
    generatedJs: 'NOT_RUN', wasm: 'NOT_RUN',
    adapter: 'NOT_RUN', device: 'NOT_RUN' }));
