// Pure source derivation: explicit pinned buffers in, candidate buffer out.
// No filesystem writes, platform calls, engine execution, or recipe registration.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {replayUnifiedPatch} from './fixed-source-audit.mjs';
export const IME_SESSION_FILE = 'platform/web/js/libs/library_godot_input.js';
export const IME_SESSION_PINS = Object.freeze({
  input: Object.freeze({bytes:29238,sha256:'105a1fb250fbdde6d1ee98d91325de5464f88cb6462684a7c7f7d050acc99a65'}),
  patch: Object.freeze({bytes:11437,sha256:'b8265150c9f620a149933659971726a55ee26774ff5e3962db03b83cc46b1ec0'}),
  output: Object.freeze({bytes:30921,sha256:'1b6270ef5f78c818917db5022224793625a9af1d7014ba36471f1d9e36f27b80'}),
});
export const imeSessionIdentity = bytes => ({bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')});
let parser;
export function extractImeSessionObject(text, member = '$GodotIMEWechat') {
  if (!parser) {
    const module={exports:{}};
    vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module,exports:module.exports});
    parser=module.exports;
  }
  const ast=parser.parse(text,{ecmaVersion:2022});
  const libraries=ast.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]).filter(n=>n.id?.name==='GodotIME');
  assert.equal(libraries.length,1,'IME_SESSION_UNIQUE_LIBRARY');
  assert.equal(libraries[0].init.type,'ObjectExpression');
  const members=libraries[0].init.properties.filter(n=>(n.key.name??n.key.value)===member);
  assert.equal(members.length,1,'IME_SESSION_UNIQUE_MEMBER');
  const value=members[0].value;assert.equal(value.type,'ObjectExpression');
  return {text:text.slice(value.start,value.end),start:value.start,end:value.end};
}
export function prepareOfficialImeSessionSource(source, patch) {
  assert(Buffer.isBuffer(source)&&Buffer.isBuffer(patch),'IME_SESSION_BUFFER_INPUTS');
  assert.deepEqual(imeSessionIdentity(source),IME_SESSION_PINS.input,'IME_SESSION_FIXED_SOURCE');
  assert.deepEqual(imeSessionIdentity(patch),IME_SESSION_PINS.patch,'IME_SESSION_FIXED_PATCH');
  const before=source.toString('utf8');assert(Buffer.from(before).equals(source),'IME_SESSION_UTF8');
  const replay=replayUnifiedPatch(patch,name=>{assert.equal(name,IME_SESSION_FILE);return source;});
  assert.deepEqual([...replay.keys()],[IME_SESSION_FILE]);
  const after=replay.get(IME_SESSION_FILE).text;
  const old=extractImeSessionObject(before),next=extractImeSessionObject(after);
  assert.equal(before.slice(0,old.start),after.slice(0,next.start),'IME_SESSION_PREFIX_UNCHANGED');
  assert.equal(before.slice(old.end),after.slice(next.end),'IME_SESSION_SUFFIX_UNCHANGED');
  const result=Buffer.from(after);
  assert.deepEqual(imeSessionIdentity(result),IME_SESSION_PINS.output,'IME_SESSION_OUTPUT_PIN');
  return result;
}
