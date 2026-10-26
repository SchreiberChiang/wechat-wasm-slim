# 官方新库完整 Godot：现有成果检查点

保存范围：`godot-official-glx-026e-a169d60be3d6db10c33c` 的自有审计源码、测试、脱敏结果及依赖指纹。当前工作分支为 `codex/glx-godot-newlib-20261026`，整理时基点是 `28c4f2eff2d98451193470a808aba8e1348399c6`。本文不宣称已提交或已推送；最终提交号与推送回读应在执行后另行报告。

**先保存现有成果，三个干净重建缺口另行处理，不作为本检查点提交或私有备份的前置条件。** 本次没有引擎重编、改渲染、运行 WebGL 对照或手机测试。

## 可公开保存的 13 个文件

1. `engine/official-glx-library/audit-diagnostic-abi.cjs`
2. `engine/official-glx-library/audit-diagnostic-abi.test.cjs`
3. `engine/official-glx-library/audit-linkage.cjs`
4. `engine/official-glx-library/audit-linkage.test.cjs`
5. `docs/GLX_ISSUES_20261023.md`
6. `docs/GLX_GODOT_NEWLIB_BUILD_20261026.md`
7. `docs/GLX_GODOT_NEWLIB_REBUILD_20261026.md`
8. `docs/GLX_GODOT_NEWLIB_FIRST_OPEN_20261026.md`
9. `docs/GLX_GODOT_NEWLIB_REENTRY_20261026.md`
10. `docs/GLX_GODOT_NEWLIB_EXTRA_RUNS_20261026.md`
11. `docs/GLX_GODOT_NEWLIB_ANDROID_20261026.md`
12. 本文件。
13. `docs/evidence/GLX_GODOT_NEWLIB_CHECKPOINT_20261026.json`。

四个源码文件是本专项的静态审计实现和测试 fixture，不打包 GLX 静态库、第三方宿主实现、生成引擎或解析器依赖。对接口名、消息、初始化模式的匹配及最小测试片段不意味着获得所检查资产的再分发许可。文档和 JSON 仅记录必要事实、指纹和公开来源，不包含原日志正文、账号、实际 AppID、二维码、密钥或个人用户名。ABI 测试保留既有三个非个人化项目测试默认路径；这不是可搬移构建承诺，外部材料不存在时部分集成测试会 skip，不能算作通过。

本次不提交 `admission-026e.json`、`admit-candidate.mjs` 和其测试：它们是绑定私有现场的精确门禁，原字节单独备份。未验证的 `stage-webgl-control.mjs` 和测试、完整保存审阅草案及混合 A/B 的 preservation JSON 也不进入这 13 文件检查点。

## 已有验证边界

- 完整自主源码构建使用 Godot `df3cdd9bc9941a20cb5575d781cde6f937637bcb`、Emscripten 4.0.10、构建驱动 Node 24.18.0；只替换官方附件库为 `026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。具体构建参数和审计见[完整构建记录](GLX_GODOT_NEWLIB_REBUILD_20261026.md)。
- iPhone 16 Pro / iOS 18.3.1 / 微信 8.0.75 / 实际 3.17.5 / GLX：首开、一次菜单重进和用户补充的三种重开有同包日志及正常反馈。用户另报告 iOS 3D 正常；不强行归到没有明确记录的会话时间点。
- VCE-AL00 / Android 10 / 微信 8.0.79 / 实际 3.17.4 / GLX：用户报告 2D 与所试重开正常，3D 模型不可见。保留一份安卓导出会话，不补造逐轮操作。
- `Parse JSON failed`、浮点纹理警告、安卓 3D 和稳定性验收边界保留。未证明旧故障根因、全设备稳定、裁剪或 WASM 分包通过。
- WebGL 对照仅已组包及静态测试，未运行；其代码、包、哈希和测试结果不列入本成功接入检查点。

## 私有备份和恢复索引

获准备份后，备份根目录应包含 `PRIVATE_INDEX.json`、`FILES.sha256.json`、复制核验结果以及本分支 Git bundle。`PRIVATE_INDEX.json` 记录源路径到备份路径映射；公开报告只保留 `.local/<证据目录名>` 这样的逻辑标签，不要求公开个人磁盘路径。

私有备份保存本次成功构建、两个中断/失败对照、配套 JS/WASM/BR/符号、PCK、准确 SDK/Node/Python、原库及新库供应附件、作者宿主归档、历史自有组包脚本、原始手机与上传证据、当前未提交工作区快照。未验证 WebGL 另放 `B-unverified-webgl/`，不得写成成功验收。备份未执行前不标记完成；复制完成也必须逐文件校验。

新 GLX 附件和作者宿主资产再分发许可仍未确认，只私有保存。本次公开检查点不包含这些资产，也不因这项未知推迟保存自有源码与脱敏记录。源码与测试继承本项目现有管理方式，不擅自添加新的整体开源许可证。

## 三个后续任务（不阻塞本次保存）

1. **宿主生成链**：把历史 `.local` helper、准确 observer/入口/loader 差异整理为明确的可搬移组包输入；不能静默换为不同模板。
2. **准确工具链获取**：锁定成功构建实际 SDK、驱动、Python 与安装来源；现有 bootstrap 并非相同配方。原工具链先按字节私有备份。
3. **PCK 导出环境**：补齐原编辑器身份及干净导出验证；当前已验证 PCK 原件先保存，不用未验收的新导出替换。

## 体验版与 Git 分开记载

**你报告已手动上传，后台指向尚未核验。** 自动上传曾 pending，后续查询任务丢失，自动任务结果 UNKNOWN；这不否定用户手动操作，也不证明后台已更新。手机运行日志、体验版上传、Git 提交推送分别核验。
