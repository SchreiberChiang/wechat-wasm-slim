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

## 浏览器兼容层并入默认产物（Star Tap，2026-10-17）

把 `demo-login-01/wx/demo-interfaces.js` 第 1–5 项（输入法、文本编解码、Blob、WebSocket 常量、震动、wx.request 补丁）整理成 `assets/wx-compat.js`，convert 默认生成 `godot-data/wx-compat.js`，在 `game.js` 里放在 `local-interfaces` 之前加载；`--no-compat` 关掉。每一项补什么、怎么发现的见 README “wx-compat.js 补了什么”。

| 产物 | 输入 | 结果 |
|---|---|---|
| `demo-login-01/wx-out-compat-01` | 完整引擎（同上）+ `demo-login-01/build/startap-05.pck` + `--interfaces demo-login-01/wx/demowx-only-qa.js`（只有 DemoWx 登录接口，`qa=true` 自动玩一局，**没有任何兼容代码**）+ `--appid-from` | verify 通过 19、注意 1（未 init）、失败 0。开发者工具：`[WX_COMPAT] globalAdapter,Blob,WebSocket-consts,vibrate,request` → 启动到 MAIN_RETURNED → `wx.login state=ok` → `POST /api/wxlogin code=503`（服务器未配 AppSecret）→ 游客 `POST /api/guest code=200` → `LOGIN_OK` → `ws open` → `WS_WELCOME`（认证成功）→ 一局 `ROUND_DONE score=365` → `POST /api/score code=200` → `SCORE_OK`。与 qa-08 的流程一致（qa-08 的控制台原文没有留存，按 demo README 的记录对照）。截图 `demo-login-01/shot-compat-01.jpg`（对局中，online 2）、`shot-compat-02.jpg`（结算、前 5 名）。控制台唯一的 error 是插件的开发阶段提示（建议用 ReportGameStart），与游戏无关 |
| `--no-compat` 产物（放在会话临时目录，不保留） | 同上，占位 AppID，不带 --interfaces | game.js 没有 wx-compat 一行、godot-data 没有 wx-compat.js；verify 失败 0，多一条“注意：没有 wx-compat.js”。未在开发者工具打开 |
| 旧产物 `demo-login-01/wx-out-qa-08` | 兼容层在游戏接口文件里 | 新 verify：失败 0，多一条同样的“注意”（不会误判为失败） |

开发者工具里 `TextEncoder`/`TextDecoder` 已存在，所以汇总里没有这两项。

未测：手机（安卓、iPhone，上面的哪些对象在真机上已存在、补丁是否必要）；震动（开发者工具不震动）；LineEdit 弹键盘（Star Tap 没有输入框）；完全没有 WebSocket 时的 `wx.connectSocket` 实现分支；HTTPS/WSS 正式域名。
