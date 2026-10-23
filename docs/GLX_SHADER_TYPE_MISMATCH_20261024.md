# 自构建 GLX 强退重开：shader 类型查询不一致

2026-10-24。接续[首次失败诊断配方和本地结果](GLX_SHADER_FAILURE_DIAGNOSTIC_20261023.md)。本轮完成用户批准的同包首开和结束微信后重开，第二次用户再次确认黑屏。**已取得顶点请求与 GLX 片元类型返回的不一致；黑屏未修复，共享 ID 冲突仍未证实。** 停止后续手机运行、换包和清缓存，默认 WebGL、赛车和服务器未改。

## 包与会话核对

唯一获批、实际推送包为 `shader-diagnostic-glx-1c5b24923c49bbe61e5d`。两份完整 vConsole 的 ENTRY/SCENE 都标识该包，父包均为 `selfbuild-glx-engine-first-1d284f320d422f6848a9`，两轮均为请求 GLX、能力 true、selected/actualMode 为 GLX，不是静默回退 WebGL。配对身份仍为 `fa4afcf4bfda337e4848e92f3bc1ce0931973b73cc3be936a10dea0e66b18154`。

| 项目 | 首开 | 结束微信后重开 |
| --- | --- | --- |
| 原始导出文件 | `vconsole_1792773064686.log` | `vconsole_1792773619438.log` |
| 原始字节数 / 行数 | 3,873 / 24 | 10,101 / 89 |
| SHA256 | `3dae42c372d71efdac561365c5cd03722c34070117bec36d66706a8cad4f7242` | `1bf54fbd68dfeb0265b47190192df09e0f1a8e153142d14399e7ccafb9b01c69` |
| 会话 | `2c5d1526`（ENTRY 第 2 行，SCENE 第 22 行） | `dcd3d486`（ENTRY 第 2 行，SCENE 第 87 行） |
| 用户画面反馈 | 正常 | 第二次依然黑屏 |
| 画面取证 | Wi-Fi 截图同码，GLX 标签及直接/离屏 2D 可见 | Wi-Fi 预检超时，未取得新截图；黑屏依据用户反馈 |
| 导出中的 shader 失败诊断 | 0 条，未见 shader 编译错误 | 1 条完整 JSON，第 80 行 |
| 其它错误 | JSON parse 错误仍在 | 同一 JSON parse 错误仍在 |

两份日志中的设备描述一致：iPhone 16 Pro / iPhone17,1、iOS 18.3.1、微信 8.0.75、实际基础库 3.17.5，基础库标记 `2026.10.21 11:45:04`。设备描述本身不识别唯一手机，结合本次授权、预览、配对认证及用户操作建立关联。两份日志均无 manual 事件，不把按钮点击假定为已完成。

首开的微信 PID 为 25999，沿用此前已存在的进程，因此首开不计为微信冷启动。用户明确报告第二次结束微信后重开；新日志证明新小游戏会话，但本轮未取得新 PID，不将用户操作报告扩写为进程重建已独立核验。只进行一次第二轮只读取证，50 秒总限额内在 `verify-tool-and-wifi-only` 阶段 TimeoutError，未进入 DVT/进程/截图阶段，未重试。这是取证连接失败，不是 GLX 失败原因。

## 唯一首次失败记录

第 71 行先输出 `CopyShaderGLES3: Vertex shader compilation failed`，第 72–75 行为原始编译错误，第 80 行为新增诊断；随后仍出现 shader 绑定失败。诊断 JSON 为 3,747 UTF-8 bytes，完整可解析，未触发 40 KiB 输出截断。

| 字段 | 实测值 | 含义 |
| --- | --- | --- |
| `program` / `shader` | 1 / 1 | 两类对象编号；仅凭同号不能认定冲突 |
| `expectedType` | 35633 / `GL_VERTEX_SHADER` | Godot 此次请求的是顶点阶段 |
| `batchReturnedType` | 35632 / `GL_FRAGMENT_SHADER` | 同一 shader 的类型查询经 GLX 同步 batch 返回片元枚举 |
| 原始源码 / GLX 返回源码 | 各 1,268 UTF-8 bytes | 两份完整字节相同，均未截断 |
| 源码 SHA256 | `579b7feda3b663171d67e4ac59808a2d618d3b0971634d2acc03f2ac941ce64f` | 两份观测文本相同，不认证平台编译器实际输入 |
| 原始 InfoLog | 218 bytes，未截断 | 与第 72–75 行原始错误重建文本完全相同 |
| 失败 / 错误 / 查询后 context | 1 / 1 / 1 | 三次公共 Emscripten 句柄采样一致，不认证平台内部 context |
| arm / string import / observation 次数 | 1 / 1 / 1 | 本条关联未出现额外读取或重复回调 |
| 平台实际编译输入 | unavailable | 本轮未突破该边界，不从其它字段推导已取得 |

第 18–70 行打印的 53 行 builder 以 LF 重建，也与 `GODOT_ORIGINAL` 完整相同。原错误仍为 `Invalid use of layout 'location'`、`vertex_attrib` 和 `gl_Position` 未声明。这组错误与顶点文本被按其它阶段处理相容，但没有直接证明平台编译对象就是片元对象。

本诊断只认领每个 Module 的首次编译失败，因此一条记录不代表仅发生一次编译失败。首开未见诊断也不扩大为全引擎零错误证明。两轮都有 scene、frame_post_draw 和 Engine started，黑屏轮照样到达这些点；它们仍不能作为画面验收。

## 类型值来源的电脑侧复核

固定 SDK 的 `GL_SHADER_TYPE=0x8B4F=35663`、`GL_VERTEX_SHADER=35633`、`GL_FRAGMENT_SHADER=35632` 均核对正确。诊断向 `glGetShaderiv` 传同一 shader、`GL_SHADER_TYPE` 和初始化为 `INT_MIN` 的 `GLint*`，记录层直接保存返回值，没有阶段映射。

旧库 SHA256 仍为 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`。具名反汇编确认该查询分支调用 `BufferData::flushSyncInt`，返回 i32 写入 `params`；没有从本地 `ShaderInfo.type` 取值。`flushSyncInt → JsBinding::flushSyncInt → evalBatchRenderSyncInt`；最终配套 JS 直接返回 `Module.wxContextGlobal.batchRender(Uint32Array view)`。35632/35633 不涉及符号位或数值精度问题。

旧库创建、传源、编译和查询继续使用同一 shader ID。已检查的发送端未发现 type/id 或 shader/program 参数互换。内部编码仅作为静态核对证据，不能据此自行改写未公开 batch 协议。静态原件在 `.local/glx-shader-id-audit-20261023-01/native/` 的 `old-main-resource-create.dis.txt` 和 `old-main-shader-chain-symbolic.dis.txt`；实际配对在本轮 `build-v2/`。

进一步只读核对固定候选实际 adapter、SDK、最终 JS 以及已固定的公开后处理，接口边界为：

```text
wx.createCanvas()
  → canvas.getContext("wxwebgl2", attributes)
  → returnedContext.emscriptenGLX
  → Module.wxContextGlobal.batchRender(Uint32Array[, extraBinaryData])
```

adapter 没有实现或替换原生 getContext；引擎注册桥从返回对象取得 `emscriptenGLX` 并复制描述符。实际 SDK 不含该 batch 分派，最终 JS 只有调用，没有对象表、shader opcode 分派或阶段映射实现。已有 Losomz 参考亦提供注册桥和模拟描述对象，不包含微信平台的分派实现。**本次没有找到有证据支持修改的公开参数错配，停止在平台接口边界。**

## 结论与下一步

目前最明确的异常在 GLX 类型查询/对象关联或其下游返回路径：Godot 请求顶点，查询返回片元。这比先前仅有编译错误更具体；源码读回完整一致，不能继续以“读回截断或文本不同”解释本条记录。

尚未确认哪一层使类型响应不一致。共享 ID 的实现差异仍是线索；program/shader 同号不是冲突证明。返回文本也可能是平台某一层保存的源码，不能认证提交时的实际编译输入、底层对象类型或对象所属 context。

不在缺少合同的情况下修改私有 heap、计数器、batch 编码、GLSL 声明或加入延时，也不换成作者预编译 WASM。要做可维护的源码修复，下一步需要 GLX 供应方/上游回答以下最小问题，或提供可核验的对应源码/静态库：

1. 创建请求为 `GL_VERTEX_SHADER` 时，为何该 shader 的 `GL_SHADER_TYPE` 同步查询返回 `GL_FRAGMENT_SHADER`？该返回来自哪一层对象表/缓存/getter，如何验证与编译对象为同一对象？
2. shader/program/buffer/texture 的 ID 命名空间是否共用？结束微信进程后初始化的资源编号、context 生命周期与 `fetchAndIncId` 有什么受支持合同？旧库各类型独立编号是否被当前 iOS 实现支持？
3. 如何通过受支持接口取得平台实际 shader 类型、准确编译输入和 context 关联？若需要新版库，提供 Emscripten 4.0.10 配套库、SHA256/ABI、许可及所需 import/初始化步骤。

可复现材料已具备：固定源和工具链、旧库哈希、完整 JS/WASM/符号、唯一诊断源码补丁、同包首开/重开日志、一次正常画面及黑屏人工反馈。操作为同包首开正常后结束微信进程、重进一次，不清缓存。两次观察仅适用于这台设备和这次运行，不声称所有设备必现。这里只整理材料，**未对外发消息、上传日志或发布**。

原始日志逐字节复制、SHA256、解析结果和诊断 JSON 保存在 `.local/glx-shader-failure-20261023-01/phone-validation-20261024-01/vconsole-audit-01/`。所有旧包与失败证据保留。完整自构建稳定性、前后台恢复、触摸/音频/3D、裁剪和分包仍未验收，见[问题总表](GLX_ISSUES_20261023.md)。

可跟随分支保存的[脱敏机器可读证据](evidence/GLX_SHADER_TYPE_MISMATCH_20261024.json)包含配套哈希、两轮结果、原日志哈希及完整 shader 记录；不包含 AppID、账户、配对材料、设备路由、私有路径或手机截图。原始证据继续保存在忽略目录，不将微信 `.local` 或聊天文件纳入提交。
