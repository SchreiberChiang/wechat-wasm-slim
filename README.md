# Godot 微信小游戏 GLX 插件源码

本地维护源码包含编辑器面板、导出和转换服务、三种引擎配方以及离线依赖。首次准备、完整回归、安装包和证据恢复步骤见[离线开发](docs/离线开发.md)。Claude 的界面入口见[合并说明](CLAUDE.md)。

## 开发与安装

1. 使用 Node 24.18.0 和 Godot 4.7.2。运行 `node packaging/configure-workbench.mjs "本机 Godot 编辑器路径"`，再在编辑器导入 `editor/workbench/project.godot`。工程自带右侧插件面板。个人路径和执行收据由本机生成。
2. 编辑器脚本和表单适配器在 `editor/workbench`。任务主入口为 `wxslim.mjs`，`lib/task-core.mjs` 负责计划、执行、取消、状态；`convert/` 负责微信官方转换和宿主；`engine/` 负责引擎、固定来源、补丁和配对审核。普通测试游戏使用 `examples/simple/project.godot`。两关资源夹具随离线配对证据保存。
3. 打包前检查运行文件白名单 `packaging/runtime-files.json`。使用 `node packaging/build-release.mjs NEW_RELEASE --write` 从随源码的已锁定配对和官方转换器生成安装包。安装包内两张固定指纹单覆盖保守及纯 2D 配对。
4. 把新 release 的 `addons` 文件夹复制进测试游戏，在 Godot 里启用插件，插件会自动完成本机准备（也可运行 `node addons/wxslim_readonly/kit/install.mjs Godot编辑器`）。安装、用户数据目录及日常流程见 [安装版使用](docs/安装版使用.md)，给 AI 的步骤见 [给AI的安装说明](docs/给AI的安装说明.md)。源码本身不需要相邻的 release 才能编辑或生成计划；真实组包需要固定引擎和转换器。

## 自建与审核

固定上游 Godot 提交 `c050c09b105c3715e1caa57a7109cd752047fd89`，工具 Emscripten 4.0.10、SCons 4.11.1、Python 3.14.0、026e 静态库。工作树中保留了固定库、第三方许可、24 个补丁的物化规则、既定 return 0 和 alpha／阴影修正。源码输入、上游存档后端提交和路径见 `engine/official-build-plan.json`、`engine/official-upstream-storage-tail.json`；工具链锁见 `engine/official-toolchain-downloads.json`。编辑器与运行引擎的版本标识分别记录。

```text
node wxslim.mjs engine official-capability-plan full
node wxslim.mjs engine official-capability-plan conservative
node wxslim.mjs engine custom-plan engine/custom-2d-plan.example.json
node wxslim.mjs task plan REQUEST.json
node wxslim.mjs task execute REQUEST.json --write --expected-plan-sha256 REVIEWED_DIGEST
node wxslim.mjs engine rebuilt-pair-prepare PAIR_CONFIG.json
node wxslim.mjs official custom-project-plan FEATURES.json BOOT.pck
```

依赖准备器加 `--write` 执行；在面板「新建官方引擎构建计划」选择固定依赖、24 补丁配方与完整、保守或自定义选项。完整／保守的配对配置 schema 为 `wxslim-rebuilt-capability-pair-v1`，包含 rawTaskRoot、rawTaskId、outputJs 和 receipt。配对准备命令加 `--write` 保存。自定义用 `engine/custom-pair-prepare.example.json`，提交给 `custom-pair-prepare` 共享任务。使用新 PCK 先核对被裁掉的模块与场景，再保存生成的 declaration。将准备配置、使用声明、prepared JS、同次构建的 WASM 提供给官方转换表单。启动预热以引擎原生支持为准。历史保守和纯 2D 配对的原 FAILED 收据仍有效。手动重审命令见离线开发说明。

## 同包测试工具

手动转换时，随附保守和纯 2D 配对选择引擎目录中的 `fingerprint.json`、同目录下的 JS/WASM 以及与本次启动 PCK 匹配的使用声明。快速流程会自动选择这些文件。新编引擎仍需通过其自身的准备和审核流程。

选择 GLX 完成官方转换后，对本项目生成的本地验收接口、资源配置、启动 PCK 与已绑定的本机 AppID 配置，运行以下命令。目标目录必须是新的。先只读，复核后加 `--write`。此模式使用固定 c050、zh_CN、原生 GLX／WebGL 路由及严格框架锚点。桌面通过 WebGL2，设备仍须实际 GLX。新包号需要各自的运行证据。

```text
node convert/assemble-devtools-device.mjs OFFICIAL_TASK RESOURCE_CONFIG.json NEW_OUTPUT LOCAL_APPID_PROJECT_CONFIG.json
```

## 本地回归

在 Windows x64 上，从源码根目录打开 PowerShell。首次准备时为解开的工具选一个新目录。测试入口使用随源码保存的真实夹具和 Git 源对象。

```powershell
$tools = Join-Path (Split-Path (Get-Location)) 'glx-offline-tools'
& .\offline\prepare.cmd $tools
if ($LASTEXITCODE) { throw '离线工具准备失败' }
& "$tools\node.exe" tests/run-offline.mjs $tools
```

再次回归时直接运行最后一条命令。首次 c050 转换的 framework.js 在 `offline/fixtures/c050`，df3 编译出的原始图形胶水在 `offline/fixtures/df3`。入口会绑定这些文件并检查全部测试的通过和跳过数。三种配方的离线 SDK 准备、源码重建和使用安装版验证重建配对的命令见[离线开发](docs/离线开发.md)。

独立游戏验收时，先从 release 安装并启用，再导出简单 PCK，连续转换两次，打开开发者工具。检查导出的 PCK 没有编辑器插件脚本。确认本项目专属任务状态在游戏目录外，读取日志不会改变导出计划。前后台、存档、中文输入、音频和资源的历史真机结果只适用于原封存包。公网 HTTPS、WSS 和业务登录留待业务接入验证。
