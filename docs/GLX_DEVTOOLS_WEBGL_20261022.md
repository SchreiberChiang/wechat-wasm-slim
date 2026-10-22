# 最小示例 WebGL 开发者工具实测（2026-10-22）

本记录补充 [静态与构建验证](GLX_LOCAL_VALIDATION_20261022.md)，只覆盖电脑开发者工具中的同一份默认 WebGL 包。游戏内诊断摘要读取已通过；没有修改输入实现来促成通过。

## 环境和隔离

- 分支 `codex/glx-adaptation-20261022`，运行时代码提交 `69379e167678ae59f0714f88513e5b2d9b4932e4`。
- 微信开发者工具 `2.02.2609231 RC`，基础库 `3.17.4`，模拟器 iPhone 12/13 (Pro)；这是电脑模拟环境，不是 iPhone 实测。
- 沿用本轮独立 WebGL 窗口 `s0`，项目 `.local/glx-ide-20261022-2222/webgl`，窗口名 `wxslim-glx-smoke-webgl-2222`。没有重启、清缓存或替换包。
- 包来自 `.local/glx-smoke/webgl-03/minigame`。33 个包文件逐字节复核，仅 `project.config.json` 的本地 AppID/项目名及 `wx-game-kit/config.json` 的 AppID 不同；引擎、PCK、桥、接口及 render manifest 均未改变。
- 原始日志、截图和本地账号配置只留在忽略目录 `.local/glx-ide-20261022-2222/`。本次没有修改赛车仓库、其他会话工作区，也没有操作 GLX 窗口、手机、上传或云报告工具。

## 已确认结果

| 项目 | 结果和范围 |
| --- | --- |
| 默认 WebGL 实际启动 | `MAIN_RETURNED`，factory/main 各一次，PCK 已挂载；摘要为 initialized |
| 可见画面 | 主视口 2D、离屏 2D 的色条/移动圆实际可见；切换后 3D 立方体可见，连续观察中姿态变化 |
| 游戏内摘要按钮 | 两次 `[GLX_SMOKE_MANUAL_DIAGNOSTIC]`，对应控制台记录 92、130；两次均在游戏 TextEdit 显示 JSON |
| 无临时探针复核 | 第二次摘要读取在全部临时监听移除后完成；2D/3D 切换及离屏 640×240 → 320×120 按钮同样可用 |
| 包检查 | `convert verify`：36 通过、2 注意、0 失败；注意为此独立拷贝未带包外 symbols.json、未做会上传 WASM 的官方 init。未执行 init |
| 主画布 resize / 前后台恢复 / 手机触摸 | 未验证；离屏 resize 和电脑鼠标模拟触摸不能替代 |

实际游戏内读取的字段如下，未将画面观察反写为运行时自证：

```json
{
  "packageVersion": "wxslim-3707af110530996169cf",
  "versions": { "godot": "4.7.2", "transformer": "1.0.35", "wxGameKit": "1.3.15" },
  "requestedMode": "webgl",
  "capability": { "present": false, "value": null },
  "actualContext": { "mode": "webgl", "webgl2": true },
  "observationStatus": "available",
  "native": {},
  "initialization": "initialized",
  "failureReason": null,
  "visibleRendering": "not_verified",
  "lifecycle": { "hide": 0, "show": 1, "resize": 0, "recovery": "not_verified" },
  "nativeBindings": true,
  "offscreenResizeFunction": false,
  "moduleContextMatches": null
}
```

`nativeBindings=true` 不代表使用 GLX；实际模式仍是 WebGL。`moduleContextMatches=null` 不得解读成 GLX 上下文匹配已通过；`offscreenResizeFunction` 是 native GLX helper 观察项，不能代替 Godot SubViewport 尺寸测试。

## 按钮无响应的定位边界

已确认一个工具上下文问题：CLI `automation_evaluate` 取得的对象没有诊断接口/画布，`automation_game_action` 在 image 与 canvas 两种坐标模式均报 `canvas not found`；但该窗口的真实 `gameContext` 同时有画布、完整诊断接口和正在绘制的 Godot。不能用 CLI 的 null 推断游戏没有初始化，也不能把这种失败算作点击已经送达。

在本窗口控制台选择 `gameContext` 后只读确认：

- `Module.canvas === GameGlobal.canvas === window.canvas`。
- 实际 canvas 为 1170×2532，逻辑 rect 为 390×844，比例为 3。
- `WxSlimGlxSmoke` 接口存在，实际 bridge 已完成 main。

受限临时观察期间只监听、不改写或补发事件。成功点击摘要时，微信原始事件和 Module.canvas 均收到成对的 touchstart/touchend：identifier 为 0，client 坐标约 (195.21, 393.70)，两层一致且坐标是可枚举自身属性。随后游戏打印并显示摘要。观察器通过原回调引用移除，临时全局入口删除；第二次摘要读取不依赖观察器。

仍有一个未定项：Computer Use 原生瞬时单击有时未见按钮状态变化；按钮内轻微移动的按下/释放手势成功，之后普通单击也成功。一次无即时日志的对照测得普通点击 26 ms、轻微移动手势 18 ms，两者均成功。**这不支持“按压必须更久”或“必须先移动”的根因结论。** 不能把加探针、手势或等待解释成输入代码修复；确切的偶发原因尚未捕获。静态检查也未发现按钮被覆盖、回调未连接、SDK 删除探针误删原监听等问题。

因此本次没有修改 Godot 输入仿真开关、事件转发、默认 WebGL 桥或示例代码。已完成的是实际游戏内读取验证及自动化上下文问题定位；电脑原生单击的偶发差异保留为工具交互未定项。

## 可复核的本地证据

下列文件均相对于 `.local/glx-ide-20261022-2222/evidence/`，不进入 Git：

- `webgl-2d.jpg`：默认主视口/离屏 2D。
- `webgl-input-probe-events.txt`：成功摘要点击的原始 wx 与 canvas 成对事件。
- `webgl-manual-success.jpg`：第一次游戏内完整摘要画面。
- `webgl-touch-timings.txt`：26 ms / 18 ms 的成功对照，不能用来构造失败阈值。
- `webgl-manual-no-probe-console.txt`：两次手动读取记录；第二次在移除全部探针后。
- `webgl-manual-no-probe.jpg`：第二次摘要与 3D 可见画面。
- `webgl-resize-no-probe.jpg`：无探针的 3D、320×120 离屏状态和摘要。
- `webgl-byte-audit.json`、`webgl-verify-resume.txt`：包字节保持不变及检查结果。

`webgl-3d-no-probe.jpg` 记录的是一次没有切换成功的普通点击，实际仍为 2D；不要只按文件名判定通过。`get_simulator_console` 的带上下文 grep 在本机未取得完整多行 JSON；空结果不等于没有摘要。以游戏截图、控制台实际显示和具体字段为准。

## GLX 和后续范围

此前独立 GLX 窗口只启动过一次，未取得可归因的门禁摘要，后续自动化读取出现超时及 APPID_ERROR/TLS 连接中断。本次按用户要求完全未重试。WebGL 摘要中的能力位缺失不能冒充那次 GLX 启动的失败摘要；没有 GLX 实际初始化或兼容性结论。

最小真机方案见 [示例 README](../examples/glx-smoke/README.md)。本次电脑阶段结束时手机操作、上传和云报告仍待单独批准，成功的 WebGL 窗口予以保留。用户随后批准的最小包手机对照预览及其结果另见 [手机验证记录](GLX_PHONE_VALIDATION_20261022.md)，不改写以上电脑阶段证据。
