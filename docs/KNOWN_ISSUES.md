# 已知问题与处理结论

2026-10-17 用新做的联网小游戏 Star Tap（`examples/startap/`）把整条流程走了一遍：

> 新游戏 → Godot 导出 → **convert** 转通用适配 → 开发者工具 → **trim** 裁剪编译 → 重新 convert → **split** 分包（init → 采集 → Release → 组装）→ iPhone 实测

过程中遇到的问题，按三类记录：**工具缺陷**（改工具）、**能力尚未实现**（记下来，以后做）、**不是工具的问题**（环境、实验脚本、游戏本身）。问题来源包括 Codex 的审阅（只读，五份报告在本机实验目录，不随工具包提供）和这次实际操作。

## 一、已修复

| 问题 | 怎么发现的 | 修复 | 验证情况 |
|---|---|---|---|
| **trim 配置写错不报错**：说明写 `module_xxx`，程序只认 `module_xxx_enabled`；写错的键、非法档位静默忽略 | Codex 审阅 | `scan.mjs normalizeOverrides`：两种写法都认；未知键、非布尔值、非法档位直接报错；`trim profile` 打印校验后的覆盖项 | 单元检查：合法写法通过，三种错误都被拒绝 |
| **trim 扫描误判**：WAV 导入的 `compress/mode=2` 被当成 Basis 纹理；导出预设里的 `vram_texture` 让 bcdec 被保留 | Codex 审阅 | 只看纹理导入器（`importer="texture…"`）的 compress/mode：4 → Basis，2 → bcdec | 重新扫描 Star Tap：balanced 档保留的 7 个模块与 Codex 人工复核结果完全一致 |
| **trim 漏掉引擎内部依赖**：LineEdit 内部创建 PopupMenu，扫描却建议关闭高级 GUI | Codex 审阅（引擎源码 `line_edit.cpp`） | `scan.mjs INTERNAL_DEPS`：用到 LineEdit、SpinBox、OptionButton、MenuButton、MenuBar、ColorPickerButton、CodeEdit 时不关高级 GUI，并在“风险”里写明原因 | 重新扫描 Star Tap：高级 GUI 改为保留 |
| **trim 编译参数不够用**：LTO 写死 full；不能加编译宏；默认不带启动补丁 | Codex 编译时 full-LTO 触发内存保护，改 ThinLTO 和加宏是手工改的 | `--lto full/thin/none`（或 toolchain 的 `lto`）、`--lto-jobs`；toolchain 新增 `cppdefines`；默认带 `trim/patches/wx-startup-df3.patch` 和两个宏 | 补丁在干净的 df3 源码上 `git apply --check` 通过。**改过的编译流程还没完整编一次**（一次 25–50 分钟） |
| **trim 续编不核对身份**：同一提交 ≠ 同一源码；复用编译目录时不检查补丁、宏、参数 | Codex 审阅 | `BUILD.json` 记录 identity（提交、补丁 sha256、宏、LTO、profile sha、编译参数），续编时不一致就拒绝 | 未在真实编译上测 |
| **trim 对所有失败都重试**，没有总时间预算 | Codex 审阅 | 只有编译器崩溃特征（0xC0000005、clang crash 等）才重试；`--max-minutes` 总预算（默认 120）跨所有尝试 | 未在真实编译上测 |
| **默认 3D 预热没法控制** | iPhone 云日志：启动的 Setup 2.6 s 里约 2.1 s 是默认 3D 预热 | 默认补丁让项目设置 `startup/gles3/skip_default_3d_prewarm` 生效；README 写明用法 | **iPhone 实测**：callMain 3.3 s → 1.05–1.5 s，2D、3D 正常 |
| **convert 产物不能直接 init**：官方 CLI 只在工程目录找符号表 | 第一次 init 失败（WASM 已上传） | convert 在工程里生成 `game.symbols.json` 并加进 packOptions.ignore；verify 检查这两项 | 新产物 verify 通过 |
| **符号表“覆盖完整”和“名称可读”混在一起** | Codex 初次核验把名称不可读判成 FAIL | convert check 单独算可读比例，低于 50% 只警告，明确写“不是重编的理由” | Star Tap 引擎：61,369 个函数、1% 可读 → 警告 |
| **换任何新游戏，运行时模板核对都失败** | Star Tap 第一次 collect-pack | 官方 `wasm-split.js` 只有 `const tableSize = N` 随游戏变化，归一化后再比 sha | Star Tap 运行时归一化后与已核对模板一致；28 处补丁全部唯一命中 |
| **训练门“已安装”误判** | 采集包里训练门没装上 | 改为搜训练门脚本自己的头注释 | 重做的采集包里训练门已装上 |
| **iPhone 不能做第一轮采集**（必须准备安卓） | iPhone 卡在“编译中”，云日志 `unhandledRejection`，栈里是 `redir_*` | 采集包补丁：不能同步等余包的设备（iOS 高性能模式、开发者工具）先异步下载、实例化余包，再进 main；能同步等的设备走官方原路径 | **iPhone 实测**：第一轮采集正常（11,397 个函数） |
| `kit ide console` 截掉日志参数（缺函数的槽位号看不到） | 查开发者工具里的缺函数 | 保留参数、过滤 AppID | 已用 |
| `kit lookup` 对官方新增槽位只说“不在函数表内” | 查缺函数槽位 76284 | 说明这是官方拆分新增的跳转槽位、本地查不到，按缺函数补采处理 | 已用 |
| 没有 init、预览命令，只能手写脚本 | 本次操作 | `kit split init`（检查 game.symbols.json，防重复 init）、`kit preview`（推送手机预览，输出各分包大小） | init 防重复检查已用；preview 等同本次用的脚本 |

## 二、能力尚未实现（记录，以后做）

| 问题 | 说明 | 优先级 |
|---|---|---|
| **标题 / 2D / 3D 三包** | 官方分包只有“首包 + 一个余包”。三包要自研 Binaryen 多包拆分：三种采集、共享依赖、每个包的状态和重试、两种进入顺序。另有机制小实验的任务卡 | 中 |
| **PCK 资源分包** | PCK 整个放在首包数据里，函数分包没有同时拆场景资源。大游戏需要按场景拆资源或走 CDN | 中（大游戏必需） |
| **缓存证据不够细** | 同一次运行里再进场景很快只能说明实例复用；退出重开后的下载缓存、编译缓存、实例重建要分别记录 | 低 |
| **点击后下载、编译耗时没进云日志汇总** | 这次 iPhone 日志只有原生计时行，点击门只有状态，没有毫秒数 | 低 |
| **lookup 不能还原官方新增槽位** | 要从 Release 首包和余包的 element 段反推。这次引擎函数名本来就不可读，收益小 | 低 |
| **trim 编译过程不提示内存** | full-LTO 在 32 GB 机器上也可能触发内存保护；现在只能手动改 `--lto thin` | 低 |

## 三、不改，或者不是工具的问题

| 现象 | 结论 |
|---|---|
| wx-compat：UTF-8 编解码 fallback、无原生 WebSocket 时的 fallback 不完整 | 只在环境缺这些对象时才启用；开发者工具和 iPhone 都有原生实现，没走到。**暂不改**，出现问题再补 |
| wx-compat 全局关掉 HTTP 分块传输 | 是为了绕开 Godot 把请求判成 CANT_CONNECT 的问题；代价是大文件下载不能流式。小游戏的接口请求都很小，**暂不改**。下载大文件请直接用 `wx.downloadFile` |
| 开发者工具里偶发“首包缺函数”（WebSocket 连接期间） | 开发者工具和手机的 WebSocket 实现不同，开发者工具专属路径没采到。**环境差异**；真机上 0 次。以开发者工具测分包时要知道这一点 |
| 手机上 WebSocket 1006 断开 | 用户熄屏造成。**不是工具问题** |
| 改名时新输入接在原名字后面（偶发） | 游戏和引擎输入法层面的问题，不影响流程。**不归工具** |
| 第一次编译中止 | 实验监控脚本的查询超时。**实验脚本问题** |
| 初次核验把“名称不可读”判成 FAIL | 核验脚本判断标准错误，已更正为 WARN（工具也已区分）。**实验脚本问题** |
| 预览只推到当前登录开发者工具的微信 | 微信开发者工具的行为；另一台手机在开发者工具里点“预览”扫码 |

## 四、流程跑通情况（Star Tap，2026-10-17）

| 环节 | 结果 |
|---|---|
| convert（完整引擎、裁剪引擎） | 通过；开发者工具 2D、3D 全流程 |
| trim（Codex 用工具编译，ThinLTO + 启动补丁 + 两个宏） | WASM 8.52 → 6.12 MB（转换器压缩）；开发者工具、iPhone 全流程 |
| split 方案二（标题首包，2D+3D 余包） | 首包 WASM 3.04 MB，余包 3.55 MB；iPhone：两种进入顺序、0 次缺函数 |
| 跳过默认 3D 预热 | iPhone callMain 3.3 s → 1.05–1.5 s |
| 安卓 | **分包后未测**（裁剪前单场景版测过登录和对局） |
| split 方案一（标题+2D 首包，3D 余包） | **未做** |
| 微信登录换 openid | **未测**（服务器没配 AppSecret，走了游客登录） |
