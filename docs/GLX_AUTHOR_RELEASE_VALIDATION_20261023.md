# 作者 GLX 发布包独立验收准备

本文件保留准备及早期验收过程；当前问题与后续决定以 [GLX 问题总表](GLX_ISSUES_20261023.md) 为准。作者正常表现仅作为参考，最新作者 pair 预编译替换候选已被用户拒绝，不能据下方历史待测计划继续推送；目标仍为自主构建、裁剪和分包。

本轮以作者完整发布包在用户 iPhone 上的兼容性为优先，不尝试 Gode，不将现有引擎继续加日志作为主线。起点为 `codex/glx-adaptation-20261022` / `8b59fe9`；fetch 后本地与远端一致、工作区干净。仓库及父目录仍无 AGENTS.md。既有默认 WebGL、GLX 失败包、赛车和服务器均不修改，不合并默认分支。

## 来源与静态检查

来源为 [hao0917/godot-minigame 的 4.7 release](https://github.com/hao0917/godot-minigame/releases/tag/4.7)，固定资产 `minigame4.7.0.8.1.tpz`，11,744,787 bytes。本轮重新下载，SHA256 `c4673dd16b397be7c6bcd0c9bd038d20008be5b4586cdaea60be552326a50be7`，与用户给值及 GitHub API 资产 digest 一致。发布说明的修复声明不是本机验收结果。

隔离目录为 `.local/author-glx-release-20261023-01/`：归档原件、GitHub release 元数据、23 项归档清单、逐文件哈希和 `upstream/` 原样解包副本均保留。解包前检查了路径越界、绝对路径和符号链接。仅用本地标准工具读取/解压字节及 JS 语法解析，没有 import、eval、实例化或执行作者代码。

| 配套文件 | bytes | SHA256 |
| --- | ---: | --- |
| engine/godot.js | 462596 | `12361da76c9702ed3d72ad8a4ea6ba4e9d930ee9de706d47039c6b38f8850644` |
| engine/godot.wasm.br | 8387016 | `ea554073f5c6357fada5fb65749ba38793137d46d5b0639180389df032fb1a4c` |
| 解压后的 WASM，仅内存静态读取 | 69484315 | `1929f30fd3d59497a5e49a0e2ef8a971cbeb9ec821d29c71720df4d9eaba3cfd` |
| engine/godot-sdk.js | 51322 | `f0f648b6778446a990b9865b8d577674f439348f8a3cef622e56ae13b8fda46e` |
| godot-loader.js | 17036 | `0e6bde33b9a63d3f452209838f0ef110a33890df8bc97fdedf25728bf00c03a4` |

7 项启动 JS 文件语法检查通过。WASM 二进制静态解析为 764 imports、42 exports，包含 `0.1.0`、`2026.09.02 14:34:05` 字符串；不由此推断配套库源码、好坏或修复原因，更不单独替换静态库。

作者启动链为 `game.js → weapp-adapter / glx-config / godot-loader → loadSubpackage("engine") → engine/game.js → godot-sdk / godot.js → GODOTSDK.startGame`。SDK 等待 init/preload 后清理加载页，再进入 Engine.start。作者原有 after-frame/native flush/batch/swap 路径保留。作者自带的微信 `engine`/`subpack` 目录不是本仓库 WASM 裁剪/分包，本轮不运行本仓库 trim、convert、split 或启动后处理。

作者依据能力位默认选择 GLX；能力不足可能选择普通 WebGL。因此必须读取实际运行时对象，不能把作者配置默认或能力位当作实际 GLX。现有 `GODOTSDK.engine.rtenv.ctx` 是当前上下文；其 `emscriptenGLX` 为描述符对象，按作者原有布尔语义判断 GLX。缺少实际 context 时为 unknown。GLX 的 `wxContextGlobal` 是描述符浅副本，不能用它与 ctx 的对象身份比较来报错。

## 已准备的最小差异与待运行文件

`candidate/` 为完整发布包的独立副本，`scene/` 为现有最小 Godot 场景的独立副本。准备状态是 **prepared-not-exported-not-run**，尚不是可预览验收包。

1. `project.config.json` 使用此前已确认的 AppID，项目名称改为独立验收名称；`project.private.config.json` 仅改显示名称。原作者 3.15.2 的项目基础库设置保留，实际手机微信/基础库另读，不能用此设置代替实测。实际 AppID 不写入公开文档。
2. 场景仅改验收标题、诊断接口名和日志前缀，删除本仓库自定义 `startup/gles3/skip_default_3d_prewarm` 设置；保留普通 Godot 色条、移动图案、2D/3D 视口、触摸和手动短音。没有导入赛车、启动宏或其他资产。
3. 待获准使用已安装的 Godot 编辑器导出该场景 PCK，替换 **候选副本内** `engine/empty-tips.bin`，保持作者 `engine/game.js` 入口及路径不变。原 `upstream/` 的 `.bin` 不改。当前候选仍含作者示例 PCK，禁止在替换、核对、封存前启动它。
4. 根 `game.js` 只新增一次 `author-acceptance` import。新增 `author-acceptance.js` 仅读取既有 runtime/ctx，显示与日志相同的包标识及会话短码，记录实际上下文、微信/基础库和设备；不新建 context、不做 GPU 查询、不包装 init/flush/swap/rAF。
5. `author-cloud.js` 使用已有 relay 和已确认环境，仅收 `PHONE_LOG_START` 与 `AUTHOR_ACCEPTANCE`，20 秒补 flush、60 秒停止。一次 entry、一次 scene-ready、手动摘要，以及 hide/show 各最多 6 条；没有新云函数、部署或服务端修改。60 秒后的原会话缺云日志不能计为失败或通过。

作者 `engine/godot.js`、WASM、SDK、loader、adapter、glx-config、engine/game.js 和 game.json 均与解包原件逐字节一致。`PREVIEW_PLAN.json` 列出改动，配置值仅留本地；新观察器用 GLX 描述符对象、WebGL、context 缺失三种 mock 检查，不加载作者代码。

需要具体批准执行的第三方文件为：根 `game.js`、`weapp-adapter.js`、`glx-config.js`、`godot-loader.js`、`engine/game.js`、`engine/godot-sdk.js`、`engine/godot.js` 及其配套 `godot.wasm.br`。内容入口使用新导出的自有验收 PCK；原示例分包保留但本场景不请求加载。作者 SDK 启动时会递归删除并重建当前 AppID 沙箱下 `__GAME_FILE_CACHE/audios` 音频缓存；更新管理器和微信分包下载也沿用原行为。未发现上述 JS 硬编码业务外传地址，但静态检查不构成完整安全保证。

## 批准范围与手机顺序

下一次申请仅覆盖：导出自己的最小场景、核对候选文件差异和最终 PCK/文件树哈希、运行本次固定作者文件、向当前登录微信的 iPhone 推送一次 GLX 候选预览，并使用已有 60 秒云日志及只读云查询；不发布体验版，不改服务器，不清理其他缓存。若导出或打包需额外改作者运行链，先停下说明。

手机首轮先确认实际 GLX、正常画面、触摸和短音，再优先单次重复“上滑结束微信后重新打开”，同时记录操作前后短码与微信/基础库。用户每次报告画面后才对照云会话；黑屏无短码时明确关联边界，不按初始化、swap 或时间猜测判过。失败保留现场并停止重试；初步正常后再安排同包至少 10 次退出重进、3 次前后台恢复，以及重复上滑结束微信后的冷重开检查。所有有限通过仅适用于所记录设备、版本和包。

若作者包稳定，再追查精确源码/库/参数与启动、提交差异，复现完整引擎后逐项加回我方改动；若作者包也黑屏，保留失败证据并转向原生 GLX 三角形对照，不盲抄或重试开关。

## 回退

本轮已重新核对两个旧包各 33 个文件，均匹配已有 seal，见本地 `ROLLBACK.json`：

- WebGL 可玩回退：`wxslim-b72eb259cb375ea4a221`，`.local/glx-full-loader-pair-20261023-02/webgl-on/minigame`；已有首次、重进正常反馈，不新增手机 WebGL 试验。
- GLX 旧故障基线：`wxslim-c15c28ef293ab29bff65`，同目录 `glx-on/minigame`；有正常会话，也有上滑结束微信后黑屏，不称为稳定包。

回退使用已封存目录重新推送，先核对 seal，无需重编或覆盖作者候选。手机换包仍须明确确认。本轮尚未执行任何预览或换包。

## 首轮手机反馈与云端核对

用户批准后已导出独立场景 PCK（SHA256 `b7f26680f9e3ee6a5734de8db308e8a78bce32b030c6772d8479285dadc690ea`），替换候选内容入口并封存文件哈希；auto_preview 返回 success=true。包标识 `author-4.7.0.8.1-c4673dd1-r01`，作者运行文件不变。上文未运行状态为准备阶段历史记录。

用户报告首次 `25354c4f` 正常、小游戏重开 `933f16da` 正常、关闭微信后重开 `a844daa3` 正常，并补充未记录的测试都正常。云快照 `cloud-01.json` 返回 19 批，包含 6 个短码；未报告短码的会话不推定视觉通过。

- `25354c4f`：画面正常来自人工反馈；本快照只有 entry/show 的早期记录，实际上下文尚 unknown，不能补记实际 GLX 已核实，也不能据此判定失败。
- `933f16da`：scene_ready 的 actualMode=glx，canvasMatches、loaderContextMatches、nativeContextIdMatches 均 true；与用户重开正常反馈匹配。
- `a844daa3`：同样匹配实际 GLX 与上述三项 true，并有新 entry/scene_ready；用户关闭微信重开后画面正常。此轮尚未单独确认“关闭”是否为后台上滑结束，不能据此完成强退冷重开验收。

三次记录设备均为 iPhone 16 Pro / iOS 18.3.1 / 微信 8.0.75 / 实际基础库 3.17.5。两次已配对会话证明真实 GLX 正常显示，并非静默回退 WebGL；未能确定准确次数的补充反馈不纳入连续 10 次退出重进或 3 次恢复计数。触摸、音频仍待明确反馈。尚不宣布稳定性最终通过或根因已确认。保持同包，下一步补充有记录的强退重开、普通重进与恢复；不新增预览、不换引擎。

## 从作者发布物到可复现源码构建的缺口

再次静态解压读取发布 WASM，取得内嵌 `Godot Engine for Wechat v4.7.2.rc.custom_build` 及完整提交标识 `df3cdd9bc9941a20cb5575d781cde6f937637bcb`；配套 JS 的 `_godot_js_emscripten_get_version` 返回 `4.0.10`。这与本项目旧构建的源码提交及 SDK 版本标识一致，但不能排除作者构建时的未提交源码变更、不同 SCons 参数或不同依赖。证据为本地 `version-strings.json` 与原发布 JS。

当前可以复现“使用固定发布包运行最小场景”，尚不能复现“从完整构建输入重新生成作者修复引擎”。所缺的关键输入：

1. 作者此次实际使用的 `libemscriptenglx_4.0.10.a` 原件、SHA256、官方下载来源，以及其对应 `0.1.0 / 2026.09.02` 标记的解释。现有旧库和 latest 下载不是该输入的证明。
2. 构建时完整源码 commit、工作树 patch、SCons 命令及最终链接响应。二进制内嵌 commit 不证明工作区干净。
3. 配套 JS 后处理脚本、Brotli 压缩步骤和版本，最好附生成 JS、原 WASM、压缩 WASM 的哈希及构建日志。压缩输出是否同字节与实际运行是否等价应分别判断。

拿到输入后，先在新目录构建未裁剪、未 WASM 分包、无本仓库启动优化的完整 JS/WASM，配作者原加载器/SDK及同一最小 PCK，申请预览后做同设备生命周期对照。只有这一步显示与重进稳定，才逐项加回转换器启动桥、补丁、裁剪、分包。当前两次实际 GLX 出画面的有限结果尚未完成稳定性验收。

在上述输入不足时，可保留 SHA 固定的作者完整发布包作为可复测基线；不能把替换单个库、重复旧构建、或者仅对照版本字符串称为重建成功。需要作者补充的资料仅先列在本地，没有发送 issue 或消息。
