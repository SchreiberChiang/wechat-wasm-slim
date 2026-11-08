// Pure local request/config drafting only. The existing official task plan owns
// file, fixed-pair, transformer, PCK and output admission. No IO or new template.
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {inspectPck} from '../../lib/pck-inventory.mjs';
import {validateStartupPrewarmRequest} from '../../lib/startup-prewarm.mjs';
import {CUSTOM_PAIR_PROFILE as CUSTOM} from '../../lib/custom-pair-task.mjs';
import {checkCustomProjectUsage} from '../../convert/lib/custom-project-usage.mjs';
import {normalizeProjectUsage,OFFICIAL_C050_PROFILE as FULL,OFFICIAL_C050_CONSERVATIVE_PROFILE as TRIM,OFFICIAL_C050_CAPABILITY_PROFILE as CAPABILITY} from '../../convert/lib/official-engine-admission.mjs';

const FIELDS=['js','wasm','pck','transformer','interfaces','output','renderMode','name','locale','orientation'];
const PATHS=['js','wasm','pck','transformer','interfaces','output'];
export const OFFICIAL_FORM_MODULES=Object.freeze(['gltf','fbx','vhacd','webxr','mobile_vr','enet','upnp']);
export const OFFICIAL_FORM_PROFILES=Object.freeze([FULL,TRIM,CAPABILITY,CUSTOM]);
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
function exact(value,keys){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function nonempty(value){return typeof value==='string'&&value.trim()!=='';}
function absolute(value){return nonempty(value)&&value===value.trim()&&!/[\u0000\r\n]/.test(value)&&path.isAbsolute(value);}

export function validateOfficialFormPayload(payload){
  // Preserve previously saved full-form drafts. New UI always names its profile.
  let fields=payload;
  if(payload!==null&&typeof payload==='object'&&Object.hasOwn(payload,'skipDefault3dPrewarm')){
    validateStartupPrewarmRequest(payload.skipDefault3dPrewarm,payload.engineProfile??FULL);
    fields={...fields};delete fields.skipDefault3dPrewarm;
  }
  if(payload!==null&&typeof payload==='object'&&Object.hasOwn(payload,'loginCode')){
    need(typeof payload.loginCode==='boolean','LOCAL_OFFICIAL_FORM_LOGIN_BOOLEAN');
    fields={...fields};delete fields.loginCode;
  }
  if (Object.hasOwn(fields ?? {}, 'largePckBudget')) {
    need(typeof fields.largePckBudget === 'boolean','LOCAL_OFFICIAL_FORM_BUDGET_BOOLEAN');
    fields = {...fields};
    delete fields.largePckBudget;
  }
  const legacy=exact(fields,FIELDS);
  const custom=fields?.engineProfile===CUSTOM;
  need(legacy||exact(fields,[...FIELDS,'engineProfile','removedModules',...(custom?['customPreparation','projectUsage']:[])]),'LOCAL_OFFICIAL_FORM_FIELDS');
  const profile=legacy?FULL:payload.engineProfile;
  need(OFFICIAL_FORM_PROFILES.includes(profile),'LOCAL_OFFICIAL_FORM_PROFILE');
  if(custom){
    need(absolute(payload.customPreparation),'LOCAL_OFFICIAL_FORM_PREPARATION_PATH');
    need(payload.projectUsage?.removedFeaturesUnused===true,'LOCAL_OFFICIAL_FORM_CUSTOM_USAGE');
  }
  if(!legacy){
    if(profile!==TRIM)need(payload.removedModules===null,'LOCAL_OFFICIAL_FORM_FULL_USAGE');
    else{
      need(exact(payload.removedModules,OFFICIAL_FORM_MODULES),'LOCAL_OFFICIAL_FORM_USAGE_FIELDS');
      for(const key of OFFICIAL_FORM_MODULES)need(payload.removedModules[key]==='unused','LOCAL_OFFICIAL_FORM_MODULE_NOT_CONFIRMED');
    }
  }
  need(PATHS.every(key=>absolute(payload[key])),'LOCAL_OFFICIAL_FORM_PATH');
  need(['glx','webgl'].includes(payload.renderMode),'LOCAL_OFFICIAL_FORM_RENDER_MODE');
  need(['portrait','landscape'].includes(payload.orientation),'LOCAL_OFFICIAL_FORM_ORIENTATION');
  need(nonempty(payload.name)&&nonempty(payload.locale),'LOCAL_OFFICIAL_FORM_TEXT');
  return profile;
}

export function buildOfficialConvertRequestDraft(payload,files,pckSnapshot){
  const profile=validateOfficialFormPayload(payload);
  need(exact(files,['configFile','requestFile']),'LOCAL_OFFICIAL_FORM_DESTINATIONS');
  need(absolute(files.configFile)&&absolute(files.requestFile)&&PATHS.every(key=>absolute(payload[key])),'LOCAL_OFFICIAL_FORM_PATH');
  need(['glx','webgl'].includes(payload.renderMode),'LOCAL_OFFICIAL_FORM_RENDER_MODE');
  need(['portrait','landscape'].includes(payload.orientation),'LOCAL_OFFICIAL_FORM_ORIENTATION');
  // Match the public normalizer: no locale/name allowlist or whitespace rewrite.
  need(nonempty(payload.name)&&nonempty(payload.locale),'LOCAL_OFFICIAL_FORM_TEXT');
  const config={schema:'wxslim-official-inputs-v1',engineProfile:profile,
    ...Object.fromEntries(FIELDS.map(key=>[key,payload[key]]))};
  if(payload.largePckBudget===true)config.budgetBytes=144*1024*1024;
  if(payload.loginCode===true)config.loginCode=true;
  if(profile===TRIM||profile===CUSTOM){
    const norm=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
    need(exact(pckSnapshot,['sourcePath','pin','inventory','buffer'])&&absolute(pckSnapshot.sourcePath)&&norm(payload.pck)===norm(pckSnapshot.sourcePath)&&Buffer.isBuffer(pckSnapshot.buffer),'LOCAL_OFFICIAL_FORM_PCK_SNAPSHOT');
    const actual=inspectPck(pckSnapshot.buffer),pin={bytes:actual.bytes,sha256:actual.sha256};
    need(isDeepStrictEqual(pin,pckSnapshot.pin)&&isDeepStrictEqual(actual,pckSnapshot.inventory),'LOCAL_OFFICIAL_FORM_PCK_CHANGED');
    if(profile===CUSTOM){
      config.customPreparation=payload.customPreparation;
      config.projectUsage=checkCustomProjectUsage(payload.projectUsage.features,pckSnapshot.buffer,payload.projectUsage).declaration;
    }else config.projectUsage=normalizeProjectUsage({schema:'wxslim-project-usage-v1',pck:pin,removedModules:payload.removedModules},profile);
  }else need(pckSnapshot===undefined,'LOCAL_OFFICIAL_FORM_UNEXPECTED_SNAPSHOT');
  const request={schema:'wxslim-task-request-v1',action:'official-convert',configFile:files.configFile,purpose:'development-test',scope:{}};
  return {config,request,configText:JSON.stringify(config,null,2)+'\n',requestText:JSON.stringify(request,null,2)+'\n'};
}

// Only the adapter supplies the read function; it is never accepted via argv.
// The snapshot and its bytes stay local. Shared CLI plan rechecks actual pins.
export function prepareOfficialFormDraft(payload,files,{readInventory}={}){
  const profile=validateOfficialFormPayload(payload);
  let snapshot;
  if(profile===TRIM||profile===CUSTOM){need(typeof readInventory==='function','LOCAL_OFFICIAL_FORM_PCK_READER');snapshot=readInventory({sourcePath:payload.pck});}
  return buildOfficialConvertRequestDraft(payload,files,snapshot);
}
