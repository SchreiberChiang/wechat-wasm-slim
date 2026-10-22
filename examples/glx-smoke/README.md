# GLX 最小初始化与绘制探针

开发者工具实际验证见 [WebGL 实测记录](../../docs/GLX_DEVTOOLS_WEBGL_20261022.md)：默认 WebGL 的游戏内摘要已读取成功。CLI 若返回 `canvas not found` / 诊断 null，先核对是否在实际游戏上下文；不要据此判定游戏按钮或渲染失败。

Godot 4.7.2、GL Compatibility、单线程。没有联网、音频、登录、赛车资产或云上报；所有图形由代码生成。

- 顶部直接在主视口绘制 2D 色条与移动圆。
- 中部先显示独立 `SubViewport` 的 2D 纹理；按钮切换到旋转的 3D 立方体。
- `Resize buffer` 在 640 × 240 与 320 × 120 间切换两个离屏视口的尺寸，观察纹理是否持续更新、比例是否正常。
- 状态行显示 Godot 主视口尺寸、尺寸事件计数和最近四条前后台/焦点通知。通知出现不代表恢复渲染已通过。
- `Read rendering diagnostic (manual)` 才读取并显示/打印 `GameGlobal.__WXSLIM_RENDER_DIAGNOSTIC__.read()` 的 JSON。使用 `JavaScriptBridge.get_interface`，不依赖 `eval` 全局变量行为；不写存储，不发送网络请求。
- `[GLX_SMOKE] Godot frame_post_draw reached` 只证明 Godot 到达绘制回调；不能证明手机有可见画面、实际上下文是 GLX 或完整兼容性。

## 本地准备

从仓库根目录执行；`<Godot 4.7.2>` 替换为本机编辑器路径。输出和日志留在忽略目录 `.local/glx-smoke/`，不要提交引擎、PCK、转换输出或设备证据。

```powershell
New-Item -ItemType Directory -Force .local/glx-smoke
$smokeOut = (Resolve-Path .local/glx-smoke).Path
& '<Godot 4.7.2>' --headless --path examples/glx-smoke --editor --import --quit --log-file "$smokeOut/import.log" | Out-String
& '<Godot 4.7.2>' --headless --path examples/glx-smoke --export-pack Web "$smokeOut/glx-smoke.pck" --log-file "$smokeOut/export.log" | Out-String
& '<Godot 4.7.2>' --headless --path examples/glx-smoke --quit-after 60 --log-file "$smokeOut/headless.log" | Out-String
node wxslim.mjs config --config examples/glx-smoke/wxslim.json
```

`--export-pack` 仅导出内容包，不需要安装 Web 引擎模板。headless 使用 dummy 渲染器，只检查脚本/场景生命周期；不能验证 WebGL 或 GLX。

2026-10-22 本机已用 `4.7.2.stable.steam.ed1daf0bf` 完成导入、PCK 导出及 headless 60 帧运行，均正常退出；PCK 为 10,108 字节。headless 没有触发 `frame_post_draw`，这不是 GLX 失败证据。微信初始化、可见画面、触摸、真实主画布 resize 和前后台恢复仍待相应环境验证。

在此目录手工创建被忽略的 `wxslim.private.json`，填写本机微信版引擎目录；需要真机前再填经批准使用的 `game.appidFrom`。不要把实际引擎路径、AppID 或赛车副本路径放进公开配置：

```json
{
  "engine": { "artifacts": "<本机微信版 Godot 引擎目录>" }
}
```

同一个 PCK、引擎和接口构建两份新输出：

```powershell
node convert/convert.mjs check --config examples/glx-smoke/wxslim.json
node convert/convert.mjs convert --config examples/glx-smoke/wxslim.json --render-mode webgl --out .local/glx-smoke/webgl-01
node convert/convert.mjs verify --project .local/glx-smoke/webgl-01/minigame
node convert/convert.mjs convert --config examples/glx-smoke/wxslim.json --render-mode glx --out .local/glx-smoke/glx-01
node convert/convert.mjs verify --project .local/glx-smoke/glx-01/minigame
```

输出目录必须不存在；重跑使用新的序号。`wxslim.json` 的默认仍为 `webgl`。GLX 初始化失败时保留失败原因，显式重新选择 WebGL 输出完成回退，不修改已验证包、不把回退称为 GLX 成功。

## 最小手机方案（待单独批准，尚未执行）

1. 批准预览/上传和手机操作后，固定一台手机、微信版本与基础库版本，先运行 WebGL 基线。核对一次性摘要中的包版本、请求模式、能力检测、实际上下文、初始化结果/失败原因。
2. 观察主视口 2D、离屏 2D 各连续动画 10 秒；切换 3D 并旋转 10 秒；切回 2D。记录画面、触摸和纹理更新，不仅记录控制台。
3. 在 2D、3D 各切换离屏尺寸两次；核对色条、圆和立方体的比例、完整性与持续更新。支持系统旋转/窗口变化的设备另记录实际主画布 resize；离屏 resize 通过不能替代主画布 resize 结论。
4. 进入后台 5 秒后返回，在 2D、3D 各执行一次；核对画面恢复、动画、按钮和尺寸状态。第一次暂停/恢复事件与恢复后的实际可见画面分别记录。
5. 同机启动 GLX 对照包，重复步骤 1–4。能力位不支持时记为该环境阻断；实际上下文不匹配记为初始化失败，保留可读原因。两者都不能直接推断赛车或 GLX 本身不兼容。
6. 最后重开同一 WebGL 基线，检查回退仍可用。该最小例通过后才讨论赛车副本验证；iOS/Android 互不代替。

如果初始化阶段终止，按钮可能尚未显示，此时检查启动的一次性摘要；不要用缺少界面推断 GLX 上下文已经成功创建。电脑脚本测试、原生 headless、转换器 `verify` 和模拟器能力检测各有边界，均不能代替手机 GLX 像素与前后台恢复证据。
