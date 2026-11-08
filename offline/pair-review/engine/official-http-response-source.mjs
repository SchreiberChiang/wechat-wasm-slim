// Independent candidate only. Never writes or applies to an engine checkout.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
export const httpResponsePaths = ['platform/web/js/libs/library_wxslim_fetch.js', 'platform/web/http_client_web.cpp', 'platform/web/http_client_web.h'];
export const httpIdentity = data => ({bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex')});
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, 'Unique source edit required');
  return text.replace(before, after);
}
// This prepares exact reviewed deltas in memory; runtime uses the emitted patch.
export function prepareHttpResponseSources(input) {
  const output = new Map(input);
  const edit = (p, a, b) => output.set(p, once(output.get(p), a, b));
  const [js, cpp, header] = httpResponsePaths;
  edit(js, '        active: function (id, obj) {', `        // wx.request alone normalizes defaults, including explicitly written ones.
        // HTTPRequest has already discarded the explicit/implicit distinction.
        request_url: function (url) {
            return url.replace(/^(https?):\\/\\/((?:[^/?#@]*@)?(?:\\[[0-9A-Fa-f:.]+\\]|[^:/?#@]+)):(443|80)(?=[/?#]|$)/i,
                function (match, scheme, authority, port) {
                    return (scheme.toLowerCase() === 'https' && port === '443') ||
                            (scheme.toLowerCase() === 'http' && port === '80') ? scheme + '://' + authority : match;
                });
        },

        active: function (id, obj) {`);
  edit(js, '                    url: url,', '                    url: GodotFetch.request_url(url),');
  edit(cpp, '\tstatus = STATUS_REQUESTING;', '\tresponse_headers.clear();\n\tresponse_headers_available = false;\n\tpolled_response_code = 0;\n\tstatus = STATUS_REQUESTING;');
  edit(cpp, '\tpolled_response_code = 0;\n\tresponse_headers.resize(0);', '\tpolled_response_code = 0;\n\tresponse_headers_available = false;\n\tresponse_headers.resize(0);');
  edit(cpp, '\treturn response_headers.size() > 0;', '\treturn response_headers_available;');
  edit(cpp, '\tif (!response_headers.size()) {', '\tif (!response_headers_available) {');
  edit(cpp, '\tresponse_headers.clear();\n\treturn OK;', '\tresponse_headers.clear();\n\tresponse_headers_available = false;\n\treturn OK;');
  edit(cpp, '\t\t\tif (godot_js_fetch_read_headers(js_id, &_parse_headers, this)) {', '\t\t\tif ((js_state != GODOT_JS_FETCH_STATE_BODY && js_state != GODOT_JS_FETCH_STATE_DONE) ||\n\t\t\t\t\tpolled_response_code < 100 || polled_response_code > 599 ||\n\t\t\t\t\tgodot_js_fetch_read_headers(js_id, &_parse_headers, this)) {');
  edit(cpp, '\t\t\tstatus = STATUS_BODY;', '\t\t\tresponse_headers_available = true;\n\t\t\tstatus = STATUS_BODY;');
  const errorAssignment = 'status = STATUS_CONNECTION_ERROR;';
  assert.equal(output.get(cpp).split(errorAssignment).length, 5, 'Four pinned connection-error transitions');
  output.set(cpp, output.get(cpp).replace(/(^[\t ]*)status = STATUS_CONNECTION_ERROR;/gm,
    '$1response_headers_available = false;\n$1status = STATUS_CONNECTION_ERROR;'));
  edit(header, '\tVector<String> response_headers;', '\tVector<String> response_headers;\n\tbool response_headers_available = false;');
  return output;
}
export function auditHttpResponseSource(sourceRoot) {
  assert(typeof sourceRoot === 'string' && path.isAbsolute(sourceRoot), 'Explicit absolute c050 source required');
  const metadata = JSON.parse(fs.readFileSync(new URL('./official-http-response-source.json', import.meta.url), 'utf8'));
  const input = new Map();
  for (const pin of [...metadata.inputs, ...metadata.unchanged]) {
    const file = path.join(sourceRoot, pin.path), stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Regular pinned file required');
    const bytes = fs.readFileSync(file);
    assert.deepEqual(httpIdentity(bytes), {bytes: pin.bytes, sha256: pin.sha256}, 'Pinned source differs: ' + pin.path);
    assert(Buffer.from(bytes.toString('utf8')).equals(bytes), 'UTF-8 source required');
    input.set(pin.path, bytes.toString('utf8'));
  }
  const patch = fs.readFileSync(new URL('./official-http-response-source.patch', import.meta.url));
  assert.deepEqual(httpIdentity(patch), {bytes: metadata.patch.bytes, sha256: metadata.patch.sha256});
  const replay = replayUnifiedPatch(patch, p => { assert(httpResponsePaths.includes(p)); return input.get(p); });
  assert.deepEqual([...replay.keys()], httpResponsePaths);
  const expected = prepareHttpResponseSources(input);
  for (const pin of metadata.outputs) {
    assert.equal(replay.get(pin.path).text, expected.get(pin.path));
    assert.deepEqual(httpIdentity(replay.get(pin.path).text), {bytes: pin.bytes, sha256: pin.sha256});
  }
  assert(input.get('platform/web/SCsub').includes('"js/libs/library_wxslim_fetch.js" if env["use_wx_glx"] else "js/libs/library_godot_fetch.js"'));
  return {metadata, input, output: new Map([...replay].map(([p, v]) => [p, v.text])), patch};
}
