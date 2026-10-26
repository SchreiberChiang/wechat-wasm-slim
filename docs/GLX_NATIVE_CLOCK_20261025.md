# 纯 GLX 两帧时钟诊断，2026-10-25

候选 `native-glx-validation-089a47b231e870cec5f5`，父包 `native-glx-validation-f19e9c52adbca5eeb674`。用户授权电脑准备通过后上传这一个候选，手机仅核对实际 3.17.5 / GLX 并读取第 1、61 帧，不继续生命周期测试。出现异常、版本不符或缺第 61 帧即停止。此处是诊断，不是修复或稳定性验收。

## 已完成的电脑侧准备

- 只在独立 `glx-native-clock` 目录构建一次；未重新启动 Godot 构建或覆盖旧目录。
- JS SHA256 `30886b1631d44733cee730df8e04e7684d2a3864d330c88a6158ccf0ecd047dd`，101,027 bytes；WASM SHA256 `6460a52c742bb5bbea0e5133215c8b82f5e96b4c55cd2ec48c53ee3728723afd`，344,816 bytes。源 SHA256 `5e4c48f0d6d0abf6ddeaf500754e8c26d7daa2e3cf923262e2b6db3b34a9d09f`。
- 固定库仍为 `libemscriptenglx_4.0.10.a` / `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`；context patch、SDK、host、adapter、observer 和帧提交不变。未升级库、修改默认 WebGL、接 Godot 或发送云数据。
- 删除标记的观察块并还原命名中间变量后，整个 C++ 与父例相同。实际生成 JS 的参考时钟映射为 Date.now。原始生成 JS 后缀和 WASM 与候选逐字匹配。
- 时钟/门禁检查 9/9、日志读取器 21/21、候选 stager 19/19、旧 V1 默认 stager 19/19。首轮 stager 在 pin 尚未生成时拒绝，失败记录保留；pin 就绪后的新目录通过，没有覆盖失败现场。
- 工具包必要回归 100 项通过、0 失败，包含默认 WebGL/GLX 配置与运行时合同；未传 Godot，因此未运行 Godot headless。`git diff --check` 通过。

两帧分别记录 raw double、`raw/1000` double、转 float 后相位、wave、RGBA、Date.now 毫秒参考和公共 context 句柄；参考时钟不驱动颜色。生成物在电脑未实例化或运行，检查不代表 iPhone 通过。

## 包与回退材料

原工具仓库本机忽略目录 `.local/glx-native-clock-20261025-01/` 保存构建、候选、审计、单次上传记录及之后的手机证据。旧父包保留在 `.local/glx-native-contrast-20261025-01/candidate-01/`，其首开失败证据在同根 `first-log-01/`；更早正常三角形在 `.local/glx-native-validation-20261025-01/candidate-02/`。旧文件哈希在准备前后核验，禁止自动回退换包。

## 手机结果

已按用户授权仅调用一次二维码预览，工具确认成功；上传后候选逐文件核验通过，原 JS 后缀及 WASM 未漂移。二维码与完整工具响应只保存在本机忽略目录。用户提供完整 vConsole 后，已完成本轮两帧诊断，不再上传或进行重进测试。

必须用本候选完整 vConsole 关联包、单会话、实际版本、GLX 与两个 CLOCK。观察到第 61 回调并不等于每帧呈现；背景不变不单独判 GLX 最终呈现故障。若数值证明时钟/float 问题，仅关闭该最小样例的具体未知，不关闭完整 Godot 黑屏问题。

日志 `vconsole_1792871019305.log` 为 5,741 bytes，SHA256 `6b7809c8b30cf66e33ad82aba5f7e785b9e35f083c20eaf66cad6e11c3cc0de5`。单包/单会话 `triangle-mvmt447v-3jgk4u32`，scene=1011，iPhone 16 Pro / iOS 18.3.1 / 微信 8.0.75；首行 Wechat Lib 和 entry SDKVersion 均为实际 3.17.5。GLX 0.1.11 标记、actualMode=glx、metadata/canvas match=true；两个 shader 请求/返回各为 35633/35633、35632/35632。未见 error/blocked/编译或链接错误。

| 字段 | 第 1 帧 | 第 61 帧 |
| --- | --- | --- |
| rawClockDouble | 1792871019.418 | 1792871020.395 |
| secondsBeforeFloat（原公式 raw/1000） | 1792871.019418 | 1792871.020395 |
| phaseAfterFloat | 1792871 | 1792871 |
| wave | 0.98994255065917969 | 0.98994255065917969 |
| referenceWallMs | 1792871019418 | 1792871020395 |
| RGBA（计算值，非像素读取） | [0.05000000074505806, 0.74346268177032471, 0.10704022645950317, 1] | 完全相同 |

这次观察可确认：frame 回调推进到了 61；977 ms 的参考增量对应 raw 增量约 0.977，raw 呈秒尺度，原来的 `/1000` 又将相位放慢 1000 倍；double 相位仍有变化，但转 float 后完全相同，导致两次 wave/RGBA 相同。样例的时钟单位和绝对大数转 float 确实影响本次计算颜色，不能再把它当作纯数学猜测。

固定 adapter 的 `Date.now()/1000` 实现与这次观测一致，但日志没有直接跟踪被注入函数的来源；不据此认证所有会话的全局函数绑定。相邻 float 相位间隔在此量级为 0.125，秒尺度再除1000时对应约125秒真实时间；下一次跳变的具体时刻还受当前舍入位置影响。

仍不能确认每帧最终呈现、连续 flush/batch/swap、持续颜色动画、长期或生命周期稳定。用户这条回复只提供日志，本候选没有新增独立画面反馈/截图，不补造可见验收。该结论属于新诊断包，不把数值移作旧父包的直接实测，更不关闭 Godot shader 类型异常和强退黑屏。

原日志和分析在 `.local/glx-native-clock-20261025-01/phone-first-log-01/` 原字节保留。独立只读复核与读取器一致。本轮只完成这一项，未清缓存、上传第二版、修改修复代码或继续重进。下一候选若安排，应单独修正动画的相对时间和单位，保持库/帧提交不变；需重新说明并确认手机范围。
