# 夜间保存与下一轮iOS回归（2026-10-28）

本轮未操作手机/ADB，未切基础库、清缓存、改服务器、采用作者引擎替换或接入裁剪分包。默认WebGL与旧冻结包保留。

## 体验版和预览分别记账

体验上传基线是自编译 `ios-functional-glx-912c537585a6f3a07ef5`，8页第三轮+第4项四模式诊断，不带本轮预热/兼容修改。版本 `glx912c-20261028`；只调用一次上传，首次返回confirmation_upload/pending。续接时只查询原任务，已取得success/execution_success，工具记录完成时间为北京时间00:03:03.996；总包9268432bytes，27文件副本事后仍精确。**开发版本上传已确认成功，后台体验版指向仍未核验**。不以shell退出码代替终态，没有重发上传。后台观察被安全策略阻止，未绕过；用户需在版本管理核对/设置准确版本，不涉及正式发布。此前用户报告手动上传的事实仍保留，其后台指向同样未独立核验。

新的iOS二维码预览服务已成功，不覆盖体验版；27文件上传前后逐字节一致，未扫码或打开手机。项目继承的配置不等于手机实际基础库，实际版本待日志确认。

| 候选 | CANDIDATE SHA256 | 状态 |
| --- | --- | --- |
| `ios-functional-glx-912c537585a6f3a07ef5` | `fa54b3f15d4fbb989bed9bf9a9c67743a1283e803684f17cb5598bf193938215` | 原基线；开发版上传成功/体验版指向未知 |
| `selfbuild-no-prewarm-skip-only-glx-6fe7de26850d892cc929` | `916774ac887de8610bc96782ddb7f18716735e9baf7bb75399e8a854cb89f25d` | 只关预热对照，未上传/未运行 |
| `selfbuild-no-prewarm-compat-glx-50b90ca0f078fdbccc91` | `3654a344944da34f3c3d955610851fd3ccdf3093fb54596a8d01366c629908b2` | 一次二维码预览成功；手机未测 |
| `selfbuild-no-prewarm-compat-webgl-bbd878778ad0703b5d7b` | `e169c6d6a93aa4cb413b9419208748353b1a1ed826dc1d304bfc8e90d38702a6` | 仅独立电脑参考；未上传 |

二维码JPEG SHA256 `4c4b1651c29295ed9c4da8742990de5d74046d667d36ec56d08f32b1b396ec68`。码失效须明确申请重新预览，不自动重传。

## 两类改动独立保存

- 引擎只增加默认false的Web开关，跳过构造函数默认scene shader版本bind；initialize、version_create、RID释放、正常3D lazy bind保留。仅2个C++重编/2108个其他对象复用，仍完整ThinLTO/wasm-opt，SCons20分21.91秒。不是关闭全部shader，也不证明原约30秒全由此造成；首次进入3D可能更慢。[构建审计](GLX_NO_PREWARM_20261028.md)、[启动证据边界](GLX_STARTUP_EVIDENCE_20261028.md)。
- 第4页场景级兼容只允许显式Android+实际GLX、注册非透明SubViewport及普通无脚本TextureRect；MIX保留RGB和UI/父alpha，不依赖源纹理alpha。透明源、NinePatch、自定义/父材质拒绝或撤销；iOS/WebGL关闭，第3页不改。兼容场景取消四模式探针UI，保留原左右对照及其它七页。这是绕开现象，非根因修复。[范围与回归](GLX_OPAQUE_VIEWPORT_COMPAT_20261028.md)。

仅关预热PCK `3324d9741e29d31d6ce9aa4843b55cb26814c74a086515f74eeb5c1a0c182f5b`：26项中仅project.binary新增一个bool true。独立兼容v3 PCK `c8a55c1242527029f7af75c27add17a9d6401d4a60026bea7522aff8fbf5421e`；组合PCK `2b162f432d28821c1ab177dbb0910345b99c07961336b833964ddaaa1b09f895`，25项中仅project.binary新增同一开关。组合包不能说成只改配置。

引擎JS与原包相同：`e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb`；新WASM `859fc92cb76dad0837f293d73250db347975ace35b71fdfa18f38e36138d8402`，新BR `6c9e9a731c3769457d721b383c80017254f21ee7c1c390d329428792d12baee5`。仍为Godot df3cdd9/Emscripten4.0.10/026e官方库，工具链和优化不变。

## 测试分层

基线工具111项、内容8项通过，未传--godot。本轮18项预热/场景/准入合同通过，0skip；配套64项ABI、774 imports/43 exports/13 callbacks静态映射通过，无新增缺失实现/占位函数。纯引擎nowPolyfill缺项保留，精确原宿主静态闭合，不改写成纯引擎通过。

原生154项图形矩阵及15项v3门禁通过，含UI/父alpha、RGB、裁剪、低alpha人工fixture、改源撤销及透明/自定义拒绝。注入平台的fixture不等于Android实机。

新组合电脑副本实际3.17.5/WebGL，会话55251282：普通2D、纹理3D旋转/停止及第4项两侧显示正常，门禁applied=false。电脑仅两份project配置变化：libVersion/项目名及common swc=false/disableSWC=true；手机副本配置不变。首次开窗停加载页，保留记录后仅做一次普通编译才启动，未为此改接线，等待不计作性能样本。console查询长行截断，另保存可取得的UI正文，16条完整去重记录；不是完整导出。即时红片截图早于状态刷新，本次不重新认证该页。

**新GLX手机未测，启动改善、Android兼容、长期稳定性未知。** 旧iOS正常反馈只适用对应旧包/操作，不迁移为新包验收。

## 之后的iOS最小回归

扫码先核包尾码50b90ca0f078fdbccc91、实际3.17.5及observed GLX；不符即停。先第1页2D，再首次进第2页3D，分别记录启动等待/首次3D等待/持续转动；准备提示不等于变快。第4页两侧应正常且兼容关闭。第3页独立记录。其它旧项目不无目的全量重复；扩展5–8页或生命周期另明确范围。黑屏/报错保留现场与完整日志，不自动重进、清缓存、换包。

## 私有恢复入口与官方草稿

以下相对原工具仓库的忽略目录，不随Git分发；官方库、SDK、作者资产及原始证据仍私有保留。

| `.local/`下目录 | 内容 |
| --- | --- |
| `glx-night-baseline-experience-20261028-01/` | 精确912c副本、一次上传原回执与原任务success查询、UPLOAD_COMPLETED、基线Git核验 |
| `glx-night-prewarm-20261028-01/` | 增量工作树/缓存、raw与配套JS/WASM、EXACT_HANDOFF |
| `glx-night-no-prewarm-scene-20261028-01/` | 仅关预热场景/PCK/属性对照 |
| `glx-night-alpha-compat-20261028-01/` | v1/v2/v3源、原生矩阵/门禁、PCK和所有旧结果 |
| `glx-night-combined-scene-v3-20261028-01/` | 最新v3组合PCK/源及差异；早期v2另留不用 |
| `glx-night-candidates-20261028-01/` | 三份27文件冻结候选、admission及18项最终合同 |
| `glx-night-desktop-webgl-20261028-01/` | 电脑副本、初次加载/普通编译记录、截图/UI正文/RESULT |
| `glx-night-ios-preview-20261028-01/` | 一次新GLX预览、QR、前后manifest和服务结果 |
| `glx-official-question-20261028-01/revision-02/` | 14文件分享包、7图、脱敏摘录、manifest/SHA；未发送 |

官方[一屏提问](GLX_OFFICIAL_QUESTION_20261028.md)及[详细说明](GLX_OFFICIAL_EVIDENCE_20261028.md)已保存。revision-02 ZIP SHA256 `2fdba741d4fb5ca5c2f4fd4bad976feeb44245259c5f6ecbe729c4e88d625063`；原ZIP不动。无AppID、账号、序列号、私有路径、官方库/作者二进制或原始完整日志；许可及日志缺口明示，没有对外发送。

Git原基线检查点79f0ee8已普通推送，预热2fb8099、局部兼容4bd2f74、脱敏材料a8d35d4已分别提交并远端核验；本次终态更新另作文档提交。最终提交/远端回读和关机检查另存私有收尾回执，避免本文件循环改自身提交号。体验版指向尚未确认、其它窗口未保存或安全无法确认时，按用户边界保留电脑现场，绝不强制结束/关机。
