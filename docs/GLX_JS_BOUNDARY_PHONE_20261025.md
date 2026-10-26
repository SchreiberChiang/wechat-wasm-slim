# JS 边界候选真机结果：首开正常、菜单重进不变色

本轮只读取用户提供的两份完整vConsole，归档、校验及分析，没有再次操作手机、重新预览/换包、清缓存、修改运行代码或接Godot。用户反馈原文：“就第一次正常第二次不变色”。第二份按本轮已批准的三点菜单“重新进入”步骤关联；本条反馈没有另行说明冻结时具体颜色或三角形状态，不沿用父包画面描述补造本轮细节。

## 身份和原件

两份均对应 `native-glx-validation-9b31f77db008bc37fda1`，host内所有identity字段与candidate-02封存一致：同一WASM `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79`，GLX库 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`，观察JS `380cd9e605c753101f2273b919ad65ccfdc595fbd42e6d4ef858fe22f33f6534`。设备为iPhone16Pro/iOS18.3.1/微信8.0.75。

| 项目 | 首开 | 三点菜单重新进入 |
| --- | --- | --- |
| 日志文件 | vconsole_1792896480338.log | vconsole_1792896918675.log |
| bytes | 53,610 | 31,185 |
| SHA256 | b7bd5b7bf989e7d1d834041d871f2a865eaa3d0d5ec888cb0eb52d1650a09c20 | 9a58426845c67293dbcc79620304066f14226a62d365940b3d2792a19cfefb2d |
| session | triangle-mvn89u2y-ip4xx7j9 | triangle-mvn8j8av-n7kc6k0g |
| scene | 1011 | 1089 |
| header/entry实际基础库 | 3.17.5 / 3.17.5 | 3.17.5 / 3.17.5 |
| actualMode / metadata / canvas | glx / true / true | glx / true / true |
| shader请求→返回 | 35633→35633、35632→35632 | 35633→35633、35632→35632 |
| boundary记录 | seq1–63连续 | seq1–45连续 |
| COLOR记录 | 51条，frame1至3001 | 1条，frame1，计算RGBA为红色 |
| 人工画面 | 首次正常 | 第二次不变色：失败 |

首开日志有持续变化的计算参数，结合用户正常反馈可记录本轮首开通过；不能把51条颜色日志当作17轮人工画面验收。重进仍失败，不能凭初始化/调用返回将其改写成成功。

## 重进已经观测到的执行顺序

以下行号取第二份原始日志，序号取boundary事件：

| 行 / seq | 已到达边界 |
| --- | --- |
| 49 / 35 | native-callback第2次原函数返回 |
| 50 / 36 | run-iter第2次返回 |
| 51 / 37 | raf-delivery第2次原delegate返回，快照raf-request计数已为3 |
| 52 / 38 | after-frame第2次进入 |
| 53 / 39 | native-flush第2次进入 |
| 54–55 / 40–41 | batch第2次进入/返回 |
| 56–57 / 42–43 | swap第2次进入/返回 |
| 58 / 44 | native-flush第2次返回 |
| 59 / 45 | after-frame第2次返回 |

第一轮也取得对应原函数的进入/返回。因此前两次应用回调与已观测的同步提交调用都走完，没有“第一帧回调未返回”或“前两次同步batch/swap一直没返回”的证据。

runner在runIter返回后调用scheduler，scheduler同步调用RAF helper；原delegate返回记录seq37已经在这条路径之后，且request计数为3。由封存代码和顺序可推断**第3次RAF helper调用已经正常返回**，但这不是独立采到的request3-return事件，也不证明平台实际接受或交付了该请求。

这两次after-frame记录在原RAF delegate的return记录之后进入。return事件在原函数返回后、观察包装自身返回之前发送，所以不能扩大成“微信最外层回调栈已经完全退出”。本次取得了具体调用顺序，但仍不公开认证平台内部统一时序。

已采样运行状态均为abort=false、runtimeExited=false、generation=0、running=true、timingMode=1/timingValue=1；这是各观察点的状态，不代表最后一行之后永久保持。generation是Emscripten MainLoop世代，不是原生GLX context代际。

## 仍有的采样盲区

当前探针只详细记录第1、2、61次。第3–60次不会逐次输出。因此：

- **不能说重进最终只运行2帧，也不能说第3次RAF必然没有交付。** 最后快照的2/request3只是那一刻的值。
- 首开就是直接反例：最后boundary快照native计数为61/request62，但之后COLOR一直到frame3001。没有更晚的boundary事件不等于后续停止。
- 当前只能确认重进没有取得COLOR61；中断可能在第3次交付前，也可能是后续未采样回调或提交中断，或整段后续输出未采集。不能仅凭缺61选定原因。
- 第1、第2次API返回不证明GPU完成或屏幕呈现；也不能由此排除后续提交故障。当前优先调查的是**后续调度请求/交付的继续推进**，没有依据改shader、库或强制swap。

## 错误覆盖和状态残留

两份onError/onUnhandledRejection均报告存在且注册成功，未见注册异常。保留的boundary事件序列连续，outputFailures和throwEvents在所有快照中为0，无host-failure、structured-output-failure、预算耗尽或原始错误。首开63/96、重进45/96，COLOR51/180、1/180，均未达到预算。

这排除了已导出事件内部缺号和已报告的预算/发送失败；不能证明最后事件之后没有整段丢报、平台未向JS暴露错误，或其它未采样异常。CLI对重进返回停止，原因为没有COLOR61，仍保留完整分层事实而非诊断RAF停止。

两次启动读取的四个own marker都不存在，没有记录到前一session的回调标记。它只约束所读取的own属性和已采样事件，不能证明global/require缓存/平台状态全部清空。尤其首开后旧回调计数已经超过61，此后旧闭包再次被调用也可能因稀疏采样不产生日志；**没有旧tag不能用来排除旧注册仍在**。相同contextHandle1/contextId2也不证明底层对象相同。

## 下一项最小证据，不在本轮执行

当前最缺的是冻结之后的**一次独立计数快照**：现有snapshot接口可返回所有边界的当时总计数、预算和输出失败，但当前包没有自动输出该快照的额外触发器。下一步先确认是否有受支持、不会重新启动当前真机会话的读取通道；不能用模拟器evaluate结果代替手机，也不能未经确认开启真机调试或注入表达式。

后续[读取通道核查](GLX_FROZEN_SNAPSHOT_ACCESS_20261025.md)已在电脑完成：纯读接口与身份保护表达式确认，现真机执行通道尚未证实。准备了只枚举微信既有Inspector目标的受限提案，尚未获批或执行设备连接/枚举，不需要为此先换包。

若必须改包，另报一个有限方案：直接记录第3次请求/交付，并补一条观察结束时的有界计数快照，以区分“请求3已返回但后续无交付”“回调已推进但后续执行/提交中断”“计算继续而屏幕固定”。不能简单将快照2/3改写成最终状态，也不先加恢复、延时驱动、换RAF源、flush/swap或清缓存。新增快照触发方式会带来事件/时序扰动，必须在具体方案中说明并另行确认；本轮不追加版本或手机操作。

## 保留入口

原工具仓库本机忽略目录 `.local/glx-native-boundary-20261025-01/`：

- `first-log-01/`、`menu-reentry-log-01/`：原字节日志、SOURCE、reader分析及原输出。
- `PHONE_BOUNDARY_ORDER_PROOF.json`：第二轮行号/序号顺序约束及稀疏采样反例。
- `PHONE_RAF_REVIEW.json`、`PHONE_SUBMIT_REVIEW.md`、`PHONE_STATE_LOG_REVIEW.md`：三项独立只读复核。
- `PHONE_ROUND_RESULT.json`、`CURRENT_STATE.json`：首开正常/重进失败的最新边界。

当前candidate-02、父包、库及早期原始证据保持原字节，仍只有一次已批准预览。源码和问题表记录本轮结果，未改运行实现、未合并或部署。暂不进入Godot，稳定GLX目标未完成。
