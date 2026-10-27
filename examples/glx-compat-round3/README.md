# GLX独立验收：第三轮

仅测试场景，复用完整自编译Godot与026e官方GLX库。旧20c、97e底板包和原始证据保留；没有裁剪、WASM代码分包、赛车、GPU读回、材质常驻优化或云采集。

## 八页范围

1. 普通2D图片/中文与一次翻转短回归。
2. 主视口直接3D方块转动/停止短回归。
3. 原13红片：原按钮启用同一红片，再切不透明/48%半透明。
4. 原15显示对照：同一SubViewportTexture并排，左原混合，右Canvas `blend_disabled`。
5. 两骨骼蒙皮：CPU构建顶点/骨骼权重、Skeleton3D、Skin与AnimationPlayer；蓝色下端固定、橙色上段弯折且接点连续。
6. 一个MultiMesh、8×8共64实例，交错红蓝，散开/合拢和暂停。
7. 简单不透明Spatial shader，红绿条纹可切蓝黄，只写ALBEDO，不写ALPHA。
8. 同一个64×64 RGBA8 ImageTexture.update，背景轮换/白条移动、暂停/继续及切色。

不是重跑旧20项。原13/15显示为新目录03/04页，标题保留原编号关联；启动沿用现有身份记录。四类新测试的3D项使用主视口，避免已知离屏问题掩盖覆盖。画面、响应、停顿独立人工填写，初始未测试，保留看不清/没留意。创建、计数和回调均不自动算视觉通过。

## 对照边界

`renderer_base.gd`逐字节保留20c的renderer（SHA256 `e8800de7d426662abaadb05dd48ba743259555d2156fa9bd3cb973809368cda6`）。新renderer继承并扩展；公共adapter、loader及引擎不改。

红片保留原13的QuadMesh、位置(-.3,0,1)、尺寸(1.5,1.3)、灯光、相机和原add_front回调（先visible=true，再发front_red_shown）；日志补记visible、visibleInTree、材质和几何状态，仍不等于画面可见。原14是后方蓝片，位置(.15,0,-1)、尺寸(2.1,1.3)、不透明，不能当作只差透明度。

切换只改同一红片材质的transparency与albedo alpha（1/.48），RGB、几何、灯光、CULL_DISABLED和DEPTH_DRAW_OPAQUE属性保持。连带改变shader变体、opaque/transparent队列、排序、混合和实际深度写入行为，可能停顿；不是纯数值单变量或性能改善。

第15用原左窗320×260非透明、非HDR SubViewport和蓝背景，两个显示共享同一纹理对象/RID，不新建第二个3D世界。两侧蓝背景来自共享源，不是改清屏色。左默认混合，右两行Canvas shader声明blend_disabled，保留默认fragment采样。它引入ShaderMaterial/Canvas变体，可能改变批次/时序；一源双显不用于比较旧双世界性能。结果只定位，不作为通用修复。

根项目仍为20c橄榄色clear，没有97e洋红底板。新材质示例不反向改动原13/15。

## 记录与构建

`[GLX_ACCEPTANCE_R3]`事件附带原宿主读取的包、启动、SDK、actualMode，resultTrack区分desktop-native/desktop-webgl/ios/android/unknown；不改写实际值。iOS/安卓不得互相继承。准备提示→真实frame_post_draw→创建→绘图回调→人工观察顺序沿用原实现，保留原始等待时长；提示不构成性能优化，无逐帧日志。

1. 使用已核验Noto Sans SC Regular源（SHA256 `a2b93e6c2db05d6bbbf6f27d413ec73269735b7b679019c8a5aa9670ff0ffbf2`）、fontTools4.60.0运行build_font.py到新目录。生成字体放入隔离工作副本fonts，OFL/NOTICE保留；二进制不提交Git。
2. 复制本目录到新忽略目录。固定Godot4.7.2.stable.steam.ed1daf0bf，只导入/导出PCK；Windows用Start-Process -Wait -WindowStyle Hidden，导入完成后才导出，不重编引擎。
3. 图形运行local_verify.gd（导出排除），传--out=<新目录> --size=720x1540，另核720x1160。外部harness有截图读回，候选没有；原生不算WebGL/GLX通过。
4. engine/functional-acceptance/stage.mjs核验原引擎后生成同PCK的两个模式冻结包，拒绝覆盖。电脑WebGL另复制运行目录，仅改projectname/libVersion并留差异。
5. 完成实际微信电脑画面/操作参考后，才安排手机方案。手机预览/换包/控制须另批，本目录没有上传命令。

未覆盖：新冷启动/强退/恢复轮次、长期运行/泄漏、粒子、压缩/HDR纹理、GPU读回、音频网络、裁剪分包及赛车。iOS/安卓本候选未测，不继承旧场景通过结果。
