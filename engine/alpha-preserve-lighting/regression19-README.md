# 19阶段场景、资源复用与组包保存点

此处保存一个主场景、八页十九阶段的自有文本源码和审计入口。原版候选为 `selfbuild-alpha-regression19-glx-6096c12a3ef5cda65ffd`；资源复用版为 `selfbuild-alpha-regression19-reuse-glx-9a6d5bc8dd94f1813ed9`。后者只改两份运行时GDScript，不改引擎、库、材质效果、验收条件或参考图。性能工作暂停。

## 文件与依赖

- `regression19-main.gd`、`regression19-renderer.gd`：已测资源复用版，和本地场景／PCK中的源码字节一致。
- `regression19-baseline-main.gd`、`regression19-baseline-renderer.gd`：从原版保存记录恢复的两个原始文件，核对了原PCK；部署时仍使用没有 `baseline-` 的运行时文件名。它们只用于保留耗时对照，不会同时进入PCK。
- `regression19-main.tscn`、`regression19-cases.json`、两个 `regression19-light-*.gdshader`：主场景、十九阶段目标及自定义灯光材质。
- `regression19-base.gd` → `renderer_base.gd`、`regression19-visual.gd` → `visual_canvas.gd`、`regression19-display.gdshader` → `display_ignore_alpha.gdshader`、`regression-checker.gd`：必要公共依赖。最后显示的右侧材质仍为禁混合对照，不是通用alpha修复。
- `regression19-project.godot`、`regression19-export-presets.cfg`：现有场景的准确配置，组装时映射为 `project.godot` 和 `export_presets.cfg`，没有工作区绝对路径。
- `regression19-inputs.json`：上述映射和SHA256、十九张参考图及字体的准确哈希。相对仓库路径由脚本定位，不依赖私有 `.local` 配置。
- 字体是未修改的 Noto Sans SC Regular 2.002，8,482,020字节；SHA256为 `a2b93e6c2db05d6bbbf6f27d413ec73269735b7b679019c8a5aa9670ff0ffbf2`。字体二进制不提交；保留NOTICE、元数据，并引用仓库已有的 `examples/glx-case4-alpha-mix/fonts/OFL.txt`（SIL OFL 1.1）。本轮没有验证可下载到同哈希字体的公开地址。
- 十九张参考PNG取自固定原生编辑器的Windows OpenGL画面，二进制仍在私有场景中；它们不是手机GLX证据。需要按哈希提供原图，或在获准的环境中重新生成并建立新的参考记录，不能以不同GPU新截图冒充旧图。
- 微信宿主、成对JS／WASM及压缩WASM来自 `docs/evidence/GLX_LIGHTING_DELIVERY_20261103.json` 记录的冻结父包。此提交不携带这些二进制、官方GLX库、AppID或私有配置；不可仅复制WASM或混配别的JS。

运行引擎为 `4.7.2.rc.custom_build.df3cdd9bc`，固定源码 `df3cdd9bc9941a20cb5575d781cde6f937637bcb`，Emscripten 4.0.10。PCK编辑器为 `4.7.2.stable.steam.ed1daf0bf`，工具脚本使用Node 24.18.0。引擎配对、026e库及补丁顺序沿用已提交的灯光保存点。保留官方 `return 0`，没有32768覆盖或UI alpha兼容。

`.gitattributes` 只保护本组参与哈希的文本字节，防止自动换行转换改变PCK输入；未改变引擎文件或仓库全局规则。自有场景不包含作者模型、贴图或引擎源码副本；纹理由程序生成。Godot衍生补丁的既有MIT声明和字体OFL声明继续保留；完整引擎／官方库公开分发许可及仓库统一开源许可不在本轮作出新授权。

## 当前工作目录的特殊状态

已批准的小目录中，`scene/` 是资源复用版；`minigame/` 已恢复原版6096的31个文件。复用版PCK和身份脚本在 `evidence/regression19-reuse.pck` 与 `evidence/reuse-candidate-mode.js`。这是有意保留的对照状态，不能直接把当前 `minigame/` 上传并称作9a6d。

原始 `INPUTS.json`、`SOURCE_MANIFEST.json`、手机日志和原始准备／上传记录不被改写。早期记录中的 `NOT_RUN` 表示当时尚未测试；后续结果追加到本次收尾记录，不篡改历史。

## 只读复核（本轮已执行）

从仓库根目录运行：

```powershell
node engine/alpha-preserve-lighting/regression19-closeout-audit.mjs
node engine/alpha-preserve-lighting/regression19-closeout-audit.mjs $ApprovedExistingRoot
```

第一条只核对仓库文本闭包与十九阶段定义；第二条还读取已批准目录的冻结运行文件、待组包两文件、PCK、原生检查结果，以及私有记录指向的三份原始手机日志。它不写文件、不加载引擎、不实例化WASM、不上传。第二条依赖已有私有取证材料，不能当作公开干净环境入口。

## 场景准备／导出流程（本轮不执行）

以下会写入工作目录，未来必须先获得目录与空间批准；不要对冻结包或当前保留目录运行 `prepare` / `stage`。

1. 提供权威清单匹配的冻结10914父包和已验证的字体／参考图资产目录。保存自己的AppID只在私有运行配置中，不写入公共清单。若使用新的AppID，配置哈希及候选身份会变化，不能再声称历史候选逐字节相同。
2. `node engine/alpha-preserve-lighting/regression19-prepare.mjs $NewApprovedRoot $FrozenParent $VerifiedAssetScene baseline`。选 `reuse` 则用当前复用源码。该入口拒绝已有目标目录，先逐个验证输入再写出；不复制引擎源码、SDK或构建缓存。收尾中把自有依赖从旧私有场景改为仓库映射，已核对映射字节与语法，**未新建目录实跑这个新入口**。
3. 使用固定编辑器导入场景和导出PCK，不重编引擎。等价命令为：

```powershell
& $GodotEditor --headless --path "$NewApprovedRoot/scene" --editor --import --quit
& $GodotEditor --headless --path "$NewApprovedRoot/scene" --export-pack Web "$NewApprovedRoot/evidence/regression19.pck"
```

4. 原生参考／布局工具在仓库外于场景目录作为 `--script` 指定，不能复制进场景后导出：`regression19-native.gd` 使用 `--reg19-check --reg19-output=<evidence>`；加 `--reg19-references` 才写参考图。需要渲染窗口，不能用headless结果伪装画面验证。复用检查用 `regression19-reuse-native.gd`，依赖原版 `native-verify.json` 和十九张原参考。原生记录的工具／GPU环境必须保留。
5. `regression19-stage.mjs $NewApprovedRoot glx` 只从冻结父包派生身份和观察日志，核验PCK及配对；`regression19-audit.mjs $NewApprovedRoot` 验证配套与日志转发。后者对旧INPUTS和新仓库映射均兼容。WebGL检查只能选 `webgl`，不能写成GLX通过。
6. 全流程输出将有自己的候选身份。是否与历史PCK逐字节相同取决于导出及资源导入结果，需要实测，不保证确定性构建。本次没有验证干净克隆完整复现。

`regression19-reuse-audit.mjs` 是原6096→9a6d的专用核验／待组包入口：`check`验证原包、两份源码及历史原生记录；`pack`在核验后写出准备文件，并不自动覆盖运行目录。它必须保留对应的私有 `REUSE_BASELINE_20261103.json`，不是对任意场景通用的优化工具。

## 9a6d实际组包与回退顺序

这一流程已经用于一次成功开发预览，下面保存原流程，不在收尾中重新执行。

1. 逐条核验原6096的31文件、复用PCK、身份文件及私有项目配置；AppID匹配获准父包，配置不改。
2. `REUSE_ROLLBACK_6096.json` 只保存旧身份脚本／候选清单的原字节和原PCK来源；原PCK已经保存在 `evidence/regression19.pck`，不另复制工程。
3. 在同一个获准运行目录临时替换 `engine/empty-tips.bin` 和 `candidate-mode.js`；据实际30个payload重算 `CANDIDATE.json`。两项运行载荷变化、第三项仅清单变化。引擎／宿主其他文件逐字节不变。
4. 校验实际提交的30文件及清单，正常预览一次；保存终态、体积及配置未变证据。预览上传成功不等于真机画面通过，也没有更新体验版。
5. 预览后再核对上传载荷，再恢复上述三个原文件，检查原31文件无增删且哈希全部一致。QR、AppID、回退原字节及完整日志只保留本机。

历史工具调用由已有预览工具完成；此次没有新增上传器，也没有把上述步骤自动连到上传。包清单与成功记录见公开脱敏JSON，其余必要私有资料需保留。

## 验收与已知限制

界面仅有“上一项／切换阶段／下一项”，阶段手动停留，十九阶段不由 `autotest` 自动推进。R01三阶段、R02两阶段、R03三阶段、R04两阶段、R05两阶段、R06两阶段、R07两阶段、R08三阶段。画面参考标明原生Windows OpenGL来源；创建、日志或绘制回调不自动判通过。

原6096：iOS实际3.17.6、安卓实际3.17.5的GLX记录各覆盖十九阶段，用户整体反馈基本正常。9a6d：iOS实际3.17.6覆盖十九阶段，反馈画面正常但仍有卡顿；安卓复用版未测。未取得逐阶段人工结论，不补造十九个视觉PASS。

复用仅当前页相同结构：懒建并保存两份红片材质、最多四盏灯，参数切换复用对象；跨页或结构变化仍重建。既无启动预建所有页面，也不把等待转移到启动宣称改善。原生19状态、27次重复操作、38对实时区域比较来自既有检查；本轮只重新核验记录与哈希。

手机等待指标为切换开始到 `frame_post_draw` 回调，不等于实际屏幕呈现、GPU或shader编译耗时。同页部分切换更快，跨页和首次阴影等待仍长；记录中有变慢项。仅有一次非受控对比，不能宣称总体提速或卡顿解决。原有四次RGBAFloat转换RGBAHalf警告不隐藏，后续性能工作暂停。
