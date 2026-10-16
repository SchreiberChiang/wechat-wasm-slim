# wasmsplit-kit：微信小游戏 WASM 分包工具

把历史实验里验证过的一次性脚本，合成一个可复用的命令行工具（历史记录见 [PLAYBOOK](../docs/PLAYBOOK.md)）。每个游戏写一份配置文件（参考 [打砖块示例](../examples/breakout-split/breakout.kit.json)），用同一套命令完成整个流程。

已验证：用本工具从 Release5 原始产物组装出的包，核心运行时 `wasm-split.js` 与真机验证过的体验版 0.12.8 **逐字节相同**；数据包、计时模块和 game.js 也一致。其余差异只有项目名、日志标记，以及白名单正则里两项的顺序（效果相同）。离线测试全部通过。

## 两种瘦身方式（可以叠加）

| | 编译期裁剪 | 按实测分包 |
|---|---|---|
| 原理 | Godot build profile（`.gdbuild`）在编译引擎时去掉不用的模块和类 | 官方 V2 采集运行时实际调用的函数，首包只放这些函数 |
| 安全性 | 确定：去掉的东西编译期就不存在，用到会编译或导出失败 | 依赖采集覆盖面：没采到的路径会缺函数 |
| 代价 | 重新编译引擎（几十分钟），md5 变化，要重新采集 | 要在真机上采集 |
| 已有结果 | 只保留 2D 的版本：8.69 → 5.08 MB（-41.5%）；保留 3D 的配置已写好，未编译 | 首包 3.54 MB（完整 WASM 8.52 MB） |
| 本工具 | 独立入口 [trim/trim.mjs](../trim/trim.mjs) | `assemble` 的两种模式 |

推荐顺序：**先编译期裁剪，再按实测分包**。裁剪后 md5 会变，分包采集必须在裁剪之后做。

## 分包的两种模式

- `--mode onclick`（默认，已上真机）：首包 = 进入重场景之前用到的函数。剩余 WASM 在玩家点击进入重场景时才下载。游戏需要调用点击门 API（见下文“接入约定”）。
- `--mode measured`：首包 = 完整玩一遍（含重场景）实测用到的全部函数。点击时不下载，直接就绪。次包只作为保险：安卓缺函数时同步拉取；iOS 无法同步等待，只能报错，日志里会带函数编号。
  - 加 `--drop-secondary`：次包根本不打进包里，总体积最小；但没采到的路径一旦被调用就会报错。**只在多台安卓和 iOS 真机充分采集后使用。**
  - 实测模式需要先用 `collect-pack --full-game` 做“完整游戏采集”（采集包可以进入重场景）。只采过 2D 的产物不能用实测模式，会在进入 3D 时缺函数。

## 命令

所有命令都要带 `--config <游戏配置.json>`。路径相对于配置文件所在目录。

```
node kit.mjs info --project <dir>                          # 查看 md5、subVersion、首包/次包大小
node kit.mjs split profile|release|getinfo|showfuncname    # 调用官方 CLI（作用于配置里的 workProject）
node kit.mjs collect-pack --from <Profile产物> --out <dir> --label <唯一标记> [--full-game]
node kit.mjs assemble --from <Release产物> --out <dir> --label <唯一标记> [--mode measured] [--drop-secondary]
node kit.mjs verify --project <dir>                        # 离线测试（按包里的模式自动选择用例）
node kit.mjs ide open|refresh|console|screenshot|close --project <dir> [--grep "grep WX15_TIMING"]
node kit.mjs upload --project <dir> --version 0.x.y --desc "备注"   # 需要在开发者工具里人工确认
node kit.mjs task --id <taskId>                            # 查询上传确认结果
node kit.mjs logs --project <dir> [--since ISO时间]         # 读云日志（只读），输出中文摘要
node kit.mjs lookup <槽位编号...>                           # 兜底/缺函数日志里的编号 → 函数名
```

- `--label` 是云日志的构建标记，**每个上传版本都必须唯一**。工具会在 `ledgers/labels.json` 里登记，重复使用会直接报错（之前 0.12.4 和 0.12.5 共用标记，日志分不清）。
- `split`、`upload` 都会写台账，不会自动重试；失败后看台账和私有日志，再决定是否重新发起。
- `upload` 前**不要关项目窗口**，否则会立刻返回 abort。

## 新游戏完整流程

1. 导出微信小游戏（WXGameKit 通用适配），用官方 CLI `init` 上传 WASM 和符号，进入 Profile0。这一步只做一次，md5 变化时才需要重做。
2. 游戏代码接入点击门（见下文）。准备两个 PCK：正式 PCK，以及训练 PCK（点击后走完等待门，但不进入重场景）。
3. `collect-pack` → 上传为体验版 → **安卓和 iOS 真机**各玩一遍：2D 全部操作，点击进入按钮若干次。
4. `split getinfo` / `showfuncname` 检查采集到的新增函数 → `split release`。
5. `assemble` → `verify` → `ide open` 本地检查 → `upload`（新版本号、新标记）→ 真机测试 → `logs` 读结果。
6. 日志里出现“首包缺函数”时，用 `lookup` 查函数名，再 `split profile` 补采一轮。

## 游戏接入约定（点击门）

> 实测模式（measured）不需要接入点击门，游戏代码不用改。PCK 替换是可选的：配置不写 PCK 时，直接使用工程自带的 PCK。输入工程要满足的条件见 SETUP.md 第 3 节。

运行时会在全局暴露 `__WX15_RELEASE_CLICK_GATE__`，提供 `request()`、`status()`、`cancel()`，都返回字符串：`IDLE`、`PENDING`、`READY`，或以 `_REQUIRED` / `_RETRYABLE` 结尾的错误码。GDScript 侧可参考下面的等待流程：

```gdscript
var gate := JavaScriptBridge.get_interface("__WX15_RELEASE_CLICK_GATE__")
var status := str(gate.request())
while status == "PENDING":
    await get_tree().process_frame
    status = str(gate.status())
if status != "READY": # 显示失败并返回
    return
# 这之后才能用到重场景的类、资源和渲染
```

- 点击之后、READY 之前执行的代码（输入处理、等待门轮询、UI）都必须被采集到首包里，所以训练 PCK 要原样走这一段。
- 计时汇总依赖 Godot 打印 `[STARTUP_3D_FLOW]` 事件里的 `two_d_first_frame`、`game_3d_first_frame`、`transition_failed`。新游戏可以照这些事件名打印；不打印也不影响分包，只是少了对应的汇总行。
- 建议以后把“采集模式”改成运行时开关（例如由 JS 全局变量控制），这样正式 PCK 和训练 PCK 可以合并成一个。

## 文件

- `kit.mjs`：命令入口。
- `lib/runtime-patches.mjs`：官方运行时补丁（锚点必须唯一匹配；运行时模板 sha 不在白名单时拒绝执行，除非加 `--allow-unknown-runtime`）。
- `lib/common.mjs`：PCK 替换、打包修正、计时与云日志安装、开发者工具和官方 CLI 调用。
- `lib/offline-tests.mjs`：离线测试（模拟 wx，waiterMode 任务只有 await() 才完成）。
- `lib/lookup.mjs`：槽位 → 函数名。
- `assets/`：点击门核心、计时模块（中文汇总、帧率、内存、着色器、日志精简）、云日志转发、训练等待门。
- [打砖块接口示例](../examples/breakout-split/breakout-local-interfaces.js)：游戏专属的 local-interfaces.js。

## 计划中

- 把独立的 `trim/trim.mjs` 与分包流程进一步衔接；目前的使用入口见 [工具包 README](../README.md)。
- 合并正式 PCK 和训练 PCK（运行时采集开关）。
- 三层分包（首场景 / 重场景 / 从未用到）需要自研拆分（binaryen wasm-split），官方 V2 只支持两层。
