// Must run in local-interfaces BEFORE loader.start(); the engine factory starts too late to see this mark.
(function (root) {
  'use strict';
  var timing = root.__WXSLIM_TIMING__, state = {markHook: false, resolved: null, outcome: 'hook_unavailable'};
  root.__WXSLIM_PRESENTATION_LOADER__ = state;
  if (!timing || typeof timing.mark !== 'function') return;
  var original = timing.mark, timer, active = true;
  function cleanup() {
    active = false;
    if (timing.mark === wrapped) timing.mark = original;
    if (timer !== undefined) clearTimeout(timer);
  }
  function wrapped(name) {
    var result = original.apply(this, arguments);
    if (active && name === 'loader_start_ok') { state.resolved = true; state.outcome = 'mark_returned'; cleanup(); }
    return result;
  }
  state.markHook = true; state.resolved = false; state.outcome = 'awaiting_mark'; timing.mark = wrapped;
  timer = setTimeout(function () { state.outcome = 'mark_not_seen_before_timeout'; cleanup(); }, 60000);
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis);
