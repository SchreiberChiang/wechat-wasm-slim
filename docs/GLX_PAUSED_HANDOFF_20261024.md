# GLX 暂停检查点与恢复入口

2026-10-24，用户要求先保存推送 GLX 成果，再在另一工作区研究 Metal。GLX 从此暂停研究：不追加探针、不重新构建或重开手机、不删除、不回退。恢复研究需用户另行指示。

## Git 状态与保存范围

- 独立分支：`codex/glx-selfbuild-20261023`；保存此交接的提交为本次最终检查点。
- 检查时本地 HEAD 为 `ceb4a9e`，工作树干净；fetch 后远端仍为 `e6df5cd`，本地 ahead 4、behind 0。待推送的既有成果为 `6fd337b`、`5803b1c`、`a49d25d`、`ceb4a9e`，加本交接提交；仅普通推送同名分支，不强推或合默认分支。
- 实际默认分支由远端 HEAD 和仓库 metadata 双重确认：`feature/wechat-wasm-slim`，`4e5c2f437108c23f5e430f49636844ca8af791d3`。本地默认分支未切换、未修改。
- 原工作区仍在 `codex/glx-adaptation-20261022` / `8b59fe9`。其中已有未跟踪 `docs/GLX_AUTHOR_RELEASE_VALIDATION_20261023.md`，本轮不改、不添加；它不属于本工作区待提交内容。

推送只包括已审查源码、测试、脱敏证据 JSON 和文档。原始日志、截图、云响应、设备认证、私有配置、引擎/测试包不进 Git。最终提交与普通推送回读结果在本地 `.local/glx-paused-checkpoint-20261024-01/` 单独保存，避免把提交自身哈希写进自身。

## 当前结论

最新包 `shader-type-return-glx-03fa0871dc99f85cc4a2`：首开 `ba727e5d` 两块白点正常运动，按钮输出完整手动摘要；用户结束微信重开后 `638674f8` 黑屏。两日志同包、实际 GLX。Godot 请求顶点 35633，GLX 同步 batch 原始 JS number 已是 35632，WASM 仍为 35632；本次数值转换解释被排除。源码完整一致，原编译错误关联。**GLX 黑屏未修复；共享 ID 冲突、平台实际编译对象/输入及底层 context 身份仍未知。**

电脑构建和测试不替代手机验收。完整包稳定性、10 次重进/3 次恢复、3D、音频、裁剪和 WASM 代码分包均未因此通过。公开句柄、初始化、场景回调、swap/FPS、空 errors 列表不能替代真实画面。完整问题继续见[问题总表](GLX_ISSUES_20261023.md)，最新证据见[原始 TYPE 真机记录](GLX_SHADER_TYPE_RETURN_PHONE_20261024.md)。

## 本地保留与恢复

原始材料根目录仍为本机原工具仓库的 `.local/`，以下路径相对于该根目录。目录存在已核对；不复制到 Metal，不清理旧 worktree。

| 目录 | 材料及恢复用途 |
| --- | --- |
| `author-glx-release-20261023-01/` | 已接受的作者正常参考包、原归档及来源/哈希；仅参照，非自主构建替代路线 |
| `glx-selfbuild-20261023-02/` | 早期完整自构建的固定源码/工具链/配套产物 |
| `glx-shader-failure-20261023-01/` | 第一版失败诊断、冻结 Emscripten SDK/cache、旧静态库、独立 `build-v2/`、正常/失败日志 |
| `glx-shader-type-return-20261024-01/` | 当前完整构建、8 个补丁输入、JS/WASM/Brotli、ABI/配对审计、WebGL/GLX 封存候选、本地回归 |
| `glx-shader-type-return-20261024-01/phone-validation-20261024-02/vconsole-audit-01/` | 本轮首开/强退原始日志副本、manual、shader failure、哈希与核对脚本 |
| `glx-engine-first-context-20261023-01/`、`glx-chinese-phone-20261023-01/` | 前期正常/失败包、加载页对照与手机证据 |
| `glx-handoff-audit-20261023-01/`、`glx-shader-id-audit-20261023-01/`、`glx-losomz-audit-20261023-01/` | 固定公共源码、上下文/库静态对照及 BUILD-01 证据 |
| `glx-author-pair-cn-20261023-01/` | 已撤回的作者替换候选；继续不运行、不推送 |
| `glx-paused-checkpoint-20261024-01/` | 本次工具回归、提交/推送回读与范围审查 |

恢复时先读本交接、问题表和最新手机记录，检查分支及封存哈希，再依 `engine/shader-type-return/README.md` 在新目录工作。不要原目录重复启动构建。手机恢复到旧正常包也属于换包，需另行批准。已有私有配置路径仅作本机引用，不公开凭据或设备路由。

## 本次必要检查

`node tests/run.mjs` 完成：84 个汇总项通过、0 失败；包含 BUILD-01、转换/分包与 WebGL/GLX 合同。未提供 Godot executable，headless 未跑，也未重编引擎或重测手机。此前配套审计、ABI 61/61 和真机失败仍按原记录保存。

已逐提交审查 4 个待推送提交的 40 条变更路径及内容。嵌套 `engine/shader-failure/native.patch` 的 Git 上下文空白会被外层 `git diff --check` 提示；这是冻结哈希补丁文件，保留原字节，不机械清理。新交接的暂存检查单独执行。BUILD-03 的 `.cjs` 通用续编覆盖缺口仍在问题表中，本轮不混入新修复。

Metal 工作区从上述稳定默认分支独立建立，不合入 GLX 整分支。通用构建修复只做必要性和依赖审查；未明确需要构建前，不搬运 GLX 初始化、黑屏诊断、库或渲染开关。
