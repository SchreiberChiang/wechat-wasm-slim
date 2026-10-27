# 安卓第三轮：最终混合与透明材质状态传递

2026-10-27，只读固定源码、SDK及官方026e归档；不执行目标WASM、不构建、不改库/引擎/场景/包、不上传或操作手机。当前8f0ff候选、四段日志及旧包保留。此前附件/清屏/复制核查直接引用[原alpha审计](ANDROID_ALPHA_PATH_SOURCE_AUDIT_20261027.md)，本轮补齐第3/4页实际材质、Canvas批次、3D混合缓存及GLX入口参数对应。

结论：**目前确认的两条安卓画面异常都与alpha/混合路径有关，但不是“所有半透明都坏了”，也尚不能合并为同一个根因。没有找到足以支持直接代码修复的确定漏接或错参。** 第4页优先查最终混合/alpha消费，第3页保留为独立透明绘制线索；不全局禁用混合、不改不透明模型为特殊材质来声称修复。

## 固定依据

- 实际手机候选 `ios-functional-glx-8f0ff69c7eacb7a08790`；安卓启动3e9ad5de、VCE-AL00/Android10/微信8.0.79/实际3.17.4/GLX；iOS96fbcfcc、实际3.17.5/GLX。本轮两组日志和人工画面反馈见[真机结果](GLX_COMPAT_ROUND3_PHONE_RESULT_20261027.md)。
- 固定源码df3cdd9bc9941a20cb5575d781cde6f937637bcb，实际带适配补丁树：`E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build/engine/`。下面行号相对于这份实际树，不冒充纯上游行号。
- 库 `E:/AI/wechat-wasm-slim/.local/gin26-newlib-01/input/libemscriptenglx.a` 再核SHA256为 `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。Emscripten4.0.10，使用同一固定LLVM只读反汇编六个公开GL入口。
- 12个固定源码/场景文件核哈希；与前轮重叠的8个引擎文件一致，三份当前场景文件与冻结来源工作副本一致。没有用旧库/旧宿主替代现有输入。

## 两条路径相同和不同的地方

| 环节 | 第3页：3D红片 | 第4页：左MIX / 右禁混合 |
| --- | --- | --- |
| alpha来源 | StandardMaterial3D的albedo.a约.48，透明模式生成 `ALPHA *= albedo.a * albedo_tex.a` | Canvas默认fragment将顶点/调制色与 `texture(color_texture,uv)` 的RGBA相乘 |
| 几何/纹理 | 同一QuadMesh切透明模式与alpha；非离屏贴图显示 | 同一张SubViewportTexture、同RID，两TextureRect；默认白色调制，右仅增加两行Canvas材质 |
| 混合开关 | 不透明pass关闭；透明pass显式启用 | 左默认MIX启用；右BLEND_MODE_DISABLED显式关闭，回到MIX重新启用 |
| 正常非透明目标的混合因子 | RGB=SRC_ALPHA/ONE_MINUS_SRC_ALPHA，A=ZERO/ONE | 左同样一组因子；右关闭混合，四因子不参与本次颜色组合 |
| 人工观察 | 安卓不透明可见，半透明不可见；iOS正常 | 安卓左透底、右颜色/纹理/转动正常；iOS两边正常 |

该组因子的RGB语义是 `源RGB×源alpha + 原背景RGB×(1−源alpha)`，A采用ZERO/ONE保留原目标alpha。源alpha缺失/错误或有效混合状态执行不符，都可能使源色贡献消失；仅凭透底不能测出源alpha=0。第4页自身方块是普通不透明材质，最终UI仍按源纹理alpha混合，因此不能把它描述成“方块本来就是半透明”。

两路径共享同一类公开混合调用，但第3页还改变透明队列、排序/深度写入及shader变体；第4页还引入自定义Canvas shader版本/批次。不能把共同调用直接升级为同一故障已证实。普通2D和文字可见，也不支持“所有混合调用全失效”的简单解释；字体/普通图像与离屏附件的alpha来源仍不同。

## 新补齐的源码链

1. **场景配置与调制**：`examples/glx-compat-round3/renderer_base.gd:213`创建TextureRect，未给左右赋不同modulate/self_modulate或premultiplied设置；renderer.gd:108起共享同一源纹理，右只设ShaderMaterial。`rasterizer_canvas_gles3.cpp:1008`附近将rect/modulate与base_color四通道写入实例数据，未因ViewportTexture.has_alpha=false就跳过默认MIX。未找到左侧被场景误设透明度的代码。
2. **Canvas材质到批次状态**：`storage/material_storage.cpp:2673–2701`将blend_disabled编译为BLEND_MODE_DISABLED，只改变blend模式字段；它没有给右侧fragment添加颜色重写。canvas.cpp:644将默认材质映射MIX，733–802在模式变化时执行enable/disable与因子设置；从DISABLED回到MIX也有glEnable。`canvas.glsl:567/631/869`默认RGBA调制、采样、输出相同。生成器语义相同不等于已经取得安卓实际编译输入。
3. **Canvas状态基线**：canvas_render_items:116开始、571结束调用reset_canvas；2403–2409明确开启GL_BLEND、设FUNC_ADD及四因子。每次_render_items:579调用canvas_begin，2221–2227按目标透明属性重设独立RGB/A因子。局部last_blend_mode是代码缓存，不是平台状态查询；当前常规路径已有明确重设，尚无证据支持盲目增加重复重置。批次分割并不自动保证闭源消费者执行正确，也不因存在缓存就认定漏恢复。
4. **3D状态与缓存一致性**：scene.cpp:2656调用scene_state.reset_gl_state；scene.h:501起实际glDisable(GL_BLEND)并将current_blend_enabled=false。scene.cpp:2756–2764先设置FUNC_ADD、按transparent_bg设置四因子，并与current_blend_mode=MIX对齐；2913–2918透明pass通过enable_gl_blend(true)显式开启。scene.h:545起helper在状态变化时调用真实GL并更新缓存。MIX材质若因缓存未重复设置，在前面的pass设置中已有同值，不能直接判少调用。材质切换因子处理在scene.cpp:3410–3449。
5. **红片shader alpha**：material.cpp:1807–1808在透明模式生成ALPHA乘法，scene.glsl:2782附近将alpha写进frag_color。切回不透明不再生成该透明乘法。日志节点启用与alpha约.48/1已证实，但平台实际收到的UBO/最终shader输出尚未读取；不把builder代码等同实际GPU输入/结果。
6. **自有GLX接线**：`platform/web/js/patches/patch_em_gl.js`负责模式、原生初始化和contextID同步，没有按材质或左右显示改写blend因子/颜色/alpha的逻辑。两侧同一画布/同一源视口，不因两TextureRect就发生两次Emscripten上下文切换；SubViewport是FBO渲染，不能把公共context句柄当成每个附件的执行证明。
7. **普通WebGL与GLX入口**：SDK4.0.10 libwebgl.js:4323–4360通过四参数passthrough生成GLctx.blendFuncSeparate，方法接收者保留。026e归档main.cpp.o中glBlendFuncSeparate:0x5588的四个入参依次保留，普通分支按序转发、GLX分支按序编码；glBlendEquation/Separate和glEnable/glDisable没有发现本组参数重写或GL_BLEND专属丢弃。这只能证明可见编码侧，不能证明安卓闭源batch消费者按同一契约执行。

本轮保存了上述六入口的只读反汇编。LLVM在不含这些函数的其他归档成员上报告“missing symbol”警告，六函数均实际出现在main.cpp.o；不是本引擎链接缺函数，也不是手机运行报错。原回执保留，不吞警告。

## 修复判断与最小下一步

当前**不具备按证据修改渲染代码的条件**：没有查到左侧错误modulate、材质未启用、MIX/禁混合切换漏发、3D混合缓存错配或库四因子编码错位。旧附件RGB10_A2、清屏alpha1、opaque输出、复制和ColorMask已有核查，不重做或改成猜测修复。不同库/基础库/平台的执行结果仍有闭源边界。

最优先的具体缺口是第4页：同源纹理在采样后的实际源alpha，以及该draw执行时有效的BLEND启用、RGB/A因子、方程是否等于上面源码。右侧正常已说明RGB有可显示路径，不值得再改灯光、纹理资源或泛查加载。第3页应独立核对透明pass的有效blend和片元alpha，不先并案。

不直接提出全局禁混合、强制所有alpha=1、用blendFunc替换blendFuncSeparate或改附件格式作为修复；这些会改变透明UI语义或绕开故障。也不因尚缺运行态证据再自动上传探针。现有同包两显示端与红片对照已足够形成具体接口问题：**Android3.17.4/026e消费者对非透明目标 `SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ZERO, ONE` 的支持、目标切换后的状态生效及RGB10_A2附件alpha保留契约是什么；可用哪个受支持接口独立核实？** 此问题可供用户转交，未对外发送，不把等待回复当作其他已授权电脑工作的前提。

如后续能取得消费者源码、相应官方兼容说明或受支持的有效状态数据，再只针对已证实偏差做独立候选；当前不为了交付“修复”而编造改动。资源准备卡顿、GPU读回兼容缺口、生命周期/长期稳定性与这两条画面异常分开保留。

## 本地保存与保护

`E:/AI/wechat-wasm-slim/.local/glx-android-blend-source-20261027-01/`：audit.mjs、12文件哈希、六入口反汇编和完整stderr。AUDIT SHA256 `f95f39fa5ed74461c7b954ab4b05d41754493ecf24b7ba8ff7ce6558488ee120`。公开只新增本报告和问题表接续，不提交归档/反汇编/原始日志，不修改候选，未提交推送Git。
