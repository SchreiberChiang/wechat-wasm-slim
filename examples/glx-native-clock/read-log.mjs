import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const limits = 'Two samples prove only callback reach to frame 61 and the recorded parameters; they do not prove every frame was presented or long-term stability. Missing frame 61 does not prove RAF stopped. Numeric models do not prove the executed source path.';
export function analyze(logText, candidateManifest) {
    const raw = Buffer.isBuffer(logText) ? logText : Buffer.from(String(logText));
    const report = { schema: 'triangle-clock-log-analysis-v1', status: 'STOP',
        rawLogSha256: hash(raw), rawLogBytes: raw.length, reasons: [], samples: [],
        evidenceCounts: {}, lifecycleValidation: 'NOT_RUN', presentationValidation: 'NOT_PROVEN', limits };
    const reject = reason => { if (!report.reasons.includes(reason)) report.reasons.push(reason); };
    const identity = candidateManifest?.identity;
    if (!identity || typeof identity.packageId !== 'string' || !/^native-glx-validation-[a-f0-9]{20}$/.test(identity.packageId)) reject('Invalid candidate identity');
    report.packageId = identity?.packageId ?? null;
    const evidence = [], clocks = [];
    for (const [index, line] of raw.toString('utf8').split(/\r?\n/).entries()) {
        if (/^\s*\[(?:error|fatal)\]/i.test(line) || /(?:RuntimeError:|Aborted\(|drawing buffer size failed|shader compile failed:|program link failed:|Uncaught\s)/.test(line)) reject(`Runtime error at line ${index + 1}`);
        for (const [prefix, target] of [['[GLX_TRIANGLE_EVIDENCE]', evidence], ['[GLX_TRIANGLE_CLOCK]', clocks]]) {
            const at = line.indexOf(prefix);
            if (at < 0) continue;
            try {
                const value = JSON.parse(line.slice(at + prefix.length).trim());
                if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('object required');
                target.push({ value, line: index + 1 });
            } catch (_) { reject(`Invalid ${prefix} JSON at line ${index + 1}`); }
        }
    }
    const packages = new Set(), sessions = new Set(), sequences = new Set();
    let lastSequence = 0;
    for (const { value: event, line } of evidence) {
        report.evidenceCounts[event.kind] = (report.evidenceCounts[event.kind] || 0) + 1;
        packages.add(event.packageId); sessions.add(event.sessionTag);
        if (event.packageId !== identity?.packageId) reject(`Package mismatch at line ${line}`);
        if (typeof event.sessionTag !== 'string' || !event.sessionTag) reject(`Missing session at line ${line}`);
        if (!Number.isInteger(event.sequence) || event.sequence <= lastSequence || sequences.has(event.sequence)) reject(`Invalid evidence sequence at line ${line}`);
        sequences.add(event.sequence); lastSequence = event.sequence;
        if (['error', 'unhandledRejection', 'blocked'].includes(event.kind) || event.detail?.status === 'blocked') reject(`Error evidence at line ${line}`);
    }
    if (packages.size !== 1 || sessions.size !== 1) reject('Expected one package and one session');
    report.sessionTag = sessions.size === 1 ? [...sessions][0] : null;
    const entries = evidence.filter(item => item.value.kind === 'entry');
    const hosts = evidence.filter(item => item.value.kind === 'host');
    if (entries.length !== 1) reject('Expected exactly one entry');
    if (entries.some(item => item.value.detail?.sdkVersion !== '3.17.5')) reject('Actual entry SDK must be 3.17.5');
    if (hosts.length !== 1) reject('Expected exactly one host snapshot');
    for (const { value: event } of hosts) {
        const summary = event.detail?.summary;
        if (!summary || summary.status !== 'initialization-snapshot' || summary.mode !== 'GLX' || summary.actualMode !== 'glx' || summary.actualContextMetadataMatch !== true || summary.actualContextCanvasMatch !== true) reject('Host GLX snapshot gate failed');
        if (summary?.packageId !== identity?.packageId) reject('Host package mismatch');
        for (const key of ['variant', 'jsSha256', 'wasmSha256', 'sourceSha256', 'librarySha256', 'pinSha256', 'preludeTemplateSha256', 'generatorSha256']) {
            if (identity?.[key] !== undefined && summary?.[key] !== identity[key]) reject(`Host identity mismatch: ${key}`);
        }
        if (identity?.files && JSON.stringify(summary?.files) !== JSON.stringify(identity.files)) reject('Host file identity mismatch');
    }
    if (clocks.length !== 2) reject('Expected exactly two clock samples at frames 1 and 61; absence does not establish RAF failure');
    for (const [index, { value: sample, line }] of clocks.entries()) {
        report.samples.push({ ...sample, logLine: line });
        if (sample.schema !== 'triangle-clock-two-frame-v1' || sample.frame !== [1, 61][index] || sample.sampleOrdinal !== index + 1) reject(`Unexpected sample schema/order at line ${line}`);
        for (const key of ['rawClockDouble', 'secondsBeforeFloat', 'phaseAfterFloat', 'wave', 'referenceWallMs']) if (!Number.isFinite(sample[key])) reject(`Invalid sample number ${key} at line ${line}`);
        if (!Number.isInteger(sample.publicContextHandle) || sample.publicContextHandle <= 0) reject(`Invalid public context handle at line ${line}`);
        if (!Array.isArray(sample.rgbaComputed) || sample.rgbaComputed.length !== 4 || !sample.rgbaComputed.every(Number.isFinite)) reject(`Invalid RGBA at line ${line}`);
        if (entries.length === 1 && line <= entries[0].line) reject('Clock sample precedes session entry');
    }
    if (report.samples.length === 2) {
        const [a, b] = report.samples;
        const delta = key => Number.isFinite(a[key]) && Number.isFinite(b[key]) ? b[key] - a[key] : null;
        const rawDelta = delta('rawClockDouble'), referenceDelta = delta('referenceWallMs');
        const ratio = rawDelta !== null && referenceDelta > 0 ? rawDelta / referenceDelta : null;
        report.deltas = { rawClockDouble: rawDelta, secondsBeforeFloat: delta('secondsBeforeFloat'), phaseAfterFloat: delta('phaseAfterFloat'), wave: delta('wave'), referenceWallMs: referenceDelta,
            rgbaComputed: Array.isArray(a.rgbaComputed) && Array.isArray(b.rgbaComputed) ? b.rgbaComputed.map((v, i) => v - a.rgbaComputed[i]) : null };
        report.clockUnitRatioRawPerReferenceMs = ratio;
        report.clockUnitIndication = ratio === null ? 'INDETERMINATE' : ratio >= 0.0005 && ratio <= 0.002 ? 'RAW_NEAR_SECONDS_PER_REFERENCE_MS' : ratio >= 0.5 && ratio <= 2 ? 'RAW_NEAR_MILLISECONDS_PER_REFERENCE_MS' : 'OTHER_OR_INDETERMINATE';
        report.rawChangesWhileFloatPhaseUnchanged = rawDelta !== null && rawDelta !== 0 && delta('phaseAfterFloat') === 0;
        report.numericModel = { meaning: 'Comparison only; not proof of actual source execution', samples: report.samples.map(s => ({ frame: s.frame, rawDiv1000: s.rawClockDouble / 1000, f32PhaseFromRecordedSeconds: Math.fround(s.secondsBeforeFloat) })) };
        if (a.publicContextHandle !== b.publicContextHandle) reject('Public context handle changed between samples');
    }
    if (!report.reasons.length) report.status = 'TWO_SAMPLES_OBSERVED';
    return report;
}

export function cli(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
        if (!['--log', '--candidate', '--out'].includes(argv[i]) || options[argv[i]] || !argv[i + 1] || !path.isAbsolute(argv[i + 1])) throw Error('Expected unique absolute --log --candidate --out paths');
        options[argv[i]] = argv[i + 1];
    }
    if (Object.keys(options).length !== 3) throw Error('Missing --log --candidate --out');
    let raw = Buffer.alloc(0), report;
    try {
        raw = fs.readFileSync(options['--log']);
        report = analyze(raw, JSON.parse(fs.readFileSync(options['--candidate'], 'utf8')));
    } catch (error) {
        report = analyze(raw, null);
        report.reasons.push(`Input failure: ${error.message}`);
        report.rawLogRead = raw.length > 0;
    }
    report.rawLogPath = options['--log']; report.candidatePath = options['--candidate'];
    fs.writeFileSync(options['--out'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { const report = cli(process.argv.slice(2)); console.log(JSON.stringify(report)); if (report.status === 'STOP') process.exitCode = 2; }
    catch (error) { console.error(error.message); process.exitCode = 2; }
}
