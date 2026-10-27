# 左窗底板候选：一次预览上传记录

最新：用户扫码后已完成获准的身份核验和第15项一次对照并停止。实际3.17.4/GLX，左模型异常区随底板变洋红，右仍橄榄，蓝/紫背景不变；模型纹理未恢复。见[手机结果与边界](ANDROID_LEFT_UNDERLAY_RESULT_20261027.md)。下方保留上传阶段的状态。

2026-10-27。用户明确批准`ios-functional-glx-97e50760597b509a10a5`一次预览及扫码后同一nova4的Wi-Fi ADB身份核验、第15项约20秒观察与一次截图。本记录仅到上传完成，等待用户扫码确认；尚未连接或操作手机，不能判断实际版本、后端或画面结果。

## 上传与完整性

- 仅一次`create_preview_qrcode`，CLI exit0、ok=true、success=true，无pending任务。没有调用体验版upload或auto_preview，没有失败重传。
- 候选manifest SHA256：`98c37d86334a338fc24641c71ba0993c2bce1958d5cecd65a937acb1e96d5e1f`；PCK：`44c74e175cc6452d2497b808c4fc7baad57ebd3cb128b5a278a6ca37108be9ad`。
- 冻结原包、独立预览副本及上传后的27文件清单/逐项SHA256完全相同。引擎JS、BR及解压WASM核验通过，既有AppID与20c包一致；没有重建或修改候选。
- 继承项目和私有配置，libVersion字段仍为3.15.2，未下发或切换基础库。手机必须另行核对**实际3.17.4 / GLX**，配置值不作为手机版本证据。
- 云转发继续禁用，未新增云日志；体验版和当前旧包材料保留。

私有目录：`E:/AI/wechat-wasm-slim/.local/glx-android-underlay-20261027-01/phone-preview-01/`，含project、PREPARATION、ATTEMPT、preview-tool.log、CLI_EXIT、POST_PREVIEW_MANIFEST、RESULT及二维码。预览命令先写一次ATTEMPT，拒绝自动重复调用。

工具按请求输出名`preview.png`返回的实际内容是JPEG。最初按PNG魔数核验被拒绝后，按实际JPEG头和470×470尺寸验证；原字节保留，并复制为相同字节的`preview.jpg`供展示，未转码、未重传。两文件均46918 bytes，SHA256 `8bfb46097b32bd046076cbfbf8d58e42d274e0a7ae7f1f022631b0e7da714050`。这属于本地图像格式检查，不是预览服务拒绝或包变化。

## 等待扫码后的有限步骤

1. 用户用此前同一nova4/账号扫码，停在首页并确认，不自行切第15项、重进或清缓存。
2. 只通过已保存的Wi-Fi ADB目标核对VCE-AL00/Android10、当前指定小游戏、候选身份及实际3.17.4/GLX。无法证明、目标离线、出现陌生页面或异常权限提示即停，不自动重连或扩大操作。
3. 身份成立后，仅必要目录导航至第15项，等待“内容已准备”，观察约20秒并保存一次最终画面对照。不点其他功能，不写验收选择，不读取GPU或默认取得完整vConsole。
4. 结果无论支持哪一侧解释都停止；本次不重进、不重试、不追加版本，不清缓存、不自动切基础库或回退包。

判断规则及混杂因素沿用[电脑候选记录](ANDROID_LEFT_UNDERLAY_CANDIDATE_20261027.md)：左轮廓跟随底板变洋红仅支持下层颜色参与最终合成，不直接证明纹理alpha=0；仍为橄榄色则削弱简单透底解释；新包恢复、右窗变化、外圈不清或异常均如实记录，不能宣布修复。额外CanvasItem可能改变批次/时序。

回退旧20c冻结材料仍在`E:/AI/wechat-wasm-slim/.local/glx-android-clearcolor-20261027-01/frozen/candidate-glx/`；本轮未换回，后续换包仍需另行确认。
