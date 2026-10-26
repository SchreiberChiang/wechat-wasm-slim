# 三点菜单重新进入卡红：执行边界核查，2026-10-25

本轮只做电脑侧静态核查、自有host/observer的fake API验证及手写条件模型。没有执行生成JS、adapter、WASM或GLX库，没有重建引擎、制作/上传新预览或操作手机。当前红背景现场、旧包和两份原日志保留，渲染实现与公共adapter未修改。

## 当前证据能证明什么

固定包为 `native-glx-validation-bee48002c945db68649a`。首开实际3.17.5/GLX，两轮RGB画面正常，连续颜色记录到frame2221。三点菜单“重新进入”后是新的JS观察会话，实际3.17.5/GLX、两个shader类型正确；用户看到红背景固定、三角形仍可见，日志只有frame1。具体包/会话/哈希见[上一轮记录](GLX_NATIVE_FRAMECOLOR_20261025.md)。

这不是关闭后从最近使用进入，也不是强退微信；那几项仍未测。新JS观察会话不证明微信PID、平台context或回调注册表已重建。相同公共contextHandle=1/GLX contextId=2不能证明底层对象相同。

frame1的COLOR在 `main.cpp:79` 的printf中，位于draw之后、C++ frame返回之前。它证明到达这处观察点，不证明printf返回、C++回调返回、下一RAF请求、after-frame flush或最终显示完成。因为只有颜色边界才输出，frame2–60即使运行也没有COLOR；不能从缺61断定精确停在1或RAF停止。

## 主循环与异常链的准确顺序

核对实际编译JS SHA256 `737ea15afbad5c87ee9a09ce2c27ce998f32966533fc74b7ea225aa04d30f3df` 和固定Emscripten4.0.10源码，路径为：

1. `main -> emscripten_set_main_loop(frame,0,true)`：创建runner，以RAF模式/value1请求首个回调，再抛内部控制流字符串 `unwind`。
2. `callMain`识别unwind后，继续postRun，因此初始化摘要早于实际异步frame1。失败日志正是host第13行、COLOR第14行。
3. 宿主交付RAF后：`runner -> runIter -> callUserCallback -> native frame`。
4. 正常返回才继续 `maybeExit -> postMainLoop -> runIter返回 -> checkIsRunning -> scheduler -> MainLoop.requestAnimationFrame -> 全局RAF请求`。

后继RAF是在runIter返回且世代检查通过后请求，不是事先请求；上面列的是native正常返回路径。普通JS Error/RuntimeError由 `callUserCallback -> handleException -> quit_` 重新抛出，在当前产物中会阻止到达runner末尾的scheduler；这不保证经过Module.onAbort。`unwind`和ExitStatus是单独识别的控制流，可能被handleException接受后令runIter继续返回，不能把“到了scheduler”等同于native必然正常返回，更不可把启动unwind误记为渲染错误。numeric C++ exception/longjmp约定也与字符串unwind不同，没有证据显示本轮触发过它们。

ABORT、runtimeExited、pause/cancel改变的mainloop世代、blocker、scheduler本身或全局RAF调用均有不同门禁；本轮没有实测这些状态，不能选其中一个作为根因。候选没有设置Module.preMainLoop/postMainLoop，这两个数组初始为空；fps0/value1不会走基于get_now的timeout节拍或隔帧分支。颜色计算没有时钟输入，不等于运行时内所有时钟调用均不存在。

主要SDK位置：`src/lib/libeventloop.js:268–278,300–316,326–350,408–505`；`src/lib/libcore.js:1979–1999,2055–2072`；`src/postamble.js:78–103,172–212`。实际JS零基UTF8字节偏移：callUserCallback10824、runner14831、runIter调用15635、后继scheduler15690、runIter定义16930、globalRAF helper17337。hosted文件需加manifest的894字节前缀。静态库辅助历史WAT的函数编号不移用到新候选。

## afterDoFrame不是postMainLoop

实际glue注册的是 `Module.wxContextGlobal.registerAfterDoFrame(Module._glxCommandBufferFlush)`。接收者来自 `context.emscriptenGLX` 的公开元数据副本，不是canvas的同名方法；传入的是裸WASM flush导出，不经过Emscripten postMainLoop数组。

已存在的静态提交链：

```text
微信平台调用已注册afterDoFrame回调（相对RAF的实际时点未知）
  -> 原生glxCommandBufferFlush
  -> evalBatchRenderAsync
  -> batchRenderAsync(view) 的JS调用返回
  -> drawcall>0且swapWindow存在时，调用swapWindow()
```

glue没有await/catch/retry。同步batch调用抛错会阻止其后的swap；如果返回拒绝的Promise，此处不会等待或接管它。Async函数名、JS返回及swap返回均不证明GPU完成或像素已呈现。注册日志发生在注册调用前，不能证明平台后来调用了回调。

SDK、adapter、glue和可得库符号没有提供平台registerAfterDoFrame/batch/swap实现，当前也没有实际调用trace。因此无法确定afterDoFrame是在native frame内、RAF外层回调返回前还是runner已排下一RAF后执行。**不能画成一条已证实的“frame返回→flush→下一RAF”链。** 若提交异常同步穿过尚在执行的runner，它可阻止下一scheduler；若在runner已返回后发生，则不能倒推已完成的请求被取消，平台后续反应仍未知。

## 已在电脑确认的日志覆盖缺口

以下是代码/fake验证确认的缺口，不是已确认的手机根因：

| 位置 | 实际行为 | 对本轮判断的限制 |
| --- | --- | --- |
| host的一次性summarize | 初始化快照发出后，fail仍置failure但不再发blocked；onAbort/onExit忽略其返回Error | 不能凭初始化成功、后来没blocked排除后续失败；原始generated abort还可能另行打印/抛出，不等于所有abort都静默 |
| 普通callback异常 | handleException重新抛出，不保证走onAbort/onExit | 仅包这些Module hook无法覆盖回调、scheduler或平台after-frame异常 |
| observer.subscribe | hook缺失或注册throw均静默，无coverage字段 | 不能确认wx.onError/onUnhandledRejection是否成功订阅或覆盖本类错误 |
| observer.raw | console.log/error调用未加保护 | fake中“先保存原始行再throw”可令原始COLOR可见而native输出函数未返回；不能认定手机发生过此事 |
| observer.send | 结构化发送throw被吞 | 证据发送依赖console/export正常，日志可能不完整；新增探针自身不能再影响渲染 |

两日志都只有5条结构化事件，错误预算0/3，COLOR为38/180与1/180，预算均未耗尽。本轮不能把缺61归因预算；也没有证据认证vConsole完全无丢行。raw输出路径不主动截断原文，但未记录的平台/原生异常、阻塞或未交付回调不一定产生JS error事件。

## 重新进入后的状态残留

新entry、shader初始化、host快照与frame计数1表明当前观察/初始化路径重新执行。对完全相同root、未改变truthy observer/host guard的简单重复启动，会在新entry/host之前拒绝；实际日志不符合这一个狭义场景。

adapter存在 `__isAdapterInjected` 门禁，webpack bootstrap内也有模块缓存；glue只在Module.wxContextGlobal未定义时初始化buffer/state。日志未记录重进前marker、外层require策略、Module/global/canvas/RAF对象identity或平台旧after-frame回调，因此不能证明这些已清空，也不能证明它们实际残留。平台是否保留旧WASM flush回调尤其没有当前证据。不能通过清marker、重置context或注销旧hook来“验证”，那会先改变故障条件。

## 区分三个层面的最小证据

| 要区分的问题 | 下一轮需观察的原调用边界 | 能支持的结论及限制 |
| --- | --- | --- |
| 循环未继续进入应用回调 | RAF helper请求/返回、宿主交付、runIter及native delegate进入/返回/throw | 请求不等于交付；无返回且无异常还可能是阻塞或采集缺失，不能直接叫RAF故障 |
| 执行停在提交环节 | 平台afterDoFrame入口、flush、batch、swap各自进入/返回/throw，与RAF事件整数顺序关联 | enter后明确throw可定位同步异常边界；enter无return不能只凭日志断言永久阻塞；API返回不是GPU完成 |
| 计算持续但画面固定 | 应用计数跨61/121且参数正确、提交调用返回，同时用户观察画面仍固定 | 将调查收窄到提交返回后的显示链；日志本身不能证明实际像素 |

若COLOR日志仍只有1但新增边界计数到61，先查原输出、模式gate或导出缺口；不能忽略日志链并直接诊断显示。若两个旧/新会话标记的after-frame包装在新entry之后同时被调用，才有旧注册仍执行的直接线索；没观测到旧标记仍不证明平台已清理。

## 下一诊断候选的具体提案，尚未制作/上传

只为补上上述执行边界，保持同一C++、整数RGB、三角形、静态库及WASM `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79`，不重新构建或换库：

1. 从固定737ea15a…生成JS派生独立观察副本；只在既有runIter/native delegate、RAF helper请求/交付、afterDoFrame/flush、batch/swap调用处加透明进入/正常返回/throw观察。每处原函数仍只调用一次，this/参数/返回值保留，原始异常值原样再抛。不附加await/Promise处理，不增加帧、flush、swap或恢复逻辑。
2. 仅记录各边界第1、第2、第61次调用和最初4条异常，合计最多96条新边界事件；原COLOR180条上限保持。用整数序号记录顺序、active callback及会话标记，不读时钟算FPS。采集预算/日志覆盖异常时明确停止，不能写通过。
3. afterDoFrame包装捕获本JS会话标记，观察旧回调是否在新entry后仍出现；只读取既有启动marker和函数/对象关联，不清理marker，不改公共adapter，不重建或注销上下文。
4. 在独立诊断host/observer里单独输出late onAbort/onExit和hook订阅结果，不再受初始化摘要的“一次性”约束。原始输出/回调异常仍按原路径传播；只有新增观测器自身的发送失败被隔离并计数。不得吞应用错误或把它改写为成功。
5. 包装会改变回调函数identity并增加JS开销，可能扰动故障时序；即便故障消失也不能宣称修复。新副本需固定锚点/输入哈希、完整配套与fake异常/接收者/返回值回归，不覆盖当前候选。

后续若安排手机，只提议同一实际3.17.5/GLX上的首开和三点菜单“重新进入”各一次，复现当前同入口，不继续强退、后台或Godot。独立候选准备/电脑检查完成后再报精确包标识、回退位置和手机范围，未获明确确认不上传或操作。此处方案不是手机授权，也不是已完成的实现。

## 本轮电脑验证与保留

自有host/observer fake补充验证5/5，通过覆盖late摘要、订阅失败、raw先记后throw、结构化发送throw；第一版gap repro也通过。手写边界条件模型7/7：正常返回、内外提交throw的不同调度后果、60回调仍只有COLOR1、pause门禁、计算推进但不呈现、丢日志与静态画面组合。模型不执行Emscripten/GLX，不当真机证据。

可复跑公开模型：`node --test examples/glx-native-framecolor/boundary-model-tests.mjs`。只新增测试和报告，未改现有运行代码。完整SDK/实际JS偏移、库符号与历史反汇编佐证、自有fake脚本及结果在本机忽略目录 `.local/glx-frame-boundary-audit-20261025-01/`；原始手机证据仍在framecolor原目录。结束前复核原候选/JS/WASM/adapter/库/两日志哈希，保持原字节。

结论：本轮查实了调度顺序和日志覆盖缺口，尚未查实手机中断点或根因。保留红背景现场，暂不进入Godot；不把电脑模型、静态连通或初始化摘要写成真机持续呈现通过。

后续状态：用户已授权电脑实现，上述方案现已形成独立候选 `native-glx-validation-9b31f77db008bc37fda1` 并完成本地回归，见[候选记录](GLX_JS_BOUNDARY_CANDIDATE_20261025.md)。本审计的“尚未制作”描述的是提案时点；新候选仍未上传，原手机现场不动，也没有开始Godot。
