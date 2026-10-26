import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';

export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const PARENT_PROBE_SHA = '52e64def5ab1ab3548189c4a02dd67e982d500bb35a2991aec74ab59c92aaf8e';

const ledgerSetup = `
    // Local observation ledger: no new wrappers or renderer calls.
    let ledgerModule = null, executionLedger = null, checkpointObserver = null, ledgerIntegrationFailures = 0;
    try { ledgerModule = require('./execution-ledger.js'); executionLedger = ledgerModule.create(); }
    catch (_) { ledgerIntegrationFailures++; }
    const ledgerBegin = (stage, ordinal) => {
        if (!executionLedger) return null;
        try { return executionLedger.begin(stage, ordinal); }
        catch (_) { ledgerIntegrationFailures++; return null; }
    };
    const ledgerFinish = (token, outcome) => {
        if (!executionLedger || token === null) return;
        try { executionLedger.finish(token, outcome); }
        catch (_) { ledgerIntegrationFailures++; }
    };`;

const extraApi = `
        ledgerSnapshot() {
            let ledger = null;
            try { if (executionLedger) ledger = executionLedger.snapshot(); }
            catch (_) { ledgerIntegrationFailures++; }
            return { ledger, boundary: api.snapshot(), runtime: runtime(), ledgerIntegrationFailures };
        },
        armCheckpoints(timerRoot) {
            try {
                if (!checkpointObserver) {
                    if (!ledgerModule || sessionTag === null) throw Error('Ledger/session unavailable');
                    checkpointObserver = ledgerModule.createCheckpoints({ root: timerRoot, packageId, sessionTag,
                        readSnapshot: () => api.ledgerSnapshot() });
                }
                return checkpointObserver.arm();
            } catch (_) { ledgerIntegrationFailures++; return { armed: false, integrationFailed: true }; }
        },
        checkpointStatus() {
            try { return checkpointObserver ? checkpointObserver.snapshot() : { armed: false }; }
            catch (_) { ledgerIntegrationFailures++; return { integrationFailed: true }; }
        },`;

// Change the existing invoke body, not the call-site wrappers or compiler JS.
export const edits = [
    { name: 'ledger-initialize', before: '    const counts = Object.create(null);',
        after: '    const counts = Object.create(null);' + ledgerSetup },
    { name: 'record-every-enter', before: '        const ordinal = counts[stage] = (counts[stage] || 0) + 1;',
        after: '        const ordinal = counts[stage] = (counts[stage] || 0) + 1;\n        const ledgerToken = ledgerBegin(stage, ordinal);' },
    { name: 'record-every-throw', before: '        catch (error) {\n            if (throwEvents < 4) {',
        after: '        catch (error) {\n            ledgerFinish(ledgerToken, \'throw\');\n            if (throwEvents < 4) {' },
    { name: 'record-every-return', before: '        if (selected) send(\'return\', stage, ordinal);',
        after: '        ledgerFinish(ledgerToken, \'return\');\n        if (selected) send(\'return\', stage, ordinal);' },
    { name: 'checkpoint-api', before: '        snapshot() { return { packageId, sessionTag, sequence, eventLimit: LIMIT, exhausted, outputFailures, throwEvents, installed, counts: { ...counts } }; }',
        after: extraApi + '\n        snapshot() { return { packageId, sessionTag, sequence, eventLimit: LIMIT, exhausted, outputFailures, throwEvents, installed, counts: { ...counts } }; }' }
];

export function extendProbe(base) {
    assert.equal(sha(base), PARENT_PROBE_SHA, 'Only the frozen 9b31 probe is accepted');
    let source = base.toString('utf8');
    for (const edit of edits) {
        assert.equal(source.split(edit.before).length - 1, 1, 'Exactly one parent anchor required: ' + edit.name);
        source = source.replace(edit.before, edit.after);
    }
    const patched = Buffer.from(source);
    new vm.Script(source, { filename: 'ledger-probe-syntax-only.cjs' });
    assert.deepEqual(restoreProbe(patched), base, 'Ledger additions must restore the exact parent probe');
    return { patched, proof: { schema: 'native-ledger-probe-extension-v1', parentSha256: sha(base),
        derivedSha256: sha(patched), edits: edits.map(({ name, before, after }) => ({ name, before, after })),
        restoration: 'EXACT_PARENT_BYTES', originalCallSites: 'UNCHANGED' } };
}

export function restoreProbe(patched) {
    let source = patched.toString('utf8');
    for (const edit of [...edits].reverse()) {
        assert.equal(source.split(edit.after).length - 1, 1, 'Changed ledger extension: ' + edit.name);
        source = source.replace(edit.after, edit.before);
    }
    const restored = Buffer.from(source);
    assert.equal(sha(restored), PARENT_PROBE_SHA, 'Restored probe differs from frozen parent');
    return restored;
}

// Lexical calls preserve the WeChat global timer/Date/console receiver behavior;
// do not assume these built-ins are copied onto GameGlobal.
export const entryAddition = '\n// Two one-shot observation callbacks; neither drives a frame.\n' +
    'boundary.armCheckpoints({\n' +
    '    setTimeout: function(callback, delay) { return setTimeout(callback, delay); },\n' +
    '    Date: { now: function() { return Date.now(); } },\n' +
    '    console: { info: function(line) { return console.info(line); } }\n' +
    '});\n';
