// 面板「启动本机临时服务」用：node cdn-serve.mjs <OUTPUT 目录> [端口]，把 <OUTPUT>/cdn 放到局域网上，一直运行到被结束。
import path from 'node:path';
import {serveCdn, DEFAULT_CDN_PORT} from '../../lib/cdn-serve.mjs';

const [output, portText] = process.argv.slice(2);
if (!output || !path.isAbsolute(output)) { console.error('用法：node cdn-serve.mjs <输出目录绝对路径> [端口]'); process.exit(2); }
const port = portText ? Number(portText) : DEFAULT_CDN_PORT;
const root = path.join(output, 'cdn');
try {
  const started = await serveCdn({root, port, log: line => console.log(new Date().toISOString(), line)});
  const urls = started.addresses.map(ip => `http://${ip}:${port}/`);
  console.log(JSON.stringify({schema: 'wxslim-cdn-serve-v1', root, port, already: Boolean(started.already), urls}));
  if (started.already) process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
