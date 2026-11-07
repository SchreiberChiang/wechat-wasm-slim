// Source-only composition of the existing capability and resource installers.
// No candidate mutation, conversion, package download or engine execution.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {renderResourceInterfaces} from './resource-interfaces-bundle.mjs';
import {renderCombinedCapabilityInterfaces} from './combined-capability-fixture.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const serialize=value=>JSON.stringify(value).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}

export function renderCombinedResourceInterfaces({companion,...resourceInputs}){
  const resourceCloud=companion!=null&&Object.hasOwn(companion,'resourceCloud');
  need(companion&&Object.getPrototypeOf(companion)===Object.prototype&&Reflect.ownKeys(companion).length===(resourceCloud?3:2)&&
    Object.hasOwn(companion,'kind')&&Object.hasOwn(companion,'storageCloud')&&
    companion.kind==='combined-capabilities-storage-v1'&&(!resourceCloud||companion.resourceCloud===true),'COMBINED_RESOURCE_COMPANION');
  // Both compilers recheck their own exact inputs. Arbitrary companion JS is
  // never accepted; the assembly verifier regenerates this source itself.
  const resource=renderResourceInterfaces(resourceInputs);
  const capability=renderCombinedCapabilityInterfaces({storageCloud:companion.storageCloud});
  need(capability.storage.enabled===true,'COMBINED_RESOURCE_STORAGE_REQUIRED');
  const reserved=['SimpleGlxDelivery','WxslimCombinedCapabilityScope','UpstreamStorageObservation',
    'StorageValidationFlow','__WXSLIM_STORAGE_CLOUD__','__WXSLIM_RESOURCE_APP__',
    '__WXSLIM_RESOURCE_STARTUP__','__WXSLIM_RESOURCE_BRIDGE__','__WXSLIM_COMBINED_RESOURCE_SCOPE__'];
  if(resourceCloud)reserved.push('__WXSLIM_RESOURCE_LOG_FORWARDER__');
  const preflight=`(function(root){'use strict';
 function need(v,c){if(!v)throw Error(c);}
 function field(o,k){var d=o&&Object.getOwnPropertyDescriptor(o,k);need(d&&Object.prototype.hasOwnProperty.call(d,'value'),'COMBINED_RESOURCE_DATA_FIELD');return d.value;}
 var roots=[root,root.window,typeof globalThis!=='undefined'?globalThis:null,typeof window!=='undefined'?window:null];
 roots.forEach(function(r){if(!r)return;need((typeof r==='object'||typeof r==='function')&&Object.isExtensible(r),'COMBINED_RESOURCE_ROOT');
 ${serialize(reserved)}.forEach(function(k){need(!(k in r),'COMBINED_RESOURCE_COLLISION');});});
 var c=field(root,'__WXSLIM_RENDER_CONFIG__'),pins=${serialize(resource.pins)};
 need(field(c,'schema')==='wxslim-render-config-v1'&&field(c,'fallback')==='error','COMBINED_RESOURCE_RENDER_SCHEMA');
 need(/^wxslim-[0-9a-f]{20}$/.test(field(c,'packageVersion'))&&['glx','webgl'].indexOf(field(c,'requestedMode'))>=0,'COMBINED_RESOURCE_RENDER_IDENTITY');
 Object.keys(pins).forEach(function(k){need(field(c,k)===pins[k],'COMBINED_RESOURCE_RENDER_PIN');});
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`;
  const correlation=`(function(root){'use strict';
 var simple=root.SimpleGlxDelivery,resource=root.__WXSLIM_RESOURCE_APP__;
 var roots=[root,root.window,typeof globalThis!=='undefined'?globalThis:null,typeof window!=='undefined'?window:null],seen=[];
 var baselineSimple=JSON.parse(simple.getObservationIdentity()),baselineResource=resource.status();
 function read(){
   roots.forEach(function(r){if(r&&(r.SimpleGlxDelivery!==simple||r.__WXSLIM_RESOURCE_APP__!==resource))throw Error('COMBINED_RESOURCE_ALIAS_CHANGED');});
   var a=JSON.parse(simple.getObservationIdentity()),b=resource.status();
   if(a.ref!==baselineSimple.ref||a.packageId!==b.boot.packageId||b.boot.packageId!==baselineResource.boot.packageId||
      b.identity.engineSession!==baselineResource.identity.engineSession||b.boot.pckSha256!==${serialize(resource.pins.pckSha256)}||
      b.boot.wasmSha256!==${serialize(resource.pins.wasmSha256)})throw Error('COMBINED_RESOURCE_IDENTITY_CHANGED');
   return JSON.stringify({schema:'wxslim-combined-resource-scope-v1',packageId:a.packageId,simpleRef:a.ref,
     resourceIdentity:b.identity,requestedMode:a.requestedMode,actualMode:a.actualMode,sdkVersion:a.sdkVersion,
     resourceInstalled:b.installed===true,resourceClosed:b.closed===true,
     evidenceScope:'INSTALLED_JS_IDENTITIES_ONLY',nativeStateProof:false,sceneAssociation:'NOT_OBSERVED',visual:'NOT_VERIFIED'});
 }
 read();
 var api=Object.freeze({read:read});
 roots.forEach(function(r){if(!r||seen.indexOf(r)>=0)return;seen.push(r);Object.defineProperty(r,'__WXSLIM_COMBINED_RESOURCE_SCOPE__',{value:api,writable:false,configurable:false});});
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`;
  const logAsset=resourceCloud?fs.readFileSync(new URL('../convert/assets/resource-observation-forwarder.js',import.meta.url)):null;
  const forward=logAsset?`(function(root){'use strict';
 var install=(function(){var module={exports:{}};\n${logAsset.toString('utf8')}\nreturn module.exports;}());
 install({root:root,console:console,relay:root.__WXSLIM_STORAGE_CLOUD__,simple:root.SimpleGlxDelivery});
})(typeof GameGlobal!=='undefined'?GameGlobal:globalThis);\n`:'';
  const source=preflight+resource.source+'\n'+capability.source+'\n'+correlation+forward;
  need(Buffer.byteLength(source)<=512*1024,'COMBINED_RESOURCE_INTERFACES_BUDGET');
  return {...resource,schema:'wxslim-combined-resource-interfaces-v1',source,bytes:Buffer.byteLength(source),sha256:sha(source),
    generatorSha256:sha(fs.readFileSync(new URL('./combined-resource-interfaces.mjs',import.meta.url))),
    composition:{kind:companion.kind,resourceBundleSha256:resource.sha256,resourceGeneratorSha256:resource.generatorSha256,
      capabilityBundleSha256:capability.sha256,capabilityGeneratorSha256:capability.compositionGeneratorSha256,
      capabilityAssets:capability.assets,identity:'SEPARATE_SESSIONS_EXPLICIT_CORRELATION_SAME_PACKAGE_AND_ENGINE_PINS',
      scriptLanguage:'ES2022',startup:'NO_AUTO_DOWNLOAD_MOUNT_SCENE_LOAD_OR_STORAGE_CHECK',
      failurePolicy:'PRECHECK_KNOWN_COLLISIONS_AND_PINS_BEFORE_INSTALL; UNEXPECTED_INSTALL_FAILURE_ABORTS_STARTUP_NO_ROLLBACK_CLAIM',
      ...(logAsset?{resourceCloud:{enabled:true,sourceSha256:sha(logAsset),maxForwardAttempts:24,sharedSessionLimit:128,
        sharedSessionMs:600000,existingServiceOnly:true,fullConsole:false,fullRawResult:false,
        evidence:'FIXTURE_REPORTED_VALUES_NOT_NEW_NATIVE_OR_GPU_QUERIES',phone:'NOT_RUN'}}:{})},
    limitations:[...resource.limitations,'Composition does not prove root-resident UI/receiver placement, rendering or native scene changes']};
}
