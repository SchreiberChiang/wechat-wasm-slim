---
name: wechat-wasm-slim
version: 0.1.0
description: >-
  缩小微信 Godot 小游戏的引擎 WASM，加快开局：编译期裁剪（去掉用不到的引擎功能，适用于任何微信 Godot 小游戏）
  和官方 WASM 分包（开局只下载必须的代码，适用于 WXGameKit 通用适配工程）。用户提到“WASM 太大”“首包太大”
  “引擎裁剪”“build profile / .gdbuild”“WASM 分包”“wasmsplit”“只保留用到的代码”“开局加载慢”时使用。
metadata:
  short-description: 微信 Godot 小游戏 WASM 裁剪与分包
---

# wechat-wasm-slim

工具包根目录：本文件往上两级，记为 `<KIT>`（里面有 `README.md`、`trim/`、`split/`、`cloud/`）。所有说明、回复和报告都用中文。

## 先做这三件事

1. 读 `<KIT>/README.md`。
2. **判断工程类型**，并直接告诉用户：
   - 有 `engine/godot.wasm.br` 和 `godot-loader.js` → **模板版**：只能裁剪，不能用官方分包。
   - 有 `wx-game-kit/config.json`，`game.json` 里有 WXGameKit 插件 → **通用适配版**：裁剪和分包都能用。
3. 问清楚目标：只要变小（裁剪），还是要开局更快（分包），还是两者都要。两者都要时**先裁剪，再分包**。

## 硬规则

- **外部操作前必须问用户并等到明确同意**：上传体验版、预览、官方 `init`/`dosplit`（会调用微信后台）、云函数部署、任何会改后台设置的操作。用户同意了一次，只覆盖那一次。
- 不覆盖用户的原工程和历史产物：一律输出到新目录（工具本身就会拒绝覆盖）。
- 私钥、AppSecret、登录状态、token 不打印、不进仓库、不发聊天。私钥只通过配置的路径或环境变量 `WASMSPLIT_KIT_KEY` 使用。
- 测量和验证要如实报告：没测的写“未测”；模拟器通过不等于手机通过。
- 采集和最终验证需要人在手机上操作（开发者工具无法自动点击 Godot 画布），到这一步要明确告诉用户该怎么玩。

## 裁剪（trim）

```
node <KIT>/trim/trim.mjs check
node <KIT>/trim/trim.mjs scan --project <Godot项目目录> --out <配置.json>
node <KIT>/trim/trim.mjs profile --config <配置.json> --out <x.gdbuild>
node <KIT>/trim/trim.mjs build --config <配置.json> --work <新编译目录>
node <KIT>/trim/trim.mjs apply --engine <编译目录>/artifacts --minigame <小游戏工程> --out <新工程目录>
```

- `check` 失败：按报错补工具链（emscripten 必须是 4.0.10；源码要是 citizenll/godot 微信分支），路径写进 `trim/trim.toolchain.json`。
- `scan` 之后，**把配置要点用中文讲给用户**：用到了哪些大功能、各档位会关掉什么、风险是什么。让用户选档位，以及要不要在“手动覆盖”里保留某些能力。用户确认后再编译。
- 扫描只认写出来的类名。项目里如果有 `ClassDB.instantiate`、字符串拼出来的类名、运行时 `load` 外部资源、插件（addons），要提醒用户，并在“手动覆盖”里保留相关能力。
- 编译要 30–50 分钟。要用不会被打断的方式在后台运行（独立进程，日志写到文件），完成后读 `BUILD.json` 报告大小。失败时用同一个 `--work` 目录重跑即可续编。
- 模板版：`apply` 生成新工程后，让用户在开发者工具或手机上**把游戏完整玩一遍**，确认没被裁坏。
- 通用适配版：把 `artifacts` 里的 `godot.wasm`、`godot.js`、`godot.js.symbols` 交给用户自己的导出流程。引擎变了，就要重新做官方 init 和分包采集。

## 分包（split，只适用于通用适配版）

先读 `<KIT>/split/README.md` 和 `<KIT>/split/SETUP.md`。按 SETUP 第 3 节检查输入工程是否满足条件；不满足就停下，跟用户说明缺什么。

两种模式：
- `--mode measured`（游戏代码不用改）：采集时把**整个游戏**（包括重场景）在安卓和 iPhone 上都玩一遍。首包 = 实测用到的全部函数。`--drop-secondary` 会把其余代码整个不打包，只在多机型充分采集后才建议使用。
- `--mode onclick`（默认）：首包只放进入重场景前用到的函数，点击时才下载其余代码。需要游戏代码调用点击门，还要一个训练版 PCK。

流程：`split profile` →（问用户）上传采集版 → 用户在安卓和 iPhone 上玩 → `split getinfo` / `showfuncname` → `split release` → `assemble` → `verify`（离线测试必须全部通过）→ `ide open` 本地检查 →（问用户）`upload` → 用户真机测试 → `logs` 读中文汇总。

已知的坑（详见 `split/README.md` 和 PLAYBOOK）：
- 每个上传版本的 `--label` 必须唯一，否则云日志分不清版本。
- 上传前不要关项目窗口，否则会返回 abort。
- 体验版要在后台手动切换；手机可能缓存旧版本，要让用户从“最近使用”删掉再进入。
- 日志里出现“首包缺函数”时，用 `kit lookup <编号>` 查函数名，然后补采一轮。
- 安卓和 iOS 真机都要采集；只用电脑采集不够。

## 汇报格式

完成一步就用中文简要报告：做了什么、结果数字（大小、耗时）、下一步需要用户做什么。数字要对比前后，比如“8.69 MB → 5.08 MB（-41.5%）”。
