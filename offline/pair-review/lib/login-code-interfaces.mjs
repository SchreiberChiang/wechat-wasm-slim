// Optional source composition. No writes, platform calls or default-bundle change.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker=Buffer.from('/* WXSLIM_LOGIN_CODE_INTERFACES_V1 */');
export const LOGIN_CODE_RUNTIME_SOURCE='convert/assets/login-code-runtime.js';
// Always start from the original interface input, including when disabling the
// option. Reusing an already composed output must not silently keep old code.
export function prepareLoginCodeInterfaces(baseInterfaces,enabled=false){
  assert(Buffer.isBuffer(baseInterfaces),'LOGIN_BASE_INTERFACES_BUFFER');
  assert(typeof enabled==='boolean','LOGIN_OPTION_BOOLEAN');
  assert(!baseInterfaces.includes(marker),'LOGIN_ALREADY_COMPOSED');
  if(!enabled)return {source:baseInterfaces,receipt:null};
  const {source,...receipt}=renderLoginCodeInterfaces({baseInterfaces});
  return {source,receipt};
}
export function auditLoginCodeInterfaces(source,receipt=null){
  assert(Buffer.isBuffer(source),'LOGIN_OUTPUT_BUFFER');
  if(receipt===null){assert(!source.includes(marker),'LOGIN_UNEXPECTED_ADAPTER');return null;}
  const length=receipt?.inputs?.baseInterfaces?.bytes;
  assert(Number.isSafeInteger(length)&&length>=0&&length<=512*1024&&length<source.length,'LOGIN_BASE_LENGTH');
  const expected=prepareLoginCodeInterfaces(source.subarray(0,length),true);
  assert.deepEqual(receipt,expected.receipt,'LOGIN_RECEIPT_MISMATCH');
  assert(source.equals(expected.source),'LOGIN_OUTPUT_MISMATCH');
  return expected.receipt;
}
export function renderLoginCodeInterfaces({baseInterfaces=Buffer.alloc(0)}={}){
  assert(Buffer.isBuffer(baseInterfaces)&&baseInterfaces.length<=512*1024,'LOGIN_BASE_INTERFACES_BOUND');
  assert(Buffer.from(baseInterfaces.toString('utf8')).equals(baseInterfaces),'LOGIN_BASE_INTERFACES_UTF8');
  assert(!baseInterfaces.includes(marker),'LOGIN_ALREADY_COMPOSED');
  const runtime=fs.readFileSync(new URL('../convert/assets/login-code-runtime.js',import.meta.url));
  const installer=`\n/* WXSLIM_LOGIN_CODE_INTERFACES_V1 */\n(function(root){'use strict';
 var roots=[root,root.window,typeof globalThis!=='undefined'?globalThis:null,typeof window!=='undefined'?window:null],targets=[];
 roots.forEach(function(r){if(!r||targets.indexOf(r)>=0)return;if((typeof r!=='object'&&typeof r!=='function')||!Object.isExtensible(r)||('WxslimLoginCode' in r))throw Error('LOGIN_INTERFACE_COLLISION');targets.push(r);});
 var create=(function(){var module={exports:{}};\n${runtime.toString('utf8')}\nreturn module.exports;}());
 var api=create({wx:typeof wx!=='undefined'?wx:root.wx});
 targets.forEach(function(r){Object.defineProperty(r,'WxslimLoginCode',{value:api,writable:false,configurable:false,enumerable:false});});
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`;
  const source=Buffer.concat([baseInterfaces,Buffer.from(installer)]);
  return {schema:'wxslim-login-code-interfaces-v1',source,bytes:source.length,sha256:sha(source),
    inputs:{baseInterfaces:{bytes:baseInterfaces.length,sha256:sha(baseInterfaces)},runtime:{bytes:runtime.length,sha256:sha(runtime)}},
    adapter:{startupLogin:false,backendLogin:false,credentialPersistence:false},
    baseInterfacesEffects:'CALLER_SOURCE_NOT_EXECUTED_OR_AUDITED',validated:'SOURCE_ONLY',
    limitations:['Caller must opt in and keep code out of logs','Local abandonment does not abort wx.login',
      'Base interfaces execute before installation; unexpected install failure has no rollback guarantee','No candidate or device acceptance is inherited']};
}
