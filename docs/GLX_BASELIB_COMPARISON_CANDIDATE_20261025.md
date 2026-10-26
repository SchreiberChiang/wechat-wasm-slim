# 3.17.5 / 3.15.2 共用 GLX 候选：准备与真机对照

最新状态：候选 `native-glx-validation-533f0b87a2e09b77c666` 已完成一次预览和3.17.5首开／菜单重进对照；首开正常，重进失败且两摘要计数未增长。随后仅下发3.15.2，同包未重建或重新上传。用户确认3.15.2下有缓存、无缓存及多种重进均正常显示并持续刷新，并补充一段启动日志，确认同包、实际3.15.2／GLX及同设备／客户端；片段未包含CP1／CP2，不补造计数对照或逐轮完整验收。两阶段均停止，不自动切回或追加手机测试。下文“未上传／待授权”等为当时准备阶段状态，后续记录优先；不是冻结根因修复或完整Godot验收。

## 范围与完整差异

从冻结的 `native-glx-validation-e3bff4670c2ecebbbe0c` 派生，独立源码目录为 `examples/glx-native-baselib/`。旧目录、旧候选、正常／失败日志均保留。

13个运行文件中仅两项不同，manifest另行更新：

| 文件 | 改动 |
| --- | --- |
| clock-gates.js | 仅两处文本：允许的实际SDK从精确3.17.5改为精确3.15.2或3.17.5；拒绝原因列出两版本。读取API、返回的实际值、读取失败处理、GLX上下文/画布检查不变。 |
| identity.js | 新候选ID、父包/manifest、生成器和门禁文件哈希随新身份更新。日志中的包身份自然随之改变；没有增加日志事件或改变正文结构。 |
| CANDIDATE.json | 记录新身份、两个变化文件、11个逐字相同文件和版本策略；标记未运行/未上传。 |

其余11个文件逐字相同：`game.js`、`game.json`、`host.js`、`observer.js`、`boundary-probe.js`、`weapp-adapter.js`、`triangle.wasm`、`triangle-hosted.js`、`execution-ledger.js`、`project.config.json`、`project.private.config.json`。没有重编或重链。RGB、接收者、上下文绑定、注册次数、提交路径、4/9秒timer、两个摘要及其正文/预算均不变。项目配置保留原值；实际手机版本不能由项目配置推定。

电脑侧新文件：`clock-gates.cjs`（包内门禁源）、`prepare-host.mjs`、`verify-host.mjs`、`stager-tests.mjs`、`read-boundary.mjs`、`read-log.mjs`、`read-log-tests.mjs`。`.gitattributes`仅为新目录增加LF规则；问题总表增加本次索引。旧门禁、旧读取器和既有构建/转换实现未修改。

## 实际版本与预期版本

运行门禁继续调用 `getSystemInfoSync().SDKVersion` 并返回实际读值，不选择或填入预期值。成功分支没有新日志。原observer的entry仍单独读取平台实际SDK，逐字保留；门禁失败时仍记录实际读值并停止。

新读取器从旧读取器复制到独立目录，只修改版本判定及新父包身份：

- `analyze(raw, manifest, previous, expectedSdkVersion)`第四参数必须明确为3.17.5或3.15.2；CLI必须传 `--expected-sdk`，没有默认值，不从实际日志反推预期。
- 报告的 `expectedSdkVersion` 与session的实际 `sdkVersion` 分开保留，原始日志字节/SHA不改。
- 若导出有 `Wechat Lib` 首行，则核对其实际版本与entry及预期是否一致；首行缺失不伪造。版本不符、混杂或未知则停止。
- `--previous`只允许同包、同身份、同预期/实际版本的前一阶段记录。跨版本报告保留为各自独立材料，不能通过previous补齐本轮缺项或关联旧启动标签。
- 包身份、启动标识、实际GLX、shader、异常、CP1/CP2完整性及计数等原门禁保留。缺摘要仍停止，不把版本放行写成画面成功。

## 身份与 SHA256

| 项目 | SHA256 |
| --- | --- |
| 新manifest | `a48b5a09a2b58cc787d3a8964c84531e6de70c19fad2bda163f81f67a1437dcf` |
| 新clock-gates.js | `25f1bf321a5ec9c838632e68ae3f818e3ca382a91aa2b505a641c155e448d2f7` |
| 新identity.js | `edae2858f3b08ed3e3fd10c99cef7ccc1f64604762bef12ce6b003a114761a31` |
| 配套hosted JS，未变 | `4fb5e7017c11e34ca31ac41fcef4ef2337efb274d8370373a42085fdf9e50524` |
| WASM，未变 | `c3f7248085bc455ef48bf0c02f31709bd2c9fbf7f2b4cc811e2e2caa88eeaa79` |
| libemscriptenglx_4.0.10.a，未变 | `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |
| 原e3 manifest，未变 | `7c2d8c5ed4534992ec40caa367cbece19cbede99a1cfc38290745079a683f3b4` |

这些是本地封存文件哈希，不是尚未上传的微信压缩包哈希。

## 离线验证

- 门禁、真实observer的fake、逐字差异/封存及篡改拒绝：13项通过。
- 新读取器25项加旧三组读取器53项：78项通过。覆盖两个版本正例、交叉期望不符、缺失/非法版本、header冲突、actual/raw哈希保留、跨版本previous隔离、包/启动混杂、异常和缺CP停止。
- 仓库 `node tests/run.mjs`：132个汇总项通过、0失败，含默认WebGL/GLX配置与运行时合同；未运行Godot headless。
- 正式候选重建式verify通过，13个文件与测试accepted-host相同；固定库SHA重新核对一致。受保护旧候选、源码及证据43项SHA前后不变。

只执行自有JS门禁/observer的fake和离线读取器，未执行生成引擎JS、第三方adapter或WASM，未连接微信工具或手机。电脑检查不替代3.15.2兼容性、实际画面或生命周期验收。

## 保留位置与复现

新候选：`E:\AI\wechat-wasm-slim\.local\glx-baselib-comparison-20261025-01\candidate-01`。

直接回退原件：`E:\AI\wechat-wasm-slim\.local\glx-checkpoint-titles-20261025-01\candidate-01`（e3）。更早df49和9b31包保持原位置。本轮未改变手机中的包；日后任何手机回退换包仍需确认。

本轮本地证据根 `.local/glx-baselib-comparison-20261025-01/` 保存逐文件 `CANDIDATE_DIFF.json`、13项测试、reader/repo回归日志、43项前后封存、最终状态。原始日志/私有配置/二进制继续只留本地，不进Git。

在本工作区运行（输出必须是全新目录；已有目录拒绝覆盖）：

```powershell
node examples/glx-native-baselib/prepare-host.mjs --parent-dir <原e3候选绝对路径> --out <全新绝对目录>
node examples/glx-native-baselib/verify-host.mjs <新候选绝对路径>
node examples/glx-native-baselib/stager-tests.mjs --parent-dir <原e3候选绝对路径> --out <全新测试目录>
node --test examples/glx-native-baselib/read-log-tests.mjs
node examples/glx-native-baselib/read-log.mjs --log <原始日志绝对路径> --candidate <新CANDIDATE.json绝对路径> --out <全新报告绝对路径> --expected-sdk 3.17.5
```

3.15.2阶段需显式改最后的预期参数；不能改写原日志内容让它通过。

## 后续计划：等待用户确认，尚未执行

先在实际3.17.5核对同候选，首开正常且两摘要完整后，做一次三点菜单“重新进入”以确认是否仍复现。保存画面反馈及原始日志后，再按批准范围下发3.15.2并核对实际生效，用**同一候选**对照同操作。不把旧Godot包的强退结果算成本三角形菜单验收，也不在中途改receiver、cleanup或日志。

每步观察至少15秒；版本/包/GLX不符、首开异常或证据不足即停。菜单冻结后等待该次观察结束、保存日志并保留现场；不自行重试或追加版本。3.17.5不复现时不重复尝试直到失败。这里只准备方案，未授权执行手机阶段。

## 后续已批准的3.17.5真机轮次：结束，保留失败现场

用户随后仅批准本候选在3.17.5的一次预览、首开通过门禁后一次三点菜单“重新进入”。开发者工具状态核对通过，唯一一次auto_preview成功，457656 bytes；推送前后manifest与13个文件均匹配。原e3首开/重进两日志原字节另存保全。没有切基础库、清缓存、修改代码或追加版本；3.15.2阶段仍待本轮结果确认后的单独授权。

| 项目 | 首开 | 三点菜单重新进入 |
| --- | --- | --- |
| 包 | 两轮均 native-glx-validation-533f0b87a2e09b77c666 | 同左 |
| 用户反馈 | 正常 | 不行；本条未具体说明固定颜色、三角形是否可见、黑屏或准确卡住时刻 |
| 启动标识 | triangle-mvnxr9a5-pkvqjhb5 | triangle-mvnxvqcj-ddwpbews |
| 实际基础库 / 模式 | 3.17.5 / GLX | 3.17.5 / GLX |
| scene | 1101 | 1089 |
| CP1 / CP2经过时间 | 4001 / 9001ms | 4010 / 9002ms |
| 两摘要实际时钟差 | 5000ms | 4992ms |
| RAF请求 | 239→539 | 48→48 |
| RAF交付 / run-iter / native回调 | 各238→538 | 各47→47 |
| after-frame / flush / batch / swap | 各238→538 | 各46→46 |
| throw / 未返回调用 | 0 / 0 | 0 / 0 |

设备均为iPhone 16 Pro/iPhone17,1、iOS18.3.1、微信8.0.75。两轮metadata/canvas均匹配，两个shader请求/返回分别为35633/35633和35632/35632。读取器两次均显式指定`--expected-sdk 3.17.5`；重进另关联同版本首开报告，未混用3.15.2材料。观察方案要求至少15秒，未独立测量用户实际观察时长；CP之间的记录时间不代替完整观察时长或FPS。

这次重进**CP1、CP2均在原日志中完整存在**（第68、69行），同包同启动，时间字段有效；CP2不是读取器补出。两份ledger/runtime相同：generation0、currentFrame47、running=true、abort/runtimeExited=false，预算未耗尽、无观测集成失败；本导出未见error/warn/createWXLibWorker。末尾为第46次提交链返回→第47次native/run-iter返回→第48次RAF请求返回→第47次交付包装返回。第70/71行的hide/show在两个检查点之后，不能倒推为此前停滞原因。

狭义结论：这4992ms记录窗口内，受测回调与提交计数未增长，未到frame61颜色切换；不是只凭缺一条日志推断。CP2表明约第9秒timer和日志输出仍可执行，不支持“整个JS线程自早期一直堵到第9秒”的解释。没有已观察调用悬而未返或throw，不证明GPU完成、平台必须交付下一RAF，也没有确认停调度的具体原因。不能将它与旧Godot shader类型错误合并为同一根因；3.15.2对照尚未做。

读取器重进exit2符合停止门禁，唯一停止项为`FRAME_61_COLOR_NOT_OBSERVED`，两检查点比较为`NO_COUNTER_PROGRESS_OBSERVED`。手机阶段已停止，不要求追加导出、截图、重开或切版本。

原始日志与分析保存在本地证据根的`phone-3175-first-open-01/`和`phone-3175-menu-reentry-01/`；完整轮次结果为`PHONE_3175_ROUND_RESULT.json`，预览回执及先前日志保全为`preview-3175-01/`。原始日志SHA256：

- 首开 `vconsole_1792939283594.log`：`807806c8095c375bd646c8ce8a0c4a00da4db4b882e1689d8ad42eed15833744`
- 重进 `vconsole_1792939492348.log`：`4d7b235b05979abbc966346bbb1255e51a9331898d95aeeae10587c0210580ed`

## 3.15.2后续：同包切库，用户确认多种重进正常

用户明确批准保全3.17.5证据后，仅下发3.15.2。通过已有专用控制工程、同一登录账号，在官方开发者工具“调试基础库→推送”中确认一次，界面显示“推送成功”。没有重新预览、重建或修改533f包，也没有由助手操作清缓存、重试或自动恢复3.17.5。控制工程本地选择器调整不代表手机实际生效；确认下发前选定3.15.2。下发前后24项候选／既有证据及13个运行文件均核验一致，原e3回退保留；manifest仍为`a48b5a09a2b58cc787d3a8964c84531e6de70c19fad2bda163f81f67a1437dcf`。

用户随后直接反馈：已测试有缓存、无缓存及多种重新进入，均成功显示画面并持续刷新，实际基础库均为3.15.2，最初表示不再提供报告。之后主动粘贴启动日志片段，以下表格按新增证据更新；不要求追加日志或重复测试。

| 证据项 | 3.15.2本轮记录 |
| --- | --- |
| 画面和持续更新 | 用户确认正常，包含其自行描述的多种重进；不是助手独立截图观察 |
| 实际基础库 | 补充片段的Wechat Lib及entry均为3.15.2；其余多次运行仅有用户总体反馈 |
| 包 | 片段明确为533f、启动triangle-mvnzjdz7-xkosm7p0；电脑封存哈希未变，片段中库／WASM／hosted JS／门禁声明哈希与manifest一致；其他各轮身份未提供 |
| GLX | 同一片段host的actualMode=glx、actualContextMetadataMatch=true、actualContextCanvasMatch=true；此轮运行时身份有据，不是由配置或初始化口号推定 |
| CP1／CP2、实际时间、RAF请求／交付／提交增长 | 无本轮原始记录，均未核验；持续刷新反馈不能补造具体计数 |
| 入口、次数、缓存操作 | 用户总体描述为有缓存／无缓存、多种重新进入；未逐项记录菜单重进、历史入口、强退或恢复的次数与顺序，不补填验收矩阵 |
| 设备／客户端 | 新片段为iPhone17,1、iOS18.3.1、微信8.0.75，与3.17.5失败轮相同 |
| 读取器 | 预期仍为3.15.2；未将截断片段伪装完整原日志或生成读取器PASS |

比较结果：同一封存候选在3.17.5已有首开正常／菜单重进失败及计数不增长的原始证据，而切至3.15.2后用户报告多种重进持续刷新正常。这显著加强基础库版本相关回归／兼容性变化的线索，优先级高于目前未证实的receiver或清理假设。但本轮用户还改变了缓存条件、运行次数和入口，缺少逐轮日志、身份及严格配对，不能称已经完成只差基础库的受控实验，也不能判定具体平台内部原因。

本结果仅涉及最小三角形候选，不关闭完整Godot的GLX-01／GLX-02，不证明shader类型错误、3D、裁剪或分包已修复。3.15.2可保留为当前人工验证正常的实验基线，不能依赖开发者下发机制承诺所有用户或所有设备固定此版本。若继续源码工作，优先整理现有3.17.5失败与3.15.2人工正常的版本差异证据，不据此盲目修改接收者、提交或清理；新实验另行明确范围。

补充片段的scene为1089，与新版失败轮相同，但scene值不能唯一识别用户操作。shader创建后类型查询为35633→35633、35632→35632，均正确；注册after-frame一次返回。最后完整boundary为sequence37、第2次RAF交付返回，累计请求3、native回调2、提交链1；后面一条被截断，无CP1／CP2，不能把这些早期次数当最终次数或4至9秒窗口。片段中的GLX contextId=2、shader公共handle=1属于不同层，不能据此认定与新版底层context不同或找到原因。未见片段中的throw不等于全程无异常。

本地恢复入口：证据根`baselib-3152-switch-01/`保存下发授权、前后哈希和官方UI结果；`PHONE_3152_USER_REPORT.json`保留最初用户原话及当时证据边界，`PHONE_3152_PASTED_EXCERPT_REVIEW.json`另存随后粘贴片段的字段摘录与核对结果（非完整原始日志）。旧`PHONE_3175_ROUND_RESULT.json`与其当时待授权状态原样保留，本节与新记录补充后续进展。
