# 给 AI 的安装说明：Godot 微信小游戏导出插件

用户把这个发布包交给你，请你帮他装进一个 Godot 4.7 游戏工程。按下面的步骤操作，每一步做完都要检查结果。

## 你要确认的前提

- 游戏工程根目录：里面有 `project.godot`。如果用户没说，先问用户。
- Godot 4.7.2 编辑器（`.exe`）的位置。从 Godot 里启用插件时会自动使用当前编辑器；命令行准备时才需要它。
- Node.js 不用另外装：插件自带 `addons/wxslim_readonly/kit/tools/node/node.exe`（24.18.0，Windows 64 位）。下面的命令都用它。

## 步骤

1. 把发布包里的 `addons/wxslim_readonly` 整个文件夹复制到 `游戏工程/addons/wxslim_readonly`。
   - 如果游戏里已经有这个文件夹，就是旧版本：先把旧文件夹整个删掉或移走，再复制新的。不要把新旧文件混在一起。
   - 必须保留 `kit/.gdignore` 这个空文件。它让 Godot 不扫描、不导出约 313 MB 的工具包。
2. 运行准备命令（在任何目录都可以，路径有空格要加引号）：

   ```
   "游戏工程/addons/wxslim_readonly/kit/tools/node/node.exe" "游戏工程/addons/wxslim_readonly/kit/install.mjs" "Godot编辑器.exe"
   ```

   成功时最后一行是 JSON，其中 `"status":"SUCCESS"`。这一步会核对工具包的每个文件、记下本机的 Godot 和 Node、在游戏外面（`%LOCALAPPDATA%/Godot/WxSlim/projects/`）建任务目录，并在 `project.godot` 里启用插件。
   失败时也是一行 JSON，`message` 是给人看的原因，把它转告用户。
3. 检查 `project.godot` 里有：

   ```
   [editor_plugins]

   enabled=PackedStringArray("res://addons/wxslim_readonly/plugin.cfg")
   ```

   如果还有别的插件，它们应该原样保留在同一个列表里。
4. 告诉用户：用 Godot 打开游戏，右侧会出现「微信导出」面板。

## 建议，但要先问用户

- 游戏用 Git 管理时，建议把 `addons/wxslim_readonly/kit/` 加进 `.gitignore`（约 313 MB，里面最大的单个文件约 90 MB）。这样做的话，其他人克隆仓库后要自己复制一份插件。
- 输出目录要选在游戏工程**之外**，否则插件会拒绝导出。

## 不要做的事

- 不要修改 `kit/` 里的任何文件，准备命令会因为文件和发布时不一致而拒绝。
- 不要把插件文件夹放到 `addons/` 之外，也不要改名。
- 不要替用户填写或公开 AppID。
