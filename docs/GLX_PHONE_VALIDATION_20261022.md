# 最小示例手机对照记录（2026-10-22）

本记录接续 [电脑 WebGL 实测](GLX_DEVTOOLS_WEBGL_20261022.md)。用户已批准最小示例手机 WebGL / GLX 对照预览，并确认当前登录微信的手机空闲、可由本会话测试。2026-10-23 又明确批准独立诊断包接入现有云日志、推送手机预览并直接查询云端定位黑屏，结果见后文。本会话没有发布体验版，没有修改赛车、服务器或证书，也没有合并默认分支。早期插件自身的自动遥测与后来经批准的诊断上报分开记录。

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

截至首轮原始 GLX 日志，用户的“画面正常”对应 WebGL 截图，不能直接移用于 GLX。该阶段 GLX 只有日志和游戏内摘要读取证据；后续云诊断包的 GLX 可见画面确认见 2026-10-23 云日志基线，不能追溯代替原包观察。

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

以上原始最小包及第一版帧诊断包没有主动接入本会话云日志；完整生成包仍包含宿主分包、插件以及通用计时脚本的本地存储行为，不能概括成整个包完全不联网、不写存储。

## 2026-10-23：现有云日志接通，GLX 正常画面基线

用户明确批准“把诊断包接入现有云日志并推送手机预览，之后直接查云日志定位黑屏”。本轮复用现有 `phoneLogIngest` 和 `phone_log_batches`，没有部署、更改云函数或服务器。环境及 AppID 留在忽略目录的私有配置；云端读取按独立 build 限定，不查询其他游戏记录。

- 新包 `wxslim-70de8206532cc7387415`，build `glx-cloud-probe-20261023-01`，请求 GLX。引擎 JS、WASM、PCK、通用适配器与上一帧诊断包逐项核对一致；新增显式云接口。默认 WebGL 转换流程没有变化。
- `auto_preview` 返回 success，8,393,482 字节；用户随后确认该预览“已打开，画面正常”。这是本次 GLX 包的可见画面证据，不是从初始化状态推断的结果。
- 直接云端读取取得 5 个批次、12 条记录、1 个会话、dropped=0，含全部 3 条帧诊断；三个 JSON 均完整解析，没有因消息长度而截断。原始响应位于 `.local/glx-cloud-probe-20261023-01/cloud-after-preview-01.json`，不提交。
- 本地全套测试含 Godot headless：54 通过、0 失败；新云接口测试覆盖白名单过滤、保留原 console/手动接口、发送及停止。生成包 verify：37 通过、1 注意、0 失败；注意仍为未运行官方 split init。

| 探针相对时间 | 主循环进入/返回 | afterFrame/flush 进入/返回 | batchAsync 进入/返回 | swap 进入/返回 |
| --- | --- | --- | --- | --- |
| 3003 ms | 144 / 144 | 144 / 144 | 144 / 144 | 144 / 144 |
| 8002 ms | 444 / 444 | 444 / 444 | 444 / 444 | 444 / 444 |
| 15003 ms | 864 / 864 | 864 / 864 | 864 / 864 | 864 / 864 |

三个采样中各调用的抛错计数均为 0，主循环和 afterFrame 各注册一次；`ABORT=false`、`runtimeExited=false`，调度方法为 rAF。实际上下文为 GLX/WebGL2，初始化完成、失败原因为 null、Module 上下文匹配。主画布与 drawingBuffer 均为 1206 × 2622，Module/配置/root/context canvas 身份一致。GLX init 与 buffer init 各返回一次、updateContextId 返回两次；factory/main 各一次，资源校验及挂载完成。

采样内 hide/show/contextLost/contextRestored 均为 0。`isContextLost` 仅检查方法存在，未调用 GPU 查询。调用返回只证明宿主边界上的推进，约每秒 60 次的增量也不能单独证明 GPU 完成或像素可见；本次画面正常另有用户确认。尚不能将本次正常运行的数据用于排除**此前黑屏运行**中的循环停止、提交停止或呈现问题。

结论：**GLX 已在该手机上的当前最小诊断包实际出画面，云日志链路也已验证；重新进入的间歇黑屏仍未定位或修复。** 正常启动基线保留，下一步对应退出重进时的画面与会话证据。当前探针只采集启动后约 15 秒，云转发约 60 秒后停止；若返回同一个已停止采样的 JS 会话，缺新记录不能判定为启动失败，需要另行覆盖恢复窗口。用户无需再手动导出这版已成功上报的日志。

## 同包退出重进黑屏：已取得第二会话的云端帧证据

用户依照退出重进、保持前台约 20 秒的步骤反馈“重新进入后黑屏”。随后直接云查询取得 10 批次、24 条记录、2 个会话、dropped=0：相较正常基线，新增完整的一组启动及三条帧诊断。原始响应为 `.local/glx-cloud-probe-20261023-01/cloud-after-reentry-black-01.json`，本地保留。

黑屏会话与正常会话包版本完全相同，均为 `wxslim-70de8206532cc7387415`。第二会话再次出现 factory/main 各一次和 MAIN_RETURNED，证明重新执行过启动链路；不能据此推断 iOS 原生宿主进程也已重建。

| 黑屏会话相对时间 | 主循环进入/返回 | afterFrame/flush 进入/返回 | batchAsync 进入/返回 | swap 进入/返回 |
| --- | --- | --- | --- | --- |
| 3002 ms | 141 / 141 | 141 / 141 | 141 / 141 | 141 / 141 |
| 8002 ms | 434 / 434 | 434 / 434 | 434 / 434 | 434 / 434 |
| 15003 ms | 848 / 848 | 848 / 848 | 848 / 848 | 848 / 848 |

抛错均为 0。实际 GLX、native 初始化返回、上下文身份匹配、1206 × 2622 画布/drawingBuffer、无 ABORT/退出及资源就绪均与正常基线一致；生命周期事件在这次采样窗口仍全为 0。这次有新的完整采样，未遇到“旧会话探针停止而无日志”的情况。

本次黑屏已缩小到**持续运行并调用宿主提交/交换之后的绘制内容、帧缓冲状态或最终呈现**；目前不能区分这些子层，也不能认定 GLX 驱动或服务器有故障。主循环未启动、宿主提交函数未调用、canvas 为零、已观察 JS 上下文不匹配均不符合本次 15 秒证据。没有额外调用 getError/isContextLost/readPixels，没有强制 flush 或重建上下文。

下一项对照是相同引擎/PCK 的显式 WebGL 云诊断包及退出重进，用于区分 GLX 路径与共用启动/场景路径。保留本次正常/黑屏证据，不将更换诊断包当作修复。

## WebGL 同输入回退对照：首次与重进画面正常

显式生成 `wxslim-093c7b4bce430bc53234`，build `webgl-cloud-control-20261023-01`。引擎 JS、WASM、PCK、适配器四项 SHA256 均与上述 GLX 云包相同；仅模式、包名与云 build 标签变化。verify 为 37 通过、1 注意、0 失败，`auto_preview` 成功，8,393,509 字节。用户明确反馈“首次正常，重进也正常”。

云端查询取得 16 批次、44 条记录、4 个会话、dropped=0；用户反馈只对应所报告的首次/重进，不为额外两个短会话补造操作或画面结论。首个和最后一个会话各有完整三条采样，两个中间会话分别取得两条与零条帧采样；缺少末条不能解释为黑屏或崩溃。

完整窗口的主循环返回计数分别为 153 → 453 → 872 和 148 → 448 → 866；已取得的所有帧采样均显示实际 WebGL2、初始化完成、MAIN_RETURNED、非零 1206 × 2622 画布及 drawingBuffer。GLX 专用 afterFrame/batch/swap 计数全为 0，符合此包显式 WebGL 模式，不能视为缺失渲染提交。最后采样的 entered 比 returned 多一次，是探针在原调用内部碰到期限后结束计数的边界；原调用仍继续，不能据此认定挂住。

原始云响应保存在 `.local/webgl-cloud-control-20261023-01/cloud-control-reentry-02.json`。当前真机对照是：**GLX 首次正常、同包退出重进黑屏；WebGL 首次与重进均正常。** 故障优先排查 GLX 的帧缓冲/呈现及加载页交接状态，而不是修改共同 PCK 或服务器。此前原始 GLX 正常/黑屏日志还都包含一次 `start success`、零次 `start fail`；这仅证明当时 loader promise 返回，不能证明加载画布已经正确退场。当前云白名单尚未采集 loader 退场或实际像素，尚无具体根因或修复结论。

后续如继续增加诊断，应针对这处未观测边界设计有界采样，并保留正常/黑屏同包对照。避免无证据地补发 flush、切换 framebuffer、重建上下文或自动回退；这些操作会改变故障现场，也不能代替验证。

## 2026-10-23：帧缓冲与呈现查询诊断包

用户继续批准补充帧缓冲/最终呈现诊断、手机预览和直接查询现有云日志，仍不修改赛车、服务器或合并 main。独立工具 `presentation-engine.mjs` 只创建新的引擎 JS 副本；默认转换器、WebGL 默认及已有包均保持不变。

- 包版本 `wxslim-aac0e1ceea119bdba53a`，build `glx-presentation-20261023-01`，请求 GLX。
- WASM、PCK、通用适配器哈希均与前一云端 GLX 对照包相同；新 JS SHA256 为 `dbbd15982264c62848af2bd13e345548fb1a47b85fe4b18aa6503e22d3bc4790`。
- presentation 探针 SHA256 为 `66a465c2d01a3933b74394df8211f7e513bc33aa03a1de434364681b812355d7`，测试源码与新 JS、最终 framework 内嵌字节一致。
- 全测试入口含 Godot headless：57 通过、0 失败；新增呈现探针 VM 合同 8 项，含原调用透传、取样前置条件、上下文丢失/查询异常、原 swap 异常、计时结束和未写入哨兵。它们不能代替手机帧缓冲证据。包 verify 为 37 通过、1 注意、0 失败；注意仍为未运行官方 split init。

保留旧 3/8/15 秒帧计数。在安装后约 4、9 秒等待原 swap，分别于原调用前后记录当前 GLctx 状态；最多两组查询，约 16 秒结束，云转发仍在约 60 秒后停止。查询当前读写帧缓冲/完整性、viewport、scissor、colorMask、pack、contextLost、drawingBuffer；只在默认 READ/BACK 和安全 pack 条件满足时读三个像素的汇总值，不切换绑定或补帧。loader.resolved 仅表示观察到既有 loader_start_ok 标记返回，不能证明原生覆盖层已经退场。

该版本的 GPU 查询/readPixels **可能同步提交、改变时序**。即使黑屏不再复现，也只记带查询诊断时未复现。swap 后默认缓冲可失效；三个点的黑或非黑都不认证整屏可见。方法返回但哨兵未变化不能判定成功读取；当前 GLctx 查询也不能独立证明 native GLX 内部状态一致。具体约束见 [示例 README](../examples/glx-smoke/README.md)。本地构建、测试、字节核对与后续云响应均留在忽略目录 `.local/glx-presentation-20261023-01/`。

### 第一版呈现诊断的手机结果及观察限制

`auto_preview` 成功，8,397,901 字节。用户确认“首次正常，重进也正常”，并补充重进后“一开始就正常”，没有等待约 4 秒查询才恢复的观察。最终云查询得到 21 批次、42 条记录、3 个会话、dropped=0，每个会话都有三条帧诊断与两条呈现诊断；不将额外一次会话补记为人工验收。原始响应为 `.local/glx-presentation-20261023-01/cloud-presentation-02.json`。

已取得的全部 swap 前后查询显示 contextLost=false、draw/read framebufferStatus=36053（FRAMEBUFFER_COMPLETE），viewport=[0,0,1206,2622]、colorMask=[1,1,1,1]；提交字节与声明绘制数持续增加。绑定被该版分类为 unobserved，READ_BUFFER=36064（COLOR_ATTACHMENT0），像素门禁跳过；**没有读取到像素**。这些都是本版未复现黑屏时的状态，不能套用于之前失败会话。

还发现并纠正了两个诊断适配不足：

1. 该版把普通 WebGL 的对象/null 形式作为绑定识别范围，不能覆盖 native 返回形式。后续只记录绑定类型和数字零/非零分类，不上传句柄，不推断这些句柄是否等于主屏目标。
2. 引擎内 timing.mark 包装安装过晚。此前原始日志中 `start success` 位于 FACTORY_START 之前（正常日志第 30/37 行，黑屏日志第 45/51 行），因此本版 loader.resolved=false 是未观察到早期标记，**不是 loader 失败证据**。后续将观察安装前移到 local-interfaces，先于 loader.start()。

第一版已生成的源码/包与云证据全部保留，未覆盖后重用原版本号。当前数据不支持“查询已修复黑屏”，也没有证据证明加查询前后是同一失败现场。

### 第二版：早期加载标记与当前读取目标

新包 `wxslim-1d8c5547f9f627a0c7ce`，build `glx-presentation-20261023-02`。显式云配置 `presentation=true` 才安装前置加载标记观察器；观察到原标记返回便立即恢复原函数，60 秒未出现也恢复。引擎探针只读前置状态。两组 GPU 查询时机不变，约 16 秒停止；当前 READ framebuffer 完整、颜色缓冲和 pack 状态合适时，读取原点一个像素的汇总，不改绑定，也不把这个目标命名为显示缓冲。

WASM/PCK/适配器仍与原云端 GLX 包一致。引擎 JS SHA256 `a3db1efa65130b135444058d7ab0126721832eb39e5a66647eaf4e6347612a2c`，呈现探针 SHA256 `2fcbb1ea1ad9ac30268f62b0f1629e32c1f605d0de4bcc840d7651086ab25d0b`，前置标记源码 SHA256 `68bf9636182396c7964b2e557a4b5e511377e8cf555a031f4c12f66e25183505`，已核对最终包包含测试源码。全套测试含 Godot headless 为 58 通过、0 失败；包 verify 为 37 通过、1 注意、0 失败。新增加了 native 数字绑定隐私、标记先于引擎发生及云不可用仍保留标记的测试。

第二版 `auto_preview` 成功，8,398,638 字节。用户确认“首次正常，重进也正常”。云端查询取得 15 批次、28 条记录、2 个会话、dropped=0，两会话均有完整三条帧诊断和两条呈现诊断。原始响应为 `.local/glx-presentation-20261023-02/cloud-presentation-reentry-02.json`。

两会话的 loader 均为 markHook=true、resolved=true、outcome=mark_returned；修正前置观察后不再误读为未完成。所有呈现查询均显示 contextLost=false、framebufferStatus.draw/read=36053、viewport 1206×2622、colorMask=[1,1,1,1]、scissorEnabled=false。提交字节/声明绘制数持续增长，约 15 秒主循环返回计数分别为 805、822。第二会话的末次 entered 多一次为截止采样边界，不是原调用卡住证据。

draw/read/pack 绑定仍为 unobserved：即使增加数字零/非零分类，当前返回也未被识别，**没有证据确认具体返回类型，更不能猜测它等于默认缓冲**。READ_BUFFER 仍为 COLOR_ATTACHMENT0；像素以 read_binding_unobserved 原因跳过，第二版同样没有成功的像素读取证据。这里的 contextLost=false 来自新呈现探针的实际查询；保留的旧帧探针 isContextLostQueried=false 只描述旧探针自身，不能概括整个诊断包没有查询。

两版增强诊断均未采到黑屏现场，不能用这些正常状态排除此前失败包中的帧缓冲或最终显示异常，也不能宣称查询已修复。继续回放原 `wxslim-70de8206532cc7387415` 云帧诊断包（无 GPU 查询），保持原生成字节和 build，新增会话与回放前已有两会话分开核对，以判别原故障是否仍可复现。

### 原失败包原样回放：本轮也未复现

再次推送原 `.local/glx-cloud-probe-20261023-01/glx/minigame`，没有重新转换或修改文件，`auto_preview` 成功且大小仍为 8,393,482 字节。用户报告“首次正常，重进也正常”。回放前的云快照为 10 批次/24 条/2 会话；回放后为 21 批次/47 条/4 会话、dropped=0。按新增 session 分离取得两份原版本 `wxslim-70de8206532cc7387415` 的运行证据，未与旧黑屏会话混用。

新增两会话的主循环、batch、swap 返回计数分别为 97→397（本次未收到第三采样）和 105→405→825，实际 GLX/WebGL2，画布为 1206×2622。缺少第一会话末条的原因未确定，不否定用户的画面正常反馈，也不标为崩溃。原始快照分别为 `.local/glx-cloud-probe-20261023-01/cloud-before-original-replay-20261023.json` 与 `cloud-after-original-replay-20261023.json`；回放预览回执在第二版呈现诊断的本地证据目录。

**当前结论：同一原包曾经重进黑屏，也能在本轮重进正常；故障呈间歇性，本轮暂不可复现，根因仍未定位。** 新增 GPU 查询不是本轮正常显示的必要条件，不能据此宣布查询修复或确定竞态。增强诊断记录的帧缓冲完整、contextLost=false 和 loader 标记成功都仅适用于本轮正常样本；当前绑定返回无法识别、像素读取跳过，最终显示层仍没有自动验收证据。

本轮未部署、未变更服务器/赛车、未合 main；默认 WebGL 不变。手机最后收到的是原云帧诊断包。后续若再次出现黑屏，优先保留当次包身份和云 session，在可复现条件下使用增强诊断；不继续无差别清缓存、强制恢复或增加刷新调用。

## 2026-10-23：绑定返回类型与宿主画布导出诊断

用户批准继续查询绑定无法识别的原因，补充呈现诊断并进行同包多次退出重进。新包为 `wxslim-481c2487b5b1ab28eb29`，build `glx-binding-20261023-01`，`auto_preview` 成功，8,402,190 字节。WASM、PCK、通用适配器仍与原云端 GLX 包逐项相同；引擎 JS SHA256 为 `cd264335edd485835a66fd010ea8fc1a57c1f9986cac4551a2ced4fcfde6c235`。帧计数、呈现和画布导出三份探针源码已核对与生成引擎及最终 framework 内嵌字节一致。

旧版绑定分类将 undefined、负数、布尔值等都折叠为 unobserved，无法仅从旧日志确认具体原因。v2 直接观察当前 GLctx.getParameter 的返回，记录 typeof、精确类别、是否 -1/空字符串/数组，以及宿主常量与标准枚举是否匹配；不记录句柄，不将 undefined 解释成默认 framebuffer。当前引擎副本没有新增 getParameter 替换。

保留约 4/9 秒原 swap 前后查询，并在原 swap 返回后尝试独立导出当前游戏 canvas：要求 Module/root/context 三者为同一对象，目标尺寸为 1×1 PNG，最多两次、每次超时 3.5 秒。临时文件限制 4 KiB、核对真实 1×1、剔除附带元数据、净载荷限制 1 KiB，并尝试删除本次返回的临时文件。云端只转发专用日志，电脑本地有界解码。此证据对应宿主画布导出，不等于手机最终合成器显示；导出可能同步 GPU，不能视为无扰动观察或修复。

全套测试含 Godot headless 为 61 通过、0 失败；包 verify 为 37 通过、1 注意、0 失败，注意仍为未运行官方 split init。新增测试覆盖精确绑定分类、导出身份与尺寸门禁、元数据过滤、有界解码、超时/迟到回调/清理及新增日志白名单。白名单断言补强后单独重跑 3 项通过。默认转换器及 WebGL 行为未修改。

证据保存在忽略目录 `.local/glx-binding-20261023-01/`。本轮协议为固定这一个包，首次前台约 20 秒，然后按原退出方式连续三次退出重进、各保持约 20 秒，用户报告实际画面，云日志按唯一 build 读取。手机反馈与云采样尚待配对，推送成功不计作运行通过。

首次查询至 `cloud-round-04.json` 仅返回 2 批次、2 条、1 个 iOS 手机会话、dropped=0，内容为 PHONE_LOG_START 和 FACTORY_START；尚无初始化/帧/呈现/画布导出样本。这只证明本包的日志接入及工厂入口已触达，不证明工厂完成，也不能仅凭缺少记录断言黑屏或 GLX 失败。当前尚未收到本轮人工画面反馈，三次重进验收未完成，绑定具体类型及画布导出结果仍待真机样本。

### 同包多次重进反馈：首次正常，随后三次黑屏

用户随后报告“首次正常剩下的都是黑屏”，对应本轮要求的首次及三次重进。直接查询 `cloud-four-runs-01.json`、`cloud-four-runs-02.json` 均得到 30 批次、69 条、5 个会话、dropped=0，所有初始化摘要均为当前包 `wxslim-481c2487b5b1ab28eb29`。日志中比四轮人工反馈多一个会话，不能把五个会话全部按四轮反馈强行标注。已询问首次正常是北京时间约 06:54 还是 07:02；未确认前，不指定哪份像素样本属于正常画面。

| 按启动时间排序的云会话 | 北京时间 | 帧/呈现/导出条数 | 主循环返回计数 | 采样边界 |
| --- | --- | --- | --- | --- |
| 1 | 06:54 | 0 / 0 / 0 | 未采到 | 后续补达初始化摘要及 MAIN_RETURNED；无像素 |
| 2 | 07:02 | 3 / 2 / 1 | 88 → 261 → 261 | 约 8.8 秒已观察 hide，末次回调延迟至约 41.7 秒；第二呈现槽无 swap |
| 3 | 07:03:06 | 2 / 2 / 2 | 97 → 372 | 有约 4/9 秒呈现，未收到第三帧样本 |
| 4 | 07:03:22 | 2 / 2 / 2 | 98 → 384 | 有约 4/9 秒呈现，未收到第三帧样本 |
| 5 | 07:03:39 | 2 / 2 / 2 | 98 → 389 | 有约 4/9 秒呈现，未收到第三帧样本 |

**绑定分类问题已定位到实际返回值：** 全部 7 组有效呈现采样的 swap 前后，draw/read framebuffer 与 pixel-pack buffer 的 JS 返回均为 `undefined`，对应公开枚举全部匹配标准值。旧分类将此返回统一记为 unobserved；并非已经返回了合法数字句柄却被数字分类遗漏，也不是本次枚举常量不匹配。这里证明的是当前 GLX 上下文的这条 JS 查询路径未提供绑定值，尚不能说明宿主内部为什么未提供，或将 undefined 解释为默认 framebuffer/黑屏原因。readPixels 正确继续以 `read_binding_undefined_unobservable` 跳过。

其余 7 组有效查询均为 contextLost=false、draw/read COMPLETE（36053）、1206×2622 viewport/drawingBuffer、colorMask=[1,1,1,1]、scissorEnabled=false、READ_BUFFER=COLOR_ATTACHMENT0、packLayout=[4,0,0,0]。loader 标记均成功；已采到帧中的初始化完成、实际 GLX、Module/当前 GLctx/canvas 身份匹配，主循环、afterFrame、batch、swap 计数一致且无抛错。这些宿主查询及调用返回仍不证明 GPU 内容或加载覆盖层已经正确呈现。第二会话计数停止伴随 hide，不能将其当作前台渲染卡死；后三会话缺少末样本不能补写为已完整观察 20 秒。

**画布导出取得 7 份有效 1×1 PNG，全部本地解码为 RGB=[0,0,0]、alpha=0。** 耗时 135–183 ms；清理状态全部为 not_confirmed，不能声称临时文件删除成功，也未扩大清理范围。导出观察发生在原 swap 返回后，preserveDrawingBuffer=false；当前缺少与正常画面明确配对的非透明导出基线，因此这些透明结果不能独立确认实际屏幕内容，更不能证明清空缓冲就是根因。

结论更新：本包再次复现连续重进黑屏，不能将上一轮原包回放正常视为修复。绑定“无法识别”的诊断歧义已解决，最终显示黑屏的具体原因仍未查明；当前优先排查 GLX 原生绘制/提交到显示画布的交接边界。继续诊断需先确认正常轮映射，并验证画布导出对正常 GLX 画面是否有效；不将 JS 查询缺失或透明 PNG 当成自动修复触发条件。此轮只读取现有云日志并更新证据，未再次推包、改默认 WebGL、赛车、服务器或合 main。
