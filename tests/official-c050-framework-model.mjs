// SOURCE MODEL ONLY. Mirrors the observed official converter's factory nesting;
// it is never evaluated, does not invoke a converter, and is not runtime proof.
import assert from 'node:assert/strict';
import {MODULE_TAIL} from '../convert/lib/inputs.mjs';
import {instrumentRender} from '../convert/lib/render.mjs';

// Exact observed converter prefix, kept separate from production's hash pin.
// Previously omitted from this model; that omission hid a real output rejection.
export const converterStackTraceHelper=[
  'function jsStackTrace() {',
  '            var error = new Error();',
  '            if (!error.stack) {',
  '                try {',
  '                    throw new Error();',
  '                } catch (e) {',
  '                    error = e;',
  '                }',
  '                if (!error.stack) {',
  '                    return "(no stack trace available)";',
  '                }',
  '            }',
  '            return error.stack.toString();',
  '        }',
].join('\n');

// Also observed in retained 1.0.35 output. Keep this independent of production
// expectations so the model cannot silently omit the converter's main callback.
export const originalCallMain='function callMain(args=[]){var entryFunction=_main;args.unshift(thisProgram);var argc=args.length;var argv=stackAlloc((argc+1)*4);var argv_ptr=argv;args.forEach(arg=>{HEAPU32[argv_ptr>>2]=stringToUTF8OnStack(arg);argv_ptr+=4});HEAPU32[argv_ptr>>2]=0;try{var ret=entryFunction(argc,argv);exitJS(ret,true);return ret}catch(e){return handleException(e)}}';
export const convertedCallMain=originalCallMain.slice(0,-1)+' finally {\r\nif (Module.calledMainCb) {Module.calledMainCb();}}\r\n}';

// The shared conversion-core model can pass its already bridged source here.
export function wrapOfficialFrameworkModel(bridgedSource) {
  assert.equal(typeof bridgedSource,'string');
  assert.equal(bridgedSource.split(originalCallMain).length,2,'model requires the observed original main function');
  bridgedSource=bridgedSource.replace(originalCallMain,convertedCallMain);
  return 'var commFrameWork = (() => {\n'+
    '  var _scriptDir = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : undefined;\n'+
    '  return function (commFrameWork) {\n'+
    '    commFrameWork = commFrameWork || {};\n'+
    '    console.log("unity framework", WXGameKit.gameInstance.Module);\n'+
    '    var Module = typeof commFrameWork != "undefined" ? commFrameWork : {};\n'+
    '    var readyPromiseResolve, readyPromiseReject;\n'+
    '    Module["ready"] = new Promise(function(resolve,reject){readyPromiseResolve=resolve;readyPromiseReject=reject;});\n'+
    '    '+converterStackTraceHelper+'\n'+
    '    Module["getPreloadedPackage"] = function(){return Module.rawData;};\n'+
    '    Module["preloadPlugins"] = [];\n'+
    '    var WXMGFS = Module.IsWxGame ? WXGameKit.gameInstance.IDBFS : {};\n'+
    bridgedSource+'\n'+
    '    return commFrameWork.ready;\n'+
    '  };\n'+
    '})();\n'+
    'if(typeof exports === "object" && typeof module === "object") module.exports=commFrameWork;\n'+
    'else if(typeof define === "function" && define["amd"]) define([],function(){return commFrameWork;});\n'+
    'else if(typeof exports === "object") exports["commFrameWork"]=commFrameWork;\n';
}

export function modelOfficialC050Framework({js,bridge}) {
  assert(Buffer.isBuffer(js)&&typeof bridge==='string');
  const source=instrumentRender(js.toString('utf8'));
  assert.equal(source.split(MODULE_TAIL).length,2,'model requires exact original module tail');
  return Buffer.from(wrapOfficialFrameworkModel(source.slice(0,source.indexOf(MODULE_TAIL))+'\n'+bridge));
}
