# wasmsplit-kit：微信小游戏 WASM 分包工具

把历史实验里验证过的一次性脚本，合成一个可复用的命令行工具（历史记录见 [PLAYBOOK](../docs/PLAYBOOK.md)）。每个游戏写一份配置文件（参考 [Star Tap 示例](../examples/startap/planB.kit.json)），用同一套命令完成整个流程。

已验证：
- 打砖块：组装出的核心运行时 `wasm-split.js` 与真机验证过的体验版 0.12.8 逐字节相同；离线测试全部通过。
- **Star Tap（2026-10-17，新游戏从零走完）**：iPhone 做第一轮采集 → Release → 组装 → iPhone 实测，首包 WASM 3.04 MB、余包 3.55 MB，两种进入顺序、0 次缺函数。见 [examples/startap/RESULT.md](../examples/startap/RESULT.md)。

## 两种瘦身方式（可以叠加）

| | 编译期裁剪 | 按实测分包 |
|---|---|---|
| 原理 | Godot build profile（`.gdbuild`）在编译引擎时去掉不用的模块和类 | 官方 V2 采集运行时实际调用的函数，首包只放这些函数 |
| 安全性 | 确定：去掉的东西编译期就不存在 | 依赖采集覆盖面：没采到的路径会缺函数 |
| 代价 | 重新编译引擎（25–50 分钟），md5 变化，要重新采集 | 要在真机上采集 |
| 本工具 | [trim/trim.mjs](../trim/trim.mjs)（编出的引擎用 [convert](../convert/README.md) 重新转换） | `assemble` 的两种模式 |

推荐顺序：**先编译期裁剪，再按实测分包**。裁剪后 md5 会变，分包采集必须在裁剪之后做。

## 分包的两种模式

- `--mode onclick`（默认，已上真机）：首包 = 进入玩法场景之前用到的函数。剩余 WASM 在玩家点击进入时才下载。游戏需要调用点击门 API（见下文“接入约定”）。
- `--mode measured`：首包 = 完整玩一遍实测用到的全部函数。点击时不下载，直接就绪。次包只作为保险：安卓缺函数时同步拉取；iOS 无法同步等待，只能报错，日志里会带函数编号。
  - 加 `--drop-secondary`：次包根本不打进包里，总体积最小；但没采到的路径一旦被调用就会报错。**只在多台安卓和 iOS 真机充分采集后使用。**
  - 实测模式需要先用 `collect-pack --full-game` 做“完整游戏采集”。

官方 V2 只有“首包 + 一个余包”。onclick 模式下首包放什么由游戏决定：Star Tap 的 `gate2d` 开关演示了“标题+2D 首包、3D 余包”和“标题首包、2D+3D 余包”两种划法。

## 命令

所有命令都要带 `--config <游戏配置.json>`。路径相对于配置文件所在目录。

```
node kit.mjs info --project <dir>                          # 查看 md5、subVersion、首包/次包大小
node kit.mjs split init [--desc "描述"]                     # 官方 init：上传 WASM 和符号表（先问用户；同一 md5 只做一次，重做加 --again）
node kit.mjs split profile|release|getinfo|showfuncname    # 调用官方 CLI（作用于配置里的 workProject）
node kit.mjs collect-pack --from <Profile产物> --out <dir> --label <唯一标记> [--full-game]
node kit.mjs assemble --from <Release产物> --out <dir> --label <唯一标记> [--mode measured] [--drop-secondary]
node kit.mjs verify --project <dir>                        # 离线测试（按包里的模式自动选择用例）
node kit.mjs ide open|refresh|console|screenshot|close --project <dir> [--grep "grep WXSLIM_TIMING"]
node kit.mjs preview --project <dir>                       # 推送手机预览（先问用户），输出各分包大小
node kit.mjs upload --project <dir> --version 0.x.y --desc "备注"   # 上传开发版/体验版，需要在开发者工具里人工确认
node kit.mjs task --id <taskId>                            # 查询上传确认结果
node kit.mjs logs --project <dir> [--since ISO时间]         # 读云日志（只读），输出中文摘要
node kit.mjs lookup <槽位编号...>                           # 兜底/缺函数日志里的编号 → 函数名
```

- `--label` 是云日志的构建标记，**每个包都必须唯一**。工具会在 `ledgers/labels.json` 里登记，重复使用会直接报错。
- `split`、`upload` 都会写台账，不会自动重试；失败后看台账和私有日志，再决定是否重新发起。
- `upload` 前**不要关项目窗口**，否则会立刻返回 abort。
- `preview` 只推到当前登录开发者工具的微信；其他手机在开发者工具里点“预览”扫码（需要开发者或体验成员权限）。

## 新游戏完整流程

1. 用 [convert](../convert/README.md) 把 Godot Web 导出转成 WXGameKit 通用适配工程（`convert` → `verify` → 开发者工具人工玩一遍）。产物 `<out>/minigame` 就是配置里的 `workProject`（里面已有官方 init 要的 `game.symbols.json`），`<out>/webgl/symbols.json` 就是 `symbols`。要裁剪的话先裁剪、用新引擎重新 convert。
2. （问用户）`split init`：上传 WASM 和符号，进入采集状态。后台预处理要几分钟（Star Tap 280 s）。
3. 游戏代码接入点击门（见下文）。
4. `collect-pack` → （问用户）`preview` → **一台手机**（安卓或 iPhone 都行）把首包要覆盖的操作都走一遍，点击进入按钮若干次。
5. `split getinfo` 看采集到的函数数 → `split release`。
6. `assemble` → `verify` → `ide open` 本地检查 → （问用户）`preview` 或 `upload` → 真机测试 → `logs` 读结果。**发布前安卓和 iPhone 都要测**：不同平台会走到不同的引擎代码。
7. 日志里出现“首包缺函数”时，用 `lookup` 查槽位，在出错的设备上 `split profile` 补采一轮，再 release。

第一轮采集首包很小，启动阶段就会调用余包里的函数。采集包已经处理了这一点：不能同步等余包的设备（iPhone 高性能模式、开发者工具）会先异步加载余包再进游戏，所以采集包启动会慢几秒，正式包不受影响。

## 游戏接入约定（点击门）

> 实测模式（measured）不需要接入点击门，游戏代码不用改。PCK 替换是可选的：配置不写 PCK 时，直接使用工程自带的 PCK。输入工程要满足的条件见 SETUP.md 第 3 节。

运行时会在全局暴露 `__WXSLIM_CLICK_GATE__`，提供 `request()`、`status()`、`cancel()`，都返回字符串：`IDLE`、`PENDING`、`READY`，或以 `_REQUIRED` / `_RETRYABLE` 结尾的错误码。完整写法见 [Star Tap 的 game.gd](../examples/startap/game/scripts/game.gd) `_enter_scene()`：

```gdscript
var gate := JavaScriptBridge.get_interface("__WXSLIM_CLICK_GATE__")
var status := str(gate.request())
while status == "PENDING":
    await get_tree().process_frame
    status = str(gate.status())
if status != "READY": # 显示失败并返回
    return
if 是采集包:  # 采集包里过门就停，不加载场景
    return
var scene: PackedScene = load("res://scenes/play3d.tscn")  # 余包里的场景在这里才 load，不要 preload
```

- **不要直接 `get_interface` 一个可能不存在的名字**（没分包时会打错误日志）：先在游戏的 JS 接口里判断全局对象是否存在（Star Tap 的 `DemoWx.hasClickGate()`）。
- **采集包判断**：训练等待门会发布 `GameGlobal.__WXSLIM_COLLECT_GATE__`，游戏 JS 接口据此返回“是采集包”（Star Tap 的 `DemoWx.isTraining()`）。这样正式包和采集包用同一个 PCK，配置里不用写 `trainingPck`。
- 点击之后、READY 之前执行的代码（输入处理、等待门轮询、UI）都必须被采集到首包里，采集时要原样走这一段。
- **加载计时汇总**（convert 和 split 产物都自带，日志前缀 `[WXSLIM_TIMING]`）：游戏用 `print('[STARTUP_3D_FLOW] {"event":...}')` 打这几个事件就行（`console.info('[STARTUP_3D_FLOW]', json)`、字段名 `stage` 也认）：
  - `two_d_first_frame`：第一个可交互画面（标题）出现 → 输出“首包进场景：总计 | 插件加载器 | 首包 WASM 下载编译 | callMain …”
  - `click`（带 `scene`）：点了进某个场景；`scene_first_frame`（带 `scene`）：那个场景第一帧 → 输出“点击进X：总计 | 下载剩余WASM | 编译实例化 | 场景加载到首帧”，再次进入、不需要下载的场景也各有一行
  - `game_3d_first_frame`（等同 `scene_first_frame` + `3d`）、`transition_failed`（带 `scene`、`status`）
  - 不打印也不影响分包，只是少了对应的汇总行。`kit verify` 会用契约测试检查包里的计时模块能认出这些写法。

## 文件

- `kit.mjs`：命令入口。
- `lib/runtime-patches.mjs`：官方运行时补丁（锚点必须唯一匹配；运行时模板按“函数表大小归一化”后的 sha 核对，不在白名单时拒绝执行，除非加 `--allow-unknown-runtime`）。采集包补丁：计时标记 + 不能同步等待的设备先加载余包。
- `lib/common.mjs`：PCK 替换、打包修正、计时与云日志安装、开发者工具和官方 CLI 调用。
- `lib/offline-tests.mjs`：离线测试（模拟 wx，waiterMode 任务只有 await() 才完成）。
- `lib/lookup.mjs`：槽位 → 函数名（官方拆分新增的跳转槽位查不到，会明确提示）。
- `assets/`：点击门核心、计时模块（中文汇总、帧率、内存、着色器、日志精简）、云日志转发、训练等待门。

## 计划中

- 三包（标题 / 2D / 3D 各一个）需要自研拆分（Binaryen `--multi-split`），官方 V2 只支持两层。
- 点击后的下载、编译耗时进云日志汇总。
