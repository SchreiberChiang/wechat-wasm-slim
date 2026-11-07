# Godot 微信小游戏 GLX 插件源码

这是本地唯一维护项目。Claude 修改界面、合并功能、修复错误和维护回归都在本项目进行。用户日常安装相邻的 release。详细入口见 [Claude 合并说明](CLAUDE.md)。

## 开发与安装

1. 使用 Node 24.18.0 和 Godot 4.7.2。运行 `node packaging/configure-workbench.mjs "本机 Godot 编辑器路径"`，再在编辑器导入 `editor/workbench/project.godot`。工程自带右侧插件面板。个人路径和执行收据由本机生成。
2. 编辑器脚本和表单适配器在 `editor/workbench`。任务主入口为 `wxslim.mjs`，`lib/task-core.mjs` 负责计划、执行、取消、状态；`convert/` 负责微信官方转换和宿主；`engine/` 负责引擎、固定来源、补丁和配对审核。普通测试游戏使用 `examples/simple/project.godot`。两关资源夹具作为测试输入外置。
3. 打包前先检查运行文件白名单 `packaging/runtime-files.json`。在已验安装版旁生成新版本，使用 `node packaging/build-release.mjs NEW_RELEASE --reuse OLD_RELEASE` 先看大小和标识，再加 `--write` 写入新的空目录。工具和三份配对按 `packaging/vendor-lock.json` 全量校验。已有发行目录的用户不需要重编 Godot。没有旧安装版时，可通过 `--inputs LOCAL_VENDOR_JSON` 提供由锁文件相对目标名到本机原件绝对路径的映射。
4. 在测试游戏运行新 release 自带的 `install.mjs`。更新旧受管安装时加 `--update`。安装、用户数据目录及日常流程见 [安装版使用](docs/安装版使用.md)。源码本身不需要相邻的 release 才能编辑或生成计划；真实组包需要固定引擎和转换器。

## 自建与审核

固定上游 Godot 提交 `c050c09b105c3715e1caa57a7109cd752047fd89`，工具 Emscripten 4.0.10、SCons 4.11.1、Python 3.14.0、026e 静态库。工作树中保留了固定库、第三方许可、24 个补丁的物化规则、既定 return 0 和 alpha／阴影修正。源码输入、上游存档后端提交和路径见 `engine/official-build-plan.json`、`engine/official-upstream-storage-tail.json`；工具链锁见 `engine/official-toolchain-downloads.json`。编辑器与运行引擎的版本标识分别记录。

```text
python -B engine/official-toolchain.py --root NEW_SDK --base-python FIXED_PYTHON --jobs 4
node wxslim.mjs engine official-capability-plan full
node wxslim.mjs engine official-capability-plan conservative
node wxslim.mjs engine custom-plan engine/custom-2d-plan.example.json
node wxslim.mjs task plan REQUEST.json
node wxslim.mjs task execute REQUEST.json --write --expected-plan-sha256 REVIEWED_DIGEST
node wxslim.mjs engine rebuilt-pair-prepare PAIR_CONFIG.json
node wxslim.mjs official custom-project-plan FEATURES.json BOOT.pck
```

依赖准备器加 `--write` 执行；在面板「新建官方引擎构建计划」选择固定依赖、24 补丁配方与完整、保守或自定义选项。完整／保守的配对配置 schema 为 `wxslim-rebuilt-capability-pair-v1`，包含 rawTaskRoot、rawTaskId、outputJs 和 receipt。配对准备命令加 `--write` 保存。自定义用 `engine/custom-pair-prepare.example.json`，提交给 `custom-pair-prepare` 共享任务。使用新 PCK 先核对被裁掉的模块与场景，再保存生成的 declaration。将准备配置、使用声明、prepared JS、同次构建的 WASM 提供给官方转换表单。启动预热以引擎原生支持为准。历史保守和纯 2D 开发配对继续执行各自的保留原件重审，原 FAILED 收据和锁定路径仍有效。

## 同包测试工具

两种历史配对迁移后可以继续在转换表单的「自建 c050 配对」中使用。在保存原始目录布局的证据根目录放一个 JSON 定位文件，内容为 `{"schema":"wxslim-retained-pair-location-v1","profile":"conservative"}` 或 `{"schema":"wxslim-retained-pair-location-v1","profile":"pure-2d"}`。选择该定位文件、对应的已准备 JS/WASM，以及与启动 PCK 匹配的使用声明。保留整个证据根目录。读取器在独立工作线程中把固定旧路径映射到当前目录，按原始收据、模块和链接记录重新核验。普通自建任务继续使用原来的准备配置。

选择 GLX 完成官方转换后，对本项目生成的本地验收接口、资源配置、启动 PCK 与已绑定的本机 AppID 配置，运行以下命令。目标目录必须是新的。先只读，复核后加 `--write`。此模式使用固定 c050、zh_CN、原生 GLX／WebGL 路由及严格框架锚点。桌面通过 WebGL2，设备仍须实际 GLX。新包号需要各自的运行证据。

```text
node convert/assemble-devtools-device.mjs OFFICIAL_TASK RESOURCE_CONFIG.json NEW_OUTPUT LOCAL_APPID_PROJECT_CONFIG.json
```

## 本地回归

工作台 13 份 Node 测试加预热及真实输出合同涵盖 112 项。保留配对和真实输出测试使用显式外部夹具。填写两个只读输入环境变量后从源码根运行。

```powershell
$env:OFFICIAL_CAPTURE_RAW_DIR = '已批准的完整原始配对目录'
$env:WXSLIM_C050_EXISTING_FRAMEWORK = '已有真实官方转换目录/framework.js'
$forms = Get-ChildItem editor/workbench -File -Filter '*-tests.mjs'
node --test @($forms.FullName) tests/startup-prewarm-option-tests.mjs tests/official-c050-existing-output-tests.mjs tests/official-c050-output-contract-tests.mjs
```

一键运行：`node tests/run-external.mjs --all`。脚本在 `../../clean-20261104` 和 `../portable-proof-01/proof`（也可用 `--root` 另指）里收集原始抓取、转换输出、引擎源码、启动 PCK 和固定 Python，对每个需外部材料的测试逐个尝试候选，由测试自己按固定指纹核验；随后用找到的材料跑全部测试。已手动设置的环境变量优先。2026-11-07 本机结果：11 个此类测试文件全部通过，全量 427 项通过、0 失败。

独立游戏验收时，先从 release 安装并启用，再导出简单 PCK，连续转换两次，打开开发者工具。检查导出的 PCK 没有编辑器插件脚本。确认本项目专属任务状态在游戏目录外，读取日志不会改变导出计划。前后台、存档、中文输入、音频和资源的历史真机结果只适用于原封存包。公网 HTTPS、WSS 和业务登录留待业务接入验证。
