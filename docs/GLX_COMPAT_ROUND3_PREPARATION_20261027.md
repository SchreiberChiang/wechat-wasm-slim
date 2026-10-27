# GLX第三轮独立验收：场景与电脑静态准备

2026-10-27。独立8页场景、配套PCK、原生图形/操作合同及完整性审计完成。用户随后授权接管独立窗口，现已补齐实际3.17.5/WebGL的8页画面及正常鼠标操作，冻结源和引擎哈希再次核验未变。详见[桌面结果及有限手机方案](GLX_COMPAT_ROUND3_DESKTOP_20261027.md)；本文保留准备阶段依据，历史FINAL_AUDIT不改写。

没有上传、操作手机、改引擎/官方库/公共宿主接线、裁剪分包、赛车、云报告或服务器改动。当前安卓97e底板包和现场不动；20c/97e及早期成功包完整保留。现阶段不申请手机上传。

## 候选身份

| 项目 | 身份或SHA256 |
| --- | --- |
| GLX候选 | `ios-functional-glx-8f0ff69c7eacb7a08790` |
| GLX CANDIDATE.json | `ac4835b9cc993618b5fde3a5f1b10a2cedb5da88bbcc32911d3b6a2b85fb8b23` |
| 同PCK WebGL | `ios-functional-webgl-adff76e2b6572fd6341a` |
| WebGL CANDIDATE.json | `3663ef146932ff6cd65a32866f71611ffe3b9e22b5fcfe791612722f2dd056ce` |
| PCK，182648 bytes | `e1ab311f684518c87ed5c9de3bceff6ec22a4bade9258689a4d487dac7cedca2` |
| 原引擎JS | `e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb` |
| BR解压原WASM | `ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244` |
| 原官方库 | `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8` |

源码在[examples/glx-compat-round3](../examples/glx-compat-round3/README.md)，私有根为 `E:/AI/wechat-wasm-slim/.local/glx-compat-round3-20261027-01/`。

- `scene-work`、`round3.pck`、`font-02`：实际导出来源和字体溯源。
- `frozen/candidate-glx`、`frozen/candidate-webgl`：各27文件冻结包。
- `devtools-webgl`：独立电脑运行副本，窗口`GLX第三轮-电脑WebGL-adff76`，未覆盖旧窗口项目。
- `native-04`、`native-small-01`：最终原生合同和截图；早期失败/视觉修正目录保留。
- `STAGING.json`、`FINAL_AUDIT.json`、`final-audit.mjs`：来源、完整性与未验证项。FINAL_AUDIT SHA256 `042c23b94d5594ba492ef4efd3b9e906758c5c535c6a81983ab4a6be1497f5aa`。

包名沿用stager的`ios-functional`前缀，不代表本候选iOS通过。所有iOS/安卓结果均为未测试。

## 八个检查点与操作

| 新目录 | 内容 | 看得见的目标 / 动作 |
| --- | --- | --- |
| 01 | 普通2D短回归 | 中文和编号图片正常；左右翻转一次再恢复，观察编号和箭头镜像。 |
| 02 | 直接3D短回归 | 主视口方块有纹理且转动；按停在正面后停止。 |
| 03（原13） | 同一红片材质对照 | 先按原启用按钮；不透明红片遮住重叠区域，48%半透明时应有红色且能看见后方格子。切换前后分别观察和记录。 |
| 04（原15） | 最终显示端混合对照 | 左原混合、右忽略纹理alpha，共享同一张离屏纹理；电脑参考应显示同样的蓝底纹理方块，暂停/继续同时影响两边。只记录差异，不当作修复。 |
| 05 | 两骨骼蒙皮 | 蓝色下端固定、橙色上段弯折，接点连续；暂停骨骼后停住，再继续。 |
| 06 | MultiMesh | 8×8共64个红蓝交错小方块；散开/合拢间距改变而不缺块，暂停后整体不再摆动。 |
| 07 | 不透明自定义shader | 红绿条纹方块转动；切换后蓝黄条纹，保持不透明。 |
| 08 | 动态纹理 | 背景轮换、白条移动；暂停停住、继续恢复，切换图案有可见变化。 |

旧20项不全量重测。原13/15在新目录显示为03/04并保留原编号关联。骨骼、MultiMesh和自定义3D shader使用主视口，动态纹理走普通2D；不让既有离屏3D故障掩盖四类新增覆盖。

画面、响应和停顿三个字段独立，默认未测试，保留看不清/没留意；动作、创建、骨骼姿态、纹理更新计数和frame_post_draw都不自动通过。原13不同材质状态需按顺序记录，动作日志保存每次模式切换；同一页界面只显示最近选择，不能用末次选择覆盖完整日志里的先前反馈。

## 第13与第14项的原代码核对

固定`renderer_base.gd`是20c原renderer逐字节副本，SHA256 `e8800de7d426662abaadb05dd48ba743259555d2156fa9bd3cb973809368cda6`。

| 差异 | 原13前红片 | 原14后蓝片 |
| --- | --- | --- |
| 几何 | QuadMesh，1.5×1.3 | QuadMesh，2.1×1.3 |
| 位置 | (-.3,0,1)，在方块前 | (.15,0,-1)，在方块后 |
| 材质 | RGB(1,.04,.04)，alpha .48，TRANSPARENCY_ALPHA | RGB(.05,.2,1)，alpha1，默认不透明 |
| 剔除 | 原透明材质CULL_DISABLED | 默认剔除 |
| 启用回调 | `front_sheet.visible=true`之后发`front_red_shown` | `back_sheet.visible=true`之后发`back_blue_shown`，另有移开方块按钮 |

因此它们不只差alpha，不能把原14正常当作原13材质已被隔离验证。既有安卓front_red_shown事件说明原回调执行到visible赋值之后，但旧日志没有实际visibleInTree字段，不把事件等同红片物理可见。

新候选保留原13创建、原启用回调和后蓝片；日志补上可见性、材质、局部位置/尺寸及灯光状态。原生按钮合同已经确认启用后visible和visibleInTree均true；这仍是电脑节点状态，不是旧安卓结果。

同一红片切换只改`transparency`（DISABLED/ALPHA）与`albedo_color.a`（1/.48）。RGB、几何、位置、灯光、CULL_DISABLED及DEPTH_DRAW_OPAQUE属性均保持，原生合同逐项核对。连带影响包括shader变体、opaque/transparent队列、排序、混合及实际深度写入规则；可能触发资源/材质准备停顿，不能称纯数值隔离或性能改善。

## 第15最终显示端对照

使用原左窗320×260、非透明、非HDR SubViewport、同一环境/相机/灯光和蓝色背景；两个TextureRect引用同一Texture对象和RID。右侧也是蓝底来自共享源，不是改了视口清屏色。根全局clear仍为20c橄榄色，未携带97e洋红底板；不改附件格式或库。

左侧不加材质，保留原Canvas混合。右侧使用场景内ShaderMaterial：

```glsl
shader_type canvas_item;
render_mode blend_disabled;
```

不覆盖fragment，不把纹理alpha改写成1；只是最终Canvas颜色写入不再依赖源alpha混合。默认CanvasItemMaterial没有BLEND_MODE_DISABLED枚举，最初错误选择已由解析器拒绝，改用已有Canvas shader render_mode，没有重编或修改引擎。

该对照引入Canvas材质/批次变体；仅一个源视口而非原两个独立3D世界，也不用于比较旧场景性能。若右侧恢复而左侧异常，支持最终alpha消费链参与；若两侧都异常，不能仅凭此断言3D没画出或源RGB损坏；若两侧恢复、状态不符或新异常，则保留扰动/未复现结果。任何结果均不作为通用修复。

## 新增实现与已做检查

- 骨骼：CPU生成8顶点、2骨骼、每顶点4权重槽的ArrayMesh，接点两侧采用相同混合权重；Skin来自rest，显式恢复pose；AnimationPlayer专用rotation track驱动Tip。没有surface_get_arrays或烘焙/GPU读回。
- MultiMesh：一个MultiMeshInstance3D，64实例，使用instance color与transform；小幅摆动避免把画面越界误判为缺块。不是64个独立MeshInstance，也不是压力或FPS测试。
- 自定义shader：简单不透明Spatial/unshaded，只写ALBEDO，布尔uniform换红绿/蓝黄，无纹理依赖，不写ALPHA。
- 动态纹理：同一64×64 RGBA8 ImageTexture.update，不每次重新创建。整数更新计数只记录程序推进，不作FPS或视觉证明。
- `[GLX_ACCEPTANCE_R3]`保留原宿主实际身份/SDK/模式，并增加resultTrack区分desktop-native、desktop-webgl、ios、android或unknown；不写死实际版本，不修改公共宿主。iOS与安卓的本候选结果分别未测试。

| 检查 | 已确认 | 不代表什么 |
| --- | --- | --- |
| 原生图形/操作合同 | 8页均执行，720×1540、720×1160布局与按钮机制PASS，stderr空；红片几何/灯光不变，同源显示成立，骨骼/实例/颜色/动态更新状态和暂停恢复合同通过。 | 程序触发Button.pressed，不是真鼠标/手机触摸，也不是自动视觉验收。 |
| 原生截图审阅 | 红片不透明/半透明、两显示端纹理、接点连续的骨骼、64实例、条纹切色和动态纹理图有电脑参考。 | 不是微信WebGL、GLX、手机或性能结论。 |
| PCK审计 | 22项路径/MD5/来源通过；源脚本和两shader逐字节匹配工作源，检查器未入包；主scn与旧包完全一致。project.binary仅应用名称不同，clear等配置不动。 | 不是新后端已运行。 |
| 引擎与保护 | JS/BR/解压WASM、026e库、两模式27文件原门禁通过；20c/97e仍匹配旧清单。 | 不继承旧包真机结果。 |
| 微信电脑WebGL启动 | 独立窗口，实际3.17.5/WebGL，会话f0f9b849，adff76包；8页参考画面完成。 | 模拟器iPhone字符串不是iOS手机结果。 |
| 微信电脑操作 | 早期画布工具返回getCanvasSize invalid，未触发回调，错误保留；后经用户授权以正常鼠标完成8页按钮和往返检查。 | CLI进程exit0不等于业务ok；成功鼠标检查与失败工具分开记录，不作手机触摸结论。 |

早期记录保留：native-01拒绝不存在的CanvasItemMaterial枚举；native-02结构合同PASS但截图发现骨骼初始pose重叠；native-03恢复rest后再细化接点权重，最终native-04/small通过。没有把早期结构PASS写成所有画面通过。

字体复用已安装的fontTools4.60.0纯Python依赖和固定源Noto Sans SC，没有新安装。新中文子集98288 bytes、473 codepoints，原字体及许可证不动。字体来源、FONT记录列出的脚本/JSON哈希与字符覆盖已核验；生成二进制仅本地，不提交Git。

## 当前剩余工作与手机草案

已接管该独立电脑窗口完成8页正常鼠标和WebGL画面参考，不重跑旧20项。开发者工具长行仍被CLI截断，不声称已取得完整console；UI内实际resultTrack为unknown，原值保留，电脑来源通过窗口/实际WebGL宿主记录另行确认。第3页右侧说明/状态略拥挤单独保留，未中途改候选。

候选现为**电脑静态/原生及微信WebGL参考完成，手机GLX未测**。本轮未上传/操作手机；下一步建议有限手机轮次：先核身份/实际SDK/GLX，01/02短回归，再03/04对照和05–08覆盖，分别记录画面、响应、卡顿；iOS和安卓独立记录。具体顺序、两段日志和停止条件已列入桌面结果，仍等用户确认。

不默认加入强退、重进、清缓存、后台恢复或长期运行，也不新增探针。现有GLX-18安卓外观、GLX-19读回、GLX-20准备卡顿仍保留未解决。
