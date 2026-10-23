# GLX 引擎核对与稳定性候选

最终目标是真机实际 GLX 显示与生命周期稳定，配置、初始化返回或 swap 增长不构成验收。2026-10-23 接续点为 `codex/glx-adaptation-20261022` / `d036fd3`，fetch 后与远端一致，工作区干净。仓库及父目录没有 AGENTS.md。默认远端分支是 `feature/wechat-wasm-slim`；不合并或发布。

本轮用户重新明确边界：电脑侧审计、独立候选及本地构建可继续；新手机预览、换包、手机操作及云部署必须说明具体改动后另获确认。此前预览授权不代替这一轮授权。保留全部历史包、原始日志、源码及 WebGL 回退。

## 已核实的实际构建链

| 项目 | 证据与身份 |
| --- | --- |
| 源码 | citizenll/godot `df3cdd9bc9941a20cb5575d781cde6f937637bcb`，源码 version.py 是自定义 `4.7.2.rc`；PCK 编辑器是 4.7.2，不能用包中显示的 4.7.2 代替源码 commit |
| 本地补丁 | 本仓库 `trim/patches/wx-startup-df3.patch`，SHA256 `feee723d33ac0b1d3a41467ad48a0b3fec99582393bd6fdaf633a56beab27724`，与旧构建 patch 相同，旧源码 reverse-check 成功；另有 Windows link response 适配 |
| SDK | Emscripten 4.0.10；SDK release 标记 `8103ffedfb0c42d231c6af6859a5a1a832260b43` |
| 原 GLX 库 | `libemscriptenglx_4.0.10.a`，4,088,602 bytes，目录标记 0.1.11 / 2025.12.05；SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a` |
| 原构建 | balanced profile；`threads=no wasm_simd=no use_wx_glx=yes dlink_enabled=no optimize=size`，thin LTO，startup trace/prewarm 两宏，initial_memory=32、stack_size=5120。**这是裁剪引擎的完整未分包，不是未裁剪基线** |
| JS 后处理 | 原 `godot_process.js` 保留 commit_frame 并包装 WebGL flush/commit；运行 `godot_process.js` 后取得 `.web_zip` JS/WASM，再交 convert 插入观察器、启动桥与官方 transformer |
| 原 JS | SHA256 `abd947013635a9f2f1c81049c7931a57f80647185757e3f39d77d103f8f0e582`，与原构建 stage `.web_zip` 一致 |
| 原 WASM | SHA256 `4872e5dda052f1ace3776eaa8ae2ffe4fbde025a4d1706dd5555e83295e9fc79`；原 GLX `70de`、WebGL `093c`、呈现 `1d8c`、绑定 `481c` 四包均已交叉核对 |

历史 BUILD.json 没保存全部编译器二进制哈希及最终 link response，不能倒造当时的位级重建证明。当前库字节、源码 patch、构建日志与包输入形成可追溯链；新构建应保存本次实际输入及输出哈希。审计原始数据放 `.local/glx-engine-audit-20261023/provenance/`，不提交原引擎或赛车私有文件。

上述 CLI 以外，固定源码 detect.py 还为 GLX 构建加入 `WECHAT_GLX_EXPERIMENTAL`、`CHECK_NULL_WRITES=0`、C++ exceptions、`SUPPORT_LONGJMP=emscripten` 和所需导出，并关闭 OFFSCREEN_FRAMEBUFFER。新基线保持这些既有选项；保留不代表已经证明相关 workaround 的内存安全或长期稳定性。

## 公开材料差异核对

| 合同 | 结果 |
| --- | --- |
| exact Emscripten 库、exceptions、longjmp、runtime/native exports | 现用源码已包含；实际链接日志指向 4.0.10 库 |
| getContext 后 glxInit，buffer/state 初始化，makeCurrent 后 contextId 更新 | 已包含；显式 GLX 生成包还将原始源码吞异常行为改为透传 |
| 加载页与引擎模式锁定、wxwebgl2 创建失败拒绝静默回退 | 已包含；本仓库有意保持 WebGL 默认，不采用社区按能力自动选 GLX 的默认策略 |
| 禁用 OFFSCREEN_FRAMEBUFFER、GLX-capable build 的 explicitSwapControl=false | 已包含 |
| C++ 按实际 runtime 模式选择 commit_frame | 已包含；GLX 跳过该提交，使用 native batch/swap。不能把 WebGL commit 包装误判为重复 GLX 提交 |
| 099277 上下文／交换修复 | 已由当前 df3cdd9 引擎包含；针对 GLX-capable 引擎普通 WebGL 回退，不是当前 GLX 黑屏答案 |
| resize 防护 | 缺少 resizeOffscreenFramebuffer 时已有守卫；但实际 `godot_js_display_size_update` 是 return 0，不能宣称主 canvas 动态 resize 已支持 |
| timestamp、NinePatch 等已公开兼容处理 | 已包含；不构成整屏重进黑屏的根因证据 |
| 加载页真正退场、native 重进旧状态、GPU 到显示画布交接 | 尚未解决；WXGameKit 1.3.15 实际加载器处于隔离插件，loader 标记返回不证明覆盖层消失 |

来源：[原生接入指南](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-emscriptenglx-native.html)、[固定 commit 的适配指南](https://github.com/hao0917/godot-minigame/blob/099277108e30c0af92bcbbbe7171fa073ae37606/skills/references/wxglx-adaptation.md)、[099277](https://github.com/hao0917/godot-minigame/commit/099277108e30c0af92bcbbbe7171fa073ae37606)、[引擎 df3cdd9](https://github.com/citizenll/godot/commit/df3cdd9bc9941a20cb5575d781cde6f937637bcb)。官方网页已通过直接 HTTPS 获取，快照和逐文件行号矩阵留在 `.local/glx-engine-audit-20261023/upstream/`。

### 库版本不能代替字节核对

官方指南给出的下载端点在本次核对时：

- 请求 `version=0.1.11`：ZIP SHA256 `7e6dd0b69e097575985265835fdf567895224f8e09c2fe29ba41f987d66bdb5c`，其中 4.0.10 库与现用库**完全相同**。
- 请求 `version=latest`：ZIP SHA256 `67eab09a17aa9005d515aef31b73d7fbed198bd574d9038ddae4ac511a37c619`，标记 0.1.12 / 2026.03.23，实际只含 `libemscriptenglx_3.1.51.a`，不含 4.0.10。不能用它直接替换当前工具链的库，也不能从这次下载推断不存在其他配套发布。

只检查官方静态库归档，不运行第三方预编译引擎。[相似 issue](https://github.com/godothub/godot-minigame/issues/12) 中有换库后仍复现、跳过加载页 GL 操作后仅部分显示的反馈；[模板 release](https://github.com/hao0917/godot-minigame/releases/tag/4.7) 则声称重新链接配套库修复。release 没给所用库 SHA256 或同包生命周期验收矩阵，这两类说法均不能替代本项目实测。

## 本轮电脑侧实施

1. 新增 `examples/glx-smoke/full-engine.gdbuild`，不禁用类或 build options。新工作目录 `.local/glx-full-baseline-20261023-01/build`，从固定源码克隆；原源码只读。
2. SDK upstream/node/python 与 SCons venv 已复制到本仓库独立目录，`.emscripten` 按新 SDK 根定位；EM_CACHE、TEMP/TMP、EMCC_TEMP_DIR 均在新目录。设置 PYTHONDONTWRITEBYTECODE=1，避免对原环境写 pyc。不改共享 trim 默认工具链或原缓存。
3. 本地已重编配套 JS/WASM。相同源码、库、startup patch、宏及优化策略，取消 balanced profile；构建调度为 4 个编译任务、2 个 thin-LTO 任务（原 8/4），这是本地资源限制，记录而不隐瞒。**此包是基线，不是已确认修复。**

可复现命令（私有 toolchain 必须明确解析至上述固定源码和独立 SDK）：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:EMCC_CORES='4'
$env:BINARYEN_CORES='4'
node trim/trim.mjs build --toolchain .local/glx-full-baseline-20261023-01/toolchain.private.json --profile examples/glx-smoke/full-engine.gdbuild --work E:/AI/wechat-wasm-slim/.local/glx-full-baseline-20261023-01/build --lto thin --jobs 4 --lto-jobs 2 --retries 1 --max-minutes 120
```

新输出不得覆盖旧目录。保留 BUILD.json、日志、编译器/库/源码哈希，完成后用原最小 PCK 或明确标注的验收 PCK分别生成完整 WebGL/GLX 包并 verify；不能给不同 PCK 的两包贴上“同输入”标签。

电脑侧配套改动已完成：

- `convert --loading-page on|off` 为显式对照选项，省略仍为 on。只切换官方 `loadingPage.using`；不动 visible/hideAfterCallMain、canvas、flush 或延时。该值参与 packageVersion，verify 核对实际产物与合同；旧合同未记录时明确提示，不能静默关闭加载页。
- 验收示例显示包版本、实际模式、由现有云 relay session 派生的短码，relay 停止后短码仍保留；没有 relay 时明确 local/no cloud，不上传新增身份记录。不通过读取接口推断画面通过。
- 新增手动 0.3 秒测试音，无自动播放。切换2D/3D、离屏尺寸和摘要按钮保持。新 PCK 为 `.local/glx-engine-audit-20261023/acceptance-02/glx-smoke.pck`，11,628 bytes，SHA256 `f6772ba180902c656993a9bbf2db67ed2f5ad6574db2752b03ddc6099f39ca32`；旧 PCK 全部保留。它是验收内容更新，不能与旧包混为单因素引擎比较。
- 工具全套含 Godot headless 为 62 汇总项通过、0 失败；新增配置/身份测试及源码和实际 PCK headless 检查通过。Web缺失接口时显示 Web/unknown，未误标成 Native/headless。均非真机画面、触摸或音频验收。

当前尚无本轮新真机验收；未发预览或执行云部署。完整引擎和真实转换结果见下节。

另已完成默认 WebGL 的真实转换回归：沿用原 balanced JS/WASM，配新验收 PCK，未传 render-mode 或 loading-page，得到 `wxslim-1e112800a6f6a99a3db5`，合同为 webgl/on。verify 38 通过、1 注意、0 失败；注意为未执行官方 split init。此包位于 `.local/glx-engine-audit-20261023/webgl-regression/`，仅作转换器默认行为回归，不是新未裁剪候选或手机验收。

## 已完成的未裁剪引擎与本地对照包

构建于 2026-10-23 03:55:42 UTC 完成；SCons 编译/链接/优化 44.61 分钟，单次尝试，保留 46 个模块。随后完成既有微信 JS 后处理及 Brotli 压缩。日志中有 WebXR 对内部 MainLoop 的依赖警告和工具的 no-output 提示；SCons、后处理和最终构建均正常退出，未把警告隐藏或当成手机兼容性证明。符号表仍只有约 1% 可读名称，影响 C++ 名称定位，不据此重编或宣称官方分包已通过。

| 产物 | bytes | SHA256 |
| --- | ---: | --- |
| godot.js | 436815 | `25b1bf16d4e3134c0afc44d8b8bb98503504f06cadab52315c2397532cb35403` |
| godot.wasm | 65244197 | `a737f72a7ec371ca9489dfeb2293b10733fa69cdce4e3ea354f18eb2d65be424` |
| godot.wasm.br | 8671918 | `ae859fb9715cc5120599f6983fd752298b038451b381c13ffdd1d98c5b44f6ba` |

12 项输入哈希与构建前记录一致。只为检查导入/导出而用 Node 编译 WASM Module，未实例化或运行。JS 中 `_glxInit`、`_glxInitBufferDataAndGlState`、`_glxUpdateContextId`、`_glxCommandBufferFlush` 分别映射到 WASM `$m`、`an`、`_m`、`bn` 函数导出；原有 registerAfterDoFrame → native flush → batchRenderAsync → 有 drawcall 时 swapWindow 的路径仍在。上下文模式校验和 WebGL commit 包装也保留。源码差异、链接响应、优化命令、输入/输出核对脚本及结果放在 `.local/glx-full-baseline-20261023-01/provenance/`。

三包使用这同一份引擎、新验收 PCK 和同一接口字节，保留现有 60 秒有界云 relay，只采既有 boot/初始化摘要；没有新 GPU 查询、画布 PNG 导出或帧计数包装。没有部署或修改云服务。转换参数共同部分为新 JS/WASM/symbols、验收 PCK、同一 interfaces 与包名；分别追加 `--render-mode glx --loading-page on`、`--render-mode glx --loading-page off`、`--render-mode webgl --loading-page on`。

| 用途 | 包版本 | 最终 minigame 文件树 SHA256 |
| --- | --- | --- |
| GLX，加载页开 | `wxslim-c15c28ef293ab29bff65` | `f08bd3e1d053d5b362866353d29af9bf421413884e3cfab09864dc4f392fc266` |
| GLX，加载页关 | `wxslim-c1c46013faf605d4fb56` | `690120448176e58c097eec95bb24a51bbccc263865facfd67165d90a75b8595d` |
| WebGL，加载页开 | `wxslim-b72eb259cb375ea4a221` | `e9895082c7a41c0cac1775871ec9dc929e44b60950575b7ec3049bb60d9af875` |

原始转换目录为 `.local/glx-full-loader-pair-20261023-01/`。首轮严格配对检查发现官方工具的 `project.convertPluginVersion` 自动填入了不同转换时间戳，**因此原始输出不能称为仅加载页开关不同**。保留原目录，使用其中 `derive-fixed-pair.mjs` 复制到新目录 `.local/glx-full-loader-pair-20261023-02/`，在首次预览前仅统一该字段为第一包的 `202610230357`。DERIVATION.json 保存字段变更和前后哈希；包版本未包含这一自动时间戳，实际发包身份还必须核对上表文件树 seal，不能仅看版本字符串。

最终三包再次 verify，各为 38 通过、1 注意、0 失败；注意仅为官方 split init 未执行，该动作会上传新 WASM，仍需另行授权。GLX 两包 33 个文件逐字节比较，仅 render-config.js、render-config.json、wx-game-kit/config.json 不同；清除包身份/加载页记录差异后配置一致，插件配置只差 `loadingPage.using`。引擎、WASM、PCK、适配器及接口输入哈希一致。`pair-audit.json` 与 `package-seal.json` 保存结果，不能替代手机画面证据。

新增 `summarize-acceptance.mjs` 仅离线读云快照，把会话对应到游戏短码；碰撞、混包、冲突、已知分页/截断时拒绝自动匹配，永远不自动判视觉通过。含新增读取测试的全套本地测试为 65 项通过、0 失败（含 Godot headless）。当前 GLX 稳定性、真机恢复、裁剪和官方分包验收均未完成；下一步只在用户确认后使用 `-02` 内已锁定的候选。

## 有界对照与验收顺序

目前没有发现可直接解释现象的必要引擎修复缺失，不盲目重新应用补丁或升级不匹配库。

1. 未裁剪、未分包 Godot 基线，固定库与启动策略；保留 WebGL 对照。
2. 同输入 GLX 的加载页 on/off 对照，仅改变官方 loadingPage.using，保留 context、flush、延时、画质等。预期：若只有 off 在重进保持正常，定位向加载页/引擎交接收敛；若均失败，不能排除 native 提交问题；若均正常，也不能声称关闭加载页修复。
3. 若上述仍不区分，制作链接同一 GLX 库的极简 WASM 绘制对照；纯 JS wxwebgl2 不覆盖 WASM 静态库的指令转换，不能冒充该对照。一次只换一项，不无限试开关。
4. 候选真机验收至少连续 10 次退出重进、3 次前后台恢复，冷启动、2D/3D切换、触摸与音频；实际 GLX + 真实画面每轮均需证据。显示包/会话标记，与云端同源，不再依靠回忆分钟数；黑屏读不到标记时记录为待关联，不能强配。
5. 最小完整包稳定后才进行裁剪与官方分包；新 WASM 的 init/采集/upload 均需另获授权，本地测试不替代这些验收。失败保留，不通过重试抹除。

最终若仍指向闭源边界，应提交最小复现和两个具体问题：同一 GLX context 经加载页再交接引擎时要求何种状态隔离；当前 Emscripten 4.0.10 有无经验证的配套库及可核对 SHA256。不能要求用户盲试不匹配归档。

极简 native 对照的具体约束已核查：除三项初始化导出，还需 `_glxCommandBufferFlush` 和库自己的 after-frame hook；采用 `glDrawArrays` 三角形而非仅 clear，因为已生成 glue 只在 drawcall>0 时执行原 swapWindow。不能在主实验里手工拼命令缓冲或额外强制 swap，否则无法判断库的自然提交路径。

备选源码和固定输入构建配方见 `examples/glx-native-triangle/`。已通过 C++ 语法、PowerShell 解析、JS 语法和 recipe-only 输入哈希校验；独立复核后修正 Python 选择、pyc 写入及环境覆盖 frozen cache 的问题。未链接、未生成或运行微信包，非 Godot 输出的宿主接线仍未实现；仅在加载页对照不能区分问题时继续，不提前扩大真机实验。
