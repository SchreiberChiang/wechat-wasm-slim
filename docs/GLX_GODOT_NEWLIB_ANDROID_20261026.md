# 官方新库完整 Godot：安卓 3D 与电脑预览边界

**后续保存状态（2026-10-26）：** 用户补充 iOS 的同场景 3D 模型正常。随后批准的独立 WebGL 对照已冻结为 `godot-official-glx-026e-webgl-control-1f5d72f561644b764c5d`，联合静态测试 12/12；用户现要求暂停新增实验，故尚未在开发者工具运行或核验 3D。下文“尚未创建”是本记录最初阶段，不是当前保存状态。两组成果与来源缺口见[保存审阅清单](GLX_GODOT_NEWLIB_CHECKPOINT_20261026.md)。体验版另记用户报告手动上传、后台指向尚未核验；手机日志仍不用于推定入口类型。

用户报告安卓多种重开都可显示、2D 正常，但切换 3D 后没有模型。此次仅收到一份会话日志，不补造各种重开的具体次数或逐轮通过记录。

## 当前安卓证据

- 包：`godot-official-glx-026e-a169d60be3d6db10c33c`，启动标识 `7abad961`。
- 设备：`VCE-AL00` / Android 10 / 微信 8.0.79，实际基础库 **3.17.4**，与前轮 iPhone 的 3.17.5 不同。
- SCENE 与完整手动摘要确认实际 GLX、上下文/画布匹配、场景启动；完整 identity 与冻结 manifest 一致，没有 WebGL 回退证据。
- 原日志 `vconsole_1793015849952.log` SHA256：`1e9cb2555503e840746652fa4b813be6ac5651d1c604aa5073c83b4cba859394`。
- 一组 GLX-10 JSON 解析错误、四条 RGBAFloat→RGBAHalf WARNING 保留；本份日志未见 shader 编译/绑定失败或旧安卓日志中的 WAPixi `checkCompatibility/initGeometryVao` 异常，不能把旧异常套到当前会话。
- 有完整手动 JSON，但没有 `[SELFBUILD_CANDIDATE_MANUAL]` 精简事件；原精简事件有 60 秒预算，缺少该行不等于按钮未执行。未据此推断精确点击时间。
- 手机日志未标明预览/体验版入口，不据此确认此前后台上传或体验版指向已成功。

## 3D 问题的定位范围

现有 `examples/glx-acceptance-ui/main.gd:332-362` 用代码创建 640×240 的独立 SubViewport、BoxMesh、青色 StandardMaterial3D、相机和灯光，无外部模型下载。`:365-368` 的切换函数才启用 3D viewport 更新，并将其纹理交给 TextureRect；`:315-318` 负责旋转。静态代码未见明显相机或模型创建遗漏。

用户报告与源码把范围收窄到**安卓离屏 3D 绘制、viewport 纹理或其显示链路**，但没有截图证明 3D 背景是否出现，仍不能区分整个 viewport 输出与方块绘制问题。`frame_post_draw`、`sceneRead`、GLX 初始化和 `errors:[]` 都不是 3D 画面通过证据。

固定源码 `drivers/gles3/storage/config.cpp:57-71,102-103` 从 Web 扩展上报计算能力；`texture_storage.cpp:554-567,729-737` 在相应条件下把 RGBAF 转 RGBAH 后发出警告。它不证明后续纹理上传、FBO 完整性或采样成功，也不直接证明物理 GPU 缺能力。iPhone 的已报告正常会话同样有四条此警告，因此该警告不是单独足够的根因证据。

旧包安卓审计保存在 `.local/glx-android-3d-20261025-01/`，旧会话 `86a8819e`；此前安卓下发 3.15.2 的尝试实际仍为 3.17.4，版本门禁失败，不能称已有安卓 3.15.2 的有效 3D 对照。

## 电脑是否还能预览

可以继续电脑开发和看画面，但应区分 WebGL 电脑验证与 GLX 真机验证。当前封存候选是显式 GLX 验收包：`candidate-mode.js:36-44` 在 `wx.env.isSupportEmscriptenGLX !== true` 时输出 `GLX_CAPABILITY_UNAVAILABLE` 并抛错，不降级成 WebGL 后声称 GLX 成功。用户此前提供的官方正文把 GLX 支持范围列为 iOS 高性能+和 Android；不保证开发者工具模拟器支持该链路。本次官方网页正文仍不可读取，没有据此扩展支持结论。

当前电脑只读核查：开发者工具窗口标题对应此候选；console 工具返回空匹配，systemInfo 请求超时。原生窗口截图返回的是被 Codex 遮挡的内容，不作为开发者工具画面证据。**本轮未取得当前 runtime 的能力位或报错，故“能力门禁导致本次黑屏”仍是有明确代码依据的优先解释，不写成已实测唯一原因。** 没有刷新、清缓存、改配置、创建新包或操作手机。

推荐下一步是独立准备**相同新 JS/WASM、相同 PCK 和宿主的明确 WebGL 电脑对照**，保留 GLX 冻结包与独立身份，先验证两块 2D 及 3D 方块。不能直接覆盖当前手机候选的开关或修改原 GLX 精确准入；也不能拿旧引擎的 WebGL 包称为新引擎同输入对照。此副本尚未创建，本轮不启动修改。

电脑 WebGL 可以验证通用场景和该引擎路径，不能替代安卓 GLX 的像素/生命周期验收。之后安卓最小图像检查应分辨“深蓝背景是否出现、青色方块是否出现”，不盲改模型、材质、库或 shader。

## 保留位置

本地忽略目录 `.local/glx-godot-newlib-build-20261026-02/android-7abad961-devtools-check/` 保存原日志、核验脚本、RESULT 和两项工具原始返回。冻结候选 27 文件及独立上传副本再次核对；本轮不上传、不改库、不改引擎、不改赛车或服务器。原始证据不提交 Git。
