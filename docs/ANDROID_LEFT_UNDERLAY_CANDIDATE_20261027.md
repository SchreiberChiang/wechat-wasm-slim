# 安卓第15项左窗底板候选：电脑检查完成

最新：获准的一次安卓第15项对照完成并停止；实际3.17.4/GLX，左异常轮廓随底板变洋红、右仍橄榄，蓝/紫背景保持，贴图尚未恢复。支持下层颜色参与最终合成，未证明源alpha=0或具体根因。见[本轮手机结果](ANDROID_LEFT_UNDERLAY_RESULT_20261027.md)。

后续：用户已另行批准，本候选仅预览上传一次成功，27文件前后不变；等待用户扫码后再执行获准的手机步骤，尚无本候选手机结果。见[一次预览记录](ANDROID_LEFT_UNDERLAY_PHONE_20261027.md)。下方保留电脑阶段的状态和验证方案。

2026-10-27。本轮仅完成独立场景候选、封包及电脑检查；未上传、未操作手机、未执行ADB、未改变当前Wi-Fi或手机包。旧正常包、异常包与原始证据保留。它是一次区分显示链路的实验，不是修复候选通过声明；本轮结果出来后再决定具体修复方向，不继续堆同类探针。

## 身份与回退

| 项目 | 值 |
| --- | --- |
| 新GLX候选 | `ios-functional-glx-97e50760597b509a10a5` |
| CANDIDATE.json SHA256 | `98c37d86334a338fc24641c71ba0993c2bce1958d5cecd65a937acb1e96d5e1f` |
| PCK，189148 bytes | `44c74e175cc6452d2497b808c4fc7baad57ebd3cb128b5a278a6ca37108be9ad` |
| 场景源码manifest SHA256 | `e1e03e9e0056adf184a669f19464338bf7833cfbdc1cbe41eb3bcd9886b74099` |
| 本次比较基线，即当前橄榄色手机包 | `ios-functional-glx-20c564de30fc8e482fb1` |
| 比较基线manifest | `5ec9b7c2b769a0bd62077bc46b53b6e864e61c3441c08814c4f5c6642ba9dbc7` |

私有冻结目录为 `E:/AI/wechat-wasm-slim/.local/glx-android-underlay-20261027-01/frozen/candidate-glx/`。同根保存scene-source、underlay.pck、SOURCE_PREPARATION、PCK审计、STAGING、FINAL_AUDIT及电脑检查图和日志。FINAL_AUDIT SHA256为 `3f1de1aab9af8116eb40d1899194efc60f4624815ddb652369482203767a7a24`。

回退材料为 `E:/AI/wechat-wasm-slim/.local/glx-android-clearcolor-20261027-01/frozen/candidate-glx/`；最初成功验收包仍在 `E:/AI/wechat-wasm-slim/.local/glx-ios-functional-v2-20261027-01/frozen-03/candidate-glx/`。本轮不换手机包；将来换回也需单独确认。身份沿用现有`ios-functional`命名，并不表示本候选已在iOS或安卓验收。

原stage.mjs还生成同PCK的WebGL副本 `ios-functional-webgl-05f063b585ad5b39676e`，manifest为 `6a9f685e6ffea9e43756a6ae0cc0b6dcd6667cf32eb8e2acf5db06122f2ab029`；本轮未运行微信模拟器或该WebGL副本，不把它计作WebGL运行通过。

## 唯一运行变化

相对橄榄色基线，31个源文件仅`renderer.gd`改变。在`_new_view()`创建原TextureRect后，只对第15项`B08-left`的左窗新增一个洋红色ColorRect：

- 作为左TextureRect的子项，`show_behind_parent=true`，位于根UI画布，处于离屏3D视口之外。
- 覆盖左窗，并向四边各延伸6个逻辑单位；外圈是确认底板存在和颜色的参照。
- 忽略输入，沿用现有`_own`清理；第16项无底板，回到第15项才重新创建。
- 右窗不加底板。原橄榄色全局clear、蓝/紫视口背景、纹理、材质、灯光、相机、动作和日志均不改。

[机器可读配方](../engine/functional-acceptance/experiments/left-underlay.json)保存精确替换。只是把原一行创建结果保存为局部变量，再按上述条件创建底板；不改变原TextureRect参数或原views顺序。

**新增CanvasItem可能改变Canvas批次、状态切换和时序。** 不能承诺GPU只多一次draw，也不能将候选偶然恢复显示当作alpha已查明或引擎已修复。候选生产场景没有新增日志探针、GPU读回、手动flush/swap或afterDoFrame注册；电脑外部截图harness有自己的图像读取，不进入候选。

## 差异审计与电脑结果

1. 源码31文件逐字节比较，仅renderer.gd变化，替换块以外完全一致。
2. PCK v4共19项，目录路径一致、每项MD5有效，**唯一变化payload为renderer.gd**。包括project.binary、main.scn在内的其余18项完全一致；项目配置和根节点ID没有再变。原生检查harness及透明校准未入包。
3. 每模式冻结包均27文件。相对橄榄色包仅六路径变化：PCK、CANDIDATE.json、两个现有JS中的身份字面量、两个配置中的projectname。逐项核验了JS除身份外字节相同，配置除名称外相同，AppID、编译设置和模式配置均不改。manifest中的引擎来源父包仍是原完整引擎；本次场景对照父包是20c，二者含义不同。
4. 原引擎JS `e9f09402ddc60b0407a803e74b2f8824cc14b05d38e3cce99fb05d06ff573ddb`、BR `a3fa7032ace37840021c58bd06b6b49f7b0468c01dde4b9d63a33bc2d2cd82cf`、解压WASM `ead64be741dc04a3f11be60f64ff453e214704ccb248d8d9f6935c10f1d7f244`通过原门禁。库仍为`026efcefd31c8359310876d5865a47354be28de593b8d30fbfc5c82d73587aa8`。没有重编引擎或改宿主。
5. 固定Godot编辑器4.7.2.stable.steam.ed1daf0bf，仅正常导入/导出PCK；导入完成后才开始导出，日志无stderr。编辑器EXE SHA256为 `12310c74bdda7dcd43f28e971f33047dcecadd436b68169d61ce41009006df38`。
6. Windows原生OpenGL图形检查：基线与候选源场景均显示贴图方块，左右蓝/紫背景保留；候选只有左窗出现洋红外圈。核对了底板忽略输入的属性，未验证真实触摸；清理和重建范围检查通过。两份RESULT均PASS，stderr为空。**这是外部harness运行源场景的原生OpenGL检查，不是冻结微信PCK的运行身份验收，也不是微信WebGL或安卓GLX通过。**
7. 仅在外部原生harness中，将左窗纹理临时换成已知透明中心的CPU校准图：基线中心显示橄榄色，候选显示洋红色，不透明蓝区保持。它验证底板层序及预期区分能力；这段校准没有写入场景源码/PCK，不证明安卓平台的采样alpha。

私有`final-audit.mjs`重新核验源码、PCK报告绑定、两份完整manifest、原始配套引擎及解压WASM、六路径差异和原生结果，最终PASS。独立只读复核另行直接解析两份PCK及两模式27文件，确认相同差异范围和哈希。保留所有原文件，没有覆盖旧冻结目录。未运行或上传新的微信候选包，所有手机状态仍为未测试。

## 为什么与安卓GLX有关，以及还不能确定什么

此前同机WebGL能显示最小场景的旋转方块，而GLX异常；当前验收中直接主视口3D可见，SubViewport显示模型呈异常轮廓。单改全局clear色时，页面和轮廓均跟着变色，蓝/紫背景保持，见[已完成的清屏色对照](ANDROID_DEFAULT_CLEAR_COLOR_RESULT_20261027.md)。这些证据支持优先核对离屏颜色写入、ViewportTexture采样和Canvas混合之间的交界，尚未证明哪一层有错。

固定引擎源码的非透明视口默认clear alpha为1，正常不透明材质基础输出也有alpha；Canvas最终采样保留RGBA并按源alpha混合。普通非HDR非透明离屏RT存在RGB10_A2附件分支，但没有本轮手机实际附件证据，不能据此认定格式故障。尚未发现已证实的场景错误或漏调用。

底板将最终合成的下层颜色变成可识别的洋红色，帮助区分下层贡献与已携带橄榄色的纹理颜色。它不能直接读出源纹理alpha、微信实际shader输入、GLX内部对象或证明平台责任；额外CanvasItem和新包启动历史都是结果解释的限制。

## 一次安卓验证方案，尚未批准执行

申请范围仅为本候选一次正常预览，不覆盖体验版；用户在此前同一nova4/账号扫码换包，之后通过已有Wi-Fi ADB作有限导航与截图。执行前重新核27文件manifest及PCK/JS/WASM哈希，不重新构建、不自动切基础库。仅在已批准范围内操作，不访问聊天或其他应用。

1. 扫码首开后核对实际设备VCE-AL00/Android 10、包标识及实际`3.17.4 / GLX`。项目配置仍有继承的libVersion字段，不能当作实际基础库。可用当前画面身份和既有诊断信息核验；若画面无法明确实际后端或版本，请用户显示现有vConsole身份记录，不能假定ADB已具备完整日志读取能力。
2. 身份成立后，仅通过目录进入第15项，等待既有“内容已准备”提示，观察约20秒，取一张最终画面截图。保留左窗外圈、左右模型内部、蓝/紫背景和页面空白区；不点“只换左边”、暂停、换图或填写验收结论。
3. 与已保存20c截图离线比较。预期左窗外圈洋红、右窗无圈；无论异常是否复现，本轮截图和记录完成后停止。

版本/后端/包不符、黑屏、异常提示、ADB离线或页面陌生立即停止，不重试、不清缓存、不重进、不追加版本。内容准备未完成或外圈不可辨则记未知，不为取得结果继续改变条件。若需要扫码等人工操作，在获准后一次告知步骤。

| 观察 | 支持或削弱什么 | 不代表什么 |
| --- | --- | --- |
| 外圈可见；左轮廓变洋红，右轮廓仍橄榄 | 支持下层颜色参与了异常区的最终合成，优先追RGBA采样/混合/覆盖链 | 不证明源纹理alpha等于0，也不直接定位GLX库或某条shader |
| 外圈可见；左轮廓仍橄榄，右仍橄榄 | 削弱简单透出左窗下层底色的解释，更值得追离屏颜色写入/复制 | 少量画面证据不能证明整张纹理均不透明或全无正确颜色 |
| 外圈不可见、结果混合或关联不清 | 证据不足，记未知 | 不强行二选一归因 |
| 左右恢复、右窗也明显变化或出现新异常 | 本轮受额外CanvasItem/时序或启动历史影响，作为扰动结果保留 | 不称底板修复、alpha问题已证实或GLX全面通过 |

截图不认证持续旋转、性能或完整兼容性。结果保存后再选具体修复方向；本方案没有预先安排另一个探针或下一次上传。
