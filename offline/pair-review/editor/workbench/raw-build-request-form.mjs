// Local form -> common raw request. No filesystem, preflight or build action.
import path from 'node:path';
import assert from 'node:assert/strict';
import {normalizeOfficialRawBuildRequest} from '../../engine/official-build-preflight.mjs';
import {OFFICIAL_BASE_RAW_REQUEST,OFFICIAL_CAPABILITY_RAW_REQUEST,OFFICIAL_CUSTOM_RAW_REQUEST,officialRawSourceRecipe} from '../../engine/official-raw-source-recipe.mjs';
export const RAW_BUILD_FORM_RECIPES=Object.freeze([
  Object.freeze({id:officialRawSourceRecipe(OFFICIAL_CAPABILITY_RAW_REQUEST).id,schema:OFFICIAL_CAPABILITY_RAW_REQUEST}),
  Object.freeze({id:officialRawSourceRecipe(OFFICIAL_BASE_RAW_REQUEST).id,schema:OFFICIAL_BASE_RAW_REQUEST})
]);
const fields=['sourceRecipe','profile','work','sdk','python','library','sconsWheel','sdkArchive','gitExecutable','upstreamSource','jobs','budgetBytes'];
function exact(value,keys,label){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype,label);
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort(),label);
  for(const k of keys)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'),label);
}
export function buildRawBuildRequestDraft(payload,files){
  assert.equal(arguments.length,2);
  const custom = Object.getOwnPropertyDescriptor(payload ?? {},'profile')?.value === 'custom';
  exact(payload,custom?[...fields,'features']:fields,'LOCAL_RAW_FORM_FIELDS');exact(files,['configFile','requestFile'],'LOCAL_RAW_FORM_DESTINATIONS');
  for(const name of ['configFile','requestFile'])assert(typeof files[name]==='string'&&files[name]===files[name].trim()&&path.isAbsolute(files[name])&&!/[\0\r\n]/.test(files[name]),'LOCAL_RAW_FORM_PATH');
  const {sourceRecipe,...values}=payload,selected=RAW_BUILD_FORM_RECIPES.find(p=>p.id===sourceRecipe);
  assert(selected,'LOCAL_RAW_FORM_RECIPE');
  if (custom) assert.equal(selected.schema,OFFICIAL_CAPABILITY_RAW_REQUEST,'LOCAL_RAW_CUSTOM_CAPABILITY_RECIPE_REQUIRED');
  const config=normalizeOfficialRawBuildRequest({schema:custom?OFFICIAL_CUSTOM_RAW_REQUEST:selected.schema,...values});
  const request={schema:'wxslim-task-request-v1',action:'official-raw-engine-build',configFile:files.configFile,purpose:'development-test',scope:{}};
  return {config,request,configText:JSON.stringify(config,null,2)+'\n',requestText:JSON.stringify(request,null,2)+'\n'};
}
