# 完整 GLX 引擎的独立自构建

后续核对与候选：[shader 对象与共享 ID](../docs/GLX_SHADER_ID_COMPAT_20261023.md)。当前旧库缺少可验证的 allocator 注入接口；独立整组作者引擎对照候选已完成静态检查，但用户拒绝该预编译替换路线，预览申请撤回，不运行或推送。本任务继续以可自构建、裁剪和进入现有分包流程为目标。

目标是得到可维护、可回退的完整引擎，先验证实际 GLX 显示和生命周期，再恢复启动优化、裁剪、WASM 分包。作者发布引擎作为已接受的参考；本配方不是作者原构建的精确重建，也尚未证明修复旧黑屏。

当前功能门禁：完整引擎本地 WebGL 出画面及按钮/2D/3D/resize 已通过，但首个自构建 GLX 手机候选的用户反馈为两次黑屏。即便云端实际模式和上下文匹配，也判可见渲染失败。尚不能将本配方作为稳定 GLX 交付；失败包、设备和证据边界见 [自构建记录](../docs/GLX_SELFBUILD_20261023.md)。

最新进展：中文包及随后获批的 engine-first 候选均首开正常、上滑结束微信后重开黑屏，手机测试已停止。后者同会话日志确认 CopyShader 顶点编译/绑定失败；仅将 GLX 首次 context/GPU 对象创建留给引擎不足以修复。作者原生资源 ID 分配支持同上下文共享计数器，当前自构建未包含该能力，但实际冲突还不是已确认根因。未改变本配方或默认 stager，详见 [上下文交接核对与失败证据](../docs/GLX_HANDOFF_AUDIT_20261023.md)。

## 已固定的输入

| 输入 | 当前自构建候选 |
| --- | --- |
| Godot 源码 | `https://github.com/citizenll/godot.git`，`df3cdd9bc9941a20cb5575d781cde6f937637bcb` |
| Emscripten | `4.0.10`；本机 `emcc --version` 标识 `b7dc6e5747465580df5984e723b9d1f10d8e804b` |
| 官方原生 GLX 下载 | [0.1.11 原生库归档](https://game.weixin.qq.com/cgi-bin/gamewxagwasmsplitwap/getunityplugininfo?download=1&biz_id=1&version=0.1.11) |
| 归档 SHA256 | `7e6dd0b69e097575985265835fdf567895224f8e09c2fe29ba41f987d66bdb5c` |
| 实际链接文件 | `libemscriptenglx_4.0.10.a`，4,088,602 bytes |
| 静态库 SHA256 | `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |
| SCons | 本机检查为 `4.11.1`；公开 wheel 哈希见 `requirements-scons.lock` |
| 项目补丁／宏 | `patches=[]`、`cppdefines=""`，不加入旧的启动 trace/prewarm 补丁 |
| 平台适配 | 构建器仅增加 Windows 链接 response file 适配，完整 diff 进入构建记录 |
| JS 后处理 | 固定源码内的 `godot_process.js`，不导入转换器启动桥 |
| 压缩 | Node 内置 Brotli，quality=11；记录实际宿主 Node 文件哈希和版本 |

官方库与旧实验库字节相同。其 wasm32、非共享内存、无 atomics/SIMD 和 LLVM producer 与当前 SDK 匹配，这是静态兼容证据，不是黑屏修复证据。官方 `latest` 当前只含 3.1.51 库，因此不用于 4.0.10 构建。GLX 库为微信提供的静态库，本流程链接它，不假装重编闭源 GLX。

作者发布包内嵌相同 Godot commit 和 Emscripten 版本，但 GLX 标记为 `0.1.0 / 2026.09.02`。作者实际静态库、未提交源码差异、完整编译命令仍缺证据。版本字符串不能补足这些输入，不能将本配方描述成已复现作者修复。

## 在已核对的本机工具链上准备与构建

以下命令从仓库根目录运行。所有输出使用一个不存在的新目录；已有失败目录、正常包和构建中间文件均保留。准备脚本会复制 SDK 和 SCons venv，原工具链不变。

```powershell
./engine/prepare-selfbuild.ps1 `
  -WorkDirectory 'E:/AI/wechat-wasm-slim/.local/glx-selfbuild-NEW' `
  -Emsdk 'E:/AI/wechat-wasm-slim/.local/glx-full-baseline-20261023-01/emsdk' `
  -SconsVenv 'E:/AI/wechat-wasm-slim/.local/glx-full-baseline-20261023-01/venv'

node trim/trim.mjs check --toolchain 'E:/AI/wechat-wasm-slim/.local/glx-selfbuild-NEW/toolchain.private.json'
node trim/trim.mjs build `
  --toolchain 'E:/AI/wechat-wasm-slim/.local/glx-selfbuild-NEW/toolchain.private.json' `
  --profile 'E:/AI/wechat-wasm-slim/.local/glx-selfbuild-NEW/full.gdbuild' `
  --work 'E:/AI/wechat-wasm-slim/.local/glx-selfbuild-NEW/build' `
  --lto thin --jobs 4 --lto-jobs 2 --retries 1 --max-minutes 120
```

可用 `-LibraryArchive` 指定已下载归档，仍核对同一 SHA256。`-SourceRepository` 可指向本地源码仓库，脚本仅取得固定提交，不复制其未提交工作树。SDK 有多个 Node/Python 安装时，必须用 `-SdkNodeRelativePath`、`-SdkPythonRelativePath` 指定对应 SDK 内的相对路径；有且只有一个候选才自动选择。兼容 `version/node.exe` 和 `version/bin/node.exe` 两种目录布局。

当前本机准备使用 Node 24.19.0、SDK Python 3.13.3；SCons venv 实际依赖本机 Python 3.14.0。**复制 Windows venv 不会消除对其基础 Python 安装的依赖**，它不是可搬到另一台机器直接运行的工具链。构建记录包含 pyvenv.cfg 和基础解释器哈希。本机启动构建的 Node 为 24.18.0，也单独记录，不能用 SDK Node 的版本冒充后处理版本。

公共参数固定为 `platform=web target=template_release arch=wasm32 threads=no wasm_simd=no dlink_enabled=no use_wx_glx=yes javascript_eval=yes opengl3=yes optimize=size debug_symbols=no use_closure_compiler=no initial_memory=32 stack_size=5120`。完整 profile 不关闭类或构建选项；追加 `modules_enabled_by_default=yes`、显式 `wx_glx_lib`、thin LTO 和符号表参数。最终 SCons 参数保存于 BUILD.json。

准备脚本设置 `FROZEN_CACHE=True`，用于已有且已核对的 SDK cache。全新 SDK 必须先准备所需系统库；cache 缺失应明确失败，不能静默换其他工具链。全新依赖取得与冻结缓存探针已另行验证，见下节。

## 从公开来源准备新的依赖

使用 [bootstrap-toolchain.ps1](bootstrap-toolchain.ps1) 和 [完整安装记录](BOOTSTRAP.md)。已在新目录从公开来源完成安装、十个 ThinLTO 系统库准备及冻结缓存链接探针；尚未用这套新 SDK 完成完整 Godot 构建。它使用官方 tagged SDK 的 Node 22.16.0，与当前复制的 Node 24.19.0 不同，应生成新的构建身份，不能续编当前目录。

- [官方安装说明](https://emscripten.org/docs/getting_started/downloads.html)。固定 emsdk `4.0.10` tag 的 commit 为 `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`，不使用浮动 main/latest。
- [固定 manifest](https://raw.githubusercontent.com/emscripten-core/emsdk/4.0.10/emsdk_manifest.json) 与 [release 映射](https://raw.githubusercontent.com/emscripten-core/emsdk/4.0.10/emscripten-releases-tags.json)：4.0.10 对应 `8103ffedfb0c42d231c6af6859a5a1a832260b43`。Windows 运行时路径为 `node/22.16.0_64bit/bin/node.exe`、`python/3.13.3_64bit/python.exe`。
- 使用显式选择的本机 bootstrap Python 执行固定 emsdk.py 的 `install 4.0.10` 和 `activate 4.0.10`，避免依赖 emsdk.bat 对 Python 安装路径的查找；后续 venv 使用新安装的 SDK Python。
- 在最终路径使用 SDK Python 创建 venv，执行 `python -m pip install --no-deps --only-binary=:all: --require-hashes -r engine/requirements-scons.lock`。不要将其他机器的 venv 当作完整依赖分发。
- bootstrap 脚本固定 SDK 归档 URL/哈希，保留下载原件；按本配方准备十个 ThinLTO 系统库后冻结并记录哈希。独立探针匹配 `EXIT_RUNTIME=1` 和 `STACK_SIZE=5120KB`，链接通过但不执行 WASM。探针不是完整引擎或手机通过。

## 构建证据与续编约束

`PREPARATION.json` 记录来源、库哈希和 SDK 关键文件。`build/BUILD.json` 记录源码 HEAD/实际 diff/未跟踪源码摘要、补丁及宏、profile、编译参数、实际 GLX 库、SDK 指纹、宿主 Node、阶段时间和产物。SDK 指纹只覆盖列出的关键文件，不冒充完整 SDK/cache 的哈希证明。

后续构建指纹包含 `wasm-opt`，并兼容官方 SDK 的 `node/<version>/bin/node.exe` 和 Python 对应布局。构建子进程移除外部 Node/Python 模块注入环境变量，不改调用者环境。这些是在 `-02` 构建启动后补入的流程改进；该次构建的实际输入仍以原 BUILD.json、链接记录和独立 compiler-comparison.json 为准，不追改历史身份。

同一 `--work` 仅允许同一输入续编。替换库、改 SDK、补丁、宏、profile、LTO 或新增未跟踪模块源码会拒绝续编；应另开目录并保留原现场。只对明确的编译器崩溃有界重试，不重试源码/配置错误。

最终产物为配套的 `build/artifacts/godot.js`、`godot.wasm`、`godot.wasm.br` 和符号信息。三个核心文件各自有 SHA256，并校验 Brotli 解压严格等于原 WASM。生成配套文件不是实际渲染验收。不能从现有 WASM 中替换一个 `.a`，不能混用不同构建的 JS 和 WASM。

## 下一阶段的单因素对照

首个自构建候选采用作者原 loader/SDK/adapter 和同一个最小 PCK，将配套引擎 JS/WASM 整组换为自构建输出。另有显式模式门禁、兼容同一 PCK 的本地诊断及独立项目名，这些必要差异逐项记录，不隐藏成完全无差异的运行环境。诊断不增加 GPU 查询、rAF/初始化/swap 包装或云发送；作者原音频阈值不变。它比较的是完整引擎构建差异，不能仅凭结果归因某一 GLX 库。先完成本地 JS/接口/包结构和默认 WebGL 回归，再提交具体手机换包方案。

构建结束后运行：

```powershell
node engine/audit-pair.mjs --build-dir <构建目录> --out <新的静态审计JSON>
node engine/stage-candidate.mjs `
  --upstream <作者原始解包目录> --upstream-manifest <原文件哈希清单> `
  --build-dir <构建目录> --pck <已接受的最小场景PCK> `
  --config-dir <既有受权项目配置目录> --out <全新候选目录> --mode glx
```

stager 缺省为 WebGL；GLX 能力不足时在 loader 创建 context 前输出一次有身份的阻断摘要并停止。包标识包含源码构建记录、配套引擎、PCK、作者壳、配置、组包脚本与新增诊断模板哈希；不混淆“代码变了但标识相同”的候选。实际上下文不符会显示失败。静态审计只验证字节、WASM 模块有效性、原生导出映射和提交代码模式存在，不实例化 WASM，也不保证 ABI/初始化/实际呈现。

真机要求实际 GLX 与人工画面配对，优先检查上滑结束微信后重开，再检查普通重进、前后台、触摸和音频。通过后才能逐项恢复转换器启动桥、启动优化、裁剪、分包。最后才使用封存的同一赛车 PCK 对比已接受体验。任何失败保留，回退使用原封存包；不通过重复重试抹去失败。

WebGL 仍为转换器默认；显式 `--render-mode glx` 是实验选项，失败需要可读原因。不得静默回退 WebGL 后记为 GLX 通过。预览、手机操作和新增云报告需要另外的具体批准。

## 独立 loader 退场补丁

`loader-terminal.mjs` 只接受作者 loader SHA256 `0e6bde33b9a63d3f452209838f0ef110a33890df8bc97fdedf25728bf00c03a4`。它在 `cleanup` 入口幂等置终态，并在 `render` / `resizeCanvases` 入口阻止退场后工作；原清理 GPU 操作、`this.gl`、初始化和分包下载顺序全部保留。不接入现有 stager 或全局默认，不重编或改写引擎、GLX 库和场景。

```powershell
node engine/loader-terminal.mjs --source <作者loader绝对路径> --out <全新输出loader绝对路径>
node tests/loader-terminal-tests.mjs --source <同一作者loader绝对路径>
```

CLI 拒绝未知哈希、重复补丁及已存在输出，并在输出目录新增 `LOADER_TERMINAL_PATCH.json`。测试仅在 fake wx/Image/RAF/canvas/GL 中运行该已校验 loader，覆盖清理前行为/下载顺序、原清理操作一致、晚到 image/progress/queued RAF/queued resize 及重复清理。它证明原代码存在退场后副作用、补丁能阻止这些合成路径；不证明真机实际发生过这些回调或原黑屏根因。不会加载 adapter、生成引擎、WASM 或网络；手机候选须另行派生封存和授权预览。

## 独立 GLX 首次上下文候选

`loader-engine-context.mjs` 只接受上节终态补丁结果 SHA256 `606480e28dc6c4d640dc03f588ccfa0465595b4b8e670a113e466c887227375f`。GLX 分支保留模式固定、尺寸/图片准备、引擎下载与 cleanup 接口，但在加载页创建 context 之前返回；WebGL 路径不变。本工具不接入默认转换器和 stager。

```powershell
node engine/loader-engine-context.mjs --source <终态loader绝对路径> --out <全新目录中的loader绝对路径>
node tests/loader-engine-context-tests.mjs --source <同一终态loader绝对路径>
```

CLI 拒绝未知输入、重复补丁和已有输出，新增 `LOADER_ENGINE_CONTEXT_PATCH.json`。GLX 加载阶段不再显示原 canvas 加载页，直到引擎绘制前可能空白；诊断 `loaderContextMatches=null` 是无加载页 context 可比较。6 项 fake 测试与独立封包静态复核通过，只验证本地合同。候选若显示改善，也不能唯一证明 ID 冲突：它同时移除了加载页 context 属性、绘制和 GPU 清理副作用。真机与最终稳定验收仍须另行授权并以实际画面确认。
