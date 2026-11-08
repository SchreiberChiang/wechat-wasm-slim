// Fixed-c050 checkout policy only. Never normalize bytes read from the checkout.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const metadataSha='8e3b3976671dbab5b560f93eaee57e6452a2085cb8e92f4b961c40172e4f93bd';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:b.length,sha256:sha(b)});
export function exactLfToCrlf(blob){
 assert(Buffer.isBuffer(blob),'EOL_BLOB_BUFFER');assert(!blob.includes(13),'EOL_PARENT_MUST_BE_EXACT_LF');
 const pieces=[];let start=0;for(let i=0;i<blob.length;i++)if(blob[i]===10){pieces.push(blob.subarray(start,i),Buffer.from([13,10]));start=i+1;}pieces.push(blob.subarray(start));return Buffer.concat(pieces);
}
export function createOfficialCheckoutEolPolicy(){
 const bytes=fs.readFileSync(new URL('./official-checkout-eol.json',import.meta.url));assert.equal(sha(bytes),metadataSha,'EOL_METADATA_PIN');const m=JSON.parse(bytes);
 assert.equal(m.commit,'c050c09b105c3715e1caa57a7109cd752047fd89');assert.equal(m.files.length,25);assert.equal(new Set(m.files.map(p=>p.path)).size,25);
 const entries=new Map(m.files.map(p=>[p.path,p])),seen=new Set();
 return {commit:m.commit,retainedBlobIds:new Set(m.files.map(p=>p.gitBlob)),
  project(row,body){
   const p=entries.get(row.path);if(!p)return {...row};
   assert.equal(row.blob,p.gitBlob,'EOL_GIT_BLOB');assert.equal(row.mode,p.mode,'EOL_MODE');assert.deepEqual({bytes:row.bytes,sha256:row.sha256},p.blob,'EOL_ORIGINAL_PIN');
   assert(Buffer.isBuffer(body),'EOL_AUTHENTICATED_BODY_REQUIRED');assert.deepEqual(pin(body),p.blob,'EOL_BODY_PIN');
   const objectId=createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex');assert.equal(objectId,p.gitBlob,'EOL_BODY_GIT_ID');
   const projected=exactLfToCrlf(body);assert.deepEqual(pin(projected),p.checkout,'EOL_CHECKOUT_PIN');assert.equal(projected.length-body.length,p.lfCount);
   seen.add(row.path);return {...row,...p.checkout,checkoutProjection:'FIXED_C050_EXACT_LF_TO_CRLF',originalBlobPin:p.blob};
  },
  finalize(files){
   assert.equal(files.size,m.trackedFiles,'EOL_FIXED_TREE_FILE_COUNT');
   const attrs=[...files.keys()].filter(p=>p==='.gitattributes'||p.endsWith('/.gitattributes')).sort();
   assert.deepEqual(attrs,m.attributes.map(p=>p.path).sort(),'EOL_UNREVIEWED_ATTRIBUTES');
   for(const p of m.attributes){const actual=files.get(p.path);assert.equal(actual.blob,p.gitBlob,'EOL_ATTRIBUTES_GIT_ID');assert.deepEqual({bytes:actual.bytes,sha256:actual.sha256},{bytes:p.bytes,sha256:p.sha256},'EOL_ATTRIBUTES_PIN');}
   assert.deepEqual([...seen].sort(),m.files.map(p=>p.path).sort(),'EOL_MISSING_FIXED_PATH');
   return {schema:m.schema,metadata:{bytes:bytes.length,sha256:metadataSha},attributes:m.attributes,projectedFiles:m.files,
    projectionCount:seen.size,otherPaths:'UNCHANGED_RAW_GIT_BLOB_PINS',diskNormalization:false};
  }};
}
