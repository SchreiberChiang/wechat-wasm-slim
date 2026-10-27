# 只关闭启动 3D 预热：电脑侧源码核查

结论：当前成功自编译 GLX 引擎不能通过项目配置关闭默认 3D shader 预热。现有第4项场景启动没有主动构造测试 3D 内容的预热步骤可删。没有生成一个仅写入无效开关的“无预热”PCK，也没有启动重编。

## 精确输入与证据

- 基线是原工具仓库 `.local/glx-case4-alpha-mix-20261027-01/frozen/candidate-glx`，包 `ios-functional-glx-912c537585a6f3a07ef5`，CANDIDATE SHA256 `fa54b3f15d4fbb989bed9bf9a9c67743a1283e803684f17cb5598bf193938215`。完整27文件 manifest、原自编译引擎配对及Brotli解压SHA均核验通过。
- BUILD SHA256 `d2e324538417b829cdd555a03e90847e4a03d556e357daf2871196b741bff85c` 与基线记录一致：`cppdefines` 为空，仅 shader diagnostic 补丁。源码实际 `drivers/gles3/rasterizer_scene_gles3.cpp:4616–4618` 仍执行 `initialize`、`version_create`、无条件 `version_bind_shader(... MODE_COLOR)`。main、drivers/gles3、platform/web 搜索没有 `skip_default_3d_prewarm` / `WX_LAB_RUNTIME_PREWARM_POLICY` / `WxLabStartupControl`。
- 该开关只在 `trim/patches/wx-startup-df3.patch` 的另一构建路线中实现，受 `WX_LAB_RUNTIME_PREWARM_POLICY` 控制；同时要求 `WX_LAB_STARTUP_TRACE`、Web/GLES3、完整3D、单线程等条件。它不是当前引擎可直接读取的内置配置。
- 精确导出源是旧私有目录 `scene-work`（47文件，manifest `11366eb9860daa2445938d8a521fbfd69971c566f2f9d2b55bbbf4140ee952ad`）。仓库样例45文件缺生成的 `fonts/AcceptanceCJK.otf` 和 `fonts/FONT.json`，不能假装两者完整 manifest 相同。首次审计对仓库样例正确拒绝，没有写输出，随后以原导出源复核通过。
- 实际PCK SHA256 `e15c8a6981f87d4ee51f3bc77f4bbf4add697d45666ae30407960731e6f4b86e`；26个目录项全部MD5核验，10个打包GDScript逐字节匹配导出源。`main.gd::_ready` 仅选择 `B01-image`。3D对象创建留在用户选择对应页后的函数中；没有显式 `WxLabStartupControl` / `prewarm_default_3d_shader` / `RenderingServer.force_draw` 调用。该结论是源码路径核查，不是原生绘制跟踪。

## 后续实现边界

若要跳过上述引擎默认 shader bind，必须新增窄范围源码补丁并重新构建成对JS/WASM；可以将现有补丁作为实现参考，但不应不加审查套用整份带计时、控制类和其他启动修改的大补丁。关闭默认shader预热也不等同于禁用3D，首次真正使用3D时的编译延迟仍需另测。

已有完整增量目录为 `E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build`，源码和对象在 `build/engine`，原产物在 `build/artifacts`。本轮未改这些输入。新补丁会改变构建身份，当前 trim 身份门禁会拒绝直接续编旧目录；不能把“存在旧对象”视为已经可安全增量重编。需要独立新工作目录和明确的缓存/对象复用方案，再执行构建。作者预编译不用于此路线。

现有PCK导出工具为 `D:/SteamLibrary/steamapps/common/Godot Engine/godot.windows.opt.tools.64.exe`，实测 `4.7.2.stable.steam.ed1daf0bf`，SHA256 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`。它只负责文本脚本PCK导出，不能为已有GLX引擎添加C++配置能力。本轮只调用 `--version`，没有导出或原生游戏运行。

## 可重复核查

新增自有脚本 `engine/startup-prewarm/audit.mjs` 只读核验，不导入/实例化引擎、不运行构建工具。使用Node内置模块及已有本仓库静态组包校验函数；没有新增第三方依赖、下载、AppID、私有配置或二进制源码附件。旧宿主再分发许可缺口不因这次只读核查解决。

从本仓库目录运行，`--output` 必须是不存在的新目录：

```powershell
node --test engine/startup-prewarm/audit.test.mjs
node engine/startup-prewarm/audit.mjs --baseline E:/AI/wechat-wasm-slim/.local/glx-case4-alpha-mix-20261027-01/frozen/candidate-glx --build-dir E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build --scene-source E:/AI/wechat-wasm-slim/.local/glx-case4-alpha-mix-20261027-01/scene-work --output E:/AI/wechat-wasm-slim/.local/glx-night-prewarm-audit-new
```

本次2项定向测试通过（覆盖构建/开关漂移拒绝及主动调用/起始页检查），实际静态审计通过，结果存于 `E:/AI/wechat-wasm-slim/.local/glx-night-prewarm-20261028-01/AUDIT.json`。复核依赖已保留的精确私有基线与源码，不能称为从干净仓库完整复现引擎的配方。

## 计时与未测范围

本轮不移动、不改写旧启动计时原件，也不将先前用户感知的约30秒全部归因为3D预热。现有整段启动等待还包含宿主、解压、文件系统、引擎初始化、场景资源及首帧等阶段；这次静态审计未测量各段。默认shader bind的存在仅证明该调用路径存在，不能证明其耗时或占比。

没有运行微信开发者工具、手机、上传、云请求、服务器、原生场景、WebGL或GLX。没有改父样例、冻结目录、公共stage脚本、Git提交或问题总表。没有形成可供手机换包的无预热候选。

## 最小补丁交接（同日后续）

根任务要求准备最小guard，重编由根任务的独立受控流程负责。本子任务新增 `engine/startup-prewarm/skip-default-3d-prewarm.patch`，SHA256 `f275b6634d5949cb00e100ab363dbe9d37e8ad6fb171c20b3d43795d1f01bef2`。仅改两文件：`main/main.cpp` 注册默认false的项目设置；`rasterizer_scene_gles3.cpp` 只在Web且设置true时跳过构造函数的默认版本bind。native始终保留bind。initialize、version_create、RID释放、默认材质和实际绘制bind均保留。

范围进一步明确：`shader_gles3.h:183–217` 的bind遇到空variants会调用 `_initialize_version`，后者 `shader_gles3.cpp:736–755` 遍历variant_count并编译该版本各variant的默认specialization。因此这里虽请求MODE_COLOR，跳过的潜在工作涉及这个默认scene shader版本的初始化编译；不应称为关闭全引擎全部shader预热。真实绘制在 `rasterizer_scene_gles3.cpp:3684` 继续bind实际材质版本，缺省特化仍可通过原lazy路径编译；实际3D恢复可用性仍需编译和运行验证。

`patch.mjs` 提供不写文件的 `transform` 和严格两源SHA门禁的 `planPatch(engineDir)`。原成功树 `git apply --check` 通过，未apply。审计与补丁共5项离线测试通过；真值表是精确guard代码的源级控制流模拟，未宣称C++编译或GLX运行通过。命令为 `node --test engine/startup-prewarm/audit.test.mjs engine/startup-prewarm/patch.test.mjs`。

旧增量对象盘点：engine树16,356文件、1,096,917,682 bytes，其中2,110个 `.o`、277,940,656 bytes；完整build树16,368文件、1,173,697,617 bytes，`.sconsign5.dblite` 13,978,531 bytes。现行trim新work必须clone，旧BUILD身份不能接纳新增补丁；没有现成的复制对象seed入口。根任务拟在新私有目录完整普通复制（不硬链接）、保留成功BUILD并写独立INCREMENTAL记录、同工具链参数dry-run后再构建，此处只交盘点与补丁，不执行复制或编译。构造函数4618行前后40行只读摘录留私有审计目录 `rasterizer-constructor-lines4578-4658.txt`。

## 受控增量执行（同日授权扩展）

随后根任务明确将实际增量构建纳入本子任务。新增 `engine/startup-prewarm/incremental.mjs`、合同测试及 `finalize.mjs`，原trim门禁和旧BUILD仍不修改。独立私有根为 `E:/AI/wechat-wasm-slim/.local/glx-night-prewarm-20261028-01/incremental`；新引擎在 `work/engine`、产物在 `work/artifacts`、新记录在 `INCREMENTAL.json` 及最终的 `work/BUILD.json`，父记录原件副本单列 `evidence/PARENT_BUILD.json`。

prepare核对原完整buildIdentity（SDK所有记录文件、原Node路径/version/SHA、Python、026e库、源码pin/diff、profile、补丁），以普通文件复制保留全部对象/.sconsign；完整含隐藏.git的源树16,381文件、1,172,424,115 bytes，2,110对象。逐文件SHA和inode独立性核验通过。先前PowerShell盘点未加Force，未纳入隐藏文件，两种口径应保留区别。

只移动新副本bin根输出和.web_zip到evidence，保留bin/obj全部对象、库和SCons签名，再改两个源文件。新SCons参数仅profile路径迁移，其他参数逐项相同（size、ThinLTO、jobs4、ltojobs2、原库/宏/stack等）。dry-run实际通过：仅main/main.cpp、drivers/gles3/rasterizer_scene_gles3.cpp两编译单元，随后重链接、wrapper和zip生成。8项离线合同测试通过。真实构建已启动并进入ThinLTO链接；结果以独立INCREMENTAL阶段记录及下文后续为准，不能从启动判断完成。

构建后要求新生成的unwrapped/engine/wrapped/wasm/symbols/zip均存在，.web_zip的JS必须逐字节等于fresh wrapped，WASM同样匹配；保存raw副本后才允许godot_process.js执行一次。随后才做压缩、pair/诊断ABI/链接审计，链接审计保留原引擎单独缺nowPolyfill的失败，并要求精确原宿主闭合。任何新缺import/占位实现都不补空函数。

```powershell
node --test engine/startup-prewarm/audit.test.mjs engine/startup-prewarm/patch.test.mjs engine/startup-prewarm/incremental.test.mjs
node engine/startup-prewarm/incremental.mjs --phase prepare --base E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build --toolchain E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/toolchain.private.json --root E:/AI/wechat-wasm-slim/.local/glx-night-prewarm-new/incremental
node engine/startup-prewarm/incremental.mjs --phase build --base E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build --toolchain E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/toolchain.private.json --root E:/AI/wechat-wasm-slim/.local/glx-night-prewarm-new/incremental
node engine/startup-prewarm/finalize.mjs --root E:/AI/wechat-wasm-slim/.local/glx-night-prewarm-new/incremental --base E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build --toolchain E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/toolchain.private.json --host E:/AI/wechat-wasm-slim/.local/glx-case4-alpha-mix-20261027-01/frozen/candidate-glx
```

实际driver必须是原 `C:/Program Files/nodejs/node.exe` v24.18.0，SHA256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`。这是绑定本机已保留依赖的增量复做流程，不是可脱离私有基线/SDK的从零构建配方。编译器/原宿主/库已有许可和再分发边界不变；公开源码未加入二进制、AppID或凭据。

## 实际完成结果

真实SCons于 `2026-10-27T16:09:54.830Z` 启动、`16:30:19.468Z` 正常退出，SCons自身报告20分21.91秒。dry-run和实际build.log均只有上述两个C++编译单元；实际重新生成libmain/libdrivers并链接整引擎，后续wasm-opt保持实际 `-Os`（原 `optimize=size`），实际wasm-ld保持 `--thinlto-jobs=2`。对象复用不意味着整模块链接/优化也只处理两对象。实际命令行观察留私有evidence，旧构建无修改。

原四条warning完整保留：GLX强制C++ exceptions、WebXR依赖内部MainLoop、JS library warning汇总、no-output-file。没有新增链接undefined/missing警告。原三项源码测试通过；fresh raw配对检查和单次后处理通过，后处理decision与父流程一致。新WASM包含项目设置字符串，但运行中是否跳过及启动加速仍未验证。

| 产物 | bytes | SHA256 |
| --- | ---: | --- |
| godot.js | 469508 | `e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb` |
| godot.wasm | 65185272 | `859fc92cb76dad0837f293d73250db347975ace35b71fdfa18f38e36138d8402` |
| godot.wasm.br | 8646741 | `6c9e9a731c3769457d721b383c80017254f21ee7c1c390d329428792d12baee5` |

三文件pair SHA256 `694e90b98c7953f3d35b81b465a53f3c586d2044d4097dc7225e6209a14e30b6`，Brotli解压匹配。JS与父026e引擎逐字节相同，变更在WASM/C++策略中；不能因JS相同认定新引擎运行已经验收。

配套静态结果：JS语法、WASM Module验证/配对审计通过；026e诊断ABI **64/64**；774 imports、43 exports、13 callbacks均保持正确映射。链接审计 **pureEnginePass=false** 保留原单独引擎缺 `nowPolyfill` 的事实，精确912c宿主实现及加载顺序静态闭合 **staticSpecifiedHostPass=true**。未补占位函数；missing-link placeholders、全部placeholder definitions、linkWarnings均为0。与026e父比较的7个功能限制函数全部逐字节相同，未新增或伪装为修复。工具自测另有6项ABI合同通过、linkage fixtures通过，新增8项合同通过。

最终只读准入材料是私有 `incremental/EXACT_HANDOFF.json`，SHA256 `1777774cb7558e60a02dbe8d5b54ba6c8ed726761b5012ace903fc43f44735a8`；schema为 `startup-prewarm-exact-build-handoff-v1`，含新BUILD/INCREMENTAL、精确源变更、参数、三文件、报告、原宿主文件manifest及9个工具依赖hash。新 `work/BUILD.json` SHA256 `0adc405e8cc53c6d6b7656f02aa271c1e7a8d15b7f3d189c7c8c66972c97acbc`，最终INCREMENTAL SHA256 `1aed55be7b8a9059ee3079cb2784c59141fd80ecf76a2e0978fd1dd7353d1418`。phase为 `static-audited`；父全树与BUILD保全再次通过。

INCREMENTAL的actualBuildPlan使用相同两单元解析器处理真实build.log，其中meaning文字沿用dry-run通用提示；实编依据是记录的build进程exit0、实际命令与build.log哈希，不将dry-run代替实编。optimizer原始观察中的sizeFlag只探测-Oz，因此false；其原始命令明确为-Os，最终记录actualFlags已准确列出，不据此认定优化被降低。原始观察不覆盖。

raw JS、engine wrapper、wrapped JS、原WASM、zip、符号均留在 `incremental/raw`；原复制树旧bin输出另留evidence，所有日志保留。源码与SDK身份最终复核一致。没有将本引擎写入既有候选，没有手机、DevTools、上传、服务器或云操作；没有Git提交。后续组包由根任务独立执行，本子任务的 **runtimeSkip=NOT_VERIFIED / startupTiming=NOT_MEASURED**，更不能把原约30秒感知等待推定为已消除。

## 根任务后续组包与电脑运行

上述“未运行/未上传”描述的是引擎构建子任务结束时的状态。随后根任务完成三份精确组包，并在独立电脑副本运行兼容场景+关闭预热的WebGL版：实际基础库3.17.5、实际WebGL、会话55251282。普通2D、首次直接3D的纹理方块、停止按钮和第4页两侧离屏显示可见；第4项门禁记录applied=false、cached-platform-not-android，没有在WebGL启用绕开。没有新增运行时探针来证明guard具体分支，启动加速仍未测。

首次开窗仅停在加载页、没有引擎日志；保留原记录后做了一次普通模拟器编译，随后启动。未改宿主或引擎来消除这一现象，不能把开窗至正常运行的时长当启动性能样本。电脑副本仅两份project配置变化：libVersion=3.17.5、项目名，以及common swc=false/disableSWC=true；冻结候选和手机编译配置未改。截断console查询与可取得的UI正文分别保存，不称完整导出。

新GLX组合候选已仅上传一次二维码预览，手机尚未运行；其身份、manifest和与912c体验基线的区别见[夜间收尾清单](GLX_NIGHT_HANDOFF_20261028.md)。新WebGL运行不代替GLX真机验收，也不认证Android兼容通过。
