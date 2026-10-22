# 最小示例手机对照记录（2026-10-22）

本记录接续 [电脑 WebGL 实测](GLX_DEVTOOLS_WEBGL_20261022.md)。用户已批准最小示例手机 WebGL / GLX 对照预览，并确认当前登录微信的手机空闲、可由本会话测试。范围仅为这两个最小包；本会话没有执行发布体验版或云报告操作，没有修改赛车、服务器或证书，也没有合并默认分支。插件自身的自动遥测日志另见下文，不等同于本会话主动上传报告。

## 包与环境

- 分支 `codex/glx-adaptation-20261022`，运行时代码提交 `69379e167678ae59f0714f88513e5b2d9b4932e4`；此次没有修改运行时代码或重新转换包。
- WebGL 包 `wxslim-3707af110530996169cf`；GLX 包 `wxslim-d63ad01a8a38444f8a44`。同一引擎与 PCK，Godot 4.7.2、transformer 1.0.35、WXGameKit 1.3.15。
- 后续 GLX 手机日志报告：iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、实际基础库 3.17.5。WebGL 截图未包含这些环境字段；两次测试按用户指定使用同一手机。项目的 `libVersion=latest` 不代表固定基础库版本，不能沿用电脑模拟器的 3.17.4。
- 两包 `verify` 各 36 通过、2 注意、0 失败；注意为包外符号文件未复制、未运行官方 split init。没有为此次完整包预览运行 init。
- `auto_preview` 均返回 success：WebGL 总大小 8,382,368 字节，GLX 总大小 8,382,361 字节。推送成功不等于手机已运行相应包。

## WebGL 手机首轮证据

用户提供的手机 vConsole 截图含 `[GLX_SMOKE_MANUAL_DIAGNOSTIC]`，包身份与预期一致；用户同时报告“反正看起来画面正常”。截图展示的是摘要，画面正常属于用户观察，不能扩展成所有图形子项都已经验证。

以下字段从截图人工转录，不是自动采集的原始 JSON：

```json
{
  "schema": "wxslim-render-diagnostic-v1",
  "packageVersion": "wxslim-3707af110530996169cf",
  "versions": { "godot": "4.7.2", "transformer": "1.0.35", "wxGameKit": "1.3.15" },
  "requestedMode": "webgl",
  "capability": { "present": true, "value": true },
  "actualContext": { "mode": "webgl", "webgl2": true },
  "observationStatus": "available",
  "native": {},
  "initialization": "initialized",
  "failureReason": null,
  "visibleRendering": "not_verified",
  "lifecycle": { "hide": 0, "show": 2, "resize": 0, "recovery": "not_verified" },
  "nativeBindings": true,
  "offscreenResizeFunction": false,
  "moduleContextMatches": null
}
```

结论：默认 WebGL 在该手机上完成已观察的初始化，实际使用 WebGL2，游戏内手动读取摘要成功，用户确认所见画面正常。能力位为 true 表明该手机宿主声明支持 GLX，但本包仍实际使用 WebGL；这同时验证了默认模式不会因为能力位存在而自行切到 GLX。

`visibleRendering=not_verified` 是运行时不自行认证像素的设计，不否定用户的人工观察。`show=2`、`hide=0` 不构成前后台恢复通过证据。`offscreenResizeFunction=false` 也不是离屏视口测试失败的结论。

## GLX 手机初始化和手动摘要已通过

用户随后提供完整 vConsole 导出日志，共 129 行。第 72 行的一次性 `[WXSLIM_RENDER_SUMMARY]` 与第 82–127 行的 `[GLX_SMOKE_MANUAL_DIAGNOSTIC]` 均已解析为 JSON，逐字段完全相同；两种摘要各出现一次。`FACTORY_START`、`CALL_MAIN`、`MAIN_RETURNED` 也各出现一次。

| 观察项 | 日志实际结果 |
| --- | --- |
| 包身份 | `wxslim-d63ad01a8a38444f8a44`，与待测 GLX 包一致 |
| 请求与能力 | `requestedMode=glx`；`capability.present=true`、`value=true` |
| 引擎实际上下文 | `actualContext.mode=glx`、`webgl2=true`；`observationStatus=available` |
| 原生调用 | `glxInit` 1 次、`glxInitBufferDataAndGlState` 1 次、`glxUpdateContextId` 2 次，均为 `returned` |
| 缓冲与匹配 | `bufferInitialization=returned`、`moduleContextMatches=true`、`nativeBindings=true` |
| 初始化 | `initialized`，`failureReason=null` |
| 生命周期 | `hide=0`、`show=1`、`resize=0`，`recovery=not_verified` |
| 像素与 helper | `visibleRendering=not_verified`；`offscreenResizeFunction=false`，不构成初始化失败 |

因此，**该手机上的此最小包已完成实际 GLX 初始化，并成功从游戏内手动读取摘要**。这次既没有能力门禁阻断，也没有观察到 `WXSLIM_GLX_BUFFER_UNOBSERVED`；实际模式为 GLX，不是静默回退到 WebGL 后宣称成功。引擎自身另有 EmscriptenGLX / BufferData 初始化日志及首次绘制回调，作为辅助证据；结论以实际上下文和 native 调用观察为准。

日志中两条 `[error]`（第 15、80 行）分别是插件对高性能模式未使用代码分包、未调用 `WX.ReportGameStart` 的开发提示。它们不能归因为 GLX 初始化失败，也不是启动被阻断的证据。没有因此启用分包 init 或自定义上报。整份日志未出现可识别的 RuntimeError、Aborted、context lost 或 OOM；这只描述本份有限日志，不能证明长期稳定。

日志含插件 `keyValueReport` 记录，包括命名为 `WXGameWASMLaunchException` 的缓存统计记录；不能只看事件名称认定实际发生了异常。它们表明插件存在遥测路径，日志本身不证明远端接收成功。

## 仍待手机观察

此前用户的“画面正常”对应 WebGL 截图，不能直接移用于 GLX。当前 GLX 只有日志和游戏内摘要读取证据，尚未收到其可见画面确认。

以下子项目前仍待手机分别确认，两种模式均不可由一句“画面正常”代替：主视口与离屏 2D 持续更新、3D 旋转、两种离屏尺寸反复切换、实际主画布 resize、后台约 5 秒后的恢复、退出重进与冷启动。详细顺序见 [示例 README](../examples/glx-smoke/README.md)，最后需重新打开 WebGL 基线验证显式回退。

## 2026-10-23：用户报告重新进入后黑屏，尚未定位

用户后续报告“现在又不行了，重新进入小游戏黑屏”，并确认退出小游戏再进、微信切后台再返回，以及清理缓存重新打开都已尝试，黑屏时仍可打开 vConsole。清缓存的具体入口、实际是否创建了新进程/JS 会话以及黑屏本次包身份尚未核对，不能把这些操作直接标为已验证的冷启动。

这是当前 GLX 测试流程中的真实用户故障反馈，**重新进入和稳定性验收不通过**。前面的首轮 GLX 初始化日志仍然有效，但不能覆盖这次故障，也不能据此宣布 GLX 已稳定可用。刚收到回报时尚无失败日志；随后取得的日志见下节。不能外推为赛车已复现同一故障。

下一份证据应保留黑屏当前会话的完整 vConsole 导出，核对本次 `packageVersion`、启动阶段、首次错误和渲染摘要。若没有新启动摘要，区分仍在旧会话、启动尚未到达摘要、以及其他加载失败；不能把缺日志视作能力门禁阻断。`initialized` 表示曾观察到初始化完成，不监测持续像素或帧循环，因此即便黑屏时仍读到该状态，也不能否认黑屏现象。

收到故障回报后、取得失败日志前，本会话没有重新推包、清缓存、重启微信或修改运行时代码，原包与证据均保留。

## 2026-10-23：黑屏本次日志已取得，初始化后呈现待定位

用户提供第二份 vConsole 日志，共 93 行。环境仍报告 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、基础库 3.17.5，包版本仍为 `wxslim-d63ad01a8a38444f8a44`。

| 对照项 | 黑屏本次实际证据 |
| --- | --- |
| 新启动链路 | 第 51 / 62 / 79 行依次为 FACTORY_START / CALL_MAIN / MAIN_RETURNED，各一次 |
| 首次绘制回调 | 第 70 行再次到达 Godot frame_post_draw，不证明像素可见 |
| 启动摘要 | 第 78 行 JSON 与前次成功日志的启动/手动摘要逐字段相同：实际 GLX、三个 native 返回、缓冲初始化及上下文匹配均通过 |
| 重复启动保护 | 无 FAILED、RESTART_REQUIRED、DISTINCT_MODULE 或 DUPLICATE_MAIN 记录；不能据插件两次 framework 提示认定 main 重复执行 |
| 手动摘要 | 本次没有；不能把启动时的状态当作黑屏后重新读取的状态 |
| 首个已知差异 | 本次缓存目录重建、0 文件、资源无缓存并下载解压，前次使用已有缓存。包最终仍完成校验和挂载；时序不同不证明缓存损坏 |
| 后续前台提示 | 日志末部存在宿主进入前台提示，但没有同步的上下文、native 循环或提交计数 |

这份日志将本次定位重点缩小到**初始化完成后的持续绘制、GLX 提交或最终呈现**。它不支持“本次停在能力门禁、资源挂载前或被重复 main 保护阻止”的解释；也不能用本次一次冷加载记录解释此前每一种重进方式。两条 error 仍为代码分包与启动统计开发提示，没有据此自动启用分包或云报告。

现有一次性摘要只记录初始化，不观察持续出帧。下一步仅在独立诊断引擎副本中增加有界计数：实际 native 主循环、原有 afterDoFrame/flush、batchRenderAsync/swapWindow、当前画布尺寸和上下文状态。探针只观察原调用，不补发 flush、重建上下文、强制恢复或宣称已经修好；默认转换器和已有 WebGL / GLX 包保持原字节。

## 独立帧诊断包已推送，待手机结果

显式工具为 `examples/glx-smoke/diagnostic-engine.mjs`，探针为同目录 `frame-probe.js`。五个源码锚点必须唯一命中，原输入与已有输出均不覆盖。正常 convert 再对新 JS 执行原来的观察注入和配置生成，不手工修改旧生成包。

- 最终候选：`wxslim-775ffde7946b8a44c694`，请求 `glx`；本地工程为 `.local/glx-frame-probe-20261023-02/glx/minigame`。
- WASM / PCK / 通用适配器哈希与旧 GLX 包一致；新引擎 JS SHA256 为 `f93801b1dd1d267b6e0c0ae8b6ccc0676632715dd4903310090a95113d65c5f6`。
- 探针源码 SHA256 为 `3468e68691d92fc090178d52f299e837a2b2059d78b9de29b2ddb7a2b1e6b1ba`，已逐字节核对该版本同时嵌入输入副本及最终 framework。
- 主测试入口含 Godot headless：52 通过、0 失败；其中新探针 VM 合同 10 项，覆盖原调用恰好一次、this/参数/返回值/原异常透传、三条日志上限、监听清理、后台延迟计时器的停止边界和隐私字段白名单。它们不是手机 GLX 渲染测试。
- 真实源码锚点和生成 JS 语法检查通过；新包 verify 为 37 通过、1 注意、0 失败。注意仍为没有执行官方 split init，此次无需执行。
- `auto_preview` 返回 success，总大小 8,390,047 字节。仅证明诊断预览已推送，尚无这个版本的手机运行结论；未打开/替换其他会话窗口。

自动观察窗口以探针安装为起点，计划在约 3 / 8 / 15 秒记录最多三条 `[WXSLIM_FRAME_PROBE]`。计时器若被宿主暂停，实际延迟由 `relativeMillis` 和结束原因表示；过期后的下一个原调用会先结束计数，不补发任何帧。结束时移除自有前后台和 canvas 事件监听，已有主循环及原生提交继续原样执行。只记录 context-lost/restored 事件和 `isContextLost` 是否存在，不调用该 GPU 查询。手动 read 仍可用，但不能把停止后的冻结计数当成恢复后的进度。

手机本轮步骤：打开最新诊断预览，保持前台约 20 秒，记录是否仍黑屏，再从 vConsole 导出全部日志，无需点击游戏内按钮。这个包用于缩小故障范围，**不是修复包，也不用于性能对比**。之前试制的 `glx-frame-probe-20261023-01` 使用较早探针，仅本地保留，未推送手机。

## 私人证据

原图及预览回执保存在忽略目录 `.local/glx-ide-20261022-2222/evidence/`，不进入 Git：

- `phone-webgl-user-01.jpg`：用户提供的摘要原图；SHA256 `b1c217548d488c7e8c35657d64f3d3ed8460e587ae66662b6b5996f812e0828c`。
- `phone-webgl-preview-result.txt`、`phone-glx-preview-result.txt`：两个预览命令的成功回执，仅证明工具推送结果。
- `phone-glx-user-01.log`：用户提供的完整 GLX vConsole 日志；SHA256 `4aa88d22c6640de053d87033e9ab525064bbb6c31daf785edfbe059b91bc2a8b`。原始宿主信息及插件遥测不复制到公开文档。
- `phone-glx-user-01-diagnostic.json`：从日志解析的诊断、有限环境字段和计数，保存启动摘要与手动摘要相同的核对结果。
- `phone-glx-black-01.log`：黑屏本次日志，SHA256 `6fa078f91b3b79e7f3d67434cde91b378219fc49061d5d51b373e33be1677613`。
- `phone-glx-black-01-diagnostic.json`：解析后的启动摘要及与前次摘要相同的核对结果，保留本次 main / factory / 首次绘制 / 手动摘要计数。
- 新诊断包构建、测试、字节核对及预览回执位于 `.local/glx-frame-probe-20261023-02/`；其中 `tests.txt`、`verify.txt`、`input-audit.json`、`preview-result.txt` 均为本地证据，不进入 Git。

最小示例和新诊断摘要不上传报告；完整生成包仍包含宿主分包、插件以及通用计时脚本的本地存储行为，不能概括成整个包完全不联网、不写存储。
