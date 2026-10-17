# convert 实测记录（打砖块）

日期：2026-10-17。机器：Windows 11，Node 24.18，wx-transformer 1.0.35（便携版，本机运行），微信开发者工具（基础库 3.17.4，WXGameKit 1.3.15）。产物在本机实验目录，不随工具包提供。

## 输入

| 输入 | 来源 |
|---|---|
| 完整引擎 | `wxgamekit-15/input/godot.web.template_release.wasm32.nothreads.{js,wasm,js.symbols}`（微信分支 `df3cdd9bc`，WASM 69.55 MB） |
| 裁剪引擎 | `examples/breakout3d/build-balanced/artifacts/godot.{js,wasm,js.symbols}`（balanced 档，WASM 46.72 MB） |
| PCK | `wxgamekit-15/full-compat-pack-09/breakout.pck`（39 928 字节，Godot 4.7.2，2D 打砖块 + ENTER 3D） |

## 结果

| 产物 | 引擎 | 结果 |
|---|---|---|
| `full-engine-placeholder` | 完整 | convert 30 s；verify 0 失败（注意：AppID 占位符、未 init）。未在开发者工具打开（占位 AppID 不能加载插件） |
| `full-engine-ide` | 完整，`--appid-from` | 开发者工具：资源校验 → WASM 实例化 → PCK 挂载 → callMain → `REPRO_FIRST_FRAME`，2D 画面截图正常（`shot-full-2.jpg`）。唯一报错是 Godot 找不到打砖块自己的 `__STARTUP_LAB_PROBE__` 接口（游戏判空，不影响） |
| `trim-balanced-ide` | 裁剪 | **失败**：`ReferenceError: nowPolyfill is not defined`。新编译的微信分支引擎 JS 依赖模板版 `engine/godot-sdk.js` 提供的全局 `nowPolyfill`。已在启动桥里补上，verify 也加了这条检查（这份旧产物现在 verify 会报失败，保留作对照） |
| `trim-balanced-ide-2` | 裁剪（修复后） | 开发者工具进入 2D 首帧，截图正常（`shot-trim-2.jpg`）；WASM 压缩后 5.88 MB；插件报告游戏启动 5.0 s |
| `full-engine-ide-2` | 完整，修复后 + `--interfaces breakout-local-interfaces.js` | 开发者工具进入 2D 首帧，控制台 0 个 error；插件报告游戏启动 7.2 s |

开发者工具里的数字只是模拟器上的一次运行，不是性能对比。

启动过程（两份引擎相同）：插件请求两次工厂，第二次复用同一个 Module（单入口生效）；`[WX15_BOOT]` 依次为 FACTORY_START → WASM_INSTANTIATED → GODOT_RUNTIME_READY → FS_READY → PACK_READY_WAITING_LOADER_MAIN → CALL_MAIN → MAIN_RETURNED。

## 与手工版（`wxgamekit-15/out-bridge-03/minigame`）对比

- 官方模板文件（`wx-game-kit/index.js`、`check-version.js`、`custom/*`、`plugins/`、`game.json`）和 `webgl/symbols.json`：**逐字节相同**。
- `framework.js`：只有预期差异——去掉本地存储诊断、去掉 `/breakout.pck` 和 67548 字节常量（改从 `package-info.js` 读）、locale 变成参数、加 `nowPolyfill` 兜底。转换器生成的其余部分逐字节相同。
- `game.js`：少了 `local-diagnostic-init` 一行。
- `wx-game-kit/config.json`：代码 md5 改为 15 位；数据包 md5/大小不同（说明文件文字不同，40 026 vs 40 016 字节）；引擎版本写 `4.7.2`（手工版 `4.7.2.rc`）；项目名、AppID 来源不同。
- 不再生成：`godot-data/local-diagnostic-init.js`、多余的 `godot-data/breakout.pck`、多余的旧数据包。
- 用 `convert verify` 检查手工版：0 失败、5 条注意（16 位 md5、多余数据包、实验诊断脚本、写本地存储、未 init）。

## 未测

- **3D**：开发者工具的自动点击接口在这台机器上超时（`timeout waiting for automator response`），没能自动点 ENTER 3D。需要人在开发者工具里点 ENTER 3D、发球、返回再进入确认。
- **手机**（安卓、iPhone）：未测，没有预览或上传。
- **官方 init / 分包**：未做（会上传 WASM，需要授权）。convert 产物满足 SETUP 第 3 节第 1 条（工程结构）和第 4 条（符号表）；第 2 条（init）和第 3 条（init 后的官方运行时）要等 init 之后才有；能否被 init 接受未实测。
- 其他游戏（非打砖块）、横屏、大 PCK、带音频的游戏：未测。
- 官方 Godot 模板只做了反例检查（`check` 会拒绝），没有尝试转换。
