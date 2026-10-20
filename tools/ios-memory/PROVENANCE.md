# 来源与本次移植范围

来源：仓库所有者授权公开的通用采集实现，来源快照 `574d155ef1a59ff0be404e36099f3f280afefa58`（2026-10-20）。原项目及原始真机记录保留在所有者私有仓库，不随本次发布。这里只保留可追溯快照标识，不公开原始测试材料。

复制范围仅 `pmd3_probe.py`、`wifi_lan.py`、`wifi_inspect.py`、`export.py`、`requirements.txt` 及离线测试。未复制原始数据、配对记录、凭据、截图、游戏音频/资源或诊断构建产物。pymobiledevice3 为外部依赖，不内嵌第三方源码。

本次修改：有效变化门禁从至少 45 秒收紧为真实 60 秒；主动 stop 不再等待最低 60 秒（短段保存但未通过门禁）。传输 API 与设备 / 版本 pin 保持原已验证路线。新增导出、门禁与停止行为的离线测试。新集成本身未连接用户 iPhone；来源真机记录与本次离线验证必须分开。

## 本次云端离线验证（2026-10-20）

- Python 3.12.14：10 项 `tests/ios-memory-probe.py` 全部通过；覆盖设备身份、USB 回退拒绝、过期/外网 endpoint、PID / 字段解码、60 秒有效变化、非法数值、stop / 截图 opt-in、离线导出缺样与 HTML 转义、拒绝覆盖输出。
- 4 个 Python 入口的 `--help` 及语法编译通过，不需要安装 pymobiledevice3 或连接手机。
- skill quick_validate 通过；原 frontmatter 顶层 version 不被当前验证器接受，版本移入 `metadata.version`，未删除其它元数据。
- `node tests/run.mjs`：40 通过 / 0 失败；Godot headless 未运行（本环境没有指定 Godot）。
- `node --test tests/config-tests.mjs`：19 通过 / 1 失败。未修改的原测试使用 `C:/keys/k.pem`，在 Linux 下得到与 Windows 不同的相对路径，详见该测试第 109 行；不是内存工具的测试失败，未改业务配置解析或放宽断言来掩盖。
- 未运行：移植后 Windows / iPhone 新采集、完整游戏或手机触控。源项目的成功记录只说明原固定版本/设备路线，不将其冒充本次重新实测。
