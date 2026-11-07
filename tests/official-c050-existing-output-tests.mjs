// Read-only audit of an explicitly supplied retained real converter output.
// No output writes, converter invocation, engine evaluation or WASM execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {sha} from '../convert/lib/inputs.mjs';
import {prepareOfficialRawPostprocess} from '../engine/official-raw-postprocess.mjs';
import {prepareOfficialC050Adapter,inspectOfficialC050AdapterOutput,OFFICIAL_C050_PROFILE} from '../convert/lib/official-c050-adapter.mjs';
import {renderStorageBridge} from '../convert/lib/storage-adapter.mjs';
import {converterStackTraceHelper} from './official-c050-framework-model.mjs';

const capture=process.env.OFFICIAL_CAPTURE_RAW_DIR,existing=process.env.WXSLIM_C050_EXISTING_FRAMEWORK;
assert(capture&&path.isAbsolute(capture)&&existing&&path.isAbsolute(existing),'Explicit existing raw and converter output required; no fixture fallback');
const rawPath=path.join(capture,'godot.raw.js'),wasmPath=path.join(capture,'godot.wasm');
const raw=fs.readFileSync(rawPath),wasm=fs.readFileSync(wasmPath),framework=fs.readFileSync(existing);
assert.equal(sha(framework),'19b61328740c90e9e45e7b8ee5483763768881425afd721584baedc59b98bbbe','Retained first real c050 converter output');
const js=prepareOfficialRawPostprocess({js:raw,wasm}).js;
const adapter=prepareOfficialC050Adapter({profile:OFFICIAL_C050_PROFILE,js,wasm});
const bridge=renderStorageBridge(adapter.bridge.toString('utf8'),'webgl','en');
const audit=bytes=>inspectOfficialC050AdapterOutput(bytes,adapter,{bridge});
const oldTitle='function _godot_js_display_window_title_set(p_data){document.title=GodotRuntime.parseString(p_data)}';
const oldIcon="function _godot_js_display_window_icon_set(p_ptr,p_len){let link=document.getElementById(\"-gd-engine-icon\");const old_icon=GodotDisplay.window_icon;if(p_ptr){if(link===null){link=document.createElement(\"link\");link.rel=\"icon\";link.id=\"-gd-engine-icon\";document.head.appendChild(link)}const png=new Blob([GodotRuntime.heapSlice(HEAPU8,p_ptr,p_len)],{type:\"image/png\"});GodotDisplay.window_icon=URL.createObjectURL(png);link.href=GodotDisplay.window_icon}else{if(link){link.remove()}GodotDisplay.window_icon=null}if(old_icon){URL.revokeObjectURL(old_icon)}}";
const newIcon="function _godot_js_display_window_icon_set(p_ptr,p_len){}";
assert.equal(framework.toString().split(oldIcon).length,2);
const newTitle='function _godot_js_display_window_title_set(p_data){}';
assert.equal(framework.toString().split(oldTitle).length,2);
// Historical bytes are never changed. This projection is an in-memory test,
// not a new real converter result or evidence of runtime acceptance.
const projected=Buffer.from(framework.toString().replace(oldTitle,newTitle).replace(oldIcon,newIcon));

test('historical five-rule output rejects v3; title/icon-only memory projection passes the component audit',()=>{
  const originalModule=WebAssembly.Module,originalInstantiate=WebAssembly.instantiate;
  try {
    WebAssembly.Module=()=>{throw Error('NO_WASM_COMPILATION');};
    WebAssembly.instantiate=()=>{throw Error('NO_WASM_EXECUTION');};
    assert.equal(framework.toString('utf8').split(converterStackTraceHelper).length,2,'Model now includes the exact observed helper');
    assert.throws(()=>audit(framework),/C050_TITLE_NOOP/);
    assert.throws(()=>audit(Buffer.from(framework.toString().replace(oldTitle,newTitle))),/C050_ICON_NOOP/);
    const result=audit(projected);
    assert.equal(result.status,'PASS_STATIC_ONLY');assert.equal(result.hostBridgeExact,true);
    assert.equal(result.sevenRulesPreserved,true);assert.equal(result.windowTitleNoop,true);assert.equal(result.randomBindingsPreserved,true);
    assert.equal(result.windowIconNoop,true);
    assert.equal(result.executed,false);assert.equal(result.admission,'NOT_ADMITTED');
  } finally {WebAssembly.Module=originalModule;WebAssembly.instantiate=originalInstantiate;}
});

test('mutations of the memory projection helper, binding, active bridge and early exit remain rejected',()=>{
  const text=projected.toString('utf8'),helper=converterStackTraceHelper;
  const candidates=[
    text.replace(helper,helper.replace('var error =','var error  =')),
    text.replace(helper,helper+'\n'+helper),
    text.replace(helper,helper+'\nfunction unrelated(){return 0;}'),
    text.replace(helper,'if(false){'+helper+'}'),
    text.replace(helper,helper+'\nvar jsStackTrace=0;'),
    text.replace(helper,helper+'\n(()=>{jsStackTrace=function(){return "replaced";};})();'),
    text.replace('var Godot =','return commFrameWork.ready;\nvar Godot ='),
    text.replace('var Godot =','throw Error("early");\nvar Godot ='),
    text.replace(bridge,'function neverStart(){'+bridge+'}'),
    text.replace(bridge,'if(false){'+bridge+'}'),
    text.replace(bridge,'return commFrameWork.ready;\n'+bridge),
  ];
  for(const candidate of candidates){assert.notEqual(candidate,text);assert.throws(()=>audit(Buffer.from(candidate)));}
});

test('original raw pair and actual retained output are unchanged after inspection',()=>{
  assert(raw.equals(fs.readFileSync(rawPath)));assert(wasm.equals(fs.readFileSync(wasmPath)));
  assert(framework.equals(fs.readFileSync(existing)));
});
