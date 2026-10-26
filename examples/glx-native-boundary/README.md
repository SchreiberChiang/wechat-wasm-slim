# 纯 GLX JS 执行边界诊断候选

已准备候选 `native-glx-validation-9b31f77db008bc37fda1`，父包是三点菜单重新进入后卡红的 `native-glx-validation-bee48002c945db68649a`。本轮仅电脑实现/回归，未上传或操作手机；当前失败现场保留。

## 保持的输入与调用

- 复用同一完整WASM，SHA256 `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79`，未重编C++或库；整数60帧RGB、三角形和既有180条COLOR预算不变。
- 固定 `libemscriptenglx_4.0.10.a`，SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`；同一Emscripten4.0.10构建来源。
- 原编译JS `737ea15a…` 只替换三个精确调用锚点，并追加MainLoop观察安装段；逆向撤销后逐字等于原JS。不是新的WASM构建或引擎升级。
- 公共adapter、game.json、版本/context门禁逐字复用。AppID和编译选项不改，仅项目显示名/包身份变化。默认WebGL、Godot、赛车、裁剪、分包、服务器均未改。
- 不补RAF、不增加flush/swap、不加timer/延迟、Promise处理、GPU查询、私有heap访问、context重建或恢复代码。现有调用的this、参数、返回对象和原异常值保留，单次原调用不重试。

## 新观察

`probe.cjs` 只在原有RAF helper请求/交付、runIter/native delegate、平台afterDoFrame/native flush、batch/swap和原输出等边界记录enter/return/throw。各stage只选第1、2、61次，最初4条异常，所有新事件共用96条上限，末条明确预算耗尽。计数不是秒数/FPS，也不表示全部帧已呈现。内部unwind、numeric信号和普通Error分别保留类型，不擅自认证其含义。

每条事件含闭包绑定的observer session、整数顺序及只读runtime状态。旧afterDoFrame包装即使在新JS会话后被调用，也保留旧session。旧标记出现只证明旧JS闭包仍执行，不证明GPU context身份；没出现也不证明清理完毕。创建probe只读既有启动marker的own data descriptor，不调用getter或清marker。

独立host/observer记录错误hook是否存在/注册成功，晚于初始化的host失败不再被一次性摘要遮住。原始raw/callback错误继续原样抛回；新增诊断输出失败/重入被隔离并计数，不阻断原调用。后续事件带outputFailures；导出序号缺失、预算或覆盖异常时读取器要求停，不能宣布通过。

包装改变callback identity并增加JS/分配/日志开销，可能改变重现时序。即使这包不再卡红也不等于修复，且batch/swap的JS返回不等于GPU完成或像素可见。

## 电脑侧复现

依赖父包本地封存和其配套构建，不重新下载/编译。所有参数为绝对路径，输出必须不存在：

```powershell
node examples/glx-native-boundary/prepare-host.mjs --parent-dir <父包candidate目录> --build-dir <父包build目录> --out <新候选目录>
node examples/glx-native-boundary/verify-host.mjs <新候选目录>
node examples/glx-native-boundary/probe-tests.cjs
node examples/glx-native-boundary/reporting-tests.cjs
node --test examples/glx-native-boundary/read-log-tests.mjs
node examples/glx-native-boundary/stager-tests.mjs --parent-dir <父包candidate目录> --build-dir <父包build目录> --out <新测试目录>
node tests/run.mjs
```

准备器校验父包身份/逐文件seal、编译输入/产物、静态库哈希及配套来源；未知输入和已有输出均拒绝。verify重新生成全部应有字节，不信任候选自己的hash字段。测试执行自有probe/host/observer/prelude/新写的包装表达式与fake方法；不执行原/派生编译程序、真实adapter或WASM。JS仅做语法编译，WASM仅沿用原配套结构审计，不实例化。

日志工具（手机获准运行后才使用）：

```powershell
node examples/glx-native-boundary/read-log.mjs --log <完整vConsole> --candidate <候选CANDIDATE.json> --out <新报告JSON>
# 后续导出可加 --previous <上轮同候选报告>，识别已知旧session；不会按tag时间猜事件先后。
```

读取器保留缺61时的分层事实，不直接诊断RAF停止；可保留本次导出没有旧entry的旧回调事件，明确关联未知。当前entry的边界事件要求seq1起连续，缺号说明采集不完整。只有手机画面与对应日志能验证可见状态。

详细结果、回退位置及尚未批准的首开→三点菜单重新进入方案见[候选记录](../../docs/GLX_JS_BOUNDARY_CANDIDATE_20261025.md)。本地私有配置、二维码、原始日志、seal与二进制不提交Git。新候选未上传，手机仍应保留原卡红现场。
