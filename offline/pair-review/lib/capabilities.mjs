// 阶段0能力台账和只读评估。这里不启动构建/上传，也不是设备验收器。
// 后续任务核心须调用同一评估并重新核验实际产物；不能相信请求里自报的能力状态。
import fs from 'node:fs';

export const CAPABILITY_SCHEMA = 'wxslim-capabilities-v1';
export const STATUS = Object.freeze({
  pending: '待核查', missing: '未实现', implemented: '已实现待验证', verified: '已验证可用', unsupported: '当前配置不支持',
});
const catalogUrl = new URL('./capabilities.json', import.meta.url);
const scopeKeys = ['packageId', 'platform', 'system', 'model', 'wechatVersion', 'sdkVersion', 'backend'];
const requestKeys = new Set(['capability', 'purpose', 'scope']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message) { const e = Error(message); e.code = code; throw e; }

export function validateCatalog(value) {
  if (!isObject(value) || value.schema !== CAPABILITY_SCHEMA || !Array.isArray(value.capabilities) || !isObject(value.evidence)) fail('CAPABILITY_CATALOG_INVALID', '能力清单格式不匹配');
  const ids = new Set();
  for (const c of value.capabilities) {
    if (!isObject(c) || typeof c.id !== 'string' || ids.has(c.id) || !Object.hasOwn(STATUS, c.status) || !Array.isArray(c.sources) || !c.sources.length || !Array.isArray(c.evidence) || typeof c.limit !== 'string') fail('CAPABILITY_CATALOG_INVALID', '能力字段、来源或唯一性不满足要求');
    ids.add(c.id);
    // 整体状态永远不写 verified；验收是绑定候选/设备/版本的证据，不是全局开关。
    if (c.status === 'verified') fail('CAPABILITY_CATALOG_INVALID', 'verified 必须通过有范围的证据求得');
    for (const id of c.evidence) {
      const e = value.evidence[id];
      if (!e || e.kind !== 'device-observation' || !isObject(e.scope) || !scopeKeys.every(k => typeof e.scope[k] === 'string' && e.scope[k]) || typeof e.report !== 'string' || !Array.isArray(e.observations) || !e.observations.length || !Array.isArray(e.logSha256) || !e.logSha256.length || e.logSha256.some(h => !/^[a-f0-9]{64}$/.test(h))) fail('CAPABILITY_CATALOG_INVALID', '设备证据缺少明确范围、日志哈希或报告');
    }
  }
  return value;
}

export function readCapabilities() {
  return validateCatalog(JSON.parse(fs.readFileSync(catalogUrl, 'utf8')));
}

/** 请求可由 GUI/CLI/AI 共同生成；状态、证据不允许从请求注入。无副作用。 */
export function assessCapability(request) {
  if (!isObject(request) || Object.keys(request).some(k => !requestKeys.has(k))) fail('CAPABILITY_REQUEST_INVALID', '只允许 capability、purpose、scope');
  const purpose = request.purpose ?? 'inspect';
  if (!['inspect', 'development-test', 'supported-use'].includes(purpose) || typeof request.capability !== 'string') fail('CAPABILITY_REQUEST_INVALID', '能力标识或评估用途无效');
  const scope = request.scope ?? {};
  if (!isObject(scope) || Object.keys(scope).some(k => !scopeKeys.includes(k)) || Object.values(scope).some(v => typeof v !== 'string' || !v)) fail('CAPABILITY_REQUEST_INVALID', 'scope 含未知字段或空值');
  const catalog = readCapabilities();
  const entry = catalog.capabilities.find(c => c.id === request.capability);
  if (!entry) fail('CAPABILITY_UNKNOWN', '未知能力标识');
  const matched = entry.evidence.filter(id => scopeKeys.every(k => scope[k] === catalog.evidence[id].scope[k]));
  const status = entry.status === 'implemented' && matched.length ? 'verified' : entry.status;
  const eligible = purpose === 'inspect' || status === 'verified' || (purpose === 'development-test' && status === 'implemented');
  const reason = purpose === 'inspect' ? 'INSPECTION_ONLY' : status === 'verified' ? 'EXACT_OBSERVATION_SCOPE' : eligible ? 'DEVELOPMENT_TEST_ONLY' : status === 'implemented' ? 'NO_MATCHING_DEVICE_EVIDENCE' : status === 'pending' ? 'INVESTIGATION_REQUIRED' : status === 'missing' ? 'NOT_IMPLEMENTED' : 'UNSUPPORTED_CONFIGURATION';
  return {
    schema: 'wxslim-capability-assessment-v1', catalogVersion: catalog.version, capability: entry.id,
    purpose, status, statusLabel: STATUS[status], eligible, reason, matchedEvidence: matched,
    observations: matched.flatMap(id => catalog.evidence[id].observations), limit: entry.limit,
    executionAuthorized: false, artifactIntegrityChecked: false, runtimeVerifiedNow: false,
    nextGate: '评估只说明已有证据/实现状态；执行前必须核验实际输入，上传/设备测试另行确认。',
  };
}

/** 严格解析参数，不接受 force/自报 verified 或外部 registry。输出始终为 JSON。 */
export function capabilitiesCommand(args) {
  if (args.length === 0) return {schema: CAPABILITY_SCHEMA, ...readCapabilities(), executionAuthorized: false};
  if (args.length === 1 && args[0] === '--help') return {usage: 'node wxslim.mjs capabilities [--request <JSON>]', purposes: ['inspect', 'development-test', 'supported-use'], scopeKeys, readOnly: true};
  if (args.length !== 2 || args[0] !== '--request') fail('CAPABILITY_ARGUMENT_INVALID', '只支持无参数或 --request <JSON>，不会执行构建/上传');
  let request;
  try { request = JSON.parse(args[1]); } catch { fail('CAPABILITY_REQUEST_INVALID', 'request 必须为 JSON 对象'); }
  return assessCapability(request);
}
