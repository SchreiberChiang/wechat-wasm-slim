# GLX 兼容验收场景 v2

这是独立测试场景，不包含引擎或 GLX 库。复用已验收完整 Godot 引擎；没有材质常驻优化、GPU 读回、裁剪、分包或云采集。原 `glx-ios-functional` 场景与成功包保留。

20 个检查点各自记录画面、操作、停顿；所有结果初始为“未测试”，保留“看不清”。动作执行、计时结束、绘图回调均不能自动通过。结果在当前运行内保存，退出进程后不承诺持久化；通过已有 vConsole 导出 `[IOS_FUNCTIONAL_V2]` 记录留证。

## 源码

- `cases.json`：20 项的动作、预期及异常文案。
- `main.gd`：中文界面、安全布局、切换顺序、原始时间记录。
- `renderer.gd` / `visual_canvas.gd`：实际测试内容和独立画法的示意。示意仍通过同一显示链路呈现，不是独立 GPU 正确性证据。
- `result_store.gd`：三类独立结果，不自动判画面通过。
- `bridge.gd`：只读取原宿主已有身份/后端/设备接口，不改变宿主。
- `safe_area_*.gd`：沿用既有安全区计算。
- `build_font.py`：固定字体来源、覆盖全部 GDScript 与 JSON 中文。导出前必须生成，不靠 Windows 字体回退。
- `local_verify.gd`：仅电脑图形检查，导出明确排除；其截图读回不得打进手机包或当作性能基线。

## 准备提示与时间

切页开始 → 显示“正在准备本项内容，可能停顿数秒” → 等待真实 `RenderingServer.frame_post_draw` → 创建内容 → 记录资源创建结束 → 等待内容绘图回调 → 允许人工判定。没有固定 sleep 或计时器冒充完成。

日志保存原始 `Time.get_ticks_usec()` 和各阶段差值。回调只表示引擎通知，不保证手机物理屏幕已经呈现；CPU 等待不是 GPU 编译时间。提示不构成性能改善。直接3D旧节点直到创建阶段才销毁，准备期间可能仍看见上一项3D内容，状态文字明确处于准备中。

## 本机复现

固定本机 Godot：4.7.2.stable.steam.ed1daf0bf；引擎复用规则见 `engine/functional-acceptance/stage.mjs`。先把本目录复制到新的忽略目录，后续只更新工作副本，不覆盖冻结包。

1. 用 fontTools **4.60.0** 运行 `build_font.py --source <已核验 Noto Sans SC 字体> --output <新字体目录>`；把生成的 OTF 和 FONT.json 放入工作副本 fonts。来源与 SHA 在脚本和 OFL/NOTICE 中。
2. `godot --headless --path <工作副本> --editor --import`。
3. `godot --path <工作副本> --script res://local_verify.gd -- --out=<新检查目录> --size=720x1558`。另以 `--size=720x1160 --details-open` 检查小画面；`--routing-only` 为 GUI 事件分发检查。无图形的 headless 不提供 draw 信号，不会伪报准备完成。
4. `godot --headless --path <工作副本> --export-pack Web <新PCK>`。这只导出场景，**不重编引擎**。
5. `node engine/functional-acceptance/stage.mjs --scene-pck <PCK> --scene-source <工作副本> --output <新冻结目录>`。固定两个父包须先通过完整哈希门禁；GLX/WebGL 使用同一 PCK 和原引擎。
6. 从 WebGL 冻结包另复制电脑工作目录，只在该副本设置调试基础库版本，保留差异清单后用独立微信开发者工具窗口运行。记录运行实际 SDK/后端，不能只读项目配置。

没有自动上传命令。新 iOS 预览与真机操作需另行明确批准。

## 手机操作草案（未执行）

先核对新包、实际 SDK 和 GLX，再按目录逐项操作；每项分别选画面／操作／停顿。不确定选“看不清”或“未测试”。准备状态结束前不要连续点；长时间未结束、黑屏或报错则保留现场。

基础项 01–17 完成后，18 前台观察两分钟；19 返回桌面约10秒再回来继续观察约20秒；20 清空/重新创建最多三组。是否执行这些手机步骤仍待批准。旧成功包的启动历史继续保留，不借本场景重复冷启动测试。高级 shader、骨骼、粒子、压缩/浮点纹理、音频、泄漏、Android 等均未由本场景覆盖。
