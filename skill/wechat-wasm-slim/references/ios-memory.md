# iPhone 微信小游戏运行内存采集

## 适用范围与已验证版本

本路线测运行内存，不裁剪 WASM，不创建预览，不安装或购买 PerfDog。适用于模板版和 WXGameKit 工程的外部进程观测；不要求微信脚本调试器连接成功。

复用来源是所有者授权公开的通用实现，固定快照 `574d155ef1a59ff0be404e36099f3f280afefa58`，实现见 `<KIT>/tools/ios-memory/`。原项目于 2026-10-20 记录了 Windows 11、iPhone17,1（16 Pro）/ iOS18.3.1、微信8.0.75 的有线 / 无线实际样本与 DVT 截图。此处只移植源码与去敏操作方法，不复制配对、账户、IP、私人截图、游戏资源或原始样本。集成离线测试不替代新设备真机验证。

- 固定 `pymobiledevice3==11.40.0`。有线原环境 Python 3.12.14；无线成功环境为已有 Python 3.14.0 的独立 API venv，使用原生 TLS-PSK TCP。
- 脚本目前故意固定 `iPhone17,1 / 18.3.1` 设备档案，其他系统 / 型号会拒绝。不要删掉校验就称兼容；新增档案须独立核对 API 和设备行为。
- 无线 API venv 并非完整 CLI 环境：原完整依赖链的 `pyimg4 → pylzss` 无 cp314 wheel，`pip check` 未通过；经验证的 DVT / 隧道 / 截图 API 可以工作，不代表固件恢复或所有 CLI 可以工作。不要照搬 `--no-deps` 后忽略依赖错误；优先复用已验证环境，缺环境时明确准备方案再安装。
- 本轮没有完整 transitive lock 文件可复用；记录实际 Python / 包版本、安装来源、依赖 freeze 与导入检查，不把单个顶层 pin 说成完全可重现环境。

官方依据：[项目](https://github.com/doronz88/pymobiledevice3)、[安装](https://doronz88.github.io/pymobiledevice3/installation/)、[iOS17+隧道](https://doronz88.github.io/pymobiledevice3/guides/ios17-tunnels/)、[DVT API](https://doronz88.github.io/pymobiledevice3/api/dvt/)。版本变化时核对安装版帮助/源码，不拼接旧 QUIC、`--mobdev2 --userspace` 或管理员 tunneld 命令。

## 开始前

1. 定位真实 `<KIT>`，读取本参考与脚本 `--help`；核对是否已有独立 venv / 当前采集操作者。一次只有一个 Sysmontap owner，先保护旧样本和当前可玩包。
2. 默认只复用已配对设备、已开启 Developer Mode、已挂载的 Personalized Developer Image。缺信任、镜像、远程配对、驱动或系统组件时报告具体层级，先取得对应授权；不自动启用/挂载、清配对、改安全设置或重启。无线的普通 USB 配对与 RemotePairing 是两件事。
3. 所有输出放 `<KIT>/.local/` 的新目录；依赖环境放 `.tools/` 或用户已有工具目录。二者和 `*.private.*` 已忽略，仍须在提交前核对未混入个人数据。读取现有配对仅限目标设备，不打印/复制证书、私钥、UDID 或配对文件。
4. 核实实际运行模式：配置 true 不代表生效。记录手机面板或运行时 `GameGlobal.isIOSHighPerformanceModePlus` 的实际观察；未知就用 unknown。没有脚本上下文不要伪造查询结果。

## 有线最小采集

以下 PowerShell 在 `<KIT>` 根目录执行，`$py` 换成实际已核实的 Python，不改系统 Python。脚本 `--help` 无需连接手机；CLI `version / doctor` 只在该 venv 的完整 CLI 可用时使用。

```powershell
$py = '<现有venv>/Scripts/python.exe'
& $py -c "import importlib.metadata; print(importlib.metadata.version('pymobiledevice3'))"
& $py tools/ios-memory/pmd3_probe.py --help
& $py tools/ios-memory/pmd3_probe.py capture --out '.local/ios-memory/usb-001' --seconds 65
# 另一终端在 READY 后记录用户实际反馈；不执行手机点击
& $py tools/ios-memory/pmd3_probe.py mark --out '.local/ios-memory/usb-001' --phase lobby
& $py tools/ios-memory/pmd3_probe.py stop --out '.local/ios-memory/usb-001'
& $py tools/ios-memory/export.py --runs '.local/ios-memory/usb-001' --out '.local/ios-memory/export-001'
```

默认 65 秒，上限 900 秒，每次新目录。先确认新样本，再让用户按最少步骤开 / 退已有小游戏。`stop` 会请求停止，不为凑一分钟继续采；未满一分钟的段保留但不通过有效变化门禁。读取 `summary.private.json` 的 complete / cleanup 和 `failure.private.json`，不能只看命令退出码。异常不会自动重连；恢复时新建段，不拼接成无中断曲线。

成功有线段的 `context.private.json` 含匿名设备指纹，可作为无线身份 pin。若从别的 checkout 沿用，只复制经核对的该 context 到本工具包 `.local/`；不要复制普通或远程配对密钥。

## Wi-Fi：先发现，再用实际成功 API 路线

手机和电脑同一实体局域网、解锁，用户按提示拔 USB。先使用 `wifi_inspect.py` 做只读发现；发现在线并非内存采集成功。若 Apple usbmux 真实列出同机 `Network`，可评估 `--transport wifi-usbmux`，但原成功案例不是这条路线。

已成功路径是实体 IPv4 LAN mDNS → 匹配已有 RemotePairing authTag → 新 lockdown / pair-verify → TLS-PSK TCP → 进程内 userspace RSD → DVT / Sysmontap。脚本不新建配对、不改安装包、不建内核网卡/持久服务、不向网络开放调试端口。

先从本机网络配置读取实际物理接口 IPv4 与前缀，写 `<KIT>/.local/ios-memory/lan-interface.private.json`，结构为 `{"IPAddress":"<实际局域网IPv4>","PrefixLength":<实际前缀长度>}`。不要猜接口、写公网地址或修改路由。使用已有有线 context 和已有 RemotePairing 记录：

```powershell
$py = '<已验证的Python3.14 API venv>/Scripts/python.exe'
& $py tools/ios-memory/wifi_lan.py --device-context '.local/ios-memory/usb-001/context.private.json' --lan-config '.local/ios-memory/lan-interface.private.json' --out '.local/ios-memory/lan-001'
# 仅在 endpoint.private.json 确实生成、同机 USB 缺席时采集
& $py tools/ios-memory/pmd3_probe.py capture --transport wifi-remote --wifi-protocol tcp --device-context '.local/ios-memory/usb-001/context.private.json' --wifi-endpoint '.local/ios-memory/lan-001/endpoint.private.json' --out '.local/ios-memory/wifi-001' --seconds 65
& $py tools/ios-memory/export.py --runs '.local/ios-memory/wifi-001' --out '.local/ios-memory/export-002'
```

发现 endpoint 默认 120 秒过期，失效就重新发现。原设备确有间歇无广播：若需复用旧 endpoint，只可显式 `--wifi-reauthenticate-hint` 将它作地址线索，原发现时间保留，仍须新身份认证 / 新隧道 / 新样本，不能当成新发现或绕过认证。没有同 LAN / 同身份就停止；出门离网是正常断开，不重置配对或无限重试。

原 iOS18.3.1 返回 `QuicProtocolNotSupportedError`；原 Python3.12 TLS-PSK DLL 加载失败不等于所有 Python3.12 都不支持。诊断精确区分发现、lockdown、RemotePairing、TLS、RSD、DVT、Sysmontap、清理。Wi-Fi InstallationProxy 可能失败：旧有线微信版本可注明为历史值，不能称本轮实时查询成功。

## 样本、进程与口径门禁

- 保存原始字节、主机 UTC 收样时间、elapsed_ms、PID / uniqueID / startAbsTime（设备若提供）、前后进程表、实际模式、脚本 hash。缺值不补零，字段属性数量 / 原生 PID 不匹配立即失败。
- 有效变化门禁要求同 PID 足够有效正数且跨度至少 60 秒、数值变化；空 / 全零 / 固定占位 / 只有虚拟内存不能通过。微信自身满足门禁仍不代表游戏已采到，须检查关联 WebContent。
- 保留所有微信 / WebContent 候选，结合开游戏前后、首次 / 末次出现、用户动作及获准截图识别。不能选最大的当游戏，不能靠 responsiblePID=1 断言所属。单批缺 PID 不证明退出，至少看持续缺失及最终进程列表。没有 JS 上下文绑定时称“关联候选”，不称独占全部游戏分配。
- 主曲线 `physFootprint` 是每进程 physical-footprint 记账，不是整机 RAM，也不是 JS 堆。`memResidentSize`、`memVirtualSize`、压缩字段各自独立；MiB = 1,048,576 字节，不与微信、其它 WebContent、WASM 容量或 GPU 估计相加。
- WASM 文件体积、线性容量和运行进程内存分别报告。约 1.5 GiB 后退出的单次记录不证明固定系统限额；进程消失与用户反馈不能代替当次 Jetsam / 退出报告。
- 导出只在本机生成 CSV / 内嵌数据的离线 HTML，不上传。每 run / PID 独立，缺样不连线；同次主机启动的连续段才可共用 monotonic 时间轴，不跨电脑/重启混成同一时间线。

## 截图与手机操作边界

仅在用户同意游戏画面截图且确认当前游戏可见时，为 capture 加 `--game-screenshots`，再通过 `screenshot --out <活动段> --phase lobby` 等请求截图。截图与采样复用同一 DVT 会话，记录时间差；截图可能含私人内容，仅存 `.local/`，不默认分享。`--display-fps` 是可选全屏 Core Animation FPS，不是游戏 render FPS。

截图成功不代表输入控制成功。原设备缺少 `com.apple.coredevice.displayservice` / `com.apple.coredevice.hid.universalhidservice`，未发触控；点击、真实拖动、自动打开/退出、代开车未通过。不要用 kill 微信 / WebContent 代替正常退出，不清缓存/聊天。新控制链必须另行验证与授权，且单列编码/镜像负载对内存的影响。

## 后续分析与报告

先固定包、模式、设备和流程，测大厅 → 房间 → 加载 → 驾驶 → 结算 → 留房再开 → 返回大厅。中断、锁屏、冷暖启动分别标记。一次改一类可证实问题并同流程复测；不靠降画质、删声音或改驾驶掩盖内存问题。原赛车的音频重复播放修复是案例，不是每个游戏的预设根因。

报告：版本 / 路线、哪几个关联 PID、字段口径、有效 / 失败段、峰值与阶段、已测 / 未测、下一步最少用户动作。工具上线和一次采集不等于完整比赛、长期无泄漏、脚本调试连通或手机自动化通过。
