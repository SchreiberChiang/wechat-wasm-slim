# GLX执行账本候选：电脑准备完成，2026-10-25

用户明确授权以封存 `9b31f77db008bc37fda1` 为基线，在独立候选补进入／返回／throw账本和两个一次性检查点，并完成电脑侧实现与回归。本轮没有连接或操作手机、重复Inspector枚举、上传预览或换包，没有编译/重链引擎或库，也没有Godot、赛车、裁剪、分包、默认WebGL、服务/设置或服务器改动。

## 身份及来源

| 项目 | 值 |
| --- | --- |
| 当前分支/原HEAD | `codex/glx-native-minimal-20261025` / `4e2474d1e177626bd3e52a53b143b084a1ade7ae` |
| 父包 | `native-glx-validation-9b31f77db008bc37fda1` |
| 父manifest SHA256 | `2fa5a6c5acaf2969317e870e563414080cbbc56cacda74f445a5f34df8991f57` |
| 新候选 | `native-glx-validation-df49cd5c277e160b4ead` |
| 新manifest SHA256 | `386f6e2a421f786ba665350d73acf0c7305b720fae7017a0a5e4caebf9b8846b` |
| 逐字继承的hosted编译JS SHA256 | `4fb5e7017c11e34ca31ac41fcef4ef2337efb274d8370373a42085fdf9e50524` |
| 同一WASM SHA256 | `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79` |
| 同一 `libemscriptenglx_4.0.10.a` SHA256 | `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |

GLX库仍为已核验的官方0.1.11对应字节，Emscripten4.0.10来源不变；本轮没有重新下载/链接。38项父候选、旧探针源码、正常/失败原日志与已有受保护证据前后哈希相同。原包、两种Inspector结果和未知连接记录保留，没有新设备结果。

## 实现差异

新增源目录 [examples/glx-native-ledger](../examples/glx-native-ledger/README.md)。没有修改旧 `glx-native-boundary` 的生成器或源码；新的extend-probe在独立候选中用5个精确锚点扩展父probe，反向恢复后逐字等于父probe。原wrapper、Reflect.apply调用点、this/参数、返回对象、原异常值和1/2/61日志选择保持。

每次已有invoke只做有界内存更新：stage进入/正常同步返回/throw总数、整数transition、最近16个转换、最多16个open条目及诊断失败标记。账本自身require/begin/finish故障被隔离，原调用仍执行一次；不会检查返回对象then或接管Promise。

原入口末尾只增加一次arm，注册计划4000ms和9000ms的两个单次timer；重复arm不重排。每个回调最多尝试输出一次 `[GLX_TRIANGLE_CHECKPOINT]`，合计最多两条，独立于旧96条boundary预算。摘要包括包/session、计划与实际墙钟原值、有效性、账本、旧snapshot、既有runtime primitive以及注册/读取/输出诊断。计划时间不保证交付时间，Date.now也不认证为单调时钟或FPS。

继承文件逐字相同：编译hosted JS、WASM、adapter、host、observer、gates、game.json和两份项目配置。父包仅game.js、identity.js、boundary-probe.js改变，增加execution-ledger.js，共13个runtime文件；CANDIDATE仍按原packOptions排除。没有更改RGB C++或帧提交，也没有增加RAF、flush/batch/swap、GPU查询、私有heap读取、touch、overlay、循环watchdog、持久化或云上报。

每probe闭包保留session；旧timer若晚到会输出旧tag，由读取器分开。模块可选stale-session抑制仅有fake测试，实际未配置，不能写成已自动丢弃旧会话timer。当前手机会话仍未知，任何新候选只产生新诊断会话，不能补作原冻结现场证据。

## 电脑回归及配套门禁

| 范围 | 最终结果 |
| --- | --- |
| 账本/两个timer fake | 13组通过 |
| 父seal、反向恢复、封装、拒绝篡改、真实候选manifest及真实自有检查点集成 | 21项通过 |
| 新读取器15项 + 原读取器20项 | 35项通过 |
| 原probe合同 | 15项通过 |
| `node tests/run.mjs` | 120个汇总项通过，0失败，含默认WebGL/GLX合同 |
| 最终候选verify | 静态通过；14个含manifest文件与最终fake集成使用的候选逐字一致 |
| 原包/源码/原始证据保护 | 38项前后SHA一致 |

覆盖原始任意throw值、对象返回/接收者/参数、嵌套/重入、深度/大小预算、timer/clock/console/reader故障及已有目录拒绝覆盖。新verify不是只信候选自填seal，而是重建父来源与当前生成计划。针对改候选并自填hash、父额外文件、缺文件及模拟源码漂移的拒绝均通过；失败副本留在新测试目录，未动原件。

初次审查发现新reader错误读取顶层parentPackageId，而真实manifest放在identity内；手写fixture遮蔽了接口差异。已修正并加入真实plan.manifest和真实probe/ledger输出的集成回归。初期测试输出、最终输出和格式化前源码都保留。本次fake集成两条摘要为2853/2988 bytes，不由此保证真机日志导出无截断。

这些测试执行自有JS及fake接口。第三方编译程序/adapter未执行，WASM仅静态Module/符号配套核查、未实例化；没有微信模拟器、Godot headless或手机验收。本次没有新的GLX通过轮次，也不将诊断准备当作修复。

## 读取结果的边界

- 两条同session快照能说明两个实际回调执行之间，哪些进入/同步返回/throw计数推进。窗口小于1000ms、时间倒退/无效/不一致或两条挤近均UNKNOWN；超过阈值仍只叫观测到的墙钟窗口，不认证稳定性。
- 请求返回增加而后续交付未进入，只支持窗口内未再进入交付包装，不证明平台接受请求或RAF根因。
- open只是截至快照未观察到退出；可能仍在正常执行或重入，不能直接说永久阻塞。明确throw保留同步错误事实，原错误不吞。
- native推进但提交入口不推进，可收窄到提交回调链；native与同步提交返回都推进且人工画面固定，只收窄到提交后的显示链。均不证明GPU完成或实际像素。
- 检查点未出现仍无法区分JS线程整体阻塞、timer未交付、console阻塞或整段导出丢失。该情形停止并报告未知，不自动再枚举、再改版或通过触摸/overlay补救。

新增分配、两个timer和日志会扰动时序。故障消失只能写“此诊断条件未复现”，不能结案GLX-20/22或完整Godot黑屏。

## 本机位置与复现

- 新候选：`E:\AI\wechat-wasm-slim\.local\glx-native-ledger-20261025-01\candidate-01`
- 回退/复现父包：`E:\AI\wechat-wasm-slim\.local\glx-native-boundary-20261025-01\candidate-02`，精确9b31父包，**不是稳定性通过包**；手机换回同样须确认。
- 配套原构建：`.local/glx-native-framecolor-20261025-01/build-01/`，没有续编或覆盖。
- 本轮证据根：`.local/glx-native-ledger-20261025-01/`，含PRESERVATION_BEFORE/AFTER、STATIC_PAIR_AND_SCOPE、CANDIDATE_RECOVERY、测试日志、stager-tests-01/02及fake-only输入/输出。私有配置、原包、二进制、原始日志和manifest留在本机忽略目录，不提交Git。

复现命令见新增目录README。候选verify会拒绝当前运行源漂移；若以后修改runtime/generator，需重新生成新的独立候选和身份，不修改此封存。

## 待确认的有限真机方案，未执行

申请范围仅为本候选的一次预览换包、首开和三点菜单“重新进入”各一次，完整日志由用户导出。本轮授权不包含这些手机动作，当前未上传。

1. 获批后先核对当前手机旧包vConsole实际基础库为3.17.5；不符即停，不下发版本或清缓存。通过才上传此一个候选，换包前再次verify固定SHA；不追加其它版本。
2. **首开一次。** 不触摸渲染区域、不提前打开vConsole，观察三角形及至少两轮RGB约20秒，给两个检查点机会执行；然后导出完整日志。核对精确包、实际3.17.5/GLX/画布、两条同session摘要及输出/预算状态。任一异常、缺摘要或版本/模式不符即停，不进入下一步。
3. **只有首开正常才做一次三点菜单“重新进入”。** 仍观察约20秒，不替换成关闭/最近使用或强退微信；分别记录画面是否继续变色。即使冻结，也保持这一现场到观察窗结束后导出日志，不重开/清缓存/再触发渲染。按新session两检查点和原边界事实定位；缺任一条或异常时明确未知并停。
4. 两份日志与人工画面一一对应；不发送云日志、不新增USB/Wi-Fi取证、截图/PID、Inspector、强退或后台测试，不自动回退换包。若之后需要这些动作另行说明并确认。

此方案只求区分已证实故障的执行层，不验收稳定GLX，更不开始Godot接入。获准测试前不操作手机；当前旧包及原始证据继续保留。

## 获批真机执行：同包首开正常，菜单重进冻结，停止

用户随后明确批准此候选一次预览、首开与一次三点菜单“重新进入”，先由用户读取旧包实际3.17.5；auto_preview成功一次，457629 bytes。未重复枚举、清缓存、追加包或新增云采集。前文“未上传”描述电脑准备阶段，现以本节为后续状态。

两份完整导出原件及分析分别保存在忽略目录 `.local/glx-native-ledger-20261025-01/phone-first-open-01/` 与 `phone-menu-reentry-01/`。首开原始SHA256为 `f01fd3726af7bfcada678de765ce2c500b0029d0e05b909781aa774bd9569dba`，重进原始SHA256为 `30d1bf64e499d5f39b4bbd9e27ebf4ed58742a43832e67dc1a0c28cee170f9ff`。原件没有覆盖；预览结果及两轮GATE_RESULT另存本地。

| 项目 | 首开 | 三点菜单重新进入 |
| --- | --- | --- |
| 用户画面报告 | 正常 | 不变色，三角形仍可见 |
| 实际基础库/模式 | 3.17.5 / GLX | 3.17.5 / GLX |
| 启动scene | 1101 | 1089 |
| shader创建后类型查询 | 顶点35633、片元35632均匹配 | 同样匹配 |
| 检查点 | 4005ms、9001ms两条 | 仅4002ms一条；第二条缺失 |
| RAF请求进入/返回 | 239→538，均返回 | 19/19 |
| RAF交付、run-iter、native-callback | 238→537，均返回 | 各18/18 |
| after-frame、flush、batch、swap | 238→537，均返回 | 各17/17 |
| 检查点时open/throw/账本故障 | 均0 | 均0 |

重进最后16个转换明确记录：第17次提交链完整返回，随后第18次RAF交付/native回调返回，第19次RAF请求返回，第18次RAF交付包装返回。第4秒快照的runtime仍为running=true、frame=18、abort=false、runtimeExited=false；这不是持续运行证明。当前快照没有调用“进入而未返回”的证据，第18次afterDoFrame尚未观察到。数量差1本身不能证明afterDoFrame被丢弃或平台故障。

新增证据说明该会话至少推进到18次主循环，第4秒timer仍能执行，并非只能看到原日志采样的前2帧。仍不能建立计数长期不动的双快照对照：导出在第一条摘要处结束，没有独立证据证明导出覆盖了第9秒；第二条缺失可能涉及导出窗口/遗漏、timer交付或后续阻塞，不能据此认定RAF停止或提交卡住。也不能拿返回的JS调用计数证明GPU呈现。

读取器正常生成分析后以exit 2表达stopRequired（FRAME_61_COLOR_NOT_OBSERVED）；checkpointCoverage另明确为TWO_CHECKPOINTS_NOT_OBSERVED/UNKNOWN。未自动重跑、更改reader或补包。人工画面失败及缺第二摘要共同触发本轮停止；首开通过仅是放行一次菜单测试，不是GLX稳定性验收。保留当前手机现场，未继续操作。

### 用户后续提供的新会话与截图：不能把导出缺项写成timer未执行

用户另提供 `vconsole_1792930357284.log`，说明再次从右上角三点菜单重新进入并等待超过9秒。该次不是助手发起的追加手机测试；没有新上传或远程手机操作。新会话身份不同于上一失败会话，scene仍1089，同一候选、实际3.17.5/GLX、shader类型均匹配。原件SHA256为 `30ac71c4dbc231459f46a34e94d0321b77d1175ccf42b54a71a745139c05f50b`，保存在 `.local/glx-native-ledger-20261025-01/phone-menu-reentry-02/`。

导出只含4003ms的checkpoint 1：RAF请求15、交付/native14、after-frame/flush/batch/swap13，均同步返回，open和throw为0。没有checkpoint 2正文。另新增微信运行时Unhandled promise rejection：`WeixinWorker.createWXLibWorker is not a function`，参数含 `WAAccelerateWorker.js`，堆栈在微信运行时 `WAWKWorkerMainContextJSAPI.js` 和 `WAWKWorkerMainContext.js`。该错误字符串未在候选文本及此前两份日志检出；只可作为本次运行时错误线索，不证明其导致冻结，也不证明其它会话没有未导出的同类错误。

随后用户截图在CHECKPOINT折叠行左侧显示计数徽标2；其下hide sequence 6、show sequence 7与这份日志同session，show scene1089。截图原件已另存，不含展开的检查点编号、时间或计数。应区分“导出中没有第二摘要正文”和“第二timer没有执行”：后者未被证明。界面合并/重复显示与导出保留方式成为需要核对的取证缺口，但徽标2本身不能替代checkpoint 2字段，更不能拼成双快照。截图还表明这次后续发生过hide/show，不能把后续截图视为完全未离开前台的原观察窗。

维持停止。下一项最小取证是同会话已存在的合并摘要展开正文或无折叠的完整导出；不需要新包、重开或加探针。当前没有要求或执行手机操作，也没有修改代码。读取器原始分析保留，截图补充与用户等待时长另存EVIDENCE_RECONCILIATION.json，避免覆盖原始证据。
