# 默认3D场景shader预编译开关

本目录提供一个最小引擎补丁、基于已保留成功构建的受控增量流程，以及精确候选组包门禁。补丁默认 **false**，只有Web引擎且项目设置true时，才跳过GLES3场景渲染器构造函数中默认scene shader版本的首次bind：

```ini
[startup]
gles3/skip_default_3d_prewarm=true
```

这里只关闭默认场景shader版本的启动预编译。`initialize`、`version_create`、RID释放、天空/Canvas、默认材质以及真实3D绘制的shader bind/lazy编译路径均保留。首次bind可能初始化该默认版本的多个variant，因此不能把它理解为只编译一个MODE_COLOR GPU程序；也不能称为关闭全部shader编译。第一次真正进入3D时可能更慢。本开关不证明原约30秒等待全部来自预热，尚未测量启动加速。

## 文件与固定身份

| 文件 | 用途 |
| --- | --- |
| `audit.mjs` | 只读核对原包、原BUILD/源码、原场景及实际PCK，拒绝把旧引擎的无效配置当作跳过预热 |
| `skip-default-3d-prewarm.patch` / `patch.mjs` | 两文件最小guard及严格源SHA的纯转换，不包含整套旧启动trace补丁 |
| `incremental.mjs` | 在全新私有目录普通复制成功engine树，保留对象/.sconsign，dry-run后受控构建 |
| `finalize.mjs` | 原配对/诊断ABI/链接审计，生成私有 `EXACT_HANDOFF.json` |
| `scene.mjs` | 只新增项目设置的独立场景副本；核对skip-only PCK只有project.binary新增bool true |
| `stage-derived.mjs` | 依赖明确admission及其SHA，对精确引擎、场景和原宿主进行新目录组包 |
| `admission-no-prewarm.json` | 本轮固定准入规则；与私有原始规则同SHA，不能替换成任意pass报告 |

本轮补丁SHA256为 `f275b6634d5949cb00e100ab363dbe9d37e8ad6fb171c20b3d43795d1f01bef2`，准入规则SHA256为 `58d85021af23c438bcb1f2fc8ed471932f31f3841d7338b1496c60fc543e69e9`。旧的公共stage和原库admission规则保持原样。

## 必要公开依赖与本地输入边界

- 源码是 [citizenll/godot](https://github.com/citizenll/godot) 固定提交 `df3cdd9bc9941a20cb5575d781cde6f937637bcb`，保留原shader诊断补丁及Windows链接适配。
- 工具链基于 [Emscripten](https://emscripten.org/docs/getting_started/downloads.html) **4.0.10**、[SCons](https://scons.org/) **4.11.1**、Python，以及Node内置Brotli。SCons wheel使用仓库 [requirements-scons.lock](../requirements-scons.lock) 的哈希；公开SDK准备参考 [BOOTSTRAP.md](../BOOTSTRAP.md)。本目录的JavaScript脚本不新增npm依赖；既有ABI/链接审计使用已固定SDK自带Acorn。
- 本轮构建driver是原Node **24.18.0**，SHA256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`。链接审计另用SDK内固定Node **24.19.0**，二者角色不能混淆。Python/venv及基础解释器、SDK关键文件、库、profile和实际driver路径均必须匹配父BUILD指纹；复制Windows venv不消除其基础Python依赖。
- PCK导出使用Godot **4.7.2.stable.steam.ed1daf0bf**，工具SHA256 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`。它只导出PCK，不替代这里自编译的Web引擎。已有字体及许可原件应随场景输入保留，无需为本实验重新下载字体。
- 必须自行提供已获授权且SHA256为 `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8` 的GLX静态库。本目录不分发该库，不用作者预编译引擎替代，不将旧库下载链接冒充这个新库来源。闭源库及原宿主SDK/loader/adapter的使用和再分发许可边界仍需保留。

**干净仓库加公开依赖不足以直接复做本次精确增量。** 还必须保有原成功BUILD、完整engine树（含对象/.sconsign/.git）、原profile、私有toolchain配置及其真实依赖、精确912c父候选、原导出场景和PCK、私有审计及handoff。公开规则只有哈希和安全元数据，不携这些二进制、私有配置、真实AppID或机器目录。缺输入时应明确停止；不能改旧BUILD、减弱SHA门禁或改规则来接受其他机器的新构建。

完整从零引擎构建的背景见 [engine README](../README.md)；更换SDK/driver或原工作位置应建立新身份及新配方，不能冒充本轮已有对象的精确重用。

## 在保留现场上复做

本轮新补丁目录和兼容场景有逐字节Git属性。对其它历史指纹依赖，独立取仓库时使用 `git -c core.autocrlf=false clone <repository> <new-directory>`，不修改用户全局配置；之后仍逐文件校验admission，不将换行变化误认成同一输入。

从仓库根目录运行。下例只通过环境变量接收本地路径，不含真实机器目录或AppID。将变量设为你有权使用、与固定记录匹配的输入；所有输出目录必须不存在，并与输入分离。`PREWARM_BUILD_NODE` 指向原始driver，脚本仍会核对实际路径、版本和文件SHA；设置变量不会绕过该检查。

```powershell
$driver = $env:PREWARM_BUILD_NODE
$base = $env:PREWARM_PARENT_BUILD
$toolchain = $env:PREWARM_TOOLCHAIN
$parent = $env:PREWARM_PARENT_CANDIDATE
$scene = $env:PREWARM_ORIGINAL_EXPORTED_SCENE
$auditOut = $env:PREWARM_NEW_AUDIT_DIR
$run = $env:PREWARM_NEW_INCREMENTAL_DIR

& $driver --test engine/startup-prewarm/audit.test.mjs engine/startup-prewarm/patch.test.mjs engine/startup-prewarm/incremental.test.mjs
& $driver engine/startup-prewarm/audit.mjs --baseline $parent --build-dir $base --scene-source $scene --output $auditOut
& $driver engine/startup-prewarm/incremental.mjs --phase prepare --base $base --toolchain $toolchain --root $run
# prepare只有严格两单元dry-run通过才会记录dry-run-approved；否则不要执行build。
& $driver engine/startup-prewarm/incremental.mjs --phase build --base $base --toolchain $toolchain --root $run
& $driver engine/startup-prewarm/finalize.mjs --root $run --base $base --toolchain $toolchain --host $parent
```

prepare核对父身份和源码后，普通复制全部文件并逐文件校验内容、文件身份；不建硬链接。只移走新副本bin的旧生成输出至evidence，保留bin/obj和.sconsign。参数仅profile路径随副本迁移：仍为size、ThinLTO、jobs4、ltojobs2、原库及原宏/stack。实际本轮共 **2110个既有.o对象，2个C++单元对应对象重编、2108个复用**；整体链接和wasm-opt仍需处理完整引擎，不等于只优化两个对象。

新流程不调用旧BUILD的续编门禁来伪造身份。父BUILD副本单列evidence，独立INCREMENTAL记录每阶段，新BUILD只在真实构建完成后生成。raw unwrapped/engine/wrapped JS、WASM、zip、符号及日志全部保留；fresh wrapped必须与新.web_zip输入一致，然后后处理一次，禁止叠加处理旧JS。失败、输入漂移或额外编译单元不自动放宽。

场景准备使用 `scene.mjs` 的 `prepareScene({source,target})`，然后用固定Godot工具对新副本导入并 `--export-pack Web`；原场景不改。skip-only应调用 `compareSkipOnly(beforePck,afterPck)`，要求26项中只有project.binary新增该bool true，其余条目和配置属性字节完全相同。compat变体使用独立兼容测试场景；不能把它当作仅配置变化的对照。门禁还会核对各变体固定的源manifest和实际PCK，任意重新导出结果不自动获得本轮准入。

对已有本轮精确handoff和场景，组包命令为：

```powershell
$pck = $env:PREWARM_ADMITTED_PCK
$source = $env:PREWARM_ADMITTED_SCENE_SOURCE
$out = $env:PREWARM_NEW_CANDIDATE_DIR
& $driver --test engine/startup-prewarm/scene.test.mjs engine/startup-prewarm/stage-derived.test.mjs
& $driver engine/startup-prewarm/stage-derived.mjs `
  --parent $parent --handoff "$run/EXACT_HANDOFF.json" `
  --admission engine/startup-prewarm/admission-no-prewarm.json `
  --admission-sha256 58d85021af23c438bcb1f2fc8ed471932f31f3841d7338b1496c60fc543e69e9 `
  --scene-pck $pck --scene-source $source --variant skip-only --mode glx --output $out
```

此admission绑定的是**已有本轮**handoff SHA，不是新一次构建完成就能复用的通用许可。重新构建会产生新的时间/元数据hash，即使二进制恰好相同，也必须重新审阅并建立相应准入规则。compat分别显式选择 `--variant compat --mode glx` 或 `--mode webgl`，每次使用新的输出目录。组包仅本地写文件，不上传或打开开发者工具。

## 本轮结果与证据边界

本轮SCons正常退出，实际只编译上述两C++文件；原三项源码测试和64项诊断ABI检查通过。新pair为 `694e90b98c7953f3d35b81b465a53f3c586d2044d4097dc7225e6209a14e30b6`；JS与父包逐字节相同，WASM/BR来自新编译。774 imports、43 exports、13 callbacks的静态映射通过。

**pureEnginePass=false**：单独引擎仍不提供 `nowPolyfill`，原始审计失败及退出码保留。固定原宿主实际定义该函数并满足加载顺序，故 **staticSpecifiedHostPass=true**；没有注入占位函数，未发现新增缺失imports或missing-function placeholders。这个结论只对精确宿主成立，不表示引擎可以脱离宿主运行。

| 本地候选 | 包身份 | CANDIDATE SHA256 |
| --- | --- | --- |
| 仅关闭预编译 / GLX | `selfbuild-no-prewarm-skip-only-glx-6fe7de26850d892cc929` | `916774ac887de8610bc96782ddb7f18716735e9baf7bb75399e8a854cb89f25d` |
| 兼容场景+关闭预编译 / GLX | `selfbuild-no-prewarm-compat-glx-50b90ca0f078fdbccc91` | `3654a344944da34f3c3d955610851fd3ccdf3093fb54596a8d01366c629908b2` |
| 同兼容场景 / WebGL | `selfbuild-no-prewarm-compat-webgl-bbd878778ad0703b5d7b` | `e169c6d6a93aa4cb413b9419208748353b1a1ed826dc1d304bfc8e90d38702a6` |

三包各27文件，本轮实际改变7路径，JS未改变，原relay关闭。stage成功只证明精确文件/身份和静态合同，不是手机画面、功能或性能验收。它们均为 `runtime=not_run`、`prewarmRuntimeSkip=NOT_VERIFIED`、`startupTiming=NOT_MEASURED`、未上传；新引擎的首次3D延迟、GLX表现和启动加速均待独立运行验证。完整私有handoff/日志不可当作公开源码附件提交。
