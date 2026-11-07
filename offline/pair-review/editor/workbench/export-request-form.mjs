// Pure local draft builder. No file inspection, writes, editor or task action.
// The shared project-pck-export plan remains the actual admission gate.
import path from 'node:path';

const MiB=1024*1024;
const FIELDS=['project','preset','output','budgetBytes','cacheGrowthBudgetBytes','allowImportWrites'];
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
function exact(value,keys){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
function text(value){return typeof value==='string'&&value!==''&&value===value.trim()&&!/[\u0000\r\n]/.test(value);}
function absolute(value){return text(value)&&path.isAbsolute(value);}

export function buildExportRequestDraft(localConfig,payload,files){
  need(exact(payload,FIELDS),'LOCAL_EXPORT_FORM_FIELDS');
  need(exact(files,['configFile','requestFile']),'LOCAL_EXPORT_FORM_DESTINATIONS');
  need(absolute(files.configFile)&&absolute(files.requestFile),'LOCAL_EXPORT_FORM_PATH');
  need(absolute(localConfig?.editorExecutable)&&absolute(payload.project)&&absolute(payload.output),'LOCAL_EXPORT_FORM_PATH');
  need(text(payload.preset),'LOCAL_EXPORT_FORM_PRESET');
  need(payload.allowImportWrites===true,'PCK_EXPORT_IMPORT_WRITE_ACK');
  need(Number.isSafeInteger(payload.budgetBytes)&&payload.budgetBytes>=8*MiB&&payload.budgetBytes<=272*MiB&&
    Number.isSafeInteger(payload.cacheGrowthBudgetBytes)&&payload.cacheGrowthBudgetBytes>=0&&payload.cacheGrowthBudgetBytes<=2**32,'PCK_EXPORT_BUDGET');
  const config={schema:'wxslim-project-pck-export-v1',editor:localConfig.editorExecutable,
    project:payload.project,preset:payload.preset,output:payload.output,budgetBytes:payload.budgetBytes,
    cacheGrowthBudgetBytes:payload.cacheGrowthBudgetBytes,allowImportWrites:true};
  const request={schema:'wxslim-task-request-v1',action:'project-pck-export',configFile:files.configFile,purpose:'development-test',scope:{}};
  return {config,request,configText:JSON.stringify(config,null,2)+'\n',requestText:JSON.stringify(request,null,2)+'\n'};
}
