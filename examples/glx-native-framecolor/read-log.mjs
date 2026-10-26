import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, function (_, v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v; });
const names = ['red', 'green', 'blue'];
const rgba = [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]];
const strippedSample = ({ logLine, ...sample }) => sample;

export function diff(previous, current) {
    const reasons = [], sessions = [];
    if (previous?.schema !== 'triangle-frame-color-log-analysis-v1' || previous.packageId !== current.packageId || previous.candidateIdentitySha256 !== current.candidateIdentitySha256) reasons.push('Previous analysis identity/schema mismatch');
    const oldSessions = new Map((previous?.sessions || []).map(s => [s.sessionTag, s]));
    for (const session of current.sessions) {
        const old = oldSessions.get(session.sessionTag);
        const oldSamples = new Map((old?.samples || []).map(s => [s.frame, s]));
        const now = new Map(session.samples.map(s => [s.frame, s]));
        for (const [frame, prior] of oldSamples) {
            if (!now.has(frame)) reasons.push(`Cumulative log lost ${session.sessionTag} frame ${frame}`);
            else if (canonical(strippedSample(prior)) !== canonical(strippedSample(now.get(frame)))) reasons.push(`Cumulative sample changed ${session.sessionTag} frame ${frame}`);
        }
        sessions.push({ sessionTag: session.sessionTag, newSession: !old, addedFrames: session.samples.filter(s => !oldSamples.has(s.frame)).map(s => s.frame), twoCyclesAndNextRedObserved: session.twoCyclesAndNextRedObserved });
        oldSessions.delete(session.sessionTag);
    }
    for (const sessionTag of oldSessions.keys()) reasons.push(`Cumulative log lost session ${sessionTag}`);
    return { status: reasons.length ? 'STOP' : 'COMPARED', previousRawLogSha256: previous?.rawLogSha256 ?? null, currentRawLogSha256: current.rawLogSha256, reasons, sessions };
}

export function analyze(logText, candidateManifest, previousAnalysis) {
    const raw = Buffer.isBuffer(logText) ? logText : Buffer.from(String(logText));
    const identity = candidateManifest?.identity;
    const report = { schema: 'triangle-frame-color-log-analysis-v1', status: 'STOP', packageId: identity?.packageId ?? null,
        candidateIdentitySha256: identity ? sha(canonical(identity)) : null,
        rawLogSha256: sha(raw), rawLogBytes: raw.length, reasons: [], sessions: [],
        visibleValidation: 'NOT_PROVEN', fpsValidation: 'NOT_MEASURED', lifecycleValidation: 'NOT_PROVEN',
        limits: 'Logs record callback progress and parameters only. They do not prove visible colors, all frames presented, FPS, long-term stability, or successful lifecycle recovery. Missing samples do not prove RAF stopped. No automatic phone action is authorized by this report.' };
    const reject = reason => { if (!report.reasons.includes(reason)) report.reasons.push(reason); };
    if (!identity || !/^native-glx-validation-[a-f0-9]{20}$/.test(identity.packageId || '')) reject('Invalid candidate identity');
    const sessions = new Map(); let active = null;
    const parse = (line, prefix, number) => {
        try { const result = JSON.parse(line.slice(line.indexOf(prefix) + prefix.length).trim()); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; }
        catch (_) { reject(`Invalid ${prefix} JSON at line ${number}`); return null; }
    };
    for (const [index, line] of raw.toString('utf8').split(/\r?\n/).entries()) {
        const number = index + 1;
        if (/^\s*\[(?:error|fatal)\]/i.test(line) || /(?:RuntimeError:|Aborted\(|drawing buffer size failed|shader compile failed:|program link failed:|Uncaught\s)/.test(line)) reject(`Runtime error at line ${number}`);
        if (line.includes('[GLX_TRIANGLE_EVIDENCE]')) {
            const event = parse(line, '[GLX_TRIANGLE_EVIDENCE]', number); if (!event) continue;
            if (event.packageId !== identity?.packageId) reject(`Package mismatch at line ${number}`);
            if (typeof event.sessionTag !== 'string' || !event.sessionTag) { reject(`Missing session at line ${number}`); continue; }
            if (event.kind === 'entry') {
                if (sessions.has(event.sessionTag)) reject(`Repeated entry for session ${event.sessionTag}`);
                else {
                    active = { sessionTag: event.sessionTag, packageId: event.packageId, entryLine: number, sdkVersion: event.detail?.sdkVersion,
                        samples: [], lifecycleEvents: [], shaderObservations: [], rawShaderObservations: [], hostSnapshots: [], lastSequence: 0, twoCyclesAndNextRedObserved: false };
                    sessions.set(event.sessionTag, active); report.sessions.push(active);
                }
                if (event.detail?.sdkVersion !== '3.17.5') reject(`Actual entry SDK must be 3.17.5 at line ${number}`);
            }
            const session = sessions.get(event.sessionTag);
            if (!session || session !== active) { reject(`Event has no active session at line ${number}`); continue; }
            if (!Number.isInteger(event.sequence) || event.sequence <= session.lastSequence) reject(`Invalid evidence sequence at line ${number}`);
            session.lastSequence = event.sequence;
            if (['error', 'unhandledRejection', 'blocked'].includes(event.kind) || event.detail?.status === 'blocked' || event.detail?.summary?.status === 'blocked') reject(`Error/blocked evidence at line ${number}`);
            if (event.kind === 'host') session.hostSnapshots.push(event.detail?.summary);
            if (event.kind === 'shader') session.shaderObservations.push(event.detail);
            if (['show', 'hide', 'stage'].includes(event.kind)) session.lifecycleEvents.push({ kind: event.kind, sequence: event.sequence, logLine: number });
        }
        for (const [prefix, field] of [['[GLX_TRIANGLE_SHADER]', 'rawShaderObservations'], ['[GLX_TRIANGLE_COLOR]', 'samples']]) {
            if (!line.includes(prefix)) continue;
            const sample = parse(line, prefix, number); if (!sample) continue;
            if (!active) { reject(`Sample before entry at line ${number}`); continue; }
            active[field].push(field === 'samples' ? { ...sample, logLine: number } : sample);
        }
    }
    if (!report.sessions.length) reject('No complete session entry');
    for (const session of report.sessions) {
        const label = session.sessionTag;
        if (session.hostSnapshots.length !== 1) reject(`Expected one host snapshot in ${label}`);
        for (const host of session.hostSnapshots) {
            if (!host || host.status !== 'initialization-snapshot' || host.mode !== 'GLX' || host.actualMode !== 'glx' || host.actualContextMetadataMatch !== true || host.actualContextCanvasMatch !== true) reject(`Host GLX gate failed in ${label}`);
            for (const key of Object.keys(identity || {})) if (canonical(host?.[key]) !== canonical(identity[key])) reject(`Host identity mismatch ${key} in ${label}`);
        }
        for (const [field, shaderList] of [['structured', session.shaderObservations], ['raw', session.rawShaderObservations]]) {
            if (shaderList.length !== 2) reject(`Expected two ${field} shader observations in ${label}`);
            for (const [i, shader] of shaderList.entries()) {
                const type = [35633, 35632][i];
                if (!shader || shader.schema !== 'triangle-shader-type-v1' || shader.stage !== 'created-before-source' || shader.expectedType !== type || shader.returnedType !== type || shader.readOrdinal !== i + 1 || !Number.isInteger(shader.shaderId) || shader.shaderId <= 0 || !Number.isInteger(shader.publicContextHandle) || shader.publicContextHandle <= 0) reject(`Invalid ${field} shader observation in ${label}`);
            }
        }
        if (canonical(session.shaderObservations) !== canonical(session.rawShaderObservations)) reject(`Raw/structured shader mismatch in ${label}`);
        let handle = null;
        for (const [i, sample] of session.samples.entries()) {
            const phase = i % 3;
            if (sample.schema !== 'triangle-frame-color-v1' || sample.frame !== i * 60 + 1 || sample.sampleOrdinal !== i + 1 || sample.phaseIndex !== phase || sample.color !== names[phase] || canonical(sample.rgbaComputed) !== canonical(rgba[phase]) || sample.sampleLimit !== 180 || sample.budgetExhausted !== (i === 179)) reject(`Color sample field/order mismatch in ${label} ordinal ${i + 1}`);
            if (!Number.isInteger(sample.publicContextHandle) || sample.publicContextHandle <= 0 || (handle !== null && sample.publicContextHandle !== handle)) reject(`Public context mismatch in ${label}`);
            handle = sample.publicContextHandle;
            if (sample.budgetExhausted === true || i >= 179) reject(`Sample budget reached/exceeded in ${label}; stop collection`);
        }
        for (const shader of session.shaderObservations) if (handle !== null && shader?.publicContextHandle !== handle) reject(`Shader/public context mismatch in ${label}`);
        session.twoCyclesAndNextRedObserved = session.samples.length >= 7 && session.samples.some(s => s.frame === 361 && s.phaseIndex === 0 && s.color === 'red');
        if (!session.twoCyclesAndNextRedObserved) reject(`Insufficient two RGB cycles plus frame 361 red in ${label}; no automatic follow-up`);
        session.lastFrame = session.samples.at(-1)?.frame ?? null;
        delete session.lastSequence;
    }
    if (previousAnalysis !== undefined) {
        report.cumulativeDiff = diff(previousAnalysis, report);
        for (const reason of report.cumulativeDiff.reasons) reject(reason);
    }
    if (!report.reasons.length) report.status = 'COLOR_CALLBACK_CYCLES_OBSERVED';
    return report;
}

export function cli(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
        if (!['--log', '--candidate', '--out', '--previous'].includes(argv[i]) || options[argv[i]] || !argv[i + 1] || !path.isAbsolute(argv[i + 1])) throw Error('Expected unique absolute --log --candidate --out and optional --previous paths');
        options[argv[i]] = argv[i + 1];
    }
    if (!options['--log'] || !options['--candidate'] || !options['--out']) throw Error('Missing --log --candidate --out');
    let raw = Buffer.alloc(0), manifest, report;
    try {
        raw = fs.readFileSync(options['--log']); manifest = JSON.parse(fs.readFileSync(options['--candidate'], 'utf8'));
        const previous = options['--previous'] ? JSON.parse(fs.readFileSync(options['--previous'], 'utf8')) : undefined;
        report = analyze(raw, manifest, previous);
    } catch (error) { report = analyze(raw, manifest); report.status = 'STOP'; report.reasons.push(`Input failure: ${error.message}`); }
    report.rawLogPath = options['--log']; report.candidatePath = options['--candidate'];
    fs.writeFileSync(options['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { const result = cli(process.argv.slice(2)); console.log(JSON.stringify(result)); if (result.status === 'STOP') process.exitCode = 2; }
    catch (error) { console.error(error.message); process.exitCode = 2; }
}
