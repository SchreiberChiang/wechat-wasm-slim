// Closed input identities, not caller-provided hashes or an arbitrary profile.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const freezePair = pair => {
  Object.freeze(pair.js); Object.freeze(pair.wasm); return Object.freeze(pair);
};
export const OFFICIAL_FULL_RAW_PAIR = freezePair({
  sourceCommit:'c050c09b105c3715e1caa57a7109cd752047fd89',
  js:{bytes:441774,sha256:'2b53363f6d569e9914d00eb679bc328b967d45c36b92faa2d463624e8b399207'},
  wasm:{bytes:65186782,sha256:'12dc2e40e1044345fbcd153497643bcd7b952705b1074da139f8b50048894861'}
});
export const OFFICIAL_CONSERVATIVE_RAW_PAIR = freezePair({
  sourceCommit:'c050c09b105c3715e1caa57a7109cd752047fd89',
  js:{bytes:424808,sha256:'6a6ef0ab09bba591d27304480cd64f579f4884ee6b14ef503c8ce56471cf577f'},
  wasm:{bytes:62428481,sha256:'26e5ccfec104ff731461e65ea994f3e60b8249f26fff4a15d405019fd96258e1'}
});
// Approved seven-source/two-object incremental build, task
// 3447d722-56f3-48d1-96b1-5bf81f314909. Original pairs stay pinned above.
// This identifies captured bytes; it does not admit runtime or clean rebuilds.
export const OFFICIAL_CAPABILITY_RAW_PAIR = freezePair({
  sourceCommit:'c050c09b105c3715e1caa57a7109cd752047fd89',
  js:{bytes:446230,sha256:'9af057efdb585d34234208f3b1669e44ab16671cee50a1d934844b65c6b50bf3'},
  wasm:{bytes:65187084,sha256:'5dfe6064bc773569ad782eca8e07688c6d4a3f57fe590a5af2e730811da5fe16'}
});
export const OFFICIAL_RAW_PAIR_LIMITS=Object.freeze({
  js:Math.max(OFFICIAL_FULL_RAW_PAIR.js.bytes,OFFICIAL_CONSERVATIVE_RAW_PAIR.js.bytes,OFFICIAL_CAPABILITY_RAW_PAIR.js.bytes),
  wasm:Math.max(OFFICIAL_FULL_RAW_PAIR.wasm.bytes,OFFICIAL_CONSERVATIVE_RAW_PAIR.wasm.bytes,OFFICIAL_CAPABILITY_RAW_PAIR.wasm.bytes)
});
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
export function identifyOfficialRawPair(options) {
  assert(options&&Object.getPrototypeOf(options)===Object.prototype,'OFFICIAL_RAW_ID_OPTIONS');
  assert.deepEqual(Reflect.ownKeys(options).sort(),['js','wasm'],'OFFICIAL_RAW_ID_EXACT_KEYS');
  for(const name of ['js','wasm'])assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,name),'value'),'OFFICIAL_RAW_ID_DATA_INPUTS');
  const {js,wasm}=options;
  assert(Buffer.isBuffer(js)&&Buffer.isBuffer(wasm),'OFFICIAL_RAW_ID_BUFFERS');
  const j=pin(js),w=pin(wasm);
  for(const [profile,pair] of [['full',OFFICIAL_FULL_RAW_PAIR],['conservative',OFFICIAL_CONSERVATIVE_RAW_PAIR],['full-capability',OFFICIAL_CAPABILITY_RAW_PAIR]]) {
    if(j.bytes===pair.js.bytes&&j.sha256===pair.js.sha256) {
      assert.deepEqual(w,pair.wasm,'OFFICIAL_POSTPROCESS_RAW_WASM_PIN');
      return {profile,pair};
    }
  }
  assert.fail('OFFICIAL_POSTPROCESS_RAW_JS_PIN');
}
