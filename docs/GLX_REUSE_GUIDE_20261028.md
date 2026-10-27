# 自编译完整GLX引擎：跨项目复用输入与步骤

本指南整理已保存实现和真实依赖，不运行构建或修改其他项目。**当前不是“干净克隆即可导出微信小游戏”的交付工具包。** 不能只复制测试场景，也不能把旧库stager、作者预编译WASM或任意SDK拼接成已验证方案。

## 已在Git的部分

仓库：`SchreiberChiang/wechat-wasm-slim`；分支：`codex/glx-godot-newlib-20261026`。以下提交已在本轮开始前推送；本轮不重复提交实现。

| 提交 | 保存内容 |
| --- | --- |
| `3e4c7e4` | 官方026e库自主完整构建的审计源码/测试、依赖指纹和脱敏手机记录；不含第三方运行文件 |
| `79f0ee8` | 功能场景、内容派生、912c基线/四模式源码及脱敏记录 |
| `2fb8099` | 两文件预热开关补丁、保全基线的增量构建、JS/WASM审计与精确stage/admission |
| `4bd2f74` | 第4项场景级兼容、专用MIX shader、门禁与原生图形测试；不改引擎/库 |

主要源码入口：

- [构建器](../trim/lib/build.mjs)：构建身份、Windows链接适配、原始输出后处理、配套产物。名字中有trim，但当前采用完整profile，不启用裁剪或WASM代码分包。
- [预热补丁与受控增量流程](../engine/startup-prewarm/README.md)：`patch.mjs`、`skip-default-3d-prewarm.patch`、`incremental.mjs`、`finalize.mjs`。
- [内容派生](../engine/functional-acceptance/stage.mjs)及[新引擎精确组包](../engine/startup-prewarm/stage-derived.mjs)：包含原宿主身份/模式/配套校验；是固定历史包的门禁，不是任意项目导出器。
- [原诊断补丁生成器](../engine/shader-type-return/prepare-source-patch.mjs)及[shader诊断实现](../engine/shader-failure/README.md)：当前引擎仍包含它们，不能在追求同一引擎身份时无记录地删除。
- [局部兼容](../examples/glx-opaque-alpha-compat/opaque_viewport_compat.gd)、[配套shader](../examples/glx-opaque-alpha-compat/opaque_viewport_mix.gdshader)。业务接入点必须自己明确提供已知非透明SubViewport和普通TextureRect，不照搬测试页`views[0]/worlds[0]`的索引。

本轮另外公开实际使用的[完整profile原字节](../engine/startup-prewarm/full-profile.gdbuild)：93bytes，SHA256 `920ca801a58fe5bfb0f56aa39a1d523adae9658233189d6518b17e3c5b98e81b`。它不禁用类或构建选项；实际构建记录保留46模块。不是2D专用profile，也不表示Web目标支持全部Godot功能。

未跟踪的历史`engine/official-glx-library/admission-026e.json`、`admit-candidate.mjs`、`stage-webgl-control.mjs`继续私有保存：当前运行包和新stage不直接依赖它们；恢复026e→912c历史父链时仍需它们及私有原件。它们不是可通用公开入口，本轮不把这些绑定现场的文件混入提交。

## 不能省略的外部输入

详细原安装关键文件指纹见[依赖证据JSON](evidence/GLX_GODOT_NEWLIB_CHECKPOINT_20261026.json)。以下“获取”是来源/授权方式，不代表本轮下载或验证了新的安装。

| 输入 | 固定身份与取得方式 |
| --- | --- |
| Godot源码 | [citizenll/godot](https://github.com/citizenll/godot)，提交`df3cdd9bc9941a20cb5575d781cde6f937637bcb`；保留构建所记录的原补丁/Windows链接改动 |
| 原诊断补丁 | SHA256 `84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6`；由已公开生成器及固定源码产生，生成后仍须核验原记录 |
| 预热补丁 | SHA256 `f275b6634d5949cb00e100ab363dbe9d37e8ad6fb171c20b3d43795d1f01bef2`；已公开原字节 |
| 官方新GLX库 | `libemscriptenglx.a`，3866614bytes，SHA256 `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。由用户联系微信官方取得的附件提供；向微信官方支持申请配套库/授权后核验，当前无已确认公开下载URL/再分发许可 |
| 官方附件归档 | `libemscriptenglx.zip`，SHA256 `85c3b2c7163b10131f22a43fd72dc2e8e66135780166a3794a4b6adc62a307c9`。库内版本/时间字符串不是独立确认的正式发布版本 |
| 工具链 | Emscripten4.0.10，提交`b7dc6e5747465580df5984e723b9d1f10d8e804b`；[emsdk](https://github.com/emscripten-core/emsdk)原安装提交`35ff8a6d150541276abbc6bae512ca90bcfbe220`。原下载归档hash未完整证实，不把另一套bootstrap当作该安装 |
| Node角色 | 构建driver24.18.0，SHA256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`；SDK中的Node24.19.0用于固定静态审计。角色不能随PATH悄悄切换 |
| Python/SCons | 实际构建venv基于Python3.14.0，SDK内另有Python3.13.3；SCons4.11.1，[wheel锁](../engine/requirements-scons.lock)。venv复制仍依赖原基础解释器，不是独立可搬移安装 |
| 解析器 | SDK内Acorn8.14.1，dist SHA256 `1a2ecc215e880c7db77add51deca05b9b323d63a650ae0534298352913b202b5`；不能把目标JS执行当成静态解析 |
| 原宿主资产 | [hao0917 release4.7](https://github.com/hao0917/godot-minigame/releases/tag/4.7)，归档`minigame4.7.0.8.1.tpz` SHA256 `c4673dd16b397be7c6bcd0c9bd038d20008be5b4586cdaea60be552326a50be7`。获准使用后取得宿主输入；不采用它的预编译引擎。使用/再分发授权需自行确认，不随本仓库公开这些资产 |
| PCK导出器 | Godot4.7.2.stable.steam.ed1daf0bf，SHA256 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`。只导出游戏PCK，不替代自编译Web引擎 |
| 测试中文字体 | Noto Sans SC Regular2.002，源SHA256 `a2b93e6c2db05d6bbbf6f27d413ec73269735b7b679019c8a5aa9670ff0ffbf2`，fontTools4.60.0；按对应`build_font.py`生成，保留OFL/NOTICE。其他游戏可自行准备有权使用的字体，不能套旧字体覆盖记录 |

本机原件及完整构建保存在交接清单的`.local`恢复入口和此前私有备份中；访问这些材料需由所有者授权。私有toolchain填写的是本机真实SDK/库/解释器路径，不分发真实AppID、账号、凭据或路径配置。**不把公开旧库0.1.11下载地址冒充026e附件来源**。

## 引擎和宿主的完整运行链

`game.js → adapter/config/relay/mode/observer → GodotLoader → engine/game.js → 先godot-sdk.js、后生成godot.js → GODOTSDK.startGame → 配套WASM与游戏PCK`。

保留既有引擎资源包加载布局，不新增WASM代码分包。以下是当前封存宿主指纹：

| 文件 | SHA256 |
| --- | --- |
| `engine/godot-sdk.js` | `f0f648b6778446a990b9865b8d577674f439348f8a3cef622e56ae13b8fda46e` |
| `godot-loader.js` | `1dd408fa7a69e2f4652033d6f08c12d70bb6f233cb3074bd0e7510173aa1ae1b` |
| `weapp-adapter.js` | `84c679ae0a6dbb226afb24110860e5142ac113a2e3a00a93449a09edeb4647f6` |

它们不是三个可以随意替换的小辅助文件。SDK承接WASM/文件系统/音频等接线，并在引擎前提供`nowPolyfill`；生成引擎独立审计仍为`pureEnginePass=false`，精确宿主静态闭合才为true。不得补普通空函数掩盖缺项。GLX加载页延后创建上下文及清理终态补丁由[engine-first](../engine/loader-engine-context.mjs)和[terminal](../engine/loader-terminal.mjs)记录；当前完整宿主也包含已有模式/身份/本地诊断差异，不能只对原归档复制一个loader就宣称同包。

最终提交仍由原库/生成胶水/原SDK协作：afterDoFrame→native command flush→batch/swap。不要再手工注册第二套flush/swap，不复制独立三角形或RuntimeError探测宿主。默认WebGL与显式GLX门禁都要保留；GLX能力/实际上下文不符应清楚拒绝，不能静默回退后称GLX通过。

## 将其他游戏导出为PCK并准备新候选

1. **先取得合法且成对的完整引擎＋完整宿主。** 复用现有引擎不必重编，但JS/WASM/BR必须一起校验；只从WASM中换一个静态库不成立。当前关闭预热版JS、WASM、BR及pair哈希见[夜间清单](GLX_NIGHT_HANDOFF_20261028.md)。保留原27文件包，新项目另建输出目录。
2. 用固定Godot导出器及自己游戏的Web preset导入/导出PCK；选择GL Compatibility，不套本测试项目的尺寸、入口、灯光、清屏色、导出排除清单或2D profile。当前引擎是单线程、无GDExtension；游戏需要的模块/功能应另核对。本轮不处理裁剪或WASM分包。

   ```powershell
   # 变量由使用者指向自己的合法输入/全新输出；这里只导出PCK。
   & $godot --headless --path $gameSource --editor --import --quit
   & $godot --headless --path $gameSource --export-pack Web $newPck
   ```

   自动化调用Windows GUI exe必须等待实际进程退出并保存stdout/stderr，不能仅凭PowerShell旧LASTEXITCODE当成功。字体/贴图导入缓存和脚本排除项要实际检查。当前SDK入口读取`/engine/empty-tips.bin`，新组包时须保证实际PCK路径与入口一致；不要保留测试场景的PCK。
3. 只有新补丁引擎支持下列设置，旧引擎写同名配置没有效果：

   ```ini
   [startup]
   gles3/skip_default_3d_prewarm=true
   ```

   默认false，仅跳过默认scene shader版本的构造阶段bind，不关初始化、3D或所有shader；首次3D可能更慢。当前手机反馈只有体感更快，没有定量启动改善证明。
4. 业务若确有同类非透明离屏显示，先将局部兼容节点加入场景树并保持其生命周期，再显式调用`configure(普通TextureRect, 已知非透明SubViewport, true, 已观察宿主上下文)`；销毁时沿用detach/退出清理。configure只立即检查一次，持续换源/材质门禁依赖_ready注册的frame_pre_draw信号。不能从`ViewportTexture.has_alpha()`推定源是否透明。上下文必须来自本次真实缓存，不能写死Android/GLX。保持原MIX、RGB、UI/父alpha；iOS/WebGL/未知平台、透明源、NinePatch、已有或父材质、自定义脚本等拒绝。换源时按原脚本撤销自己的材质。不要把此候选用作通用alpha修复。
5. AppID/路径只填在新项目的私有配置。重新生成**新项目身份与精确准入**，核查27文件依赖/新PCK/实际后端；不能沿用50b90ca0或912c的标识。当前`stage-derived.mjs`只接受精确912c父包和本轮两个固定PCK，**会拒绝任意业务PCK**；通用新项目组包入口尚未完成验证，本轮不放宽规则或手工篡改封存metadata。

因此步骤1–4解释已有接入合同，步骤5是其他项目实际落地前仍需完成的明确工作；不是一条已经验证过的跨项目“一键命令”。

## 如确需重新构建引擎

使用固定源码、原诊断/Windows链接补丁、完整profile、026e库和准确工具链。原参数保持`platform=web target=template_release threads=no optimize=size lto=thin --jobs=4`及ThinLTO jobs2/原栈/宏/链接参数。完整参数以BUILD/公开指纹为准，不能从本段短列表重造一个“等价”配置。原参数含`ERROR_ON_UNDEFINED_SYMBOLS=0`，所以编译退出0不够，必须另审实际imports/exports、链接警告及占位实现。

对本机保留现场，按[预热目录README](../engine/startup-prewarm/README.md)执行独立复制→两单元dry-run→受控增量→从fresh raw JS单次后处理→压缩→配套审计；2110对象中2个重编、2108复用，但全模块ThinLTO/wasm-opt仍执行。原BUILD与冻结包不能覆盖。

新机器须另做冷构建身份。旧[prepare-selfbuild.ps1](../engine/prepare-selfbuild.ps1)、[通用旧stager](../engine/stage-candidate.mjs)仍固定c70b旧库，不能直接拿它们构建/认证当前026e方案。公开bootstrap另用过不同Node版本，也不代表成功原安装。当前增量要求原BUILD、完整对象树、原driver路径与私有toolchain，不伪造这些记录。

配套审计的实际入口如下；输出必须全新目录。它们仅静态检查，不实例化WASM或证明手机出图：

```powershell
& $buildNode engine/audit-pair.mjs --build-dir $build --out $newPairJson
& $sdkNode engine/official-glx-library/audit-diagnostic-abi.cjs --build-dir $build --sdk $sdk --out $newAbiDir
& $sdkNode engine/official-glx-library/audit-linkage.cjs --build-dir $build --sdk $sdk --out $newLinkDir --host-dir $sealedHost
```

`$sdkNode`为审计锁定的SDK Node24.19.0。链接工具仍可能因单独引擎nowPolyfill返回1；必须保留该结果，并逐项确认`hostClosure.staticSpecifiedHostPass`、全部实际import映射、13回调和零missing占位/警告，不能吞退出码或只看pass摘要。当前固定64 ABI/774 imports/43 exports是这一套产物的审计范围，不外推任意新构建。

## 当前限制与仍未完成的复现工作

- 宿主生成/历史修改到当前27文件原件的链路尚未完全搬移；合法原件及其指纹仍是外部输入。
- 成功工具链原下载归档、Node/Python基础安装来源证据不全；公开工具安装流程不等于复现了同一安装。
- 新项目任意PCK的通用组包/新身份准入尚未验证；不得通过关闭旧门禁假装解决。
- 本轮Android第4项兼容左右正常是有限人工反馈；第3项半透明仍不显示。当前SDK/会话未新增日志独立核对，iOS观察无异常不等于全部功能通过。
- GPU读回/网格往返已有GLX限制记录；不从已有不透明shader、骨骼上传或32像素历史探针成功推定读回均可用。压缩纹理新出口存在也不等于该扩展已经运行验收。
- 已有Parse JSON错误和浮点纹理警告保持独立记录；不以观察正常宣布无错误、全设备稳定、性能提升、裁剪或分包通过。

本轮不补通用导出框架、不改引擎/库、不执行新构建。新增手机预览、业务项目接入和新依赖授权仍须按对应范围确认。
