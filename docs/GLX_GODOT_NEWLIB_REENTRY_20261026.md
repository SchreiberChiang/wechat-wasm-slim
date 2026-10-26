# 完整 Godot＋官方新库：一次三点菜单重新进入

用户在首开记录后另行批准：沿用同一候选和基础库，仅做一次三点菜单“重新进入”，观察至少 20 秒，正常或失败均保存后停止；已有 JSON 解析错误单独保留，不混入修复。本轮反馈为 `9c028fd7正常`，并提供完整 vConsole 导出。

## 同包对照结果

| 项目 | 首开 | 本轮三点菜单重新进入 |
| --- | --- | --- |
| 启动标识 | `b47bf81d` | `9c028fd7` |
| 用户画面反馈 | 正常 | 正常 |
| 实际基础库 | 3.17.5 | 3.17.5 |
| 实际渲染模式 | GLX | GLX |
| 引擎、场景及手动诊断 | 均有记录 | 均有新启动标识下的记录 |
| shader 编译/绑定错误或失败诊断 | 本份日志未见 | 本份日志未见 |
| JSON 解析错误 | 一组、两行 | 相同一组、两行 |

两轮均为 `godot-official-glx-026e-a169d60be3d6db10c33c`，iPhone 16 Pro / iOS 18.3.1 / 微信 8.0.75。ENTRY、SCENE、MANUAL 的候选、设备和启动标识分别一致；本轮手动摘要完整 identity 与冻结 manifest 相同。

启动标识变化，且重新出现 engine init、Godot 引擎标识、GLX 初始化、SCENE 和 MANUAL，支持本轮确有新的启动记录；**不由此证明微信 OS 进程重建或底层 GLX context 身份变化**。不是强退微信测试。

用户按本轮观察流程回复“正常”。画面与持续运行结果依据用户反馈；日志没有独立逐帧/时间测量，不补造精确持续时长、FPS、截图或多轮通过次数。

## 核验和保全

- 实际版本由 `Wechat Lib:3.17.5` 和设备 `SDKVersion:3.17.5` 双重记录；不使用项目配置的 3.15.2 代替手机实际版本。
- SCENE、MANUAL 的 requested/selected/actual 均为 `glx`；contextPresent、canvasMatches、nativeContextIdMatches 均 true。未将 WebGL 回退计为正常。
- `loaderContextMatches:null`、nativeInitializationSuccess/completion 的 `not_verified` 原样保留。摘要 `errors:[]` 不能覆盖引擎输出的 JSON 错误。
- 本轮原日志第 21–22 行为 `Parse JSON failed. Error at line 0: Unexpected character` 与 `core\io\json.cpp:629`，与首开文本相同。GLX-10 保持独立未修，不把本轮写成无错误通过。
- 新库 SHA256：`026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。
- 配套引擎身份：`399b6522bd17f135087a669a9934ac68832efad837ad9fca418208a6dbbc316a`。
- 冻结候选 manifest SHA256：`10157ec424746065718eb0929d91c046e43c045ec09509206416d412dd2ed2d3`；27 个文件重新校验一致。
- 本轮原日志 SHA256：`639fa66b5b6c77d57eaa3de0fbc08b2e4385fb647539958e9450fc9b8fd2526b`，7,388 bytes、81 行。
- [首开记录](GLX_GODOT_NEWLIB_FIRST_OPEN_20261026.md)及其原日志哈希保持不变。

本轮原始日志、`verify-log.mjs` 和 `RESULT.json` 保存于主仓库忽略目录 `.local/glx-godot-newlib-build-20261026-02/phone-menu-reentry-9c028fd7/`。旧包、首开日志与所有失败证据保留；原始日志及包不提交 Git。

## 结论与停止位置

已取得“完整自主构建 Godot＋官方新库在实际 3.17.5 / GLX 下，首开及一次三点菜单重新进入均由用户确认正常”的同包证据。本次操作未复现旧故障，但不证明旧故障根因、共享 ID 因果或整个 GLX 稳定性已经解决。

本轮到此停止，没有追加重试、上传、换包、清缓存、改配置、切基础库、修代码或代理操作手机。强退微信后重开、前后台恢复、连续多轮、3D/音频及裁剪/分包仍待分别验收，不由此次结果补记通过。
