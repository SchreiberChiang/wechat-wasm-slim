#!/usr/bin/env node
// 总入口：只做转发。node wxslim.mjs <convert|trim|split> <子命令> [--config wxslim.json] ...
// 另外 `node wxslim.mjs config --config wxslim.json` 校验统一配置并打印合并后的值（私密值只显示“已设置”）。
import path from 'node:path';import {spawnSync} from 'node:child_process';
import {loadGameConfig, describe} from './lib/game-config.mjs';

const home = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const TOOLS = {convert: 'convert/convert.mjs', trim: 'trim/trim.mjs', split: 'split/kit.mjs'};
const [tool, ...rest] = process.argv.slice(2);
const USAGE = '用法：node wxslim.mjs <convert|trim|split> <子命令> [--config wxslim.json] ...\n      node wxslim.mjs config --config wxslim.json   # 校验统一配置，打印合并后的值';

if (tool === 'config') {
  const i = rest.indexOf('--config');
  try {
    if (i < 0 || !rest[i + 1]) throw Error('缺少参数 --config');
    const g = loadGameConfig(rest[i + 1]);
    console.log(`配置 ${g.file}${g.privateFile ? `\n私密配置 ${g.privateFile}（已合并）` : '\n（同目录没有 wxslim.private.json）'}`);
    console.log(JSON.stringify(describe(g), null, 2)); console.log('校验通过。');
  } catch (e) { console.error('错误：', e.message); process.exitCode = 1; }
} else if (TOOLS[tool]) {
  const r = spawnSync(process.execPath, [path.join(home, TOOLS[tool]), ...rest], {stdio: 'inherit'});
  process.exitCode = r.status ?? 1;
} else { console.error(USAGE); process.exitCode = tool ? 1 : 0; }
