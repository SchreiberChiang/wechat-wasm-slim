# GLX 问题总表与接续入口

**2026-10-24：用户要求暂停 GLX 研究，完成检查点普通推送后转独立 Metal 可行性研究。** 最新失败 `638674f8` 及全部未知保持，恢复和本地材料入口见[暂停交接](GLX_PAUSED_HANDOFF_20261024.md)。本表后面的历史接续计划不构成当前继续实验授权。

状态截点：2026-10-23，用户要求先记录现状，再提交推送。此次是成果与失败现场的代码快照，**不是稳定 GLX 修复发布**。提交分支为 `codex/glx-selfbuild-20261023`，从 `8b59fe9` 接续；原工作区 `codex/glx-adaptation-20261022` 保留。默认 WebGL 不变，不改赛车、服务器、证书，不合默认分支，不新增手机预览、云端操作或第三方联系。

最终目标仍为：可自行构建的配套 Godot JS/WASM 与符号，真机实际 GLX 正常显示，首次启动、小游戏退出重进、结束微信进程后重开及前后台恢复稳定，然后验证裁剪、通用适配和 WASM 分包。作者成品可作静态参照，不能替代这项交付。

2026-10-24 补充：BUILD-01 与 Losomz 对照已保存为本地 `6fd337b`（未推送）；[首次失败诊断配方](GLX_SHADER_FAILURE_DIAGNOSTIC_20261023.md)完成自编译和电脑验证后，按逐包批准推送并完成两轮。首开 `2c5d1526` 正常、强退重开 `dcd3d486` 用户确认黑屏；完整日志均对应同一批准包和实际 GLX。失败时 **Godot 请求顶点 35633，而 GLX 同步类型查询经 JS→WASM i32 转换后记录为片元枚举 35632**，尚未单独取得该次原始 JS 返回类型/值；两路源码完整 1,268 bytes 相同，原错误完整关联。共享 ID 冲突及平台实际编译对象仍未证实，未找到可据此修复的公开参数错配；详见[类型不一致证据与平台边界](GLX_SHADER_TYPE_MISMATCH_20261024.md)。手机运行停止，不重开、不换包、不清缓存。历史失败结果不被本轮覆盖。

同日电脑侧进展：[对象与 context 生命周期核对](GLX_OBJECT_LIFECYCLE_20261024.md)确认本条 TYPE 查询发生在当前 shader/program 删除及同组片元创建之前；native singleton 和首次 descriptor 的寿命存在结构风险，但未证明在失败中发生 context 重建或旧状态复用。`engine/shader-type-return/` 已实现同一次 TYPE batch 原始返回的一次性观察；独立完整构建单次完成，配套/ABI 61/61、JS/组包 22 项、原生 23 项、工具汇总 84 项通过。本地 WebGL 直接/离屏 2D 正常显示并运动，按钮自动化被工具画布尺寸错误阻断，原 JSON parse 问题仍在。新 GLX 包 `shader-type-return-glx-03fa0871dc99f85cc4a2` 只封存、未上传运行；精确输入与[验证记录](GLX_SHADER_TYPE_RETURN_20261024.md)另存。该观察不新增查询或 context probe，不能据此关闭以下原问题。

## 目前能够确认什么

最新手机进展：[原始 TYPE 返回结果](GLX_SHADER_TYPE_RETURN_PHONE_20261024.md)已核对。`shader-type-return-glx-03fa0871dc99f85cc4a2` 首开 `ba727e5d` 两块白点正常运动、手动诊断完整；结束微信后 `638674f8` 黑屏。原始有限 JavaScript number 已为 35632，WASM 仍为 35632，排除该次 JS→WASM 转换改坏类型。以上“只封存、未上传”是批准前状态，现已有批准的两轮实测；手机停止，不追加轮次。原始日志/包与历史证据都保留。

- 同输入 WebGL 曾有首开、重进正常的真机对照；当前默认继续为 WebGL。
- 作者实际发布版在若干已关联会话中确认实际 GLX 和正常画面，用户后续也接受过清缓存、结束微信重开。没有完整逐轮记录的反馈不计入连续验收次数，不扩大为所有设备保证。
- 完整自构建引擎能编译、配套校验并在本地 WebGL 正常显示，但 **GLX 稳定性未通过**。最新同包首开正常、结束微信后黑屏，已取得同会话 shader 编译错误。
- 共享 ID 分配是已确认的实现差异；平台 ID 冲突、shader 对象类型错配仍是待证实原因。不能用初始化、FPS、场景回调、batch/swap 或空 `errors` 列表替代画面。
- `author-pair-cn-857167c70711a319d489` 仅静态准备，用户已拒绝该预编译替换路线，确认申请撤回，**不运行、不推送**。旧黑屏包与现场证据保留；新诊断包依另行明确批准运行。

## 失败、缺口和下一步边界

| 编号 | 状态 | 已有证据及具体问题 | 后续处理边界 |
| --- | --- | --- | --- |
| GLX-01 | 未解决，主故障 | 完整自构建首包两次黑屏；中文、engine-first 及两个诊断包均出现首开正常、结束微信后重开黑屏。最新失败为 `638674f8`，前轮 `dcd3d486` 保留；历史同包普通重进也有正常与连续失败记录。 | 保留每轮失败，不通过反复重开抹掉失败；不能说 GLX 稳定可用。 |
| GLX-02 | 原始数字返回不一致已确认，根因未定位 | `117e07c5` 的 CopyShader 顶点错误在 `dcd3d486`、`638674f8` 重现。最新 expectedType=35633；原始 JS 有限 number=35632，WASM 结果=35632，arm/take/capture 各 1，排除该次数值转换改坏类型。源码完整相同、原编译错误关联，三个公共 context 均为 1，不认证同一底层 context。 | 异常在 GLX 同步调用返回时已存在；仍需核验创建/查询对象关联、整批响应和 context 状态，平台实际编译输入和对象类型未认证。公开调用参数未见错配，不删除 GLSL、不改 batch 或私有状态。 |
| GLX-03 | 优先线索，未证实因果 | 作者跨资源共享分配、旧库各类型独立编号的差异仍在。新失败记录 program=1、shader=1，且出现顶点请求/片元返回不一致。 | 已有调用方实际编号，仍缺平台对象归属和命名空间合同；同号及类型异常不能单独证明共享 ID 覆盖。 |
| GLX-04 | 自构建输入缺失 | 缺作者修复所用 4.0.10 GLX 静态库原件、来源、SHA256/ABI/许可及完整构建差异。可取得的 0.1.11 库与旧库相同；作者 0.1.0/2026.09.02 标记不是匹配证明。 | 获取可验证库或公开 allocator 接入合同后再重编；不要重复链接旧库并称复现作者修复。 |
| GLX-05 | 原生修复接口缺口 | 旧库无已验证的 allocator 注入或 explicit-ID 创建 API。`glCreateShader` 内部已发送旧 ID 并建立 ShaderInfo，外层改返回 ID 会破坏后续关联。 | 不只加未被 WASM 调用的 JS helper；不改私有 heap、计数器偏移或用少量 opcode 重写整个 batch。 |
| GLX-06 | 已修局部风险，主故障仍在 | loader cleanup 后晚 image/progress/rAF/resize 回调在 fake 环境仍会改 GPU/画布；终态补丁阻止这些副作用。但带补丁中文包强退仍失败。 | 保留补丁及局部测试，不能把它当黑屏根因已修复。 |
| GLX-07 | 已取得反证 | engine-first 候选去掉加载页预建 GLX context/GPU 资源后，强退重开仍黑屏。 | 预建 GPU 资源不是这次故障必要条件；下载、尺寸及其他生命周期行为仍在，不能宣称整个加载页已排除。 |
| GLX-08 | 历史启动失败，另案保留 | 通用适配加载页关闭候选出现“资源下载失败 / i is not a function”，未进入成功引擎场景。弹窗标题不能证明网络下载错误，也不是本次 CopyShader 错误。 | 不重复 `using=false` 作为已成立修复，不用空回调掩盖未知调用者；详见早期手机记录。 |
| GLX-09 | 探针宿主缺陷已处理 | 原生三角形首版因 Safari workaround 裸引用 `WebGLRenderingContext` 阻断。正式编译选项关闭后 WASM 未变，用户确认三角形可见。 | 只证明该包一次首开三角形显示；背景是否变色、重进/强退/恢复未验收，不等于完整 Godot 已修复。 |
| GLX-10 | 独立待修 | 中文 UI 调用 `JavaScriptBridge.eval` 后无条件解析 JSON，而固定微信引擎该接口可返回空 Variant；黑屏日志另有 JSON parse 错误。 | 代码缺陷存在，但不能凭日志唯一确定调用点或把它解释为 shader 错误原因；修复应单独记录，不混入 native 对照。 |
| GLX-11 | 已改善，验收不全 | 早期英文小字和按钮被灵动岛/微信 UI 遮挡；中文大字、固定“读取诊断”及折叠更多测试已做，首开收到正常反馈和手动摘要。 | FPS/vConsole 覆盖、不同安全区、横屏与极小窗口未完整验收；电脑布局不代替真机。 |
| GLX-12 | 诊断能力边界 | JS framebuffer 绑定返回 undefined、swap 后透明 PNG 都不是已确定黑屏原因。observer 的 `errors` 只覆盖模式/context，不捕获任意引擎 printErr。云采样受时间/条数限制，原会话超时缺日志不等于失败。 | 保留包/会话/操作/画面的一一对应，说明关联强度；不继续无边界加外围日志或用 GPU 查询改变现场。 |
| GLX-13 | 尺寸/呈现及生命周期待验收 | 两份实际 JS 的 `godot_js_display_size_update` 都直接返回 0；显式尺寸设置有另一路径。已有离屏 2D 首开可见，未证明 GLX resize polling、旋转、系统帧缓冲最终呈现与恢复始终正确。 | 不凭源码函数存在、swap 增长或电脑 WebGL resize 通过宣布手机 GLX 通过。 |
| GLX-14 | 最终测试门禁未完成 | 自构建未完成连续 10 次退出重进、3 次前后台恢复，以及冷启动/强退重开、场景切换、触摸、音频和 3D 的完整记录。 | 先修复明确故障再申请有限真机验证；区分返回旧 session 与新进程。不清缓存、不自动回退或重复试开。 |
| GLX-15 | 裁剪/分包阶段未开始 | 未获得稳定完整自构建 GLX。作者 engine/subpack 目录不是本仓库 WASM 分包；当前作者模板不能直接用 split。 | trim 需要源码重编；split 作用于成品 WASM，但需兼容的 WXGameKit 通用适配、对应符号及采集。先稳定完整包，再裁剪，再重新转换/采集/分包验收。 |
| GLX-16 | 最小失败诊断已取得，非修复 | 绕开正缓冲 `glGetShaderSource` 复制，仅首次失败查类型/长度。`dcd3d486` 导出一条完整 3,747-byte JSON，两路源各 1,268 bytes、原错误 218 bytes 均无截断，读取计数各 1。 | 本次该长度的 vConsole 导出可用，不保证 40 KiB 极限或其它设备。平台内部完整返回不可限长，返回文本不等于平台编译输入；不因采集成功关闭 GLX-01。 |
| BUILD-01 | 已修，本地合同通过 | 初始化完成前的非空目录缺可信 stage 即拒绝续编；身份、源码及库核验在写日志/记录/适配前执行。完整旧记录兼容，部分补丁现场不自动修补。只读 Git 禁用 index 自动刷新。 | 14 项合同通过，拒绝路径连续 4 次通过，快照包含 Git index。既有完整引擎未续编，历史记录未改，仍未证明旧成功构建曾受此问题影响。 |
| BUILD-02 | 工程保护差异，非已证实黑屏原因 | Losomz JS 后处理有更严格的 required anchors 和幂等检查；我们部分规则会跳过未匹配锚点，重复处理可能再包装。 | 当前实际产物相关 GLX 路径齐全，无重复处理证据；后续单独增强，不混入 shader 因果对照。 |
| BUILD-03 | 通用续编覆盖缺口，当前候选另有门禁 | `sourceState` 的未跟踪源码扩展名集合不包含 `.cjs`；新观察器脚本被记为 excluded，改动它不会改变通用 stage 指纹。固定补丁 SHA 不能单独证明 live 新文件未漂移。 | 当前独立 stager 已核验全部 3 个新增文件的完整集合及固定补丁字节，明确包含 `.cjs`；候选已通过该门禁。通用续编覆盖应另行修复及测试，本次未改变指纹规则或追改 BUILD，亦非手机黑屏原因。 |

共享 ID、shader 命令及源码处理的具体证据见 [GLX_SHADER_ID_COMPAT_20261023.md](GLX_SHADER_ID_COMPAT_20261023.md)。已观察到的 native 源码处理字面量差异不足以支持修改 Godot shader；作者还有并行 shader 等能力差异，不能将整组引擎表现差异归因于唯一 helper。

## 关键包与人工画面证据

| 包 | 已记录结果 | 证据限制 |
| --- | --- | --- |
| `wxslim-b72eb259cb375ea4a221` | WebGL 首开 `68ff9df2`、重进 `868cdc60` 正常 | 作为已有回退保留，本轮不新增 WebGL 手机测试。 |
| `author-4.7.0.8.1-c4673dd1-r01` | `25354c4f` 首开正常反馈；`933f16da`、`a844daa3` 正常画面与实际 GLX 配对 | 第一条云快照仅早期 unknown。后续用户接受的强退/清缓存正常反馈有效，但缺少完整逐轮次数，不补造验收矩阵。 |
| `selfbuild-glx-phone-9d38ee9a27cec352809e` | 用户反馈批准的两次运行都黑屏 | relay 会话数量不是人工测试次数，不能改写成更多轮。 |
| `native-triangle-phone-91bac1d5fb37be67d1cf` | 首开黑屏/报错，定位 Safari shim 引用缺失 | 初始化链被宿主异常阻断，实际 GLX 未确认，不判 GLX 平台本身不兼容。 |
| `native-triangle-phone-1aa4794e826540179aa1` | 一次首开三角形正常 | 背景变色不确定，无生命周期通过结论。 |
| `selfbuild-glx-loader-terminal-822b187802bc1da8162f` | 用户确认两块白点都正常移动 | 仅首开；UI 可用性问题随后推动中文场景改进。 |
| `selfbuild-glx-cn-a3b9d20dccdd2fbf132d` | `b0f41707` 首开正常、有手动诊断；强退后黑屏 | 黑屏唯一新增云会话 `6548efda` 与时间/操作相容，无画面短码精确关联。 |
| `selfbuild-glx-engine-first-1d284f320d422f6848a9` | `08a0e6e1` 首开两块动画正常；`117e07c5` 强退重开持续黑屏并有 CopyShader 错误 | USB 截图与微信进程重建证据保留；用户粘贴日志明确同包同 session。当前停止状态。 |
| `author-pair-cn-857167c70711a319d489` | 仅静态封存、未运行 | 用户拒绝预编译替换路线，预览申请撤回，不再执行该计划。 |
| `shader-diagnostic-glx-1c5b24923c49bbe61e5d` | 首开 `2c5d1526` 正常，强退重开 `dcd3d486` 用户黑屏；两份完整 vConsole 确认同包实际 GLX，第二份取得类型不一致 | 首开有 Wi-Fi 图/PID；第二次 Wi-Fi 预检超时，无新图/PID，不把用户强退报告写成独立进程证据。手机停止，无云采集。 |
| `shader-type-return-glx-03fa0871dc99f85cc4a2` | 首开 `ba727e5d` 两块动画正常且手动摘要完整；强退重开 `638674f8` 黑屏，原始 number35632 / WASM35632，源码相同 | 两份完整日志关联同包实际 GLX；画面/操作由用户确认，本轮无新截图/PID。只完成批准的两轮，不清缓存、不再重开、无云采集。 |

当前关联设备为 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、实际基础库 3.17.5。此信息仅描述已有记录，不能代替未来运行的现场版本核对。

## 已处理的电脑侧问题及残余边界

- 中文 Windows 路径中的 file URL 解码修正；PowerShell Git 调用改为显式 `git.exe`；Windows 链接 response file 适配已保留。
- 构建身份加入 GLX 库哈希、SDK 关键文件、宿主 Node、源码差异与未跟踪源码；拒绝身份不一致的续编。后续已修 BUILD-01：初始化证据不全时保留目录并拒绝，不能自动重建基线。测试范围见新对照文档，不扩大为全部故障恢复可靠性证明。
- JS、原始 WASM、Brotli WASM 成对校验，源与原件保留；不覆盖旧包。默认 stager 为 WebGL，GLX 显式能力门禁且不静默回退。
- 公共依赖准备处理了 UTF-8、Python 选择、EMSDK_PYTHON、EXIT_RUNTIME、5120 KiB 栈及冻结 cache 的若干变体；流程见 [engine/BOOTSTRAP.md](../engine/BOOTSTRAP.md)。公开 SDK 安装/缓存及链接探针通过不等于已经用这套新 SDK 完整重编并运行第二份 Godot。
- 复制的 Windows Python venv 仍依赖原基础解释器，不能当跨机器可搬运工具链。作者构建输入不全，当前可复现的是已记录自构建配方，不能称精确复现作者修复。
- 官方指南网页被站点安全策略阻止、版本下载曾被 WAF 拒绝，已停止，没有换渠道绕过；这些访问阻断不能当作库不存在或 GLX 不兼容的证据。

## Losomz 核对后的本轮验证

修复最终版本再次执行 `node tests/run.mjs`：**75 个汇总项通过，0 失败**，包含构建门禁及 WebGL/GLX 配置与运行时合同。没有传 `--godot`，未重跑 headless、完整引擎构建、开发者工具或手机。BUILD-01 独立合同 14/14，通过后额外重复拒绝现场测试；`git diff --check` 无错误。它们证明电脑侧合同，没有增加任何真机、裁剪或分包验收次数。

## 检查点 e6df5cd 的提交前验证（历史）

本次运行 `node tests/run.mjs`：**75 个汇总项通过，0 失败**；没有传 `--godot`，本轮未重跑 Godot headless。

另运行原生宿主 fake-wx 合同：13 个场景通过。两个加载页脚本初次误用无 `--source` 的测试命令，按设计拒绝；错误输出保留，没有记成代码回归失败。补齐各自固定 SHA 原件后：terminal 7 个场景通过、engine-first 6 个场景通过。仅固定 loader 在 fake API 中运行，未加载完整引擎、adapter、WASM、微信或手机；不是新真机结果。

```powershell
node tests/run.mjs
node examples/glx-native-triangle/host-contract-tests.cjs
node tests/loader-terminal-tests.mjs --source <固定作者原版loader绝对路径>
node tests/loader-engine-context-tests.mjs --source <固定终态loader绝对路径>
```

源码静态审查未发现需要阻止该次快照提交的私钥/实际 AppID/引擎产物；当时发现 BUILD-01，作为待修问题保存，后续修复见上表。新字体为 41,476-byte 的 Acceptance CJK 子集，附 OFL、NOTICE、来源和修改记录，非作者引擎文件。默认 WebGL 回归合同通过，不由此补记手机 GLX、裁剪或分包验收。

## 记录与接续顺序

1. 先读本表，再读 [自构建记录](GLX_SELFBUILD_20261023.md)、[上下文交接](GLX_HANDOFF_AUDIT_20261023.md)、[shader/ID 核对](GLX_SHADER_ID_COMPAT_20261023.md)。[早期手机记录](GLX_PHONE_VALIDATION_20261022.md) 和 [作者发布包记录](GLX_AUTHOR_RELEASE_VALIDATION_20261023.md) 保留过程状态；其中 building、待授权、尚未预览等段落不能覆盖后续结果及撤回决定。
2. Losomz 源码核对、BUILD-01 修复、两版独立配套重编和电脑回归均已完成；手机结果见最新 TYPE 返回记录，强退黑屏仍在。当前暂停，不再执行新探针或重建。新参考仍为同一旧库，不原样重链后称为新修复；不要重复作者成品替换或无依据的 flush/延时/重建。
3. 手机新预览、换包、运行及新增云部署逐次明确确认。当前不再重开失败现场，不清缓存。恢复到已接受作者包或 WebGL 也要单独确认换包。

**Git 推送只包含可公开的代码、测试与脱敏索引。** 原始包、引擎、私有配置、云响应、截图、进程及原始反汇编保存在原工具仓库忽略目录，不随提交上传；远端读者不能仅凭此提交取得全部原始真机证据。

| 本机忽略目录（相对原工具仓库） | 内容 |
| --- | --- |
| `.local/author-glx-release-20261023-01/` | 固定作者归档、原件、早期候选与验收 |
| `.local/glx-selfbuild-20261023-02/` | 完整自构建输入、源码、配套产物与构建记录 |
| `.local/glx-public-deps-20261023-01/` | 公共工具链、cache 与探针检查 |
| `.local/glx-chinese-phone-20261023-01/` | 中文包及 USB/手机取证 |
| `.local/glx-engine-first-context-20261023-01/` | 当前失败父包、首开/强退验收与用户 vConsole 转录 |
| `.local/glx-handoff-audit-20261023-01/`、`.local/glx-shader-id-audit-20261023-01/` | JS/native 静态审计及缺失输入分析 |
| `.local/glx-author-pair-cn-20261023-01/` | 撤回候选、静态封存及 `preparation/USER_DECISION.json` |
| `.local/glx-checkpoint-20261023-01/` | 本次提交前测试、审查与推送核验记录 |
| `.local/glx-losomz-audit-20261023-01/` | 固定 Losomz 来源、源码/实际产物矩阵、shader 查询合同、BUILD-01 后续测试 |
| `.local/glx-shader-failure-20261023-01/` | 首次失败诊断源码补丁、SDK/构建输入、原生 fixture、失败构建与独立 v2 构建、后续配套审计及本地回归 |
| `.local/glx-shader-type-return-20261024-01/` | 原始 TYPE 返回诊断完整构建、配套审计、WebGL/GLX 包及两轮完整手机日志 |
| `.local/glx-paused-checkpoint-20261024-01/` | 暂停检查点的必要回归、普通推送与远端回读 |
