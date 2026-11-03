# 19阶段与资源复用：待批准提交清单（2026-11-03）

状态：只整理、只核验，未暂存、提交或推送。当前分支 `codex/glx-godot-newlib-20261026`；HEAD及远端均为 `c957f7ba80b0326dbac699230e0f5467392e8221`。

以下是唯一白名单，共 30 个文件（1 个已跟踪文件修改，其余为新增）。建议作为一个自包含的场景收尾提交；未来仅普通推送当前分支，不合并主分支。不得按整个目录、`git add .` 或 `git add -A` 扩大范围。

## 精确文件范围

| 文件（相对仓库根） | 状态 | 用途 |
|---|---|---|
| `docs/GLX_REGRESSION19_CLOSEOUT_20261103.md` | 新增 | 脱敏结论、未验证项和性能暂停记录 |
| `docs/GLX_REGRESSION19_COMMIT_SCOPE_20261103.md` | 新增 | 本次精确白名单、排除项及待批准范围 |
| `docs/evidence/GLX_REGRESSION19_CLOSEOUT_20261103.json` | 新增 | 成对身份、载荷哈希、三轮操作与计时摘要 |
| `engine/alpha-preserve-lighting/.gitattributes` | 新增 | 仅本组固定源文件的换行字节保护 |
| `engine/alpha-preserve-lighting/README.md` | 修改 | 既有补丁入口增加本次收尾链接 |
| `engine/alpha-preserve-lighting/regression-checker.gd` | 新增 | 透明背景棋盘显示依赖 |
| `engine/alpha-preserve-lighting/regression19-README.md` | 新增 | 依赖来源、场景导出、两文件组包与回退流程 |
| `engine/alpha-preserve-lighting/regression19-audit.mjs` | 新增 | 配对、语法及日志转发核验，兼容新输入映射 |
| `engine/alpha-preserve-lighting/regression19-base.gd` | 新增 | 场景公共构造依赖，映射为renderer_base.gd |
| `engine/alpha-preserve-lighting/regression19-baseline-main.gd` | 新增 | 原6096场景源码原字节，保留耗时对照 |
| `engine/alpha-preserve-lighting/regression19-baseline-renderer.gd` | 新增 | 原6096场景源码原字节，保留耗时对照 |
| `engine/alpha-preserve-lighting/regression19-cases.json` | 新增 | 8页19阶段、中文验收目标与参考图映射 |
| `engine/alpha-preserve-lighting/regression19-closeout-audit.mjs` | 新增 | 新增只读核验；本轮实际执行 |
| `engine/alpha-preserve-lighting/regression19-display.gdshader` | 新增 | 右侧禁混合对照shader原件 |
| `engine/alpha-preserve-lighting/regression19-export-presets.cfg` | 新增 | 原Web PCK导出配置的准确模板 |
| `engine/alpha-preserve-lighting/regression19-font-NOTICE.txt` | 新增 | 现有未修改字体的许可归属声明 |
| `engine/alpha-preserve-lighting/regression19-font.json` | 新增 | 字体版本和哈希，不含字体二进制 |
| `engine/alpha-preserve-lighting/regression19-inputs.json` | 新增 | 源码映射、字体／参考图外部输入及SHA256 |
| `engine/alpha-preserve-lighting/regression19-light-alpha.gdshader` | 新增 | 既有R08不透明／半透明自定义灯光shader |
| `engine/alpha-preserve-lighting/regression19-light-opaque.gdshader` | 新增 | 既有R08不透明／半透明自定义灯光shader |
| `engine/alpha-preserve-lighting/regression19-main.gd` | 新增 | 复用版UI、三按钮、手动停留与分段计时 |
| `engine/alpha-preserve-lighting/regression19-main.tscn` | 新增 | 唯一主场景入口 |
| `engine/alpha-preserve-lighting/regression19-native.gd` | 新增 | 原生参考／19阶段布局和按钮核验，不入PCK |
| `engine/alpha-preserve-lighting/regression19-prepare.mjs` | 新增 | 新获准目录准备入口；仓库源映射，拒绝覆盖 |
| `engine/alpha-preserve-lighting/regression19-project.godot` | 新增 | 原场景工程配置的准确模板 |
| `engine/alpha-preserve-lighting/regression19-renderer.gd` | 新增 | 复用版场景参数与当前页资源生命周期 |
| `engine/alpha-preserve-lighting/regression19-reuse-audit.mjs` | 新增 | 原6096到9a6d的两文件待组包及核验入口 |
| `engine/alpha-preserve-lighting/regression19-reuse-native.gd` | 新增 | 既有复用／反向切换／参考区域核验工具，不入PCK |
| `engine/alpha-preserve-lighting/regression19-stage.mjs` | 新增 | 冻结父包派生的场景／PCK组包和身份校验 |
| `engine/alpha-preserve-lighting/regression19-visual.gd` | 新增 | 公共简图依赖，映射为visual_canvas.gd |

## 已提交、不重复纳入

- 灯光／alpha补丁、叠加顺序、成功构建配置及脱敏交付记录：`c957f7ba80b0326dbac699230e0f5467392e8221`。
- 原alpha恢复及启动规则已有提交，继续引用；未更改成功引擎。
- 本次依赖的 `engine/startup-prewarm/scene.mjs`、`docs/evidence/GLX_LIGHTING_DELIVERY_20261103.json`、`examples/glx-case4-alpha-mix/fonts/OFL.txt` 已跟踪且未变，不重复提交。

## 明确排除并保留

- 当前其他已跟踪改动：`.gitignore`、`docs/GLX_ALPHA_RESTORE_CHECKPOINT_20261101.md`、`docs/evidence/GLX_ALPHA_RESTORE_CHECKPOINT_20261101.json`。
- 所有其他未跟踪旧实验、探针、旧八项／两项脚本、存储核验工具和历史报告。
- `docs/GLX_REGRESSION19_PREPARATION_20261103.md`、`docs/GLX_REGRESSION19_RESOURCE_REUSE_20261103.md` 原始准备记录仍在本机；其阶段性NOT_RUN和私有路径不改写，本次以新脱敏收尾记录承接。
- 所有JS/WASM/BR引擎产物、PCK、官方静态库、作者二进制、完整字体、参考PNG、截图、QR、原始日志、私有配置、AppID、账号和凭据。
- 原6096包、9a6d准备文件、Claude成功引擎、历史回退和取证材料原地保留，没有删除或覆盖。

## 本轮核对与公开边界

- 白名单文本已扫描实际AppID、账号、私人绝对路径和常见凭据模式；人工复核必要设备型号／系统／SDK与包哈希可以保留，手机会话标识已移除。模式扫描不是对所有秘密形式的数学保证。
- 没有新引入第三方模型或贴图；字体只保存声明／哈希并引用既有OFL，库及作者二进制不公开。根仓库未见统一LICENSE，本轮不新授予许可证；通用开源许可及完整运行依赖分发仍待后续处理。
- 5个Node脚本语法与只读收尾核验通过。新增prepare输入映射逐字节验证通过，但本轮没有创建工程实跑；不是干净环境完整重建已通过。
- 31个原运行文件哈希、30项复用准备载荷、57项PCK及三份原始手机日志已重新核对。历史原生检查结果只核验，未重跑。
- 卡顿优化暂停；保留画面人工观察与计时边界，安卓复用版、完整微信电脑遍历及长期稳定性仍未测。

## 内容哈希

下表为本轮工作文件字节SHA256；本清单自身不作递归自哈希。固定场景输入由局部.gitattributes保持字节，普通文档换行遵循仓库规则。审批后提交前必须复核清单和差异，没有获准前不暂存。

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `docs/GLX_REGRESSION19_CLOSEOUT_20261103.md` | 5904 | `17ad486f5a1304bb45ebb30cf84767c836f004ddc75d80ad5ea3f424d71ca766` |
| `docs/evidence/GLX_REGRESSION19_CLOSEOUT_20261103.json` | 36715 | `e21af7ec71e05dc3880971561a2fc22adaab5758f6f41aa3d9d35e79a2a1165c` |
| `engine/alpha-preserve-lighting/.gitattributes` | 356 | `703a91909cff78a682b5b0fd8088c36f355f5b7d3917dd0c367fe6bb5e519db5` |
| `engine/alpha-preserve-lighting/README.md` | 4012 | `bce8267410eb01d94d6c9cd2d9b6a37e8e1d3d069743e1f3f997fdff60c28162` |
| `engine/alpha-preserve-lighting/regression-checker.gd` | 270 | `e1898ce4eddd0b770fbd5666f225a836daa603775f8f5820b60e31e7fe0a4bcc` |
| `engine/alpha-preserve-lighting/regression19-README.md` | 9573 | `278e1adf15f72d1c510520882cec36ce1d9e0c9f942610c88403151eab28c26f` |
| `engine/alpha-preserve-lighting/regression19-audit.mjs` | 5409 | `434459aae9489d8e97da594aae133adcbb6c79d78fb96291ac3420059adde2ea` |
| `engine/alpha-preserve-lighting/regression19-base.gd` | 12480 | `26710e1374bcf7a34007318430cde35c7d59bc4f831094fbdd6201496fa5458b` |
| `engine/alpha-preserve-lighting/regression19-baseline-main.gd` | 7911 | `0b4f2346baa7abb8bc15506dd3f175f4e6664ab7801d7ef634298b95417c8d9b` |
| `engine/alpha-preserve-lighting/regression19-baseline-renderer.gd` | 11821 | `c5b43b17324e576cd9f017d4160bba914b350793eb2ef4675c4f953d1547a38b` |
| `engine/alpha-preserve-lighting/regression19-cases.json` | 4450 | `c22bca6eee98bfd5b7f5495ee5d02d8d87519b7ea4abb0b91cd6b2d850e0ed12` |
| `engine/alpha-preserve-lighting/regression19-closeout-audit.mjs` | 8361 | `04689cb8ae29b88f8f046e088b664b856ecbfb82fb085b207984a3420d75026c` |
| `engine/alpha-preserve-lighting/regression19-display.gdshader` | 53 | `24c25ae4d723eb89daca07782cbe2d626f8adf94b33d039cc56662afb3629cbf` |
| `engine/alpha-preserve-lighting/regression19-export-presets.cfg` | 692 | `e2c714706bf1b8df3e128b3c0bde5c0c0b87d49a360d2110860eaf18907d6f9a` |
| `engine/alpha-preserve-lighting/regression19-font-NOTICE.txt` | 175 | `f3424b04f441cff9067138f07965fa8e0a768f5067cbae0a0ec2c054245a7c7c` |
| `engine/alpha-preserve-lighting/regression19-font.json` | 352 | `106907e34bc28b3ea15b5d95f3d9e8f6dcc40bd2ff29caccbceba8aafad8038d` |
| `engine/alpha-preserve-lighting/regression19-inputs.json` | 7795 | `094bc6511048536573a495cb21820ec40b20ee9a3a2d0b9a1a071b9e36120288` |
| `engine/alpha-preserve-lighting/regression19-light-alpha.gdshader` | 369 | `ffadba46815fb559c9c308e677fe9a5a43cdb09cd6862a8e4d93b0d0af0a6e7c` |
| `engine/alpha-preserve-lighting/regression19-light-opaque.gdshader` | 354 | `60d8071a344c5c458f68c0cd3ac1646853411755f77f7fa91e556b96ab6c2dd7` |
| `engine/alpha-preserve-lighting/regression19-main.gd` | 9603 | `cbd02bfd1af1b2d1f9c4cfc3f2dbdd0061095e52e24a02c60bf93dbef1999bf5` |
| `engine/alpha-preserve-lighting/regression19-main.tscn` | 294 | `4120b6bb16fdb63195122d602b461855965c30e08732c408c11d5ba49e004dfd` |
| `engine/alpha-preserve-lighting/regression19-native.gd` | 6817 | `a59e37721aced49f6bee098fbfc991709f97d428529dcb087e9cd12e80557a19` |
| `engine/alpha-preserve-lighting/regression19-prepare.mjs` | 3068 | `1255e2db58a611283dce28d7220fea4a6fa17a70886847e4b9b3b68db3e363f7` |
| `engine/alpha-preserve-lighting/regression19-project.godot` | 672 | `b4f8387f5b289c5f79d835a4424055bc64e5ad4ce743b086694ec18a81141d99` |
| `engine/alpha-preserve-lighting/regression19-renderer.gd` | 15170 | `ce35ca5150f42492d822ac453a6eb61301cd8ba6b00ae4f6c16669de31b8f152` |
| `engine/alpha-preserve-lighting/regression19-reuse-audit.mjs` | 7052 | `4f073faa62a9fe0a9d9edaca571ffd4be24519c45b8eeb0e72c82bcce2bf9c7a` |
| `engine/alpha-preserve-lighting/regression19-reuse-native.gd` | 11444 | `96ae8e32d8dd6b75d0290c85e97153684fb9651f738884b32827efae0428423b` |
| `engine/alpha-preserve-lighting/regression19-stage.mjs` | 7925 | `69e4771da1fb66aae732f121e2f8133ad88ae111e39e63d7dae5f5cd1888252f` |
| `engine/alpha-preserve-lighting/regression19-visual.gd` | 384 | `a751b2e243a0089d984be31a358ce3e4f081692929e1abb0025b4daef2171687` |
