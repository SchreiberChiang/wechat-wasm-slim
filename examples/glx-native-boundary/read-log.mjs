import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const callStages = ['after-frame-register', 'after-frame', 'native-flush', 'batch', 'swap', 'raf-request',
    'raf-delivery', 'run-iter', 'native-callback', 'color-output', 'native-output', 'native-stderr', 'host-create', 'wx-error', 'wx-rejection'];
const stageSet = new Set(callStages);
const callbackStages = new Set(['after-frame', 'native-flush', 'batch', 'swap', 'raf-delivery', 'run-iter', 'native-callback']);
const selected = ordinal => [1, 2, 61].includes(ordinal);
const int = value => Number.isSafeInteger(value) && value >= 0;

export function analyze(logText, manifest, previous) {
    const raw = Buffer.isBuffer(logText) ? logText : Buffer.from(String(logText));
    const identity = manifest?.identity;
    const report = { schema: 'triangle-js-boundary-log-analysis-v1', status: 'BOUNDARY_DIAGNOSTIC', packageId: identity?.packageId ?? null,
        candidateIdentitySha256: identity ? sha(canonical(identity)) : null, rawLogSha256: sha(raw), rawLogBytes: raw.length,
        stopRequired: false, stopReasons: [], observations: [], sessions: [], unassociatedRawSamples: [],
        visibleValidation: 'NOT_PROVEN', fpsValidation: 'NOT_MEASURED', lifecycleValidation: 'NOT_PROVEN',
        limits: ['Missing selected events do not prove RAF stopped or identify the cause.',
            'Return means only that the wrapped JS/native call returned; no batch/GPU/pixel completion is implied.',
            'Stage ordinals are per-stage invocation counts, not a universal frame ID.',
            'COLOR/shader raw lines have no session tag; attribution uses the active entry and explicit callback scope when available.',
            'Startup/runtime markers and older-session callbacks do not certify underlying context ownership.',
            'Previous reports link known tags; old/new ordering is based on current log lines, never tag timestamps.',
            'Frame 361 and two RGB cycles are not required for boundary diagnosis; no automatic follow-up is authorized.'] };
    const stop = (code, detail, sessionTag = null, logLine = null) => {
        if (!report.stopReasons.some(reason => reason.code === code && reason.detail === detail && reason.sessionTag === sessionTag))
            report.stopReasons.push({ code, detail, sessionTag, logLine });
    };
    if (manifest?.schema !== 'native-glx-boundary-candidate-v1' || identity?.variant !== 'js-boundary-v1' ||
        !/^native-glx-validation-[a-f0-9]{20}$/.test(identity?.packageId || '')) stop('INVALID_CANDIDATE', 'Boundary candidate schema/variant/package identity is missing or invalid');
    const previousValid = previous?.schema === report.schema && previous.packageId === report.packageId && previous.candidateIdentitySha256 === report.candidateIdentitySha256;
    if (previous !== undefined && !previousValid) stop('PREVIOUS_IDENTITY_MISMATCH', 'Previous report schema/package/identity differs');
    const previousTags = new Set(previousValid ? (previous.sessions || []).filter(s => s.entryObserved || s.knownFromPrevious).map(s => s.sessionTag) : []);
    const map = new Map(); let active = null, latestEntry = null;
    const openCallbacks = [];
    function session(tag) {
        if (!map.has(tag)) {
            const value = { sessionTag: tag, entryObserved: false, knownFromPrevious: previousTags.has(tag), entryLine: null,
                evidence: [], boundaryEvents: [], rawShaderObservations: [], shaderObservations: [], colorSamples: [], hostSnapshots: [],
                lifecycleEvents: [], notices: [], observations: [], layers: {}, prefixPartial: false, sequenceGaps: [], _evidenceSequence: 0, _boundarySequence: 0,
                _counts: Object.create(null), _open: new Map(), _closed: new Set() };
            map.set(tag, value); report.sessions.push(value);
        }
        return map.get(tag);
    }
    const parse = (line, prefix, logLine) => {
        try { const value = JSON.parse(line.slice(line.indexOf(prefix) + prefix.length));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
        catch (_) { stop('INVALID_JSON', prefix, null, logLine); return null; }
    };
    const associated = event => {
        if (event.packageId !== report.packageId) stop('PACKAGE_MISMATCH', 'Tagged event belongs to a different package', event.sessionTag || null, event.logLine);
        if (typeof event.sessionTag !== 'string' || !event.sessionTag) { stop('MISSING_SESSION_TAG', 'Tagged event lacks a session', null, event.logLine); return null; }
        return session(event.sessionTag);
    };
    for (const [index, line] of raw.toString('utf8').split(/\r?\n/).entries()) {
        const logLine = index + 1;
        if (/^\s*\[(?:error|fatal)\]/i.test(line) || /RuntimeError:|Aborted\(|drawing buffer size failed|shader compile failed:|program link failed:|Uncaught\s/.test(line))
            stop('RUNTIME_ERROR_TEXT', 'Error text in captured log', active?.sessionTag, logLine);
        const prefixMatch = line.match(/^\s*(?:\[(?:log|info|warn|error|debug)\]\s*)?(\[GLX_TRIANGLE_(?:EVIDENCE|BOUNDARY|SHADER|COLOR)\])/);
        if (!prefixMatch) continue;
        const prefix = prefixMatch[1], value = parse(line, prefix, logLine); if (!value) continue;
        if (prefix === '[GLX_TRIANGLE_EVIDENCE]') {
            const event = { ...value, logLine }, s = associated(event); if (!s) continue;
            s.evidence.push(event);
            if (!int(event.sequence) || event.sequence <= s._evidenceSequence) stop('EVIDENCE_SEQUENCE', 'Evidence sequence is not strictly increasing', s.sessionTag, logLine);
            s._evidenceSequence = event.sequence;
            if (event.kind === 'entry') {
                if (s.entryObserved) stop('DUPLICATE_ENTRY', 'Repeated entry with the same session tag', s.sessionTag, logLine);
                s.entryObserved = true; s.entryLine = logLine; s.sdkVersion = event.detail?.sdkVersion; active = s; latestEntry = s;
                if (s.sdkVersion !== '3.17.5') stop('SDK_GATE_FAILED', 'Actual SDKVersion is not exactly 3.17.5', s.sessionTag, logLine);
            }
            if (event.kind === 'host') s.hostSnapshots.push(event.detail?.summary);
            if (event.kind === 'shader') s.shaderObservations.push(event.detail);
            if (['show', 'hide', 'stage'].includes(event.kind)) s.lifecycleEvents.push(event);
            if (['error', 'unhandledRejection', 'blocked'].includes(event.kind) || event.detail?.status === 'blocked' || event.detail?.summary?.status === 'blocked')
                stop('ERROR_OR_BLOCKED_EVIDENCE', 'Error/blocked evidence, including late host failure', s.sessionTag, logLine);
        } else if (prefix === '[GLX_TRIANGLE_BOUNDARY]') {
            const event = { ...value, logLine }, s = associated(event); if (!s) continue;
            s.boundaryEvents.push(event);
            if (event.schema !== 'triangle-js-boundary-v1' || !['enter', 'return', 'throw', 'notice'].includes(event.kind) ||
                !int(event.sequence) || event.sequence < 1 || event.sequence > 96 || event.sequence <= s._boundarySequence || s.boundaryEvents.length > 96)
                stop('BOUNDARY_SCHEMA_OR_SEQUENCE', 'Invalid boundary schema/order/96-event limit', s.sessionTag, logLine);
            if (int(event.sequence) && event.sequence > s._boundarySequence + 1) {
                const prefix = s._boundarySequence === 0;
                if (prefix) s.prefixPartial = true;
                s.sequenceGaps.push({ from: s._boundarySequence + 1, to: event.sequence - 1,
                    kind: prefix ? 'prefix' : 'internal', logLine, coverage: 'UNKNOWN_UNTIL_SESSION_LINKED' });
            }
            s._boundarySequence = event.sequence;
            if (!int(event.outputFailures)) stop('OUTPUT_FAILURE_COUNT_UNKNOWN', 'Probe output-failure coverage is unknown', s.sessionTag, logLine);
            else if (event.outputFailures > 0) stop('PROBE_OUTPUT_FAILURE', 'Probe reports failed structured output', s.sessionTag, logLine);
            if (!int(event.throwEvents) || event.throwEvents > 4) stop('THROW_COUNTER_INVALID', 'Throw diagnostic counter is missing or exceeds four', s.sessionTag, logLine);
            if (event.runtime?.readFailed === true) stop('RUNTIME_COUNTER_COVERAGE_FAILED', 'Runtime metadata reader failed', s.sessionTag, logLine);
            if (!event.counts || typeof event.counts !== 'object' || Array.isArray(event.counts)) stop('COUNTS_INVALID', 'Missing stage counters', s.sessionTag, logLine);
            else for (const [stage, count] of Object.entries(event.counts)) {
                if (!stageSet.has(stage) || !int(count) || count < (s._counts[stage] || 0)) stop('COUNTS_INVALID', 'Unknown/decreasing/invalid stage counter: ' + stage, s.sessionTag, logLine);
                else s._counts[stage] = count;
            }
            if (event.kind === 'notice') {
                s.notices.push(event);
                const notice = event.detail?.kind;
                if (!['startup', 'notice', 'budget'].includes(event.stage)) stop('NOTICE_STAGE_UNKNOWN', 'Unrecognized notice stage', s.sessionTag, logLine);
                if (event.stage === 'budget' || event.exhausted === true || notice === 'budget-exhausted') stop('PROBE_BUDGET_EXHAUSTED', 'Boundary event budget exhausted; preserve current stage', s.sessionTag, logLine);
                if (['host-failure', 'structured-output-failure'].includes(notice)) stop(notice === 'host-failure' ? 'HOST_FAILURE_NOTICE' : 'STRUCTURED_OUTPUT_FAILURE', 'Explicit ' + notice, s.sessionTag, logLine);
                if (notice === 'error-hook-coverage') {
                    const coverage = event.detail?.detail;
                    if (!['onError', 'onUnhandledRejection'].includes(coverage?.api) || coverage.present !== true || coverage.registered !== true || coverage.registrationThrew !== false)
                        stop('ERROR_HOOK_COVERAGE_FAILED', 'Error hook absent, unregistered or threw during registration', s.sessionTag, logLine);
                }
            } else {
                if (!stageSet.has(event.stage) || !int(event.ordinal) || event.ordinal < 1 ||
                    (event.kind !== 'throw' && !selected(event.ordinal))) stop('BOUNDARY_STAGE_OR_ORDINAL', 'Invalid stage/selected ordinal', s.sessionTag, logLine);
                if (int(event.counts?.[event.stage]) && event.counts[event.stage] < event.ordinal) stop('COUNTS_INVALID', 'Stage count precedes event ordinal', s.sessionTag, logLine);
                const key = event.stage + ':' + event.ordinal;
                if (event.kind === 'enter') {
                    if (s._open.has(key) || s._closed.has(key)) stop('DUPLICATE_INVOCATION', key, s.sessionTag, logLine);
                    s._open.set(key, event);
                    if (event.stage === 'native-callback') openCallbacks.push({ session: s, key, logLine });
                } else {
                    if (event.kind === 'return' && !s._open.has(key)) stop('RETURN_WITHOUT_ENTER', key, s.sessionTag, logLine);
                    s._open.delete(key); s._closed.add(key);
                    if (event.stage === 'native-callback') {
                        const at = openCallbacks.findLastIndex(item => item.session === s && item.key === key);
                        if (at >= 0) openCallbacks.splice(at, 1);
                    }
                    if (event.kind === 'throw') {
                        const control = event.detail?.thrownType === 'string' && event.detail?.primitiveValuePresent === true && event.detail.primitiveValue === 'unwind';
                        event.throwClassification = control ? 'KNOWN_UNWIND_CONTROL_FLOW' : event.detail?.thrownType === 'number' ? 'NUMERIC_SIGNAL_MEANING_NOT_CERTIFIED' : 'THROWN_VALUE_OBSERVED';
                        if (!control) stop('BOUNDARY_THROW_OBSERVED', event.throwClassification + ' at ' + event.stage, s.sessionTag, logLine);
                    }
                }
                if (latestEntry && latestEntry !== s && callbackStages.has(event.stage)) {
                    const older = s.knownFromPrevious || (s.entryObserved && s.entryLine < latestEntry.entryLine);
                    const observation = { code: older ? 'OLDER_SESSION_CALLBACK_OBSERVED' : 'UNBOUND_SESSION_CALLBACK_OBSERVED',
                        sessionTag: s.sessionTag, latestEntrySessionTag: latestEntry.sessionTag, stage: event.stage, kind: event.kind, logLine };
                    s.observations.push(observation); report.observations.push(observation);
                }
            }
        } else {
            // An old unmatched enter is not a reliable execution stack across a
            // new entry. Only an explicitly opened callback after that entry
            // can override attribution to the active entry.
            const explicitScope = openCallbacks.findLast(item => !latestEntry || item.logLine > latestEntry.entryLine);
            const scoped = explicitScope?.session || active;
            if (!scoped) { report.unassociatedRawSamples.push({ prefix, value, logLine }); continue; }
            if (prefix === '[GLX_TRIANGLE_SHADER]') scoped.rawShaderObservations.push(value);
            else scoped.colorSamples.push({ ...value, logLine, association: explicitScope ? 'selected-native-callback-scope' : 'active-entry-only' });
        }
    }
    if (!report.sessions.some(s => s.entryObserved)) stop('NO_ENTRY_OBSERVED', 'No current session entry; boundary records retained for diagnosis');
    for (const s of report.sessions) {
        for (const gap of s.sequenceGaps) {
            gap.coverage = s.entryObserved || gap.kind === 'internal' ? 'MISSING_BOUNDARY_EVENTS' : 'UNKNOWN_PARTIAL_OLD_SESSION_PREFIX';
            if (s.entryObserved || gap.kind === 'internal') stop('BOUNDARY_EVENT_GAP', `Missing boundary sequence ${gap.from}-${gap.to}`, s.sessionTag, gap.logLine);
        }
        for (const stage of callStages) {
            const events = s.boundaryEvents.filter(event => event.stage === stage && event.kind !== 'notice');
            const enters = events.filter(event => event.kind === 'enter').map(event => event.ordinal);
            const returns = events.filter(event => event.kind === 'return').map(event => event.ordinal);
            const throws = events.filter(event => event.kind === 'throw').map(event => ({ ordinal: event.ordinal, detail: event.detail, classification: event.throwClassification }));
            s.layers[stage] = { enteredOrdinals: enters, returnedOrdinals: returns, throws, maxCountSnapshot: s._counts[stage] ?? null,
                openSelectedOrdinals: [...s._open.values()].filter(event => event.stage === stage).map(event => event.ordinal),
                observation: throws.length ? 'THROW_OBSERVED' : returns.length ? 'REQUEST_OR_CALL_RETURN_OBSERVED' : enters.length ? 'ENTER_WITHOUT_OBSERVED_EXIT' : s._counts[stage] ? 'COUNT_SNAPSHOT_ONLY' : 'UNKNOWN' };
        }
        s.nativeCallback61ReturnObserved = s.layers['native-callback'].returnedOrdinals.includes(61);
        s.frame61ColorObserved = s.colorSamples.some(sample => sample.frame === 61);
        s.lastColorFrame = s.colorSamples.at(-1)?.frame ?? null;
        s.probeBudgetExhausted = s.boundaryEvents.some(event => event.exhausted === true || event.stage === 'budget');
        if (s.entryObserved) {
            if (!s.notices.some(event => event.stage === 'startup' && event.detail?.kind === 'startup')) stop('PROBE_STARTUP_NOT_OBSERVED', 'Startup marker coverage unknown', s.sessionTag);
            for (const api of ['onError', 'onUnhandledRejection']) if (!s.notices.some(event => event.detail?.kind === 'error-hook-coverage' && event.detail?.detail?.api === api))
                stop('ERROR_HOOK_COVERAGE_UNKNOWN', api + ' coverage notice missing', s.sessionTag);
            if (s.hostSnapshots.length !== 1) stop('HOST_SNAPSHOT_MISSING_OR_REPEATED', 'Expected one initialized host snapshot', s.sessionTag);
            for (const host of s.hostSnapshots) {
                if (!host || host.status !== 'initialization-snapshot' || host.mode !== 'GLX' || host.actualMode !== 'glx' || host.actualContextMetadataMatch !== true || host.actualContextCanvasMatch !== true)
                    stop('GLX_HOST_GATE_FAILED', 'Actual GLX context/metadata/canvas not established', s.sessionTag);
                for (const key of Object.keys(identity || {})) if (canonical(host?.[key]) !== canonical(identity[key])) stop('HOST_IDENTITY_MISMATCH', key, s.sessionTag);
            }
            if (s.shaderObservations.length !== 2 || s.rawShaderObservations.length !== 2) stop('SHADER_COVERAGE_INCOMPLETE', 'Expected two raw and two associated shader TYPE records', s.sessionTag);
            for (const [i, shader] of s.shaderObservations.entries()) {
                const expected = [35633, 35632][i];
                if (shader?.schema !== 'triangle-shader-type-v1' || shader.stage !== 'created-before-source' || shader.expectedType !== expected || shader.returnedType !== expected || shader.readOrdinal !== i + 1 || !int(shader.shaderId) || shader.shaderId < 1 || !int(shader.publicContextHandle) || shader.publicContextHandle < 1)
                    stop('SHADER_TYPE_GATE_FAILED', 'Public shader query mismatch or invalid record', s.sessionTag);
            }
            if (canonical(s.shaderObservations) !== canonical(s.rawShaderObservations)) stop('RAW_SHADER_MISMATCH', 'Raw and associated shader records differ', s.sessionTag);
            let handle = s.shaderObservations[0]?.publicContextHandle;
            for (const [i, color] of s.colorSamples.entries()) {
                const phase = i % 3;
                if (color.schema !== 'triangle-frame-color-v1' || color.frame !== i * 60 + 1 || color.sampleOrdinal !== i + 1 || color.phaseIndex !== phase || color.color !== ['red', 'green', 'blue'][phase] ||
                    canonical(color.rgbaComputed) !== canonical([[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]][phase]) || color.sampleLimit !== 180 || color.budgetExhausted !== (i === 179) || color.publicContextHandle !== handle)
                    stop('COLOR_RECORD_INVALID', 'COLOR schema/order/RGBA/public context mismatch', s.sessionTag, color.logLine);
                if (color.budgetExhausted || i >= 179) stop('COLOR_BUDGET_EXHAUSTED', 'Stop at the current stage; no budget reset', s.sessionTag, color.logLine);
            }
            if (!s.frame61ColorObserved) stop('FRAME_61_COLOR_NOT_OBSERVED', 'Partial observation retained; this absence does not prove RAF stopped', s.sessionTag);
        }
        delete s._evidenceSequence; delete s._boundarySequence; delete s._counts; delete s._open; delete s._closed;
    }
    report.stopRequired = report.stopReasons.length > 0;
    report.status = report.stopReasons.some(reason => ['INVALID_CANDIDATE', 'PACKAGE_MISMATCH', 'INVALID_JSON'].includes(reason.code)) ? 'STOP_INVALID_EVIDENCE' : 'BOUNDARY_DIAGNOSTIC';
    return report;
}

export function cli(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i], value = argv[i + 1];
        if (!['--log', '--candidate', '--out', '--previous'].includes(key) || Object.hasOwn(args, key) || !value || !path.isAbsolute(value)) throw Error('Use unique absolute --log --candidate --out and optional --previous paths');
        args[key] = value;
    }
    if (!args['--log'] || !args['--candidate'] || !args['--out']) throw Error('Missing required --log --candidate --out');
    let report;
    try { report = analyze(fs.readFileSync(args['--log']), JSON.parse(fs.readFileSync(args['--candidate'], 'utf8')),
        args['--previous'] ? JSON.parse(fs.readFileSync(args['--previous'], 'utf8')) : undefined); }
    catch (error) { report = analyze('', null); report.stopReasons.push({ code: 'INPUT_FAILURE', detail: String(error.message) }); report.stopRequired = true; }
    report.rawLogPath = args['--log']; report.candidatePath = args['--candidate'];
    fs.writeFileSync(args['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { const report = cli(process.argv.slice(2)); console.log(JSON.stringify(report)); if (report.stopRequired) process.exitCode = 2; }
    catch (error) { console.error(error.message); process.exitCode = 2; }
}
