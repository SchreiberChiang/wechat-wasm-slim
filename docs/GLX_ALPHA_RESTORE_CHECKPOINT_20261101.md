# Alpha补丁与默认演示检查点（2026-11-01）

当前体验版为 `alpha-auto-20261101`，候选 `selfbuild-94181-autoplay-glx-a8cff356315bd4f2deac`。用户明确确认：体验版已确认，自动演示和第3、4项画面都正常。

## 分层保存的结果

1. 引擎补丁：保留材质alpha，灯光段后恢复；没有在最终显示端强制不透明。精确根因未确认。
2. 两项场景组合：父场景94181，Claude补丁配套引擎，官方return0保留。PCK/材质/场景/宿主未变，不含alpha显示绕开或32768实验。原绘制诊断导出缺失如实保留。
3. 初次组合包39d346：原始日志确认VCE-AL00、Android10、微信8.0.79、实际3.17.5/GLX、会话e8101cbd、统一全局ID false，四种自动演示状态均到达。用户反馈画面正常；4条RGBAFloat警告保留。
4. 默认演示a8cff：仅改变缺参数时的启动规则及身份记录，14项离线检查通过。上传一次成功；用户确认体验版指向、自动演示和第3/4项正常。本次反馈没有新原始日志，不能声称重新核验了设备、SDK、全部警告或像素结果。
5. 云测：用户准备自行执行，当前未取得结果，不记为通过。用户可显式填写 `autotest=1`；无参数也默认演示，5秒状态停留不保证云测截图覆盖每一状态。

## 授权提交的精确范围

用户已批准仅以下7个文件，按补丁、启动规则、记录三组提交，普通推送到当前工作分支：

- 补丁保存：`engine/alpha-preserve-lighting/scene-alpha-restore.patch`、`engine/alpha-preserve-lighting/LICENSE.godot.txt`。
- 启动规则：`engine/alpha-preserve-lighting/launch-query.js`、`engine/alpha-preserve-lighting/launch-query.test.cjs`。
- 说明与脱敏结果：`engine/alpha-preserve-lighting/README.md`、本文件、`docs/evidence/GLX_ALPHA_RESTORE_CHECKPOINT_20261101.json`。

共7个新文件，不暂存其他改动。排除已有 `.gitignore` 修改、历史安卓控制/探针/空间清理等未提交文件。源码包不含AppID、账号、凭据、用户私有路径、设备序列号、原始日志、截图、官方库或引擎二进制。

工作分支 `codex/glx-godot-newlib-20261026`，仓库 `SchreiberChiang/wechat-wasm-slim`。提交前核验的本地HEAD与远端分支均为 `6a29d0ea8ae4280967be7509371a8f48f7c15b0b`；保存本检查点前没有已提交但未推送的新增内容。此次最终提交号及远端核验结果另行报告，不把提交前状态当作最终状态。

## 保留与复现限制

原运行包、Claude原始场景和构建、94181故障包不删除。默认演示修改使用小文件前后字节与共享载荷哈希保存回退信息，没有另外复制完整工程。原始上传状态记录保留，最新用户确认追加记录，未覆盖历史证据。

此清单保存补丁、启动规则和可核对的结果，不宣称完整场景/诊断宿主历史已经全部入库，不宣称干净克隆已可复现。未进行更多手机测试、重进、云测操作或发布正式版。
