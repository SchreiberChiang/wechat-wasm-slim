# JS 边界诊断候选准备，2026-10-25

用户授权独立电脑侧实现/回归，未授权上传或操作手机。已准备 `native-glx-validation-9b31f77db008bc37fda1`，父包 `native-glx-validation-bee48002c945db68649a`。当前菜单重新进入后红背景+三角形现场未动，不接Godot，不改库/公共adapter/默认WebGL/赛车/服务器/裁剪/分包。

后续用户明确批准此精确包一次预览，以及实际3.17.5/GLX门禁后首开→三点菜单重新进入各一次，并要求全部手机步骤一次告知。仅调用一次二维码预览，工具确认成功；上传后12文件逐字核验通过。尚待用户扫码/两份完整日志，未认证手机版本、画面或执行边界结果；不再上传其它版本。上述“未授权上传”描述准备阶段，最新授权与回执保存在本机PHONE_APPROVAL.json、PREVIEW_DISPATCH.json和PREVIEW_SUCCESS.json。

最新结果：两份完整真机日志已收到并归档，实际3.17.5/GLX及包身份均吻合。用户反馈首开正常、菜单重进后不变色；前两次应用及提交边界返回、第3次RAF helper返回可推断，但3–60次不逐次采样，仍未确定后续中断点。见[本轮真机对照](GLX_JS_BOUNDARY_PHONE_20261025.md)。已停止，不追加版本、不重开或操作手机；未通过生命周期验收。

## 具体差异

| 输入/路径 | 结果 |
| --- | --- |
| C++、WASM、GLX静态库 | 原件复用，没有编译/链接；WASM `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79`，库 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |
| 编译JS | 原 `737ea15afbad5c87ee9a09ce2c27ce998f32966533fc74b7ea225aa04d30f3df` 派生观察副本 `380cd9e605c753101f2273b919ad65ccfdc595fbd42e6d4ef858fe22f33f6534`；三个原调用加观察及追加MainLoop安装段，逆向逐字还原 |
| 原提交 | registerAfterDoFrame仍注册一次；flush/batch/swap原调用参数、接收者、返回对象、顺序、次数和异常保留，不补提交 |
| MainLoop | 包装原RAF helper及runIter/native delegate的边界；原scheduler和实际请求次数不改，不用timer或Promise驱动帧 |
| RGB/三角形 | 不变；颜色只用整数帧号，原COLOR180条上限不变 |
| adapter/game.json/版本及context门禁 | 与父包逐字相同；实际3.17.5与GLX仍需真机确认，配置值不充当证据 |
| host/observer | 独立新文件；补late host失败与错误订阅coverage记录；原始raw错误继续抛回，新诊断器自身失败隔离计数 |
| 会话残留 | 只读现有marker，afterDoFrame包装闭包绑定旧session，不清理或注销旧回调；未认证平台缓存或context身份 |

新事件prefix为 `[GLX_TRIANGLE_BOUNDARY]`，各边界只选第1、2、61次进入/返回，原throw最多4条，共用96条硬预算。事件记录整数顺序和只读ABORT/runtimeExited/loop generation等primitive，不读私有GLX heap或命令缓冲。函数参数中的现有batch视图原样交回，不解析其协议。

probe SHA256 `52e64def5ab1ab3548189c4a02dd67e982d500bb35a2991aec74ab59c92aaf8e`。非有限数字异常只记录NaN/±Infinity分类并保原值抛出，不认证longjmp根因；unwind与普通Error分开。新增包装改变callback identity且有开销；故障消失也不能当作修复。原日志缺61的解释仍见[边界审计](GLX_MENU_REENTRY_BOUNDARY_20261025.md)。

## 本地回归

- probe：15/15，含this/参数/返回/异常exact值、旧session闭包、96预算、无getter调用、非函数原样转发、不读取返回对象then、输出失败及重入隔离。
- host/observer：11/11，含旧新正常行为对照、晚失败、订阅缺失/throw、原raw错误、probe故障前后保护及一次fake实例化无retry。
- 准备/封存/拒绝篡改/包装表达式/启动prelude集成：最终17/17。
- 日志读取器：20/20，含缺61分层诊断、旧tag无entry、错误/预算/覆盖、数字与unwind、成对事件一起丢失的序号缺口。
- 仓库必要回归114项通过、0失败，包含默认WebGL/GLX合同；未传Godot，因此未跑Godot headless。未运行微信模拟器。
- 正式12文件候选逐字再生成核验通过；WASM、adapter、gates与父包相同。父包、失败/正常日志及库在准备前后核验原字节。

首次stager为16/17：篡改输入已被拒绝，但测试期望的错误文案未匹配实际长度门禁。补充清晰门禁文案后在新目录17/17；没有改渲染行为或覆盖失败测试输出。probe完善后的最终回归另存新目录，旧结果保留。

封存前将新增host文本的CRLF统一为仓库要求的LF，避免Git换行归一化后包标识漂移；仅换行字节变化，没有运行语义改动。早期本地candidate-01留存且未上传，最终candidate-02使用上述9b31f77d…身份；规范文本后的stager再次17/17及逐文件verify通过。旧手机父包不受影响。

这些都是自有观察代码+fake API及静态配对检查。仅将编译JS作语法编译、WASM作结构审计，没有执行编译程序、adapter或真实WASM，不等同手机通过。当前只完成独立准备，尚无本候选真机结果。

## 本机候选与回退

- 新候选：`E:\AI\wechat-wasm-slim\.local\glx-native-boundary-20261025-01\candidate-02`。
- 原卡红包/回退位置：`E:\AI\wechat-wasm-slim\.local\glx-native-framecolor-20261025-01\candidate-01`（父包bee48002…，用于恢复当前复现输入，**不是稳定性通过包**）。
- 原计时证据、早期正常/失败包仍在各自目录；本轮准备未替换它们。回退手机包也须明确确认，不自动操作。
- 本轮新源、测试、配套审计、父包seal/原日志/库保护哈希和未来交接入口保存于 `.local/glx-native-boundary-20261025-01/`。私有配置、二进制、seal和原始证据不上传Git。候选的CANDIDATE.json包含本机路径，已由packOptions排除预览。

## 后续已批准的手机范围（待用户执行/日志）

仅此精确候选的一次预览换包，当前iPhone先读取实际基础库；不是3.17.5即停，不下发、不清缓存。新包的实际GLX、metadata/canvas必须成立，不能静默回退。旧卡红现场会被这次获批换包替代，但原包/日志已封存。

1. **首开一次。** 观察橙色三角形和至少两轮连续红绿蓝，保持前台约20秒，导出完整本地vConsole，我读取包/版本/GLX及执行边界。画面、版本或覆盖有异常就停，不进入下一项。
2. **仅首开正常后，三点菜单 →“重新进入”一次。** 使用这次已明确的原失败入口，不改为关闭/最近使用、不强退微信。观察是否继续两轮变色，导出完整日志。卡红、黑屏、异常、预算耗尽或日志序号/覆盖缺口即保留现场停止，不重开、不重试、不追加版本。

本范围不含强退微信、后台恢复、手机截图/PID、云日志、清缓存或自动回退。授权后仅调用一次二维码预览；首开日志必须在菜单重新进入之前另存，避免切换会话丢失。每步用用户实际画面与对应完整日志关联，不凭swap返回、frame计数或异常消失宣布稳定。

预期区分：请求已返回但无交付；交付后native未返回或throw；flush/batch/swap进入后无返回或throw；计算和调用均继续但画面冻结；旧session回调在新entry后仍执行；日志本身覆盖失败。缺出口仍可能是阻塞或采集缺失，API返回不证明GPU/屏幕完成。本候选用于定位边界，未承诺修复或进入Godot。
