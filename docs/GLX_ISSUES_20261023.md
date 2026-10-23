# GLX 问题总表与接续入口

状态截点：2026-10-23，用户要求先记录现状，再提交推送。此次是成果与失败现场的代码快照，**不是稳定 GLX 修复发布**。提交分支为 `codex/glx-selfbuild-20261023`，从 `8b59fe9` 接续；原工作区 `codex/glx-adaptation-20261022` 保留。默认 WebGL 不变，不改赛车、服务器、证书，不合默认分支，不新增手机预览、云端操作或第三方联系。

最终目标仍为：可自行构建的配套 Godot JS/WASM 与符号，真机实际 GLX 正常显示，首次启动、小游戏退出重进、结束微信进程后重开及前后台恢复稳定，然后验证裁剪、通用适配和 WASM 分包。作者成品可作静态参照，不能替代这项交付。

## 目前能够确认什么

- 同输入 WebGL 曾有首开、重进正常的真机对照；当前默认继续为 WebGL。
- 作者实际发布版在若干已关联会话中确认实际 GLX 和正常画面，用户后续也接受过清缓存、结束微信重开。没有完整逐轮记录的反馈不计入连续验收次数，不扩大为所有设备保证。
- 完整自构建引擎能编译、配套校验并在本地 WebGL 正常显示，但 **GLX 稳定性未通过**。最新同包首开正常、结束微信后黑屏，已取得同会话 shader 编译错误。
- 共享 ID 分配是已确认的实现差异；平台 ID 冲突、shader 对象类型错配仍是待证实原因。不能用初始化、FPS、场景回调、batch/swap 或空 `errors` 列表替代画面。
- `author-pair-cn-857167c70711a319d489` 仅静态准备，用户已拒绝该预编译替换路线，确认申请撤回，**不运行、不推送**。当前手机黑屏现场继续保留。

## 失败、缺口和下一步边界

| 编号 | 状态 | 已有证据及具体问题 | 后续处理边界 |
| --- | --- | --- | --- |
| GLX-01 | 未解决，主故障 | 完整自构建 GLX 首包用户报告两次黑屏；后续中文包与 engine-first 包均出现首开正常、结束微信进程后重开黑屏。历史同包普通重进也有正常与连续失败记录。 | 保留每轮失败，不通过反复重开抹掉失败；不能说 GLX 稳定可用。 |
| GLX-02 | 已确认错误，原因未定位 | 最新黑屏会话 `117e07c5`：CopyShaderGLES3 顶点编译失败，包含 `Invalid use of layout 'location'`、`gl_Position` 未声明，随后绑定失败。Godot 请求的是顶点 shader；打印 builder 不是平台实际收到的源码。 | 核对实际 shader 对象、类型、源码及 context 的受支持读回，或有来源的 native 修复；不删除有效阶段结构或降级 GLSL来消音。 |
| GLX-03 | 优先线索，未证实因果 | 作者 Program/Shader/Buffer/Texture 共用分配 helper，可调用 `fetchAndIncId`，回退也共用计数器；旧库各类从 1 分别编号。创建、传源、编译、附着、查询链未发现直接调换类型/ID。 | 缺失败会话的实际 ID 和平台对象关联；不能把跨类型同号可能性直接定为平台冲突。 |
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
| BUILD-01 | 本次静态审查新发现，P2，未修 | `trim/lib/build.mjs` 先保存 identity，再 clone/apply patches，最后才保存 `rec.stage`。若应用补丁期间中断，重跑可能因 engine 目录存在跳过补丁、又因 `rec.stage` 缺失跳过比对，将不完整 stage 当基线。 | 暂不续用“engine 已存在但无 stage 基线”的目录，保留现场并使用新目录。后续增加初始化完成门禁/完整补丁核验及故障恢复测试；尚未证明既有成功构建受影响。 |

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

当前关联设备为 iPhone 16 Pro、iOS 18.3.1、微信 8.0.75、实际基础库 3.17.5。此信息仅描述已有记录，不能代替未来运行的现场版本核对。

## 已处理的电脑侧问题及残余边界

- 中文 Windows 路径中的 file URL 解码修正；PowerShell Git 调用改为显式 `git.exe`；Windows 链接 response file 适配已保留。
- 构建身份加入 GLX 库哈希、SDK 关键文件、宿主 Node、源码差异与未跟踪源码；拒绝身份不一致的续编。仍有 BUILD-01 的初始化中断缺口，不称为完整可靠恢复。
- JS、原始 WASM、Brotli WASM 成对校验，源与原件保留；不覆盖旧包。默认 stager 为 WebGL，GLX 显式能力门禁且不静默回退。
- 公共依赖准备处理了 UTF-8、Python 选择、EMSDK_PYTHON、EXIT_RUNTIME、5120 KiB 栈及冻结 cache 的若干变体；流程见 [engine/BOOTSTRAP.md](../engine/BOOTSTRAP.md)。公开 SDK 安装/缓存及链接探针通过不等于已经用这套新 SDK 完整重编并运行第二份 Godot。
- 复制的 Windows Python venv 仍依赖原基础解释器，不能当跨机器可搬运工具链。作者构建输入不全，当前可复现的是已记录自构建配方，不能称精确复现作者修复。
- 官方指南网页被站点安全策略阻止、版本下载曾被 WAF 拒绝，已停止，没有换渠道绕过；这些访问阻断不能当作库不存在或 GLX 不兼容的证据。

## 本次提交前验证

本次运行 `node tests/run.mjs`：**75 个汇总项通过，0 失败**；没有传 `--godot`，本轮未重跑 Godot headless。

另运行原生宿主 fake-wx 合同：13 个场景通过。两个加载页脚本初次误用无 `--source` 的测试命令，按设计拒绝；错误输出保留，没有记成代码回归失败。补齐各自固定 SHA 原件后：terminal 7 个场景通过、engine-first 6 个场景通过。仅固定 loader 在 fake API 中运行，未加载完整引擎、adapter、WASM、微信或手机；不是新真机结果。

```powershell
node tests/run.mjs
node examples/glx-native-triangle/host-contract-tests.cjs
node tests/loader-terminal-tests.mjs --source <固定作者原版loader绝对路径>
node tests/loader-engine-context-tests.mjs --source <固定终态loader绝对路径>
```

源码静态审查未发现需要阻止本次快照提交的私钥/实际 AppID/引擎产物；发现 BUILD-01，明确作为待修问题保存。新字体为 41,476-byte 的 Acceptance CJK 子集，附 OFL、NOTICE、来源和修改记录，非作者引擎文件。默认 WebGL 回归合同通过，不由此补记手机 GLX、裁剪或分包验收。

## 记录与接续顺序

1. 先读本表，再读 [自构建记录](GLX_SELFBUILD_20261023.md)、[上下文交接](GLX_HANDOFF_AUDIT_20261023.md)、[shader/ID 核对](GLX_SHADER_ID_COMPAT_20261023.md)。[早期手机记录](GLX_PHONE_VALIDATION_20261022.md) 和 [作者发布包记录](GLX_AUTHOR_RELEASE_VALIDATION_20261023.md) 保留过程状态；其中 building、待授权、尚未预览等段落不能覆盖后续结果及撤回决定。
2. 电脑侧优先补齐可链接修复库/公开分配合同或受支持的 shader 关联证据；先修 BUILD-01 再依赖异常中断续编。新目录重编完整 JS/WASM/符号，配套及 WebGL 本地回归通过后，另报精确候选和真机方案。不要重复作者成品替换、无依据的 flush/延时/重建或错误源码改写。
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
