# 打砖块（2D + 3D）裁剪结果

日期：2026-10-17。项目：2D 打砖块，点击 ENTER 进入 3D 打砖块（透视相机、灯光、标准材质，SubViewport 显示）。

## 扫描结论（`trim.config.json`，balanced 档）

- 项目用到 51 个引擎类。
- 保留：3D（Node3D、Camera3D、DirectionalLight3D、MeshInstance3D、BoxMesh、SphereMesh 等），高级 GUI（用到了 SubViewportContainer）。
- 关掉：2D 物理、3D 物理、2D 导航、3D 导航、XR（游戏里的碰撞是脚本算的，没用 Godot 物理）。
- 模块从默认约 46 个减到 6 个：bcdec、freetype、gdscript、msdfgen、svg、text_server_adv。

## 编译与大小

| | 完整引擎 | balanced 裁剪版 | 变化 |
|---|---|---|---|
| godot.wasm | 64.53 MB | 46.72 MB | -27.6% |
| godot.wasm.br（实际下载） | 8.70 MB | **5.95 MB** | **-31.6%** |
| godot.js | 0.43 MB | 0.39 MB | -8.9% |

- 引擎源码：citizenll/godot 微信分支 `df3cdd9bc`，emscripten 4.0.10，`optimize=size`、`lto=full`。
- 编译用时 31 分钟。期间 clang 偶发崩溃 3 次（0xC0000005，每次是不同文件），工具自动重试续编后成功。
- 产物带函数符号表（`godot.js.symbols` / `symbols.json`），可以接着做官方分包。
- 编译目录约 0.9 GB（引擎源码副本和中间文件），不放进工具包，也不提交。

## 验证

- 用 `trim apply` 换进 3D 打砖块模板工程，在微信开发者工具里运行。
- 引擎正常初始化，2D 首帧正常；人工试玩 2D（拖挡板、发球）和 3D（发球、拖挡板、打砖块、返回 2D 再进 3D），画面、文字、光照、碰撞都正常；控制台没有引擎报错。
- **手机未测**。

## 参考：之前只保留 2D 的裁剪

只玩 2D 的版本（另外关掉 3D 和高级 GUI）：godot.wasm.br 8.69 MB → 5.08 MB（-41.5%）。可见在这个游戏里，3D 本身大约占 0.9 MB（压缩后）。
