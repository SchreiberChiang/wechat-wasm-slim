import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze as analyzeBoundary } from '../glx-native-boundary/read-log.mjs';

const SCHEMA = 'triangle-js-ledger-log-analysis-v1';
const PARENT = 'native-glx-validation-9b31f77db008bc37fda1';
const int = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function inspectLedger(snapshot) {
    const problems = [], layers = Object.create(null);
    if (!object(snapshot) || !int(snapshot.transition) || !int(snapshot.active) || snapshot.limit !== 16 ||
        !object(snapshot.flags) || !Array.isArray(snapshot.stages) || !Array.isArray(snapshot.open) || !Array.isArray(snapshot.last))
        return { valid: false, problems: ['Missing or invalid ledger snapshot'], layers };
    for (const key of ['stageOverflow', 'openOverflow', 'countInvalid', 'invalidFinish', 'invalidStage', 'invalidOrdinal'])
        if (snapshot.flags[key] !== false) problems.push('Ledger flag: ' + key);
    if (snapshot.stages.length > 16 || snapshot.open.length > 16 || snapshot.last.length > 16) problems.push('Ledger bounded list exceeded');
    let transition = 0, active = 0;
    for (const item of snapshot.stages) {
        if (!object(item) || typeof item.stage !== 'string' || !item.stage || Object.hasOwn(layers, item.stage) ||
            !int(item.enter) || !int(item.return) || !int(item.throw) || item.enter < item.return + item.throw) {
            problems.push('Invalid or duplicate stage counters'); continue;
        }
        const difference = item.enter - item.return - item.throw;
        layers[item.stage] = { enter: item.enter, return: item.return, throw: item.throw, difference };
        transition += item.enter + item.return + item.throw; active += difference;
    }
    if (!int(transition) || transition !== snapshot.transition || active !== snapshot.active || snapshot.open.length !== active)
        problems.push('Ledger transition/active/open totals disagree');
    const openTransitions = new Set();
    for (const item of snapshot.open) {
        if (!object(item) || !Object.hasOwn(layers, item.stage) || !int(item.ordinal) || !int(item.transition) ||
            item.transition < 1 || item.transition > snapshot.transition || openTransitions.has(item.transition)) problems.push('Invalid open entry');
        openTransitions.add(item?.transition);
    }
    for (const [stage, layer] of Object.entries(layers))
        if (snapshot.open.filter(item => item?.stage === stage).length !== layer.difference) problems.push('Stage/open totals disagree: ' + stage);
    let lastTransition = Math.max(0, snapshot.transition - snapshot.last.length);
    for (const item of snapshot.last) {
        if (!object(item) || item.transition !== lastTransition + 1 || !Object.hasOwn(layers, item.stage) || !int(item.ordinal) ||
            !['enter', 'return', 'throw'].includes(item.kind)) problems.push('Invalid last transition record');
        lastTransition = item?.transition;
    }
    if (snapshot.last.length !== Math.min(snapshot.transition, 16) || lastTransition !== snapshot.transition) problems.push('Incomplete last transition tail');
    return { valid: problems.length === 0, problems, layers, transition: snapshot.transition, active: snapshot.active,
        last: snapshot.last, open: snapshot.open };
}

export function analyze(logText, manifest, previous) {
    const previousBoundary = previous?.schema === SCHEMA ? { ...previous, schema: 'triangle-js-boundary-log-analysis-v1' } : previous;
    const report = analyzeBoundary(logText, { ...manifest, schema: 'native-glx-boundary-candidate-v1' }, previousBoundary);
    report.schema = SCHEMA;
    report.status = 'LEDGER_DIAGNOSTIC';
    report.boundaryCompatibility = { reader: '../glx-native-boundary/read-log.mjs', adaptation: 'MANIFEST_SCHEMA_ONLY', rawLogUnchanged: true };
    report.checkpointSessions = [];
    report.limits.push('Checkpoint delayMs values 4000/9000 are schedules, never measured observation windows.',
        'Date.now is a wall clock; valid numbers do not prove monotonic or reliable timing.',
        'Ledger counter progress proves observed JS call transitions only, never GPU or visible frame completion.',
        'Zero differences in an adequate observed window mean no counter progress observed, never proof RAF stopped.',
        'Missing checkpoints, invalid snapshots, mixed sessions and closely spaced callbacks leave progress UNKNOWN.',
        'Visual observation and现场 continuity require separate user/device input; this reader supplies neither.');
    const stop = (code, detail, sessionTag = null, logLine = null) => {
        if (!report.stopReasons.some(reason => reason.code === code && reason.detail === detail && reason.sessionTag === sessionTag))
            report.stopReasons.push({ code, detail, sessionTag, logLine });
    };
    if (previous !== undefined && previous?.schema !== SCHEMA)
        stop('PREVIOUS_IDENTITY_MISMATCH', 'Previous report is not a ledger reader report');
    if (manifest?.schema !== 'native-glx-ledger-candidate-v1' || manifest?.identity?.variant !== 'js-boundary-v1' ||
        manifest?.identity?.diagnosticVariant !== 'execution-ledger-v1' || manifest?.identity?.parentPackageId !== PARENT)
        stop('INVALID_CANDIDATE', 'Ledger schema/diagnostic variant/parent identity is invalid');
    const sessions = new Map();
    for (const [index, line] of String(Buffer.isBuffer(logText) ? logText.toString('utf8') : logText).split(/\r?\n/).entries()) {
        const match = line.match(/^\s*(?:\[(?:log|info|warn|error|debug)\]\s*)?(?:\[GLX_TRIANGLE_CHECKPOINT\]|\[GLX_CP([12])\])\s*(.*)$/);
        if (!match) continue;
        let event;
        try { event = JSON.parse(match[2]); if (!object(event)) throw Error(); }
        catch (_) { stop('INVALID_JSON', '[GLX_TRIANGLE_CHECKPOINT]', null, index + 1); continue; }
        event = { ...event, logLine: index + 1 };
        if (match[1] && Number(match[1]) !== event.checkpoint)
            stop('CHECKPOINT_TITLE_MISMATCH', 'Visible title ordinal differs from JSON checkpoint', event.sessionTag, event.logLine);
        if (event.packageId !== report.packageId) { stop('PACKAGE_MISMATCH', 'Checkpoint belongs to a different package', event.sessionTag, event.logLine); continue; }
        if (typeof event.sessionTag !== 'string' || !event.sessionTag) { stop('MISSING_SESSION_TAG', 'Checkpoint lacks a session', null, event.logLine); continue; }
        let session = sessions.get(event.sessionTag);
        if (!session) {
            session = { sessionTag: event.sessionTag, checkpoints: [], comparison: { observation: 'UNKNOWN', reason: 'TWO_CHECKPOINTS_NOT_OBSERVED' } };
            sessions.set(event.sessionTag, session); report.checkpointSessions.push(session);
        }
        session.checkpoints.push(event);
        if (event.schema !== 'triangle-execution-checkpoint-v1' || event.checkpoint !== (event.plannedDelayMs === 4000 ? 1 : 2))
            stop('CHECKPOINT_SCHEMA_INVALID', 'Checkpoint schema/ordinal is invalid', event.sessionTag, event.logLine);
        event.ledgerInspection = inspectLedger(event.snapshot?.ledger);
        if (!event.ledgerInspection.valid) stop('LEDGER_SNAPSHOT_INVALID', event.ledgerInspection.problems.join('; '), event.sessionTag, event.logLine);
        if (!int(event.snapshot?.ledgerIntegrationFailures) || event.snapshot.ledgerIntegrationFailures > 0)
            stop('LEDGER_INTEGRATION_FAILURE', 'Ledger integration failure coverage is missing or nonzero', event.sessionTag, event.logLine);
        const boundary = event.snapshot?.boundary;
        if (!object(boundary) || boundary.packageId !== report.packageId || boundary.sessionTag !== event.sessionTag ||
            boundary.eventLimit !== 96 || !int(boundary.sequence) || boundary.sequence > 96 || !int(boundary.outputFailures) ||
            !int(boundary.throwEvents) || boundary.throwEvents > 4 || typeof boundary.exhausted !== 'boolean')
            stop('CHECKPOINT_BOUNDARY_INVALID', 'Independent boundary budget/failure snapshot is invalid', event.sessionTag, event.logLine);
        if (boundary?.exhausted === true || boundary?.sequence >= 96) stop('PROBE_BUDGET_EXHAUSTED', 'Boundary budget exhausted in checkpoint', event.sessionTag, event.logLine);
        if (boundary?.outputFailures > 0) stop('PROBE_OUTPUT_FAILURE', 'Boundary output failure in checkpoint', event.sessionTag, event.logLine);
        if (event.snapshot?.runtime?.readFailed === true) stop('RUNTIME_COUNTER_COVERAGE_FAILED', 'Checkpoint runtime metadata reader failed', event.sessionTag, event.logLine);
        const diagnostics = event.diagnostics;
        if (!object(diagnostics) || diagnostics.packageId !== report.packageId || diagnostics.sessionTag !== event.sessionTag ||
            diagnostics.armed !== true || diagnostics.duplicateArm !== false || !int(diagnostics.outputAttempts) ||
            diagnostics.outputAttempts !== event.checkpoint || !same(diagnostics.scheduledAt, event.scheduledAt) ||
            !Array.isArray(diagnostics.plans) || diagnostics.plans.length !== 2)
            stop('CHECKPOINT_DIAGNOSTICS_INVALID', 'Independent checkpoint scheduling/output budget coverage is invalid', event.sessionTag, event.logLine);
        else for (const [i, plan] of diagnostics.plans.entries()) {
            if (!object(plan) || plan.delayMs !== [4000, 9000][i] || plan.registered !== true || plan.duplicateFire !== false || plan.staleSession !== false ||
                plan.fired !== (i < event.checkpoint) || plan.outputAttempted !== (i < event.checkpoint) ||
                ['outputError', 'registrationError', 'callbackError', 'sessionReadError', 'readerError'].some(key => Object.hasOwn(plan, key)))
                stop('CHECKPOINT_FAILURE', 'Checkpoint timer/reader/session/output failure or duplicate firing', event.sessionTag, event.logLine);
        }
        if (![4000, 9000].includes(event.plannedDelayMs)) stop('CHECKPOINT_PLAN_INVALID', 'Unexpected scheduled delay', event.sessionTag, event.logLine);
    }
    for (const session of report.checkpointSessions) {
        const records = session.checkpoints;
        const entry = report.sessions.find(item => item.sessionTag === session.sessionTag);
        session.entryObserved = entry?.entryObserved === true;
        if (!session.entryObserved) { session.comparison.reason = 'CURRENT_SESSION_ENTRY_NOT_OBSERVED'; continue; }
        if (records.length !== 2 || records[0].plannedDelayMs !== 4000 || records[1].plannedDelayMs !== 9000) {
            if (records.length >= 2 || new Set(records.map(item => item.plannedDelayMs)).size !== records.length)
                stop('CHECKPOINT_DUPLICATE_OR_ORDER', 'Expected exactly one 4000ms and one later 9000ms checkpoint', session.sessionTag);
            continue;
        }
        const [a, b] = records;
        const validTime = value => value?.valid === true && typeof value.raw === 'number' && Number.isFinite(value.raw);
        const timeValid = [a, b].every(item => validTime(item.scheduledAt) && validTime(item.actualAt) && item.elapsedValid === true &&
            item.actualAt.raw >= item.scheduledAt.raw && item.elapsedMs === item.actualAt.raw - item.scheduledAt.raw) && same(a.scheduledAt, b.scheduledAt);
        if (!timeValid || b.actualAt.raw < a.actualAt.raw) { session.comparison.reason = 'ACTUAL_TIME_WINDOW_UNRELIABLE'; continue; }
        const observedWindowMs = b.actualAt.raw - a.actualAt.raw;
        session.comparison = { observation: 'UNKNOWN', reason: 'OBSERVATION_WINDOW_TOO_SHORT', observedWindowMs, clock: 'Date.now', clockReliability: 'NOT_CERTIFIED' };
        if (observedWindowMs < 1000) continue;
        if (!a.ledgerInspection.valid || !b.ledgerInspection.valid || report.stopReasons.some(reason => reason.sessionTag === session.sessionTag &&
            ['CHECKPOINT_TITLE_MISMATCH', 'LEDGER_INTEGRATION_FAILURE', 'CHECKPOINT_SCHEMA_INVALID', 'CHECKPOINT_PLAN_INVALID', 'CHECKPOINT_DIAGNOSTICS_INVALID', 'CHECKPOINT_FAILURE', 'CHECKPOINT_BOUNDARY_INVALID'].includes(reason.code))) {
            session.comparison.reason = 'SNAPSHOT_COVERAGE_UNRELIABLE'; continue;
        }
        const layers = Object.create(null);
        let regression = false, progressed = false;
        for (const stage of new Set([...Object.keys(a.ledgerInspection.layers), ...Object.keys(b.ledgerInspection.layers)])) {
            const first = a.ledgerInspection.layers[stage] || { enter: 0, return: 0, throw: 0, difference: 0 };
            const second = b.ledgerInspection.layers[stage] || { enter: 0, return: 0, throw: 0, difference: 0 };
            const delta = Object.fromEntries(['enter', 'return', 'throw'].map(key => [key, second[key] - first[key]]));
            if (Object.values(delta).some(value => value < 0)) regression = true;
            if (Object.values(delta).some(value => value > 0)) progressed = true;
            layers[stage] = { first, second, delta };
        }
        if (regression || b.ledgerInspection.transition < a.ledgerInspection.transition) {
            stop('LEDGER_COUNTER_REGRESSION', 'Same-session cumulative counters decreased', session.sessionTag);
            session.comparison.reason = 'COUNTER_REGRESSION'; continue;
        }
        Object.assign(session.comparison, { observation: progressed ? 'COUNTER_PROGRESS_OBSERVED' : 'NO_COUNTER_PROGRESS_OBSERVED',
            reason: 'TWO_SAME_SESSION_SNAPSHOTS_IN_OBSERVED_WALL_CLOCK_WINDOW', layers });
    }
    for (const session of report.sessions) session.checkpointCoverage = sessions.get(session.sessionTag)?.comparison || { observation: 'UNKNOWN', reason: 'TWO_CHECKPOINTS_NOT_OBSERVED' };
    for (const session of report.sessions) {
        const records = sessions.get(session.sessionTag)?.checkpoints || [];
        if (session.entryObserved && (records.length !== 2 || !records.some(event => event.checkpoint === 1) || !records.some(event => event.checkpoint === 2)))
            stop('CHECKPOINT_COVERAGE_INCOMPLETE', 'Two independent checkpoint bodies required', session.sessionTag);
    }
    report.stopRequired = report.stopReasons.length > 0;
    if (report.stopReasons.some(reason => ['INVALID_CANDIDATE', 'PACKAGE_MISMATCH', 'INVALID_JSON'].includes(reason.code))) report.status = 'STOP_INVALID_EVIDENCE';
    return report;
}

export function cli(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i], value = argv[i + 1];
        if (!['--log', '--candidate', '--out', '--previous'].includes(key) || Object.hasOwn(args, key) || !value || !path.isAbsolute(value))
            throw Error('Use unique absolute --log --candidate --out and optional --previous paths');
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
