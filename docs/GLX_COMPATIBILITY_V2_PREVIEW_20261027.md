# iOS 验收 v2 一次预览与人工操作顺序

2026-10-27，用户批准 `ios-functional-glx-b18f8897add5263024ca` 仅预览一次，手动完成 iOS 验收。Android 控制安装审批独立保存，不互相阻塞。

## 上传结果

- `create_preview_qrcode` 仅调用一次，CLI exit=0、ok=true、success=true；未调用体验版 `upload`，未推送基础库。
- 冻结 manifest SHA256 `23db9db3b98710fadd49acb34dc345eea3bf5e86363d97c99d609909650c289c`。独立预览副本上传前后27文件完全相同，原冻结包与成功包保留。
- 沿用既有 AppID，与固定成功父包一致；不把实际 AppID、二维码或原始响应提交仓库。
- 工程两个 libVersion 仍为冻结原值3.15.2，未修改；它们不认证手机实际版本。**本轮要求手机实际3.17.5、实际GLX，均待手机日志核验。**
- 私有目录 `E:/AI/wechat-wasm-slim/.local/glx-ios-functional-v2-20261027-01/phone-preview-01/`：project、PREPARATION.json、ATTEMPT.json、preview-tool.log、CLI_EXIT.txt、RESULT.json、POST_PREVIEW_MANIFEST.json、preview.png。
- QR文件47,777 bytes，SHA256 `ed191359cae689460e6972bbe9fe3b7ed0105e6a291c43d4087b0a981201f28a`；本记录不把预览服务接受等同真机运行成功。

## 给用户的有限操作顺序

1. 用 iPhone 扫本次二维码，等中文“内容已准备”。先查看顶部实际 SDK/后端，打开 vConsole 保存首开完整日志（保留第一行 Wechat Lib 与宿主身份）。目标是3.17.5/GLX及本候选；显示未知、版本/模式不符、黑屏或异常就停止，不改基础库或重开。原始日志由本会话核验，不能只凭配置推断。
2. 按01–20目录逐项完成屏幕动作，分别填写画面、操作、停顿；准备中不连点。不清楚保留看不清/未测试。显示正常但切入卡一下，应把两个结果分开填。
3. **分段导出完整日志**：首开后、01–05后、06–10后、11–17后、18–20后各保存一个新文件（建议自行另记阶段名）。导出当前全部日志，不复制可见长行或折叠条目，不清空console。累计日志之间允许重复，由包/启动标识/operationSequence去重；这不保证vConsole无限保留，若发现开头/中间缺项即如实报告，不重复操作凑齐。
4. 第18项前台观察两分钟，仅短时检查；第19项回桌面约10秒再返回约20秒；第20项清空/重新创建最多三组。后台恢复可能改变时间，应保留真实记录。任何黑屏、持续冻结、报错或准备长期不结束都保留现场，导出当前日志并停止。
5. 本轮不另外重做冷启动/清缓存/强退，不上传新包、不加材质常驻、读回或Android修复。完成程序动作、等待到时、draw回调不自动算屏幕通过。

原始日志保存在私有目录后再输出脱敏分项汇总；当前本报告不含尚未发生的手机验收结果。完整手机日志导出与电脑CLI截断输出须区分。

## 已批准的旧窗口整理

用户逐一批准关闭5个旧项目：`ios-functional-webgl-d11480e2a7bc262b673d`、`ios-functional-webgl-f0d46197c0d537380946`、`godot-fbo-object-map-webgl-44b280f0aac1`、`godot-fbo-preflight-webgl-38513c8bc78f`、`godot-offscreen3d-probe-webgl-e6bae7314e88`。按各自devtools-webgl工作目录调用close_project_window，5次均success；随后窗口列表只剩当前v2 WebGL、旧成功GLX与项目列表页。没有退出整个工具、结束Apple/ADB进程、删除目录或改变体验版。
