# 微信小游戏 WASM 分包（官方 V2）操作手册

> 本文保留原实验的历史数据和脚本名，供参考；历史工程、脚本和原始日志不随工具包分发。当前可执行入口是 [`split/kit.mjs`](../split/kit.mjs)，按 [`split/README.md`](../split/README.md) 和 [`split/SETUP.md`](../split/SETUP.md) 使用；不要把下面的历史路径当作包内现有文件。

本目录（stage12）从 Release1 出发，依次做了 Profile2 采集、Release3、Profile4 安卓补采和 Release5，最终产出体验版 0.12.7，并在 iOS 和安卓上验证了“点击前不下载剩余 WASM，点击后才下载并进入 3D”。下面把可复用的流程、脚本和坑记下来，供以后做其他小游戏时参考。

## 1. 目标形态

- **首包**：只包含引擎启动和首个场景（2D）用到的函数（`wasmcode/`，本例 3.54 MB br）。
- **剩余 WASM**（`wasmcode1/`，本例 5.59 MB br）：用户点击进入重场景（3D）时才 `loadSubpackage` 下载、实例化。
- **wasmcode2**（iOS 高性能 archive）：不用。物理文件保留，但要在 packOptions 里忽略，并从 game.json 的 subpackages 中删掉。
- **兜底**：点击后如果首包仍缺函数，同步等待剩余 WASM（仅限安卓 `canAwaitLoad`），不报错。

## 2. 版本链（官方 wasmsplit-v2-ci 2.1.5）

```
init(上传 WASM+符号, 只做一次) → Profile(sub 0)
  → 采集 → dosplit --release → Release1
  → dosplit(Profile2) → 采集补充路径 → dosplit --release → Release3
  → dosplit(Profile4) → 安卓真机补采 → dosplit --release → Release5
```

- 同一个 md5 下，后台会累计各 Profile 版本的采集结果。之后每次 `dosplit` 都不需要重新上传 WASM。
- `getinfo` 查看采集函数数；`showfuncname` 导出首包函数清单和本轮新增函数（`*_increment.txt`），用来核对补采到了什么。
- 引擎或 WASM 一旦变化（md5 变了），就要重新 init 并重新采集。只改 GDScript 或 PCK 一般不用，除非新逻辑用到了新的引擎功能。

## 3. 采集规则（最重要的经验）

1. **安卓和 iOS 真机都要采**。只在电脑模拟器和 iOS 上采集时，安卓点击后缺了 `InputEventScreenDrag::get_velocity`（安卓拖动触摸路径）。电脑模拟器的数据只能用来调试流程。
2. **采集包要覆盖“点击 → 等待下载 → 就绪”这一整段**，但不能进入重场景，否则重场景的函数也会被收进首包。做法是做一个训练版 PCK：点击后走同样的输入处理和等待门轮询，但就绪后不加载 3D 就返回 2D（见 `v2-phone-final-2d-recollection-11/source`，`COLLECTION_2D_ONLY`）。
3. 训练用等待门（`local-interfaces.js` 末尾的 `WX15_TRAINING12_GATE`）：先返回若干帧 PENDING，再返回 READY，用来跑通与正式版相同的 GDScript 和 JS 桥接轮询路径。
4. 每轮采集后看 `*_increment.txt`。新增函数应该和兜底日志里报的函数对得上，本例完全吻合。

## 4. 正式包组装流水线（scripts/）

| 步骤 | 脚本 | 作用 |
|---|---|---|
| 分包 | `run-official-dosplit.mjs profile\|release [tag]` | 调用官方 CLI 一次，记台账，不自动重试 |
| 点击下载补丁 | `03-assemble-release3-onclick.mjs`（`DST=`） | 给官方 `wasm-split.js` 打 12 处点击门补丁，装正式 PCK，删 wasmcode2 声明 |
| 云日志与计时 | `05-assemble-cloudlog.mjs <dst>`（`SRC= BUILD=`） | 计时模块、云日志白名单、运行时打点 |
| 兜底 | `08-assemble-fallback.mjs`（`SRC= DST= BUILD=`） | 首包缺函数时同步等待（安卓） |
| 安卓等待模式修复 | `13-fix-android-waiter.mjs`（`SRC= DST=`） | 点击下载用非 waiterMode 任务（必须有） |
| 性能日志 | `15/17-assemble-perf*.mjs` | 内存、帧率、内存告警、着色器汇总、日志精简 |
| 采集包 | `10-assemble-profile4-collect.mjs` | Profile 产物加计时和云日志，用于真机采集 |
| 上传 | `06/09/11/12/14/16/18-upload-*.mjs --execute-once` | 一次一个台账；`abort` 或失败后改名台账再发起 |
| 读云日志 | `PKG=<目录> node 07-read-cloud-logs.mjs` | 只读，按会话输出中文摘要（DIGEST.txt） |
| 离线测试 | `test-waiter.mjs <目录>`、`test-fallback.mjs` | 用真实运行时代码加模拟的 wx 环境测点击门和兜底 |
| 函数名查询 | `lookup-func.mjs <槽位>` | 兜底日志里的编号（表槽位）换算成函数名 |
| 开发者工具 | `ide.mjs <tool> --project <绝对路径>` | 本地自动化（只允许 stage12 的项目） |

以后做通用化时，这些脚本应该合成一个带参数的命令行工具（项目路径、点击门 API 名、训练 PCK、构建标记、版本号），各步骤的输入输出目录由工具自动管理。

## 5. 踩过的坑（都已在脚本里处理）

| 现象 | 原因 | 处理 |
|---|---|---|
| 安卓点击后一直 PENDING，30 秒超时（0.12.4） | 安卓 `canAwaitLoad` 时官方用 waiterMode 创建分包任务，这种任务必须调用 `await()` 才会完成 | 点击下载时临时关掉 waiterMode（脚本 13）；兜底时另开一个 waiterMode 任务并 `await()` |
| 上传报 800059“wasmcode2/game.js not found” | game.json 声明了 wasmcode2 分包，但该目录被 packOptions 忽略了 | 组装时从 subpackages 删掉 wasmcode2 |
| 上传 3 秒内返回 `abort` | 关闭项目窗口后立刻上传 | 上传前不要关项目窗口 |
| 手机跑的还是旧版本 | 体验版没切换，或微信缓存了旧版 | 后台确认版本号后设为体验版；手机从“最近使用”删掉再进入 |
| 两个版本的日志分不清 | 共用了同一个云日志构建标记 | **每个上传版本都用独立的 `phone-log-config.js` build 标记** |
| 开发者工具首次打开新项目时黑屏 | 编译还没完成 | 执行一次 `simulator_refresh`，再等 1–2 分钟 |
| 开发者工具控制台抓取丢行 | 工具有缓冲上限，且会去重 | 用离线测试和云日志确认，不要只依赖控制台抓取 |
| 自动触摸 `automation_game_action` 失败 | Godot 画布报 “canvas not found” | 采集和验证操作由人在模拟器或手机上完成 |
| 关闭 ES6 转译做瘦身 | 包里有 ES 模块 `import` 和可选链 | 暂不关闭；以后单独实验，并用一次预览量出真实大小 |

## 6. 云日志与日志策略

- 走已有云开发环境的 `phoneLogIngest` 云函数，数据写到 `phone_log_batches`，用 `cloud_db_read_doc` 只读查询。
- **上传白名单**：`error`、`WX15_TIMING`、`WX15_RELEASE_CLICK`、`WX15_FALLBACK`、`PHONE_LOG_START`、`transition_failed`、`COVERAGE_MISS`、`WX15_CLICK_`。
- **控制台精简**（计时模块接管了 `console.log` 和 `console.info`）：
  - 丢弃：重复的 `[WX_SHADER_BIND]`（每帧刷屏）、`[WX_SHADER_COMPILE]`、原生计时的原始 JSON、`REPRO_*`、`STARTUP_3D_FLOW`（只保留 transition_failed）。
  - 丢弃前已经汇总成中文行。
  - 引擎端拼着色器日志字符串的开销仍然存在，要从根上去掉需要重新编译引擎。
- **中文汇总行**（`[WX15_TIMING]`）：
  - 首包进场景：总计、插件加载器、首包 WASM 下载编译、callMain、WASM 堆、设备。
  - callMain 内部和 Setup 细分（原生计时，20ms 以下子项省略）。
  - 着色器：编译次数和耗时、最慢的着色器、首次使用数、拦截的日志行数。
  - 点击进 3D：总计，剩余 WASM 的下载、编译实例化，3D 资源加载到首帧；再次进 3D 单独一行。
  - 帧率：2D 在进场景 3 秒后测 5 秒，3D 在首帧后测 5 秒；同时报最长一帧、卡顿次数、WASM 堆峰值、内存告警次数。
  - 首包缺函数兜底：点击前还是点击后、等待时长、函数编号。
- 计时起点是 game.js 开始执行，不包含微信下载主包的时间。

## 7. 实测结果（0.12.5–0.12.6）

| | iOS（iPhone 16 Pro） | 安卓（VCE-AL00） |
|---|---|---|
| 首包进场景 | 2.9–4.5 s | 5.3–18 s（波动很大） |
| callMain | 0.6–1.4 s | 3.3–12 s；Setup 占大头，其中“场景类型注册”最慢 |
| 点击进 3D | 2.5–3.1 s | 4.9 s |
| 再次进 3D | 约 45 ms | 约 90 ms |
| 帧率 | 2D 和 3D 都是 60 fps | 待 0.12.7 补测 |
| WASM 堆 | 2D 48 MB → 3D 58 MB | 同左（模拟器） |

## 8. 后续方向（按收益排序）

1. 引擎裁剪：用 Godot build profile 去掉用不到的类和模块。预计能减少安卓上最慢的类型注册，首包也会变小；需要重新编译、重新 init、重新做三端采集。同时去掉引擎里的着色器调试打印。
2. 可选的空闲预取：2D 进场景后空闲时下载剩余 WASM，可以只在 Wi-Fi 下开。这会违背“点击前不下载”，需要产品层面决定。
3. 主包瘦身：做 ES6 转译实验，并清掉 `godot-data/breakout.pck` 这个后备路径。
4. 把第 4 节的脚本合并成通用工具。

## 9. vConsole 日志分类（0.12.7 iOS 导出，0.12.8 起已精简）

| 来源 | 示例 | 价值 | 处理 |
|---|---|---|---|
| 我们的汇总 `[WX15_TIMING]` | 首包进场景、callMain、着色器、帧率、进 3D | 主要看这个 | 保留，并上传到云 |
| 点击门 `[WX15_RELEASE_CLICK]` | IDLE→PENDING→READY | 判断是否点击前就下载 | 保留，并上传到云 |
| 启动阶段 `[WX15_BOOT]`、`[WX15_RESOURCE]` | FACTORY_START…MAIN_RETURNED | 启动卡住时用来定位 | 保留（每次启动约 10 行） |
| 插件 `[PLUGIN LOG]`、`[PLUGIN TIME LOG]` | 下载 wasm 代码包、wasm 编译耗时、callMain 耗时 | TIME LOG 有用，其余一般 | 插件在独立上下文里，过滤不到 |
| 平台上报 `[minigamefe keyValueReport]` | WXGameWASMLaunchTime / Exception | 微信平台统计，只是打印 | 0.12.8 起拦截打印（不影响上报本身） |
| wasm-split 下载进度 | 代码分包1下载进度 -16215 … 4096 MB | iOS 上数值无意义，约 140 行 | 0.12.8 起拦截 |
| 大对象转储 | Module is / unity framework / systemInfo | 基本没用 | 前两个已拦截；systemInfo 来自插件，过滤不到 |
| 引擎警告 | `RGBAFloat not supported…converting to RGBAHalf` ×4 | 3D 场景里有浮点纹理，硬件不支持，被降级转换 | 0.12.8 起重复的只显示一次；从根上改资源或引擎设置 |
| `<Function>` | 引擎错误输出附带的函数参数 | 没有用 | 已拦截 |
| 开发提示 `ReportGameStart` | `[PLUGIN ERROR]` 开发阶段提示 | 线上不出现 | 忽略 |
| 运行库 `[Expt]`、`registerTaskType`、`rccEngine` | 微信内部 | 没有用 | 过滤不到，忽略 |

注意：
- “setTimeout for download wasmcode2: 30000” 只是一行打印，真正的定时器已被补丁关掉，不会下载 wasmcode2。
- callMain 返回后插件又打了一次“开始下载wasm代码包 / invoke framework()”，那是插件的第二次入口调用，被我们的单入口保护复用了第一次的结果（20ms 命中缓存），不会重复初始化引擎。
- 帧率测量窗口跨过切后台时数据作废（0.12.7 里 iPhone 16 Pro 的 1.6fps 就是这种情况）；0.12.8 起会自动作废并重测一次。
- iPhone 11 上 2D 和 3D 都稳定在约 30fps，iPhone 16 Pro 和安卓 VCE-AL00 是 60fps。iPhone 11 疑似被限到 30 帧（低电量模式或微信的帧率策略），还没确认。
- WASM 堆：低分辨率设备进 2D 时 40.3 MB，iPhone 16 Pro 48.4 MB；进 3D 后增加约 8–10 MB。
- 整体内存和 CPU：JS 拿不到进程总内存和 CPU。iOS 只能用微信的性能面板或真机调试；安卓可以用 Perfdog，或 `adb shell dumpsys meminfo` 查看微信小游戏进程。帧时间可以间接反映 CPU 压力。
