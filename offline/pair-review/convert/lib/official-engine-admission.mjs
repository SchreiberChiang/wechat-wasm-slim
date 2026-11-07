// Registered portable engine pairs only. No build audit, WASM instantiation or factory execution.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {sha, MODULE_TAIL} from './inputs.mjs';
import {instrumentRender} from './render.mjs';
import {checkReturnZero, readImportBindings} from './official-contract.mjs';
import linkage from '../../engine/official-glx-library/audit-linkage.cjs';
import {customConversionContext} from './official-custom-context.mjs';
import {CUSTOM_PAIR_PROFILE} from '../../lib/custom-pair-task.mjs';
import {checkCustomProjectUsage} from './custom-project-usage.mjs';

export const OFFICIAL_C050_PROFILE = 'full-official-c050-dev';
export const OFFICIAL_C050_CONSERVATIVE_PROFILE = 'conservative-official-c050-dev';
export const OFFICIAL_C050_CAPABILITY_PROFILE = 'full-official-c050-capability-dev';
export function isOfficialC050Profile(profile) {
  return profile===OFFICIAL_C050_PROFILE||profile===OFFICIAL_C050_CONSERVATIVE_PROFILE||profile===OFFICIAL_C050_CAPABILITY_PROFILE||
    (profile===CUSTOM_PAIR_PROFILE && customConversionContext()!==null);
}
export function isConservativeEngineProfile(profile) {
  return profile==='conservative'||profile===OFFICIAL_C050_CONSERVATIVE_PROFILE;
}
export function isDevelopmentEngineProfile(profile) {
  return profile === 'full-upstream-read-dev' || isOfficialC050Profile(profile);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const recipeFiles = Object.freeze({full:'../official-recipe.json', conservative:'../official-conservative-recipe.json',
  'full-upstream-read-dev':'../official-upstream-read-recipe.json',
  [OFFICIAL_C050_PROFILE]:'../official-c050-recipe.json',
  [OFFICIAL_C050_CONSERVATIVE_PROFILE]:'../official-c050-conservative-recipe.json',
  [OFFICIAL_C050_CAPABILITY_PROFILE]:'../official-c050-capability-recipe.json'});
const records = Object.freeze(Object.fromEntries(Object.entries(recipeFiles).map(([profile, file]) => {
  const bytes = fs.readFileSync(new URL(file, import.meta.url));
  const recipe = deepFreeze(JSON.parse(bytes));
  assert.equal(recipe.engine.profile, profile, 'registered recipe profile');
  return [profile, Object.freeze({recipe, identity:Object.freeze({recipeId:recipe.id, recipeSha256:sha(bytes)})})];
})));

function registered(profile) {
  if (profile===CUSTOM_PAIR_PROFILE && customConversionContext()) return customConversionContext().record;
  assert(typeof profile==='string'&&Object.hasOwn(recipeFiles,profile), 'only registered full or conservative profiles, or explicit registered development profiles');
  const record = records[profile];
  const current = fs.readFileSync(new URL(recipeFiles[profile], import.meta.url));
  assert.equal(sha(current), record.identity.recipeSha256, 'registered recipe bytes changed after module initialization');
  return record;
}
export const fixedRecipe = records.full.recipe;
export function getOfficialRecipe(profile = 'full') { return registered(profile).recipe; }
export function getRecipeIdentity(profile = 'full') { return registered(profile).identity; }
const bytesIdentity = value => ({bytes:value.length, sha256:sha(value)});

// Preserve the original full byte and static gates; conservative uses its own registered pins.
export function checkFixedPair(glue, wasm, profile = 'full') {
  const recipe = getOfficialRecipe(profile);
  assert.deepEqual(bytesIdentity(glue), recipe.engine.js, 'exact repaired return0 JS required');
  assert.deepEqual(bytesIdentity(wasm), recipe.engine.wasm, 'exact paired WASM required');
  const text = glue.toString('utf8'); checkReturnZero(text);
  assert.equal(text.split(MODULE_TAIL).length, 2, 'unique original module tail');
  assert(!/missing function:|unresolved symbol:/i.test(text), 'missing native function placeholder');
  new vm.Script(text, {filename:'fixed-input.js'});
  new vm.Script(instrumentRender(text), {filename:'fixed-observed.js'});
  // New development pair stays within a structural read-only source gate.
  // Preserve the older profiles' existing admission behavior exactly.
  let imports, exports;
  if (isOfficialC050Profile(profile)) {
    const binary = linkage.parseWasm(wasm);
    imports = binary.imports.map(item => ({module:item.module,name:item.name,kind:item.kind===0?'function':String(item.kind)}));
    exports = binary.exports.map(item => ({name:item.name,kind:item.kind===0?'function':String(item.kind)}));
  } else {
    const module = new WebAssembly.Module(wasm);
    imports = WebAssembly.Module.imports(module); exports = WebAssembly.Module.exports(module);
  }
  const bindings = readImportBindings(text), exported = new Set(exports.filter(e => e.kind === 'function').map(e => e.name));
  for (const item of imports) {
    assert.equal(item.module, 'a'); assert.equal(item.kind, 'function');
    assert(Object.hasOwn(bindings, item.name), 'missing JS import binding: ' + item.name);
  }
  for (const [name, expected] of Object.entries(recipe.engine.nativeMapping)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = [...text.matchAll(new RegExp('Module\\["' + escaped + '"\\]\\s*=\\s*' + escaped + '\\s*=\\s*wasmExports\\["([^"\\n]+)"\\]', 'g'))];
    assert.equal(found.length, 1, 'unique native mapping: ' + name);
    assert.equal(found[0][1], expected); assert(exported.has(expected));
  }
  assert(/registerAfterDoFrame\(function\(\)\{return Module\._glxCommandBufferFlush\(\);?\}\)/.test(text));
  assert(text.includes('Module.wxContextGlobal.batchRenderAsync(') && text.includes('Module.wxContextGlobal.swapWindow('));
  const customProvenance=recipe.validation==='FAILED_CUSTOM_RAW_RETAINED_BYTES_RECHECKED'
    ?'MATCHES_RETAINED_FAILED_CUSTOM_RAW_AND_PREPARATION':'MATCHES_COMPLETED_CUSTOM_RAW_AND_PREPARATION';
  return {schema:'wxslim-fixed-prebuilt-pair-v1', imports, exports, nativeMapping:recipe.engine.nativeMapping,
    jsImportBindings:Object.keys(bindings).length, pairing:'PASS_STATIC_ONLY', provenance:profile===CUSTOM_PAIR_PROFILE?customProvenance:isDevelopmentEngineProfile(profile)?'MATCHES_REGISTERED_DEVELOPMENT_INPUT_BYTES':'MATCHES_REGISTERED_RELEASE_BYTES', buildRecordReaudited:profile===CUSTOM_PAIR_PROFILE,
    profile, engineProfile:profile, ...getRecipeIdentity(profile),
    ...(isOfficialC050Profile(profile)?{admission:'NOT_ADMITTED',allowedPurposes:recipe.allowedPurposes,
      hostContract:'NOT_VERIFIED_BY_PAIR_CHECK',runtime:'NOT_RUN',phone:'NOT_RUN',
      wasmValidation:'STRUCTURAL_PARSE_ONLY_NOT_FULL_VALIDATION'}:{}),
    scope:'No synthetic BUILD; exact known bytes and static mappings only, no ABI/runtime/visual claim.'};
}

const removedModules = Object.freeze(['gltf', 'fbx', 'vhacd', 'webxr', 'mobile_vr', 'enet', 'upnp']);
function exactObject(value, keys, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  const prototype = Object.getPrototypeOf(value);
  assert(prototype === Object.prototype || prototype === null, label + ' must be a plain object');
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), label + ' requires exact keys');
}
function normalizePckPin(value) {
  exactObject(value, ['bytes', 'sha256'], 'PCK pin');
  assert(Number.isSafeInteger(value.bytes) && value.bytes > 0, 'PCK byte count must be a positive safe integer');
  assert(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256), 'PCK SHA256 must be lowercase hexadecimal');
  return {bytes:value.bytes, sha256:value.sha256};
}

// This is an explicit user declaration for a byte-pinned PCK, not dependency scanning.
export function normalizeProjectUsage(value, profile = 'full') {
  registered(profile);
  if (profile===CUSTOM_PAIR_PROFILE) {
    assert(value?.schema==='wxslim-custom-project-usage-v1' && value.removedFeaturesUnused===true,'reviewed custom project usage required');
    return deepFreeze(structuredClone(value));
  }
  if (!isConservativeEngineProfile(profile)) {
    assert.equal(value, undefined, 'full module profile does not accept projectUsage');
    return null;
  }
  exactObject(value, ['schema', 'pck', 'removedModules'], 'projectUsage');
  assert.equal(value.schema, 'wxslim-project-usage-v1');
  const pck = normalizePckPin(value.pck);
  exactObject(value.removedModules, removedModules, 'removedModules');
  const declarations = {};
  for (const name of removedModules) {
    assert.equal(value.removedModules[name], 'unused', 'conservative requires explicit unused declaration: ' + name);
    declarations[name] = 'unused';
  }
  return deepFreeze({schema:'wxslim-project-usage-v1', pck, removedModules:declarations});
}

export function checkProjectUsage(value, profile = 'full', pckPin, customPckBytes) {
  const declaration = normalizeProjectUsage(value, profile);
  if (declaration === null) return null;
  assert.deepEqual(declaration.pck, normalizePckPin(pckPin), 'projectUsage must match actual PCK bytes and SHA256');
  if (profile===CUSTOM_PAIR_PROFILE) {
    const checked=checkCustomProjectUsage(registered(profile).recipe.features,customPckBytes,declaration);
    return checked.declaration;
  }
  return declaration;
}
