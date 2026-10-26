# 冻结现场直接读取计数：通道核查，2026-10-25

原读取目标为包 `native-glx-validation-9b31f77db008bc37fda1`、菜单重进会话 `triangle-mvn8j8av-n7kc6k0g`；用户后续更正可能已重新打开，当前身份未知。初始准备阶段仅检查电脑侧源码/工具能力、表达式和fake；后续四次分别明确授权的元数据探路结果见末尾。全程没有附加调试器、执行手机JS、换包/重开、清缓存或接Godot。原包及两份日志保留。

## 结论

**包内接口已确认能纯读取，当前真机执行通道尚未确认。** 因此不需要为计数接口重新打包，但还不能宣称已具备无重启读取当前worker的通道。

已有包的game.js把probe发布到 `GameGlobal.__nativeTriangleBoundary`，把包/会话发布到 `GameGlobal.__nativeTriangleEvidence`。`snapshot()`只返回自有closure状态及counts副本，不调用runtimeReader、不输出日志、不增加计数，也不调用RAF/flush/batch/swap。

可取字段：packageId、sessionTag、各边界进入总次数、sequence/eventLimit/exhausted、outputFailures/throwEvents及installed。这是**完整的现有probe计数**，不含每次返回总数、实时ABORT/loop generation、C++内部状态、平台队列或GPU/像素状态。读取时的值不是导出日志时刻的历史快照。

## 不直接使用的通道

| 通道 | 已核实 | 当前边界 |
| --- | --- | --- |
| 开发者工具automation_evaluate | 本机源码按project GUI走Tool.invokeGameMethod→APPSERVICE/game-driver；参数没有当前手机session选择器 | 未认证是当前iPhone的directGameWorker，不能把模拟器/其它runtime结果当现场 |
| 开启remote调试 | 本机代码修改remoteDebug预览/自动调试状态，涉及QR与新remote连接 | 未证实可无扰动附加当前会话；本轮不调用，不能承诺不会重开/换执行环境 |
| 当前手机vConsole | [Tencent开源vConsole](https://github.com/Tencent/vConsole)提供手动JS命令功能 | 手机微信内置面板的版本、命令入口及是否进入game worker均未确认；过滤框不是JS执行入口，不让用户盲目粘贴 |
| iOS WebInspector | 本机既有pymobiledevice3 11.40.0支持枚举已有JSContext/页面目标 | 当前WeChat directGameWorker是否暴露未知；Safari/WebView存在不等于可读当前游戏全局 |

微信官方调试页面本轮未取得可读正文，已保留访问失败边界，不从其它引擎/旧文章外推当前iPhone可用性。原手机2026-10-20的空WebInspector列表仅为历史，不作为当前结论。

本机实际库CLI/service源码与官方v11.40.0逐字匹配：[CLI](https://github.com/doronz88/pymobiledevice3/blob/v11.40.0/pymobiledevice3/cli/webinspector.py)、[service](https://github.com/doronz88/pymobiledevice3/blob/v11.40.0/pymobiledevice3/services/webinspector.py)。metadata路径没有launch/open_app/socket_setup/eval，但会连接设备服务、验证既有配对并做握手，不能称零接触或保证无时序扰动。js-shell即使没有输入也可能附加/启用runtime，不拿它做纯枚举。

## 已准备的一次性读取表达式

先通过own data descriptors核对Evidence的精确包号和上述会话；取自有snapshot函数，一次Reflect.apply；再核对返回身份并复制counts。任何realm、字段或身份不符、函数不可用/抛错立即STOP，既不重开也不试别的上下文。不会调用invoke/notice，不输出到console，不触任何渲染或调度。

表达式及fake验证在原工具仓库 `.local/glx-live-snapshot-access-20261025-01/read-current-snapshot.js`。SHA256 `dbf2dae5a36dbc9fcf13465bdbaacbb3572d88951be4f6d6617667557a9bd19f`，4/4自有fake验证通过。尚未在手机执行。目标暴露和附加通道必须先证实，不能仅因表达式正确就说现场可读。

## 最小下一步：需先明确批准一次元数据探路

提议仅使用现有配对的当前iPhone，通过USB进行**一次受限WebInspector目标枚举**。如已连接不动；未连接时用户仅接USB并保持解锁、当前小游戏前台，不切换设置或重新打开游戏。

- 使用既有11.40.0环境，加 `-B`避免写入其字节码；不安装/更新工具、不改赛车或该环境。明确已有私有UDID选择，USB且autopair=False；未配对或目标不符就停，不能自动配对其它设备。
- 只发送reportIdentifier/getConnectedApplications/forwardGetListing三类Inspector元数据请求；没有附加调试器、runtime-enable/eval、打开页面、启动微信、自动检查/暂停新目标、截图/PID或服务器/隧道配置动作。
- 仅保留微信bundle的目标元数据，原始结果留本机忽略目录；不公开其他应用网页标题/URL或设备标识。目标列表不包含网页内容、聊天内容或snapshot数据。
- 连接/查询/清理均有局部截止；自有helper进程外层20秒硬截止，必要时只结束该helper，不结束微信或其它进程。不外部循环重试。库内部握手可能在窗口内重试，故不称“只发一个网络包”。
- 服务不可用、列表空、无明确微信目标或出现新信任/权限要求即停。不去改手机WebInspector/开发者设置、不启remote、不新预览或重启来补结果。枚举为空不能证明worker已消失。

该步骤会连接手机调试服务，可能改变调试服务状态/时序；未经用户确认不执行。它只回答“有没有可能的现存目标”，**不附加、不执行snapshot**。若找到可辨认目标，再报独立的一次受保护读取方案；若未找到，明确当前无已验证通道，不用别的WebView结果替代。

## 本地检查与保留

读取表达式fake4/4，metadata lifecycle fake5/5、仅保留微信元数据及自有子进程成功/失败/硬超时fake4/4；这些测试没有导入真实设备包或读取私有UDID/配对context。脚本仍带显式授权门禁，不是已执行的手机取证。

本机 `.local/glx-live-snapshot-access-20261025-01/` 保存工具源码路径/哈希、原始与host/remote实现核查、表达式、metadata提案、owned-helper启动器、fake结果及保护前后哈希。`LOCAL_LIBRARY_SOURCE_VERIFICATION.json`确认既有环境版本及官方源码一致；`WECHATIDE_TARGET_READONLY_REVIEW.md`记录本机真实handler路径，未靠工具名称推断目标。

当前结果是“接口可读、真机通道未证实、需先批准受限目标枚举”。没有live snapshot数据，也不将本地fake通过写成手机可读或GLX修复。

## 后续批准的一次尝试：USB指定设备未找到

用户随后明确批准一次只读目标枚举，复用现有配对；无目标/权限要求即停，不附加、eval、改设置或重新预览。执行前从本地已有匿名设备指纹匹配配对记录文件名，将精确选择符仅存本机私有文件，没有打印标识或读取配对密钥内容。

复核发现原库connect包含拒绝后的握手重试，故在独立helper中覆盖为一次握手，接收EOF也立即失败；未改安装库或任何项目代码。自有handshake成功/连接拒绝/identifier拒绝/recv拒绝fake4/4通过，原错误原样传播。独立静态复核确认动态分派命中该覆盖，不再进入原重试循环。

仅运行一次受限helper，外层20秒硬截止、禁止新配对和其它selector。结果在provider阶段返回 `DeviceNotFoundError`，helper正常退出、无外部重试。**未找到指定手机的USB连接，尚未建立WebInspector服务，也未取得目标列表。** 这不是成功枚举后“微信目标为0”，不能推断当前worker是否暴露、是否存在或能否直接读取。

本轮未附加/执行JS、启动或重开微信/小游戏、切换设置、清缓存、创建新预览、切Wi-Fi传输或取得live snapshot。按用户停止条件已停；要继续必须先确认现有手机USB可被识别，再另行明确授权尝试，不能自动更换传输方式或反复枚举。

结果保存在本机 `.local/glx-live-snapshot-access-20261025-01/device-enumeration-01/targets.private.json` 和helper回执；`ENUMERATION_APPROVAL.json`、`ENUMERATION_DISPATCH.json`及`ENUMERATION_RESULT.json`记录授权、唯一尝试与停止边界。私有设备选择符和元数据不进Git。第一次尝试的结论为“该次USB入口不可用，目标可见性仍未知”，没有快照数据。

## 第二次单独获批：USB已连，目标列表为空

用户确认已接USB、解锁并保留冻结画面，明确再授权一次只读目标枚举。复用原精确配对选择符及同一单次握手helper，新的授权/dispatch/输出分别使用02文件和目录，没有覆盖或自动重试第一次。

本次USB provider创建、原配对与身份匹配通过，WebInspector初始连接/握手完成，进入target-metadata阶段。get_open_application_pages的本次2秒等待窗口返回0个目标，含微信目标数0。helper正常退出，stderr为空，没有采集到后台接收/selector白名单/清理异常，cleanup=closed。

这与第一次未找到USB设备不同；本次确实到达目标元数据读取，但未得到可识别的WeChat JSContext或页面。它不证明当前game worker不存在、已停止、永久不能暴露，或任何一个具体手机设置有误；也没有采集最终is_connected状态。**没有目标可据以申请附加，因此按要求停止，未附加/执行snapshot。** 不改设置、不切其它传输、不重开或新预览来补结果。

本次仅运行这次授权内的一次helper；结果位于 `.local/glx-live-snapshot-access-20261025-01/device-enumeration-02/`，授权/dispatch/result对应 `ENUMERATION_*_02.json`，独立复核为 `ENUMERATION_02_REVIEW.md`。最新CURRENT_STATE记录EMPTY_METADATA停止；原包和日志保护哈希相同。

## 第三次单独获批：仍为空，当前会话不能关联旧现场

用户随后补充“刚刚没打开小游戏”，申请再试；先答仍在原冻结画面，之后明确更正“我也不清楚，应该是重新打开的”。因此第02次的空结果不能当作小游戏已在前台时的worker可见性结论，第03次也必须按“可能重新打开、当前JS会话未知”处理，不能认证为原 `triangle-mvn8j8av-n7kc6k0g`。

依新授权仅再运行一次相同受限元数据helper，保存到 `device-enumeration-03/`，不覆盖前两次。USB provider与配对身份核验及Inspector初始连接完成；同一等待窗口仍返回0目标。helper正常退出、stderr为空、无errorType，cleanup=closed。独立复核一致，没有目标可据以关联任何游戏会话。

已停止，没有附加、执行JS或读取snapshot，没有代理启动/重开应用、改设置、换包或清缓存。不能用未知/新会话的计数补作旧冻结现场；旧身份保护表达式保持原样，未猜测或替换当前session。旧对象是否仍可访问、当前worker是否被暴露均无证据，不由空列表推断。

第03次授权/dispatch/result和保护哈希另存相应03文件。原包与已导出日志仍保持原字节；当前现场是否属于旧会话不再作保留承诺。后续不自动重复枚举或切其它调试模式。

## 分层记录补齐，仅电脑侧

旧02/03次“空”仅指最终展平列表；没有记录各层回复与 receiver 的完整状态，不能回填为“确实回复无目标”，也不能由此判断微信是否开放调试。原始空列表文件保持原字节。

用户随后授权电脑侧补齐记录。新建独立 `examples/glx-native-inspector/`，记录应用列表、微信发现、各 listing 的请求/回复与空/未回/中断，并保留握手首包、旧代摘要、接收健康和超时阶段。最新41项 fake通过；没有导入真实设备包、再次连接手机、附加/eval或读取snapshot。具体差异与下一次需单独批准的单次枚举方案见 [分层记录](GLX_INSPECTOR_RESPONSE_RECORDS_20261025.md)。当前session仍未知，本轮没有增加手机结果。

## 第四次单独获批：微信被发现，最后listing明确为空

用户另行明确批准按新版方案一次受限只读枚举。原USB配对和身份门禁通过，Inspector连接完成；显式应用列表请求一次、发送完成，收到两份完整列表，最后7个条目且1个微信。微信listing请求/回复均2次，最后数量0；这不是回复超时。旧02/03次缺失字段不据此回填。

接收任务在冻结前运行、connectionLost=false；无发送错误、处理错误或白名单阻止，helper退出0且stderr空，Inspector/provider清理closed。已按要求停止，未附加/eval/读取snapshot、启动或重开应用、清缓存、换包或改设置，没有重试。当前游戏session仍未知，不能当原冻结现场。

本次只确认“已发现微信且其最后目标列表回复为空”，不预判微信永久未开放调试、worker不存在或设置错误。回复只留次数及最后数量，不补写第一次是否为空。详见[分层记录的第04次执行](GLX_INSPECTOR_RESPONSE_RECORDS_20261025.md)；本机新目录 `glx-inspector-response-audit-20261025-01/device-enumeration-04/` 保存私有结果，旧原始结果、包关键文件和日志哈希不变。没有可供后续读取的目标，下一次设备操作需另行确认。
