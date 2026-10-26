# 完整 Godot＋官方新库首开记录

后续用户另行批准的一次三点菜单重新进入已记录于[重进对照](GLX_GODOT_NEWLIB_REENTRY_20261026.md)。下文保留首开当时的结果与停止边界，原始证据未改。

## 本轮结论

用户反馈 `b47bf81d正常`。同会话完整 vConsole 已核对：指定候选、实际基础库 3.17.5、实际 GLX，场景和手动诊断均执行；本份日志未出现 shader 编译/绑定失败或原 shader 失败诊断。

但仍有一组 `Parse JSON failed. Error at line 0: Unexpected character`，后接 `core\io\json.cpp:629`。这是历史已登记的 GLX-10，不能称首开无错误通过。按本轮“首开报错即停”的约定，停在首开，不安排三点菜单重新进入。首开可见不证明原重进黑屏或 shader 类型错配已经修复。

## 版本、包和证据关联

| 项目 | 本次记录 |
| --- | --- |
| 候选 | `godot-official-glx-026e-a169d60be3d6db10c33c` |
| 会话 | `b47bf81d`，ENTRY、SCENE、MANUAL 一致 |
| 设备 | iPhone 16 Pro / iOS 18.3.1 / 微信 8.0.75 |
| 实际基础库 | 日志首行与设备 SDKVersion 均为 `3.17.5` |
| 实际模式 | SCENE 与 MANUAL 的 requested/selected/actual 均为 `glx` |
| 上下文证据 | contextPresent、canvasMatches、nativeContextIdMatches 均 true；loaderContextMatches 为 null，不补记通过 |
| 引擎 | 自构建 Godot `4.7.2.rc.custom_build.df3cdd9bc`，Emscripten 4.0.10 |
| 库 SHA256 | `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8` |
| 配套引擎身份 | `399b6522bd17f135087a669a9934ac68832efad837ad9fca418208a6dbbc316a` |
| 候选 manifest SHA256 | `10157ec424746065718eb0929d91c046e43c045ec09509206416d412dd2ed2d3` |
| 原始日志 SHA256 | `72b69e5867ebf9d808da89d33dc5d771fb3e27a3c1e6632f054b2492b766d542`，7,388 bytes、81 行 |

手动摘要的完整 identity 与本地封存 manifest 一致，封存包 27 个文件再次校验未变。库日志打印 `0.1.0 / 2026.09.02` 和“是否使用统一全局 ID : true”；这些是运行声明，不是准确发布版本、完整变更记录或共享 ID 根因证明。

用户获告知观察至少 20 秒，本次答复为“正常”。日志没有独立的持续时间或逐帧观测，不能另外补造精确时长、FPS 或连续验收次数。画面证据来源为用户反馈，无新增截图、进程取证或云采集。

## 错误与门禁

- 原日志第 21–22 行是一组 JSON 解析错误；不是两次独立错误。随后 SCENE、`Engine has started!`、MANUAL 均出现。
- `errors:[]` 只覆盖原 observer 的模式/context 检查，不收集全部引擎 printErr，因此不覆盖这组 JSON 错误。
- [既有交接核查](GLX_HANDOFF_AUDIT_20261023.md)已发现 UI 的 eval 返回后无条件解析 JSON，而固定微信实现可返回空 Variant。该代码缺陷有来源依据，但本份日志没有调用栈，不能唯一确认触发点，也不能用它解释历史 shader 失败。
- `nativeInitializationSuccess`、`completion` 仍为 `not_verified`，保留原值；不据此否定已观测到的场景，也不改写为完整 native 验收。
- 初次本地文本扫描把带有 `shader-type-return` 父包名称与 `errors` 字段的三条事件误匹配为 shader 错误；已缩小到明确编译/绑定错误及诊断标题后重算为 0，初次结果标记无效并保留本地。原日志、候选和手机均未改变。

## 本地保存及下一步边界

本地忽略目录 `.local/glx-godot-newlib-build-20261026-02/` 保留：

- `candidate-glx/`：冻结候选。
- `phone-first-open-preview-01/`：逐文件相同的独立预览副本、一次上传完整返回、二维码及配置核验记录。工具成功仅表示预览已接受；未下发或切换基础库。
- `phone-first-open-b47bf81d/`：原始日志副本、校验脚本、结构化 RESULT 及初次扫描无效记录。

旧完整包、原失败证据和构建记录继续保留。原始日志、私有配置、二维码、引擎和测试包不提交 Git。本轮没有修改宿主、PCK、引擎、库或默认 WebGL，没有新上传或手机操作。

目前可确认“完整自主构建 Godot＋官方新库在本次 3.17.5 首开有正常画面且实际 GLX”。JSON 错误尚在，三点菜单重进、强退、恢复、3D、音频及裁剪/分包均未由本轮验证。任何后续真机轮次另行明确确认。
