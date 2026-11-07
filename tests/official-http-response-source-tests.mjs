// Offline only. Actual candidate JS, modeled wx/heap. C++ checks are textual.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {auditHttpResponseSource, prepareHttpResponseSources, httpResponsePaths, httpIdentity} from '../engine/official-http-response-source.mjs';
import {replayUnifiedPatch} from '../engine/fixed-source-audit.mjs';
import {withFetchModelSource, createFetchModel, fetchLibraryProperties} from './fixed-fetch-source-model.mjs';

// Explicit input is required, including in CI; missing identity is a failed gate.
const audit = auditHttpResponseSource(process.env.WXSLIM_C050_HTTP_SOURCE);
const [js, cpp, header] = httpResponsePaths;
const idMock = '{$IDHandler: {last: 0, map: new Map(), add: function(x) {var id=++this.last; this.map.set(id,x); return id;}, get: function(id) {return this.map.get(id);}, remove: function(id) {this.map.delete(id);}}}';
const host = fs.readFileSync(new URL('../convert/assets/wx-compat.js', import.meta.url), 'utf8');
const modelSource = withFetchModelSource({loaded: {'library_godot_os.js': idMock}, host}, audit.output.get(js));
const model = options => createFetchModel(modelSource, options);

test('pinned full-source replay equals only exact edits, ABI signatures unchanged', () => {
  assert.deepEqual([...audit.output.keys()], httpResponsePaths);
  const sigs = text => fetchLibraryProperties(text).filter(p => p.name.endsWith('__sig')).map(p => [p.name, p.code]);
  assert.deepEqual(sigs(audit.output.get(js)), sigs(audit.input.get(js)));
  assert.throws(() => replayUnifiedPatch(audit.patch, p => audit.output.get(p)));
  for (const p of httpResponsePaths) {
    const changed = new Map(audit.input); changed.set(p, '// drift\n' + changed.get(p));
    assert.throws(() => replayUnifiedPatch(audit.patch, name => changed.get(name)));
  }
  assert.throws(() => prepareHttpResponseSources(new Map([[js, 'unrelated']])));
  assert(audit.metadata.newJsAbi.length === 0 && audit.metadata.newExports.length === 0);
  new vm.Script(audit.output.get(js));
});

for (const useHost of [false, true]) {
  test(`actual wx.request URL option normalizes only scheme default ports; host=${useHost}`, () => {
    const m = model({host: useHost});
    const cases = [
      ['https://example.invalid:443/a?x=:443#part', 'https://example.invalid/a?x=:443#part'],
      ['http://example.invalid:80', 'http://example.invalid'],
      ['HTTPS://EXAMPLE.invalid:443/?x=1', 'HTTPS://EXAMPLE.invalid/?x=1'],
      ['https://[2001:db8::1]:443/a', 'https://[2001:db8::1]/a'],
      ['http://[::ffff:192.0.2.1]:80/#p', 'http://[::ffff:192.0.2.1]/#p'],
      ['https://user:synthetic@example.invalid:443/a', 'https://user:synthetic@example.invalid/a'],
      ['https://user%40x:synthetic@[::1]:443/?x=1#p', 'https://user%40x:synthetic@[::1]/?x=1#p'],
      ...['https://example.invalid/a:443', 'https://example.invalid:80/a', 'http://example.invalid:443/a',
        'https://example.invalid:8443/a', 'https://example.invalid:4430/a', 'https://example.invalid:0443/a',
        'https://example.invalid/?next=https://other.invalid:443/', 'wss://example.invalid:443/a',
        'https://[::1]:8443/a', 'https://example.invalid:443evil/a', 'https://example.invalid/a#x:443'] .map(x => [x, x]),
    ];
    for (const [input, expected] of cases) {
      const id = m.fetch.create('POST', input, {}, new Uint8Array([0, 128, 255]));
      assert.equal(m.requests.at(-1).options.url, expected);
      assert.deepEqual([...new Uint8Array(m.requests.at(-1).options.data)], [0, 128, 255]);
      m.fetch.free(id);
    }
  });
  test(`actual JS empty-header 204, 503, invalid/pending/failure and cleanup; host=${useHost}`, () => {
    for (const statusCode of [204, 503]) {
      const m = model({host: useHost}), id = m.create();
      assert.equal(m.api.godot_js_fetch_state_get(id), 0);
      assert.equal(m.api.godot_js_fetch_http_status_get(id), 0);
      m.success(0, {statusCode, header: {}, data: new ArrayBuffer(0)});
      assert.equal(m.api.godot_js_fetch_state_get(id), 1);
      assert.equal(m.api.godot_js_fetch_http_status_get(id), statusCode);
      let count = -1;
      assert.equal(m.api.godot_js_fetch_read_headers(id, (n) => {count = n;}, 0), 0);
      assert.equal(count, 0);
      assert.deepEqual(m.read(id), []);
      assert.equal(m.api.godot_js_fetch_state_get(id), 2);
      m.fetch.free(id); assert.equal(m.ids.get(id), undefined);
    }
    for (const statusCode of [0, 99, 600, NaN, '204']) {
      const m = model({host: useHost}), id = m.create();
      m.success(0, {statusCode, header: {}, data: new ArrayBuffer(0)});
      assert.equal(m.api.godot_js_fetch_state_get(id), -1);
      assert.equal(m.api.godot_js_fetch_http_status_get(id), 0);
    }
    for (const response of [{statusCode: 200, header: null, data: new ArrayBuffer(0)}, {statusCode: 204, header: {}}]) {
      const m = model({host: useHost}), id = m.create(); m.success(0, response);
      assert.equal(m.api.godot_js_fetch_state_get(id), -1);
    }
    const m = model({host: useHost}), id = m.create(); m.fail(0, {});
    m.success(0, {statusCode: 200, header: {}, data: new ArrayBuffer(0)});
    assert.equal(m.api.godot_js_fetch_state_get(id), -1);
    m.fetch.free(id);
    const next = m.create(); assert.notEqual(next, id);
    assert.equal(m.api.godot_js_fetch_state_get(next), 0);
    assert.equal(m.api.godot_js_fetch_http_status_get(next), 0);
  });
}

test('ordinary browser library stays byte-identical; selection remains conditional', () => {
  const browser = 'platform/web/js/libs/library_godot_fetch.js';
  assert.equal(httpIdentity(audit.input.get(browser)).sha256, '47a515b15a93650ce3d45dbbd906818ecec191e8f0a1a5cb19de59043166e74f');
  assert(!audit.output.has(browser));
  assert(!audit.input.get(browser).includes('request_url'));
  assert(!audit.output.has('platform/web/SCsub'));
  const actual = fetchLibraryProperties(audit.input.get(browser)).find(p => p.name === '$GodotFetch').code;
  const calls=[], ids=new Map();
  const context=vm.createContext({IDHandler:{add(o){ids.set(1,o);return 1;}}, fetch(url){calls.push(url);return {then(){return {catch(){}};}};}});
  vm.runInContext('var GodotFetch=(' + actual + ');',context);
  context.GodotFetch.create('GET','https://example.invalid:443/a',[],null);
  assert.deepEqual(calls,['https://example.invalid:443/a']);
});

test('C++ source contract only: one-shot empty headers, reset, valid status and poll failure ordering', () => {
  const source = audit.output.get(cpp), h = audit.output.get(header);
  const body = name => {const start=source.indexOf(name); assert(start>=0); return source.slice(start, source.indexOf('\n}',start)+2);};
  assert(h.includes('bool response_headers_available = false;'));
  assert(body('bool HTTPClientWeb::has_response()').includes('return response_headers_available;'));
  const get = body('Error HTTPClientWeb::get_response_headers(');
  assert(get.indexOf('if (!response_headers_available)') < get.indexOf('return ERR_INVALID_PARAMETER;'));
  assert(get.indexOf('response_headers.clear();') < get.indexOf('response_headers_available = false;'));
  assert(get.includes('return OK;'));
  for (const name of ['Error HTTPClientWeb::request(', 'void HTTPClientWeb::close()']) {
    const b = body(name); assert(b.includes('response_headers_available = false;')); assert(b.includes('polled_response_code = 0;'));
  }
  const poll=body('Error HTTPClientWeb::poll()'), set=poll.indexOf('response_headers_available = true;');
  assert.equal(source.split('response_headers_available = true;').length, 2);
  for (const guard of ['js_state == GODOT_JS_FETCH_STATE_REQUESTING', 'js_state == GODOT_JS_FETCH_STATE_ERROR',
    'js_state != GODOT_JS_FETCH_STATE_BODY && js_state != GODOT_JS_FETCH_STATE_DONE',
    'polled_response_code < 100 || polled_response_code > 599 ||', 'godot_js_fetch_read_headers(js_id, &_parse_headers, this)']) {
    assert(poll.indexOf(guard)>=0 && poll.indexOf(guard)<set);
  }
  assert(poll.slice(poll.indexOf('js_state == GODOT_JS_FETCH_STATE_ERROR'),set).includes('return ERR_CONNECTION_ERROR;'));
  assert(poll.slice(poll.indexOf('godot_js_fetch_read_headers'),set).includes('return ERR_CONNECTION_ERROR;'));
  assert.equal(source.match(/status = STATUS_CONNECTION_ERROR;/g).length, 4);
  assert.equal(source.match(/response_headers_available = false;\n\s*status = STATUS_CONNECTION_ERROR;/g).length, 4);
  // No compilation or emulation: these source assertions do not prove C++ behavior.
});
