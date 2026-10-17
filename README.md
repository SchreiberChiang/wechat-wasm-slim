# wechat-wasm-slim：把 Godot 游戏做成微信小游戏，并让引擎变小、开局更快

## 能做什么

| 工具 | 做什么 | 适用于 |
|---|---|---|
| **convert（转换）** | 把 Godot 项目（PCK）+ 微信版引擎，一条命令转成能在微信里跑的小游戏工程（WXGameKit 通用适配），自带浏览器兼容层（网络、键盘、震动）和加载计时汇总。**不需要** godot-minigame 之类的社区小游戏模板 | Godot 4.7.2 项目（见下面“转换靠什么”） |
| **trim（裁剪）** | 去掉游戏用不到的引擎功能，重新编译出更小的 `godot.wasm`；默认带启动补丁，可以跳过默认 3D 预热 | **任何**微信 Godot 小游戏（模板版或通用适配版都行） |
| **split（分包）** | 开局只下载必须的引擎代码，其余等玩家点进玩法时再下载 | 只适用于**通用适配（WXGameKit）**工程，因为它用的是微信官方的分包服务 |

可以只用一个，也可以都用。顺序是 **转换 → 裁剪 → 重新转换 → 分包**：裁剪会改变引擎，分包要在最终引擎上做。

## 实测：Star Tap 走完整条流程（2026-10-17）

`examples/startap/` 是一个新做的小游戏：标题（改名、点击登录）+ 2D 打星星 + 3D 打星星，HTTP + WebSocket 联网，带音乐音效、震动、粒子和 shader。用它从头走了一遍，详见 [examples/startap/RESULT.md](examples/startap/RESULT.md)：

| 环节 | 结果（iPhone 16 Pro 实测，除注明外） |
|---|---|
| convert | 开发者工具和 iPhone 上登录、联网、2D、3D 全流程正常 |
| trim（balanced，保留 3D 和联网） | 引擎 WASM 8.52 → **6.12 MB** |
| split（标题首包，2D+3D 点击时下载） | 开局只下 **3.04 MB**，点进玩法时下 3.55 MB；两种进入顺序、0 次缺函数 |
| 跳过默认 3D 预热 | 启动的 callMain **3.3 s → 1.05–1.5 s** |
| 安卓 | 分包后**未测** |

更早的打砖块数据：保留 3D 裁剪 8.70 → 5.95 MB；分包开局 3.54 MB，点进 3D 再下 5.59 MB（`examples/breakout3d/`、`examples/breakout-split/`）。

## 转换靠什么（从 Godot 新项目直接到微信小游戏）

Star Tap 就是这样从一个全新 Godot 项目直接转成微信小游戏的，**没有用 godot-minigame 模板或其他社区转换方案**。整个过程用到三样东西，各管一段：

| 用到的 | 做什么 | 从哪来 |
|---|---|---|
| **Godot 编辑器 4.7.2** | 只用来导出游戏内容（`.pck`）。官方版就行（Star Tap 用的是 Steam 上的官方 4.7.2） | 官方 |
| **微信版 Godot 引擎**（`godot.js` + `godot.wasm`） | 在微信里运行游戏。官方 Godot 的 Web 引擎不能直接在微信里跑：它用浏览器的 fetch、文件系统、输入法，微信里没有。社区的 [citizenll/godot](https://github.com/citizenll/godot) 微信分支把这些换成了 `wx.request`、微信文件系统、微信键盘等 | **trim 从这个分支的源码编译**（同时裁剪），也可以用别人编好的 |
| **微信官方转换器 wx-transformer** | 生成 WXGameKit 通用适配工程的骨架（插件加载、WASM 压缩、首包数据），这是微信官方分包服务要求的工程结构 | 微信官方下载（便携版，本机运行） |

convert 做的事：把上面两样接起来——接上启动桥，把 PCK 打进首包数据，补浏览器兼容层和计时，生成官方分包 init 要的符号表。所以：
- **能直接转**：任何 Godot 4.7.2 项目，只要能用微信版引擎跑（单线程、不用 GDExtension）。
- **不能直接转**：官方 Godot Web 导出（引擎不对，`check` 会拦下）；其他 Godot 版本（见下面“其他 Godot 版本”）。

## 一条龙顺序

1. **准备引擎和 PCK**：引擎用 trim 编译（或现成的微信版引擎 `.js` + `.wasm` + `.js.symbols`）；游戏内容用编辑器导出 PCK：`godot --headless --path <项目> --export-pack "Web" game.pck`（项目要用 GL Compatibility 渲染）。
2. **转换（convert）**：`check` → `convert --appid-from <已有工程>` → `verify`。用开发者工具打开 `<新目录>/minigame`，**人工把游戏完整玩一遍**。
3. **（可选）裁剪（trim）**：`scan` → 看配置、选档位 → `build`（25–50 分钟）。编出的 `artifacts/` 配上同一个 `.pck` **重新 convert** 到新目录，再完整玩一遍。
4. **（推荐）跳过默认 3D 预热**：在游戏的 `project.godot` 里加
   ```
   [startup]
   gles3/skip_default_3d_prewarm=true
   ```
   需要 trim 编出的引擎（默认带启动补丁和宏）。开局不再编译用不到的 3D shader，第一次进 3D 时再编译。
5. **分包（split）**：`split init`（**先问用户**，会上传 WASM）→ `collect-pack` → `preview`（**先问用户**）→ 在手机上采集 → `split release` → `assemble` → `verify` → `preview` → 真机测试。详见 `split/README.md`。**用安卓或 iPhone 都能做第一轮采集**；正式发布前两种手机都要测。

**必须人工的步骤**：小游戏后台（AppID、WXGameKit 插件、分包私钥、体验成员）；授权每一次上传、预览、init、dosplit、云函数部署；在开发者工具和手机上实际玩（开发者工具无法自动点击 Godot 画布）；游戏自身的微信适配——GDScript 用到的 JS 接口（`convert --interfaces`）、网络合法域名（正式上线要已备案域名 + HTTPS/WSS）、登录、支付、分享、广告。

## 我是哪种工程？

- 只有 Godot 项目或 Web 导出 → 先用 **convert** 转成通用适配版。
- 工程里有 `engine/godot.wasm.br` 和 `godot-loader.js` → **模板版**：能用 trim，不能用 split。
- 工程里有 `wx-game-kit/config.json`，`game.json` 里有 WXGameKit 插件 → **通用适配版**：trim 和 split 都能用。

## 需要准备什么

**转换（convert）**
- Windows，Node.js 24。
- 官方 wx-transformer 1.0.35 便携版，路径写进 `convert/convert.toolchain.json`（下载地址见 `convert/README.md`）。
- 微信版 Godot 引擎（citizenll/godot 微信分支、单线程）：用 trim 编译，或者用现成的。
- Godot 编辑器 4.7.2（官方版即可），用来导出 PCK。

**裁剪（trim）**
- Git；微信版 Godot 引擎源码（citizenll/godot 微信分支，提交 `df3cdd9bc`）、emscripten 4.0.10、Python 3.9+ 和 SCons 4.4+。路径填进 `trim/trim.toolchain.json`，首次编译前运行 `node trim/trim.mjs check`。
- 每次编译约 25–50 分钟、约 1 GB 磁盘。编译目录（`--work`）放在工具包外面。
- 内存紧张或 full-LTO 链接失败时用 `--lto thin`（Star Tap 在 32 GB 机器上 full-LTO 触发内存保护，thin 成功，约 25 分钟）。

**分包（split）**：详见 `split/SETUP.md`。
- 小游戏后台：开发者/体验成员权限、WXGameKit 插件、代码分包私钥。
- 微信开发者工具、`npm install wasmsplit-v2-ci@2.1.5`。
- **一台手机就能开始**（安卓或 iPhone 都行），用来采集；发布前两种手机都要测。
- 可选的云日志：见 `cloud/README.md`。

## 没有 AI：照着做

**转换**
```
node convert/convert.mjs check   --export <Web导出目录>
node convert/convert.mjs convert --export <Web导出目录> --appid-from <已有小游戏工程> --out <新目录> [--interfaces <游戏JS接口.js>]
node convert/convert.mjs verify  --project <新目录>/minigame
```

**裁剪**
```
node trim/trim.mjs check
node trim/trim.mjs scan --project <Godot项目> --out my.trim.json
（打开 my.trim.json：选“当前档位”，在“手动覆盖”里决定保留哪些能力）
node trim/trim.mjs profile --config my.trim.json --out my.gdbuild          # 校验配置，打印最终会去掉什么
node trim/trim.mjs build --config my.trim.json --work D:/wasm-build/build-1 [--lto thin]
node trim/trim.mjs apply --engine D:/wasm-build/build-1/artifacts --minigame <模板版工程> --out <新工程>   # 模板版直接替换
```
通用适配版：用 `artifacts/` 重新 convert（`--js/--wasm/--symbols` 指向 artifacts，`--pck` 指向游戏 PCK）。

**分包**：见 `split/README.md` 的“新游戏完整流程”。

## 有 AI：交给它

把整个 `wechat-wasm-slim` 文件夹给 AI，并告诉它：
> “用 wechat-wasm-slim 把这个 Godot 游戏做成微信小游戏并缩小 WASM：Godot 项目在 `<路径>`，Web 导出在 `<路径>`（或已有小游戏工程在 `<路径>`）。先判断工程类型，裁剪配置给我看过再编译；上传、预览和后台操作前先问我。”

`skill/wechat-wasm-slim/SKILL.md` 是给 AI 的操作说明。可以把这个目录放进 AI 的 skills 目录（Claude Code 是 `~/.claude/skills/`，Codex 是 `~/.codex/skills/`）。

## 裁剪怎么控制保留哪些能力

扫描生成的配置里，每一项都写了用途、扫描依据和风险：
- **当前档位**：`conservative`（只去掉明确用不到的编解码器）、`balanced`（推荐，再关掉没用到的物理、导航、XR、高级 GUI、整套 3D 等）、`minimal`（再把高级文字排版换成精简版）。
- **手动覆盖**：`"disable_physics_2d": false` 表示保留 2D 物理；`"module_mp3_enabled": true`（写 `module_mp3` 也认）表示保留 MP3，`false` 表示去掉。手动覆盖优先于档位。**写错的键、非布尔值、非法档位会直接报错**。

扫描会考虑引擎内部依赖（例如用了 LineEdit 就不关高级 GUI，因为它内部要创建 PopupMenu），纹理压缩只看纹理导入设置。但扫描只认**写出来的类名**：用字符串动态创建的类（`ClassDB.instantiate("RigidBody2D")`）扫描不到，要在手动覆盖里保留。

## 目录

- `convert/`：转换工具（`convert.mjs`、胶水和兼容层 `assets/`、检查 `lib/`）。
- `trim/`：裁剪工具（`trim.mjs`、扫描 `lib/scan.mjs`、编译 `lib/build.mjs`、默认引擎补丁 `patches/`、工具链配置）。
- `split/`：分包工具（`kit.mjs`、README、SETUP）。
- `cloud/`：云日志云函数（可选）。
- `skill/wechat-wasm-slim/`：给 AI 的 skill。
- `examples/startap/`：完整流程示例（游戏源码、测试服务、接口文件、配置、实测结果）。
- `examples/breakout3d/`、`examples/breakout-split/`：打砖块的裁剪和分包配置。
- `doctor.mjs`：换版本时的只读体检（见“其他 Godot 版本”）。
- `docs/`：已知问题与处理结论（[KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)）、版本适配指南（[UPGRADING.md](docs/UPGRADING.md)）、历史踩坑（PLAYBOOK.md）。

## 命名变更（2026-10-17）

早期实验留下的 `WX15_`、`training12` 这些编号式名字统一改成了 `WXSLIM_`。**旧名字仍然兼容**：运行时同时挂新旧两个全局名，读云日志时新旧前缀都认，所以按旧名字写的游戏代码不用改。新游戏请用新名字。

| 用途 | 新名字 | 旧名字（仍然可用） |
|---|---|---|
| 点击门（游戏调用） | `__WXSLIM_CLICK_GATE__` | `__WX15_RELEASE_CLICK_GATE__` |
| 采集包标志（游戏判断） | `__WXSLIM_COLLECT_GATE__` | `__WX15_TRAINING12_GATE_DIAGNOSTIC__` |
| 计时汇总日志 | `[WXSLIM_TIMING]` | `[WX15_TIMING]` |
| 启动阶段日志 | `[WXSLIM_BOOT]`、`[WXSLIM_RESOURCE]` | `[WX15_BOOT]`、`[WX15_RESOURCE]` |
| 点击门状态、兜底、缺函数日志 | `[WXSLIM_CLICK]`、`[WXSLIM_FALLBACK]`、`[WXSLIM_PRIMARY_MISS]` | `[WX15_RELEASE_CLICK]`、`[WX15_FALLBACK]`、`[WX15_PRIMARY_MISS]` |
| 计时文件 | `godot-data/wxslim-timing.js`、`wxslim-sizes.js` | `wx15-timing.js`、`wx15-sizes.js`（组装时自动换掉） |

没改的：游戏打印的 `[STARTUP_3D_FLOW]` 事件（游戏侧约定）；引擎补丁里的 `WX_LAB_*` 宏和 `[WX_NATIVE_*]` 日志（属于引擎，改了要重编）；配置文件里的键名（例如 `trainingPck`、`trainingGateHost`）。

## 示例配置与隐私

包内配置已去敏，`REPLACE_WITH_…` 和 `./input/…` 均需换成使用者自己的值；未附引擎、私钥、登录状态或原始运行日志。工具链位置在 `trim/trim.toolchain.json` 和 `convert/convert.toolchain.json` 中填写；本机实际配置请另存为 `*.private.json`，私钥保存在仓库之外。

云日志是可选功能：不用时把 `cloud.env` 设为 `null`。启用后会上报设备平台、系统、型号、SDK 版本和筛选后的日志；云函数使用微信身份校验，并保存 OpenID 的哈希用于归属和去重。日志脱敏规则不能识别所有自由文本，请勿在游戏日志中输出个人资料或凭据。

## 其他 Godot 版本

现在只在 **Godot 4.7.2 + 微信分支提交 df3cdd9bc + emscripten 4.0.10 + wx-transformer 1.0.35 + wasmsplit-v2-ci 2.1.5 + WXGameKit 1.3.15** 上验证过。换版本时各部分的影响：

| 部分 | 换 Godot 版本要做什么 |
|---|---|
| 引擎 | 要有对应版本的微信分支源码（或自己把微信适配移植过去）；trim 的启动补丁要重新打（补丁锚点会变） |
| convert | 启动桥依赖 Emscripten 模块结构和微信分支的运行时约定；`check` 会检查这些约定，不满足就报错 |
| PCK | 编辑器版本必须和引擎一致 |
| split | 基本不受 Godot 版本影响（作用于官方分包运行时），但新引擎要重新 init 和采集 |

工具在锚点对不上时一定会明确报错，不会悄悄出错，所以**换版本可以交给 AI 按报错逐项适配**：思路和检查都在工具里，改的是补丁锚点和版本号。不承诺开箱即用。

任何一个组件要换版本时，先跑只读体检，一次列出所有对不上的锚点、所在文件和行号、建议怎么改：
```bash
node doctor.mjs --engine <新引擎 artifacts> --runtime <官方 wasm-split.js> --run-transformer
```
每个组件的升级步骤、要改的 pin、验证顺序（doctor → convert/verify → 开发者工具 → 真机），以及换 Godot 版本时引擎侧要做什么，见 [docs/UPGRADING.md](docs/UPGRADING.md)。

## 做不到的

- 不替你导出 Godot 项目（在 Godot 编辑器里导出），也不做游戏自身的微信适配（网络域名、登录、支付等）。
- 引擎必须是微信版（citizenll/godot 微信分支、单线程、不带 GDExtension）；官方 Godot Web 引擎不能在微信里运行。
- 模板版工程不能用 split（微信官方分包只支持通用适配）。
- 官方分包只有“首包 + 一个余包”；标题、2D、3D 各一个包需要自研（未实现，见 KNOWN_ISSUES）。
- PCK 资源整体放在首包数据里，不按场景拆。
- 采集和最终验证都要人在手机上操作。
