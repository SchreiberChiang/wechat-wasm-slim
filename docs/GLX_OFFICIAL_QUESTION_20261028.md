# 微信GLX接口咨询草稿（2026-10-28，未发送）

您好，Godot Web WASM接入GLX遇到两条Android异常，想请协助确认：

- A：同一3D红片，不透明正常，alpha约0.48时不可见。
- B：同一离屏纹理，MIX模型区透底，禁混合RGB正常；采样后alpha灰度模型黑/背景白，固定输出alpha1恢复局部MIX。灰度不是原附件读回，固定1仅为诊断。

iPhone16 Pro/iOS18.3.1/微信8.0.75/SDK3.17.5正常；VCE-AL00/Android10/微信8.0.79：3.17.4历史失败，3.17.5自编译B及作者版A/B失败。自编译库SHA以026efcef开头；作者库哈希未知，仅marker0.1.0/2026.09.02。

源码请求RGB10_A2、clear/opaque alpha1，混合RGB=SRC_ALPHA/ONE_MINUS_SRC_ALPHA、A=ZERO/ONE；尚无有效GPU状态读回。

请问附件/独立混合/目标切换的支持契约、已知限制、推荐配套库及受支持检查方法是什么？附对照图与脱敏摘录。A/B不合并根因、不预设责任；准备等待另列，兼容绕开未验收。

详细材料：[技术证据与分享清单](GLX_OFFICIAL_EVIDENCE_20261028.md)。
