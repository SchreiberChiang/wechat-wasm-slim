# iOS Godot 功能验收场景

这是独立 Godot 4.7 项目。只实现电脑侧验收场景；运行回调、日志、桌面截图都不能替代 iOS 人工画面验收。旧 `glx-acceptance-ui` 不受本目录影响。

## 准备与导出

字体是本地依赖，不提交二进制。`build_font.py` 从本目录全部 `.gd` 收集字符，以固定 SHA256 的 Noto Sans SC Regular 2.002 和 fontTools 4.60.0 生成字体。许可为 SIL OFL 1.1，见 `fonts/OFL.txt`、`fonts/NOTICE.txt`。源码字体不得覆盖。生成命令示例：

```powershell
python build_font.py --source 'C:/Windows/Fonts/Noto Sans SC (TrueType).otf' --output fonts
godot --headless --path . --editor --import
godot --headless --path . --export-pack Web '<private-output>/ios-functional.pck'
```

字体生成器拒绝覆盖已有产物。若文字变化，先将已有字体和 FONT.json 移到已确认的私有备份目录，再生成。`fonts/AcceptanceCJK.otf`、导入记录、`FONT.json` 和 `.godot` 都被忽略。`FONT.json` 保存实际字符覆盖及来源哈希。不要用旧 UI 子集冒充新增中文的完整覆盖。

Web preset 使用文本脚本导出，避免编辑器和候选引擎字节码版本差异；纹理压缩设置沿用原验收项目。仅把导出 PCK 接到已确认的完整 Godot 与官方 026e 库原宿主，宿主版本、启动方式及运行证据由原宿主管理。本项目不修改宿主、SDK、引擎或部署配置。

## 操作

一页一个小测试组。顶部显示名称和预期；底部固定三个状态按钮与左右导航。中间内容不足时可滚动。初始每页均为“未确认”；用户必须显式点击“通过／异常／未测”。执行切换、看到回调、进入页面都不会自动标为通过。状态只保存在当前内存会话，重启恢复未确认。

1. 2D 图片、中文、棋盘上的透明叠加：检查四角色块、文字、红青圆交叠与连续斜线。
2. 裁剪：图形自动左右移动，检查白框外没有溢出。
3. 九宫格 STRETCH：并排两种尺寸；四角红绿蓝黄、虚线边缘、紫色中心十字。执行尺寸和纹理切换。
4. 九宫格 TILE / TILE_FIT：左 TILE，右 TILE_FIT，同时作用于两个方向；比较边缘重复和末端贴合。
5. 九宫格 draw_center=false：中心应看见背景棋盘；纹理外四像素透明，随后两像素 alpha 分别为 0.35 与 0.7，便于观察边缘混合；执行两种切换。
6. 运行时 BoxMesh、代码生成贴图和基础灯光：观察旋转与明暗。直接使用 BoxMesh，避免从 PrimitiveMesh 额外回读 GPU 缓冲；本批不再覆盖 ArrayMesh 显式数组上传。
7. 透明遮挡：红色半透明片在前，蓝色片在后；检查方块遮挡关系。
8. 双 SubViewport：独立世界、背景、视角；执行 2D / 3D 切换后检查两侧仍正确。
9. 子场景退出／重入：释放本页 SubViewport 与网格，显示退出提示；再创建子场景，检查恢复和按钮响应。这是本页资源释放／重建，不是 `change_scene_to_file`，也不代表微信关闭后重开。

## 日志与身份

`bridge.gd` 只使用原宿主已存在的 `AuthorReleaseAcceptance.readIdentityText()` 与 `readDiagnosticJson()`。启动读取一次，原宿主各自发出 SCENE / MANUAL。返回值必须为 JSON 对象字符串才解析，undefined/null 不进入 JSON.parse_string。

原 `candidate-observer.js` 没有操作写入接口，因此每次操作输出 `[IOS_FUNCTIONAL]` 结构化 console JSON，包含 schema、event、page、sequence、ticksMs、details 和启动缓存的 host 摘要（包、会话、实际 SDK、后端、上下文一致性来自宿主）。每条操作不重复整个候选 manifest。这不是伪造 observer API，也不代表宿主已经持久化这些操作。没有宿主时明确记录 unavailable/native-preview，不硬编码候选身份。注意这些本地日志可能含设备信息，不应作为公共 Git 资料。

安全边距复用旧场景纯布局 helper。web 查询 undefined 时使用保守降级边距；安全区 API 返回并不证明手机布局已经验收。原宿主当前上下文未读取成功时，顶部显示未读取，不推断 GLX。

## 检查边界

可用本地 Godot `--headless --editor --import` 和有限时间启动检查语法与资源引用。桌面实际画面需另行截图观察；iOS 所有项目仍待对应设备、包、会话人工确认。无网络素材、外部美术、自动上传、手机调用或引擎构建。

本批 3D 全部通过 SubViewport 呈现在 UI 中；未覆盖主视口直接 3D、阴影、复杂 PBR、动画骨骼，也未覆盖音频、输入法或原生生命周期恢复。本场景按页面延迟创建和释放 3D 内容，不修改成功引擎的默认 3D 预热行为。

`godot --path . --script res://local_capture.gd -- --capture-page=0 --capture-out='<private-output>/page-0.png'` 可生成一张 720×1558 的原生桌面截图。页面参数范围为 0–8；输出必须是尚不存在的绝对路径。工具隐藏自己的原生窗口，只创建本项目自己的离屏视口；这些截图只供桌面布局检查。

可追加 `--capture-action=resize`（九宫格页）、`texture`（九宫格页）、`switch`（双视口页）、`exit` 或 `reenter`（退出重入页）检查操作后画面。工具会断言这些动作没有改变任何页面的默认人工状态，不会自动点击“通过”。
