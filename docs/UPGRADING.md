# 版本适配指南（给 AI 和开发者）

工具只在一组固定版本上验证过，不承诺开箱支持别的版本。换版本的思路是：**先用 `doctor` 找出所有对不上的锚点和约定，再逐项改，最后按验证阶梯一级级确认。** 本文写的是每个组件换版本时具体改哪里、怎么验证。

## 当前验证过的版本和 pin 位置

| 组件 | 版本 | pin 写在哪里 | 谁会拦 |
|---|---|---|---|
| Godot | 4.7.2 | `doctor.mjs` 的 `VERIFIED.godot`；README | convert check 对 PCK 版本只警告；doctor 读引擎源码 `version.py`，不同时“注意” |
| 微信分支（citizenll/godot） | 提交 `df3cdd9bc` | `trim/trim.toolchain.json` 的 `pin` | trim check/build：源码 HEAD 必须等于 pin |
| trim 启动补丁 | `wx-startup-df3.patch` | `trim/trim.toolchain.json` 的 `patches` | build 时 `git apply` 失败即停 |
| emscripten | 4.0.10 | `trim/lib/build.mjs`：`EMSCRIPTEN_VERSION` 和 `checkToolchain` 里的判断 | trim check/build |
| wx-transformer | 1.0.35 | `convert/convert.toolchain.json` 的 `transformerVersion`、`transformerSha256` | convert：sha 不一致拒绝运行 |
| WXGameKit 插件 | 1.3.15 | `convert/convert.toolchain.json` 的 `plugin.version` | convert verify：不同时警告 |
| wasmsplit-v2-ci | 2.1.5 | `doctor.mjs` 的 `VERIFIED.wasmsplit`；README、`split/SETUP.md` | 不直接检查版本；它生成的 `wasm-split.js` 由下一行把关 |
| 官方分包运行时模板 | 归一化 sha `e259ae35bac8c397` | `split/lib/runtime-patches.mjs` 的 `OFFICIAL_RUNTIME_NORMALIZED_SHA256` | kit assemble / collect-pack：模板不认识就拒绝（`--allow-unknown-runtime` 可跳过） |

本机实际路径放在 `*.toolchain.private.json`（不进仓库）；改 pin 时示例配置和本机配置都要改。

## 第一步：跑 doctor

`doctor` 只读：不改仓库、不改输入。需要临时文件时（git 临时索引、实跑转换器的输出）都放在系统临时目录，结束删除。

```bash
node doctor.mjs --engine <新引擎 artifacts 目录> --runtime <官方 dosplit 产物里的 wasm-split.js> --run-transformer
```

| 参数 | 用途 | 不给时 |
|---|---|---|
| `--engine <目录>`（或 `--js/--wasm/--symbols`） | 新编出的 `godot.js` + `godot.wasm`（trim build 的 `artifacts/`） | convert 的引擎检查、trim 的产物约定检查跳过 |
| `--transformer <exe>` | 新版 wx-transformer | 用 convert 工具链配置里的 |
| `--run-transformer` | 用当前引擎实跑一次转换器，核对 `framework.js`、`game.js`、`wx-game-kit/config.json` 和插件声明（约 1 分钟） | 跳过这几项 |
| `--runtime <wasm-split.js>` | 新版 wasmsplit-v2-ci 生成的**原始**运行时（官方 `dosplit` 后工程里的，不要用 kit 打过补丁的） | split 检查跳过 |
| `--split-cli <cli.js 或目录>` | 读 wasmsplit-v2-ci 的版本号 | 跳过 |
| `--engine-source <目录>` | 新的引擎源码 git 仓库（按它的 HEAD 检查） | 用 trim 工具链配置的 `engineSource` + `pin` |
| `--convert-toolchain` / `--trim-toolchain` | 指定工具链配置 | 同目录 `*.private.json`，没有就用示例（示例路径不存在的项记为“跳过”） |
| `--json` | 机器可读输出 | 中文表格 |

检查内容：

- **convert**：引擎 JS 的 convert check 同款检查（`var Godot`、`module.exports` 段、Godot 接口、微信运行时约定、单线程）；启动桥截断点 `MODULE_TAIL` 是否唯一；启动桥要用的作用域名字（`Module`、`readyPromiseResolve/Reject`、`noInitialRun`…）；asset-gate 依赖的 Emscripten 运行依赖函数；wx-transformer sha 与 pin；实跑转换器后 `framework.js` / `game.js` 的补丁锚点、`config.json` 字段、WASM 能否还原、WXGameKit 插件版本。
- **split**：模板归一化 sha；release、release + measured、profile（采集包）三种补丁链的**每一处**锚点是否唯一命中；锚点全过时，用补丁后的运行时跑 `kit verify` 同款离线测试；wasmsplit-v2-ci 版本。
- **trim**：产物 `godot.js` 的微信运行时约定（`RUNTIME_TOKENS`）；源码提交与 pin；Godot 版本；补丁能否按顺序干净应用（临时索引里做，源码仓库不动）；`detect.py` 的 Windows 链接锚点；`COMMON_ARGS` 等编译选项在新源码里是否还有定义；源码自带测试和 `godot_process.js`；Python、SCons、emscripten、git。

结果四种：**通过 / 不通过 / 注意 / 跳过**。表格后面的“要处理的项”给出每个失败的**原因**（锚点找不到时：目标文件里最长能匹配到哪、下一段应该是什么、实际是什么；不唯一时：每处出现的位置）、**位置**（工具里定义这个锚点的文件和行号）和**建议**。

split 的锚点有两类：官方模板里的锚点，和前面补丁插入的本工具代码里的锚点。后者失败通常是前一处失败的连带，doctor 会合并成一行“连带失败”，先修源头再重跑。

## 改锚点的规矩

1. **语义不变**：只换“找到这段代码”的写法，替换后的行为保持一样。压缩代码的单字母变量名（`F`、`D`、`v`、`I`…）常随版本变，要读懂新代码里同一段逻辑再改。
2. **必须唯一命中**：锚点不唯一时加长上下文，不要改成“替换第一处”。
3. **保留旧值**：新模板 sha、新 pin 是**追加**（例如 `OFFICIAL_RUNTIME_NORMALIZED_SHA256` 保留旧值），除非确认旧版本不再支持。
4. **改完先跑 doctor 再跑真实命令**：doctor 用的是工具自己的补丁函数（只检查模式），锚点全过 = 真实命令的补丁也会过；但行为是否正确要靠下面的验证阶梯。

## 验证阶梯

每次改完按顺序走，前一级不过不往下：

1. `node doctor.mjs …` 全部通过（“注意”逐条确认过）。
2. `node --check` 所有改过的 `.mjs`。
3. convert：`convert.mjs check` → `convert` → `verify`。
4. split（用到时）：`kit.mjs collect-pack` / `assemble` → `kit.mjs verify`（离线测试 + 计时契约）。
5. 微信开发者工具打开工程，把游戏完整玩一遍（开发者工具不能自动点 Godot 画布，要人工）。
6. 真机：iPhone 和安卓都要测；分包要测两种进入顺序、缺函数兜底。上传、预览、init、dosplit 都要先取得用户授权。
7. 更新 README 的版本行、本文的版本表、`docs/KNOWN_ISSUES.md`；每一级的结果分开记录，没做到的写“未测”。

## 各组件升级步骤

### wx-transformer / WXGameKit 插件

1. `node doctor.mjs --engine <现有引擎> --transformer <新 exe> --run-transformer`。sha 不一致是预期的，看其余项。
2. 锚点失败：看新 `framework.js` / `game.js` 里同一位置的新写法，改 `convert/lib/inputs.mjs` 的 `FRAMEWORK_ANCHORS` / `GAMEJS_ANCHORS`。配置格式变了：对照新版 `--help` 改 `transformerConfig`。`config.json` 字段变了：改 `convert/convert.mjs` 第 4、7 步。
3. `framework.js` 里资源依赖的写法变了时，同步检查 `convert/assets/asset-gate.js` 的插入点和 `convert/lib/verify.mjs` 的对应检查。
4. 插件版本变了：小游戏后台要添加对应插件版本；改 `plugin.version`。
5. 走验证阶梯，通过后改 `transformer`、`transformerVersion`、`transformerSha256`。

### wasmsplit-v2-ci（官方分包运行时）

1. 用新 CLI 对一个已 init 的工程做 `dosplit`（会调用微信后台，先取得授权），拿到原始 `wasm-split.js`。
2. `node doctor.mjs --runtime <wasm-split.js> --split-cli <新 cli.js>`。
3. 锚点失败：位置指向 `split/lib/runtime-patches.mjs` 的具体行。点击门（`clickGate`）是核心，先修它；`fallbackAndWaiterFix`、`missLogging`、`measuredMode` 的锚点大多在本工具自己的 `click-owned-runtime-core.js` 里，通常随之恢复。
4. 离线测试失败：锚点虽然命中，运行时行为变了（例如 `waiterMode`、`canAwaitLoad` 的语义）。读新运行时的加载逻辑，修补丁语义；`split/lib/offline-tests.mjs` 里切片用的锚点（`function F(`、`function D(`、`v=function`）也可能要改。
5. 全过并真机验证后，把新模板的归一化 sha 前 16 位**追加**到 `OFFICIAL_RUNTIME_NORMALIZED_SHA256`；如果新模板里随游戏变化的不止 `const tableSize = N` 一行，同步改 `normalizeRuntime`。更新 `VERIFIED.wasmsplit`、README、`split/SETUP.md`、`docs/PLAYBOOK.md` 的版本号。

### emscripten

微信分支附带预编译的 `libemscriptenglx`，只匹配特定 emscripten 版本（`detect.py` 的 `use_wx_glx` 提示里列出了文档声明的版本）。不能单独升级 emscripten：

1. 先确认微信分支有为新 emscripten 重新编译的 `libemscriptenglx`（doctor 的“微信分支声明支持的 emscripten 版本”）。
2. 改 `trim/lib/build.mjs` 的 `EMSCRIPTEN_VERSION` 和 `checkToolchain` 里的版本判断。
3. 编一次引擎，`doctor --engine <新 artifacts>` 看 convert 侧：新版 Emscripten 可能改 MODULARIZE 工厂写法（`MODULE_TAIL`、`readyPromiseResolve/Reject`）或运行依赖实现（`addRunDependency`、`createWasm`），对应改 `convert/lib/inputs.mjs`、`convert/assets/godot-bridge.js` 末尾、`convert/assets/asset-gate.js`。
4. 走验证阶梯。

### 微信分支新提交（同一个 Godot 版本）

1. `node doctor.mjs --engine-source <新源码> --trim-toolchain <配置>`。
2. 补丁失败：doctor 给出失败的文件、hunk 行号和补丁里的行号。在新源码上按补丁意图手工移植（`wx-startup-df3.patch` 做两件事：让 `startup/gles3/skip_default_3d_prewarm` 生效；输出 `[WX_NATIVE_*]` 原生计时），用 `git diff` 重新生成补丁，可以起新文件名（例如 `wx-startup-<短提交>.patch`），改 `patches`。补丁 sha 变了，旧的 `--work` 目录不能续编（编译身份会拒绝）。
3. `detect.py` 锚点、编译选项、源码测试、`godot_process.js` 按 doctor 的建议改 `trim/lib/build.mjs`。
4. 编一次（25–50 分钟），`doctor --engine <新 artifacts> --run-transformer` 看 convert 侧。
5. 走验证阶梯，通过后改 `pin`（示例和本机配置）。引擎变了，WASM md5 变了，分包要重新 init 和采集。

### 换 Godot 版本（小版本或大版本）

工具本身只依赖引擎 JS 的约定和编译选项，真正的工作量在引擎侧：

1. **找微信分支**：先看 citizenll/godot 有没有对应版本的微信分支。有就用它的提交作为新 pin。
2. **没有就移植**：以旧分支（`df3cdd9bc`）相对官方 4.7.2 的差异为清单，把微信适配移植到新版本官方源码上：`platform/web` 下的微信运行时（`GODOTSDK`、`WXMEMFS`、`GodotJSWrapper`、WebGL/GLX 适配、`godot_process.js` 后处理、`libemscriptenglx`）、音频、文件系统、帧提交。移植完先跑分支自带的 `platform/web/js/tests/` 测试。这是大工作，按模块分批做、分批验证。
3. **重打启动补丁**：在新分支上按“微信分支新提交”第 2 步移植 `wx-startup` 补丁。大版本里 GLES3 渲染器和 `main.cpp` 改动大，补丁基本要重写。
4. `doctor --engine-source <新分支>` → 编译 → `doctor --engine <新 artifacts> --run-transformer`。
5. **PCK 用同版本编辑器导出**，项目用 GL Compatibility 渲染；trim 的扫描依赖引擎类表（`trim/lib/scan.mjs` 从源码读取），大版本要重新检查 `INTERNAL_DEPS` 这类经验规则是否仍成立。
6. 走验证阶梯；split 侧基本不受 Godot 版本影响，但新引擎要重新 init 和采集。
7. 更新 `VERIFIED.godot`、README 的版本行和“需要准备什么”、本文的版本表。

## doctor 查不到的

- 行为层面的变化（锚点都命中但语义变了）：split 有离线测试；convert 的渲染配置与启动桥有 Node VM 合同（`tests/render-*-tests.mjs`），但真实 GLX/native、像素与恢复仍要靠微信宿主和真机。新渲染观察入口要求 `installWXGLXPatches();` 唯一命中以及 wxGLXGet*/CallNative/GLctx 约定，doctor 与 convert 共用检查；不支持的引擎变体必须先核对再移植。
- `convert/assets/wx-compat.js`、`custom-package.js`、`single-entry.js` 依赖的小游戏基础库和 WXGameKit 运行时行为。
- 微信开发者工具、基础库版本、手机微信版本的变化。
- 分包后真机上的缺函数情况（要靠采集和云日志）。
