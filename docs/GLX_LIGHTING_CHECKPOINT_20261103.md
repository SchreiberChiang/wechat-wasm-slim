# 阴影与 alpha 输出补丁保存点（2026-11-03）

本次只整理自有补丁、成功构建配置和脱敏证据，不构建、不上传、不运行手机，不修改 Claude 冻结目录。补丁在已有测试中有效；GLX、驱动或着色器编译器的具体责任尚未证明。不是所有设备、变体和真实游戏均无问题。

## 当前交付身份

以新清单 `docs/evidence/GLX_LIGHTING_DELIVERY_20261103.json` 为本检查点身份入口。它不替换历史记录，不表示后台体验版当前指向已查询。

| 项目 | 核验值 |
|---|---|
| 当前包 | `claude-alpha-light-cloud-glx-10914e3e21ab144c` |
| 父包（只有阴影补丁的新旧对照） | `claude-shadow-r04-cloud-glx-84231cde840b701f` |
| 源码仓库 | `https://github.com/citizenll/godot.git` |
| 源码提交 | `df3cdd9bc9941a20cb5575d781cde6f937637bcb` |
| 实际运行引擎 | `4.7.2.rc.custom_build.df3cdd9bc` |
| 历史 PCK 导出编辑器 | `4.7.2.stable.steam.ed1daf0bf`，与运行引擎分开记录 |
| 工具链 | Emscripten `4.0.10`；构建驱动 Node `24.18.0`；SDK 内 Node 为另一份，见配置指纹 |
| 官方 GLX 库 | `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`，3,866,614 字节 |
| 成包 JS | `d65d751899b46b3292a46cd48ee4a39b6aa63e03176a90f28f153ef1407c1a2a` |
| WASM | `e7b88edf517c66b20a176443e8baec63aaefcfa011d9777b89ea0a2e7ba577c3` |
| WASM.br | `fed5ba84faa05499d1a01ca0a0d1b11e027a0e1d07a68d796761d9690505dacb` |
| PCK | `a1264d8d806a65fe596e002b23a8306319597e959da1ee089fb8ebeb12b5e54f` |
| 配套摘要 | `061e635589db96b6454c62877a91740648aeae39f0c10a680dce638b5cd9d07e` |

配套摘要算法是 `SHA256(UTF8(JSON.stringify([JS哈希,WASM哈希,BR哈希])))`，数组顺序和小写哈希固定。这是已有六行阴影/透底云测场景，不是已完成新引擎八项回归，也不是之前的两项自动演示 PCK。冻结包已含其原有图像比较/读回逻辑；本轮没有添加、执行或移植这些诊断。

## 必须保留的补丁顺序

| 顺序 | 仓库文件（相对根目录） | SHA256 / 用途 |
|---|---|---|
| 1 | `engine/alpha-preserve-lighting/baseline-shader-diagnostic.patch` | `84204452f43c04ef40ad4efcdd37e132f11ea429a42d029b63f6222d3e781ee6`；成功引擎已有 shader 失败记录和 JS 接线依赖，非本轮新增探针 |
| 2 | `engine/alpha-preserve-lighting/scene-alpha-restore.patch` | `24e7d2f318f87b09ad585354e4d6006e010e7c5f2de21f629e05829cfdf0a514`；已有条件式 alpha 保存/恢复，原件不改 |
| 3 | `engine/alpha-preserve-lighting/scene-light-output.patch` | `c9f371b648d8dddda224fc1e334225e376c6608bae3eefa75dd416907fadbac6`；Claude `shadow-fix.patch` 原字节 |
| 4 | `engine/alpha-preserve-lighting/scene-alpha-output.patch` | `57256151a301271b360be588da88fdb503471c0b7097c0d2ea4aa637012b0fce`；Claude `alpha-fix.patch` 原字节 |

第 3、4 份补丁只改 `drivers/gles3/shaders/scene.glsl`。不能用仓库另一份 `engine/shader-failure/native.patch` 代替第 1 份：其哈希不同，也不包含完全相同的既有依赖。

阴影补丁把灯光函数的 `inout vec3` 漫反射/高光累加参数改为值输入及 `out` 输出，main 的七处调用用临时结果赋回；alpha 补丁对 `inout float alpha` 做同样处理。面积灯提前返回前初始化输出。原本的累加和材质 alpha 继续传递，自定义灯光合法修改的 alpha 也能传回；没有改成最终 alpha 恒为 1，没有关闭混合，没有改官方静态库或纹理格式。这些源代码修改本身没有 Android/GLX 专用条件，回归仍应覆盖 iOS/WebGL。

第 2 份补丁仅在没有 `LIGHT_CODE_USED`、`USE_SHADOW_TO_OPACITY` 等条件时保护旧普通材质路径，不能拿它代替第 4 份自定义灯光路径的修正。四份补丁按成功构建顺序全部保留，不在这轮移除旧补丁。

补丁原注释有“inout 结果丢失”的表述，保留原字节供追溯；这里将它视为与对照结果相符的假设，不是已测得函数内部值或已定责平台。参数改写也可能改变编译优化和寄存器分配。

## 构建及组包约定

完整参数和工具文件指纹见 `engine/alpha-preserve-lighting/build-settings-20261103.json`。它是经过核对的构建记录，**不是可直接运行的私有 toolchain 配置**。

- 既有构建入口为 `trim/lib/build.mjs` 的 `buildEngine`。固定 pin → 按上述四份补丁依次应用 → 既有 Windows 链接响应文件适配 → SCons → 固定源码的 `godot_process.js` → BR 压缩。Windows 适配摘要 `11cb75dbfb9e2ddaf13b0754640bad593a3ff18603f2e6637a565bf8b6c7f1fe`。
- 使用已跟踪的 `examples/glx-smoke/full-engine.gdbuild`，全模块配置，无禁用类/构建选项。SHA256 `920ca801a58fe5bfb0f56aa39a1d523adae9658233189d6518b17e3c5b98e81b`。不使用旧默认裁剪配置。
- 成功记录为 `optimize=size`、`lto=thin`、SCons jobs=16、ThinLTO jobs=8、单线程、无 SIMD、无动态扩展。并行数是历史记录，不代表下一次可忽略当前内存负载直接启动。
- 固定源码继承 `-fexceptions` 和 `-sERROR_ON_UNDEFINED_SYMBOLS=0`。不能宣称这次成功构建做过严格未定义符号链接，也不在整理时把它偷偷改为 1。新环境完整链接/导入审计仍是后续交付门禁。
- 原构建记录计编译阶段 22.08 分钟，startedAt 到 finishedAt 24分14.486秒，attempts=1。阶段未完整拆分，不能据此宣称增量或性能收益；本轮未编译。
- **`return 0` 是构建后 JS 的独立派生步骤，不是 diagnostic.patch 的内容。** 原始 JS 为 `e9f09402…73ddb`，仅将唯一的 `evalCheckWxContextGlobalIdAvailable` 函数体替换为 `return 0` 后才是成包 JS `d65d7518…c1a2a`。每次从原始 JS 派生，禁止叠加后处理。WASM/BR不因此修改。
- `return 0` 的**必要性未验证，不是已证实的GLX永久要求**。它源于官方此前的ID来源诊断建议。原函数在 `Module.wxContextGlobal.fetchAndIncId` 为函数时返回1，否则0；当前派生版强制走不使用统一全局ID的路径。旧故障包带着它仍异常，所以不能把它说成灯光/alpha修复本身。本检查点为了准确保存已测组合而保留；未来可单独恢复原函数验证，不能未经对照直接移除，也不应在开源文档宣称无条件必须加。
- 没有 32768 能力覆盖、局部 UI alpha 绕开或新的预热改动。当前 PCK 沿用父包；以后更换回归场景必须重新导出 PCK、生成新身份，不能继续冒用当前候选。
- 官方库没有公开分发许可确认，本提交不带库。后续使用者需从微信官方获准渠道取得上述精确 SHA 的 4.0.10 库；名称、版本打印和 `latest` URL 均不能代替哈希核对。

本轮保存了可审阅的构建输入，没有验证无旧工程/无缓存的完整重建，不能承诺一键复现。SDK 安装、合法依赖分发、宿主完整交付、场景源与 PCK 重新导出、重建后的真机画面验收仍属后续工作。

## 只读核验与清单修正

执行 `engine/alpha-preserve-lighting/verify-checkpoint-20261103.mjs`，参数为：

```text
node engine/alpha-preserve-lighting/verify-checkpoint-20261103.mjs
  --package <冻结新包> --parent <冻结父包> --artifacts <原构建artifacts>
  --source <Claude成功引擎源码> --library <026e静态库> --build-record <原BUILD.json>
```

以上是参数示意；实际运行需写成所在 shell 的同一条命令。工具只读输入，在内存中无模糊匹配重放补丁，不链接、不实例化 WASM、不修改包。

本轮 PASS：四份补丁/9个源文件与固定源码及成功构建内容吻合；完整 `scene.glsl`（LF）为 `6a957961db53b6225daaaf5f69253f80ca22a75a98c30b3ab5a21a65ab4da967`；新旧各30个payload文件均与各自冻结清单吻合；BR解压和原WASM一致；成包JS与原始JS仅有上述函数体差异；配套摘要匹配。

新旧包实际不同的文件是 `engine/godot.wasm.br`、`candidate-mode.js`、`project.config.json`（项目名称）。前者是引擎变更，后两者用于身份/工具显示；不能写成“所有文件只有WASM变化”。JS和PCK原字节相同。

冻结 `CANDIDATE.json` 的 identity 与payload正确，但顶层遗留旧candidateId、旧WASM/BR、`engineRebuilt=false`、旧changes列表。新清单重新生成这些字段；旧值仅放入明确的历史纠错区。原 identity 中的 `NOT_RUN/NOT_UPLOADED` 是组包时快照，后来的实测记录单独归档，不反向篡改原件。继承的场景源码manifest未核实为本云测场景，不纳入新权威身份。原始manifest SHA `d7da576b2b19dcc2560ffe986baaeb0237ce35bab9e2030d8bfaefb7712970a5` 保留。

## 脱敏验证记录及限制

逐日志SHA、环境、轮数及错误计数见 `docs/evidence/GLX_LIGHTING_VALIDATION_20261103.json`。重新解析了已有原始导出材料，没有连接设备。cloud JSONL 的每文件一条 `start time = ...` 是已知头行；除此以外解析失败为0。成功解析不证明日志系统从未丢失任何事件，也不代替人眼画面判定。

| 已有范围 | 实际条件和结果 | 证据边界 |
|---|---|---|
| nova 4 | VCE-AL00 / Android10 / 微信8.0.79 / SDK3.17.5 / GLX；新包8轮，三项异常计数均0，六行比较正常 | 日志身份完整；Claude报告和已保存截图显示阴影、透底均正常；4条RGBAFloat警告仍在 |
| iPhone16Pro | iOS18.3.1 / 微信8.0.75 / SDK3.17.6 / GLX；新包4轮计数均0 | 日志身份完整；截图/报告正常；4条RGBAFloat警告仍在 |
| 安卓云测第2轮 | 新包50条日志，SDK3.16.3 / 微信8.0.74 / GLX；每条98–136轮，三项异常计数0 | 平台归组45台/目录，原始model字符串46种，不据此独立推定物理设备数。Claude报告截图通过、首轮9个失败设备分组恢复；本次重解析印证自动比较结果 |
| 安卓云测第3轮 | 新包3条，103–104轮、同SDK/GLX，计数均0 | 仍有下面的shader错误，不是“无错误通过” |
| 安卓云测第4轮旧包 | 父包7条/6个model，SDK3.16.3 / GLX | 2511FRT34C、STK-AL00透底仍复现；这两型号尚无新包结果，不能顺带计通过 |
| iOS云测第2/3轮 | Claude保存的8张正常截图及后续13mini(iOS17.5.1)、13Pro(iOS18.5)正常报告 | 无可下载vConsole；运行身份不能按安卓日志强度确认；不并入有完整日志的设备数 |

阴影补丁的独立前序验证：候选 `claude-shadow-r04-fix-glx-cabe4ed0a16b9035`，WASM `e586b91a31835f2130246e7d61c24e2403c16d102f9898dceb791f14faea627e`。Claude记录iPhone阴影开启后受光区约255、投影约109，nova4未倒退，截图投影形状与原生参考相符。这是图像采样/视觉比较证据，不是GPU函数内变量直接测量。

未解决且必须保留：

1. `25098RA98C`、`2510DRK44C`、`MTN-AN00` 在新包第2/3轮及旧包对照都有启动shader链接错误，每日志2条。`V2536A`目前只在旧包日志看到，**不能写成四台均完成新旧对照**。变体和原因仍未知；画面比较正常不等于这些错误可忽略。
2. iPhone13mini(iOS15.0)、13ProMax(iOS15.1)新旧包均有云测截图/转述的越界崩溃报告，无完整iOS日志。能说旧包也复现，不能仅凭相同WASM序号断言相同根因、精确崩溃行或全局无回归。截图停在多灯行构建附近不是调用现场证据。
3. JSON解析问题、RGBAFloat警告等历史未解决事项不因本补丁消失。原始日志原位保留；脱敏摘要不筛改原文件。
4. 新引擎完整八项回归、真实游戏、稳定性、性能、干净重建及重建画面均未完成。以前“48台人工画面通过”属于当时候选，不能合并成此候选通过数。

## 许可、隐私和保存范围

新补丁保持Claude原字节和Godot MIT归属，沿用目录内 `LICENSE.godot.txt`；handoff已提交的 `79261350a3c9b11ba913e4961ad30d5fff316a0d` 只是Claude交接文档来源，并不表示本仓已合入补丁。

拟提交只包含源码补丁、指纹、只读核验工具和脱敏说明。没有AppID、账号、设备序列号、云测设备ID、会话标识、私有绝对路径、凭据、原始日志/截图、官方库或二进制。保留型号、系统/SDK、包身份、原文件哈希以便与私有原件关联。许可待确认的宿主资产/官方库不随本次重新分发。当前脏工作区中其他实验、旧报告及旧检查点修改不纳入本次范围。
