# 踩过的坑和结论

这里只留结论和真机数据，给以后做其他游戏的人和 AI 参考。命令怎么用见 [split/README.md](../split/README.md)；当前已知问题见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。数据来自两款游戏：**打砖块**（2D 进 3D，2026-10-15～16）和 **Star Tap**（标题 + 2D + 3D、联网，2026-10-17）。

## 官方分包（wasmsplit-v2-ci 2.1.5）怎么运作

```
init（上传 WASM 和符号表，同一个 md5 只做一次）→ 采集状态
  → 真机采集 → dosplit --release → 正式版（subVersion 1）
  → dosplit（再进采集状态）→ 补采 → dosplit --release → subVersion 2 …
```

- 同一个 md5 下，后台会累计每一轮的采集结果；之后每次 dosplit 都不用重新上传 WASM。
- `getinfo` 看采集到的函数数；`showfuncname` 导出首包函数清单和本轮新增函数（`*_increment.txt`）。
- 引擎一变（md5 变了）就要重新 init、重新采集。只改 GDScript 或 PCK 一般不用，除非新逻辑用到了新的引擎功能。
- `wasmcode2`（iOS 高性能 archive）不用：组装时要从 game.json 的 subpackages 删掉，并在 packOptions 里忽略。

## 采集

1. **一台手机就能开始**。第一轮首包很小，启动阶段就会调用余包里的函数；采集包会让不能同步等余包的设备（iPhone 高性能模式、开发者工具）先加载余包再进游戏（Star Tap 在 iPhone 上验证过）。
2. **发布前安卓和 iPhone 都要测**。不同平台会走到不同的引擎代码：打砖块只在电脑和 iOS 上采集时，安卓点击后缺了 `InputEventScreenDrag::get_velocity`（安卓拖动触摸）。
3. **开发者工具的数据只能用来调流程**：它的 WebSocket 等实现和手机不同，可能出现手机上不会出现的缺函数（Star Tap 遇到过）。
4. **点击模式**：采集包要原样走完“点击 → 等待 → 就绪”，但不能进入玩法场景，否则场景的函数会被采进首包。游戏用采集门（`__WXSLIM_COLLECT_GATE__`）判断是不是采集包，过门就停。
5. 每轮采集后看 `*_increment.txt`，新增函数应该和兜底日志里报的函数对得上（打砖块完全吻合）。

## 运行时的坑（都已在工具里处理）

| 现象 | 原因 | 处理 |
|---|---|---|
| 安卓点击后一直 PENDING，30 秒超时 | 安卓 `canAwaitLoad` 时官方用 waiterMode 创建分包任务，这种任务必须调用 `await()` 才会完成 | 点击下载用非 waiterMode 任务；兜底时另开 waiterMode 任务并 `await()` |
| iPhone 第一轮采集卡在“编译中”（`unhandledRejection`，栈里是 `redir_*`） | 首包太小，启动就调用余包函数，iOS 高性能模式不能同步等 | 采集包先异步加载余包再进 main |
| 换新游戏后组装报运行时模板不认识 | 官方 `wasm-split.js` 第 2 行 `const tableSize = N` 随游戏变化 | 归一化 tableSize 后再核对 |
| 首包缺函数时 iOS 只能报错 | iOS 不能同步等余包 | 补采；安卓有兜底（同步等余包） |
| 开发者工具里查缺函数槽位查不到名字 | 官方拆分会在原函数表后追加跳转槽位，本地没有对照表 | 在出错的设备上补采一轮 |

## 上传、预览、开发者工具

| 现象 | 原因 | 处理 |
|---|---|---|
| 上传报 800059“wasmcode2/game.js not found” | game.json 声明了被忽略的 wasmcode2 | 组装时从 subpackages 删掉 |
| 上传 3 秒内返回 `abort` | 关闭项目窗口后立刻上传 | 上传前不要关项目窗口 |
| 手机跑的还是旧版本 | 体验版没切换，或微信缓存了旧版 | 后台确认版本号；手机从“最近使用”删掉再进入 |
| 两个版本的日志分不清 | 共用了同一个构建标记 | 每个包都用唯一的 `--label` |
| 预览只到了一台手机 | 预览只推到当前登录开发者工具的微信 | 其他手机在开发者工具里点“预览”扫码 |
| 开发者工具首次打开黑屏 | 编译还没完成 | `ide refresh` 后等 1–2 分钟 |
| 控制台抓取丢行 | 工具有缓冲上限，且会去重 | 以离线测试和云日志为准 |
| 自动点击失败（canvas not found） | 开发者工具不能点 Godot 画布 | 人来操作，或游戏里留自动测试开关（Star Tap 的 `qa`） |
| 官方 init 报找不到符号表 | 官方 CLI 只在工程目录里找 | convert 生成工程里的 `game.symbols.json` |

## 日志

- 汇总行前缀 `[WXSLIM_TIMING]`，convert 和 split 产物都自带。游戏打印 `[STARTUP_3D_FLOW]` 事件（见 split/README），就能看到“首包进场景”“点击进 X”的分段耗时。
- 计时模块接管了 `console.log`/`console.info`：每帧刷屏的着色器绑定日志、原生计时原始 JSON、下载进度等，先汇总成中文行再丢掉。引擎拼日志字符串的开销还在，要从根上去掉需要重编引擎。
- 云日志（可选）只上传白名单：error、计时汇总、点击门状态、兜底、缺函数。计时起点是 game.js 开始执行，不含微信下载主包的时间。
- JS 拿不到进程总内存和 CPU：iOS 用微信性能面板或真机调试，安卓用 Perfdog 或 `adb shell dumpsys meminfo`。帧时间能间接反映 CPU 压力。
- 帧率测量期间切到后台的数据会作废并重测。

## 真机数据

**打砖块（完整引擎，分包：首包 3.54 MB，点进 3D 再下 5.59 MB）**

| | iPhone 16 Pro | 安卓 VCE-AL00 |
|---|---|---|
| 首包进场景 | 2.9–4.5 s | 5.3–18 s（波动很大） |
| callMain | 0.6–1.4 s | 3.3–12 s，Setup 里“场景类型注册”最慢 |
| 点击进 3D | 2.5–3.1 s | 4.9 s |
| 再次进 3D | 约 45 ms | 约 90 ms |
| 帧率 | 60 fps（iPhone 11 约 30 fps，原因未确认） | 60 fps |
| WASM 堆 | 2D 约 40–48 MB，进 3D 后多 8–10 MB | |

**Star Tap（裁剪引擎 6.12 MB，分包：首包 3.04 MB，点进玩法再下 3.55 MB）**

| iPhone 16 Pro | 默认 3D 预热 | 跳过默认 3D 预热 |
|---|---|---|
| callMain | 3.27–3.36 s | 1.05–1.5 s |
| 其中默认 3D 预热 | 约 2.1 s | 0 |

结论：**标题和 2D 用不到 3D 时，一定要跳过默认 3D 预热**（项目设置 `startup/gles3/skip_default_3d_prewarm=true`，需要 trim 编的引擎）。

## 还可以做的

1. 空闲预取：进标题后空闲时下载余包（可以只在 Wi-Fi 下）。这会违背“点击前不下载”，要产品决定。
2. 主包 JS 瘦身：试试关掉 ES6 转译，用一次预览量出真实大小。
3. PCK 资源按场景分包（大游戏必需）。
