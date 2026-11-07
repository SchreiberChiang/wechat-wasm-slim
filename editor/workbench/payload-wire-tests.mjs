// In-memory argv transport models only. No JSON evaluation, files or processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePayloadArgument} from './payload-wire.mjs';
const PREFIX='wxslim-json64:';
const encode=text=>PREFIX+Buffer.from(text,'utf8').toString('base64');
const rejected=value=>assert.throws(()=>decodePayloadArgument(value),error=>{
  assert.equal(error.code,'LOCAL_PAYLOAD_WIRE_INVALID');assert.equal(error.message,'LOCAL_PAYLOAD_WIRE_INVALID');return true;
});

test('undefined and legacy raw strings return unchanged without JSON parsing or new legacy length restrictions',()=>{
  assert.equal(decodePayloadArgument(undefined),undefined);
  for(const value of ['', '{}', '{bad JSON', 'ordinary text', '"wxslim-json64:inside-json"', 'WXSLIM-json64:wrong-case', 'x'.repeat(17000)])assert.equal(decodePayloadArgument(value),value);
});

test('canonical UTF8 base64 restores Chinese paths, slashes, quotes and literal CR/LF exactly',()=>{
  const values=[
    'F:\\项目 中文\\配对引擎\\godot.js',
    'quote "double" and \'single\' with \\slashes\\',
    '第一行\n第二行\r\n第三行',
    JSON.stringify({project:'F:\\游戏\\项目 A',preset:'Web "测试"',output:'F:\\游戏\\新输出',allowImportWrites:true}),
    JSON.stringify({expected:JSON.stringify({schema:'wxslim-local-plugin-config-v1',requestFile:'C:\\用户\\导出 请求.json',taskRoot:'F:\\工程\\任务'},null,2)+'\n',selection:{requestFile:'C:\\用户\\配置.json',taskRoot:'',taskId:''}})
  ];
  for(const value of values)assert.equal(decodePayloadArgument(encode(value)),value);
});

test('decoder does not require or execute JSON and preserves valid empty, BOM and replacement-character text',()=>{
  for(const value of ['', 'not JSON at all', 'globalThis.secret()', '\uFEFF{"原文":true}', '\uFFFD', '中文😀'])assert.equal(decodePayloadArgument(encode(value)),value);
});

test('strict base64 rejects whitespace, alternate alphabets, missing/excess padding and nonzero unused bits',()=>{
  for(const encoded of ['A','AA','AAA','AAAAA','AA=','A===','====','AA===','AAAA=','AA==x','AA==\n',' AA==','AA== ','AA\t==','AA\r\n==','-_==','中文','*AAA','AB==','AAB='])rejected(PREFIX+encoded);
  for(const encoded of ['AA==','AAA=','AAAA','YQ==','YWI=','YWJj'])assert.equal(decodePayloadArgument(PREFIX+encoded),Buffer.from(encoded,'base64').toString('utf8'));
});

test('decoded byte limit accepts exactly 16384 bytes and rejects larger payloads before unbounded allocation',()=>{
  for(const value of ['a'.repeat(16384),'中'.repeat(5461)+'a'])assert.equal(Buffer.byteLength(decodePayloadArgument(encode(value)),'utf8'),16384);
  rejected(encode('a'.repeat(16385)));rejected(encode('中'.repeat(5461)+'aa'));rejected(PREFIX+'A'.repeat(30000));
});

test('invalid UTF8 is rejected rather than decoded using replacement characters',()=>{
  for(const bytes of [[0xff],[0xc0,0xaf],[0xe4,0xb8],[0x80],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xe2,0x28,0xa1]])rejected(PREFIX+Buffer.from(bytes).toString('base64'));
});

test('all type/transport failures use the same bounded constant error with no payload disclosure',()=>{
  for(const value of [null,0,false,{},[],Symbol('private'),PREFIX+'private-sensitive-content!'])rejected(value);
});
