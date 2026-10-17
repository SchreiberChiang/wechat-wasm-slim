# 在干净环境使用 wasmsplit-kit：需要准备什么

本工具接手的是**已经能在微信里跑起来的 Godot 小游戏工程**，负责之后的分包、组装、上传和读日志。Godot Web 导出转成小游戏工程用 [convert](../convert/README.md)（产物满足第 3 节第 1、4 条；第 2 条用 `kit split init`，需授权后再做）；用自己的导出方案也可以，只要满足第 3 节的“输入约定”。

## 1. 账号与后台（需要 AppID 管理员操作）

| 项目 | 说明 | 必需 |
|---|---|---|
| 小游戏 AppID | 使用者加为**开发者**；测试的人加为**体验成员**（不是成员的话，体验版或开发版可能一直转圈） | 是 |
| WXGameKit 插件 | 后台添加 `WXGameKit`（provider `wxe5a48f1ed5f544b7`，本例用 1.3.15），通用适配工程需要 | 是 |
| 代码分包 V2 私钥 | 小游戏管理后台生成 CI 私钥（PEM），给官方 `wasmsplit-v2-ci` 签名用。私钥放在仓库之外，不提交，不发聊天 | 是 |
| 云开发环境 | 只有云日志需要：开通云开发环境，部署 `phoneLogIngest` 云函数，建集合 `phone_log_batches`。云开发可能产生费用 | 可选 |

`phoneLogIngest` 源码见本工具包 `cloud/`（[说明](../cloud/README.md)）。不开云日志也能用：手机上的 vConsole 里一样能看到中文汇总行。

## 2. 本机软件

| 软件 | 版本（本次验证用的） | 用途 |
|---|---|---|
| Windows | 10/11 | 脚本按 Windows 写，macOS 需要改开发者工具的调用方式 |
| 微信开发者工具 | 2026-10 版（skill 0.3.11 对应版本） | 本地运行、上传体验版、读云日志。首次被调用时要点授权，并用有 AppID 权限的微信登录 |
| Node.js | 24 | 运行本工具 |
| wasmsplit-v2-ci | 2.1.5（`npm install wasmsplit-v2-ci@2.1.5`） | 官方分包 CLI。工具只认核对过的运行时模板，换新版本要重新核对 |
| Godot 编辑器 | 与工程一致（本例 4.7.2） | 导出 PCK |
| 手机 | 一台安卓或 iPhone 就能开始采集 | 发布前安卓和 iPhone 都要实测 |

## 3. 输入工程约定（使用者自己的导出方案要满足的条件）

**必须满足**
1. 是 **WXGameKit 通用适配**结构的小游戏工程：有 `game.js`、`game.json`、`project.config.json`、`wx-game-kit/config.json`（含 `launch.code.fileMD5`、`launch.data`），WASM 在 `wasmcode/<md5>.wasm.br`。
2. 已经做过官方 `init`（`node kit.mjs split init`，同一个 md5 只做一次），工程里有 `.plugincache/codesplitv2/`。配置里的 `workProject` 就指向这个工程。init 要求工程目录里有 `game.symbols.json`（convert 会生成，并从小游戏包排除）。
3. 官方生成的运行时 `wasm-split.js` 是已核对的模板（wasmsplit-v2-ci 2.1.5；第 2 行 `const tableSize = N` 随游戏变化，工具会归一化后再核对）。不是的话，工具会拒绝执行；需要先核对补丁锚点，再加 `--allow-unknown-runtime`。
4. 有完整 WASM 的符号表（`symbols.json`），供 `lookup` 把函数编号换算成名字用。

**按模式不同**
- **点击模式（onclick）**：游戏在进入重场景前要调用点击门 `__WXSLIM_CLICK_GATE__`（见 README 的“游戏接入约定”）；采集包要原样走完“点击 → 等待 → 就绪”，但不进入重场景。推荐游戏自己判断采集包（训练门会发布 `__WXSLIM_COLLECT_GATE__`），这样不用单独导出训练 PCK。
- **实测模式（measured）**：**游戏代码不用改**。采集时正常完整地玩一遍即可；首包已经包含实测用到的全部函数，不调用点击门也能运行。

**可选**
- **PCK 替换**：配置里写了 `releasePck` / `trainingPck`，工具才会替换 PCK。例如只改了游戏设置、WASM 不变时，换 PCK 不用重新 init 和采集。这一步依赖 convert 生成的 `godot-data/package-info.js`；不写这两项时直接使用工程里现有的 PCK。
- **训练等待门挂在哪个脚本**：`trainingGateHost`，默认 `godot-data/local-interfaces.js`，可以改成游戏启动时已经加载的任意 JS 文件。
- **计时汇总的数据来源**：
  - 首包 WASM 就绪、点击、下载、编译、callMain 来自运行时补丁，任何工程都有。
  - 2D 首帧、进 3D 首帧需要游戏打印 `[STARTUP_3D_FLOW]` 事件（`two_d_first_frame`、`game_3d_first_frame`、`transition_failed`）。
  - callMain 内部分解需要引擎里的 `WX_NATIVE_*` 埋点：trim 默认的启动补丁和宏会编进去；没有的引擎对应的行不会出现。
  - 帧率和 WASM 堆是 JS 侧测的，任何工程都有。
  - 少了某个来源只是少几行汇总，不影响分包。
- **插件加载器就绪时间**：需要 `game.js` 里保留模板的 `console.log('start success');` 那一行，没有的话这一项显示“未知”。

## 4. 配置文件

复制 `example.kit.json`（或 [Star Tap 的 planB.kit.json](../examples/startap/planB.kit.json)）填写：开发者工具目录 `devtoolsDir`、官方 CLI 路径、私钥路径（也可以用环境变量 `WASMSPLIT_KIT_KEY`）、`workProject`、符号表、云开发环境（不用可以写 `null`）；PCK 两项按需填写。私钥路径只放在本机配置里，配置文件不要提交到仓库。

## 5. 交接时一起给的东西

- `wechat-wasm-slim/` 整个目录：转换、裁剪、分包、云日志、skill 和去敏示例配置。
- [docs/PLAYBOOK.md](../docs/PLAYBOOK.md)、[docs/KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md)：踩过的坑、真机数据、已知问题。
- **不要给**：微信登录状态、私钥、AppSecret、云环境密钥、原始手机日志。

## 6. 目前的局限

- 只在 Windows、Godot 4.7.2 和这一份官方运行时模板上验证过。
- 实测模式（`--mode measured`、`--drop-secondary`）只做了离线测试，还没上真机。
- Star Tap 分包版只在 iPhone 上实测过，安卓未测。
- 编译期裁剪在 `../trim`；裁剪后用 `../convert` 重新转换。
- 开发者工具无法自动点击 Godot 画布（报 canvas not found），采集和验证要人来操作。
