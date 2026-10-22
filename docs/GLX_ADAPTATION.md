# WebGL / GLX 显式选择

默认 WebGL 保持 `enableGLX=false`、pin=false、disable=true。实验 GLX 使用同一入口生成 `enableGLX=true`、pin=true、disable=false；`enableMetal=false` 和 WebGL2 保持不变。两种模式均不在失败后自动切换模式。

```json
{ "格式": "wechat-wasm-slim/game-v1", "game": { "renderMode": "glx" } }
```

这是配置片段，其余输入仍按普通 wxslim.json 填写。命令行 `--render-mode webgl|glx` 优先于 private、public 配置；省略为 webgl，无效值直接报错。回退命令为同一输入重新 `convert --render-mode webgl --out <不存在的新目录>`；关闭实验会话，打开保留的 WebGL 包。不能在既有 canvas 上改开关或覆盖旧目录。

## 生成和启动合同

1. `inputs.mjs` 的转换器配置决定 WXGameKit 的 `runtime.contextConfig.contextExt.enableGLX`。转换后立即核对结果、Metal 和 WebGL2，意外配置直接拒绝。
2. `render-config.json` 和 `.js` 同源；记录模式、输入 JS/WASM/PCK SHA256、适配源码 SHA256、Godot/转换器/插件版本和内容派生的 `packageVersion`。方向、locale、接口内容 hash、兼容层/计时等配置也参与身份；不包含账号值。它标识本次转换，包含未提交适配源码的变化，不把 Git HEAD 当作全部产物身份。
3. `render-runtime.js` 在 WXGameKit 初始化前检查 GLX 能力并锁定模式。要求 `wx.env.isSupportEmscriptenGLX === true`，missing、false、非布尔值均可读阻断。开发者工具缺能力只说明该宿主不能继续这个实验。
4. 启动桥核对内嵌模式与 manifest、pin 是否一致；WebGL 拒绝已有 GLX 模块上下文。GLX 允许有数值 ctxid 的加载器上下文，但这不证明缓冲已经正确初始化。
5. `render-observer.js` 通过唯一 `installWXGLXPatches();` 锚点插入 Godot 工厂作用域，读取实际 `GLctx`，不创建额外上下文。引擎原有 `wxwebgl2` 选择、模式匹配检查及初始化时序保留。实验 GLX 的三个 native 调用不再吞异常；WebGL 保留原调用行为。
6. 工厂就绪 → initConfig → initFS → PCK 挂载 → 单次 callMain。callMain 返回后核对退出码、实际上下文和 native 调用记录，生成一次摘要；非零返回/退出不能变为成功。上下文两边的 ctxid 都必须是有限数字且匹配。已有 loader-owned 上下文令引擎跳过 buffer 初始化时，只能记 `inconclusive`，不能声称通过；新上下文缺少缓冲初始化则失败。
7. `convert verify` 检查 manifest/运行时 JS/启动桥/插件配置和加载顺序是否一致，并把完整包的 WASM/PCK hash 与实际解压字节交叉校验。旧 WebGL 包缺少新诊断时警告，部分新文件缺失或互相矛盾时失败。`doctor` 复用观察锚点和转换器配置检查。

`packageVersion` 是转换产物身份。后续 split 重写 PCK/WASM 是另一个产物；本轮未验证 GLX 分包，也未执行官方 init。不要用转换摘要替代 split 的版本/二进制清单。现有 WebGL 分包流程不因本轮获得新的真机验收结论。

## 一次性诊断

初始化终态只输出一行 `[WXSLIM_RENDER_SUMMARY] <JSON>`。发生错误时原始本地引擎错误日志仍可用于排查；摘要只用固定错误码/说明，不收集 URL、账户、设备标识或异常正文。

手动读取 `GameGlobal.__WXSLIM_RENDER_DIAGNOSTIC__.read()`，或在同一游戏 JS 上下文显式调用 `.show()`。最小项目提供按钮显示 JSON，使用 `get_interface` 读取；外层自动化上下文的 null 不能替代游戏上下文读取。初始化前阻断时按钮可能不存在，应读取启动摘要。`.show()` 仅在显式调用时弹窗，不自动弹窗、写磁盘、上传或接云报告。

| 字段 | 含义 / 边界 |
| --- | --- |
| packageVersion / versions | 本次转换身份，以及输入 Godot、wx-transformer、WXGameKit 版本 |
| requestedMode / capability | 请求 webgl/glx；能力是否存在及真实布尔值，无法识别的类型为 null |
| actualContext | 来自引擎 GLctx 的 mode/WebGL2 状态；未取得为 null，不由配置或插件标签推断 |
| observationStatus | available / not_observed / unavailable；read 手动刷新，unavailable 时 actualContext 只是上次可读快照 |
| native | glxInit、glxInitBufferDataAndGlState、glxUpdateContextId 调用次数和 returned/threw；returned 仅表示未抛错 |
| initialization | pending / blocked / failed / inconclusive / initialized；initialized 只证明所观察到的初始化链路完成 |
| failureReason | 结构化 code/message；能力阻断、上下文不匹配、绑定缺失、原生异常等分开记录 |
| visibleRendering / lifecycle.recovery | 始终 not_verified；必须有人核对真机可见画面与恢复 |
| lifecycle | 有界 hide/show/window-resize 次数；不接管原暂停/恢复、不重建上下文、不自动恢复音频 |

没有每帧 flush 包装或周期日志。手动 read 返回副本，生命周期变化留内存，不反复输出初始化摘要。后续运行错误可以将内存状态改为失败；不能把早先 initialized 当成长期稳定证明。

## 兼容检查与证据边界

基线为微信引擎提交 `df3cdd9bc9941a20cb5575d781cde6f937637bcb` 的源码和本机现成引擎，只读参考，没有重编或更新 GLX 库。

| 风险 | 本轮核对的代码 | 仍需手机 |
| --- | --- | --- |
| 上下文匹配 | `patch_em_gl.js` pin 与实际 emscriptenGLX 比较；请求 wxwebgl2 无返回时抛错；native 必须观察实际调用 | 加载页与引擎同 canvas、冷启动/重进后的实际显示 |
| 离屏缓冲 | `detect.py` 在 GLX 编译不启用 OFFSCREEN_FRAMEBUFFER；`display_server_web.cpp` 在该构建关闭 explicitSwapControl。转换器不覆盖这些编译约定 | 最小项目 SubViewport 2D/3D 与尺寸切换；随后才是赛车透明/阴影路径 |
| resize | `library_godot_display.js` 已有 `typeof GL.resizeOffscreenFramebuffer === 'function'` 守卫 | 主 canvas 尺寸变化与离屏尺寸变化分别验证，不能互代 |
| 前后台/重进 | 本适配只计数，不尝试修改恢复策略 | 后台约 5 秒再返回、重新进入、再次冷启动及画面持续更新 |
| null-write / timestamp | 上游实验说明记录了 workaround 和怀疑；本轮不改引擎编译参数 | 未证明内存安全、性能收益或长期稳定 |

原社区模板按能力位选择 GLX，非一律关闭。转换器 `b083982` 曾强制关闭，`51d2394`、`d483f11` 延续；这只能说明历史策略，不能证明当前赛车 GLX 黑屏。只读参考赛车 `docs/RACING_GLX_LOCAL_COMPAT_20261022.md`：初版 GLX 在模拟器能力门禁停止，没有实际 GLX 画面；最终副本仅静态核对。两份赛车对照副本、私人 `.local`、引擎、库和原包均未改动。

上游官方指南地址为 [EmscriptenGLX 原生引擎接入](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-emscriptenglx-native.html)。本轮网页抓取不可用，接入顺序通过引擎仓库内保存的指南和实际源码交叉核对；不据此宣布最新基础库/平台支持范围。

## 本地验证与手机计划

运行 `node tests/run.mjs --godot <Godot 4.7.2 exe>` 汇总语法、既有契约、配置与新渲染运行时 VM 合同。单独运行 `node --test tests/config-tests.mjs tests/render-config-tests.mjs tests/render-runtime-tests.mjs` 可定位模式、上下文和失败分支。VM 的 capability/context/native 是桩，不是微信宿主实测。

最小示例与步骤见 [examples/glx-smoke/README.md](../examples/glx-smoke/README.md)。先固定同引擎/PCK两包的初始化，再依次查看 2D、离屏、3D、resize、前后台及冷启动。缺能力即停止；实际上下文不匹配记明确初始化失败，不能称为能力阻断或静默回退成功。真机一次摘要与可见结果缺一不可。最小例通过以后，再申请验证赛车两份既有副本。

用户后续已批准最小示例手机 WebGL / GLX 对照预览；当前证据见 [手机验证记录](GLX_PHONE_VALIDATION_20261022.md)。这不扩展为赛车测试、发布体验版或云报告授权。本轮无部署、服务器/证书变更，也不合并默认分支。

本轮具体计数、包身份与未测项见 [2026-10-22 本地验证记录](GLX_LOCAL_VALIDATION_20261022.md)。
