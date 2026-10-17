# Godot 插件 wx_split：分包接入不用手写

把 `addons/wx_split/` 整个复制到游戏的 `addons/` 下，在 项目设置 → 插件 里启用 `wx_split`（会注册 autoload `WxSplit`）。不想用编辑器的话，直接在 `project.godot` 里写：

```
[autoload]
WxSplit="*res://addons/wx_split/wx_split.gd"
```

要放在其他用到它的 autoload 前面。只在 Godot 4.7.2 上测过。

## 调这几个函数

| 函数 | 什么时候调 | 做什么 |
|---|---|---|
| `await WxSplit.enter_scene(path, scene_tag, gated := true) -> String` | 玩家点“进入玩法” | 打 `click` 事件；`gated` 且是分包版时先过点击门（request → 每帧 status 直到不是 PENDING）；采集包里过门就停；然后 `load(path)` 并切场景 |
| `WxSplit.mark_title_ready(scene_tag := "title")` | 第一个可交互画面（标题）`_ready` 里 | 打 `two_d_first_frame` |
| `WxSplit.mark_first_frame(scene_tag)` | 玩法场景 `_ready` 里 | 打 `scene_first_frame` |
| `WxSplit.is_wechat()`、`WxSplit.is_collect_build()` | 随时 | 在微信里？是分包采集包？电脑上都是 false |
| `WxSplit.qa_mode()`、`WxSplit.qa_arg(name, fallback)`、`WxSplit.has_qa_arg(name)` | 游戏自己的自动测试 | 只负责读开关，玩法由游戏自己实现 |

`enter_scene` 的返回值：

| 返回 | 含义 | 游戏怎么做 |
|---|---|---|
| `"READY"`（`WxSplit.READY`） | 已经切场景 | 什么都不用做 |
| `"TRAINING_DONE"` | 采集包：门已经走完，**故意不加载场景**（避免场景代码被采进首包） | 显示“采集包，已过门”，留在原地 |
| `"BUSY"` | 上一次 `enter_scene` 还没结束 | 忽略这次点击 |
| `"LOAD_FAILED"` | `load()` 或切场景失败 | 显示失败 |
| 以 `_RETRYABLE` 结尾 | 点击门下载失败 | 提示“点一下重试” |
| 以 `_REQUIRED` 结尾 | 点击门进入不可恢复状态（例如首包缺函数） | 提示重启 |

场景用 `enter_scene` 在点击时才 `load()`；余包里的场景**不要在标题里 preload**。`gated` 写“这个场景的代码在余包里吗”的默认值，按分包方案改的话不用改 GDScript，见下面 `WxSplitConfig.gate`。

## JS 侧和游戏配置

`addons/wx_split/wx_split.js` 是插件的 JS 侧，**convert 默认把它装成 `godot-data/wx-split.js`**（在 `wx-compat` 之后、游戏接口 `local-interfaces` 之前加载），游戏不用管。它只提供 GDScript 要的探测函数：点击门新名 `__WXSLIM_CLICK_GATE__` 优先、旧名 `__WX15_RELEASE_CLICK_GATE__` 回退；采集包认 `__WXSLIM_COLLECT_GATE__` 和旧名 `__WX15_TRAINING12_GATE_DIAGNOSTIC__`。GDScript 先问它再 `get_interface` 点击门，所以没分包时不会打 `No interface registered` 错误日志。

游戏的配置写在自己的接口文件（convert `--interfaces`、split 配置 `releaseInterfaces`）里，插件调用时才读，和加载顺序无关：

```js
GameGlobal.WxSplitConfig = {
  gate: {'2d': true},   // 覆盖 enter_scene 的 gated：true 过门、false 不过门（例如方案二把 2D 也放进余包）
  qa: '3d',             // 自动测试模式（只用于测试包），WxSplit.qa_mode() 返回它
};
```

电脑上用命令行代替：`godot --path <项目> -- --qa-play=2d|3d --qa-quit`（`--` 之后的 `--名字=值` 都能用 `qa_arg` 读到；只写 `--qa-play` 等于 `2d`）。

**旧工程**（这次改动前 convert 的产物）没有 `godot-data/wx-split.js`：重新 convert，或者把 `wx_split.js` 拼到接口文件前面（重复加载没关系）。不然 Web 导出里第一次调插件时会打一条 `No interface 'WxSplit' registered`，插件按“没分包”处理。普通浏览器 Web 导出同理，要在 HTML 里先加载 `wx_split.js`。

## 计时事件

插件打印的就是计时模块（`godot-data/wxslim-timing.js`）认的格式，一行：`[STARTUP_3D_FLOW] {"event":"click","scene":"3d"}`。事件：`two_d_first_frame`、`click`、`scene_first_frame`、`transition_failed`（带 `status`）、`collection_gate_complete_3d_blocked`。汇总行见 `split/README.md`“加载计时汇总”。

## 测试

`node tests/run.mjs [--godot <Godot 可执行文件>]`：契约测试覆盖点击门（新旧名、READY / PENDING / 错误码形状）、采集门（新旧名、过门即停）、插件 JS 和 wx-compat 同时加载、事件格式和计时模块对得上；给了 `--godot` 时再 headless 跑 `tests/godot-flow` 截 stdout 核对。改了插件要把 `addons/wx_split/` 复制到 `examples/startap/game/addons/`（测试会检查两份一致）。
