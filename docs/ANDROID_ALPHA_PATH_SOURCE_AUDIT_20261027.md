# 安卓GLX alpha链路源码对照

2026-10-27。只做电脑侧源码、归档符号/指令及最终JS/WASM字节核查，未执行目标引擎、构建、换库、改渲染逻辑、上传或操作手机。当前97e包、第15项现场及旧证据不动。

**结论：已核到公开调用与GLX命令编码边界，尚未找到足以支持最小修复的确定实现错误。** 底板实验支持异常区域受下层颜色影响；可见源码要求这段不透明离屏输出保留alpha，两者之间仍缺安卓GLX实际执行后的状态证据。不能因存在差异就盲改属性、格式或强制alpha。

## 固定输入与证据边界

- Godot源码HEAD：`df3cdd9bc9941a20cb5575d781cde6f937637bcb`；本次固定树含原有适配/失败诊断补丁，未还原或修改。
- Emscripten：4.0.10，读取固定SDK的`libwebgl.js`、`libwebgl2.js`及`webgl1.c`。
- 实际GLX库：`026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。不是旧c70b库或另取的发布包。
- GLX候选：`ios-functional-glx-97e50760597b509a10a5`，manifest `98c37d86334a338fc24641c71ba0993c2bce1958d5cecd65a937acb1e96d5e1f`。同内容WebGL冻结副本为`ios-functional-webgl-05f063b585ad5b39676e`，本轮没有运行它。
- 两份27文件manifest均通过；共同引擎JS仍为`e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb`，共同loader为`1dd408fa7a69e2f4652033d6f08c12d70bb6f233cb3074bd0e7510173aa1ae1b`；BR解压WASM仍为`ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244`。
- 已用固定LLVM从实际归档只读提取三个成员到内存，与此前静态分析对象逐字节相等：main.cpp.o为`8c291f51c7ba1f672c8807e2035a8fd32d45422bb9adcc2daf0ad0bd3d94c952`；GlState.cpp.o为`d95634dcd5904391fa80735badbb5062f17453a9b277e0da05b72615ef297cee`；JsBinding.cpp.o为`3e973bf04183178541d9a5d1d154bd301e86da3b005f6504d41050b294a0931b`。

下列C++行号均相对于本地固定树`E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build/engine/`，不冒充未经补丁的上游行号。库位置指归档内成员的反汇编地址，不是运行地址或可写heap偏移。

表中scene.cpp、canvas.cpp分别简称`drivers/gles3/rasterizer_scene_gles3.cpp`和`drivers/gles3/rasterizer_canvas_gles3.cpp`；texture_storage.cpp位于`drivers/gles3/storage/`，material.cpp位于`scene/resources/`，viewport.cpp位于`scene/main/`。

## 当前场景到最终合成

| 环节 | 代码/参数依据 | GLX与WebGL的对照结果 |
| --- | --- | --- |
| 场景不透明条件 | 冻结renderer.gd:323–352，方块为Color.WHITE的StandardMaterial3D；只有color.a小于1才启用透明。SubViewport未改透明、HDR、MSAA、缩放默认值。 | 两后端场景字节和这些属性相同，未发现误把方块配置为透明。 |
| 颜色附件 | texture_storage.cpp:2554–2569、2605、2620，非HDR非透明离屏RT选`RGB10_A2 / RGBA / UNSIGNED_INT_2_10_10_10_REV`，空数据分配后挂COLOR_ATTACHMENT0。 | Godot没有按GLX另选格式；库glTexImage2D编码端保留这些枚举并处理空数据，未见直接改成RGB或丢弃alpha的代码。实际手机附件格式尚未读到，不能把没有RGBA8降级分支本身称为错误。 |
| 附件完整性 | texture_storage.cpp:2660–2679调用glCheckFramebufferStatus；失败会释放并清零尺寸、警告。 | 蓝/紫背景及同类视口2D文字正常，不支持整个FBO完全失效的简单解释；不能替代手机实际FBO状态证据。 |
| 清屏/写掩码 | 分配时texture_storage.cpp:2575全开RGBA；scene.cpp:2733关闭深度预通过颜色写入、2748恢复全开；2787–2789非透明颜色清屏alpha=1。 | Godot实际使用`glClearBufferfv(GL_COLOR,0,...)`。GLX编码端按四float复制16字节，普通WebGL用HEAPF32视图；未见本处丢alpha。 |
| 不透明绘制 | material.cpp:1807–1808在本材质条件下不生成透明alpha乘法；scene.glsl:2231 alpha初始1，2782输出。scene.cpp:2656先reset_gl_state，2761–2762配置混合因子并关闭opaque混合。 | C++/shader模板相同。SceneState::reset_gl_state在.h:502直接glDisable(GL_BLEND)，不是只修改缓存；没有发现Canvas残留blend因Godot只改缓存而漏关的源码证据。实际平台编译输入/输出与执行状态仍未知。 |
| 透明阶段 | scene.cpp:2913–2918启用混合；非透明目标的alpha因子为ZERO/ONE，保留目的alpha。 | 正常执行时不应把先前clear得到的alpha1降为0。仅源码契约，不是手机状态读回。 |
| resolve/copy/post | 默认关闭MSAA、缩放1；scene.cpp:3030–3075按条件进入blit/post；post_effects.cpp:96–100关闭混合；effects/copy.glsl和post.glsl采样vec4并保留alpha。 | 不能看到复制函数就宣称本次必经复制。库glBlitFramebuffer与glCopyTexSubImage2D编码端保留参数；没有找到自有后处理强改alpha。 |
| ViewportTexture到Canvas | viewport.cpp代理到RT纹理；canvas.glsl:631采样RGBA、869输出；canvas.cpp:756–762按源alpha混合RGB。 | 两后端同一shader/参数。ViewportTexture.has_alpha返回false不等于这里禁用源alpha；背景不透明也不使Canvas自动忽略源纹理alpha。 |

这是**Web WASM引擎**：detect.py:341定义WEB_ENABLED。安卓手机不会自动使同一WASM进入原生Godot的ANDROID_ENABLED分支。config.cpp中的原生Android EGL路径不能用于解释当前包。两模式可能从各自context取得不同GL能力返回值，但当前格式/alpha算法没有GLX专属C++分支。

## 实际GLX库的公开接口对照

普通模式通过`emscripten_gl*`到GLctx；GLX模式在库内编码后交batch接口。最终JS里存在普通wrapper，只证明fallback可用，不能证明GLX模式也逐条经过该wrapper。

| 接口 / main.cpp.o位置 | 可直接核实的行为 | 尚不能据此证明的部分 |
| --- | --- | --- |
| glColorMask `0x6350` | 每次保存并编码四个布尔值，无去重跳过；GlState构造器将四通道mask初始化true。 | 安卓消费者实际mask状态、执行顺序。 |
| glEnable `0x96b2` / glDisable `0x9244` | GLX无GL_BLEND特判或缓存省略，每次编码原cap；普通分支原参转发。 | 平台最终是否按此启停混合。 |
| glBlendFuncSeparate `0x5588` | RGB和A四个因子按序保留；glBlendEquation/Separate也保留原参数。 | 闭源消费者对独立alpha混合因子的实现。 |
| glClearBufferfv `0x29d6d` | GL_COLOR取4个float，正常非空指针复制原16字节；没有透明开关或alpha-only跳过。普通分支传原指针，SDK libwebgl2.js:649–655使用HEAPF32。 | 实际附件四通道写入结果。 |
| glClearColor `0x600d` | 四个原始f32保留，包括alpha。 | 同上。 |
| glTexImage2D `0x1cc0c` / glTexSubImage2D `0x1d750` | 保留internalformat/format/type；本次RGB10_A2的nullptr分配没有发现格式重写。 | 平台实际分配/渲染/采样格式。 |
| glFramebufferTexture2D `0x9a62` | 普通分支标准转发，GLX使用ID映射并编码附件。 | ID映射及消费者实际绑定；batch字段顺序不同不能脱离协议规范判参数错位。 |
| glBlitFramebuffer `0x263ce` / glCopyTexSubImage2D `0x76ad` | 保留公开调用参数，没有可见alpha重写。 | 平台复制时是否保留对应格式的alpha。 |

没有修改或猜测闭源batch协议、私有heap或状态偏移。归档输入能证明编码端行为，不能把它等同消费者正确执行。

### 已查到但不应套用的两个分支

1. **glClear特殊跳过**：`main.cpp.o 0x5efb–0x5fc4`在GLX、mask恰为COLOR_BUFFER_BIT、缓存mask为(false,false,false,true)、`GameGlobal.enableTransparentCanvas`为true时跳过clear；普通WebGL不跳过。这是真行为差异，但本次3D/RT颜色清屏走的是没有该条件的**glClearBufferfv**；Godot本段也没有alpha-only colorMask调用。不能将它作为本轮根因。包内宿主没有设置该字段，库getter缺省false；微信环境是否外部预置仍未知。
2. **压缩纹理TexStorage2D跳过**：需要USED_TEXTURE_COMPRESSION为true且格式是ETC1_RGB/ETC2_RGB8/ETC2_SRGB8；与此RGB10_A2离屏分配不匹配。未据此认定普通附件被跳过。

GlState的mask缓存不随glxUpdateContextId链自动重建是一项结构事实；当前没有多context/缓存失配的运行证据，不能因没有清理就直接认定错误。

## 一项确定的启动请求差异，尚非修复依据

实际同字节loader在WebGL路径先创建context，GLX路径延迟给Godot创建：

| 首次请求属性 | WebGL loader:85–96 | GLX Godot初始化：display_server_web.cpp:1136起及SDK webgl1.c:20起 |
| --- | --- | --- |
| alpha | false | 按当前项目预期false |
| premultipliedAlpha | true | SDK默认true |
| preserveDrawingBuffer | true | SDK默认false |
| renderViaOffscreenBackBuffer | true | SDK默认false |

这是静态请求值，未取得本次手机getContextAttributes实际值。自有createContext补丁只改webgl名称为wxwebgl并透传属性，未改alpha或材质输出。

更重要的是，**renderViaOffscreenBackBuffer请求不等于当前WebGL真的存在Emscripten后备FBO**。固定detect.py:347–349仅非use_wx_glx配置链接OFFSCREEN_FRAMEBUFFER；本次两模式共用的引擎是use_wx_glx构建。最终JS的defaultFbo/defaultColorTarget/createOffscreenFramebuffer均0处，renderViaOffscreenBackBuffer只有一次属性读取。SDK libwebgl.js:846–1147的RGBA纹理、深度附件、默认FBO重定向和commit blit属于宏控制下的另一构建配置；不能套到当前WebGL包，更不能假定GLX等效实现。

因此保留preserveDrawingBuffer首次请求差异，尚无证据把它与局部模型透底关联；不建议为了对齐就改true。局部模型区域受底板影响、周围蓝紫内容正常，也不足以直接归因默认画布保留策略。loader清理曾clearColor(0,0,0,0)属于引擎start之前、GLX无loader context会跳过；未发现它在本次离屏3D绘制中重入的证据。

## 现有证据能否支持修复

**目前不能。** 已排查的自有层没有找到可证明的alpha参数改写或漏恢复；已找到的配置差异及特殊库分支都缺少与本轮故障的触发关联。强制Canvas忽略alpha、改RGBA8、改透明背景、换库或加延时都不能据此作为根因修复。

最有依据的剩余边界是：**不透明离屏几何本应写入alpha1，但到最终UI显示时出现底板颜色贡献。** 应优先核对安卓GLX消费者对RGB10_A2附件、RGBA写掩码、不透明输出及采样/独立alpha混合的契约和执行结果，而非继续泛查资源加载、光照或生命周期。尚不能区分附件内每像素alpha/覆盖已异常，还是采样/Canvas执行出了差异。

回查旧`ee2fd650`探针记录：采样记录数是0、pixelValues=null，不是返回了零像素；那还是另一份带探针引擎。它不能填补当前alpha缺口，也不会因此重启旧探针路线。

若需微信协助，现有材料足以提出具体问题草稿，**本轮未对外发送**：

1. Android 3.17.4 GLX在context alpha=false时，非默认FBO的RGB10_A2/RGBA/UNSIGNED_INT_2_10_10_10_REV是否完整保留独立alpha，不应继承默认画布alpha策略？
2. glClearBufferfv(GL_COLOR,0,[...,1])、全开colorMask、关闭混合的不透明draw之后，平台有没有已知的附件alpha/覆盖或随后采样问题？是否可提供对应消费者实现或受支持的定位依据？
3. SRC_ALPHA/ONE_MINUS_SRC_ALPHA与ZERO/ONE的独立RGB/A混合是否完整支持？以什么公开接口或记录能核实执行后的有效状态，而无需修改私有heap或猜batch协议？

这些是待核实的接口问题，不是已认定平台有错，也不意味着必须等待回复才能进行其他已授权电脑工作。本轮没有安排新手机验证或探针；没有依据前保持现有引擎和候选。

## 保存入口

本轮只新增本报告，并更新问题总表和底板结果的接续链接。17份固定源码文件、两模式完整manifest与JS/WASM及已有手机证据的哈希复核在私有`E:/AI/wechat-wasm-slim/.local/glx-android-alpha-source-audit-20261027-01/AUDIT.json`，SHA256 `c1658f2115c2ed7c63429d4e8f60177920b77c5ce0a43a75dbfdef51b1cb96ba`。归档/对象和原始指令材料沿用旧私有目录，不复制进公开Git。

此前原图及有限结论见[底板手机结果](ANDROID_LEFT_UNDERLAY_RESULT_20261027.md)。本轮没有新候选、构建/模拟运行、预览或设备调用，GLX-18仍未修复。
