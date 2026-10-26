# go-ios 第二通道电脑侧核查，2026-10-25

最初核查结论：在已检查位置没有发现可用go-ios或Go SDK。官方v1.3.2有Windows和只读list路径，但原生输出缺少本次所需分层证据。初稿纯USB/plist自有采集器提案已撤回。用户随后明确批准修订方案的隔离准备、最小官方观测补丁和离线测试，现已完成，见[离线准备结果](GLX_GO_IOS_OFFLINE_PREP_20261025.md)。下文保留初始核查与授权前方案过程；**手机连接仍未授权或执行**。

本轮只读取电脑文件、服务状态及上游文本源码/发布元数据，没有下载可执行包/SDK、安装、执行第三方代码或连接手机。没有改环境、设备设置、引擎/库/渲染、服务器、Godot 或手机包。pymobiledevice3 第04次原始响应 SHA 与保存值相同；仍是“发现微信且最后 listing 明确为空”，不回填或扩大旧结果。当前游戏会话身份未知。

## 本机库存及版本边界

- PATH 中 `Get-Command ios,go-ios,go` 均无结果。
- 使用包含隐藏/忽略文件的文件名搜索，检查当前工具仓库 `.local`、既有 `.tools`、Codex、下载、Go bin、Scoop、Chocolatey、npm 全局目录、Node全局目录及常见 Go 安装位置；存在的目录没有对应 EXE。Go SDK/Go-iOS 卸载项也未命中。
- 未全盘扫描、检查所有压缩包内部、跟随所有链接或查找重命名 EXE，不能据此宣称全盘从未安装。没有可供读取实际 `version/help` 的本机程序，以下能力结论来自固定版本源码和内嵌帮助。
- Apple Mobile Device Service 已在运行，只读查看状态，没有启停服务或查询连接设备。当前 `ENABLE_GO_IOS_AGENT` 进程变量未设置，没有修改它。
- 本轮新增的 `.local/glx-go-ios-audit-20261025-01/source/` 只是文本审计材料，不是此前的安装或可运行工具。

## 固定来源与Windows准备方式（尚未批准）

| 项目 | 固定内容 |
| --- | --- |
| 官方版本 | [v1.3.2](https://github.com/danielpaulus/go-ios/releases/tag/v1.3.2)，发布于2026-08-11 |
| 对应提交 | `2fb34682ef12db97c9fafdf99f1dd1d3522604ad`，GitHub tag ref 直接指向该 commit |
| 官方Windows资产 | `go-ios-win.zip`，8,824,605 bytes，来源仅该 release 的 GitHub资产 |
| 发布资产SHA256 | `939c6bcaafed183a92afb9f79cc11b1f935fa6389bfc94d3902e3f52c4dff3fe`；来自发布API的digest，**未下载/本地验算归档** |
| Windows依据 | 固定 release workflow 在Windows构建 `ios.exe`，并发布windows-amd64 npm条目；当前主机X64 |
| 原生CLI存放提案 | `E:\AI\wechat-wasm-slim\.local\go-ios-readonly-20261025-01\tools\go-ios-v1.3.2\`，尚未创建/下载 |
| 依赖 | 运行发布EXE不需要Go SDK；直接USB路线使用既有Apple USB/usbmux服务。EXE的实际PE/DLL依赖尚未读取，不提前装额外驱动 |
| 自有API helper构建 | 固定 `go.mod` 要求Go1.26.0并指定 `toolchain go1.26.5`；建议另行批准从 [Go官方](https://go.dev/dl/) 准备便携Go1.26.5及锁定模块缓存 |

若批准准备，所有工具、Go SDK、GOMODCACHE/GOCACHE只放同一隔离 `.local` 实验目录，使用绝对路径/子进程环境，不改全局PATH、注册表或系统服务，不用全局npm安装。下载先核对官方元数据和SHA，来源或哈希不符即停。当前不建议仅为本次三分类就安装stock CLI；它无法单独完成该要求。SDK和依赖准备、第三方执行、本地helper实现及手机枚举需要分别明确范围，不能由本条调研推定授权。

## 实际读取的命令与调用链

固定提交的[内嵌帮助](https://github.com/danielpaulus/go-ios/blob/2fb34682ef12db97c9fafdf99f1dd1d3522604ad/internal/clihelp/help.yaml)确有：

```text
ios webinspector list [--timeout=<seconds>] [options]
```

所以 `ios.exe webinspector list --udid=<明确设备> --timeout=8` 是该版本真实存在的候选命令，但**本轮未运行，也不选作本次完整验收路径**。`--timeout` 不是覆盖设备解析、所有服务打开/阻塞I/O及清理的进程硬截止。

核查的关键文件均来自固定提交，22份文本逐一计算SHA256，并与该提交Git tree中的blob SHA核验一致。保存在本机忽略目录；没有运行其测试、构建或源码。

| 固定源码路径 | 结论与限制 |
| --- | --- |
| `cmd_device_webinspector.go`，list分支21–36行 | `New → Connect → ListPages(ctx, 500ms) → JSON`；该分支不调用OpenApp、SetupInspectorSocket、Evaluate或AutomationSession |
| `ios/webinspector/webinspector.go`，Connect/GetConnectedApplications/ListPages | Connect自动监听notification_proxy，再发送identifier/get-apps；ListPages又请求应用列表、等固定500ms、展平页面。返回条件 `apps非空 || state非空` 不证明完整应用列表已回复 |
| 同文件handleMessage | 完整应用列表、connected/updated都会自动查询listing；pages是合并缓存，空listing不会清除旧页，不能仅凭展平输出判断本轮回复为空或未回 |
| 同文件normalizeStartupError | EOF/零字节写可能被统一包装成Inspector disabled；不能据其报错建议直接认定手机开关有误 |
| `cli_setup.go` | CLI可按环境启动go-ios agent；本机相关变量当前未设置，也不代表以后可忽略此分支 |
| `cli_device_resolution.go` | webinspector纳入自动隧道信息查询；若已有信息会选RSD路径。只读USB提案须显式绕过，不启动或改动隧道 |
| `ios/notificationproxy/notificationproxy.go` | stock Client.Connect额外开通知服务，Observe传入10秒等待参数；循环中的非目标通知可重新开始等待，服务连接也不受该参数覆盖。Client.Close不负责收回这个内部连接。它不是第二个Inspector客户端，但属于需要披露的额外连接与清理边界 |
| `ios/connect.go`、`startservice.go`、`pair_read.go` | USB路径读既有PairRecord/StartSession/StartService/TLS，没有沿该链调用Pair()；仍会连接/申请系统服务，不是零接触 |
| `ios/plistcodec.go`、`deviceconnection.go` | 公开Reader/Writer/Close和长度编码plist接口可用于独立只读记录；底层部分Dial/Send/Read不受CLI context完全约束，须有外层自有进程截止 |

因此，原生list分支在“没有主动启动/附加/eval”上符合，但在**分层回复证明、路径隔离和完整超时清理**上不足。也不能只包 `NewWithConnection` 的Reader/Writer便宣称解决，stock Connect还会绕到通知服务。没有为了绕过限制使用eval、CDP、js-shell或launch。

## 初稿：纯传输API提案（已撤回，保留核查过程）

初稿建议调用固定go-ios库的公开传输接口，**不调用CLI、stock Client.Connect/ListPages或自动化接口**。此路线已撤回，不再作为待执行方案：

```text
ios.ListDevices()
  → 只匹配既有私有选择符且ConnectionType为USB的唯一DeviceEntry
  → ios.ConnectToService(device, "com.apple.webinspector")
  → ios.NewPlistCodecReadWriter(conn.Reader(), conn.Writer())
  → 自有受限元数据收发/记录
  → 冻结记录、conn.Close、收回receiver、自有进程退出
```

这是**拟准备的go-ios API helper调用路径**，不是已存在的新CLI命令或已验证可运行的程序。它使用go-ios的USB、配对会话、TLS和plist实现，不复制pymobiledevice3的设备实现，也不修改第三方库。

1. **配对与传输：**原USB、原设备选择符，唯一USB条目才继续；只读既有配对记录供TLS使用，绝不打印/导出配对内容，不调用Pair/SavePair。找不到、身份不符、新信任/权限要求即停。不自动RSD、隧道、Wintun、DDI、通知代理、代理服务或agent。`StartService`申请的是系统Inspector服务，不是启动微信/小游戏；这仍是明确的设备接触。
2. **请求：**一次identifier、一次get-apps；只有从已收到列表确认的微信应用ID才发listing，每ID至多一次。发送白名单只有这3类；不打开Inspector socket、不建立automation session、不发JS/snapshot/启动/设置请求，失败不重试。其他应用只计数量，不保存其名称、ID、标题/URL。
3. **回复与时间：**记录器在首次发送前安装；一个2秒元数据观察窗，记录每份回复的序号、相对时间、条目数与处理状态，保留空回复而不只看缓存。协议无逐请求ID，只报告顺序/时间关联。应用列表未回复、收到有效列表但未发现微信、微信listing未回、微信listing明确为空/非空、发送未完成及接收失败分别分类。
4. **总时限：**设备/服务连接阶段各计划3秒软预算，整个操作8秒软预算；观测截止后禁止新发送并同步冻结。尝试在1秒内关闭自有连接/收回读取任务；外层自有helper进程20秒硬截止兜底不可取消的上游阻塞。硬截止或JSON不完整不能报告无目标。不得终止手机进程、其它程序或现有服务，也不外部重试。
5. **输出：**版本/提交与helper哈希、明确USB选择是否匹配（不含UDID）、各层请求尝试/发送完成、每次有效回复数量、微信发现来源、微信目标类型/数量、超时阶段、接收错误及清理结果。敏感目标字段仅本机新私有文件；错误分类不能原样输出可能含配对字节的底层日志。当前game session固定UNKNOWN，不对应原冻结现场。
6. **串行与停止：**先只读确认没有本任务遗留Inspector helper，不启动pymobiledevice3。无法确认是否有别的Inspector客户端在用则停并报告，不杀进程抢占。只执行一轮；即使有目标也停在报告，不附加。若仍为空，将该Go结果与pymobiledevice3第04次结果并列，随后核对宿主开放条件，不再循环换工具或重复连接。

准备顺序：用户先确认是否接受这一**自有API helper**路线及隔离Go工具链/锁定依赖准备；获准后先实现并做完全离线fake（空/未回/通知/分片/错误/截止/清理/发送白名单），产出固定源码/EXE哈希，再另报唯一手机执行候选。**本轮尚无安装或连接授权，停在报告。**

两条工具最终仍接触同一个Apple Inspector服务；go-ios不会获得更高权限。源码支持某条API路径不等于当前iPhone会暴露游戏目标，静态核查也不算GLX修复或真机通过。

## 本地恢复入口与未做项目

`.local/glx-go-ios-audit-20261025-01/`保存固定上游源码、release/tag/tree元数据、分组SHA及blob核验和 `AUDIT_RESULT.json`。其中发布包没有下载，Go SDK/模块没有下载或安装；没有运行任何go-ios帮助/版本、编译、fake或设备命令。此前41项是Python枚举器的测试，不能移作Go helper测试。

pymobiledevice3第04次结果仍在 `.local/glx-inspector-response-audit-20261025-01/device-enumeration-04/`，结论和会话未知标记保留。原始私有材料不进Git，文档仅记录可公开来源和脱敏结论。

## 修订：保留官方发现流程，仅补观测（未获准备或设备授权）

用户指出两点：仅复用USB和编码不等于官方发现流程验证；2秒关键回复未到时须明确是否继续等到8秒。接受该纠正，撤回初稿方案。本节取代初稿的调用路径和时间规则，之前的来源/源码核查仍保留。

### 具体复用范围

固定 v1.3.2 / `2fb34682ef12db97c9fafdf99f1dd1d3522604ad`，拟在独立源码副本中使用官方：

```text
明确唯一的USB DeviceEntry（受限入口，绕过CLI全局agent/tunnel解析）
  → webinspector.New
  → Client.Connect
  → Client.ListPages(ctx, 500ms) 仅按官方流程调用一次
```

identifier、应用列表及listing的生成、发送、接收、消息分派、应用/页面解析、缓存和原有返回判断继续由官方 `Connect / GetConnectedApplications / readLoop / handleMessage / sendMessage / ListPages` 执行。Connect和ListPages本来各请求一次应用列表；收到完整列表或connected/updated引发的自动listing也保留。不会另写请求状态机、只向微信发送的替代调度，或为了得到不同结果而修补 `apps非空 || state非空`、pages合并、500ms等待与EOF包装。

官方notification_proxy监听保留并单独披露，它不是第二个Inspector客户端；不通过静默删掉监听改变初始化。受限USB入口绕过的是外层CLI的agent/隧道选择，因此验收应称为“**go-ios官方发现库加最小观测补丁的本地构建**”，不能称未经修改的发布EXE或整个CLI端到端验证。

允许的最小差异仅为：

- 可选审计hook：实际发送前/发送完成或失败、消息读取成功/失败、官方handler处理前/后，记录序号、单调时间和回复数量。只读记录，不能修改官方消息、对象表或调度；hook故障单列观察失败并停止。
- 保存官方ListPages首次返回的原始结果、返回时间及错误；随后保持原连接和readLoop，不再调用ListPages/GetConnectedApplications来补结果。后续分层结论明确标为“审计记录器判断”，不冒充官方返回结论。
- 生命周期边界：统一截止、截止后阻止新发送、冻结结果并调用官方Close；发送白名单禁止launch/socket setup/automation/eval等。截止前原有三类元数据请求及参数保持原样，不用门禁悄悄删除官方原有请求。
- 只做完成上述记录所需的最小测试接缝/日志脱敏。若实现必须扩大到重构通知代理、缓存或发现算法，先停下报告，不顺手修go-ios。通知辅助连接是否正常收尾单列；不能保证时明确记录，最终由本任务自有进程退出释放其句柄，不虚报逐项优雅关闭。

### 2秒、8秒与20秒的明确含义

**会继续等待，但不为了延长等待额外重发请求或重新连接。** 官方原本的Connect/ListPages调用顺序及请求次数保留。T0定义为helper开始设备发现/连接前的单调时刻，8秒是同一轮总操作预算，不是2秒后再加8秒。

| 时点/条件 | 行为与结论 |
| --- | --- |
| T0+2秒 | 只保存中间观测。若关键回复尚未到且连接无错误，保持同一连接、让官方接收循环继续，最多等到T0+8秒；不写目标为空 |
| 2秒时官方首次调用已返回、关键回复齐全 | 可以冻结并收尾；“齐全”需收到有效完整应用列表，且其中每个当前微信条目均有对应listing回复的时间/顺序证据。不能用automation state代替应用列表 |
| 2秒后缺失回复提前到齐 | 在官方首次调用已返回的前提下可收尾，不必耗满8秒；多个微信条目分别记录，部分回复不当全部完成 |
| T0+8秒仍缺回复 | 冻结并标出缺的是应用列表、微信listing还是官方首次调用仍未返回；分别标“未回复/等待截止/发送未完成”，绝不标目标为空 |
| 收到有效应用列表但没有微信 | 标“本次已收到列表，未发现微信条目”，不是手机没有微信或永久不支持调试 |
| 已发现微信且收到有效空listing | 才能标“本次该微信listing明确为空”；与官方展平缓存结果分开保存 |
| 权限/连接/解析/记录异常 | 立即停，不为了耗满预算继续试；保留故障阶段，不追加版本或重连 |
| 8秒以后 | 无有效观测、不得追加发现请求；只做清理，迟到消息单列窗口外，不能补作窗内成功 |
| T0+20秒 | 仅自有helper进程的硬兜底，绝不延长有效观察到20秒；无完整结果时报告硬超时，不报告无目标 |

该8秒包含设备选择、打开系统服务和等待；若前段耗时，后段只用剩余时间。官方部分I/O不响应context的限制仍在，因此8秒是主动冻结/取消/关闭的截止，不保证所有上游调用已返回；20秒只负责结束本任务拥有的进程，不结束微信、其它客户端或系统服务。

协议没有逐请求ID，审计只能做顺序/时间关联；保留这一缺口。当前游戏会话身份仍UNKNOWN；同一手机/应用ID不认证为原冻结会话。

### 若随后批准，只做离线准备

本次澄清不是安装或实施授权。后续若用户只批准准备，则仅在原计划的隔离目录准备固定Go1.26.5、源码与锁定依赖，列出最小补丁后构建和离线测试，不连接手机。

门禁应验证：补丁反向应用能逐字恢复固定上游；截止前请求数量、参数和必要先后关系与官方fake一致（不固定并发listing的任意顺序）；官方首次结果和独立审计结果分栏；state提前返回、完整空列表、官方先返回空但稍后listing到达、重复/异步回复、旧pages合并、2秒未回后在2–8秒间到达、到8秒仍未回、异常、通知辅助连接及清理边界。fake设备工厂必须阻止任何真实usbmux/通知代理连接，不能直接把可能访问设备的上游测试当离线测试运行。

不增加CDP、JS-shell、自动化、snapshot或通用调试功能；本轮只排查“换一个官方发现实现后，是否仍收到空listing”这一疑点。离线通过后先报告准确补丁、产物哈希及设备执行方案，手机仍单独确认。当前未安装、编译、运行新代码或连接手机。
