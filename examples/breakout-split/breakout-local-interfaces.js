/* Draft only. Install before Godot callMain in the owned official adapter.
 * Implements the actual PCK's observation and explicitly disabled QA contracts.
 * No wx APIs, uploads, fetches, timers, input injection or native activation.
 * A first_frame call is a GDScript assertion after frame_post_draw; it is not
 * independent screenshot, human input, gameplay or startup-speed evidence.
 */
(function installLocalInterfaces(root) {
  'use strict';
  const holders = [];
  function add(label, holder) {
    if (holder && !holders.some(entry => entry.holder === holder)) holders.push({label, holder});
  }
  add('globalThis', root);
  if (typeof GameGlobal !== 'undefined') add('GameGlobal', GameGlobal);
  if (typeof window !== 'undefined') add('window', window);
  for (const entry of holders.slice()) {
    for (const key of ['window', '__gameContextWindow']) add(entry.label + '.' + key, entry.holder[key]);
  }
  const names = ['__STARTUP_LAB_PROBE__', '__PLAYABLE_HARNESS_QA_API__'];
  for (const entry of holders) for (const name of names) {
    if (entry.holder[name] !== undefined) throw new Error('Existing interface must be reviewed before replacement: ' + name);
  }
  const originMs = Date.now();
  const state = {schema: 'wx15-local-interface-observation-v1', method: 'WX15 V2 RELEASE3 ONCLICK 12',
    clock: 'Date.now integer milliseconds', origin: 'local interface installation before callMain',
    excludesEarlierHostAndLoaderTime: true, scene: [], firstFrame: null, duplicateFirstFrameCalls: 0,
    exposedHolders: [], qaConfigReadCount: 0, qaCommandReadCount: 0, humanVerified: false};
  function stamp() { return {atMs: Date.now(), sinceInterfaceInstallMs: Math.max(0, Date.now() - originMs)}; }
  function snapshot() { return JSON.parse(JSON.stringify(state)); }
  const probe = Object.freeze({
    method_label() { return state.method; },
    mark_scene(name) {
      if (typeof name !== 'string' || !['ready_enter', 'view_and_game_state_ready'].includes(name)) {
        throw new Error('Unrecognized PCK scene observation');
      }
      if (state.scene.length >= 64) throw new Error('Local scene observation limit reached');
      state.scene.push({name, ...stamp(), evidence: 'GDScript callback observation'});
    },
    first_frame() {
      if (state.firstFrame) state.duplicateFirstFrameCalls += 1;
      else state.firstFrame = {...stamp(), evidence: 'breakout.gd callback after RenderingServer.frame_post_draw',
        independentRenderValidation: false, inputVerified: false};
      return snapshot();
    },
    snapshot
  });
  const qa = Object.freeze({
    configJSON() {
      state.qaConfigReadCount += 1;
      return JSON.stringify({schema: 'playable-qa-config-v2', enabled: false, autoProbe: false,
        pending: 0, selectedConfigSource: 'wx15_local_official_adapter_explicit_off',
        fixtureOrigin: 'internal_synthetic_fixture', humanVerified: false});
    },
    popCommandJSON() { state.qaCommandReadCount += 1; return 'null'; },
    enqueue() { throw new Error('QA disabled in local official compatibility candidate'); },
    snapshot() { return {enabled: false, autoProbe: false, pending: 0, humanVerified: false}; }
  });
  for (const entry of holders) {
    entry.holder.__STARTUP_LAB_PROBE__ = probe;
    entry.holder.__PLAYABLE_HARNESS_QA_API__ = qa;
    if (entry.holder.__STARTUP_LAB_PROBE__ !== probe || entry.holder.__PLAYABLE_HARNESS_QA_API__ !== qa) {
      throw new Error('Local interface exposure failed on ' + entry.label);
    }
    state.exposedHolders.push(entry.label);
  }
})(globalThis);
