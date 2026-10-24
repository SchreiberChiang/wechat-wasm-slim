# GLX 原始 TYPE 返回：同包首开正常、强退重开黑屏

2026-10-24。代码检查点 `a49d25d`，批准包 `shader-type-return-glx-03fa0871dc99f85cc4a2`。用户报告首开两块白点均正常运动且点过“读取诊断”，关闭微信重开后黑屏。以下由两份用户导出的完整 vConsole 核对；本轮分析未再操作手机、上传、换包、清缓存或采集云日志。黑屏未修复。

## 包与两轮证据

| 项目 | 首开 | 用户结束微信后重开 |
| --- | --- | --- |
| 原始文件 | `vconsole_1792801083251.log` | `vconsole_1792801410723.log` |
| 字节 / 行 | 5,181 / 75 | 10,349 / 89 |
| SHA256 | `e6007cf09de6797af6d704fb0c4821f50d0db0dbe43de3cff5b5664bcc2e1627` | `5daf6fa9c40c3f9370c480e329500d84165195c6805fa74ef4c888126788ce03` |
| 会话 | `ba727e5d` | `638674f8` |
| 实际模式 | GLX，手动诊断确认 | GLX，SCENE 确认 |
| 画面 | 用户确认两块白点都在动 | 用户确认黑屏 |
| shader 失败记录 | 导出中未出现 | 第 80 行一条完整 JSON，3,993 UTF-8 bytes |
| 按钮读取 | 第 25–75 行完整手动摘要 | 未要求在黑屏时点击 |

两轮 ENTRY 均对应上述包。首开手动摘要的完整 identity 与本地封存候选完全相同，包括引擎配对 `22817d2aef660419abb4135405554cd59d279b1590485ba52062c02fe88ead4d`、补丁 `84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6`。配套编译见[电脑验证](GLX_SHADER_TYPE_RETURN_20261024.md)。包内 26 条封存清单重新核对一致。

设备描述一致：iPhone 16 Pro / iPhone17,1、iOS 18.3.1、微信 8.0.75、实际基础库 3.17.5。画面与操作依据用户反馈；本轮没有另外取得截图或 PID，因此新会话已确认，但不能称进程重建已被独立取证。首开也不自动计为微信冷启动。

首开手动摘要是逐行带 `[log]` 前缀的多行 JSON，完整可解析；不能因未出现单行 `SELFBUILD_CANDIDATE_SCENE` 而漏记按钮或场景成功。手动摘要有 `sceneRead=true`、实际 GLX、context/canvas 匹配；日志另有 `AUTHOR_SCENE`。两轮仍有已知 JSON parse 错误，独立问题继续保留。

## 新取得的关键事实

| 字段 | 结果 |
| --- | --- |
| Godot 请求类型 | `35633`，顶点 shader |
| `GLX_TYPE_RAW_RETURN.rawType` | `number`，有限 primitive number，非 null |
| 原始数值 | `35632`，片元枚举 |
| JS→WASM 后 `batchReturnedType` | `35632` |
| arm / take / capture | 各 1，`validArmCount=true`、`returnObserved=true` |
| 本次调用的参数长度 | 32 bytes；只记录长度，不解析 batch 协议 |
| program / shader 编号 | 1 / 1；不证明共享命名空间或冲突 |
| 源码 | Godot 原文与 GLX 返回均完整 1,268 bytes，逐字相同，无截断 |
| 源码 SHA256 | `579b7feda3b663171d67e4ac59808a2d618d3b0971634d2acc03f2ac941ce64f` |
| 原始编译错误 | 完整 218 bytes，与控制台四条错误完全相同 |
| 公共 context 采样 | 1 / 1 / 1，不识别平台底层 context |

带行号的 builder 按 LF 拼接（末尾空编号行已经代表末尾换行）与诊断原文相同。错误仍是 `Invalid use of layout 'location'`、`vertex_attrib` 和 `gl_Position` 未声明。SOURCE 返回为字符串与 TYPE 返回为数字是两个不同查询，不应混淆。

结合固定源码中 arm 紧邻既有 TYPE 查询、实际 JS import 原值返回和一次性计数，本轮可以排除：**这一次 JS→WASM 转换把正确的 35633 改成 35632**。类型查询结果在离开 GLX `batchRender` 接口时已经是数字 35632。

这没有证明平台真正编译的对象就是片元 shader。原始值来自同步整批调用返回，平台内部究竟从哪个对象表/getter/缓存取值，以及返回是否对应预期查询，仍是接口合同缺口。返回源码也不能认证平台实际编译输入；公共句柄相同不能认证底层 context 相同。共享 ID 冲突仍未证实。

## 下一步边界

本次实验已经回答原始返回类型问题，不再重复该包来追求偶尔正常。优先检查范围为 GLX 返回之前的 shader 对象创建/关联、查询分派与 context 生命周期；不再把本次数值转换列为未决解释。

若继续本地设计最小实验，应只区分“创建后即不一致”与“传源/编译后才不一致”：在目标 CopyShader 顶点对象创建后、传源前，通过受支持的 `glGetShaderiv(GL_SHADER_TYPE)` 读取一次，与已有失败后的同对象查询比较，并保存相同 shader/context 的公开关联信息。它尚未实现或批准，且新增同步查询会改变 batch 提交边界，必须单独声明这种干扰；若故障消失，不能称修复或证明创建类型正确。无需同时改帧提交、库、shader 文本或画质。

在实施前需继续核对该读取的返回合同及有界关联；拿不到平台实际对象身份时明确停在边界。供应方仍需回答：同步返回对应何命令/对象，资源 ID 命名空间及删除复用合同，context descriptor/generation 的受支持查询，以及创建、编译与查询对象一致性如何核验。已有问题材料仅保留本地，不自行对外发送。

## 证据保存

[脱敏机器可读记录](evidence/GLX_SHADER_TYPE_RETURN_PHONE_20261024.json)保留包、设备版本、两份原始日志哈希和必要字段。私有原件位于原仓库忽略目录 `.local/glx-shader-type-return-20261024-01/phone-validation-20261024-02/vconsole-audit-01/`：两份原始日志副本、完整 manual、完整 shader failure、审计脚本和结果。复制后逐 SHA256 核验，未改原始文件。

本轮只保存诊断结果与问题状态，不修改运行代码。默认 WebGL、正常参考包、历史失败包及旧证据保留；不新增云报告、手机测试或预览。最终稳定性、前后台、3D、音频、裁剪和分包仍未验收。
