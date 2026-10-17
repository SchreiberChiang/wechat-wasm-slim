# Star Tap：从新游戏到微信小游戏 + 裁剪 + 分包（2026-10-17）

## 游戏

Godot 4.7.2（GL Compatibility，竖屏 720×1280）。三个场景：

- **标题**（`scenes/title.tscn`）：输入名字（LineEdit，弹微信键盘），点 LOG IN 才登录，然后选 PLAY 2D / PLAY 3D。
- **2D 打星星**（`play2d.tscn`）：canvas_item shader 画的五角星、CPUParticles2D、屏幕抖动。
- **3D 打星星**（`play3d.tscn`）：透视相机、方向光、程序生成的星星网格、spatial shader、CPUParticles3D。所有 3D 类只在这个脚本里，场景用 `load()` 在点击后才加载，方便分包。

登录：微信里先 `wx.login` 拿 code，服务器换 openid（`server/wx.private.json` 配 appid 和 secret）；服务器没配置时回退游客登录（设备号存在 `user://`）。HTTP 提交分数、2D/3D 分开排行；WebSocket 推在线人数和动态。掉线或登录过期回标题并显示原因。音乐和音效由 `tools/gen-audio.mjs` 程序合成。

## 数据

| 阶段 | 结果 |
|---|---|
| 完整引擎 convert | WASM 8.52 MB（压缩后）。开发者工具 2D、3D 全流程；手机（移动网络）登录、对局、提交分数正常（服务器日志看不出机型） |
| trim balanced | 保留 freetype、gdscript、mbedtls、msdfgen、svg、text_server_adv、websocket；保留 3D 和高级 GUI（LineEdit 依赖）；关 2D/3D 物理、导航、XR。ThinLTO + 启动补丁。WASM **6.12 MB**（-28%）。开发者工具、iPhone 全流程 |
| 官方 init | 后台预处理 280 s |
| 第一轮采集（iPhone） | 11,397 / 61,369 个函数（标题、登录、登出、改名、点 2D/3D 等待门） |
| split 方案二 Release | 首包 WASM **3.04 MB**，余包 **3.55 MB**（整包 8.38 MB） |
| iPhone 实测（3 次） | 0 次缺函数、0 次兜底；2D、3D 两种进入顺序都打完整局；余包只下载、实例化一次，之后复用 |
| 跳过默认 3D 预热（只换 PCK） | iPhone callMain **3274–3358 ms → 1054–1505 ms**（Setup 2.6 s → 0.5–0.6 s，3D 预热 2.1 s → 0） |

## 没测的

- 分包版在安卓上。
- 方案一（标题 + 2D 首包，3D 余包）：配置 `planA.kit.json` 已备好，没采集。
- 微信登录换 openid（服务器没配 AppSecret）。
- 加载计时汇总修好后（开发者工具已验证）还没在手机上看过；跳过预热后进 3D 的真实耗时待手机数据。

## 做法要点（给下一个游戏参考）

> 2026-10-17 之后 Star Tap 改用 Godot 插件 [wx_split](../../godot-addon/README.md)：下面的点击门、采集包判断、计时事件、自动测试开关都由插件提供，`game.gd` 里不再手写，`DemoWx` 只剩登录。改完在电脑上（本机测试服务）2D、3D 各自动玩完一局；开发者工具和手机上**未测**插件版。

- **接口文件**（`wx/demowx.js`）只放游戏自己的 JS 接口：`DemoWx.startLogin()`（wx.login）。浏览器兼容由 convert 默认的 `wx-compat.js` 提供，点击门和采集包探测由插件 JS（convert 默认装成 `godot-data/wx-split.js`）提供。
- **点击门**：`Game.enter_2d/enter_3d()` 调 `WxSplit.enter_scene()`，插件轮询到 READY 再 `load()` 场景，采集包里过门就停、不加载场景。2D 默认不过门；`demowx.js`（不写配置）= 方案一，`demowx-gate2d.js`（`WxSplitConfig.gate["2d"] = true`）= 方案二。正式包和采集包共用一个 PCK。
- **计时事件**：标题调 `WxSplit.mark_title_ready()`，2D/3D 场景调 `WxSplit.mark_first_frame("2d"|"3d")`，`enter_scene` 自己打 `click` / `transition_failed` / `collection_gate_complete_3d_blocked`。计时模块据此输出“首包进场景”“点击进2D/3D”的分段耗时。
- **测试用自动玩**：`wx/demowx-qa3d.js`（`WxSplitConfig.qa = "3d"`）登录后自动进 3D 玩一局，电脑上用 `-- --qa-play=2d|3d --qa-quit`；插件 `WxSplit.qa_mode()` 读开关，自动玩的逻辑在游戏脚本里。开发者工具不能点 Godot 画布，靠这个验证全流程。
- **服务器**：`server/server.mjs` 只用于测试（频率和连接数有限制，不记录 token、openid、AppSecret）。IP + HTTP 只能在开发者工具（不校验合法域名）或手机调试模式下用。
