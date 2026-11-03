# 一个简单场景：现成引擎与干净重建

本入口使用完整微信 Godot 引擎，不使用旧裁剪默认配置。只有一个主场景：转动的纹理方块、方向光和地面阴影、48% 红色半透明片；一个不透明 SubViewport 经普通 TextureRect 默认 MIX 显示。没有历史验收轮播、云日志、像素读回、状态查询或显示端 alpha 绕开。

**2026-11-04 执行状态见 `docs/GLX_SIMPLE_DELIVERY_EXECUTION_20261104.md`。** 源码检查、编译、电脑 WebGL 参考、实际 GLX 和云测分别记录；历史成功包不能替新包通过验收。历史八项十九阶段保留，不进入默认示例。

## 固定版本

| 输入 | 条件 |
|---|---|
| 源码 | citizenll/godot，`df3cdd9bc9941a20cb5575d781cde6f937637bcb` |
| 微信运行引擎 | `4.7.2.rc.custom_build.df3cdd9bc` |
| PCK 编辑器 | `4.7.2.stable.steam.ed1daf0bf`，不是微信运行引擎 |
| 官方库 | Emscripten 4.0.10 对应附件，SHA256 `026efcef…87aa8` |
| 参数 | template_release、单线程 wasm32、无 SIMD/GDExtension、optimize=size、ThinLTO 8、完整 profile |
| 驱动 | Node 24.18.0，Python 3.14.0 + SCons 4.11.1 |
| SDK | Emscripten 4.0.10，内部 Node 24.19.0 / Python 3.13.3 |

完整哈希在 `delivery-recipe.json`。历史构建记录 `build-settings-20261103.json` 不改写。调度并行数可降低，不改变优化等级、ThinLTO 或编译语义。

源码补丁按以下顺序应用，然后应用既有 Windows response-file 链接处理：

1. `baseline-shader-diagnostic.patch`：保留成功配方已有的 shader 失败记录与 JS 后处理。
2. `scene-alpha-restore.patch`：在限定条件下保存/恢复材质 alpha。
3. `scene-light-output.patch`：已验证的灯光输出修正。
4. `scene-alpha-output.patch`：已验证的 alpha 输出修正。
5. `delivery-windows-link.patch`：与原构建器的链接命令实现一致。

没有把所有物体强制不透明，没有修改官方静态库；具体根因仍不能仅凭修复有效就归给 Godot、GLX 或驱动。

JS 流程为：原始 SCons 输出 → 固定源码的 `godot_process.js` 一次 → 保存 JS/WASM/BR → 组包时把唯一原始 `evalCheckWxContextGlobalIdAvailable` 改为 `return 0` 一次。现成引擎已含 return 0，只校验使用。禁止重复叠加后处理。

## 依赖来源与许可边界

- **026e 库**：本目录 `libemscriptenglx-4.0.10-026e.a`，维护者已授权纳入；见 `GLX_LIBRARY_NOTICE.md`。不拿公共 latest 或同名文件替代。
- **宿主**：从 recipe 中的上游发布 URL 获取 `minigame4.7.0.8.1.tpz`，完整 SHA256 必须一致。生成器只在内存提取五个指定文件并应用已锁定 loader 差异，不使用作者引擎、PCK、图片或历史探针。原归档不纳入本仓库；重新分发宿主的权利另行核实。
- **工具链**：`delivery-bootstrap.py` 锁定官方 SDK、SDK 内 Node/Python 下载归档和安装后关键文件。emsdk 4.0.10 的正式版本标记写入属于官方安装步骤，有原始归档和安装后双哈希依据。旧项目缓存不参与。
- **Python 3.14.0 / 驱动 Node 24.18.0**：从 Python / Node 官方渠道取得并验证 recipe 的可执行文件哈希。bootstrap 从指定 Python 新建 venv，按 `engine/requirements-scons.lock` 获取 SCons，不能复制旧 venv。
- **编辑器**：合法取得指定 Steam 版本，SHA256 必须为 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`。本仓库不附带 Steam 文件；其他编辑器版本尚未纳入此精确验收。它是手动提供的固定依赖，不能宣称任意新电脑自动下载即可用。
- **现成引擎**：使用 recipe 中的明确配对 JS/WASM.br，解压后 WASM 也校验。此路径的公开下载发行包尚未发布；有匹配文件的使用者可直接组包，没有文件者走源码重建。不能把作者其他版本的 JS/WASM 混入。

全部私有绝对路径、AppID 只放使用者自己的 `delivery.private.json`；模板 `delivery-input.example.json` 仅含占位符。生成的运行工程和 `CANDIDATE.json` 可能包含 AppID 配置或其哈希，不直接提交整个运行目录。

## 准备一个工作根目录

只需要一个容量充足的工作根目录，以下用 `<ROOT>` 表示，命令从仓库根目录执行。第一次完整构建预留 20 GiB 是**磁盘峰值预算，不是内存需求**；记录实际用量，不自动清理任何历史目录。

`<ROOT>` 内各放一份工具链、引擎 checkout、简单场景和必要运行包。不要复制旧引擎树、对象或 SDK 缓存。`delivery-bootstrap.py` 不改全局 PATH、共享 SDK 或系统设置，并获取/核验固定宿主归档到 `<ROOT>/downloads`。

```powershell
& "<PYTHON_3_14_EXE>" engine/alpha-preserve-lighting/delivery-bootstrap.py --root <ROOT> --base-python <PYTHON_3_14_EXE>
& "<PYTHON_3_14_EXE>" engine/alpha-preserve-lighting/delivery-bootstrap.py --root <ROOT> --base-python <PYTHON_3_14_EXE> --execute
$DeliveryNode = "<ROOT>/tools/driver-node/node.exe"
& $DeliveryNode engine/alpha-preserve-lighting/delivery.mjs recipe
```

默认仅输出计划，加 `--execute` 才安装到指定根目录。安装输入不符即停止，不换版本凑通过。`TOOLCHAIN_ACQUISITION.json` 保存来源与哈希。

私有配置中 `sdk` 指向 `<ROOT>/tools/emsdk`，`python` 指向新 venv；`library` 指向本仓库的精确库，`editor` 指向合法取得的固定编辑器。`work` 填 `<ROOT>/build`，`budgetRoot` 填 `<ROOT>`，`jobs` 根据负载选择，`sdkCacheWriteApproved` 只对这一份新 SDK 设 true。

## 共用场景与 PCK 导出

```powershell
& $DeliveryNode engine/alpha-preserve-lighting/delivery.mjs scene simple <ROOT>/scene --write
& $DeliveryNode engine/alpha-preserve-lighting/delivery-export.mjs <PRIVATE_CONFIG> <ABS_SCENE> <ABS_NEW_PCK>
& $DeliveryNode engine/alpha-preserve-lighting/delivery-export.mjs <PRIVATE_CONFIG> <ABS_SCENE> <ABS_NEW_PCK> --execute
```

场景目录和输出 PCK 必须是明确的新目标；遇到已有文件拒绝覆盖。导出脚本等待编辑器进程结束，保存导入/导出日志、退出码和耗时，并拒绝脚本或导出错误。只导出内容 PCK，不使用编辑器自带 Web 引擎。

模板关闭文本场景转二进制；实际 PCK 内脚本、场景字节、主场景和资源白名单均需通过。字体使用内置默认字体，没有额外字体资产依赖。

## 路径 A：现成配对引擎

配置 `js`、`br`、`hostArchive`、`pck`、`appid`、`mode`，不填 `build`。先 dry run，再写入新运行目录：

```powershell
& $DeliveryNode engine/alpha-preserve-lighting/delivery.mjs package <PRIVATE_CONFIG> <ABS_NEW_PREVIEW>
& $DeliveryNode engine/alpha-preserve-lighting/delivery.mjs package <PRIVATE_CONFIG> <ABS_NEW_PREVIEW> --write
```

生成器校验宿主归档、配对引擎、解压后的 WASM、PCK、所有相对 JS 引用的固定输入。loader 恢复成功宿主的 GLX 延迟建上下文和结束保护；入口不使用 eval。

项目编译设置采用成功完整 Godot 包的 `es6/enhance/swc=true, disableSWC=false`。不要套用历史独立三角形的关闭转译设置。GLX 能力不满足就拒绝启动，不以 WebGL 回退冒充成功。

## 路径 B：固定源码干净重建

```powershell
& $DeliveryNode engine/alpha-preserve-lighting/delivery.mjs check <PRIVATE_CONFIG>
& $DeliveryNode engine/alpha-preserve-lighting/delivery-build.mjs <PRIVATE_CONFIG>
& $DeliveryNode engine/alpha-preserve-lighting/delivery-build.mjs <PRIVATE_CONFIG> --execute
```

流程是：固定 SDK 源码生成本次 ThinLTO 系统库 → 单份固定提交 checkout → 五个按序补丁 → 原源码测试 → SCons → JS 后处理一次 → Brotli 11 → imports/exports 和占位审计。

`EM_FROZEN_CACHE=0` 仅用于系统库生成，正式引擎仍使用固定 `.emscripten` 的冻结缓存。`EMCC_CORES` 仅限制子工具调度；ThinLTO 参数不变。不调用会复制第二份源码的旧构建入口。

Binaryen 自有线程池另读 `BINARYEN_CORES`，依据[固定版本源码](https://github.com/WebAssembly/binaryen/blob/8c82b6884/src/support/threads.cpp#L132-L143)。首次本轮构建未设置它，曾采到系统 CPU 100%；脚本现已补齐后续构建的调度限制，和 SCons/EMCC 使用相同 jobs，不改优化选项。本轮进行中的优化器不被中断或追改环境；不能把新调度限制说成本轮已实际生效。

`BUILD.json` 保存源码和输入身份、实参、阶段耗时、资源采样和磁盘变化。CPU/物理内存/提交内存/换页/磁盘均有记录；采样不是无遗漏峰值测量。接近余量或预算时挡住下一阶段，不强杀当前编译。并行编译内部的链接/优化只在日志有可靠边界时分列，否则报告合并时长。

存在工作目录时拒绝重新执行。唯一的 `--resume-before-source` 仅接受系统库阶段已完整通过、尚无源码 checkout、输入及本次系统库哈希完全一致的中断；保留前一次记录，不重跑已完成的阶段。它不是任意失败后自动重试的入口。

构建成功后，组包配置用 `build` 指向本次工作目录，去掉 `js/br`。`rebuiltPair` 要求固定配方、库、SDK、参数、JS/WASM/BR 配对以及接线审计通过。历史参数允许未定义符号，因此仍检查链接警告、最终 imports/exports 和 missing-function 占位；退出码 0 不能单独放行。

## 运行和验收

使用微信开发者工具打开新生成运行工程，填自己的 AppID。此简单场景默认直接运行，**Query 留空**，没有自动轮播或点击步骤。

1. 电脑参考使用显式 `mode=webgl`，确认画面和实际 WebGL2；不能算手机 GLX 通过。
2. GLX 候选使用显式 `mode=glx`。保留模式切换前后身份和哈希，不混写电脑和设备结果。
3. 核对 `[SIMPLE_ID]` 的包/会话/设备/实际 SDK，`[SIMPLE_READY]` 的上下文描述后端和 modeMatches。屏幕底部也显示包、SDK 和后端。
4. 看纹理方块持续转动、红片可见且能透出后物、方块地面阴影、普通 MIX 的完整画面。创建完成或日志正常不等于画面通过。
5. 原引擎错误、shader 失败、警告与生命周期不屏蔽。云测截图/日志须能关联实际候选；缺少实际 GLX 证据则该项未知。

包可用、体验版后台指向、云测已提交、云测实际视觉结果是四个不同状态。本工具本身不自动上传或发布。完整引擎成功也不等于裁剪、WASM 分包、所有设备和真实游戏都已验收。

## 本轮电脑编译恢复记录

同一新项目曾在 SWC 和 Babel 两种编译路径下报生成 helper 模块缺失。Babel 对照失败后已恢复上述原设置，仅清理该项目的编译缓存并普通编译后恢复。未关闭增强编译、未改 JS 源文件、未清除登录或存储数据。该恢复属于本轮工具现场证据，不是遇到任意失败都自动清缓存的流程；应先保存原错误并核对项目范围。
