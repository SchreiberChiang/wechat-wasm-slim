# 中文验收界面（独立 PCK 来源）

本项目仅调整验收场景的中文排版与 Control 边距。它不更改引擎、启动桥、云预算或原封存场景。新 UI 尚不能倒算为手机验收；当前上下文 unknown 显示「待确认」，没有「GLX 通过」结论。

默认画面是中文标题、八位会话短码、直接 2D 与离屏 2D 动画，以及固定的「读取诊断」「更多测试」按钮。内容区可滚动；诊断 JSON 点击后才进入独立详情面板，次要 3D/尺寸/声音测试默认折叠。正文 32–36、按钮 36，触控高度 82–88 逻辑单位。主按钮在滚动区外，安全区底部另留 80 CSS px 给 vConsole/手势。常见竖屏 profile 初始应能看到两块动画，由本地截图核验。

## 保留行为

- `pattern_2d.gd` 是原文件原字节，SHA256 `a27edba4a4125aca7458bf39ee3731f8986c97260bd704e58fadbc45c82c865d`。
- `_process`、`_build_viewports`、`_toggle_3d`、`_resize_buffer`、`_on_frame_post_draw` 保持原方法；两个 SubViewport 初始均为 640×240，手动调整仍在 320×120 / 640×240 间切换。
- 声音仍仅手动生成 22050 Hz、440 Hz、0.3 秒轻声 WAV；只翻译结果文案，没有自动播放。
- `AuthorReleaseAcceptance.readIdentityText()` / `readDiagnosticJson()` 接口与原诊断打印标签保留。主屏只从 identity 文本取 `#八位短码` 和 `Actual context:`，不自动额外读取诊断。
- 项目基础 viewport 720×1160、stretch/aspect/orientation 与原项目一致；不更改屏幕或 canvas 尺寸，不查询 GPU。

## 字体与安全区

主场景显式 preload `res://fonts/AcceptanceCJK.otf`，由 build_font.py 生成；全部中文 UI 字符串在 `UI_STRINGS.txt`，用于字体子集构建。字体 OFL/NOTICE/FONT 元数据显式随导出打包。缺字体会明确失败，不使用隐式缺字回退。

`safe_area_query.gd` 只读 `wx.getWindowInfo()`，不可用时读 `getSystemInfoSync()`，并独立读取菜单 rect，直接返回 JSON 字符串。浏览器没有 wx 时使用浏览器窗口几何。它保留 screenTop、screenWidth/Height、方向及来源说明，没有设备身份、上下文、云或日志操作。

`safe_area_layout.gd` 是可单独测试的纯几何算法：按实际 Godot 逻辑 viewport / 窗口 CSS 比例映射；声明为 screen 的 API rect 仅减一次 screenTop，不乘 DPR，不交换宽高。常见竖屏顶部至少 100 CSS px，菜单下沿另留 12 CSS px；缺字段、未知来源、极小/横屏窗口均给 fallback 原因。inset 总和最多占各轴一半，保留可访问内容区。原始输入随 `last_layout.raw_geometry` 保留；`geometry_verified` 始终为 false，API 输入完整也不冒充真机视觉安全区验收。

本轮只验收竖屏；不宣称横屏、任意极小窗口或微信坐标原点已获真机确认。

## 本地验收入口

使用本机 Godot 4.7.2 运行；以下命令不涉及微信或手机。

```powershell
godot --headless --path <本项目绝对路径> --script res://layout_contract.gd
godot --path <本项目绝对路径> --script res://local_capture.gd -- `
  --capture-out=<新的绝对PNG路径> --capture-width=720 --capture-height=1558 --acceptance-layout=island
```

`local_capture.gd` 隐藏本地 Window，用独立 SubViewport 等待 12 帧后保存一次 PNG 与旁路几何 JSON。它是明确的电脑像素检查入口，排除于 PCK。再用 720×1280 / `--acceptance-layout=compact` 检查小竖屏；原基准 720×1160 不传 profile；附加 `--acceptance-more` 或 `--acceptance-diagnostics` 检查折叠展开与详情面板（仅 native 预览有效）。截图输出应放独立 `.local` 目录，不能覆盖旧文件。

查看原生预览可直接运行本项目，按按钮验证；截图只能证明对应电脑布局和可见像素，不能证明微信/GLX/手机生命周期。字体构建脚本、布局合同与截屏入口排除于导出；导出与截图均需分别核验，不以 headless 成功代替像素检查。

## 字体重建

仓库内包含已生成的 UI 字体，不依赖手机系统中文字体。需要修改中文字库时，使用 fontTools 4.60.0：

```powershell
python build_font.py --source "<Noto Sans SC Regular 2.002 原字体绝对路径>" --output "<新的输出目录>"
```

脚本固定核验源字体 SHA256、许可与版本，并按当前 GDScript 字符生成子集；输出目录已有字体时拒绝覆盖。源字体完整哈希和来源说明保存在 fonts/FONT.json；将新输出的字体与元数据一起复制回 fonts，再导入并导出新 PCK。字体改名为 Acceptance CJK，OFL 与原作者版权声明随包保留。
