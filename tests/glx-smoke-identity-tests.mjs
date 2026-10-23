import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../examples/glx-smoke/local-interfaces.js', import.meta.url), 'utf8');
function fixture({session, actual = null, missing = false} = {}) {
  let reads = 0;
  const forbidden = () => { throw Error('Unexpected external effect'); };
  const consoleMock = {log: forbidden, warn: forbidden, info: forbidden, error: forbidden};
  if (session) consoleMock.__phoneLogRelay = {session};
  const root = {
    window: {},
    __WXSLIM_RENDER_CONFIG__: {packageVersion: 'wxslim-test-identity', requestedMode: 'glx'},
    wx: {request: forbidden, setStorageSync: forbidden, getStorageSync: forbidden, createCanvas: forbidden, cloud: {init: forbidden, callFunction: forbidden}},
  };
  if (!missing) root.__WXSLIM_RENDER_DIAGNOSTIC__ = {read() {
    reads++;
    return {packageVersion: 'wxslim-test-identity', actualContext: actual, initialization: 'initialized'};
  }};
  vm.runInNewContext(source, {
    GameGlobal: root, console: consoleMock, fetch: forbidden, XMLHttpRequest: forbidden,
    localStorage: new Proxy({}, {get: forbidden, set: forbidden}),
    setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden,
    document: {createElement: forbidden},
  });
  return {root, consoleMock, api: root.WxSlimGlxSmoke, reads: () => reads};
}

test('existing cloud session is cached before relay stop, full ID is manual only', () => {
  const session = 'cloud-session-full-test-A';
  const h = fixture({session, actual: {mode: 'glx'}});
  assert.equal(h.reads(), 0, 'no startup diagnostic read, polling, or GPU calls');
  // Relay may expire before the first visible identity read.
  delete h.consoleMock.__phoneLogRelay;
  const first = h.api.readIdentityText();
  assert.match(first, /Actual context: glx.*existing cloud relay #[0-9a-f]{8}/);
  assert.ok(!first.includes(session));
  h.consoleMock.__phoneLogRelay = {session: 'different-session'};
  assert.equal(h.api.readIdentityText(), first);
  const manual = JSON.parse(h.api.readDiagnosticJson());
  assert.equal(manual.acceptanceIdentity.cloudSession, session);
  assert.equal(manual.acceptanceIdentity.localSession, null);
  assert.ok(first.endsWith(manual.acceptanceIdentity.sessionTag));
  assert.equal(manual.acceptanceIdentity.visibleRendering, 'not_verified');
  assert.equal(manual.acceptanceIdentity.audio, 'not_verified');
  assert.equal(h.root.window.WxSlimGlxSmoke, h.api);
});

test('requested GLX and initialized do not imply actual GLX', () => {
  for (const actual of [null, {}, {mode: 'unrecognized'}]) {
    const h = fixture({actual});
    assert.match(h.api.readIdentityText(), /Actual context: unknown/);
    assert.equal(JSON.parse(h.api.readDiagnosticJson()).acceptanceIdentity.actualMode, 'unknown');
  }
  assert.match(fixture({actual: {mode: 'webgl'}}).api.readIdentityText(), /Actual context: webgl/);
});

test('no relay means stable startup-local identity, never invented cloud session', () => {
  const h = fixture({missing: true});
  const first = h.api.readIdentityText();
  assert.match(first, /Package: wxslim-test-identity/);
  assert.match(first, /local\/no cloud #[0-9a-f]{8}/);
  h.consoleMock.__phoneLogRelay = {session: 'late-relay'};
  assert.equal(h.api.readIdentityText(), first);
  const a = JSON.parse(h.api.readDiagnosticJson());
  const b = JSON.parse(h.api.readDiagnosticJson());
  assert.equal(a.acceptanceIdentity.cloudSession, null);
  assert.equal(a.acceptanceIdentity.localSession, b.acceptanceIdentity.localSession);
  assert.equal(a.available, false);
});

test('diagnostic failure remains readable and does not change cached identity', () => {
  const h = fixture({session: 'existing'});
  h.root.__WXSLIM_RENDER_DIAGNOSTIC__.read = () => { throw Error('test unavailable'); };
  assert.match(h.api.readIdentityText(), /Actual context: unknown/);
  assert.equal(JSON.parse(h.api.readDiagnosticJson()).available, false);
});

test('interface source has no network, persistence, canvas creation or scheduler calls', () => {
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame|createCanvas|createElement|setStorageSync|getStorageSync|localStorage|callFunction|getContext|getParameter)\s*\(/);
});
