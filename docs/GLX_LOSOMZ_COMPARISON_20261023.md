# Losomz 源码对照、构建门禁修复与 shader 取证边界

2026-10-23，接续 `codex/glx-selfbuild-20261023` 检查点 `e6df5cd25e355f66a352c060abc032f6fe8aa1c1`。开始时独立工作区干净，本地与远端一致；原工作区 `codex/glx-adaptation-20261022` 的未跟踪文档保留。当前失败包、正常包、原始证据及手机黑屏现场均未替换。

**本轮没有找到能够解释 CopyShader 顶点编译失败的 Losomz 必要适配缺失。** 找到并修复的是 BUILD-01 构建初始化中断门禁；它是构建可靠性修复，不是手机黑屏修复。没有重链旧库、生成新手机包、运行撤回的作者替换候选或新增云采集。目标仍是可自行构建和维护的完整 GLX 引擎。

## 固定来源与实际产物

参考固定为 Losomz/godot-minigame **`d5f6c787962b09e6ffdb3cd3d4ae2b72dad4e2ff`**，只读下载到独立目录，没有执行其脚本、初始化子模块或应用其补丁。主要依据：

- [WECHAT_GLX.md](https://github.com/Losomz/godot-minigame/blob/d5f6c787962b09e6ffdb3cd3d4ae2b72dad4e2ff/adapter/WECHAT_GLX.md)
- [GLX 来源记录](https://github.com/Losomz/godot-minigame/blob/d5f6c787962b09e6ffdb3cd3d4ae2b72dad4e2ff/adapter/thirdparty/wechat-glx/SOURCE.md)
- [003 GLX 补丁](https://github.com/Losomz/godot-minigame/blob/d5f6c787962b09e6ffdb3cd3d4ae2b72dad4e2ff/adapter/patches/optional/003-wechat-glx.patch)
- [JS 后处理](https://github.com/Losomz/godot-minigame/blob/d5f6c787962b09e6ffdb3cd3d4ae2b72dad4e2ff/adapter/sources/godot_process.js)
- [GLX 打包检查](https://github.com/Losomz/godot-minigame/blob/d5f6c787962b09e6ffdb3cd3d4ae2b72dad4e2ff/adapter/scripts/package_wechat_glx_template.py)

参考针对 Godot 4.5.2，记录的源码基线为 `6ce3de25aa58466e14ef354703ba8d9791a417da`，GLX 对齐来源为 citizenll `3dec2ca498f7b9e1ce07b33f5fbe08741a1429e5`。其早先 Android 成功记录、最新包静态检查、尚待同包手机 smoke 的状态分别保留；没有 iPhone 强退重开通过的证据，也没有把整批补丁中的某一项单因素确认为修复。

| 输入或输出 | 本轮核验结果 |
| --- | --- |
| 我们的实际源码 | Godot 4.7.2，`df3cdd9bc9941a20cb5575d781cde6f937637bcb` |
| SDK | Emscripten 4.0.10，核对实际 SDK 版本文件与既有 BUILD 记录 |
| Losomz 库与实际链接库 | 两者 SHA256 都为 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`，不是作者特殊库 |
| 我们的 JS | `b5710406a1fb9005692658a9d7a826085588213e7d50552b587fffa0ca579738` |
| 我们的原始 WASM | `67f58828b85a79769f9b74303d9153c757a707990b75cb39df8393bb61482718` |
| 两方 `patch_em_gl.js` | 逐字节相同，SHA256 `7f08edb7d3e7f3badc6c8b520b12c7424a9e52b223407ded92ae8f700bc01a0e` |

核对覆盖实际源码、两份既有链接 response 文件、后处理日志以及最终 JS/WASM。WASM 导入导出经最终 JS 的混淆名映射解析，不能只搜索 WASM 中是否有可读的 Query 字符串。只读取模块元数据，没有实例化目标 WASM。

## 逐项差异

| 核对项 | 分类 | 实际证据与处理决定 |
| --- | --- | --- |
| shader 创建、传源、编译、附着、查询 | 已包含参考桥；闭源行为证据不足 | `003` 没有新增这些 GL 调用的替代实现；两方 `patch_em_gl.js` 相同，包含 `GL.getSource` 处理。相同库、桥不等于 iPhone 行为正确；失败现场实际对象关联仍缺失。 |
| GLX context 注册、当前 context 更新及模式固定 | 已包含 | 源码与最终 JS 均有安装、`wxGLXInitContext`、模式固定路径。未发现少装参考桥的问题。JS 句柄匹配不能证明平台对象归属。 |
| timestamp Query 创建、写入、读取与删除 | 已包含 | 实际 GLES utilities 带 `WECHAT_GLX_EXPERIMENTAL` 条件；最终 WASM 解析后 Query imports 为 0。 |
| Emscripten offscreen framebuffer | 已包含 | 实际 GLX 链接不带 `OFFSCREEN_FRAMEBUFFER`；resize 对 `GL.resizeOffscreenFramebuffer` 有函数存在性检查。Godot 自身离屏 render target 是另一层，不由此排除呈现问题。 |
| GLX explicit swap | 已包含 | GLX 构建关闭 `explicitSwapControl`。不能把默认 WebGL 的行为一并删除。 |
| `commit_frame` | 有实际差异，因果证据不足 | Losomz 按编译宏删除调用，并在打包时要求无该导入；我们按运行时 `!wx_glx_enabled` 保留普通 WebGL 路径。实际 WASM 导入 `a.Od` 映射到 commit 包装器。GLX 分支跳过引擎调用，未证明失败会话曾执行它；不据此删除调用或把 commit 存在当黑屏原因。 |
| C++ exceptions、longjmp | 已包含 | 实际链接有 `-fexceptions`、`SUPPORT_LONGJMP=emscripten`；392 个 invoke 定义的映射全部存在。numeric catch、`__cxa_throw` numeric pointer 和 longjmp 的 Infinity 路径与 SDK 一致。未证明失败 shader 前发生异常/跳转。 |
| null-write guard | 已包含 | 实际链接为 `CHECK_NULL_WRITES=0`。 |
| 原生导出和 batch 回调 | 已包含 | 9 个 GLX 导出与 6 个 batch 回调在实际配套产物中齐全，实际导入未解析数为 0。 |
| RuntimeError 构造、帧回调 | 已包含 | RuntimeError 的 Error 回退及 `registerAfterDoFrame` 包装存在。参考的 `instanceof RuntimeError` 改写在本产物无匹配，不涉及 numeric invoke catch。 |
| pixel-ratio 后处理 | 确实缺少参考规则，尚无故障关联 | 控制像素比例；没有它导致 CopyShader 阶段错误的证据，本轮不混入候选。 |
| 后处理 required anchors / 幂等门禁 | 确实缺少部分工程保护，尚无故障关联 | 我们部分规则允许缺锚点时跳过，重复处理可能再包一层；当前实际输出的相关 GLX 规则均存在，没有该产物被重复处理的证据。另列工程改进，不冒充黑屏修复。 |
| Core 001 预加载及 SIMD guard | 已包含 | crypto/blob/fs 预加载存在，raycast SIMD 受开关保护，当前 `wasm_simd=no`。 |
| 4.5.2 源码哈希、目录及打包要求 | 版本不适用 | 不整套移植到 4.7.2；CI/source hash 门禁是复现保护，不是跨版本引擎修复。 |
| 作者共享 ID allocator | 证据不足且新参考未补足 | 新参考仍使用同一旧库；没有新增可用的 allocator 注入合同。历史作者共享编号差异保留，但 `117e07c5` 尚无 ID 冲突证据。 |
| iPhone 强退后显示、resize、恢复 | 证据不足 | 源码路径、Android 描述、swap 增长均不能替代该手机实际画面。 |

参考的真实构建链为 `.github/workflows/build-wechat-glx.yml` → `ci/build_wechat_glx.ps1` → `ci/package.py` → `adapter/scripts/package_wechat_glx_template.py`。它额外验证桥/源码哈希、链接参数、导出回调、后处理幂等及 Query/commit 导入。上述检查中有值得后续采用的工程保护，但不能由此推断我们已有产物缺少必要运行路径。

## 故障证据与受支持查询的边界

失败包仍为 `selfbuild-glx-engine-first-1d284f320d422f6848a9`，首开 `08a0e6e1` 正常、强退后 `117e07c5` 黑屏。后者的 CopyShader 顶点编译和绑定错误已经确认；Godot 后续仍读取场景，不抵消渲染失败。参考桥相同及所需链接项齐全，只能排除“忘记整组主要 GLX 适配”这一解释，不能证明类型、源码、context、平台编译器均正确。

本轮对固定旧库做具名函数反汇编核对，没有修改或依赖私有内存布局进行修复：

| 接口 | 旧 GLX 分支实际行为 | 证据能到哪里 |
| --- | --- | --- |
| `glIsShader` | 查本地 ShaderInfo 表；上下文检查还可能触发已有批命令提交 | 不是平台对象存在证明，最小实验不采用。 |
| `glGetShaderiv(GL_SHADER_TYPE)` | 经同步整数 batch 请求返回，不是只读本地缓存 | 可记录批请求返回类型，不能认证闭源端最终查询了哪个 GPU 对象。 |
| `glGetShaderiv(GL_SHADER_SOURCE_LENGTH)` | 发完整源码字符串请求后求长度；旧实现长度不含 NUL | 可以安全请求长度，但不是标准实现的全部语义。即使长度正常也不代表源码内容正确。 |
| `glGetShaderSource` | 经同步字符串 batch 返回；随后按调用者 `bufSize` 原样复制 | 缺少标准截断/终止保证。先查长度再复制期间若响应变短，可能越界读；事后比较长度不能撤销此风险。本轮不直接加入这一复制调用。 |
| `emscripten_webgl_get_current_context` | 返回 Emscripten JS registry handle | 可以比较调用阶段句柄是否改变，不能证明 GLX 内部 context 或平台 shader 的归属。 |

类型和源码查询会同步提交已有命令，不是无副作用观察。最小插入位置是原有 `COMPILE_STATUS=false` 返回之后、任何 `glDeleteShader` 之前；不要在编译前增加查询。这无法改变已经返回的本次编译失败，但会影响后续批处理时序。只能捕获第一次失败，不追加每帧或逐 shader 的持续日志。

当前仍未取得失败时平台实际提交源码；Godot builder、旧库转换后文本、batch 字符串返回和平台编译器真实输入必须分开命名。没有安全、已验证的接口可直接认证最后一项。不能把类型异常自动归因于共享 ID，也不能删 `layout` 或 `gl_Position` 消除症状。

## BUILD-01 已修复

修改仅在构建器及其合同测试，不改变引擎、GLX 参数或默认 WebGL：

1. 非空工作目录必须具有可信 BUILD 记录、完整 stage 指纹及匹配的源码根目录；仅有 identity 或 engine 目录不再允许续编。
2. 新构建先记录 `initializing`，完成 clone、全部补丁、Windows 链接适配、stage 指纹及库校验后才记 `complete`。补丁中断保留原现场，改用新目录，不自动补打或重建基线。
3. 续编先核对身份、stage 和库，再允许写日志、BUILD、temp 或适配源码。旧格式记录若有完整 stage 证据仍可续编，无需事先手工补写初始化字段；成功进入续编后会正常更新 BUILD。本轮没有续用既有完整引擎目录。
4. 只读 Git 调用同时使用 `--no-optional-locks` 和 `diff.autoRefreshIndex=false`。独立复查发现只读 `git diff` 的自动 index 刷新也会破坏拒绝现场，已包含在修复中。

测试使用自有微型 Git 源码，在进入 SCons 前由自有测试脚本退出，不编译或运行真实引擎。覆盖实际第二个补丁失败、clone 前中断、缺失/损坏记录、初始化未完成、源码漂移、完整记录及旧记录续编；快照包含 `.git/index`。陈旧文件时间戳用于稳定触发原来的 index 刷新风险，没有放宽现场一致性断言。

本轮最终合同测试 **14/14 通过**，拒绝续编路径连续 **4 次通过**。修复最终版本完整工具回归 **75 个汇总项通过、0 失败**，包括默认 WebGL 合同；未运行 Godot headless、新引擎编译或手机。既有成功构建的原始记录没有追改，也没有证据表明它曾遭遇 BUILD-01。

## 下一项有限实验与是否值得上手机

**暂不以“Losomz 修复版”名义推新包。** 本轮没有有因果依据的引擎修复，原样重链同一旧库没有验证价值。

下一项有区分力的实验应只捕获首次已失败 shader：记录调用方 shader/program ID、请求阶段、源码字节数/摘要及各阶段公共 context handle；失败后读 `GL_SHADER_TYPE` 和 `GL_SHADER_SOURCE_LENGTH`。静态核对确认：长度查询已取得完整 JS 字符串，可在局部 `evalBatchRenderSyncString` 中一次性观察该返回，避免再调用有风险的 native 缓冲复制。它不是 Module 公开属性，事后覆盖全局同名函数无效；应做固定锚点的源码适配，保留原转换、分配、返回指针和原异常行为，不读取/改写命令或私有 heap。

该机制仍需独立电脑合同和配套重编。一次性标记只围住失败后的长度查询，在 import 入口取出并清除，防止日志查询或重入误关联；只旁路保存有界字符串，观察器自身失败不得改变原返回。需要验证非字符串、对象转换、截断、嵌套调用、原异常以及返回指针和调用序列均保留。新增观察会产生时间/分配开销，不能称完全无副作用；证据只能叫 GLX batch 返回文本，不能冒充平台真实编译器输入。

预期区分：类型不符或返回源与已知转换预期不符，将问题收窄到 GLX/平台对象关联或源码链；公共句柄改变提示上下文切换；这些均不直接证明 ID 冲突。类型与文本均相符，则应继续检查编译器/平台处理，不能宣布整个上下文链正确。若接口不可用、返回对象而非字符串或数据不完整，应明确记 unavailable 并停止扩展。

本对照检查点当时只有方案，没有新的配套引擎或手机候选。后续经用户授权，已开始[首次失败诊断实现与独立重编](GLX_SHADER_FAILURE_DIAGNOSTIC_20261023.md)；最终状态以该记录为准。完成电脑实现、构建和 WebGL 本地回归后，才申请一次有明确问题的新包真机验证。申请时另列包身份、文件差异、首开/强退次数、日志上限和回退；当前不重开失败现场。完整引擎稳定前，裁剪与分包继续保持未验收。

## 复核与保存

构建方法仍见 [engine/README.md](../engine/README.md)。本轮未生成新的 JS/WASM 配套，旧配套及符号不变；构建门禁补丁不能作为一个新引擎版本的来源。

```powershell
node --test tests/selfbuild-contract-tests.mjs
node --test --test-name-pattern="untrusted records" tests/selfbuild-contract-tests.mjs
node tests/run.mjs
git diff --check
```

只读参考及完整本地证据在原工具仓库忽略目录 `.local/glx-losomz-audit-20261023-01/`：`reference/`、`source-comparison/ADAPTATION_MATRIX.md`、`artifact-facts.json`、`inspect-artifacts.cjs`、`shader-query/REPORT.md`、`ADDENDUM.md` 及定点反汇编。原始包、库、云响应、截图及私有配置不提交。默认 WebGL、赛车、服务器、证书和默认分支均未修改；没有联系第三方。
