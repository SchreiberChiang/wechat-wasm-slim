import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {brotliCompressSync} from 'node:zlib';
import {sha,md5} from '../convert/lib/inputs.mjs';
import {checkC050StoredWasm,auditCompletedCustomC050Output} from '../convert/lib/official-c050-adapter.mjs';
import {getOfficialRecipe,OFFICIAL_C050_CAPABILITY_PROFILE} from '../convert/lib/official-engine-admission.mjs';

test('retained actual launcher selects compressed bytes matching the registered raw WASM',()=>{
 const project=process.env.WXSLIM_EXISTING_CAPABILITY_PROJECT;assert(project&&path.isAbsolute(project),'explicit retained project required');
 const launch=JSON.parse(fs.readFileSync(path.join(project,'wx-game-kit/config.json'))).launch.code;
 assert.match(launch.fileMD5,/^[0-9a-f]{15}$/);
 const file=path.join(project,'wasmcode',launch.fileMD5+'.wasm.br'),before=fs.readFileSync(file);
 const expected=getOfficialRecipe(OFFICIAL_C050_CAPABILITY_PROFILE).engine.wasm;
 const r=checkC050StoredWasm(launch,before,expected);assert.deepEqual(r.decoded,expected);
 assert.equal(r.compressed.sha256,sha(before));assert.equal(r.instantiated,false);
 assert.equal(sha(fs.readFileSync(file)),sha(before));
});

test('wrong launcher, decoded digest, expansion limit, split or truncated bytes fail',()=>{
 const raw=Buffer.from('file identity model only'),b=brotliCompressSync(raw),p={bytes:raw.length,sha256:sha(raw)},
  cfg={useWasmCodeSplit:false,gameDir:'',fileMD5:md5(raw).slice(0,15)};
 assert.throws(()=>checkC050StoredWasm({...cfg,fileMD5:'0'.repeat(15)},b,p),/LAUNCH_WASM_ID/);
 assert.throws(()=>checkC050StoredWasm(cfg,b,{...p,sha256:'0'.repeat(64)}),/PACKAGED_WASM/);
 assert.throws(()=>checkC050StoredWasm(cfg,b,{...p,bytes:1}));
 assert.throws(()=>checkC050StoredWasm({...cfg,useWasmCodeSplit:true},b,p),/WHOLE_WASM_REQUIRED/);
 assert.throws(()=>checkC050StoredWasm(cfg,b.subarray(0,3),p));
});

test('completed project gate cannot be given a caller hash or a fabricated source receipt',async()=>{
 await assert.rejects(()=>auditCompletedCustomC050Output({preparationConfig:'MISSING',project:'MISSING',expected:{}}),/AUDIT_KEYS/);
 await assert.rejects(()=>auditCompletedCustomC050Output({preparationConfig:'MISSING',project:'MISSING'}),e=>e.code==='TASK_PAIR_PREPARATION_FAILED');
});
