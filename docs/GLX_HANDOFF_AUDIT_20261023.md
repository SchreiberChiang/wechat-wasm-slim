# GLX 上下文交接与资源编号核对

后续电脑侧核对见 [shader 对象与共享 ID](GLX_SHADER_ID_COMPAT_20261023.md)：已补齐 Program/Shader 的创建到查询关联及作者共用回退计数器证据；实际冲突仍未证实。`author-pair-cn-857167c70711a319d489` 仅完成静态准备，用户已拒绝该预编译替换路线，预览申请撤回，不运行或推送。继续可自构建、裁剪和分包的目标，不覆盖下述失败结果。

2026-10-23。准备阶段只做电脑侧静态核查、隔离候选和本地回归；之后用户另行批准一包两轮手机验证，结果见文末。当前失败现场保持。原仓库和独立自构建 worktree 均从 `8b59fe9` 接续，保留已有改动；未提交、Git 推送或合并默认分支，未改赛车、服务器或证书。

最新结论：**找到作者引擎与自构建引擎的原生资源 ID 分配差异；尚未确认它就是手机黑屏根因。** “GLX 上下文由引擎首次创建”候选随后获批并完成一次首开、一次结束微信重开：首开正常，重开黑屏。同会话 vConsole 已确认 CopyShader 顶点编译与绑定失败，详见文末实测；只去掉加载页 GPU 阶段不足以解决问题。测试已停止，默认转换器 WebGL 行为不变。

## 已有真机事实

当前中文包 `selfbuild-glx-cn-a3b9d20dccdd2fbf132d` 的首开 `b0f41707` 有用户正常反馈、USB 可见截图、实际 GLX 和手动诊断。上滑结束微信后同包重开，用户与 USB 截图均确认黑屏，微信进程确已重建。唯一新增云会话 `6548efda` 与操作时间相容，仍读取到场景与 GLX；黑屏没有短码，不能声称它已由画面短码精确核验。完整边界见 [自构建记录](GLX_SELFBUILD_20261023.md)。

本轮不把 `sceneRead`、FPS 覆盖层、JS 描述符匹配或 swap 路径存在当作最终呈现成功。原 loader 终态补丁仍存在且新会话已运行场景，所以“补齐 cleanup 后晚回调保护便能解决黑屏”的判断已被这次失败否定。

## 实际比较对象

作者输入为实际发布的 `minigame4.7.0.8.1.tpz`，重新核验 SHA256 `c4673dd16b397be7c6bcd0c9bd038d20008be5b4586cdaea60be552326a50be7`，不是从仓库零散拼装的库。作者在[发布说明](https://github.com/hao0917/godot-minigame/releases/tag/4.7)中声称重新链接配套库修复黑屏；该声明与本机静态证据、用户真机反馈分别记录。

| 产物 | 作者发布包 SHA256 | 当前完整自构建 SHA256 |
| --- | --- | --- |
| 配套 JS | `12361da76c9702ed3d72ad8a4ea6ba4e9d930ee9de706d47039c6b38f8850644` | `b5710406a1fb9005692658a9d7a826085588213e7d50552b587fffa0ca579738` |
| 解压 WASM | `1929f30fd3d59497a5e49a0e2ef8a971cbeb9ec821d29c71720df4d9eaba3cfd` | `67f58828b85a79769f9b74303d9153c757a707990b75cb39df8393bb61482718` |

自构建仍为 Godot `df3cdd9`、Emscripten 4.0.10、官方静态库 SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`。准确输入与完整构建方法见 [engine/README.md](../engine/README.md)。本轮没有重编：候选只改加载页，配套 JS/WASM 都原样保留。

静态证据在原仓库忽略目录 `.local/glx-handoff-audit-20261023-01/`。`js-audit/` 保存 Acorn 抽取脚本、原始片段、哈希和比较；`native-audit/` 保存 WASM section parser、函数索引/范围、LLVM 定点反汇编、旧库对象片段及文件哈希。原件未改，没有实例化目标 WASM 或运行目标引擎 JS。

## 真正不同的是资源 ID 分配能力

前一轮仅按名称筛选 275 个 JS 表达式，遗漏了以下桥接函数，不能将它的“选中表达式相同”扩大为整个 GLX 胶水层相同：

- 作者有 `evalCheckWxContextGlobalIdAvailable`，检查 `Module.wxContextGlobal.fetchAndIncId` 是否为函数；绑定到作者 `wasmImports.Jk`。
- 作者有 `evalFetchAndIncGlobalId`，在该方法存在时调用它取得 ID；绑定到 `wasmImports.Ik`。
- 当前自构建 JS/WASM 导入中没有这两个调用。

已沿最终 WASM 实际指令核对，不仅比较导出名或字符串：作者 `glxInitBufferDataAndGlState` 是 381 bytes，自构建是 257 bytes；作者新增能力检测并保存结果。作者内部函数 f5862 在该能力位成立时调用共享 ID 桥，否则使用自己的回退计数器。下列原生资源创建函数确实调用此 helper；自构建最终 WASM 使用各类型独立计数器，配套旧库构造器将这些计数器初始化为 1。

| GL API | 作者 WASM 函数 | 自构建 WASM 函数与计数器偏移 |
| --- | --- | --- |
| glGenBuffers | f3019 → f5862 | f2470，GlState +8 |
| glGenTextures | f1804 → f5862 | f1548，GlState +20 |
| glGenFramebuffers | f2003 → f5862 | f1698，GlState +24 |
| glCreateShader | f88253 → f5862 | f50802，GlState +16 |

这些索引和内部偏移只用于复核固定哈希二进制，**不是可写的公共 ABI**。不据此改 WASM heap、重写闭源对象布局或混配 JS/WASM。

加载页会先创建 2 个 shader、1 个 program、2 个 buffer 和 1 个 texture，随后引擎在同一 canvas 接管。作者新增的共享 ID 路径因此与两阶段资源编号交接直接相关。仍缺少该手机运行时是否提供/实际采用 `fetchAndIncId`、加载页实际资源 ID、引擎 ID 和平台冲突行为的证据；不能宣称冲突已经发生。作者还有并行 shader、透明画布和压缩纹理相关能力差异，本轮没有证明那些路径被使用，也没有将它们一起加到候选中。

另经复核，加载页两个成功编译的 shader 仅保存在局部变量中；`deleteShader` 只出现在编译失败分支，成功 cleanup 没有显式删除它们。这里仅记录未显式释放的资源，不由此推断平台实际保留时间或已经发生 ID 冲突。

本轮按作者二进制实际标记核查官方 `version=0.1.0` 下载端点，得到腾讯 WAF 拒绝，没有取得归档，已停止该请求而未绕过。准确作者库来源、哈希和完整构建输入仍未补齐。给旧 JS 增加两个未被旧 WASM 调用的 helper 不能修复原生分配逻辑。

## 相同的路径与排除边界

- SDK、adapter、engine/game.js、glx-config 原字节相同；SafeEngine、InternalConfig、Features 整块相同。SDK 仍是 init/preload 完成 → loader.cleanup() → Engine.start()，不读取 loader.gl；保留可调用 cleanup 合同即可，不能使用此前不兼容的 `using=false` 方案。
- 已核对的 37 项上下文、尺寸、after-frame/batch 表达式相同。loader 的 `explicitSwapControl=1`、`renderViaOffscreenBackBuffer=true` 是作者与自构建共有行为，不能当作两者差异。
- 两个实际生成 JS 的 `_godot_js_display_size_update()` 都直接返回 0；显式 `desired_size_set` 仍有单独 `updateSize` 路径。不能把源码中存在尺寸更新实现，或此前 WebGL 离屏缓冲按钮检查，扩大为 GLX 动态 resize polling/真机旋转已经通过。
- GLX 构建源码使用引擎侧 `explicitSwapControl=false`，禁用 Emscripten OFFSCREEN_FRAMEBUFFER；按实际 GLX 模式跳过 Emscripten commit，普通 WebGL 保留原提交路径。不能因为缺少 `resizeOffscreenFramebuffer` 就把它判成黑屏原因。
- 两个最终 WASM 均存在 native flush 导出及调用 `evalBatchRenderAsync` 的路径；JS 都是 `batchRenderAsync(view)` 后按 drawcall 条件调用 `swapWindow()`，after-frame 回调也相同。没有证据支持额外加 flush、commit、swap 或延时。
- 以上不证明两版库内部所有命令编码和状态相同，也不证明失败会话真实提交到了正确显示面。

## 已准备的独立候选

包身份：`selfbuild-glx-engine-first-1d284f320d422f6848a9`。私有目录 `.local/glx-engine-first-context-20261023-01/candidate/`，父包为当前黑屏中文包。27 个文件中 23 个字节不变；仅 loader 运行逻辑、mode 包身份、relay build 和 CANDIDATE 清单改变。

新工具 [loader-engine-context.mjs](../engine/loader-engine-context.mjs) 只接受已有终态 loader SHA256 `606480e28dc6c4d640dc03f588ccfa0465595b4b8e670a113e466c887227375f`。在原有模式固定之后、getContext 之前，GLX 分支置 `gl=null` 并返回，把首次 GLX context 和 GPU 对象创建留给引擎。保留尺寸计算、图片/进度回调、引擎分包下载和 cleanup；WebGL 不进入新分支。没有新建第二个 context、强制重建、GPU 查询或帧提交包装。

这把“加载页拥有 GPU 上下文和对象”作为一个隔离因素；同时去掉该阶段的初始 context 属性、绘制/提交和 GPU cleanup 副作用。即使候选通过，也只能先支持这个交接范围，不能单凭成功唯一证明资源 ID 冲突。SDK/平台仍可能预建资源，候选仍可能失败。

代价是 GLX 下不显示原 canvas 加载页，画布可能在引擎启动前保持空白。原中文场景、字号和布局不变，已知 FPS/vConsole 遮挡本轮不混入修正。`loaderContextMatches=null` 表示没有 loader context 可比较，不是匹配成功；实际 GLX、主 canvas 和 native 描述符证据仍须满足，最终必须由真机画面确认。

| 封存项 | SHA256 |
| --- | --- |
| 新 loader | `1dd408fa7a69e2f4652033d6f08c12d70bb6f233cb3074bd0e7510173aa1ae1b` |
| 外部 27 文件 manifest | `ba51d3cddb9e6fa571b1085d989d49bd6388c27e7d63a2646d0a3994ccb794e5` |
| 文件树 | `856a62ed25c0fef713e5bc9e4708cf483e635771ba293ad66f894eb475b103de` |

## 本地验证与复现

[定向测试](../tests/loader-engine-context-tests.mjs) 的 6 个 fake 场景通过：原 loader 确实创建上述 GPU 对象，候选 GLX 加载页零 GPU/context 调用，下载成功/清理接口仍可用，首个 context 留给模拟引擎，晚图片/进度/已排队 resize/RAF 不再触碰画布。显式 WebGL 与能力不支持时的 WebGL 分支，前后完整调用 trace 都与父 loader 相同；未知输入、重复补丁、已有输出拒绝。

封包与诊断 7 项通过：配套引擎/PCK/23 文件原样、身份与 relay 只替换身份、能力不足不回退、loader-null 不伪报匹配、实际 WebGL 或缺少 native 描述符仍报失败。工具汇总 `node tests/run.mjs` 为 75 项通过、0 失败；本次未重跑 Godot headless，也没有微信模拟器或手机执行。这些是本地合同与静态证据，不是 GLX 显示验收。

独立静态复核通过，记录在 `native-audit/ENGINE_FIRST_REVIEW.json`：确认文件树、内部/外部清单、4 项准确差异、成对引擎与 PCK、GLX 门禁及云预算。该复核没有再次执行目标引擎或手机。

复现补丁时输入与输出均使用绝对路径，输出目录须全新；保留原包：

```text
node engine/loader-terminal.mjs --source <作者原loader> --out <新目录A/godot-loader.js>
node engine/loader-engine-context.mjs --source <新目录A/godot-loader.js> --out <新目录B/godot-loader.js>
node tests/loader-engine-context-tests.mjs --source <新目录A/godot-loader.js>
```

本机候选的完整组装和逐文件核验脚本在私有 `preparation/prepare-candidate.mjs`，`--write` 只允许新候选，`--check` 可核验当前封存产物；未把 AppID、云配置、第三方包或私有日志提交到仓库。要复建原生引擎仍按 engine/README 的完整配方生成配套 JS/WASM，不替换单个库文件冒充重建。

## 下一轮预览边界与回退

本轮状态 **prepared / not previewed / not phone verified**。新预览必须先获具体确认，当前黑屏现场不动。建议下一轮仅推送上述一个包，先首开，再上滑结束微信后重开一次；每轮观察最多 60 秒，实际画面出现后读取原诊断。沿用已有云环境，每个新会话最多 10 条逻辑记录、60 秒绝对窗口，不新增事件、服务或部署。手机截图/进程对照也须包含在下一轮确认范围内；失败立即停，不清缓存、不自动重试或换回。

若改善，后续再做同包有界重复并验证平台资源 ID 合同；若仍失败，保留这条反证，说明去除 loader GPU 阶段仍不足，继续限定在原生库/平台呈现合同，不靠更多加载延时或无依据开关。长期可维护修复需要取得包含共享 ID 能力的准确配套库及构建输入，或官方公开的修复接口。

回退包仍为原封存的作者正常参考包、当前中文父包及默认 WebGL 可玩包，完整目录与哈希未改。回退通过重新推送封存包完成，属于另一次换包，不能自动执行。本候选不接入默认转换器或 stager，因此本地移除独立候选不会改变默认 WebGL 和既有裁剪/分包工具；本轮不宣称手机裁剪/分包通过。

## 后续单次预览已批准并推送

用户随后明确批准 `selfbuild-glx-engine-first-1d284f320d422f6848a9` 的一次推送、首开与上滑结束微信后重开各一次，以及只读截图、进程和现有云日志；黑屏即停，不清缓存。微信开发者工具登录及版本门禁通过，`auto_preview` 返回成功，27 文件上传后封存复核通过。没有重发预览或改包。批准与回执记录在私有 `acceptance/APPROVAL.json`、`PREVIEW.json`；候选内部准备时的状态字段保持原字节，不替代这些后续记录。

当前等待首开画面反馈，尚无新候选手机通过结论；首开可见通过后才执行已批准的同包结束微信重开。上文未授权/未推送状态为准备阶段记录。默认 WebGL、赛车、服务器和分支合并均未改变。

## 获批两轮结果：首开通过，结束微信重开失败

只执行上述一个包的一次预览、两次手机运行、两次只读云查询及两次 USB 截图/进程读取，没有清缓存、自动重试、回退换包或部署。两次取证的临时连接均正常清理；手机设置未改。27 文件在手机测试后仍与封存清单一致。

设备：iPhone 16 Pro / iPhone17,1，iOS 18.3.1，微信 8.0.75，实际基础库 3.17.5（vConsole 标记构建时间 2026.10.21 11:45:04）。仅适用于这台手机及这两轮。

| 轮次 | 会话短码 | 用户与截图 | 云端观察 | 结果 |
| --- | --- | --- | --- | --- |
| 首开 | `08a0e6e1` | 用户确认两块都在动；截图可见直接/离屏 2D、两白点、GLX 文本和同一短码 | 实际 GLX，sceneRead，canvas/native 描述符匹配；loaderContextMatches=null | 此轮可见 GLX 通过 |
| 上滑结束微信后重开一次 | `117e07c5` | 用户持续黑屏；USB 截图仅原生胶囊、FPS 与 vConsole，游戏区域黑 | 新会话仍为 GLX、sceneRead；用户随后粘贴的当前 vConsole 含同包同码，补齐会话关联 | 可见呈现失败，立即停止测试 |

WeChat PID 从 25735 变为 25999，新进程开始于 21:12:51.347+08；证明这次微信进程已重建，不能当作返回原会话。黑屏会话 entry 21:12:59.041、scene 21:13:02.451；USB 截图在 21:14:01+08。WebContent 进程名不能单独精确归属到小游戏，不据此补造进程关联。

首开的 scene 记录接近 60 秒上报窗口结束，未采到 manual；不能把缺少 manual 当作按钮失败，也未追加一次手机运行。单帧截图证明可见画面，动画依据是用户两块都动的反馈。云中 visibleRendering 字段仍为 not_verified，验收来自单独的画面证据。音频、场景切换、10 次重进、3 次前后台、裁剪与分包均未在本轮验收。

私有证据：`.local/glx-engine-first-context-20261023-01/acceptance/` 的 `FIRST_OPEN.json`、`FORCEQUIT_REOPEN.json`、`VCONSOLE_ERROR_REVIEW.json`、`ACCEPTANCE.json`，以及原始云响应、截图、进程。首开截图 SHA256 `e3909fde9507d6adf2a808e95689b31fcb604331d69dc7e197a93c04e6c516e4`；黑屏截图 SHA256 `fc017974b35a82ad6263424958271125c2bfd90c6ea5e8cafa63a910b19803d7`。用户粘贴文本保存为 `USER_VCONSOLE_FORCEQUIT.txt`，不是原始导出文件字节；SHA256 `12def4581ce3c0779731d5d66a313d7b8c53f95d1f677c1bbab6cb3bc1bfbf63`。

## 本次已确认的渲染错误与收窄范围

同会话引擎日志明确报 `CopyShaderGLES3: Vertex shader compilation failed`：`layout 'location'` 无效、`vertex_attrib` 和 `gl_Position` 未声明，随后 `_compile_specialization` 失败、shader 无法绑定。源码为 `#version 300 es` / `MODE_SIMPLE_COPY`，第 26 行 `layout(location = 0) in vec2 vertex_attrib;`，第 41 行写 `gl_Position`。这是真实编译失败证据，不能用后续 `Engine has started`、场景回调或 FPS 掩盖。

云摘要 `errors=[]` **只表示观察器未发现模式/上下文不匹配**：当前 candidate-observer 的 errors 数组不收集引擎 printErr 或任意 console.error。这一边界已由代码核对，不能再将空数组概括成运行时无错误。没有为了补齐日志修改已批准包或追加云查询。

固定源码 `shader_gles3.cpp:317` 明确传 `GL_VERTEX_SHADER`；顶点编译失败返回，当前 specialization 尚不会进入后续 fragment 创建。CopyShader 在 CopyEffects 初始化时编译 SIMPLE_COPY，也用于 render-target 到 system_fbo 的最终复制。两版最终 WASM 的 glCreateShader 均将参数原样编码为 `[11, shaderType, shaderID]`；定点反汇编未发现 stage 互换或 type/ID 顺序交换，差异仍是 ID 来源。源码意图和本地编码不等于平台实际收到的 stage/对象。

[GLSL ES 3.00 规范](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)的顶点内置变量包含 gl_Position；这组错误与“顶点源码被错误阶段/对象处理”的情况相符。**这是定位方向，不是已确认平台创建了 fragment 对象或资源 ID 冲突。** 平台实际 shader 类型、ID、源码绑定与命令解码尚未读回；不应删掉合法的 layout/gl_Position 来绕过报错。

另外存在 JSON parse 失败，先与 shader 故障分开：中文 UI 对窗口几何 JavaScriptBridge.eval 返回值无条件调用 JSON.parse_string，而固定引擎的 JavaScriptBridge::eval 为微信适配直接返回空 Variant。这是可见代码中的独立解析缺陷；日志本身不足以唯一标识此次调用者，更不能认定它造成 shader 编译失败。当前只记录，未改已批准场景。Web 构建的 Godot GPU program cache 加载路径直接返回 false，也不能仅凭重开就归因 Godot 磁盘 shader cache。

有界静态复核保存于 `native-audit/SHADER_FAILURE_REVIEW.md` 与 `js-audit/SHADER_FAILURE_SOURCE_REVIEW.md`。下一步关键缺口是匹配作者的原生库/共享 ID 合同，或失败 shader 的实际类型和对象关联证据。当前没有依据改 flush、延时、shader 常量或闭源对象布局。候选保留为失败对照，不进入默认转换、裁剪或分包流程；新换包与手机运行须重新说明具体改动并获批。
