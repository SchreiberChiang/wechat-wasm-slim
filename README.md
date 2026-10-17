# wechat-wasm-slim：把 Godot 游戏做成微信小游戏，并让引擎变小、开局更快

## 能做什么

| 工具 | 做什么 | 适用于 |
|---|---|---|
| **convert（转换）** | 把 Godot Web 导出（godot.js + godot.wasm + .pck）一条命令转成 WXGameKit 通用适配小游戏工程 | 用 citizenll/godot 微信分支引擎导出的 Godot 4.7.2 游戏 |
| **trim（裁剪）** | 去掉游戏用不到的引擎功能，重新编译出更小的 `godot.wasm` | **任何**微信 Godot 小游戏（模板版或通用适配版都行） |
| **split（分包）** | 开局只下载必须的引擎代码，其余等需要时再下载（或者直接不要） | 只适用于**通用适配（WXGameKit）**工程，因为它用的是微信官方的分包服务 |

可以只用一个，也可以都用。顺序是 **转换 → 裁剪 → 重新转换 → 分包**：裁剪会改变引擎，分包要在最终引擎上做。

## 一条龙顺序

1. **Godot 导出 Web**：编辑器 4.7.2，用 citizenll/godot 微信分支编译的单线程 Web 模板导出，得到 `.js`、`.wasm`、`.pck`（模板带 `.js.symbols` 更好）。只改了游戏内容时，也可以只导出 `.pck`。
2. **转换（convert）**：`node convert/convert.mjs check --export <导出目录>` → `convert --export <导出目录> --appid-from <已有工程> --out <新目录>` → `verify --project <新目录>/minigame`。用开发者工具打开 `<新目录>/minigame`，**人工把游戏完整玩一遍**。
3. **（可选）裁剪（trim）**：`scan` → 选档位 → `build`（30–50 分钟）。编出的 `artifacts/`（godot.js、godot.wasm、godot.js.symbols）配上同一个 `.pck`，**重新 convert** 到另一个新目录（`--export <work>/artifacts --pck <x.pck>`），再完整玩一遍确认没被裁坏。
4. **分包（split）**：把最终工程作为 `workProject`、`<新目录>/webgl/symbols.json` 作为 `symbols`，按 `split/README.md` 做。官方 `init` 会上传 WASM，**必须先问用户**。
5. **上传/真机**：上传体验版（先问用户）→ 安卓和 iPhone 真机采集与测试。

**必须人工的步骤**：小游戏后台（AppID、添加 WXGameKit 插件、分包私钥、体验成员）；授权每一次上传/预览/init/dosplit/云函数部署；在开发者工具和手机上实际玩（开发者工具无法自动点击 Godot 画布）；游戏自身的微信适配——GDScript 用到的 JS 接口（`convert --interfaces`）、网络合法域名、存档、登录、支付、分享、广告。

实测数据（打砖块）：
- 转换：完整引擎和 balanced 裁剪引擎各转换一次（约 30 秒），开发者工具里都进到 2D 首帧（3D 和手机未测），详见 [convert/RESULT.md](convert/RESULT.md)。
- 保留 3D 的裁剪版（balanced 档）：引擎下载体积 8.70 MB → 5.95 MB（-31.6%），开发者工具里 2D 和 3D 实玩正常（手机未测），详见 [examples/breakout3d/RESULT.md](examples/breakout3d/RESULT.md)。
- 只保留 2D 的裁剪版：引擎 8.69 MB → 5.08 MB。
- 分包：开局只下 3.54 MB，剩余 5.59 MB 点进 3D 时才下。

## 我是哪种工程？

- 只有 Godot 项目或 Web 导出 → 先用 **convert** 转成通用适配版。

- 工程里有 `engine/godot.wasm.br` 和 `godot-loader.js` → **模板版**：能用 trim，不能用 split。
- 工程里有 `wx-game-kit/config.json`，`game.json` 里有 WXGameKit 插件 → **通用适配版**：trim 和 split 都能用。

## 需要准备什么

**只用裁剪（trim）**
- Windows，Node.js 24，Git。
- 编译环境：微信版 Godot 引擎源码（citizenll/godot 微信分支，本例提交 `df3cdd9bc`）、emscripten 4.0.10、Python 3.9+ 和 SCons 4.4+。路径填进 `trim/trim.toolchain.json`。首次编译前运行 `node trim/trim.mjs check` 检查。
- 你的 Godot 项目目录（有 `project.godot` 的那个），用来扫描。
- 每次编译约 30–50 分钟、约 1 GB 磁盘。编译目录（`--work`）建议放在工具包外面；工具包自带 `.gitignore`，会排除 `build-*/`。
- 编译偶尔会遇到 clang 崩溃（0xC0000005），工具会自动重试（`--retries`，默认 2 次）；还是失败就用同一个 `--work` 目录重跑，会从中断处续编。崩得频繁时，可以加 `--jobs 4` 降低并行数。

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
node trim/trim.mjs build --config my.trim.json --work D:/wasm-build/build-1   # 编译（30–50 分钟，约 1 GB，建议放在工具包外面）
node trim/trim.mjs apply --engine D:/wasm-build/build-1/artifacts --minigame <小游戏工程> --out <新工程>   # 模板版直接替换
```
然后用微信开发者工具打开新工程，把游戏**完整玩一遍**，确认没有被裁坏。

**转换**（Godot Web 导出 → 通用适配版）
```
node convert/convert.mjs check   --export <Web导出目录>                       # 检查：微信分支引擎、单线程、PCK、符号表、转换器
node convert/convert.mjs convert --export <Web导出目录> --appid-from <已有小游戏工程> --out <新目录>
node convert/convert.mjs verify  --project <新目录>/minigame                  # 离线检查结构（不联网）
```
需要官方 wx-transformer 1.0.35 便携版（路径写在 `convert/convert.toolchain.json`）。详见 `convert/README.md`，实测见 `convert/RESULT.md`。

**分包**（只适用于通用适配版）：见 `split/README.md` 的“新游戏完整流程”。

## 有 AI：交给它

把整个 `wechat-wasm-slim` 文件夹给 AI，并告诉它：
> “用 wechat-wasm-slim 把这个 Godot 游戏做成微信小游戏并缩小 WASM：Godot 项目在 `<路径>`，Web 导出在 `<路径>`（或已有小游戏工程在 `<路径>`）。先判断工程类型，裁剪配置给我看过再编译；上传、预览和后台操作前先问我。”

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

- `convert/`：转换工具（`convert.mjs`、胶水模板 `assets/`、检查 `lib/`、转换器配置 `convert.toolchain.json`）。
- `trim/`：裁剪工具（`trim.mjs`、扫描规则 `lib/scan.mjs`、编译 `lib/build.mjs`、工具链配置 `trim.toolchain.json`）。
- `split/`：分包工具（`kit.mjs`，以及 README、SETUP）。
- `cloud/`：云日志云函数（可选）。
- `skill/wechat-wasm-slim/`：给 AI 的 skill。
- `examples/`：打砖块的裁剪配置和编译结果、分包配置。

## 示例配置与隐私

包内配置已去敏，`REPLACE_WITH_…` 和 `./input/…` 均需换成使用者自己的值；未附引擎、私钥、登录状态或原始运行日志。工具链位置在 `trim/trim.toolchain.json` 和 `convert/convert.toolchain.json` 中填写；本机实际配置请另存为 `*.private.json`，私钥保存在仓库之外。

云日志是可选功能：不用时把 `cloud.env` 设为 `null`。启用后会上报设备平台、系统、型号、SDK 版本和筛选后的日志；云函数使用微信身份校验，并保存 OpenID 的哈希用于归属和去重。日志脱敏规则不能识别所有自由文本，请勿在游戏日志中输出个人资料或凭据。

## 做不到的

- convert 不替你导出 Godot 项目（在 Godot 编辑器里导出 Web），也不做游戏自身的微信适配（网络域名、存档、登录、支付等）。
- convert 只支持 citizenll/godot 微信分支的单线程模板；官方 Godot 模板不行。
- 模板版工程不能用 split（微信官方分包只支持通用适配）。
- 采集和最终验证都要人在手机上操作。
