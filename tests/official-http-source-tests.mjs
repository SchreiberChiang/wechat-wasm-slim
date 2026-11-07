// Memory-only new-file replay and existing real-JS-function models. No Godot,
// compiler, wx/platform API or network request (model.invalid is never fetched).
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
import {identity,loadFixedSource,withFetchModelSource,fetchLibraryProperties,createFetchModel} from './fixed-fetch-source-model.mjs';
const meta=JSON.parse(fs.readFileSync(new URL('../engine/official-http-source.json',import.meta.url),'utf8'));
const patch=fs.readFileSync(new URL('../engine/official-http-source.patch',import.meta.url));
const changes=replayUnifiedPatch(patch,()=>null),source=changes.get('platform/web/js/libs/library_wxslim_fetch.js').text;
const prefix=source.slice(0,source.indexOf('const GodotFetch =')),body=source.slice(prefix.length);
test('new file preserves official copyright prefix and complete reviewed df3 implementation pins',()=>{
  assert.deepEqual([...changes.keys()],['platform/web/js/libs/library_wxslim_fetch.js']);assert.equal(changes.values().next().value.added,true);
  assert.deepEqual(identity(patch),{bytes:meta.patch.bytes,sha256:meta.patch.sha256});assert(!patch.includes(13));
  assert.deepEqual(identity(source),{bytes:meta.newFile.bytes,sha256:meta.newFile.sha256});
  assert.deepEqual(identity(prefix),{bytes:2234,sha256:'59a5f41005ddd021b32fafa7d1b3282acb856f412fe9d3e9ce9346397f0ae79d'});
  assert.deepEqual(identity(body),{bytes:10654,sha256:'e3f77149630e870986cd5e291effabfccb4610c19a8039ad85f3fafb9a4ed776'});
  new vm.Script(source);assert.throws(()=>replayUnifiedPatch(patch,()=>Buffer.from(source)));
});
test('seven official ABI signatures remain and only the pre-existing fork helper is extra',()=>{
  const properties=fetchLibraryProperties(source),sigs=properties.filter(p=>p.name.endsWith('__sig')).map(p=>[p.name,p.code.slice(1,-1)]);
  const expected=[['godot_js_fetch_create__sig','iiiiiii'],['godot_js_fetch_state_get__sig','ii'],['godot_js_fetch_http_status_get__sig','ii'],['godot_js_fetch_read_headers__sig','iiii'],['godot_js_fetch_read_chunk__sig','iiii'],['godot_js_fetch_is_chunked__sig','ii'],['godot_js_fetch_free__sig','vi']];
  assert.deepEqual(sigs.filter(p=>p[0]!=='godot_js_fetch_body_length_get__sig'),expected);
  assert.deepEqual(sigs.filter(p=>p[0]==='godot_js_fetch_body_length_get__sig'),[['godot_js_fetch_body_length_get__sig','ii']]);
  assert.equal(meta.extraExistingForkExport.referencedByOfficialCpp,false);assert.equal(meta.selection.scsubModified,false);
});
const base=loadFixedSource();
if(base.skip)test('actual function behavior needs explicit fixed source',{skip:base.skip},()=>{});
else {
  const modelSource=withFetchModelSource(base,source);
  test('new-file body is byte-equal to existing whole-response patch replay, not a simplified port',()=>{
    const oldPatch=fs.readFileSync(new URL('../engine/wechat-http-whole-response.patch',import.meta.url));
    const replay=replayUnifiedPatch(oldPatch,p=>{assert.equal(p,'platform/web/js/libs/library_godot_fetch.js');return base.texts['library_godot_fetch.js'];});
    assert.equal(body,replay.values().next().value.text);
  });
  const bytes=(...data)=>new Uint8Array(data).buffer;
  for(const host of [false,true]) {
    const label=host?'existing host wrapper':'library alone';
    test(label+': exact view request bytes and no optional listener dependency',()=>{
      const m=createFetchModel(modelSource,{host,missingChunk:true,missingHeaders:true}),backing=bytes(9,0,255,8);
      m.create(new DataView(backing,1,2));new Uint8Array(backing).fill(4);
      assert(m.requests[0].options.data instanceof ArrayBuffer);assert.deepEqual([...new Uint8Array(m.requests[0].options.data)],[0,255]);
      assert.equal(m.requests[0].options.enableChunked,false);assert.equal(m.requests[0].options.dataType,'text');assert.equal(m.requests[0].options.responseType,'arraybuffer');
      assert.equal(m.requests[0].headerRegistrations,0);assert.equal(m.requests[0].chunkRegistrations,0);
    });
    test(label+': empty body remains BODY until zero chunk read; partial binary reads preserve bytes',()=>{
      for(const data of [bytes(),bytes(0,127,128,255)]) {
        const m=createFetchModel(modelSource,{host}),id=m.create();m.success(0,{data,statusCode:200,header:{X:'model'}});
        assert.equal(m.api.godot_js_fetch_state_get(id),1);assert.equal(m.ids.get(id).chunks.length,1);
        const read=[...m.read(id,2),...m.read(id,2)];assert.deepEqual(read,[...new Uint8Array(data)]);assert.equal(m.api.godot_js_fetch_state_get(id),2);
      }
    });
    test(label+': fail wins late success and missing response bytes are not fabricated',()=>{
      const m=createFetchModel(modelSource,{host}),id=m.create();m.fail(0,{errno:51,errMsg:'PRIVATE_SENTINEL'});
      m.success(0,{data:bytes(1),statusCode:200,header:{X:'model'}});assert.equal(m.api.godot_js_fetch_state_get(id),-1);assert.equal(m.ids.get(id).error.kind,'REQUEST_FAILED');
      assert(!JSON.stringify(m.errors).includes('PRIVATE_SENTINEL'));
      const n=createFetchModel(modelSource,{host}),other=n.create();n.success(0,{statusCode:204,header:{}});
      assert.equal(n.api.godot_js_fetch_state_get(other),-1);assert.equal(n.ids.get(other).response,null);
    });
    test(label+': abort removes identity before callbacks and failure/logger exceptions do not resurrect it',()=>{
      const m=createFetchModel(modelSource,{host,abortThrows:true,loggerThrows:true,abortHook:entry=>entry.options.success({data:bytes(1),statusCode:200,header:{X:'model'}})}),id=m.create();
      assert.doesNotThrow(()=>m.api.godot_js_fetch_free(id));assert.equal(m.ids.get(id),undefined);assert.equal(m.requests[0].aborts,1);
      assert.doesNotThrow(()=>m.fail(0,{errMsg:'PRIVATE_SENTINEL'}));assert(!JSON.stringify(m.errors).includes('PRIVATE_SENTINEL'));
    });
  }
}
