# 第4项四模式候选：一次预览上传

2026-10-27，用户批准 `ios-functional-glx-912c537585a6f3a07ef5` 一次预览，同nova4扫码后Wi-Fi ADB核身份、第4项基线及四模式四图；故障消失/标定异常/冻结即停，不重试、不清缓存、不覆盖体验版或追加变体。

本记录截止预览成功，**等待用户扫码进入首页确认，尚未连接或操作手机**。本候选手机实际3.17.4、GLX和画面均待核实，不能继承旧8f0ff结果。

- 工具create_preview_qrcode仅调用一次，CLI exit0、ok=true、success=true，无pending。未调用体验版upload或自动推送、基础库下发。
- 冻结清单SHA256 `fa54b3f15d4fbb989bed9bf9a9c67743a1283e803684f17cb5598bf193938215`，PCK `e15c8a6981f87d4ee51f3bc77f4bbf4add697d45666ae30407960731e6f4b86e`。冻结/独立预览/上传后27文件逐字节一致，引擎JS/BR/解压WASM原门禁通过。
- AppID匹配固定父项目。沿用冻结配置libVersion3.15.2及原swc=true/disableSWC=false，没有复制电脑副本关闭SWC的设置；预览服务本次已接受，未因此宣称手机运行通过。手机实际版本仍须3.17.4，不符就停，不自动切换。
- 原旧包、日志和体验版不变；云转发保持disabled，未新增云采集。
- 私有 `E:/AI/wechat-wasm-slim/.local/glx-case4-alpha-mix-20261027-01/phone-preview-01/` 保存project、PREPARATION、ATTEMPT、CLI_EXIT、完整preview-tool.log、POST_PREVIEW_MANIFEST、RESULT和二维码。
- `preview.jpg`为本次工具返回的JPEG原字节，47379 bytes，SHA256 `628bfb1856164dca3aad8e42bb29eb3c78a63b008d2be23cee899354c0fd2731`；不是新生成/转码二维码，没有第二次上传。原响应SHA256 `f442f3413311b5f25192cf336ad60eb41c86a55e14165710997383afab4b3707`。

扫码后沿用[电脑报告中的有限步骤](ANDROID_CASE4_ALPHA_MIX_DESKTOP_20261027.md)：只核已保存的Wi-Fi ADB目标及VCE-AL00/Android10，页面/包/实际3.17.4/GLX成立才进入第4项；原基线应左透底右正常。故障未复现即停并保留，不追着重现。基线成立才暂停旋转并检查直通桥接、标定、alpha灰度、固定1四模式，每模式约10秒一图；任一停止条件立即结束，不点其他页或结果下拉、不重进或重试。完整vConsole仍由用户导出。

回退材料仍是原8f0ff冻结包及旧97e/20c/原成功包，本轮没有自动回退换包。后续手机截图/设备局域网标识、原始日志仅本地保存，不进公开Git。
