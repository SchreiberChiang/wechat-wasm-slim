# GLX 最小初始化与绘制探针

开发者工具实际验证见 [WebGL 实测记录](../../docs/GLX_DEVTOOLS_WEBGL_20261022.md)：默认 WebGL 的游戏内摘要已读取成功。CLI 若返回 `canvas not found` / 诊断 null，先核对是否在实际游戏上下文；不要据此判定游戏按钮或渲染失败。

Godot 4.7.2、GL Compatibility、单线程。没有联网、登录、赛车资产或默认云上报；图形与手动测试音均由代码生成。

顶部验收身份显示 `packageVersion`、实际 `actualContext.mode`（未观察到则为 `unknown`，不能用请求模式代替）及短会话码。短码来自已有 `console.__phoneLogRelay.session`，完整会话在手动 JSON 的 `acceptanceIdentity.cloudSession` 内；接口载入时缓存，relay 停止后仍保持。没有 relay 时明确显示 `local/no cloud`，标识只保留在本次启动内存。接口不创建云会话、存储、canvas、轮询、GPU 查询或额外日志。黑屏读不到可见标签时，人工结果仍未绑定到会话，不能仅凭云记录推定配对成功。

`Play quiet tone (0.3 s, manual)` 只在点击后播放 440 Hz、峰值 8% 的短音，带淡入淡出；请求次数只证明按钮回调，须人工确认触摸和听到声音。原生/headless、脚本测试和播放调用均不能充当真机音频验收。源码修改后需重新导出 PCK 并生成新包身份，旧 PCK 不含这些控件。

- 顶部直接在主视口绘制 2D 色条与移动圆。
- 中部先显示独立 `SubViewport` 的 2D 纹理；按钮切换到旋转的 3D 立方体。
- `Resize buffer` 在 640 × 240 与 320 × 120 间切换两个离屏视口的尺寸，观察纹理是否持续更新、比例是否正常。
- 状态行显示 Godot 主视口尺寸、尺寸事件计数和最近四条前后台/焦点通知。通知出现不代表恢复渲染已通过。
- `Read rendering diagnostic (manual)` 才读取并显示/打印 `GameGlobal.__WXSLIM_RENDER_DIAGNOSTIC__.read()` 的 JSON。使用 `JavaScriptBridge.get_interface`，不依赖 `eval` 全局变量行为；不写存储，不发送网络请求。
- `[GLX_SMOKE] Godot frame_post_draw reached` 只证明 Godot 到达绘制回调；不能证明手机有可见画面、实际上下文是 GLX 或完整兼容性。

## 本地准备

从仓库根目录执行；`<Godot 4.7.2>` 替换为本机编辑器路径。输出和日志留在忽略目录 `.local/glx-smoke/`，不要提交引擎、PCK、转换输出或设备证据。

```powershell
New-Item -ItemType Directory -Force .local/glx-smoke
$smokeOut = (Resolve-Path .local/glx-smoke).Path
& '<Godot 4.7.2>' --headless --path examples/glx-smoke --editor --import --quit --log-file "$smokeOut/import.log" | Out-String
& '<Godot 4.7.2>' --headless --path examples/glx-smoke --export-pack Web "$smokeOut/glx-smoke.pck" --log-file "$smokeOut/export.log" | Out-String
& '<Godot 4.7.2>' --headless --path examples/glx-smoke --quit-after 60 --log-file "$smokeOut/headless.log" | Out-String
node wxslim.mjs config --config examples/glx-smoke/wxslim.json
```

`--export-pack` 仅导出内容包，不需要安装 Web 引擎模板。headless 使用 dummy 渲染器，只检查脚本/场景生命周期；不能验证 WebGL 或 GLX。

2026-10-22 本机已用 `4.7.2.stable.steam.ed1daf0bf` 完成导入、PCK 导出及 headless 60 帧运行，均正常退出；PCK 为 10,108 字节。headless 没有触发 `frame_post_draw`，这不是 GLX 失败证据。微信初始化、可见画面、触摸、真实主画布 resize 和前后台恢复仍待相应环境验证。

在此目录手工创建被忽略的 `wxslim.private.json`，填写本机微信版引擎目录；需要真机前再填经批准使用的 `game.appidFrom`。不要把实际引擎路径、AppID 或赛车副本路径放进公开配置：

```json
{
  "engine": { "artifacts": "<本机微信版 Godot 引擎目录>" }
}
```

同一个 PCK、引擎和接口构建两份新输出：

```powershell
node convert/convert.mjs check --config examples/glx-smoke/wxslim.json
node convert/convert.mjs convert --config examples/glx-smoke/wxslim.json --render-mode webgl --out .local/glx-smoke/webgl-01
node convert/convert.mjs verify --project .local/glx-smoke/webgl-01/minigame
node convert/convert.mjs convert --config examples/glx-smoke/wxslim.json --render-mode glx --out .local/glx-smoke/glx-01
node convert/convert.mjs verify --project .local/glx-smoke/glx-01/minigame
```

输出目录必须不存在；重跑使用新的序号。`wxslim.json` 的默认仍为 `webgl`。GLX 初始化失败时保留失败原因，显式重新选择 WebGL 输出完成回退，不修改已验证包、不把回退称为 GLX 成功。

## 最小手机方案

2026-10-22 用户后续已批准最小包手机对照预览。执行状态和证据边界见 [手机验证记录](../../docs/GLX_PHONE_VALIDATION_20261022.md)；计划中的子项不因预览推送成功而自动通过。

1. 批准预览/上传和手机操作后，固定一台手机、微信版本与基础库版本，先运行 WebGL 基线。核对一次性摘要中的包版本、请求模式、能力检测、实际上下文、初始化结果/失败原因。
2. 观察主视口 2D、离屏 2D 各连续动画 10 秒；切换 3D 并旋转 10 秒；切回 2D。记录画面、触摸和纹理更新，不仅记录控制台。
3. 在 2D、3D 各切换离屏尺寸两次；核对色条、圆和立方体的比例、完整性与持续更新。支持系统旋转/窗口变化的设备另记录实际主画布 resize；离屏 resize 通过不能替代主画布 resize 结论。
4. 进入后台 5 秒后返回，在 2D、3D 各执行一次；核对画面恢复、动画、按钮和尺寸状态。第一次暂停/恢复事件与恢复后的实际可见画面分别记录。
5. 同机启动 GLX 对照包，重复步骤 1–4。能力位不支持时记为该环境阻断；实际上下文不匹配记为初始化失败，保留可读原因。两者都不能直接推断赛车或 GLX 本身不兼容。
6. 最后重开同一 WebGL 基线，检查回退仍可用。该最小例通过后才讨论赛车副本验证；iOS/Android 互不代替。

如果初始化阶段终止，按钮可能尚未显示，此时检查启动的一次性摘要；不要用缺少界面推断 GLX 上下文已经成功创建。电脑脚本测试、原生 headless、转换器 `verify` 和模拟器能力检测各有边界，均不能代替手机 GLX 像素与前后台恢复证据。

## 黑屏时的显式帧诊断副本

2026-10-23 手机出现同一 GLX 包初始化完成但重新进入后黑屏，详见上述手机记录。普通 `initialized` 摘要不观察持续呈现，因此另外提供显式诊断工具；默认转换流程不会加载它。

```powershell
node examples/glx-smoke/diagnostic-engine.mjs --input <原始引擎godot.js> --out <新目录/godot.js>
```

工具只读原引擎，要求输出文件不存在，并核对唯一源码锚点。将这个新 JS 作为 `convert --js` 输入，WASM、PCK、symbols 与原对照包保持相同；输出到全新的目录。诊断 JS 的内容参与 `packageVersion`，不修改旧包冒用旧版本。

探针在原调用边界记录 native 主循环、afterDoFrame/flush、batchRenderAsync、swapWindow 的次数和返回/抛错状态；不读取命令缓冲内容，不创建上下文，不补发 rAF、flush、swap 或自动恢复。约 3、8、15 秒输出最多三条 `[WXSLIM_FRAME_PROBE]`，计时起点为探针安装，实际时间以记录为准；采集窗口结束后停止计数并移除自有监听。记录中的调用返回和帧数增长都不能替代人工可见画面验证。

此版本用于定位，不能用来测性能或声称修复。手机保持前台约 20 秒，无需点击游戏内摘要按钮，再从 vConsole 导出全部日志；记录这次是否黑屏。若返回到同一个已结束采集的 JS 会话，旧三条记录不代表恢复后的状态。新预览及手机操作继续受会话中的用户授权范围约束。

### 经批准的现有云日志接入

`cloud-interfaces.mjs --config <private JSON> --out <新 interfaces.js>` 将现有 `split/assets/phone-log.js` 与本示例手动接口拼合。私有 JSON 必须明确给出 `env` 和唯一 `build`；正常 convert 使用该接口作为 `--interfaces`，生成新包身份。工具不部署或修改云函数，不修改默认转换器，也不覆盖已有输出。

仅转发 PHONE_LOG_START、WXSLIM_BOOT、WXSLIM_RENDER_SUMMARY、WXSLIM_FRAME_PROBE 和下述 WXSLIM_PRESENTATION / WXSLIM_CANVAS_EXPORT；其他 console/error 不上传。复用现有协议的设备平台、型号、系统和基础库字段，服务端按既有身份校验存储。上报在 60 秒后停止，后台冻结可能延迟定时器执行；未成功发送的队列不会保存到存储。按唯一 build 查询现有 phone_log_batches，必须看到云端实际返回记录才能声称上报成功。2026-10-23 用户已明确批准本轮最小诊断包接入现有云日志及手机预览，未授权更改赛车或服务器。

### 帧缓冲与呈现查询诊断

在独立输出目录使用原始 JS（不是已经带帧探针的 JS）：

```powershell
node examples/glx-smoke/presentation-engine.mjs --input <原始引擎godot.js> --out <新目录/godot.js>
```

该工具保留原帧计数探针，并加入 `presentation-probe.js`。正常转换器、默认 WebGL 和原始引擎均不加载此查询探针。约 4、9 秒分别等待下一次**原有 swap**，在调用前后读取 GLctx 的当前 draw/read framebuffer、完整性状态、viewport、scissor、colorMask、pack 状态、上下文丢失状态及 drawingBuffer 尺寸。每组只输出一条 `[WXSLIM_PRESENTATION]`，最多两条；到约 16 秒仍无原 swap 时输出未采到的原因并停止。绑定值按下述 v2 规则分类，不记录句柄，也不把 native 非零值直接解释成 Godot 离屏缓冲。

云接口私有 JSON 增加 `"presentation": true`，才能在 `local-interfaces` 阶段安装 `presentation-loader.js`，先于 `loader.start()` 观察既有 `loader_start_ok` 标记；引擎工厂阶段再安装已太晚。观察成功立刻恢复原 mark；60 秒未观察到则恢复并记超时。没有显式选项时不安装该包装。此字段不观测原生覆盖层是否已退场。

只在当前 READ framebuffer 完整、读颜色缓冲已选中、pack buffer/行布局安全时，读取其原点一个 1×1 像素，上传 RGB/alpha 范围、非黑点数和未写入哨兵计数，不上传截图或逐像素 RGBA。当前目标可能是 native 宿主或离屏缓冲，不能称为屏幕像素；原点不依赖主画布尺寸与当前 FBO 尺寸相同。其余情况明确跳过；不绑定 framebuffer，不改 pack、viewport 或颜色掩码，不调用 getError（避免清掉原错误）、flush、finish、clear，不创建上下文，也不增加 swap。原调用的 this、参数、返回值和异常继续透传。

**查询/readPixels 可能同步提交并改变时序，因此这不是无扰动探针或修复。** 保留默认缓冲可能在 swap 后失效的语义：swap 后黑像素不能独立证明黑屏；一个点有颜色也不证明整屏或实际显示成功。哨兵未改变时不能把 readPixels 的返回当作读取成功；GLctx 查询值也不是原生 GLX 内部对象与 GPU 完成的独立证明。只对本最小合成场景使用，比较同包正常/黑屏两次，结合用户画面反馈和云端包身份判读。

### 绑定类型与独立画布导出

`wxslim-presentation-probe-v2` 不再将全部未知情况折叠成 unobserved：`bindingShapes` 分别记录 JS typeof、undefined/负整数/小数/非有限数/布尔值/BigInt 等类别、是否 -1/空字符串/数组，以及宿主公开的对应 GL 常量是否与标准值匹配。未知值不自动解释为默认绑定，具体句柄值不上传。

同一工具现在嵌入 `canvas-export-probe.js`。两次原 swap 返回后，仅在 Module/root/context 三者 canvas 对象完全相同时，调用该 canvas 的 `toTempFilePath`，源区域为该合成游戏画布，目的尺寸严格指定 1×1 PNG。API 及参数来源为[微信官方小游戏类型定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts)。每次最多等待 3.5 秒；读取前限制临时文件为 4 KiB 内，核对 PNG 签名和真实 1×1 IHDR，只上传 IHDR/IDAT/PLTE/tRNS/IEND，排除文本等附带元数据，净载荷最多 1 KiB。生成文件由本次 API 返回，处理后尝试 unlink，报告清理是否确认；不清理其他文件。

独立 `[WXSLIM_CANVAS_EXPORT]` 日志包含导出结果、耗时、清理状态和受限 PNG hex。`decode-canvas.mjs` 在电脑本地解码颜色（限制解压输出），不部署服务或上传整屏截图。API 不存在、失败、超时、尺寸超限等均明确报告；没有补建 canvas、改变 framebuffer 绑定、开启 preserveDrawingBuffer 或强制绘制。此结果观察的是宿主画布导出内容，仍不能证明手机合成器最终显示，更不能从成功导出推导 GLX 长期稳定。

同包循环建议固定一次首次进入及三次退出重进，每次前台保留约 20 秒，记录实际画面与对应 cloud session。若同一 JS 会话继续存活且有界探针已经停止，缺日志不能补算成新一轮验收；必须明确该轮没有新采样。
