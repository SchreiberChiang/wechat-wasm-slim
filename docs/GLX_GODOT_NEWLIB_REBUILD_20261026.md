# 完整 Godot + 官方新 GLX 库：正确环境构建结果

本轮完成电脑侧完整构建与配套静态审计。没有上传、运行手机、改服务器、裁剪、WASM 代码分包或赛车业务改动。

## 结论

- **构建通过**：原 Node 24.18.0、Emscripten 4.0.10、固定 Godot 源码和原参数，SCons 单次完成，44.11 分钟，无重试。随后原 JS 后处理、Brotli 压缩和符号保存均完成；保留 46 个模块。
- **配套静态审计通过，限定于原封存宿主**：JS/WASM/Brotli 配对正确，64 项 ABI 检查通过，774 个 imports 在这套指定宿主中都有定义，43 个 exports 已读取。没有缺失函数占位实现或未解析符号警告。
- **具备申请一次真机首开的条件**：本地候选已封存，尚未预览或实际启动。不能据此说首开、重进、前后台恢复或原黑屏问题已经通过。

候选：`godot-official-glx-026e-a169d60be3d6db10c33c`。

## 输入及改动范围

| 输入 | 固定身份 |
| --- | --- |
| 构建驱动 | `<NODE_24_18_EXE>`，v24.18.0，SHA256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| Emscripten | 4.0.10，`b7dc6e5747465580df5984e723b9d1f10d8e804b` |
| Godot 源码 | `df3cdd9bc9941a20cb5575d781cde6f937637bcb` |
| 原诊断补丁 | `84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6` |
| 完整 profile | `920ca801a58fe5bfb0f56aa39a1d523adae9658233189d6518b17e3c5b98e81b` |
| 新库 | `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`，3,866,614 bytes |
| 原库（保留） | `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |

新库仍为用户提供的官方附件 `libemscriptenglx.zip` 解压后已核验的同一文件，没有加入其他库。库内 `0.1.0 / 2026.09.02` 仅作为嵌入声明记录，准确发布版本、完整变更记录及是否与作者成品使用同一原件仍未知。

工具链 JSON 仅 `glxLibrary` 和 `glxLibrarySha256` 两项变化。实际完整 build identity 除外部库身份外，与旧 BUILD 完全相同；实际 SCons 参数只有隔离 profile 的存放路径和外部库路径不同，profile 字节没有变化。源码 tracked diff、所有补丁和新增源码逐项保留，原宿主、GLX 初始化/提交接线和渲染代码未改。

原参数仍包括 `ERROR_ON_UNDEFINED_SYMBOLS=0`。没有改成宽松的新参数，没有补空函数，也没有修改原门禁来接受新库。

## 产物身份

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `godot.js` | 469,508 | `e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb` |
| `godot.wasm` | 65,184,325 | `ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244` |
| `godot.wasm.br` | 8,649,514 | `a3fa7032ace37840021c58bd06b6b49f7b0468c01dde4b9d63a33bc2d2cd82cf` |

- 完整 BUILD SHA256：`d2e324538417b829cdd555a03e90847e4a03d556e357daf2871196b741bff85c`。
- 三文件配对身份：`399b6522bd17f135087a669a9934ac68832efad837ad9fca418208a6dbbc316a`；Brotli 解压结果与原 WASM 逐字节一致。
- 候选 `CANDIDATE.json` SHA256：`10157ec424746065718eb0929d91c046e43c045ec09509206416d412dd2ed2d3`。

## 链接和配套审计

1. 四条编译/链接警告全文与旧基线一致：GLX 强制 C++ exceptions、WebXR 对 MainLoop 的内部依赖、JS library warning 汇总、一次 no-output-file 提示。没有新增 warning，也没有 undefined symbol/reference 或 missing-function 警告。
2. 全部 774 个 WASM imports 逐项映射到 JS 定义；其中 773 个在生成引擎内闭合，`_emscripten_get_now -> nowPolyfill` 由原宿主实际定义并在引擎前加载。原始审计中的 `pureEnginePass=false` 和命令退出码 1 **保留**；它表示单独引擎不自带该全局函数。另列的 `staticSpecifiedHostPass=true` 是这套固定宿主的配套结论，不是忽略未解析项或注入替代函数。
3. 相对旧基线新增的 15 个逻辑 imports 均有具体函数定义。43 个 exports 已解析；四个核心 GLX 出口的最终 WASM 签名与旧包一致，九个新增纹理回调均有真实 Module→WASM 出口。
4. 对实际 imports 和整份 JS 的扫描均未发现 missing-function 占位。七项功能限制启发式结果中，六项与旧代码逐字节相同，另一项覆盖整个 async 引擎工厂，因新增胶水代码而变 hash；它所包含的 WXMEMFS guard/警告完整 2,450 bytes 与旧代码一致。原分类和两种 hash 均保留，未把它改写成新增链接缺项或七项全同字节。
5. 原有七个 shader 诊断 ABI、原始返回观察、guard、动态调用和 stack 恢复检查完整保留；新库专用 ABI 共 64 项通过。原 JS 后处理 decisions 日志与旧基线完全相同，原 afterDoFrame→native flush、batch 和 swap 路径保留。
6. 原三项源码测试通过；审计 ABI 工具六项测试、链接审计 fixtures 和精确准入七项测试通过；整份生成 JS 语法检查通过。WASM 经过本地 Module 验证但未实例化，没有调用引擎工厂或启动游戏。

链接审计工具自身使用此前锁定的 SDK Node 24.19.0，仅进行静态解析；它与生成引擎所用的 Node 24.18.0 是两个分别记录的角色，没有重新改变构建驱动。

新库压缩纹理/下载扩展受开关和纹理标识条件控制。原宿主未启用该扩展，九个出口齐全不代表该路径、纹理表现或下载 SDK 已经过运行验证。

## 精确准入与封存

新增 `engine/official-glx-library/admission-026e.json` 和 `admit-candidate.mjs`，仅允许本次 `-02` 的精确 BUILD、原 Node、026e 库、三产物、6 份报告、25 个工具依赖、112 个冻结输入及 03fa 父包完整 27 文件树；没有 override 参数。规则 SHA256 为 `dde051343ca17788dfecc5b2879182e5683c50187970707cde2b4633b54523d0`。

旧库准入脚本和旧 ABI 检查不变。新规则保留单独引擎的失败事实，要求固定原宿主的真实实现和顺序证据，并检查每一个 import 对应关系；不是接受任意 `pass:true` 报告。

新候选依然是 27 个文件。相对旧包只允许七条路径变化：配套 `engine/godot.js`、`engine/godot.wasm.br`、两处候选身份、两个 projectname 和新的 CANDIDATE manifest。adapter、loader、主入口、SDK、PCK、资源、既有 observer、game.json 均逐字节保留；relay 保持关闭。继承的资源目录布局没有新增 WASM 分包。

## 本地恢复及复现入口

- 分支：`codex/glx-godot-newlib-20261026`，基于 `28c4f2eff2d98451193470a808aba8e1348399c6`。
- 本次目录：`.local/glx-godot-newlib-build-20261026-02`。
- 新候选：上述目录下的 `candidate-glx`；原始产物位于 `build\artifacts`。
- 旧完整包和原始失败证据：`.local/glx-shader-type-return-20261024-01`，其 `candidate-glx` 和 `candidate-webgl` 均保留。
- 上次中断目录 `glx-godot-newlib-build-20261026-01` 和[中断记录](GLX_GODOT_NEWLIB_BUILD_20261026.md)保持原样。构建后重新校验的 80 个保护文件全部匹配。

本次 `prepare.mjs` 保存完整前置身份核验，`run-once.ps1` 保存准确命令及二次 driver 校验，PREPARATION/BUILD 记录全部参数。它们仍绑定原本机路径、旧基线和中断记录，**不能直接当作干净仓库的可搬移复现配方**；仅有新空目录仍不够。准确依赖、宿主生成链、拟整理脚本与许可缺口见[保存审阅清单](GLX_GODOT_NEWLIB_CHECKPOINT_20261026.md)。原脚本作为历史构建证据保留；本轮未重新运行，不覆盖已完成或已中断目录。

原精确准入脚本及规则仅随私有备份保存，绑定既有历史现场；本公开检查点不提供可脱离该现场运行的准入命令。保存现有结果不等待可搬移配方完成，三个后续任务单列。

具体审计及保全证据为本次目录的 `PAIR_AUDIT.json`、`audit-abi\abi-audit.json`、`audit-linkage\linkage-audit.json`、`COMBINED_STATIC_AUDIT.json`、`PRESERVATION_AFTER_BUILD.json` 和 `FINAL_INTEGRITY.json`。原始日志、二进制、包和私有配置只留本地。

下一步可申请本候选的一次真机首开：现场核对实际基础库、候选身份和 GLX，确认可见画面与动画，失败即停；本轮未执行此步骤，也未授权自动重进或稳定性验收。GLX-01/02/14/15 保持未关闭。
