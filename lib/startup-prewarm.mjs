// Native engine capability, not a JS optimisation. No file writes or runtime GL calls.
// Only exact registered profiles whose source was inspected are described here.
export const PREWARM_SETTING = 'startup/gles3/skip_default_3d_prewarm';
const unconditionalProfiles = new Set([
  'full-official-c050-dev',
  'conservative-official-c050-dev',
  'full-official-c050-capability-dev',
]);

// Both materializers start with the same inspected c050 GLES3 startup sources.
const inspectedSourceRecipes = new Set(['official-c050-capability-24', 'official-c050-capability-custom']);

export function describeStartupPrewarm(profile, verifiedSourceRecipe) {
  const inspected = unconditionalProfiles.has(profile) ||
    (profile === 'custom-official-c050-dev' && inspectedSourceRecipes.has(verifiedSourceRecipe));
  return {
    setting: PREWARM_SETTING,
    support: inspected ? 'REQUIRES_ENGINE_REBUILD' : 'UNKNOWN',
    selectable: false,
    currentBehaviour: inspected ? 'UNCONDITIONAL_DEFAULT_SCENE_SHADER_BIND' : 'UNKNOWN',
    controlLocation: 'PROJECT_SETTINGS_IN_STARTUP_PCK',
    afterSupportingEngineBuilt: 'REEXPORT_PCK_AND_REPACKAGE_NO_WASM_REBUILD',
    effect: 'DEFER_DEFAULT_3D_SHADER_BIND_ONLY_NOT_ALL_SHADER_COMPILATION',
    performance: 'NOT_MEASURED_FIRST_3D_USE_MAY_STALL',
  };
}

export function validateStartupPrewarmRequest(value, profile, verifiedSourceRecipe) {
  if (value === undefined) return;
  if (typeof value !== 'boolean') throw Object.assign(Error('skipDefault3dPrewarm must be a boolean'), {code:'PREWARM_BOOLEAN_REQUIRED'});
  if (value === false) return; // Preserve old output/identity; no artificial JS override.
  const state = describeStartupPrewarm(profile, verifiedSourceRecipe);
  const code = state.support === 'REQUIRES_ENGINE_REBUILD' ? 'PREWARM_ENGINE_REBUILD_REQUIRED' : 'PREWARM_ENGINE_SUPPORT_UNKNOWN';
  throw Object.assign(Error(code + ': ' + PREWARM_SETTING + ' requires an audited native guard; conversion cannot add it'), {code});
}
