# 安卓默认清屏色单变量候选：电脑准备完成

后续：用户已另行批准并成功上传一次预览，等待扫码及手机身份核验，见[本次预览记录](ANDROID_DEFAULT_CLEAR_COLOR_PHONE_20261027.md)。下方保留电脑阶段及当时的未上传状态。

2026-10-27。用户批准电脑侧准备；本轮未上传、未换手机包、未操作手机。当前Wi-Fi连接与旧包现场保留。

## 候选及回退

| 项目 | 身份 / SHA256 |
| --- | --- |
| 新GLX候选 | `ios-functional-glx-20c564de30fc8e482fb1` |
| 新GLX CANDIDATE.json | `5ec9b7c2b769a0bd62077bc46b53b6e864e61c3441c08814c4f5c6642ba9dbc7` |
| 新PCK，188716 bytes | `f8652e100579a790fc2204d39b5d3afc8385398c9e6cfa8d9ffa9d4a33ed2198` |
| 生成的同内容WebGL包，未运行 | `ios-functional-webgl-4a66c34c116da48ebefd` |
| WebGL CANDIDATE.json | `2987a2bf67e10ec21a8a788bb1b257313af48d7ab6c14cfa2d0311df6bc4decc` |
| 原手机包，继续保留 | `ios-functional-glx-b18f8897add5263024ca` |

新私有根：`E:/AI/wechat-wasm-slim/.local/glx-android-clearcolor-20261027-01/`，包括scene-source、clearcolor.pck、frozen/candidate-glx、frozen/candidate-webgl、STAGING、FINAL_AUDIT、PCK审计和原生图形检查。

原冻结包在 `E:/AI/wechat-wasm-slim/.local/glx-ios-functional-v2-20261027-01/frozen-03/`，原PCK及安卓/iOS日志截图不动。换回原手机预览仍需另行确认；本轮没有自动换回或上传。

## 确切差异

实际渲染配置仅一项：`rendering/environment/defaults/default_clear_color`，由RGBA(.035,.055,.085,1)改为(.2,.3,.05,1)，即由深色变为明显橄榄色。

这是**全局默认清屏色**，不只是UI根窗口的背景。固定源码main/main.cpp:3995–3996设置全局值；renderer_viewport.cpp:394–397会把它用于每个非透明视口的初始清屏请求；GLES3有效Environment.BG_COLOR路径再覆盖RGB（rasterizer_scene_gles3.cpp:2602–2606）。本场景左右视口的蓝/紫背景和白色环境光仍由各自Environment显式设置。内部RT清屏、复制或覆盖也可能携带默认色，不能把轮廓跟着变色直接认定alpha=0。

为固定Godot导出身份，独立候选main.tscn还显式写入`unique_id=926708189`，值取自**原PCK已经存在的根节点ID**。原文本没有声明它，Godot每次导出会随机生成不同node_ids；这是源表示的稳定化，不改变最终节点ID。未修改仓库原场景。

[机器可读复现配方](../engine/functional-acceptance/experiments/default-clear-color.json)列出两处精确文本差异和严格结果门禁。最终31个源文件只有project.godot及上述main.tscn声明不同；所有GDScript、纹理、字体、灯光、相机、视口尺寸、材质、动作与日志原样。

## 电脑检查结果

- 固定Godot编辑器4.7.2.stable.steam.ed1daf0bf，EXE SHA256 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`，仅导出PCK，没有编译引擎。
- PCK v4目录19项、逐项MD5/SHA256审计通过：**仅project.binary payload改变**；其13个配置项中仅默认清屏色变化。主场景main.scn与原包逐字节一致，harness未打包。
- 使用原stage.mjs冻结两模式；每包27文件；相对原v2只改变PCK、身份/manifest、禁用云转发身份记录及两个项目名称六个允许路径。现有AppID、编译设置、基础库配置和宿主不变。
- 原引擎JS `e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb`、BR `a3fa7032ace37840021c58bd06b6b49f7b0468c01dde4b9d63a33bc2d2cd82cf`、解压WASM `ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244`均通过原门禁；库仍为026efcef…87aa8，不换库、不改引擎JS/C++/WASM。
- 原生Windows gl_compatibility图形检查：基线及候选均进入第15项ready、贴图方块正常，最终进程exit0且stderr为空；页面底色明显改变，蓝/紫窗口背景采样保持一致。检查脚本在scene-source之外，未打进PCK；这是原生RTX/OpenGL检查，**不是微信电脑WebGL或手机GLX通过**。
- 原生读取值存在8位量化：基线pagePixel 090e15、候选334c0c，窗口仍153f79/652d74；真机应比较实际截图，不硬写成固定预期RGB。

早期不完整导出、node_ids随机差异的严格FAIL审计，以及原生harness尝试隐藏主窗口所报错误均留在私有目录；按顺序等待导入完成、固定原ID、去掉不支持的本地隐藏调用后，最终重新导出/检查通过。没有放宽门禁或丢弃失败证据。

## 从固定基线复现

1. 复制原v2冻结来源的31个源文件（排除.godot/.git），包含已核验字体；核原来源manifest `3bcd7de1d9ea8c337a256ab0578680d5e8c6f7f5ab19557c898d52085d92e6a8`，输出到新目录。
2. 应用配方里的两处精确文本替换。先用固定编辑器导入并**等待结束**，再正常`--headless --path <source> --export-pack Web <new.pck>`；Windows GUI EXE用Start-Process -Wait等退出，防止导入/导出交叠。
3. 解码PCK目录和project.binary核对上述唯一payload/属性差异；编译场景资源应与原PCK完全相同，不能把未解释差异当metadata忽略。
4. 使用未改的 `engine/functional-acceptance/stage.mjs --scene-pck <new.pck> --scene-source <source> --output <new-dir>`；它验证原配套引擎和父包，拒绝覆盖输出目录。FINAL_AUDIT同时核对源码、PCK及原v2差异。

## 下一次手机方案，需另批

仅申请新GLX候选一次安卓预览；保留原包、原日志，不覆盖体验版或自动切基础库。二维码扫码换包由用户完成；之后同一nova4通过现有Wi-Fi ADB核型号/包、实际3.17.4/GLX，必要目录导航到第15项，等待内容已准备后只取一张截图，不按其他功能按钮、不重进/清缓存、不发云日志。

比较页面空白区、方块轮廓内部与蓝/紫背景：

- 页面变橄榄色、轮廓也随默认色变化且蓝/紫背景保持：支持异常区域依赖默认clear色；尚不能区分alpha透出、RT清屏/颜色复制或覆盖。
- 页面变色但轮廓保持旧暗色：削弱直接依赖当前默认clear色，转查暗色在哪段产生；仍不直接归因光照或shader。
- 页面不变：干预未生效，结果无效；蓝/紫背景也异常变化则说明影响超出简单底色对照，另作记录。
- 新包方块反而恢复正常：记“本轮未复现”，不能声称改底色修复。新包启动历史不同也是混杂因素，不自动追加包或重试。

全程只做有限对照，截图不足以认证持续旋转或GLX整体兼容。截图后停止，依结果再决定最小下一步。
