# convert：Godot Web 导出 → 微信小游戏通用适配（WXGameKit）工程

一条命令把 Godot 4.7.2 的 Web 导出（`godot.js` + `godot.wasm` + `.pck`，最好带 `godot.js.symbols`）转换成 WXGameKit 通用适配小游戏工程。产物满足 `split/SETUP.md` 第 3 节的“输入工程约定”（除了官方 `init`，那一步要上传 WASM，必须先取得授权），可以直接交给 `split/kit.mjs` 分包。

这是把打砖块早期手工转换（官方 wx-transformer 1.0.35 + 约 10 个一次性补丁脚本，历史见 [PLAYBOOK](../docs/PLAYBOOK.md)）整理成的可重复工具。

## 需要准备

| 项目 | 说明 |
|---|---|
| Node.js 24 | 运行本工具 |
| 官方 wx-transformer 1.0.35 便携版 | `https://res.wx.qq.com/wechatgame/product/wx-minigame-transformer/1.0.35/wx-transformer-v1.0.35-distribution.zip`，解出 `wx-transformer-v1.0.35-win.exe`，路径写进 `convert.toolchain.json`（工具会核对 sha256）。只在本机运行，不安装 |
| 微信分支引擎 | citizenll/godot 微信分支（本例 `df3cdd9bc`）编译的 Web 模板，`threads=no`。**官方 Godot 模板不行**（`check` 会拦下）。用 `trim build` 编出来的 `artifacts/` 也可以直接当输入 |
| Godot 导出 | 编辑器 4.7.2，Web 预设，导出时用上面的自定义模板；或者只 `--export-pack` 导出 `.pck`，配合引擎产物使用 |
| 小游戏 AppID | 后台已添加 WXGameKit 插件（provider `wxe5a48f1ed5f544b7`，1.3.15）。没有也能先转换（写占位符），但开发者工具打开前要有 |

## 命令

```
node convert/convert.mjs check   --export <Web导出目录>  [--pck <x.pck>] [--symbols <x.js.symbols>]
node convert/convert.mjs convert --export <Web导出目录>  --out <新目录> [选项]
node convert/convert.mjs verify  --project <新目录>/minigame
```

输入也可以逐个指定：`--js <godot.js> --wasm <godot.wasm> --pck <game.pck> --symbols <godot.js.symbols>`。`--export` 目录里能自动找到的就不用写。

`convert` 选项：

| 选项 | 默认 | 说明 |
|---|---|---|
| `--appid-from <工程目录或 project.config.json>` | — | 从已有小游戏工程复制 AppID（推荐，AppID 不出现在命令行和聊天里） |
| `--appid <wx…>` | 占位符 `wx0000000000000000` | 直接给 AppID |
| `--no-compat` | 关（即默认生成兼容层） | 不生成 `godot-data/wx-compat.js`。只在游戏自己的 `--interfaces` 已经补了这些浏览器对象、或要排查兼容层本身时用 |
| `--interfaces <js>` | 空模板 | 游戏自己的 JS 接口（GDScript `JavaScriptBridge.get_interface` 要用的全局对象），复制为 `godot-data/local-interfaces.js` |
| `--orientation portrait\|landscape` | portrait | 屏幕方向（写进 game.json） |
| `--locale <xx>` | en | 传给 Godot `initConfig` 的 locale |
| `--name <名字>` | PCK 文件名 | 项目名、数据包名 |
| `--toolchain <json>` | `convert/convert.toolchain.json` | 换转换器路径 |

输出（`--out` 必须是不存在的目录，工具不覆盖任何东西）：

```
<out>/minigame/          小游戏工程：开发者工具打开它；split 配置的 workProject 指向它（里面有官方 init 要用的 game.symbols.json，已从小游戏包排除）
                         默认还装了加载计时汇总 godot-data/wxslim-timing.js（日志前缀 [WXSLIM_TIMING]，--no-timing 不装）
<out>/webgl/symbols.json 转换器生成的符号表；split 配置的 symbols 指向它
<out>/convert-work/      接好启动桥的 JS、转换器配置和日志（转换器配置里只有占位 AppID）
<out>/CONVERT_REPORT.json 输入 sha256、大小、md5、AppID 来源（不含 AppID 本身）
```

## 转换做了什么

1. **接启动桥**：把 Godot 引擎 JS 在 Emscripten 模块定义末尾截断（去掉 Godot 的 `Engine` 网页包装），接上 `assets/godot-bridge.js`。原始导出文件不改。
2. **官方 wx-transformer**（Custom 引擎、首包从分包加载、CDN 指向 `127.0.0.1:65535` 占位）：复制 WXGameKit 模板、把 JS 改写成 `framework.js`、brotli 压缩 WASM、把 `.js.symbols` 转成 `symbols.json`。
3. **资源依赖门补丁**（`assets/asset-gate.js`）：转换器在 `createWasm` 里加了 `wasm-preloadAssets` 依赖，改成“首包数据校验通过后才释放、只加一次只放一次”。
4. **WASM 文件名**改为 WASM md5 的前 15 位（官方 `switch-md5` 只接受 15 位），并确认压缩包能还原出原 WASM。
5. **首包数据**：`说明文件 + PCK` 按 Emscripten file_packager 布局拼成数据包（PCK 必须在最后，split 的 PCK 替换依赖这一点），brotli 压缩为 `data-package/<md5前16位>.data.bin`，更新 `launch.data`。
6. **胶水文件**写进 `godot-data/`，`game.js` 按顺序加载：`package-info` → `wx-game-kit` → `custom-package` → `single-entry` → `wx-compat` → `wx-split` → `local-interfaces` → `framework`。
7. **配置**：AppID、项目名；关掉开发期性能弹窗和默认的 Unity 图标。

## 每个胶水文件的作用

| 文件 | 作用 | 与游戏有关？ | 手工版来源 |
|---|---|---|---|
| `framework.js` 里的启动桥 | Godot 工厂 → `initConfig` → `initFS` → 把 PCK `copyToFS` → 只调用一次 `callMain(--main-pack)`；创建 `GODOTSDK` 音频上下文、关 GLX；补全局 `nowPolyfill` | 通用（PCK 路径、大小从 `package-info.js` 读） | `godot-bridge.js`，原来写死 `/breakout.pck` 和 67548 字节 |
| `framework.js` 里的资源依赖门 | 让插件的首包数据回调和 WASM 实例化无论谁先到，运行依赖计数都正确归零 | 通用 | `resource-gate-10/apply.mjs` |
| `godot-data/package-info.js` | 数据包元数据：大小、sha256、PCK 起止位置和挂载路径 | 每个游戏生成 | `assemble-*-resources.mjs` |
| `godot-data/package.metadata.json` | file_packager 格式的同一份元数据（split 的 PCK 替换会同步更新） | 每个游戏生成 | 同上 |
| `godot-data/custom-package.js` | 注册 `setCustomProcessRawDataHandler`：校验解压后的数据大小和 GDPC 头，复制 PCK 字节交给启动桥，释放依赖门 | 通用 | `custom-resource-handler.js` |
| `godot-data/single-entry.js` | 插件会对同一个 Module 请求两次工厂；保证 Godot 只启动一次 | 通用 | `single-godot-entry.js` |
| `godot-data/wx-compat.js` | 浏览器对象兼容层：补 `__globalAdapter`、`TextEncoder`/`TextDecoder`、`Blob`、WebSocket 常量、`navigator.vibrate`，给 `wx.request` 打补丁。让 Godot 的 HTTPRequest、WebSocketPeer、LineEdit 键盘、`Input.vibrate_handheld` 能用（见下一节） | 通用（`--no-compat` 不生成） | Star Tap 的 `demo-login-01/wx/demo-interfaces.js` 第 1–5 项（2026-10-17 开发者工具实测） |
| `godot-data/wx-split.js` | Godot 插件 wx_split 的 JS 侧（`godot-addon/addons/wx_split/wx_split.js` 原样复制）：点击门新旧名、采集包、自动测试开关的探测函数，配置读 `WxSplitConfig` | 通用（不用插件的游戏装上也没影响） | Star Tap 旧 `DemoWx.hasClickGate()` / `isTraining()` |
| `godot-data/local-interfaces.js` | 游戏自己的 JS 接口；默认是空文件；split 的训练等待门默认追加在这里 | **游戏专用**（`--interfaces`） | 打砖块的 `__STARTUP_LAB_PROBE__`、QA 接口（实验用，不进通用模板） |
| `godot-data/local-diagnostic-init.js` | 启动时清理实验诊断的本地存储 | 实验用，**不再生成** | `apply-native-dependency-exports.mjs` |
| 本地存储诊断（`WXSLIM_*_DIAGNOSTIC`） | 把启动各阶段写进 `wx.setStorageSync` | 实验用，**已去掉**；状态改为只放内存：`GameGlobal.__WXSLIM_BOOT_STATE__`、`__WXSLIM_RESOURCE_STATE__`、`__WXSLIM_ENTRY_STATE__`、`Module.__WXSLIM_ASSET_DIAGNOSTIC__` | 多个补丁脚本 |
| `godot-data/breakout.pck` | 手工版遗留的 PCK 副本，实际不用（PCK 走数据包） | **不再生成** | `prepare-local-project.mjs` |

## wx-compat.js 补了什么

通用适配（WXGameKit）运行时不是浏览器，缺几样 Godot 引擎 JS 直接用到的对象。下面每一项都是做 Star Tap 联网小游戏（`../../demo-login-01/`，自动登录 → HTTP → WebSocket 认证 → 提交分数）时查出来的（怎么发现的见表）；HTTP、WebSocket 两项是开发者工具实测出的问题。原则是“缺什么补什么”，已有的不覆盖。控制台打印一行 `[WX_COMPAT] <补了哪些>`，同样的列表放在 `GameGlobal.__WX_COMPAT__`；不记录任何请求地址或内容。

| 项目 | 不补会怎样 | 怎么发现的 | 补法 |
|---|---|---|---|
| `__globalAdapter` | LineEdit 弹/收键盘时引擎的输入法代码直接调用它，通用适配环境没有这个对象 | 阅读微信分支引擎 JS 的输入法部分。Star Tap 没有 LineEdit，**弹键盘本身未实测** | 补一个对象，方法转到 `wx.hideKeyboard`、`wx.onKeyboardComplete`、`wx.offKeyboard*` |
| `TextEncoder` / `TextDecoder` | 引擎 HTTP、WebSocket 代码做 UTF-8 编解码 | 引擎 JS 用到；开发者工具里**已存在**，所以那里不会补（手机上是否存在未测） | 缺失时补一个纯 JS 的 UTF-8 实现 |
| `Blob` | 引擎 WebSocket 收消息时判断 `event.data instanceof Blob`，没有 Blob 直接抛错，收不到任何消息 | 对照引擎 JS 的收消息代码 | 补一个空构造函数（只用来让 instanceof 不报错） |
| WebSocket 常量 | 开发者工具自带的 WebSocket 实例没有 `OPEN` 常量，引擎判断 `readyState !== socket.OPEN` 后**静默丢掉所有发送**；Star Tap 的认证消息发不出去，服务器 5 秒后以 4001 断开 | 服务器收不到认证消息；对照引擎 JS 的发送判断找到原因 | 全局 `WebSocket` 是**只读**的（替换会抛错，曾让整个兼容层失效），只能给原型补 `CONNECTING/OPEN/CLOSING/CLOSED`。完全没有 WebSocket 时才用 `wx.connectSocket` 实现一个（这条分支未实测） |
| `navigator.vibrate` | `Input.vibrate_handheld` 没有效果 | 引擎 JS 用它实现震动 | 转到 `wx.vibrateShort`（<60 ms 轻、<300 ms 中/重）和 `wx.vibrateLong`（≥300 ms）。开发者工具不震动，手机未测 |
| `wx.request` 关分块 | 服务器收到并返回了，Godot 却报 `RESULT_CANT_CONNECT`（2） | Star Tap 登录请求被判失败，但服务器其实收到并返回了 | 引擎用 `enableChunked` 流式接收，开发者工具里请求完成时还没交付任何一块，Godot 看到“已完成且没数据”就断开。补丁强制 `enableChunked:false`，success 时一次性交付 |
| `wx.request` 请求体 | 请求体是 `Int8Array` 等视图时发出去的内容不对 | nakama 赛车项目已复现 | 转成精确范围的 `ArrayBuffer` |
| `wx.request` 头回调 | 不带 `statusCode` 的头回调会让引擎把状态记成 0 | nakama 赛车项目已复现 | 只转发带 `statusCode` 的 `onHeadersReceived` |

另一条经验与兼容层无关、要游戏自己注意：`JavaScriptBridge.eval` 读全局变量拿不到值，改用 `JavaScriptBridge.get_interface` 读接口对象的属性。

控制台里的 `[WXSLIM_BOOT]`、`[WXSLIM_RESOURCE]` 阶段日志保留，用来排查启动问题。`WXSLIM_` 前缀保持不变，因为 split 工具按这些名字工作。

## 转换后哪些要人工做

- **AppID 和插件**：后台添加 WXGameKit 插件；用 `--appid-from` 或 `--appid` 填 AppID。
- **浏览器兼容**：默认已经生成 `godot-data/wx-compat.js`，HTTP、WebSocket、键盘、震动不用再自己写。游戏的 `--interfaces` 文件只放游戏自己的接口（比如登录对象）；从旧产物迁移时，把接口文件里重复的兼容代码删掉（不删也能运行：兼容层只补缺失项；旧代码再给 `wx.request` 包一层，效果相同，只是多一层）。
- **游戏自己的 JS 接口**：GDScript 里 `JavaScriptBridge.get_interface("X")` 拿的对象，要写进 `--interfaces` 文件。没有的话 Godot 会报 `No interface 'X' registered`（游戏自己判空就不影响运行）。
- **网络**：游戏要联网时，在后台配置 request/socket 合法域名（正式上线要 HTTPS/WSS + 已备案域名；开发者工具里 convert 产物默认 `urlCheck:false`，可以先用 HTTP/WS 测）；`wx-game-kit/config.json` 的 `network.dataFileCDN` 现在是占位地址（首包数据从分包加载，用不到 CDN）。
- **存档、登录、支付、分享、广告等微信能力**：要在游戏里自己接，转换不管。
- **3D 和完整玩法**：开发者工具无法自动点击 Godot 画布，进 3D、完整玩一遍要人来做。
- **手机**：开发者工具通过不等于手机通过；预览/上传要先问用户。
- **分包**：官方 `init` 会上传 WASM 和符号表，必须先取得授权，见 `../split/SETUP.md`。

## 已知限制

- 只在 Windows、Godot 4.7.2、wx-transformer 1.0.35、WXGameKit 1.3.15 上验证过。换转换器版本要重新核对补丁锚点（工具找不到唯一锚点会直接报错）。
- 只支持单线程（`threads=no`）、不带 GDExtension 的模板。
- PCK 整个放在首包数据里，适合小 PCK。大资源要按游戏自己的方案放分包或 CDN（未实现）。
- 实测记录见 `RESULT.md`。
