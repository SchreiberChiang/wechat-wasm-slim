# go-ios 官方发现观测版离线准备，2026-10-25

已按用户明确授权完成隔离工具链、锁定目标依赖、最小观测补丁、构建与离线测试。**离线准备阶段没有连接手机、读取真实设备选择符、附加调试器、执行手机JS/snapshot、启动/重开应用或改设置。** 后续两轮分别获批的USB枚举已完成，每轮仅执行一次：第一轮未识别微信；用户报告已打开小游戏后，第二轮识别微信且收到空listing。不是相同会话/现场，不由此证明原因或永久能力。真实结果及边界见文末。

候选：`go-ios-official-observer-ebc828e65af24d6994e4`。

全部工具、源码、缓存、临时文件和测试产物位于约定的本机忽略目录：

`E:\AI\wechat-wasm-slim\.local\go-ios-readonly-20261025-01\`

没有全局PATH/注册表/服务变更。后续新PowerShell仍不能从PATH解析go/ios；所有Go执行使用隔离绝对路径、GOENV=off、GOWORK=off、GOTOOLCHAIN=local，模块/编译/temp缓存也在该目录。没有改引擎、GLX静态库、渲染、赛车、Metal或服务器，不涉及默认WebGL、裁剪、分包和新手机包。

## 固定输入与复现边界

- 官方Go1.26.5 Windows amd64归档，SHA256 `97e6b2a833b6d89f9ff17d25419ac0a7e3b482a044e9ab18cdef834bd834fd38`，与[Go官方下载元数据](https://go.dev/dl/?mode=json&include=all)一致。只解压，未执行安装程序。
- 官方go-ios [v1.3.2](https://github.com/danielpaulus/go-ios/releases/tag/v1.3.2)，提交 `2fb34682ef12db97c9fafdf99f1dd1d3522604ad`。`upstream-original/`的423个文件逐一匹配固定Git blob；该副本未改。
- 目标构建/测试用到的13个模块归档均匹配原始go.sum的h1；官方go.mod/go.sum未改，observer派生模块也使用同一go.sum，不升级版本。没有准备完整stock CLI/tunnel所需的全部归档，本轮也不构建它们。
- 官方代理和部分vanity地址发生TLS/EOF，完整mod download没有通过；gvisor历史源归档查询也失败。目标只读库不依赖其tunnel包，故未为该无关路径换版本或改源码。
- 对受网络影响的10个golang.org/x依赖，从Go项目官方GitHub镜像取原标签/提交，再用已核验SDK自带的x/mod规范化模块归档；10个归档h1全部与原始锁文件相同，之后目标构建/测试关闭网络。没有关闭TLS校验、使用第三方代理或把镜像路径写成依赖替换。准备工具本身2项离线测试通过，完整来源与失败日志保留本机。

## 补丁到底改什么

仅在独立upstream工作副本中修改/新增：

1. `ios/webinspector/webinspector.go`：可选观测调用、默认保持官方函数的连接测试接缝、发送白名单/共同截止及工作跟踪。
2. `ios/webinspector/observation.go`：可选hook、复制输入、明确fake notification工厂、停止与清理记录。真实默认仍使用官方notification_proxy。最终复核补了一项取消检查：通知hook后若已取消，不再调用Observe。
3. `ios/webinspector/observation_test.go`：13项纯内存测试。

官方 `New → Connect → ListPages(ctx,500ms)`、两次原有get-apps、自动listing、应用/页面解析、`apps非空 || state非空`谓词、页面合并及EOF错误包装均保留。没有用自制协议状态机替换官方发现过程，也没有顺便修缓存或返回规则。受限入口绕过外层CLI的agent/tunnel选路，因此应称“带最小观测补丁的官方发现库本地构建”，不能称原版发布EXE的完整CLI验证。

自有observer目录只做USB入口、分存官方首次返回和审计统计、2/8秒调度及输出门禁；launcher仅做哈希/明确授权/新目录门禁与自有子进程20秒兜底，没有CDP、JS-shell、自动化、snapshot或新调试功能。

补丁文件为本机 `provenance/official-observation.patch`。在全新验证副本中反向应用后，423个原文件哈希全部恢复，两个新增文件移除；没有对原件做reset或删除。候选输入及补丁SHA存于candidate-manifest.json。

## 离线结果

| 范围 | 最新结果 |
| --- | --- |
| 官方发现库观测memory测试 | 13/13，通过日志 `UPSTREAM_OBSERVATION_TESTS_OFFLINE_03.txt` |
| 审计、驱动和入口 | 19/19，通过日志 `OBSERVER_ALL_TESTS_OFFLINE_03.txt` |
| Python启动器自有子进程测试 | 8/8，含一次真实20秒超时kill/reap |
| 合计目标测试 | **40项通过**，不包括额外2项模块打包工具测试 |
| 构建产物门禁 | help退出0；无批准参数退出2，不创建输出或读取设备选择符 |
| 原件/回退 | 423文件原件核验与反向补丁恢复通过 |

主要运行证据全部是自写内存数据，不是手机结果：

| 用例 | 官方首次返回 | 审计结果 |
| --- | --- | --- |
| 延迟回复跨过2秒 | 约526.6ms返回空页面 | 2秒仍pending，保持原连接；约3010.2ms收到有效目标后结束。原官方空结果没有被后续结果覆盖 |
| 明确空listing | 约526.1ms返回空页面 | 约2000.2ms完整判定微信listing明确为空 |
| 始终无应用列表回复 | 约526.0ms因state路径先返回空页面 | 2秒不算空，约8000.6ms按application-list-not-received截止 |
| 有微信但listing一直未回 | 原始返回单存 | 缩短窗口fixture按wechat-listing-incomplete截止，不写为空 |
| 连接异常 | 官方错误类别单存 | audit-fault并停止，不把上游Disabled标签当成设置原因 |
| 20秒owned child | 独立Python假进程 | 实测20.008724秒含调度/kill/reap；仅该owned进程被结束并回收，另一个假进程未被误杀 |

每个代表fixture分别保存 `official-first-return.private.json` 和 `audit.private.json`，位于本机 `logs/fake-fixtures-02/`；带OFFLINE_FAKE_ONLY标记。原始页对象保留；可能含配对数据的底层error值不直接复制，只保存结构类别/类型。审计结果只做顺序/时间关联，不声称协议存在逐请求ID。

其他边界使用缩短窗口fake，不能说每种故障都以真实8秒测试。普通Go测试没有启用race detector；通知代理的私有reader是否全部退出仍未独立证明，Wait调用返回与tracked workers joined分别记录，不由一个布尔值冒充全清理成功。Go context不能取消全部底层同步I/O，20秒是开始结束自有进程的兜底，包含正常调度/回收开销，不是硬实时承诺。

开发失败日志保留：网络EOF/源查询失败、一次nil内存fixture导致测试panic已修正、早期未完成测试及中间draft均未抹除。官方readLoop在memory pipe清理时输出的closed-pipe日志属于假连接关闭，不是手机或GLX报错。一次PowerShell汇总误把JSON null计为1页，原始fixture未改；保留错误汇总后用Python修正为0，最新索引见provenance/OFFLINE_TEST_SUMMARY.json。

## 准备好的实际命令，未执行

候选EXE：`bin/go-ios-observer-reviewed.exe`。

SHA256：`4795453d8a307c2c1ba8fe73f368049deb3481658c4ad1130f68c7cab5c55b34`。

manifest SHA256：`af61af99dd24a076cebe8d5f2d00673bec24ed86adf1ef1683f6fe21babe82f0`。

准确的绝对路径命令、上述双哈希、原私有选择符文件路径和新输出目录已经写入：

`E:\AI\wechat-wasm-slim\.local\go-ios-readonly-20261025-01\ENUMERATION_COMMAND_NOT_RUN.ps1`

**本轮没有执行该文件，亦未向任何进程传入实际枚举批准标志。** 命令需要独立手机授权，启动器先校验manifest/EXE及新目录；它不读选择符内容，只有获准helper才读。输出父目录拟为 `phone-enumeration-01/`，尚未创建；官方返回和审计在其helper子目录分存。

未来执行前仍要确认没有其它Inspector客户端在用，不运行pymobiledevice3、不抢占或杀其它客户端，无法确认就停。允许一次时，2秒只中间观察，关键回复未到则同连接等至8秒绝对预算；异常立即停止；8秒后只清理，20秒不延长观测。即使找到目标，也只报告，不附加/eval/snapshot。当前game session仍UNKNOWN。

如之后获准仍为空，只能并列记录它与pymobiledevice3第04次的对应结果，再核对宿主开放条件；不会承诺更高权限、反复换工具或把未知会话当原冻结现场。GLX卡红根因及真机读取通道仍未解决。

## 单次设备授权后的前置阻断：未启动候选

用户随后明确批准该候选一次USB受限枚举，先确认没有其它Inspector。前置只读检查时，候选EXE、manifest和全部冻结源哈希一致，但主机快照发现3个真实 `ios_webkit_debug_proxy.exe`，PID分别66552、69668、19884；不是shell命令文本误匹配或普通Apple设备服务。

同期7条已建立的usbmux客户端连接中，6条可按捕获PID关联到这3个代理，另1条PID68028未确认归属。这足以不满足“先确认没有其它Inspector客户端”的条件。随后只读已保存的ExecutablePath确认三者来自微信开发者工具安装目录的 `resources/app.asar.unpacked/node_modules/ios_webkit_debug_proxy/`；这只确认可执行文件来源，不能确认对应哪个项目窗口/会话或是否已附加当前游戏，也不能据此倒推之前空listing的根因。

已停止，**候选helper执行次数为0**，`phone-enumeration-01/`未创建，官方首次返回和候选audit文件均不存在。本轮没有新手机连接、停止任何进程、执行JS/snapshot、重开应用或重试。只读核对父进程/额外PID未取得可用归属信息，不擅自关闭代理。

原始主机快照位于本机 `provenance/PHONE_PREFLIGHT_01.private.json`。初始PowerShell嵌套变量导致TCP owner字段未关联，原记录保留；随后仅按已捕获PID修正6条归属，更正依据另存 `PHONE_PREFLIGHT_CLASSIFICATION_01.private.json`，不改变“存在真实代理与连接”的阻断。脱敏状态 `PHONE_ENUMERATION_STATUS_01.json`记为NOT_DISPATCHED_PREFLIGHT_CONFLICT，独立只读复核一致；此前保留材料哈希不变。

下一步先确认这些代理是否仍由其它工作使用，以及允许何种关闭方式。未经明确确认不结束它们，也不因候选已获授权就绕过并发门禁。当前游戏会话仍UNKNOWN，没有新增go-ios真机枚举结论。

## 后续获批的三代理清理及首轮USB枚举

上述前置阻断属于历史记录。用户随后批准只读归属核查，再单独批准停止三实例。核对PID、CIM启动时间、持有句柄的100ns启动时间、路径、命令行及EXE哈希全部吻合后，66552、69668、19884仅经已持进程句柄停止并确认退出；未结束进程树。开发者工具主进程和Apple服务保持原实例运行。7条usbmux客户端连接降至1条：TCP表仍标PID68028，但进程未找到，用途未知。既有记录不能证明它是Inspector或会干扰枚举，不能由此解释过去空列表。

用户接受残余未知连接，并明确批准本候选一次枚举。执行前EXE、manifest及13项来源文件哈希一致，未发现已知Inspector客户端；既有配对复用，未处理未知连接或服务。只启动一次helper，无重试。

| 层级 | 本次真实记录 |
| --- | --- |
| 官方首次返回 | `New → Connect → ListPages(500ms)`约768ms正常返回，`pages=null`即0页，error为空；原件单存。 |
| 应用列表 | 两次原有发送均完成；3次read-result列表消息观察的条目数为1、1、5，均有效并处理。不是read/handle双记；无逐请求ID，不能作三个独立请求的对应回复。 |
| 微信识别 | 最后有效完整列表按bundle规则未匹配微信，`lastHandledFullListWechatCount=0`。没有可报告的微信listing结果，不能写成微信目标列表返回空。 |
| 观察结束 | 第2秒complete=true、pending空、fault=false；约2003ms停止观察。关键回复已齐，无需等满8秒；未触及8秒上限。 |
| 进程收尾 | helper约3.688秒退出0并回收，未触发20秒兜底kill。Close已返回，Wait及tracked workers逐一退出未确认，不宣称内部清理全部通过。 |

官方首次返回和审计分别位于本机`phone-enumeration-01/helper/official-first-return.private.json`与`audit.private.json`，不提交。脱敏索引为`provenance/PHONE_ENUMERATION_RESULT_04.json`和同名Markdown；15项既有受保护材料哈希一致。候选manifest中的NOT_RUN字段保留为构建时身份原件，不修改冻结manifest来追写手机状态。

此前pymobiledevice3第04次发现微信并收到最后listing为0；本次go-ios未在收到的应用列表中识别微信，两次停在不同层，不能写成同条件下两工具均证实微信目标为空。本次游戏会话仍UNKNOWN，不能据此证明手机没有微信、目标不存在、平台永久不开放或未知连接造成干扰。

本次未附加、执行JS/snapshot、启动/重开应用、换包、清缓存、改设置/服务或新增云采集；已停止，不追加连接或重试。当前仍未取得可读现场计数快照，GLX冻结根因未解决。

## 用户打开小游戏后的第二轮单独授权枚举

用户随后表示先前可能没有打开小游戏，并报告现在已打开；再次单独批准同候选一次受限枚举。根侧没有自动重试第一轮。候选EXE、manifest和13项来源哈希通过，执行前未发现已知Inspector客户端；原未知连接继续保留且不处理。新输出为`phone-enumeration-02/`，第一轮原件未覆盖。

本轮最后有效完整列表识别到1个微信应用；微信listing记录3次有效并处理的read-result观察，数量均为0，最后回复晚于最新请求。它们属于一次官方发现流程，不是三轮人工测试；无逐请求ID，不补造逐请求对应。官方首次返回约662ms，0页且无错误。第2秒已complete且无pending/fault，约2003ms停止观察；未触及8秒上限。helper约3.666秒退出0并回收，没有20秒兜底终止。Close返回，Wait及worker逐一退出未确认，内部清理仍不标全通过。

| 已有轮次 | 可确认的发现层 |
| --- | --- |
| pymobiledevice3第04次 | 应用列表发现微信，最后微信listing为0。 |
| go-ios第一轮 | 应用列表有回复，但最后列表未识别微信；微信listing结论未建立。 |
| go-ios第二轮，用户报告小游戏已打开 | 应用列表发现微信，微信listing明确收到且为0；不是超时或未回复。 |

打开小游戏后的结果变化与前台状态影响相容，但未独立核实两次手机画面及同会话条件，不能直接认定上轮原因。两工具都曾发现微信且收到空listing，可并列记录；不能扩大为同一冻结现场对照、永久不支持调试、手机没有目标或未知连接造成干扰。当前游戏会话身份仍UNKNOWN，仍未取得现场计数快照。

本轮原始官方返回与审计分别保存；脱敏索引`provenance/PHONE_ENUMERATION_RESULT_05.json`及同名Markdown。15项受保护材料和首轮两份原始结果哈希一致。没有附加/eval/snapshot、应用重开/换包、清缓存、设置/服务变更或云采集；本轮只执行一次，现已停止，不追加枚举。
