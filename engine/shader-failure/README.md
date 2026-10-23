# 首次 shader 编译失败诊断候选

这是可从固定 Godot 源码重建的诊断改动，**不是 GLX 黑屏修复**。它不替换为作者预编译 WASM，不更换 GLX 库，也不改变 shader 源码、帧提交、像素比例、画质或默认转换器。来源与前置问题见 [Losomz 对照](../../docs/GLX_LOSOMZ_COMPARISON_20261023.md) 和 [问题总表](../../docs/GLX_ISSUES_20261023.md)。

## 触发点和边界

- 仅编入 `WEB_ENABLED && WECHAT_GLX_EXPERIMENTAL`，运行时还要求已有实际模式标记严格等于 `true`。普通 WebGL 不做新增 GL 查询、读取源码或输出诊断。
- 在 Godot 原有 `COMPILE_STATUS == false` 分支声明捕获。每个引擎 Module 只认领第一次失败，后续失败不再读取。成功编译路径不增加查询。
- 保留原有 InfoLog 获取、`_display_error_with_code`、删除及错误返回。**先输出原始编译错误，再在删除对象前**读取 `GL_SHADER_TYPE` 和 `GL_SHADER_SOURCE_LENGTH`，最多两个新增 GL 查询。原本无编译日志时记录不可用，不增加查询。
- 不调用正缓冲区 `glGetShaderSource`，不使用 `glIsShader`、GL error 查询、重新编译、flush、延时或 context 重建。
- `SOURCE_LENGTH` 的旧库实现本来就取得一份完整 JS 字符串。固定锚点的 JS 后处理只在原 import 内旁路观察这份返回，不解析或改写 batch 命令，不新增私有 heap 访问，不改变原转换、分配、返回指针或原异常。
- 一次性标记只围住长度查询，在 import 入口取出并清除，防止嵌套/日志请求误关联。context 改变、哨兵返回、异常次数或非文本响应均标为关联不可用。

## 有界记录不等于平台输入认证

| 字段 | 含义与上限 |
| --- | --- |
| program / shader / expectedType | Godot 当前失败调用持有的对象编号及请求阶段，不直接证明平台对象身份 |
| variant / specialization | 原有编译变体及拆成两个 32 位值的 specialization |
| GODOT_ORIGINAL | 失败调用的原 builder UTF-8，显式指针及长度，最多保存 16 KiB；不是平台输入 |
| batchReturnedType | 同步类型查询返回值；与 expectedType 分开保存 |
| GLX_BATCH_RETURN | 长度查询对应的 GLX 字符串返回，最多保存 16 KiB；记录原始/转换类型、完整 JS 字符长度和截断情况 |
| PLATFORM_ACTUAL_COMPILE_INPUT | 始终 `available=false`，现有接口无法认证 |
| error | Godot 原有 InfoLog 的结果，按有效分配边界读取，最多保存 4 KiB |
| contextAtFailure / contextAtError / contextAfterQueries | 公共 Emscripten registry 句柄，不能证明原生 GLX 内部或平台对象归属 |

最多输出一次 `[WXSLIM_SHADER_FAILURE_V1]`；包括 JSON 转义后的正文限制为 40 KiB，必要时进一步截断保存的文本并标记。只保存文本、长度及截断信息，不用截断前缀冒充整份源码的哈希/相等证明。截断或不可用时不能自动下类型/ID 冲突结论。

**16 KiB 是我们保存和输出的上限，不是平台内部传输上限。** 旧库的长度查询底层仍会取得完整字符串；公开接口不能给这次 batch 返回附加长度限制。新增查询发生在已返回的编译失败之后，不能改变那次已发生的失败，但可能改变后续批处理时序与内存开销。

原生 guard 只包围两个新增诊断查询。普通 JS 诊断异常使记录不可用；数字异常和 Emscripten longjmp 在清理一次性状态后继续抛出，不能用全局吞错隐藏引擎故障。原有编译器日志调用不包在该 guard 中。最终记录保存在 `Module.__wxslimShaderFailureV1` 并输出一次控制台，不自动发送网络或云端。

## 可复现构建

先用 [prepare-selfbuild.ps1](../prepare-selfbuild.ps1) 创建全新目录，保持 [完整引擎配方](../README.md) 的 Godot pin、SDK 和库哈希。已有目录包括中断准备均保留，不清理、不覆盖。当前已验证 SDK 的 Node 路径为 `node/24.19.0_64bit/node.exe`，不能误写为带 `bin/` 的路径；其它 SDK 布局按实际核对指定。

```powershell
./engine/prepare-selfbuild.ps1 `
  -WorkDirectory 'E:/AI/wechat-wasm-slim/.local/glx-shader-failure-NEW' `
  -Emsdk '<已核对的 4.0.10 SDK>' -SconsVenv '<已核对的 SCons venv>' `
  -SdkNodeRelativePath 'node/24.19.0_64bit/node.exe' `
  -SdkPythonRelativePath 'python/3.13.3_64bit/python.exe' `
  -SourceRepository '<固定提交的本地源仓库>' -LibraryArchive '<已核对的 0.1.11 归档>'

node engine/shader-failure/prepare-source-patch.mjs `
  --source 'E:/AI/wechat-wasm-slim/.local/glx-shader-failure-NEW/source' `
  --out 'E:/AI/wechat-wasm-slim/.local/glx-shader-failure-NEW/diagnostic.patch'
```

第二步只用于新建、干净且固定在 `df3cdd9bc9941a20cb5575d781cde6f937637bcb` 的源码克隆；它明确修改该新克隆并生成唯一补丁及输入/文件哈希清单。输出已存在、源码脏、提交不符或锚点不唯一时拒绝。不要以现有失败包的 build/engine 为输入。

在新目录 `toolchain.private.json` 中将 `patches` 设置为该 `diagnostic.patch` 的绝对路径数组，保持其它参数及完整 profile。构建器从 pin 克隆，再应用补丁；不会把准备克隆中的未提交文件隐式复制过去。

```powershell
node trim/trim.mjs check --toolchain '<新目录>/toolchain.private.json'
node trim/trim.mjs build --toolchain '<新目录>/toolchain.private.json' `
  --profile '<新目录>/full.gdbuild' --work '<新目录>/build' `
  --lto thin --jobs 4 --lto-jobs 2 --retries 1 --max-minutes 120
node engine/audit-pair.mjs --build-dir '<新目录>/build' --out '<新目录>/pair-audit.json'
node --test tests/shader-failure-js-tests.mjs
node tests/run.mjs
```

完整源码差异只涉及 shader 失败分支、新 header / JS library、SCsub 引入以及后处理调用；原 Windows 链接适配仍由构建器单独加入并记录。配套 JS、原始及 Brotli WASM、符号、BUILD、补丁、SDK/库哈希必须一起保存，不能只搬新 JS 或单独替换 `.a`。

此次固定补丁 SHA256 为 `fff071e50459bb5434b3a14c2d38927d655f632044f4ec0dba96369e8d50fd3b`；相关目录以 `.gitattributes` 强制 LF，防止 Windows checkout 改变身份字节。独立 stager 同时验证实际源码、精确新增文件与修改、固定 Windows adapter、真实 SCons 库路径及宏参数，再核验完整产物。它只接受这份已审补丁，不提供跳过门禁选项。

原生边界测试的公开输入为 `native-fixture.cpp`，检查器为 `tests/shader-failure-native-check.cjs`。在独立 SDK/新输出目录设置好 `EM_CONFIG`（`FROZEN_CACHE=True`）、`EMSDK_PYTHON`、`EM_CACHE` 后，以同一 4.0.10 的 `em++` 编译：

```powershell
em++ engine/shader-failure/native-fixture.cpp -Iengine/shader-failure `
  -DWEB_ENABLED -DWECHAT_GLX_EXPERIMENTAL -std=c++17 -Os -flto=thin -fexceptions `
  -sSUPPORT_LONGJMP=emscripten -sSTACK_SIZE=5242880 -sEXIT_RUNTIME=1 `
  -sMAX_WEBGL_VERSION=2 -sGL_ENABLE_GET_PROC_ADDRESS=0 -sENVIRONMENT=node `
  -sMODULARIZE=1 -sEXPORT_NAME=CreateWxslimFixture `
  '-sEXPORTED_FUNCTIONS=["_run_fixture","_destroy_fixture","_run_raii_fixture","_run_longjmp_fixture","_run_cpp_query_fixture"]' `
  --no-entry --js-library engine/shader-failure/library.js -o '<新输出目录>/runtime-fixture.js'
node tests/shader-failure-native-check.cjs '<新输出目录>/runtime-fixture.js'
```

冻结 cache 缺少对应变体时停止，不自动扩充或修改原 SDK。fixture 通过不等于完整引擎已通过；实际构建整合问题、最终产物和验收结果另见[本轮记录](../../docs/GLX_SHADER_FAILURE_DIAGNOSTIC_20261023.md)。

## 电脑与手机验收分开

自有 JS fake 检查返回值/指针、一次性关联、异常及长度上限；原生微型测试只使用自有 GL stub 和 SDK，核对实际跨 WASM/JS 回调及异常语义，不加载旧 GLX 库或目标引擎。完整配套构建、WebGL 实际出画面与手机 GLX 是不同门禁，不能互相代替。

新组包使用本目录独立 stager，不放宽原 stager 的无补丁门禁。默认 WebGL；GLX 显式指定。保留固定父包的中文场景和加载页，替换完整自构建引擎对及必要包身份。两种本地候选都关闭现有 relay，避免电脑回归产生新增云记录。

```powershell
node engine/shader-failure/stage-candidate.mjs `
  --parent '<封存的 engine-first 父包目录>' --seal '<父包外部封存记录>/PHONE_TREE_MANIFEST.json' `
  --build-dir '<新目录>/build' --patch-manifest '<新目录>/diagnostic.patch.json' `
  --out '<不存在的 WebGL 候选目录>'
```

`--seal` 指向父包外部封存记录的实际路径，不要求在运行包内部；其 SHA256 必须是 stager 内固定的已审值。GLX 使用另一个不存在的输出目录，并额外传 `--mode glx`。默认 WebGL 包用于本地回归，不能直接当作 GLX 预览。该一次性 stager 不接受换父包、换补丁或绕过核验；需要变更时先审查代码和身份，再新建候选，不能修改已有封存目录。

手机新预览、换包及强退重开均须另报具体包身份、次数和取证方式并获得确认。即使本次 shader 错误不再出现，也只说明该轮未捕获到错误；实际画面、强退重开、恢复、触摸、音频以及后续裁剪/分包仍按问题总表验收。
