import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {buildCloudInterfaces} from '../examples/glx-smoke/cloud-interfaces.mjs';
test('explicit cloud diagnostic relay filters unrelated logs, preserves console, flushes and stops',()=>{
  const relay=fs.readFileSync(new URL('../split/assets/phone-log.js',import.meta.url),'utf8');
  let interval, stopped=false; const timers=[],calls=[],printed=[];
  const original=(...args)=>printed.push(args),consoleMock={log:original,info:original,warn:original,error:original,debug:original};
  const wx={getSystemInfoSync:()=>({platform:'ios',model:'test'}),cloud:{init(config){assert.equal(config.traceUser,false);},callFunction(request){calls.push(request.data);request.success({result:{ok:true}});}}};
  const context={wx,console:consoleMock,GameGlobal:{},setInterval(fn){interval=fn;return 1;},clearInterval(){stopped=true;},setTimeout(fn,ms){timers.push({fn,ms});}};
  vm.runInNewContext(buildCloudInterfaces({env:'test-env',build:'unique-probe'},relay,'GameGlobal.interfacePreserved=true;'),context);
  consoleMock.error('PRIVATE_UNRELATED_ERROR');consoleMock.warn('[WXSLIM_FRAME_PROBE] {"sampleNumber":1}');
  consoleMock.warn('[WXSLIM_RENDER_SUMMARY] {"initialization":"initialized"}');consoleMock.log('[WXSLIM_BOOT] MAIN_RETURNED');
  consoleMock.warn('[WXSLIM_PRESENTATION] {"sampleNumber":1}');
  consoleMock.warn('[WXSLIM_CANVAS_EXPORT] {"result":"png_1x1_received"}');
  interval();assert.equal(calls.length,1);const messages=calls[0].entries.map(e=>e.message);
  assert.equal(messages.length,6);assert.ok(messages.some(m=>m.startsWith('PHONE_LOG_START ')));assert.ok(messages.some(m=>m.startsWith('[WXSLIM_CANVAS_EXPORT] ')));assert.ok(!JSON.stringify(calls).includes('PRIVATE_UNRELATED'));
  assert.ok(printed.some(args=>args[0]==='PRIVATE_UNRELATED_ERROR'));assert.equal(context.GameGlobal.interfacePreserved,true);
  timers.find(t=>t.ms===60000).fn();assert.equal(stopped,true);assert.equal(consoleMock.warn,original);
});
test('cloud source requires explicit safe environment and build identities',()=>{
  assert.throws(()=>buildCloudInterfaces({env:'',build:'x'},'',''));
  assert.throws(()=>buildCloudInterfaces({env:'x',build:'x;bad'},'',''));
});
test('opt-in presentation loader observes the early mark even when cloud is unavailable',()=>{
  const relay=fs.readFileSync(new URL('../split/assets/phone-log.js',import.meta.url),'utf8');
  let calls=0,cleared=0;const mark=function(name){assert.equal(name,'loader_start_ok');calls++;return 19;};
  const root={__WXSLIM_TIMING__:{mark}};
  const context={wx:{},console:{warn(){}},GameGlobal:root,setTimeout(){return 1;},clearTimeout(){cleared++;}};
  vm.runInNewContext(buildCloudInterfaces({env:'test-env',build:'unique-probe',presentation:true},relay,"GameGlobal.result=GameGlobal.__WXSLIM_TIMING__.mark('loader_start_ok');"),context);
  assert.equal(calls,1);assert.equal(root.result,19);assert.equal(root.__WXSLIM_PRESENTATION_LOADER__.resolved,true);
  assert.equal(root.__WXSLIM_TIMING__.mark,mark);assert.equal(cleared,1);
});
