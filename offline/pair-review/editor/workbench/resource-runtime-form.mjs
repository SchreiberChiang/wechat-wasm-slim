// Local forms for the existing shared tasks. No executor, conversion or writes.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeResourceConfig} from '../../lib/resource-pack-plan.mjs';
import {readStableResourceFile} from './resource-form-io.mjs';

const MiB=1024*1024;
const need=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const absolute=v=>typeof v==='string'&&v!==''&&v.trim()===v&&!/[\u0000-\u001f\u007f-\u009f]/.test(v)&&path.isAbsolute(v);
const hash=b=>createHash('sha256').update(b).digest('hex');
export const RESOURCE_RUNTIME_FORMS=Object.freeze({
  install:Object.freeze({action:'resource-project-install',fields:['projectFile','output','budgetBytes','allowProjectWrites'],paths:['projectFile','output'],maxMiB:8}),
  interfaces:Object.freeze({action:'resource-interfaces-prepare',fields:['resourceConfigFile','js','wasm','output','budgetBytes'],paths:['resourceConfigFile','js','wasm','output'],maxMiB:8}),
  assembly:Object.freeze({action:'resource-runtime-assemble',fields:['resourceConfigFile','officialConfigFile','convertedOutput','output','budgetBytes'],paths:['resourceConfigFile','officialConfigFile','convertedOutput','output'],maxMiB:384})
});

// readFile is an adapter-owned dependency, never an option accepted from UI.
export function buildResourceRuntimeDraft(kind,payload,files,{readFile=readStableResourceFile}={}){
  const spec=Object.hasOwn(RESOURCE_RUNTIME_FORMS,kind)?RESOURCE_RUNTIME_FORMS[kind]:null;
  need(spec&&exact(payload,spec.fields),'LOCAL_RESOURCE_RUNTIME_FIELDS');
  need(exact(files,['configFile','requestFile'])&&Object.values(files).every(absolute),'LOCAL_RESOURCE_RUNTIME_DESTINATIONS');
  need(spec.paths.every(k=>absolute(payload[k])),'LOCAL_RESOURCE_RUNTIME_PATH');
  need(Number.isSafeInteger(payload.budgetBytes)&&payload.budgetBytes>=4*MiB&&payload.budgetBytes<=spec.maxMiB*MiB,'LOCAL_RESOURCE_RUNTIME_BUDGET');
  let config;
  if(kind==='install'){
    need(payload.allowProjectWrites===true,'LOCAL_RESOURCE_INSTALL_WRITE_ACK');
    config={schema:'wxslim-resource-project-install-v1',...payload};
  }else if(kind==='interfaces'){
    // Use actual selected files, not user-supplied hashes or an old engine name.
    const resourceBytes=readFile(payload.resourceConfigFile,MiB);
    const resources=normalizeResourceConfig(JSON.parse(resourceBytes),path.dirname(payload.resourceConfigFile));
    need(resources.packs.some(p=>p.role==='resource'),'LOCAL_RESOURCE_RUNTIME_PACKS_REQUIRED');
    const js=readFile(payload.js,256*MiB),wasm=readFile(payload.wasm,256*MiB);
    need(Buffer.isBuffer(js)&&Buffer.isBuffer(wasm)&&js.length>0&&wasm.length>0,'LOCAL_RESOURCE_RUNTIME_ENGINE_BYTES');
    config={schema:'wxslim-resource-interfaces-task-v1',resourceConfigFile:payload.resourceConfigFile,
      engine:{js:payload.js,wasm:payload.wasm,expected:{engineJsSha256:hash(js),wasmSha256:hash(wasm)}},output:payload.output,budgetBytes:payload.budgetBytes};
  }else{
    config={schema:'wxslim-resource-assembly-task-v1',officialConfigFile:payload.officialConfigFile,
      resourceConfigFile:payload.resourceConfigFile,convertedOutput:payload.convertedOutput,output:payload.output,budgetBytes:payload.budgetBytes};
  }
  const request={schema:'wxslim-task-request-v1',action:spec.action,configFile:files.configFile,purpose:'development-test',scope:{}};
  const configText=JSON.stringify(config,null,2)+'\n',requestText=JSON.stringify(request,null,2)+'\n';
  need(Buffer.byteLength(configText)+Buffer.byteLength(requestText)<=32768,'LOCAL_RESOURCE_RUNTIME_DOCUMENT_LIMIT');
  return {config,request,configText,requestText};
}

// Prefill only from the completed shared plan, never a stale form selection.
export function resourceRuntimeNextInputs(common){
  need(common?.schema==='wxslim-task-plan-v1'&&common.action==='resource-interfaces-prepare'&&common.executionAuthorized===false,'LOCAL_RESOURCE_RUNTIME_PLAN');
  if(common.eligible!==true)return null;
  const plan=common.plan,input=plan?.input,boot=plan?.inputs?.filter(p=>p.role==='boot');
  need(plan?.schema==='wxslim-resource-interfaces-task-plan-v1'&&boot?.length===1&&
    [input?.engine?.js,input?.engine?.wasm,input?.resourceConfigFile,input?.output,boot[0].file].every(absolute)&&
    plan.outputs?.length===1&&plan.outputs[0].path==='interfaces.js','LOCAL_RESOURCE_RUNTIME_PLAN');
  return {js:input.engine.js,wasm:input.engine.wasm,pck:boot[0].file,interfaces:path.join(input.output,'interfaces.js'),
    resourceConfigFile:input.resourceConfigFile,state:'SUGGESTED_PATHS_ONLY_EXECUTION_NOT_PERFORMED'};
}
