# Native GLX triangle candidate

本目录是本地准备的最小 C++/WASM 对照：WebGL2 context、三角形和随时间变色的背景。它不包含 Godot 场景/渲染器。`explicitSwapControl=false`，使用 `emscripten_set_main_loop`，每帧实际 `glDrawArrays`；没有手工 `glFlush`、`commit_frame`、GLX flush、batch 或 swap。固定库自己的 after-frame 路径负责提交。仅 clear 不足以覆盖已审计 glue 的 `drawcall>0` swap 条件。

当前状态：源码与独立构建配方已准备；没有生成 JS/WASM、没有微信宿主接线、没有手机包或真机验证。不能把它称为可运行的微信最小复现。现有 `convert` 仅支持 Godot 输入，本目录不声称可以直接交给它转换。

2026-10-23 本地校验：固定 SDK 的 clang++ 对 `main.cpp` 执行 wasm32/现有 sysroot `-fsyntax-only` 正常退出；PowerShell AST 解析及 Node `--check strict-post.js` 通过；recipe-only 使用上述实际固定输入通过，复核修正后的配方证据为 `.local/glx-native-triangle-recipe-03/BUILD.json`。未运行 `-Build`，未链接、未生成 glue，不能据此确认四项导出或库 after-frame hook 已进入最终产物。

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

需要实际构建时，使用另一个全新输出目录并加 `-Build`。脚本复制 SDK cache 到输出目录并设置 `FROZEN_CACHE=True`；缺少系统库将失败，禁止隐式重编大批系统库。临时目录、EM_CACHE、EM_CONFIG 均独立，编译并发为 1，结束恢复进程环境。用固定 SDK Python 的 `-B -E` 直接调用 `em++.py`，避免 bat 从环境选择其他 Python，且显式禁止写入 pyc。原 SDK、原 patch、GLX 库与正在构建的 Godot 目录不写入。脚本不调用 trim/convert，不执行生成物。SDK 内 node/python 路径明确使用本次已隔离 SDK 的 `24.19.0_64bit` / `3.13.3_64bit`，其他 SDK 布局需人工检查并修改配方。

编译保留 exceptions、emscripten longjmp、CHECK_NULL_WRITES=0、OFFSCREEN_FRAMEBUFFER=0、四项 GLX native exports 及官方运行时 helpers。此小程序用 `-O2`、不使用 Godot thin LTO；它隔离渲染调用栈，不是与 Godot 位级同构的构建。未关闭 undefined-symbol 检查；若链接需要额外 imports，先审计失败项，不通过空桩假装可运行。成功构建仅记录 `compiled-not-run` 与 JS/WASM SHA256。

## 上下文与失败合同

固定 upstream patch 原有 `wxGLXCallNative` 会 catch/warn/null。紧随它的 `strict-post.js` 将 native 调用改为缺失即抛错、异常透传，并要求宿主在 context 创建前明确把既有 patch 读取的 `__godotMinigameWXGLXEnabled` 设为 `true`。这是本例 fail-fast 合同；原 patch 仍负责 `getContext('wxwebgl2')` 后 init/buffer-state，以及 makeCurrent 后 contextId 更新。GLX context 创建失败或返回非 GLX context 会被拒绝，不自动降级。不添加 WeChat API 或额外提交 hook。

## 尚未完成的宿主边界

需要依据已有、可追溯的官方 runtime/transformer 适配此 Emscripten 输出：提供 `Module.canvas`、WASM 加载/实例化、小游戏环境与主循环调度，并在 context 创建前锁定 GLX 模式；记录实际 context 的 `emscriptenGLX`、库导出和生成 glue 中原 after-frame flush/batch/swap 路径。这里没有猜测实现这些接口。需要审计生成 WASM 的 exports/imports 与 JS 的 after-frame hook，再生成独立本地包。加载页对照和手机生命周期验收是后续工作。

只有真实画面及重复退出重进/前后台恢复证据才是显示稳定性验收。context 成功、初始化日志、native export 存在或 swap 计数都不能单独证明画面显示正常。
