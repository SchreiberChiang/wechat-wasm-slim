#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
// 总入口：只做转发。node wxslim.mjs <convert|trim|split> <子命令> [--config wxslim.json] ...
// 另外 `node wxslim.mjs config --config wxslim.json` 校验统一配置并打印合并后的值（私密值只显示“已设置”）。
import path from 'node:path';import {spawnSync} from 'node:child_process';
import {loadGameConfig, describe} from './lib/game-config.mjs';
import {capabilitiesCommand} from './lib/capabilities.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = {resources: 'lib/resource-pack-cli.mjs', engine: 'engine/fixed-engine.mjs', official: 'convert/official.mjs', convert: 'convert/convert.mjs', trim: 'trim/trim.mjs', split: 'split/kit.mjs'};
const [tool, ...rest] = process.argv.slice(2);
const USAGE = '用法：node wxslim.mjs <convert|trim|split> <子命令> [--config wxslim.json] ...\n      node wxslim.mjs quick init|plan GAME_DIR   # 快速流程：生成设置模板 / 只读检查\n      node wxslim.mjs quick run GAME_DIR --write [--open]   # 快速流程：导出并转换，可选打开开发者工具\n      node wxslim.mjs task list|plan REQUEST.json   # 共用任务门禁，不执行\n      node wxslim.mjs task execute REQUEST.json --write   # 仅已批准输出范围\n      node wxslim.mjs resources source-plan PROJECT.godot   # 接收器接入计划，不改项目\n      node wxslim.mjs resources boot-check REQUEST.json   # 原项目与实际启动PCK接线只读核对\n      node wxslim.mjs resources plan CONFIG.json   # 多PCK结构及依赖只读规划\n      node wxslim.mjs resources interfaces-check REQUEST.json   # 只读组装校验，不写运行包\n      node wxslim.mjs resources partition-check CONFIG.json   # 最终PCK内存拆分/逐文件审计，不写包\n      node wxslim.mjs resources lab-plan CONFIG.json   # 最小原生PCK实验计划\n      node wxslim.mjs resources lab-execute CONFIG.json --write   # 仅已批准的新小目录\n      node wxslim.mjs resources <lab-status|lab-cancel> TASK_ROOT TASK_ID\n      node wxslim.mjs engine plan INPUTS.json   # 固定full/conservative计划，不构建\n      node wxslim.mjs engine custom-plan CONFIG.json   # 自定义2D/3D、模块和类的只读计划，不构建\n      node wxslim.mjs engine custom-pair-check RAW_TASK_ROOT TASK_ID   # 重新核对自定义构建并内存派生，不写文件或放行转换\n      node wxslim.mjs engine build-plan REQUEST.json   # 真实执行流程的只读计划\n      node wxslim.mjs engine execute REQUEST.json --write   # 仅已批准的新构建目录\n      node wxslim.mjs engine <status|cancel|audit> TASK_ROOT TASK_ID\n      node wxslim.mjs engine official-toolchain-plan REQUEST.json   # 独立工具链只读计划，不安装\n      node wxslim.mjs engine official-capability-plan <full|conservative>   # 功能修正版完整源码配方，只读\n      node wxslim.mjs engine official-prepare-check CONFIG.json   # 官方raw配对准备只读核验\n      node wxslim.mjs engine official-prepare-execute CONFIG.json --write   # 仅写到已批准的既有目录\n      node wxslim.mjs official <check|plan|audit> INPUTS.json   # 只读\n      node wxslim.mjs official execute INPUTS.json --write   # 已批准的新任务目录\n      node wxslim.mjs official <status|cancel> TASK_ROOT TASK_ID\n      node wxslim.mjs config --config wxslim.json   # 校验统一配置，打印合并后的值\n      node wxslim.mjs capabilities [--request <JSON>]   # 只读能力清单及证据范围评估';

if (tool === 'capabilities') {
  try {
    const result = capabilitiesCommand(rest);
    console.log(JSON.stringify(result, null, 2));
    if (result.eligible === false) process.exitCode = 2;
  } catch (e) {
    console.log(JSON.stringify({schema:'wxslim-capability-error-v1', code:e.code || 'CAPABILITY_READ_FAILED', message:e.code ? e.message : '能力清单读取失败', executionAuthorized:false}));
    process.exitCode = 2;
  }
} else if (tool === 'config') {
  const i = rest.indexOf('--config');
  try {
    if (i < 0 || !rest[i + 1]) throw Error('缺少参数 --config');
    const g = loadGameConfig(rest[i + 1]);
    console.log(`配置 ${g.file}${g.privateFile ? `\n私密配置 ${g.privateFile}（已合并）` : '\n（同目录没有 wxslim.private.json）'}`);
    console.log(JSON.stringify(describe(g), null, 2)); console.log('校验通过。');
  } catch (e) { console.error('错误：', e.message); process.exitCode = 1; }
} else if (tool === 'quick') {
  // 快速流程只生成与面板相同的请求，再走共用任务核心的计划与执行门禁。
  const {runQuickCli}=await import('./lib/quick-cli.mjs');
  process.exitCode=await runQuickCli(rest);
} else if (tool === 'task') {
  const {runTaskCli}=await import('./lib/task-core.mjs');
  process.exitCode=await runTaskCli(rest);
} else if (tool === 'engine') {
  // Same process: fixed builder owns its signal handlers and child-close wait.
  // Avoid an additional synchronous wrapper around the long-running task.
  const {runEngineCli}=await import('./engine/fixed-engine.mjs');
  process.exitCode=await runEngineCli(rest);
} else if (TOOLS[tool]) {
  const r = spawnSync(process.execPath, [path.join(home, TOOLS[tool]), ...rest], {stdio: 'inherit'});
  process.exitCode = r.status ?? 1;
} else { console.error(USAGE); process.exitCode = tool ? 1 : 0; }
