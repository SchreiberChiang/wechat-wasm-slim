// 演示用登录 + 排行榜服务：HTTP（微信登录或游客登录、提交分数、排行榜）+ WebSocket（在线人数、动态）。
// 只用于小游戏适配测试。返回给游戏的文字用英文（游戏里没有中文字体）。无静态文件；请求体、频率、连接数都有上限；不记录 token、openid、AppSecret。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {WebSocketServer} from 'ws';

const PORT = Number(process.env.PORT || 8888);
const HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || new URL('./data', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const USERS_FILE = path.join(DATA, 'users.json');
const MAX_USERS = 1000, MAX_WS = 200, MAX_BODY = 4096, TOKEN_TTL_MS = 24 * 3600e3;

fs.mkdirSync(DATA, {recursive: true});
const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : {};
const sessions = new Map(); // token -> {id, expires}
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFileSync(USERS_FILE + '.tmp', JSON.stringify(users)) || fs.renameSync(USERS_FILE + '.tmp', USERS_FILE), 200); };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 每个 IP 每分钟的请求上限
const hits = new Map();
function limited(ip, key, max) {
  const k = ip + '|' + key, now = Date.now(), h = hits.get(k);
  if (!h || now - h.t > 60e3) { hits.set(k, {t: now, n: 1}); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 60e3) hits.delete(k); for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t); }, 60e3).unref();

// 微信登录配置：server/wx.private.json {"appid": "...", "secret": "..."}，或环境变量 WX_APPID / WX_APPSECRET。
// 由使用者自己填写；本服务不打印、不回传这两个值。没有配置时只能游客登录。
const WX = (() => {
  const f = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'wx.private.json');
  const c = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {appid: process.env.WX_APPID, secret: process.env.WX_APPSECRET};
  return c.appid && c.secret ? c : null;
})();

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// 2D、3D 分开计最高分：best（2D）、best3d（3D）
const MODES = {'2d': 'best', '3d': 'best3d'};
const top = (mode = '2d') => { const k = MODES[mode]; return Object.values(users).filter(u => u[k] > 0).map(u => ({name: u.name, best: u[k]})).sort((a, b) => b.best - a.best).slice(0, 5); };
const NAME_RE = /^[A-Za-z0-9_ -]{2,12}$/;
const auth = req => { const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || ''); const s = m && sessions.get(m[1]); return s && s.expires > Date.now() ? s.id : null; };
// 用户不存在就创建；显示名是前缀 + 哈希前 6 位
function login(id, prefix, ip) {
  let u = users[id], created = false;
  if (!u) {
    if (Object.keys(users).length >= MAX_USERS) return [503, {error: 'registration full'}];
    u = users[id] = {name: prefix + id.split(':')[1].slice(0, 6), best: 0, created: Date.now()}; created = true; save();
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {id, expires: Date.now() + TOKEN_TTL_MS});
  log(created ? '新用户' : '登录', u.name, id.split(':')[0], ip);
  return [200, {token, name: u.name, best: u.best, best3d: u.best3d || 0, created}];
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store'});
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(Error('body too large'), {code: 413})); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(Error('invalid JSON'), {code: 400})); } });
    req.on('error', reject);
  });
}

const routes = {
  'GET /healthz': async () => [200, {ok: true, online: wss.clients.size}],
  'GET /api/top': async (req) => [200, {top: top(new URL(req.url, 'http://x').searchParams.get('mode') === '3d' ? '3d' : '2d')}],
  // 改显示名（游戏里没有中文字体，只允许英文字母、数字、空格、_ 和 -）
  'POST /api/name': async (req, ip) => {
    const id = auth(req); if (!id) return [401, {error: 'please log in again'}];
    if (limited(ip, 'name', 10)) return [429, {error: 'too many renames'}];
    const {name} = await readJson(req);
    if (typeof name !== 'string' || !NAME_RE.test(name.trim())) return [400, {error: 'name: 2-12 letters, digits, space, _ or -'}];
    const u = users[id], old = u.name; u.name = name.trim(); save();
    log('改名', old, '->', u.name);
    return [200, {name: u.name}];
  },
  // 微信登录：游戏里 wx.login 拿到 code，这里换 openid。只保存 openid 的哈希，不保存原文和 session_key。
  'POST /api/wxlogin': async (req, ip) => {
    if (limited(ip, 'login', 20)) return [429, {error: 'too many logins, try later'}];
    if (!WX) return [503, {error: 'wechat login not configured on server'}];
    const {code} = await readJson(req);
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) return [400, {error: 'invalid code'}];
    const q = new URLSearchParams({appid: WX.appid, secret: WX.secret, js_code: code, grant_type: 'authorization_code'});
    let r;
    try { r = await (await fetch('https://api.weixin.qq.com/sns/jscode2session?' + q, {signal: AbortSignal.timeout(8000)})).json(); }
    catch (e) { log('微信接口失败', e.message); return [502, {error: 'wechat api unreachable'}]; }
    if (!r.openid) { log('微信 code 换取失败 errcode', r.errcode); return [401, {error: `wechat login failed (${r.errcode ?? '?'})`}]; }
    return login('wx:' + sha(WX.appid + ':' + r.openid), 'P', ip);
  },
  // 电脑或浏览器（没有微信）时的游客登录：设备号由客户端随机生成并保存在本地。
  'POST /api/guest': async (req, ip) => {
    if (limited(ip, 'login', 20)) return [429, {error: 'too many logins, try later'}];
    const {deviceId} = await readJson(req);
    if (typeof deviceId !== 'string' || !/^[0-9a-f]{32}$/.test(deviceId)) return [400, {error: 'invalid device id'}];
    return login('guest:' + sha(deviceId), 'G', ip);
  },
  'POST /api/score': async (req, ip) => {
    const id = auth(req); if (!id) return [401, {error: 'please log in again'}];
    if (limited(ip, 'score', 30)) return [429, {error: 'too many submits'}];
    const {score, mode = '2d'} = await readJson(req);
    if (!Number.isInteger(score) || score < 0 || score > 100000) return [400, {error: 'invalid score'}];
    if (!MODES[mode]) return [400, {error: 'invalid mode'}];
    const u = users[id], k = MODES[mode], record = score > (u[k] || 0); if (record) { u[k] = score; save(); }
    broadcast({type: 'feed', text: `${u.name} scored ${score} in ${mode.toUpperCase()}${record ? ' (new best!)' : ''}`});
    log('分数', u.name, mode, score);
    return [200, {best: u[k], record, top: top(mode)}];
  },
};

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '?';
  if (limited(ip, 'all', 300)) return send(res, 429, {error: 'too many requests'});
  const route = routes[`${req.method} ${(req.url || '').split('?')[0]}`];
  if (!route) return send(res, 404, {error: 'not found'});
  try { const [code, body] = await route(req, ip); send(res, code, body); }
  catch (e) { send(res, e.code || 500, {error: e.code ? e.message : 'server error'}); if (!e.code) log('错误', e.message); }
});
server.headersTimeout = 10e3; server.requestTimeout = 15e3;

// WebSocket：连上后第一条消息必须是 {type:"auth", token}，否则 5 秒后断开。token 不放 URL。
const wss = new WebSocketServer({server, path: '/ws', maxPayload: 1024});
function broadcast(msg) { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.username && c.readyState === 1) c.send(s); }
const online = () => broadcast({type: 'online', count: [...wss.clients].filter(c => c.username).length});
wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_WS) return ws.close(1013, 'busy');
  const timer = setTimeout(() => ws.close(4001, 'auth timeout'), 5e3);
  ws.on('message', data => {
    let msg; try { msg = JSON.parse(String(data)); } catch { return ws.close(4002, 'bad json'); }
    if (!ws.username) {
      const s = msg.type === 'auth' && typeof msg.token === 'string' && sessions.get(msg.token);
      if (!s || s.expires < Date.now()) return ws.close(4003, 'auth failed');
      clearTimeout(timer); ws.username = users[s.id].name; ws.since = Date.now();
      ws.send(JSON.stringify({type: 'welcome', name: ws.username}));
      log('WS 连接', ws.username); online(); return;
    }
    if (msg.type === 'ping') ws.send(JSON.stringify({type: 'pong', t: msg.t}));
  });
  // 断开码和原因写进日志，用来排查手机上的掉线（1000 正常关闭，1001 离开，1006 异常断开）
  ws.on('close', (code, reason) => { clearTimeout(timer); if (ws.username) { log('WS 断开', ws.username, 'code=' + code, String(reason || '').slice(0, 60), Math.round((Date.now() - ws.since) / 1000) + 's'); online(); } });
  ws.on('error', () => {});
});

server.listen(PORT, HOST, () => log(`服务已启动 http://${HOST}:${PORT}（数据目录 ${DATA}）`));
