// 本机临时 CDN：把 OUTPUT/cdn/ 用 http 放到局域网上，测试 CDN 远程分包用。只读、只回 GET/HEAD，只给 cdn 目录里的文件。
// 上线要换成自己的 HTTPS CDN（并加进小游戏后台的 downloadFile 合法域名），这个服务只用于开发者工具和手机预览调试。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CDN_PORT = 8686;
export const HEALTH_PATH = '/__wxslim_cdn';

/** 局域网 IPv4 地址，常见家用网段排前面。 */
export function lanAddresses() {
  const list = [];
  for (const items of Object.values(os.networkInterfaces())) for (const item of items ?? [])
    if (item.family === 'IPv4' && !item.internal) list.push(item.address);
  const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return [...new Set(list)].sort((a, b) => rank(a) - rank(b));
}

export function createCdnServer(root, {log = () => {}} = {}) {
  const base = fs.realpathSync(root);
  return http.createServer((req, res) => {
    const reply = (code, text) => { res.writeHead(code, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(req.method === 'HEAD' ? undefined : text); };
    if (!['GET', 'HEAD'].includes(req.method)) return reply(405, 'method not allowed');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { return reply(400, 'bad url'); }
    if (pathname === HEALTH_PATH) return reply(200, 'wxslim-cdn');
    if (!/^\/[A-Za-z0-9_.\/-]+$/.test(pathname) || pathname.split('/').some(p => p === '..' || p === '.')) { log(`拒绝 ${pathname}`); return reply(404, 'not found'); }
    let file;
    try {
      file = fs.realpathSync(path.join(base, ...pathname.slice(1).split('/')));
      if (path.relative(base, file).startsWith('..') || path.isAbsolute(path.relative(base, file)) || !fs.statSync(file).isFile()) throw Error('outside');
    } catch { log(`没有 ${pathname}`); return reply(404, 'not found'); }
    const size = fs.statSync(file).size;
    res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache'});
    log(`${req.method} ${pathname} ${size} 字节 → ${req.socket.remoteAddress}`);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/** 启动服务；端口被占用且占用的就是本服务时返回 {already:true}。 */
export function serveCdn({root, port = DEFAULT_CDN_PORT, host = '0.0.0.0', log = () => {}}) {
  fs.mkdirSync(root, {recursive: true});
  const server = createCdnServer(root, {log});
  return new Promise((resolve, reject) => {
    server.once('error', async error => {
      if (error.code !== 'EADDRINUSE') return reject(error);
      try {
        const res = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`);
        if (res.ok && (await res.text()) === 'wxslim-cdn') return resolve({already: true, port, addresses: lanAddresses()});
      } catch {}
      reject(Object.assign(Error(`端口 ${port} 被别的程序占用了`), {code: 'CDN_PORT_IN_USE'}));
    });
    server.listen(port, host, () => resolve({server, port, addresses: lanAddresses()}));
  });
}
