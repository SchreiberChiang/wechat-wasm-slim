# GLX 自构建接续记录

接续时先读 [问题总表](GLX_ISSUES_20261023.md)，其中统一列出当前失败、未证实原因、撤回实验、构建恢复缺口和提交前验证；下文按阶段保留历史记录。

2026-10-23 后续：[Losomz 固定源码对照](GLX_LOSOMZ_COMPARISON_20261023.md)确认主要 GLX 适配已包含，新参考所用库仍与旧库相同，未找到与 CopyShader 故障有依据关联的缺失补丁。BUILD-01 已修并通过本地合同；未重编引擎、换包或重开当前失败现场。现有真机结果不变。

## 边界与当前状态

最新电脑侧补充：[shader 对象与共享 ID 核对](GLX_SHADER_ID_COMPAT_20261023.md)已确认作者与旧库的分配合同差异，但没有可验证的旧库 allocator 注入接口，不能只包裹 `glCreateShader` 冒充修复。作者配套引擎对照候选 `author-pair-cn-857167c70711a319d489` 静态检查通过，但用户已拒绝该预编译替换路线，预览申请撤回；未运行或推送，仅保留参考。目标仍是可自行构建、裁剪和进入现有分包流程的修复。当前手机黑屏现场保留。

最新状态：完整自构建、配套静态审计及独立模拟器 WebGL 回归已完成；**自构建 GLX 尚未通过稳定显示验收**。中文包和随后获批的 engine-first 候选均出现首开正常、上滑结束微信后重开黑屏。后者包 `selfbuild-glx-engine-first-1d284f320d422f6848a9` 首开 `08a0e6e1` 通过，重开 `117e07c5` 失败；同会话 vConsole 确认 CopyShader 顶点编译/绑定失败。去掉加载页 GPU 阶段不足以修复，已停止手机运行并保留现场。作者共享 ID 与旧库本地计数器差异仍真实，但实际冲突未证实；详见 [上下文交接与真机结果](GLX_HANDOFF_AUDIT_20261023.md)。裁剪和 WASM 分包验收仍待完整引擎稳定。下文 building／等待编译和待授权段落为过程记录，不覆盖此状态或后续实测。

目标是从源码构建并维护自己的 GLX 引擎，最终支持现有裁剪与分包。作者正常包是已接受参考和回退，不作为最终源码交付。后续用户已接受作者包清缓存、结束微信重开，并对赛车接入后的主观帧数给出正常反馈；原作者验证文档末尾的早期待测描述是历史阶段，不应据此要求重新从零验证。没有逐轮身份的补充反馈不虚构次数，也不扩展成所有设备的稳定保证。

原仓库保留在 `codex/glx-adaptation-20261022`，本地与远端均为 `8b59fe9304321fcf2732c959e513767c6dab1255`。原有未跟踪 `docs/GLX_AUTHOR_RELEASE_VALIDATION_20261023.md` 保留。本轮独立 managed worktree 分支为 `codex/glx-selfbuild-20261023`，从同一提交建立。未修改赛车源码、服务器、证书或默认分支，未新增手机预览或云报告。检查未找到本仓库或父目录 AGENTS.md。

## 参考封存

只读核对赛车 `codex/racing-author-glx-20261023` / `6acdb17c80566a818a0f24304e959e6b50c05cde`；复制的是最新 `.local/author-racing-035/pair-candidate`，不是旧的 033 候选。

- 作者包身份：`CR_MAIN_81add5f5_035_a0e9a833_author`。
- 同一赛车 PCK：12,845,060 bytes，SHA256 `81add5f5e76fceceade591da47e5db593df72ce3e2ba27545c892d2ac6aa41c9`。
- 私有封存位置：原工具仓库 `.local/glx-selfbuild-20261023-02/reference-racing/`；包括整个 pair-candidate、作者/原引擎对照、main-webgl/preview17 回退、源 AGENTS 和最新作者接入记录。
- 124 个文件、99,628,738 bytes，源与副本路径/大小/SHA256 全部一致；manifest SHA256 `36a6ae00acd7bbeaf81eed1f978cad65af5b83761962ff4935613b0fe10cbeeb`。源 Git 状态和文件前后不变。
- AppID、包、PCK、私有配置、原日志及 manifest 只保存在忽略目录，不提交。

## 选定构建路线

来源核对、哈希、命令、依赖取得路线与限制见 [engine/README.md](../engine/README.md)。固定 df3cdd9、Emscripten 4.0.10、官方 0.1.11 的 4.0.10 库；该库与旧库相同，仅作为可获取且静态匹配的候选。作者 GLX `0.1.0 / 2026.09.02` 对应的准确库和构建输入仍未知，不称为作者构建的精确复现。

新完整构建不加旧 `wx-startup-df3.patch`、`WX_LAB_STARTUP_TRACE` 或 `WX_LAB_RUNTIME_PREWARM_POLICY`，保留固定源码已经包含的上下文/commit/GLX 选择修复，不重复应用 099277。唯一额外源码 diff 为 Windows 链接 response file 适配。使用原源码后处理生成配套 JS/WASM。

准备第一次因 PowerShell `Git` 辅助函数与 `git` 大小写不敏感递归而中止，仅有归档/vendor；`.local/glx-selfbuild-20261023-01/FAILED.json` 保留。辅助函数改用 `git.exe` 后，在 `-02` 新目录准备成功。没有删除失败现场，也没有将准备失败称为编译失败。

`-02` 工具链实测为 Python 3.14.0、SCons 4.11.1、Emscripten 4.0.10。编译于 `2026-10-23T09:17:46Z` 开始，当前记录阶段为 **building，尚无完成产物或手机结果**；实际状态以本地 BUILD.json 的 finishedAt 和日志为准，不按本文件推断已经完成。SCons 4 jobs、thin LTO 2 jobs、总预算 120 分钟，只对编译器崩溃最多重试一次。独立源及 SDK 原件不改。

## 代码与本地回归

- 显式 GLX 静态库及哈希进入构建配置与 SCons 参数；默认来源也核对 Git 中的库字节。
- 构建身份增加 SDK 关键文件、实际宿主 Node/压缩版本、源码 diff 与未跟踪源码。改变输入拒绝续编，新增模块源码也不能混入旧构建。
- JS/WASM/Brotli 输出各自记录哈希，并验证解压配套关系。
- 修复 CLI/测试中的 file URL 解码，使中文 Windows managed worktree 路径可运行；渲染默认值和启动流程不改。
- 本轮 `node tests/run.mjs --godot <本机 Godot 4.7.2>` 为 **66 汇总项通过、0 失败**，包含 Godot headless 插件分支和输出格式；不替代 GLX/真机/新引擎转换验收。
- 固定引擎源码自带的 WebGL 上下文、commit-frame、GLX runtime selection 三组测试通过，之后开始实际 C++ 编译。
- 准备脚本语法、运行时路径选择及越界拒绝已检查；来自全新官方 SDK 的完整安装/cache 预热尚未执行。

## 后续电脑侧进展

- 增加完整引擎组包器及本地观察器：严格验证 df3cdd9、固定官方库、空补丁/宏、完整 profile、成对产物、PCK 和作者原件；WebGL 默认，GLX 显式能力门禁。模板/组包器改动进入包身份。loader/SDK/adapter/原音频阈值不变，额外入口差异单独列明；不含云 relay。
- 增加配套静态审计：WASM 只编译/检查导出，不实例化；核对四个原生 GLX 符号在生成 JS 与 WASM 导出中一致，确认压缩解压配套和提交代码模式存在，不由此宣称初始化或画面通过。
- 新增候选/静态审计测试后的工具汇总为 69 通过、0 失败（这一轮没有重复 headless；上节 headless 通过仍仅覆盖该插件测试）。随后能力阻断一次性摘要的定向候选测试为 23/23。
- 当前完整构建已进入最终链接；实抓链接 response 文件证明使用指定静态库、`-fexceptions`、WebGL2、`GL_ENABLE_GET_PROC_ADDRESS=0`、`EXIT_RUNTIME=1`、`STACK_SIZE=5120KB`、thin LTO，不包含 OFFSCREEN_FRAMEBUFFER 或旧启动宏。response 原件留在私有 provenance 目录。
- 独立公开工具链 `.local/glx-public-deps-20261023-01` 从固定来源完成安装。Emscripten 4.0.10、Node 22.16.0、Python 3.13.3、SCons 4.11.1；十个 ThinLTO 库准备后冻结，匹配 5120KB stack 的探针链接通过，未执行 WASM。原先 UTF-8 激活、emcc wrapper、EXIT_RUNTIME 和 stack 参数的准备/纠正记录保留，完整过程见 engine/BOOTSTRAP.md。新 SDK/cache 哈希未因验证改变；这不等同于新 SDK 已完成完整 Godot 构建。

下一步等待配套完整引擎编译和静态检查，完成最小包及默认 WebGL 本地回归，再申请一次具体 GLX 真机候选对照。不得将构建成功、初始化或 swap 计数作为显示稳定通过。裁剪、WASM 分包、新手机验收仍待完整候选的前置门禁。

## 构建流程后续审查

在 `-02` 编译仍运行时封存了当时工作树构建脚本，位置为私有 `provenance/recipe-observed-20261023-175944/`。其中 build.mjs 的文件修改时间早于该次构建启动；prepare-selfbuild.ps1 的泛化路径选择在启动后改过，快照明确标为观察时版本，不冒充原始准备脚本。

随后改进只用于未来构建：SDK 指纹补 `wasm-opt` 及官方 SDK 的 bin/node.exe、bin/python.exe 布局；子进程清理 NODE_OPTIONS、NODE_PATH、PYTHONHOME、PYTHONPATH，并保持父环境不变。观察时这四项均为空。未修改运行中的源码、SDK、库、BUILD.json 或任务。新增契约覆盖依赖文件变化导致续编拒绝和父环境保留，定向 10/10；工具汇总再次为 69/69（本次未重复 headless）。公开 bootstrap 的同类环境清理也通过解析和定向检查，没有重复安装。

## 完整产物及电脑侧实际验证

`-02` 已于 `2026-10-23T10:04:48.006Z` 完成，构建进程正常退出。SCons 阶段约 44.63 分钟，之后完成 JS 后处理、Brotli 和封存。前文 building 是历史阶段。

| 文件 | bytes | SHA256 |
| --- | ---: | --- |
| godot.js | 436815 | `b5710406a1fb9005692658a9d7a826085588213e7d50552b587fffa0ca579738` |
| godot.wasm | 65192798 | `67f58828b85a79769f9b74303d9153c757a707990b75cb39df8393bb61482718` |
| godot.wasm.br | 8665412 | `4213a38841ea1848fe93e0a9e5262442a66d0a931b18d2644f8299a4112cf92c` |

配套身份为 `f166e718cd05ecf3f3b7c76d9e52cee1f718b0d379b78d49c8470181ffa0e9ed`。`pair-audit.json` 验证解压严格匹配、WASM 模块有效、751 imports / 31 exports、四个 GLX JS→WASM 函数导出映射及提交代码模式；没有实例化来宣称 GLX 通过。

以作者原壳和同一验收 PCK 独立组包：

- WebGL：`selfbuild-webgl-4b2162efea4b070c3927`，目录 `candidate-webgl-01`。
- GLX：`selfbuild-glx-b1ef05cea65f79d39e42`，目录 `candidate-glx-01`；尚未启动或推送手机。

Windows 微信开发者工具 `2.02.2609231 RC` 的独立 WebGL 窗口实际启动，模拟器基础库为 `3.15.2`。模拟器返回的 iPhone/iOS/微信字符串不是用户手机信息。会话 `mvkt1w09-bmfsjqxq` 的请求和实际模式均为 WebGL，canvasMatches/loaderContextMatches 均 true，errors 为空。截图可见直接 2D、离屏 2D 动画；实际点击游戏按钮成功读取诊断 JSON、切到旋转 3D 方块、将离屏缓冲从 640×240 调为 320×120，调整后继续显示。声音和生命周期未测。

CLI 触摸工具先报 invalid canvas size；运行时工具没有取得 canvas，首条表达式还存在 CLI 引号丢失，不能据此判引擎错误。原生 UI 经用户允许独占窗口后完成按钮操作。控制台必须选择 gameContext；top 上手动读取 API 导致的 TypeError 是测试表达式错误，不是启动错误。临时输入监听 30 秒后移除，无包文件修改。电脑 GLX 未运行，WebGL 会话能力值缺失不能当作手机 GLX 不兼容。证据与限制见私有 `LOCAL_VALIDATION.json`。

另在 `convert-webgl-regression-01` 执行默认转换 check/convert/verify，包 `wxslim-1affc56c32e5bb3613e0`：37 pass / 2 warnings / 0 fail，默认 WebGL、加载页 on，最终解压 WASM/PCK 与输入一致。注意项是占位 AppID、未执行官方 init；该转换产物未运行，不能借用作者壳候选的可见画面作为它的运行证据。

仍待：自构建 GLX 真机显示与生命周期验收、完整引擎稳定后恢复启动优化、裁剪和分包、同一赛车 PCK 对照。默认 WebGL 与已接受作者包未被替换；本阶段没有新手机预览、云上报或服务器改动。

## 首轮自构建 GLX 手机候选（待授权，未运行）

- 包身份：`selfbuild-glx-phone-9d38ee9a27cec352809e`；父候选为 `selfbuild-glx-b1ef05cea65f79d39e42`。
- 私有目录：原工具仓库 `.local/glx-selfbuild-20261023-02/candidate-glx-phone-01/`；准备脚本、预览计划、完整文件清单及 mock 结果在同级 `phone-preparation/`。
- 27 项文件（含候选元数据）封存校验通过，22 项受保护文件与父候选一致，包括完整引擎 JS/WASM、PCK、loader、SDK、adapter 和项目配置。仅入口、模式/摘要观察器、既有云 relay 接入及候选元数据有单列差异；未增加 GPU 查询或包装初始化、swap、rAF。
- VM 内存模拟 10/10 通过，并经过独立只读复核：能力阻断不回退；实际模式和原生上下文不符不报成功；旧 relay 包身份不匹配时拒绝启动；初始 show 不消耗恢复记录额度；record/flush 都检查绝对截止时间，后台计时器暂停后恢复也不会越过 60 秒新增发送。Mock 不替代微信、云端或手机执行。
- 每个启动会话最多 10 条逻辑记录、60 秒报告窗口，使用现有云函数，无新部署；网络失败重试可能重复批次，按包、会话、序号/批次去重。窗口截止后的无日志是预期，不按失败判定。必要的私有配置继续只存于忽略目录。

拟申请仅一次该包手机预览：同一 iPhone 首次打开并确认直接/离屏 2D 画面，读取一次摘要，再上滑结束微信后重开一次；每轮绑定短码、实际 GLX 和用户可见画面，直接只读查询对应云日志。黑屏、能力阻断或上下文不匹配即保留现场停止，不清缓存。这两轮不是最终稳定验收；连续重进、前后台、手机 3D/resize、触摸及音频仍待后续按结果安排。

该候选使用固定 df3cdd9 源码与可公开取得的 GLX 0.1.11 完整重编，未取得作者发布包的准确新库，不称为作者修复的精确复现。已接受作者包、父候选及 WebGL 回退保持原样；手机回退也需明确换包授权，不自动推送。电脑侧准备已完成，新的运行、预览、换包和上述限量云报告仍待用户确认。

## 首轮授权及预览结果

用户已回复“批准这一个包和两次验证”，授权范围与上述具体候选/计划一致。随后仅调用一次 `auto_preview`，返回 `ok: true` / `success: true`，总包大小 9,088,193 bytes。预览后重新核验完整 27 项封存文件，全部未变。完整 WASM 位于原壳的 engine 资源包中；没有执行本仓库的 WASM 拆分或裁剪流程。

已请用户先打开约 20 秒、60 秒内读取一次摘要，回复 8 位会话短码和直接/离屏 2D 的实际画面，暂不重开。只读云查询限定本次 packageId；上传成功不等于手机运行或 GLX 通过。操作和后续结果保存在私有 `phone-acceptance-01/`，原始云记录不提交。尚未要求第二次操作，若首轮黑屏则保留现场并停止本轮。

首次只读云查询取得会话 `c7c1c2cc` 的 3 批/4 条去重记录：设备 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、实际基础库 3.17.5；能力 true，场景阶段 `actualMode=glx`，contextPresent、canvasMatches、loaderContextMatches、nativeContextIdMatches、sceneRead 全为 true。入口至场景记录约 40.499 秒，期间记录一次 hide，不能将其算作新的启动或已通过恢复测试。尚无用户可见画面确认；初始化完成/显示成功不能由场景读摘要或无错误记录代替，因此此轮仍未验收。第二次结束微信后重开尚未执行。

## 真机失败反馈及最新云证据

用户后续反馈：“看最新的报告，两次都是黑屏，没见过正常的时候”。因此本包可见渲染验收为 **FAIL**，不能沿用前文“待画面确认”或将 `actualMode=glx`、`sceneRead=true` 写成显示成功。

18:36:30（+08）只读查询该精确包返回 14 批，响应 total=14，均在 limit=100 的本页内；覆盖该次响应时刻匹配记录，不包含以后延迟上报。共 19 条去重记录、5 个 relay 会话：`c7c1c2cc`、`2614466e`、`2cc689cb`、`16012f04`、`b0e895aa`。不能擅自将五个会话当作五次人工测试，也不能猜测其中哪两个分别对应用户操作。

五个会话均观察到实际 GLX、context 存在、canvas/loader/native context 匹配与场景读身份；均无 manual 事件。`2614466e` 的场景后 hide→show 属于同会话恢复。设备/微信/基础库与首查相同，dropped 均为 0；有限白名单记录里的 errors 为空不排除未采集的 GPU/native 错误。未记录具体 native ctxid 数值，只记录匹配布尔值。此次证据将失败限定在“已进入 GLX 并到达场景，但用户看不到正常内容”，尚不能区分绘制命令生成、原生提交或最终呈现，也不能认定闭源库版本就是根因。

字段含义进一步核对：`nativeContextIdMatches` 比较的是 `runtime.ctx.emscriptenGLX.ctxid` 与 JS 侧 `runtime.wxContextGlobal.ctxid` 的副本，**不是从 WASM/原生层读取当前渲染目标**。它只排除这两个 JS 描述符的明显不一致，不能证明 `glxUpdateContextId` 实际生效、native 初始化完成或原生命令使用正确目标。固定上游 `wxGLXCallNative` 会 catch/warn 后返回 null；现有有限日志不能排除被该路径捕获的初始化错误。原生三角形已有 strict-post 会让此类错误透传，这也是该隔离与 Godot 壳的已知差异。

原始响应、脱敏摘要及用户反馈已保存，首次反馈前的 ACCEPTANCE.json 另存快照。未新增预览、重启、清缓存或回退换包。后续先做电脑侧构建/提交差异核查；不进入裁剪、WASM 分包或赛车对照。

## 黑屏后的有界源码比较

在不执行两份引擎的条件下，用已有 Acorn 解析作者原 JS 与本次自构建 JS，比较 275 个选定的命名表达式：266 个表达式文本完全相同，其余 9 个为作者独有的压缩纹理下载支持。相同部分包含完整 GL 对象、创建/切换上下文、三项 native 初始化/ctxid 调用、默认 FBO 的 JS bind、帧后 flush、同步/异步 batch 及 drawcall>0 时的 swap。作者 loader 与本候选也逐字节相同。这里比较的是选定 JS 表达式，未证明两份 WASM/C++、闭源库原生命令内容或最终呈现一致。

作者额外的 `glxPushBindTexture` 等接口在当前静态库中不存在；自构建 JS 也没有动态调用它们的对应压缩纹理分支。没有证据表明给链接参数增加这些 exports 能修复最小场景黑屏，因此不据此重编或混用作者 JS。分析脚本、表达式及字符偏移保存在私有 `analysis-after-phone-failure/render-glue/`。

下一项隔离复用此前已构建、未运行的 `.local/glx-native-triangle-build-20261023-05/` 配套 JS/WASM；同一官方库和 Emscripten 4.0.10，现有 C++ 确实绘制三角形并保留库的自然提交路径。只在新目录准备微信宿主，旧产物和失败包不改，不先增加 flush、强制 swap 或延时。该探针同时移除 Godot 渲染器和加载页交接，并有已记录的栈/上下文属性差异：若显示正常，只证明该最小负载可用，不能直接认定 Godot 根因；若失败，也要先核对探针接线，不能直接认定微信缺陷。此次仍仅电脑侧准备，任何新手机包和报告均另报具体方案。

纯 GLX 宿主本地准备已完成，目录 `.local/glx-native-triangle-host-20261023-02/`，内容身份 `native-triangle-8744ed4b49efdbedc8f15df91b50068192e5a217efaa5f0ce171f82bb0079622`。可维护准备器、宿主模板及核验命令在 `examples/glx-native-triangle/`。原始编译 JS 的全部字节作为透明 prelude 后缀保留，WASM 与作者 adapter 原字节复制；未重新编译，也未执行这些生成物或 adapter。

宿主初版 `-01` 的审查发现确定缺陷：此独立编译输出没有将 HEAPU8 导出到 Module，而库的批处理读取 Module.HEAPU8.buffer。修正版在同作用域提供实时 getter，内存增长后不会使用旧视图；`-01` 保留并附缺陷说明。该问题只属于尚未运行的原生探针，完整 Godot 自构建 JS 已导出内存视图，**不能将此修正冒充刚才黑屏的根因或修复**。

修正版 13 个 fake-wx 合同场景通过；6 个宿主文件及原 JS/WASM/adapter 字节核验、合成 overrides/内存视图更新和语法检查通过，独立复核确认身份无漂移。摘要读取实际 Module.ctx 描述符，仅报告初始化快照，缺少实际 context 则为 unknown，不证明首帧或显示。尚无项目 AppID 配置、云 relay 或手机预览，真实宿主执行与真机结果均为 NOT_RUN；下一轮若使用它，需要先完成具体预览准备并取得新的授权。

## 原生三角形手机候选封存（待新授权）

独立手机候选为 `native-triangle-phone-91bac1d5fb37be67d1cf`，位于原仓库私有 `.local/native-triangle-phone-20261023-01/`。生成器、模板、计划、mock 结果及封存清单在 `.local/native-triangle-phone-preparation-20261023-01/`；清单 SHA256 为 `207c17173ae54702746a62de02215d914e9586535e9aedbdbc0ddffaf6785370`。10 个交付文件经重组逐字校验及独立复核通过，根代理再次验证全部文件哈希和长度一致。

该包沿用已核验的原生三角形 JS/WASM；原编译 JS 后缀、宿主、作者 adapter、WASM 及 game.json 均不变。新增入口、摘要/错误观察器和既有云 relay；沿用当前项目 AppID、基础库及编译配置，仅改独立项目名，不在公共文档记录私有配置值。源文件的历史构建输入与当前 worktree 存在 LF/CRLF 字节差异，经归一化比较仅为换行差异；原始构建输入快照及校验保存在私有准备目录，未改写历史产物。

云 relay 保留已有传输、队列和退避机制。每会话最多 6 条逻辑记录，绝对截止 60 秒：启动 1、入口 1、初始化/能力阻断 1、错误最多 2、生命周期最多 1；重发可能重复同一逻辑序号。stderr、abort、非零退出和 wx 错误共用错误额度，并保留原输出。8 个 fake-wx/cloud 场景及定向语法检查通过；这些测试没有执行生成 JS、WASM、作者 adapter、微信或真实云端，也不证明手机可显示。

拟申请仅一次此包预览并在当前 iPhone 首次打开一轮，观察橙色三角形和缓慢变色的深绿色背景。黑屏或能力阻断即停，不重进、不清缓存、不自动切包；既有正常作者包和失败包均保留。手机画面没有会话短码，需按唯一操作、精确包身份、时间及云会话关联；若出现多个可能匹配的会话则标为关联未确认，不猜测对应关系。原两次自构建 Godot 验证的授权不覆盖本包，尚未申请或执行新预览。

此探针同时移除 Godot 渲染器与加载页上下文交接；通过只证明该最小负载能够显示，下一步才有依据单独核对加载页交接。失败时先排查探针宿主及可读错误，不能直接归因微信闭源实现，也不构成完整引擎稳定验收。

## 原生三角形首次真机结果：浏览器兼容 shim 阻断

用户批准上述精确包的一次预览和一次首开后，`auto_preview` 于 2026-10-23 19:10:49 +08:00 返回 success，大小 451600 bytes；预览后 10 个封存文件仍全部匹配。用户回复“黑屏或报错”，显示验收为 **FAIL**，已停止重开、清缓存和自动换包。一次只读云查询取得精确 build 的 2 批、3 个唯一 seq、1 个会话 `8dbb2665`，没有重复冲突。设备为 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、基础库 3.17.5。

该会话记录 `entry → blocked`：能力为 true、JS 声明身份匹配，但实际模式仍为 unknown，失败原因是 `Can't find variable: WebGLRenderingContext`。单个精确包会话与本轮唯一操作相容，入口时间比本机记下的预览返回时间早约 12 ms；时钟/自动启动边界未独立确认，不能据此声称精确对应某次点击。原记录、查询脚本、用户报告和 `ACCEPTANCE.json` 保存在私有 `.local/native-triangle-phone-acceptance-20261023-01/`。

已定位到固定 Emscripten 4.0.10 `src/lib/libwebgl.js:754-774` 的 Safari getContext workaround：它用 `gl instanceof WebGLRenderingContext` 判别浏览器 context，而微信宿主没有该全局类。`src/settings.js:599-605` 提供正式关闭选项 `GL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0`；固定 Godot `platform/web/detect.py:441` 和真实链接参数已使用该选项，作者及完整自构建 Godot JS 均无此 shim。原生 triangle 配方遗漏这一项，属于本探针的适配缺口，**不是此前 Godot 黑屏的已确认根因，也不能据此次结果判定官方 GLX 绘制失败**。

下一步仅在全新本地 triangle 构建目录加入上述已知编译选项，保持库、工具链、C++、GLX 上下文及自然提交路径不变。不伪造 WebGLRenderingContext、不修改微信返回对象、不加 flush/swap/时延。新配套产物必须重新核验后才能申请另一轮手机验证；本轮授权已用完。

该本地修正已完成：`.local/glx-native-triangle-build-20261023-06/` 的 JS SHA256 为 `bb0c6c827293ae1d60e0fc9693056cb778af4a57df156926f985b6cc474d35f4`，独立字节比较确认仅删除上述 281-byte Safari shim，没有新增代码。WASM 与 `-05` 逐字相同，SHA256 仍为 `1f67ed7160c6d8550c1f7ffc4dad30bcd5cc072604a47f82bb001954c8b8f52a`；四项 native 导出及自然提交路径不变。输入 C++/strict-post 的差异仅为 worktree 换行格式，语义相同，WASM 只静态编译/解码、未实例化。

新宿主 `.local/glx-native-triangle-host-20261023-03/` 身份为 `native-triangle-f02dfc578360d9e3e42a8d6165f8f96910e24c9fcb6d332d1775155f0ec10fa9`，manifest SHA256 `f5d8749173b72732ec24446f955f0b7b5b18f41ea30f67d981840004fc071155`。13 个 fake-wx 场景、6 文件封存/原 JS 后缀和合成 heap 更新验证通过；源码构建脚本与宿主准备器均在独立自构建分支。新宿主尚未在微信或手机运行，不将移除确定报错路径写成已恢复显示。

对应修正版手机候选已在 `.local/native-triangle-phone-20261023-02/` 一次生成并封存，身份 `native-triangle-phone-1aa4794e826540179aa1`。准备资料位于 `.local/native-triangle-phone-preparation-20261023-02/`，`PHONE_SEAL.json` SHA256 为 `b40e7ba89622a65006c9171b5b5ce0c6d0ef50f17620696edff821110b279c57`。独立复核确认 10 个文件及重组结果匹配，8 个 fake 场景与输出核验通过，结果已保存为 `MOCK_RESULT.json`。

与失败手机包相比，7 个文件原字节相同；入口、prelude 和 relay 除必要的新身份外保持原行为，编译 JS 只删除已证实导致异常的 Safari shim，WASM 相同。云传输、错误额度、总计 6 条及 60 秒绝对截止均不变。拟另申请该精确包的一次预览与当前 iPhone 一次首开，观察三角形和变色背景；黑屏即停，不重进、不清缓存、不自动回退。该包尚未预览或运行，原失败包仍全部匹配旧 seal。

用户随后明确批准修正版和一次首开。该精确包于 2026-10-23 19:23:00 +08:00 完成唯一一次 `auto_preview`，返回 success，预览体积 451401 bytes；预览后 10 个封存文件仍全部匹配。授权及预览证据保存于私有 `.local/native-triangle-phone-acceptance-20261023-02/`。已请求用户仅打开一轮约 20 秒、观察三角形与背景，尚待可见画面反馈和该轮只读云证据；推送成功不代表运行或显示通过。

### 修正版首开：三角形可见，背景动画未确认

用户反馈“三角形正常，但是背景看不清不清楚有没有在变色”。因此只记录三角形可见，背景动画、持续帧推进、退出重进和前后台恢复均未验收，没有追加手机动作。一次只读查询返回精确 build 的 2 批、3 个唯一序号、唯一会话 `19e03fb2`；`entry → initialization-snapshot`，实际模式为 GLX、platform=1、ctxid=2、上下文描述符和屏幕 canvas 匹配，能力为 true，本次返回的有限记录中无 error/blocked。设备仍为 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、基础库 3.17.5。

单会话与本轮唯一报告操作相容，但手机入口时间比本机预览返回时间早约 51 ms，未独立证明精确点击对应关系。原始云记录、用户原话与 `ACCEPTANCE.json` 已保存在本轮私有证据目录。该结果支持“当前官方库/工具链的极简绘制在这台手机上可以显示三角形”；不能外推到完整 Godot、背景动画或稳定运行。Safari shim 启动异常在此次返回记录中不再出现，原完整 Godot 黑屏仍未解决。

## 完整 Godot 加载页退场候选（本地完成，待授权）

回到完整自构建包检查，发现同一作者 loader 的生命周期缺口：图片 onload、下载 progress 及已经排队的 RAF 仍可在 `cleanup()` 后进入 `render()`，排队中的 resize 会先改主 canvas 尺寸。SDK 的启动顺序是 `Promise.all(engine.init, preload) → loader.cleanup → engine.start`，没有外部终态保护。因此这些晚回调可能在引擎接管后继续改变绘制状态；这是源码可复现的风险，尚无证据证明它曾在失败手机会话中实际发生，不能称为黑屏根因。

公共 `engine/loader-terminal.mjs` 对已核验 SHA 的作者 loader 添加四句：`cleanup()` 入口检查终态并置终态；`render()` 和 `resizeCanvases()` 在终态返回。保留 `this.gl`、全部原有初始化/资源下载、第一次 cleanup 的 GPU 操作及引擎启动顺序，不添加 flush、swap、延时、日志或上下文重建。未知输入、重复应用或覆盖输出均拒绝。输出 loader SHA256 为 `606480e28dc6c4d640dc03f588ccfa0465595b4b8e670a113e466c887227375f`。

`tests/loader-terminal-tests.mjs` 对原 loader 和补丁版执行同一 fake-wx/Image/RAF/canvas/GL 对照，7 场景通过并经独立复跑：清理前行为和首次 cleanup 操作顺序一致，原版的迟到 image、progress、排队 RAF、排队 resize、重复 cleanup 均出现 GL/画布副作用，补丁版对应副作用为零。测试不运行 adapter、生成引擎、WASM、真实网络或手机，也不证明手机因果。

完整 Godot 新候选为 `selfbuild-glx-loader-terminal-822b187802bc1da8162f`，目录 `.local/glx-loader-terminal-20261023-01/candidate/`，准备资料在同根 `preparation/`。父包为此前两次黑屏的 `selfbuild-glx-phone-9d38ee9a27cec352809e`。27 个路径完整保留，23 个文件字节不变；仅 loader 运行行为、mode 身份 JSON、relay build 和 CANDIDATE 清单变化。引擎 JS、压缩/解压 WASM、PCK、SDK、adapter、图片、入口、配置与 GLX 选择均保留；默认 WebGL 未改。

外部 27 文件 manifest SHA256 为 `d8f338e7f4cd8d03302fe8f3480f1c22f82e8410dd566bbb6a40f1c1ea51f0cf`，tree SHA256 为 `021d5cb830e0de848a5f916b74b0e0ca6763a1cd791c08562b39b062a2958bff`，CANDIDATE seal SHA256 为 `27c58a33457a696ecaffdf2b1c3c1ad5698033da89c790ea2e584f91da4aed2a`。独立复核通过，封装 10 项 fake 检查通过；日志仍为父 Godot 包的最多 10 条逻辑记录/60 秒，未扩大事件、重试或采样。没有新预览、手机操作或云请求。

拟另申请一次该精确完整包预览，替换当前三角形预览并在当前 iPhone 首开约 20 秒，若画面可见则点一次既有诊断按钮；观察直接/离屏 2D，读取实际 GLX 并关联短码。黑屏或报错即停，不重进、不清缓存、不自动回退。该轮只检验完整 Godot 的首次可见画面，不代替后续稳定性、触摸/音频、裁剪和 WASM 分包验收。原作者正常包、完整 Godot 失败包与三角形包全部保留，换回仍另行确认。

用户随后批准该完整 Godot 包和一次首开。唯一一次预览于 2026-10-23 19:37:30 +08:00 返回 success，体积 9090772 bytes；27 个文件预览后仍匹配 seal。已请求只打开一次，观察直接/离屏 2D 并在画面可见时读取既有诊断按钮；尚待用户可见画面和对应云证据，不把推送成功计为修复通过。授权和收据保存在本候选私有 `acceptance/`。

### 加载页退场候选首开：直接/离屏 2D 与动画获用户确认

用户在当前已打开的 `selfbuild-glx-loader-terminal-822b187802bc1da8162f` 界面追加明确确认：“两块都正常、都在动”，指上下两块彩条与白圆点。因此本候选一次首开的直接 2D、离屏 2D 可见画面及两块动画均记录为用户确认；本次确认没有新增手机操作或云查询。这是首次可见画面结果，不是完整稳定性验收。

已授权的唯一一次只读查询取得精确 build 的 2 批、3 个唯一序号、唯一会话 `4aff8f26`，无重复冲突。入口时间为 19:37:30.518 +08，场景摘要为 19:37:57.699 +08；requested/selected/actual 均为 GLX，contextPresent、canvasMatches、loaderContextMatches、nativeContextIdMatches、sceneRead 均为 true，modeEvidence 为 observed，返回的有限记录中 errors 为空且无 blocked。nativeContextIdMatches 仍只比较两个 JS 描述符，不是原生/WASM 读回；nativeInitializationSuccess/completion 的云字段仍为 not_verified，不能据此扩大结论。

设备为 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、基础库 3.17.5。精确包、预览返回后的入口时间及唯一候选会话与本次用户反馈相容；用户未报画面短码，故人与云会话的对应关系未独立验证。无 manual 事件；已有 60 秒报告窗口已结束，不以缺 manual 判失败，也没有请求再次点击、重开或追加查询。原始云记录、脱敏汇总及以不可覆盖方式新建的 `ACCEPTANCE.json` 保存在私有 `.local/glx-loader-terminal-20261023-01/acceptance/`。

用户同时反馈英文小字被灵动岛/微信 UI 遮挡，并询问哪个诊断摘要，故 UI 可用性记为 **FAIL，需修正**。当前只确认本候选首开直接/离屏 2D 与动画正常；未测退出重进、强退微信重开、前后台恢复及音频，手机 3D/resize、持续稳定性与多人玩法也未验收。loader 晚回调副作用已在 fake 对照中复现并被补丁消除，但尚未证实它就是历史两次黑屏的原因；本次成功不改写旧包失败证据。UI 修正另做具体候选与封存，不把新改动自动算作已在手机通过。

### 中文验收界面：仅电脑侧完成

在独立 `examples/glx-acceptance-ui/` 新建场景，原作者验收场景及本轮已推送的 27 文件全部保留。主屏改为中文大字、会话短码、实际上下文提示、两块测试图和固定「读取诊断」按钮；3D、离屏尺寸、试听及状态折叠到「更多测试」，JSON 只在手动读取后展示。原 Pattern2D 字节、两个 SubViewport、旋转/切换/尺寸和音频生成行为保持；不增加 GPU 查询、云事件或报告预算。原桥返回 FAILED 时保留明显中文异常提示，不因简化界面丢失失败状态。

安全区只读取窗口及微信菜单几何，按实际逻辑 viewport 换算，预留顶部至少 100 CSS px 和底部 80 CSS px。缺少信息、极小/横屏窗口明确记录 fallback；本轮只检查竖屏，不宣称微信原点或真机遮挡已经验证。新增随包的中文字体子集 41,476 bytes，包含所需 215 个码点与许可，不依赖手机系统字体。

本机 Godot 4.7.2 导入和导出成功；独立 headless 几何合同 PASS、正常退出 0。隐藏的自有本地窗口使用 NVIDIA OpenGL 渲染并保存截图，已检查 390×844 与 360×640 竖屏对应布局、诊断详情、更多测试；两块图案与固定主按钮均在初始可视内容区。此处是电脑原生排版/字形检查，不能替代微信或 GLX 手机验收。首次几何合同暴露 float32 比例向上取整多 1 像素，已改标量比例；失败记录保留，未将退出码单独作为通过依据。

新 UI PCK 为 66,364 bytes，SHA256 `0d4eb4b3f94e60468a271f705b177a2223fe9db6745fb254c388cd21d566ef5b`。从实际 PCK 挂载并加载字体，215 个码点零缺失、许可存在、本地截图与合同脚本未进入包。私有输出、最终源码快照、截图、日志和 LOCAL_VALIDATION.json 保存在 `.local/glx-acceptance-ui-20261023-01/`。尚未组装或推送新的手机候选；新 UI 的 PCK 与上一轮不同，必须建立新包身份并单独获准后验证，不能把它倒算成加载页单因素实验的证据。当前手机候选的全部 27 文件再次核验不变；没有新增手机操作、云查询、服务器改动、提交或推送。

### 中文 GLX 包获准并推送：先首开，再结束微信重开

用户明确要求推送新版中文界面的 GLX 包，按首开→上滑结束微信后重开的顺序验证，并授权直接读现有云日志。独立候选 `selfbuild-glx-cn-a3b9d20dccdd2fbf132d` 位于 `.local/glx-chinese-phone-20261023-01/candidate/`，以已首开正常的 loader-terminal 候选为父包；只改变 UI PCK、mode 中的包身份、relay 的 build 和候选元数据，27 文件中其余 23 项字节相同。完整引擎配套、loader 补丁、observer、项目配置及 60 秒/最多 10 条逻辑记录预算不变。父包已有的旧 subpack 模板元数据保留，本场景未加载该插件，不称作裁剪或分包通过。

静态重组/哈希及独立审查通过，10 项 fake-wx/云预算检查通过。外部 manifest SHA256 `0a44b3b776a66ef80b1bae5e420fdedf4aa82a2a533f38b66a779d3720d57792`，tree SHA256 `21c2e6e836af5d43b41add47fa20a87ff775865b3d9cea005fb650b4072bb7e5`。唯一一次 auto_preview 已返回 success，27 文件推送后重新核验无漂移；收据和直接用户授权保存在私有 acceptance/。推送成功不算真机通过。

当前已请用户先只打开一次，记短码、尽快点击清晰的「读取诊断」，观察两块动画与中文/按钮遮挡。首开确认正常后才要求结束微信再重开；黑屏或报错即保留当前现场，不重试、不清缓存。新包尚待手机首开反馈与精确 build 的云查询，未触发第二轮；旧正常/失败包和原始证据均保留，未改赛车、服务器或默认 WebGL，也未合并或发布。

### 中文 GLX 包首开：短码与手动诊断精确匹配

用户报告 `b0f41707基本上都正常`。一次只读云查询得到精确包的 3 批、4 个唯一序号和 1 个会话，全部事件短码与用户提供的 `b0f41707` 一致。入口时间 20:16:22.420 +08，场景记录 20:16:47.935 +08，手动「读取诊断」记录 20:17:10.880 +08；场景和手动摘要均观察到实际 GLX，sceneRead、canvas/context 匹配，返回的有限记录无 error/blocked。设备为 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、基础库 3.17.5。原始响应、去重汇总和用户原话保存在私有 acceptance/，不以本次成功改写先前失败包。

本轮首开可见结果按用户原话记为“基本正常”，按钮读取链路已收到实际手动事件；不能扩展为音频、3D、全部遮挡检查或稳定性通过。show=1、hide=0 只是初始显示，尚未完成本包上滑结束微信后的重开，也不构成前后台恢复验收。上下文匹配字段比较的是 JS 描述符，不是原生/WASM 状态读回。

用户建议使用 pymobiledevice3 截图与查看进程。已找到既有 11.40.0 环境，只读复用现有配对；本次电脑未发现 USB/Network 设备，局域网发现没有匹配端点，旧地址重新认证超时。尚未建立 DVT 会话，未取得截图或进程，不能将连接阻断记为 GLX 故障。私有失败记录保留，未改配对、路由、手机设置或赛车文件；已请求保持当前画面并连接 USB，先完成这轮取证，再继续已授权的同包强退微信重开。

### USB 画面取证与强退微信重开：首开可见，重开黑屏

用户接入 USB 后，只读复用既有配对完成截图与微信/WebContent 进程读取，每次用户态采集连接均正常关闭，无新配对、DDI 挂载、手机控制或系统路由修改。第一张是手机桌面，不能计为游戏画面证据。用户随后确认切回原小游戏仍为 `b0f41707`、画面正常；第二张 20:36:18 左右的截图确实显示该短码、实际上下文 GLX、直接 2D/离屏 2D 两块彩条和白圆点及大号「读取诊断」。这是一张静态截图，不独立证明动画；从桌面返回原会话的停留时长和操作阶段未受控，也不计为完整前后台恢复测试。顶部 FPS 覆盖部分短码、底部 vConsole 覆盖部分折叠按钮的问题仍保留，尚未修正或换包。

按本轮既有授权，用户随后上滑结束微信并重新打开同包，反馈“黑屏了”。20:37:32 左右的第三张 USB 截图确认游戏区全黑，只剩微信菜单、FPS 覆盖层和 vConsole，无场景短码或报错弹窗。微信 PID 和启动时间已变更，证实这次是新的微信进程，不是返回原会话；多个新 WebContent 的具体 JS 会话归属仍未绑定。FPS 覆盖层不作为 Godot 画面成功或提交成功的证据。

第二轮仅执行一次精确 build 的只读云查询，总计返回 5 批、7 个唯一序号、2 个会话。除原 `b0f41707` 外唯一新增 `6548efda`，入口 20:36:56.073 +08，场景记录 20:36:59.685 +08；与本轮操作、微信进程重建和截图时间相容，但黑屏无短码，不能称用户短码精确核验。新增会话仍观察到 selected/actual GLX、engine/runtime/context 存在、sceneRead 与各 JS 描述符匹配，有限日志无 error/blocked，没有 manual。它证明场景身份读取已执行，不能证明原生 GL 命令、帧缓冲绑定、交换目标或最终显示提交正确，也不能用缺少错误排除 GPU/原生错误。

同包本轮结论为 **首开可见，强退微信重开可见渲染 FAIL**。加载页 cleanup 后回调保护不足以解决已观察到的黑屏，不能称为根因已修复。入口到场景记录由首开 25.515 秒变为重开 3.612 秒，仅作为启动路径/缓存时序差异线索；尚未证明哪一个时序差异导致故障，不据此增加延时或 flush。全部 27 个本地候选文件仍匹配封存清单；正常/桌面/黑屏截图、进程快照、两轮云原始响应和验收 JSON 保存在私有 acceptance/，未覆盖之前失败证据。已停止本轮后续手机动作，不重开、不清缓存、不换包；完整稳定性、音频、3D 和裁剪/分包仍未验收。
