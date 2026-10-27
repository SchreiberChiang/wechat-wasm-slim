# 第4项不透明3D alpha：四模式后的源码回查与局部兼容方案

2026-10-27。本轮只读固定引擎、实际冻结JS/WASM与已有日志/图像，未改变引擎、库、场景、shader、候选或手机现场；没有构建、预览、上传、设备调用或新增探针。第3项红片仍单列。

**结论：已确认“预期不透明alpha=1”与“最终采样后模型区域alpha暗”的不一致，但尚未找到自有源码中的确定错参或漏恢复。** 可以提出仅作用于已知不透明视口显示的局部兼容修正，不能把它叫作已经定位并修复底层alpha写入问题。

## 本轮新增证据

既有附件/清屏/混合编码检查直接沿用[此前源码审计](ANDROID_ALPHA_PATH_SOURCE_AUDIT_20261027.md)与[混合状态审计](ANDROID_BLEND_STATE_AUDIT_20261027.md)，未将相同检查重复算作新发现。以下源码行号相对于本地实际补丁树 `E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build/engine/`，源码固定df3cdd9bc9941a20cb5575d781cde6f937637bcb。

### 1. 不只是源文件里写着alpha=1，模板确实进入了当前WASM

冻结912c包BR解压后的WASM SHA256仍为 `ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244`。从构建生成头提取Scene fragment的6段原始字符串及Canvas fragment的2段原始字符串，**8段全部逐字节存在于该WASM**。Scene生成头3213行仍初始化alpha=1，3764行仍将alpha作为片元输出第四分量。未发现“源文件正确、实际包模板却是另一版”的证据。

这是完整存储模板的配对证据，不等于已取得运行时材质特化后的GLSL，更不等于平台实际编译输入。宏选择、运行时材质生成、库源码处理及平台执行仍不可由此一并认证。

### 2. 当前不透明方块没有从数字贴图取透明度的预期路径

实际场景 `_cube()` 使用Color.WHITE的StandardMaterial3D与不透明数字贴图；`_material()`仅color.a<1才选择透明模式。本例没有shadow_to_opacity、距离淡出、折射或透明预通过。material.cpp:1807–1808只有相关透明/淡出条件才生成ALPHA乘贴图alpha；正常不透明条件不生成这段乘法。scene.glsl:2231初值1，2782输出alpha；后续雾、曝光、sRGB、附加照明与premul代码修改RGB，不是本例隐藏的alpha清零语句。shadow_to_opacity确实可能改alpha，但本例未启用，不套用其分支。

因此背景清屏路径与几何shader写入路径在源码上都应给alpha1。真机alpha灰度“模型暗、背景亮”使几何覆盖像素的写入/后续采样成为更集中的边界，削弱整张附件无alpha、全局采样一律返回alpha0或全画布常量透明度为零的简单解释；不是对原始附件数值的直接测量。

### 3. 复制和后处理不能笼统称为全部保留alpha

补查 `effects/copy.glsl:179–180`：MODE_MULTIPLY执行 `color *= multiply`，会乘整个vec4，包含alpha；copy_effects.cpp:184–202的screen/exposure版本会传入该乘数。此前“复制保留alpha”的概括需带上这个例外。

但这**不是当前故障的修复点**：本例Environment为BG_COLOR，没有BG_CANVAS、glow、SSAO或调整效果，缩放1、MSAA关闭；rasterizer_scene_gles3.cpp:2465起只有RGB10_A2且glow启用时乘数才为.25，否则1。render_scene_buffers_gles3.cpp:183起仅缩放/环境后效/Canvas背景曝光需要内部颜色缓冲；默认条件下get_render_fbo:639起返回本RT。post路径也有明确的中间缓冲/MSAA门禁。这里能给出条件路径，手机实际FBO/宏状态仍未读取，不能把这些静态默认值包装成GPU查询。

无论如何，若是普通全图乘数且作用于整张颜色复制，通常也应影响背景alpha；它与本轮模型/背景的空间差异不吻合。不建议为此修改copy shader、曝光、清屏或附件格式。

### 4. 最终采样没有“已知不透明源”的独立处理

Canvas默认fragment在canvas.glsl:567取得插值调制色，631行将其RGBA乘源纹理RGBA，697处才进入自定义fragment，716行后还可能乘Canvas调制，869行输出。Canvas绑定代码2242–2297知道纹理关联RenderTarget，但这里仅绑定/设置采样和used_in_frame，未利用“不透明RT”的语义改写纹理alpha。这是现有设计，不是新发现的漏调用。

四模式中的s=COLOR因此已经包含采样和调制，不是原始texel。已取到的mode0/1长日志确认同纹理/RID、白色modulate/self_modulate、两材质实例不变；后两模式正文缺失，保留截图/动作证据，不能补称uniform全程日志通过。具体覆盖见[本轮手机结果](ANDROID_CASE4_ALPHA_MIX_PHONE_3175_RESULT_20261027.md)。

另外，viewport.cpp:193的ViewportTexture::has_alpha()在此版本**直接返回false**，不检查transparent_bg。不能据这个API自动把所有ViewportTexture识别为不透明，也不能用它实现下述范围保护；必须检查明确的来源视口配置。

## 推荐的一项最小兼容方案（仅方案，未实施）

如果下一步允许以局部兼容方式先恢复第4项，我推荐：**仅对明确来自非透明SubViewport的普通TextureRect，在最终显示时忽略源纹理的alpha，保留原UI自身的alpha和MIX混合。** 与直接把最终COLOR.a写成1不同。

范围先严格限定为现有第4项左侧这一张显示：来源是当前唯一320×260、transparent_bg=false的视口；独立安卓GLX候选显式启用，已有actualMode门禁仍需glx。默认WebGL、iOS基线及其他材质不自动启用。不根据OS名Web推断手机平台，不凭has_alpha()扩大匹配，也不修改所有Canvas采样。

最小场景级做法可以是一个专用CanvasItem MIX材质：vertex阶段只将**纹理采样前的UI顶点/项目alpha**传给fragment；fragment保留既有COLOR.rgb，将COLOR.a替换为这个UI alpha。后续Canvas调制仍由原模板处理。等价语义为：先把“明确不透明源纹理的alpha”视作1，再乘原UI色。无需额外texture()或重复乘RGB，不动UV、灯光、源3D材质、附件格式、清屏、深度、库、帧提交或公共adapter；无需重编JS/WASM引擎，仅场景材质/PCK将来会变化。

限制必须明确：只适用于此普通TextureRect、普通纹理分支。不得覆盖已有自定义fragment、MSDF/LCD、NinePatch的draw-center/边缘alpha规则、透明SubViewport、premultiplied/add/sub材质或独立mask。shader会新增一个标量varying和一套材质/程序，可能改变批次、编译与首次资源准备，不能说执行路径完全不变。若以后要进入通用引擎，需要另外设计来源标志和批次隔离，不能将这份场景级方案直接全局推广。

依据是本轮同RGB固定输出alpha1已恢复局部MIX，同时已知alpha标定正常；该方案将恢复范围缩到不透明源，并修正诊断模式会误丢UI透明度的副作用。简单算式核对12组源alpha/UI alpha：UI为0/.25/.5/1时，修正后仍为0/.25/.5/1；正常不透明源alpha1时与原语义一致。这只是算式检查，未写/运行新shader，也没有新增原生或微信验收。

**它是有依据的局部绕开方案，不是根因修复。** 它不会修好源附件、3D几何写入或平台采样本身，也不解决第3项红片。若用户要求本轮交付底层根因补丁，现有证据尚不足；不能将局部显示恢复冒充底层正确。

不推荐先加重复glColorMask/glEnable、不透明pass强行改变写掩码、改RGB10_A2为RGBA8或修改不透明scene shader输出：现有代码已有对应alpha1/恢复逻辑，这些改动仍在猜发生在哪一层。也不推荐新增诊断包来消除所有未知。

## 后续验证标准与本轮停止点

当前只给方案，未生成或上传新包。若以后批准准备局部兼容候选，先在电脑参考核对四个UI透明度、父节点透明度、普通遮挡裁剪、同源右侧以及透明源拒绝启用；实际源码/参数差异只允许专用材质和显式范围选择。还需保留原故障基线。电脑通过不认证安卓通过；手机新预览和操作必须另批，不能沿用本轮已完成授权。

无论未来是否恢复显示，都继续保留“源alpha异常原因未知”和第3项独立问题。当前最有依据的归因层为不透明3D几何覆盖像素至最终采样的alpha链，仍不是某一行自有实现已被定责。

## 本地审计与保存

新私有目录 `E:/AI/wechat-wasm-slim/.local/glx-case4-opaque-alpha-review-20261027-01/` 保存离线audit.mjs与AUDIT.json。16个固定源码/生成文件核哈希，9个与先前审计重叠文件相同；Scene6段/Canvas2段完整fragment模板均在冻结WASM，库026e哈希不变；冻结/预览27文件再次相同。AUDIT SHA256 `777a2ef85cfb6250321e6ec421e886b13e4ed7933837b49d7dad57583e85c257`。

本轮只新增脱敏报告与问题表接续；原始图像/日志、模板/反汇编、引擎二进制和官方库不进入公开提交。没有提交推送Git，不改变其他工作区、赛车或服务器。
