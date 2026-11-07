// Shared, explicit development adapter. No filesystem mutation or target execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha} from './inputs.mjs';
import {checkFixedPair,getOfficialRecipe,getRecipeIdentity} from './official-engine-admission.mjs';
import {deriveRawUpstreamWxmemfsReadGlue,inspectUpstreamWxmemfsReadGlue} from '../../engine/upstream-wxmemfs-rule.mjs';

export const STORAGE_PROFILE='full-upstream-read-dev';
const identity=b=>({bytes:b.length,sha256:sha(b)});
export function readStorageSource(file) {
 assert(typeof file==='string'&&path.isAbsolute(file),'STORAGE_EXPLICIT_SOURCE_PATH');
 const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'STORAGE_REGULAR_SOURCE');
 const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 assert.equal(norm(fs.realpathSync(file)),norm(file),'STORAGE_REAL_SOURCE_PATH');
 return fs.readFileSync(file);
}
export function prepareStorageAdapter({profile,js,wasm,sourceBytes}) {
 assert.equal(profile,STORAGE_PROFILE,'STORAGE_EXPLICIT_DEVELOPMENT_PROFILE');
 assert(Buffer.isBuffer(js)&&Buffer.isBuffer(wasm)&&Buffer.isBuffer(sourceBytes),'STORAGE_INPUT_BUFFERS');
 const recipe=getOfficialRecipe(profile),pairAudit=checkFixedPair(js,wasm,profile);
 assert.deepEqual(identity(sourceBytes),recipe.adapter.source,'STORAGE_SOURCE_PIN');
 const patches=recipe.adapter.patches.map(p=>{
   const bytes=fs.readFileSync(new URL('../../'+p.path,import.meta.url));
   assert.deepEqual(identity(bytes),{bytes:p.bytes,sha256:p.sha256},'STORAGE_PATCH_PIN');return bytes;
 });
 const prepared=deriveRawUpstreamWxmemfsReadGlue({glue:js,sourceBytes,patchBytes:patches[0],readPatchBytes:patches[1],
   licenseBytes:fs.readFileSync(new URL('../../engine/upstream-wxmemfs.LICENSE',import.meta.url))});
 assert.deepEqual(prepared.receipt.source.derived,recipe.adapter.derivedSource,'STORAGE_DERIVED_SOURCE_PIN');
 assert.deepEqual(identity(prepared.glue),recipe.adapter.effectiveJs,'STORAGE_EFFECTIVE_JS_PIN');
 const receipt={schema:'wxslim-storage-adapter-v1',id:recipe.adapter.id,profile,...getRecipeIdentity(profile),
   originalJs:identity(js),effectiveJs:identity(prepared.glue),wasm:identity(wasm),source:identity(sourceBytes),
   derivedSource:prepared.receipt.source.derived,patches:recipe.adapter.patches,
   validation:recipe.validation,runtime:'NOT_RUN',visual:'NOT_VERIFIED'};
 return {effectiveJs:prepared.glue,prepared,pairAudit,receipt,runtimeOptions:{storageBackend:recipe.adapter.storageBackend,
   upstreamWxmemfsSha256:recipe.adapter.derivedSource.sha256,storageAdapter:receipt}};
}
export function renderStorageBridge(source,renderMode,locale) {
 assert(typeof source==='string'&&['glx','webgl'].includes(renderMode)&&typeof locale==='string','STORAGE_BRIDGE_OPTIONS');
 for(const token of ['__WXSLIM_RENDER_MODE__','__WXSLIM_LOCALE__'])assert.equal(source.split(token).length,2,'STORAGE_BRIDGE_TOKEN');
 return source.replace('__WXSLIM_RENDER_MODE__',()=>JSON.stringify(renderMode)).replace('__WXSLIM_LOCALE__',()=>JSON.stringify(locale));
}
export function inspectStorageAdapterOutput(framework,adapter,{bridge}={}) {
 const result=inspectUpstreamWxmemfsReadGlue(framework,adapter.prepared,bridge);
 assert.equal(result.sourceSha256,adapter.receipt.derivedSource.sha256);
 return result;
}
