# wechat-wasm-slim：让微信 Godot 小游戏的引擎变小、开局更快

## 能做什么

| 工具 | 做什么 | 适用于 |
|---|---|---|
| **trim（裁剪）** | 去掉游戏用不到的引擎功能，重新编译出更小的 `godot.wasm` | **任何**微信 Godot 小游戏（模板版或通用适配版都行） |
| **split（分包）** | 开局只下载必须的引擎代码，其余等需要时再下载（或者直接不要） | 只适用于**通用适配（WXGameKit）**工程，因为它用的是微信官方的分包服务 |

可以只用一个，也可以两个都用。两个都用时，**先裁剪，再分包**：裁剪会改变引擎，分包要在最终引擎上做。

实测数据（打砖块）：
- 只保留 2D 的裁剪版：引擎 8.69 MB → 5.08 MB。
- 分包：开局只下 3.54 MB，剩余 5.59 MB 点进 3D 时才下。

## 我是哪种工程？

- 工程里有 `engine/godot.wasm.br` 和 `godot-loader.js` → **模板版**：能用 trim，不能用 split。
- 工程里有 `wx-game-kit/config.json`，`game.json` 里有 WXGameKit 插件 → **通用适配版**：trim 和 split 都能用。

## 需要准备什么

**只用裁剪（trim）**
- Windows，Node.js 24，Git。
- 编译环境：微信版 Godot 引擎源码（citizenll/godot 微信分支，本例提交 `df3cdd9bc`）、emscripten 4.0.10、Python 3.9+ 和 SCons 4.4+。路径填进 `trim/trim.toolchain.json`。首次编译前运行 `node trim/trim.mjs check` 检查。
- 你的 Godot 项目目录（有 `project.godot` 的那个），用来扫描。
- 每次编译约 30–50 分钟、约 1 GB 磁盘。

**还要用分包（split）**：再加上下面这些，详见 `split/SETUP.md`。
- 小游戏后台：开发者/体验成员权限、WXGameKit 插件、代码分包私钥。
- 微信开发者工具、`npm install wasmsplit-v2-ci@2.1.5`。
- 安卓和 iPhone 各一台：要人在手机上玩，用来采集和测试。
- 可选的云日志：见 `cloud/README.md`。

## 没有 AI：照着做

**裁剪**
```
node trim/trim.mjs check                                                   # 检查编译环境
node trim/trim.mjs scan --project <Godot项目> --out my.trim.json            # 扫描，生成配置
（打开 my.trim.json：选“当前档位”，在“手动覆盖”里决定保留哪些能力）
node trim/trim.mjs profile --config my.trim.json --out my.gdbuild          # 预览会去掉什么
node trim/trim.mjs build --config my.trim.json --work build-1              # 编译（30–50 分钟）
node trim/trim.mjs apply --engine build-1/artifacts --minigame <小游戏工程> --out <新工程>   # 模板版直接替换
```
然后用微信开发者工具打开新工程，把游戏**完整玩一遍**，确认没有被裁坏。

**分包**（只适用于通用适配版）：见 `split/README.md` 的“新游戏完整流程”。

## 有 AI：交给它

把整个 `wechat-wasm-slim` 文件夹给 AI，并告诉它：
> “用 wechat-wasm-slim 帮我缩小这个小游戏的 WASM：Godot 项目在 `<路径>`，小游戏工程在 `<路径>`。先判断工程类型，裁剪配置给我看过再编译；上传、预览和后台操作前先问我。”

`skill/wechat-wasm-slim/SKILL.md` 是给 AI 的操作说明。可以把这个目录放进 AI 的 skills 目录（Claude Code 是 `~/.claude/skills/`，Codex 是 `~/.codex/skills/`），之后直接说“缩小微信小游戏 WASM”就会用上。

## 裁剪怎么控制保留哪些能力

扫描生成的配置里，每一项都写了用途、扫描依据和风险：
- **当前档位**：
  - `conservative`：只去掉明确用不到的编解码器，最稳。
  - `balanced`（推荐）：再关掉没用到的物理、导航、XR、高级 GUI、整套 3D 等大功能。
  - `minimal`：再把高级文字排版换成精简版，最小。
- **手动覆盖**：`"disable_physics_2d": false` 表示保留 2D 物理；`"module_mp3_enabled": true` 表示保留 MP3；`false` 表示去掉。手动覆盖优先于档位。

注意：扫描看的是代码和场景里**写出来的类名**。用字符串动态创建的类（比如 `ClassDB.instantiate("RigidBody2D")`）扫描不到，这类能力要在“手动覆盖”里手动保留。

## 目录

- `trim/`：裁剪工具（`trim.mjs`、扫描规则 `lib/scan.mjs`、编译 `lib/build.mjs`、工具链配置 `trim.toolchain.json`）。
- `split/`：分包工具（`kit.mjs`，以及 README、SETUP）。
- `cloud/`：云日志云函数（可选）。
- `skill/wechat-wasm-slim/`：给 AI 的 skill。
- `examples/`：打砖块的裁剪配置和编译结果、分包配置。

## 示例配置与隐私

包内配置已去敏，`REPLACE_WITH_…` 和 `./input/…` 均需换成使用者自己的值；未附引擎、私钥、登录状态或原始运行日志。工具链位置在 `trim/trim.toolchain.json` 中填写；本机实际配置请另存为 `*.private.json`，私钥保存在仓库之外。

云日志是可选功能：不用时把 `cloud.env` 设为 `null`。启用后会上报设备平台、系统、型号、SDK 版本和筛选后的日志；云函数使用微信身份校验，并保存 OpenID 的哈希用于归属和去重。日志脱敏规则不能识别所有自由文本，请勿在游戏日志中输出个人资料或凭据。

## 做不到的

- 不能替你把 Godot 项目导出成小游戏工程（用你们现成的方案）。
- 模板版工程不能用 split（微信官方分包只支持通用适配）。
- 采集和最终验证都要人在手机上操作。
