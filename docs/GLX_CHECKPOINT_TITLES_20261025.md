# GLX 检查点独立标题候选（2026-10-25）

用户仅批准落实独立标题和兼容读取器、生成独立候选及电脑回归。候选 `native-glx-validation-e3bff4670c2ecebbbe0c` 已准备；没有上传、设备操作、重新枚举、云采集或新真机结果。用途是验证报告可区分性，不宣称修复日志丢失或游戏冻结。createWXLibWorker错误仍按既有原始证据单独保留，因果未确认。

## 修改边界

独立源码目录 `examples/glx-native-ledger-titles/` 从原ledger目录复制，旧目录不修改，旧df49候选仍通过原verify。实际运行代码差异只有两处：去掉共用PREFIX常量；输出行改用 `[GLX_CP1]` / `[GLX_CP2]`。JSON序列化表达式没有改动，4/9秒timer、最大两条输出、进入/返回/throw账本、快照读取和游戏执行路径未改。

新读取器兼容原 `[GLX_TRIANGLE_CHECKPOINT]` 和两个新标题；新增标题编号与正文checkpoint匹配检查，保留包、启动标识和原有模式/异常门禁。缺任一摘要正文时明确停止，不用重复计数徽标推测正文。新reader是电脑分析工具，不进入小游戏产物。

生成器仅将manifest observations中单个prefix说明更新为两个prefixes；生成身份按新源码哈希重新计算。沿用9b31固定来源链构建同层候选，并以df49做最小差异核对，不覆盖或回退它。候选中13个runtime文件只有execution-ledger.js及identity.js变化，CANDIDATE.json随身份更新；其它11个runtime文件逐字相同，包括game.js、boundary-probe.js、adapter、host、observer、gates、编译JS、WASM及配置。没有编译或重链。

新候选的packageId必然与旧包不同，正文中的身份值对应新包；“正文不变”指schema、字段、序列化与计数逻辑不变。在相同包/启动标识、时钟及快照输入下，新旧两个完整JSON正文逐字相同，已用回归验证。

## 身份与哈希（SHA256）

| 文件/依赖 | 值 |
| --- | --- |
| 新manifest | `7c2d8c5ed4534992ec40caa367cbece19cbede99a1cfc38290745079a683f3b4` |
| 新execution-ledger.js | `a0da17270e5bda376cb3dbe7ce2c5fe697cf4d8497fcba56ddc59156c56371d5` |
| 新identity.js | `4547fdd52f2fa1a2078f306beb0008557e58b0bf2f5e078258afa22e2d9ce632` |
| 原df49 manifest，未变 | `386f6e2a421f786ba665350d73acf0c7305b720fae7017a0a5e4caebf9b8846b` |
| 编译hosted JS，未变 | `4fb5e7017c11e34ca31ac41fcef4ef2337efb274d8370373a42085fdf9e50524` |
| WASM，未变 | `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79` |
| libemscriptenglx_4.0.10.a，未变 | `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |

## 本地结果

- ledger fake：14项通过，含新旧运行源仅标题差异、两次单参数输出、原文逐字一致、计时/次数不变。
- reader：53项通过（新18、旧ledger15、boundary20），含新旧格式、标题编号不符、跨包/启动、缺正文、重复第一条、截断JSON。
- stager：21项通过，含实际候选身份和真实自有probe/ledger输出的完整读取器回归、篡改拒绝和原异常传播。
- 仓库 `node tests/run.mjs`：126个汇总项通过，0失败，包含默认WebGL/GLX合同；Godot headless未运行。
- 新候选静态verify通过；新候选含manifest的14个文件与测试使用accepted-host逐字相同。
- 旧df49候选原verify通过；46项旧源码、父包和正常/失败证据SHA前后相同。

以上为自有JS/fake与静态检查，不执行第三方adapter、引擎JS或WASM，不能替代真机；日志合并规则与第二条缺失原因仍未知。

## 保留位置与恢复

- 新候选：`E:\AI\wechat-wasm-slim\.local\glx-checkpoint-titles-20261025-01\candidate-01`
- 原df49包：`E:\AI\wechat-wasm-slim\.local\glx-native-ledger-20261025-01\candidate-01`
- 来源9b31包：`E:\AI\wechat-wasm-slim\.local\glx-native-boundary-20261025-01\candidate-02`
- 本轮证据根：`.local/glx-checkpoint-titles-20261025-01/`，含PRESERVATION_BEFORE/AFTER、CANDIDATE_DIFF、测试日志、stager-tests-01及STATE.json。
- 原始真机证据继续留在 `.local/glx-native-ledger-20261025-01/phone-*/`，不纳入Git。

等待用户确认后才安排新预览。若获批，仍应先核实际3.17.5/GLX，首开先核两条独立标题及完整正文，再决定已明确授权的后续步骤；不自动沿用旧包的手机执行次数授权。不自动回退手机包。

## 已批准的一次预览及两步真机结果：结束并保留现场

后续用户明确批准仅该候选一次预览，先核对3.17.5，首开通过后一次三点菜单重新进入。用户确认手机实际3.17.5，候选及manifest重验通过，auto_preview一次成功（457632 bytes）；未清缓存、改设置、追加版本或枚举。工具结果及授权范围保存在本轮本地证据根PREVIEW_01_RESULT.json。

| 项目 | 首开 | 三点菜单重新进入 |
| --- | --- | --- |
| 用户画面反馈 | 正常 | 刚开始就卡住了 |
| 实际模式/基础库 | GLX / 3.17.5 | GLX / 3.17.5 |
| scene | 1101 | 1089 |
| CP1/CP2实际经过时间 | 4001ms / 9000ms | CP1 4004ms；CP2未出现在导出文本 |
| native回调次数 | 238→538 | 14 |
| after-frame/flush/batch/swap次数 | 各238→538 | 各13 |
| RAF请求次数 | 239→539 | 15 |
| 已观察调用退出情况 | 均返回、0 throw、open为空 | 均返回、0 throw、open为空 |

两轮包身份匹配，shader顶点35633/片元35632匹配，GLX metadata/canvas match为true。首开两条独立标题和正文有效，同启动标识，观察墙钟间隔4999ms；与用户正常画面关联后放行一次菜单重进，未视为稳定性验收。

重进原始日志中CP1恰1条、CP2为0，旧标题为0；最后完整记录为CP1，没有看到半条CP2。第4秒时JS仍能运行该timer，账本记录第13次提交链完整返回、第14次native回调及交付包装返回、第15次RAF请求返回。没有观察到某个受包裹同步调用悬而未返，也不能凭单快照认证之后计数一直不变。第4秒摘要中的第二plan fired=false只是该时间点的状态，不证明第9秒后来未执行。当前export没有createWXLibWorker或error/warn行，不反向否定旧会话错误，也不建立其与冻结的因果关系。

修改标题后，重进仍冻结且导出仍缺CP2，因此“只需不同标题就能获得第二正文”的办法本轮未达到目标；不能进一步断言合并被完全排除、RAF已停、线程此后卡死、timer未交付或GPU呈现根因。两个真实时间点的比较仍UNKNOWN。用户本轮反馈为刚开始就卡住，精确冻结时刻和独立计时的导出覆盖长度未记录。

原始日志和分析分别另存 `.local/glx-checkpoint-titles-20261025-01/phone-first-open-01/`、`phone-menu-reentry-01/`，文件哈希：

- 首开 `vconsole_1792934412121.log`：`5653ae605c075f47f5502c7f861232dbdaa9a69e5385d8d2987fa426cedc06ba`
- 重进 `vconsole_1792934527395.log`：`fe42b6aa55858b630a88cc03fbc66ab420b46bb1d1a3fe97ed4cbc6ebac302b5`

读取器exit 2为保存分析并要求停止，非读取失败。两轮GATE_RESULT记录已保存。本轮手机验证已结束，保留现场，不要求重新导出、再次点击、重开或追加版本。没有新代码修改，不宣称日志丢失或游戏冻结已修复。
