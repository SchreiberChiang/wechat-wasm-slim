# 第4项局部不透明视口兼容：电脑候选结果

2026-10-28。独立源 `examples/glx-opaque-alpha-compat/` 已完成；仅电脑侧实现和回归。无手机连接/操作、预览、上传、Git提交或推送。未修改引擎、库、公共adapter、stage.mjs、基线样例及第3项。没有组合预热改动。

这是局部显示绕开方案，**不是底层alpha根因修复，也不是手机通过**。原始附件/几何写入至采样链的首次异常位置仍未知。

## 实现及门禁

独立样例复制自第4项自有源，原 `renderer_round3.gd`、`renderer_base.gd`、main、bridge和原shader逐字节保留；所有非D15目录项（包含第3项）保持。新的renderer继承round3，只在D15原左TextureRect注册一个已知非透明SubViewport，原右禁混合参考保留。未保留四模式诊断页扩展，避免将固定alpha1诊断当产品修复。

显式候选开关为true，同时要求原cached bridge的 `actualMode=glx`、`modeEvidence=observed` 与缓存device字段确认安卓：device.platform字段存在时仅接受精确小写android；该字段缺失时严格匹配device.system的Android+数字版本（例如Android 10或Android10，允许点分版本及空格后的构建描述）。iOS、WebGL、缺失或伪系统字段拒绝；不根据 `OS.get_name()` 的Web名称推断安卓。resultTrack原值保留，允许仍为unknown；snapshot.platformEvidence记录缓存字段来源。只接受普通TextureRect（get_script()必须为空，排除GDScript自定义子类）、同一个明确注册SubViewport的ViewportTexture、`transparent_bg=false`、无已有材质/父材质；不使用恒false的has_alpha。NinePatch/透明源/普通图片/其他视口拒绝。

RenderingServer.frame_pre_draw前重新检查；纹理改源、源变透明、开关/上下文改变后撤销，只删除仍属于自己的材质；外部后来设置的新材质保留。切回同一允许来源可恢复。它是场景级allow-list，未扩成通用引擎机制。

专用MIX shader以一个float varying保存vertex阶段采样前COLOR.a；fragment仅把COLOR.a恢复为这个UI alpha。RGB默认采样/调制不动，不增加texture()，不全局写1；父/UI透明度与后续Canvas调制保留。新增varying及专用程序可能改变批次/编译准备，未作性能通过声明。无需重编JS/WASM，只重新导出场景PCK。

## 电脑证据

原生工具4.7.2.stable.steam.ed1daf0bf，Windows/NVIDIA RTX3080 OpenGL Compatibility。第一版 `native-07/RESULT.json` 118检查通过；修正实际平台门禁后的最终 `native-09/RESULT.json` **154检查通过、0失败，stderr为空**：

- UI self_modulate alpha与父节点modulate alpha各0/.25/.5/1的16组合；候选与正常不透明源原MIX像素一致。
- 16组合逐项检查右/下裁剪；另检查RGB彩色modulate/self_modulate与父节点合成alpha一致。
- 人工低alpha源fixture：在非透明SubViewport中用blend_disabled写已知RGBA，源alpha0/.25/1 × 16UI/父组合共48组与独立ColorRect参考一致；另确认源alpha0确使未修正MIX与候选不同。这个受控fixture不是安卓异常产生机制的证明。
- 显式关、iOS、Android+WebGL、unknown/unobserved、已有自定义材质、父材质、NinePatch、透明视口和普通图片拒绝。
- 切到另一视口纹理自动撤销，切回注册纹理恢复；来源改透明撤销；外部替换材质不被覆盖。
- 实际原生3D页保持一个源视口，native门禁默认关闭、右参考保留；仅测试注入Android GLX上下文才启用左材质。原生实际页与注入fixture截图均保存，人工看图可见完整页面、方块/数字箭头及中文，未代填人工验收结果。

测试图形来自native原生，不是实际微信WebGL，也不是Android GLX。测试上下文注入明确记录于RESULT.scope，不能作为平台门禁在手机上实际生效的证据。PNG像素检查只认证本原生受控参考，不外推手机截图、GPU因子或附件精确值。

私有根 `E:/AI/wechat-wasm-slim/.local/glx-night-alpha-compat-20261028-01/` 保存scene-work、生成字体、native-07与native-09（各23张PNG+RESULT）、各日志、导出PCK和AUDIT_FINAL及AUDIT_PLATFORM_V2/V3。早期native-01参数拼接失败、native-04缺字体导入产物错误均保留；不作为最终通过证据。字体重建485码点/100892bytes，SHA256 `9f939642629ac34c74d406bb355aff00f56086a372e687f8a514dee438b4f519`，作者资产未复制进Git源。

当前最终PCK `opaque-compat-platform-v3.pck` 191020bytes/25项，SHA256 `c8a55c1242527029f7af75c27add17a9d6401d4a60026bea7522aff8fbf5421e`（此前v1/v2 PCK原件保留，已被本版小型门禁修正替代）。自有audit逐项校验PCK目录MD5、实际打包脚本/shader/catalog与公开源一致、测试脚本/build_font排除、字体导入资源存在；保留28个共有基线文件逐字节一致，所有非D15目录项相同。原冻结父包未替换任何文件，独立宿主组合由外层后续完成。

## 平台门禁修正（电脑复核）

只读查看已有真机日志seq137，确认resultTrack=unknown，而缓存host.device无platform字段、system=Android 10、model=VCE-AL00，同时actualMode=glx、modeEvidence=observed。main与独立renderer都调用同一静态HostBridge.initialize()缓存；原bridge在第二次JS平台查询未返回ios/android时映成unknown（此次为何没有返回已识别值尚未定位），不能把resultTrack等同原始系统字段，也不能将unknown无条件当安卓。第一版只认resultTrack=android会使这个真实结构不启用，已修正。

只修改独立兼容脚本，使用上述已缓存原始device字段，未改bridge/宿主/adapter、未新增手机/wx查询，未伪造resultTrack。正则从字符串开头匹配Android与数字版本边界；Fake Android 10、AndroidFake 10、Android 10fake、裸Android以及缺失均不通过。若platform字段存在但为ios/devtools/null/大小写Android，即便system声称Android 10也拒绝。

新增回归保留unknown+Android 10同形日志fixture允许、platform=android允许、Android10允许；unknown+iOS 18.3.1/系统缺失/伪字符串/冲突字段拒绝；已确认安卓仍不能跳过实际WebGL/unknown模式与unobserved拒绝。各case的platformEvidence来源和未改写resultTrack断言随native-09 RESULT记录。旧源备份platform-gate-v1-source/、旧native07/08、旧PCK与旧审计均保留。

## 普通TextureRect边界补充（v3）

复核确认get_class()只返回native类，带GDScript的TextureRect依然返回TextureRect。补加target.get_script()!=null拒绝，防止自定义脚本节点进入普通分支；shader、平台条件与透明度逻辑均不改。

只运行受影响的compat_gate_verify.gd原生headless门禁：GATE_V3.json 15项通过、0失败、stderr为空。实测脚本子类get_class仍TextureRect、安装脚本后撤销、带脚本初次configure拒绝、撤掉脚本后恢复。检查纹理/几何/UI self_modulate、父clip_contents和modulate原值不变；已有CanvasItemMaterial拒绝后保留、外部替换材质在撤销时保留，NinePatch既有材质和patch margin保留。未发现额外状态恢复缺陷。GATE_V3 SHA256 c9f35e79582f1eee29a384ffc2369da14028c410f542ed84888729510294ff9b。

此前native-09的154项图形矩阵保持原证据，本次未无理由重跑；v3不把headless门禁称作新图形通过。重新导出并审计源码/PCK，两个外部harness均排除；字体二进制字节不变，仅新源码provenance重建。v2源快照platform-gate-v2-source/、PCK与所有旧结果原件保留。未操作手机或上传。

## 复现与后续边界

见[样例README](../examples/glx-opaque-alpha-compat/README.md)与[自有源/PCK审计](../engine/opaque-viewport-compat/audit.mjs)。新建私有scene-work，生成固定来源字体，Godot import、图形运行compat_verify.gd、export-pack，再运行audit。证据输出要求新目录，避免覆盖历史结果。

当前可以据此准备独立组合候选；手机恢复与实际平台门禁仍未验收。继续保留旧冻结故障基线与第3项，不能将局部方案称为全局alpha正确或平台根因已定位。

