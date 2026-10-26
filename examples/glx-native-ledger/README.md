# 最小GLX执行账本和两个一次性检查点

独立候选 `native-glx-validation-df49cd5c277e160b4ead` 以已封存的 `native-glx-validation-9b31f77db008bc37fda1` 为父包。仅完成电脑实现、静态配套审计和自有fake回归；未枚举或连接手机、预览换包、运行真实编译JS/adapter/WASM，也未接Godot。

## 只增加的取证

- `extend-probe.mjs` 固定父probe SHA，在原有 `invoke` 内补进入／同步返回／throw账本，不新增一套调用包装。异常值原样传播，原有第1/2/61次日志与96条预算保持。
- `ledger.cjs` 的stage、open及last列表各限16；计数为安全整数，有溢出和失败标记。snapshot返回数据副本；open只代表截至快照尚未观察到退出，不能认证永久阻塞。
- 原入口末尾注册计划4000/9000ms的两个单次timer，最多输出两条 `[GLX_TRIANGLE_CHECKPOINT]`。timer只读取账本、原snapshot与既有runtime reader，不驱动帧或补交命令。记录原始Date.now、有效性、实际回调时间及输出/注册失败；计划间隔不当真实间隔或FPS。
- timer通过词法全局 `setTimeout/Date.now/console.info` 透传，不假定它们存在于GameGlobal同名属性上。不叠加触摸、overlay、循环watchdog、写盘、Promise等待或云传输。

旧会话timer保留其probe闭包标签；实际接入没有启用模块可选的stale-session抑制。读取器分包、分session保留，不能用旧会话摘要补新会话。

## 保持的字节

父包的 `triangle-hosted.js`、`triangle.wasm`、`host.js`、`observer.js`、`weapp-adapter.js`、`clock-gates.js`、`game.json` 和两份项目配置逐字不变。只修改入口、identity和probe，增加 `execution-ledger.js`；连项目显示名也未改。WASM/库/RGB、原始batch/swap/afterDoFrame路径未重建或重写。

新manifest固定父packageId及父manifest SHA，调用旧verify重建父来源链；新verify从当前源码再生成计划，比对完整文件集合和每个字节。候选自填hash不能替代此检查。已有目录拒绝覆盖，负例与旧包保留。

## 电脑复现

所有路径必须绝对，输出目录必须不存在：

```powershell
node examples/glx-native-ledger/prepare-host.mjs --parent-dir <9b31父候选目录> --out <全新候选目录>
node examples/glx-native-ledger/verify-host.mjs <新候选目录>
node examples/glx-native-ledger/ledger-tests.cjs
node examples/glx-native-ledger/stager-tests.mjs --parent-dir <9b31父候选目录> --out <全新测试目录>
node --test examples/glx-native-ledger/read-log-tests.mjs examples/glx-native-boundary/read-log-tests.mjs
node tests/run.mjs
```

测试只执行自有probe/ledger/入口和fake API，第三方编译JS/adapter不执行，WASM仅结构/配套审计、不实例化。完整Godot、微信模拟器和手机均未运行。

未来取得获批手机日志后，使用：

```powershell
node examples/glx-native-ledger/read-log.mjs --log <完整vConsole文件> --candidate <本候选CANDIDATE.json> --out <全新报告JSON>
```

可选 `--previous <同候选旧报告>` 仅帮助辨认旧标签，不能跨session拼两条检查点。读取器复用旧boundary reader，只有manifest schema适配，原始日志/hash、身份、基础库、GLX、shader和缺61事实不改。新检查点缺失、损坏、预算/输出异常，或两个实际回调挤近时，保留UNKNOWN；同会话两次读取可描述计数是否增长，始终不认证GPU或可见画面。

## 已知盲区

同线程完全卡死、timer未交付、console阻塞或整段导出丢失都可能没有检查点，无法靠这项取证区分。Date.now是墙钟，两个有效数字也不证明单调可靠；小于1000ms的观察间隔不用于停滞判读，超过阈值也不是稳定性验收。新增内存分配、timer及日志可能改变故障时序，未复现不能写成修复。

来源/哈希、本地结果、回退位置与待批准的有限真机方案见 [候选记录](../../docs/GLX_EXECUTION_LEDGER_20261025.md)。手机新预览、换包和运行仍须另行确认；不自动回退或再枚举。
