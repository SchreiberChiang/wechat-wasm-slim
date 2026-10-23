# Native GLX triangle candidate

本目录是本地准备的最小 C++/WASM 对照：WebGL2 context、三角形和随时间变色的背景。它不包含 Godot 场景/渲染器。`explicitSwapControl=false`，使用 `emscripten_set_main_loop`，每帧实际 `glDrawArrays`；没有手工 `glFlush`、`commit_frame`、GLX flush、batch 或 swap。固定库自己的 after-frame 路径负责提交。仅 clear 不足以覆盖已审计 glue 的 `drawcall>0` swap 条件。

当前状态：旧 `native-triangle-phone-91bac1d5fb37be67d1cf` 一次手机首开得到用户黑屏/报错反馈；根代理精确 build 查询得到一个匹配会话，entry → blocked，capability=true、actualMode=unknown，错误为 `Can't find variable: WebGLRenderingContext`。这是旧 `-05` 编入的 Emscripten Safari getContext shim 对浏览器构造器的直接引用，不是已证明的 GLX 内部或 Godot 主包黑屏根因。旧构建、宿主和手机包全部保留。

随后只在构建 recipe 增加有来源的 `-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0`，生成全新 `-06` 构建与 `-03` 宿主；不改 C++、Godot 构建、GLX 库、GPU 对象或帧提交。派生手机包 `native-triangle-phone-1aa4794e826540179aa1` 已获单次预览/首开授权并执行：用户确认三角形正常，但看不清背景是否变色。唯一精确包云会话 `19e03fb2` 观察到实际 GLX、初始化快照及 canvas/描述符匹配；背景动画和生命周期均未验证，不能宣称完整 Godot 已修复。证据见 [自构建记录](../../docs/GLX_SELFBUILD_20261023.md)。现有 `convert` 仅支持 Godot 输入，不能直接用于该 native 输入。

`-06` JS SHA256 为 `bb0c6c827293ae1d60e0fc9693056cb778af4a57df156926f985b6cc474d35f4`，与 `-05` 的逐字差异恰为删除 281-byte Safari shim；WASM 343791 bytes 与 `-05` 完全相同，SHA256 仍为 `1f67ed7160c6d8550c1f7ffc4dad30bcd5cc072604a47f82bb001954c8b8f52a`。本地构建审计只静态编译/解码 WASM，没有实例化；四项 native exports 映射不变。静态证据为新目录 `STATIC_AUDIT.json` / `JS_DELTA.json`，手机执行另见上述验收记录。

2026-10-23 本地校验：固定 SDK 的 clang++ 对 `main.cpp` 执行 wasm32/现有 sysroot `-fsyntax-only` 正常退出；PowerShell AST 解析及 Node `--check strict-post.js` 通过；recipe-only 证据为 `.local/glx-native-triangle-recipe-03/BUILD.json`。实际 `-Build` 的 `-01` 因空环境键兼容失败，`-02` 至 `-04` 分别因冻结缓存缺 getprocaddr libGL、非 LTO libGL、thin LTO libnoexit 变体停止，目录和日志全部保留。核对实际主包参数并完成下述有来源的对齐后，`.local/glx-native-triangle-build-20261023-05/BUILD.json` 状态为 `compiled-not-run`。该次构建保持冻结缓存、输入哈希与 undefined-symbol 检查，未构建系统库、未运行生成物。

`-05` 静态审计：`triangle.js` 101244 bytes，SHA256 `ee7395a473a791aabbb05fba7eb9e1860e1d6130010c088000e04066bf3c2816`；`triangle.wasm` 343791 bytes，SHA256 `1f67ed7160c6d8550c1f7ffc4dad30bcd5cc072604a47f82bb001954c8b8f52a`。固定 SDK 的 `wasm-dis` 解码为同目录 `triangle.wat`；`STATIC_AUDIT.json` 记录 91 项函数 imports、27 项 exports 与 JS 映射。四项 GLX 导出均存在：`glxInit→Pa`、`glxInitBufferDataAndGlState→Qa`、`glxUpdateContextId→Oa`、`glxCommandBufferFlush→Ra`。WAT 中 buffer-state 初始化函数直接调用 `evalRegisterAfterDoFrame` import，flush 函数直接调用 `evalBatchRenderAsync` import；JS 注册 `_glxCommandBufferFlush`、从当前 `Module.HEAPU8.buffer` 建视图、调用 `batchRenderAsync(view)`，仅 `drawcall>0` 时调用 `swapWindow()`。`node --check triangle.js` 通过。这只证明路径进入产物，不证明宿主执行、实际 GLX context 或显示成功。

## 固定输入与构建

从仓库根运行，下列命令默认只校验输入并在新目录写出 `BUILD.json` 配方：

```powershell
./examples/glx-native-triangle/build.ps1 `
  -Emsdk E:/AI/wechat-wasm-slim/.local/glx-full-baseline-20261023-01/emsdk `
  -GlxLibrary E:/AI/wechat-wasm-slim/.local/glx-full-baseline-20261023-01/build/engine/platform/web/libemscriptenglx/libemscriptenglx_4.0.10.a `
  -ContextPatch E:/AI/wechat-wasm-slim/.local/glx-full-baseline-20261023-01/build/engine/platform/web/js/patches/patch_em_gl.js `
  -OutputDirectory E:/AI/wechat-wasm-slim/.local/glx-native-triangle-recipe-01
```

输入必须满足：Emscripten `4.0.10`；0.1.11 静态库 SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`；上下文 patch SHA256 `7f08edb7d3e7f3badc6c8b520b12c7424a9e52b223407ded92ae8f700bc01a0e`。不匹配直接拒绝，不下载或自动换库。patch 来自 citizenll/godot `df3cdd9bc9941a20cb5575d781cde6f937637bcb`，本地固定路径如上，原文件包含完整 Godot MIT 版权/许可声明；配方引用原文件，不改写、不移除许可。它的 `GL.getSource` 部分也原样保留，并非本例新增渲染功能。来源链详见仓库 `docs/GLX_ENGINE_AUDIT_20261023.md`。

需要实际构建时，使用另一个全新输出目录并加 `-Build`。脚本复制 SDK cache 到输出目录并设置 `FROZEN_CACHE=True`；缺少系统库将失败，禁止隐式重编大批系统库。临时目录、EM_CACHE、EM_CONFIG 均独立，编译并发为 1；通过 `ProcessStartInfo.Environment.Remove` 仅清理编译器子进程的覆盖键，并显式设置隔离环境，父进程环境不变。用固定 SDK Python 的 `-B -E` 直接调用 `em++.py`，避免 bat 从环境选择其他 Python，且显式禁止写入 pyc。原 SDK、原 patch、GLX 库与正在构建的 Godot 目录不写入。脚本不调用 trim/convert，不执行生成物。SDK 内 node/python 路径明确使用本次已隔离 SDK 的 `24.19.0_64bit` / `3.13.3_64bit`，其他 SDK 布局需人工检查并修改配方。

编译保留 exceptions、emscripten longjmp、CHECK_NULL_WRITES=0、OFFSCREEN_FRAMEBUFFER=0、四项 GLX native exports 及官方运行时 helpers。初版配方用 `-O2` 且不使用 LTO；实际 SDK 缓存只有对应的 thin LTO libGL 变体，因此依据完整引擎真实响应中的 `-Os -flto=thin` 对齐策略，并将 `-Wl,--thinlto-jobs=1` 固定为单并发。它隔离渲染调用栈，代码、导出与其余参数仍不同，不是与 Godot 位级同构的构建。未关闭 undefined-symbol 检查；若链接需要额外 imports，先审计失败项，不通过空桩假装可运行。成功构建仅记录 `compiled-not-run` 与 JS/WASM SHA256。

`-sGL_ENABLE_GET_PROC_ADDRESS=0` 与完整引擎源码 `.local/glx-full-baseline-20261023-01/build/engine/platform/web/detect.py:352` 及实际链接响应 `provenance/response-files/tmp0ro2obs8.lnk` 一致。已逐项阅读本例 `main.cpp`、`strict-post.js`，均不调用 `emscripten_webgl_get_proc_address`；这个参数修正有实际输入来源，不是通过放宽冻结缓存解决缺库。`-Os -flto=thin` 也以该实际链接响应为依据。

`-sEXIT_RUNTIME=1` 同样来自实际主包响应；本例用 `emscripten_set_main_loop(frame, 0, true)` 维持帧循环，不依赖 main 自然返回后保留运行时。宿主接线尚未选择主包使用的 `MODULARIZE=1`、`EXPORT_NAME=Godot`、`INVOKE_RUN=0`、`ENVIRONMENT=web,worker`；本例仍为编译器默认入口结构。其他已知差异包括主包 5120KB/native 64KB 栈、主包默认 WebGL1 最低版本/native 最低 WebGL2、主包关闭 Safari getContext workaround/native 默认开启、主包允许 undefined/native 严格检查，以及 Godot 专用 JS 库/导出集。上述差异不以通过缓存检查为由自动同步。

上述 Safari 差异在 `-06` 单独修正。固定 SDK 的 `src/settings.js:599-605` 明确支持以该设置关闭 workaround；`src/lib/libwebgl.js:754-774` 仅在 `MIN_SAFARI_VERSION != TARGET_NOT_SUPPORTED && GL_WORKAROUND_SAFARI_GETCONTEXT_BUG` 时编入裸 `instanceof WebGLRenderingContext`。`MIN_WEBGL_VERSION=2` 不会移除它，因为 shim 位于 WebGL2 分支之前。Godot `platform/web/detect.py:439-441` 与已审计 `provenance/response-files/tmp0ro2obs8.lnk` 已使用关闭设置；作者实际 `engine/godot.js` 也没有该 shim/构造器引用。此次修复不伪造 `WebGLRenderingContext`、不改 canvas prototype/sentinel，不声称后续所有运行路径已通过。

## 上下文与失败合同

固定 upstream patch 原有 `wxGLXCallNative` 会 catch/warn/null。紧随它的 `strict-post.js` 将 native 调用改为缺失即抛错、异常透传，并要求宿主在 context 创建前明确把既有 patch 读取的 `__godotMinigameWXGLXEnabled` 设为 `true`。这是本例 fail-fast 合同；原 patch 仍负责 `getContext('wxwebgl2')` 后 init/buffer-state，以及 makeCurrent 后 contextId 更新。GLX context 创建失败或返回非 GLX context 会被拒绝，不自动降级。不添加 WeChat API 或额外提交 hook。

## 编译时的宿主边界（历史）

需要依据已有、可追溯的官方 runtime/transformer 适配此 Emscripten 输出：提供 `Module.canvas`、WASM 加载/实例化、小游戏环境与主循环调度，并在 context 创建前锁定 GLX 模式；记录实际 context 的 `emscriptenGLX`。这里没有猜测实现这些接口。生成 WASM 的 exports/imports 与 JS 的 after-frame hook 已有上述静态审计，独立本地小游戏包尚未生成。Godot 加载页关闭对照因启动失败已停止，未能区分原呈现故障；本例宿主适配及手机生命周期验收尚未完成。

只有真实画面及重复退出重进/前后台恢复证据才是显示稳定性验收。context 成功、初始化日志、native export 存在或 swap 计数都不能单独证明画面显示正常。

## 本地宿主准备（不执行候选）

`prepare-host.mjs` 只读固定配套 JS/WASM 和已核对的作者 upstream，在不存在的新目录写入六个宿主文件与 `HOST_MANIFEST.json`。必须传入三个绝对路径：

```powershell
node ./examples/glx-native-triangle/prepare-host.mjs `
  --build-dir E:/AI/wechat-wasm-slim/.local/glx-native-triangle-build-20261023-06 `
  --upstream E:/AI/wechat-wasm-slim/.local/author-glx-release-20261023-01/upstream `
  --out E:/AI/wechat-wasm-slim/.local/glx-native-triangle-host-20261023-03
```

已有目录会拒绝；这条命令不是启动命令。prepare-host 只接受明确审计过的 `-05` / `-06` 两组配套哈希；`-05` 仅保留用于复现已知 shim 故障，不会自动回退或重试。`main.cpp`、`strict-post.js` 及旧编译产物不变；`build.ps1` 仅增加上述 Safari 设置与来源注释。`weapp-adapter.js` 原字节复制，固定 SHA256 `84c679ae0a6dbb226afb24110860e5142ac113a2e3a00a93449a09edeb4647f6`。adapter 提供 window/document/canvas/RAF，不加载会预创建 context 并改写模式的 `godot-loader.js`。新增宿主把 `canvas.id` 设为 `canvas`，使其原有 `document.querySelector` 能解析 C++ 的 `#canvas`。

`triangle-hosted.js` 是透明 prelude 加原 `triangle.js` 完整原字节；不改任何生成函数体。prelude 在同一作用域提供 `Module`、异常路径的既有 `WebAssembly` 命名空间，以及实时读取局部 `HEAPU8` 的非 enumerable getter。此 getter 有具体依赖：GLX 的 `evalBatchRenderAsync/Sync` 读取 `Module.HEAPU8.buffer`，作者引擎在 `updateMemoryViews` 导出该字段，而本例默认编译输出只更新局部变量。当前产物没有 `moduleOverrides`；非 enumerable getter 也能在合成 `Object.assign` overrides 往返后保留，内存更新时不会缓存旧 buffer。所有 Module 方括号引用及 HEAP 字面依赖单列在 manifest。

`Module.instantiateWasm` 使用现存 `wx.WXWebAssembly` 或 `GameGlobal.WXWebAssembly` 的 `instantiate('triangle.wasm', imports)`，按作者 `engine/godot.js:549-563` 的路径/回调合同适配；这个命名空间选择属于新增本地接线，尚无真机执行证据。微任务保证原 JS 尾部的 context patch/strict-post 先安装，才允许实例化回调解除 run dependency。能力缺失、模式冲突、宿主接口缺失或实例化失败只阻断一次；不使用 browser WASM 实例化，不重试、不降级。缺失 `RuntimeError` 不增加启动门禁：原 abort 先调用 `onAbort` 留下一次摘要，随后缺失构造器可能导致 TypeError，未伪造平台 API。

唯一摘要是 `postRun` 初始化快照，携带绑定原 JS/WASM、host、prelude 模板、generator、adapter、入口和 game 配置的内容身份。完整 prelude 字节哈希另存 manifest，避免身份自引用。摘要读取 `Module.ctx.emscriptenGLX`，与 `Module.wxContextGlobal` 及 canvas 对照；无法取得实际 context 时为 `actualMode=unknown`。快照之后的错误不会更新它，不能证明首帧 flush、可见画面或生命周期。没有增加 hook、GL 状态修改、强制 swap、flush、batch 或帧时延；保留库原 afterDoFrame → native flush → batch → drawcall 条件 swap。

本例同时移除 Godot renderer 和 loading-page context/handoff，不能称为单独排除 Godot。原 C++ 没有显式绑定默认 framebuffer，依赖新 context 的默认 FBO；alpha 默认值、depth=false、explicitSwapControl=false 等与作者 loader 不同。若纯探针显示正常，下一项才是 loader 的 pre-context/handoff；若失败，应先排除本探针宿主接线。

初版 `.local/glx-native-triangle-host-20261023-01` 被保留，缺少上述 HEAPU8 getter，首批提交存在已确认失败路径，不能运行。修正版为全新 `-02`。`host-contract-tests.cjs` 仅执行新增 host 和 fake-wx；`verify-prepared-host.mjs` 直接接收包目录，静态比对所有文件、原 JS 后缀/WASM/adapter 字节，并仅执行 prelude 与合成 HEAP 代码。二者都不执行生成 JS、WASM 或作者 adapter。

```powershell
node ./examples/glx-native-triangle/host-contract-tests.cjs
node ./examples/glx-native-triangle/verify-prepared-host.mjs E:/AI/wechat-wasm-slim/.local/glx-native-triangle-host-20261023-03
```

上述宿主准备命令本身不启动微信、预览、手机或云。后续手机封装、获准执行及首开显示结果见本文顶部和自构建记录；新的预览、换包或生命周期动作仍需逐次确认。
