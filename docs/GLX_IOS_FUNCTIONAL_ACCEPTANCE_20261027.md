# 完整 Godot＋官方新库：iOS 小型功能验收准备

日期：2026-10-27。分支 `codex/glx-godot-newlib-20261026`，本轮起点 `3e4c7e4829f7aa471bd6496ac742a8ffd8c4d28c`。

电脑准备阶段完成独立场景、内容导出、精确组包和微信开发者工具 WebGL 运行检查。随后用户批准 iPhone 验收，进行一次预览上传；**手机会话 d4f7102c 第 6–9 页失败**，日志确认实际 3.17.5／GLX，出现 getBufferSubData TypeError，详见[读回异常分析](GLX_IOS_FUNCTIONAL_READBACK_20261027.md)。电脑画面不替代真机验收。Android 3D 不可见和缺少像素样本的证据继续保留，未追加 Android 测试。

## 使用的基线与修改范围

采用已在手机运行成功的完整引擎 `godot-official-glx-026e-a169d60be3d6db10c33c`，以及其既有 WebGL 对照 `godot-official-glx-026e-webgl-control-1f5d72f561644b764c5d`。未使用离屏像素探针引擎。

引擎源码身份仍为 Godot `df3cdd9bc`／4.7.2 分支，Emscripten 4.0.10；本轮不重编引擎。官方库身份按文件哈希识别，不把库内版本字符串当作正式发布版本。

| 保持不变的对象 | SHA256 |
| --- | --- |
| 官方新 GLX 静态库 | `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8` |
| engine/godot.js | `e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb` |
| engine/godot.wasm.br | `a3fa7032ace37840021c58bd06b6b49f7b0468c01dde4b9d63a33bc2d2cd82cf` |
| 解压 WASM（65,184,325 bytes） | `ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244` |
| JS／WASM 配对身份 | `399b6522bd17f135087a669a9934ac68832efad837ad9fca418208a6dbbc316a` |

每份相对各自原包只有六条路径变化：`engine/empty-tips.bin` 新场景 PCK，`candidate-mode.js` 包身份，已禁用云传输的 `candidate-relay.js` 包身份，两个项目配置中的项目名称，以及 `CANDIDATE.json`。原始 loader、SDK、adapter、引擎启动文件、渲染接线、AppID、编译选项均未变。

GLX 使用原来的显式门禁；能力不支持会报告并停止，未添加 WebGL 静默回退。云日志保持 disabled，仅本地 console 记录。电脑准备阶段无预览；后续唯一一次获准预览见末节，无体验版上传、代理操作手机、基础库切换、裁剪或 WASM 分包。继承的旧 subpack 元数据未重写，新场景是独立完整 PCK，不能据此宣称完成分包回归。

## 场景与电脑结果

源码在 `examples/glx-ios-functional/`。每页给中文名称、预期和人工状态，底部固定“通过／异常／未测”、前后导航。状态初始为“未确认”，只有明确点状态按钮才变化；页面进入和操作执行不会自动通过。所有 3D 内容在进入相应页时才创建，离开页时释放。

| 页 | 可测内容与操作 | 电脑 WebGL 观察 |
| --- | --- | --- |
| 1 | 原创程序纹理、中文、半透明红青圆叠加、斜线 | 图片、中文、叠加底色可见 |
| 2 | 纹理在白框内自动横移，检查裁剪 | 运动可见，框外未观察到图形溢出 |
| 3 | NinePatchRect STRETCH，两种尺寸并排；改尺寸、换纹理 | 四角、边缘、中心保持对应；操作后尺寸和颜色变化 |
| 4 | NinePatchRect TILE／TILE_FIT 两种模式并排 | 可见重复边缘与中心；改尺寸和纹理后仍可显示 |
| 5 | draw_center=false、透明外缘、改尺寸、换纹理 | 中心可透出棋盘／圆形背景；边缘混合可见 |
| 6 | ArrayMesh 贴图方块、方向光＋环境光、持续旋转 | 方块可见，角度随时间变化，各面明暗不同 |
| 7 | 方块前的半透明红片、后的蓝片 | 红片覆盖前方，后方蓝片被方块遮挡 |
| 8 | 两个独立 SubViewport 世界／相机，3D→2D→3D | 两侧可显示不同视角和背景，切换及恢复正常 |
| 9 | 退出本页内容，销毁视口／网格，再创建 | 原提示竖排问题已修正；最终包连续两组退出／重建后恢复可旋转方块 |

九宫格源图为代码生成的 RGBA8 96×96：四色角、条纹边缘和十字中心；外四像素透明，后两像素分别为 alpha 0.35／0.7。纹理不含外部美术文件。中文使用固定字体的本地子集。

本轮两次桌面内容导出没有重编 JS／WASM。第一次完成全功能运行后，发现第 9 页退出提示宽度为零导致竖排；最终版只为该 Label 设置 FULL_RECT 及水平／垂直居中，另修正字体构建脚本的一处注释。旧候选及截图保留。

## 精确候选与记录

最终场景 PCK：89,380 bytes，SHA256 `7998cac83c6abcc49aaf7709e83ca319c544a351354deeaa83d2c97595544ac7`。

| 模式 | 最终包标识 | CANDIDATE.json SHA256 |
| --- | --- | --- |
| GLX，未运行 | `ios-functional-glx-8fcfcc69d3d297a82b87` | `7343ae9c09a3e4369d7a2b0b40971564fcdbfca3c1e22724d5a17ddf227263b1` |
| WebGL，电脑已运行 | `ios-functional-webgl-d11480e2a7bc262b673d` | `120196a1dd2938dd23aaf7d9b35fa2c9293d5f805e88059495342fe318f6e742` |

实际微信开发者工具 `2.02.2609231 RC`；电脑实际基础库 **3.15.2**，实际后端 **WebGL**，最终会话 `036a0911`。模拟器显示的 iPhone／iOS 型号是模拟配置，不能当作真机设备记录，也不能当作手机 3.17.5 对照。

- 初版 WebGL `ios-functional-webgl-f0d46197c0d537380946`／会话 `c06628f4`：28 条完整操作记录，9 页进入、3 次改尺寸、3 次换纹理、2 次视口切换、1 组内容退出／重建。完整日志 SHA256 `9487957b19b243900caaa38836d2f388a0edbe40cf68d909ab7ac8550c9d5569`。
- 最终 WebGL `ios-functional-webgl-d11480e2a7bc262b673d`／会话 `036a0911`：22 条完整操作记录，9 页进入、2 组内容退出／重建。完整日志 SHA256 `1127bd5ad2f7ea3430779b10d3b32c9d129c2735e57f43f5f9db090eeb1686e4`。未再次重复未改变的九宫格操作或双视口切换；相关代码与初版一致。
- 两会话所有操作序号连续，包／会话／实际 SDK／WebGL 身份相符，人工状态未自动通过。现有桥每次启动读取一次身份与诊断；操作日志附带该启动摘要，不声称每个操作都重新查询了上下文。
- 收集到的完整 console 中未出现 Parse JSON failed、shader 编译失败或运行异常；保留 `ScriptProcessorNode` 废弃警告，不能写成无警告通过。旧成功包的 JSON 错误不因此被追溯删除。
- 专用画布触摸工具曾返回 `getCanvasSize returned invalid canvas size`，未成功发送触摸；后续只操作本轮独立电脑窗口。长行会被 console 查询工具截断，因此实际证据另从该窗口控制台全选复制并核验身份；完整日志有独立哈希，未用截断查询代替。

## 3D 预热

已核查成功引擎源码 `drivers/gles3/rasterizer_scene_gles3.cpp:4616–4618`，仍直接执行默认 scene shader 初始化和 `version_bind_shader`。可配置的 `startup/gles3/skip_default_3d_prewarm` 存在于另一条 `trim/patches/wx-startup-df3.patch`，受 `WX_LAB_RUNTIME_PREWARM_POLICY` 宏控制；当前成功完整引擎未包含该功能。

因此本轮**没有写一个不起作用的开关，也没有关闭引擎默认预热**。已做的场景按需创建 3D 可避免启动页主动构造所有测试模型，但不能替代关闭引擎预热。真正关闭需独立源码补丁和重编，等功能基线确认后另议。

## 构建与保留位置

组包工具：`engine/functional-acceptance/stage.mjs`；8 项测试覆盖原包精确哈希、两后端同 PCK、只改六路径、内容身份变化、拒绝探针、拒绝覆盖及错误输入。最终独立审查 18/18 通过，报告留本地。

导出工具为本机 Godot `4.7.2.stable.steam.ed1daf0bf`，SHA256 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`；仅导出文本 GDScript PCK，不替换候选里的自构建引擎。Node `24.18.0`。最终 import 3.710 秒、export-pack 3.431 秒、精确组包 1.000 秒；这些不是引擎编译耗时或启动性能基准。

字体来源、OFL 许可和生成方法在场景 README 与 `fonts/NOTICE.txt`、`build_font.py`。固定源字体 SHA256 `a2b93e6c2db05d6bbbf6f27d413ec73269735b7b679019c8a5aa9670ff0ffbf2`，fontTools 4.60.0；产物 60,040 bytes、303 字符，SHA256 `876efc2ee8c6967aa935bb5c11f5eae84a6aebf334b7b7604e5dea6b4b5394d0`。本轮未下载安装依赖。

本机私有恢复入口：

- 成功 GLX 基线：`E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/candidate-glx`。
- 既有 WebGL 基线：`E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-webgl-control-20261026-01/candidate-webgl`。
- 本轮初版与完整操作证据：`E:/AI/wechat-wasm-slim/.local/glx-ios-functional-20261027-01`。
- 本轮最终版：`E:/AI/wechat-wasm-slim/.local/glx-ios-functional-20261027-02`，含 `scene-source/`、PCK、`EXPORT.json`、`frozen/STAGING.json`、两个冻结包、独立 `devtools-webgl/`、`FINAL_INTEGRITY.json`、`WEBGL_EVIDENCE.json`、日志和截图。

冻结目录不作为工作目录修改。运行副本的 27 个文件与冻结 WebGL 完全一致。首次字体调用的参数错误及修正后的执行记录均留在 02；错误未生成字体或 PCK，已纠正后完成导出。仓库中被忽略的旧 `fonts/FONT.json` 仍记第一次生成时的源码哈希；最终冻结 `scene-source/fonts/FONT.json` 是本候选正确来源记录。重建请在新目录重新生成字体，不复用旧来源元数据。

可复现步骤：从本场景源码复制到新的工作目录，按 README 固定源字体和 fontTools 生成字体；使用固定 Godot 执行 `--headless --editor --import`，再 `--headless --export-pack Web <new-output.pck>`；Node 执行 `stage.mjs --scene-pck <new-output.pck> --scene-source <copied-source> --output <new-frozen-dir>`。工具会核验上述原包 pin 并拒绝覆盖。此流程依赖明确列出的本地成功引擎基线；不宣称它已补齐既有完整引擎从干净仓库重建的全部缺口。

源码／文档可审阅，二进制、字体生成物、实际项目配置、原始日志和截图留本地；本轮没有提交或推送。

## 尚未覆盖与验收方案

未覆盖：iPhone 实际 GLX 画面与安全区、持续运行／前后台、主视口直接 3D、复杂 PBR／阴影／骨骼、音频／输入法、极小九宫格尺寸、所有 Android 兼容性、裁剪／分包和性能结论。第 9 页是本场景内容子树资源重建，不是 Godot 整个 SceneTree 更换，也不是微信小游戏重开。

方案为只上传最终 GLX 候选一次，保留当前成功手机包的回退目录，不改体验版；用户后续已确认本轮 iOS 验收。先核验实际基础库目标 3.17.5、包身份和 actualMode=glx，任何不符即停。

一次首开内依次检查 9 页，根据页面预期点“通过／异常／未测”；第 3–5 页各改尺寸、换纹理一次；第 8 页往返 2D／3D 一次；第 9 页两组退出／重新进入。不是通过程序日志自动判定画面。若功能正常，再停在双视口页持续观察约 2 分钟，并做一次返回桌面约 10 秒、切回约 20 秒的恢复检查，复用已有宿主 hide/show 与操作记录。整个流程只需导出一份该会话完整日志，并报告异常页或肉眼结果；出现黑屏／冻结／错误则保留现场停止，不重试、不清缓存。

## 获准预览进度（2026-10-27）

用户确认本轮在其 iOS 设备测试 GLX 兼容性。核验候选 manifest 与全部 27 文件、AppID 与成功基线一致、云采集关闭后，复制冻结 GLX 包到私有 `phone-preview-01/project`，未修改配置、代码、PCK、JS 或 WASM。

`create_preview_qrcode` 仅调用一次，返回 success=true，服务报告总包大小 9,163,784 bytes。二维码、完整响应及 `PREPARATION.json`、`ATTEMPT.json`、`RESULT.json` 保存在 `E:/AI/wechat-wasm-slim/.local/glx-ios-functional-20261027-02/phone-preview-01`。上传后全部文件哈希仍相符；体验版未改变，未切基础库。冻结 manifest 中的 not_uploaded 是封存时状态，当前进度以这份独立 RESULT 记录为准。

上传时手机实际版本／GLX／会话及画面尚待日志核验，不将预览服务成功算作真机通过。随后完整日志确认 d4f7102c 实际 3.17.5／GLX，用户报告第 6–9 页测试框没有内容；本轮状态更新为 FAILED，后续持续运行／后台验收不计通过。结果与源码分析见[读回异常分析](GLX_IOS_FUNCTIONAL_READBACK_20261027.md)。项目继承的 3.15.2 是电脑配置。原成功包恢复入口不变，回退换包需另行确认。
