# 纯 GLX 三角形真机首轮：四项各一次可见

用户在电脑侧准备后，明确批准候选 `native-glx-validation-57ccb8dd415854427515` 的版本核对、至多一次 3.17.5 下发、一次预览，以及首开/普通退出重进/强退微信重开/前后台恢复各一次。逐项推进，上一项实际画面与 GLX 证据核对后才继续；黑屏或版本不符停留现场，不清缓存、不自动回退，不发送云日志。

## 来源与本轮操作

实际链接的 `libemscriptenglx_4.0.10.a` 是固定 citizenll/godot `df3cdd9bc9941a20cb5575d781cde6f937637bcb` 源码树中的副本。2026-10-23 留存的微信官方下载归档、成员哈希与本次只读复核证明，它与官方 GLX 0.1.11 包对应文件逐字节相同：4,088,602 bytes，SHA256 `c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a`。

公开来源：[官方接入指南](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-emscriptenglx-native.html)、[固定版本下载端点](https://game.weixin.qq.com/cgi-bin/gamewxagwasmsplitwap/getunityplugininfo?download=1&biz_id=1&version=0.1.11)、[固定源码树内的库](https://github.com/citizenll/godot/blob/df3cdd9bc9941a20cb5575d781cde6f937637bcb/platform/web/libemscriptenglx/libemscriptenglx_4.0.10.a)。来源核验依据下载/归档及 Git blob，不只依据 version.txt 标记；本轮没有重新下载或换库。

本轮开发者工具登录有效。工具列表存在 3.17.5，标为灰度中，显示 iOS 微信最低 8.0.75；手机为 iPhone 16 Pro/iPhone17,1、iOS 18.3.1、微信 8.0.75。首次 Wi-Fi 截图确认旧 Godot 包实际 3.15.2；随后只下发一次 3.17.5，工具提示成功。用户从原入口再进入旧包后，第二次 Wi-Fi 截图确认 Wechat Lib 与平台 SDKVersion 均为 3.17.5，版本门禁通过。

版本核对属于换包前准备，不计为三角形首开/重进轮次。旧包在两个截图中的 session 分别为 `3698420a`、`d3cc740c`，不将这些旧 Godot 会话写成新三角形证据。电脑控制项目的模拟器能力门禁与一次 runtime-info 超时也不计为手机 GLX 故障。

随后 `auto_preview` 仅执行一次并成功，报告 TOTAL 448,168 bytes；预览后本地源包封存再次核对通过，未覆盖旧包目录或修改本候选源文件。没有第二次上传、二维码上传、体验版发布、云采集或服务器改动。

## 分步状态

| 阶段 | 包/版本/会话 | 实际画面与类型证据 | 当前结论 |
| --- | --- | --- | --- |
| 首开 | 指定三角形包、3.17.5；`triangle-mvmqnatz-ywi95yto` | 用户反馈与 Wi-Fi 图确认三角形可见；完整日志确认 actualMode=glx、metadata/canvas match=true；shader 1 请求/返回 35633/35633，shader 2 为 35632/35632，无编译/链接错误 | 本轮首开可见及查询类型吻合，放行一次普通重进；非稳定性通过 |
| 普通退出重进 | 同包、3.17.5；`triangle-mvmqzpzc-b4h1rg4v`；scene=1089 | 用户反馈与 Wi-Fi 图确认可见；主进程未更换，新 entry/session 与两次 TYPE 查询证明 JS 重新初始化；GLX、画布匹配，类型均吻合 | 本轮一次可见 |
| 强退微信重开 | 同包、3.17.5；`triangle-mvmr57di-kz6tr0uw`；scene=1089 | 用户确认可见；微信进程记录确认替换；完整日志 GLX/画布匹配、两个类型吻合，无编译/链接错误。取证时用户已切出游戏，非游戏截图不作可见证据；按用户要求不补图 | 本轮一次可见；画面证据来自用户，进程替换独立确认 |
| 后台恢复 | 同包、3.17.5；仍是强退重开后的同一 JS session | 用户按回桌面约 10 秒、返回约 20 秒反馈可见；新日志为旧日志的逐字节完整追加，新增 hide/show、无新 entry/host/TYPE 或错误 | 本轮一次恢复后可见；持续动画未确认 |

当前背景动画仍未验证。FPS、GLX banner、初始化快照和首开显示都不能替代后续三项验收；shader 返回类型也不独立证明平台实际编译对象/源码。所有显示结论均仅限本次包、设备和实际版本。

四项批准操作已各执行一次，后续三项结果已逐轮核对，当前不再操作手机。**这是一次有限的显示/生命周期 smoke，不是重复稳定性验收，也未解决完整 Godot 的强退黑屏根因。** 同库在这个极简负载中本轮未复现，不能据此排除库、调用顺序、查询时序或较复杂负载的风险。

首开完整日志 `vconsole_1792866875496.log` 为 5,278 bytes，已原字节归档核验；7 条关联事件同包同会话，原始 shader stdout 与两条摘要逐项一致。公共 Emscripten context handle=1，GLX ctxid=2 属不同编号空间，不因数值不同认定冲突。末尾 hide/show 没有独立对应的恢复后画面记录，不计为专门的后台恢复测试。

普通重进日志 `vconsole_1792867454999.log`、强退重开日志 `vconsole_1792867710721.log` 各 4,858 bytes。三次新初始化均为 shader 1 请求/返回 35633/35633、shader 2 为 35632/35632，原始输出与关联摘要一致，host 身份与同一封存吻合，均无第三次失败查询或运行错误。

后台恢复日志 `vconsole_1792867710721(1).log` 为 6,120 bytes，前 4,858 bytes 与强退日志逐字节相同，追加 1,262 bytes。追加三对 hide/show（sequence 6–11），无新初始化、shader 查询或错误。导出和用户主动切出也会产生前后台事件，因此不将三对事件算作三次独立恢复，具体每对与物理动作无法逐一认证；只记录用户明确执行的一次专门后台恢复。

用户反馈背景变化难以辨认，要求下次更明显。本轮不改变任何源包、颜色或配置；建议下一独立候选仅增强缓慢背景变化的对比度，用于区分持续绘制与静止末帧，新预览另行批准，不能把两包的轮次混算。扩大重复验证前应补齐这项可观察性，不凭静止三角形推断持续帧推进。

## 本地私有证据

原工具仓库忽略目录 `.local/glx-native-validation-20261025-01/` 保留：`PHONE_APPROVAL.json`、`BASELIB_PUSH_3175.json`、`PHONE_VERSION_BEFORE/AFTER.json`、`PREVIEW_DISPATCH.json`、`PREVIEW_SUCCESS.json`、私有原始工具返回、`FIRST_USER_REPORT.json`、`FIRST_SCREENSHOT_REVIEW.json` 以及 `phone-version-*`、`phone-first-visual-01/`、`phone-first-console-01/` 截图/进程和捕获记录。capture 脚本只复用既有配对建立临时 Wi-Fi 取证连接，不输入触摸、不更改设备/网络设置；这些原始材料不进入 Git。

后续原始日志和审查保存在 `first-log-01/`、`warm-log-01/`、`forcequit-log-01/`、`resume-log-01/`；最终轮次摘要为 `PHONE_ROUND_RESULT.json`，恢复入口以 `CURRENT_STATE.json` 为准，旧 `PHONE_PLAN_PENDING.json`/`COMPUTER_RESULT.json` 为历史阶段记录。公开 Git 仅含[脱敏日志哈希索引](evidence/GLX_NATIVE_PHONE_20261025.json)，不包含原始日志、截图、进程列表、私有配置或包/引擎二进制。
