# GLX shader 对象与 context 生命周期只读核对

2026-10-24。接续[真机类型不一致记录](GLX_SHADER_TYPE_MISMATCH_20261024.md)和[脱敏机器可读证据](evidence/GLX_SHADER_TYPE_MISMATCH_20261024.json)。本文生命周期核对部分只读检查固定源码、最终 JS 和实际旧静态库；后续原始 TYPE 返回诊断已在电脑侧实现，进度见下文。未修改私有 heap、计数器或 batch，未新增手机运行或第三方消息；构建与后续本地 WebGL 验证须按实际结果另记。

**已证异常仍是顶点创建请求与失败后类型查询的结果不一致；共享 ID 冲突、context 重建和旧状态复用均未证实为根因。** 本轮补足调用顺序、状态寿命和剩余返回值观测缺口。

后续真机补充：`638674f8` 已取得原始有限 number 35632，WASM 结果也是 35632，一次性关联有效；本次 JS→WASM 类型转换解释已排除。首开 `ba727e5d` 正常、强退重开黑屏，见[新结果](GLX_SHADER_TYPE_RETURN_PHONE_20261024.md)。下面“尚未观测”描述的是此轮手机运行之前的证据边界，现由该结果补齐；对象身份及平台实际编译输入仍未知。

## 固定输入与证据位置

Godot 源码 pin 为 `df3cdd9bc9941a20cb5575d781cde6f937637bcb`，诊断补丁 SHA256 为 `fff071e50459bb5434b3a14c2d38927d655f632044f4ec0dba96369e8d50fd3b`，Emscripten 为 `4.0.10`。实际链接的 `libemscriptenglx_4.0.10.a` SHA256 为 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`，本轮重新核对该文件哈希。

私有材料均相对于原工具仓库根目录，继续保留在忽略目录：

- `.local/glx-shader-failure-20261023-01/build-v2/BUILD.json`、`engine/` 和 `artifacts/godot.js`：实际构建身份、补丁后源码和配套 JS。
- `.local/glx-shader-failure-20261023-01/emsdk/upstream/emscripten/src/lib/libwebgl.js`：实际 SDK 的公共 context 管理实现。
- `.local/glx-shader-failure-20261023-01/vendor/libemscriptenglx_4.0.10.a`：本轮具名反汇编的实际库。
- `.local/glx-shader-id-audit-20261023-01/native/`：既有 shader 链路反汇编；资源创建原件还见 `.local/glx-handoff-audit-20261023-01/native-audit/old-main-resource-create.dis.txt`。
- `.local/glx-shader-failure-20261023-01/phone-validation-20261024-01/vconsole-audit-01/`：`first.raw.log`、`reopen.raw.log`、`LOG_AUDIT.json` 和 `shader-failure.json`。提交的 JSON 仅摘录脱敏证据，不将这些原始日志纳入版本控制。

下面 C++ 行号指 `build-v2/engine/` 内补丁后的源码；不能与未打补丁的上游行号混用。静态库地址为相应 archive member 内的反汇编地址，不是运行时地址或可修改的内存合同。

## shader 创建、失败、查询与删除顺序

`drivers/gles3/shader_gles3.cpp::_compile_specialization` 的顺序如下：

| 顺序 | 补丁后行号 | 行为与已知边界 |
| --- | --- | --- |
| 1 | 312 | `glCreateProgram()`，失败记录中 program 为 1。 |
| 2 | 319、321 | 构建顶点源码，再 `glCreateShader(GL_VERTEX_SHADER)`；请求枚举 35633，失败记录中 shader 为 1。 |
| 3 | 326、327 | 同一 `spec.vert_id` 传入 `glShaderSource` 与 `glCompileShader`。 |
| 4 | 329、330 | 查询编译状态，进入失败分支；诊断认领本 Module 首次失败。 |
| 5 | 335、355、364 | 查询日志长度、读取 InfoLog、打印原始失败与 builder。实际记录走有日志的分支。 |
| 6 | 367 | `queries_after_error_display()` 查询同一 shader 的 `GL_SHADER_TYPE`、源码并输出诊断。此时尚未执行下面的 shader/program 删除。 |
| 7 | 370–373 | 释放日志内存；371/372 才调用 `glDeleteShader` / `glDeleteProgram`，随后 program 清零。 |
| 8 | 376、385 | 失败分支退出；同组 specialization 的片元 `glCreateShader(GL_FRAGMENT_SHADER)` 在 385 行，当前调用未到达。 |

因此不能用“同组片元随后创建，覆盖了这次顶点对象”解释本条失败前查询，也不能用当前失败清理中的 delete 后编号复用解释它。这里限定当前 specialization 的控制流；没有全局运行时对象事件记录，不能扩大为其它调用绝无创建、删除或平台内部重建。

已检查的旧库创建、传源、编译、查询及删除发送端沿用同一 shader ID，未发现直接交换 type/id 或 program/shader 参数。旧库 shader/program 使用独立计数器与独立元数据表；出现 program=1、shader=1 证明同号，不能证明平台对象命名空间冲突。创建和删除内部命令数字只用于静态复核，不作为自行重写协议的依据。

实测原始 builder 与 GLX 返回文本均为完整 1,268 UTF-8 bytes，SHA256 均为 `579b7feda3b663171d67e4ac59808a2d618d3b0971634d2acc03f2ac941ce64f`；原 InfoLog 为 218 bytes。文本一致排除本条记录中的“读回截断/读回文本不同”，不能认证平台实际编译输入、对象类型或对象所属 context。

## TYPE 返回链与尚未观测的转换边界

`GL_SHADER_TYPE=35663`、`GL_VERTEX_SHADER=35633`、`GL_FRAGMENT_SHADER=35632` 已按固定 SDK 核对。诊断传入同一 shader、正确 pname 和初始化为 `INT_MIN` 的 `GLint*`，最终保存的 `batchReturnedType` 是 35632。

具名反汇编与最终 JS 的静态链为：

```text
glGetShaderiv(shader, GL_SHADER_TYPE, params)
  → BufferData::flushSyncInt()
  → JsBinding::flushSyncInt()
  → evalBatchRenderSyncInt(ptr, bufferLen)
  → Module.wxContextGlobal.batchRender(Uint32Array view)
  → JS import 返回值转换为 WASM i32
  → 写入 params
  → 诊断记录 batchReturnedType
```

TYPE 分支没有从本地 `ShaderInfo.type` 直接读取。最终 JS 的 Int wrapper 原样 `return batchRender(view)`；没有本地阶段映射、布尔化或数组取值。已固定作者 JS 的对应 wrapper 也使用直接返回形式，静态上没有发现这处 wrapper 差异能解释问题。

**现有 35632 是通过 JS→WASM i32 转换后记录的值；尚未单独保存这次 TYPE batch 调用的原始 JS 返回值及其 `typeof`。** 字段名 `batchReturnedType` 不等于已经捕获未转换的 JavaScript number。若原始返回是普通 number 35632，则该值不涉及符号位或数值精度；但在未观测原始值前，不能把整条返回链压缩成“平台 getter 已直接返回普通数值 35632”。同步调用还会提交此前累计 batch，结果来自整批处理边界，不等于已观察到平台 getter 内部的独立一步。

## 公共 context、descriptor 与 native singleton 的寿命

`platform/web/js/patches/patch_em_gl.js:112–131` 每次成功取得 context 都调用 `glxInit`，仅首次发现 `Module.wxContextGlobal` 未定义时，`Object.assign` 复制 `emscriptenGLX` descriptor 并调用 `glxInitBufferDataAndGlState`；随后把 descriptor 的 `ctxid` 传给 `glxUpdateContextId`。139–180 行使用 `contextInitializedInGetContext` 避免单次 create 的 getContext 路径与 fallback 重复初始化。实际最终 JS 原始 createContext 只调用一次 getContext，再 registerContext，未发现这条正常单次路径必然重复初始化。

190–195 行 makeCurrent 包装只更新 native `ctxid`。未找到 GLX 的 deleteContext 包装、descriptor 清除或每 context 的状态重建。两份导出日志各只有一组库版本、GLX 模式与 BufferData 初始化输出；旧库 `initEmscriptenGLX` 每次调用都会打印版本/模式，因此导出范围内没有重复 `glxInit` 的正证据。日志不是完整生命周期事件追踪，不能据此认证底层 context 只创建过一次。

最终 JS 与实际 SDK 一致：`GL.counter` 从 1 开始，registerContext 经 `GL.getNewId(GL.contexts)` 递增分配公共 handle。deleteContext 清 current、事件、canvas 引用和对应数组项，不重置 counter，不清 `Module.wxContextGlobal`，不调用 native GlState 析构。同一个未被外部重置的 GL 实例内，第二次成功 registerContext 应取得更大的 handle；新 Module 可以重新从 1 开始，平台也可能在同一 JS wrapper 下更换内部对象。

所以三个公共采样 `1 / 1 / 1` 仅表示观察点的 Emscripten handle 相同，不能证明底层 context 相同，也不能排除采样之间切换。公共 handle 来自 `GL.counter`，native `ctxid` 来自 `emscriptenGLX` descriptor；现有桥没有把公共 handle 当作 native ctxid 传入。scene 的 `nativeContextIdMatches` 也不能充当平台内部对象 generation 的证据。

实际旧库的具名反汇编进一步确认：

| Archive member / 函数起点 | 生命周期行为 |
| --- | --- |
| `GlState.cpp.o` / `GlState::instance()` `0x2` | 静态 guard 保护一次构造，注册 `__cxa_atexit` 析构；不是按 context 建立实例。 |
| `GlState.cpp.o` / ctor `0x620` | 各资源计数器起点为 1；构造独立 ProgramInfo、ShaderInfo 及其它 map。对象表属于同一 singleton。 |
| `JsBinding.cpp.o` / `glxInit` `0x621` | 调用 singleton 的 `initEmscriptenGLX(bool)`；不重建对象表。 |
| `GlState.cpp.o` / `initEmscriptenGLX` `0xf635` | 打印版本/模式并写模式位；不清对象表或计数器。 |
| `JsBinding.cpp.o` / `glxInitBufferDataAndGlState` `0x684` | 调用 `setGlVersion` 和 `BufferData::setupBufferData`；后者自身还有首次初始化 guard。 |
| `BufferData.cpp.o` / `updateContextId` `0x1375` | 更新 context 标记与 buffer 内 context 边界命令；未调用 GlState 清表、ctor 或 dtor。 |
| `BufferData.cpp.o` / `resetInnerState` `0x17af` | 重置 buffer 位置与已编码 context 标记，不是资源表 reset。 |
| `GlState.cpp.o` / dtor `0xf8` | 析构各 map/string/vector；已检查公开 create/makeCurrent/delete 链路没有调用它。 |

Godot `display_server_web.cpp:1151–1152` 在 DisplayServer 构造中 create + makeCurrent，1206 行析构时 destroy。`library_godot_display.js:772–775` 的 context lost 处理仅提示 reload，没有 context restored 后资源重建路径。

**结构风险是：若同一 Module 真取得第二个不同底层 GLX context，当前桥仍保存第一次 descriptor/functions，并保留 native singleton 的对象表和计数器，仅切换 batch ctxid。** 平台是否支持这种跨 context descriptor/状态复用尚无合同；本次失败没有记录足够事件证明发生了这种情况。不能据此修改私有对象布局、强制重建或宣布修复。

## 原始 TYPE 一次性观测实现与进度

电脑侧已在 `engine/shader-type-return/` 实现首次失败 TYPE 返回的一次性观察，JS 合同测试 **12/12 通过**。新源码补丁 SHA256 为 `84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6`；独立全量自构建已在 `.local/glx-shader-type-return-20261024-01/build/` 单次完成，配对与 ABI 61/61 检查通过，本地 WebGL 直接/离屏 2D 显示及运动已验证。按钮自动化受工具限制，手机尚未运行，历史失败证据保持不变；精确包身份和门禁见[本轮构建与验证记录](GLX_SHADER_TYPE_RETURN_20261024.md)。

实现沿用每个 Module 的既有 failure state，在现有首次失败 TYPE 查询的同一次 `evalBatchRenderSyncInt` 返回处捕获，仅记录 `typeof`、null 标记、有限 number 值、ptr/byteLength 以及 arm/take/capture 次数。原值原样返回，不保存字符串内容，不添加 Module generation 或 context probe，不新增 query、flush、延时或第二次 batch，不对未知对象调用 getter/自定义字符串转换。12 项 fake/JS 合同通过只证明这些受测桥接行为，不能代替实际平台返回值观测。

- 若原始值是普通 number 35632，且下游仍为 35632，可排除本次 JS→WASM i32 把 35633 变为 35632，也可排除 wrapper 的本地阶段映射；仍不能证明平台编译对象就是片元，不能定位共享 ID、context、getter 缓存或整批分派中的哪一层。
- 若原始值是普通 number 35633，而下游为 35632，异常范围缩小到 import 返回后的转换、写入或关联记录链，需要检查 ABI 与观测关联；不能继续归因于平台已返回片元数值。
- 若是字符串、对象、数组或其它类型，首先厘清平台同步 Int 返回合同及隐式 i32 转换；不能把可转换结果等同于平台 getter 的普通数值。

该最小观测只补原始 TYPE 返回缺口。若要独立检验 context 复用，需要另有受限事件记录：Module 生成标识、create/register/makeCurrent/delete 顺序、公共 handle、JS context/descriptor 本地对象标识、native ctxid、首次 descriptor 与当前 descriptor 的关系，以及三个 native 初始化入口次数。即便补齐这些，平台内部隐式重建或 ctxid 复用仍需受支持的 generation/ownership 接口才能确认。

## 待微信或 GLX 供应方确认的问题

以下仅整理，不对外发送或上传材料：

1. 同步 Int batch 返回的精确 JS 类型与数值合同是什么？返回代表整批最后命令、指定查询，还是其它封装结果？如何关联这次 shader/pname 与返回值？
2. shader 请求 35633、失败后 TYPE 转换结果 35632 时，如何通过受支持接口核验创建对象、编译对象与查询对象为同一对象，并取得实际 shader 类型和编译输入？
3. shader/program/buffer/texture 的 ID 命名空间、allocator 和删除复用语义是什么？旧库独立编号是否受当前实现支持？不能仅凭同号回答冲突已发生。
4. descriptor 的 `batchRender`、`ctxid`、公共 wrapper 与平台内部 context 的关系、generation 及重建合同是什么？复制首次 descriptor 后仅 updateCtxid 是否受支持？新 Module 与结束微信后重新进入应如何初始化平台对象空间？
5. 若需新版库，提供 Emscripten 4.0.10 配套库、哈希、ABI、许可和必要 import/初始化步骤；或提供受支持的 allocator/context 生命周期接入接口。

本轮结论保留在公开桥与闭源平台的边界。黑屏未修复，现有原始包和证据保留；完整稳定性、恢复、3D、触摸、音频、裁剪及分包验收没有因此完成。
