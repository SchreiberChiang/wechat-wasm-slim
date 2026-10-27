# 第4项：alpha与最终混合的局部电脑对照

独立场景副本，来源为已验收候选8f0ff的第三轮源。`renderer_round3.gd`逐字节保留原renderer，`renderer_base.gd`和第3页红片逻辑不变；新的renderer只扩展第4页。原引擎JS/WASM、026e官方库、宿主/提交及源320×260 SubViewport不改。旧包和原始日志不覆盖。

保留上排原默认MIX/原禁混合基线，新增下排同源、等尺寸的MIX和DISABLED局部显示。两份shader仅render_mode不同，通过`case4_fragment.gdshaderinc`共用fragment正文，不重采样或重复乘COLOR。两个材质创建一次，用observation_mode uniform切四模式：

1. 原RGBA直通：检查新增shader是否改变故障触发条件。
2. 已知alpha四带：0/.25/.75/1白源覆盖局部黑底，和禁混合的软件灰度参考对照。
3. 采样后alpha转灰度RGB，输出alpha固定1。
4. 保留采样RGB，输出alpha固定1。

黑底四带只检查源RGB贡献，不证明目标RGB因子或独立A通道正确。灰度图测的是默认采样×调制之后的alpha，不是附件原始alpha数值；无图/不可辨认不等于0。固定alpha1恢复、禁混合显示或材质创建成功均不自动构成修复/视觉通过。

新增shader/材质、uniform、局部底板和draw会改变批次/状态切换与编译时序；若原故障消失或新标尺异常，如实记录，不追加变体。第4页设计画布增高至620×620以放下诊断窗，原两个基线的设计坐标/尺寸保持，整体适配缩放会变化；它不是几何布局完全不变的实验。

`alpha_mix_verify.gd`是外部电脑图形harness，仅该harness可截图/离线采样，导出排除。生产候选没有GPU读回、数值GL查询、手工flush/swap、固定计时器兜底或全局禁混合。main/bridge沿用真实身份/版本记录，人工结果默认不变。

构建仅使用固定Godot4.7.2导入/导出PCK；字体使用原Noto Sans SC/fontTools4.60.0来源重新生成本场景字符子集。按`engine/functional-acceptance/stage.mjs`原门禁派生两模式冻结包，不重编引擎。原生/电脑WebGL/手机GLX结果分开；手机预览和控制须另批。
