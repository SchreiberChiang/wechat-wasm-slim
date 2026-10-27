# 默认清屏色候选一次安卓预览记录

最新：用户扫码后已完成获准的第15项对照并停止。页面和左右异常轮廓都从旧RGB(9,14,22)变为新RGB(51,77,13)，蓝/紫背景不变；异常未修复，原纹理alpha未知。详见[实际结果](ANDROID_DEFAULT_CLEAR_COLOR_RESULT_20261027.md)。下方保留上传阶段状态。

2026-10-27，用户批准 `ios-functional-glx-20c564de30fc8e482fb1` 一次预览上传及扫码后同一nova4的第15项一次截图对照。无需Mobile MCP；保留现有Wi-Fi ADB，不自动切基础库。

## 上传结果

- 只调用一次`create_preview_qrcode`，CLI exit0、ok=true、success=true，无pending任务；未调用体验版upload。
- CANDIDATE.json SHA256 `5ec9b7c2b769a0bd62077bc46b53b6e864e61c3441c08814c4f5c6642ba9dbc7`；复制前、预览副本及上传后27个文件manifest一致；独立复核无本地harness，所有运行脚本与原v2一致。
- 使用与原v2相同的既有AppID；项目/私有配置libVersion均沿用3.15.2，未改配置或向手机下发版本。本轮验收仍要求手机**实际3.17.4/GLX**，不能用工程配置推断。
- 云转发禁用；未发新增云报告，不重建/替换引擎或GLX库。
- 预览二维码46,779 bytes，SHA256 `0d2b5d532c594e87848955e0f3350c6418cac25f9e2c9c4db53f708b64db4011`。二维码及原响应只在私有目录保留。

私有目录：`E:/AI/wechat-wasm-slim/.local/glx-android-clearcolor-20261027-01/phone-preview-01/`，含project、PREPARATION、ATTEMPT、preview-tool.log、CLI_EXIT、preview.png、RESULT、POST_PREVIEW_MANIFEST。

## 当前状态与已批准手机步骤

等待用户在nova4手动扫码进入新包首页并确认。未在上传后自动访问手机，也未宣称手机运行通过。

确认后才通过现有Wi-Fi ADB核型号/系统及当前小游戏、新包短码和实际SDK/GLX；必要页面/目录核对后导航第15项，内容已准备时保存一次最终对照图并停止，不按其他功能按钮或更改验收结果。若版本/后端/页面不符或遇权限、黑屏、报错即停，不自动切版本、重进、清缓存或补上传。

解释沿用[电脑准备记录](ANDROID_DEFAULT_CLEAR_COLOR_CANDIDATE_20261027.md)：只判断异常是否依赖全局默认clear色，不能独立证明alpha=0；新包未复现也不能宣布改底色修好。原包b18f8897add5263024ca及全部证据保留，回退换包另行确认。
