# GLX 适配本地验证记录（2026-10-22）

本文主体记录最初的静态/构建阶段。随后获准在独立开发者工具窗口实测：默认 WebGL 可见 2D/3D、离屏尺寸按钮及游戏内摘要读取已通过，详见 [开发者工具 WebGL 实测](GLX_DEVTOOLS_WEBGL_20261022.md)。下文“本轮未运行微信宿主”只指最初阶段；GLX 和手机验证不能由 WebGL 结果推定。

## 隔离与基线

开始时 `E:\AI\wechat-wasm-slim` 是空目录，非 Git 仓库。本轮在此独立 clone，分支 `codex/glx-adaptation-20261022`，基线 `4e5c2f437108c23f5e430f49636844ca8af791d3`。远端默认分支实际是 `feature/wechat-wasm-slim`，不是 main；开始和结束核对均仍为该提交。远端另有独立 `codex/ios-memory-skill-20261020`，未覆盖或合入。

此工具仓库的基线和当前检出都没有 `AGENTS.md`；已读取 README、convert 文档、PLAYBOOK、KNOWN_ISSUES、UPGRADING。名称相近的赛车 review worktree 中的 AGENTS 属于另一个仓库，没有用它修改此工具仓库。

旧工具检出、赛车 integration 工作区和只读引擎 source-df3 在本轮结束检查均 clean。赛车两份兼容副本及其清单由只读核对确认；未写入赛车或原引擎。所有新生成物仅放本仓库忽略的 `.local/glx-smoke/`，不提交 PCK、WASM、账号配置、设备证据或赛车 `.local` 内容。

## 最终本地产物

使用同一现成微信引擎，未重编译：Godot 输入 PCK 4.7.2；源码基线 df3cdd9bc；wx-transformer 1.0.35（sha pin 已核对）；WXGameKit 1.3.15。最小项目源码为 `examples/glx-smoke/`。

| 请求 | 目录（相对于本仓库） | packageVersion |
| --- | --- | --- |
| 默认 WebGL（命令未传模式） | `.local/glx-smoke/webgl-03/minigame` | `wxslim-3707af110530996169cf` |
| 显式 GLX | `.local/glx-smoke/glx-03/minigame` | `wxslim-d63ad01a8a38444f8a44` |

两包实际解压的 WASM、PCK 相同，manifest 与最终源码重算一致；生成 framework 的 JS 语法通过。

- WASM SHA256：`4872e5dda052f1ace3776eaa8ae2ffe4fbde025a4d1706dd5555e83295e9fc79`，压缩约 6.69 MB。
- PCK SHA256：`4246f011514b342f034ec125ce8f91d4c4135628c4856d9647a69ddffdefbdd4`，10,108 字节。
- `*-01`、`*-02` 是本轮改进前的中间产物，保留但不作为最终候选。
- 两包使用占位 AppID；不是已授权上传的候选。未来获准后须用指定 AppID 生成新目录，再重复 verify。

## 通过、阻断和未测

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| 配置/生成合同/运行时测试 | 67/67 通过 | Node；25 配置 + 12 生成合同 + 30 VM 运行时；不执行微信 native |
| 工具主测试入口（含 Godot） | 49/49 汇总项通过 | 语法、既有点击门/计时/插件契约、headless、新渲染测试组；计数包含上行组，不相加 |
| doctor --run-transformer | 33 通过、0 失败、0 注意、2 跳过 | 实跑转换器、锚点、WASM还原、源码pin/构建工具；未给 split runtime/CLI，故跳过两项 |
| 最小 PCK | 导入/导出/源码与实际PCK headless正常退出 | 编辑器 4.7.2.stable.steam.ed1daf0bf；dummy renderer，headless无 frame_post_draw，不是像素验证 |
| 最终两包 convert verify | 每包36通过、2注意、0失败 | 两条注意为占位 AppID、未做官方init；配置/真实压缩字节通过 |
| 默认 WebGL | 配置和启动桥合同回归通过 | 默认完整转换器参数保留，仍调用原 WebGL native wrapper；本轮未运行微信宿主 |
| GLX 能力门禁、native 异常/缺失、上下文不匹配、无效 ctxid、非零退出 | 测试通过 | 可控 VM 反例；明确失败/阻断、无静默回退 |
| 微信宿主实际能力、实际 GLctx、native 初始化 | 未测 | 本轮没有打开开发者工具或手机；未输出声称来自真实宿主的摘要 |
| 可见 GLX 2D/3D/离屏、主画布resize、前后台/重进/冷启动 | 未测 | 必须手机验证；不把 Node/Godot headless 当实机 |
| 预览/上传/云报告/部署/合并 | 未执行 | 等用户后续授权；本轮不改服务器或证书 |

一次性摘要功能已经由 VM 验证：包含包版本、请求模式、真实输入能力值、实际观察器状态、初始化终态和原因；重复错误不刷多行。`visibleRendering` 和 `lifecycle.recovery` 始终保留 `not_verified`。这里没有将模拟摘要伪装成真机报告。

独立审查发现并修复：main 期间模式被改、失败后误记成功、失败摘要上下文过期、非零退出误报成功、新上下文缺 ctxid/缓冲初始化、manifest 与实际字节没有交叉检查。反例已纳入测试。

## 最小真机方案（待批准）

1. 指定一台支持环境，保留 WebGL 基线；批准后才准备/上传使用真实 AppID 的新对照包，记录手机、微信/基础库版本与包版本。
2. 先 WebGL，再 GLX；手动查看一次摘要。GLX 能力不足即记环境阻断停止；上下文不匹配或 native 异常记初始化失败，不回退后算 GLX 成功。
3. 每包核对直接2D、离屏2D、旋转3D及离屏尺寸切换；后台约5秒回来，再退出重进。主画布resize、冷启动分别记录，不用离屏resize替代。
4. 重开 WebGL确认回退。最小示例通过后再单独安排赛车副本进退赛道、音频、透明/阴影验证。

详细操作见 [最小示例 README](../examples/glx-smoke/README.md)。本轮没有当前赛车启用 GLX 会黑屏的实测依据，历史实验风险仍只作为待验证项。
