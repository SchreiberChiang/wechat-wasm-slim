# 本轮提交推送范围（2026-11-03已获用户确认）

目标仓库 `SchreiberChiang/wechat-wasm-slim`，当前分支 `codex/glx-godot-newlib-20261026`，整理开始时HEAD `d5fbbaa90c920598ddce7bd191e84415227adc84`。用户已确认仅提交以下11个文件并普通推送当前分支；本文保存提交前核验范围，实际提交号及远端终态以Git记录为准。

仅以下11个文件：

| 动作 | 精确仓库相对路径 | 用途 |
|---|---|---|
| 新增 | `engine/alpha-preserve-lighting/baseline-shader-diagnostic.patch` | 原成功构建第1份输入，避免误用另一旧诊断补丁 |
| 新增 | `engine/alpha-preserve-lighting/scene-light-output.patch` | Claude阴影补丁原字节 |
| 新增 | `engine/alpha-preserve-lighting/scene-alpha-output.patch` | Claude自定义灯光alpha补丁原字节 |
| 新增 | `engine/alpha-preserve-lighting/build-settings-20261103.json` | 固定工具链指纹、参数、profile及补丁顺序，无本机私有路径 |
| 新增 | `engine/alpha-preserve-lighting/verify-checkpoint-20261103.mjs` | 只读精确补丁重放、包/父包及JS/WASM配套核验 |
| 修改 | `engine/alpha-preserve-lighting/README.md` | 添加新检查点入口，保留旧历史说明 |
| 新增 | `docs/GLX_LIGHTING_CHECKPOINT_20261103.md` | 修复原理、验证边界、构建步骤及未解决项 |
| 新增 | `docs/evidence/GLX_LIGHTING_DELIVERY_20261103.json` | 新权威身份清单，历史错字段另区记录 |
| 新增 | `docs/evidence/GLX_LIGHTING_VALIDATION_20261103.json` | 已有日志的脱敏环境、原件SHA及按轮核验结果 |
| 新增 | `docs/GLX_LIGHTING_REGRESSION_MINIMUM_20261103.md` | 一场景八页/19阶段的最少复核计划，全部待实施/验收 |
| 新增 | `docs/GLX_LIGHTING_COMMIT_SCOPE_20261103.md` | 本精确白名单及提交边界 |

提交主题：`docs(glx): preserve verified lighting output patches and delivery identity`。仅按白名单提交并普通推送当前分支，再核对远端确实包含提交。此文件不是推送已执行记录。

## 已有输入，不重拷、不混入

`scene-alpha-restore.patch`、`LICENSE.godot.txt`、`examples/glx-smoke/full-engine.gdbuild`、`trim/lib/build.mjs`均已在仓库；本轮只引用/核验。没有新增引擎源码副本、SDK或构建目录。补丁许可沿用Godot MIT和目录许可说明；官方静态库、作者二进制及宿主/素材分发许可不因本记录自动取得。

工作区原有 `.gitignore`、两份20261101检查点文件修改，以及其他未跟踪历史实验/8项场景实现，不属于此次白名单；不能用 `git add .`。禁止混入JS/WASM/PCK、官方库、原始日志/截图、AppID、账户/设备ID、私有配置或绝对路径。

## 提交前核验快照

- PASS：四补丁原件SHA和内存精确应用；9个源文件等于成功构建；新旧各30个payload哈希；BR解压等于WASM；JS只有官方ID函数体派生；原库哈希；成功BUILD记录和12个现存工具文件指纹；新脚本和包JS语法检查。
- 已重新解析现存2份手机日志及60份安卓云测日志；保留已知JSONL头行分类、错误/警告计数和完整原件SHA，不附原始私人材料。iOS云测截图/报告单独标明证据强度。
- 未执行：本轮构建、运行、上传、手机操作、八项回归、干净重建、后台体验版指向查询、Git提交/推送。
- `return 0`保持当前已测组合，是否必须保留尚未验证；阴影/alpha代码修复与这项ID诊断不能混为一谈。
