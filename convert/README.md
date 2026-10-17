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
| `--interfaces <js>` | 空模板 | 游戏自己的 JS 接口（GDScript `JavaScriptBridge.get_interface` 要用的全局对象），复制为 `godot-data/local-interfaces.js` |
| `--orientation portrait\|landscape` | portrait | 屏幕方向（写进 game.json） |
| `--locale <xx>` | en | 传给 Godot `initConfig` 的 locale |
| `--name <名字>` | PCK 文件名 | 项目名、数据包名 |
| `--toolchain <json>` | `convert/convert.toolchain.json` | 换转换器路径 |

输出（`--out` 必须是不存在的目录，工具不覆盖任何东西）：

```
<out>/minigame/          小游戏工程：开发者工具打开它；split 配置的 workProject 指向它
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
6. **胶水文件**写进 `godot-data/`，`game.js` 按顺序加载。
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
| `godot-data/local-interfaces.js` | 游戏自己的 JS 接口；默认是空文件；split 的训练等待门默认追加在这里 | **游戏专用**（`--interfaces`） | 打砖块的 `__STARTUP_LAB_PROBE__`、QA 接口（实验用，不进通用模板） |
| `godot-data/local-diagnostic-init.js` | 启动时清理实验诊断的本地存储 | 实验用，**不再生成** | `apply-native-dependency-exports.mjs` |
| 本地存储诊断（`WX15_*_DIAGNOSTIC`） | 把启动各阶段写进 `wx.setStorageSync` | 实验用，**已去掉**；状态改为只放内存：`GameGlobal.__WX15_BOOT_STATE__`、`__WX15_RESOURCE_STATE__`、`__WX15_ENTRY_STATE__`、`Module.__WX15_ASSET_DIAGNOSTIC__` | 多个补丁脚本 |
| `godot-data/breakout.pck` | 手工版遗留的 PCK 副本，实际不用（PCK 走数据包） | **不再生成** | `prepare-local-project.mjs` |

控制台里的 `[WX15_BOOT]`、`[WX15_RESOURCE]` 阶段日志保留，用来排查启动问题。`WX15_` 前缀保持不变，因为 split 工具按这些名字工作。

## 转换后哪些要人工做

- **AppID 和插件**：后台添加 WXGameKit 插件；用 `--appid-from` 或 `--appid` 填 AppID。
- **游戏自己的 JS 接口**：GDScript 里 `JavaScriptBridge.get_interface("X")` 拿的对象，要写进 `--interfaces` 文件。没有的话 Godot 会报 `No interface 'X' registered`（游戏自己判空就不影响运行）。
- **网络**：游戏要联网时，在后台配置 request/socket 合法域名；`wx-game-kit/config.json` 的 `network.dataFileCDN` 现在是占位地址（首包数据从分包加载，用不到 CDN）。
- **存档、登录、支付、分享、广告等微信能力**：要在游戏里自己接，转换不管。
- **3D 和完整玩法**：开发者工具无法自动点击 Godot 画布，进 3D、完整玩一遍要人来做。
- **手机**：开发者工具通过不等于手机通过；预览/上传要先问用户。
- **分包**：官方 `init` 会上传 WASM 和符号表，必须先取得授权，见 `../split/SETUP.md`。

## 已知限制

- 只在 Windows、Godot 4.7.2、wx-transformer 1.0.35、WXGameKit 1.3.15 上验证过。换转换器版本要重新核对补丁锚点（工具找不到唯一锚点会直接报错）。
- 只支持单线程（`threads=no`）、不带 GDExtension 的模板。
- PCK 整个放在首包数据里，适合小 PCK。大资源要按游戏自己的方案放分包或 CDN（未实现）。
- 实测记录见 `RESULT.md`。
