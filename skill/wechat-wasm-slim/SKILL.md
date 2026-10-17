---
name: wechat-wasm-slim
version: 0.2.0
description: >-
  把 Godot 游戏做成微信小游戏并缩小引擎 WASM：Godot Web 导出一条命令转成 WXGameKit 通用适配工程（convert），
  编译期裁剪（去掉用不到的引擎功能，适用于任何微信 Godot 小游戏）和官方 WASM 分包（开局只下载必须的代码，
  适用于通用适配工程）。用户提到“Godot 转微信小游戏”“Web 导出转小游戏”“WXGameKit / 通用适配”“WASM 太大”
  “首包太大”“引擎裁剪”“build profile / .gdbuild”“WASM 分包”“wasmsplit”“开局加载慢”时使用。
metadata:
  short-description: Godot 转微信小游戏、WASM 裁剪与分包
---

# wechat-wasm-slim

工具包根目录：本文件往上两级，记为 `<KIT>`（里面有 `README.md`、`convert/`、`trim/`、`split/`、`cloud/`）。所有说明、回复和报告都用中文。

## 先做这三件事

1. 读 `<KIT>/README.md`。
2. **判断工程类型**，并直接告诉用户：
   - 只有 Godot 项目 / Web 导出（`.js` + `.wasm` + `.pck`）→ 先 **convert** 成通用适配版。
   - 有 `engine/godot.wasm.br` 和 `godot-loader.js` → **模板版**：只能裁剪，不能用官方分包。
   - 有 `wx-game-kit/config.json`，`game.json` 里有 WXGameKit 插件 → **通用适配版**：裁剪和分包都能用。
3. 问清楚目标：只要能在微信里跑（转换），要变小（裁剪），还是要开局更快（分包）。完整顺序：**Godot 导出 Web → convert →（可选）trim 后用新引擎重新 convert → split → 上传/真机**。

## 硬规则

- **外部操作前必须问用户并等到明确同意**：上传体验版、预览、官方 `init`/`dosplit`（会调用微信后台）、云函数部署、任何会改后台设置的操作。用户同意了一次，只覆盖那一次。
- 不覆盖用户的原工程和历史产物：一律输出到新目录（工具本身就会拒绝覆盖）。
- 私钥、AppSecret、登录状态、token、真实 AppID 不打印、不进仓库、不发聊天。AppID 优先用 `convert --appid-from <已有工程>` 传递；读开发者工具控制台时要过滤掉 AppID 和账号信息。私钥只通过配置的路径或环境变量 `WASMSPLIT_KIT_KEY` 使用。
- 测量和验证要如实报告：没测的写“未测”；模拟器通过不等于手机通过。
- 采集和最终验证需要人在手机上操作（开发者工具无法自动点击 Godot 画布），到这一步要明确告诉用户该怎么玩。

## 转换（convert）

```
node <KIT>/convert/convert.mjs check   --export <Web导出目录> [--pck <x.pck>] [--symbols <x.js.symbols>]
node <KIT>/convert/convert.mjs convert --export <Web导出目录> --appid-from <已有小游戏工程> --out <新目录> [--interfaces <游戏JS接口.js>] [--orientation landscape]
node <KIT>/convert/convert.mjs verify  --project <新目录>/minigame
```

- 先读 `<KIT>/convert/README.md`。`check` 不过就停下，把 ✗ 项用中文告诉用户（最常见：引擎不是 citizenll/godot 微信分支、多线程模板、没装官方 wx-transformer 1.0.35）。
- 官方 wx-transformer 是本机运行的便携 exe，路径和 sha256 在 `convert/convert.toolchain.json`；没有就告诉用户下载地址，**下载前问用户**。
- 没有 AppID 时可以先用占位符转换，但开发者工具打开前要有真实 AppID（后台已添加 WXGameKit 插件）。
- 用 GDScript `JavaScriptBridge.get_interface` 的游戏，要让用户提供对应的 JS 接口文件（`--interfaces`），否则会报 `No interface 'X' registered`。
- `verify` 0 失败后，用 `node <KIT>/split/kit.mjs ide open --config <配置> --project <新目录>/minigame` 本地打开（只 open/refresh/console/screenshot，不预览、不上传）。开发者工具刚打开时控制台可能是空的，要 refresh 后等编译完成再读。控制台出现 `[WX15_BOOT] CALL_MAIN` 和游戏自己的首帧日志才算进了游戏；3D 和完整玩法要用户手动玩。
- 网络合法域名、存档、登录、支付、分享、广告等游戏自身的微信适配，convert 不管，要提醒用户。

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
- 编译要 30–50 分钟。要用不会被打断的方式在后台运行（独立进程，日志写到文件），完成后读 `BUILD.json` 报告大小。失败时用同一个 `--work` 目录重跑即可续编；clang 偶发崩溃（0xC0000005）会自动重试，频繁时加 `--jobs 4`。编译目录放在工具包外面。
- 模板版：`apply` 生成新工程后，让用户在开发者工具或手机上**把游戏完整玩一遍**，确认没被裁坏。
- 通用适配版：用 `artifacts/` 当引擎输入**重新 convert 到新目录**（`--export <work>/artifacts --pck <游戏.pck>`），再让用户完整玩一遍。引擎变了，就要重新做官方 init 和分包采集。

## 分包（split，只适用于通用适配版）

先读 `<KIT>/split/README.md` 和 `<KIT>/split/SETUP.md`。输入工程用 convert 产物（`workProject` = `<out>/minigame`，`symbols` = `<out>/webgl/symbols.json`），先跑 `convert verify`；用户自己的工程按 SETUP 第 3 节检查，不满足就停下，跟用户说明缺什么。

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
