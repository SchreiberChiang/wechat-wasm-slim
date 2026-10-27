# iOS 功能验收：第 6–9 页缓冲读回异常

原失败轮状态：**功能验收失败，缓冲读回兼容问题未修复**。记录号 GLX-19。用户报告第 6、7、8、9 页测试框内没有内容。最初只读分析记录保留；文末另记用户随后授权的场景单变量修改与一次新预览，不将旧失败改写为通过。

## 身份与原始证据

- 包：`ios-functional-glx-8fcfcc69d3d297a82b87`；候选 manifest SHA256 `7343ae9c09a3e4369d7a2b0b40971564fcdbfca3c1e22724d5a17ddf227263b1`。
- 会话：`d4f7102c`；iPhone 16 Pro / iPhone17,1；iOS 18.3.1；微信 8.0.75。
- 实际基础库 3.17.5，Wechat Lib 标记 `2026.10.26 13:43:01`。actualMode=glx，selectedMode=glx，modeEvidence=observed，canvasMatches=true，nativeContextIdMatches=true；不是 WebGL 回退。
- 原始日志 220,477 bytes，SHA256 `1d40b89e119cf068c7307a2531a9595a6374ac2ef8fd8cc3358f2947f90b8358`。已原样复制并核对一致；私有保存入口 `E:/AI/wechat-wasm-slim/.local/glx-ios-functional-20261027-02/phone-first-d4f7102c/`，含原日志和 `READING.json`。不上传 Git 原日志。
- 既有 JS／WASM／库及成功包保持，归属关系见 [验收准备与预览记录](GLX_IOS_FUNCTIONAL_ACCEPTANCE_20261027.md)。

## 日志直接证明什么

日志第 37 行为离开第 5 页（内部索引 4）；第 38–41 行紧接：

```text
MiniProgramError
TypeError: undefined is not an object (evaluating 'n.buffer')
at getBufferSubData@weapp: (wechat-game-runtime:76:82326)
at size (wechat-game-runtime/engine/godot.js:7:274668)
```

整份有 40 条相同 MiniProgramError，栈由触摸回调进入引擎；不把异常条数当作独立启动次数。共有 107 条序号连续的操作记录，其中 page_enter 33、page_exit 72、scene_ready 1、manual_verdict 1。page_enter 只覆盖第 1–5 页，没有第 6–9 页构造完成记录；第 6 页在第 1149 行被用户显式标为“异常”。当前代码先更新页码，再构造内容，最后才输出 page_enter，因此仍能切换标题／返回 2D，不能用 page_exit 误认上一页构造成功。

没有九宫格改尺寸／换纹理、双视口切换或子场景重建完成记录；第 1–5 页也没有人工“通过”标记，暂不将它们记为完整验收通过。日志包含一组 hide/show，但发生在 3D 异常之前，不能据此记为成功完成本轮持续运行／后台恢复计划。

本份未出现 shader 编译失败、旧类型错配错误或 Parse JSON failed。另有四条 RGBAFloat→RGBAHalf warning，第一条在第 137 行，晚于首个异常；单独保留，不能据此定责。宿主启动摘要的 errors=[] 是初始化快照，未包含后来的平台异常，不能写成整轮无错误。

## 与代码吻合的触发点

新场景 `examples/glx-ios-functional/main.gd:330`：

```gdscript
var source := BoxMesh.new()
var mesh := ArrayMesh.new()
mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, source.surface_get_arrays(0))
```

固定完整引擎源码证据位于 `E:/AI/wechat-wasm-slim/.local/glx-godot-newlib-build-20261026-02/build/engine`：

| 环节 | 源码依据 |
| --- | --- |
| PrimitiveMesh 的 surface_get_arrays 会先更新，再请求 RenderingServer 数据 | `scene/resources/3d/primitive_meshes.cpp:171–177` |
| RenderingServer 获取 mesh surface 数据 | `servers/rendering/rendering_server.cpp:1719–1721` |
| GLES3 读回 vertex／attribute／skin／index 缓冲 | `drivers/gles3/storage/mesh_storage.cpp:617–648` |
| buffer_get_data 绑定缓冲并调用 WebGL2 数据读回 | `drivers/gles3/storage/utilities.cpp:127–140` |
| JS 包装调用当前上下文的方法 | `platform/web/js/libs/library_godot_webgl2.js:40–45` |

最终 JS 接线为：

```js
gl.GLctx.getBufferSubData(target, offset, HEAPU8, data, size);
```

这是 Godot 自带的 WebGL2 包装，直接调用实际 GLX 上下文的方法，不经过 native GLX batchRender。源码第三参数是 WASM 内存的整堆 Uint8Array，第四参数是目标偏移、第五参数是长度；未复制成新的 ArrayBuffer。原引擎没有因此新增接线。

**这次新增的 surface_get_arrays 并非单纯 CPU 数据拷贝，而会进入 GPU 缓冲读回路径。** 第 6–9 页共用 `_world()`；`_build_3d_views()` 只有在 `_world()` 成功返回后，才创建用于显示该视口纹理的 TextureRect。因此该路径异常可以直接解释四页测试框都没有显示内容；参数求值还没完成时，不能先归因于新 ArrayMesh 的顶点／法线／索引上传错误。

旧成功场景 `examples/glx-acceptance-ui/main.gd:345` 直接 `cube.mesh = BoxMesh.new()`，没有“先上传 primitive、再回读、再上传 ArrayMesh”的往返。旧包 iOS 3D 正常的有限证据继续有效；新场景触发了此前没有覆盖的路径。电脑 WebGL 同一新场景正常，是后端对照证据，不是 GLX 必须正常的保证。

## 尚不能证明什么

- 微信压缩代码中的 `n` 究竟指哪个对象、实际参数值以及平台收到的数据对象，当前日志没有记录；不能只凭 `.buffer` 推断 HEAPU8 一定 undefined。
- 未拿到可读 WASM 调用符号；现有符号文件只有数字重映射。不能把上传编译后的 JS 列 274668 直接对应原 JS 字节偏移，也不能把 wasm-function[3072] 等硬译成某个 C++ 函数。上述源码路径与异常吻合，是当前最有依据的触发点，仍缺调用参数的运行时证据。
- 描述对象 `Object.assign({}, glContext.emscriptenGLX)` 与本次 HEAPU8 不同；GLctx 本身仍是 canvas 返回的对象，调用保留接收者。没有证据把这次异常归为该描述对象复制问题。
- 不能据此宣布是官方新库、微信平台或 Godot 包装哪一方的最终缺陷，也不能宣布所有 GLX 3D 均不可用。

## 最初建议（随后落实见后文）

先准备**只改网格构造方式**的独立场景候选：直接使用 BoxMesh，保留贴图、灯光、透明材质、SubViewport、显示矩形和导航不变；沿用同一完整引擎与官方库。先电脑 WebGL 验证，再单独申请一次 iOS 首开，优先只看第 6 页。

若第 6 页恢复且不再出现该异常，支持“新样例引入的缓冲读回阻断构造”解释，可继续其余功能项；这只是移除非必要读回，**不是修复 getBufferSubData 或证明 ArrayMesh 读回兼容**。若仍异常，则保留证据，继续沿实际栈收窄，不同时改深度、shader、库或提交。若要保留独立 ArrayMesh 覆盖，可后续由 CPU 明确生成顶点／法线／UV／索引，单列测试；不能用名称相近的 `get_mesh_arrays()` 假装绕过，它在当前引擎仍会调用 surface_get_arrays。

本报告不构成新预览／换包授权。原始失败候选、成功基线、完整日志均保留；原 Android 3D 问题仍单独挂起，不将本次 iOS 读回异常倒推为 Android 根因。

## 后续授权：直接 BoxMesh 场景候选

用户随后要求电脑调试基础库使用最新、仅尝试 GLX，并一次完成后推送预览。本轮据此只将 `_world()` 中 `BoxMesh → surface_get_arrays → ArrayMesh` 改为 `cube.mesh = BoxMesh.new()`；不改变贴图、灯光、透明材质、视口、场景导航或宿主。只重新导出场景 PCK，没有重编引擎、换库、加探针或更改提交路径。原失败包及原始日志原样保留。

- 新候选：`ios-functional-glx-54056018e628bef5ebfd`。
- manifest SHA256：`2692da4e31f9772c0856bde3b0b8ea4e3bd34b700b67c3217af8f8573af0e7d4`。
- PCK：89,236 bytes；SHA256 `214a1905982aae9d5988c4d92fba3bfaa689f5f2c2cc2208c9a9850d9bb6bf06`。
- 私有恢复入口：`E:/AI/wechat-wasm-slim/.local/glx-ios-functional-20261027-03/`；包括冻结场景、候选、源差异、导出日志、`EXPORT.json`、`STAGING.json` 和 `AUDIT.json`。
- 原完整引擎 JS、BR、解压 WASM、配套哈希及官方库哈希均保持。静态完整性 16/16、组包门禁测试 8/8 通过；Godot 导入和 PCK 导出成功。这些不等于真机显示通过。

### 电脑 GLX 检查的实际边界

独立电脑副本为 `devtools-glx-latest`。工具版本 2.02.2609231 RC；`latest` 实际返回 3.17.4，可见列表另有 3.17.5（灰度）。已明确选择 3.17.5，并使两份配置的 `libVersion` 都为 3.17.5，其他配置字段语义未变；但刷新后运行日志仍报告 SDKVersion=3.17.4，故**不能认证实际已运行 3.17.5**。界面设置值、错误尾注与运行时自报版本的差异独立记录，不用配置值覆盖实际值。

当前观察到 `wx.env.isSupportEmscriptenGLX` 不为 true，宿主明确报 `GLX experiment refused ... no fallback allowed`，没有实际上下文，也没有启动场景。这是模拟器能力门禁阻断，**不是 GLX 场景运行通过或手机不兼容**。本轮未运行 WebGL 对照、未伪造能力或绕过门禁。一次 `automation_runtime_info` 超时单独保留，不当作 GLX 根因。不继续反复尝试模拟器。

### 一次预览及手机核对

预览副本从冻结候选逐字节复制，AppID 与成功父包一致，保留其编译设置；电脑调试副本的版本选择不写回冻结包或手机。新手机实际基础库需从日志确认，目标为 3.17.5；GLX 不得静默回退。预览尝试与最终结果只写入私有 `phone-preview-01/PREPARATION.json`、`ATTEMPT.json`、`RESULT.json`，不修改封存 manifest 的历史状态。

本次 `create_preview_qrcode` 返回 `ok=true / success=true`，CLI exit=0；仅调用一次。上传后 27 个文件逐一与冻结候选核对一致，无额外文件。二维码 45,981 bytes，SHA256 `da48f9bed8eb0d3788c4026123b64bf0a278ca56ddbc767f94f657690435f756`，保存在私有 `phone-preview-01/preview.png`；不将二维码或完整工具响应提交 Git。`ATTEMPT.json` 的防重复文件成功在调用前独占创建，但内容误序列化为 PowerShell 脚本块；原文件保留，实际工具结果与该记录缺陷明确写入 `RESULT.json`，没有重新上传。

优先看第 6 页：方块出现且持续旋转后，再检查第 7–9 页；任何空框或异常停止并保留完整日志，不要求先重进或清缓存。即使显示恢复，也仅支持非必要缓冲读回阻断页面构造的解释，**不表示已修复 getBufferSubData、ArrayMesh 读回或全部 GLX 兼容问题**。

## 新候选 iOS 首轮结果：用户报告各页画面正常

用户提交 `vconsole_1793073282565.log` 并反馈“看起来都正常”。已将原始文件逐字节复制到私有 `03/phone-first-1c99baea/`，SHA256 `7a390ffa77f91fafd5eaf2b1cac2f6a869eae9a780a8e750a76d94484dada7be`，18,182 bytes、56 个非空行；结构化核对在同目录 `READING.json`。没有追加上传、手机操作或代码修改。

身份：候选 `ios-functional-glx-54056018e628bef5ebfd`，单一会话 `1c99baea`；iPhone 16 Pro / iPhone17,1，iOS 18.3.1，微信 8.0.75。首行 Wechat Lib 与宿主均为实际 **3.17.5**，构建标记 `2026.10.26 13:43:01`；场景摘要 actualMode=selectedMode=glx，capability=true，canvasMatches=true、nativeContextIdMatches=true，不是 WebGL 回退。启动初期的 unknown 是尚未创建上下文的快照，不与后续实际 GLX 混淆。

| 项目 | 日志直接记录 | 画面证据和边界 |
| --- | --- | --- |
| 1–9 页 | 9 条 page_enter，各页一次；24 条操作序号 1–24 连续 | 用户整体反馈“看起来都正常”；不是程序自动判通过，也没有逐项 pass 按钮记录 |
| 原失败的 6–9 页 | 四页均完成构造并进入 | 结合用户反馈，本轮空框现象未再现 |
| 第 8 页双视口 | viewport_switch 两次：切到 2D，再回 3D | 本轮已覆盖该操作；未逐像素评价两个视角 |
| 第 9 页退出重入 | 两组 scene_exit / scene_reenter | 是本页内容子树销毁重建，不是微信重开或整个 Godot SceneTree 切换 |
| 第 3–5 页九宫格 | 页面进入已记录，未记录改尺寸／换纹理 | 静态浏览反馈正常；运行时动态操作未验收 |
| 持续运行／后台恢复 | 启动摘要 hide=0/show=1，末尾一条平台 onAppEnterForeground | 缺完整操作及恢复后的画面反馈，不能记为完成 |

操作 ticks 从 5,645 到 53,062，差 47,417 ms；这只是操作记录的 Godot tick 范围，不代表每页观察时长或已完成两分钟持续运行。操作日志的 host 来自启动时缓存身份，未把每次操作写成重新探测 GLX。

本份没有 `getBufferSubData`、`n.buffer`、TypeError/MiniProgramError、shader 编译失败或 Parse JSON failed。仍有四次 `RGBAFloat → RGBAHalf` WARNING，每次附一行 texture_storage.cpp:734；共八行 error 通道文本不等于八个独立异常，也不将其忽略写成无警告通过。

与旧失败 d4f7102c 对照，设备、微信、iOS、基础库及其构建标记一致，引擎／库／宿主保持；只移除场景额外 GPU 回读路径后，原四页构造完成且用户反馈显示正常。这进一步支持该回读路径是旧场景空框的触发点。**本次完成的是样例构造方式调整与本轮基础显示观察，GLX-19 的底层缓冲读回兼容缺口仍未修复**，不能据此关闭原安卓 3D 问题或所有 GLX 兼容问题。

最小剩余验收可继续沿用当前包：第 3–5 页分别改尺寸／换纹理；第 8 页持续观察并完成一次后台恢复。无需为这些已有功能生成新包；本次没有自动执行或要求重复已完成的首开、页间切换和两组内容重建。

用户随后补充多个切页方向存在卡顿，且第9页内部重建也会卡一下。原“看起来都正常”继续只表示显示反馈，不写成流畅度或所有兼容项通过。后续优先重新设计清晰验收目标，旧零散补测安排由[第二版设计与GLX-20分析](GLX_COMPATIBILITY_V2_20261027.md)接续；本轮未要求新增手机操作。
