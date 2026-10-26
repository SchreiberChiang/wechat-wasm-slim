# iPhone Inspector 元数据响应记录器（电脑侧准备）

本工具只查“目标发现停在哪一步”。不承诺目标会出现，不证明微信已开放或禁止游戏调试，也不读取游戏计数。当前手机 JS 会话始终标为未知，不能关联旧冻结会话。

旧 helper、三次原始结果和原读取表达式保留在原工具仓库 `.local/glx-live-snapshot-access-20261025-01/`；这里是独立新版源码，没有覆盖旧文件或安装库。

## 输出含义

| 字段 | 可以回答 | 不能推断 |
| --- | --- | --- |
| `applicationList.request` | 请求尝试/发送完成/发送错误、序号和相对时间 | 发送返回不等于对方回复 |
| `applicationList.reply` | 回复 selector 次数、有效列表次数、最后数量、握手/查询前回复、原 handler 是否完成 | 异步 connected/updated 通知不能代替完整列表回复；损坏回复单列处理失败 |
| `wechatObserved` / `wechatCurrentlyListed` | 本连接见过/当前记录中仍存在微信应用 | 没观察到不等于微信没有运行或不支持调试 |
| `wechatCountInLatestFullList` | 最近一次完整列表中微信应用的数量；没收到时为 null | 不是手机上的微信进程总数 |
| `wechatApplications[].listing` | 各应用分别记录请求、空/非空回复、未回或中断 | 多个微信条目不能合并成“全部已回复” |
| `historicalReplyCount` / `lastHistoricalReply` | 未关联或旧代回复的最后数量/时间/序号 | 不复用为新一代应用的有效页面 |
| `receiverBeforeCleanup` | 清理前任务是否运行/结束/取消、异常类型、连接丢失标记 | 不能用清理主动取消后的状态解释运行中故障 |
| `reportedAutomationAvailability` | 协议上报的自动化状态 | 不是手机 Web Inspector 开关或 JSContext 可检查性的证明 |
| `targets` | 已收到当前代回复的微信目标元数据，限本机私有输出 | 不是已确认的小游戏 realm/session；不附加或运行 JS |

无回复时 `lastCount=null`，收到明确空字典时 `lastCount=0`。`replyDeadlineExpired` 只表示已完成发送后、观察窗内没有看到更新的同类回复；发送未完成另报 `sendIncompleteAtDeadline`。若请求根本未开始，也单独报告，不称回复超时。

`selectorObserved` 记录收到该类消息；`received` 记录具有可计数列表体的回复。消息体损坏时仍保留 selector 观察与处理错误，不写成“未收到回复”。

协议这些消息没有逐请求关联编号。`replyObservedAfterLatestRequest` 只建立顺序/时间关联，不证明精确配对；握手首包也从接收前开始记录，不能伪装为后续显式请求的回复。相同应用 ID 重新出现时隔离旧代数据；仍无法识别平台底层对象是否复用或某个迟到回复的真实原请求。

元数据窗使用单调时钟截止。超过截止的入站消息不计入本轮记录，也不因迟到的应用列表再追加 listing 请求。截止时同步复制记录、目标和接收健康状态，然后才取消本轮等待和清理。

## 实现与固定依赖

- `enumeration.py`：纯标准库、依赖注入的记录器、调用边界与生命周期；导入不接触设备。
- `device_enumerator.py`：显式授权门禁、单个私有设备选择符、固定库版本和源码 SHA 核验后才导入设备包。输出独占新建后才连接。
- `launch_once.py`：不使用 shell，仅启动一次自有 helper；20 秒硬截止只终止并等待自己的子进程，不搜索或终止微信/其它进程。
- `test_enumeration.py`：自建协议 fake 和自有短命 Python 子进程。没有导入真实设备包、读取已有配对或设备选择符。

按本机已审核的 pymobiledevice3 **11.40.0** 固定，不安装/升级或修改其源码：

| 源码 | SHA256 |
| --- | --- |
| `cli/webinspector.py` | `1c18914c536369a35ed5392ff716e2a740e94be74f164b047e1085fb0c7031df` |
| `services/webinspector.py` | `f25dcacf7e0ce423ae6e779aff8ee52da3ead23fef23fe4c5e70f5da784a692d` |

来源：[固定 service](https://github.com/doronz88/pymobiledevice3/blob/v11.40.0/pymobiledevice3/services/webinspector.py)、[固定 CLI](https://github.com/doronz88/pymobiledevice3/blob/v11.40.0/pymobiledevice3/cli/webinspector.py)。复用原协议发送/处理路径，仅覆盖重试、子任务收回、只读 selector 白名单和记录；不改手机 app 或安装库。

允许发送仅 `reportIdentifier`、`getConnectedApplications`、`forwardGetListing` 三类。后者沿用库收到完整应用列表后的元数据查询；不会保存其他应用的标题、URL、名称或 ID。若库收到 automatic-inspection 候选后尝试隐式 reject 等控制消息，白名单会阻止并报告失败，不能偷偷放行。

## 本地检查

```powershell
python -X utf8 -B -m unittest discover -s examples/glx-native-inspector -p 'test_*.py' -v
```

最新 **41 项通过**。覆盖应用列表空/未回、非微信应用、微信 listing 空/未回/有目标、多微信条目部分回复、握手先回、异步通知、重复 listing 全量替换、旧代/未关联回复、接收异常/正常丢连接/提前结束、发送未完成、局部/总截止、晚到回复、握手子任务取消、清理异常/超时、拒绝自动控制 selector、授权/输出保护、隐私过滤及自有进程硬截止。

这些是工具合同，不是手机测试。没有运行 GLX/WASM、微信开发者工具或真实设备包。没有扩大真实默认 2 秒观察窗来补本地测试。

## 下一次单独授权后才可执行的方案

1. 只使用原配对、原 iPhone、USB 和已核验解释器。用户保持已有页面/解锁即可，不要求启动或重新打开应用；如果已经离开现场则记未知，不补开。
2. 运行一次新版 helper；禁止新配对、连接重试、自动换设备/传输或安装依赖。连接/原身份不符、权限/信任要求、服务错误立即停止。
3. provider 最多 3 秒、Inspector 连接最多 3 秒、元数据窗最多 2 秒（包含发送），操作总截止 8 秒；尝试分别清理 Inspector/provider，每项 1 秒；外层自有 helper 硬截止 20 秒，不重试。
4. 若取消不协作，局部 `wait_for` 也可能不能及时结束，不能保证继续清理到 provider；最终靠外层自有进程硬截止。该情况下结果文件可能为空/不完整，仅能报告 helper 超时，不能报告无目标。
5. 只在新的本机忽略目录写私有结果和 helper 回执。找到目标也立即停止，先报告其类别与发现层状态；不附加、不执行 JS、不读取 snapshot。

这会连接手机的 Inspector 服务，可能影响该服务状态/时序；“只读元数据”不等于零接触。当前只完成电脑侧准备，尚无新一次手机授权或执行。此方案不换包、不清缓存、不改设置、不启动应用，不接 Godot、不改引擎/库/渲染/服务器。
