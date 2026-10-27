# 微信GLX咨询技术证据（2026-10-28，未发送）

本文是可供人工转交的材料草稿。没有发送、上传、运行新包或操作手机。事实来自既存报告、原场景截图及用户导出的日志；源码请求、日志事件和人工画面观察分别记录，不把任何一层替代为GPU执行证明。

## 问题与设备分组

| 组 | 已有条件 | 观察与限制 |
| --- | --- | --- |
| iOS原基线 | iPhone16 Pro；iOS18.3.1；微信8.0.75；实际SDK3.17.5；GLX | 第三轮同一自编译候选8页用户观察正常；准备等待仍存在。非长期/生命周期验收。 |
| Android历史原基线 | VCE-AL00；Android10；微信8.0.79；实际SDK3.17.4；GLX | A红片不透明可见、半透明不可见；B同纹理左MIX透底，右禁混合颜色/纹理/转动正常。 |
| Android四模式原基线及诊断 | 同设备/系统/微信；实际SDK3.17.5；自编译912c候选 | 本轮仅B，不补造同SDK的自编译A视觉对照。四图见下表；上排原基线一直保留。 |
| Android作者预编译整套包 | 同设备/系统/微信；实际SDK3.17.5；GLX | A透明→不透明→透明往返复现；B初始直通复现。仅有限对照，没有全功能验收。 |

跨平台同时存在系统、微信、SDK差异，不是单变量实验。作者包与自编译包还存在loader初始化差异，不能按单个库差异归因。A/B共享alpha/混合线索，但A还涉及透明队列、shader变体和深度/排序，B涉及离屏附件及Canvas批次，暂不并案。

## 固定输入身份

- 自编译Godot源码pin：`df3cdd9bc9941a20cb5575d781cde6f937637bcb`，实际树含适配补丁；Emscripten4.0.10。
- 自编译使用GLX静态库SHA256：`026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。自报`0.1.0 / 2026.09.02`只作标记。
- 026e库来自用户联系微信官方后提供的`libemscriptenglx.zip`，唯一成员`libemscriptenglx.a`为3,866,614字节。当前没有已证公开下载地址或随附许可文件；仅分享文件指纹和测试结果，不分发库原件。此输入不与作者tpz内嵌库混同，后者哈希仍未知。
- Android四模式候选：`ios-functional-glx-912c537585a6f3a07ef5`；manifest SHA256：`fa54b3f15d4fbb989bed9bf9a9c67743a1283e803684f17cb5598bf193938215`。
- 作者来源：[hao0917/godot-minigame 4.7 release](https://github.com/hao0917/godot-minigame/releases/tag/4.7)，归档`minigame4.7.0.8.1.tpz`。作者JS SHA256 `12361da76c9702ed3d72ad8a4ea6ba4e9d930ee9de706d47039c6b38f8850644`；WASM解压后SHA256 `1929f30fd3d59497a5e49a0e2ef8a971cbeb9ec821d29c71720df4d9eaba3cfd`。嵌入静态库原件哈希、完整构建参数和未提交改动未知，不能由marker推断等于026e。
- 作者候选：`author-glx-round3-a04b37c250a27645bd7d`；manifest SHA256 `1eff7626fc02ae8d6c86481cc3f1571de61c9d93434e377d2e85f87ee96a5426`；与912c共用PCK SHA256 `e15c8a6981f87d4ee51f3bc77f4bbf4add697d45666ae30407960731e6f4b86e`。

这些是电脑保留文件身份及运行日志关联，不冒充手机逐文件读回。作者整套包仍复现，削弱“只有本仓库自编译修改才触发”的解释，未证明平台有错或两库相同。

## 四模式图应如何读

证据页`evidence.html`包含原像素PNG与独立框注。第4页**上排始终是原基线：左默认MIX，右禁混合**；下排是诊断：左MIX，右DISABLED。右侧界面旧称“忽略纹理alpha”，实现是关闭混合，不是修改纹理alpha。小示意图不是实际红片显示结果；FPS覆盖文字不用于性能认证。

| 图 | 画面观察 | 日志覆盖 |
| --- | --- | --- |
| selfbuild-case4-mode0.png | 下排直通：左模型区黑、右纹理彩色；上排左透橄榄底 | seq141 modeIndex0；seq146暂停方块 |
| selfbuild-case4-mode1.png | 下排已知alpha四带两边目视一致，原基线仍异常 | seq147 modeIndex1；软件参考参数有记录 |
| selfbuild-case4-mode2.png | 下排采样后alpha灰度：模型黑、背景白 | 有截图与已有动作回执；导出正文无modeIndex2事件 |
| selfbuild-case4-mode3.png | 下排保留RGB且固定输出alpha1：左恢复彩色；上排仍透底 | 有截图与已有动作回执；导出正文无modeIndex3事件 |
| author-case3-transparent.png / author-case3-opaque.png | 主画面左侧红片半透明不可见、不透明清晰可见；右侧仅示意图 | 作者本轮只有恢复过滤后的可见日志截图，未取得完整导出；不附该日志截图以免裁切被误当完整正文 |
| author-case4-baseline.png | 上排左MIX透底、右禁混合纹理正常；下排停留直通 | 未切作者版四模式，不移用自编译四模式日志 |

四带只检查黑底上特定常量的源RGB贡献，不证明所有独立alpha/目标项正确。灰度是fragment采样并调制后的`COLOR.a`，不是原附件alpha数值读回；固定1恢复支持低源alpha参与最终透底，但不定位首个出错环节，也不等于可通用强制alpha1。新增shader/材质/批次及整体fit变化属于诊断扰动；日志seq147明确记录baselineOverallScaleChanged=true，不能把四模式称为完全单变量实验。

## 可见调用链与未取得的执行证据

以下行号相对于已有实际补丁树，不声称为纯上游行号；只列仓库相对文件名，不包含电脑私有路径。

| 环节 | 已核源码/编码请求 | 仍未知 |
| --- | --- | --- |
| 非透明源视口 | 同一320×260 SubViewport，非HDR、非透明背景，同一纹理对象/RID，白色调制 | 手机实际附件逐像素值 |
| 颜色附件 | `drivers/gles3/storage/texture_storage.cpp:2554–2569,2605,2620`选择`RGB10_A2 / RGBA / UNSIGNED_INT_2_10_10_10_REV`挂COLOR_ATTACHMENT0；库编码保留枚举 | 实际格式/支持降级/完整性有效值 |
| 清屏与写入 | 同文件2575全开RGBA；`rasterizer_scene_gles3.cpp:2748,2787–2789`恢复RGBA、`glClearBufferfv`清alpha1；opaque阶段关闭混合；`shaders/scene.glsl:2231,2782`初始alpha1并输出 | 编译后shader、实际write mask、附件写入结果 |
| 透明阶段 | `rasterizer_scene_gles3.cpp:2913–2918`启用混合；RGB=`SRC_ALPHA/ONE_MINUS_SRC_ALPHA`，A=`ZERO/ONE`，正常应保留目的alpha1 | draw时有效状态及片元输出 |
| 最终Canvas | `shaders/canvas.glsl:631,869`采样RGBA输出；`rasterizer_canvas_gles3.cpp:756–762`按源alpha混合；禁混合端只改变blend模式 | 采样/调制结果及执行后混合状态 |
| 编码边界 | GLX归档`glBlendFuncSeparate`四入参按序编码，enable/disable、clear四float及格式枚举未见此处重写 | 闭源batch消费者的执行顺序、目标切换及有效状态 |

源码契约下，非透明源视口clear/opaque应保持alpha1，最终MIX RGB为`srcRGB×srcA + dstRGB×(1−srcA)`，目标A以ZERO/ONE保留。这个预期不是有效GPU状态读回。未找到足以支持直接修改自有层的确定错参/漏恢复；不猜私有heap或batch协议。

## 日志摘录与缺口

分享包仅含白名单字段摘录`log-excerpts.json`，源自用户原始导出，SHA256 `eded1c38eb49dff7d96d1dbe32ae5f8c158050625c1d472b45647b4f429b8148`（139942字节）。摘录是字段投影，非原始逐行日志；不带会话标识、账号、路径或完整host对象。保留操作序号以供追溯。

已有143条JSON可解析、140条场景事件；序号1至147，早期43–49缺失；本轮transition15的137–147连续。正文结束在mode1的seq147，后两截图晚于文件结束，缺失原因未知，不能称四模式完整日志。作者日志只有过滤恢复后的可见截图，不能断言全程无错误、编译/绑定成功或完整状态已核。

原导出有4条RGBAFloat转RGBAHalf格式降级警告；该文件未见shader编译/绑定失败、RuntimeError、TypeError或Parse JSON failed正文，仅对已取得范围有效。共同警告不能独立定责两项异常。

## 希望官方确认

1. Android GLX按当前项目/源码请求context alpha=false（本次实际getContextAttributes未读回）时，非默认FBO的RGB10_A2附件alpha写入、clear、复制和采样是否完整支持？是否存在与默认画布alpha策略关联的已知限制？
2. RGB=`SRC_ALPHA/ONE_MINUS_SRC_ALPHA`、A=`ZERO/ONE`的独立混合以及FBO/目标切换后状态生效的契约是什么？有无涉及透明pass/Canvas的已知限制？
3. 推荐的GLX静态库、基础库与配套工具链是什么，怎样核实实际嵌入库版本？
4. 应通过哪些受支持接口检查实际附件格式/alpha、有效blend启用/因子/方程及shader输出？现有GPU读回缺口不应由私有协议猜测填补。

## 原基线、兼容与准备等待的边界

本材料截图全部来自原基线或明确标记的诊断分支。任何后续应用层兼容候选均**未纳入这些真机证据、未验收**；关闭混合/固定alpha会改变透明语义，只能作为受限绕开，不能声称根因修复或全局适用。iOS某些页资源返回到绘图回调约2秒的准备等待是独立问题，不是GPU耗时或首呈现测量，也不从本次显示问题推断其根因。

## 分享范围与复核清单

私有打包根下的`share/`目录内只有：两份草稿副本、`evidence.html`、7张重命名场景PNG、`log-excerpts.json`、`SHARE_SCOPE.md`、`MANIFEST.json`、`SHA256SUMS.txt`。PNG不修改像素；逐块检查只含必要PNG结构/颜色精度块，无敏感元数据；SHA与原图一致。HTML框注独立于像素，离线无外链脚本。

不包含AppID、账号、设备序列号、电脑私有路径、助手版本列表、原始日志/ADB回执、作者二进制、官方静态库或可执行包。ZIP仅从上述白名单生成；单独审计回执保存包外，不作为分享内容。需要完整复现工程/二进制时再另行核授权和范围。

依据：[作者版对照](ANDROID_AUTHOR_PRECOMPILED_COMPARE_20261027.md)、[四模式结果](ANDROID_CASE4_ALPHA_MIX_PHONE_3175_RESULT_20261027.md)、[alpha源码审计](ANDROID_ALPHA_PATH_SOURCE_AUDIT_20261027.md)、[混合状态审计](ANDROID_BLEND_STATE_AUDIT_20261027.md)、[第三轮手机结果](GLX_COMPAT_ROUND3_PHONE_RESULT_20261027.md)。
