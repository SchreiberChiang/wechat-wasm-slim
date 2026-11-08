# wasmsplit-v2-ci

微信小游戏**通用适配**方案的 Wasm 代码分包工具（命令行 / CI 版本）。

把小游戏的 wasm 代码包拆分为首包与子包，降低启动下载耗时与编译耗时；配合 iOS 高性能模式按函数粒度按需加载，降低运行时内存压力。

## 与 V1 的区别

之前的wasmsplit-ci (https://www.npmjs.com/package/wasmsplit-ci) 仅支持Unity / 团结引擎，不会再维护，也不再支持 Unity 之外的引擎。

在通用适配方案发布后，Unity引擎的微信小游戏也会逐渐以通用适配的项目结构导出，原来的wasmsplit-ci不支持新结构。为了支持更多引擎，V2不与V1兼容，支持Unity 以及 Unity 之外的引擎（UE、Cocos、自研引擎等通用适配）。

配套转换插件版本要求如下（https://github.com/wechat-miniprogram/minigame-tuanjie-transform-sdk）：

- 当使用最新的微信转换插件导出微信小游戏时（版本 >= 0.1.35），必须使用本工具与 V2 IDE 插件。
- 版本 <= 0.1.34时，必须使用 V1 (https://www.npmjs.com/package/wasmsplit-ci) 。

## 安装

```bash
npm install -g wasmsplit-v2-ci
```

## 快速开始（CI 三行）

```bash
# 1. 推进到收集态（首次必填 -d）
wasmsplit-v2-ci init -p /path/to/project -k /path/to/private.key -d "v1.0.0"

# 2. 导出函数收集信息（输出 .plugincache/codesplitv2/gameinfo.txt）
wasmsplit-v2-ci getinfo -p /path/to/project -k /path/to/private.key

# 3. 做 Release 分包并自动应用产物
wasmsplit-v2-ci dosplit -p /path/to/project -k /path/to/private.key --release
```

## 设计理念

CLI 与 IDE 插件完全对齐**状态机驱动**语义：**一条命令把项目推进到稳定态**，避免显式 upload / download / apply 让项目停在"半状态"。

- `init`：写配置 → 上传 → 预处理 → 分包 → 下载 → 应用，推进到 **Collecting**
- `dosplit`：分包 → 下载 → 应用，拿到可用产物
- `getinfo`：导出函数收集信息（gameinfo.txt）

底层使用与 IDE 插件同一套状态判定（`PreChecker.inferState()`），命令行与 UI 互通，可交叉使用。

## 参数约定

| 参数                            | 说明                                       |
| ------------------------------- | ------------------------------------------ |
| `-p, --project-path <path>`     | 项目根目录绝对路径                         |
| `-k, --private-key-path <path>` | 私钥文件路径                               |
| `-d, --desc <description>`      | 版本描述（`init` 首次必填）                |
| `-o, --output <path>`           | 输出文件路径                               |
| `--release`                     | Release 分包（`dosplit` 默认 Profile）     |
| `--refer-md5 <md5>`             | 依赖的历史版本 MD5（增量分包）             |
| `--watch -i <ms>`               | 监听模式（`status` / `collection-status`） |

私钥路径也可通过环境变量 `WASM_SPLIT_PRIVATE_KEY_PATH` 提供，命令行参数优先级更高。

> CLI 使用 RSA + PSS + SHA256 公私钥签名鉴权（与 IDE 插件走开发者工具登录态的方式不同），私钥需在 mp 管理端生成并下载，格式为 PEM。

## 使用命令

| 命令                  | 作用                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `init`                | 状态机推进到 Collecting（幂等，已完成步骤自动跳过；首次必须 `-d`） |
| `dosplit`             | 分包 + 下载 + 应用（默认 Profile，加 `--release` 为 Release）      |
| `getinfo`             | 导出 `gameinfo.txt`（需处于 Collecting 状态）                      |
| `disable` / `restore` | 还原项目到未分包状态                                               |
| `switch-md5`          | 切换工程代码分包 md5，使后台视为新包（**只能在未分包状态使用**）   |
| `showfuncname`        | 导出首包函数与新增收集函数列表                                     |
| `reportfuncname`      | 上报函数名列表                                                     |
| `config`              | 配置读写（`get` / `set` / `list`）                                 |

版本号：`wasmsplit-v2-ci -V`。

### `init` — 推进到 Collecting

内部按 `PreChecker.inferState()` 循环调度：
`NotInitialized` → 写配置/扫描/激活 → `ReadyToUpload` → `Upload` → `Preprocessing` → 轮询 →
`ReadyToSplit` → `Split(isProfile=true, referMd5)` → `ReadyToDownload` → 下载 →
`ReadyToApply` → 应用 → `Collecting`（退出）。

```bash
wasmsplit-v2-ci init -p <project> -k <key> -d "v1.0.0" [--refer-md5 <md5>] [--no-scan]
```

- 幂等：可重复执行；已完成的步骤会自动跳过。
- 首次执行必须带 `-d <desc>`，后续重跑可省略。

### `dosplit` — 分包 + 下载 + 应用

前置：项目已处于可分包态（建议先跑 `init`）。

```bash
wasmsplit-v2-ci dosplit -p <project> -k <key> [--release] [--refer-md5 <md5>] \
                   [--opt-profile] [--opt-func]
```

- `--opt-profile` / `--logCallInWasm`：Profile 性能优化（互为别名）。
- `--opt-func` / `--mergeSmallFunc`：函数量优化 (Beta)（互为别名）。

### `getinfo` — 导出 gameinfo.txt

前置：必须处于 Collecting 状态（否则报错）。

```bash
wasmsplit-v2-ci getinfo -p <project> -k <key> [-o <path>]
```

- 默认输出：`<project>/.plugincache/codesplitv2/gameinfo.txt`
- 内容：`JSON.stringify(ProfileInfo)`，兼容老 CI 的脚本读取格式
- stdout 同步打印关键字段（profileIncrementFuncNum / sourceFuncNum / profileFuncNum 等）

### `switch-md5` — 切换分包 md5（测试辅助）

把一个工程的代码分包 md5 换成新值，让分包后台将其视为一个全新的包（否则同 md5 会命中后台缓存，直接跳过上传 / 预处理 / 分包）。

```bash
wasmsplit-v2-ci switch-md5 -p <project> [-m <15位hex>] [-d <描述>]
```

- 不传 `-m` 时随机生成；`-d` 仅写入 `md5-history.csv` 便于追溯。
- 同步修改 5 处：主包 wasm 文件名、`backup/` 下的历史文件、`wx-game-kit/config.json` 的 `launch.code.fileMD5`、`.plugincache/codesplitv2/config.json` 的分包字段、追加一条 `md5-history.csv`。
- 改到一半失败会自动回滚。
- **约束：只能在未分包状态下使用。** 检测到子包目录（`wasmcode1/`、`wasmcode2/`）、分包运行时 `wasm-split.js`、或配置中 `split.subVersion > 0` / `split.splitLocked = true` 时会被拒绝——分包态下主包与子包共用同一 md5，只改主包会造成两者不一致。

### `config` — 配置读写

```bash
wasmsplit-v2-ci config get <key> -p <project>
wasmsplit-v2-ci config set <key> <value> -p <project>
wasmsplit-v2-ci config list -p <project>
```

## License

MIT
