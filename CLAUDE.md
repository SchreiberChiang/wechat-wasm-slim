# Claude 的工作目录与合并流程

**交付后，用本源码仓库的功能分支合并面板和功能。** release 由打包脚本生成，供游戏项目安装。并行开发期间各自使用独立工作区，交接时记录提交号。纯界面布局和文案可以先做，服务联调以本轮验收过的提交为准。

| 改动 | 源码入口 |
|---|---|
| Godot 停靠栏、按钮、表单和状态文案 | editor/workbench/addons/wxslim_readonly/plugin.gd、panel.gd、resource_config_form.gd |
| 表单字段、执行确认、进度及打开工具 | editor/workbench/adapter.mjs、action-confirmation.mjs 及同目录各表单 |
| 导出、组包、资源、存档、取消 | wxslim.mjs、lib/、convert/ |
| 自建引擎、GLX、补丁、裁剪 | engine/，涉及固定来源时需重建及独立验证 |
| 安装或打包 | packaging/install.mjs、packaging/build-release.mjs、runtime-files.json |

1. 从本版本创建功能分支，在源码中完成改动及回归。把用户日常导出和高级自建入口分组。在窄侧栏、大字号下能读到当前引擎、输入、输出和真实任务状态。
2. 面板从 `wxslim.mjs quick requirements` 读取模板需要确认的项目，用 `quick plan` 检查一次用户操作，用 `quick run` 执行。进度、历史、取消和打开工程分别使用 `quick status`、`quick runs`、`quick cancel`、`quick open`。错误的 `field` 指向对应设置，`reasonCode` 记录已知的底层原因。随附模板由服务读取安装版内的固定指纹单。面板不用定位历史证据。重建配对通过 `rebuiltPreparation` 选择。请求草稿、PCK 绑定、引擎审核和任务收据由服务处理。具体命令见[离线开发](docs/离线开发.md)。
3. 改变了任何运行文件引用时更新打包白名单。按 README 的本地测试，另外用空白游戏安装 release，核对面板→导出→重复转换→打开、拒绝已有输出、取消、实际文件指纹。
4. 合并到 source 的本地基线后，再用 packaging/build-release.mjs 生成新发行版。用更新后的 install.mjs 更新测试工程。将版本号、打包清单、实测包号和未验项一同交付。编辑器界面修订不自动获得引擎或设备验收结论。
5. 项目只在本机维护。另建副本、大型编译、预览上传、真机验收及清理沿用用户的逐轮授权。合并源码和生成本地安装版不需要联系其他会话。
