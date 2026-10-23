# GLX shader 对象关联与共享 ID 核对

后续查询实现核对见 [Losomz 对照与 shader 取证边界](GLX_LOSOMZ_COMPARISON_20261023.md)：参考仍链接同一旧库，没有补足共享 allocator。类型/源码请求经同步 batch 返回；旧源码复制存在边界缺陷，不能不加核对直接读回。可设计失败后一次性 JS 字符串返回观察，尚未实现或上手机。下文作者候选准备部分为撤回前的历史，不是当前执行计划。

最新决定：用户不采用作者预编译引擎替换方案。`author-pair-cn-857167c70711a319d489` 的预览申请已撤回，不运行或推送，原件仅作静态参考。继续完成可自构建、可裁剪并可进入现有分包流程的 GLX 适配；不能用作者成品包替代这一交付。当前黑屏现场保留。

2026-10-23。接续 [上下文交接与失败证据](GLX_HANDOFF_AUDIT_20261023.md)。本轮只做电脑侧静态分析、独立候选组包和自有桥接代码的模拟测试，未运行作者引擎、推送预览、操作手机或查询云端。当前黑屏现场保留。

**结论：作者最终引擎确实具有旧库缺少的共享资源 ID 分配路径；尚未证明失败会话发生了 ID 冲突。** 已沿 shader 创建、源码、编译、program 附着及查询链路核对，未发现直接调换 shader 类型或 ID 的指令。当前公开输入不足以在旧库中实现可维护的共享分配修复。本轮准备整组作者 JS/WASM 对照候选，不能称为已修复的自构建引擎。

## 固定比较对象

- 作者实际发布归档：[minigame4.7.0.8.1.tpz](https://github.com/hao0917/godot-minigame/releases/tag/4.7)，SHA256 `c4673dd16b397be7c6bcd0c9bd038d20008be5b4586cdaea60be552326a50be7`。本轮重新核对发布资产 digest，并从该归档直接读取配套文件。
- 自构建：Godot `df3cdd9bc9941a20cb5575d781cde6f937637bcb`、Emscripten `4.0.10`、实际静态库 SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`。来源与构建方法见 [engine/README.md](../engine/README.md)。
- 失败包 `selfbuild-glx-engine-first-1d284f320d422f6848a9`：同一包首开 `08a0e6e1` 正常，结束微信进程后 `117e07c5` 黑屏。后者由用户粘贴的同包、同 session vConsole 确认 CopyShader 顶点编译/绑定失败。`errors: []` 仅表示模式/上下文检查未报错，不表示引擎无错误。
- 作者 `0.1.0 / 2026.09.02` 与旧库 `0.1.11 / 2025.12.05` 是构建标记，不能按版本号大小推出兼容性。

| 文件 | 作者 SHA256 | 自构建 SHA256 |
| --- | --- | --- |
| JS | `12361da76c9702ed3d72ad8a4ea6ba4e9d930ee9de706d47039c6b38f8850644` | `b5710406a1fb9005692658a9d7a826085588213e7d50552b587fffa0ca579738` |
| 原始 WASM | `1929f30fd3d59497a5e49a0e2ef8a971cbeb9ec821d29c71720df4d9eaba3cfd` | `67f58828b85a79769f9b74303d9153c757a707990b75cb39df8393bb61482718` |
| Brotli WASM | `ea554073f5c6357fada5fb65749ba38793137d46d5b0639180389df032fb1a4c` | `4213a38841ea1848fe93e0a9e5262442a66d0a931b18d2644f8299a4112cf92c` |

## shader 对象、类型、源码如何关联

以下为固定哈希最终 WASM 的定点反汇编，以及旧静态库的具名函数检查。表中的数字是本次观察到的内部命令值，只用于复核，不是可依赖的公开协议。

| 环节 | 两份最终产物中观察到的行为 | 差异或限制 |
| --- | --- | --- |
| `glCreateShader(type)` | 创建命令 `[11, type, shaderID]`；以同一 ID 建立 ShaderInfo，并保留输入类型 | ID 分配实现不同，见下节 |
| `glShaderSource(shader, ...)` | 命令 `[12, shaderID]`；合并传入字符串，经过 layout/binding 解析、源码处理，再写入字符串缓冲 | Godot 打印的 builder 不等于平台实际收到的源码；未取得失败现场的原生编译器输入 |
| `glCompileShader(shader)` | 命令 `[15, shaderID]`，未发现改编号 | 两份目标函数均为 83 bytes；不据此推断整个库相同 |
| `glGetShaderiv` / 日志 | 查询携带同一 shader ID；`SHADER_TYPE=35663` 走同步整数查询；编译状态与日志有各自路径 | 未在手机读取实际 SHADER_TYPE；Godot 的“Vertex”标签只是调用方预期 |
| `glAttachShader(program, shader)` | 命令 `[16, programID, shaderID]`；按 ShaderInfo.type 的 35633/35632 填入 program 的顶点/片元成员 | 未发现该路径把类型交换；内部元数据仍不能代替平台对象类型 |
| `glLinkProgram(program)` | 命令 `[17, programID]`；使用已附着 shader 的 binding 元数据 | 作者另有并行 shader / KHR completion 状态支持 |
| 删除 | 删除相同 ID 对应状态并发送 shader `[41, id]` / program `[81, id]` | 不证明平台生命周期及进程重建后的命名空间行为 |

Godot 固定源码 `drivers/gles3/shader_gles3.cpp` 第 317 行请求 `GL_VERTEX_SHADER`；第 356 行处理编译失败，然后才是第 365 行片元创建。CopyShader 用于最终 render target 到系统帧缓冲的拷贝，绑定失败会跳过相关拷贝。该错误能解释为什么主循环和场景已运行仍可能看不到画面，但还没有定位导致错误的底层原因。

打印源码符合预期顶点阶段结构：`#version 300 es`、`layout(location = 0) in vec2 vertex_attrib`、`gl_Position`。当前错误与对象/阶段关联异常相容，也不能排除平台实际收到的源码不同。没有独立编译验证这份完整源码，没有证据支持把 Godot 顶点源码改成片元语法或降级 GLSL。

旧 `Util::replaceShaderCode` 全部字符串重定位为 `UNITY_LOCATION`、`UNITY_BINDING`、`#define`、`UNITY_UNIFORM`、`uniform`、`inout`、`out`。其参数是字符串，没有 ShaderInfo/type；未见直接比较 35633/35632。`parseLayoutDirectives` 直接匹配 UNITY 标记，维护 binding/location 元数据。作者与旧产物这条路径的有意义字面量集合相同，未发现 `#version`、`gl_Position` 或顶点/片元互换的直接改写依据。尚未完整证明各分支等价，尤其不能由字面量相同推断所有普通源码逐字保留。

## 共享分配的实际差异

作者 `glCreateProgram`、`glCreateShader`、`glGenBuffers`、`glGenTextures` 均取得同一 GlState，再调用同一内部 helper f5862：

1. 初始化探测 `Module.wxContextGlobal.fetchAndIncId` 是否为函数。
2. 可用时，经 native import 同步取共享 ID，创建命令、内部表和返回值使用这个 ID。
3. 不可用时，以上四类资源仍共用 GlState 的一个回退计数器。

旧库四类资源分别从自己的计数器取值，构造初值均为 1。跨类型出现同号在结构上可能；但普通 GL 的对象命名空间规则不能直接套到私有 GLX 平台对象表，也不能仅凭同号可能性认定冲突。失败会话没有保存实际分配值、平台 shader 类型及实际源关联，所以**共享分配差异是优先兼容线索，仍非已确认根因**。引擎首次创建上下文的失败结果说明，加载页预先创建 GLX 上下文和 GPU 资源不是本次故障的必要条件；加载页的下载、尺寸和生命周期行为仍存在。

作者还新增 `evalGetGameGlobalUsedParallelShaderCompile` 和 `evalGetKHRCompletionStatus`；后者调用平台的 program completion 查询。整组作者引擎对照同时带入这些差异，因此即便新候选正常，也不能把改善全部归因于共享 ID。

## 为什么本轮不对旧库做伪修复

旧库公开 GL 创建入口，链接器支持 `--wrap`，但未发现可验证的公开 allocator 注入或指定 ID 创建接口。`__real_glCreateShader` 已经用旧 ID 发命令、建 ShaderInfo；外层另外取共享 ID 并返回，会使后续 source/compile/attach 使用的 ID 与实际对象脱节。添加两个 JS helper 也无效：旧 WASM 没有对应调用点。

不改私有 heap 偏移、计数器初值或闭源对象布局，不按少量已知 opcode 重写整个 batch。若要可维护地重编，需要作者配套的 Emscripten 4.0.10 静态库及哈希/ABI，或供应商公开 allocator callback / explicit-ID API，覆盖相关资源创建、查询、删除及初始化顺序。

本轮 GitHub 发布资产仍只有两个 TPZ，固定作者树 `099277108e30c0af92bcbbbe7171fa073ae37606` 未列出 `.a`；固定 Godot 源码中的 4.0.10 库仍是旧哈希。这仅说明已检查来源未提供所需库，不宣称互联网不存在。官方指南页面访问被浏览器站点安全策略阻止，已停止，没有换通道绕过。

## 已准备的完整引擎对照候选

包：`author-pair-cn-857167c70711a319d489`。状态：**用户已拒绝该替换路线，预览申请撤回；仅静态保留，未运行第三方引擎、未预览、未验收**。

独立目录为原工具仓库 `.local/glx-author-pair-cn-20261023-01/`。父包仍为失败的 engine-first 包。27 个文件中 22 个原样保留，改动仅为：

- `engine/godot.js` 与 `engine/godot.wasm.br` 整组换为上述实际 TPZ 内的原始字节。没有拼装单个库、修改其源码或二进制。
- `candidate-mode.js` 只替换身份数据，标明 `origin: author-release`，旧自构建身份保存在独立 `parentPair` 字段。
- `candidate-relay.js` 只替换包标识；既有传输、60 秒和最多 10 条逻辑记录的限制不变。
- `CANDIDATE.json` 更新配套来源、输入哈希和逐文件清单。

中文场景、PCK、SDK、adapter、入口、配置、observer、加载页不持有 GLX GPU 对象的策略全部不变。历史内部日志前缀 `SELFBUILD_CANDIDATE` 为保持观察器不变而保留；实际包 ID 与 identity.origin 是来源依据，不能从旧前缀认定它是自构建。没有新增 GPU 查询、延时、flush、强制重建上下文或云记录。

这不是之前手机正常的作者整包原样重发，而是“失败宿主＋作者配套完整引擎”的单因素层级对照。它能检查完整引擎差异是否足以改变该宿主的行为，不能单独定位库内某个差异，也不代表已复现作者的构建。

| 封存项 | SHA256 |
| --- | --- |
| 候选完整 tree | `91d40461261c1736cdff7e165935e2e61e12489b1117d5c9830754d55e60c603` |
| CANDIDATE 清单 | `ce7814bcbd02a047a3bf3cf0ba175a8ec25858eef1668885213152ccaa654d8c` |
| 外部 PHONE_SEAL | `188d269e59aa42a84068af864846d06b56bbd52da6e4aba3c43c2b0b18331a65` |

## 本地验证与复核

在原仓库执行以下脚本，只读核对候选；合同测试仅运行本项目自己的 mode/observer，并使用 fake wx，不执行作者 JS/WASM/SDK/adapter/relay：

```powershell
node .local/glx-author-pair-cn-20261023-01/preparation/prepare-candidate.mjs --check
node .local/glx-author-pair-cn-20261023-01/preparation/check-diff.mjs
node .local/glx-author-pair-cn-20261023-01/preparation/check-contracts.mjs
```

- 来源、27 文件清单、5 个精确差异、Brotli 解压后 WASM 哈希通过。再次写入已有输出被明确拒绝，父包及新候选均未改变。
- 7 个模式/身份合同检查通过：作者与父引擎身份分开、能力不足阻断、缺运行时保持 pending、实际 WebGL 明确失败、native ID 缺失或不匹配失败，以及 GLX 描述符匹配不冒充可见画面成功。
- 没有修改默认转换器、构建配方、裁剪或分包实现；本轮没有重复此前 75 项工具回归，也未新增第三方引擎运行或手机结论。它们不能替代这份候选的真机验收。

原始定点反汇编、脚本及审计结果在原仓库 `.local/glx-shader-id-audit-20261023-01/`，重点为 `native/REPORT.md`、`native/SOURCE_TRANSFORM_REVIEW.md`、`recipe/REPAIR_OPTIONS.md`、`PUBLIC_SOURCE_CHECK.json`。候选准备脚本、清单和检查结果在独立候选的 `preparation/`。原归档、成功包、失败包、日志和源码均保留。

## 下一轮门禁、回退和上游问题

私有 `preparation/PLAN.md` 保留已撤回的历史两轮预览方案，`USER_DECISION.json` 记录不执行。本轮不再请求该作者 pair 预览。后续应补齐可链接的修复版 GLX 库及构建输入，或找到有完整合同的 allocator 接入方法，再生成自构建候选；缺少这些输入时明确说明阻塞，不能重复推送作者成品替代。

裁剪与分包的边界不同：本仓库 `trim` 通过源码重编和 `build_profile` 去掉 Godot 模块/类，不能直接把作者已链接 WASM 当作该流程的源码。若取得配套 GLX 静态库，通常无需重编闭源 GLX 本身，也可在重编 Godot 时链接它，但仍需验证 ABI、实际修复行为和配套 JS。`split` 作用于编译后的 WASM，不要求它必须由本机编译；当前工具仅支持 WXGameKit 通用适配工程，需要兼容引擎及对应符号表、转换、官方 init、真机采集与验证，当前作者模板包不能直接接此流程。裁剪后引擎身份变化，必须重新分包采集，不能复用旧结果。依据为 [主说明](../README.md)、[分包流程](../split/README.md) 和 [输入检查](../convert/lib/inputs.mjs)。这些能力是最终目标，不是现有 GLX 已通过的结论。

代码侧回退无需覆盖任何引擎：此候选完全在独立目录，默认 WebGL 未改。当前失败包、先前作者正常包和 WebGL 可玩包都保留；手机回退需要另行确认换包，不自动推送。完整引擎稳定前不推进裁剪、分包或赛车。

如果需要上游协助，最小问题是：提供该发布包所用 4.0.10 静态库来源、哈希、许可和编译/JS import 配套；说明 `fetchAndIncId` 的命名空间、生命周期及进程重建语义；说明不可用时各资源能否独立编号；提供查询失败 shader 实际类型、准确源码及所属 context 的受支持方式。现有材料记录了符合预期顶点阶段结构的 builder、实际 GLX 以及编译错误，不能替上游证明平台 shader 对象被错配。本轮未向任何第三方发送消息。
