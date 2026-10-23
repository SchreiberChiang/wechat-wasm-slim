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
3. 本地正在重编配套 JS/WASM。相同源码、库、startup patch、宏及优化策略，取消 balanced profile；构建调度为 4 个编译任务、2 个 thin-LTO 任务（原 8/4），这是本地资源限制，记录而不隐瞒。**此包是基线，不是已确认修复。**

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

当前尚无本轮新真机验收；未发预览或执行云部署。完整引擎编译完成后，真实转换/verify 和对应产物身份仍需补记。

## 有界对照与验收顺序

目前没有发现可直接解释现象的必要引擎修复缺失，不盲目重新应用补丁或升级不匹配库。

1. 未裁剪、未分包 Godot 基线，固定库与启动策略；保留 WebGL 对照。
2. 同输入 GLX 的加载页 on/off 对照，仅改变官方 loadingPage.using，保留 context、flush、延时、画质等。预期：若只有 off 在重进保持正常，定位向加载页/引擎交接收敛；若均失败，不能排除 native 提交问题；若均正常，也不能声称关闭加载页修复。
3. 若上述仍不区分，制作链接同一 GLX 库的极简 WASM 绘制对照；纯 JS wxwebgl2 不覆盖 WASM 静态库的指令转换，不能冒充该对照。一次只换一项，不无限试开关。
4. 候选真机验收至少连续 10 次退出重进、3 次前后台恢复，冷启动、2D/3D切换、触摸与音频；实际 GLX + 真实画面每轮均需证据。显示包/会话标记，与云端同源，不再依靠回忆分钟数；黑屏读不到标记时记录为待关联，不能强配。
5. 最小完整包稳定后才进行裁剪与官方分包；新 WASM 的 init/采集/upload 均需另获授权，本地测试不替代这些验收。失败保留，不通过重试抹除。

最终若仍指向闭源边界，应提交最小复现和两个具体问题：同一 GLX context 经加载页再交接引擎时要求何种状态隔离；当前 Emscripten 4.0.10 有无经验证的配套库及可核对 SHA256。不能要求用户盲试不匹配归档。
