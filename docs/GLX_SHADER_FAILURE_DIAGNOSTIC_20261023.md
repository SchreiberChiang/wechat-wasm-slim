# 首次 shader 失败关联：自构建诊断候选

接续分支 `codex/glx-selfbuild-20261023`。BUILD-01 修复和 Losomz 对照已保存为 `6fd337b`；该检查点尚未推送。本记录是后续诊断实现与验证，不是 GLX 黑屏修复声明。原失败包和 `117e07c5` 证据保留，作者预编译替换候选不执行。

最新手机结果：后续逐包批准的两轮已完成，首开 `2c5d1526` 正常、强退重开 `dcd3d486` 用户黑屏。两份完整日志同包实际 GLX；首次失败记录证实顶点请求 35633 与同步 batch 片元返回 35632 不一致，两份观测源码完整相同。详见[类型查询不一致和下一步边界](GLX_SHADER_TYPE_MISMATCH_20261024.md)。下文保留各阶段过程，待日志/待第二轮描述不覆盖此最终结果；停止后续手机操作。

## 要区分的问题

`117e07c5` 的 CopyShader 顶点编译错误已证实，但尚未证明类型、源码或共享资源 ID 错配。Godot 打印的 builder 文本不是平台实际输入。此次不改帧提交、像素比例、画质或 GLX 库，只在原有编译失败分支关联：

- 当前 program/shader 编号、请求阶段、variant/specialization、公共 Emscripten context 句柄。
- `GODOT_ORIGINAL`：Godot 当前调用持有的源文本。
- `batchReturnedType` 与 `GLX_BATCH_RETURN`：失败后查询得到的类型及 GLX 字符串返回。
- 原有 InfoLog 与 `PLATFORM_ACTUAL_COMPILE_INPUT.available=false`。最后一项仍没有认证接口，不能从其他字段推导为已取得。

若类型或返回文本不符，可收窄到对象关联/源码链；仍不能直接宣布共享 ID 冲突。若相符，也不能证明平台编译输入与 GPU 对象正确。若接口返回不可用或截断，只记录边界，不继续增加查询。

## 改动及限额

公开实现及复现步骤在 [engine/shader-failure](../engine/shader-failure/README.md)。只在 `WEB_ENABLED && WECHAT_GLX_EXPERIMENTAL` 下编入，实际 GLX 标记为 true 且首次 `COMPILE_STATUS=false` 才激活；普通 WebGL 不新增诊断 GL 查询。

保持原有 InfoLog 查询、错误显示、对象删除及错误返回。先显示原错误，再在删除前最多读取一次 `GL_SHADER_TYPE` 和一次 `GL_SHADER_SOURCE_LENGTH`。无日志分支不增加查询。旧库长度查询已经取得完整 JS 字符串，固定锚点只旁路保存那次返回；不调用有风险的正缓冲区 `glGetShaderSource`，不改 batch 协议或私有 heap。

保留的 Godot 源码和 GLX 返回各至多 16 KiB UTF-8，原始日志至多 4 KiB，最终 JSON 连同转义至多 40 KiB。每个 Module 最多一条 `[WXSLIM_SHADER_FAILURE_V1]`，不持续采样。**这些限制约束诊断的保存和输出，不能限制闭源查询内部返回整份字符串的开销。** 查询可能改变后续批处理时序，但发生在该次失败返回之后。

新增查询的 guard 保留数字异常和 longjmp，普通诊断异常标不可用；原有编译/错误日志调用不纳入吞错范围。源码、返回长度、原始和转换类型、截断状态分开保存，不从截断前缀声称整份源码相等。

## 固定构建输入

| 输入 | 值 |
| --- | --- |
| Godot 源码 | `df3cdd9bc9941a20cb5575d781cde6f937637bcb`（4.7.2 系列） |
| Emscripten | 4.0.10，与原成功构建相同 |
| GLX 静态库 | 原 0.1.11 库，SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |
| 诊断源码补丁 v2 | SHA256 `fff071e50459bb5434b3a14c2d38927d655f632044f4ec0dba96369e8d50fd3b` |
| native header | SHA256 `426bb0cac0c0fafe751d22d0fa33ad791a3f2a89ace10bd3ab21619e80f0f335` |
| native patch | SHA256 `16f04a67f6d7bcb50426c3dd82a8fc100e68570d27c783c5987d942773f58899` |
| 引擎配置 | 完整 profile；single-thread、无 SIMD、thin LTO，原参数不变 |

补丁改六个源码文件：shader 失败分支、新 header、新 Emscripten JS library、新字符串观察后处理、SCsub 引入、`godot_process.js` 调用。构建器原有 Windows 链接 response adapter 单独记录。不能把这些改动说成重现了作者的特殊库。

本机完整输入、补丁、SDK、符号和原始输出保存在原工具仓库忽略目录 `.local/glx-shader-failure-20261023-01/`，不提交引擎二进制或私有配置。

## 已发现并处理的整合问题

1. 准备时曾错误指定 SDK Node 的 `bin/node.exe` 路径。校验停止，复制目录保留；按现场真实的 `node/24.19.0_64bit/node.exe` 完成独立准备，记录在 `PREPARATION.json`。未改原 SDK。
2. 第一份 `build/` 在进入 SCons 前被上游源码测试拦下：原 commit-frame 单元样例不是完整引擎，新增后处理误要求其带字符串 import。该失败目录及日志保留，未修改其 BUILD 来续编。
3. v2 改为候选源码根存在新增 library 时才进入严格锚点检查；上游样例的独立临时目录保持原测试范围，真正候选编译仍要求唯一锚点。重新使用干净的 `source-v2/` 与 `build-v2/`；三项上游源码测试通过后才开始完整构建。
4. 原生微型测试发现 EM_JS 不能直接用预处理三花括号生成 dynCall。最终改用 SDK runtime dynCall 并显式声明依赖，实际执行 WASM 检查，而非仅凭 JS 语法检查。

以上是诊断候选的实现问题，不能写成原手机黑屏根因。旧正常包、失败包、库及原源码未改。

复核还发现通用续编 `sourceState` 不覆盖未跟踪 `.cjs`，已列为 BUILD-03。本候选 stager 不依赖该扩展名过滤：核验完整未跟踪集合，并逐字节比对固定补丁的 3 个新增文件，包括 `.cjs`。当前来源核验须以该独立门禁通过为准，不能泛称构建器已覆盖全部可执行源码。本轮未改变该次构建的指纹规则，也未追改 BUILD 基线。

## 构建与配对结果（2026-10-24）

原后台构建已在北京时间 2026-10-24 00:10:37 完成，进程 exit 0；SCons 用时 48.46 分钟、一次尝试、完整 46 模块。本次接续只读取完成记录，没有再启动、续编或覆盖输出。原始 WASM 为 65,194,086 bytes，Brotli 为 8,649,902 bytes，JS 为 442,517 bytes。

| 产物 | SHA256 |
| --- | --- |
| `godot.js` | `d0bbcec87de80f5d93c0b0af9b8c6b2980ae1b7743e4ad75cff4bbe43b409864` |
| `godot.wasm` | `656550b3ca29294d7219e12fda8104e91aa7997af1d222c07d69eeeba84cc7a6` |
| `godot.wasm.br` | `af5532c0b17d2a400cb130281f89ac6910480ff676472e8057b4b54cb15d472f` |
| 配对身份 | `fa4afcf4bfda337e4848e92f3bc1ce0931973b73cc3be936a10dea0e66b18154` |
| `godot.js.symbols` | `8713f35affcf5e1ab45217a1cfbecfbf9a0eb9a4576c9e75d76fcadb188cda00` |
| `symbols.json` | `ebff7f46cef69161f69d34ce1bfbc0b9c4eb6a233233b516857faff09b45281a` |

`BUILD.symbols` 和构建身份中的 `symbols` 均为 true；符号文件另外核验，不冒充三文件配对清单已覆盖它们。配对审计通过：Brotli 解压与原始 WASM 相同，758 imports、31 exports；新增六个诊断 import 的 WASM 类型与实际 JS 映射一致，唯一字符串观察锚点存在，原 context/commit/flush/swap 路径和九个 GLX 导出保留。

构建仍报告 WebXR 对内部 MainLoop 的依赖和一条 `no output file specified` 提示；构建与产物审计成功，不将这些提示解释为手机 shader 根因。普通后处理的既有可跳过规则仍是 BUILD-02；本次新增诊断锚点严格检查通过。

## 电脑验证结果

| 验证 | 结果及范围 |
| --- | --- |
| 固定上游源码测试 | 3/3 通过；在完整构建前运行 |
| 工具回归 `node tests/run.mjs` | 79/79 通过；未传 `--godot`，不包含 Godot headless 用例 |
| JS 与组包合同 | 18/18 通过（12 项 JS、6 项 stager） |
| 实际 SDK/WASM 异常边界 | 10/10 通过，自有 fixture，不是实际 GLX GPU |
| 完整产物 ABI/后处理/符号静态核验 | 49/49 通过；没有执行目标 GLX |
| 父包及两个新候选逐文件核验 | 通过；父包 27 文件封存一致，新清单匹配，无 DevTools 自动写入差异 |
| 独立开发者工具 WebGL 实际运行 | 启动、实际 WebGL、中文画面、直接与离屏 2D 动画通过 |
| 新配对的诊断按钮、3D、resize、音频 | 本轮未验证；不能借用旧配对通过记录 |

原生自有 fixture：10/10 通过，覆盖首次/重复失败、WebGL 零查询、两种查询的普通 JS 异常、数字异常、真实 C setjmp/longjmp、无日志、真实 C++ 异常及 RAII 清理。它使用 SDK 和自有 GL stub，不加载 GLX 库或运行手机，不能证明实际 GLX 查询结果。

本地 WebGL 包为 `shader-diagnostic-webgl-4f76d3a8382062fe3ea8`，独立窗口 `shader-diagnostic-webgl-fa4afcf4bfda`，会话 `e04841d1`。开发者工具实际基础库 3.15.2；其中 iPhone/iOS/微信字段是模拟器资料，不能作为手机信息。CLI 截图 `screen-01/02.png` 相同，不用于证明运动；`screen-03.png` 中两块白点均改变位置，结合画面和 `actualMode=webgl` 日志确认本地实际渲染。

仍出现已登记 GLX-10 的 JSON parse 错误，未混入 shader 错误，也未以“正常出画面”关闭该问题。`automation_runtime_info` 等待自动化接口超时；原生窗口取景未返回测试窗口，因此没有据此注入点击或影响其他会话。本轮仅完成上述启动/模式/2D 回归，不宣称全部交互回归通过。

所有原始记录在 `.local/glx-shader-failure-20261023-01/`：`build-v2/BUILD.json`、`pair-audit-v2.json`、`native-check/abi-audit.*`、`tool-regression-final.log`、`local-webgl/`、`LOCAL_VALIDATION.json`。完整性最终有效报告为 `INTEGRITY_FINAL_RECHECK.json`：首份 `INTEGRITY_FINAL.json` 将未排序 seal 行与排序列表直接比较，误标整体文件匹配；新报告保留原报告哈希并按同序纠正，未覆盖原报告或任何候选文件。

## 手机方案及批准后的进度

**唯一待测包：`shader-diagnostic-glx-1c5b24923c49bbe61e5d`。2026-10-24 用户已批准一次推送、首开正常后强退微信重开一次，以及 Wi-Fi 截图、进程和完整 vConsole 日志采集；黑屏即停、不清缓存。** `auto_preview` 已返回 success，总大小 9,126,127 bytes；上传后文件和封存清单仍一致，未重发或修改候选。首开已收到正常反馈和 Wi-Fi 画面，完整诊断日志待取得，详见文末；不能把推送成功写成运行通过。

本轮私有记录在 `.local/glx-shader-failure-20261023-01/phone-validation-20261024-01/`，保留 `AUTHORIZATION.json`、`PREVIEW.raw.log`、`PREVIEW.json`。候选内准备时的 `not_run/not_authorized` 元数据维持原字节；以这些后续外部记录描述实际进度。Wi-Fi 已通过现有配对新认证和唯一目标发现预检，无新配对或设置更改；手机取证时还需重新发现/认证，预检不等于已取得截图或进程。

相对当前失败父包 `selfbuild-glx-engine-first-1d284f320d422f6848a9` 的确切变化为：

| 文件 | 改动 |
| --- | --- |
| `engine/godot.js`、`engine/godot.wasm.br` | 同次源码构建的诊断配对；只增加首次编译失败关联，未升级库或改帧提交 |
| `candidate-mode.js` | 包身份改为本候选，模式仍为显式 GLX |
| `candidate-relay.js` | 改为无网络 noop；不产生新云记录 |
| `project.config.json`、`project.private.config.json` | 仅改独立项目名称；AppID、基础库设置等不变 |
| `CANDIDATE.json` | 新配对、固定父包、补丁和逐文件身份元数据 |

中文 PCK、加载页、adapter、场景和其余 20 项父文件均逐字节相同。中文 PCK SHA256 为 `0d4eb4b3f94e60468a271f705b177a2223fe9db6745fb254c388cd21d566ef5b`。帧提交、像素比例、画质、库版本及默认 WebGL 均未改。

具体操作限额：

1. 用户明确批准后，上传这一个预览并替换当前 iPhone 预览；这会结束当前黑屏运行现场，所以批准前保持现状。已有失败证据与原包继续封存。核对现场设备、微信及实际基础库版本。
2. 只首开一次约 20 秒；记录包、会话、实际模式、两块动画及画面。若黑屏或报错立即停止。若画面正常且实际 GLX 可确认，才上滑结束微信、进入同一包一次约 20 秒，不清缓存、不重新扫码换包，不额外重试。
3. 每轮保留该会话完整 vConsole 日志；如失败，导出必须包含身份/会话标记、原始错误和唯一 `[WXSLIM_SHADER_FAILURE_V1]`。不是只复制屏幕截短的一行。按本次批准使用 Wi-Fi 只读截图与进程取证，用于将画面/新旧进程与会话对应；不主动操作其他手机应用。完整 vConsole 无已验证自动采集通道，需要用户从当前面板导出；不使用系统日志冒充。
4. 收到日志后核验诊断 JSON 可解析、长度及截断/不可用标记，再比较对象编号、请求/返回类型、原源码/GLX 返回和公共 context。shader 记录本身不含包/会话 ID，必须靠同次完整日志关联；三个 context 采样值都检查，不能仅靠 `publicContextChanged` 推断未发生中间切换。

本包没有云传输，不能承诺直接从旧云 relay 读到新诊断；旧 relay 的截断与标记白名单也不足以原样运送此记录。vConsole 对此长度的实际导出能力仍待验证，缺失或截短时记“采集不可用”，不临时升级采集、不重复重开。若用户要求云读取，应先另备有明确总量/条数的传输候选，再单独确认，不能悄悄恢复旧 relay。

本方案最多两次运行，必要时各一次日志导出和只读截图/进程记录，不含云部署、新云采集、自动回退或清缓存。回退可使用保留的原正常包，但换包仍需另行确认。新增查询发生在首个已确认失败之后，可能影响后续批处理时序；即使此次不失败，也只说明本轮未复现，不能证明修好共享 ID 或平台实际编译输入。

即使 shader 错误不再出现，[问题总表](GLX_ISSUES_20261023.md) 中 GLX-01、呈现/恢复、触摸/音频及完整验收门禁仍未关闭。稳定完整自构建引擎之后，才验证裁剪和分包。

### 已批准首开的画面取证

用户回复“正常”。一次 Wi-Fi 只读采集于北京时间 2026-10-24 00:33:52–00:34:06 完成，临时连接正常关闭；画面短码为 `2c5d1526`，实际上下文标签显示 GLX，直接 2D 与离屏 2D 两块内容均可见。截图 SHA256 `b8f3ecefb5ee57a86611efd01f158e63376884b3ca852151efd24645f4d8b043`。用户是回答动画问题时回复正常；单张截图本身不独立证明持续运动。

当前 WeChat PID 25999，开始时间 2026-10-23 21:12:51.347+08，与先前失败后的微信进程一致。这次是新包首开场景，不能算微信进程冷启动或强退重建已通过。此次设备重新认证为 iPhone17,1 / iOS 18.3.1；微信与实际基础库版本仍待本会话完整日志核对，不沿用历史值当新证据。

`FIRST_OPEN.json` 和 `first-01/` 保存用户原话、截图、过滤进程及采集边界。包身份目前由唯一获批预览与用户打开操作关联，完整 entry/scene/manual 日志待取得；尚未读取新的 shader 记录，不能声称无 shader 错误。先保留本次完整 vConsole 日志，再进入已经批准的一次强退重开，不新增轮次、换包或云采集。
